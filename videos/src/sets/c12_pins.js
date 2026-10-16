// Helpers for c12 and c13 (private to those chapters): project 3D points to the 1920 x 1080 comic layer, and draw
// infographic label pins (an anchor dot, a leader line, a cream label box) that stay attached to 3D objects while the
// camera moves. Projection reads STAGE.camera, so call these inside ov closures (after the camera is placed).
import * as THREE from "three";
import { STAGE } from "../stage.js";
import { clamp, backOut, seg } from "../core.js";
import { INK, YEL } from "../overlay.js";

export const SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
export const BANG = '"Bangers", "Impact", sans-serif';
const v = new THREE.Vector3(), f = new THREE.Vector3();

/** world point [x, y, z] -> { x, y } on the 1920 x 1080 canvas; ok = in front of the camera */
export function toScreen(p) {
  const cam = STAGE.camera; cam.updateMatrixWorld();
  v.set(p[0], p[1], p[2]).project(cam);
  return { x: (v.x + 1) * 960, y: (1 - v.y) * 540, ok: v.z > -1 && v.z < 1 };
}
/** pixels per metre for a surface at world point p facing the camera */
export function pxPerM(p) {
  const cam = STAGE.camera; cam.updateMatrixWorld();
  cam.getWorldDirection(f);
  const depth = v.set(p[0], p[1], p[2]).sub(cam.position).dot(f);
  return 540 / (Math.max(0.05, depth) * Math.tan((cam.fov * Math.PI) / 360));
}

function wrapLines(c, text, maxW) {
  const words = text.split(" "), out = [];
  let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}

/** A label pin. a = screen anchor {x, y}; the box sits at anchor + (dx, dy) (its left edge if dx >= 0, else its right
 *  edge; vertically centred), or with its centre at o.abs. title: string; o.sub: a second line (o.subK x the title
 *  size); o.chip: a dark code chip ("Next.js"); o.size: the title size in px.
 *  k: 0..1 entrance (the leader line draws, then the box pops). o.alpha fades it. */
export function pin(c, a, title, k, o = {}) {
  if (k <= 0 || !a) return;
  // the sub line is often the fact itself ("answer model + a second model that checks"), so it stays close to the
  // title's size (o.subK) and bold enough to read at 720p
  const dx = o.dx ?? 60, dy = o.dy ?? -120, ts = o.size ?? 30, ss = Math.round(ts * (o.subK ?? 0.85)), maxW = o.maxW ?? 520;
  c.save(); c.globalAlpha = o.alpha ?? 1;
  c.font = `800 ${ts}px ${SANS}`;
  const tl = wrapLines(c, title, maxW);
  let w = Math.max(...tl.map((l) => c.measureText(l).width));
  c.font = `700 ${ss}px ${SANS}`;
  const sl = o.sub ? wrapLines(c, o.sub, maxW) : [];
  sl.forEach((l) => (w = Math.max(w, c.measureText(l).width)));
  c.font = `700 ${ss}px Consolas, "Courier New", monospace`;
  const cw = o.chip ? c.measureText(o.chip).width + 22 : 0;
  w = Math.max(w, cw);
  const pad = 16, lh = ts * 1.18, slh = ss * 1.25;
  const h = pad * 2 + tl.length * lh + sl.length * slh + (o.chip ? ss * 1.5 + 6 : 0) - 4;
  const bw = w + pad * 2;
  // o.abs = [cx, cy]: the box's centre fixed on screen (the leader still follows the anchor), for a moving camera
  let bx = o.abs ? o.abs[0] - bw / 2 : dx >= 0 ? a.x + dx : a.x + dx - bw, by = o.abs ? o.abs[1] - h / 2 : a.y + dy - h / 2;
  bx = clamp(bx, o.minX ?? 32, 1880 - bw); by = clamp(by, o.minY ?? 32, (o.maxY ?? 1040) - h); // 30 px margins (+ the shadow)
  // the leader line: from the anchor to the nearest point of the box
  const lk = clamp(k / 0.35);
  const ex = clamp(a.x, bx, bx + bw), ey = clamp(a.y, by, by + h);
  c.strokeStyle = INK; c.lineWidth = 4; c.lineCap = "round";
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + (ex - a.x) * lk, a.y + (ey - a.y) * lk); c.stroke();
  c.fillStyle = o.dot ?? YEL; c.beginPath(); c.arc(a.x, a.y, 10, 0, 7); c.fill(); c.lineWidth = 4; c.stroke();
  const bk = seg(k, 0.3, 1);
  if (bk > 0) {
    const s = backOut(bk, 2.2);
    c.translate(ex, ey); c.scale(s, s); c.translate(-ex, -ey);
    c.fillStyle = INK; c.fillRect(bx + 7, by + 8, bw, h);
    c.fillStyle = o.bg ?? "#fff6e4"; c.fillRect(bx, by, bw, h);
    c.lineWidth = 4; c.strokeStyle = INK; c.strokeRect(bx, by, bw, h);
    if (o.accent) { c.fillStyle = o.accent; c.fillRect(bx, by, 10, h); c.strokeRect(bx, by, 10, h); }
    c.textBaseline = "top"; c.textAlign = "left";
    let y = by + pad;
    c.fillStyle = INK; c.font = `800 ${ts}px ${SANS}`;
    tl.forEach((l) => { c.fillText(l, bx + pad + (o.accent ? 6 : 0), y); y += lh; });
    c.fillStyle = "#3a2f5c"; c.font = `700 ${ss}px ${SANS}`;
    sl.forEach((l) => { c.fillText(l, bx + pad + (o.accent ? 6 : 0), y); y += slh; });
    if (o.chip) {
      y += 4; c.font = `700 ${ss}px Consolas, "Courier New", monospace`;
      c.fillStyle = "#1d1630"; c.beginPath(); c.roundRect(bx + pad + (o.accent ? 6 : 0), y, cw, ss * 1.5, 8); c.fill();
      c.fillStyle = "#7dffcf"; c.textBaseline = "middle"; c.fillText(o.chip, bx + pad + 11 + (o.accent ? 6 : 0), y + ss * 0.78);
    }
  }
  c.restore();
}

/** A red push pin seen from the front, at (x, y), r in px. */
export function pushPin(c, x, y, r = 14, col = "#ff4f6d") {
  c.save();
  c.fillStyle = "rgba(26,16,48,.45)"; c.beginPath(); c.ellipse(x + r * 0.45, y + r * 0.6, r * 0.9, r * 0.55, 0, 0, 7); c.fill();
  c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  c.lineWidth = Math.max(2, r * 0.22); c.strokeStyle = INK; c.stroke();
  c.fillStyle = "rgba(255,255,255,.75)"; c.beginPath(); c.arc(x - r * 0.32, y - r * 0.32, r * 0.3, 0, 7); c.fill();
  c.restore();
}
