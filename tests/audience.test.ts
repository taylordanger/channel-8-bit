import { describe, expect, it } from "vitest";
import { AudienceLog } from "../src/server/audience.js";
import { openDb } from "../src/server/db.js";

const H = 3_600_000;

describe("audience log", () => {
  it("measures playback, watch time, returns, leaves by show and clip referrals - not this Mac", () => {
    const db = openDb(":memory:");
    const log = new AudienceLog(db);
    const day = 100 * H;
    // A regular from yesterday.
    const old = log.open(day - 30 * H, false);
    log.identify(old, "viewer-regular", null);
    // Today: the regular comes back and watches 10 minutes of The Late Byte.
    const a = log.open(day, false);
    log.identify(a, "viewer-regular", null);
    log.tunedIn(a, day + 1000);
    log.close(a, day + 1000 + 10 * 60_000, "late_byte");
    // A newcomer from clip 7 bails after 30 seconds of Hot Seat.
    const b = log.open(day + H, false);
    log.identify(b, "viewer-newbie1", "clip-7");
    log.tunedIn(b, day + H);
    log.close(b, day + H + 30_000, "hot_seat");
    // Someone who never pressed play, and the operator on this Mac.
    log.close(log.open(day + 2 * H, false), day + 2 * H + 5000, "late_byte");
    const mine = log.open(day + 2 * H, true);
    log.tunedIn(mine, day + 2 * H);
    db.prepare("INSERT INTO votes (poll_id, voter, option_id, at) VALUES ('p', 'v', 'a', ?)").run(day + H);

    const r = log.report(day + 3 * H);
    expect(r).toMatchObject({ visits: 3, viewers: 2, startedPlayback: 2, returning: 1, votesPerViewer: 0.5 });
    expect(r.medianWatchMin).toBeCloseTo(5.3, 1);
    expect(r.leftDuring).toEqual(
      expect.arrayContaining([
        { show: expect.stringMatching(/Hot Seat/), sessions: 1, quickLeaves: 1, medianMin: 0.5 },
        { show: expect.stringMatching(/Late Byte/), sessions: 1, quickLeaves: 0, medianMin: 10 },
      ]),
    );
    expect(r.clipReferrals).toEqual([{ clipId: 7, visits: 1 }]);
  });

  it("ignores junk viewer ids and refs", () => {
    const db = openDb(":memory:");
    const log = new AudienceLog(db);
    const s = log.open(0, false);
    log.identify(s, "<script>", "x");
    log.identify(s, "viewer-ok-123", "../../etc");
    expect(db.prepare("SELECT viewer, ref FROM viewer_sessions").get()).toEqual({ viewer: "viewer-ok-123", ref: null });
  });
});
