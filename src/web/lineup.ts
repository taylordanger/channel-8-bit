import { EMOTIONS, type Look } from "../shared/types.js";
import { drawSprite } from "./sprite.js";

/** Cast lineup: every character, talking and cycling emotions. Handy when designing looks. */
interface CastCard {
  id: string;
  name: string;
  show: string;
  look: Look;
}

// ?ids=rex,deedee shows just those characters, larger.
const only = new URLSearchParams(location.search).get("ids")?.split(",");
const all = (await (await fetch("/api/cast")).json()) as CastCard[];
const cast = only ? all.filter((c) => only.includes(c.id)) : all;
const PER_ROW = Math.min(8, cast.length);
const W = PER_ROW * 50;
const H = Math.ceil(cast.length / PER_ROW) * 100;
const canvas = document.getElementById("lineup") as HTMLCanvasElement;
const scene = document.createElement("canvas");
scene.width = W;
scene.height = H;
const g = scene.getContext("2d")!;
const emotionEl = document.getElementById("emotion")!;

function frame(t: number) {
  const emotion = EMOTIONS[Math.floor(t / 2500) % EMOTIONS.length];
  emotionEl.textContent = emotion.toUpperCase();
  g.fillStyle = "#2a2140";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#3a2f58";
  for (let r = 0; r < H / 100; r++) g.fillRect(0, 88 + r * 100, W, 12);
  cast.forEach((c, i) => {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    const x = 26 + col * 50;
    const feet = 92 + row * 100;
    const talking = Math.floor(t / 1250) % 2 === 0;
    const mouth = talking ? Math.round(Math.abs(Math.sin(t / 90 + i)) * 9) : 0;
    drawSprite(g, c.look, x, feet, {
      mouth,
      emotion,
      blink: (t + i * 600) % 3800 < 130,
      breathe: Math.floor((t + i * 300) / 900) % 2,
      armUp: emotion === "happy" && i % 3 === 0,
      clap: emotion === "surprised" && i % 4 === 0,
      facing: col < PER_ROW / 2 ? 1 : -1,
      t,
    });
  });
  const o = canvas.getContext("2d")!;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  o.imageSmoothingEnabled = false;
  const s = Math.max(1, Math.floor(Math.min(canvas.width / W, canvas.height / H)));
  const ox = Math.floor((canvas.width - W * s) / 2);
  o.drawImage(scene, ox, 0, W * s, H * s);
  o.fillStyle = "#fff";
  o.font = `${Math.round(3.4 * s)}px "Press Start 2P", monospace`;
  o.textAlign = "center";
  cast.forEach((c, i) => {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    o.fillText(c.name.split(" ").slice(-1)[0].toUpperCase().slice(0, 9), ox + (26 + col * 50) * s, (97 + row * 100) * s);
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
