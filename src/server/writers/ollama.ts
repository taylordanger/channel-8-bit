import { z } from "zod";
import { CHARACTERS } from "../catalog/characters.js";
import { systemPrompt, userPrompt } from "./prompt.js";
import { ACTIONS, EMOTIONS } from "../../shared/types.js";
import { ScriptSchema, type Script, type Writer, type WriterBrief, type WriterResult } from "./script.js";

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Minimal client for a local Ollama server's chat API with JSON-schema constrained output. */
export class OllamaClient {
  constructor(
    readonly baseUrl: string,
    readonly model: string,
    private fetcher: Fetcher = fetch,
    private timeoutMs = 180_000,
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
        format: z.toJSONSchema(schema),
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

/** Small models often write a speaker's name where the id belongs; map it back. */
export function normalizeSpeakers(script: Script, castIds: string[]): Script {
  const lookup = new Map<string, string>();
  for (const id of castIds) {
    const c = CHARACTERS[id];
    if (!c) continue;
    for (const key of [id, c.name, c.name.split(" ")[0], c.name.split(" ").slice(-1)[0]]) lookup.set(key.toLowerCase(), id);
  }
  const fix = (s: string) => lookup.get(s.trim().toLowerCase()) ?? s;
  return {
    ...script,
    beats: script.beats.map((b) => ({ ...b, speaker: fix(b.speaker), target: ["camera", "audience"].includes(b.target) ? b.target : fix(b.target) })),
    memories: script.memories.map((m) => ({ ...m, about: m.about.map(fix) })),
    relationshipChanges: script.relationshipChanges.map((r) => ({ ...r, from: fix(r.from), to: fix(r.to) })),
  };
}

export const MAX_LOCAL_SECONDS = 60;

/**
 * A stricter schema for small models: the grammar itself forces a real number of
 * lines and only lets cast members speak, so the model can't take shortcuts.
 */
export function localScriptSchema(castIds: string[], minBeats: number, maxBeats: number) {
  const ids = z.enum(castIds as [string, ...string[]]);
  return ScriptSchema.extend({
    beats: z
      .array(
        z.object({
          speaker: ids,
          line: z.string().describe("Exactly what is spoken aloud. No stage directions."),
          emotion: z.enum(EMOTIONS),
          action: z.enum(ACTIONS),
          target: z.enum([...castIds, "camera", "audience"] as unknown as [string, ...string[]]),
          laugh: z.boolean(),
        }),
      )
      .min(minBeats)
      .max(maxBeats),
    memories: ScriptSchema.shape.memories.max(2),
    relationshipChanges: ScriptSchema.shape.relationshipChanges.max(2),
  });
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

OUTPUT FORMAT: Reply with one JSON object only, matching the schema. "speaker" and "target" must be character ids exactly as listed (lowercase ids like "rex", not names). Every line must sound like that specific character - use their catchphrases and personality. Make it funny and specific; avoid generic filler. Keep lines short and punchy (under 25 words). Don't copy the sample lines - write new ones. Use "none" for action on most lines; walk_off is rare and dramatic. Keep the extras brief: summary is one sentence, storyState at most three sentences, at most two memories and two relationshipChanges.`;

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
    // Local models are slower; shorter segments keep the station ahead of the clock.
    const user = userPrompt({ ...brief, targetSeconds: Math.min(brief.targetSeconds, MAX_LOCAL_SECONDS) });
    let lastError: unknown;
    // Small models occasionally fumble the format; one retry is usually enough.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const castIds = brief.cast.map((c) => c.id);
        const target = Math.min(brief.targetSeconds, MAX_LOCAL_SECONDS);
        const schema = localScriptSchema(castIds, Math.max(6, Math.round(target / 9)), Math.max(10, Math.round(target / 4)));
        const script = await this.client.chat(system, user, schema, {
          prepare: (raw) => {
            const loose = ScriptSchema.safeParse(raw);
            return loose.success ? normalizeSpeakers(loose.data, castIds) : raw;
          },
        });
        return { script: tameActions(script), writer: `ollama:${this.client.model}` };
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
}
