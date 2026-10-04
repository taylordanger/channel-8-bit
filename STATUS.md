# Channel 8-Bit: where things stand

*Last updated: Sunday Oct 4, 2026 (end of day one). Everything below is pushed to GitHub:
https://github.com/taylordanger/channel-8-bit*

---

## ☀️ Start here tomorrow

1. **Is it still on the air?** Open http://localhost:8088. If nothing loads:
   ```bash
   cd ~/ai_network && npm run onair
   ```
   The public address appears in that terminal (search for `trycloudflare.com`). It's **new every restart**.
2. **Check how the night went:** http://localhost:8088/ops.html (the control room): dead air, how much of the airtime was
   fresh writing, writer failures, chat and mail moderation.
3. **Before you start, check:** **Low Power Mode is off** (System Settings → Battery) and the Mac is plugged in. The local AI
   writer is 3–4× slower in Low Power Mode.

---

## ✅ Your to-do list (things only you can do)

| # | Task | Why | How |
|---|------|-----|-----|
| 1 | **Sign up for Amazon Associates** | Get paid when people buy from the commercials | affiliate-program.amazon.com → sign up → copy your tracking ID (like `channel8bit-20`) → add `AMAZON_TAG=channel8bit-20` to `~/ai_network/.env` → restart. For the "website" field, list your Twitch/YouTube channel or the GitHub page, not the trycloudflare address (it keeps changing). **Needs 3 sales within 180 days.** |
| 2 | **Add products to sell** | Commercials only air once the shelf has something on it | http://localhost:8088/desk.html → Commercials → paste an Amazon link + a name + a few true facts. Funny small objects work best. |
| 3 | **Stream to Twitch** | Reach people beyond the website | Twitch → Creator Dashboard → Settings → Stream → copy **Primary Stream key** → add `STREAM_URL=rtmp://live.twitch.tv/app/YOUR_KEY` to `.env` → run `RESTREAM=1 npm run onair`. Needs about 5 Mbps of upload. Keep the key secret. |
| 4 | **Add your songs** | Bands perform your real tracks | Drop files into `~/ai_network/data/music/<band>/` (`glimmer`, `rusty_spurs`, `sewer_rats`, `interference`). For exact lip-sync, add the vocals-only track as `Song Name.vocals.mp3`. Picked up within 5 minutes. ⚠️ Suno free-plan songs generally can't be used commercially, and a monetized stream counts. |
| 5 | **(Optional) Start at login** | Survive reboots without opening a terminal | Stop the running copy (Ctrl+C), then `./scripts/install-launch-agent.sh`. |
| 6 | **(Optional) Buy a domain** (~$10/yr) | A permanent address instead of a random one; Amazon prefers one | Buy one (Cloudflare Registrar is at cost), then ask Claude to set up a named tunnel. |
| 7 | **(Optional) Claude API key** | Much funnier writing (the local model tops out at "mildly amusing") | Add `ANTHROPIC_API_KEY=...` and `DAILY_BUDGET_USD=1` to `.env`. The budget cap switches to reruns once it's spent. |

---

## 🧭 Ideas for the next session with Claude

- **Twitch chat on the network:** show Twitch messages in the website chat, and let the cast react to them.
- **Set up the permanent address** once you have a domain (named Cloudflare tunnel).
- **Raise the share of fresh airtime:** it was low today (lots of encores) because the local model needs about 2 minutes per
  scene. Options: smarter scheduling, shorter scenes, or Claude.
- **More shows:** a cooking show, a call-in advice show, a news-parody desk that reads assignment-desk links.
- **Weekly "season" arcs:** Pixel Heights plot twists that build across the week.

---

## 📺 What Channel 8-Bit is now

A 24/7 pixel-art TV network, written by AI, voiced by AI, and the same broadcast for everyone watching.

**The schedule** (Pacific time)

| Time | Show |
|------|------|
| 12–2am, 10pm–12am | **The Late Byte with Rex Volta**: late-night talk show, house band, guests, musical acts, viewer mail |
| 2–4am | Much Ado About Nada (encores) |
| 4–6am | The Pixelsons (encores) |
| 6–10am | **Rise & Pixel**: morning show (Sunny, grumpy Greg, intern Pip), viewer call-ins |
| 10am–12pm, 5–7pm | **Pixel Heights**: an ongoing soap opera with a plot that carries forward |
| 12–1pm, 8–9pm | **Much Ado About Nada**: a sitcom about nothing, laugh track, slap bass |
| 1–2pm, 9–10pm | **Hot Seat**: a game show where viewers vote on every round |
| 2–5pm | **Couch Co-op**: three friends in a 90s basement talking old games |
| 7–8pm | **The Pixelsons**: animated-style family sitcom, couch gags |

Commercials (Vance Dazzle infomercials) air about every 10 minutes once there are products on the shelf.

**Pages**

| Page | Who | What |
|------|-----|------|
| http://localhost:8088 | Everyone | The broadcast, live chat, voting, write-in box, program guide |
| http://localhost:8088/drama.html | Everyone | Moods, feuds, who stormed off, what the characters remember |
| http://localhost:8088/lineup.html | Everyone | Cast lineup; `?set=diner&ids=jerome,lenny` previews any set |
| http://localhost:8088/desk.html | **Only this Mac** | Assignment desk (topics, links), special programming (air any show now), musical guests, viewer mail approval, product shelf |
| http://localhost:8088/ops.html | **Only this Mac** | Control room: stats, writer health, moderation, spend, ad clicks, chat delete/mute |

**Commands**

```bash
npm run onair                  # everything: Ollama + station + public tunnel + keep-awake (Ctrl+C stops it all)
RESTREAM=1 npm run onair       # ...and stream to Twitch/YouTube (needs STREAM_URL in .env)
npm start                      # just the station, local only
npm run check                  # all the tests
npm run shadow -- 24           # simulate a whole day in seconds and check for problems
```

**Settings live in `~/ai_network/.env`** (private, never uploaded): `PUBLIC_URL=auto`, plus `AMAZON_TAG`, `STREAM_URL`,
`AD_EVERY_MIN`, `ANTHROPIC_API_KEY`, `DAILY_BUDGET_USD` when you add them. See `.env.example`.

---

## 🛠 What we built today (in order)

1. **The core network:** one shared timeline everyone watches in sync, a schedule, writers, a standards desk, character memory and relationships, a budget governor (nothing gets written when nobody's watching), a shadow station that simulates whole days, and a rehearsal mode.
2. **A nicer look:** chibi characters with outlines, distinct looks for everyone, signature lines, camera cuts between shots, CRT scanlines.
3. **Assignment desk:** feed the cast topics or links to real articles (with fact-checking against the article).
4. **Special programming:** put any show on now, with cut-in.
5. **Local AI writer** (llama3.1:8b via Ollama): free and offline. Tested qwen3:8b; it wasn't better, so I deleted it.
6. **Sitcoms:** Much Ado About Nada and The Pixelsons, with new sets, a laugh track and stings.
7. **Live streaming tool** to YouTube or Twitch, built in (`npm run restream`).
8. **Kokoro voices:** natural-sounding local voices for every character.
9. **Comedy upgrades:** comedy-craft instructions and an example scene per show.
10. **Reliability:** a dead-air watchdog, fixed pacing (including an encore deadlock), a writer timeout and cooldown, crash logging.
11. **Music:** invented bands (Glimmer, The Rusty Spurs, The Sewer Rats, The Interference) performing live-generated songs; the drummer waits for the drums. Then **your own tracks** with beat and vocal analysis.
12. **Characters with consequences:** lasting moods, walk-offs (at most one an hour), feuds; the Drama board.
13. **Hot Seat game show:** contestants from other shows, viewer voting, the champion's win and losers' grudges remembered.
14. **Viewer mail:** viewers write in, it's moderated, and the cast answers on air.
15. **Control room:** the operator dashboard.
16. **Live chat:** between viewers, moderated, delete and mute; the cast can react to it.
17. **Going public:** a security fix first (admin locked to this Mac, tunnel, rebinding and cross-site protection), then the Cloudflare quick tunnel.
18. **Commercials:** Amazon affiliate infomercials, no prices, with disclosures and click tracking.
19. **`npm run onair`:** one command for everything; the public address updates itself.

**Day two** (after an outside review of the project):

20. **Spending fixes:** the 1-hour prompt cache is counted at its real price, and the daily budget is a hard ceiling checked before every paid call. The Twitch restream no longer counts as a viewer; with nobody on the website it airs reruns, except during `FEED_FRESH_HOURS`.
21. **Episode plans:** before a show's first scene, the writer plans the airing: what each character wants, a conflict, three escalations, a payoff, and a thread left open for next time. Pixel Heights also tracks secrets (who's hiding what, who knows). Scenes only see their own part of the plan. The Drama board shows the episode on now.
22. **Hot Seat losers face Rex:** whoever comes last on the 9pm Hot Seat is booked as The Late Byte's guest at 10pm.
23. **"Your votes did this":** a panel on the broadcast page listing recent verdicts, champions, bookings and answered mail. People who write in can see their place in line and when their letter can air.
24. **Clips:** in the control room, pick a scene → "CLIP IT" → an MP4 with captions, rendered in real time. Viewers have a "😂 THAT WAS FUNNY" button, and the funniest scenes rise to the top of the list. Each clip gets a `?ref=clip-N` link to post with it.
25. **Audience stats** in the control room: visits, who pressed play, median watch time, returning viewers, which shows people leave during, votes/mail/laughs per viewer, and visits from clip links. Your own Mac isn't counted, and no IP addresses are stored.
26. **A curated encore archive:** in the control room's scene list, ☆ STAR puts a scene into rotation more often, and RETIRE keeps a dud off the air for good. Scenes viewers tapped "that was funny" on also come back sooner. Nothing loops, because the freshness window still applies.
27. **Commercials are reused:** each product keeps up to 3 finished ads and rotates them, so a break doesn't wait on the local AI. If a listing is re-read with new facts, fresh ads get written.
28. **The nightly flagship is promoted:** a banner on the broadcast page ("TONIGHT 9:00 PM: Hot Seat… then the loser has to face Rex") shows the start in each viewer's own time. Station breaks in the hours before it say "Tonight 9 PM PDT: Hot Seat - the loser faces Rex".
29. **The local writer writes a compact format:** I measured it first. On this Mac the model writes only about 6–8 tokens per second, and most of what it wrote was JSON labels, not dialogue (863 tokens for about 160 tokens of speech). Lines are now short tuples, the bookkeeping is trimmed, and the story notes are rewritten only at an episode's setup and payoff. Result: about 30–40% more airtime per second of model time, with roughly half the output per scene.

---

## ⚠️ Known issues / things to watch

- **Fresh writing is a small share of airtime.** On this Mac the local model writes about 6–8 tokens per second (it's slower when Chrome and other apps are busy and memory is swapping), so even with the compact format a scene takes longer to write than to air. Encores fill the gaps: no dead air, just repeats. Closing heavy apps helps a little; Claude or a Mac with more memory helps a lot.
- **The public address changes every time the tunnel restarts.** The station follows it automatically, but people need the new link. A domain fixes this.
- **The quick tunnel has no uptime guarantee.** Fine for testing with friends.
- **Amazon often blocks reading product pages.** Add a name and facts yourself when adding products.
- **The local model sometimes repeats itself or gets characters slightly wrong.** The standards checks catch the worst of it.
- **The Mac must stay on, plugged in, and out of Low Power Mode** while the network runs.
