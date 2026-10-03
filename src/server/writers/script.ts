import { z } from "zod";
import { ACTIONS, EMOTIONS } from "../../shared/types.js";
import type { Character } from "../catalog/characters.js";
import type { Show } from "../catalog/shows.js";
import type { Memory, Relationship } from "../memory.js";

/**
 * What every writer must hand back. Kept free of min/max constraints so it maps
 * cleanly onto structured outputs; the standards desk enforces limits instead.
 */
export const ScriptSchema = z.object({
  title: z.string().describe("Short episode/segment title shown in the lower third"),
  summary: z.string().describe("One or two sentences: what happened, for future 'previously on' context"),
  beats: z
    .array(
      z.object({
        speaker: z.string().describe("Character id from the cast list"),
        line: z.string().describe("Exactly what is spoken aloud. No stage directions, no asterisks."),
        emotion: z.enum(EMOTIONS),
        action: z.enum(ACTIONS),
        target: z.string().describe("Character id, 'camera', or 'audience'"),
      }),
    )
    .describe("The spoken lines in order"),
  memories: z
    .array(
      z.object({
        about: z.array(z.string()).describe("Character ids this memory involves"),
        text: z.string().describe("A fact the characters will remember later, e.g. 'Rex lost a bet to Dee Dee and owes her a keytar'"),
        importance: z.number().describe("0 (trivial) to 1 (life-changing)"),
      }),
    )
    .describe("1-3 new things worth remembering"),
  relationshipChanges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        delta: z.number().describe("-25..25 change in how 'from' feels about 'to'"),
        reason: z.string(),
      }),
    )
    .describe("How feelings shifted this segment (can be empty)"),
  storyState: z
    .string()
    .describe("For serialized shows: the updated plot state in 3-6 sentences. Empty string otherwise."),
});

export type Script = z.infer<typeof ScriptSchema>;
export type Beat = Script["beats"][number];

/** Everything the writers' room knows when it sits down to write one segment. */
export interface WriterBrief {
  show: Show;
  segmentType: string;
  topic: string;
  /** Characters on set for this segment (regulars plus any guest). */
  cast: Character[];
  guest?: Character;
  targetSeconds: number;
  localTime: string;
  previously: string[];
  memories: Memory[];
  relationships: Relationship[];
  storyState: string;
  /** Lines aired recently; writers must not repeat them. */
  recentLines: string[];
}

export interface WriterResult {
  script: Script;
  writer: string;
}

export interface Writer {
  readonly name: string;
  write(brief: WriterBrief): Promise<WriterResult>;
}

/** Rough speaking-time estimate used for targeting and silent TTS. */
export function estimateSpeechMs(text: string, wpm = 165): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(700, Math.round((words / wpm) * 60_000));
}
