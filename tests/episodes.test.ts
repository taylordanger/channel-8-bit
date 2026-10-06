import { describe, expect, it } from "vitest";
import { slotAt } from "../src/server/catalog/schedule.js";
import { getShow } from "../src/server/catalog/shows.js";
import { CHARACTERS } from "../src/server/catalog/characters.js";
import { openDb } from "../src/server/db.js";
import { EpisodeBook, GameResults, phaseAt, tidyBeats, tidyPlan, tidySeason, weekOf, type EpisodePlan, type PlanRequest, type SeasonPlan } from "../src/server/episodes.js";
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

  it("replaces a logline that just echoes the request", () => {
    const req = { show: getShow("cooking"), cast: ["remy", "pepper"] };
    expect(tidyPlan(plan({ logline: "Sunday 4:01 PM episode plan" }), req).logline).toBe("The will is gone.");
    expect(tidyPlan(plan(), req).logline).toBe("Victoria's will goes missing.");
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

  it("tells the writer what this episode already aired and which phrases are worn out", async () => {
    const { userPrompt } = await import("../src/server/writers/prompt.js");
    const { soapBrief } = await import("./helpers.js");
    const text = userPrompt({ ...soapBrief(), episodeSoFar: ["Victoria confronted Lola about the letters."], overused: ["don't play dumb"] });
    expect(text).toMatch(/ALREADY ON AIR THIS EPISODE[\s\S]*Victoria confronted Lola/);
    expect(text).toContain('OVERUSED LATELY (never use these phrases): "don\'t play dumb"');
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

describe("weekly seasons", () => {
  const season: SeasonPlan = {
    title: "The Week of the Missing Will",
    question: "Who took Victoria's will?",
    days: ["Mon: the will vanishes", "Tue: a forged copy", "Wed: Marcus remembers", "Thu: the safe code", "Fri: Lola's alibi cracks", "Sat: Dante confesses (falsely)", "Sun: the truth"],
    answer: "Victoria hid it herself to test them.",
  };

  it("keys weeks by their Monday in the station's time zone", () => {
    const tz = "America/Los_Angeles";
    expect(weekOf(Date.UTC(2026, 9, 4, 19), tz)).toEqual({ key: "2026-09-28", day: 6 }); // Sun Oct 4, noon PDT
    expect(weekOf(Date.UTC(2026, 9, 5, 6, 30), tz)).toEqual({ key: "2026-09-28", day: 6 }); // still Sunday night locally
    expect(weekOf(Date.UTC(2026, 9, 5, 19), tz)).toEqual({ key: "2026-10-05", day: 0 }); // Monday
  });

  it("tidies a season to seven clean days, finale last", () => {
    expect(tidySeason(season).days[0]).toBe("the will vanishes");
    const short = tidySeason({ ...season, days: ["1. a", "2. bee", "3. sea", "Sunday: the end"] });
    expect(short.days).toHaveLength(7);
    expect(short.days[6]).toBe("the end");
    const padded = tidySeason({ ...season, days: [", 'Betrayal of Trust', Victoria demands Lola leave. Dante meets her in secret. Lola reveals a benefactor. Dante walks out.", ...season.days.slice(1)] });
    expect(padded.days[0]).toBe("Victoria demands Lola leave. Dante meets her in secret.");
  });

  function seasonSetup(answerAt: number) {
    const asked: PlanRequest[] = [];
    let seasons = 0;
    const improv = new ImprovWriter(3);
    const w: Writer & { plan(r: PlanRequest): Promise<EpisodePlan>; planSeason(): Promise<SeasonPlan> } = {
      name: "planner",
      write: (b) => improv.write(b),
      plan: async (r) => (asked.push(r), plan()),
      planSeason: async () => (seasons++, season),
    };
    const db = openDb(":memory:");
    const episodes = new EpisodeBook(db, new MemoryBank(db), undefined, undefined, TZ);
    const producer = new Producer({ timeline: new Timeline(db), memory: new MemoryBank(db), tts: new SilentTTS(), writers: [w, new ImprovWriter(1)], timeZone: TZ, episodes });
    const at = answerAt;
    return { producer, asked, episodes, seasonsPlanned: () => seasons, at };
  }

  it("plans the week once and gives each episode its day's development; the answer only on Sunday", async () => {
    // Pixel Heights 10am-12pm UTC. Thursday Oct 8 2026, then Sunday Oct 11.
    const thu = Date.UTC(2026, 9, 8, 10, 30);
    const { producer, asked, episodes, seasonsPlanned } = seasonSetup(thu);
    await producer.produce(thu, slotAt(thu, TZ), { rerun: false });
    expect(asked[0].season).toMatchObject({ day: 3, today: "the safe code", answer: undefined });
    const sun = Date.UTC(2026, 9, 11, 10, 30);
    await producer.produce(sun, slotAt(sun, TZ), { rerun: false });
    expect(asked[1].season).toMatchObject({ day: 6, today: "the truth", answer: "Victoria hid it herself to test them." });
    expect(seasonsPlanned()).toBe(1);
    expect(episodes.getSeason("pixel_heights", "2026-10-05")?.title).toBe("The Week of the Missing Will");
  });

  it("episodic shows don't get seasons", async () => {
    const lateByte = Date.UTC(2026, 9, 8, 23, 0); // late_byte in UTC
    const { producer, asked, seasonsPlanned } = seasonSetup(lateByte);
    await producer.produce(lateByte, slotAt(lateByte, TZ), { rerun: false });
    expect(asked[0]?.season).toBeUndefined();
    expect(seasonsPlanned()).toBe(0);
  });

  it("doesn't start a season late in the week (it would reveal its answer almost at once)", async () => {
    const sat = Date.UTC(2026, 9, 10, 10, 30);
    const { producer, asked, seasonsPlanned } = seasonSetup(sat);
    await producer.produce(sat, slotAt(sat, TZ), { rerun: false });
    expect(seasonsPlanned()).toBe(0);
    expect(asked[0].season).toBeUndefined();
  });

  it("doesn't keep a season that repeats one development all week; tries again next episode", async () => {
    const { producer, episodes } = seasonSetup(0);
    const thu = Date.UTC(2026, 9, 5, 10, 30); // a Monday
    const flat = { ...season, days: Array(7).fill("Secrets in the Walls") };
    let tries = 0;
    const w = (producer as unknown as { d: { writers: { planSeason?: () => Promise<SeasonPlan> }[] } }).d.writers[0];
    w.planSeason = async () => (tries++, tries === 1 ? flat : season);
    await producer.produce(thu, slotAt(thu, TZ), { rerun: false });
    expect(episodes.getSeason("pixel_heights", "2026-10-05")).toBeUndefined();
    // The next airing (Tuesday morning) plans it again, properly.
    const tue = thu + 86_400_000;
    await producer.produce(tue, slotAt(tue, TZ), { rerun: false });
    expect(episodes.getSeason("pixel_heights", "2026-10-05")?.days[1]).toBe("a forged copy");
  });
});
