// The cast, built from blocks. Each maker returns { g, pose(o) }; pose() is called every frame with plain numbers.
//   Mr Tan: 67, retired, grey hair, round glasses, ochre polo.          (the elder)
//   Wei Ling: drawn as the CodeBuddy mascot: a silver cat-eared robot with a black visor, ">" in violet and "-" in green.
//   Dr Lim: family doctor, white coat, stethoscope.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toon, flat } from "./look.js";
import { lerp, wob } from "./core.js";

const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const rbox = (w, h, d, r, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), m); o.position.set(x, y, z); return o; };
const pivot = (x, y, z, ...kids) => { const p = new THREE.Group(); p.position.set(x, y, z); kids.forEach((k) => p.add(k)); return p; };

export function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** A block person. o: skin, hair, shirt, pants, shoe, coat (white coat flaps), glasses, hairStyle. */
function person(o) {
  const g = new THREE.Group();
  const skin = toon(o.skin), shirt = toon(o.shirt), pants = toon(o.pants), shoe = toon(o.shoe), hair = toon(o.hair);
  const ink = flat("#1a1030");
  // legs: thigh + shin, pivots at hip and knee
  const legs = [-1, 1].map((s) => {
    const shin = pivot(0, -0.4, 0, box(0.17, 0.4, 0.19, pants, 0, -0.2, 0), box(0.19, 0.08, 0.28, shoe, 0, -0.42, 0.04));
    const hip = pivot(s * 0.12, 0.84, 0, box(0.18, 0.42, 0.2, pants, 0, -0.2, 0), shin);
    g.add(hip); return { hip, knee: shin };
  });
  const body = pivot(0, 0.84, 0);
  g.add(body);
  body.add(box(0.52, 0.6, 0.3, shirt, 0, 0.3, 0));
  if (o.collar) body.add(box(0.3, 0.06, 0.31, toon(o.collar), 0, 0.59, 0.005));
  if (o.coat) {
    const coat = toon(o.coat);
    body.add(box(0.56, 0.78, 0.33, coat, 0, 0.22, -0.01));
    body.add(box(0.2, 0.6, 0.02, shirt, 0, 0.3, 0.165)); // the shirt shows between the lapels
    if (o.stetho) {
      const tube = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 8, 24, Math.PI), toon("#2a2633"));
      tube.position.set(0, 0.48, 0.17); tube.rotation.z = Math.PI; body.add(tube);
      body.add(rbox(0.07, 0.07, 0.03, 0.015, toon("#c9ced8"), 0.0, 0.3, 0.18));
    }
    if (o.badge) body.add(box(0.1, 0.06, 0.01, flat("#ffffff"), -0.15, 0.42, 0.17));
  }
  // arms: pivots at the shoulders
  const arms = [-1, 1].map((s) => {
    const sleeve = o.coat ? toon(o.coat) : shirt;
    const a = pivot(s * 0.34, 0.56, 0, box(0.15, 0.32, 0.17, sleeve, 0, -0.14, 0), box(0.13, 0.3, 0.15, skin, 0, -0.42, 0));
    body.add(a); return a;
  });
  // head
  const head = pivot(0, 0.62, 0);
  body.add(head);
  head.add(box(0.12, 0.06, 0.12, skin, 0, 0.02, 0));
  head.add(box(0.4, 0.38, 0.36, skin, 0, 0.24, 0));
  const hairStyle = o.hairStyle || "short";
  head.add(box(0.42, hairStyle === "thin" ? 0.06 : 0.1, 0.38, hair, 0, 0.44, -0.005));
  head.add(box(0.42, 0.24, 0.1, hair, 0, 0.34, -0.15));
  if (hairStyle !== "thin") head.add(box(0.06, 0.16, 0.3, hair, -0.2, 0.35, -0.02), box(0.06, 0.16, 0.3, hair, 0.2, 0.35, -0.02));
  else head.add(box(0.05, 0.12, 0.28, hair, -0.205, 0.3, -0.03), box(0.05, 0.12, 0.28, hair, 0.205, 0.3, -0.03));
  const eyes = [-1, 1].map((s) => { const e = box(0.05, 0.075, 0.012, ink, s * 0.085, 0.26, 0.183); head.add(e); return e; });
  const brows = [-1, 1].map((s) => { const b = box(0.09, 0.022, 0.012, toon(o.brow || o.hair), s * 0.088, 0.335, 0.183); head.add(b); return b; });
  const mouth = box(0.1, 0.022, 0.012, toon("#7a3b3b"), 0, 0.14, 0.183); head.add(mouth);
  if (o.glasses) {
    const fr = flat("#2a1f3a");
    for (const s of [-1, 1]) {
      head.add(box(0.12, 0.012, 0.012, fr, s * 0.085, 0.31, 0.19), box(0.12, 0.012, 0.012, fr, s * 0.085, 0.21, 0.19));
      head.add(box(0.012, 0.11, 0.012, fr, s * 0.085 - 0.06, 0.26, 0.19), box(0.012, 0.11, 0.012, fr, s * 0.085 + 0.06, 0.26, 0.19));
    }
    head.add(box(0.05, 0.012, 0.012, fr, 0, 0.27, 0.19));
  }
  if (o.mustache) head.add(box(0.14, 0.03, 0.014, hair, 0, 0.175, 0.185));

  /** pose: x, z, rotY, walk (phase, 0 = still), sit 0..1, armL/armR (forward raise, rad), armOutL/armOutR (sideways),
   *  headYaw, headPitch, headTilt, blink 0..1, talk 0..1 (mouth), brow (-1 worried .. 1 raised), lean, dy */
  function pose(p = {}) {
    g.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0); g.rotation.y = p.rotY ?? 0;
    const sit = p.sit ?? 0, wk = p.walk ?? 0, sw = wk ? Math.sin(wk) * 0.55 : 0;
    legs[0].hip.rotation.x = lerp(-sw, -Math.PI / 2, sit); legs[1].hip.rotation.x = lerp(sw, -Math.PI / 2, sit);
    legs[0].knee.rotation.x = lerp(Math.max(0, sw) * 0.6, Math.PI / 2, sit); legs[1].knee.rotation.x = lerp(Math.max(0, -sw) * 0.6, Math.PI / 2, sit);
    const bob = wk ? Math.abs(Math.cos(wk)) * 0.03 : 0;
    const sitDrop = sit * 0.36;
    body.position.y = 0.84 - sitDrop + bob + (p.dy ?? 0);
    legs.forEach((l) => (l.hip.position.y = 0.84 - sitDrop + (p.dy ?? 0)));
    body.rotation.x = p.lean ?? 0;
    arms[0].rotation.x = -(p.armL ?? 0) + (wk ? sw * 0.7 : 0); arms[1].rotation.x = -(p.armR ?? 0) - (wk ? sw * 0.7 : 0);
    arms[0].rotation.z = -(p.armOutL ?? 0.06); arms[1].rotation.z = p.armOutR ?? 0.06;
    head.rotation.set(p.headPitch ?? 0, p.headYaw ?? 0, p.headTilt ?? 0);
    const bl = 1 - (p.blink ?? 0) * 0.85; eyes.forEach((e) => (e.scale.y = bl));
    const br = p.brow ?? 0; brows[0].position.y = brows[1].position.y = 0.335 + br * 0.02;
    brows[0].rotation.z = -br * 0.25; brows[1].rotation.z = br * 0.25;
    if (br < 0) { brows[0].rotation.z = br * 0.35; brows[1].rotation.z = -br * 0.35; }
    mouth.scale.y = 1 + (p.talk ?? 0) * 3.2; mouth.scale.x = 1 - (p.talk ?? 0) * 0.3;
    if (p.smile) { mouth.scale.x = 1.3; }
  }
  pose({});
  return { g, pose, head, arms, body };
}

export const makeTan = () => person({ skin: "#e3a77d", hair: "#cfd0d8", brow: "#b9bac4", shirt: "#e7a531", collar: "#f2c25a",
  pants: "#5a4a7a", shoe: "#3a2f4a", glasses: true, hairStyle: "thin", mustache: false });
export const makeLim = () => person({ skin: "#d89a72", hair: "#1e1a2a", shirt: "#5b8fd6", pants: "#2f3550", shoe: "#1e1a2a",
  coat: "#f3f1ec", stetho: true, badge: true, hairStyle: "short" });
/** A background person in given colours. */
export const makeExtra = (shirt, pants, hair = "#2a2236", skin = "#cf9670") => person({ skin, hair, shirt, pants, shoe: "#2a2236" });

/** Wei Ling, drawn as the CodeBuddy mascot. Visor faces: "code" (> -), "happy" (^ ^), "blink" (- -), "wow" (o o). */
export function makeBot() {
  const g = new THREE.Group();
  const silver = toon("#dfe2ea"), dark = toon("#2a2633"), grey = toon("#8d93a3");
  const faces = {};
  const face = (name, draw) => (faces[name] = canvasTex(256, 160, (c, w, h) => { c.fillStyle = "#120f1a"; c.fillRect(0, 0, w, h); draw(c, w, h); }));
  const glyph = (c, txt, x, y, col, size = 92) => { c.font = `900 ${size}px "Arial Black", system-ui`; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = col; c.shadowBlur = 18; c.fillStyle = col; c.fillText(txt, x, y); c.shadowBlur = 0; };
  face("code", (c, w, h) => { glyph(c, ">", w * 0.32, h * 0.5, "#9b6bff"); glyph(c, "-", w * 0.7, h * 0.47, "#2ff0b0", 110); });
  face("happy", (c, w, h) => { glyph(c, "^", w * 0.32, h * 0.58, "#9b6bff", 100); glyph(c, "^", w * 0.68, h * 0.58, "#2ff0b0", 100); });
  face("blink", (c, w, h) => { glyph(c, "-", w * 0.32, h * 0.47, "#9b6bff", 110); glyph(c, "-", w * 0.7, h * 0.47, "#2ff0b0", 110); });
  face("wow", (c, w, h) => { glyph(c, "o", w * 0.32, h * 0.45, "#9b6bff", 100); glyph(c, "o", w * 0.68, h * 0.45, "#2ff0b0", 100); });
  face("worry", (c, w, h) => { glyph(c, ">", w * 0.32, h * 0.5, "#9b6bff"); glyph(c, "<", w * 0.68, h * 0.5, "#2ff0b0"); });
  const visorMat = new THREE.MeshBasicMaterial({ map: faces.code });

  // legs and body
  const legs = [-1, 1].map((s) => { const l = pivot(s * 0.13, 0.26, 0, rbox(0.17, 0.26, 0.2, 0.06, silver, 0, -0.12, 0)); g.add(l); return l; });
  const body = pivot(0, 0.26, 0); g.add(body);
  body.add(rbox(0.5, 0.42, 0.38, 0.12, silver, 0, 0.2, 0));
  body.add(rbox(0.22, 0.14, 0.02, 0.03, dark, 0, 0.22, 0.19)); // chest panel
  body.add(rbox(0.06, 0.06, 0.02, 0.02, flat("#2ff0b0"), 0.05, 0.22, 0.2));
  const arms = [-1, 1].map((s) => { const a = pivot(s * 0.29, 0.34, 0, rbox(0.13, 0.3, 0.15, 0.05, silver, 0, -0.13, 0)); body.add(a); return a; });
  // antennas on the back, crossed like the mascot's
  for (const s of [-1, 1]) { const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8), dark); ant.position.set(s * 0.12, 0.5, -0.22); ant.rotation.z = s * -0.45; body.add(ant); }
  // head
  const head = pivot(0, 0.42, 0); body.add(head);
  head.add(rbox(0.66, 0.54, 0.5, 0.16, silver, 0, 0.27, 0));
  const visor = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.32, 0.06, 4, 0.06), [dark, dark, dark, dark, visorMat, dark]);
  visor.position.set(0, 0.27, 0.235); head.add(visor);
  for (const s of [-1, 1]) {
    const ph = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20), grey); ph.rotation.z = Math.PI / 2; ph.position.set(s * 0.355, 0.27, 0); head.add(ph);
    const ear = new THREE.Group(); ear.position.set(s * 0.21, 0.5, -0.02);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 4), silver); outer.rotation.y = Math.PI / 4; outer.position.y = 0.1;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.15, 4), dark); inner.rotation.y = Math.PI / 4; inner.position.set(0, 0.08, 0.05);
    ear.add(outer, inner); ear.rotation.z = s * -0.18; head.add(ear);
  }
  /** pose: x, z, rotY, hop (dy), tilt (head roll), headYaw, armL/armR (raise), wave (phase), face, earK, walk */
  function pose(p = {}) {
    g.position.set(p.x ?? 0, p.dy ?? 0, p.z ?? 0); g.rotation.y = p.rotY ?? 0;
    const wk = p.walk ?? 0, sw = wk ? Math.sin(wk) * 0.5 : 0;
    legs[0].rotation.x = -sw; legs[1].rotation.x = sw;
    body.position.y = 0.26 + (wk ? Math.abs(Math.cos(wk)) * 0.03 : 0);
    head.rotation.set(p.headPitch ?? 0, p.headYaw ?? 0, p.tilt ?? 0);
    arms[0].rotation.x = -(p.armL ?? 0); arms[1].rotation.x = -(p.armR ?? 0);
    arms[0].rotation.z = -(p.armOutL ?? 0.1); arms[1].rotation.z = (p.armOutR ?? 0.1) + (p.wave != null ? 2.2 + wob(p.wave, 1) * 0.35 : 0);
    visorMat.map = faces[p.face || "code"];
  }
  pose({});
  return { g, pose, head, faces };
}

/** Mr Tan's phone: a black slab with a screen whose picture is set per frame from the app recordings. */
export function makePhone() {
  const g = new THREE.Group();
  const c = document.createElement("canvas"); c.width = 390; c.height = 844;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.165, 0.01, 4, 0.008), toon("#1b1825")));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.072, 0.156), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.0052; g.add(screen);
  function setScreen(img, glow = "#ffffff") {
    const x = c.getContext("2d");
    if (img) x.drawImage(img, 0, 0, c.width, c.height); else { x.fillStyle = glow; x.fillRect(0, 0, c.width, c.height); }
    tex.needsUpdate = true;
  }
  setScreen(null, "#1b1825");
  return { g, setScreen };
}
