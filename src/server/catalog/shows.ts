import type { SetId } from "../../shared/types.js";

export type ShowFormat = "late_night" | "morning" | "soap" | "hangout" | "sitcom" | "cartoon" | "gameshow" | "news" | "callin" | "cooking" | "commercial";

export interface Show {
  id: string;
  title: string;
  format: ShowFormat;
  set: SetId;
  /** Segment types that play on a different set (e.g. the diner scenes of a sitcom). */
  setFor?: Record<string, SetId>;
  /** The segment type in which the cast reads and answers viewer mail. */
  mailSegment?: string;
  /** Game shows: who can be drafted as a contestant (from across the network). */
  contestantPool?: string[];
  /** Game shows: the fixed order of segments in one game (repeats with new contestants). */
  gameSteps?: string[];
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
  /** A game show whose last-place finisher gets booked as this show's next guest. */
  bookLosersFrom?: string;
  /** A different guest for every segment (call-in shows) instead of one per airing. */
  guestPerSegment?: boolean;
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
    bookLosersFrom: "hot_seat",
    serialized: false,
    bible:
      "A late-night talk show taped in front of a live (pixel) audience. Rex hosts from the desk; Dee Dee and the Interference play from the band riser. Guests sit on the couch. Tone: affectionate roast, absurd bits, real chemistry. Rex and Dee Dee have a long-running will-they-won't-they-quit rivalry.",
    segmentTypes: ["monologue", "desk bit", "guest interview", "musical performance", "audience bit", "band banter", "band break", "viewer mail"],
    mailSegment: "viewer mail",
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
    segmentTypes: ["cold open banter", "weather fight", "remote report", "cooking demo", "lifestyle tip", "viewer call-ins"],
    mailSegment: "viewer call-ins",
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
    segmentTypes: ["hot take", "top three list", "childhood memory", "would you rather", "snack review", "listener questions"],
    mailSegment: "listener questions",
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
  news: {
    id: "news",
    title: "The 8-Bit Report",
    format: "news",
    set: "news_desk",
    tier: "standard",
    cast: ["lance", "paige", "wren"],
    serialized: false,
    bible:
      "The network's evening news, a parody of a self-important local newscast. Lance anchors with total gravitas and no understanding; Paige fact-checks him live; Wren reports 'live from the scene' from the wrong place. When a segment has SOURCE MATERIAL (a real article from the assignment desk), that's the top story: report it accurately from the source, and the comedy comes from the anchors' reactions, never from inventing facts. Otherwise the news is about this network's own fictional world - who won Hot Seat, who stormed off Pixel Heights, feuds, rumors from the halls of Channel 8-Bit - and never real-world news.",
    segmentTypes: ["top story", "network news", "field report", "corrections", "viewer questions", "kicker"],
    mailSegment: "viewer questions",
    topics: [
      "a feud on another show here at the network",
      "the station's vending machine, which has achieved sentience",
      "a ratings war between two shows on this network",
      "the studio's mysterious seventh floor",
      "a lost-and-found box with alarming contents",
      "the network's new mascot, which nobody approved",
    ],
    example:
      "lance: Good evening, and brace yourselves. Tonight's top story: a fire at the network. Paige?\npaige: A small correction, Lance. It's a fire drill.\nlance: A fire drill. Was anyone drilled?\npaige: Nobody was drilled. It's a practice.\nlance: Then let's go live to Wren, who is practicing at the scene.\nwren: Lance, I'm live outside the building, which is the wrong building. But the people here are very calm.\nlance: Chilling. Back to you, Paige.\npaige: You can't send it back to me. I'm sitting right here.",
  },
  callin: {
    id: "callin",
    title: "Ask Dr. Dot",
    format: "callin",
    set: "radio_booth",
    tier: "standard",
    cast: ["dot", "murray"],
    guestPool: ["rex", "greg", "victoria", "kev", "lenny", "marisol", "dash", "brick", "lola", "tony", "sunny", "hank"],
    guestPerSegment: true,
    serialized: false,
    bible:
      "A lunchtime call-in advice show. Dr. Dot gives confident, very specific, useless advice; Murray screens the calls and knows everyone's business. Callers are characters from the network's other shows calling about problems from their own lives - their feuds, their losses, their bosses, the people they share a set with - so use what they remember and how they feel. Viewer letters get the same treatment. Problems are silly and fictional, and so is the advice: never real medical, legal, financial or mental-health advice. If a letter seems to describe a real, serious problem, Dr. Dot drops the act for one kind line - this show is for silly problems; talk to someone you trust - and moves on.",
    segmentTypes: ["guest caller", "guest caller", "viewer letter", "lightning round", "doctor's orders"],
    mailSegment: "viewer letter",
    soloFor: { "doctor's orders": "dot" },
    topics: [
      "a coworker who keeps stealing their lunch",
      "a feud that has gotten out of hand",
      "a terrible gift they have to pretend to love",
      "a rival who is better at their job",
      "a houseplant that seems to be judging them",
      "a group chat they can't escape",
    ],
    example:
      "dot: You're on the air, sweetie. What's troubling you?\ngreg: My co-host keeps stealing my weather segment.\ndot: Have you considered becoming the weather?\ngreg: I... what?\ndot: Wear a cloud costume. She can't steal you if you are the forecast.\nmurray: Doc, he's a grown man.\ndot: A grown man who will soon be a cumulonimbus. Doctor's orders!\ngreg: Seventy percent chance I hang up.\nmurray: My mic was off for the good advice again, wasn't it.",
  },
  cooking: {
    id: "cooking",
    title: "Kitchen Nightmode",
    format: "cooking",
    set: "kitchen",
    tier: "standard",
    cast: ["remy", "pepper"],
    guestPool: ["brick", "greg", "victoria", "lenny", "dash", "oolong", "marisol", "tony", "hank"],
    serialized: false,
    bible:
      "An afternoon cooking show. Chef Remy Burns cooks with total confidence and sets everything on fire; Pepper Mills actually cooks, quietly saves the dish, and narrates the disasters. Each day a guest from another show on the network is the taste tester and has to eat the result. The recipes are absurd and fictional (an eight-layer 8-bit lasagna, a soup that's 'mostly confidence') - never real cooking instructions, food-safety tips or nutrition claims. Physical comedy goes in the action field; fire and smoke are funny, nobody gets hurt.",
    segmentTypes: ["recipe intro", "the cook", "something's burning", "guest taste test", "viewer recipe", "plating"],
    mailSegment: "viewer recipe",
    topics: [
      "an eight-layer 8-bit lasagna",
      "a soup that is mostly confidence",
      "breakfast for dinner for breakfast",
      "a cake shaped like the network's logo",
      "the world's most dramatic grilled cheese",
      "a salad with a secret",
    ],
    example:
      "remy: Welcome to Kitchen Nightmode! Today: crème brûlée. The torch is my favorite instrument.\npepper: It's a dessert, Remy, not a band.\nremy: Everything is a band if you believe. Watch the sugar caramelize.\npepper: That's the dish towel.\nremy: Then the dish towel is caramelizing. Flavor event!\npepper: Gerald, it's your time.\nremy: Plate it, Pepper.\npepper: I'm plating the backup I made at six a.m. Like every day.",
  },
  hot_seat: {
    id: "hot_seat",
    title: "Hot Seat",
    example: "chet: Welcome back to Hot Seat! Greg, the question was \"name something you'd find in a kitchen.\" You said \"regret.\"\ngreg: It's MY kitchen, Chet.\nchet: Pip! Same question!\npip: A... kitchen?\nchet: Lock it in!\nlenny: I'd like to change my answer to whatever Pip said.\nchet: Lenny, you haven't answered yet.\nlenny: And I'd like to keep it that way.",
    format: "gameshow",
    set: "game_show",
    tier: "standard",
    cast: ["chet"],
    contestantPool: ["greg", "pip", "kev", "marisol", "tony", "lenny", "dash", "margo", "hank", "lyra", "brick", "oolong", "marcus", "lola"],
    gameSteps: ["introductions", "lightning round", "pitch round", "would you rather round", "final showdown", "champion ceremony"],
    serialized: false,
    bible:
      "A loud, glittering game show where three contestants drafted from other shows on the network compete for the Golden Pixel. The viewers at home vote on who won each round - their verdicts are law, and Chet reads them out with total reverence. Contestants bring their own personalities, grudges and catchphrases from their home shows. Rounds are short and silly: lightning questions with absurd answers, pitching ridiculous products, impossible would-you-rathers. Every contestant must get a distinct, memorable moment each round so the audience has something to vote on. Chet never declares a round winner himself - the vote does.",
    segmentTypes: ["introductions", "lightning round", "pitch round", "would you rather round", "final showdown", "champion ceremony"],
    topics: [
      "name something you should never microwave",
      "pitch a product for people who hate mornings",
      "would you rather fight one horse-sized duck or keep this job",
      "describe your nemesis using only food",
      "invent a new holiday and its worst tradition",
      "explain your home show to an alien",
    ],
  },
};

/** Commercial breaks: not on the schedule; slotted between segments when there's something to sell. */
export const AD_SHOW: Show = {
  id: "ad_break",
  title: "Commercial Break",
  format: "commercial",
  set: "commercial",
  tier: "standard",
  cast: ["vance"],
  serialized: false,
  example: "vance: Are you tired of your desk looking like a desk? I WAS.\ngreg: My desk was a war zone, Vance. Papers. Despair.\nvance: Then meet the Tiny Desk Flamingo! It stands on one leg so you don't have to!\ngreg: It's... very pink.\nvance: It's PINK, Greg! Pink is a lifestyle!\ngreg: I think I love it. I think it's looking at me.\nvance: It is. Find it at the link!",
  bible:
    "A 25-second infomercial, absurd and weirdly earnest. The pitchman presents a real product while a 'satisfied customer' from elsewhere on the network vouches for it. The COMEDY is in the over-the-top situations and reactions - obviously jokes. Any real claim about what the product is or does must come from the product listing in SOURCE MATERIAL. Never say a price, a discount, a sale, or a delivery promise. Never read out a URL; end by pointing viewers to 'the link'.",
  segmentTypes: ["infomercial"],
  topics: ["the product"],
};

export function getShow(id: string): Show {
  if (id === AD_SHOW.id) return AD_SHOW;
  const s = SHOWS[id];
  if (!s) throw new Error(`unknown show: ${id}`);
  return s;
}
