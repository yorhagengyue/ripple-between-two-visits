// c10's set: a little theatre stage for the tour of the app ("What Ripple does"). A plank stage with a painted
// backdrop (sky ribbons over the estate), red side curtains and a valance with bulbs, a main curtain in two halves that
// opens and closes, footlights, a warm spot on the floor, plants and stage lamps. Origin = stage floor centre; the
// backdrop is at z = -2.6, the main curtain at z = 1.25, the stage's front edge at z = 1.9; the camera sits at +z.
// Props for the six beats live in g.userData and are posed by the chapter every frame (their state is set explicitly
// in every shot, never carried between frames).
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { box, rbox, cyl, ball, painted, planks, plant, shadowy } from "./kit.js";
import { hash } from "../core.js";

const SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const BANG = '"Bangers", "Impact", sans-serif';
const INK = "#1a1030";

/** A curtain made of round folds; its pivot is the bottom centre. */
function curtain(w, h, n, c1, c2, fringe = "#ffc94a") {
  const g = new THREE.Group();
  const r = (w / n / 2) * 1.12;
  for (let i = 0; i < n; i++) g.add(cyl(r, r * 1.06, h, toon(i % 2 ? c1 : c2), -w / 2 + (i + 0.5) * (w / n), h / 2, (i % 2) * 0.06, 10));
  g.add(box(w + r, 0.09, r * 2.3, toon(fringe), 0, 0.045, 0.02));
  return g;
}

/** A redrawable canvas plane: draw(c, W, H, state) runs only when the state key changes. */
function livePlane(w, h, pxW, pxH, draw, unlit = false) {
  const cv = document.createElement("canvas"); cv.width = pxW; cv.height = pxH;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = unlit ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : toon("#ffffff", { map: tex });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  let last = null;
  m.userData.set = (state) => { const k = JSON.stringify(state); if (k === last) return; last = k; draw(cv.getContext("2d"), pxW, pxH, state); tex.needsUpdate = true; };
  return m;
}

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

// ---------------------------------------------------------------- props

/** A phone: dark body, a glowing screen on +z. userData.screen is the screen material (set its colour). */
export function phoneProp() {
  const g = new THREE.Group();
  g.add(rbox(0.12, 0.23, 0.02, 0.014, toon("#7a5ce0")));  // stage-sized, a little bigger than a real phone, violet case
  g.add(rbox(0.035, 0.035, 0.006, 0.008, toon("#2a2633"), -0.028, 0.08, -0.011)); // camera bump on the back
  const scr = new THREE.MeshBasicMaterial({ color: "#d9ccff", toneMapped: false });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.102, 0.205), scr); s.position.z = 0.0105; g.add(s);
  g.userData.screen = scr;
  return g;
}

/** A magician's round table (pedestal) about 0.62 m high; things stand on top at y = 0.65. */
export function pedestal(top = "#e2433f") {
  const g = new THREE.Group();
  g.add(cyl(0.2, 0.24, 0.05, toon("#3a2f55"), 0, 0.025, 0));
  g.add(cyl(0.04, 0.05, 0.56, toon("#ffc94a"), 0, 0.31, 0));
  g.add(cyl(0.3, 0.27, 0.06, toon(top), 0, 0.6, 0));
  g.add(cyl(0.305, 0.305, 0.02, toon("#ffc94a"), 0, 0.635, 0));
  return g;
}

/** The big Amlodipine box (a stage-sized prop). */
export function bigMedBox() {
  const g = new THREE.Group();
  const w = 0.46, h = 0.28, d = 0.17;
  g.add(box(w, h, d, toon("#ffffff"), 0, h / 2, 0));
  const f = painted(w * 0.98, h * 0.96, 512, 312, (c, W, H) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#3f66d9"; c.fillRect(0, 0, W, H * 0.16); c.fillStyle = "#ff8fb0"; c.fillRect(0, H * 0.84, W, H * 0.16);
    c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `900 78px ${SANS}`; c.fillText("Amlodipine", W / 2, H * 0.43);
    c.font = `800 52px ${SANS}`; c.fillStyle = "#e2433f"; c.fillText("5 mg", W / 2, H * 0.68);
  });
  f.position.set(0, h / 2, d / 2 + 0.002); g.add(f);
  return g;
}

/** A home blood-pressure monitor showing 152/96, with its cuff and tube. */
export function bpMonitor() {
  const g = new THREE.Group();
  g.add(rbox(0.34, 0.24, 0.14, 0.03, toon("#f4f6fb"), 0, 0.12, 0));
  const lcd = painted(0.24, 0.15, 256, 160, (c, W, H) => {
    c.fillStyle = "#cfe8d2"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#1d2a22"; c.textAlign = "right"; c.textBaseline = "middle";
    c.font = `900 70px "Courier New", monospace`; c.fillText("152", W - 18, H * 0.3);
    c.font = `900 58px "Courier New", monospace`; c.fillText("96", W - 18, H * 0.74);
    c.textAlign = "left"; c.font = `700 22px ${SANS}`; c.fillText("SYS", 12, H * 0.3); c.fillText("DIA", 12, H * 0.74);
  }, { unlit: true });
  lcd.position.set(0, 0.14, 0.071); g.add(lcd);
  g.add(cyl(0.025, 0.025, 0.012, toon("#3f66d9"), 0.12, 0.04, 0.072).rotateX(Math.PI / 2));
  // the cuff lying beside it and a tube
  const cuff = rbox(0.3, 0.05, 0.16, 0.025, toon("#3f66d9"), 0.36, 0.025, 0.02); g.add(cuff);
  const tube = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 18, Math.PI), toon("#2a2633"));
  tube.position.set(0.2, 0.05, 0.05); tube.rotation.x = -Math.PI / 2; g.add(tube);
  return g;
}

/** A clipboard titled NEXT VISIT with a few question cards; userData.cards = how many cards show (set(n)). */
export function clipboard() {
  const g = new THREE.Group();
  g.add(rbox(0.32, 0.42, 0.02, 0.01, toon("#c77a4a")));
  g.add(box(0.1, 0.035, 0.03, toon("#9aa3b5"), 0, 0.2, 0.012));
  const paper = livePlane(0.28, 0.36, 280, 360, (c, W, H, n) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H);
    c.fillStyle = INK; c.textAlign = "center"; c.font = `44px ${BANG}`; c.fillText("NEXT VISIT", W / 2, 52);
    for (let i = 0; i < 3; i++) {
      const y = 76 + i * 92;
      if (i >= n) { c.strokeStyle = "rgba(60,40,90,.25)"; c.setLineDash([8, 8]); c.lineWidth = 3; c.strokeRect(18, y, W - 36, 78); c.setLineDash([]); continue; }
      c.fillStyle = i === n - 1 ? "#ffe37a" : "#e9e2ff"; c.fillRect(18, y, W - 36, 78);
      c.strokeStyle = INK; c.lineWidth = 3; c.strokeRect(18, y, W - 36, 78);
      c.fillStyle = "#9b6bff"; c.font = `52px ${BANG}`; c.textAlign = "left"; c.fillText("?", 30, y + 58);
      c.fillStyle = "rgba(40,30,70,.55)"; for (let k = 0; k < 3; k++) c.fillRect(72, y + 16 + k * 19, (W - 120) * (0.6 + hash(i * 5 + k) * 0.4), 8);
    }
  });
  paper.position.z = 0.012; g.add(paper); g.userData.paper = paper;
  paper.userData.set(2);
  return g;
}

/** A small paper card with a question mark (it flies from his phone to the clipboard). */
export function noteCard() {
  const g = new THREE.Group();
  const p = painted(0.2, 0.13, 200, 130, (c, W, H) => {
    c.fillStyle = "#ffe37a"; c.fillRect(0, 0, W, H); c.strokeStyle = INK; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
    c.fillStyle = "#9b6bff"; c.font = `100px ${BANG}`; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("?", 18, H / 2 + 6);
    c.fillStyle = "rgba(40,30,70,.55)"; for (let k = 0; k < 3; k++) c.fillRect(70, 28 + k * 28, 100 - k * 18, 10);
  });
  p.material.side = THREE.DoubleSide; g.add(p);
  return g;
}

/** A small round side table (top at y = 0.62). */
export function sideTable() {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.34, 0.04, toon("#f2e3c8"), 0, 0.6, 0));
  g.add(cyl(0.035, 0.035, 0.58, toon("#c77a4a"), 0, 0.3, 0));
  g.add(cyl(0.18, 0.2, 0.03, toon("#c77a4a"), 0, 0.015, 0));
  return g;
}

/** The sharing switch: a box on a post with a big lever (userData.lever: rotation.z from 0.7 off to -0.7 on) and a lamp
 *  on top (userData.lamp: material; colour it on or off). */
export function switchBox() {
  const g = new THREE.Group();
  g.add(cyl(0.04, 0.05, 0.6, toon("#3a2f55"), 0, 0.3, 0));
  g.add(cyl(0.16, 0.18, 0.03, toon("#3a2f55"), 0, 0.015, 0));
  g.add(rbox(0.42, 0.32, 0.2, 0.03, toon("#ffd94a"), 0, 0.74, 0));
  // the plate shows the state the lever is in, so no crop can read the wrong word
  const plate = livePlane(0.36, 0.11, 360, 110, (c, W, H, on) => {
    c.fillStyle = INK; c.fillRect(0, 0, W, H);
    c.font = `78px ${BANG}`; c.textBaseline = "middle"; c.textAlign = "center";
    c.fillStyle = on ? "#2ff0b0" : "#ff6f6f"; c.fillText(on ? "ON" : "OFF", W / 2, H / 2 + 5);
  }, true);
  plate.position.set(0, 0.64, 0.101); g.add(plate); plate.userData.set(false);
  g.userData.setOn = (on) => plate.userData.set(!!on);
  const lever = new THREE.Group(); lever.position.set(0, 0.78, 0.1);
  lever.add(cyl(0.04, 0.04, 0.06, toon("#3a2f55"), 0, 0, 0).rotateX(Math.PI / 2));
  lever.add(cyl(0.018, 0.018, 0.26, toon("#c9ced8"), 0, 0.13, 0.03));
  lever.add(ball(0.055, toon("#e2433f"), 0, 0.27, 0.03));
  g.add(lever); g.userData.lever = lever;
  const lampMat = new THREE.MeshBasicMaterial({ color: "#3a4a44", toneMapped: false });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), lampMat); lamp.position.set(0, 0.9, 0); g.add(lamp);
  g.add(cyl(0.08, 0.08, 0.02, toon("#3a2f55"), 0, 0.9, 0));
  g.userData.lamp = lampMat;
  return g;
}

/** The giant TAKEN button: a pedestal, a dark ring and a green dome (userData.dome; press it with position.y). */
export function takenButton() {
  const g = new THREE.Group();
  g.add(cyl(0.3, 0.34, 0.56, toon("#f4f6fb"), 0, 0.28, 0, 28));
  g.add(cyl(0.31, 0.31, 0.04, toon("#3a2f55"), 0, 0.58, 0, 28));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), toon("#2fd07a", { emissive: "#0d5a33", emissiveIntensity: 0.4 }));
  dome.scale.y = 0.6; dome.position.y = 0.6; g.add(dome); g.userData.dome = dome;
  const plate = painted(0.42, 0.16, 420, 160, (c, W, H) => {
    c.fillStyle = INK; c.fillRect(0, 0, W, H); c.fillStyle = "#2ff0b0"; c.font = `118px ${BANG}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("TAKEN", W / 2, H / 2 + 8);
  }, { unlit: true });
  plate.position.set(0, 0.36, 0.335); g.add(plate);
  return g;
}

/** A week board on a stand: Mon to Sun with a dot each; set(n) = how many days are ticked (3 or 4). */
export function weekBoard() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.04, 1.1, 0.04, toon("#3a2f55"), s * 0.5, 0.55, -0.02));
  g.add(rbox(1.12, 0.5, 0.04, 0.02, toon("#2a1f4a"), 0, 1.0, 0));
  const face = livePlane(1.04, 0.42, 832, 336, (c, W, H, n) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H);
    c.fillStyle = INK; c.font = `800 34px ${SANS}`; c.textAlign = "left"; c.fillText("This week", 26, 50);
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    days.forEach((d, i) => {
      const x = 70 + i * 116, y = 170;
      c.textAlign = "center"; c.fillStyle = INK; c.font = `700 30px ${SANS}`; c.fillText(d, x, y - 62);
      c.beginPath(); c.arc(x, y, 40, 0, 7);
      if (i < n) { c.fillStyle = "#2fd0a0"; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 9; c.lineCap = "round"; c.beginPath(); c.moveTo(x - 17, y + 1); c.lineTo(x - 4, y + 15); c.lineTo(x + 19, y - 13); c.stroke(); }
      else { c.setLineDash([9, 8]); c.strokeStyle = "#8a83a3"; c.lineWidth = 5; c.stroke(); c.setLineDash([]); }
      c.fillStyle = i < n ? "#1f8a66" : "#8a83a3"; c.font = `700 24px ${SANS}`; c.fillText(i < n ? "Taken" : "Not yet", x, y + 76);
    });
  });
  face.position.set(0, 1.0, 0.022); g.add(face); g.userData.face = face; face.userData.set(3);
  return g;
}

/** An easel with the checklist card: screening and vaccination lines from the national tables. set(n) reveals rows. */
export function checklistEasel() {
  const g = new THREE.Group();
  const wood = toon("#c77a4a");
  const l1 = box(0.05, 1.9, 0.05, wood, -0.42, 0.92, 0.05); l1.rotation.z = -0.12; g.add(l1);
  const l2 = box(0.05, 1.9, 0.05, wood, 0.42, 0.92, 0.05); l2.rotation.z = 0.12; g.add(l2);
  const l3 = box(0.05, 1.8, 0.05, wood, 0, 0.85, -0.3); l3.rotation.x = -0.3; g.add(l3);
  g.add(box(1.16, 0.05, 0.12, wood, 0, 0.6, 0.1));
  g.add(rbox(1.16, 1.0, 0.04, 0.02, toon("#2a1f4a"), 0, 1.12, 0.07));
  const face = livePlane(1.1, 0.94, 880, 752, (c, W, H, n) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#2a1f4a"; c.fillRect(0, 0, W, 96);
    c.fillStyle = "#ffd94a"; c.font = `60px ${BANG}`; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("FROM THE NATIONAL TABLES", 30, 52);
    const rows = [["Healthier SG Screening", "what the table lists"], ["National Adult Immunisation Schedule", "what the table lists"]];
    rows.forEach(([a, b], i) => {
      if (i >= n) return;
      const y = 150 + i * 170;
      c.strokeStyle = INK; c.lineWidth = 6; c.strokeRect(34, y, 52, 52);
      c.fillStyle = INK; c.font = `800 37px ${SANS}`; c.textBaseline = "top"; c.fillText(a, 106, y + 2);
      c.fillStyle = "#6a5f88"; c.font = `600 30px ${SANS}`; c.fillText(b, 106, y + 54);
    });
    if (n >= 3) {
      const btn = (x, w, t, fill) => { roundRect(c, x, 520, w, 96, 20); c.fillStyle = fill; c.fill(); c.lineWidth = 5; c.strokeStyle = "#2a1f4a"; c.stroke();
        c.fillStyle = fill === "#2a1f4a" ? "#ffffff" : "#2a1f4a"; c.font = `800 34px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(t, x + w / 2, 568); c.textAlign = "left"; };
      btn(30, 400, "Add to my questions", n >= 4 ? "#ffd94a" : "#2a1f4a");
      btn(450, 400, "I did this already", "#ffffff");
    }
  });
  face.position.set(0, 1.12, 0.092); g.add(face); g.userData.face = face; face.userData.set(0);
  return g;
}

// ---------------------------------------------------------------- the stage

export function buildC10Stage() {
  const g = new THREE.Group();
  const P = {};

  // floor: the stage planks, a darker apron in front, the front face with a gold trim, the house floor below
  const fl = planks(12, 4.6, "#e0a060", "#cf8c4f"); fl.position.z = -0.4; g.add(fl);
  g.add(box(12, 0.6, 0.06, toon("#5a2a6e"), 0, -0.3, 1.92));
  g.add(box(12, 0.06, 0.12, toon("#ffc94a"), 0, -0.02, 1.9));
  const house = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), toon("#2a1a4a")); house.rotation.x = -Math.PI / 2; house.position.set(0, -0.6, 6); g.add(house);
  // footlights along the front edge
  for (let i = 0; i < 13; i++) {
    const x = -5.4 + i * 0.9;
    g.add(box(0.36, 0.06, 0.16, toon("#3a2f55"), x, 0.03, 1.78));
    const bulb = ball(0.07, flat("#fff2b8")); bulb.scale.set(1.6, 0.7, 1); bulb.position.set(x, 0.07, 1.78); g.add(bulb);
  }
  // the warm spot on the floor where they stand, and a fainter outer ring
  const spot = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), toon("#ffe6a8", { emissive: "#ffb85a", emissiveIntensity: 0.28 }));
  spot.rotation.x = -Math.PI / 2; spot.position.set(0, 0.006, 0.05); g.add(spot); P.spot = spot;
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.0, 48), toon("#f3c27e")); halo.rotation.x = -Math.PI / 2; halo.position.set(0, 0.005, 0.05); g.add(halo);

  // the painted backdrop: sky ribbons over the estate, as a theatre cloth
  const back = painted(12, 5.4, 1024, 461, (c, W, H) => {
    // a theatre cloth: deep violet sky with stars, pink ribbons, a low band of estate blocks with a few lit windows
    const gr = c.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#2f1f72"); gr.addColorStop(0.42, "#6a3fb8"); gr.addColorStop(0.7, "#ff8fb0"); gr.addColorStop(1, "#ffc890");
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(255,240,200,${0.35 + hash(i * 3) * 0.5})`; c.beginPath(); c.arc(hash(i * 7) * W, hash(i * 11) * H * 0.42, 1 + hash(i * 5) * 2, 0, 7); c.fill(); }
    c.lineCap = "round";
    for (let i = 0; i < 2; i++) {
      const y = H * (0.5 + i * 0.09);
      c.strokeStyle = i ? "#ff9fc0" : "#ff7fb0"; c.lineWidth = H * 0.03;
      c.beginPath(); for (let x = -20; x <= W + 20; x += 20) c.lineTo(x, y + Math.sin(x / 80 + i * 2) * H * 0.014); c.stroke();
      c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 2;
      c.beginPath(); for (let x = -20; x <= W + 20; x += 20) c.lineTo(x, y - H * 0.011 + Math.sin(x / 80 + i * 2) * H * 0.014); c.stroke();
    }
    const cols = ["#5a3f9e", "#6b50b4", "#4e3590", "#7a5cc4"];
    for (let i = 0; i < 12; i++) {
      const bw = W * (0.07 + hash(i + 40) * 0.05), bh = H * (0.16 + hash(i * 5 + 40) * 0.2), x = (i / 12) * W + hash(i * 9) * 20 - 10, y = H - bh;
      c.fillStyle = cols[i % 4]; c.fillRect(x, y, bw, bh); c.fillStyle = "rgba(30,15,70,.3)"; c.fillRect(x + bw * 0.85, y, bw * 0.15, bh);
      for (let r = 0; r < bh / 18 - 1; r++) for (let k = 0; k < 3; k++) if (hash(i * 100 + r * 7 + k) > 0.78) { c.fillStyle = "#ffd98a"; c.fillRect(x + 6 + k * (bw - 12) / 3, y + 8 + r * 18, (bw - 12) / 3 - 5, 8); }
    }
  });
  back.position.set(0, 2.7, -2.62); g.add(back);
  // cut-out clouds in front of the cloth (depth layer), hung on strings
  const cloudTex = (seed) => (c, W, H) => {
    c.clearRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.strokeStyle = INK; c.lineWidth = 8;
    c.beginPath(); for (let i = 0; i < 5; i++) c.arc(W * (0.18 + i * 0.16), H * (0.62 - (i % 2) * 0.16 - hash(seed + i) * 0.08), H * (0.24 + hash(seed * 3 + i) * 0.1), 0, 7);
    c.fill(); c.stroke();
    c.beginPath(); for (let i = 0; i < 5; i++) c.arc(W * (0.18 + i * 0.16), H * (0.62 - (i % 2) * 0.16 - hash(seed + i) * 0.08), H * (0.24 + hash(seed * 3 + i) * 0.1) - 4, 0, 7); c.fill();
    c.fillRect(W * 0.14, H * 0.62, W * 0.72, H * 0.22);
  };
  [[-2.4, 3.3, -2.2, 1.6], [2.9, 2.6, -2.25, 1.3], [-0.2, 3.9, -2.3, 1.1]].forEach(([x, y, z, s], i) => {
    const cl = new THREE.Group(); cl.position.set(x, y, z);
    for (let k = 0; k < 5; k++) { const b = ball((0.2 + hash(i * 7 + k) * 0.1) * s, toon("#ffffff"), (k - 2) * 0.2 * s, (k % 2 ? 0.08 : 0) * s, 0); b.scale.z = 0.25; cl.add(b); }
    cl.add(box(0.85 * s, 0.18 * s, 0.05, toon("#ffffff"), 0, -0.1 * s, 0));
    g.add(cl);
    g.add(box(0.01, 3, 0.01, toon("#3a2f55"), x, y + 1.7, z));
  });
  // a string of bulbs drooping across the back
  for (let i = 0; i < 26; i++) {
    const x = -6 + i * 0.48, y = 2.9 - Math.sin((i / 25) * Math.PI) * 0.55 + Math.sin(i * 1.7) * 0.02;
    const col = ["#ffe37a", "#ff8fb0", "#7fe0ff", "#a8ff9a"][i % 4];
    g.add(ball(0.045, flat(col), x, y, -2.1));
  }

  // side curtains (legs) and the valance across the top, with a row of bulbs
  for (const s of [-1, 1]) { const leg = curtain(2.2, 4.6, 7, "#c8203f", "#a8183a"); leg.position.set(s * 4.5, 0, 1.45); g.add(leg); }
  g.add(box(11.5, 0.6, 0.08, toon("#c8203f"), 0, 4.15, 1.5));
  g.add(box(11.5, 0.06, 0.1, toon("#ffc94a"), 0, 4.3, 1.52));
  for (let i = 0; i < 18; i++) { const sc = ball(0.32, toon("#c8203f"), -5.43 + i * 0.64, 3.86, 1.5); sc.scale.set(1, 0.6, 0.2); g.add(sc); }
  for (let i = 0; i < 22; i++) g.add(ball(0.05, flat("#fff2b8"), -5.25 + i * 0.5, 3.48, 1.56));
  // the proscenium: gold posts and a header in front of the curtains
  for (const s of [-1, 1]) g.add(box(0.22, 4.6, 0.22, toon("#ffc94a"), s * 5.6, 2.3, 1.62));
  g.add(box(11.4, 0.26, 0.22, toon("#ffc94a"), 0, 4.45, 1.62));

  // the main curtain: two halves that slide (setCurtain(open 0..1))
  const halves = [-1, 1].map((s) => { const h = curtain(3.7, 4.4, 12, "#d42a48", "#b51d3d"); const p = new THREE.Group(); p.add(h); h.position.x = s * 1.85; g.add(p); p.position.set(0, 0, 1.22); return { p, h, s }; });
  g.userData.setCurtain = (open) => {
    for (const { p, h, s } of halves) {
      // closed: each half covers 0..±3.7; open: squeezed to 30% and pushed out behind the legs
      const sq = 1 - 0.7 * open;
      p.scale.x = sq; p.position.x = s * open * 3.55; p.visible = open < 0.995;
      h.position.x = s * 1.85;
    }
  };
  g.userData.setCurtain(1);

  // stage dressing: two potted palms, two stage lamps on stands, a trunk with a star
  for (const [x, z, s] of [[-3.1, -1.7, 2.3], [3.3, -1.6, 2.0]]) { const p = plant(s, "#2f9e6a"); p.position.set(x, 0, z); g.add(p); }
  for (const s of [-1, 1]) {
    const st = new THREE.Group(); st.position.set(s * 2.55, 0, -1.25);
    for (let k = 0; k < 3; k++) { const leg = box(0.03, 1.5, 0.03, toon("#3a2f55"), Math.cos(k * 2.1) * 0.18, 0.72, Math.sin(k * 2.1) * 0.18); leg.rotation.set(Math.sin(k * 2.1) * 0.24, 0, -Math.cos(k * 2.1) * 0.24); st.add(leg); }
    const can = new THREE.Group(); can.position.y = 1.5; can.rotation.set(0.5, -s * 0.6, 0);
    can.add(cyl(0.14, 0.11, 0.3, toon("#2a2633"), 0, 0, 0).rotateX(Math.PI / 2));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), flat("#fff6cc")); lens.position.z = 0.16; can.add(lens);
    st.add(can); g.add(st);
  }
  const trunk = rbox(0.8, 0.45, 0.45, 0.04, toon("#7a4fd6"), -3.3, 0.225, -0.7); trunk.rotation.y = 0.35; g.add(trunk);
  g.add(box(0.82, 0.05, 0.47, toon("#ffc94a"), -3.3, 0.4, -0.7).rotateY(0.35));

  // props for the beats
  P.ped = pedestal(); g.add(P.ped);
  P.medBox = bigMedBox(); g.add(P.medBox);
  P.bp = bpMonitor(); g.add(P.bp);
  P.phoneTan = phoneProp(); g.add(P.phoneTan);
  P.phoneWei = phoneProp(); g.add(P.phoneWei);
  P.clip = clipboard(); g.add(P.clip);
  P.card = noteCard(); g.add(P.card);
  P.table = sideTable(); g.add(P.table);
  P.recDot = ball(0.03, flat("#ff3048")); g.add(P.recDot);
  P.sw = switchBox(); g.add(P.sw);
  P.taken = takenButton(); g.add(P.taken);
  P.week = weekBoard(); g.add(P.week);
  P.easel = checklistEasel(); g.add(P.easel);
  P.flash = ball(0.12, flat("#ffffff")); g.add(P.flash);
  g.userData.props = P;
  g.userData.hideProps = () => { for (const k of ["ped", "medBox", "bp", "phoneTan", "phoneWei", "clip", "card", "table", "recDot", "sw", "taken", "week", "easel", "flash"]) P[k].visible = false; };
  g.userData.hideProps();
  shadowy(g);
  back.castShadow = false; house.castShadow = false;
  return g;
}
