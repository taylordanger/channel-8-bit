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

  /** Drop segments that haven't started by `after` (a special cutting in). Returns their ids. */
  removeFrom(after: number): string[] {
    const rows = this.db.prepare("SELECT id FROM segments WHERE start_at >= ?").all(after) as { id: string }[];
    this.db.prepare("DELETE FROM segments WHERE start_at >= ?").run(after);
    return rows.map((r) => r.id);
  }

  /** Segments that overlap [from, to). */
  range(from: number, to: number): Segment[] {
    const rows = this.db
      .prepare("SELECT body FROM segments WHERE end_at > ? AND start_at < ? ORDER BY start_at")
      .all(from, to) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as Segment);
  }

  /** The original a segment re-airs (itself, if it's an original). */
  originalOf(id: string): string {
    const row = this.db.prepare("SELECT rerun_of FROM segments WHERE id = ?").get(id) as { rerun_of: string | null } | undefined;
    return row?.rerun_of ?? id;
  }

  /** Star a scene for more encores, retire it from encores, or clear the mark. Marks always land on the original. */
  mark(id: string, mark: "star" | "retired" | null, at: number): void {
    const original = this.originalOf(id);
    if (mark) this.db.prepare("INSERT OR REPLACE INTO archive_marks (segment_id, mark, at) VALUES (?,?,?)").run(original, mark, at);
    else this.db.prepare("DELETE FROM archive_marks WHERE segment_id = ?").run(original);
  }

  /** Marks keyed by original id. */
  marks(): Map<string, "star" | "retired"> {
    const rows = this.db.prepare("SELECT segment_id, mark FROM archive_marks").all() as { segment_id: string; mark: "star" | "retired" }[];
    return new Map(rows.map((r) => [r.segment_id, r.mark]));
  }

  /** Original commercials for a product written since `since`, least recently aired first. */
  adsFor(productId: number, since: number): Segment[] {
    const rows = this.db
      .prepare(
        `SELECT s.body FROM segments s
          WHERE s.kind = 'live' AND s.show_id = 'ad_break' AND s.start_at >= ? AND json_extract(s.body, '$.ad.productId') = ?
          ORDER BY COALESCE((SELECT MAX(r.start_at) FROM segments r WHERE r.rerun_of = s.id), s.start_at) ASC`,
      )
      .all(since, productId) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as Segment);
  }

  byId(id: string): Segment | undefined {
    const row = this.db.prepare("SELECT body FROM segments WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Segment) : undefined;
  }

  at(t: number): Segment | undefined {
    return this.range(t, t + 1)[0];
  }

  /** Recent summaries for a show - the writers' "previously on". */
  recentSummaries(showId: string, before: number, limit: number): string[] {
    const rows = this.db
      .prepare(
        "SELECT summary FROM segments WHERE show_id = ? AND kind = 'live' AND summary != '' AND start_at < ? ORDER BY start_at DESC LIMIT ?",
      )
      .all(showId, before, limit) as { summary: string }[];
    return rows.map((r) => r.summary).reverse();
  }

  /** Summaries of the fresh scenes of a show aired in [from, before): what this episode has done so far. */
  sceneSummaries(showId: string, from: number, before: number, limit = 6): string[] {
    const rows = this.db
      .prepare("SELECT summary FROM segments WHERE show_id = ? AND kind = 'live' AND summary != '' AND start_at >= ? AND start_at < ? ORDER BY start_at DESC LIMIT ?")
      .all(showId, from, before, limit) as { summary: string }[];
    return rows.map((r) => r.summary).reverse();
  }

  /** Topic seeds of a show's last few fresh scenes. */
  recentTopics(showId: string, before: number, scenes: number): string[] {
    const rows = this.db
      .prepare("SELECT json_extract(body, '$.topic') AS topic FROM segments WHERE show_id = ? AND kind = 'live' AND start_at < ? ORDER BY start_at DESC LIMIT ?")
      .all(showId, before, scenes) as { topic: string | null }[];
    return rows.map((r) => r.topic).filter((t): t is string => Boolean(t));
  }

  /** The lines of a show's last few fresh scenes, one array per scene. */
  recentScenes(showId: string, before: number, scenes: number): string[][] {
    const rows = this.db
      .prepare("SELECT body FROM segments WHERE show_id = ? AND kind = 'live' AND start_at < ? ORDER BY start_at DESC LIMIT ?")
      .all(showId, before, scenes) as { body: string }[];
    return rows.map((r) => (JSON.parse(r.body) as Segment).cues.map((c) => c.text));
  }

  /** Recently aired lines across a show, to stop the writers repeating themselves. */
  recentLines(showId: string, before: number, segments: number): string[] {
    const rows = this.db
      .prepare("SELECT body FROM segments WHERE show_id = ? AND start_at < ? ORDER BY start_at DESC LIMIT ?")
      .all(showId, before, segments) as { body: string }[];
    return rows.flatMap((r) => (JSON.parse(r.body) as Segment).cues.map((c) => c.text));
  }

  /** Ids of originals aired in [from, to), directly or as an encore. */
  airedIds(from: number, to: number): Set<string> {
    const rows = this.db
      .prepare("SELECT id, rerun_of FROM segments WHERE end_at > ? AND start_at < ?")
      .all(from, to) as { id: string; rerun_of: string | null }[];
    return new Set(rows.flatMap((r) => (r.rerun_of ? [r.id, r.rerun_of] : [r.id])));
  }

  /**
   * Pick an archived live segment of this show to re-air. Least recently aired goes first, but
   * the archive is curated: retired scenes never come back, and starred or laughed-at scenes
   * count as if they last aired a while earlier (stars 3h, each "that was funny" 30 min, up
   * to 2h), so the best material comes around more often without looping.
   */
  pickRerun(showId: string, maxDurationMs: number, excludeIds: Set<string>): Segment | undefined {
    const rows = this.db
      .prepare(
        `SELECT id, body FROM (
           SELECT s.id, s.body, s.start_at,
                  json_extract(s.body, '$.writer') = 'improv' AS improv,
                  COALESCE((SELECT MAX(r.start_at) FROM segments r WHERE r.rerun_of = s.id), 0)
                    - CASE WHEN m.mark = 'star' THEN 10800000 ELSE 0 END
                    - MIN(7200000, 1800000 * (SELECT COUNT(*) FROM funny f
                        WHERE f.segment_id = s.id OR f.segment_id IN (SELECT r.id FROM segments r WHERE r.rerun_of = s.id))) AS due
             FROM segments s LEFT JOIN archive_marks m ON m.segment_id = s.id
            WHERE s.show_id = ? AND s.kind = 'live' AND (s.end_at - s.start_at) <= ? AND COALESCE(m.mark, '') != 'retired')
          ORDER BY improv ASC, due ASC, start_at ASC
          LIMIT 20`,
      )
      .all(showId, maxDurationMs) as { id: string; body: string }[];
    const row = rows.find((r) => !excludeIds.has(r.id));
    return row ? (JSON.parse(row.body) as Segment) : undefined;
  }
}
