import { ENVELOPE_STEP_MS, type CastMember, type Cue, type GuideEntry, type Look, type Segment, type SetId } from "../shared/types.js";

export const W = 320;
export const H = 180;

type Ctx = CanvasRenderingContext2D;

const px = (g: Ctx, color: string, x: number, y: number, w: number, h: number) => {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** Deterministic hash noise so backgrounds don't shimmer between frames. */
const noise = (i: number) => {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------------------------------------------------------------------------
// Sets: background, marks (where cast members stand/sit), and foreground props.

interface Mark {
  x: number;
  /** Feet baseline. */
  y: number;
  seated: boolean;
  /** 1 = facing right, -1 = facing left. */
  face: 1 | -1;
}

interface SetDef {
  marks: Mark[];
  back: (g: Ctx, t: number, ev: SceneEvents) => void;
  front?: (g: Ctx, t: number, ev: SceneEvents) => void;
}

interface SceneEvents {
  /** 0..1 strength of crowd reaction right now. */
  crowd: number;
}

function skyline(g: Ctx, x0: number, y0: number, w: number, h: number, t: number, sky: string) {
  px(g, sky, x0, y0, w, h);
  for (let i = 0; i < 30; i++) {
    const sx = x0 + noise(i) * w;
    const sy = y0 + noise(i + 99) * h * 0.5;
    if (Math.sin(t / 700 + i) > -0.6) px(g, "#ffffffaa", sx, sy, 1, 1);
  }
  let x = x0;
  let i = 0;
  while (x < x0 + w) {
    const bw = 8 + Math.floor(noise(i + 7) * 14);
    const bh = h * (0.25 + noise(i + 3) * 0.55);
    px(g, "#141a33", x, y0 + h - bh, bw, bh);
    for (let wy = y0 + h - bh + 3; wy < y0 + h - 2; wy += 4)
      for (let wx = x + 2; wx < x + bw - 2; wx += 3) if (noise(wx * 3 + wy) > 0.55) px(g, "#f7d36b", wx, wy, 1, 2);
    x += bw + 1;
    i++;
  }
}

const SETS: Record<Exclude<SetId, "bumper">, SetDef> = {
  late_night: {
    marks: [
      { x: 132, y: 120, seated: true, face: 1 }, // host behind desk
      { x: 38, y: 130, seated: false, face: 1 }, // bandleader on riser
      { x: 214, y: 130, seated: true, face: -1 }, // guest couch
      { x: 244, y: 130, seated: true, face: -1 },
    ],
    back: (g, t, ev) => {
      px(g, "#1b1035", 0, 0, W, H);
      skyline(g, 70, 18, 230, 90, t, "#2a1b5c");
      // window frame
      g.strokeStyle = "#5b3d8f";
      g.lineWidth = 2;
      g.strokeRect(70, 18, 230, 90);
      px(g, "#5b3d8f", 184, 18, 2, 90);
      // applause sign
      const lit = ev.crowd > 0.1;
      px(g, lit ? "#ff3355" : "#4a1020", 150, 4, 50, 10);
      g.fillStyle = lit ? "#fff" : "#7a3040";
      g.font = "7px monospace";
      g.fillText("APPLAUSE", 154, 12);
      // band riser + keytar stand
      px(g, "#3a2a5a", 0, 118, 66, 14);
      px(g, "#2a1b44", 0, 131, 66, 3);
      // floor
      px(g, "#2c1f4a", 0, 130, W, 50);
      for (let x = 0; x < W; x += 16) px(g, "#33255a", x, 130, 8, 50);
      // couch back
      px(g, "#8a2a4a", 196, 108, 70, 14);
      px(g, "#a8355a", 196, 106, 70, 3);
    },
    front: (g, t, ev) => {
      // Dee Dee's cracked keytar, slung across the bandleader mark
      px(g, "#e8e8e8", 30, 112, 20, 4);
      for (let k = 0; k < 6; k++) px(g, "#222", 32 + k * 3, 113, 1, 2);
      px(g, "#ff3355", 48, 110, 4, 3);
      px(g, "#444", 41, 112, 1, 4); // the crack
      // desk
      px(g, "#6b3a1f", 110, 110, 54, 24);
      px(g, "#8a4b28", 110, 108, 54, 4);
      px(g, "#ffcc33", 116, 118, 42, 2);
      // mug
      px(g, "#e8e8e8", 152, 103, 5, 5);
      // couch seat front
      px(g, "#a8355a", 196, 121, 70, 10);
      px(g, "#8a2a4a", 194, 112, 4, 19);
      px(g, "#8a2a4a", 264, 112, 4, 19);
      // studio audience silhouettes
      for (let i = 0; i < 22; i++) {
        const bob = ev.crowd > 0.1 ? Math.round(Math.abs(Math.sin(t / 90 + i * 1.7)) * 3 * ev.crowd) : 0;
        const x = i * 15 - 4;
        px(g, "#0d0820", x, 160 - bob, 12, 20);
        px(g, "#0d0820", x + 2, 152 - bob, 8, 9);
      }
    },
  },
  morning_couch: {
    marks: [
      { x: 118, y: 128, seated: true, face: 1 },
      { x: 160, y: 128, seated: true, face: 1 },
      { x: 202, y: 128, seated: true, face: -1 },
    ],
    back: (g, t) => {
      px(g, "#fde2c8", 0, 0, W, H);
      px(g, "#f7c9a8", 0, 0, W, 6);
      // fake window with a sun that "rises" slowly
      px(g, "#a8e0ff", 28, 22, 70, 60);
      const sy = 70 - ((t / 4000) % 40);
      px(g, "#ffd84d", 54, sy, 14, 14);
      px(g, "#ffffff", 28, 50, 70, 2);
      px(g, "#ffffff", 62, 22, 2, 60);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 3;
      g.strokeRect(28, 22, 70, 60);
      // big logo wall
      px(g, "#ff8c42", 190, 20, 100, 44);
      g.fillStyle = "#fff";
      g.font = "bold 12px monospace";
      g.fillText("RISE &", 214, 38);
      g.fillText("PIXEL", 218, 54);
      // plant
      px(g, "#a0522d", 290, 110, 14, 20);
      for (let i = 0; i < 6; i++) px(g, "#3c9d4e", 286 + i * 4, 92 + (i % 2) * 6, 4, 20);
      // floor
      px(g, "#e9b98f", 0, 130, W, 50);
      // couch back
      px(g, "#7fb7be", 96, 104, 130, 18);
      px(g, "#93cdd4", 96, 102, 130, 3);
    },
    front: (g) => {
      px(g, "#93cdd4", 96, 120, 130, 12);
      px(g, "#7fb7be", 92, 108, 6, 24);
      px(g, "#7fb7be", 224, 108, 6, 24);
      // coffee table + mugs
      px(g, "#b07a4f", 120, 146, 80, 6);
      px(g, "#8a5a36", 126, 152, 4, 12);
      px(g, "#8a5a36", 190, 152, 4, 12);
      px(g, "#ffffff", 140, 140, 5, 6);
      px(g, "#ff6b6b", 170, 140, 5, 6);
    },
  },
  soap_livingroom: {
    marks: [
      { x: 70, y: 140, seated: false, face: 1 },
      { x: 128, y: 142, seated: false, face: 1 },
      { x: 192, y: 142, seated: false, face: -1 },
      { x: 250, y: 140, seated: false, face: -1 },
    ],
    back: (g, t) => {
      px(g, "#2a1612", 0, 0, W, H);
      for (let x = 0; x < W; x += 12) px(g, "#331c16", x, 0, 6, 140);
      skyline(g, 110, 14, 100, 88, t, "#0e1430");
      g.strokeStyle = "#c9a227";
      g.lineWidth = 2;
      g.strokeRect(110, 14, 100, 88);
      // curtains
      px(g, "#6b0f1a", 96, 10, 16, 100);
      px(g, "#6b0f1a", 208, 10, 16, 100);
      // chandelier
      px(g, "#c9a227", 158, 0, 2, 8);
      px(g, "#c9a227", 148, 8, 22, 3);
      for (let i = 0; i < 4; i++) px(g, Math.sin(t / 300 + i) > 0 ? "#fff4b0" : "#ffe680", 150 + i * 6, 11, 2, 3);
      // fireplace
      px(g, "#4a3a35", 14, 86, 44, 54);
      px(g, "#1a0e0a", 22, 104, 28, 36);
      for (let i = 0; i < 5; i++) px(g, i % 2 ? "#ff7b00" : "#ffcc00", 26 + i * 5, 130 - Math.abs(Math.sin(t / 120 + i)) * 10, 3, 10);
      // portrait of Victoria
      px(g, "#c9a227", 252, 30, 34, 42);
      px(g, "#4b0f2e", 255, 33, 28, 36);
      px(g, "#f1d1b5", 264, 40, 10, 10);
      // floor
      px(g, "#1a0f0c", 0, 140, W, 40);
      px(g, "#5a1020", 40, 148, 240, 26);
    },
  },
  basement: {
    marks: [
      { x: 108, y: 132, seated: true, face: 1 },
      { x: 152, y: 132, seated: true, face: 1 },
      { x: 196, y: 132, seated: true, face: -1 },
    ],
    back: (g, t) => {
      px(g, "#6b4a2b", 0, 0, W, H);
      for (let x = 0; x < W; x += 10) px(g, x % 20 ? "#5e4026" : "#7a5634", x, 0, 2, 132);
      // posters
      px(g, "#2b59c3", 20, 20, 30, 40);
      px(g, "#ffd23f", 26, 28, 18, 18);
      px(g, "#c0392b", 268, 16, 32, 44);
      px(g, "#f5f5f5", 274, 24, 20, 6);
      // CRT on a stand, flickering with "gameplay"
      px(g, "#3a3a3a", 228, 70, 40, 34);
      px(g, "#222", 232, 74, 32, 24);
      for (let i = 0; i < 6; i++) px(g, ["#4ade80", "#60a5fa", "#f472b6"][i % 3], 234 + ((t / 50 + i * 9) % 28), 78 + i * 3, 3, 2);
      px(g, "#2a2a2a", 232, 104, 32, 26);
      // lava lamp
      px(g, "#444", 72, 100, 8, 4);
      px(g, "#ff4fa3", 73, 82 + Math.sin(t / 900) * 4, 6, 8);
      px(g, "#444", 72, 112, 8, 18);
      // shag carpet
      px(g, "#8f7a3a", 0, 132, W, 48);
      for (let i = 0; i < 120; i++) px(g, "#a08a46", noise(i) * W, 134 + noise(i + 50) * 44, 2, 1);
      // couch back
      px(g, "#7a6a2e", 88, 104, 130, 18);
    },
    front: (g) => {
      px(g, "#8c7a36", 88, 122, 130, 12);
      px(g, "#6b5c26", 84, 108, 6, 26);
      px(g, "#6b5c26", 216, 108, 6, 26);
      // snack bowl
      px(g, "#d35400", 140, 150, 24, 6);
      px(g, "#f1c40f", 143, 147, 18, 4);
    },
  },
};

// ---------------------------------------------------------------------------
// Characters

interface Pose {
  mouth: number; // 0..9
  emotion: Cue["emotion"];
  blink: boolean;
  dx: number;
  dy: number;
  armUp: boolean;
  face: 1 | -1;
}

function drawHair(g: Ctx, look: Look, hx: number, hy: number) {
  const c = look.hair;
  switch (look.hairStyle) {
    case "bald":
      break;
    case "short":
      px(g, c, hx - 1, hy - 2, 12, 4);
      px(g, c, hx - 1, hy, 2, 3);
      break;
    case "long":
      px(g, c, hx - 2, hy - 2, 14, 4);
      px(g, c, hx - 2, hy, 3, 14);
      px(g, c, hx + 9, hy, 3, 14);
      break;
    case "bob":
      px(g, c, hx - 2, hy - 2, 14, 4);
      px(g, c, hx - 2, hy, 3, 9);
      px(g, c, hx + 9, hy, 3, 9);
      break;
    case "bun":
      px(g, c, hx - 1, hy - 2, 12, 4);
      px(g, c, hx + 3, hy - 6, 5, 5);
      break;
    case "afro":
      px(g, c, hx - 4, hy - 6, 18, 9);
      px(g, c, hx - 4, hy + 2, 3, 6);
      px(g, c, hx + 11, hy + 2, 3, 6);
      break;
    case "mohawk":
      px(g, c, hx + 3, hy - 6, 4, 7);
      break;
    case "spiky":
      for (let i = 0; i < 5; i++) px(g, c, hx - 1 + i * 2.5, hy - 4 + (i % 2) * 2, 2, 5);
      px(g, c, hx - 1, hy - 1, 12, 2);
      break;
  }
}

function drawCharacter(g: Ctx, look: Look, mark: Mark, p: Pose) {
  const h = look.height;
  const x = mark.x + p.dx;
  const feet = mark.y + p.dy + (mark.seated ? 8 : 0);
  const headH = 10;
  const torsoH = Math.round(h * 0.38);
  const legH = h - headH - torsoH;
  const top = feet - h;
  const hx = x - 5; // head left
  const hy = top;
  const tx = x - 6; // torso left
  const ty = top + headH;

  // legs
  px(g, look.pants, tx + 1, ty + torsoH, 4, legH);
  px(g, look.pants, tx + 7, ty + torsoH, 4, legH);
  px(g, "#1a1a1a", tx, feet - 2, 5, 2);
  px(g, "#1a1a1a", tx + 7, feet - 2, 5, 2);
  // torso + arms
  px(g, look.shirt, tx, ty, 12, torsoH);
  px(g, shade(look.shirt, -0.12), tx, ty + torsoH - 2, 12, 2);
  if (p.armUp) {
    const ax = p.face === 1 ? tx + 12 : tx - 3;
    px(g, look.shirt, ax, ty - 6, 3, 9);
    px(g, look.skin, ax, ty - 9, 3, 3);
  } else {
    px(g, shade(look.shirt, -0.08), tx - 2, ty + 1, 2, torsoH - 3);
    px(g, shade(look.shirt, -0.08), tx + 12, ty + 1, 2, torsoH - 3);
    px(g, look.skin, tx - 2, ty + torsoH - 2, 2, 2);
    px(g, look.skin, tx + 12, ty + torsoH - 2, 2, 2);
  }
  // neck + head
  px(g, look.skin, x - 2, ty - 1, 4, 2);
  px(g, look.skin, hx, hy, 10, headH);
  px(g, shade(look.skin, -0.08), hx, hy + headH - 1, 10, 1);

  // face: eyes look toward where the character is facing
  const ex = hx + (p.face === 1 ? 3 : 2);
  const ey = hy + 4;
  if (p.blink) {
    px(g, "#1a1a1a", ex, ey + 1, 2, 1);
    px(g, "#1a1a1a", ex + 4, ey + 1, 2, 1);
  } else {
    px(g, "#1a1a1a", ex + (p.face === 1 ? 1 : 0), ey, 1, 2);
    px(g, "#1a1a1a", ex + 4 + (p.face === 1 ? 1 : 0), ey, 1, 2);
  }
  // brows by emotion
  const brow = "#2a1a10";
  switch (p.emotion) {
    case "angry":
      px(g, brow, ex, ey - 2, 1, 1);
      px(g, brow, ex + 1, ey - 1, 1, 1);
      px(g, brow, ex + 5, ey - 2, 1, 1);
      px(g, brow, ex + 4, ey - 1, 1, 1);
      break;
    case "sad":
    case "nervous":
      px(g, brow, ex + 1, ey - 2, 1, 1);
      px(g, brow, ex, ey - 1, 1, 1);
      px(g, brow, ex + 4, ey - 2, 1, 1);
      px(g, brow, ex + 5, ey - 1, 1, 1);
      break;
    case "surprised":
      px(g, brow, ex, ey - 3, 2, 1);
      px(g, brow, ex + 4, ey - 3, 2, 1);
      break;
    case "smug":
      px(g, brow, ex, ey - 2, 2, 1);
      px(g, brow, ex + 4, ey - 3, 2, 1);
      break;
    default:
      px(g, brow, ex, ey - 2, 2, 1);
      px(g, brow, ex + 4, ey - 2, 2, 1);
  }
  // mouth: open height follows the voice envelope
  const mx = hx + 3;
  const my = hy + 7;
  const open = p.mouth >= 6 ? 2 : p.mouth >= 2 ? 1 : 0;
  if (open) {
    px(g, "#3a0a0a", mx, my, 4, open + 1);
    if (open === 2) px(g, "#c0392b", mx + 1, my + 2, 2, 1);
  } else if (p.emotion === "happy" || p.emotion === "smug") {
    px(g, "#3a0a0a", mx, my, 1, 1);
    px(g, "#3a0a0a", mx + 1, my + 1, 2, 1);
    px(g, "#3a0a0a", mx + 3, p.emotion === "smug" ? my - 1 : my, 1, 1);
  } else if (p.emotion === "sad" || p.emotion === "angry") {
    px(g, "#3a0a0a", mx, my + 1, 1, 1);
    px(g, "#3a0a0a", mx + 1, my, 2, 1);
    px(g, "#3a0a0a", mx + 3, my + 1, 1, 1);
  } else {
    px(g, "#3a0a0a", mx, my, 4, 1);
  }

  drawHair(g, look, hx, hy);
  switch (look.accessory) {
    case "glasses":
      g.strokeStyle = "#222";
      g.lineWidth = 1;
      g.strokeRect(ex - 0.5, ey - 0.5, 3, 3);
      g.strokeRect(ex + 3.5, ey - 0.5, 3, 3);
      break;
    case "shades":
      px(g, "#000", ex - 1, ey - 1, 8, 3);
      break;
    case "hat":
      px(g, "#222", hx - 3, hy - 2, 16, 2);
      px(g, "#222", hx, hy - 7, 10, 5);
      break;
    case "beanie":
      px(g, "#c0392b", hx - 1, hy - 4, 12, 6);
      px(g, "#e74c3c", hx - 1, hy + 1, 12, 1);
      break;
    case "bowtie":
      px(g, "#d4af37", x - 3, ty, 2, 3);
      px(g, "#d4af37", x + 1, ty, 2, 3);
      px(g, "#b8962e", x - 1, ty + 1, 2, 1);
      break;
    case "earrings":
      px(g, "#ffd700", hx - 1, hy + 6, 1, 2);
      px(g, "#ffd700", hx + 10, hy + 6, 1, 2);
      break;
    case "headphones":
      px(g, "#333", hx - 1, hy - 3, 12, 1);
      px(g, "#333", hx - 2, hy + 3, 2, 4);
      px(g, "#333", hx + 10, hy + 3, 2, 4);
      break;
  }
}

// ---------------------------------------------------------------------------
// Scene state: who's speaking, who's on set, what they're doing at time t.

function envAt(cue: Cue, local: number): number {
  const i = Math.floor((local - cue.t) / ENVELOPE_STEP_MS);
  const ch = cue.env[i];
  return ch === undefined ? 0 : Number(ch);
}

interface CastState {
  member: CastMember;
  present: boolean;
  /** -1..1: walking off (negative = toward left edge) progress, used for slide animation. */
  slide: number;
}

function castStates(seg: Segment, local: number, marks: Mark[]): CastState[] {
  return seg.cast.map((member) => {
    let present = member.onSetAtStart;
    let slide = 0;
    const mark = marks[member.mark % marks.length];
    const edge = mark.x < W / 2 ? -1 : 1;
    for (const c of seg.cues) {
      if (c.speaker !== member.id) continue;
      if (c.t > local) break;
      const p = Math.min(1, (local - c.t) / Math.max(400, c.dur + 900));
      if (c.action === "walk_off") {
        present = p < 1;
        slide = present ? edge * Math.max(0, (local - c.t - c.dur) / 900) : 0;
      } else if (c.action === "enter") {
        present = true;
        const q = Math.min(1, (local - c.t) / 900);
        slide = edge * (1 - q);
      }
    }
    // Not yet entered: hidden until their 'enter' cue.
    if (!member.onSetAtStart && !seg.cues.some((c) => c.speaker === member.id && c.action === "enter" && c.t <= local)) present = false;
    return { member, present, slide };
  });
}

// ---------------------------------------------------------------------------
// Public renderer

export interface Frame {
  now: number;
  segment?: Segment;
  next?: Segment;
  guide: GuideEntry[];
  network: string;
  viewers: number;
  tunedIn: boolean;
}

export class Renderer {
  private scene: Ctx;
  private sceneCanvas: HTMLCanvasElement;
  constructor(private out: HTMLCanvasElement) {
    this.sceneCanvas = document.createElement("canvas");
    this.sceneCanvas.width = W;
    this.sceneCanvas.height = H;
    this.scene = this.sceneCanvas.getContext("2d")!;
  }

  draw(f: Frame) {
    const g = this.scene;
    const seg = f.segment;
    if (!seg) this.standby(g, f.now);
    else if (seg.set === "bumper") this.bumper(g, f.now, seg, f.network);
    else this.show(g, seg, f.now);

    // Upscale crisply, then draw text at full resolution on top.
    const o = this.out.getContext("2d")!;
    const scale = Math.floor(Math.min(this.out.width / W, this.out.height / H)) || 1;
    o.imageSmoothingEnabled = false;
    o.fillStyle = "#000";
    o.fillRect(0, 0, this.out.width, this.out.height);
    const ox = Math.floor((this.out.width - W * scale) / 2);
    const oy = Math.floor((this.out.height - H * scale) / 2);
    o.drawImage(this.sceneCanvas, ox, oy, W * scale, H * scale);
    this.overlay(o, f, ox, oy, scale);
  }

  private show(g: Ctx, seg: Segment, now: number) {
    const set = SETS[seg.set as Exclude<SetId, "bumper">];
    const local = now - seg.startAt;
    const cue = seg.cues.find((c) => local >= c.t && local < c.t + c.dur);
    const crowd = seg.cues.reduce((acc, c) => {
      if (c.action !== "applause" && c.action !== "laugh") return acc;
      const d = local - c.t;
      return d >= 0 && d < 2200 ? Math.max(acc, 1 - d / 2200) : acc;
    }, 0);
    const ev: SceneEvents = { crowd };
    set.back(g, now, ev);

    for (const st of castStates(seg, local, set.marks)) {
      if (!st.present) continue;
      const mark = set.marks[st.member.mark % set.marks.length];
      const speaking = cue?.speaker === st.member.id ? cue : undefined;
      const own = [...seg.cues].reverse().find((c) => c.speaker === st.member.id && c.t <= local);
      const action = own && local - own.t < own.dur + 600 ? own.action : "none";
      // Face whoever they're talking to; listeners face the speaker.
      let face = mark.face;
      const targetId = speaking?.target ?? (cue && cue.speaker !== st.member.id ? cue.speaker : undefined);
      const target = seg.cast.find((c) => c.id === targetId);
      if (target) face = set.marks[target.mark % set.marks.length].x >= mark.x ? 1 : -1;
      else if (speaking && (speaking.target === "camera" || speaking.target === "audience")) face = mark.face;

      const mouth = speaking ? envAt(speaking, local) : 0;
      const seed = st.member.id.charCodeAt(0);
      const blink = (now + seed * 777) % 4200 < 120;
      let dx = st.slide * 140;
      let dy = 0;
      if (speaking && mouth > 5) dy -= 1;
      if (action === "laugh") dy -= Math.abs(Math.sin(now / 70)) * 2;
      if (action === "lean_in") dx += face * 3;
      if (action === "stand" && mark.seated) dy -= 8;
      if (action === "dance") {
        // Deliberately jerky: snap between poses on a stepped clock.
        const step = Math.floor(now / 180) % 4;
        dx += [0, 2, 0, -2][step];
        dy -= step % 2;
      }
      drawCharacter(g, st.member.look, mark, {
        mouth,
        // Listeners keep the expression from their own last line for a few seconds.
        emotion: speaking?.emotion ?? (own && local - own.t < own.dur + 4000 ? own.emotion : "neutral"),
        blink,
        dx,
        dy,
        armUp: action === "gesture" || action === "applause" || (action === "dance" && Math.floor(now / 360) % 2 === 0),
        face,
      });
    }
    set.front?.(g, now, ev);
  }

  private bumper(g: Ctx, now: number, seg: Segment, network: string) {
    const t = now - seg.startAt;
    const colors = ["#ff3355", "#ff9f1c", "#ffe066", "#2ec4b6", "#3a86ff", "#8338ec"];
    for (let i = 0; i < colors.length; i++) {
      const off = ((t / 20 + i * 30) % (W + 60)) - 60;
      px(g, colors[i], 0, i * 30, W, 30);
      px(g, shade(colors[i], 0.15), off, i * 30, 60, 30);
    }
    px(g, "#000000cc", 40, 60, 240, 60);
    g.fillStyle = "#fff";
    g.font = "bold 18px monospace";
    g.textAlign = "center";
    g.fillText(network.toUpperCase(), W / 2, 92);
    g.font = "8px monospace";
    g.fillText(seg.title, W / 2, 108);
    g.textAlign = "left";
  }

  private standby(g: Ctx, now: number) {
    const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
    bars.forEach((c, i) => px(g, c, (i * W) / 7, 0, W / 7 + 1, 120));
    px(g, "#101010", 0, 120, W, 60);
    for (let i = 0; i < 400; i++) px(g, noise(i + Math.floor(now / 80)) > 0.5 ? "#2a2a2a" : "#151515", noise(i) * W, 120 + noise(i * 3) * 60, 2, 1);
    px(g, "#000", 70, 70, 180, 30);
    g.fillStyle = "#fff";
    g.font = "bold 12px monospace";
    g.textAlign = "center";
    g.fillText("PLEASE STAND BY", W / 2, 90);
    g.textAlign = "left";
  }

  private overlay(o: Ctx, f: Frame, ox: number, oy: number, s: number) {
    const seg = f.segment;
    const font = (size: number) => `${Math.round(size * s)}px "Press Start 2P", monospace`;
    o.textBaseline = "top";

    // Network bug, top-left.
    o.fillStyle = "#000000aa";
    o.fillRect(ox + 4 * s, oy + 4 * s, 96 * s, 12 * s);
    o.fillStyle = "#fff";
    o.font = font(4.5);
    o.fillText(f.network.toUpperCase(), ox + 7 * s, oy + 8 * s);
    const tag = !seg ? "OFF AIR" : seg.kind === "rerun" ? "ENCORE" : seg.kind === "bumper" ? "" : "LIVE";
    if (tag) {
      o.fillStyle = seg?.kind === "live" ? "#ff3355" : "#3a86ff";
      o.fillRect(ox + 104 * s, oy + 4 * s, 34 * s, 12 * s);
      o.fillStyle = "#fff";
      o.fillText(tag, ox + 107 * s, oy + 8 * s);
    }
    o.textAlign = "right";
    o.fillStyle = "#ffffffcc";
    o.font = font(3.5);
    o.fillText(`${f.viewers} watching`, ox + (W - 5) * s, oy + 7 * s);
    o.textAlign = "left";

    if (!seg || seg.set === "bumper") return;
    const local = f.now - seg.startAt;

    // Lower third: show + segment title for the first few seconds, and again near the end with "up next".
    const remaining = seg.durationMs - local;
    if (local < 7000 || (remaining < 6000 && f.next)) {
      const upNext = local >= 7000 && f.next;
      o.fillStyle = "#ff3355";
      o.fillRect(ox + 8 * s, oy + 118 * s, 6 * s, 22 * s);
      o.fillStyle = "#000000cc";
      o.fillRect(ox + 14 * s, oy + 118 * s, 220 * s, 22 * s);
      o.fillStyle = "#ffe066";
      o.font = font(4);
      o.fillText(upNext ? "UP NEXT" : seg.showTitle.toUpperCase(), ox + 18 * s, oy + 122 * s);
      o.fillStyle = "#fff";
      o.font = font(5);
      o.fillText(clip(upNext ? `${f.next!.showTitle}: ${f.next!.title}` : seg.title, 40), ox + 18 * s, oy + 131 * s);
    }

    // Closed captions.
    const cue = seg.cues.find((c) => local >= c.t && local < c.t + c.dur + 250);
    if (cue) {
      const name = seg.cast.find((c) => c.id === cue.speaker)?.name ?? cue.speaker;
      const lines = wrap(`${name.toUpperCase()}: ${cue.text}`, 54);
      const boxH = (lines.length * 7 + 5) * s;
      o.fillStyle = "#000000d9";
      o.fillRect(ox + 10 * s, oy + (H - 6) * s - boxH, (W - 20) * s, boxH);
      o.fillStyle = "#fff";
      o.font = font(4);
      lines.forEach((l, i) => o.fillText(l, ox + 14 * s, oy + (H - 6) * s - boxH + (3 + i * 7) * s));
    }
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > width) {
      out.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) out.push(line);
  return out.slice(-3);
}
