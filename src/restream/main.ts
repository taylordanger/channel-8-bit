import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { WebSocketServer } from "ws";

/**
 * The restreamer: opens the broadcast feed in a hidden Chrome, receives the page's own
 * recording (picture + station audio), and pushes it through ffmpeg to an RTMP ingest
 * (YouTube, Twitch, ...) or to a local file. Runs as its own process so a streaming
 * problem can never take the station itself off the air.
 *
 *   STREAM_URL=rtmp://a.rtmp.youtube.com/live2/<key> npm run restream
 *   npm run restream -- --out recording.mp4 --seconds 60
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const station = process.env.STATION_URL ?? "http://localhost:8088";
const outFile = flag("out");
const target = outFile ?? process.env.STREAM_URL;
const seconds = Number(flag("seconds") ?? 0);
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const videoKbps = Number(process.env.STREAM_VIDEO_KBPS ?? 3500);

if (!target) {
  console.error("Set STREAM_URL (e.g. rtmp://a.rtmp.youtube.com/live2/<your key>) or pass --out <file.mp4>.");
  process.exit(1);
}

/** Never print a stream key: keep the scheme, host and app, hide the last path segment. */
export function redact(url: string): string {
  return url.replace(/^(rtmps?:\/\/[^/]+\/[^/]+\/).+$/, "$1••••••");
}

const log = (m: string) => console.log(`[restream ${new Date().toISOString()}] ${m}`);

/** ffmpeg: webm from the page -> H.264 (hardware) + AAC, steady keyframes for live ingest. */
function startFfmpeg(): ChildProcess {
  const output = outFile ? ["-movflags", "+faststart", "-f", "mp4", outFile] : ["-f", "flv", target!];
  const ff = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "warning", "-y",
      "-fflags", "+genpts", "-thread_queue_size", "1024",
      "-f", "webm", "-i", "pipe:0",
      "-c:v", "h264_videotoolbox", "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`,
      "-r", "30", "-g", "60", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
      ...(seconds ? ["-t", String(seconds)] : []),
      ...output,
    ],
    { stdio: ["pipe", "inherit", "pipe"] },
  );
  ff.stderr!.on("data", (d: Buffer) => log(`ffmpeg: ${String(d).trim().replaceAll(target!, redact(target!))}`));
  // ffmpeg can exit first (duration reached, ingest dropped); late writes must not crash us.
  ff.stdin!.on("error", () => {});
  return ff;
}

let browser: Browser | undefined;
let ffmpeg: ChildProcess | undefined;
let lastChunk = Date.now();
let bytes = 0;
let stopping = false;

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((r) => wss.once("listening", r));
const port = (wss.address() as AddressInfo).port;

wss.on("connection", (ws) => {
  log("feed connected");
  ffmpeg?.stdin?.end();
  ffmpeg = startFfmpeg();
  const mine = ffmpeg;
  mine.on("exit", (code) => {
    log(`ffmpeg exited (${code})`);
    if (seconds || outFile) return void shutdown(code ?? 0);
    // Live: the ingest dropped (network blip, platform hiccup). Reconnect by reloading the feed.
    if (!stopping && ffmpeg === mine) setTimeout(() => void launchFeed(), 3000);
  });
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return log(`feed: ${String(data)}`);
    lastChunk = Date.now();
    bytes += (data as Buffer).length;
    if (ffmpeg?.stdin?.writable) ffmpeg.stdin.write(data as Buffer);
  });
  ws.on("close", () => log("feed disconnected"));
});

async function launchFeed() {
  await browser?.close().catch(() => {});
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--mute-audio=false",
    ],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => log(`page error: ${(e as Error).message}`));
  await page.goto(`${station}/broadcast.html?ingest=ws://127.0.0.1:${port}`, { waitUntil: "load" });
  lastChunk = Date.now();
  log(`feed page open: ${station}/broadcast.html`);
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log(`stopping (sent ${(bytes / 1e6).toFixed(1)} MB)`);
  ffmpeg?.stdin?.end();
  await browser?.close().catch(() => {});
  wss.close();
  setTimeout(() => process.exit(code), 1500);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

// Watchdog: if the feed goes quiet, relaunch Chrome (ffmpeg restarts on reconnect).
setInterval(() => {
  if (!stopping && Date.now() - lastChunk > 20_000) {
    log("no video for 20s - relaunching the feed");
    void launchFeed();
  }
}, 5000);

log(`streaming ${station} -> ${outFile ? outFile : redact(target)}`);
if (outFile && fs.existsSync(outFile)) fs.rmSync(outFile);
await launchFeed();
