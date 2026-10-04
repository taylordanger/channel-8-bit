import type { ClientMessage, Segment, ServerMessage } from "../shared/types.js";

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
    private handlers: { onSegment: (s: Segment) => void; onSync: () => void; onRetract?: (ids: string[]) => void },
  ) {}

  /** Station "now" in ms. */
  now(): number {
    if (!this.offsets.length) return Date.now();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    return Date.now() + sorted[Math.floor(sorted.length / 2)];
  }

  connect(): void {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    let pinger: number | undefined;
    ws.onopen = () => {
      this.connected = true;
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
      else if (m.type === "viewers") this.viewers = m.count;
    };
    ws.onclose = () => {
      this.connected = false;
      clearInterval(pinger);
      setTimeout(() => this.connect(), 2000);
    };
  }

  private send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
