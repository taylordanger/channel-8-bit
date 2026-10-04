import type { Segment } from "../shared/types.js";
import { generateSong, type MusicStyle, type NoteEvent, type Song } from "../shared/music.js";

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const LOOKAHEAD_MS = 8000;

/**
 * Schedules every voiced line against station time. Joining mid-line starts the
 * clip at the right offset, so a late arrival hears exactly what everyone else hears.
 */
export class AudioDirector {
  readonly ctx = new AudioContext();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private scheduled = new Map<string, AudioBufferSourceNode>();
  private master = this.ctx.createGain();
  private applauseAt = new Set<string>();

  constructor() {
    this.master.connect(this.ctx.destination);
  }

  /** Stop anything scheduled for segments that were pulled before airing. */
  retract(ids: string[]) {
    for (const [key, src] of this.scheduled) {
      if (!ids.some((id) => key.startsWith(id + ":"))) continue;
      try {
        src?.stop();
      } catch {
        /* not started yet */
      }
      this.scheduled.delete(key);
    }
  }

  /** A copy of everything this director plays, for broadcast capture. */
  tap(): MediaStream {
    const dest = this.ctx.createMediaStreamDestination();
    this.master.connect(dest);
    return dest.stream;
  }

  setMuted(m: boolean) {
    this.master.gain.value = m ? 0 : 1;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }

  /** Call often. Loads upcoming clips and schedules any that are due. */
  update(segments: Segment[], stationNow: number): void {
    for (const seg of segments) {
      if (seg.startAt > stationNow + LOOKAHEAD_MS || seg.startAt + seg.durationMs < stationNow) continue;
      // Scene stings: slap bass into sitcom scenes, a jingle for the cartoon.
      if (seg.set === "sitcom_apartment" || seg.set === "diner") this.sting(seg.id, seg.startAt, stationNow, "slapbass");
      if (seg.set === "family_couch") this.sting(seg.id, seg.startAt, stationNow, "jingle");
      if (seg.song) this.playSong(seg, stationNow);
      seg.cues.forEach((cue, i) => {
        const laughAt = seg.startAt + cue.t + cue.dur;
        if (cue.laugh && laughAt > stationNow - 300 && laughAt < stationNow + LOOKAHEAD_MS) this.crowd(`${seg.id}:${i}:lt`, laughAt, stationNow, "laugh");
        const start = seg.startAt + cue.t;
        if (start > stationNow + LOOKAHEAD_MS || start + cue.dur < stationNow) return;
        if ((cue.action === "applause" || cue.action === "laugh") && seg.set === "late_night") this.crowd(seg.id + i, start, stationNow, cue.action);
        if (!cue.audio) return;
        const key = `${seg.id}:${i}`;
        if (this.scheduled.has(key)) return;
        this.scheduled.set(key, null as unknown as AudioBufferSourceNode); // claim the slot while loading
        void this.load(cue.audio).then((buf) => {
          if (!buf) return;
          // Re-read the clock after the async load; it may have taken a while.
          const delay = (start - this.stationNowAtCtx()) / 1000;
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.master);
          if (delay >= 0) src.start(this.ctx.currentTime + delay);
          else if (-delay < buf.duration) src.start(this.ctx.currentTime, -delay);
          else return;
          this.scheduled.set(key, src);
        });
      });
    }
    // Forget anything long finished.
    if (this.scheduled.size > 400) [...this.scheduled.keys()].slice(0, 200).forEach((k) => this.scheduled.delete(k));
    this.lastStationNow = stationNow;
    this.lastCtxTime = this.ctx.currentTime;
  }

  private lastStationNow = 0;
  private lastCtxTime = 0;
  private stationNowAtCtx(): number {
    return this.lastStationNow + (this.ctx.currentTime - this.lastCtxTime) * 1000;
  }

  private stung = new Set<string>();
  private songs = new Map<string, { song: Song; next: number }>();
  private noise?: AudioBuffer;
  private musicBus?: GainNode;

  /** Schedule the next stretch of a segment's song (a rolling window keeps node counts low). */
  private playSong(seg: Segment, now: number) {
    const spec = seg.song!;
    let st = this.songs.get(seg.id);
    if (!st) {
      st = { song: generateSong(spec), next: 0 };
      this.songs.set(seg.id, st);
      if (this.songs.size > 6) this.songs.delete(this.songs.keys().next().value!);
    }
    const songStart = seg.startAt + spec.startMs;
    if (!this.musicBus) {
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.5;
      this.musicBus.connect(this.master);
    }
    const ev = st.song.events;
    while (st.next < ev.length && songStart + ev[st.next].t < now + 1500) {
      const e = ev[st.next++];
      const delay = (songStart + e.t - now) / 1000;
      if (delay < -0.05) continue; // joined mid-song: skip what already played
      this.note(e, this.ctx.currentTime + Math.max(0, delay), spec.style);
    }
    // Applause when the last note fades.
    const endAt = songStart + st.song.totalMs;
    if (endAt > now - 300 && endAt < now + 8000) this.crowd(`${seg.id}:end`, endAt, now, "applause");
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** One synthesized note: drums from noise and sweeps, a formant-filtered "voice" for the lead. */
  private note(e: NoteEvent, when: number, style: MusicStyle) {
    const ctx = this.ctx;
    const out = this.musicBus!;
    const env = (g: GainNode, peak: number, attack: number, release: number) => {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(peak, when + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, when + release);
    };
    const dur = e.dur / 1000;
    if (e.inst === "kick") {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
      env(g, style === "ballad" ? 0.5 : 0.9, 0.003, 0.2);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.25);
    } else if (e.inst === "snare" || e.inst === "hat") {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const f = ctx.createBiquadFilter();
      f.type = e.inst === "snare" ? "bandpass" : "highpass";
      f.frequency.value = e.inst === "snare" ? 1800 : 7500;
      const g = ctx.createGain();
      env(g, e.inst === "snare" ? (style === "ballad" ? 0.25 : 0.5) : 0.14, 0.002, e.inst === "snare" ? 0.16 : 0.045);
      src.connect(f).connect(g).connect(out);
      src.start(when, Math.random() * 0.5);
      src.stop(when + 0.2);
    } else {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.frequency.value = midiHz(e.pitch);
      let last: AudioNode = o;
      if (e.inst === "bass") {
        o.type = style === "ballad" ? "triangle" : style === "synthpop" ? "square" : "sawtooth";
        f.type = "lowpass";
        f.frequency.value = 700;
        env(g, 0.28, 0.005, dur + 0.05);
      } else if (e.inst === "chord") {
        o.type = style === "synthpop" ? "square" : style === "ballad" ? "sine" : "sawtooth";
        f.type = "lowpass";
        f.frequency.value = style === "ballad" ? 1800 : 2600;
        if (style === "rock" || style === "punk") {
          const drive = ctx.createWaveShaper();
          const curve = new Float32Array(256);
          for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 4);
          drive.curve = curve;
          o.connect(drive);
          last = drive;
        }
        env(g, style === "ballad" ? 0.05 : style === "synthpop" ? 0.05 : 0.07, style === "ballad" ? 0.3 : 0.005, dur + 0.05);
      } else {
        // The singer: a sawtooth through "ah" formants, with vibrato - robotic, but it sings.
        o.type = "sawtooth";
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.value = midiHz(e.pitch) * 0.012;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(when);
        lfo.stop(when + dur + 0.2);
        const f2 = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 800;
        f.Q.value = 4;
        f2.type = "bandpass";
        f2.frequency.value = 1200;
        f2.Q.value = 5;
        o.connect(f2).connect(g);
        env(g, 0.5, 0.03, dur + 0.12);
      }
      last.connect(f).connect(g).connect(out);
      o.start(when);
      o.stop(when + dur + 0.25);
    }
  }

  /** Synthesized transition music, scheduled at a segment's start. */
  private sting(key: string, start: number, now: number, kind: "slapbass" | "jingle") {
    if (this.stung.has(key) || start < now - 500) return;
    this.stung.add(key);
    const t0 = this.ctx.currentTime + Math.max(0, (start - now) / 1000);
    // [semitones above the root, beat offset in eighths, length in eighths]
    const riff: [number, number, number][] =
      kind === "slapbass"
        ? [[0, 0, 1], [12, 1, 1], [7, 2, 1], [10, 3, 1], [12, 4, 1], [0, 5, 0.5], [3, 5.5, 0.5], [5, 6, 2]]
        : [[0, 0, 1], [4, 1, 1], [7, 2, 1], [12, 3, 1], [11, 4, 1], [12, 5, 3]];
    const root = kind === "slapbass" ? 41.2 : 523.25; // E1 thump, C5 chime
    const eighth = kind === "slapbass" ? 0.11 : 0.09;
    for (const [semi, at, len] of riff) {
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = kind === "slapbass" ? "sawtooth" : "triangle";
      osc.frequency.value = root * Math.pow(2, semi / 12) * (kind === "slapbass" ? 2 : 1);
      filter.type = "lowpass";
      filter.frequency.value = kind === "slapbass" ? 900 : 4000;
      const s0 = t0 + at * eighth;
      amp.gain.setValueAtTime(0, s0);
      amp.gain.linearRampToValueAtTime(kind === "slapbass" ? 0.35 : 0.12, s0 + 0.005);
      amp.gain.exponentialRampToValueAtTime(0.001, s0 + len * eighth * 1.6);
      osc.connect(filter).connect(amp).connect(this.master);
      osc.start(s0);
      osc.stop(s0 + len * eighth * 1.8);
    }
  }

  /** A synthesized studio audience: filtered noise swells. */
  private crowd(key: string, start: number, now: number, kind: "applause" | "laugh") {
    if (this.applauseAt.has(key)) return;
    this.applauseAt.add(key);
    const delay = Math.max(0, (start - now) / 1000);
    const dur = kind === "applause" ? 2.2 : 1.4;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (len * 0.15)) * Math.min(1, (len - i) / (len * 0.4));
      const clap = kind === "applause" ? (Math.random() < 0.06 ? 1 : 0.35) : 0.5 + 0.5 * Math.sin(i / 900);
      d[i] = (Math.random() * 2 - 1) * env * clap * 0.25;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = kind === "applause" ? 2500 : 900;
    src.connect(filter).connect(this.master);
    src.start(this.ctx.currentTime + delay);
  }
}
