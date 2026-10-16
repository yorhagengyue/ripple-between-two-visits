// Wei Ling's office (chapter 4): a huge neon open-plan floor copied from the reference's "sessions floor": a dark violet
// floor with a cyan grid and pink dots, a magenta horizon, a violet sky with light streaks, and rows of identical white
// desks with a CodeBuddy mascot typing at every one. Her desk (front row, centre, at the origin) is a full model with
// her things on it; the crowd is InstancedMesh (one mesh per part) with simplified box bots that type and can pop in.
// Layout: desks face +z (toward the camera), rows recede to -z; desk (c, r) sits at x = c*2, z = -r*2. A bot sits
// behind its desk at (0.12, -0.53) from the desk centre. Desk top at y 0.645; seat top at 0.36; seated bot dy = 0.24.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { hash } from "../core.js";
import { box, rbox, cyl, ball, painted, poster } from "./kit.js";

export const GRID = { d: 2.0, cols: 25, rows: 34 };
export const BOT = { x: 0.12, z: -0.53, dy: 0.24 };
export const DESK_TOP = 0.645;
/** her phone's scale (0.116 x 0.238 m, the size class of his phone in c03/c05); the same in c04 and c06 */
export const PHONE_S = 1.35;
/** where her phone lies on the desk: beside the keyboard on her right, its near end where her reaching hand lands
 *  (seated, lean 0.3, armR 1.76, armOutR 0.08) */
export const DESK_PHONE = { x: -0.17, z: -0.09, yaw: 0.15 };
/** her bag on the floor by the desk's left end (her standing reach lands on its handle from x -0.43, z -0.74) */
export const BAG_FLOOR = { x: -0.8, z: -0.62, yaw: 0.5 };
/** desks (col, row) whose bot is a full model (registered by the chapter as c04.n0 ... c04.n4) */
export const FULL = [[-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const FULL_COLS = ["#ffd2a8", "#bdeedb", "#dfe5f3", "#ffc6e3", "#d6ccff"];
const BOT_COLS = ["#dfe5f3", "#dfe5f3", "#dfe5f3", "#dfe5f3", "#e9ecf6", "#ffb36b", "#7fe3c0", "#ff9fd0", "#ffe27a", "#b3a6ff", "#7fd0ff"];

/** A Fog that only acts while the office set is visible (STAGE.reset() does not clear scene.fog). */
class OfficeFog extends THREE.Fog {}
Object.defineProperty(OfficeFog.prototype, "near", { get() { return this.set?.visible ? this._n : 1e6; }, set(v) { this._n = v; } });
Object.defineProperty(OfficeFog.prototype, "far", { get() { return this.set?.visible ? this._f : 2e6; }, set(v) { this._f = v; } });

function toonMat(hex, o = {}) {
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap: toon("#ffffff").gradientMap, ...o });
  return m;
}

// ---------- painted textures ----------
function gridTex() {
  const t = canvasTex(256, 256, (c, W, H) => {
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#2fd8ff"; c.lineWidth = 7; c.shadowColor = "#2fd8ff"; c.shadowBlur = 10;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(W, 0); c.moveTo(0, 0); c.lineTo(0, H); c.moveTo(0, H); c.lineTo(W, H); c.moveTo(W, 0); c.lineTo(W, H); c.stroke();
    c.shadowBlur = 0; c.fillStyle = "#ff4fb4";
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { c.beginPath(); c.ellipse(x, y, 16, 10, 0, 0, 7); c.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function skyPaint(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1c0866"); g.addColorStop(0.22, "#3a10a8"); g.addColorStop(0.38, "#6a1fd8"); g.addColorStop(0.46, "#b42fd0");
  g.addColorStop(0.492, "#ff4fb8"); g.addColorStop(0.5, "#ff9ad8"); g.addColorStop(0.52, "#c02aa8"); g.addColorStop(1, "#24105a");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // diagonal light streaks, like the reference's sky
  c.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const x = hash(i * 3.1) * W, w = 30 + hash(i * 5.7) * 90;
    c.fillStyle = `rgba(${i % 2 ? "255,90,200" : "150,90,255"},${0.06 + hash(i) * 0.08})`;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + w, 0); c.lineTo(x + w - H * 0.42, H * 0.47); c.lineTo(x - H * 0.42, H * 0.47); c.closePath(); c.fill();
  }
  c.globalCompositeOperation = "source-over";
}
function boardPaint(kind) {
  return (c, W, H) => {
    c.fillStyle = "#1a0f33"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#ff4fb4"; c.lineWidth = 6; c.strokeRect(6, 6, W - 12, H - 12);
    c.fillStyle = "#ff9ad8"; c.fillRect(30, 30, W * 0.28, 14); c.fillRect(30, 52, W * 0.16, 10);
    const col = kind % 2 ? "#2fe8ff" : "#ffd94a";
    c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 14; c.lineWidth = 7; c.lineJoin = "round";
    c.beginPath();
    for (let i = 0; i <= 24; i++) { const x = 30 + (i / 24) * (W - 60), y = H * 0.82 - (i / 24) * H * 0.35 - Math.sin(i * 1.3 + kind) * H * 0.1 - hash(i + kind * 31) * H * 0.12; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke(); c.shadowBlur = 0;
    if (kind === 2) { c.fillStyle = "#2fe8ff"; for (let i = 0; i < 9; i++) { const h = H * (0.15 + hash(i * 7) * 0.4); c.fillRect(W * 0.55 + i * 22, H * 0.88 - h, 14, h); } }
  };
}
function codePaint(c, W, H) {
  c.fillStyle = "#16112a"; c.fillRect(0, 0, W, H);
  const cols = ["#9b6bff", "#2ff0b0", "#ff8fc8", "#ffe27a", "#7fd0ff"];
  for (let i = 0; i < 13; i++) { let x = 14 + (hash(i * 3) * 3 | 0) * 18; const y = 16 + i * 18;
    for (let k = 0; k < 4; k++) { const w = 18 + hash(i * 11 + k) * 60; c.fillStyle = cols[(i + k) % 5]; c.fillRect(x, y, w, 8); x += w + 10; if (x > W - 20) break; } }
}
/** The framed photo on her desk: Dad (bearded mascot) and Wei Ling, a heart. */
function photoPaint(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#ffd36b"); g.addColorStop(1, "#ff9a6b"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "#3fae6b"; c.fillRect(0, H * 0.8, W, H * 0.2);
  const bot = (x, y, s, beard) => {
    c.fillStyle = "#e9edf8"; c.strokeStyle = "#1a1030"; c.lineWidth = 3;
    for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(x + sx * 18 * s, y - 30 * s); c.lineTo(x + sx * 30 * s, y - 52 * s); c.lineTo(x + sx * 6 * s, y - 36 * s); c.closePath(); c.fill(); c.stroke(); }
    c.beginPath(); c.roundRect(x - 34 * s, y - 36 * s, 68 * s, 56 * s, 14 * s); c.fill(); c.stroke();
    c.fillStyle = "#8d93a3"; for (const sx of [-1, 1]) { c.beginPath(); c.arc(x + sx * 36 * s, y - 8 * s, 9 * s, 0, 7); c.fill(); }
    c.fillStyle = "#120f1a"; c.beginPath(); c.roundRect(x - 26 * s, y - 24 * s, 52 * s, 30 * s, 7 * s); c.fill();
    c.font = `900 ${20 * s}px Arial Black`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#9b6bff"; c.fillText("^", x - 11 * s, y - 6 * s); c.fillStyle = "#2ff0b0"; c.fillText("^", x + 11 * s, y - 6 * s);
    c.fillStyle = "#e9edf8"; c.beginPath(); c.roundRect(x - 24 * s, y + 20 * s, 48 * s, 36 * s, 10 * s); c.fill(); c.stroke();
    if (beard) { c.fillStyle = "#ffffff"; for (const [bx, by, r] of [[-14, 12, 11], [14, 12, 11], [0, 16, 12], [-8, 28, 10], [8, 28, 10], [0, 38, 9]]) { c.beginPath(); c.arc(x + bx * s, y + by * s, r * s, 0, 7); c.fill(); } }
  };
  bot(W * 0.36, H * 0.52, 1.25, true); bot(W * 0.7, H * 0.6, 0.95, false);
  c.fillStyle = "#ff4f8f"; c.font = "900 34px Segoe UI"; c.textAlign = "center"; c.fillText("♥", W * 0.55, H * 0.2);
}

// ---------- the crowd (instanced) ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const local = (x, y, z, rx = 0, ry = 0, rz = 0) => { _e.set(rx, ry, rz); _q.setFromEuler(_e); return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1)); };

function buildCrowd(g) {
  const desks = [], bots = [];
  const fullKey = new Set(FULL.map(([c, r]) => c + "," + r));
  for (let r = 0; r <= GRID.rows; r++) for (let c = -GRID.cols; c <= GRID.cols; c++) {
    if (c === 0 && r === 0) continue;                                  // her desk is a full model
    const x = c * GRID.d, z = -r * GRID.d, d = Math.hypot(x, z);
    const i = desks.length;
    desks.push({ x, z, d, plant: hash(i * 1.7 + 3) < 0.35, mug: hash(i * 2.3 + 5) < 0.3 });
    if (!fullKey.has(c + "," + r)) bots.push({ desk: i, ph: hash(i * 7.31) * 6.28, col: BOT_COLS[Math.floor(hash(i * 3.77 + 1) * BOT_COLS.length)], rate: 0.85 + hash(i * 1.9) * 0.4 });
  }
  const white = toonMat("#ffffff");
  const deskTop = toonMat("#e4ddf8"), legMat = toonMat("#f2a774"), monMat = toonMat("#2a1d52"), keyMat = toonMat("#e6e2f6");
  const chairMat = toonMat("#3a52ff"), darkMat = toonMat("#2a2340"), potMat = toonMat("#e56f4f"), leafMat = toonMat("#3fcf7a"), mugMat = toonMat("#ff7fb6");
  const visorMat = toonMat("#141019"), greyMat = toonMat("#8d93a3");
  const eyeV = new THREE.MeshBasicMaterial({ color: "#b48cff", toneMapped: false }), eyeG = new THREE.MeshBasicMaterial({ color: "#3dffc0", toneMapped: false });

  // parts: [geometry, material, local matrix, which list ("desk"/"bot"), filter, dynamic kind, coloured]
  // the bot parts copy makeBot's rounded shapes (radius and size as in bots.js, scale 0.95 baked in), so the crowd rows
  // just behind her desk read as the same mascot and not as boxes
  const B = BOT, S = 0.95, headY = B.dy + 0.83 * S, shoulderY = B.dy + 0.48 * S;
  const RB = (w, h, d, r) => new RoundedBoxGeometry(w * S, h * S, d * S, 2, r * S);
  const parts = [
    [new THREE.BoxGeometry(1.3, 0.05, 0.7), deskTop, local(0, 0.62, 0), "desk"],
    [new THREE.BoxGeometry(0.05, 0.6, 0.62), legMat, local(-0.6, 0.3, 0), "desk"],
    [new THREE.BoxGeometry(0.05, 0.6, 0.62), legMat, local(0.6, 0.3, 0), "desk"],
    [new THREE.BoxGeometry(0.52, 0.34, 0.04), monMat, local(0.45, 0.99, -0.08, 0, 0.6, 0), "desk"],
    [new THREE.BoxGeometry(0.05, 0.17, 0.05), monMat, local(0.45, 0.73, -0.06), "desk"],
    [new THREE.BoxGeometry(0.2, 0.015, 0.13), monMat, local(0.45, 0.652, -0.06), "desk"],
    [new THREE.BoxGeometry(0.4, 0.02, 0.13), keyMat, local(0.12, 0.655, -0.22), "desk"],
    [new THREE.BoxGeometry(0.5, 0.07, 0.46), chairMat, local(B.x, 0.325, -0.58), "desk"],
    [new THREE.BoxGeometry(0.5, 0.42, 0.06), chairMat, local(B.x, 0.6, -0.84), "desk"],
    [new THREE.BoxGeometry(0.05, 0.29, 0.05), darkMat, local(B.x, 0.145, -0.58), "desk"],
    [new THREE.BoxGeometry(0.42, 0.03, 0.06), darkMat, local(B.x, 0.015, -0.58), "desk"],
    [new THREE.CylinderGeometry(0.07, 0.055, 0.12, 10), potMat, local(-0.5, 0.705, -0.2), "desk", (d) => d.plant],
    [new THREE.IcosahedronGeometry(0.11, 1), leafMat, local(-0.5, 0.83, -0.2), "desk", (d) => d.plant],
    [new THREE.CylinderGeometry(0.04, 0.036, 0.09, 10), mugMat, local(-0.25, 0.69, 0.1), "desk", (d) => d.mug],
    // the bot, seated (scale 0.95 baked in)
    [RB(0.5, 0.42, 0.38, 0.12), white, local(B.x, B.dy + 0.34 * S, B.z), "bot", null, null, true],
    [RB(0.22, 0.14, 0.02, 0.03), visorMat, local(B.x, B.dy + 0.36 * S, B.z + 0.19 * S), "bot"], // chest panel
    [RB(0.17, 0.26, 0.2, 0.06), white, local(B.x - 0.13 * S, B.dy + 0.235, B.z + 0.11, -1.45), "bot", null, null, true],
    [RB(0.17, 0.26, 0.2, 0.06), white, local(B.x + 0.13 * S, B.dy + 0.235, B.z + 0.11, -1.45), "bot", null, null, true],
    [RB(0.66, 0.54, 0.5, 0.16), white, local(B.x, headY, B.z), "bot", null, "head", true],
    [RB(0.52, 0.32, 0.06, 0.06), visorMat, local(B.x, headY, B.z + 0.235 * S), "bot", null, "head"],
    [new THREE.BoxGeometry(0.06, 0.06, 0.012), eyeV, local(B.x - 0.088, headY, B.z + 0.258, 0, 0, Math.PI / 4), "bot", null, "head"],
    [new THREE.BoxGeometry(0.1, 0.026, 0.012), eyeG, local(B.x + 0.098, headY + 0.005, B.z + 0.258), "bot", null, "head"],
    [new THREE.CylinderGeometry(0.114, 0.114, 0.75, 16), greyMat, local(B.x, headY, B.z, 0, 0, Math.PI / 2), "bot", null, "head"],
    [new THREE.ConeGeometry(0.13 * S, 0.24 * S, 4), white, local(B.x - 0.21 * S, headY + 0.33 * S, B.z - 0.02, 0, Math.PI / 4, 0.18), "bot", null, "head", true],
    [new THREE.ConeGeometry(0.13 * S, 0.24 * S, 4), white, local(B.x + 0.21 * S, headY + 0.33 * S, B.z - 0.02, 0, Math.PI / 4, -0.18), "bot", null, "head", true],
    [new THREE.ConeGeometry(0.075 * S, 0.15 * S, 4), visorMat, local(B.x - 0.21 * S + 0.009, headY + 0.31 * S, B.z + 0.03, 0, Math.PI / 4, 0.18), "bot", null, "head"],
    [new THREE.ConeGeometry(0.075 * S, 0.15 * S, 4), visorMat, local(B.x + 0.21 * S - 0.009, headY + 0.31 * S, B.z + 0.03, 0, Math.PI / 4, -0.18), "bot", null, "head"],
    [RB(0.13, 0.3, 0.15, 0.05), white, null, "bot", null, "armR", true],
    [RB(0.13, 0.3, 0.15, 0.05), white, null, "bot", null, "armL", true],
  ];
  const meshes = parts.map(([geo, mat, L, list, filter, dyn, coloured]) => {
    const src = list === "desk" ? desks : bots;
    const items = [];
    src.forEach((it) => { const dk = list === "desk" ? it : desks[it.desk]; if (!filter || filter(dk)) items.push({ it, dk }); });
    const m = new THREE.InstancedMesh(geo, mat, items.length);
    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (coloured) { const col = new THREE.Color(); items.forEach(({ it }, k) => m.setColorAt(k, col.set(it.col))); m.instanceColor.needsUpdate = true; }
    g.add(m);
    return { m, L, items, dyn };
  });

  /** pose the crowd at time t. popAt(d) -> scale 0..1 (from the floor up) for a desk at distance d, or null for 1. */
  function update(t, o = {}) {
    const popAt = o.popAt, tapK = o.tapK ?? 1;
    for (const { m, L, items, dyn } of meshes) {
      const a = m.instanceMatrix.array;
      for (let k = 0; k < items.length; k++) {
        const { it, dk } = items[k];
        const s = popAt ? popAt(dk.d) : 1;
        let e;
        if (!dyn) e = L.elements;
        else {
          const ph = it.ph + t * 9.5 * it.rate;
          if (dyn === "head") { _m.copy(L); _m.elements[13] += Math.abs(Math.sin(ph * 0.5)) * 0.014 * tapK; e = _m.elements; }
          else {
            const side = dyn === "armL" ? 1 : -1, th = 1.3 + Math.sin(ph + (side > 0 ? 0 : Math.PI)) * 0.14 * tapK;
            const ax = -th, cA = Math.cos(ax), sA = Math.sin(ax), off = -0.13 * S;
            e = _m.elements;
            e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0; e[4] = 0; e[5] = cA; e[6] = sA; e[7] = 0; e[8] = 0; e[9] = -sA; e[10] = cA; e[11] = 0;
            e[12] = BOT.x + side * 0.29 * S; e[13] = shoulderY + off * cA; e[14] = BOT.z + off * sA; e[15] = 1;
          }
        }
        const o16 = k * 16;
        for (let j = 0; j < 12; j++) a[o16 + j] = e[j] * s;
        a[o16 + 12] = dk.x + e[12] * s; a[o16 + 13] = e[13] * s; a[o16 + 14] = dk.z + e[14] * s; a[o16 + 15] = 1;
        a[o16 + 3] = a[o16 + 7] = a[o16 + 11] = 0;
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }
  const ds = desks.map((d) => d.d).sort((a, b) => a - b);
  /** how many desks lie within distance d of hers (binary search) */
  const within = (d) => { let lo = 0, hi = ds.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ds[m] < d) lo = m + 1; else hi = m; } return lo; };
  return { update, within, total: ds.length + 1 };
}

// ---------- her phone (one model everywhere: on the desk, in her hand, at her ear; c06 uses it too) ----------
/** Wei Ling's phone: a pink case with a camera bump, a dark bezel and a screen that shows an app frame. Local frame:
 *  +z = screen normal, +y = the phone's top. */
export function makeScreenPhone() {
  const g = new THREE.Group();
  const cv = document.createElement("canvas"); cv.width = 585; cv.height = 1266;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.176, 0.014, 4, 0.012), toonMat("#ff5fa8")));
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.166, 0.004, 2, 0.008), toonMat("#1b1825")); bezel.position.z = 0.0062; g.add(bezel);
  const bump = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.032, 0.008, 2, 0.006), toonMat("#2a1d52")); bump.position.set(-0.02, 0.06, -0.008); g.add(bump);
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.072, 0.156), mat); screen.position.z = 0.0086; g.add(screen);
  g.scale.setScalar(PHONE_S);
  let key = null;
  /** draw an app frame (img) with a brightness flash 0..1; dark when img is null */
  function setScreen(img, flash = 0) {
    const k = (img ? img.src : "none") + "|" + flash.toFixed(2);
    if (k === key) return; key = k;
    const x = cv.getContext("2d");
    if (img) x.drawImage(img, 0, 0, cv.width, cv.height); else { x.fillStyle = "#121018"; x.fillRect(0, 0, cv.width, cv.height); }
    if (flash > 0) { x.fillStyle = `rgba(220,200,255,${flash * 0.55})`; x.fillRect(0, 0, cv.width, cv.height); }
    tex.needsUpdate = true;
  }
  setScreen(null);
  return { g, setScreen, screen };
}
export function makeHandPhone() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.176, 0.014, 4, 0.012), toonMat("#ff5fa8")));
  const bump = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.032, 0.008, 2, 0.006), toonMat("#2a1d52")); bump.position.set(-0.02, 0.06, -0.007); g.add(bump);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.072, 0.156), new THREE.MeshBasicMaterial({ color: "#cfc4ff", toneMapped: false })); scr.position.z = 0.0075; g.add(scr);
  return g;
}
export function makeBag() {
  const g = new THREE.Group();
  const body = toonMat("#ff7a5a"), trim = toonMat("#ffd94a"), strap = toonMat("#c94a3a");
  g.add(rbox(0.26, 0.2, 0.11, 0.035, body, 0, 0.1, 0));
  g.add(box(0.262, 0.05, 0.112, trim, 0, 0.17, 0));
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20, Math.PI), strap); h.position.set(0, 0.2, 0); g.add(h);
  g.add(ball(0.022, toonMat("#7fe3c0"), 0.1, 0.06, 0.06));
  return g;
}

// ---------- the set ----------
export function buildOffice() {
  const g = new THREE.Group();
  const U = (g.userData = {});
  // floor: dark violet, a glowing cyan grid (2 m cells, desks in the middle of each), pink dots at the crossings
  const gt = gridTex(); gt.repeat.set(200, 200); gt.offset.set(0.5, 0.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toonMat("#2a1670", { emissive: new THREE.Color("#ffffff"), emissiveMap: gt }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(170, 48, 24), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 512, skyPaint), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -1; g.add(sky); U.sky = sky;
  // hanging dashboards
  [[-7, 5.6, -12, 0.25, 0], [6.5, 6.3, -19, -0.15, 1], [-1.5, 7.2, -31, 0.05, 2], [15, 6.0, -11, -0.45, 3], [-17, 6.6, -24, 0.4, 1]].forEach(([x, y, z, ry, k]) => {
    const b = new THREE.Group(); b.position.set(x, y, z); b.rotation.y = ry;
    b.add(box(4.2, 2.3, 0.12, toonMat("#120a26"), 0, 0, -0.07));
    const p = painted(4, 2.1, 512, 270, boardPaint(k), { unlit: true }); b.add(p);
    for (const s of [-1, 1]) b.add(cyl(0.02, 0.02, 30, toonMat("#2a2340"), s * 1.6, 16, -0.07, 6));
    g.add(b);
  });
  // an LED counter board over the floor: AT THEIR DESKS 1,735 (ticks as the desks pop in)
  const cnt = new THREE.Group(); cnt.position.set(0.8, 5.4, -9); cnt.rotation.set(0.12, -0.12, 0); g.add(cnt);
  cnt.add(box(5.6, 2.0, 0.16, toonMat("#140a2e"), 0, 0, -0.09));
  for (const s2 of [-1, 1]) cnt.add(cyl(0.025, 0.025, 30, toonMat("#2a2340"), s2 * 2.2, 16, -0.09, 6));
  const ccv = document.createElement("canvas"); ccv.width = 512; ccv.height = 182;
  const ctex = new THREE.CanvasTexture(ccv); ctex.colorSpace = THREE.SRGBColorSpace;
  cnt.add(new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.92), new THREE.MeshBasicMaterial({ map: ctex, toneMapped: false })));
  let lastN = -1;
  U.setCount = (n) => {
    if (n === lastN) return; lastN = n;
    const c = ccv.getContext("2d"); c.fillStyle = "#1a0f33"; c.fillRect(0, 0, 512, 182);
    c.strokeStyle = "#ff4fb4"; c.lineWidth = 5; c.strokeRect(5, 5, 502, 172);
    c.fillStyle = "#ff9ad8"; c.font = "800 26px 'Segoe UI', sans-serif"; c.textBaseline = "middle"; c.fillText("AT THEIR DESKS", 26, 36);
    c.font = "900 96px 'Courier New', monospace"; c.fillStyle = "#ff9a2e"; c.shadowColor = "#ff9a2e"; c.shadowBlur = 16;
    c.fillText(n.toLocaleString("en-US"), 26, 118); c.shadowBlur = 0;
    ctex.needsUpdate = true;
  };
  U.setCount(1);
  // the crowd
  const crowd = buildCrowd(g); U.crowd = crowd;

  // her desk: same desk, plus her things
  const her = new THREE.Group(); g.add(her); U.her = her;
  const deskTop = toonMat("#e4ddf8"), legMat = toonMat("#f2a774"), monMat = toonMat("#2a1d52");
  const top = box(1.3, 0.05, 0.7, deskTop, 0, 0.62, 0); top.receiveShadow = true; her.add(top);
  for (const s of [-1, 1]) her.add(box(0.05, 0.6, 0.62, legMat, s * 0.6, 0.3, 0));
  // monitor (screen toward her) with sticky notes on its edges
  const mon = new THREE.Group(); mon.position.set(0.45, 0, -0.08); mon.rotation.y = 0.6; her.add(mon);
  mon.add(box(0.52, 0.34, 0.04, monMat, 0, 0.99, 0));
  const scr = painted(0.48, 0.3, 256, 160, codePaint, { unlit: true }); scr.rotation.y = Math.PI; scr.position.set(0, 0.99, -0.021); mon.add(scr);
  mon.add(box(0.05, 0.17, 0.05, monMat, 0, 0.73, 0.02), box(0.2, 0.015, 0.13, monMat, 0, 0.652, 0.02));
  [["#ffe066", 0.27, 1.1, 0.25], ["#ff9fd0", 0.29, 0.98, -0.2], ["#7fe3c0", -0.27, 1.12, 0.15], ["#ffe066", 0.1, 1.17, 0.05]].forEach(([c, x, y, r]) => {
    const n = box(0.07, 0.07, 0.004, toonMat(c), x, y, 0.024); n.rotation.z = r; mon.add(n);
  });
  // keyboard, mouse
  her.add(rbox(0.4, 0.022, 0.13, 0.008, toonMat("#e6e2f6"), 0.12, 0.656, -0.22));
  her.add(rbox(0.05, 0.025, 0.08, 0.012, toonMat("#e6e2f6"), 0.4, 0.657, -0.24));
  // plant by the monitor
  const pl = new THREE.Group(); pl.position.set(0.58, DESK_TOP, -0.27); her.add(pl);
  pl.add(cyl(0.065, 0.05, 0.11, toonMat("#e56f4f"), 0, 0.055, 0));
  [[0, 0.17, 0, 0.08], [-0.05, 0.14, 0.03, 0.06], [0.05, 0.15, -0.02, 0.065], [0.02, 0.23, 0.01, 0.055]].forEach(([x, y, z, r], i) => pl.add(ball(r, toonMat(i % 2 ? "#3fcf7a" : "#5fe08f"), x, y, z)));
  // framed photo of her dad at the back-left corner, turned between her and the camera
  const ph = new THREE.Group(); ph.position.set(-0.5, DESK_TOP, -0.25); ph.rotation.y = 0.45; her.add(ph);
  const frame = poster(0.2, 0.15, photoPaint, "#ff6fb0"); frame.position.set(0, 0.095, 0); frame.rotation.x = -0.12; ph.add(frame);
  ph.add(box(0.03, 0.12, 0.02, toonMat("#c94a8a"), 0, 0.06, -0.05));
  U.photo = ph;
  // mug with a heart, sticky notes on the desk
  const mug = new THREE.Group(); mug.position.set(-0.47, DESK_TOP, 0.13); her.add(mug);
  mug.add(cyl(0.042, 0.038, 0.1, toonMat("#ffffff"), 0, 0.05, 0));
  mug.add(cyl(0.036, 0.036, 0.004, toonMat("#5a3020"), 0, 0.098, 0));
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16), toonMat("#ffffff")); hdl.position.set(0.045, 0.05, 0); mug.add(hdl);
  const heart = painted(0.05, 0.05, 64, 64, (c) => { c.fillStyle = "#ffffff"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#ff4f8f"; c.font = "900 52px Segoe UI"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("♥", 32, 36); });
  heart.position.set(0, 0.05, 0.043); mug.add(heart);
  [["#ffe066", -0.03, 0.12, 0.35], ["#ff9fd0", -0.3, 0.2, -0.3], ["#7fd0ff", 0.27, 0.18, 0.15], ["#7fe3c0", -0.16, 0.21, -0.1]].forEach(([c, x, z, r]) => { const n = box(0.075, 0.004, 0.075, toonMat(c), x, DESK_TOP + 0.002, z); n.rotation.y = r; her.add(n); });
  const pen = cyl(0.007, 0.007, 0.14, toonMat("#ff4f8f"), -0.36, DESK_TOP + 0.008, 0.25, 8); pen.rotation.set(Math.PI / 2, 0, 0.7); pen.rotation.order = "YXZ"; her.add(pen);
  // name plate on the front edge (like the reference's name plate)
  const plate = new THREE.Group(); plate.position.set(0.12, DESK_TOP, 0.29); her.add(plate);
  plate.add(box(0.26, 0.055, 0.03, toonMat("#1a1030"), 0, 0.03, 0));
  const pt = painted(0.24, 0.045, 256, 48, (c, W, H) => { c.fillStyle = "#1a1030"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "800 30px Segoe UI"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("WEI LING", W / 2, H / 2 + 2); }, { unlit: true });
  pt.position.set(0, 0.03, 0.016); plate.add(pt);
  // the phone on the desk (screen up, top toward her, beside the keyboard where her right hand can reach it), and her
  // bag on the floor by the desk's left end. The holder's frame: +y = screen normal, -z = the phone's top; the chapter
  // moves the holder in world space when she picks the phone up (the office group and `her` stay at the origin).
  const dp = makeScreenPhone(); const dpo = new THREE.Group(); dpo.position.set(DESK_PHONE.x, DESK_TOP + 0.0098, DESK_PHONE.z); dpo.rotation.y = DESK_PHONE.yaw; her.add(dpo);
  dp.g.rotation.x = -Math.PI / 2; dpo.add(dp.g); U.deskPhone = dp; U.deskPhoneHolder = dpo;
  const bag = makeBag(); bag.position.set(BAG_FLOOR.x, 0, BAG_FLOOR.z); bag.rotation.y = BAG_FLOOR.yaw; her.add(bag); U.deskBag = bag;
  for (const o of [dpo, bag]) o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  // her chair (spins when she leaves)
  const chair = new THREE.Group(); chair.position.set(BOT.x, 0, -0.58); her.add(chair); U.chair = chair;
  const chairMat = toonMat("#3a52ff"), dark = toonMat("#2a2340");
  chair.add(box(0.5, 0.07, 0.46, chairMat, 0, 0.325, 0), box(0.5, 0.42, 0.06, chairMat, 0, 0.6, -0.26), box(0.05, 0.29, 0.05, dark, 0, 0.145, 0));
  chair.add(box(0.42, 0.03, 0.06, dark, 0, 0.015, 0), box(0.06, 0.03, 0.42, dark, 0, 0.015, 0));

  U.fog = new OfficeFog("#c43aa6", 14, 80); U.fog.set = g;
  return g;
}
