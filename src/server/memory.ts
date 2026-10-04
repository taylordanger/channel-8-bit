import type { DB } from "./db.js";

export interface Memory {
  id: number;
  createdAt: number;
  showId: string;
  about: string[];
  text: string;
  weight: number;
}

export interface Relationship {
  a: string;
  b: string;
  score: number;
  note: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Long-term character state: what happened (memories), how characters feel about
 * each other (relationships), and where each serialized plot stands (story).
 * Memories cross shows - a guest who was humiliated on The Late Byte remembers it.
 */
export class MemoryBank {
  constructor(private db: DB) {}

  remember(showId: string, about: string[], text: string, weight: number, at: number): void {
    this.db
      .prepare("INSERT INTO memories (created_at, show_id, about, text, weight) VALUES (?,?,?,?,?)")
      .run(at, showId, JSON.stringify([...new Set(about)].sort()), text.trim(), clamp(weight, 0, 1));
  }

  /**
   * The memories most worth recalling for a set of characters: score = importance,
   * decayed by age (half-life ~3 days), so big moments linger and small ones fade.
   */
  recall(characterIds: string[], now: number, limit: number): Memory[] {
    const rows = this.db
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT 500")
      .all() as { id: number; created_at: number; show_id: string; about: string; text: string; weight: number }[];
    const want = new Set(characterIds);
    const halfLife = 3 * 86_400_000;
    return rows
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        showId: r.show_id,
        about: JSON.parse(r.about) as string[],
        text: r.text,
        weight: r.weight,
      }))
      .filter((m) => m.about.some((id) => want.has(id)))
      .map((m) => ({ m, score: m.weight * Math.pow(0.5, (now - m.createdAt) / halfLife) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, limit)
      .map((x) => x.m);
  }

  latest(limit: number): Memory[] {
    const rows = this.db.prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?").all(limit) as {
      id: number; created_at: number; show_id: string; about: string; text: string; weight: number;
    }[];
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, showId: r.show_id, about: JSON.parse(r.about) as string[], text: r.text, weight: r.weight }));
  }

  relationship(a: string, b: string): Relationship {
    const row = this.db.prepare("SELECT a, b, score, note FROM relationships WHERE a = ? AND b = ?").get(a, b) as
      | Relationship
      | undefined;
    return row ?? { a, b, score: 0, note: "" };
  }

  /** Nudge how a feels about b. Deltas are capped so one scene can't flip a relationship. */
  adjust(a: string, b: string, delta: number, note: string, at: number): void {
    if (a === b) return;
    const cur = this.relationship(a, b);
    const score = clamp(cur.score + clamp(delta, -25, 25), -100, 100);
    this.db
      .prepare(
        `INSERT INTO relationships (a, b, score, note, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(a, b) DO UPDATE SET score = excluded.score, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(a, b, score, note || cur.note, at);
  }

  /** Seed a relationship only if it doesn't exist yet (catalog defaults). */
  seed(a: string, b: string, score: number, note: string, at: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO relationships (a, b, score, note, updated_at) VALUES (?,?,?,?,?)")
      .run(a, b, score, note, at);
  }

  /** Pairs among `ids` where either side's feelings have sunk to feud level. */
  feuds(ids: string[]): { a: string; b: string; score: number }[] {
    const out: { a: string; b: string; score: number }[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const score = Math.min(this.relationship(ids[i], ids[j]).score, this.relationship(ids[j], ids[i]).score);
        if (score <= FEUD_SCORE) out.push({ a: ids[i], b: ids[j], score });
      }
    return out;
  }

  relationshipsAmong(ids: string[]): Relationship[] {
    const out: Relationship[] = [];
    for (const a of ids) for (const b of ids) if (a !== b) out.push(this.relationship(a, b));
    return out;
  }

  storyState(showId: string): string {
    const row = this.db.prepare("SELECT state FROM story WHERE show_id = ?").get(showId) as { state: string } | undefined;
    return row?.state ?? "";
  }

  setStoryState(showId: string, state: string, at: number): void {
    this.db
      .prepare(
        `INSERT INTO story (show_id, state, updated_at) VALUES (?,?,?)
         ON CONFLICT(show_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(showId, state.trim(), at);
  }
}

/** Moods fade on their own after this long unless a scene renews them. */
export const MOOD_TTL_MS = 6 * 3_600_000;
/** Relationship score at or below which two characters are in a feud. */
export const FEUD_SCORE = -60;
/** How many of that show's segments someone sits out after storming off. */
export const WALK_OFF_SEGMENTS = 2;
/** One storm-off per character per show per hour: any more and it stops meaning anything. */
export const WALK_OFF_COOLDOWN_MS = 3_600_000;

export interface CharacterMood {
  id: string;
  mood: string;
  reason: string;
  at: number;
}

interface StateRow {
  id: string;
  mood: string;
  mood_reason: string;
  mood_at: number;
  off_show: string | null;
  off_reason: string;
  off_remaining: number;
  owed_entrance: number;
}

/**
 * Lasting character state: moods that follow a character across shows, and walk-offs
 * that keep them off a show's set for a while. Lives alongside the memory bank.
 */
export class CharacterStates {
  constructor(private db: DB) {}

  private row(id: string): StateRow | undefined {
    return this.db.prepare("SELECT * FROM character_state WHERE id = ?").get(id) as StateRow | undefined;
  }

  private ensure(id: string) {
    this.db.prepare("INSERT OR IGNORE INTO character_state (id) VALUES (?)").run(id);
  }

  setMood(id: string, mood: string, reason: string, at: number): void {
    this.ensure(id);
    this.db.prepare("UPDATE character_state SET mood = ?, mood_reason = ?, mood_at = ? WHERE id = ?").run(mood, reason, at, id);
  }

  /** Current mood, or undefined if neutral or faded. */
  mood(id: string, now: number): CharacterMood | undefined {
    const r = this.row(id);
    if (!r || r.mood === "neutral" || now - r.mood_at > MOOD_TTL_MS) return undefined;
    return { id, mood: r.mood, reason: r.mood_reason, at: r.mood_at };
  }

  /**
   * Someone stormed off a show: they sit out its next few segments. Ignored (returns false)
   * if they're already off this show or stormed off it within the cooldown.
   */
  walkOff(id: string, showId: string, reason: string, segments = WALK_OFF_SEGMENTS, now = Date.now()): boolean {
    this.ensure(id);
    const r = this.db.prepare("SELECT off_show, off_remaining, owed_entrance, off_at FROM character_state WHERE id = ?").get(id) as {
      off_show: string | null; off_remaining: number; owed_entrance: number; off_at: number;
    };
    if (r.off_show === showId && (r.off_remaining > 0 || r.owed_entrance || now - r.off_at < WALK_OFF_COOLDOWN_MS)) return false;
    this.db
      .prepare("UPDATE character_state SET off_show = ?, off_reason = ?, off_remaining = ?, owed_entrance = 0, off_at = ? WHERE id = ?")
      .run(showId, reason, segments, now, id);
    return true;
  }

  offSet(showId: string): { id: string; reason: string; remaining: number }[] {
    return (this.db.prepare("SELECT * FROM character_state WHERE off_show = ? AND off_remaining > 0").all(showId) as StateRow[]).map((r) => ({
      id: r.id,
      reason: r.off_reason,
      remaining: r.off_remaining,
    }));
  }

  /** Characters who've served their time away from this show and are owed an entrance. */
  returning(showId: string): string[] {
    return (this.db.prepare("SELECT id FROM character_state WHERE off_show = ? AND owed_entrance = 1").all(showId) as { id: string }[]).map((r) => r.id);
  }

  /** A segment of this show aired: absences count down; whoever reaches zero comes back next time. */
  segmentAired(showId: string, appearedIds: string[]): void {
    this.db.prepare("UPDATE character_state SET off_remaining = off_remaining - 1 WHERE off_show = ? AND off_remaining > 0").run(showId);
    this.db.prepare("UPDATE character_state SET owed_entrance = 1 WHERE off_show = ? AND off_remaining = 0 AND owed_entrance = 0 AND off_reason != ''").run(showId);
    // Once they've made their entrance, the walk-off is over.
    for (const id of appearedIds)
      this.db.prepare("UPDATE character_state SET owed_entrance = 0, off_reason = '' WHERE id = ? AND off_show = ? AND owed_entrance = 1").run(id, showId);
  }

  all(now: number): (CharacterMood & { offShow: string | null; offRemaining: number; returning: boolean })[] {
    return (this.db.prepare("SELECT * FROM character_state").all() as StateRow[]).map((r) => ({
      id: r.id,
      mood: r.mood !== "neutral" && now - r.mood_at <= MOOD_TTL_MS ? r.mood : "neutral",
      reason: r.mood_reason,
      at: r.mood_at,
      offShow: r.off_remaining > 0 || r.owed_entrance ? r.off_show : null,
      offRemaining: r.off_remaining,
      returning: Boolean(r.owed_entrance),
    }));
  }
}

/** Starting relationships so the very first episodes already have friction. */
export const SEED_RELATIONSHIPS: [string, string, number, string][] = [
  ["rex", "deedee", 20, "needs her, would never admit it"],
  ["deedee", "rex", -10, "thinks he's a fraud; secretly writes his jokes"],
  ["greg", "sunny", -35, "she stole his weather segment"],
  ["sunny", "greg", 30, "refuses to acknowledge the feud"],
  ["pip", "greg", 40, "idolizes him for reasons nobody understands"],
  ["victoria", "lola", -40, "suspects she is a plant"],
  ["lola", "victoria", -60, "has a score to settle"],
  ["dante", "lola", 55, "old flame, still burning"],
  ["victoria", "dante", 35, "loves him as an asset"],
  ["marcus", "victoria", 10, "trusts her, which is a mistake"],
  ["marisol", "kev", -15, "his nostalgia is a weakness"],
  ["kev", "marisol", 25, "respects her, fears her"],
  ["tony", "kev", 60, "cousin; loves the snacks"],
];
