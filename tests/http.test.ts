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
  built = buildStation(config, {
    clock: new ManualClock(Date.UTC(2026, 9, 3, 10, 30)),
    dbFile: ":memory:",
    tts: new SilentTTS(),
    writers: [new ImprovWriter(1)],
    sourceReader: async (url) => ({ url, title: "Goat Mayor", site: "Example", description: "", publishedAt: "", text: "A goat won." }),
  });
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

  it("serves the cast and lets this machine manage the assignment desk", async () => {
    const cast = await (await fetch(base + "/api/cast")).json();
    expect(cast.length).toBeGreaterThanOrEqual(16);
    const add = await fetch(base + "/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Rex buys a boat", showId: "late_byte", maxUses: 3 }),
    });
    expect(add.status).toBe(201);
    const topic = await add.json();
    expect(topic).toMatchObject({ text: "Rex buys a boat", showId: "late_byte", maxUses: 3 });
    const bad = await fetch(base + "/api/topics", { method: "POST", body: "{not json" });
    expect(bad.status).toBe(400);
    const list = await (await fetch(base + "/api/topics")).json();
    expect(list.topics.map((t: { id: number }) => t.id)).toContain(topic.id);
    expect(list.shows.length).toBe(7);
    expect(await (await fetch(`${base}/api/topics/${topic.id}`, { method: "DELETE" })).json()).toEqual({ removed: true });
  });

  it("accepts a link pasted into the topic box, reads it, and refuses local links", async () => {
    const res = await fetch(base + "/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "react to this https://93.184.216.34/goat please" }),
    });
    expect(res.status).toBe(201);
    const t = await res.json();
    expect(t.url).toBe("https://93.184.216.34/goat");
    expect(t.text).toBe("react to this please");
    await new Promise((r) => setTimeout(r, 50));
    const listed = (await (await fetch(base + "/api/topics")).json()).topics.find((x: { id: number }) => x.id === t.id);
    expect(listed).toMatchObject({ fetchStatus: "ok", source: { title: "Goat Mayor" } });
    expect(listed.source.text).toBeUndefined(); // full page text stays on the server
    const local = await fetch(base + "/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:8088/api/status" }),
    });
    expect(local.status).toBe(400);
  });

  it("takes viewer votes from anywhere, once each", async () => {
    built.polls.open({ id: "poll-http", segmentId: "s", showId: "hot_seat", episode: "e", question: "Who won?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], opensAt: built.clock.now() - 1000, closesAt: built.clock.now() + 60_000, weight: 1 });
    const vote = (voter: string) =>
      fetch(base + "/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pollId: "poll-http", option: "a", voter }) });
    const ok = await vote("viewer-abcdef01");
    expect(ok.status).toBe(200);
    expect((await ok.json()).tally).toEqual({ a: 1, b: 0 });
    expect((await vote("viewer-abcdef01")).status).toBe(409);
    expect((await vote("x")).status).toBe(400);
    const active = await (await fetch(base + "/api/polls")).json();
    expect(active[0]).toMatchObject({ id: "poll-http", tally: { a: 1, b: 0 } });
  });

  it("takes viewer mail from anyone but only shows the queue to this machine", async () => {
    const res = await fetch(base + "/api/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "Fan", text: "Hi Rex!", showId: "late_byte" }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "received" });
    const list = await (await fetch(base + "/api/mail")).json();
    expect(list.messages[0]).toMatchObject({ handle: "Fan", text: "Hi Rex!" });
    const empty = await fetch(base + "/api/mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }) });
    expect(empty.status).toBe(400);
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
