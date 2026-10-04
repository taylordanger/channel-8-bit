import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, PollResult, ServerMessage, Segment } from "../shared/types.js";
import type { Built } from "./build.js";
import { CHARACTERS } from "./catalog/characters.js";
import { flagshipAt, guideWith, programAt } from "./catalog/schedule.js";
import { SHOWS } from "./catalog/shows.js";
import { ARTISTS } from "./catalog/music.js";
import type { StationConfig } from "./config.js";
import type { Topic } from "./desk.js";
import { assertPublicUrl, URL_PATTERN } from "./sources.js";
import { senderId } from "./chat.js";
import { affiliateLink } from "./products.js";
import { phaseAt, weekOf } from "./episodes.js";
import { impactFeed, mailStatus } from "./impact.js";
import { TwitchChat } from "./twitch.js";
import { OCCASIONS, SHOUTOUT_CASTS, type Shoutout } from "./shoutouts.js";

const TYPES: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".css": "text/css; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".mp4": "video/mp4",
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
/** The commercial shelf - this machine only. */
async function handleProducts(req: http.IncomingMessage, res: http.ServerResponse, url: URL, b: Built) {
  if (!isLocal(req)) return json(res, { error: "the product shelf is only available from this machine" }, 403);
  const now = b.clock.now();
  const [, , , idPart, action] = url.pathname.split("/");
  if (req.method === "GET") return json(res, { products: b.products.list().map(({ source, ...p }) => ({ ...p, readTitle: source?.title ?? null })), stats: b.products.stats(now - 7 * 86_400_000) });
  if (req.method === "POST" && !idPart) {
    let body: { url?: unknown; title?: unknown; notes?: unknown };
    try {
      body = (await readJson(req, 4096)) as typeof body;
    } catch (e) {
      return json(res, { error: (e as Error).message }, 400);
    }
    const out = b.products.add(String(body.url ?? ""), String(body.title ?? ""), String(body.notes ?? ""), now);
    if (typeof out === "string") return json(res, { error: out }, 400);
    void b.products.ingest(out.id);
    return json(res, out, 201);
  }
  const id = Number(idPart);
  if (!Number.isInteger(id)) return json(res, { error: "unsupported" }, 405);
  if (req.method === "POST" && (action === "pause" || action === "resume")) return json(res, { ok: b.products.setActive(id, action === "resume") });
  if (req.method === "DELETE") return json(res, { removed: b.products.remove(id) });
  return json(res, { error: "unsupported" }, 405);
}

async function handleMail(req: http.IncomingMessage, res: http.ServerResponse, url: URL, b: Built, tz: string) {
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
    if (out.crisis) return json(res, { status: "needs help" }, 201);
    return json(res, { status: out.status === "rejected" ? "not accepted" : "received", id: out.id }, 201);
  }
  // "Where's my letter?" - only ever answers about the asker's own messages.
  if (req.method === "GET" && idPart === "mine") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").map(Number);
    const now = b.clock.now();
    return json(res, {
      messages: b.mailbag.mine(ids, clientIp(req)).map((m) => ({ id: m.id, text: m.text.slice(0, 60), status: mailStatus(m, b.mailbag, now, tz, b.station.override()) })),
    });
  }
  if (!isLocal(req)) return json(res, { error: "the mailbag is only visible from this machine" }, 403);
  if (req.method === "GET") return json(res, { messages: b.mailbag.list(), shows: Object.values(SHOWS).filter((sh) => sh.mailSegment).map((sh) => ({ id: sh.id, title: sh.title })) });
  const id = Number(idPart);
  if (req.method === "POST" && Number.isInteger(id) && (action === "approve" || action === "reject"))
    return json(res, { ok: b.mailbag.review(id, action === "approve") });
  return json(res, { error: "unsupported" }, 405);
}

/** What a requester sees about their shoutout. */
function shoutoutView(s: Shoutout) {
  const message: Record<Shoutout["status"], string> = {
    pending: "Waiting for the producers to approve it.",
    approved: "Approved! It's in line to be made.",
    writing: "Approved! The cast is writing it now.",
    rendering: "Recording it now - a couple of minutes.",
    ready: "It's ready!",
    rejected: "The producers passed on this one. Sorry!",
    failed: "Something went wrong making it. The producers can try again.",
  };
  return {
    recipient: s.recipient,
    occasion: s.occasion,
    by: SHOUTOUT_CASTS[s.showId] ?? s.showId,
    status: s.status,
    message: message[s.status],
    video: s.status === "ready" && s.file ? `/shoutouts/${s.file}` : null,
    vertical: s.status === "ready" && s.verticalFile ? `/shoutouts/${s.verticalFile}` : null,
  };
}

async function handleShoutouts(req: http.IncomingMessage, res: http.ServerResponse, url: URL, b: Built, config: StationConfig) {
  const [, , , part, action] = url.pathname.split("/");
  // Public: the form's options, a request, and a private status page by token.
  if (req.method === "GET" && part === "options")
    return json(res, { casts: SHOUTOUT_CASTS, occasions: OCCASIONS, price: config.shoutoutPrice, paymentUrl: config.shoutoutPaymentUrl });
  if (req.method === "GET" && part === "status") {
    const s = b.shoutouts.lookup(String(url.searchParams.get("t") ?? ""));
    return s ? json(res, shoutoutView(s)) : json(res, { error: "not found" }, 404);
  }
  if (req.method === "POST" && !part) {
    let body: Record<string, unknown>;
    try {
      body = (await readJson(req, 2048)) as Record<string, unknown>;
    } catch (e) {
      return json(res, { error: (e as Error).message }, 400);
    }
    const out = await b.shoutouts.submit(
      { recipient: String(body.recipient ?? ""), occasion: String(body.occasion ?? ""), detail: String(body.detail ?? ""), showId: String(body.showId ?? "") },
      clientIp(req),
      b.clock.now(),
    );
    if (typeof out === "string") return json(res, { error: out }, out.includes("try again") ? 429 : 400);
    return json(res, { token: out.token, status: out.status }, 201);
  }
  // The desk: everything, and approve / decline.
  if (!isLocal(req)) return json(res, { error: "shoutout requests are only visible from this machine" }, 403);
  if (req.method === "GET" && !part) return json(res, { shoutouts: b.shoutouts.list(), casts: SHOUTOUT_CASTS });
  const id = Number(part);
  if (req.method === "POST" && Number.isInteger(id) && (action === "approve" || action === "reject")) return json(res, { ok: b.shoutouts.review(id, action === "approve") });
  return json(res, { error: "unsupported" }, 405);
}

/** "That was funny": a viewer taps it during a scene that's on air (or just ended). */
const funnyHits = new Map<string, number[]>();
async function handleFunny(req: http.IncomingMessage, res: http.ServerResponse, b: Built) {
  const ip = clientIp(req);
  const now = b.clock.now();
  const hits = (funnyHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 20) return json(res, { error: "slow down" }, 429);
  funnyHits.set(ip, [...hits, now]);
  let body: { segmentId?: unknown; voter?: unknown };
  try {
    body = (await readJson(req, 512)) as typeof body;
  } catch (e) {
    return json(res, { error: (e as Error).message }, 400);
  }
  const seg = typeof body.segmentId === "string" ? b.timeline.byId(body.segmentId) : undefined;
  if (!seg || seg.startAt > now || seg.startAt + seg.durationMs < now - 30_000) return json(res, { error: "that scene isn't on" }, 400);
  if (typeof body.voter !== "string" || !/^[\w-]{8,64}$/.test(body.voter)) return json(res, { error: "bad viewer id" }, 400);
  b.funny.tap(seg.id, body.voter, now);
  return json(res, { ok: true });
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
  const artists = Object.values(ARTISTS).map((a) => ({ id: a.id, name: a.name, style: a.style, tracks: b.tracks.forArtist(a.id).length }));
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
  // Identifies the player code, so open pages reload themselves after an update.
  const playerBuild = () => {
    try {
      return String(fs.statSync(path.join(publicDir, "app.js")).mtimeMs);
    } catch {
      return "";
    }
  };
  const mediaDir = path.join(config.dataDir, "media");
  const sockets = new Set<WebSocket>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const now = b.clock.now();
    if (url.pathname === "/api/mail" || url.pathname.startsWith("/api/mail/")) {
      void handleMail(req, res, url, b, config.timeZone);
      return;
    }
    // Commercial click-through: count it, then send the viewer to the store with the
    // Associates tag. Only ever redirects to a product the operator added (no open redirect).
    if (url.pathname.startsWith("/go/")) {
      const product = b.products.get(Number(url.pathname.slice(4)));
      if (!product) return void res.writeHead(404).end("not found");
      b.products.click(product.id, now);
      res.writeHead(302, { location: affiliateLink(product, config.amazonTag), "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" });
      return void res.end();
    }
    if (url.pathname === "/api/products" || url.pathname.startsWith("/api/products/")) {
      void handleProducts(req, res, url, b);
      return;
    }
    if (url.pathname === "/api/chat") return json(res, b.chat.recent());
    if (url.pathname === "/api/impact") return json(res, impactFeed(b.db, b.mailbag, now));
    // One aired segment, for clip rendering. Never anything that hasn't aired yet. Private shoutout
    // scenes are served too, but only to this machine (the clip renderer).
    if (url.pathname.startsWith("/api/segment/")) {
      const id = decodeURIComponent(url.pathname.slice(13));
      const seg = b.timeline.byId(id) ?? (isLocal(req) ? b.shoutouts.segment(id) : undefined);
      if (!seg || seg.startAt > now) return json(res, { error: "not found" }, 404);
      return json(res, seg);
    }
    if (url.pathname === "/api/shoutouts" || url.pathname.startsWith("/api/shoutouts/")) {
      void handleShoutouts(req, res, url, b, config);
      return;
    }
    if (url.pathname.startsWith("/shoutouts/")) {
      const rel = decodeURIComponent(url.pathname.slice(11));
      if (!/^[0-9a-f]{24}(-vertical)?\.mp4$/.test(rel)) return void res.writeHead(404).end("not found");
      return serveFile(res, path.join(config.dataDir, "shoutouts"), rel, "private, max-age=86400");
    }
    if (url.pathname === "/api/funny" && req.method === "POST") {
      void handleFunny(req, res, b);
      return;
    }
    if (url.pathname === "/api/clips") {
      if (!isLocal(req)) return json(res, { error: "the clip desk is only available from this machine" }, 403);
      if (req.method === "POST") {
        void readJson(req, 512)
          .then((body) => {
            const out = b.clips.request(String((body as { segmentId?: unknown }).segmentId ?? ""), b.clock.now());
            return typeof out === "string" ? json(res, { error: out }, 400) : json(res, out, 201);
          })
          .catch((e: Error) => json(res, { error: e.message }, 400));
        return;
      }
      // Clip candidates: recent scenes, the ones viewers found funniest first.
      const funny = b.funny.counts(now - 6 * 3_600_000);
      const marks = b.timeline.marks();
      const candidates = b.timeline
        .range(now - 6 * 3_600_000, now)
        .filter((s) => s.startAt + s.durationMs <= now && s.kind !== "bumper" && !s.ad)
        .map((s) => ({ id: s.id, title: s.title, show: s.showTitle, startAt: s.startAt, durationMs: s.durationMs, kind: s.kind, funny: funny.get(s.id) ?? 0, mark: marks.get(b.timeline.originalOf(s.id)) ?? null }))
        .sort((x, y) => y.funny - x.funny || y.startAt - x.startAt)
        .slice(0, 40);
      return json(res, { clips: b.clips.list(), candidates, publicUrl: config.publicUrl });
    }
    // Curate the encore archive: star the best scenes, retire the duds.
    if (url.pathname.startsWith("/api/archive/")) {
      if (!isLocal(req)) return json(res, { error: "the archive is only editable from this machine" }, 403);
      const [, , , id, action] = url.pathname.split("/");
      const mark = action === "star" ? "star" : action === "retire" ? "retired" : action === "clear" ? null : undefined;
      if (req.method !== "POST" || mark === undefined || !b.timeline.byId(decodeURIComponent(id))) return json(res, { error: "unsupported" }, 400);
      b.timeline.mark(decodeURIComponent(id), mark, now);
      return json(res, { ok: true });
    }
    if (url.pathname.startsWith("/clips/")) {
      const rel = decodeURIComponent(url.pathname.slice(7));
      if (!/^[\w-]+\.mp4$/.test(rel)) return void res.writeHead(404).end("not found");
      return serveFile(res, b.clips.dir, rel, "public, max-age=86400");
    }
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
        return json(res, { serverNow: now, network: config.networkName, ads: config.adEveryMin > 0 && b.products.list().some((p) => p.active), voteUrl: config.publicUrl.replace(/^https?:\/\//, ""), flagship: flagshipAt(now, config.timeZone), onNow: programAt(now, config.timeZone, b.station.override()), override: b.station.override() });
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
        // Tonight's arc for the show on the air (logline and wants only: no spoilers).
        const onAir = programAt(now, config.timeZone, b.station.override());
        const stored = b.episodes.get(onAir.showId, onAir.startAt);
        const episode = stored && {
          showId: onAir.showId,
          logline: stored.plan.logline,
          wants: stored.plan.wants.map((w) => ({ name: name(w.character), want: w.want })),
          part: phaseAt(stored.plan, onAir, now).index + 1,
          of: phaseAt(stored.plan, onAir, now).of,
        };
        return json(res, {
          shows: Object.values(SHOWS).map((show) => {
            const ids = show.cast;
            const pairs = ids.flatMap((a) => ids.filter((x) => x !== a).map((x) => ({ ...b.memory.relationship(a, x), fromName: name(a), toName: name(x) })));
            return {
              id: show.id,
              title: show.title,
              episode: episode && episode.showId === show.id ? episode : undefined,
              season: (() => {
                const s = show.serialized ? b.episodes.getSeason(show.id, weekOf(now, config.timeZone).key) : undefined;
                return s && { title: s.title, question: s.question, day: weekOf(now, config.timeZone).day + 1 };
              })(),
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
          audience: b.audience.report(now),
          leadMs: Math.max(0, b.timeline.tailEnd() - now),
          decision: b.governor.decide(now),
          spentTodayUsd: b.governor.spentToday(now),
          dailyBudgetUsd: config.dailyBudgetUsd,
          writerChain: b.writers.map((w) => w.name),
          model: config.writer === "local" ? config.ollama.model : config.writer === "claude" ? `${config.models.standard} / ${config.models.premium}` : "improv",
          tts: b.tts.name,
          ads: { everyMin: config.adEveryMin, tagged: Boolean(config.amazonTag), stats: b.products.stats(now - 86_400_000) },
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
    if (url.pathname.startsWith("/music/")) {
      // Only audio files, never the analysis cache or anything else in the folder.
      const rel = decodeURIComponent(url.pathname.slice(7));
      if (!/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(rel) || rel.split("/").some((p) => p.startsWith("."))) return void res.writeHead(404).end("not found");
      return serveFile(res, b.tracks.root, rel, "public, max-age=3600");
    }
    if (url.pathname.startsWith("/media/")) return serveFile(res, mediaDir, url.pathname.slice(7), "public, max-age=31536000, immutable");
    return serveFile(res, publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1), "no-cache");
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const send = (ws: WebSocket, m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const broadcast = (m: ServerMessage) => sockets.forEach((ws) => send(ws, m));
  // Restream capture pages: they get the broadcast but aren't an audience.
  const feeds = new Set<WebSocket>();
  const updateViewers = () => {
    const audience = sockets.size - feeds.size;
    b.governor.setViewers(audience, b.clock.now());
    b.governor.setFeeds(feeds.size);
    broadcast({ type: "viewers", count: audience });
  };

  wss.on("connection", (ws, req) => {
    const sender = senderId(clientIp(req));
    sockets.add(ws);
    const isFeed = new URL(req.url ?? "/", "http://x").searchParams.get("feed") === "1";
    if (isFeed) feeds.add(ws);
    const session = isFeed ? undefined : b.audience.open(b.clock.now(), isLocal(req));
    send(ws, { type: "hello", serverNow: b.clock.now(), network: config.networkName, build: playerBuild() });
    updateViewers();
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === "ping" && typeof msg.c === "number") send(ws, { type: "pong", c: msg.c, s: b.clock.now() });
      if (session && msg.type === "hello" && typeof msg.viewer === "string") b.audience.identify(session, msg.viewer, typeof msg.ref === "string" ? msg.ref : null);
      if (session && msg.type === "tunein") b.audience.tunedIn(session, b.clock.now());
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
      feeds.delete(ws);
      if (session) b.audience.close(session, b.clock.now(), programAt(b.clock.now(), config.timeZone, b.station.override()).showId);
      updateViewers();
    });
  });

  // The stream's Twitch chat joins the network's chat: same moderation, labeled TWITCH.
  const twitch = config.twitchChannel
    ? new TwitchChat(config.twitchChannel, (line) => {
        const out = b.chat.post(line.name, line.text, `twitch:${line.login}`, b.clock.now());
        if (out.kind !== "posted") return;
        broadcast({ type: "chat", message: out.message });
        void b.chat.review(out.message).then((removed) => removed && broadcast({ type: "chat-delete", id: out.message.id }));
      }, (m) => console.log(`[${new Date().toISOString()}] ${m}`))
    : undefined;
  twitch?.start();
  server.on("close", () => twitch?.stop());

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
