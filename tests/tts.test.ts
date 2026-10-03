import { describe, expect, it } from "vitest";
import { envelope, readWav, SilentTTS } from "../src/server/tts.js";
import { CHARACTERS } from "../src/server/catalog/characters.js";

function wav(samples: number[], rate = 8000, junk = true): Buffer {
  const chunks: Buffer[] = [];
  if (junk) {
    const j = Buffer.alloc(8 + 28);
    j.write("JUNK", 0);
    j.writeUInt32LE(28, 4);
    chunks.push(j);
  }
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  chunks.push(fmt);
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write("data", 0);
  data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((s, i) => data.writeInt16LE(s, 8 + i * 2));
  chunks.push(data);
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0);
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WAVE", 8);
  return Buffer.concat([head, body]);
}

describe("tts", () => {
  it("reads WAVs that carry a JUNK chunk before fmt (as macOS writes them)", () => {
    const { sampleRate, samples } = readWav(wav([1, -2, 3]));
    expect(sampleRate).toBe(8000);
    expect([...samples]).toEqual([1, -2, 3]);
  });

  it("envelope is closed in silence and open when loud", () => {
    const silence = new Array(800).fill(0); // 100ms
    const loud = Array.from({ length: 800 }, (_, i) => Math.round(Math.sin(i / 3) * 20000));
    const env = envelope(Int16Array.from([...silence, ...loud, ...silence]), 8000);
    expect(env).toHaveLength(6);
    expect(env.slice(0, 2)).toBe("00");
    expect(Number(env[2])).toBeGreaterThanOrEqual(7);
    expect(env.slice(4)).toBe("00");
  });

  it("silent TTS produces an envelope matching its duration", async () => {
    const v = await new SilentTTS().voice("one two three four five six seven eight", CHARACTERS.rex);
    expect(v.audio).toBeNull();
    expect(v.env.length).toBe(Math.ceil(v.durationMs / 50));
  });
});
