import type { Segment } from "../shared/types.js";

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
      seg.cues.forEach((cue, i) => {
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
