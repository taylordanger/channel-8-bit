import { spawn } from "node:child_process";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import puppeteer from "puppeteer-core";
import { WebSocketServer } from "ws";

/**
 * Renders one archived segment to an MP4 clip: the broadcast page replays it on its own clock
 * (captions included), records itself, and ffmpeg turns the recording into a shareable file.
 * Runs as its own process, spawned by the station's clip desk.
 *
 *   node --import tsx src/clips/render.ts --segment <id> --out data/clips/x.mp4
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const segment = flag("segment");
const out = flag("out");
const limitMs = Number(flag("limit-ms") ?? 300_000);
const station = process.env.STATION_URL ?? `http://localhost:${process.env.PORT ?? 8088}`;
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!segment || !out) {
  console.error("usage: render.ts --segment <id> --out <file.mp4>");
  process.exit(2);
}

const tmp = `${out}.part.mp4`;
const ff = spawn(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    "-fflags", "+genpts", "-f", "webm", "-i", "pipe:0",
    "-c:v", "h264_videotoolbox", "-b:v", "5000k", "-r", "30", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart", "-f", "mp4", tmp,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
ff.stdin.on("error", () => {});
const ffDone = new Promise<number>((r) => ff.on("exit", (c) => r(c ?? 1)));

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((r) => wss.once("listening", r));
const port = (wss.address() as AddressInfo).port;

let finish: (ok: boolean) => void = () => {};
const recorded = new Promise<boolean>((r) => (finish = r));
let bytes = 0;
wss.on("connection", (ws) => {
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      bytes += (data as Buffer).length;
      ff.stdin.write(data as Buffer);
    } else if (String(data).includes('"done"')) finish(true);
  });
  ws.on("close", () => finish(bytes > 0));
});

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error(`page error: ${(e as Error).message}`));
await page.goto(`${station}/broadcast.html?clip=${encodeURIComponent(segment)}&ingest=ws://127.0.0.1:${port}`, { waitUntil: "load" });

const timer = setTimeout(() => finish(false), limitMs);
const ok = await recorded;
clearTimeout(timer);
await browser.close().catch(() => {});
ff.stdin.end();
const code = await ffDone;
wss.close();
if (ok && code === 0 && fs.existsSync(tmp)) {
  fs.renameSync(tmp, out);
  process.exit(0);
}
fs.rmSync(tmp, { force: true });
console.error(ok ? `ffmpeg failed (${code})` : "the page never finished recording");
process.exit(1);
