import { describe, expect, it } from "vitest";
import { openDb } from "../src/server/db.js";
import { TopicDesk } from "../src/server/desk.js";
import { NewsFeeds, parseFeed } from "../src/server/newsfeeds.js";

const now = Date.UTC(2026, 9, 5, 18, 0);
const rss = (items: { title: string; link: string; desc?: string; ago?: number }[]) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><description>${i.desc ?? ""}</description><pubDate>${new Date(now - (i.ago ?? 3_600_000)).toUTCString()}</pubDate></item>`)
    .join("")}</channel></rss>`;

describe("real news feeds", () => {
  it("parses RSS items, decoding entities and CDATA", () => {
    const items = parseFeed(rss([{ title: "Raccoon &amp; friends visit a library", link: "https://x.test/a", desc: "&lt;p&gt;A raccoon&#39;s day out.&lt;/p&gt;" }]), "x.test");
    expect(items[0]).toMatchObject({ title: "Raccoon & friends visit a library", link: "https://x.test/a", site: "x.test" });
    expect(items[0].description).toContain("A raccoon's day out.");
  });

  it("adds light, fresh stories to the news desk; filters heavy and stale ones; never repeats", async () => {
    const db = openDb(":memory:");
    const desk = new TopicDesk(db, async (url) => {
      if (url.includes("blocked")) throw new Error("the page answered 403");
      return { url, title: "t", site: "s", description: "", publishedAt: "", text: "Full article text about the giant pumpkin." };
    });
    const feed = rss([
      { title: "Giant pumpkin sets a new record at the county fair", link: "https://x.test/pumpkin" },
      { title: "Three killed in highway crash", link: "https://x.test/crash" },
      { title: "Senator proposes new tax plan", link: "https://x.test/tax" },
      { title: "Old news: a duck learned to skateboard", link: "https://x.test/old", ago: 5 * 86_400_000 },
      { title: "Raccoon visits a museum", link: "https://x.test/blocked-raccoon", desc: "A raccoon wandered into the natural history museum on Tuesday, toured the dinosaur hall and left through the gift shop with a plush toy." },
    ]);
    const news = new NewsFeeds(db, { desk, feeds: ["https://x.test/feed"], perDay: 6, fetcher: async () => feed });
    const added = await news.poll(now);
    expect(added).toEqual(["Giant pumpkin sets a new record at the county fair", "Raccoon visits a museum"]);
    const topics = desk.list().filter((t) => t.origin === "feed");
    expect(topics.every((t) => t.showId === "news" && t.fetchStatus === "ok")).toBe(true);
    // The museum page wouldn't load: the feed's summary stands in as the source.
    expect(topics.find((t) => t.text.startsWith("Raccoon"))?.source?.text).toMatch(/gift shop/);
    expect(await news.poll(now + 3_600_000)).toEqual([]); // already seen
  });

  it("drops a story whose page won't load and whose summary is too thin to fact-check against", async () => {
    const db = openDb(":memory:");
    const desk = new TopicDesk(db, async () => { throw new Error("403"); });
    const news = new NewsFeeds(db, { desk, feeds: ["https://x.test/feed"], perDay: 6, fetcher: async () => rss([{ title: "Cat elected mayor of tiny village", link: "https://x.test/cat", desc: "Short." }]) });
    expect(await news.poll(now)).toEqual([]);
    expect(desk.list()).toHaveLength(0);
  });
});
