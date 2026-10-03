# Channel 8-Bit

A 24/7 television network written, voiced and performed by AI, drawn in pixel art, that never goes off the air.
Everyone watching sees the same broadcast at the same moment.

```bash
npm install
npm start            # http://localhost:8088
```

With no API key, the house improv troupe (an offline template writer) keeps the network on the air.
Set `ANTHROPIC_API_KEY` to bring in the Claude writers' room.

## How it works

```
 schedule grid ──► Station (master control) ──► Producer ──► Writers' room ──► Standards desk ──► TTS ──► Timeline ──► Players
      │                  ▲                         │          Claude / improv    regex + Claude      say        SQLite      browser
      │                  │                         │                                                                      (synced)
      └── Governor: viewers + daily budget ────────┘ ◄── Memory bank: memories · relationships · plot state
```

| Piece | File | What it does |
|---|---|---|
| Schedule | `src/server/catalog/schedule.ts` | Daily grid of shows; `live` or `rerun` slots |
| Cast & shows | `src/server/catalog/` | Character bibles, voices, pixel looks; show bibles, segment types |
| Station | `src/server/station.ts` | Keeps the timeline a few minutes ahead of now; commits one segment at a time |
| Governor | `src/server/governor.ts` | Nothing gets written when nobody's watching; hard daily budget → reruns |
| Producer | `src/server/producer.ts` | Brief → writer → standards → voice → timed cues. Falls back writer by writer; never airs dead air |
| Writers | `src/server/writers/` | `ClaudeWriter` (structured outputs, cached bibles, Haiku for standard / Sonnet for premium) and `ImprovWriter` (free, deterministic) |
| Standards | `src/server/standards.ts` | Deterministic checks on every script (cast, stage directions, repeats, blocklist, continuity) + Claude review on premium shows |
| Memory | `src/server/memory.ts` | Memories (importance × recency decay), relationship scores (capped swings), serialized plot state |
| TTS | `src/server/tts.ts` | macOS `say` per-character voices → mp3 + mouth envelope from real audio loudness |
| Timeline | `src/server/timeline.ts` | One append-only, non-overlapping timeline in SQLite |
| Player | `src/web/` | Canvas renderer (procedural pixel characters, sets, lower thirds, captions), NTP-style clock sync, Web Audio scheduling |

## Safety rails

- `npm run check` — typecheck + tests, including **shadow runs**: a whole simulated day through the real
  pipeline on a fake clock, asserting no overlaps, nothing off-schedule, no dead air, no production while idle.
- `npm run shadow -- 24` — the same, as a report.
- `npm run rehearse` — a full copy of the station 9 hours in the future (port 8089, separate data dir), e.g. to
  watch tonight's late show this afternoon. `OFFSET=<minutes>` to pick a different time.
- Extra blocklist patterns: `data/standards.json` → `{ "blocklist": ["regex", ...] }`.

## Configuration (env)

| Var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables the Claude writers' room and standards review |
| `MODEL_STANDARD` / `MODEL_PREMIUM` | `claude-haiku-4-5` / `claude-sonnet-5-5` | Per-tier writer models |
| `DAILY_BUDGET_USD` | `3` | Past this, the network airs encores |
| `LEAD_TARGET_SEC` | `150` | How far ahead to keep written while watched |
| `IDLE_GRACE_SEC` | `120` | Keep producing this long after the last viewer leaves |
| `TTS` | `say` on macOS | `say` or `silent` |
| `WRITER` | `auto` | `auto`, `claude`, `improv` |
| `STATION_TZ` | system | Time zone of the schedule grid |
| `NETWORK_NAME` | `Channel 8-Bit` | |

## Roadmap

1. **Restream** — headless Chromium capturing the player → ffmpeg → RTMP (YouTube/Twitch).
2. **Better voices** — Kokoro running locally behind the `TTSEngine` interface; phoneme-level visemes.
3. **Music** — invented bands performing real tracks: vocal-stem mouth mapping, beat-synced instruments.
4. **Show formats** — game show with live audience voting, cooking show, call-in show reading viewer chat.
5. **Character agency** — moods that persist across shows, walk-offs that carry into the next segment,
   guests who hold grudges against hosts.
6. **Ops dashboard** — spend, standards log, what each writer produced, plot state per show.
