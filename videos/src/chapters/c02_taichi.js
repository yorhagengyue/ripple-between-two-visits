// Chapter 2 · Tai chi at the void deck (film 15–27 s). 7:30 am under his block: four aunties and uncles and Mr Tan do
// a fan form in a row (WHOOSH on every sweep). Mr Tan is one beat late, hurries, catches up; everyone freezes on one
// leg; a little bird lands on his cat ear; he brings his fan toward the lens and snaps it shut (SNAP) into a whip pan
// to the right (the hand-off to c03).
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, backOut, clamp, lerp, hash } from "../core.js";
/** on twos (15 poses a second) like core.js's twos(), with a hair of slack so that t = frame / 30 - 15 never floors to
 *  the previous step through rounding (it did at 26.133 s, holding the half-shut fan a third frame) */
const twos = (t) => Math.floor(t * 15 + 1e-6) / 15;
import { timeCard, sfx, flashHit, INK } from "../overlay.js";
import { makeTanBot, makeBot } from "../bots.js";
import { buildVoidDeck, makeFan, makeBird, dress, shadowGroup, asShadow, SUN, DECK } from "../sets/c02_voiddeck.js";

const T0 = 15;
const deck = STAGE.set("c02.deck", buildVoidDeck());
const props = STAGE.set("c02.props", new THREE.Group()); // Mr Tan's fan and the bird, placed in world space each frame
const shadowSet = STAGE.set("c02.shadows", new THREE.Group()); // flat dark twins of the cast: their long morning shadows
const flatten = shadowGroup(); shadowSet.add(flatten);
/** a shadow twin: the same model and fan, posed with the same numbers every frame, squashed onto the floor */
function twinOf(make, fanR) { const t = make(); const f = makeFan(fanR); t.hands[1].add(f.g); flatten.add(t.g); asShadow(t.g); return { ...t, fan: f }; }
const tan = STAGE.need("tan", makeTanBot);
const radioObj = deck.userData.radio, catObj = deck.userData.cat;

const ROWZ = 1.0, TANX = 2.9;
const CREW = [
  { id: "c02.p1", body: "#ffa9c9", scale: 0.95, x: -2.9, face: "blink", dress: "visor", col: "#ff5fa8" },
  { id: "c02.p2", body: "#a6ecd0", scale: 1.0, x: -1.45, face: "happy", dress: "track", col: "#2fb8a8" },
  { id: "c02.p3", body: "#cdbcff", scale: 1.03, x: 0.0, face: "code", dress: "band", col: "#e2433f" },
  { id: "c02.p4", body: "#ffe39a", scale: 0.97, x: 1.45, face: "blink", dress: "hat", col: "#d9b36a" },
].map((m) => {
  const a = makeBot({ body: m.body, scale: m.scale });
  dress(a, m.dress, m.col);
  const fan = makeFan(0.3); a.hands[1].add(fan.g);
  STAGE.actor(m.id, a);
  const twin = twinOf(() => { const b = makeBot({ body: m.body, scale: m.scale }); dress(b, m.dress, m.col); return b; }, 0.3);
  return { ...m, a, fan, twin };
});
const tanHold = new THREE.Group(); tanHold.matrixAutoUpdate = false; props.add(tanHold);
const tanFan = makeFan(0.33); tanHold.add(tanFan.g);
const tanTwin = twinOf(makeTanBot, 0.33);
const bird = makeBird(); bird.g.scale.setScalar(1.25); props.add(bird.g);
props.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
const legsOf = (a) => [a.g.children[0].children[0], a.g.children[0].children[1]]; // [right, left]

// ---------------------------------------------------------------- the form: pose keys in chapter time τ = t - 15
const PI = Math.PI;
const P0 = { armL: 0.12, armR: 0.12, armOutL: 0.12, armOutR: 0.12, rotY: 0, lean: 0, headYaw: 0, headPitch: 0, tilt: 0, sq: 0, dy: 0, z: 0, open: 0, roll: 0, fyaw: 0, ox: 0, oy: 0, oz: 0, fs: 1, legL: 0 };
const P = (o) => ({ ...P0, ...o });
const READY = P({});
const RISE = P({ armL: 1.3, armR: 1.3, armOutL: 0.22, armOutR: 0.22, roll: -PI, headPitch: -0.06, sq: -0.06 });
const SINK = P({ armL: 0.7, armR: 0.8, armOutL: 0.3, armOutR: 0.3, roll: -PI, sq: 0.2, headPitch: 0.06 });
const WIND_R = P({ armL: 1.0, armR: 1.25, armOutL: 0.15, armOutR: -0.35, rotY: 0.14, roll: -3.93, sq: 0.24, headYaw: 0.12 });
const SWEEP_R = P({ armL: 1.3, armR: 0.5, armOutL: -0.25, armOutR: 1.4, rotY: -0.34, headYaw: -0.32, open: 1, roll: -2.15, sq: 0.04, lean: 0.04 });
const DRIFT_R = P({ ...SWEEP_R, armR: 0.62, armOutR: 1.3, armL: 1.15, rotY: -0.3, roll: -2.28, sq: 0.1 });
const WIND_L = P({ ...DRIFT_R, rotY: -0.46, armOutR: 1.55, armR: 0.35, sq: 0.2, headYaw: -0.42, roll: -2.0 });
const SWEEP_L = P({ armL: 0.4, armR: 1.35, armOutL: 1.3, armOutR: -0.45, rotY: 0.34, headYaw: 0.32, open: 1, roll: -4.03, sq: 0.04 });
const DRIFT_L = P({ ...SWEEP_L, armOutL: 1.2, armR: 1.25, rotY: 0.3, roll: -3.93, sq: 0.1 });
const WIND_R2 = P({ ...DRIFT_L, rotY: 0.46, armOutR: -0.62, sq: 0.2, headYaw: 0.42, roll: -3.75 });
const DIP = P({ armL: 0.55, armR: 0.65, armOutL: 0.45, armOutR: 0.35, sq: 0.3, open: 1, roll: -2.67, headPitch: 0.12 });
const UP = P({ armL: 1.35, armR: 0.25, armOutL: 0.35, armOutR: 2.25, headPitch: -0.1, open: 1, roll: -2.6, sq: -0.1, legL: 1.0, tilt: 0.04, headYaw: -0.12 });
const back = (k) => backOut(k, 2.2);
const ROW = [
  [0, READY], [0.3, READY], [1.3, RISE], [1.95, SINK],
  [2.2, WIND_R], [2.48, SWEEP_R, back], [4.1, DRIFT_R],
  [4.35, WIND_L], [4.62, SWEEP_L, back], [5.6, DRIFT_L],
  [5.85, WIND_R2], [6.12, SWEEP_R, back], [6.85, DRIFT_R],
  [7.1, DIP], [7.42, UP, back],
];
const HIT = { s1: 2.2, s2: 4.35, s3: 5.85, s4: 7.1 };
// Mr Tan runs the same form 0.42 s late until he hurries and catches up after the second sweep
const LAG = (τ) => kf(τ, [[0, 0.42], [4.95, 0.42], [5.55, 0]]);
const TAN_S1 = HIT.s1 + 0.42, TAN_S2 = HIT.s2 + 0.42;

function mix(a, b, k) { const o = {}; for (const key in a) o[key] = a[key] + (b[key] - a[key]) * k; return o; }
function track(τ, keys) {
  if (τ <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, p0] = keys[i], [t1, p1, fn] = keys[i + 1];
    if (τ <= t1) return mix(p0, p1, (fn || ease)(seg(τ, t0, t1)));
  }
  return keys[keys.length - 1][1];
}
/** a face timeline: [[τ, face], ...]; a "blink" frame is inserted for 0.08 s before every change */
function faceAt(τ, keys) {
  let f = keys[0][1];
  for (const [t0, name] of keys) { if (τ >= t0) f = name; if (τ >= t0 - 0.08 && τ < t0 && name !== f) return "blink"; }
  return f;
}

// ---------------------------------------------------------------- posing
function applyForm(a, fan, F, base, twin) {
  const p = { x: base.x, z: ROWZ + F.z, dy: F.dy, rotY: F.rotY, lean: F.lean, headYaw: F.headYaw, headPitch: F.headPitch, tilt: F.tilt,
    armL: F.armL, armR: F.armR, armOutL: F.armOutL, armOutR: F.armOutR, squash: F.sq, face: base.face, ear: base.ear ?? 0 };
  const actor = STAGE.pose(base.id, p);
  legsOf(actor)[1].rotation.x = -F.legL;
  if (fan) { fan.set(actor.arms[0], F.open, F.roll, F.fyaw, F.ox, F.oy, F.oz); fan.g.scale.setScalar(F.fs); }
  if (twin) { twin.pose(p); legsOf(twin)[1].rotation.x = -F.legL; twin.fan.set(twin.arms[0], F.open, F.roll, F.fyaw, F.ox, F.oy, F.oz); twin.fan.g.scale.setScalar(F.fs); }
  return actor;
}
function breathe(F, τ, i, k = 1) {
  return { ...F, sq: F.sq + wob(τ, 0.35, i) * 0.03 * k, tilt: F.tilt + wob(τ, 0.23, i * 2) * 0.03 * k, armOutL: F.armOutL + wob(τ, 0.3, i) * 0.04 * k };
}
function poseCrew(τ, o = {}) {
  CREW.forEach((m, i) => {
    let F = breathe(track(τ - i * 0.035, ROW), τ, i, τ > 7.5 ? 0.4 : 1);
    let face = m.face;
    if (τ > 7.3) face = faceAt(τ, [[0, m.face], [7.35 + i * 0.05, "happy"]]);
    else if (m.face !== "blink" && (τ + i * 0.9) % 2.7 < 0.09) face = "blink";
    if (m.id === "c02.p4" && τ > 4.6 && τ < 5.75) { // the side-eye at the late Mr Tan
      const k = kf(τ, [[4.62, 0], [4.8, 1], [5.45, 1], [5.7, 0]]);
      F = { ...F, headYaw: F.headYaw + 0.55 * k, tilt: F.tilt - 0.1 * k };
      face = faceAt(τ, [[0, "blink"], [4.78, "think"], [5.6, "blink"]]);
    }
    applyForm(m.a, m.fan, F, { id: m.id, x: m.x, face, ear: o.ear ?? 0 }, m.twin);
  });
}
/** Mr Tan: the form time-shifted, plus his own acting; extra overrides for the last shot */
function tanForm(τ) {
  const τt = τ - LAG(τ);
  let F = breathe(track(τt, ROW), τ, 7, τ > 7.5 ? 0.6 : 1);
  // he notices he is late: looks at the row, then hurries with a hop
  const look = kf(τ, [[4.4, 0], [4.55, 1], [4.75, 1], [4.85, 0]]);
  F = { ...F, headYaw: F.headYaw - 0.5 * look, headPitch: F.headPitch + 0.05 * look };
  const hop = kf(τ, [[4.72, 0], [4.86, 1], [5.02, 0]], easeOut);
  F = { ...F, dy: F.dy + hop * 0.06, sq: F.sq - hop * 0.25 + (τ > 5.02 && τ < 5.14 ? 0.25 : 0) };
  // the freeze: balancing on one leg, a little wobble
  if (τ > 7.42) F = { ...F, tilt: F.tilt + wob(τ, 0.55) * 0.035, rotY: F.rotY + wob(τ, 0.4, 1) * 0.03 };
  // his beard sticks out about 0.25 m further than the crew's chests: when his fan arm crosses in front (the winds and
  // the sweep to the left), carry the fan forward so the leaf passes in front of the beard, not through it
  F = { ...F, oz: F.oz + 0.17 * clamp(-F.armOutR / 0.35) };
  return F;
}
function tanFace(τ) {
  return faceAt(τ, [[0, "code"], [4.5, "wow"], [4.72, "worry"], [5.3, "code"], [6.2, "happy"], [7.25, "code"], [7.5, "happy"],
    [8.9, "wow"], [10.05, "happy"]]);
}
function poseTan(τ, F, face) {
  const a = applyForm(tan, null, F, { id: "tan", x: TANX + (F.x ?? 0), face, ear: F.ear ?? 0 }, tanTwin);
  tan.g.updateMatrixWorld(true);
  tanHold.matrix.copy(tan.hands[1].matrixWorld); tanHold.matrixWorldNeedsUpdate = true;
  tanFan.set(tan.arms[0], F.open, F.roll, F.fyaw, F.ox, F.oy, F.oz); tanFan.g.scale.setScalar(F.fs);
  return a;
}
// the bird: in flight on a curve, then perched on his left ear tip (head-local), then away
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
function earTip() { return tan.head.localToWorld(_v.set(0.25, 0.7, -0.02)).clone(); }
function poseBird(τ) {
  const LAND = 8.8, LEAVE = 10.35;
  bird.g.visible = τ > 7.95 && τ < 11.0;
  if (!bird.g.visible) return null;
  const E = earTip();
  let pos, rotY = -0.4, p = {};
  if (τ < LAND) {
    const u = easeOut(seg(τ, 8.0, LAND));
    const S = E.clone().add(_w.set(2.6, 1.5, 0.9)), C = E.clone().add(_w.set(0.7, 1.1, 0.9));
    pos = S.clone().multiplyScalar((1 - u) * (1 - u)).add(C.clone().multiplyScalar(2 * u * (1 - u))).add(E.clone().multiplyScalar(u * u));
    rotY = -PI / 2 - 0.4;
    p = { flap: u > 0.85 ? 1.1 : wob(τ, 7) * 1.0 + 0.2, tailK: u > 0.85 ? 1 : 0 };
  } else if (τ < LEAVE) {
    pos = E; const h = τ - LAND;
    rotY = kf(h, [[0, -1.9], [0.25, 0.25]]);
    p = { sq: h < 0.12 ? 0.5 * (1 - h / 0.12) : 0, flap: h < 0.15 ? 0.8 : h < 0.3 ? -0.4 : -1.2, tilt: kf(τ, [[9.2, 0], [9.35, 0.35], [9.7, 0.35], [9.85, -0.25], [10.1, 0]]),
      bob: τ > 9.92 && τ < 10.05 ? -0.3 : 0, chirp: τ > 9.92 && τ < 10.1 ? 1 : 0, tailK: (τ % 0.9) < 0.1 ? 1 : 0 };
  } else {
    const u = easeIn(seg(τ, LEAVE, 10.95));
    pos = E.clone().add(_w.set(-1.1 * u, 1.6 * u + 0.05, 0.9 * u));
    rotY = -0.9; p = { flap: wob(τ, 8) * 1.1 + 0.2, sq: -0.2 };
  }
  bird.g.position.copy(pos); bird.g.rotation.set(0, rotY, 0); bird.set(p);
  return pos;
}

// ---------------------------------------------------------------- 2D helpers
function scr(x, y, z) { STAGE.camera.updateMatrixWorld(); _w.set(x, y, z).project(STAGE.camera); return [(_w.x + 1) * 960, (1 - _w.y) * 540]; }
const CARD = (τ) => (c) => timeCard(c, "7:30 AM", "Tai chi at the void deck", seg(τ, 0.25, 0.7));
function notes(c, x, y, τ, k = 1) {
  c.save(); c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  for (let i = 0; i < 4; i++) {
    const ph = (τ * 0.5 + i / 4) % 1, a = Math.min(1, ph * 6) * (1 - ph) * k;
    if (a <= 0) continue;
    const px = x + Math.sin((τ + i) * 2.4) * 24 + (i - 1.5) * 18, py = y - ph * 190, s = 40 + (i % 2) * 10;
    c.globalAlpha = a; c.font = `900 ${s}px "Segoe UI Symbol", "Segoe UI", sans-serif`;
    c.lineWidth = 8; c.strokeStyle = INK; c.strokeText(i % 2 ? "♫" : "♪", px, py);
    c.fillStyle = ["#ffd94a", "#ff8fc8", "#7ff0d0", "#ffffff"][i]; c.fillText(i % 2 ? "♫" : "♪", px, py);
  }
  c.restore();
}
function motes(c, τ, n = 36, alpha = 0.6) {
  c.save(); c.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const x = ((hash(i) * 2200 + τ * (14 + hash(i * 3) * 22)) % 2200) - 140, y = ((hash(i * 7) * 1200 - τ * (8 + hash(i * 5) * 14)) % 1200 + 1200) % 1200 - 60;
    const r = 2 + hash(i * 11) * 4, a = alpha * (0.4 + 0.6 * Math.abs(Math.sin(τ * 1.3 + i)));
    const g = c.createRadialGradient(x, y, 0, x, y, r * 2.2); g.addColorStop(0, `rgba(255,236,190,${a})`); g.addColorStop(1, "rgba(255,236,190,0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.2, 0, 7); c.fill();
  }
  c.restore();
}
function rays(c, k = 1) { // soft slanting sunbeams from the upper right
  c.save(); c.globalCompositeOperation = "screen";
  for (let i = 0; i < 4; i++) {
    const x0 = 1500 + i * 190, w = 90 + hash(i * 3) * 120;
    const g = c.createLinearGradient(x0, 0, x0 - 900, 1080); g.addColorStop(0, `rgba(255,214,140,${0.22 * k})`); g.addColorStop(1, "rgba(255,214,140,0)");
    c.fillStyle = g; c.beginPath(); c.moveTo(x0, -20); c.lineTo(x0 + w, -20); c.lineTo(x0 + w - 1100, 1100); c.lineTo(x0 - 1100, 1100); c.closePath(); c.fill();
  }
  c.restore();
}
let scratch;
function whipSmear(c, k) { // fake motion blur for the whip pan: smear the frame sideways
  if (k <= 0) return;
  if (!scratch) { scratch = document.createElement("canvas"); scratch.width = 1920; scratch.height = 1080; }
  const s = scratch.getContext("2d"); s.globalAlpha = 1; s.drawImage(c.canvas, 0, 0);
  c.save();
  for (let i = 1; i <= 7; i++) { c.globalAlpha = 0.34; c.drawImage(scratch, -i * 60 * k, 0); }
  c.globalAlpha = 0.35 * k; c.fillStyle = "#fff0d0";
  for (let i = 0; i < 26; i++) { const y = hash(i * 7) * 1080, w = 300 + hash(i) * 900; c.fillRect(hash(i * 3) * 1920 - w / 2, y, w, 2 + hash(i * 5) * 5); }
  c.restore();
}
const LIGHT = () => STAGE.lights("day", { sky: "#ffd6a8", ground: "#4b2f8f", hemi: 0.85, key: "#ffc27a", keyI: 3.1, rim: "#8fa8ff", rimI: 0.5,
  bg: "#ffc98a", keyPos: [0.5 + SUN.x, 1.2 + SUN.y, 0.6 + SUN.z], keyTarget: [0.5, 1.2, 0.6] });
function setDeck(τ) {
  STAGE.show("c02.deck", "c02.props"); // real shadow maps are on now (look.js); the faked "c02.shadows" twins stay hidden
  LIGHT();
  radioObj.scale.setScalar(1 + Math.abs(wob(τ, 2.0)) * 0.03);
  catObj.userData.head.rotation.x = τ > 0.9 && τ < 1.4 ? wob(τ, 3) * 0.2 : 0;
  deck.userData.cloths.forEach((c, i) => (c.rotation.z = wob(τ, 0.6 + (i % 3) * 0.15, i) * 0.14));
}
const Y = (y) => clamp(y, 130, 860); // keep sound effects inside the frame and off the card
const X = (x, half = 150) => clamp(x, 30 + half, 1890 - half); // ...and off the left and right edges (half = the word's half width)
/** the camera, plus the one thing that depends on it: facade details cast shadows only while we are above the slab */
function cam(pos, tgt, fov, roll) { STAGE.cam(pos, tgt, fov, roll); deck.userData.facadeShadows(pos[1] > DECK.slab + 0.5); }
const whoosh = (c, x, y, age, size = 100, o = {}) => sfx(c, "WHOOSH!", x, y, size, age, { life: 0.95, burst: false, fill: ["#ffffff", "#ff8a6a"], ...o });

// ---------------------------------------------------------------- shots
// Poses and overlays step on twos (15 a second, like the reference); the camera moves on plain time.
// 2a · crane down from the upper floors (laundry poles) to the void deck: the row rises and opens their fans (WHOOSH)
shot("c02 crane", T0, T0 + 3.1, ({ t, ov }) => {
  const τ = t - T0, τp = twos(τ);
  setDeck(τp); poseCrew(τp); poseTan(τp, tanForm(τp), tanFace(τp)); poseBird(τp);
  const k = ease(seg(τ, 0, 3.1));
  const pos = [lerp(9.4, 2.9, k), lerp(9.2, 1.3, k), lerp(13.5, 7.7, k)];
  const tgt = [lerp(3.4, 0.6, k), lerp(6.4, 0.95, k), lerp(3.0, 0.8, k)];
  cam(pos, tgt, lerp(42, 36, k));
  const [rx, ry] = scr(-0.7, 0.75, 2.55), [cx, cy] = scr(0, 1.9, ROWZ), [tx, ty] = scr(TANX, 1.7, ROWZ);
  ov.push((c) => rays(c, 1 - k * 0.4));
  ov.push((c) => notes(c, rx, ry, τp, seg(τ, 1.6, 2.0)));
  ov.push((c) => whoosh(c, X(cx - 140, 170), Y(cy - 60), τp - HIT.s1 - 0.08, 110));
  ov.push((c) => whoosh(c, X(tx + 70, 90), Y(ty - 30), τp - TAN_S1 - 0.08, 54, { rot: 0.12 }));
  ov.push(CARD(τ));
  return { bloom: 0.55 };
});

// 2b · slow lateral dolly along the row toward Mr Tan: they sweep left (WHOOSH), he is a beat late (?! whoosh), then
//      the third sweep lands in sync
shot("c02 dolly", T0 + 3.1, T0 + 6.55, ({ t, lt, ov }) => {
  const τ = t - T0, τp = twos(τ);
  setDeck(τp); poseCrew(τp); poseTan(τp, tanForm(τp), tanFace(τp)); poseBird(τp);
  const k = easeOut(seg(lt, 0, 2.6)), k2 = ease(seg(lt, 0, 3.45));
  const x = lerp(-2.0, 2.45, k) + k2 * 0.25;
  cam([x, lerp(1.1, 1.0, k2), lerp(4.6, 4.15, k2)], [x - 0.2, 0.86, ROWZ], 37);
  const [rx, ry] = scr(-0.7, 0.75, 2.55), [ax, ay] = scr(1.45, 1.5, ROWZ), [hx, hy] = scr(TANX + 0.42, 1.78, ROWZ), [bx, by] = scr(2.2, 1.95, ROWZ);
  const [fx, fy] = scr(TANX + 0.8, 1.05, ROWZ); // beside him, chest high, clear of his face and of the "?!"
  ov.push((c) => notes(c, rx, ry, τp, 1 - seg(lt, 0.8, 1.2)));
  ov.push((c) => whoosh(c, X(ax - 160, 190), Y(ay - 40), τp - HIT.s2 - 0.06, 120));
  // "?!" just above his ear when he notices; his own late little whoosh by his fan (they no longer stack)
  ov.push((c) => sfx(c, "?!", X(hx + 40, 60), Y(hy - 20), 96, τp - 4.53, { life: 0.6, burst: false, fill: ["#ffffff", "#ffd94a"] }));
  ov.push((c) => whoosh(c, X(fx, 110), Y(fy), τp - TAN_S2 - 0.04, 64, { rot: 0.15 }));
  // the third sweep lands in sync: the big whoosh above the heads between the yellow auntie and him, inside the frame
  ov.push((c) => whoosh(c, X(bx, 250), Y(by - 40), τp - HIT.s3 - 0.06, 130, { burst: "#ffe37a", dots: "rgba(255,95,168,.3)" }));
  ov.push(CARD(τ));
  return { bloom: 0.5 };
});

// 2c · low hero angle on Mr Tan: the final sweep up into the one-leg freeze (WHOOSH); a little bird lands on his ear
shot("c02 hero", T0 + 6.55, T0 + 9.6, ({ t, lt, ov }) => {
  const τ = t - T0, τp = twos(τ);
  setDeck(τp); poseCrew(τp); poseTan(τp, tanForm(τp), tanFace(τp));
  const bp = poseBird(τp);
  const k = ease(seg(lt, 0, 3.05));
  const punch = τ > 7.42 ? Math.max(0, 1 - (τ - 7.42) / 0.35) : 0;
  cam([lerp(3.6, 3.32, k), lerp(0.24, 0.3, k), lerp(4.15, 3.65, k)], [lerp(2.5, 2.68, k), lerp(1.1, 1.16, k), ROWZ], lerp(46, 42, k) - punch * 4, 0.04);
  const [tx, ty] = scr(TANX - 0.6, 1.6, ROWZ);
  let bx = 0, by = 0; if (bp) [bx, by] = scr(bp.x, bp.y + 0.15, bp.z);
  ov.push((c) => motes(c, τp, 30, 0.55));
  ov.push((c) => whoosh(c, X(tx - 120, 270), Y(ty - 40), τp - HIT.s4 - 0.06, 140, { burst: "#ffe37a", dots: "rgba(255,95,168,.3)" }));
  ov.push((c) => sfx(c, "TWEET!", X(bx + 170, 130), Y(by - 60), 72, τp - 8.82, { life: 1.0, burst: false, fill: ["#fffbe0", "#ffd23f"] }));
  ov.push(CARD(τ));
  return { bloom: 0.55 };
});

// 2d · close on Mr Tan and the bird (CHIRP); the bird flies off; he steps in and holds the open fan up to the lens,
//      snaps it shut (flash, SNAP) to show his grin, and the camera whips to the right
const SNAP = 11.1;
const FWD = P({ armL: 0.4, armR: 1.8, armOutL: 0.3, armOutR: -0.3, open: 1, roll: -PI, lean: 0.06, sq: 0.04, z: 0.32, headPitch: -0.04, ox: 0.1, oy: 0.1, oz: 0.13, fs: 1.4 });
// after the snap the shut fan stands up beside his head like a pointer ("ta-da"), so it stays in frame next to the SNAP
const AFTER = P({ armL: 0.3, armR: 2.25, armOutL: 0.25, armOutR: 0.5, open: 0, roll: -PI + 0.12, lean: -0.05, sq: -0.1, z: 0.32, tilt: 0.14, headPitch: -0.08, fs: 1.4, oz: 0.04 });
shot("c02 snap", T0 + 9.6, T0 + 12, ({ t, lt, ov }) => {
  const τ = t - T0, τp = twos(τ);
  setDeck(τp); poseCrew(τp);
  let F = tanForm(τp);
  const kOut = ease(seg(τp, 10.38, 10.82));
  if (kOut > 0) F = { ...mix(F, FWD, kOut), legL: F.legL * (1 - ease(seg(τp, 10.38, 10.55))) };
  if (τp > 10.82) F = { ...FWD, armR: FWD.armR + (τp > 10.88 && τp < 10.99 ? wob(τp, 7) * 0.03 : 0) };
  // the snap, on twos: a small wind-up (11.0), the leaf half shut (11.07, under the first flash frame), shut at the lens
  // (11.13), then the closed fan flicks up beside his head and shows the grin
  if (τp > 10.97 && τp < 11.04) F = { ...F, roll: F.roll + 0.08, armR: F.armR - 0.06, sq: F.sq + 0.06 };
  F = { ...F, open: kf(τp, [[11.0, 1], [11.066, 0.35], [11.133, 0]]) };
  if (τp > 11.14) F = { ...mix({ ...FWD, open: 0 }, AFTER, backOut(seg(τp, 11.133, 11.333), 2.2)), legL: 0 };
  F = { ...F, ear: (τp > 10.36 && τp < 10.7) || (τp > 11.13 && τp < 11.4) ? 1 : 0 };
  poseTan(τp, F, τp >= 11.0 ? "happy" : tanFace(τp));
  const bp = poseBird(τp);
  // camera: close with the ears and the bird; a push as the fan comes at the lens; a punch on the snap; the whip
  const k = ease(seg(τ, 9.6, 11.0));
  const pos = [lerp(3.06, 2.92, k), lerp(1.2, 1.0, k), lerp(2.85, 2.6, k)];
  const punch = τ > SNAP ? Math.max(0, 1 - (τ - SNAP) / 0.25) : 0;
  const wk = easeIn(seg(τ, 11.48, 12.0));
  const yaw = wk * 1.5, look = [lerp(TANX + 0.05, TANX - 0.06, k), lerp(1.17, 0.97, k), ROWZ + 0.2];
  const dx = look[0] - pos[0], dz = look[2] - pos[2];
  const tgt = [pos[0] + dx * Math.cos(yaw) - dz * Math.sin(yaw), look[1], pos[2] + dx * Math.sin(yaw) + dz * Math.cos(yaw)];
  // SNAP sits by the shut fan (its tip, where it ends up beside his head), not on his face; it is placed with the camera
  // before the whip, so it stays put on screen and smears away with the frame instead of sliding with the fan
  cam(pos, look, 34 - punch * 3);
  _v.setFromMatrixPosition(tanHold.matrix); const [sx, sy] = scr(_v.x - 0.05, _v.y + 0.42, _v.z);
  const snapAt = [X(Math.min(sx - 170, 520), 220), Y(sy - 20)];
  cam(pos, tgt, 34 - punch * 3, -wk * 0.06);
  let bx = 0, by = 0; if (bp) [bx, by] = scr(bp.x, bp.y + 0.2, bp.z);
  ov.push((c) => motes(c, τp, 26, 0.5));
  ov.push((c) => sfx(c, "CHIRP", X(bx + 190, 120), Y(by - 30), 74, τp - 9.92, { life: 0.42, burst: false, fill: ["#fffbe0", "#ffd23f"], rot: -0.1 }));
  ov.push((c) => sfx(c, "FLAP FLAP", X(bx - 260, 170), Y(by - 120), 62, τp - 10.4, { life: 0.6, burst: false, fill: ["#ffffff", "#7fd8ff"] }));
  ov.push((c) => flashHit(c, τ - SNAP, "#fff3b0", 3));
  ov.push((c) => sfx(c, "SNAP!", snapAt[0], snapAt[1], 140, τp - SNAP - 0.1, { life: 1.0, burst: "#ff6fb0", dots: "rgba(255,255,255,.35)" }));
  ov.push((c) => whipSmear(c, wk));
  ov.push(CARD(τ));
  return { bloom: 0.55 };
});
