// Chapter 7 sets: the front of Blossom Family Clinic (fictional) under an HDB covered walkway, and Dr Lim's consulting
// room. Built for the cameras in src/chapters/c07_clinic.js.
//
// Front: origin at the foot of the door on the facade line (z = 0, the street side is +z). The glass door is hinged
//   on its left (x = -0.53) and swings out toward +z when rotation.y < 0; a brass bell hangs inside the frame.
// Room: origin at the floor centre; back wall z = -2.2, left wall x = -2.9, right wall x = +2.9. Dr Lim's desk runs
//   along x (top at y = 0.61, x -0.45..1.15, z -1.21..-0.49); Dr Lim sits behind it, Mr Tan at its left end and
//   Wei Ling beside him. Seat tops: patients 0.33, Dr Lim 0.37.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { hash } from "../core.js";
import { box, rbox, cyl, ball, painted, tiles, wall, windowView, poster, plant, group, at } from "./kit.js";

const ZH = '"Microsoft YaHei", "PingFang SC", sans-serif';
const SANS = '"Segoe UI", system-ui, sans-serif';

/** Keep a see-through mesh out of the ink pass: while the look renders normals (an override material), the mesh is
 *  collapsed to nothing, so glows and glass don't get rectangle outlines. */
export function noInk(m) {
  const keep = new THREE.Matrix4();
  m.onBeforeRender = (r, sc, cam, geo, mat) => { if (mat && mat.isMeshNormalMaterial) { keep.copy(m.matrixWorld); m.matrixWorld.makeScale(1e-6, 1e-6, 1e-6); } };
  m.onAfterRender = (r, sc, cam, geo, mat) => { if (mat && mat.isMeshNormalMaterial) m.matrixWorld.copy(keep); };
  return m;
}
/** A soft additive glow disc (fakes light around lamps without adding scene lights). */
function glow(r, col = "#ffd98a", o = 0.85) {
  const tex = canvasTex(128, 128, (c, W, H) => {
    const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    g.addColorStop(0, `rgba(255,255,255,${o})`); g.addColorStop(0.25, col); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  return noInk(m);
}
/** A flat decal on the floor or a desk: a warm pool of light. */
function lightPool(w, d, col = "rgba(255,214,140,0.55)") {
  const tex = canvasTex(256, 256, (c, W, H) => {
    const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    g.addColorStop(0, col); g.addColorStop(1, "rgba(255,200,120,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; return noInk(m);
}
function blossom(c, x, y, r, petal = "#ff8fb8", heart = "#ffd94a") {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    c.fillStyle = petal; c.beginPath(); c.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.36, a, 0, 7); c.fill();
  }
  c.fillStyle = heart; c.beginPath(); c.arc(x, y, r * 0.24, 0, 7); c.fill();
}

/** Solid props cast shadows; planes (walls, floors, signs, glows) and see-through bits do not. */
function casters(g) {
  g.traverse((o) => { if (!o.isMesh) return; o.receiveShadow = true;
    o.castShadow = !(o.geometry instanceof THREE.PlaneGeometry || o.geometry instanceof THREE.CircleGeometry || o.material.transparent); });
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// The clinic front
// ---------------------------------------------------------------------------------------------------------------
export function buildClinicFront() {
  const g = new THREE.Group();
  const mint = "#5fcfb6", teal = "#2a7d84", cream = "#fff4e2";
  // walkway floor and the step
  const fl = tiles(14, 7, "#f0bf94", "#fae2c6", 1.2); fl.position.set(0, 0, 2.6); g.add(fl);
  g.add(box(14, 0.06, 0.3, toon("#e0a678"), 0, 0.03, 6.0));
  // the interior seen through the door: a warm waiting room
  const inside = new THREE.Group(); g.add(inside);
  const inFl = tiles(4, 3, "#f7e6cf", "#ffffff", 0.8); inFl.position.set(0, 0.002, -1.5); inside.add(inFl);
  const inWall = painted(4, 2.6, 512, 340, (c, W, H) => {
    c.fillStyle = "#ffe3b8"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#ffd08a"; c.fillRect(0, H * 0.62, W, H * 0.38);
    blossom(c, W * 0.5, H * 0.25, 40);
    c.fillStyle = "#e2437f"; c.font = `900 30px ${SANS}`; c.textAlign = "center"; c.fillText("WELCOME", W * 0.5, H * 0.45);
    c.fillStyle = "#5fcfb6"; for (let i = 0; i < 4; i++) c.fillRect(W * 0.08 + i * 26, H * 0.2, 18, 60);
  }, { unlit: true });
  inWall.position.set(0, 1.3, -2.9); inside.add(inWall);
  inside.add(rbox(1.4, 0.75, 0.5, 0.05, toon("#ff8fb0"), 0.3, 0.375, -2.3)); // reception counter
  inside.add(box(1.45, 0.05, 0.55, toon("#ffffff"), 0.3, 0.77, -2.3));
  inside.add(rbox(0.3, 0.2, 0.05, 0.02, toon("#2a2633"), 0.55, 0.9, -2.4)); // a little screen on the counter
  inside.add(at(plant(0.9, "#3fae6b"), -1.2, 0, -2.5));
  for (let i = 0; i < 3; i++) inside.add(rbox(0.36, 0.08, 0.36, 0.03, toon("#5cc7ff"), -1.0 + i * 0.42, 0.33, -1.2)); // waiting chairs
  for (let i = 0; i < 3; i++) inside.add(rbox(0.36, 0.34, 0.06, 0.03, toon("#5cc7ff"), -1.0 + i * 0.42, 0.52, -1.38));
  const inLamp = box(1.4, 0.04, 0.3, flat("#fff6d8"), 0, 2.5, -1.6); inside.add(inLamp);
  const inGlow = glow(1.2, "rgba(255,215,140,0.6)"); inGlow.position.set(0, 1.6, -2.85); inside.add(inGlow);
  inside.add(box(4, 0.05, 2.9, toon("#fff0d8"), 0, 2.6, -1.5)); // interior ceiling
  for (const s of [-1, 1]) inside.add(box(0.05, 2.6, 2.9, toon("#ffdcaa"), s * 1.95, 1.3, -1.5));

  // facade: two wall sections and the lintel; a darker base band
  const L = wall(4.2, 3.2, mint, { band: "#3fb79d" }); L.position.set(-2.72, 1.6, 0); g.add(L);
  const R = wall(4.2, 3.2, mint, { band: "#3fb79d" }); R.position.set(2.72, 1.6, 0); g.add(R);
  g.add(box(1.24, 1.32, 0.12, toon(mint), 0, 2.54, -0.02));
  // door frame
  const fr = toon(teal);
  g.add(box(0.08, 1.92, 0.14, fr, -0.6, 0.96, 0.0), box(0.08, 1.92, 0.14, fr, 0.6, 0.96, 0.0), box(1.28, 0.1, 0.14, fr, 0, 1.92, 0.0));
  g.add(box(1.2, 0.03, 0.3, toon("#c9a27a"), 0, 0.015, 0.05)); // threshold
  // the glass door, hinged at its left edge, swings out to +z (rotation.y < 0 opens it)
  const door = new THREE.Group(); door.position.set(-0.53, 0, 0.03); g.add(door);
  const dfr = toon("#1f5f66");
  door.add(box(0.06, 1.84, 0.05, dfr, 0.03, 0.94, 0), box(0.06, 1.84, 0.05, dfr, 1.03, 0.94, 0));
  door.add(box(1.06, 0.06, 0.05, dfr, 0.53, 1.83, 0), box(1.06, 0.14, 0.05, dfr, 0.53, 0.09, 0));
  const glass = painted(0.94, 1.66, 256, 452, (c, W, H) => {
    c.fillStyle = "rgba(190,240,255,0.30)"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(255,255,255,0.65)"; c.lineWidth = 14;
    c.beginPath(); c.moveTo(W * 0.15, H * 0.35); c.lineTo(W * 0.55, H * 0.1); c.stroke();
    c.lineWidth = 6; c.beginPath(); c.moveTo(W * 0.2, H * 0.48); c.lineTo(W * 0.7, H * 0.18); c.stroke();
    blossom(c, W * 0.5, H * 0.62, 26);
    c.fillStyle = "rgba(255,255,255,0.9)"; c.font = `800 22px ${SANS}`; c.textAlign = "center"; c.fillText("PULL", W * 0.5, H * 0.74);
  }, { unlit: true, transparent: true });
  glass.material.depthWrite = false; glass.position.set(0.53, 0.97, 0.0); door.add(noInk(glass));
  const glass2 = noInk(glass.clone()); glass2.rotation.y = Math.PI; door.add(glass2);
  door.add(cyl(0.018, 0.018, 0.5, toon("#d9dde6"), 0.9, 1.0, 0.06)); // pull handle
  door.add(box(0.02, 0.03, 0.06, toon("#d9dde6"), 0.9, 1.22, 0.035), box(0.02, 0.03, 0.06, toon("#d9dde6"), 0.9, 0.78, 0.035));
  g.userData.door = door;
  // the bell: a bracket under the lintel inside, the bell swings from a pivot
  g.add(box(0.03, 0.03, 0.22, toon("#b8862e"), 0.35, 1.84, -0.1));
  const bell = new THREE.Group(); bell.position.set(0.35, 1.82, -0.2); g.add(bell);
  const brass = toon("#ffc23a", { emissive: "#6a4300" });
  const bellBody = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.03, -0.01), new THREE.Vector2(0.045, -0.06), new THREE.Vector2(0.07, -0.12), new THREE.Vector2(0.075, -0.13)], 20), brass);
  bellBody.position.y = -0.03; bell.add(bellBody, cyl(0.006, 0.006, 0.05, toon("#b8862e"), 0, -0.01, 0), ball(0.022, toon("#b8862e"), 0, -0.17, 0));
  g.userData.bell = bell;
  // the sign: BLOSSOM FAMILY CLINIC (fictional), with a Chinese line
  const sign = new THREE.Group(); sign.position.set(0, 2.5, 0.1); g.add(sign);
  sign.add(rbox(3.5, 0.66, 0.12, 0.04, toon("#c4245f"), 0, 0, 0));
  const face = painted(3.36, 0.56, 1024, 170, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#ff5f98"); gr.addColorStop(1, "#e2437f");
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = "#ffffff"; c.beginPath(); c.arc(92, H / 2, 64, 0, 7); c.fill();
    blossom(c, 92, H / 2, 52, "#ff6fa6", "#ffd94a");
    c.fillStyle = "#ffffff"; c.textAlign = "left"; c.textBaseline = "middle";
    let fs = 70; c.font = `900 ${fs}px "Arial Black", ${SANS}`; const tw = c.measureText("BLOSSOM FAMILY CLINIC").width;
    if (tw > W - 205) { fs = Math.floor((fs * (W - 205)) / tw); c.font = `900 ${fs}px "Arial Black", ${SANS}`; }
    c.fillText("BLOSSOM FAMILY CLINIC", 178, H * 0.4);
    c.font = `700 38px ${ZH}`; c.fillText("花开家庭诊所", 182, H * 0.8);
    c.font = `700 28px ${SANS}`; c.fillStyle = "#ffe6f0"; c.fillText("(fictional)", 440, H * 0.82);
  }, { unlit: true });
  face.position.z = 0.062; sign.add(face);
  // warm wall lamps either side of the door (the visible warm light)
  for (const s of [-1, 1]) {
    const lampG = new THREE.Group(); lampG.position.set(s * 0.95, 1.95, 0.02); g.add(lampG);
    lampG.add(box(0.12, 0.2, 0.06, toon("#2a7d84"), 0, 0, 0.03));
    lampG.add(cyl(0.07, 0.05, 0.16, toon("#fff1c9", { emissive: "#ffcf7a", emissiveIntensity: 1.2 }), 0, 0.02, 0.13));
    const gl = glow(0.45, "rgba(255,206,120,0.7)"); gl.position.set(0, 0.02, 0.2); lampG.add(gl);
  }
  // the queue number display: NOW SERVING 1031 (repainted on demand)
  const q = new THREE.Group(); q.position.set(1.42, 1.62, 0.04); g.add(q);
  q.add(rbox(0.62, 0.4, 0.07, 0.02, toon("#1d1a26"), 0, 0, 0.035));
  const qc = document.createElement("canvas"); qc.width = 320; qc.height = 200;
  const qt = new THREE.CanvasTexture(qc); qt.colorSpace = THREE.SRGBColorSpace;
  const qFace = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.35), new THREE.MeshBasicMaterial({ map: qt, toneMapped: false }));
  qFace.position.z = 0.072; q.add(qFace);
  let lastQ = "";
  g.userData.setQueue = (n, on = true) => {
    const key = n + "" + on; if (key === lastQ) return; lastQ = key;
    const c = qc.getContext("2d"); c.fillStyle = "#120c14"; c.fillRect(0, 0, 320, 200);
    c.fillStyle = "#ffb84a"; c.font = `800 30px ${SANS}`; c.textAlign = "center"; c.fillText("NOW SERVING", 160, 42);
    c.font = "900 112px 'Courier New', monospace"; c.fillStyle = on ? "#ff4a3a" : "#5a1a16"; c.shadowColor = "#ff4a3a"; c.shadowBlur = on ? 18 : 0;
    c.fillText(String(n), 160, 150); qt.needsUpdate = true;
  };
  g.userData.setQueue(1031);
  // the left shop window: frosted glass with the clinic's hours, and a little interior behind
  const win = painted(2.3, 1.35, 512, 300, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "#c9f3ff"); gr.addColorStop(1, "#8fdcef");
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,0.55)"; c.fillRect(0, H * 0.42, W, H * 0.3);
    c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 16; c.beginPath(); c.moveTo(W * 0.05, H * 0.35); c.lineTo(W * 0.3, 0); c.stroke();
    c.lineWidth = 7; c.beginPath(); c.moveTo(W * 0.12, H * 0.4); c.lineTo(W * 0.38, 0); c.stroke();
    blossom(c, W * 0.18, H * 0.57, 26);
    c.fillStyle = "#c4245f"; c.font = `900 34px ${SANS}`; c.textAlign = "left"; c.fillText("GP · FAMILY MEDICINE", W * 0.3, H * 0.54);
    c.fillStyle = "#2a5f66"; c.font = `700 20px ${SANS}`; c.fillText("Mon–Sat  8:30 am – 1 pm · 2 – 5 pm", W * 0.3, H * 0.66);
    c.fillStyle = "#ffd94a"; c.beginPath(); c.arc(W * 0.86, H * 0.2, 30, 0, 7); c.fill();
    c.fillStyle = "#1a1030"; c.font = `900 16px ${SANS}`; c.textAlign = "center"; c.fillText("WALK-IN", W * 0.86, H * 0.21); c.fillText("OK", W * 0.86, H * 0.27);
  }, { unlit: true });
  win.position.set(-2.55, 1.28, 0.02); g.add(win);
  const wfr = toon("#ffffff");
  g.add(box(2.42, 0.06, 0.06, wfr, -2.55, 1.98, 0.04), box(2.42, 0.06, 0.06, wfr, -2.55, 0.58, 0.04));
  g.add(box(0.06, 1.46, 0.06, wfr, -3.73, 1.28, 0.04), box(0.06, 1.46, 0.06, wfr, -1.37, 1.28, 0.04), box(0.04, 1.4, 0.05, wfr, -2.55, 1.28, 0.04));
  g.add(box(2.5, 0.05, 0.2, wfr, -2.55, 0.55, 0.1));
  // a notice board with pinned papers on the right
  const nb = poster(0.8, 0.6, (c, W, H) => {
    c.fillStyle = "#d9a066"; c.fillRect(0, 0, W, H);
    const cols = ["#fff8e0", "#ffe0ec", "#e0f6ff", "#fff8e0", "#e8ffe0"];
    for (let i = 0; i < 5; i++) { const x = 12 + (i % 3) * 80, y = 14 + Math.floor(i / 3) * 90; c.save(); c.translate(x + 34, y + 40); c.rotate((hash(i) - 0.5) * 0.2);
      c.fillStyle = cols[i]; c.fillRect(-34, -40, 68, 80); c.fillStyle = "#9a8fb0"; for (let k = 0; k < 5; k++) c.fillRect(-26, -26 + k * 12, 52 - hash(i * 9 + k) * 20, 4);
      c.fillStyle = "#e2433f"; c.beginPath(); c.arc(0, -36, 5, 0, 7); c.fill(); c.restore(); }
  }, "#7a4a2a");
  nb.position.set(2.55, 1.45, 0.03); g.add(nb);
  // potted plants by the door and the bench on the right
  const pL = plant(1.7, "#2f9e5a"); pL.position.set(-1.0, 0, 0.32); g.add(pL);
  const pR = plant(1.5, "#3fae6b"); pR.position.set(1.95, 0, 0.32); g.add(pR);
  const pS = plant(1.1, "#2f9e5a"); pS.position.set(-1.45, 0, 0.3); g.add(pS);
  const bench = new THREE.Group(); bench.position.set(3.15, 0, 0.55); g.add(bench);
  for (let i = 0; i < 3; i++) bench.add(rbox(1.4, 0.04, 0.12, 0.015, toon("#d98a4a"), 0, 0.36, -0.15 + i * 0.14));
  for (let i = 0; i < 2; i++) bench.add(rbox(1.4, 0.1, 0.035, 0.015, toon("#d98a4a"), 0, 0.55 + i * 0.13, -0.25));
  for (const s of [-1, 1]) { bench.add(box(0.05, 0.36, 0.4, toon("#3a3550"), s * 0.6, 0.18, 0)); bench.add(box(0.05, 0.4, 0.04, toon("#3a3550"), s * 0.6, 0.55, -0.26)); }
  bench.add(rbox(0.3, 0.04, 0.22, 0.01, toon("#f2f2f2"), -0.35, 0.4, 0.0)); // a folded newspaper
  bench.add(box(0.28, 0.005, 0.2, toon("#9a8fb0"), -0.35, 0.422, 0.0));
  const umb = cyl(0.05, 0.015, 0.75, toon("#ff5f98"), 0.78, 0.37, 0.12); umb.rotation.z = -0.25; bench.add(umb);
  // the covered walkway: ceiling with tube lights, a pillar in the foreground
  g.add(box(14, 0.12, 6.4, toon("#f6efe6"), 0, 3.15, 3.0));
  for (let i = 0; i < 3; i++) { g.add(box(1.2, 0.04, 0.1, flat("#fffbea"), -3 + i * 3, 3.07, 1.6)); }
  g.add(box(14, 0.4, 0.2, toon("#e8dccb"), 0, 2.95, 6.1));
  const pillar = rbox(0.5, 3.1, 0.5, 0.04, toon("#f2e3cf"), 4.3, 1.55, 3.2); g.add(pillar);
  g.add(box(0.52, 0.5, 0.52, toon("#e0a678"), 4.3, 0.25, 3.2));
  // the neighbour on the left: a bakery with a striped awning
  const aw = painted(2.2, 0.5, 256, 64, (c, W, H) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#ffffff" : "#ff8a3a"; c.fillRect(i * 32, 0, 32, H); } });
  aw.position.set(-5.9, 2.2, 0.35); aw.rotation.x = -0.5; g.add(aw);
  const bakery = painted(2.2, 1.4, 256, 160, (c, W, H) => {
    c.fillStyle = "#ffe9c2"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#c97a3a"; for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(30 + i * 38, 110, 16, 10, 0, 0, 7); c.fill(); }
    c.fillStyle = "#7a3a1a"; c.font = `900 26px ${SANS}`; c.textAlign = "center"; c.fillText("KUEH & BUNS", W / 2, 46);
  }, { unlit: true });
  bakery.position.set(-5.9, 1.2, 0.03); g.add(bakery);
  // a wall-mounted hand sanitiser and a little doormat
  g.add(rbox(0.12, 0.2, 0.08, 0.02, toon("#ffffff"), 0.82, 1.15, 0.06), box(0.08, 0.05, 0.04, toon("#39c6b0"), 0.82, 1.06, 0.1));
  const mat = painted(1.1, 0.6, 256, 140, (c, W, H) => { c.fillStyle = "#3a6f74"; c.fillRect(0, 0, W, H); c.strokeStyle = "#5fcfb6"; c.lineWidth = 8; c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = "#ffe6f0"; c.font = `900 40px ${SANS}`; c.textAlign = "center"; c.fillText("WELCOME", W / 2, H / 2 + 14); });
  mat.rotation.x = -Math.PI / 2; mat.position.set(0, 0.008, 0.6); g.add(mat);
  casters(g);
  g.traverse((o) => { if (o.isMesh && o.position.y > 2.9 && o.geometry.parameters?.width > 5) o.castShadow = false; }); // the walkway roof
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// The consulting room
// ---------------------------------------------------------------------------------------------------------------
/** Dr Lim's desk BP monitor: an LCD whose text is repainted on demand (setBP("152", "94") or setBP() for blank). */
function bpMonitor() {
  const g = new THREE.Group();
  g.add(rbox(0.24, 0.09, 0.18, 0.025, toon("#f4f6fb"), 0, 0.045, 0));
  const top = rbox(0.22, 0.1, 0.03, 0.015, toon("#f4f6fb"), 0, 0.11, -0.05); top.rotation.x = -0.5; g.add(top);
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.085), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  lcd.position.set(0, 0.115, -0.03); lcd.rotation.x = -0.5; g.add(lcd);
  g.add(cyl(0.02, 0.02, 0.012, toon("#3f66d9"), 0.07, 0.092, 0.06), cyl(0.014, 0.014, 0.012, toon("#e2433f"), 0.02, 0.092, 0.06));
  let last = "";
  g.userData.setBP = (sys = "", dia = "", on = true) => {
    const key = sys + "/" + dia + on; if (key === last) return; last = key;
    const x = c.getContext("2d"); x.fillStyle = on ? "#cfe9c4" : "#8fa489"; x.fillRect(0, 0, 256, 128);
    x.fillStyle = "#1d2a1a"; x.textAlign = "right"; x.textBaseline = "middle";
    x.font = "900 64px 'Courier New', monospace"; x.fillText(sys || "--", 150, 44);
    x.font = "900 46px 'Courier New', monospace"; x.fillText(dia || "--", 150, 100);
    x.font = "800 15px 'Segoe UI'"; x.textAlign = "left"; x.fillText("SYS", 160, 30); x.fillText("DIA", 160, 92);
    x.fillText("mmHg", 196, 30);
    tex.needsUpdate = true;
  };
  g.userData.setBP();
  return g;
}

/** A small phone lying flat or held; its screen can show an app frame. A red REC dot sits on its upper corner. */
export function c07Phone() {
  const g = new THREE.Group();
  const cv = document.createElement("canvas"); cv.width = 292; cv.height = 633;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  g.add(rbox(0.13, 0.27, 0.016, 0.012, toon("#2a2633"), 0, 0, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.118, 0.255), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  scr.position.z = 0.0085; g.add(scr);
  const rec = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshBasicMaterial({ color: "#ff2a3a", toneMapped: false }));
  rec.position.set(-0.035, 0.105, 0.0095); g.add(rec);
  const recGlow = glow(0.06, "rgba(255,60,70,0.8)"); recGlow.position.set(-0.035, 0.105, 0.012); g.add(recGlow);
  let lastImg = null;
  g.userData.setScreen = (img, fill = "#ffffff") => {
    if (img && img === lastImg) return; lastImg = img;
    const x = cv.getContext("2d");
    if (img) x.drawImage(img, 0, 0, cv.width, cv.height); else { x.fillStyle = fill; x.fillRect(0, 0, cv.width, cv.height); }
    tex.needsUpdate = true;
  };
  g.userData.setRec = (on) => { rec.visible = on; recGlow.visible = on; };
  g.userData.setScreen(null, "#efeef8"); g.userData.setRec(false);
  return g;
}

export function buildConsultRoom() {
  const g = new THREE.Group();
  // floor, walls, skirting
  const fl = tiles(7.2, 6.6, "#6fcdb8", "#ffe4c4", 0.9); fl.position.set(0, 0, 0.9); g.add(fl);
  const back = wall(7.2, 3.2, "#6fd2bc", { band: "#2fa78f" }); back.position.set(0, 1.6, -2.2); g.add(back);
  const left = wall(6.6, 3.2, "#8fdcc8", { band: "#3fb79d" }); left.rotation.y = Math.PI / 2; left.position.set(-2.9, 1.6, 0.9); g.add(left);
  const right = wall(6.6, 3.2, "#8fdcc8", { band: "#3fb79d" }); right.rotation.y = -Math.PI / 2; right.position.set(2.9, 1.6, 0.9); g.add(right);
  const sk = toon("#ffffff");
  g.add(box(7.2, 0.1, 0.03, sk, 0, 0.05, -2.18), box(0.03, 0.1, 6.6, sk, -2.88, 0.05, 0.9), box(0.03, 0.1, 6.6, sk, 2.88, 0.05, 0.9));

  // the window with blinds, behind and above the desk
  const view = (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#6cc8ff"); gr.addColorStop(1, "#d8f2ff"); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,0.9)"; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(W * (0.2 + i * 0.3), H * (0.18 + hash(i) * 0.1), 70, 22, 0, 0, 7); c.fill(); }
    const cols = ["#f6c58a", "#ffb0a0", "#f0e2b0", "#b9a8f0"];
    for (let i = 0; i < 5; i++) { const bw = W * 0.16, bh = H * (0.4 + hash(i * 3) * 0.3), x = i * W * 0.21 - 10, y = H - bh;
      c.fillStyle = cols[i % 4]; c.fillRect(x, y, bw, bh);
      for (let r = 0; r < bh / 26; r++) for (let k = 0; k < 4; k++) { c.fillStyle = "rgba(60,70,120,0.35)"; c.fillRect(x + 8 + k * (bw - 12) / 4, y + 10 + r * 26, (bw - 12) / 4 - 6, 12); } }
    c.fillStyle = "#3fae6b"; for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(i * W / 8, H * 0.95, 40, 0, 7); c.fill(); }
  };
  const win = windowView(1.5, 1.05, view, { frame: "#ffffff" }); win.position.set(-0.2, 1.78, -2.17); g.add(win);
  const slatM = toon("#fbfbf4");
  for (let i = 0; i < 7; i++) { const s = box(1.56, 0.03, 0.07, slatM, -0.2, 2.27 - i * 0.065, -2.09); s.rotation.x = 0.9; g.add(s); }
  g.add(box(1.62, 0.07, 0.1, toon("#e8e8e0"), -0.2, 2.34, -2.09)); // blind head rail
  g.add(box(1.58, 0.035, 0.08, toon("#e8e8e0"), -0.2, 1.81, -2.09)); // bottom rail of the raised blind
  g.add(cyl(0.005, 0.005, 0.7, toon("#e8e8e0"), 0.5, 1.95, -2.06), ball(0.015, toon("#e8e8e0"), 0.5, 1.6, -2.06));
  const sun = lightPool(1.6, 1.0, "rgba(255,240,200,0.35)"); sun.position.set(-0.1, 0.006, -1.3); g.add(sun);

  // anatomy poster (left of the window) and a second small "wash your hands" poster
  const anat = poster(0.62, 0.84, (c, W, H) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#e2437f"; c.fillRect(0, 0, W, 46); c.fillStyle = "#fff"; c.font = `900 26px ${SANS}`; c.textAlign = "center"; c.fillText("THE HEART", W / 2, 32);
    // a body outline with the heart and the big vessels
    c.fillStyle = "#ffe0cc"; c.beginPath(); c.ellipse(W / 2, 90, 30, 34, 0, 0, 7); c.fill();
    c.beginPath(); c.roundRect(W / 2 - 62, 122, 124, 190, 40); c.fill();
    c.fillStyle = "#ffb3c7"; c.beginPath(); c.ellipse(W / 2 - 30, 190, 24, 44, 0.2, 0, 7); c.fill(); c.beginPath(); c.ellipse(W / 2 + 30, 190, 24, 44, -0.2, 0, 7); c.fill();
    c.fillStyle = "#e2433f"; c.beginPath(); c.moveTo(W / 2 + 6, 250); c.bezierCurveTo(W / 2 - 40, 220, W / 2 - 30, 180, W / 2 - 4, 196); c.bezierCurveTo(W / 2 + 18, 176, W / 2 + 46, 200, W / 2 + 6, 250); c.fill();
    c.strokeStyle = "#3f66d9"; c.lineWidth = 6; c.beginPath(); c.moveTo(W / 2 - 4, 196); c.lineTo(W / 2 - 10, 140); c.stroke();
    c.strokeStyle = "#e2433f"; c.beginPath(); c.moveTo(W / 2 + 8, 196); c.quadraticCurveTo(W / 2 + 30, 150, W / 2 + 6, 136); c.stroke();
    c.strokeStyle = "#5a4a7a"; c.lineWidth = 2; c.fillStyle = "#5a4a7a";
    [[60, 150, W / 2 - 10, 150], [60, 230, W / 2 - 24, 222], [W - 60, 170, W / 2 + 24, 180], [W - 60, 260, W / 2 + 12, 240]].forEach(([x1, y1, x2, y2], i) => {
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.fillRect(x1 < W / 2 ? 8 : W - 56, y1 - 4, 48, 6); c.fillRect(x1 < W / 2 ? 8 : W - 56, y1 + 6, 32 + hash(i) * 14, 4); });
  }, "#3a2a5a");
  anat.position.set(-1.65, 1.68, -2.17); g.add(anat);
  const wash = poster(0.36, 0.46, (c, W, H) => {
    c.fillStyle = "#e0f6ff"; c.fillRect(0, 0, W, H); c.fillStyle = "#3f66d9"; c.font = `900 26px ${SANS}`; c.textAlign = "center"; c.fillText("WASH", W / 2, 40); c.fillText("HANDS", W / 2, 70);
    c.fillStyle = "#ffd0b0"; c.beginPath(); c.ellipse(W / 2 - 24, 190, 30, 58, -0.3, 0, 7); c.fill(); c.beginPath(); c.ellipse(W / 2 + 24, 190, 30, 58, 0.3, 0, 7); c.fill();
    c.fillStyle = "#ffffff"; for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(40 + hash(i) * (W - 80), 110 + hash(i * 3) * 220, 8 + hash(i * 7) * 10, 0, 7); c.fill(); }
  }, "#ffffff");
  wash.rotation.y = Math.PI / 2; wash.position.set(-2.88, 1.75, 1.35); g.add(wash);

  // certificate, a second certificate, the clock
  const cert = poster(0.56, 0.42, (c, W, H) => {
    c.fillStyle = "#fff7e6"; c.fillRect(0, 0, W, H); c.strokeStyle = "#c9a227"; c.lineWidth = 8; c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = "#3a2a5a"; c.textAlign = "center"; c.font = `italic 700 30px Georgia, serif`; c.fillText("Certificate", W / 2, 58);
    c.font = `600 14px Georgia, serif`; c.fillText("FAMILY MEDICINE", W / 2, 84); c.font = `italic 600 20px Georgia, serif`; c.fillText("Dr Lim Wei Ming", W / 2, 116);
    c.fillStyle = "#8a7fa0"; c.fillRect(40, 140, W - 80, 3); c.fillRect(60, 152, W - 120, 3);
    c.fillStyle = "#e2433f"; c.beginPath(); c.arc(W - 52, H - 44, 20, 0, 7); c.fill(); c.fillStyle = "#ffd94a"; c.beginPath(); c.arc(W - 52, H - 44, 9, 0, 7); c.fill();
  }, "#c9a227");
  cert.position.set(1.3, 1.85, -2.17); g.add(cert);
  const cert2 = poster(0.36, 0.28, (c, W, H) => { c.fillStyle = "#f0f6ff"; c.fillRect(0, 0, W, H); c.strokeStyle = "#3f66d9"; c.lineWidth = 6; c.strokeRect(8, 8, W - 16, H - 16);
    c.fillStyle = "#3f66d9"; c.font = `italic 700 26px Georgia, serif`; c.textAlign = "center"; c.fillText("Diploma", W / 2, H / 2); c.fillStyle = "#8a7fa0"; c.fillRect(50, H / 2 + 20, W - 100, 3); }, "#5a3a2a");
  cert2.position.set(1.95, 1.62, -2.17); g.add(cert2);
  const clock = new THREE.Group(); clock.position.set(0.85, 2.45, -2.15); g.add(clock);
  clock.add(cyl(0.17, 0.17, 0.04, toon("#e2437f"), 0, 0, 0)); clock.children[0].rotation.x = Math.PI / 2;
  const cf = painted(0.3, 0.3, 128, 128, (c, W, H) => {
    c.fillStyle = "#ffffff"; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.fillStyle = "#3a2a5a";
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillRect(64 + Math.sin(a) * 50 - 3, 64 - Math.cos(a) * 50 - 3, 6, 6); }
    c.strokeStyle = "#3a2a5a"; c.lineCap = "round"; c.lineWidth = 7; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.sin(Math.PI * 2 * 10.5 / 12) * 30, 64 - Math.cos(Math.PI * 2 * 10.5 / 12) * 30); c.stroke();
    c.lineWidth = 4; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 64 + 44); c.stroke();
  });
  cf.position.z = 0.022; clock.add(cf);

  // the right wall: eye chart, glass cabinet with bottles, a scale, a tall plant
  const eye = poster(0.46, 0.7, (c, W, H) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H); c.fillStyle = "#1a1030"; c.textAlign = "center";
    ["E", "F P", "T O Z", "L P E D", "P E C F D", "E D F C Z P", "F E L O P Z D"].forEach((r, i) => { c.font = `800 ${Math.round(76 - i * 10)}px ${SANS}`; c.fillText(r, W / 2, 70 + i * 50 - i * i * 1.5); });
    c.fillStyle = "#e2433f"; c.fillRect(20, 300, W - 40, 3);
  }, "#3f66d9");
  eye.rotation.y = -Math.PI / 2; eye.position.set(2.88, 1.6, -0.4); g.add(eye);
  const cab = new THREE.Group(); cab.position.set(2.62, 0, -1.55); cab.rotation.y = -Math.PI / 2; g.add(cab);
  cab.add(rbox(0.9, 1.7, 0.42, 0.03, toon("#ffffff"), 0, 0.85, 0));
  for (let r = 0; r < 3; r++) {
    cab.add(box(0.82, 0.02, 0.36, toon("#e6eef2"), 0, 0.55 + r * 0.42, 0.02));
    for (let k = 0; k < 6; k++) {
      const col = ["#ff8fb0", "#ffd94a", "#5cc7ff", "#6be3a4", "#e57bff", "#ff9a5a"][(r * 6 + k) % 6];
      if (hash(r * 10 + k) > 0.45) cab.add(cyl(0.035, 0.035, 0.14 + hash(k + r) * 0.08, toon(col), -0.33 + k * 0.13, 0.64 + r * 0.42, 0.05));
      else cab.add(box(0.1, 0.12, 0.08, toon(col), -0.33 + k * 0.13, 0.62 + r * 0.42, 0.05));
    }
  }
  const cabGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 1.3), new THREE.MeshBasicMaterial({ color: "#d8f6ff", transparent: true, opacity: 0.22, depthWrite: false }));
  cabGlass.position.set(0, 1.0, 0.215); cab.add(noInk(cabGlass));
  cab.add(box(0.02, 1.3, 0.02, toon("#d9dde6"), 0, 1.0, 0.22));
  const scale = new THREE.Group(); scale.position.set(2.2, 0, 0.5); g.add(scale);
  scale.add(rbox(0.36, 0.06, 0.36, 0.02, toon("#ffffff"), 0, 0.03, 0), cyl(0.07, 0.07, 0.02, toon("#3f66d9"), 0, 0.07, 0.06));
  const tall = plant(2.2, "#2f9e5a"); tall.position.set(2.35, 0, -2.0); g.add(tall);

  // the left wall: examination couch with its paper roll, a curtain, the sink with mirror, dispensers and bins
  const couch = new THREE.Group(); couch.position.set(-2.35, 0, -1.0); g.add(couch);
  couch.add(rbox(0.66, 0.14, 1.7, 0.05, toon("#39a8b0"), 0, 0.5, 0));
  const head = rbox(0.66, 0.12, 0.5, 0.05, toon("#39a8b0"), 0, 0.62, -0.72); head.rotation.x = 0.45; couch.add(head);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) couch.add(box(0.05, 0.44, 0.05, toon("#c9ced8"), sx * 0.26, 0.22, sz * 0.72));
  couch.add(box(0.56, 0.04, 1.5, toon("#c9ced8"), 0, 0.12, 0));
  couch.add(box(0.44, 0.012, 1.55, toon("#ffffff"), 0, 0.575, 0.05)); // the paper sheet
  const roll = cyl(0.07, 0.07, 0.5, toon("#ffffff"), 0, 0.72, -1.0); roll.rotation.z = Math.PI / 2; couch.add(roll);
  couch.add(box(0.04, 0.2, 0.04, toon("#c9ced8"), -0.27, 0.66, -0.98), box(0.04, 0.2, 0.04, toon("#c9ced8"), 0.27, 0.66, -0.98));
  couch.add(rbox(0.36, 0.14, 0.28, 0.03, toon("#c9ced8"), 0.5, 0.07, 0.4)); // step stool
  couch.add(rbox(0.38, 0.03, 0.3, 0.01, toon("#5cc7ff"), 0.5, 0.15, 0.4));
  couch.add(rbox(0.28, 0.08, 0.2, 0.03, toon("#ffffff"), 0, 0.62, -0.5)); // a pillow
  // curtain rail and a pastel curtain, half drawn
  const rail = box(0.03, 0.03, 1.0, toon("#c9ced8"), -1.85, 2.5, -1.7); g.add(rail); // casts no shadow (see the end)
  const curt = painted(1.0, 2.0, 128, 256, (c, W, H) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#ffc8dc" : "#ffb0cc"; c.fillRect(i * 16, 0, 16, H); }
    c.fillStyle = "rgba(255,255,255,0.4)"; for (let i = 0; i < 20; i++) { c.beginPath(); c.arc(hash(i) * W, hash(i * 5) * H, 4, 0, 7); c.fill(); } });
  curt.rotation.y = Math.PI / 2; curt.scale.x = 0.6; curt.position.set(-1.85, 1.48, -1.62); curt.material.side = THREE.DoubleSide; g.add(curt);
  const sink = new THREE.Group(); sink.position.set(-2.6, 0, 1.0); sink.rotation.y = Math.PI / 2; g.add(sink);
  sink.add(rbox(0.6, 0.6, 0.45, 0.03, toon("#ffffff"), 0, 0.3, 0));
  sink.add(box(0.02, 0.5, 0.01, toon("#c9ced8"), 0, 0.3, 0.226));
  sink.add(rbox(0.5, 0.08, 0.38, 0.04, toon("#f0f4f8"), 0, 0.64, 0.02), box(0.36, 0.02, 0.24, toon("#9fb8c8"), 0, 0.685, 0.03));
  sink.add(cyl(0.015, 0.015, 0.16, toon("#c9ced8"), 0, 0.76, -0.14)); const spout = cyl(0.012, 0.012, 0.1, toon("#c9ced8"), 0, 0.83, -0.1); spout.rotation.x = Math.PI / 2; sink.add(spout);
  const mirror = painted(0.44, 0.56, 128, 160, (c, W, H) => { const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "#e8fbff"); gr.addColorStop(1, "#9fd8ea"); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 10; c.beginPath(); c.moveTo(20, 70); c.lineTo(70, 20); c.stroke(); }, { unlit: true });
  mirror.position.set(0, 1.25, -0.215); sink.add(mirror); sink.add(box(0.5, 0.62, 0.02, toon("#ffffff"), 0, 1.25, -0.228));
  sink.add(rbox(0.1, 0.18, 0.08, 0.02, toon("#5cc7ff"), 0.36, 1.0, -0.2)); // soap
  sink.add(rbox(0.28, 0.3, 0.1, 0.03, toon("#ffffff"), -0.48, 1.2, -0.17)); // paper towels
  sink.add(box(0.16, 0.02, 0.02, toon("#9fb8c8"), -0.48, 1.06, -0.12));
  g.add(rbox(0.2, 0.22, 0.16, 0.03, toon("#ffd94a"), -2.65, 0.11, 1.65)); // sharps bin
  g.add(box(0.12, 0.04, 0.02, toon("#e2433f"), -2.56, 0.18, 1.65));
  g.add(cyl(0.13, 0.12, 0.3, toon("#c9ced8"), -2.6, 0.15, 0.4)); // pedal bin
  g.add(cyl(0.135, 0.135, 0.03, toon("#ffffff"), -2.6, 0.31, 0.4));


  // more dressing: a doctor's rolling stool by the couch, a round floor mat, a coat stand, a side table with magazines
  const stool = new THREE.Group(); stool.position.set(-1.55, 0, -1.55); g.add(stool);
  stool.add(cyl(0.18, 0.18, 0.07, toon("#2f6f8f"), 0, 0.42, 0), cyl(0.02, 0.02, 0.32, toon("#c9ced8"), 0, 0.24, 0));
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const l = box(0.2, 0.025, 0.035, toon("#3a3550"), Math.cos(a) * 0.1, 0.05, Math.sin(a) * 0.1); l.rotation.y = -a; stool.add(l, ball(0.025, toon("#3a3550"), Math.cos(a) * 0.19, 0.025, Math.sin(a) * 0.19)); }
  const matF = painted(1.3, 1.3, 256, 256, (c, W, H) => { c.fillStyle = "#ff9fc0"; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, 7); c.fill();
    c.strokeStyle = "#ffd0e0"; c.lineWidth = 14; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 30, 0, 7); c.stroke(); c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 70, 0, 7); c.stroke(); });
  matF.material.transparent = true; matF.rotation.x = -Math.PI / 2; matF.position.set(-0.95, 0.004, 0.25); g.add(matF);
  const coat = new THREE.Group(); coat.position.set(-2.45, 0, 2.3); g.add(coat);
  coat.add(cyl(0.025, 0.025, 1.7, toon("#3a3550"), 0, 0.85, 0), cyl(0.18, 0.2, 0.03, toon("#3a3550"), 0, 0.015, 0));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const h = cyl(0.012, 0.012, 0.16, toon("#3a3550"), Math.cos(a) * 0.06, 1.62, Math.sin(a) * 0.06); h.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); coat.add(h); }
  coat.add(rbox(0.3, 0.36, 0.1, 0.04, toon("#ff8a3a"), 0.12, 1.32, 0.02), box(0.18, 0.03, 0.02, toon("#3a3550"), 0.12, 1.5, 0.02)); // a tote bag
  coat.add(rbox(0.36, 0.7, 0.14, 0.05, toon("#5cc7ff"), -0.1, 1.15, -0.04)); // a raincoat
  const side = new THREE.Group(); side.position.set(-2.35, 0, 0.3); g.add(side);
  side.add(rbox(0.5, 0.04, 0.4, 0.015, toon("#f0b97a"), 0, 0.45, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) side.add(cyl(0.015, 0.015, 0.45, toon("#e09c5a"), sx * 0.2, 0.225, sz * 0.15));
  ["#ff6f9f", "#39c6b0", "#ffd94a"].forEach((col, i) => { const m = box(0.22, 0.012, 0.28, toon(col), (i - 1) * 0.06, 0.48 + i * 0.013, (hash(i) - 0.5) * 0.06); m.rotation.y = (hash(i * 3) - 0.5) * 0.6; side.add(m); });
  side.add(cyl(0.05, 0.04, 0.1, toon("#ffffff"), 0.15, 0.52, -0.1), ball(0.06, toon("#ff8fb0"), 0.15, 0.6, -0.1)); // a cup of cotton balls
  g.add(rbox(0.1, 0.2, 0.08, 0.02, toon("#bfe9ff"), -2.62, 0.75, 1.35)); // hand sanitiser by the sink

  // Dr Lim's desk
  const wood = toon("#f0b97a"), wood2 = toon("#e09c5a");
  g.add(rbox(1.62, 0.05, 0.74, 0.02, wood, 0.35, 0.585, -0.85));
  g.add(box(1.5, 0.42, 0.03, wood2, 0.35, 0.34, -0.53)); // modesty panel
  g.add(box(0.05, 0.56, 0.05, wood2, -0.4, 0.28, -0.56), box(0.05, 0.56, 0.05, wood2, -0.4, 0.28, -1.15));
  g.add(rbox(0.34, 0.56, 0.68, 0.02, wood2, 0.97, 0.28, -0.85));
  for (let i = 0; i < 3; i++) g.add(box(0.12, 0.025, 0.02, toon("#3a2a5a"), 0.97, 0.45 - i * 0.16, -1.2));
  const top = 0.61;
  // monitor (turned toward the patients), keyboard, mouse
  const mon = new THREE.Group(); mon.position.set(0.86, top, -1.0); mon.rotation.y = -0.6; g.add(mon);
  mon.add(rbox(0.24, 0.02, 0.16, 0.01, toon("#3a3550"), 0, 0.01, 0), box(0.04, 0.2, 0.03, toon("#3a3550"), 0, 0.11, -0.03));
  mon.add(rbox(0.56, 0.36, 0.035, 0.015, toon("#2a2633"), 0, 0.36, 0));
  const screen = painted(0.52, 0.31, 320, 190, (c, W, H) => {
    c.fillStyle = "#16224a"; c.fillRect(0, 0, W, H); c.fillStyle = "#39d3ff"; c.fillRect(0, 0, W, 26);
    c.fillStyle = "#16224a"; c.font = `800 16px ${SANS}`; c.fillText("TAN · 67 · BP", 10, 19);
    c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 1; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(20, 50 + i * 30); c.lineTo(W - 10, 50 + i * 30); c.stroke(); }
    const pts = [130, 128, 134, 131, 138, 142, 140, 152];
    c.strokeStyle = "#ff6fb0"; c.lineWidth = 4; c.beginPath(); pts.forEach((v, i) => { const x = 30 + i * 38, y = 190 - (v - 100) * 2.6; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    c.fillStyle = "#ffd94a"; pts.forEach((v, i) => { c.beginPath(); c.arc(30 + i * 38, 190 - (v - 100) * 2.6, 5, 0, 7); c.fill(); });
    const pd = [82, 80, 84, 83, 86, 90, 88, 94]; c.strokeStyle = "#39d3ff"; c.beginPath(); pd.forEach((v, i) => { const x = 30 + i * 38, y = 230 - (v - 60) * 2.6; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  }, { unlit: true });
  screen.position.set(0, 0.36, 0.019); mon.add(screen);
  const kb = new THREE.Group(); kb.position.set(0.46, top, -1.07); kb.rotation.y = -0.25; g.add(kb);
  kb.add(rbox(0.38, 0.022, 0.13, 0.008, toon("#e8ecf4"), 0, 0.011, 0));
  const keys = painted(0.36, 0.11, 256, 80, (c, W, H) => { c.fillStyle = "#cfd6e4"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) c.fillRect(4 + k * 18, 4 + r * 19, 15, 15); });
  keys.rotation.x = -Math.PI / 2; keys.position.y = 0.023; kb.add(keys);
  g.add(rbox(0.06, 0.025, 0.09, 0.02, toon("#e8ecf4"), 0.7, top + 0.012, -1.0));
  // BP monitor with its tube; the cuff lies by it (the chapter moves the cuff onto his arm)
  const bp = bpMonitor(); bp.position.set(-0.05, top, -0.88); bp.rotation.y = 0.45; g.add(bp);
  const cuff = new THREE.Group(); g.add(cuff);
  cuff.add(rbox(0.2, 0.05, 0.15, 0.02, toon("#2c4fb0"), 0, 0.025, 0), box(0.2, 0.012, 0.05, toon("#8fb0ff"), 0, 0.052, 0.03));
  // on his arm the flat cuff is swapped for a sleeve that wraps the arm (cuff.userData.wrap(true))
  const flatParts = [...cuff.children];
  const sleeve = rbox(0.19, 0.13, 0.2, 0.04, toon("#2c4fb0"), 0, 0, 0); sleeve.visible = false; cuff.add(sleeve);
  const strip = box(0.195, 0.03, 0.205, toon("#8fb0ff"), 0, 0.03, 0); strip.visible = false; cuff.add(strip);
  cuff.userData.wrap = (on) => { flatParts.forEach((m) => (m.visible = !on)); sleeve.visible = strip.visible = on; };
  cuff.position.set(-0.13, top, -1.07); cuff.rotation.y = 0.3;
  g.userData.cuffRest = { pos: cuff.position.clone(), rotY: 0.3 };
  // the tube: a chain of short segments, re-laid every frame between the monitor and the cuff (setTube)
  const tubeM = toon("#1d2a5a"), segs = [];
  for (let i = 0; i < 10; i++) { const s = cyl(0.008, 0.008, 1, tubeM, 0, 0, 0, 8); g.add(s); segs.push(s); }
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  g.userData.setTube = (from, to, sag = 0.06) => {
    A.copy(from); B.copy(to); C.copy(A).add(B).multiplyScalar(0.5); C.y = Math.max(top + 0.01, Math.min(A.y, B.y) - sag);
    for (let i = 0; i < segs.length; i++) {
      const k0 = i / segs.length, k1 = (i + 1) / segs.length;
      const q = (k, out) => out.set(0, 0, 0).addScaledVector(A, (1 - k) * (1 - k)).addScaledVector(C, 2 * k * (1 - k)).addScaledVector(B, k * k);
      q(k0, P); q(k1, Q);
      const s = segs[i]; s.position.copy(P).add(Q).multiplyScalar(0.5);
      const d = Q.clone().sub(P); s.scale.set(1, Math.max(0.001, d.length()), 1); s.quaternion.setFromUnitVectors(up, d.normalize());
    }
  };
  g.userData.bpPort = new THREE.Vector3(-0.08, top + 0.05, -0.96);
  g.userData.setTube(g.userData.bpPort, new THREE.Vector3(-0.13, top + 0.03, -1.07));
  // the jar of tongue depressors, pen cup, sanitiser, the desk lamp with its warm pool, tissues, folders, name plate
  const jar = new THREE.Group(); jar.position.set(0.1, top, -1.15); g.add(jar);
  const glassM = new THREE.MeshToonMaterial({ color: "#d8f6ff", transparent: true, opacity: 0.45, depthWrite: false });
  jar.add(cyl(0.055, 0.055, 0.15, glassM, 0, 0.075, 0), cyl(0.058, 0.058, 0.012, toon("#c9ced8"), 0, 0.006, 0));
  for (let i = 0; i < 9; i++) { const s = box(0.018, 0.2, 0.004, toon("#f2d9a6"), (hash(i) - 0.5) * 0.06, 0.13, (hash(i * 3) - 0.5) * 0.06); s.rotation.set((hash(i * 5) - 0.5) * 0.4, hash(i * 7) * 3, (hash(i * 11) - 0.5) * 0.4); jar.add(s); }
  const pens = new THREE.Group(); pens.position.set(1.07, top, -1.12); g.add(pens);
  pens.add(cyl(0.04, 0.035, 0.11, toon("#e2437f"), 0, 0.055, 0));
  ["#3f66d9", "#ffd94a", "#2f9e6a", "#1a1030"].forEach((col, i) => { const p = cyl(0.007, 0.007, 0.17, toon(col), (i - 1.5) * 0.015, 0.13, (hash(i) - 0.5) * 0.02); p.rotation.z = (i - 1.5) * 0.12; pens.add(p); });
  const lampG = new THREE.Group(); lampG.position.set(-0.38, top, -1.15); lampG.rotation.y = 0.7; g.add(lampG);
  const lampM = toon("#ff6f91");
  lampG.add(cyl(0.07, 0.08, 0.03, lampM, 0, 0.015, 0));
  const arm1 = cyl(0.012, 0.012, 0.32, lampM, 0, 0.16, 0.04); arm1.rotation.x = 0.25; lampG.add(arm1);
  const arm2 = cyl(0.012, 0.012, 0.26, lampM, 0, 0.36, 0.13); arm2.rotation.x = 1.2; lampG.add(arm2);
  const shade = cyl(0.03, 0.09, 0.11, lampM, 0, 0.36, 0.26); shade.rotation.x = 0.7; lampG.add(shade);
  const bulb = ball(0.03, flat("#ffe9a8"), 0, 0.325, 0.29); lampG.add(bulb);
  const lg = glow(0.13, "rgba(255,190,110,0.45)", 0.45); lg.position.set(0, 0.31, 0.31); lampG.add(lg);
  const pool = lightPool(0.8, 0.55, "rgba(255,200,120,0.4)"); pool.position.set(-0.25, top + 0.003, -0.9); g.add(pool);
  g.add(rbox(0.18, 0.09, 0.11, 0.015, toon("#ff8fb0"), 1.03, top + 0.045, -0.63), ball(0.04, toon("#ffffff"), 1.03, top + 0.1, -0.63)); // tissues
  ["#5cc7ff", "#ffd94a", "#6be3a4"].forEach((col, i) => { const f = box(0.26, 0.02, 0.2, toon(col), 0.72, top + 0.012 + i * 0.022, -0.63); f.rotation.y = (hash(i) - 0.5) * 0.3; g.add(f); });
  const plate = new THREE.Group(); plate.position.set(0.3, top, -0.58); g.add(plate);
  const pl = box(0.3, 0.07, 0.012, toon("#3a2a5a"), 0, 0.035, 0); pl.rotation.x = -0.35; plate.add(pl);
  const plt = painted(0.28, 0.06, 256, 56, (c, W, H) => { c.fillStyle = "#3a2a5a"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffd94a"; c.font = `800 26px ${SANS}`; c.textAlign = "center"; c.fillText("DR LIM WEI MING", W / 2, 37); });
  plt.position.set(0, 0.036, 0.008); plt.rotation.x = -0.35; plate.add(plt);
  const succ = plant(0.45, "#3fae6b"); succ.position.set(1.07, top, -0.84); g.add(succ);

  // Dr Lim's office chair (at his place, turned toward the patients)
  const oc = new THREE.Group(); oc.position.set(0.28, 0, -1.42); oc.rotation.y = -0.45; g.add(oc);
  const dk = toon("#3a3550");
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = box(0.28, 0.03, 0.04, dk, Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14); leg.rotation.y = -a; oc.add(leg); oc.add(ball(0.03, dk, Math.cos(a) * 0.27, 0.03, Math.sin(a) * 0.27)); }
  oc.add(cyl(0.025, 0.025, 0.24, toon("#c9ced8"), 0, 0.18, 0));
  oc.add(rbox(0.5, 0.08, 0.48, 0.035, toon("#2f6f8f"), 0, 0.33, 0));
  oc.add(rbox(0.48, 0.5, 0.07, 0.035, toon("#2f6f8f"), 0, 0.72, -0.26), box(0.06, 0.25, 0.04, dk, 0, 0.45, -0.25));
  // two chairs for Mr Tan and Wei Ling (seat tops at 0.33)
  const chair = (col, x, z, ry) => {
    const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry;
    c.add(rbox(0.46, 0.06, 0.44, 0.025, toon(col), 0, 0.3, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.add(cyl(0.018, 0.018, 0.3, toon("#c9ced8"), sx * 0.19, 0.15, sz * 0.18));
    c.add(rbox(0.44, 0.32, 0.05, 0.025, toon(col), 0, 0.58, -0.23), cyl(0.015, 0.015, 0.3, toon("#c9ced8"), -0.17, 0.42, -0.22), cyl(0.015, 0.015, 0.3, toon("#c9ced8"), 0.17, 0.42, -0.22));
    g.add(c); return c;
  };
  g.userData.chairTan = chair("#ff6f9f", -0.72, -0.86, 1.1);
  g.userData.chairWei = chair("#ffc83a", -1.25, -0.42, 0.8);

  g.userData.bp = bp; g.userData.cuff = cuff; g.userData.top = top;
  casters(g);
  // the curtain rail and the blind cord are thin sticks whose shadows land on the back wall as a dark scratch across the
  // anatomy poster (the painted curtain casts nothing, so the rail's shadow has no reason to be there)
  rail.castShadow = false; g.traverse((o) => { if (o.isMesh && o.geometry.parameters?.radiusTop === 0.005) o.castShadow = false; });
  return g;
}
