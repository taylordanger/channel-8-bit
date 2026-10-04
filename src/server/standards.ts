import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CHARACTERS } from "./catalog/characters.js";
import type { Clock } from "./clock.js";
import { worstCaseUsd, type Ledger } from "./ledger.js";
import type { Script, WriterBrief } from "./writers/script.js";

export interface StandardsNote {
  verdict: "cut" | "rewrite" | "fix";
  line: string;
  reason: string;
}

export interface StandardsResult {
  script: Script;
  notes: StandardsNote[];
  /** Set when the script can't air at all; the producer falls back to another writer. */
  rejected?: string;
}

export const MIN_BEATS = 4;
const MAX_WORDS = 60;

export interface StandardsPolicy {
  /** Case-insensitive patterns that kill a line outright, always (extend via data/standards.json). */
  blocklist: RegExp[];
  /** Real-world news drift; only enforced on purely fictional segments (no submitted source). */
  fictionBlocklist: RegExp[];
}

export const DEFAULT_POLICY: StandardsPolicy = {
  blocklist: [
    /\b(buy|sell|short)\s+(the\s+)?(stock|shares|crypto|coin)\b/i,
    /\b(dosage|diagnos(e|is) you|legal advice|financial advice)\b/i,
  ],
  fictionBlocklist: [/\b(senator|congress(wo)?man|prime minister|white house|supreme court)\b/i],
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Remove things TTS would read aloud that were never meant to be spoken. */
export function cleanLine(line: string): string {
  return line
    .replace(/\*[^*]*\*/g, " ") // *leans in*
    .replace(/\([^)]*\)/g, " ") // (whispering)
    .replace(/\[[^\]]*\]/g, " ") // [beat]
    .replace(/^[A-Z][A-Za-z .'-]{0,30}:\s+/, "") // "REX: Hello" speaker prefixes
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capWords(line: string, max: number): string {
  if (line.split(/\s+/).length <= max) return line;
  const sentences = line.match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g) ?? [line];
  let out = "";
  for (const s of sentences) {
    const next = (out + " " + s.trim()).trim();
    if (next.split(/\s+/).length > max) break;
    out = next;
  }
  return out || line.split(/\s+/).slice(0, max).join(" ") + ".";
}

/**
 * The deterministic standards desk. Runs on every script from every writer.
 * It never invents content; it only cuts, trims, and repairs.
 */
export function deterministicStandards(
  input: Script,
  brief: Pick<WriterBrief, "cast" | "show" | "recentLines" | "source">,
  policy: StandardsPolicy = DEFAULT_POLICY,
): StandardsResult {
  const notes: StandardsNote[] = [];
  const castIds = new Set(brief.cast.map((c) => c.id));
  const recent = new Set(brief.recentLines.map(normalize));
  const seen = new Set<string>();
  const offSet = new Set<string>();
  const beats: Script["beats"] = [];

  for (const raw of input.beats) {
    const b = { ...raw };
    if (!castIds.has(b.speaker)) {
      notes.push({ verdict: "cut", line: b.line, reason: `speaker "${b.speaker}" is not on set` });
      continue;
    }
    const cleaned = capWords(cleanLine(b.line), MAX_WORDS);
    if (cleaned !== b.line) notes.push({ verdict: "fix", line: b.line, reason: "removed stage directions / trimmed length" });
    b.line = cleaned;
    if (!b.line) {
      notes.push({ verdict: "cut", line: raw.line, reason: "nothing speakable left" });
      continue;
    }
    const hit = [...policy.blocklist, ...(brief.source ? [] : policy.fictionBlocklist)].find((re) => re.test(b.line));
    if (hit) {
      notes.push({ verdict: "cut", line: b.line, reason: `blocklisted: ${hit.source}` });
      continue;
    }
    const n = normalize(b.line);
    if (recent.has(n) || seen.has(n)) {
      notes.push({ verdict: "cut", line: b.line, reason: "repeat of an aired line" });
      continue;
    }
    seen.add(n);
    if (!castIds.has(b.target) && b.target !== "camera" && b.target !== "audience") b.target = "camera";
    // Someone who stormed off has to come back before they can talk.
    if (offSet.has(b.speaker) && b.action !== "enter") {
      b.action = "enter";
      notes.push({ verdict: "fix", line: b.line, reason: `${b.speaker} speaks after walking off; marked as re-entering` });
    }
    if (b.action === "enter") offSet.delete(b.speaker);
    if (b.action === "walk_off") offSet.add(b.speaker);
    beats.push(b);
  }

  const known = (id: string) => id in CHARACTERS;
  const script: Script = {
    title: input.title.replace(/[*[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || brief.show.title,
    summary: input.summary.trim().slice(0, 400),
    beats,
    memories: input.memories
      .map((m) => ({ ...m, about: m.about.filter(known), importance: Math.max(0, Math.min(1, m.importance)) }))
      .filter((m) => m.about.length && m.text.trim())
      .slice(0, 3),
    relationshipChanges: input.relationshipChanges
      .filter((r) => known(r.from) && known(r.to) && r.from !== r.to)
      .map((r) => ({ ...r, delta: Math.max(-25, Math.min(25, r.delta)) })),
    moodChanges: (input.moodChanges ?? [])
      .filter((m) => known(m.character) && m.reason.trim())
      .map((m) => ({ ...m, reason: m.reason.trim().slice(0, 160) }))
      .slice(0, 3),
    storyState: brief.show.serialized ? input.storyState.trim().slice(0, 1200) : "",
  };

  if (beats.length < MIN_BEATS) return { script, notes, rejected: `only ${beats.length} airable lines` };
  return { script, notes };
}

const ReviewSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().describe("Line index as given"),
      verdict: z.enum(["ok", "cut", "rewrite"]),
      rewrite: z.string().describe("Replacement line when verdict is rewrite, else empty"),
      reason: z.string(),
    }),
  ),
});

/**
 * A second, model-based standards pass for premium shows: catches real-person
 * references, defamation, and off-brand content that regexes can't.
 */
export class LlmStandards {
  private client: Anthropic;
  constructor(
    private opts: { model: string; ledger: Ledger; clock: Clock },
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async review(script: Script, showId: string, sourced = false): Promise<StandardsResult> {
    const numbered = script.beats.map((b, i) => `${i}. [${b.speaker}] ${b.line}`).join("\n");
    const system = sourced
        ? "You are the standards and practices editor for an entertainment TV network whose fictional cast is discussing a real article (a separate fact-checker verifies facts against it). Flag only lines that: are defamatory or harassing toward real people; contain slurs or sexual content; give medical, legal or financial advice; or mock real victims of tragedy. Discussing real people and events, opinions, and comedy are fine. Prefer rewrite over cut; rewrites must keep the speaker's voice."
        : "You are the standards and practices editor for a fictional entertainment TV network. All characters are invented. Flag only lines that: name or make claims about real living people or real organizations' conduct; state real-world facts that could be false (statistics, prices, medical/legal/financial claims); contain slurs, sexual content, or harassment. Fictional absurdity, mild insults between characters, and comedy are fine. Prefer rewrite over cut when a small change fixes it; rewrites must keep the speaker's voice and fit the scene.";
    const content = `Review these lines:\n${numbered}`;
    try {
      this.opts.ledger.guard(this.opts.clock.now(), worstCaseUsd(this.opts.model, system.length + content.length, 4000), `standards:${showId}`);
    } catch {
      return { script, notes: [], rejected: "daily budget reached before standards review" };
    }
    const response = await this.client.messages.parse({
      model: this.opts.model,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ReviewSchema), effort: "low" },
    });
    this.opts.ledger.record(this.opts.clock.now(), this.opts.model, `standards:${showId}`, response.usage);
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return { script, notes: [], rejected: "standards reviewer could not clear the script" };
    }
    const notes: StandardsNote[] = [];
    const byIndex = new Map(response.parsed_output.verdicts.map((v) => [v.index, v]));
    const beats = script.beats.flatMap((b, i) => {
      const v = byIndex.get(i);
      if (!v || v.verdict === "ok") return [b];
      if (v.verdict === "rewrite" && v.rewrite.trim()) {
        notes.push({ verdict: "rewrite", line: b.line, reason: v.reason });
        return [{ ...b, line: cleanLine(v.rewrite) }];
      }
      notes.push({ verdict: "cut", line: b.line, reason: v.reason });
      return [];
    });
    const out = { ...script, beats };
    return beats.length < MIN_BEATS ? { script: out, notes, rejected: "too many lines cut in review" } : { script: out, notes };
  }
}
