import type { Segment } from "../shared/types.js";
import type { DB } from "./db.js";

/**
 * The overnight writers' room: complete, voiced scenes written while nobody is watching and kept
 * off the air until the live writer falls behind - then a never-seen scene airs instead of an
 * encore or improv filler. Banked scenes are standalone (no episode plan, mail or desk stories),
 * so they fit whenever they're needed.
 */
export class SceneBank {
  constructor(private db: DB) {}

  add(segment: Segment, summary: string, at: number): void {
    this.db.prepare("INSERT INTO scene_bank (show_id, created_at, duration_ms, summary, segment) VALUES (?,?,?,?,?)").run(segment.showId, at, segment.durationMs, summary, JSON.stringify(segment));
  }

  /** Unaired scenes waiting, per show. */
  counts(): Record<string, number> {
    const rows = this.db.prepare("SELECT show_id, COUNT(*) AS n FROM scene_bank WHERE aired_at IS NULL GROUP BY show_id").all() as { show_id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.show_id, r.n]));
  }

  /** The oldest unaired scene of this show that fits, marked as aired. */
  take(showId: string, maxMs: number, at: number): { segment: Segment; summary: string } | undefined {
    const row = this.db
      .prepare("SELECT id, summary, segment FROM scene_bank WHERE show_id = ? AND aired_at IS NULL AND duration_ms <= ? ORDER BY created_at LIMIT 1")
      .get(showId, maxMs) as { id: number; summary: string; segment: string } | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE scene_bank SET aired_at = ? WHERE id = ?").run(at, row.id);
    return { segment: JSON.parse(row.segment) as Segment, summary: row.summary };
  }
}
