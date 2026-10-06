import { z } from "zod";
import type { DB } from "./db.js";
import type { TopicDesk } from "./desk.js";
import { assertPublicUrl, type Source } from "./sources.js";
import type { OllamaClient } from "./writers/ollama.js";

/**
 * Real news for The 8-Bit Report, from feeds that suit a comedy news desk: odd news, science,
 * space. Each story is screened (a word filter, then the local model) so tragedy, crime,
 * politics and health claims never become a comedy bit, then lands on the assignment desk as a
 * sourced topic - so it's fact-checked against the article like any link a human pastes.
 */

export const DEFAULT_FEEDS = [
  "https://www.sciencedaily.com/rss/strange_offbeat.xml",
  "https://rss.upi.com/news/odd_news.rss",
  "https://www.nasa.gov/feed/",
  "https://phys.org/rss-feed/",
];

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  publishedAt: number;
  site: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/** The items of an RSS feed (title, link, summary, date). */
export function parseFeed(xml: string, site: string): FeedItem[] {
  return xml
    .split(/<item[\s>]/)
    .slice(1)
    .map((block) => {
      const tag = (name: string) => decode((block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) ?? [])[1] ?? "");
      const date = Date.parse(tag("pubDate") || tag("dc:date"));
      return { title: tag("title"), link: tag("link"), description: tag("description").slice(0, 1200), publishedAt: Number.isNaN(date) ? 0 : date, site };
    })
    .filter((i) => i.title && /^https:\/\//.test(i.link));
}

/** Obvious no-gos for a comedy news desk; the model screen catches the subtler ones. */
const HEAVY =
  /\b(kill(s|ed|ing)?|dead|deaths?|dies|died|dying|murder\w*|shoot\w*|shot|stabb\w*|war|wars|attack\w*|bomb\w*|terror\w*|hostage|crash(es|ed)?|victims?|disaster\w*|earthquake|flood\w*|wildfire|hurricane|tornado|police|arrest\w*|charged|trial|court|lawsuit|sentenced|prison|jail|elections?|president|senator|congress|parliament|minister|government|politic\w*|protest\w*|abortion|suicide|abuse\w*|assault\w*|cancer|disease|outbreak|virus|pandemic|overdose|drugs?|refugees?|genocide|gaza|israel|ukraine|russia|china|iran|trump|biden)\b/i;

const ScreenSchema = z.object({ suitable: z.boolean(), reason: z.string() });
const SCREEN_PROMPT = `You pick real news stories for a light comedy news parody on a fictional pixel-art TV network. A story is SUITABLE only if it's harmless fun to joke about: odd news, quirky animals, space, science discoveries, inventions, games, records, weird food. It is NOT suitable if it involves death, injury, illness or health/medical/diet claims, crime, courts, politics or government, war, disasters, religion or social controversy, or a private person's misfortune. When unsure, it is not suitable. Reply with JSON.`;

export interface NewsFeedDeps {
  desk: TopicDesk;
  feeds: string[];
  /** The local model screens each candidate; without it, only the word filter runs. */
  ollama?: OllamaClient;
  /** Stories added to the desk per day, at most. */
  perDay: number;
  fetcher?: (url: string) => Promise<string>;
  log?: (m: string) => void;
}

const defaultFetcher = async (url: string) => {
  await assertPublicUrl(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Mozilla/5.0 (compatible; Channel8BitNews/1.0)" } });
  if (!res.ok) throw new Error(`feed answered ${res.status}`);
  return (await res.text()).slice(0, 2_000_000);
};

export class NewsFeeds {
  private timer?: NodeJS.Timeout;

  constructor(
    private db: DB,
    private d: NewsFeedDeps,
  ) {}

  /** Check the feeds now, then every three hours. */
  start(): void {
    const run = () => void this.poll(Date.now()).catch((e: Error) => this.d.log?.(`news feeds: ${e.message}`));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, 3 * 3_600_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fetch, screen and add up to a few fresh stories. Returns what was added. */
  async poll(now: number): Promise<string[]> {
    const addedToday = (this.db.prepare("SELECT COUNT(*) AS n FROM news_seen WHERE accepted = 1 AND at > ?").get(now - 86_400_000) as { n: number }).n;
    let room = Math.min(2, this.d.perDay - addedToday);
    // Keep the queue short: stories go stale.
    const waiting = (this.db.prepare("SELECT COUNT(*) AS n FROM topics WHERE origin = 'feed' AND uses < max_uses").get() as { n: number }).n;
    room = Math.min(room, 4 - waiting);
    if (room <= 0) return [];

    const items: FeedItem[] = [];
    for (const url of this.d.feeds) {
      try {
        items.push(...parseFeed(await (this.d.fetcher ?? defaultFetcher)(url), new URL(url).hostname.replace(/^(www|rss)\./, "")));
      } catch (e) {
        this.d.log?.(`news feed ${url}: ${(e as Error).message}`);
      }
    }
    const seen = this.db.prepare("SELECT 1 FROM news_seen WHERE url = ?");
    const fresh = items
      .filter((i) => now - i.publishedAt < 48 * 3_600_000 && !seen.get(i.link))
      .sort((a, b) => b.publishedAt - a.publishedAt);
    // Alternate between feeds so one site doesn't fill the newscast.
    const bySite = new Map<string, FeedItem[]>();
    for (const i of fresh) bySite.set(i.site, [...(bySite.get(i.site) ?? []), i]);
    const queue: FeedItem[] = [];
    while ([...bySite.values()].some((l) => l.length)) for (const l of bySite.values()) if (l.length) queue.push(l.shift()!);

    const added: string[] = [];
    const remember = this.db.prepare("INSERT OR IGNORE INTO news_seen (url, at, accepted, reason) VALUES (?,?,?,?)");
    for (const item of queue.slice(0, 12)) {
      if (added.length >= room) break;
      const text = `${item.title} ${item.description}`;
      if (HEAVY.test(text)) {
        remember.run(item.link, now, 0, "word filter");
        continue;
      }
      const verdict = await this.screen(item);
      remember.run(item.link, now, verdict.suitable ? 1 : 0, verdict.reason.slice(0, 120));
      if (!verdict.suitable) continue;
      const topic = this.d.desk.add(item.title, "news", 2, now, item.link, "feed");
      const read = await this.d.desk.ingest(topic.id);
      // Some sites won't let us read the article; the feed's own summary can stand in as the
      // source if it's substantial (the cast may then only state what the summary says).
      if (read?.fetchStatus !== "ok") {
        if (item.description.length >= 120) {
          const source: Source = { url: item.link, title: item.title, site: item.site, description: item.description, publishedAt: new Date(item.publishedAt).toISOString(), text: item.description };
          this.d.desk.setSource(topic.id, source);
        } else {
          this.d.desk.remove(topic.id);
          continue;
        }
      }
      added.push(item.title);
      this.d.log?.(`news desk: added "${item.title}" (${item.site})`);
    }
    return added;
  }

  private async screen(item: FeedItem): Promise<{ suitable: boolean; reason: string }> {
    if (!this.d.ollama) return { suitable: true, reason: "word filter only" };
    try {
      return await this.d.ollama.chat(SCREEN_PROMPT, `HEADLINE: ${item.title}\nSUMMARY: ${item.description.slice(0, 600)}`, ScreenSchema, { temperature: 0 });
    } catch {
      return { suitable: false, reason: "screen unavailable" };
    }
  }
}
