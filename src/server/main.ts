import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Segment } from "../shared/types.js";
import { buildStation, checkVoices } from "./build.js";
import { OffsetClock, systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { startHttp } from "./http.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

if (config.tts === "say") {
  const missing = await checkVoices();
  if (missing.length) {
    console.error("Missing macOS voices (System Settings > Accessibility > Spoken Content > Manage Voices):");
    missing.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
}

let push: (s: Segment) => void = () => {};
// Rehearsal: CLOCK_OFFSET_MIN=540 DATA_DIR=data-rehearsal PORT=8089 runs a copy of the station nine hours ahead.
const offsetMin = Number(process.env.CLOCK_OFFSET_MIN ?? 0);
const clock = offsetMin ? new OffsetClock(offsetMin * 60_000) : systemClock;
const built = buildStation(config, { log, clock, onSegment: (s) => push(s) });
const http = startHttp(config, built, path.resolve(here, "../../public"));
push = http.pushSegment;
built.station.start();

log(`${config.networkName} is on the air at http://localhost:${config.port}${offsetMin ? ` (REHEARSAL, clock shifted ${offsetMin} min)` : ""}`);
log(`writer=${built.writers.map((w) => w.name).join(" > ")} tts=${built.tts.name} budget=$${config.dailyBudgetUsd}/day tz=${config.timeZone}`);
if (config.writer === "improv") log("No Claude credentials found: the improv troupe is writing. Set ANTHROPIC_API_KEY to bring in the writers' room.");

const shutdown = () => {
  built.station.stop();
  http.close();
  built.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
