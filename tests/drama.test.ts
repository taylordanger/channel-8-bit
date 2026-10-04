import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { openDb } from "../src/server/db.js";
import { CharacterStates, MemoryBank, MOOD_TTL_MS } from "../src/server/memory.js";
import { Producer } from "../src/server/producer.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { userPrompt } from "../src/server/writers/prompt.js";
import type { Writer } from "../src/server/writers/script.js";
import { buildStation } from "../src/server/build.js";
import { ManualClock } from "../src/server/clock.js";
import { loadConfig } from "../src/server/config.js";
import { beat, script } from "./helpers.js";

const MORNING = Date.UTC(2026, 9, 3, 7, 0); // rise_and_pixel: sunny, greg, pip

describe("lasting character state", () => {
  it("moods persist across shows, then fade", () => {
    const st = new CharacterStates(openDb(":memory:"));
    st.setMood("greg", "furious", "Sunny took the weather map", 0);
    expect(st.mood("greg", 1000)).toMatchObject({ mood: "furious", reason: "Sunny took the weather map" });
    expect(st.mood("greg", MOOD_TTL_MS + 1)).toBeUndefined();
    st.setMood("greg", "neutral", "got over it", 5);
    expect(st.mood("greg", 10)).toBeUndefined();
  });

  it("a walk-off sits a character out, then they're owed an entrance, then it's over", () => {
    const st = new CharacterStates(openDb(":memory:"));
    st.walkOff("greg", "rise_and_pixel", "That's MY segment!", 2);
    expect(st.offSet("rise_and_pixel").map((o) => o.id)).toEqual(["greg"]);
    expect(st.offSet("late_byte")).toEqual([]);
    st.segmentAired("rise_and_pixel", ["sunny", "pip"]);
    expect(st.offSet("rise_and_pixel")[0].remaining).toBe(1);
    st.segmentAired("rise_and_pixel", ["sunny", "pip"]);
    expect(st.offSet("rise_and_pixel")).toEqual([]);
    expect(st.returning("rise_and_pixel")).toEqual(["greg"]);
    st.segmentAired("rise_and_pixel", ["sunny", "greg"]);
    expect(st.returning("rise_and_pixel")).toEqual([]);
  });

  it("one storm-off per show per hour", () => {
    const st = new CharacterStates(openDb(":memory:"));
    expect(st.walkOff("rex", "late_byte", "I quit!", 2, 0)).toBe(true);
    expect(st.walkOff("rex", "late_byte", "I quit again!", 2, 1000)).toBe(false); // already off
    st.segmentAired("late_byte", []);
    st.segmentAired("late_byte", []);
    st.segmentAired("late_byte", ["rex"]); // back on set
    expect(st.walkOff("rex", "late_byte", "Third time!", 2, 30 * 60_000)).toBe(false); // within the hour
    expect(st.walkOff("rex", "late_byte", "Okay NOW I quit", 2, 61 * 60_000)).toBe(true);
    expect(st.walkOff("rex", "rise_and_pixel", "Different show", 2, 61 * 60_000 + 1)).toBe(true);
  });

  it("feuds show up once relationships sink far enough", () => {
    const m = new MemoryBank(openDb(":memory:"));
    m.seed("greg", "sunny", -70, "", 0);
    m.seed("sunny", "greg", 20, "", 0);
    m.seed("pip", "greg", 40, "", 0);
    expect(m.feuds(["sunny", "greg", "pip"])).toEqual([{ a: "sunny", b: "greg", score: -70 }]);
  });
});

describe("writers see the drama", () => {
  it("the brief drops whoever stormed off, tells the writers, and brings them back with an entrance", () => {
    const db = openDb(":memory:");
    const memory = new MemoryBank(db);
    const states = new CharacterStates(db);
    const p = new Producer({ timeline: new Timeline(db), memory, states, tts: new SilentTTS(), writers: [new ImprovWriter(1)], timeZone: "UTC" });
    states.walkOff("greg", "rise_and_pixel", "I'm done with this show!", 1);
    states.setMood("sunny", "anxious", "Greg stormed out on live TV", MORNING);
    memory.seed("sunny", "pip", -80, "", 0);
    const slot = slotAt(MORNING, "UTC");
    const b = p.brief(MORNING, slot, 60);
    expect(b.cast.map((c) => c.id)).toEqual(["sunny", "pip"]);
    const prompt = userPrompt(b);
    expect(prompt).toContain("OFF THE SET: Greg Brickman stormed off");
    expect(prompt).toContain("MOODS");
    expect(prompt).toContain("Sunny Mae Holloway is anxious");
    expect(prompt).toContain("FEUD: Sunny Mae Holloway vs Pip Okafor");
    states.segmentAired("rise_and_pixel", ["sunny", "pip"]);
    const back = p.brief(MORNING + 1000, slot, 60);
    expect(back.cast.map((c) => c.id)).toContain("greg");
    expect(userPrompt(back)).toContain("BACK ON SET: Greg Brickman returns");
  });

  it("never empties a scene: if dropping someone leaves fewer than two, they stay", () => {
    const db = openDb(":memory:");
    const states = new CharacterStates(db);
    const p = new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), states, tts: new SilentTTS(), writers: [new ImprovWriter(1)], timeZone: "UTC" });
    states.walkOff("greg", "rise_and_pixel", "bye", 2);
    states.walkOff("pip", "rise_and_pixel", "bye", 2);
    expect(p.brief(MORNING, slotAt(MORNING, "UTC"), 60).cast).toHaveLength(3);
  });
});

describe("a host who stormed off", () => {
  it("doesn't introduce the band - whoever's still on set does", async () => {
    const db = openDb(":memory:");
    const states = new CharacterStates(db);
    const p = new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), states, tts: new SilentTTS(), writers: [new ImprovWriter(1)], timeZone: "UTC" });
    const { getShow } = await import("../src/server/catalog/shows.js");
    states.walkOff("rex", "late_byte", "I'm done!", 2);
    const seg = (await p.music(Date.UTC(2026, 9, 3, 23), getShow("late_byte"), "house", 60)).segment;
    expect(seg.cues[0].speaker).toBe("deedee");
  });
});

describe("the station records walk-offs and moods", () => {
  it("a regular who storms off without coming back sits out, is furious, and it's remembered", async () => {
    const stormy: Writer = {
      name: "stormy",
      write: async () => ({
        writer: "stormy",
        script: script(
          [beat("sunny", "Good morning!"), beat("greg", "That's MY segment!"), beat("pip", "Uh oh."), beat("greg", "I'm done. Forever.", "walk_off"), beat("sunny", "He'll be back!")],
          { moodChanges: [{ character: "sunny", mood: "embarrassed", reason: "her co-host quit on air" }] },
        ),
      }),
    };
    const clock = new ManualClock(MORNING);
    const b = buildStation({ ...loadConfig({}), timeZone: "UTC", tts: "silent", writer: "improv" }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [stormy, new ImprovWriter(1)] });
    const produced = await b.producer.produce(MORNING + 2000, slotAt(MORNING, "UTC"), { rerun: false });
    b.station.commit(produced);
    expect(b.states.offSet("rise_and_pixel").map((o) => o.id)).toEqual(["greg"]);
    expect(b.states.mood("greg", clock.now())?.mood).toBe("furious");
    expect(b.states.mood("sunny", clock.now())?.mood).toBe("embarrassed");
    expect(b.memory.latest(5).some((m) => m.text.includes("stormed off the set of Rise & Pixel"))).toBe(true);
  });
});
