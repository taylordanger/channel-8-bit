import { channelName } from "./twitch.js";
import { DEFAULT_FEEDS } from "./newsfeeds.js";
import path from "node:path";
import { kokoroInstalled } from "./tts.js";

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface StationConfig {
  networkName: string;
  /** Amazon Associates tracking ID, added to every product link (e.g. "yourname-20"). */
  amazonTag: string;
  /** Minutes of airtime between commercial breaks (0 = no ads). */
  adEveryMin: number;
  /** Public address viewers can vote at, shown on the broadcast feed (e.g. a tunnel or domain). */
  publicUrl: string;
  port: number;
  dataDir: string;
  /** IANA time zone the schedule grid is laid out in. */
  timeZone: string;
  models: { standard: string; premium: string };
  /** Hard daily ceiling on Claude spend (USD). Past it, the station airs reruns. */
  dailyBudgetUsd: number;
  /** Hours when a restream alone (no website viewers) gets fresh writing; see Governor. */
  feedFreshHours: Set<number>;
  /** Hours (local) the station writes fresh scenes with nobody watching: the flagship, by default with the free local writer. */
  alwaysOnHours: Set<number>;
  /** The overnight writers' room: which Ollama server and model write banked scenes (null = off). */
  bank: { url: string; model: string } | null;
  /** Real-news feeds for The 8-Bit Report ([] = off), and how many stories a day it may add. */
  newsFeeds: string[];
  newsPerDay: number;
  /** Shoutouts: a payment link shown on the request form (empty = free), and the price text. */
  shoutoutPaymentUrl: string;
  shoutoutPrice: string;
  /** Twitch channel whose chat is relayed into the network's chat (read-only; just the name). */
  twitchChannel: string;
  /** How far ahead of "now" the station keeps written segments while people are watching. */
  leadTargetMs: number;
  /** Keep producing for this long after the last viewer leaves. */
  idleGraceMs: number;
  /** "kokoro" (local neural voices), "say" (macOS built-in), or "silent" (tests and shadow runs). */
  tts: "kokoro" | "say" | "silent";
  kokoro: { dir: string; port: number };
  /** "auto" = Claude when credentials exist, else a local Ollama model, else the improv troupe. */
  writer: "auto" | "claude" | "local" | "improv";
  ollama: { url: string; model: string };
  /** Run the LLM standards pass on premium shows (deterministic checks always run). */
  llmStandards: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StationConfig {
  const hasClaude = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const writer = (env.WRITER as StationConfig["writer"]) ?? "auto";
  return {
    networkName: env.NETWORK_NAME ?? "Channel 8-Bit",
    publicUrl: env.PUBLIC_URL && env.PUBLIC_URL !== "auto" ? env.PUBLIC_URL : "",
    amazonTag: (env.AMAZON_TAG ?? "").trim(),
    adEveryMin: num(env.AD_EVERY_MIN, 10),
    port: num(env.PORT, 8088),
    dataDir: path.resolve(env.DATA_DIR ?? "data"),
    timeZone: env.STATION_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    models: {
      standard: env.MODEL_STANDARD ?? "claude-haiku-4-5",
      premium: env.MODEL_PREMIUM ?? "claude-sonnet-5-5",
    },
    dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 3),
    // Local writing is free, so a restream gets it around the clock; paid writing only when asked.
    twitchChannel: channelName(env.TWITCH_CHANNEL),
    // On by default with the local writer (free); point BANK_OLLAMA_URL at another machine to use a
    // bigger model there. Off with Claude unless a bank server is set (banking would cost money).
    bank:
      env.BANK === "off"
        ? null
        : env.BANK_OLLAMA_URL || writer === "local" || (writer === "auto" && !hasClaude)
          ? { url: env.BANK_OLLAMA_URL ?? env.OLLAMA_URL ?? "http://localhost:11434", model: env.BANK_OLLAMA_MODEL ?? env.OLLAMA_MODEL ?? "llama3.1:8b" }
          : null,
    newsFeeds: env.NEWS_FEEDS === "off" ? [] : env.NEWS_FEEDS ? env.NEWS_FEEDS.split(",").map((u) => u.trim()).filter((u) => /^https:\/\//.test(u)) : DEFAULT_FEEDS,
    newsPerDay: num(env.NEWS_PER_DAY, 6),
    shoutoutPaymentUrl: /^https:\/\/\S+$/.test(env.SHOUTOUT_PAYMENT_URL ?? "") ? env.SHOUTOUT_PAYMENT_URL! : "",
    shoutoutPrice: (env.SHOUTOUT_PRICE ?? "").slice(0, 20),
    alwaysOnHours: parseHours(env.ALWAYS_ON_HOURS ?? (writer === "auto" && !hasClaude || writer === "local" ? "21-24" : "")),
    feedFreshHours: parseHours(env.FEED_FRESH_HOURS ?? (writer === "auto" && !hasClaude || writer === "local" ? "0-24" : "")),
    leadTargetMs: num(env.LEAD_TARGET_SEC, 150) * 1000,
    idleGraceMs: num(env.IDLE_GRACE_SEC, 120) * 1000,
    // "auto": Kokoro when it's installed (npm run voices:setup), else macOS speech.
    tts:
      env.TTS && env.TTS !== "auto"
        ? (env.TTS as StationConfig["tts"])
        : kokoroInstalled(process.cwd(), path.resolve(env.KOKORO_DIR ?? "data/kokoro"))
          ? "kokoro"
          : process.platform === "darwin"
            ? "say"
            : "silent",
    kokoro: { dir: path.resolve(env.KOKORO_DIR ?? "data/kokoro"), port: num(env.KOKORO_PORT, 8765) },
    writer: writer === "auto" ? (hasClaude ? "claude" : "local") : writer,
    ollama: { url: env.OLLAMA_URL ?? "http://localhost:11434", model: env.OLLAMA_MODEL ?? "llama3.1:8b" },
    llmStandards: env.LLM_STANDARDS !== "0",
  };
}

/** "19-23,7" -> {19,20,21,22,7}. Ranges are start-inclusive, end-exclusive; "0-24" is all day. */
export function parseHours(spec: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map(Number);
    if (!Number.isInteger(a)) continue;
    const end = Number.isInteger(b) ? b : a + 1;
    for (let h = a; h < end && h < 24; h++) if (h >= 0) out.add(h);
  }
  return out;
}
