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
  return db;
}
