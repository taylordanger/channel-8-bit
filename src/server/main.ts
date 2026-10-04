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
let retract: (ids: string[]) => void = () => {};
// Rehearsal: CLOCK_OFFSET_MIN=540 DATA_DIR=data-rehearsal PORT=8089 runs a copy of the station nine hours ahead.
const offsetMin = Number(process.env.CLOCK_OFFSET_MIN ?? 0);
const clock = offsetMin ? new OffsetClock(offsetMin * 60_000) : systemClock;
const built = buildStation(config, { log, clock, onSegment: (s) => push(s), onRetract: (ids) => retract(ids) });
const http = startHttp(config, built, path.resolve(here, "../../public"));
push = http.pushSegment;
retract = http.retract;
built.station.start();

log(`${config.networkName} is on the air at http://localhost:${config.port}${offsetMin ? ` (REHEARSAL, clock shifted ${offsetMin} min)` : ""}`);
log(`writer=${built.writers.map((w) => w.name).join(" > ")} tts=${built.tts.name} budget=$${config.dailyBudgetUsd}/day tz=${config.timeZone}`);
if (config.writer === "local") {
  const ready = await built.ollama.available();
  log(
    ready
      ? `Local writers' room: ${config.ollama.model} via Ollama (no API key needed). The improv troupe covers if it's slow or down.`
      : `Ollama model ${config.ollama.model} isn't available at ${config.ollama.url}; the improv troupe is writing. Start Ollama or run: ollama pull ${config.ollama.model}`,
  );
}
if (config.writer === "improv") log("The improv troupe is writing (WRITER=improv).");

const shutdown = (signal: string) => {
  log(`received ${signal}: going off the air`);
  built.station.stop();
  http.close();
  built.db.close();
  process.exit(0);
};
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => shutdown(sig));
// A 24/7 station shouldn't go dark over one bad request or segment: log and keep broadcasting.
process.on("uncaughtException", (err) => log(`uncaught error (still on air): ${err.stack ?? err}`));
process.on("unhandledRejection", (err) => log(`unhandled rejection (still on air): ${(err as Error)?.stack ?? err}`));
process.on("exit", (code) => log(`process exiting with code ${code}`));
