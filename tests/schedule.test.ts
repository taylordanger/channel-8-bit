import { describe, expect, it } from "vitest";
import { GRID, guide, slotAt, validateGrid } from "../src/server/catalog/schedule.js";

const TZ = "America/New_York";
// 2026-10-03 15:30 in New York (EDT, UTC-4)
const t = Date.UTC(2026, 9, 3, 19, 30);

describe("schedule", () => {
  it("the grid tiles the whole day", () => {
    expect(() => validateGrid(GRID)).not.toThrow();
    expect(() => validateGrid([{ startHour: 0, endHour: 23, showId: "late_byte", mode: "live" }])).toThrow(/midnight/);
    expect(() => validateGrid([{ startHour: 1, endHour: 24, showId: "late_byte", mode: "live" }])).toThrow(/gap/);
  });

  it("finds the slot airing at an instant, with absolute boundaries", () => {
    const s = slotAt(t, TZ);
    expect(s.showId).toBe("couch_coop"); // 14-16 local
    expect(s.startAt).toBe(Date.UTC(2026, 9, 3, 18, 0));
    expect(s.endAt).toBe(Date.UTC(2026, 9, 3, 20, 0));
  });

  it("slot boundaries are half-open", () => {
    const boundary = Date.UTC(2026, 9, 3, 20, 0); // 16:00 local
    expect(slotAt(boundary - 1, TZ).showId).toBe("couch_coop");
    expect(slotAt(boundary, TZ).showId).toBe("cooking");
  });

  it("works in half-hour offset zones", () => {
    const s = slotAt(t, "Asia/Kolkata");
    expect(s.endAt - s.startAt).toBeGreaterThan(0);
    expect((s.startAt - Date.UTC(2026, 0, 1)) % 1_800_000).toBe(0);
  });

  it("guide merges the late show across midnight into one entry", () => {
    const g = guide(Date.UTC(2026, 9, 4, 2, 30), 6, TZ); // 22:30 local
    expect(g[0].showId).toBe("late_byte");
    expect(g[0].endAt - g[0].startAt).toBe(4 * 3_600_000);
    expect(g[1]).toMatchObject({ showId: "nada", mode: "rerun" });
  });
});

describe("the nightly flagship", () => {
  it("is tonight at 9 until it ends, then tomorrow", async () => {
    const { flagshipAt } = await import("../src/server/catalog/schedule.js");
    const tz = "America/Los_Angeles";
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 4, h + 7, m); // Oct 4 2026, PDT = UTC-7
    expect(flagshipAt(at(15), tz)).toMatchObject({ startAt: at(21), endAt: at(24), live: false });
    expect(flagshipAt(at(22, 30), tz)).toMatchObject({ startAt: at(21), live: true });
    expect(flagshipAt(at(1) + 24 * 3_600_000, tz).startAt).toBe(at(21) + 24 * 3_600_000); // 1am: tonight's is next
  });
});
