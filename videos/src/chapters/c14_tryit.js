// Chapter c14 · Try it (film 430–440 s). The trio waves from the lab's pedestal (the wall screen behind them shows the
// Ripple logo); then Ripple's logo on its own tile beside the address card with the QR code, "Ripple · between two
// visits" and the team line; the last 3 s hold.
//   430–433.4 the three of them hop and wave on the turntable (BOING, TA-DA!)
//   433.4–440 pull back: banner, the logo tile pops and the logo draws itself on (433.8–434.9, as at the opening),
//             URL card with the QR code beside it, team line; held still from 437
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, lerp, backOut, twos, clamp } from "../core.js";
import { sfx, banner, flashHit, INK } from "../overlay.js";
import { urlCard, PAPER } from "../overlay2.js";
import { image } from "../media.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";
import { useLab, PEDESTAL, faceAt, headScreen, drawLogo, logoScreen } from "../sets/lab.js";

const lab = useLab();
STAGE.need("tan", makeTanBot); STAGE.need("wei", makeWeiBot); STAGE.need("lim", makeLimBot);
const tan = STAGE.get("tan");

const T0 = 430, T_CARD = 433.4, T_HOLD = 437, T_END = 440;
const URL = "app.ripple-health-ai.com";
// v7 (owner 16 Oct): the web version is a demo for the challenge; the product ships as an iOS app
const NOTE = ["A web demo built for this challenge.", "The product will ship as an iOS app."];
const TEAM = "Team YoRHa2 · NTU LKCMedicine Challenge 2";
const T_HOP = T0 + 0.45;
// the end-card row, centred: the logo tile (the app icon's rounded square), a gap, the 980 x 260 URL card
const TILE = 260, GAP = 28, CARD_W = 980, ROW_Y = 790;
const ROW_X0 = 960 - (TILE + GAP + CARD_W) / 2, TILE_X = ROW_X0 + TILE / 2, CARD_X = ROW_X0 + TILE + GAP + CARD_W / 2;
const T_TILE = T_CARD + 0.3, T_DRAW = T_CARD + 0.42;

const sh = (name, a, b, fn) => shot(name, a, b, (o) => fn({ ...o, t: a + twos(o.lt), lt: twos(o.lt), tc: o.t, lc: o.lt }));
const breathe = (t, ph = 0) => wob(t, 0.45, ph) * 0.03;

// the wall screen behind the trio: the Ripple logo lifted, a little smaller and slid right of the lab's idle screen, so
// Dr Lim's ears never cut into the word "ripple" from these cameras
const SCREEN = ["logo-c14", logoScreen(0.4, 0.66, 0.6)];

function base(t) {
  STAGE.show("lab");
  STAGE.lights("lab", { keyPos: [2, 6, 6], keyTarget: [0, 0.5, -0.5], keyI: 1.45 });
  lab.userData.tick(t, { spin: 0.1, gauge: 0.85 + wob(t, 0.3) * 0.05, screen: SCREEN });
}
/** the three of them on the turntable; wave speed eases off into the hold */
function trio(t) {
  const hop = (d) => (t > T_HOP + d && t < T_HOP + d + 0.42 ? Math.sin(((t - T_HOP - d) / 0.42) * Math.PI) * 0.28 : 0);
  const land = (d) => (t > T_HOP + d + 0.42 && t < T_HOP + d + 0.55 ? 0.3 : t > T_HOP + d - 0.14 && t < T_HOP + d ? 0.22 : 0);
  const calm = 1 - 0.6 * seg(t, T_HOLD - 0.5, T_HOLD + 0.5);
  const lt = t - T0;
  const face = (d) => (t > T0 + 4.6 + d * 4 && t < T0 + 4.68 + d * 4) || (t > T0 + 7.4 + d * 3 && t < T0 + 7.48 + d * 3) ? "blink" : faceAt(lt, [[0, "code"], [T_HOP - T0 + d, "happy"]], 0);
  STAGE.pose("wei", { x: -0.78, z: 0.12, dy: PEDESTAL.top + hop(0.08), rotY: 0.18, wave: lt * 1.5 * calm + 0.7, armL: 0.3, face: face(0.08), squash: land(0.08) || breathe(lt, 2), tilt: wob(lt, 0.7, 2) * 0.06 });
  STAGE.pose("tan", { x: 0, z: -0.06, dy: PEDESTAL.top + hop(0), rotY: 0, wave: lt * 1.35 * calm, armL: 0.25, face: face(0), squash: land(0) || breathe(lt), tilt: wob(lt, 0.6) * 0.06 });
  // Dr Lim waves with his outer (left) arm, the same motion as `wave`, so his hand never crosses Mr Tan's head
  STAGE.pose("lim", { x: 0.8, z: 0.12, dy: PEDESTAL.top + hop(0.16), rotY: -0.18, armOutL: 0.1 + 2.3 + wob(lt * 1.2 * calm + 1.4, 1.6) * 0.35, armR: 0.3, face: face(0.16), squash: land(0.16) || breathe(lt, 1), tilt: wob(lt, 0.5, 1) * 0.06 });
}

/** Ripple's logo (mark and word, brand colours) on a cream tile with an ink border and offset shadow; pops in with
 *  overshoot like the URL card, and the logo draws itself on from T_DRAW. */
function logoTile(c, t, k) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.6), r = 30;
  c.save(); c.translate(TILE_X, ROW_Y); c.scale(s, s);
  const rr = (dx, dy) => { c.beginPath(); c.roundRect(-TILE / 2 + dx, -TILE / 2 + dy, TILE, TILE, r); };
  rr(10, 12); c.fillStyle = INK; c.fill();
  rr(0, 0); c.fillStyle = PAPER; c.fill(); c.lineWidth = 5; c.strokeStyle = INK; c.stroke();
  drawLogo(c, "full", "all", 0, 2, TILE - 52, { draw: t - T_DRAW });
  c.restore();
}

// 1 · close on the turntable: they hop and wave
sh("c14 wave", T0, T_CARD, ({ t, lt, tc, lc, ov }) => {
  base(t);
  trio(t);
  const k = easeOut(seg(lc, 0, T_CARD - T0));
  STAGE.cam([lerp(0.35, 0.15, k), lerp(1.55, 1.5, k), lerp(3.3, 3.95, k)], [0, 1.35, 0], 38);
  ov.push((c) => flashHit(c, tc - T_HOP - 0.42, "#fff3b0", 2));
  ov.push((c) => sfx(c, "BOING!", 420, 760, 80, t - T_HOP - 0.1, { life: 1.0, burst: false, fill: ["#bff6ff", "#39d3ff"] }));
  ov.push((c) => { const [x, y] = headScreen(tan, 0.8); sfx(c, "TA-DA!", x + 330, y - 20, 96, t - T_HOP - 0.5, { life: 1.3 }); });
  return { bloom: 0.5 };
});

// 2 · pull back: the address, the QR code, the line and the team; hold
sh("c14 try it", T_CARD, T_END, ({ t, lt, tc, lc, ov, wait }) => {
  base(t);
  trio(t);
  let qr; wait(image("assets/qr.png").then((i) => (qr = i)));
  const k = ease(seg(lc, 0, T_HOLD - T_CARD)), h = seg(tc, T_HOLD, T_END);
  STAGE.cam([lerp(0.15, 0.05, k), lerp(1.45, 1.36, k), lerp(4.1, 5.0, k) + h * 0.08], [0, lerp(1.1, 0.78, k), 0], 38);
  ov.push((c) => banner(c, "Ripple · between two visits", 960, 76, seg(t, T_CARD + 0.15, T_CARD + 0.5), { size: 44 }));
  ov.push((c) => logoTile(c, t, seg(t, T_TILE, T_TILE + 0.35)));
  ov.push((c) => urlCard(c, URL, qr, CARD_X, ROW_Y, seg(t, T_CARD + 0.45, T_CARD + 0.85), NOTE));
  ov.push((c) => sfx(c, "POP!", 1500, 640, 64, t - T_CARD - 0.5, { life: 0.8 }));
  ov.push((c) => banner(c, TEAM, 960, 974, seg(t, T_CARD + 0.9, T_CARD + 1.3), { size: 32, bg: "#ffffff" })); // 32 px: readable at 720p
  return { bloom: 0.5 };
});
