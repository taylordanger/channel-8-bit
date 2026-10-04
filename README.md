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

## Giving the cast things to talk about

Open **/desk.html** (the assignment desk). Add an idea, a link, or both, and pick a show or "any show".

- **Ideas** ("Greg finds out he's been replaced by a weather app") become the segment's topic.
- **Links** are read by the station (headline, site, date, article text). The cast discusses the real story;
  every factual claim must come from the article. Sourced segments go through:
  1. the deterministic standards desk (with real-world topics allowed, since there's a source),
  2. a number check: every number spoken on air must appear in the article,
  3. a Claude standards review (defamation, harassment, advice),
  4. a Claude fact-check of every line against the article - unsupported claims are rewritten or cut.
- Page text is treated as untrusted data, never instructions. Only public http(s) pages are read (no local
  network, every redirect re-checked, 3 MB / 12 s limits). Desk changes are only accepted from this machine.
- Without an API key, the improv troupe can only use a link's headline.

The cast lineup (**/lineup.html**, `?ids=rex,glimmer` for close-ups) shows every character's look.

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

## Going live on YouTube / Twitch

1. `cp .env.example .env` and set `STREAM_URL` to your platform's RTMP URL + stream key
   (YouTube Studio → Go live → Stream; Twitch → Creator Dashboard → Settings → Stream).
2. With the station running (`npm start`), in a second terminal: `npm run restream`.

The restreamer opens `/broadcast.html` in a hidden Chrome; the page records its own canvas and audio mix
and streams it to ffmpeg, which encodes H.264 (hardware) + AAC at 1280x720/30 and pushes RTMP. It runs as a
separate process (a streaming failure never touches the station), reconnects if the ingest drops, relaunches
the feed if it stalls, and never prints the stream key. `npm run restream -- --out test.mp4 --seconds 30`
records to a file instead. While streaming, the feed counts as a viewer, so the station writes around the clock.

## Going public (website)

A free Cloudflare quick tunnel gives the station a public address (random, changes on restart):

    brew install cloudflared
    cloudflared tunnel --url http://localhost:8088

Put the address in `.env` as `PUBLIC_URL` so polls and the stream show it. Visitors can watch, chat, vote and
write in; admin pages (desk, control room) and admin APIs only answer requests made on this machine - anything
arriving through a tunnel or proxy is treated as an outside visitor. For a permanent address, use a named tunnel
with a free Cloudflare account and your own domain.

## Roadmap

1. ~~**Restream**~~ — done (see above).
2. **Better voices** — Kokoro running locally behind the `TTSEngine` interface; phoneme-level visemes.
3. ~~**Music**~~ — done: invented bands (Glimmer, The Rusty Spurs, The Sewer Rats, house band The Interference)
   perform original chiptune songs generated from a seed, identically in every viewer's browser; the band animates to
   the beat and the drummer waits for the drums to come in. Desk: "play a song now". Next: your own tracks (e.g. Suno).
4. ~~**Game show with viewer voting**~~ — done: *Hot Seat* (1pm, 9pm). Contestants are drafted from other shows;
   viewers vote on every round from the website (`/api/vote`, one vote each), verdicts feed the next round, the
   final counts double, and the champion's win and the losers' grudges go into memory, moods and relationships.
   Set `PUBLIC_URL` to show a vote address on the stream.
5. ~~**Viewer mail**~~ — done: viewers write in from the main page; links/emails/phone numbers are stripped, senders
   are rate-limited, the local model moderates (or it waits for review on the desk), and the cast answers approved
   mail in "viewer mail" segments of The Late Byte, Rise & Pixel and Couch Co-op.
5. ~~**Character agency**~~ — done: lasting moods (cross-show, fade after hours), walk-offs that keep a regular off
   the set for the next scenes and earn them an entrance, feuds the writers must escalate or resolve; `/drama.html`.
6. ~~**Control room**~~ — done: `/ops.html` (this machine only): viewers, lead, airtime mix (fresh / music / encores /
   improv / cards), dead air while watched, writer success and timing, standards cuts, mail moderation, spend, chat
   moderation (delete / mute 24h).
7. ~~**Live chat**~~ — done: viewers chat beside the TV; blocklist + rate limits before posting, background moderation
   by the local model, operator delete/mute (muted viewers only see their own messages).
