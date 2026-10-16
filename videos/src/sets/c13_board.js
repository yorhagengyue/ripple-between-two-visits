// c13's set: a long corkboard on the Ripple lab's violet tile wall, in three regions with painted header plates
// (MEASURED | HOW WE BUILT IT | NEXT), a desk with a laptop and a lamp at the left, string lights along the top, a
// plant and a stool at the right. The cards, notes and screenshots that get pinned are drawn by the chapter as 2D
// overlays projected onto the board plane (z = BOARD_Z), so they stay crisp and easy to replace.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { box, rbox, cyl, ball, painted, lamp, plant, shadowy } from "./kit.js";
import { hash } from "../core.js";

export const BOARD_Z = -2.08;           // the cork surface
export const BOARD_X = [-7.4, 9.9], BOARD_Y = [0.75, 3.05];
export const REGION = { measured: -4.0, build: 2.75, next: 8.0 };

const plate = (txt, w, h) => painted(w, h, 1024, Math.round(1024 * h / w), (c, W, H) => {
  c.fillStyle = "#ffd94a"; c.fillRect(0, 0, W, H);
  c.lineWidth = H * 0.08; c.strokeStyle = "#1a1030"; c.strokeRect(H * 0.04, H * 0.04, W - H * 0.08, H - H * 0.08);
  c.fillStyle = "#1a1030"; c.font = `${Math.round(H * 0.72)}px "Bangers", "Impact", sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(txt, W / 2, H * 0.56);
}, { unlit: true });

export function buildCorkRoom() {
  const g = new THREE.Group();
  // floor and the tiled lab wall
  const floor = painted(28, 12, 1024, 440, (c, W, H) => {
    c.fillStyle = "#2c1d5c"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(120,90,220,.35)"; c.lineWidth = 3;
    for (let i = 0; i <= 28; i++) { c.beginPath(); c.moveTo(i * W / 28, 0); c.lineTo(i * W / 28, H); c.stroke(); }
    for (let i = 0; i <= 12; i++) { c.beginPath(); c.moveTo(0, i * H / 12); c.lineTo(W, i * H / 12); c.stroke(); }
  });
  floor.rotation.x = -Math.PI / 2; floor.position.set(1.25, 0, 3.6); floor.receiveShadow = true; g.add(floor);
  // a yellow hazard strip along the foot of the wall
  for (let i = 0; i < 40; i++) g.add(box(0.36, 0.01, 0.1, flat("#ffc83a"), -10.5 + i * 0.6, 0.006, -1.75));
  const wall = painted(26, 5.5, 1024, 217, (c, W, H) => {
    c.fillStyle = "#3b2a86"; c.fillRect(0, 0, W, H);
    const n = 52, s = W / n;
    for (let y = 0; y * s < H; y++) for (let x = 0; x < n; x++) { c.fillStyle = hash(x * 13 + y * 7) > 0.85 ? "#4a37a6" : "#43319a"; c.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3); }
  });
  wall.position.set(1.25, 2.75, -2.2); wall.receiveShadow = true; g.add(wall);
  g.add(box(26, 0.06, 0.06, flat("#4ff3ff"), 1.25, 0.42, -2.15), box(26, 0.05, 0.05, flat("#ff4fd0"), 1.25, 4.05, -2.15));

  // the corkboard with a wooden frame
  const [x0, x1] = BOARD_X, [y0, y1] = BOARD_Y, bw = x1 - x0, bh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const cork = painted(bw, bh, 2048, Math.round(2048 * bh / bw), (c, W, H) => {
    c.fillStyle = "#c98f56"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 5200; i++) { c.fillStyle = hash(i) > 0.5 ? "rgba(120,70,30,.28)" : "rgba(255,220,170,.25)"; c.fillRect(hash(i * 3) * W, hash(i * 7) * H, 1 + hash(i * 11) * 2.5, 1 + hash(i * 13) * 2.5); }
  });
  cork.position.set(cx, cy, BOARD_Z - 0.005); cork.receiveShadow = true; g.add(cork);
  g.add(box(bw, bh, 0.06, toon("#7a4a2a"), cx, cy, BOARD_Z - 0.04));
  const fr = toon("#8a5532");
  g.add(box(bw + 0.24, 0.12, 0.12, fr, cx, y1 + 0.06, BOARD_Z), box(bw + 0.24, 0.12, 0.12, fr, cx, y0 - 0.06, BOARD_Z));
  g.add(box(0.12, bh, 0.12, fr, x0 - 0.06, cy, BOARD_Z), box(0.12, bh, 0.12, fr, x1 + 0.06, cy, BOARD_Z));
  // region dividers (two strips of tape) and the header plates
  for (const x of [0.25, 5.6]) g.add(box(0.06, bh - 0.1, 0.012, flat("#ffd94a"), x, cy, BOARD_Z + 0.01));
  const heads = [["MEASURED", REGION.measured, 2.2], ["HOW WE BUILT IT", REGION.build, 3.2], ["NEXT", REGION.next, 1.3]];
  for (const [txt, x, w] of heads) { const p = plate(txt, w, 0.42); p.position.set(x, y1 + 0.38, BOARD_Z + 0.04); g.add(p); g.add(box(w + 0.06, 0.48, 0.04, toon("#1a1030"), x, y1 + 0.38, BOARD_Z + 0.01)); }
  // string lights along the top of the board: a sagging wire with warm bulbs
  const bulbs = [];
  for (let i = 0; i <= 60; i++) {
    const x = x0 - 0.2 + (i / 60) * (bw + 0.4), sag = Math.abs(Math.sin((i / 60) * Math.PI * 8)) * 0.14;
    const b = ball(0.045, flat(i % 3 === 0 ? "#ffe9a8" : i % 3 === 1 ? "#ff9fd2" : "#9ff0ff"), x, y1 + 0.82 - sag, BOARD_Z + 0.12); g.add(b); bulbs.push(b);
  }
  // little doodles pinned at the board's bottom edge, where nothing else goes (no words)
  const doodle = (x, y, col, rot, draw) => { const d = painted(0.42, 0.32, 128, 98, (c, W, H) => { c.fillStyle = col; c.fillRect(0, 0, W, H); draw(c, W, H); }, { unlit: false }); d.position.set(x, y, BOARD_Z + 0.01); d.rotation.z = rot; g.add(d); g.add(ball(0.03, toon("#ff4f6d"), x, y + 0.11, BOARD_Z + 0.03)); };
  doodle(-7.0, 1.05, "#ffe66d", 0.08, (c, W, H) => { c.strokeStyle = "#1a1030"; c.lineWidth = 5; c.beginPath(); c.arc(W / 2, H / 2, 26, 0, 7); c.stroke(); c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(W / 2, H / 2 - 18); c.moveTo(W / 2, H / 2); c.lineTo(W / 2 + 14, H / 2); c.stroke(); });
  doodle(0.25, 1.0, "#9ff0ff", -0.06, (c, W, H) => { c.strokeStyle = "#1a1030"; c.lineWidth = 6; c.beginPath(); c.moveTo(20, 70); c.lineTo(50, 40); c.lineTo(70, 55); c.lineTo(108, 22); c.stroke(); });
  doodle(9.55, 1.05, "#ffb3d9", 0.05, (c, W, H) => { c.fillStyle = "#ff4f6d"; c.beginPath(); c.moveTo(64, 80); c.bezierCurveTo(10, 40, 30, 10, 64, 34); c.bezierCurveTo(98, 10, 118, 40, 64, 80); c.fill(); });

  // the desk at the left with a laptop, a mug, a lamp, papers and a plant
  const desk = new THREE.Group();
  desk.add(rbox(1.7, 0.08, 0.8, 0.02, toon("#e9e2ff"), 0, 0.6, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) desk.add(box(0.06, 0.58, 0.06, toon("#3a2f55"), sx * 0.78, 0.29, sz * 0.34));
  desk.add(rbox(0.5, 0.025, 0.36, 0.01, toon("#2a2050"), -0.2, 0.655, 0.05));
  const lid = new THREE.Group(); lid.position.set(-0.2, 0.665, -0.13); lid.rotation.x = -0.25; desk.add(lid);
  lid.add(rbox(0.5, 0.34, 0.02, 0.01, toon("#2a2050"), 0, 0.17, 0));
  const scr = painted(0.44, 0.28, 256, 163, (c, W, H) => { c.fillStyle = "#151026"; c.fillRect(0, 0, W, H); const cols = ["#9b6bff", "#2ff0b0", "#ffd94a", "#ff9fd2"]; for (let i = 0; i < 9; i++) { c.fillStyle = cols[i % 4]; c.fillRect(16 + (i % 3) * 8, 14 + i * 15, 60 + hash(i) * 140, 7); } }, { unlit: true });
  scr.position.set(0, 0.17, 0.012); lid.add(scr);
  desk.add(cyl(0.05, 0.045, 0.11, toon("#ff6f91"), 0.38, 0.7, 0.12, 14));
  const lp = lamp(0.5); lp.position.set(0.62, 0.64, -0.2); desk.add(lp);
  for (let i = 0; i < 4; i++) desk.add(box(0.3, 0.012, 0.22, toon(i % 2 ? "#ffffff" : "#f1ead6"), 0.25 + i * 0.01, 0.648 + i * 0.012, -0.12 + i * 0.015));
  const pl = plant(1.3); pl.position.set(-0.95, 0, 0.15); desk.add(pl);
  desk.position.set(-6.2, 0, -1.35); desk.rotation.y = 0.12;
  g.add(desk);
  // a stool and a tall plant at the right
  const stool = new THREE.Group(); stool.add(cyl(0.22, 0.22, 0.06, toon("#ff8a3d"), 0, 0.5, 0, 20)); for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; stool.add(box(0.04, 0.5, 0.04, toon("#3a2f55"), Math.cos(a) * 0.15, 0.25, Math.sin(a) * 0.15)); }
  stool.position.set(10.5, 0, -1.2); g.add(stool);
  const pl2 = plant(2.0, "#2f9e5f"); pl2.position.set(11.1, 0, -1.7); g.add(pl2);
  // a prop the trio carry before they pin it (a blank note), placed per frame by the chapter
  const carry = new THREE.Group();
  // its own material (toon() materials are cached and shared across chapters; the chapter recolours this one per note)
  carry.add(box(0.26, 0.26, 0.012, toon("#ffe66d").clone(), 0, 0, 0));
  carry.visible = false; g.add(carry);
  g.userData.carry = carry; g.userData.bulbs = bulbs;
  shadowy(g);
  wall.castShadow = false; cork.castShadow = false;
  return g;
}
