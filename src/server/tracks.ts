import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { TrackSpec } from "../shared/music.js";
import { ENVELOPE_STEP_MS } from "../shared/types.js";

const run = promisify(execFile);

/** What the station learned from listening to a track (cached next to the library). */
export interface TrackAnalysis {
  durationMs: number;
  bpm: number;
  /** Time of the first beat of the grid. */
  beatOffsetMs: number;
  /** When the drums come in (-1 if they never do). */
  drumsStartMs: number;
  /** Singing loudness, one digit 0-9 per ENVELOPE_STEP_MS (from the vocal stem when there is one). */
  vocalEnv: string;
  /** Whether a separate vocal stem was used for the mouth. */
  fromStem: boolean;
}

export interface LibraryTrack {
  artistId: string;
  title: string;
  /** Path relative to the music root, used in the public URL. */
  file: string;
  analysis: TrackAnalysis;
}

const AUDIO = /\.(mp3|wav|m4a|ogg|flac|aac)$/i;
const SR = 22050;
const HOP = 512; // ~23ms frames

/** Decode any audio file to mono float samples at SR with ffmpeg. */
async function decode(file: string): Promise<Float32Array> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], {
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 400,
  });
  const buf = stdout as unknown as Buffer;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** One-pole low-pass filter (in place copy). */
function lowpass(x: Float32Array, cutoffHz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  const y = new Float32Array(x.length);
  let prev = 0;
  for (let i = 0; i < x.length; i++) prev = y[i] = (1 - a) * x[i] + a * prev;
  return y;
}

function frameEnergy(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) s += x[i] * x[i];
    e[f] = s / HOP;
  }
  return e;
}

/** Positive changes in log energy: where things start. */
function onsets(e: Float32Array): Float32Array {
  const o = new Float32Array(e.length);
  for (let i = 1; i < e.length; i++) o[i] = Math.max(0, Math.log(e[i] + 1e-9) - Math.log(e[i - 1] + 1e-9));
  return o;
}

const quantile = (xs: ArrayLike<number>, q: number) => {
  const a = Array.from(xs).sort((p, r) => p - r);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0;
};

/** Tempo from the autocorrelation of the onset envelope, preferring moderate tempos. */
export function estimateTempo(onset: Float32Array, frameMs: number): { bpm: number; periodFrames: number } {
  let best = { score: -1, lag: 1 };
  const minLag = Math.round(60_000 / 190 / frameMs);
  const maxLag = Math.round(60_000 / 65 / frameMs);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    const bpm = 60_000 / (lag * frameMs);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); // gentle preference for ~120
    if (s * prior > best.score) best = { score: s * prior, lag };
  }
  // Refine with sub-frame precision by parabolic interpolation around the peak.
  const ac = (lag: number) => {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    return s;
  };
  const [a, b, c] = [ac(best.lag - 1), ac(best.lag), ac(best.lag + 1)];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const periodFrames = best.lag + Math.max(-0.5, Math.min(0.5, shift));
  return { bpm: 60_000 / (periodFrames * frameMs), periodFrames };
}

/** Listen to a track: tempo, beat grid, where the drums come in, and the singing envelope. */
export async function analyzeTrack(file: string, vocalStem?: string): Promise<TrackAnalysis> {
  const x = await decode(file);
  const frameMs = (HOP / SR) * 1000;
  const full = frameEnergy(x);
  const onset = onsets(full);
  const { bpm, periodFrames } = estimateTempo(onset, frameMs);

  // Clear hits: local maxima of the onset envelope well above the noise floor.
  const peaksOf = (env: Float32Array, frac: number) => {
    const th = quantile(env, 0.98) * frac;
    const out: number[] = [];
    for (let f = 1; f < env.length - 1; f++) if (env[f] > th && env[f] >= env[f - 1] && env[f] > env[f + 1]) out.push(f);
    return out;
  };
  const peaks = peaksOf(onset, 0.3);

  // Fit the beat grid to the hits: index each hit by its nearest beat, then least-squares
  // for period and offset; repeat dropping the off-grid hits (syncopation, fills).
  let period = periodFrames;
  let offset = peaks[0] ?? 0;
  for (let pass = 0; pass < 3 && peaks.length >= 8; pass++) {
    const pts = peaks
      .map((f) => ({ k: Math.round((f - offset) / period), f }))
      .filter((p) => Math.abs(p.f - (offset + p.k * period)) < period * (pass === 0 ? 0.25 : 0.12));
    if (pts.length < 8) break;
    const n = pts.length;
    const mk = pts.reduce((a, p) => a + p.k, 0) / n;
    const mf = pts.reduce((a, p) => a + p.f, 0) / n;
    const den = pts.reduce((a, p) => a + (p.k - mk) ** 2, 0);
    if (den === 0) break;
    const slope = pts.reduce((a, p) => a + (p.k - mk) * (p.f - mf), 0) / den;
    if (slope <= 0) break;
    period = slope;
    offset = mf - slope * mk;
  }
  while (offset - period >= 0) offset -= period;
  while (offset < 0) offset += period;

  // Drums: the first low-band (kick) hit that starts a steady run - at least three more
  // kicks landing on the grid within the next four and a half beats.
  const low = onsets(frameEnergy(lowpass(x, 140)));
  const kicks = peaksOf(low, 0.3).filter((f) => {
    const k = Math.round((f - offset) / period);
    return Math.abs(f - (offset + k * period)) < period * 0.2;
  });
  let drumsStartMs = -1;
  for (let i = 0; i < kicks.length; i++) {
    const run = kicks.filter((f) => f > kicks[i] && f <= kicks[i] + period * 4.5).length;
    if (run >= 3) {
      drumsStartMs = Math.round(kicks[i] * frameMs);
      break;
    }
  }
  const bpmOut = 60_000 / (period * frameMs);
  const offsetFrames = offset;

  // Singing: the vocal stem's loudness if we have it; otherwise the mid band (voice range)
  // where it stands out from the rest of the mix.
  const step = Math.round((ENVELOPE_STEP_MS / 1000) * SR);
  let vocalEnv = "";
  if (vocalStem) {
    const v = await decode(vocalStem);
    vocalEnv = envelopeOf(v, step, 0.12);
  } else {
    const hi = lowpass(x, 3000);
    const lo = lowpass(x, 300);
    const mid = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) mid[i] = hi[i] - lo[i];
    vocalEnv = envelopeOf(mid, step, 0.35);
  }

  return {
    durationMs: Math.round((x.length / SR) * 1000),
    bpm: Math.round(bpmOut * 10) / 10,
    beatOffsetMs: Math.round(offsetFrames * frameMs),
    drumsStartMs,
    vocalEnv,
    fromStem: Boolean(vocalStem),
  };
}

/** RMS per step mapped to 0-9, gated so quiet passages close the mouth. */
function envelopeOf(x: Float32Array, step: number, gateFrac: number): string {
  const rms: number[] = [];
  for (let i = 0; i < x.length; i += step) {
    let s = 0;
    const end = Math.min(x.length, i + step);
    for (let j = i; j < end; j++) s += x[j] * x[j];
    rms.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const peak = quantile(rms, 0.95) || 1;
  return rms.map((v) => (v < peak * gateFrac ? "0" : String(Math.min(9, Math.max(1, Math.round((v / peak) * 9)))))).join("");
}

/**
 * The music library: data/music/<artist id>/<Song Title>.mp3 (+ optional "<Song Title>.vocals.mp3").
 * Tracks are analyzed once and cached; rescans pick up new files.
 */
export class TrackLibrary {
  private tracks: LibraryTrack[] = [];
  private scanning?: Promise<void>;

  constructor(
    readonly root: string,
    private log?: (m: string) => void,
  ) {
    fs.mkdirSync(path.join(root, ".analysis"), { recursive: true });
  }

  forArtist(artistId: string): LibraryTrack[] {
    return this.tracks.filter((t) => t.artistId === artistId);
  }

  all(): LibraryTrack[] {
    return [...this.tracks];
  }

  /** Find and analyze new tracks. Safe to call repeatedly. */
  scan(): Promise<void> {
    this.scanning ??= this.doScan().finally(() => (this.scanning = undefined));
    return this.scanning;
  }

  private async doScan(): Promise<void> {
    const found: LibraryTrack[] = [];
    if (!fs.existsSync(this.root)) return;
    for (const artistId of fs.readdirSync(this.root)) {
      const dir = path.join(this.root, artistId);
      if (artistId.startsWith(".") || !fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!AUDIO.test(name) || /\.vocals\.[a-z0-9]+$/i.test(name)) continue;
        const file = path.join(dir, name);
        const base = name.replace(AUDIO, "");
        const stem = fs.readdirSync(dir).find((n) => n.startsWith(base + ".vocals.") && AUDIO.test(n));
        const stat = fs.statSync(file);
        const key = crypto.createHash("sha1").update(`${artistId}/${name}|${stat.size}|${stat.mtimeMs}|${stem ?? ""}`).digest("hex").slice(0, 16);
        const cache = path.join(this.root, ".analysis", `${key}.json`);
        let analysis: TrackAnalysis;
        if (fs.existsSync(cache)) analysis = JSON.parse(fs.readFileSync(cache, "utf8"));
        else {
          try {
            this.log?.(`analyzing "${base}" for ${artistId}...`);
            analysis = await analyzeTrack(file, stem ? path.join(dir, stem) : undefined);
            fs.writeFileSync(cache, JSON.stringify(analysis));
            this.log?.(`"${base}": ${analysis.bpm} bpm, drums at ${(analysis.drumsStartMs / 1000).toFixed(1)}s, ${(analysis.durationMs / 1000).toFixed(0)}s long${analysis.fromStem ? ", vocal stem" : ""}`);
          } catch (e) {
            this.log?.(`couldn't analyze ${artistId}/${name}: ${(e as Error).message}`);
            continue;
          }
        }
        found.push({ artistId, title: base, file: `${artistId}/${name}`, analysis });
      }
    }
    this.tracks = found;
  }

  /** The TrackSpec a segment carries for a library track. */
  spec(t: LibraryTrack, artistName: string, startMs: number): TrackSpec {
    return {
      title: t.title,
      artist: artistName,
      url: "/music/" + t.file.split("/").map(encodeURIComponent).join("/"),
      durationMs: t.analysis.durationMs,
      bpm: t.analysis.bpm,
      beatOffsetMs: t.analysis.beatOffsetMs,
      drumsStartMs: t.analysis.drumsStartMs,
      vocalEnv: t.analysis.vocalEnv,
      startMs,
    };
  }
}
