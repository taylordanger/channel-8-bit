import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Segment } from "../shared/types.js";
import type { ClipRenderer, Verticalizer } from "./clips.js";
import type { DB } from "./db.js";
import { cleanMessage, type Moderator } from "./mailbag.js";
import type { StandardsPolicy } from "./standards.js";

/**
 * Personalized shoutouts: a viewer asks the cast for a short video message for a friend ("Rex and
 * Dee Dee wish Maya a happy birthday"). Screened like mail, approved by a human on the desk,
 * written and voiced as a private scene that never airs, rendered to MP4s, and picked up through
 * an unguessable link - no email or account. Free unless the operator sets a payment link.
 */

export const OCCASIONS = ["birthday", "congratulations", "anniversary", "good luck", "get well soon", "thank you", "just because"] as const;
export type Occasion = (typeof OCCASIONS)[number];

/** Who can be booked, by show. */
export const SHOUTOUT_CASTS: Record<string, string> = {
  late_byte: "Rex & Dee Dee (The Late Byte)",
  rise_and_pixel: "Sunny, Greg & Pip (Rise & Pixel)",
  callin: "Dr. Dot & Murray (Ask Dr. Dot)",
  news: "The 8-Bit Report news team",
  pixel_heights: "The Sterlings (Pixel Heights)",
};

export type ShoutoutStatus = "pending" | "approved" | "writing" | "rendering" | "ready" | "rejected" | "failed";

export interface Shoutout {
  id: number;
  recipient: string;
  occasion: Occasion;
  detail: string;
  showId: string;
  status: ShoutoutStatus;
  reason: string;
  createdAt: number;
  segmentId: string | null;
  file: string | null;
  verticalFile: string | null;
}

interface Row {
  id: number;
  token_hash: string;
  recipient: string;
  occasion: Occasion;
  detail: string;
  show_id: string;
  status: ShoutoutStatus;
  reason: string;
  created_at: number;
  segment: string | null;
  file: string | null;
  vertical_file: string | null;
  sender: string;
}
const toShoutout = (r: Row): Shoutout => ({
  id: r.id,
  recipient: r.recipient,
  occasion: r.occasion,
  detail: r.detail,
  showId: r.show_id,
  status: r.status,
  reason: r.reason,
  createdAt: r.created_at,
  segmentId: r.segment ? (JSON.parse(r.segment) as Segment).id : null,
  file: r.file,
  verticalFile: r.vertical_file,
});

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 24 * 3_600_000;

/** A first name only: letters, apostrophes and hyphens, one optional space ("Mary Ann"), short. */
export function cleanRecipient(name: string): string | undefined {
  const n = name.trim().replace(/\s+/g, " ");
  return /^[A-Za-z][A-Za-z'-]{0,14}( [A-Za-z][A-Za-z'-]{0,14})?$/.test(n) ? n : undefined;
}

export interface ShoutoutDeps {
  policy: StandardsPolicy;
  moderator?: Moderator;
  /** Writes and voices the private scene. */
  make: (s: Shoutout) => Promise<Segment>;
  render: ClipRenderer;
  vertical: Verticalizer;
  dir: string;
  log?: (m: string) => void;
}

export class ShoutoutDesk {
  private running?: Promise<void>;

  constructor(
    private db: DB,
    private d: ShoutoutDeps,
  ) {
    fs.mkdirSync(d.dir, { recursive: true });
    // Work a restart interrupted goes back in line.
    this.db.prepare("UPDATE shoutouts SET status = 'approved' WHERE status IN ('writing', 'rendering')").run();
  }

  /** A viewer's request. Returns the private pickup token, or an error for the viewer. */
  async submit(
    input: { recipient: string; occasion: string; detail: string; showId: string },
    ip: string,
    now: number,
  ): Promise<{ token: string; status: ShoutoutStatus } | string> {
    const recipient = cleanRecipient(input.recipient);
    if (!recipient) return "just their first name, please (letters only)";
    if (!OCCASIONS.includes(input.occasion as Occasion)) return "pick an occasion";
    if (!SHOUTOUT_CASTS[input.showId]) return "pick who should do it";
    const detail = cleanMessage(input.detail).slice(0, 140);
    const sender = hash(`shoutout:${ip}`).slice(0, 16);
    const recent = (this.db.prepare("SELECT COUNT(*) AS n FROM shoutouts WHERE sender = ? AND created_at > ?").get(sender, now - RATE_WINDOW_MS) as { n: number }).n;
    if (recent >= RATE_LIMIT) return "that's a few requests already today - try again tomorrow";

    let status: ShoutoutStatus = "pending";
    let reason = "waiting for the producers";
    const text = `${recipient} ${detail}`;
    if ([...this.d.policy.blocklist, ...this.d.policy.fictionBlocklist].some((re) => re.test(text))) {
      status = "rejected";
      reason = "blocked by the standards list";
    } else if (this.d.moderator) {
      try {
        const v = await this.d.moderator.moderate(`A personalized birthday-card style video for a friend named ${recipient} (${input.occasion}). Detail from the requester: ${detail || "(none)"}`, "shoutout request");
        // Even when the screen passes it, a human approves every shoutout.
        if (!v.allow || v.crisis) [status, reason] = ["rejected", `screen: ${v.reason.slice(0, 100)}`];
        else reason = "screened - waiting for the producers";
      } catch {
        reason = "waiting for the producers";
      }
    }
    const token = crypto.randomBytes(18).toString("base64url");
    this.db
      .prepare("INSERT INTO shoutouts (token_hash, recipient, occasion, detail, show_id, status, reason, created_at, sender) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(hash(token), recipient, input.occasion, detail, input.showId, status, reason, now, sender);
    return { token, status };
  }

  /** What the requester sees at their private link. */
  lookup(token: string): Shoutout | undefined {
    const r = this.db.prepare("SELECT * FROM shoutouts WHERE token_hash = ?").get(hash(token)) as Row | undefined;
    return r && toShoutout(r);
  }

  list(limit = 50): Shoutout[] {
    return (this.db.prepare("SELECT * FROM shoutouts ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(toShoutout);
  }

  review(id: number, approve: boolean): boolean {
    const ok =
      this.db
        .prepare("UPDATE shoutouts SET status = ?, reason = ? WHERE id = ? AND status IN ('pending', 'rejected', 'failed')")
        .run(approve ? "approved" : "rejected", approve ? "approved on the desk" : "declined on the desk", id).changes > 0;
    if (ok && approve) void this.pump();
    return ok;
  }

  /** The private scene, for the local clip renderer only. */
  segment(segmentId: string): Segment | undefined {
    const r = this.db.prepare("SELECT segment FROM shoutouts WHERE json_extract(segment, '$.id') = ?").get(segmentId) as { segment: string } | undefined;
    return r ? (JSON.parse(r.segment) as Segment) : undefined;
  }

  /** Make approved shoutouts one at a time. While busy, returns the run in progress. */
  pump(): Promise<void> {
    if (!this.running) this.running = this.drain().finally(() => (this.running = undefined));
    return this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const row = this.db.prepare("SELECT * FROM shoutouts WHERE status = 'approved' ORDER BY created_at LIMIT 1").get() as Row | undefined;
      if (!row) break;
      const s = toShoutout(row);
      const set = (status: ShoutoutStatus, extra: Record<string, string | null> = {}) => {
        const cols = Object.keys(extra);
        this.db.prepare(`UPDATE shoutouts SET status = ?${cols.map((c) => `, ${c} = ?`).join("")} WHERE id = ?`).run(status, ...Object.values(extra), s.id);
      };
      try {
        set("writing");
        const segment = await this.d.make(s);
        set("rendering", { segment: JSON.stringify(segment) });
        // Unguessable file names: the link is the only key.
        const name = crypto.randomBytes(12).toString("hex");
        const file = `${name}.mp4`;
        const err = await this.d.render(segment.id, path.join(this.d.dir, file), segment.durationMs + 60_000);
        if (err) throw new Error(err);
        const vfile = `${name}-vertical.mp4`;
        const verr = await this.d.vertical(path.join(this.d.dir, file), path.join(this.d.dir, vfile));
        set("ready", { file, vertical_file: verr ? null : vfile, reason: "ready to download" });
        this.d.log?.(`shoutout ${s.id} for ${s.recipient} is ready`);
      } catch (e) {
        set("failed", { reason: (e as Error).message.slice(0, 160) });
        this.d.log?.(`shoutout ${s.id} failed: ${(e as Error).message}`);
      }
    }
  }
}
