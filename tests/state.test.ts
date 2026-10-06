import { describe, expect, it } from "vitest";
import type { Segment } from "../src/shared/types.js";
import { openDb } from "../src/server/db.js";
import { Governor } from "../src/server/governor.js";
import { BudgetExceededError, costUsd, Ledger, worstCaseUsd } from "../src/server/ledger.js";
import { parseHours } from "../src/server/config.js";
import { MemoryBank } from "../src/server/memory.js";
import { Timeline } from "../src/server/timeline.js";

const seg = (id: string, startAt: number, durationMs: number, over: Partial<Segment> = {}): Segment => ({
  id,
  showId: "pixel_heights",
  showTitle: "Pixel Heights",
  title: id,
  set: "soap_livingroom",
  startAt,
  durationMs,
  cast: [],
  cues: [],
  kind: "live",
  writer: "test",
  ...over,
});

describe("timeline", () => {
  it("rejects overlapping segments and returns ranges in order", () => {
    const tl = new Timeline(openDb(":memory:"));
    tl.append(seg("a", 1000, 1000), "A");
    tl.append(seg("b", 2000, 1000), "B");
    expect(() => tl.append(seg("c", 2500, 1000), "C")).toThrow(/overlap/);
    expect(tl.tailEnd()).toBe(3000);
    expect(tl.range(0, 10_000).map((s) => s.id)).toEqual(["a", "b"]);
    expect(tl.at(2000)?.id).toBe("b");
    expect(tl.at(1999)?.id).toBe("a");
    expect(tl.at(3000)).toBeUndefined();
  });

  it("prefers never-rerun archive segments and skips excluded ones", () => {
    const tl = new Timeline(openDb(":memory:"));
    tl.append(seg("old1", 0, 1000), "");
    tl.append(seg("old2", 1000, 1000), "");
    tl.append(seg("r1", 2000, 1000, { kind: "rerun" }), "", "old1");
    expect(tl.pickRerun("pixel_heights", 5000, new Set())?.id).toBe("old2");
    expect(tl.pickRerun("pixel_heights", 5000, new Set(["old2"]))?.id).toBe("old1");
    expect(tl.pickRerun("pixel_heights", 500, new Set())).toBeUndefined();
    expect(tl.pickRerun("couch_coop", 5000, new Set())).toBeUndefined();
  });
});

describe("memory bank", () => {
  it("recalls important and recent memories first, for the right characters", () => {
    const m = new MemoryBank(openDb(":memory:"));
    const day = 86_400_000;
    m.remember("s", ["rex"], "old but huge", 1, 0);
    m.remember("s", ["rex"], "fresh but tiny", 0.1, 10 * day);
    m.remember("s", ["rex", "deedee"], "fresh and big", 0.8, 10 * day);
    m.remember("s", ["kev"], "unrelated", 1, 10 * day);
    const got = m.recall(["rex"], 10 * day, 3).map((x) => x.text);
    expect(got[0]).toBe("fresh and big");
    expect(got).not.toContain("unrelated");
    expect(got.indexOf("fresh but tiny")).toBeLessThan(got.indexOf("old but huge")); // 10 days of decay
  });

  it("caps relationship swings per scene and clamps to the range", () => {
    const m = new MemoryBank(openDb(":memory:"));
    m.adjust("greg", "sunny", -80, "stole the weather", 0);
    expect(m.relationship("greg", "sunny").score).toBe(-25);
    for (let i = 0; i < 10; i++) m.adjust("greg", "sunny", -25, "", i);
    expect(m.relationship("greg", "sunny")).toMatchObject({ score: -100, note: "stole the weather" });
    m.seed("greg", "sunny", 50, "ignored", 0);
    expect(m.relationship("greg", "sunny").score).toBe(-100);
  });

  it("stores serialized story state", () => {
    const m = new MemoryBank(openDb(":memory:"));
    expect(m.storyState("pixel_heights")).toBe("");
    m.setStoryState("pixel_heights", " The will was forged. ", 1);
    expect(m.storyState("pixel_heights")).toBe("The will was forged.");
  });
});

describe("ledger and governor", () => {
  it("prices cached and uncached tokens", () => {
    expect(costUsd("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(1);
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(10);
    expect(costUsd("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.1);
  });

  it("writes nothing when nobody is watching, after a grace period", () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const g = new Governor({ leadTargetMs: 60_000, idleGraceMs: 10_000, dailyBudgetUsd: 1, ledger });
    expect(g.decide(0).leadTargetMs).toBe(0);
    g.setViewers(2, 1000);
    expect(g.decide(1000).leadTargetMs).toBe(60_000);
    g.setViewers(0, 5000);
    expect(g.decide(14_000).leadTargetMs).toBe(60_000);
    expect(g.decide(16_000)).toMatchObject({ leadTargetMs: 0, reason: "nobody watching" });
  });

  it("switches to reruns once the daily budget is spent", () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const g = new Governor({ leadTargetMs: 60_000, idleGraceMs: 0, dailyBudgetUsd: 0.5, ledger });
    g.setViewers(1, 0);
    expect(g.decide(0).rerunsOnly).toBe(false);
    ledger.record(0, "claude-sonnet-5-5", "test", { input_tokens: 0, output_tokens: 60_000 });
    expect(g.decide(0).rerunsOnly).toBe(true);
    expect(g.decide(86_400_000).rerunsOnly).toBe(false); // new day, new budget
  });

  it("bills cache writes at the TTL's rate (2x for the 1-hour cache we ask for)", () => {
    // No TTL breakdown: assume the 1-hour rate.
    expect(costUsd("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(2);
    const split = { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 };
    expect(costUsd("claude-haiku-4-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2_000_000, cache_creation: split })).toBeCloseTo(3.25);
    // Opus 5.5 reads its cache at $0.20/MTok.
    expect(costUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
  });

  it("refuses a paid call whose worst case would cross the daily ceiling", () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC", 0.1);
    const worst = worstCaseUsd("claude-sonnet-5-5", 7000, 4000); // 2000 tokens at 2x$2 + 4000 at $10 = $0.048
    expect(worst).toBeCloseTo(0.048);
    expect(() => ledger.guard(0, worst, "script")).not.toThrow();
    ledger.record(0, "claude-sonnet-5-5", "test", { input_tokens: 0, output_tokens: 6000 }); // $0.06 spent
    expect(() => ledger.guard(0, worst, "script")).toThrow(BudgetExceededError);
    expect(() => ledger.guard(86_400_000, worst, "script")).not.toThrow(); // new day
  });

  it("a restream alone airs reruns, except in its fresh hours", () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const g = new Governor({ leadTargetMs: 60_000, idleGraceMs: 0, dailyBudgetUsd: 1, ledger, feedFreshHours: parseHours("19-21"), timeZone: "UTC" });
    expect(g.decide(0).leadTargetMs).toBe(0); // nobody, no feed
    g.setFeeds(1);
    expect(g.decide(0)).toMatchObject({ leadTargetMs: 60_000, rerunsOnly: true }); // midnight UTC
    expect(g.decide(20 * 3_600_000)).toMatchObject({ leadTargetMs: 60_000, rerunsOnly: false }); // 8pm
    g.setViewers(1, 0);
    expect(g.decide(0).rerunsOnly).toBe(false); // a real viewer on the website
  });

  it("parses fresh-hour specs", () => {
    expect([...parseHours("19-21,7")].sort((a, b) => a - b)).toEqual([7, 19, 20]);
    expect(parseHours("0-24").size).toBe(24);
    expect(parseHours("").size).toBe(0);
  });

  it("writes the flagship during always-on hours even with nobody watching", () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const g = new Governor({ leadTargetMs: 60_000, idleGraceMs: 0, dailyBudgetUsd: 1, ledger, alwaysOnHours: parseHours("21-24"), timeZone: "UTC" });
    expect(g.decide(20 * 3_600_000).leadTargetMs).toBe(0); // 8pm, nobody watching
    expect(g.decide(21 * 3_600_000 + 60_000)).toMatchObject({ leadTargetMs: 60_000, rerunsOnly: false, reason: "always-on hours" });
    expect(parseHours("21-24").has(23)).toBe(true);
  });
});
