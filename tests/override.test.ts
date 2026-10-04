import { describe, expect, it } from "vitest";
import { guideWith, programAt } from "../src/server/catalog/schedule.js";
import { runShadow } from "../src/server/shadow.js";
import { buildStation } from "../src/server/build.js";
import { ManualClock } from "../src/server/clock.js";
import { loadConfig } from "../src/server/config.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";

const TZ = "UTC";
const afternoon = Date.UTC(2026, 9, 3, 15, 0); // couch_coop slot

describe("special programming", () => {
  it("an override takes the air for its window, then the grid resumes", () => {
    const o = { showId: "pixel_heights", startAt: afternoon, endAt: afternoon + 3_600_000 };
    expect(programAt(afternoon + 1000, TZ, o)).toMatchObject({ showId: "pixel_heights", endAt: o.endAt });
    expect(programAt(o.endAt, TZ, o).showId).toBe("couch_coop");
    expect(programAt(afternoon - 1, TZ, o).showId).toBe("couch_coop");
  });

  it("the guide splices the special into the regular schedule", () => {
    const o = { showId: "pixel_heights", startAt: afternoon + 600_000, endAt: afternoon + 4_200_000 };
    const g = guideWith(afternoon, 6, TZ, o);
    expect(g.map((x) => x.showId).slice(0, 3)).toEqual(["couch_coop", "pixel_heights", "couch_coop"]);
    expect(g[1]).toMatchObject({ startAt: o.startAt, endAt: o.endAt });
    for (let i = 1; i < g.length; i++) expect(g[i].startAt).toBe(g[i - 1].endAt);
  });

  it("airNow switches the next segment's show and endOverride switches back", async () => {
    const clock = new ManualClock(afternoon);
    const b = buildStation({ ...loadConfig({}), timeZone: TZ, tts: "silent", writer: "improv" }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [new ImprovWriter(1)] });
    b.governor.setViewers(1, clock.now());
    await b.station.tick();
    expect(b.timeline.range(0, Infinity).at(-1)?.showId).toBe("couch_coop");
    b.station.airNow("pixel_heights", 30);
    await b.station.tick();
    expect(b.timeline.range(0, Infinity).at(-1)?.showId).toBe("pixel_heights");
    b.station.endOverride();
    // Ending lets what's already written finish, then hands back to the schedule.
    expect(b.station.override()?.endAt).toBe(b.timeline.tailEnd());
    clock.set(b.timeline.tailEnd() - 1000);
    await b.station.tick();
    expect(b.timeline.range(0, Infinity).at(-1)?.showId).toBe("couch_coop");
  });

  it("a new special replaces an earlier one instead of letting it resume", () => {
    const clock = new ManualClock(afternoon);
    const b = buildStation({ ...loadConfig({}), timeZone: TZ, tts: "silent", writer: "improv" }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [new ImprovWriter(1)] });
    b.station.airNow("rise_and_pixel", 120);
    const nada = b.station.airNow("nada", 30);
    clock.set(nada.endAt + 1000);
    expect(b.station.override()).toBeNull();
  });

  it("regular shadow runs are unaffected", async () => {
    const r = await runShadow({ startAt: afternoon, hours: 2, config: { timeZone: TZ } });
    expect(r.violations).toEqual([]);
  }, 30_000);
});
