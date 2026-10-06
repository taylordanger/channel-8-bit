# Channel 8-Bit: where things stand

*Last updated: Sunday Oct 4, 2026, late afternoon (day two). Everything below is pushed to GitHub:
https://github.com/taylordanger/channel-8-bit*

---

## ☀️ Start here tomorrow

1. **Is it still on the air?** Open http://localhost:8088. If nothing loads:
   ```bash
   cd ~/ai_network && npm run onair
   ```
   The public address appears in that terminal (search for `trycloudflare.com`). It's new each time you start `onair`.
   After code changes, use `npm run reload` instead: it restarts just the station and **keeps the same address**.
2. **Check how the day went:** http://localhost:8088/ops.html (the control room): airtime mix, writer speed, audience stats
   (who pressed play, how long they stayed, which shows they left during), clips, moderation.
3. **Approve anything waiting** on the assignment desk (http://localhost:8088/desk.html): shoutout requests and any viewer
   mail the moderator couldn't check.
4. **Before you start, check:** **Low Power Mode is off** (System Settings → Battery) and the Mac is plugged in. The local AI
   writer is 3–4× slower in Low Power Mode, and slower when Chrome and other heavy apps are busy.

---

## ✅ Your to-do list (things only you can do)

| # | Task | Why | How |
|---|------|-----|-----|
| 1 | **Sign up for Amazon Associates** | Get paid when people buy from the commercials | affiliate-program.amazon.com → sign up → copy your tracking ID (like `channel8bit-20`) → add `AMAZON_TAG=channel8bit-20` to `~/ai_network/.env` → restart. For the "website" field, list your Twitch/YouTube channel or the GitHub page, not the trycloudflare address (it keeps changing). **Needs 3 sales within 180 days.** |
| 2 | **Add products to sell** | Commercials only air once the shelf has something on it | http://localhost:8088/desk.html → Commercials → paste an Amazon link + a name + a few true facts. Funny small objects work best. |
| 3 | **Stream to Twitch** | Reach people beyond the website | Twitch → Creator Dashboard → Settings → Stream → copy **Primary Stream key** → add `STREAM_URL=rtmp://live.twitch.tv/app/YOUR_KEY` to `.env` → run `RESTREAM=1 npm run onair`. Needs about 5 Mbps of upload. Keep the key secret. Also add `TWITCH_CHANNEL=yourchannel` so your Twitch chat shows up on the network. |
| 4 | **Add your songs** | Bands perform your real tracks | Drop files into `~/ai_network/data/music/<band>/` (`glimmer`, `rusty_spurs`, `sewer_rats`, `interference`). For exact lip-sync, add the vocals-only track as `Song Name.vocals.mp3`. Picked up within 5 minutes. ⚠️ Suno free-plan songs generally can't be used commercially, and a monetized stream counts. |
| 5 | **(Optional) Start at login** | Survive reboots without opening a terminal | Stop the running copy (Ctrl+C), then `./scripts/install-launch-agent.sh`. |
| 6 | **(Optional) Buy a domain** (~$10/yr) | A permanent address instead of a random one; Amazon prefers one | Buy one (Cloudflare Registrar is at cost), then ask Claude to set up a named tunnel. |
| 7 | **(Optional) Charge for shoutouts** | Earn from personalized videos | Create a payment link yourself (e.g. Stripe Payment Links: stripe.com → Payment Links → New, price ~$15) → add `SHOUTOUT_PAYMENT_URL=...` and `SHOUTOUT_PRICE=$15` to `.env` → restart. Approve requests on the desk once they've paid. |
| 8 | **(Optional) Claude API key** | Much funnier writing (the local model tops out at "mildly amusing") | Add `ANTHROPIC_API_KEY=...` and `DAILY_BUDGET_USD=1` to `.env`. The budget cap switches to reruns once it's spent. |

---

## 🧭 Ideas for the next session with Claude

- **Set up the permanent address** once you have a domain (a named Cloudflare tunnel).
- **Post some clips:** control room → CLIP IT on a scene viewers laughed at → download the vertical version for TikTok/Shorts/Reels.
- **Watch the audience stats** for a few days, then decide what to grow (which shows people stay for, which they leave).
- **Switch on a payment link for shoutouts** if people request them.

---

## 📺 What Channel 8-Bit is now

A 24/7 pixel-art TV network, written by AI, voiced by AI, and the same broadcast for everyone watching.

**The schedule** (Pacific time)

| Time | Show |
|------|------|
| 12–2am | **The Late Byte with Rex Volta**: late-night talk show, house band, guests, musical acts, viewer mail |
| 2–4am | Much Ado About Nada (encores) |
| 4–6am | The Pixelsons (encores) |
| 6–10am | **Rise & Pixel**: morning show (Sunny, grumpy Greg, intern Pip), viewer call-ins |
| 10am–12pm | **Pixel Heights**: soap opera with weekly seasons (a question asked Monday, answered Sunday) |
| 12–1pm | **Ask Dr. Dot**: call-in advice; other shows' characters call in, plus viewer letters |
| 1–2pm | **Hot Seat**: a game show where viewers vote on every round |
| 2–4pm | **Couch Co-op**: three friends in a 90s basement talking old games |
| 4–5pm | **Kitchen Nightmode**: Chef Remy sets everything on fire, Pepper saves it, a guest tastes it |
| 5–6pm | **Pixel Heights** |
| 6–7pm | **The 8-Bit Report**: news parody; reads your assignment-desk links, otherwise reports on the network itself |
| 7–8pm | **The Pixelsons**: animated-style family sitcom, couch gags |
| 8–9pm | **Much Ado About Nada**: a sitcom about nothing, laugh track, slap bass |
| 9–10pm | **Hot Seat**: the nightly flagship; last place gets booked on The Late Byte |
| 10pm–12am | **The Late Byte with Rex Volta** |

Commercials (Vance Dazzle infomercials) air about every 10 minutes once there are products on the shelf.

**Pages**

| Page | Who | What |
|------|-----|------|
| http://localhost:8088 | Everyone | The broadcast, live chat, voting, "that was funny", write-in box, program guide, "your votes did this" |
| http://localhost:8088/shoutout.html | Everyone | Request a personalized video for a friend; private pickup link |
| http://localhost:8088/drama.html | Everyone | Moods, feuds, tonight's episode, this week's season question, what the characters remember |
| http://localhost:8088/lineup.html | Everyone | Cast lineup; `?set=diner&ids=jerome,lenny` previews any set |
| http://localhost:8088/desk.html | **Only this Mac** | Assignment desk (topics, links), special programming, musical guests, viewer mail, shoutout approvals, product shelf |
| http://localhost:8088/ops.html | **Only this Mac** | Control room: stats, audience, writer health, clips (16:9 + vertical), star/retire encores, moderation, spend, ad clicks |

**Commands**

```bash
npm run onair                  # everything: Ollama + station + public tunnel + keep-awake (Ctrl+C stops it all)
npm run reload                 # restart just the station with new code; the public address stays the same
RESTREAM=1 npm run onair       # ...and stream to Twitch/YouTube (needs STREAM_URL in .env)
npm start                      # just the station, local only
npm run check                  # all the tests
npm run shadow -- 24           # simulate a whole day in seconds and check for problems
```

**Settings live in `~/ai_network/.env`** (private, never uploaded): `PUBLIC_URL=auto`, plus, when you add them,
`AMAZON_TAG`, `STREAM_URL`, `TWITCH_CHANNEL`, `SHOUTOUT_PAYMENT_URL`, `SHOUTOUT_PRICE`, `FEED_FRESH_HOURS`, `AD_EVERY_MIN`,
`ANTHROPIC_API_KEY`, `DAILY_BUDGET_USD`. Every one is explained in `.env.example`.

---

## 🛠 What we built (in order; day one was items 1–19, day two the rest)

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
30. **Weekly seasons for Pixel Heights:** on Monday the writer plans the week around one question viewers want answered, with a development for each day and the answer in Sunday's finale. Each episode plan gets that day's development; the answer stays hidden until Sunday. The Drama board shows "THIS WEEK · DAY N OF 7". A season only starts Monday to Thursday (a Sunday start would reveal its answer at once), so the first one begins Monday.
31. **Twitch chat on the network:** set `TWITCH_CHANNEL=yourchannel` in `.env` and restart. Your Twitch chat then shows in the website chat, labeled TWITCH and moderated like everything else, and the cast can react to it. No key or password is needed to read chat. At most 6 Twitch messages a minute are relayed, so moderation doesn't crowd out the writer.
32. **A new show, The 8-Bit Report (6–7 PM):** a news parody with anchor Lance Headline (total gravitas, no understanding), co-anchor Paige Turner (fact-checks him live) and field reporter Wren Locke (always live from the wrong place). Links you paste on the assignment desk become its top stories, fact-checked against the article. Otherwise it covers the network itself: today's Hot Seat results, walk-offs and feuds, never real news. It has a new news-desk set with a headline crawl, and new voices. Pixel Heights' evening slot is now 5–6 PM; it still airs 3 hours a day.
33. **A new show, Ask Dr. Dot (12–1 PM):** a call-in advice show. Dr. Delphine Dot (a doctorate in "Advanced Feelings" from an online university that is now a car wash) gives confident, specific, useless advice. Murray, the call screener, eats lunch on air. Characters from the other shows call in about problems from their own storylines, and viewer letters get the same treatment. It has a radio-booth set. Much Ado About Nada keeps 8 PM and the overnight encores.
34. **Kinder handling of serious letters:** a letter describing a real crisis (self-harm, abuse, danger, a medical emergency) never airs, and the sender sees a kind message pointing to real help (988 in the US; 911 or the local emergency number if someone is in danger). Tested on the real model: 6 of 6 sample letters were handled correctly.
35. **`npm run reload`:** restarts only the station with new code while `npm run onair` keeps running. The tunnel and the public address stay the same, viewers reconnect by themselves, and open pages refresh when the player code changed.
36. **Vertical clips for TikTok / Shorts / Reels:** every clip now also comes as a 1080×1920 version: the whole scene, captions included, over a blurred copy of itself. In the control room, each ready clip has DOWNLOAD 16:9 and VERTICAL 9:16. The vertical copy takes about 20 seconds after the clip finishes.
37. **Less repetitive writing:** reading today's real scenes showed Pixel Heights re-staging the same confrontation scene after scene, with the same stock lines ("don't play dumb", "I have proof"). Now:
    - The writer sees what this episode has already aired and must add something new: a fact, a decision, or a reversal.
    - The station finds phrases repeated across recent scenes and bans them. Catchphrases, story nouns and everyday speech are exempt.
    - Because the small model ignores "never say X", sentences using a banned phrase are trimmed before air.
    - Titles must be specific, not just the scene type.
38. **Personalized shoutouts** (the review's top idea for earning money):
    - A viewer requests a short video for a friend at `/shoutout.html` (linked from the main page): a first name, the occasion, one fun detail, and which cast.
    - It's screened like mail, then **you approve it** on the assignment desk.
    - The cast writes and records a private scene. It never airs and changes nobody's memories.
    - The requester downloads widescreen and vertical videos from their own private link. No email or account is needed, and files have unguessable names.
    - Free by default. To charge, create a payment link yourself (for example a Stripe Payment Link) and add `SHOUTOUT_PAYMENT_URL` and `SHOUTOUT_PRICE` to `.env`; the form then shows it, and you approve requests once paid.
39. **A new show, Kitchen Nightmode (4–5 PM):** Chef Remy Burns (supremely confident, sets every dish on fire, "that's what we call a flavor event") and Pepper Mills (the one who can actually cook, and keeps a fire extinguisher named Gerald handy). A guest from another show tastes the result, and viewer recipes are read on air. The recipes are absurd and fictional, never real cooking or food-safety advice. It has a new kitchen set. Couch Co-op is now 2–4 PM.
40. **Quality pass across the shows** (from reading a day and a half of real scenes):
    - **Topic rotation:** each scene picks a topic seed the show hasn't used in its last few scenes (The Late Byte kept doing the broken applause sign).
    - **Stage directions read aloud are cut** ("enter, walking back into the set with a sheepish grin").
    - **No goodbyes mid-show:** on shows that talk to the audience, "that's all the time we have" only survives in a show's final minutes.
    - **No telling the same joke twice in one scene:** a line that mostly repeats an earlier one is cut (Jerome said the marble-rye line three times).
    - These apply to scenes the AI writes; the improv troupe's stock bits are exempt. On 1,415 real lines, the rules flagged 2 stage directions, a handful of mid-show goodbyes, and 18 repeated lines; two false alarms found that way were fixed.
41. **Real news on The 8-Bit Report:** light stories (odd news, science, space) from public feeds: ScienceDaily's Strange & Offbeat, UPI Odd News, NASA, Phys.org.
    - Each story passes a word filter, then the local model screens out tragedy, crime, politics, health claims and controversy.
    - Stories that pass become top stories, fact-checked against the article (or the feed's summary when a site blocks the article).
    - At most 6 a day. They're labeled "FROM THE NEWS FEEDS" on the desk. Set `NEWS_FEEDS=off` to stop.
42. **Fixes for sourced stories** (found by watching the first real ones):
    - The improv troupe no longer uses up a story it can't read.
    - The name check no longer mistakes "Lance. Don't" for a person, and the "8" in "8-Bit" isn't a number claim.
    - Story scenes skip the episode plan so the article is the scene's job.
    - The fact-checker leaves the cast's own antics alone.
43. **Storm Brewster, the 8-Bit Report's weatherman:** a weather segment with Storm and Lance at a new weather-map set. Forecasts are for Pixel City, the network's fictional hometown ("an eighty percent chance of Rex complaining"), never real weather.
44. **Always-on hours for the flagship:** from 9 PM to midnight the station writes fresh scenes even with nobody watching, so the advertised Hot Seat → Late Byte handoff always happens and joins the encore library. With nobody waiting, it doesn't fill with instant encores or improv. It's the free local writer, so there's no cost. With a Claude key it defaults to off. Set `ALWAYS_ON_HOURS` in `.env` to change the hours.

---

## ⚠️ Known issues / things to watch

- **Encores still fill part of the day.** On this Mac the local model writes about 6–8 tokens per second. With the compact
  format a scene now takes roughly as long to write as to air (about 40–55 seconds), but slow moments, new shows and
  busy Macs still fall back to encores and improv. No dead air, just repeats. Claude, or a Mac with more memory, fixes this.
- **The local model mixes up who says what** now and then (a character using someone else's catchphrase, or calling the
  wrong person "Mother"). The checks catch copied, repeated and clichéd lines, but this one can't be fixed safely by rules.
- **The public address changes when `onair` restarts** (not on `npm run reload`). A domain fixes this for good.
- **The quick tunnel has no uptime guarantee.** Fine for testing with friends.
- **Amazon often blocks reading product pages.** Add a name and facts yourself when adding products.
- **The Mac must stay on, plugged in, and out of Low Power Mode** while the network runs.
