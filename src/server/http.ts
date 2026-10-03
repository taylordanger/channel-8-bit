import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Segment } from "../shared/types.js";
import type { Built } from "./build.js";
import { guide, slotAt } from "./catalog/schedule.js";
import type { StationConfig } from "./config.js";

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

const json = (res: http.ServerResponse, body: unknown) => {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function startHttp(config: StationConfig, b: Built, publicDir: string) {
  const mediaDir = path.join(config.dataDir, "media");
  const sockets = new Set<WebSocket>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const now = b.clock.now();
    switch (url.pathname) {
      case "/api/now":
        return json(res, { serverNow: now, network: config.networkName, onNow: slotAt(now, config.timeZone) });
      case "/api/timeline": {
        const from = Number(url.searchParams.get("from") ?? now - 60_000);
        const to = Math.min(Number(url.searchParams.get("to") ?? now + 600_000), from + 3_600_000);
        return json(res, b.timeline.range(from, to));
      }
      case "/api/guide":
        return json(res, guide(now, 24, config.timeZone));
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
    close: () => {
      wss.close();
      server.close();
    },
  };
}
