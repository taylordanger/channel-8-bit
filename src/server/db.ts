import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS segments (
  id         TEXT PRIMARY KEY,
  show_id    TEXT NOT NULL,
  start_at   INTEGER NOT NULL,
  end_at     INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,       -- full Segment JSON
  summary    TEXT NOT NULL DEFAULT '',
  rerun_of   TEXT
);
CREATE INDEX IF NOT EXISTS segments_start ON segments(start_at);
CREATE INDEX IF NOT EXISTS segments_show ON segments(show_id, start_at);
CREATE INDEX IF NOT EXISTS segments_rerun ON segments(rerun_of);

CREATE TABLE IF NOT EXISTS episode_plans (
  show_id    TEXT NOT NULL,
  slot_start INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  writer     TEXT NOT NULL,
  plan       TEXT NOT NULL,          -- JSON EpisodePlan
  PRIMARY KEY (show_id, slot_start)
);

CREATE TABLE IF NOT EXISTS seasons (
  show_id    TEXT NOT NULL,
  week       TEXT NOT NULL,          -- the Monday's date, YYYY-MM-DD in the station's time zone
  created_at INTEGER NOT NULL,
  writer     TEXT NOT NULL,
  plan       TEXT NOT NULL,          -- JSON SeasonPlan
  PRIMARY KEY (show_id, week)
);

CREATE TABLE IF NOT EXISTS game_results (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id  TEXT NOT NULL,
  episode  TEXT NOT NULL DEFAULT '',
  at       INTEGER NOT NULL,
  champion TEXT NOT NULL,
  scores   TEXT NOT NULL           -- JSON {characterId: points}
);
CREATE INDEX IF NOT EXISTS game_results_at ON game_results(show_id, at);

CREATE TABLE IF NOT EXISTS clips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id  TEXT NOT NULL,
  show_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL,          -- queued | rendering | ready | failed
  file        TEXT,
  error       TEXT,
  duration_ms INTEGER NOT NULL,
  vertical_file TEXT
);

CREATE TABLE IF NOT EXISTS funny (
  segment_id TEXT NOT NULL,
  viewer     TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (segment_id, viewer)
);
CREATE INDEX IF NOT EXISTS funny_at ON funny(at);

CREATE TABLE IF NOT EXISTS viewer_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  viewer      TEXT,                   -- the browser's random voting id; never an IP
  started_at  INTEGER NOT NULL,
  tuned_at    INTEGER,                -- pressed play
  ended_at    INTEGER,
  left_during TEXT,                   -- show on air when they left
  ref         TEXT,                   -- e.g. clip-12 when they came from a clip link
  local       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS viewer_sessions_started ON viewer_sessions(started_at);
CREATE INDEX IF NOT EXISTS viewer_sessions_viewer ON viewer_sessions(viewer, started_at);

CREATE TABLE IF NOT EXISTS archive_marks (
  segment_id TEXT PRIMARY KEY,       -- an original (never an encore's id)
  mark       TEXT NOT NULL,          -- star | retired
  at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shoutouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT NOT NULL UNIQUE,    -- sha256 of the requester's private pickup token
  recipient     TEXT NOT NULL,           -- a first name only
  occasion      TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  show_id       TEXT NOT NULL,
  status        TEXT NOT NULL,           -- pending | approved | writing | rendering | ready | rejected | failed
  reason        TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  segment       TEXT,                    -- the private scene (JSON Segment), never on the timeline
  file          TEXT,
  vertical_file TEXT,
  sender        TEXT NOT NULL            -- hashed IP, for rate limits only
);

CREATE TABLE IF NOT EXISTS news_seen (
  url      TEXT PRIMARY KEY,         -- a feed story already considered (never screened twice)
  at       INTEGER NOT NULL,
  accepted INTEGER NOT NULL,
  reason   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scene_bank (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  segment     TEXT NOT NULL,          -- a voiced, standalone scene (JSON Segment), not yet on the timeline
  aired_at    INTEGER
);
CREATE INDEX IF NOT EXISTS scene_bank_show ON scene_bank(show_id, aired_at, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  show_id    TEXT NOT NULL,
  about      TEXT NOT NULL,        -- JSON array of character ids
  text       TEXT NOT NULL,
  weight     REAL NOT NULL         -- 0..1 importance
);
CREATE INDEX IF NOT EXISTS memories_created ON memories(created_at);

CREATE TABLE IF NOT EXISTS relationships (
  a          TEXT NOT NULL,
  b          TEXT NOT NULL,        -- how a feels about b
  score      REAL NOT NULL,        -- -100 (nemesis) .. 100 (adores)
  note       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS story (
  show_id    TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  day        TEXT NOT NULL,
  model      TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  usd        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_day ON usage(day);

CREATE TABLE IF NOT EXISTS topics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  text         TEXT NOT NULL,
  show_id      TEXT,                -- NULL = any show
  created_at   INTEGER NOT NULL,
  uses         INTEGER NOT NULL DEFAULT 0,
  max_uses     INTEGER NOT NULL DEFAULT 2,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS character_state (
  id              TEXT PRIMARY KEY,
  mood            TEXT NOT NULL DEFAULT 'neutral',
  mood_reason     TEXT NOT NULL DEFAULT '',
  mood_at         INTEGER NOT NULL DEFAULT 0,
  off_show        TEXT,               -- show they stormed off from
  off_reason      TEXT NOT NULL DEFAULT '',
  off_remaining   INTEGER NOT NULL DEFAULT 0,  -- segments of that show they sit out
  owed_entrance   INTEGER NOT NULL DEFAULT 0   -- 1 = owed an entrance in their next scene
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  url          TEXT NOT NULL,          -- the link as pasted
  asin         TEXT,
  title        TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',  -- operator's facts, used if the listing can't be read
  source       TEXT,                   -- what was read from the listing (JSON)
  fetch_status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | failed
  fetch_error  TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  airs         INTEGER NOT NULL DEFAULT 0,
  last_aired   INTEGER,
  facts_at     INTEGER NOT NULL DEFAULT 0  -- when the facts last changed (older ads are stale)
);

CREATE TABLE IF NOT EXISTS ad_clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS production_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  show_id    TEXT NOT NULL,
  writer     TEXT NOT NULL,
  outcome    TEXT NOT NULL,            -- ok | failed | rejected
  write_ms   INTEGER NOT NULL,         -- writing + standards checks
  voice_ms   INTEGER NOT NULL DEFAULT 0,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS production_log_at ON production_log(at);

CREATE TABLE IF NOT EXISTS air_stats (
  minute       INTEGER PRIMARY KEY,    -- unix minute
  viewers_max  INTEGER NOT NULL DEFAULT 0,
  dead_seconds INTEGER NOT NULL DEFAULT 0  -- seconds with viewers present but nothing on air
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  handle   TEXT NOT NULL,
  text     TEXT NOT NULL,
  sender   TEXT NOT NULL,              -- hashed IP
  deleted  INTEGER NOT NULL DEFAULT 0,
  reason   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS chat_messages_at ON chat_messages(at);

CREATE TABLE IF NOT EXISTS chat_mutes (
  sender TEXT PRIMARY KEY,
  until  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS viewer_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  handle     TEXT NOT NULL,
  text       TEXT NOT NULL,
  show_id    TEXT,                     -- NULL = any show that reads mail
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL,            -- pending | approved | rejected | aired
  reason     TEXT NOT NULL DEFAULT '',
  aired_at   INTEGER,
  aired_show TEXT,
  sender     TEXT NOT NULL DEFAULT ''  -- hashed IP, for rate limits only
);
CREATE INDEX IF NOT EXISTS viewer_messages_status ON viewer_messages(status, created_at);

CREATE TABLE IF NOT EXISTS polls (
  id         TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  show_id    TEXT NOT NULL,
  episode    TEXT NOT NULL,
  question   TEXT NOT NULL,
  options    TEXT NOT NULL,          -- JSON [{id,label}]
  opens_at   INTEGER NOT NULL,
  closes_at  INTEGER NOT NULL,
  closed     INTEGER NOT NULL DEFAULT 0,
  winner     TEXT,
  studio     INTEGER NOT NULL DEFAULT 0, -- nobody voted; the studio audience decided
  weight     INTEGER NOT NULL DEFAULT 1  -- points the winner gets (the final counts double)
);
CREATE INDEX IF NOT EXISTS polls_episode ON polls(episode);

CREATE TABLE IF NOT EXISTS votes (
  poll_id    TEXT NOT NULL,
  voter      TEXT NOT NULL,
  option_id  TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (poll_id, voter)
);

CREATE TABLE IF NOT EXISTS overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id    TEXT NOT NULL,
  start_at   INTEGER NOT NULL,
  end_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS standards_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  show_id    TEXT NOT NULL,
  verdict    TEXT NOT NULL,        -- cut | rewrite | reject
  detail     TEXT NOT NULL
);
`;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive column migrations for databases created by earlier versions. */
function migrate(db: DB) {
  const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  const topics = cols("topics");
  const add: [string, string][] = [
    ["url", "TEXT"],
    ["source", "TEXT"], // Source JSON once the link has been read
    ["fetch_status", "TEXT NOT NULL DEFAULT 'none'"], // none | pending | ok | failed
    ["fetch_error", "TEXT"],
  ];
  for (const [name, type] of add) if (!topics.has(name)) db.exec(`ALTER TABLE topics ADD COLUMN ${name} ${type}`);
  const cs = cols("character_state");
  if (!cs.has("off_at")) db.exec("ALTER TABLE character_state ADD COLUMN off_at INTEGER NOT NULL DEFAULT 0");
  if (!cols("topics").has("origin")) db.exec("ALTER TABLE topics ADD COLUMN origin TEXT NOT NULL DEFAULT 'desk'");
  if (!cols("clips").has("vertical_file")) db.exec("ALTER TABLE clips ADD COLUMN vertical_file TEXT");
  if (!cols("products").has("facts_at")) db.exec("ALTER TABLE products ADD COLUMN facts_at INTEGER NOT NULL DEFAULT 0");
  if (!cols("viewer_messages").has("aired_show")) db.exec("ALTER TABLE viewer_messages ADD COLUMN aired_show TEXT");
}
