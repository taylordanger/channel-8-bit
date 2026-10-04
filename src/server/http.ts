import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Segment } from "../shared/types.js";
import type { Built } from "./build.js";
import { CHARACTERS } from "./catalog/characters.js";
import { guideWith, programAt } from "./catalog/schedule.js";
import { SHOWS } from "./catalog/shows.js";
import type { StationConfig } from "./config.js";
import type { Topic } from "./desk.js";
import { assertPublicUrl, URL_PATTERN } from "./sources.js";

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
const isLocal = (req: http.IncomingMessage) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");

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
        return json(res, { serverNow: now, network: config.networkName, onNow: programAt(now, config.timeZone, b.station.override()), override: b.station.override() });
      case "/api/timeline": {
        const from = Number(url.searchParams.get("from") ?? now - 60_000);
        const to = Math.min(Number(url.searchParams.get("to") ?? now + 600_000), from + 3_600_000);
        return json(res, b.timeline.range(from, to));
      }
      case "/api/cast":
        return json(
          res,
          Object.values(SHOWS).flatMap((show) =>
            [...show.cast, ...(show.guestPool ?? [])].map((id) => ({ id, name: CHARACTERS[id].name, show: show.title, look: CHARACTERS[id].look })),
          ),
        );
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

  wss.on("connection", (ws) => {
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
    close: () => {
      wss.close();
      server.close();
    },
  };
}
