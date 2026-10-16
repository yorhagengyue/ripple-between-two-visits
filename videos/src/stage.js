// The stage: one scene and camera, the lights, and registries of sets and cast. Everything is built once at load;
// STAGE.reset() hides it all before each frame, and a shot shows and poses only what it needs.
import * as THREE from "three";
import { W, H } from "./look.js";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, W / H, 0.05, 200);

const hemi = new THREE.HemisphereLight("#c7b6ff", "#3b2a6e", 1.15);
const key = new THREE.DirectionalLight("#ffd6a8", 2.4);
key.position.set(4, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 40; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
const rim = new THREE.DirectionalLight("#ff7fd0", 0.9);
rim.position.set(-5, 3, -4);
scene.add(hemi, key, key.target, rim);

const LIGHTS = {
  day: { sky: "#cfc2ff", ground: "#463a7a", hemi: 1.15, key: "#ffe0b8", keyI: 2.4, rim: "#ff8fd6", rimI: 0.8, bg: "#f4b26b" },
  warm: { sky: "#ffc9a8", ground: "#4a2f6e", hemi: 1.0, key: "#ffcf96", keyI: 2.6, rim: "#ff6fb8", rimI: 1.0, bg: "#f59a5a" },
  dusk: { sky: "#ff9fb8", ground: "#2f2466", hemi: 0.9, key: "#ff9f5a", keyI: 2.2, rim: "#7f6bff", rimI: 1.2, bg: "#f08a6a" },
  night: { sky: "#6a5ad8", ground: "#1c1440", hemi: 0.75, key: "#ffd08a", keyI: 1.4, rim: "#4fd8ff", rimI: 1.0, bg: "#24184a" },
  lab: { sky: "#9a7bff", ground: "#24185a", hemi: 1.0, key: "#c9f2ff", keyI: 1.8, rim: "#ff4fd0", rimI: 1.3, bg: "#3a1f7a" },
};

const sets = new Map(), cast = new Map();
export const STAGE = {
  scene, camera, key, hemi, rim,
  /** register a set (a Group); returns it */
  set(name, g) { g.visible = false; scene.add(g); sets.set(name, g); return g; },
  /** register a cast member { g, pose }; returns it */
  actor(name, a) { a.g.visible = false; a.g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(a.g); cast.set(name, a); return a; },
  get(name) { return cast.get(name) ?? sets.get(name); },
  /** register a cast member only if no chapter has yet: STAGE.need("tan", makeTanBot) */
  need(name, maker) { return cast.get(name) ?? STAGE.actor(name, maker()); },
  reset() {
    for (const g of sets.values()) g.visible = false;
    for (const a of cast.values()) a.g.visible = false;
    STAGE.lights("day");
    scene.fog = null;
    camera.fov = 38; camera.updateProjectionMatrix();
  },
  /** show a set by name */
  show(...names) { for (const n of names) { const s = sets.get(n); if (s) s.visible = true; } },
  /** show and pose a cast member */
  pose(name, p) { const a = cast.get(name); a.g.visible = true; a.g.rotation.set(0, 0, 0); a.pose(p); return a; },
  lights(preset, o = {}) {
    const L = { ...LIGHTS[preset], ...o };
    hemi.color.set(L.sky); hemi.groundColor.set(L.ground); hemi.intensity = L.hemi;
    key.color.set(L.key); key.intensity = L.keyI; rim.color.set(L.rim); rim.intensity = L.rimI;
    scene.background = new THREE.Color(L.bg);
    if (L.keyPos) key.position.set(...L.keyPos); else key.position.set(4, 7, 5);
    if (L.keyTarget) key.target.position.set(...L.keyTarget); else key.target.position.set(0, 0, 0);
  },
  /** a world point [x, y, z] to screen pixels { x, y } on the 1920 x 1080 frame (after STAGE.cam for this frame) */
  project(p) { camera.updateMatrixWorld(); const v = new THREE.Vector3(...p).project(camera); return { x: (v.x + 1) * W / 2, y: (1 - v.y) * H / 2 }; },
  /** camera at pos looking at target; fov optional; roll optional */
  cam(pos, target, fov, roll = 0) {
    camera.position.set(...pos); camera.up.set(Math.sin(roll), Math.cos(roll), 0); camera.lookAt(...target);
    if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  },
};
