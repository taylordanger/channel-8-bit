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
  private feeds = 0;
  private lastViewerAt = -Infinity;

  constructor(
    private opts: {
      leadTargetMs: number;
      idleGraceMs: number;
      dailyBudgetUsd: number;
      ledger: Ledger;
      /**
       * Hours (local, 0-23) when a restream with nobody on the website still gets fresh writing.
       * We can't see the Twitch/YouTube audience, so outside these hours it airs reruns.
       */
      feedFreshHours?: Set<number>;
      /** Hours when the station writes fresh scenes even with nobody watching (the advertised flagship). */
      alwaysOnHours?: Set<number>;
      timeZone?: string;
    },
  ) {}

  /** Restream capture pages connected (they keep the channel airing, not writing). */
  setFeeds(count: number): void {
    this.feeds = count;
  }

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
    // The advertised flagship gets written whether or not anyone's tuned in yet.
    const alwaysOn = !watching && this.inHours(this.opts.alwaysOnHours, now);
    if (alwaysOn) {
      const spent = this.spentToday(now);
      if (spent >= this.opts.dailyBudgetUsd) return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: true, reason: `daily budget spent ($${spent.toFixed(2)})` };
      return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: false, reason: "always-on hours" };
    }
    if (!watching && this.feeds === 0) return { leadTargetMs: 0, rerunsOnly: false, reason: "nobody watching" };
    if (!watching && !this.freshFeedHour(now)) {
      return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: true, reason: "restream only: reruns" };
    }
    const spent = this.spentToday(now);
    if (spent >= this.opts.dailyBudgetUsd) {
      return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: true, reason: `daily budget spent ($${spent.toFixed(2)})` };
    }
    return { leadTargetMs: this.opts.leadTargetMs, rerunsOnly: false, reason: watching ? "on air" : "restream premiere hours" };
  }

  private freshFeedHour(now: number): boolean {
    return this.inHours(this.opts.feedFreshHours, now);
  }

  private inHours(hours: Set<number> | undefined, now: number): boolean {
    if (!hours?.size) return false;
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: this.opts.timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
    return hours.has(h);
  }
}
