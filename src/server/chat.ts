import crypto from "node:crypto";
import type { ChatMessage } from "../shared/types.js";
import type { DB } from "./db.js";
import { cleanHandle, cleanMessage, type Moderator } from "./mailbag.js";
import type { StandardsPolicy } from "./standards.js";

export const MAX_CHAT_CHARS = 200;
const MIN_GAP_MS = 2000;
/** Twitch messages are stored with a "twitch:<login>" sender. */
const SOURCE = "CASE WHEN sender LIKE 'twitch:%' THEN 'twitch' END AS source";
const withSource = <T extends { source?: string | null }>(m: T): T => (m.source ? m : { ...m, source: undefined });
const PER_MINUTE = 10;
export const MUTE_MS = 24 * 3_600_000;

export const senderId = (ip: string) => crypto.createHash("sha256").update("chat:" + ip).digest("hex").slice(0, 16);

export type ChatOutcome =
  | { kind: "posted"; message: ChatMessage }
  | { kind: "shadow"; message: ChatMessage } // muted: only the sender sees it
  | { kind: "error"; error: string };

/**
 * The viewers' chat room. Messages are cleaned and screened against the blocklist before
 * anyone sees them, rate-limited per sender, and reviewed by the moderator just after
 * posting (anything it rejects is deleted for everyone). Operators can delete and mute.
 */
export class ChatRoom {
  private lastPost = new Map<string, number[]>();

  constructor(
    private db: DB,
    private policy: StandardsPolicy,
    private moderator?: Moderator,
  ) {}

  post(handleRaw: string, textRaw: string, sender: string, now: number): ChatOutcome {
    const text = cleanMessage(textRaw).slice(0, MAX_CHAT_CHARS);
    const handle = cleanHandle(handleRaw) || "viewer";
    if (!text) return { kind: "error", error: "say something first" };
    const times = (this.lastPost.get(sender) ?? []).filter((t) => now - t < 60_000);
    if (times.length && now - times[times.length - 1] < MIN_GAP_MS) return { kind: "error", error: "slow down a little" };
    if (times.length >= PER_MINUTE) return { kind: "error", error: "that's a lot of messages - take a breather" };
    this.lastPost.set(sender, [...times, now]);
    if ([...this.policy.blocklist, ...this.policy.fictionBlocklist].some((re) => re.test(text) || re.test(handle)))
      return { kind: "error", error: "that message can't be posted" };
    const info = this.db.prepare("INSERT INTO chat_messages (at, handle, text, sender) VALUES (?,?,?,?)").run(now, handle, text, sender);
    const message: ChatMessage = { id: Number(info.lastInsertRowid), at: now, handle, text, ...(sender.startsWith("twitch:") ? { source: "twitch" as const } : {}) };
    if (this.isMuted(sender, now)) {
      this.db.prepare("UPDATE chat_messages SET deleted = 1, reason = 'muted' WHERE id = ?").run(message.id);
      return { kind: "shadow", message };
    }
    return { kind: "posted", message };
  }

  /** Background review of a posted message. Resolves true if it was removed. */
  async review(message: ChatMessage): Promise<boolean> {
    if (!this.moderator) return false;
    try {
      const v = await this.moderator.moderate(message.text, message.handle);
      if (v.allow) return false;
      this.remove(message.id, `moderator: ${v.reason}`);
      return true;
    } catch {
      return false; // moderator down: the operator can still delete by hand
    }
  }

  remove(id: number, reason = "removed by the operator"): boolean {
    return this.db.prepare("UPDATE chat_messages SET deleted = 1, reason = ? WHERE id = ? AND deleted = 0").run(reason, id).changes > 0;
  }

  /** Mute whoever sent this message for a day (their later messages are shadow-hidden). */
  muteAuthorOf(id: number, now: number): boolean {
    const row = this.db.prepare("SELECT sender FROM chat_messages WHERE id = ?").get(id) as { sender: string } | undefined;
    if (!row) return false;
    this.db.prepare("INSERT INTO chat_mutes (sender, until) VALUES (?, ?) ON CONFLICT(sender) DO UPDATE SET until = excluded.until").run(row.sender, now + MUTE_MS);
    return true;
  }

  isMuted(sender: string, now: number): boolean {
    const row = this.db.prepare("SELECT until FROM chat_mutes WHERE sender = ?").get(sender) as { until: number } | undefined;
    return Boolean(row && row.until > now);
  }

  /**
   * What the cast may glance at: recent messages that are old enough to have been reviewed
   * by the moderator (and survived), newest last.
   */
  digest(now: number, limit = 6): ChatMessage[] {
    return (
      this.db
        .prepare(`SELECT id, at, handle, text, ${SOURCE} FROM chat_messages WHERE deleted = 0 AND at <= ? AND at > ? ORDER BY id DESC LIMIT ?`)
        .all(now - 15_000, now - 15 * 60_000, limit) as ChatMessage[]
    )
      .reverse()
      .map(withSource);
  }

  recent(limit = 50): ChatMessage[] {
    return (this.db.prepare(`SELECT id, at, handle, text, ${SOURCE} FROM chat_messages WHERE deleted = 0 ORDER BY id DESC LIMIT ?`).all(limit) as ChatMessage[]).reverse().map(withSource);
  }

  /** For the operator: everything, including removed messages and why. */
  log(limit = 100): (ChatMessage & { deleted: boolean; reason: string; muted: boolean })[] {
    const now = Date.now();
    return (this.db.prepare("SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?").all(limit) as {
      id: number; at: number; handle: string; text: string; sender: string; deleted: number; reason: string;
    }[]).map((r) => ({ id: r.id, at: r.at, handle: r.handle, text: r.text, deleted: Boolean(r.deleted), reason: r.reason, muted: this.isMuted(r.sender, now) }));
  }
}
