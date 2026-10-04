import crypto from "node:crypto";
import type { CastMember, Cue, Segment } from "../shared/types.js";
import { getCharacter, type Character } from "./catalog/characters.js";
import { slotAt, type ScheduledSlot } from "./catalog/schedule.js";
import { getShow, type Show } from "./catalog/shows.js";
import type { TopicDesk } from "./desk.js";
import type { PollBox } from "./polls.js";
import type { MailBag } from "./mailbag.js";
import type { CharacterStates, MemoryBank } from "./memory.js";
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
import { ARTISTS } from "./catalog/music.js";
import { generateSong, songShape, type SongSpec } from "../shared/music.js";
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
  states?: CharacterStates;
  polls?: PollBox;
  mailbag?: MailBag;
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

  /** A short card while the last votes of a game come in, before the champion is crowned. */
  countingVotes(slot: ScheduledSlot, ms: number): Produced {
    return this.bumper(slot, ms, `${slot.title}: counting your votes...`);
  }

  /**
   * Instant filler for when the timeline is about to run dry while a slow write is still in
   * progress: an encore if there is anything at all to re-air, otherwise a short standby card.
   * Never calls a writer or TTS, so it can't be slow.
   */
  emergency(at: number, slot: ScheduledSlot): Produced {
    const remaining = Math.max(MIN_SEGMENT_MS, slot.endAt - at);
    return this.rerun(slot.showId, remaining, at, ENCORE_FRESH_MS) ?? this.rerun(slot.showId, remaining, at, 0) ?? this.bumper(slot, STANDBY_MS, "We'll be right back");
  }

  private bumper(slot: ScheduledSlot, remaining: number, title = `Coming up: ${slotAt(slot.endAt, this.d.timeZone).title}`): Produced {
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
      segment: { ...old, cast, poll: undefined, id: crypto.randomUUID(), startAt: 0, kind: "rerun", title: `${old.title.replace(/ \(encore\)$/, "")} (encore)` },
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
    const game = show.gameSteps ? this.gameFor(show, slot, at) : undefined;
    let segmentType = game ? game.step : pick(show.segmentTypes);
    // Viewer mail only happens when there's approved mail to read.
    const mail = segmentType === show.mailSegment ? this.d.mailbag?.nextFor(show.id) : undefined;
    if (segmentType === show.mailSegment && !mail) segmentType = pick(show.segmentTypes.filter((t) => t !== show.mailSegment));

    // One guest per slot, so the whole night has a consistent booking.
    let guest: Character | undefined;
    if (show.guestPool?.length && /guest/.test(segmentType)) {
      guest = getCharacter(show.guestPool[Math.floor(slot.startAt / 3_600_000) % show.guestPool.length]);
    }
    const solo = show.soloFor?.[segmentType];
    let cast = solo
      ? [getCharacter(solo)]
      : [...show.cast.map(getCharacter), ...(guest ? [guest] : []), ...(game ? game.contestants.map(getCharacter) : [])];
    // Whoever stormed off this show sits out - as long as at least two people are left to talk.
    const off = solo ? [] : (this.d.states?.offSet(show.id) ?? []);
    if (off.length) {
      const remaining = cast.filter((c) => !off.some((o) => o.id === c.id));
      if (remaining.length >= 2) cast = remaining;
    }
    const ids = cast.map((c) => c.id);
    const moods = ids.flatMap((id) => {
      const m = this.d.states?.mood(id, at);
      return m ? [{ id, mood: m.mood, reason: m.reason }] : [];
    });
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
      moods,
      offSet: off.filter((o) => !ids.includes(o.id)).map((o) => ({ id: o.id, reason: o.reason })),
      returning: (this.d.states?.returning(show.id) ?? []).filter((id) => ids.includes(id)),
      feuds: this.d.memory.feuds(ids).map(({ a, b }) => ({ a, b })),
      game,
      viewerMessage: mail ? { id: mail.id, handle: mail.handle, text: mail.text } : undefined,
    };
  }

  private async live(at: number, slot: ScheduledSlot, targetSeconds: number, writers: Writer[]): Promise<Produced> {
    const brief = this.brief(at, slot, targetSeconds);
    const music = brief.show.musicFor?.[brief.segmentType];
    if (music) return this.music(at, brief.show, music, targetSeconds);
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
        const segment = await this.assemble(brief.show, brief.cast, checked.script, writerName, brief.segmentType, brief.moods);
        if (brief.game) this.attachGame(segment, brief.show, brief.game);
        if (brief.deskTopicId) this.d.desk?.markUsed(brief.deskTopicId, at);
        if (brief.viewerMessage) this.d.mailbag?.markAired(brief.viewerMessage.id, at);
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
   * A music performance: the host introduces the act, then the band plays an original song
   * generated from a seed. No writer involved, so it's instant and free.
   */
  async music(at: number, show: Show, kind: "guest" | "house", targetSeconds: number, artistId?: string): Promise<Produced> {
    const r = rng(Math.floor(at / 1000) ^ 0x5eed);
    const guests = Object.values(ARTISTS).filter((a) => a.id !== "interference");
    const artist = (artistId && ARTISTS[artistId]) || (kind === "house" ? ARTISTS.interference : guests[Math.floor(r() * guests.length)]);
    // Prefer a song that hasn't aired in the last few hours.
    const recent = new Set(this.d.timeline.range(at - 6 * 3_600_000, at).filter((s) => s.song).map((s) => s.song!.title));
    const fresh = artist.songs.filter((t) => !recent.has(t));
    const title = (fresh.length ? fresh : artist.songs)[Math.floor(r() * (fresh.length || artist.songs.length))];

    // Whoever is still on set introduces the act (the usual host may have stormed off).
    const off = new Set((this.d.states?.offSet(show.id) ?? []).map((o) => o.id));
    const host = getCharacter(show.cast.find((id) => !off.has(id)) ?? show.cast[0]);
    const introText = artist.intro.replace("{song}", title);
    const intro = await this.d.tts.voice(introText, host);
    const bpm = Math.round(artist.bpm[0] + r() * (artist.bpm[1] - artist.bpm[0]));
    const roots: Record<string, number> = { synthpop: 45, rock: 40, punk: 43, ballad: 48 };
    const songMs = Math.min(targetSeconds * 1000, kind === "house" ? 45_000 : 100_000);
    const vocals = artist.members.some((m) => m.role === "vocals");
    const spec: SongSpec = {
      title,
      artist: artist.name,
      style: artist.style,
      seed: Math.floor(r() * 2 ** 31),
      bpm,
      root: roots[artist.style],
      sections: songShape(artist.style, bpm, songMs, vocals),
      startMs: LEAD_IN_MS + intro.durationMs + 700,
    };
    const song = generateSong(spec);
    const order = ["vocals", "guitar", "bass", "keys", "drums"];
    const cast: CastMember[] = [
      ...artist.members.map((m) => {
        const c = getCharacter(m.id);
        return { id: c.id, name: c.name, look: c.look, mark: order.indexOf(m.role), onSetAtStart: true, role: m.role };
      }),
      { id: host.id, name: host.name, look: host.look, mark: 5, onSetAtStart: true, role: "host" },
    ];
    const segment: Segment = {
      id: crypto.randomUUID(),
      showId: show.id,
      showTitle: show.title,
      title: `${artist.name}: "${title}"`,
      set: "music_stage",
      startAt: 0,
      durationMs: spec.startMs + song.totalMs + 2500,
      cast,
      cues: [
        // The player adds the crowd's applause when the song ends.
        { t: LEAD_IN_MS, dur: intro.durationMs, speaker: host.id, text: introText, emotion: "happy", action: "gesture", target: "audience", audio: intro.audio, env: intro.env },
      ],
      kind: "live",
      writer: "music",
      song: spec,
    };
    return { segment, summary: "", notes: [] };
  }

  /**
   * Where the game on this slot stands: which step comes next, who's playing, the score from
   * the viewers' closed votes, and the latest verdict. A game is a fixed run of steps; when it
   * ends, the next one drafts new contestants.
   */
  gameFor(show: Show, slot: ScheduledSlot, at: number): NonNullable<WriterBrief["game"]> {
    const steps = show.gameSteps!;
    const played = this.d.timeline
      .range(slot.startAt, at)
      .filter((s) => s.showId === show.id && s.kind === "live" && s.game).length;
    const cycle = Math.floor(played / steps.length);
    const step = steps[played % steps.length];
    const episode = `${show.id}:${slot.startAt}:${cycle}`;
    const r = rng(hashText(episode));
    const pool = [...(show.contestantPool ?? [])];
    const contestants: string[] = [];
    while (contestants.length < 3 && pool.length) contestants.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const polls = this.d.polls?.episode(episode) ?? [];
    const scores: Record<string, number> = Object.fromEntries(contestants.map((c) => [c, 0]));
    for (const p of polls) if (p.closed && p.winner && p.winner in scores) scores[p.winner] += p.weight;
    const closed = polls.filter((p) => p.closed);
    const last = closed[closed.length - 1];
    const lastVerdict = last
      ? { question: last.question, winner: last.winner!, studio: last.studio, tally: this.d.polls!.tally(last.id) }
      : undefined;
    const leader = [...contestants].sort((a, b) => scores[b] - scores[a] || contestants.indexOf(a) - contestants.indexOf(b))[0];
    return {
      episode,
      contestants,
      scores,
      step,
      lastVerdict,
      pending: polls.filter((p) => !p.closed).length,
      champion: step === steps[steps.length - 1] ? leader : undefined,
    };
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

  /** Game segments carry the scoreboard, and every scored round opens a viewer poll. */
  private attachGame(segment: Segment, show: Show, game: NonNullable<WriterBrief["game"]>): void {
    segment.game = { episode: game.episode, contestants: game.contestants, scores: game.scores, step: game.step, champion: game.champion };
    const scored = game.step !== show.gameSteps![0] && !game.champion;
    if (!scored) return;
    const final = game.step === show.gameSteps![show.gameSteps!.length - 2];
    segment.poll = {
      id: crypto.randomUUID(),
      question: final ? "Who won the FINAL SHOWDOWN? (counts double)" : `Who won the ${game.step}?`,
      options: game.contestants.map((id) => ({ id, label: getCharacter(id).name.split(" ")[0] })),
      closesAt: 0, // set when the segment is scheduled
    };
  }

  /** Voice every line and lay the cues end to end. Durations come from the real audio. */
  async assemble(
    show: Show,
    cast: Character[],
    script: Script,
    writer: string,
    segmentType = "",
    moods: { id: string; mood: string }[] = [],
  ): Promise<Segment> {
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
      mood: moods.find((m) => m.id === c.id)?.mood as CastMember["mood"],
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

function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
