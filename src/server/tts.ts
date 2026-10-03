import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ENVELOPE_STEP_MS } from "../shared/types.js";
import type { Character } from "./catalog/characters.js";
import { estimateSpeechMs } from "./writers/script.js";

const run = promisify(execFile);

export interface Voiced {
  /** Public URL path ("/media/<file>") or null for silent lines. */
  audio: string | null;
  durationMs: number;
  /** Mouth envelope: one digit 0-9 per ENVELOPE_STEP_MS. */
  env: string;
}

export interface TTSEngine {
  readonly name: string;
  voice(text: string, character: Character): Promise<Voiced>;
}

/** No audio; duration estimated from word count; mouth flaps on a fake syllable rhythm. */
export class SilentTTS implements TTSEngine {
  readonly name = "silent";
  async voice(text: string, _character?: Character): Promise<Voiced> {
    const durationMs = estimateSpeechMs(text);
    const steps = Math.ceil(durationMs / ENVELOPE_STEP_MS);
    let env = "";
    for (let i = 0; i < steps; i++) env += i % 4 === 3 ? "1" : String(4 + ((i * 7) % 5));
    return { audio: null, durationMs, env };
  }
}

/** Parse 16-bit PCM WAV, walking chunks (macOS writes a JUNK chunk before fmt). */
export function readWav(buf: Buffer): { sampleRate: number; samples: Int16Array } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let off = 12;
  let sampleRate = 0;
  let channels = 1;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      if (buf.readUInt16LE(body + 14) !== 16) throw new Error("expected 16-bit PCM");
    } else if (id === "data") {
      const end = Math.min(body + size, buf.length);
      const frames = Math.floor((end - body) / (2 * channels));
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = buf.readInt16LE(body + i * 2 * channels);
      return { sampleRate, samples };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** RMS loudness per window, mapped to 0-9 with a noise gate - drives the mouth sprite. */
export function envelope(samples: Int16Array, sampleRate: number, stepMs = ENVELOPE_STEP_MS): string {
  const win = Math.max(1, Math.round((sampleRate * stepMs) / 1000));
  const rms: number[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const gate = peak * 0.08;
  return rms.map((v) => (v < gate ? "0" : String(Math.min(9, Math.max(1, Math.round((v / peak) * 9)))))).join("");
}

/** macOS built-in speech. Free, offline, decent; each character has their own voice and rate. */
export class SayTTS implements TTSEngine {
  readonly name = "say";
  private hasFfmpeg: Promise<boolean>;

  constructor(private mediaDir: string) {
    fs.mkdirSync(mediaDir, { recursive: true });
    this.hasFfmpeg = run("ffmpeg", ["-version"]).then(
      () => true,
      () => false,
    );
  }

  async voice(text: string, ch: Character): Promise<Voiced> {
    const key = crypto.createHash("sha1").update(`${ch.voice.say}|${ch.voice.rate}|${text}`).digest("hex").slice(0, 16);
    const wav = path.join(this.mediaDir, `${key}.wav`);
    const mp3 = path.join(this.mediaDir, `${key}.mp3`);
    const envFile = path.join(this.mediaDir, `${key}.env`);

    if (fs.existsSync(envFile)) return JSON.parse(fs.readFileSync(envFile, "utf8")) as Voiced;

    // Text goes through a file, never argv, so lines starting with "-" can't become flags.
    const txt = path.join(this.mediaDir, `${key}.txt`);
    fs.writeFileSync(txt, text);
    try {
      await run("say", ["-v", ch.voice.say, "-r", String(ch.voice.rate), "-f", txt, "-o", wav, "--data-format=LEI16@22050"]);
    } finally {
      fs.rmSync(txt, { force: true });
    }
    const { sampleRate, samples } = readWav(fs.readFileSync(wav));
    const durationMs = Math.round((samples.length / sampleRate) * 1000);
    const env = envelope(samples, sampleRate);

    let file = path.basename(wav);
    if (await this.hasFfmpeg) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-b:a", "64k", mp3]);
      fs.rmSync(wav, { force: true });
      file = path.basename(mp3);
    }
    const voiced: Voiced = { audio: `/media/${file}`, durationMs, env };
    fs.writeFileSync(envFile, JSON.stringify(voiced));
    return voiced;
  }
}

/** Voices this Mac actually has installed, so a missing voice fails at startup, not on air. */
export async function installedSayVoices(): Promise<Set<string>> {
  const { stdout } = await run("say", ["-v", "?"]);
  // Lines look like "Eddy (English (US)) en_US    # Hello!" - the locale is sometimes only one space away.
  // `say -v` also accepts the short name ("Aman" for "Aman (English (India))"), so register both.
  const names = new Set<string>();
  for (const l of stdout.split("\n")) {
    const full = l.split("#")[0].trim().replace(/\s+[a-z]{2,3}_[A-Z0-9]{2,3}$/, "").trim();
    if (!full) continue;
    names.add(full);
    names.add(full.replace(/\s*\(.*\)$/, ""));
  }
  return names;
}
