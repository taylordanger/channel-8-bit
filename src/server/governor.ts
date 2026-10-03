import type { Ledger } from "./ledger.js";

export interface GovernorDecision {
  /** Produce until the timeline reaches this far past now (0 = don't produce). */
  leadTargetMs: number;
  /** Air reruns instead of paying for new scripts. */
  rerunsOnly: boolean;
  reason: string;
}

/**
 * Decides how much to produce. Two rules from the post that are worth keeping:
 * nothing gets written if nobody is watching, and there's a hard daily budget.
 */
export class Governor {
  private viewers = 0;
  private lastViewerAt = -Infinity;

  constructor(
    private opts: { leadTargetMs: number; idleGraceMs: number; dailyBudgetUsd: number; ledger: Ledger },
  ) {}

  setViewers(count: number, now: number): void {
    if (count > 0 || this.viewers > 0) this.lastViewerAt = now;
    this.viewers = count;
  }

  get viewerCount(): number {
    return this.viewers;
  }

  spentToday(now: number): number {
    return this.opts.ledger.spentOn(this.opts.ledger.day(now));
  }

  decide(now: number): GovernorDecision {
    const watching = this.viewers > 0 || now - this.lastViewerAt < this.opts.idleGraceMs;
    if (!watching) return { leadTargetMs: 0, rerunsOnly: false, reason: "nobody watching" };
    const spent = this.spentToday(now);
    if (spent >= this.opts.dailyBudgetUsd) {
      return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: true, reason: `daily budget spent ($${spent.toFixed(2)})` };
    }
    return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: false, reason: "on air" };
  }
}
