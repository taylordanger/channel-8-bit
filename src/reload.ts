import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Restart just the station inside a running \`npm run onair\` (new code, same public address).
 *   npm run reload            the station on port 8088
 *   PORT=8099 npm run reload  another copy
 */
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pidFile = path.join(root, "data", `onair-${process.env.PORT ?? "8088"}.pid`);
const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : NaN;
/** Whether a process is really our supervisor: after a crash or reboot, the pid may belong to something else. */
function isOnair(p: number): boolean {
  try {
    return /src\/onair\.ts/.test(execFileSync("ps", ["-p", String(p), "-o", "command="], { encoding: "utf8" }));
  } catch {
    return false; // no such process
  }
}

try {
  if (!Number.isInteger(pid)) throw new Error("no pid file");
  if (!isOnair(pid)) {
    fs.rmSync(pidFile, { force: true }); // left behind by a crash or reboot
    throw new Error("stale pid file");
  }
  process.kill(pid, "SIGUSR2");
  console.log("Reloading: the station restarts with the new code in a few seconds; the public address stays the same.");
} catch {
  console.log("Channel 8-Bit isn't running under npm run onair, so there's nothing to reload. Start it with: npm run onair");
  process.exit(1);
}
