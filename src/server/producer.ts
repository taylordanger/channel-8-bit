import crypto from "node:crypto";
import type { CastMember, Cue, Segment } from "../shared/types.js";
import { getCharacter, type Character } from "./catalog/characters.js";
import type { ScheduledSlot } from "./catalog/schedule.js";
import { getShow, type Show } from "./catalog/shows.js";
import type { TopicDesk } from "./desk.js";
import type { MemoryBank } from "./memory.js";
import { checkNames, checkNumbers, checkVerbatim, type SourceChecker } from "./factcheck.js";
import { CHARACTERS } from "./catalog/characters.js";
import { SHOWS } from "./catalog/shows.js";
import {
  deterministicStandards,
  type LlmStandards,
  type StandardsNote,
  type StandardsPolicy,
  type StandardsResult,
  DEFAULT_POLICY,
} from "./standards.js";
import type { Timeline } from "./timeline.js";
import type { TTSEngine } from "./tts.js";
import { rng } from "./writers/improv.js";
import type { Script, Writer, WriterBrief } from "./writers/script.js";

/** Names from the network's own fictional world, which the name check must never flag. */
const FICTIONAL_NAMES = [
  ...Object.values(CHARACTERS).map((c) => c.name),
  ...Object.values(SHOWS).map((s) => s.title),
  "Sterling Tower", "Detonation Highway", "Ghost in the Fax Machine", "Probably Fine", "Channel Bit", "The Interference",
];

/**
 * When buying time, an encore of a real scene from 20+ minutes ago is funnier than fresh
 * improv filler, so encores may repeat that soon (the improv troupe is the last resort).
 */
const ENCORE_FRESH_MS = 20 * 60_000;

/** Shortest slot remainder worth writing a real segment for; anything less becomes a bumper. */
export const MIN_SEGMENT_MS = 30_000;
export const MAX_SEGMENT_SEC = 150;
/** Length of the "we'll be right back" card aired when every writer fails. */
export const STANDBY_MS = 15_000;
const LEAD_IN_MS = 800;
const TAIL_MS = 1500;
const GAP_MS = 350;

export interface Produced {
  segment: Segment;
  summary: string;
  /** The final, standards-cleared script (absent for bumpers and reruns). */
  script?: Script;
  /** Written by the primary writer (not a fallback) - what pacing should measure. */
  primary?: boolean;
  notes: StandardsNote[];
  rerunOf?: string;
}

export interface ProducerDeps {
  timeline: Timeline;
  memory: MemoryBank;
  desk?: TopicDesk;
  tts: TTSEngine;
  /** Tried in order; the last one should never fail (the improv writer). */
  writers: Writer[];
  llmStandards?: LlmStandards;
  /** Verifies sourced segments against the submitted article. */
  factChecker?: SourceChecker;
  policy?: StandardsPolicy;
  timeZone: string;
  log?: (msg: string) => void;
}

export class Producer {
  constructor(private d: ProducerDeps) {}

  /**
   * @param opts.rerun air from the archive only (budget exhausted)
   * @param opts.coldStart the timeline is empty at "now" (a viewer just arrived); prefer an
   *   instant encore over making them wait for a writer
   */
  async produce(
    at: number,
    slot: ScheduledSlot,
    opts: { rerun: boolean; coldStart?: boolean; hurry?: boolean },
  ): Promise<Produced> {
    const remaining = slot.endAt - at;
    if (remaining < MIN_SEGMENT_MS) return this.bumper(slot, remaining);

    // Running low on air and the main writer is slow: an encore keeps the timeline ahead.
    if (opts.hurry) {
      const encore = this.rerun(slot.showId, remaining, at, ENCORE_FRESH_MS);
      if (encore) return encore;
      return this.live(at, slot, Math.min(MAX_SEGMENT_SEC, Math.floor((remaining - TAIL_MS) / 1000)), this.d.writers.slice(-1));
    }

    if (opts.rerun || opts.coldStart || slot.mode === "rerun") {
      const rerun = this.rerun(slot.showId, remaining, at, opts.coldStart ? ENCORE_FRESH_MS : undefined);
      if (rerun) return rerun;
      // A viewer is waiting on an empty channel: improvise now rather than wait on a slow writer.
      if (opts.coldStart) return this.live(at, slot, Math.min(MAX_SEGMENT_SEC, Math.floor((remaining - TAIL_MS) / 1000)), this.d.writers.slice(-1));
      // Nothing in the archive yet: fall through and improvise something fresh.
    }
    const writers = opts.rerun ? this.d.writers.slice(-1) : this.d.writers;
    try {
      return await this.live(at, slot, Math.min(MAX_SEGMENT_SEC, Math.floor((remaining - TAIL_MS) / 1000)), writers);
    } catch (err) {
      // The broadcast never goes dark: air a short standby card and try again next tick.
      this.d.log?.(`standing by: ${(err as Error).message}`);
      return this.bumper(slot, STANDBY_MS, "We'll be right back");
    }
  }

  private bumper(slot: ScheduledSlot, remaining: number, title = `Coming up: ${slot.title}`): Produced {
    const segment: Segment = {
      id: crypto.randomUUID(),
      showId: "station_id",
      showTitle: "",
      title,
      set: "bumper",
      startAt: 0,
      durationMs: Math.max(1000, remaining),
      cast: [],
      cues: [],
      kind: "bumper",
      writer: "station",
    };
    return { segment, summary: "", notes: [] };
  }

  /** An archived segment to re-air, skipping anything aired within `freshMs` (default 6 hours). */
  private rerun(showId: string, maxMs: number, at: number, freshMs = 6 * 3_600_000): Produced | undefined {
    const recentIds = this.d.timeline.airedIds(at - freshMs, at);
    const old = this.d.timeline.pickRerun(showId, maxMs, recentIds);
    if (!old) return undefined;
    // Characters get redesigned; encores show everyone as they look today.
    const cast = old.cast.map((m) => {
      try {
        return { ...m, look: getCharacter(m.id).look };
      } catch {
        return m;
      }
    });
    return {
      segment: { ...old, cast, id: crypto.randomUUID(), startAt: 0, kind: "rerun", title: `${old.title.replace(/ \(encore\)$/, "")} (encore)` },
      summary: "",
      notes: [],
      rerunOf: old.id,
    };
  }

  /** Assemble the brief: who's on, what they remember, how they feel, where the plot is. */
  brief(at: number, slot: ScheduledSlot, targetSeconds: number): WriterBrief {
    const show = getShow(slot.showId);
    const r = rng(Math.floor(at / 1000));
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const segmentType = pick(show.segmentTypes);

    // One guest per slot, so the whole night has a consistent booking.
    let guest: Character | undefined;
    if (show.guestPool?.length && /guest/.test(segmentType)) {
      guest = getCharacter(show.guestPool[Math.floor(slot.startAt / 3_600_000) % show.guestPool.length]);
    }
    const solo = show.soloFor?.[segmentType];
    const cast = solo ? [getCharacter(solo)] : [...show.cast.map(getCharacter), ...(guest ? [guest] : [])];
    const ids = cast.map((c) => c.id);
    const desk = this.d.desk?.nextFor(show.id);
    return {
      show,
      segmentType,
      topic: desk?.text ?? pick(show.topics),
      deskTopicId: desk?.id,
      source: desk?.fetchStatus === "ok" ? (desk.source ?? undefined) : undefined,
      cast,
      guest,
      targetSeconds: Math.max(20, targetSeconds),
      localTime: new Intl.DateTimeFormat("en-US", {
        timeZone: this.d.timeZone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(at)),
      previously: this.d.timeline.recentSummaries(show.id, at, 4),
      memories: this.d.memory.recall(ids, at, 12),
      relationships: this.d.memory.relationshipsAmong(ids),
      storyState: show.serialized ? this.d.memory.storyState(show.id) || (show.storySeed ?? "") : "",
      recentLines: this.d.timeline.recentLines(show.id, at, 6),
    };
  }

  private async live(at: number, slot: ScheduledSlot, targetSeconds: number, writers: Writer[]): Promise<Produced> {
    const brief = this.brief(at, slot, targetSeconds);
    let lastError = "";

    for (const writer of writers) {
      try {
        const { script: draft, writer: writerName } = await writer.write(brief);
        const checked = await this.clear(draft, brief, writer.name !== "improv");
        if (checked.rejected) {
          lastError = `${writer.name}: ${checked.rejected}`;
          this.d.log?.(`standards rejected a ${brief.show.id} script from ${writer.name}: ${checked.rejected}`);
          continue;
        }
        const segment = await this.assemble(brief.show, brief.cast, checked.script, writerName, brief.segmentType);
        if (brief.deskTopicId) this.d.desk?.markUsed(brief.deskTopicId, at);
        return {
          segment,
          summary: checked.script.summary,
          script: checked.script,
          notes: checked.notes,
          primary: writer === this.d.writers[0] && this.d.writers.length > 1,
        };
      } catch (err) {
        lastError = `${writer.name}: ${(err as Error).message}`;
        this.d.log?.(`writer ${writer.name} failed on ${brief.show.id}: ${(err as Error).message}`);
      }
    }
    throw new Error(`every writer failed (${lastError})`);
  }

  /**
   * Everything a script must pass before air, in order. Each model pass is followed by
   * the deterministic desk again, since rewrites are new text.
   */
  private async clear(draft: Script, brief: WriterBrief, modelPasses: boolean): Promise<StandardsResult> {
    const policy = this.d.policy ?? DEFAULT_POLICY;
    const notes: StandardsNote[] = [];
    const step = (r: StandardsResult) => {
      notes.push(...r.notes);
      return r;
    };
    let r = step(deterministicStandards(draft, brief, policy));
    if (r.rejected) return { ...r, notes };

    if (modelPasses && this.d.llmStandards && (brief.show.tier === "premium" || brief.source)) {
      r = step(await this.d.llmStandards.review(r.script, brief.show.id, Boolean(brief.source)));
      if (r.rejected) return { ...r, notes };
      r = step(deterministicStandards(r.script, brief, policy));
      if (r.rejected) return { ...r, notes };
    }

    if (brief.source) {
      r = step(checkVerbatim(r.script, brief.source));
      if (r.rejected) return { ...r, notes };
      r = step(checkNumbers(r.script, brief.source));
      if (r.rejected) return { ...r, notes };
      r = step(checkNames(r.script, brief.source, FICTIONAL_NAMES));
      if (r.rejected) return { ...r, notes };
      if (modelPasses && this.d.factChecker) {
        r = step(await this.d.factChecker.check(r.script, brief.source, brief.show.id));
        if (r.rejected) return { ...r, notes };
        r = step(deterministicStandards(r.script, brief, policy));
        if (r.rejected) return { ...r, notes };
        r = step(checkNumbers(r.script, brief.source));
        if (r.rejected) return { ...r, notes };
        r = step(checkNames(r.script, brief.source, FICTIONAL_NAMES));
        if (r.rejected) return { ...r, notes };
      }
    }
    return { script: r.script, notes };
  }

  /** Voice every line and lay the cues end to end. Durations come from the real audio. */
  async assemble(show: Show, cast: Character[], script: Script, writer: string, segmentType = ""): Promise<Segment> {
    const byId = new Map(cast.map((c) => [c.id, c]));
    // Voice lines a few at a time; timing is laid out afterwards from the real durations.
    const voices = await mapLimit(script.beats, 4, (b) => this.d.tts.voice(b.line, byId.get(b.speaker)!));
    const cues: Cue[] = [];
    let t = LEAD_IN_MS;
    for (const [i, b] of script.beats.entries()) {
      const voiced = voices[i];
      cues.push({
        t,
        dur: voiced.durationMs,
        speaker: b.speaker,
        text: b.line,
        emotion: b.emotion,
        action: b.action,
        target: b.target,
        laugh: Boolean(show.laughTrack && b.laugh),
        audio: voiced.audio,
        env: voiced.env,
      });
      t += voiced.durationMs + GAP_MS + (b.action === "walk_off" || b.action === "enter" ? 900 : 0) + (b.action === "laugh" || b.action === "applause" ? 500 : 0) + (show.laughTrack && b.laugh ? 1100 : 0);
    }
    const firstAction = new Map<string, string>();
    for (const b of script.beats) if (!firstAction.has(b.speaker)) firstAction.set(b.speaker, b.action);
    const castMembers: CastMember[] = cast.map((c, i) => ({
      id: c.id,
      name: c.name,
      look: c.look,
      mark: i,
      onSetAtStart: firstAction.get(c.id) !== "enter",
    }));
    return {
      id: crypto.randomUUID(),
      showId: show.id,
      showTitle: show.title,
      title: script.title,
      set: show.setFor?.[segmentType] ?? show.set,
      startAt: 0,
      durationMs: t - GAP_MS + TAIL_MS,
      cast: castMembers,
      cues,
      kind: "live",
      writer,
    };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
