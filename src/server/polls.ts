import type { Poll, PollResult } from "../shared/types.js";
import type { DB } from "./db.js";
import { rng } from "./writers/improv.js";

interface PollRow {
  id: string;
  segment_id: string;
  show_id: string;
  episode: string;
  question: string;
  options: string;
  opens_at: number;
  closes_at: number;
  closed: number;
  winner: string | null;
  studio: number;
  weight: number;
}

export interface StoredPoll extends Poll {
  segmentId: string;
  showId: string;
  episode: string;
  opensAt: number;
  closed: boolean;
  winner: string | null;
  studio: boolean;
  weight: number;
}

const toPoll = (r: PollRow): StoredPoll => ({
  id: r.id,
  segmentId: r.segment_id,
  showId: r.show_id,
  episode: r.episode,
  question: r.question,
  options: JSON.parse(r.options),
  opensAt: r.opens_at,
  closesAt: r.closes_at,
  closed: Boolean(r.closed),
  winner: r.winner,
  studio: Boolean(r.studio),
  weight: r.weight,
});

export type VoteOutcome = "ok" | "unknown poll" | "closed" | "not open yet" | "bad option" | "already voted";

/** Viewer polls: one vote per viewer per poll, open while its segment airs (plus a short grace). */
export class PollBox {
  constructor(private db: DB) {}

  open(p: Omit<StoredPoll, "closed" | "winner" | "studio">): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO polls (id, segment_id, show_id, episode, question, options, opens_at, closes_at, weight) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(p.id, p.segmentId, p.showId, p.episode, p.question, JSON.stringify(p.options), p.opensAt, p.closesAt, p.weight);
  }

  get(id: string): StoredPoll | undefined {
    const r = this.db.prepare("SELECT * FROM polls WHERE id = ?").get(id) as PollRow | undefined;
    return r ? toPoll(r) : undefined;
  }

  vote(pollId: string, voter: string, optionId: string, now: number): VoteOutcome {
    const p = this.get(pollId);
    if (!p) return "unknown poll";
    if (p.closed || now >= p.closesAt) return "closed";
    if (now < p.opensAt - 2000) return "not open yet";
    if (!p.options.some((o) => o.id === optionId)) return "bad option";
    const info = this.db.prepare("INSERT OR IGNORE INTO votes (poll_id, voter, option_id, at) VALUES (?,?,?,?)").run(pollId, voter, optionId, now);
    return info.changes ? "ok" : "already voted";
  }

  tally(pollId: string): Record<string, number> {
    const p = this.get(pollId);
    const out: Record<string, number> = Object.fromEntries((p?.options ?? []).map((o) => [o.id, 0]));
    for (const r of this.db.prepare("SELECT option_id, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY option_id").all(pollId) as { option_id: string; n: number }[])
      out[r.option_id] = r.n;
    return out;
  }

  result(pollId: string): PollResult | undefined {
    const p = this.get(pollId);
    if (!p) return undefined;
    return { pollId, tally: this.tally(pollId), closed: p.closed, winner: p.winner ?? undefined, studio: p.studio };
  }

  /** Polls that are accepting votes right now. */
  active(now: number): StoredPoll[] {
    return (this.db.prepare("SELECT * FROM polls WHERE closed = 0 AND opens_at - 2000 <= ? AND closes_at > ?").all(now, now) as PollRow[]).map(toPoll);
  }

  /**
   * Close every poll past its deadline. The most votes wins; ties and empty polls are decided
   * by "the studio audience" (seeded, so it's reproducible). Returns what just closed.
   */
  closeDue(now: number): (StoredPoll & { tally: Record<string, number> })[] {
    const due = (this.db.prepare("SELECT * FROM polls WHERE closed = 0 AND closes_at <= ?").all(now) as PollRow[]).map(toPoll);
    return due.map((p) => {
      const tally = this.tally(p.id);
      const max = Math.max(0, ...Object.values(tally));
      const leaders = p.options.filter((o) => tally[o.id] === max);
      const studio = max === 0;
      const r = rng(p.closesAt ^ p.id.length);
      const winner = (leaders.length === 1 ? leaders[0] : leaders[Math.floor(r() * leaders.length)]).id;
      this.db.prepare("UPDATE polls SET closed = 1, winner = ?, studio = ? WHERE id = ?").run(winner, studio ? 1 : 0, p.id);
      return { ...p, closed: true, winner, studio, tally };
    });
  }

  /** Closed polls of a game episode, oldest first. */
  episode(episode: string): StoredPoll[] {
    return (this.db.prepare("SELECT * FROM polls WHERE episode = ? ORDER BY opens_at").all(episode) as PollRow[]).map(toPoll);
  }
}
