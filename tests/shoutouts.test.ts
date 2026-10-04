import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Segment } from "../src/shared/types.js";
import { openDb } from "../src/server/db.js";
import type { Moderator } from "../src/server/mailbag.js";
import { MemoryBank } from "../src/server/memory.js";
import { Producer } from "../src/server/producer.js";
import { cleanRecipient, ShoutoutDesk, type Shoutout } from "../src/server/shoutouts.js";
import { DEFAULT_POLICY } from "../src/server/standards.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { userPrompt } from "../src/server/writers/prompt.js";
import type { Writer, WriterBrief } from "../src/server/writers/script.js";

const allow: Moderator = { moderate: async () => ({ allow: true, reason: "fine" }) };
const fakeSegment = (id: string): Segment => ({ id, showId: "late_byte", showTitle: "", title: "t", set: "late_night", startAt: 0, durationMs: 30_000, cast: [], cues: [], kind: "live", writer: "x" });

function desk(moderator: Moderator = allow) {
  const db = openDb(":memory:");
  const made: Shoutout[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shoutouts-"));
  const d = new ShoutoutDesk(db, {
    policy: DEFAULT_POLICY,
    moderator,
    make: async (s) => (made.push(s), fakeSegment(`seg-${s.id}`)),
    render: async (_id, out) => (fs.writeFileSync(out, "mp4"), null),
    vertical: async (_in, out) => (fs.writeFileSync(out, "mp4"), null),
    dir,
  });
  return { d, made, db };
}

describe("shoutouts", () => {
  it("takes a first name only", () => {
    expect(cleanRecipient(" Maya ")).toBe("Maya");
    expect(cleanRecipient("Mary Ann")).toBe("Mary Ann");
    expect(cleanRecipient("Maya Lopez-Garcia Smith")).toBeUndefined();
    expect(cleanRecipient("<b>x</b>")).toBeUndefined();
    expect(cleanRecipient("")).toBeUndefined();
  });

  it("waits for a human, then makes it privately and hands over unguessable files", async () => {
    const { d, made } = desk();
    const out = await d.submit({ recipient: "Maya", occasion: "birthday", detail: "turning 30, can't parallel park", showId: "late_byte" }, "1.1.1.1", 0);
    if (typeof out === "string") throw new Error(out);
    expect(out.status).toBe("pending");
    await d.pump();
    expect(made).toHaveLength(0); // nothing without approval
    const id = d.list()[0].id;
    expect(d.review(id, true)).toBe(true);
    await d.pump();
    const s = d.lookup(out.token)!;
    expect(s.status).toBe("ready");
    expect(s.file).toMatch(/^[0-9a-f]{24}\.mp4$/);
    expect(s.verticalFile).toMatch(/^[0-9a-f]{24}-vertical\.mp4$/);
    expect(d.segment(`seg-${id}`)?.id).toBe(`seg-${id}`); // for the local renderer
    expect(d.lookup("not-the-token")).toBeUndefined();
  });

  it("refuses bad requests and rate-limits, and the screen can turn one down", async () => {
    const { d } = desk({ moderate: async () => ({ allow: false, reason: "harassment" }) });
    expect(await d.submit({ recipient: "Maya Q Public", occasion: "birthday", detail: "", showId: "late_byte" }, "1.1.1.1", 0)).toMatch(/first name/);
    expect(await d.submit({ recipient: "Maya", occasion: "funeral", detail: "", showId: "late_byte" }, "1.1.1.1", 0)).toMatch(/occasion/);
    expect(await d.submit({ recipient: "Maya", occasion: "birthday", detail: "", showId: "nope" }, "1.1.1.1", 0)).toMatch(/who/);
    const declined = await d.submit({ recipient: "Maya", occasion: "birthday", detail: "x", showId: "late_byte" }, "2.2.2.2", 0);
    expect(typeof declined !== "string" && declined.status).toBe("rejected");
    for (let i = 0; i < 2; i++) await d.submit({ recipient: "Maya", occasion: "birthday", detail: "", showId: "late_byte" }, "2.2.2.2", i);
    expect(await d.submit({ recipient: "Maya", occasion: "birthday", detail: "", showId: "late_byte" }, "2.2.2.2", 5)).toMatch(/tomorrow/);
  });

  it("writes a private scene addressed to the recipient that never touches the timeline", async () => {
    const db = openDb(":memory:");
    const timeline = new Timeline(db);
    const briefs: WriterBrief[] = [];
    const improv = new ImprovWriter(2);
    const spy: Writer = { name: "improv", write: (b) => (briefs.push(b), improv.write(b)) };
    const p = new Producer({ timeline, memory: new MemoryBank(db), tts: new SilentTTS(), writers: [spy], timeZone: "UTC" });
    const seg = await p.shoutout({ recipient: "Maya", occasion: "birthday", detail: "turning 30", showId: "late_byte" }, 1000);
    expect(seg.title).toBe("For Maya: Birthday");
    expect(seg.cues.length).toBeGreaterThan(3);
    expect(timeline.range(0, Date.now() + 1e9)).toHaveLength(0);
    const prompt = userPrompt(briefs[0]);
    expect(prompt).toContain("PERSONALIZED SHOUTOUT");
    expect(prompt).toContain("<detail>turning 30</detail>");
  });
});
