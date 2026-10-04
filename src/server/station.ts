import type { Segment } from "../shared/types.js";
import { getShow } from "./catalog/shows.js";
import { programAt, type Override } from "./catalog/schedule.js";
import type { Clock } from "./clock.js";
import type { DB } from "./db.js";
import type { Governor } from "./governor.js";
import { SEED_RELATIONSHIPS, type CharacterStates, type MemoryBank } from "./memory.js";
import { CHARACTERS } from "./catalog/characters.js";
import type { Produced, Producer } from "./producer.js";
import type { Timeline } from "./timeline.js";

/** Lead time added when a segment is committed into a gap, so viewers can fetch audio first. */
export const COMMIT_DELAY_MS = 1500;
/** The watchdog airs filler when less than this much is queued and a write is still running. */
export const EMERGENCY_BELOW_MS = 4000;

export interface StationDeps {
  db: DB;
  clock: Clock;
  timeline: Timeline;
  memory: MemoryBank;
  states?: CharacterStates;
  producer: Producer;
  governor: Governor;
  timeZone: string;
  onSegment?: (s: Segment) => void;
  /** Segments pulled from the timeline before airing (a special cut in). */
  onRetract?: (ids: string[]) => void;
  log?: (msg: string) => void;
  /** With a slow writer, air an encore when the timeline is less than this far ahead. */
  hurryBelowMs?: number;
}

/**
 * The master control room. On each tick it asks the governor how far ahead the
 * timeline should be, and if it's short, produces exactly one segment and commits
 * it to the end of the one shared timeline.
 */
export class Station {
  private busy = false;
  /**
   * Whether the last fresh segment took a large share of its own air time to write.
   * Assume slow until proven fast: one early encore is cheaper than dead air.
   */
  private slowWriter = true;
  /** How long the last few fresh segments took to write and voice. */
  // Until measured, assume a slow (local-model) writer: ~2.5 minutes per segment.
  private recentWritesMs: number[] = [150_000];
  private timer?: NodeJS.Timeout;
  private guard?: NodeJS.Timeout;
  lastError = "";

  constructor(private d: StationDeps) {
    d.hurryBelowMs ??= 75_000;
    const now = d.clock.now();
    for (const [a, b, score, note] of SEED_RELATIONSHIPS) d.memory.seed(a, b, score, note, now);
  }

  /**
   * Moods and walk-offs. Absences count down with each scene of the show; a regular who
   * storms off (walk_off without coming back) sits out the next few and is furious until
   * a scene says otherwise. Guests can leave whenever - that's just the end of the interview.
   */
  private applyCharacterState(p: Produced, now: number): void {
    const states = this.d.states;
    if (!states || !p.script) return;
    const showId = p.segment.showId;
    const show = getShow(showId);
    const speakers = [...new Set(p.segment.cues.map((c) => c.speaker))];
    states.segmentAired(showId, speakers);
    for (const m of p.script.moodChanges) states.setMood(m.character, m.mood, m.reason, now);
    for (const id of speakers) {
      if (!show.cast.includes(id)) continue;
      const theirs = p.segment.cues.filter((c) => c.speaker === id);
      const last = theirs[theirs.length - 1];
      if (last?.action !== "walk_off") continue;
      states.walkOff(id, showId, last.text.slice(0, 120));
      if (!p.script.moodChanges.some((m) => m.character === id)) states.setMood(id, "furious", `stormed off ${show.title}: "${last.text.slice(0, 80)}"`, now);
      this.d.memory.remember(showId, [id], `${CHARACTERS[id]?.name ?? id} stormed off the set of ${show.title}: "${last.text.slice(0, 100)}"`, 0.75, now);
      this.d.log?.(`${CHARACTERS[id]?.name ?? id} walked off ${show.title}`);
    }
  }

  /** Where the next segment will start if produced now. */
  nextStart(): number {
    return Math.max(this.d.timeline.tailEnd(), this.d.clock.now() + COMMIT_DELAY_MS);
  }

  /** Below this lead, a slow writer couldn't finish in time, so the station airs an encore instead. */
  private hurryThreshold(): number {
    // Write times swing widely (a local model: 40s to 2+ minutes), so plan for the slowest recent one.
    const worst = Math.max(0, ...this.recentWritesMs);
    return Math.max(this.d.hurryBelowMs!, worst * 1.2 + 15_000);
  }

  /**
   * How far ahead to keep the timeline. With a slow writer, the target must sit well above
   * the hurry threshold - otherwise every production would be an encore and nothing new
   * would ever be written.
   */
  private leadTarget(base: number): number {
    return this.slowWriter ? Math.max(base, this.hurryThreshold() + 90_000) : base;
  }

  needsProduction(): boolean {
    const decision = this.d.governor.decide(this.d.clock.now());
    return decision.leadTargetMs > 0 && this.d.timeline.tailEnd() - this.d.clock.now() < this.leadTarget(decision.leadTargetMs);
  }

  /** Produce and commit one segment if the governor wants more. Returns what aired, if anything. */
  async tick(): Promise<Produced | null> {
    if (this.busy || !this.needsProduction()) return null;
    this.busy = true;
    try {
      const decision = this.d.governor.decide(this.d.clock.now());
      const planAt = this.nextStart();
      const slot = programAt(planAt, this.d.timeZone, this.override());
      const now = this.d.clock.now();
      const lead = this.d.timeline.tailEnd() - now;
      const coldStart = lead < 0;
      // Slow writers (local models) can't always outrun the clock; when the cushion is thin, buy time.
      // Hurry when what's already written would run out before the writer could finish another.
      const hurry = !coldStart && this.slowWriter && lead < this.hurryThreshold();
      const t0 = this.d.clock.now();
      const produced = await this.d.producer.produce(planAt, slot, { rerun: decision.rerunsOnly, coldStart, hurry });
      // Measure only the primary writer: instant fallbacks would make a slow writer look fast.
      if (produced.primary) {
        const took = this.d.clock.now() - t0;
        this.recentWritesMs = [...this.recentWritesMs.slice(-2), took];
        this.slowWriter = took > produced.segment.durationMs * 0.6;
      }
      this.commit(produced);
      this.lastError = "";
      return produced;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.d.log?.(`production failed: ${this.lastError}`);
      return null;
    } finally {
      this.busy = false;
    }
  }

  commit(p: Produced): void {
    const now = this.d.clock.now();
    p.segment.startAt = Math.max(this.d.timeline.tailEnd(), now + COMMIT_DELAY_MS);
    // Memories, feelings and plot only change when something new is written - reruns don't rewrite history.
    const apply = this.d.db.transaction(() => {
      this.d.timeline.append(p.segment, p.summary, p.rerunOf);
      if (p.script) {
        const show = p.segment.showId;
        for (const m of p.script.memories) this.d.memory.remember(show, m.about, m.text, m.importance, now);
        for (const r of p.script.relationshipChanges) this.d.memory.adjust(r.from, r.to, r.delta, r.reason, now);
        if (p.script.storyState) this.d.memory.setStoryState(show, p.script.storyState, now);
        this.applyCharacterState(p, now);
      }
      for (const n of p.notes.filter((x) => x.verdict !== "fix")) {
        this.d.db
          .prepare("INSERT INTO standards_log (at, show_id, verdict, detail) VALUES (?,?,?,?)")
          .run(now, p.segment.showId, n.verdict, `${n.reason}: ${n.line}`);
      }
    });
    apply();
    this.d.log?.(
      `committed ${p.segment.kind} "${p.segment.title}" (${p.segment.showId}, ${(p.segment.durationMs / 1000).toFixed(0)}s, ${p.segment.writer}) at ${new Date(p.segment.startAt).toISOString()}`,
    );
    this.d.onSegment?.(p.segment);
  }

  /** The special programming in effect now or later, if any. */
  override(): Override | null {
    const row = this.d.db
      .prepare("SELECT show_id, start_at, end_at FROM overrides WHERE end_at > ? ORDER BY id DESC LIMIT 1")
      .get(this.d.clock.now()) as { show_id: string; start_at: number; end_at: number } | undefined;
    return row ? { showId: row.show_id, startAt: row.start_at, endAt: row.end_at } : null;
  }

  /**
   * Break into programming: air a show starting with the next segment, for `minutes`.
   * What's already on the timeline still plays (it's what viewers were promised).
   */
  airNow(showId: string, minutes: number, opts: { cutIn?: boolean } = {}): Override {
    getShow(showId);
    if (opts.cutIn) {
      // Skip everything queued after the scene that's on now; viewers' players drop it too.
      const now = this.d.clock.now();
      const current = this.d.timeline.at(now);
      const dropped = this.d.timeline.removeFrom(current ? current.startAt + current.durationMs : now);
      if (dropped.length) this.d.onRetract?.(dropped);
    }
    const startAt = this.nextStart();
    const endAt = startAt + Math.max(5, Math.min(360, minutes)) * 60_000;
    // A new special replaces any earlier one rather than resuming it afterwards.
    this.d.db.prepare("UPDATE overrides SET end_at = ? WHERE end_at > ?").run(startAt, startAt);
    this.d.db.prepare("INSERT INTO overrides (show_id, start_at, end_at) VALUES (?,?,?)").run(showId, startAt, endAt);
    this.d.log?.(`special programming: ${showId} until ${new Date(endAt).toISOString()}`);
    return { showId, startAt, endAt };
  }

  /**
   * Put a musical act on right after the current scene (the desk's "play a song now").
   * The show on air hosts it; what was queued after the current scene is dropped.
   */
  async playMusic(artistId?: string): Promise<Segment> {
    const now = this.d.clock.now();
    const current = this.d.timeline.at(now);
    const dropped = this.d.timeline.removeFrom(current ? current.startAt + current.durationMs : now);
    if (dropped.length) this.d.onRetract?.(dropped);
    const at = this.nextStart();
    const slot = programAt(at, this.d.timeZone, this.override());
    const produced = await this.d.producer.music(at, getShow(slot.showId), "guest", 100, artistId);
    this.commit(produced);
    return produced.segment;
  }

  /** Return to the regular schedule after whatever is already written. */
  endOverride(): void {
    this.d.db.prepare("UPDATE overrides SET end_at = ? WHERE end_at > ?").run(this.nextStart(), this.d.clock.now());
  }

  /**
   * Dead-air guard. Production is serial, so a slow write can outlast what's queued. If the
   * timeline is about to run out while a write is in progress, air instant filler now; the
   * fresh segment is appended after it when it's ready.
   */
  watchdog(): Produced | null {
    if (!this.busy) return null;
    const now = this.d.clock.now();
    if (this.d.governor.decide(now).leadTargetMs === 0) return null;
    if (this.d.timeline.tailEnd() - now > EMERGENCY_BELOW_MS) return null;
    const at = this.nextStart();
    const filler = this.d.producer.emergency(at, programAt(at, this.d.timeZone, this.override()));
    this.d.log?.(`writer still busy and the timeline is running out: airing "${filler.segment.title}"`);
    this.commit(filler);
    return filler;
  }

  start(intervalMs = 1000): void {
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, intervalMs);
    };
    void loop();
    this.guard = setInterval(() => this.watchdog(), 1000);
  }

  stop(): void {
    clearTimeout(this.timer);
    clearInterval(this.guard);
  }
}
