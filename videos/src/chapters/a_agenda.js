// Chapter a_agenda · the agenda card that opens version 4 (film source 800–807, exactly 7.0 s; the edit list puts it
// before everything). The trio stands on the Ripple lab's turntable on the right (the wall screen behind them shows the
// Ripple logo); on the left, Ripple's logo mark on a white sticker leading the title "RIPPLE · BETWEEN TWO VISITS", the
// challenge line, and the film's three parts in the yellow time-card style, each popping in as its mascot hops:
// 1 Mr Tan (the story), 2 Wei Ling (Ripple in action), 3 Dr Lim (architecture and safety).
// The times on the rows are where each part starts in the final film (agenda included).
//   800.00–800.60 title pops with its logo sticker (TA-DA!), challenge line slides in
//   800.17–801.02 the logo mark draws itself on (outlines trace, then fill, as ripple-logo-animated.svg), a small thump
//   801.10 / 801.90 / 802.70 rows 1, 2, 3 slide in, one mascot hops each
//   802.70–807.00 hold (4.3 s for the last row); slow push-in throughout; hard cut to the dawn estate
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { clamp, seg, wob, ease, easeOut, lerp, backOut, twos } from "../core.js";
import { sfx, INK, YEL } from "../overlay.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";
import { useLab, PEDESTAL, faceAt, headScreen, drawLogo, logoDrawTime, logoScreen } from "../sets/lab.js";

const lab = useLab();
STAGE.need("tan", makeTanBot); STAGE.need("wei", makeWeiBot); STAGE.need("lim", makeLimBot);
const tan = STAGE.get("tan");

const T0 = 800, T_END = 807;
const BANG = '"Bangers", "Impact", sans-serif';
const SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';

const TITLE = { a: "RIPPLE", b: "BETWEEN TWO VISITS" };
const LINE = "NTU LKCMedicine · Challenge 2 · AI Healthier Every Day · Team YoRHa2";
const ROWS = [
  { n: "1", head: "THE STORY", sub: "A day in the life of Mr Tan", time: "0:07", who: "tan" },
  { n: "2", head: "RIPPLE IN ACTION", sub: "The problem and the trust lab", time: "3:46", who: "wei" },
  { n: "3", head: "ARCHITECTURE AND SAFETY", sub: "How it works, safety and next steps", time: "5:04", who: "lim" },
];
const T_TITLE = 0.12, T_LINE = 0.55, T_ROW = [1.1, 1.9, 2.7];
// the logo sticker: a white rounded square (the app icon's shape) holding the mark in brand colours; its draw-on
const STICK = { w: 232, h: 232, r: 30, mark: 176 };
const T_LOGO = T_TITLE + 0.05, LOGO_DONE = T_LOGO + logoDrawTime("mark");

const breathe = (t, ph = 0) => wob(t, 0.45, ph) * 0.03;

// the wall screen behind the trio: the Ripple logo lifted and a little smaller than the lab's idle screen, so Dr Lim's
// ears never cut into the word "ripple" from this camera
const SCREEN = ["logo-agenda", logoScreen(0.39, 0.64)];

function base(t) {
  STAGE.show("lab");
  STAGE.lights("lab", { keyPos: [2, 6, 6], keyTarget: [0, 0.5, -0.5], keyI: 1.45 });
  lab.userData.tick(t, { spin: 0.1 + t * 0.05, gauge: 0.8 + wob(t, 0.3) * 0.06, screen: SCREEN });
}

/** the trio on the turntable; each hops when its row lands, then waves a little */
function trio(lt) {
  const hop = (d) => (lt > d && lt < d + 0.4 ? Math.sin(((lt - d) / 0.4) * Math.PI) * 0.24 : 0);
  const sq = (d) => (lt > d - 0.12 && lt < d ? 0.2 : lt > d + 0.4 && lt < d + 0.52 ? 0.26 : 0);
  const face = (d, ph) => faceAt(lt, [[0, "code"], [d, "happy"]], 2.9 + ph);
  const wave = (d, rate) => (lt > d + 0.1 ? (lt - d) * rate : null);
  const [d1, d2, d3] = T_ROW;
  STAGE.pose("wei", { x: -0.56, z: 0.14, dy: PEDESTAL.top + hop(d2), rotY: 0.22, wave: wave(d2, 1.4), armL: 0.3, face: face(d2, 0.4),
    squash: sq(d2) || breathe(lt, 2), tilt: wob(lt, 0.7, 2) * 0.06, ear: lt > d2 ? 1 : 0.3 });
  STAGE.pose("tan", { x: 0.02, z: -0.08, dy: PEDESTAL.top + hop(d1), rotY: 0.05, wave: wave(d1, 1.3), armL: 0.25, face: face(d1, 0),
    squash: sq(d1) || breathe(lt), tilt: wob(lt, 0.6) * 0.06, ear: lt > d1 ? 1 : 0.3 });
  // Dr Lim waves with his outer (left) arm, as in c14, so his hand never crosses Mr Tan's head
  STAGE.pose("lim", { x: 0.6, z: 0.12, dy: PEDESTAL.top + hop(d3), rotY: -0.2, armOutL: lt > d3 + 0.1 ? 2.4 + wob(lt * 1.2, 1.6) * 0.35 : 0.1, armR: 0.3,
    face: face(d3, 0.8), squash: sq(d3) || breathe(lt, 1), tilt: wob(lt, 0.5, 1) * 0.06, ear: lt > d3 ? 1 : 0.3 });
}

/** outlined comic letters: ink stroke, misregistered cyan and pink under a gradient fill (the film's title look) */
function bigWord(c, txt, x, y, size, fill, o = {}) {
  c.font = `${size}px ${BANG}`; c.textAlign = o.align ?? "left"; c.textBaseline = "middle"; c.lineJoin = "round";
  if (o.mis !== false) { c.fillStyle = "#39d3ff"; c.fillText(txt, x - size * 0.035, y + size * 0.03); c.fillStyle = "#ff5fa8"; c.fillText(txt, x + size * 0.045, y + size * 0.05); }
  c.lineWidth = size * 0.13; c.strokeStyle = INK; c.strokeText(txt, x, y);
  if (Array.isArray(fill)) { const g = c.createLinearGradient(0, y - size / 2, 0, y + size / 2); g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]); c.fillStyle = g; }
  else c.fillStyle = fill;
  c.fillText(txt, x, y);
}

/** Ripple's logo mark on a white sticker with an ink border and offset shadow (the comic boxes' style); its left edge
 *  at local x = 0, centred on y = 0. The mark draws itself on from T_LOGO, then the sticker gives one small thump. */
function logoSticker(c, lt) {
  const { w, h, r } = STICK;
  const th = lt > LOGO_DONE && lt < LOGO_DONE + 0.2 ? Math.sin(((lt - LOGO_DONE) / 0.2) * Math.PI) * 0.05 : 0;
  c.save(); c.translate(w / 2, 0); c.scale(1 + th, 1 + th); c.translate(-w / 2, 0);
  const rr = (dx, dy) => { c.beginPath(); c.roundRect(dx, -h / 2 + dy, w, h, r); };
  rr(10, 10); c.fillStyle = INK; c.fill();
  rr(0, 0); c.fillStyle = "#ffffff"; c.fill(); c.lineWidth = 6; c.strokeStyle = INK; c.stroke();
  drawLogo(c, "full", "mark", w / 2, 0, STICK.mark, { draw: lt - T_LOGO });
  c.restore();
}

/** the title block: the logo sticker, then RIPPLE big and BETWEEN TWO VISITS beside it; pops with overshoot */
function titleBlock(c, k, lt) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.7), x = 96, y = 168;
  c.save(); c.translate(x, y); c.rotate(-0.03); c.scale(s, s);
  logoSticker(c, lt);
  const x0 = STICK.w + 34;
  // a touch smaller than before the sticker (168 / 92 px), so BETWEEN TWO VISITS still ends clear of the scanner hood
  bigWord(c, TITLE.a, x0, 0, 160, ["#ffe37a", "#ff8a1f"]);
  c.font = `160px ${BANG}`; const wa = x0 + c.measureText(TITLE.a).width;
  bigWord(c, "·", wa + 21, -4, 104, "#ffffff", { mis: false });
  bigWord(c, TITLE.b, wa + 60, 12, 84, "#ffffff");
  c.restore();
}

/** the challenge line in a white box (keeps its own capitals: LKCMedicine, YoRHa2) */
function lineBox(c, k) {
  if (k <= 0) return;
  c.save(); c.globalAlpha = clamp(k * 1.6);
  c.font = `700 31px ${SANS}`;
  const w = c.measureText(LINE).width + 40, h = 54, x = 92 - (1 - easeOut(clamp(k))) * 50, y = 302;
  c.translate(x, y); c.transform(1, 0, -0.08, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(6, 6, w, h); c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h);
  c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(0, 0, w, h);
  c.fillStyle = INK; c.textBaseline = "middle"; c.fillText(LINE, 20, h / 2 + 1);
  c.restore();
}

/** one agenda row: a skewed yellow card (the time card, grown up) with an ink number badge, the part's name in
 *  Bangers, its subtitle in bold caps, and an ink tag with the time the part starts. Slides in from the left. */
const ROW = { x: 92, y0: 434, gap: 168, w: 1060, h: 134 };
function agendaRow(c, i, k) {
  if (k <= 0) return;
  const r = ROWS[i], { w, h } = ROW;
  const x = ROW.x - (1 - backOut(clamp(k), 1.3)) * (w + 140), y = ROW.y0 + i * ROW.gap;
  c.save(); c.translate(x, y); c.transform(1, 0, -0.08, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(9, 9, w, h);
  c.fillStyle = YEL; c.fillRect(0, 0, w, h);
  c.lineWidth = 5; c.strokeStyle = INK; c.strokeRect(0, 0, w, h);
  // number badge, inset so the yellow frames it
  c.fillStyle = INK; c.fillRect(10, 10, 100, h - 20);
  c.textBaseline = "middle"; c.textAlign = "center";
  bigWord(c, r.n, 60, h / 2 + 5, 108, ["#ffe37a", "#ff9a2e"], { align: "center", mis: false });
  // name and subtitle
  c.textAlign = "left"; c.fillStyle = INK;
  c.font = `78px ${BANG}`; c.fillText(r.head, 140, h * 0.37 + 4);
  c.font = `800 33px ${SANS}`; c.fillText(r.sub.toUpperCase(), 142, h * 0.78);
  // the time tag
  const tw = 158, tx = w - tw - 12, ty = 12, th = h - 24;
  c.fillStyle = INK; c.fillRect(tx, ty, tw, th);
  c.font = `80px ${BANG}`; c.fillStyle = YEL; c.textAlign = "center"; c.fillText(r.time, tx + tw / 2, h / 2 + 5);
  c.restore();
}

const sh = (name, a, b, fn) => shot(name, a, b, (o) => fn({ ...o, t: a + twos(o.lt), lt: twos(o.lt), tc: o.t, lc: o.lt }));

sh("a agenda", T0, T_END, ({ t, lt, tc, lc, ov }) => {
  base(t);
  trio(lt);
  // a slow push-in on the trio, held to the right third of the frame
  const k = ease(seg(lc, 0, T_END - T0));
  STAGE.cam([lerp(-2.29, -2.19, k), lerp(2.0, 1.95, k), lerp(6.05, 5.6, k)], [lerp(-2.17, -2.12, k), lerp(1.52, 1.5, k), 0], 38);
  // a soft violet shade behind the text side, so the cards sit on a calm field (drawn first, under everything)
  ov.push((c) => {
    const g = c.createLinearGradient(0, 0, 1400, 0);
    g.addColorStop(0, "rgba(20,10,52,0.62)"); g.addColorStop(0.72, "rgba(20,10,52,0.38)"); g.addColorStop(1, "rgba(20,10,52,0)");
    c.save(); c.fillStyle = g; c.fillRect(0, 0, 1400, 1080); c.restore();
  });
  ov.push((c) => titleBlock(c, seg(lt, T_TITLE, T_TITLE + 0.32), lt));
  ov.push((c) => lineBox(c, seg(lt, T_LINE, T_LINE + 0.3)));
  ROWS.forEach((_, i) => ov.push((c) => agendaRow(c, i, seg(lt, T_ROW[i], T_ROW[i] + 0.36))));
  // TA-DA! sits up and to the left of Mr Tan's head, off the logo on the wall screen
  ov.push((c) => { const [x, y] = headScreen(tan, 0.95); sfx(c, "TA-DA!", Math.min(1650, x - 110), Math.max(110, y - 30), 78, t - T0 - T_TITLE - 0.1, { life: 1.1 }); });
  return { bloom: 0.5 };
});
