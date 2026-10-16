// The comic layer, painted on the 2D canvas over the 3D frame: time cards, sound effects in starbursts, speech and
// thought bubbles, UI chips, and comic panels that hold the real app recordings. All functions take the 2D context first.
import { clamp, hash, backOut, elasticOut, seg, wob, boil, easeOut } from "./core.js";

export const INK = "#1a1030", YEL = "#ffd94a", ORA = "#ff9a2e", PINK = "#ff5fa8", CYAN = "#39d3ff", CREAM = "#fff6e4";
const BANG = '"Bangers", "Impact", sans-serif';
const SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const ZH = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif';

/** The yellow time card, bottom left: "10:30 AM  DR LIM". k is the 0..1 slide-in. */
export function timeCard(c, time, label, k = 1, o = {}) {
  if (k <= 0) return;
  const x0 = o.x ?? 34, y0 = o.y ?? 990, h = 58;
  c.save();
  c.font = `64px ${BANG}`; const tw = c.measureText(time).width;
  c.font = `800 27px ${SANS}`; const lw = c.measureText(label.toUpperCase()).width;
  const w = tw + lw + 54;
  const x = x0 - (1 - backOut(clamp(k), 1.25)) * (w + 60) - (o.out ? easeOut(clamp(o.out)) * (w + 120) : 0);
  c.translate(x, y0); c.transform(1, 0, -0.08, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(6, 6, w, h);
  c.fillStyle = YEL; c.fillRect(0, 0, w, h);
  c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(0, 0, w, h);
  c.fillStyle = INK; c.textBaseline = "middle";
  c.font = `64px ${BANG}`; c.fillText(time, 14, h / 2 + 3);
  c.font = `800 27px ${SANS}`; c.fillText(label.toUpperCase(), tw + 34, h / 2 + 2);
  c.restore();
}

function burstPath(c, r, n, seed, spikiness = 0.42) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + seed;
    const rr = i % 2 ? r * (1 - spikiness * (0.75 + hash(seed * 31 + i) * 0.5)) : r * (0.92 + hash(seed * 17 + i) * 0.22);
    const x = Math.cos(a) * rr * 1.25, y = Math.sin(a) * rr * 0.8;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}
function dotFill(c, r, col, dotCol) {
  c.fillStyle = col; c.fill();
  c.save(); c.clip(); c.fillStyle = dotCol;
  for (let y = -r; y < r; y += 11) for (let x = -r * 1.3; x < r * 1.3; x += 11) {
    const off = (Math.round(y / 11) % 2) * 5.5;
    c.beginPath(); c.arc(x + off, y, 2.6, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
function comicText(c, txt, size, fill, o = {}) {
  c.font = `${size}px ${o.font || BANG}`; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  c.lineWidth = size * 0.2; c.strokeStyle = INK; c.strokeText(txt, size * 0.05, size * 0.07);
  c.strokeText(txt, 0, 0);
  if (Array.isArray(fill)) { const g = c.createLinearGradient(0, -size / 2, 0, size / 2); g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]); c.fillStyle = g; }
  else c.fillStyle = fill;
  c.fillText(txt, 0, 0);
  c.lineWidth = Math.max(2, size * 0.035); c.strokeStyle = "rgba(255,255,255,.55)"; c.strokeText(txt, -size * 0.02, -size * 0.03);
}

/** A sound effect. age = seconds since it appeared. Timing measured on the reference: it pops in at about 108 % for
 *  3 frames, settles, holds with a small jitter re-rolled every 2 frames (animation on twos), then shrinks to about 60 %
 *  for the last 2 frames and vanishes (no fade). burst: false for letters only; a colour string colours the starburst. */
export function sfx(c, txt, x, y, size, age, o = {}) {
  const life = o.life ?? 1.2;
  if (age < 0 || age > life) return;
  window.__logSfx?.(txt, age, x, size); // the sound pass: when each word lands
  const f = Math.floor(age * 15);                       // a clock on twos (15 steps a second)
  const end = life - 2 / 30;
  let k = age < 0.1 ? 1.08 : age > end ? 0.6 : 1 + (hash(f * 13 + txt.length) - 0.5) * 0.02;
  if (age < 0.033) k = 0.9;
  const jx = age > 0.1 && age < end ? (hash(f * 7 + x) - 0.5) * 9 : 0, jy = age > 0.1 && age < end ? (hash(f * 11 + y) - 0.5) * 9 : 0;
  const rot = (o.rot ?? (hash(txt.length * 7 + x) - 0.5) * 0.3);
  c.save(); c.translate(x + jx, y + jy); c.rotate(rot); c.scale(k, k);
  if (o.burst !== false) {
    const r = size * (0.55 + txt.length * 0.13);
    const seed = Math.floor(hash(x + y) * 100);
    c.save(); c.translate(10, 12); burstPath(c, r, o.spikes ?? 13, seed); c.fillStyle = INK; c.fill(); c.restore();
    burstPath(c, r, o.spikes ?? 13, seed); dotFill(c, r, o.burst ?? CREAM, o.dots ?? "rgba(255,95,168,.35)");
    burstPath(c, r, o.spikes ?? 13, seed); // dotFill leaves its last dot as the current path: redraw before the stroke
    c.lineWidth = 8; c.strokeStyle = INK; c.stroke();
  }
  // a cyan and magenta fringe baked into the lettering
  c.save(); c.globalAlpha = 0.8; c.translate(-3, -2); c.font = `${size}px ${o.font || BANG}`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = CYAN; c.fillText(txt, 0, 0); c.translate(6, 4); c.fillStyle = PINK; c.fillText(txt, 0, 0); c.restore();
  comicText(c, txt, size, o.fill ?? [YEL, ORA]);
  c.restore();
}

/** An impact flash: 2–4 frames of a full-frame colour wash before the sound-effect word lands (the reference's hits). */
export function flashHit(c, age, col = "#fff3b0", frames = 3) {
  if (age >= 0 && age <= frames / 30) window.__logFlash?.(age);
  if (age < 0 || age > frames / 30) return;
  c.save(); c.globalAlpha = 0.75 * (1 - age / (frames / 30)); c.fillStyle = col; c.fillRect(0, 0, c.canvas.width, c.canvas.height); c.restore();
}

/** A speech bubble; (tx, ty) is where the tail points. lines: array of strings (first may be English, second Chinese). */
export function bubble(c, lines, x, y, tx, ty, k = 1, o = {}) {
  if (k <= 0) return;
  window.__logBubble?.(lines, x, y, o.voice); // the voice pass: which line is on screen, and its voice id (audio/voices-v5.json)
  const s = backOut(clamp(k), 2);
  const size = o.size ?? 34;
  c.save();
  const fonts = lines.map((l) => (/[㐀-鿿]/.test(l) ? `700 ${size * 0.9}px ${ZH}` : `800 ${size}px ${SANS}`));
  let w = 0; lines.forEach((l, i) => { c.font = fonts[i]; w = Math.max(w, c.measureText(l).width); });
  const lh = size * 1.25, h = lines.length * lh + size * 0.7; w += size * 1.4;
  c.translate(x, y); c.scale(s, s);
  const bx = -w / 2, by = -h / 2, r = Math.min(h / 2, 34);
  const path = () => { c.beginPath(); c.roundRect(bx, by, w, h, r); };
  // tail
  const dx = tx - x, dy = ty - y, ang = Math.atan2(dy, dx), len = Math.hypot(dx, dy);
  const tail = () => { c.beginPath(); c.moveTo(Math.cos(ang + 1.57) * 18, Math.sin(ang + 1.57) * 18); c.lineTo(Math.cos(ang) * len * 0.92, Math.sin(ang) * len * 0.92); c.lineTo(Math.cos(ang - 1.57) * 18, Math.sin(ang - 1.57) * 18); c.closePath(); };
  c.fillStyle = INK; c.save(); c.translate(6, 7); path(); c.fill(); tail(); c.fill(); c.restore();
  c.fillStyle = o.fillCol ?? "#ffffff"; c.strokeStyle = INK; c.lineWidth = 5;
  tail(); c.fill(); c.stroke(); path(); c.fill(); c.stroke();
  tail(); c.fill(); // hide the tail's join
  c.fillStyle = o.textCol ?? INK; c.textAlign = "center"; c.textBaseline = "middle";
  lines.forEach((l, i) => { c.font = fonts[i]; c.fillText(l, 0, by + size * 0.35 + lh * (i + 0.5)); });
  c.restore();
}

/** A thought bubble with small trailing circles toward (tx, ty); `draw(c, w, h)` paints its inside. */
export function thought(c, x, y, w, h, tx, ty, k, draw) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.8);
  c.save();
  for (let i = 0; i < 3; i++) {
    const f = (i + 1) / 4, rr = 9 + i * 7;
    const px = tx + (x - tx) * f, py = ty + (y + h / 2 - ty) * f;
    if (k * 3 > i) { c.beginPath(); c.arc(px, py, rr, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke(); }
  }
  c.translate(x, y); c.scale(s, s);
  c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, h / 2);
  c.fillStyle = INK; c.save(); c.translate(6, 7); c.fill(); c.restore();
  c.fillStyle = "#f4f0ff"; c.fill(); c.lineWidth = 5; c.strokeStyle = INK; c.stroke();
  c.save(); c.translate(-w / 2, -h / 2); draw(c, w, h); c.restore();
  c.restore();
}

/** A UI chip like a chat message: a rounded pill with text. */
export function chip(c, txt, x, y, k = 1, o = {}) {
  if (k <= 0) return;
  const size = o.size ?? 30;
  c.save();
  c.font = `700 ${size}px ${/[㐀-鿿]/.test(txt) ? ZH : SANS}`;
  const w = c.measureText(txt).width + size * 1.1, h = size * 1.6;
  c.translate(x, y); const s = backOut(clamp(k), 2); c.scale(s, s);
  c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, 12);
  c.fillStyle = o.bg ?? "#1d1630"; c.fill();
  c.fillStyle = o.fg ?? "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, 0, 2);
  c.restore();
}

/** A comic panel holding an image (an app recording frame): white border, ink outline, hard shadow, pop-in. */
export function panel(c, img, x, y, w, h, k = 1, o = {}) {
  if (k > 0 && !img) console.warn(`panel: no image at (${x}, ${y}): a wrong clip name or a source time past the clip's end`);
  if (k <= 0 || !img) return;
  const s = o.noPop ? 1 : backOut(clamp(k), 1.6);
  c.save();
  c.translate(x, y); c.rotate(o.rot ?? 0); c.scale(s, s);
  const b = o.border ?? 12, R = o.radius ?? 26;
  c.fillStyle = INK; c.beginPath(); c.roundRect(-w / 2 - b + 12, -h / 2 - b + 14, w + b * 2, h + b * 2, R + b); c.fill();
  c.fillStyle = o.frame ?? "#15121c"; c.beginPath(); c.roundRect(-w / 2 - b, -h / 2 - b, w + b * 2, h + b * 2, R + b); c.fill();
  c.lineWidth = 5; c.strokeStyle = INK; c.stroke();
  c.save(); c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, R); c.clip();
  const sy = o.srcY ?? 0, sh = o.srcH ?? img.naturalHeight - sy;
  c.drawImage(img, 0, sy, img.naturalWidth, sh, -w / 2, -h / 2, w, h);
  c.restore();
  if (o.label) { c.font = `800 26px ${SANS}`; c.fillStyle = YEL; c.textAlign = "center"; c.fillText(o.label, 0, -h / 2 - b - 18); }
  c.restore();
}

/** A ring that draws attention to a point on screen (for a tap or a key line). */
export function ring(c, x, y, r, age, o = {}) {
  if (age < 0 || age > (o.life ?? 0.8)) return;
  const k = easeOut(clamp(age / (o.life ?? 0.8)));
  c.save(); c.globalAlpha = 1 - k; c.lineWidth = 8 * (1 - k) + 2; c.strokeStyle = o.col ?? YEL;
  c.beginPath(); c.arc(x, y, r * (0.5 + k), 0, Math.PI * 2); c.stroke(); c.restore();
}

/** The big title: a small yellow label over huge outlined letters with a two-colour misregistered shadow. */
export function title(c, small, big, x, y, k = 1, o = {}) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.7), size = o.size ?? 190;
  c.save(); c.translate(x, y); c.rotate(o.rot ?? -0.04); c.scale(s, s);
  if (small) {
    c.font = `800 30px ${SANS}`; const sw = c.measureText(small.toUpperCase()).width + 30;
    c.save(); c.translate(-sw / 2 - 40, -size * 0.8); c.transform(1, 0, -0.1, 1, 0, 0);
    c.fillStyle = INK; c.fillRect(5, 5, sw, 44); c.fillStyle = YEL; c.fillRect(0, 0, sw, 44);
    c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(0, 0, sw, 44);
    c.fillStyle = INK; c.textBaseline = "middle"; c.fillText(small.toUpperCase(), 15, 23); c.restore();
  }
  c.font = `${size}px ${BANG}`; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  c.fillStyle = CYAN; c.fillText(big, -7, 6); c.fillStyle = PINK; c.fillText(big, 9, 9);
  c.lineWidth = size * 0.12; c.strokeStyle = INK; c.strokeText(big, 0, 0);
  const g = c.createLinearGradient(0, -size / 2, 0, size / 2); g.addColorStop(0, "#ffe37a"); g.addColorStop(1, "#ff8a1f");
  c.fillStyle = g; c.fillText(big, 0, 0);
  c.restore();
}

/** A plain banner of text in a box (like "TOMORROW, HE DOES IT ALL AGAIN."). */
export function banner(c, txt, x, y, k = 1, o = {}) {
  if (k <= 0) return;
  c.save(); c.globalAlpha = clamp(k * 1.5);
  c.font = `800 ${o.size ?? 30}px ${/[㐀-鿿]/.test(txt) ? ZH : SANS}`;
  const w = c.measureText(txt).width + 36, h = (o.size ?? 30) * 1.7;
  c.translate(x, y + (1 - easeOut(clamp(k))) * 20);
  c.fillStyle = INK; c.fillRect(-w / 2 + 5, -h / 2 + 5, w, h);
  c.fillStyle = o.bg ?? YEL; c.fillRect(-w / 2, -h / 2, w, h); c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  c.fillStyle = o.fg ?? INK; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, 0, 2);
  c.restore();
}

/** A small plain note (the disclaimer at the end). */
export function note(c, txt, x, y, k = 1) {
  if (k <= 0) return;
  c.save(); c.globalAlpha = clamp(k);
  c.font = `600 22px ${SANS}`; const w = c.measureText(txt).width + 24;
  c.fillStyle = "#ffffff"; c.fillRect(x - w / 2, y - 18, w, 36); c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, x, y);
  c.restore();
}
