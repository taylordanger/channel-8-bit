import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { openDb } from "../src/server/db.js";
import { TopicDesk } from "../src/server/desk.js";
import { MemoryBank } from "../src/server/memory.js";
import { Producer } from "../src/server/producer.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { userPrompt } from "../src/server/writers/prompt.js";
import { ImprovWriter } from "../src/server/writers/improv.js";

describe("assignment desk", () => {
  it("routes topics to the right show and retires them after their uses", () => {
    const desk = new TopicDesk(openDb(":memory:"));
    const any = desk.add("  a   mystery   casserole ", null, 1, 1);
    const soap = desk.add("the will was forged", "pixel_heights", 2, 2);
    expect(any.text).toBe("a mystery casserole");
    // Show-specific topics win ties over "any show" ones.
    expect(desk.nextFor("pixel_heights")?.id).toBe(soap.id);
    expect(desk.nextFor("couch_coop")?.id).toBe(any.id);
    desk.markUsed(soap.id, 3);
    expect(desk.nextFor("pixel_heights")?.id).toBe(any.id); // least used goes first
    desk.markUsed(any.id, 4);
    expect(desk.nextFor("couch_coop")).toBeUndefined(); // retired
    expect(desk.nextFor("pixel_heights")?.id).toBe(soap.id);
    expect(desk.list()[0].id).toBe(soap.id); // active topics list first
  });

  it("rejects empty topics and clamps lengths and uses", () => {
    const desk = new TopicDesk(openDb(":memory:"));
    expect(() => desk.add("   ", null, 2, 0)).toThrow(/empty/);
    const t = desk.add("x".repeat(1000), null, 99, 0);
    expect(t.text.length).toBe(280);
    expect(t.maxUses).toBe(10);
  });

  it("the producer builds the next segment around a desk topic and marks it used", async () => {
    const db = openDb(":memory:");
    const desk = new TopicDesk(db);
    const topic = desk.add("Greg is replaced by a weather app", "rise_and_pixel", 1, 0);
    const p = new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), desk, tts: new SilentTTS(), writers: [new ImprovWriter(5)], timeZone: "UTC" });
    const at = Date.UTC(2026, 9, 3, 7, 0); // morning show
    const brief = p.brief(at, slotAt(at, "UTC"), 60);
    expect(brief.topic).toBe(topic.text);
    expect(userPrompt(brief)).toContain("ASSIGNMENT DESK");
    await p.produce(at, slotAt(at, "UTC"), { rerun: false });
    expect(desk.get(topic.id)?.uses).toBe(1);
    expect(p.brief(at + 1000, slotAt(at, "UTC"), 60).deskTopicId).toBeUndefined();
  });
});
