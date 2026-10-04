import { ENVELOPE_STEP_MS, type CastMember, type Cue, type GuideEntry, type PollResult, type Segment, type SetId } from "../shared/types.js";
import { drawSprite, shade } from "./sprite.js";
import { generateSong, type Song } from "../shared/music.js";

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
  /** Music segments: where the song is right now (drives lights, crowd and the band). */
  music?: MusicState;
  /** Game shows: contestants, scores, and how the current vote is going. */
  game?: { names: Record<string, string>; contestants: string[]; scores: Record<string, number>; leading?: string; champion?: string };
}

interface MusicState {
  artist: string;
  title: string;
  playing: boolean;
  /** ms into the song (negative before it starts). */
  ts: number;
  beatIndex: number;
  /** 0..1 through the current beat. */
  beatPhase: number;
  barIndex: number;
  /** 0..1, how recently a kick / snare hit (1 = just now). */
  kick: number;
  snare: number;
  drumsIn: boolean;
  /** The singer has a note right now (and how high it is, 0..1). */
  lead: number;
}

const songCache = new Map<string, Song>();

function musicState(seg: Segment, local: number): MusicState | undefined {
  const spec = seg.song;
  if (!spec) return undefined;
  let song = songCache.get(seg.id);
  if (!song) {
    song = generateSong(spec);
    songCache.set(seg.id, song);
    if (songCache.size > 6) songCache.delete(songCache.keys().next().value!);
  }
  const ts = local - spec.startMs;
  const beat = ts / song.beatMs;
  const recent = (inst: string) => {
    let best = 0;
    for (const e of song!.events) {
      if (e.t > ts) break;
      if (e.inst === inst && ts - e.t < 180) best = Math.max(best, 1 - (ts - e.t) / 180);
    }
    return best;
  };
  let lead = 0;
  for (const e of song.events) {
    if (e.t > ts) break;
    if (e.inst === "lead" && ts < e.t + e.dur) lead = Math.min(1, Math.max(0.2, (e.pitch - spec.root - 12) / 24));
  }
  return {
    artist: spec.artist,
    title: spec.title,
    playing: ts >= 0 && ts < song.totalMs,
    ts,
    beatIndex: Math.floor(beat),
    beatPhase: beat - Math.floor(beat),
    barIndex: Math.floor(beat / 4),
    kick: ts >= 0 ? recent("kick") : 0,
    snare: ts >= 0 ? recent("snare") : 0,
    drumsIn: song.drumsStartMs >= 0 && ts >= song.drumsStartMs && ts < song.totalMs,
    lead: ts >= 0 && ts < song.totalMs ? lead : 0,
  };
}

/** Instruments are drawn after the player, so they sit in front of the body. */
function drawInstrument(g: Ctx, role: string, x: number, feet: number, look: { accent: string; shirt: string }, m: MusicState, h: number) {
  const chest = feet - h * 0.42;
  if (role === "guitar" || role === "bass") {
    const strum = m.playing && m.beatPhase < 0.2 ? 1 : 0;
    const neck = role === "bass" ? 20 : 15;
    const body = role === "bass" ? "#2c2c54" : look.accent === "#ffffff" ? "#c0392b" : look.accent;
    g.strokeStyle = "#5a3a1a";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 2, chest + 4);
    g.lineTo(x + neck, chest - 8);
    g.stroke();
    px(g, "#222", x + neck - 1, chest - 10, 3, 3);
    px(g, body, x - 7, chest + 1 + strum, 9, 8);
    px(g, shade(body.startsWith("#") ? body : "#c0392b", 0.15), x - 6, chest + 2 + strum, 3, 2);
    px(g, "#111", x - 4, chest + 4 + strum, 2, 2);
  } else if (role === "keys") {
    px(g, "#f2f2f2", x - 11, chest + 2, 22, 5);
    for (let k = 0; k < 7; k++) px(g, "#222", x - 9 + k * 3, chest + 3, 1, 2);
    px(g, "#ff3355", x + 9, chest, 4, 3);
  } else if (role === "drums") {
    const hit = m.kick;
    // bass drum with the band's logo, toms, cymbals that flash on the snare
    g.fillStyle = "#e8e8e8";
    g.beginPath();
    g.ellipse(x, feet - 6, 10, 9 + hit * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#555";
    g.lineWidth = 1;
    g.stroke();
    px(g, "#ff3355", x - 4, feet - 8, 8, 4);
    px(g, "#c0392b", x - 18, feet - 13, 9, 6);
    px(g, "#c0392b", x + 9, feet - 13, 9, 6);
    const flash = m.snare > 0.5 ? "#fff6b0" : "#d4af37";
    px(g, "#555", x - 22, feet - 26, 1, 18);
    px(g, flash, x - 28, feet - 27, 12, 2);
    px(g, "#555", x + 21, feet - 24, 1, 16);
    px(g, m.kick > 0.5 ? "#fff6b0" : "#d4af37", x + 15, feet - 25, 12, 2);
  } else if (role === "vocals") {
    px(g, "#333", x + 9, feet - h * 0.55, 1, h * 0.55);
    px(g, "#666", x + 7, feet - h * 0.58, 4, 4);
    px(g, "#333", x + 5, feet - 1, 9, 1);
  }
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
  game_show: {
    marks: [
      { x: 58, y: 146, seated: false, face: 1 }, // the host at his lectern
      { x: 148, y: 140, seated: false, face: -1 },
      { x: 204, y: 140, seated: false, face: -1 },
      { x: 260, y: 140, seated: false, face: -1 },
    ],
    back: (g, t) => {
      px(g, "#120a2a", 0, 0, W, H);
      // the giant LED wall
      px(g, "#1f1048", 22, 10, 276, 70);
      for (let y = 12; y < 78; y += 4)
        for (let x = 24; x < 296; x += 4) if ((x + y + Math.floor(t / 120)) % 24 < 2) px(g, "#3a1f7a", x, y, 2, 2);
      g.fillStyle = Math.floor(t / 500) % 2 ? "#ff5a1f" : "#ffd23f";
      g.font = "bold 22px monospace";
      g.textAlign = "center";
      g.fillText("HOT SEAT", W / 2, 54);
      g.textAlign = "left";
      // chasing marquee bulbs
      for (let i = 0; i < 46; i++) px(g, (i + Math.floor(t / 150)) % 3 === 0 ? "#fff6b0" : "#7a5a1a", 22 + i * 6, 82, 3, 3);
      // floor with a spotlight disc
      px(g, "#241446", 0, 138, W, 42);
      g.fillStyle = "rgba(255,210,63,0.12)";
      g.beginPath();
      g.ellipse(204, 150, 80, 12, 0, 0, Math.PI * 2);
      g.fill();
    },
    front: (g, t, ev) => {
      // host lectern
      px(g, "#c9a227", 40, 120, 36, 28);
      px(g, "#ff3355", 40, 120, 36, 4);
      // contestant podiums with name plates and score lights
      (ev.game?.contestants ?? []).forEach((id, i) => {
        const x = 130 + i * 56;
        const champ = ev.game?.champion === id;
        const lit = champ ? Math.floor(t / 200) % 2 === 0 : ev.game?.leading === id;
        px(g, "#2a1a5a", x, 112, 36, 36);
        px(g, lit ? "#ffd23f" : "#4a2a8a", x, 112, 36, 3);
        px(g, "#0d0820", x + 3, 118, 30, 10);
        g.fillStyle = "#fff";
        g.font = "6px monospace";
        g.textAlign = "center";
        g.fillText((ev.game?.names[id] ?? id).toUpperCase().slice(0, 8), x + 18, 125);
        g.fillStyle = champ ? "#ffd23f" : "#ff5a1f";
        g.font = "bold 10px monospace";
        g.fillText(String(ev.game?.scores[id] ?? 0), x + 18, 142);
        g.textAlign = "left";
      });
    },
  },
  music_stage: {
    marks: [
      { x: 146, y: 152, seated: false, face: 1 }, // vocals, front and center
      { x: 96, y: 148, seated: false, face: 1 }, // guitar
      { x: 238, y: 148, seated: false, face: -1 }, // bass
      { x: 50, y: 146, seated: false, face: 1 }, // keys
      { x: 194, y: 116, seated: false, face: -1 }, // drums, on the riser behind the singer's shoulder
      { x: 296, y: 150, seated: false, face: -1 }, // the host, stage right
    ],
    back: (g, t, ev) => {
      const m = ev.music;
      px(g, "#0d0716", 0, 0, W, H);
      // backdrop with the act's name
      px(g, "#1d1030", 30, 22, 260, 78);
      g.fillStyle = m?.playing && m.beatIndex % 2 === 0 ? "#ff4fd8" : "#a03ac0";
      g.font = "bold 14px monospace";
      g.textAlign = "center";
      g.fillText((m?.artist ?? "").toUpperCase(), W / 2, 60);
      g.textAlign = "left";
      // lighting truss: cans change color on the bar and pulse with the kick
      px(g, "#444", 0, 6, W, 3);
      const palette = ["#ff3355", "#3a86ff", "#ffe066", "#2ec4b6", "#8338ec"];
      for (let i = 0; i < 9; i++) {
        const x = 16 + i * 36;
        const color = palette[((m?.barIndex ?? 0) + i) % palette.length];
        px(g, "#222", x - 3, 9, 7, 5);
        if (m?.playing) {
          g.fillStyle = color + (m.kick > 0.4 ? "55" : "22");
          g.beginPath();
          g.moveTo(x - 2, 14);
          g.lineTo(x + 2, 14);
          g.lineTo(x + 26 - (i % 3) * 20, 150);
          g.lineTo(x - 26 + (i % 3) * 14, 150);
          g.fill();
        }
      }
      // amp stacks and the drum riser
      for (const ax of [6, 280]) {
        px(g, "#1a1a1a", ax, 96, 34, 52);
        px(g, "#2a2a2a", ax + 3, 100, 28, 20);
        px(g, "#2a2a2a", ax + 3, 124, 28, 20);
      }
      px(g, "#2a1a3a", 156, 108, 80, 12);
      px(g, "#3a2a4a", 156, 108, 80, 2);
      // stage floor
      px(g, "#1a1222", 0, 148, W, 32);
      px(g, "#2a1a32", 0, 148, W, 2);
      void t;
    },
    front: (g, t, ev) => {
      const m = ev.music;
      const bob = m?.playing && m.drumsIn ? (m.beatPhase < 0.3 ? 3 : 0) : ev.crowd > 0.1 ? Math.round(Math.abs(Math.sin(t / 90)) * 3) : 0;
      for (let i = 0; i < 22; i++) {
        const b = (i % 2 === 0 ? bob : Math.max(0, bob - 1));
        const x = i * 15 - 4;
        px(g, "#07040c", x, 164 - b, 12, 16);
        px(g, "#07040c", x + 2, 157 - b, 8, 8);
        if (m?.playing && m.drumsIn && i % 5 === 2) px(g, "#07040c", x + 9, 146 - b, 3, 12); // fists up
      }
    },
  },
  sitcom_apartment: {
    marks: [
      { x: 104, y: 146, seated: false, face: 1 },
      { x: 150, y: 148, seated: false, face: 1 },
      { x: 198, y: 148, seated: false, face: -1 },
      { x: 252, y: 146, seated: false, face: -1 }, // by the door: where Dash bursts in
    ],
    back: (g) => {
      px(g, "#ead9b0", 0, 0, W, H);
      px(g, "#d9c48f", 0, 0, W, 5);
      // kitchen: fridge, cabinets, counter with cereal boxes
      px(g, "#e9ecef", 6, 52, 30, 86);
      px(g, "#c9ced4", 6, 92, 30, 2);
      px(g, "#9aa1a8", 32, 66, 2, 12);
      px(g, "#8a6240", 40, 40, 62, 26);
      for (let x = 44; x < 100; x += 20) px(g, "#a87a50", x, 44, 16, 18);
      px(g, "#7a5636", 40, 98, 62, 40);
      px(g, "#cdbb94", 38, 94, 66, 5);
      const boxes = ["#e74c3c", "#f1c40f", "#3498db", "#2ecc71", "#e67e22"];
      boxes.forEach((c, i) => px(g, c, 46 + i * 10, 80, 8, 14));
      // window with blinds
      px(g, "#bfe3ff", 128, 30, 60, 52);
      for (let y = 32; y < 82; y += 4) px(g, "#f4f4f4", 128, y, 60, 2);
      g.strokeStyle = "#f8f8f8";
      g.lineWidth = 2;
      g.strokeRect(128, 30, 60, 52);
      // the bike on the wall
      g.strokeStyle = "#2c3e50";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(204, 64, 9, 0, Math.PI * 2);
      g.arc(232, 64, 9, 0, Math.PI * 2);
      g.moveTo(204, 64);
      g.lineTo(216, 52);
      g.lineTo(232, 64);
      g.moveTo(216, 52);
      g.lineTo(222, 64);
      g.stroke();
      // front door
      px(g, "#5a3a22", 262, 50, 40, 90);
      px(g, "#7a5232", 266, 56, 32, 36);
      px(g, "#7a5232", 266, 98, 32, 36);
      px(g, "#e8c34a", 292, 96, 3, 3);
      px(g, "#3a2414", 258, 46, 48, 4);
      // floor
      px(g, "#a8743e", 0, 138, W, 42);
      for (let x = 0; x < W; x += 22) px(g, "#956434", x, 138, 1, 42);
    },
  },
  diner: {
    marks: [
      { x: 118, y: 124, seated: true, face: 1 },
      { x: 150, y: 124, seated: true, face: 1 },
      { x: 182, y: 124, seated: true, face: -1 },
      { x: 214, y: 124, seated: true, face: -1 },
    ],
    back: (g, t) => {
      px(g, "#d6c8a8", 0, 0, W, H);
      // big street window with passing traffic
      px(g, "#8ec5e8", 30, 18, 260, 70);
      px(g, "#6a8a9a", 30, 70, 260, 18);
      const cars = ["#e74c3c", "#f1c40f", "#2c3e50", "#ecf0f1"];
      for (let i = 0; i < 4; i++) {
        const x = ((t / (18 + i * 5) + i * 90) % 340) - 30;
        px(g, cars[i], x, 64 + (i % 2) * 6, 26, 8);
        px(g, "#222", x + 4, 72 + (i % 2) * 6, 5, 3);
        px(g, "#222", x + 17, 72 + (i % 2) * 6, 5, 3);
      }
      px(g, "#f4f4f4", 30, 18, 260, 3);
      for (let x = 30; x <= 290; x += 65) px(g, "#f4f4f4", x, 18, 3, 70);
      // neon sign (mirror-backwards, seen from inside)
      g.fillStyle = Math.floor(t / 900) % 2 ? "#ff4d6d" : "#ff8fa3";
      g.font = "bold 9px monospace";
      g.fillText("RENID S'YMMOT", 112, 32);
      // booth back
      px(g, "#a3333d", 96, 92, 140, 28);
      px(g, "#bf3f4b", 96, 90, 140, 4);
      // floor tiles
      for (let x = 0; x < W; x += 12) for (let y = 140; y < H; y += 12) px(g, (x + y) % 24 ? "#2b2b2b" : "#efefef", x, y, 12, 12);
    },
    front: (g) => {
      // table with coffee cups and a sad salad
      px(g, "#e9e2d0", 100, 120, 132, 10);
      px(g, "#b8ae96", 100, 129, 132, 3);
      px(g, "#7a7a7a", 162, 132, 8, 22);
      for (const x of [116, 146, 180, 210]) {
        px(g, "#ffffff", x, 113, 7, 7);
        px(g, "#5a3a22", x + 1, 113, 5, 2);
      }
      px(g, "#7fbf5f", 160, 115, 12, 4);
      // booth front
      px(g, "#a3333d", 92, 130, 148, 12);
    },
  },
  comedy_club: {
    marks: [{ x: 160, y: 140, seated: false, face: 1 }],
    back: (g) => {
      px(g, "#5a1f1a", 0, 0, W, H);
      for (let y = 0; y < 140; y += 8)
        for (let x = (y / 8) % 2 ? -10 : 0; x < W; x += 20) {
          px(g, "#8a3a2c", x + 1, y + 1, 18, 6);
          px(g, "#9c4434", x + 2, y + 1, 8, 2);
        }
      // spotlight
      const grad = g.createRadialGradient(160, 110, 4, 160, 110, 80);
      grad.addColorStop(0, "rgba(255,240,200,0.55)");
      grad.addColorStop(1, "rgba(255,240,200,0)");
      g.fillStyle = grad;
      g.fillRect(60, 20, 200, 140);
      // stage + mic stand
      px(g, "#2a1a14", 0, 138, W, 42);
      px(g, "#3a261c", 0, 138, W, 3);
      px(g, "#222", 178, 104, 2, 36);
      px(g, "#222", 172, 138, 14, 2);
      px(g, "#555", 176, 100, 6, 6);
    },
    front: (g, t, ev) => {
      for (let i = 0; i < 22; i++) {
        const bob = ev.crowd > 0.1 ? Math.round(Math.abs(Math.sin(t / 90 + i * 1.3)) * 3 * ev.crowd) : 0;
        const x = i * 15 - 4;
        px(g, "#120806", x, 162 - bob, 12, 18);
        px(g, "#120806", x + 2, 154 - bob, 8, 9);
      }
    },
  },
  family_couch: {
    marks: [
      { x: 122, y: 128, seated: true, face: 1 },
      { x: 150, y: 128, seated: true, face: 1 },
      { x: 178, y: 128, seated: true, face: -1 },
      { x: 204, y: 128, seated: true, face: -1 },
      { x: 258, y: 142, seated: false, face: -1 }, // guest standing by the door
    ],
    back: (g) => {
      px(g, "#b49ad8", 0, 0, W, H);
      px(g, "#9a80c0", 0, 0, W, 4);
      // the crooked sailboat painting
      g.save();
      g.translate(163, 50);
      g.rotate(-0.08);
      px(g, "#7a5a2a", -24, -16, 48, 32);
      px(g, "#a8d8f0", -21, -13, 42, 26);
      px(g, "#3a6ad8", -21, 4, 42, 9);
      px(g, "#ffffff", -2, -10, 2, 14);
      px(g, "#ffffff", -10, -8, 8, 10);
      px(g, "#8a4a2a", -12, 2, 20, 4);
      g.restore();
      // lamp and side table
      px(g, "#8a5a3a", 92, 112, 16, 26);
      px(g, "#e8c34a", 96, 88, 8, 24);
      px(g, "#f4e8b0", 90, 76, 20, 14);
      // doorway
      px(g, "#8a6a4a", 238, 60, 44, 80);
      px(g, "#6a4a2a", 242, 64, 36, 76);
      // floor + rug
      px(g, "#a87848", 0, 138, W, 42);
      px(g, "#7a9a5a", 70, 146, 180, 22);
      // couch back
      px(g, "#d4765a", 104, 100, 118, 22);
      px(g, "#e38a6c", 104, 98, 118, 4);
    },
    front: (g) => {
      px(g, "#e38a6c", 104, 120, 118, 12);
      px(g, "#c4664a", 98, 104, 8, 28);
      px(g, "#c4664a", 220, 104, 8, 28);
      // the back of the TV, in the foreground, where every family sitcom keeps it
      px(g, "#3a3a3a", 136, 158, 54, 22);
      px(g, "#555", 140, 154, 46, 6);
      px(g, "#222", 160, 150, 2, 6);
      px(g, "#222", 168, 148, 2, 8);
    },
  },
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
  /** Live tallies for open polls, keyed by poll id. */
  polls?: Map<string, PollResult>;
  /** Where viewers can vote (shown on the broadcast feed). */
  voteUrl?: string;
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

  private polls = new Map<string, PollResult>();

  draw(f: Frame) {
    if (f.polls) this.polls = f.polls;
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
    const cam = seg && seg.set !== "bumper" ? this.camera : WIDE;
    const sw = W / cam.zoom;
    const sh = H / cam.zoom;
    const sx = Math.max(0, Math.min(W - sw, cam.x - sw / 2));
    const sy = Math.max(0, Math.min(H - sh, cam.y - sh / 2));
    o.drawImage(this.sceneCanvas, sx, sy, sw, sh, ox, oy, W * scale, H * scale);
    o.drawImage(this.crt(scale), ox, oy);
    this.overlay(o, f, ox, oy, scale);
  }

  private camera: Shot = WIDE;
  private crtCanvas?: HTMLCanvasElement;
  private crtScale = 0;

  /** Scanlines + vignette, rebuilt only when the output scale changes. */
  private crt(scale: number): HTMLCanvasElement {
    if (this.crtCanvas && this.crtScale === scale) return this.crtCanvas;
    const c = document.createElement("canvas");
    c.width = W * scale;
    c.height = H * scale;
    const g = c.getContext("2d")!;
    if (scale >= 3) {
      g.fillStyle = "rgba(0,0,0,0.13)";
      for (let y = scale - 1; y < c.height; y += scale) g.fillRect(0, y, c.width, 1);
    }
    const v = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.35, c.width / 2, c.height / 2, c.width * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = v;
    g.fillRect(0, 0, c.width, c.height);
    this.crtCanvas = c;
    this.crtScale = scale;
    return c;
  }

  private show(g: Ctx, seg: Segment, now: number) {
    const set = SETS[seg.set as Exclude<SetId, "bumper">];
    const local = now - seg.startAt;
    const cue = seg.cues.find((c) => local >= c.t && local < c.t + c.dur);
    const crowd = seg.cues.reduce((acc, c) => {
      // Laugh-track punchlines get their laugh after the line; actions react immediately.
      const start = c.laugh ? c.t + c.dur : c.action === "applause" || c.action === "laugh" ? c.t : -1;
      if (start < 0) return acc;
      const d = local - start;
      return d >= 0 && d < 2200 ? Math.max(acc, 1 - d / 2200) : acc;
    }, 0);
    const music = musicState(seg, local);
    const tally = seg.poll ? this.polls.get(seg.poll.id)?.tally : undefined;
    const leading = tally ? Object.entries(tally).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0] : undefined;
    const ev: SceneEvents = {
      crowd,
      music,
      game: seg.game
        ? {
            names: Object.fromEntries(seg.cast.map((c) => [c.id, c.name.split(" ")[0]])),
            contestants: seg.game.contestants,
            scores: seg.game.scores,
            leading,
            champion: seg.game.champion,
          }
        : undefined,
    };
    set.back(g, now, ev);

    // Draw back-to-front so seated people on the couch overlap naturally.
    const states = castStates(seg, local, set.marks).sort(
      (a, b) => set.marks[a.member.mark % set.marks.length].y - set.marks[b.member.mark % set.marks.length].y,
    );
    for (const st of states) {
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

      const mouth = speaking ? envAt(speaking, local) : 0;
      const seed = st.member.id.charCodeAt(0) * 131 + st.member.id.length * 977;
      let dx = st.slide * 160;
      let dy = 0;
      let seated = mark.seated;
      // Couch gag: the family scrambles onto the couch at the top of every segment.
      if (seg.set === "family_couch" && st.member.mark < 4 && local < COUCH_GAG_MS) {
        const order = st.member.mark;
        const p = Math.max(0, Math.min(1, (local - order * 280) / 1100));
        const variant = hashStr(seg.id) % 2;
        if (variant === 0) {
          dx += (-30 - mark.x) * (1 - p); // run in from the left
          dy -= p < 1 ? Math.abs(Math.sin(local / 60)) * 3 : 0;
        } else {
          dy -= (1 - p) * (1 - p) * 140; // drop in from the ceiling
        }
        if (p < 1) seated = false;
      }
      if (speaking && mouth > 6) dy -= 1;
      if (action === "laugh") dy -= Math.round(Math.abs(Math.sin(now / 70)) * 2);
      if (action === "lean_in") dx += face * 3;
      if (action === "stand" && mark.seated) dy -= 8;
      if (action === "dance") {
        // Deliberately jerky: snap between poses on a stepped clock.
        const step = Math.floor(now / 180) % 4;
        dx += [0, 2, 0, -2][step];
        dy -= step % 2;
      }
      // The band plays the song: everyone bobs on the beat, the singer's mouth follows the
      // melody, and the drummer waits for the drums to come in before playing.
      let bandMouth = -1;
      let bandArm = false;
      const role = st.member.role;
      if (music && role && role !== "host") {
        const grooving = music.playing && (role !== "drums" || music.drumsIn);
        if (grooving) dy -= music.beatPhase < 0.25 ? 1 : 0;
        if (role === "vocals") bandMouth = music.lead > 0 ? Math.round(4 + music.lead * 5) : 0;
        if (role === "drums") bandArm = music.drumsIn && music.snare > 0.3;
        if (role === "vocals" && music.playing && music.barIndex % 8 === 7) bandArm = true;
      }
      drawSprite(g, st.member.look, mark.x + dx, mark.y + (seated ? 8 : 0) + dy, {
        mouth: bandMouth >= 0 ? bandMouth : mouth,
        // Listeners keep the expression from their own last line for a few seconds.
        // ...otherwise their lasting mood shows on their face.
        emotion: speaking?.emotion ?? (own && local - own.t < own.dur + 4000 ? own.emotion : MOOD_FACE[st.member.mood ?? "neutral"]),
        blink: (now + seed) % 4200 < 130,
        breathe: Math.floor((now + seed) / 900) % 2,
        armUp: bandArm || action === "gesture" || (action === "dance" && Math.floor(now / 360) % 2 === 0),
        clap: action === "applause",
        facing: face,
        t: now,
      });
      if (music && role && role !== "host") drawInstrument(g, role, mark.x + dx, mark.y + dy, st.member.look, music, st.member.look.height);
    }
    set.front?.(g, now, ev);
    this.camera = shotFor(seg, local, set.marks);
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

    // Viewer poll: question, options with live bars, then the result.
    if (seg.poll) {
      const poll = seg.poll;
      const res = this.polls.get(poll.id);
      const tally = res?.tally ?? {};
      const total = Object.values(tally).reduce((a, n) => a + n, 0);
      const open = f.now < poll.closesAt && !res?.closed;
      const x0 = ox + (W - 116) * s;
      const y0 = oy + 22 * s;
      const rows = poll.options.length;
      o.fillStyle = "#000000d9";
      o.fillRect(x0, y0, 108 * s, (24 + rows * 11) * s);
      o.fillStyle = "#ffd23f";
      o.fillRect(x0, y0, 108 * s, 2 * s);
      o.font = font(3.4);
      o.fillStyle = "#ffd23f";
      o.fillText(open ? (f.voteUrl ? `VOTE NOW: ${f.voteUrl}` : "VOTE NOW!") : res?.studio ? "STUDIO AUDIENCE DECIDED" : "VOTING CLOSED", x0 + 4 * s, y0 + 5 * s);
      o.fillStyle = "#fff";
      o.fillText(clip(poll.question.replace(" (counts double)", " (x2)"), 30), x0 + 4 * s, y0 + 12 * s);
      poll.options.forEach((opt, i) => {
        const n = tally[opt.id] ?? 0;
        const y = y0 + (20 + i * 11) * s;
        const won = res?.closed && res.winner === opt.id;
        o.fillStyle = "#2a2140";
        o.fillRect(x0 + 4 * s, y, 100 * s, 8 * s);
        o.fillStyle = won ? "#ffd23f" : "#ff5a1f";
        o.fillRect(x0 + 4 * s, y, (total ? (n / total) * 100 : 0) * s, 8 * s);
        o.fillStyle = "#fff";
        o.fillText(`${opt.label}${won ? " WINS" : ""}`, x0 + 6 * s, y + 2.4 * s);
        o.textAlign = "right";
        o.fillText(String(n), x0 + 102 * s, y + 2.4 * s);
        o.textAlign = "left";
      });
    }

    // Now playing.
    const m = musicState(seg, local);
    if (m?.playing && m.ts > 3000) {
      const label = `♪ ${m.artist} - "${m.title}"`;
      o.font = font(4);
      const w = (label.length * 4.2 + 10) * s;
      o.fillStyle = "#000000cc";
      o.fillRect(ox + 8 * s, oy + (H - 22) * s, w, 13 * s);
      o.fillStyle = "#ff4fd8";
      o.fillRect(ox + 8 * s, oy + (H - 22) * s, 2 * s, 13 * s);
      o.fillStyle = "#fff";
      o.fillText(label, ox + 13 * s, oy + (H - 18) * s);
    }

    // Closed captions.
    const cue = seg.cues.find((c) => local >= c.t && local < c.t + c.dur + 250);
    if (cue) {
      const member = seg.cast.find((c) => c.id === cue.speaker);
      const name = (member?.name ?? cue.speaker).toUpperCase();
      const lines = wrap(cue.text, 54);
      const boxH = ((lines.length + 1) * 7 + 5) * s;
      const top = oy + (H - 6) * s - boxH;
      o.fillStyle = "#000000d9";
      o.fillRect(ox + 10 * s, top, (W - 20) * s, boxH);
      o.fillStyle = member ? nameColor(member.look.shirt, member.look.accent) : "#ffe066";
      o.fillRect(ox + 10 * s, top, 2 * s, boxH);
      o.font = font(4);
      o.fillText(name, ox + 15 * s, top + 3 * s);
      o.fillStyle = "#fff";
      lines.forEach((l, i) => o.fillText(l, ox + 15 * s, top + (10 + i * 7) * s));
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

const COUCH_GAG_MS = 2600;

/** Resting expression for a lasting mood. */
const MOOD_FACE: Record<string, Cue["emotion"]> = {
  neutral: "neutral",
  elated: "happy",
  furious: "angry",
  heartbroken: "sad",
  smug: "smug",
  anxious: "nervous",
  embarrassed: "nervous",
  scheming: "smug",
};

// ---------------------------------------------------------------------------
// The director: picks a camera shot for every moment. Shots are derived purely
// from the segment data, so every viewer sees the same cuts.

interface Shot {
  x: number;
  y: number;
  zoom: number;
}

const WIDE: Shot = { x: W / 2, y: H / 2, zoom: 1 };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shotFor(seg: Segment, local: number, marks: Mark[]): Shot {
  if (local < (seg.set === "family_couch" ? COUCH_GAG_MS + 400 : 2500)) return WIDE; // establishing shot / couch gag
  if (seg.song) {
    const m = musicState(seg, local)!;
    const at = (role: string, zoom: number, lift = 0) => {
      const c = seg.cast.find((x) => x.role === role);
      if (!c) return WIDE;
      const mk = marks[c.mark % marks.length];
      return { x: mk.x, y: mk.y - c.look.height * 0.6 - lift, zoom };
    };
    if (!m.playing) return m.ts < 0 ? at("host", 1.8, 8) : WIDE;
    // Cut every four bars: wide, the singer, the drummer when the drums arrive, a guitar shot.
    const shots = [WIDE, at("vocals", 1.9, 6), at("drums", 1.7, 4), at("guitar", 1.7, 4), at("vocals", 1.4, -6)];
    if (!m.drumsIn) return m.barIndex % 2 ? at("vocals", 1.5) : WIDE;
    return shots[Math.floor(m.barIndex / 4) % shots.length] ?? WIDE;
  }
  if (seg.set === "comedy_club" && seg.cast.length === 1) {
    // Stand-up: alternate a medium shot and a tighter one, never cut to an empty room.
    const m = seg.cast[0];
    const head = { x: marks[0].x, y: marks[0].y - m.look.height * 0.72 };
    return Math.floor(local / 9000) % 2 ? { x: head.x, y: head.y + 8, zoom: 1.8 } : { x: head.x, y: head.y + 22, zoom: 1.35 };
  }
  // The shot follows the most recent line (holds through pauses).
  let i = -1;
  for (let k = 0; k < seg.cues.length; k++) if (seg.cues[k].t <= local) i = k;
  // Very short lines don't earn a cut; keep the previous line's shot.
  while (i > 0 && seg.cues[i].dur < 1200) i--;
  if (i < 0) return WIDE;
  const cue = seg.cues[i];
  const wideActions = ["applause", "walk_off", "enter", "dance", "laugh"];
  if (cue.target === "audience" || wideActions.includes(cue.action)) return WIDE;

  const head = (id: string) => {
    const m = seg.cast.find((c) => c.id === id);
    if (!m) return undefined;
    const mark = marks[m.mark % marks.length];
    return { x: mark.x, y: mark.y + (mark.seated ? 8 : 0) - m.look.height * 0.72 };
  };
  const speaker = head(cue.speaker);
  if (!speaker) return WIDE;
  const roll = hashStr(seg.id + ":" + i) % 10;
  if (roll < 5) return { x: speaker.x, y: speaker.y + 6, zoom: 2 };
  if (roll < 8) {
    const other = head(cue.target) ?? head(seg.cues[i - 1]?.speaker ?? "");
    if (other && Math.abs(other.x - speaker.x) < 150 && other.x !== speaker.x)
      return { x: (speaker.x + other.x) / 2, y: (speaker.y + other.y) / 2 + 14, zoom: 1.45 };
    return { x: speaker.x, y: speaker.y + 10, zoom: 1.6 };
  }
  return WIDE;
}

/** Speaker name color for captions: their outfit color, lightened if it's too dark to read. */
function nameColor(shirt: string, accent: string): string {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  if (lum(shirt) > 0.35) return shirt;
  if (lum(accent) > 0.35) return accent;
  return shade(shirt, 0.45);
}
