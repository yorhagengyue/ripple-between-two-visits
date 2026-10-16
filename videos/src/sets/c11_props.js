// Props for c11 (the trust lab): the pill and its bottle, Mr Tan's phone, Wei Ling's clipboard, a medicine box with no
// English on it, three steps up to the pedestal, the tray "THINGS TO TELL THE DOCTOR" with its note, and the switch
// console with his six switches. Built once into one group (registered by the chapter as "c11.props"); each shot shows
// only what it needs and places held props with holdProp().
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { hash } from "../core.js";
import { box, rbox, cyl, ball, painted, shadowy } from "./kit.js";
import { clipboard } from "./lab.js";

const PI2 = Math.PI / 2;
const INK = "#1a1030", SANS = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';

function pill() {
  const g = new THREE.Group();
  const a = toon("#ff5fa8", { emissive: "#ff2f8a", emissiveIntensity: 0.15 }), b = toon("#ffffff");
  const r = 0.03, h = 0.045;
  const c1 = cyl(r, r, h, a, 0, h / 2, 0, 16), c2 = cyl(r, r, h, b, 0, -h / 2, 0, 16);
  const e1 = ball(r, a, 0, h, 0), e2 = ball(r, b, 0, -h, 0);
  const inner = new THREE.Group(); inner.add(c1, c2, e1, e2); inner.rotation.z = Math.PI / 2; g.add(inner);
  return g;
}

function pillBottle() {
  const g = new THREE.Group();
  g.add(cyl(0.085, 0.085, 0.2, toon("#ff9a2e", { emissive: "#ff7a00", emissiveIntensity: 0.12 }), 0, 0.1, 0, 24));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.1, 24, 1, true), toon("#ffffff")); label.position.y = 0.095; g.add(label);
  g.add(cyl(0.065, 0.065, 0.01, toon("#5a2a10"), 0, 0.2, 0, 20)); // the open mouth
  const cap = cyl(0.09, 0.09, 0.05, toon("#ffffff"), 0.2, 0.025, 0.04, 24); g.add(cap);
  return g;
}

function phone() {
  const g = new THREE.Group();
  g.add(rbox(0.085, 0.17, 0.014, 0.012, toon("#1b1825"), 0, 0, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.074, 0.155), new THREE.MeshBasicMaterial({ color: "#e9e3ff", toneMapped: false }));
  scr.position.z = 0.0075; g.add(scr);
  g.userData.screen = scr.material;
  return g;
}

/** A medicine box with no English on it: made-up script, a pill pictogram, coloured bands. */
function unknownBox() {
  const glyphs = (seed) => (c, W, H) => {
    c.fillStyle = "#fbf7ee"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#2fb38a"; c.fillRect(0, 0, W, H * 0.16); c.fillStyle = "#e2433f"; c.fillRect(0, H * 0.84, W, H * 0.16);
    c.strokeStyle = INK; c.lineWidth = 7; c.lineCap = "round";
    for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++) {
      const x = W * 0.08 + k * W * 0.12, y = H * (0.3 + r * 0.16), s = H * 0.05;
      const v = hash(seed * 97 + r * 13 + k);
      c.beginPath();
      if (v < 0.25) { c.arc(x, y, s, 0.3, 5.2); }
      else if (v < 0.5) { c.moveTo(x - s, y + s); c.quadraticCurveTo(x, y - s * 2, x + s, y + s); c.moveTo(x - s * 0.6, y); c.lineTo(x + s * 0.6, y); }
      else if (v < 0.75) { c.moveTo(x - s, y - s); c.lineTo(x + s * 0.2, y - s); c.quadraticCurveTo(x + s, y, x - s * 0.4, y + s); c.moveTo(x + s * 0.5, y + s * 0.4); c.arc(x + s * 0.5, y + s * 0.4, s * 0.3, 0, 6.3); }
      else { c.moveTo(x, y - s); c.lineTo(x, y + s); c.moveTo(x - s, y); c.quadraticCurveTo(x, y + s * 1.6, x + s, y - s * 0.4); }
      c.stroke();
    }
    // a pill pictogram in a circle
    c.lineWidth = 6; c.beginPath(); c.arc(W * 0.84, H * 0.5, H * 0.17, 0, 7); c.stroke();
    c.save(); c.translate(W * 0.84, H * 0.5); c.rotate(-0.6); c.fillStyle = "#ff5fa8"; c.beginPath(); c.roundRect(-H * 0.12, -H * 0.05, H * 0.24, H * 0.1, H * 0.05); c.fill(); c.stroke(); c.restore();
  };
  const tex = (seed, w, h) => painted(1, 1, w, h, glyphs(seed)).material;
  const mats = [tex(3, 256, 256), tex(4, 256, 256), toon("#2fb38a"), toon("#fbf7ee"), tex(1, 512, 320), tex(2, 512, 320)];
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.46, 0.38), mats); m.position.y = 0.23;
  const g = new THREE.Group(); g.add(m);
  return g;
}

/** Three steps up to the pedestal top (0.55 m): each 0.18 high, 0.28 deep, 0.9 wide; they climb toward +x. */
function steps() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const h = 0.18 * (i + 1);
    g.add(box(0.28, h, 0.9, toon(i % 2 ? "#cfd3ef" : "#e4e6f8"), i * 0.28 + 0.14, h / 2, 0));
    g.add(box(0.28, 0.02, 0.9, toon("#ffd94a"), i * 0.28 + 0.14, h + 0.01, 0));
  }
  return g;
}

/** The tray on the workbench with its painted label, and the note that lands in it (userData.note). */
function tray() {
  const g = new THREE.Group();
  const y = toon("#ffd94a"), d = toon("#e8b92e");
  g.add(box(0.62, 0.02, 0.42, d, 0, 0.01, 0));
  g.add(box(0.62, 0.09, 0.02, y, 0, 0.045, 0.2), box(0.62, 0.09, 0.02, y, 0, 0.045, -0.2), box(0.02, 0.09, 0.42, y, 0.3, 0.045, 0), box(0.02, 0.09, 0.42, y, -0.3, 0.045, 0));
  const label = painted(0.6, 0.12, 640, 128, (c, W, H) => {
    c.fillStyle = "#fff6e4"; c.fillRect(0, 0, W, H); c.strokeStyle = INK; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
    c.fillStyle = INK; c.font = `800 40px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("THINGS TO TELL THE DOCTOR", W / 2, H / 2 + 2);
  });
  label.position.set(0, 0.09, 0.215); label.rotation.x = -0.25; g.add(label);
  return g;
}

/** The note he keeps: date and time, and his words. Faces +z, 0.36 x 0.22 m. */
function note() {
  const g = new THREE.Group();
  const p = painted(0.36, 0.22, 512, 312, (c, W, H) => {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#7b5cff"; c.fillRect(0, 0, W, 54);
    c.fillStyle = "#ffffff"; c.font = `800 34px ${SANS}`; c.textBaseline = "middle"; c.fillText("15 Oct · 8:30 PM", 22, 28);
    c.fillStyle = INK; c.font = `700 38px ${SANS}`;
    ["My chest feels tight", "after climbing the", "stairs."].forEach((l, i) => c.fillText(l, 22, 104 + i * 52));
    c.strokeStyle = INK; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
  });
  g.add(p);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), toon("#f2eefc")); back.rotation.y = Math.PI; back.position.z = -0.002; g.add(back);
  return g;
}

/** His switch console: six toggles with lamps and labels (his own switch titles), on a slanted desk facing +z.
 *  userData.set(i, k): lever i (0..5) from off (0) to on (1); the lamp turns green past half way. */
function consoleDesk() {
  const g = new THREE.Group();
  g.add(rbox(1.5, 0.38, 0.55, 0.04, toon("#4a42a0"), 0, 0.19, 0));
  g.add(box(1.5, 0.04, 0.04, flat("#46f2ff"), 0, 0.34, 0.29));
  const top = new THREE.Group(); top.position.set(0, 0.62, 0.02); top.rotation.x = -0.75; g.add(top);
  top.add(rbox(1.56, 0.62, 0.08, 0.03, toon("#2a2266"), 0, 0, 0));
  const names = [["Medicine", "each day"], ["Blood", "pressure"], ["Questions for", "the doctor"], ["Tell her when two", "reminders get no reply"], ["My visit recordings", "and transcripts"], ["Notes I wrote", "myself"]];
  const face = painted(1.5, 0.56, 1024, 384, (c, W, H) => {
    c.fillStyle = "#1c1748"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3), x = col * (W / 3), y = row * (H / 2);
      c.strokeStyle = "rgba(70,242,255,.5)"; c.lineWidth = 3; c.strokeRect(x + 8, y + 8, W / 3 - 16, H / 2 - 16);
      c.fillStyle = "#ece4cf"; c.fillRect(x + 16, y + H / 2 - 84, W / 3 - 32, 70); // below the bloom threshold: crisp ink
      c.fillStyle = INK; c.font = `800 25px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle";
      names[i].forEach((l, j) => c.fillText(l, x + W / 6, y + H / 2 - 64 + j * 30));
    }
  }, { unlit: true });
  face.position.z = 0.042; top.add(face);
  const levers = [], lamps = [];
  const off = new THREE.MeshBasicMaterial({ color: "#ff3b5c", toneMapped: false }), on = new THREE.MeshBasicMaterial({ color: "#3fff9a", toneMapped: false });
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = -0.5 + col * 0.5, y = 0.2 - row * 0.28;
    top.add(rbox(0.1, 0.1, 0.03, 0.01, toon("#8d93c3"), x - 0.07, y + 0.0, 0.05));
    const lever = new THREE.Group(); lever.position.set(x - 0.07, y + 0.0, 0.065); top.add(lever);
    lever.add(cyl(0.014, 0.014, 0.12, toon("#e8ebf8"), 0, 0.06, 0, 10));
    lever.add(ball(0.03, toon("#ffd94a"), 0, 0.12, 0));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), off); lamp.position.set(x + 0.11, y + 0.0, 0.06); top.add(lamp);
    levers.push(lever); lamps.push(lamp);
  }
  // the lever sticks out of the panel: tilted down when off, up when on
  g.userData.set = (i, k) => { levers[i].rotation.x = PI2 + 0.55 - k * 1.1; lamps[i].material = k > 0.5 ? on : off; };
  g.userData.levers = levers; g.userData.top = top;
  for (let i = 0; i < 6; i++) g.userData.set(i, 0);
  return g;
}

export function buildC11Props() {
  const g = new THREE.Group();
  const P = {
    pill: pill(), bottle: pillBottle(), phone: phone(), clip: clipboard(), box: unknownBox(), steps: steps(), tray: tray(), note: note(), desk: consoleDesk(),
  };
  for (const k in P) g.add(P[k]);
  shadowy(g);
  g.userData = P;
  return g;
}
