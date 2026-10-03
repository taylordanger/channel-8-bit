/** The station's notion of "now". Swapping in a ManualClock is what makes shadow runs possible. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock that only moves when told to; used by tests and the shadow station. */
export class ManualClock implements Clock {
  constructor(private t: number) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
  set(t: number) {
    this.t = t;
  }
}

/** Real time, shifted by a fixed offset - e.g. rehearse tonight's late show at 3pm. */
export class OffsetClock implements Clock {
  constructor(private offsetMs: number) {}
  now() {
    return Date.now() + this.offsetMs;
  }
}
