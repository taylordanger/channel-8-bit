import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHARACTERS } from "../src/server/catalog/characters.js";
import { KokoroTTS, SilentTTS, type Fetcher } from "../src/server/tts.js";

/** A tiny valid 16-bit mono WAV: 0.5s at 24 kHz, a tone in the middle. */
function wav(): Buffer {
  const rate = 24000, n = rate / 2;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(i > n / 4 && i < (3 * n) / 4 ? Math.round(Math.sin(i / 5) * 15000) : 0, i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function engine(fetcher: Fetcher) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro-"));
  return { mediaDir, tts: new KokoroTTS({ mediaDir, python: "python", script: "x.py", modelDir: "m", port: 1, fallback: new SilentTTS(), fetcher, autoStart: false }) };
}

describe("Kokoro voices", () => {
  it("every character has a Kokoro voice and a sane speed", () => {
    for (const c of Object.values(CHARACTERS)) {
      expect(c.voice.kokoro).toMatch(/^[ab][fm]_[a-z]+$/);
      expect(c.voice.speed).toBeGreaterThanOrEqual(0.8);
      expect(c.voice.speed).toBeLessThanOrEqual(1.25);
    }
  });

  it("voices a line with the character's voice and speed, then serves it from cache", async () => {
    const calls: string[] = [];
    const { tts, mediaDir } = engine(async (url, init) => {
      calls.push(url);
      if (url.endsWith("/health")) return Response.json({ ok: true });
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello, insomniacs.", voice: "am_michael", speed: 1.05 });
      return new Response(new Uint8Array(wav()), { headers: { "content-type": "audio/wav" } });
    });
    const v = await tts.voice("Hello, insomniacs.", CHARACTERS.rex);
    expect(v.durationMs).toBe(500);
    expect(v.audio).toMatch(/^\/media\/[0-9a-f]{16}\.(mp3|wav)$/);
    expect(fs.existsSync(path.join(mediaDir, v.audio!.slice(7)))).toBe(true);
    expect(v.env.slice(0, 2)).toBe("00");
    expect(Math.max(...v.env.split("").map(Number))).toBeGreaterThanOrEqual(7);
    const speaks = calls.filter((u) => u.endsWith("/speak")).length;
    await tts.voice("Hello, insomniacs.", CHARACTERS.rex);
    expect(calls.filter((u) => u.endsWith("/speak")).length).toBe(speaks);
  });

  it("falls back to the backup voices when the server is down", async () => {
    const { tts } = engine(async () => {
      throw new TypeError("fetch failed");
    });
    const v = await tts.voice("Anybody there?", CHARACTERS.pip);
    expect(v.audio).toBeNull(); // the silent fallback in this test
    expect(v.durationMs).toBeGreaterThan(0);
  });

  it("falls back when the server rejects a line", async () => {
    const { tts } = engine(async (url) =>
      url.endsWith("/health") ? Response.json({ ok: true }) : new Response("boom", { status: 500 }),
    );
    expect((await tts.voice("x", CHARACTERS.sunny)).audio).toBeNull();
  });
});
