// The estate at dawn: rows of HDB slab blocks with lit windows, void decks, trees, a road, and a painted sky with pink
// ribbon clouds. The hero block (Mr Tan's) stands at the origin; his window is at HERO_WINDOW.
import * as THREE from "three";
import { toon, flat } from "../look.js";
import { canvasTex } from "../chars.js";
import { hash } from "../core.js";
import { box, cyl, ball, painted, skyPainter } from "./kit.js";

export const HERO_WINDOW = new THREE.Vector3(1.125, 8.88, 0.806); // floor 3 from the top, column 6 of 8

function blockTexture(seed, base, floors, cols, litK = 0.22) {
  return canvasTex(512, Math.round(512 * floors / cols * 0.9), (c, W, H) => {
    c.fillStyle = base; c.fillRect(0, 0, W, H);
    const fh = H / floors, cw = W / cols;
    for (let f = 0; f < floors; f++) {
      c.fillStyle = "rgba(255,255,255,.32)"; c.fillRect(0, f * fh + fh * 0.8, W, fh * 0.14); c.fillStyle = "rgba(40,20,90,.22)"; c.fillRect(0, f * fh + fh * 0.94, W, fh * 0.06); // corridor parapet and its shadow
      for (let k = 0; k < cols; k++) {
        const lit = hash(seed * 997 + f * 31 + k) < litK;
        c.fillStyle = lit ? (hash(f + k + seed) > 0.5 ? "#ffe07a" : "#ffb8d0") : "rgba(60,40,130,.32)";
        c.fillRect(k * cw + cw * 0.2, f * fh + fh * 0.22, cw * 0.6, fh * 0.5);
      }
    }
    c.fillStyle = "rgba(40,20,90,.25)"; for (let k = 1; k < cols; k += 3) c.fillRect(k * cw - 2, 0, 4, H);
  });
}

export function buildCity() {
  const g = new THREE.Group();
  // sky: a big painted backdrop far behind
  const sky = painted(140, 60, 1024, 440, skyPainter("#ff8a6b", "#ffb98a", "#ffe0a0", "#ff6fae"), { unlit: true });
  sky.position.set(0, 18, -60); g.add(sky);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshBasicMaterial({ color: "#fff3c4", toneMapped: false }));
  sun.position.set(-14, 9, -59); g.add(sun);
  // ground and road
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), toon("#7a63c8")); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 5), toon("#4b3d8f")); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, 7); g.add(road);
  for (let i = -20; i < 20; i++) { const d = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.15), flat("#ffe9a8")); d.rotation.x = -Math.PI / 2; d.position.set(i * 3, 0.02, 7); g.add(d); }
  const palette = ["#9d8cf0", "#b6a2ff", "#8f7fe6", "#c6a8ff", "#a4b8ff", "#f0a8c8"];
  const blocks = [];
  const addBlock = (x, z, w, floors, cols, seed, ry = 0, base) => {
    const H = floors * 0.9 + 1.2;
    const blk = new THREE.Group(); blk.position.set(x, 0, z); blk.rotation.y = ry;
    const col = base ?? palette[seed % palette.length];
    const tex = blockTexture(seed, col, floors, cols, seed === 3 ? 0.08 : 0.22);
    const mats = [toon(col), toon(col), toon(col), toon(col), toon("#ffffff", { map: tex }), toon(col)];
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, floors * 0.9, 1.6), mats); body.position.y = 1.2 + (floors * 0.9) / 2; blk.add(body);
    // void deck pillars
    for (let i = 0; i <= Math.floor(w / 1.2); i++) blk.add(box(0.18, 1.2, 0.18, toon("#e8e1ff"), -w / 2 + 0.2 + i * ((w - 0.4) / Math.floor(w / 1.2)), 0.6, 0.6));
    blk.add(box(w, 0.08, 1.7, toon("#d8ccff"), 0, 1.2, 0));
    // roof: water tank and lift motor room
    blk.add(box(w * 0.25, 0.7, 1.0, toon("#e8e1ff"), w * 0.2, H + 0.35, 0));
    blk.add(cyl(0.35, 0.35, 0.6, toon("#7d6bd6"), -w * 0.25, H + 0.3, 0));
    blk.add(box(w + 0.1, 0.15, 1.7, toon("#efe6ff"), 0, H, 0));
    g.add(blk); blocks.push(blk); return blk;
  };
  // the hero block, then rows behind
  addBlock(0, 0, 6, 11, 8, 3, 0, "#a99af2");
  let seed = 10;
  for (let row = 1; row < 5; row++) for (let i = -4; i <= 4; i++) {
    if (row === 1 && Math.abs(i) < 1) continue;
    addBlock(i * 8 + hash(seed) * 2, -row * 9 - hash(seed * 3) * 3, 5 + hash(seed * 5) * 2, 9 + Math.floor(hash(seed * 7) * 8), 7, seed++, (hash(seed) - 0.5) * 0.3);
  }
  // trees along the road
  for (let i = -12; i <= 12; i++) {
    const x = i * 2.6 + 0.6, z = 4.2;
    g.add(cyl(0.08, 0.1, 1.0, toon("#6b4a3a"), x, 0.5, z, 8));
    g.add(ball(0.55 + hash(i) * 0.2, toon(hash(i * 3) > 0.5 ? "#43b37a" : "#2f9e6a"), x, 1.35, z));
  }
  // string lights between lamp posts (like the reference's fairy lights)
  for (let i = -6; i <= 6; i++) {
    const x = i * 4; g.add(cyl(0.05, 0.05, 2.6, toon("#3a2f55"), x, 1.3, 5.2, 8));
    g.add(ball(0.12, toon("#fff2b0", { emissive: "#ffd36b", emissiveIntensity: 1.2 }), x, 2.65, 5.2));
  }
  // the hero window glows (the room is lit when he wakes); its material is exposed for shots
  const glowMat = new THREE.MeshBasicMaterial({ color: "#3a2a7a", toneMapped: false });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.47), glowMat);
  win.position.copy(HERO_WINDOW); g.add(win);
  g.userData.heroWindow = glowMat;
  return g;
}
