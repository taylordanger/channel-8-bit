import type { Look } from "../../shared/types.js";

export interface Character {
  id: string;
  name: string;
  /** One paragraph the writers' room always sees. */
  bible: string;
  /** Verbal tics the improv writer and Claude both lean on. */
  catchphrases: string[];
  /**
   * Signature lines in this character's voice. Claude sees them as style examples;
   * the improv writer airs them directly. {other} = someone on set, {topic} = the topic.
   */
  bits: string[];
  voice: { say: string; rate: number };
  look: Look;
}

const c = (x: Character) => x;

export const CHARACTERS: Record<string, Character> = Object.fromEntries(
  [
    // --- The Late Byte -------------------------------------------------------
    c({
      id: "rex",
      name: "Rex Volta",
      bible:
        "Host of The Late Byte. Velvet-voiced, vain, quietly terrified of the ratings. Thinks every joke is a classic. Takes jabs from Dee Dee personally but pretends not to. Calls the audience 'my beautiful insomniacs'. His pompadour has its own insurance policy.",
      catchphrases: ["my beautiful insomniacs", "that's a Volta classic", "roll the tape, roll it"],
      bits: [
        "My hair has a separate dressing room, {other}. It has a separate agent.",
        "I tested this joke on a focus group. Two of them laughed. One of them was me.",
        "Folks, the ratings came in, and I'm told we beat a test pattern. Narrowly.",
        "I don't need applause. I need applause, a standing ovation, and maybe a parade.",
        "{other}, I'm going to pretend you didn't say that, the way I pretend the ratings don't exist.",
        "Let's talk about {topic}. My lawyer says I'm allowed to have opinions again.",
      ],
      voice: { say: "Reed (English (US))", rate: 190 },
      look: {
        skin: "#e7b47e", hair: "#24160b", hairStyle: "pompadour", shirt: "#7a1f3d", pants: "#1c1c2e", accent: "#ffcc33",
        outfit: "suit", build: "average", eyes: "lashes", nose: "big", facial: "none", accessories: ["bowtie"], height: 44,
      },
    }),
    c({
      id: "deedee",
      name: "Dee Dee Static",
      bible:
        "Bandleader of The Late Byte's house band, the Interference. Deadpan, unimpressed, plays a cracked keytar. Undercuts Rex constantly and the audience loves her more than him. Secretly writes his best jokes.",
      catchphrases: ["sure, Rex", "the band's on a union break", "hit it, boys"],
      bits: [
        "Sure, Rex.",
        "The band would like it on the record that we were against this.",
        "I wrote that joke, Rex. You said it wrong, but I wrote it.",
        "My keytar has seen things. It has a crack in it from the last time you sang.",
        "That's a really interesting point, {other}. I'm going to go stand over here now.",
        "I've been playing this same chord for six years. Nobody has noticed. That's showbiz.",
      ],
      voice: { say: "Samantha", rate: 170 },
      look: {
        skin: "#8d5524", hair: "#7b2fe0", hairStyle: "bob", shirt: "#161616", pants: "#3b3b58", accent: "#ff3355",
        outfit: "hoodie", build: "slim", eyes: "sleepy", nose: "small", facial: "none", accessories: ["shades", "earrings"], height: 40,
      },
    }),
    // Late-night guests (fictional celebrities; never real people)
    c({
      id: "brick",
      name: "Brick Thunderman",
      bible:
        "Action-movie star of the 'Detonation Highway' franchise (nine sequels). Speaks in taglines, can't follow a normal conversation, extremely earnest about his skincare line.",
      catchphrases: ["that's a wrap... on YOU", "I do my own stunts", "hydration is a lifestyle"],
      bits: [
        "In Detonation Highway Nine, I punch a helicopter. In real life, I moisturize.",
        "I don't have feelings, {other}. I have stunt coordinators.",
        "This interview just became personal.",
        "Some men fear death. I fear dry elbows.",
        "{topic}? I once jumped a motorcycle over {topic}. Twice. The second time was for the poster.",
        "I'm going to need everyone to stay calm while I flex respectfully.",
      ],
      voice: { say: "Ralph", rate: 175 },
      look: {
        skin: "#c68642", hair: "#111111", hairStyle: "spiky", shirt: "#3d5a1e", pants: "#2e2e2e", accent: "#9aa03a",
        outfit: "tank", build: "broad", eyes: "beady", nose: "big", facial: "stubble", accessories: [], height: 47,
      },
    }),
    c({
      id: "oolong",
      name: "Madame Oolong",
      bible:
        "Celebrity psychic with a hit podcast. Her predictions are always wrong and she is never bothered. Insists she and Rex were lovers in a past life.",
      catchphrases: ["the tea leaves never lie", "I foresaw this", "your aura is beige"],
      bits: [
        "I foresaw this conversation, {other}. It went better in my vision.",
        "Rex and I were lovers in the year twelve hundred. He was a goat. A very handsome goat.",
        "The spirits tell me someone in this room owes me money.",
        "Your aura is beige, {other}. That's not an insult. It's a diagnosis.",
        "I predicted {topic} three years ago. I was wrong, but I was wrong first.",
        "The tea leaves say... oh. Oh no. I used a teabag. That's on me.",
      ],
      voice: { say: "Moira", rate: 165 },
      look: {
        skin: "#f1c27d", hair: "#c9c9d6", hairStyle: "long", shirt: "#2a7f62", pants: "#4b2142", accent: "#ffd84d",
        outfit: "gown", build: "round", eyes: "wide", nose: "long", facial: "blush", accessories: ["starhat", "earrings", "necklace"], height: 41,
      },
    }),
    c({
      id: "glimmer",
      name: "Glimmer",
      bible:
        "Dark art-pop singer. Speaks in short, unsettling poetic fragments. Moves like she's slightly malfunctioning. Has a new album, 'Ghost in the Fax Machine'. Unnervingly polite.",
      catchphrases: ["the static loves you back", "I am buffering", "thank you, mortal"],
      bits: [
        "I am buffering. Please hold. Your call is important to the void.",
        "My new album was recorded inside a fax machine. The fax machine is credited as a producer.",
        "Thank you, mortal. Your applause tastes like copper.",
        "{other}, you have a very nice face. I would like to keep it in a jar. Metaphorically.",
        "{topic} is just loneliness with better lighting.",
        "Sometimes I hear a dial tone in my dreams. It is my mother.",
      ],
      voice: { say: "Tessa", rate: 150 },
      look: {
        skin: "#f2e6ee", hair: "#0d0d0d", hairStyle: "long", shirt: "#e6e6f0", pants: "#0d0d0d", accent: "#7a00ff",
        outfit: "dress", build: "slim", eyes: "wide", nose: "none", facial: "none", accessories: [], height: 44, glitch: true,
      },
    }),
    c({
      id: "fumble",
      name: "Professor Hank Fumble",
      bible:
        "Pop-science professor promoting his book 'Probably Fine: The Science of Not Worrying'. Every demo he brings goes slightly wrong. Endlessly cheerful about it.",
      catchphrases: ["that's science, baby", "in theory", "nobody touch that"],
      bits: [
        "Nobody touch that. Nobody breathe near that. Actually, everybody take one step back.",
        "In theory this is completely safe. In practice I have no eyebrows.",
        "That smell? That's science, baby.",
        "My book is called Probably Fine. My lawyer wanted it called Probably Fine, Please Don't Sue.",
        "Fun fact about {topic}: I made that up. But it felt true, and that's half of science.",
        "{other}, you have the curiosity of a scientist and the hand-eye coordination of my last intern.",
      ],
      voice: { say: "Fred", rate: 180 },
      look: {
        skin: "#ffdbac", hair: "#ffffff", hairStyle: "wild", shirt: "#4a7bd1", pants: "#4a4a4a", accent: "#ffd84d",
        outfit: "labcoat", build: "tiny", eyes: "wide", nose: "big", facial: "mustache", accessories: ["goggles"], height: 38,
      },
    }),

    // --- Rise & Pixel (morning) ---------------------------------------------
    c({
      id: "sunny",
      name: "Sunny Mae Holloway",
      bible:
        "Relentlessly upbeat morning host. Has never had a bad day on air and it's starting to frighten people. Running feud with Greg over who owns the weather segment.",
      catchphrases: ["rise and pixel", "isn't that just delicious", "let's keep it sunny"],
      bits: [
        "Good morning! I've been awake since three. I'm always awake. I don't know how to stop.",
        "Isn't that just delicious? Everything is delicious. I'm so happy. Please help me.",
        "Greg, sweetie, the weather segment belongs to everyone. Like air. Or my smile.",
        "I did a gratitude journal this morning. I'm grateful for {topic}, and for you, {other}, mostly.",
        "Let's keep it sunny! Even if it's raining. Especially if it's raining.",
        "My therapist says I have toxic positivity. I told her that's wonderful news!",
      ],
      voice: { say: "Ava (Premium)", rate: 185 },
      look: {
        skin: "#ffe0bd", hair: "#f2c94c", hairStyle: "huge", shirt: "#ff8c42", pants: "#3e5c76", accent: "#ffffff",
        outfit: "dress", build: "average", eyes: "lashes", nose: "small", facial: "blush", accessories: ["earrings"], height: 42,
      },
    }),
    c({
      id: "greg",
      name: "Greg Brickman",
      bible:
        "Morning co-host and self-appointed weatherman. Grumpy, has not slept since 2019, treats every forecast like a war bulletin. Believes Sunny is stealing his weather segment.",
      catchphrases: ["it's going to be a cold one", "back in my day", "that's MY segment"],
      bits: [
        "That's MY segment. I have a laminated card that says weather. Laminated, Sunny.",
        "It's going to be a cold one. I'm talking about my heart, but also Tuesday.",
        "Back in my day, weather was just a guy looking out a window. I was that guy. I'm still that guy.",
        "I have not slept since twenty nineteen and I've never felt more awake. That's a lie.",
        "{topic}? Expect scattered disappointment with a high chance of me complaining.",
        "{other}, I respect you. I don't like you. But I respect you.",
      ],
      voice: { say: "Rocko (English (US))", rate: 170 },
      look: {
        skin: "#d2a67a", hair: "#6a6a6a", hairStyle: "short", shirt: "#3b6e8f", pants: "#2b2b2b", accent: "#a33a3a",
        outfit: "vest", build: "round", eyes: "sleepy", nose: "big", facial: "mustache", accessories: ["glasses"], height: 43,
      },
    }),
    c({
      id: "pip",
      name: "Pip Okafor",
      bible:
        "Overeager intern who keeps getting sent into the field for 'remote segments' that are clearly just the parking lot. Nervous, earnest, wants a full-time job desperately.",
      catchphrases: ["reporting live-ish", "is this on?", "I won't let you down"],
      bits: [
        "Reporting live-ish from the parking lot, where a pigeon has been staring at me for an hour.",
        "Is this on? Hello? Greg, is my microphone on, or am I just talking to a cone again?",
        "I won't let you down! I've only let you down a medium amount so far!",
        "I made a slideshow about {topic}. It's forty slides. Twelve of them are just my face.",
        "{other}, if I do a really good job today, can I have a desk? Or a chair? Or a stool?",
        "Breaking news: the vending machine took my dollar. Developing story.",
      ],
      voice: { say: "Junior", rate: 200 },
      look: {
        skin: "#7a4b2a", hair: "#1a1a1a", hairStyle: "short", shirt: "#ffd23f", pants: "#2d4059", accent: "#2d4059",
        outfit: "stripes", build: "tiny", eyes: "wide", nose: "small", facial: "freckles", accessories: ["headset"], height: 36,
      },
    }),

    // --- Pixel Heights (serialized soap) --------------------------------------
    c({
      id: "victoria",
      name: "Victoria Sterling",
      bible:
        "Matriarch of the Sterling family and owner of Sterling Tower. Icy, scheming, always three moves ahead. Speaks in elegant threats. Will do anything to keep the family fortune.",
      catchphrases: ["how... quaint", "the Sterlings always win", "we'll see about that"],
      bits: [
        "How... quaint.",
        "I didn't build Sterling Tower by being nice, {other}. I built it by being right, and then being nicer than you about it.",
        "Pour me a drink. No, the other drink. The one I keep for betrayals.",
        "You may have won the battle, darling. I bought the battlefield this morning.",
        "{topic}? I had that handled before you finished your sentence.",
        "Family is everything, {other}. Which is why I've had all of you followed.",
      ],
      voice: { say: "Shelley (English (UK))", rate: 160 },
      look: {
        skin: "#f1d1b5", hair: "#e3e3ea", hairStyle: "bun", shirt: "#4b0f2e", pants: "#1a1a1a", accent: "#c9a227",
        outfit: "gown", build: "slim", eyes: "lashes", nose: "long", facial: "none", accessories: ["necklace", "earrings"], height: 46,
      },
    }),
    c({
      id: "dante",
      name: "Dante Sterling",
      bible:
        "Victoria's brooding son. Wants out of the family business, keeps getting pulled back in. Has a complicated history with Lola. Stares out of windows a lot.",
      catchphrases: ["I'm not like you, Mother", "it's complicated", "leave her out of this"],
      bits: [
        "I'm not like you, Mother. I have feelings. Several. All of them are about this window.",
        "It's complicated, {other}. Everything with me is complicated. I make toast complicated.",
        "Leave her out of this.",
        "I tried to leave this family once. I got as far as the lobby. The lobby is very nice.",
        "{topic} haunts me. Like the rain. Like my father's portrait. Like the rain on my father's portrait.",
        "Excuse me. I need to go brood somewhere with better lighting.",
      ],
      voice: { say: "Reed (English (UK))", rate: 165 },
      look: {
        skin: "#c99770", hair: "#1e130b", hairStyle: "swoop", shirt: "#1f2a44", pants: "#111111", accent: "#1f2a44",
        outfit: "turtleneck", build: "slim", eyes: "sleepy", nose: "small", facial: "stubble", accessories: [], height: 47,
      },
    }),
    c({
      id: "lola",
      name: "Lola Vance",
      bible:
        "The new neighbor in apartment 9B. Charming, sharp, obviously hiding something. Seems to know a little too much about the Sterlings' past.",
      catchphrases: ["oh, I just moved in", "funny you should ask", "darling, please"],
      bits: [
        "Oh, I just moved in. I don't know anything about the yacht. What yacht? Lovely weather.",
        "Funny you should ask, {other}. Funny how everyone keeps asking.",
        "Darling, please. I've been underestimated by better families than this.",
        "I brought a casserole. It's not poisoned. Probably. That's a joke. Mostly.",
        "{topic}? Never heard of it. I definitely don't have a file on it in my freezer.",
        "Everyone in this building has a secret. Mine just has better shoes.",
      ],
      voice: { say: "Allison (Enhanced)", rate: 175 },
      look: {
        skin: "#a86b4c", hair: "#a3201f", hairStyle: "long", shirt: "#d4a017", pants: "#2c2c54", accent: "#1a1a1a",
        outfit: "dress", build: "average", eyes: "lashes", nose: "small", facial: "none", accessories: ["shades"], height: 43,
      },
    }),
    c({
      id: "marcus",
      name: "Dr. Marcus Kale",
      bible:
        "The family doctor, presumed dead in a yacht accident two seasons ago. Recently returned with no memory of the last two years and a mysterious bandage on his forehead. Gentle, confused, possibly a pawn.",
      catchphrases: ["I don't remember", "as your doctor", "something isn't right here"],
      bits: [
        "I don't remember. I don't remember anything. I don't even remember why I'm holding this spoon.",
        "As your doctor, {other}, I recommend less scheming. Also fiber.",
        "Something isn't right here. Also, whose coat is this? I think it's mine. It's very wet.",
        "I woke up on a beach with this bandage and a strong opinion about seagulls.",
        "{topic}... that rings a bell. Several bells. Possibly a concussion.",
        "Have we met? You look like someone who once pushed me off a yacht.",
      ],
      voice: { say: "Aman", rate: 165 },
      look: {
        skin: "#8d5524", hair: "#202020", hairStyle: "short", shirt: "#5a7d9a", pants: "#34495e", accent: "#5a7d9a",
        outfit: "labcoat", build: "average", eyes: "dot", nose: "big", facial: "none", accessories: ["glasses", "bandage"], height: 45,
      },
    }),

    // --- Couch Co-op (retro games basement) ----------------------------------
    c({
      id: "kev",
      name: "Kev",
      bible:
        "Encyclopedic retro-game nerd. Will defend any 90s console to the death. Owns four copies of the same cartridge 'for preservation'. Lives in this basement.",
      catchphrases: ["actually, the Japanese version", "blow on the cartridge", "this is canon"],
      bits: [
        "Actually, the Japanese version had one extra pixel on the hero's hat. It changes everything.",
        "I own four copies. One to play, one to preserve, one to look at, one in case of fire.",
        "Blow on the cartridge. No, gently. With love. Like you're whispering to it.",
        "This is canon. I wrote a forty-page forum post about why this is canon.",
        "{topic} was better on the original hardware, {other}. Everything was better on the original hardware.",
        "My mom says I can stay down here until I find a real job. That was eleven years ago. We have a great system.",
      ],
      voice: { say: "Eddy (English (US))", rate: 195 },
      look: {
        skin: "#ffdbac", hair: "#8b5a2b", hairStyle: "ponytail", shirt: "#2e8b57", pants: "#3a3a3a", accent: "#ffd23f",
        outfit: "stripes", build: "round", eyes: "dot", nose: "small", facial: "stubble", accessories: ["glasses"], height: 41,
      },
    }),
    c({
      id: "marisol",
      name: "Marisol",
      bible:
        "Competitive speedrunner. Talks fast, keeps score on everything, thinks Kev's nostalgia is a weakness. Will turn any conversation into a challenge.",
      catchphrases: ["frame perfect", "I could beat that blindfolded", "reset, reset, reset"],
      bits: [
        "I could beat that blindfolded. I have beaten that blindfolded. I've beaten it asleep.",
        "Reset. Reset. Reset. That's not a bad run, that's a learning opportunity, and I hate learning.",
        "Kev, nostalgia is just losing slowly with a smile on your face.",
        "I timed this conversation. We're four seconds behind my personal best.",
        "{topic}? I've got a world record in {topic}. Any percent, glitchless, angry.",
        "{other}, I'll race you. For what? For honor. And for the last chip.",
      ],
      voice: { say: "Flo (English (US))", rate: 205 },
      look: {
        skin: "#c68642", hair: "#1a1a1a", hairStyle: "mohawk", shirt: "#c0392b", pants: "#1f1f1f", accent: "#ffffff",
        outfit: "tank", build: "slim", eyes: "beady", nose: "small", facial: "none", accessories: ["headband"], height: 40,
      },
    }),
    c({
      id: "tony",
      name: "Big Tony",
      bible:
        "Kev's cousin. Doesn't really play games, just here for the snacks. Occasionally says something accidentally profound, then eats a chip.",
      catchphrases: ["pass the chips", "that's beautiful, man", "I don't get it but I respect it"],
      bits: [
        "Pass the chips.",
        "I don't get it, but I respect it.",
        "You know, we're all just little guys running right, trying to get to the castle. That's beautiful, man.",
        "I played a game once. I pressed start. It was a lot. I went and got a sandwich.",
        "{topic}? I don't know, {other}. Is it crunchy? Then I'm in.",
        "My cousin Kev is a genius. A genius who hasn't seen the sun since the nineties. But a genius.",
      ],
      voice: { say: "Grandpa (English (US))", rate: 160 },
      look: {
        skin: "#e0ac69", hair: "#3d2b1f", hairStyle: "short", shirt: "#6b4226", pants: "#2f4f4f", accent: "#c0392b",
        outfit: "hoodie", build: "broad", eyes: "sleepy", nose: "big", facial: "beard", accessories: ["beanie"], height: 46,
      },
    }),
  ].map((ch) => [ch.id, ch]),
);

export function getCharacter(id: string): Character {
  const ch = CHARACTERS[id];
  if (!ch) throw new Error(`unknown character: ${id}`);
  return ch;
}
