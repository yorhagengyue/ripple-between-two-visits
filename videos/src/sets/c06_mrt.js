// c06 · MRT sets: a Circle Line platform with full-height platform screen doors (PSDs), a three-car train that arrives
// behind them, and the carriage interior. One frame of reference for all three, so they line up when shown together:
//   the track runs along x (the train travels toward +x); the PSD line is z = 0; the platform is z > 0 (floor y = 0);
//   the train's skin faces the platform at z = -0.25; its interior spans z -3.05 (far wall) .. -0.35 (near wall).
//   With the train stopped (train.position.x = 0), train doors and PSD doors are centred at x = k * PITCH.
// The platform's signs swap between Bishan and Caldecott (setStation); the carriage windows show a tunnel that scrolls
// (setRun), and two warm lamps sweep past outside the windows with it.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { box, rbox, cyl, painted } from "./kit.js";
import { hash } from "../core.js";

export const CC = "#fa9e0d"; // Circle Line orange
export const PITCH = 5.75;   // door spacing
const SANS = '"Segoe UI", system-ui, sans-serif', ZH = '"Microsoft YaHei", "PingFang SC", sans-serif';

/** Keep a mesh out of the comic pass's normal/depth render, so glass does not hide the ink lines of what is behind it. */
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export function noInk(m) {
  const keep = new THREE.Matrix4();
  m.onBeforeRender = (r, s, cam, geo, mat) => { if (mat.isMeshNormalMaterial) { keep.copy(m.matrixWorld); m.matrixWorld.copy(ZERO); } };
  m.onAfterRender = (r, s, cam, geo, mat) => { if (mat.isMeshNormalMaterial) m.matrixWorld.copy(keep); };
  return m;
}
/** Shadows: every lit mesh casts and receives, except glass, unlit signs and anything under a group or mesh flagged
 *  userData.noCast (ceilings and the carriage's near wall, which would otherwise shade the whole set from the key light). */
function castShadows(g) {
  g.traverse((o) => {
    if (!o.isMesh) return;
    let nc = false; for (let q = o; q; q = q.parent) if (q.userData?.noCast) { nc = true; break; }
    const m = o.material;
    o.castShadow = !nc && !(m.transparent || m.isMeshBasicMaterial);
    o.receiveShadow = !m.isMeshBasicMaterial;
  });
  return g;
}
const unlitMat = (tex, o = {}) => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, ...o });
const plane = (w, h, mat) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

// ---------------------------------------------------------------- painters
function stationSign(name, zh, codes) {
  return (c, W, H) => {
    c.fillStyle = "#1d2250"; c.fillRect(0, 0, W, H);
    c.fillStyle = CC; c.fillRect(0, H - H * 0.1, W, H * 0.1);
    let x = W * 0.05;
    codes.forEach(([code, col]) => {
      c.font = `900 ${H * 0.26}px ${SANS}`; const w = c.measureText(code).width + H * 0.16;
      c.fillStyle = col; c.beginPath(); c.roundRect(x, H * 0.12, w, H * 0.36, H * 0.1); c.fill();
      c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(code, x + H * 0.08, H * 0.31); x += w + H * 0.08;
    });
    c.fillStyle = "#ffffff"; c.textBaseline = "alphabetic";
    c.font = `800 ${H * 0.36}px ${SANS}`; c.fillText(name, W * 0.05, H * 0.82);
    const nw = c.measureText(name).width;
    c.font = `700 ${H * 0.3}px ${ZH}`; c.fillText(zh, W * 0.05 + nw + H * 0.22, H * 0.8);
  };
}
const STATIONS = {
  bishan: stationSign("Bishan", "碧山", [["CC15", CC], ["NS17", "#d42e12"]]),
  caldecott: stationSign("Caldecott", "加利谷", [["CC17", CC], ["TE9", "#9d5b25"]]),
};
function ledPainter(lines) {
  return (c, W, H) => {
    c.fillStyle = "#120d10"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#ffb43a"; c.shadowColor = "#ff9a1a"; c.shadowBlur = 10; c.textBaseline = "middle";
    lines.forEach(([txt, x, align, size]) => { c.font = `700 ${H * (size ?? 0.5)}px "Consolas", monospace`; c.textAlign = align ?? "left"; c.fillText(txt, W * x, H * 0.53); });
    c.shadowBlur = 0; c.fillStyle = "rgba(0,0,0,.35)"; for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1.5);
  };
}
/** The platform's PSD glass: a frame and glass with a frosted orange band; `door` adds the leaf's sticker. */
function psdPainter(door) {
  return (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = "rgba(150,210,255,.16)"; c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "rgba(255,255,255,.0)"); g.addColorStop(0.45, "rgba(255,255,255,.22)"); g.addColorStop(0.55, "rgba(255,255,255,.0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 3;
    for (const o of [0.18, 0.26]) { c.beginPath(); c.moveTo(W * o, H * 0.08); c.lineTo(W * (o + 0.32), H * 0.36); c.stroke(); }
    const by = H * 0.43; c.fillStyle = "rgba(250,158,13,.55)"; c.fillRect(0, by, W, H * 0.05);
    c.fillStyle = "rgba(255,255,255,.55)"; for (let x = 6; x < W; x += 14) { c.beginPath(); c.arc(x, by + H * 0.08, 3, 0, 7); c.fill(); }
    if (door) { c.fillStyle = "#ffffff"; c.beginPath(); c.arc(W * 0.5, H * 0.62, W * 0.12, 0, 7); c.fill(); c.strokeStyle = "#e2433f"; c.lineWidth = 7; c.stroke();
      c.beginPath(); c.moveTo(W * 0.42, H * 0.58); c.lineTo(W * 0.58, H * 0.66); c.stroke(); c.fillStyle = "#2a2f66"; c.fillRect(W * 0.47, H * 0.585, W * 0.06, H * 0.07); }
    c.lineWidth = 10; c.strokeStyle = "#39407a"; c.strokeRect(5, 5, W - 10, H - 10);
  };
}
/** A train window seen from outside: dark glass with a warm lit interior and a few standing silhouettes. */
function trainWindow(c, x, y, w, h, seed) {
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#ffd58a"); g.addColorStop(0.3, "#e9a35a"); g.addColorStop(1, "#5a3a6e");
  c.fillStyle = g; c.beginPath(); c.roundRect(x, y, w, h, 10); c.fill();
  c.save(); c.clip();
  for (let i = 0; i < 3; i++) if (hash(seed * 13 + i) > 0.35) {
    const px = x + w * (0.15 + i * 0.3 + hash(seed + i) * 0.1), ph = h * (0.55 + hash(seed * 7 + i) * 0.3);
    c.fillStyle = ["#3b2c5e", "#4a2f52", "#2f3a62"][i]; c.fillRect(px, y + h - ph, w * 0.13, ph); c.fillRect(px + w * 0.01, y + h - ph - h * 0.17, w * 0.11, h * 0.16);
  }
  c.fillStyle = "rgba(20,24,60,.35)"; c.fillRect(x, y, w, h);
  c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 4; c.beginPath(); c.moveTo(x + w * 0.1, y + h * 0.15); c.lineTo(x + w * 0.35, y + h * 0.15); c.stroke();
  c.restore();
  c.lineWidth = 6; c.strokeStyle = "#2a2f55"; c.beginPath(); c.roundRect(x, y, w, h, 10); c.stroke();
}
/** The train's side between doors: silver, a window band, the orange line stripe and a violet pin line. */
function skinPainter(len, nWin, seed) {
  return (c, W, H) => {
    const ppm = W / len, yOf = (m) => H - (m + 0.75) * ppm; // metres above the floor -> canvas y
    c.fillStyle = "#e9edf5"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#2b2f52"; c.fillRect(0, yOf(-0.1), W, H - yOf(-0.1));
    c.fillStyle = CC; c.fillRect(0, yOf(0.62), W, 0.16 * ppm);
    c.fillStyle = "#7f5bff"; c.fillRect(0, yOf(0.42), W, 0.05 * ppm);
    c.fillStyle = "#c9d0e2"; c.fillRect(0, yOf(2.3), W, 0.06 * ppm);
    const ww = (len - 0.3 * (nWin + 1)) / nWin;
    for (let i = 0; i < nWin; i++) trainWindow(c, (0.3 + i * (ww + 0.3)) * ppm, yOf(1.78), ww * ppm, 0.82 * ppm, seed + i);
  };
}
/** the number on a platform door's plate: dark navy on white, with a small orange Circle Line chip */
function doorNumber(n) {
  return (c, W, H) => {
    c.fillStyle = "#f4f4f8"; c.fillRect(0, 0, W, H);
    c.fillStyle = CC; c.beginPath(); c.roundRect(W * 0.06, H * 0.2, H * 0.6, H * 0.6, 6); c.fill();
    c.fillStyle = "#1d2250"; c.font = `900 ${H * 0.7}px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n), W * 0.58, H * 0.55);
  };
}
function leafPainter(c, W, H) {
  const ppm = W / 0.7, yOf = (m) => H - m * ppm;
  c.fillStyle = "#dfe4ee"; c.fillRect(0, 0, W, H);
  c.fillStyle = CC; c.fillRect(0, yOf(0.78), W, 0.16 * ppm);
  trainWindow(c, 0.12 * ppm, yOf(1.72), 0.46 * ppm, 0.72 * ppm, 3);
  c.fillStyle = "#b9c0d6"; c.fillRect(0, 0, W, 6); c.fillRect(0, H - 6, W, 6);
}
function cabPainter(c, W, H) {
  c.fillStyle = "#e9edf5"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#121530"; c.beginPath(); c.roundRect(W * 0.08, H * 0.2, W * 0.84, H * 0.3, 30); c.fill();
  c.fillStyle = "#ffb43a"; c.font = `700 ${H * 0.06}px Consolas, monospace`; c.textAlign = "center"; c.fillText("CC  HarbourFront", W * 0.5, H * 0.27);
  c.fillStyle = CC; c.fillRect(0, H * 0.6, W, H * 0.06);
  c.fillStyle = "#2b2f52"; c.fillRect(0, H * 0.78, W, H * 0.22);
}
/** Platform floor tiles: warm grey granite, 2 x 2 tiles of 0.6 m. */
function floorTiles(c, W, H) {
  c.fillStyle = "#d9d3ca"; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) { c.fillStyle = hash(i) > 0.5 ? "rgba(90,80,110,.10)" : "rgba(255,255,255,.25)"; c.fillRect(hash(i * 3) * W, hash(i * 7) * H, 2 + hash(i * 5) * 3, 2 + hash(i * 9) * 3); }
  c.fillStyle = "#c9c2b8"; c.fillRect(0, 0, W / 2, H / 2); c.fillRect(W / 2, H / 2, W / 2, H / 2);
  for (let i = 0; i < 400; i++) { c.fillStyle = "rgba(90,80,110,.10)"; c.fillRect(hash(i * 13) * W, hash(i * 17) * H, 2, 2); }
  c.strokeStyle = "#a79fa0"; c.lineWidth = 3; c.strokeRect(0, 0, W / 2, H / 2); c.strokeRect(W / 2, H / 2, W / 2, H / 2); c.strokeRect(W / 2, 0, W / 2, H / 2); c.strokeRect(0, H / 2, W / 2, H / 2);
}
function tactile(c, W, H) {
  c.fillStyle = "#ffcf1f"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#e0a800"; for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) { c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); }
  c.fillStyle = "rgba(255,255,255,.45)"; for (let y = 8; y < H; y += 20) for (let x = 8; x < W; x += 20) { c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
}
/** The queue marks in front of each door: green arrows out of the train in the middle, white lanes either side. */
function queueMarks(c, W, H) {
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#2fbf5a";
  for (let i = 0; i < 2; i++) { const y = H * (0.25 + i * 0.4); c.beginPath(); c.moveTo(W * 0.5, y + H * 0.28); c.lineTo(W * 0.38, y); c.lineTo(W * 0.44, y); c.lineTo(W * 0.5, y + H * 0.13); c.lineTo(W * 0.56, y); c.lineTo(W * 0.62, y); c.closePath(); c.fill(); }
  c.fillStyle = "rgba(255,255,255,.9)";
  for (const x of [0.06, 0.2, 0.8, 0.94]) c.fillRect(W * x - 5, H * 0.05, 10, H * 0.9);
}
function tunnelWall(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#151a3e"); g.addColorStop(1, "#0c0f26"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 6; i++) { c.fillStyle = "rgba(120,140,220,.12)"; c.fillRect(i * W / 6, 0, 6, H); }
  c.fillStyle = "#2a2f5e"; c.fillRect(0, H * 0.3, W, 6); c.fillRect(0, H * 0.34, W, 4); c.fillRect(0, H * 0.62, W, 8);
  c.fillStyle = "#ffcf7a"; c.fillRect(W * 0.45, H * 0.22, 18, 8);
}
/** What the carriage windows see: the tunnel rushing by. One tile = 8 m with one warm lamp and its streak. */
function tunnelRush(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0b0e26"); g.addColorStop(0.5, "#182050"); g.addColorStop(1, "#0b0e26");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(140,160,255,${0.05 + hash(i) * 0.12})`; c.fillRect(hash(i * 3) * W, H * (0.1 + hash(i * 5) * 0.8), W * (0.08 + hash(i * 7) * 0.25), 2 + hash(i * 9) * 3); }
  c.fillStyle = "#2f3570"; c.fillRect(0, H * 0.33, W, H * 0.03); c.fillRect(0, H * 0.4, W, H * 0.015); c.fillRect(0, H * 0.72, W, H * 0.04);
  // the lamp: a hot core with a long warm streak trailing toward +u (the lamps run toward -x)
  const ly = H * 0.26, lx = W * 0.3;
  const s = c.createLinearGradient(lx, 0, lx + W * 0.45, 0); s.addColorStop(0, "rgba(255,190,90,.95)"); s.addColorStop(1, "rgba(255,120,40,0)");
  c.fillStyle = s; c.fillRect(lx, ly - H * 0.05, W * 0.45, H * 0.1);
  c.fillStyle = "#fff4cf"; c.beginPath(); c.ellipse(lx, ly, W * 0.025, H * 0.06, 0, 0, 7); c.fill();
  const s2 = c.createLinearGradient(lx, 0, lx + W * 0.3, 0); s2.addColorStop(0, "rgba(255,170,80,.35)"); s2.addColorStop(1, "rgba(255,170,80,0)");
  c.fillStyle = s2; c.fillRect(lx, H * 0.45, W * 0.3, H * 0.4);
}
function routeMap(next) {
  return (c, W, H) => {
    c.fillStyle = "#fbfbf6"; c.fillRect(0, 0, W, H);
    c.fillStyle = CC; c.beginPath(); c.roundRect(10, H * 0.18, 92, H * 0.36, 12); c.fill();
    c.fillStyle = "#fff"; c.font = `900 ${H * 0.24}px ${SANS}`; c.textBaseline = "middle"; c.fillText("CIRCLE", 18, H * 0.37);
    const names = ["Serangoon", "Lorong Chuan", "Bishan", "Marymount", "Caldecott", "Botanic Gardens"];
    const x0 = 160, x1 = W - 70, y = H * 0.38;
    c.strokeStyle = CC; c.lineWidth = 12; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    names.forEach((n, i) => {
      const x = x0 + (i / (names.length - 1)) * (x1 - x0);
      c.fillStyle = "#fff"; c.strokeStyle = "#3a3f6a"; c.lineWidth = 5; c.beginPath(); c.arc(x, y, 12, 0, 7); c.fill(); c.stroke();
      c.fillStyle = n === next ? "#d42e12" : "#2a2f55"; c.font = `${n === next ? 800 : 600} ${H * 0.2}px ${SANS}`; c.textAlign = "center"; c.fillText(n, x, H * 0.78);
    });
    c.textAlign = "left";
  };
}
function adPainter(kind) {
  return (c, W, H) => {
    if (kind === "kaya") {
      c.fillStyle = "#ffe08a"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#c97a2c"; c.beginPath(); c.roundRect(W * 0.08, H * 0.25, W * 0.3, H * 0.5, 16); c.fill();
      c.fillStyle = "#6fbf4a"; c.fillRect(W * 0.1, H * 0.45, W * 0.26, H * 0.08);
      c.fillStyle = "#3a2a1a"; c.font = `900 ${H * 0.3}px ${SANS}`; c.fillText("KAYA TOAST", W * 0.43, H * 0.48);
      c.fillStyle = "#e2433f"; c.font = `900 ${H * 0.26}px ${SANS}`; c.fillText("SHIOK!", W * 0.43, H * 0.82);
    } else if (kind === "kind") {
      c.fillStyle = "#7fd8ff"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff6fb0"; c.font = `900 ${H * 0.5}px ${SANS}`; c.fillText("♥", W * 0.06, H * 0.7);
      c.fillStyle = "#1d2250"; c.font = `900 ${H * 0.28}px ${SANS}`; c.fillText("Offer your seat", W * 0.28, H * 0.46);
      c.font = `700 ${H * 0.2}px ${SANS}`; c.fillText("to those who need it more", W * 0.28, H * 0.78);
    } else {
      c.fillStyle = "#ff8fb0"; c.fillRect(0, 0, W, H);
      const g = c.createRadialGradient(W * 0.2, H * 0.5, 4, W * 0.2, H * 0.5, H * 0.6); g.addColorStop(0, "#fff6d0"); g.addColorStop(1, "#ff8fb0"); c.fillStyle = g; c.fillRect(0, 0, W * 0.4, H);
      c.fillStyle = "#3a1f5a"; c.font = `900 ${H * 0.3}px ${SANS}`; c.fillText("KOPI-O", W * 0.42, H * 0.48);
      c.font = `700 ${H * 0.2}px ${SANS}`; c.fillText("kosong, peng", W * 0.42, H * 0.8);
    }
  };
}
function backWall(c, W, H) {
  c.fillStyle = "#3d63c9"; c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(20,30,90,.35)"; c.lineWidth = 2;
  for (let y = 0; y < H; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  for (let x = 0; x < W; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let i = 0; i < 40; i++) { c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(Math.floor(hash(i) * 16) * 32, Math.floor(hash(i * 3) * 16) * 32, 32, 32); }
  c.fillStyle = CC; c.fillRect(0, H * 0.3, W, H * 0.06);
  c.fillStyle = "#26357a"; c.fillRect(0, H * 0.86, W, H * 0.14);
}

// ---------------------------------------------------------------- the platform, with the train
export function buildPlatform() {
  const g = new THREE.Group();
  const X0 = -44, X1 = 5.8, LEN = X1 - X0, XC = (X0 + X1) / 2, ZB = 6.6;
  const U = {}; g.userData = U;

  const floor = painted(LEN, ZB, 256, 256, floorTiles, { repeat: [LEN / 1.2, ZB / 1.2] });
  floor.rotation.x = -Math.PI / 2; floor.position.set(XC, 0, ZB / 2); floor.receiveShadow = true; g.add(floor);
  const strip = painted(LEN, 0.32, 128, 32, tactile, { repeat: [LEN / 1.28, 1] });
  strip.rotation.x = -Math.PI / 2; strip.position.set(XC, 0.004, 0.78); strip.receiveShadow = true; g.add(strip);
  g.add(box(LEN, 0.03, 0.22, toon("#8a90b0"), XC, 0.0, -0.08)); // PSD sill
  const qMat = toon("#ffffff", { map: canvasTex(256, 192, queueMarks), transparent: true });
  // ---- the platform screen doors
  const leafTex = canvasTex(256, 640, psdPainter(true)), fixTex = canvasTex(256, 640, psdPainter(false));
  const leafMat = unlitMat(leafTex, { transparent: true, depthWrite: false }), fixMat = unlitMat(fixTex, { transparent: true, depthWrite: false });
  const postMat = toon("#39407a"), headMat = toon("#232a5c");
  const signTex = { bishan: canvasTex(512, 160, STATIONS.bishan), caldecott: canvasTex(512, 160, STATIONS.caldecott) };
  const signMat = toon("#ffffff", { map: signTex.bishan });
  U.signMat = signMat; U.signTex = signTex;
  const psdLeaves = [], trainLights = [];
  for (let k = -8; k <= 0; k++) {
    const xd = k * PITCH;
    for (const s of [-1, 1]) {
      const leaf = noInk(plane(0.8, 2.18, leafMat)); leaf.position.set(xd + s * 0.4, 1.09, 0.1); leaf.userData = { xd, s }; g.add(leaf); psdLeaves.push(leaf);
      g.add(box(0.08, 2.2, 0.16, postMat, xd + s * 0.84, 1.1, 0));
    }
    const qm = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.15), qMat); qm.rotation.x = -Math.PI / 2; qm.position.set(xd, 0.006, 0.6); g.add(qm);
    const fw = (PITCH - 1.68) / 3;
    for (let j = 0; j < 3; j++) {
      const x = xd + 0.84 + fw * (j + 0.5);
      const f = noInk(plane(fw, 2.18, fixMat)); f.position.set(x, 1.09, -0.02); g.add(f);
      if (j < 2) g.add(box(0.06, 2.2, 0.12, postMat, xd + 0.84 + fw * (j + 1), 1.1, 0));
    }
    // station name plates on the header over the fixed panels
    const sp = plane(1.3, 0.4, signMat); sp.position.set(xd + PITCH / 2, 2.41, 0.125); sp.userData.noCast = true; g.add(sp);
    // the door's own number plate (painted with its number) and its warning lamp
    const np = box(0.5, 0.16, 0.02, toon("#f4f4f8"), xd, 2.41, 0.12); np.userData.noCast = true; g.add(np);
    const nn = plane(0.46, 0.13, unlitMat(canvasTex(184, 52, doorNumber(17 + k * 2)))); nn.position.set(xd, 2.41, 0.131); g.add(nn);
    const lamp = box(0.16, 0.06, 0.03, flat("#5a1a20"), xd, 2.27, 0.13); g.add(lamp); trainLights.push(lamp);
  }
  // the header and the bulkhead above it are slabs that must not shade the doorway (or the carriage seen through it)
  for (const m of [box(LEN, 0.44, 0.22, headMat, XC, 2.41, 0), box(LEN, 0.07, 0.24, toon(CC), XC, 2.16, 0), box(LEN, 0.8, 0.12, toon("#1c2252"), XC, 3.02, -0.04)]) { m.userData.noCast = true; g.add(m); }
  U.psdLeaves = psdLeaves; U.psdLamps = trainLights.map((m) => m.material);
  // the departure display over our door
  const ledTex = { bishan: canvasTex(600, 120, ledPainter([["CC", 0.04], ["HarbourFront", 0.17], ["1 min", 0.96, "right"]])),
    caldecott: canvasTex(600, 120, ledPainter([["CC", 0.04], ["HarbourFront", 0.17], ["5 min", 0.96, "right"]])) };
  const ledMat = unlitMat(ledTex.bishan); U.ledMat = ledMat; U.ledTex = ledTex;
  const led = plane(1.5, 0.3, ledMat);
  led.position.set(-0.9, 2.95, 0.05); g.add(led); g.add(box(1.6, 0.38, 0.06, toon("#2a2a3a"), -0.9, 2.95, 0.0));
  // ---- ceiling with strip lights
  const ceil = plane(LEN, ZB + 0.2, toon("#262d63")); ceil.rotation.x = Math.PI / 2; ceil.position.set(XC, 3.4, ZB / 2); ceil.userData.noCast = true; g.add(ceil);
  const nL = Math.floor(LEN / 3);
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.05, 0.22), flat("#fff1cf"), nL * 2);
  const mm = new THREE.Matrix4(); let n = 0;
  for (const z of [1.3, 3.8]) for (let i = 0; i < nL; i++) { mm.makeTranslation(X0 + 1.5 + i * 3, 3.37, z); lights.setMatrixAt(n++, mm); }
  g.add(lights);
  // ---- columns with signs, the back wall with ads and the big station sign
  for (const x of [-36, -28, -20, -12, -4]) {
    g.add(rbox(0.62, 3.4, 0.62, 0.06, toon("#3f5fc4"), x, 1.7, 4.6));
    g.add(box(0.66, 0.12, 0.66, toon(CC), x, 2.3, 4.6));
    const s = plane(0.58, 0.18, signMat); s.position.set(x + 0.315, 1.95, 4.6); s.rotation.y = Math.PI / 2; g.add(s);
    const s2 = plane(0.58, 0.18, signMat); s2.position.set(x, 1.95, 4.29); g.add(s2);
  }
  const back = painted(LEN, 3.4, 512, 512, backWall, { repeat: [LEN / 3.4, 1] }); back.rotation.y = Math.PI; back.position.set(XC, 1.7, ZB); g.add(back);
  const bigSign = plane(2.6, 0.8, signMat); bigSign.rotation.y = Math.PI; bigSign.position.set(-0.2, 2.15, ZB - 0.03); g.add(bigSign);
  [["kaya", -3.4], ["kind", 2.8], ["kopi", -7.5], ["kaya", -11.6]].forEach(([k, x]) => {
    const ad = plane(2.0, 1.0, unlitMat(canvasTex(400, 200, adPainter(k)))); ad.rotation.y = Math.PI; ad.position.set(x, 1.45, ZB - 0.04); g.add(ad);
    g.add(box(2.12, 1.12, 0.06, toon("#1c2252"), x, 1.45, ZB - 0.0));
  });
  // ---- the trackway behind the doors and the tunnel mouth at the far end
  const bed = plane(LEN, 4.6, toon("#191b3a")); bed.rotation.x = -Math.PI / 2; bed.position.set(XC, -1.05, -2.3); g.add(bed);
  for (const z of [-1.05, -2.45]) g.add(box(LEN, 0.08, 0.08, toon("#9aa2c4"), XC, -0.98, z));
  const far = painted(LEN, 4.5, 512, 256, tunnelWall, { repeat: [LEN / 8, 1] }); far.position.set(XC, 1.2, -4.6); g.add(far);
  const mouth = painted(4.6, 4.5, 256, 256, (c, W, H) => { c.fillStyle = "#1c2252"; c.fillRect(0, 0, W, H); c.fillStyle = "#05060f"; c.beginPath(); c.roundRect(W * 0.08, H * 0.2, W * 0.84, H * 0.8, [W * 0.4, W * 0.4, 0, 0]); c.fill(); });
  mouth.rotation.y = Math.PI / 2; mouth.position.set(X0, 1.2, -2.3); g.add(mouth);
  const endWall = plane(ZB, 3.4, toon("#2b3a8a")); endWall.rotation.y = Math.PI / 2; endWall.position.set(X0, 1.7, ZB / 2); g.add(endWall);
  const mouth2 = mouth.clone(); mouth2.rotation.y = -Math.PI / 2; mouth2.position.x = X1; g.add(mouth2);
  const endWall2 = plane(ZB, 3.4, toon("#2b3a8a")); endWall2.rotation.y = -Math.PI / 2; endWall2.position.set(X1, 1.7, ZB / 2); g.add(endWall2);
  // overhead signs hanging from the ceiling along the platform
  const hang = (x, z, txt, col) => {
    const sg = plane(1.6, 0.34, unlitMat(canvasTex(480, 102, (c, W, H) => { c.fillStyle = "#16182e"; c.fillRect(0, 0, W, H); c.fillStyle = col; c.font = `800 ${H * 0.5}px ${SANS}`; c.textBaseline = "middle"; c.fillText(txt, W * 0.06, H * 0.54); })));
    sg.position.set(x + 0.035, 2.95, z); sg.rotation.y = Math.PI / 2; g.add(sg);
    g.add(box(0.06, 0.4, 1.66, toon("#2a2f55"), x - 0.01, 2.95, z), box(0.02, 0.45, 0.02, toon("#2a2f55"), x, 3.2, z - 0.6), box(0.02, 0.45, 0.02, toon("#2a2f55"), x, 3.2, z + 0.6));
  };
  hang(-7, 2.2, "➜ Exit A · Bishan Bus Interchange", "#ffd23f"); hang(-19, 2.2, "Circle Line ➜ HarbourFront", "#ffb43a"); hang(-31, 2.2, "➜ Exit B · Bishan St 22", "#ffd23f");

  // ---- the train: three cars; the lead car's last door is at x = 0 and its cab face at x = 2.875 when stopped
  const train = new THREE.Group(); g.add(train); U.train = train;
  const silver = toon("#e3e8f2"), dark = toon("#2b2f52");
  const skinTex = { mid: (s) => canvasTex(512, 365, skinPainter(4.35, 2, s)), end: (s) => canvasTex(256, 365, skinPainter(2.175, 1, s)) };
  const leafTexT = canvasTex(128, 356, leafPainter), leafMatT = toon("#ffffff", { map: leafTexT });
  const doorLeaves = [], doorLamps = [];
  const lampMat = flat("#5a1a20");
  for (let car = 0; car <= 2; car++) {
    const cx = -8.625 - car * 23.4;
    const doors = [-8.625, -2.875, 2.875, 8.625].map((d) => cx + d);
    const edges = [cx - 11.5, ...doors.flatMap((d) => [d - 0.7, d + 0.7]), cx + 11.5];
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1], len = b - a, end = len < 3;
      train.add(box(len, 3.1, 0.06, silver, (a + b) / 2, 0.8, -0.28));
      const p = plane(len, 3.1, toon("#ffffff", { map: end ? skinTex.end(car * 10 + i) : skinTex.mid(car * 10 + i) })); p.position.set((a + b) / 2, 0.8, -0.248); train.add(p);
    }
    for (const d of doors) {
      train.add(box(1.4, 0.4, 0.06, silver, d, 2.15, -0.28), box(1.4, 0.75, 0.06, dark, d, -0.375, -0.28));
      for (const s of [-1, 1]) {
        const leaf = new THREE.Group(); leaf.userData = { d, s };
        leaf.add(box(0.7, 1.95, 0.04, silver, 0, 0, 0));
        const lp = plane(0.7, 1.95, leafMatT); lp.position.z = 0.021; leaf.add(lp);
        leaf.position.set(d + s * 0.35, 0.975, -0.215); train.add(leaf); doorLeaves.push(leaf);
      }
      const l = box(0.22, 0.06, 0.04, lampMat, d, 2.06, -0.24); train.add(l); doorLamps.push(l);
    }
    train.add(box(23, 0.3, 2.8, dark, cx, -0.85, -1.7)); // undercarriage
    if (car < 2) train.add(box(0.4, 2.6, 2.4, toon("#1a1c36"), cx - 11.7, 0.7, -1.7)); // gangway
  }
  U.doorLeaves = doorLeaves; U.trainLampMat = lampMat;
  // the leading cab (toward +x) with headlights, and a lamp that lights the station as it pulls in
  const front = -8.625 + 11.5;
  train.add(rbox(0.9, 3.1, 2.9, 0.25, silver, front - 0.2, 0.8, -1.7));
  const cab = plane(2.9, 3.1, toon("#ffffff", { map: canvasTex(320, 340, cabPainter) })); cab.rotation.y = Math.PI / 2; cab.position.set(front + 0.255, 0.8, -1.7); train.add(cab);
  for (const z of [-0.75, -2.65]) { const hl = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), flat("#fffbe2")); hl.rotation.y = Math.PI / 2; hl.position.set(front + 0.26, 0.25, z); train.add(hl); }
  const headLamp = new THREE.PointLight("#ffe9c0", 8, 9, 1.5); headLamp.position.set(front + 1.6, 0.9, -1.0); train.add(headLamp); U.headLamp = headLamp;
  train.add(box(0.5, 3.1, 2.9, silver, -8.625 - 2 * 23.4 - 11.5 + 0.25, 0.8, -1.7));
  U.FRONT = front;
  return castShadows(g);
}

/** Open the platform's train doors and the screen doors: k 0 shut .. 1 open. */
export function setPlatformDoors(g, kTrain, kPsd = kTrain) {
  for (const l of g.userData.doorLeaves) l.position.x = l.userData.d + l.userData.s * (0.35 + 0.7 * kTrain);
  for (const l of g.userData.psdLeaves) l.position.x = l.userData.xd + l.userData.s * (0.4 + 0.78 * kPsd);
}
export function setStation(g, name) { const U = g.userData; U.signMat.map = U.signTex[name]; U.ledMat.map = U.ledTex[name]; }

// ---------------------------------------------------------------- the carriage interior
export function buildCarriage() {
  const g = new THREE.Group();
  const U = {}; g.userData = U;
  let nearTex = null; const farTex = {};
  const NEAR_LED = () => (nearTex ??= canvasTex(560, 80, ledPainter([["Doors opening · Bishan", 0.5, "center", 0.55]])));
  const FAR_LED = { marymount: () => (farTex.marymount ??= canvasTex(560, 80, ledPainter([["Next station · Marymount", 0.5, "center", 0.55]]))),
    botanic: () => (farTex.botanic ??= canvasTex(560, 80, ledPainter([["Next station · Botanic Gardens", 0.5, "center", 0.5]]))) };
  U.farLedTex = { marymount: FAR_LED.marymount(), botanic: FAR_LED.botanic() };
  const XA = -13, XB = 2.5, L = XB - XA, XM = (XA + XB) / 2, ZF = -3.05, ZN = -0.35, ZM = (ZF + ZN) / 2;
  const wallCol = toon("#e3e8f3"), band = toon("#9fb2ea"), poleMat = toon("#ffc933"), barMat = toon("#ffc933");
  const DOORS = [-2 * PITCH, -PITCH, 0];
  const floor = painted(L, 2.75, 256, 256, (c, W, H) => {
    c.fillStyle = "#545a92"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) { c.fillStyle = hash(i) > 0.5 ? "rgba(255,255,255,.14)" : "rgba(20,10,50,.18)"; c.fillRect(hash(i * 3) * W, hash(i * 7) * H, 3, 3); }
    c.fillStyle = "#6a71ab"; c.fillRect(0, H * 0.32, W, H * 0.36);
  }, { repeat: [L / 2.75, 1] });
  floor.rotation.x = -Math.PI / 2; floor.position.set(XM, 0, ZM); floor.receiveShadow = true; g.add(floor);
  for (const d of DOORS) for (const z of [ZF + 0.12, ZN - 0.12]) g.add(box(1.4, 0.006, 0.22, toon("#ffcf1f"), d, 0.004, z));
  const ceil = plane(L, 2.8, toon("#eef1f8")); ceil.rotation.x = Math.PI / 2; ceil.position.set(XM, 2.32, ZM); ceil.userData.noCast = true; g.add(ceil);
  for (const z of [-1.2, -2.2]) g.add(box(L, 0.04, 0.2, flat("#fff6e2"), XM, 2.3, z));
  for (const z of [ZF + 0.1, ZN - 0.1]) { const cn = box(L, 0.1, 0.2, toon("#cfd6ea"), XM, 2.27, z); cn.userData.noCast = true; g.add(cn); } // cornices

  /** one long wall at z with door openings, window holes from y 0.95 to 1.75, route maps above, and closed or open doors */
  function sideWall(z, face, isNear) {
    const w = new THREE.Group();
    const t = 0.08, zc = z, zi = z + face * 0.045; // zi: just inside the wall's inner face
    const spans = [[XA, -2 * PITCH - 0.7], [-2 * PITCH + 0.7, -PITCH - 0.7], [-PITCH + 0.7, -0.7], [0.7, XB]];
    for (const [a, b] of spans) {
      w.add(box(b - a, 0.95, t, wallCol, (a + b) / 2, 0.475, zc));
      w.add(box(b - a, 0.06, t + 0.02, band, (a + b) / 2, 0.92, zc));
      // windows: two per bench span, piers between
      const wins = [];
      const span = b - a, nW = span > 3 ? 2 : span > 1.2 ? 1 : 0, ww = (span - 0.3 * (nW + 1)) / nW;
      let x = a;
      for (let i = 0; i < nW; i++) { w.add(box(0.3, 0.8, t, wallCol, x + 0.15, 1.35, zc)); wins.push([x + 0.3, x + 0.3 + ww]); x += 0.3 + ww; }
      if (nW) w.add(box(0.3, 0.8, t, wallCol, b - 0.15, 1.35, zc)); else w.add(box(span, 0.8, t, wallCol, (a + b) / 2, 1.35, zc));
      for (const [wa, wb] of wins) {
        const fr = toon("#b9c3de");
        w.add(box(wb - wa, 0.04, t + 0.03, fr, (wa + wb) / 2, 0.97, zc), box(wb - wa, 0.04, t + 0.03, fr, (wa + wb) / 2, 1.73, zc));
      }
      w.add(box(b - a, 0.2, t, wallCol, (a + b) / 2, 1.85, zc));
    }
    const top = box(L, 0.4, t, wallCol, XM, 2.15, zc); top.userData.noCast = true; w.add(top);
    // above the windows: route maps and ads (painted on the inner face)
    const panels = isNear ? [[-4.9, -0.85, "kind"], [-10.65, -6.6, "map"], [0.85, 2.35, "kopi"]] : [[-4.9, -0.85, "map"], [-10.65, -6.6, "kaya"], [0.85, 2.35, "kopi"]];
    for (const [a, b, kind] of panels) {
      const tex = kind === "map" ? canvasTex(1024, 72, routeMap("Marymount")) : canvasTex(512, 72, adPainter(kind));
      const p = plane(b - a, 0.26, unlitMat(tex)); p.position.set((a + b) / 2, 2.09, zi + face * 0.002); if (face < 0) p.rotation.y = Math.PI; w.add(p);
    }
    // doors: leaves with real window holes; LED above; red lamp
    const leaves = [];
    for (const d of DOORS) {
      for (const s of [-1, 1]) {
        const leaf = new THREE.Group(); leaf.userData = { d, s };
        const lm = toon("#cdd4e6");
        leaf.add(box(0.7, 0.95, 0.04, lm, 0, -0.5, 0), box(0.7, 0.22, 0.04, lm, 0, 0.865, 0), box(0.12, 0.8, 0.04, lm, -0.29, 0.35, 0), box(0.12, 0.8, 0.04, lm, 0.29, 0.35, 0));
        leaf.add(box(0.7, 0.05, 0.045, toon(CC), 0, -0.2, 0));
        leaf.position.set(d + s * 0.35, 0.975, z + face * 0.05); w.add(leaf); leaves.push(leaf);
      }
      const lm = unlitMat(isNear ? NEAR_LED() : FAR_LED.marymount()); if (!isNear) (U.farLedMats = U.farLedMats || []).push(lm);
      const led = plane(1.1, 0.16, lm);
      led.position.set(d, 2.11, zi + face * 0.022); if (face < 0) led.rotation.y = Math.PI; w.add(led);
      w.add(box(1.24, 0.22, 0.03, toon("#2a2a3a"), d, 2.11, zi + face * 0.005));
      const lamp = box(0.2, 0.05, 0.03, flat("#5a1a20"), d, 1.97, zi + face * 0.01); w.add(lamp); U.doorLamp = U.doorLamp || []; U.doorLamp.push(lamp.material);
      // the door frame
      w.add(box(0.06, 1.95, t + 0.04, toon("#9aa6c8"), d - 0.73, 0.975, zc), box(0.06, 1.95, t + 0.04, toon("#9aa6c8"), d + 0.73, 0.975, zc));
    }
    w.userData.leaves = leaves;
    return w;
  }
  const farWall = sideWall(ZF, 1, false); g.add(farWall);
  const nearWall = sideWall(ZN, -1, true); nearWall.userData.noCast = true; g.add(nearWall); U.nearWall = nearWall;
  U.farLeaves = farWall.userData.leaves; U.nearLeaves = nearWall.userData.leaves;

  // the cab bulkhead at the front end of the car
  const bulk = painted(2.75, 2.35, 256, 220, (c, W, H) => {
    c.fillStyle = "#e3e8f3"; c.fillRect(0, 0, W, H); c.fillStyle = "#9fb2ea"; c.fillRect(0, H * 0.58, W, H * 0.04);
    c.fillStyle = "#c9d0e2"; c.fillRect(W * 0.32, H * 0.12, W * 0.36, H * 0.88); c.fillStyle = "#1b2240"; c.fillRect(W * 0.38, H * 0.2, W * 0.24, H * 0.18);
    c.fillStyle = "#e2433f"; c.beginPath(); c.arc(W * 0.16, H * 0.3, W * 0.07, 0, 7); c.fill(); c.fillStyle = "#fff"; c.fillRect(W * 0.12, H * 0.29, W * 0.08, H * 0.02);
  });
  bulk.rotation.y = -Math.PI / 2; bulk.position.set(XB, 1.175, ZM); g.add(bulk);
  // the tunnel outside the far windows (and a still version for the near side, used when the near wall is shown at a
  // station it is replaced by the real platform)
  const rushTex = canvasTex(512, 128, tunnelRush); rushTex.wrapS = THREE.RepeatWrapping; rushTex.repeat.set(L / 8, 1);
  const rush = plane(L, 1.6, unlitMat(rushTex)); rush.position.set(XM, 1.35, ZF - 0.25); g.add(rush); U.rushTex = rushTex; U.rushL = L; U.XA = XA;
  U.rushMesh = rush;

  // benches: seven seats between doors; the two at each end are the blue reserved seats
  const seatO = toon("#ff6a3d"), seatB = toon("#2f56c9"), base = toon("#3a3f6a");
  U.seatX = [];
  for (const [zw, face] of [[ZF, 1], [ZN, -1]]) {
    const holder = face > 0 ? g : nearWall;
    for (const [a, b] of [[-10.65, -6.6], [-4.9, -0.85], [0.85, XB - 0.05]]) {
      const n = Math.max(1, Math.round((b - a) / 0.578)), pitch = (b - a) / n;
      holder.add(box(b - a, 0.3, 0.38, base, (a + b) / 2, 0.15, zw + face * 0.25));
      for (let i = 0; i < n; i++) {
        const x = a + pitch * (i + 0.5), m = i === 0 || i === n - 1 ? seatB : seatO;
        holder.add(rbox(pitch - 0.04, 0.1, 0.46, 0.04, m, x, 0.35, zw + face * 0.27));
        const bk = rbox(pitch - 0.04, 0.48, 0.08, 0.04, m, x, 0.66, zw + face * 0.07); bk.rotation.x = -face * 0.08; holder.add(bk);
        if (face > 0 && a > -5 && a < -4.8) U.seatX.push(x);
      }
    }
  }
  // poles and bars
  const poleGeo = new THREE.CylinderGeometry(0.022, 0.022, 2.3, 10);
  const poles = DOORS.flatMap((d) => [[d, -1.7], [d - 0.82, -2.45], [d + 0.82, -2.45], [d - 0.82, -0.95], [d + 0.82, -0.95]]);
  for (const [x, z] of poles) { const p = new THREE.Mesh(poleGeo, poleMat); p.position.set(x, 1.15, z); p.userData.noCast = true; (z > -1.2 ? nearWall : g).add(p); }
  for (const z of [-2.42, -0.98]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, L, 10), barMat); b.rotation.z = Math.PI / 2; b.position.set(XM, 1.98, z); b.userData.noCast = true; g.add(b); }
  // grab handles: a strap and a ring, swinging from the bars
  const ring = new THREE.TorusGeometry(0.065, 0.013, 6, 18); ring.translate(0, -0.26, 0);
  const strap = new THREE.BoxGeometry(0.03, 0.18, 0.014); strap.translate(0, -0.1, 0);
  const hGeo = mergeGeometries([ring.toNonIndexed(), strap.toNonIndexed()]);
  const hMat = toon("#f4f4f8");
  U.handles = [];
  for (const z of [-2.42, -0.98]) for (const [a, b] of [[-10.5, -6.75], [-4.75, -1.0], [1.0, XB - 0.25]]) {
    const n = Math.round((b - a) / 0.42);
    for (let i = 0; i <= n; i++) { const h = new THREE.Mesh(hGeo, hMat); h.position.set(a + ((b - a) * i) / n, 1.98, z); h.userData.ph = hash(i * 7 + z * 3) * 6.28; h.userData.noCast = true; g.add(h); U.handles.push(h); }
  }
  // two warm lamps outside the windows that sweep past with the tunnel
  U.sweep = [0, 1].map(() => { const l = new THREE.PointLight("#ffb35a", 0, 6.5, 1.1); g.add(l); return l; });
  U.ZF = ZF;
  return castShadows(g);
}

/** Carriage state for film time t: run 0 at a station .. 1 at full speed; doors kNear/kFar 0 shut .. 1 open. */
export function setCarriage(g, t, o = {}) {
  const U = g.userData, run = o.run ?? 1, sp = 14 * run;
  // the tunnel scroll: lamps every 8 m, running toward -x
  const off = ((t * sp) / 8) % 1;
  U.rushTex.offset.x = off;
  U.rushMesh.visible = o.tunnel ?? true;
  // lamp positions in world x: the painted lamp sits at u = 0.3 of each 8 m tile
  U.sweep.forEach((l, i) => {
    let u = (0.3 - off + i) ; u = ((u % 2) + 2) % 2; // two tiles apart -> 16 m period for two lights covering the length
    const x = U.XA + u * 8;
    l.position.set(x, 1.45, U.ZF - 0.35); l.intensity = run * (o.sweep ?? 5);
  });
  for (const h of U.handles) { h.rotation.z = Math.sin(t * 2.6 + h.userData.ph) * 0.12 * run + (o.lurch ?? 0); h.rotation.x = Math.sin(t * 1.7 + h.userData.ph * 0.7) * 0.06 * run; }
  const kn = o.kNear ?? 0, kf = o.kFar ?? 0;
  for (const l of U.nearLeaves) l.position.x = l.userData.d + l.userData.s * (0.35 + 0.68 * kn);
  for (const l of U.farLeaves) l.position.x = l.userData.d + l.userData.s * (0.35 + 0.68 * kf);
  U.nearWall.visible = o.near ?? false;
  for (const m of U.doorLamp) m.color.set(o.lamp ? "#ff3040" : "#5a1a20");
  for (const m of U.farLedMats) m.map = U.farLedTex[o.next ?? "marymount"];
}
