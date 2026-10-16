// Mr Tan's dining corner at 8:30 in the morning (chapter 5, "Four boxes"): a round marble-top table on a ringed rug,
// his wooden chair, a window with the estate in morning sun, a wall clock at 8:30, the calendar, a teal sideboard with
// thermos, rice cooker, radio, fruit and tissues, a wall shelf with tins, the fridge with magnets, a standing fan, a
// pendant lamp that glows over the table. On the table: the four pharmacy boxes in a row (Amlodipine 5 mg, Metformin
// 500 mg, Atorvastatin 20 mg, Aspirin 100 mg) with printed clinic labels, a blister strip, his phone, a glass of water,
// kopi in a flowered cup, kaya toast, and his cap.
// The table centre is the origin; the back wall is at z = -1.8, the left wall at x = -2.2, the right wall at x = 2.2.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { box, rbox, cyl, ball, painted, tiles, wall, windowView, poster, plant, shadowy } from "./kit.js";
import { hash } from "../core.js";

const INK = "#1a1030";
const MONO = '"Consolas", "Courier New", monospace';
const SANS = '"Segoe UI", system-ui, sans-serif';
const BLACK = '"Arial Black", "Segoe UI Black", "Segoe UI", sans-serif';

/** The four boxes: brand colour, name, dose and the label's instruction line (only the Amlodipine label is legible;
 *  it copies the label photo the app scans). */
export const MEDS = [
  { key: "aml", name: "Amlodipine", dose: "5 mg", caps: "AMLODIPINE 5MG TABLET", col: "#f08a1c", dark: "#b85f00", how: "Take ONE tablet every MORNING" },
  { key: "met", name: "Metformin", dose: "500 mg", caps: "METFORMIN 500MG TABLET", col: "#2f7de1", dark: "#1d55a8" },
  { key: "ato", name: "Atorvastatin", dose: "20 mg", caps: "ATORVASTATIN 20MG TABLET", col: "#8a4fd8", dark: "#5d2fa8" },
  { key: "asp", name: "Aspirin", dose: "100 mg", caps: "ASPIRIN 100MG TABLET", col: "#e2433f", dark: "#a8231f" },
];
export const BOX = { w: 0.19, h: 0.125, d: 0.07 };

function fitFont(c, txt, weight, family, maxW, maxSize) {
  let s = maxSize;
  c.font = `${weight} ${s}px ${family}`;
  const w = c.measureText(txt).width;
  if (w > maxW) s = Math.floor((s * maxW) / w);
  c.font = `${weight} ${s}px ${family}`;
  return s;
}

/** The printed front of a pharmacy box: a brand band with the name and a dose badge, the clinic's label sticker, a
 *  thin band at the bottom (the layout of the real label photo). */
export function paintBoxFront(c, W, H, m) {
  c.fillStyle = "#f7f6f1"; c.fillRect(0, 0, W, H);
  // brand band with the name
  const bh = H * 0.36;
  c.fillStyle = m.col; c.fillRect(0, 0, W, bh);
  c.fillStyle = "rgba(255,255,255,.16)"; c.fillRect(0, bh * 0.08, W, bh * 0.08);
  c.textBaseline = "middle"; c.textAlign = "left";
  c.fillStyle = "#ffffff";
  fitFont(c, m.name, 900, BLACK, W * 0.6, Math.round(bh * 0.6));
  c.fillText(m.name, W * 0.04, bh * 0.54);
  // dose badge
  const bw = W * 0.28, bx = W - bw - W * 0.03, by = bh * 0.16, bhh = bh * 0.68;
  c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(bx, by, bw, bhh, bhh / 2); c.fill();
  c.fillStyle = m.dark; c.textAlign = "center";
  fitFont(c, m.dose, 900, BLACK, bw * 0.84, Math.round(bhh * 0.62));
  c.fillText(m.dose, bx + bw / 2, by + bhh * 0.53);
  // the clinic's label sticker
  const sx = W * 0.045, sy = bh + H * 0.05, sw = W * 0.91, sh = H * 0.47, u = W / 512;
  c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(sx, sy, sw, sh, 10 * u); c.fill();
  c.lineWidth = 3 * u; c.strokeStyle = "#2a2433"; c.stroke();
  c.textAlign = "left"; c.fillStyle = "#1c1824";
  const L = (txt, y, size, weight = 700, fam = MONO) => { c.font = `${weight} ${size}px ${fam}`; c.fillText(txt, sx + sw * 0.05, sy + sh * y); };
  L("BLOSSOM FAMILY CLINIC (FICTIONAL)", 0.13, Math.round(sh * 0.11), 800);
  c.fillStyle = "#2a2433"; c.fillRect(sx + sw * 0.05, sy + sh * 0.24, sw * 0.9, 2 * u);
  c.fillStyle = "#1c1824";
  L("Patient: MR TAN      11/09/2026", 0.36, Math.round(sh * 0.1), 700);
  fitFont(c, m.caps, 900, MONO, sw * 0.9, Math.round(sh * 0.2));
  c.fillText(m.caps, sx + sw * 0.05, sy + sh * 0.56);
  if (m.how) {
    fitFont(c, m.how, 800, SANS, sw * 0.9, Math.round(sh * 0.19));
    c.fillText(m.how, sx + sw * 0.05, sy + sh * 0.78);
  } else {
    // fine print too small to read
    c.fillStyle = "#9a96a3";
    for (let i = 0; i < 2; i++) for (let k = 0; k < 5; k++) {
      const x0 = sx + sw * 0.05 + k * sw * 0.18, ww = sw * (0.08 + hash(i * 9 + k + m.name.length) * 0.08);
      c.fillRect(x0, sy + sh * (0.72 + i * 0.13), ww, sh * 0.055);
    }
  }
  c.fillStyle = "#b02a2a"; c.font = `700 ${Math.round(sh * 0.07)}px ${MONO}`;
  c.fillText("EXAMPLE LABEL - NOT A REAL PRESCRIPTION", sx + sw * 0.05, sy + sh * 0.93);
  // bottom band
  c.fillStyle = m.col; c.fillRect(0, H * 0.91, W, H * 0.09);
}

function paintBoxTop(c, W, H, m) {
  c.fillStyle = "#f7f6f1"; c.fillRect(0, 0, W, H);
  c.fillStyle = m.col; c.fillRect(0, H * 0.72, W, H * 0.28); c.fillRect(0, 0, W, H * 0.12);
  c.fillStyle = m.dark; c.textAlign = "center"; c.textBaseline = "middle";
  fitFont(c, `${m.name} ${m.dose}`, 900, BLACK, W * 0.86, Math.round(H * 0.34));
  c.fillText(`${m.name} ${m.dose}`, W / 2, H * 0.42);
}

/** One pharmacy box: white card with brand-coloured sides, printed front and top. Origin at the bottom centre. */
export function pharmBox(m) {
  const { w, h, d } = BOX;
  const side = toon(m.col), back = toon("#efece4");
  // the Amlodipine label is read on screen (the photo shot), so its front is painted at twice the resolution
  const fw = m.how ? 1024 : 512;
  const front = toon("#ffffff", { map: canvasTex(fw, Math.round((fw * h) / w), (c, W, H) => paintBoxFront(c, W, H, m)) });
  const top = toon("#ffffff", { map: canvasTex(512, Math.round((512 * d) / w), (c, W, H) => paintBoxTop(c, W, H, m)) });
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, back, front, back]);
  b.position.y = h / 2; g.add(b);
  g.userData.med = m;
  return g;
}

/** A blister strip of ten tablets; userData.domes[i].visible = false pops one. */
export function blister() {
  const g = new THREE.Group();
  g.add(rbox(0.17, 0.008, 0.075, 0.004, toon("#c9d0dc"), 0, 0.004, 0));
  g.add(box(0.168, 0.002, 0.012, toon("#f08a1c"), 0, 0.0085, -0.031));
  const domeGeo = new THREE.SphereGeometry(0.0135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = toon("#ffffff");
  const domes = [];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) {
    const dm = new THREE.Mesh(domeGeo, domeMat); dm.position.set(-0.064 + k * 0.032, 0.008, -0.008 + r * 0.03); dm.scale.y = 0.6; g.add(dm); domes.push(dm);
  }
  g.userData.domes = domes;
  return g;
}

/** A tablet (white, a bit large so it reads). */
export function tablet() {
  const g = new THREE.Group();
  const t = cyl(0.016, 0.016, 0.009, toon("#ffffff"), 0, 0, 0, 16); t.rotation.x = Math.PI / 2; g.add(t);
  return g;
}

/** A glass of water. */
export function waterGlass() {
  const g = new THREE.Group();
  // blue water and a dark rim and foot, so it still reads as a glass in front of his white beard (the pale see-through
  // glass vanished there)
  g.add(cyl(0.042, 0.036, 0.12, toon("#a9e4ff", { transparent: true, opacity: 0.6 }), 0, 0.06, 0, 20));
  g.add(cyl(0.037, 0.033, 0.085, toon("#39a9e6"), 0, 0.045, 0, 20));
  g.add(cyl(0.038, 0.038, 0.004, toon("#d9f6ff"), 0, 0.088, 0, 20));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.004, 6, 24), toon("#2a5f9a")); rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
  g.add(cyl(0.037, 0.037, 0.008, toon("#2a5f9a"), 0, 0.004, 0, 20));
  return g;
}

/** His cap: a navy dome with a red button and a brim; the inside of the crown is dark (the end wipe pushes into it).
 *  Origin at the centre of the opening; the opening faces -y, the brim points +z. */
export function makeCap() {
  const g = new THREE.Group();
  const R = 0.2;
  const domeGeo = new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const outer = new THREE.Mesh(domeGeo, toon("#2d4fb3")); outer.scale.y = 0.72; g.add(outer);
  // the dark lining sits well inside the seams and the button, so nothing pokes through it when the camera pushes in
  const inner = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ color: "#0b0716", side: THREE.BackSide })); inner.scale.set(0.955, 0.58, 0.955); g.add(inner);
  // panel seams and the button
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.TorusGeometry(R * 1.002, 0.004, 4, 32, Math.PI), toon("#1e3889"));
    s.rotation.y = (i * Math.PI) / 3; s.scale.y = 0.72; g.add(s);
  }
  g.add(ball(0.022, toon("#e2433f"), 0, R * 0.72, 0));
  // front patch
  const patch = painted(0.12, 0.07, 128, 75, (c, W, H) => { c.fillStyle = "#ffd94a"; c.beginPath(); c.roundRect(4, 4, W - 8, H - 8, 12); c.fill();
    c.fillStyle = "#2d4fb3"; c.font = `900 40px ${BLACK}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("T", W / 2, H / 2 + 2); }, { transparent: true });
  patch.position.set(0, R * 0.38, R * 0.93); patch.rotation.x = -0.35; g.add(patch);
  // brim: a flattened half disc
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.014, 28, 1, false, -Math.PI / 2, Math.PI), toon("#1e3889"));
  brim.position.set(0, 0.005, R * 0.82); brim.scale.set(1, 1, 0.9); brim.rotation.x = 0.08; g.add(brim);
  const band = new THREE.Mesh(new THREE.TorusGeometry(R * 0.995, 0.012, 6, 36), toon("#e2433f")); band.rotation.x = Math.PI / 2; band.position.y = 0.012; g.add(band);
  return g;
}

/** The estate in morning sun, seen through the window. */
function morningView(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#5fb8ff"); g.addColorStop(0.5, "#aee0ff"); g.addColorStop(1, "#fff0c0");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const r = c.createRadialGradient(W * 0.2, H * 0.55, 0, W * 0.2, H * 0.55, H * 0.7);
  r.addColorStop(0, "rgba(255,250,215,1)"); r.addColorStop(0.18, "rgba(255,232,150,.85)"); r.addColorStop(1, "rgba(255,226,140,0)");
  c.fillStyle = r; c.fillRect(0, 0, W, H);
  // puffy clouds
  c.fillStyle = "rgba(255,255,255,.9)";
  [[0.62, 0.18, 1], [0.86, 0.3, 0.7], [0.35, 0.12, 0.6]].forEach(([x, y, s]) => {
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(W * x + (i - 1.5) * 40 * s, H * y + (i % 2 ? -12 : 4) * s, (26 + (i % 2) * 14) * s, 0, 7); c.fill(); }
  });
  // HDB slabs in pastel paint with window grids, water tanks on top
  const cols = ["#ffe0b8", "#bfe9d9", "#ffc9b8", "#d9d0ff", "#fff1c9", "#a9dcef"];
  for (let i = 0; i < 6; i++) {
    const bw = W * (0.15 + hash(i * 3 + 1) * 0.07), bh = H * (0.4 + hash(i * 5 + 2) * 0.32), x = -20 + i * W * 0.18 + hash(i * 7) * 30, y = H - bh;
    c.fillStyle = cols[i % cols.length]; c.fillRect(x, y, bw, bh);
    c.fillStyle = "rgba(90,70,150,.28)"; c.fillRect(x + bw * 0.84, y, bw * 0.16, bh);
    c.fillStyle = "#e9e2f5"; c.fillRect(x + bw * 0.3, y - 14, bw * 0.3, 14);
    for (let rr = 0; rr < bh / 26; rr++) for (let k = 0; k < 5; k++) {
      c.fillStyle = hash(i * 50 + rr * 7 + k) > 0.8 ? "#ffcf6a" : "rgba(70,60,130,.45)";
      c.fillRect(x + 8 + (k * (bw - 16)) / 5, y + 12 + rr * 26, (bw - 16) / 5 - 7, 11);
    }
    c.fillStyle = "rgba(255,255,255,.5)"; for (let rr = 0; rr < bh / 26; rr++) c.fillRect(x, y + 26 + rr * 26, bw * 0.84, 2);
  }
  // trees along the bottom
  for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? "#3fae6b" : "#5cc77f"; c.beginPath(); c.arc((i / 11) * W, H - 6, 34 + hash(i) * 22, 0, 7); c.fill(); }
}

/** A round wall clock whose face shows h:m. */
function wallClock(hh, mm) {
  const g = new THREE.Group();
  const rim = cyl(0.2, 0.2, 0.05, toon("#e2433f"), 0, 0, 0, 40); rim.rotation.x = Math.PI / 2; g.add(rim);
  const face = painted(0.36, 0.36, 256, 256, (c, W, H) => {
    c.fillStyle = "#fff8ea"; c.beginPath(); c.arc(W / 2, H / 2, W / 2, 0, 7); c.fill();
    c.fillStyle = INK; c.font = `900 34px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillText(String(i), W / 2 + Math.sin(a) * 96, H / 2 - Math.cos(a) * 96); }
    for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2, r0 = i % 5 ? 118 : 112; c.fillRect(W / 2 + Math.sin(a) * r0 - 1.5, H / 2 - Math.cos(a) * r0 - 1.5, 3, 3); }
    const hand = (a, len, wd, col) => { c.save(); c.translate(W / 2, H / 2); c.rotate(a); c.fillStyle = col; c.beginPath(); c.roundRect(-wd / 2, -len, wd, len + 14, wd / 2); c.fill(); c.restore(); };
    hand(((hh % 12) + mm / 60) / 12 * Math.PI * 2, 62, 13, INK);
    hand((mm / 60) * Math.PI * 2, 92, 8, INK);
    hand(Math.PI * 0.35, 100, 3, "#e2433f");
    c.fillStyle = "#e2433f"; c.beginPath(); c.arc(W / 2, H / 2, 9, 0, 7); c.fill();
  }, { transparent: true });
  face.position.z = 0.027; g.add(face);
  return g;
}

/** A wooden chair facing +z; seat top at 0.38. */
function chair(col = "#c77a4a", col2 = "#a85f34") {
  const g = new THREE.Group();
  const wd = toon(col), wd2 = toon(col2);
  g.add(rbox(0.46, 0.05, 0.42, 0.015, wd, 0, 0.355, 0));
  for (const [x, z] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]]) g.add(box(0.04, 0.34, 0.04, wd2, x, 0.17, z));
  for (const x of [-0.19, 0.19]) g.add(box(0.045, 0.62, 0.045, wd2, x, 0.68, -0.19));
  g.add(rbox(0.44, 0.1, 0.035, 0.01, wd, 0, 0.92, -0.19));
  g.add(rbox(0.44, 0.06, 0.03, 0.01, wd, 0, 0.72, -0.19));
  return g;
}

/** The standing fan; userData.blades spins. */
function standingFan() {
  const g = new THREE.Group();
  g.add(cyl(0.2, 0.22, 0.05, toon("#f4efe6"), 0, 0.025, 0, 28));
  g.add(cyl(0.022, 0.022, 0.95, toon("#f4efe6"), 0, 0.5, 0));
  const head = new THREE.Group(); head.position.set(0, 1.02, 0); head.rotation.y = 0.5; g.add(head);
  head.add(rbox(0.14, 0.14, 0.18, 0.05, toon("#f4efe6"), 0, 0, -0.08));
  const blades = new THREE.Group(); blades.position.z = 0.04; head.add(blades);
  for (let i = 0; i < 3; i++) { const b = ball(0.1, toon("#5cc7ff"), 0, 0, 0); b.scale.set(0.55, 1.2, 0.12); b.position.set(Math.sin((i / 3) * Math.PI * 2) * 0.1, Math.cos((i / 3) * Math.PI * 2) * 0.1, 0); b.rotation.z = -(i / 3) * Math.PI * 2; blades.add(b); }
  blades.add(cyl(0.035, 0.035, 0.03, toon("#3f66d9"), 0, 0, 0.01).rotateX(Math.PI / 2));
  for (const r of [0.24, 0.16]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 4, 40), toon("#e8e4dc")); ring.position.z = 0.07; head.add(ring); }
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.006, 4, 40), toon("#e8e4dc")); ring2.position.z = 0.0; head.add(ring2);
  g.userData.blades = blades;
  return g;
}

/** The kopi cup (flowered, with coffee); origin at its foot. */
export function kopiCup() {
  const g = new THREE.Group();
  const cupTex = canvasTex(256, 64, (c, W, H) => { c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H); for (let i = 0; i < 8; i++) { const x = i * 32 + 16; c.fillStyle = "#2f9e6a"; c.beginPath(); c.arc(x, 30, 9, 0, 7); c.fill(); c.fillStyle = "#e2433f"; c.beginPath(); c.arc(x, 30, 4, 0, 7); c.fill(); } c.fillStyle = "#2f9e6a"; c.fillRect(0, 4, W, 4); c.fillRect(0, H - 8, W, 4); });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.075, 24, 1, true), toon("#ffffff", { map: cupTex, side: THREE.DoubleSide })); cup.position.y = 0.038; g.add(cup);
  g.add(cyl(0.04, 0.04, 0.004, toon("#fffaf0"), 0, 0.002, 0));
  g.add(cyl(0.047, 0.047, 0.004, toon("#a8673a"), 0, 0.066, 0));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 14), toon("#fffaf0")); handle.position.set(0.055, 0.04, 0); g.add(handle);
  return g;
}

export function buildTable() {
  const g = new THREE.Group();
  const U = g.userData;
  // room shell
  const floor = tiles(4.4, 4.6, "#a7e3d4", "#fff3df", 0.5); floor.position.set(0, 0, 0.5); g.add(floor);
  const back = wall(4.4, 3.0, "#ffe2b0", { band: "#3fb8a6" }); back.position.set(0, 1.5, -1.8); g.add(back);
  const left = wall(4.6, 3.0, "#ff9f86", { band: "#e36f62" }); left.rotation.y = Math.PI / 2; left.position.set(-2.2, 1.5, 0.5); g.add(left);
  const right = wall(4.6, 3.0, "#8fd8c8", { band: "#3fb8a6" }); right.rotation.y = -Math.PI / 2; right.position.set(2.2, 1.5, 0.5); g.add(right);
  // a round rug under the table
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48), toon("#2f9e8f")); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.004; g.add(rug);
  for (const [r0, r1, col] of [[0.82, 0.92, "#bff0e4"], [0.5, 0.58, "#ffd94a"]]) { const rr = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), toon(col)); rr.rotation.x = -Math.PI / 2; rr.position.y = 0.006; g.add(rr); }
  // a patch of morning sun on the floor and the rug (a flat decal)
  const sun = painted(1.5, 0.9, 256, 160, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, "rgba(255,236,160,0)"); gr.addColorStop(0.25, "rgba(255,236,160,.85)"); gr.addColorStop(0.8, "rgba(255,236,160,.85)"); gr.addColorStop(1, "rgba(255,236,160,0)");
    c.fillStyle = gr; c.beginPath(); c.moveTo(W * 0.2, 0); c.lineTo(W, 0); c.lineTo(W * 0.8, H); c.lineTo(0, H); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0)"; c.globalCompositeOperation = "destination-out"; c.fillStyle = "rgba(0,0,0,1)"; c.fillRect(W * 0.47, 0, W * 0.03, H); c.fillRect(0, H * 0.48, W, H * 0.04);
  }, { unlit: true, transparent: true });
  sun.material.blending = THREE.AdditiveBlending; sun.material.opacity = 0.32; sun.material.depthWrite = false;
  sun.rotation.x = -Math.PI / 2; sun.position.set(0.9, 0.01, -0.9); g.add(sun);

  // window on the back wall with the estate outside, a sill plant
  const win = windowView(1.25, 0.95, morningView, { curtains: "#ff8a5a", frame: "#fff8ee" });
  win.position.set(0.55, 1.55, -1.77); g.add(win);
  const sillPlant = plant(0.6, "#2f9e6a"); sillPlant.position.set(0.98, 1.05, -1.66); g.add(sillPlant);
  const sillCan = cyl(0.04, 0.04, 0.1, toon("#ffd94a"), 0.15, 1.1, -1.66); g.add(sillCan);
  // the wall clock at 8:30, the calendar, a framed photo
  const clock = wallClock(8, 30); clock.position.set(-0.75, 2.05, -1.76); g.add(clock); U.clock = clock;
  const cal = poster(0.42, 0.52, (c, W, H) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H); c.fillStyle = "#e2433f"; c.fillRect(0, 0, W, H * 0.2);
    c.fillStyle = "#fff"; c.font = `900 40px ${SANS}`; c.textAlign = "center"; c.fillText("OCT", W / 2, H * 0.15);
    c.fillStyle = "#3a2f55"; c.font = `700 20px ${SANS}`;
    for (let d = 1; d <= 31; d++) { const k = d + 2, x = (k % 7) * (W / 7) + W / 14, y = H * 0.32 + Math.floor(k / 7) * (H * 0.13); c.fillText(String(d), x, y); }
    const k = 17, x = (k % 7) * (W / 7) + W / 14, y = H * 0.32 + Math.floor(k / 7) * (H * 0.13);
    c.strokeStyle = "#e2433f"; c.lineWidth = 5; c.beginPath(); c.ellipse(x, y - 7, 18, 16, 0, 0, 7); c.stroke();
  }, "#3a2a5a");
  cal.position.set(1.55, 1.75, -1.78); g.add(cal);
  const photo = poster(0.36, 0.28, (c, W, H) => {
    c.fillStyle = "#ffd98a"; c.fillRect(0, 0, W, H);
    [[0.32, 1], [0.66, 0.85]].forEach(([x, s], i) => {
      c.fillStyle = "#dfe5f3"; c.fillRect(W * x - 28 * s, H * 0.25, 56 * s, 48 * s); c.fillStyle = INK; c.fillRect(W * x - 21 * s, H * 0.31, 42 * s, 24 * s);
      c.fillStyle = "#9b6bff"; c.fillRect(W * x - 14 * s, H * 0.39, 6, 6); c.fillStyle = "#2ff0b0"; c.fillRect(W * x + 6 * s, H * 0.4, 9, 4);
      c.fillStyle = "#dfe5f3"; c.fillRect(W * x - 22 * s, H * 0.58, 44 * s, 38 * s);
      if (i === 0) { c.fillStyle = "#fff"; c.beginPath(); c.ellipse(W * x, H * 0.6, 22, 14, 0, 0, 7); c.fill(); }
    });
    c.fillStyle = "#ff6fb0"; c.font = `900 30px ${SANS}`; c.fillText("♥", W * 0.45, H * 0.28);
  }, "#c77a4a");
  photo.position.set(-1.45, 1.95, -1.78); g.add(photo);

  // sideboard on the left of the back wall: thermos, rice cooker, radio, fruit, tissues
  const sb = new THREE.Group(); sb.position.set(-1.35, 0, -1.52); g.add(sb);
  sb.add(rbox(1.15, 0.78, 0.48, 0.03, toon("#3fb8a6"), 0, 0.39, 0));
  sb.add(box(1.17, 0.04, 0.5, toon("#f2e3c8"), 0, 0.8, 0));
  for (const x of [-0.29, 0.29]) { sb.add(box(0.52, 0.6, 0.01, toon("#57cdbb"), x, 0.38, 0.245)); sb.add(ball(0.025, toon("#ffd94a"), x + (x < 0 ? 0.2 : -0.2), 0.45, 0.255)); }
  const thermos = new THREE.Group(); thermos.position.set(-0.4, 0.82, 0.02); sb.add(thermos);
  thermos.add(cyl(0.075, 0.075, 0.3, toon("#e2433f"), 0, 0.15, 0)); thermos.add(cyl(0.077, 0.077, 0.08, toon("#ffd94a"), 0, 0.17, 0));
  thermos.add(cyl(0.05, 0.06, 0.05, toon("#f4efe6"), 0, 0.33, 0)); thermos.add(box(0.03, 0.12, 0.03, toon("#f4efe6"), 0.09, 0.2, 0));
  const cooker = new THREE.Group(); cooker.position.set(-0.08, 0.82, 0.0); sb.add(cooker);
  cooker.add(rbox(0.26, 0.17, 0.24, 0.07, toon("#fffaf0"), 0, 0.085, 0)); cooker.add(rbox(0.24, 0.05, 0.22, 0.04, toon("#ff8fb0"), 0, 0.19, 0));
  cooker.add(box(0.06, 0.03, 0.01, flat("#ff6a3a"), 0, 0.07, 0.122));
  const radio = new THREE.Group(); radio.position.set(0.3, 0.82, 0.03); sb.add(radio);
  radio.add(rbox(0.28, 0.16, 0.1, 0.025, toon("#f2c25a"), 0, 0.08, 0)); radio.add(cyl(0.045, 0.045, 0.012, toon("#7a5a3a"), -0.07, 0.08, 0.052).rotateX(Math.PI / 2));
  radio.add(box(0.1, 0.05, 0.01, toon("#fff3d0"), 0.06, 0.09, 0.052)); radio.add(cyl(0.005, 0.005, 0.25, toon("#c9ced8"), 0.1, 0.27, -0.02).rotateZ(-0.4));
  const bowl = new THREE.Group(); bowl.position.set(0.48, 0.82, 0.08); sb.add(bowl);
  bowl.add(cyl(0.11, 0.06, 0.06, toon("#5cc7ff"), 0, 0.03, 0));
  [[-0.04, 0.0, "#ff9a2e"], [0.04, 0.02, "#ffb347"], [0, -0.04, "#ff9a2e"], [0.01, 0.03, "#ffd94a"]].forEach(([x, z, col], i) => bowl.add(ball(0.045, toon(col), x, 0.08 + (i === 3 ? 0.04 : 0), z)));
  const tissue = new THREE.Group(); tissue.position.set(0.16, 0.82, 0.16); tissue.rotation.y = 0.3; sb.add(tissue);
  tissue.add(rbox(0.16, 0.08, 0.1, 0.015, toon("#ffc9e0"), 0, 0.04, 0)); tissue.add(ball(0.03, toon("#ffffff"), 0, 0.09, 0));
  // wall shelf with tins and a plant
  const shelf = new THREE.Group(); shelf.position.set(-1.35, 1.38, -1.66); g.add(shelf);
  shelf.add(box(1.0, 0.035, 0.24, toon("#c77a4a"), 0, 0, 0));
  [["#2f9e6a", 0.1], ["#e2433f", 0.13], ["#ffd94a", 0.09], ["#3f66d9", 0.11]].forEach(([col, h], i) => { shelf.add(cyl(0.05, 0.05, h, toon(col), -0.36 + i * 0.13, 0.018 + h / 2, 0)); shelf.add(cyl(0.052, 0.052, 0.015, toon("#f4efe6"), -0.36 + i * 0.13, 0.018 + h, 0)); });
  const sp = plant(0.55, "#3fae6b"); sp.position.set(0.32, 0.02, 0); shelf.add(sp);

  // the fridge on the right with magnets and a note
  const fr = new THREE.Group(); fr.position.set(1.62, 0, -1.4); fr.rotation.y = -0.35; g.add(fr);
  fr.add(rbox(0.72, 1.7, 0.62, 0.06, toon("#fff4e0"), 0, 0.85, 0));
  fr.add(box(0.7, 0.012, 0.01, toon("#d9c9b0"), 0, 1.15, 0.311));
  fr.add(box(0.04, 0.3, 0.04, toon("#c9ced8"), -0.28, 1.38, 0.33), box(0.04, 0.4, 0.04, toon("#c9ced8"), -0.28, 0.8, 0.33));
  [["#e2433f", -0.05, 1.45], ["#3f66d9", 0.12, 1.32], ["#ffd94a", 0.02, 0.95], ["#2f9e6a", 0.18, 0.72], ["#ff6fb0", -0.1, 0.6]].forEach(([col, x, y], i) => fr.add(rbox(0.06, 0.06, 0.02, 0.01, toon(col), x, y, 0.315)));
  const memo = painted(0.18, 0.22, 64, 80, (c, W, H) => { c.fillStyle = "#fffbe0"; c.fillRect(0, 0, W, H); c.fillStyle = "#8a83a0"; for (let i = 0; i < 6; i++) c.fillRect(8, 14 + i * 10, W - 16 - (i % 3) * 8, 3); });
  memo.position.set(0.1, 1.42, 0.322); memo.rotation.z = 0.08; fr.add(memo);
  // the standing fan in the left corner
  const fan = standingFan(); fan.position.set(-1.75, 0, -0.55); fan.rotation.y = 0.7; g.add(fan); U.fan = fan;
  // a tall plant by the fridge
  const tall = plant(1.6, "#2f9e6a"); tall.position.set(1.85, 0, -0.45); g.add(tall);

  // the pendant lamp over the table: the warm light you can see
  const lampG = new THREE.Group(); lampG.position.set(0, 2.0, -0.1); g.add(lampG);
  lampG.add(cyl(0.006, 0.006, 1.2, toon(INK), 0, 0.6, 0));
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.24, 0.2, 28, 1, true), toon("#ff9a2e", { side: THREE.DoubleSide }));
  lampG.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10), flat("#fff3c4")); bulb.position.y = -0.07; lampG.add(bulb);
  const glow = new THREE.PointLight("#ffb860", 0.9, 2.6, 1.8); glow.position.set(0, -0.15, 0); lampG.add(glow);
  U.lamp = lampG;

  // the table: round marble top, dark wood rim, a pedestal
  const T = new THREE.Group(); g.add(T); U.table = T;
  const TH = 0.66, TR = 0.52;
  const marble = canvasTex(512, 512, (c, W, H) => {
    c.fillStyle = "#fbf8f2"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(150,140,175,.35)"; c.lineWidth = 2;
    for (let i = 0; i < 9; i++) { c.beginPath(); let x = hash(i) * W, y = 0; c.moveTo(x, y); for (let k = 0; k < 12; k++) { x += (hash(i * 13 + k) - 0.5) * 80; y += H / 12; c.lineTo(x, y); } c.stroke(); }
  });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TR, TR, 0.03, 48), [toon("#7a4a2e"), toon("#ffffff", { map: marble }), toon("#7a4a2e")]);
  top.position.y = TH - 0.015; T.add(top);
  T.add(cyl(TR + 0.015, TR + 0.015, 0.035, toon("#7a4a2e"), 0, TH - 0.045, 0, 48));
  T.add(cyl(0.05, 0.06, TH - 0.06, toon("#5a3424"), 0, (TH - 0.06) / 2, 0));
  T.add(cyl(0.26, 0.28, 0.04, toon("#5a3424"), 0, 0.02, 0, 32));
  U.top = TH;

  // his chair (behind the table) and a second chair on the right
  const ch = chair(); ch.position.set(0, 0, -0.74); g.add(ch); U.chair = ch;
  const ch2 = chair("#d98a55", "#b06a3e"); ch2.position.set(-0.86, 0, 0.18); ch2.rotation.y = Math.PI / 2 + 0.35; g.add(ch2);

  // on the table ------------------------------------------------------------
  const boxes = {};
  MEDS.forEach((m, i) => { const b = pharmBox(m); b.position.set(-0.33 + i * 0.22, TH, -0.04); g.add(b); boxes[m.key] = b; });
  U.boxes = boxes;
  const strip = blister(); strip.position.set(-0.3, TH, 0.23); strip.rotation.y = 0.25; g.add(strip); U.strip = strip;
  const glass = waterGlass(); glass.position.set(0.23, TH, -0.4); g.add(glass); U.glass = glass;
  // kopi in a flowered cup on a saucer, with steam
  const kopi = new THREE.Group(); kopi.position.set(0.39, TH, -0.2); g.add(kopi); U.kopi = kopi;
  kopi.add(cyl(0.085, 0.07, 0.012, toon("#fffaf0"), 0, 0.006, 0, 28));
  const cupG = kopiCup(); cupG.position.y = 0.012; kopi.add(cupG); U.kopiCup = cupG;
  const steam = []; for (let i = 0; i < 3; i++) { const s = ball(0.018, toon("#ffffff", { transparent: true, opacity: 0.7, name: "c05steam" + i }), 0, 0.1, 0); kopi.add(s); steam.push(s); }
  // kaya toast on a plate
  const plate = new THREE.Group(); plate.position.set(0.3, TH, 0.25); g.add(plate);
  plate.add(cyl(0.12, 0.09, 0.012, toon("#ffffff"), 0, 0.006, 0, 28));
  const prim = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.115, 28), toon("#3f66d9")); prim.rotation.x = -Math.PI / 2; prim.position.y = 0.013; plate.add(prim);
  for (const [x, z, r] of [[-0.03, 0.01, 0.4], [0.04, -0.02, -0.5]]) {
    const toast = new THREE.Group(); toast.position.set(x, 0.02, z); toast.rotation.y = r; plate.add(toast);
    toast.add(rbox(0.1, 0.02, 0.07, 0.008, toon("#e0a050"), 0, 0, 0)); toast.add(box(0.07, 0.012, 0.05, toon("#7fbf4a"), 0, 0.012, 0)); toast.add(box(0.04, 0.012, 0.025, toon("#ffe680"), 0.01, 0.022, 0));
  }
  // his phone lying on the table (the one in his hand is a separate prop)
  const phone = new THREE.Group(); phone.position.set(-0.3, TH, -0.3); phone.rotation.y = 0.35; g.add(phone); U.phone = phone;
  phone.add(rbox(0.128, 0.014, 0.264, 0.012, toon("#1b1825"), 0, 0.007, 0));
  const pscr = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.248), flat("#2a2340")); pscr.rotation.x = -Math.PI / 2; pscr.position.y = 0.0145; phone.add(pscr); U.phoneScreen = pscr.material;
  // his cap on the table, back right, near his left hand
  const cap = makeCap(); cap.scale.setScalar(0.82); cap.position.set(0.0, TH + 0.005, -0.3); cap.rotation.y = -0.5; g.add(cap); U.cap = cap;

  // a cicak (house gecko) on the back wall
  const gecko = new THREE.Group(); g.add(gecko); U.gecko = gecko;
  const gk = toon("#c9b98a");
  { const b = ball(0.03, gk, 0, 0, 0); b.scale.set(0.8, 2.0, 0.45); gecko.add(b);
    const h = ball(0.024, gk, 0, 0.07, 0); h.scale.set(1, 1.2, 0.5); gecko.add(h);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.1, 8), gk); tail.position.y = -0.1; tail.rotation.z = Math.PI; gecko.add(tail);
    for (const [x, y] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const l = box(0.04, 0.008, 0.006, gk, x * 0.03, y * 0.03, 0); l.rotation.z = x * y * 0.5; gecko.add(l); }
    for (const x of [-1, 1]) gecko.add(ball(0.006, flat("#1a1030"), x * 0.012, 0.08, 0.01)); }
  /** per-frame motion of the set: fan blades, kopi steam, the gecko. */
  U.update = (t) => {
    { // the gecko scuttles in bursts (on twos) along the wall between the clock and the window
      const lt = Math.floor((t - 85) * 15) / 15, k = Math.min(1, Math.max(0, lt / 30));
      const step = Math.floor(lt / 1.6) + Math.min(1, (lt % 1.6) / 0.35);
      const u = Math.min(1, step / 19);
      gecko.position.set(-0.55 + u * 0.42, 1.55 + u * 0.38 + Math.sin(u * 6) * 0.05, -1.785);
      gecko.rotation.z = -0.7 + Math.cos(u * 6) * 0.35 + k * 0;
    }
    U.fan.userData.blades.rotation.z = -t * 14;
    steam.forEach((s, i) => { const k = ((t * 0.5 + i / 3) % 1); s.position.set(Math.sin(t * 2 + i * 2) * 0.015, 0.1 + k * 0.18, 0); s.scale.setScalar(0.6 + k * 1.1); s.material.opacity = 0.7 * (1 - k); });
  };
  // real shadows: everything casts and receives, except the sunlight decal and the wall shells (which only receive)
  shadowy(g);
  sun.castShadow = false; sun.receiveShadow = false;
  for (const w of [back, left, right, floor, rug]) w.castShadow = false;
  return g;
}
