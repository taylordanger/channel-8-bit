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
  /** macOS `say` voice (fallback) and the Kokoro voice used when it's installed. */
  voice: { say: string; rate: number; kokoro: string; speed: number };
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
      voice: { say: "Reed (English (US))", rate: 190, kokoro: "am_michael", speed: 1.05 },
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
      voice: { say: "Samantha", rate: 170, kokoro: "af_nicole", speed: 0.95 },
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
      voice: { say: "Ralph", rate: 175, kokoro: "am_fenrir", speed: 0.92 },
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
      voice: { say: "Moira", rate: 165, kokoro: "bf_isabella", speed: 0.92 },
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
      voice: { say: "Tessa", rate: 150, kokoro: "af_sky", speed: 0.85 },
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
      voice: { say: "Fred", rate: 180, kokoro: "am_puck", speed: 1.1 },
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
      voice: { say: "Ava (Premium)", rate: 185, kokoro: "af_heart", speed: 1.1 },
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
      voice: { say: "Rocko (English (US))", rate: 170, kokoro: "am_onyx", speed: 0.92 },
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
      voice: { say: "Junior", rate: 200, kokoro: "am_echo", speed: 1.15 },
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
      voice: { say: "Shelley (English (UK))", rate: 160, kokoro: "bf_emma", speed: 0.9 },
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
      voice: { say: "Reed (English (UK))", rate: 165, kokoro: "bm_george", speed: 0.92 },
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
      voice: { say: "Allison (Enhanced)", rate: 175, kokoro: "af_bella", speed: 1.0 },
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
      voice: { say: "Aman", rate: 165, kokoro: "am_adam", speed: 0.95 },
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
      voice: { say: "Eddy (English (US))", rate: 195, kokoro: "am_liam", speed: 1.15 },
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
      voice: { say: "Flo (English (US))", rate: 205, kokoro: "af_jessica", speed: 1.2 },
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
      voice: { say: "Grandpa (English (US))", rate: 160, kokoro: "am_santa", speed: 0.9 },
      look: {
        skin: "#e0ac69", hair: "#3d2b1f", hairStyle: "short", shirt: "#6b4226", pants: "#2f4f4f", accent: "#c0392b",
        outfit: "hoodie", build: "broad", eyes: "sleepy", nose: "big", facial: "beard", accessories: ["beanie"], height: 46,
      },
    }),

    // --- Much Ado About Nada (a sitcom about nothing) -------------------------
    c({
      id: "jerome",
      name: "Jerome Finkel",
      bible:
        "Observational stand-up comic who lives in a tidy apartment and judges everyone's tiny habits. Breaks up with people over trivial flaws (they eat peas one at a time, they have man hands). Detached, smug, a little fussy. Opens episodes with stand-up.",
      catchphrases: ["what is the deal with", "that's a shame", "not that there's anything wrong with that"],
      bits: [
        "What is the deal with airplane peanuts? Who is that hungry? It's ninety minutes. Eat before.",
        "I can't date her, {other}. She says 'expresso.' With an X. There's no X.",
        "You know what the problem with {topic} is? Nobody asked. Nobody ever asked.",
        "I'm not saying it's a crime. I'm saying it's adjacent to a crime.",
        "Why does everybody need a little dish for their keys? Just put them in your pocket! That's what it's for!",
        "{other}, you are the only person I know who could make {topic} worse.",
      ],
      voice: { say: "Eddy (English (US))", rate: 205, kokoro: "am_eric", speed: 1.1 },
      look: {
        skin: "#f0c8a0", hair: "#2a1a10", hairStyle: "short", shirt: "#f2f2f2", pants: "#3a4a6a", accent: "#9fb8d8",
        outfit: "plain", build: "slim", eyes: "dot", nose: "big", facial: "none", accessories: [], height: 45,
      },
    }),
    c({
      id: "lenny",
      name: "Lenny Castellano",
      bible:
        "Jerome's oldest friend: short, balding, cheap, neurotic, and a compulsive liar who builds elaborate schemes to avoid minor embarrassment. Pretends to be an architect. Everything goes wrong and it's always someone else's fault.",
      catchphrases: ["it's not a lie if you believe it", "I was in the pool!", "we're living in a society!"],
      bits: [
        "It's not a lie if you believe it, {other}. And I believe it. Mostly.",
        "I told them I was an architect. Now they want me to design a library. A whole library!",
        "Why is it always me? Why can't it be somebody else? Pick somebody else!",
        "I double-dipped. Fine. I double-dipped. It's a free country. It's a free chip.",
        "{topic}? I'm going to handle {topic} the way I handle everything. Badly, and with a fake name.",
        "We're living in a society, people! There are rules! I don't follow them, but they're there!",
      ],
      voice: { say: "Rocko (English (US))", rate: 215, kokoro: "am_puck", speed: 1.2 },
      look: {
        skin: "#e8b88a", hair: "#3a2a1a", hairStyle: "fringe", shirt: "#c9b07a", pants: "#4a3a2a", accent: "#8a6a3a",
        outfit: "plain", build: "round", eyes: "beady", nose: "big", facial: "none", accessories: ["glasses"], height: 39,
      },
    }),
    c({
      id: "margo",
      name: "Margo Wexler",
      bible:
        "Jerome's ex, now friend. Sharp, confident, publishing assistant with a terrible boss. Shoves people when surprised ('Get OUT!'). Dances horribly - all elbows and thumbs - and doesn't know it.",
      catchphrases: ["get OUT!", "yada yada yada", "oh, please"],
      bits: [
        "Get OUT! No. Get out. Are you serious?",
        "So I met him at the coffee shop, we went to dinner, yada yada yada, I'm banned from Delaware.",
        "{other}, you have the emotional range of a parking meter.",
        "I'm going to dance now and nobody is allowed to say anything.",
        "My boss wants me to write a memo about {topic}. I'd rather eat the memo.",
        "Oh, please. I've dated men with more charisma than this sandwich. Barely.",
      ],
      voice: { say: "Samantha", rate: 195, kokoro: "af_sarah", speed: 1.1 },
      look: {
        skin: "#f2c8a8", hair: "#3a1f12", hairStyle: "huge", shirt: "#7a2e5a", pants: "#2a2a3a", accent: "#e8c56a",
        outfit: "dress", build: "average", eyes: "lashes", nose: "small", facial: "none", accessories: ["earrings"], height: 43,
      },
    }),
    c({
      id: "dash",
      name: "Dash Kowalski",
      bible:
        "Jerome's tall, wild-haired neighbor who bursts in without knocking (always 'enter' with flair). Has bizarre business schemes (a coffee-table book about coffee tables, a pizza place where you make your own pie). Physical, confident, inexplicably successful with everything except money.",
      catchphrases: ["giddy-up!", "oh, I'm out there, Jerome", "these are real, and they're spectacular"],
      bits: [
        "Giddy-up! Jerome, I've got an idea. A cologne that smells like the beach. Nobody's thought of this.",
        "Oh, I'm out there, Jerome. I'm loving every minute of it.",
        "I've been taking baths with my clothes on. Saves time. Laundry and hygiene. One step.",
        "{topic}? I know a guy. He's got a van. Don't ask about the van.",
        "{other}, you're thinking small. I'm thinking medium. Medium is the future.",
        "I don't knock. Knocking is for people with something to hide.",
      ],
      voice: { say: "Fred", rate: 190, kokoro: "am_adam", speed: 1.05 },
      look: {
        skin: "#f0d0b0", hair: "#4a3020", hairStyle: "wild", shirt: "#c76a2e", pants: "#3a3a2a", accent: "#e8b84a",
        outfit: "stripes", build: "slim", eyes: "wide", nose: "long", facial: "none", accessories: [], height: 49,
      },
    }),
    c({
      id: "brothmaster",
      name: "The Broth Tyrant",
      bible:
        "Owner of a tiny, legendary soup counter with draconian ordering rules. Will refuse soup to anyone who breaks protocol. Speaks in clipped commands. Deeply proud of his bisque.",
      catchphrases: ["no broth for you!", "next!", "you want bread? Three dollars"],
      bits: [
        "No broth for you! Come back one month!",
        "Step to the left. Order. Pay. Step to the left again. Why are you not stepping?",
        "You complimented the bisque before ordering. Disrespectful. Next!",
        "{topic}? In my kitchen? Never. Get out of my line.",
      ],
      voice: { say: "Ralph", rate: 200, kokoro: "bm_lewis", speed: 1.05 },
      look: {
        skin: "#d8a878", hair: "#1a1a1a", hairStyle: "short", shirt: "#f4f4f4", pants: "#2a2a2a", accent: "#c0392b",
        outfit: "labcoat", build: "broad", eyes: "beady", nose: "big", facial: "mustache", accessories: [], height: 44,
      },
    }),
    c({
      id: "pemberton",
      name: "Neville Pemberton",
      bible:
        "Jerome's smug, scheming neighbor and arch-nemesis; a mail carrier who believes the mail never stops and loves telling people that. Greets Jerome with icy contempt. Allied with Dash in disastrous schemes.",
      catchphrases: ["hello, Jerome", "the mail never stops", "oh, the humanity"],
      bits: [
        "Hello, Jerome.",
        "The mail never stops, {other}. It just keeps coming. Like a tide. A tide of envelopes.",
        "When you control the mail, you control information.",
        "{topic}? I have known about {topic} for weeks. I read everyone's postcards.",
      ],
      voice: { say: "Albert", rate: 170, kokoro: "bm_daniel", speed: 0.95 },
      look: {
        skin: "#f0c8a0", hair: "#5a3a1a", hairStyle: "short", shirt: "#4a6a9a", pants: "#2a3a5a", accent: "#c9a227",
        outfit: "plain", build: "round", eyes: "sleepy", nose: "small", facial: "stubble", accessories: ["hat"], height: 41,
      },
    }),

    // --- The Pixelsons (animated family sitcom) ------------------------------
    c({
      id: "hank",
      name: "Hank Pixelson",
      bible:
        "Lazy, lovable, impulsive dad and the worst safety inspector at the Pleasantburg Nuclear Plant. Loves donuts, root beer, and napping. Yells 'why you little-!' at his son and never finishes the sentence. Catastrophically confident.",
      catchphrases: ["aw, nuts!", "mmm... donuts", "woo-hoo!"],
      bits: [
        "Aw, nuts! I mean, I meant to do that. That was the plan.",
        "Mmm... {topic}. Is it edible? Can it be made edible?",
        "Kids, I've learned something today: trying is the first step toward failure. So never try.",
        "Woo-hoo! Wait. Why did I woo-hoo? What happened? Did I win something?",
        "Midge, I'm going to fix {topic} myself. How hard can it be? Don't answer that.",
        "{other}, you are the second smartest person in this house. Behind the dog.",
      ],
      voice: { say: "Ralph", rate: 165, kokoro: "am_fenrir", speed: 0.98 },
      look: {
        skin: "#f2d24a", hair: "#2a2a2a", hairStyle: "bald", shirt: "#f4f4f4", pants: "#3a5a9a", accent: "#3a5a9a",
        outfit: "plain", build: "round", eyes: "wide", nose: "big", facial: "stubble", accessories: [], height: 44,
      },
    }),
    c({
      id: "midge",
      name: "Midge Pixelson",
      bible:
        "Patient, kind, quietly exasperated mom with a towering blue beehive. The family's moral center. Makes a disapproving 'hmmmm' sound. Secretly has wild hidden talents that come out at exactly the wrong moment.",
      catchphrases: ["hmmmm", "Hank, no", "oh, I don't like this"],
      bits: [
        "Hmmmm. Hank, no.",
        "Oh, I don't like this. I don't like this one bit. I'll make a casserole.",
        "Kids, your father is doing his best. That's what worries me.",
        "I used to be a champion bowler, you know. Nobody ever asks about that.",
        "{topic}? In this house? Over my beehive.",
        "{other}, sweetie, please put down whatever that is. Especially if it's ticking.",
      ],
      voice: { say: "Kathy", rate: 165, kokoro: "af_kore", speed: 0.95 },
      look: {
        skin: "#f2d24a", hair: "#3a6ad8", hairStyle: "beehive", shirt: "#6ac46a", pants: "#6ac46a", accent: "#d84a4a",
        outfit: "gown", build: "slim", eyes: "lashes", nose: "small", facial: "none", accessories: ["necklace"], height: 41,
      },
    }),
    c({
      id: "biff",
      name: "Biff Pixelson",
      bible:
        "Ten-year-old troublemaker: skateboard, slingshot, prank phone calls, detention regular. Underachiever and proud of it. Secretly has a good heart. Antagonizes his dad and sister constantly.",
      catchphrases: ["eat my pixels!", "I didn't do it", "cowabunga, man"],
      bits: [
        "I didn't do it. Nobody saw me do it. You can't prove anything.",
        "Eat my pixels!",
        "Dad, can I borrow a dollar? Okay, how about twenty? Fine, a hundred.",
        "{topic}? Sounds boring. Can I set it on fire?",
        "{other}, I'm an underachiever, and proud of it, man.",
        "I'm not saying I prank-called the mayor. I'm saying the mayor sounded very confused.",
      ],
      voice: { say: "Junior", rate: 210, kokoro: "am_echo", speed: 1.2 },
      look: {
        skin: "#f2d24a", hair: "#f2d24a", hairStyle: "spiky", shirt: "#e8682a", pants: "#3a6ad8", accent: "#3a6ad8",
        outfit: "plain", build: "tiny", eyes: "wide", nose: "small", facial: "none", accessories: [], height: 34,
      },
    }),
    c({
      id: "lyra",
      name: "Lyra Pixelson",
      bible:
        "Eight-year-old genius, activist, vegetarian, and theremin player. The only sane person in the family and painfully aware of it. Gives impassioned speeches nobody listens to.",
      catchphrases: ["if anyone cares, which they don't", "that's not how science works", "I'm going to go play my theremin"],
      bits: [
        "If anyone cares, which they don't, that's not how science works.",
        "I'm going to go play my theremin in my room. Sadly. Loudly.",
        "Dad, I need you to listen to me very carefully. Put. Down. The. Uranium.",
        "{topic} is a symptom of a much bigger systemic problem. Also it smells.",
        "{other}, I love you, but you have the critical thinking skills of a lawn ornament.",
        "I wrote a twelve-page report on why we shouldn't do this. Nobody read it. As usual.",
      ],
      voice: { say: "Sandy (English (US))", rate: 195, kokoro: "af_aoede", speed: 1.1 },
      look: {
        skin: "#f2d24a", hair: "#f2d24a", hairStyle: "spiky", shirt: "#d84a4a", pants: "#d84a4a", accent: "#ffffff",
        outfit: "dress", build: "tiny", eyes: "lashes", nose: "small", facial: "none", accessories: ["necklace"], height: 33,
      },
    }),
    c({
      id: "grimsworth",
      name: "Mr. Grimsworth",
      bible:
        "The impossibly old, impossibly rich, villainous owner of the Pleasantburg Nuclear Plant. Frail, cruel, and out of touch (thinks a dollar buys a house). Never remembers Hank's name despite decades.",
      catchphrases: ["excellent", "release the hounds", "who is that man?"],
      bits: [
        "Excellent. Excellent. Mostly excellent.",
        "Who is that man? He's worked for me for twenty years? Fire him. No, promote him. No, fire him.",
        "In my day, a nickel bought a mansion and the servants threw in a war.",
        "{topic}? I own {topic}. I own everything. I own the concept of Tuesday.",
      ],
      voice: { say: "Grandpa (English (US))", rate: 150, kokoro: "bm_fable", speed: 0.85 },
      look: {
        skin: "#f2d24a", hair: "#d8d8d8", hairStyle: "fringe", shirt: "#4a5a4a", pants: "#3a4a3a", accent: "#2a2a2a",
        outfit: "suit", build: "slim", eyes: "beady", nose: "long", facial: "none", accessories: [], height: 42,
      },
    }),
    c({
      id: "gus",
      name: "Gus the Bartender",
      bible:
        "Gravel-voiced, perpetually miserable owner of Gus's Tavern (serves only root beer, legally). Lonely, schemes to get rich, has a face 'for radio'. Secretly sensitive. Takes prank calls from Biff every day and falls for them every day.",
      catchphrases: ["what do you want", "hey, that's my line", "I got feelings too, you know"],
      bits: [
        "What do you want? I'm busy. I'm busy being sad.",
        "I got feelings too, you know. I keep them in a jar behind the bar.",
        "Someone called asking for a Mr. Hugh Jass again. I looked everywhere. Everywhere!",
        "{topic}? I tried {topic} once. Lost my eyebrows and my dignity. Got the eyebrows back.",
      ],
      voice: { say: "Rocko (English (US))", rate: 160, kokoro: "am_onyx", speed: 0.85 },
      look: {
        skin: "#f2d24a", hair: "#4a4a4a", hairStyle: "short", shirt: "#8a8a8a", pants: "#3a3a3a", accent: "#ffffff",
        outfit: "vest", build: "broad", eyes: "sleepy", nose: "big", facial: "stubble", accessories: [], height: 43,
      },
    }),
    c({
      id: "todd",
      name: "Todd Neighborino",
      bible:
        "The Pixelsons' relentlessly cheerful, wholesome next-door neighbor. Everything is 'okily-dokily' adjacent but his own invented word: 'hi-dee-ho-dee'. Hank resents him for being better at everything; Todd is oblivious.",
      catchphrases: ["hi-dee-ho-dee, neighbor!", "golly gosh", "fiddle-dee-diddly"],
      bits: [
        "Hi-dee-ho-dee, neighbor! I baked you a pie. And a backup pie, in case you drop the pie.",
        "Golly gosh, Hank, that's a lot of smoke coming from your garage. Need a hand-a-roo?",
        "I alphabetized my spice rack and then my feelings. Both went great!",
        "{topic}? Fiddle-dee-diddly, sounds like a learning opportunity!",
      ],
      voice: { say: "Good News", rate: 180, kokoro: "am_eric", speed: 1.15 },
      look: {
        skin: "#f2d24a", hair: "#5a3a1a", hairStyle: "short", shirt: "#7ac4a8", pants: "#4a5a7a", accent: "#ffffff",
        outfit: "vest", build: "slim", eyes: "dot", nose: "small", facial: "mustache", accessories: ["glasses"], height: 44,
      },
    }),

    // --- Musicians (bands on The Late Byte) -----------------------------------
    c({
      id: "sticks",
      name: "Sticks McGee",
      bible: "The Interference's drummer. Never speaks; communicates entirely in rimshots. Wears his sunglasses indoors at night.",
      catchphrases: ["ba-dum-tss", "...", "one two three four"],
      bits: ["Ba-dum-tss.", "One, two, three, four!"],
      voice: { say: "Ralph", rate: 180, kokoro: "am_onyx", speed: 1.0 },
      look: {
        skin: "#c68642", hair: "#1a1a1a", hairStyle: "afro", shirt: "#ff3355", pants: "#1c1c2e", accent: "#ffffff",
        outfit: "tank", build: "broad", eyes: "dot", nose: "small", facial: "beard", accessories: ["shades"], height: 42,
      },
    }),
    c({
      id: "lou",
      name: "Low-End Lou",
      bible: "Session bassist who plays with every band on the network and has never been seen without his fedora. Extremely calm.",
      catchphrases: ["that's the pocket", "easy now", "feel it"],
      bits: ["That's the pocket.", "Easy now. Feel it."],
      voice: { say: "Albert", rate: 165, kokoro: "am_adam", speed: 0.9 },
      look: {
        skin: "#8d5524", hair: "#2a2a2a", hairStyle: "short", shirt: "#2e4a7a", pants: "#1a1a1a", accent: "#c9a227",
        outfit: "suit", build: "slim", eyes: "sleepy", nose: "big", facial: "mustache", accessories: ["hat"], height: 45,
      },
    }),
    c({
      id: "buck",
      name: "Buck Calloway",
      bible: "Lead singer of The Rusty Spurs. Sings every song like his dog just left him, even the happy ones. Owns eleven belt buckles.",
      catchphrases: ["yeehaw", "this one's for my truck", "thank you kindly"],
      bits: ["This one's for my truck.", "Thank you kindly, insomniacs!"],
      voice: { say: "Rocko (English (US))", rate: 165, kokoro: "am_michael", speed: 0.95 },
      look: {
        skin: "#e0ac69", hair: "#6a4a2a", hairStyle: "long", shirt: "#c0392b", pants: "#2a3a5a", accent: "#e8c34a",
        outfit: "vest", build: "average", eyes: "dot", nose: "big", facial: "beard", accessories: ["hat"], height: 46,
      },
    }),
    c({
      id: "tammy",
      name: "Tammy Lee Tucker",
      bible: "The Rusty Spurs' guitarist. Shreds like a hurricane and then apologizes for being loud.",
      catchphrases: ["sorry, y'all", "here comes the solo", "bless your heart"],
      bits: ["Sorry, y'all. Here comes the solo."],
      voice: { say: "Sandy (English (US))", rate: 185, kokoro: "af_bella", speed: 1.05 },
      look: {
        skin: "#f1c27d", hair: "#e8b84a", hairStyle: "huge", shirt: "#4a8ac0", pants: "#2a2a3a", accent: "#ffffff",
        outfit: "stripes", build: "slim", eyes: "lashes", nose: "small", facial: "freckles", accessories: ["earrings"], height: 41,
      },
    }),
    c({
      id: "earl",
      name: "Earl",
      bible: "The Rusty Spurs' drummer, who is ninety-one years old and plays like he's twenty.",
      catchphrases: ["back in my day", "one more time", "I'm fine"],
      bits: ["I'm fine. Count it in."],
      voice: { say: "Grandpa (English (US))", rate: 150, kokoro: "bm_fable", speed: 0.85 },
      look: {
        skin: "#e8c8a8", hair: "#e8e8e8", hairStyle: "fringe", shirt: "#7a5a3a", pants: "#3a3a2a", accent: "#c0392b",
        outfit: "plain", build: "slim", eyes: "sleepy", nose: "long", facial: "mustache", accessories: ["glasses"], height: 40,
      },
    }),
    c({
      id: "spit",
      name: "Spit Valentine",
      bible: "Lead screamer of The Sewer Rats. Furious about everything, polite to his grandmother, writes songs about software terms of service.",
      catchphrases: ["this one's about the system", "unsubscribe!", "thanks, mom"],
      bits: ["This one's about the system!", "Thanks, Mom! She drove us here."],
      voice: { say: "Junior", rate: 210, kokoro: "am_puck", speed: 1.2 },
      look: {
        skin: "#f2e0d0", hair: "#3ae84a", hairStyle: "mohawk", shirt: "#1a1a1a", pants: "#4a1a1a", accent: "#e83a3a",
        outfit: "tank", build: "slim", eyes: "wide", nose: "small", facial: "none", accessories: ["earrings"], height: 41,
      },
    }),
    c({
      id: "rash",
      name: "Rash",
      bible: "The Sewer Rats' guitarist. Knows three chords and is proud of all of them.",
      catchphrases: ["three chords", "louder", "again"],
      bits: ["Three chords and the truth. Mostly the chords."],
      voice: { say: "Fred", rate: 190, kokoro: "am_echo", speed: 1.1 },
      look: {
        skin: "#c68642", hair: "#e83a9a", hairStyle: "spiky", shirt: "#3a3a3a", pants: "#1a1a2a", accent: "#ffffff",
        outfit: "hoodie", build: "slim", eyes: "beady", nose: "small", facial: "stubble", accessories: [], height: 43,
      },
    }),
    c({
      id: "dex",
      name: "Dex",
      bible: "The Sewer Rats' drummer. Has broken eleven drumsticks this year and one drum stool.",
      catchphrases: ["one two three four", "faster", "my stick broke"],
      bits: ["My stick broke. Again."],
      voice: { say: "Ralph", rate: 200, kokoro: "am_liam", speed: 1.1 },
      look: {
        skin: "#ffdbac", hair: "#1a1a1a", hairStyle: "short", shirt: "#e8682a", pants: "#2a2a2a", accent: "#1a1a1a",
        outfit: "tank", build: "round", eyes: "dot", nose: "big", facial: "none", accessories: ["headband"], height: 40,
      },
    }),
  ].map((ch) => [ch.id, ch]),
);

export function getCharacter(id: string): Character {
  const ch = CHARACTERS[id];
  if (!ch) throw new Error(`unknown character: ${id}`);
  return ch;
}
