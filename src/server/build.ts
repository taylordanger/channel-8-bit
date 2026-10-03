import fs from "node:fs";
import path from "node:path";
import type { Segment } from "../shared/types.js";
import { CHARACTERS } from "./catalog/characters.js";
import { validateGrid } from "./catalog/schedule.js";
import { systemClock, type Clock } from "./clock.js";
import type { StationConfig } from "./config.js";
import { openDb } from "./db.js";
import { Governor } from "./governor.js";
import { Ledger } from "./ledger.js";
import { MemoryBank } from "./memory.js";
import { Producer } from "./producer.js";
import { TopicDesk } from "./desk.js";
import { DEFAULT_POLICY, LlmStandards, type StandardsPolicy } from "./standards.js";
import { Station } from "./station.js";
import { Timeline } from "./timeline.js";
import { SayTTS, SilentTTS, installedSayVoices, type TTSEngine } from "./tts.js";
import { ClaudeWriter } from "./writers/claude.js";
import { ImprovWriter } from "./writers/improv.js";
import type { Writer } from "./writers/script.js";

export interface BuildOptions {
  clock?: Clock;
  dbFile?: string;
  tts?: TTSEngine;
  writers?: Writer[];
  onSegment?: (s: Segment) => void;
  log?: (msg: string) => void;
}

/** Extra blocklist patterns from data/standards.json: { "blocklist": ["regex", ...] }. */
function loadPolicy(dataDir: string): StandardsPolicy {
  const file = path.join(dataDir, "standards.json");
  if (!fs.existsSync(file)) return DEFAULT_POLICY;
  const extra = (JSON.parse(fs.readFileSync(file, "utf8")) as { blocklist?: string[] }).blocklist ?? [];
  return { blocklist: [...DEFAULT_POLICY.blocklist, ...extra.map((p) => new RegExp(p, "i"))] };
}

export async function checkVoices(): Promise<string[]> {
  const installed = await installedSayVoices();
  return Object.values(CHARACTERS)
    .filter((c) => !installed.has(c.voice.say))
    .map((c) => `${c.name} uses missing voice "${c.voice.say}"`);
}

export function buildStation(config: StationConfig, o: BuildOptions = {}) {
  validateGrid();
  const clock = o.clock ?? systemClock;
  const db = openDb(o.dbFile ?? path.join(config.dataDir, "station.db"));
  const timeline = new Timeline(db);
  const memory = new MemoryBank(db);
  const desk = new TopicDesk(db);
  const ledger = new Ledger(db, config.timeZone);
  const governor = new Governor({ ...config, ledger });
  const tts = o.tts ?? (config.tts === "say" ? new SayTTS(path.join(config.dataDir, "media")) : new SilentTTS());

  const improv = new ImprovWriter();
  const writers =
    o.writers ??
    (config.writer === "claude"
      ? [new ClaudeWriter({ networkName: config.networkName, models: config.models, ledger, clock }), improv]
      : [improv]);
  const llmStandards =
    config.writer === "claude" && config.llmStandards && !o.writers
      ? new LlmStandards({ model: config.models.premium, ledger, clock })
      : undefined;

  const producer = new Producer({
    timeline,
    memory,
    desk,
    tts,
    writers,
    llmStandards,
    policy: loadPolicy(config.dataDir),
    timeZone: config.timeZone,
    log: o.log,
  });
  const station = new Station({
    db,
    clock,
    timeline,
    memory,
    producer,
    governor,
    timeZone: config.timeZone,
    onSegment: o.onSegment,
    log: o.log,
  });
  return { db, clock, timeline, memory, desk, ledger, governor, tts, writers, producer, station };
}

export type Built = ReturnType<typeof buildStation>;
