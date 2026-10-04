import { describe, expect, it } from "vitest";
import { getCharacter } from "../src/server/catalog/characters.js";
import { slotAt, GRID } from "../src/server/catalog/schedule.js";
import { getShow } from "../src/server/catalog/shows.js";
import { openDb } from "../src/server/db.js";
import { MemoryBank } from "../src/server/memory.js";
import { Producer } from "../src/server/producer.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { beat, script } from "./helpers.js";

const producer = () => {
  const db = openDb(":memory:");
  return new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), tts: new SilentTTS(), writers: [new ImprovWriter(3)], timeZone: "UTC" });
};

describe("sitcom and cartoon", () => {
  it("both shows are on the grid, with a primetime block", () => {
    const shows = new Set(GRID.map((s) => s.showId));
    expect(shows.has("nada") && shows.has("pixelsons")).toBe(true);
    expect(slotAt(Date.UTC(2026, 9, 3, 19, 30), "UTC").showId).toBe("pixelsons");
    expect(slotAt(Date.UTC(2026, 9, 3, 20, 30), "UTC").showId).toBe("nada");
  });

  it("scenes play on their own sets and stand-up is solo", () => {
    const p = producer();
    const at = Date.UTC(2026, 9, 3, 12, 0);
    const briefs = Array.from({ length: 60 }, (_, i) => p.brief(at + i * 1000, slotAt(at, "UTC"), 60));
    const standup = briefs.find((b) => b.segmentType === "stand-up cold open")!;
    expect(standup.cast.map((c) => c.id)).toEqual(["jerome"]);
    const full = briefs.find((b) => b.segmentType === "apartment scene")!;
    expect(full.cast.map((c) => c.id).slice(0, 4)).toEqual(["jerome", "lenny", "margo", "dash"]);
  });

  it("assembles diner scenes on the diner set with laugh-track cues and room for the laugh", async () => {
    const p = producer();
    const show = getShow("nada");
    const cast = show.cast.map(getCharacter);
    const s = script([beat("jerome", "a"), { ...beat("lenny", "b"), laugh: true }, beat("margo", "c"), beat("dash", "d")]);
    const seg = await p.assemble(show, cast, s, "test", "diner scene");
    expect(seg.set).toBe("diner");
    expect(seg.cues.map((c) => c.laugh)).toEqual([false, true, false, false]);
    expect(seg.cues[2].t - (seg.cues[1].t + seg.cues[1].dur)).toBeGreaterThan(1000);
    expect((await p.assemble(show, cast, s, "test", "apartment scene")).set).toBe("sitcom_apartment");
  });

  it("shows without a laugh track never laugh, whatever the writer says", async () => {
    const p = producer();
    const show = getShow("pixelsons");
    const seg = await p.assemble(show, show.cast.map(getCharacter), script([{ ...beat("hank", "Woo-hoo!"), laugh: true }]), "test");
    expect(seg.cues[0].laugh).toBe(false);
    expect(seg.set).toBe("family_couch");
  });

  it("the improv troupe can write a solo stand-up set and marks sitcom punchlines", async () => {
    const p = producer();
    const at = Date.UTC(2026, 9, 3, 12, 0);
    let made = 0;
    for (let i = 0; i < 40 && made < 3; i++) {
      const out = await p.produce(at + i * 1000, slotAt(at, "UTC"), { rerun: false });
      if (out.segment.kind !== "live") continue;
      made++;
      expect(out.segment.cues.length).toBeGreaterThanOrEqual(4);
      expect(out.segment.cues.some((c) => c.laugh)).toBe(true);
    }
    expect(made).toBe(3);
  });
});
