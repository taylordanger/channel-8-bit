import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { buildStation } from "../src/server/build.js";
import { ManualClock } from "../src/server/clock.js";
import { loadConfig } from "../src/server/config.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import type { Writer, WriterBrief } from "../src/server/writers/script.js";

function station(bankWriter?: Writer) {
  const clock = new ManualClock(Date.UTC(2026, 9, 5, 10, 0)); // 3am Pacific: nobody watching
  const b = buildStation({ ...loadConfig({}), timeZone: "America/Los_Angeles", tts: "silent", writer: "improv", alwaysOnHours: new Set() }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [new ImprovWriter(1)], bankWriter });
  return { b, clock };
}

describe("overnight writers' room", () => {
  it("writes standalone scenes for the emptiest show while nobody watches; never games", async () => {
    const briefs: WriterBrief[] = [];
    const improv = new ImprovWriter(4);
    const writer: Writer = { name: "bankwriter", write: (br) => (briefs.push(br), improv.write(br)) };
    const { b } = station(writer);
    for (let i = 0; i < 12; i++) await b.station.bankTick(1);
    const counts = b.bank.counts();
    expect(counts.hot_seat).toBeUndefined();
    expect(Object.values(counts).every((n) => n === 1)).toBe(true);
    expect(Object.keys(counts).length).toBeGreaterThan(5);
    expect(briefs.every((br) => !br.deskTopicId && !br.viewerMessage && !br.episode && !br.chat)).toBe(true);
    expect(await b.station.bankTick(1)).toBe(false); // every bank full
  });

  it("doesn't bank while someone is watching", async () => {
    const { b, clock } = station({ name: "w", write: (br) => new ImprovWriter(1).write(br) });
    b.governor.setViewers(1, clock.now());
    expect(await b.station.bankTick()).toBe(false);
  });

  it("airs a banked scene (fresh, never aired) when the live writer falls behind, before any encore", async () => {
    const { b, clock } = station({ name: "w", write: (br) => new ImprovWriter(2).write(br) });
    const at = Date.UTC(2026, 9, 5, 21, 30); // Couch Co-op, 2:30pm Pacific
    clock.advance(at - clock.now());
    await b.producer.bankScene("couch_coop", at - 60_000);
    expect(b.bank.counts().couch_coop).toBe(1);
    const made = await b.producer.produce(at, slotAt(at, "America/Los_Angeles"), { rerun: false, hurry: true });
    expect(made.segment.kind).toBe("live");
    expect(made.segment.writer).toMatch(/\(banked\)$/);
    expect(b.bank.counts().couch_coop).toBeUndefined(); // used
  });
});
