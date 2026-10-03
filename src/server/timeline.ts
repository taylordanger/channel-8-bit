import type { Segment } from "../shared/types.js";
import type { DB } from "./db.js";

/**
 * The single, append-only broadcast timeline. Every viewer reads the same rows.
 * Invariant: segments never overlap. Gaps are allowed (nobody was watching) and
 * the player shows a standby card during them.
 */
export class Timeline {
  constructor(private db: DB) {}

  /** End time of the last scheduled segment, or 0 if the timeline is empty. */
  tailEnd(): number {
    const row = this.db.prepare("SELECT MAX(end_at) AS e FROM segments").get() as { e: number | null };
    return row.e ?? 0;
  }

  append(seg: Segment, summary: string, rerunOf?: string): void {
    const end = seg.startAt + seg.durationMs;
    if (seg.startAt < this.tailEnd()) {
      throw new Error(`timeline overlap: segment ${seg.id} starts before the current tail`);
    }
    this.db
      .prepare(
        "INSERT INTO segments (id, show_id, start_at, end_at, kind, body, summary, rerun_of) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(seg.id, seg.showId, seg.startAt, end, seg.kind, JSON.stringify(seg), summary, rerunOf ?? null);
  }

  /** Segments that overlap [from, to). */
  range(from: number, to: number): Segment[] {
    const rows = this.db
      .prepare("SELECT body FROM segments WHERE end_at > ? AND start_at < ? ORDER BY start_at")
      .all(from, to) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as Segment);
  }

  at(t: number): Segment | undefined {
    return this.range(t, t + 1)[0];
  }

  /** Recent summaries for a show - the writers' "previously on". */
  recentSummaries(showId: string, before: number, limit: number): string[] {
    const rows = this.db
      .prepare(
        "SELECT summary FROM segments WHERE show_id = ? AND kind = 'live' AND start_at < ? ORDER BY start_at DESC LIMIT ?",
      )
      .all(showId, before, limit) as { summary: string }[];
    return rows.map((r) => r.summary).reverse();
  }

  /** Recently aired lines across a show, to stop the writers repeating themselves. */
  recentLines(showId: string, before: number, segments: number): string[] {
    const rows = this.db
      .prepare("SELECT body FROM segments WHERE show_id = ? AND start_at < ? ORDER BY start_at DESC LIMIT ?")
      .all(showId, before, segments) as { body: string }[];
    return rows.flatMap((r) => (JSON.parse(r.body) as Segment).cues.map((c) => c.text));
  }

  /** Pick an archived live segment of this show to re-air, preferring the least recently aired. */
  pickRerun(showId: string, maxDurationMs: number, excludeIds: Set<string>): Segment | undefined {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.body,
                (SELECT MAX(r.start_at) FROM segments r WHERE r.rerun_of = s.id) AS last_rerun
           FROM segments s
          WHERE s.show_id = ? AND s.kind = 'live' AND (s.end_at - s.start_at) <= ?
          ORDER BY COALESCE(last_rerun, 0) ASC, s.start_at ASC
          LIMIT 20`,
      )
      .all(showId, maxDurationMs) as { id: string; body: string }[];
    const row = rows.find((r) => !excludeIds.has(r.id));
    return row ? (JSON.parse(row.body) as Segment) : undefined;
  }
}
