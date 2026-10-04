import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { getShow } from "../src/server/catalog/shows.js";
import { openDb } from "../src/server/db.js";
import { PollBox } from "../src/server/polls.js";
import { buildStation } from "../src/server/build.js";
import { ManualClock } from "../src/server/clock.js";
import { loadConfig } from "../src/server/config.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { userPrompt } from "../src/server/writers/prompt.js";

const HOT_SEAT = Date.UTC(2026, 9, 3, 13, 0); // 13:00 UTC slot

describe("polls", () => {
  const poll = (box: PollBox, id = "p1") =>
    box.open({ id, segmentId: "s", showId: "hot_seat", episode: "e", question: "Who won?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], opensAt: 1000, closesAt: 5000, weight: 1 });

  it("one vote per viewer, only while open, only for real options", () => {
    const box = new PollBox(openDb(":memory:"));
    poll(box);
    expect(box.vote("p1", "viewer-0001", "a", 2000)).toBe("ok");
    expect(box.vote("p1", "viewer-0001", "b", 2001)).toBe("already voted");
    expect(box.vote("p1", "viewer-0002", "zzz", 2002)).toBe("bad option");
    expect(box.vote("p1", "viewer-0003", "b", 6000)).toBe("closed");
    expect(box.vote("nope", "viewer-0004", "a", 2000)).toBe("unknown poll");
    expect(box.tally("p1")).toEqual({ a: 1, b: 0 });
    expect(box.active(3000).map((p) => p.id)).toEqual(["p1"]);
  });

  it("closes on time: most votes wins; nobody voting means the studio audience decides", () => {
    const box = new PollBox(openDb(":memory:"));
    poll(box, "p1");
    poll(box, "p2");
    box.vote("p1", "viewer-0001", "b", 2000);
    expect(box.closeDue(4000)).toEqual([]);
    const closed = box.closeDue(5000);
    expect(closed.find((p) => p.id === "p1")).toMatchObject({ winner: "b", studio: false });
    expect(closed.find((p) => p.id === "p2")?.studio).toBe(true);
    expect(box.closeDue(9000)).toEqual([]);
  });
});

describe("Hot Seat", () => {
  const station = () => {
    const clock = new ManualClock(HOT_SEAT + 60_000);
    const b = buildStation({ ...loadConfig({}), timeZone: "UTC", tts: "silent", writer: "improv" }, { clock, dbFile: ":memory:", tts: new SilentTTS(), writers: [new ImprovWriter(3)] });
    return { clock, b };
  };

  it("runs a game in order with three drafted contestants, polls on scored rounds, and crowns the vote leader", async () => {
    const { clock, b } = station();
    const show = getShow("hot_seat");
    const slot = slotAt(clock.now(), "UTC");
    const steps: string[] = [];
    let contestants: string[] = [];
    for (let i = 0; i < show.gameSteps!.length; i++) {
      const at = Math.max(b.timeline.tailEnd(), clock.now() + 1500);
      const p = await b.producer.produce(at, slot, { rerun: false });
      b.station.commit(p);
      const g = p.segment.game!;
      steps.push(g.step);
      contestants = g.contestants;
      expect(new Set(g.contestants).size).toBe(3);
      expect(p.segment.cast[0].id).toBe("chet");
      if (p.segment.poll) {
        // Viewers pile in for the second contestant every round.
        expect(b.polls.vote(p.segment.poll.id, `viewer-${i}-aaaa`, g.contestants[1], p.segment.startAt + 1000)).toBe("ok");
        clock.set(p.segment.poll.closesAt);
        b.station.closePolls();
      }
      clock.set(b.timeline.tailEnd() - 1000);
    }
    expect(steps).toEqual(show.gameSteps);
    const segs = b.timeline.range(0, Infinity).filter((s) => s.game);
    expect(segs[0].poll).toBeUndefined(); // introductions
    expect(segs.at(-1)!.poll).toBeUndefined(); // ceremony
    expect(segs.filter((s) => s.poll)).toHaveLength(4);
    const ceremony = segs.at(-1)!.game!;
    expect(ceremony.champion).toBe(contestants[1]);
    expect(ceremony.scores[contestants[1]]).toBe(5); // 3 rounds + the final counting double
    expect(b.states.mood(contestants[1], clock.now())?.mood).toBe("smug");
    expect(b.memory.latest(5).some((m) => m.text.includes("won the Golden Pixel"))).toBe(true);
  });

  it("holds the champion ceremony until the final's votes are in", async () => {
    const { clock, b } = station();
    b.governor.setViewers(1, clock.now());
    const show = getShow("hot_seat");
    const slot = slotAt(clock.now(), "UTC");
    // Play up to and including the final showdown, closing every poll except the final's.
    for (let i = 0; i < show.gameSteps!.length - 1; i++) {
      const p = await b.producer.produce(Math.max(b.timeline.tailEnd(), clock.now() + 1500), slot, { rerun: false });
      b.station.commit(p);
      if (p.segment.poll && i < show.gameSteps!.length - 2) {
        clock.set(p.segment.poll.closesAt);
        b.station.closePolls();
      }
    }
    const finalPoll = b.timeline.range(0, Infinity).at(-1)!.poll!;
    // Plenty queued: the station waits rather than writing the ceremony blind.
    clock.set(b.timeline.tailEnd() - 60_000);
    expect(await b.station.tick()).toBeNull();
    // Nearly out of air with the vote still open: a counting card, not the ceremony.
    clock.set(b.timeline.tailEnd() - 10_000);
    const card = await b.station.tick();
    expect(card?.segment.title).toContain("counting your votes");
    // Votes close; now the ceremony is written with the final counted.
    clock.set(finalPoll.closesAt);
    b.station.closePolls();
    const ceremony = await b.station.tick();
    expect(ceremony?.segment.game?.champion).toBeTruthy();
    const scores = ceremony!.segment.game!.scores;
    expect(Object.values(scores).reduce((a, n) => a + n, 0)).toBe(5); // 3 rounds + the final (double)
  });

  it("tells the writers the viewers' verdict", async () => {
    const { clock, b } = station();
    const slot = slotAt(clock.now(), "UTC");
    for (let i = 0; i < 2; i++) {
      const p = await b.producer.produce(Math.max(b.timeline.tailEnd(), clock.now() + 1500), slot, { rerun: false });
      b.station.commit(p);
      if (p.segment.poll) {
        clock.set(p.segment.poll.closesAt);
        b.station.closePolls();
      }
    }
    const brief = b.producer.brief(b.timeline.tailEnd(), slot, 60);
    const prompt = userPrompt(brief);
    expect(prompt).toContain("GAME: Chet Ryder hosts");
    expect(prompt).toMatch(/LATEST VERDICT: nobody at home voted, so the studio audience gave "Who won the lightning round\?"/);
    expect(prompt).toContain("The host must NOT pick a winner");
  });
});
