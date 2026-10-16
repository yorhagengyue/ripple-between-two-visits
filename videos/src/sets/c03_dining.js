// Mr Tan's dining corner in his HDB flat, 8:05 in the morning (chapter 3 · blood pressure).
// A small table with a coral gingham cloth and two wooden chairs; on the table a home upper-arm BP monitor with its cuff
// and tube, his phone, a cup of kopi on a saucer, an empty plate, a thermos, an unopened bag of bread. A window on the
// left wall lets the low morning sun in (the left wall casts shadows, so the light lands as a window-shaped patch); the
// view is the next HDB block with laundry poles. On the back wall: a round clock at 8:05, a tear-off calendar on 15,
// a 福, a shelf of tins, a family photo; a TV on a cabinet; a blue standing fan; a pendant lamp; plants.
// Origin: floor under the table centre. Back wall z = -1.5, left wall x = -2.0. Mr Tan sits at (0, -0.6) facing +z.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toon, flat } from "../look.js";
import { canvasTex, makePhone } from "../chars.js";
import { hash } from "../core.js";
import { box, rbox, cyl, ball, painted, tiles, wall, windowView, plant, poster, shadowy } from "./kit.js";

export const TABLE_Y = 0.65;               // table top (low enough that his arms, beard and the phone in his hand clear it)
export const TAN = { x: 0, z: -0.6, seat: 0.42 };
export const MONITOR = { x: 0.46, z: 0.0, ry: -0.3 };
export const BACK_Z = -1.5, LEFT_X = -2.0;
export const WIN_Z = 0.35, WIN_Y = 1.45, WIN_W = 1.5, WIN_H = 1.25; // the window in the left wall
/** the morning sun comes in through the window, low, from the left and a little from the front */
export const SUN_DIR = new THREE.Vector3(2, -0.55, -0.75).normalize();

const INK = "#1a1030";

// No shadow maps in this renderer, so light and contact shadows are painted: decals that skip the normal/depth pass
// (the ink lines) by drawing nothing while scene.overrideMaterial is set.
const skipInk = (m) => { m.onBeforeRender = (r, sc, cam, geo) => geo.setDrawRange(0, sc.overrideMaterial ? 0 : Infinity); return m; };
function decal(w, h, draw, o = {}) {
  const m = painted(w, h, o.px ?? 256, Math.max(16, Math.round((o.px ?? 256) * h / w)), draw, { unlit: true, transparent: true });
  m.material.depthWrite = false; m.material.opacity = o.opacity ?? 1;
  if (o.additive) m.material.blending = THREE.AdditiveBlending;
  if (o.double) m.material.side = THREE.DoubleSide;
  m.renderOrder = o.order ?? 1;
  return skipInk(m);
}
/** a light shaft from the window: a long soft additive ribbon */
function shaft(len, wid) {
  return decal(wid, len, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(255,226,170,.9)"); g.addColorStop(1, "rgba(255,200,140,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const e = c.createLinearGradient(0, 0, W, 0); e.addColorStop(0, "rgba(0,0,0,1)"); e.addColorStop(0.3, "rgba(0,0,0,0)"); e.addColorStop(0.7, "rgba(0,0,0,0)"); e.addColorStop(1, "rgba(0,0,0,1)");
    c.globalCompositeOperation = "destination-out"; c.fillStyle = e; c.fillRect(0, 0, W, H);
  }, { additive: true, opacity: 0.16, double: true, px: 64, order: 3 });
}

/** The view out of the window: a morning sky and the next HDB block with laundry poles and air-con boxes. */
function hdbMorning(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#ffb98c"); g.addColorStop(0.45, "#ffd8a0"); g.addColorStop(1, "#fff1c8");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // the sun's glow, upper left
  const sg = c.createRadialGradient(W * 0.15, H * 0.12, 4, W * 0.15, H * 0.12, W * 0.35);
  sg.addColorStop(0, "rgba(255,255,235,1)"); sg.addColorStop(0.25, "rgba(255,240,190,.8)"); sg.addColorStop(1, "rgba(255,220,160,0)");
  c.fillStyle = sg; c.fillRect(0, 0, W, H);
  c.strokeStyle = "#ff8fb0"; c.lineCap = "round"; c.lineWidth = H * 0.025;
  for (let i = 0; i < 2; i++) { const y = H * (0.1 + i * 0.08); c.beginPath(); for (let x = W * 0.35; x <= W; x += 20) c.lineTo(x, y + Math.sin(x / 60 + i) * 5); c.stroke(); }
  // the next block: a big cream slab with a teal stripe, windows, air-con boxes and laundry poles
  const bx = W * 0.22, by = H * 0.24;
  c.fillStyle = "#f6e2c4"; c.fillRect(bx, by, W - bx, H - by);
  c.fillStyle = "#e7c9a6"; c.fillRect(bx, by, W * 0.05, H - by);
  c.fillStyle = "#57b9ad"; c.fillRect(bx, by, W - bx, H * 0.035);
  const rows = 6, cols = 5, cw = (W - bx) / cols, rh = (H - by) / rows;
  const clothes = ["#ff6f91", "#5cc7ff", "#ffe66d", "#ffffff", "#8f7dff", "#6be3a4", "#ff9a2e"];
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = bx + k * cw + cw * 0.18, y = by + H * 0.06 + r * rh;
    c.fillStyle = hash(r * 9 + k) > 0.7 ? "#ffe9a8" : "#3b5f8f"; c.fillRect(x, y, cw * 0.5, rh * 0.42);
    c.fillStyle = "#f9f3ea"; c.fillRect(x - 3, y + rh * 0.42, cw * 0.5 + 6, 4);
    if (hash(r * 5 + k * 3) > 0.55) { c.fillStyle = "#ffffff"; c.fillRect(x + cw * 0.56, y + rh * 0.2, cw * 0.2, rh * 0.18); c.fillStyle = "#c9c2b8"; c.fillRect(x + cw * 0.56, y + rh * 0.38, cw * 0.2, 3); }
    if (hash(r * 13 + k * 7) > 0.45) { // laundry poles sticking out with clothes
      c.strokeStyle = "#8a6a4a"; c.lineWidth = 3;
      for (let p = 0; p < 3; p++) { c.beginPath(); c.moveTo(x - cw * 0.1, y + rh * 0.5 + p * 4); c.lineTo(x + cw * 0.75, y + rh * 0.47 + p * 4); c.stroke(); }
      for (let p = 0; p < 4; p++) { c.fillStyle = clothes[Math.floor(hash(r * 31 + k * 17 + p) * clothes.length)]; c.fillRect(x + p * cw * 0.17, y + rh * 0.5, cw * 0.12, rh * (0.18 + hash(p + r) * 0.12)); }
    }
  }
  // trees below
  c.fillStyle = "#4fae6a";
  for (let i = 0; i < 9; i++) { c.beginPath(); c.arc((i / 8) * W, H * 0.98, W * 0.07 + hash(i) * 20, 0, 7); c.fill(); }
  c.fillStyle = "#6fcf86";
  for (let i = 0; i < 9; i++) { c.beginPath(); c.arc((i / 8) * W + 18, H * 0.95, W * 0.04, 0, 7); c.fill(); }
}

/** A round wall clock with hands; setTime(hours, minutes, seconds). */
function wallClock() {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 40), toon("#e2433f")); g.add(rim);
  const face = painted(0.34, 0.34, 256, 256, (c, W, H) => {
    c.fillStyle = "#fffaf0"; c.beginPath(); c.arc(W / 2, H / 2, W / 2, 0, 7); c.fill();
    c.fillStyle = INK; c.font = "900 30px 'Segoe UI', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillText(String(i), W / 2 + Math.sin(a) * 96, H / 2 - Math.cos(a) * 96); }
    for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; c.fillRect(W / 2 + Math.sin(a) * 120 - 1.5, H / 2 - Math.cos(a) * 120 - 1.5, 3, 3); }
  }, { transparent: true });
  face.position.z = 0.005; g.add(face);
  const hand = (len, w, col, z) => { const p = new THREE.Group(); p.position.z = z; const m = box(w, len, 0.008, toon(col), 0, len / 2 - 0.02, 0); p.add(m); g.add(p); return p; };
  const hh = hand(0.09, 0.022, INK, 0.012), mh = hand(0.13, 0.014, INK, 0.018), sh = hand(0.14, 0.006, "#e2433f", 0.024);
  g.add(cyl(0.014, 0.014, 0.01, toon("#e2433f"), 0, 0, 0.03).rotateX(Math.PI / 2));
  g.userData.setTime = (h, m, s) => {
    sh.rotation.z = -(s / 60) * Math.PI * 2;
    mh.rotation.z = -((m + s / 60) / 60) * Math.PI * 2;
    hh.rotation.z = -(((h % 12) + m / 60) / 12) * Math.PI * 2;
  };
  return g;
}

/** The home BP monitor: a white body, a tilted LCD, a big START button, a port for the tube. setReading(state). */
function bpMonitor() {
  const g = new THREE.Group();
  const white = toon("#f4f6fb"), blue = toon("#3f7fe0");
  g.add(rbox(0.28, 0.1, 0.2, 0.035, white, 0, 0.05, 0));
  // the raised back with the tilted display
  const head = new THREE.Group(); head.position.set(0.02, 0.1, -0.035); head.rotation.x = -0.42; g.add(head);
  head.add(rbox(0.26, 0.17, 0.05, 0.02, white, 0, 0.06, 0));
  head.add(box(0.2, 0.12, 0.01, toon("#2a2f3a"), 0, 0.065, 0.025));
  const cv = document.createElement("canvas"); cv.width = 320; cv.height = 192;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.185, 0.11), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  lcd.position.set(0, 0.065, 0.031); head.add(lcd);
  // front strip and the START button
  g.add(box(0.29, 0.02, 0.005, blue, 0, 0.035, 0.1));
  const btn = cyl(0.034, 0.036, 0.022, toon("#ff8a2a"), -0.085, 0.106, 0.06); g.add(btn);
  g.add(cyl(0.042, 0.042, 0.006, toon("#2a2f3a"), -0.085, 0.1, 0.06));
  const lbl = painted(0.08, 0.025, 128, 40, (c, W, H) => { c.fillStyle = "#f4f6fb"; c.fillRect(0, 0, W, H); c.fillStyle = "#3f7fe0"; c.font = "900 28px 'Segoe UI'"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("START", W / 2, H / 2 + 1); });
  lbl.rotation.x = -Math.PI / 2; lbl.position.set(0.02, 0.101, 0.07); g.add(lbl);
  for (let i = 0; i < 2; i++) g.add(cyl(0.012, 0.012, 0.008, toon("#9aa4b8"), 0.06 + i * 0.035, 0.101, 0.07));
  // the port on the left side
  const port = cyl(0.014, 0.014, 0.03, toon("#2a2f3a"), -0.15, 0.06, -0.05); port.rotation.z = Math.PI / 2; g.add(port);
  g.userData.btn = btn; g.userData.lcd = lcd;
  g.userData.port = new THREE.Vector3(-0.165, 0.06, -0.05);
  let last = "";
  const seg7 = (c, txt, x, y, size, col) => { c.font = `900 ${size}px "Consolas", "Courier New", monospace`; c.textAlign = "right"; c.textBaseline = "alphabetic"; c.fillStyle = col; c.fillText(txt, x, y); };
  /** s: { mode: "off" | "zero" | "press" | "result", val, sys, dia, pul, heart } */
  g.userData.setReading = (s) => {
    const key = JSON.stringify(s); if (key === last) return; last = key;
    const c = cv.getContext("2d"), W = cv.width, H = cv.height;
    c.fillStyle = s.mode === "off" ? "#9fb0a0" : "#cfe6c6"; c.fillRect(0, 0, W, H);
    const on = "#14261a", ghost = "rgba(20,38,26,.08)";
    if (s.mode === "off") { tex.needsUpdate = true; return; }
    c.font = "800 20px 'Segoe UI'"; c.fillStyle = on; c.textAlign = "left"; c.textBaseline = "top";
    if (s.mode === "zero" || s.mode === "press") {
      c.fillText("mmHg", 14, 12);
      seg7(c, "888", W - 16, 132, 120, ghost);
      seg7(c, String(Math.round(s.val ?? 0)), W - 16, 132, 120, on);
      if (s.heart) { c.fillStyle = "#c2304a"; c.font = "900 34px 'Segoe UI Symbol', 'Segoe UI'"; c.fillText("♥", 18, 140); }
    } else {
      c.fillText("SYS", 12, 18); c.fillText("DIA", 12, 108);
      c.font = "700 13px 'Segoe UI'"; c.fillText("mmHg", 12, 40); c.fillText("mmHg", 12, 130);
      seg7(c, "888", W - 70, 94, 92, ghost); seg7(c, String(s.sys), W - 70, 94, 92, on);
      seg7(c, "88", W - 70, 180, 76, ghost); seg7(c, String(s.dia), W - 70, 180, 76, on);
      c.font = "800 16px 'Segoe UI'"; c.textAlign = "right"; c.fillText("PUL", W - 14, 108);
      seg7(c, String(s.pul ?? 78), W - 12, 160, 44, on);
      if (s.heart) { c.fillStyle = "#c2304a"; c.font = "900 30px 'Segoe UI Symbol', 'Segoe UI'"; c.textAlign = "right"; c.fillText("♥", W - 22, 16); }
    }
    tex.needsUpdate = true;
  };
  g.userData.setReading({ mode: "off" });
  return g;
}

/** The arm-in cuff: a puffy navy ring around the upper arm, with a grey band, a velcro flap and a white label.
 *  Its local y is the arm's direction; scale x/z to inflate it. */
function bpCuff() {
  const g = new THREE.Group();
  const navy = toon("#3a5fd8");
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.034, 12, 28), navy); ring.rotation.x = Math.PI / 2; ring.scale.z = 2.1; g.add(ring);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.012, 8, 28), toon("#c9cfdd")); band.rotation.x = Math.PI / 2; band.position.y = 0.045; g.add(band);
  const flap = rbox(0.07, 0.12, 0.03, 0.012, toon("#ffd94a"), 0, -0.005, 0.145); flap.rotation.y = 0.0; g.add(flap);
  g.add(box(0.06, 0.03, 0.005, flat("#ffffff"), 0.08, -0.03, 0.115).rotateY(0.6));
  g.userData.flap = flap;
  g.userData.port = new THREE.Vector3(0.15, -0.03, 0); // where the tube goes in (local)
  return g;
}

/** A kopi cup on a saucer with a spoon; userData.coffee is the surface. */
function kopi() {
  const g = new THREE.Group();
  const white = toon("#fbf8f2"), green = toon("#2f9e6a");
  g.add(cyl(0.085, 0.07, 0.014, white, 0, 0.007, 0, 32));
  g.add(cyl(0.064, 0.064, 0.003, green, 0, 0.0155, 0, 32));
  const cup = new THREE.Group(); cup.position.y = 0.014; g.add(cup);
  cup.add(cyl(0.05, 0.04, 0.085, white, 0, 0.0425, 0, 28));
  cup.add(cyl(0.0505, 0.0505, 0.014, green, 0, 0.072, 0, 28));
  const coffee = cyl(0.046, 0.046, 0.004, toon("#7a4a2a"), 0, 0.078, 0, 24); cup.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 8, 16), white); handle.position.set(0.056, 0.045, 0); cup.add(handle);
  const spoon = new THREE.Group(); spoon.position.set(-0.02, 0.018, 0.058); spoon.rotation.y = 0.5;
  spoon.add(box(0.008, 0.004, 0.08, toon("#c9ced8"), 0, 0, 0)); spoon.add(ball(0.014, toon("#c9ced8"), 0, 0, 0.045)); g.add(spoon);
  g.userData.cup = cup;
  return g;
}

/** A blue standing fan; userData.head turns (oscillates), userData.blades spin. */
function standingFan() {
  const g = new THREE.Group();
  const blue = toon("#4aa8ff"), white = toon("#f4f6fb"), dark = toon("#2a3550");
  g.add(cyl(0.2, 0.22, 0.05, blue, 0, 0.025, 0, 32));
  g.add(cyl(0.025, 0.025, 1.0, white, 0, 0.55, 0));
  g.add(rbox(0.08, 0.1, 0.06, 0.02, blue, 0, 0.12, 0.12)); // the knob box
  for (let i = 0; i < 3; i++) g.add(cyl(0.012, 0.012, 0.02, toon(["#ff6f91", "#ffe66d", "#6be3a4"][i]), -0.025 + i * 0.025, 0.12, 0.155).rotateX(Math.PI / 2));
  const head = new THREE.Group(); head.position.set(0, 1.07, 0); g.add(head);
  head.add(rbox(0.12, 0.13, 0.18, 0.04, blue, 0, 0, -0.08));
  const cage = new THREE.Group(); cage.position.z = 0.06; head.add(cage);
  cage.add(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.01, 8, 40), white));
  for (let i = 0; i < 8; i++) { const r = box(0.006, 0.44, 0.006, white, 0, 0, 0.02); r.rotation.z = (i / 8) * Math.PI; cage.add(r); }
  const blades = new THREE.Group(); blades.position.z = 0.03; head.add(blades);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), toon("#9fd4ff", { side: THREE.DoubleSide }));
    b.scale.set(0.6, 1, 1); b.position.set(Math.sin((i / 3) * Math.PI * 2) * 0.1, Math.cos((i / 3) * Math.PI * 2) * 0.1, 0); b.rotation.z = -(i / 3) * Math.PI * 2; blades.add(b);
  }
  blades.add(cyl(0.035, 0.035, 0.04, blue, 0, 0, 0.01).rotateX(Math.PI / 2));
  g.userData.head = head; g.userData.blades = blades;
  return g;
}

function chair(cushion = "#3fb3a3") {
  const g = new THREE.Group();
  const wood = toon("#c8743f"), dark = toon("#9b5530");
  g.add(rbox(0.46, 0.05, 0.44, 0.015, wood, 0, TAN.seat - 0.05, 0));
  g.add(rbox(0.42, 0.04, 0.4, 0.018, toon(cushion), 0, TAN.seat - 0.005, 0));
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) g.add(box(0.045, TAN.seat - 0.07, 0.045, dark, x, (TAN.seat - 0.07) / 2, z));
  for (const x of [-0.2, 0.2]) g.add(box(0.045, 0.5, 0.045, dark, x, TAN.seat + 0.22, -0.2));
  g.add(rbox(0.46, 0.13, 0.04, 0.015, wood, 0, TAN.seat + 0.4, -0.2));
  g.add(box(0.4, 0.04, 0.03, wood, 0, TAN.seat + 0.18, -0.2));
  return g;
}

export function buildDining() {
  const g = new THREE.Group();
  const U = (g.userData = {});

  // floor, walls, window
  const floor = tiles(9, 8, "#a8e6d4", "#fff3dd", 0.8); floor.position.set(0.5, 0, 0.5); g.add(floor);
  const back = wall(7, 3.4, "#ffe2a8", { band: "#3fb3a3" }); back.position.set(0.8, 1.7, BACK_Z); g.add(back);
  // left wall pieces around the window hole, tall enough that the sun only gets in through the window
  const lw = (z0, z1, y0, y1, uv) => {
    const w = z1 - z0, h = y1 - y0;
    const m = painted(w, h, 256, Math.max(32, Math.round(256 * h / w)), (c, W, H) => {
      c.fillStyle = "#ffd89a"; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,255,255,${0.05 + hash(i + uv) * 0.06})`; c.beginPath(); c.arc(hash(i * 3 + uv) * W, hash(i * 7 + uv) * H, 1.5 + hash(i * 11) * 2, 0, 7); c.fill(); }
      const bandTop = (y1 - 0.95) / h * H; // the teal wainscot below 0.95 m
      if (y0 < 0.95) { c.fillStyle = "#3fb3a3"; c.fillRect(0, bandTop, W, H - bandTop); c.fillStyle = "rgba(40,20,60,.3)"; c.fillRect(0, bandTop, W, 4); }
    });
    m.rotation.y = Math.PI / 2; m.position.set(LEFT_X, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const z0 = WIN_Z - WIN_W / 2, z1 = WIN_Z + WIN_W / 2, y0 = WIN_Y - WIN_H / 2, y1 = WIN_Y + WIN_H / 2;
  lw(BACK_Z, z0, 0, 6, 1); lw(z1, 4.5, 0, 6, 2); lw(z0, z1, 0, y0, 3); lw(z0, z1, y1, 6, 4);
  const win = windowView(WIN_W, WIN_H, hdbMorning, { curtains: "#ff7f6e", frame: "#fbf6ee" });
  win.rotation.y = Math.PI / 2; win.position.set(LEFT_X + 0.01, WIN_Y, WIN_Z); g.add(win);
  win.children[0].material.color.set("#ead8cc");
  win.traverse((o) => { if (o.isMesh && o.material.type !== "MeshBasicMaterial") { o.castShadow = true; } });
  // window grille: a few white bars (their shadows stripe the sun patch)
  const grille = new THREE.Group(); grille.rotation.y = Math.PI / 2; grille.position.set(LEFT_X + 0.06, WIN_Y, WIN_Z); g.add(grille);
  for (let i = 1; i < 4; i++) grille.add(box(WIN_W, 0.018, 0.018, toon("#fbf6ee"), 0, -WIN_H / 2 + (i / 4) * WIN_H, 0));
  grille.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // an orchid on the sill
  const orchid = new THREE.Group(); orchid.position.set(LEFT_X + 0.16, y0 - 0.03, WIN_Z + 0.45); g.add(orchid);
  orchid.add(cyl(0.06, 0.045, 0.1, toon("#ffffff"), 0, 0.05, 0));
  orchid.add(box(0.008, 0.3, 0.008, toon("#3f8f4f"), 0, 0.25, 0));
  for (let i = 0; i < 5; i++) orchid.add(ball(0.03, toon(i % 2 ? "#b44fd6" : "#d77ff0"), Math.sin(i) * 0.05, 0.3 + i * 0.035, Math.cos(i * 1.7) * 0.04));
  const leaves = ball(0.05, toon("#3f8f4f"), 0, 0.11, 0); leaves.scale.set(1.8, 0.4, 1.1); orchid.add(leaves);

  // the table with a coral gingham cloth
  const table = new THREE.Group(); table.position.set(0, 0, 0.05); g.add(table); U.table = table;
  const ging = (c, W, H) => {
    c.fillStyle = "#fff6ea"; c.fillRect(0, 0, W, H);
    const n = 12, s = W / n;
    c.fillStyle = "rgba(255,110,96,.55)"; for (let i = 0; i < n; i += 2) { c.fillRect(i * s, 0, s, H); c.fillRect(0, i * s, W, s); }
    c.fillStyle = "rgba(230,70,70,.35)"; for (let i = 0; i < n; i += 2) for (let j = 0; j < n; j += 2) c.fillRect(i * s, j * s, s, s);
  };
  const top = painted(1.14, 0.74, 512, 332, ging); top.rotation.x = -Math.PI / 2; top.position.y = TABLE_Y + 0.001; top.receiveShadow = true; table.add(top);
  table.add(box(1.14, 0.03, 0.74, toon("#fff6ea"), 0, TABLE_Y - 0.015, 0));
  for (const [w, d, x, z, ry] of [[1.14, 0.09, 0, 0.37, 0], [1.14, 0.09, 0, -0.37, 0], [0.74, 0.09, 0.57, 0, Math.PI / 2], [0.74, 0.09, -0.57, 0, Math.PI / 2]]) {
    const skirt = painted(w, d, 256, 24, (c, W, H) => { ging(c, W, W); c.fillStyle = "#e2433f"; c.fillRect(0, H - 4, W, 4); });
    skirt.position.set(x, TABLE_Y - d / 2, z); skirt.rotation.y = ry; table.add(skirt);
    const back2 = skirt.clone(); back2.rotation.y = ry + Math.PI; table.add(back2);
  }
  for (const [x, z] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) table.add(box(0.05, TABLE_Y - 0.09, 0.05, toon("#8a4a2a"), x, (TABLE_Y - 0.09) / 2, z));

  // the chairs: his behind the table, the other at the left end with a Good Morning towel on its back
  const c1 = chair(); c1.position.set(TAN.x, 0, TAN.z - 0.02); g.add(c1); U.chair = c1;
  const c2 = chair("#ff9a6e"); c2.position.set(-0.85, 0, 0.12); c2.rotation.y = Math.PI / 2; g.add(c2);
  const towel = painted(0.36, 0.3, 256, 214, (c, W, H) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H); c.fillStyle = "#e2433f"; c.fillRect(0, H * 0.08, W, 8); c.fillRect(0, H * 0.88, W, 8);
    c.fillStyle = "#d8283a"; c.font = "italic 900 44px 'Segoe UI', serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("Good", W / 2, H * 0.36); c.fillText("Morning", W / 2, H * 0.62);
  });
  towel.position.set(0, TAN.seat + 0.32, -0.175); c2.add(towel);
  const towelTop = box(0.36, 0.02, 0.06, toon("#ffffff"), 0, TAN.seat + 0.475, -0.2); c2.add(towelTop);
  // slippers
  for (const s of [-1, 1]) g.add(rbox(0.11, 0.035, 0.24, 0.015, toon("#3f66d9"), -0.45 + s * 0.08, 0.018, -0.75 + s * 0.03).rotateY(0.3));

  // on the table
  const mon = bpMonitor(); mon.position.set(MONITOR.x, TABLE_Y, MONITOR.z); mon.rotation.y = MONITOR.ry; g.add(mon); U.monitor = mon;
  const cuff = bpCuff(); g.add(cuff); U.cuff = cuff;
  const tube = new THREE.Mesh(new THREE.BufferGeometry(), toon("#3a3f52")); g.add(tube); U.tube = tube;
  const phone = makePhone(); phone.g.scale.setScalar(1.4); g.add(phone.g); U.phone = phone;
  // the body keeps makePhone's dark #1b1825, the same phone he has in c01 and c05 (no red case)
  phone.g.children[1].material.color.set("#d6d3e0"); // keeps the white app screen out of the bloom
  phone.g.add(rbox(0.026, 0.026, 0.004, 0.006, toon("#2a2633"), -0.02, 0.06, -0.006));
  const cup = kopi(); cup.position.set(-0.3, TABLE_Y, -0.21); g.add(cup); U.kopi = cup; // by his edge, in reach of his right hand
  const plate = new THREE.Group(); plate.position.set(-0.04, TABLE_Y, 0.2); g.add(plate); U.plate = plate;
  plate.add(cyl(0.14, 0.11, 0.016, toon("#fbf8f2"), 0, 0.008, 0, 36));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.006, 6, 40), toon("#4a86e8")); rim.rotation.x = Math.PI / 2; rim.position.y = 0.017; plate.add(rim);
  const fork = box(0.012, 0.004, 0.16, toon("#c9ced8"), 0.17, 0.004, 0.0); plate.add(fork);
  // thermos with flowers, a bag of bread (unopened), a tissue box
  const thermos = new THREE.Group(); thermos.position.set(-0.47, TABLE_Y, -0.1); g.add(thermos);
  const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.26, 24), toon("#ffffff", { map: canvasTex(256, 128, (c, W, H) => {
    c.fillStyle = "#e2433f"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 10; i++) { const x = hash(i) * W, y = 20 + hash(i * 3) * (H - 40); c.fillStyle = "#ffe66d"; for (let p = 0; p < 5; p++) { c.beginPath(); c.arc(x + Math.cos(p * 1.26) * 9, y + Math.sin(p * 1.26) * 9, 6, 0, 7); c.fill(); } c.fillStyle = "#fff"; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); }
  }) }));
  flask.position.y = 0.13; thermos.add(flask);
  thermos.add(cyl(0.045, 0.06, 0.05, toon("#c9ced8"), 0, 0.285, 0));
  thermos.add(cyl(0.05, 0.05, 0.04, toon("#e2433f"), 0, 0.33, 0));
  const bread = new THREE.Group(); bread.position.set(-0.4, TABLE_Y, 0.27); bread.rotation.y = -0.35; bread.scale.setScalar(0.85); g.add(bread);
  bread.add(rbox(0.24, 0.1, 0.12, 0.045, toon("#f4f6fb"), 0, 0.05, 0));
  bread.add(box(0.12, 0.101, 0.121, toon("#ffd94a"), 0.02, 0.05, 0));
  bread.add(box(0.03, 0.06, 0.06, toon("#3f7fe0"), 0.135, 0.05, 0));
  const tissue = new THREE.Group(); tissue.position.set(1.22, 0.575, BACK_Z + 0.42); tissue.rotation.y = 0.3; tissue.scale.setScalar(0.9); g.add(tissue);
  tissue.add(rbox(0.16, 0.08, 0.1, 0.01, toon("#ff9fc4"), 0, 0.04, 0));
  tissue.add(ball(0.03, toon("#ffffff"), 0, 0.09, 0));
  // steam puffs over the kopi
  U.steam = [0, 1, 2].map(() => { const b = ball(0.022, toon("#ffffff")); g.add(b); return b; });

  // the back wall: clock, tear-off calendar, 福, shelf with tins, family photo, switch
  const clock = wallClock(); clock.position.set(-0.62, 1.86, BACK_Z + 0.03); g.add(clock); U.clock = clock;
  const cal = new THREE.Group(); cal.position.set(0.62, 1.74, BACK_Z + 0.02); g.add(cal); U.calendar = cal;
  cal.add(box(0.34, 0.5, 0.03, toon("#c7a46a"), 0, 0, 0));
  const calFace = painted(0.3, 0.46, 256, 392, (c, W, H) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#d8283a"; c.fillRect(0, 0, W, H * 0.17);
    c.fillStyle = "#ffffff"; c.font = "800 30px 'Microsoft YaHei', 'Segoe UI'"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("十月  OCT 2026", W / 2, H * 0.09);
    c.fillStyle = "#d8283a"; c.font = "900 190px 'Arial Black', 'Segoe UI'"; c.fillText("15", W / 2, H * 0.49);
    c.fillStyle = INK; c.font = "800 34px 'Microsoft YaHei', 'Segoe UI'"; c.fillText("星期四", W / 2, H * 0.77);
    c.font = "700 24px 'Segoe UI'"; c.fillText("THURSDAY", W / 2, H * 0.87);
    c.fillStyle = "rgba(0,0,0,.08)"; for (let i = 0; i < 4; i++) c.fillRect(0, H - 3 - i * 4, W, 1);
  });
  calFace.position.z = 0.017; cal.add(calFace);
  const fu = new THREE.Group(); fu.position.set(0.02, 1.98, BACK_Z + 0.01); g.add(fu);
  const fuP = painted(0.3, 0.3, 256, 256, (c, W, H) => {
    c.fillStyle = "#d8283a"; c.fillRect(0, 0, W, H); c.strokeStyle = "#ffd94a"; c.lineWidth = 8; c.strokeRect(12, 12, W - 24, H - 24);
    c.fillStyle = "#ffd94a"; c.font = "900 170px 'Microsoft YaHei', 'SimHei', serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.save(); c.translate(W / 2, H / 2); c.rotate(Math.PI / 4); c.fillText("福", 0, 8); c.restore();
  });
  fuP.rotation.z = Math.PI / 4; fu.add(fuP);
  const shelf = new THREE.Group(); shelf.position.set(-1.3, 1.42, BACK_Z + 0.12); g.add(shelf);
  shelf.add(box(0.8, 0.03, 0.22, toon("#b8693c"), 0, 0, 0));
  for (const s of [-1, 1]) shelf.add(box(0.03, 0.12, 0.18, toon("#9b5530"), s * 0.3, -0.07, 0));
  const tin = (col, lid, x, h, r = 0.06) => { shelf.add(cyl(r, r, h, toon(col), x, 0.015 + h / 2, 0)); shelf.add(cyl(r + 0.004, r + 0.004, 0.02, toon(lid), x, 0.015 + h, 0)); };
  tin("#2f9e6a", "#ffd94a", -0.3, 0.16); tin("#e2433f", "#c9ced8", -0.14, 0.12, 0.08); tin("#ffd94a", "#e2433f", 0.03, 0.18, 0.055);
  shelf.add(rbox(0.16, 0.11, 0.1, 0.02, toon("#f4f6fb"), 0.22, 0.07, 0)); // a radio
  shelf.add(cyl(0.035, 0.035, 0.01, toon("#2a3550"), 0.18, 0.08, 0.051).rotateX(Math.PI / 2));
  shelf.add(box(0.005, 0.12, 0.005, toon("#c9ced8"), 0.28, 0.18, 0).rotateZ(-0.4));
  const photo = poster(0.36, 0.28, (c, W, H) => {
    c.fillStyle = "#9fdcff"; c.fillRect(0, 0, W, H); c.fillStyle = "#6fcf86"; c.fillRect(0, H * 0.75, W, H * 0.25);
    [[0.32, 1.0, true], [0.66, 0.85, false]].forEach(([x, s, beard]) => {
      const cx = W * x, by = H * 0.8;
      c.fillStyle = "#dfe5f3"; c.fillRect(cx - 24 * s, by - 40 * s, 48 * s, 40 * s);
      c.fillRect(cx - 32 * s, by - 92 * s, 64 * s, 52 * s); c.fillStyle = "#1a1030"; c.fillRect(cx - 25 * s, by - 84 * s, 50 * s, 28 * s);
      c.fillStyle = "#9b6bff"; c.fillRect(cx - 16 * s, by - 74 * s, 7 * s, 7 * s); c.fillStyle = "#2ff0b0"; c.fillRect(cx + 6 * s, by - 72 * s, 9 * s, 4 * s);
      c.fillStyle = "#dfe5f3"; c.beginPath(); c.moveTo(cx - 28 * s, by - 92 * s); c.lineTo(cx - 18 * s, by - 112 * s); c.lineTo(cx - 8 * s, by - 92 * s); c.fill();
      c.beginPath(); c.moveTo(cx + 28 * s, by - 92 * s); c.lineTo(cx + 18 * s, by - 112 * s); c.lineTo(cx + 8 * s, by - 92 * s); c.fill();
      if (beard) { c.fillStyle = "#fff"; c.beginPath(); c.ellipse(cx, by - 46 * s, 22 * s, 14 * s, 0, 0, 7); c.fill(); }
    });
    c.fillStyle = "#ff6fb0"; c.font = "900 28px 'Segoe UI'"; c.textAlign = "center"; c.fillText("♥", W * 0.49, H * 0.25);
  }, "#c77a4a");
  photo.position.set(-1.3, 1.92, BACK_Z + 0.02); photo.rotation.z = 0.03; g.add(photo);
  g.add(rbox(0.09, 0.12, 0.015, 0.01, toon("#fbf6ee"), 1.0, 1.25, BACK_Z + 0.01));
  g.add(box(0.025, 0.04, 0.01, toon("#c9ced8"), 1.0, 1.25, BACK_Z + 0.02));

  // the TV cabinet on the right, with the TV on, a money plant and a framed photo
  const cab = new THREE.Group(); cab.position.set(1.75, 0, BACK_Z + 0.3); g.add(cab);
  cab.add(rbox(1.4, 0.55, 0.45, 0.02, toon("#b8693c"), 0, 0.3, 0));
  for (const s of [-1, 1]) { cab.add(box(0.62, 0.38, 0.01, toon("#a8e6d4"), s * 0.33, 0.3, 0.228)); cab.add(ball(0.02, toon("#ffd94a"), s * 0.06, 0.3, 0.24)); }
  for (const s of [-1, 1]) cab.add(box(0.06, 0.05, 0.4, toon("#8a4a2a"), s * 0.62, 0.025, 0));
  const tv = new THREE.Group(); tv.position.set(-0.05, 0.575, -0.02); cab.add(tv);
  tv.add(box(0.3, 0.025, 0.18, toon("#2a2633"), 0, 0.0125, 0)); tv.add(box(0.06, 0.08, 0.04, toon("#2a2633"), 0, 0.06, 0));
  tv.add(rbox(0.92, 0.55, 0.05, 0.015, toon("#1f1b2a"), 0, 0.37, 0));
  const tvCv = document.createElement("canvas"); tvCv.width = 384; tvCv.height = 219;
  const tvTex = new THREE.CanvasTexture(tvCv); tvTex.colorSpace = THREE.SRGBColorSpace;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.49), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false, color: "#e6e0ea" }));
  /** the morning show: a weather lady bot by a bouncing sun, and a news ticker that scrolls (step = a twos clock) */
  U.setTV = (step) => {
    const c = tvCv.getContext("2d"), W = tvCv.width, H = tvCv.height;
    const gg = c.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, "#5cc7ff"); gg.addColorStop(1, "#bfefff"); c.fillStyle = gg; c.fillRect(0, 0, W, H);
    const bob = Math.abs(Math.sin(step * 0.42)) * 14;
    c.fillStyle = "#ffd94a"; c.beginPath(); c.arc(W * 0.74, H * 0.32 - bob, 30, 0, 7); c.fill();
    c.strokeStyle = "#ffd94a"; c.lineWidth = 5; for (let i = 0; i < 8; i++) { const a = i * 0.785 + step * 0.1; c.beginPath(); c.moveTo(W * 0.74 + Math.cos(a) * 38, H * 0.32 - bob + Math.sin(a) * 38); c.lineTo(W * 0.74 + Math.cos(a) * 50, H * 0.32 - bob + Math.sin(a) * 50); c.stroke(); }
    c.fillStyle = "#ffffff"; c.font = "900 30px 'Arial Black', 'Segoe UI'"; c.fillText("31°", W * 0.82, H * 0.66);
    c.fillStyle = "#6fcf86"; c.beginPath(); c.ellipse(W * 0.3, H * 1.0, W * 0.5, H * 0.35, 0, 0, 7); c.fill();
    const arm = step % 6 < 3 ? -0.6 : -1.1; // she points at the sun, on twos
    c.fillStyle = "#ff8a75"; c.fillRect(W * 0.22, H * 0.42, 46, 66); c.fillStyle = "#dfe5f3"; c.fillRect(W * 0.22 - 4, H * 0.42 - 44, 54, 44);
    c.fillStyle = "#1a1030"; c.fillRect(W * 0.22 + 2, H * 0.42 - 36, 42, 22); c.fillStyle = "#2ff0b0"; c.fillRect(W * 0.22 + 26, H * 0.42 - 29, 10, 5); c.fillStyle = "#9b6bff"; c.fillRect(W * 0.22 + 8, H * 0.42 - 31, 7, 7);
    c.save(); c.translate(W * 0.22 + 44, H * 0.42 + 10); c.rotate(arm); c.fillStyle = "#ff8a75"; c.fillRect(0, -6, 44, 12); c.restore();
    c.fillStyle = "#e2433f"; c.fillRect(0, H * 0.8, W, H * 0.2); c.fillStyle = "#ffd94a"; c.fillRect(0, H * 0.8, 70, H * 0.2);
    c.fillStyle = "#1a1030"; c.font = "900 18px 'Segoe UI'"; c.fillText("LIVE", 12, H * 0.92);
    c.fillStyle = "#ffffff"; c.font = "800 19px 'Segoe UI'"; c.save(); c.beginPath(); c.rect(74, H * 0.8, W - 74, H * 0.2); c.clip();
    const msg = "GOOD MORNING SINGAPORE  ·  SUNNY, 31°C  ·  HAZE: GOOD  ·  MRT RUNNING NORMALLY  ·  ";
    const x0 = 380 - ((step * 9) % 900); c.fillText(msg + msg, x0, H * 0.93); c.restore();
    tvTex.needsUpdate = true;
  };
  U.setTV(0);
  tvScreen.position.set(0, 0.37, 0.026); tv.add(tvScreen);
  const money = plant(0.9, "#3fae6b"); money.position.set(0.56, 0.575, 0.02); cab.add(money);
  for (let i = 0; i < 4; i++) cab.add(ball(0.035, toon(i % 2 ? "#5cc77f" : "#3fae6b"), 0.62 + i * 0.01, 0.52 - i * 0.07, 0.17));
  const fr = poster(0.18, 0.14, (c, W, H) => { c.fillStyle = "#ffd98a"; c.fillRect(0, 0, W, H); c.fillStyle = "#dfe5f3"; c.fillRect(W * 0.3, H * 0.3, W * 0.4, H * 0.5); c.fillStyle = "#1a1030"; c.fillRect(W * 0.35, H * 0.38, W * 0.3, H * 0.2); }, "#e2433f");
  fr.position.set(-0.56, 0.67, 0.05); fr.rotation.x = -0.12; fr.rotation.y = 0.2; cab.add(fr);
  cab.add(cyl(0.05, 0.035, 0.2, toon("#5cc7ff"), 0.35, 0.675, 0.05)); // a vase
  for (let i = 0; i < 3; i++) cab.add(ball(0.035, toon(["#ff6f91", "#ffe66d", "#ff9a2e"][i]), 0.35 + (i - 1) * 0.035, 0.8 + (i % 2) * 0.03, 0.05));

  // the right wall, with the door to the corridor and a key rack
  const rw = wall(6, 3.4, "#ffd89a", { band: "#3fb3a3" }); rw.rotation.y = -Math.PI / 2; rw.position.set(2.75, 1.7, 1.5); g.add(rw);
  const door = new THREE.Group(); door.position.set(2.74, 0, 0.9); door.rotation.y = -Math.PI / 2; g.add(door);
  door.add(box(1.0, 2.1, 0.06, toon("#fbf6ee"), 0, 1.05, 0.0));
  door.add(rbox(0.86, 2.0, 0.05, 0.01, toon("#c8743f"), 0, 1.0, 0.03));
  for (const y of [0.55, 1.45]) door.add(box(0.66, 0.6, 0.01, toon("#b8693c"), 0, y, 0.058));
  door.add(ball(0.035, toon("#ffd94a"), 0.33, 1.0, 0.07));
  door.add(box(0.36, 0.06, 0.04, toon("#9b5530"), -0.9, 1.5, 0.03));
  for (let i = 0; i < 3; i++) door.add(box(0.03, 0.08, 0.02, toon(["#ff6f91", "#5cc7ff", "#ffe66d"][i]), -1.0 + i * 0.1, 1.42, 0.06));
  // a cicak (house gecko) on the back wall; the chapter moves it
  const gecko = new THREE.Group(); g.add(gecko); U.gecko = gecko;
  const gk = toon("#9fb88a");
  const gb = ball(0.03, gk); gb.scale.set(1, 2.2, 0.5); gecko.add(gb);
  gecko.add(ball(0.024, gk, 0, 0.075, 0.002));
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.12, 8), gk); tail.position.set(0, -0.12, 0); tail.rotation.z = Math.PI; gecko.add(tail); gecko.userData.tail = tail;
  for (const [x, y, r] of [[-0.035, 0.035, 0.6], [0.035, 0.035, -0.6], [-0.035, -0.04, -0.6], [0.035, -0.04, 0.6]]) { const l = box(0.04, 0.008, 0.006, gk, x, y, 0); l.rotation.z = r; gecko.add(l); }
  for (const s2 of [-1, 1]) gecko.add(ball(0.006, toon("#1a1030"), s2 * 0.012, 0.085, 0.012));

  // the standing fan near the window, a big plant in the corner, a bin
  const fan = standingFan(); fan.position.set(-1.35, 0, -0.55); fan.rotation.y = 0.7; g.add(fan); U.fan = fan;
  const big = plant(2.0, "#2f9e5a"); big.position.set(-1.65, 0, -1.2); g.add(big);
  const bin = cyl(0.12, 0.1, 0.28, toon("#ff9fc4"), 1.05, 0.14, -1.25); g.add(bin);

  // light shafts from the window along the sun's direction (volumetric glow only; the shadows are real)
  U.shafts = [];
  const beam = SUN_DIR.clone();
  for (let i = 0; i < 4; i++) {
    const len = 2.6, sh = shaft(len, 0.3 + hash(i) * 0.25);
    const start = new THREE.Vector3(LEFT_X + 0.05, WIN_Y + 0.42 - i * 0.26, WIN_Z - 0.5 + i * 0.36);
    sh.position.copy(start).addScaledVector(beam, len / 2);
    const y = beam.clone().negate(), x = new THREE.Vector3().crossVectors(y, new THREE.Vector3(0, 0, 1)).normalize(), z = new THREE.Vector3().crossVectors(x, y);
    sh.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x, y, z)); g.add(sh); U.shafts.push(sh);
  }

  // shadows for the furniture and props (walls only receive)
  for (const o of [table, c1, c2, mon, cuff, tube, phone.g, cup, plate, thermos, bread, tissue, cab, fan, big, bin, shelf, clock, cal, door]) shadowy(o);
  back.receiveShadow = true; floor.receiveShadow = true;
  return g;
}
