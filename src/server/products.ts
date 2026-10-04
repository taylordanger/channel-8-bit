import type { DB } from "./db.js";
import { readSource, SourceError, type Source } from "./sources.js";

export interface Product {
  id: number;
  url: string;
  asin: string | null;
  title: string;
  notes: string;
  source: Source | null;
  fetchStatus: "pending" | "ok" | "failed";
  fetchError: string | null;
  active: boolean;
  createdAt: number;
  airs: number;
  lastAired: number | null;
}

interface Row {
  id: number;
  url: string;
  asin: string | null;
  title: string;
  notes: string;
  source: string | null;
  fetch_status: Product["fetchStatus"];
  fetch_error: string | null;
  active: number;
  created_at: number;
  airs: number;
  last_aired: number | null;
}

const toProduct = (r: Row): Product => ({
  id: r.id,
  url: r.url,
  asin: r.asin,
  title: r.title,
  notes: r.notes,
  source: r.source ? (JSON.parse(r.source) as Source) : null,
  fetchStatus: r.fetch_status,
  fetchError: r.fetch_error,
  active: Boolean(r.active),
  createdAt: r.created_at,
  airs: r.airs,
  lastAired: r.last_aired,
});

export const AMAZON_DISCLOSURE = "As an Amazon Associate, Channel 8-Bit earns from qualifying purchases.";

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]{2,6}$|(^|\.)amzn\.(to|com|eu)$|(^|\.)a\.co$/i;

/** Only Amazon links - this is the affiliate program we're set up for. */
export function isAmazonUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && AMAZON_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export function asinOf(raw: string): string | null {
  const m = raw.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?=[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * The link viewers are sent to: a clean product URL carrying the operator's Associates tag
 * (the tag is what makes purchases count).
 */
export function affiliateLink(product: Pick<Product, "url" | "asin">, tag: string): string {
  const base = product.asin ? `https://www.amazon.com/dp/${product.asin}` : product.url;
  if (!tag) return base;
  const u = new URL(base);
  u.searchParams.set("tag", tag);
  return u.toString();
}

/**
 * The commercial shelf: products the operator chose. Listings are read in the background
 * (Amazon often blocks automated reads, so the operator's own notes are the fallback).
 */
export class ProductShelf {
  constructor(
    private db: DB,
    private reader: (url: string) => Promise<Source> = (u) => readSource(u),
  ) {}

  add(url: string, title: string, notes: string, at: number): Product | string {
    const link = url.trim();
    if (!isAmazonUrl(link)) return "paste an Amazon product link";
    const info = this.db
      .prepare("INSERT INTO products (url, asin, title, notes, created_at) VALUES (?,?,?,?,?)")
      .run(link, asinOf(link), title.replace(/\s+/g, " ").trim().slice(0, 120), notes.replace(/\s+/g, " ").trim().slice(0, 600), at);
    return this.get(Number(info.lastInsertRowid))!;
  }

  /** Try to read the listing; failures are fine if the operator gave a name. */
  async ingest(id: number): Promise<Product | undefined> {
    const p = this.get(id);
    if (!p) return p;
    try {
      const src = await this.reader(p.url);
      // Robot-check pages aren't listings.
      if (/robot|captcha|enter the characters/i.test(src.title + src.text.slice(0, 400))) throw new SourceError("Amazon asked for a captcha");
      const cleanTitle = src.title.replace(/^Amazon\.com\s*:\s*/i, "").replace(/\s*:\s*[^:]+$/, "").slice(0, 120);
      this.db
        .prepare("UPDATE products SET source = ?, fetch_status = 'ok', fetch_error = NULL, title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?")
        .run(JSON.stringify(src), cleanTitle, id);
    } catch (e) {
      this.db.prepare("UPDATE products SET fetch_status = 'failed', fetch_error = ? WHERE id = ?").run((e as Error).message.slice(0, 200), id);
    }
    return this.get(id);
  }

  get(id: number): Product | undefined {
    const r = this.db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Row | undefined;
    return r ? toProduct(r) : undefined;
  }

  list(): Product[] {
    return (this.db.prepare("SELECT * FROM products ORDER BY created_at DESC").all() as Row[]).map(toProduct);
  }

  setActive(id: number, active: boolean): boolean {
    return this.db.prepare("UPDATE products SET active = ? WHERE id = ?").run(active ? 1 : 0, id).changes > 0;
  }

  remove(id: number): boolean {
    return this.db.prepare("DELETE FROM products WHERE id = ?").run(id).changes > 0;
  }

  /**
   * The next product to advertise: active, with something to say about it (a readable listing,
   * or a name plus the operator's notes), least recently aired first.
   */
  next(): Product | undefined {
    return this.list()
      .filter((p) => p.active && p.title && (p.fetchStatus === "ok" || (p.fetchStatus === "failed" && p.notes)))
      .sort((a, b) => (a.lastAired ?? 0) - (b.lastAired ?? 0))[0];
  }

  /** What the writers may treat as facts: the listing, or the operator's notes. */
  factsFor(p: Product): Source {
    if (p.source) return { ...p.source, title: p.title || p.source.title, description: [p.notes, p.source.description].filter(Boolean).join(" ") };
    return { url: p.url, title: p.title, site: "Amazon", description: p.notes, publishedAt: "", text: p.notes };
  }

  aired(id: number, at: number): void {
    this.db.prepare("UPDATE products SET airs = airs + 1, last_aired = ? WHERE id = ?").run(at, id);
  }

  click(id: number, at: number): boolean {
    if (!this.get(id)) return false;
    this.db.prepare("INSERT INTO ad_clicks (product_id, at) VALUES (?, ?)").run(id, at);
    return true;
  }

  stats(since: number): { id: number; title: string; airs: number; clicks: number }[] {
    return this.db
      .prepare(
        `SELECT p.id, p.title, p.airs, (SELECT COUNT(*) FROM ad_clicks c WHERE c.product_id = p.id AND c.at > ?) AS clicks
           FROM products p ORDER BY clicks DESC, p.airs DESC`,
      )
      .all(since) as { id: number; title: string; airs: number; clicks: number }[];
  }
}
