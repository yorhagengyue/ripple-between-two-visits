// Chapter 2's set: the void deck under Mr Tan's HDB block at 7:30 am, plus the props the chapter animates (red tai chi
// fans, a little bird). Floor centre is the origin; the deck runs x -9..6.8, z -3.4..3.4; the slab underside is at
// y = 3.0 and the block's upper floors stand on it. The open front (+z) faces a grass plaza; a bay in the back wall
// (x -1.7..1.7) looks through to a playground. The low morning sun comes in from the front right.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { hash } from "../core.js";
import { canvasTex } from "../chars.js";
import { box, rbox, cyl, ball, painted, group, at, shadowy, plant, wall } from "./kit.js";

export const DECK = { slab: 3.0, front: 3.4, back: -3.4, left: -9, right: 6.8 };
const DS = { side: THREE.DoubleSide };
/** The low morning sun: direction toward the light (from the deck). Shots light the key from here. It comes in from the
 *  front right, low (about 23 degrees), so the long shadows of the row fall straight back toward the lifts and the front
 *  pillars' shadows pass between the players instead of across them (from the side, the pillar at x 4.6 put the yellow
 *  auntie and half of Mr Tan in shade, and pastel bodies went olive). */
export const SUN = new THREE.Vector3(2.5, 2.8, 6.0);

// ---------------------------------------------------------------- fake sun shadows
// The renderer has no shadow maps on, so long shadows are faked: dark flat twins of things, inside a group whose
// matrix squashes everything onto the floor along the sun direction (a planar projection). The twins skip the ink pass
// (they collapse to a point when the scene renders normals), and overlapping parts do not darken twice (they share
// one plane, so the depth test keeps the first fragment).
export const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: "#3a1d6e", transparent: true, opacity: 0.32, depthWrite: true });
export function shadowGroup(h = 0.006) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false;
  const a = SUN.x / SUN.y, b = SUN.z / SUN.y;
  g.matrix.set(1, -a, 0, a * h, 0, 0, 0, h, 0, -b, 1, b * h, 0, 0, 0, 1);
  return g;
}
export function asShadow(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = SHADOW_MAT; o.castShadow = o.receiveShadow = false; o.frustumCulled = false;
    o.onBeforeRender = (r, scene) => { if (scene.overrideMaterial) o.matrixWorld.makeScale(0, 0, 0); };
  });
  return obj;
}

// ---------------------------------------------------------------- painters
function tilePainter(c, W, H) {
  const n = 2, s = W / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    c.fillStyle = (x + y) % 2 ? "#e58c5a" : "#f3b07c"; c.fillRect(x * s, y * s, s, s);
    c.fillStyle = "rgba(255,255,255,.10)"; c.fillRect(x * s + 6, y * s + 6, s * 0.45, 5);
  }
  c.strokeStyle = "rgba(140,70,60,.45)"; c.lineWidth = 4;
  for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s, H); c.stroke(); c.beginPath(); c.moveTo(0, i * s); c.lineTo(W, i * s); c.stroke(); }
}
function facadePainter(c, W, H) {
  const floors = 5, fh = H / floors, cols = 12, cw = W / cols;
  c.fillStyle = "#f8dfb6"; c.fillRect(0, 0, W, H);
  const curtains = ["#ff9fb8", "#ffcf6a", "#8fe0c0", "#b9a6ff", "#ff8a6a"];
  for (let f = 0; f < floors; f++) {
    const y0 = H - (f + 1) * fh;
    for (let k = 0; k < cols; k++) {
      const x = k * cw;
      if (k % 4 === 3) { c.fillStyle = "#4bb487"; c.fillRect(x + cw * 0.22, y0, cw * 0.56, fh); c.fillStyle = "rgba(20,60,50,.25)"; c.fillRect(x + cw * 0.7, y0, cw * 0.08, fh); continue; }
      const wx = x + cw * 0.13, wy = y0 + fh * 0.2, ww = cw * 0.74, wh = fh * 0.52;
      c.fillStyle = "#fffaf0"; c.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
      c.fillStyle = "#7d8ee6"; c.fillRect(wx, wy, ww, wh);
      const h = hash(f * 31 + k * 7);
      if (h > 0.35) { c.fillStyle = curtains[Math.floor(h * 97) % curtains.length]; c.fillRect(wx, wy, ww * (0.25 + h * 0.2), wh); }
      c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(wx + ww * 0.62, wy + 5, ww * 0.12, wh * 0.85);
      c.fillStyle = "#fffaf0"; c.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      c.fillStyle = "rgba(90,50,110,.22)"; c.fillRect(wx - 5, wy + wh + 5, ww + 10, 6);
    }
    c.fillStyle = "#fff4e2"; c.fillRect(0, y0 + fh * 0.84, W, fh * 0.16);
    c.fillStyle = "rgba(90,50,110,.28)"; c.fillRect(0, y0 + fh * 0.97, W, fh * 0.03);
  }
}
function endWallPainter(c, W, H) {
  c.fillStyle = "#f3d7ae"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#4bb487"; c.fillRect(W * 0.08, 0, W * 0.1, H);
  c.fillStyle = "#3a8fd0"; c.fillRect(W * 0.82, 0, W * 0.06, H);
  c.font = `900 ${Math.round(W * 0.42)}px "Arial Black", "Segoe UI", sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = "rgba(40,30,90,.25)"; c.fillText("214", W * 0.52 + 10, H * 0.22 + 10);
  c.fillStyle = "#2f6fb8"; c.fillText("214", W * 0.52, H * 0.22);
}
function letterboxPainter(c, W, H) {
  c.fillStyle = "#8d96ab"; c.fillRect(0, 0, W, H);
  const cols = 12, rows = 6, cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = k * cw, y = r * rh, h = hash(r * 13 + k * 5);
    c.fillStyle = h > 0.9 ? "#e2433f" : h > 0.82 ? "#3f66d9" : "#c9d0de"; c.fillRect(x + 3, y + 3, cw - 6, rh - 6);
    c.fillStyle = "#2a2633"; c.fillRect(x + cw * 0.2, y + rh * 0.24, cw * 0.6, 4);
    c.fillStyle = "#5d6478"; c.font = "700 11px 'Segoe UI'"; c.textAlign = "center"; c.fillText(`#0${r + 2}-${10 + k}`, x + cw / 2, y + rh * 0.72);
    if (h > 0.6 && h < 0.66) { c.fillStyle = "#ffd94a"; c.fillRect(x + cw * 0.62, y + rh * 0.5, 9, 9); }
  }
}
function noticePainter(c, W, H) {
  c.fillStyle = "#3f8f62"; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(0,0,0,${hash(i) * 0.12})`; c.fillRect(hash(i * 3) * W, hash(i * 7) * H, 3, 3); }
  const paper = (x, y, w, h, col, rot, draw) => { c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(-w / 2 + 4, -h / 2 + 5, w, h); c.fillStyle = col; c.fillRect(-w / 2, -h / 2, w, h); draw && draw(w, h); c.fillStyle = "#e2433f"; c.beginPath(); c.arc(0, -h / 2 + 8, 5, 0, 7); c.fill(); c.restore(); };
  const lines = (w, h, n, col = "rgba(40,30,70,.55)") => { c.fillStyle = col; for (let i = 0; i < n; i++) c.fillRect(-w / 2 + 12, -h / 2 + 34 + i * 14, (w - 24) * (0.6 + hash(i + w) * 0.4), 5); };
  paper(W * 0.24, H * 0.36, 150, 190, "#fff3d6", -0.05, (w, h) => {
    c.fillStyle = "#e2433f"; c.fillRect(-w / 2, -h / 2, w, 46);
    c.fillStyle = "#fff"; c.font = "900 26px 'Segoe UI'"; c.textAlign = "center"; c.fillText("TAI CHI", 0, -h / 2 + 33);
    c.fillStyle = "#e2433f"; c.beginPath(); c.moveTo(0, 30); c.arc(0, 30, 52, Math.PI * 1.1, Math.PI * 1.9); c.closePath(); c.fill();
    c.fillStyle = "#2a1f4a"; c.font = "800 20px 'Segoe UI'"; c.fillText("7:30 AM", 0, 62); c.font = "700 14px 'Segoe UI'"; c.fillText("ALL WELCOME", 0, 84);
  });
  paper(W * 0.56, H * 0.3, 130, 110, "#ffffff", 0.04, (w, h) => lines(w, h, 5));
  paper(W * 0.82, H * 0.36, 110, 150, "#ffe37a", -0.03, (w, h) => lines(w, h, 7));
  paper(W * 0.5, H * 0.74, 170, 100, "#cfe8ff", 0.02, (w, h) => lines(w, h, 4));
  paper(W * 0.84, H * 0.78, 100, 90, "#ffd0e0", -0.06, (w, h) => lines(w, h, 3));
}
function boardTopPainter(c, W, H) {
  c.fillStyle = "#d8cfc0"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#efe2c4"; c.beginPath(); c.arc(W / 2, H / 2, W * 0.36, 0, 7); c.fill();
  c.strokeStyle = "#7a3b3b"; c.lineWidth = 3; const s = W * 0.5, x0 = W / 2 - s / 2, y0 = H / 2 - s / 2;
  for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(x0 + (i * s) / 8, y0); c.lineTo(x0 + (i * s) / 8, y0 + s); c.stroke(); }
  for (let i = 0; i <= 9; i++) { c.beginPath(); c.moveTo(x0, y0 + (i * s) / 9); c.lineTo(x0 + s, y0 + (i * s) / 9); c.stroke(); }
}
function blockPainter(seed, base) {
  return (c, W, H) => {
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    const floors = 12, cols = 8, fh = H / floors, cw = W / cols;
    for (let f = 0; f < floors; f++) {
      c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(0, f * fh + fh * 0.8, W, fh * 0.12);
      for (let k = 0; k < cols; k++) { c.fillStyle = hash(seed * 91 + f * 13 + k) > 0.8 ? "#ffe9a8" : "rgba(70,60,150,.35)"; c.fillRect(k * cw + cw * 0.2, f * fh + fh * 0.25, cw * 0.6, fh * 0.45); }
    }
  };
}
function skyPainter(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#7fc8ff"); g.addColorStop(0.5, "#bfe3ff"); g.addColorStop(0.82, "#ffe7b0"); g.addColorStop(1, "#ffc98a");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "rgba(255,255,255,.85)";
  for (let i = 0; i < 7; i++) { const x = hash(i * 5) * W, y = H * (0.15 + hash(i * 9) * 0.35), r = 30 + hash(i) * 40; for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + k * r * 0.8, y - (k % 2) * r * 0.3, r, r * 0.55, 0, 0, 7); c.fill(); } }
}

// ---------------------------------------------------------------- pieces
function pillar(x, z) {
  const g = group();
  g.add(rbox(0.5, DECK.slab, 0.5, 0.03, toon("#f8ecd4"), 0, DECK.slab / 2, 0));
  g.add(box(0.52, 1.05, 0.52, toon("#3fae74"), 0, 0.525, 0));
  g.add(box(0.53, 0.07, 0.53, toon("#ffd94a"), 0, 1.09, 0));
  g.add(box(0.53, 0.04, 0.53, toon("#2a7a55"), 0, 0.02, 0));
  return at(g, x, 0, z);
}
function tree(s = 1) {
  const g = group();
  g.add(cyl(0.1 * s, 0.14 * s, 1.6 * s, toon("#7a4a36"), 0, 0.8 * s, 0, 10));
  const leaf = ["#3fae6b", "#5cc77f", "#2f9e6a", "#7bd88a"];
  for (let i = 0; i < 6; i++) g.add(ball((0.55 + hash(i * 3 + s) * 0.35) * s, toon(leaf[i % 4]), (hash(i * 5 + s) - 0.5) * 1.3 * s, (1.9 + hash(i * 7) * 0.8) * s, (hash(i * 11) - 0.5) * 1.1 * s));
  return g;
}
function laundryPole(len = 1.25) {
  const g = group();
  const pole = cyl(0.025, 0.025, len, toon("#c9ced8"), 0, 0, len / 2, 8); pole.rotation.x = Math.PI / 2; g.add(pole);
  g.add(box(0.06, 0.1, 0.06, toon("#8d93a3"), 0, 0, 0.05));
  const cols = ["#ff5fa8", "#39d3ff", "#ffd94a", "#7be07b", "#ff8a3d", "#ffffff", "#9b6bff"];
  for (let i = 0; i < 3; i++) {
    const h = hash(len * 10 + i * 17), w = 0.22 + h * 0.18, ht = 0.3 + hash(i * 3 + len) * 0.3;
    const cl = box(w, ht, 0.02, toon(cols[Math.floor(h * 70) % cols.length]), 0, -ht / 2 - 0.02, 0.28 + i * 0.32);
    cl.rotation.y = Math.PI / 2 + (h - 0.5) * 0.5; cl.userData.cloth = true; g.add(cl);
  }
  return g;
}
function acUnit() {
  const g = group(box(0.62, 0.42, 0.34, toon("#f2f4f8"), 0, 0, 0));
  const fan = cyl(0.14, 0.14, 0.02, toon("#5d6478"), 0.08, 0, 0.17, 18); fan.rotation.x = Math.PI / 2; g.add(fan);
  g.add(box(0.66, 0.04, 0.4, toon("#c9ced8"), 0, -0.23, 0));
  return g;
}
function bench() {
  const g = group(), wood = toon("#c77a4a"), leg = toon("#3a2f55");
  for (let i = 0; i < 3; i++) g.add(box(1.6, 0.04, 0.12, wood, 0, 0.44, -0.14 + i * 0.14));
  for (let i = 0; i < 2; i++) g.add(box(1.6, 0.1, 0.03, wood, 0, 0.62 + i * 0.14, -0.22));
  for (const s of [-1, 1]) { g.add(box(0.05, 0.44, 0.4, leg, s * 0.7, 0.22, 0)); g.add(box(0.05, 0.4, 0.04, leg, s * 0.7, 0.66, -0.22)); }
  return g;
}
function stoneTable() {
  const g = group(), stone = toon("#cfc6b6"), stone2 = toon("#b9ae9c");
  g.add(cyl(0.16, 0.24, 0.64, stone2, 0, 0.32, 0));
  g.add(cyl(0.58, 0.58, 0.08, stone, 0, 0.68, 0, 32));
  const top = painted(0.9, 0.9, 256, 256, boardTopPainter); top.rotation.x = -Math.PI / 2; top.position.y = 0.722; g.add(top);
  const pc = [["#e2433f", 0.12, 0.05], ["#2a2633", -0.1, -0.08], ["#e2433f", 0.02, -0.15], ["#2a2633", -0.16, 0.1]];
  pc.forEach(([col, x, z]) => { g.add(cyl(0.035, 0.035, 0.02, toon("#f5e8c8"), x, 0.735, z, 14)); g.add(cyl(0.022, 0.022, 0.006, toon(col), x, 0.747, z, 12)); });
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; g.add(cyl(0.17, 0.21, 0.42, stone, Math.cos(a) * 0.88, 0.21, Math.sin(a) * 0.88, 20)); }
  return g;
}
function cat() {
  const g = group(), fur = toon("#f2a04a"), fur2 = toon("#d97f2e"), ink = toon("#2a1f3a");
  const body = ball(0.16, fur, 0, 0.11, 0); body.scale.set(1.5, 0.75, 1.0); g.add(body);
  for (let i = 0; i < 3; i++) { const st = box(0.03, 0.13, 0.25, fur2, -0.12 + i * 0.1, 0.14, 0); g.add(st); }
  const head = group(ball(0.11, fur, 0, 0, 0)); head.position.set(0.24, 0.1, 0.06); g.add(head);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 4), fur); e.position.set(0.0, 0.1, s * 0.06); e.rotation.x = s * 0.3; head.add(e); }
  for (const s of [-1, 1]) head.add(box(0.04, 0.008, 0.008, ink, 0.1, 0.01, s * 0.045));
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 20, Math.PI * 1.1), fur2); tail.rotation.x = -Math.PI / 2; tail.position.set(-0.05, 0.05, 0.02); g.add(tail);
  g.userData.head = head;
  return g;
}
function radio() {
  const g = group();
  g.add(rbox(0.44, 0.24, 0.14, 0.03, toon("#4f74d9"), 0, 0.12, 0));
  for (const s of [-1, 1]) { const sp = cyl(0.07, 0.07, 0.02, toon("#2a2633"), s * 0.13, 0.12, 0.07, 18); sp.rotation.x = Math.PI / 2; g.add(sp); const sp2 = cyl(0.03, 0.03, 0.025, toon("#c9ced8"), s * 0.13, 0.12, 0.072, 12); sp2.rotation.x = Math.PI / 2; g.add(sp2); }
  g.add(box(0.11, 0.07, 0.01, flat("#ffe9a8"), 0, 0.14, 0.072));
  g.add(box(0.12, 0.025, 0.02, toon("#e2433f"), 0, 0.245, 0.02));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.014, 6, 16, Math.PI), toon("#2a2633")); handle.position.set(0, 0.24, -0.02); g.add(handle);
  const ant = cyl(0.006, 0.006, 0.4, toon("#c9ced8"), 0.16, 0.42, -0.04, 6); ant.rotation.z = -0.5; g.add(ant);
  return g;
}
function stool(col = "#e2433f") {
  return group(cyl(0.17, 0.14, 0.36, toon(col), 0, 0.18, 0, 16), cyl(0.19, 0.19, 0.03, toon(col), 0, 0.37, 0, 16));
}
function bicycle() {
  const g = group(), frame = toon("#2fb8c8"), dark = toon("#2a2633"), chrome = toon("#c9ced8");
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 28), dark); w.position.set(s * 0.5, 0.33, 0); g.add(w);
    const hub = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 4, 20), chrome); hub.position.set(s * 0.5, 0.33, 0); g.add(hub);
  }
  const bar = (x1, y1, x2, y2, m = frame, r = 0.022) => { const len = Math.hypot(x2 - x1, y2 - y1); const b = cyl(r, r, len, m, (x1 + x2) / 2, (y1 + y2) / 2, 0, 8); b.rotation.z = Math.atan2(x1 - x2, y2 - y1); g.add(b); };
  bar(-0.5, 0.33, -0.05, 0.36); bar(-0.05, 0.36, 0.38, 0.7); bar(-0.5, 0.33, -0.12, 0.72); bar(-0.12, 0.72, 0.38, 0.72); bar(-0.05, 0.36, -0.12, 0.72);
  bar(0.38, 0.7, 0.5, 0.33, chrome, 0.018); bar(0.38, 0.7, 0.36, 0.9, chrome, 0.018);
  g.add(box(0.06, 0.03, 0.42, dark, 0.36, 0.9, 0));
  g.add(rbox(0.22, 0.05, 0.1, 0.02, toon("#3a2f55"), -0.14, 0.78, 0));
  g.add(box(0.28, 0.2, 0.32, toon("#ffd94a"), 0.6, 0.78, 0));
  g.add(box(0.24, 0.16, 0.28, toon("#2a2633"), 0.6, 0.8, 0));
  return g;
}
function vending() {
  const g = group();
  g.add(rbox(0.85, 1.85, 0.6, 0.04, toon("#e2433f"), 0, 0.925, 0));
  const panel = painted(0.55, 1.0, 128, 232, (c, W, H) => {
    c.fillStyle = "#fff6e4"; c.fillRect(0, 0, W, H);
    const cols = ["#3f66d9", "#ffd94a", "#2fb87a", "#ff8a3d", "#e2433f", "#9b6bff"];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) { c.fillStyle = cols[(r * 4 + k) % cols.length]; c.fillRect(8 + k * 30, 10 + r * 44, 22, 34); c.fillStyle = "rgba(255,255,255,.5)"; c.fillRect(12 + k * 30, 14 + r * 44, 5, 26); }
  }, { unlit: true });
  panel.position.set(-0.08, 1.2, 0.301); g.add(panel);
  g.add(box(0.14, 0.5, 0.02, toon("#2a2633"), 0.3, 1.2, 0.3));
  g.add(box(0.5, 0.14, 0.02, toon("#2a2633"), -0.08, 0.35, 0.3));
  return g;
}
function liftDoor() {
  const g = group();
  g.add(box(1.25, 2.35, 0.08, toon("#e8edf5"), 0, 1.175, 0));
  g.add(box(1.0, 2.1, 0.04, toon("#b9c3d6"), 0, 1.05, 0.05));
  g.add(box(0.015, 2.1, 0.05, toon("#5d6478"), 0, 1.05, 0.06));
  const ind = painted(0.3, 0.14, 128, 60, (c, W, H) => { c.fillStyle = "#1a1030"; c.fillRect(0, 0, W, H); c.fillStyle = "#ff9a3d"; c.font = "900 44px 'Courier New'"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("▼ 5", W / 2, H / 2 + 2); }, { unlit: true });
  ind.position.set(0, 2.24, 0.045); g.add(ind);
  return g;
}

// ---------------------------------------------------------------- the set
export function buildVoidDeck() {
  const g = new THREE.Group();
  const W = DECK.right - DECK.left, cx = (DECK.left + DECK.right) / 2, D = DECK.front - DECK.back;
  // ground outside and the plaza path
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), toon("#69c46c")); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.1; g.add(grass);
  g.add(box(30, 0.08, 2.2, toon("#ddd3c2"), cx, -0.07, DECK.front + 1.1));
  g.add(box(2.0, 0.06, 14, toon("#ddd3c2"), 1.2, -0.08, DECK.front + 8));
  // the deck floor: tiles on a slab with a step edge
  g.add(box(W, 0.12, D, toon("#d5946a"), cx, -0.06, 0));
  const floor = painted(W, D, 256, 256, tilePainter, { repeat: [W / 1.3, D / 1.3] }); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.002, 0); g.add(floor);
  // slab, beams, the block above
  const slab = box(W + 0.3, 0.45, D + 0.3, toon("#e2d6f6"), cx, DECK.slab + 0.225, 0); g.add(slab);
  const facade = []; // things above the slab: they may cast shadows only while the camera is above the slab (see below)
  const fascia = box(W + 0.3, 0.14, 0.3, toon("#4bb487"), cx, DECK.slab + 0.38, DECK.front + 0.08); g.add(fascia); facade.push(fascia); // green fascia
  const beams = group(); g.add(beams);
  for (const z of [2.95, -1.4]) beams.add(box(W, 0.32, 0.42, toon("#efe7fb"), cx, DECK.slab - 0.16, z));
  for (const x of [-8.5, -4.6, 0.65, 4.6, 6.4]) beams.add(box(0.42, 0.32, D, toon("#efe7fb"), x, DECK.slab - 0.16, 0));
  const upper = new THREE.Mesh(new THREE.BoxGeometry(W, 14, D), [
    toon("#ffffff", { map: canvasTex(512, 1024, endWallPainter) }), toon("#f3d7ae"), toon("#f3d7ae"), toon("#f3d7ae"),
    toon("#ffffff", { map: canvasTex(1024, 1024, facadePainter) }), toon("#f3d7ae")]);
  upper.position.set(cx, DECK.slab + 0.45 + 7, 0); g.add(upper);
  // roof parapet
  const parapet = box(W + 0.2, 0.4, D + 0.2, toon("#fff4e2"), cx, DECK.slab + 0.45 + 14.2, 0); g.add(parapet); facade.push(parapet);
  // upper-floor details on the facade: laundry poles, AC units, potted plants on the ledges
  const fh = 14 / 5, cw = W / 12;
  for (let f = 0; f < 3; f++) {
    const y = DECK.slab + 0.45 + f * fh;
    for (let k = 0; k < 12; k++) {
      if (k % 4 === 3) continue;
      const x = DECK.left + (k + 0.5) * cw, h = hash(f * 19 + k * 3);
      if (h > 0.45) { const o = at(laundryPole(1.0 + h * 0.4), x + cw * 0.3, y + fh * 0.78, DECK.front); g.add(o); facade.push(o); }
      if (h < 0.4) { const o = at(acUnit(), x - cw * 0.15, y + fh * 0.12, DECK.front + 0.18); g.add(o); facade.push(o); }
      if (h > 0.2 && h < 0.55) { const p = plant(0.6, "#2f9e6a"); p.position.set(x + cw * 0.1, y + fh * 0.84, DECK.front + 0.1); g.add(p); facade.push(p); }
    }
  }
  // fluorescent tubes under the slab
  for (const [x, z] of [[-6.6, 0.8], [-2.6, 0.8], [2.6, 0.8], [-6.6, -2.3], [-2.6, -2.3], [2.6, -2.3], [5.5, 0.8]]) {
    beams.add(box(1.3, 0.05, 0.14, toon("#dfe3ec"), x, DECK.slab - 0.03, z)); // with the beams: no shadows cast or taken
    beams.add(box(1.2, 0.04, 0.07, flat("#f7fbff"), x, DECK.slab - 0.07, z));
  }
  // pillars
  for (const [x, z] of [[-8.5, 2.95], [-4.6, 2.95], [4.6, 2.95], [6.4, 2.95], [-8.5, -1.4], [-4.6, -1.4], [0.65, -1.4], [4.6, -1.4], [6.4, -1.4]]) g.add(pillar(x, z));
  // back wall: left and right segments with a bay open in the middle
  const bz = DECK.back + 0.15;
  const wl = wall(7.3, DECK.slab, "#bfe7ef", { band: "#3fae74" }); wl.position.set(-5.35, DECK.slab / 2, bz); g.add(wl);
  const wr = wall(5.1, DECK.slab, "#bfe7ef", { band: "#3fae74" }); wr.position.set(4.25, DECK.slab / 2, bz); g.add(wr);
  for (const x of [-1.7, 1.7]) g.add(box(0.3, DECK.slab, 0.3, toon("#f8ecd4"), x, DECK.slab / 2, bz));
  g.add(box(0.3, DECK.slab, 0.3, toon("#f8ecd4"), x0(), DECK.slab / 2, bz));
  // letterboxes, fire hose reel, a block sign, a bench
  const lbFrame = box(3.3, 1.65, 0.12, toon("#5d6478"), -5.4, 1.3, bz + 0.06); g.add(lbFrame);
  const lb = painted(3.2, 1.55, 512, 248, letterboxPainter); lb.position.set(-5.4, 1.3, bz + 0.125); g.add(lb);
  g.add(box(3.5, 0.08, 0.3, toon("#3a2f55"), -5.4, 2.17, bz + 0.15));
  const hose = group(rbox(0.66, 0.86, 0.2, 0.03, toon("#e2433f"), 0, 0, 0));
  const hl = painted(0.5, 0.18, 128, 46, (c, W2, H2) => { c.fillStyle = "#fff"; c.fillRect(0, 0, W2, H2); c.fillStyle = "#e2433f"; c.font = "900 20px 'Segoe UI'"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("FIRE HOSE", W2 / 2, H2 / 2); });
  hl.position.set(0, 0.25, 0.101); hose.add(hl); g.add(at(hose, -7.8, 1.25, bz + 0.1));
  const sign = painted(1.0, 0.36, 256, 92, (c, W2, H2) => { c.fillStyle = "#2f6fb8"; c.fillRect(0, 0, W2, H2); c.fillStyle = "#fff"; c.font = "900 54px 'Arial Black', 'Segoe UI'"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("BLK 214", W2 / 2, H2 / 2 + 3); });
  sign.position.set(-3.0, 2.45, bz + 0.02); g.add(sign);
  g.add(at(bench(), -3.0, 0, bz + 0.35));
  // notice board, two lifts, the vending machine, a rubbish bin
  const nb = group(box(1.35, 1.0, 0.06, toon("#a8653e"), 0, 0, 0)); const np = painted(1.22, 0.88, 384, 277, noticePainter); np.position.z = 0.032; nb.add(np);
  g.add(at(nb, 2.55, 1.5, bz + 0.05));
  g.add(at(liftDoor(), 3.95, 0, bz + 0.04), at(liftDoor(), 5.25, 0, bz + 0.04));
  g.add(box(0.1, 0.18, 0.03, toon("#c9ced8"), 4.6, 1.15, bz + 0.06), ball(0.025, flat("#ffd94a"), 4.6, 1.17, bz + 0.08));
  g.add(at(vending(), -0.95, 0, bz + 0.45));
  g.add(cyl(0.22, 0.2, 0.75, toon("#2f9e6a"), 6.1, 0.375, 2.4), cyl(0.24, 0.24, 0.05, toon("#24724f"), 6.1, 0.77, 2.4));
  // stone table with a xiangqi game and a sleeping cat; the bicycle by the pillar; plants
  g.add(at(stoneTable(), -6.2, 0, 0.5));
  const kitty = cat(); kitty.position.set(-6.1, 0.73, 0.45); kitty.rotation.y = 0.5; g.add(kitty); g.userData.cat = kitty;
  g.add(at(bicycle(), 5.5, 0, 2.15, -0.35));
  for (const [x, z, s, col] of [[-1.25, -2.9, 2.0, "#3fae6b"], [1.25, -2.9, 1.8, "#5cc77f"], [6.4, 0.4, 2.2, "#2f9e6a"], [-8.4, 0.6, 2.0, "#3fae6b"], [-4.1, 2.8, 1.6, "#5cc77f"]]) {
    const p = plant(s, col); p.position.set(x, 0, z); g.add(p);
  }
  // bougainvillea planters along the front edge
  for (const [x0p, x1p] of [[-8.8, -5.2], [5.0, 6.7]]) {
    const len = x1p - x0p, mid = (x0p + x1p) / 2;
    g.add(box(len, 0.4, 0.5, toon("#d97a52"), mid, 0.1, DECK.front + 0.35));
    for (let i = 0; i < len * 3; i++) g.add(ball(0.16 + hash(i + x0p) * 0.08, toon(hash(i * 3 + x0p) > 0.45 ? "#ff5fa8" : "#3fae6b"), x0p + 0.15 + i / 3, 0.38 + hash(i * 7) * 0.12, DECK.front + 0.35 + (hash(i * 5) - 0.5) * 0.3));
  }
  // the radio on a red stool in front of the row, tumblers and a bag
  const rs = stool(); rs.position.set(-0.7, 0, 2.55); g.add(rs);
  const rad = radio(); rad.position.set(-0.7, 0.385, 2.55); rad.rotation.y = 0.15; g.add(rad); g.userData.radio = rad;
  g.add(cyl(0.05, 0.05, 0.22, toon("#ff8fb0"), -0.35, 0.11, 2.6, 12), cyl(0.05, 0.05, 0.22, toon("#39d3ff"), -0.22, 0.11, 2.75, 12));
  g.add(at(group(box(0.36, 0.3, 0.14, toon("#ffd27a"), 0, 0.15, 0), new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 12, Math.PI), toon("#c77a4a"))), 0.6, 0, 2.7, -0.4));
  g.children[g.children.length - 1].children[1].position.y = 0.3;
  // outside: playground through the back bay, trees, neighbouring blocks, the sky
  const play = group();
  play.add(box(0.9, 0.1, 0.9, toon("#ffd94a"), 0, 1.2, 0));
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) play.add(cyl(0.05, 0.05, 1.8, toon("#3f66d9"), x, 0.9, z, 8));
  play.add(new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.6, 4), toon("#e2433f"))); play.children[play.children.length - 1].position.set(0, 2.1, 0); play.children[play.children.length - 1].rotation.y = Math.PI / 4;
  const slide = box(0.6, 0.06, 2.0, toon("#ff5fa8"), 0, 0.65, 1.3); slide.rotation.x = 0.62; play.add(slide);
  play.add(box(4, 0.04, 4, toon("#f0c58a"), 0, -0.07, 0.4));
  g.add(at(play, 0.2, 0, -8.5, 0.3));
  for (const [x, z, s] of [[-4, -9, 1.2], [4.5, -10, 1.4], [-9, -7, 1.1], [9.5, 6.5, 1.2], [-11, 6, 1.3], [10.5, -2, 1.3], [12, 3, 1.1], [7.8, 9.5, 1.0], [-6, 10, 1.2]]) g.add(at(tree(s), x, -0.1, z));
  [[-10, -26, 10, 22, "#a99af2", 1], [3, -30, 12, 26, "#9fd8c8", 2], [15, -24, 9, 20, "#f0b3c8", 3], [26, -8, 10, 24, "#a4b8ff", 4], [-24, -18, 10, 22, "#f3d29a", 5]].forEach(([x, z, w, h, col, s]) => {
    const tex = canvasTex(256, 512, blockPainter(s, col));
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), [toon(col), toon(col), toon(col), toon(col), toon("#ffffff", { map: tex }), toon(col)]);
    b.position.set(x, h / 2 - 0.1, z); if (x > 20) b.rotation.y = -Math.PI / 2; g.add(b);
  });
  const sky = painted(260, 110, 1024, 440, skyPainter, { unlit: true }); sky.position.set(0, 30, -70); g.add(sky);
  const sky2 = painted(260, 110, 1024, 440, skyPainter, { unlit: true }); sky2.position.set(70, 30, 0); sky2.rotation.y = -Math.PI / 2; g.add(sky2);
  // long shadows of the pillars and the floor props (clipped so they stay on the deck floor)
  const sh = shadowGroup(); g.userData.shadows = sh;
  const a = SUN.x / SUN.y, b = SUN.z / SUN.y;
  for (const [x, z] of [[-8.5, 2.95], [-4.6, 2.95], [4.6, 2.95], [6.4, 2.95], [-8.5, -1.4], [-4.6, -1.4], [0.65, -1.4], [4.6, -1.4], [6.4, -1.4]]) {
    const h = Math.min(DECK.slab, (z - DECK.back - 0.1) / b, (x - DECK.left - 0.1) / a);
    if (h > 0.05) sh.add(box(0.5, h, 0.5, SHADOW_MAT, x, h / 2, z));
  }
  sh.add(at(stoneTable(), -6.2, 0, 0.5), at(bicycle(), 5.5, 0, 2.15, -0.35), at(stool(), -0.7, 0, 2.55));
  const rs2 = radio(); rs2.position.set(-0.7, 0.385, 2.55); rs2.rotation.y = 0.15; sh.add(rs2);
  sh.add(cyl(0.22, 0.2, 0.75, SHADOW_MAT, 6.1, 0.375, 2.4));
  for (const [x, z, s2] of [[6.4, 0.4, 2.2], [-8.4, 0.6, 2.0], [-4.1, 2.8, 1.6]]) { const p = plant(s2); p.position.set(x, 0, z); sh.add(p); }
  shadowy(g);
  g.add(asShadow(sh));
  sh.visible = false; // real shadow maps draw these now; the painted twins would darken every shadow twice
  g.userData.cloths = []; g.traverse((o) => { if (o.userData.cloth) g.userData.cloths.push(o); });
  // the low sun reaches under the slab (a cheat: the slab and beams cast no shadow, so the whole deck gets the slant)
  slab.castShadow = false; beams.traverse((o) => (o.castShadow = false));
  upper.castShadow = false; sky.castShadow = sky2.castShadow = false; grass.castShadow = false;
  // the ceiling (slab underside, beams, tubes) takes no shadows: it faces away from the sun, and with the slab not
  // occluding, the facade's AC units and laundry would print dark blotches on it
  slab.receiveShadow = false; beams.traverse((o) => (o.receiveShadow = false));
  /** facade details (above the slab) cast shadows only while the camera is above the slab: under it, their shadows
   *  would land inside the deck (on the back wall and the lifts), where the real slab would have blocked them */
  const casters = []; facade.forEach((f) => f.traverse((o) => { if (o.isMesh) casters.push(o); }));
  g.userData.facadeShadows = (on) => casters.forEach((o) => (o.castShadow = on));
  return g;

  function x0() { return DECK.right - 0.15; }
}

// ---------------------------------------------------------------- a red folding fan
/** A red tai chi fan for a hand group. fan.set(arm, open 0..1, roll, yaw): the fan's own frame cancels the arm's
 *  rotation, so roll is an angle in the body's front plane (0 = the fan points down, ±π = up, -π/2 = toward the
 *  body's right side (-x)), and the leaf always faces the body's front. */
export function makeFan(R = 0.3, o = {}) {
  const g = new THREE.Group();
  const base = new THREE.Group(); base.rotation.order = "ZYX"; g.add(base);
  const rollG = new THREE.Group(); base.add(rollG);
  const N = 9, maxSpread = Math.PI * 0.82, w = maxSpread / (N - 1) + 0.02;
  const red = toon(o.col ?? "#ef3340", DS), red2 = toon(o.col2 ?? "#c8203a", DS), gold = toon("#ffcf4a", DS), wood = toon("#6b3b2a"), ink = toon("#2a1f3a", DS);
  const ribs = [], leaves = [];
  for (let i = 0; i < N; i++) {
    const r = new THREE.Group(); r.position.z = i * 0.0018; rollG.add(r);
    const leafG = new THREE.Group(); r.add(leafG); leaves.push(leafG);
    leafG.add(new THREE.Mesh(new THREE.RingGeometry(R * 0.36, R, 3, 1, -Math.PI / 2 - w / 2, w), i % 2 ? red : red2));
    const rim = new THREE.Mesh(new THREE.RingGeometry(R * 0.86, R * 0.95, 3, 1, -Math.PI / 2 - w / 2, w), gold); rim.position.z = 0.0008; leafG.add(rim);
    if (i % 3 === 1) { const dot = new THREE.Mesh(new THREE.CircleGeometry(R * 0.06, 10), ink); dot.position.set(0, -R * 0.66, 0.0009); leafG.add(dot); }
    r.add(box(0.012, R * 0.4, 0.008, wood, 0, -R * 0.2, 0.004));
    ribs.push(r);
  }
  const guard = [0, N - 1].map((i) => { const s = box(0.02, R * 1.02, 0.012, wood, 0, -R * 0.5, 0.004); ribs[i].add(s); return s; });
  const knob = ball(0.022, toon("#ffcf4a"), 0, 0, 0.01); rollG.add(knob);
  const tassel = box(0.015, 0.09, 0.015, toon("#ffcf4a"), 0, 0.05, 0); rollG.add(tassel);
  function set(arm, open = 1, roll = 0, yaw = 0, ox = 0, oy = 0, oz = 0) {
    if (arm) base.rotation.set(-arm.rotation.x, 0, -arm.rotation.z); else base.rotation.set(0, 0, 0);
    rollG.rotation.set(0, yaw, roll); rollG.position.set(ox, oy, oz);
    const k = Math.max(0, Math.min(1.15, open)), spread = maxSpread * k;
    ribs.forEach((r, i) => (r.rotation.z = (i / (N - 1) - 0.5) * spread));
    leaves.forEach((l) => (l.scale.x = 0.08 + 0.92 * Math.min(1, k)));
    tassel.visible = k < 0.3;
  }
  set(null, 0, 0);
  return { g, set };
}

// ---------------------------------------------------------------- a little bird (a yellow sunbird-ish)
export function makeBird() {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const yel = toon("#ffd23f"), teal = toon("#2fb8c8"), white = toon("#fff6dc"), ora = toon("#ff8a2a"), ink = toon("#1a1030");
  const b = ball(0.07, yel, 0, 0.075, 0); b.scale.set(1, 0.92, 1.25); body.add(b);
  const belly = ball(0.05, white, 0, 0.06, 0.035); body.add(belly);
  const head = new THREE.Group(); head.position.set(0, 0.145, 0.05); body.add(head);
  head.add(ball(0.052, yel, 0, 0, 0));
  head.add(ball(0.03, teal, 0, 0.035, -0.01));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.05, 8), ora); beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.005, 0.065); head.add(beak);
  for (const s of [-1, 1]) { head.add(ball(0.011, ink, s * 0.03, 0.012, 0.04)); head.add(ball(0.004, flat("#ffffff"), s * 0.032, 0.017, 0.049)); }
  const tail = box(0.05, 0.012, 0.1, teal, 0, 0.09, -0.1); tail.rotation.x = -0.45; body.add(tail);
  const wings = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * 0.06, 0.1, 0); const wg = box(0.1, 0.012, 0.09, teal, s * 0.05, 0, -0.01); p.add(wg); body.add(p); return p; });
  for (const s of [-1, 1]) g.add(cyl(0.005, 0.005, 0.03, ora, s * 0.02, 0.012, 0, 6));
  /** flap: wing angle (radians, + up); bob: head nod; tilt: head roll; tailK: tail flick 0..1; sq: squash */
  function set(p = {}) {
    wings[0].rotation.z = -(p.flap ?? -1.2); wings[1].rotation.z = p.flap ?? -1.2;
    head.rotation.set(p.bob ?? 0, p.look ?? 0, p.tilt ?? 0);
    tail.rotation.x = -0.45 - (p.tailK ?? 0) * 0.5;
    const sq = p.sq ?? 0; body.scale.set(1 + sq * 0.2, 1 - sq * 0.25, 1 + sq * 0.2);
    beak.scale.y = 1 + (p.chirp ?? 0) * 0.3;
  }
  set({});
  return { g, set };
}

// ---------------------------------------------------------------- outfits for the tai chi aunties and uncles
/** Add an outfit to a makeBot actor: "visor" (sun visor), "track" (tracksuit top), "band" (headband), "hat" (bucket hat). */
export function dress(a, kind, col) {
  const m = toon(col), white = toon("#ffffff");
  if (kind === "visor") {
    a.head.add(rbox(0.7, 0.08, 0.54, 0.035, m, 0, 0.47, 0));
    const brim = box(0.5, 0.025, 0.22, m, 0, 0.46, 0.33); brim.rotation.x = 0.18; a.head.add(brim);
  }
  if (kind === "track" || kind === "band") {
    const jm = toon(kind === "band" ? "#7f5bd6" : col);
    a.body.add(rbox(0.55, 0.36, 0.42, 0.1, jm, 0, 0.17, 0));
    a.body.add(box(0.03, 0.34, 0.01, white, 0, 0.17, 0.212));
    a.body.add(box(0.3, 0.06, 0.4, jm, 0, 0.37, 0));
    a.arms.forEach((arm, i) => { arm.add(rbox(0.155, 0.22, 0.175, 0.05, jm, 0, -0.08, 0)); arm.add(box(0.012, 0.22, 0.03, white, (i ? 1 : -1) * 0.08, -0.08, 0)); });
  }
  if (kind === "band") {
    a.head.add(rbox(0.69, 0.07, 0.53, 0.03, toon(col), 0, 0.43, 0));
    for (const s of [-1, 1]) { const t = box(0.05, 0.14, 0.02, toon(col), s * 0.04, 0.36, -0.27); t.rotation.z = s * 0.4; a.head.add(t); }
  }
  if (kind === "hat") {
    a.head.add(cyl(0.3, 0.34, 0.16, m, 0, 0.6, 0, 24));
    a.head.add(cyl(0.46, 0.46, 0.025, m, 0, 0.53, 0, 28));
    a.head.add(cyl(0.345, 0.345, 0.04, toon("#c77a4a"), 0, 0.555, 0, 24));
  }
}
