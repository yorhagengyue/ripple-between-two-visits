// Chapter 1 · Morning (film 0–15 s). The estate at dawn and the title; 7:00, the alarm; Mr Tan in bed hits it; he gets
// up and stretches. Replicates the reference's opening (city push-in and title, BEEP! BEEP! clock close-up, BONK, YAAAWN).
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, pop, ease, easeOut, clamp, lerp } from "../core.js";
import { timeCard, sfx, title, banner, ring, flashHit } from "../overlay.js";
import { buildCity, HERO_WINDOW } from "../sets/city.js";
import { buildBedroom } from "../sets/bedroom.js";
import { makeTanBot } from "../bots.js";
import { canvasTex } from "../chars.js";

const city = STAGE.set("c01.city", buildCity());
const bedroom = STAGE.set("c01.bedroom", buildBedroom());
STAGE.need("tan", makeTanBot);
const winMat = city.userData.heroWindow;
const clock = bedroom.userData.clock, blanket = bedroom.userData.blanket, fold = bedroom.userData.fold, knees = bedroom.userData.knees;
const DARK = new THREE.Color("#3a2a7a"), LIT = new THREE.Color("#ffd98a").multiplyScalar(1.45); // lit: bright enough to bloom
// His window has to be the one that lights up. On this chapter's own city instance only (c08 and c09 build their own),
// the hero block's lit windows around his go dark, and his window gets a warm halo and his silhouette (cat ears, beard)
// rising into it after the light comes on.
{
  let hero = null; city.traverse((o) => { if (!hero && o.isMesh && Array.isArray(o.material) && o.material.length === 6) hero = o; });
  const map = hero.material[4].map, cv = map.image, c = cv.getContext("2d"), fh = cv.height / 11, cw = cv.width / 8;
  for (let f = 1; f <= 3; f++) for (let k = 3; k <= 7; k++) {
    if (f === 2 && k === 5) continue; // his
    const x = k * cw + cw * 0.2, y = f * fh + fh * 0.22, w = cw * 0.6, h = fh * 0.5;
    c.fillStyle = "#a99af2"; c.fillRect(x - 1, y - 1, w + 2, h + 2); c.fillStyle = "rgba(60,40,130,.32)"; c.fillRect(x, y, w, h);
  }
  map.needsUpdate = true;
}
const halo = (() => {
  const t = canvasTex(128, 128, (c, W) => { const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, "rgba(255,226,150,.9)"); g.addColorStop(0.35, "rgba(255,200,120,.35)"); g.addColorStop(1, "rgba(255,190,120,0)"); c.fillStyle = g; c.fillRect(0, 0, W, W); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.position.copy(HERO_WINDOW).add(new THREE.Vector3(0, 0, 0.03)); m.renderOrder = 2; city.add(m); return m;
})();
const silhouette = (() => {
  const t = canvasTex(128, 128, (c) => {
    c.fillStyle = "#4a2f6e";
    c.beginPath(); c.roundRect(30, 46, 68, 56, 18); c.fill();                                   // head
    c.beginPath(); c.moveTo(36, 60); c.lineTo(42, 22); c.lineTo(60, 50); c.fill();              // ears
    c.beginPath(); c.moveTo(92, 60); c.lineTo(86, 22); c.lineTo(68, 50); c.fill();
    c.fillRect(22, 62, 12, 22); c.fillRect(94, 62, 12, 22);                                     // headphones
    c.beginPath(); c.ellipse(64, 104, 26, 18, 0, 0, 7); c.fill();                              // beard
    c.beginPath(); c.roundRect(34, 104, 60, 24, 10); c.fill();                                  // shoulders
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.47), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  m.position.copy(HERO_WINDOW).add(new THREE.Vector3(0, 0, 0.004)); m.renderOrder = 3; city.add(m); return { m, t }; // drawn after the additive halo, so it stays dark
})();

const T0 = 0;
const CARD = (lt0) => (c) => timeCard(c, "7:00 AM", "Rise and shine", seg(lt0, 0, 0.45));
const twos = (t) => Math.floor(t * 15 + 1e-6) / 15; // poses on twos, like core.js's, safe from rounding at frame times
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** the bedroom's movable props, set in every bedroom shot: inBed = the thick blanket over his lap (the bed shot) */
function bedProps(inBed) {
  if (inBed) { blanket.position.set(0, 0.59, 0.29); blanket.scale.set(1, 1.85, 1.02); fold.visible = false; } // (the fold strip floated off the thick blanket's rounded edge)
  else { blanket.position.set(0, 0.52, 0.28); blanket.scale.set(1, 1, 1); fold.visible = true; }
  knees.visible = inBed; knees.position.set(0.3, 0.66, -0.2); knees.rotation.set(0, 0.3, 0); knees.scale.set(0.72, 0.9, 0.7);
}
/** a soft violet glow on screen around the phone while it rings */
function phoneGlow(c, x, y, age) {
  if (age < 0) return;
  const a = Math.min(1, age / 0.08) * (0.55 + 0.25 * Math.abs(Math.sin(age * 22)));
  c.save(); c.globalCompositeOperation = "lighter";
  const g = c.createRadialGradient(x, y, 0, x, y, 110); g.addColorStop(0, `rgba(200,170,255,${0.55 * a})`); g.addColorStop(1, "rgba(200,170,255,0)");
  c.fillStyle = g; c.beginPath(); c.arc(x, y, 110, 0, 7); c.fill();
  c.restore();
  // buzz lines either side
  c.save(); c.strokeStyle = "#1a1030"; c.lineWidth = 5; c.lineCap = "round";
  const f = Math.floor(age * 15) % 2;
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const r = 46 + i * 14 + f * 4; c.beginPath(); c.arc(x, y, r, s > 0 ? -0.5 : Math.PI - 0.5, s > 0 ? 0.5 : Math.PI + 0.5); c.stroke();
  }
  c.restore();
}

// 1a · the estate at dawn, push in toward his window; the title
shot("c01 estate", T0, T0 + 5, ({ lt, ov }) => {
  STAGE.show("c01.city");
  STAGE.lights("warm", { bg: "#ffb98a", keyPos: [-20, 18, 10], keyTarget: [0, 0, 0] });
  const k = ease(seg(lt, 0, 5));
  const pos = [lerp(9, 3.2, k), lerp(5.2, 8.4, k), lerp(26, 9.5, k)];
  const tgt = [lerp(0, HERO_WINDOW.x, k), lerp(6.5, HERO_WINDOW.y, k), 0];
  STAGE.cam(pos, tgt, 36);
  // the light comes on with a fluorescent flicker (on twos), then he rises into the window
  const lp = twos(lt), on = lp >= 2.9 && !(lp >= 2.966 && lp < 3.1) ? 1 : 0;
  winMat.color.copy(DARK).lerp(LIT, on);
  halo.visible = on > 0; halo.material.opacity = 0.75 + 0.1 * Math.sin(lt * 9);
  const rise = easeOut(seg(lp, 3.4, 3.9));
  silhouette.m.visible = rise > 0; silhouette.t.offset.y = (1 - rise) * -0.55;
  ov.push((c) => banner(c, "NTU LKCMedicine · Challenge 2 · AI Healthier Every Day", 960, 70, seg(lt, 0.2, 0.6), { size: 26 }));
  ov.push((c) => title(c, "A day in the life of", "MR TAN", 1300, 330, seg(lt, 0.7, 1.15), { size: 170 }));
  return { bloom: 0.6 };
});

// 1b · the alarm clock close-up: 7:00, BEEP! BEEP!
shot("c01 alarm", T0 + 5, T0 + 7.5, ({ lt, ov }) => {
  STAGE.show("c01.bedroom");
  STAGE.lights("warm", { keyPos: [2, 4, 3] });
  clock.userData.setTime("7:00", true);
  const shake = lt > 0.2 ? wob(lt, 9) * 0.06 : 0;
  clock.rotation.z = shake; clock.position.y = 0.5 + Math.abs(wob(lt, 9)) * 0.01;
  bedProps(false); bedroom.userData.setPhone(0, 0);
  STAGE.cam([lerp(0.15, 0.05, lt / 2.5), 0.78, -0.95], [-0.36, 0.59, -1.63], 34);
  ov.push(CARD(lt));
  ov.push((c) => sfx(c, "BEEP! BEEP!", 640, 300, 120, lt - 0.2, { life: 1.1 }));
  ov.push((c) => sfx(c, "BEEP!", 1350, 640, 90, lt - 1.35, { life: 1.0, burst: false, fill: ["#ffe37a", "#ff8a1f"] }));
  return { bloom: 0.55 };
});

// 1c · in bed: sleepy, he reaches out and hits the clock: BONK!
/** aim the bot's own left arm (arms[1]) so its hand points at a world point, blended with the pose's arm by w */
function aimLeftArm(a, target, w) {
  a.g.updateMatrixWorld(true);
  const arm = a.arms[1], d = a.body.worldToLocal(_a.copy(target)).sub(arm.position).normalize();
  const ax = Math.atan2(-d.z, -d.y), az = Math.asin(clamp(d.x, -1, 1));
  arm.rotation.x = lerp(arm.rotation.x, ax, w); arm.rotation.z = lerp(arm.rotation.z, az, w);
  a.g.updateMatrixWorld(true);
}
shot("c01 bed", T0 + 7.5, T0 + 10.5, ({ lt, ov }) => {
  STAGE.show("c01.bedroom");
  STAGE.lights("warm", { keyPos: [2, 4, 3] });
  const hit = 1.55;
  clock.userData.setTime("7:00", lt < hit + 0.05);
  clock.rotation.z = lt < hit ? wob(lt, 9) * 0.06 : wob(lt, 3) * 0.04 * Math.max(0, 1 - (lt - hit) * 2);
  clock.position.y = 0.5 - (lt > hit && lt < hit + 0.15 ? 0.015 : 0);
  // half asleep, sitting up against the headboard with the blanket over his knees; he leans over to his left and swats
  // the clock: the hand hovers over it, lifts (anticipation), slams down onto its top on the hit, rests, and goes back
  const w = kf(lt, [[0.45, 0], [1.2, 1], [hit + 0.5, 1], [2.35, 0]]);
  const lift = kf(lt, [[0.45, 0.3], [1.2, 0.12], [hit - 0.14, 0.24], [hit, 0.0], [hit + 0.2, 0.0], [hit + 0.5, 0.04], [2.35, 0.2]]);
  const side = kf(lt, [[0.45, 0], [1.2, 0.14], [hit, 0.18], [hit + 0.5, 0.14], [2.35, 0]]);
  // sitting on the mattress (its top is at 0.48 m): legs out under the blanket, the blanket's edge at his belly
  const tan = STAGE.pose("tan", { x: -0.95, z: -1.45, dy: 0.35, rotY: 0.35 + side * 0.3, sit: 1,
    face: lt < hit ? "sleepy" : lt < hit + 0.08 ? "blink" : lt < hit + 0.75 ? "happy" : lt < hit + 0.83 ? "blink" : "sleepy",
    lean: 0.05 + w * 0.06, headYaw: w * 0.12, headPitch: 0.1 - w * 0.04 + ease(seg(lt, hit + 1.0, 2.9)) * 0.2, // ...and nods off again
    tilt: lt < 1 ? wob(lt, 0.5) * 0.12 : wob(lt, 0.3) * 0.04, squash: (lt > hit && lt < hit + 0.2 ? 0.3 : 0) + wob(lt, 0.4) * 0.025 });
  tan.g.rotation.z = -side; // leaning over to his left, toward the nightstand
  bedroom.updateMatrixWorld(true);
  const top = clock.getWorldPosition(_b).add(_a.set(0, 0.2 + lift, 0)).clone();
  aimLeftArm(tan, top, w);
  bedProps(true); bedroom.userData.setPhone(0, 0);
  const k = ease(seg(lt, 0, 3));
  STAGE.cam([lerp(0.72, 0.62, k), lerp(1.36, 1.32, k), lerp(0.62, 0.48, k)], [-0.72, lerp(0.98, 1.02, k), -1.45], 36);
  // BONK beside the clock (up and to the right of it), clear of the hand landing on it; zzz above his ear
  const ck = STAGE.project(clock.getWorldPosition(_b).toArray()), hd = STAGE.project(tan.head.localToWorld(_a.set(0.38, 0.62, 0)).toArray());
  ov.push((c) => flashHit(c, lt - hit + 0.07, "#ffd6ec", 2)); // the reference's hit: a 2-frame flash, then the word
  ov.push(CARD(lt + 9));
  ov.push((c) => sfx(c, "BONK!", Math.min(ck.x + 230, 1700), ck.y - 170, 130, lt - hit, { life: 1.0, burst: "#ff6fb0", dots: "rgba(255,255,255,.35)" }));
  ov.push((c) => sfx(c, "zzz", hd.x + 60, hd.y - 40, 70, lt - 0.1, { life: 1.4, burst: false, fill: ["#cfd6ff", "#9b8cff"] }));
  return { bloom: 0.5 };
});

// 1d · he is up: stretches (YAAAWN), shuffles over to the window and rests his hands on the sill to look out; behind
//      him the phone on the nightstand lights up and buzzes (BZZT); he spins round toward it (the cut goes to 7:30)
const PHONE_AT = new THREE.Vector3(-0.13, 0.6, -1.53);
shot("c01 up", T0 + 10.5, T0 + 15, ({ lt, ov }) => {
  STAGE.show("c01.bedroom");
  STAGE.lights("warm", { keyPos: [2, 4, 3] });
  clock.userData.setTime("7:01", true); clock.rotation.z = 0; clock.position.y = 0.5;
  bedProps(false);
  const lp = twos(lt); // poses on twos, camera on plain time
  const BZ = 3.8; // the phone lights and buzzes
  const stretch = kf(lp, [[0.15, 0], [0.75, 1], [1.75, 1], [2.15, 0]]);
  const wk = seg(lp, 2.2, 3.5), we = ease(wk);
  const x = lerp(0.15, 0.95, we), z = lerp(-0.7, -1.5, we);
  // facing: the camera while he stretches, then the window; on the buzz he spins round toward the phone
  const rotY = kf(lp, [[1.95, -0.28], [2.35, 2.3], [3.35, 2.3], [3.6, Math.PI], [BZ + 0.1, Math.PI], [BZ + 0.38, 2 * Math.PI - 0.85]], ease);
  const sill = kf(lp, [[3.45, 0], [3.65, 1], [BZ + 0.08, 1], [BZ + 0.25, 0]]); // hands on the sill
  const look = kf(lp, [[3.55, 0], [3.75, 1]]) * (1 - seg(lp, BZ + 0.05, BZ + 0.2));
  const jump = lp > BZ + 0.08 && lp < BZ + 0.22 ? 1 : 0;
  const face = lp < 0.2 ? "blink" : lp < 2.0 ? (stretch > 0.4 ? "sleepy" : "blink") : lp < 2.08 ? "blink" : lp < 3.55 ? "code"
    : lp < 3.62 ? "blink" : lp < BZ + 0.05 ? "happy" : lp < BZ + 0.13 ? "blink" : "wow";
  STAGE.pose("tan", { x, z, rotY, walk: wk > 0 && wk < 1 ? lp * 11 : 0,
    armL: Math.max(stretch * 2.9, sill * 1.8), armR: Math.max(stretch * 2.9, sill * 1.8), armOutL: stretch * 0.25 + sill * 0.05, armOutR: stretch * 0.25 + sill * 0.05,
    squash: -stretch * 0.45 + wob(lt, 0.45) * 0.025 + (jump ? -0.25 : 0), dy: jump ? 0.05 : 0, lean: sill * 0.08,
    face, ear: lp > BZ + 0.08 ? 1 : 0, headPitch: -stretch * 0.25 + look * 0.16, headYaw: lp > BZ + 0.05 ? -0.45 : 0, // the head leads the turn, toward the phone
    tilt: wob(lt, 0.6) * 0.05 * (1 - stretch) });
  STAGE.get("tan").g.rotation.x = 0;
  const lit = lp >= BZ ? 1 : 0, buzz = lp >= BZ && lp < BZ + 0.6 ? wob(lp, 7.5) : 0;
  bedroom.userData.setPhone(lit, buzz);
  // camera: in front of him for the stretch, then swinging left as he goes right, so it ends looking past the nightstand
  // (the phone, left of centre) to the window (right of centre) with his visor three-quarters to us when he turns
  const k = ease(seg(lt, 1.6, 4.0)), k0 = easeOut(seg(lt, 0, 4.5));
  STAGE.cam([lerp(-0.45, -0.72, k), lerp(1.12, 1.18, k), lerp(1.75, 0.62, k) - k0 * 0.1], [lerp(0.12, 0.38, k), lerp(0.8, 0.84, k), lerp(-0.7, -1.5, k)], 40);
  const ph = STAGE.project(PHONE_AT.toArray()), hd = STAGE.project(STAGE.get("tan").head.localToWorld(_a.set(0, 0.85, 0)).toArray());
  ov.push(CARD(lt + 9));
  ov.push((c) => sfx(c, "YAAAWN", Math.min(hd.x + 330, 1650), clamp(hd.y + 40, 120, 600), 110, lp - 0.5, { life: 1.5, burst: false, fill: ["#bfe8ff", "#5aa8ff"] }));
  ov.push((c) => phoneGlow(c, ph.x, ph.y, lp - BZ));
  ov.push((c) => ring(c, ph.x, ph.y, 70, lp - BZ, { col: "#c9b6ff", life: 0.6 }));
  ov.push((c) => ring(c, ph.x, ph.y, 70, lp - BZ - 0.3, { col: "#c9b6ff", life: 0.6 }));
  ov.push((c) => sfx(c, "BZZT", ph.x + 175, ph.y - 70, 80, lp - BZ - 0.03, { life: 0.7, burst: false, fill: ["#f1e8ff", "#9b6bff"], rot: -0.12 }));
  return { bloom: 0.5 };
});
