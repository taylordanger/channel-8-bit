import { describe, expect, it } from "vitest";
import { openDb } from "../src/server/db.js";
import { ChatRoom } from "../src/server/chat.js";
import { DEFAULT_POLICY } from "../src/server/standards.js";
import { channelName, parseIrc, TwitchChat, type TwitchLine } from "../src/server/twitch.js";

describe("Twitch chat relay", () => {
  it("parses chat lines, display names and /me, and ignores everything else", () => {
    expect(parseIrc("@badge-info=;display-name=CoolDude;emotes= :cooldude!cooldude@cooldude.tmi.twitch.tv PRIVMSG #chan8bit :rex is the best")).toEqual({ login: "cooldude", name: "CoolDude", text: "rex is the best" });
    expect(parseIrc(":anon!anon@anon.tmi.twitch.tv PRIVMSG #chan8bit :\u0001ACTION waves\u0001")).toEqual({ login: "anon", name: "anon", text: "waves" });
    expect(parseIrc(":tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!")).toBeUndefined();
    expect(parseIrc("PING :tmi.twitch.tv")).toBeUndefined();
  });

  it("accepts a channel name or URL", () => {
    expect(channelName("Chan8Bit")).toBe("chan8bit");
    expect(channelName("https://www.twitch.tv/chan8bit/")).toBe("chan8bit");
    expect(channelName("not a channel!")).toBe("");
    expect(channelName(undefined)).toBe("");
  });

  it("relays at most a few messages a minute and skips bot commands", () => {
    const got: TwitchLine[] = [];
    const t = new TwitchChat("chan8bit", (l) => got.push(l), () => {}, 3);
    const line = (text: string) => ({ login: "a", name: "A", text });
    expect(t.relay(line("!uptime"), 0)).toBe(false);
    for (let i = 0; i < 5; i++) t.relay(line(`hi ${i}`), i * 1000);
    expect(got.map((l) => l.text)).toEqual(["hi 0", "hi 1", "hi 2"]);
    expect(t.relay(line("later"), 61_000)).toBe(true);
  });

  it("labels relayed messages as Twitch in the network chat", () => {
    const room = new ChatRoom(openDb(":memory:"), DEFAULT_POLICY);
    const out = room.post("CoolDude", "hello from twitch", "twitch:cooldude", 1000);
    expect(out.kind === "posted" && out.message.source).toBe("twitch");
    room.post("webfan", "hello from the site", "abc123", 4000);
    expect(room.recent().map((m) => m.source)).toEqual(["twitch", undefined]);
    expect(room.digest(60_000).map((m) => m.source)).toEqual(["twitch", undefined]);
  });
});
