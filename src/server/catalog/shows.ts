import type { SetId } from "../../shared/types.js";

export type ShowFormat = "late_night" | "morning" | "soap" | "hangout";

export interface Show {
  id: string;
  title: string;
  format: ShowFormat;
  set: SetId;
  /** "standard" shows are written by the cheaper model, "premium" by the bigger one. */
  tier: "standard" | "premium";
  /** Regular cast in mark order (mark 0 is the leftmost position on the set). */
  cast: string[];
  /** Rotating guests; one is booked per guest segment. */
  guestPool?: string[];
  /** Whether the show carries an ongoing plot that the writers must advance. */
  serialized: boolean;
  bible: string;
  /** Segment types the writers' room rotates through. */
  segmentTypes: string[];
  /** Topic seeds for when the writers need a nudge (also used by the improv writer). */
  topics: string[];
  /** Serialized shows: where the plot starts before any episode has aired. */
  storySeed?: string;
}

export const SHOWS: Record<string, Show> = {
  late_byte: {
    id: "late_byte",
    title: "The Late Byte with Rex Volta",
    format: "late_night",
    set: "late_night",
    tier: "premium",
    cast: ["rex", "deedee"],
    guestPool: ["brick", "oolong", "glimmer", "fumble"],
    serialized: false,
    bible:
      "A late-night talk show taped in front of a live (pixel) audience. Rex hosts from the desk; Dee Dee and the Interference play from the band riser. Guests sit on the couch. Tone: affectionate roast, absurd bits, real chemistry. Rex and Dee Dee have a long-running will-they-won't-they-quit rivalry.",
    segmentTypes: ["monologue", "desk bit", "guest interview", "audience bit", "band banter"],
    topics: [
      "the studio's broken applause sign",
      "Rex's new self-help audiobook",
      "a viewer complaint letter",
      "the network's suspicious new owner",
      "Rex's feud with a vending machine",
      "Dee Dee's side gig as a wedding DJ",
    ],
  },
  rise_and_pixel: {
    id: "rise_and_pixel",
    title: "Rise & Pixel",
    format: "morning",
    set: "morning_couch",
    tier: "standard",
    cast: ["sunny", "greg", "pip"],
    serialized: false,
    bible:
      "A chipper morning show on a pastel couch set with a fake window. Sunny drives, Greg grumbles, Pip gets sent on hopeless 'remote' segments. Recurring bits: Greg's Doom Forecast, Sunny's Morning Gratitude, Pip's Live-ish Report, a cooking demo that never finishes.",
    segmentTypes: ["cold open banter", "weather fight", "remote report", "cooking demo", "lifestyle tip"],
    topics: [
      "a new breakfast trend nobody asked for",
      "the station's parking lot mystery puddle",
      "National Something Day",
      "a viewer's dog that looks like Greg",
      "a disastrous smoothie recipe",
      "Greg predicting 'weather' indoors",
    ],
  },
  pixel_heights: {
    id: "pixel_heights",
    title: "Pixel Heights",
    format: "soap",
    set: "soap_livingroom",
    tier: "premium",
    cast: ["victoria", "dante", "lola", "marcus"],
    serialized: true,
    bible:
      "A daytime soap set in the penthouse of Sterling Tower. Every scene must advance the plot: secrets, betrayals, dramatic pauses, cliffhangers. Characters speak in heightened soap dialogue. End most scenes on a reveal or a threat. Characters may storm out (walk_off) and enter.",
    segmentTypes: ["confrontation", "secret meeting", "revelation", "cliffhanger"],
    storySeed:
      "Victoria Sterling is days from closing a hostile takeover that would make Sterling Tower untouchable. Dr. Marcus Kale, presumed dead in last season's yacht accident, has returned with no memory and a bandaged forehead. Lola Vance just moved into 9B and seems to know who was really on that yacht. Dante, Victoria's son and Lola's old flame, has found a will that may be forged.",
    topics: [
      "a forged will",
      "Marcus's mysterious scar",
      "what Lola knows about the yacht accident",
      "Victoria's hostile takeover",
      "an anonymous letter",
      "a locked room in Sterling Tower",
    ],
  },
  couch_coop: {
    id: "couch_coop",
    title: "Couch Co-op",
    format: "hangout",
    set: "basement",
    tier: "standard",
    cast: ["kev", "marisol", "tony"],
    serialized: false,
    bible:
      "Three people in a 90s wood-paneled basement talking about old video games like a podcast. Kev is the historian, Marisol the competitor, Tony the snack guy. Only invented or genre-level references (\"that one mascot platformer\", \"the cartridge with the gold label\") - never real brand claims stated as fact.",
    segmentTypes: ["hot take", "top three list", "childhood memory", "would you rather", "snack review"],
    topics: [
      "the hardest level of all time",
      "blowing on cartridges: myth or science",
      "the best soundtrack on a 16-bit console",
      "games that were scarier as a kid",
      "the ideal couch-co-op snack",
      "the worst licensed movie game",
    ],
  },
};

export function getShow(id: string): Show {
  const s = SHOWS[id];
  if (!s) throw new Error(`unknown show: ${id}`);
  return s;
}
