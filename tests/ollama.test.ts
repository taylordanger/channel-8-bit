import { describe, expect, it } from "vitest";
import { checkNames, LocalFactChecker, namesIn } from "../src/server/factcheck.js";
import { compactSchema, expandCompact, OllamaClient, OllamaWriter, prepareCompact, type CompactScript, type Fetcher } from "../src/server/writers/ollama.js";
import { loadConfig } from "../src/server/config.js";
import { beat, script, soapBrief } from "./helpers.js";

/** What the local model replies with: the compact format, names where ids belong and all. */
const goodScript = {
  title: "The Will",
  summary: "Victoria confronts the family about the will.",
  lines: [
    ["Victoria", "smug", "none", "How quaint."],
    ["Dante Sterling", "angry", "none", "I'm not like you, Mother."],
    ["lola", "nervous", "none", "Darling, please."],
    ["Marcus", "sad", "none", "I don't remember."],
    ["victoria", "smug", "none", "We'll see about that."],
    ["dante", "angry", "walk_off", "Leave her out of this."],
    ["lola", "smug", "none", "Funny you should ask."],
    ["marcus", "surprised", "none", "Something isn't right here."],
    ["victoria", "angry", "none", "Nothing has been right since the yacht."],
    ["lola", "smug", "none", "And whose fault was the yacht?"],
  ],
  remember: "Dante stormed out over the will.",
  feelings: [["Dante", "victoria", -40]],
  moods: [["dante", "furious", "accused of forging the will"]],
  storyState: "The will is missing and Dante is the prime suspect.",
};


/** Fake Ollama server: records requests, replies with the queued bodies. */
function fakeOllama(...replies: unknown[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : {} });
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "llama3.1:8b" }] });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return Response.json({ message: { content: typeof next === "string" ? next : JSON.stringify(next) } });
  };
  return { fetcher, calls };
}

describe("local writer (Ollama)", () => {
  it("defaults to the local writer when there's no API key", () => {
    expect(loadConfig({}).writer).toBe("local");
    expect(loadConfig({ ANTHROPIC_API_KEY: "x" }).writer).toBe("claude");
    expect(loadConfig({ WRITER: "improv" }).writer).toBe("improv");
    expect(loadConfig({ OLLAMA_MODEL: "qwen3:4b" }).ollama.model).toBe("qwen3:4b");
  });

  it("asks for schema-constrained JSON, maps names to ids, and caps segment length", async () => {
    const { fetcher, calls } = fakeOllama(goodScript);
    const w = new OllamaWriter(new OllamaClient("http://ollama", "llama3.1:8b", fetcher), "Test");
    const out = await w.write(soapBrief({ targetSeconds: 150 }));
    expect(out.writer).toBe("ollama:llama3.1:8b");
    expect(out.script.beats.map((b) => b.speaker)).toEqual(["victoria", "dante", "lola", "marcus", "victoria", "dante", "lola", "marcus", "victoria", "lola"]);
    const req = calls[0].body as { format: { type: string }; think: boolean; messages: { content: string }[] };
    expect(req.format.type).toBe("object");
    expect(req.think).toBe(false);
    expect(req.messages[1].content).toContain("about 60 seconds");
    // The grammar only lets the cast speak and forces a real number of lines.
    const lines = (req.format as unknown as { properties: { lines: { minItems: number; items: { prefixItems: { enum?: string[] }[] } } } }).properties.lines;
    expect(lines.minItems).toBeGreaterThanOrEqual(6);
    expect(lines.items.prefixItems[0].enum).toEqual(["victoria", "dante", "lola", "marcus"]);
    // Expanded back to a full script.
    expect(out.script.beats[1]).toMatchObject({ speaker: "dante", line: "I'm not like you, Mother.", emotion: "angry", target: "victoria", laugh: false });
    expect(out.script.beats[5].action).toBe("walk_off");
    expect(out.script.relationshipChanges).toEqual([{ from: "dante", to: "victoria", delta: -25, reason: "Victoria confronts the family about the will." }]);
    expect(out.script.moodChanges[0]).toMatchObject({ character: "dante", mood: "furious" });
    expect(out.script.memories[0]).toMatchObject({ text: "Dante stormed out over the will." });
    expect(out.script.storyState).toMatch(/prime suspect/);
  });

  it("retries once on malformed output, then gives up so the improv troupe can cover", async () => {
    const retry = fakeOllama("not json", goodScript);
    await expect(new OllamaWriter(new OllamaClient("http://o", "m", retry.fetcher), "T").write(soapBrief())).resolves.toBeTruthy();
    const broken = fakeOllama("nope", { title: 3 });
    await expect(new OllamaWriter(new OllamaClient("http://o", "m", broken.fetcher), "T").write(soapBrief())).rejects.toThrow(/schema|JSON/);
  });

  it("fails fast without retrying when Ollama isn't running", async () => {
    const down = fakeOllama(new TypeError("fetch failed"), goodScript);
    await expect(new OllamaWriter(new OllamaClient("http://o", "m", down.fetcher), "T").write(soapBrief())).rejects.toThrow(/fetch failed/);
    expect(down.calls).toHaveLength(1);
  });

  it("cools down after a timeout so the improv troupe keeps the air", async () => {
    let t = 0;
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const slow = fakeOllama(timeout, goodScript, goodScript);
    const w = new OllamaWriter(new OllamaClient("http://o", "m", slow.fetcher), "T", () => t, 60_000);
    await expect(w.write(soapBrief())).rejects.toThrow(/timed out/);
    await expect(w.write(soapBrief())).rejects.toThrow(/cooling down/);
    expect(slow.calls).toHaveLength(1);
    t = 61_000;
    await expect(w.write(soapBrief())).resolves.toBeTruthy();
  });

  it("checks availability against pulled models", async () => {
    const { fetcher } = fakeOllama();
    expect(await new OllamaClient("http://o", "llama3.1:8b", fetcher).available()).toBe(true);
    expect(await new OllamaClient("http://o", "mistral", fetcher).available()).toBe(false);
  });

  it("tames the small models' stage actions", async () => {
    const { tameActions } = await import("../src/server/writers/ollama.js");
    const t = tameActions(
      script([
        beat("rex", "a", "walk_off"),
        beat("rex", "b", "enter"),
        beat("rex", "c", "walk_off"),
        beat("deedee", "d", "enter"),
        beat("deedee", "e", "stand"),
        beat("deedee", "f", "stand"),
      ]),
    );
    expect(t.beats.map((b) => b.action)).toEqual(["walk_off", "enter", "none", "none", "stand", "none"]);
    const laughs = tameActions(script(Array.from({ length: 8 }, (_, i) => ({ ...beat("rex", `l${i}`), laugh: true }))));
    expect(laughs.beats.map((b) => b.laugh)).toEqual([true, false, true, false, true, false, true, false]);
  });

  it("is much shorter than the full format, with laughs only for laugh-track shows", () => {
    const soap = compactSchema(["a", "b"], 6, 10, { laughTrack: false, serialized: true });
    const sitcom = compactSchema(["a", "b"], 6, 10, { laughTrack: true, serialized: false });
    expect(soap.safeParse({ ...goodScript, lines: Array(6).fill(["a", "happy", "none", "hi"]), feelings: [], moods: [] }).success).toBe(true);
    const laughLines = Array(6).fill(["a", "happy", "none", "hi", true]);
    expect(sitcom.safeParse({ ...goodScript, lines: laughLines, feelings: [], moods: [], storyState: undefined }).success).toBe(true);
    expect("storyState" in sitcom.shape).toBe(false);
    const full = expandCompact({ title: "t", summary: "s", lines: laughLines, remember: "", feelings: [], moods: [] } as CompactScript);
    expect(full.beats[0]).toMatchObject({ laugh: true, target: "audience" }); // nobody else spoke
    expect(full.memories).toEqual([]);
  });

  it("maps names to ids in lines, feelings and moods before validating", () => {
    const fixed = prepareCompact({ lines: [["Lola", "happy", "none", "x"]], feelings: [["Dante", "Victoria Sterling", 5]], moods: [["Marcus", "anxious", "r"]] }, ["victoria", "dante", "lola", "marcus"]) as CompactScript;
    expect(fixed.lines[0][0]).toBe("lola");
    expect(fixed.feelings[0].slice(0, 2)).toEqual(["dante", "victoria"]);
    expect(fixed.moods[0][0]).toBe("marcus");
  });
});

describe("name check and local fact-check", () => {
  const source = { url: "u", title: "Council member Dana Reyes backs goat", site: "Example", description: "", publishedAt: "", text: "Dana Reyes said the goat, Clover, won." };

  it("finds multi-word names", () => {
    expect(namesIn("I hear Dana Reyes and Mayor Bob Fishbone disagree.")).toEqual(["Dana Reyes", "Mayor Bob Fishbone"]);
  });

  it("cuts lines naming people who aren't in the article or the network's world", () => {
    const r = checkNames(
      script([
        beat("victoria", "Dana Reyes has taste."),
        beat("dante", "Even Rex Volta would agree."),
        beat("lola", "Senator Jim Bogus endorsed it too."),
        beat("marcus", "I don't remember Clover."),
        beat("victoria", "How quaint."),
      ]),
      source,
      ["Rex Volta"],
    );
    expect(r.script.beats).toHaveLength(4);
    expect(r.notes[0].reason).toMatch(/Jim Bogus/);
  });

  it("the local checker applies verdicts and reports failures as rejections", async () => {
    const ok = fakeOllama({ lines: [{ index: 0, kind: "unsupported", claim: "x", rewrite: "" }] });
    const r = await new LocalFactChecker(new OllamaClient("http://o", "m", ok.fetcher)).check(
      script([beat("lola", "made up"), beat("victoria", "a"), beat("dante", "b"), beat("marcus", "c"), beat("lola", "d")]),
      source,
    );
    expect(r.script.beats).toHaveLength(4);
    const bad = fakeOllama("garbage");
    const r2 = await new LocalFactChecker(new OllamaClient("http://o", "m", bad.fetcher)).check(script([beat("lola", "a")]), source);
    expect(r2.rejected).toMatch(/local fact-checker failed/);
  });

  it("isn't fooled by sentence breaks or the network's own names", async () => {
    const { namesIn, checkNumbers } = await import("../src/server/factcheck.js");
    expect(namesIn("Fine. Show of hands, Lance. Don't look at me.")).toEqual([]);
    expect(namesIn("I met Dana Reyes today.")).toEqual(["Dana Reyes"]);
    const src = { url: "u", title: "Raccoon visits church", site: "x", description: "", publishedAt: "", text: "A raccoon visited a church." };
    const r = checkNumbers(script([beat("lance", "Welcome to The 8-Bit Report."), beat("paige", "a"), beat("lance", "b"), beat("paige", "c"), beat("lance", "d"), beat("paige", "e")]), src, ["The 8-Bit Report"]);
    expect(r.notes).toEqual([]);
  });
});
