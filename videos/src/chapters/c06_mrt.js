// Chapter 6 · MRT to the clinic (film 115–127 s). Copies the reference's subway (platform, SCREEEE, DING-DONG, a
// swaying carriage, "Morning, little guy!") as a Singapore Circle Line ride: out of black onto the Bishan platform as the
// train pulls in behind the screen doors; the doors open and Mr Tan hops the gap; in the carriage everyone sways
// (CLACK-CLACK) while Wei Ling shows him the visit on her phone and a young man says "Morning, uncle!"; at Caldecott the
// doors close behind them (DING-DONG) and we hard-cut to the clinic.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, backOut, clamp, lerp, boil, twos } from "../core.js";
import { timeCard, sfx, bubble, flashHit, panel } from "../overlay.js";
import { makeTanBot, makeWeiBot } from "../bots.js";
import { makeExtra } from "../chars.js";
import { makeScreenPhone, makeBag, PHONE_S } from "../sets/c04_office.js"; // her pink phone and the orange bag she grabbed in her office
import { frame } from "../media.js";
import { box } from "../sets/kit.js";
import { toon, flat } from "../look.js";
import { buildPlatform, buildCarriage, setPlatformDoors, setStation, setCarriage } from "../sets/c06_mrt.js";

// clip windows: what Wei Ling's phone shows (her app, the story-time recording s1-her: "Dad took his morning medicine at
// 8:47" on the home card, then today with the visit planned for 10:30; the old clip still said "Not yet" at 10:05)
const WIN = {
  home: { clip: "s1-her", at: 0.5 },
  visit: { clip: "s1-her", at: 6.3 },
  card: { srcY: 128, srcH: 246 },   // the "Visit planned · 10:30 · Blossom Family Clinic · Dr Lim" card, for the callout
};
// shot boundaries (film seconds); v5: the carriage shot gave 0.3 s to the phone shot so the two voiced lines fit one
// after the other
const T = { a: 115, b: 118.2, c: 120.2, d: 122.7, e: 125.6, f: 127 };
// the two voiced lines in the phone shot (audio/voices-v5.json): `at` = seconds into the shot of the voice's (and its
// bubble's) first frame, on a 1/30 s frame; Mr Tan's reply starts 0.22 s after the young man's greeting ends
const GREET = { id: "c06-passenger", at: 0.8, dur: 0.98, speak: [-0.02, 0.85] };
const REPLY = { id: "c06-tan", at: 2.0, dur: 0.48, speak: [0.03, 0.45] };
/** k for a voiced speech bubble at film time t (VOICE_SYNC.md): its first frame (t >= at) is the voice's first frame;
 *  up for the voice's whole duration, then gone after a pop-out of at most two frames */
function voiceK(t, at, dur) {
  const e = t - at;
  if (e < -1e-4 || e > dur + 0.05 + 1e-4) return 0;
  return e <= dur ? Math.max(0.15, seg(e, 0, 0.15)) : lerp(0.12, 0.04, (e - dur) / 0.05);
}
/** seconds into voice v if it is speaking at shot time lt, else -1 */
const speakingAt = (lt, v) => { const e = lt - v.at; return e >= Math.max(0, v.speak[0]) && e < v.speak[1] ? e : -1; };

const plat = STAGE.set("c06.platform", buildPlatform());
const car = STAGE.set("c06.carriage", buildCarriage());
const props = STAGE.set("c06.props", new THREE.Group()); // props that follow the shared actors (never parented to them)
STAGE.need("tan", makeTanBot);
STAGE.need("wei", makeWeiBot);
const phone = makeScreenPhone(); props.add(phone.g);
const bag = makeBag(); props.add(bag); bag.traverse((m) => { if (m.isMesh) m.castShadow = true; });
const P = plat.userData, SEAT = car.userData.seatX;

// ---- extras: block people in Singapore weekday-morning clothes
function extra(name, cols, dress) {
  const a = makeExtra(...cols);
  dress?.(a);
  a.g.rotation.order = "ZYX"; // so a roll set after pose() leans along the train in world space
  return STAGE.actor("c06." + name, a);
}
/** chars.js raises brows by turning their inner ends down (it reads as a frown); turn them up for a friendly face */
function friendlyBrows(a, k) {
  for (const m of a.head.children) {
    const gp = m.geometry?.parameters; if (!gp || gp.width !== 0.09 || gp.height !== 0.022) continue;
    m.rotation.z = Math.sign(-m.position.x) * k * 0.28; m.position.y = 0.335 + k * 0.02;
  }
}
const handPhone = (a, arm) => { const p = box(0.08, 0.15, 0.014, toon("#1b1825"), 0, -0.62, 0.07); p.rotation.x = 0.3; a.arms[arm].add(p); const s = box(0.068, 0.13, 0.004, flat("#bfe4ff"), 0, -0.62, 0.079); s.rotation.x = 0.3; a.arms[arm].add(s); };
const X = {
  p1: extra("p1", ["#ff6fa0", "#2f3550", "#2a1a1a", "#e3b08a"], (a) => handPhone(a, 1)), // office lady
  p2: extra("p2", ["#ffd23f", "#3b3f6b", "#1a1420", "#a8704a"], (a) => { a.body.add(box(0.42, 0.5, 0.2, toon("#3f66d9"), 0, 0.32, -0.25)); a.body.add(box(0.3, 0.2, 0.06, toon("#5b85f0"), 0, 0.22, -0.37)); }), // student
  p3: extra("p3", ["#b56cff", "#4a3a5a", "#8a8a96", "#d79a74"], (a) => { a.arms[0].add(box(0.3, 0.3, 0.14, toon("#ffb347"), 0, -0.78, 0.04)); a.arms[0].add(box(0.2, 0.03, 0.03, toon("#c77a2a"), 0, -0.6, 0.04)); }), // auntie, market bag
  p4: extra("p4", ["#e2433f", "#5a4a3a", "#d8d8de", "#c88a62"], (a) => { a.head.add(box(0.44, 0.09, 0.42, toon("#2a3f8a"), 0, 0.5, 0)); a.head.add(box(0.36, 0.03, 0.16, toon("#2a3f8a"), 0, 0.46, 0.26)); }), // uncle in a cap
  p5: extra("p5", ["#2fc6a8", "#2a2f55", "#1a1420", "#cf9670"], (a) => handPhone(a, 1)), // the young man who says good morning
  p6: extra("p6", ["#8fb8ff", "#2a2a3a", "#2a2236", "#f0c39a"], (a) => { a.body.add(box(0.03, 0.3, 0.01, toon("#e2433f"), 0.06, 0.38, 0.156)); a.body.add(box(0.07, 0.1, 0.01, flat("#ffffff"), 0.06, 0.2, 0.158)); }), // office man with a lanyard
};

// ---- helpers
const CARD = (k) => (c) => timeCard(c, "10:05 AM", "MRT to the clinic", k);
const blinkAt = (lt, at, a = "code", b = "code") => (lt < at ? a : lt < at + 0.08 ? "blink" : b);
/** the train's motion inside the carriage: everyone and every strap leans the same way at the same time */
const lurch = (t) => 0.04 * Math.sin(t * 2.3) + 0.014 * Math.sin(t * 5.1 + 1);
/** a little bump on every rail joint (CLACK-CLACK), at shot-local hit times */
const jolt = (lt, hits) => hits.reduce((s, h) => s + (lt > h ? Math.exp(-(lt - h) * 9) * Math.sin((lt - h) * 30) * 0.018 : 0) + (lt > h + 0.16 ? Math.exp(-(lt - h - 0.16) * 9) * Math.sin((lt - h - 0.16) * 30) * 0.014 : 0), 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
/** screen position (canvas px) of a point in an object's local space; call inside an ov closure */
function toScreen(obj, x = 0, y = 0, z = 0) {
  obj.updateWorldMatrix(true, false); _v.set(x, y, z).applyMatrix4(obj.matrixWorld).project(STAGE.camera);
  return [((_v.x + 1) / 2) * 1920, ((1 - _v.y) / 2) * 1080];
}
/** Wei Ling's phone rides in her right hand without being parented to her (so it can never leak into other chapters) */
function holdPhone(show, look, img) {
  phone.g.visible = show;
  if (!show) return;
  const w = STAGE.get("wei"); w.g.updateMatrixWorld(true);
  w.hands[1].getWorldPosition(_v);
  _w.set(...look).sub(_v).normalize();
  phone.g.position.copy(_v).addScaledVector(_w, 0.05);
  phone.g.scale.setScalar(PHONE_S); // one size for her phone in c04 and c06
  phone.g.lookAt(...look);
  if (img) phone.setScreen(img);
}
const load = (w, wait, fn) => wait(frame(w.clip, w.at).then(fn));
const _bv = new THREE.Vector3();
/** her bag hangs upright from her left hand (a little swing) */
function bagInHand(swing = 0) {
  const w = STAGE.get("wei"); w.g.updateMatrixWorld(true); w.hands[0].getWorldPosition(_bv);
  bag.visible = true; bag.position.set(_bv.x, _bv.y - 0.245, _bv.z); bag.rotation.set(swing * 0.4, w.g.rotation.y + Math.PI / 2, swing);
}
/** in the carriage it stands on the floor at her feet (on the bench it merged into the orange seats and met her neighbour's arm) */
function bagAtFeet(x) { bag.visible = true; bag.position.set(x, 0, -2.22); bag.rotation.set(0, 0.3, 0); }
const fadeIn = (lt) => (c) => { const a = 1 - easeOut(seg(lt, 0, 0.45)); if (a <= 0) return; c.save(); c.globalAlpha = a; c.fillStyle = "#000"; c.fillRect(0, 0, 1920, 1080); c.restore(); };
// the reference's subway: cold white-green fluorescent key, an orange rim, near-black navy
const STATION_LIGHT = { sky: "#b9ccff", ground: "#3a2f78", hemi: 1.15, key: "#eafff0", keyI: 2.1, rim: "#ff9a3c", rimI: 1.0, bg: "#0a0a26" };
const CAR_LIGHT = { sky: "#c4d6ff", ground: "#3b2f80", hemi: 0.95, key: "#eafff0", keyI: 1.55, rim: "#ff9a3c", rimI: 1.2, bg: "#0a0a26" };

// the train pulls in: from deep in the tunnel, braking hard, stopping at lt 2.75 with a small settle
function trainX(lt) {
  const k = seg(lt, 0.1, 2.75);
  let x = -52 * Math.pow(1 - k, 2);
  if (lt > 2.75) { const a = lt - 2.75; x += 0.16 * Math.sin(a * 9) * Math.exp(-a * 5); }
  return x;
}

// 6a · Bishan platform: out of black, the train arrives behind the screen doors (SCREEEE), Wei Ling covers her ears
shot("c06 platform", T.a, T.b, ({ t, lt: ltc, ov, wait }) => {
  const lt = twos(ltc);
  STAGE.show("c06.platform", "c06.props");
  STAGE.lights("night", { ...STATION_LIGHT, keyPos: [3, 7, 6], keyTarget: [-1, 0, 1] });
  setStation(plat, "bishan");
  P.train.visible = true; P.train.position.x = trainX(ltc);
  P.headLamp.intensity = 2.5 * (1 - seg(ltc, 2.4, 3.0));
  setPlatformDoors(plat, 0, 0);
  P.trainLampMat.color.set("#5a1a20"); P.psdLamps.forEach((m) => m.color.set("#5a1a20"));
  const hit = 1.45, stop = 2.75;
  const scree = lt > hit && lt < stop;
  // Mr Tan: waiting, hears it coming, flinches at the screech, then turns to the stopped train, delighted
  const cringe = kf(lt, [[hit - 0.05, 0], [hit + 0.08, 1], [stop - 0.1, 0.8], [stop + 0.2, 0]]);
  const turn = ease(seg(lt, stop + 0.05, stop + 0.45));
  STAGE.pose("tan", {
    x: -0.2, z: 1.15, rotY: lerp(0.95, 0.6, turn), ear: kf(lt, [[0.7, 0], [0.85, 1]]),
    face: lt < 0.6 ? blinkAt(lt, 0.5) : lt < hit - 0.08 ? "code" : lt < hit ? "blink" : lt < stop ? "worry" : blinkAt(lt, stop + 0.02, "worry", "wow"),
    headYaw: kf(lt, [[0.7, 0], [1.0, -0.6], [hit, -0.6], [hit + 0.1, -0.2], [stop, -0.2], [stop + 0.4, -0.6]]),
    headPitch: cringe * 0.18 + wob(lt, 0.5) * 0.03, tilt: scree ? wob(boil(lt) / 12, 3) * 0.05 : wob(lt, 0.4) * 0.04,
    squash: cringe * 0.28 + Math.sin(lt * 2.2) * 0.02, armOutL: 0.1 + cringe * 0.35, armOutR: 0.1 + cringe * 0.35,
    armL: turn * 0.4, armR: turn * 0.25,
  });
  // Wei Ling: on her phone; looks up at the rumble; hands to her headphones on the screech; then points at the door
  const ears = kf(lt, [[hit - 0.12, 0], [hit + 0.05, 1], [stop - 0.05, 1], [stop + 0.2, 0]], easeOut);
  const point = kf(lt, [[stop + 0.15, 0], [stop + 0.35, 1.1]], backOut);
  STAGE.pose("wei", {
    x: -0.88, z: 1.6, rotY: lerp(1.15, 0.9, turn), ear: ears,
    face: lt < hit ? blinkAt(lt, 1.0) : lt < stop ? "worry" : blinkAt(lt, stop + 0.15, "worry", "happy"),
    headPitch: lerp(0.35, 0, ease(seg(lt, 0.75, 1.0))) + ears * 0.1, headYaw: kf(lt, [[0.8, 0], [1.05, -0.55], [hit, -0.55], [hit + 0.1, -0.1]]),
    armR: lerp(1.05, 2.55, ears) * (1 - point * 0.1), armOutR: 0.1 + ears * 0.5, armL: Math.max(lerp(0.55, 2.55, ears), point * 1.35), armOutL: 0.1 + ears * 0.5 + point * 0.25,
    squash: ears * 0.12 + Math.sin(lt * 2.4 + 1) * 0.02, tilt: wob(lt, 0.5, 1) * 0.04, dy: point > 0 ? Math.abs(Math.sin(seg(lt, stop + 0.15, stop + 0.45) * Math.PI)) * 0.05 : 0,
  });
  load(WIN.home, wait, (img) => holdPhone(true, [2.6, 1.4, 4.3], img));
  holdPhone(true, [2.6, 1.4, 4.3], null);
  bagInHand(Math.sin(lt * 3) * 0.04);
  // the other passengers waiting
  const look = ease(seg(lt, 1.0, 1.4));
  STAGE.pose("c06.p6", { x: -2.9, z: 3.3, rotY: Math.PI - 0.7, headYaw: -look * 0.5, armR: 0.2 });
  STAGE.pose("c06.p5", { x: -6.2, z: 3.4, rotY: Math.PI - 0.9, headPitch: 0.35 - look * 0.35, headYaw: look * 0.5, armR: 0.95, armL: 0.3 });
  STAGE.pose("c06.p1", { x: -8.6, z: 4.1, rotY: Math.PI - 0.4, headPitch: 0.3, armR: 0.9 });
  STAGE.pose("c06.p2", { x: -11.5, z: 2.9, rotY: Math.PI - 0.6, headYaw: look * 0.4 });
  STAGE.pose("c06.p3", { x: -14.5, z: 3.9, rotY: Math.PI - 0.5, armL: 0.1 });
  STAGE.pose("c06.p4", { x: -19, z: 3.3, rotY: -1.2, headPitch: 0.1 });
  // camera: a slow push along the platform; it shakes while the train thunders past
  const k = ease(seg(ltc, 0, 3.2)), sh = clamp(seg(ltc, 1.2, 1.5) - seg(ltc, 2.5, 2.9)) * 0.01;
  const jx = Math.sin(boil(t) * 2.1) * sh, jy = Math.cos(boil(t) * 1.7) * sh;
  STAGE.cam([lerp(2.45, 2.15, k) + jx, lerp(1.3, 1.24, k) + jy, lerp(3.0, 2.75, k)], [lerp(-2.6, -2.3, k), lerp(0.98, 0.92, k), lerp(1.1, 1.0, k)], 38);
  ov.push(CARD(seg(lt, 0.3, 0.75)));
  ov.push((c) => sfx(c, "rmmmble", 660, 390, 54, lt - 0.55, { life: 1.0, burst: false, fill: ["#d8d0ff", "#8f7dff"], rot: -0.08 }));
  ov.push((c) => sfx(c, "SCREEEEE!", 760, 230, 120, lt - hit, { life: 1.35, burst: false, fill: ["#ffffff", "#7fd8ff"], rot: -0.06 }));
  ov.push((c) => sfx(c, "pssshh", 1450, 330, 60, lt - (stop + 0.05), { life: 0.9, burst: false, fill: ["#ffffff", "#b9c3ff"] }));
  ov.push(fadeIn(ltc));
  return { bloom: 0.6 };
});

// 6b · from inside the carriage: DING-DONG, the doors slide open; Wei Ling steps in, Mr Tan hops the gap
shot("c06 doors", T.b, T.c, ({ t, lt: ltc, ov, wait }) => {
  const lt = twos(ltc);
  STAGE.show("c06.platform", "c06.carriage", "c06.props");
  STAGE.lights("night", { ...STATION_LIGHT, keyPos: [2.5, 8, -2.6], keyTarget: [0, 0, 0.4] });
  setStation(plat, "bishan");
  P.train.visible = false; P.train.position.x = 0; P.headLamp.intensity = 0;
  const kOpen = clamp(backOut(seg(lt, 0.35, 0.85), 1.3), 0, 1.04);
  const lampOn = lt > 0.2 && lt < 0.95 && boil(lt) % 4 < 2;
  setPlatformDoors(plat, 1, clamp(backOut(seg(lt, 0.4, 0.9), 1.3), 0, 1.04));
  P.trainLampMat.color.set("#5a1a20"); P.psdLamps.forEach((m) => m.color.set(lampOn ? "#ff3040" : "#5a1a20"));
  setCarriage(car, t, { run: 0, near: true, kNear: kOpen, kFar: 0, lamp: lampOn });
  // Wei Ling steps in briskly and turns to cheer him on
  const wk = seg(lt, 0.75, 1.2);
  STAGE.pose("wei", {
    x: lerp(-0.45, -0.62, ease(wk)), z: lerp(0.75, -0.42, ease(wk)), rotY: Math.PI - kf(lt, [[1.15, 0], [1.4, 1.0]]), walk: wk > 0 && wk < 1 ? lt * 11 : 0,
    face: blinkAt(lt, 1.6, "happy", "happy"), headYaw: kf(lt, [[1.15, 0], [1.4, 0.45]]), headPitch: -0.1,
    armL: kf(lt, [[1.15, 0], [1.35, 0.9], [1.6, 1.2]]), armR: kf(lt, [[1.15, 0], [1.35, 0.9], [1.6, 1.2]]), armOutL: 0.3, armOutR: 0.3,
    squash: wk >= 1 ? Math.sin((lt - 1.2) * 14) * Math.exp(-(lt - 1.2) * 5) * 0.12 : 0,
  });
  load(WIN.home, wait, (img) => holdPhone(true, [0.5, 1.0, -2.3], img));
  holdPhone(true, [0.5, 1.0, -2.3], null);
  bagInHand(wk > 0 && wk < 1 ? Math.sin(lt * 11) * 0.12 : Math.sin((lt - 1.2) * 9) * Math.exp(-Math.max(0, lt - 1.2) * 4) * 0.15);
  // Mr Tan: peers at the gap, dips, hops, lands with a squash
  const hop = seg(lt, 1.3, 1.6), landed = lt > 1.6;
  const dip = kf(lt, [[1.05, 0], [1.28, 0.4], [1.32, -0.35], [1.58, -0.2], [1.62, 0.45], [1.85, -0.05], [1.95, 0]]);
  STAGE.pose("tan", {
    x: lerp(0.38, 0.25, hop), z: lerp(0.62, -0.62, ease(hop)), rotY: Math.PI, dy: Math.sin(hop * Math.PI) * 0.3,
    face: lt < 0.9 ? "code" : lt < 0.98 ? "blink" : !landed ? "wow" : blinkAt(lt, 1.62, "wow", "happy"),
    headPitch: kf(lt, [[0.9, 0], [1.05, 0.4], [1.25, 0.4], [1.4, -0.15], [1.7, 0]]), squash: dip,
    armOutL: 0.1 + kf(lt, [[1.25, 0], [1.4, 0.9], [1.7, 0.9], [1.95, 0.3]]), armOutR: 0.1 + kf(lt, [[1.25, 0], [1.4, 0.9], [1.7, 0.9], [1.95, 0.3]]),
    armL: kf(lt, [[1.25, 0], [1.4, 0.6], [1.7, 0.2]]), armR: kf(lt, [[1.25, 0], [1.4, 0.6], [1.7, 0.2]]), ear: kf(lt, [[1.0, 0.3], [1.4, 1]]),
    tilt: wob(lt, 0.7) * 0.05,
  });
  // passengers behind them on the platform
  STAGE.pose("c06.p5", { x: 1.05, z: 1.9, rotY: Math.PI - 0.3, headPitch: 0.2, armR: 0.9 });
  STAGE.pose("c06.p1", { x: -1.4, z: 2.6, rotY: Math.PI + 0.4, headPitch: 0.3, armR: 0.9, walk: 0 });
  const k = ease(seg(ltc, 0, 2));
  STAGE.cam([lerp(0.62, 0.48, k), lerp(0.98, 0.92, k), lerp(-2.5, -2.25, k)], [lerp(-0.1, 0.0, k), lerp(0.95, 0.85, k), 1.4], 46);
  ov.push(CARD(1));
  ov.push((c) => flashHit(c, ltc - 0.2, "#fff3b0", 3));
  ov.push((c) => sfx(c, "DING-DONG!", 980, 170, 104, lt - 0.28, { life: 1.15, burst: "#fff6e4", dots: "rgba(250,158,13,.35)" }));
  ov.push((c) => sfx(c, "HUP!", 760, 330, 70, lt - 1.32, { life: 0.7, burst: false, fill: ["#ffe37a", "#ff8a1f"] }));
  return { bloom: 0.55 };
});

// the passengers in the moving carriage (shots 6c and 6d); `lt` is shot-local, `t` is film time for the sway
function carriageCast(t, lt, hits, o = {}) {
  const sway = lurch(t), j = jolt(lt, hits);
  const tan = STAGE.pose("tan", { x: -3.88, z: -2.7, dy: 0.28 + j, sit: 1, ...o.tan });
  tan.g.rotation.z = sway * 0.8 + (o.tanLean ?? 0);
  const wei = STAGE.pose("wei", { x: -3.15, z: -2.7, dy: 0.285 + j, sit: 1, ...o.wei });
  wei.g.rotation.z = sway * 0.8;
  const pose = (n, p, k = 1) => { const a = STAGE.pose("c06." + n, p); a.g.rotation.z = sway * k; return a; };
  pose("p4", { x: -4.62, z: -2.72, y: 0.02 + j, sit: 1, headPitch: 0.42, headTilt: 0.18 + sway * 2, blink: 1, armL: 0.5, armR: 0.5 });
  pose("p1", { x: -2.3, z: -2.72, y: 0.02 + j, sit: 1, headPitch: 0.4, armR: 1.0, armL: 0.7, blink: (t % 3.1) < 0.1 ? 1 : 0 });
  pose("p3", { x: -1.15, z: -2.72, y: 0.02 + j, sit: 1, headYaw: Math.sin(t * 0.6) * 0.3, armL: 0.6, armR: 0.4, blink: (t % 2.7) < 0.1 ? 1 : 0 });
  pose("p5", { x: -2.45, z: -2.0, y: j * 1.5, rotY: -Math.PI / 2, armL: 2.75, armOutL: 0.42, armR: 0.95, headPitch: 0.3, ...o.p5 }, 1.5);
  pose("p6", { x: -5.3, z: -1.62, y: j * 1.5, rotY: -Math.PI / 2 + 0.2, armR: 1.35, armOutR: 0.05, headYaw: 0.3 }, 1.5);
  pose("p2", { x: -1.4, z: -1.15, y: j * 1.5, rotY: Math.PI + 0.15, armL: 2.8, armOutL: 0.1, headYaw: 0.4 }, 1.5);
  return { tan, wei };
}

// 6c · the carriage, under way: CLACK-CLACK, everyone leans together, warm tunnel lamps sweep past the windows; she
// turns her phone to him; a callout blows up the card on her screen (the visit at 10:30) so it can be read
shot("c06 carriage", T.c, T.d, ({ t: tc, lt: ltc, ov, wait }) => {
  const lt = twos(ltc), t = twos(tc);
  STAGE.show("c06.carriage", "c06.props");
  STAGE.lights("night", { ...CAR_LIGHT, keyPos: [-2.3, 7, 2.5], keyTarget: [-3.5, 0.5, -2.2] });
  setCarriage(car, tc, { run: 1, near: false, lurch: -lurch(t) * 1.8, sweep: 9 });
  const hits = [0.15, 1.3];
  const show = seg(lt, 0.45, 0.9), lean = ease(seg(lt, 0.9, 1.3));
  carriageCast(t, lt, hits, {
    tan: { face: lt < 0.5 ? blinkAt(lt, 0.35) : lt < 1.15 ? "code" : blinkAt(lt, 1.15, "code", "wow"), headYaw: kf(lt, [[0, -0.25], [0.75, -0.25], [1.05, 0.5]]), headPitch: lean * 0.12 + wob(t, 0.5) * 0.03,
      armL: 0.35, armR: 0.35, ear: lean, tilt: wob(t, 0.4) * 0.04 },
    tanLean: -lean * 0.07,
    wei: { face: lt < 0.65 ? "code" : blinkAt(lt, 0.65, "code", "happy"), headPitch: lerp(0.3, 0.05, show), headYaw: lerp(0, -0.35, show), rotY: -show * 0.3,
      armR: lerp(0.95, 1.5, backOut(show, 2)), armOutR: 0.1 + show * 0.25, armL: 0.45, squash: kf(lt, [[0.4, 0], [0.5, 0.15], [0.65, -0.1], [0.85, 0]]) },
  });
  const look = [lerp(-3.15, -4.0, show), 1.0, lerp(0.5, -0.4, show)];
  let vis = null;
  load(WIN.visit, wait, (img) => { vis = img; holdPhone(true, look, img); });
  holdPhone(true, look, null);
  bagAtFeet(-3.12);
  const k = ease(seg(ltc, 0, 2.5)), sh = Math.abs(jolt(ltc, hits)) * 0.6;
  STAGE.cam([lerp(-4.3, -3.8, k), lerp(1.05, 1.0, k) + sh, lerp(0.5, 0.3, k)], [lerp(-3.85, -3.5, k), 1.06, -2.7], 46, lurch(tc) * 0.15);
  ov.push(CARD(1));
  ov.push((c) => sfx(c, "CLACK-CLACK", 1480, 830, 92, lt - hits[0], { life: 1.0, burst: false, rot: -0.05 }));
  ov.push((c) => sfx(c, "CLACK-CLACK", 330, 700, 80, lt - hits[1], { life: 1.0, burst: false, rot: 0.05 }));
  ov.push((c) => sfx(c, "zzz", 300, 330, 50, lt - 0.3, { life: 2.2, burst: false, fill: ["#cfd6ff", "#9b8cff"] }));
  // the callout: her screen's visit card, big, with a tail down to the phone in her hand
  const kc = seg(lt, 0.9, 1.15);
  ov.push((c) => {
    if (kc <= 0 || !vis) return;
    const [px, py] = toScreen(phone.g, 0, 0, 0.01);
    const w = 760, h = (WIN.card.srcH * w) / 585, cx = 1000, cy = 30 + h / 2 + 12, s = backOut(clamp(kc), 1.6);
    c.save(); c.lineJoin = "round";
    c.beginPath(); c.moveTo(cx - 38 * s, cy + h / 2 - 6); c.lineTo(px, py - 40); c.lineTo(cx + 38 * s, cy + h / 2 - 6); c.closePath();
    c.fillStyle = "#15121c"; c.fill(); c.lineWidth = 5; c.strokeStyle = "#1a1030"; c.stroke(); c.restore();
    panel(c, vis, cx, cy, w, h, kc, { srcY: WIN.card.srcY, srcH: WIN.card.srcH, border: 10, radius: 20 });
  });
  return { bloom: 0.4 };
});

// 6d · close on the two of them: he smiles at the visit on her phone; the young man leans in: "Morning, uncle!"
// (GREET); a beat; Mr Tan looks up and waves: "Morning! 早啊！" (REPLY)
shot("c06 phone", T.d, T.e, ({ t: tc, lt: ltc, ov, wait }) => {
  const lt = twos(ltc), t = twos(tc);
  STAGE.show("c06.carriage", "c06.props");
  STAGE.lights("night", { ...CAR_LIGHT, keyPos: [-2.3, 7, 2.5], keyTarget: [-3.5, 0.5, -2.2] });
  setCarriage(car, tc, { run: 1, near: false, lurch: -lurch(t) * 1.8, sweep: 9 });
  const greet = GREET.at, reply = REPLY.at;
  const g = speakingAt(lt, GREET), r = speakingAt(lt, REPLY); // seconds into each line while it is spoken, else -1
  const nod = lt > 0.4 && lt < 0.8 ? Math.sin((lt - 0.4) * 22) * 0.12 : 0;
  const up = ease(seg(lt, greet + 0.25, greet + 0.5)); // he looks up at the young man as he is greeted
  const lean5 = kf(lt, [[0.5, 0], [0.75, 1]], backOut);
  const waveK = lt > reply - 0.1 ? 1 : 0;
  carriageCast(t, lt, [0.7], {
    tan: { x: -3.97, face: lt < 0.4 ? "wow" : lt < 0.48 ? "blink" : "happy",
      headYaw: lerp(0.5, 0.55, up), headPitch: lerp(0.12 + nod, -0.4, up) + (r >= 0 ? Math.abs(Math.sin(r * 14)) * 0.08 : 0), armL: 0.35, armR: waveK ? 0 : 0.35, wave: waveK ? (lt - reply + 0.1) * 2.5 : null,
      ear: 1, squash: kf(lt, [[0.1, 0], [0.2, -0.15], [0.35, 0.08], [0.5, 0]]) + (r >= 0 ? Math.abs(Math.sin(r * 14)) * 0.06 : 0), tilt: wob(t, 0.4) * 0.04 },
    tanLean: -0.07 * (1 - up),
    wei: { x: -3.08, face: blinkAt(lt, 1.5, "happy", "happy"), headPitch: 0.05 - up * 0.2, headYaw: lerp(-0.35, 0.3, up), rotY: -0.3 * (1 - up * 0.6), armR: 1.55 - up * 0.25, armOutR: 0.3, armL: 0.45 },
    p5: { rotY: -Math.PI / 2 + lean5 * 0.55, headPitch: 0.3 + lean5 * 0.25 + (g >= 0 ? Math.abs(Math.sin(g * 10)) * 0.14 : 0), headYaw: -lean5 * 0.15, lean: lean5 * 0.22, smile: lt > greet, talk: g >= 0 ? Math.abs(Math.sin(lt * 18)) * 0.5 : 0, brow: 0, armR: lerp(0.95, 0.3, lean5) },
  });
  friendlyBrows(X.p5, lean5 * 0.7);
  load(WIN.visit, wait, (img) => holdPhone(true, [-3.8, 1.05, -0.9], img));
  holdPhone(true, [-3.8, 1.05, -0.9], null);
  bagAtFeet(-3.12);
  const k = ease(seg(ltc, 0, 0.9)), w = ease(seg(ltc, 0.5, 1.05));
  STAGE.cam([lerp(-3.7, -3.66, k) + w * 0.2, lerp(0.9, 0.93, k) + w * 0.12, lerp(-1.0, -1.15, k) + w * 0.4], [-3.68 + w * 0.45, lerp(0.92, 0.95, k) + w * 0.36, -2.7], lerp(40, 52, w), lurch(tc) * 0.15);
  ov.push(CARD(1));
  ov.push((c) => sfx(c, "OOH!", 250, 190, 66, lt - 0.18, { life: 0.8, burst: false, fill: ["#ffe37a", "#ff8a1f"] }));
  ov.push((c) => { const [hx, hy] = toScreen(X.p5.head, 0, 0.14, 0.26); bubble(c, ["Morning, uncle!"], 1010, 120, hx, hy, voiceK(tc, T.d + greet, GREET.dur), { size: 40, voice: GREET.id }); });
  ov.push((c) => { const [hx, hy] = toScreen(STAGE.get("tan").head, 0, 0.4, 0.25); bubble(c, ["Morning!", "早啊！"], 520, 250, hx, hy, voiceK(tc, T.d + reply, REPLY.dur), { size: 38, voice: REPLY.id }); });
  return { bloom: 0.35 };
});

// 6e · Caldecott: they have stepped off; DING-DONG, the young man waves; the doors close behind them on the last
// beat (THUNK) and we hard-cut to the clinic
shot("c06 arrive", T.e, T.f, ({ t, lt: ltc, ov, wait }) => {
  const lt = twos(ltc);
  STAGE.show("c06.platform", "c06.carriage", "c06.props");
  STAGE.lights("night", { ...STATION_LIGHT, keyPos: [3, 7, 6], keyTarget: [0, 0, 0.5] });
  setStation(plat, "caldecott");
  P.train.visible = true; P.train.position.x = 0; P.headLamp.intensity = 0;
  const shut = easeIn(seg(lt, 0.75, 1.2));
  const lampOn = lt > 0.1 && lt < 1.25 && boil(lt) % 4 < 2;
  setPlatformDoors(plat, 1 - shut, 1 - easeIn(seg(lt, 0.8, 1.25)));
  P.trainLampMat.color.set(lampOn ? "#ff3040" : "#5a1a20"); P.psdLamps.forEach((m) => m.color.set(lampOn ? "#ff3040" : "#5a1a20"));
  setCarriage(car, t, { run: 0, near: false, kFar: 0, next: "botanic" });
  // they walk off up the platform toward us; he waves back over his shoulder
  const wk = lt * 0.3;
  STAGE.pose("tan", { x: 1.1 + wk * 0.3, z: 1.0 + wk, rotY: -0.3, walk: lt * 8, face: "happy", headYaw: -0.55, headPitch: -0.05, wave: lt * 2.6, ear: 1, tilt: wob(lt, 0.8) * 0.04 });
  STAGE.pose("wei", { x: 1.8 + wk * 0.3, z: 1.15 + wk, rotY: -0.35, walk: lt * 8 + 1.6, face: blinkAt(lt, 0.6, "happy", "happy"), headYaw: -0.4, armL: 0.2, armR: 0.2 });
  load(WIN.home, wait, (img) => holdPhone(true, [0.9, 1.0, 4.5], img));
  holdPhone(true, [0.9, 1.0, 4.5], null);
  bagInHand(Math.sin(lt * 8 + 1.6) * 0.1);
  const w5 = STAGE.pose("c06.p5", { x: 0.1, z: -1.15, rotY: 0.1, armR: 2.7 + Math.sin(lt * 14) * 0.25, armOutR: 0.3, smile: true, brow: 0 });
  friendlyBrows(X.p5, 0.7);
  w5.g.rotation.z = 0;
  STAGE.pose("c06.p1", { x: 1.6, z: -2.72, y: 0.02, sit: 1, headPitch: 0.4, armR: 1.0, armL: 0.7 });
  const k = ease(seg(ltc, 0, 1.4));
  STAGE.cam([lerp(0.95, 0.9, k), lerp(1.12, 1.08, k), lerp(4.7, 4.4, k)], [lerp(0.35, 0.42, k), 0.92, -0.3], 38);
  ov.push(CARD(1));
  ov.push((c) => flashHit(c, ltc - 0.1, "#fff3b0", 3));
  ov.push((c) => sfx(c, "DING-DONG!", 1300, 190, 100, lt - 0.17, { life: 1.12, burst: "#fff6e4", dots: "rgba(250,158,13,.35)" }));
  ov.push((c) => sfx(c, "THUNK", 880, 420, 72, lt - 1.2, { life: 0.5, burst: false, fill: ["#ffffff", "#b9c3ff"] }));
  return { bloom: 0.55 };
});
