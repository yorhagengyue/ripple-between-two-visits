// Chapter 3 · Blood pressure (film 27–65 s). 8:05 at Mr Tan's dining table: the whip pan from tai chi settles on him;
// he slips on the cuff (RRRIP), presses START (BOOP), the cuff squeezes (PSSSHH) and the monitor settles on 152/96
// (BEEP!). He picks up his phone and the camera pushes into it: from here the real app recording plays in a panel on the
// right while he acts on the left. Records › Record a reading › 1 5 2 9 6 › Save; the card says 152/96 is outside the
// target Dr Lim set ("!?"). He holds the purple button and tells Ripple what happened; the note and "Added to your
// questions for the next visit" land (DING!); he sips his kopi, opens Today, and the chapter ends on his calendar with
// today's triangle, held still: the match cut into Wei Ling's phone in chapter 4.
// Poses and comic overlays run on twos (twos(lt)); the camera runs on plain time.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, backOut, lerp, hash, twos } from "../core.js";
import { timeCard, sfx, bubble, panel, ring, flashHit } from "../overlay.js";
import { frame } from "../media.js";
import { makeTanBot } from "../bots.js";
import { buildDining, TAN, TABLE_Y, SUN_DIR, BACK_Z } from "../sets/c03_dining.js";

// ── clip windows: all the timing that changes when the recordings are retimed lives here ─────────────────────────────
// film = the film second the window opens; from there the clip plays 1:1 from `in` to `out` (never faster or slower).
// Window jumps always land on a 3D cut. Source times are seconds into the clip (s2-his, the story-time re-recording;
// taps from D:/ripple-c2/film/app-flows-story/2-blood-pressure/scene2-his-phone-taps.txt).
const CLIP = "s2-his";
const WIN = {
  phone: { clip: CLIP, film: 35.6, in: 1.0, out: 2.0 },   // on the 3D phone as it wakes (the Today page, 8:05 am)
  enter: { clip: CLIP, film: 36.6, in: 2.0, out: 9.4 },   // Records 2.5 › Record a reading 4.4 › keys 6.1 6.5 7.0 8.3 8.8
  save:  { clip: CLIP, film: 44.0, in: 10.3, out: 13.9 }, // Save 10.9; "152/96 is outside the target Dr Lim set" from 11.2
  hold:  { clip: CLIP, film: 47.6, in: 15.2, out: 20.4 }, // holds the purple button 15.5; his voice c03-tan 15.9–18.46 (film 48.3)
  noted: { clip: CLIP, film: 52.8, in: 24.4, out: 28.2 }, // "Noted: …" 25.7; "Added to your questions for the next visit" 26.6
  cal:   { clip: CLIP, film: 56.6, in: 30.7, out: 39.1 }, // See your questions 30.9 › scroll 33.1 › Today 36.8 › his calendar
                                                         // with today's triangle from 37.2, held still to the end (next tap 39.3)
};
const SRC = {
  taps: [[2.5, 310, 1240], [4.4, 292, 822], [10.9, 292, 957], [15.5, 290, 390], [30.9, 225, 860], [36.8, 72, 1240]], // [s, x, y] in the 585 x 1266 recording
  keys: [6.1, 6.5, 7.0, 8.3, 8.8], save: 10.9, card: 11.1, press: 15.5, noted: 25.7, ding: 26.6, see: 30.9, swipe: 33.1, today: 36.8,
};
// His line: voice c03-tan (audio/voices-v5.json, 2.56 s), placed where his voice starts in the recording (source 15.9,
// 0.4 s into the hold): 早上打完太极 | a short dip at 1.42 s | 还没吃早餐. comma = the second phrase (source seconds).
const LINE = { voice: "c03-tan", at: 15.9, dur: 2.56, comma: 15.9 + 1.42, en: "Did tai chi this morning, no breakfast yet.", zh: "早上打完太极，还没吃早餐。" };
LINE.end = LINE.at + LINE.dur;
/** k for a voiced speech bubble at film time t (VOICE_SYNC.md): its first frame (t >= at; keep `at` on a 1/30 s frame)
 *  is the voice's first frame; up for the voice's whole duration, then gone after a pop-out of at most two frames */
function voiceK(t, at, dur) {
  const e = t - at;
  if (e < -1e-4 || e > dur + 0.05 + 1e-4) return 0;
  return e <= dur ? Math.max(0.15, seg(e, 0, 0.15)) : lerp(0.12, 0.04, (e - dur) / 0.05);
}

/** the window playing at film time t, and the source second it shows */
function srcAt(t) {
  // the latest window that has opened wins, so a window's first frame never shows the previous window's last frame
  let best = null;
  for (const w of Object.values(WIN)) if (t >= w.film - 1e-6 && t < w.film + (w.out - w.in) + 0.04 && (!best || w.film > best.film)) best = w;
  return best && { clip: best.clip, src: Math.min(best.out, best.in + (t - best.film)) };
}
/** film time at which source second s plays (in the window that holds it) */
const filmOf = (s) => { for (const w of Object.values(WIN)) if (s >= w.in && s <= w.out) return w.film + (s - w.in); return -99; };

// ── the stage ────────────────────────────────────────────────────────────────────────────────────────────────────────
const set = STAGE.set("c03.dining", buildDining());
const tan = STAGE.need("tan", makeTanBot);
const U = set.userData;
const PX = 1400, PY = 530, PW = 400, PH = 866;            // the panel: right half, nothing covers it
const LEFT = 1150;                                        // the 3D action, bubbles and sound effects stay left of this
const toPanel = (sx, sy) => [PX - PW / 2 + (sx * PW) / 585, PY - PH / 2 + (sy * PH) / 1266];
const T0 = 27, CARD_IN = 27.3;

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0), _dummy = new THREE.Object3D();
const P0 = { x: TAN.x, z: TAN.z, dy: TAN.seat - 0.12, sit: 1 };
function poseTan(p) { const a = STAGE.pose("tan", { ...P0, ...p }); a.g.updateMatrixWorld(true); return a; }
const handPos = (i) => { const h = tan.hands[i]; h.updateWorldMatrix(true, false); return V3().setFromMatrixPosition(h.matrixWorld); };
const headPos = () => { tan.head.updateWorldMatrix(true, false); return V3(0, 0.25, 0.1).applyMatrix4(tan.head.matrixWorld); };

/** visor faces keyed in time, with one blink between any two different faces */
function faceAt(t, keys) {
  let f = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (Math.abs(t - keys[i][0]) < 0.05 && keys[i][1] !== keys[i - 1][1]) return "blink";
    if (t >= keys[i][0]) f = keys[i][1];
  }
  return f;
}
const breath = (tw) => wob(tw, 0.32) * 0.025;

/** camera; shift > 0 turns the view right so the subject sits in the left half (about 0.24 for the panel layout) */
function cam(pos, tgt, fov, shift = 0, roll = 0) {
  if (shift) {
    const f = V3(tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]), d = f.length(), r = V3().crossVectors(f, UP).normalize();
    tgt = [tgt[0] + r.x * shift * d, tgt[1], tgt[2] + r.z * shift * d];
  }
  STAGE.cam(pos, tgt, fov, roll); STAGE.camera.updateMatrixWorld();
}
const toScreen = (v) => { const p = v.clone().project(STAGE.camera); return [(p.x + 1) * 960, (1 - p.y) * 540]; };
const mix3 = (a, b, k) => a.map((x, i) => lerp(x, b[i], k));

// props ---------------------------------------------------------------------------------------------------------------
// the cuff lies on the table in front of him, its rim toward his right hand
const CUFF_TABLE = { p: V3(-0.06, TABLE_Y + 0.069, -0.15), q: new THREE.Quaternion() };
const cuffOnArm = () => { const a = tan.arms[1]; a.updateWorldMatrix(true, false); return { p: V3(0, -0.13, 0).applyMatrix4(a.matrixWorld), q: a.getWorldQuaternion(new THREE.Quaternion()) }; };
/** held up by its rim in his right hand, its opening toward the camera, in front of the beard */
const cuffInHand = () => ({ p: handPos(1).add(V3(0.09, 0.05, 0.075)), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0.15)) });
/** k: 0..1 from a to b; `bow` bends the path forward (toward the camera) so a cuff carried across his chest passes in
 *  front of the beard instead of through it; `avoid` is a point on the table (the phone) the tube is routed around */
function placeCuff(a, b = a, k = 0, inflate = 0, flap = 0, bow = 0, avoid = null) {
  const c = U.cuff;
  if (bow) { // quadratic bezier through a control point pushed toward the camera
    const C = a.p.clone().lerp(b.p, 0.5); C.z = Math.max(C.z, Math.max(a.p.z, b.p.z)) + bow; C.y = Math.max(a.p.y, b.p.y) + 0.02;
    c.position.copy(a.p).multiplyScalar((1 - k) * (1 - k)).addScaledVector(C, 2 * k * (1 - k)).addScaledVector(b.p, k * k);
  } else c.position.copy(a.p).lerp(b.p, k);
  c.quaternion.copy(a.q).slerp(b.q, Math.min(1, Math.max(0, k)));
  c.scale.set(1 + 0.32 * inflate, 1 + 0.06 * inflate, 1 + 0.32 * inflate);
  c.userData.flap.rotation.y = flap; c.userData.flap.position.z = 0.145 + flap * 0.04;
  c.updateMatrixWorld(true);
  // the tube from the monitor's port to the cuff, rebuilt for this frame
  U.monitor.updateMatrixWorld(true);
  const A = U.monitor.localToWorld(U.monitor.userData.port.clone()), D = c.localToWorld(c.userData.port.clone());
  const B = A.clone().add(V3(-0.06, -0.03, 0.08)), M = A.clone().lerp(D, 0.55);
  M.y = Math.max(TABLE_Y + 0.015, Math.min(A.y, D.y) - 0.07);
  if (avoid && Math.hypot(M.x - avoid.x, M.z - avoid.z) < 0.17) M.z = avoid.z + 0.2; // round the far end of the phone
  const C = D.clone().add(V3(0.05, -0.04, 0.03));
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([A, B, M, C, D]), 40, 0.009, 6, false);
  U.tube.geometry.dispose(); U.tube.geometry = g;
}
// by his edge of the table, within reach of his left hand; its top points at him, so the screen reads upright from the
// front
const PHONE_TABLE = { p: V3(0.185, TABLE_Y + 0.008, -0.2), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.22)) };
/** the phone in his left hand (the cuffed one), the screen turned back toward him and tilted up by `tilt`
 *  (0.5 = held in front of the chest; 3 = held flat under the beard to talk into it); up = height above the hand tip,
 *  fwd = how far it sits in front of the hand tip (just enough that the hand touches its back) */
function phoneInHand(up = 0.07, tilt = 0.5, fwd = 0.065) {
  const p = handPos(0).add(V3(-0.03, up, fwd));
  _dummy.position.copy(p); _dummy.up.copy(UP); _dummy.lookAt(p.x - 0.08, p.y + tilt, p.z - 1);
  return { p, q: _dummy.quaternion.clone() };
}
function placePhone(a, b = a, k = 0, lit = false) {
  const g = U.phone.g; g.position.copy(a.p).lerp(b.p, k); g.quaternion.copy(a.q).slerp(b.q, k);
  U.phone.setScreen(null, lit ? "#f3effa" : "#1b1825");
  g.updateMatrixWorld(true);
}
/** puts the app frame on the 3D phone too (texture set once the image has loaded, before the paint) */
const phoneScreen = (wait, s) => { if (s) wait(frame(s.clip, s.src).then((i) => { if (i) U.phone.setScreen(i); })); };
/** the kopi cup: on its saucer (its handle turned back toward his right hand), or held by the handle in his right hand
 *  at `lift` (0..1 toward his mouth; above 0.6 it tips toward the moustache) */
const KOPI_TURN = 2.04, GRIP = V3(0.075, 0.045, 0); // GRIP: where his hand holds the handle, in cup coordinates
function placeKopi(lift = 0, tw = 0) {
  const cup = U.kopi.userData.cup, k = U.kopi, rest = V3(0, 0.014, 0);
  cup.rotation.set(0, lerp(KOPI_TURN, Math.PI, ease(Math.min(1, Math.max(0, lift)))), 0.85 * ease(seg(lift, 0.6, 1)));
  if (lift <= 0) cup.position.copy(rest);
  else {
    k.updateWorldMatrix(true, false);
    const held = k.worldToLocal(handPos(1)).sub(GRIP.clone().applyEuler(cup.rotation));
    cup.position.copy(rest).lerp(held, ease(Math.min(1, lift / 0.15))); // eases the last cm or two into his grip
  }
  // steam rising off the cup
  cup.updateWorldMatrix(true, false);
  const top = V3(0, 0.1, 0).applyMatrix4(cup.matrixWorld);
  U.steam.forEach((b, i) => {
    const ph = (tw * 0.55 + i / 3) % 1;
    b.position.set(top.x + wob(ph + i, 0.8) * 0.02, top.y + ph * 0.22, top.z + Math.cos(i * 2 + ph * 5) * 0.012);
    b.scale.setScalar(Math.sin(Math.PI * ph) * (lift > 0.8 ? 0.3 : 1) + 0.001);
  });
}
/** the room's clockwork: the wall clock (8:05 and ticking), the fan turning and oscillating */
function room(t) {
  const tw = twos(t), e = t - T0;
  U.clock.userData.setTime(8, 5 + e / 60, Math.floor(e) % 60);
  U.fan.userData.head.rotation.y = wob(tw, 0.08) * 0.65;
  U.fan.userData.blades.rotation.z = -tw * 19;
  U.monitor.userData.btn.position.y = 0.106;
  U.setTV(Math.floor(e * 15));
  // the gecko on the back wall: a dash every few seconds, then still; its tail flicks on twos
  const dash = (x) => Math.floor(x) + ease(seg(x % 1, 0.82, 1));
  const p = dash(e / 3.1);
  U.gecko.position.set(1.42 - p * 0.085, 1.62 + Math.sin(p * 1.3) * 0.06, BACK_Z + 0.012);
  U.gecko.rotation.z = 1.2 + Math.sin(p * 1.3) * 0.4;
  U.gecko.userData.tail.rotation.z = Math.PI + wob(tw, 1.3) * 0.25;
}
/** the morning sun through the window is the key (the left wall casts, so it lands as a window-shaped patch on him and
 *  the table); a warm sky fill keeps the rest of the room in saturated violet-tinted shade */
const KEY_T = [0, 0.9, -0.4], KEY_P = KEY_T.map((v, i) => v - SUN_DIR.getComponent(i) * 7);
function lights() { STAGE.lights("warm", { keyPos: KEY_P, keyTarget: KEY_T, hemi: 1.2, keyI: 2.9, key: "#ffcf8f", sky: "#d2b6ff", ground: "#7a48b8", rimI: 0.7, bg: "#ffe2a8" }); }
const LCD = (s) => U.monitor.userData.setReading(s);
const RESULT = { mode: "result", sys: 152, dia: 96, pul: 78, heart: true };

// overlay helpers -------------------------------------------------------------------------------------------------------
const card = (t) => (c) => timeCard(c, "8:05 AM", "Blood pressure", seg(twos(t), CARD_IN, CARD_IN + 0.27));
/** the app panel, and a ring on every tap that falls in this frame's window */
function appPanel(ov, wait, t) {
  const s = srcAt(t); if (!s) return null;
  let img; wait(frame(s.clip, s.src).then((i) => (img = i)));
  ov.push((c) => panel(c, img, PX, PY, PW, PH, 1, { noPop: true }));
  for (const [ts, x, y] of SRC.taps) { const [X, Y] = toPanel(x, y); ov.push((c) => ring(c, X, Y, 46, s.src - ts, { life: 0.6 })); }
  return s;
}
/** a hit flash kept off the panel */
const flashLeft = (age, col, frames = 3) => (c) => { c.save(); c.beginPath(); c.rect(0, 0, LEFT + 30, 1080); c.clip(); flashHit(c, age, col, frames); c.restore(); };
const TAPFX = (age, x, y, i = 0) => (c) => sfx(c, "TAP", Math.max(70, x - 60), y + 120, 54, age, { burst: false, life: 0.5, fill: ["#ffffff", "#7fe3ff"], rot: i % 2 ? 0.12 : -0.14 });
/** a tap jab around each tap time (shot seconds): a small lift, the poke, back */
const jab = (tw, ts) => { let v = 0; for (const x of ts) { const j = kf(tw, [[x - 0.2, 0], [x - 0.08, -0.25], [x, 1], [x + 0.14, 0.2], [x + 0.26, 0]]); if (Math.abs(j) > Math.abs(v)) v = j; } return v; };

// ── 3a · the whip pan from tai chi settles on his table; he slips the cuff on: RRRIP ─────────────────────────────────
const WHIP = [[0, -2.6], [0.3, 0.1], [0.55, 0]];
shot("c03 table", 27.0, 30.3, ({ t, lt, ov }) => {
  STAGE.show("c03.dining"); lights(); room(t);
  const tw = twos(lt + 1e-4), rip = 2.3;
  poseTan({
    headYaw: kf(tw, [[0, 0.32], [0.7, 0.32], [1.0, -0.12], [1.45, -0.05], [1.85, 0.45], [2.6, 0.4], [3.0, 0.08]]),
    headPitch: kf(tw, [[0, 0.1], [0.8, 0.1], [1.0, 0.32], [1.5, 0.25], [1.9, 0.22], [2.6, 0.15], [3.0, 0.06]]),
    lean: kf(tw, [[0.6, 0], [0.75, -0.08], [1.0, 0.14], [1.3, 0.12], [1.6, 0.02]]),
    armR: kf(tw, [[0.6, 0.25], [0.75, 0.12], [1.05, 1.42], [1.35, 1.8], [1.65, 1.75], [2.05, 1.3], [2.25, 1.3], [2.33, 1.05], [2.5, 1.2], [2.95, 0.28]]),
    armOutR: kf(tw, [[0.6, 0.1], [1.05, -0.3], [1.35, -0.2], [1.65, -0.2], [2.05, -0.85], [2.5, -0.8], [2.95, 0.1]]),
    armL: kf(tw, [[1.3, 0.22], [1.75, 0.45], [2.55, 0.5], [2.95, 1.42]], easeOut),
    armOutL: kf(tw, [[1.3, 0.1], [1.75, 0.95], [2.2, 0.9], [2.4, 1.0], [2.55, 0.9], [2.95, 0.2]]),
    face: faceAt(tw, [[0, "code"], [1.0, "think"], [2.38, "happy"], [3.0, "code"]]),
    squash: breath(tw) + kf(tw, [[rip - 0.04, 0], [rip + 0.03, 0.16], [rip + 0.25, 0]]),
    tilt: wob(tw, 0.4) * 0.03, ear: tw > rip && tw < rip + 0.5 ? 0.8 : 0,
  });
  // the cuff: on the table, then in his right hand, then on his left upper arm
  const kHand = ease(seg(tw, 1.05, 1.3)), kArm = backOut(seg(tw, 1.65, 2.1), 1.4);
  const P = PHONE_TABLE.p;
  if (tw < 1.65) placeCuff(CUFF_TABLE, cuffInHand(), kHand, 0, 0, 0, P);
  else placeCuff(cuffInHand(), cuffOnArm(), kArm, 0, tw > rip ? kf(tw, [[rip, 0.9], [rip + 0.12, -0.15], [rip + 0.3, 0]]) : 0.9, 0.12, P);
  placePhone(PHONE_TABLE); placeKopi(0, tw); LCD({ mode: "off" });
  // the camera: whip in from the left (still turning right), settle with a little overshoot, then a slow push
  const off = kf(lt, WHIP, easeOut), k = ease(seg(lt, 0.3, 3.3));
  const pos = mix3([-0.55, 1.38, 2.62], [-0.38, 1.26, 1.9], k), tgt = [0.07, 0.95, -0.45];
  const right = V3(tgt[0] - pos[0], 0, tgt[2] - pos[2]).cross(UP).normalize();
  cam(pos, [tgt[0] + right.x * off, tgt[1], tgt[2] + right.z * off], 38, kf(lt, [[0, -0.05], [0.4, 0]]));
  // a smear for the whip: the frame dragged sideways while the camera still turns fast
  const sp = Math.abs(kf(lt + 1 / 30, WHIP, easeOut) - off) * 620;
  if (sp > 4) ov.push((c) => { const amt = Math.min(320, sp); c.save(); for (let i = 1; i <= 7; i++) { c.globalAlpha = 0.2; c.drawImage(c.canvas, (amt * i) / 7, 0); } c.restore(); });
  const [cx, cy] = toScreen(U.cuff.position);
  ov.push((c) => sfx(c, "RRRIP!", Math.min(cx + 170, 1500), cy - 170, 96, tw - rip, { burst: false, fill: ["#ffe37a", "#ff8a1f"], rot: -0.12 }));
  ov.push(card(t));
  return { bloom: 0.5 };
});

// ── 3b · he presses START with the cuffed hand (BOOP); the cuff squeezes: PSSSHH, he squashes ──────────────────────────
shot("c03 squeeze", 30.3, 33.1, ({ t, lt, ov }) => {
  STAGE.show("c03.dining"); lights(); room(t);
  const tw = twos(lt + 1e-4), boop = 0.5, pss = 0.8;
  const inflate = kf(tw, [[0.7, 0], [1.9, 1], [2.4, 1], [2.8, 0.9]], easeOut) + (tw > 0.8 && tw < 2.4 ? wob(tw, 6) * 0.03 : 0);
  const sq = kf(tw, [[pss, 0], [pss + 0.15, 0.22], [pss + 0.35, 0.15], [2.3, 0.17], [2.8, 0.08]], easeOut);
  poseTan({
    armL: kf(tw, [[0, 1.42], [0.25, 1.25], [boop, 1.66], [boop + 0.25, 1.45]]), armOutL: kf(tw, [[0, 0.2], [boop, 0.32], [boop + 0.25, 0.2]]),
    armR: kf(tw, [[0, 0.3], [pss, 0.3], [pss + 0.2, 1.25], [2.8, 1.2]]), armOutR: kf(tw, [[pss, 0.1], [pss + 0.2, -0.2]]),
    lean: kf(tw, [[0, 0], [0.25, -0.05], [boop, 0.2], [boop + 0.3, 0.02]]),
    headYaw: kf(tw, [[0, 0.42], [pss, 0.42], [pss + 0.2, 0.1], [2.8, 0.05]]), headPitch: kf(tw, [[0, 0.22], [pss + 0.15, -0.05], [2.8, 0.0]]),
    face: faceAt(tw, [[0, "code"], [pss + 0.1, "wow"]]), ear: tw > pss ? -0.9 : 0,
    squash: breath(tw) + sq + (tw > pss ? wob(tw, 7) * 0.012 : 0), tilt: tw > pss ? wob(tw, 5) * 0.025 : 0,
  });
  placeCuff(cuffOnArm(), cuffOnArm(), 0, inflate, 0, 0, PHONE_TABLE.p);
  if (tw > boop - 0.02 && tw < boop + 0.15) U.monitor.userData.btn.position.y = 0.094;
  placePhone(PHONE_TABLE); placeKopi(0, tw);
  LCD(tw < boop ? { mode: "off" } : tw < 0.7 ? { mode: "zero", val: 0 } : { mode: "press", val: Math.round(kf(tw, [[0.7, 0], [1.9, 182], [2.4, 182], [2.8, 176]], easeOut)), heart: Math.floor(tw * 3) % 2 === 0 });
  const k = ease(seg(lt, 0, 2.8)), punch = kf(lt, [[pss - 0.05, 0], [pss + 0.05, 1], [pss + 0.3, 1], [pss + 0.8, 0]]);
  cam(mix3([1.5, 1.22, 0.9], [1.34, 1.18, 0.72], k), [0.16, 0.9, -0.42], 34 - punch * 3);
  const [bx, by] = toScreen(V3(0.36, TABLE_Y + 0.11, 0.03));
  ov.push((c) => sfx(c, "BOOP", bx - 40, by - 90, 60, tw - boop, { burst: false, life: 0.6, fill: ["#cfeaff", "#5aa8ff"] }));
  ov.push(flashLeft(lt - (pss - 0.07), "#fff3b0", 2));
  const cf = toScreen(U.cuff.position);
  ov.push((c) => sfx(c, "PSSSHH", Math.min(cf[0] + 330, 1560), Math.max(170, cf[1] - 260), 112, tw - pss, { life: 1.5, rot: -0.08 }));
  ov.push(card(t));
  return { bloom: 0.5 };
});

// ── 3c · the monitor close-up: the cuff lets go, the digits roll and settle on 152/96: BEEP! ─────────────────────────
shot("c03 reading", 33.1, 35.2, ({ t, lt, ov }) => {
  STAGE.show("c03.dining"); lights(); room(t);
  const tw = twos(lt + 1e-4), beep = 17 / 15;
  poseTan({ armL: 1.42, armOutL: 0.2, armR: 1.2, armOutR: -0.2, lean: kf(tw, [[0, 0.02], [1.0, 0.16]]), headYaw: 0.45, headPitch: 0.2,
    face: faceAt(tw, [[0, "think"], [beep + 0.05, "wow"]]), squash: breath(tw) + kf(tw, [[0, 0.08], [0.8, 0]]), ear: tw > beep ? 0.9 : 0 });
  placeCuff(cuffOnArm(), cuffOnArm(), 0, kf(tw, [[0, 0.88], [0.9, 0.05]]), 0, 0, PHONE_TABLE.p);
  placePhone(PHONE_TABLE); placeKopi(0, tw);
  const step = Math.floor(tw * 15);
  LCD(tw < 0.6 ? { mode: "press", val: Math.round(kf(tw, [[0, 176], [0.6, 150]])), heart: step % 4 < 2 }
    : tw < beep ? { mode: "result", sys: 100 + Math.floor(hash(step * 3.1) * 99), dia: 50 + Math.floor(hash(step * 7.7) * 49), pul: 60 + Math.floor(hash(step) * 30), heart: false }
    : { ...RESULT, heart: step % 4 < 2 });
  const lcd = V3(); U.monitor.updateMatrixWorld(true); U.monitor.userData.lcd.getWorldPosition(lcd);
  const k = ease(seg(lt, 0, 2.1)), punch = kf(lt, [[beep - 0.03, 0], [beep + 0.05, 1], [beep + 0.35, 1], [beep + 0.9, 0.3]]);
  const nrm = U.monitor.userData.lcd.getWorldDirection(V3()), side = V3().crossVectors(nrm, UP).normalize(), dd = lerp(0.46, 0.37, k);
  cam([lcd.x + nrm.x * dd + side.x * 0.1, lcd.y + nrm.y * dd + 0.04, lcd.z + nrm.z * dd + side.z * 0.1], [lcd.x - side.x * 0.02, lcd.y, lcd.z - side.z * 0.02], 30 - punch * 4);
  ov.push(flashLeft(lt - (beep - 0.07), "#ffffff", 2));
  ov.push((c) => sfx(c, "BEEP!", 1420, 300, 120, tw - beep, { burst: "#bff3ff", dots: "rgba(57,211,255,.35)", life: 1.0 }));
  ov.push(card(t));
  return { bloom: 0.55 };
});

// ── 3d · from above the table: his hand taps the phone, the screen wakes on the Today page, the camera drops into it
//        and the screen lifts off into the comic panel ────────────────────────────────────────────────────────────────
shot("c03 phone", 35.2, 36.6, ({ t, lt, ov, wait }) => {
  STAGE.show("c03.dining"); lights(); room(t);
  const tw = twos(lt + 1e-4), tap = 0.35;
  // the tap: his left hand lifts a little, comes down onto the top end of the phone, stays a beat, lifts off
  poseTan({
    armL: kf(tw, [[0, 1.42], [0.15, 1.72], [tap, 1.5], [tap + 0.2, 1.5], [tap + 0.45, 1.64]]),
    armOutL: kf(tw, [[0, 0.2], [0.15, -0.05], [tap, -0.3], [tap + 0.45, -0.22]]),
    armR: 0.3, armOutR: 0.1, headYaw: kf(tw, [[0, 0.45], [0.25, 0.12]]), headPitch: kf(tw, [[0, 0.2], [0.3, 0.42]]),
    lean: kf(tw, [[0, 0.02], [0.15, -0.03], [tap, 0.12], [0.8, 0.1]]), face: faceAt(tw, [[0, "wow"], [0.25, "code"]]),
    squash: breath(tw) + kf(tw, [[tap - 0.03, 0], [tap + 0.03, 0.06], [tap + 0.2, 0]]),
  });
  placeCuff(cuffOnArm(), undefined, 0, 0, 0, 0, PHONE_TABLE.p); placeKopi(0, tw); LCD(RESULT);
  const s = srcAt(t); let img = null; if (s) wait(frame(s.clip, s.src).then((i) => (img = i)));
  const awake = tw >= tap + 0.05, km = ease(seg(lt, 0.95, 1.4));
  placePhone(PHONE_TABLE, undefined, 0, awake);
  // once the picture lifts off into the panel, the phone underneath keeps only its glow (no second copy of the app)
  if (awake && km <= 0) phoneScreen(wait, s);
  // the camera: high in front, so his hand coming down onto the phone and his visor both read; then it swings over
  // the phone and drops into the screen
  const g = U.phone.g, ph = g.position.clone();
  const kp = easeIn(seg(lt, 0.45, 1.4)), kd = ease(seg(lt, 0, 0.5));
  const c0 = [ph.x + lerp(0.34, 0.3, kd), ph.y + lerp(1.3, 1.2, kd), ph.z + lerp(0.95, 0.86, kd)], c1 = [ph.x, ph.y + 0.32, ph.z + 0.06];
  const t0 = [ph.x - 0.02, ph.y + 0.06, ph.z - 0.08], t1 = [ph.x, ph.y, ph.z - 0.02];
  cam(mix3(c0, c1, kp), mix3(t0, t1, ease(seg(lt, 0.45, 1.4))), lerp(40, 34, kp));
  // the lift-off: the panel grows from the screen's place on the frame to its own place on the right
  const top = toScreen(V3(0, 0.078, 0.006).applyMatrix4(g.matrixWorld)), bot = toScreen(V3(0, -0.078, 0.006).applyMatrix4(g.matrixWorld));
  const x0 = (top[0] + bot[0]) / 2, y0 = (top[1] + bot[1]) / 2;
  if (km > 0) {
    const h0 = Math.hypot(top[0] - bot[0], top[1] - bot[1]), r0 = -Math.atan2(bot[0] - top[0], bot[1] - top[1]);
    const h = lerp(h0, PH, km), x = lerp(x0, PX, km), y = lerp(y0, PY, km), rot = lerp(r0, 0, km);
    ov.push((c) => panel(c, img, x, y, (h * PW) / PH, h, 1, { noPop: true, rot }));
  }
  const tp = toScreen(handPos(0));
  ov.push(TAPFX(tw - tap, tp[0] - 110, tp[1] - 100));
  // the swoosh trails the panel as it leaves the phone
  ov.push((c) => sfx(c, "SWOOSH", Math.max(150, x0 - 260), y0 + 40, 70, tw - 0.95, { burst: false, life: 0.5, fill: ["#ffffff", "#c9b8ff"], rot: -0.1 }));
  ov.push(card(t));
  return { bloom: 0.5 };
});

// ── panel shots: the app on the right, Mr Tan on the left ────────────────────────────────────────────────────────────
/** his phone-holding pose: phone in the left hand at chest height, right hand free to tap (tap 0..1 is the jab) */
function holdPose(tw, o = {}) {
  const tap = o.tap ?? 0;
  return {
    armL: (o.armL ?? 1.38) + breath(tw) * 0.5, armOutL: o.armOutL ?? -0.22,
    armR: (o.armR ?? 1.15) + tap * 0.28, armOutR: (o.armOutR ?? -0.55) - tap * 0.05,
    headPitch: o.headPitch ?? 0.34, headYaw: o.headYaw ?? 0.05, lean: o.lean ?? 0.03, dy: o.dy ?? P0.dy,
    squash: breath(tw) + (o.squash ?? 0), tilt: o.tilt ?? wob(tw, 0.27) * 0.03, face: o.face ?? "code", ear: o.ear ?? 0,
  };
}
/** the common dressing for every panel shot */
function panelShot(t, lt, wait, extra = {}) {
  STAGE.show("c03.dining"); lights(); room(t);
  placeCuff(cuffOnArm(), cuffOnArm(), 0, 0);
  placePhone(phoneInHand(extra.phoneUp ?? 0.07, extra.tilt ?? 0.5, extra.fwd), undefined, 0, true);
  phoneScreen(wait, srcAt(t));
  placeKopi(extra.kopi ?? 0, twos(lt)); LCD(RESULT);
}

// 3e · Records › Record a reading
shot("c03 records", 36.6, 39.4, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 36.6, taps = [filmOf(2.5) - a, filmOf(4.4) - a];
  poseTan(holdPose(tw, { tap: jab(tw, taps), face: faceAt(tw, [[0, "code"], [1.6, "code"]]), headYaw: kf(tw, [[0, 0.05], [2.8, -0.03]]) }));
  panelShot(t, lt, wait);
  const k = ease(seg(lt, 0, 2.8));
  cam(mix3([-0.9, 1.45, 2.9], [-0.8, 1.42, 2.62], k), [0.0, 0.95, -0.5], 36, 0.24);
  const hp = toScreen(handPos(1));
  taps.forEach((x, i) => ov.push(TAPFX(tw - x, hp[0] - 90, hp[1] - 110, i)));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});

// 3f · the keypad: he reads the monitor, taps 1 5 2, reads again, taps 9 6
shot("c03 keys", 39.4, 44.0, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 39.4, keys = SRC.keys.map((s) => filmOf(s) - a);
  const look = kf(tw, [[0, 1], [0.8, 1], [1.0, 0], [2.45, 0], [2.65, 1], [3.15, 1], [3.35, 0]]);
  poseTan(holdPose(tw, { tap: jab(tw, keys), headYaw: lerp(0.02, 0.62, look), headPitch: lerp(0.36, 0.12, look),
    face: faceAt(tw, [[0, "think"], [0.95, "code"], [2.6, "think"], [3.3, "code"]]), lean: 0.04 }));
  panelShot(t, lt, wait);
  const k = ease(seg(lt, 0, 4.6));
  cam(mix3([1.42, 1.08, 1.42], [1.28, 1.06, 1.24], k), [0.18, 1.04, -0.38], 34, 0.18);
  const hp = toScreen(handPos(1));
  keys.forEach((x, i) => ov.push(TAPFX(tw - x, hp[0] + (i % 2 ? 60 : -80), hp[1] - 120 - (i % 3) * 30, i)));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});

// 3g · Save: the card "152/96 is outside the target Dr Lim set"; his visor goes worry: "!?"
shot("c03 save", 44.0, 47.6, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 44.0, save = filmOf(SRC.save) - a, hit = filmOf(SRC.card) - a + 0.55; // the card reads at about 11.5
  const scratch = kf(tw, [[2.2, 0], [2.5, 1], [3.3, 1], [3.6, 0]]);
  poseTan(holdPose(tw, {
    tap: jab(tw, [save]) * (1 - scratch),
    armR: lerp(1.15, 2.75, scratch) + scratch * wob(tw, 3) * 0.12, armOutR: lerp(-0.55, -0.05, scratch),
    headPitch: kf(tw, [[0, 0.34], [hit - 0.05, 0.34], [hit + 0.05, -0.12], [hit + 0.4, 0.05], [2.4, 0.15]]),
    headYaw: kf(tw, [[hit, 0.05], [hit + 0.1, -0.12], [2.4, 0.15]]),
    face: faceAt(tw, [[0, "code"], [hit, "worry"], [2.45, "think"]]),
    squash: kf(tw, [[hit - 0.04, 0], [hit + 0.04, -0.28], [hit + 0.2, 0.12], [hit + 0.4, 0]]),
    ear: tw > hit ? -1 : 0, tilt: tw > 2.4 ? 0.12 + wob(tw, 0.6) * 0.04 : wob(tw, 0.27) * 0.03,
  }));
  panelShot(t, lt, wait);
  const k = ease(seg(lt, 0, 3.6)), punch = kf(lt, [[hit - 0.03, 0], [hit + 0.05, 1], [hit + 0.4, 1], [hit + 1.0, 0.4]]);
  cam(mix3([-0.35, 1.25, 1.9], [-0.3, 1.22, 1.7], k), [0.0, 1.0, -0.6], 34 - punch * 4, 0.25);
  const hp = toScreen(handPos(1)), hd = toScreen(headPos());
  ov.push(TAPFX(tw - save, hp[0] - 80, hp[1] - 120));
  ov.push(flashLeft(lt - (hit - 0.07), "#cbb8ff", 2));
  ov.push((c) => sfx(c, "!?", Math.min(hd[0] + 250, LEFT - 140), hd[1] - 200, 130, tw - hit, { burst: "#b48cff", dots: "rgba(80,40,160,.35)", life: 1.6, rot: 0.12, spikes: 15 }));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});

// 3h · he holds the purple button and lifts the phone to his mouth; the line starts (bubble)
const speakBob = (tw, on) => (on ? wob(tw, 2.6) * 0.05 + wob(tw, 4.1) * 0.03 : 0);
const lineOn = (t) => t >= filmOf(LINE.at) - 1e-4 && t < filmOf(LINE.at) + LINE.dur;
/** his bubble, tied to his voice; the same call in both shots so it runs on across the cut */
const lineBubble = (t, tx, ty) => (c) => bubble(c, [LINE.en, LINE.zh], 545, 150, tx, ty, voiceK(t, filmOf(LINE.at), LINE.dur), { size: 31, voice: LINE.voice });
shot("c03 press", 47.6, 49.4, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 47.6, press = filmOf(SRC.press) - a, say = filmOf(LINE.at) - a;
  const up = kf(tw, [[0, 0], [0.1, -0.15], [0.42, 1.05], [0.55, 1]], easeOut);
  const talking = lineOn(t);
  poseTan(holdPose(tw, {
    armL: lerp(1.38, 1.78, up), armOutL: lerp(-0.22, -0.3, up), tap: kf(tw, [[press - 0.15, 0], [press, 0.9]]),
    armR: lerp(1.15, 1.75, up), armOutR: -0.6,
    headPitch: lerp(0.34, 0.08, up) + speakBob(tw, talking), headYaw: 0.08, face: faceAt(tw, [[0, "code"], [say, "happy"], [say + 0.6, "code"]]),
    squash: talking ? wob(tw, 2.6) * 0.04 : 0, ear: up > 0.5 ? 0.4 : 0,
  }));
  panelShot(t, lt, wait, { phoneUp: lerp(0.07, 0.03, up), tilt: lerp(0.5, 2.6, up), fwd: lerp(0.065, 0.14, up) });
  const k = ease(seg(lt, 0, 1.8));
  cam(mix3([0.8, 0.86, 1.95], [0.68, 0.88, 1.72], k), [0.0, 1.12, -0.6], 34, 0.25);
  const hd = toScreen(headPos());
  ov.push((c) => sfx(c, "CLICK", hd[0] - 260, hd[1] + 180, 56, tw - press, { burst: false, life: 0.5, fill: ["#ffffff", "#c9a8ff"] }));
  ov.push(lineBubble(t, hd[0] - 30, hd[1] - 120));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});

// 3i · the close-up: he talks into the phone. First half proud (tai chi!), second half sheepish (no breakfast yet).
shot("c03 speak", 49.4, 52.8, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), talking = lineOn(t), a = 49.4, comma = filmOf(LINE.comma) - a, done = filmOf(LINE.end) - a;
  const down = kf(tw, [[done + 0.2, 0], [done + 0.6, 1]]);
  const second = kf(tw, [[comma - 0.1, 0], [comma + 0.2, 1]]);
  poseTan(holdPose(tw, {
    armL: lerp(1.78, 1.5, down), armOutL: -0.3, armR: lerp(1.75, 1.5, down) + (1 - second) * (talking ? wob(tw, 1.3) * 0.25 + 0.3 : 0), armOutR: lerp(-0.2, -0.6, second), tap: 0.9 * second,
    headPitch: lerp(0.0, 0.13, second) + lerp(0.04, 0.1, down) + speakBob(tw, talking) * 1.5,
    headYaw: lerp(-0.12, 0.14, second) + (talking ? wob(tw, 0.9) * 0.05 : 0),
    tilt: lerp(-0.1, 0.12, second) + wob(tw, 0.5) * 0.04,
    face: faceAt(tw, [[0, "happy"], [comma, "sad"], [done + 0.25, "think"]]),
    squash: talking ? wob(tw, 2.6) * 0.05 : breath(tw), ear: talking ? lerp(0.8, -0.8, second) : -0.3,
  }));
  panelShot(t, lt, wait, { phoneUp: lerp(0.03, 0.06, down), tilt: lerp(2.6, 0.8, down), fwd: lerp(0.14, 0.065, down) });
  const k = ease(seg(lt, 0, 3.4));
  cam(mix3([-0.2, 1.12, 1.5], [-0.15, 1.12, 1.32], k), [0.0, 1.25, -0.6], 32, 0.19);
  const hd = toScreen(headPos());
  ov.push(lineBubble(t, Math.min(hd[0], 700), hd[1] - 230));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});

// 3j · the note appears, then "Added to your questions for the next visit": DING!
shot("c03 noted", 52.8, 56.6, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 52.8, noted = filmOf(SRC.noted) - a, ding = filmOf(SRC.ding) - a;
  const cheer = kf(tw, [[ding - 0.1, 0], [ding + 0.12, 1.1], [ding + 0.3, 1], [ding + 1.0, 1], [ding + 1.3, 0]], easeOut);
  poseTan(holdPose(tw, {
    armR: lerp(1.15, 2.6, cheer), armOutR: lerp(-0.55, 0.25, cheer),
    headPitch: kf(tw, [[0, 0.3], [noted, 0.3], [noted + 0.1, 0.2], [ding, 0.22], [ding + 0.1, -0.05], [ding + 0.5, 0.1]]),
    face: faceAt(tw, [[0, "think"], [noted + 0.05, "wow"], [ding, "happy"]]),
    squash: kf(tw, [[ding - 0.05, 0], [ding, 0.18], [ding + 0.1, -0.14], [ding + 0.3, 0]]),
    ear: tw > ding ? 1 : tw > noted ? 0.5 : 0, dy: P0.dy + kf(tw, [[ding, 0], [ding + 0.12, 0.05], [ding + 0.3, 0]]),
  }));
  panelShot(t, lt, wait);
  const orbit = ease(seg(lt, 0, 3.8));
  cam([lerp(1.15, 0.75, orbit), lerp(1.6, 1.52, orbit), lerp(2.0, 1.95, orbit)], [0.0, 0.95, -0.6], 35, 0.25);
  const hd = toScreen(headPos());
  ov.push(flashLeft(lt - (ding - 0.07), "#fff3b0", 2));
  ov.push((c) => sfx(c, "DING!", Math.min(hd[0] + 260, LEFT - 195), hd[1] - 170, 118, tw - ding, { burst: "#9ff5d6", dots: "rgba(47,180,140,.35)", life: 1.3, rot: -0.1 }));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.5 };
});

// 3k · See your questions: the visit list; he scrolls, reading
shot("c03 questions", 56.6, 59.6, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 56.6, tap = filmOf(SRC.see) - a, swipe = filmOf(SRC.swipe) - a;
  const sw = kf(tw, [[swipe - 0.2, 0], [swipe, 0.2], [swipe + 0.25, 1], [swipe + 0.45, 0]]);
  poseTan(holdPose(tw, { tap: jab(tw, [tap]), armR: 1.15 + sw * 0.4, headPitch: 0.36 + wob(tw, 0.6) * 0.03,
    face: faceAt(tw, [[0, "happy"], [0.6, "code"], [2.7, "think"]]), headYaw: kf(tw, [[0, 0.1], [3, -0.05]]) }));
  panelShot(t, lt, wait);
  const k = ease(seg(lt, 0, 3));
  cam(mix3([-1.55, 1.12, 1.55], [-1.38, 1.1, 1.38], k), [0.05, 0.98, -0.45], 35, 0.24);
  const hp = toScreen(handPos(1));
  ov.push(TAPFX(tw - tap, hp[0] - 70, hp[1] - 110));
  ov.push((c) => sfx(c, "SHHK", hp[0] - 120, hp[1] - 60, 50, tw - swipe, { burst: false, life: 0.5, fill: ["#ffffff", "#ffc38a"] }));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});

// 3l · a sip of kopi while he reads his questions: SLURP
shot("c03 kopi", 59.6, 62.4, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), sip = 1.25;
  // his right hand goes to the handle (0.45), lifts the cup to his moustache, sips, and sets it back on the saucer (2.25)
  const lift = kf(tw, [[0.45, 0], [0.8, 1], [1.8, 1], [2.25, 0]], easeOut);
  poseTan(holdPose(tw, {
    armR: kf(tw, [[0, 1.0], [0.2, 0.95], [0.45, 1.4], [0.8, 2.0], [1.8, 2.0], [2.25, 1.4], [2.45, 1.4], [2.8, 1.05]]),
    armOutR: kf(tw, [[0, -0.3], [0.2, -0.2], [0.45, 0.12], [0.8, 0.0], [1.8, 0.0], [2.25, 0.12], [2.45, 0.12], [2.8, -0.2]]),
    lean: kf(tw, [[0.2, 0.03], [0.45, 0.1], [0.75, 0.0], [2.0, 0.0], [2.25, 0.1], [2.6, 0.03]]),
    headPitch: kf(tw, [[0, 0.34], [0.6, 0.1], [sip, -0.1], [1.9, 0.0], [2.4, 0.3]]), headYaw: kf(tw, [[0, 0.05], [0.7, -0.15], [2.3, 0.0]]),
    face: faceAt(tw, [[0, "code"], [sip - 0.2, "blink"], [sip + 0.35, "happy"]]), squash: kf(tw, [[sip, 0], [sip + 0.1, 0.08], [sip + 0.4, 0]]),
    ear: tw > sip ? 0.7 : 0 }));
  panelShot(t, lt, wait, { kopi: lift });
  const k = ease(seg(lt, 0, 2.8));
  cam(mix3([-1.2, 1.4, 2.9], [-1.05, 1.36, 2.65], k), [-0.1, 0.95, -0.5], 38, 0.22);
  const hd = toScreen(headPos());
  ov.push((c) => sfx(c, "SLURP", hd[0] - 250, hd[1] - 120, 84, tw - sip, { burst: false, life: 0.9, fill: ["#ffe2b0", "#c8743f"], rot: -0.15 }));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.5 };
});

// 3m · Today: his calendar with today's triangle; he nods, happy. Held still for the match cut into chapter 4.
shot("c03 calendar", 62.4, 65.0, ({ t, lt, ov, wait }) => {
  const tw = twos(lt + 1e-4), a = 62.4, tap = filmOf(SRC.today) - a;
  const nod = tw > 0.9 && tw < 1.9 ? Math.max(0, wob(tw - 0.9, 2)) * 0.22 : 0;
  poseTan(holdPose(tw, { tap: jab(tw, [tap]), headPitch: 0.3 + nod, face: faceAt(tw, [[0, "code"], [0.85, "happy"]]), ear: tw > 0.85 ? 0.8 : 0,
    tilt: kf(tw, [[0.8, 0], [1.2, 0.1]]) + wob(tw, 0.3) * 0.02 }));
  panelShot(t, lt, wait);
  const k = easeOut(seg(lt, 0, 2.6));
  cam(mix3([-0.35, 1.25, 1.9], [-0.5, 1.32, 2.4], k), [0.02, 0.98, -0.55], 36, 0.24);
  const hp = toScreen(handPos(1));
  ov.push(TAPFX(tw - tap, hp[0] - 80, hp[1] - 110));
  ov.push(card(t)); appPanel(ov, wait, t);
  return { bloom: 0.45 };
});
