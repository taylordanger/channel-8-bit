import WebSocket from "ws";

/** One chat line from Twitch IRC. */
export interface TwitchLine {
  login: string;
  name: string;
  text: string;
}

/** Parse a raw IRC line; returns a chat message for PRIVMSG lines, otherwise undefined. */
export function parseIrc(raw: string): TwitchLine | undefined {
  // @tags :login!login@login.tmi.twitch.tv PRIVMSG #channel :text
  const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/.exec(raw.trim());
  if (!m) return undefined;
  const tags = Object.fromEntries((m[1] ?? "").split(";").map((kv) => kv.split("=") as [string, string]));
  const text = m[3].replace(/^\u0001ACTION (.*)\u0001$/, "$1"); // "/me" messages
  return { login: m[2], name: tags["display-name"] || m[2], text };
}

/**
 * Reads a Twitch channel's chat anonymously (no account, key or password needed - just the
 * channel name) and hands each message on. Reconnects with backoff. Relays at most
 * `perMinute` messages: every message is moderated by the local model, and a busy chat
 * shouldn't crowd the writers' room off it.
 */
export class TwitchChat {
  private ws?: WebSocket;
  private stopped = false;
  private attempt = 0;
  private relayed: number[] = [];

  constructor(
    readonly channel: string,
    private onMessage: (line: TwitchLine) => void,
    private log: (m: string) => void = () => {},
    private perMinute = 6,
    private url = "wss://irc-ws.chat.twitch.tv:443",
  ) {}

  start(): void {
    this.stopped = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      this.attempt = 0;
      ws.send("CAP REQ :twitch.tv/tags");
      ws.send("PASS SCHMOOPIIE"); // anonymous read-only login
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws.send(`JOIN #${this.channel}`);
      this.log(`reading Twitch chat for #${this.channel}`);
    });
    ws.on("message", (data) => {
      for (const raw of String(data).split("\r\n")) {
        if (!raw) continue;
        if (raw.startsWith("PING")) {
          ws.send(raw.replace("PING", "PONG"));
          continue;
        }
        const line = parseIrc(raw);
        if (line) this.relay(line, Date.now());
      }
    });
    ws.on("close", () => {
      if (this.stopped) return;
      const wait = Math.min(60_000, 2000 * 2 ** this.attempt++);
      this.log(`Twitch chat disconnected; retrying in ${Math.round(wait / 1000)}s`);
      setTimeout(() => !this.stopped && this.start(), wait).unref();
    });
    ws.on("error", (e) => this.log(`Twitch chat error: ${e.message}`));
  }

  /** Pass a message on unless it's a bot command or we're over the per-minute cap. */
  relay(line: TwitchLine, now: number): boolean {
    if (line.text.startsWith("!")) return false;
    this.relayed = this.relayed.filter((t) => now - t < 60_000);
    if (this.relayed.length >= this.perMinute) return false;
    this.relayed.push(now);
    this.onMessage(line);
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }
}

/** A Twitch channel name from a setting: accepts "name" or a twitch.tv URL. */
export function channelName(setting: string | undefined): string {
  const m = /^(?:https?:\/\/(?:www\.)?twitch\.tv\/)?([a-zA-Z0-9_]{3,25})\/?$/.exec((setting ?? "").trim());
  return m ? m[1].toLowerCase() : "";
}
