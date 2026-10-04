import { z } from "zod";
import { CHARACTERS } from "../catalog/characters.js";
import { systemPrompt, userPrompt } from "./prompt.js";
import { ACTIONS, EMOTIONS, MOODS } from "../../shared/types.js";
import type { Show } from "../catalog/shows.js";
import { PlanSchema, planPrompt, SeasonSchema, seasonPrompt, type EpisodePlan, type PlanRequest, type SeasonPlan } from "../episodes.js";
import { type Script, type Writer, type WriterBrief, type WriterResult } from "./script.js";

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * llama.cpp's grammar builder rejects `items: false` (how JSON Schema says "nothing after these
 * tuple entries"). Drop it and pin the tuple's length instead, which says the same thing.
 */
export function grammarSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(grammarSchema) as T;
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = grammarSchema(v);
  if (Array.isArray(out.prefixItems) && out.items === false) {
    delete out.items;
    out.minItems = out.maxItems = out.prefixItems.length;
  }
  return out as T;
}

/** Minimal client for a local Ollama server's chat API with JSON-schema constrained output. */
export class OllamaClient {
  constructor(
    readonly baseUrl: string,
    readonly model: string,
    private fetcher: Fetcher = fetch,
    private timeoutMs = 360_000,
  ) {}

  /** Whether the server is up and has the model pulled. */
  async available(): Promise<boolean> {
    try {
      const res = await this.fetcher(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const { models } = (await res.json()) as { models: { name: string }[] };
      return models.some((m) => m.name === this.model || m.name === `${this.model}:latest`);
    } catch {
      return false;
    }
  }

  /**
   * Chat with output constrained to `schema`. `prepare` can repair the raw JSON (e.g. map
   * names to ids) before it's validated.
   */
  async chat<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
    opts: { temperature?: number; prepare?: (raw: unknown) => unknown } = {},
  ): Promise<T> {
    const res = await this.fetcher(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        think: false,
        keep_alive: "30m", // stay loaded between segments
        format: grammarSchema(z.toJSONSchema(schema)),
        options: { temperature: opts.temperature ?? 0.9, num_ctx: 8192, num_predict: 3000 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { message?: { content?: string } };
    let raw: unknown;
    try {
      raw = JSON.parse(body.message?.content ?? "");
    } catch {
      throw new Error("ollama returned invalid JSON");
    }
    const parsed = schema.safeParse(opts.prepare ? opts.prepare(raw) : raw);
    if (!parsed.success) throw new Error(`ollama output didn't match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return parsed.data;
  }
}

export const MAX_LOCAL_SECONDS = 60;

/**
 * The compact script format for the local model. It writes slowly (single-digit tokens per
 * second on a laptop), and in the full format most of what it wrote was JSON labels repeated on
 * every line, not dialogue. Here each line is a short tuple and the bookkeeping is trimmed, so
 * the same scene takes about half the tokens. `expandCompact` turns it back into a Script.
 */
export function compactSchema(castIds: string[], minLines: number, maxLines: number, show: Pick<Show, "laughTrack" | "serialized">, story = show.serialized) {
  const ids = z.enum(castIds as [string, ...string[]]);
  const line = show.laughTrack
    ? z.tuple([ids, z.enum(EMOTIONS), z.enum(ACTIONS), z.string(), z.boolean()])
    : z.tuple([ids, z.enum(EMOTIONS), z.enum(ACTIONS), z.string()]);
  return z.object({
    title: z.string(),
    summary: z.string(),
    lines: z.array(line).min(minLines).max(maxLines),
    remember: z.string(),
    feelings: z.array(z.tuple([ids, ids, z.number()])).max(2),
    moods: z.array(z.tuple([ids, z.enum(MOODS), z.string()])).max(2),
    ...(story ? { storyState: z.string() } : {}),
  });
}
export type CompactScript = {
  title: string;
  summary: string;
  lines: ([string, string, string, string] | [string, string, string, string, boolean])[];
  remember: string;
  feelings: [string, string, number][];
  moods: [string, string, string][];
  storyState?: string;
};

/** Small models write names where ids belong; fix them in the raw compact output before validation. */
export function prepareCompact(raw: unknown, castIds: string[]): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const lookup = new Map<string, string>();
  for (const id of castIds) {
    const c = CHARACTERS[id];
    if (c) for (const key of [id, c.name, c.name.split(" ")[0], c.name.split(" ").slice(-1)[0]]) lookup.set(key.toLowerCase(), id);
  }
  const fix = (v: unknown) => (typeof v === "string" ? (lookup.get(v.trim().toLowerCase()) ?? v) : v);
  const r = raw as Record<string, unknown>;
  const tuples = (k: string, idx: number[]) =>
    Array.isArray(r[k]) ? (r[k] as unknown[]).map((t) => (Array.isArray(t) ? t.map((v, i) => (idx.includes(i) ? fix(v) : v)) : t)) : r[k];
  return { ...r, lines: tuples("lines", [0]), feelings: tuples("feelings", [0, 1]), moods: tuples("moods", [0]) };
}

/** Back to a full Script: who each line is aimed at, what to remember, how feelings moved. */
export function expandCompact(c: CompactScript): Script {
  const speakers = c.lines.map((l) => l[0]);
  const beats = c.lines.map(([speaker, emotion, action, line, laugh], i) => {
    // Talk to whoever spoke last (or speaks next) if it's someone else.
    const other = [...speakers.slice(0, i)].reverse().find((s) => s !== speaker) ?? speakers.slice(i + 1).find((s) => s !== speaker);
    return {
      speaker,
      line,
      emotion: emotion as Script["beats"][number]["emotion"],
      action: action as Script["beats"][number]["action"],
      target: other ?? "audience",
      laugh: laugh === true,
    };
  });
  return {
    title: c.title,
    summary: c.summary,
    beats,
    memories: c.remember.trim() ? [{ about: [...new Set(speakers)], text: c.remember.trim(), importance: 0.5 }] : [],
    relationshipChanges: c.feelings
      .filter(([from, to]) => from !== to)
      .map(([from, to, delta]) => ({ from, to, delta: Math.max(-25, Math.min(25, Math.round(delta))), reason: c.summary.slice(0, 80) })),
    moodChanges: c.moods.map(([character, mood, reason]) => ({ character, mood: mood as Script["moodChanges"][number]["mood"], reason })),
    storyState: c.storyState ?? "",
  };
}

/**
 * Small models sprinkle stage actions everywhere (walk off, re-enter, walk off...).
 * Keep at most one exit per character, entrances only after an exit, and little standing.
 */
export function tameActions(script: Script): Script {
  const exited = new Set<string>();
  const exits = new Set<string>();
  let stands = 0;
  const beats = script.beats.map((b) => {
    let action = b.action;
    if (action === "walk_off") {
      if (exits.has(b.speaker)) action = "none";
      else {
        exits.add(b.speaker);
        exited.add(b.speaker);
      }
    } else if (action === "enter") {
      if (exited.has(b.speaker)) exited.delete(b.speaker);
      else action = "none";
    } else if (action === "stand" && ++stands > 1) action = "none";
    return { ...b, action };
  });
  // They also mark nearly every line as a punchline. A laugh track that never stops isn't funny:
  // no back-to-back laughs, and never more than about half the lines.
  let laughs = 0;
  for (let i = 0; i < beats.length; i++) {
    if (!beats[i].laugh) continue;
    if ((i > 0 && beats[i - 1].laugh) || laughs >= Math.ceil(beats.length / 2)) beats[i] = { ...beats[i], laugh: false };
    else laughs++;
  }
  return { ...script, beats };
}

const LOCAL_ADDENDUM = `

OUTPUT FORMAT (compact): reply with one JSON object only, matching the schema.
- "lines": one entry per spoken line: [speaker id, emotion, action, "the words"] - shows with a laugh track add a fifth item, true when the studio audience laughs (punchlines only). Example: ["rex", "smug", "none", "I've hosted funerals with better energy."]
- Speaker ids exactly as listed (lowercase ids like "rex", not names). Every line must sound like that specific character - their catchphrases and personality. Funny and specific; no generic filler. Short and punchy (under 25 words). Don't copy the sample lines.
- Action is "none" on most lines; walk_off is rare and dramatic; enter only for someone coming back.
- "summary": one short sentence. "remember": one short fact the characters will remember later (or ""). "feelings": up to two [from id, to id, change -25..25] (these are the relationshipChanges). "moods": up to two [character id, mood, reason in under eight words] (these are the moodChanges).
- "storyState" (only when the schema asks for it): the plot so far in at most three sentences.`;

/** Writes segments with a model running locally in Ollama: free, private, offline. */
export class OllamaWriter implements Writer {
  readonly name = "ollama";
  /** After a timeout or outage, skip the local model for a while so the air isn't held up. */
  private coolingUntil = 0;

  constructor(
    private client: OllamaClient,
    private networkName: string,
    private now: () => number = Date.now,
    private cooldownMs = 10 * 60_000,
  ) {}

  async write(brief: WriterBrief): Promise<WriterResult> {
    if (this.now() < this.coolingUntil) throw new Error("local model is cooling down after a timeout");
    const system = systemPrompt(this.networkName, brief.show) + LOCAL_ADDENDUM;
    // Local models are slower; shorter segments keep the station ahead of the clock, and a shorter
    // repeat-guard list keeps the prompt quick to read.
    const user = userPrompt({ ...brief, targetSeconds: Math.min(brief.targetSeconds, MAX_LOCAL_SECONDS), recentLines: brief.recentLines.slice(-15) });
    // Serialized shows: rewrite the story notes at an episode's setup and payoff; the episode plan
    // carries the arc in between.
    const story = brief.show.serialized && (!brief.episode || brief.episode.phase.label !== "escalation");
    let lastError: unknown;
    // Small models occasionally fumble the format; one retry is usually enough.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const castIds = brief.cast.map((c) => c.id);
        const target = Math.min(brief.targetSeconds, MAX_LOCAL_SECONDS);
        // Each scene has fixed costs (reading the prompt, the summary, the bookkeeping), so fuller
        // scenes get more airtime out of the same model time.
        const schema = compactSchema(castIds, Math.max(6, Math.round(target / 6)), Math.max(10, Math.round(target / 3.5)), brief.show, story);
        const compact = await this.client.chat(system, user, schema, { prepare: (raw) => prepareCompact(raw, castIds) });
        return { script: tameActions(expandCompact(compact as CompactScript)), writer: `ollama:${this.client.model}` };
      } catch (e) {
        lastError = e;
        if ((e as Error).name === "TimeoutError" || /ECONNREFUSED|fetch failed/.test(String((e as Error).message))) {
          this.coolingUntil = this.now() + this.cooldownMs;
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** Once a week per serialized show: the season arc. */
  async planSeason(show: Show, storyState: string, last?: SeasonPlan): Promise<SeasonPlan> {
    if (this.now() < this.coolingUntil) throw new Error("local model is cooling down after a timeout");
    const { system, user } = seasonPrompt(show, storyState, last);
    return this.client.chat(system, user, SeasonSchema, { temperature: 0.85 });
  }

  /** The episode arc. Small output, so it's quick even on the local model. */
  async plan(req: PlanRequest): Promise<EpisodePlan> {
    if (this.now() < this.coolingUntil) throw new Error("local model is cooling down after a timeout");
    const { system, user } = planPrompt(req);
    try {
      return await this.client.chat(system, user, PlanSchema, { temperature: 0.8 });
    } catch (e) {
      if ((e as Error).name === "TimeoutError" || /ECONNREFUSED|fetch failed/.test(String((e as Error).message))) this.coolingUntil = this.now() + this.cooldownMs;
      throw e;
    }
  }
}
