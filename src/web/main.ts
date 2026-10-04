import type { GuideEntry, PollResult, Segment } from "../shared/types.js";
import { AudioDirector } from "./audio.js";
import { Renderer } from "./render.js";
import { StationLink } from "./sync.js";
import { startIngest } from "./ingest.js";

// Broadcast mode (/broadcast.html, or ?broadcast=1): a clean full-frame picture with sound on
// from the start - what the restreamer captures. ?ingest=ws://... also records and sends it.
const params = new URLSearchParams(location.search);
const broadcast = params.has("broadcast") || location.pathname.endsWith("/broadcast.html");
const ingestUrl = params.get("ingest");

const segments = new Map<string, Segment>();
const polls = new Map<string, PollResult>();
let voteUrl = "";
let guide: GuideEntry[] = [];
let audio: AudioDirector | undefined;

const addSegment = (s: Segment) => segments.set(s.id, s);
// Station time can differ from this browser's clock (skew, or a time-shifted rehearsal),
// so fetch the timeline again the moment we learn the server's clock.
const link = new StationLink({
  onSegment: addSegment,
  onSync: () => void refreshTimeline(),
  onPoll: (r) => {
    polls.set(r.pollId, r);
    renderVote();
  },
  onRetract: (ids) => {
    for (const id of ids) segments.delete(id);
    audio?.retract(ids);
  },
});
link.connect();

const canvas = document.getElementById("tv") as HTMLCanvasElement;
const renderer = new Renderer(canvas);

function resize() {
  if (broadcast) {
    // Fixed 1280x720 (exactly 4x the 320x180 scene): crisp pixels, a standard stream size.
    canvas.width = 1280;
    canvas.height = 720;
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
window.addEventListener("resize", resize);
resize();

async function refreshTimeline() {
  const now = link.now();
  try {
    const res = await fetch(`/api/timeline?from=${now - 30_000}&to=${now + 600_000}`);
    for (const s of (await res.json()) as Segment[]) addSegment(s);
  } catch {
    /* station unreachable; keep what we have */
  }
  for (const [id, s] of segments) if (s.startAt + s.durationMs < now - 60_000) segments.delete(id);
}

async function refreshGuide() {
  try {
    guide = (await (await fetch("/api/guide")).json()) as GuideEntry[];
    renderGuide();
  } catch {
    /* ignore */
  }
}

function renderGuide() {
  const el = document.getElementById("guide")!;
  const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  el.replaceChildren(
    ...guide.slice(0, 8).map((g, i) => {
      const row = document.createElement("li");
      if (i === 0) row.className = "now";
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = i === 0 ? "NOW" : fmt(g.startAt);
      const title = document.createElement("span");
      title.textContent = g.title + (g.mode === "rerun" ? " (encore)" : "");
      row.append(time, title);
      return row;
    }),
  );
}

async function refreshPolls() {
  try {
    const open = (await (await fetch("/api/polls")).json()) as { id: string; tally: Record<string, number> }[];
    for (const p of open) polls.set(p.id, { ...(polls.get(p.id) ?? { closed: false }), pollId: p.id, tally: p.tally });
    const now = (await (await fetch("/api/now")).json()) as { voteUrl?: string };
    voteUrl = now.voteUrl ?? "";
  } catch {
    /* ignore */
  }
}

// --- Voting --------------------------------------------------------------
const voter = (() => {
  try {
    let id = localStorage.getItem("voter");
    if (!id) localStorage.setItem("voter", (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();
const voted = new Set<string>();
let shownPoll = "";

/** Vote buttons under the TV while the segment on air has an open poll. */
function renderVote() {
  const box = document.getElementById("vote");
  if (!box) return;
  const now = link.now();
  const seg = [...segments.values()].find((s) => s.poll && now >= s.startAt - 2000 && now < s.poll.closesAt);
  const poll = seg?.poll;
  const result = poll ? polls.get(poll.id) : undefined;
  if (!poll || result?.closed) {
    box.hidden = true;
    shownPoll = "";
    return;
  }
  box.hidden = false;
  if (shownPoll === poll.id + voted.has(poll.id)) return;
  shownPoll = poll.id + voted.has(poll.id);
  const title = document.createElement("h2");
  title.textContent = voted.has(poll.id) ? "THANKS FOR VOTING - WATCH FOR THE VERDICT" : poll.question.toUpperCase();
  const row = document.createElement("div");
  row.className = "options";
  for (const opt of poll.options) {
    const b = document.createElement("button");
    b.textContent = opt.label;
    b.disabled = voted.has(poll.id);
    b.onclick = async () => {
      voted.add(poll.id);
      renderVote();
      const res = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pollId: poll.id, option: opt.id, voter }) });
      if (res.ok) polls.set(poll.id, (await res.json()) as PollResult);
    };
    row.append(b);
  }
  box.replaceChildren(title, row);
}

void refreshTimeline();
void refreshGuide();
void refreshPolls();
setInterval(refreshPolls, 10_000);
setInterval(renderVote, 1000);
setInterval(refreshTimeline, 5000);
setInterval(refreshGuide, 60_000);

const overlay = document.getElementById("tunein");
if (broadcast) {
  overlay?.remove();
  document.body.classList.add("broadcast");
  audio = new AudioDirector();
  void audio.ctx.resume();
  if (ingestUrl) startIngest(canvas, audio.tap(), ingestUrl);
} else {
  overlay?.addEventListener("click", async () => {
    audio = new AudioDirector();
    await audio.ctx.resume();
    overlay.remove();
  });
}

function frame() {
  const now = link.now();
  const sorted = [...segments.values()].sort((a, b) => a.startAt - b.startAt);
  const current = sorted.find((s) => now >= s.startAt && now < s.startAt + s.durationMs);
  const next = sorted.find((s) => s.startAt >= (current ? current.startAt + current.durationMs - 1 : now) && s.kind !== "bumper");
  renderer.draw({
    now,
    polls,
    voteUrl,
    segment: current,
    next,
    guide,
    network: link.network || "…",
    viewers: link.viewers,
    tunedIn: Boolean(audio),
  });
  audio?.update(sorted, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
