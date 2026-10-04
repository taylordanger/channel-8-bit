import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * One command for the whole network: the station, the public tunnel, and (optionally) the
 * restream, kept alive together. Crashed pieces restart with backoff; the Mac is kept awake
 * while this runs; Ctrl-C stops everything.
 *
 *   npm run onair          station + tunnel
 *   TUNNEL=0 npm run onair station only
 *   RESTREAM=1 npm run onair  ...and stream to STREAM_URL
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = process.env.PORT ?? "8088";
const cloudflared = path.join(root, "tools", "cloudflared");
const tunnel = process.env.TUNNEL !== "0" && fs.existsSync(cloudflared);
const restream = process.env.RESTREAM === "1";
const log = (who: string, m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${who.padEnd(8)} ${m}`);

interface Service {
  name: string;
  cmd: string;
  args: string[];
  /** Wait this long after start before starting the next service. */
  settleMs?: number;
}

const services: Service[] = [
  { name: "station", cmd: process.execPath, args: ["--env-file-if-exists=.env", "--import", "tsx", "src/server/main.ts"], settleMs: 6000 },
  ...(tunnel ? [{ name: "tunnel", cmd: cloudflared, args: ["tunnel", "--no-autoupdate", "--metrics", "127.0.0.1:20241", "--url", `http://localhost:${port}`] }] : []),
  ...(restream ? [{ name: "restream", cmd: process.execPath, args: ["--env-file-if-exists=.env", "--import", "tsx", "src/restream/main.ts"] }] : []),
];

const running = new Map<string, ChildProcess>();
let stopping = false;

function start(svc: Service, attempt = 0) {
  if (stopping) return;
  const child = spawn(svc.cmd, svc.args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  running.set(svc.name, child);
  const started = Date.now();
  const pipe = (stream: NodeJS.ReadableStream) =>
    stream.on("data", (d: Buffer) => {
      for (const line of String(d).split("\n")) {
        if (!line.trim()) continue;
        // cloudflared is chatty; keep its important lines.
        if (svc.name === "tunnel" && !/trycloudflare\.com|ERR|error|Registered tunnel/i.test(line)) continue;
        log(svc.name, line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 300));
      }
    });
  pipe(child.stdout!);
  pipe(child.stderr!);
  child.on("exit", (code, signal) => {
    running.delete(svc.name);
    if (stopping) return;
    // A service that ran for a while gets a fresh backoff.
    const next = Date.now() - started > 60_000 ? 0 : attempt + 1;
    const wait = Math.min(60_000, 2000 * 2 ** next);
    log(svc.name, `exited (${signal ?? code}); restarting in ${Math.round(wait / 1000)}s`);
    setTimeout(() => start(svc, next), wait);
  });
}

async function main() {
  // Build the player once up front (the station process doesn't).
  await new Promise<void>((resolve, reject) => {
    const b = spawn("npm", ["run", "-s", "build:web"], { cwd: root, stdio: "ignore" });
    b.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("web build failed"))));
  });
  // Keep the Mac awake for as long as we're on the air.
  if (process.platform === "darwin") {
    const awake = spawn("caffeinate", ["-dims", "-w", String(process.pid)], { stdio: "ignore" });
    awake.unref();
    log("onair", "keeping the Mac awake while on the air");
  }
  for (const svc of services) {
    start(svc);
    if (svc.settleMs) await new Promise((r) => setTimeout(r, svc.settleMs));
  }
  log("onair", `on the air: http://localhost:${port}${tunnel ? " (public address appears above once the tunnel connects)" : ""}`);
}

function stop() {
  if (stopping) return;
  stopping = true;
  log("onair", "going off the air...");
  for (const child of running.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGHUP", stop);

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
