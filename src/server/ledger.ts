import type { DB } from "./db.js";

/** USD per million tokens [input, output]. Cache writes bill at 1.25x input, reads at 0.1x. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: string, u: TokenUsage): number {
  const [inP, outP] = PRICES[model] ?? [4, 20]; // unknown model: assume the expensive end
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return (u.input_tokens * inP + write * inP * 1.25 + read * inP * 0.1 + u.output_tokens * outP) / 1_000_000;
}

/** Every Claude call is metered here; the governor reads it to enforce the daily budget. */
export class Ledger {
  constructor(
    private db: DB,
    private timeZone: string,
  ) {}

  day(t: number): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: this.timeZone }).format(new Date(t));
  }

  record(at: number, model: string, purpose: string, u: TokenUsage): number {
    const usd = costUsd(model, u);
    this.db
      .prepare(
        `INSERT INTO usage (at, day, model, purpose, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        at,
        this.day(at),
        model,
        purpose,
        u.input_tokens,
        u.output_tokens,
        u.cache_read_input_tokens ?? 0,
        u.cache_creation_input_tokens ?? 0,
        usd,
      );
    return usd;
  }

  spentOn(day: string): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM usage WHERE day = ?").get(day) as { s: number };
    return row.s;
  }
}
