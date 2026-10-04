import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { openDb } from "../src/server/db.js";
import { MemoryBank } from "../src/server/memory.js";
import { Producer, MIN_SEGMENT_MS, STANDBY_MS } from "../src/server/producer.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import type { Writer } from "../src/server/writers/script.js";
import { beat, script } from "./helpers.js";

const TZ = "UTC";
const noon = Date.UTC(2026, 9, 3, 10, 30); // pixel_heights, live

function producer(writers: Writer[]) {
  const db = openDb(":memory:");
  return new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), tts: new SilentTTS(), writers, timeZone: TZ });
}

const failing: Writer = { name: "broken", write: async () => { throw new Error("boom"); } };
const tooShort: Writer = { name: "terse", write: async () => ({ script: script([beat("victoria", "No.")]), writer: "terse" }) };

describe("producer", () => {
  it("lays cues end to end without overlap, inside the segment", async () => {
    const p = await producer([new ImprovWriter(7)]).produce(noon, slotAt(noon, TZ), { rerun: false });
    const s = p.segment;
    expect(s.kind).toBe("live");
    expect(s.cues.length).toBeGreaterThanOrEqual(4);
    let end = 0;
    for (const c of s.cues) {
      expect(c.t).toBeGreaterThanOrEqual(end);
      end = c.t + c.dur;
    }
    expect(end).toBeLessThan(s.durationMs);
    expect(s.durationMs).toBeLessThan(200_000);
    expect(new Set(s.cues.map((c) => c.speaker)).size).toBeGreaterThan(1);
  });

  it("falls through to the next writer when one fails or is rejected", async () => {
    const p = await producer([failing, tooShort, new ImprovWriter(1)]).produce(noon, slotAt(noon, TZ), { rerun: false });
    expect(p.segment.writer).toBe("improv");
  });

  it("airs a standby card rather than dead air when every writer fails", async () => {
    const p = await producer([failing]).produce(noon, slotAt(noon, TZ), { rerun: false });
    expect(p.segment).toMatchObject({ kind: "bumper", durationMs: STANDBY_MS });
  });

  it("fills the tail of a slot with a bumper instead of a truncated segment", async () => {
    const slot = slotAt(noon, TZ);
    const p = await producer([new ImprovWriter(1)]).produce(slot.endAt - MIN_SEGMENT_MS + 1000, slot, { rerun: false });
    expect(p.segment.kind).toBe("bumper");
    expect(p.segment.durationMs).toBe(MIN_SEGMENT_MS - 1000);
  });

  it("books a guest only for guest segments on the late show", async () => {
    const pr = producer([new ImprovWriter(1)]);
    const late = Date.UTC(2026, 9, 3, 23, 0);
    const slot = slotAt(late, TZ);
    const briefs = Array.from({ length: 40 }, (_, i) => pr.brief(late + i * 1000, slot, 60));
    for (const b of briefs) {
      expect(Boolean(b.guest)).toBe(b.segmentType.includes("guest"));
      expect(b.cast.map((c) => c.id).slice(0, 2)).toEqual(["rex", "deedee"]);
    }
    expect(briefs.some((b) => b.guest)).toBe(true);
  });

  it("rotates topic seeds so consecutive scenes of a show don't reuse one", async () => {
    const db = openDb(":memory:");
    const timeline = new Timeline(db);
    const p = new Producer({ timeline, memory: new MemoryBank(db), tts: new SilentTTS(), writers: [new ImprovWriter(3)], timeZone: TZ });
    let t = noon;
    const topics: string[] = [];
    for (let i = 0; i < 6; i++) {
      const made = await p.produce(t, slotAt(t, TZ), { rerun: false });
      made.segment.startAt = t;
      timeline.append(made.segment, made.summary);
      topics.push(made.segment.topic ?? "");
      t += made.segment.durationMs;
    }
    for (let i = 1; i < topics.length; i++) expect(topics.slice(Math.max(0, i - 4), i)).not.toContain(topics[i]);
  });
});
