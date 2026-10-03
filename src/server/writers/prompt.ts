import type { Show } from "../catalog/shows.js";
import { CHARACTERS } from "../catalog/characters.js";
import type { WriterBrief } from "./script.js";

/**
 * The stable part of the prompt: network rules + show bible + character bibles.
 * Byte-identical across every segment of a show so it caches.
 */
export function systemPrompt(networkName: string, show: Show): string {
  const people = [...show.cast, ...(show.guestPool ?? [])].map((id) => CHARACTERS[id]);
  return `You are the writers' room for ${networkName}, a 24/7 television network whose entire cast is fictional pixel-art characters. You write one segment at a time; it is voiced by text-to-speech and animated live.

NETWORK STANDARDS (non-negotiable):
- Every character and guest is fictional. Never name, impersonate, or make claims about real living people, real companies' private conduct, or real current events.
- Comedy can be sharp, but no slurs, no sexual content, no real-world medical/legal/financial advice.
- Lines are spoken aloud by TTS: write natural speech. No stage directions, asterisks, emoji, or parentheticals inside lines. Put physical business in the "action" field instead.
- Keep each line under 40 words. Vary rhythm: short punches between longer lines.
- Characters have memories and relationships (given below). Use them: callbacks, grudges, inside jokes. Let feelings drift naturally and report the drift in relationshipChanges.
- Never repeat a line from RECENTLY AIRED.
- Use speaker ids exactly as listed. Use walk_off only for a genuinely dramatic exit, and enter when someone returns.

SHOW: ${show.title}
${show.bible}
Segment types this show runs: ${show.segmentTypes.join(", ")}.
${show.serialized ? "This show is SERIALIZED: every segment must advance the plot, and you must return the updated storyState." : "This show is episodic: storyState must be an empty string."}

CHARACTERS (id - name: bible | catchphrases):
${people.map((c) => `- ${c.id} - ${c.name}: ${c.bible} | ${c.catchphrases.map((p) => `"${p}"`).join(", ")}`).join("\n")}`;
}

/** The volatile part: this segment's assignment and the cast's current state. */
export function userPrompt(b: WriterBrief): string {
  const name = (id: string) => CHARACTERS[id]?.name ?? id;
  const lines = Math.max(6, Math.round(b.targetSeconds / 7));
  const sections = [
    `ASSIGNMENT: Write a "${b.segmentType}" segment, about ${b.targetSeconds} seconds of air time (roughly ${lines} lines). It is ${b.localTime} at the station.`,
    `ON SET: ${b.cast.map((c) => `${c.id} (${c.name})`).join(", ")}.${b.guest ? ` Tonight's guest is ${b.guest.name} (${b.guest.id}).` : ""}`,
    `TOPIC SEED (use it, twist it, or abandon it for a better bit): ${b.topic}`,
  ];
  if (b.storyState) sections.push(`STORY SO FAR:\n${b.storyState}`);
  if (b.previously.length) sections.push(`PREVIOUSLY:\n${b.previously.map((s) => `- ${s}`).join("\n")}`);
  if (b.memories.length)
    sections.push(
      `WHAT THEY REMEMBER:\n${b.memories.map((m) => `- [${m.about.map(name).join(", ")}] ${m.text}`).join("\n")}`,
    );
  const rels = b.relationships.filter((r) => r.score !== 0 || r.note);
  if (rels.length)
    sections.push(
      `HOW THEY FEEL (-100 nemesis .. 100 adores):\n${rels
        .map((r) => `- ${name(r.a)} -> ${name(r.b)}: ${Math.round(r.score)}${r.note ? ` (${r.note})` : ""}`)
        .join("\n")}`,
    );
  if (b.recentLines.length) sections.push(`RECENTLY AIRED (do not repeat):\n${b.recentLines.slice(-40).map((l) => `- ${l}`).join("\n")}`);
  return sections.join("\n\n");
}
