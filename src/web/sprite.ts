import type { Emotion, Look } from "../shared/types.js";

/**
 * Procedural chibi character sprites. Each character is drawn facing right into a
 * small offscreen canvas, outlined, then flipped to face left when needed - so
 * asymmetric details (hair swoops, gesturing arms, mic booms) mirror for free.
 */

export const SPRITE_W = 48;
export const SPRITE_H = 72;
/** Feet position inside the sprite canvas. */
const CX = 24;
const FEET = 69;
const OUTLINE = "#120a1a";

export interface Pose {
  /** 0..9 voice envelope. */
  mouth: number;
  emotion: Emotion;
  blink: boolean;
  /** 0 or 1: breathing offset for the upper body. */
  breathe: number;
  armUp: boolean;
  /** Both hands up clapping. */
  clap: boolean;
  facing: 1 | -1;
  /** Station time, for animated details (glitching). */
  t: number;
}

type G = CanvasRenderingContext2D;

const px = (g: G, color: string, x: number, y: number, w: number, h: number) => {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const BODY_W: Record<Look["build"], number> = { slim: 10, average: 12, broad: 17, round: 16, tiny: 10 };
const LEG_W: Record<Look["build"], number> = { slim: 3, average: 4, broad: 5, round: 4, tiny: 3 };

const has = (look: Look, a: Look["accessories"][number]) => look.accessories.includes(a);

// --- hair ------------------------------------------------------------------

/** Hair that sits behind the head and body. */
function hairBack(g: G, look: Look, hx: number, hy: number) {
  const c = shade(look.hair, -0.08);
  switch (look.hairStyle) {
    case "long":
      px(g, c, hx - 2, hy + 2, 18, 24);
      break;
    case "bob":
      px(g, c, hx - 2, hy + 2, 18, 12);
      break;
    case "huge":
      px(g, c, hx - 6, hy - 4, 26, 26);
      px(g, c, hx - 4, hy + 22, 22, 4);
      break;
    case "afro":
      px(g, c, hx - 5, hy - 7, 24, 18);
      px(g, c, hx - 3, hy - 9, 20, 3);
      break;
    case "ponytail":
      px(g, c, hx - 5, hy + 1, 5, 4);
      px(g, c, hx - 7, hy + 4, 4, 12);
      break;
    case "beehive":
      // A towering column of hair, slightly narrower at the top.
      px(g, c, hx, hy - 20, 15, 22);
      px(g, c, hx + 2, hy - 24, 11, 5);
      px(g, shade(look.hair, 0.12), hx + 4, hy - 22, 3, 18);
      break;
    case "fringe":
      px(g, c, hx - 1, hy + 2, 3, 7);
      px(g, c, hx - 2, hy + 4, 2, 6);
      break;
    case "wild":
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        px(g, look.hair, hx + 7 + Math.cos(a) * 10 - 2, hy + 3 + Math.sin(a) * 8 - 2, 5, 5);
      }
      break;
  }
}

/** Hair that frames the face, drawn after the head. */
function hairFront(g: G, look: Look, hx: number, hy: number) {
  const c = look.hair;
  const hi = shade(look.hair, 0.15);
  switch (look.hairStyle) {
    case "bald":
      px(g, "#ffffff55", hx + 8, hy + 1, 3, 1);
      // A couple of stray hairs, for the cartoon dads of the world.
      if (look.facial === "stubble") {
        px(g, c, hx + 5, hy - 3, 1, 3);
        px(g, c, hx + 8, hy - 3, 1, 3);
      }
      break;
    case "beehive":
      px(g, look.hair, hx - 1, hy - 2, 17, 5);
      px(g, look.hair, hx - 1, hy + 2, 3, 5);
      break;
    case "fringe":
      px(g, "#ffffff44", hx + 7, hy + 1, 3, 1);
      px(g, look.hair, hx + 13, hy + 3, 2, 4);
      break;
    case "short":
      px(g, c, hx - 1, hy - 2, 16, 4);
      px(g, c, hx - 1, hy + 2, 3, 4);
      px(g, hi, hx + 4, hy - 2, 6, 1);
      break;
    case "pompadour":
      px(g, c, hx - 1, hy - 3, 15, 5);
      px(g, c, hx + 4, hy - 8, 13, 6);
      px(g, c, hx + 10, hy - 6, 8, 4);
      px(g, hi, hx + 6, hy - 8, 8, 1);
      px(g, c, hx - 1, hy + 2, 3, 5);
      break;
    case "swoop":
      px(g, c, hx - 1, hy - 3, 16, 5);
      px(g, c, hx + 6, hy + 1, 9, 3);
      px(g, c, hx + 10, hy + 3, 5, 2);
      px(g, c, hx - 1, hy + 2, 3, 6);
      break;
    case "long":
    case "bob":
      px(g, c, hx - 2, hy - 3, 18, 5);
      px(g, c, hx - 2, hy + 2, 4, look.hairStyle === "long" ? 14 : 9);
      px(g, hi, hx + 3, hy - 3, 8, 1);
      break;
    case "huge":
      px(g, c, hx - 4, hy - 6, 22, 8);
      px(g, c, hx - 5, hy + 2, 5, 14);
      px(g, hi, hx, hy - 6, 12, 2);
      break;
    case "bun":
      px(g, c, hx - 1, hy - 2, 16, 4);
      px(g, c, hx + 4, hy - 8, 7, 6);
      px(g, hi, hx + 5, hy - 8, 3, 1);
      break;
    case "afro":
      px(g, c, hx - 4, hy - 7, 22, 9);
      px(g, hi, hx, hy - 7, 8, 1);
      break;
    case "mohawk":
      px(g, c, hx + 4, hy - 9, 5, 10);
      px(g, hi, hx + 5, hy - 9, 2, 3);
      break;
    case "spiky":
      for (let i = 0; i < 6; i++) px(g, c, hx - 1 + i * 3, hy - 6 + (i % 2) * 2, 3, 7);
      px(g, c, hx - 1, hy - 1, 16, 3);
      break;
    case "ponytail":
      px(g, c, hx - 1, hy - 2, 16, 4);
      px(g, c, hx - 1, hy + 2, 3, 3);
      break;
    case "wild":
      px(g, c, hx - 2, hy - 4, 18, 6);
      for (let i = 0; i < 5; i++) px(g, c, hx - 3 + i * 4, hy - 7 - (i % 2) * 2, 3, 4);
      break;
  }
}

// --- face ------------------------------------------------------------------

function face(g: G, look: Look, p: Pose, hx: number, hy: number) {
  const ink = "#1a1016";
  const ex = hx + 6; // eyes shifted toward the facing side (3/4 view)
  const ey = hy + 6;
  const eyeShut = p.blink || (look.eyes === "sleepy" && p.emotion === "neutral" && p.mouth === 0 && (p.t / 1000) % 6 < 0.3);

  // eyes
  for (const x of [ex, ex + 5]) {
    if (eyeShut) {
      px(g, ink, x, ey + 1, 2, 1);
      continue;
    }
    switch (look.eyes) {
      case "wide":
        px(g, "#ffffff", x - 1, ey - 1, 3, 3);
        px(g, ink, x + 1, ey, 1, 2);
        break;
      case "sleepy":
        px(g, shade(look.skin, -0.18), x - 1, ey - 1, 3, 1);
        px(g, ink, x, ey, 2, 1);
        break;
      case "lashes":
        px(g, ink, x, ey, 2, 2);
        px(g, ink, x + 2, ey - 1, 1, 1);
        break;
      case "beady":
        px(g, ink, x + 1, ey, 1, 1);
        break;
      default:
        px(g, ink, x + 1, ey, 1, 2);
    }
  }

  // brows tell the emotion
  const brow = shade(look.hair, -0.1);
  const b = (x: number, y: number) => px(g, brow, x, y, 1, 1);
  for (const x of [ex, ex + 5]) {
    switch (p.emotion) {
      case "angry":
        b(x - 1, ey - 3);
        b(x, ey - 2);
        b(x + 1, ey - 2);
        break;
      case "sad":
      case "nervous":
        b(x - 1, ey - 2);
        b(x, ey - 3);
        b(x + 1, ey - 3);
        break;
      case "surprised":
        px(g, brow, x - 1, ey - 4, 3, 1);
        break;
      case "smug":
        px(g, brow, x - 1, x === ex ? ey - 2 : ey - 4, 3, 1);
        break;
      default:
        px(g, brow, x - 1, ey - 3, 3, 1);
    }
  }
  if (p.emotion === "nervous") px(g, "#8fd3ff", hx + 2, hy + 3, 1, 2); // sweat drop

  // nose
  const nose = shade(look.skin, -0.16);
  switch (look.nose) {
    case "small":
      px(g, nose, hx + 12, ey + 2, 1, 1);
      break;
    case "big":
      px(g, nose, hx + 11, ey + 1, 3, 3);
      px(g, shade(look.skin, 0.06), hx + 11, ey + 1, 1, 1);
      break;
    case "long":
      px(g, look.skin, hx + 13, ey + 1, 4, 2);
      px(g, nose, hx + 13, ey + 2, 4, 1);
      break;
  }

  // cheeks / facial hair (drawn before the mouth so the mouth stays readable)
  switch (look.facial) {
    case "blush":
      px(g, "#ff7a9c", hx + 4, ey + 3, 2, 1);
      px(g, "#ff7a9c", hx + 11, ey + 3, 2, 1);
      break;
    case "freckles":
      for (const [x, y] of [[4, 3], [6, 4], [11, 3], [12, 4]]) px(g, shade(look.skin, -0.22), hx + x, ey + y, 1, 1);
      break;
    case "stubble":
      for (let i = 0; i < 9; i++) px(g, shade(look.skin, -0.25), hx + 3 + ((i * 5) % 11), hy + 10 + (i % 3), 1, 1);
      break;
    case "beard":
      px(g, look.hair, hx, hy + 9, 15, 5);
      px(g, look.hair, hx + 2, hy + 14, 11, 2);
      break;
  }

  // mouth: open height follows the voice
  const mx = hx + 6;
  const my = hy + 10;
  const open = p.mouth >= 7 ? 3 : p.mouth >= 4 ? 2 : p.mouth >= 1 ? 1 : 0;
  if (open) {
    px(g, "#3a0a14", mx, my, 5, open + 1);
    if (open >= 2) px(g, "#ffffff", mx + 1, my, 3, 1);
    if (open === 3) px(g, "#d9435a", mx + 1, my + 3, 3, 1);
  } else if (p.emotion === "happy") {
    px(g, "#3a0a14", mx, my, 1, 1);
    px(g, "#3a0a14", mx + 1, my + 1, 3, 1);
    px(g, "#3a0a14", mx + 4, my, 1, 1);
  } else if (p.emotion === "smug") {
    px(g, "#3a0a14", mx, my + 1, 3, 1);
    px(g, "#3a0a14", mx + 3, my, 2, 1);
  } else if (p.emotion === "surprised") {
    px(g, "#3a0a14", mx + 1, my, 2, 2);
  } else if (p.emotion === "sad" || p.emotion === "angry") {
    px(g, "#3a0a14", mx, my + 1, 1, 1);
    px(g, "#3a0a14", mx + 1, my, 3, 1);
    px(g, "#3a0a14", mx + 4, my + 1, 1, 1);
  } else if (p.emotion === "nervous") {
    for (let i = 0; i < 5; i++) px(g, "#3a0a14", mx + i, my + (i % 2), 1, 1);
  } else {
    px(g, "#3a0a14", mx + 1, my, 3, 1);
  }
  if (look.facial === "mustache") {
    px(g, look.hair, hx + 5, hy + 9, 7, 2);
    px(g, look.hair, hx + 4, hy + 10, 1, 1);
    px(g, look.hair, hx + 12, hy + 10, 1, 1);
  }
}

// --- body ------------------------------------------------------------------

function body(g: G, look: Look, p: Pose, hy: number) {
  const bw = BODY_W[look.build];
  const lw = LEG_W[look.build];
  const headH = 14;
  const torsoTop = hy + headH;
  const torsoH = Math.round((FEET - torsoTop) * (look.build === "tiny" ? 0.5 : 0.55));
  const legTop = torsoTop + torsoH;
  const tx = CX - Math.floor(bw / 2);
  const sleeve = look.outfit === "tank" ? look.skin : look.outfit === "vest" ? "#f2f2f2" : look.outfit === "labcoat" ? "#f4f6f8" : look.shirt;
  const coat = look.outfit === "labcoat" ? "#f4f6f8" : look.shirt;

  // legs + shoes (gowns hide them)
  if (look.outfit !== "gown") {
    px(g, look.pants, CX - lw - 1, legTop, lw, FEET - legTop - 2);
    px(g, look.pants, CX + 1, legTop, lw, FEET - legTop - 2);
    px(g, "#1d1820", CX - lw - 2, FEET - 2, lw + 2, 2);
    px(g, "#1d1820", CX + 1, FEET - 2, lw + 2, 2);
  }

  // back arm (behind torso)
  px(g, shade(sleeve, -0.15), tx - 2, torsoTop + 1, 3, torsoH - 2);

  // torso
  const round = look.build === "round";
  for (let y = 0; y < torsoH; y++) {
    const inset = round ? (y === 0 || y === torsoH - 1 ? 2 : y === 1 || y === torsoH - 2 ? 1 : 0) : 0;
    px(g, coat, tx + inset, torsoTop + y, bw - inset * 2, 1);
  }
  px(g, shade(coat, -0.12), tx + (round ? 2 : 0), torsoTop + torsoH - 1, bw - (round ? 4 : 0), 1);

  switch (look.outfit) {
    case "stripes":
      for (let y = torsoTop + 2; y < torsoTop + torsoH - 1; y += 3) px(g, look.accent, tx, y, bw, 1);
      break;
    case "suit":
      px(g, "#f5f5f5", CX - 1, torsoTop, 3, torsoH - 3);
      px(g, look.accent, CX, torsoTop + 1, 1, torsoH - 4);
      px(g, shade(look.shirt, -0.2), CX - 2, torsoTop, 1, torsoH - 2);
      px(g, shade(look.shirt, -0.2), CX + 2, torsoTop, 1, torsoH - 2);
      break;
    case "hoodie":
      px(g, shade(look.shirt, -0.15), CX - 5, torsoTop - 1, 10, 3);
      px(g, look.accent, CX - 1, torsoTop + 2, 1, 4);
      px(g, look.accent, CX + 2, torsoTop + 2, 1, 4);
      px(g, shade(look.shirt, -0.1), CX - 4, torsoTop + torsoH - 5, 9, 3);
      break;
    case "dress":
      for (let y = 0; y < 9; y++) px(g, look.shirt, tx - Math.floor(y / 2), legTop + y, bw + Math.floor(y / 2) * 2, 1);
      px(g, look.accent, tx, torsoTop + torsoH - 2, bw, 1);
      break;
    case "gown":
      for (let y = 0; y < FEET - legTop; y++) px(g, look.shirt, tx - Math.floor(y / 3), legTop + y, bw + Math.floor(y / 3) * 2, 1);
      if (Math.floor(p.t / 400) % 3 === 0) px(g, "#ffffff", tx + 3, legTop + 6, 1, 1);
      px(g, look.accent, tx, torsoTop + torsoH - 2, bw, 1);
      break;
    case "labcoat":
      px(g, look.shirt, CX - 2, torsoTop, 5, torsoH);
      px(g, "#f4f6f8", tx, legTop, bw, 7);
      px(g, "#cfd6dd", CX, legTop, 1, 7);
      px(g, "#7fb2e5", tx + 1, torsoTop + 3, 2, 3); // pens in the pocket
      break;
    case "tank":
      px(g, look.skin, tx, torsoTop, 3, 3);
      px(g, look.skin, tx + bw - 3, torsoTop, 3, 3);
      break;
    case "turtleneck":
      px(g, look.shirt, CX - 3, torsoTop - 3, 7, 4);
      break;
    case "vest":
      for (let y = torsoTop + 1; y < torsoTop + torsoH - 1; y += 3)
        for (let x = tx + 1; x < tx + bw - 1; x += 3) px(g, look.accent, x, y, 1, 1);
      px(g, "#f2f2f2", CX - 1, torsoTop, 3, 2);
      break;
  }

  // front arm: resting, gesturing, or clapping
  const ax = tx + bw - 1;
  if (p.clap) {
    const up = Math.floor(p.t / 120) % 2;
    px(g, sleeve, ax - 1, torsoTop + 2, 6, 3);
    px(g, look.skin, ax + 4, torsoTop + 1 - up, 3, 3);
  } else if (p.armUp) {
    px(g, sleeve, ax, torsoTop - 6, 3, 9);
    px(g, look.skin, ax, torsoTop - 9, 3, 3);
  } else {
    px(g, sleeve, ax, torsoTop + 1, 3, torsoH - 2);
    px(g, look.skin, ax, torsoTop + torsoH - 1, 3, 2);
  }

  if (has(look, "bowtie")) {
    px(g, look.accent, CX - 3, torsoTop, 3, 3);
    px(g, look.accent, CX + 1, torsoTop, 3, 3);
    px(g, shade(look.accent, -0.2), CX, torsoTop + 1, 1, 1);
  }
  if (has(look, "necklace")) for (let i = 0; i < 4; i++) px(g, "#fffbe6", CX - 3 + i * 2, torsoTop + 1 + (i === 1 || i === 2 ? 1 : 0), 1, 1);
}

// --- head accessories ------------------------------------------------------

function headAccessories(g: G, look: Look, hx: number, hy: number) {
  const ey = hy + 6;
  for (const a of look.accessories) {
    switch (a) {
      case "glasses":
        g.strokeStyle = "#241a22";
        g.lineWidth = 1;
        g.strokeRect(hx + 4.5, ey - 1.5, 4, 4);
        g.strokeRect(hx + 9.5, ey - 1.5, 4, 4);
        break;
      case "shades":
        px(g, "#0b0b10", hx + 4, ey - 1, 11, 3);
        px(g, "#ffffff99", hx + 5, ey - 1, 2, 1);
        break;
      case "goggles":
        px(g, "#3b3b3b", hx - 1, hy + 1, 16, 2);
        px(g, "#6fd3ff", hx + 5, hy, 4, 4);
        px(g, "#6fd3ff", hx + 10, hy, 4, 4);
        break;
      case "hat":
        px(g, "#2a2230", hx - 4, hy - 2, 23, 2);
        px(g, "#2a2230", hx, hy - 8, 15, 6);
        px(g, look.accent, hx, hy - 4, 15, 1);
        break;
      case "starhat":
        for (let i = 0; i < 9; i++) px(g, "#4b2a8a", hx + 2 + i, hy - 3 - i * 1.4, 13 - i * 1.4, 2);
        px(g, "#ffd84d", hx + 7, hy - 9, 2, 2);
        px(g, "#4b2a8a", hx - 3, hy - 2, 21, 2);
        break;
      case "beanie":
        px(g, look.accent, hx - 1, hy - 5, 16, 7);
        px(g, shade(look.accent, 0.15), hx - 1, hy + 1, 16, 2);
        px(g, shade(look.accent, -0.1), hx + 6, hy - 7, 3, 2);
        break;
      case "headband":
        px(g, look.accent, hx - 1, hy + 1, 16, 2);
        break;
      case "headphones":
        px(g, "#2f2f38", hx - 1, hy - 4, 16, 2);
        px(g, "#2f2f38", hx, hy + 4, 3, 6);
        break;
      case "headset":
        px(g, "#2f2f38", hx - 1, hy - 3, 16, 1);
        px(g, "#2f2f38", hx, hy + 5, 3, 4);
        px(g, "#2f2f38", hx + 3, hy + 9, 6, 1);
        px(g, "#ff3355", hx + 9, hy + 9, 1, 1);
        break;
      case "earrings":
        px(g, "#ffd700", hx + 1, hy + 9, 1, 2);
        break;
      case "bandage":
        px(g, "#f7f1e3", hx + 9, hy + 1, 5, 2);
        px(g, "#f7f1e3", hx + 10, hy, 2, 4);
        break;
    }
  }
}

// --- assembly ----------------------------------------------------------------

const spriteCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const outlined = typeof document !== "undefined" ? document.createElement("canvas") : null;

function drawLocal(g: G, look: Look, p: Pose) {
  const hy = FEET - look.height + p.breathe;
  const hx = CX - 7; // 15-px-wide head, slightly forward
  hairBack(g, look, hx, hy);
  body(g, look, p, hy);
  // neck + head
  if (look.outfit !== "turtleneck") px(g, shade(look.skin, -0.1), CX - 2, hy + 13, 4, 2);
  px(g, look.skin, hx, hy, 15, 14);
  px(g, look.skin, hx + 1, hy + 14, 13, 1); // chin
  px(g, shade(look.skin, -0.12), hx, hy + 13, 15, 1);
  px(g, shade(look.skin, -0.08), hx + 1, hy + 6, 2, 3); // ear
  face(g, look, p, hx, hy);
  hairFront(g, look, hx, hy);
  headAccessories(g, look, hx, hy);
}

/**
 * Draw a character into the scene with their feet at (x, feetY).
 * Includes a soft floor shadow and a dark outline.
 */
export function drawSprite(scene: G, rawLook: Look, x: number, feetY: number, p: Pose, shadow = true) {
  if (!spriteCanvas || !outlined) return;
  const look = normalizeLook(rawLook);
  spriteCanvas.width = outlined.width = SPRITE_W;
  spriteCanvas.height = outlined.height = SPRITE_H;
  const s = spriteCanvas.getContext("2d")!;
  drawLocal(s, look, p);

  const o = outlined.getContext("2d")!;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) o.drawImage(spriteCanvas, dx, dy);
  o.globalCompositeOperation = "source-in";
  o.fillStyle = OUTLINE;
  o.fillRect(0, 0, SPRITE_W, SPRITE_H);
  o.globalCompositeOperation = "source-over";
  o.drawImage(spriteCanvas, 0, 0);

  if (shadow) {
    scene.fillStyle = "#00000040";
    scene.beginPath();
    scene.ellipse(Math.round(x), Math.round(feetY), BODY_W[look.build] * 0.8, 2.5, 0, 0, Math.PI * 2);
    scene.fill();
  }

  const left = Math.round(x - CX);
  const top = Math.round(feetY - FEET);
  scene.save();
  if (p.facing === -1) {
    scene.translate(left + SPRITE_W, top);
    scene.scale(-1, 1);
  } else scene.translate(left, top);

  // "Slightly malfunctioning": brief slice offsets and a chromatic split.
  const glitching = look.glitch && p.t % 1700 < 140;
  if (glitching) {
    const slice = 6 + (Math.floor(p.t / 40) % 4) * 8;
    scene.drawImage(outlined, 0, 0, SPRITE_W, slice, 0, 0, SPRITE_W, slice);
    scene.drawImage(outlined, 0, slice, SPRITE_W, 6, 3, slice, SPRITE_W, 6);
    scene.drawImage(outlined, 0, slice + 6, SPRITE_W, SPRITE_H - slice - 6, 0, slice + 6, SPRITE_W, SPRITE_H - slice - 6);
    scene.globalAlpha = 0.35;
    scene.globalCompositeOperation = "lighter";
    scene.drawImage(outlined, -2, 0);
  } else {
    scene.drawImage(outlined, 0, 0);
  }
  scene.restore();
}

/** Fill in fields missing from looks saved by older versions of the station. */
function normalizeLook(l: Partial<Look> & { accessory?: string }): Look {
  return {
    skin: l.skin ?? "#e0ac69",
    hair: l.hair ?? "#2b1d0e",
    hairStyle: l.hairStyle ?? "short",
    shirt: l.shirt ?? "#3a86ff",
    pants: l.pants ?? "#222222",
    accent: l.accent ?? "#ffffff",
    outfit: l.outfit ?? "plain",
    build: l.build ?? "average",
    eyes: l.eyes ?? "dot",
    nose: l.nose ?? "small",
    facial: l.facial ?? "none",
    accessories: l.accessories ?? (l.accessory && l.accessory !== "none" ? [l.accessory as Look["accessories"][number]] : []),
    height: Math.max(36, l.height ?? 40),
    glitch: l.glitch,
  };
}
