import { describe, expect, it } from "vitest";
import { openDb } from "../src/server/db.js";
import { GameResults } from "../src/server/episodes.js";
import { impactFeed, mailStatus, nextMailAiring } from "../src/server/impact.js";
import { MailBag, type Moderator } from "../src/server/mailbag.js";
import { PollBox } from "../src/server/polls.js";
import { DEFAULT_POLICY } from "../src/server/standards.js";

const allow: Moderator = { moderate: async () => ({ allow: true, reason: "fine" }) };
const TZ = "America/Los_Angeles";
// Saturday Oct 3 2026, 3pm Pacific: Couch Co-op (reads mail) is on until 5pm.
const threePm = Date.UTC(2026, 9, 3, 22, 0);

describe("your votes did this", () => {
  it("lists viewer verdicts, champions with the loser's booking, and answered mail - not studio picks", async () => {
    const db = openDb(":memory:");
    const polls = new PollBox(db);
    const mail = new MailBag(db, DEFAULT_POLICY, allow);
    const t = threePm;
    const opts = [{ id: "pip", label: "Pip" }, { id: "greg", label: "Greg" }];
    polls.open({ id: "p1", segmentId: "s1", showId: "hot_seat", episode: "ep1", question: "Best excuse", options: opts, opensAt: t, closesAt: t + 1000, weight: 1 });
    polls.open({ id: "p2", segmentId: "s2", showId: "hot_seat", episode: "ep2", question: "Worst haircut", options: opts, opensAt: t, closesAt: t + 1000, weight: 1 });
    polls.vote("p1", "viewer-1", "pip", t + 10);
    polls.vote("p1", "viewer-2", "pip", t + 20);
    polls.closeDue(t + 2000); // p2 had no votes: the studio audience decided
    const results = new GameResults(db);
    results.record("hot_seat", t + 3000, "pip", { pip: 2, greg: 0, kev: 1 }, "ep1");
    results.record("hot_seat", t + 4000, "greg", { pip: 0, greg: 1, kev: 0 }, "ep2"); // nobody voted in ep2
    const m = await mail.submit("Fan", "Greg, is it going to rain?", null, "1.1.1.1", t);
    if (typeof m === "string") throw new Error(m);
    mail.markAired(m.id, t + 5000, "late_byte");

    const feed = impactFeed(db, mail, t + 6000);
    expect(feed.map((i) => i.kind)).toEqual(["mail", "game", "vote"]);
    expect(feed[0].text).toBe("Fan's letter was answered on The Late Byte with Rex Volta.");
    expect(feed[1].text).toMatch(/^Your votes crowned Pip \S+ the Hot Seat champion\. Greg \S+ came last and has to face Rex \S+ on The Late Byte/);
    expect(feed[2].text).toBe('You voted Pip the winner of "Best excuse" on Hot Seat (2 votes).');
    expect(feed.some((i) => i.text.includes("Worst haircut"))).toBe(false);
  });
});

describe("where's my letter", () => {
  it("only answers about your own letters, with your place in line and when it can air", async () => {
    const db = openDb(":memory:");
    const mail = new MailBag(db, DEFAULT_POLICY, allow);
    const a = await mail.submit("A", "First letter here", "late_byte", "1.1.1.1", threePm);
    const b = await mail.submit("B", "Second letter here", "late_byte", "2.2.2.2", threePm + 1);
    if (typeof a === "string" || typeof b === "string") throw new Error("submit failed");
    expect(mail.mine([a.id, b.id], "2.2.2.2").map((m) => m.id)).toEqual([b.id]);
    const status = mailStatus(mail.mine([b.id], "2.2.2.2")[0], mail, threePm, TZ);
    expect(status).toMatch(/^1 letter ahead of yours for The Late Byte with Rex Volta \(on .*10:00/);
    expect(mailStatus(a, mail, threePm, TZ)).toMatch(/^You're next in the mailbag/);
  });

  it("finds the next show that reads mail, or the one on now", () => {
    expect(nextMailAiring(null, threePm, TZ)).toMatchObject({ showId: "couch_coop" });
    const lateByte = nextMailAiring("late_byte", threePm, TZ);
    expect(lateByte?.showId).toBe("late_byte");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric" }).format(new Date(lateByte!.startAt))).toBe("10 PM");
  });
});
