import { describe, expect, it } from "vitest";
import { runShadow } from "../src/server/shadow.js";

// The release gate: a whole simulated day through the real pipeline.
const start = Date.UTC(2026, 9, 3, 7, 0);

describe("shadow station", () => {
  it("airs a full day with no invariant violations and every show on schedule", async () => {
    const r = await runShadow({ startAt: start, hours: 24, config: { timeZone: "UTC" } });
    expect(r.violations).toEqual([]);
    expect(Object.keys(r.byShow)).toEqual(expect.arrayContaining(["late_byte", "rise_and_pixel", "pixel_heights", "couch_coop"]));
    expect(r.deadAirSec).toBeLessThanOrEqual(10);
    expect(r.byKind.rerun).toBeGreaterThan(0); // overnight encores
  }, 60_000);

  it("writes nothing while nobody watches and recovers quickly when they return", async () => {
    // Watching only from 12:00 to 13:00 and 18:00 to 19:00.
    const watching = (t: number) => {
      const h = new Date(t).getUTCHours();
      return h === 12 || h === 18 ? 1 : 0;
    };
    const r = await runShadow({ startAt: start, hours: 14, viewersAt: watching, config: { timeZone: "UTC" } });
    expect(r.violations).toEqual([]);
    expect(r.producedWhileIdle).toBe(0);
    expect(r.segments).toBeLessThan(80); // ~2 watched hours, not 14
    expect(r.deadAirSec).toBeLessThanOrEqual(15);
  }, 60_000);

  it("survives a writer that fails every other call", async () => {
    let n = 0;
    const flaky = {
      name: "flaky",
      write: async () => {
        throw new Error(`flake ${n++}`);
      },
    };
    const { ImprovWriter } = await import("../src/server/writers/improv.js");
    const r = await runShadow({ startAt: start, hours: 4, writers: [flaky, new ImprovWriter(3)], config: { timeZone: "UTC" } });
    expect(r.violations).toEqual([]);
    expect(r.deadAirSec).toBeLessThanOrEqual(10);
  }, 60_000);
});

describe("slow writers", () => {
  it("a writer that takes twice a segment's air time still gets fresh segments on air, with encores filling the gaps", async () => {
    const { ManualClock } = await import("../src/server/clock.js");
    const { buildStation } = await import("../src/server/build.js");
    const { loadConfig } = await import("../src/server/config.js");
    const { SilentTTS } = await import("../src/server/tts.js");
    const { ImprovWriter } = await import("../src/server/writers/improv.js");
    const clock = new ManualClock(Date.UTC(2026, 9, 3, 11, 0));
    const fast = new ImprovWriter(9);
    // A "local model": writes like improv but takes 140s of station time per segment. That pushes
    // the encore threshold (~172s) above the base lead target (150s) - the bug that once aired
    // nothing but encores.
    const slow = {
      name: "slowpoke",
      write: async (b: Parameters<InstanceType<typeof ImprovWriter>["write"]>[0]) => {
        const r = await fast.write(b);
        clock.advance(140_000);
        // Short segments, like the local model's (~45s), so encores of older long segments dominate if pacing is wrong.
        return { script: { ...r.script, beats: r.script.beats.slice(0, 6), summary: "s" }, writer: "slowpoke" };
      },
    };
    const b = buildStation({ ...loadConfig({}), timeZone: "UTC", tts: "silent", writer: "improv" }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [slow, new ImprovWriter(4)] });
    // Like the real station: a big archive of older improv segments, so encores are always available.
    const { Producer } = await import("../src/server/producer.js");
    const { slotAt } = await import("../src/server/catalog/schedule.js");
    const archivist = new Producer({ timeline: b.timeline, memory: b.memory, tts: new SilentTTS(), writers: [new ImprovWriter(7)], timeZone: "UTC" });
    let t = clock.now() - 6 * 3_600_000;
    for (let i = 0; i < 60; i++) {
      const p = await archivist.produce(t, slotAt(clock.now(), "UTC"), { rerun: false });
      p.segment.startAt = t;
      b.timeline.append(p.segment, "");
      t += p.segment.durationMs;
    }
    b.governor.setViewers(1, clock.now());
    let deadAir = 0;
    const end = clock.now() + 3 * 3_600_000;
    while (clock.now() < end) {
      b.governor.setViewers(1, clock.now());
      await b.station.tick();
      if (!b.timeline.at(clock.now())) deadAir += 5000;
      clock.advance(5000);
    }
    const segs = b.timeline.range(end - 3 * 3_600_000, end).filter((s) => s.showId !== "station_id");
    const fresh = segs.filter((s) => s.writer === "slowpoke" && s.kind === "live").length;
    // 45s of fresh air per 140s of writing caps fresh airtime near a third; encores cover the rest.
    expect(fresh / segs.length).toBeGreaterThan(0.2);
    expect(deadAir).toBeLessThanOrEqual(130_000); // only the very first write, before any archive exists
  }, 60_000);
});
