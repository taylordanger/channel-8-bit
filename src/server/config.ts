import path from "node:path";

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface StationConfig {
  networkName: string;
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
  /** "say" (macOS built-in), or "silent" (no audio; used by tests and shadow runs). */
  tts: "say" | "silent";
  /** "auto" uses Claude when credentials exist, else the offline improv writer. */
  writer: "auto" | "claude" | "improv";
  /** Run the LLM standards pass on premium shows (deterministic checks always run). */
  llmStandards: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StationConfig {
  const hasClaude = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const writer = (env.WRITER as StationConfig["writer"]) ?? "auto";
  return {
    networkName: env.NETWORK_NAME ?? "Channel 8-Bit",
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
    tts: (env.TTS as StationConfig["tts"]) ?? (process.platform === "darwin" ? "say" : "silent"),
    writer: writer === "auto" ? (hasClaude ? "claude" : "improv") : writer,
    llmStandards: env.LLM_STANDARDS !== "0",
  };
}
