import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { buildStation } from "../src/server/build.js";
import { ManualClock } from "../src/server/clock.js";
import { loadConfig } from "../src/server/config.js";
import { openDb } from "../src/server/db.js";
import { OpsLog } from "../src/server/ops.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import type { Writer } from "../src/server/writers/script.js";

describe("operator metrics", () => {
  it("logs every writer attempt with its outcome and timing, and reports the airtime mix", async () => {
    const t = Date.UTC(2026, 9, 3, 10, 30);
    const clock = new ManualClock(t);
    const broken: Writer = { name: "broken", write: async () => { throw new Error("model fell over"); } };
    const b = buildStation({ ...loadConfig({}), timeZone: "UTC", tts: "silent", writer: "improv" }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [broken, new ImprovWriter(1)] });
    const p = await b.producer.produce(t + 1500, slotAt(t, "UTC"), { rerun: false });
    b.station.commit(p);
    clock.advance(30_000);
    const r = b.ops.report(clock.now());
    expect(r.writers.find((w) => w.writer === "broken")).toMatchObject({ failed: 1, ok: 0 });
    expect(r.writers.find((w) => w.writer === "improv")).toMatchObject({ ok: 1, failed: 0 });
    expect(r.errors[0]).toMatchObject({ writer: "broken", outcome: "failed", detail: "model fell over" });
    expect(r.mixMs.improv).toBeGreaterThan(20_000);
    expect(r.mixMs.fresh).toBe(0);
  });

  it("counts dead air only while someone is watching", () => {
    const ops = new OpsLog(openDb(":memory:"));
    const t = Date.UTC(2026, 9, 3, 10);
    for (let i = 0; i < 5; i++) ops.airTick(t + i * 1000, 2, false); // watching, nothing on
    for (let i = 5; i < 10; i++) ops.airTick(t + i * 1000, 0, false); // nobody watching: fine
    for (let i = 10; i < 15; i++) ops.airTick(t + i * 1000, 3, true);
    const r = ops.report(t + 60_000);
    expect(r.deadAirSec).toBe(5);
    expect(r.watchedMinutes).toBe(1);
  });
});
