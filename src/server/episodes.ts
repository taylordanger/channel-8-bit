import { z } from "zod";
import { CHARACTERS } from "./catalog/characters.js";
import type { Show } from "./catalog/shows.js";
import type { ScheduledSlot } from "./catalog/schedule.js";
import type { DB } from "./db.js";
import type { CharacterStates, MemoryBank } from "./memory.js";
import { rng } from "./writers/improv.js";
import type { Writer } from "./writers/script.js";

/**
 * An episode plan: the shape of one airing of a show, decided before its first scene, so the
 * scenes add up to an episode (setup, escalation, payoff) instead of a string of unrelated bits.
 */
export const PlanSchema = z.object({
  logline: z.string().describe("One sentence: what this episode is about"),
  wants: z
    .array(z.object({ character: z.string().describe("Character id"), want: z.string().describe("What they want today, concretely") }))
    .describe("One entry per regular cast member"),
  conflict: z.string().describe("The problem introduced at the start of the episode"),
  beats: z.array(z.string()).describe("Exactly three escalating developments, in order; each makes things worse or weirder"),
  payoff: z.string().describe("How the episode lands: the big laugh, twist or comeuppance at the end"),
  openThread: z.string().describe("One thing left unresolved for next time"),
  secrets: z
    .array(
      z.object({
        holder: z.string().describe("Character id of who is hiding it"),
        secret: z.string(),
        knownBy: z.array(z.string()).describe("Character ids who already know"),
      }),
    )
    .describe("Serialized shows: every secret still in play (carry over the old ones). Empty for episodic shows."),
  reveal: z.string().describe("Serialized shows: the secret that comes out in this episode's payoff, or empty string"),
});
export type EpisodePlan = z.infer<typeof PlanSchema>;

/** What a planner gets to work with. */
export interface PlanRequest {
  show: Show;
  cast: string[];
  localTime: string;
  storyState: string;
  previous?: EpisodePlan;
  /** Things that just happened elsewhere on the network involving this cast. */
  headlines: string[];
  moods: { id: string; mood: string; reason: string }[];
  feuds: { a: string; b: string }[];
  /** Tonight's booked guest, if the show has one. */
  guest?: string;
}

/** Where in the episode a scene falls. */
export interface EpisodePhase {
  index: number;
  of: number;
  label: "setup" | "escalation" | "payoff";
  job: string;
}

const PHASES = 5; // setup, three escalations, payoff

/** The phase a scene at `at` belongs to: the slot is split evenly, so the payoff lands near the end whatever the writing speed. */
export function phaseAt(plan: EpisodePlan, slot: Pick<ScheduledSlot, "startAt" | "endAt">, at: number): EpisodePhase {
  const frac = Math.min(0.999, Math.max(0, (at - slot.startAt) / Math.max(1, slot.endAt - slot.startAt)));
  const index = Math.floor(frac * PHASES);
  if (index === 0) return { index, of: PHASES, label: "setup", job: plan.conflict };
  if (index === PHASES - 1) return { index, of: PHASES, label: "payoff", job: plan.payoff };
  return { index, of: PHASES, label: "escalation", job: plan.beats[index - 1] ?? plan.beats[plan.beats.length - 1] ?? plan.conflict };
}

/** Make a model's plan safe to use: known ids only, exactly three beats, no secrets on episodic shows. */
export function tidyPlan(plan: EpisodePlan, req: Pick<PlanRequest, "show" | "cast">): EpisodePlan {
  const ids = new Set(req.cast);
  const byName = new Map<string, string>();
  for (const id of req.cast) {
    const c = CHARACTERS[id];
    if (c) for (const k of [id, c.name, c.name.split(" ")[0]]) byName.set(k.toLowerCase(), id);
  }
  const fix = (s: string) => byName.get(s.trim().toLowerCase()) ?? s;
  const beats = plan.beats.map((b) => b.trim()).filter(Boolean).slice(0, 3);
  while (beats.length < 3) beats.push(beats[beats.length - 1] ?? plan.conflict);
  const serialized = Boolean(req.show.serialized);
  return {
    ...plan,
    wants: plan.wants.map((w) => ({ ...w, character: fix(w.character) })).filter((w) => ids.has(w.character) && w.want.trim()),
    beats,
    secrets: serialized
      ? plan.secrets
          .map((s) => ({ ...s, holder: fix(s.holder), knownBy: s.knownBy.map(fix).filter((k) => CHARACTERS[k]) }))
          .filter((s) => CHARACTERS[s.holder] && s.secret.trim())
          .slice(0, 6)
      : [],
    reveal: serialized ? plan.reveal : "",
  };
}

/** The planning prompt. Shared by every model planner. */
export function planPrompt(req: PlanRequest): { system: string; user: string } {
  const name = (id: string) => CHARACTERS[id]?.name ?? id;
  const system = `You plan episodes for ${req.show.title}, a show on a 24/7 network of fictional pixel-art characters. Separate writers will write the scenes; you decide the arc they follow. All characters are fictional: never involve real people, companies or current events.

SHOW: ${req.show.title}
${req.show.bible}

A good plan: every regular wants something specific and slightly petty or doomed; the conflict sets their wants against each other; three developments each make it worse or weirder; the payoff is a laugh, twist or comeuppance (status reversals are great); one thread stays open for next time. Be concrete: exact objects, places, numbers. Keep each field to one or two sentences.
${req.show.serialized ? "This show is SERIALIZED: build on the story so far and last episode's open thread. Track secrets: who hides what and who knows. Carry old secrets forward, add at most one new one, and you may reveal one in the payoff (then everyone on set knows it next time)." : "This show is episodic: secrets must be an empty list and reveal an empty string. The arc is tonight's running thread across the show's usual segments - a running gag, a grudge, a scheme - not a plot that replaces the format."}

CAST (use these ids): ${req.cast.map((id) => `${id} (${name(id)}: ${CHARACTERS[id]?.bible ?? ""})`).join("; ")}`;

  const parts = [`Plan the episode airing ${req.localTime}.`];
  if (req.guest) parts.push(`TONIGHT'S GUEST: ${name(req.guest)} (${req.guest}): ${CHARACTERS[req.guest]?.bible ?? ""}`);
  if (req.headlines.length) parts.push(`JUST HAPPENED ON THE NETWORK (use what fits):\n${req.headlines.map((h) => `- ${h}`).join("\n")}`);
  if (req.storyState) parts.push(`STORY SO FAR:\n${req.storyState}`);
  if (req.previous) {
    parts.push(`LAST EPISODE: ${req.previous.logline} It ended: ${req.previous.payoff} Left open: ${req.previous.openThread}`);
    if (req.previous.secrets.length) {
      const revealed = req.previous.reveal.trim();
      parts.push(
        `SECRETS IN PLAY:\n${req.previous.secrets.map((s) => `- ${name(s.holder)} hides: ${s.secret} (known by: ${s.knownBy.map(name).join(", ") || "nobody"})`).join("\n")}${revealed ? `\nREVEALED LAST EPISODE (everyone on set knows now): ${revealed}` : ""}`,
      );
    }
  }
  if (req.moods.length) parts.push(`MOODS: ${req.moods.map((m) => `${name(m.id)} is ${m.mood} (${m.reason})`).join("; ")}`);
  if (req.feuds.length) parts.push(`FEUDS: ${req.feuds.map((f) => `${name(f.a)} vs ${name(f.b)}`).join("; ")}`);
  return { system, user: parts.join("\n\n") };
}

/** A plan with no model at all: templates filled from the show's topics and the cast. */
export function improvPlan(req: PlanRequest, seed: number): EpisodePlan {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const name = (id: string) => CHARACTERS[id]?.name ?? id;
  const [a, b = a] = [...req.cast].sort(() => r() - 0.5);
  const topic = pick(req.show.topics);
  const opener = req.headlines[0];
  return {
    logline: opener ? `Fallout from the news: ${opener}` : `${name(a)} turns "${topic}" into a personal crusade.`,
    wants: req.cast.map((id) => ({ character: id, want: id === a ? `to be proven right about ${topic}` : id === b ? `to see ${name(a)} admit they were wrong` : "to stay out of it, and fail" })),
    conflict: `${name(a)} and ${name(b)} take opposite sides on ${topic}.`,
    beats: [
      `${name(a)} doubles down and drags someone else in.`,
      `${name(b)} produces evidence that backfires.`,
      `Everyone picks a side, including someone who should not.`,
    ],
    payoff: `${name(b)} wins on a technicality nobody understands, and ${name(a)} claims victory anyway.`,
    openThread: `${name(a)} is quietly planning a rematch.`,
    secrets: req.previous?.secrets ?? [],
    reveal: "",
  };
}

/** Writers that can also plan episodes. */
export interface Planner {
  readonly name: string;
  plan(req: PlanRequest): Promise<EpisodePlan>;
}
export const canPlan = (w: Writer): w is Writer & Planner => typeof (w as Partial<Planner>).plan === "function";

export interface StoredPlan {
  showId: string;
  slotStart: number;
  writer: string;
  plan: EpisodePlan;
}

/** Plans per show airing, kept so a restart mid-episode keeps the same arc and the next episode can follow on. */
export class EpisodeBook {
  constructor(
    private db: DB,
    private memory: MemoryBank,
    private states?: CharacterStates,
    private log?: (m: string) => void,
  ) {}

  get(showId: string, slotStart: number): StoredPlan | undefined {
    const row = this.db.prepare("SELECT * FROM episode_plans WHERE show_id = ? AND slot_start = ?").get(showId, slotStart) as Row | undefined;
    return row && toStored(row);
  }

  previous(showId: string, before: number): StoredPlan | undefined {
    const row = this.db
      .prepare("SELECT * FROM episode_plans WHERE show_id = ? AND slot_start < ? ORDER BY slot_start DESC LIMIT 1")
      .get(showId, before) as Row | undefined;
    return row && toStored(row);
  }

  /** The plans for airings in progress at `now`, newest first. */
  current(now: number, within = 3 * 3_600_000): StoredPlan[] {
    const rows = this.db.prepare("SELECT * FROM episode_plans WHERE slot_start <= ? AND slot_start > ? ORDER BY slot_start DESC").all(now, now - within) as Row[];
    return rows.map(toStored);
  }

  /** Everything a planner should know about this airing. */
  request(show: Show, slot: ScheduledSlot, localTime: string, guest?: string): PlanRequest {
    const cast = [...show.cast, ...(guest ? [guest] : [])];
    const since = slot.startAt - 12 * 3_600_000;
    // Big moments from other shows involving this cast: wins, losses, walk-offs.
    const headlines = this.memory
      .latest(300)
      .filter((m) => m.createdAt >= since && m.showId !== show.id && m.weight >= 0.6 && m.about.some((id) => cast.includes(id)))
      .slice(0, 4)
      .map((m) => m.text);
    const moods = cast.flatMap((id) => {
      const m = this.states?.mood(id, slot.startAt);
      return m ? [{ id, mood: m.mood, reason: m.reason }] : [];
    });
    return {
      show,
      cast,
      localTime,
      storyState: show.serialized ? this.memory.storyState(show.id) || (show.storySeed ?? "") : "",
      previous: this.previous(show.id, slot.startAt)?.plan,
      headlines,
      moods,
      feuds: this.memory.feuds(cast).map(({ a, b }) => ({ a, b })),
      guest,
    };
  }

  /**
   * The plan for this airing: stored, or made now by the first writer that can plan. When none
   * of `writers` can (a hurried scene, or the planner failed), a template plan covers this scene;
   * it's only kept when `keepTemplate` (the station has no model planner at all), so a real
   * planner still gets to plan the episode on the next scene.
   */
  async ensure(show: Show, slot: ScheduledSlot, writers: Writer[], localTime: string, opts: { guest?: string; keepTemplate?: boolean; timeoutMs?: number } = {}): Promise<EpisodePlan> {
    const { guest, keepTemplate = false, timeoutMs = 150_000 } = opts;
    const stored = this.get(show.id, slot.startAt);
    if (stored) return stored.plan;
    const req = this.request(show, slot, localTime, guest);
    for (const w of writers.filter(canPlan)) {
      try {
        const plan = tidyPlan(await withTimeout(w.plan(req), timeoutMs), req);
        this.save(show.id, slot.startAt, w.name, plan);
        this.log?.(`planned ${show.title} (${w.name}): ${plan.logline}`);
        return plan;
      } catch (e) {
        this.log?.(`planner ${w.name} failed on ${show.id}: ${(e as Error).message}`);
      }
    }
    const plan = improvPlan(req, slot.startAt ^ hash(show.id));
    if (keepTemplate) this.save(show.id, slot.startAt, "improv", plan);
    return plan;
  }

  save(showId: string, slotStart: number, writer: string, plan: EpisodePlan): void {
    this.db
      .prepare("INSERT OR REPLACE INTO episode_plans (show_id, slot_start, created_at, writer, plan) VALUES (?,?,?,?,?)")
      .run(showId, slotStart, Date.now(), writer, JSON.stringify(plan));
  }
}

/** Finished games, so other shows can follow up: the loser of Hot Seat faces Rex next. */
export class GameResults {
  constructor(private db: DB) {}

  record(showId: string, at: number, champion: string, scores: Record<string, number>, episode = ""): void {
    this.db.prepare("INSERT INTO game_results (show_id, episode, at, champion, scores) VALUES (?,?,?,?,?)").run(showId, episode, at, champion, JSON.stringify(scores));
  }

  /** The most recent game on `showId` that ended in [from, to]. */
  latest(showId: string, from: number, to: number): { at: number; champion: string; scores: Record<string, number>; loser: string } | undefined {
    const row = this.db
      .prepare("SELECT at, champion, scores FROM game_results WHERE show_id = ? AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 1")
      .get(showId, from, to) as { at: number; champion: string; scores: string } | undefined;
    if (!row) return undefined;
    const scores = JSON.parse(row.scores) as Record<string, number>;
    const loser = Object.keys(scores)
      .filter((id) => id !== row.champion)
      .sort((a, b) => scores[a] - scores[b])[0];
    return loser ? { at: row.at, champion: row.champion, scores, loser } : undefined;
  }
}

interface Row {
  show_id: string;
  slot_start: number;
  writer: string;
  plan: string;
}
const toStored = (r: Row): StoredPlan => ({ showId: r.show_id, slotStart: r.slot_start, writer: r.writer, plan: JSON.parse(r.plan) as EpisodePlan });

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`planning took longer than ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}
