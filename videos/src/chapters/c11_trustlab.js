// Chapter c11 · The trust lab. The reference's experiment sequence in the Ripple lab: each experiment has its card
// bottom-left, a machine or prop, a hit, and ends on a green stamp of the challenge's own words.
// Version 5 (voice sync, VOICE_SYNC.md): every bubble is one voiced line, up exactly as long as its voice. EXP. 01 grew
// by G = 3.2 s (the panel now stays on "Listening" through his whole question), so the chapter moved from 322–370 to
// 1322–1373.2 (1000 + its old start; nothing else in the structure changed):
//   1322–1324      the lab: Mr Tan rides the turntable (WHIRRR)
//   1324–1343.2    EXP. 01 "Can I take one more?"  the real recording (media/s4-his) beside him; he asks (c11-tan-q),
//                  the phone plays Dr Lim's line (c11-lim-dose); he puts the pill back (PLINK)
//   1343.2–1353.2  EXP. 02 "An unknown box"        the challenge's own sentence; HONEST ABOUT UNCERTAINTY
//   1353.2–1363.2  EXP. 03 "Chest pain"            he tells Ripple (c11-tan-chest); kept for his doctor with his doctor's
//                  own warning, and when to call 995; SAFE
//   1363.2–1373.2  EXP. 04 "Who sees what"         his six switches, he flips two; her screen lights only those; EMPOWERING
// Wording: facts file D:/ripple-c2/film/research/second-half-facts.md (6.10). Dr Lim's warning (EXP. 03) is his line R2
// in docs/plan/visits-script.md and the 995 line is template signal_995_chest in web/lib/safety/templates.ts, verbatim;
// the switch names are the app's own (web/lib/care/copy.ts).
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, clamp, lerp, backOut, hash, twos } from "../core.js";
import { sfx, bubble, panel, ring, banner, flashHit, INK, YEL } from "../overlay.js";
import { caption, stamp, expCard } from "../overlay2.js";
import { frame } from "../media.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";
import { useLab, PEDESTAL, LAB_TRAY, LAB_SCREEN, holdProp, toScreen, headScreen, faceAt } from "../sets/lab.js";
import { buildC11Props } from "../sets/c11_props.js";

const lab = useLab();
const props = STAGE.set("c11.props", buildC11Props());
const P = props.userData;
const tan = STAGE.need("tan", makeTanBot), wei = STAGE.need("wei", makeWeiBot), lim = STAGE.need("lim", makeLimBot);
const PI = Math.PI;
const SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// ---- clip windows: all the timing that changes when the recording is retimed lives here --------------------------
const WIN = {
  // he holds Ask at 2.2; "Listening" from 2.95, where his voice starts; it ends at 2.95 + 5.31 = 8.26 and the window
  // closes on "Listening" at 8.5 (he lets go off screen at 9.3; the next window opens on "Turning it into words...")
  hold: { clip: "s4-his", in: 2.0, out: 8.5 },
  answer: { clip: "s4-his", in: 12.3, out: 19.6 }, // his words 12.6; the answer 13.5; Play 16.7; Dr Lim's line 16.9–19.3
  ripple: { clip: "s4-his", in: 20.3, out: 23.6 }, // swipe 20.5: Ripple's line and "Asked on 2 Oct · on your list"
};
const SRC = { ask: 2.2, voice: 2.95, words: 12.6, answer: 13.5, play: 16.7, doc: 16.9, docEnd: 19.3, swipe: 20.5 };
const ASK_PX = [512, 1093], PLAY_PX = [126, 690]; // tap points in the 585 x 1266 frame

// The voiced lines (audio/voices-v5.json): id and fixed duration. Each bubble is drawn from its voice's first frame
// for exactly that long (voiced(), below).
const V = { q: ["c11-tan-q", 5.31], dose: ["c11-lim-dose", 1.95], chest: ["c11-tan-chest", 2.74] };
const fa = (x) => Math.ceil(x * 30 - 1e-6) / 30;             // the first frame at or after x

// v5: EXP. 01 is G longer than in v4 (the hold window grew from 3.3 s to 6.5 s); the chapter sits at 1000 + 322.
const G = Math.round((WIN.hold.out - WIN.hold.in - 3.3) * 30) / 30;   // 3.2
const E0 = 1322, E1 = 1324, E2 = E1 + 16 + G, E3 = E2 + 10, E4 = E3 + 10, E_END = E4 + 10;
const P1 = E1 + 0.6;                                          // the panel opens
const CUT1 = P1 + (WIN.hold.out - WIN.hold.in);               // 1331.1
const CUT2 = CUT1 + (WIN.answer.out - WIN.answer.in);         // 1338.4
const T = {
  ask: P1 + SRC.ask - WIN.hold.in, voice: fa(P1 + SRC.voice - WIN.hold.in),
  words: CUT1 + SRC.words - WIN.answer.in, answer: CUT1 + SRC.answer - WIN.answer.in,
  play: CUT1 + SRC.play - WIN.answer.in, doc: fa(CUT1 + SRC.doc - WIN.answer.in),
  swipe: CUT2 + SRC.swipe - WIN.ripple.in,
};
T.voiceEnd = T.voice + V.q[1];     // 1325.567–1330.877 (clip 2.97–8.28)
T.docEnd = T.doc + V.dose[1];      // Dr Lim's recorded line, played from the phone: 1335.7–1337.65 (clip 16.9–18.85)
const PX = 1480, PY = 528, PW = 420, PH = 910; // the panel's centre and size
const pxAt = ([x, y]) => [PX - PW / 2 + (x * PW) / 585, PY - PH / 2 + (y * PH) / 1266];

function panelSrc(t) {
  if (t < CUT1) return [WIN.hold.clip, WIN.hold.in + Math.max(0, t - P1)];
  if (t < CUT2) return [WIN.answer.clip, WIN.answer.in + (t - CUT1)];
  return [WIN.ripple.clip, Math.min(WIN.ripple.out, WIN.ripple.in + (t - CUT2))];
}
function exp1Panel(t, ov, wait) {
  if (t < P1) return;
  const [clip, s] = panelSrc(t);
  let img; wait(frame(clip, s).then((i) => (img = i)));
  ov.push((c) => panel(c, img, PX, PY, PW, PH, seg(t, P1, P1 + 0.3)));
  ov.push((c) => { const [x, y] = pxAt(ASK_PX); ring(c, x, y, 52, t - T.ask, { life: 0.9 }); });
  ov.push((c) => { const [x, y] = pxAt(PLAY_PX); ring(c, x, y, 46, t - T.play, { life: 0.8 }); });
}

// Poses, props and overlays move on twos (15 a second, like the reference); the camera and the app panel use the
// plain clock: tc / lc.
const sh = (name, a, b, fn) => shot(name, a, b, (o) => fn({ ...o, t: a + twos(o.lt), lt: twos(o.lt), tc: o.t, lc: o.lt }));

/** overlay2's stamp() knocks its ink gaps out with destination-out, which on the shared canvas punches through the
 *  painted frame to black. Paint it on a layer of its own and lay that over the frame. */
const stampCv = document.createElement("canvas"); stampCv.width = 1920; stampCv.height = 1080;
const stampCtx = stampCv.getContext("2d");
function stampSafe(c, text, x, y, age, o) {
  window.__logSfx?.(text, age, x, o?.size ?? 64);
  if (age < 0) return;
  stampCtx.clearRect(0, 0, 1920, 1080); stamp(stampCtx, text, x, y, age, o); c.drawImage(stampCv, 0, 0);
}

/** A speech bubble tied to its voice (VOICE_SYNC.md): drawn on the plain clock tc from the frame at `a` (the voice's
 *  first frame) for the voice's whole `dur`; it pops in over 4 frames and out over its last 2, all inside dur + 0.02 s. */
function voiced(c, lines, x, y, tx, ty, tc, a, dur, o) {
  const n = Math.round((tc - a) * 30), N = Math.floor((dur + 0.02) * 30 - 1e-6);
  if (n < 0 || n > N) return;
  const k = n === N ? 0.1 : n === N - 1 ? 0.2 : clamp(0.15 + n / 4.5);
  bubble(c, lines, x, y, tx, ty, k, o);
}

// ---- common -----------------------------------------------------------------------------------------------------
function base(t, o = {}) {
  STAGE.show("lab", "c11.props");
  for (const k in P) P[k].visible = false;
  P.phone.userData.screen.color.set("#e9e3ff");
  STAGE.lights("lab", { keyPos: [3, 6, 6], keyTarget: [0, 0.5, -0.5], keyI: 1.4, ...(o.lights || {}) });
  lab.userData.tick(t, o);
}
const breathe = (t, ph = 0) => wob(t, 0.45, ph) * 0.03;
/** world position of a point given in an actor-like local frame (x, z, facing rotY) */
const local = (x0, z0, rotY, lx, lz) => [x0 + lx * Math.cos(rotY) + lz * Math.sin(rotY), z0 - lx * Math.sin(rotY) + lz * Math.cos(rotY)];
const PHONE_ROT = [-PI / 2, 0, PI];
const clipIn = (actor, hand = 1) => holdProp(P.clip, actor, hand, [0, 0.02, 0.1], [-PI / 2 + 0.25, 0, PI]);
const card = (n, name, t, a) => (c) => expCard(c, n, name, seg(t, a, a + 0.45));
/** a flash of white light (a phone camera) */
const flash = (age) => (c) => { if (age < 0 || age > 0.35) return; c.save(); c.globalAlpha = 0.85 * (1 - age / 0.35); c.fillStyle = "#ffffff"; c.fillRect(0, 0, 1920, 1080); c.restore(); };
/** Wei Ling with her clipboard, watching; she ticks it at `tickAt` (lt). */
function weiWatch(lt, x, z, rotY, o = {}) {
  const tick = o.tickAt != null ? kf(lt, [[o.tickAt - 0.25, 0], [o.tickAt, 1], [o.tickAt + 0.12, 0.6], [o.tickAt + 0.3, 0]]) : 0;
  STAGE.pose("wei", { x, z, rotY, armR: 0.95, armOutR: 0.15, armL: 0.75 + tick * 0.45, armOutL: -0.15 + tick * 0.1, headPitch: 0.12 + (o.look ?? 0),
    headYaw: o.yaw ?? 0, tilt: wob(lt, 0.5, 1) * 0.06, squash: breathe(lt, 2), face: o.face ?? faceAt(lt, [[0, "code"]]), dy: o.dy ?? 0 });
  clipIn(wei);
}

// ---- 1322–1324 the lab: Mr Tan rides the turntable ------------------------------------------------------------
sh("c11 lab", E0, E1, ({ t, lt, tc, lc, ov }) => {
  const spin = kf(lt, [[0, -5.2], [1.8, 0.25]], easeOut);
  base(t, { spin, gauge: 0.3 + seg(lt, 0, 1.6) * 0.5 });
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: spin, armOutL: 0.9 + wob(lt, 1.5) * 0.1, armOutR: 0.9 - wob(lt, 1.5) * 0.1, face: lt > 1.5 ? "happy" : "wow",
    tilt: -0.12 * seg(lt, 0, 1.6), squash: lt > 1.75 && lt < 1.95 ? 0.25 : 0 });
  weiWatch(lt, -2.15, 0.95, 0.55, { yaw: 0.2 });
  STAGE.pose("lim", { x: 2.1, z: 0.85, rotY: -0.55, armL: 0.35, armR: 0.35, face: faceAt(lt, [[0, "code"], [1.6, "happy"]]), tilt: wob(lt, 0.6) * 0.05, squash: breathe(lt) });
  const k = easeOut(seg(lc, 0, 2));
  STAGE.cam([lerp(-0.6, 0.35, k), lerp(3.4, 1.75, k), lerp(8.2, 6.0, k)], [0, lerp(0.7, 1.15, k), 0], 38);
  ov.push((c) => banner(c, "THE TRUST LAB", 960, 70, seg(lt, 0.15, 0.5), { size: 34 }));
  ov.push((c) => { const [x, y] = toScreen(0, 0.1, PEDESTAL.r + 0.3); sfx(c, "WHIRRR", x, Math.min(960, y + 70), 92, lt - 0.1, { life: 1.6, burst: false, fill: ["#bff6ff", "#39d3ff"] }); });
  return { bloom: 0.5 };
});

// ---- EXP. 01 · Can I take one more? (E1–E2: 1324–1343.2) ---------------------------------------------------------
const T_ROT = 0.42;                                         // Mr Tan's facing on the pedestal during EXP. 01
const [BX, BZ] = local(0, 0, T_ROT, 0.45, 0.15);            // the open pill bottle on the pedestal by his left hand
function bottleAt() { P.bottle.visible = true; P.bottle.position.set(BX, PEDESTAL.top, BZ); P.bottle.rotation.set(0, 0.6, 0); P.bottle.scale.set(1, 1, 1); }
const BUBBLE1 = ["My blood pressure is 152/96 today,", "can I take one more tablet?", "今天血压一百五十二，九十六，我能不能多吃一粒？"];
const BUBBLE_DOC = ["Please don't change the dose yourself."];
const card1 = (t) => card("01", "Can I take one more?", t, E1);
const LIM1 = { x: -1.45, z: 0.5, rotY: 1.0 };
// Blocking cheated per camera: from the right-hand angles (1a, 1b, 1d) Wei Ling stands left of him, clear of his
// silhouette, and Dr Lim waits just outside the frame instead of showing as a sliver at its edge; in the front wide (1c)
// both stand where v1 had them, Dr Lim in the foreground.
const WEI1 = [-1.95, -1.75, 0.75], LIM1_OFF = { x: -1.8, z: 0.6, rotY: 1.0 };
/** His question's bubble (c11-tan-q): up from his voice's first frame for its whole 5.31 s, at the same place in both
 *  shots it spans (1a and 1a'), its tail on his head. */
function hisBubble(tc, ov) {
  ov.push((c) => { const [hx, hy] = headScreen(tan); voiced(c, BUBBLE1, 470, 170, hx, hy + 20, tc, T.voice, V.q[1], { size: 30, voice: V.q[0] }); });
}
/** His body talks only while his voice plays; its phrases are 0.03–2.18, 2.36–3.03 and 3.57–5.25 s (a breath in each
 *  gap); after the line he is still. */
function tanAsks(t, lt) {
  const sp = t - T.voice, talking = sp >= 0 && sp < V.q[1];
  const g = !talking ? 0 : sp < 2.2 || (sp > 2.36 && sp < 3.05) || sp > 3.57 ? 1 : 0.35;
  return { tilt: talking ? 0.02 + wob(sp, 0.9) * 0.08 * g : 0.04, squash: talking ? Math.abs(wob(sp, 2.3)) * 0.05 * g : breathe(lt), bob: talking ? wob(sp, 2.0) * 0.04 * g : 0 };
}
const T_CLOSE = T.voice + 3.3;                              // cut closer in the pause before his last phrase

// 1a · the pill in his palm; he raises the phone and holds Ask; he asks
sh("c11 exp1 ask", E1, T_CLOSE, ({ t, lt, tc, lc, ov, wait }) => {
  base(t, { spin: 0.1 });
  bottleAt();
  const raise = kf(lt, [[0.35, 0.2], [0.48, 0.08], [0.8, 1.32]], backOut);
  const look = seg(lt, 0.55, 0.8);
  const a = tanAsks(t, lt);
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: T_ROT, armL: 0.95, armOutL: 0.22, armR: raise, armOutR: 0.12 - seg(lt, 0.5, 0.8) * 0.4,
    headYaw: lerp(0.38, -0.25, look), headPitch: lerp(0.32, 0.1, look) + a.bob, tilt: a.tilt,
    squash: a.squash, face: faceAt(lt, [[0, "think"], [0.8, "code"], [T.voice - E1, "worry"]]) });
  holdProp(P.pill, tan, 0, [0, 0.03, 0.075]);
  holdProp(P.phone, tan, 1, [0, 0.0, 0.06], PHONE_ROT);
  weiWatch(lt, WEI1[0], WEI1[1], WEI1[2], { yaw: 0.3 });
  STAGE.pose("lim", { ...LIM1_OFF, face: "code", squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, T_CLOSE - E1));
  STAGE.cam([lerp(1.25, 1.05, k), lerp(1.45, 1.4, k), lerp(3.55, 3.05, k)], [lerp(0.74, 0.7, k), 1.2, 0], 38);
  ov.push(card1(t));
  ov.push((c) => { P.pill.updateWorldMatrix(true, false); const v = new THREE.Vector3().setFromMatrixPosition(P.pill.matrixWorld); const [x, y] = toScreen(v.x, v.y, v.z); sfx(c, "TING!", x + 70, y - 70, 54, lt - 0.3, { life: 0.9, burst: false, fill: ["#ffffff", "#ff9ad0"] }); });
  ov.push((c) => { const v = new THREE.Vector3().setFromMatrixPosition(P.phone.matrixWorld); const [x, y] = toScreen(v.x, v.y, v.z); sfx(c, "BLIP", x - 175, y - 215, 60, t - T.ask, { life: 0.8, burst: false, fill: ["#e9dcff", "#9b6bff"] }); });
  exp1Panel(tc, ov, wait);
  hisBubble(tc, ov);
  return { bloom: 0.45 };
});

// 1a' · closer on him as he finishes the question; the panel runs on, still "Listening", until clip 8.5
sh("c11 exp1 asking", T_CLOSE, CUT1, ({ t, lt, tc, lc, ov, wait }) => {
  base(t, { spin: 0.1 });
  bottleAt();
  const a = tanAsks(t, lt);
  const after = ease(seg(t, T.voiceEnd, T.voiceEnd + 0.2));      // done: he looks a little closer at the phone
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: T_ROT, armL: 0.95, armOutL: 0.22, armR: 1.32, armOutR: -0.28,
    headYaw: -0.25, headPitch: 0.1 + a.bob + after * 0.05, tilt: a.tilt, squash: a.squash, face: faceAt(lt, [[0, "worry"]]) });
  holdProp(P.pill, tan, 0, [0, 0.03, 0.075]);
  holdProp(P.phone, tan, 1, [0, 0.0, 0.06], PHONE_ROT);
  weiWatch(lt, -2.6, -1.75, WEI1[2], { yaw: 0.3 });   // in this tight shot she waits just outside the left edge
  STAGE.pose("lim", { ...LIM1_OFF, face: "code", squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, CUT1 - T_CLOSE));
  STAGE.cam([lerp(1.0, 0.9, k), lerp(1.45, 1.43, k), lerp(2.6, 2.4, k)], [lerp(0.55, 0.52, k), 1.3, 0], 36);
  ov.push(card1(t + 9));
  exp1Panel(tc, ov, wait);
  hisBubble(tc, ov);
  return { bloom: 0.45 };
});

// 1b · his words on the screen, then the answer: Dr Lim's own words. He reads; DING.
sh("c11 exp1 answer", CUT1, T.play, ({ t, lt, tc, lc, ov, wait }) => {
  base(t, { spin: 0.1 });
  bottleAt();
  const read = t > T.answer;
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: T_ROT, armL: 0.95, armOutL: 0.22, armR: 1.32, armOutR: -0.28,
    headYaw: -0.25, headPitch: 0.1 + (read ? Math.max(0, wob(t - T.answer, 0.6)) * 0.06 : 0), lean: read ? 0.08 : 0,
    tilt: wob(lt, 0.4) * 0.05, squash: t > T.answer && t < T.answer + 0.2 ? 0.2 : breathe(lt),
    face: faceAt(t - CUT1, [[0, "worry"], [T.answer - CUT1, "wow"], [T.answer - CUT1 + 1.4, "think"]]) });
  holdProp(P.pill, tan, 0, [0, 0.03, 0.075]);
  holdProp(P.phone, tan, 1, [0, 0.0, 0.06], PHONE_ROT);
  weiWatch(lt, -2.6, -1.75, WEI1[2], { yaw: 0.3 });   // in this tight shot she waits just outside the left edge
  STAGE.pose("lim", { ...LIM1_OFF, face: "code", squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, T.play - CUT1));
  STAGE.cam([lerp(-0.15, 0.0, k), lerp(1.42, 1.4, k), lerp(2.85, 2.55, k)], [lerp(0.45, 0.42, k), 1.32, 0], 36);
  ov.push(card1(t + 9));
  ov.push((c) => flashHit(c, tc - T.answer, "#fff3b0", 2));
  ov.push((c) => sfx(c, "DING!", 330, 430, 84, t - T.answer - 0.07, { life: 1.0 }));
  exp1Panel(tc, ov, wait);
  return { bloom: 0.45 };
});

// 1c · he taps Play: the phone plays Dr Lim's recorded line; in the lab Dr Lim hears himself and nods
sh("c11 exp1 play", T.play, CUT2, ({ t, lt, tc, lc, ov, wait }) => {
  base(t, { spin: 0.1 });
  bottleAt();
  const nod = t > T.docEnd - 0.4 ? Math.max(0, wob(t - T.docEnd, 1.6)) * 0.18 : 0;
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: T_ROT, armL: 0.95, armOutL: 0.22, armR: 1.32 + (lt < 0.2 ? 0.06 : 0), armOutR: -0.28,
    headYaw: -0.25, headPitch: 0.1 + nod, tilt: wob(lt, 0.4) * 0.05, squash: breathe(lt),
    face: faceAt(lt, [[0, "think"], [T.docEnd - T.play - 0.3, "happy"]]) });
  holdProp(P.pill, tan, 0, [0, 0.03, 0.075]);
  holdProp(P.phone, tan, 1, [0, 0.0, 0.06], PHONE_ROT);
  // the phone is the speaker here: its screen glows (with a small pulse) exactly while Dr Lim's recorded line plays
  P.phone.userData.screen.color.set(tc >= T.doc - 1e-6 && tc < T.docEnd ? (Math.floor((tc - T.doc) * 7.5) % 2 ? "#f2f6ff" : "#ffffff") : "#e9e3ff");
  weiWatch(lt, -1.2, -1.25, 0.65, { yaw: 0.3, face: faceAt(lt, [[0, "code"], [1.4, "happy"]]) });
  const point = kf(lt, [[0.5, 0], [0.8, 1.35], [2.4, 1.35], [2.8, 0.3]], backOut);
  const limNod = t > T.doc + 0.6 && t < T.docEnd + 0.7 ? Math.max(0, wob(t - T.doc, 1.4)) * 0.16 : 0;   // he hears himself, nods
  STAGE.pose("lim", { ...LIM1, armR: point, armOutR: 0.1, headYaw: 0.1, headPitch: limNod,
    face: faceAt(lt, [[0, "code"], [0.35, "wow"], [1.0, "happy"]]), squash: lt > 0.35 && lt < 0.5 ? 0.18 : breathe(lt, 1), tilt: 0.08 });
  const k = ease(seg(lc, 0, CUT2 - T.play));
  STAGE.cam([lerp(-0.05, -0.15, k), lerp(1.5, 1.45, k), lerp(4.4, 4.05, k)], [lerp(0.12, 0.1, k), 1.15, 0], 38);
  ov.push(card1(t + 9));
  ov.push((c) => { P.phone.updateWorldMatrix(true, false); const v = new THREE.Vector3().setFromMatrixPosition(P.phone.matrixWorld); const [x, y] = toScreen(v.x, v.y, v.z);
    sfx(c, "CLICK", Math.min(1180, x + 40), y + 90, 50, lt - 0.05, { life: 0.7, burst: false, fill: ["#ffffff", "#ffd94a"] });
    voiced(c, BUBBLE_DOC, 600, 210, x - 10, y - 30, tc, T.doc, V.dose[1], { size: 36, fillCol: "#eaf9ff", voice: V.dose[0] });
  });
  exp1Panel(tc, ov, wait);
  return { bloom: 0.45 };
});

// 1d · Ripple's line, on his list. He looks at the pill and puts it back: PLINK. STRICTLY BOUNDED.
sh("c11 exp1 plink", CUT2, E2, ({ t, lt, tc, lc, ov, wait }) => {
  base(t, { spin: 0.1 });
  bottleAt();
  const over = kf(lt, [[0.55, 0], [0.72, -0.08], [1.2, 1]], ease);
  const drop = 1.35, land = 1.6;
  const hop = lt > land + 0.35 && lt < land + 0.75 ? Math.sin((lt - land - 0.35) / 0.4 * PI) * 0.1 : 0;
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top + hop, rotY: T_ROT, armL: lerp(0.95, 0.55, over), armOutL: lerp(0.22, 0.6, over), armR: lerp(1.32, 0.45, seg(lt, 0.2, 0.7)), armOutR: lerp(-0.28, 0.12, seg(lt, 0.2, 0.7)),
    headYaw: lerp(0.12, 0.42, seg(lt, 0, 0.5)) - seg(lt, 2.0, 2.4) * 0.4, headPitch: lerp(0.15, 0.4, seg(lt, 0, 0.5)) - seg(lt, 2.0, 2.4) * 0.38,
    tilt: lt > land ? wob(lt, 0.7) * 0.07 : 0, squash: lt > land + 0.3 && lt < land + 0.4 ? 0.25 : lt > land + 0.7 && lt < land + 0.82 ? 0.3 : breathe(lt),
    face: faceAt(lt, [[0, "think"], [0.9, "sad"], [land + 0.15, "happy"]]) });
  holdProp(P.phone, tan, 1, [0, 0.0, 0.06], PHONE_ROT);
  // the pill: in his palm, then a little arc down into the bottle's mouth
  holdProp(P.pill, tan, 0, [0, 0.03, 0.075]);
  if (lt > drop) {
    // a visible little arc (about four poses on twos), not a jump from the hand straight into the bottle; then it
    // sinks into the mouth and is gone
    const k = seg(lt, drop, land), mouth = new THREE.Vector3(BX, PEDESTAL.top + 0.22, BZ);
    P.pill.position.lerp(mouth, k * 0.45 + k * k * 0.55); P.pill.position.y += Math.sin(k * PI) * 0.07; P.pill.rotation.z += k * 4;
    if (lt >= land) P.pill.position.y -= seg(lt, land, land + 0.07) * 0.06;
    if (lt > land + 0.1) P.pill.visible = false;
  }
  if (lt > land && lt < land + 0.18) P.bottle.scale.set(1.12, 0.86, 1.12);
  weiWatch(lt, WEI1[0], WEI1[1], WEI1[2], { yaw: 0.35, tickAt: 2.3, face: faceAt(lt, [[0, "code"], [2.1, "happy"]]) });
  STAGE.pose("lim", { ...LIM1_OFF, armL: 0.4, armR: 0.4, face: faceAt(lt, [[0, "code"], [land + 0.3, "happy"]]), squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, E2 - CUT2));
  STAGE.cam([lerp(1.35, 1.18, k), lerp(1.5, 1.45, k), lerp(3.25, 2.9, k)], [lerp(0.68, 0.64, k), 1.22, 0.05], 38);
  ov.push(card1(t + 9));
  ov.push((c) => flashHit(c, lc - land, "#dff8ff", 2));
  ov.push((c) => { const [x, y] = toScreen(BX, PEDESTAL.top + 0.2, BZ); sfx(c, "PLINK!", x + 20, y - 150, 76, lt - land - 0.07, { life: 1.1, burst: "#bff6ff", dots: "rgba(57,211,255,.35)" }); });
  ov.push((c) => { const [x, y] = headScreen(wei, 0.3); sfx(c, "TICK", x + 110, y + 70, 54, lt - 2.3, { life: 0.8, burst: false, fill: ["#ffffff", "#7dffb0"] }); });
  ov.push((c) => flashHit(c, lc - 2.85, "#d8ffe9", 2));
  ov.push((c) => stampSafe(c, "STRICTLY BOUNDED", 430, 870, lt - 2.85, { size: 72, rot: -0.1 }));
  exp1Panel(tc, ov, wait);
  return { bloom: 0.45 };
});

// ---- EXP. 02 · An unknown box (E2–E3: 1343.2–1353.2) -------------------------------------------------------------
const card2 = (t) => card("02", "An unknown box", t, E2);
const BOX_LINE = "I'm not able to identify that medication, please check with your pharmacist.";
const BOX_SRC = "Unknown medicine: the sentence the challenge asks for, and a question for the pharmacist.";
const T_SNAP = E2 + 3.55;
function boxOnTurntable(spin) {
  P.box.visible = true; P.box.position.set(0, PEDESTAL.top, 0); P.box.rotation.set(0, spin, 0);
}
// Mr Tan and Dr Lim stand behind the turntable, facing the camera over the box; Wei Ling front left
const tanBox = (lt, o = {}) => STAGE.pose("tan", { x: -0.8, z: -1.55, rotY: 0.4, headYaw: 0.1, headPitch: 0.28, squash: breathe(lt), ...o });
const limBox = (lt, o = {}) => STAGE.pose("lim", { x: 1.0, z: -1.5, rotY: -0.45, armL: 0.3, armR: 0.3, squash: breathe(lt, 1), tilt: 0.05, ...o });

// 2a · Dr Lim presents a box with no English on it; the turntable spins it; Mr Tan peers: ??
sh("c11 exp2 box", E2, E2 + 2.6, ({ t, lt, tc, lc, ov }) => {
  const spin = kf(lt, [[0, -2.5], [2.6, 0.35]], easeOut);
  base(t, { spin, gauge: 0.5 + wob(lt, 0.8) * 0.15 });
  boxOnTurntable(spin);
  const peer = kf(lt, [[0.8, 0], [0.95, -0.2], [1.3, 1]], backOut);
  tanBox(lt, { lean: peer * 0.25, headPitch: 0.25 + peer * 0.1, armL: 0.3, armR: 0.25, face: faceAt(lt, [[0, "code"], [1.05, "think"], [1.75, "worry"]]), tilt: peer * 0.18 });
  holdProp(P.phone, tan, 0, [0, 0.0, 0.06], PHONE_ROT);
  const ta = kf(lt, [[0.15, 0], [0.3, -0.15], [0.55, 1]], backOut);
  limBox(lt, { armR: 0.3 + ta * 0.9, armOutR: ta * 1.1, face: faceAt(lt, [[0, "code"], [0.4, "happy"]]), squash: lt > 0.45 && lt < 0.6 ? 0.2 : breathe(lt, 1) });
  weiWatch(lt, -2.25, 0.75, 0.6, { yaw: 0.35 });
  const k = ease(seg(lc, 0, 2.6));
  STAGE.cam([lerp(0.2, 0.1, k), lerp(1.8, 1.68, k), lerp(4.6, 4.05, k)], [lerp(0.05, 0.0, k), 1.05, -0.6], 38);
  ov.push(card2(t));
  ov.push((c) => sfx(c, "WHIRR", 1380, 820, 70, lt - 0.1, { life: 1.3, burst: false, fill: ["#bff6ff", "#39d3ff"] }));
  ov.push((c) => { const [x, y] = headScreen(lim, 0.75); sfx(c, "TA-DA!", x + 160, y - 20, 70, lt - 0.45, { life: 1.0, burst: "#ffe37a" }); });
  ov.push((c) => { const [x, y] = headScreen(tan, 0.75); sfx(c, "??", x - 120, y - 10, 90, lt - 1.75, { life: 1.0, burst: "#e9dcff", dots: "rgba(155,107,255,.35)" }); });
  return { bloom: 0.5 };
});

// 2b · close: the box spins under the scanner beam; he holds his phone over it: SNAP!
sh("c11 exp2 scan", E2 + 2.6, E2 + 5.0, ({ t, lt, tc, lc, ov }) => {
  const spin = 0.35 + lt * 0.6;
  base(t, { spin, scanner: kf(lt, [[0.2, 0], [0.4, 1], [1.4, 1], [1.7, 0]]) });
  boxOnTurntable(spin);
  // he holds the phone out over the turntable, aimed down at the box; the camera looks down from higher than in v1 so
  // his hand and phone show above the box instead of hiding behind it (the bot's short arms cannot lift it higher)
  const raise = kf(lt, [[0.3, 0.3], [0.45, 0.18], [0.75, 1.55]], backOut);
  tanBox(lt, { armL: raise, armOutL: -0.12, armR: 0.2, lean: 0.16, headPitch: 0.3, face: faceAt(lt, [[0, "worry"], [0.95, "think"]]), squash: Math.abs(t - T_SNAP) < 0.1 ? -0.2 : breathe(lt) });
  holdProp(P.phone, tan, 0, [0, 0.0, 0.06], [-PI / 2 - 0.9, 0, PI]);
  P.phone.userData.screen.color.set(Math.abs(t - T_SNAP) < 0.12 ? "#ffffff" : "#e9e3ff");
  limBox(lt, { face: faceAt(lt, [[0, "code"], [1.0, "wow"]]), headPitch: 0.2 });
  const k = ease(seg(lc, 0, 2.4));
  STAGE.cam([lerp(0.5, 0.38, k), lerp(2.3, 2.22, k), lerp(2.2, 1.95, k)], [lerp(-0.22, -0.27, k), 0.95, -0.65], 40);
  ov.push(card2(t + 9));
  ov.push((c) => sfx(c, "BZZZT", 1480, 240, 72, lt - 0.25, { life: 1.2, burst: false, fill: ["#bff6ff", "#39d3ff"] }));
  ov.push((c) => flashHit(c, tc - T_SNAP, "#ffffff", 4));
  // the phone's camera flash: a white glow on the phone itself, so the dark phone in front of his visor reads
  ov.push((c) => { const age = tc - T_SNAP; if (age < 0 || age > 0.25) return; const v = new THREE.Vector3().setFromMatrixPosition(P.phone.matrixWorld); const [x, y] = toScreen(v.x, v.y, v.z);
    const r = 60 + age * 400, a = 1 - age / 0.25; c.save(); c.globalCompositeOperation = "lighter"; const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.35, `rgba(200,250,255,${0.6 * a})`); g.addColorStop(1, "rgba(120,230,255,0)"); c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r); c.restore(); });
  ov.push((c) => { const v = new THREE.Vector3().setFromMatrixPosition(P.phone.matrixWorld); const [x, y] = toScreen(v.x, v.y, v.z); sfx(c, "SNAP!", x - 440, y - 230, 110, t - T_SNAP - 0.08, { life: 1.0, burst: "#ffffff", dots: "rgba(57,211,255,.3)" }); });
  return { bloom: 0.55 };
});

// 2c · the answer: the sentence the challenge asks for. He nods. HONEST ABOUT UNCERTAINTY.
sh("c11 exp2 honest", E2 + 5.0, E3, ({ t, lt, tc, lc, ov }) => {
  const spin = 0.35 + 1.44 + Math.min(lt, 2.0) * 0.6 - Math.max(0, Math.min(lt, 2.0)) ** 2 * 0.15;
  base(t, { spin });
  boxOnTurntable(spin);
  const nod = lt > 1.6 && lt < 2.6 ? Math.max(0, wob(lt - 1.6, 1.5)) * 0.2 : 0;
  tanBox(lt, { armL: 1.2 - seg(lt, 2.4, 2.9) * 0.85, armOutL: -0.1, armR: 0.2, headPitch: 0.3 - seg(lt, 1.4, 1.8) * 0.3 + nod, headYaw: 0.1 - seg(lt, 1.4, 1.8) * 0.2,
    face: faceAt(lt, [[0, "think"], [1.6, "happy"]]), tilt: wob(lt, 0.5) * 0.05 });
  holdProp(P.phone, tan, 0, [0, 0.0, 0.06], PHONE_ROT);
  const thumb = kf(lt, [[2.0, 0.3], [2.15, 0.2], [2.4, 2.2]], backOut);
  limBox(lt, { armR: thumb, armOutR: 0.2, face: faceAt(lt, [[0, "code"], [2.0, "happy"]]) });
  weiWatch(lt, -2.25, 0.75, 0.6, { yaw: 0.35, tickAt: 2.4, face: faceAt(lt, [[0, "code"], [2.2, "happy"]]) });
  const k = ease(seg(lc, 0, 5));
  STAGE.cam([lerp(0.85, 0.5, k), lerp(1.7, 1.66, k), lerp(4.7, 4.3, k)], [lerp(-0.05, -0.15, k), 1.05, -0.6], 38);
  ov.push(card2(t + 9));
  ov.push((c) => caption(c, `“${BOX_LINE}”`, 70, 60, seg(lt, 0, 0.35), { source: BOX_SRC, size: 44, maxW: 960 }));
  ov.push((c) => { const [x, y] = headScreen(wei, 0.3); sfx(c, "TICK", x + 90, y + 60, 50, lt - 2.4, { life: 0.8, burst: false, fill: ["#ffffff", "#7dffb0"] }); });
  ov.push((c) => flashHit(c, lc - 3.0, "#d8ffe9", 2));
  ov.push((c) => stampSafe(c, "HONEST ABOUT UNCERTAINTY", 1340, 880, lt - 3.0, { size: 64, rot: -0.08 }));
  return { bloom: 0.45 };
});

// ---- EXP. 03 · Chest pain (E3–E4: 1353.2–1363.2) -----------------------------------------------------------------
const card3 = (t) => card("03", "Chest pain", t, E3);
const BUBBLE3 = ["My chest feels tight after climbing the stairs.", "爬完楼梯，胸口有点闷。"];
const STEPS_X = -1.93, STEPS_Z = 0.3;
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const L995 = "If the pain is bad or does not go away, or you break into a cold sweat or cannot catch your breath, call 995 straight away or go to the nearest A&E.";
const CAP3 = "Kept for his doctor, with his doctor's own warning.", CAP3_SRC = "Emergency words are handled by rules that never wait for a model.";
// his line (c11-tan-chest, 2.74 s) from T_BUB3, after the HUFF and PUFF of the climb; it ends 0.2 s before the cut to the tray
const T_CAP3 = E3 + 4.95, T_BUB3 = fa(E3 + 1.95), T_TRAY = E3 + 4.9;
function stepY(x) {
  const k = x - STEPS_X;
  if (k < -0.05) return 0;
  const i = Math.min(3, Math.floor((k + 0.05) / 0.28) + 1);
  return i >= 3 && x > -1.15 ? PEDESTAL.top : i * 0.18;
}
function wrapText(c, text, maxW) {
  const words = text.split(" "), lines = []; let line = "";
  for (const w of words) { const tt = line ? line + " " + w : w; if (c.measureText(tt).width > maxW && line) { lines.push(line); line = w; } else line = tt; }
  if (line) lines.push(line); return lines;
}
/** The answer card: Dr Lim's own warning, then when to call 995 (with the dial button), like the app's answer. */
function warnCard(c, x, y, k) {
  if (k <= 0) return;
  // type sized for a phone at 720p: the quote 34 px, the 995 lines 29 px, the small source line 24 px
  const s = backOut(clamp(k), 1.6), w = 760;
  c.save(); c.translate(x, y); c.rotate(0.02); c.scale(s, s);
  c.font = `500 34px ${SERIF}`; const q = wrapText(c, `“${R2}”`, w - 70);
  c.font = `600 29px ${SANS}`; const e = wrapText(c, L995, w - 70);
  const h = 74 + q.length * 44 + 40 + 64 + 20 + e.length * 37 + 28;
  c.fillStyle = INK; c.fillRect(-w / 2 + 10, -h / 2 + 12, w, h);
  c.fillStyle = "#f7f4ff"; c.fillRect(-w / 2, -h / 2, w, h); c.lineWidth = 5; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  let yy = -h / 2 + 28;
  c.textBaseline = "top"; c.fillStyle = "#6a4fd8"; c.font = `800 29px ${SANS}`; c.fillText("Doctor said", -w / 2 + 35, yy);
  const dw = c.measureText("Doctor said").width;
  c.fillStyle = "#5a5378"; c.font = `600 24px ${SANS}`; c.fillText("Dr Lim · his own words, recorded at a visit", -w / 2 + 35 + dw + 16, yy + 4);
  yy += 48; c.fillStyle = INK; c.font = `500 34px ${SERIF}`;
  q.forEach((l, i) => c.fillText(l, -w / 2 + 35, yy + i * 44)); yy += q.length * 44 + 22;
  c.strokeStyle = "#d9d2f2"; c.lineWidth = 3; c.beginPath(); c.moveTo(-w / 2 + 30, yy); c.lineTo(w / 2 - 30, yy); c.stroke(); yy += 18;
  c.fillStyle = "#e2333f"; c.beginPath(); c.roundRect(-w / 2 + 35, yy, 200, 56, 28); c.fill();
  c.fillStyle = "#ffffff"; c.font = `800 30px ${SANS}`; c.textBaseline = "middle"; c.fillText("Call 995", -w / 2 + 70, yy + 29);
  yy += 72; c.textBaseline = "top"; c.fillStyle = "#3a2f6a"; c.font = `600 29px ${SANS}`;
  e.forEach((l, i) => c.fillText(l, -w / 2 + 35, yy + i * 37));
  c.restore();
}

// 3a · he climbs the steps onto the pedestal, puffing; hand on his chest he tells Ripple
sh("c11 exp3 stairs", E3, T_TRAY, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1, gauge: 0.45 });
  P.steps.visible = true; P.steps.position.set(STEPS_X, 0, STEPS_Z); P.steps.rotation.set(0, 0, 0);
  const wk = seg(lt, 0, 1.6), x = lerp(-2.75, -0.45, ease(wk));
  const turn = ease(seg(lt, 1.5, 1.8));
  const chest = kf(lt, [[1.6, 0], [1.9, 1]], backOut);
  // puffing from the climb until he speaks; then his body talks exactly while his voice plays; then still
  const sp = t - T_BUB3, talk = sp >= 0 && sp < V.chest[1], puff = lt > 1.35 && sp < 0;
  STAGE.pose("tan", { x, z: STEPS_Z, dy: stepY(x) + (wk > 0 && wk < 1 ? Math.abs(Math.sin(lt * 9)) * 0.03 : 0), rotY: lerp(PI / 2, 0.3, turn), walk: wk > 0 && wk < 1 ? lt * 9 : 0,
    armR: chest * 1.05, armOutR: -chest * 0.42, armL: lerp(0.2, 1.25, seg(lt, 1.6, 1.95)), armOutL: 0.15,
    headPitch: puff ? 0.05 + Math.abs(wob(lt, 1.6)) * 0.08 : talk ? 0.06 + wob(sp, 2.1) * 0.05 : 0.04,
    tilt: puff ? wob(lt, 0.8) * 0.08 : talk ? wob(sp, 0.9) * 0.08 : wob(lt, 0.4) * 0.03,
    squash: puff ? Math.abs(wob(lt, 1.6)) * 0.12 : talk ? Math.abs(wob(sp, 2.3)) * 0.06 : breathe(lt), lean: puff || talk ? 0.12 : 0.08,
    face: faceAt(lt, [[0, "code"], [1.35, "sleepy"], [1.75, "worry"]]) });
  holdProp(P.phone, tan, 0, [0, 0.0, 0.06], PHONE_ROT);
  weiWatch(lt, -2.4, -1.4, 0.5, { yaw: 0.4, face: faceAt(lt, [[0, "code"], [2.3, "worry"]]) });
  STAGE.pose("lim", { x: 1.6, z: 0.7, rotY: -0.6, armL: 0.3, armR: 0.3, face: faceAt(lt, [[0, "code"], [2.4, "worry"]]), squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, 4.9));
  STAGE.cam([lerp(-1.5, -0.2, k), lerp(1.35, 1.4, k), lerp(4.3, 3.7, k)], [lerp(-1.9, -0.05, ease(seg(lc, 0, 2.0))), lerp(0.85, 1.1, k), 0.1], 38);
  ov.push(card3(t));
  ov.push((c) => { const [x2, y2] = headScreen(tan, 0.5); sfx(c, "HUFF", x2 - 230, y2 + 10, 64, lt - 1.35, { life: 0.9, burst: false, fill: ["#ffffff", "#bfe8ff"] }); sfx(c, "PUFF", x2 - 300, y2 + 100, 64, lt - 1.62, { life: 0.9, burst: false, fill: ["#ffffff", "#bfe8ff"] }); });
  ov.push((c) => { const [hx, hy] = headScreen(tan); voiced(c, BUBBLE3, 1160, 250, hx + 30, hy + 30, tc, T_BUB3, V.chest[1], { size: 34, voice: V.chest[0] }); });
  return { bloom: 0.45 };
});

// 3b · his words become a dated note that lands in the tray "THINGS TO TELL THE DOCTOR"
const T_NOTE = E3 + 5.1;
sh("c11 exp3 tray", T_TRAY, E3 + 6.4, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  P.tray.visible = true; P.tray.position.copy(LAB_TRAY).setY(0.94); P.tray.rotation.set(0, 0, 0);
  P.note.visible = true;
  const k = seg(t, T_NOTE - 0.55, T_NOTE);
  const restY = 0.94 + 0.03, from = new THREE.Vector3(LAB_TRAY.x - 1.4, 1.75, LAB_TRAY.z + 0.6), to = new THREE.Vector3(LAB_TRAY.x, restY, LAB_TRAY.z);
  P.note.position.lerpVectors(from, to, easeIn(k)); P.note.position.y += Math.sin(k * PI) * 0.25;
  const settle = t > T_NOTE ? Math.exp(-(t - T_NOTE) * 7) * Math.sin((t - T_NOTE) * 30) * 0.08 : 0;
  P.note.rotation.set(lerp(-0.3, -PI / 2, easeOut(k)) + settle, lerp(1.2, 0.0, k), lerp(0.6, 0.05, k));
  if (t > T_NOTE) P.note.position.y = restY + Math.abs(settle) * 0.1;
  STAGE.pose("lim", { x: 2.2, z: -0.55, rotY: -0.25, armL: 0.2, armR: 0.2, headPitch: 0.25, face: faceAt(lt, [[0, "code"], [T_NOTE - T_TRAY + 0.2, "wow"]]), squash: breathe(lt, 1) });
  const kc = ease(seg(lc, 0, 1.5));
  STAGE.cam([lerp(LAB_TRAY.x + 0.3, LAB_TRAY.x + 0.18, kc), lerp(1.95, 1.85, kc), lerp(-0.2, -0.38, kc)], [LAB_TRAY.x + 0.02, 0.98, LAB_TRAY.z + 0.02], 36);
  ov.push(card3(t + 9));
  ov.push((c) => flashHit(c, tc - T_NOTE, "#fff3b0", 2));
  ov.push((c) => sfx(c, "FWIP!", 1560, 520, 80, t - T_NOTE - 0.07, { life: 1.0, burst: "#fff6e4" }));
  ov.push((c) => caption(c, CAP3, 70, 60, seg(t, T_CAP3, T_CAP3 + 0.35), { source: CAP3_SRC }));
  return { bloom: 0.4 };
});

// 3c · Dr Lim's own warning and when to call 995, the way Ripple answers. SAFE.
const T_WARN = E3 + 6.6;
sh("c11 exp3 warning", E3 + 6.4, E4, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  P.steps.visible = true; P.steps.position.set(STEPS_X, 0, STEPS_Z);
  const nod = lt > 1.0 && lt < 2.2 ? Math.max(0, wob(lt - 1.0, 1.4)) * 0.17 : 0;
  STAGE.pose("tan", { x: -0.45, z: STEPS_Z, dy: PEDESTAL.top, rotY: -0.05, armL: 1.1, armOutL: 0.15, armR: 0.5, armOutR: -0.1, headPitch: 0.12 + nod, headYaw: 0.1,
    face: faceAt(lt, [[0, "worry"], [1.1, "think"], [2.3, "code"]]), squash: breathe(lt), tilt: wob(lt, 0.5) * 0.05 });
  holdProp(P.phone, tan, 0, [0, 0.0, 0.06], PHONE_ROT);
  STAGE.pose("lim", { x: -1.55, z: -0.95, rotY: 0.55, armR: 0.35, armL: kf(lt, [[0.4, 0.3], [0.7, 1.2], [2.0, 1.2], [2.4, 0.3]], backOut), armOutL: 0.25, headPitch: 0.05,
    face: faceAt(lt, [[0, "code"], [0.5, "happy"]]), squash: breathe(lt, 1), tilt: -0.06 });
  const k = ease(seg(lc, 0, 3.6));
  STAGE.cam([lerp(-0.95, -0.8, k), lerp(1.5, 1.45, k), lerp(3.55, 3.2, k)], [lerp(-0.15, -0.12, k), 1.2, 0.3], 38);
  ov.push(card3(t + 9));
  ov.push((c) => caption(c, CAP3, 70, 60, 1, { source: CAP3_SRC }));
  ov.push((c) => warnCard(c, 1490, 535, seg(t, T_WARN, T_WARN + 0.35)));
  ov.push((c) => flashHit(c, lc - 2.25, "#d8ffe9", 2));
  ov.push((c) => stampSafe(c, "SAFE", 1240, 925, lt - 2.25, { size: 110, rot: -0.14 }));
  return { bloom: 0.45 };
});

// ---- EXP. 04 · Who sees what (E4–E_END: 1363.2–1373.2) ---------------------------------------------------------
const card4 = (t) => card("04", "Who sees what", t, E4);
const DESK = [-1.45, 1.45], T_FLIP = [E4 + 3.05, E4 + 4.35];
const LIM4 = { x: 2.3, z: -0.3, rotY: -0.55 };
const TILES = [["Medicine", "each day"], ["Blood", "pressure"], ["Questions for", "the doctor"], ["Tell you when two", "reminders get no reply"], ["Visit recordings", "and transcripts"], ["Notes Dad", "wrote himself"]];
function famPainter(n) {
  return [`fam${n}`, (c, W, H) => {
    c.fillStyle = "#120d34"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#ffffff"; c.font = `800 46px ${SANS}`; c.textBaseline = "middle"; c.fillText("WEI LING'S PHONE", 40, 52);
    c.fillStyle = "#bfb6ff"; c.font = `600 28px ${SANS}`; c.fillText("This is what Dad agreed to show you.", 40, 102);
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3), x = 30 + col * 328, y = 140 + row * 212, w = 310, h = 196, on = i < n;
      c.fillStyle = on ? "#1fae6b" : "#221c4a"; c.beginPath(); c.roundRect(x, y, w, h, 20); c.fill();
      c.strokeStyle = on ? "#7dffb0" : "#3a3170"; c.lineWidth = 5; c.stroke();
      c.textAlign = "center"; c.fillStyle = on ? "#ffffff" : "#8a82b4";
      let fs = 30; c.font = `800 ${fs}px ${SANS}`;
      while (fs > 22 && Math.max(...TILES[i].map((l) => c.measureText(l).width)) > w - 24) c.font = `800 ${--fs}px ${SANS}`; // fit the tile
      TILES[i].forEach((l, j) => c.fillText(l, x + w / 2, y + 116 + j * 36));
      if (on) { c.strokeStyle = "#ffffff"; c.lineWidth = 10; c.lineCap = "round"; c.beginPath(); c.moveTo(x + w / 2 - 26, y + 52); c.lineTo(x + w / 2 - 6, y + 72); c.lineTo(x + w / 2 + 30, y + 34); c.stroke(); }
      else { c.fillStyle = "#6c6496"; c.fillRect(x + w / 2 - 22, y + 46, 44, 34); c.strokeStyle = "#6c6496"; c.lineWidth = 7; c.beginPath(); c.arc(x + w / 2, y + 46, 14, PI, 0); c.stroke(); }
      c.textAlign = "left";
    }
  }];
}
function deskAt(t) {
  P.desk.visible = true; P.desk.position.set(DESK[0], 0, DESK[1]); P.desk.rotation.set(0, 0.12, 0);
  for (let i = 0; i < 6; i++) P.desk.userData.set(i, i < 2 ? backOut(seg(t, T_FLIP[i], T_FLIP[i] + 0.15), 2) : 0);
}
const lit = (t) => (t > T_FLIP[1] + 0.05 ? 2 : t > T_FLIP[0] + 0.05 ? 1 : 0);
function tanDesk(t, lt, o = {}) {
  const reach = Math.max(kf(t, [[T_FLIP[0] - 0.4, 0], [T_FLIP[0] - 0.1, 1.35], [T_FLIP[0] + 0.25, 1.2], [T_FLIP[0] + 0.5, 0.9]], ease) * (t < T_FLIP[1] - 0.6 ? 1 : 0),
    kf(t, [[T_FLIP[1] - 0.6, 0.9], [T_FLIP[1] - 0.1, 1.35], [T_FLIP[1] + 0.3, 1.2], [T_FLIP[1] + 0.8, 0.3]], ease) * (t >= T_FLIP[1] - 0.6 ? 1 : 0));
  const proud = t > T_FLIP[1] + 0.8;
  STAGE.pose("tan", { x: DESK[0], z: DESK[1] - 0.62, dy: 0.17, rotY: 0.12, armR: proud ? 0.3 : reach, armOutR: t < T_FLIP[1] - 0.6 ? 0.05 : 0.3, armL: proud ? 0.3 : 0.3, lean: reach * 0.12,
    headPitch: proud ? 0 : 0.3, face: faceAt(t - E4, [[0, "code"], [2.4, "think"], [T_FLIP[1] - E4 + 0.3, "happy"]]), squash: Math.abs(t - T_FLIP[0]) < 0.08 || Math.abs(t - T_FLIP[1]) < 0.08 ? 0.15 : breathe(lt), tilt: wob(lt, 0.5) * 0.05, ...o });
}
function weiScreen(t, lt, o = {}) {
  const n = lit(t), hop = n === 2 && t < T_FLIP[1] + 0.7 ? Math.sin(seg(t, T_FLIP[1] + 0.1, T_FLIP[1] + 0.6) * PI) * 0.22 : 0;
  STAGE.pose("wei", { x: 1.35, z: -1.55, rotY: 0.3, dy: hop, headYaw: o.yaw ?? 0.25, headPitch: -0.1, armR: n ? 0.6 + n * 0.5 : 0.25, armOutR: n === 2 ? 0.8 : 0.2, armL: n === 2 ? 1.6 : 0.25, armOutL: n === 2 ? 0.8 : 0.1,
    face: faceAt(t - E4, [[0, "think"], [T_FLIP[0] - E4 + 0.15, "wow"], [T_FLIP[1] - E4 + 0.2, "love"]]), squash: hop ? -0.15 : breathe(lt, 2) });
}

// 4a · his switch console, every switch off; her screen dark
sh("c11 exp4 switches", E4, E4 + 2.4, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1, screen: famPainter(0) });
  deskAt(t);
  tanDesk(t, lt, { headPitch: 0.15 + seg(lt, 1.4, 2.0) * 0.2 });
  weiScreen(t, lt);
  STAGE.pose("lim", { ...LIM4, armL: 0.3, armR: 0.3, face: "code", squash: breathe(lt, 1), tilt: wob(lt, 0.5) * 0.04 });
  const k = ease(seg(lc, 0, 2.4));
  STAGE.cam([lerp(-0.45, -0.6, k), lerp(1.72, 1.62, k), lerp(5.4, 4.9, k)], [lerp(-0.3, -0.4, k), 1.1, -0.6], 38);
  ov.push(card4(t));
  ov.push((c) => { const [x, y] = toScreen(DESK[0], 0.9, DESK[1]); sfx(c, "CLUNK", x, y - 260, 70, lt - 0.3, { life: 1.0, burst: false, fill: ["#ffe37a", "#ff8a1f"] }); });
  return { bloom: 0.45 };
});

// 4b · close on the console: he flips "Medicine each day" (CLICK)
sh("c11 exp4 flip", E4 + 2.4, E4 + 3.9, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1, screen: famPainter(lit(t)) });
  deskAt(t);
  tanDesk(t, lt);
  const k = ease(seg(lc, 0, 1.5));
  STAGE.cam([lerp(DESK[0] + 0.35, DESK[0] + 0.25, k), lerp(1.55, 1.5, k), lerp(DESK[1] + 1.8, DESK[1] + 1.6, k)], [DESK[0] + 0.02, 0.72, DESK[1] - 0.3], 40);
  ov.push(card4(t + 9));
  ov.push((c) => flashHit(c, tc - T_FLIP[0], "#fff3b0", 2));
  ov.push((c) => sfx(c, "CLICK!", 470, 300, 80, t - T_FLIP[0] - 0.07, { life: 0.9 }));
  return { bloom: 0.45 };
});

// 4c · her screen: the tile lights (DING); he flips "Blood pressure" off screen (CLICK) and the second tile lights
sh("c11 exp4 screen", E4 + 3.9, E4 + 5.6, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1, screen: famPainter(lit(t)) });
  weiScreen(t, lt, { yaw: -0.2 });
  const k = ease(seg(lc, 0, 1.7));
  STAGE.cam([lerp(1.55, 1.45, k), lerp(1.2, 1.25, k), lerp(1.6, 1.3, k)], [lerp(2.2, 2.15, k), lerp(1.65, 1.7, k), -3.1], 44);
  ov.push(card4(t + 9));
  ov.push((c) => sfx(c, "CLICK!", 230, 520, 64, t - T_FLIP[1], { life: 0.8, burst: false, fill: ["#ffffff", "#ffd94a"] }));
  // the DINGs sit beside her screen (its right edge), never over its header or tiles
  ov.push((c) => { const [x, y] = toScreen(LAB_SCREEN.x + 1.45, LAB_SCREEN.y, LAB_SCREEN.z); sfx(c, "DING!", Math.min(1770, x + 140), y + 40, 80, t - T_FLIP[1] - 0.06, { life: 1.0 }); });
  ov.push((c) => { const [x, y] = toScreen(LAB_SCREEN.x - 1.45, LAB_SCREEN.y, LAB_SCREEN.z); sfx(c, "DING!", Math.max(150, x - 130), y + 60, 70, lt - 0.05, { life: 0.8, burst: false }); });
  return { bloom: 0.5 };
});

// 4d · wide: two switches on, two tiles lit, four stay dark. EMPOWERING.
sh("c11 exp4 allows", E4 + 5.6, E_END, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1, screen: famPainter(2) });
  deskAt(t);
  tanDesk(t, lt, { armL: 0.3, armR: kf(lt, [[1.2, 0.3], [1.35, 0.2], [1.6, 2.4]], backOut), armOutR: 0.35, headPitch: -0.05 });
  weiScreen(t, lt, { yaw: 0.35 });
  STAGE.pose("lim", { ...LIM4, armL: 0.3, armR: kf(lt, [[2.3, 0.3], [2.45, 0.2], [2.7, 1.2]], backOut), armOutR: 0.3, face: faceAt(lt, [[0, "code"], [1.0, "happy"]]), squash: breathe(lt, 1), tilt: wob(lt, 0.5) * 0.04 });
  const k = ease(seg(lc, 0, 4.4));
  STAGE.cam([lerp(-0.1, -0.3, k), lerp(1.78, 1.72, k), lerp(5.5, 5.15, k)], [lerp(-0.15, -0.25, k), 1.2, -0.8], 38);
  ov.push(card4(t + 9));
  ov.push((c) => caption(c, "Family sees only what he allows.", 70, 60, seg(lt, 0.2, 0.55)));
  ov.push((c) => { const [x, y] = headScreen(tan, 0.7); sfx(c, "YES!", x + 120, y - 20, 76, lt - 1.4, { life: 1.0, burst: "#ffe37a" }); });
  ov.push((c) => flashHit(c, lc - 2.4, "#d8ffe9", 2));
  ov.push((c) => stampSafe(c, "EMPOWERING", 1180, 880, lt - 2.4, { size: 96, rot: -0.1 }));
  return { bloom: 0.45 };
});
