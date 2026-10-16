// The 2D kit for the sober third part (t_serious): palette, type, boxes, arrows that draw on, packets that travel a
// path, line icons, the section head and the progress bar. Everything is a pure function of its arguments; nothing is
// carried between frames. Sizes are in 1080p canvas pixels (the canvas is 1920 x 1080).
import { clamp, seg, easeOut } from "../core.js";
import { LOGO_PATHS, LOGO_VIEW, LOGO_BRAND } from "./t_logo.js";

export const COL = {
  bg: "#0f1724", text: "#eef2f7", sub: "#9fb0c6", teal: "#2bb8a8", tealD: "#0b6e69", amber: "#f2b84b",
  rule: "#2a3a52", card: "#131e2f", dim: "#5d6f88",
  tealFill: "rgba(43, 184, 168, 0.10)", tealFaint: "rgba(43, 184, 168, 0.045)", amberFill: "rgba(242, 184, 75, 0.08)",
};
export const FACE = '"Segoe UI", "Microsoft YaHei", sans-serif';
export const W = 1920, H = 1080, L = 120, R = 1800, CW = R - L;
export const font = (size, weight = 400) => `${weight} ${size}px ${FACE}`;

/** An entrance: 0 before `at`, eases out to 1 over `len` seconds (0.3–0.5 s in this part). */
export const inK = (lt, at, len = 0.45) => easeOut(seg(lt, at, at + len));

/** Draw fn() faded in by k (0..1) with a short rise of `rise` px; alphas multiply, so a slide's own fade still applies. */
export function enter(c, k, fn, rise = 12) {
  if (k <= 0.001) return;
  c.save(); c.globalAlpha *= clamp(k); c.translate(0, rise * (1 - k)); fn(); c.restore();
}

/** Split text into lines no wider than maxW (explicit "\n" also breaks). Font must already be set on c. */
export function wrap(c, s, maxW) {
  const out = [];
  for (const para of String(s).split("\n")) {
    let line = "";
    for (const w of para.split(" ")) {
      const t = line ? line + " " + w : w;
      if (line && c.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/** Text with its first baseline at y. o: size, weight, color, align, ls (letter spacing px), maxW (wraps), lh (line
 *  height factor). Returns { n, h, lh, w } (h = from the first baseline to the last baseline + descent-ish). */
export function text(c, s, x, y, o = {}) {
  const size = o.size ?? 30;
  c.save();
  c.font = font(size, o.weight ?? 400);
  c.fillStyle = o.color ?? COL.text;
  c.textAlign = o.align ?? "left";
  c.textBaseline = "alphabetic";
  if (o.ls) c.letterSpacing = `${o.ls}px`;
  const lines = o.maxW ? wrap(c, s, o.maxW) : String(s).split("\n");
  const lh = size * (o.lh ?? 1.3);
  let w = 0;
  lines.forEach((l, i) => { c.fillText(l, x, y + i * lh); w = Math.max(w, c.measureText(l).width); });
  c.restore();
  return { n: lines.length, lh, h: (lines.length - 1) * lh, w };
}
/** How many lines `s` wraps to at this size and width, and the line height text() would use. */
export function lineCount(c, s, size, weight = 400, maxW = 1e9, lhK = 1.3) {
  c.save(); c.font = font(size, weight); const n = wrap(c, s, maxW).length; c.restore();
  return { n, lh: size * lhK, h: (n - 1) * size * lhK };
}
export function measure(c, s, size, weight = 400, ls = 0) {
  c.save(); c.font = font(size, weight); if (ls) c.letterSpacing = `${ls}px`;
  const w = c.measureText(s).width; c.restore(); return w;
}

/** A rounded box. o: fill, stroke, lw, r, dash. */
export function box(c, x, y, w, h, o = {}) {
  c.save();
  c.beginPath(); c.roundRect(x, y, w, h, o.r ?? 12);
  if (o.fill) { c.fillStyle = o.fill; c.fill(); }
  if (o.stroke) { c.lineWidth = o.lw ?? 1.5; c.strokeStyle = o.stroke; if (o.dash) c.setLineDash(o.dash); c.stroke(); }
  c.restore();
}
/** A thin horizontal rule from x0 to x1 that draws on from the left with k. */
export function hrule(c, x0, x1, y, k = 1, col = COL.rule, lw = 1.5) {
  if (k <= 0) return;
  c.save(); c.strokeStyle = col; c.lineWidth = lw;
  c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + (x1 - x0) * clamp(k), y); c.stroke(); c.restore();
}

// ---- paths: arrows that draw on, packets that travel ----
const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const pathLen = (pts) => pts.slice(1).reduce((s, p, i) => s + segLen(pts[i], p), 0);
/** The point and heading at distance d along a polyline. */
export function pointAt(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = segLen(a, b);
    if (acc + l >= d || i === pts.length - 1) {
      const k = l ? clamp((d - acc) / l) : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])];
    }
    acc += l;
  }
  return [pts[0][0], pts[0][1], 0];
}
/** A polyline drawn on up to fraction k; o.head draws an arrowhead at the moving tip. o: color, lw, dash, head, hs. */
export function arrow(c, pts, k, o = {}) {
  if (k <= 0) return;
  const total = pathLen(pts), want = total * clamp(k);
  c.save();
  c.strokeStyle = c.fillStyle = o.color ?? COL.rule; c.lineWidth = o.lw ?? 2; c.lineCap = "round"; c.lineJoin = "round";
  if (o.dash) c.setLineDash(o.dash);
  const hs = o.head ? (o.hs ?? 11) : 0;
  const end = Math.max(0, want - hs * 0.8); // stop the shaft under the head
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = segLen(pts[i - 1], pts[i]);
    if (acc + l >= end) { const [x, y] = pointAt(pts, end); c.lineTo(x, y); break; }
    c.lineTo(pts[i][0], pts[i][1]); acc += l;
  }
  c.stroke();
  if (o.head) {
    c.setLineDash([]);
    const [x, y, a] = pointAt(pts, want);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - hs * Math.cos(a) + hs * 0.55 * Math.sin(a), y - hs * Math.sin(a) - hs * 0.55 * Math.cos(a));
    c.lineTo(x - hs * Math.cos(a) - hs * 0.55 * Math.sin(a), y - hs * Math.sin(a) + hs * 0.55 * Math.cos(a));
    c.closePath(); c.fill();
  }
  c.restore();
}
/** A small glowing packet at fraction k along a path (drawn only while 0 < k < 1). */
export function packet(c, pts, k, col = COL.teal, r = 7) {
  if (k <= 0 || k >= 1) return;
  const [x, y] = pointAt(pts, pathLen(pts) * k);
  const a = Math.min(1, k * 8, (1 - k) * 8);
  c.save(); c.globalAlpha *= a;
  const g = c.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, "rgba(43, 184, 168, 0.55)"); g.addColorStop(1, "rgba(43, 184, 168, 0)");
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.restore();
}

// ---- the fixed frame ----
/** Section label (teal caps, letter-spaced) and the slide title under it. */
export function head(c, label, title, lt) {
  enter(c, inK(lt, 0.0, 0.4), () => text(c, label, L, 102, { size: 22, weight: 700, color: COL.teal, ls: 3.5 }), 8);
  enter(c, inK(lt, 0.08, 0.45), () => text(c, title, L, 170, { size: 54, weight: 600 }), 10);
}
/** Small caps over a column or a tag (22 px, the smallest type in this part). */
export const caps = (c, s, x, y, color = COL.sub, o = {}) => text(c, s, x, y, { size: 22, weight: 700, color, ls: 2.5, ...o });
/** A round icon badge: a faint teal disc, a thin ring and a line icon in it. */
export function badge(c, kind, x, y, r, col = COL.teal, o = {}) {
  c.save();
  c.fillStyle = o.fill ?? COL.tealFill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = o.ring ?? COL.tealD; c.lineWidth = 1.5; c.stroke();
  c.restore();
  icon(c, kind, x, y, r * (o.k ?? 1.1), col);
}
/** A rounded chip: optional icon, then text (24 px semibold). Returns its width. align "right" puts its right edge at x. */
export function chip(c, s, x, yTop, o = {}) {
  const size = o.size ?? 24, h = o.h ?? 44, ic = o.icon ? size * 1.05 : 0, pad = 16;
  const w = pad + (ic ? ic + 10 : 0) + measure(c, s, size, 600) + pad;
  const x0 = o.align === "right" ? x - w : x;
  box(c, x0, yTop, w, h, { fill: o.fill, stroke: o.stroke ?? COL.tealD, lw: 1.5, r: h / 2 });
  if (ic) icon(c, o.icon, x0 + pad + ic / 2, yTop + h / 2, ic, o.color ?? COL.teal);
  text(c, s, x0 + pad + (ic ? ic + 10 : 0), yTop + h / 2 + size * 0.36, { size, weight: 600, color: o.color ?? COL.teal });
  return w;
}
/** The thin progress bar at the bottom: one segment per slide, the elapsed part in teal. */
export function progress(c, t, bounds) {
  const t0 = bounds[0], t1 = bounds[bounds.length - 1], y = 1036, h = 4, gap = 6;
  const X = (tt) => L + ((tt - t0) / (t1 - t0)) * CW;
  c.save();
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const x0 = X(a) + (i ? gap / 2 : 0), x1 = X(b) - (i < bounds.length - 2 ? gap / 2 : 0);
    c.fillStyle = COL.rule; c.beginPath(); c.roundRect(x0, y, x1 - x0, h, 2); c.fill();
    const k = clamp((t - a) / (b - a));
    if (k > 0) { c.fillStyle = COL.teal; c.beginPath(); c.roundRect(x0, y, Math.max(h, (x1 - x0) * k), h, 2); c.fill(); }
  }
  c.restore();
}

// ---- line icons (stroke only, teal by default), centred on (x, y), about s px across ----
export function icon(c, kind, x, y, s = 44, col = COL.teal) {
  c.save();
  c.translate(x, y); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = Math.max(2, s / 18); c.lineCap = "round"; c.lineJoin = "round";
  const u = s / 2;
  const P = (pts, close) => { c.beginPath(); c.moveTo(pts[0][0] * u, pts[0][1] * u); for (const p of pts.slice(1)) c.lineTo(p[0] * u, p[1] * u); if (close) c.closePath(); c.stroke(); };
  if (kind === "phone") {
    c.beginPath(); c.roundRect(-0.55 * u, -u, 1.1 * u, 2 * u, 0.22 * u); c.stroke();
    P([[-0.18, 0.78], [0.18, 0.78]]);
  } else if (kind === "check") {
    P([[-0.7, 0.05], [-0.22, 0.55], [0.75, -0.55]]);
  } else if (kind === "cross") {
    P([[-0.5, -0.5], [0.5, 0.5]]); P([[0.5, -0.5], [-0.5, 0.5]]);
  } else if (kind === "consent") { // two ticked boxes
    for (const dy of [-0.5, 0.5]) {
      c.beginPath(); c.roundRect(-0.95 * u, (dy - 0.36) * u, 0.72 * u, 0.72 * u, 0.12 * u); c.stroke();
      P([[-0.8, dy], [-0.6, dy + 0.2], [-0.33, dy - 0.2]]);
      P([[0.05, dy], [0.95, dy]]);
    }
  } else if (kind === "eye") {
    c.beginPath(); c.moveTo(-u, 0); c.quadraticCurveTo(0, -0.95 * u, u, 0); c.quadraticCurveTo(0, 0.95 * u, -u, 0); c.stroke();
    c.beginPath(); c.arc(0, 0, 0.3 * u, 0, Math.PI * 2); c.stroke();
  } else if (kind === "clock") {
    c.beginPath(); c.arc(0, 0, 0.9 * u, 0, Math.PI * 2); c.stroke();
    P([[0, -0.55], [0, 0], [0.4, 0.25]]);
  } else if (kind === "export") {
    P([[-0.85, 0.1], [-0.85, 0.85], [0.85, 0.85], [0.85, 0.1]]);
    P([[0, 0.35], [0, -0.9]]); P([[-0.4, -0.5], [0, -0.9], [0.4, -0.5]]);
  } else if (kind === "lock") {
    c.beginPath(); c.roundRect(-0.7 * u, -0.1 * u, 1.4 * u, 1.0 * u, 0.15 * u); c.stroke();
    c.beginPath(); c.arc(0, -0.1 * u, 0.45 * u, Math.PI, 0); c.stroke();
  } else if (kind === "scanbox") { // a medicine box with its label, inside the four corners of a scan frame
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P([[sx * 0.95, sy * 0.6], [sx * 0.95, sy * 0.95], [sx * 0.6, sy * 0.95]]);
    c.beginPath(); c.roundRect(-0.52 * u, -0.55 * u, 1.04 * u, 1.1 * u, 0.08 * u); c.stroke();
    P([[-0.52, -0.28], [0.52, -0.28]]);
    P([[-0.3, 0.02], [0.3, 0.02]]); P([[-0.3, 0.27], [0.12, 0.27]]);
  } else if (kind === "pillcheck") { // a capsule and a tick: one tap logs the dose
    c.save(); c.translate(-0.22 * u, 0.2 * u); c.rotate(-0.6);
    c.beginPath(); c.roundRect(-0.7 * u, -0.3 * u, 1.4 * u, 0.6 * u, 0.3 * u); c.stroke();
    c.beginPath(); c.moveTo(0, -0.3 * u); c.lineTo(0, 0.3 * u); c.stroke(); c.restore();
    c.beginPath(); c.arc(0.5 * u, -0.48 * u, 0.4 * u, 0, Math.PI * 2); c.stroke();
    P([[0.32, -0.48], [0.46, -0.33], [0.7, -0.62]]);
  } else if (kind === "ask") { // a speech bubble with a question mark: a pattern becomes a question
    c.beginPath(); c.roundRect(-0.92 * u, -0.8 * u, 1.84 * u, 1.3 * u, 0.32 * u); c.stroke();
    P([[-0.45, 0.5], [-0.6, 0.92], [-0.08, 0.5]]);
    c.beginPath(); c.arc(0, -0.33 * u, 0.2 * u, Math.PI * 1.02, Math.PI * 2.3); c.lineTo(0, -0.02 * u); c.lineTo(0, 0.06 * u); c.stroke();
    c.beginPath(); c.arc(0, 0.27 * u, Math.max(1.5, 0.06 * u), 0, Math.PI * 2); c.fill();
  } else if (kind === "chart") { // readings against a dashed target line
    P([[-0.92, -0.9], [-0.92, 0.88], [0.92, 0.88]]);
    c.save(); c.setLineDash([0.13 * u, 0.11 * u]); P([[-0.92, -0.2], [0.92, -0.2]]); c.restore();
    const pts = [[-0.7, 0.45], [-0.35, 0.12], [0, 0.38], [0.35, -0.5], [0.7, -0.05]];
    P(pts);
    for (const [px, py] of pts) { c.beginPath(); c.arc(px * u, py * u, Math.max(1.5, 0.08 * u), 0, Math.PI * 2); c.fill(); }
  } else if (kind === "shield") { // prevention
    c.beginPath(); c.moveTo(0, -0.95 * u); c.lineTo(0.78 * u, -0.66 * u); c.lineTo(0.78 * u, 0.02 * u);
    c.quadraticCurveTo(0.7 * u, 0.62 * u, 0, 0.96 * u); c.quadraticCurveTo(-0.7 * u, 0.62 * u, -0.78 * u, 0.02 * u);
    c.lineTo(-0.78 * u, -0.66 * u); c.closePath(); c.stroke();
    P([[0, -0.4], [0, 0.32]]); P([[-0.36, -0.04], [0.36, -0.04]]);
  } else if (kind === "clipboard") { // the question list for the next visit
    c.beginPath(); c.roundRect(-0.72 * u, -0.78 * u, 1.44 * u, 1.74 * u, 0.12 * u); c.stroke();
    c.beginPath(); c.roundRect(-0.3 * u, -0.96 * u, 0.6 * u, 0.34 * u, 0.08 * u); c.stroke();
    for (const yy of [-0.25, 0.15, 0.55]) { P([[-0.46, yy], [-0.36, yy + 0.1], [-0.18, yy - 0.1]]); P([[0.0, yy], [0.46, yy]]); }
  } else if (kind === "server") { // an always-on server: two units, their lights on
    for (const yy of [-0.82, 0.1]) {
      c.beginPath(); c.roundRect(-0.9 * u, yy * u, 1.8 * u, 0.72 * u, 0.12 * u); c.stroke();
      P([[-0.62, yy + 0.36], [-0.12, yy + 0.36]]);
      c.beginPath(); c.arc(0.55 * u, (yy + 0.36) * u, Math.max(1.5, 0.09 * u), 0, Math.PI * 2); c.fill();
    }
  } else if (kind === "wave") { // speech: a waveform
    const hs = [0.25, 0.6, 0.95, 0.5, 0.8, 0.35, 0.65, 0.2];
    hs.forEach((hh, i) => { const xx = -0.84 + i * 0.24; P([[xx, -hh], [xx, hh]]); });
  } else if (kind === "quote") { // quotation marks: his own sources, word for word
    for (const x0 of [-0.42, 0.42]) {
      c.beginPath(); c.arc((x0) * u, 0.12 * u, 0.26 * u, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo((x0 - 0.24) * u, 0.18 * u); c.quadraticCurveTo((x0 - 0.3) * u, -0.5 * u, (x0 + 0.22) * u, -0.68 * u); c.stroke();
    }
  } else if (kind === "samevendor") { // two checks of the same kind
    c.beginPath(); c.arc(-0.38 * u, 0, 0.55 * u, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0.38 * u, 0, 0.55 * u, 0, Math.PI * 2); c.stroke();
    P([[0.14, 0.02], [0.32, 0.2], [0.62, -0.18]]);
  } else if (kind === "vendors") { // two checks of different kinds: a second vendor
    c.beginPath(); c.arc(-0.46 * u, 0, 0.44 * u, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.roundRect(0.06 * u, -0.44 * u, 0.88 * u, 0.88 * u, 0.12 * u); c.stroke();
    P([[-0.66, 0.0], [-0.52, 0.15], [-0.26, -0.15]]); P([[0.28, 0.0], [0.44, 0.15], [0.72, -0.15]]);
  } else if (kind === "bolt") { // never waits
    P([[0.18, -0.95], [-0.5, 0.12], [-0.02, 0.12], [-0.18, 0.95], [0.52, -0.16], [0.04, -0.16]], true);
  } else if (kind === "alert") {
    c.beginPath(); c.moveTo(0, -0.88 * u); c.lineTo(0.95 * u, 0.8 * u); c.lineTo(-0.95 * u, 0.8 * u); c.closePath(); c.stroke();
    P([[0, -0.3], [0, 0.22]]);
    c.beginPath(); c.arc(0, 0.5 * u, Math.max(1.5, 0.07 * u), 0, Math.PI * 2); c.fill();
  } else if (kind === "people") { // two people: users, or a caregiver beside him
    c.beginPath(); c.arc(-0.36 * u, -0.42 * u, 0.27 * u, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(-0.36 * u, 0.9 * u, 0.58 * u, Math.PI * 1.08, Math.PI * 1.8); c.stroke();
    c.beginPath(); c.arc(0.48 * u, -0.3 * u, 0.23 * u, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0.48 * u, 0.9 * u, 0.46 * u, Math.PI * 1.25, Math.PI * 1.9); c.stroke();
  } else if (kind === "review") { // a person and a tick: a pharmacist or clinician reviews
    c.beginPath(); c.arc(-0.3 * u, -0.42 * u, 0.3 * u, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(-0.3 * u, 0.95 * u, 0.62 * u, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    P([[0.36, 0.02], [0.55, 0.22], [0.92, -0.2]]);
  } else if (kind === "mic") {
    c.beginPath(); c.roundRect(-0.28 * u, -0.92 * u, 0.56 * u, 1.1 * u, 0.28 * u); c.stroke();
    c.beginPath(); c.arc(0, -0.12 * u, 0.55 * u, 0.15, Math.PI - 0.15); c.stroke();
    P([[0, 0.45], [0, 0.85]]); P([[-0.3, 0.85], [0.3, 0.85]]);
  } else if (kind === "bell") { // a notification
    c.beginPath(); c.moveTo(-0.62 * u, 0.5 * u); c.quadraticCurveTo(-0.5 * u, 0.3 * u, -0.5 * u, -0.1 * u);
    c.quadraticCurveTo(-0.5 * u, -0.72 * u, 0, -0.75 * u); c.quadraticCurveTo(0.5 * u, -0.72 * u, 0.5 * u, -0.1 * u);
    c.quadraticCurveTo(0.5 * u, 0.3 * u, 0.62 * u, 0.5 * u); c.closePath(); c.stroke();
    P([[0, -0.75], [0, -0.92]]);
    c.beginPath(); c.arc(0, 0.62 * u, 0.17 * u, 0, Math.PI); c.stroke();
  } else if (kind === "info") {
    c.beginPath(); c.arc(0, 0, 0.9 * u, 0, Math.PI * 2); c.stroke();
    P([[0, -0.1], [0, 0.48]]);
    c.beginPath(); c.arc(0, -0.38 * u, Math.max(1.5, 0.08 * u), 0, Math.PI * 2); c.fill();
  } else if (kind === "play") { // a moment in the film
    P([[-0.45, -0.7], [0.75, 0], [-0.45, 0.7]], true);
  } else if (kind === "chat") { // general information, labelled as Ripple's
    c.beginPath(); c.roundRect(-0.92 * u, -0.78 * u, 1.84 * u, 1.26 * u, 0.32 * u); c.stroke();
    P([[-0.45, 0.48], [-0.6, 0.9], [-0.08, 0.48]]);
    P([[-0.5, -0.32], [0.5, -0.32]]); P([[-0.5, 0.02], [0.2, 0.02]]);
  }
  c.restore();
}

// ---- the Ripple logo, drawn on (after assets/brand/ripple-logo-animated.svg: each path's outline draws over 1.4 s,
// 0.09 s after the one before, then its fill fades in over 0.5 s while the outline thins away) ----
const LOGO_P2D = new Map();
const p2d = (d) => { if (!LOGO_P2D.has(d)) LOGO_P2D.set(d, new Path2D(d)); return LOGO_P2D.get(d); };
/** Seconds the draw-on takes from lt = 0 to the last fill landing. */
export const LOGO_DRAW_S = (LOGO_PATHS.filter((p) => p.role !== "counter").length - 1) * 0.09 + 1.9;
/** The logo with the top-left of its drawn extent at (x, y), scaled by s, drawn on at time lt (seconds since it began).
 *  On the navy ground the navy parts are light (COL.text); the counters of p, p and e are holes (even-odd fill). */
export function drawLogo(c, lt, x, y, s, o = {}) {
  if (lt <= 0) return;
  const light = o.light ?? COL.text, base = c.globalAlpha;
  c.save();
  c.translate(x, y); c.scale(s, s); c.translate(-LOGO_VIEW.x, -LOGO_VIEW.y);
  c.lineCap = "round"; c.lineJoin = "round";
  let i = 0;
  for (const p of LOGO_PATHS) {
    if (p.role === "counter") continue;
    const a = i++ * 0.09, ks = easeInOut(seg(lt, a, a + 1.4)), kf = easeInOut(seg(lt, a + 1.4, a + 1.9));
    if (ks <= 0) continue;
    const col = p.role === "navy" ? light : LOGO_BRAND[p.role], path = p2d(p.d);
    if (kf > 0) { c.globalAlpha = base * kf; c.fillStyle = col; c.fill(path, "evenodd"); }
    if (kf < 1) {
      c.globalAlpha = base; c.strokeStyle = col; c.lineWidth = 2.4 * (1 - kf);
      c.setLineDash([p.len, p.len]); c.lineDashOffset = p.len * (1 - ks); c.stroke(path);
    }
  }
  c.restore();
}
const easeInOut = (k) => k * k * (3 - 2 * k);

/** A real app recording in a plain phone frame (sober, no comic outline): the frame `img` (585 x 1266) fills the screen;
 *  centred on cx, screen top at y, screen height h. o.dim (0..1) darkens the screen; o.ring colours the frame's edge.
 *  Returns the screen rectangle. */
export function phoneFrame(c, img, cx, y, h, o = {}) {
  const w = (h * 585) / 1266, b = 11, r = 30, x = cx - w / 2;
  c.save();
  c.fillStyle = "#070b12"; c.beginPath(); c.roundRect(x - b, y - b, w + 2 * b, h + 2 * b, r + b); c.fill();
  c.strokeStyle = o.ring ?? COL.rule; c.lineWidth = 2; c.stroke();
  if (img) {
    c.beginPath(); c.roundRect(x, y, w, h, r); c.clip();
    c.drawImage(img, x, y, w, h);
    if (o.dim) { c.fillStyle = `rgba(15, 23, 36, ${o.dim})`; c.fillRect(x, y, w, h); }
  }
  c.restore();
  return { x, y, w, h };
}

/** A number counting up once from 0 to n between at and at + len (eased). */
export const countUp = (lt, n, at, len = 1.0) => Math.round(n * easeOut(seg(lt, at, at + len)));
