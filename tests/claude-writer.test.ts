import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ManualClock } from "../src/server/clock.js";
import { openDb } from "../src/server/db.js";
import { Ledger } from "../src/server/ledger.js";
import { ClaudeWriter, WriterRefusedError } from "../src/server/writers/claude.js";
import { getShow } from "../src/server/catalog/shows.js";
import { CHARACTERS } from "../src/server/catalog/characters.js";
import { beat, script, soapBrief } from "./helpers.js";

/** A stand-in for the SDK client that records requests and returns canned responses. */
function fakeClient(response: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (req: Record<string, unknown>) => {
        calls.push(req);
        return { usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...response };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const models = { standard: "claude-haiku-4-5", premium: "claude-sonnet-5-5" };
const good = script([beat("victoria", "a"), beat("dante", "b"), beat("lola", "c"), beat("marcus", "d")]);

describe("ClaudeWriter", () => {
  it("routes premium shows to the premium model with effort, and meters usage", async () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const { client, calls } = fakeClient({ stop_reason: "end_turn", parsed_output: good });
    const w = new ClaudeWriter({ networkName: "Test", models, ledger, clock: new ManualClock(0) }, client);
    const out = await w.write(soapBrief());
    expect(out.writer).toBe("claude-sonnet-5-5");
    const req = calls[0] as { model: string; system: { cache_control: unknown }[]; output_config: { effort?: string } };
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.output_config.effort).toBe("low");
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(ledger.spentOn("1970-01-01")).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6);
  });

  it("routes standard shows to Haiku without the effort parameter (Haiku rejects it)", async () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const { client, calls } = fakeClient({ stop_reason: "end_turn", parsed_output: good });
    const show = getShow("couch_coop");
    await new ClaudeWriter({ networkName: "Test", models, ledger, clock: new ManualClock(0) }, client).write(
      soapBrief({ show, cast: show.cast.map((id) => CHARACTERS[id]) }),
    );
    const req = calls[0] as { model: string; output_config: Record<string, unknown> };
    expect(req.model).toBe("claude-haiku-4-5");
    expect("effort" in req.output_config).toBe(false);
  });

  it("keeps the system prompt byte-identical across segments so it caches", async () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const { client, calls } = fakeClient({ stop_reason: "end_turn", parsed_output: good });
    const w = new ClaudeWriter({ networkName: "Test", models, ledger, clock: new ManualClock(0) }, client);
    await w.write(soapBrief({ topic: "one", storyState: "x" }));
    await w.write(soapBrief({ topic: "two", recentLines: ["y"] }));
    const sys = calls.map((c) => JSON.stringify((c as { system: unknown }).system));
    expect(sys[0]).toBe(sys[1]);
  });

  it("raises on refusal so the producer falls back", async () => {
    const ledger = new Ledger(openDb(":memory:"), "UTC");
    const { client } = fakeClient({ stop_reason: "refusal", parsed_output: null });
    const w = new ClaudeWriter({ networkName: "Test", models, ledger, clock: new ManualClock(0) }, client);
    await expect(w.write(soapBrief())).rejects.toBeInstanceOf(WriterRefusedError);
  });
});
