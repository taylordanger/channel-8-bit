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
/** A "line" that is really a stage direction: starts with an action word and a comma or "-ing" clause. */
const STAGE_DIRECTION = /^(enters?|exits?|walks?|walking|storms?|stands?|sits?|leans?|laughs?|sighs?|pauses?|gestures?|turns?|nods?|shrugs?|returns?|re-?enters?|looks?)\b(,|\s+(in|out|off|back|away|over|up|down|to|toward|into|onto)\b|\s+\w+ing\b)/i;

/** Ways a show says goodbye for the night. */
const SIGN_OFF = /\b(that's all the time we have|that's all for (tonight|today)|see you (next time|tomorrow)|thanks for watching|good ?night,? (everybody|everyone|folks|insomniacs)|until next time)\b/i;
/** Formats that address the viewers directly, so a goodbye means the show is ending. */
const AUDIENCE_FORMATS = new Set(["late_night", "morning", "hangout", "gameshow", "news", "callin", "cooking"]);

/** Two lines that are mostly the same words (the same joke told twice). */
export function nearDuplicate(a: string, b: string): boolean {
  const words = (x: string) => x.toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const wa = words(a);
  const wb = new Set(words(b));
  if (wa.length < 5 || wb.size < 5) return false;
  const shared = new Set(wa.filter((w) => wb.has(w))).size;
  return shared / Math.min(new Set(wa).size, wb.size) >= 0.7;
}

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
  brief: Pick<WriterBrief, "cast" | "show" | "recentLines" | "source" | "overused" | "lastSegment">,
  policy: StandardsPolicy = DEFAULT_POLICY,
  /** Checks aimed at the model writers' habits (the improv troupe's stock bits are exempt). */
  opts: { writerChecks?: boolean } = { writerChecks: true },
): StandardsResult {
  const writerChecks = opts.writerChecks !== false;
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
    // A stage direction written as dialogue ("enter, walking back in with a grin") isn't speakable.
    // ("Enter, Dash. You've got five seconds..." is dialogue: real directions don't end in punctuation.)
    if (STAGE_DIRECTION.test(b.line) && !/[.!?]["']?$/.test(b.line)) {
      notes.push({ verdict: "cut", line: b.line, reason: "stage direction, not dialogue" });
      continue;
    }
    // Goodbyes belong to the end of the show, not the middle of it.
    // (Only shows that talk to the audience: a soap character's "until next time" is part of the story.)
    if (writerChecks && brief.lastSegment === false && AUDIENCE_FORMATS.has(brief.show.format)) {
      const kept = (b.line.match(/[^.!?]+[.!?]*\s*/g) ?? [b.line]).filter((s) => !SIGN_OFF.test(s)).join("").trim();
      if (kept !== b.line) {
        notes.push({ verdict: kept ? "fix" : "cut", line: b.line, reason: "signed off in the middle of the show" });
        b.line = kept;
        if (!kept) continue;
      }
    }
    // Worn-out phrases: small models ignore "never say X", so trim the sentences that say it.
    const fresh = writerChecks ? dropOverused(b.line, brief.overused ?? []) : b.line;
    if (fresh !== b.line) {
      notes.push({ verdict: fresh ? "fix" : "cut", line: b.line, reason: "overused phrase" });
      b.line = fresh;
    }
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
    // The same joke twice in one scene: a line that mostly repeats an earlier one.
    if (writerChecks && beats.some((prev) => nearDuplicate(prev.line, b.line))) {
      notes.push({ verdict: "cut", line: b.line, reason: "repeats an earlier line in this scene" });
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

/**
 * Everyday words: a run made only of these is natural speech ("I don't know", "what's going on"),
 * not a cliché worth banning.
 */
const FILLER = new Set([
  "the", "a", "an", "to", "of", "and", "i", "you", "it", "is", "in", "that", "this", "for", "on", "me", "my", "your", "be",
  "are", "was", "what", "with", "we", "so", "just", "not", "do", "at", "don't", "know", "think", "i'm", "i'll", "it's",
  "going", "trying", "thought", "one", "who's", "you're", "what's", "have", "got", "get", "can", "if", "but", "about",
  "all", "out", "up", "here", "there", "now", "right", "really", "oh", "well", "maybe", "want", "need", "let's", "he", "she",
  "they", "him", "her", "his", "them", "our", "us", "how", "why", "when", "where", "who", "go", "come", "say", "said", "make",
]);

/** Remove the sentences of a line that use a banned phrase; "" when nothing is left. */
export function dropOverused(line: string, phrases: string[]): string {
  if (!phrases.length) return line;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
  const kept = sentences.filter((s) => !phrases.some((p) => ` ${norm(s)} `.includes(` ${p} `)));
  return kept.length === sentences.length ? line : kept.join("").trim();
}

/**
 * Phrases the writers keep reaching for: 3- and 4-word runs that turn up in at least `minScenes`
 * different recent scenes ("don't play dumb", "we'll see about that"). Fed back to the writers
 * as banned, so the clichés rotate out on their own.
 */
export function overusedPhrases(scenes: string[][], minScenes = 3, max = 10, keep: string[] = []): string[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  // Catchphrases are supposed to repeat.
  const kept = keep.map(norm);
  const seen = new Map<string, number>();
  for (const lines of scenes) {
    const grams = new Set<string>();
    for (const line of lines) {
      const words = line.toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);
      for (const n of [4, 3])
        for (let i = 0; i + n <= words.length; i++) {
          const gram = words.slice(i, i + n);
          if (gram.every((w) => FILLER.has(w))) continue;
          // "the anonymous letters", "a laminated card": story nouns, not clichés.
          if (["the", "a", "an"].includes(gram[0])) continue;
          const g = gram.join(" ");
          if (kept.some((k) => k.includes(g))) continue;
          grams.add(g);
        }
    }
    for (const g of grams) seen.set(g, (seen.get(g) ?? 0) + 1);
  }
  const hot = [...seen].filter(([, n]) => n >= minScenes).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out: string[] = [];
  for (const [g] of hot) {
    // One slot per phrase: skip runs that share two words in a row with one already chosen
    // ("wait what's going" vs "what's going on").
    const pairs = (x: string) => x.split(" ").slice(1).map((w, i, a) => `${x.split(" ")[i]} ${w}`);
    if (out.some((o) => pairs(o).some((p) => pairs(g).includes(p)))) continue;
    out.push(g);
    if (out.length >= max) break;
  }
  return out;
}
