// Chapter c09 · The problem (film 205–237 s). The bridge from the night estate into the Ripple lab, then three problem
// cards, each a yellow caption with its source in small print:
//   205–210   the night estate; the camera flies into his lit window; in the lab the lights snap on (CLICK); HOW RIPPLE WORKS
//   210–218   Card 1: he squints at a big English label; the words swim (Duke-NUS, 2024)
//   218–227.6 Card 2: Dr Lim says one voiced line (c09-lim, 4.93 s); then its words fly out of Mr Tan's head like
//             birds, out of the window (Kessels 2003). The whole card is one film window: 218.0–227.6.
//   227.6–237 Card 3: a wall calendar, two visits circled, a stamp on the empty weeks (MOH, 2026)
// Caption wording follows the facts file's section 6.10 (D:/ripple-c2/film/research/second-half-facts.md).
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, clamp, lerp, backOut, hash, twos } from "../core.js";
import { sfx, bubble, banner, flashHit } from "../overlay.js";
import { caption, stamp } from "../overlay2.js";
import { canvasTex } from "../chars.js";
import { painted } from "../sets/kit.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";
import { buildCity, HERO_WINDOW } from "../sets/city.js";
import { useLab, PEDESTAL, LAB_WINDOW, holdProp, toScreen, headScreen, faceAt, clipboard } from "../sets/lab.js";
import { buildC09Props, CAL } from "../sets/c09_props.js";

const PI = Math.PI;
const lab = useLab();
const tan = STAGE.need("tan", makeTanBot), wei = STAGE.need("wei", makeWeiBot), lim = STAGE.need("lim", makeLimBot);
const props = STAGE.set("c09.props", buildC09Props());
const P = props.userData;
const clip = clipboard(); props.add(clip);

// ---- the estate at night: our own city instance, matched to c08's end card: the dawn sky and sun hidden, a night
// backdrop with a crescent moon in their place, and a window-only glow map on every block front (same seeds and density
// as c08's night, so the cut at 205 s matches). All on materials that belong to this instance only.
const city = STAGE.set("c09.city", buildCity());
const winMat = city.userData.heroWindow;
function nightSky(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#120a36"); g.addColorStop(0.45, "#2b1a6e"); g.addColorStop(0.75, "#5b2f92"); g.addColorStop(1, "#a0479a");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) { const y = hash(i * 7) * H * 0.7; c.fillStyle = `rgba(255,248,220,${0.35 + hash(i * 3) * 0.6})`; const r = hash(i * 11) > 0.92 ? 2.4 : 1.2; c.beginPath(); c.arc(hash(i * 5) * W, y, r, 0, 7); c.fill(); }
  const m = document.createElement("canvas"); m.width = m.height = 160; const mc = m.getContext("2d");
  const mg = mc.createRadialGradient(80, 80, 20, 80, 80, 80); mg.addColorStop(0, "rgba(255,240,200,.5)"); mg.addColorStop(1, "rgba(255,240,200,0)"); mc.fillStyle = mg; mc.fillRect(0, 0, 160, 160);
  mc.fillStyle = "#fff4d6"; mc.beginPath(); mc.arc(80, 80, 34, 0, 7); mc.fill();
  mc.globalCompositeOperation = "destination-out"; mc.beginPath(); mc.arc(96, 70, 30, 0, 7); mc.fill();
  c.drawImage(m, W * 0.7 - 80, H * 0.2 - 80);
  const ribbon = (y, amp, col, thick, ph) => { c.strokeStyle = col; c.lineCap = "round"; c.lineWidth = thick; c.beginPath(); for (let x = -20; x <= W + 20; x += 12) c.lineTo(x, y + Math.sin(x / 110 + ph) * amp); c.stroke(); };
  ribbon(H * 0.1, 10, "#4a2a86", 24, 0.5); ribbon(H * 0.2, 8, "#5a3296", 16, 2.2);
}
city.children.forEach((o) => { if (o.isMesh && (o.geometry.type === "CircleGeometry" || o.geometry.parameters?.width === 140)) o.visible = false; });
const sky = painted(240, 110, 1024, 470, nightSky, { unlit: true }); sky.position.set(-14, 26, -60); sky.rotation.y = 0.32; city.add(sky);
{
  const seeds = [3]; for (let s2 = 10; s2 < 60; s2++) seeds.push(s2);
  let i = 0;
  city.traverse((o) => {
    if (!(o.isMesh && Array.isArray(o.material) && o.material.length === 6)) return;
    const floors = Math.round(o.geometry.parameters.height / 0.9), cols = i === 0 ? 8 : 7, seed = seeds[i++];
    const em = canvasTex(256, Math.max(64, Math.round((256 * floors) / cols * 0.9)), (c, W, H) => {
      c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
      const fh = H / floors, cw = W / cols;
      for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
        if (hash(seed * 997 + f * 31 + k) > 0.5) continue;
        const r = hash(f + k + seed);
        c.fillStyle = r > 0.62 ? "#ffd36b" : r > 0.3 ? "#ff9ec4" : r > 0.12 ? "#ffeab8" : "#7fe3ff";
        c.fillRect(k * cw + cw * 0.2, f * fh + fh * 0.22, cw * 0.6, fh * 0.5);
      }
    });
    const old = o.material[4];
    o.material = o.material.slice();
    o.material[4] = new THREE.MeshToonMaterial({ color: old.color.clone(), map: old.map, gradientMap: old.gradientMap, emissive: new THREE.Color("#ffffff"), emissiveMap: em, emissiveIntensity: 0.75 });
  });
}
const LIT = new THREE.Color("#ffd98a");

// Poses, props and overlays move on twos (15 a second); the camera uses the plain clock (lc).
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

const T0 = 205, T_LAB = 207.3, C1 = 210.0, C2 = 218.0, C3 = 227.6, T_END = 237;
const CAP1 = "More than half of Singaporeans aged 65 and above cannot read English.";
const SRC1 = "Medication instructions are mostly English-only. Duke-NUS, 2024";
const CAP2 = "40 to 80% of what clinicians tell patients is forgotten immediately.";
const SRC2 = "Kessels, J R Soc Med 2003";
const CAP3 = "The hard part happens between two visits.";
const SRC3 = "Only 66% of Healthier SG enrollees due for a check-in in 2025 completed it. MOH, 2026";
// Card 2's beats: Dr Lim's voiced line from T_V (frame-aligned) for its fixed duration, then the flock and caption 2
const fa = (x) => Math.ceil(x * 30 - 1e-6) / 30;      // the first frame at or after x
const V_LIM = "c09-lim", V_DUR = 4.93;                  // audio/voices-v5.json
const T_V = fa(C2 + 0.25), T_VE = T_V + V_DUR;          // 218.267 – 223.197
const T_FLOCK = C2 + 5.45;                               // 0.25 s after his line ends
const T_CAP1 = C1 + 0.4, T_CAP2 = T_FLOCK + 0.1, T_CAP3 = C3 + 4.2;

function base(t, o = {}) {
  STAGE.show("lab", "c09.props");
  for (const k of ["label", "calendar", "pointer"]) P[k].visible = false;
  P.birds.forEach((b) => (b.visible = false));
  clip.visible = false;
  const p = o.power ?? 1;
  STAGE.lights("lab", { keyPos: [3, 6, 6], keyTarget: [0, 0.5, -0.5], keyI: lerp(0.12, 1.4, p), hemi: lerp(0.12, 1.0, p), rimI: lerp(0.1, 1.3, p), bg: p < 0.5 ? "#100828" : "#3a1f7a" });
  lab.userData.tick(t, { spin: 0.1, ...o });
}
const breathe = (t, ph = 0) => wob(t, 0.45, ph) * 0.03;
function weiClip(lt, x, z, rotY, o = {}) {
  const tick = o.tickAt != null ? kf(lt, [[o.tickAt - 0.25, 0], [o.tickAt, 1], [o.tickAt + 0.12, 0.6], [o.tickAt + 0.3, 0]]) : 0;
  STAGE.pose("wei", { x, z, rotY, armR: 0.95, armOutR: 0.15, armL: 0.75 + tick * 0.45, armOutL: -0.15 + tick * 0.1, headPitch: 0.1 + (o.look ?? 0),
    headYaw: o.yaw ?? 0, tilt: wob(lt, 0.5, 1) * 0.06, squash: breathe(lt, 2), face: o.face ?? faceAt(lt, [[0, "code"]]), ...(o.pose || {}) });
  holdProp(clip, wei, 1, [0, 0.02, 0.1], [-PI / 2 + 0.25, 0, PI]);
}
const _v = new THREE.Vector3(), _c = new THREE.Vector3();
function handWorld(actor, i) { actor.g.updateMatrixWorld(true); return actor.hands[i].getWorldPosition(new THREE.Vector3()); }
/** the label held up in his left hand, turned toward the camera position cam */
function labelInHand(cam, up = 0.2, swim = 0, tq = 0, flip = 0) {
  const h = handWorld(tan, 0);
  P.label.visible = true;
  P.label.position.set(h.x + 0.05, h.y + up, h.z + 0.06);
  P.label.rotation.set(0, Math.atan2(cam[0] - P.label.position.x, cam[2] - P.label.position.z), flip * PI);
  P.label.userData.paint(swim, tq);
}

// ---- 205–207.3 the estate at night: fly into his lit window ---------------------------------------------------
sh("c09 estate", T0, T_LAB, ({ t, lt, tc, lc, ov }) => {
  STAGE.show("c09.city");
  STAGE.lights("night", { sky: "#7a64e0", ground: "#1c1440", hemi: 0.95, key: "#a9b8ff", keyI: 1.1, rim: "#ff7fd0", rimI: 0.8, bg: "#1a1240",
    keyPos: [HERO_WINDOW.x - 4, HERO_WINDOW.y + 5, 6], keyTarget: [HERO_WINDOW.x, HERO_WINDOW.y - 1, 0] });
  winMat.color.copy(LIT);
  // from c08's last framing (the estate at night, far out) straight into his window, accelerating
  const k = easeIn(seg(lc, 0, T_LAB - T0)), k2 = ease(seg(lc, 0, 1.3));
  const pos = [lerp(6.6, HERO_WINDOW.x + 0.02, k), lerp(7.0, HERO_WINDOW.y, k), lerp(18.0, HERO_WINDOW.z + 0.16, k)];
  STAGE.cam(pos, [lerp(0.5, HERO_WINDOW.x, k2), lerp(10.3, HERO_WINDOW.y, k2), 0], lerp(36, 30, k));
  // out of c08's near-black end, then the window's gold fills the frame
  ov.push((c) => { const a = 0.82 * (1 - ease(seg(lc, 0, 0.5))); if (a > 0) { c.save(); c.fillStyle = `rgba(14,4,32,${a})`; c.fillRect(0, 0, 1920, 1080); c.restore(); } });
  // c08 ends on a warm halo round his lit window, drawn over its fade; carry the same halo across the cut (same centre,
  // size rule and strength), then let it give way to the window's gold as the camera flies in
  ov.push((c) => {
    const [gx, gy] = toScreen(HERO_WINDOW.x - 0.09, HERO_WINDOW.y - 0.01, HERO_WINDOW.z + 0.21), [ex] = toScreen(HERO_WINDOW.x + 0.84, HERO_WINDOW.y - 0.01, HERO_WINDOW.z + 0.21);
    const gr = Math.min(900, Math.max(60, Math.abs(ex - gx) * 1.6)), a = 0.57 * (1 - 0.45 * seg(lc, 0, 0.9)) * (1 - seg(lc, 1.5, 2.1));
    if (a <= 0) return;
    c.save(); c.globalCompositeOperation = "lighter"; const g = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, `rgba(255,190,110,${a})`); g.addColorStop(0.5, `rgba(255,150,90,${0.12 * a / 0.57})`); g.addColorStop(1, "rgba(255,120,80,0)");
    c.fillStyle = g; c.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); c.restore();
  });
  ov.push((c) => sfx(c, "WHOOSH", 700, 760, 90, lt - 0.9, { life: 1.2, burst: false, fill: ["#ffffff", "#bfe8ff"] }));
  ov.push((c) => { const a = seg(lc, 1.95, 2.3); if (a > 0) { c.save(); c.globalAlpha = a; c.fillStyle = "#ffd98a"; c.fillRect(0, 0, 1920, 1080); c.restore(); } });
  return { bloom: 0.8 };
});

// ---- 207.3–210 inside: dark, CLICK, the lab lights snap on; the trio waves; HOW RIPPLE WORKS -------------------
const T_CLICK = T_LAB + 0.4;
sh("c09 lights", T_LAB, C1, ({ t, lt, tc, lc, ov }) => {
  const d = tc - T_CLICK;
  const power = d < 0 ? 0.04 : d < 0.06 ? 1 : d < 0.13 ? 0.35 : 1;
  base(t, { power, spin: 0.1 });
  const on = t > T_CLICK;
  const wave = t > T_CLICK + 0.6 ? lt * 1.4 : null;
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top + (on && t < T_CLICK + 0.35 ? Math.sin(seg(t, T_CLICK, T_CLICK + 0.35) * PI) * 0.12 : 0), rotY: 0.05,
    face: faceAt(t - T_LAB, [[0, "sleepy"], [T_CLICK - T_LAB + 0.05, "wow"], [T_CLICK - T_LAB + 0.9, "happy"]]), wave, squash: on && t < T_CLICK + 0.12 ? -0.25 : breathe(lt), tilt: wob(lt, 0.6) * 0.06 });
  weiClip(lt, -1.95, 0.9, 0.45, { face: faceAt(t - T_LAB, [[0, "sleepy"], [T_CLICK - T_LAB + 0.08, "wow"], [T_CLICK - T_LAB + 1.0, "happy"]]), pose: { armL: wave != null ? 2.6 + wob(lt, 1.6) * 0.3 : 0.75, armOutL: wave != null ? 0.4 : -0.15 } });
  STAGE.pose("lim", { x: 1.95, z: 0.85, rotY: -0.45, wave: t > T_CLICK + 0.75 ? lt * 1.3 + 1 : null, face: faceAt(t - T_LAB, [[0, "sleepy"], [T_CLICK - T_LAB + 0.1, "wow"], [T_CLICK - T_LAB + 1.1, "happy"]]), squash: breathe(lt, 1) });
  const k = easeOut(seg(lc, 0, C1 - T_LAB));
  STAGE.cam([lerp(0.6, 0.25, k), lerp(2.5, 1.7, k), lerp(8.8, 5.7, k)], [0, lerp(1.0, 1.15, k), 0], 38);
  // through the gold into the dark lab quickly: a slow fade of gold over the dark room reads as a muddy beige
  ov.push((c) => { const a = 1 - seg(lc, 0, 0.1); if (a > 0) { c.save(); c.globalAlpha = a; c.fillStyle = "#ffd98a"; c.fillRect(0, 0, 1920, 1080); c.restore(); } });
  ov.push((c) => flashHit(c, d, "#ffffff", 3));
  ov.push((c) => sfx(c, "CLICK!", 380, 300, 100, d - 0.07, { life: 1.0 }));
  ov.push((c) => banner(c, "HOW RIPPLE WORKS", 960, 90, Math.min(seg(t, T_CLICK + 0.3, T_CLICK + 0.6), 1), { size: 40 }));
  return { bloom: 0.55 };
});

// ---- Card 1 · the English label (210–218) ---------------------------------------------------------------------
const cap1 = (t) => (c) => caption(c, CAP1, 70, 60, seg(t, T_CAP1, T_CAP1 + 0.35), { source: SRC1, size: 44, maxW: 900 });
// 1a · he holds the label up beside his head, squints, pulls it close, pushes it far: ??
sh("c09 label", C1, C1 + 2.8, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  const far = kf(lt, [[1.3, 0], [1.5, -0.25], [1.8, 1]], backOut);
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: -0.15, armL: lerp(2.15, 1.55, far), armOutL: lerp(0.35, 0.7, far), armR: 0.3, armOutR: 0.15,
    headYaw: 0.55 - far * 0.1, headPitch: -0.05 - far * 0.08, lean: lerp(0.12, -0.08, far), tilt: 0.12 + wob(lt, 0.8) * 0.04,
    face: faceAt(lt, [[0, "code"], [0.4, "think"], [1.25, "worry"]]), squash: breathe(lt) });
  const k = ease(seg(lc, 0, 2.8));
  const cam = [lerp(0.95, 0.85, k), lerp(1.62, 1.58, k), lerp(3.25, 2.9, k)];
  STAGE.cam(cam, [lerp(-0.4, -0.38, k), 1.42, 0], 38);
  labelInHand(cam, 0.16, seg(lt, 0.3, 1.6) * 0.55 + far * 0.25, t);
  ov.push((c) => banner(c, "HOW RIPPLE WORKS", 960, 90, 1 - seg(t, C1, C1 + 0.27), { size: 40 })); // gone before caption 1 slides in
  ov.push(cap1(t));
  ov.push((c) => { const [x, y] = headScreen(tan, 0.72); sfx(c, "??", x - 40, y - 20, 100, lt - 1.25, { life: 1.3, burst: "#e9dcff", dots: "rgba(155,107,255,.35)" }); });
  return { bloom: 0.45 };
});

// 1b · close on the label: the letters swim and scramble
sh("c09 label close", C1 + 2.8, C1 + 5.6, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  const bob = wob(lt, 0.7) * 0.1;
  const tanClose = (b) => STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: -0.15, armL: 1.8 + b, armOutL: 0.55, armR: 0.3, headYaw: 0.5, headPitch: -0.05, lean: 0.1 + b * 0.5, tilt: 0.15 + wob(lt, 0.9) * 0.06,
    face: faceAt(lt, [[0, "worry"], [1.2, "think"], [2.1, "sad"]]), squash: breathe(lt) });
  // the camera frames where the label is at rest (no bob), so it moves on the plain clock instead of jumping on twos;
  // pulled back enough that the whole label stays inside the frame with his visor beside it
  tanClose(0);
  const h = handWorld(tan, 0);
  const lp = [h.x + 0.05, h.y + 0.16, h.z + 0.06];
  tanClose(bob);
  const k = ease(seg(lc, 0, 2.8));
  const cam = [lp[0] + lerp(0.12, 0.04, k), lp[1] - 0.03, lp[2] + lerp(1.32, 1.14, k)];
  STAGE.cam(cam, [lp[0] - 0.22, lp[1] - 0.05, lp[2]], 38);
  labelInHand(cam, 0.16, 0.8 + seg(lt, 0, 2.2) * 0.8, t);
  ov.push(cap1(t));
  ov.push((c) => sfx(c, "WOBBLE", 1500, 860, 70, lt - 0.3, { life: 1.4, burst: false, fill: ["#e9dcff", "#9b6bff"] }));
  ov.push((c) => sfx(c, "HUH??", 520, 820, 80, lt - 1.4, { life: 1.2, burst: "#ffe37a" }));
  return { bloom: 0.4 };
});

// 1c · he turns it upside down (FLIP); no better; he shrugs (2.4 s since v5: card 2 took 0.4 s of it; this shot is
// not in the film's cut, which ends card 1 at 215.6)
sh("c09 shrug", C1 + 5.6, C2, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  const flipK = backOut(seg(lt, 0.3, 0.62), 1.6);
  const shrug = kf(lt, [[1.2, 0], [1.32, -0.15], [1.6, 1]], backOut);
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top + shrug * 0.03, rotY: -0.1, armL: lerp(1.75, 0.6, shrug), armOutL: lerp(0.55, 1.05, shrug), armR: lerp(0.3, 0.6, shrug), armOutR: lerp(0.15, 1.05, shrug),
    headYaw: lerp(0.5, 0, shrug), headPitch: -0.12 * shrug, tilt: shrug * 0.15, squash: lt > 1.55 && lt < 1.7 ? -0.2 : breathe(lt),
    face: faceAt(lt, [[0, "think"], [0.7, "worry"], [1.3, "sad"]]) });
  weiClip(lt, -1.95, 0.9, 0.45, { yaw: 0.3, face: faceAt(lt, [[0, "code"], [1.4, "worry"]]) });
  // Dr Lim waits just outside this framing (from here he showed only as a sliver at the right edge)
  STAGE.pose("lim", { x: 2.75, z: 0.85, rotY: -0.45, armL: 0.3, armR: 0.3, headYaw: -0.2, face: faceAt(lt, [[0, "code"], [1.5, "worry"]]), squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, C2 - C1 - 5.6));
  const cam = [lerp(0.55, 0.4, k), lerp(1.7, 1.66, k), lerp(4.7, 4.25, k)];
  STAGE.cam(cam, [lerp(-0.75, -0.7, k), 1.3, 0], 38);
  labelInHand(cam, 0.16, 1.2, t, flipK);
  ov.push(cap1(t));
  ov.push((c) => sfx(c, "FLIP", 1450, 380, 70, lt - 0.3, { life: 0.9, burst: false, fill: ["#ffffff", "#ffd94a"] }));
  ov.push((c) => { const [x, y] = headScreen(tan, 0.7); sfx(c, "SIGH...", x + 230, y + 40, 64, lt - 1.45, { life: 0.95, burst: false, fill: ["#cfd6ff", "#9b8cff"] }); });
  return { bloom: 0.45 };
});

// ---- Card 2 · forgotten right away (218.0–227.6; one film window) ----------------------------------------------
// One voiced line (c09-lim, 4.93 s; its phrases 0.03–3.61 and 4.21–4.88), the bubble up for exactly that long; then
// its words fly out of Mr Tan's head (T_FLOCK) and caption 2 lands; then his empty head.
const LIM_LINE = ["Mr Tan, we will increase the amlodipine", "to 10 milligrams every morning."];
const cap2 = (t) => (c) => caption(c, CAP2, 70, 60, seg(t, T_CAP2, T_CAP2 + 0.35), { source: SRC2, size: 44, maxW: 900 });
// 2a · Dr Lim says it; Mr Tan nods along, happy; Dr Lim stops when the line ends
sh("c09 talk", C2, C2 + 5.35, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  const sp = t - T_V;                                    // time into his line (on twos)
  const talk = sp >= 0 && sp < V_DUR;
  // gesture strength: full in the first phrase, a breath in the pause, and "every morning" lands on a raised finger
  const g = !talk ? 0 : sp < 3.61 ? 1 : 0.3;
  const finger = kf(sp, [[4.1, 0], [4.25, -0.1], [4.45, 1], [4.95, 1], [5.25, 0]], backOut);
  const pre = kf(lt, [[0, 0], [0.22, 1]], ease) * (sp < 0 ? 1 : 0);
  const after = ease(seg(sp, V_DUR, V_DUR + 0.3));
  STAGE.pose("lim", { x: 1.6, z: 1.0, rotY: -1.0,
    armL: lerp(0.6 + Math.max(0, wob(sp, 1.3)) * 0.9 * g + pre * 0.25, 0.4, after), armOutL: 0.3,
    armR: lerp(0.5 + Math.max(0, wob(sp, 1.3, PI)) * 0.8 * g, 0.4, after) + finger * 1.45, armOutR: 0.3 - finger * 0.15,
    headPitch: -0.12 + (talk ? wob(sp, 2.2) * 0.05 * Math.max(g, finger) : 0), tilt: talk ? wob(sp, 1.6) * 0.08 * g : wob(lt, 0.5) * 0.03,
    squash: talk ? Math.abs(wob(sp, 2.6)) * 0.05 * Math.max(g, finger) : pre > 0 ? -0.04 * pre : breathe(lt, 1),
    face: faceAt(lt, [[0, "code"], [T_V - C2 + 1.4, "happy"], [T_V - C2 + 3.0, "code"], [T_VE - C2 + 0.05, "happy"]]) });
  // Mr Tan nods along, happy; one big nod (OK!) right after the line
  const okNod = kf(sp, [[V_DUR + 0.02, 0], [V_DUR + 0.15, 0.32], [V_DUR + 0.38, 0]], ease);
  const nod = talk ? Math.max(0, wob(sp, 0.9)) * 0.12 : 0;
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: 0.55, headPitch: nod + okNod, headYaw: 0.15, tilt: wob(lt, 0.45) * 0.04,
    face: faceAt(lt, [[0, "code"], [T_V - C2 + 0.5, "happy"]]), squash: okNod > 0.2 ? -0.08 : breathe(lt), armL: 0.2, armR: 0.2 });
  weiClip(lt, -1.95, 0.9, 0.5, { yaw: 0.4 });
  const k = ease(seg(lc, 0, 5.35));
  STAGE.cam([lerp(-0.6, -0.42, k), lerp(1.55, 1.52, k), lerp(4.4, 3.85, k)], [lerp(0.6, 0.62, k), 1.35, 0.3], 38);
  ov.push((c) => { const [hx, hy] = headScreen(lim, 0.55); voiced(c, LIM_LINE, 1330, 150, hx, hy, tc, T_V, V_DUR, { size: 36, voice: V_LIM }); });
  return { bloom: 0.45 };
});

// 2b · the words fly out of his head like a flock of birds, out of the window: FLAP FLAP
const FLIGHT = 1.8, STAGGER = 0.17;
const curves = P.birds.map((b, i) => {
  const j = (n) => (hash(i * 13 + n) - 0.5);
  // fanned out (alternate birds go high and low) so the cards do not stack on each other
  const lane = (i % 3) - 1;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0 + j(1) * 0.1, PEDESTAL.top + 1.42, 0.05),
    new THREE.Vector3(-0.5 + lane * 0.55 + j(2) * 0.4, PEDESTAL.top + 1.7 + lane * 0.22 + j(3) * 0.12, 0.4 - lane * 0.55 + j(4) * 0.3),
    new THREE.Vector3(-2.7 + lane * 0.6 + j(5) * 0.4, 2.45 + lane * 0.3 + j(6) * 0.12, -1.4 - lane * 0.5 + j(7) * 0.3),
    new THREE.Vector3(LAB_WINDOW.x + j(8) * 0.9, LAB_WINDOW.y + j(9) * 0.6, LAB_WINDOW.z + 0.1),
    new THREE.Vector3(LAB_WINDOW.x - 0.4, LAB_WINDOW.y + 0.2, LAB_WINDOW.z - 1.2),
  ]);
});
function flock(t) {
  P.birds.forEach((b, i) => {
    const a = T_FLOCK + i * STAGGER, k = (t - a) / FLIGHT;
    if (k <= 0 || k >= 1) { b.visible = false; return; }
    b.visible = true;
    b.position.copy(curves[i].getPoint(ease(k)));
    b.quaternion.copy(STAGE.camera.quaternion);
    b.scale.setScalar(Math.min(1, k * 8) * 1.55);
    b.userData.flap((t - a) * 17);
  });
}
const T_EMPTY = C2 + 8.0;                                 // the last bird is out of the window at T_FLOCK + 2.48
sh("c09 birds", C2 + 5.35, T_EMPTY, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  const empty = t > T_FLOCK + 1.2;
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: 0.6, headPitch: t > T_FLOCK && t < T_FLOCK + 0.3 ? -0.2 : 0, headYaw: t > T_FLOCK + 0.4 ? -0.5 : 0,
    face: faceAt(t - T_FLOCK, [[-1, "happy"], [0, "wow"], [1.2, "off"], [2.2, "think"]]), squash: t > T_FLOCK && t < T_FLOCK + 0.15 ? -0.3 : breathe(lt),
    ear: t > T_FLOCK && t < T_FLOCK + 1.5 ? 1 : 0, tilt: empty ? wob(lt, 0.6) * 0.1 : 0 });
  STAGE.pose("lim", { x: 1.6, z: 1.0, rotY: -1.0, armL: 0.4, armR: 0.4, headYaw: t > T_FLOCK + 0.5 ? -0.6 : 0, face: faceAt(t - T_FLOCK, [[-1, "happy"], [0.3, "wow"]]), squash: breathe(lt, 1) });
  weiClip(lt, -1.95, 0.9, 0.5, { yaw: t > T_FLOCK + 0.6 ? 0.9 : 0.4, look: -0.25, face: faceAt(t - T_FLOCK, [[-1, "code"], [0.4, "wow"]]) });
  const k = ease(seg(lc, 0, T_EMPTY - C2 - 5.35));
  STAGE.cam([lerp(0.95, 0.8, k), lerp(1.75, 1.85, k), lerp(4.1, 3.7, k)], [lerp(-1.7, -2.0, k), lerp(1.55, 1.7, k), lerp(-1.1, -1.4, k)], 40);
  flock(t);
  ov.push(cap2(t));
  ov.push((c) => { const [x, y] = headScreen(tan, 0.75); sfx(c, "FLAP FLAP", x + 300, y - 30, 80, t - T_FLOCK - 0.3, { life: 1.3, burst: false, fill: ["#ffffff", "#bfe8ff"] }); });
  ov.push((c) => { const [x, y] = toScreen(LAB_WINDOW.x, LAB_WINDOW.y + 0.5, LAB_WINDOW.z); sfx(c, "FLAP!", x + 60, y - 60, 70, t - T_FLOCK - 1.5, { life: 1.0, burst: false, fill: ["#ffffff", "#ffd94a"] }); });
  return { bloom: 0.5 };
});

// 2c · his head is empty: he scratches it (?); Dr Lim sighs; Wei Ling writes it down (1.6 s, the card's last beat)
sh("c09 empty", T_EMPTY, C3, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  const scratch = kf(lt, [[0.05, 0], [0.2, -0.1], [0.45, 1]], backOut);
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: 0.2, armR: scratch * 2.75, armOutR: scratch * 0.3 + wob(lt, 3) * 0.06 * scratch, armL: 0.25, headYaw: -0.2, tilt: 0.18 * scratch,
    face: faceAt(lt, [[0, "think"], [1.25, "sad"]]), squash: breathe(lt) });
  const palm = kf(lt, [[0.45, 0], [0.6, -0.1], [0.8, 1]], backOut);
  STAGE.pose("lim", { x: 1.6, z: 1.0, rotY: -0.8, armL: palm * 2.45, armOutL: palm * -0.25, armR: 0.3, headPitch: palm * 0.2, face: faceAt(lt, [[0, "code"], [0.55, "blink"], [0.63, "sleepy"]]), squash: palm > 0.9 && lt < 1.0 ? 0.15 : breathe(lt, 1) });
  weiClip(lt, -1.95, 0.9, 0.5, { yaw: 0.3, look: 0.15, tickAt: 1.1, face: faceAt(lt, [[0, "code"], [0.9, "think"]]) });
  const k = ease(seg(lc, 0, C3 - T_EMPTY));
  // wide enough for all three: Wei Ling left, Mr Tan centre, Dr Lim (and his SIGH) right, nobody cut by the frame edge
  STAGE.cam([lerp(0.0, -0.05, k), lerp(1.66, 1.62, k), lerp(5.05, 4.8, k)], [lerp(-0.12, -0.1, k), 1.25, 0.2], 38);
  ov.push(cap2(t));
  ov.push((c) => { const [x, y] = headScreen(tan, 0.72); sfx(c, "?", x - 60, y - 30, 110, lt - 0.3, { life: 1.3, burst: "#e9dcff", dots: "rgba(155,107,255,.35)" }); });
  ov.push((c) => { const [x, y] = headScreen(lim, 0.65); sfx(c, "SIGH", Math.min(1760, x + 40), y - 50, 60, lt - 0.7, { life: 0.9, burst: false, fill: ["#cfd6ff", "#9b8cff"] }); });
  ov.push((c) => { const [x, y] = headScreen(wei, 0.2); sfx(c, "SCRIBBLE", x + 40, y + 120, 46, lt - 1.0, { life: 0.6, burst: false, fill: ["#ffffff", "#7dffb0"] }); });
  return { bloom: 0.45 };
});

// ---- Card 3 · between two visits (227.6–237) ------------------------------------------------------------------
const CAL_AT = new THREE.Vector3(1.3, 3.45, -3.0);     // the calendar's top rod, on the back wall
const T_UNROLL = C3 + 0.15, T_V1 = C3 + 1.0, T_V2 = C3 + 1.9, T_STAMP = C3 + 3.6;
function calendarAt(t, stamped = 0) {
  P.calendar.visible = true; P.calendar.position.copy(CAL_AT); P.calendar.rotation.set(0, 0, 0);
  P.calendar.userData.unroll(backOut(seg(t, T_UNROLL, T_UNROLL + 0.4), 1.4));
  P.calendar.userData.paint(seg(t, T_V1, T_V1 + 0.4), seg(t, T_V2, T_V2 + 0.4), stamped);
}
const calWorld = ([u, v]) => P.calendar.userData.uv(u, v).add(CAL_AT);
const cap3 = (t) => (c) => caption(c, CAP3, 70, 60, seg(t, T_CAP3, T_CAP3 + 0.35), { source: SRC3, size: 46, maxW: 1150 });
// the stamp thumps in as a 2D overlay in the close-up (3b); in the pull-back (3c) it is printed on the paper itself
const gapStamp = (t) => (c) => { const g = calWorld(P.calendar.userData.gapUV); const [x, y] = toScreen(g.x, g.y, g.z); stampSafe(c, "BETWEEN TWO VISITS", x, y, t - T_STAMP, { size: 84, rot: -0.09 }); };
/** Dr Lim's pointer in his right hand, swung from hanging (k = 0) to pointing straight at the world point `at` (k = 1) */
const _q1 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function pointAt(at, k) {
  holdProp(P.pointer, lim, 1, [0, -0.05, 0.02], [PI, 0, 0]);
  _dir.copy(at).sub(P.pointer.position).normalize();
  _q1.setFromUnitVectors(_up, _dir);
  P.pointer.quaternion.slerp(_q1, clamp(k));
}

// 3a · the calendar unrolls (WHUMP); Dr Lim points: the two visits get circled (SQUEAK, SQUEAK)
sh("c09 calendar", C3, C3 + 3.0, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  calendarAt(t);
  const aim = t < T_V2 - 0.3 ? 0 : 1;
  const up = kf(lt, [[0.5, 0.3], [0.65, 0.15], [0.95, 1]], backOut);
  STAGE.pose("lim", { x: 1.7, z: -1.75, rotY: -0.25, armR: 0.3 + up * (aim ? 1.6 : 2.1), armOutR: up * (aim ? 0.9 : 1.15), armL: 0.3, headYaw: 0.5, headPitch: -0.2,
    face: faceAt(lt, [[0, "code"], [0.9, "happy"]]), squash: Math.abs(t - T_V1) < 0.08 || Math.abs(t - T_V2) < 0.08 ? 0.15 : breathe(lt, 1) });
  // the pointer aims at the visit being circled (the first, then the second)
  pointAt(calWorld(P.calendar.userData.visitUV[aim]), seg(up, 0.3, 0.9));
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: 0.35, headYaw: 0.75, headPitch: -0.15, face: faceAt(lt, [[0, "code"], [0.3, "wow"], [1.2, "think"]]), squash: breathe(lt) });
  weiClip(lt, -1.95, 0.9, 0.5, { yaw: 0.9, look: -0.2 });
  const k = ease(seg(lc, 0, 3.0));
  STAGE.cam([lerp(0.4, 0.6, k), lerp(1.8, 1.85, k), lerp(5.6, 5.1, k)], [lerp(0.75, 0.85, k), 1.95, -2.0], 40);
  ov.push((c) => { const [x, y] = toScreen(CAL_AT.x, CAL_AT.y - 0.3, CAL_AT.z); sfx(c, "WHUMP!", x + 520, y - 30, 80, t - T_UNROLL - 0.3, { life: 1.0, burst: "#fff6e4" }); });
  // SQUEAK beside each circle: above the first (on the header band), left of the second (clear of the week above)
  P.calendar.userData.visitUV.forEach((uv, i) => ov.push((c) => { const p = calWorld(uv); const [x, y] = toScreen(p.x, p.y, p.z); sfx(c, "SQUEAK", i ? x - 150 : x + 40, i ? y + 10 : y - 80, 56, t - (i ? T_V2 : T_V1) - 0.2, { life: 0.9, burst: false, fill: ["#ffffff", "#ff8a9a"] }); }));
  return { bloom: 0.45 };
});

// 3b · close on the empty weeks between them: the stamp lands (THUNK)
sh("c09 gap", C3 + 3.0, C3 + 5.8, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  calendarAt(t);
  const k = ease(seg(lc, 0, 2.8));
  const punch = tc > T_STAMP && tc < T_STAMP + 0.15 ? 0.06 : 0;
  // framed so the whole sheet sits below the caption and its source strip (top rod under y ≈ 200) and above the
  // bottom edge
  STAGE.cam([CAL_AT.x - 0.4 + lerp(0.12, 0.05, k), CAL_AT.y - 0.9, CAL_AT.z + lerp(4.35, 4.05, k) - punch], [CAL_AT.x - 0.42, CAL_AT.y - 0.9, CAL_AT.z], 40);
  ov.push((c) => flashHit(c, tc - T_STAMP, "#fff3b0", 3));
  ov.push(gapStamp(t));
  ov.push((c) => sfx(c, "THUNK!", 1560, 860, 90, t - T_STAMP - 0.08, { life: 1.1, burst: "#ffe37a" }));
  ov.push(cap3(t));
  return { bloom: 0.4 };
});

// 3c · pull back: the three of them in front of it
sh("c09 between", C3 + 5.8, T_END, ({ t, lt, tc, lc, ov }) => {
  base(t, { spin: 0.1 });
  calendarAt(t, 1);
  const turn = ease(seg(lt, 1.6, 2.1));
  STAGE.pose("tan", { x: 0, z: 0, dy: PEDESTAL.top, rotY: lerp(0.35, 0.1, turn), headYaw: lerp(0.75, 0.0, turn), headPitch: lerp(-0.15, 0, turn), face: faceAt(lt, [[0, "think"], [1.9, "code"]]), squash: breathe(lt), tilt: wob(lt, 0.5) * 0.05,
    armL: 0.2 + turn * 0.25, armR: 0.2 });
  // Wei Ling a step nearer the pedestal, so the pull-back brings her fully into the frame (not a sliver at its edge)
  weiClip(lt, -1.55, 0.7, 0.45, { yaw: lerp(0.9, 0.2, turn), look: -0.1, face: faceAt(lt, [[0, "think"], [2.0, "code"]]) });
  STAGE.pose("lim", { x: 1.7, z: -1.75, rotY: -0.25, armL: 0.3, armR: 0.3, headYaw: lerp(0.5, 0, turn), face: faceAt(lt, [[0, "code"]]), squash: breathe(lt, 1) });
  const k = ease(seg(lc, 0, T_END - C3 - 5.8));
  STAGE.cam([lerp(0.75, 0.6, k), lerp(2.0, 1.85, k), lerp(3.6, 5.5, k)], [lerp(1.05, 0.95, k), lerp(2.15, 1.95, k), -2.0], 40);
  ov.push(cap3(t));
  return { bloom: 0.45 };
});
