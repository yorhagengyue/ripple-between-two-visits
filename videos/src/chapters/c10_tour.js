// Chapter 10 · What Ripple does (film 237–322). A tour of the real app on a little theatre stage, one beat per challenge
// bullet: the real recording plays 1:1 in a big phone panel on the left, the challenge's words land on the right as a
// feature label, and the trio act it out under the label. The curtain opens at the start and closes at the end.
//   237.0 intro: the curtain opens on the trio          B4 THE VISIT, KEPT (two phones for the live part)
//   B1 MEDICATION UNDERSTANDING                         B5 FAMILY, ON HIS TERMS
//   B2 HEALTH TRACKING (two phones for the calendars)   B6 MEDICATION MANAGEMENT AND PREVENTION (3D only)
//   B3 HEALTHCARE PREPARATION                           outro: the bow, the curtain closes (hand-off to c11)
// Beat lengths follow the clip windows below, so a retimed recording only changes numbers in WIN.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, backOut, clamp, lerp, twos } from "../core.js";
import { sfx, bubble, panel, ring, chip, flashHit } from "../overlay.js";
import { featureLabel } from "../overlay2.js";
import { frame } from "../media.js";
import { buildC10Stage } from "../sets/c10_stage.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";

// ==== clip windows: every clip name, source time and spoken line lives here (source seconds; frame 1 = 0 s, 30/s) ====
// The story-time recordings (s1-his, s1-her, s2-his, s2-her, s3-his; timings in app-flows-story/<scene>/*-taps.txt).
// A retimed recording changes only the numbers (and the spoken lines) here.
const WIN = {
  b1: { lead: 0.4, segs: [
    { clip: "s3-his", in: 7.0, out: 12.3 },         // Records › Scan a medicine box: photo 7.6, "Reading the box…", how to take it from 10.0
    { clip: "s3-his", in: 13.9, out: 16.5 },        // swiped to "What it is for" (the leaflet line) 14.2
    { clip: "s3-his", in: 20.8, out: 25.8 } ],      // "Your doctor's own words"; Play 22.0, it plays from 22.2
    snap: 7.6, read: 10.0, forLine: 14.2, play: 22.0,
    say: { clip: "s3-his", at: 22.2, lines: ["So you take it every day,", "even when you feel fine."] } }, // the card's own last sentence
  b2: { lead: 0.3, segs: [
    { clip: "s2-his", in: 5.9, out: 12.2 },         // keys 1 5 2 9 6, Save 10.9, "152/96 is outside the target Dr Lim set" 11.1
    { clip: "s2-his", in: 15.2, out: 19.5 },        // hold to tell Ripple (15.5); his voice from 15.9
    { clip: "s2-his", in: 37.4, out: 40.5, her: { clip: "s2-her", in: 2.4 } } ], // both calendars mark the day; his day opens 39.3
    keys: [6.1, 6.5, 7.0, 8.3, 8.8], save: 10.9, card: 11.1, hold: 15.5, dayTap: 39.3,
    say: { clip: "s2-his", at: 15.9, lines: ["Did tai chi, no breakfast yet.", "早上打完太极，还没吃早餐。"] } },
  b3: { lead: 0.3, segs: [
    { clip: "s2-his", in: 26.0, out: 36.4 } ],      // "Adding a question…", his words noted and the question written 26.6; See your questions 30.9; the list 33.3
    noted: 26.6, seeQ: 30.9, list: 33.3 },
  b4: { lead: 0.3, segs: [
    { clip: "s1-his", in: 18.55, out: 19.9 },       // the consent card; "The doctor agreed: record" 19.8 (cut before the "-1:-7" timer, 19.93-20.45)
    { clip: "s1-his", in: 98.8, out: 107.4, her: { clip: "s1-her", in: 98.8, srcY: 259 } }, // his tai chi question (1:03 You) and Dr Lim's answer on both phones (her header cropped off: her panel is then 540 wide and her captions read at 720p)
    { clip: "s1-his", in: 138.133, out: 139.033 },  // "The recording is saved" (Finished was tapped 136.6 under the enlarged summary; 137.8-138.1 is the summary fading and the page changing, ghosted or half-drawn)
    { clip: "s1-his", in: 148.6, out: 151.35 } ],     // Ripple's summary, "Did the doctor say this?" (148.533 is the page before, 148.567 has the Ask button one frame off; this take has no tap on Yes)
    agree: 19.8, limTalk: [92.8, 101.5], answer: 104.3, weiTalk: [103.6, 109.0], finished: 138.133,
    yes: { at: 150.6, x: 0.499, y: 0.761 } },        // ring over "Yes, the doctor did" (fractions of the 585 x 1266 frame); then cut
  b5: { lead: 0.3, segs: [
    { clip: "s1-her", in: 19.6, out: 28.3 },        // "Dad's visit is being recorded" 20.0, Watch live 22.2, first captions 27.5
    { clip: "s2-her", in: 4.8, out: 9.8 } ],        // the day: "Dad noted: …"; swipe down 8.1
    banner: 20.0, watch: 22.2, caption: 27.5, swipe: 8.1 },
};

// The labels: the challenge's own words and one line each (wording from second-half-facts.md sections 3 and 6.10),
// each line 12 words or fewer.
const LABEL = {
  b1: ["MEDICATION UNDERSTANDING", "Scan: how to take it, what it's for, his doctor's own words."],
  b2: ["HEALTH TRACKING", "Outside Dr Lim's target: he says why; both calendars mark the day."],
  b3: ["HEALTHCARE PREPARATION", "The reading becomes a question on his list for the next visit."],
  b4: ["THE VISIT, KEPT", "Recorded with consent: live captions on both phones; he confirms each line."],
  b5: ["FAMILY, ON HIS TERMS", "Family sees only what he allows; every look is visible to him."],
  b6: ["MEDICATION MANAGEMENT AND PREVENTION", "One tap logs a dose. Screening and vaccination lines from national tables."],
};

// ==== timing ====
const T0 = 237, INTRO = 2.6, OUTRO = 4.0, T1 = 322;
const BEATS = ["b1", "b2", "b3", "b4", "b5"].map((k) => Object.assign(WIN[k], { key: k }));
{ let a = T0 + INTRO; for (const b of BEATS) { let s = b.lead; for (const g of b.segs) { g.at = s; s += g.out - g.in; g.end = s; } b.a = a; b.dur = s; a += s; } }
const B6 = { key: "b6", a: BEATS[4].a + BEATS[4].dur, b: T1 - OUTRO }; B6.dur = B6.b - B6.a;
const [b1, b2, b3, b4, b5] = BEATS;

/** beat time of a source time (in `clip`), or null when that moment is cut out */
function cue(b, src, clip = b.segs[0].clip) {
  for (const g of b.segs) {
    if (g.clip === clip && src >= g.in && src <= g.out) return g.at + src - g.in;
    if (g.her && g.her.clip === clip && src >= g.her.in && src <= g.her.in + g.out - g.in) return g.at + src - g.her.in;
  }
  return null;
}
const segIdx = (b, bt) => { let i = 0; while (i + 1 < b.segs.length && bt >= b.segs[i + 1].at) i++; return i; };

// ==== the set and cast ====
const stage = STAGE.set("c10.stage", buildC10Stage());
const P = stage.userData.props;
const tan = STAGE.need("tan", makeTanBot), wei = STAGE.need("wei", makeWeiBot), lim = STAGE.need("lim", makeLimBot);

// ==== helpers ====
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
/** camera that looks from (yaw, pitch, dist) at focus F and puts F at screen NDC (sx, sy) */
function camF(F, { yaw = 0, pitch = 0.14, dist = 5, fov = 30, sx = 0.3, sy = -0.26, roll = 0 }) {
  const Pp = [F[0] + dist * Math.sin(yaw) * Math.cos(pitch), F[1] + dist * Math.sin(pitch), F[2] + dist * Math.cos(yaw) * Math.cos(pitch)];
  _f.set(F[0] - Pp[0], F[1] - Pp[1], F[2] - Pp[2]).normalize(); _r.crossVectors(_f, UP).normalize(); _u.crossVectors(_r, _f);
  const hh = dist * Math.tan((fov * Math.PI) / 360), hw = (hh * 16) / 9;
  STAGE.cam(Pp, [F[0] - _r.x * sx * hw - _u.x * sy * hh, F[1] - _r.y * sx * hw - _u.y * sy * hh, F[2] - _r.z * sx * hw - _u.z * sy * hh], fov, roll);
}
/** interpolate two camera settings over [a, b] (eased) */
function camLerp(bt, a, b, A, B, fn = ease) {
  const k = fn(seg(bt, a, b)), o = {};
  for (const key of Object.keys(A)) o[key] = Array.isArray(A[key]) ? A[key].map((v, i) => lerp(v, B[key][i], k)) : lerp(A[key], B[key] ?? A[key], k);
  return o;
}
const SX1 = 0.3, SY1 = -0.26, SX2 = 0.52, SY2 = -0.3; // single-panel and two-panel framings
/** 0→1→0 punch for camera hits */
const punch = (bt, at, len = 0.3) => (bt < at || bt > at + len ? 0 : Math.sin((Math.PI * (bt - at)) / len));
/** screen position of a world point */
function scr(x, y, z) { STAGE.camera.updateMatrixWorld(true); _v.set(x, y, z).project(STAGE.camera); return [((_v.x + 1) / 2) * 1920, ((1 - _v.y) / 2) * 1080]; }
function handPos(actor, i, fwd = 0, up = 0) {
  actor.g.updateMatrixWorld(true);
  const p = actor.hands[i].getWorldPosition(new THREE.Vector3()), ry = actor.g.rotation.y;
  return p.add(new THREE.Vector3(Math.sin(ry) * fwd, up, Math.cos(ry) * fwd));
}
function place(o, p, ry = 0, rx = 0, rz = 0, s = 1) { o.visible = true; o.position.copy(p); o.rotation.set(rx, ry, rz, "YXZ"); o.scale.setScalar(s); }
const _q = new THREE.Quaternion();
/** hold a prop in a hand so the grip reads: the prop gets the world rotation (ry, rx, rz) (YXZ); its centre sits `lift` m
 *  from the fist along the prop's own up axis (so its lower end is inside the fist), `along` m along the arm (negative =
 *  back into the fist), `out` m along the prop's own +z, `side` m along its own +x (lift and side scale with s). Returns
 *  the prop's centre. */
function grip(prop, actor, i, ry, rx = 0, { lift = 0.075, along = -0.045, out = 0, side = 0, rz = 0, s = 1 } = {}) {
  actor.g.updateMatrixWorld(true);
  const h = actor.hands[i], p = h.getWorldPosition(new THREE.Vector3());
  h.getWorldQuaternion(_q);
  const arm = new THREE.Vector3(0, -1, 0).applyQuaternion(_q);
  prop.rotation.set(rx, ry, rz, "YXZ");
  const up = new THREE.Vector3(0, 1, 0).applyEuler(prop.rotation), nz = new THREE.Vector3(0, 0, 1).applyEuler(prop.rotation), nx = new THREE.Vector3(1, 0, 0).applyEuler(prop.rotation);
  p.addScaledVector(arm, along).addScaledVector(up, lift * s).addScaledVector(nz, out).addScaledVector(nx, side * s);
  prop.visible = true; prop.position.copy(p); prop.scale.setScalar(s);
  return p;
}
/** the fist point of a hand (a little back from the hand tip, inside the arm's end) */
function fist(actor, i, along = -0.045) {
  actor.g.updateMatrixWorld(true);
  const h = actor.hands[i], p = h.getWorldPosition(new THREE.Vector3());
  h.getWorldQuaternion(_q);
  return p.addScaledVector(new THREE.Vector3(0, -1, 0).applyQuaternion(_q), along);
}
/** a face sequence [[t, face], ...] with a blink frame (0.08 s) before every change, plus an idle blink */
function faceAt(bt, seq, ph = 0) {
  let f = seq[0][1];
  for (let i = 1; i < seq.length; i++) { const [tc, fc] = seq[i]; if (bt >= tc) f = fc; else if (bt >= tc - 0.08 && fc !== f) return "blink"; }
  const p = (bt + 10 + ph) % 3.3; return p < 0.08 && f !== "love" ? "blink" : f;
}
/** pose with a breathing squash and a small head wobble unless given */
function act(name, p, bt, ph = 0) {
  const a = STAGE.pose(name, { squash: wob(bt, 0.45, ph) * 0.03, tilt: wob(bt, 0.3, ph + 1) * 0.05, ...p });
  return a;
}
/** a talking head bob */
const talk = (bt, a, b) => (bt > a && bt < b ? Math.abs(Math.sin((bt - a) * 9)) * 0.07 : 0);
/** tidy other chapters' hand props off our cast (visibility only; they set their own per shot) */
function cleanHands() { for (const a of [tan, wei, lim]) for (const h of a.hands) for (const ch of h.children) ch.visible = false; }
/** the 2-4 frame hit flash, kept off the app panel (only right of x0) */
function hitFlash(c, age, geo = SINGLE, col = "#fff3b0") {
  if (age < 0 || age > 0.12) return;
  c.save(); c.beginPath(); c.rect(0, 0, 1920, 1080);
  if (geo) c.roundRect(geo.x - geo.w / 2 - 16, geo.y - geo.h / 2 - 16, geo.w + 32, geo.h + 32, 38);
  c.clip("evenodd"); flashHit(c, age, col); c.restore();
}
const HIT = 0.08; // the word lands 2-3 frames after the flash
function base() {
  STAGE.show("c10.stage");
  STAGE.lights("warm", { bg: "#2a1a4a", keyPos: [2.6, 6.5, 6.5], keyTarget: [0, 0.4, 0], hemi: 1.05, keyI: 2.4, rimI: 1.1 });
  stage.userData.setCurtain(1);
  stage.userData.hideProps();
  P.ped.scale.setScalar(1); P.week.scale.setScalar(1);
  cleanHands();
}

// ==== the 2D layer: panels and labels ====
const SINGLE = { x: 360, y: 512, w: 406, h: 879 };
// two phones: as big as the frame allows with the name chips above them (the captions must read at 720p)
const DUAL_L = { x: 258, y: 546, w: 430, h: 930 }, DUAL_R = { x: 735, y: 546, w: 430, h: 930 };
const LX = 650, LX2 = 1090, LY = 70;
/** source time of a window on the 30 fps grid: the window's first frame is exactly `in`, then one source frame per film
 *  frame (beats can start half a frame off the grid; plain rounding would then flip between neighbours) */
const srcAt = (g0, dt, g1) => Math.min(g1, g0 + Math.max(0, Math.floor(dt * 30 + 1e-6)) / 30) - 1e-4;
/** her panel: same height and left edge as DUAL_R; a top crop (srcY source px) makes it wider, so her small captions grow */
function herGeo(srcY = 0) { const w = (DUAL_R.h * 585) / (1266 - srcY); return { ...DUAL_R, w, x: DUAL_R.x - DUAL_R.w / 2 + w / 2, srcY }; }
const mixGeo = (A, B, k) => ({ x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), w: lerp(A.w, B.w, k), h: lerp(A.h, B.h, k) });

function drawPanel(c, img, g, o = {}) {
  if (!img) return;
  c.save(); c.translate(g.x, g.y); c.scale((o.sx ?? 1) * (o.bump ?? 1), o.bump ?? 1); c.translate(-g.x, -g.y);
  const crop = g.srcY ? { srcY: g.srcY, srcH: img.naturalHeight - g.srcY } : {};
  if (o.k != null) panel(c, img, g.x, g.y, g.w, g.h, o.k, { radius: 22, ...crop }); else panel(c, img, g.x, g.y, g.w, g.h, 1, { noPop: true, radius: 22, ...crop });
  // the window-cut flash lights the panel's frame, never the app picture (a white wash over a dark screen reads as a
  // half-rendered frame)
  if (o.flash > 0) { c.save(); c.globalAlpha = Math.min(1, o.flash * 2); c.strokeStyle = "#ffffff"; c.lineWidth = 9; c.beginPath(); c.roundRect(g.x - g.w / 2 - 7, g.y - g.h / 2 - 7, g.w + 14, g.h + 14, 29); c.stroke(); c.restore(); }
  c.restore();
  if (o.tag && (o.k ?? 1) > 0.3 && (o.sx ?? 1) > 0.5) chip(c, o.tag, g.x, g.y - g.h / 2 - 34, clamp(((o.k ?? 1) - 0.3) * 2), { size: 22 });
}

/** the feature label with a soft dark band behind its line (the bright backdrop must not fight the words) */
function label(c, key, x, k, maxW) {
  if (k <= 0) return;
  const [title, line] = LABEL[key];
  c.save(); c.font = `700 34px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;
  const words = line.split(" "), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 34, dx = (1 - backOut(clamp(k), 1.5)) * 80;
  c.globalAlpha = clamp(k * 2) * 0.88; c.fillStyle = "#1a1030";
  c.beginPath(); c.roundRect(x + dx - 12, LY + 88, w, lines.length * 44 + 18, 14); c.fill();
  c.restore();
  featureLabel(c, title, line, x, LY, k, { maxW });
}

/** dual weight (0 single, 1 two phones) and the label's x for beat b at bt */
function dualK(b, bt) {
  let k = 0;
  b.segs.forEach((g, i) => { if (!g.her) return; const last = i === b.segs.length - 1;
    k = Math.max(k, ease(seg(bt, g.at, g.at + 0.28)) * (last ? 1 : 1 - ease(seg(bt, g.end, g.end + 0.28)))); });
  return k;
}
function labelX(b, bt) {
  let k = 0;
  b.segs.forEach((g, i) => { if (!g.her) return; const last = i === b.segs.length - 1;
    k = Math.max(k, ease(seg(bt, g.at - 0.42, g.at - 0.08)) * (last ? 1 : 1 - ease(seg(bt, g.end + 0.24, g.end + 0.56)))); });
  return lerp(LX, LX2, k);
}

/** panels and label of a beat: flip in at the start (slide in for the first beat), flip out at the end (B5 slides out
 *  in B6 instead), a bump and a flash on window cuts, the second phone during `her` windows. */
function beatLayer(b, bt, ov, wait) {
  const i = segIdx(b, bt), g = b.segs[i], src = srcAt(g.in, bt - g.at, g.out);
  const dk = dualK(b, bt), geo = mixGeo(SINGLE, DUAL_L, dk);
  let sx = 1, slide = 0;
  if (b === b1) slide = (1 - backOut(seg(bt, 0, 0.45), 1.2)) * -640;
  else sx = Math.max(0.02, seg(bt, 0, 0.16));
  if (b !== b5) sx = Math.min(sx, Math.max(0.02, 1 - seg(bt, b.dur - 0.16, b.dur)));
  const cutAge = i > 0 && !g.her && !b.segs[i - 1].her ? bt - g.at : 9;
  let img; wait(frame(g.clip, src).then((x) => (img = x)));
  // her phone: during her windows, and shrinking away just after one
  let her = null;
  b.segs.forEach((h) => {
    if (!h.her) return;
    const k = Math.min(seg(bt, h.at + 0.04, h.at + 0.34), 1 - seg(bt, h.end, h.end + 0.2));
    if (k <= 0 && !(bt >= h.at && bt < h.end)) return;
    const hs = srcAt(h.her.in, bt - h.at, h.her.in + h.end - h.at);
    her = { k: Math.max(k, 0.001), src: hs, clip: h.her.clip, srcY: h.her.srcY ?? 0 };
  });
  let herImg; if (her) wait(frame(her.clip, her.src).then((x) => (herImg = x)));
  const lk = Math.min(seg(bt, 0.05, 0.45), b === b5 ? 1 : 1 - seg(bt, b.dur - 0.2, b.dur)), lx = labelX(b, bt);
  ov.push((c) => {
    drawPanel(c, img, { ...geo, x: geo.x + slide }, { sx, bump: 1 + 0.018 * (1 - seg(cutAge, 0, 0.2)), flash: 0.45 * (1 - seg(cutAge, 0, 0.12)), tag: dk > 0.5 ? "MR TAN" : null });
    if (her && herImg) drawPanel(c, herImg, herGeo(her.srcY), { k: her.k, sx, tag: "WEI LING" });
    label(c, b.key, lx, lk, Math.min(800, 1860 - lx));
  });
  return { geo, dk };
}

/** register a beat's camera shots: cuts are beat times; each cam(bt) sets the camera for that shot */
function beatShots(b, name, cuts, cams, poseFn, layer = beatLayer) {
  cuts.forEach((c0, j) => {
    const c1 = j + 1 < cuts.length ? cuts[j + 1] : b.dur;
    shot(`c10 ${name}${String.fromCharCode(97 + j)}`, b.a + c0, b.a + c1, ({ t, ov, wait }) => {
      const bt = t - b.a;
      base();
      const fx = [];
      const look = poseFn(twos(bt), fx, j) || {};  // characters and overlays on twos, the camera on plain time
      cams[j](bt);
      for (const f of fx) ov.push(f);  // sound effects and bubbles placed from the 3D, under the panels
      if (layer) layer(b, bt, ov, wait);
      for (const f of look.after ?? []) ov.push(f);
      return { bloom: look.bloom ?? 0.5 };
    });
  });
}

// ==== intro: the curtain opens on the trio; the camera swings right to make room for the phone ====
const CAM_B1A = { F: [-0.3, 0.62, 0.35], yaw: 0.12, pitch: 0.14, dist: 5.0, fov: 30, sx: SX1, sy: -0.3 };
function poseB1(bt, fx) {
  // shared by the intro (bt < 0) and beat 1
  // a low stand, so his short arms can hold the phone over the box
  P.ped.visible = true; P.ped.position.set(-0.62, 0, 0.62); P.ped.rotation.set(0, 0, 0); P.ped.scale.set(1, 0.55, 1);
  place(P.medBox, new THREE.Vector3(-0.62, 0.35, 0.62), 0.35);
  const snap = cue(b1, b1.snap) ?? 1, read = cue(b1, b1.read) ?? 3.9, forL = cue(b1, b1.forLine) ?? 6.5;
  const play = cue(b1, b1.play) ?? 10, say = cue(b1, b1.say.at, b1.say.clip) ?? 10.2;
  const turnLim = 8.6;
  // Mr Tan: phone up and out proudly, screen to us (intro); reach over the box, SNAP; lift it to read, clear of the box,
  // nod; turn to Dr Lim, bring it to his chest and tap Play with the other hand; hold it up beside his head as it plays
  const rotY = kf(bt, [[-0.7, 0], [0, -0.55], [snap + 0.7, -0.55], [read - 0.2, -0.25], [turnLim, -0.25], [turnLim + 0.5, 0.35]]);
  const up0 = turnLim + 0.3, up1 = play - 0.15;  // he lifts it beside his head before he presses Play
  const armR = kf(bt, [[-1.9, 0.2], [-1.5, 2.45], [-0.7, 2.45], [0, 1.4], [0.65, 2.15], [snap, 2.2], [snap + 0.1, 2.05], [snap + 0.7, 2.0], [turnLim, 2.0],
    [up0, 1.8], [up1, 2.5]]);
  const armOutR = kf(bt, [[-1.9, 0.1], [-1.5, 0.55], [-0.7, 0.55], [0, 0.12], [snap + 0.3, 0.12], [snap + 0.7, 0.3], [turnLim, 0.3], [up0, 0.3], [up1, 0.5]]);
  const lean = kf(bt, [[0, 0], [0.6, 0.22], [snap + 0.4, 0.22], [snap + 0.8, 0.02]]);
  const nod = (bt > read && bt < read + 0.8 ? Math.sin((bt - read) * 16) * 0.12 : 0) + (bt > forL && bt < forL + 0.7 ? Math.sin((bt - forL) * 16) * 0.1 : 0) + (bt > say + 0.5 && bt < say + 1.5 ? Math.sin((bt - say) * 12) * 0.1 : 0);
  // Play: his short arms cannot cross the beard, so he presses it with the thumb of the hand that holds it (a small jab)
  const press = kf(bt, [[play - 0.3, 0], [play - 0.06, 1], [play + 0.12, 0]]);
  const tanFace = faceAt(bt, [[-9, "happy"], [-0.4, "code"], [snap + 0.5, "think"], [read, "happy"], [read + 1.6, "code"], [forL, "happy"], [forL + 1.2, "think"], [say + 0.3, "happy"], [say + 2.4, "love"]]);
  act("tan", { x: -0.1, z: 0.4, rotY, armR: armR + press * 0.12, armOutR: armOutR + lean * 0.3, armL: 0.15 + seg(bt, say + 0.3, say + 0.7) * 0.25, armOutL: 0.12, lean,
    headPitch: kf(bt, [[0, 0.05], [0.6, 0.32], [snap + 0.5, 0.32], [snap + 0.9, 0.12], [turnLim, 0.12], [up1, 0.05]]) + nod,
    headYaw: kf(bt, [[snap + 0.5, 0], [snap + 0.9, -0.25], [turnLim, -0.25], [up1, 0.2]]),
    face: tanFace, squash: bt > snap && bt < snap + 0.18 ? 0.22 : wob(bt, 0.45) * 0.03 }, bt);
  const reading = seg(bt, snap + 0.3, snap + 0.8);
  const show = seg(bt, up0, up1);
  // the phone (in his right hand): screen to us in the intro; flat over the box with its camera down for the scan; then
  // screen toward his visor; at the end the screen turns out toward Dr Lim and us
  const ry = bt < -0.4 ? 0 : lerp(rotY + Math.PI, rotY + 0.15, show);
  const rx = bt < -0.4 ? 0 : bt < snap + 0.3 ? -1.5 * seg(bt, -0.4, 0.4) : lerp(lerp(-1.5, -0.3, reading), 0.1, show);
  grip(P.phoneTan, tan, 1, ry, rx);
  P.phoneTan.userData.screen.color.set(bt > play && bt < play + 0.3 ? "#ffffff" : "#d9ccff");
  // the camera flash at the scan
  const fk = 1 - seg(bt, snap, snap + 0.25);
  if (bt >= snap && fk > 0) place(P.flash, P.phoneTan.position.clone().add(new THREE.Vector3(0, -0.14, 0)), 0, 0, 0, 0.4 + 0.9 * (1 - fk));
  P.flash.material.opacity = 1;
  // Wei Ling: waves in the intro, then leans in to read over his shoulder
  const weiLean = seg(bt, read - 0.2, read + 0.4) * (1 - seg(bt, 8.6, 9.2));
  act("wei", { x: -1.25, z: -0.05, rotY: lerp(0.2, 0.75, weiLean), lean: weiLean * 0.18, headYaw: weiLean * 0.25, headPitch: weiLean * 0.15,
    wave: bt > -1.9 && bt < -0.3 ? bt * 1.4 : null, armL: bt > say + 0.6 && bt < say + 2.6 ? 2.6 : 0.1,
    face: faceAt(bt, [[-9, "happy"], [0, "code"], [read + 0.1, "wow"], [forL + 0.2, "happy"], [8.8, "code"], [say + 0.7, "love"]], 1.3),
    dy: bt > say + 0.6 && bt < say + 1.1 ? Math.sin((bt - say - 0.6) * 6.3) * 0.12 : 0 }, bt, 1.3);
  // Dr Lim: nods along; when his own words play he puts a hand on his chest and nods, proud
  const limChest = seg(bt, say + 0.1, say + 0.5);
  act("lim", { x: 0.85, z: -0.05, rotY: lerp(-0.25, -0.55, seg(bt, turnLim, turnLim + 0.6)), armL: limChest * 0.75, armOutL: 0.1 - limChest * 0.45, lean: -0.08 * limChest,
    headPitch: (bt > say + 0.3 && bt < say + 1.8 ? Math.sin((bt - say) * 10) * 0.1 : 0), headYaw: kf(bt, [[0, 0.3], [6, 0.3]]),
    face: faceAt(bt, [[-9, "happy"], [0, "code"], [snap + 0.2, "wow"], [read, "happy"], [read + 2, "code"], [say + 0.3, "happy"], [say + 2, "love"]], 2.1) }, bt, 2.1);
  // sound effects
  fx.push((c) => { const [x, y] = scr(P.phoneTan.position.x, P.phoneTan.position.y, P.phoneTan.position.z); hitFlash(c, bt - snap, SINGLE, "#ffffff"); sfx(c, "SNAP!", Math.max(x - 60, 860), Math.max(400, y - 230), 92, bt - snap - HIT, { life: 1.0, burst: "#ffffff" }); });
  fx.push((c) => sfx(c, "DING!", 1560, 400, 70, bt - read, { life: 0.9, burst: false, fill: ["#fff6a8", "#ffb02e"] }));
  fx.push((c) => { const p = P.phoneTan.position, [x, y] = scr(p.x, p.y, p.z); sfx(c, "TAP", x - 85, y - 40, 56, bt - play, { life: 0.7, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  // the doctor's own words play from the phone held up beside his head: the bubble sits above-left of it, clear of the
  // panel, the label and every visor
  if (bt > say - 0.1) fx.push((c) => { const p = P.phoneTan.position, [x, y] = scr(p.x, p.y + 0.1, p.z); bubble(c, b1.say.lines, clamp(x - 10, 830, 1200), 385, x, y, seg(bt, say, say + 0.25), { size: 30 }); });
  return { bloom: 0.5 + 0.5 * (bt >= snap ? 1 - seg(bt, snap, snap + 0.2) : 0) };
}

shot("c10 intro", T0, T0 + INTRO, ({ lt, ov }) => {
  base();
  const bt = lt - INTRO; // negative: the intro runs into beat 1's action
  stage.userData.setCurtain(ease(seg(lt, 0.05, 1.15)));
  const fx = [];
  poseB1(twos(bt), fx);
  const A = { F: [0.05, 1.0, 0.3], yaw: 0.0, pitch: 0.1, dist: 7.0, fov: 30, sx: 0.0, sy: -0.05 };
  camF(...(() => { const o = camLerp(lt, 1.0, INTRO, A, CAM_B1A, (k) => ease(k)); return [o.F, o]; })());
  ov.push((c) => sfx(c, "SWISH!", 960, 250, 96, lt - 0.12, { life: 1.0, burst: false, fill: ["#ffe7f0", "#ff6fa8"] }));
  ov.push((c) => sfx(c, "TA-DA!", 1180, 330, 84, lt - 0.75, { life: 1.1, burst: "#ffd94a" }));
  return { bloom: 0.55 };
});

// ==== B1 · MEDICATION UNDERSTANDING ====
{
  const read = cue(b1, b1.read) ?? 3.9, c2 = b1.segs[2].at;
  beatShots(b1, "b1 meds", [0, read, c2], [
    (bt) => { const o = camLerp(bt, 0, read, CAM_B1A, { ...CAM_B1A, yaw: 0.04, dist: 4.6 }); o.dist *= 1 - 0.05 * punch(bt, cue(b1, b1.snap) ?? 1); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, read, c2, { F: [-0.7, 0.78, 0.15], yaw: 0.18, pitch: 0.12, dist: 4.2, fov: 30, sx: SX1, sy: -0.36 }, { F: [-0.7, 0.78, 0.15], yaw: 0.06, dist: 3.9 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c2, b1.dur, { F: [0.35, 0.78, 0.15], yaw: -0.24, pitch: 0.12, dist: 4.4, fov: 30, sx: 0.36, sy: -0.52 }, { F: [0.35, 0.78, 0.15], yaw: -0.1, dist: 4.05 }); camF(o.F, o); },
  ], poseB1);
}

// ==== B2 · HEALTH TRACKING ====
function poseB2(bt, fx) {
  P.ped.visible = true; P.ped.position.set(0.62, 0, 0.62); P.ped.rotation.set(0, 0, 0);
  place(P.bp, new THREE.Vector3(0.55, 0.65, 0.62), -0.4);
  const keys = b2.keys.map((k) => cue(b2, k) ?? -9), save = cue(b2, b2.save) ?? 5.3, card = cue(b2, b2.card) ?? 5.9, hold = cue(b2, b2.hold) ?? 7.0;
  const say = cue(b2, b2.say.at, b2.say.clip) ?? 7.4, dual = b2.segs[2].at, dayTap = cue(b2, b2.dayTap) ?? 12.8;
  const sayEnd = b2.segs[1].end;
  // Mr Tan: holds the phone out at his right side, glances at the monitor and presses each key with his thumb (a small jab
  // per tap; his short arms cannot cross the beard); the card: worry; he lifts it by his face and says why
  const tapAt = [...keys, save, dayTap];
  const tapK = Math.max(0, ...tapAt.map((k) => (bt > k - 0.12 && bt < k + 0.12 ? 1 - Math.abs(bt - k) / 0.12 : 0)));
  const glance = kf(bt, [[0, 0.55], [0.35, 0.55], [0.6, 0], [2.0, 0], [2.2, 0.5], [2.6, 0.5], [2.8, 0]]);
  const speak = seg(bt, hold - 0.25, hold + 0.1) * (1 - seg(bt, sayEnd - 0.1, sayEnd + 0.3));
  const taichi = bt > say && bt < sayEnd ? Math.max(0, Math.sin((bt - say) * 1.6)) : 0;
  const toWei = seg(bt, dual - 0.4, dual + 0.2);
  const rotY = lerp(0.35, 0.05, Math.max(speak, toWei)) - toWei * 0.3;
  act("tan", { x: 0.0, z: 0.3, rotY, armR: lerp(lerp(1.7, 2.05, speak), 1.85, toWei) - tapK * 0.14, armOutR: lerp(0.3, 0.34, speak),
    armL: 0.15 + taichi * 0.6 * speak, armOutL: 0.1 + taichi * 1.1 * speak,
    headYaw: glance * (1 - speak) * (1 - toWei) - 0.2 * (1 - glance / 0.55) * (1 - speak) * (1 - toWei), headPitch: lerp(0.22, 0.05, speak) + talk(bt, say, sayEnd - 0.4) + (bt > card && bt < card + 0.25 ? -0.12 : 0),
    face: faceAt(bt, [[-9, "code"], [card, "worry"], [hold + 0.2, "code"], [say + 0.6, "happy"], [dual, "code"], [dual + 0.5, "happy"]]),
    squash: bt > card && bt < card + 0.3 ? -0.25 : wob(bt, 0.45) * 0.03, dy: bt > card && bt < card + 0.3 ? 0.06 : 0 }, bt);
  grip(P.phoneTan, tan, 1, rotY + Math.PI, lerp(lerp(-0.55, -0.15, speak), -0.25, toWei));
  P.phoneTan.userData.screen.color.set(bt > card && bt < card + 0.4 ? "#ffd6d6" : "#d9ccff");
  // Wei Ling: worried at the card; then holds up her phone beside him (her calendar)
  act("wei", { x: lerp(-1.0, -0.62, ease(seg(bt, dual - 0.9, dual - 0.1))), z: lerp(0.05, 0.32, ease(seg(bt, dual - 0.9, dual - 0.1))),
    walk: bt > dual - 0.9 && bt < dual - 0.1 ? bt * 10 : 0, rotY: lerp(0.45, 0.2, toWei), armR: toWei * 1.85 - (bt > dayTap - 0.1 && bt < dayTap + 0.1 ? 0.12 : 0), armOutR: 0.1 + toWei * 0.2,
    armL: bt > card + 0.2 && bt < card + 1.4 ? 1.9 : 0.1, armOutL: bt > card + 0.2 && bt < card + 1.4 ? -0.15 : 0.1, headPitch: toWei * 0.25,
    face: faceAt(bt, [[-9, "code"], [card + 0.1, "worry"], [hold, "code"], [say + 1.0, "happy"], [dual, "code"], [dayTap, "wow"]], 1.3) }, bt, 1.3);
  if (toWei > 0) grip(P.phoneWei, wei, 1, wei.g.rotation.y + Math.PI, -0.3, { s: 0.95 });
  // Dr Lim: leans in at the card
  act("lim", { x: 1.2, z: -0.2, rotY: -0.45, lean: bt > card && bt < hold ? 0.15 : 0, headYaw: 0.25,
    face: faceAt(bt, [[-9, "code"], [card + 0.15, "think"], [say + 0.8, "happy"], [dual, "code"]], 2.1), armL: bt > card + 0.2 && bt < hold ? 1.0 : 0.1 }, bt, 2.1);
  // sound effects sit at what makes them: the monitor, the phone, his head, the two phones
  fx.push((c) => { const [x, y] = scr(0.55, 0.95, 0.62); sfx(c, "BEEP", x + 40, y - 40, 60, bt - 0.25, { life: 0.8, burst: false, fill: ["#c8ffd8", "#2fd07a"] }); });
  keys.forEach((k, j) => fx.push((c) => { const p = P.phoneTan.position, [x, y] = scr(p.x, p.y, p.z); sfx(c, "TAP", x - 40 - (j % 2) * 30, y - 125 - (j % 3) * 20, 50, bt - k, { life: 0.5, burst: false, fill: ["#ffffff", "#c9b8ff"] }); }));
  fx.push((c) => { const [x, y] = scr(tan.g.position.x, 1.3, tan.g.position.z); hitFlash(c, bt - card, SINGLE, "#ffd0e4"); sfx(c, "!?", x - 150, Math.max(400, y - 100), 100, bt - card - HIT, { life: 1.2, burst: "#ff6fb0" }); });
  if (bt > say - 0.1 && bt < sayEnd - 0.07) fx.push((c) => { const [x, y] = scr(tan.g.position.x, 1.05, tan.g.position.z); bubble(c, b2.say.lines, 1300, 370, x, y, seg(bt, say, say + 0.25), { size: 30 }); });
  fx.push((c) => { const a = P.phoneTan.position, b = P.phoneWei.position, [x1, y1] = scr(a.x, a.y, a.z), [x2, y2] = scr(b.x, b.y, b.z);
    sfx(c, "DING!", (x1 + x2) / 2 + 60, 420, 70, bt - (dual + 0.35), { life: 0.9, burst: false, fill: ["#fff6a8", "#ffb02e"] }); });
  return { bloom: 0.5 };
}
{
  const c1 = (cue(b2, b2.keys[4]) ?? 3.3) + 0.25, c2 = b2.segs[1].at, c3 = b2.segs[2].at;
  beatShots(b2, "b2 bp", [0, c1, c2, c3], [
    (bt) => { const o = camLerp(bt, 0, c1, { F: [0.3, 0.7, 0.45], yaw: 0.36, pitch: 0.16, dist: 4.1, fov: 30, sx: SX1, sy: -0.34 }, { F: [0.3, 0.7, 0.45], yaw: 0.25, dist: 3.8 }); camF(o.F, o); },
    (bt) => { const card = cue(b2, b2.card) ?? 5.9; const o = camLerp(bt, c1, c2, { F: [0.1, 0.65, 0.2], yaw: 0.1, pitch: 0.13, dist: 5.4, fov: 30, sx: SX1, sy: -0.3 }, { F: [0.1, 0.65, 0.2], yaw: 0.02, dist: 5.1 }); o.dist *= 1 - 0.07 * punch(bt, card, 0.35); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c2, c3, { F: [0.0, 0.82, 0.3], yaw: 0.28, pitch: 0.1, dist: 3.6, fov: 30, sx: SX1, sy: -0.38 }, { F: [0.0, 0.82, 0.3], yaw: 0.14, dist: 3.35 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c3, b2.dur, { F: [-0.3, 0.75, 0.3], yaw: 0.06, pitch: 0.12, dist: 4.3, fov: 30, sx: SX2, sy: -0.36 }, { F: [-0.3, 0.75, 0.3], yaw: -0.02, dist: 4.0 }); camF(o.F, o); },
  ], poseB2);
}

// ==== B3 · HEALTHCARE PREPARATION ====
function poseB3(bt, fx) {
  const noted = cue(b3, b3.noted) ?? 0.9, seeQ = cue(b3, b3.seeQ) ?? 5.2, list = cue(b3, b3.list) ?? 8.4;
  const fly0 = noted + 0.15, fly1 = noted + 1.0;
  const pressQ = kf(bt, [[seeQ - 0.3, 0], [seeQ - 0.06, 1], [seeQ + 0.12, 0]]);
  act("tan", { x: -0.5, z: 0.38, rotY: 0.45, armR: 1.75 - pressQ * 0.12, armOutR: 0.3, armL: 0.15, armOutL: 0.12,
    headPitch: 0.22 + (bt > list && bt < list + 0.8 ? Math.sin((bt - list) * 15) * 0.12 : 0) - (bt > fly0 && bt < fly1 + 0.4 ? 0.2 : 0),
    headYaw: bt > fly0 && bt < fly1 + 0.6 ? 0.45 : -0.15,
    face: faceAt(bt, [[-9, "code"], [noted, "wow"], [fly1 + 0.3, "happy"], [seeQ + 0.5, "code"], [list, "happy"]]),
    squash: bt > fly1 && bt < fly1 + 0.2 ? 0.15 : wob(bt, 0.45) * 0.03 }, bt);
  const hp = grip(P.phoneTan, tan, 1, tan.g.rotation.y + Math.PI, -0.55).clone();
  // Dr Lim holds the NEXT VISIT clipboard by its edge, facing us; he raises it to read after the card lands, then a thumbs-up
  const readUp = seg(bt, 4.5, 5.1);
  const thumbs = seg(bt, 7.4, 7.7) * (1 - seg(bt, 9.2, 9.5));
  act("lim", { x: 0.55, z: 0.1, rotY: lerp(-0.45, -0.15, readUp), armL: lerp(1.45, 1.4, readUp), armOutL: lerp(0.22, 0.12, readUp), armR: thumbs * 2.5, armOutR: 0.1 + thumbs * 0.2,
    headPitch: readUp * 0.28 + (bt > fly1 + 0.1 && bt < fly1 + 0.9 ? Math.sin((bt - fly1) * 14) * 0.1 : 0), headYaw: lerp(0.15, 0.3, readUp),
    face: faceAt(bt, [[-9, "code"], [fly1 + 0.1, "happy"], [readUp > 0 ? 4.8 : 99, "think"], [6.6, "happy"]], 2.1) }, bt, 2.1);
  const cp = grip(P.clip, lim, 0, lerp(lim.g.rotation.y - 0.1, 0.12, readUp), -0.12 - readUp * 0.2, { lift: -0.035, along: 0.0, side: -0.13, s: 1.35 }).clone();
  P.clip.userData.paper.userData.set(bt < fly1 ? 2 : 3);
  // the question card flies from his phone onto the clipboard
  if (bt >= fly0 && bt < fly1) {
    const k = easeOut(seg(bt, fly0, fly1));
    const p = new THREE.Vector3().lerpVectors(hp, cp, k); p.y += Math.sin(k * Math.PI) * 0.55;
    place(P.card, p, k * Math.PI * 2, -0.3, Math.sin(k * 9) * 0.3, lerp(0.5, 1.1, Math.sin(k * Math.PI) * 0.8 + k * 0.2));
  }
  // Wei Ling claps
  // (her fists meet in front of her chest: arms forward and swung right in)
  const clapping = bt > fly1 + 0.1 && bt < fly1 + 1.2, clap = clapping ? Math.abs(Math.cos((bt - fly1 - 0.1) * 11)) : 0;
  act("wei", { x: -1.35, z: -0.1, rotY: 0.35, armL: clapping ? 1.45 : 0.1, armR: clapping ? 1.45 : 0.1, armOutL: clapping ? -0.95 + clap * 0.6 : 0.1, armOutR: clapping ? -0.95 + clap * 0.6 : 0.1,
    face: faceAt(bt, [[-9, "code"], [fly1, "happy"], [fly1 + 2.0, "code"], [list, "happy"]], 1.3), dy: clap * 0.03 }, bt, 1.3);
  fx.push((c) => { const [x, y] = scr(hp.x, hp.y, hp.z); sfx(c, "DING!", x + 20, y - 330, 70, bt - noted, { life: 0.9, burst: false, fill: ["#fff6a8", "#ffb02e"] }); });
  fx.push((c) => { const [x, y] = scr(cp.x, cp.y + 0.2, cp.z); sfx(c, "PLINK!", x + 170, Math.max(380, y - 40), 72, bt - fly1, { life: 1.0, burst: "#bff7ff" }); });
  fx.push((c) => { const [x, y] = scr(hp.x, hp.y, hp.z); sfx(c, "TAP", x - 90, y - 20, 50, bt - seeQ, { life: 0.6, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  return { bloom: 0.5 };
}
{
  const c1 = 4.6, c2 = cue(b3, b3.list) ?? 8.4;
  beatShots(b3, "b3 questions", [0, c1, c2], [
    (bt) => { const o = camLerp(bt, 0, c1, { F: [-0.05, 0.75, 0.25], yaw: 0.06, pitch: 0.14, dist: 4.6, fov: 30, sx: SX1, sy: -0.34 }, { F: [-0.05, 0.75, 0.25], yaw: -0.04, dist: 4.3 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c1, c2, { F: [0.62, 0.9, 0.2], yaw: 0.26, pitch: 0.1, dist: 3.4, fov: 30, sx: SX1, sy: -0.36 }, { F: [0.62, 0.9, 0.2], yaw: 0.14, dist: 3.15 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c2, b3.dur, { F: [-0.85, 0.78, 0.25], yaw: 0.3, pitch: 0.11, dist: 3.9, fov: 30, sx: SX1, sy: -0.36 }, { F: [-0.85, 0.78, 0.25], yaw: 0.2, dist: 3.65 }); camF(o.F, o); },
  ], poseB3);
}

// ==== B4 · THE VISIT, KEPT ====
function poseB4(bt, fx) {
  const at = (src, fb) => cue(b4, src) ?? fb;
  const live = b4.segs[1], agree = at(b4.agree, 0.8), answer = at(b4.answer, live.at + 5.5), fin = at(b4.finished, b4.segs[2].at + 0.1);
  const lim0 = Math.max(live.at, live.at - (live.in - b4.limTalk[0])), lim1 = live.at + (b4.limTalk[1] - live.in);   // his talk, clamped to the live window
  const wei0 = live.at + (b4.weiTalk[0] - live.in), wei1 = live.at + (b4.weiTalk[1] - live.in);
  const yes = at(b4.yes.at, b4.dur - 0.7), endIn = b4.segs[2].at, rev = b4.segs[3].at;
  const tableP = new THREE.Vector3(0.35, 0.645, 0.5);
  P.table.visible = true; P.table.position.set(0.35, 0, 0.5);
  // Mr Tan: shows the consent card to Dr Lim, taps, lays the phone on the table; listens to the answer to his tai chi
  // question (nodding, a hand on his chin), lights up when it lands on the phones; at the end he taps Finished on the
  // table, picks the phone up, reads Ripple's summary and taps Yes
  const show = seg(bt, -1, 0.2) * (1 - seg(bt, agree + 0.25, agree + 0.6));
  const down = seg(bt, agree + 0.3, agree + 0.8) * (1 - seg(bt, fin + 0.3, fin + 0.8));
  const lift = seg(bt, fin + 0.3, fin + 0.8);
  const chin = seg(bt, live.at + 0.2, live.at + 0.6) * (1 - seg(bt, answer - 0.2, answer + 0.1));
  const cheer = seg(bt, answer + 0.05, answer + 0.25) * (1 - seg(bt, answer + 1.3, answer + 1.7));
  const tapFin = kf(bt, [[fin - 0.5, 0], [fin - 0.08, 1], [fin + 0.25, 0]]);
  // the taps on the phone in his own hand (the consent line, Yes) are thumb presses: a small jab of that hand
  const press = Math.max(kf(bt, [[agree - 0.3, 0], [agree - 0.06, 1], [agree + 0.12, 0]]), kf(bt, [[yes - 0.3, 0], [yes - 0.06, 1], [yes + 0.12, 0]]));
  const rotY = lerp(0.55, 0.15, Math.max(lift, cheer * 0.6));
  act("tan", { x: -0.3, z: 0.45, rotY, armR: show * 1.6 + down * 0.15 + lift * 1.85 + tapFin * 1.1 - press * 0.12, armOutR: 0.12 + show * 0.12 + lift * 0.2,
    armL: chin * 1.9 + cheer * 2.7, armOutL: 0.1 + chin * -0.05 + cheer * 0.3, lean: tapFin * 0.25 + down * 0.05,
    headPitch: down * 0.15 * (1 - chin) + lift * 0.18 + tapFin * 0.2 + (bt > lim0 && bt < lim1 ? Math.sin(bt * 4.5) * 0.07 : 0) - cheer * 0.1,
    headYaw: down * 0.2 * (1 - chin) + chin * 0.35,
    face: faceAt(bt, [[-9, "code"], [agree + 0.2, "happy"], [live.at, "think"], [answer, "wow"], [answer + 0.6, "love"], [answer + 2.0, "happy"], [fin, "code"], [rev + 0.4, "think"], [yes, "happy"]]),
    squash: (bt > answer && bt < answer + 0.2) || (bt > yes && bt < yes + 0.2) ? 0.18 : wob(bt, 0.45) * 0.03,
    dy: bt > answer + 0.05 && bt < answer + 0.4 ? Math.sin(seg(bt, answer + 0.05, answer + 0.4) * Math.PI) * 0.12 : 0 }, bt);
  // the phone: shown to Dr Lim (screen toward him), laid flat on the table for the visit, picked up again to review
  const onTable = clamp(down * (1 - lift));
  const handRy = lerp(rotY + 0.1, rotY + Math.PI, lift), handRx = lerp(0, -0.4, lift);
  const hp = grip(P.phoneTan, tan, 1, handRy, handRx).clone();
  const pp = new THREE.Vector3().lerpVectors(hp, tableP, ease(onTable));
  place(P.phoneTan, pp, lerp(handRy, 0.2, onTable), lerp(handRx, -Math.PI / 2, onTable));
  P.phoneTan.userData.screen.color.set(bt > answer && bt < answer + 0.4 ? "#ffffff" : "#d9ccff");
  const rec = bt > agree + 0.2 && bt < fin + 0.05;
  if (rec && Math.floor(bt * 2.5) % 2 === 0) place(P.recDot, pp.clone().add(new THREE.Vector3(0, 0.025 * onTable + 0.11 * (1 - onTable), 0)), 0);
  // Dr Lim: thumbs up to the recording; answers his question with open hands, then a nod when it lands
  const thumbs = seg(bt, agree - 0.5, agree - 0.25) * (1 - seg(bt, agree + 0.6, agree + 0.9));
  const gest = bt > lim0 && bt < lim1 ? 1.0 + Math.sin((bt - lim0) * 5) * 0.25 : bt >= lim1 && bt < lim1 + 0.4 ? 1.0 * (1 - seg(bt, lim1, lim1 + 0.4)) : 0;
  act("lim", { x: 1.0, z: 0.1, rotY: -0.6, armR: thumbs * 2.5 + gest, armOutR: 0.1 + thumbs * 0.15, armL: gest * 0.8, armOutL: 0.1 + gest * 0.2,
    headPitch: (bt > agree - 0.6 && bt < agree + 0.3 ? Math.sin((bt - agree) * 13) * 0.12 : 0) + talk(bt, lim0, lim1) + (bt > answer && bt < answer + 0.8 ? Math.sin((bt - answer) * 13) * 0.1 : 0),
    face: faceAt(bt, [[-9, "code"], [agree - 0.6, "happy"], [live.at, "code"], [answer, "happy"], [endIn, "code"], [rev, "happy"]], 2.1) }, bt, 2.1);
  // Wei Ling: follows on her phone; WOW when the answer lands on hers too; then she speaks to the doctor
  act("wei", { x: -1.05, z: 0.1, rotY: lerp(lerp(0.25, 0.55, seg(bt, wei0, wei0 + 0.4)), 0.6, seg(bt, endIn, endIn + 0.5)), armR: 1.35, armOutR: 0.1,
    armL: bt > wei0 + 0.2 && bt < wei1 ? 0.9 + Math.sin((bt - wei0) * 4) * 0.2 : 0.1, headPitch: lerp(0.32, 0.05, seg(bt, wei0, wei0 + 0.3)) + talk(bt, wei0, wei1),
    face: faceAt(bt, [[-9, "code"], [answer + 0.1, "wow"], [answer + 1.0, "happy"], [endIn, "code"], [yes, "happy"]], 1.3),
    dy: bt > answer + 0.1 && bt < answer + 0.45 ? Math.sin((bt - answer - 0.1) * 9) * 0.07 : 0 }, bt, 1.3);
  grip(P.phoneWei, wei, 1, wei.g.rotation.y + Math.PI, -0.4, { s: 0.95 });
  P.phoneWei.userData.screen.color.set(bt > answer && bt < answer + 0.4 ? "#ffffff" : "#bfeee0");
  // sound effects at what makes them: his phone (in his hand or on the table); the DING between the two of them
  const ph = P.phoneTan.position.clone();
  fx.push((c) => { const [x, y] = scr(ph.x, ph.y, ph.z); sfx(c, "TAP", x - 80, y - 60, 52, bt - agree, { life: 0.6, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  fx.push((c) => { const [x, y] = scr(tableP.x, tableP.y, tableP.z); sfx(c, "REC", x + 30, y - 130, 70, bt - (agree + 0.25), { life: 1.1, burst: "#ff5a6e", fill: ["#ffffff", "#ffd0d6"] }); });
  fx.push((c) => sfx(c, "DING!", 1560, 405, 76, bt - answer, { life: 1.1, burst: "#7fe0ff" }));
  fx.push((c) => { const [x, y] = scr(tableP.x, tableP.y, tableP.z); sfx(c, "TAP", x - 70, y - 90, 52, bt - fin, { life: 0.6, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  fx.push((c) => { const [x, y] = scr(ph.x, ph.y, ph.z); sfx(c, "TAP!", x - 90, y - 50, 66, bt - yes, { life: 0.8, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  return { bloom: 0.5 };
}
function layerB4(b, bt, ov, wait) {
  const { geo } = beatLayer(b, bt, ov, wait);
  const yes = cue(b4, b4.yes.at);
  if (yes != null) ov.push((c) => {
    const x = geo.x - geo.w / 2 + b4.yes.x * geo.w, y = geo.y - geo.h / 2 + b4.yes.y * geo.h;
    ring(c, x, y, 120, bt - yes, { life: 0.9 }); ring(c, x, y, 120, bt - yes - 0.18, { life: 0.9, col: "#ffffff" });
  });
}
{
  const c1 = b4.segs[1].at, c2 = c1 + 4.0, c3 = b4.segs[2].at;
  beatShots(b4, "b4 visit", [0, c1, c2, c3], [
    (bt) => { const o = camLerp(bt, 0, c1, { F: [0.4, 0.75, 0.35], yaw: 0.1, pitch: 0.13, dist: 4.4, fov: 30, sx: SX1, sy: -0.34 }, { F: [0.4, 0.75, 0.35], yaw: 0.02, dist: 4.15 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c1, c2, { F: [0.32, 0.68, 0.35], yaw: 0.0, pitch: 0.15, dist: 4.8, fov: 30, sx: SX2, sy: -0.32 }, { F: [0.32, 0.68, 0.35], yaw: -0.08, dist: 4.55 }); camF(o.F, o); },
    (bt) => { const ans = cue(b4, b4.answer) ?? c2 + 1.5; const o = camLerp(bt, c2, c3, { F: [-0.62, 0.74, 0.25], yaw: 0.36, pitch: 0.1, dist: 3.3, fov: 30, sx: SX2, sy: -0.38 }, { F: [-0.62, 0.74, 0.25], yaw: 0.26, dist: 3.05 }); o.dist *= 1 - 0.07 * punch(bt, ans, 0.35); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c3, b4.dur, { F: [-0.15, 0.78, 0.45], yaw: 0.2, pitch: 0.12, dist: 3.8, fov: 30, sx: SX1, sy: -0.36 }, { F: [-0.15, 0.78, 0.45], yaw: 0.1, dist: 3.55 }); camF(o.F, o); },
  ], poseB4, layerB4);
}

// ==== B5 · FAMILY, ON HIS TERMS ====
function poseB5(bt, fx) {
  const flip = 0.45, banner = cue(b5, b5.banner) ?? 0.7, watch = cue(b5, b5.watch) ?? 2.9, cap = cue(b5, b5.caption) ?? 6.6;
  const s2 = b5.segs[1].at, swipe = cue(b5, b5.swipe, b5.segs[1].clip) ?? 11.4;
  P.sw.visible = true; P.sw.position.set(0.1, 0, 0.72); P.sw.rotation.set(0, 0.2, 0);
  P.sw.userData.lever.rotation.z = kf(bt, [[0.15, 0.7], [flip, -0.78], [flip + 0.12, -0.66]], easeOut);
  P.sw.userData.lamp.color.set(bt > flip ? "#2ff0b0" : "#3a4a44");
  P.sw.userData.setOn(bt > flip);
  // Mr Tan flips the switch on; later he waves back at her
  const wave = bt > swipe + 0.4;
  const back = ease(seg(bt, 1.3, 2.3));
  act("tan", { x: lerp(0.6, 0.95, back), z: lerp(0.52, 0.3, back), walk: bt > 1.3 && bt < 2.3 ? bt * 8 : 0,
    rotY: wave ? lerp(-0.55, -0.3, seg(bt, swipe + 0.2, swipe + 0.6)) : lerp(-0.7, -0.55, back), armR: kf(bt, [[-0.2, 0.4], [0.2, 1.85], [flip, 1.45], [flip + 0.5, 1.45], [1.1, 0.25]]),
    armOutR: 0.12, lean: kf(bt, [[0.1, 0], [flip, 0.18], [1.0, 0]]), wave: wave ? bt * 1.3 : null,
    face: faceAt(bt, [[-9, "code"], [flip + 0.05, "happy"], [2.5, "code"], [swipe + 0.4, "happy"]]),
    squash: bt > flip && bt < flip + 0.15 ? 0.2 : wob(bt, 0.45) * 0.03 }, bt);
  // Wei Ling: her phone buzzes (BZZT), she taps Watch live, she reads; at "Dad noted" she turns and gives a thumbs-up
  const turn = seg(bt, swipe + 0.1, swipe + 0.5);
  // Watch live is a thumb press on the phone in her hand (a small jab of that hand)
  const press = kf(bt, [[watch - 0.3, 0], [watch - 0.06, 1], [watch + 0.12, 0]]);
  act("wei", { x: -0.9, z: 0.25, rotY: lerp(0.3, 0.85, turn), armR: lerp(1.75, 1.6, turn) - press * 0.12, armOutR: 0.28, armL: 0.1 + turn * 2.4, armOutL: 0.1 + turn * 0.15,
    headPitch: lerp(0.32, 0.0, turn) - (bt > cap && bt < cap + 0.4 ? 0.12 : 0), headYaw: turn * 0.25,
    lean: bt > cap && bt < cap + 1.6 ? 0.15 : 0, dy: bt > banner && bt < banner + 0.3 ? Math.sin((bt - banner) * 10) * 0.06 : 0,
    face: faceAt(bt, [[-9, "code"], [banner, "wow"], [watch + 0.2, "happy"], [cap, "wow"], [cap + 1.4, "love"], [s2, "think"], [swipe, "happy"]], 1.3) }, bt, 1.3);
  grip(P.phoneWei, wei, 1, wei.g.rotation.y + Math.PI, -0.4, { s: 0.95 });
  P.phoneWei.userData.screen.color.set(bt > banner && bt < banner + 0.35 ? "#ffffff" : bt > banner ? "#bfeee0" : "#3a3550");
  // Dr Lim in the back, nodding
  act("lim", { x: 1.35, z: -0.45, rotY: -0.5, headYaw: 0.2, headPitch: bt > flip + 0.3 && bt < flip + 1.2 ? Math.sin((bt - flip) * 12) * 0.1 : 0,
    face: faceAt(bt, [[-9, "code"], [flip + 0.2, "happy"], [3, "code"], [swipe + 0.5, "happy"]], 2.1) }, bt, 2.1);
  fx.push((c) => { hitFlash(c, bt - flip, SINGLE, "#d8fff0"); sfx(c, "CLACK!", 1250, 400, 84, bt - flip - HIT, { life: 0.9, burst: "#2ff0b0" }); });
  fx.push((c) => { const p = P.phoneWei.position; const [x, y] = scr(p.x, p.y, p.z); sfx(c, "BZZT", Math.max(x - 40, 820), Math.max(360, y - 110), 66, bt - banner, { life: 0.9, burst: false, fill: ["#e9dcff", "#9b6bff"] }); });
  fx.push((c) => { const p = P.phoneWei.position, [x, y] = scr(p.x, p.y, p.z); sfx(c, "TAP", x + 80, y - 60, 50, bt - watch, { life: 0.6, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  return { bloom: 0.5 };
}
{
  const c1 = 3.3, c2 = b5.segs[1].at;
  beatShots(b5, "b5 family", [0, c1, c2], [
    (bt) => { const o = camLerp(bt, 0, c1, { F: [-0.2, 0.7, 0.45], yaw: 0.12, pitch: 0.14, dist: 4.5, fov: 30, sx: SX1, sy: -0.32 }, { F: [-0.2, 0.7, 0.45], yaw: 0.03, dist: 4.2 }); o.dist *= 1 - 0.05 * punch(bt, 0.45, 0.3); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c1, c2, { F: [-0.88, 0.76, 0.25], yaw: 0.36, pitch: 0.1, dist: 3.4, fov: 30, sx: SX1, sy: -0.38 }, { F: [-0.88, 0.76, 0.25], yaw: 0.26, dist: 3.15 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c2, b5.dur, { F: [0.02, 0.72, 0.35], yaw: -0.06, pitch: 0.13, dist: 4.9, fov: 30, sx: SX1, sy: -0.32 }, { F: [0.02, 0.72, 0.35], yaw: 0.02, dist: 4.6 }); camF(o.F, o); },
  ], poseB5);
}

// ==== B6 · MEDICATION MANAGEMENT AND PREVENTION (no footage: the TAKEN button and the checklist card) ====
const B6T = { slam: 1.6, cheer: 1.9, c1: 4.9, rows: [5.4, 6.1, 6.8], add: 8.3, c2: 9.6 };
const LINE = { wei: [-0.95, 0.7], tan: [0.3, 0.72], lim: [1.15, 0.68] }; // the line-up for the cheer and the bow
/** the B6 props; t = beat time (later times leave them in their final state) */
function propsB6(bt) {
  const { slam, rows, add } = B6T;
  P.taken.visible = true; P.taken.position.set(-0.3, 0, 0.3); P.taken.rotation.set(0, 0.15, 0);
  const press = bt > slam - 0.02 && bt < slam + 0.35 ? 1 - seg(bt, slam + 0.1, slam + 0.35) : 0;
  P.taken.userData.dome.position.y = 0.6 - 0.07 * press; P.taken.userData.dome.scale.set(1 + 0.08 * press, 0.6 - 0.2 * press, 1 + 0.08 * press);
  P.week.visible = true; P.week.position.set(-0.75, 0, -0.65); P.week.rotation.set(0, 0.12, 0);
  P.week.userData.face.userData.set(bt < slam + 0.15 ? 3 : 4);
  P.week.scale.setScalar(1.2 * (bt > slam + 0.15 && bt < slam + 0.5 ? 1 + 0.06 * Math.sin(seg(bt, slam + 0.15, slam + 0.5) * Math.PI) : 1));
  P.easel.visible = true; P.easel.position.set(1.55, 0, -0.45); P.easel.rotation.set(0, -0.1, 0);
  P.easel.userData.face.userData.set(bt < rows[0] ? 0 : bt < rows[1] ? 1 : bt < rows[2] ? 2 : bt < add ? 3 : 4);
  return press;
}
/** Mr Tan's spot at the checklist card: with his left arm raised sideways by `out` (found so the hand tip is at the
 *  button's height) and forward by TAPARM.fwd, the hand tip lands on the left end of "Add to my questions" (just in
 *  front of the card).
 *  A pure function of the props' fixed placement (propsB6 sets them before this is called). */
const TAPARM = { fwd: 0.2, rotY: 0.3 };
function easelSpot() {
  P.easel.updateMatrixWorld(true);
  const btn = P.easel.localToWorld(new THREE.Vector3(-0.44, 0.83, 0.092 + 0.03));  // the button's left end: he stands beside the card, not in front of it
  const x0 = 0.62, z0 = -0.1, tip = (out) => { STAGE.pose("tan", { x: x0, z: z0, rotY: TAPARM.rotY, armL: TAPARM.fwd, armOutL: out }); return handPos(tan, 0); };
  let lo = 1.6, hi = 3.0;
  for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (tip(m).y < btn.y) lo = m; else hi = m; }
  const out = (lo + hi) / 2, t = tip(out);
  return { x: x0 + btn.x - t.x, z: z0 + btn.z - t.z, out };
}
function poseB6(bt, fx) {
  const { slam, cheer, rows, add, c2 } = B6T;
  const press = propsB6(bt);
  const line = ease(seg(bt, c2, c2 + 0.7));
  // Mr Tan: winds up and slams TAKEN; walks to the checklist card and taps "Add to my questions"; joins the line, cheers
  const toEasel = ease(seg(bt, 3.9, 5.0));
  const spot = easelSpot();  // where he stands so his raised left hand lands on the button
  const tx = lerp(lerp(0.25, spot.x, toEasel), LINE.tan[0], line), tz = lerp(lerp(0.42, spot.z, toEasel), LINE.tan[1], line);
  const reach = kf(bt, [[add - 0.55, 0], [add - 0.1, 1], [add + 0.35, 1], [add + 0.7, 0]]);
  act("tan", { x: tx, z: tz, rotY: lerp(lerp(-0.8, 0.3, seg(bt, 3.9, 4.5)), 0, line), walk: (bt > 3.9 && bt < 5.0) || (bt > c2 && bt < c2 + 0.7) ? bt * 9 : 0,
    armR: kf(bt, [[0.3, 0.3], [1.0, 2.7], [slam - 0.12, 2.9], [slam, 1.25], [slam + 0.6, 1.2], [2.6, 0.3], [c2 + 0.7, 0.3], [c2 + 1.0, 2.7]]),
    armL: bt > c2 + 0.7 ? kf(bt, [[c2 + 0.7, 0.2], [c2 + 1.0, 2.7]]) : 0.1 + reach * (TAPARM.fwd - 0.1), armOutL: 0.1 + reach * (spot.out - 0.1),
    lean: kf(bt, [[1.0, -0.1], [slam - 0.1, -0.12], [slam, 0.3], [slam + 0.5, 0.25], [2.4, 0]]), headPitch: bt < 3 ? 0.25 : 0.05, headYaw: reach * 0.5,
    squash: bt > slam && bt < slam + 0.2 ? 0.3 : bt > slam - 0.4 && bt < slam ? -0.15 : wob(bt, 0.45) * 0.03,
    dy: bt > c2 + 1.0 ? Math.abs(Math.sin((bt - c2 - 1.0) * 6)) * 0.14 : 0,
    face: faceAt(bt, [[-9, "code"], [0.9, "think"], [slam, "happy"], [3.2, "code"], [rows[0], "think"], [add, "happy"], [c2 + 0.9, "love"]]) }, bt);
  // Wei Ling cheers when he logs it; Dr Lim points at the checklist card
  const cheering = (bt > cheer && bt < 3.3) || bt > c2 + 0.9;
  act("wei", { x: lerp(-1.5, LINE.wei[0], line), z: lerp(0.35, LINE.wei[1], line), rotY: lerp(0.45, 0.1, line), walk: bt > c2 && bt < c2 + 0.7 ? bt * 9 : 0,
    armL: cheering ? 2.8 : 0.1, armR: cheering ? 2.8 : 0.1, armOutL: 0.25, armOutR: 0.25, dy: cheering ? Math.abs(Math.sin((bt - cheer) * 7)) * 0.16 : 0,
    face: faceAt(bt, [[-9, "code"], [cheer, "happy"], [3.4, "code"], [add + 0.2, "happy"], [c2 + 0.8, "love"]], 1.3) }, bt, 1.3);
  const point = seg(bt, rows[0] - 0.4, rows[0]) * (1 - seg(bt, add + 0.4, add + 0.8));
  act("lim", { x: lerp(2.45, LINE.lim[0], line), z: lerp(-0.2, LINE.lim[1], line), rotY: lerp(-0.85, -0.1, line), walk: bt > c2 && bt < c2 + 0.7 ? bt * 9 : 0,
    armR: point * 1.55, armOutR: 0.1 + point * 0.2, headYaw: point * 0.35, armL: bt > cheer && bt < 3.0 ? 1.2 : 0.1, wave: bt > c2 + 0.9 ? bt * 1.4 : null,
    face: faceAt(bt, [[-9, "code"], [cheer, "happy"], [3.4, "code"], [add, "happy"], [c2 + 0.8, "happy"]], 2.1) }, bt, 2.1);
  fx.push((c) => { hitFlash(c, bt - slam, null, "#d8fff0"); sfx(c, "DING!", 1300, 380, 110, bt - slam - HIT, { life: 1.1, burst: "#2ff0b0" }); });
  fx.push((c) => sfx(c, "YAY!", 820, 470, 80, bt - cheer, { life: 1.0, burst: false, fill: ["#fff6a8", "#ff8fb0"] }));
  const tip = handPos(tan, 0);
  fx.push((c) => { const [x, y] = scr(tip.x, tip.y, tip.z); sfx(c, "TAP", x + 20, y + 80, 56, bt - add, { life: 0.7, burst: false, fill: ["#ffffff", "#c9b8ff"] }); });
  fx.push((c) => { P.easel.updateMatrixWorld(true); const p = P.easel.localToWorld(new THREE.Vector3(0, 1.66, 0.1)), [x, y] = scr(p.x, p.y, p.z);
    sfx(c, "DING!", x + 150, Math.max(330, y - 20), 64, bt - (add + 0.1), { life: 0.8, burst: false, fill: ["#fff6a8", "#ffb02e"] }); });
  fx.push((c) => sfx(c, "HOORAY!", 1340, 360, 96, bt - (c2 + 1.0), { life: 1.6, burst: "#ffd94a" }));
  return { bloom: 0.55 + 0.4 * press };
}
function layerB6(b, bt, ov, wait) {
  // beat 5's last frame slides out to the left, then only the label
  const g = b5.segs[b5.segs.length - 1];
  if (bt < 0.4) { let img; wait(frame(g.clip, g.out).then((x) => (img = x))); const k = easeOut(seg(bt, 0, 0.4)); ov.push((c) => drawPanel(c, img, { ...SINGLE, x: SINGLE.x - k * 700 })); }
  const lk = Math.min(seg(bt, 0.1, 0.5), 1 - seg(bt, B6.dur - 0.25, B6.dur));
  ov.push((c) => label(c, "b6", 110, lk, 980));
}
{
  const { slam, c1, c2 } = B6T;
  beatShots(B6, "b6 taken", [0, c1, c2], [
    (bt) => { const o = camLerp(bt, 0, c1, { F: [-0.3, 0.7, 0.4], yaw: -0.1, pitch: 0.15, dist: 4.2, fov: 30, sx: 0.15, sy: -0.3 }, { F: [-0.3, 0.7, 0.4], yaw: 0.02, dist: 3.9 }); o.dist *= 1 - 0.08 * punch(bt, slam, 0.3); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c1, c2, { F: [1.5, 1.0, -0.35], yaw: 0.24, pitch: 0.07, dist: 3.9, fov: 30, sx: 0.06, sy: -0.24 }, { F: [1.5, 1.0, -0.35], yaw: 0.14, dist: 3.6 }); camF(o.F, o); },
    (bt) => { const o = camLerp(bt, c2, B6.dur, { F: [0.1, 0.7, 0.6], yaw: 0.06, pitch: 0.12, dist: 5.0, fov: 30, sx: 0.08, sy: -0.3 }, { F: [0.1, 0.7, 0.6], yaw: -0.02, dist: 5.4 }); camF(o.F, o); },
  ], poseB6, layerB6);
}

// ==== outro: the bow, applause, the curtain closes (hand-off to c11) ====
shot("c10 outro", T1 - OUTRO, T1, ({ lt, ov }) => {
  base();
  propsB6(99);
  // the curtain closes, the halves meet with a small bounce (FWUMP), then the camera pushes into the cloth (into c11)
  const meet = 3.45, close = lt < meet ? ease(seg(lt, 1.7, meet)) : 1 + 0.03 * Math.sin(seg(lt, meet, meet + 0.3) * Math.PI);
  stage.userData.setCurtain(1 - close);
  const at = twos(lt), bow = Math.sin(clamp(seg(at, 0.3, 1.4)) * Math.PI), waveOn = at > 1.5;
  // the first frames carry on B6's last pose (arms up, hopping, Dr Lim waving), so the cut at 318 does not pop; the
  // arms come down into the bow
  const down = ease(seg(at, 0, 0.3)), bt6 = B6.dur + at, hop = (k) => (1 - down) * Math.abs(Math.sin(k)) ;
  const limWave = 0.1 + (2.3 + wob(bt6 * 1.4, 1.6) * 0.35) * (1 - down);  // his B6 wave, unrolled so it can ease down
  act("tan", { x: LINE.tan[0], z: LINE.tan[1], lean: bow * 0.55, wave: waveOn ? at * 1.4 : null, armR: waveOn ? 0 : 2.7 * (1 - down), armL: 2.7 * (1 - down) + 0.1 * down,
    dy: hop((bt6 - B6T.c2 - 1.0) * 6) * 0.14, face: faceAt(at, [[-9, "love"], [0.3, "happy"], [1.5, "love"]]) }, at);
  act("wei", { x: LINE.wei[0], z: LINE.wei[1], rotY: 0.1, lean: bow * 0.55, wave: waveOn ? at * 1.5 + 1 : null, armR: waveOn ? 0 : lerp(2.8, 0.1, down), armL: lerp(2.8, 0.1, down),
    armOutL: lerp(0.25, 0.1, down), armOutR: waveOn ? 0.1 : lerp(0.25, 0.1, down), dy: hop((bt6 - B6T.cheer) * 7) * 0.16, face: faceAt(at, [[-9, "love"], [0.3, "happy"]], 1.3) }, at, 1.3);
  act("lim", { x: LINE.lim[0], z: LINE.lim[1], rotY: -0.1, lean: bow * 0.5, wave: waveOn ? at * 1.3 + 2 : null, armOutR: waveOn ? 0.1 : limWave, face: faceAt(at, [[-9, "happy"]], 2.1) }, at, 2.1);
  const o = camLerp(lt, 0, meet, { F: [0.1, 0.7, 0.6], yaw: -0.02, pitch: 0.12, dist: 5.4, fov: 30, sx: 0.08, sy: -0.3 }, { F: [0.0, 1.1, 0.8], yaw: 0, pitch: 0.08, dist: 7.0, sx: 0, sy: -0.12 });
  o.dist *= 1 - 0.14 * easeIn(seg(lt, meet, OUTRO));
  camF(o.F, o);
  ov.push((c) => sfx(c, "CLAP CLAP!", 520, 820, 80, at - 0.35, { life: 1.4, burst: false, fill: ["#fff6a8", "#ffb02e"] }));
  ov.push((c) => sfx(c, "CLAP!", 1450, 860, 70, at - 0.7, { life: 1.1, burst: false, fill: ["#fff6a8", "#ffb02e"] }));
  ov.push((c) => sfx(c, "SWISH!", 960, 300, 96, at - 1.75, { life: 1.1, burst: false, fill: ["#ffe7f0", "#ff6fa8"] }));
  ov.push((c) => sfx(c, "FWUMP!", 960, 600, 84, at - meet, { life: 0.4, burst: false, fill: ["#ffe7f0", "#ff6fa8"] }));
  return { bloom: 0.55 };
});
