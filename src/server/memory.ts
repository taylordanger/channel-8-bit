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
