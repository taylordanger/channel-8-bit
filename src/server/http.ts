import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, PollResult, ServerMessage, Segment } from "../shared/types.js";
import type { Built } from "./build.js";
import { CHARACTERS } from "./catalog/characters.js";
import { guideWith, programAt } from "./catalog/schedule.js";
import { SHOWS } from "./catalog/shows.js";
import { ARTISTS } from "./catalog/music.js";
import type { StationConfig } from "./config.js";
import type { Topic } from "./desk.js";
import { assertPublicUrl, URL_PATTERN } from "./sources.js";
import { senderId } from "./chat.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".css": "text/css; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
};

/** Serve a file from root, refusing anything that escapes it. */
function serveFile(res: http.ServerResponse, root: string, rel: string, cache: string) {
  const file = path.resolve(root, "." + path.posix.normalize("/" + rel));
  if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": cache });
  fs.createReadStream(file).pipe(res);
}

const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

/** The assignment desk changes what airs, so only this machine may edit it. */
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
/** Headers a tunnel or reverse proxy adds; their presence means the request came from outside. */
const PROXY_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "forwarded", "x-real-ip", "true-client-ip", "fly-client-ip"];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Admin access: only someone sitting at this machine. A tunnel delivers every visitor from
 * loopback, so a proxy header means "outside". The Host must be a local name (blocks DNS
 * rebinding), and a browser's Origin, if sent, must be a local page (blocks cross-site forms).
 */
export function isLocal(req: http.IncomingMessage): boolean {
  if (!LOOPBACK.includes(req.socket.remoteAddress ?? "")) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  if (!LOCAL_HOST.test(req.headers.host ?? "")) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (!LOCAL_HOST.test(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** The visitor's real address: from the tunnel's header when it's the one delivering the request. */
export function clientIp(req: http.IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "?";
  if (!LOOPBACK.includes(remote)) return remote;
  const forwarded = (req.headers["cf-connecting-ip"] ?? req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"]) as string | undefined;
  return forwarded ? forwarded.split(",")[0].trim() : remote;
}

/** Admin pages are served to this machine only. */
const ADMIN_PAGES = new Set(["/desk.html", "/ops.html"]);

function readJson(req: http.IncomingMessage, limit = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** What the desk page sees: the topic plus a preview of what was read (never the full page). */
function publicTopic(t: Topic) {
  const { source, ...rest } = t;
  return {
    ...rest,
    source: source
      ? { title: source.title, site: source.site, publishedAt: source.publishedAt, description: source.description, preview: source.text.slice(0, 400), chars: source.text.length }
      : null,
  };
}

async function handleTopics(req: http.IncomingMessage, res: http.ServerResponse, url: URL, b: Built) {
  const shows = Object.values(SHOWS).map((s) => ({ id: s.id, title: s.title }));
  if (req.method === "GET") return json(res, { topics: b.desk.list().map(publicTopic), shows });
  if (!isLocal(req)) return json(res, { error: "the assignment desk only accepts changes from this machine" }, 403);
  const [, , , idPart, action] = url.pathname.split("/");
  if (req.method === "POST" && !idPart) {
    let body: { text?: unknown; url?: unknown; showId?: unknown; maxUses?: unknown };
    try {
      body = (await readJson(req)) as typeof body;
    } catch (e) {
      return json(res, { error: (e as Error).message }, 400);
    }
    let text = typeof body.text === "string" ? body.text : "";
    let link = typeof body.url === "string" ? body.url.trim() : "";
    // A link pasted into the topic box counts as the topic's link.
    if (!link) {
      const found = text.match(URL_PATTERN)?.[0];
      if (found) {
        link = found.replace(/[).,;]+$/, "");
        text = text.replace(found, " ");
      }
    }
    const showId = typeof body.showId === "string" && body.showId in SHOWS ? body.showId : null;
    const maxUses = typeof body.maxUses === "number" ? body.maxUses : 2;
    try {
      if (link) await assertPublicUrl(link);
      const topic = b.desk.add(text, showId, maxUses, b.clock.now(), link || null);
      if (topic.url) void b.desk.ingest(topic.id);
      return json(res, publicTopic(topic), 201);
    } catch (e) {
      return json(res, { error: (e as Error).message }, 400);
    }
  }
  const id = Number(idPart);
  if (!Number.isInteger(id)) return json(res, { error: "unsupported" }, 405);
  if (req.method === "POST" && action === "retry") {
    const t = b.desk.get(id);
    if (!t?.url) return json(res, { error: "that topic has no link" }, 400);
    b.db.prepare("UPDATE topics SET fetch_status = 'pending', fetch_error = NULL WHERE id = ?").run(id);
    void b.desk.ingest(id);
    return json(res, publicTopic(b.desk.get(id)!));
  }
  if (req.method === "DELETE") return json(res, { removed: b.desk.remove(id) });
  return json(res, { error: "unsupported" }, 405);
}

/**
 * Viewer mail: anyone can write in (the mailbag cleans, rate-limits and moderates it), but
 * only this machine can see the queue or approve and reject messages.
 */
async function handleMail(req: http.IncomingMessage, res: http.ServerResponse, url: URL, b: Built) {
  const [, , , idPart, action] = url.pathname.split("/");
  if (req.method === "POST" && !idPart) {
    let body: { handle?: unknown; text?: unknown; showId?: unknown };
    try {
      body = (await readJson(req, 2048)) as typeof body;
    } catch (e) {
      return json(res, { error: (e as Error).message }, 400);
    }
    const showId = typeof body.showId === "string" && SHOWS[body.showId]?.mailSegment ? body.showId : null;
    const out = await b.mailbag.submit(String(body.handle ?? ""), String(body.text ?? ""), showId, clientIp(req), b.clock.now());
    if (typeof out === "string") return json(res, { error: out }, out.includes("try again") ? 429 : 400);
    // Senders only learn whether it's in the queue, not the moderator's reasoning.
    return json(res, { status: out.status === "rejected" ? "not accepted" : "received" }, 201);
  }
  if (!isLocal(req)) return json(res, { error: "the mailbag is only visible from this machine" }, 403);
  if (req.method === "GET") return json(res, { messages: b.mailbag.list(), shows: Object.values(SHOWS).filter((sh) => sh.mailSegment).map((sh) => ({ id: sh.id, title: sh.title })) });
  const id = Number(idPart);
  if (req.method === "POST" && Number.isInteger(id) && (action === "approve" || action === "reject"))
    return json(res, { ok: b.mailbag.review(id, action === "approve") });
  return json(res, { error: "unsupported" }, 405);
}

/** Simple per-IP throttle so one viewer can't flood the vote endpoint. */
const voteHits = new Map<string, number[]>();

/** Viewers vote from anywhere - that's the point - but once per poll, and not too fast. */
async function handleVote(req: http.IncomingMessage, res: http.ServerResponse, b: Built, broadcast: (m: ServerMessage) => void) {
  if (req.method !== "POST") return json(res, { error: "unsupported" }, 405);
  const ip = clientIp(req);
  const now = b.clock.now();
  const hits = (voteHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 30) return json(res, { error: "slow down" }, 429);
  voteHits.set(ip, [...hits, now]);
  let body: { pollId?: unknown; option?: unknown; voter?: unknown };
  try {
    body = (await readJson(req, 1024)) as typeof body;
  } catch (e) {
    return json(res, { error: (e as Error).message }, 400);
  }
  const { pollId, option, voter } = body;
  if (typeof pollId !== "string" || typeof option !== "string" || typeof voter !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(voter))
    return json(res, { error: "bad vote" }, 400);
  const outcome = b.polls.vote(pollId, voter, option, now);
  if (outcome !== "ok") return json(res, { error: outcome }, outcome === "already voted" ? 409 : 400);
  const result = b.polls.result(pollId)!;
  broadcast({ type: "poll", result });
  return json(res, result);
}

async function handleMusic(req: http.IncomingMessage, res: http.ServerResponse, b: Built) {
  const artists = Object.values(ARTISTS).map((a) => ({ id: a.id, name: a.name, style: a.style }));
  if (req.method === "GET") return json(res, { artists });
  if (!isLocal(req)) return json(res, { error: "programming changes are only accepted from this machine" }, 403);
  if (req.method !== "POST") return json(res, { error: "unsupported" }, 405);
  let body: { artist?: unknown };
  try {
    body = (await readJson(req)) as typeof body;
  } catch (e) {
    return json(res, { error: (e as Error).message }, 400);
  }
  const artist = typeof body.artist === "string" && body.artist in ARTISTS ? body.artist : undefined;
  const seg = await b.station.playMusic(artist);
  return json(res, { title: seg.title, startAt: seg.startAt, durationMs: seg.durationMs }, 201);
}

async function handleOverride(req: http.IncomingMessage, res: http.ServerResponse, b: Built) {
  if (req.method === "GET") return json(res, { override: b.station.override() });
  if (!isLocal(req)) return json(res, { error: "programming changes are only accepted from this machine" }, 403);
  if (req.method === "DELETE") {
    b.station.endOverride();
    return json(res, { override: null });
  }
  if (req.method === "POST") {
    let body: { showId?: unknown; minutes?: unknown; cutIn?: unknown };
    try {
      body = (await readJson(req)) as typeof body;
    } catch (e) {
      return json(res, { error: (e as Error).message }, 400);
    }
    if (typeof body.showId !== "string" || !(body.showId in SHOWS)) return json(res, { error: "unknown show" }, 400);
    const minutes = typeof body.minutes === "number" ? body.minutes : 60;
    return json(res, { override: b.station.airNow(body.showId, minutes, { cutIn: body.cutIn === true }) }, 201);
  }
  return json(res, { error: "unsupported" }, 405);
}

export function startHttp(config: StationConfig, b: Built, publicDir: string) {
  const mediaDir = path.join(config.dataDir, "media");
  const sockets = new Set<WebSocket>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const now = b.clock.now();
    if (url.pathname === "/api/mail" || url.pathname.startsWith("/api/mail/")) {
      void handleMail(req, res, url, b);
      return;
    }
    if (url.pathname === "/api/chat") return json(res, b.chat.recent());
    if (url.pathname.startsWith("/api/chat/")) {
      if (!isLocal(req)) return json(res, { error: "chat moderation is only available from this machine" }, 403);
      const [, , , idPart, action] = url.pathname.split("/");
      if (idPart === "log") return json(res, b.chat.log());
      const id = Number(idPart);
      if (req.method === "POST" && Number.isInteger(id) && (action === "delete" || action === "mute")) {
        if (action === "mute") b.chat.muteAuthorOf(id, now);
        const removed = b.chat.remove(id, action === "mute" ? "author muted by the operator" : "removed by the operator");
        if (removed) broadcast({ type: "chat-delete", id });
        return json(res, { ok: true });
      }
      return json(res, { error: "unsupported" }, 405);
    }
    if (url.pathname === "/api/vote") {
      void handleVote(req, res, b, broadcast);
      return;
    }
    if (url.pathname === "/api/polls") {
      return json(res, b.polls.active(now).map((p) => ({ ...p, tally: b.polls.tally(p.id) })));
    }
    if (url.pathname === "/api/music") {
      void handleMusic(req, res, b);
      return;
    }
    if (url.pathname === "/api/override") {
      void handleOverride(req, res, b);
      return;
    }
    if (url.pathname === "/api/topics" || url.pathname.startsWith("/api/topics/")) {
      void handleTopics(req, res, url, b);
      return;
    }
    switch (url.pathname) {
      case "/api/now":
        return json(res, { serverNow: now, network: config.networkName, voteUrl: config.publicUrl.replace(/^https?:\/\//, ""), onNow: programAt(now, config.timeZone, b.station.override()), override: b.station.override() });
      case "/api/timeline": {
        const from = Number(url.searchParams.get("from") ?? now - 60_000);
        const to = Math.min(Number(url.searchParams.get("to") ?? now + 600_000), from + 3_600_000);
        return json(res, b.timeline.range(from, to));
      }
      case "/api/cast":
        // Everyone: each show's cast and guests, then the musicians who only appear on stage.
        return json(
          res,
          Object.values(CHARACTERS).map((c) => ({
            id: c.id,
            name: c.name,
            show: Object.values(SHOWS).find((sh) => sh.cast.includes(c.id) || sh.guestPool?.includes(c.id))?.title ?? "Musicians",
            look: c.look,
          })),
        );
      case "/api/drama": {
        // Who feels what about whom, right now - for the Drama page.
        const states = new Map(b.states.all(now).map((x) => [x.id, x]));
        const name = (id: string) => CHARACTERS[id]?.name ?? id;
        return json(res, {
          shows: Object.values(SHOWS).map((show) => {
            const ids = show.cast;
            const pairs = ids.flatMap((a) => ids.filter((x) => x !== a).map((x) => ({ ...b.memory.relationship(a, x), fromName: name(a), toName: name(x) })));
            return {
              id: show.id,
              title: show.title,
              cast: ids.map((id) => {
                const st = states.get(id);
                return {
                  id,
                  name: name(id),
                  mood: st?.mood ?? "neutral",
                  reason: st?.mood !== "neutral" ? st?.reason ?? "" : "",
                  offSet: st?.offShow === show.id && (st?.offRemaining ?? 0) > 0,
                  returning: st?.offShow === show.id && st?.returning,
                };
              }),
              feuds: b.memory.feuds(ids).map((f) => ({ a: name(f.a), b: name(f.b), score: f.score })),
              tensions: [...pairs].sort((x, y) => x.score - y.score).slice(0, 3),
              bonds: [...pairs].sort((x, y) => y.score - x.score).slice(0, 2),
            };
          }),
          memories: b.memory.latest(20).map((m) => ({ text: m.text, about: m.about.map(name), at: m.createdAt, show: SHOWS[m.showId]?.title ?? m.showId })),
        });
      }
      case "/api/ops": {
        if (!isLocal(req)) return json(res, { error: "the operator dashboard is only visible from this machine" }, 403);
        return json(res, {
          ...b.ops.report(now),
          now,
          network: config.networkName,
          viewers: b.governor.viewerCount,
          leadMs: Math.max(0, b.timeline.tailEnd() - now),
          decision: b.governor.decide(now),
          spentTodayUsd: b.governor.spentToday(now),
          dailyBudgetUsd: config.dailyBudgetUsd,
          writerChain: b.writers.map((w) => w.name),
          model: config.writer === "local" ? config.ollama.model : config.writer === "claude" ? `${config.models.standard} / ${config.models.premium}` : "improv",
          tts: b.tts.name,
          onNow: programAt(now, config.timeZone, b.station.override()).title,
        });
      }
      case "/api/guide":
        return json(res, guideWith(now, 24, config.timeZone, b.station.override()));
      case "/api/status": {
        const decision = b.governor.decide(now);
        return json(res, {
          network: config.networkName,
          viewers: b.governor.viewerCount,
          leadMs: Math.max(0, b.timeline.tailEnd() - now),
          decision,
          spentTodayUsd: b.governor.spentToday(now),
          dailyBudgetUsd: config.dailyBudgetUsd,
          writers: b.writers.map((w) => w.name),
          tts: b.tts.name,
          lastError: b.station.lastError,
        });
      }
    }
    if (ADMIN_PAGES.has(url.pathname) && !isLocal(req)) {
      res.writeHead(404).end("not found");
      return;
    }
    if (url.pathname.startsWith("/media/")) return serveFile(res, mediaDir, url.pathname.slice(7), "public, max-age=31536000, immutable");
    return serveFile(res, publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1), "no-cache");
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const send = (ws: WebSocket, m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const broadcast = (m: ServerMessage) => sockets.forEach((ws) => send(ws, m));
  const updateViewers = () => {
    b.governor.setViewers(sockets.size, b.clock.now());
    broadcast({ type: "viewers", count: sockets.size });
  };

  wss.on("connection", (ws, req) => {
    const sender = senderId(clientIp(req));
    sockets.add(ws);
    send(ws, { type: "hello", serverNow: b.clock.now(), network: config.networkName });
    updateViewers();
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "ping" && typeof msg.c === "number") send(ws, { type: "pong", c: msg.c, s: b.clock.now() });
      if (msg.type === "chat" && typeof msg.text === "string") {
        const out = b.chat.post(String(msg.handle ?? ""), msg.text, sender, b.clock.now());
        if (out.kind === "error") return send(ws, { type: "chat-error", error: out.error });
        if (out.kind === "shadow") return send(ws, { type: "chat", message: out.message }); // muted: only they see it
        broadcast({ type: "chat", message: out.message });
        void b.chat.review(out.message).then((removed) => removed && broadcast({ type: "chat-delete", id: out.message.id }));
      }
    });
    ws.on("close", () => {
      sockets.delete(ws);
      updateViewers();
    });
  });

  server.listen(config.port);
  return {
    server,
    pushSegment: (segment: Segment) => broadcast({ type: "segment", segment }),
    retract: (ids: string[]) => broadcast({ type: "retract", ids }),
    pollResult: (r: PollResult) => broadcast({ type: "poll", result: r }),
    close: () => {
      wss.close();
      server.close();
    },
  };
}
