import { describe, expect, it } from "vitest";
import { generateSong, songShape, type SongSpec } from "../src/shared/music.js";
import { ARTISTS } from "../src/server/catalog/music.js";
import { CHARACTERS } from "../src/server/catalog/characters.js";
import { getShow } from "../src/server/catalog/shows.js";
import { openDb } from "../src/server/db.js";
import { MemoryBank } from "../src/server/memory.js";
import { Producer } from "../src/server/producer.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { checkInvariants } from "../src/server/shadow.js";

const spec = (over: Partial<SongSpec> = {}): SongSpec => ({
  title: "Test Song",
  artist: "Testers",
  style: "rock",
  seed: 1234,
  bpm: 120,
  root: 40,
  sections: songShape("rock", 120, 60_000, true),
  startMs: 3000,
  ...over,
});

describe("music", () => {
  it("is deterministic: every viewer generates the same notes from the same spec", () => {
    expect(generateSong(spec())).toEqual(generateSong(spec()));
    expect(generateSong(spec({ seed: 99 })).events).not.toEqual(generateSong(spec()).events);
  });

  it("starts without drums so the drummer waits for them to come in", () => {
    const song = generateSong(spec());
    const intro = song.sections[0];
    expect(intro.drums).toBe(false);
    expect(song.drumsStartMs).toBe(intro.bars * song.beatMs * 4);
    expect(song.events.filter((e) => ["kick", "snare", "hat"].includes(e.inst)).every((e) => e.t >= song.drumsStartMs)).toBe(true);
    expect(song.events.some((e) => e.inst === "kick")).toBe(true);
  });

  it("sizes songs to the target, sings only where there are vocals, and keeps notes in time", () => {
    for (const style of ["synthpop", "rock", "punk", "ballad"] as const) {
      const bpm = style === "punk" ? 180 : 110;
      const song = generateSong(spec({ style, bpm, sections: songShape(style, bpm, 80_000, true) }));
      expect(Math.abs(song.totalMs - 80_000)).toBeLessThan(25_000);
      expect(song.events.every((e) => e.t >= 0 && e.t < song.totalMs)).toBe(true);
      expect(song.events.some((e) => e.inst === "lead")).toBe(true);
      const ordered = song.events.every((e, i, a) => i === 0 || a[i - 1].t <= e.t);
      expect(ordered).toBe(true);
    }
    const instrumental = generateSong(spec({ sections: songShape("synthpop", 110, 40_000, false) }));
    expect(instrumental.events.some((e) => e.inst === "lead")).toBe(false);
  });

  it("every band member exists and each act has songs", () => {
    for (const a of Object.values(ARTISTS)) {
      expect(a.songs.length).toBeGreaterThan(2);
      for (const m of a.members) expect(CHARACTERS[m.id]).toBeTruthy();
    }
  });

  it("the producer stages a performance: host intro, the band in position, a song after the intro", async () => {
    const db = openDb(":memory:");
    const p = new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), tts: new SilentTTS(), writers: [new ImprovWriter(1)], timeZone: "UTC" });
    const seg = (await p.music(Date.UTC(2026, 9, 3, 23), getShow("late_byte"), "guest", 120)).segment;
    expect(seg.set).toBe("music_stage");
    expect(seg.song).toBeTruthy();
    expect(seg.cues).toHaveLength(1);
    expect(seg.cues[0].speaker).toBe("rex");
    expect(seg.song!.startMs).toBeGreaterThan(seg.cues[0].t + seg.cues[0].dur);
    const song = generateSong(seg.song!);
    expect(seg.durationMs).toBeGreaterThan(seg.song!.startMs + song.totalMs);
    expect(seg.cast.find((c) => c.role === "drums")).toBeTruthy();
    expect(seg.cast.find((c) => c.role === "host")?.id).toBe("rex");
    expect(checkInvariants([{ ...seg, startAt: Date.UTC(2026, 9, 3, 23) }], "UTC")).toEqual([]);
    const house = (await p.music(Date.UTC(2026, 9, 3, 23), getShow("late_byte"), "house", 120)).segment;
    expect(house.song!.artist).toBe("The Interference");
    expect(house.cast.some((c) => c.role === "vocals")).toBe(false);
  });
});

describe("play a song now", () => {
  it("drops what's queued after the current scene and puts the chosen act on next", async () => {
    const { buildStation } = await import("../src/server/build.js");
    const { ManualClock } = await import("../src/server/clock.js");
    const { loadConfig } = await import("../src/server/config.js");
    const clock = new ManualClock(Date.UTC(2026, 9, 3, 15, 0));
    const retracted: string[] = [];
    const b = buildStation({ ...loadConfig({}), timeZone: "UTC", tts: "silent", writer: "improv" }, {
      clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [new ImprovWriter(2)], onRetract: (ids) => retracted.push(...ids),
    });
    b.governor.setViewers(1, clock.now());
    for (let i = 0; i < 3; i++) await b.station.tick();
    const current = b.timeline.at(clock.now() + 2000)!;
    clock.advance(2000);
    const seg = await b.station.playMusic("rusty_spurs");
    expect(seg.song!.artist).toBe("The Rusty Spurs");
    expect(seg.startAt).toBe(current.startAt + current.durationMs);
    expect(seg.cast.find((c) => c.role === "host")?.id).toBe("kev"); // couch_coop is on, so Kev introduces them
    expect(retracted.length).toBeGreaterThan(0);
  });
});
