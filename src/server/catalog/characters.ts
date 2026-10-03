import type { Look } from "../../shared/types.js";

export interface Character {
  id: string;
  name: string;
  /** One paragraph the writers' room always sees. */
  bible: string;
  /** Verbal tics the improv writer and Claude both lean on. */
  catchphrases: string[];
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
        "Host of The Late Byte. Velvet-voiced, vain, quietly terrified of the ratings. Thinks every joke is a classic. Takes jabs from Dee Dee personally but pretends not to. Calls the audience 'my beautiful insomniacs'.",
      catchphrases: ["my beautiful insomniacs", "that's a Volta classic", "roll the tape, roll it"],
      voice: { say: "Reed (English (US))", rate: 190 },
      look: { skin: "#e0ac69", hair: "#2b1d0e", hairStyle: "short", shirt: "#7a1f3d", pants: "#1c1c2e", accessory: "bowtie", height: 38 },
    }),
    c({
      id: "deedee",
      name: "Dee Dee Static",
      bible:
        "Bandleader of The Late Byte's house band, the Interference. Deadpan, unimpressed, plays a cracked keytar. Undercuts Rex constantly and the audience loves her more than him. Secretly writes his best jokes.",
      catchphrases: ["sure, Rex", "the band's on a union break", "hit it, boys"],
      voice: { say: "Samantha", rate: 170 },
      look: { skin: "#8d5524", hair: "#6c2dc7", hairStyle: "bob", shirt: "#111111", pants: "#3b3b58", accessory: "shades", height: 34 },
    }),
    // Late-night guests (fictional celebrities; never real people)
    c({
      id: "brick",
      name: "Brick Thunderman",
      bible:
        "Action-movie star of the 'Detonation Highway' franchise (nine sequels). Speaks in taglines, can't follow a normal conversation, extremely earnest about his skincare line.",
      catchphrases: ["that's a wrap... on YOU", "I do my own stunts", "hydration is a lifestyle"],
      voice: { say: "Ralph", rate: 175 },
      look: { skin: "#c68642", hair: "#111111", hairStyle: "spiky", shirt: "#3d5a1e", pants: "#2e2e2e", accessory: "none", height: 40 },
    }),
    c({
      id: "oolong",
      name: "Madame Oolong",
      bible:
        "Celebrity psychic with a hit podcast. Her predictions are always wrong and she is never bothered. Insists she and Rex were lovers in a past life.",
      catchphrases: ["the tea leaves never lie", "I foresaw this", "your aura is beige"],
      voice: { say: "Moira", rate: 165 },
      look: { skin: "#f1c27d", hair: "#c0c0c0", hairStyle: "bun", shirt: "#2a7f62", pants: "#4b2142", accessory: "earrings", height: 33 },
    }),
    c({
      id: "glimmer",
      name: "Glimmer",
      bible:
        "Dark art-pop singer. Speaks in short, unsettling poetic fragments. Moves like she's slightly malfunctioning. Has a new album, 'Ghost in the Fax Machine'. Unnervingly polite.",
      catchphrases: ["the static loves you back", "I am buffering", "thank you, mortal"],
      voice: { say: "Tessa", rate: 150 },
      look: { skin: "#f6e0d0", hair: "#0d0d0d", hairStyle: "long", shirt: "#e6e6e6", pants: "#0d0d0d", accessory: "none", height: 36 },
    }),
    c({
      id: "fumble",
      name: "Professor Hank Fumble",
      bible:
        "Pop-science professor promoting his book 'Probably Fine: The Science of Not Worrying'. Every demo he brings goes slightly wrong. Endlessly cheerful about it.",
      catchphrases: ["that's science, baby", "in theory", "nobody touch that"],
      voice: { say: "Fred", rate: 180 },
      look: { skin: "#ffdbac", hair: "#ffffff", hairStyle: "afro", shirt: "#e8e8e8", pants: "#4a4a4a", accessory: "glasses", height: 35 },
    }),

    // --- Rise & Pixel (morning) ---------------------------------------------
    c({
      id: "sunny",
      name: "Sunny Mae Holloway",
      bible:
        "Relentlessly upbeat morning host. Has never had a bad day on air and it's starting to frighten people. Running feud with Greg over who owns the weather segment.",
      catchphrases: ["rise and pixel", "isn't that just delicious", "let's keep it sunny"],
      voice: { say: "Ava (Premium)", rate: 185 },
      look: { skin: "#ffe0bd", hair: "#f2c94c", hairStyle: "long", shirt: "#ff8c42", pants: "#3e5c76", accessory: "earrings", height: 34 },
    }),
    c({
      id: "greg",
      name: "Greg Brickman",
      bible:
        "Morning co-host and self-appointed weatherman. Grumpy, has not slept since 2019, treats every forecast like a war bulletin. Believes Sunny is stealing his weather segment.",
      catchphrases: ["it's going to be a cold one", "back in my day", "that's MY segment"],
      voice: { say: "Rocko (English (US))", rate: 170 },
      look: { skin: "#d2a67a", hair: "#5a5a5a", hairStyle: "short", shirt: "#3b6e8f", pants: "#2b2b2b", accessory: "glasses", height: 37 },
    }),
    c({
      id: "pip",
      name: "Pip Okafor",
      bible:
        "Overeager intern who keeps getting sent into the field for 'remote segments' that are clearly just the parking lot. Nervous, earnest, wants a full-time job desperately.",
      catchphrases: ["reporting live-ish", "is this on?", "I won't let you down"],
      voice: { say: "Junior", rate: 200 },
      look: { skin: "#7a4b2a", hair: "#1a1a1a", hairStyle: "short", shirt: "#ffd23f", pants: "#2d4059", accessory: "headphones", height: 31 },
    }),

    // --- Pixel Heights (serialized soap) --------------------------------------
    c({
      id: "victoria",
      name: "Victoria Sterling",
      bible:
        "Matriarch of the Sterling family and owner of Sterling Tower. Icy, scheming, always three moves ahead. Speaks in elegant threats. Will do anything to keep the family fortune.",
      catchphrases: ["how... quaint", "the Sterlings always win", "we'll see about that"],
      voice: { say: "Shelley (English (UK))", rate: 160 },
      look: { skin: "#f1d1b5", hair: "#d9d9d9", hairStyle: "bun", shirt: "#4b0f2e", pants: "#1a1a1a", accessory: "earrings", height: 35 },
    }),
    c({
      id: "dante",
      name: "Dante Sterling",
      bible:
        "Victoria's brooding son. Wants out of the family business, keeps getting pulled back in. Has a complicated history with Lola. Stares out of windows a lot.",
      catchphrases: ["I'm not like you, Mother", "it's complicated", "leave her out of this"],
      voice: { say: "Reed (English (UK))", rate: 165 },
      look: { skin: "#c99770", hair: "#2b1b10", hairStyle: "short", shirt: "#1f2a44", pants: "#111111", accessory: "none", height: 39 },
    }),
    c({
      id: "lola",
      name: "Lola Vance",
      bible:
        "The new neighbor in apartment 9B. Charming, sharp, obviously hiding something. Seems to know a little too much about the Sterlings' past.",
      catchphrases: ["oh, I just moved in", "funny you should ask", "darling, please"],
      voice: { say: "Allison (Enhanced)", rate: 175 },
      look: { skin: "#a86b4c", hair: "#8b1e1e", hairStyle: "long", shirt: "#d4a017", pants: "#2c2c54", accessory: "none", height: 34 },
    }),
    c({
      id: "marcus",
      name: "Dr. Marcus Kale",
      bible:
        "The family doctor, presumed dead in a yacht accident two seasons ago. Recently returned with no memory of the last two years and a mysterious scar. Gentle, confused, possibly a pawn.",
      catchphrases: ["I don't remember", "as your doctor", "something isn't right here"],
      voice: { say: "Aman", rate: 165 },
      look: { skin: "#8d5524", hair: "#202020", hairStyle: "short", shirt: "#f5f5f5", pants: "#34495e", accessory: "glasses", height: 37 },
    }),

    // --- Couch Co-op (retro games basement) ----------------------------------
    c({
      id: "kev",
      name: "Kev",
      bible:
        "Encyclopedic retro-game nerd. Will defend any 90s console to the death. Owns four copies of the same cartridge 'for preservation'. Lives in this basement.",
      catchphrases: ["actually, the Japanese version", "blow on the cartridge", "this is canon"],
      voice: { say: "Eddy (English (US))", rate: 195 },
      look: { skin: "#ffdbac", hair: "#8b5a2b", hairStyle: "short", shirt: "#2e8b57", pants: "#3a3a3a", accessory: "glasses", height: 34 },
    }),
    c({
      id: "marisol",
      name: "Marisol",
      bible:
        "Competitive speedrunner. Talks fast, keeps score on everything, thinks Kev's nostalgia is a weakness. Will turn any conversation into a challenge.",
      catchphrases: ["frame perfect", "I could beat that blindfolded", "reset, reset, reset"],
      voice: { say: "Flo (English (US))", rate: 205 },
      look: { skin: "#c68642", hair: "#1a1a1a", hairStyle: "mohawk", shirt: "#c0392b", pants: "#1f1f1f", accessory: "none", height: 32 },
    }),
    c({
      id: "tony",
      name: "Big Tony",
      bible:
        "Kev's cousin. Doesn't really play games, just here for the snacks. Occasionally says something accidentally profound, then eats a chip.",
      catchphrases: ["pass the chips", "that's beautiful, man", "I don't get it but I respect it"],
      voice: { say: "Grandpa (English (US))", rate: 160 },
      look: { skin: "#e0ac69", hair: "#3d2b1f", hairStyle: "short", shirt: "#6b4226", pants: "#2f4f4f", accessory: "beanie", height: 36 },
    }),
  ].map((ch) => [ch.id, ch]),
);

export function getCharacter(id: string): Character {
  const ch = CHARACTERS[id];
  if (!ch) throw new Error(`unknown character: ${id}`);
  return ch;
}
