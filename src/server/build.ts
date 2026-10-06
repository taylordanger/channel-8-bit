import fs from "node:fs";
import path from "node:path";
import type { PollResult, Segment } from "../shared/types.js";
import { CHARACTERS } from "./catalog/characters.js";
import { validateGrid } from "./catalog/schedule.js";
import { systemClock, type Clock } from "./clock.js";
import type { StationConfig } from "./config.js";
import { openDb } from "./db.js";
import { Governor } from "./governor.js";
import { Ledger } from "./ledger.js";
import { EpisodeBook, GameResults } from "./episodes.js";
import { AudienceLog } from "./audience.js";
import { ClipDesk, ffmpegVertical, FunnyMeter, processRenderer, type ClipRenderer } from "./clips.js";
import { ShoutoutDesk } from "./shoutouts.js";
import { NewsFeeds } from "./newsfeeds.js";
import { CharacterStates, MemoryBank } from "./memory.js";
import { Producer } from "./producer.js";
import { TopicDesk } from "./desk.js";
import { PollBox } from "./polls.js";
import { OpsLog } from "./ops.js";
import { LocalModerator, MailBag } from "./mailbag.js";
import { ChatRoom } from "./chat.js";
import { TrackLibrary } from "./tracks.js";
import { ProductShelf } from "./products.js";
import { FactChecker, LocalFactChecker } from "./factcheck.js";
import { OllamaClient, OllamaWriter } from "./writers/ollama.js";
import { DEFAULT_POLICY, LlmStandards, type StandardsPolicy } from "./standards.js";
import { Station } from "./station.js";
import { Timeline } from "./timeline.js";
import { KokoroTTS, SayTTS, SilentTTS, installedSayVoices, type TTSEngine } from "./tts.js";
import { ClaudeWriter } from "./writers/claude.js";
import { ImprovWriter } from "./writers/improv.js";
import type { Writer } from "./writers/script.js";
import type { Source } from "./sources.js";

export interface BuildOptions {
  clock?: Clock;
  dbFile?: string;
  tts?: TTSEngine;
  writers?: Writer[];
  onSegment?: (s: Segment) => void;
  onRetract?: (ids: string[]) => void;
  onPoll?: (r: PollResult) => void;
  log?: (msg: string) => void;
  /** Override how assignment-desk links are read (tests). */
  sourceReader?: (url: string) => Promise<Source>;
  /** Renders clips (tests pass a fake; the default spawns Chrome + ffmpeg). */
  clipRenderer?: ClipRenderer;
}

/** Extra blocklist patterns from data/standards.json: { "blocklist": ["regex", ...] }. */
function loadPolicy(dataDir: string): StandardsPolicy {
  const file = path.join(dataDir, "standards.json");
  if (!fs.existsSync(file)) return DEFAULT_POLICY;
  const extra = (JSON.parse(fs.readFileSync(file, "utf8")) as { blocklist?: string[] }).blocklist ?? [];
  return { ...DEFAULT_POLICY, blocklist: [...DEFAULT_POLICY.blocklist, ...extra.map((p) => new RegExp(p, "i"))] };
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
  const states = new CharacterStates(db);
  const polls = new PollBox(db);
  const ops = new OpsLog(db);
  const desk = new TopicDesk(db, o.sourceReader);
  const episodes = new EpisodeBook(db, memory, states, o.log, config.timeZone);
  const results = new GameResults(db);
  const clips = new ClipDesk(db, path.join(config.dataDir, "clips"), o.clipRenderer ?? processRenderer(process.cwd(), config.port), o.log);
  const funny = new FunnyMeter(db);
  const audience = new AudienceLog(db);
  const ledger = new Ledger(db, config.timeZone, config.dailyBudgetUsd);
  const governor = new Governor({ ...config, ledger });
  const media = path.join(config.dataDir, "media");
  const tts =
    o.tts ??
    (config.tts === "kokoro"
      ? new KokoroTTS({
          mediaDir: media,
          python: path.resolve(".venv-tts/bin/python"),
          script: path.resolve("tts/kokoro_server.py"),
          modelDir: config.kokoro.dir,
          port: config.kokoro.port,
          fallback: new SayTTS(media),
          log: o.log,
        })
      : config.tts === "say"
        ? new SayTTS(media)
        : new SilentTTS());

  const improv = new ImprovWriter();
  const ollama = new OllamaClient(config.ollama.url, config.ollama.model);
  const policy = loadPolicy(config.dataDir);
  // The local model screens viewer mail (if it's down, mail waits for review on the desk).
  const moderator = o.writers ? undefined : new LocalModerator(ollama);
  const mailbag = new MailBag(db, policy, moderator);
  const chat = new ChatRoom(db, policy, moderator);
  const tracks = new TrackLibrary(path.join(config.dataDir, "music"), o.log);
  const products = new ProductShelf(db, o.sourceReader);
  const writers =
    o.writers ??
    (config.writer === "claude"
      ? [new ClaudeWriter({ networkName: config.networkName, models: config.models, ledger, clock }), improv]
      : config.writer === "local"
        ? [new OllamaWriter(ollama, config.networkName), improv]
        : [improv]);
  const llmStandards =
    config.writer === "claude" && config.llmStandards && !o.writers
      ? new LlmStandards({ model: config.models.premium, ledger, clock })
      : undefined;

  const factChecker = o.writers
    ? undefined
    : config.writer === "claude"
      ? new FactChecker({ model: config.models.premium, ledger, clock })
      : config.writer === "local"
        ? new LocalFactChecker(ollama)
        : undefined;
  const producer = new Producer({
    timeline,
    memory,
    states,
    polls,
    desk,
    episodes,
    results,
    tts,
    writers,
    llmStandards,
    factChecker,
    policy,
    mailbag,
    ops,
    chat,
    tracks,
    products,
    adEveryMin: config.adEveryMin,
    timeZone: config.timeZone,
    log: o.log,
  });
  const station = new Station({
    db,
    clock,
    timeline,
    memory,
    states,
    polls,
    ops,
    producer,
    governor,
    results,
    timeZone: config.timeZone,
    onSegment: o.onSegment,
    onRetract: o.onRetract,
    onPoll: o.onPoll,
    log: o.log,
  });
  // Finish reading any links a restart interrupted.
  for (const t of desk.pending()) void desk.ingest(t.id);
  const shoutouts = new ShoutoutDesk(db, {
    policy,
    moderator,
    make: (s) => producer.shoutout(s, clock.now()),
    render: o.clipRenderer ?? processRenderer(process.cwd(), config.port),
    vertical: ffmpegVertical,
    dir: path.join(config.dataDir, "shoutouts"),
    log: o.log,
  });
  // Real news only reaches the news desk when there's a local model to screen it (not in tests).
  const newsFeeds = new NewsFeeds(db, { desk, feeds: o.writers ? [] : config.newsFeeds, ollama: o.writers ? undefined : ollama, perDay: config.newsPerDay, log: o.log });
  return { newsFeeds, shoutouts, audience, clips, funny, episodes, results, ollama, mailbag, chat, tracks, products, ops, db, clock, timeline, memory, states, polls, desk, ledger, governor, tts, writers, producer, station };
}

export type Built = ReturnType<typeof buildStation>;
