import type { Segment } from "../shared/types.js";
import { slotAt } from "./catalog/schedule.js";
import type { Clock } from "./clock.js";
import type { DB } from "./db.js";
import type { Governor } from "./governor.js";
import { SEED_RELATIONSHIPS, type MemoryBank } from "./memory.js";
import type { Produced, Producer } from "./producer.js";
import type { Timeline } from "./timeline.js";

/** Lead time added when a segment is committed into a gap, so viewers can fetch audio first. */
export const COMMIT_DELAY_MS = 1500;

export interface StationDeps {
  db: DB;
  clock: Clock;
  timeline: Timeline;
  memory: MemoryBank;
  producer: Producer;
  governor: Governor;
  timeZone: string;
  onSegment?: (s: Segment) => void;
  log?: (msg: string) => void;
}

/**
 * The master control room. On each tick it asks the governor how far ahead the
 * timeline should be, and if it's short, produces exactly one segment and commits
 * it to the end of the one shared timeline.
 */
export class Station {
  private busy = false;
  private timer?: NodeJS.Timeout;
  lastError = "";

  constructor(private d: StationDeps) {
    const now = d.clock.now();
    for (const [a, b, score, note] of SEED_RELATIONSHIPS) d.memory.seed(a, b, score, note, now);
  }

  /** Where the next segment will start if produced now. */
  nextStart(): number {
    return Math.max(this.d.timeline.tailEnd(), this.d.clock.now() + COMMIT_DELAY_MS);
  }

  needsProduction(): boolean {
    const decision = this.d.governor.decide(this.d.clock.now());
    return decision.leadTargetMs > 0 && this.d.timeline.tailEnd() - this.d.clock.now() < decision.leadTargetMs;
  }

  /** Produce and commit one segment if the governor wants more. Returns what aired, if anything. */
  async tick(): Promise<Produced | null> {
    if (this.busy || !this.needsProduction()) return null;
    this.busy = true;
    try {
      const decision = this.d.governor.decide(this.d.clock.now());
      const planAt = this.nextStart();
      const slot = slotAt(planAt, this.d.timeZone);
      const coldStart = this.d.timeline.tailEnd() < this.d.clock.now();
      const produced = await this.d.producer.produce(planAt, slot, { rerun: decision.rerunsOnly, coldStart });
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

  start(intervalMs = 1000): void {
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, intervalMs);
    };
    void loop();
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
