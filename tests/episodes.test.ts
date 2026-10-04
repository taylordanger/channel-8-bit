import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { getShow } from "../src/server/catalog/shows.js";
import { CHARACTERS } from "../src/server/catalog/characters.js";
import { openDb } from "../src/server/db.js";
import { EpisodeBook, GameResults, phaseAt, tidyBeats, tidyPlan, type EpisodePlan, type PlanRequest } from "../src/server/episodes.js";
import { MemoryBank } from "../src/server/memory.js";
import { Producer } from "../src/server/producer.js";
import { Timeline } from "../src/server/timeline.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import { episodeBlock } from "../src/server/writers/prompt.js";
import type { Writer, WriterBrief } from "../src/server/writers/script.js";

const TZ = "UTC";
const noon = Date.UTC(2026, 9, 3, 10, 30); // pixel_heights, live

const plan = (over: Partial<EpisodePlan> = {}): EpisodePlan => ({
  logline: "Victoria's will goes missing.",
  wants: [{ character: "victoria", want: "the will back" }],
  conflict: "The will is gone.",
  beats: ["A forged copy appears.", "The forger is in the room.", "The dog ate the original."],
  payoff: "Victoria wrote herself out of it.",
  openThread: "Who has the real copy?",
  secrets: [],
  reveal: "",
  ...over,
});

/** A writer that plans (and records what it was asked), then writes like the improv troupe. */
function planner(p: EpisodePlan | Error) {
  const asked: PlanRequest[] = [];
  const improv = new ImprovWriter(3);
  const w: Writer & { plan(r: PlanRequest): Promise<EpisodePlan> } = {
    name: "planner",
    write: (b) => improv.write(b),
    plan: async (r) => {
      asked.push(r);
      if (p instanceof Error) throw p;
      return p;
    },
  };
  return { w, asked };
}

function setup(writers: Writer[]) {
  const db = openDb(":memory:");
  const memory = new MemoryBank(db);
  const episodes = new EpisodeBook(db, memory);
  const results = new GameResults(db);
  const briefs: WriterBrief[] = [];
  const spy: Writer[] = writers.map((w) =>
    Object.assign(Object.create(Object.getPrototypeOf(w) as object) as Writer, w, {
      write: (b: WriterBrief) => (briefs.push(b), w.write(b)),
    }),
  );
  const producer = new Producer({ timeline: new Timeline(db), memory, tts: new SilentTTS(), writers: spy, timeZone: TZ, episodes, results });
  return { producer, episodes, results, memory, briefs };
}

describe("episode plans", () => {
  it("splits the airing into setup, three escalations and a payoff", () => {
    const slot = { startAt: 0, endAt: 100 };
    expect(phaseAt(plan(), slot, 0)).toMatchObject({ index: 0, label: "setup", job: "The will is gone." });
    expect(phaseAt(plan(), slot, 45)).toMatchObject({ index: 2, label: "escalation", job: "The forger is in the room." });
    expect(phaseAt(plan(), slot, 99)).toMatchObject({ index: 4, label: "payoff", job: "Victoria wrote herself out of it." });
    expect(phaseAt(plan(), slot, 500).label).toBe("payoff"); // a scene spilling past the slot end
  });

  it("tidies model output: names to ids, exactly three beats, no secrets on episodic shows", () => {
    const req = { show: getShow("late_byte"), cast: ["rex", "deedee"] };
    const t = tidyPlan(plan({ wants: [{ character: CHARACTERS.rex.name, want: "ratings" }, { character: "nobody", want: "x" }], beats: ["one"], secrets: [{ holder: "rex", secret: "wig", knownBy: [] }], reveal: "wig" }), req);
    expect(t.wants).toEqual([{ character: "rex", want: "ratings" }]);
    expect(t.beats).toEqual(["one", "one", "one"]);
    expect(t.secrets).toEqual([]);
    expect(t.reveal).toBe("");
  });

  it("strips list padding a small model adds to the beats", () => {
    expect(
      tidyBeats(["&#x20;Three developments make things worse or weirder:&#x20;", "1. The meat is expired.", "2) The storm never comes.", "- Pip quits live on air."], "x"),
    ).toEqual(["The meat is expired.", "The storm never comes.", "Pip quits live on air."]);
  });

  it("plans once per airing and every scene follows it", async () => {
    const { w, asked } = planner(plan());
    const { producer, briefs } = setup([w, new ImprovWriter(1)]);
    const slot = slotAt(noon, TZ);
    await producer.produce(noon, slot, { rerun: false });
    await producer.produce(noon + 120_000, slot, { rerun: false });
    expect(asked).toHaveLength(1);
    expect(briefs).toHaveLength(2);
    expect(briefs[0].episode?.plan.logline).toBe("Victoria's will goes missing.");
    expect(briefs[0].episode?.phase.label).toBe(phaseAt(plan(), slot, noon).label);
  });

  it("carries the last episode's open thread and secrets into the next plan", async () => {
    const { w, asked } = planner(plan({ secrets: [{ holder: "victoria", secret: "she forged it", knownBy: [] }], reveal: "she forged it" }));
    const { producer } = setup([w, new ImprovWriter(1)]);
    const slot = slotAt(noon, TZ);
    await producer.produce(noon, slot, { rerun: false });
    const next = { ...slot, startAt: slot.startAt + 86_400_000, endAt: slot.endAt + 86_400_000 };
    await producer.produce(noon + 86_400_000, next, { rerun: false });
    expect(asked[1].previous?.openThread).toBe("Who has the real copy?");
    expect(asked[1].previous?.secrets[0].secret).toBe("she forged it");
  });

  it("falls back to a template plan, and lets a real planner try again later", async () => {
    const { w, asked } = planner(new Error("model down"));
    const { producer, briefs, episodes } = setup([w, new ImprovWriter(1)]);
    const slot = slotAt(noon, TZ);
    await producer.produce(noon, slot, { rerun: false });
    expect(briefs[0].episode?.plan.beats).toHaveLength(3);
    expect(episodes.get("pixel_heights", slot.startAt)).toBeUndefined();
    await producer.produce(noon + 60_000, slot, { rerun: false });
    expect(asked).toHaveLength(2);
  });

  it("a hurried scene (improv only) doesn't lock in a template plan for the episode", async () => {
    const { w, asked } = planner(plan());
    const { producer, briefs, episodes } = setup([w, new ImprovWriter(1)]);
    const slot = slotAt(noon, TZ);
    await producer.produce(noon, slot, { rerun: false, hurry: true });
    expect(briefs[0].episode?.plan.beats).toHaveLength(3); // the template covered it
    expect(episodes.get("pixel_heights", slot.startAt)).toBeUndefined();
    await producer.produce(noon + 60_000, slot, { rerun: false });
    expect(asked).toHaveLength(1);
    expect(episodes.get("pixel_heights", slot.startAt)?.plan.logline).toBe("Victoria's will goes missing.");
  });

  it("keeps the template plan on an improv-only station", async () => {
    const { producer, episodes } = setup([new ImprovWriter(1)]);
    const slot = slotAt(noon, TZ);
    await producer.produce(noon, slot, { rerun: false });
    expect(episodes.get("pixel_heights", slot.startAt)?.writer).toBe("improv");
  });

  it("hides later beats from the scene being written", () => {
    const p = plan();
    const text = episodeBlock({ plan: p, phase: phaseAt(p, { startAt: 0, endAt: 100 }, 25) }, (id) => id, false);
    expect(text).toContain("A forged copy appears.");
    expect(text).not.toContain("The dog ate the original.");
    expect(text).not.toContain("wrote herself out");
  });
});

describe("Hot Seat losers face the host", () => {
  it("books the last-place finisher as The Late Byte's guest, with the reason", () => {
    const { producer, results } = setup([new ImprovWriter(1)]);
    const lateByte = getShow("late_byte");
    const tenPm = Date.UTC(2026, 9, 3, 22, 0);
    const slot = { ...slotAt(tenPm, "America/Los_Angeles"), startAt: tenPm, endAt: tenPm + 7_200_000 };
    expect(lateByte.guestPool).toContain(producer.guestFor(lateByte, slot)?.id); // no game yet: usual booking
    results.record("hot_seat", tenPm - 5 * 60_000, "lenny", { lenny: 3, greg: 1, pip: 0 });
    const booked = producer.guestFor(lateByte, slot);
    expect(booked?.id).toBe("pip");
    expect(booked?.note).toMatch(/came last on Hot Seat/);
    // The next night, with no new game, it's back to the usual rotation.
    const tomorrow = { ...slot, startAt: tenPm + 86_400_000, endAt: tenPm + 86_400_000 + 7_200_000 };
    expect(lateByte.guestPool).toContain(producer.guestFor(lateByte, tomorrow)?.id);
  });
});
