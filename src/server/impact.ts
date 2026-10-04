import { CHARACTERS } from "./catalog/characters.js";
import { programAt, type Override } from "./catalog/schedule.js";
import { SHOWS, getShow } from "./catalog/shows.js";
import type { DB } from "./db.js";
import type { MailBag, ViewerMessage } from "./mailbag.js";

/** Something the audience caused, in words a viewer recognizes. */
export interface Impact {
  at: number;
  kind: "vote" | "game" | "mail";
  text: string;
}

const name = (id: string) => CHARACTERS[id]?.name ?? id;

/**
 * "Your votes did this": recent verdicts, champions, bookings and answered mail, newest first.
 * Only things viewers actually caused - a verdict the studio audience decided isn't listed.
 */
export function impactFeed(db: DB, mailbag: MailBag, now: number, limit = 8): Impact[] {
  const since = now - 24 * 3_600_000;
  const out: Impact[] = [];

  const polls = db
    .prepare(
      `SELECT p.show_id, p.question, p.options, p.winner, p.closes_at, COUNT(v.voter) AS votes
       FROM polls p LEFT JOIN votes v ON v.poll_id = p.id
       WHERE p.closed = 1 AND p.studio = 0 AND p.winner IS NOT NULL AND p.closes_at >= ?
       GROUP BY p.id ORDER BY p.closes_at DESC LIMIT 20`,
    )
    .all(since) as { show_id: string; question: string; options: string; winner: string; closes_at: number; votes: number }[];
  for (const p of polls) {
    const label = (JSON.parse(p.options) as { id: string; label: string }[]).find((o) => o.id === p.winner)?.label ?? name(p.winner);
    out.push({ at: p.closes_at, kind: "vote", text: `You voted ${label} the winner of "${p.question}" on ${SHOWS[p.show_id]?.title ?? p.show_id} (${p.votes} vote${p.votes === 1 ? "" : "s"}).` });
  }

  const games = db
    .prepare(
      `SELECT g.show_id, g.at, g.champion, g.scores,
         (SELECT COUNT(*) FROM votes v JOIN polls p ON p.id = v.poll_id WHERE g.episode != '' AND p.episode = g.episode) AS votes
       FROM game_results g WHERE g.at >= ? ORDER BY g.at DESC LIMIT 5`,
    )
    .all(since) as { show_id: string; at: number; champion: string; scores: string; votes: number }[];
  for (const g of games) {
    if (!g.votes) continue; // the studio audience decided this one
    const scores = JSON.parse(g.scores) as Record<string, number>;
    const loser = Object.keys(scores).filter((id) => id !== g.champion).sort((a, b) => scores[a] - scores[b])[0];
    const title = SHOWS[g.show_id]?.title ?? g.show_id;
    const booker = Object.values(SHOWS).find((s) => s.bookLosersFrom === g.show_id);
    const host = booker ? name(booker.cast[0]) : "";
    let text = `Your votes crowned ${name(g.champion)} the ${title} champion.`;
    if (loser) text += ` ${name(loser)} came last${booker ? ` and has to face ${host} on ${booker.title}` : ""}.`;
    out.push({ at: g.at, kind: "game", text });
  }

  for (const m of mailbag.aired(since)) {
    out.push({ at: m.airedAt ?? m.createdAt, kind: "mail", text: `${m.handle}'s letter was answered on ${m.airedShow ? (SHOWS[m.airedShow]?.title ?? m.airedShow) : "the air"}.` });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** When a show that reads mail (a specific one, or any) is next on - or on now. */
export function nextMailAiring(showId: string | null, now: number, timeZone: string, override?: Override | null): { showId: string; startAt: number } | undefined {
  const reads = (id: string) => Boolean(getShow(id).mailSegment) && (!showId || id === showId);
  const current = programAt(now, timeZone, override);
  if (current.slot.mode === "live" && reads(current.showId)) return { showId: current.showId, startAt: current.startAt };
  for (let t = current.endAt; t < now + 48 * 3_600_000; ) {
    const slot = programAt(t, timeZone, override);
    if (slot.slot.mode === "live" && reads(slot.showId)) return { showId: slot.showId, startAt: slot.startAt };
    t = Math.max(slot.endAt, t + 60_000);
  }
  return undefined;
}

/** A viewer-facing status line for their own letter. */
export function mailStatus(m: ViewerMessage, mailbag: MailBag, now: number, timeZone: string, override?: Override | null): string {
  const clock = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(t));
  if (m.status === "aired") return `Answered on air ${m.airedAt ? clock(m.airedAt) : ""}${m.airedShow ? ` on ${SHOWS[m.airedShow]?.title ?? m.airedShow}` : ""}.`;
  if (m.status === "rejected") return "Not going to air this time.";
  if (m.status === "pending") return "Waiting for a producer to read it.";
  const ahead = mailbag.aheadOf(m);
  const next = nextMailAiring(m.showId, now, timeZone, override);
  const line = ahead === 0 ? "You're next in the mailbag" : `${ahead} letter${ahead === 1 ? "" : "s"} ahead of yours`;
  if (!next) return `${line}.`;
  const when = next.startAt <= now ? "on now" : `on ${clock(next.startAt)}`;
  return `${line} for ${SHOWS[next.showId].title} (${when}).`;
}
