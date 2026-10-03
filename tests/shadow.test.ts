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
