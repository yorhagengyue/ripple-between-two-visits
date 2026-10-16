// Props for c09 (the problem): a big pharmacy label whose words swim, word-birds that flock out of the window, a wall
// calendar that unrolls with two visits circled, and Dr Lim's pointer. Built once into one group (the chapter registers
// it as "c09.props"); each shot shows what it needs.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { hash } from "../core.js";
import { box, cyl, ball, shadowy } from "./kit.js";

const INK = "#1a1030", SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const PI = Math.PI;

function liveTex(w, h) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { cv, tex, ctx: cv.getContext("2d") };
}

/** The pharmacy label: 0.6 x 0.42 m, faces +z. userData.paint(swim, tq): the letters wobble and swim by `swim` (0..1+). */
function label() {
  const g = new THREE.Group();
  const L = liveTex(640, 448);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.42), new THREE.MeshBasicMaterial({ map: L.tex, color: "#cfcfd6", toneMapped: false, side: THREE.DoubleSide }));
  g.add(m);
  g.add(box(0.62, 0.44, 0.008, toon("#e9e4f6"), 0, 0, -0.006));
  const lines = [
    { txt: "AMLODIPINE 5 MG TABLETS", font: `900 40px ${SANS}`, y: 120 },
    { txt: "Take ONE tablet", font: `700 46px ${SANS}`, y: 205 },
    { txt: "every MORNING", font: `700 46px ${SANS}`, y: 262 },
  ];
  let last = "";
  g.userData.paint = (swim, tq) => {
    const key = `${swim.toFixed(2)}:${tq.toFixed(3)}`; if (key === last) return; last = key;
    const c = L.ctx, W = 640, H = 448;
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#e2333f"; c.fillRect(0, 0, W, 54);
    c.fillStyle = "#ffffff"; c.font = `800 28px ${SANS}`; c.textBaseline = "middle"; c.fillText("Rx", 24, 28);
    c.fillStyle = "rgba(255,255,255,.85)"; c.fillRect(80, 22, 220, 12); c.fillRect(320, 22, 120, 12);
    c.strokeStyle = INK; c.lineWidth = 8; c.strokeRect(4, 4, W - 8, H - 8);
    lines.forEach((ln, li) => {
      c.font = ln.font; c.textBaseline = "middle";
      const total = c.measureText(ln.txt).width; let x = (W - total) / 2;
      for (let i = 0; i < ln.txt.length; i++) {
        const ch = ln.txt[i], w = c.measureText(ch).width, ph = i * 0.9 + li * 2.1;
        const dx = Math.sin(tq * 5 + ph) * swim * 9 + Math.sin(i * 7.3 + li) * swim * swim * 14;
        const dy = Math.cos(tq * 4.2 + ph * 1.3) * swim * 12;
        c.save(); c.translate(x + w / 2 + dx, ln.y + dy); c.rotate(Math.sin(tq * 3 + ph) * swim * 0.45);
        c.fillStyle = INK; c.globalAlpha = 1 - Math.min(0.5, swim * 0.25 * hash(i + li * 31)); c.fillText(ch, -w / 2, 0); c.restore();
        x += w;
      }
    });
    // fine print
    c.fillStyle = "#b7b0cc";
    for (let i = 0; i < 3; i++) c.fillRect(60, 320 + i * 30, (W - 120) * (0.6 + hash(i + 4) * 0.4), 12);
    L.tex.needsUpdate = true;
  };
  g.userData.paint(0, 0);
  return g;
}

/** A word-bird: a word on a card with two flapping wings. userData.flap(phase). Faces +z. The card is as wide as its
 *  word (nothing is cut off), and its paper sits below the bloom threshold so the ink stays crisp. */
function bird(word, i) {
  const g = new THREE.Group();
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `800 46px ${SANS}`; const tw = meas.measureText(word).width;
  const bw = Math.ceil(tw + 48), cw = bw + 12;
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = 96;
  const c = cv.getContext("2d");
  c.fillStyle = "#e4e0f2"; c.beginPath(); c.roundRect(6, 8, bw, 80, 22); c.fill();
  c.strokeStyle = INK; c.lineWidth = 6; c.stroke();
  c.font = `800 46px ${SANS}`; c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(word, cw / 2, 50);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const W = 0.4 * (cw / 320);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.12), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  g.add(card);
  const half = W / 2;
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.2, 0.02); shape.lineTo(0.13, 0.1); shape.lineTo(0.05, 0.08); shape.closePath();
  const wingGeo = new THREE.ShapeGeometry(shape);
  const wm = new THREE.MeshBasicMaterial({ color: i % 2 ? "#e8dcc4" : "#d6cff0", side: THREE.DoubleSide, toneMapped: false });
  const wings = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * half * 0.55, 0.045, -0.005); const w = new THREE.Mesh(wingGeo, wm); w.scale.x = s; p.add(w); g.add(p); return p; });
  g.userData.flap = (ph) => { const a = 0.15 + Math.sin(ph) * 0.65; wings[0].rotation.z = -a; wings[1].rotation.z = a; };
  return g;
}
// Fragments of Dr Lim's one line in the speech bubble just before (c09 talk, voice c09-lim), in the order he says them:
// "Mr Tan, we will increase the amlodipine to 10 milligrams every morning." Nothing else: no emergency words here.
export const BIRD_WORDS = ["Mr Tan", "we will increase", "the amlodipine", "to 10 milligrams", "every morning"];

/** The wall calendar, 3.4 x 2.2 m, hung from a rod at its top edge (the group's origin); userData.paint(k1, k2) draws
 *  the two visit circles with progress k1, k2; userData.unroll(k) scales it down from the rod. userData.uv(u, v) gives the
 *  local point of a texture position (u, v in 0..1, from the top left). */
export const CAL = { w: 3.4, h: 2.2 };
function calendar() {
  const g = new THREE.Group();
  const L = liveTex(1024, 662);
  const sheet = new THREE.Group(); g.add(sheet);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(CAL.w, CAL.h), toon("#ffffff", { map: L.tex, emissive: "#ffffff", emissiveMap: L.tex, emissiveIntensity: 0.35 }));
  paper.position.y = -CAL.h / 2; sheet.add(paper);
  const rodTop = cyl(0.045, 0.045, CAL.w + 0.3, toon("#e2333f"), 0, 0, 0.02, 16); rodTop.rotation.z = PI / 2; g.add(rodTop);
  const rodBot = cyl(0.04, 0.04, CAL.w + 0.2, toon("#e2333f"), 0, 0, 0.02, 16); rodBot.rotation.z = PI / 2; g.add(rodBot);
  for (const s of [-1, 1]) g.add(cyl(0.012, 0.012, 1.2, toon("#3a3478"), s * 1.4, 0.6, 0, 8));
  // grid: 7 columns, 6 week rows from Mon 7 Sep to Sun 18 Oct 2026
  const X0 = 40, Y0 = 150, CW = (1024 - 80) / 7, RH = (662 - 170) / 6;
  const cell = (r, col) => [X0 + col * CW, Y0 + r * RH];
  const visits = [[0, 4, "11"], [5, 3, "15"]];
  // the green stamp "BETWEEN TWO VISITS" printed onto the paper (used once it has landed, so it sits behind anyone
  // standing in front of the calendar and shrinks with it); same look as overlay2's stamp(), with the ink gaps
  // knocked out on a layer of its own so they show the paper, not black
  const stampCv = document.createElement("canvas"); stampCv.width = 760; stampCv.height = 220;
  const paintStamp = () => {
    const s = stampCv.getContext("2d"), size = 68, text = "BETWEEN TWO VISITS", col = "#1fae6b";
    s.clearRect(0, 0, 760, 220); s.save(); s.translate(380, 110); s.rotate(-0.09); s.globalAlpha = 0.92;
    s.font = `${size}px "Bangers", "Impact", sans-serif`; const w = s.measureText(text).width + size * 0.9, h = size * 1.35;
    s.lineWidth = 8; s.strokeStyle = col; s.strokeRect(-w / 2, -h / 2, w, h);
    s.lineWidth = 3; s.strokeRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18);
    s.fillStyle = col; s.textAlign = "center"; s.textBaseline = "middle"; s.fillText(text, 0, 4);
    s.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 70; i++) { s.beginPath(); s.arc((hash(i * 3 + 84) - 0.5) * w, (hash(i * 7 + 84) - 0.5) * h, 1 + hash(i * 11) * 3, 0, 7); s.fill(); }
    s.restore();
  };
  let last = "";
  g.userData.paint = (k1, k2, stamped = 0) => {
    const key = `${k1.toFixed(2)}:${k2.toFixed(2)}:${stamped ? 1 : 0}`; if (key === last) return; last = key;
    const c = L.ctx;
    c.fillStyle = "#fff8ec"; c.fillRect(0, 0, 1024, 662);
    c.fillStyle = "#6a4fd8"; c.fillRect(0, 0, 1024, 84);
    c.fillStyle = "#ffffff"; c.font = `900 54px ${SANS}`; c.textBaseline = "middle"; c.fillText("SEP – OCT 2026", 40, 44);
    c.fillStyle = INK; c.font = `800 26px ${SANS}`; c.textAlign = "center";
    ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].forEach((d, i) => c.fillText(d, X0 + CW * (i + 0.5), 118));
    for (let r = 0; r < 6; r++) for (let col = 0; col < 7; col++) {
      const [x, y] = cell(r, col), n = 7 + r * 7 + col, day = n > 30 ? n - 30 : n;
      c.strokeStyle = "#cfc6e8"; c.lineWidth = 3; c.strokeRect(x, y, CW, RH);
      c.fillStyle = col > 4 ? "#b04a6a" : "#5a5078"; c.font = `700 30px ${SANS}`; c.textAlign = "left";
      c.fillText(String(day), x + 12, y + 26);
      if (day === 1 && n > 30) { c.fillStyle = "#6a4fd8"; c.font = `800 20px ${SANS}`; c.fillText("OCT", x + 50, y + 26); }
    }
    visits.forEach(([r, col], i) => {
      const k = i ? k2 : k1; if (k <= 0) return;
      const [x, y] = cell(r, col), cx = x + CW / 2, cy = y + RH / 2;
      c.strokeStyle = "#e2333f"; c.lineWidth = 10; c.lineCap = "round";
      c.beginPath(); c.ellipse(cx, cy, CW * 0.52, RH * 0.5, -0.1, -PI / 2, -PI / 2 + PI * 2.15 * k); c.stroke();
      if (k > 0.8) { c.fillStyle = "#e2333f"; c.font = `900 26px ${SANS}`; c.textAlign = "center"; c.fillText("VISIT", cx, cy + 22); }
    });
    c.textAlign = "left";
    if (stamped) { paintStamp(); c.drawImage(stampCv, 512 - 380, Y0 + RH * 3 - 110); }
    L.tex.needsUpdate = true;
  };
  g.userData.paint(0, 0);
  g.userData.unroll = (k) => { sheet.scale.y = Math.max(0.02, k); rodBot.position.y = -CAL.h * Math.max(0.02, k); };
  /** local position of texture point (u, v) when fully unrolled */
  g.userData.uv = (u, v) => new THREE.Vector3((u - 0.5) * CAL.w, -v * CAL.h, 0.01);
  g.userData.gapUV = [0.5, (Y0 + RH * 3) / 662];       // the middle of the empty weeks
  g.userData.visitUV = visits.map(([r, col]) => { const [x, y] = cell(r, col); return [(x + CW / 2) / 1024, (y + RH / 2) / 662]; });
  return g;
}

/** Dr Lim's pointer: a 1.2 m stick along +y with a red tip. */
function pointer() {
  const g = new THREE.Group();
  g.add(cyl(0.012, 0.016, 1.2, toon("#c98a5a"), 0, 0.6, 0, 8));
  g.add(ball(0.03, toon("#e2333f"), 0, 1.2, 0));
  return g;
}

export function buildC09Props() {
  const g = new THREE.Group();
  const birds = BIRD_WORDS.map((w, i) => bird(w, i));
  const P = { label: label(), calendar: calendar(), pointer: pointer() };
  for (const k in P) g.add(P[k]);
  birds.forEach((b) => g.add(b));
  shadowy(P.calendar); shadowy(P.pointer);
  g.userData = { ...P, birds };
  return g;
}
