import type { DB } from "./db.js";
import { readSource, SourceError, type Source } from "./sources.js";

export type FetchStatus = "none" | "pending" | "ok" | "failed";

export interface Topic {
  id: number;
  text: string;
  /** null = any show may take it. */
  showId: string | null;
  createdAt: number;
  uses: number;
  maxUses: number;
  lastUsedAt: number | null;
  url: string | null;
  source: Source | null;
  fetchStatus: FetchStatus;
  fetchError: string | null;
  /** "desk" for a human's topic, "feed" for a story the news feeds found. */
  origin: "desk" | "feed";
}

interface Row {
  id: number;
  text: string;
  show_id: string | null;
  created_at: number;
  uses: number;
  max_uses: number;
  last_used_at: number | null;
  url: string | null;
  source: string | null;
  fetch_status: FetchStatus;
  fetch_error: string | null;
  origin: "desk" | "feed" | null;
}

const toTopic = (r: Row): Topic => ({
  id: r.id,
  text: r.text,
  showId: r.show_id,
  createdAt: r.created_at,
  uses: r.uses,
  maxUses: r.max_uses,
  lastUsedAt: r.last_used_at,
  url: r.url,
  source: r.source ? (JSON.parse(r.source) as Source) : null,
  fetchStatus: r.fetch_status,
  fetchError: r.fetch_error,
  origin: r.origin ?? "desk",
});

export const MAX_TOPIC_LENGTH = 280;

/**
 * The assignment desk: things a human wants the network to talk about.
 * A topic is a prompt, a link, or both. Links are read in the background; a topic
 * only reaches the writers once its page has been read successfully.
 * Each topic airs up to maxUses times, then retires.
 */
export class TopicDesk {
  constructor(
    private db: DB,
    private reader: (url: string) => Promise<Source> = (u) => readSource(u),
  ) {}

  add(text: string, showId: string | null, maxUses: number, at: number, url?: string | null, origin: "desk" | "feed" = "desk"): Topic {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LENGTH);
    const link = url?.trim() || null;
    if (!clean && !link) throw new Error("add a topic or a link");
    const uses = Math.max(1, Math.min(10, Math.round(maxUses)));
    const info = this.db
      .prepare("INSERT INTO topics (text, show_id, created_at, max_uses, url, fetch_status, origin) VALUES (?,?,?,?,?,?,?)")
      .run(clean, showId, at, uses, link, link ? "pending" : "none", origin);
    return this.get(Number(info.lastInsertRowid))!;
  }

  /** Use this as the topic's source (e.g. a news feed's summary when the page itself won't load). */
  setSource(id: number, source: Source): void {
    this.db.prepare("UPDATE topics SET source = ?, fetch_status = 'ok', fetch_error = NULL WHERE id = ?").run(JSON.stringify(source), id);
  }

  /** Read a topic's link and store what was found. Never throws; failures are recorded on the topic. */
  async ingest(id: number): Promise<Topic | undefined> {
    const t = this.get(id);
    if (!t?.url) return t;
    try {
      const source = await this.reader(t.url);
      this.db
        .prepare("UPDATE topics SET source = ?, fetch_status = 'ok', fetch_error = NULL, text = CASE WHEN text = '' THEN ? ELSE text END WHERE id = ?")
        .run(JSON.stringify(source), source.title.slice(0, MAX_TOPIC_LENGTH) || source.site, id);
    } catch (e) {
      const msg = e instanceof SourceError ? e.message : `couldn't read the page (${(e as Error).message})`;
      this.db.prepare("UPDATE topics SET fetch_status = 'failed', fetch_error = ? WHERE id = ?").run(msg, id);
    }
    return this.get(id);
  }

  /** Links left half-read by a restart. */
  pending(): Topic[] {
    return (this.db.prepare("SELECT * FROM topics WHERE fetch_status = 'pending'").all() as Row[]).map(toTopic);
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

  /** The topic the writers should cover next on this show, if any. Unread links wait. */
  nextFor(showId: string): Topic | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM topics
          WHERE uses < max_uses AND fetch_status IN ('none', 'ok') AND (show_id IS NULL OR show_id = ?)
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
