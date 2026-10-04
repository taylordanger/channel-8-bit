import type { Action, Emotion } from "../../shared/types.js";
import type { Character } from "../catalog/characters.js";
import { estimateSpeechMs, type Beat, type Script, type Writer, type WriterBrief, type WriterResult } from "./script.js";

/** Small seeded PRNG so improv output is reproducible in tests and shadow runs. */
export function rng(seed: number) {
  // Scramble the seed first: raw xorshift gives near-identical first draws for nearby seeds.
  let s = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
  s = (s ^ (s >>> 16)) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

type Line = { text: string; emotion: Emotion; action?: Action; target?: "other" | "camera" | "audience" };

const OPENERS: Record<string, Line[]> = {
  late_night: [
    { text: "Good evening, {catch}! Welcome to the show!", emotion: "happy", action: "gesture", target: "audience" },
    { text: "Thank you, thank you, sit down, I know. We have a great show tonight. Allegedly.", emotion: "smug", target: "audience" },
  ],
  morning: [
    { text: "Good morning and {catch}! We have a jam-packed show for you.", emotion: "happy", target: "camera" },
    { text: "Welcome back, early birds. Let's talk about {topic}.", emotion: "happy", target: "camera" },
  ],
  soap: [
    { text: "You shouldn't have come here. Not tonight.", emotion: "angry", target: "other" },
    { text: "We need to talk about {topic}. Now.", emotion: "nervous", target: "other" },
  ],
  hangout: [
    { text: "Okay okay okay, we're rolling. Today's topic: {topic}.", emotion: "happy", target: "camera" },
    { text: "Welcome back to the basement. Somebody start us off with {topic}.", emotion: "neutral", target: "camera" },
  ],
};

// Middle lines are assembled from fragments (lead-in + core + tag) so the troupe has
// thousands of combinations and can honor the standards desk's no-repeats rule.
const LEADINS = ["", "Okay, ", "Look, ", "Honestly, ", "With respect, ", "Hold on. ", "Listen, ", "Not gonna lie, ", "Real talk, ", "Fine. "];
const TAGS = ["", " Just saying.", " Think about it.", " I said what I said.", " Write that down.", " Don't look at me like that.", " Moving on.", " Every time.", " Trust me.", " You know I'm right."];

const MIDDLE: Line[] = [
  { text: "{other}, what do you really think about {topic}?", emotion: "neutral", target: "other" },
  { text: "I have been thinking about {topic} all week and I have concerns.", emotion: "nervous" },
  { text: "that is the worst take I have ever heard, {other}.", emotion: "angry", action: "lean_in", target: "other" },
  { text: "what if {topic} is actually good?", emotion: "smug", action: "gesture" },
  { text: "{catch}.", emotion: "smug" },
  { text: "wait. Say that again, {other}.", emotion: "surprised", action: "lean_in", target: "other" },
  { text: "you always do this, {other}.", emotion: "angry", target: "other" },
  { text: "ha! No, that's fair, {other}.", emotion: "happy", action: "laugh", target: "other" },
  { text: "I don't want to talk about {topic}.", emotion: "sad" },
  { text: "show of hands, who agrees with me about {topic}?", emotion: "happy", target: "audience" },
  { text: "remember last time, {other}? I'm still not over it.", emotion: "sad", target: "other" },
  { text: "that's the smartest thing you've said today, {other}.", emotion: "surprised", target: "other" },
  { text: "my grandmother had strong opinions about {topic}.", emotion: "neutral" },
  { text: "{topic} changed my life and I'm not joking.", emotion: "happy", action: "gesture" },
  { text: "{other}, you're going to regret saying that.", emotion: "smug", target: "other" },
  { text: "I would rather fight a goose than discuss {topic} again.", emotion: "angry" },
  { text: "{catch}, that's the whole point.", emotion: "smug", target: "other" },
  { text: "nobody talks about the dark side of {topic}.", emotion: "nervous", action: "lean_in" },
];

const SOAP_MIDDLE: Line[] = [
  { text: "I know what you did, {other}. I know everything.", emotion: "angry", action: "lean_in", target: "other" },
  { text: "you think you can just walk back into this family, {other}?", emotion: "angry", target: "other" },
  { text: "there are things about {topic} you couldn't possibly understand.", emotion: "smug", target: "other" },
  { text: "I trusted you, {other}. That was my mistake.", emotion: "sad", target: "other" },
  { text: "{catch}.", emotion: "smug", target: "other" },
  { text: "then explain {topic}, {other}.", emotion: "surprised", action: "gesture", target: "other" },
  { text: "don't you dare threaten me in my own home.", emotion: "angry", target: "other" },
  { text: "something isn't right about {topic}. I can feel it.", emotion: "nervous" },
  { text: "you were there that night, {other}. Weren't you?", emotion: "angry", action: "lean_in", target: "other" },
  { text: "if anyone finds out about {topic}, we're finished.", emotion: "nervous", target: "other" },
  { text: "I've waited years for this moment.", emotion: "smug", target: "other" },
  { text: "{other}, look at me. Tell me it isn't true.", emotion: "sad", target: "other" },
];
const SOAP_LEADINS = ["", "Darling, ", "Oh, please. ", "Enough. ", "Listen to me. ", "No. ", "How dare you. ", "Careful. "];
const SOAP_TAGS = ["", " And you know it.", " This isn't over.", " Mark my words.", " Not tonight.", " For the family.", " Choose wisely."];

OPENERS.sitcom = [
  { text: "What is the deal with {topic}? Who are these people?", emotion: "smug", action: "gesture", target: "audience" },
  { text: "Okay, okay, you are not going to believe what happened with {topic}.", emotion: "surprised", target: "other" },
];
OPENERS.cartoon = [
  { text: "Family meeting! It's about {topic}. And also dinner.", emotion: "happy", action: "gesture", target: "other" },
  { text: "Kids, your father has a brilliant idea involving {topic}.", emotion: "nervous", target: "other" },
];

const CLOSERS: Record<string, Line[]> = {
  late_night: [{ text: "We'll be right back, {catch}!", emotion: "happy", action: "gesture", target: "camera" }],
  morning: [{ text: "Stay with us, we've got more after the break. {catch}!", emotion: "happy", target: "camera" }],
  soap: [
    { text: "This isn't over. Not by a long shot.", emotion: "angry", action: "walk_off", target: "other" },
    { text: "Then you leave me no choice.", emotion: "smug", target: "other" },
  ],
  hangout: [{ text: "Alright, that's the segment. Somebody pass the chips.", emotion: "happy", target: "camera" }],
  sitcom: [
    { text: "That's it. I'm done. I'm out. I'm going to the diner.", emotion: "angry", action: "walk_off", target: "other" },
    { text: "Well, that's a {topic} I'll never get back.", emotion: "smug", target: "other" },
  ],
  cartoon: [
    { text: "Kids, let this be a lesson. About... something. Let's eat.", emotion: "happy", target: "other" },
    { text: "Well, at least nobody got hurt. Much.", emotion: "nervous", target: "other" },
  ],
};

/**
 * The house improv troupe: a template writer that needs no API key and costs nothing.
 * It keeps the station on the air when Claude is unavailable, over budget, or refusing,
 * and gives tests and shadow runs a deterministic writer.
 */
export class ImprovWriter implements Writer {
  readonly name = "improv";
  constructor(private seed = Date.now()) {}

  async write(brief: WriterBrief): Promise<WriterResult> {
    // The troupe can't read a linked article, so it sticks to the show's own topics
    // rather than parroting a headline (or a real person's name) into the script.
    const b = brief.source ? { ...brief, topic: brief.show.topics[(this.seed >>> 0) % brief.show.topics.length], source: undefined } : brief;
    const r = rng(this.seed++ ^ hash(b.show.id + b.topic));
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const cast = b.cast;
    const fill = (l: Line, who: Character, other: Character): Beat => ({
      speaker: who.id,
      line: sentenceCase(
        l.text
          .replaceAll("{catch}", pick(who.catchphrases))
          .replaceAll("{topic}", b.topic)
          .replaceAll("{other}", other.name.split(" ")[0]),
      ),
      emotion: l.emotion,
      action: l.action ?? "none",
      target: l.target === "other" ? other.id : (l.target ?? other.id),
      // Laugh-track shows: the audience laughs at the punchier lines.
      laugh: b.show.format === "sitcom" && (l.emotion === "smug" || l.emotion === "surprised" || r() < 0.25),
    });

    const soap = b.show.format === "soap";
    const middle = soap ? SOAP_MIDDLE : MIDDLE;
    const compose = (l: Line): Line => {
      const text = pick(soap ? SOAP_LEADINS : LEADINS) + l.text + pick(soap ? SOAP_TAGS : TAGS);
      return { ...l, text: text.charAt(0).toUpperCase() + text.slice(1) };
    };
    const beats: Beat[] = [];
    const recent = new Set(b.recentLines);
    const usedCores = new Set<Line>();
    const usedBits = new Set<string>();
    let speakerIdx = 0;
    const next = () => cast[speakerIdx++ % cast.length];
    const otherThan = (c: Character) => pick(cast.filter((x) => x.id !== c.id)) ?? c;

    const lead = next();
    beats.push(fill(pick(OPENERS[b.show.format]), lead, otherThan(lead)));
    let ms = estimateSpeechMs(beats[0].line);
    const target = b.targetSeconds * 1000 * 0.85;
    for (let guard = 0; ms < target && guard < 60; guard++) {
      const who = r() < 0.25 ? pick(cast) : next();
      // Signature bits make the troupe sound like the actual characters.
      const freshBits = who.bits.filter((x) => !usedBits.has(x));
      if (freshBits.length && r() < 0.4) {
        const bitText = pick(freshBits);
        usedBits.add(bitText);
        const beat = fill({ text: bitText, emotion: pick(BIT_EMOTIONS), action: r() < 0.25 ? "gesture" : "none", target: "other" }, who, otherThan(who));
        if (recent.has(beat.line) || beats.some((x) => x.line === beat.line)) continue;
        beats.push(beat);
        ms += estimateSpeechMs(beat.line) + 350;
        continue;
      }
      const core = pick(middle);
      if (usedCores.has(core) && usedCores.size < middle.length) continue;
      usedCores.add(core);
      const beat = fill(compose(core), who, otherThan(who));
      if (cast.length > 1 && beat.speaker === beats[beats.length - 1].speaker) continue;
      if (recent.has(beat.line) || beats.some((x) => x.line === beat.line)) continue;
      beats.push(beat);
      ms += estimateSpeechMs(beat.line) + 350;
    }
    const closer = next();
    beats.push(fill(pick(CLOSERS[b.show.format]), closer, otherThan(closer)));

    const script: Script = {
      title: titleCase(b.segmentType) + ": " + titleCase(b.topic),
      // The improv troupe fills air; it doesn't get to rewrite history. Memories, recaps and
      // plot belong to real writers, so leave them untouched.
      summary: "",
      beats,
      memories: [],
      relationshipChanges: [],
      storyState: "",
    };
    return { script, writer: this.name };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Capitalize the start of each sentence (slots can drop lowercase text at a sentence start). */
const sentenceCase = (s: string) => s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());

const BIT_EMOTIONS: Emotion[] = ["smug", "happy", "neutral", "surprised", "angry"];

const titleCase = (s: string) => s.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
