import { describe, expect, it } from "vitest";
import { cleanLine, deterministicStandards, DEFAULT_POLICY } from "../src/server/standards.js";
import { beat, script, soapBrief } from "./helpers.js";

const four = [
  beat("victoria", "You came back."),
  beat("dante", "I had no choice, Mother."),
  beat("lola", "Neither of you will like what I found."),
  beat("marcus", "Something isn't right here."),
];

describe("standards desk", () => {
  it("strips stage directions, emoji and speaker prefixes", () => {
    expect(cleanLine("*leans in* I know (whispering) everything [beat] 😈")).toBe("I know everything");
    expect(cleanLine("VICTORIA: How quaint.")).toBe("How quaint.");
  });

  it("passes a clean script untouched", () => {
    const r = deterministicStandards(script(four), soapBrief());
    expect(r.rejected).toBeUndefined();
    expect(r.script.beats).toHaveLength(4);
    expect(r.notes).toHaveLength(0);
  });

  it("cuts lines from characters who are not on set", () => {
    const r = deterministicStandards(script([...four, beat("rex", "Hello, insomniacs!")]), soapBrief());
    expect(r.script.beats.map((b) => b.speaker)).not.toContain("rex");
    expect(r.notes[0]).toMatchObject({ verdict: "cut" });
  });

  it("cuts repeats of recently aired lines, ignoring case and punctuation", () => {
    const r = deterministicStandards(script([...four, beat("lola", "darling please")]), soapBrief({ recentLines: ["Darling, PLEASE!"] }));
    expect(r.script.beats).toHaveLength(4);
  });

  it("cuts blocklisted lines", () => {
    expect(DEFAULT_POLICY.blocklist.length).toBeGreaterThan(0);
    const r = deterministicStandards(script([...four, beat("dante", "You should buy the stock today.")]), soapBrief());
    expect(r.script.beats).toHaveLength(4);
    expect(r.notes.some((n) => n.reason.startsWith("blocklisted"))).toBe(true);
  });

  it("marks a character who speaks after walking off as re-entering", () => {
    const r = deterministicStandards(
      script([beat("victoria", "Get out."), beat("dante", "Gladly.", "walk_off"), beat("lola", "Well."), beat("dante", "I forgot my keys.")]),
      soapBrief(),
    );
    expect(r.script.beats[3].action).toBe("enter");
  });

  it("trims overlong lines at a sentence boundary", () => {
    const long = "This is a sentence. ".repeat(20).trim();
    const r = deterministicStandards(script([...four, beat("lola", long)]), soapBrief());
    expect(r.script.beats[4].line.split(" ").length).toBeLessThanOrEqual(60);
    expect(r.script.beats[4].line.endsWith(".")).toBe(true);
  });

  it("rejects a script with too few airable lines", () => {
    const r = deterministicStandards(script(four.slice(0, 2)), soapBrief());
    expect(r.rejected).toMatch(/airable/);
  });

  it("sanitizes memories, relationship deltas and story state", () => {
    const r = deterministicStandards(
      script(four, {
        memories: [
          { about: ["victoria", "nobody"], text: "She lied.", importance: 7 },
          { about: ["ghost"], text: "x", importance: 0.5 },
        ],
        relationshipChanges: [
          { from: "lola", to: "victoria", delta: -90, reason: "betrayal" },
          { from: "lola", to: "lola", delta: 5, reason: "self-love" },
        ],
        storyState: "The will is forged.",
      }),
      soapBrief(),
    );
    expect(r.script.memories).toEqual([{ about: ["victoria"], text: "She lied.", importance: 1 }]);
    expect(r.script.relationshipChanges).toEqual([{ from: "lola", to: "victoria", delta: -25, reason: "betrayal" }]);
    expect(r.script.storyState).toBe("The will is forged.");
  });
});

describe("overused phrases", () => {
  it("finds clichés repeated across scenes, but not catchphrases, story nouns or one-offs", async () => {
    const { overusedPhrases } = await import("../src/server/standards.js");
    const scenes = [
      ["Don't play dumb with me, Lola.", "The anonymous letters were yours.", "My beautiful insomniacs, welcome!"],
      ["Don't play dumb, Marcus.", "I found the anonymous letters.", "My beautiful insomniacs!"],
      ["Oh, don't play dumb.", "Burn the anonymous letters.", "Hello, my beautiful insomniacs."],
      ["A yacht. A whole yacht."],
    ];
    const found = overusedPhrases(scenes, 3, 10, ["my beautiful insomniacs"]);
    expect(found).toContain("don't play dumb");
    expect(found.some((p) => p.includes("anonymous letters"))).toBe(false);
    expect(found.some((p) => p.includes("insomniacs"))).toBe(false);
    expect(found.some((p) => p.includes("yacht"))).toBe(false);
  });

  it("ignores everyday speech and trims only the sentences that use a banned phrase", async () => {
    const { overusedPhrases, dropOverused } = await import("../src/server/standards.js");
    const scenes = [["I don't know, what's going on?"], ["I don't know what's going on."], ["Honestly I don't know. What's going on?"]];
    expect(overusedPhrases(scenes)).toEqual([]);
    expect(dropOverused("Don't play dumb, Lola. I know about the yacht.", ["don't play dumb"])).toBe("I know about the yacht.");
    expect(dropOverused("Don't play dumb!", ["don't play dumb"])).toBe("");
    expect(dropOverused("Playing dumbbells is fine.", ["don't play dumb"])).toBe("Playing dumbbells is fine.");
  });
});

describe("quality checks from the show review", () => {
  const brief = async (over = {}) => {
    const { getShow } = await import("../src/server/catalog/shows.js");
    const { CHARACTERS } = await import("../src/server/catalog/characters.js");
    const show = getShow("late_byte");
    return { show, cast: show.cast.map((id) => CHARACTERS[id]), recentLines: [], ...over };
  };
  const scene = (lines: [string, string][]) => ({
    title: "t", summary: "s", memories: [], relationshipChanges: [], moodChanges: [], storyState: "",
    beats: lines.map(([speaker, line]) => ({ speaker, line, emotion: "neutral" as const, action: "none" as const, target: "audience", laugh: false })),
  });

  it("cuts stage directions written as dialogue", async () => {
    const { deterministicStandards } = await import("../src/server/standards.js");
    const r = deterministicStandards(scene([["rex", "enter, walking back into the set with a sheepish grin"], ["rex", "Enter, Dee Dee. You're late."], ["deedee", "Sure, Rex."], ["rex", "Walks are good for you, Dee Dee."], ["deedee", "Sure."], ["rex", "Fine."]]), await brief());
    expect(r.script.beats.map((b) => b.line)).toEqual(["Enter, Dee Dee. You're late.", "Sure, Rex.", "Walks are good for you, Dee Dee.", "Sure.", "Fine."]);
  });

  it("drops goodbyes in the middle of the show, keeps them at the end", async () => {
    const { deterministicStandards } = await import("../src/server/standards.js");
    const lines: [string, string][] = [["rex", "Great bit. That's all the time we have for tonight!"], ["deedee", "Sure, Rex."], ["rex", "One"], ["deedee", "Two"], ["rex", "Three"]];
    expect(deterministicStandards(scene(lines), await brief({ lastSegment: false })).script.beats[0].line).toBe("Great bit.");
    expect(deterministicStandards(scene(lines), await brief({ lastSegment: true })).script.beats[0].line).toMatch(/all the time we have/);
  });

  it("cuts a line that tells the same joke again", async () => {
    const { nearDuplicate } = await import("../src/server/standards.js");
    expect(nearDuplicate("Lenny and Dash have eaten the last good marble rye in the city.", "Seriously folks, Lenny and Dash have eaten the last good marble rye.")).toBe(true);
    expect(nearDuplicate("Lenny and Dash found the marble rye.", "I'm going to sulk about my jacket now.")).toBe(false);
  });

  it("cuts lines copied from the writers' examples", async () => {
    const { deterministicStandards } = await import("../src/server/standards.js");
    const r = deterministicStandards(
      scene([["rex", "My hair has a separate dressing room, pal. It has a separate agent."], ["deedee", "The band has a printer now. Hit it, boys."], ["rex", "A brand new joke about a lighthouse keeper."], ["deedee", "Sure, Rex."], ["rex", "One more line here."], ["deedee", "And another one."]]),
      await brief(),
    );
    expect(r.script.beats.map((b) => b.line)).toEqual(["A brand new joke about a lighthouse keeper.", "Sure, Rex.", "One more line here.", "And another one."]);
  });
});
