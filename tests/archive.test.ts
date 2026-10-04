import { describe, expect, it } from "vitest";
import type { Segment } from "../src/shared/types.js";
import { openDb } from "../src/server/db.js";
import { FunnyMeter } from "../src/server/clips.js";
import { Timeline } from "../src/server/timeline.js";

const H = 3_600_000;
const seg = (id: string, startAt: number, over: Partial<Segment> = {}): Segment => ({
  id, showId: "nada", showTitle: "Much Ado About Nada", title: id, set: "sitcom_apartment", startAt, durationMs: 60_000, cast: [], cues: [], kind: "live", writer: "ollama:llama3.1:8b", ...over,
});

function archive() {
  const db = openDb(":memory:");
  const tl = new Timeline(db);
  tl.append(seg("old", 0), "");
  tl.append(seg("mid", 1 * H), "");
  tl.append(seg("new", 2 * H), "");
  tl.append(seg("filler", 3 * H, { writer: "improv" }), "");
  return { db, tl };
}

describe("curated encore archive", () => {
  it("airs the least recently aired scene first, improv last", () => {
    const { tl } = archive();
    expect(tl.pickRerun("nada", 120_000, new Set())?.id).toBe("old");
    expect(tl.pickRerun("nada", 120_000, new Set(["old", "mid", "new"]))?.id).toBe("filler");
  });

  it("never re-airs a retired scene, even when it's next in line", () => {
    const { tl } = archive();
    tl.mark("old", "retired", 0);
    expect(tl.pickRerun("nada", 120_000, new Set())?.id).toBe("mid");
    tl.mark("old", null, 0);
    expect(tl.pickRerun("nada", 120_000, new Set())?.id).toBe("old");
  });

  it("brings starred and laughed-at scenes around sooner, without looping them", () => {
    const { db, tl } = archive();
    // Every original has had an encore; "new" re-aired most recently.
    tl.append(seg("e-old", 4 * H, { kind: "rerun" }), "", "old");
    tl.append(seg("e-mid", 5 * H, { kind: "rerun" }), "", "mid");
    tl.append(seg("e-new", 6 * H, { kind: "rerun" }), "", "new");
    expect(tl.pickRerun("nada", 120_000, new Set())?.id).toBe("old");
    // A star on the encore lands on its original and puts it 3h "earlier".
    tl.mark("e-new", "star", 0);
    expect(tl.marks().get("new")).toBe("star");
    expect(tl.pickRerun("nada", 120_000, new Set())?.id).toBe("new");
    tl.mark("new", null, 0);
    // Laughs during the encore count for the original: 3 taps = 90 minutes sooner.
    const meter = new FunnyMeter(db);
    for (const v of ["viewer-1", "viewer-2", "viewer-3"]) meter.tap("e-mid", v, 5 * H);
    expect(tl.pickRerun("nada", 120_000, new Set())?.id).toBe("mid");
    // Still subject to the freshness window: a favorite that just aired waits its turn.
    expect(tl.pickRerun("nada", 120_000, new Set(["mid"]))?.id).toBe("old");
  });
});
