import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./server/config.js";

/**
 * One command for the whole network: the station, the public tunnel, and (optionally) the
 * restream, kept alive together. Crashed pieces restart with backoff; the Mac is kept awake
 * while this runs; Ctrl-C stops everything.
 *
 *   npm run onair          station + tunnel
 *   TUNNEL=0 npm run onair station only
 *   RESTREAM=1 npm run onair  ...and stream to STREAM_URL
 *   OLLAMA=0 npm run onair    don't touch Ollama
 *
 * Ollama: if it's already running (e.g. as a Homebrew service) we use it and just unload the
 * model when we go off the air, freeing its memory. If it isn't, we start it and stop it with us.
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = process.env.PORT ?? "8088";
const cloudflared = path.join(root, "tools", "cloudflared");
const tunnel = process.env.TUNNEL !== "0" && fs.existsSync(cloudflared);
const restream = process.env.RESTREAM === "1";
const ollama = loadConfig(process.env).ollama;
const ollamaBin = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"].find((p) => fs.existsSync(p)) ?? "ollama";
const manageOllama = process.env.OLLAMA !== "0" && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(ollama.url);
const log = (who: string, m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${who.padEnd(8)} ${m}`);

interface Service {
  name: string;
  cmd: string;
  args: string[];
  /** Wait this long after start before starting the next service. */
  settleMs?: number;
  env?: Record<string, string>;
}

const services: Service[] = [
  { name: "station", cmd: process.execPath, args: ["--env-file-if-exists=.env", "--import", "tsx", "src/server/main.ts"], settleMs: 6000 },
  ...(tunnel ? [{ name: "tunnel", cmd: cloudflared, args: ["tunnel", "--no-autoupdate", "--metrics", "127.0.0.1:20241", "--url", `http://localhost:${port}`] }] : []),
  ...(restream ? [{ name: "restream", cmd: process.execPath, args: ["--env-file-if-exists=.env", "--import", "tsx", "src/restream/main.ts"] }] : []),
];

const running = new Map<string, ChildProcess>();
let stopping = false;
/** Services being restarted on purpose (npm run reload): come straight back, no backoff. */
const reloading = new Set<string>();
const pidFile = path.join(root, "data", "onair.pid");

function start(svc: Service, attempt = 0) {
  if (stopping) return;
  const child = spawn(svc.cmd, svc.args, { cwd: root, env: { ...process.env, ...svc.env }, stdio: ["ignore", "pipe", "pipe"] });
  running.set(svc.name, child);
  const started = Date.now();
  const pipe = (stream: NodeJS.ReadableStream) =>
    stream.on("data", (d: Buffer) => {
      for (const line of String(d).split("\n")) {
        if (!line.trim()) continue;
        // cloudflared is chatty; keep its important lines.
        if (svc.name === "tunnel" && !/trycloudflare\.com|ERR|error|Registered tunnel/i.test(line)) continue;
        // ...and Ollama logs every request; only its problems matter here.
        if (svc.name === "ollama" && !/level=(ERROR|WARN)|panic|error:/i.test(line)) continue;
        log(svc.name, line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 300));
      }
    });
  pipe(child.stdout!);
  pipe(child.stderr!);
  child.on("exit", (code, signal) => {
    running.delete(svc.name);
    if (stopping) return;
    if (reloading.delete(svc.name)) {
      log(svc.name, "restarting with the new code");
      return void setTimeout(() => start(svc, 0), 300);
    }
    // A service that ran for a while gets a fresh backoff.
    const next = Date.now() - started > 60_000 ? 0 : attempt + 1;
    const wait = Math.min(60_000, 2000 * 2 ** next);
    log(svc.name, `exited (${signal ?? code}); restarting in ${Math.round(wait / 1000)}s`);
    setTimeout(() => start(svc, next), wait);
  });
}

async function ollamaUp(): Promise<boolean> {
  try {
    return (await fetch(`${ollama.url}/api/version`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** Make sure the local writer's model server is up; start it ourselves if nobody else did. */
async function ensureOllama() {
  if (await ollamaUp()) {
    log("ollama", `already running at ${ollama.url}; leaving it be (model unloads when we go off the air)`);
    return;
  }
  const ollamaPort = new URL(ollama.url).port || "11434";
  start({ name: "ollama", cmd: ollamaBin, args: ["serve"], env: { OLLAMA_HOST: `127.0.0.1:${ollamaPort}` } });
  for (let i = 0; i < 30 && !(await ollamaUp()); i++) await new Promise((r) => setTimeout(r, 500));
  log("ollama", (await ollamaUp()) ? `started at ${ollama.url}` : "didn't come up; the station will fall back to improv");
}

/** Ask Ollama to drop the model from memory now instead of 30 minutes from now. */
async function unloadModel() {
  try {
    await fetch(`${ollama.url}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: ollama.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(2500),
    });
    log("ollama", `unloaded ${ollama.model}`);
  } catch {
    /* already gone */
  }
}

function buildWeb(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const b = spawn("npm", ["run", "-s", "build:web"], { cwd: root, stdio: "ignore" });
    b.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("web build failed"))));
  });
}

/**
 * npm run reload: rebuild the player and restart only the station, keeping the tunnel up, so
 * the public address doesn't change and viewers just reconnect.
 */
async function reload() {
  const station = running.get("station");
  if (stopping || !station) return;
  log("onair", "reloading the station (the tunnel and its address stay up)...");
  try {
    await buildWeb();
  } catch (e) {
    return log("onair", `reload cancelled: ${(e as Error).message}`);
  }
  reloading.add("station");
  station.kill("SIGTERM");
}
process.on("SIGUSR2", () => void reload());

async function main() {
  // Build the player once up front (the station process doesn't).
  await buildWeb();
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid));
  // Keep the Mac awake for as long as we're on the air.
  if (process.platform === "darwin") {
    const awake = spawn("caffeinate", ["-dims", "-w", String(process.pid)], { stdio: "ignore" });
    awake.unref();
    log("onair", "keeping the Mac awake while on the air");
  }
  if (manageOllama) await ensureOllama();
  for (const svc of services) {
    start(svc);
    if (svc.settleMs) await new Promise((r) => setTimeout(r, svc.settleMs));
  }
  log("onair", `on the air: http://localhost:${port}${tunnel ? " (public address appears above once the tunnel connects)" : ""}`);
}

async function stop() {
  if (stopping) return;
  stopping = true;
  log("onair", "going off the air...");
  fs.rmSync(pidFile, { force: true });
  const ownOllama = running.get("ollama");
  for (const [name, child] of running) if (name !== "ollama") child.kill("SIGTERM");
  // Someone else's Ollama keeps running, but without our model hogging ~5 GB of memory.
  if (manageOllama && !ownOllama) await unloadModel();
  ownOllama?.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => void stop());

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
