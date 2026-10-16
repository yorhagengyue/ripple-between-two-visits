// The cast is the CodeBuddy mascot three times over (the owner's call, 10-15): a silver cat-eared robot with headphones,
// crossed antennas on the back and a black visor showing ">" in violet and "-" in green.
//   Mr Tan  = the mascot + a big white beard, moustache and bushy white brows (o.beard)
//   Dr Lim  = the mascot + a white coat and a stethoscope (o.coat, o.stetho), a little taller
//   Wei Ling = the mascot as it is, a little smaller
// Visor faces: code (> -), happy (^ ^), blink (- -), wow (o o), worry (> <), sleepy (_ _), love (hearts), sad (; ;),
// think (. .), off (dark). Each maker returns { g, pose(p) }; pose() takes plain numbers every frame.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toon, flat } from "./look.js";
import { canvasTex } from "./chars.js";
import { wob } from "./core.js";

const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const rbox = (w, h, d, r, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), m); o.position.set(x, y, z); return o; };
const pivot = (x, y, z, ...kids) => { const p = new THREE.Group(); p.position.set(x, y, z); kids.forEach((k) => p.add(k)); return p; };

export const VIOLET = "#9b6bff", GREEN = "#2ff0b0";

export function makeBot(o = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const S = o.scale ?? 1; inner.scale.setScalar(S);
  const silver = toon(o.body ?? "#dfe5f3"), dark = toon("#2a2633"), grey = toon("#8d93a3");
  const faces = {};
  const face = (name, draw) => (faces[name] = canvasTex(256, 160, (c, w, h) => { c.fillStyle = "#120f1a"; c.fillRect(0, 0, w, h); draw(c, w, h); }));
  const glyph = (c, txt, x, y, col, size = 92) => { c.font = `900 ${size}px "Arial Black", system-ui`; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = col; c.shadowBlur = 18; c.fillStyle = col; c.fillText(txt, x, y); c.shadowBlur = 0; };
  const V = VIOLET, G = GREEN;
  face("code", (c, w, h) => { glyph(c, ">", w * 0.32, h * 0.5, V); glyph(c, "-", w * 0.7, h * 0.47, G, 110); });
  face("happy", (c, w, h) => { glyph(c, "^", w * 0.32, h * 0.6, V, 100); glyph(c, "^", w * 0.68, h * 0.6, G, 100); });
  face("blink", (c, w, h) => { glyph(c, "-", w * 0.32, h * 0.47, V, 110); glyph(c, "-", w * 0.7, h * 0.47, G, 110); });
  face("wow", (c, w, h) => { glyph(c, "o", w * 0.32, h * 0.45, V, 100); glyph(c, "o", w * 0.68, h * 0.45, G, 100); });
  face("worry", (c, w, h) => { glyph(c, ">", w * 0.32, h * 0.5, V); glyph(c, "<", w * 0.68, h * 0.5, G); });
  face("sleepy", (c, w, h) => { glyph(c, "_", w * 0.32, h * 0.36, V, 100); glyph(c, "_", w * 0.68, h * 0.36, G, 100); });
  face("love", (c, w, h) => { glyph(c, "♥", w * 0.32, h * 0.52, "#ff6fb0", 84); glyph(c, "♥", w * 0.68, h * 0.52, "#ff6fb0", 84); });
  face("sad", (c, w, h) => { glyph(c, ";", w * 0.32, h * 0.5, V, 96); glyph(c, ";", w * 0.68, h * 0.5, G, 96); });
  face("think", (c, w, h) => { glyph(c, ".", w * 0.36, h * 0.28, V, 110); glyph(c, ".", w * 0.72, h * 0.28, G, 110); });
  face("off", () => {});
  const visorMat = new THREE.MeshBasicMaterial({ map: faces.code });

  // legs and body
  const legs = [-1, 1].map((s) => { const l = pivot(s * 0.13, 0.26, 0, rbox(0.17, 0.26, 0.2, 0.06, silver, 0, -0.12, 0)); inner.add(l); return l; });
  const body = pivot(0, 0.26, 0); inner.add(body);
  body.add(rbox(0.5, 0.42, 0.38, 0.12, silver, 0, 0.2, 0));
  body.add(rbox(0.22, 0.14, 0.02, 0.03, dark, 0, 0.22, 0.19)); // chest panel
  body.add(rbox(0.06, 0.06, 0.02, 0.02, flat(G), 0.05, 0.22, 0.2));
  const arms = [-1, 1].map((s) => { const a = pivot(s * 0.29, 0.34, 0, rbox(0.13, 0.3, 0.15, 0.05, silver, 0, -0.13, 0)); body.add(a); return a; });
  /** hand points at the end of each arm, for holding props: hands[0] = the bot's left, hands[1] = its right */
  const hands = [arms[1], arms[0]].map((a) => { const h = new THREE.Group(); h.position.set(0, -0.3, 0.02); a.add(h); return h; });
  // antennas on the back, crossed like the mascot's
  for (const s of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.7, 8), dark); ant.position.set(s * 0.12, 0.5, -0.22); ant.rotation.z = s * -0.45; body.add(ant);
  }
  if (o.coat) {
    const coat = toon(o.coat === true ? "#f6f4ee" : o.coat);
    body.add(rbox(0.56, 0.5, 0.42, 0.08, coat, 0, 0.16, -0.01));
    body.add(box(0.14, 0.36, 0.02, dark, 0, 0.25, 0.215)); // between the lapels
    for (const s of [-1, 1]) body.add(box(0.07, 0.07, 0.01, toon("#b9c3da"), s * 0.17, 0.06, 0.215)); // pockets
    arms.forEach((a) => a.add(rbox(0.16, 0.24, 0.18, 0.05, coat, 0, -0.08, 0)));
    body.add(box(0.11, 0.07, 0.01, flat("#ffffff"), -0.17, 0.33, 0.22)); // name badge
    body.add(box(0.07, 0.012, 0.012, flat("#5b8fd6"), -0.17, 0.335, 0.226));
  }
  if (o.stetho) {
    const tubeMat = toon("#2b2838");
    const tube = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 8, 28, Math.PI), tubeMat);
    tube.position.set(0, 0.42, 0.2); tube.rotation.z = Math.PI; body.add(tube);
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8), tubeMat); drop.position.set(0.15, 0.34, 0.215); body.add(drop);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 20), toon("#c9ced8")); bell.rotation.x = Math.PI / 2; bell.position.set(0.15, 0.25, 0.225); body.add(bell);
  }
  // head
  const head = pivot(0, 0.42, 0); body.add(head);
  head.add(rbox(0.66, 0.54, 0.5, 0.16, silver, 0, 0.27, 0));
  const visor = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.32, 0.06, 4, 0.06), [dark, dark, dark, dark, visorMat, dark]);
  visor.position.set(0, 0.27, 0.235); head.add(visor);
  const ears = [];
  for (const s of [-1, 1]) {
    const ph = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20), grey); ph.rotation.z = Math.PI / 2; ph.position.set(s * 0.355, 0.27, 0); head.add(ph);
    const ear = new THREE.Group(); ear.position.set(s * 0.21, 0.5, -0.02);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 4), silver); outer.rotation.y = Math.PI / 4; outer.position.y = 0.1;
    const innerEar = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.15, 4), dark); innerEar.rotation.y = Math.PI / 4; innerEar.position.set(0, 0.08, 0.05);
    ear.add(outer, innerEar); ear.rotation.z = s * -0.18; head.add(ear); ears.push(ear);
  }
  if (o.beard) {
    // a fluffy white beard: lumps that hang from under the visor down over the chest, a moustache on the visor's
    // lower rim, and bushy brows on its upper rim
    const white = toon("#ffffff"), white2 = toon("#eef0fb");
    const beard = new THREE.Group(); beard.position.set(0, 0.07, 0.21); beard.scale.setScalar(0.72); head.add(beard);
    const lumps = [[-0.2, 0.0, 0.1], [0.2, 0.0, 0.1], [-0.1, -0.04, 0.12], [0.1, -0.04, 0.12], [0, -0.02, 0.13],
      [-0.13, -0.15, 0.11], [0.13, -0.15, 0.11], [0, -0.17, 0.12], [-0.06, -0.28, 0.09], [0.06, -0.28, 0.09], [0, -0.37, 0.07]];
    lumps.forEach(([x, y, r], i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), i % 3 ? white : white2); b.position.set(x, y, 0.02 - Math.abs(y) * 0.1); b.scale.z = 0.75; beard.add(b); });
    const mo = new THREE.Group(); mo.position.set(0, 0.105, 0.27); head.add(mo);
    for (const s2 of [-1, 1]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), white); m.position.set(s2 * 0.075, 0, 0); m.scale.set(1.3, 0.6, 0.6); m.rotation.z = s2 * 0.25; mo.add(m); }
    for (const s2 of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), white); b.position.set(s2 * 0.14, 0.445, 0.25); b.scale.set(1.6, 0.7, 0.7); b.rotation.z = s2 * -0.15; head.add(b); }
  }
  /** pose: x, z, dy, rotY, walk (phase), sit 0..1, squash -1..1, lean, headYaw, headPitch, tilt, armL/armR (forward
   *  raise), armOutL/armOutR (sideways), wave (phase: the right arm waves), face, ear (perk 0..1), visorGlow */
  function pose(p = {}) {
    g.position.set(p.x ?? 0, p.dy ?? 0, p.z ?? 0); g.rotation.y = p.rotY ?? 0;
    const wk = p.walk ?? 0, sw = wk ? Math.sin(wk) * 0.5 : 0, sit = p.sit ?? 0;
    legs[0].rotation.x = -sw - sit * 1.45; legs[1].rotation.x = sw - sit * 1.45;
    body.position.y = 0.26 + (wk ? Math.abs(Math.cos(wk)) * 0.035 : 0) - sit * 0.12;
    const sq = p.squash ?? 0; inner.scale.set(S * (1 + sq * 0.12), S * (1 - sq * 0.15), S * (1 + sq * 0.12));
    body.rotation.x = p.lean ?? 0;
    head.rotation.set(p.headPitch ?? 0, p.headYaw ?? 0, p.tilt ?? 0);
    // arms[0] hangs at -x (the bot's RIGHT hand), arms[1] at +x (its LEFT hand); L/R below are the bot's own sides
    arms[1].rotation.x = -(p.armL ?? 0) + (wk ? sw * 0.8 : 0); arms[0].rotation.x = -(p.armR ?? 0) - (wk ? sw * 0.8 : 0);
    arms[1].rotation.z = (p.armOutL ?? 0.1); arms[0].rotation.z = -(p.armOutR ?? 0.1) - (p.wave != null ? 2.3 + wob(p.wave, 1.6) * 0.35 : 0);
    ears.forEach((e) => (e.rotation.x = -(p.ear ?? 0) * 0.35));
    visorMat.map = faces[p.face || "code"];
  }
  pose({});
  return { g, pose, head, body, arms, hands, faces };
}

export const makeTanBot = () => makeBot({ beard: true });
export const makeLimBot = () => makeBot({ coat: true, stetho: true, scale: 1.1 });
export const makeWeiBot = () => makeBot({ scale: 0.95 });
