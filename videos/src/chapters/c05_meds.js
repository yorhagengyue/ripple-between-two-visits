// Chapter 5 · Four boxes (film 85–115 s). 8:30, his dining table with four medicine boxes in a row. He looks from box
// to box, puzzled ("1 or 2? Before or after food?"), photographs the Amlodipine box (SNAP!) and the real app reads it:
// how to take it, what it is for, then Dr Lim's own words, which he plays ("Over the years, high pressure damages the
// heart, the brain and the kidneys." "So you take it every day, even when you feel fine."). Happy, he takes one tablet (GULP), picks up his cap and swings it at the lens: a push into the cap's dark
// crown hands over to c06 out of black.
//
// Detail pass (v2): his arms are rigid blocks, so every hand contact is solved, not hoped for. `reach()` turns a world
// point into arm angles, `attach()` hangs a prop on the hand by its grip point, `leanFor()` leans him so a point on the
// table is in reach, and `viaRay()` brings a prop to his mouth (or a fingertip to a button) along the camera ray, so it
// touches on screen even where the short arm cannot touch in depth.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, clamp, lerp, backOut, hash, boil, twos } from "../core.js";
import { timeCard, sfx, bubble, thought, panel, ring, flashHit, INK } from "../overlay.js";
import { frame } from "../media.js";
import { buildTable, MEDS, BOX, makeCap, tablet, waterGlass, kopiCup, paintBoxFront } from "../sets/c05_table.js";
import { makeTanBot } from "../bots.js";
import { makePhone } from "../chars.js";
import { toon } from "../look.js";

// ---- clip windows: all the timing that changes when the recordings are retimed lives here -------------------------
const CLIP = "s3-his"; // story-time re-recording (8:30 am), 0.5 s earlier than old-s3-his after the photo
const WIN = {
  scan: { in: 7.6, out: 12.1 },    // the photo is taken at 7.6; the sheet reads the label 7.7–10.0; "Take one tablet every morning"
  what: { in: 14.1, out: 16.9 },   // swipe 14.2 down to "What it is for"
  words: { in: 18.5, out: 20.0 },  // swipe 18.6 down to "Your doctor's own words"
  play: { in: 21.35, out: 30.1, tap: 22.0, plays: 22.2 }, // tap Play 22.0; "Playing" from 22.2 (the card's quote is static)
};
const PLAY_BTN = [210, 848];     // the Play button in source pixels (585 x 1266)
const PANEL = { x: 1400, y: 540, w: 400, h: 866 };

// ---- the chapter's clock ---------------------------------------------------------------------------------------------
const T0 = 85, T1 = 115;
const SNAP = T0 + 6.6;           // the photo: SNAP! and the flash
const P0 = SNAP + 0.5;           // the panel opens on the cut after the flash and the word
const PW = {};
{ let acc = P0; for (const k of ["scan", "what", "words", "play"]) { const w = WIN[k]; PW[k] = { ...w, a: acc, b: acc + (w.out - w.in) }; acc = PW[k].b; } }
const PEND = PW.play.b;          // the panel closes; GULP and the cap follow
const filmOf = (k, src) => PW[k].a + (src - PW[k].in);
function srcAt(t) {
  for (const k of ["scan", "what", "words", "play"]) if (t < PW[k].b || k === "play") return clamp(PW[k].in + (t - PW[k].a), PW[k].in, PW[k].out);
}
const TAP = filmOf("play", WIN.play.tap), PLAYS = filmOf("play", WIN.play.plays);
// Dr Lim's recording, played from the phone just after the tap: two voiced lines in a row (audio/voices-v5.json), each
// with its own bubble from the phone. `at` is the film second of the voice's (and its bubble's) first frame, on a 1/30 s
// frame; the second follows the first's end by at least 0.2 s.
const fr30 = (s) => Math.round(s * 30) / 30;
const VA = { id: "c05-lim-a", dur: 4.14, at: fr30(PLAYS + 0.05), lines: ["Over the years, high pressure damages", "the heart, the brain and the kidneys."] };
const VB = { id: "c05-lim-b", dur: 2.8, at: fr30(VA.at + VA.dur + 0.26), lines: ["So you take it every day,", "even when you feel fine."] };
const VOICES = [VA, VB];
/** k for a voiced speech bubble at film time t (VOICE_SYNC.md): its first frame (t >= at) is the voice's first frame;
 *  up for the voice's whole duration, then gone after a pop-out of at most two frames */
function voiceK(t, v) {
  const e = t - v.at;
  if (e < -1e-4 || e > v.dur + 0.05 + 1e-4) return 0;
  return e <= v.dur ? Math.max(0.15, seg(e, 0, 0.15)) : lerp(0.12, 0.04, (e - v.dur) / 0.05);
}
/** the voice speaking at film time t: { age, left } (the phone's sound waves run only while a voice speaks), or null */
function speakingAt(t) {
  for (const v of VOICES) if (t >= v.at - 1e-4 && t < v.at + v.dur) return { age: t - v.at, left: v.at + v.dur - t };
  return null;
}

// ---- set, cast and hand props ------------------------------------------------------------------------------------------
const set = STAGE.set("c05.table", buildTable());
const U = set.userData;
STAGE.need("tan", makeTanBot);
// Props in his hands are this chapter's own actors (STAGE.reset hides them), placed every frame from the hand.
function prop(name, obj) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.add(obj);
  return STAGE.actor(name, { g, inner, pose() {} });
}
const phone = makePhone(); phone.g.scale.setScalar(1.6);
{ // a camera lens on the phone's back (the side the camera sees while he reads)
  const ring0 = new THREE.Mesh(new THREE.CircleGeometry(0.0085, 20), toon("#4a4560")); ring0.rotation.y = Math.PI; ring0.position.set(0.024, 0.064, -0.0056); phone.g.add(ring0);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.005, 16), new THREE.MeshBasicMaterial({ color: "#07060c" })); eye.rotation.y = Math.PI; eye.position.set(0.024, 0.064, -0.0058); phone.g.add(eye);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0032, 12), new THREE.MeshBasicMaterial({ color: "#fff6cf" })); led.rotation.y = Math.PI; led.position.set(0.024, 0.045, -0.0057); phone.g.add(led);
}
const P_PHONE = prop("c05.phone", phone.g);
const P_TAB = prop("c05.tablet", tablet());
const P_GLASS = prop("c05.glass", waterGlass());
const P_CUP = prop("c05.cup", kopiCup());
const CAP_S = 0.82;
const P_CAP = prop("c05.cap", (() => { const c = makeCap(); c.scale.setScalar(CAP_S); return c; })());
const L = 0, R = 1; // hands[0] = his left (screen right when he faces us), hands[1] = his right

// ---- rigid arms: solved contacts --------------------------------------------------------------------------------------
// An arm is a 0.3 m block hinged at the shoulder; the contact point (0, -TIP, CZ) in arm space sits just inside its
// rounded end, so a prop gripped there reads as held in the fist.
const TIP = 0.28, CZ = 0.02;
const armOf = (a, hand) => (hand === L ? a.arms[1] : a.arms[0]);
const V3 = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p));
const _m4 = new THREE.Matrix4();
/** orientation whose local +z is zDir and whose local +y leans toward yHint */
function basis(zDir, yHint) {
  const z = V3(zDir).normalize(), x = V3(yHint).cross(z).normalize(), y = z.clone().cross(x);
  return new THREE.Quaternion().setFromRotationMatrix(_m4.makeBasis(x, y, z));
}
const qE = (x, y, z, order = "XYZ") => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
const qAxis = (ax, ang) => new THREE.Quaternion().setFromAxisAngle(V3(ax).normalize(), ang);
/** world position of a point in an object's local space */
function wpos(obj, p = [0, 0, 0]) { obj.updateWorldMatrix(true, false); return obj.localToWorld(V3(p)); }
function armR(a, hand, tip) { const s = new THREE.Vector3(); armOf(a, hand).getWorldScale(s); return Math.hypot(tip, CZ) * (s.x + s.y + s.z) / 3; }
/** pose angles that put the arm's contact point on world point h (pulled onto the arm's sphere of reach) */
function reach(a, hand, h, tip = TIP) {
  a.g.updateMatrixWorld(true);
  const arm = armOf(a, hand);
  const w = a.body.worldToLocal(V3(h)).sub(arm.position);
  w.multiplyScalar(Math.hypot(tip, CZ) / Math.max(1e-6, w.length()));
  const th = Math.asin(clamp(w.x / tip, -1, 1));
  const al = Math.atan2(w.z, w.y) - Math.atan2(CZ, -tip * Math.cos(th));
  return hand === L ? { armL: -al, armOutL: th } : { armR: -al, armOutR: -th };
}
/** hang prop p on the hand: its local point `grip` at the arm's contact point, oriented Q (world) */
function attach(p, a, hand, Q, grip, tip = TIP) {
  a.g.updateMatrixWorld(true);
  const h = armOf(a, hand).localToWorld(new THREE.Vector3(0, -tip, CZ));
  p.g.quaternion.copy(Q);
  p.g.position.copy(h).sub(V3(grip).applyQuaternion(Q));
  p.inner.position.set(0, 0, 0); p.inner.rotation.set(0, 0, 0);
  p.g.visible = true;
  return p;
}
/** the body lean (closest to `pref`) that puts world point h exactly at arm's length from that shoulder */
function leanFor(a, hand, h, pref = 0, lo = -0.2, hi = 0.5, tip = TIP) {
  const H = V3(h), s = new THREE.Vector3(), keep = a.body.rotation.x, r = armR(a, hand, tip), N = 70;
  const fs = [];
  for (let i = 0; i <= N; i++) {
    const Lb = lo + ((hi - lo) * i) / N;
    a.body.rotation.x = Lb; a.g.updateMatrixWorld(true); armOf(a, hand).getWorldPosition(s);
    fs.push([Lb, s.distanceTo(H) - r]);
  }
  a.body.rotation.x = keep; a.g.updateMatrixWorld(true);
  // roots (where the point is exactly at arm's length), the one nearest the preferred lean; else the closest miss
  let best = null;
  for (let i = 0; i < N; i++) {
    const [l0, f0] = fs[i], [l1, f1] = fs[i + 1];
    if (f0 === 0 || Math.sign(f0) !== Math.sign(f1)) { const Lr = l0 + ((l1 - l0) * f0) / (f0 - f1); if (best === null || Math.abs(Lr - pref) < Math.abs(best - pref)) best = Lr; }
  }
  if (best === null) best = fs.reduce((m, q) => (Math.abs(q[1]) < Math.abs(m[1]) ? q : m))[0];
  return best;
}
/** the hand point that brings the prop's point `con` (gripped at `grip`, oriented Q) onto world point M as seen from the
 *  camera: on the camera ray through M, as near M as the rigid arm allows, never behind it. With no prop (grip = con =
 *  [0,0,0]) it is the fingertip itself. Returns { h, miss } (miss: how far short of M the ray solution sits, in metres). */
function viaRay(a, hand, Q, grip, con, M, tip = TIP) {
  a.g.updateMatrixWorld(true); STAGE.camera.updateMatrixWorld(true);
  const S = new THREE.Vector3(); armOf(a, hand).getWorldPosition(S);
  const r = armR(a, hand, tip), off = V3(con).sub(V3(grip)).applyQuaternion(Q);
  const K = S.clone().add(off), C = new THREE.Vector3(); STAGE.camera.getWorldPosition(C);
  const D = V3(M).sub(C), F = C.clone().sub(K);
  const A = D.dot(D), B = 2 * F.dot(D), Cc = F.dot(F) - r * r, disc = B * B - 4 * A * Cc;
  let P = null;
  if (disc >= 0) {
    const s1 = (-B - Math.sqrt(disc)) / (2 * A), s2 = (-B + Math.sqrt(disc)) / (2 * A);
    const s = s2 <= 1 ? s2 : s1 <= 1 ? s1 : null;
    if (s !== null) P = C.clone().addScaledVector(D, s);
  }
  if (!P) P = K.clone().addScaledVector(V3(M).sub(K).normalize(), r);
  const pp = P.clone().project(STAGE.camera), pm = V3(M).project(STAGE.camera);
  return { h: P.clone().sub(off), miss: P.distanceTo(V3(M)), px: Math.hypot((pp.x - pm.x) * 960, (pp.y - pm.y) * 540) };
}
const angLerp = (p, q, k) => Object.fromEntries(Object.keys(q).map((n) => [n, lerp(p[n] ?? q[n], q[n], k)]));

// ---- where things sit on the table (all within reach of his short arms) ----------------------------------------------
const KOPI = { x: 0.34, z: -0.26, yaw: 1.73 };          // saucer; the cup's handle turned toward his left hand
const GLASS_AT = [0.23, -0.4];
const AML = { x: -0.33, z: -0.1, yaw: -0.5 };            // laid flat for the photo, label toward the front-left camera
const AML_UP = new THREE.Vector3(-Math.sin(AML.yaw), 0, -Math.cos(AML.yaw)); // the label's "up" on the table: toward him
const PHONE_TABLE = { x: -0.3, z: -0.3, yaw: 0.35 };
const PHONE_DOWN = { x: -0.31, z: -0.335, yaw: 2.24 };   // where he puts it down after the recording, clear of the box
const CAP_AT = { x: 0.03, z: -0.3, yaw: -0.5 };
const MOUTH = [0, 0.05, 0.34];                            // head space: just under the moustache, in front of the beard
const VISOR = [0, 0.27, 0.27];

// the phone's viewfinder while he frames the Amlodipine label. The phone's top points away from him and the label's top
// points toward him, so the phone sees the label upside down, which the front camera, facing the phone, reads upright.
const VF = document.createElement("canvas"); VF.width = 390; VF.height = 844;
const VF_TURN = 0.58; // the phone is turned this much from the label's axis in the photo shot (SNAP_YAW)
{
  const c = VF.getContext("2d");
  c.fillStyle = "#0c0a12"; c.fillRect(0, 0, 390, 844);
  const g = c.createLinearGradient(0, 120, 0, 700); g.addColorStop(0, "#efe7dc"); g.addColorStop(1, "#d9cdbd");
  c.fillStyle = g; c.fillRect(0, 120, 390, 580);
  const lab = document.createElement("canvas"); lab.width = 512; lab.height = 337; paintBoxFront(lab.getContext("2d"), 512, 337, MEDS[0]);
  c.save(); c.translate(195, 410); c.rotate(Math.PI - 0.05 + VF_TURN); c.drawImage(lab, -180, -118, 360, 237); c.restore();
  c.strokeStyle = "#ffd94a"; c.lineWidth = 6;
  for (const [x, y, sx, sy] of [[24, 250, 1, 1], [366, 250, -1, 1], [24, 570, 1, -1], [366, 570, -1, -1]]) { c.beginPath(); c.moveTo(x, y + sy * 44); c.lineTo(x, y); c.lineTo(x + sx * 44, y); c.stroke(); }
  c.fillStyle = "#ffffff"; c.beginPath(); c.arc(195, 770, 44, 0, 7); c.fill(); c.strokeStyle = "#0c0a12"; c.lineWidth = 6; c.beginPath(); c.arc(195, 770, 36, 0, 7); c.stroke();
  c.fillStyle = "#ffd94a"; c.font = "800 26px 'Segoe UI'"; c.textAlign = "center"; c.fillText("PHOTO", 195, 712);
}

// ---- helpers ---------------------------------------------------------------------------------------------------------
const SEAT = { x: 0, z: -0.66, dy: 0.31, sit: 1 };
/** Mr Tan, seated by default, always breathing a little. */
function tan(lt, p = {}) {
  return STAGE.pose("tan", { ...SEAT, ...p, tilt: (p.tilt ?? 0) + wob(lt, 0.45) * 0.035, squash: (p.squash ?? 0) + wob(lt, 0.36) * 0.022 });
}
/** visor faces over time: [[t, face], ...]; a 0.08 s blink before every change */
function faceAt(lt, seq) {
  let f = seq[0][1];
  for (let i = 1; i < seq.length; i++) { const [ti, fi] = seq[i]; if (lt >= ti) f = fi; else { if (lt >= ti - 0.08) return "blink"; break; } }
  return f;
}
/** camera at pos, aimed so `subj` lands at horizontal screen position sx (-1 left .. 1 right) */
function camAt(pos, subj, fov, sx = 0, roll = 0) {
  const dx = subj[0] - pos[0], dy = subj[1] - pos[1], dz = subj[2] - pos[2];
  const a = Math.atan(-sx * Math.tan(((fov * Math.PI) / 180) / 2) * (1920 / 1080));
  const c = Math.cos(-a), s = Math.sin(-a);
  STAGE.cam(pos, [pos[0] + dx * c + dz * s, pos[1] + dy, pos[2] - dx * s + dz * c], fov, roll);
}
const _v = new THREE.Vector3();
/** screen position (px) of a point given in an object's local space */
function scr(obj, off = [0, 0, 0]) {
  STAGE.scene.updateMatrixWorld(true); STAGE.camera.updateMatrixWorld(true);
  _v.set(...off); obj.localToWorld(_v); _v.project(STAGE.camera);
  return [(_v.x + 1) * 960, (1 - _v.y) * 540];
}
const mouthOf = (a) => wpos(a.head, MOUTH);
/** the Amlodipine box laid flat with its label's top toward him (so the front camera reads it upright) */
function placeAml(b) {
  const { h, d } = BOX;
  b.rotation.set(-Math.PI / 2, 0, AML.yaw);
  b.position.set(AML.x + (h / 2) * Math.sin(AML.yaw), U.top + d / 2, AML.z + (h / 2) * Math.cos(AML.yaw));
}
/** dress the table for a shot: every prop that any shot moves is set here */
function dress(t, o = {}) {
  STAGE.show("c05.table");
  STAGE.lights("warm", { keyPos: [-2.4, 4.6, 4.0], keyTarget: [0, 0.6, -0.4], keyI: 2.0, hemi: 0.85, bg: "#ffd7a0", ...(o.lights || {}) });
  U.update(t);
  MEDS.forEach((m, i) => U.boxes[m.key].position.set(-0.33 + i * 0.22, U.top, -0.04));
  for (const b of Object.values(U.boxes)) b.rotation.set(0, 0, 0);
  if (o.amlFlat) placeAml(U.boxes.aml);
  const pd = o.phoneDown ? PHONE_DOWN : PHONE_TABLE;
  U.phone.position.set(pd.x, U.top, pd.z); U.phone.rotation.set(0, pd.yaw, 0);
  U.phone.visible = o.phoneOnTable ?? true;
  U.phoneScreen.color.set(o.phoneLit ? "#e9e4ff" : "#2a2340");
  U.kopi.position.set(KOPI.x, U.top, KOPI.z); U.kopiCup.rotation.set(0, KOPI.yaw, 0);
  U.glass.position.set(GLASS_AT[0], U.top, GLASS_AT[1]);
  U.glass.visible = o.glassOnTable ?? true;
  U.kopiCup.visible = o.cupOnTable ?? true;
  U.cap.position.set(CAP_AT.x, U.top + 0.005, CAP_AT.z); U.cap.rotation.set(0, CAP_AT.yaw, 0);
  U.cap.visible = o.capOnTable ?? true;
  U.strip.position.set(-0.3, U.top, 0.27);
  U.strip.userData.domes.forEach((d, i) => (d.visible = !(o.popped && i === 0)));
  U.chair.position.set(0, 0, o.chairZ ?? -0.74);
}
const CARD = (k) => (c) => timeCard(c, "8:30 AM", "Morning medicine", k);
const flashA = (t) => (t < SNAP ? 0 : Math.exp(-(t - SNAP) / 0.1));
function flash(c, a) { if (a < 0.01) return; c.save(); c.globalAlpha = Math.min(1, a); c.fillStyle = "#ffffff"; c.fillRect(0, 0, 1920, 1080); c.restore(); }
function black(c, a) { if (a <= 0) return; c.save(); c.globalAlpha = Math.min(1, a); c.fillStyle = "#000000"; c.fillRect(0, 0, 1920, 1080); c.restore(); }
let scratch = null;
/** fake motion blur along x for the whip pan: average of shifted copies of the painted frame */
function smear(c, px) {
  if (px < 2) return;
  if (!scratch) { scratch = document.createElement("canvas"); scratch.width = 1920; scratch.height = 1080; }
  const s = scratch.getContext("2d"); s.clearRect(0, 0, 1920, 1080); s.drawImage(c.canvas, 0, 0);
  const n = 10; c.save();
  for (let i = 1; i <= n; i++) { c.globalAlpha = 1 / (i + 1); c.drawImage(scratch, -px * (i / n - 0.5), 0); }
  c.restore();
}
/** sound waves from a playing phone (arcs to the left, away from the panel), while a voice speaks (s from speakingAt) */
function waves(c, x, y, s) {
  if (!s) return;
  const age = s.age, fade = Math.min(1, s.left / 0.15);
  for (let i = 0; i < 3; i++) {
    const k = (age * 1.3 + i / 3) % 1, r = 34 + k * 110;
    c.save(); c.globalAlpha = (1 - k) * Math.min(1, age * 4) * fade; c.lineCap = "round";
    for (const [col, lw] of [[INK, 13], ["#7dffcf", 7]]) { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.arc(x, y, r, Math.PI - 0.55, Math.PI + 0.55); c.stroke(); }
    c.restore();
  }
}
let img = null;
/** the app recording for film time t, also mirrored onto the 3D phone's screen */
function loadPanel(t, wait) {
  wait(frame(CLIP, srcAt(t)).then((i) => { img = i; if (i) phone.setScreen(i); }));
}
const drawPanel = (k, noPop = true) => (c) => panel(c, img, PANEL.x, PANEL.y, PANEL.w, PANEL.h, k, { noPop });
const playBtn = [PANEL.x - PANEL.w / 2 + (PLAY_BTN[0] * PANEL.w) / 585, PANEL.y - PANEL.h / 2 + (PLAY_BTN[1] * PANEL.h) / 1266];
// the Play button on the 3D phone's screen, in the phone prop's space (screen plane 0.072 x 0.156 at z 0.0052, scaled 1.6)
const PLAY_ON_PHONE = [((PLAY_BTN[0] / 585) - 0.5) * 0.072 * 1.6, (0.5 - PLAY_BTN[1] / 1266) * 0.156 * 1.6, 0.0056 * 1.6];
const PH_GRIP = [0, -0.132 + 0.026, 0];                   // the phone's bottom edge, 2.6 cm inside his fist

/** the thought bubble's inside (900 x 390): the four boxes, "1 or 2? Before or after food?" and question marks */
function puzzle(lt) {
  return (c, w, h) => {
    const bw = 164, bh = 86, gap = 12, x0 = (w - (4 * bw + 3 * gap)) / 2, y0 = 40;
    MEDS.forEach((m, i) => {
      const x = x0 + i * (bw + gap) + bw / 2, y = y0 + bh / 2 + wob(boil(lt) / 12 + i * 0.27, 1.4) * 3;
      c.save(); c.translate(x, y); c.rotate((hash(i * 7 + boil(lt)) - 0.5) * 0.05 + (i - 1.5) * 0.03);
      c.fillStyle = INK; c.fillRect(-bw / 2 + 5, -bh / 2 + 6, bw, bh);
      c.fillStyle = "#f7f6f1"; c.fillRect(-bw / 2, -bh / 2, bw, bh);
      c.fillStyle = m.col; c.fillRect(-bw / 2, -bh / 2, bw, bh * 0.48);
      c.fillStyle = "#ffffff"; c.textAlign = "center"; c.textBaseline = "middle";
      let s = 30; c.font = `900 ${s}px "Segoe UI", sans-serif`;
      const tw = c.measureText(m.name).width; if (tw > bw - 12) { s = Math.floor((s * (bw - 12)) / tw); c.font = `900 ${s}px "Segoe UI", sans-serif`; }
      c.fillText(m.name, 0, -bh / 2 + bh * 0.25);
      c.fillStyle = m.dark; c.font = `800 30px "Segoe UI", sans-serif`; c.fillText(m.dose, 0, bh * 0.25);
      c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(-bw / 2, -bh / 2, bw, bh);
      c.restore();
    });
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = INK;
    c.font = `76px "Bangers", Impact, sans-serif`; c.fillText("1 or 2?", w / 2, y0 + bh + 64);
    c.font = `800 42px "Segoe UI", sans-serif`; c.fillText("Before or after food?", w / 2, y0 + bh + 128);
    [[0.12, 0.66, 70], [0.88, 0.64, 76], [0.24, 0.56, 44], [0.76, 0.55, 48]].forEach(([fx, fy, s], i) => {
      c.save(); c.translate(w * fx, h * fy); c.rotate(wob(boil(lt) / 12 + i, 1.1) * 0.18 + (i % 2 ? 0.2 : -0.2));
      c.font = `${s}px "Bangers", Impact, sans-serif`; c.lineWidth = 7; c.strokeStyle = INK; c.strokeText("?", 0, 0); c.fillStyle = "#ff5fa8"; c.fillText("?", 0, 0);
      c.restore();
    });
  };
}

/** a shot whose poses and comic overlays run on twos (lt) while the camera runs on plain time (lc) */
const shot2 = (name, a, b, fn) => shot(name, a, b, (o) => fn({ ...o, lt: twos(o.lt), lc: o.lt }));

// ---- 5a · the whip settles on the table: four boxes in a row; he sips his kopi, sets it down (TOK), looks box to box
const CUP_GRIP = [0.074, 0.04, 0];           // the handle
const CUP_LIP = [0, 0.075, -0.05];           // the rim on his side
const cupQ = (u) => qAxis([1, 0, 0], -0.75 * u).multiply(qE(0, lerp(KOPI.yaw, 0.35, u), 0));
shot2("c05 table", T0, T0 + 2.8, ({ t, lt, lc, ov }) => {
  dress(t, { cupOnTable: lt > 1.12 });
  // sip, then down onto the saucer
  const cupUp = kf(lt, [[0, 0.82], [0.3, 1], [0.62, 1], [1.1, 0]]);
  const sipK = kf(lt, [[0.15, 0], [0.35, 1], [0.6, 1], [0.95, 0]]);
  const scan = kf(lt, [[1.15, 0.45], [1.45, 0.15], [1.75, -0.13], [2.05, -0.42], [2.45, -0.05]], (k) => backOut(k, 2.2));
  const base = {
    face: faceAt(lt, [[0, "happy"], [1.2, "code"], [1.9, "think"]]),
    headPitch: lerp(0.32, 0.12, sipK), headYaw: lt < 1.15 ? lerp(0.42, 0.45, seg(lt, 0.9, 1.15)) : scan, tilt: lt > 2.2 ? 0.16 * ease(seg(lt, 2.2, 2.6)) : 0.08 * sipK,
    squash: lt > 1.1 && lt < 1.22 ? 0.12 : 0,
  };
  // whip: the camera is still swinging right as the shot opens and settles with easeOut
  const w = 1 - easeOut(seg(lc, 0, 0.42));
  const k = ease(seg(lc, 0.3, 2.8));
  const pos = [lerp(0.42, 0.3, k), lerp(1.3, 1.22, k), lerp(2.35, 2.05, k)];
  STAGE.cam(pos, [-3.2 * w, 0.86 + w * 0.15, -0.45], 38, -w * 0.05);
  // the cup on the saucer, and the lean that brings the handle into reach
  const foot = new THREE.Vector3(KOPI.x, U.top + 0.012, KOPI.z);
  let a = tan(lt, base);
  const Ht = foot.clone().add(V3(CUP_GRIP).applyQuaternion(cupQ(0)));
  const leanT = leanFor(a, L, Ht, 0.25, -0.1, 0.5);
  if (lt < 1.12) {
    const Q = cupQ(cupUp), lean = lerp(leanT, 0.04, ease(clamp(cupUp * 1.4 - 0.2)));
    a = tan(lt, { ...base, lean });
    const Hm = viaRay(a, L, Q, CUP_GRIP, CUP_LIP, mouthOf(a)).h;
    const arm = reach(a, L, Ht.clone().lerp(Hm, cupUp));
    a = tan(lt, { ...base, lean, ...arm });
    attach(P_CUP, a, L, Q, CUP_GRIP);
  } else {
    // he lets go and settles back
    a = tan(lt, { ...base, lean: leanT });
    const held = reach(a, L, Ht), back = ease(seg(lt, 1.15, 1.5));
    a = tan(lt, { ...base, lean: lerp(leanT, 0, back), ...angLerp(held, { armL: 0.45, armOutL: 0.12 }, back) });
  }
  ov.push((c) => smear(c, 340 * w * w));
  const tok = scr(U.kopi, [0, 0.1, 0]);
  ov.push((c) => sfx(c, "SLURP", 1250, 300, 70, lt - 0.3, { life: 0.8, burst: false, fill: ["#ffe9c9", "#c9864a"] }));
  ov.push((c) => sfx(c, "TOK!", tok[0] + 90, tok[1] - 60, 74, lt - 1.12, { life: 0.8, burst: false, fill: ["#ffffff", "#ffd94a"] }));
  ov.push(CARD(seg(lt, 0.25, 0.7)));
  return { bloom: 0.38 };
});

// ---- 5b · low over the boxes: which one, how many, when? A thought bubble; think, then worry; an idea (!)
shot2("c05 puzzle", T0 + 2.8, T0 + 5.55, ({ t, lt, lc, ov }) => {
  dress(t);
  const scan = kf(lt, [[0, -0.1], [0.35, -0.42], [0.7, -0.14], [1.0, 0.14], [1.3, 0.42], [1.6, 0.05]], (k) => backOut(k, 2.4));
  const scratchK = kf(lt, [[1.3, 0], [1.55, 1], [2.05, 1], [2.25, 0]]);
  const idea = 2.2;
  const reachK = kf(lt, [[2.35, 0], [2.7, 1]]);
  const a = tan(lt, {
    face: faceAt(lt, [[0, "think"], [1.35, "worry"], [idea, "wow"]]),
    headYaw: lt < idea ? scan : lerp(0.05, -0.15, seg(lt, idea, 2.6)), headPitch: lt < idea ? 0.28 : lerp(0.0, 0.25, seg(lt, 2.4, 2.75)),
    tilt: lt < idea ? wob(lt, 1.1) * 0.12 : 0, ear: lt > idea ? 1 - seg(lt, 2.5, 2.75) : 0,
    armR: scratchK * 2.75 + reachK * 1.0, armOutR: scratchK * (0.55 + wob(lt, 5) * 0.12) - reachK * 0.35, lean: reachK * 0.18,
    squash: lt > idea && lt < idea + 0.15 ? -0.25 : 0, dy: SEAT.dy + (lt > idea && lt < idea + 0.25 ? Math.sin(seg(lt, idea, idea + 0.25) * Math.PI) * 0.05 : 0),
  });
  const k = ease(seg(lc, 0, 2.75));
  camAt([lerp(-0.02, -0.06, k), lerp(0.92, 0.95, k), lerp(1.24, 1.1, k)], [-0.02, lerp(0.88, 0.92, k), -0.3], 34, -0.24);
  const head = scr(a.head, [0.2, 0.45, 0]);
  const tk = lt < idea ? seg(lt, 0.12, 0.4) : 1 - seg(lt, idea, idea + 0.12);
  ov.push((c) => thought(c, 1452, 240, 860, 380, head[0] + 30, head[1], tk, puzzle(lt)));
  ov.push((c) => sfx(c, "HMM…", 300, 250, 74, lt - 0.45, { life: 1.3, burst: false, fill: ["#e9dcff", "#9b6bff"] }));
  ov.push((c) => flashHit(c, lt - idea, "#fff3b0", 2));
  ov.push((c) => sfx(c, "!", head[0] + 330, head[1] + 200, 120, lt - idea - 2 / 30, { life: 0.6, burst: "#ffd94a", dots: "rgba(255,95,168,.35)" }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

// ---- 5c · he holds the phone over the Amlodipine box (laid flat, label toward us): SNAP! with a white flash
/** the phone over the box: screen up and tipped toward him, top pointing away from him */
const SNAP_YAW = 0.8; // the phone turned so its bottom edge (in his fist) points back at his right shoulder
function snapQ(tip, yaw = SNAP_YAW) {
  const top = AML_UP.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return basis(top.clone().multiplyScalar(-Math.sin(tip)).add(new THREE.Vector3(0, Math.cos(tip), 0)), top);
}
shot2("c05 snap", T0 + 5.55, P0, ({ t, lt, lc, ov }) => {
  dress(t, { amlFlat: true, phoneOnTable: false });
  const hit = SNAP - (T0 + 5.55);
  // the phone comes up from the table edge, overshoots, settles over the label; a tiny jolt on the shutter
  const up = kf(lt, [[0, 0], [0.5, 1]], (k) => backOut(k, 1.5));
  const jolt = lt > hit && lt < hit + 0.12 ? 0.012 : 0;
  const above = new THREE.Vector3(AML.x - 0.07, U.top + BOX.d + 0.11 - jolt, AML.z).addScaledVector(AML_UP, 0.17);
  const start = new THREE.Vector3(-0.3, U.top + 0.1, -0.36);
  const centre = start.lerp(above, up);
  const Q = snapQ(lerp(0.75, 0.4, clamp(up)));
  const base = {
    face: lt < hit ? (lt < 0.45 ? "code" : "wow") : lt < hit + 0.2 ? "blink" : "happy",
    headPitch: 0.22, headYaw: -0.25, armL: 0.35, armOutL: 0.12, squash: lt > hit && lt < hit + 0.12 ? 0.16 : 0, ear: lt > hit ? 1 : 0.3,
  };
  let a = tan(lt, base);
  const H = centre.clone().add(V3(PH_GRIP).applyQuaternion(Q));
  const lean = leanFor(a, R, H, 0.2, -0.1, 0.42);
  a = tan(lt, { ...base, lean });
  a = tan(lt, { ...base, lean, ...reach(a, R, H) });
  phone.setScreen(VF);
  attach(P_PHONE, a, R, Q, PH_GRIP);
  // an insert from in front and above, looking along the label's "up": the label reads upright and big (the box about
  // 520 px wide), the phone and his fist just beyond it at the top of the frame; a slow push and a punch on the shutter
  const k = ease(seg(lc, 0, 1.55));
  const el = 1.03, fov = 26, dist = lerp(0.95, 0.87, k) - 0.04 * kf(lc, [[hit, 0], [hit + 0.12, 1], [hit + 0.45, 0.7]], easeOut);
  const box = new THREE.Vector3(AML.x, U.top + BOX.d, AML.z);
  const camUp = AML_UP.clone().multiplyScalar(Math.sin(el)).add(new THREE.Vector3(0, Math.cos(el), 0));
  const tgt = box.clone().addScaledVector(camUp, 0.07);
  const cp = tgt.clone().addScaledVector(AML_UP, -dist * Math.cos(el)).add(new THREE.Vector3(0, dist * Math.sin(el), 0));
  STAGE.cam([cp.x, cp.y, cp.z], [tgt.x, tgt.y, tgt.z], fov);
  ov.push((c) => flash(c, flashA(t)));
  ov.push((c) => sfx(c, "SNAP!", 1420, 250, 150, lt - hit - 2 / 30, { life: 0.9, burst: "#ff5fa8", dots: "rgba(255,255,255,.4)", fill: ["#ffffff", "#ffd94a"] }));
  ov.push(CARD(1));
  return { bloom: 0.4 + flashA(t) * 0.8 };
});

// the panel shots: he reads with the phone up in his right hand, its screen toward his visor; the 3D on the left, the
// app on the right
// (set the camera first: the phone turns its screen toward his visor and its back toward the lens, so it never shows
// edge-on as a thin stick)
function reader(lt, p = {}, back = 1) {
  const q = { armR: 1.38, armOutR: 0.22, headPitch: 0.24, headYaw: -0.42, armL: 0.3, armOutL: 0.12, lean: 0, ...p };
  const a = tan(lt, q);
  const hnd = armOf(a, R).localToWorld(new THREE.Vector3(0, -TIP, CZ));
  const mid = hnd.clone().add(new THREE.Vector3(0, 0.12, 0));
  const toEye = wpos(a.head, VISOR).sub(mid).normalize();
  const toCam = STAGE.camera.position.clone().sub(mid).normalize();
  attach(P_PHONE, a, R, basis(toEye.addScaledVector(toCam, -back), [0, 1, 0]), PH_GRIP);
  return a;
}

// ---- 5d · the app reads the label: "Reading the box…", then "Take one tablet every morning" (DING!)
shot2("c05 reading", P0, PW.scan.b, ({ t, lt, lc, ov, wait }) => {
  dress(t, { amlFlat: true, phoneOnTable: false });
  loadPanel(t, wait);
  const k = ease(seg(lc, 0, 4.75));
  camAt([lerp(-0.6, -0.48, k), lerp(1.3, 1.26, k), lerp(1.95, 1.7, k)], [0, 1.02, -0.6], 34, -0.42);
  const read = filmOf("scan", 10.0) - P0;
  const nod = lt > read + 0.35 ? Math.max(0, Math.sin((lt - read - 0.35) * 9)) * 0.14 * (1 - seg(lt, read + 1.2, read + 1.5)) : 0;
  const a = reader(lt, {
    face: faceAt(lt, [[0, "blink"], [0.3, "think"], [read, "wow"], [read + 0.35, "happy"]]),
    headPitch: 0.24 + nod + (lt < read ? wob(lt, 1.6) * 0.03 : 0), ear: lt > read ? 1 - seg(lt, read + 0.5, read + 1.2) : 0,
    squash: lt > read && lt < read + 0.12 ? -0.2 : 0,
  });
  const hd = scr(a.head, [-0.1, 0.55, 0]);
  ov.push((c) => flash(c, flashA(t)));
  ov.push(drawPanel(seg(lt, 0, 0.3), false));
  ov.push((c) => sfx(c, "DING!", hd[0] - 200, hd[1] - 40, 96, lt - read, { life: 1.0, burst: "#7dffcf", dots: "rgba(255,255,255,.45)" }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

// ---- 5e · what it is for: he pats his chest, "OHH~"
shot2("c05 what for", PW.what.a, PW.what.b, ({ t, lt, lc, ov, wait }) => {
  dress(t, { amlFlat: true, phoneOnTable: false });
  loadPanel(t, wait);
  const k = ease(seg(lc, 0, 2.9));
  camAt([lerp(0.78, 0.66, k), lerp(1.2, 1.22, k), lerp(1.22, 1.08, k)], [-0.1, 1.02, -0.6], 30, -0.5);
  const pat = kf(lt, [[0.9, 0], [1.15, 1], [2.2, 1], [2.45, 0]]);
  const a = reader(lt, {
    face: faceAt(lt, [[0, "code"], [0.95, "wow"], [1.5, "happy"]]),
    armL: 0.3 + pat * 0.75, armOutL: 0.12 - pat * 0.62, lean: -pat * 0.05,
    headPitch: 0.2 + Math.max(0, Math.sin(lt * 7)) * 0.05 * pat, ear: pat * 0.6,
  });
  // the patting hand bounces
  a.arms[1].rotation.x -= pat * Math.max(0, Math.sin(lt * 14)) * 0.12;
  const hd = scr(a.head, [0, 0.5, 0]);
  ov.push(drawPanel(1));
  ov.push((c) => sfx(c, "OHH~", hd[0] - 240, hd[1] - 30, 80, lt - 1.0, { life: 1.4, burst: false, fill: ["#ffffff", "#ffb347"] }));
  ov.push((c) => sfx(c, "pat pat", 230, 640, 56, lt - 1.2, { life: 1.0, burst: false, fill: ["#ffe9c9", "#ff9a2e"] }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

// ---- 5f · the doctor's own words: he leans in, ears up (!)
shot2("c05 words", PW.words.a, PW.words.b, ({ t, lt, lc, ov, wait }) => {
  dress(t, { amlFlat: true, phoneOnTable: false });
  loadPanel(t, wait);
  const hit = filmOf("words", 19.1) - PW.words.a;
  const k = easeOut(seg(lc, hit, hit + 0.18));
  camAt([lerp(-0.32, -0.26, k), lerp(1.24, 1.21, k), lerp(1.2, 0.95, k)], [0, 1.1, -0.5], 32, -0.4);
  const lean = kf(lt, [[hit - 0.25, 0], [hit - 0.1, -0.06], [hit + 0.15, 0.2]], (k) => backOut(k, 1.8));
  const a = reader(lt, { face: faceAt(lt, [[0, "code"], [hit, "wow"]]), lean, ear: lt > hit ? 1 : 0, headPitch: 0.18, squash: lt > hit && lt < hit + 0.12 ? -0.18 : 0 });
  const hd = scr(a.head, [-0.1, 0.55, 0]);
  ov.push(drawPanel(1));
  ov.push((c) => sfx(c, "!", hd[0] - 230, hd[1] - 20, 110, lt - hit, { life: 0.8, burst: "#ffd94a" }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

/** Dr Lim's bubble for voice v at (x, y), its tail on the phone (the first line runs on across the cut into 5h) */
const limBubble = (t, v, x, y, tx, ty, o = {}) => (c) => bubble(c, o.lines ?? v.lines, x, y, tx, ty, voiceK(t, v), { size: o.size ?? 34, voice: v.id });
// in the close play shot his head fills the upper left, so there the first line sits low on the left, under the phone's
// sound waves, broken into four short lines
const VA_LOW = ["Over the years,", "high pressure damages", "the heart, the brain", "and the kidneys."];

// ---- 5g · he taps Play with his thumb (TAP: the phone dips in his fist); the phone plays Dr Lim's recording.
// (His arms are rigid 0.3 m blocks with the shoulders 0.58 m apart: the two hands cannot meet in front of his chest, so
// a poke from the other hand would have to pass through the phone or miss it. A one-handed thumb tap reads cleanly.)
shot2("c05 play", PW.play.a, PW.play.a + 4.0, ({ t, lt, lc, ov, wait }) => {
  dress(t, { amlFlat: true, phoneOnTable: false });
  loadPanel(t, wait);
  const k = ease(seg(lc, 0, 4.0));
  camAt([lerp(-0.88, -0.74, k), lerp(0.98, 1.03, k), lerp(1.3, 1.46, k)], [-0.05, 1.0, -0.6], 36, -0.4);
  const tap = TAP - PW.play.a, plays = PLAYS - PW.play.a;
  const dip = kf(lt, [[tap - 0.2, 0], [tap - 0.07, -0.35], [tap, 1], [tap + 0.1, 1], [tap + 0.35, 0]]);
  const a = reader(lt, {
    armR: 1.42 - dip * 0.07, armOutR: -0.12, lean: 0.12 * kf(lt, [[tap - 0.3, 0], [tap, 1], [tap + 0.5, 0]]),
    face: faceAt(lt, [[0, "code"], [tap - 0.05, "wow"], [tap + 0.45, "think"], [tap + 1.9, "think"]]),
    headYaw: lerp(-0.22, -0.4, seg(lt, plays, plays + 0.6)) + wob(lt, 0.4) * 0.05 * seg(lt, plays + 0.6, plays + 1.2),
    tilt: 0.2 * ease(seg(lt, plays, plays + 0.8)) + wob(lt, 0.33, 1) * 0.04,
    ear: ease(seg(lt, plays, plays + 0.5)) - 0.6 * Math.sin(Math.PI * seg(lt, tap + 1.3, tap + 1.55)),
    headPitch: 0.15 + Math.max(0, Math.sin((lt - tap - 2.2) * 6)) * 0.06 * (lt > tap + 2.2 && lt < tap + 3.0 ? 1 : 0), squash: dip > 0.5 ? -0.06 : 0,
  });
  const ph = scr(P_PHONE.g, [0, 0, 0]);
  const top = scr(P_PHONE.g, [0, 0.12, 0]);
  ov.push(drawPanel(1));
  ov.push((c) => ring(c, playBtn[0], playBtn[1], 60, lt - tap, { life: 0.6 }));
  ov.push((c) => sfx(c, "TAP!", top[0] - 120, top[1] - 40, 80, lt - tap, { life: 0.7, burst: false, fill: ["#ffffff", "#ffd94a"] }));
  ov.push((c) => waves(c, ph[0] - 60, ph[1] - 20, speakingAt(t)));
  ov.push(limBubble(t, VA, 235, 845, ph[0] - 25, ph[1] - 10, { lines: VA_LOW, size: 32 }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

// ---- 5h · Dr Lim's voice from the phone runs on ("Over the years …"), then "So you take it every day, even when you
// feel fine." His visor: happy on the last words.
shot2("c05 listen", PW.play.a + 4.0, PEND, ({ t, lt, lc, ov, wait }) => {
  dress(t, { amlFlat: true, phoneOnTable: false });
  loadPanel(t, wait);
  const k = ease(seg(lc, 0, PEND - PW.play.a - 4.0));
  camAt([lerp(-0.55, -0.42, k), lerp(1.27, 1.24, k), lerp(2.05, 1.85, k)], [-0.05, 1.0, -0.6], 34, -0.08);
  const a0 = PW.play.a + 4.0, joy = VB.at + VB.dur - 0.35 - a0; // he lights up on "even when you feel fine"
  const nod = lt > joy + 0.2 ? Math.max(0, Math.sin((lt - joy - 0.2) * 6)) * 0.12 * (1 - seg(lt, joy + 1.8, joy + 2.2)) : 0;
  const hearB = lt > VB.at - a0 ? Math.max(0, Math.sin((lt - (VB.at - a0)) * 5)) * 0.05 * (lt < joy ? 1 : 0) : 0; // small nods while he listens
  const a = reader(lt, {
    face: faceAt(lt, [[0, "think"], [0.62, "think"], [joy, "happy"]]), armR: 1.5, armOutR: 0.5, headYaw: -0.5 + wob(lt, 0.42) * 0.05, tilt: 0.2 - 0.12 * seg(lt, joy, joy + 0.4) + wob(lt, 0.3, 2) * 0.03,
    headPitch: 0.12 + nod + hearB, ear: 1, squash: lt > joy && lt < joy + 0.15 ? -0.15 : 0, armL: 0.3 + 0.35 * ease(seg(lt, joy, joy + 0.5)), armOutL: 0.12,
  });
  const ph = scr(P_PHONE.g, [0, 0.06, 0]);
  const top = scr(P_PHONE.g, [0, 0.12, 0]);
  ov.push(drawPanel(1));
  ov.push((c) => waves(c, ph[0] - 50, ph[1], speakingAt(t)));
  ov.push(limBubble(t, VA, 400, 250, top[0] - 20, top[1] - 30));
  ov.push(limBubble(t, VB, 400, 250, top[0] - 20, top[1] - 30));
  // his "AHH~" lands just after Dr Lim's last word, never under it
  ov.push((c) => sfx(c, "AHH~", 300, 760, 78, lt - (VB.at + VB.dur + 0.2 - a0), { life: 1.0, burst: false, fill: ["#ffffff", "#7dffcf"] }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

// ---- 5i · one tablet, a glass of water: GULP
const TAB_GRIP = [0, -0.011, 0], TAB_LIP = [0, 0.016, 0];
const GL_GRIP = [0.04, 0.035, 0], GL_LIP = [0, 0.12, -0.04];
const glassQ = (tip) => qAxis([1, 0, 0], -tip);
shot2("c05 gulp", PEND, PEND + 2.7, ({ t, lt, lc, ov }) => {
  dress(t, { amlFlat: true, glassOnTable: lt > 2.25, popped: true, phoneLit: true, phoneDown: true });
  const toMouth = kf(lt, [[0, 0.35], [0.35, 1], [0.55, 1], [0.8, 0]]);
  const drink = kf(lt, [[0, 0.08], [0.55, 0.15], [0.95, 1], [1.55, 1], [2.2, 0]]);
  const gulp = 1.3;
  const tipUp = kf(lt, [[0.8, 0.55], [1.15, 1.05], [1.5, 1.05], [1.75, 0.6]]);
  const base = {
    face: faceAt(lt, [[0, "code"], [0.42, "blink"], [0.9, "happy"]]),
    headYaw: lt < 0.62 ? lerp(-0.1, -0.42, kf(lt, [[0, 0], [0.3, 1], [0.5, 1], [0.7, 0]])) : 0.22 * kf(lt, [[0.62, 0], [0.9, 1], [1.6, 1], [2.0, 0]]),
    headPitch: lt < 0.62 ? lerp(0.12, 0.5, kf(lt, [[0, 0], [0.3, 1], [0.5, 1], [0.7, 0]])) : lerp(0.12, 0.22, kf(lt, [[0.62, 0], [0.95, 1], [1.6, 1], [2.0, 0]])),
    lean: -0.14 * kf(lt, [[1.0, 0], [1.25, 1], [1.5, 1], [1.8, 0]]),
    squash: lt > gulp && lt < gulp + 0.2 ? 0.28 : 0, ear: lt > gulp ? 1 - seg(lt, gulp + 0.3, gulp + 0.9) : 0,
  };
  const k = ease(seg(lc, 0, 2.7));
  STAGE.cam([lerp(-0.5, -0.42, k), lerp(1.22, 1.2, k), lerp(1.3, 1.1, k)], [0.02, lerp(1.0, 1.05, k), -0.6], 34);
  let a = tan(lt, base);
  const M = mouthOf(a);
  // the tablet: from low by the table edge up to his mouth, then gone (POP)
  const tabQ = qE(0, -0.3, 0);
  const tabFar = new THREE.Vector3(-0.32, U.top + 0.1, -0.42);
  const Htab = tabFar.clone().lerp(viaRay(a, R, tabQ, TAB_GRIP, TAB_LIP, M).h, toMouth);
  const armTab = reach(a, R, Htab);
  const rArm = lt < 0.55 ? armTab : angLerp(armTab, { armR: 0.45, armOutR: 0.1 }, ease(seg(lt, 0.55, 0.85)));
  // the glass: up from the table to his mouth, tipped up for the gulp, back down onto the table
  const gQ = glassQ(lerp(0, tipUp, ease(clamp(drink * 1.25))));
  const gFoot = new THREE.Vector3(GLASS_AT[0], U.top, GLASS_AT[1]);
  const Hg0 = gFoot.clone().add(V3(GL_GRIP).applyQuaternion(glassQ(0)));
  const leanG = leanFor(a, L, Hg0, 0.15, -0.1, 0.45);
  const lowK = 1 - ease(clamp(drink * 3));
  a = tan(lt, { ...base, ...rArm, lean: base.lean + leanG * lowK });
  const vrG = viaRay(a, L, gQ, GL_GRIP, GL_LIP, mouthOf(a));
  const Hg = Hg0.clone().lerp(vrG.h, ease(drink));
  const lArm = lt < 2.25 ? reach(a, L, Hg) : angLerp(reach(a, L, Hg0), { armL: 0.45, armOutL: 0.12 }, ease(seg(lt, 2.25, 2.6)));
  a = tan(lt, { ...base, ...rArm, ...lArm, lean: base.lean + leanG * lowK });
  if (lt < 0.5) attach(P_TAB, a, R, tabQ, TAB_GRIP);
  if (lt < 2.25) attach(P_GLASS, a, L, gQ, GL_GRIP);
  const hd = scr(a.head, [0, 0.4, 0]);
  ov.push((c) => sfx(c, "POP", hd[0] - 260, hd[1] + 120, 64, lt - 0.45, { life: 0.7, burst: false, fill: ["#ffffff", "#ff9a2e"] }));
  ov.push((c) => flashHit(c, lt - gulp, "#bfeaff", 3));
  ov.push((c) => sfx(c, "GULP!", hd[0] + 400, hd[1] - 20, 140, lt - gulp - 2 / 30, { life: 1.2, burst: "#7dd3ff", dots: "rgba(255,255,255,.4)" }));
  ov.push(CARD(1));
  return { bloom: 0.38 };
});

// ---- 5j · his cap: he grabs it by the rim (FWIP), stands (HUP!), swings it at the lens; push into the dark crown → black
shot2("c05 cap", PEND + 2.7, T1, ({ t, lt, lc, ov }) => {
  const grab = 0.38, up = 0.6, swing = 1.0;
  const standK = easeOut(seg(lt, up, up + 0.3));
  dress(t, { amlFlat: true, popped: true, phoneLit: true, phoneDown: true, capOnTable: lt < grab, chairZ: lerp(-0.74, -1.0, easeOut(seg(lt, up, up + 0.35))) });
  const lift = lt < swing - 0.1 ? 0 : backOut(seg(lt, swing - 0.1, swing + 0.3), 1.8);
  const rise = ease(seg(lt, grab, swing - 0.1));
  const base = {
    sit: 1 - standK, dy: lerp(SEAT.dy, 0, standK) + (lt > up && lt < up + 0.3 ? Math.sin(seg(lt, up, up + 0.3) * Math.PI) * 0.06 : 0),
    z: lerp(SEAT.z, -0.74, standK), rotY: 0.26 * ease(seg(lt, swing - 0.2, swing + 0.3)),
    face: faceAt(lt, [[0, "happy"], [grab, "wow"], [up + 0.3, "happy"]]),
    armL: 0.3 + standK * 0.4, armOutL: 0.1 + standK * 0.3,
    headPitch: lerp(0.25, 0.05, standK), headYaw: lerp(-0.3, 0, standK), ear: lt > up ? 1 : 0,
    squash: lt > up - 0.12 && lt < up ? 0.25 : lt > up && lt < up + 0.15 ? -0.3 : 0,
  };
  // the cap's rim point nearest his right shoulder, where his fist closes on it
  const Q0 = qE(0, CAP_AT.yaw, 0);
  const rimDir = new THREE.Vector3(-0.78, 0, -0.62).normalize();
  const gripW = rimDir.clone().multiplyScalar(0.163 * 0.98).add(new THREE.Vector3(0, 0.012, 0));
  const CAP_GRIP = gripW.clone().applyQuaternion(Q0.clone().invert()).toArray();
  const capPos = new THREE.Vector3(CAP_AT.x, U.top + 0.005, CAP_AT.z);
  const Hgrab = capPos.clone().add(gripW);
  let a = tan(lt, { ...base, lean: 0 });
  const leanG = leanFor(a, R, Hgrab, 0.25, -0.1, 0.5);
  // reach and grab: lean in, fist onto the rim; lift and stand; then flip the cap up on his fist so its dark crown
  // faces the lens, held up at his right, clear of his head and of the table
  const reachK = kf(lt, [[0, 0], [grab - 0.04, 1]], (k) => backOut(k, 1.3));
  const lean = lerp(leanG * Math.min(1, reachK), 0.14, rise);
  a = tan(lt, { ...base, lean });
  const grabArm = reach(a, R, Hgrab);
  const restArm = { armR: 0.5, armOutR: 0.1 };
  const liftArm = { armR: 1.5, armOutR: 0.25 }, showArm = { armR: 2.05, armOutR: 0.55 };
  let arm;
  if (lt < grab) arm = angLerp(restArm, grabArm, clamp(reachK));
  else if (lt < swing - 0.1) arm = angLerp(grabArm, liftArm, rise);
  else arm = angLerp(liftArm, showArm, clamp(lift));
  a = tan(lt, { ...base, lean, ...arm });
  // the flip turns the cap about the rim's tangent at his fist: the opening swings from the table to face front-right
  const tAxis = new THREE.Vector3(0, 1, 0).cross(rimDir).normalize();
  const Q = qAxis(tAxis, (Math.PI / 2) * lift + 0.2 * rise).multiply(Q0);
  if (lt >= grab) attach(P_CAP, a, R, Q, CAP_GRIP);
  const k0 = ease(seg(lc, 0, 1.25));
  const start = [lerp(0.7, 0.6, k0), lerp(1.04, 1.08, k0), lerp(1.85, 1.68, k0)];
  // push: from a medium shot into the cap's crown
  const cp = lt >= grab ? P_CAP.g.position.clone() : capPos.clone();
  const nrm = new THREE.Vector3(0, -1, 0).applyQuaternion(lt >= grab ? Q : Q0); // the opening's facing
  const pk = easeIn(seg(lc, 1.15, 2.42));
  const endP = cp.clone().addScaledVector(nrm, 0.07);
  const pos = start.map((v, i) => lerp(v, endP.getComponent(i), pk));
  const aim = Math.min(1, pk * 1.4 + lift * 0.5);
  const inside = cp.clone().addScaledVector(nrm, -0.3);
  STAGE.cam(pos, [lerp(0, inside.x, aim), lerp(1.0, inside.y, aim), lerp(-0.6, inside.z, aim)], 36);
  const hd = scr(a.head, [0, 0.4, 0]);
  ov.push((c) => sfx(c, "FWIP", hd[0] - 330, hd[1] + 180, 66, lt - grab, { life: 0.7, burst: false, fill: ["#ffffff", "#5cc7ff"] }));
  ov.push((c) => sfx(c, "HUP!", hd[0] + 330, hd[1] - 20, 96, lt - up, { life: 0.8, burst: "#ffd94a" }));
  ov.push(CARD(1));
  ov.push((c) => black(c, seg(t, T1 - 0.22, T1 - 0.06)));
  return { bloom: 0.38 };
});
