import { describe, expect, it } from "vitest";
import { checkNames, LocalFactChecker, namesIn } from "../src/server/factcheck.js";
import { normalizeSpeakers, OllamaClient, OllamaWriter, type Fetcher } from "../src/server/writers/ollama.js";
import { loadConfig } from "../src/server/config.js";
import { beat, script, soapBrief } from "./helpers.js";

const goodScript = script([
  beat("Victoria", "How quaint."),
  beat("Dante Sterling", "I'm not like you, Mother."),
  beat("lola", "Darling, please."),
  beat("Marcus", "I don't remember."),
  beat("victoria", "We'll see about that."),
  beat("dante", "Leave her out of this."),
  beat("lola", "Funny you should ask."),
  beat("marcus", "Something isn't right here."),
]);

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
    expect(out.script.beats.map((b) => b.speaker)).toEqual(["victoria", "dante", "lola", "marcus", "victoria", "dante", "lola", "marcus"]);
    const req = calls[0].body as { format: { type: string }; think: boolean; messages: { content: string }[] };
    expect(req.format.type).toBe("object");
    expect(req.think).toBe(false);
    expect(req.messages[1].content).toContain("about 60 seconds");
    // The grammar only lets the cast speak and forces a real number of lines.
    const beats = (req.format as unknown as { properties: { beats: { minItems: number; items: { properties: { speaker: { enum: string[] } } } } } }).properties.beats;
    expect(beats.minItems).toBeGreaterThanOrEqual(6);
    expect(beats.items.properties.speaker.enum).toEqual(["victoria", "dante", "lola", "marcus"]);
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
  });

  it("normalizes targets and memory ids too", () => {
    const s = normalizeSpeakers(
      script([{ ...beat("Lola", "x"), target: "Victoria Sterling" }], { memories: [{ about: ["Dante"], text: "y", importance: 0.5 }] }),
      ["victoria", "dante", "lola"],
    );
    expect(s.beats[0]).toMatchObject({ speaker: "lola", target: "victoria" });
    expect(s.memories[0].about).toEqual(["dante"]);
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
});
