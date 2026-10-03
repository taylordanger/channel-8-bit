import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { buildStation, type Built } from "../src/server/build.js";
import { ManualClock } from "../src/server/clock.js";
import { loadConfig } from "../src/server/config.js";
import { startHttp } from "../src/server/http.js";
import { SilentTTS } from "../src/server/tts.js";
import { ImprovWriter } from "../src/server/writers/improv.js";
import type { ServerMessage } from "../src/shared/types.js";

let built: Built;
let http: ReturnType<typeof startHttp>;
let base: string;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "http-test-"));
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-"));

beforeAll(async () => {
  fs.writeFileSync(path.join(publicDir, "index.html"), "<h1>tv</h1>");
  fs.mkdirSync(path.join(dataDir, "media"));
  fs.writeFileSync(path.join(dataDir, "secret.txt"), "nope");
  const config = { ...loadConfig({}), dataDir, port: 0, tts: "silent" as const, writer: "improv" as const, timeZone: "UTC" };
  built = buildStation(config, { clock: new ManualClock(Date.UTC(2026, 9, 3, 12)), dbFile: ":memory:", tts: new SilentTTS(), writers: [new ImprovWriter(1)] });
  http = startHttp(config, built, publicDir);
  await new Promise((r) => http.server.once("listening", r));
  const addr = http.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  http.close();
  built.db.close();
});

describe("http + ws", () => {
  it("serves the player and the API", async () => {
    expect(await (await fetch(base + "/")).text()).toContain("tv");
    const now = await (await fetch(base + "/api/now")).json();
    expect(now.onNow.showId).toBe("pixel_heights");
    expect(Array.isArray(await (await fetch(base + "/api/guide")).json())).toBe(true);
    const status = await (await fetch(base + "/api/status")).json();
    expect(status.decision.reason).toBe("nobody watching");
  });

  it("refuses path traversal out of the media and public dirs", async () => {
    expect((await fetch(base + "/media/..%2Fsecret.txt")).status).toBe(404);
    expect((await fetch(base + "/media/../secret.txt")).status).toBe(404);
  });

  it("greets sockets, answers pings, and counts viewers for the governor", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const msgs: ServerMessage[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "ping", c: 123 }));
    await new Promise((r) => setTimeout(r, 100));
    expect(msgs.find((m) => m.type === "hello")).toBeTruthy();
    expect(msgs.find((m) => m.type === "pong")).toMatchObject({ c: 123 });
    expect(built.governor.viewerCount).toBe(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(built.governor.viewerCount).toBe(0);
  });
});
