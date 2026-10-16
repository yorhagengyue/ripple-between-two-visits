// c08 sets: Mr Tan's balcony at sunset, the facade around it, the sunset and night skies, and the night re-light of
// the estate. The balcony is built in its own coordinates: origin = balcony floor centre at the wall face, +z out over
// the railing, +x to his right when he sits facing out. One floor is 3.0 m. The chapter moves and scales it per shot:
// at human scale on its own facade above the estate (sunset), and at 0.3 on the hero block (the night pull-back).
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { hash } from "../core.js";
import { box, rbox, cyl, ball, painted, tiles, wall, plant, windowView } from "./kit.js";

let uid = 0;
/** a toon material of my own (never shared through the cache), safe to change per frame */
export const own = (hex, o = {}) => toon(hex, { ...o, name: `c08.m${++uid}` });

export const SEAT = { x: 0.3, z: 0.95, top: 0.47 };
export const WALL = "#8fd6c2", WALL2 = "#76c4b0", TRIM = "#ff8a3d", RAIL = "#fbf7ff";

function railing(g, w, d, col = RAIL) {
  const m = toon(col);
  g.add(rbox(w + 0.1, 0.07, 0.1, 0.03, m, 0, 1.0, d));
  g.add(box(w, 0.035, 0.035, m, 0, 0.56, d));
  g.add(box(w + 0.1, 0.1, 0.12, m, 0, 0.05, d));
  for (let i = 0; i <= 4; i++) g.add(box(0.06, 1.0, 0.06, m, -w / 2 + (i * w) / 4, 0.5, d));
  for (const s of [-1, 1]) {
    g.add(rbox(0.1, 0.07, d, 0.03, m, (s * w) / 2, 1.0, d / 2));
    g.add(box(0.035, 0.035, d, m, (s * w) / 2, 0.56, d / 2));
    g.add(box(0.06, 1.0, 0.06, m, (s * w) / 2, 0.5, d / 2));
    g.add(box(0.12, 0.1, d, m, (s * w) / 2, 0.05, d / 2));
  }
}

function interiorPainter(c, W, H) {
  c.fillStyle = "#ffcf9a"; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.72, H * 0.38, 10, W * 0.72, H * 0.38, W * 0.55);
  g.addColorStop(0, "rgba(255,246,200,.95)"); g.addColorStop(1, "rgba(255,190,120,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "#ff8fb0"; c.fillRect(0, 0, W * 0.16, H); c.fillStyle = "rgba(200,60,110,.35)"; for (let i = 0; i < 4; i++) c.fillRect(W * (0.025 + i * 0.04), 0, 5, H);
  // framed photo of the three of them, a wall clock, a cabinet with a TV, a lamp
  c.fillStyle = "#c77a4a"; c.fillRect(W * 0.3, H * 0.16, W * 0.2, H * 0.17); c.fillStyle = "#ffe08a"; c.fillRect(W * 0.315, H * 0.18, W * 0.17, H * 0.13);
  [[0.36, "#dfe5f3"], [0.44, "#dfe5f3"]].forEach(([x, col]) => { c.fillStyle = col; c.fillRect(W * x - 12, H * 0.2, 24, 22); c.fillStyle = "#1a1030"; c.fillRect(W * x - 9, H * 0.21, 18, 10); c.fillStyle = col; c.fillRect(W * x - 9, H * 0.25, 18, 18); });
  c.fillStyle = "#fffaf0"; c.beginPath(); c.arc(W * 0.66, H * 0.17, 26, 0, 7); c.fill(); c.strokeStyle = "#3a2f55"; c.lineWidth = 5; c.stroke();
  c.beginPath(); c.moveTo(W * 0.66, H * 0.17); c.lineTo(W * 0.66, H * 0.17 - 16); c.moveTo(W * 0.66, H * 0.17); c.lineTo(W * 0.66 + 12, H * 0.17 + 4); c.stroke();
  c.fillStyle = "#b8693f"; c.fillRect(W * 0.24, H * 0.66, W * 0.56, H * 0.34); c.fillStyle = "#8e4c2c"; c.fillRect(W * 0.24, H * 0.66, W * 0.56, 8);
  c.fillStyle = "#22203a"; c.fillRect(W * 0.34, H * 0.44, W * 0.3, H * 0.21); c.fillStyle = "#4a6fd8"; c.fillRect(W * 0.35, H * 0.455, W * 0.28, H * 0.18);
  c.fillStyle = "#ffe9a8"; c.beginPath(); c.moveTo(W * 0.86, H * 0.5); c.lineTo(W * 0.94, H * 0.5); c.lineTo(W * 0.97, H * 0.62); c.lineTo(W * 0.83, H * 0.62); c.closePath(); c.fill();
  c.fillStyle = "#3a2f55"; c.fillRect(W * 0.895, H * 0.62, 6, H * 0.3);
  for (let i = 0; i < 5; i++) { c.fillStyle = ["#e2433f", "#3f66d9", "#ffd94a", "#2f9e6a", "#8f7dff"][i]; c.fillRect(W * (0.62 + i * 0.03), H * 0.7, W * 0.022, H * 0.12); }
}
function kitchenPainter(c, W, H) {
  c.fillStyle = "#ffe0a8"; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.5, H * 0.15, 5, W * 0.5, H * 0.15, W * 0.6); g.addColorStop(0, "rgba(255,250,215,1)"); g.addColorStop(1, "rgba(255,200,130,0)");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "#5fc7b0"; c.fillRect(0, 0, W, H * 0.28); c.fillStyle = "#3f9e8c"; for (let i = 1; i < 4; i++) c.fillRect((W * i) / 4 - 2, 0, 4, H * 0.28);
  c.fillStyle = "#3a2f55"; c.fillRect(W * 0.49, H * 0.28, 4, H * 0.12); c.fillStyle = "#ffcf5a"; c.beginPath(); c.arc(W * 0.5, H * 0.43, 22, Math.PI, 0); c.fill();
  c.fillStyle = "#f2c79a"; c.fillRect(0, H * 0.68, W, H * 0.32); c.fillStyle = "#c98e62"; c.fillRect(0, H * 0.68, W, 8);
  c.fillStyle = "#e2433f"; c.fillRect(W * 0.18, H * 0.6, W * 0.12, H * 0.08); c.fillStyle = "#ffd94a"; c.beginPath(); c.arc(W * 0.7, H * 0.63, 18, 0, 7); c.fill();
}

/** the balcony: floor, ceiling slab with an orange fascia, wall with a sliding door into his lit living room and a
 *  kitchen window, railing, string lights, chair, side table with teapot and kueh, his cup, a bird cage, an aircon
 *  unit, bougainvillea, plants, a flower box on the rail, and HDB laundry poles with clothes */
export function buildBalcony() {
  const g = new THREE.Group();
  const U = (g.userData = {});
  const slab = toon("#f3ecff");
  g.add(box(5.5, 0.24, 2.0, slab, 0, -0.12, 0.98));
  g.add(box(5.56, 0.2, 0.06, toon("#ffe9d6"), 0, -0.12, 2.0));
  const fl = tiles(5.4, 1.95, "#f0a07c", "#ffe2c6", 0.7); fl.position.set(0, 0.006, 0.97); g.add(fl);
  // ceiling = the floor above, with its orange fascia; a ceiling lamp
  g.add(box(5.5, 0.24, 2.0, slab, 0, 2.88, 0.98));
  g.add(box(5.56, 0.32, 0.07, toon(TRIM), 0, 2.86, 2.0));
  for (const s of [-1, 1]) g.add(box(0.07, 0.32, 2.0, toon(TRIM), s * 2.78, 2.86, 0.98));
  // the wall: three pieces around the door and the glass pane
  const wl = wall(0.55, 3.0, WALL); wl.position.set(-2.475, 1.5, 0); g.add(wl);
  const wr = wall(2.6, 3.0, WALL); wr.position.set(1.45, 1.5, 0); g.add(wr);
  const lt = wall(2.2, 0.75, WALL); lt.position.set(-1.05, 2.625, 0); g.add(lt);
  // the room behind the door (lit from inside)
  const room = new THREE.Group(); g.add(room);
  const back = painted(2.8, 2.6, 512, 476, interiorPainter, { unlit: true }); back.position.set(-1.0, 1.3, -1.6); room.add(back);
  U.roomMat = back.material;
  const rf = tiles(2.8, 1.6, "#d9925a", "#c27c49", 0.8); rf.position.set(-1.0, 0.003, -0.8); room.add(rf);
  for (const x of [-2.4, 0.4]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), flat("#ffbf86")); s.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; s.position.set(x, 1.3, -0.8); room.add(s); }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.6), flat("#ffd9a8")); ceil.rotation.x = Math.PI / 2; ceil.position.set(-1.0, 2.25, -0.8); room.add(ceil);
  // sliding door: the frame, the closed glass pane on the left, the open half on the right
  const fr = toon("#ffffff");
  g.add(box(2.3, 0.08, 0.1, fr, -1.0, 2.25, 0.02), box(2.3, 0.05, 0.12, fr, -1.0, 0.02, 0.02));
  g.add(box(0.07, 2.25, 0.1, fr, -2.15, 1.12, 0.02), box(0.07, 2.25, 0.1, fr, 0.15, 1.12, 0.02));
  g.add(box(0.06, 2.2, 0.08, fr, -1.0, 1.12, 0.05), box(0.06, 2.2, 0.08, fr, -0.92, 1.12, -0.02));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.15), new THREE.MeshBasicMaterial({ color: "#bfe8ff", transparent: true, opacity: 0.22, toneMapped: false }));
  glass.position.set(-1.57, 1.12, 0.03); g.add(glass);
  const streak = painted(1.1, 2.15, 128, 256, (c, W, H) => { c.clearRect(0, 0, W, H); c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 10; c.beginPath(); c.moveTo(W * 0.2, H * 0.55); c.lineTo(W * 0.6, H * 0.25); c.moveTo(W * 0.35, H * 0.62); c.lineTo(W * 0.65, H * 0.4); c.stroke(); }, { unlit: true, transparent: true });
  streak.position.set(-1.57, 1.12, 0.035); g.add(streak);
  // pink curtain bunched at the open side, inside
  g.add(rbox(0.22, 2.1, 0.12, 0.05, toon("#ff7fa8"), 0.0, 1.1, -0.12));
  // kitchen window on the right
  const kw = windowView(1.2, 1.0, kitchenPainter, { curtains: "#ffb347" }); kw.position.set(1.25, 1.62, 0.04); g.add(kw);
  kw.children[0].material.color.set("#e9cdb8"); // a touch dimmer than the living room, so it does not blow out
  // aircon unit in the corner with a fan that turns
  const ac = new THREE.Group(); ac.position.set(2.2, 0, 0.3); g.add(ac);
  ac.add(rbox(0.85, 0.6, 0.36, 0.03, toon("#e4e6f2"), 0, 0.3, 0));
  ac.add(cyl(0.24, 0.24, 0.02, toon("#3a3550"), 0.12, 0.32, 0.18, 24).rotateX(Math.PI / 2));
  const fan = painted(0.42, 0.42, 128, 128, (c, W, H) => { c.clearRect(0, 0, W, H); c.fillStyle = "#c9cee0"; for (let i = 0; i < 4; i++) { c.save(); c.translate(W / 2, H / 2); c.rotate((i * Math.PI) / 2); c.beginPath(); c.ellipse(0, -H * 0.22, W * 0.1, H * 0.2, 0.4, 0, 7); c.fill(); c.restore(); } c.fillStyle = "#8d93a3"; c.beginPath(); c.arc(W / 2, H / 2, 10, 0, 7); c.fill(); }, { transparent: true });
  fan.position.set(0.12, 0.32, 0.195); ac.add(fan); U.fan = fan;
  for (let i = 0; i < 7; i++) ac.add(box(0.46, 0.012, 0.012, toon("#5b5670"), 0.12, 0.12 + i * 0.065, 0.205));
  // railing
  railing(g, 5.3, 1.9);
  // flower box hung on the front rail, outside
  g.add(box(1.3, 0.24, 0.26, toon("#ff8a3d"), -1.45, 0.86, 2.06));
  [["#e2433f", -1.95], ["#ff6fb0", -1.68], ["#ffb347", -1.42], ["#e2433f", -1.16], ["#ff6fb0", -0.92]].forEach(([col, x], i) => {
    g.add(ball(0.11, toon("#3fae6b"), x + 0.06, 1.02, 2.0 + (i % 2) * 0.08));
    g.add(ball(0.1 + hash(i) * 0.02, toon(col), x, 1.1, 2.08));
  });
  // bougainvillea in a big pot, right front corner, spilling over the rail
  const bg = new THREE.Group(); bg.position.set(2.15, 0, 1.45); g.add(bg); U.bougain = bg;
  bg.add(cyl(0.26, 0.2, 0.45, toon("#d9653f"), 0, 0.225, 0), cyl(0.28, 0.28, 0.06, toon("#e9774f"), 0, 0.45, 0));
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4, r = 0.12 + hash(i * 3) * 0.3, y = 0.6 + hash(i * 5) * 0.75;
    bg.add(ball(0.13 + hash(i) * 0.06, toon(i % 3 ? "#ff3fa0" : "#2f9e6a"), Math.cos(a) * r + (y > 1.0 ? 0.25 : 0), y, Math.sin(a) * r));
  }
  for (let i = 0; i < 5; i++) bg.add(ball(0.09, toon("#ff5fb8"), 0.5 + hash(i) * 0.1, 0.95 - i * 0.12, -0.3 + i * 0.18));
  // plants on the left
  const p1 = plant(2.4, "#3fae6b"); p1.position.set(-2.2, 0, 1.45); g.add(p1);
  const p2 = plant(1.3, "#2f9e6a"); p2.position.set(-1.65, 0, 1.62); g.add(p2);
  U.bigPlant = p1; // (8b's side-on view sees it right behind his cup: that shot moves it back against the wall)
  // chair, facing out
  const ch = new THREE.Group(); ch.position.set(SEAT.x, 0, SEAT.z); g.add(ch);
  const wood = toon("#c77a4a"), wood2 = toon("#e39a5e");
  ch.add(rbox(0.54, 0.06, 0.48, 0.02, wood2, 0, SEAT.top - 0.03, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ch.add(box(0.05, SEAT.top - 0.06, 0.05, wood, sx * 0.22, (SEAT.top - 0.06) / 2, sz * 0.19));
  for (const sx of [-1, 1]) ch.add(box(0.05, 0.5, 0.05, wood, sx * 0.22, SEAT.top + 0.22, -0.21));
  ch.add(rbox(0.5, 0.16, 0.04, 0.02, wood2, 0, SEAT.top + 0.36, -0.21));
  // side table: teapot, a plate of kueh, the newspaper
  const tb = new THREE.Group(); tb.position.set(1.12, 0, 1.18); g.add(tb);
  tb.add(cyl(0.32, 0.32, 0.045, toon("#3fc1b0"), 0, 0.56, 0, 32), cyl(0.035, 0.035, 0.54, toon("#ffffff"), 0, 0.28, 0, 10), cyl(0.2, 0.22, 0.03, toon("#ffffff"), 0, 0.015, 0, 24));
  const pot = new THREE.Group(); pot.position.set(0.1, 0.585, -0.1); tb.add(pot);
  const potB = ball(0.1, toon("#fff6e8"), 0, 0.08, 0); potB.scale.set(1, 0.85, 1); pot.add(potB);
  pot.add(cyl(0.101, 0.101, 0.03, toon("#3f66d9"), 0, 0.08, 0, 20), cyl(0.04, 0.05, 0.03, toon("#fff6e8"), 0, 0.16, 0, 14), ball(0.018, toon("#3f66d9"), 0, 0.185, 0));
  const spout = cyl(0.015, 0.025, 0.12, toon("#fff6e8"), -0.12, 0.1, 0, 8); spout.rotation.z = 0.9; pot.add(spout);
  const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), toon("#fff6e8")); hdl.position.set(0.1, 0.09, 0); pot.add(hdl);
  tb.add(cyl(0.11, 0.1, 0.015, toon("#ffffff"), -0.12, 0.59, 0.1, 20));
  tb.add(rbox(0.07, 0.04, 0.05, 0.01, toon("#3fbf5a"), -0.15, 0.615, 0.09), rbox(0.07, 0.04, 0.05, 0.01, toon("#ff8fb0"), -0.08, 0.615, 0.12));
  tb.add(box(0.2, 0.012, 0.28, toon("#f4f1e8"), 0.12, 0.59, 0.14).rotateY(0.3));
  // his cup (the chapter places it in his hand or on the table)
  const cup = new THREE.Group(); g.add(cup); U.cup = cup;
  cup.add(cyl(0.055, 0.042, 0.09, toon("#ffffff"), 0, 0.045, 0, 18), cyl(0.0565, 0.0565, 0.02, toon("#3f66d9"), 0, 0.07, 0, 18), cyl(0.05, 0.05, 0.004, toon("#a0582a"), 0, 0.083, 0, 18));
  const ch2 = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 6, 12), toon("#ffffff")); ch2.position.set(0.06, 0.05, 0); cup.add(ch2);
  // bird cage hanging from the ceiling, with a little yellow bird
  const cage = new THREE.Group(); cage.position.set(-1.25, 1.86, 1.35); g.add(cage); U.cage = cage;
  const bam = toon("#d9a45a");
  cage.add(cyl(0.18, 0.18, 0.04, bam, 0, 0, 0, 20), cyl(0.008, 0.008, 0.62, toon("#3a2f55"), 0, 0.6, 0, 6));
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; cage.add(cyl(0.006, 0.006, 0.34, bam, Math.cos(a) * 0.165, 0.18, Math.sin(a) * 0.165, 5)); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 6, 24), bam); ring.rotation.x = Math.PI / 2; ring.position.y = 0.35; cage.add(ring);
  const dome = new THREE.Mesh(new THREE.ConeGeometry(0.175, 0.13, 20, 1, true), toon("#b9733a")); dome.position.y = 0.415; cage.add(dome);
  cage.add(cyl(0.005, 0.005, 0.3, bam, 0, 0.1, 0, 5).rotateZ(Math.PI / 2));
  const bird = new THREE.Group(); bird.position.set(0, 0.1, 0); cage.add(bird); U.bird = bird;
  const bb = ball(0.05, toon("#ffd94a"), 0, 0.05, 0); bb.scale.set(0.9, 0.9, 1.2); bird.add(bb);
  bird.add(ball(0.035, toon("#ffd94a"), 0, 0.105, 0.03), ball(0.008, flat("#1a1030"), 0.025, 0.115, 0.05), ball(0.008, flat("#1a1030"), -0.025, 0.115, 0.05));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.035, 6), toon("#ff8a3d")); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.1, 0.07); bird.add(beak);
  bird.add(box(0.04, 0.012, 0.07, toon("#ffb347"), 0, 0.04, -0.07));
  // string lights along the ceiling's front edge: a sagging wire and warm bulbs
  const bulbMat = own("#fff2c0", { emissive: "#ffc65a", emissiveIntensity: 1.5 }); U.bulbMat = bulbMat;
  const pts = []; for (let i = 0; i <= 90; i++) { const u = i / 90, s3 = (u * 3) % 1; pts.push(new THREE.Vector3(-2.65 + u * 5.3, 2.7 - Math.sin(s3 * Math.PI) * 0.2, 1.9)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.008, 5), toon("#2a2633")));
  for (let i = 0; i < 18; i++) { const p = curve.getPointAt((i + 0.5) / 18); g.add(cyl(0.018, 0.018, 0.04, toon("#2a2633"), p.x, p.y - 0.01, p.z, 6), ball(0.052, bulbMat, p.x, p.y - 0.07, p.z)); }
  // HDB laundry poles sticking out of the wall to the left, with his clothes
  const pole = toon("#d8b26a"), U2 = (U.laundry = []);
  const batik = canvasTex(128, 128, (c, W, H) => { c.fillStyle = "#2f6fd8"; c.fillRect(0, 0, W, H); for (let i = 0; i < 18; i++) { c.fillStyle = i % 2 ? "#ffd94a" : "#ff6fb0"; c.beginPath(); c.arc((i % 4) * 36 + 16, Math.floor(i / 4) * 30 + 14, 9, 0, 7); c.fill(); } c.strokeStyle = "#ffffff"; c.lineWidth = 3; for (let y = 6; y < H; y += 30) { c.beginPath(); for (let x = 0; x <= W; x += 8) c.lineTo(x, y + Math.sin(x / 9) * 4); c.stroke(); } });
  const clothes = [
    [-3.2, 0.6, "singlet", toon("#f7f7ff")], [-3.2, 1.35, "shirt", toon("#e2433f")],
    [-3.65, 0.5, "towel", toon("#ffd94a")], [-3.65, 1.3, "sarong", toon("#ffffff", { map: batik })],
    [-4.1, 0.75, "shirt", toon("#39d3ff")], [-4.1, 1.5, "pants", toon("#ff8fb0")],
  ];
  for (const x of [-3.2, -3.65, -4.1]) {
    const pl = cyl(0.026, 0.026, 2.1, pole, x, 2.28, 1.02, 8); pl.rotation.x = Math.PI / 2; g.add(pl);
    g.add(box(0.08, 0.1, 0.08, toon("#8d93a3"), x, 2.28, 0.04));
  }
  clothes.forEach(([x, z, kind, mat], i) => {
    const piv = new THREE.Group(); piv.position.set(x, 2.25, z); g.add(piv); U2.push(piv);
    const T = 0.02;
    if (kind === "shirt") { piv.add(box(T, 0.5, 0.42, mat, 0, -0.27, 0)); for (const s of [-1, 1]) piv.add(box(T, 0.16, 0.16, mat, 0, -0.1, s * 0.28)); }
    if (kind === "singlet") { piv.add(box(T, 0.46, 0.38, mat, 0, -0.3, 0)); for (const s of [-1, 1]) piv.add(box(T, 0.1, 0.07, mat, 0, -0.04, s * 0.13)); }
    if (kind === "towel") piv.add(box(T, 0.62, 0.5, mat, 0, -0.31, 0), box(T + 0.004, 0.05, 0.5, toon("#ff6fb0"), 0, -0.52, 0));
    if (kind === "sarong") piv.add(box(T, 0.8, 0.6, mat, 0, -0.4, 0));
    if (kind === "pants") for (const s of [-1, 1]) piv.add(box(T, 0.55, 0.16, mat, 0, -0.3, s * 0.1));
    for (const s of [-1, 1]) piv.add(box(0.03, 0.06, 0.02, toon(["#e2433f", "#3f66d9", "#2f9e6a"][i % 3]), 0, 0.0, s * 0.15));
  });
  // the facade around the balcony (only at the sunset location; the hero block is the facade at night)
  const fac = buildFacade(); g.add(fac); U.facade = fac;
  return g;
}

/** the block's facade around the balcony: a painted wall with windows and floor bands, with the same-shaped
 *  balconies of the floors above and below */
function buildFacade() {
  const g = new THREE.Group();
  const X0 = -16, X1 = 16, Y0 = -9.24, Y1 = 12;
  const winLit = (i) => hash(i * 7.3) > 0.62;
  const paint = (x0, x1, y0, y1) => (c, W, H) => {
    const px = (x) => ((x - x0) / (x1 - x0)) * W, py = (y) => ((y1 - y) / (y1 - y0)) * H;
    c.fillStyle = WALL; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(255,255,255,${0.04 + hash(i) * 0.06})`; c.fillRect(hash(i * 3) * W, hash(i * 7) * H, 3, 3); }
    for (let f = -4; f <= 4; f++) {
      const y = f * 3;
      c.fillStyle = "#f3ecff"; c.fillRect(0, py(y + 0.0), W, py(y - 0.3) - py(y));
      c.fillStyle = "rgba(40,60,90,.25)"; c.fillRect(0, py(y - 0.3), W, 4);
      for (let k = -6; k <= 6; k++) {
        const xc = k * 2.5 + (k > 0 ? 1.4 : k < 0 ? -1.4 : 0); if (Math.abs(xc) < 3.3) continue;
        const lit = winLit(f * 13 + k);
        c.fillStyle = "#f6f2ff"; c.fillRect(px(xc - 0.75), py(y + 2.25), px(xc + 0.75) - px(xc - 0.75), py(y + 0.85) - py(y + 2.25));
        c.fillStyle = lit ? "#ffd27a" : "#4f7f98"; c.fillRect(px(xc - 0.68), py(y + 2.18), px(xc + 0.68) - px(xc - 0.68), py(y + 0.92) - py(y + 2.18));
        if (lit) { c.fillStyle = "#ff8fb0"; c.fillRect(px(xc - 0.68), py(y + 2.18), (px(xc + 0.68) - px(xc - 0.68)) * 0.2, py(y + 0.92) - py(y + 2.18)); }
        c.fillStyle = "#f6f2ff"; c.fillRect(px(xc - 0.03), py(y + 2.18), 3, py(y + 0.92) - py(y + 2.18));
        if (hash(f * 5 + k * 3) > 0.7) { c.fillStyle = "#e4e6f2"; c.fillRect(px(xc + 0.85), py(y + 0.75), px(xc + 1.45) - px(xc + 0.85), py(y + 0.3) - py(y + 0.75)); }
      }
    }
    for (const x of [-3.0, 3.0, -8.8, 8.8, -14.6, 14.6]) { c.fillStyle = WALL2; c.fillRect(px(x - 0.2), 0, px(x + 0.2) - px(x - 0.2), H); }
  };
  const piece = (x0, x1, y0, y1) => {
    const ppm = 30, pw = Math.min(1024, Math.round((x1 - x0) * ppm)), ph = Math.min(1024, Math.round((y1 - y0) * ppm));
    const m = painted(x1 - x0, y1 - y0, pw, ph, paint(x0, x1, y0, y1)); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.01); m.receiveShadow = true; g.add(m);
  };
  piece(X0, -2.75, Y0, Y1); piece(2.75, X1, Y0, Y1); piece(-2.75, 2.75, 6, Y1); piece(-2.75, 2.75, Y0, -3);
  // the neighbours above and below: slab, railing, a wall with a closed door, plants or laundry
  for (const [fy, lit] of [[3, false], [-3, true]]) {
    const s = new THREE.Group(); s.position.y = fy; g.add(s);
    if (fy < 0) { s.add(box(5.5, 0.24, 2.0, toon("#f3ecff"), 0, -0.12, 0.98)); s.add(box(5.6, 0.36, 0.07, toon(TRIM), 0, 2.86, 2.04)); }
    const w = painted(5.5, 3.0, 512, 280, (c, W, H) => {
      c.fillStyle = WALL; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ffffff"; c.fillRect(W * 0.12, H * 0.25, W * 0.42, H * 0.75); c.fillStyle = lit ? "#ffcf8a" : "#5d8fa8"; c.fillRect(W * 0.135, H * 0.27, W * 0.39, H * 0.73);
      c.fillStyle = lit ? "#ff9fc0" : "#7fb0c8"; c.fillRect(W * 0.135, H * 0.27, W * 0.12, H * 0.73); c.fillStyle = "#ffffff"; c.fillRect(W * 0.33, H * 0.27, 5, H * 0.73);
      c.fillStyle = "#ffffff"; c.fillRect(W * 0.64, H * 0.3, W * 0.24, H * 0.36); c.fillStyle = lit ? "#ffe0a0" : "#5d8fa8"; c.fillRect(W * 0.65, H * 0.32, W * 0.22, H * 0.32);
    });
    w.position.set(0, 1.5, -0.005); s.add(w);
    railing(s, 5.3, 1.9);
    if (fy > 0) { const pp = plant(1.6, "#2f9e6a"); pp.position.set(1.8, 0, 1.4); s.add(pp); for (let i = 0; i < 4; i++) s.add(box(0.02, 0.5, 0.4, toon(["#ffd94a", "#5cc7ff", "#ffffff", "#ff8fb0"][i]), -3.3 - i * 0.4, 1.95, 1.0)); }
    else { const pp = plant(2.0, "#3fae6b"); pp.position.set(-1.9, 0, 1.45); s.add(pp); s.add(box(1.2, 0.24, 0.26, toon("#3f66d9"), 1.4, 0.86, 2.06)); for (let i = 0; i < 4; i++) s.add(ball(0.1, toon(i % 2 ? "#ffd94a" : "#ff6fb0"), 1.0 + i * 0.27, 1.08, 2.06)); }
    for (const x of [-3.2, -3.65, -4.1]) { const pl = cyl(0.026, 0.026, 2.1, toon("#d8b26a"), x, 2.28, 1.02, 8); pl.rotation.x = Math.PI / 2; s.add(pl); }
  }
  return g;
}

/** the sunset sky: violet to magenta to gold, pink ribbon clouds with dotted bellies, a big low sun with a glow,
 *  and the far city (towers, a ship-topped hotel, a big wheel) as a hazy violet silhouette on the horizon */
export function sunsetSkyPainter(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#4b2f9a"); g.addColorStop(0.25, "#b0459e"); g.addColorStop(0.45, "#ff6f7d"); g.addColorStop(0.6, "#ff9a4a"); g.addColorStop(0.72, "#ffc96b"); g.addColorStop(1, "#ffe4a6");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const sx = W * 0.47, sy = H * 0.6;
  const glow = c.createRadialGradient(sx, sy, 10, sx, sy, W * 0.32); glow.addColorStop(0, "rgba(255,250,210,.95)"); glow.addColorStop(0.25, "rgba(255,220,140,.45)"); glow.addColorStop(1, "rgba(255,170,90,0)");
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  // sun rays
  c.save(); c.translate(sx, sy); c.fillStyle = "rgba(255,240,190,.12)";
  for (let i = 0; i < 14; i++) { c.rotate(Math.PI / 7); c.beginPath(); c.moveTo(0, 0); c.lineTo(W, -W * 0.06); c.lineTo(W, W * 0.06); c.closePath(); c.fill(); }
  c.restore();
  c.fillStyle = "#fff6d2"; c.beginPath(); c.arc(sx, sy, H * 0.075, 0, 7); c.fill();
  // ribbon clouds
  const ribbon = (y, amp, col, thick, ph) => {
    c.strokeStyle = col; c.lineCap = "round"; c.lineWidth = thick;
    c.beginPath(); for (let x = -20; x <= W + 20; x += 12) c.lineTo(x, y + Math.sin(x / 90 + ph) * amp); c.stroke();
    c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 3; c.beginPath(); for (let x = -20; x <= W + 20; x += 12) c.lineTo(x, y - thick * 0.35 + Math.sin(x / 90 + ph) * amp); c.stroke();
    c.fillStyle = col; for (let x = 10; x < W; x += 22) c.beginPath(), c.arc(x, y + thick * 0.9 + Math.sin(x / 90 + ph) * amp, 4, 0, 7), c.fill();
  };
  ribbon(H * 0.12, 10, "#ff5fa8", 26, 0.3); ribbon(H * 0.22, 8, "#ff6f91", 20, 1.9); ribbon(H * 0.34, 6, "#ff7f8a", 12, 3.1);
  // far city silhouette on the horizon (hazy violet)
  const hy = H * 0.72;
  c.fillStyle = "rgba(122,78,176,.75)";
  for (let i = 0; i < 40; i++) { const x = hash(i * 3.1) * W, w = 14 + hash(i * 5.7) * 30, h = 12 + hash(i * 9.3) * 50; c.fillRect(x, hy - h, w, h + 4); }
  // a hotel of three towers with a ship on top, and a big wheel
  const hx = W * 0.7; c.fillStyle = "rgba(108,64,160,.85)";
  for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(hx + k * 30, hy); c.lineTo(hx + k * 30 + 4, hy - 92); c.lineTo(hx + k * 30 + 20, hy - 92); c.lineTo(hx + k * 30 + 18, hy); c.closePath(); c.fill(); }
  c.beginPath(); c.moveTo(hx - 14, hy - 100); c.lineTo(hx + 96, hy - 104); c.lineTo(hx + 90, hy - 94); c.lineTo(hx - 8, hy - 92); c.closePath(); c.fill();
  const wx = W * 0.27, wy = hy - 48; c.strokeStyle = "rgba(108,64,160,.85)"; c.lineWidth = 3; c.beginPath(); c.arc(wx, wy, 44, 0, 7); c.stroke();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + Math.cos(a) * 44, wy + Math.sin(a) * 44); c.stroke(); }
  c.beginPath(); c.moveTo(wx - 22, hy); c.lineTo(wx, wy); c.lineTo(wx + 22, hy); c.stroke();
  // haze and the near-horizon band
  const hz = c.createLinearGradient(0, hy - 10, 0, H); hz.addColorStop(0, "rgba(160,96,190,.55)"); hz.addColorStop(1, "rgba(110,70,170,1)");
  c.fillStyle = hz; c.fillRect(0, hy, W, H - hy);
  // birds
  c.strokeStyle = "#3a2060"; c.lineWidth = 3;
  [[0.2, 0.3], [0.24, 0.27], [0.8, 0.4]].forEach(([x, y]) => { c.beginPath(); c.moveTo(W * x - 9, H * y - 4); c.lineTo(W * x, H * y + 2); c.lineTo(W * x + 9, H * y - 4); c.stroke(); });
}

/** the night sky: indigo to purple, stars, a crescent moon, dark ribbon clouds with dotted bellies */
export function nightSkyPainter(c, W, H) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#120a36"); g.addColorStop(0.45, "#2b1a6e"); g.addColorStop(0.75, "#5b2f92"); g.addColorStop(1, "#a0479a");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) { const y = hash(i * 7) * H * 0.7; c.fillStyle = `rgba(255,248,220,${0.35 + hash(i * 3) * 0.6})`; const r = hash(i * 11) > 0.92 ? 2.4 : 1.2; c.beginPath(); c.arc(hash(i * 5) * W, y, r, 0, 7); c.fill(); }
  // moon: draw on its own canvas and cut the crescent out
  const m = document.createElement("canvas"); m.width = m.height = 160; const mc = m.getContext("2d");
  const mg = mc.createRadialGradient(80, 80, 20, 80, 80, 80); mg.addColorStop(0, "rgba(255,240,200,.5)"); mg.addColorStop(1, "rgba(255,240,200,0)"); mc.fillStyle = mg; mc.fillRect(0, 0, 160, 160);
  mc.fillStyle = "#fff4d6"; mc.beginPath(); mc.arc(80, 80, 34, 0, 7); mc.fill();
  mc.globalCompositeOperation = "destination-out"; mc.beginPath(); mc.arc(96, 70, 30, 0, 7); mc.fill();
  c.drawImage(m, W * 0.7 - 80, H * 0.2 - 80);
  const ribbon = (y, amp, col, thick, ph) => {
    c.strokeStyle = col; c.lineCap = "round"; c.lineWidth = thick;
    c.beginPath(); for (let x = -20; x <= W + 20; x += 12) c.lineTo(x, y + Math.sin(x / 110 + ph) * amp); c.stroke();
    c.fillStyle = col; for (let x = 10; x < W; x += 22) c.beginPath(), c.arc(x, y + thick * 0.95 + Math.sin(x / 110 + ph) * amp, 4, 0, 7), c.fill();
  };
  ribbon(H * 0.1, 10, "#4a2a86", 24, 0.5); ribbon(H * 0.2, 8, "#5a3296", 16, 2.2);
}

/** the hero block's front (city.js blockTexture(3, "#a99af2", 11, 8, 0.08) repainted at 2048 px, same layout) */
function heroFront(floors, cols, seed = 3, base = "#a99af2", litK = 0.08) {
  const W0 = 2048;
  return canvasTex(W0, Math.round(W0 * floors / cols * 0.9), (c, W, H) => {
    const sc = W / 512;
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    const fh = H / floors, cw = W / cols;
    for (let f = 0; f < floors; f++) {
      c.fillStyle = "rgba(255,255,255,.32)"; c.fillRect(0, f * fh + fh * 0.8, W, fh * 0.14); c.fillStyle = "rgba(40,20,90,.22)"; c.fillRect(0, f * fh + fh * 0.94, W, fh * 0.06);
      for (let k = 0; k < cols; k++) {
        const lit = hash(seed * 997 + f * 31 + k) < litK;
        c.fillStyle = lit ? (hash(f + k + seed) > 0.5 ? "#ffe07a" : "#ffb8d0") : "rgba(60,40,130,.32)";
        c.fillRect(k * cw + cw * 0.2, f * fh + fh * 0.22, cw * 0.6, fh * 0.5);
      }
    }
    c.fillStyle = "rgba(40,20,90,.25)"; for (let k = 1; k < cols; k += 3) c.fillRect(k * cw - 2 * sc, 0, 4 * sc, H);
  });
}

/** Re-light an instance of buildCity() for the evening: hides its dawn sky and sun for good, and gives every block a
 *  window-only glow map (warm, pink and a few TV-blue windows). Returns setNight(k) for the glow strength. */
export function nightCity(city) {
  city.children.forEach((o) => { if (o.isMesh && (o.geometry.type === "CircleGeometry" || o.geometry.parameters?.width === 140)) o.visible = false; });
  const fronts = [], seeds = [3]; for (let s = 10; s < 60; s++) seeds.push(s);
  let i = 0;
  city.traverse((o) => {
    if (!(o.isMesh && Array.isArray(o.material) && o.material.length === 6)) return;
    const hero = i === 0, floors = Math.round(o.geometry.parameters.height / 0.9), cols = hero ? 8 : 7, seed = seeds[i++];
    // the hero block fills the frame at the start of the night pull-back: its window maps are painted at 2048 px
    // (the city's own 512 px front and a 256 px glow map go soft when a window is 300 px on screen)
    const EW = hero ? 2048 : 256;
    const em = canvasTex(EW, Math.max(64, Math.round((EW * floors) / cols * 0.9)), (c, W, H) => {
      c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
      const fh = H / floors, cw = W / cols;
      for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
        if (hash(seed * 997 + f * 31 + k) > 0.5) continue;
        const r = hash(f + k + seed);
        c.fillStyle = r > 0.62 ? "#ffd36b" : r > 0.3 ? "#ff9ec4" : r > 0.12 ? "#ffeab8" : "#7fe3ff";
        c.fillRect(k * cw + cw * 0.2, f * fh + fh * 0.22, cw * 0.6, fh * 0.5);
      }
    });
    const old = o.material[4];
    const map = hero ? heroFront(floors, cols) : old.map;
    const m = new THREE.MeshToonMaterial({ color: old.color.clone(), map, gradientMap: old.gradientMap, emissive: new THREE.Color("#ffffff"), emissiveMap: em, emissiveIntensity: 0 });
    o.material = o.material.slice(); o.material[4] = m; fronts.push(m);
  });
  return (k) => fronts.forEach((m) => (m.emissiveIntensity = k));
}
