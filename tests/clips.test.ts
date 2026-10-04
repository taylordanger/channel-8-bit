import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Segment } from "../src/shared/types.js";
import { ClipDesk, FunnyMeter } from "../src/server/clips.js";
import { openDb } from "../src/server/db.js";
import { Timeline } from "../src/server/timeline.js";

const seg = (id: string, startAt: number, over: Partial<Segment> = {}): Segment => ({
  id, showId: "late_byte", showTitle: "The Late Byte", title: `Scene ${id}`, set: "late_night", startAt, durationMs: 60_000, cast: [], cues: [], kind: "live", writer: "test", ...over,
});

describe("clip desk", () => {
  it("renders aired scenes one at a time, never future ones or station breaks, and reuses finished clips", async () => {
    const db = openDb(":memory:");
    const tl = new Timeline(db);
    tl.append(seg("a", 0), "");
    tl.append(seg("b", 60_000), "");
    tl.append(seg("brk", 120_000, { kind: "bumper" }), "");
    tl.append(seg("future", 200_000), "");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-"));
    const rendered: string[] = [];
    let running = 0;
    const desk = new ClipDesk(db, dir, async (id, out) => {
      running++;
      expect(running).toBe(1); // one at a time
      await new Promise((r) => setTimeout(r, 5));
      running--;
      rendered.push(id);
      if (id === "b") return "chrome missing";
      fs.writeFileSync(out, "mp4");
      return null;
    });
    expect(desk.request("future", 150_000)).toBe("that segment hasn't aired");
    expect(desk.request("brk", 150_000)).toBe("nothing to clip in a station break");
    const a = desk.request("a", 150_000);
    const b = desk.request("b", 150_000);
    expect(typeof a).toBe("object");
    expect(typeof b).toBe("object");
    await desk.pump();
    expect(rendered).toEqual(["a", "b"]);
    const ca = desk.list().find((c) => c.segmentId === "a")!;
    const cb = desk.list().find((c) => c.segmentId === "b")!;
    expect(ca).toMatchObject({ segmentId: "a", status: "ready", file: "1-late_byte.mp4" });
    expect(cb).toMatchObject({ segmentId: "b", status: "failed", error: "chrome missing" });
    expect(desk.request("a", 150_000)).toMatchObject({ id: ca.id }); // no duplicate render
  });

  it("counts one 'that was funny' per viewer per scene", () => {
    const meter = new FunnyMeter(openDb(":memory:"));
    expect(meter.tap("a", "viewer-1", 10)).toBe(true);
    expect(meter.tap("a", "viewer-1", 11)).toBe(false);
    meter.tap("a", "viewer-2", 12);
    meter.tap("b", "viewer-1", 13);
    expect(meter.counts(0).get("a")).toBe(2);
    expect(meter.counts(13).get("a")).toBeUndefined();
  });
});
