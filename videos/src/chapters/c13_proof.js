// Chapter 13 · Proof, how we built it, next (film 400–430 s). A long corkboard on the lab wall in three regions. The
// trio pin three measured results with their exact scope lines and say plainly what is not done yet; then a slot for
// the owner's build notes and screenshots; then the three "next" items, one sticky note each.
// Facts: D:/ripple-c2/film/research/second-half-facts.md 5.1 (scope lines) and 6.4/6.7 (no "tested with users", no
// "clinically validated", nothing claimed about how CodeBuddy was used until the owner's screenshots exist).
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, pop, ease, easeOut, easeIn, clamp, lerp, backOut, hash, twos } from "../core.js";
import { sfx, flashHit, INK } from "../overlay.js";
import { caption } from "../overlay2.js";
import { image } from "../media.js";
import { buildCorkRoom, BOARD_Z, REGION } from "../sets/c13_board.js";
import { toScreen, pxPerM, pushPin, SANS, BANG } from "../sets/c12_pins.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";

// ============================== the words and the pinned things (edit here) ==============================
// Positions are metres on the corkboard: at = [x, y] (x along the wall, y up from the floor). Times are film seconds.
const STATS = [ // facts 5.1, exact scope lines from STORYBOARD-2 c13
  { big: "51 of 51", label: "on a frozen set of 51 questions", scope: "live model, 10 Oct; our own questions", at: [-6.4, 2.3], rot: -0.03, t: 400.35 },
  { big: "15 of 15", label: "safety checks", scope: "live model and speech, 15 Oct", at: [-4.0, 2.32], rot: 0.02, t: 402.45 },
  { big: "23 of 23", label: "lines with the right speaker in the final record", scope: "one scripted visit, synthetic voices", at: [-1.6, 2.3], rot: -0.015, t: 404.55 },
];
const HONEST = { text: "Not yet: a user study and a clinician review. That is next.", t: 407.5 };
// BUILD NOTES: the owner's CodeBuddy / WorkBuddy reflection goes here. Put two or three short lines in `lines` (and
// change the title), and the screenshot files in `shots[i].src` (e.g. "assets/build/1.png", any size; drawn to fit).
// While `lines` is empty the card shows ruled blank lines; while a src is null an empty frame with its label is drawn.
const BUILD = {
  title: "BUILD NOTES (to fill)",
  lines: [],
  card: { at: [1.6, 2.05], w: 1.75, h: 1.15, rot: -0.02, t: 413.4 },
  shots: [
    { src: null, label: "screenshot 1 · to fill", at: [3.5, 2.47], w: 1.08, h: 0.68, rot: 0.03, t: 414.0 },
    { src: null, label: "screenshot 2 · to fill", at: [4.72, 2.44], w: 1.08, h: 0.68, rot: -0.025, t: 414.3 },
    { src: null, label: "screenshot 3 · to fill", at: [3.55, 1.68], w: 1.08, h: 0.68, rot: -0.035, t: 414.6 },
  ],
};
const NEXT = [ // STORYBOARD-2 c13 "Next"; each is pinned by one of the trio
  { text: "A pharmacist and clinician review", at: [6.85, 2.33], col: "#ffe66d", rot: -0.04, t: 422.85, by: "lim" },
  { text: "Tencent ASR vs MERaLiON on drug names", at: [8.0, 2.4], col: "#9ff0ff", rot: 0.03, t: 425.4, by: "tan" },
  { text: "A caregiver role", at: [9.15, 2.33], col: "#ffb3d9", rot: -0.025, t: 427.9, by: "wei" },
];
// ==========================================================================================================

const room = STAGE.set("c13.room", buildCorkRoom());
STAGE.need("tan", makeTanBot); STAGE.need("wei", makeWeiBot); STAGE.need("lim", makeLimBot);
const carry = room.userData.carry;
const REF = 232; // pixels per metre at which a stat card is drawn at its own size (the MEASURED camera)
const NOTE = 1.12; // sticky note size, metres
const TOSS = 0.25; // seconds a carried note flies from the hand to its spot on the board
const hv = new THREE.Vector3();

// ---- helpers ----
function stage(t) {
  STAGE.show("c13.room");
  STAGE.lights("lab", { keyPos: [2.5, 6.5, 5.0], keyTarget: [0, 1.0, -1.2], key: "#ffe2c0", keyI: 2.0, hemi: 1.1, bg: "#2a1a66" });
  carry.visible = false; carry.scale.set(1, 1, 1);
  room.userData.bulbs.forEach((b, i) => b.material.color.set(Math.floor(t * 3 + i) % 4 === 0 ? "#ffffff" : i % 3 === 0 ? "#ffe9a8" : i % 3 === 1 ? "#ff9fd2" : "#9ff0ff"));
}
const B = (at) => [at[0], at[1], BOARD_Z];
/** a pinned thing: slaps on at time t0 (scale 1.3 -> 1, a little turn), then sits; draw(c, s) paints it centred at 0,0
 *  where s = pixels per metre */
function pinned(c, t, t0, at, rot, draw) {
  if (t < t0) return;
  const p = toScreen(B(at)); if (!p.ok) return;
  const s = pxPerM(B(at)), k = seg(t, t0, t0 + 0.16);
  if (p.x < -600 || p.x > 2520) return;
  c.save(); c.translate(p.x, p.y); c.rotate(rot + (1 - k) * 0.12); const sc = lerp(1.3, 1, easeOut(k)); c.scale(sc, sc); c.globalAlpha = clamp(k * 3);
  draw(c, s);
  c.restore();
}
function wrapText(c, text, maxW) {
  const words = text.split(" "), out = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}
/** The stat card, drawn here rather than with overlay2's statCard so the scope line can be big enough to read at 720p
 *  (27 px bold at REF scale, about 29 px on screen at 1080p; statCard draws it at 19 px). Same paper, ink and number. */
const CARD_W = 520, CARD_H = 356;
function drawStat(c, s, S) {
  const f = s / REF; c.scale(f, f);
  const w = CARD_W, h = CARD_H;
  c.fillStyle = INK; c.fillRect(-w / 2 + 10, -h / 2 + 12, w, h);
  c.fillStyle = "#fff6e4"; c.fillRect(-w / 2, -h / 2, w, h); c.lineWidth = 5; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `100px ${BANG}`; c.lineWidth = 10; c.strokeStyle = INK; c.lineJoin = "round"; c.strokeText(S.big, 0, -h / 2 + 80);
  const g = c.createLinearGradient(0, -h / 2 + 30, 0, -h / 2 + 120); g.addColorStop(0, "#ffe37a"); g.addColorStop(1, "#ff8a1f"); c.fillStyle = g; c.fillText(S.big, 0, -h / 2 + 80);
  c.fillStyle = INK; c.font = `800 30px ${SANS}`;
  const ll = wrapText(c, S.label, w - 50);
  ll.forEach((l, i) => c.fillText(l, 0, -h / 2 + 168 + i * 36));
  // the scope: a thin rule, then the line in bold, anchored to the card's bottom
  c.font = `700 27px ${SANS}`;
  const sl = wrapText(c, S.scope, w - 44), y0 = h / 2 - 28 - (sl.length - 1) * 33;
  c.strokeStyle = "rgba(74,63,102,.35)"; c.lineWidth = 2; c.beginPath(); c.moveTo(-w / 2 + 40, y0 - 32); c.lineTo(w / 2 - 40, y0 - 32); c.stroke();
  c.fillStyle = "#3a2f5c"; sl.forEach((l, i) => c.fillText(l, 0, y0 + i * 33));
  pushPin(c, 0, -h / 2 + 4, 15);
}
function drawNote(c, s, N) {
  const w = NOTE * s, h = NOTE * s;
  c.fillStyle = "rgba(26,16,48,.35)"; c.fillRect(-w / 2 + 10, -h / 2 + 12, w, h);
  c.fillStyle = N.col; c.fillRect(-w / 2, -h / 2, w, h);
  c.fillStyle = "rgba(0,0,0,.06)"; c.fillRect(-w / 2, -h / 2, w, h * 0.16);
  c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  const fs = Math.round(w * 0.105);
  c.font = `800 ${fs}px ${SANS}`; c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle";
  const lines = wrapText(c, N.text, w * 0.82);
  lines.forEach((l, i) => c.fillText(l, 0, (i - (lines.length - 1) / 2) * fs * 1.22 + h * 0.05));
  pushPin(c, 0, -h / 2 + 18, Math.max(10, w * 0.045));
}
function drawBuildCard(c, s) {
  const C = BUILD.card, w = C.w * s, h = C.h * s;
  c.fillStyle = "rgba(26,16,48,.35)"; c.fillRect(-w / 2 + 10, -h / 2 + 12, w, h);
  c.fillStyle = "#fff6e4"; c.fillRect(-w / 2, -h / 2, w, h); c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  c.fillStyle = "#ffd94a"; c.fillRect(-w / 2, -h / 2, w, h * 0.22); c.strokeRect(-w / 2, -h / 2, w, h * 0.22);
  const ts = Math.round(h * 0.12);
  c.font = `800 ${ts}px ${SANS}`; c.fillStyle = INK; c.textAlign = "left"; c.textBaseline = "middle";
  c.fillText(BUILD.title, -w / 2 + w * 0.05, -h / 2 + h * 0.11);
  const ls = Math.round(h * 0.085);
  if (BUILD.lines.length) {
    c.font = `600 ${ls}px ${SANS}`; let y = -h / 2 + h * 0.34;
    for (const L of BUILD.lines) for (const l of wrapText(c, L, w * 0.88)) { c.fillText(l, -w / 2 + w * 0.06, y); y += ls * 1.35; }
  } else {
    // the blank: three ruled writing lines with a bullet each and a short last line, like a form waiting to be filled
    c.strokeStyle = "rgba(74,63,102,.5)"; c.lineWidth = Math.max(2, h * 0.008); c.setLineDash([h * 0.03, h * 0.025]);
    for (let i = 0; i < 3; i++) {
      const y = -h / 2 + h * (0.42 + i * 0.17), x0 = -w / 2 + w * 0.1, x1 = w / 2 - w * (0.06 + (i === 2 ? 0.32 : 0));
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
      c.fillStyle = "rgba(74,63,102,.55)"; c.beginPath(); c.arc(-w / 2 + w * 0.06, y - h * 0.02, h * 0.018, 0, 7); c.fill();
    }
    c.setLineDash([]);
  }
  pushPin(c, -w * 0.46, -h / 2 + 8, 13); pushPin(c, w * 0.46, -h / 2 + 8, 13);
}
function drawShot(c, s, S, img) {
  const w = S.w * s, h = S.h * s, b = Math.max(6, w * 0.035);
  c.fillStyle = "rgba(26,16,48,.35)"; c.fillRect(-w / 2 + 9, -h / 2 + 11, w, h);
  c.fillStyle = "#ffffff"; c.fillRect(-w / 2, -h / 2, w, h); c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  const iw = w - b * 2, ih = h - b * 2;
  if (img) {
    const k = Math.min(iw / img.naturalWidth, ih / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    c.fillStyle = "#1d1630"; c.fillRect(-iw / 2, -ih / 2, iw, ih); c.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } else {
    c.fillStyle = "#ece6fb"; c.fillRect(-iw / 2, -ih / 2, iw, ih);
    c.strokeStyle = "rgba(74,63,102,.55)"; c.lineWidth = 3; c.setLineDash([9, 8]); c.strokeRect(-iw / 2 + 6, -ih / 2 + 6, iw - 12, ih - 12); c.setLineDash([]);
    // a little picture glyph
    c.fillStyle = "rgba(74,63,102,.4)"; c.beginPath(); c.moveTo(-iw * 0.18, ih * 0.08); c.lineTo(-iw * 0.05, -ih * 0.12); c.lineTo(iw * 0.06, ih * 0.02); c.lineTo(iw * 0.12, -ih * 0.05); c.lineTo(iw * 0.2, ih * 0.08); c.closePath(); c.fill();
    c.beginPath(); c.arc(iw * 0.12, -ih * 0.2, ih * 0.06, 0, 7); c.fill();
    c.font = `700 ${Math.round(h * 0.1)}px ${SANS}`; c.fillStyle = "#4a3f66"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(S.label, 0, ih * 0.3);
  }
  pushPin(c, 0, -h / 2 + 12, 12, "#2fb0ff");
}
const shotImgs = BUILD.shots.map(() => null);
function loadShots(wait) { BUILD.shots.forEach((S, i) => { if (S.src) wait(image(S.src).then((im) => (shotImgs[i] = im))); }); }

/** everything pinned on the board by film time t */
function board(c, t) {
  STATS.forEach((S) => pinned(c, t, S.t, S.at, S.rot, (c2, s) => drawStat(c2, s, S)));
  pinned(c, t, BUILD.card.t, BUILD.card.at, BUILD.card.rot, (c2, s) => drawBuildCard(c2, s));
  BUILD.shots.forEach((S, i) => pinned(c, t, S.t, S.at, S.rot, (c2, s) => drawShot(c2, s, S, shotImgs[i])));
  NEXT.forEach((N) => pinned(c, t, N.t, N.at, N.rot, (c2, s) => drawNote(c2, s, N)));
}
/** a thwack on each pin: the word sits at the thing's top-right corner (off = [x, y] in metres from its centre), on
 *  blank paper or cork, never over its words */
function thwacks(c, t, list, off, word = "THWACK!", size = 62) {
  for (const it of list) {
    const p = toScreen(B(it.at)); if (!p.ok) continue;
    const s = pxPerM(B(it.at));
    const x = Math.min(p.x + off[0] * s, 1890 - size * 2.1); // the whole word stays inside the 30 px margin
    sfx(c, word, x, p.y + off[1] * s, size, twos(t) - it.t - 0.07, { life: 0.8, burst: false, fill: ["#ffffff", "#ffd94a"] });
  }
}
const OFF_STAT = [(CARD_W / 2 - 40) / REF, -(CARD_H / 2 + 6) / REF], OFF_NOTE = [0.42, -0.5], OFF_BUILD = [0.62, -0.47];
/** a bot's pose while it tosses something up onto the board: anticipation dip, the throw, a held follow-through */
function reachPose(t, t0) {
  const r = kf(t, [[t0 - 0.55, 0], [t0 - 0.4, -0.15], [t0 - 0.1, 1], [t0 + 0.3, 1], [t0 + 0.7, 0]]);
  return { armR: Math.max(0, r) * 2.75, armOutR: 0.15 + Math.max(0, r) * 0.25, squash: r < 0 ? 0.25 : t > t0 && t < t0 + 0.12 ? 0.2 : -r * 0.15, headPitch: -0.35 * Math.max(0, r), dy: Math.max(0, r) * 0.04 };
}
/** the carried note: in the bot's right hand until t0 - TOSS, then it flies up to its spot on the board, growing to the
 *  pinned size (w x h metres) as it goes, and the drawn card takes over at t0. No hand ever has to reach 2 m. */
function carryIn(name, t, t0, at, w, h, col) {
  // it stays on the board for two more frames, until the drawn card above it is fully opaque (no blank frame)
  if (t < t0 - 1.6 || t >= t0 + 0.07) return;
  const a = STAGE.get(name); a.g.updateMatrixWorld(true); a.hands[1].getWorldPosition(hv);
  carry.visible = true; carry.children[0].material.color.set(col);
  const u = seg(t, t0 - TOSS, t0);
  if (u <= 0) { carry.position.copy(hv); carry.position.z += 0.08; carry.rotation.set(0, 0, wob(t, 1.3) * 0.2); return; }
  const e = easeOut(u), tx = at[0], ty = at[1], tz = BOARD_Z + 0.03;
  carry.position.set(lerp(hv.x, tx, e), lerp(hv.y, ty, e) + Math.sin(u * Math.PI) * 0.3, lerp(hv.z + 0.08, tz, e));
  carry.rotation.set(0, 0, (1 - e) * 0.9);
  carry.scale.set(lerp(1, w / 0.26, e), lerp(1, h / 0.26, e), 1);
}
/** the look-at point after turning the view (pos -> tgt) by yaw radians about the vertical (positive = to the left) */
function yawTo(pos, tgt, yaw) {
  const dx = tgt[0] - pos[0], dz = tgt[2] - pos[2], c = Math.cos(yaw), s = Math.sin(yaw);
  return [pos[0] + dx * c + dz * s, tgt[1], pos[2] - dx * s + dz * c];
}
/** horizontal speed streaks over a whip pan (amt 0..1), drawn on twos */
function speedLines(c, t, amt) {
  if (amt <= 0.02) return;
  const f = Math.floor(t * 15);
  c.save(); c.lineCap = "round";
  for (let i = 0; i < 46; i++) {
    const y = hash(i * 7 + f) * 1080, x = hash(i * 13 + f * 3) * 2200 - 200, len = (300 + hash(i * 5) * 900) * amt;
    c.globalAlpha = (0.25 + hash(i * 3) * 0.45) * amt; c.strokeStyle = i % 3 ? "#ffffff" : "#1a1030"; c.lineWidth = 3 + hash(i * 11) * 9;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
  }
  c.restore();
}
/** a face that changes on the listed times, with a one-blink (0.08 s) between: faceSeq(t, "code", [[400.5, "happy"]]) */
function faceSeq(t, first, list) {
  let f = first;
  for (const [tc, nf] of list) { if (t < tc) break; f = t < tc + 0.08 ? "blink" : nf; }
  return f;
}

// ======================= 400–412 · MEASURED: three cards, then the honest line =======================
// One continuous take for the three cards (one slow push across the board, so no jump cuts between near-identical
// framings), then a closer, lower shot of the trio for "Not yet". Poses are one function of film time across all four.
const MEAS = REGION.measured;
const MPOS = { lim: [-3.25, -1.0], tan: [-2.55, -0.85], wei: [-1.85, -0.95] };
function measTrio(t) {
  const t1 = STATS[0].t, t2 = STATS[1].t, t3 = STATS[2].t;
  const clapOn = kf(t, [[t3 + 0.05, 0], [t3 + 0.3, 1], [t3 + 1.5, 1], [t3 + 1.8, 0]]);
  const clap = t > t3 + 0.3 && t < t3 + 1.5 ? Math.abs(Math.sin((t - t3 - 0.3) * 9)) : 0;
  const nod = (a) => kf(t, [[a, 0], [a + 0.2, 0.25], [a + 0.4, 0], [a + 0.6, 0.25], [a + 0.8, 0]]);
  STAGE.pose("lim", {
    x: MPOS.lim[0], z: MPOS.lim[1], squash: wob(t, 0.7) * 0.03, tilt: wob(t, 0.4) * 0.05,
    rotY: kf(t, [[399.9, -0.25], [t1 - 0.2, -0.55], [t2 - 0.1, -0.55], [t2 + 0.3, -0.3], [t3 - 0.1, -0.3], [t3 + 0.2, -0.2], [407.6, -0.2], [408.2, 0.5]]),
    armR: kf(t, [[t1 - 0.2, 0], [t1 + 0.1, 2.3], [t2 - 0.25, 2.2], [t2 + 0.15, 0]]), armOutR: kf(t, [[t1 - 0.2, 0.1], [t1 + 0.1, 0.35], [t2 - 0.25, 0.35], [t2 + 0.15, 0.1]]),
    headYaw: kf(t, [[t1 - 0.2, 0], [t1 + 0.1, -0.3], [t2 - 0.1, -0.3], [t2 + 0.2, -0.15], [t3, -0.15], [t3 + 0.3, 0]]),
    headPitch: -0.2 + kf(t, [[407.4, 0], [407.6, 0.2]]) + nod(408.6),
    face: faceSeq(t, "code", [[t1 + 0.2, "happy"], [407.9, "think"], [409.6, "code"], [410.4, "happy"]]),
  });
  STAGE.pose("tan", {
    x: MPOS.tan[0], z: MPOS.tan[1], squash: wob(t, 0.6, 2) * 0.03 + clap * 0.08, tilt: wob(t, 0.35, 1) * 0.05,
    rotY: kf(t, [[407.6, 0], [408.0, 0.1]]),
    headYaw: kf(t, [[t1 + 0.1, 0], [t1 + 0.4, -0.45], [t2 - 0.1, -0.45], [t2 + 0.25, -0.15], [t3 - 0.1, -0.15], [t3 + 0.2, 0], [407.8, 0], [408.2, -0.4], [409.8, -0.4], [410.2, 0.1]]),
    headPitch: kf(t, [[t3, -0.3], [t3 + 0.3, -0.15], [407.4, -0.15], [407.7, 0.1]]),
    armL: clapOn * (1.3 + clap * 0.15), armR: clapOn * (1.3 + clap * 0.15), armOutL: 0.1 + clapOn * (0.35 - clap * 0.35), armOutR: 0.1 + clapOn * (0.35 - clap * 0.35),
    ear: kf(t, [[t1 + 0.35, 0], [t1 + 0.5, 1], [t2, 1], [t2 + 0.4, 0.4]]),
    face: faceSeq(t, "code", [[t1 + 0.35, "wow"], [t2 + 0.3, "happy"], [t3 + 0.15, "wow"], [t3 + 0.5, "happy"], [407.8, "think"], [410.3, "happy"]]),
  });
  const hop = Math.max(0, Math.sin(seg(t, t2 + 0.1, t2 + 0.45) * Math.PI)) * 0.12;
  STAGE.pose("wei", {
    x: MPOS.wei[0], z: MPOS.wei[1], tilt: wob(t, 0.45, 2) * 0.06, dy: hop,
    squash: wob(t, 0.75, 4) * 0.03 + (t > t2 + 0.45 && t < t2 + 0.6 ? 0.3 : 0),
    rotY: kf(t, [[t2 - 0.4, -0.3], [t2 - 0.15, -0.45], [t3 - 0.2, -0.45], [t3 + 0.1, -0.2], [407.7, -0.2], [408.2, -0.8], [409.9, -0.8], [410.3, -0.3]]),
    armR: kf(t, [[t2 - 0.25, 0], [t2 + 0.05, 2.4], [t3 - 0.1, 2.3], [t3 + 0.4, 0.2], [409.9, 0.2], [410.3, 2.6], [412, 2.5]]),
    armOutR: kf(t, [[t2 - 0.25, 0.1], [t2 + 0.05, 0.3], [t3 + 0.4, 0.15], [409.9, 0.15], [410.3, 0.3]]),
    headYaw: kf(t, [[t1 + 0.1, 0], [t1 + 0.4, -0.35], [t2 - 0.3, -0.35], [t2, 0], [t3 + 0.2, 0], [t3 + 0.5, -0.4], [407.4, -0.4], [407.8, 0]]),
    headPitch: kf(t, [[t1, -0.25], [t2, -0.3], [t3 + 0.4, -0.2], [407.6, 0]]) + nod(408.7),
    face: faceSeq(t, "code", [[t2, "happy"], [407.9, "think"], [409.95, "happy"]]),
  });
}
/** the one camera of the three cards: a slow push with a slight drift, 400 -> 407.4 */
function measCam(tRaw) {
  const k = ease(seg(tRaw, 400.0, 407.4));
  STAGE.cam([MEAS + lerp(0.15, 0.32, k), lerp(1.5, 1.47, k), lerp(3.8, 3.5, k)], [MEAS + lerp(0.05, -0.02, k), 1.66, -2.1], 40);
}
/** "Not yet": lower and closer on the trio, cards 2 and 3 whole above them (card 1 just out of frame, not cut); the
 *  caption sits bottom-left over the floor and their feet */
const NY = { p0: [-2.22, 0.95, 2.45], p1: [-2.3, 0.92, 2.2], t0: [-2.32, 1.82, -2.1], t1: [-2.36, 1.9, -2.1] }; // the MEASURED plate stays whole in frame
function notYetCam(tRaw) {
  const k = ease(seg(tRaw, 407.4, 412.0));
  return { pos: NY.p0.map((v, i) => lerp(v, NY.p1[i], k)), tgt: NY.t0.map((v, i) => lerp(v, NY.t1[i], k)) };
}
shot("c13 measured 1", 400.0, 402.3, ({ t: tRaw, ov }) => {
  const t = twos(tRaw);
  stage(t); measTrio(t); measCam(tRaw);
  ov.push((c) => board(c, t));
  ov.push((c) => flashHit(c, t - STATS[0].t, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [STATS[0]], OFF_STAT));
  return { bloom: 0.45 };
});
shot("c13 measured 2", 402.3, 404.4, ({ t: tRaw, ov }) => {
  const t = twos(tRaw);
  stage(t); measTrio(t); measCam(tRaw);
  ov.push((c) => board(c, t));
  ov.push((c) => flashHit(c, t - STATS[1].t, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [STATS[1]], OFF_STAT));
  return { bloom: 0.45 };
});
shot("c13 measured 3", 404.4, 407.4, ({ t: tRaw, ov }) => {
  const t = twos(tRaw), t0 = STATS[2].t;
  stage(t); measTrio(t); measCam(tRaw);
  ov.push((c) => board(c, t));
  ov.push((c) => flashHit(c, t - t0, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [STATS[2]], OFF_STAT));
  ov.push((c) => { const h = STAGE.get("tan"); h.g.updateMatrixWorld(true); h.g.getWorldPosition(hv); const p = toScreen([hv.x + 0.05, 0.55, hv.z + 0.3]); sfx(c, "CLAP CLAP", p.x, p.y, 62, t - t0 - 0.35, { life: 1.1, burst: false, fill: ["#ffffff", "#ff9fd2"] }); });
  return { bloom: 0.45 };
});
shot("c13 not yet", 407.4, 412.0, ({ t: tRaw, ov }) => {
  const t = twos(tRaw);
  stage(t); measTrio(t);
  const { pos, tgt } = notYetCam(tRaw);
  STAGE.cam(pos, tgt, 40);
  ov.push((c) => board(c, t));
  ov.push((c) => caption(c, HONEST.text, 60, 900, seg(t, HONEST.t, HONEST.t + 0.35), { bg: "#fff6e4", maxW: 900, size: 44 }));
  return { bloom: 0.45 };
});

// ======================= 412–422 · HOW WE BUILT IT: the build-notes card and screenshot slots =======================
const BLD = REGION.build;
const trio2 = (t, o = {}) => {
  STAGE.pose("wei", { x: 1.0, z: -1.0, rotY: 0.2, tilt: wob(t, 0.45, 2) * 0.06, squash: wob(t, 0.75, 4) * 0.03, face: "code", ...o.wei });
  STAGE.pose("tan", { x: 1.75, z: -0.85, rotY: 0.05, tilt: wob(t, 0.35, 1) * 0.05, squash: wob(t, 0.6, 2) * 0.03, face: "code", ...o.tan });
  STAGE.pose("lim", { x: 2.5, z: -1.0, rotY: -0.25, tilt: wob(t, 0.4) * 0.05, squash: wob(t, 0.7) * 0.03, face: "code", ...o.lim });
};
shot("c13 build", 412.0, 415.2, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw);
  stage(t); loadShots(wait);
  const t0 = BUILD.card.t, walk = seg(lt, 0.25, 0.9);
  // the whip starts from exactly where "Not yet" ended, with the trio still standing there; at the height of the blur
  // they are swapped for their walk-in under the build region
  const wk = ease(seg(ltRaw, 0, 0.5)), k = ease(seg(ltRaw, 0.5, 3.2));
  if (ltRaw < 0.25) measTrio(twos(412.0));
  else {
    const rp = reachPose(t, t0);
    trio2(t, {
      wei: { x: lerp(0.05, 1.0, easeOut(walk)), walk: walk < 1 ? lt * 10 : 0, rotY: walk < 1 ? 1.0 : 0.4, ...(walk >= 1 ? rp : {}), face: faceSeq(t, "code", [[t0 + 0.15, "happy"]]) },
      tan: { x: lerp(0.8, 1.75, easeOut(walk)), walk: walk < 1 ? lt * 10 + 1 : 0, rotY: walk < 1 ? 1.0 : 0.05, face: "code", headYaw: walk >= 1 ? -0.3 : 0 },
      lim: { x: lerp(1.55, 2.5, easeOut(walk)), walk: walk < 1 ? lt * 10 + 2 : 0, rotY: walk < 1 ? 1.0 : -0.25, face: "code" },
    });
    if (walk >= 1) carryIn("wei", t, t0, BUILD.card.at, BUILD.card.w, BUILD.card.h, "#fff6e4");
  }
  const ny = notYetCam(412.0), endPos = [BLD + lerp(0, -0.1, k), lerp(1.5, 1.52, k), lerp(2.8, 2.6, k)], endTgt = [BLD + lerp(0, 0.05, k), 1.85, -2.1];
  const pos = ny.pos.map((v, i) => lerp(v, endPos[i], wk)), tgt = ny.tgt.map((v, i) => lerp(v, endTgt[i], wk));
  pos[2] += Math.sin(wk * Math.PI) * 0.3;
  STAGE.cam(pos, tgt, 40);
  ov.push((c) => board(c, t));
  ov.push((c) => speedLines(c, tRaw, Math.sin(Math.PI * seg(ltRaw, 0, 0.5))));
  ov.push((c) => flashHit(c, t - t0, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [{ at: BUILD.card.at, t: t0 }], [BUILD.card.w * 0.36, -BUILD.card.h * 0.47]));
  ov.push((c) => { BUILD.shots.forEach((S) => { const p = toScreen(B(S.at)), s = pxPerM(B(S.at)); sfx(c, "TAK", p.x + S.w * 0.42 * s, p.y - S.h * 0.55 * s, 46, twos(tRaw) - S.t - 0.05, { life: 0.5, burst: false, fill: ["#ffffff", "#9ff0ff"] }); }); });
  return { bloom: 0.45 };
});
shot("c13 build close", 415.2, 418.6, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw);
  stage(t); loadShots(wait);
  trio2(t, {
    wei: { rotY: 0.35, face: "happy", headPitch: -0.25, headYaw: 0.15 },
    tan: { rotY: -0.1, armR: kf(lt, [[0.3, 0], [0.6, 2.2], [3.4, 2.1]]), armOutR: 0.25, face: faceSeq(lt, "code", [[0.7, "happy"]]), headPitch: -0.3, headYaw: -0.15 },
    lim: { rotY: -0.45, face: faceSeq(lt, "think", [[1.6, "happy"]]), headPitch: kf(lt, [[1.8, -0.2], [2.0, 0.1], [2.2, -0.2], [2.4, 0.1]]), headYaw: -0.2 },
  });
  // a push-in on the notes card alone, the part the owner fills in: framed so the screenshot slots stay out of the
  // frame (none is cut by the edge) and the camera is above the trio's heads (no ear tips at the bottom)
  const k = ease(seg(ltRaw, 0, 3.4)), cx = BUILD.card.at[0];
  STAGE.cam([cx + lerp(0.1, 0.03, k), lerp(2.12, 2.08, k), lerp(-0.25, -0.5, k)], [cx + lerp(0.04, 0.0, k), 2.04, -2.1], 40);
  ov.push((c) => board(c, t));
  return { bloom: 0.45 };
});
shot("c13 build side", 418.6, 422.0, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw);
  stage(t); loadShots(wait);
  trio2(t, {
    wei: { rotY: lerp(0.3, 1.2, seg(lt, 2.6, 3.2)), face: "happy", headPitch: -0.2 },
    tan: { rotY: lerp(-0.05, 1.1, seg(lt, 2.7, 3.3)), face: "happy", headPitch: -0.25, tilt: wob(lt, 0.5) * 0.12 },
    lim: { rotY: lerp(-0.3, 1.0, seg(lt, 2.5, 3.1)), face: faceSeq(lt, "code", [[0.9, "happy"]]), armR: kf(lt, [[0.2, 0], [0.6, 2.4], [2.0, 2.3], [2.4, 0]]), armOutR: 0.3, headPitch: -0.2 },
  });
  // a slow lateral drift from the right, then a whip pan to the NEXT region in the last 0.35 s. The whip turns only as
  // far as "next 1" picks up (centre of view about x = 5.4 on the wall), so the pan runs one way across the cut.
  const k = ease(seg(ltRaw, 0, 3.05)), wk = easeIn(seg(ltRaw, 3.05, 3.4));
  const yaw = wk * 0.46;
  const pos = [BLD + lerp(1.3, 1.0, k), lerp(1.45, 1.5, k), lerp(2.8, 2.65, k)];
  const tgt0 = [BLD + lerp(0.2, 0.35, k), 1.8, -2.1];
  STAGE.cam(pos, yawTo(pos, tgt0, -yaw), 40); // negative yaw turns the view to the right
  ov.push((c) => board(c, t));
  ov.push((c) => speedLines(c, tRaw, seg(ltRaw, 3.0, 3.35)));
  return { bloom: 0.45 };
});

// ======================= 422–430 · NEXT: three sticky notes, then the trio turn to us =======================
// Poses are one function of film time across the three shots (no snaps at the cuts); each cut changes the framing
// clearly: the landing of the whip, a low close angle for Mr Tan's hop, then the wide pull-back.
const NX = REGION.next;
function nextTrio(t) {
  const [n1, n2, n3] = NEXT.map((N) => N.t);
  const turn = seg(t, n3 + 0.7, n3 + 1.1);
  const rl = reachPose(t, n1), rt = reachPose(t, n2), rw = reachPose(t, n3);
  STAGE.pose("lim", {
    x: 6.8, z: -1.0, tilt: wob(t, 0.4) * 0.05, ...rl, squash: rl.squash + wob(t, 0.7) * 0.03,
    rotY: lerp(0.1, 0.25, turn),
    headYaw: kf(t, [[n1 + 0.7, 0], [n1 + 1.1, 0.35], [n3 + 0.4, 0.35], [n3 + 0.8, 0]]),
    face: faceSeq(t, "code", [[n1 + 0.2, "happy"]]), wave: turn > 0.5 ? (t - 427.6) * 1.6 : null,
  });
  const hop = Math.max(0, Math.sin(seg(t, n2 - 0.3, n2 + 0.25) * Math.PI)) * 0.3 + Math.max(0, Math.sin(seg(t, n3 + 0.8, n3 + 1.1) * Math.PI)) * 0.15;
  STAGE.pose("tan", {
    x: 8.0, z: -0.9, tilt: wob(t, 0.35, 1) * 0.05, ...rt, dy: rt.dy + hop,
    squash: rt.squash + wob(t, 0.6, 2) * 0.03 + (t > n3 + 0.9 && t < n3 + 1.05 ? -0.3 : 0),
    headYaw: kf(t, [[422.2, 0], [422.5, -0.4], [n1 + 0.8, -0.4], [n1 + 1.2, 0], [n2 + 0.7, 0], [n2 + 1.1, 0.35], [n3 + 0.3, 0.35], [n3 + 0.7, 0]]),
    ear: kf(t, [[n2 - 0.3, 0], [n2, 1], [n2 + 1.0, 1], [n2 + 1.4, 0.3]]),
    face: faceSeq(t, "code", [[n2 + 0.2, "happy"], [n3 + 0.8, "love"]]),
  });
  STAGE.pose("wei", {
    x: 9.15, z: -1.0, tilt: wob(t, 0.45, 2) * 0.06, ...rw, squash: rw.squash + wob(t, 0.75, 4) * 0.03,
    rotY: lerp(-0.1, -0.3, turn),
    headYaw: kf(t, [[422.3, 0], [422.6, -0.45], [n3 - 0.8, -0.45], [n3 - 0.5, 0]]),
    face: faceSeq(t, "code", [[n2 + 0.4, "wow"], [n2 + 1.5, "happy"]]),
  });
  const carrier = NEXT.find((N) => t >= N.t - 1.6 && t < N.t + 0.07); // same window as carryIn's
  if (carrier) carryIn(carrier.by, t, carrier.t, carrier.at, NOTE, NOTE, carrier.col);
}
shot("c13 next 1", 422.0, 425.0, ({ t: tRaw, lt: ltRaw, ov }) => {
  const t = twos(tRaw);
  stage(t); nextTrio(t);
  // the whip lands: the yaw settles from where "build side" left off (centre of view about x = 5.4), then a slow push
  const wk = easeOut(seg(ltRaw, 0, 0.35)), k = ease(seg(ltRaw, 0.35, 3.0));
  const pos = [NX + lerp(-0.2, -0.1, k), lerp(1.5, 1.52, k), lerp(3.25, 3.05, k)];
  const tgt = [NX + lerp(-0.25, -0.15, k), 1.8, -2.1];
  STAGE.cam(pos, yawTo(pos, tgt, (1 - wk) * 0.42), 40); // still swinging in from the left, settling
  ov.push((c) => board(c, t));
  ov.push((c) => speedLines(c, tRaw, 1 - seg(ltRaw, 0, 0.35)));
  ov.push((c) => flashHit(c, t - NEXT[0].t, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [NEXT[0]], OFF_NOTE));
  return { bloom: 0.45 };
});
shot("c13 next 2", 425.0, 427.6, ({ t: tRaw, lt: ltRaw, ov }) => {
  const t = twos(tRaw), lt = twos(ltRaw), t0 = NEXT[1].t;
  stage(t); nextTrio(t);
  // low and close, looking up past Mr Tan at the board: his hop is the action
  const k = ease(seg(ltRaw, 0, 2.6));
  STAGE.cam([NX + lerp(0.05, 0.12, k), lerp(0.98, 1.02, k), lerp(1.95, 1.72, k)], [NX + lerp(0.0, 0.05, k), 1.66, -2.1], 40); // the notes whole, the NEXT plate just out of frame (not cut)
  ov.push((c) => board(c, t));
  ov.push((c) => flashHit(c, t - t0, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [NEXT[1]], OFF_NOTE));
  ov.push((c) => { const h = STAGE.get("tan"); h.g.updateMatrixWorld(true); h.g.getWorldPosition(hv); const p = toScreen([hv.x + 0.35, hv.y + 1.15, hv.z]); sfx(c, "HUP!", p.x, p.y, 58, lt - (t0 - 425.0 - 0.25), { life: 0.6, burst: false, fill: ["#ffe37a", "#ff8a1f"] }); });
  return { bloom: 0.45 };
});
shot("c13 next 3", 427.6, 430.0, ({ t: tRaw, lt: ltRaw, ov }) => {
  const t = twos(tRaw);
  stage(t); nextTrio(t);
  const k = ease(seg(ltRaw, 0, 2.4));
  STAGE.cam([NX + lerp(0.0, 0.1, k), lerp(1.5, 1.55, k), lerp(3.0, 3.45, k)], [NX + 0.05, lerp(1.8, 1.75, k), -2.1], 40);
  ov.push((c) => board(c, t));
  ov.push((c) => flashHit(c, t - NEXT[2].t, "#fff3b0", 2));
  ov.push((c) => thwacks(c, tRaw, [NEXT[2]], OFF_NOTE));
  return { bloom: 0.45 };
});
