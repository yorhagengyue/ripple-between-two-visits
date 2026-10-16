// Chapter 8 · Evening and the loop (film 187–205 s). Out of the high-five's white flash onto his balcony at sunset:
// he comes out with his tea and sits (CREAK), the string lights come on (CLICK); over his shoulder the sun goes down
// over the estate and he sips (SLURP); close on him, SIGH..., and the day comes back icon by icon in a thought bubble,
// "...and again tomorrow"; then night, and one long pull-back from his balcony to the estate with his window lit, the
// banner, the end title and the disclaimer. Copies the reference's ending (74–90 s: balcony, sunset, SIGH, pull-back).
//
// The balcony (src/sets/c08_balcony.js) is one group moved per shot: at human scale on its own facade above the
// estate for the sunset shots, and scaled 0.3 onto the hero block of this chapter's city for the night pull-back.
// Mr Tan here is a private copy of the Tan bot that lives inside the balcony group (the shared actor is never scaled,
// given props or stretched): his left arm reaches for the cup's handle every frame (a small IK, see holdCup), so the
// fist and the cup always touch, and it may stretch a little for the sip.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, pop, ease, easeOut, easeIn, clamp, lerp, hash, twos, backOut } from "../core.js";
import { timeCard, sfx, flashHit, thought, title, banner, INK, YEL } from "../overlay.js";
import { buildCity, HERO_WINDOW } from "../sets/city.js";
import { painted, shadowy } from "../sets/kit.js";
import { buildBalcony, nightCity, sunsetSkyPainter, nightSkyPainter, SEAT } from "../sets/c08_balcony.js";
import { makeTanBot } from "../bots.js";

const T0 = 187;
const S1 = T0, S2 = T0 + 3.6, S3 = T0 + 6.8, S4 = T0 + 12.0, S5 = T0 + 18.0; // shot boundaries

// ---- sets and cast -------------------------------------------------------------------------------------------------
const city = STAGE.set("c08.city", buildCity());
const setNight = nightCity(city);
const winMat = city.userData.heroWindow;
const bal = STAGE.set("c08.balcony", buildBalcony());
// shadows: everything casts and receives, except glass and the unlit painted planes (the room seen through the door)
shadowy(bal).traverse((o) => { if (o.isMesh && (o.material.transparent || o.material.isMeshBasicMaterial)) o.castShadow = false; });
const B = bal.userData, cup = B.cup;
// the sunset backdrop stands square to the view from his balcony (world (2, 17.5, 30) looking a little toward +x)
const sunsky = painted(240, 110, 1024, 470, sunsetSkyPainter, { unlit: true }); sunsky.position.set(30, 24, -52); sunsky.rotation.y = -0.36;
STAGE.set("c08.sunsky", sunsky);
const nightsky = painted(240, 110, 1024, 470, nightSkyPainter, { unlit: true }); nightsky.position.set(-14, 26, -60); nightsky.rotation.y = 0.32;
STAGE.set("c08.nightsky", nightsky);
const mini = makeTanBot(); bal.add(mini.g);
mini.g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

// ---- helpers -------------------------------------------------------------------------------------------------------
const C = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(k));
/** put the balcony where the shot needs it: "sun" = human scale above the estate, "night" = on the hero block */
function place(mode, yaw = 0) {
  // (yaw turns the balcony on its spot: 8b looks out sideways, past his profile, so the balcony is turned until that
  // direction lands on the sun and the estate; no other shot sees the sky, so the turn cannot be noticed)
  if (mode === "sun") { bal.position.set(2, 16, 30); bal.rotation.set(0, Math.PI + yaw, 0); bal.scale.setScalar(1); }
  else { bal.position.set(HERO_WINDOW.x, 8.42, 0.84); bal.rotation.set(0, 0, 0); bal.scale.setScalar(0.3); }
  B.facade.visible = mode === "sun";
  B.bigPlant.position.set(-2.2, 0, 1.45); B.bougain.visible = true; // (8b cheats both out of its view)
  bal.updateMatrixWorld(true);
}
/** balcony coordinates to world */
const W = (x, y, z) => bal.localToWorld(new THREE.Vector3(x, y, z)).toArray();
const cam = (p, q, fov, roll) => STAGE.cam(W(...p), W(...q), fov, roll);
/** pose Mr Tan (the private bot) in balcony coordinates */
function poseTan(p) {
  mini.g.visible = true; mini.g.rotation.set(0, 0, 0); mini.arms[1].scale.set(1, 1, 1); mini.pose(p); return mini;
}

// ---- the cup in his left fist -------------------------------------------------------------------------------------
// The cup is a child of the balcony; its origin is the centre of its base, its handle points along its +x. The fist
// holds the handle at GRIP; the near rim (RIM) is what touches his moustache when he sips.
const GRIP = new THREE.Vector3(0.1, 0.05, 0), RIM = new THREE.Vector3(0, 0.09, -0.056);
const MOUTH = new THREE.Vector3(0, 0.105, 0.315); // in front of the moustache, head coordinates
/** an object's matrix in balcony coordinates */
const relM = (o) => new THREE.Matrix4().copy(bal.matrixWorld).invert().multiply(o.matrixWorld);
/** orthonormal cup axes from an up vector and a preferred handle direction; returns a quaternion */
function cupQuat(up, handle) {
  const y = up.clone().normalize(), x = handle.clone().sub(y.clone().multiplyScalar(handle.dot(y))).normalize(), z = x.clone().cross(y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
/**
 * Hold the cup in his left fist. rest: where the cup's base sits, in body coordinates (upright, handle out to his left);
 * sip 0..1 blends it to the sip pose, the near rim against his moustache, tipped toward his face by tilt (radians,
 * relative to his head). The left arm then aims at the handle (two passes) and stretches by up to 35 % (or shortens
 * by 12 %) to reach it, and the cup is finally moved by what is left of the error, so fist and handle always touch.
 */
function holdCup(actor, rest, sip = 0, tilt = 0) {
  const arm = actor.arms[1];
  actor.g.updateMatrixWorld(true);
  const B = relM(actor.body), H = relM(actor.head);
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(); B.extractBasis(bx, by, bz);
  const hx = new THREE.Vector3(), hy = new THREE.Vector3(), hz = new THREE.Vector3(); H.extractBasis(hx, hy, hz);
  [bx, by, bz, hx, hy, hz].forEach((v) => v.normalize());
  // rest: on his knee or in front of his belly, upright, handle out to his left
  const o0 = rest.clone().applyMatrix4(B), q0 = cupQuat(new THREE.Vector3(0, 1, 0), bx);
  let o = o0, q = q0;
  if (sip > 0) {
    // at his mouth: tipped toward his face, the handle turned down and back toward his shoulder (as a mug is held to
    // drink), so the fist sits below and behind the cup and the cup stays in view
    const up = hy.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(hz, -Math.sin(tilt));
    const mouth = MOUTH.clone().applyMatrix4(H), shoulder = bal.worldToLocal(arm.getWorldPosition(new THREE.Vector3()));
    const q1 = cupQuat(up, shoulder.sub(mouth));
    const o1 = mouth.sub(RIM.clone().applyQuaternion(q1));
    const k = clamp(sip);
    o = o0.clone().lerp(o1, sip); q = q0.clone().slerp(q1, k);
  }
  // aim the arm at the handle, in body coordinates
  const Binv = B.clone().invert();
  const gripB = () => o.clone().add(GRIP.clone().applyQuaternion(q)).applyMatrix4(Binv);
  let aim = gripB();
  for (let pass = 0; pass < 2; pass++) {
    const d = aim.clone().sub(arm.position), len = d.length(); d.divideScalar(len);
    arm.rotation.set(-Math.atan2(d.z, -d.y), 0, Math.asin(clamp(d.x, -1, 1)));
    arm.scale.y = clamp(len / 0.3, 0.88, 1.35);
    actor.g.updateMatrixWorld(true);
    const hand = actor.hands[0].getWorldPosition(new THREE.Vector3()).applyMatrix4(actor.body.matrixWorld.clone().invert());
    aim = aim.clone().add(gripB().sub(hand));
  }
  actor.g.updateMatrixWorld(true);
  const hand = actor.hands[0].getWorldPosition(new THREE.Vector3()); bal.worldToLocal(hand);
  const grip = o.clone().add(GRIP.clone().applyQuaternion(q));
  cup.position.copy(o).add(hand.sub(grip)); cup.quaternion.copy(q);
  cup.updateMatrixWorld(true);
}
/** the top of the cup, in world coordinates (for the steam and the sound effects) */
const cupTop = () => cup.localToWorld(new THREE.Vector3(0, 0.1, 0));
const REST_SIT = new THREE.Vector3(0.12, 0.19, 0.22), REST_WALK = new THREE.Vector3(0.14, 0.12, 0.27);
/** world point to screen pixels (after the camera is set) */
function scr(v) { const c = STAGE.camera; c.updateMatrixWorld(); const p = v.clone().project(c); return [((p.x + 1) / 2) * 1920, ((1 - p.y) / 2) * 1080]; }
const local2scr = (x, y, z) => scr(new THREE.Vector3(...W(x, y, z)));
function animateSet(t) {
  B.fan.rotation.z = -t * 9;
  B.laundry.forEach((p, i) => (p.rotation.z = 0.03 + wob(t, 0.33 + i * 0.05, i * 1.7) * 0.11 + wob(t, 0.9, i) * 0.03));
}
const SITY = SEAT.top - 0.13;
const seated = (o = {}) => ({ x: SEAT.x, z: SEAT.z, dy: SITY, sit: 1, armL: 0.8, armR: 0.62, armOutL: 0.06, armOutR: 0.12, ...o });

function sunsetLights(k = 0) {
  STAGE.lights("dusk", { sky: C("#ffcfa6", "#b896e8", k), ground: C("#4a2f86", "#30226e", k), hemi: lerp(0.78, 0.7, k),
    key: C("#ffb45e", "#e0709a", k), keyI: lerp(2.9, 2.2, k), rim: "#9a6bff", rimI: 1.3, bg: "#ff9a6a",
    keyPos: W(-3.6, 2.5, 6.4), keyTarget: W(0, 1.2, 1) }); // a low sun: it reaches under the ceiling slab
}
const CARD = (k, out = 0) => (c) => timeCard(c, "7:15 PM", "Home", k, { out });
// shot 8b's camera (balcony coordinates): off his left shoulder, almost side-on, at his eye level, looking out past his
// profile; the balcony is turned by yaw so the sun sits in the left third
const SH2 = { p0: [2.4, 1.12, 1.0], p1: [2.22, 1.12, 1.0], q: [-6.87, 1.52, 4.75], fov: 50, yaw: 28 * Math.PI / 180 };

/** sfx() with a starburst, minus overlay.js's stray ring: its dotFill leaves the last halftone dot as the current path, so
 *  the stroke meant for the burst outline draws an 8 px ink ring off the burst's lower right (a dark dot floating in the
 *  sky beside every burst). Same arguments as sfx(); the ring is clipped out exactly where sfx() will draw it. */
function burstSfx(c, txt, x, y, size, age, o = {}) {
  const life = o.life ?? 1.2;
  if (age < 0 || age > life) return;
  const f = Math.floor(age * 15), end = life - 2 / 30;
  let k = age < 0.1 ? 1.08 : age > end ? 0.6 : 1 + (hash(f * 13 + txt.length) - 0.5) * 0.02;
  if (age < 0.033) k = 0.9;
  const jx = age > 0.1 && age < end ? (hash(f * 7 + x) - 0.5) * 9 : 0, jy = age > 0.1 && age < end ? (hash(f * 11 + y) - 0.5) * 9 : 0;
  const rot = o.rot ?? (hash(txt.length * 7 + x) - 0.5) * 0.3, r = size * (0.55 + txt.length * 0.13);
  let lx = 0, ly = 0; // the last dot dotFill() draws
  for (let yy = -r; yy < r; yy += 11) for (let xx = -r * 1.3; xx < r * 1.3; xx += 11) { lx = xx + (Math.round(yy / 11) % 2) * 5.5; ly = yy; }
  c.save();
  const m = c.getTransform();
  c.translate(x + jx, y + jy); c.rotate(rot); c.scale(k, k);
  c.beginPath(); c.rect(-4000, -4000, 8000, 8000); c.arc(lx, ly, 2.6 + 4 + 2, 0, Math.PI * 2); c.clip("evenodd");
  c.setTransform(m);
  sfx(c, txt, x, y, size, age, o);
  c.restore();
}

// steam off the cup: three wavy wisps rising and fading
function steam(c, x, y, t, s = 1) {
  c.save(); c.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.7 + i / 3) % 1, a = Math.sin(ph * Math.PI) * 0.7;
    c.strokeStyle = `rgba(255,255,255,${a})`; c.lineWidth = 7 * s * (1 - ph * 0.5);
    c.beginPath();
    for (let k = 0; k <= 10; k++) { const yy = y - (ph * 70 + k * 6) * s, xx = x + (i - 1) * 12 * s + Math.sin(k * 0.7 + t * 4 + i * 2) * 7 * s; k ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
    c.stroke();
  }
  c.restore();
}
// little birds flying across the sky (a flock of "v"s that flap)
function birds(c, t, x0, y0, dx) {
  c.save(); c.strokeStyle = "#3a1f66"; c.lineWidth = 4; c.lineCap = "round"; c.lineJoin = "round";
  for (let i = 0; i < 4; i++) {
    const x = x0 + t * dx + i * 46 + hash(i) * 20, y = y0 + i * 18 + Math.sin(t * 2 + i) * 6, f = Math.sin(t * 12 + i * 1.3) * 8;
    c.beginPath(); c.moveTo(x - 14, y - 4 - f); c.lineTo(x, y + 2); c.lineTo(x + 14, y - 4 - f); c.stroke();
  }
  c.restore();
}

// ---- the thought bubble: the day, icon by icon ----------------------------------------------------------------------
const outline = (c, w = 4) => { c.lineWidth = w; c.strokeStyle = INK; c.stroke(); };
const ICONS = [
  (c) => { // the alarm clock
    c.fillStyle = INK; c.beginPath(); c.arc(-17, -24, 10, 0, 7); c.fill(); c.beginPath(); c.arc(17, -24, 10, 0, 7); c.fill();
    c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(-14, 22); c.lineTo(-20, 32); c.moveTo(14, 22); c.lineTo(20, 32); c.stroke();
    c.fillStyle = "#e2433f"; c.beginPath(); c.arc(0, 2, 28, 0, 7); c.fill(); outline(c);
    c.fillStyle = "#fffaf0"; c.beginPath(); c.arc(0, 2, 19, 0, 7); c.fill();
    c.strokeStyle = INK; c.lineWidth = 4; c.lineCap = "round"; c.beginPath(); c.moveTo(0, 2); c.lineTo(0, -11); c.moveTo(0, 2); c.lineTo(9, 7); c.stroke();
  },
  (c) => { // the red tai chi fan
    const a0 = -Math.PI * 0.88, a1 = -Math.PI * 0.12;
    c.fillStyle = "#e2433f"; c.beginPath(); c.moveTo(0, 24); c.arc(0, 24, 50, a0, a1); c.closePath(); c.fill(); outline(c);
    c.fillStyle = "#ffd94a"; c.beginPath(); c.arc(0, 24, 50, a0, a1); c.arc(0, 24, 40, a1, a0, true); c.closePath(); c.fill();
    c.strokeStyle = "#8f1f2a"; c.lineWidth = 2.5; for (let i = 1; i < 8; i++) { const a = a0 + ((a1 - a0) * i) / 8; c.beginPath(); c.moveTo(0, 24); c.lineTo(Math.cos(a) * 48, 24 + Math.sin(a) * 48); c.stroke(); }
    c.beginPath(); c.moveTo(0, 24); c.arc(0, 24, 50, a0, a1); c.closePath(); outline(c);
    c.fillStyle = INK; c.beginPath(); c.arc(0, 24, 6, 0, 7); c.fill();
  },
  (c) => { // the blood pressure monitor (a heart on its screen) and its fat blue cuff on a curly tube
    c.lineCap = "round"; c.strokeStyle = INK; c.lineWidth = 7; c.beginPath(); c.moveTo(6, 18); c.bezierCurveTo(14, 40, 30, 36, 30, 16); c.stroke();
    c.strokeStyle = "#8d93a3"; c.lineWidth = 3.5; c.stroke();
    c.save(); c.translate(36, -2); c.rotate(0.18);
    c.fillStyle = "#3f66d9"; c.beginPath(); c.roundRect(-13, -27, 26, 52, 10); c.fill(); outline(c);
    c.fillStyle = "#2a4aa8"; c.fillRect(-8, -18, 16, 6); c.fillRect(-8, -6, 16, 6); c.fillRect(-8, 6, 16, 6);
    c.restore();
    c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(-40, -26, 56, 50, 9); c.fill(); outline(c);
    c.fillStyle = "#1d2a26"; c.beginPath(); c.roundRect(-34, -20, 44, 26, 4); c.fill();
    c.fillStyle = "#ff5a6a"; c.beginPath(); c.moveTo(-12, 2); c.bezierCurveTo(-26, -7, -22, -18, -12, -12); c.bezierCurveTo(-2, -18, 2, -7, -12, 2); c.fill();
    c.fillStyle = "#2ff0b0"; c.fillRect(-2, -8, 8, 4);
    c.fillStyle = "#3f66d9"; c.beginPath(); c.arc(-12, 15, 5, 0, 7); c.fill();
  },
  (c) => { // the four pharmacy boxes from the morning, stacked two by two, in their brand colours
    const box = (x, y, col, dark) => { // a landscape box: front with a colour band, top and side faces
      const w = 44, h = 28, d = 9;
      c.fillStyle = dark; c.beginPath(); c.moveTo(x, y); c.lineTo(x + d, y - d); c.lineTo(x + w + d, y - d); c.lineTo(x + w + d, y + h - d); c.lineTo(x + w, y + h); c.lineTo(x + w, y); c.closePath(); c.fill(); outline(c, 3);
      c.fillStyle = "#ffffff"; c.beginPath(); c.rect(x, y, w, h); c.fill(); outline(c, 3);
      c.fillStyle = col; c.fillRect(x + 1.5, y + 1.5, w - 3, 11);
      c.fillStyle = "#ffffff"; c.fillRect(x + 5, y + 5.5, 18, 3);
      c.fillStyle = "#b9bfd0"; c.fillRect(x + 5, y + 17, w - 12, 2.5); c.fillRect(x + 5, y + 22, w - 20, 2.5);
    };
    box(-36, -24, "#8a4fd8", "#5d2fa8"); box(10, -24, "#e2433f", "#a8231f");
    box(-46, 6, "#f08a1c", "#b85f00"); box(0, 6, "#2f7de1", "#1d55a8");
  },
  (c) => { // the clinic
    c.fillStyle = "#8fe3c8"; c.beginPath(); c.rect(-32, -12, 64, 40); c.fill(); outline(c);
    c.fillStyle = "#ff8fb0"; c.beginPath(); c.rect(-36, -20, 72, 10); c.fill(); outline(c, 3);
    c.fillStyle = "#3a6f86"; c.fillRect(-9, 6, 18, 22); c.fillStyle = "#ffe08a"; c.fillRect(-26, -4, 12, 10); c.fillRect(14, -4, 12, 10);
    c.fillStyle = "#ffffff"; c.beginPath(); c.arc(0, -32, 13, 0, 7); c.fill(); outline(c, 3);
    c.fillStyle = "#e2433f"; c.fillRect(-3.5, -40, 7, 16); c.fillRect(-8, -35.5, 16, 7);
  },
  (c) => { // his phone with the app
    c.fillStyle = "#1d1630"; c.beginPath(); c.roundRect(-19, -32, 38, 64, 8); c.fill(); outline(c);
    const g = c.createLinearGradient(0, -26, 0, 26); g.addColorStop(0, "#b48cff"); g.addColorStop(1, "#6b4bff");
    c.fillStyle = g; c.beginPath(); c.roundRect(-14, -26, 28, 50, 4); c.fill();
    c.strokeStyle = "#ffffff"; c.lineWidth = 2.5; for (let r = 4; r <= 13; r += 4.5) { c.beginPath(); c.arc(0, -4, r, 0, 7); c.stroke(); }
    c.fillStyle = "#ffffff"; c.fillRect(-9, 12, 18, 3); c.fillRect(-9, 17, 12, 3);
  },
];
const ICON_AT = [0.3, 0.55, 0.8, 1.05, 1.3, 1.55]; // seconds after the bubble opens (the reference: one every 6-8 frames)
const BUBX = 1370, BUBY = 205, BUBW = 1000, BUBH = 280, ICON_S = 1.3; // the thought bubble (centre, size) and icon scale
// each icon's drawn extent at scale 1 (left, right of its origin), so they are laid out edge to edge with even gaps
const ICON_X = [[-30, 30], [-50, 50], [-42, 55], [-48, 65], [-38, 38], [-21, 21]];
function dayBubble(c, w, h, bt) {
  const n = ICONS.length, pad = 72, iy = h * 0.4;
  const total = ICON_X.reduce((a, [l, r]) => a + (r - l) * ICON_S, 0), gap = (w - 2 * pad - total) / (n - 1);
  const xs = []; let x = pad; for (const [l, r] of ICON_X) { xs.push(x - l * ICON_S); x += (r - l) * ICON_S + gap; }
  for (let i = 0; i < n; i++) {
    const s = pop(bt, ICON_AT[i], 0.32);
    if (i > 0 && bt > ICON_AT[i] - 0.1) { c.fillStyle = INK; c.beginPath(); c.arc(xs[i] + ICON_X[i][0] * ICON_S - gap / 2, iy, 5, 0, 7); c.fill(); }
    if (s <= 0) continue;
    c.save(); c.translate(xs[i], iy + (1 - Math.min(1, s)) * 12); c.scale(s * ICON_S, s * ICON_S); c.rotate(wob(bt, 0.5, i) * 0.05); ICONS[i](c); c.restore();
  }
  const tk = seg(bt, 1.9, 2.25);
  if (tk > 0) {
    c.save(); c.globalAlpha = tk; c.font = `italic 800 46px "Segoe UI", system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#5b3fb0"; c.fillText("...and again tomorrow", w / 2, h * 0.82 + (1 - easeOut(tk)) * 10); c.restore();
  }
}

// ---- end card pieces ------------------------------------------------------------------------------------------------
function subtitle(c, txt, x, y, k) {
  if (k <= 0) return;
  c.save(); c.globalAlpha = clamp(k * 2); c.translate(x, y + (1 - easeOut(clamp(k))) * 18); c.rotate(-0.03);
  c.font = `900 46px "Segoe UI", system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  c.lineWidth = 12; c.strokeStyle = INK; c.strokeText(txt, 3, 4); c.strokeText(txt, 0, 0);
  c.fillStyle = "#ffffff"; c.fillText(txt, 0, 0);
  c.restore();
}
/** the title's small yellow label, in title()'s own style and pop, but high enough to clear the big letters (title()
 *  puts it at -0.62 x size, where Bangers capitals at 180 px overlap its lower edge) */
function titleLabel(c, txt, x, y, k, size) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.7);
  c.save(); c.translate(x, y); c.rotate(-0.04); c.scale(s, s);
  c.font = `800 30px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;
  const t = txt.toUpperCase(), sw = c.measureText(t).width + 30;
  c.translate(-sw / 2 - 40, -size * 0.8); c.transform(1, 0, -0.1, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(5, 5, sw, 44); c.fillStyle = YEL; c.fillRect(0, 0, sw, 44);
  c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(0, 0, sw, 44);
  c.fillStyle = INK; c.textBaseline = "middle"; c.fillText(t, 15, 23);
  c.restore();
}
function disclaimer(c, lines, x, y, k) {
  if (k <= 0) return;
  c.save(); c.globalAlpha = clamp(k * 1.5);
  c.font = `600 27px "Segoe UI", system-ui, sans-serif`;
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 48, lh = 37, h = lines.length * lh + 20;
  c.fillStyle = INK; c.fillRect(x - w / 2 + 5, y - h / 2 + 5, w, h);
  c.fillStyle = "#ffffff"; c.fillRect(x - w / 2, y - h / 2, w, h);
  c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle";
  lines.forEach((l, i) => c.fillText(l, x, y - h / 2 + 10 + lh * (i + 0.5)));
  c.restore();
}
// v7 (owner 16 Oct): every mention of the web version says it is a demo for the challenge and the product ships on iOS
const DISCLAIMER = ["Mr Tan, Wei Ling and Dr Lim are fictional.", "Every phone screen is a real recording of app.ripple-health-ai.com,",
  "a web demo built for this challenge. The product will ship as an iOS app.", "Characters after the CodeBuddy mascot."];

// Characters, props and overlays move on twos (T = twos(lt), 15 poses a second); the camera moves on plain time.

// ---- 8a · out of the white onto the balcony at sunset: he comes out with his tea and sits; the lights come on -------
shot("c08 balcony", S1, S2, ({ t, lt, ov }) => {
  const T = twos(lt);
  place("sun"); STAGE.show("c08.city", "c08.balcony", "c08.sunsky"); setNight(0.15); winMat.color.set("#3a2a7a");
  sunsetLights(0);
  animateSet(twos(t));
  // walk out of the door, round the chair, turn, dip, sit (CREAK), look up at the lights (CLICK)
  const path = [[0, [-0.55, -0.75]], [0.55, [-0.45, 0.3]], [1.15, [0.05, 1.28]], [1.45, [0.3, 1.3]]];
  const [px, pz] = kf(T, path, (k) => k);
  const wk = T < 1.45, sitK = ease(seg(T, 1.72, 1.98)), sitAt = 1.98, LIGHTS = 2.5;
  const head = kf(T, [[0, 0], [0.9, -0.2], [1.45, 0]]);
  const dir = T < 0.55 ? 0.1 : T < 1.15 ? 0.5 : T < 1.45 ? lerp(1.2, 0.6, seg(T, 1.15, 1.45)) : lerp(0.6, 0, easeOut(seg(T, 1.45, 1.72)));
  const dip = kf(T, [[1.5, 0], [1.68, 0.22], [1.8, -0.08], [sitAt, 0.32], [2.3, 0]]);
  const look = kf(T, [[LIGHTS - 0.05, 0], [LIGHTS + 0.2, 1], [3.25, 1], [3.55, 0.4]]);
  // (ordered, gap-free tests on the twos grid: no step can fall through to the wrong face)
  const face = T < sitAt ? "code" : T < sitAt + 0.09 ? "blink" : T < LIGHTS - 0.02 ? "code" : T < LIGHTS + 0.06 ? "blink" : T < 3.0 ? "wow" : T < 3.08 ? "blink" : "happy";
  const tan = poseTan({ x: lerp(px, SEAT.x, sitK), z: lerp(pz, SEAT.z, sitK), dy: lerp(0, SITY, sitK) - (T > sitAt && T < sitAt + 0.12 ? 0.03 : 0),
    rotY: dir, walk: wk ? T * 9.5 : 0, sit: sitK, squash: dip + (wk ? 0 : wob(T, 0.4) * 0.03),
    armR: lerp(0.15, 0.62, sitK), armOutR: 0.12,
    headYaw: head, headPitch: -look * 0.35, tilt: wob(T, 0.5) * 0.05, face, ear: look });
  holdCup(tan, REST_WALK.clone().lerp(REST_SIT, sitK));
  // the bird hops on its perch and tweets
  const hop = Math.max(0, Math.sin(seg(T, 0.35, 0.95) * Math.PI * 2)) * 0.05;
  B.bird.position.y = 0.1 + hop; B.bird.rotation.y = T > 0.65 ? 0.6 : -0.3;
  // string lights: off, a flicker, on
  B.bulbMat.emissiveIntensity = T < LIGHTS ? 0.05 : T < LIGHTS + 0.07 ? 1.6 : T < LIGHTS + 0.14 ? 0.15 : 1.6;
  const k = ease(seg(lt, 0, 3.6));
  cam([lerp(3.1, 1.9, k), lerp(2.1, 1.75, k), lerp(6.6, 5.2, k)], [lerp(-0.3, 0.05, k), lerp(1.2, 1.05, k), 0.7], 38);
  const [bx, by] = local2scr(-1.25, 2.1, 1.35), [cx, cy] = local2scr(SEAT.x, 1.0, SEAT.z + 0.3), [lx, ly] = local2scr(-0.4, 2.4, 1.9);
  ov.push(CARD(seg(T, 0.35, 0.8)));
  ov.push((c) => flashHit(c, T - LIGHTS, "#ffe6a0", 2));
  ov.push((c) => sfx(c, "TWEET!", bx - 40, by - 90, 52, T - 0.4, { life: 0.9, burst: false, fill: ["#fff3a0", "#ffb800"] }));
  ov.push((c) => burstSfx(c, "CREAK", cx + 230, cy + 30, 84, T - sitAt, { life: 0.5, burst: "#ffe7c2" }));
  ov.push((c) => sfx(c, "CLICK", lx, ly + 60, 70, T - LIGHTS - 0.07, { life: 0.9, burst: false, fill: ["#fff6c8", "#ffc65a"] }));
  // out of the high-five's white: two frames of cream, then it decays
  ov.push((c) => { const a = lt < 0.067 ? 1 : 1 - easeOut(seg(lt, 0.067, 0.6)); if (a > 0) { c.save(); c.globalAlpha = a; c.fillStyle = "#fffaf0"; c.fillRect(0, 0, 1920, 1080); c.restore(); } });
  return { bloom: 0.55 };
});

// ---- 8b · over his left shoulder: the sun goes down over the estate; he lifts the cup to his moustache, tips his head
// back and sips (SLURP), holds, lowers it with a contented breath ------------------------------------------------------
shot("c08 sunset", S2, S3, ({ t, lt, ov }) => {
  const T = twos(lt);
  place("sun", SH2.yaw); STAGE.show("c08.city", "c08.balcony", "c08.sunsky"); setNight(0.15); winMat.color.set("#3a2a7a");
  // cheats: from here the big plant would stand right behind his cup, and the bougainvillea in front of the lens
  B.bigPlant.position.set(-2.3, 0, 0.42); B.bougain.visible = false;
  sunsetLights(0.2);
  animateSet(twos(t));
  B.bulbMat.emissiveIntensity = 1.6;
  const SIP = 1.25; // the rim reaches his moustache
  // the cup: a small dip (anticipation), up to his mouth, hold while he drinks, back down to his knee
  const up = kf(T, [[0.5, 0], [0.68, -0.25], [SIP - 0.02, 1], [2.05, 1], [2.6, 0]], (k) => k * k * (3 - 2 * k));
  const sip = Math.max(0, up), dipK = Math.min(0, up);
  const tilt = kf(T, [[0.9, 0], [SIP, 0.35], [1.95, 0.72], [2.35, 0.1], [2.6, 0]]);
  const nod = kf(T, [[0.85, 0], [SIP - 0.05, 0.12], [SIP + 0.25, -0.3], [2.0, -0.33], [2.5, 0.04], [2.8, 0]]);
  const breath = kf(T, [[2.55, 0], [2.75, 1], [3.1, 0]]);
  const tan = poseTan(seated({ headPitch: nod + wob(T, 0.3) * 0.015, headYaw: -0.06 + wob(T, 0.2) * 0.03,
    squash: wob(T, 0.45) * 0.025 - dipK * 0.12 - sip * 0.04 + breath * 0.06, lean: -breath * 0.05, tilt: sip * 0.05,
    face: T < 2.45 ? "happy" : T < 2.53 ? "blink" : "love", ear: sip * 0.8 }));
  holdCup(tan, REST_SIT.clone().add(new THREE.Vector3(0, dipK * 0.06, 0)), sip, tilt);
  B.bird.position.y = 0.1; B.bird.rotation.y = 0.6;
  const k = ease(seg(lt, 0, 3.2));
  cam([lerp(SH2.p0[0], SH2.p1[0], k), lerp(SH2.p0[1], SH2.p1[1], k), lerp(SH2.p0[2], SH2.p1[2], k)], SH2.q, SH2.fov);
  const [sx, sy] = scr(cupTop());
  ov.push(CARD(1));
  ov.push((c) => birds(c, T, 230, 230, 110));
  ov.push((c) => { if (sip < 0.4) steam(c, sx, sy - 10, twos(t), 1.2); });
  ov.push((c) => burstSfx(c, "SLURP", 1000, 520, 96, T - SIP, { life: 1.1, burst: "#ffd0e6" })); // beside the cup at his mouth
  return { bloom: 0.7 };
});

// ---- 8c · close on him through the railing: SIGH..., a fast tilt up to the thought bubble, the day comes back icon by
// icon (CLICK on the phone), "...and again tomorrow"; the light slides from peach sunset to violet dusk ----------------
shot("c08 sigh", S3, S4, ({ t, lt, ov }) => {
  const T = twos(lt);
  place("sun"); STAGE.show("c08.city", "c08.balcony", "c08.sunsky"); setNight(0.15); winMat.color.set("#3a2a7a");
  sunsetLights(0.3 + ease(seg(lt, 1.4, 4.6)) * 0.7);
  animateSet(twos(t));
  B.bulbMat.emissiveIntensity = 1.6;
  const BUB = 1.9, SIGH = 0.6; // the sigh; the thought bubble opens after the tilt
  const breath = kf(T, [[0.15, 0], [0.55, -1], [0.65, -1], [1.2, 1], [1.8, 0.6]]);
  const nod = ICON_AT.reduce((a, at) => a + Math.max(0, Math.sin(seg(T, BUB + at, BUB + at + 0.3) * Math.PI)) * 0.07, 0);
  const look = ease(seg(T, 1.6, 1.95)) * (1 - ease(seg(T, 3.8, 4.2)));
  const fin = ease(seg(T, 3.85, 4.3)), toast = kf(T, [[4.0, 0], [4.3, 1], [4.7, 0.8]]);
  const face = T < 0.55 ? "code" : T < 0.63 ? "blink" : T < 1.55 ? "sleepy" : T < 1.63 ? "blink" : T < 3.75 ? "think" : T < 3.83 ? "blink" : "happy";
  const tan = poseTan(seated({ squash: -breath * 0.2 + wob(T, 0.4) * 0.025, lean: breath > 0 ? breath * 0.08 : 0,
    headPitch: breath * 0.16 - look * 0.2 + nod - fin * 0.06 * Math.max(0, Math.sin(seg(T, 3.9, 4.9) * Math.PI * 2)),
    headYaw: look * 0.32, tilt: wob(T, 0.35) * 0.05 + fin * 0.08, armOutR: 0.12 - breath * 0.12,
    face, ear: look * 0.6 + fin * 0.4 }));
  holdCup(tan, REST_SIT.clone().add(new THREE.Vector3(0, toast * 0.07, toast * 0.03)));
  B.bird.position.y = 0.1; B.bird.rotation.y = 0.6;
  // a slow push, then a fast 12-frame tilt up that makes room for the bubble
  const k = ease(seg(lt, 0, 5.2)), up = easeOut(seg(lt, 1.55, 1.95));
  cam([lerp(0.82, 0.7, k), lerp(1.42, 1.38, k) + up * 0.08, lerp(3.75, 3.4, k)], [lerp(0.7, 0.64, k), lerp(1.14, 1.16, k) + up * 0.22, 0.9], 36);
  const [hx, hy] = local2scr(SEAT.x, 1.5, SEAT.z), [sx, sy] = scr(cupTop());
  // the bubble: pops open after the tilt, and pops shut just before the cut (its trail of dots goes with it)
  const bk = seg(T, BUB, BUB + 0.27) * (1 - seg(T, 5.0, 5.083)); // (on twos: full, then one frame at about 70 %, then gone)
  ov.push(CARD(1));
  // (the steam fades as the cup drops out of the bottom of the frame after the tilt, so it never rises out of his beard)
  ov.push((c) => { const a = clamp((930 - sy) / 100); if (a > 0) { c.save(); c.globalAlpha = a; steam(c, sx, sy - 6, twos(t), 1.4); c.restore(); } });
  ov.push((c) => sfx(c, "SIGH...", hx + 330, hy - 40, 104, T - SIGH, { life: 0.95, burst: false, fill: ["#ffffff", "#d6ccff"] }));
  ov.push((c) => thought(c, BUBX, BUBY, BUBW, BUBH, hx + 120, hy - 60, bk, (c2, w, h) => dayBubble(c2, w, h, T - BUB)));
  ov.push((c) => sfx(c, "CLICK", BUBX + BUBW / 2 - 110, BUBY + BUBH / 2 + 38, 58, T - BUB - ICON_AT[5] - 0.07, { life: 0.8, burst: false, fill: ["#ffffff", "#c9b8ff"] }));
  return { bloom: 0.6 };
});

// ---- 8d · night: one long pull-back from his lit balcony to the estate; banner, end title, disclaimer; the world fades
// to near-black while the end card stays lit ----------------------------------------------------------------------------
shot("c08 night", S4, S5, ({ t, lt, ov }) => {
  const T = twos(lt);
  place("night"); STAGE.show("c08.city", "c08.balcony", "c08.nightsky"); setNight(0.75); winMat.color.set("#ffd98a");
  animateSet(twos(t));
  B.bulbMat.emissiveIntensity = 1.9;
  const sipN = kf(T, [[0.5, 0], [1.1, 1], [1.9, 1], [2.5, 0]]);
  const tan = poseTan(seated({ headPitch: 0.1 - sipN * 0.38, squash: wob(T, 0.4) * 0.03, face: T > 1.0 && T < 1.08 ? "blink" : "happy", tilt: 0.06 }));
  holdCup(tan, REST_SIT, sipN, sipN * 0.6);
  B.bird.position.y = 0.1; B.bird.rotation.y = 0.6;
  // camera: from the balcony out to the estate, distance growing smoothly in log space; it lands exactly on c09's first
  // framing (6.6, 7, 18) → (0.5, 10.3, 0), fov 36, at 205 s (the last 2 % is a slow drift)
  const p0 = new THREE.Vector3(...W(2.2, 1.9, 5.6)), q0 = new THREE.Vector3(...W(0.1, 1.15, 0.8));
  const p1 = new THREE.Vector3(6.6, 7.0, 18.0), q1 = new THREE.Vector3(0.5, 10.3, 0);
  const k = 0.98 * ease(seg(lt, 0.25, 4.2)) + 0.02 * seg(lt, 4.2, 6);
  const d0 = p0.distanceTo(q0), d1 = p1.distanceTo(q1);
  const dir = p0.clone().sub(q0).normalize().lerp(p1.clone().sub(q1).normalize(), ease(seg(lt, 0.4, 3.6))).normalize();
  const q = q0.clone().lerp(q1, easeIn(seg(lt, 0.25, 1.4)) * 0.25 + ease(seg(lt, 0.6, 4.0)) * 0.75);
  const d = Math.exp(lerp(Math.log(d0), Math.log(d1), k));
  STAGE.cam(q.clone().add(dir.multiplyScalar(d)).toArray(), q.toArray(), lerp(38, 36, k));
  STAGE.lights("night", { sky: "#7a64e0", ground: "#1c1440", hemi: 0.95, key: "#a9b8ff", keyI: 1.1, rim: "#ff7fd0", rimI: 0.8, bg: "#1a1240",
    keyPos: [HERO_WINDOW.x - 4, HERO_WINDOW.y + 5, 6], keyTarget: [HERO_WINDOW.x, HERO_WINDOW.y - 1, 0] });
  const tk = (a) => seg(T, a, a + 0.45);
  ov.push(CARD(1, seg(T, 0, 0.35)));
  ov.push((c) => sfx(c, "cri-cri...", 1560, 860, 46, T - 0.3, { life: 1.6, burst: false, fill: ["#d6f7ff", "#7fd8ff"] }));
  // the world fades to near-black (plum) at the very end; the end card stays lit
  ov.push((c) => { const a = 0.82 * ease(seg(lt, 5.2, 6.0)); if (a > 0) { c.save(); c.fillStyle = `rgba(14,4,32,${a})`; c.fillRect(0, 0, 1920, 1080); c.restore(); } });
  // a warm halo around his lit balcony, sized by how big it is on screen; drawn over the fade so his window stays lit,
  // and eased off over the last 0.3 s, so the cut into c09 (whose estate has no halo) does not pop
  const [gx, gy] = local2scr(-0.3, 1.5, 0.6), [ex] = local2scr(2.8, 1.5, 0.6), gr = Math.max(60, Math.abs(ex - gx) * 1.6);
  const halo = 1 - ease(seg(lt, 5.65, 5.97));
  ov.push((c) => { if (halo <= 0) return; c.save(); c.globalCompositeOperation = "lighter"; c.globalAlpha = halo; const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, `rgba(255,190,110,${0.32 + 0.25 * seg(lt, 5.2, 6.0)})`); g.addColorStop(0.5, "rgba(255,150,90,.12)"); g.addColorStop(1, "rgba(255,120,80,0)");
    c.fillStyle = g; c.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); c.restore(); });
  // the end card: banner, title (its small label drawn by us, clear of the big letters), subtitle, disclaimer
  ov.push((c) => banner(c, "IN TWO WEEKS, HE GOES BACK, WITH HIS QUESTIONS READY.", 960, 112, tk(0.9), { size: 32 }));
  ov.push((c) => title(c, "", "MR TAN", 960, 322, tk(1.75), { size: 180 }));
  ov.push((c) => titleLabel(c, "A day in the life of", 960, 322, tk(1.75), 180));
  ov.push((c) => subtitle(c, "Ripple · between two visits", 960, 466, tk(2.15)));
  ov.push((c) => disclaimer(c, DISCLAIMER, 960, 950, tk(2.35))); // four lines: centred a little higher
  return { bloom: 0.85 };
});
