import type { ChatMessage } from "../shared/types.js";

/** The viewers' chat panel beside the TV. Network I/O goes through the station link. */
export class ChatPanel {
  private list: HTMLElement;
  private input: HTMLInputElement;
  private handle: HTMLInputElement;
  private status: HTMLElement;
  private seen = new Set<number>();

  constructor(
    root: HTMLElement,
    private send: (handle: string, text: string) => void,
  ) {
    this.list = root.querySelector(".chat-list")!;
    this.input = root.querySelector("#chat-text")!;
    this.handle = root.querySelector("#chat-handle")!;
    this.status = root.querySelector(".chat-status")!;
    try {
      this.handle.value = localStorage.getItem("chat-handle") ?? "";
    } catch {
      /* private mode */
    }
    root.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      const handle = this.handle.value.trim();
      if (!handle) {
        this.flash("pick a name first");
        this.handle.focus();
        return;
      }
      if (!text) return;
      try {
        localStorage.setItem("chat-handle", handle);
      } catch {
        /* ignore */
      }
      this.send(handle, text);
      this.input.value = "";
    });
    void this.loadHistory();
  }

  private async loadHistory() {
    try {
      for (const m of (await (await fetch("/api/chat")).json()) as ChatMessage[]) this.add(m);
    } catch {
      /* station unreachable */
    }
  }

  add(m: ChatMessage) {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    const li = document.createElement("li");
    li.dataset.id = String(m.id);
    const who = document.createElement("b");
    who.textContent = m.handle;
    li.append(who);
    if (m.source === "twitch") {
      const tag = document.createElement("span");
      tag.className = "tag-twitch";
      tag.textContent = "TWITCH";
      li.append(" ", tag);
    }
    li.append(document.createTextNode(" " + m.text));
    this.list.append(li);
    while (this.list.children.length > 150) this.list.firstElementChild?.remove();
    if (nearBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  remove(id: number) {
    this.list.querySelector(`li[data-id="${id}"]`)?.remove();
  }

  flash(text: string) {
    this.status.textContent = text;
    setTimeout(() => (this.status.textContent = ""), 3000);
  }
}
