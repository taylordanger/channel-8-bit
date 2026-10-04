import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { openDb } from "../src/server/db.js";
import { MemoryBank } from "../src/server/memory.js";
import { checkNoPrices, Producer } from "../src/server/producer.js";
import { affiliateLink, asinOf, isAmazonUrl, ProductShelf } from "../src/server/products.js";
import { checkInvariants } from "../src/server/shadow.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { beat, script } from "./helpers.js";

const URL1 = "https://www.amazon.com/Desk-Flamingo-Tiny-Pink/dp/B0ABCDEF12/ref=sr_1_3?keywords=flamingo";
const blocked = async () => {
  throw new Error("the page answered 503");
};

describe("affiliate links", () => {
  it("recognizes Amazon links, pulls the ASIN, and tags a clean link", () => {
    expect(isAmazonUrl(URL1)).toBe(true);
    expect(isAmazonUrl("https://amzn.to/3xyz")).toBe(true);
    expect(isAmazonUrl("https://evil.com/amazon.com/dp/B0ABCDEF12")).toBe(false);
    expect(isAmazonUrl("javascript:alert(1)")).toBe(false);
    expect(asinOf(URL1)).toBe("B0ABCDEF12");
    expect(affiliateLink({ url: URL1, asin: "B0ABCDEF12" }, "myname-20")).toBe("https://www.amazon.com/dp/B0ABCDEF12?tag=myname-20");
    expect(affiliateLink({ url: "https://amzn.to/3xyz", asin: null }, "")).toBe("https://amzn.to/3xyz");
  });
});

describe("the product shelf", () => {
  it("falls back to the operator's notes when Amazon blocks the read, and rotates products", async () => {
    const shelf = new ProductShelf(openDb(":memory:"), blocked);
    expect(shelf.add("https://example.com/thing", "", "", 0)).toBe("paste an Amazon product link");
    const a = shelf.add(URL1, "Tiny Desk Flamingo", "A pink plastic flamingo that stands on one leg on your desk.", 1) as { id: number };
    const b = shelf.add("https://www.amazon.com/dp/B0ZZZZZZZZ", "", "", 2) as { id: number };
    await shelf.ingest(a.id);
    await shelf.ingest(b.id);
    expect(shelf.get(a.id)?.fetchStatus).toBe("failed");
    expect(shelf.next()?.id).toBe(a.id); // b has no name or notes: never advertised
    expect(shelf.factsFor(shelf.get(a.id)!).text).toContain("stands on one leg");
    shelf.aired(a.id, 10);
    expect(shelf.next()?.id).toBe(a.id); // still the only eligible one
    shelf.setActive(a.id, false);
    expect(shelf.next()).toBeUndefined();
  });

  it("reads a listing when it can, and refuses captcha pages as listings", async () => {
    const page = { url: URL1, title: "Amazon.com : Tiny Desk Flamingo, 2 Pack : Office Products", site: "Amazon", description: "", publishedAt: "", text: "Stands on one leg. Made of ABS plastic." };
    const ok = new ProductShelf(openDb(":memory:"), async () => page);
    const p = ok.add(URL1, "", "", 0) as { id: number };
    expect((await ok.ingest(p.id))?.title).toBe("Tiny Desk Flamingo, 2 Pack");
    const captcha = new ProductShelf(openDb(":memory:"), async () => ({ ...page, title: "Robot Check", text: "Enter the characters you see below" }));
    const q = captcha.add(URL1, "", "", 0) as { id: number };
    expect((await captcha.ingest(q.id))?.fetchStatus).toBe("failed");
  });
});

describe("commercials", () => {
  it("never mention prices or deals", () => {
    const r = checkNoPrices(
      script([
        beat("vance", "It stands on one leg!"),
        beat("greg", "Only $9.99? Wow."),
        beat("vance", "And it's 20 percent off!"),
        beat("greg", "Free shipping too!"),
        beat("vance", "Find it at the link!"),
        beat("greg", "I love it."),
      ]),
    );
    expect(r.script.beats.map((b) => b.line)).toEqual(["It stands on one leg!", "Find it at the link!", "I love it."]);
  });

  it("break into shows every few minutes with a labeled, linked infomercial", async () => {
    const db = openDb(":memory:");
    const products = new ProductShelf(db, blocked);
    const timeline = new Timeline(db);
    const p = new Producer({ timeline, memory: new MemoryBank(db), products, adEveryMin: 10, tts: new SilentTTS(), writers: [new ImprovWriter(4)], timeZone: "UTC" });
    const t = Date.UTC(2026, 9, 3, 15, 20); // couch_coop, 20 min into the slot
    const slot = slotAt(t, "UTC");
    expect(p.adDue(t, slot)).toBe(false); // nothing on the shelf
    const prod = products.add(URL1, "Tiny Desk Flamingo", "A pink plastic flamingo that stands on one leg on your desk.", 0) as { id: number };
    await products.ingest(prod.id);
    expect(p.adDue(t, slot)).toBe(true);
    expect(p.adDue(slot.startAt + 60_000, slot)).toBe(false); // let the show get going first
    const made = await p.produce(t, slot, { rerun: false });
    const seg = made.segment;
    expect(seg.ad).toMatchObject({ productId: prod.id, title: "Tiny Desk Flamingo", link: `/go/${prod.id}` });
    expect(seg.ad!.disclosure).toMatch(/Amazon Associate/);
    expect(seg.set).toBe("commercial");
    expect(seg.cast[0].id).toBe("vance");
    expect(seg.cues.every((c) => !/\$\d/.test(c.text))).toBe(true);
    expect(products.get(prod.id)?.airs).toBe(1);
    seg.startAt = t;
    timeline.append(seg, "");
    expect(p.adDue(t + seg.durationMs, slot)).toBe(false); // one break, then wait
    expect(checkInvariants([seg], "UTC")).toEqual([]);
    // Never during a game show.
    const game = Date.UTC(2026, 9, 3, 13, 30);
    expect(p.adDue(game, slotAt(game, "UTC"))).toBe(false);
  });
});
