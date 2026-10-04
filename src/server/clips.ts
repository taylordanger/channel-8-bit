import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";
import type { Segment } from "../shared/types.js";

export interface Clip {
  id: number;
  segmentId: string;
  showId: string;
  title: string;
  createdAt: number;
  status: "queued" | "rendering" | "ready" | "failed";
  file: string | null;
  error: string | null;
  durationMs: number;
  /** The 9:16 version for TikTok / Shorts / Reels, when it was made. */
  verticalFile: string | null;
}

interface Row {
  id: number;
  segment_id: string;
  show_id: string;
  title: string;
  created_at: number;
  status: Clip["status"];
  file: string | null;
  error: string | null;
  duration_ms: number;
  vertical_file: string | null;
}
const toClip = (r: Row): Clip => ({
  id: r.id,
  segmentId: r.segment_id,
  showId: r.show_id,
  title: r.title,
  createdAt: r.created_at,
  status: r.status,
  file: r.file,
  error: r.error,
  durationMs: r.duration_ms,
  verticalFile: r.vertical_file,
});

/** Runs the renderer for one clip; resolves with an error message, or null on success. */
export type ClipRenderer = (segmentId: string, outFile: string, limitMs: number) => Promise<string | null>;

/** Makes a vertical copy of a finished clip; resolves with an error message, or null on success. */
export type Verticalizer = (inFile: string, outFile: string) => Promise<string | null>;

/**
 * 1080x1920 for phones: the whole 16:9 scene at full width in the middle (nobody cropped out),
 * over a blurred, zoomed copy of itself (blurred small, then enlarged: same look, a fraction of the work).
 * Captions are already in the picture.
 */
export const ffmpegVertical: Verticalizer = (inFile, outFile) =>
  new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y", "-i", inFile,
        "-filter_complex",
        "[0:v]split[a][b];[a]scale=-2:480,crop=270:480,boxblur=8:2,scale=1080:1920[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
        "-map", "[v]", "-map", "0:a?", "-c:v", "h264_videotoolbox", "-b:v", "6000k", "-c:a", "copy", "-movflags", "+faststart", outFile,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr.on("data", (d: Buffer) => (err += String(d)));
    ff.on("exit", (code) => resolve(code === 0 ? null : err.trim().split("\n").pop()?.slice(0, 200) || `ffmpeg exited (${code})`));
    ff.on("error", (e) => resolve(e.message));
  });

/** The real renderer: a separate process, so a Chrome or ffmpeg problem can't touch the station. */
export function processRenderer(root: string, port: number): ClipRenderer {
  return (segmentId, outFile, limitMs) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/clips/render.ts", "--segment", segmentId, "--out", outFile, "--limit-ms", String(limitMs)], {
        cwd: root,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (d: Buffer) => (err += String(d)));
      child.on("exit", (code) => resolve(code === 0 ? null : err.trim().split("\n").pop()?.slice(0, 200) || `renderer exited (${code})`));
      child.on("error", (e) => resolve(e.message));
    });
}

/**
 * The clip desk: the operator picks a moment, it renders in the background (in real time -
 * a two-minute scene takes about two minutes), and the MP4 is ready to post anywhere.
 */
export class ClipDesk {
  private running?: Promise<void>;

  constructor(
    private db: DB,
    readonly dir: string,
    private render: ClipRenderer,
    private log?: (m: string) => void,
    private vertical: Verticalizer = ffmpegVertical,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    // Renders interrupted by a restart go back in the queue.
    this.db.prepare("UPDATE clips SET status = 'queued' WHERE status = 'rendering'").run();
    // ...and pick back up once the station is serving pages again.
    const waiting = (this.db.prepare("SELECT COUNT(*) AS n FROM clips WHERE status = 'queued'").get() as { n: number }).n;
    if (waiting) setTimeout(() => void this.pump().catch((e: Error) => this.log?.(`clip queue: ${e.message}`)), 10_000).unref();
  }

  /** Queue a clip of an aired segment. Returns an error string for the operator. */
  request(segmentId: string, now: number): Clip | string {
    const seg = this.find(segmentId);
    if (!seg || seg.startAt > now) return "that segment hasn't aired";
    if (seg.kind === "bumper") return "nothing to clip in a station break";
    const existing = this.db.prepare("SELECT * FROM clips WHERE segment_id = ? AND status != 'failed'").get(segmentId) as Row | undefined;
    if (existing) return toClip(existing);
    const info = this.db
      .prepare("INSERT INTO clips (segment_id, show_id, title, created_at, status, duration_ms) VALUES (?,?,?,?,'queued',?)")
      .run(seg.id, seg.showId, seg.title, now, seg.durationMs);
    void this.pump();
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): Clip | undefined {
    const r = this.db.prepare("SELECT * FROM clips WHERE id = ?").get(id) as Row | undefined;
    return r && toClip(r);
  }

  list(limit = 30): Clip[] {
    return (this.db.prepare("SELECT * FROM clips ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(toClip);
  }

  /** Render queued clips one at a time. While busy, returns the run already in progress. */
  pump(): Promise<void> {
    if (!this.running) this.running = this.drain().finally(() => (this.running = undefined));
    return this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const row = this.db.prepare("SELECT * FROM clips WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as Row | undefined;
      if (!row) break;
      this.db.prepare("UPDATE clips SET status = 'rendering' WHERE id = ?").run(row.id);
      const file = `${row.id}-${row.show_id}.mp4`;
      const error = await this.render(row.segment_id, path.join(this.dir, file), row.duration_ms + 60_000);
      if (error) {
        this.db.prepare("UPDATE clips SET status = 'failed', error = ? WHERE id = ?").run(error, row.id);
        this.log?.(`clip ${row.id} failed: ${error}`);
      } else {
        // The vertical copy is a bonus: if it fails, the widescreen clip is still ready.
        const vfile = file.replace(/\.mp4$/, "-vertical.mp4");
        const verr = await this.vertical(path.join(this.dir, file), path.join(this.dir, vfile));
        if (verr) this.log?.(`clip ${row.id}: vertical version failed: ${verr}`);
        this.db.prepare("UPDATE clips SET status = 'ready', file = ?, vertical_file = ? WHERE id = ?").run(file, verr ? null : vfile, row.id);
        this.log?.(`clip ready: ${file}${verr ? "" : ` (+ ${vfile})`}`);
      }
    }
  }

  private find(id: string): Segment | undefined {
    const row = this.db.prepare("SELECT body FROM segments WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Segment) : undefined;
  }
}

/** "That was funny" taps from viewers: one per viewer per segment. The best clip candidates rise to the top. */
export class FunnyMeter {
  constructor(private db: DB) {}

  tap(segmentId: string, viewer: string, now: number): boolean {
    return this.db.prepare("INSERT OR IGNORE INTO funny (segment_id, viewer, at) VALUES (?,?,?)").run(segmentId, viewer, now).changes > 0;
  }

  /** Taps per segment since `since`. */
  counts(since: number): Map<string, number> {
    const rows = this.db.prepare("SELECT segment_id, COUNT(*) AS n FROM funny WHERE at >= ? GROUP BY segment_id").all(since) as { segment_id: string; n: number }[];
    return new Map(rows.map((r) => [r.segment_id, r.n]));
  }
}
