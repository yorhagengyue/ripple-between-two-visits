// Set-building kit: blocks, rounded blocks, painted canvas textures, and common props (furniture, lamps, plants,
// windows with a painted view, wall posters, the alarm clock, pill boxes). Everything uses the cel-shaded toon()
// material so the comic pass treats it like the characters.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { hash } from "../core.js";

export const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
export const rbox = (w, h, d, r, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); o.position.set(x, y, z); return o; };
export const cyl = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 24) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y, z); return o; };
export const ball = (r, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), m); o.position.set(x, y, z); return o; };
export const group = (...kids) => { const g = new THREE.Group(); kids.forEach((k) => g.add(k)); return g; };
export const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; return o; };
export const shadowy = (g) => { g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; };

/** A plane with a painted canvas texture; lit (toon) by default, or flat (unlit) for screens and signs. */
export function painted(w, h, pxW, pxH, draw, o = {}) {
  const tex = canvasTex(pxW, pxH, draw);
  if (o.repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(...o.repeat); }
  const mat = o.unlit ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: !!o.transparent }) : toon("#ffffff", { map: tex, transparent: !!o.transparent });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return m;
}

/** Wooden planks (floor). */
export function planks(w, d, c1 = "#d9925a", c2 = "#c27c49") {
  const m = painted(w, d, 512, 512, (c, W, H) => {
    c.fillStyle = c1; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? c2 : c1; c.fillRect(0, i * 64, W, 64); c.fillStyle = "rgba(60,30,40,.35)"; c.fillRect(0, i * 64, W, 3);
      const off = hash(i) * 400; c.fillRect(off, i * 64, 3, 64); c.fillRect((off + 260) % W, i * 64, 3, 64); }
  }, { repeat: [w / 2, d / 2] });
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; return m;
}
/** Checker tiles (kitchen, clinic). */
export function tiles(w, d, c1 = "#bfe9de", c2 = "#f6efe0", n = 2) {
  const m = painted(w, d, 256, 256, (c, W, H) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { c.fillStyle = (x + y) % 2 ? c1 : c2; c.fillRect(x * 128, y * 128, 128, 128); }
    c.strokeStyle = "rgba(60,40,90,.25)"; c.lineWidth = 3; c.strokeRect(0, 0, 128, 128); c.strokeRect(128, 128, 128, 128);
  }, { repeat: [w / n, d / n] });
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; return m;
}
/** A painted wall with optional wainscot band and a subtle speckle. */
export function wall(w, h, col = "#8c7be0", o = {}) {
  const m = painted(w, h, 512, 512, (c, W, H) => {
    c.fillStyle = col; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${0.05 + hash(i) * 0.06})`; c.beginPath(); c.arc(hash(i * 3) * W, hash(i * 7) * H, 1.5 + hash(i * 11) * 2.5, 0, 7); c.fill(); }
    if (o.band) { c.fillStyle = o.band; c.fillRect(0, H * 0.72, W, H * 0.28); c.fillStyle = "rgba(40,20,60,.3)"; c.fillRect(0, H * 0.72, W, 5); }
  }, { repeat: o.repeat });
  m.receiveShadow = true; return m;
}

/** A window: frame, sill and a painted view behind glass. view(c, W, H) paints the outside. Lit from inside it glows a bit. */
export function windowView(w, h, view, o = {}) {
  const g = new THREE.Group();
  const v = painted(w, h, 768, Math.round((768 * h) / w), view, { unlit: true });
  v.position.z = -0.02; g.add(v);
  const fr = toon(o.frame ?? "#f4efe6");
  g.add(box(w + 0.12, 0.06, 0.08, fr, 0, h / 2 + 0.03, 0), box(w + 0.12, 0.06, 0.08, fr, 0, -h / 2 - 0.03, 0));
  g.add(box(0.06, h, 0.08, fr, -w / 2 - 0.03, 0, 0), box(0.06, h, 0.08, fr, w / 2 + 0.03, 0, 0), box(0.04, h, 0.05, fr, 0, 0, 0));
  g.add(box(w + 0.24, 0.05, 0.2, fr, 0, -h / 2 - 0.08, 0.08));
  if (o.curtains) for (const s of [-1, 1]) g.add(box(0.28, h + 0.3, 0.04, toon(o.curtains), s * (w / 2 + 0.12), 0.05, 0.08));
  return g;
}

/** A dawn or dusk sky with ribbon clouds (like the reference's pink ribbons), as a painter function. */
export function skyPainter(top = "#ff9e6b", mid = "#ffc98a", low = "#ffe2a8", ribbon = "#ff7fb0") {
  return (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(0.55, mid); g.addColorStop(1, low);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = ribbon; c.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const y = H * (0.14 + i * 0.1); c.lineWidth = H * 0.035;
      c.beginPath(); for (let x = -20; x <= W + 20; x += 20) c.lineTo(x, y + Math.sin(x / 70 + i) * H * 0.015); c.stroke();
      c.strokeStyle = "rgba(255,255,255,.45)"; c.lineWidth = 2; c.beginPath(); for (let x = -20; x <= W + 20; x += 20) c.lineTo(x, y - H * 0.012 + Math.sin(x / 70 + i) * H * 0.015); c.stroke();
      c.strokeStyle = ribbon;
    }
  };
}
/** HDB-style slab blocks seen through a window: a painter function. */
export function hdbViewPainter(o = {}) {
  const sky = skyPainter(o.top, o.mid, o.low, o.ribbon);
  return (c, W, H) => {
    sky(c, W, H);
    const cols = ["#8a7bd8", "#a08ee6", "#7564c4", "#b39cf0"];
    for (let i = 0; i < 7; i++) {
      const bw = W * (0.12 + hash(i) * 0.08), bh = H * (0.35 + hash(i * 5) * 0.45), x = (i / 7) * W + hash(i * 9) * 30, y = H - bh;
      c.fillStyle = cols[i % 4]; c.fillRect(x, y, bw, bh);
      c.fillStyle = "rgba(40,20,80,.35)"; c.fillRect(x + bw * 0.86, y, bw * 0.14, bh);
      for (let r = 0; r < bh / 22; r++) for (let k = 0; k < 4; k++) {
        const lit = hash(i * 100 + r * 7 + k) > 0.62;
        c.fillStyle = lit ? "#ffe27a" : "rgba(40,30,90,.55)"; c.fillRect(x + 8 + k * (bw - 16) / 4, y + 10 + r * 22, (bw - 16) / 4 - 6, 10);
      }
    }
    c.fillStyle = "#4d3f9a"; c.fillRect(0, H * 0.94, W, H * 0.06);
  };
}

/** A framed poster with a painted picture. */
export function poster(w, h, draw, frame = "#3a2a5a") {
  const g = new THREE.Group();
  g.add(box(w + 0.05, h + 0.05, 0.03, toon(frame), 0, 0, 0));
  const p = painted(w, h, 256, Math.round((256 * h) / w), draw); p.position.z = 0.017; g.add(p);
  return g;
}

/** A table lamp: base, stem, shade that glows. */
export function lamp(h = 0.45, shade = "#fff1c9") {
  const g = new THREE.Group();
  g.add(cyl(0.09, 0.11, 0.04, toon("#3a2f55"), 0, 0.02, 0));
  g.add(cyl(0.012, 0.012, h * 0.7, toon("#3a2f55"), 0, h * 0.37, 0));
  g.add(cyl(0.08, 0.15, 0.17, toon(shade, { emissive: "#ffd98a", emissiveIntensity: 0.9 }), 0, h * 0.78, 0));
  return g;
}
/** A potted plant made of leaf balls. */
export function plant(s = 1, leaf = "#3fae6b") {
  const g = new THREE.Group();
  g.add(cyl(0.12 * s, 0.09 * s, 0.2 * s, toon("#e56f4f"), 0, 0.1 * s, 0));
  for (let i = 0; i < 5; i++) g.add(ball((0.1 + hash(i) * 0.05) * s, toon(i % 2 ? leaf : "#5cc77f"), (hash(i * 3) - 0.5) * 0.18 * s, (0.3 + hash(i * 5) * 0.2) * s, (hash(i * 7) - 0.5) * 0.18 * s));
  return g;
}
/** The bedside alarm clock with an LED time that is repainted on demand: clock.setTime("7:00", on). */
export function alarmClock() {
  const g = new THREE.Group();
  g.add(rbox(0.22, 0.14, 0.1, 0.03, toon("#e2433f"), 0, 0.08, 0));
  for (const s of [-1, 1]) { g.add(ball(0.035, toon("#3a2f55"), s * 0.07, 0.17, 0)); g.add(box(0.02, 0.03, 0.02, toon("#3a2f55"), s * 0.08, 0.005, 0)); }
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 128;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.085), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(0, 0.08, 0.051); g.add(face);
  let last = "";
  g.userData.setTime = (txt, on = true) => {
    const key = txt + on; if (key === last) return; last = key;
    const c = cv.getContext("2d"); c.fillStyle = "#1a2a1e"; c.fillRect(0, 0, 256, 128);
    c.font = "900 92px 'Courier New', monospace"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = on ? "#7dffb0" : "#2f5a3e"; c.shadowColor = "#7dffb0"; c.shadowBlur = on ? 16 : 0; c.fillText(txt, 128, 70);
    tex.needsUpdate = true;
  };
  g.userData.setTime("7:00");
  return g;
}
/** A weekly pill organiser (seven coloured lids). */
export function pillBox() {
  const g = new THREE.Group();
  const cols = ["#ff6f91", "#ffb347", "#ffe66d", "#6be3a4", "#5cc7ff", "#8f7dff", "#e57bff"];
  cols.forEach((c, i) => g.add(rbox(0.045, 0.035, 0.06, 0.01, toon(c), (i - 3) * 0.05, 0.02, 0)));
  return g;
}
/** A medicine box with a printed label face (front). */
export function medBox(label, col = "#ffffff", w = 0.12, h = 0.08, d = 0.05) {
  const g = new THREE.Group();
  g.add(box(w, h, d, toon(col), 0, h / 2, 0));
  const f = painted(w * 0.94, h * 0.9, 256, Math.round((256 * h) / w), (c, W, H) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H); c.fillStyle = "#2a1f4a"; c.font = `800 ${Math.round(H * 0.24)}px "Segoe UI", sans-serif`;
    c.textAlign = "center"; c.fillText(label, W / 2, H * 0.42); c.fillStyle = "#e2433f"; c.fillRect(0, H * 0.7, W, H * 0.12);
  });
  f.position.set(0, h / 2, d / 2 + 0.001); g.add(f);
  return g;
}
