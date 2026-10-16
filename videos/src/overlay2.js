// The explainer layer for the second half (shared, read-only for chapter agents): the big caption box with a small
// source line, the green rubber stamp of the challenge's own words, the experiment card, the stat card, the feature
// label, and the URL card with the QR code. Same inks and fonts as overlay.js.
import { clamp, backOut, easeOut, seg, wob, boil, hash } from "./core.js";
import { INK, YEL } from "./overlay.js";

const BANG = '"Bangers", "Impact", sans-serif';
const SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
export const GREEN = "#1fae6b", PAPER = "#fff6e4";

function wrap(c, text, maxW) {
  const words = text.split(" "), lines = [];
  let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}

/** The big caption: up to two lines of plain words in a yellow box, a small source line under it in a white strip.
 *  (x, y) is the box's top-left; k is the 0..1 entrance. */
export function caption(c, text, x, y, k = 1, o = {}) {
  if (k <= 0) return;
  const size = o.size ?? 46, maxW = o.maxW ?? 880;
  c.save();
  c.font = `800 ${size}px ${SANS}`;
  const lines = wrap(c, text, maxW);
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + size * 1.1, lh = size * 1.22, h = lines.length * lh + size * 0.55;
  const dx = (1 - backOut(clamp(k), 1.4)) * -60;
  c.globalAlpha = clamp(k * 2);
  c.translate(x + dx, y); c.transform(1, 0, -0.06, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(8, 8, w, h); c.fillStyle = o.bg ?? YEL; c.fillRect(0, 0, w, h);
  c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(0, 0, w, h);
  c.fillStyle = INK; c.textBaseline = "top";
  lines.forEach((l, i) => c.fillText(l, size * 0.55, size * 0.3 + i * lh));
  if (o.source) {
    c.font = `600 ${Math.round(size * 0.48)}px ${SANS}`;
    const sw = c.measureText(o.source).width + 24, sh = size * 0.85;
    c.fillStyle = "#ffffff"; c.fillRect(0, h + 6, sw, sh); c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(0, h + 6, sw, sh);
    c.fillStyle = INK; c.textBaseline = "middle"; c.fillText(o.source, 12, h + 6 + sh / 2);
  }
  c.restore();
}

/** A green rubber stamp of the challenge's words: thumps in (scale 1.6 → 1), slight rotation, inked texture. The
 *  stamp is painted on its own layer first, so the knocked-out ink specks never punch holes through the frame. */
let stampLayer;
export function stamp(c, text, x, y, age, o = {}) {
  if (age < 0) return;
  const k = clamp(age / 0.22), s = 1 + (1 - easeOut(k)) * 0.7, rot = o.rot ?? -0.12;
  const size = o.size ?? 64, col = o.col ?? GREEN;
  stampLayer ??= document.createElement("canvas");
  const L = stampLayer, g = L.getContext("2d");
  g.font = `${size}px ${BANG}`;
  const w = g.measureText(text).width + size * 0.9, h = size * 1.35;
  L.width = Math.ceil(w + 20); L.height = Math.ceil(h + 20);
  g.clearRect(0, 0, L.width, L.height);
  g.translate(L.width / 2, L.height / 2);
  g.lineWidth = 8; g.strokeStyle = col; g.strokeRect(-w / 2, -h / 2, w, h);
  g.lineWidth = 3; g.strokeRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18);
  g.font = `${size}px ${BANG}`; g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 0, 4);
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 70; i++) { g.beginPath(); g.arc((hash(i * 3 + size) - 0.5) * w, (hash(i * 7 + size) - 0.5) * h, 1 + hash(i * 11) * 3, 0, 7); g.fill(); }
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over";
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s); c.globalAlpha = clamp(k * 1.5) * 0.92;
  c.drawImage(L, -L.width / 2, -L.height / 2);
  c.restore();
}

/** The experiment card, bottom-left like the time card: "EXP. 01" big, the name small. */
export function expCard(c, num, name, k = 1) {
  if (k <= 0) return;
  c.save();
  c.font = `60px ${BANG}`; const tw = c.measureText(`EXP. ${num}`).width;
  c.font = `800 27px ${SANS}`; const lw = c.measureText(name.toUpperCase()).width;
  const w = tw + lw + 54, h = 58, x = 34 - (1 - backOut(clamp(k), 1.6)) * (w + 60), y = 990;
  c.translate(x, y); c.transform(1, 0, -0.08, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(6, 6, w, h); c.fillStyle = YEL; c.fillRect(0, 0, w, h); c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(0, 0, w, h);
  c.fillStyle = INK; c.textBaseline = "middle";
  c.font = `60px ${BANG}`; c.fillText(`EXP. ${num}`, 14, h / 2 + 3);
  c.font = `800 27px ${SANS}`; c.fillText(name.toUpperCase(), tw + 34, h / 2 + 2);
  c.restore();
}

/** A stat card: a huge number, a label under it and a small scope line. (x, y) is the centre. */
export function statCard(c, big, label, scope, x, y, k = 1, o = {}) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.8), w = o.w ?? 520, h = o.h ?? 330;
  c.save(); c.translate(x, y); c.rotate(o.rot ?? 0); c.scale(s, s);
  c.fillStyle = INK; c.fillRect(-w / 2 + 10, -h / 2 + 12, w, h);
  c.fillStyle = o.bg ?? PAPER; c.fillRect(-w / 2, -h / 2, w, h); c.lineWidth = 5; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `${o.bigSize ?? 120}px ${BANG}`; c.lineWidth = 10; c.strokeStyle = INK; c.lineJoin = "round"; c.strokeText(big, 0, -h * 0.17);
  const g = c.createLinearGradient(0, -h * 0.4, 0, 0); g.addColorStop(0, "#ffe37a"); g.addColorStop(1, "#ff8a1f"); c.fillStyle = g; c.fillText(big, 0, -h * 0.17);
  c.fillStyle = INK; c.font = `800 30px ${SANS}`;
  wrap(c, label, w - 50).forEach((l, i) => c.fillText(l, 0, h * 0.14 + i * 36));
  if (scope) { c.font = `600 19px ${SANS}`; c.fillStyle = "#4a3f66"; wrap(c, scope, w - 40).forEach((l, i, a) => c.fillText(l, 0, h / 2 - 22 - (a.length - 1 - i) * 23)); }
  c.restore();
}

/** A feature label: the challenge's words in a dark tag with a green tick, and one line under it. */
export function featureLabel(c, title, line, x, y, k = 1, o = {}) {
  if (k <= 0) return;
  c.save(); c.globalAlpha = clamp(k * 2);
  const dx = (1 - backOut(clamp(k), 1.5)) * 80; c.translate(x + dx, y);
  c.font = `52px ${BANG}`; const tw = c.measureText(title).width + 110;
  c.fillStyle = INK; c.fillRect(6, 6, tw, 74); c.fillStyle = "#2a1f4a"; c.fillRect(0, 0, tw, 74);
  c.fillStyle = GREEN; c.beginPath(); c.arc(40, 37, 22, 0, 7); c.fill();
  c.strokeStyle = "#fff"; c.lineWidth = 7; c.lineCap = "round"; c.beginPath(); c.moveTo(29, 38); c.lineTo(37, 46); c.lineTo(52, 28); c.stroke();
  c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(title, 76, 40);
  if (line) {
    c.font = `700 ${o.lineSize ?? 34}px ${SANS}`; c.fillStyle = o.lineCol ?? "#fff6e4"; c.textBaseline = "top";
    c.shadowColor = INK; c.shadowOffsetX = 3; c.shadowOffsetY = 3;
    wrap(c, line, o.maxW ?? 760).forEach((l, i) => c.fillText(l, 4, 96 + i * 44));
  }
  c.restore();
}

/** The URL card with the QR image (assets/qr.png). img may be null while loading. */
/** note: optional small lines under the address (c14 v7: the web version is a demo for the challenge). */
export function urlCard(c, url, qrImg, x, y, k = 1, note = null) {
  if (k <= 0) return;
  const s = backOut(clamp(k), 1.6);
  c.save(); c.translate(x, y); c.scale(s, s);
  const w = 980, h = 260;
  c.fillStyle = INK; c.fillRect(-w / 2 + 10, -h / 2 + 12, w, h); c.fillStyle = PAPER; c.fillRect(-w / 2, -h / 2, w, h);
  c.lineWidth = 5; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  if (qrImg) c.drawImage(qrImg, -w / 2 + 25, -h / 2 + 25, h - 50, h - 50);
  c.fillStyle = INK; c.textBaseline = "middle"; c.font = `800 30px ${SANS}`; c.fillText("Try it", -w / 2 + h, -48);
  c.font = `800 54px ${SANS}`; c.fillText(url, -w / 2 + h, 18); // a font with lowercase: the URL reads as typed
  if (note) { c.font = `600 25px ${SANS}`; note.forEach((l, i) => c.fillText(l, -w / 2 + h, 70 + i * 31)); }
  c.restore();
}
