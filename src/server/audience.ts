import { SHOWS } from "./catalog/shows.js";
import type { DB } from "./db.js";

/**
 * How people actually watch: who presses play, how long they stay, who comes back, and which
 * shows they leave during. Website sessions only (the restream feed and this Mac don't count).
 * A viewer is the random id their browser already keeps for voting - no IPs are stored.
 */
export class AudienceLog {
  constructor(private db: DB) {}

  open(at: number, local: boolean): number {
    return Number(this.db.prepare("INSERT INTO viewer_sessions (started_at, local) VALUES (?, ?)").run(at, local ? 1 : 0).lastInsertRowid);
  }

  identify(id: number, viewer: string, ref: string | null): void {
    if (!/^[\w-]{8,64}$/.test(viewer)) return;
    this.db.prepare("UPDATE viewer_sessions SET viewer = ?, ref = ? WHERE id = ?").run(viewer, ref && /^[\w-]{1,40}$/.test(ref) ? ref : null, id);
  }

  tunedIn(id: number, at: number): void {
    this.db.prepare("UPDATE viewer_sessions SET tuned_at = COALESCE(tuned_at, ?) WHERE id = ?").run(at, id);
  }

  close(id: number, at: number, showOnAir: string): void {
    this.db.prepare("UPDATE viewer_sessions SET ended_at = ?, left_during = ? WHERE id = ?").run(at, showOnAir, id);
  }

  /** The audience over [now - windowMs, now]. Open sessions count up to now. */
  report(now: number, windowMs = 24 * 3_600_000) {
    const since = now - windowMs;
    const rows = this.db
      .prepare("SELECT viewer, started_at, ended_at, tuned_at, ref, left_during FROM viewer_sessions WHERE local = 0 AND started_at >= ?")
      .all(since) as { viewer: string | null; started_at: number; ended_at: number | null; tuned_at: number | null; ref: string | null; left_during: string | null }[];
    const watched = rows.filter((r) => r.tuned_at !== null).map((r) => (r.ended_at ?? now) - r.tuned_at!);
    const viewers = new Set(rows.map((r) => r.viewer).filter((v): v is string => Boolean(v)));
    const returning = [...viewers].filter(
      (v) => (this.db.prepare("SELECT 1 FROM viewer_sessions WHERE viewer = ? AND started_at < ? LIMIT 1").get(v, since) as unknown) !== undefined,
    ).length;
    const leaves = new Map<string, { quickLeaves: number; sessions: number; minutes: number[] }>();
    for (const r of rows) {
      if (!r.ended_at || !r.left_during || r.tuned_at === null) continue;
      const l = leaves.get(r.left_during) ?? { quickLeaves: 0, sessions: 0, minutes: [] };
      const ms = r.ended_at - r.tuned_at;
      l.sessions++;
      l.minutes.push(ms / 60_000);
      if (ms < 60_000) l.quickLeaves++;
      leaves.set(r.left_during, l);
    }
    const votes = (this.db.prepare("SELECT COUNT(*) AS n FROM votes WHERE at >= ?").get(since) as { n: number }).n;
    const mail = (this.db.prepare("SELECT COUNT(*) AS n FROM viewer_messages WHERE created_at >= ?").get(since) as { n: number }).n;
    const funny = (this.db.prepare("SELECT COUNT(*) AS n FROM funny WHERE at >= ?").get(since) as { n: number }).n;
    const clipRefs = new Map<string, number>();
    for (const r of rows) if (r.ref?.startsWith("clip-")) clipRefs.set(r.ref, (clipRefs.get(r.ref) ?? 0) + 1);
    const per = (n: number) => (viewers.size ? Math.round((n / viewers.size) * 100) / 100 : 0);
    return {
      visits: rows.length,
      viewers: viewers.size,
      startedPlayback: watched.length,
      medianWatchMin: Math.round(median(watched) / 6_000) / 10,
      returning,
      votesPerViewer: per(votes),
      mailPerViewer: per(mail),
      funnyPerViewer: per(funny),
      leftDuring: [...leaves]
        .map(([showId, l]) => ({ show: SHOWS[showId]?.title ?? showId, sessions: l.sessions, quickLeaves: l.quickLeaves, medianMin: Math.round(median(l.minutes) * 10) / 10 }))
        .sort((a, b) => b.sessions - a.sessions),
      clipReferrals: [...clipRefs].map(([ref, visits]) => ({ clipId: Number(ref.slice(5)), visits })).sort((a, b) => b.visits - a.visits),
    };
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
