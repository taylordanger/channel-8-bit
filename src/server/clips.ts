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
});

/** Runs the renderer for one clip; resolves with an error message, or null on success. */
export type ClipRenderer = (segmentId: string, outFile: string, limitMs: number) => Promise<string | null>;

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
  private busy = false;

  constructor(
    private db: DB,
    readonly dir: string,
    private render: ClipRenderer,
    private log?: (m: string) => void,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    // Renders interrupted by a restart go back in the queue.
    this.db.prepare("UPDATE clips SET status = 'queued' WHERE status = 'rendering'").run();
    // ...and pick back up once the station is serving pages again.
    setTimeout(() => void this.pump(), 10_000).unref();
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

  /** Render queued clips one at a time. */
  async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
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
          this.db.prepare("UPDATE clips SET status = 'ready', file = ? WHERE id = ?").run(file, row.id);
          this.log?.(`clip ready: ${file}`);
        }
      }
    } finally {
      this.busy = false;
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
