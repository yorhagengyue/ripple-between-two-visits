// The Ripple lab: the reference's LAB 3 (its frames around 46–69 s), made ours. Neon-violet wall tiles with cyan and
// pink neon strips, a white turntable pedestal with a glowing rim in the middle of a dark floor disc ringed with hazard
// dashes, a scanner hood hanging over it, gauges on a post, a big wall screen, shelves of glowing flasks, a "RIPPLE
// LAB" neon sign, a window onto the night estate, a server rack with blinking lights, a coil with a glowing ball, a
// workbench with a tray, beakers, a microscope and a clipboard, cables across the floor.
//
// Read-only for other chapters: `useLab()` returns the one shared instance (registered as the set "lab"), and every
// shot that shows it must call `lab.userData.tick(t, { ... })` to set its moving parts (they are shared state).
//   tick(t, { spin, power, gauge, gauge2, screen, scanner })
//     spin    turntable angle in radians (default: slow idle turn from t)
//     power   0..1 lights in the lab (neon, glows); 0 = dark before the CLICK
//     gauge   0..1 needle of the big gauge, gauge2 the small one (default: a gentle idle wobble)
//     screen  [key, painter(c, W, H)] for the big wall screen; repainted only when the key changes (default: the
//             Ripple logo, logoScreen(); key "idle")
//     scanner 0..1 the scanner hood's beam
// World layout (metres): pedestal at the origin (top surface y = PEDESTAL.top, radius PEDESTAL.r); back wall z = -3.2;
// window on the back wall at x ≈ -5.1; shelf and sign at x ≈ -2.3; big screen at x ≈ 2.6; workbench at x ≈ 3.4, z ≈ -1.5.
// Since 16 Oct the idle wall screen and the RIPPLE LAB sign carry Ripple's own logo (assets/brand/ripple-logo*.svg)
// instead of concentric rings. The logo is also exported for the 2D layer: drawLogo(c, variant, part, x, y, h, o).
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { hash, wob, clamp, seg, ease } from "../core.js";
import { STAGE } from "../stage.js";
import { box, rbox, cyl, ball, painted, windowView, plant, lamp, shadowy } from "./kit.js";

// ---- The Ripple logo ------------------------------------------------------------------------------------------------
// Parsed once from the SVG files into canvas paths, before any set is built (a top-level await: every chapter that
// imports this file waits for it). The SVGs are fetched as text because the render server sends .svg without an image
// type, so an <img> would not decode them. "full" is the brand original (teal #0E97A9, navy #113255, coral #F36B60) for
// light grounds; "light" is the copy with the navy parts near-white (#EEF6FF) for the lab's dark violet screens. The
// white paths in the original only patch the letter counters on a white page (the counters are already holes), so
// both variants skip them. Paths 0-5 are the mark (the P with its heartbeat), 6-12 the word "ripple".
const LOGO_FILES = { full: "assets/brand/ripple-logo.svg", light: "assets/brand/ripple-logo-light.svg" };
const LOGO = await (async () => {
  try {
    const out = {};
    const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    document.documentElement.appendChild(host);
    for (const [variant, url] of Object.entries(LOGO_FILES)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
      out[variant] = [...doc.querySelectorAll("path")]
        .map((p) => ({ d: p.getAttribute("d"), fill: (p.getAttribute("fill") || "none").toUpperCase() }))
        .filter((p) => p.fill !== "NONE" && p.fill !== "#FFFFFF")
        .map((p, i) => {
          const el = document.createElementNS("http://www.w3.org/2000/svg", "path"); el.setAttribute("d", p.d); host.appendChild(el);
          const len = el.getTotalLength();
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (let k = 0; k <= 96; k++) { const q = el.getPointAtLength((len * k) / 96); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
          host.removeChild(el);
          return { ...p, i, len, box: [x0, y0, x1, y1], p2d: new Path2D(p.d) };
        });
      if (out[variant].length !== 13) console.warn(`[lab] ${url}: expected 13 logo paths, found ${out[variant].length}`);
    }
    document.documentElement.removeChild(host);
    const boxOf = (ps) => ps.reduce((b, p) => [Math.min(b[0], p.box[0]), Math.min(b[1], p.box[1]), Math.max(b[2], p.box[2]), Math.max(b[3], p.box[3])], [1e9, 1e9, -1e9, -1e9]);
    out.boxes = { all: boxOf(out.full), mark: boxOf(out.full.slice(0, 6)), word: boxOf(out.full.slice(6)) };
    return out;
  } catch (e) {
    console.warn("[lab] the Ripple logo did not load; screens and sign show no logo:", e.message);
    return null;
  }
})();

/** The logo's bounding box in SVG units for part "all", "mark" or "word": [x0, y0, x1, y1] (null if it did not load). */
export const logoBox = (part = "all") => LOGO?.boxes[part] ?? null;

/** Paint the Ripple logo into a 2D context.
 *  variant "full" (brand colours, for white or cream grounds) or "light" (navy parts near-white, for dark grounds);
 *  part "all" (the mark and the word), "mark" or "word"; (x, y) the centre of that part's box; h its height in px.
 *  o.draw  seconds since the draw-on began (like ripple-logo-animated.svg: each path's outline traces itself, then its
 *          fill fades in while the outline thins); leave it undefined for the finished logo.
 *  o.stagger, o.stroke, o.fill  draw-on timing in seconds (defaults 0.03, 0.45, 0.25; the SVG's own are 0.09, 1.4, 0.5)
 *  o.width  outline width while drawing, in SVG units (default 4; the SVG's own is 2, too thin on film)
 *  o.glow, o.glowCol  a shadow blur in px and its colour (a screen glow); o.alpha  overall opacity. */
export function drawLogo(c, variant, part, x, y, h, o = {}) {
  if (!LOGO) return;
  const ps = LOGO[variant].slice(part === "mark" ? 0 : part === "word" ? 6 : 0, part === "mark" ? 6 : 13);
  const [x0, y0, x1, y1] = LOGO.boxes[part];
  const s = h / (y1 - y0);
  const st = o.stagger ?? 0.03, sd = o.stroke ?? 0.45, fd = o.fill ?? 0.25, w = o.width ?? 4;
  c.save();
  c.translate(x, y); c.scale(s, s); c.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  c.lineCap = "round"; c.lineJoin = "round";
  if (o.glow) { c.shadowColor = o.glowCol ?? "rgba(120,240,255,.6)"; c.shadowBlur = o.glow; }
  const a0 = o.alpha ?? 1;
  ps.forEach((p, j) => {
    c.fillStyle = c.strokeStyle = p.fill;
    if (o.draw === undefined) { c.globalAlpha = a0; c.lineWidth = 1; c.fill(p.p2d); c.stroke(p.p2d); return; }
    const t0 = j * st, ks = ease(seg(o.draw, t0, t0 + sd)), kf = seg(o.draw, t0 + sd, t0 + sd + fd);
    if (ks <= 0) return;
    if (kf > 0) { c.globalAlpha = a0 * kf; c.fill(p.p2d); }
    c.globalAlpha = a0;
    c.lineWidth = w + (1 - w) * kf;
    if (ks < 1) { c.setLineDash([p.len, p.len]); c.lineDashOffset = p.len * (1 - ks); } else c.setLineDash([]);
    c.stroke(p.p2d);
  });
  c.restore();
}
/** Seconds the draw-on of a part takes with the given timing (see drawLogo). */
export const logoDrawTime = (part = "all", o = {}) => ((part === "mark" ? 6 : part === "word" ? 7 : 13) - 1) * (o.stagger ?? 0.03) + (o.stroke ?? 0.45) + (o.fill ?? 0.25);

export const PEDESTAL = { x: 0, z: 0, top: 0.55, r: 1.15 };
export const LAB_WINDOW = new THREE.Vector3(-5.1, 2.25, -3.15);
export const LAB_SCREEN = new THREE.Vector3(2.6, 2.45, -3.12);
export const LAB_TRAY = new THREE.Vector3(3.0, 0.98, -1.35);

const NEON_C = "#46f2ff", NEON_P = "#ff4fb8", NEON_Y = "#ffd94a";

/** A canvas texture you can repaint later (for signs painted after the Bangers font has loaded). */
function liveTex(w, h) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { cv, tex, ctx: cv.getContext("2d") };
}

function tilePainter(c, W, H) {
  const n = 4, s = W / n;
  c.fillStyle = "#170f4c"; c.fillRect(0, 0, W, H);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = hash(x * 7 + y * 13 + 1);
    c.fillStyle = v > 0.88 ? "#5a3fc8" : v > 0.6 ? "#3c2fa0" : v > 0.3 ? "#352a92" : "#30278a";
    c.fillRect(x * s + 4, y * s + 4, s - 8, s - 8);
    c.fillStyle = "rgba(170,160,255,.28)"; c.fillRect(x * s + 4, y * s + 4, s - 8, 6); c.fillRect(x * s + 4, y * s + 4, 6, s - 8);
    c.fillStyle = "rgba(10,4,40,.38)"; c.fillRect(x * s + 4, y * s + s - 10, s - 8, 6); c.fillRect(x * s + s - 10, y * s + 4, 6, s - 8);
  }
}

function nightEstate(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#160f3e"); g.addColorStop(0.6, "#3b2585"); g.addColorStop(1, "#7a3f9a");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,230,${0.4 + hash(i) * 0.5})`; c.fillRect(hash(i * 3) * W, hash(i * 5) * H * 0.45, 2.5, 2.5); }
  c.fillStyle = "#fff3c4"; c.beginPath(); c.arc(W * 0.8, H * 0.18, H * 0.07, 0, 7); c.fill();
  const cols = ["#3d2f8a", "#4a3a9e", "#35287c", "#57439f"];
  for (let i = 0; i < 8; i++) {
    const bw = W * (0.1 + hash(i + 3) * 0.07), bh = H * (0.35 + hash(i * 5 + 1) * 0.4), x = (i / 8) * W + hash(i * 9) * 20, y = H - bh;
    c.fillStyle = cols[i % 4]; c.fillRect(x, y, bw, bh);
    for (let r = 0; r < bh / 20; r++) for (let k = 0; k < 4; k++) {
      const lit = hash(i * 100 + r * 7 + k + 5) > 0.55;
      c.fillStyle = lit ? (hash(i + r + k) > 0.5 ? "#ffe07a" : "#ffb8d0") : "rgba(20,10,60,.55)";
      c.fillRect(x + 6 + k * (bw - 12) / 4, y + 8 + r * 20, (bw - 12) / 4 - 5, 9);
    }
  }
  c.fillStyle = "#24184a"; c.fillRect(0, H * 0.95, W, H * 0.05);
}

/** A flask, beaker or round-bottom bottle filled with a glowing liquid. */
function flask(kind, col, s = 1) {
  const g = new THREE.Group();
  const liquid = toon(col, { emissive: col, emissiveIntensity: 0.55 });
  const glass = toon("#e9f6ff"), cork = toon("#c98a5a");
  if (kind === "cone") {
    g.add(cyl(0.025 * s, 0.1 * s, 0.17 * s, liquid, 0, 0.085 * s, 0, 16));
    g.add(cyl(0.024 * s, 0.024 * s, 0.09 * s, glass, 0, 0.21 * s, 0, 12));
    g.add(cyl(0.03 * s, 0.03 * s, 0.03 * s, cork, 0, 0.265 * s, 0, 12));
  } else if (kind === "round") {
    g.add(ball(0.085 * s, liquid, 0, 0.085 * s, 0));
    g.add(cyl(0.022 * s, 0.022 * s, 0.12 * s, glass, 0, 0.2 * s, 0, 12));
  } else if (kind === "tube") {
    g.add(cyl(0.022 * s, 0.022 * s, 0.22 * s, liquid, 0, 0.11 * s, 0, 12));
    g.add(cyl(0.026 * s, 0.026 * s, 0.03 * s, glass, 0, 0.235 * s, 0, 12));
  } else {
    g.add(cyl(0.065 * s, 0.065 * s, 0.15 * s, liquid, 0, 0.075 * s, 0, 18));
    g.add(cyl(0.07 * s, 0.07 * s, 0.03 * s, glass, 0, 0.165 * s, 0, 18));
  }
  return g;
}

/** A shelf with a neon underglow and a row of flasks. */
function shelf(len, seed, glow) {
  const g = new THREE.Group();
  g.add(box(len, 0.05, 0.32, toon("#d9dcf2"), 0, 0, 0.16));
  g.add(box(len, 0.025, 0.03, flat(glow), 0, -0.035, 0.31));
  for (const s of [-1, 1]) g.add(box(0.04, 0.2, 0.25, toon("#8d93c3"), s * (len / 2 - 0.15), -0.12, 0.13));
  const kinds = ["cone", "round", "beaker", "tube", "cone", "round"], cols = [NEON_P, NEON_Y, NEON_C, "#b78bff", "#7dffb0", NEON_P];
  const n = Math.floor(len / 0.3);
  for (let i = 0; i < n; i++) {
    const k = kinds[(i + seed) % kinds.length], col = cols[(i * 3 + seed) % cols.length];
    const f = flask(k, col, 0.95 + hash(i + seed * 7) * 0.4);
    f.position.set(-len / 2 + 0.2 + i * ((len - 0.4) / (n - 1)), 0.025, 0.15 + (hash(i * 11 + seed) - 0.5) * 0.08); g.add(f);
  }
  return g;
}

/** A dial gauge on a post: a coloured arc and a needle (userData.needle, rotate z). No words, no numbers. */
function gauge(w, h, postH) {
  const g = new THREE.Group();
  g.add(cyl(0.08, 0.12, postH, toon("#4b4790"), 0, postH / 2, 0, 12));
  const panel = new THREE.Group(); panel.position.y = postH + h / 2; g.add(panel);
  panel.add(rbox(w + 0.08, h + 0.08, 0.1, 0.03, toon("#1d1846"), 0, 0, 0));
  const face = painted(w, h, 512, Math.round((512 * h) / w), (c, W, H) => {
    c.fillStyle = "#0f0b2e"; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.78, r = W * 0.36;
    const segs = [["#ff5a6a", Math.PI, Math.PI * 1.33], ["#ffd94a", Math.PI * 1.33, Math.PI * 1.66], ["#3fe08a", Math.PI * 1.66, Math.PI * 2]];
    c.lineWidth = W * 0.06;
    for (const [col, a, b] of segs) { c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, r, a, b); c.stroke(); }
    c.strokeStyle = "#cfd6ff"; c.lineWidth = 4;
    for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; c.beginPath(); c.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); c.lineTo(cx + Math.cos(a) * r * 0.68, cy + Math.sin(a) * r * 0.68); c.stroke(); }
    c.strokeStyle = NEON_C; c.lineWidth = 3; c.strokeRect(8, 8, W - 16, H - 16);
  }, { unlit: true });
  face.position.z = 0.052; panel.add(face);
  const needle = new THREE.Group(); needle.position.set(0, -h * 0.28, 0.07); panel.add(needle);
  needle.add(box(0.025, w * 0.33, 0.012, flat("#ff3b5c"), 0, w * 0.15, 0));
  const hub = cyl(0.045, 0.045, 0.03, toon("#ff3b5c"), 0, 0, 0, 16); hub.rotation.x = Math.PI / 2; needle.add(hub);
  g.userData.needle = needle;
  return g;
}

/** The server rack with two LED pictures that alternate (blink). */
function rack() {
  const g = new THREE.Group();
  g.add(box(0.9, 2.1, 0.6, toon("#1d1840"), 0, 1.05, 0));
  const leds = (seed) => canvasTex(128, 256, (c, W, H) => {
    c.fillStyle = "#0b0820"; c.fillRect(0, 0, W, H);
    for (let r = 0; r < 14; r++) { c.fillStyle = "#231d4f"; c.fillRect(6, 6 + r * 18, W - 12, 14);
      for (let k = 0; k < 6; k++) { const v = hash(seed * 31 + r * 7 + k); if (v > 0.45) { c.fillStyle = v > 0.85 ? "#ff4fb8" : v > 0.7 ? "#ffd94a" : "#46ff9e"; c.fillRect(14 + k * 17, 10 + r * 18, 8, 6); } } }
  });
  const a = leds(1), b = leds(2);
  const m = new THREE.MeshBasicMaterial({ map: a, toneMapped: false });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.9), m); front.position.set(0, 1.05, 0.301); g.add(front);
  g.userData.blink = (t) => { m.map = Math.floor(t * 3) % 2 ? a : b; };
  return g;
}

/** The coil: stacked rings and a glowing ball on top (like the reference's). userData.ball for its glow. */
function coil() {
  const g = new THREE.Group();
  g.add(cyl(0.3, 0.36, 0.12, toon("#3b3680"), 0, 0.06, 0, 24));
  g.add(cyl(0.05, 0.05, 1.3, toon("#8d93c3"), 0, 0.75, 0, 10));
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 10, 28), toon(i % 2 ? "#ff9a4a" : "#ffd27a"));
    r.rotation.x = Math.PI / 2; r.position.y = 0.35 + i * 0.12; g.add(r);
  }
  const ballMat = new THREE.MeshBasicMaterial({ color: "#d9f6ff", toneMapped: false });
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), ballMat); b.position.y = 1.55; g.add(b);
  g.userData.ballMat = ballMat;
  return g;
}

/** The workbench: a metal table with a tray, beakers, a microscope, a lamp, a plant and a clipboard. */
function workbench() {
  const g = new THREE.Group();
  const top = toon("#cfd3ef"), leg = toon("#3a3478");
  g.add(rbox(2.4, 0.08, 0.9, 0.02, top, 0, 0.9, 0));
  g.add(box(2.3, 0.6, 0.04, toon("#6b5fd0"), 0, 0.5, -0.4));
  for (const [x, z] of [[-1.12, 0.38], [1.12, 0.38], [-1.12, -0.38], [1.12, -0.38]]) g.add(box(0.07, 0.86, 0.07, leg, x, 0.43, z));
  g.add(box(0.7, 0.4, 0.8, toon("#4a42a0"), 0.75, 0.6, 0)); // drawers
  for (let i = 0; i < 2; i++) g.add(box(0.12, 0.03, 0.02, toon("#ffd94a"), 0.75, 0.7 - i * 0.18, 0.41));
  // microscope
  const mic = new THREE.Group(); mic.position.set(0.85, 0.94, -0.1);
  mic.add(box(0.22, 0.04, 0.26, toon("#f2f0ff"), 0, 0.02, 0), box(0.06, 0.32, 0.06, toon("#f2f0ff"), 0, 0.18, -0.08));
  const tube = cyl(0.04, 0.04, 0.22, toon("#2a2650"), 0, 0.3, -0.01, 12); tube.rotation.x = 0.5; mic.add(tube);
  mic.add(box(0.14, 0.02, 0.12, toon("#2a2650"), 0, 0.12, 0.02)); g.add(mic);
  // beakers and flasks
  [["beaker", NEON_C, -0.95, 0.15], ["cone", NEON_P, -0.7, -0.2], ["round", NEON_Y, -1.0, -0.25], ["tube", "#7dffb0", 0.45, -0.25], ["beaker", "#b78bff", 0.3, 0.2]]
    .forEach(([k, col, x, z]) => { const f = flask(k, col, 1.35); f.position.set(x, 0.94, z); g.add(f); });
  const l = lamp(0.5, "#fff1c9"); l.position.set(1.05, 0.94, 0.25); g.add(l);
  const p = plant(0.8); p.position.set(-1.05, 0.94, 0.28); g.add(p);
  // a clipboard lying on the bench
  const cb = clipboard(); cb.rotation.set(-Math.PI / 2, 0, 0.3); cb.position.set(0.25, 0.96, 0.05); cb.scale.setScalar(0.9); g.add(cb);
  return g;
}

/** A clipboard (also used as a held prop): board, clip and a painted sheet. Faces +z, about 0.24 x 0.32 m. */
export function clipboard() {
  const g = new THREE.Group();
  g.add(rbox(0.24, 0.32, 0.015, 0.01, toon("#b57a45"), 0, 0, 0));
  const sheet = painted(0.21, 0.26, 128, 160, (c, W, H) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#3a2f6a"; for (let i = 0; i < 9; i++) c.fillRect(14, 22 + i * 15, (W - 28) * (0.5 + hash(i) * 0.5), 4);
    c.strokeStyle = "#1fae6b"; c.lineWidth = 4; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(W - 30, 24 + i * 30); c.lineTo(W - 24, 30 + i * 30); c.lineTo(W - 14, 18 + i * 30); c.stroke(); }
  });
  sheet.position.set(0, -0.015, 0.009); g.add(sheet);
  g.add(box(0.1, 0.04, 0.025, toon("#c9ced8"), 0, 0.15, 0.012));
  return g;
}

/** A cable lying on the floor along points [[x, z], ...]. */
function cable(pts, col, r = 0.045) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z, y]) => new THREE.Vector3(x, y ?? r, z)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 64, r, 8, false), toon(col));
}

/** A wall-screen painter with Ripple's logo (the light copy) glowing on the dark screen; for tick's `screen` option.
 *  cy and h are the logo's centre and height as fractions of the screen's height, cx its centre as a fraction of the
 *  width (the idle screen: 0.5, 0.8, 0.5); a chapter whose cast stands in front of the screen can lift, shrink or
 *  slide it so the word "ripple" stays clear of their heads. */
export function logoScreen(cy = 0.5, h = 0.8, cx = 0.5) {
  return (c, W, H) => {
    c.fillStyle = "#0e0a2c"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(70,242,255,.12)"; c.lineWidth = 2;
    for (let x = 0; x < W; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // a soft teal light behind the logo, then the logo with a halo
    const g = c.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, H * h * 0.78);
    g.addColorStop(0, "rgba(14,151,169,.30)"); g.addColorStop(1, "rgba(14,151,169,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    drawLogo(c, "light", "all", W * cx, H * cy, H * h, { glow: 26, glowCol: "rgba(110,235,255,.55)" });
    drawLogo(c, "light", "all", W * cx, H * cy, H * h);
    // corner brackets, so it reads as a screen
    c.strokeStyle = "rgba(70,242,255,.7)"; c.lineWidth = 5;
    for (const [x, y, dx, dy] of [[22, 22, 1, 1], [W - 22, 22, -1, 1], [22, H - 22, 1, -1], [W - 22, H - 22, -1, -1]]) {
      c.beginPath(); c.moveTo(x, y + dy * 46); c.lineTo(x, y); c.lineTo(x + dx * 46, y); c.stroke();
    }
  };
}
const idleScreen = logoScreen();

export function buildLab() {
  const g = new THREE.Group();
  const neon = []; // [material, colour] pairs dimmed by power
  const nmat = (col) => { const m = new THREE.MeshBasicMaterial({ color: col, toneMapped: false }); neon.push([m, new THREE.Color(col)]); return m; };

  // floor: big dark tiles, the raised disc with a cyan ring, hazard dashes
  const floor = painted(20, 18, 256, 256, (c, W, H) => {
    c.fillStyle = "#281e66"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#30247a"; c.fillRect(0, 0, W / 2, H / 2); c.fillRect(W / 2, H / 2, W / 2, H / 2);
    c.strokeStyle = "#1a1248"; c.lineWidth = 4; c.strokeRect(0, 0, W / 2, H / 2); c.strokeRect(W / 2, H / 2, W / 2, H / 2);
  }, { repeat: [10, 9] });
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 4); floor.receiveShadow = true; g.add(floor);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.75, 0.04, 64), toon("#3a2c8a")); disc.position.y = 0.02; disc.receiveShadow = true; g.add(disc);
  const discRing = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.03, 6, 96), nmat(NEON_C)); discRing.rotation.x = Math.PI / 2; discRing.position.y = 0.045; g.add(discRing);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.1, d = box(0.36, 0.012, 0.1, toon("#ffd94a", { emissive: "#ffb000", emissiveIntensity: 0.25 }), Math.cos(a) * 3.15, 0.006, Math.sin(a) * 3.15);
    d.rotation.y = -a + Math.PI / 2; g.add(d);
  }

  // walls: back wall and two side walls of violet tiles; neon strips
  const W = 15, Hh = 5.6;
  const back = painted(W, Hh, 512, 512, tilePainter, { repeat: [W / 2.2, Hh / 2.2] }); back.position.set(0, Hh / 2, -3.2); back.receiveShadow = true; g.add(back);
  for (const s of [-1, 1]) {
    const side = painted(12, Hh, 512, 512, tilePainter, { repeat: [12 / 2.2, Hh / 2.2] });
    side.position.set(s * 7.5, Hh / 2, 2.8); side.rotation.y = -s * Math.PI / 2; side.receiveShadow = true; g.add(side);
    g.add(box(0.05, 0.06, 12, nmat(NEON_C), s * 7.45, 1.25, 2.8), box(0.05, 0.05, 12, nmat(NEON_P), s * 7.45, 3.35, 2.8));
  }
  g.add(box(W, 0.07, 0.05, nmat(NEON_C), 0, 1.25, -3.17));
  g.add(box(W, 0.06, 0.05, nmat(NEON_P), 0, 3.35, -3.17));
  g.add(box(W, 0.09, 0.05, nmat(NEON_C), 0, 5.0, -3.17));
  g.add(box(W, 0.25, 0.12, toon("#231a5a"), 0, 0.12, -3.12)); // skirting
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, 12), toon("#1c1450")); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, Hh, 2.8); g.add(ceil);

  // the window onto the night estate (the one the camera came through)
  const win = windowView(2.0, 1.5, nightEstate, { frame: "#2a2266" }); win.position.copy(LAB_WINDOW); g.add(win);
  g.add(box(2.3, 0.05, 0.05, nmat(NEON_P), LAB_WINDOW.x, LAB_WINDOW.y + 0.85, -3.12));
  g.add(box(2.1, 0.6, 0.35, toon("#4a42a0"), LAB_WINDOW.x, 0.3, -3.0)); // a low cabinet under it
  [["round", NEON_Y, -5.7], ["beaker", NEON_C, -5.35], ["cone", NEON_P, -4.6]].forEach(([k, col, x]) => { const f = flask(k, col, 1.3); f.position.set(x, 0.6, -2.95); g.add(f); });

  // shelves of flasks
  const sh1 = shelf(2.6, 0, NEON_P); sh1.position.set(-2.3, 3.0, -3.2); g.add(sh1);
  const sh2 = shelf(2.4, 3, NEON_C); sh2.position.set(-2.3, 2.15, -3.2); g.add(sh2);
  const sh3 = shelf(1.8, 5, NEON_P); sh3.position.set(5.3, 3.3, -3.2); g.add(sh3);

  // the sign: RIPPLE LAB in cyan neon (painted when first shown, once Bangers has loaded)
  const sign = liveTex(1024, 256);
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true, toneMapped: false }));
  signMesh.position.set(-2.3, 4.2, -3.192); g.add(signMesh);
  const paintSign = () => {
    const c = sign.ctx, w = 1024, h = 256; c.clearRect(0, 0, w, h);
    c.font = '170px "Bangers", "Arial Black", sans-serif'; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = NEON_C; c.shadowBlur = 30; c.fillStyle = "#c8fbff"; c.fillText("RIPPLE LAB", w / 2 + 50, h / 2 + 8);
    c.shadowBlur = 0;
    // Ripple's mark (the light copy) where the rings were, with a neon halo
    drawLogo(c, "light", "mark", 102, h / 2, 172, { glow: 18, glowCol: NEON_C });
    drawLogo(c, "light", "mark", 102, h / 2, 172);
    sign.tex.needsUpdate = true;
  };
  paintSign();
  let signPainted = false;

  // gauges on posts, left of the pedestal
  const g1 = gauge(0.9, 0.62, 1.15); g1.position.set(-2.55, 0, -2.2); g1.rotation.y = 0.2; g.add(g1);
  const g2 = gauge(0.5, 0.36, 0.75); g2.position.set(-3.45, 0, -2.4); g2.rotation.y = 0.3; g.add(g2);

  // the coil and the rack
  const cl = coil(); cl.position.set(-4.0, 0, -1.6); g.add(cl);
  const rk = rack(); rk.position.set(6.2, 0, -2.75); g.add(rk);
  const rk2 = rack(); rk2.position.set(5.25, 0, -2.75); g.add(rk2);

  // the big wall screen
  const scr = liveTex(1024, 576);
  const scrMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.63), new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false }));
  scrMesh.position.copy(LAB_SCREEN); g.add(scrMesh);
  g.add(rbox(3.08, 1.8, 0.08, 0.04, toon("#1b1640"), LAB_SCREEN.x, LAB_SCREEN.y, -3.17));
  g.add(box(3.1, 0.035, 0.04, nmat(NEON_C), LAB_SCREEN.x, LAB_SCREEN.y + 0.92, -3.1));
  let scrKey = "";

  // the pedestal: white drum, glowing turntable top with notches, cyan rim; its base ring
  const ped = new THREE.Group(); g.add(ped);
  ped.add(cyl(1.3, 1.36, 0.08, toon("#2b2270"), 0, 0.04, 0, 48));
  ped.add(cyl(PEDESTAL.r - 0.04, PEDESTAL.r + 0.1, PEDESTAL.top - 0.05, toon("#e9e4fb"), 0, (PEDESTAL.top - 0.05) / 2 + 0.03, 0, 48));
  const top = new THREE.Group(); top.position.y = PEDESTAL.top - 0.04; ped.add(top);
  top.add(cyl(PEDESTAL.r - 0.05, PEDESTAL.r - 0.05, 0.04, toon("#a9e2ff", { emissive: "#3aa8ff", emissiveIntensity: 0.18 }), 0, 0.02, 0, 48));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, n = box(0.2, 0.012, 0.045, toon("#ffffff"), Math.cos(a) * (PEDESTAL.r - 0.2), 0.045, Math.sin(a) * (PEDESTAL.r - 0.2));
    n.rotation.y = -a; top.add(n);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PEDESTAL.r - 0.03, 0.04, 8, 72), nmat(NEON_C)); rim.rotation.x = Math.PI / 2; rim.position.y = PEDESTAL.top - 0.02; ped.add(rim);
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(PEDESTAL.r + 0.08, 0.025, 6, 72), nmat("#b78bff")); rim2.rotation.x = Math.PI / 2; rim2.position.y = 0.1; ped.add(rim2);

  // the scanner hood over the pedestal, and its beam (a cone of light)
  const hood = new THREE.Group(); hood.position.set(0, 3.25, 0); g.add(hood);
  hood.add(cyl(0.05, 0.05, 2.5, toon("#8d93c3"), 0, 1.25, 0, 10));
  hood.add(cyl(0.18, 0.42, 0.35, toon("#ffc23a"), 0, 0, 0, 24));
  const hoodRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 40), nmat(NEON_C)); hoodRing.rotation.x = Math.PI / 2; hoodRing.position.y = -0.17; hood.add(hoodRing);
  const beamMat = new THREE.MeshBasicMaterial({ color: "#7ff4ff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.0, 2.6, 32, 1, true), beamMat); beam.position.y = -1.48; hood.add(beam);

  // the workbench (with the tray for "things to tell the doctor" sitting on it at LAB_TRAY)
  const wb = workbench(); wb.position.set(3.4, 0, -1.55); g.add(wb);

  // cables from the pedestal to the rack and the coil
  g.add(cable([[0.9, 0.9], [2.0, 1.1], [3.4, 0.2], [4.6, -1.6], [5.3, -2.4]], "#1e1748"));
  g.add(cable([[1.0, 0.6], [2.4, 0.5], [4.0, -0.4], [5.8, -2.3]], "#2b7fa8", 0.035));
  g.add(cable([[-0.9, 0.7], [-2.2, 0.6], [-3.4, -0.6], [-3.95, -1.5]], "#1e1748"));
  g.add(cable([[-1.0, 0.4], [-2.0, -0.6], [-2.5, -2.1]], "#c94f9a", 0.03));

  // foreground clutter for depth: crates and a stool at the front corners
  g.add(rbox(0.7, 0.55, 0.6, 0.04, toon("#ff9a4a"), -5.2, 0.275, 1.9), rbox(0.55, 0.45, 0.5, 0.04, toon("#ffc23a"), -5.0, 0.775, 1.95));
  g.add(rbox(0.6, 0.6, 0.6, 0.04, toon("#5f52c8"), 5.4, 0.3, 1.6));
  const pl = plant(1.6); pl.position.set(-6.3, 0, -2.3); g.add(pl);

  // lights of its own: a cyan glow from the pedestal and a pink one by the shelves
  const pedLight = new THREE.PointLight("#62e6ff", 1.6, 6, 2); pedLight.position.set(0, 0.25, 1.9); g.add(pedLight);
  const pinkLight = new THREE.PointLight("#ff5fc0", 3, 7, 2); pinkLight.position.set(-3.2, 2.6, -1.8); g.add(pinkLight);

  // real shadows: everything casts and receives, except the big surfaces that would shade the whole room (ceiling,
  // walls, floor), the see-through beam and the flat signs
  shadowy(g);
  for (const o of [floor, back, ceil, beam, signMesh, scrMesh, disc]) o.castShadow = false;
  g.traverse((o) => { if (o.isMesh && o.geometry?.type === "PlaneGeometry") o.castShadow = false; });

  g.userData = {
    top, beam, beamMat, hood, needle1: g1.userData.needle, needle2: g2.userData.needle, coilBall: cl.userData.ballMat,
    win, screenMesh: scrMesh, pedLight, pinkLight,
    /** Set every moving part for time t; see the header. */
    tick(t, o = {}) {
      if (!signPainted && document.fonts && document.fonts.check('64px "Bangers"')) { paintSign(); signPainted = true; }
      const power = clamp(o.power ?? 1);
      for (const [m, c] of neon) m.color.copy(c).multiplyScalar(0.12 + 0.88 * power);
      pedLight.intensity = 1.6 * power; pinkLight.intensity = 3 * power;
      // the coil ball glows steadily: its brightness stays above the bloom threshold (0.86) with only a slow, small
      // pulse, so it never pops between dull and blazing from one frame to the next
      cl.userData.ballMat.color.set("#e6fbff").multiplyScalar(0.2 + 0.8 * power * (0.97 + 0.03 * wob(t, 0.45)));
      top.rotation.y = o.spin ?? t * 0.35;
      g1.userData.needle.rotation.z = -((o.gauge ?? 0.55 + wob(t, 0.4) * 0.06) - 0.5) * Math.PI;
      g2.userData.needle.rotation.z = -((o.gauge2 ?? 0.4 + wob(t, 0.7, 1) * 0.08) - 0.5) * Math.PI;
      rk.userData.blink(t); rk2.userData.blink(t + 0.17);
      beamMat.opacity = clamp(o.scanner ?? 0) * 0.13; // light enough that the faces inside it stay silver
      beam.visible = (o.scanner ?? 0) > 0.01;
      const [key, painter] = o.screen ?? ["idle", idleScreen];
      if (key !== scrKey) { scr.ctx.save(); painter(scr.ctx, 1024, 576); scr.ctx.restore(); scr.tex.needsUpdate = true; scrKey = key; }
      if (power < 1) { scrMesh.material.color.setScalar(0.1 + 0.9 * power); } else scrMesh.material.color.setScalar(1);
    },
  };
  return g;
}

/** The one shared lab instance, registered as the set "lab". */
export function useLab() { return STAGE.get("lab") ?? STAGE.set("lab", buildLab()); }

const _off = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** Place a prop (a child of a set group at the world origin) in an actor's hand for this frame. Call after
 *  STAGE.pose(). hand: 0 = the bot's own left, 1 = its right. off: offset in the hand's frame; rot: Euler offset. */
export function holdProp(prop, actor, hand, off = [0, 0, 0], rot = [0, 0, 0]) {
  actor.g.updateMatrixWorld(true);
  actor.hands[hand].matrixWorld.decompose(prop.position, prop.quaternion, _off);
  const s = _off.x;
  _off.set(...off).multiplyScalar(s).applyQuaternion(prop.quaternion); prop.position.add(_off);
  prop.quaternion.multiply(_q.setFromEuler(_e.set(...rot)));
  prop.scale.setScalar(1);
  prop.visible = true;
  return prop;
}

const _v = new THREE.Vector3();
/** Where a world point lands on the 1920 x 1080 canvas. Call inside an ov closure (after the 3D frame is painted, so
 *  the camera's matrices are current). Returns [x, y]. */
export function toScreen(x, y, z) {
  _v.set(x, y, z).project(STAGE.camera);
  return [(_v.x + 1) * 960, (1 - _v.y) * 540];
}
/** Screen position of the top of an actor's head (plus `up` metres). Call inside an ov closure. */
export function headScreen(actor, up = 0.62) {
  actor.head.getWorldPosition(_v); _v.y += up;
  _v.project(STAGE.camera);
  return [(_v.x + 1) * 960, (1 - _v.y) * 540];
}
/** A visor face sequence: faceAt(lt, [[0, "code"], [1.2, "wow"], ...]) with a 0.08 s blink before each change, and
 *  an idle blink every `every` seconds on calm faces. */
export function faceAt(lt, seq, every = 3.3) {
  let f = seq[0][1];
  for (let i = 1; i < seq.length; i++) {
    const [ti, fi] = seq[i];
    if (lt >= ti) { f = fi; continue; }
    if (lt >= ti - 0.08) return "blink";
    break;
  }
  if ((f === "code" || f === "happy") && every && ((lt + 1.7) % every) < 0.08) return "blink";
  return f;
}
