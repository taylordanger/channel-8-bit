import type { MusicStyle } from "../../shared/music.js";

export type Role = "vocals" | "guitar" | "bass" | "keys" | "drums";

export interface Artist {
  id: string;
  name: string;
  style: MusicStyle;
  bpm: [number, number];
  members: { id: string; role: Role }[];
  songs: string[];
  /** How the host introduces them. */
  intro: string;
}

/** Invented bands. Every song is original, generated from a seed at air time. */
export const ARTISTS: Record<string, Artist> = {
  glimmer: {
    id: "glimmer",
    name: "Glimmer",
    style: "synthpop",
    bpm: [96, 112],
    members: [
      { id: "glimmer", role: "vocals" },
      { id: "deedee", role: "keys" },
      { id: "lou", role: "bass" },
      { id: "sticks", role: "drums" },
    ],
    songs: ["Ghost in the Fax Machine", "Buffering Heart", "Static Lullaby", "Error 404: Feelings Not Found", "Dial Tone Dreams"],
    intro: "Ladies and gentlemen, performing \"{song}\", here's Glimmer!",
  },
  rusty_spurs: {
    id: "rusty_spurs",
    name: "The Rusty Spurs",
    style: "rock",
    bpm: [108, 128],
    members: [
      { id: "buck", role: "vocals" },
      { id: "tammy", role: "guitar" },
      { id: "lou", role: "bass" },
      { id: "earl", role: "drums" },
    ],
    songs: ["Gravel Road Gospel", "Tractor Full of Tears", "Moonshine and Modems", "My Truck Has Wi-Fi Now", "Porch Light Blues"],
    intro: "All the way from a gas station off Route 9, it's The Rusty Spurs with \"{song}\"!",
  },
  sewer_rats: {
    id: "sewer_rats",
    name: "The Sewer Rats",
    style: "punk",
    bpm: [168, 192],
    members: [
      { id: "spit", role: "vocals" },
      { id: "rash", role: "guitar" },
      { id: "lou", role: "bass" },
      { id: "dex", role: "drums" },
    ],
    songs: ["Unsubscribe", "Mom's Basement Riot", "Terms and Conditions", "Ctrl Alt Defeat", "Read Receipts"],
    intro: "Please keep your hands and feet inside the studio. Here's The Sewer Rats with \"{song}\"!",
  },
  interference: {
    id: "interference",
    name: "The Interference",
    style: "synthpop",
    bpm: [100, 120],
    members: [
      { id: "deedee", role: "keys" },
      { id: "lou", role: "bass" },
      { id: "sticks", role: "drums" },
    ],
    songs: ["Commercial Break Boogie", "Union Break Blues", "Applause Sign Shuffle", "Ratings Week"],
    intro: "Take it away, Dee Dee and the Interference, with \"{song}\"!",
  },
};
