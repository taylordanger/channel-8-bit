import type { DB } from "./db.js";

export interface Topic {
  id: number;
  text: string;
  /** null = any show may take it. */
  showId: string | null;
  createdAt: number;
  uses: number;
  maxUses: number;
  lastUsedAt: number | null;
}

interface Row {
  id: number;
  text: string;
  show_id: string | null;
  created_at: number;
  uses: number;
  max_uses: number;
  last_used_at: number | null;
}

const toTopic = (r: Row): Topic => ({
  id: r.id,
  text: r.text,
  showId: r.show_id,
  createdAt: r.created_at,
  uses: r.uses,
  maxUses: r.max_uses,
  lastUsedAt: r.last_used_at,
});

export const MAX_TOPIC_LENGTH = 280;

/**
 * The assignment desk: things a human wants the network to talk about.
 * Each topic airs up to maxUses times, then retires. Writers get the
 * least-used, oldest topic that fits the show on air.
 */
export class TopicDesk {
  constructor(private db: DB) {}

  add(text: string, showId: string | null, maxUses: number, at: number): Topic {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH);
    if (!clean) throw new Error("topic is empty");
    const uses = Math.max(1, Math.min(10, Math.round(maxUses)));
    const info = this.db
      .prepare("INSERT INTO topics (text, show_id, created_at, max_uses) VALUES (?,?,?,?)")
      .run(clean, showId, at, uses);
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): Topic | undefined {
    const row = this.db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as Row | undefined;
    return row ? toTopic(row) : undefined;
  }

  /** Active topics first, newest first; then retired ones. */
  list(): Topic[] {
    return (this.db.prepare("SELECT * FROM topics ORDER BY (uses >= max_uses), created_at DESC LIMIT 200").all() as Row[]).map(toTopic);
  }

  remove(id: number): boolean {
    return this.db.prepare("DELETE FROM topics WHERE id = ?").run(id).changes > 0;
  }

  /** The topic the writers should cover next on this show, if any. */
  nextFor(showId: string): Topic | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM topics
          WHERE uses < max_uses AND (show_id IS NULL OR show_id = ?)
          ORDER BY uses ASC, (show_id IS NULL) ASC, created_at ASC
          LIMIT 1`,
      )
      .get(showId) as Row | undefined;
    return row ? toTopic(row) : undefined;
  }

  markUsed(id: number, at: number): void {
    this.db.prepare("UPDATE topics SET uses = uses + 1, last_used_at = ? WHERE id = ?").run(at, id);
  }
}
