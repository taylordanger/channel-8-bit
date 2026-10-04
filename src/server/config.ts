import path from "node:path";
import { kokoroInstalled } from "./tts.js";

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface StationConfig {
  networkName: string;
  /** Public address viewers can vote at, shown on the broadcast feed (e.g. a tunnel or domain). */
  publicUrl: string;
  port: number;
  dataDir: string;
  /** IANA time zone the schedule grid is laid out in. */
  timeZone: string;
  models: { standard: string; premium: string };
  /** Hard daily ceiling on Claude spend (USD). Past it, the station airs reruns. */
  dailyBudgetUsd: number;
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
    publicUrl: env.PUBLIC_URL ?? "",
    port: num(env.PORT, 8088),
    dataDir: path.resolve(env.DATA_DIR ?? "data"),
    timeZone: env.STATION_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    models: {
      standard: env.MODEL_STANDARD ?? "claude-haiku-4-5",
      premium: env.MODEL_PREMIUM ?? "claude-sonnet-5-5",
    },
    dailyBudgetUsd: num(env.DAILY_BUDGET_USD, 3),
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
