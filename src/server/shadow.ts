import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { Segment } from "../shared/types.js";
import { buildStation } from "./build.js";
import { slotAt } from "./catalog/schedule.js";
import { ManualClock } from "./clock.js";
import { loadConfig, type StationConfig } from "./config.js";
import { SilentTTS } from "./tts.js";
import { ImprovWriter } from "./writers/improv.js";
import type { Writer } from "./writers/script.js";

export interface ShadowOptions {
  startAt: number;
  hours: number;
  stepMs?: number;
  /** Who's watching at time t. Default: someone always is. */
  viewersAt?: (t: number) => number;
  writers?: Writer[];
  config?: Partial<StationConfig>;
}

export interface ShadowReport {
  segments: number;
  byKind: Record<string, number>;
  byShow: Record<string, number>;
  /** Seconds with a viewer present but nothing on the timeline. */
  deadAirSec: number;
  /** Segments that started while nobody had been watching for longer than the grace period. */
  producedWhileIdle: number;
  violations: string[];
}

/**
 * A shadow station: the real pipeline on a fake clock with a free writer and no audio.
 * Run it before touching the live station - it surfaces schedule, timing and continuity
 * bugs across a whole simulated day in seconds.
 */
export async function runShadow(o: ShadowOptions): Promise<ShadowReport> {
  const clock = new ManualClock(o.startAt);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-"));
  const config: StationConfig = { ...loadConfig({}), dataDir, tts: "silent", writer: "improv", ...o.config };
  const b = buildStation(config, {
    clock,
    dbFile: ":memory:",
    tts: new SilentTTS(),
    writers: o.writers ?? [new ImprovWriter(42)],
  });
  const step = o.stepMs ?? 5000;
  const viewersAt = o.viewersAt ?? (() => 1);
  const end = o.startAt + o.hours * 3_600_000;
  let deadAir = 0;
  let lastViewer = -Infinity;
  const idleStarts: number[] = [];

  while (clock.now() < end) {
    const t = clock.now();
    const v = viewersAt(t);
    b.governor.setViewers(v, t);
    if (v > 0) lastViewer = t;
    const produced = await b.station.tick();
    if (produced && t - lastViewer > config.idleGraceMs) idleStarts.push(t);
    if (v > 0 && !b.timeline.at(t)) deadAir += step;
    clock.advance(step);
  }

  const segments = b.timeline.range(o.startAt - 1, end + 3_600_000);
  const report: ShadowReport = {
    segments: segments.length,
    byKind: {},
    byShow: {},
    deadAirSec: deadAir / 1000,
    producedWhileIdle: idleStarts.length,
    violations: checkInvariants(segments, config.timeZone),
  };
  for (const s of segments) {
    report.byKind[s.kind] = (report.byKind[s.kind] ?? 0) + 1;
    report.byShow[s.showId] = (report.byShow[s.showId] ?? 0) + 1;
  }
  b.db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  return report;
}

/** Properties that must hold for any timeline the station produces. */
export function checkInvariants(segments: Segment[], timeZone: string): string[] {
  const v: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const label = `${s.showId} "${s.title}" @${new Date(s.startAt).toISOString()}`;
    if (i > 0) {
      const prev = segments[i - 1];
      if (prev.startAt + prev.durationMs > s.startAt) v.push(`overlap: ${label}`);
    }
    if (s.durationMs <= 0) v.push(`non-positive duration: ${label}`);
    if (s.kind !== "bumper" && !s.ad) {
      const scheduled = slotAt(s.startAt, timeZone).showId;
      // A segment may start a hair after its slot ends (production latency); allow 3 minutes of spill.
      const spill = slotAt(s.startAt - 180_000, timeZone).showId;
      if (s.showId !== scheduled && s.showId !== spill) v.push(`off-schedule: ${label} (slot is ${scheduled})`);
    }
    const castIds = new Set(s.cast.map((c) => c.id));
    let lastEnd = 0;
    for (const c of s.cues) {
      if (!castIds.has(c.speaker)) v.push(`uncast speaker ${c.speaker}: ${label}`);
      if (c.t < lastEnd) v.push(`overlapping cues: ${label}`);
      if (c.t + c.dur > s.durationMs) v.push(`cue past segment end: ${label}`);
      if (!c.text.trim()) v.push(`empty line: ${label}`);
      lastEnd = c.t + c.dur;
    }
    if (s.kind === "live" && s.cues.length === 0) v.push(`live segment with no lines: ${label}`);
  }
  return v;
}

// CLI: npm run shadow -- [hours]
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const hours = Number(process.argv[2] ?? 24);
  const start = Date.now();
  // Realistic audience: dead between 3 and 6am, otherwise someone drifts in and out.
  const report = await runShadow({
    startAt: start,
    hours,
    viewersAt: (t) => {
      const h = new Date(t).getHours();
      if (h >= 3 && h < 6) return 0;
      return Math.floor(t / 600_000) % 5 === 0 ? 0 : 3;
    },
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.violations.length ? 1 : 0);
}
