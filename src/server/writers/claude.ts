import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Clock } from "../clock.js";
import type { Ledger } from "../ledger.js";
import { systemPrompt, userPrompt } from "./prompt.js";
import { ScriptSchema, type Writer, type WriterBrief, type WriterResult } from "./script.js";

/** Haiku 4.5 rejects `effort`; newer models accept it. */
const supportsEffort = (model: string) => !model.startsWith("claude-haiku");

export class WriterRefusedError extends Error {}

/** Writes segments with Claude using structured outputs, so every script parses. */
export class ClaudeWriter implements Writer {
  readonly name = "claude";
  private client: Anthropic;

  constructor(
    private opts: { networkName: string; models: { standard: string; premium: string }; ledger: Ledger; clock: Clock },
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async write(brief: WriterBrief): Promise<WriterResult> {
    const model = brief.show.tier === "premium" ? this.opts.models.premium : this.opts.models.standard;
    const response = await this.client.messages.parse({
      model,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: systemPrompt(this.opts.networkName, brief.show),
          // The bible is identical for every segment of a show; cache it for the hour.
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [{ role: "user", content: userPrompt(brief) }],
      output_config: {
        format: zodOutputFormat(ScriptSchema),
        ...(supportsEffort(model) ? { effort: "low" as const } : {}),
      },
    });

    this.opts.ledger.record(this.opts.clock.now(), model, `script:${brief.show.id}`, response.usage);

    if (response.stop_reason === "refusal") throw new WriterRefusedError(`${model} declined to write ${brief.show.id}`);
    if (response.stop_reason === "max_tokens") throw new Error(`${model} ran out of tokens writing ${brief.show.id}`);
    if (!response.parsed_output) throw new Error(`${model} returned an unparseable script`);
    return { script: response.parsed_output, writer: model };
  }
}
