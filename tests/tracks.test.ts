import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeTrack, TrackLibrary } from "../src/server/tracks.js";

const SR = 22050;

/** A synthetic song with known answers: `bpm`, an intro of `introSec` with no drums, then kicks and hats. */
function synth(bpm: number, introSec: number, totalSec: number, vocalsFrom = 1e9, pad = true): Buffer {
  const n = SR * totalSec;
  const x = new Float32Array(n);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (pad) x[i] += 0.08 * Math.sin(2 * Math.PI * 110 * t); // a quiet pad throughout
    if (t >= vocalsFrom && Math.floor(t / 2) % 2 === 0) x[i] += 0.12 * Math.sin(2 * Math.PI * (440 + 6 * Math.sin(2 * Math.PI * 5 * t)) * t);
  }
  for (let b = 0; b * beat < totalSec; b++) {
    const start = b * beat;
    if (start < introSec) continue;
    for (let i = 0; i < 0.15 * SR; i++) {
      const idx = Math.floor(start * SR) + i;
      if (idx >= n) break;
      const tt = i / SR;
      const f = 50 + 90 * Math.exp(-tt * 30);
      x[idx] += 0.9 * Math.exp(-tt * 18) * Math.sin(2 * Math.PI * f * tt);
    }
    const off = Math.floor((start + beat / 2) * SR);
    for (let i = 0; i < 0.03 * SR && off + i < n; i++) x[off + i] += 0.15 * (Math.random() * 2 - 1) * Math.exp(-i / (0.006 * SR));
  }
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 26000))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("track analysis", () => {
  it("finds the tempo, the beat, and when the drums come in", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-"));
    const file = path.join(dir, "song.wav");
    fs.writeFileSync(file, synth(120, 8, 30));
    const a = await analyzeTrack(file);
    expect(a.durationMs).toBeGreaterThan(29_500);
    expect(Math.abs(a.bpm - 120)).toBeLessThan(2.5);
    expect(Math.abs(a.drumsStartMs - 8000)).toBeLessThan(700);
    const m = a.beatOffsetMs % 500; // grid lands on the beats (every 500ms at 120 bpm), either side
    expect(Math.min(m, 500 - m)).toBeLessThan(80);
  }, 30_000);

  it("handles a faster punk tempo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-"));
    const file = path.join(dir, "punk.wav");
    fs.writeFileSync(file, synth(176, 4, 25));
    const a = await analyzeTrack(file);
    // Half or full time are both musically valid beat grids.
    const ok = Math.abs(a.bpm - 176) < 4 || Math.abs(a.bpm - 88) < 3;
    expect(ok).toBe(true);
    expect(Math.abs(a.drumsStartMs - 4000)).toBeLessThan(800);
  }, 30_000);

  it("uses a vocal stem for the mouth when there is one, and caches analyses", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-"));
    fs.mkdirSync(path.join(root, "glimmer"));
    fs.writeFileSync(path.join(root, "glimmer", "Test Song.wav"), synth(110, 4, 20));
    // Stem: silence for 10s, then singing.
    fs.writeFileSync(path.join(root, "glimmer", "Test Song.vocals.wav"), synth(110, 1e9, 20, 10, false));
    const lib = new TrackLibrary(root);
    await lib.scan();
    const [t] = lib.forArtist("glimmer");
    expect(t.title).toBe("Test Song");
    expect(t.analysis.fromStem).toBe(true);
    const env = t.analysis.vocalEnv;
    expect(env.slice(0, 180).replace(/0/g, "")).toBe(""); // first 9s: mouth closed
    expect(env.slice(250, 270).replace(/0/g, "").length).toBeGreaterThan(10); // singing at 12-14s
    expect(fs.readdirSync(path.join(root, ".analysis"))).toHaveLength(1);
    expect(lib.spec(t, "Glimmer", 3000).url).toBe("/music/glimmer/Test%20Song.wav");
  }, 60_000);
});

describe("bands perform your tracks", () => {
  it("a band with a recorded track plays it instead of a generated song", async () => {
    const { openDb } = await import("../src/server/db.js");
    const { MemoryBank } = await import("../src/server/memory.js");
    const { Producer } = await import("../src/server/producer.js");
    const { Timeline } = await import("../src/server/timeline.js");
    const { SilentTTS } = await import("../src/server/tts.js");
    const { ImprovWriter } = await import("../src/server/writers/improv.js");
    const { getShow } = await import("../src/server/catalog/shows.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "music-"));
    fs.mkdirSync(path.join(root, "rusty_spurs"));
    fs.writeFileSync(path.join(root, "rusty_spurs", "Dirt Road Anthem.wav"), synth(116, 6, 24));
    const tracks = new TrackLibrary(root);
    await tracks.scan();
    const db = openDb(":memory:");
    const p = new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), tracks, tts: new SilentTTS(), writers: [new ImprovWriter(1)], timeZone: "UTC" });
    const seg = (await p.music(Date.UTC(2026, 9, 3, 23), getShow("late_byte"), "guest", 120, "rusty_spurs")).segment;
    expect(seg.song).toBeUndefined();
    expect(seg.track).toMatchObject({ title: "Dirt Road Anthem", artist: "The Rusty Spurs", url: "/music/rusty_spurs/Dirt%20Road%20Anthem.wav" });
    expect(seg.cues[0].text).toContain("Dirt Road Anthem");
    expect(seg.durationMs).toBeGreaterThan(seg.track!.startMs + seg.track!.durationMs);
    // A band without tracks still plays a generated song.
    const glimmer = (await p.music(Date.UTC(2026, 9, 3, 23), getShow("late_byte"), "guest", 120, "glimmer")).segment;
    expect(glimmer.song).toBeTruthy();
  }, 60_000);
});
