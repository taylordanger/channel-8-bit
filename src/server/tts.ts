import { execFile, spawn, type ChildProcess } from "node:child_process";
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

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface KokoroOptions {
  mediaDir: string;
  /** Python with kokoro-onnx installed (the project's .venv-tts). */
  python: string;
  script: string;
  modelDir: string;
  port: number;
  /** Used when Kokoro is unavailable or fails on a line. */
  fallback: TTSEngine;
  fetcher?: Fetcher;
  /** Start the Python server if it isn't already running (off in tests). */
  autoStart?: boolean;
  log?: (msg: string) => void;
}

/**
 * Kokoro: a free, local neural TTS model with far more natural voices than macOS speech.
 * Runs as a small Python server (tts/kokoro_server.py) that loads the model once.
 */
export class KokoroTTS implements TTSEngine {
  readonly name = "kokoro";
  private child?: ChildProcess;
  private ready?: Promise<boolean>;
  private hasFfmpeg: Promise<boolean>;
  private fetcher: Fetcher;
  private warned = false;

  constructor(private o: KokoroOptions) {
    fs.mkdirSync(o.mediaDir, { recursive: true });
    this.fetcher = o.fetcher ?? fetch;
    this.hasFfmpeg = run("ffmpeg", ["-version"]).then(
      () => true,
      () => false,
    );
  }

  private get base() {
    return `http://127.0.0.1:${this.o.port}`;
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await this.fetcher(`${this.base}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Make sure the server is up, starting it once if allowed. Resolves false if it can't be. */
  ensure(): Promise<boolean> {
    this.ready ??= (async () => {
      if (await this.healthy()) return true;
      if (this.o.autoStart === false) return false;
      this.o.log?.("starting the Kokoro voice server...");
      this.child = spawn(this.o.python, [this.o.script], {
        env: { ...process.env, KOKORO_DIR: this.o.modelDir, KOKORO_PORT: String(this.o.port) },
        stdio: ["ignore", "ignore", "pipe"],
      });
      this.child.stderr?.on("data", (d: Buffer) => {
        const msg = String(d).trim();
        if (msg && !/Warning|warn/i.test(msg)) this.o.log?.(`kokoro: ${msg.slice(0, 300)}`);
      });
      this.child.on("exit", (code) => {
        this.o.log?.(`Kokoro voice server exited (${code}); using macOS voices until restart`);
        this.ready = Promise.resolve(false);
      });
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await this.healthy()) {
          this.o.log?.("Kokoro voice server ready");
          return true;
        }
      }
      return false;
    })();
    return this.ready;
  }

  stop(): void {
    this.child?.kill();
  }

  async voice(text: string, ch: Character): Promise<Voiced> {
    const { kokoro, speed } = ch.voice;
    const key = crypto.createHash("sha1").update(`kokoro|${kokoro}|${speed}|${text}`).digest("hex").slice(0, 16);
    const envFile = path.join(this.o.mediaDir, `${key}.env`);
    if (fs.existsSync(envFile)) return JSON.parse(fs.readFileSync(envFile, "utf8")) as Voiced;

    try {
      if (!(await this.ensure())) throw new Error("Kokoro server unavailable");
      const res = await this.fetcher(`${this.base}/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: kokoro, speed }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`kokoro ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const wavBuf = Buffer.from(await res.arrayBuffer());
      const { sampleRate, samples } = readWav(wavBuf);
      const wav = path.join(this.o.mediaDir, `${key}.wav`);
      fs.writeFileSync(wav, wavBuf);
      let file = path.basename(wav);
      if (await this.hasFfmpeg) {
        const mp3 = path.join(this.o.mediaDir, `${key}.mp3`);
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-b:a", "64k", mp3]);
        fs.rmSync(wav, { force: true });
        file = path.basename(mp3);
      }
      const voiced: Voiced = {
        audio: `/media/${file}`,
        durationMs: Math.round((samples.length / sampleRate) * 1000),
        env: envelope(samples, sampleRate),
      };
      fs.writeFileSync(envFile, JSON.stringify(voiced));
      return voiced;
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        this.o.log?.(`Kokoro failed (${(e as Error).message}); falling back to macOS voices for now`);
      }
      return this.o.fallback.voice(text, ch);
    }
  }
}

/** Whether the Kokoro model files and Python environment are present. */
export function kokoroInstalled(root: string, modelDir: string): boolean {
  return (
    fs.existsSync(path.join(modelDir, "kokoro-v1.0.onnx")) &&
    fs.existsSync(path.join(modelDir, "voices-v1.0.bin")) &&
    fs.existsSync(path.join(root, ".venv-tts", "bin", "python"))
  );
}
