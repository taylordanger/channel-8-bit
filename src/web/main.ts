import type { GuideEntry, PollResult, Segment } from "../shared/types.js";
import { AudioDirector } from "./audio.js";
import { Renderer } from "./render.js";
import { StationLink } from "./sync.js";
import { startIngest } from "./ingest.js";
import { ChatPanel } from "./chat.js";

// Broadcast mode (/broadcast.html, or ?broadcast=1): a clean full-frame picture with sound on
// from the start - what the restreamer captures. ?ingest=ws://... also records and sends it.
const params = new URLSearchParams(location.search);
const broadcast = params.has("broadcast") || location.pathname.endsWith("/broadcast.html");
const ingestUrl = params.get("ingest");
// Clip mode (?clip=<segment id>): replay one archived scene from its start, record it, stop.
const clipId = params.get("clip");
let clipNow: (() => number) | undefined;
let clipNetwork = "";
const stationNow = () => (clipNow ? clipNow() : link.now());

const segments = new Map<string, Segment>();
const polls = new Map<string, PollResult>();
let voteUrl = "";
let chat: ChatPanel | undefined;
let guide: GuideEntry[] = [];
let audio: AudioDirector | undefined;

const addSegment = (s: Segment) => segments.set(s.id, s);
// Station time can differ from this browser's clock (skew, or a time-shifted rehearsal),
// so fetch the timeline again the moment we learn the server's clock.
const link = new StationLink({
  onSegment: addSegment,
  onSync: () => void refreshTimeline(),
  onChat: (m) => chat?.add(m),
  onChatDelete: (id) => chat?.remove(id),
  onChatError: (e) => chat?.flash(e),
  onPoll: (r) => {
    polls.set(r.pollId, r);
    renderVote();
  },
  onRetract: (ids) => {
    for (const id of ids) segments.delete(id);
    audio?.retract(ids);
  },
});
if (!clipId) link.connect();
const chatRoot = document.getElementById("chat");
if (chatRoot && !broadcast) chat = new ChatPanel(chatRoot, (h, t) => link.sendChat(h, t));

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
  if (clipId) return;
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
  if (clipId) return;
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

/** "Shop this ad" under the TV while a commercial airs. */
function renderShop() {
  const box = document.getElementById("shop");
  if (!box) return;
  const now = link.now();
  const seg = [...segments.values()].find((s) => s.ad && now >= s.startAt && now < s.startAt + s.durationMs + 15_000);
  if (!seg?.ad) {
    box.hidden = true;
    return;
  }
  if (box.dataset.id === seg.id && !box.hidden) return;
  box.dataset.id = seg.id;
  box.hidden = false;
  const a = document.createElement("a");
  a.href = seg.ad.link;
  a.target = "_blank";
  a.rel = "sponsored noopener";
  a.textContent = `SHOP THIS AD: ${seg.ad.title} →`;
  const small = document.createElement("small");
  small.textContent = `Paid link. ${seg.ad.disclosure}`;
  box.replaceChildren(a, small);
}
setInterval(renderShop, 1000);
fetch("/api/now")
  .then((r) => r.json())
  .then((d: { ads?: boolean }) => {
    const foot = document.getElementById("disclosure");
    if (foot && d.ads) foot.hidden = false;
  })
  .catch(() => {});

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
  if (clipId && ingestUrl) void startClip(clipId, audio, ingestUrl);
  else if (ingestUrl) startIngest(canvas, audio.tap(), ingestUrl);
} else {
  overlay?.addEventListener("click", async () => {
    audio = new AudioDirector();
    await audio.ctx.resume();
    overlay.remove();
    link.tuneIn();
  });
}

// "That was funny": one tap per scene. The control room uses these to pick clips.
const funnyBtn = document.getElementById("funny") as HTMLButtonElement | null;
const laughed = new Set<string>();
const sceneNow = () => [...segments.values()].find((s) => stationNow() >= s.startAt && stationNow() < s.startAt + s.durationMs && s.kind !== "bumper" && !s.ad);
if (funnyBtn) {
  setInterval(() => {
    const s = sceneNow();
    funnyBtn.disabled = !s || laughed.has(s.id);
  }, 1000);
  funnyBtn.addEventListener("click", async () => {
    const s = sceneNow();
    if (!s) return;
    laughed.add(s.id);
    funnyBtn.disabled = true;
    const res = await fetch("/api/funny", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ segmentId: s.id, voter }) }).catch(() => undefined);
    const note = document.getElementById("funny-note");
    if (note) note.textContent = res?.ok ? "Noted - the best moments get clipped." : "";
  });
}

/** Play one segment on a private clock starting shortly from now, recording exactly its length. */
async function startClip(id: string, director: AudioDirector, url: string) {
  const seg = (await (await fetch(`/api/segment/${encodeURIComponent(id)}`)).json()) as Segment;
  clipNetwork = ((await (await fetch("/api/now")).json()) as { network?: string }).network ?? "";
  const lead = 2500; // time to fetch the voices before the first frame we keep
  const t0 = performance.now() + lead;
  clipNow = () => seg.startAt + (performance.now() - t0);
  segments.set(seg.id, { ...seg, poll: undefined });
  // Start just after the scene does (its first moment is silent lead-in), so the first frame of
  // the video is the scene itself rather than a "please stand by" card.
  window.setTimeout(() => {
    const rec = startIngest(canvas, director.tap(), url, { reconnect: false });
    window.setTimeout(() => rec.stop(), seg.durationMs + 400);
  }, lead + 120);
}

function frame() {
  const now = stationNow();
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
    network: clipNetwork || link.network || "…",
    viewers: link.viewers,
    clip: Boolean(clipId),
    tunedIn: Boolean(audio),
  });
  audio?.update(sorted, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
