import type { GuideEntry } from "../../shared/types.js";
import { getShow } from "./shows.js";

export interface Slot {
  /** Hour of day in the station's time zone, 0-23 (inclusive start). */
  startHour: number;
  endHour: number;
  showId: string;
  /** "rerun" slots re-air archived segments instead of paying writers. */
  mode: "live" | "rerun";
}

/** The daily grid. Slots must tile 0..24 with no gaps. */
export const GRID: Slot[] = [
  { startHour: 0, endHour: 2, showId: "late_byte", mode: "live" },
  { startHour: 2, endHour: 6, showId: "pixel_heights", mode: "rerun" },
  { startHour: 6, endHour: 10, showId: "rise_and_pixel", mode: "live" },
  { startHour: 10, endHour: 14, showId: "pixel_heights", mode: "live" },
  { startHour: 14, endHour: 18, showId: "couch_coop", mode: "live" },
  { startHour: 18, endHour: 22, showId: "pixel_heights", mode: "live" },
  { startHour: 22, endHour: 24, showId: "late_byte", mode: "live" },
];

export function validateGrid(grid: Slot[] = GRID): void {
  let h = 0;
  for (const s of grid) {
    if (s.startHour !== h) throw new Error(`schedule gap or overlap at hour ${h}`);
    if (s.endHour <= s.startHour) throw new Error(`empty slot at hour ${h}`);
    getShow(s.showId);
    h = s.endHour;
  }
  if (h !== 24) throw new Error("schedule does not reach midnight");
}

/** Wall-clock parts of an instant in a time zone. */
function zonedParts(t: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

/** Start of the hour containing t in the given zone (handles any UTC offset, incl. half hours). */
function hourStart(t: number, timeZone: string): number {
  const { minute, second } = zonedParts(t, timeZone);
  return t - (minute * 60 + second) * 1000 - (t % 1000);
}

export interface ScheduledSlot extends GuideEntry {
  slot: Slot;
}

/** The slot airing at instant t, with its absolute start/end times. */
export function slotAt(t: number, timeZone: string, grid: Slot[] = GRID): ScheduledSlot {
  const hour = zonedParts(t, timeZone).hour;
  const slot = grid.find((s) => hour >= s.startHour && hour < s.endHour)!;
  const thisHour = hourStart(t, timeZone);
  const startAt = thisHour - (hour - slot.startHour) * 3_600_000;
  const endAt = thisHour + (slot.endHour - hour) * 3_600_000;
  return { slot, showId: slot.showId, title: getShow(slot.showId).title, startAt, endAt, mode: slot.mode };
}

/** Program guide from t forward, merging consecutive identical slots across midnight. */
export function guide(from: number, hours: number, timeZone: string, grid: Slot[] = GRID): GuideEntry[] {
  const out: GuideEntry[] = [];
  let t = from;
  const until = from + hours * 3_600_000;
  while (t < until) {
    const s = slotAt(t, timeZone, grid);
    const last = out[out.length - 1];
    if (last && last.showId === s.showId && last.mode === s.mode && last.endAt === s.startAt) last.endAt = s.endAt;
    else out.push({ showId: s.showId, title: s.title, startAt: s.startAt, endAt: s.endAt, mode: s.mode });
    t = s.endAt;
  }
  return out;
}
