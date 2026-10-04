import { describe, expect, it } from "vitest";
import { ChatRoom, MUTE_MS } from "../src/server/chat.js";
import { openDb } from "../src/server/db.js";
import type { Moderator } from "../src/server/mailbag.js";
import { DEFAULT_POLICY } from "../src/server/standards.js";

describe("live chat", () => {
  it("cleans messages, throttles senders, and blocks blocklisted text before anyone sees it", () => {
    const room = new ChatRoom(openDb(":memory:"), DEFAULT_POLICY);
    const ok = room.post("Fan!!", "hi everyone, see www.spam.com", "s1", 0);
    expect(ok).toMatchObject({ kind: "posted", message: { handle: "Fan", text: "hi everyone, see [link]" } });
    expect(room.post("Fan", "again", "s1", 500)).toMatchObject({ kind: "error" });
    expect(room.post("Fan", "again", "s1", 2500).kind).toBe("posted");
    expect(room.post("Other", "you should buy the stock", "s2", 0)).toMatchObject({ kind: "error" });
    expect(room.post("Other", "   ", "s2", 5000)).toMatchObject({ kind: "error" });
    expect(room.recent().map((m) => m.text)).toEqual(["hi everyone, see [link]", "again"]);
  });

  it("the moderator removes what slips through; operators delete and mute", async () => {
    const deny: Moderator = { moderate: async (text) => ({ allow: !text.includes("mean"), reason: "harassment" }) };
    const room = new ChatRoom(openDb(":memory:"), DEFAULT_POLICY, deny);
    const nice = room.post("A", "great show", "s1", 0);
    const mean = room.post("B", "something mean", "s2", 0);
    if (nice.kind !== "posted" || mean.kind !== "posted") throw new Error("expected posts");
    expect(await room.review(nice.message)).toBe(false);
    expect(await room.review(mean.message)).toBe(true);
    expect(room.recent().map((m) => m.handle)).toEqual(["A"]);
    // Mute A: later messages only echo back to them.
    expect(room.muteAuthorOf(nice.message.id, 10)).toBe(true);
    expect(room.post("A", "hello?", "s1", 5000).kind).toBe("shadow");
    expect(room.recent().map((m) => m.text)).toEqual(["great show"]);
    expect(room.post("A", "back", "s1", 10 + MUTE_MS + 1).kind).toBe("posted");
    expect(room.log().find((m) => m.text === "something mean")).toMatchObject({ deleted: true, reason: "moderator: harassment" });
  });
});
