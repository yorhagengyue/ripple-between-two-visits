// Chapter 4 · Wei Ling's office (film 65–85 s). Match cut from Dad's calendar to her phone on her desk; pull back over
// her desk (dad's photo, mug, plant, sticky notes) and crane up over a neon floor of identical desks, a CodeBuddy mascot
// typing at each (TAP TAP TAP; the far desks pop in like the reference's sessions floor). Her phone buzzes; she picks it
// up; the app panel shows Dad's day (152/96, "Dad noted …", his question); worry, then resolve; she calls him; she
// grabs her bag and dashes right on a whip pan (hand-off to c05).
// Her phone is one object (the pink phone on the desk): every shot places it in world space, on the desk or from her
// right hand (read, ear, carry), so it is never parented to the shared actor and never swaps model.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, pop, ease, easeOut, easeIn, clamp, lerp, hash, backOut, twos } from "../core.js";
import { timeCard, sfx, bubble, panel, flashHit } from "../overlay.js";
import { frame } from "../media.js";
import { makeWeiBot, makeBot } from "../bots.js";
import { buildOffice, FULL, FULL_COLS, BOT, DESK_TOP, DESK_PHONE, BAG_FLOOR } from "../sets/c04_office.js";

// clip windows: all the timing that changes when the recordings are retimed lives here (s2-her, the 8:12 story-time re-recording; same tap times as old-s2-her)
// v5: the recording is still from 4.6 to 8.1 and after 8.5, so read and decide were trimmed there to give her call room
// for her whole line (c04-wei, 3.87 s; v9, the Scq voice)
const WIN = {
  match: { clip: "s2-her", at: 3.7 },               // the month calendar, Dad's triangle on the 15th
  read: { clip: "s2-her", in: 3.7, out: 6.9 },      // tap today (4.3) › the day opens: 152/96 above target, "Dad noted …" (4.6)
  decide: { clip: "s2-her", in: 7.7, out: 10.3 },   // swipe down the day (8.1) › his question for the doctor (8.5)
};
const TAP_TODAY = 4.3, NOTE_UP = 4.6, SWIPE = 8.1, QUESTION = 8.5;

const T0 = 65;
const S = { match: [T0, T0 + 2.4], floor: [T0 + 2.4, T0 + 4.8], buzz: [T0 + 4.8, T0 + 6.3], read: [T0 + 6.3, T0 + 9.5],
  decide: [T0 + 9.5, T0 + 12.1], call: [T0 + 12.1, T0 + 17.6], go: [T0 + 17.6, T0 + 20.0] };
// her line on the phone: voice c04-wei (audio/voices-v5.json): "Dad," 0.03–0.32, "I'll come with you to Dr Lim at ten
// thirty!" 0.85–4.38 (seconds into the voice); it starts `at` seconds into the call shot (on a 1/30 s frame)
const VOICE = { id: "c04-wei", at: 0.7, dur: 3.87, phrases: [[0.03, 0.32], [0.49, 1.36], [1.71, 2.63], [2.91, 3.79]] }; // v9: Scq voice
/** k for a voiced speech bubble at film time t (VOICE_SYNC.md): its first frame (t >= at) is the voice's first frame;
 *  up for the voice's whole duration, then gone after a pop-out of at most two frames */
function voiceK(t, at, dur) {
  const e = t - at;
  if (e < -1e-4 || e > dur + 0.05 + 1e-4) return 0;
  return e <= dur ? Math.max(0.15, seg(e, 0, 0.15)) : lerp(0.12, 0.04, (e - dur) / 0.05);
}

const office = STAGE.set("c04.office", buildOffice());
const U = office.userData;
const wei = STAGE.need("wei", makeWeiBot);
const nb = FULL.map(([c, r], i) => STAGE.actor(`c04.n${i}`, makeBot({ body: FULL_COLS[i], scale: 0.95 })));
const PH = U.deskPhoneHolder, BAG = U.deskBag;

const CARD = (k) => (c) => timeCard(c, "8:12 AM", "Wei Ling · Office", k);
const ON = 9; // a time card that has long since slid in

// her arm poses (solved against bots.js's rig): the reach that lands on the phone's near end, the side hold she reads
// in, the hold against her right headphone, and the reach that lands in the bag's handle (standing at GRAB_AT)
const REACH = { armR: 1.76, armOutR: 0.08, lean: 0.3 };
const HOLD = { armR: 1.7, armOutR: 0.35, lean: 0.05 };
const EAR = { armR: 2.73, armOutR: 0.29 };
const BAGREACH = { armR: 0.3, armOutR: 0.3, lean: 0.35, squash: 0.25 };
const GRAB_AT = { x: BAG_FLOOR.x + 0.371, z: BAG_FLOOR.z - 0.12 };

// ---------- helpers ----------
const V3 = THREE.Vector3;
const _up = new V3();
/** camera with an explicit up vector (for the top-down start of the match cut) */
function camUp(pos, tgt, fov, up = [0, 1, 0]) {
  const c = STAGE.camera; c.position.set(...pos); _up.set(...up).normalize(); c.up.copy(_up); c.lookAt(...tgt);
  c.fov = fov; c.updateProjectionMatrix();
}
const mix3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

// --- the phone and the bag in world space (the office group and her desk group sit at the origin)
const _h = new V3(), _f = new V3(), _n = new V3(), _tp = new V3(), _x = new V3(), _z = new V3(), _c = new V3(), _w = new V3();
const _m = new THREE.Matrix4(), _im = new THREE.Matrix4(), _e = new THREE.Euler();
const poseA = { p: new V3(), q: new THREE.Quaternion() }, poseB = { p: new V3(), q: new THREE.Quaternion() };
/** a phone-holder pose from a centre, a screen normal and a rough direction for the phone's top (holder: +y = screen, -z = top) */
function orient(out, pos, n, top) {
  _n.copy(n).normalize(); _tp.copy(top).addScaledVector(_n, -top.dot(_n)).normalize();
  _z.copy(_tp).negate(); _x.crossVectors(_n, _z);
  _m.makeBasis(_x, _n, _z); out.q.setFromRotationMatrix(_m); out.p.copy(pos); return out;
}
function deskPose(out) { out.p.set(DESK_PHONE.x, DESK_TOP + 0.0098, DESK_PHONE.z); out.q.setFromEuler(_e.set(0, DESK_PHONE.yaw, 0)); return out; }
const hand = () => { wei.g.updateMatrixWorld(true); return wei.hands[1].getWorldPosition(_h); };
/** read: held on edge at her right side, its back to the camera, the screen turned to her visor */
function readPose(out) {
  const h = hand();
  _f.set(0, 0, 1).transformDirection(wei.body.matrixWorld); _f.y = 0; _f.normalize();
  _c.copy(h).addScaledVector(_f, 0.09); _c.y += 0.02; // her hand grips the phone's near end
  _w.set(0, 0.27, 0.235).applyMatrix4(wei.head.matrixWorld).sub(_c);
  return orient(out, _c, _w, _f.clone().negate());
}
/** ear: flat against the outside of her right headphone, its lower end in her hand */
function earPose(out) {
  const h = hand();
  _im.copy(wei.head.matrixWorld).invert();
  const hl = h.clone().applyMatrix4(_im);
  const topL = new V3(0, 0.87, -0.5).normalize();
  const cl = new V3(-0.41, hl.y, hl.z).addScaledVector(topL, 0.1);
  _c.copy(cl).applyMatrix4(wei.head.matrixWorld);
  const n = new V3(1, 0, 0).transformDirection(wei.head.matrixWorld), top = topL.clone().transformDirection(wei.head.matrixWorld);
  return orient(out, _c, n, top);
}
/** carry: pressed screen-in against the front of her right hand */
function carryPose(out) {
  const h = hand(), am = wei.arms[0].matrixWorld;
  const ay = new V3(0, 1, 0).transformDirection(am), az = new V3(0, 0, 1).transformDirection(am);
  _c.copy(h).addScaledVector(az, 0.085).addScaledVector(ay, 0.07);
  return orient(out, _c, az.clone().negate(), ay);
}
function placePhone(a, b = null, k = 0) {
  if (!b || k <= 0) { PH.position.copy(a.p); PH.quaternion.copy(a.q); return; }
  PH.position.lerpVectors(a.p, b.p, k); PH.quaternion.slerpQuaternions(a.q, b.q, Math.min(1, k));
}
const bagFloor = () => { BAG.position.set(BAG_FLOOR.x, 0, BAG_FLOOR.z); BAG.rotation.set(0, BAG_FLOOR.yaw, 0); };
/** the bag hanging from her right hand (upright, a little swing), blended up from the floor by k */
function bagCarry(k, yaw, swing) {
  const h = hand();
  const cx = h.x, cy = h.y - 0.245, cz = h.z;
  BAG.position.set(lerp(BAG_FLOOR.x, cx, k), lerp(0, cy, k), lerp(BAG_FLOOR.z, cz, k));
  BAG.rotation.set(swing * 0.5 * k, lerp(BAG_FLOOR.yaw, yaw, k), swing * k);
}
/** screen position (canvas px) of a world point; call inside an ov closure */
const _s = new V3();
const toScreen = (v) => { _s.copy(v).project(STAGE.camera); return [(_s.x + 1) * 960, (1 - _s.y) * 540]; };

/** the common set-up of every shot: the set, fog, lights, props reset, crowd typing */
function setup(t, o = {}) {
  STAGE.show("c04.office");
  STAGE.scene.fog = U.fog;
  STAGE.lights("lab", { sky: "#a08cff", ground: "#1c0c52", hemi: 0.85, key: "#fff2ea", keyI: 1.6, rim: "#ff4fd0", rimI: 0.9, bg: "#4a1aa0",
    keyPos: o.keyPos ?? [3.2, 6.5, 5.5], keyTarget: o.keyTarget ?? [0, 0.6, -0.8] });
  BAG.visible = true; bagFloor(); U.chair.rotation.y = 0; U.chair.position.set(BOT.x, 0, -0.58);
  PH.visible = true; placePhone(deskPose(poseA));
  U.crowd.update(t, { popAt: o.popAt, tapK: o.tapK });
  U.setCount(U.crowd.total);
}
/** a quick blink between faces: returns "blink" for 0.08 s before `at` */
const faceAt = (lt, keys) => { let f = keys[0][1]; for (const [a, name] of keys) { if (lt >= a) f = name; if (lt >= a - 0.08 && lt < a && a > 0) return "blink"; } return f; };
const typeArms = (t, k = 1, ph = 0) => { const p = t * 9.5 + ph; return { armL: 1.32 + Math.sin(p) * 0.14 * k, armR: 1.32 + Math.sin(p + Math.PI) * 0.14 * k }; };
/** the five neighbours, typing; look[i] 0..1 turns a head toward her */
function poseNeighbours(t, o = {}) {
  FULL.forEach(([c, r], i) => {
    const x = c * 2 + BOT.x, z = -r * 2 + BOT.z, look = o.look?.[i] ?? 0;
    const toHer = Math.atan2(BOT.x - x, BOT.z - z);
    const blink = ((t * 0.31 + hash(i * 5.1)) % 1) < 0.035;
    STAGE.pose(`c04.n${i}`, { x, z, dy: BOT.dy, sit: 1, ...typeArms(t * (0.92 + i * 0.05), 1 - look, i * 1.9),
      headPitch: 0.1 - look * 0.1 + Math.abs(Math.sin(t * 4.6 + i)) * 0.03, headYaw: lerp(0.25, clamp(toHer, -1.2, 1.2), look),
      face: blink ? "blink" : (o.face?.[i] ?? (i === 3 ? "happy" : "code")), tilt: wob(t, 0.3, i) * 0.04, ear: look,
      ...(o.cheer?.[i] != null ? { wave: o.cheer[i] * 1.5, armR: 0, ear: 1 } : {}) });
  });
}
/** Wei typing at her desk */
const weiTyping = (t, o = {}) => ({ x: BOT.x, z: BOT.z, dy: BOT.dy, sit: 1, ...typeArms(t, o.k ?? 1), headYaw: 0.28, headPitch: 0.1 + Math.abs(Math.sin(t * 4.75)) * 0.03,
  tilt: wob(t, 0.4) * 0.04, face: "code", squash: Math.sin(t * 2.2) * 0.03 });
/** a horizontal smear of the frame so far (motion blur for the whip pan), then speed lines */
const smearCv = document.createElement("canvas"); smearCv.width = 1920; smearCv.height = 1080;
function smear(c, amt, lines = 0) {
  if (amt <= 0.5) return;
  const x = smearCv.getContext("2d"); x.clearRect(0, 0, 1920, 1080); x.drawImage(c.canvas, 0, 0);
  c.save(); const n = 7;
  for (let i = 1; i <= n; i++) { c.globalAlpha = 1 / (i + 1); c.drawImage(smearCv, -amt * (i / n), 0); }
  c.globalAlpha = 1; c.restore();
  if (lines > 0) { c.save(); for (let i = 0; i < 26; i++) { const y = hash(i * 3.3) * 1080, w = 300 + hash(i * 7.7) * 900, x0 = hash(i * 1.3) * 1920 - 300;
    c.fillStyle = `rgba(255,${i % 2 ? 240 : 170},${i % 2 ? 255 : 230},${0.25 * lines})`; c.fillRect(x0, y, w, 2 + hash(i) * 5); } c.restore(); }
}
/** comic vibration marks around a prop (projected to the screen), re-drawn on twos */
const _v = new V3();
function vib(c, obj, age, r0 = 120) {
  obj.getWorldPosition(_v); _v.project(STAGE.camera);
  const x = (_v.x + 1) * 960, y = (1 - _v.y) * 540, f = Math.floor(age * 15);
  c.save(); c.lineCap = "round";
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const r = r0 + i * 34 + (hash(f * 3 + i + side) - 0.5) * 14, a0 = side > 0 ? -0.45 : Math.PI - 0.45;
    c.beginPath(); c.arc(x, y, r, a0, a0 + 0.9);
    c.lineWidth = 14; c.strokeStyle = "#1a1030"; c.stroke(); c.lineWidth = 7; c.strokeStyle = i % 2 ? "#e9dcff" : "#ffffff"; c.stroke();
  }
  c.restore();
}
const PANEL = { x: 1440, y: 520, w: 400, h: 866 };
function appPanel(ov, wait, w, lt, k, o = {}) {
  const src = Math.min(w.out, w.in + lt); let img = null;
  wait(frame(w.clip, src).then((i) => { img = i; U.deskPhone.setScreen(i); }));
  ov.push((c) => panel(c, img, PANEL.x, PANEL.y, PANEL.w, PANEL.h, k, o));
  return src;
}

// ---------- 4a · match cut: her phone on the desk shows Dad's calendar; pull back to her typing ----------
shot("c04 match", ...S.match, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera and panels on plain time
  setup(t);
  let cal = null;
  wait(frame(WIN.match.clip, WIN.match.at).then((img) => { cal = img; U.deskPhone.setScreen(img); }));
  STAGE.pose("wei", weiTyping(lt));
  poseNeighbours(t);
  // the phone screen's centre and its "up" (the phone's top points toward her). At lc 0 the camera looks straight down
  // so the screen (0.072 x 0.156 m) fills exactly c03's last panel: 400 x 866 px centred at (1400, 530), fov 36:
  // (0.156 m x PHONE_S 1.35 = 0.2106 m): d = 0.2106 * 1080 / (866 * 2 tan 18°) = 0.4042 m; 4112 px per metre, so 440 px
  // right = 0.1070 m, 10 px up = 0.0024 m
  const yaw = DESK_PHONE.yaw, top = [-Math.sin(yaw), 0, -Math.cos(yaw)], right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const sc = [DESK_PHONE.x, DESK_TOP + 0.0214, DESK_PHONE.z], sh = -0.107, sv = -0.0024;
  const d0 = 0.4042 * (1 + seg(lc, 0.3, 0.9) * 0.04);
  const tgt0 = [sc[0] + right[0] * sh + top[0] * sv, sc[1], sc[2] + right[2] * sh + top[2] * sv], pos0 = [tgt0[0], sc[1] + d0, tgt0[2] + 0.0005];
  const pos1 = [-0.62, 1.78, 1.62], tgt1 = [0.1, 0.78, -0.38];
  const k = kf(lc, [[0.5, 0], [2.2, 1]], (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2));
  const drift = seg(lc, 1.85, 2.4) * 0.08;
  const pos = mix3(pos0, pos1, k), tgt = mix3(tgt0, tgt1, k);
  pos[0] -= drift; pos[2] += drift;
  camUp(pos, tgt, 36, mix3(top, [0, 1, 0], ease(k)));
  // the cut lands on c03's panel exactly (same place, size, border), now showing her calendar; it dissolves into her
  // pink phone lying on the desk underneath, then the camera pulls back
  const pa = 1 - ease(seg(lc, 0.12, 0.45));
  ov.push((c) => { if (pa <= 0) return; c.save(); c.globalAlpha = pa; panel(c, cal, 1400, 530, 400, 866, 1, { noPop: true }); c.restore(); });
  ov.push(CARD(seg(lt, 0.9, 1.35)));
  ov.push((c) => sfx(c, "TAP TAP TAP", 640, 300, 74, lt - 1.55, { life: 0.85, burst: false, fill: ["#bff6ff", "#39d3ff"], rot: -0.08 }));
  return { dotK: lerp(0.25, 1, ease(seg(lc, 0.5, 1.8))), inkK: lerp(0.5, 0.92, seg(lc, 0.5, 1.5)), bloom: 0.55 };
});

// ---------- 4b · the floor: crane up and back; the far desks pop in, everyone types ----------
shot("c04 floor", ...S.floor, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera on plain time
  // (v5: 2.8 s -> 2.4 s; every beat scaled by 6/7)
  const popAt = (d) => (d < 9 ? 1 : pop(lt, 0.13 + (d - 9) * 0.031, 0.35));
  setup(t, { popAt, keyPos: [4, 9, 8], keyTarget: [0, 0, -3] });
  wait(frame(WIN.match.clip, WIN.match.at).then((img) => U.deskPhone.setScreen(img)));
  STAGE.pose("wei", weiTyping(lt + 2.4));
  poseNeighbours(t);
  U.setCount(1 + U.crowd.within(Math.max(9, 9 + (lt - 0.13 - 0.17) / 0.031)));
  const k = kf(lc, [[0, 0], [2.4, 1]], (x) => 1 - Math.pow(1 - x, 2.4));
  const kt = ease(seg(lc, 0, 1.9));
  camUp(mix3([0.12, 3.4, 0.25], [-2.6, 9.2, 11.5], k), mix3([0.12, 0, -0.45], [1.4, 0, -14], kt), lerp(40, 42, k), mix3([0, 0, -1], [0, 1, 0], kt));
  ov.push(CARD(ON));
  ov.push((c) => flashHit(c, lc - 0.4, "#bff6ff"));
  ov.push((c) => sfx(c, "POP! POP!", 1390, 250, 96, lt - 0.47, { life: 1.0, burst: "#39d3ff", dots: "rgba(255,95,168,.4)", fill: ["#ffd0ea", "#ff5fa8"] }));
  ov.push((c) => sfx(c, "POP!", 470, 330, 78, lt - 1.0, { life: 0.8, burst: "#ff9ad8" }));
  [[1.24, 1500, 560], [1.46, 300, 520], [1.67, 1150, 430], [1.84, 760, 300], [2.0, 1680, 400]].forEach(([a, x, y], i) =>
    ov.push((c) => sfx(c, i % 2 ? "TAP TAP" : "TAP TAP TAP", x, y, 50 + (i % 3) * 8, lt - a, { life: 0.7, burst: false, fill: ["#bff6ff", "#39d3ff"] })));
  return { bloom: 0.65 };
});

// ---------- 4c · BZZT: the phone rattles on the desk; she jolts, reaches, and picks it up (cut on the lift) ----------
shot("c04 buzz", ...S.buzz, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera and panels on plain time
  setup(t);
  const hit = 0.12, grab = 1.08, buzz = lt > hit && lt < grab;
  const fl = buzz ? 0.6 + 0.4 * Math.sin((lt - hit) * 40) : lt > hit ? 0.15 : 0;
  wait(frame(WIN.match.clip, WIN.match.at).then((img) => U.deskPhone.setScreen(img, Math.max(0, fl))));
  // she types, freezes on the buzz, jolts (anticipation dip, perk), looks at the phone, pulls back a touch, reaches,
  // lands her hand on it (a small squash), and lifts it toward her into the side hold she reads in
  const freeze = lt > hit + 0.1;
  const jolt = kf(lt, [[hit + 0.08, 0], [hit + 0.16, 0.35], [hit + 0.28, -0.25], [hit + 0.45, 0.05], [hit + 0.6, 0]]);
  const look = ease(seg(lt, hit + 0.15, hit + 0.4));
  const reach = kf(lt, [[0.62, 0], [0.76, -0.12], [grab - 0.02, 1]]);
  const lift = ease(seg(lt, grab + 0.06, grab + 0.36));
  const land = kf(lt, [[grab - 0.04, 0], [grab + 0.02, 0.18], [grab + 0.14, -0.06], [grab + 0.24, 0]]);
  const ty = typeArms(lt, freeze ? 0 : 1);
  const armR0 = freeze ? lerp(1.32, 1.05, look) : ty.armR;
  const r = Math.max(0, reach);
  STAGE.pose("wei", { x: BOT.x, z: BOT.z, dy: BOT.dy + Math.max(0, -jolt) * 0.05, sit: 1, squash: jolt + land,
    armL: freeze ? lerp(1.32, 0.95, look) : ty.armL, armOutL: 0.12,
    armR: lerp(lerp(armR0 - Math.min(0, reach) * 0.6, REACH.armR, r), HOLD.armR, lift), armOutR: lerp(lerp(0.1, REACH.armOutR, r), HOLD.armOutR, lift),
    lean: lerp(r * REACH.lean, HOLD.lean, lift) - Math.min(0, reach) * 0.2,
    headYaw: lerp(lerp(0.28, -0.12, look), -0.3, lift), headPitch: lerp(lerp(0.1, 0.42, look), 0.3, lift), ear: look, tilt: wob(lt, 0.7) * 0.03,
    face: faceAt(lt, [[0, "code"], [hit + 0.2, "wow"]]) });
  // the phone: rattles on the desk until her hand lands on it, then rises with her hand into the side hold
  deskPose(poseA);
  if (buzz) { const j = lt * 60; poseA.p.x += Math.sin(j * 2.1) * 0.004; poseA.p.z += Math.cos(j * 1.7) * 0.004; poseA.p.y += Math.abs(Math.sin(j * 3.3)) * 0.003;
    poseA.q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), Math.sin(j * 2.9) * 0.06)); }
  if (lt >= grab) { readPose(poseB); placePhone(poseA, poseB, lift); } else placePhone(poseA);
  poseNeighbours(t);
  const punch = easeOut(seg(lc, hit, hit + 0.12)), k = ease(seg(lc, 0, 1.5));
  camUp([lerp(-1.04, -0.97, k), lerp(1.04, 1.0, k), lerp(0.52, 0.45, k)], [lerp(-0.02, 0.0, k), 0.8, -0.3], lerp(46, 41, punch));
  ov.push((c) => { if (buzz) vib(c, PH, lt - hit, 90); });
  ov.push(CARD(ON));
  ov.push((c) => flashHit(c, lc - hit, "#e9dcff"));
  ov.push((c) => sfx(c, "BZZT!", 640, 700, 104, lt - hit - 0.07, { life: 1.0, burst: "#e9dcff", dots: "rgba(155,107,255,.4)", fill: ["#f4ecff", "#9b6bff"] }));
  ov.push((c) => sfx(c, "BZZT", 1300, 560, 66, lt - hit - 0.35, { life: 0.7, burst: false, fill: ["#e9dcff", "#9b6bff"] }));
  ov.push((c) => sfx(c, "!", 1240, 210, 96, lt - hit - 0.12, { life: 0.9, burst: false, fill: ["#ffe37a", "#ff8a1f"] }));
  return { bloom: 0.6 };
});

// ---------- 4d · the app: she opens today: 152/96 above Dr Lim's target, "Dad noted …"; worry ----------
shot("c04 read", ...S.read, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera and panels on plain time
  setup(t);
  const tapLt = TAP_TODAY - WIN.read.in, noteLt = NOTE_UP - WIN.read.in;
  const worry = noteLt + 0.75;
  const tap = kf(lt, [[tapLt - 0.15, 0], [tapLt - 0.05, 0.1], [tapLt + 0.08, -0.04], [tapLt + 0.25, 0]]);
  const leanIn = ease(seg(lt, noteLt + 0.1, noteLt + 0.5));
  const jolt = kf(lt, [[worry - 0.05, 0], [worry + 0.05, 0.3], [worry + 0.2, -0.15], [worry + 0.4, 0]]);
  STAGE.pose("wei", { x: BOT.x, z: BOT.z, dy: BOT.dy, sit: 1, armR: HOLD.armR + tap, armOutR: HOLD.armOutR, armL: 0.95 + wob(lt, 0.5) * 0.04, armOutL: 0.12,
    headYaw: -0.3 - leanIn * 0.04, headPitch: 0.3 + leanIn * 0.08 - (lt > worry ? 0.08 : 0), lean: HOLD.lean + leanIn * 0.08, squash: jolt + Math.sin(lt * 2.3) * 0.025,
    tilt: lt > worry ? 0.12 + wob(lt, 0.6) * 0.03 : wob(lt, 0.4) * 0.03, ear: lt > worry ? -0.7 : 0.2,
    face: faceAt(lt, [[0, "code"], [worry, "worry"]]) });
  placePhone(readPose(poseA));
  poseNeighbours(t);
  const k = ease(seg(lc, 0, 3.2));
  camUp(mix3([-1.3, 1.28, 1.62], [-1.14, 1.24, 1.42], k), mix3([0.62, 0.84, -0.5], [0.58, 0.86, -0.52], k), 34);
  ov.push(CARD(ON));
  ov.push((c) => sfx(c, "tap", 520, 700, 46, lt - tapLt, { life: 0.5, burst: false, fill: ["#ffffff", "#bff6ff"] }));
  ov.push((c) => flashHit(c, lc - worry, "#fff3b0"));
  ov.push((c) => sfx(c, "!?", 420, 250, 110, lt - worry - 0.07, { life: 1.6, burst: "#ffd94a", dots: "rgba(255,95,168,.35)", fill: ["#ff8fb0", "#ff3f7f"] }));
  appPanel(ov, wait, WIN.read, lc, seg(lt, 0, 0.3));
  return { bloom: 0.5 };
});

// ---------- 4e · his question; she looks at Dad's photo; resolve ----------
shot("c04 decide", ...S.decide, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera and panels on plain time
  setup(t);
  const swipe = SWIPE - WIN.decide.in, q = QUESTION - WIN.decide.in;
  const lookPhoto = kf(lt, [[q + 0.15, 0], [q + 0.45, 1], [q + 1.0, 1], [q + 1.2, 0]]);
  const resolve = q + 1.1;
  const sw = kf(lt, [[swipe - 0.1, 0], [swipe, 0.12], [swipe + 0.2, -0.08], [swipe + 0.35, 0]]);
  const pump = kf(lt, [[resolve, 0], [resolve + 0.12, -0.2], [resolve + 0.3, 1.0], [resolve + 0.5, 0.85]], easeOut);
  const sq = kf(lt, [[resolve - 0.05, 0], [resolve + 0.08, 0.3], [resolve + 0.25, -0.25], [resolve + 0.45, 0.05], [resolve + 0.6, 0]]);
  STAGE.pose("wei", { x: BOT.x, z: BOT.z, dy: BOT.dy, sit: 1, armR: HOLD.armR + sw, armOutR: HOLD.armOutR, armL: lerp(0.95, 2.2, pump), armOutL: 0.12 + pump * 0.15,
    headYaw: lerp(-0.34, -1.15, ease(lookPhoto)), headPitch: lerp(0.3, 0.22, lookPhoto) - (lt > resolve ? 0.12 * clamp((lt - resolve) * 3) : 0),
    tilt: lt < resolve ? 0.12 + wob(lt, 0.5) * 0.03 : wob(lt, 0.5) * 0.03, squash: sq + Math.sin(lt * 2.3) * 0.02,
    ear: lt > resolve ? 1 : -0.7 + lookPhoto * 0.4, lean: HOLD.lean + (lt > resolve ? 0.08 : 0.08),
    face: faceAt(lt, [[0, "worry"], [q + 0.75, "sad"], [resolve, "code"]]) });
  placePhone(readPose(poseA));
  poseNeighbours(t, { cheer: [0, 0, 0, lt > resolve + 0.25 ? lt : null, 0], face: [null, null, null, lt > resolve + 0.25 ? "love" : null] });
  const k = ease(seg(lc, 0, 2.6));
  const toPhoto = ease(kf(lc, [[q + 0.15, 0], [q + 0.45, 1], [q + 1.0, 1], [q + 1.2, 0]])) * 0.06;
  camUp(mix3([-1.0, 1.12, 1.18], [-0.9, 1.1, 1.04], k), [0.56 - toPhoto * 2, 0.9, -0.5], 34);
  ov.push(CARD(ON));
  ov.push((c) => sfx(c, "swish", 470, 780, 44, lt - swipe, { life: 0.5, burst: false, fill: ["#ffffff", "#bff6ff"] }));
  ov.push((c) => flashHit(c, lc - resolve - 0.05, "#bff6ff"));
  ov.push((c) => sfx(c, "!", 600, 230, 120, lt - resolve - 0.12, { life: 1.4, burst: "#39d3ff", dots: "rgba(255,255,255,.35)", fill: ["#ffe37a", "#ff8a1f"] }));
  appPanel(ov, wait, WIN.decide, lc, 1, { noPop: true });
  return { bloom: 0.5 };
});

// ---------- 4f · she calls him: the phone goes from the side hold to her right headphone ----------
shot("c04 call", ...S.call, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera on plain time
  setup(t);
  wait(frame(WIN.decide.clip, WIN.decide.out).then((img) => U.deskPhone.setScreen(img)));
  // the phone goes up to her ear, one short ring (it ends before she speaks), then her whole line (VOICE); she talks
  // only while the voice speaks, smiles on "I'll come with you", and stops when it ends
  const up = kf(lt, [[0, 0], [0.1, -0.12], [0.4, 1]], easeOut);
  const e = lt - VOICE.at, speaking = VOICE.phrases.some(([a, b]) => e >= a && e < b);
  const talk = speaking ? Math.abs(Math.sin(e * 11)) * 0.07 : 0;
  const nodTen = kf(e, [[3.55, 0], [3.7, 0.1], [3.95, -0.02], [4.15, 0]]); // a nod on "ten thirty!"
  STAGE.pose("wei", { x: BOT.x, z: BOT.z, dy: BOT.dy, sit: 1, armR: lerp(HOLD.armR, EAR.armR, up), armOutR: lerp(HOLD.armOutR, EAR.armOutR, up),
    armL: lerp(2.0, 0.9, ease(seg(lt, 0.1, 0.5))) + wob(lt, 0.8) * 0.05 + (speaking ? wob(e, 0.7) * 0.12 : 0),
    armOutL: 0.2, headYaw: lerp(-0.1, 0.18, ease(seg(lt, 0.3, 0.8))) + (speaking ? wob(e, 0.45) * 0.05 : 0), headPitch: -0.05 + talk + nodTen,
    tilt: -0.12 + wob(lt, 0.45) * 0.05, lean: 0.1, ear: 1, squash: Math.sin(lt * 2.4) * 0.03 + talk * 0.4,
    face: faceAt(lt, [[0, "code"], [VOICE.at + 0.9, "happy"]]) });
  readPose(poseA); earPose(poseB); placePhone(poseA, poseB, clamp(up));
  // her left neighbour turns to look, then goes back to work
  const look0 = kf(lt, [[2.0, 0], [2.3, 1], [3.6, 1], [3.9, 0]]);
  poseNeighbours(t, { look: [0, look0, 0, 0, 0], face: ["code", look0 > 0.5 ? "wow" : "code"] });
  const a = lerp(-0.76, -0.5, ease(seg(lc, 0, 5.5))), R = 1.85;
  camUp([BOT.x + Math.sin(a) * R, 1.14, BOT.z + Math.cos(a) * R], [BOT.x + 0.38, 0.98, BOT.z], 36);
  ov.push(CARD(ON));
  ov.push((c) => sfx(c, "BRRING", 380, 330, 58, lt - 0.25, { life: 0.4, burst: false, fill: ["#e9dcff", "#9b6bff"] }));
  ov.push((c) => bubble(c, ["Dad, I'll come with you to Dr Lim at 10:30!"], 1240, 170, 980, 400, voiceK(tc, S.call[0] + VOICE.at, VOICE.dur), { size: 40, voice: VOICE.id }));
  return { bloom: 0.5 };
});

// ---------- 4g · she grabs her bag and runs; whip pan right (hand-off) ----------
shot("c04 go", ...S.go, ({ t: tc, lt: lc, ov, wait }) => {
  const t = twos(tc), lt = twos(lc); // poses and overlays on twos; camera on plain time
  setup(t);
  wait(frame(WIN.decide.clip, WIN.decide.out).then((img) => U.deskPhone.setScreen(img)));
  const down = ease(seg(lt, 0, 0.3));
  const grab = 0.86;
  // hop off the chair: dip, spring, land beside it, where her reach lands in the bag's handle
  const hop = seg(lt, 0.42, 0.66);
  const sit = lt < 0.42 ? 1 : 1 - ease(hop);
  const arc = lt > 0.42 && lt < 0.66 ? Math.sin(hop * Math.PI) * 0.12 : 0;
  const sq = kf(lt, [[0.2, 0], [0.4, 0.35], [0.5, -0.35], [0.64, 0], [0.7, 0.3], [0.8, 0]]);
  const turn = backOut(seg(lt, 1.02, 1.3), 1.4);
  const run = seg(lt, 1.18, 2.4), runE = Math.pow(run, 1.6);
  const HX = GRAB_AT.x, HZ = GRAB_AT.z;
  const x = lt < 0.66 ? lerp(BOT.x, HX, ease(seg(lt, 0.42, 0.66))) : lt < 1.18 ? HX : lerp(HX, 4.0, runE);
  const z = lt < 0.66 ? lerp(BOT.z, HZ, ease(seg(lt, 0.42, 0.66))) : lerp(HZ, -1.24, ease(seg(lt, 0.98, 1.45)));
  const reach = kf(lt, [[0.62, 0], [grab, 1], [grab + 0.08, 1], [1.08, 0.1]], easeOut);
  const lift = kf(lt, [[grab + 0.04, 0], [1.02, 1]]);
  const bob = run > 0 ? Math.abs(Math.sin(lt * 17)) * 0.04 : 0;
  const rotY = lerp(0, Math.PI / 2, turn);
  const armRrest = lt < 0.3 ? lerp(EAR.armR, 0.3, down) : 0.3;
  STAGE.pose("wei", { x, z, dy: (lt < 0.42 ? BOT.dy : lt < 0.66 ? lerp(BOT.dy, 0, ease(hop)) : 0) + arc + bob, sit,
    squash: sq + reach * BAGREACH.squash, rotY, walk: run > 0 ? lt * 17 : 0,
    lean: run > 0 ? 0.32 : lt > 1.08 ? -0.15 * seg(lt, 1.08, 1.18) : reach * BAGREACH.lean,
    armR: lerp(armRrest, BAGREACH.armR, reach), armOutR: lt < 0.3 ? lerp(EAR.armOutR, 0.12, down) : lerp(0.12, BAGREACH.armOutR, reach),
    armL: lt < 0.3 ? lerp(0.9, 0.3, seg(lt, 0, 0.3)) : 0.3, headYaw: lt < 1.0 ? -0.55 * reach : -1.1 * ease(seg(lt, 1.2, 1.5)), headPitch: 0.05 + reach * 0.3, ear: 1,
    face: faceAt(lt, [[0, "happy"], [0.4, "code"]]), tilt: wob(lt, 0.8) * 0.04 });
  // the phone goes from her ear into her right hand and stays there; the bag rises from the floor into the same hand
  carryPose(poseB);
  if (lt < 0.3) { earPose(poseA); placePhone(poseA, poseB, down); } else placePhone(poseB);
  if (lt >= grab) bagCarry(lift, BAG_FLOOR.yaw + rotY * 0.8, (run > 0 ? Math.sin(lt * 17) * 0.12 : 0) + Math.sin((lt - grab) * 14) * Math.exp(-(lt - grab) * 5) * 0.25 * (1 - run));
  U.chair.rotation.y = lt > 0.5 ? easeOut(seg(lt, 0.5, 1.6)) * 4.2 : 0;
  U.chair.position.z = -0.58 + easeOut(seg(lt, 0.5, 1.2)) * -0.12;
  poseNeighbours(t);
  // camera: high on her right, looking along the aisle behind her desk, so the hop, the grab and the run all stay in
  // view (a front camera loses her behind her own desk and monitor); follow her, then a whip to the right
  const whip = easeIn(seg(lc, 2.02, 2.4));
  const follow = clamp(lc < 1.18 ? HX : lerp(HX, 4.0, Math.pow(seg(lc, 1.18, 2.4), 1.6)), -0.3, 2.6);
  const k0 = ease(seg(lc, 0, 2.0));
  const base = [lerp(-1.8, -1.5, k0), 2.45, lerp(1.05, 0.9, k0)];
  const look = [lerp(-0.3, follow, 0.75), 0.5, lerp(-0.7, -1.05, k0)];
  const dx = look[0] - base[0], dz = look[2] - base[2], yaw = Math.atan2(dx, dz) + whip * 1.4, L = Math.hypot(dx, dz);
  camUp(base, [base[0] + Math.sin(yaw) * L, look[1] - whip * 0.1, base[2] + Math.cos(yaw) * L], 40, [Math.sin(whip * 0.12), 1, 0]);
  const her = new V3(x, 0.9, z);
  ov.push((c) => smear(c, whip * 260, whip));
  ov.push(CARD(ON));
  ov.push((c) => sfx(c, "HUP!", 1150, 300, 80, lt - 0.48, { life: 0.8, burst: false, fill: ["#ffe37a", "#ff8a1f"] }));
  ov.push((c) => flashHit(c, lc - grab - 0.04, "#ffd9a0", 2));
  ov.push((c) => sfx(c, "GRAB!", 640, 740, 92, lt - grab - 0.03, { life: 0.9, burst: "#ff9a2e", dots: "rgba(255,255,255,.35)" })); // beside the bag at the grab, held still while the camera follows her
  ov.push((c) => { const [hx, hy] = toScreen(her); sfx(c, "WHOOSH", hx - 330, hy - 120, 110, lt - 1.36, { life: 1.0, burst: false, fill: ["#bff6ff", "#39d3ff"], rot: -0.06 }); });
  return { bloom: 0.5 };
});
