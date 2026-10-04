import type { SetId } from "../../shared/types.js";

export type ShowFormat = "late_night" | "morning" | "soap" | "hangout" | "sitcom" | "cartoon";

export interface Show {
  id: string;
  title: string;
  format: ShowFormat;
  set: SetId;
  /** Segment types that play on a different set (e.g. the diner scenes of a sitcom). */
  setFor?: Record<string, SetId>;
  /** Segment types that are music performances: a rotating guest artist, or the house band. */
  musicFor?: Record<string, "guest" | "house">;
  /** Segment types performed by one cast member alone (e.g. a stand-up cold open). */
  soloFor?: Record<string, string>;
  /** Studio audience laughs on punchlines (lines the writers mark with laugh: true). */
  laughTrack?: boolean;
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
  /** A short original scene showing the tone and joke density we want (writers must not reuse it). */
  example: string;
}

export const SHOWS: Record<string, Show> = {
  late_byte: {
    id: "late_byte",
    example: "rex: Folks, the network sent me a memo. Two words: \"less Rex.\" One of those words is my name.\ndeedee: They sent me one too. Mine says \"more Dee Dee.\" Same font.\nrex: That's a coincidence.\ndeedee: It's not a coincidence, Rex. I wrote both memos.\nrex: You can't write memos! You're the band!\ndeedee: The band has a printer now. Hit it, boys.",
    title: "The Late Byte with Rex Volta",
    format: "late_night",
    set: "late_night",
    tier: "premium",
    cast: ["rex", "deedee"],
    guestPool: ["brick", "oolong", "glimmer", "fumble"],
    serialized: false,
    bible:
      "A late-night talk show taped in front of a live (pixel) audience. Rex hosts from the desk; Dee Dee and the Interference play from the band riser. Guests sit on the couch. Tone: affectionate roast, absurd bits, real chemistry. Rex and Dee Dee have a long-running will-they-won't-they-quit rivalry.",
    segmentTypes: ["monologue", "desk bit", "guest interview", "musical performance", "audience bit", "band banter", "band break"],
    musicFor: { "musical performance": "guest", "band break": "house" },
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
    example: "sunny: Good morning! Today's smoothie has kale, joy, and one secret ingredient!\ngreg: Is the secret ingredient my weather segment? Because it's been missing for three weeks.\nsunny: The secret ingredient is gratitude, Greg.\ngreg: You can't blend gratitude.\nsunny: Not with that attitude.\npip: Reporting live-ish from the parking lot, where I can confirm it is also morning out here.\ngreg: Finally. Someone with a forecast.",
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
    example: "victoria: You came back, Marcus. The ocean usually keeps what I give it.\nmarcus: I don't remember the ocean. I remember a seagull. And the seagull remembers you.\nlola: Victoria, darling, your will has a typo. It says \"Lola\" where it used to say \"Dante.\"\ndante: Mother. Is that true?\nvictoria: It's not a typo. It's a negotiation.\nlola: Then I hope you brought your checkbook. I brought the yacht's black box.",
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
    example: "kev: The rarest cartridge in the world has a typo on the label. Mine has two. I'm basically royalty.\nmarisol: You paid four hundred dollars for a spelling mistake.\nkev: I paid four hundred dollars for history.\ntony: I paid four dollars for these chips and honestly, I think I won.\nmarisol: Ranked: Tony, the chips, and then you, Kev.\nkev: The chips aren't even a person!\ntony: They're more of a person than that cartridge.",
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
  nada: {
    id: "nada",
    example: "jerome: You can't re-gift a fruit basket back to the person who gave it to you. That's not a gift. That's a boomerang with pears. [laugh]\nlenny: She'll never know! I took the card out!\nmargo: Lenny, she put a tracking sticker on the pineapple. [laugh]\nlenny: Who tracks a pineapple?!\ndash (enters): Giddy-up! Whose pineapple is beeping? [laugh]\njerome: And there it is. The pineapple has a better social life than Lenny. [laugh]",
    title: "Much Ado About Nada",
    format: "sitcom",
    set: "sitcom_apartment",
    setFor: { "stand-up cold open": "comedy_club", "diner scene": "diner" },
    soloFor: { "stand-up cold open": "jerome" },
    laughTrack: true,
    tier: "premium",
    cast: ["jerome", "lenny", "margo", "dash"],
    guestPool: ["brothmaster", "pemberton"],
    serialized: false,
    bible:
      "A multi-camera sitcom about nothing, taped before a live studio audience. Four self-absorbed friends obsess over trivial social rules and petty grievances (double-dipping, re-gifting, the etiquette of the 'close talker'), and each episode's tiny problems collide absurdly. Nobody learns anything. Mark punchlines with laugh: true - roughly every second or third line in a good scene. Stand-up cold opens are Jerome alone at the comedy club doing observational material ('what is the deal with...'). Dash always bursts in (action enter) rather than walking in calmly.",
    segmentTypes: ["stand-up cold open", "apartment scene", "diner scene", "apartment scene", "the scheme collapses"],
    topics: [
      "the etiquette of splitting a check to the penny",
      "a coworker who won't stop close-talking",
      "re-gifting a fruit basket back to the original giver",
      "being banned from the soup counter",
      "a parking space standoff that lasts all day",
      "pretending to like a friend's terrible band",
      "a man who returns a jacket because he doesn't like its personality",
      "the last good marble rye in the city",
    ],
  },
  pixelsons: {
    id: "pixelsons",
    example: "hank: Kids, I solved the plant safety inspection. I'm going to inspect myself. Woo-hoo! I passed!\nlyra: Dad, that's not how inspections work. That's not how anything works.\nmidge: Hmmmm. Hank, why is your lunchbox glowing?\nhank: That's my sandwich, Midge. It's just very... enthusiastic.\nbiff: Can I borrow it? I have a science fair tomorrow.\nlyra: If anyone cares, which they don't, the sandwich is humming.",
    title: "The Pixelsons",
    format: "cartoon",
    set: "family_couch",
    laughTrack: false,
    tier: "standard",
    cast: ["hank", "midge", "biff", "lyra"],
    guestPool: ["grimsworth", "gus", "todd"],
    serialized: false,
    bible:
      "An animated family sitcom in the town of Pleasantburg. Hank's impulsive schemes, Biff's pranks, Lyra's activism and Midge's patience collide; the town's oddballs drop by. Fast, joke-dense, satirical but warm - every episode ends with the family back together on the couch, nothing changed. Cartoon logic is allowed (absurd escalation, sight-gag descriptions in dialogue). No laugh track: laugh is always false.",
    segmentTypes: ["family scheme", "dinner table argument", "guest drops by", "Hank's terrible idea", "the moral of the story"],
    topics: [
      "Hank tries to get out of the plant safety inspection",
      "Biff starts a business selling homework",
      "Lyra protests the school cafeteria",
      "the family's car breaks down on the way to a theme park",
      "Hank enters a donut-eating competition",
      "Midge discovers she's secretly great at something",
      "a mysterious mascot appears in Pleasantburg",
      "Grimsworth wants the family's house for a parking lot",
    ],
  },
};

export function getShow(id: string): Show {
  const s = SHOWS[id];
  if (!s) throw new Error(`unknown show: ${id}`);
  return s;
}
