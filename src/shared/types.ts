import type { SongSpec } from "./music.js";

// Types shared by the station (server) and the player (browser).
// Everything a viewer needs to render a segment is inside the Segment itself,
// so the player never needs the server's catalog.

export const EMOTIONS = ["neutral", "happy", "angry", "sad", "surprised", "smug", "nervous"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const ACTIONS = ["none", "laugh", "lean_in", "gesture", "stand", "dance", "walk_off", "enter", "applause"] as const;
export type Action = (typeof ACTIONS)[number];

/** Lasting moods: they persist across segments and shows until something changes them. */
export const MOODS = ["neutral", "elated", "furious", "heartbroken", "smug", "anxious", "embarrassed", "scheming"] as const;
export type Mood = (typeof MOODS)[number];

export const HAIR_STYLES = [
  "short", "long", "bald", "mohawk", "bun", "afro", "spiky", "bob",
  "pompadour", "swoop", "wild", "ponytail", "huge", "beehive", "fringe",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const ACCESSORIES = [
  "glasses", "shades", "goggles", "hat", "starhat", "beanie", "headband",
  "headphones", "headset", "bowtie", "earrings", "necklace", "bandage",
] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export type Build = "slim" | "average" | "broad" | "round" | "tiny";
export type Eyes = "dot" | "wide" | "sleepy" | "lashes" | "beady";
export type Nose = "none" | "small" | "big" | "long";
export type FacialFeature = "none" | "mustache" | "beard" | "stubble" | "freckles" | "blush";
export type Outfit = "plain" | "stripes" | "suit" | "hoodie" | "dress" | "gown" | "labcoat" | "tank" | "turtleneck" | "vest";

/** Procedural pixel-art description of a character. The player draws it; no sprite files needed. */
export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  /** Main garment color. */
  shirt: string;
  pants: string;
  /** Secondary color: tie, stripes, trim. */
  accent: string;
  outfit: Outfit;
  build: Build;
  eyes: Eyes;
  nose: Nose;
  facial: FacialFeature;
  accessories: Accessory[];
  /** Body height in logical pixels (roughly 34-48). */
  height: number;
  /** Visual glitching (for characters who are "slightly malfunctioning"). */
  glitch?: boolean;
}

export type SetId =
  | "late_night"
  | "morning_couch"
  | "soap_livingroom"
  | "basement"
  | "sitcom_apartment"
  | "diner"
  | "comedy_club"
  | "family_couch"
  | "music_stage"
  | "game_show"
  | "bumper";

export interface CastMember {
  id: string;
  name: string;
  look: Look;
  /** Index into the set's marks (standing/sitting positions). */
  mark: number;
  /** Whether the character is on set when the segment starts. */
  onSetAtStart: boolean;
  /** Their lasting mood going into the scene (sets their resting expression). */
  mood?: Mood;
  /** Music segments: what they play ("vocals", "guitar", "bass", "keys", "drums", "host"). */
  role?: string;
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
  /** Sitcoms: the studio audience laughs after this line. */
  laugh?: boolean;
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
  /** Music segments: the song, regenerated identically in every viewer's browser. */
  song?: SongSpec;
  /** Game shows: who's playing and the score going into this segment. */
  game?: GameState;
  /** A viewer poll that opens with this segment. */
  poll?: Poll;
}

export interface GameState {
  episode: string;
  contestants: string[];
  /** Round wins so far. */
  scores: Record<string, number>;
  step: string;
  /** Set on the ceremony segment: who takes home the trophy. */
  champion?: string;
}

export interface Poll {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  /** Absolute station time voting closes (set when the segment is scheduled). */
  closesAt: number;
}

export interface PollResult {
  pollId: string;
  tally: Record<string, number>;
  closed: boolean;
  winner?: string;
  /** True when nobody voted and the studio audience decided. */
  studio?: boolean;
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
  | { type: "retract"; ids: string[] }
  | { type: "poll"; result: PollResult }
  | { type: "viewers"; count: number };

export type ClientMessage = { type: "ping"; c: number };
