import type { DB } from "./db.js";

const DAY = 86_400_000;

/** Operational metrics: what each writer attempt cost, and whether viewers ever saw dead air. */
export class OpsLog {
  constructor(private db: DB) {}

  production(e: { at: number; showId: string; writer: string; outcome: "ok" | "failed" | "rejected"; writeMs: number; voiceMs?: number; detail?: string }): void {
    this.db
      .prepare("INSERT INTO production_log (at, show_id, writer, outcome, write_ms, voice_ms, detail) VALUES (?,?,?,?,?,?,?)")
      .run(e.at, e.showId, e.writer, e.outcome, Math.round(e.writeMs), Math.round(e.voiceMs ?? 0), (e.detail ?? "").slice(0, 200));
  }

  /** Called once a second by the station. */
  airTick(now: number, viewers: number, onAir: boolean): void {
    const minute = Math.floor(now / 60_000);
    this.db
      .prepare(
        `INSERT INTO air_stats (minute, viewers_max, dead_seconds) VALUES (?, ?, ?)
         ON CONFLICT(minute) DO UPDATE SET viewers_max = MAX(viewers_max, excluded.viewers_max), dead_seconds = dead_seconds + excluded.dead_seconds`,
      )
      .run(minute, viewers, viewers > 0 && !onAir ? 1 : 0);
  }

  report(now: number) {
    const since = now - DAY;
    const q = <T>(sql: string, ...args: unknown[]) => this.db.prepare(sql).all(...args) as T[];
    const one = <T>(sql: string, ...args: unknown[]) => this.db.prepare(sql).get(...args) as T;

    // Airtime mix over the last 24h, clipped to the window.
    const segs = q<{ start_at: number; end_at: number; kind: string; writer: string }>(
      "SELECT start_at, end_at, kind, json_extract(body, '$.writer') AS writer FROM segments WHERE end_at > ? AND start_at < ?",
      since,
      now,
    );
    const mix: Record<string, number> = { fresh: 0, music: 0, encores: 0, improv: 0, cards: 0 };
    for (const s of segs) {
      const ms = Math.min(s.end_at, now) - Math.max(s.start_at, since);
      if (ms <= 0) continue;
      const bucket = s.kind === "bumper" ? "cards" : s.kind === "rerun" ? "encores" : s.writer === "music" ? "music" : s.writer === "improv" ? "improv" : "fresh";
      mix[bucket] += ms;
    }

    // Writer performance over the last 24h.
    const attempts = q<{ writer: string; outcome: string; write_ms: number; voice_ms: number }>(
      "SELECT writer, outcome, write_ms, voice_ms FROM production_log WHERE at > ?",
      since,
    );
    const byWriter = new Map<string, { ok: number; failed: number; rejected: number; times: number[]; voice: number[] }>();
    for (const a of attempts) {
      const w = byWriter.get(a.writer) ?? { ok: 0, failed: 0, rejected: 0, times: [], voice: [] };
      w[a.outcome as "ok" | "failed" | "rejected"]++;
      if (a.outcome === "ok") {
        w.times.push(a.write_ms);
        w.voice.push(a.voice_ms);
      }
      byWriter.set(a.writer, w);
    }
    const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);
    const writers = [...byWriter.entries()].map(([writer, w]) => ({
      writer,
      ok: w.ok,
      failed: w.failed,
      rejected: w.rejected,
      medianMs: pct(w.times, 0.5),
      p90Ms: pct(w.times, 0.9),
      voiceMedianMs: pct(w.voice, 0.5),
    }));
    const recentWrites = q<{ at: number; writer: string; write_ms: number; voice_ms: number; show_id: string }>(
      "SELECT at, writer, write_ms, voice_ms, show_id FROM production_log WHERE outcome = 'ok' AND writer != 'improv' ORDER BY at DESC LIMIT 30",
    ).reverse();
    const lastHourWrites = recentWrites.filter((r) => r.at > now - 3_600_000).map((r) => r.write_ms);
    const errors = q<{ at: number; writer: string; outcome: string; detail: string; show_id: string }>(
      "SELECT at, writer, outcome, detail, show_id FROM production_log WHERE outcome != 'ok' ORDER BY at DESC LIMIT 10",
    );

    // Standards desk.
    const standards = q<{ show_id: string; verdict: string; n: number }>(
      "SELECT show_id, verdict, COUNT(*) AS n FROM standards_log WHERE at > ? GROUP BY show_id, verdict",
      since,
    );
    const standardsRecent = q<{ at: number; show_id: string; verdict: string; detail: string }>(
      "SELECT at, show_id, verdict, detail FROM standards_log ORDER BY at DESC LIMIT 15",
    );

    // Viewer mail.
    const mail = q<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM viewer_messages WHERE created_at > ? GROUP BY status", since);
    const mailRecent = q<{ created_at: number; handle: string; status: string; reason: string }>(
      "SELECT created_at, handle, status, reason FROM viewer_messages ORDER BY created_at DESC LIMIT 10",
    );

    // Spend.
    const spendToday = q<{ model: string; usd: number; input: number; output: number }>(
      "SELECT model, SUM(usd) AS usd, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input, SUM(output_tokens) AS output FROM usage WHERE at > ? GROUP BY model",
      since,
    );
    const spendWeek = q<{ day: string; usd: number }>("SELECT day, SUM(usd) AS usd FROM usage WHERE at > ? GROUP BY day ORDER BY day", now - 7 * DAY);

    // Dead air while people were watching.
    const air = one<{ dead: number; watched: number }>(
      "SELECT COALESCE(SUM(dead_seconds), 0) AS dead, COALESCE(SUM(CASE WHEN viewers_max > 0 THEN 1 ELSE 0 END), 0) AS watched FROM air_stats WHERE minute > ?",
      Math.floor(since / 60_000),
    );
    const votes = one<{ n: number }>("SELECT COUNT(*) AS n FROM votes WHERE at > ?", since).n;

    return {
      mixMs: mix,
      writers,
      recentWrites,
      lastHourMedianWriteMs: pct(lastHourWrites, 0.5),
      errors,
      standards,
      standardsRecent,
      mail,
      mailRecent,
      spendToday,
      spendWeek,
      deadAirSec: air.dead,
      watchedMinutes: air.watched,
      votes,
    };
  }
}
