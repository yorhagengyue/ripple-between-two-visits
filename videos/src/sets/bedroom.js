// Mr Tan's bedroom in his HDB flat, early morning: bed with a blue blanket, nightstand with the red alarm clock, a lamp,
// his phone and pill box; a window onto the estate; a wall calendar with today circled; a framed family photo, a rug,
// a plant, a wardrobe, slippers. The room's floor centre is the origin; the back wall is at z = -2, the left wall at x = -2.6.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { box, rbox, cyl, ball, painted, planks, wall, windowView, hdbViewPainter, poster, lamp, plant, alarmClock, pillBox, group, at } from "./kit.js";
import { makePhone } from "../chars.js";

export function buildBedroom() {
  const g = new THREE.Group();
  g.add(planks(6, 5));
  const back = wall(6, 3.2, "#8d7ae6", { band: "#6f5cc8" }); back.position.set(0, 1.6, -2); g.add(back);
  const left = wall(5, 3.2, "#7a68d8", { band: "#5e4cb8" }); left.rotation.y = Math.PI / 2; left.position.set(-2.6, 1.6, 0.4); g.add(left);
  // window on the back wall with the estate outside; the sill (0.65 m) is low enough for him to rest his hands on it
  // and look out (he is 1.25 m tall)
  const win = windowView(1.3, 1.0, hdbViewPainter({ top: "#ff9a7a", mid: "#ffc08f", low: "#ffe6b0" }), { curtains: "#ff8fb0" });
  win.position.set(1.1, 1.2, -1.97); g.add(win); g.userData.window = win;
  // bed against the back-left
  const bed = new THREE.Group(); bed.position.set(-1.2, 0, -0.9);
  bed.add(rbox(1.1, 0.3, 2.0, 0.05, toon("#c77a4a"), 0, 0.15, 0)); // frame
  bed.add(rbox(1.2, 0.8, 0.12, 0.04, toon("#b06a3e"), 0, 0.4, -1.0)); // headboard
  bed.add(rbox(1.02, 0.18, 1.9, 0.07, toon("#f4efe6"), 0, 0.39, 0)); // mattress
  const pillow = rbox(0.7, 0.14, 0.34, 0.07, toon("#ffffff"), 0, 0.53, -0.72); bed.add(pillow);
  const blanket = rbox(1.08, 0.12, 1.3, 0.06, toon("#3f66d9"), 0, 0.52, 0.28); bed.add(blanket);
  const fold = box(1.09, 0.02, 0.16, toon("#5b85f0"), 0, 0.585, -0.32); bed.add(fold); // blanket fold
  // the blanket over his knees while he sits up in bed (shown by the bed shot only)
  const knees = rbox(0.62, 0.2, 0.5, 0.09, toon("#3f66d9"), 0, 0, 0); knees.visible = false; bed.add(knees);
  g.add(bed); g.userData.bed = bed; g.userData.blanket = blanket; g.userData.fold = fold; g.userData.knees = knees;
  // nightstand, clock, lamp, phone, pill box
  const ns = new THREE.Group(); ns.position.set(-0.25, 0, -1.65);
  ns.add(rbox(0.5, 0.5, 0.4, 0.03, toon("#f2e3c8"), 0, 0.25, 0));
  ns.add(box(0.4, 0.03, 0.02, toon("#3a2f55"), 0, 0.33, 0.205));
  const clock = alarmClock(); clock.position.set(-0.1, 0.5, 0.02); ns.add(clock);
  const lmp = lamp(0.5); lmp.position.set(0.14, 0.5, -0.05); ns.add(lmp);
  // his phone (the same model as in the later chapters) on a little charging stand, screen to the room, so it can be
  // seen to light up from across the room; setPhone(lit 0..1, buzz) wakes it
  const stand = group(box(0.07, 0.012, 0.07, toon("#3a2f55"), 0, 0.006, 0)); stand.position.set(0.12, 0.5, 0.12); stand.rotation.y = 0.2; ns.add(stand);
  const lip = box(0.07, 0.02, 0.012, toon("#3a2f55"), 0, 0.016, 0.03); stand.add(lip);
  const ph = makePhone(); ph.g.position.set(0, 0.062, 0.0); ph.g.rotation.x = -0.85; stand.add(ph.g);
  let phoneState = "";
  g.userData.setPhone = (lit, buzz = 0) => {
    const st = lit > 0.5 ? "on" : "off";
    // lit = a plain glow, like the other chapters' phones: the only screen content in the film is the real app recording
    if (st !== phoneState) { phoneState = st; ph.setScreen(null, lit > 0.5 ? "#e9e4ff" : "#1b1825"); }
    stand.position.x = 0.12 + buzz * 0.006; stand.rotation.z = buzz * 0.05;
  };
  const pb = pillBox(); pb.position.set(-0.12, 0.5, 0.14); pb.scale.setScalar(0.8); ns.add(pb);
  g.add(ns); g.userData.clock = clock; g.userData.phone = ph; g.userData.nightstand = ns;
  // wall calendar with today circled and "Dr Lim 10:30"
  const cal = poster(0.5, 0.62, (c, W, H) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, W, H); c.fillStyle = "#e2433f"; c.fillRect(0, 0, W, H * 0.2);
    c.fillStyle = "#fff"; c.font = "900 38px 'Segoe UI'"; c.textAlign = "center"; c.fillText("OCT", W / 2, H * 0.14);
    c.fillStyle = "#3a2f55"; c.font = "700 20px 'Segoe UI'";
    for (let d = 1; d <= 31; d++) { const k = d + 2, x = (k % 7) * (W / 7) + W / 14, y = H * 0.3 + Math.floor(k / 7) * (H * 0.13); c.fillText(String(d), x, y); }
    const k = 17, x = (k % 7) * (W / 7) + W / 14, y = H * 0.3 + Math.floor(k / 7) * (H * 0.13);
    c.strokeStyle = "#e2433f"; c.lineWidth = 5; c.beginPath(); c.ellipse(x, y - 7, 18, 16, 0, 0, 7); c.stroke();
  }, "#3a2a5a");
  cal.position.set(-0.55, 1.75, -1.98); g.add(cal);
  // family photo: a little drawing of the three of them
  const photo = poster(0.42, 0.32, (c, W, H) => {
    c.fillStyle = "#ffd98a"; c.fillRect(0, 0, W, H);
    [[0.3, "#dfe5f3"], [0.62, "#dfe5f3"]].forEach(([x, col], i) => {
      c.fillStyle = col; c.fillRect(W * x - 26, H * 0.28, 52, 44); c.fillStyle = "#1a1030"; c.fillRect(W * x - 20, H * 0.34, 40, 22);
      c.fillStyle = "#9b6bff"; c.fillRect(W * x - 14, H * 0.42, 6, 6); c.fillStyle = "#2ff0b0"; c.fillRect(W * x + 6, H * 0.43, 9, 4);
      c.fillStyle = col; c.fillRect(W * x - 20, H * 0.58, 40, 34);
      if (i === 0) { c.fillStyle = "#fff"; c.beginPath(); c.ellipse(W * x, H * 0.62, 22, 14, 0, 0, 7); c.fill(); }
    });
    c.fillStyle = "#ff6fb0"; c.font = "900 30px 'Segoe UI'"; c.fillText("♥", W * 0.43, H * 0.3);
  }, "#c77a4a");
  photo.rotation.y = Math.PI / 2; photo.position.set(-2.58, 1.55, -0.2); g.add(photo);
  // rug, plant, wardrobe, slippers, shelf with books
  const rug = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), toon("#ff8fb0")); rug.rotation.x = -Math.PI / 2; rug.position.set(0.4, 0.006, 0.5); g.add(rug);
  const rug2 = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 40), toon("#ffd0e0")); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0.4, 0.008, 0.5); g.add(rug2);
  const pl = plant(1.4); pl.position.set(2.1, 0, -1.5); g.add(pl);
  const wd = new THREE.Group(); wd.position.set(2.3, 0, 0.6); wd.rotation.y = -Math.PI / 2;
  wd.add(rbox(1.2, 2.0, 0.6, 0.03, toon("#f2e3c8"), 0, 1.0, 0));
  wd.add(box(0.02, 1.9, 0.01, toon("#3a2f55"), 0, 1.0, 0.301));
  for (const s of [-1, 1]) wd.add(box(0.04, 0.16, 0.03, toon("#c77a4a"), s * 0.08, 1.05, 0.31));
  g.add(wd);
  for (const s of [-1, 1]) g.add(rbox(0.12, 0.04, 0.26, 0.02, toon("#2f9e6a"), -0.45 + s * 0.09, 0.02, 0.25 + s * 0.02));
  const shelf = new THREE.Group(); shelf.position.set(-2.45, 0, 1.2); shelf.rotation.y = Math.PI / 2;
  shelf.add(rbox(1.0, 1.1, 0.3, 0.02, toon("#c77a4a"), 0, 0.55, 0));
  ["#e2433f", "#3f66d9", "#ffd94a", "#2f9e6a", "#ff8fb0", "#8f7dff"].forEach((c, i) => shelf.add(box(0.1, 0.32, 0.22, toon(c), -0.36 + i * 0.13, 0.82, 0.03)));
  g.add(shelf);
  // the ceiling light glow and a warm spot
  return g;
}
