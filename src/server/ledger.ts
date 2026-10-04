import type { DB } from "./db.js";

/** USD per million tokens [input, output]. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
/** Cache reads bill at 0.1x input, except where a model is cheaper. */
const CACHE_READ: Record<string, number> = { "claude-opus-5-5": 0.05 };
/** Cache writes bill at 1.25x input for the 5-minute TTL and 2x for the 1-hour TTL. */
const WRITE_5M = 1.25;
const WRITE_1H = 2;

export class BudgetExceededError extends Error {}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  /** Cache writes split by TTL, when the API reports it. */
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

export function costUsd(model: string, u: TokenUsage): number {
  const [inP, outP] = PRICES[model] ?? [4, 20]; // unknown model: assume the expensive end
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const split = u.cache_creation;
  // Without a TTL breakdown, bill every write at the 1-hour rate: we only ask for 1-hour caching,
  // and overestimating spend is the safe direction for a budget.
  const w5 = split ? (split.ephemeral_5m_input_tokens ?? 0) : 0;
  const w1 = split ? (split.ephemeral_1h_input_tokens ?? 0) : write;
  const readRate = CACHE_READ[model] ?? 0.1;
  return (u.input_tokens * inP + (w5 * WRITE_5M + w1 * WRITE_1H) * inP + read * inP * readRate + u.output_tokens * outP) / 1_000_000;
}

/**
 * The most a call can cost: every prompt token written to the 1-hour cache and every allowed
 * output token used. Prompt size is estimated from characters (~3.5 per token, rounded up).
 */
export function worstCaseUsd(model: string, promptChars: number, maxTokens: number): number {
  const [inP, outP] = PRICES[model] ?? [4, 20];
  return (Math.ceil(promptChars / 3.5) * inP * WRITE_1H + maxTokens * outP) / 1_000_000;
}

/** Every Claude call is metered here; the governor reads it to enforce the daily budget. */
export class Ledger {
  constructor(
    private db: DB,
    private timeZone: string,
    /** Hard daily ceiling; `guard` refuses calls that could cross it. */
    private dailyBudgetUsd = Infinity,
  ) {}

  /**
   * Call before every paid request with its worst-case cost. Throws instead of letting a single
   * production (writer + standards + fact-check) run the day past the budget.
   */
  guard(at: number, worstUsd: number, what: string): void {
    const spent = this.spentOn(this.day(at));
    if (spent + worstUsd > this.dailyBudgetUsd) {
      throw new BudgetExceededError(
        `daily budget: ${what} could cost up to $${worstUsd.toFixed(3)}; $${(this.dailyBudgetUsd - spent).toFixed(3)} left today`,
      );
    }
  }

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
