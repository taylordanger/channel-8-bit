/**
 * Deterministic chiptune songwriting. A SongSpec (a seed plus a few choices) expands into
 * the same notes on every machine, so every viewer's browser plays - and every renderer
 * animates - exactly the same performance in sync, with nothing but the spec on the wire.
 */

export type MusicStyle = "synthpop" | "rock" | "punk" | "ballad";
export type Instrument = "kick" | "snare" | "hat" | "bass" | "chord" | "lead";

export interface Section {
  name: string;
  bars: number;
  /** Drums play in this section (intros often start without them). */
  drums: boolean;
  /** The singer (lead line) performs in this section. */
  lead: boolean;
}

export interface SongSpec {
  title: string;
  artist: string;
  style: MusicStyle;
  seed: number;
  bpm: number;
  /** MIDI note of the key's root (e.g. 45 = A2). */
  root: number;
  sections: Section[];
  /** Offset from segment start when the song begins (after the host's intro). */
  startMs: number;
}

export interface NoteEvent {
  /** ms from song start */
  t: number;
  dur: number;
  inst: Instrument;
  /** MIDI pitch (ignored for drums). */
  pitch: number;
}

export interface Song {
  events: NoteEvent[];
  beatMs: number;
  totalMs: number;
  /** When the drums first come in (ms from song start). */
  drumsStartMs: number;
  sections: (Section & { startMs: number })[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Chord progressions as scale degrees (0-based), per style. */
const PROGRESSIONS: Record<MusicStyle, { scale: number[]; prog: number[][] }> = {
  synthpop: { scale: MINOR, prog: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0]] },
  rock: { scale: MAJOR, prog: [[0, 3, 4, 3], [0, 4, 3, 0], [0, 6, 3, 0]] },
  punk: { scale: MAJOR, prog: [[0, 4, 5, 3], [0, 3, 4, 4], [5, 3, 0, 4]] },
  ballad: { scale: MAJOR, prog: [[0, 5, 3, 4], [0, 2, 3, 4], [3, 4, 0, 5]] },
};

/** Scale degree -> MIDI pitch, wrapping octaves. */
function degree(root: number, scale: number[], d: number): number {
  const oct = Math.floor(d / 7);
  return root + scale[((d % 7) + 7) % 7] + 12 * oct;
}

export function generateSong(spec: SongSpec): Song {
  const r = mulberry32(spec.seed);
  const { scale, prog: progs } = PROGRESSIONS[spec.style];
  const prog = progs[Math.floor(r() * progs.length)];
  const beatMs = 60_000 / spec.bpm;
  const barMs = beatMs * 4;
  const events: NoteEvent[] = [];
  const sections: Song["sections"] = [];
  let t = 0;
  let bar = 0;
  let drumsStartMs = -1;

  // A two-bar melodic motif per song, varied per phrase: memorable, not random noise.
  const motif = Array.from({ length: 8 }, () => ({
    step: Math.floor(r() * 5) - 2,
    rest: r() < 0.22,
    long: r() < 0.3,
  }));

  for (const sec of spec.sections) {
    sections.push({ ...sec, startMs: t });
    if (sec.drums && drumsStartMs < 0) drumsStartMs = t;
    for (let b = 0; b < sec.bars; b++, bar++) {
      const chordDeg = prog[bar % prog.length];
      const bt = t + b * barMs;
      const chordRoot = degree(spec.root, scale, chordDeg);

      // Bass
      if (spec.style === "ballad") {
        events.push({ t: bt, dur: barMs * 0.48, inst: "bass", pitch: chordRoot }, { t: bt + barMs / 2, dur: barMs * 0.48, inst: "bass", pitch: chordRoot + 7 });
      } else {
        for (let i = 0; i < 8; i++) {
          const octave = spec.style === "synthpop" && i % 2 === 1 ? 12 : 0;
          events.push({ t: bt + (i * barMs) / 8, dur: barMs / 8 - 10, inst: "bass", pitch: chordRoot + octave });
        }
      }

      // Chords / rhythm part
      const triad = [0, 2, 4].map((x) => degree(spec.root + 12, scale, chordDeg + x));
      if (spec.style === "synthpop") {
        for (let i = 0; i < 16; i++) events.push({ t: bt + (i * barMs) / 16, dur: barMs / 16 - 8, inst: "chord", pitch: triad[i % 3] + (i % 6 >= 3 ? 12 : 0) });
      } else if (spec.style === "ballad") {
        for (const p of triad) events.push({ t: bt, dur: barMs - 20, inst: "chord", pitch: p });
      } else {
        // Power chords: root + fifth, chugging on the beat (eighths for punk).
        const hits = spec.style === "punk" ? 8 : 4;
        for (let i = 0; i < hits; i++)
          for (const p of [chordRoot + 12, chordRoot + 19])
            events.push({ t: bt + (i * barMs) / hits, dur: barMs / hits - 15, inst: "chord", pitch: p });
      }

      // Drums
      if (sec.drums) {
        for (let i = 0; i < 8; i++) {
          const et = bt + (i * barMs) / 8;
          const beat = i / 2;
          const onBeat = i % 2 === 0;
          let kick = false;
          let snare = false;
          if (spec.style === "synthpop") kick = onBeat;
          else if (spec.style === "punk") (kick = i % 2 === 0), (snare = i % 2 === 1);
          else if (spec.style === "ballad") (kick = i === 0), (snare = i === 4);
          else (kick = beat === 0 || beat === 2 || i === 5), (snare = beat === 1 || beat === 3);
          if (spec.style === "synthpop") snare = beat === 1 || beat === 3;
          if (kick) events.push({ t: et, dur: 120, inst: "kick", pitch: 0 });
          if (snare) events.push({ t: et, dur: 120, inst: "snare", pitch: 0 });
          if (spec.style !== "ballad" || onBeat) events.push({ t: et, dur: 40, inst: "hat", pitch: 0 });
        }
      }

      // Lead "vocal" line: the motif, transposed to follow the chords.
      if (sec.lead) {
        const half = b % 2;
        let d = chordDeg + 7; // an octave up from the chord's scale degree
        for (let i = 0; i < 4; i++) {
          const m = motif[half * 4 + i];
          d += m.step;
          if (m.rest) continue;
          const dur = (m.long ? beatMs * 1.8 : beatMs * 0.9) - 20;
          events.push({ t: bt + i * beatMs, dur, inst: "lead", pitch: degree(spec.root + 12, scale, d) });
        }
      }
    }
    t += sec.bars * barMs;
  }
  events.sort((a, b) => a.t - b.t);
  return { events, beatMs, totalMs: t, drumsStartMs, sections };
}

/** A standard song shape for a style, sized to roughly `targetMs`. */
export function songShape(style: MusicStyle, bpm: number, targetMs: number, vocals: boolean): Section[] {
  const barMs = (60_000 / bpm) * 4;
  const totalBars = Math.max(12, Math.round(targetMs / barMs / 4) * 4);
  const intro = 4;
  const outro = 4;
  const body = totalBars - intro - outro;
  const verse = Math.max(4, Math.round(body * 0.3 / 4) * 4);
  const chorus = Math.max(4, Math.round((body - verse * 2) / 2 / 4) * 4);
  return [
    { name: "intro", bars: intro, drums: false, lead: false },
    { name: "verse", bars: verse, drums: true, lead: vocals },
    { name: "chorus", bars: chorus, drums: true, lead: vocals },
    { name: "verse", bars: verse, drums: true, lead: vocals },
    { name: "chorus", bars: chorus, drums: true, lead: vocals },
    { name: "outro", bars: outro, drums: style !== "ballad", lead: false },
  ];
}

/** A real recorded track (e.g. from Suno) performed by a band, with what the station heard in it. */
export interface TrackSpec {
  title: string;
  artist: string;
  url: string;
  durationMs: number;
  bpm: number;
  beatOffsetMs: number;
  /** When the drums come in (-1: never). */
  drumsStartMs: number;
  /** Singing loudness, one digit 0-9 per 50ms. */
  vocalEnv: string;
  /** Offset from segment start when the track begins. */
  startMs: number;
}
