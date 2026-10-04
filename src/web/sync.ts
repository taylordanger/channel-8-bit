import type { ChatMessage, ClientMessage, PollResult, Segment, ServerMessage } from "../shared/types.js";

/**
 * Keeps this browser's idea of station time in step with the server (NTP-style:
 * offset = server time - midpoint of the round trip, median of recent samples),
 * and relays pushed segments and viewer counts.
 */
export class StationLink {
  private offsets: number[] = [];
  private ws?: WebSocket;
  network = "";
  viewers = 0;
  connected = false;

  constructor(
    private handlers: {
      onSegment: (s: Segment) => void;
      onSync: () => void;
      onRetract?: (ids: string[]) => void;
      onPoll?: (r: PollResult) => void;
      onChat?: (m: ChatMessage) => void;
      onChatDelete?: (id: number) => void;
      onChatError?: (e: string) => void;
    },
  ) {}

  /** Station "now" in ms. */
  now(): number {
    if (!this.offsets.length) return Date.now();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    return Date.now() + sorted[Math.floor(sorted.length / 2)];
  }

  connect(): void {
    // The restream's capture page is a feed, not an audience member: it mustn't keep production going.
    const feed = location.pathname.endsWith("/broadcast.html") || new URLSearchParams(location.search).has("broadcast");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${feed ? "?feed=1" : ""}`);
    this.ws = ws;
    let pinger: number | undefined;
    ws.onopen = () => {
      this.connected = true;
      // Who's watching, for the control room's audience stats: the browser's random voting id.
      if (!feed) {
        let viewer = "";
        try {
          viewer = localStorage.getItem("voter") ?? "";
          if (!viewer) localStorage.setItem("voter", (viewer = crypto.randomUUID()));
        } catch {
          /* private window: stats just won't recognize a return visit */
        }
        if (viewer) this.send({ type: "hello", viewer, ref: new URLSearchParams(location.search).get("ref") });
        if (this.tunedIn) this.send({ type: "tunein" });
      }
      let burst = 0;
      const ping = () => this.send({ type: "ping", c: Date.now() });
      // A quick burst for a good first estimate, then a slow trickle to track drift.
      pinger = window.setInterval(() => (burst++ < 5 || burst % 20 === 0) && ping(), 500);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string) as ServerMessage;
      if (m.type === "hello") {
        this.network = m.network;
        this.offsets.push(m.serverNow - Date.now());
        this.handlers.onSync();
      } else if (m.type === "pong") {
        const t = Date.now();
        this.offsets.push(m.s - (m.c + t) / 2);
        if (this.offsets.length > 15) this.offsets.shift();
      } else if (m.type === "segment") this.handlers.onSegment(m.segment);
      else if (m.type === "retract") this.handlers.onRetract?.(m.ids);
      else if (m.type === "poll") this.handlers.onPoll?.(m.result);
      else if (m.type === "chat") this.handlers.onChat?.(m.message);
      else if (m.type === "chat-delete") this.handlers.onChatDelete?.(m.id);
      else if (m.type === "chat-error") this.handlers.onChatError?.(m.error);
      else if (m.type === "viewers") this.viewers = m.count;
    };
    ws.onclose = () => {
      this.connected = false;
      clearInterval(pinger);
      setTimeout(() => this.connect(), 2000);
    };
  }

  private tunedIn = false;
  /** The viewer pressed play (sent again after a reconnect). */
  tuneIn() {
    this.tunedIn = true;
    this.send({ type: "tunein" });
  }

  sendChat(handle: string, text: string) {
    this.send({ type: "chat", handle, text });
  }

  private send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
