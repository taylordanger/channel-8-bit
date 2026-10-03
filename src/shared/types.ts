// Types shared by the station (server) and the player (browser).
// Everything a viewer needs to render a segment is inside the Segment itself,
// so the player never needs the server's catalog.

export const EMOTIONS = ["neutral", "happy", "angry", "sad", "surprised", "smug", "nervous"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const ACTIONS = ["none", "laugh", "lean_in", "gesture", "stand", "dance", "walk_off", "enter", "applause"] as const;
export type Action = (typeof ACTIONS)[number];

export const HAIR_STYLES = ["short", "long", "bald", "mohawk", "bun", "afro", "spiky", "bob"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const ACCESSORIES = ["none", "glasses", "shades", "hat", "bowtie", "earrings", "headphones", "beanie"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

/** Procedural pixel-art description of a character. The player draws it; no sprite files needed. */
export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  accessory: Accessory;
  /** Body height in logical pixels (roughly 30-40). */
  height: number;
}

export type SetId = "late_night" | "morning_couch" | "soap_livingroom" | "basement" | "bumper";

export interface CastMember {
  id: string;
  name: string;
  look: Look;
  /** Index into the set's marks (standing/sitting positions). */
  mark: number;
  /** Whether the character is on set when the segment starts. */
  onSetAtStart: boolean;
}

export interface Cue {
  /** Offset from segment start, ms. */
  t: number;
  /** Duration, ms. */
  dur: number;
  speaker: string;
  text: string;
  emotion: Emotion;
  action: Action;
  /** Who the line is aimed at: a cast id, "camera", or "audience". */
  target: string;
  /** URL of the voiced line, or null when the line is silent (silent TTS / shadow runs). */
  audio: string | null;
  /** Mouth-openness envelope, one digit 0-9 per ENVELOPE_STEP_MS. */
  env: string;
}

export const ENVELOPE_STEP_MS = 50;

export interface Segment {
  id: string;
  showId: string;
  showTitle: string;
  title: string;
  set: SetId;
  /** Station epoch time (ms since Unix epoch) at which the segment airs. */
  startAt: number;
  durationMs: number;
  cast: CastMember[];
  cues: Cue[];
  /** "live" = freshly written; "rerun" = re-aired from the archive; "bumper" = station ID filler. */
  kind: "live" | "rerun" | "bumper";
  /** Which writer produced it, for transparency in the status panel. */
  writer: string;
}

export interface GuideEntry {
  showId: string;
  title: string;
  startAt: number;
  endAt: number;
  mode: "live" | "rerun";
}

/** Messages on the /ws socket. */
export type ServerMessage =
  | { type: "hello"; serverNow: number; network: string }
  | { type: "pong"; c: number; s: number }
  | { type: "segment"; segment: Segment }
  | { type: "viewers"; count: number };

export type ClientMessage = { type: "ping"; c: number };
