// c12's sets: a corner of the Ripple lab with a table, and on the table an "infographic sandbox": a board-game diorama
// of how Ripple runs. Everything on the board is built in board units (the board is 8 x 5) and the whole board is then
// scaled down onto the table (BOARD.s), so the full-size trio can stand around it and the camera can dive into it.
// Board layout (x right, z toward the camera, y up):
//   his phone (-3, 1) and her phone (-3.4, -0.6)  ->  EdgeOne gate (-1.7, 0.4)  ->  server block with a little
//   lighthouse (0, 0.35)  ->  three towers behind: speech (-2, -1.8), DeepSeek (0.7, -1.85), Supabase (2.9, -1.2).
// D.reset() puts every moving part back to rest; a shot calls it, then sets what it needs (frames are pure in t).
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { box, rbox, cyl, ball, painted, shadowy } from "./kit.js";
import { makeBot } from "../bots.js";
import { hash, clamp, backOut, seg, lerp, wob, boil } from "../core.js";

/** where the board sits in the world: board point (x, y, z) -> world [O + p * s] */
export const BOARD = { x: 0, y: 0.65, z: 0, s: 0.28 };
export const W = (p) => [BOARD.x + p[0] * BOARD.s, BOARD.y + p[1] * BOARD.s, BOARD.z + p[2] * BOARD.s];

const INKC = "#1a1030";
const label = (txt, w, h, o = {}) => painted(w, h, o.px ?? 512, Math.round((o.px ?? 512) * h / w), (c, Wd, Hd) => {
  c.fillStyle = o.bg ?? "#1d1630"; c.fillRect(0, 0, Wd, Hd);
  if (o.border !== false) { c.strokeStyle = o.border ?? "#7dffcf"; c.lineWidth = Hd * 0.08; c.strokeRect(Hd * 0.06, Hd * 0.06, Wd - Hd * 0.12, Hd - Hd * 0.12); }
  c.fillStyle = o.fg ?? "#ffffff"; c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `${o.weight ?? 800} ${Math.round(Hd * (o.k ?? 0.56))}px ${o.font ?? '"Segoe UI", system-ui, sans-serif'}`;
  c.fillText(txt, Wd / 2, Hd * 0.54);
}, { unlit: true });

function tube(points, r, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, "catmullrom", 0.5);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, r, 10, false), mat);
  return { mesh: m, curve };
}

/** The lab corner: floor, three tiled walls with neon, a shelf, a wall screen, the table, a hanging lamp, a console. */
export function buildArchRoom() {
  const g = new THREE.Group();
  const floor = painted(16, 16, 512, 512, (c, Wd, Hd) => {
    c.fillStyle = "#2c1d5c"; c.fillRect(0, 0, Wd, Hd);
    c.strokeStyle = "rgba(120,90,220,.35)"; c.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, Hd); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(Wd, i * 64); c.stroke(); }
  }, { repeat: [4, 4] });
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  // a ring of yellow hazard dashes around the table, like the reference's lab floor
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2, d = box(0.32, 0.01, 0.1, flat("#ffc83a"), Math.cos(a) * 2.6, 0.006, Math.sin(a) * 2.1);
    d.rotation.y = -a + Math.PI / 2; g.add(d);
  }
  const tileWall = (w, h) => painted(w, h, 512, Math.round(512 * h / w), (c, Wd, Hd) => {
    c.fillStyle = "#3b2a86"; c.fillRect(0, 0, Wd, Hd);
    const n = Math.round(w / 0.5), s = Wd / n;
    for (let y = 0; y * s < Hd; y++) for (let x = 0; x < n; x++) {
      c.fillStyle = hash(x * 13 + y * 7) > 0.85 ? "#4a37a6" : "#43319a"; c.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
    }
  });
  const back = tileWall(12, 5); back.position.set(0, 2.5, -3.6); back.receiveShadow = true; g.add(back);
  for (const sx of [-1, 1]) { const side = tileWall(9, 5); side.position.set(sx * 5.2, 2.5, 0.4); side.rotation.y = -sx * Math.PI / 2; side.receiveShadow = true; g.add(side); }
  // neon strips on the three walls
  g.add(box(12, 0.06, 0.06, flat("#4ff3ff"), 0, 1.25, -3.55), box(12, 0.05, 0.05, flat("#ff4fd0"), 0, 3.3, -3.55));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.06, 9, flat("#4ff3ff"), sx * 5.15, 1.25, 0.4), box(0.05, 0.05, 9, flat("#ff4fd0"), sx * 5.15, 3.3, 0.4));
  // a shelf of flasks on the back wall, left
  g.add(box(2.2, 0.06, 0.35, toon("#5a46b8"), -2.6, 2.3, -3.4));
  const fl = ["#4ff3ff", "#ff4fd0", "#ffd94a", "#7dffb0", "#ff8a3d"];
  for (let i = 0; i < 6; i++) { const x = -3.5 + i * 0.36; g.add(cyl(0.05, 0.09, 0.22, flat(fl[i % 5]), x, 2.44, -3.4, 12), cyl(0.025, 0.025, 0.1, toon("#e8e2ff"), x, 2.6, -3.4, 8)); }
  // a wall screen with a calm waveform (no words), right
  g.add(rbox(2.0, 1.2, 0.1, 0.04, toon("#1d1630"), 2.4, 2.25, -3.52));
  const scr = painted(1.84, 1.04, 512, 290, (c, Wd, Hd) => {
    c.fillStyle = "#120d22"; c.fillRect(0, 0, Wd, Hd);
    c.strokeStyle = "rgba(79,243,255,.25)"; c.lineWidth = 2; for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, i * Hd / 6); c.lineTo(Wd, i * Hd / 6); c.stroke(); }
    c.strokeStyle = "#4ff3ff"; c.lineWidth = 6; c.beginPath();
    for (let x = 0; x <= Wd; x += 6) c.lineTo(x, Hd * 0.5 + Math.sin(x / 26) * Hd * 0.16 * Math.sin(x / 140 + 1));
    c.stroke();
    c.fillStyle = "#ff4fd0"; for (let i = 0; i < 9; i++) c.fillRect(30 + i * 52, Hd * 0.86 - hash(i) * Hd * 0.25, 30, hash(i) * Hd * 0.25);
  }, { unlit: true });
  scr.position.set(2.4, 2.25, -3.46); g.add(scr);
  // gauges on the left wall
  for (let i = 0; i < 2; i++) {
    const gz = -1.2 + i * 1.1;
    g.add(at2(cyl(0.32, 0.32, 0.08, toon("#e8e2ff"), -5.12, 1.9, gz, 24), 0, 0, Math.PI / 2));
    const dial = painted(0.5, 0.5, 128, 128, (c) => {
      c.fillStyle = "#1d1630"; c.beginPath(); c.arc(64, 64, 60, 0, 7); c.fill();
      c.lineWidth = 12; c.strokeStyle = "#ff4f6d"; c.beginPath(); c.arc(64, 70, 40, Math.PI, Math.PI * 1.35); c.stroke();
      c.strokeStyle = "#ffd94a"; c.beginPath(); c.arc(64, 70, 40, Math.PI * 1.35, Math.PI * 1.7); c.stroke();
      c.strokeStyle = "#2ff0b0"; c.beginPath(); c.arc(64, 70, 40, Math.PI * 1.7, Math.PI * 2); c.stroke();
      c.strokeStyle = "#fff"; c.lineWidth = 5; c.beginPath(); c.moveTo(64, 70); c.lineTo(64 + Math.cos(-0.5 - i) * 36, 70 + Math.sin(-0.5 - i) * 36); c.stroke();
    }, { unlit: true });
    dial.position.set(-5.07, 1.9, gz); dial.rotation.y = Math.PI / 2; g.add(dial);
  }
  // the table: a dark top with a yellow edge band, four legs
  const table = new THREE.Group();
  table.add(rbox(2.75, 0.1, 1.85, 0.03, toon("#2a2050"), 0, 0.5, 0));
  table.add(box(2.77, 0.03, 1.87, toon("#ffc83a"), 0, 0.455, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) table.add(box(0.1, 0.45, 0.1, toon("#1d1630"), sx * 1.25, 0.225, sz * 0.8));
  // a console with a big red button at the back edge, in front of Wei Ling
  table.add(rbox(0.36, 0.08, 0.2, 0.02, toon("#e8e2ff"), -0.75, 0.59, -0.8));
  const btn = cyl(0.06, 0.07, 0.05, toon("#ff4f6d"), -0.75, 0.65, -0.8, 16); table.add(btn);
  table.add(box(0.06, 0.03, 0.03, flat("#2ff0b0"), -0.63, 0.64, -0.74));
  g.add(table);
  // a hanging lamp over the table: the one warm light you can see
  const hang = [cyl(0.012, 0.012, 1.6, toon("#1d1630"), 0.9, 3.4, 0.2, 6), cyl(0.12, 0.36, 0.26, toon("#ff8a3d"), 0.9, 2.55, 0.2, 20), ball(0.11, flat("#fff2c2"), 0.9, 2.42, 0.2)];
  g.add(...hang);
  g.userData.button = btn;
  shadowy(g);
  for (const o of [...hang, back]) o.castShadow = false; // the lamp and the back wall never darken the table
  return g;
}
function at2(o, rx, ry, rz) { o.rotation.set(rx, ry, rz); return o; }

/** The diorama. Returns a group with userData D (the animation handles) and A (anchor points in board units). */
export function buildDiorama() {
  const g = new THREE.Group();
  const D = {}, A = {};
  g.userData.D = D; g.userData.A = A;
  const parts = []; // [group, delay] for the pop-up
  // each part sits in a wrapper at its own foot, so the pop-up grows it in place
  const part = (o, delay, xz = true) => {
    const p = new THREE.Group();
    if (xz) { p.position.set(o.position.x, 0, o.position.z); o.position.x = 0; o.position.z = 0; }
    p.add(o); g.add(p); parts.push([p, delay, xz]); return p;
  };

  // the board: a thick slab with a pale grid top, a dark rim and a yellow band, like a board game on the table
  const slab = new THREE.Group();
  slab.add(rbox(8.4, 0.35, 5.4, 0.08, toon("#3a2a7a"), 0, -0.175, 0));
  slab.add(box(8.42, 0.07, 5.42, toon("#ffc83a"), 0, -0.22, 0));
  const top = painted(8.0, 5.0, 1024, 640, (c, Wd, Hd) => {
    c.fillStyle = "#efe8ff"; c.fillRect(0, 0, Wd, Hd);
    c.strokeStyle = "rgba(120,100,200,.22)"; c.lineWidth = 2;
    for (let i = 0; i <= 32; i++) { c.beginPath(); c.moveTo(i * Wd / 32, 0); c.lineTo(i * Wd / 32, Hd); c.stroke(); }
    for (let i = 0; i <= 20; i++) { c.beginPath(); c.moveTo(0, i * Hd / 20); c.lineTo(Wd, i * Hd / 20); c.stroke(); }
    c.strokeStyle = "rgba(120,100,200,.5)"; c.lineWidth = 6; c.strokeRect(10, 10, Wd - 20, Hd - 20);
    // soft pads under each block
    const pad = (x, z, w, d, col) => { c.fillStyle = col; c.beginPath(); c.roundRect((x + 4 - w / 2) * Wd / 8, (z + 2.5 - d / 2) * Hd / 5, w * Wd / 8, d * Hd / 5, 18); c.fill(); };
    pad(-3.1, 0.2, 1.6, 3.4, "rgba(255,111,176,.16)"); pad(-1.6, 0.35, 1.2, 1.4, "rgba(57,211,255,.18)"); pad(0, 0.3, 2.2, 1.8, "rgba(155,107,255,.18)");
    pad(-1.7, -1.5, 1.4, 1.4, "rgba(57,140,255,.16)"); pad(0.45, -1.65, 1.6, 1.4, "rgba(77,107,254,.16)"); pad(2.45, -1.45, 1.8, 1.6, "rgba(62,207,142,.18)");
  });
  top.rotation.x = -Math.PI / 2; top.position.y = 0.002; top.receiveShadow = true; slab.add(top);
  g.add(slab);

  // ---- his phone and her phone: tall slabs on little stands, screens painted from the real app frames ----
  function bigPhone(w, h, tilt) {
    const ph = new THREE.Group();
    ph.add(rbox(w + 0.08, h + 0.08, 0.1, 0.06, toon("#1b1825"), 0, 0, 0));
    const cv = document.createElement("canvas"); cv.width = 293; cv.height = 634;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: "#b9b6cc", toneMapped: false }));
    scr.position.z = 0.052; ph.add(scr);
    ph.rotation.x = -tilt;
    const stand = new THREE.Group();
    stand.add(rbox(w * 0.9, 0.08, 0.5, 0.03, toon("#5a46b8"), 0, 0.04, -0.05));
    stand.add(box(w * 0.5, 0.35, 0.06, toon("#5a46b8"), 0, 0.2, -0.22));
    ph.position.set(0, h / 2 + 0.1, 0);
    stand.add(ph);
    let last = null;
    const set = (img, fill = "#f3f0ff") => {
      if (img === last && img) return; last = img;
      const x = cv.getContext("2d");
      if (img) x.drawImage(img, 0, 0, cv.width, cv.height); else { x.fillStyle = fill; x.fillRect(0, 0, cv.width, cv.height); }
      tex.needsUpdate = true;
    };
    set(null);
    return { g: stand, set, screen: scr };
  }
  const his = bigPhone(0.62, 1.34, 0.12); his.g.position.set(-3.0, 0, 1.0); his.g.rotation.y = 0.45; part(his.g, 0.0);
  const hers = bigPhone(0.42, 0.91, 0.1); hers.g.position.set(-3.4, 0, -0.6); hers.g.rotation.y = 0.5; part(hers.g, 0.1);
  D.hisScreen = his.set; D.herScreen = hers.set;
  A.his = [-3.04, 1.49, 0.92]; A.hers = [-3.4, 1.05, -0.6]; // on the top bezel of the (tilted) phone, not in the air above it

  // ---- pipes (board units); packets slide along them like beads on a wire ----
  const pipeMat = toon("#9fe8ff"), pipeMat2 = toon("#c9b8ff");
  const P = {};
  const addPipe = (name, pts, r = 0.05, mat = pipeMat, delay = 0.5) => { const t = tube(pts, r, mat); P[name] = t.curve; part(t.mesh, delay, false); return t; };
  addPipe("his", [[-2.7, 0.32, 1.12], [-2.3, 0.3, 0.72], [-2.0, 0.33, 0.47], [-1.7, 0.36, 0.4], [-1.25, 0.38, 0.38], [-0.82, 0.4, 0.38]]);
  addPipe("hers", [[-3.15, 0.3, -0.45], [-2.65, 0.3, 0.0], [-2.2, 0.33, 0.33], [-1.7, 0.36, 0.4]]);
  // server -> towers (out of the server's back, arching)
  addPipe("asr", [[-0.5, 0.75, -0.25], [-1.0, 1.08, -0.8], [-1.6, 0.98, -1.32], [-1.82, 0.75, -1.46]], 0.05, pipeMat2, 0.6);
  addPipe("ans", [[0.1, 0.9, -0.25], [0.15, 1.05, -0.75], [0.2, 0.5, -1.28], [0.25, 0.3, -1.39]], 0.05, pipeMat2, 0.62);
  addPipe("db", [[0.82, 0.3, 0.6], [1.6, 0.3, 0.42], [2.2, 0.32, -0.2], [2.5, 0.35, -0.82]], 0.05, pipeMat2, 0.64);
  // the checked sentence leaves the CHECK floor on its right side and comes back to the server (through the barrier)
  addPipe("out", [[1.34, 1.42, -1.82], [1.95, 1.3, -1.4], [2.0, 0.9, -0.75], [1.55, 0.72, -0.1], [0.82, 0.72, 0.2]], 0.045, toon("#ffe7a8"), 0.66);
  // the lift between the two DeepSeek floors (outside the tower, right side)
  addPipe("lift", [[1.33, 0.4, -1.85], [1.35, 0.95, -1.85], [1.34, 1.42, -1.83]], 0.04, toon("#ffe7a8"), 0.66);
  D.curves = P;
  // flanges where pipes meet blocks
  const flange = (p, rot = [0, 0, 0]) => { const f = cyl(0.09, 0.09, 0.08, toon("#5a46b8"), ...p, 14); f.rotation.set(...rot); part(f, 0.55); };
  flange([-0.82, 0.4, 0.38], [0, 0, Math.PI / 2]); flange([-1.82, 0.75, -1.46], [Math.PI / 2, 0, 0]); flange([0.25, 0.3, -1.39], [Math.PI / 2, 0, 0]);
  flange([2.5, 0.35, -0.82], [Math.PI / 2, 0, 0]); flange([0.82, 0.72, 0.2], [0, 0, Math.PI / 2]); flange([0.82, 0.3, 0.6], [0, 0, Math.PI / 2]);

  // ---- the EdgeOne gate: a chunky portal around the pipe, laser bars inside that flash when a packet passes ----
  const gate = new THREE.Group();
  const gm = toon("#2f9bff"), gd = toon("#1d3f8f");
  gate.add(rbox(0.2, 1.05, 0.24, 0.04, gm, 0, 0.53, -0.5), rbox(0.2, 1.05, 0.24, 0.04, gm, 0, 0.53, 0.5));
  gate.add(rbox(0.26, 0.24, 1.26, 0.05, gm, 0, 1.12, 0));
  gate.add(box(0.34, 0.08, 0.4, gd, 0, 0.04, -0.5), box(0.34, 0.08, 0.4, gd, 0, 0.04, 0.5));
  const bars = [];
  for (let i = 0; i < 4; i++) { const b = box(0.03, 0.025, 0.8, flat("#4ff3ff"), 0, 0.22 + i * 0.22, 0); gate.add(b); bars.push(b); }
  const gsign = label("EdgeOne", 1.0, 0.3, { bg: "#0f2a66", border: "#4ff3ff" });
  gsign.position.set(0.0, 1.43, 0.0); gate.add(gsign);
  gate.add(box(0.06, 0.12, 0.06, gd, 0, 1.28, 0));
  // a shield emblem with a padlock on the gate's beam
  const shield = painted(0.3, 0.34, 128, 146, (c, Wd, Hd) => {
    c.fillStyle = "#ffffff"; c.beginPath(); c.moveTo(Wd / 2, 4); c.lineTo(Wd - 6, 22); c.lineTo(Wd - 10, Hd * 0.6); c.lineTo(Wd / 2, Hd - 4); c.lineTo(10, Hd * 0.6); c.lineTo(6, 22); c.closePath(); c.fill();
    c.lineWidth = 8; c.strokeStyle = INKC; c.stroke();
    c.fillStyle = "#2f9bff"; c.fillRect(Wd * 0.32, Hd * 0.42, Wd * 0.36, Hd * 0.3);
    c.lineWidth = 9; c.strokeStyle = "#2f9bff"; c.beginPath(); c.arc(Wd / 2, Hd * 0.42, Wd * 0.13, Math.PI, 0); c.stroke();
  }, { unlit: true });
  gate.position.set(-1.7, 0, 0.4); gate.rotation.y = -0.12;
  part(gate, 0.2);
  gsign.rotation.y = 0.12; // face the board's front
  shield.position.set(0.14, 1.12, 0.0); shield.rotation.y = Math.PI / 2; gate.add(shield);
  D.gateBars = bars; A.gate = [-1.7, 1.55, 0.4];

  // ---- the server block (Lighthouse) with a little lighthouse on its roof and "Next.js" on its front ----
  const srv = new THREE.Group();
  srv.add(rbox(1.6, 1.0, 1.2, 0.1, toon("#4b3a9a"), 0, 0.5, 0));
  srv.add(rbox(1.66, 0.12, 1.26, 0.05, toon("#2a2050"), 0, 1.0, 0));
  const rack = painted(1.4, 0.78, 512, 285, (c, Wd, Hd) => {
    c.fillStyle = "#2a2050"; c.fillRect(0, 0, Wd, Hd);
    for (let r = 0; r < 4; r++) {
      const y = 14 + r * 46; c.fillStyle = "#3d2f7d"; c.fillRect(14, y, Wd - 28, 36);
      for (let k = 0; k < 14; k++) { c.fillStyle = "#1d1630"; c.fillRect(30 + k * 22, y + 10, 12, 16); }
    }
    c.fillStyle = "#000000"; c.beginPath(); c.roundRect(Wd * 0.56, Hd * 0.72, Wd * 0.4, Hd * 0.23, 10); c.fill();
    c.strokeStyle = "#ffffff"; c.lineWidth = 3; c.stroke();
    c.fillStyle = "#ffffff"; c.font = `800 ${Math.round(Hd * 0.15)}px "Segoe UI", system-ui`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("Next.js", Wd * 0.76, Hd * 0.84);
  }, { unlit: false });
  rack.position.set(0, 0.48, 0.602); srv.add(rack);
  const leds = [];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
    const l = box(0.05, 0.035, 0.02, flat("#2ff0b0"), 0.42 + k * 0.08, 0.83 - r * 0.126 + 0.003, 0.612); srv.add(l); leds.push(l);
  }
  // a "LIVE" lamp on the left of the front
  const live = new THREE.Group();
  const liveDot = cyl(0.05, 0.05, 0.02, flat("#ff4f6d"), 0, 0, 0, 16); liveDot.rotation.x = Math.PI / 2; live.add(liveDot);
  const liveTxt = label("LIVE", 0.26, 0.11, { bg: "#2a2050", border: false, fg: "#ffd2dc", k: 0.8 }); liveTxt.position.set(0.19, 0, 0); live.add(liveTxt);
  live.position.set(-0.6, 0.12, 0.612); srv.add(live);
  // the lighthouse
  const lh = new THREE.Group(); lh.position.set(-0.5, 1.06, 0.15); lh.scale.setScalar(0.8);
  const stripes = canvasTex(64, 128, (c, Wd, Hd) => { for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? "#ffffff" : "#ff4f6d"; c.fillRect(0, i * Hd / 4, Wd, Hd / 4); } });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.62, 18), toon("#ffffff", { map: stripes })); tower.position.y = 0.31; lh.add(tower);
  lh.add(cyl(0.2, 0.2, 0.04, toon("#2a2050"), 0, 0.64, 0, 18));
  const lantern = cyl(0.1, 0.1, 0.14, flat("#fff2a8"), 0, 0.73, 0, 16); lh.add(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.14, 18), toon("#ff4f6d")); cap.position.y = 0.87; lh.add(cap);
  const beam = new THREE.Group(); beam.position.y = 0.73; lh.add(beam);
  for (const s of [-1, 1]) {
    // apex at the lantern, the wide end outward
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#c9b46a", side: THREE.DoubleSide, toneMapped: false }));
    cone.rotation.z = s * Math.PI / 2; cone.position.x = s * 0.275; beam.add(cone);
  }
  srv.add(lh);
  srv.position.set(0, 0, 0.35);
  part(srv, 0.15);
  D.leds = leds; D.beam = beam; D.liveDot = liveDot;
  A.server = [0.0, 1.05, 0.35]; A.serverRoof = [0.3, 1.06, 0.45]; A.lighthouse = [-0.5, 1.8, 0.5];

  // ---- the speech tower: a tall blue column with a big microphone on top and sound rings ----
  const sp = new THREE.Group();
  sp.add(rbox(1.0, 0.22, 1.0, 0.06, toon("#1d3f8f"), 0, 0.11, 0));
  sp.add(cyl(0.3, 0.36, 1.3, toon("#3c78ff"), 0, 0.85, 0, 22));
  sp.add(cyl(0.38, 0.38, 0.08, toon("#1d3f8f"), 0, 1.5, 0, 22));
  sp.add(cyl(0.05, 0.05, 0.3, toon("#c9ced8"), 0, 1.68, 0, 10));
  const grille = canvasTex(128, 128, (c, Wd, Hd) => { c.fillStyle = "#3a3f52"; c.fillRect(0, 0, Wd, Hd); c.fillStyle = "#1c1f2b"; for (let y = 4; y < Hd; y += 12) for (let x = 4 + (y % 24 ? 6 : 0); x < Wd; x += 12) { c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); } });
  const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.3, 6, 18), toon("#ffffff", { map: grille })); mic.position.y = 2.1; sp.add(mic);
  const micRing = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 26), toon("#c9ced8")); micRing.position.y = 1.92; micRing.rotation.x = Math.PI / 2; sp.add(micRing);
  const rings = [];
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 6, 40), flat("#4ff3ff")); r.position.y = 2.1; r.rotation.x = Math.PI / 2; sp.add(r); rings.push(r); }
  const plate = label("16k_zh_en", 0.62, 0.17, { bg: "#0f1a3a", border: "#4ff3ff", fg: "#7dffcf", font: 'Consolas, "Courier New", monospace', k: 0.6, weight: 700 });
  plate.position.set(0, 0.95, 0.335); sp.add(plate);
  // a little painted waveform band on the column
  const wave = painted(0.5, 0.18, 256, 92, (c, Wd, Hd) => { c.fillStyle = "#0f1a3a"; c.fillRect(0, 0, Wd, Hd); c.fillStyle = "#4ff3ff"; for (let i = 0; i < 22; i++) { const h = (0.2 + hash(i * 3) * 0.75) * Hd; c.fillRect(8 + i * 11, (Hd - h) / 2, 6, h); } }, { unlit: true });
  wave.position.set(0, 0.65, 0.345); sp.add(wave);
  sp.position.set(-2.0, 0, -1.8);
  part(sp, 0.3);
  D.micRings = rings; D.mic = mic;
  A.speech = [-2.0, 2.35, -1.8];

  // ---- the DeepSeek tower: ANSWER floor below, CHECK floor above with a big lamp; a barrier on the way out ----
  const ds = new THREE.Group();
  ds.add(rbox(1.15, 0.85, 0.95, 0.08, toon("#4d6bfe"), 0, 0.425, 0));
  ds.add(rbox(1.22, 0.08, 1.02, 0.03, toon("#2a2f8f"), 0, 0.88, 0));
  ds.add(rbox(1.05, 0.72, 0.9, 0.08, toon("#7a5cff"), 0, 1.28, 0));
  ds.add(rbox(1.12, 0.07, 0.97, 0.03, toon("#2a2f8f"), 0, 1.66, 0));
  const ansWin = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), flat("#3a4fb0")); ansWin.position.set(0, 0.5, 0.478); ds.add(ansWin);
  const ansTxt = label("ANSWER", 0.7, 0.17, { bg: "#1d1f5a", border: false, fg: "#ffffff", k: 0.7 }); ansTxt.position.set(0, 0.25, 0.479); ds.add(ansTxt);
  // text lines in the answer window
  const ansLines = [];
  for (let i = 0; i < 3; i++) { const l = box(0.5 - i * 0.1, 0.035, 0.01, flat("#ffffff"), -0.1 + i * 0.05, 0.58 - i * 0.07, 0.482); ds.add(l); ansLines.push(l); }
  const lampTex = {};
  const lampDraw = (col, glyph) => canvasTex(160, 160, (c, Wd, Hd) => {
    c.fillStyle = col; c.beginPath(); c.arc(80, 80, 76, 0, 7); c.fill();
    c.lineWidth = 8; c.strokeStyle = INKC; c.stroke();
    if (glyph === "ok") { c.strokeStyle = "#ffffff"; c.lineWidth = 18; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath(); c.moveTo(42, 84); c.lineTo(70, 110); c.lineTo(118, 52); c.stroke(); }
    if (glyph === "no") { c.strokeStyle = "#ffffff"; c.lineWidth = 18; c.lineCap = "round"; c.beginPath(); c.moveTo(50, 50); c.lineTo(110, 110); c.moveTo(110, 50); c.lineTo(50, 110); c.stroke(); }
    if (glyph === "q") { c.fillStyle = "#1a1030"; c.font = `900 110px "Arial Black", system-ui`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", 80, 88); }
  });
  lampTex.off = lampDraw("#3b3560", ""); lampTex.ok = lampDraw("#2ff0b0", "ok"); lampTex.no = lampDraw("#ff4f6d", "no"); lampTex.q = lampDraw("#ffd94a", "q");
  const lampMat = new THREE.MeshBasicMaterial({ map: lampTex.off, toneMapped: false, transparent: true });
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), lampMat); lamp.position.set(-0.15, 1.33, 0.475); ds.add(lamp);
  const lampRim = cyl(0.25, 0.25, 0.04, toon("#2a2f8f"), -0.15, 1.33, 0.44, 28); lampRim.rotation.x = Math.PI / 2; ds.add(lampRim);
  const chkTxt = label("CHECK", 0.36, 0.14, { bg: "#2a1f6a", border: false, fg: "#ffffff", k: 0.72 }); chkTxt.position.set(0.3, 1.33, 0.456); ds.add(chkTxt);
  ds.position.set(0.7, 0, -1.85);
  part(ds, 0.35);
  D.lampMat = lampMat; D.lampTex = lampTex; D.ansWin = ansWin; D.ansLines = ansLines;
  A.deepseek = [0.7, 1.75, -1.85]; A.check = [0.55, 1.33, -1.39];
  // the barrier: a post at the start of the "out" pipe and a striped arm that lifts
  const bar = new THREE.Group(); bar.position.set(2.15, 0, -1.25);
  bar.add(rbox(0.12, 1.5, 0.12, 0.03, toon("#ffd94a"), 0, 0.75, 0));
  bar.add(rbox(0.3, 0.08, 0.3, 0.02, toon("#2a2050"), 0, 0.04, 0));
  const armPivot = new THREE.Group(); armPivot.position.set(0, 1.44, 0.08); bar.add(armPivot);
  const stripe = canvasTex(256, 32, (c, Wd, Hd) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#ffffff" : "#ff4f6d"; c.fillRect(i * Wd / 8, 0, Wd / 8, Hd); } });
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.07), toon("#ffffff", { map: stripe })); arm.position.x = -0.3; armPivot.add(arm);
  armPivot.add(ball(0.06, toon("#2a2050"), 0, 0, 0));
  part(bar, 0.4);
  D.barrier = armPivot;
  A.barrier = [1.95, 1.44, -1.17];

  // ---- the Supabase tower: three database discs, storage crates, a live-sync antenna ----
  const sb = new THREE.Group();
  const discs = [];
  for (let i = 0; i < 3; i++) {
    const y = 0.17 + i * 0.36;
    sb.add(cyl(0.5, 0.5, 0.3, toon("#3ecf8e"), 0, y, 0, 28));
    sb.add(cyl(0.505, 0.505, 0.05, toon("#1f7a55"), 0, y + 0.155, 0, 28));
    const led = box(0.3, 0.05, 0.02, flat("#d9fff0"), 0, y, 0.5); sb.add(led); discs.push(led);
  }
  sb.add(cyl(0.025, 0.025, 0.6, toon("#c9ced8"), 0, 1.4, 0, 8));
  sb.add(ball(0.06, flat("#7dffb0"), 0, 1.72, 0));
  const syncRings = [];
  for (let i = 0; i < 2; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 6, 32), flat("#7dffb0")); r.position.y = 1.72; r.rotation.x = Math.PI / 2; sb.add(r); syncRings.push(r); }
  // two storage crates with padlocks (private buckets)
  for (const [x, z, s] of [[0.85, 0.35, 1], [0.8, -0.3, 0.85]]) {
    sb.add(rbox(0.42 * s, 0.36 * s, 0.42 * s, 0.03, toon("#ffb347"), x, 0.18 * s, z));
    sb.add(box(0.44 * s, 0.05, 0.44 * s, toon("#c77a1f"), x, 0.3 * s, z));
    const lock = painted(0.14 * s, 0.16 * s, 64, 74, (c, Wd, Hd) => { c.fillStyle = "#1d1630"; c.fillRect(Wd * 0.18, Hd * 0.45, Wd * 0.64, Hd * 0.5); c.lineWidth = 8; c.strokeStyle = "#1d1630"; c.beginPath(); c.arc(Wd / 2, Hd * 0.45, Wd * 0.2, Math.PI, 0); c.stroke(); }, { transparent: true });
    lock.position.set(x, 0.17 * s, z + 0.212 * s); sb.add(lock);
  }
  sb.position.set(2.9, 0, -1.2);
  part(sb, 0.45);
  D.dbLeds = discs; D.syncRings = syncRings;
  A.supabase = [2.9, 1.85, -1.2];

  // ---- decorations: lollipop trees, a bench, little clouds over the towers ----
  const tree = (x, z, s = 1) => { const t = new THREE.Group(); t.add(cyl(0.04 * s, 0.05 * s, 0.3 * s, toon("#8a5a3a"), 0, 0.15 * s, 0, 8)); t.add(ball(0.2 * s, toon(hash(x * 9) > 0.5 ? "#5cc77f" : "#3fae6b"), 0, 0.4 * s, 0)); t.position.set(x, 0, z); part(t, 0.5 + hash(x + z) * 0.2); };
  tree(3.6, 2.1); tree(3.2, 2.25, 0.8); tree(-3.7, 2.2, 0.9); tree(3.7, -2.25, 1.1); tree(-3.6, -2.0); tree(1.6, 1.9, 0.7); tree(-0.8, -2.25, 0.8); tree(-1.0, 1.9, 0.75);
  const clouds = new THREE.Group();
  for (const [x, y, z, s] of [[-0.6, 2.9, -2.2, 1], [1.7, 3.1, -2.1, 0.8], [3.3, 2.7, -1.9, 0.7]]) {
    const cl = new THREE.Group(); [[0, 0, 0, 0.26], [0.26, -0.04, 0.02, 0.2], [-0.25, -0.05, 0, 0.19], [0.1, 0.12, -0.02, 0.18]].forEach(([a, b, c, r]) => cl.add(ball(r * s, toon("#ffffff"), a * s, b * s, c * s)));
    cl.position.set(x, y, z); clouds.add(cl);
  }
  const cloudWrap = part(clouds, 0.7, false); clouds.visible = false;
  D.clouds = clouds;

  // ---- packets: glowing beads; one big "rider" packet that mini Mr Tan sits on; sentence cards ----
  const packets = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: "#ffe37a", toneMapped: false }));
    m.visible = false; g.add(m); packets.push(m);
  }
  const rider = new THREE.Group();
  rider.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshBasicMaterial({ color: "#ffe37a", toneMapped: false })));
  const rring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 30), toon("#ff6fb0")); rring.rotation.x = Math.PI / 2; rider.add(rring);
  rider.visible = false; g.add(rider);
  const cards = [];
  const cardTex = canvasTex(128, 96, (c, Wd, Hd) => {
    c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(4, 4, Wd - 8, Hd - 22, 16); c.fill();
    c.beginPath(); c.moveTo(26, Hd - 20); c.lineTo(20, Hd - 4); c.lineTo(44, Hd - 20); c.fill();
    c.lineWidth = 6; c.strokeStyle = INKC; c.beginPath(); c.roundRect(4, 4, Wd - 8, Hd - 22, 16); c.stroke();
    c.fillStyle = "#4a3f66"; for (let i = 0; i < 3; i++) c.fillRect(20, 18 + i * 16, 88 - i * 18, 8);
  });
  for (let i = 0; i < 4; i++) {
    const cg = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.255), new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
    cg.add(face); cg.visible = false; g.add(cg); cards.push(cg);
  }
  // the three sources (card 2): a doctor's speech bubble with a play button, a labelled medicine box, a leaflet
  const src = [];
  const bubbleTex = canvasTex(192, 150, (c, Wd, Hd) => {
    c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(6, 6, Wd - 12, Hd - 40, 26); c.fill();
    c.beginPath(); c.moveTo(40, Hd - 36); c.lineTo(28, Hd - 6); c.lineTo(72, Hd - 36); c.fill();
    c.lineWidth = 8; c.strokeStyle = INKC; c.beginPath(); c.roundRect(6, 6, Wd - 12, Hd - 40, 26); c.stroke();
    c.fillStyle = "#7a4dff"; c.beginPath(); c.arc(50, 60, 26, 0, 7); c.fill();
    c.fillStyle = "#ffffff"; c.beginPath(); c.moveTo(42, 46); c.lineTo(64, 60); c.lineTo(42, 74); c.fill();
    c.fillStyle = "#7a4dff"; for (let i = 0; i < 9; i++) { const h = 10 + hash(i * 5) * 40; c.fillRect(90 + i * 9, 60 - h / 2, 5, h); }
  });
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.39), new THREE.MeshBasicMaterial({ map: bubbleTex, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
  const s1g = new THREE.Group(); s1g.add(s1);
  const s2g = new THREE.Group();
  s2g.add(box(0.42, 0.26, 0.16, toon("#ffffff"), 0, 0, 0));
  const lab2 = painted(0.38, 0.22, 192, 112, (c, Wd, Hd) => { c.fillStyle = "#ffffff"; c.fillRect(0, 0, Wd, Hd); c.fillStyle = "#2a1f4a"; for (let i = 0; i < 3; i++) c.fillRect(14, 16 + i * 20, 150 - i * 30, 10); c.fillStyle = "#e2433f"; c.fillRect(0, Hd * 0.78, Wd, Hd * 0.14); });
  lab2.position.z = 0.081; s2g.add(lab2);
  const s3g = new THREE.Group();
  const leaf = painted(0.34, 0.44, 128, 166, (c, Wd, Hd) => { c.fillStyle = "#fffdf4"; c.fillRect(0, 0, Wd, Hd); c.fillStyle = "#3ecf8e"; c.fillRect(0, 0, Wd, 22); c.fillStyle = "#4a3f66"; for (let i = 0; i < 7; i++) c.fillRect(12, 36 + i * 17, 100 - (i % 3) * 18, 7); c.lineWidth = 6; c.strokeStyle = INKC; c.strokeRect(3, 3, Wd - 6, Hd - 6); }, { unlit: true });
  leaf.material.side = THREE.DoubleSide; s3g.add(leaf);
  const leaf2 = painted(0.34, 0.44, 64, 83, (c, Wd, Hd) => { c.fillStyle = "#f1ead6"; c.fillRect(0, 0, Wd, Hd); }, { unlit: true }); leaf2.position.set(0.04, -0.03, -0.01); s3g.add(leaf2);
  for (const sg of [s1g, s2g, s3g]) { sg.visible = false; g.add(sg); src.push(sg); }
  // number tags over the sources
  const tags = [1, 2, 3].map((n) => { const t = painted(0.2, 0.2, 96, 96, (c) => { c.fillStyle = "#ffd94a"; c.beginPath(); c.arc(48, 48, 44, 0, 7); c.fill(); c.lineWidth = 7; c.strokeStyle = INKC; c.stroke(); c.fillStyle = INKC; c.font = `900 60px "Arial Black", system-ui`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n), 48, 52); }, { unlit: true, transparent: true }); t.visible = false; g.add(t); return t; });
  D.packets = packets; D.rider = rider; D.cards = cards; D.sources = src; D.tags = tags;

  // ---- mini mascots (board scale): Mr Tan who rides the first packet, and three tower workers ----
  const mini = (o) => { const b = makeBot(o); b.g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); g.add(b.g); return b; };
  D.miniTan = mini({ beard: true, scale: 0.34 });
  D.wSpeech = mini({ body: "#a9d8ff", scale: 0.27 });
  D.wCheck = mini({ body: "#ffc2e0", scale: 0.27 });
  D.wDb = mini({ body: "#b8f5d6", scale: 0.27 });
  // the checker holds a magnifier; the database worker carries a crate
  const mag = new THREE.Group();
  mag.add(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 24), toon("#2a2050")));
  mag.add(new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshBasicMaterial({ color: "#bff3ff", transparent: true, opacity: 0.55 })));
  const handle = box(0.035, 0.16, 0.035, toon("#ff8a3d"), 0, -0.18, 0); mag.add(handle);
  mag.position.set(0, -0.2, 0.08); mag.rotation.x = -1.2; D.wCheck.hands[1].add(mag);
  const crate = rbox(0.22, 0.18, 0.2, 0.02, toon("#ffb347"), 0, -0.05, 0.16); D.wDb.hands[0].add(crate);

  shadowy(g);
  D.parts = parts;
  D.reset = () => {
    for (const [p] of parts) { p.scale.set(1, 1, 1); p.visible = p !== cloudWrap; }
    packets.forEach((m) => { m.visible = false; m.scale.setScalar(1); m.material.color.set("#ffe37a"); });
    rider.visible = false; cards.forEach((c) => { c.visible = false; c.scale.setScalar(1); c.rotation.set(0, 0, 0); });
    src.forEach((s) => { s.visible = false; s.scale.setScalar(1); s.rotation.set(0, 0, 0); }); tags.forEach((t) => (t.visible = false));
    bars.forEach((b) => b.material.color.set("#2a8fa6"));
    leds.forEach((l, i) => l.material.color.set(i % 3 === 1 ? "#ffd94a" : "#2ff0b0"));
    beam.rotation.y = 0; beam.visible = true;
    liveDot.material.color.set("#ff4f6d");
    rings.forEach((r) => { r.visible = false; r.scale.setScalar(1); });
    syncRings.forEach((r) => { r.visible = false; r.scale.setScalar(1); });
    mic.material.emissive?.set?.("#000000");
    lampMat.map = lampTex.off;
    ansWin.material.color.set("#3a4fb0"); ansLines.forEach((l) => (l.visible = true));
    armPivot.rotation.z = 0;
    discs.forEach((d) => d.material.color.set("#d9fff0"));
    clouds.position.y = 0;
    for (const b of [D.miniTan, D.wSpeech, D.wCheck, D.wDb]) { b.g.visible = false; b.g.rotation.set(0, 0, 0); }
  };
  /** the pop-up: every block rises out of the board, staggered; p = seconds since the button press */
  D.rise = (p) => {
    for (const [o, d, xz] of parts) {
      const k = seg(p, d, d + 0.45);
      o.visible = k > 0 && o !== cloudWrap;
      const s = Math.max(0.001, backOut(k, 2.0)), w = xz ? lerp(0.6, 1, k) : 1; o.scale.set(w, s, w);
    }
  };
  /** put packet i on curve name at u (0..1); returns the point */
  const tmp = new THREE.Vector3();
  D.packet = (i, name, u, o = {}) => {
    const m = packets[i]; const c = P[name]; if (!c || u < 0 || u > 1) { m.visible = false; return null; }
    c.getPointAt(clamp(u), tmp); m.position.copy(tmp); m.visible = true;
    if (o.col) m.material.color.set(o.col);
    m.scale.setScalar(o.s ?? 1);
    return tmp.clone();
  };
  D.at = (name, u) => P[name].getPointAt(clamp(u), new THREE.Vector3());
  D.dir = (name, u) => P[name].getTangentAt(clamp(u), new THREE.Vector3());
  /** the boring bits that move all the time: LEDs blink, beam turns, clouds bob, live dot blinks */
  D.idle = (t) => {
    const b = boil(t);
    leds.forEach((l, i) => l.material.color.set(hash(i * 7 + Math.floor(b / 2)) > 0.35 ? (i % 3 === 1 ? "#ffd94a" : "#2ff0b0") : "#24524a"));
    beam.rotation.y = t * 1.6;
    clouds.position.y = Math.sin(t * 0.9) * 0.06;
    liveDot.material.color.set(Math.floor(t * 2) % 2 ? "#ff4f6d" : "#7a2a3a");
  };
  D.scan = (k) => bars.forEach((b, i) => b.material.color.set(k > 0 ? (hash(i + Math.floor(k * 10)) > 0.3 ? "#bffcff" : "#4ff3ff") : "#2a8fa6"));
  D.micPulse = (p) => rings.forEach((r, i) => { const q = ((p * 1.2 + i / 3) % 1); r.visible = p > 0; r.scale.setScalar(0.7 + q * 1.1); r.position.y = 2.1; });
  D.sync = (p) => syncRings.forEach((r, i) => { const q = ((p * 1.3 + i / 2) % 1); r.visible = p > 0; r.scale.setScalar(0.6 + q * 1.8); });
  D.lamp = (s) => (lampMat.map = lampTex[s] ?? lampTex.off);
  D.dbFlash = (k) => discs.forEach((d, i) => d.material.color.set(k > 0 && Math.floor(k * 6 + i) % 3 === 0 ? "#2ff0b0" : "#d9fff0"));
  return g;
}
