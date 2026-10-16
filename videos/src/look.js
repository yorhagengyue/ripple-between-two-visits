// The look: cel-shaded blocks under warm key light and violet shadow, then a comic pass on top:
// ink lines found from normals and depth, halftone dots that grow in the shadows, a little colour misregistration,
// paper grain that "boils" 12 times a second, and a soft vignette. Reference: a 3D comic-style short film.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export const W = 1920, H = 1080;

let gradient;
/** Three hard steps of light: shadow, mid, lit. */
function gradientMap() {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 150, 255]);
  gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}
const matCache = new Map();
/** A cel-shaded material in a hex colour; `emissive` for things that glow (screens, lamps). */
export function toon(hex, o = {}) {
  const key = hex + JSON.stringify(o);
  if (!o.map && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap: gradientMap(), ...o });
  if (o.emissive) m.emissive = new THREE.Color(o.emissive);
  if (!o.map) matCache.set(key, m);
  return m;
}
/** A flat unlit material (signs, screens, glyphs). */
export const flat = (hex, o = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), ...o });

const ComicShader = {
  uniforms: {
    tDiffuse: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    res: { value: new THREE.Vector2(W, H) }, seed: { value: 0 }, near: { value: 0.1 }, far: { value: 100 },
    dotSize: { value: 7.0 }, caAmt: { value: 0.0016 }, inkW: { value: 1.6 }, inkCol: { value: new THREE.Color("#1a1030") },
    inkK: { value: 0.92 }, dotK: { value: 1.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tNormal, tDepth; uniform vec2 res; uniform float seed, near, far, dotSize, caAmt, inkW, inkK, dotK;
    uniform vec3 inkCol; varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * near * far) / (far + near - z * (far - near)); }
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 7.13) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float r2 = dot(c, c);
      vec2 off = c * caAmt * (0.35 + r2 * 2.5);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      float L = dot(col, vec3(0.299, 0.587, 0.114));
      // halftone: a 45-degree dot screen, small dots in the light, big dark dots in the shadow
      vec2 px = uv * res; float a = 1.0210; // 58.5 degrees, as measured on the reference
      vec2 g = mat2(cos(a), -sin(a), sin(a), cos(a)) * px / dotSize; float d = length(fract(g) - 0.5);
      float shade = smoothstep(0.78, 0.12, L);
      float rad = 0.46 * shade; // dots only where it is shaded
      float dm = 1.0 - smoothstep(rad - 0.07, rad + 0.07, d);
      vec3 dotCol = col * mix(0.80, 0.50, shade) + vec3(0.03, 0.0, 0.06) * shade;
      col = mix(col, dotCol, dm * (0.35 + 0.5 * shade) * dotK);
      // ink: edges in view-space normals and in linear depth
      vec2 e = inkW / res;
      vec3 n1 = texture2D(tNormal, uv + vec2(e.x, 0.0)).xyz, n2 = texture2D(tNormal, uv - vec2(e.x, 0.0)).xyz;
      vec3 n3 = texture2D(tNormal, uv + vec2(0.0, e.y)).xyz, n4 = texture2D(tNormal, uv - vec2(0.0, e.y)).xyz;
      float d0 = lin(texture2D(tDepth, uv).x);
      float d1 = lin(texture2D(tDepth, uv + vec2(e.x, 0.0)).x), d2 = lin(texture2D(tDepth, uv - vec2(e.x, 0.0)).x);
      float d3 = lin(texture2D(tDepth, uv + vec2(0.0, e.y)).x), d4 = lin(texture2D(tDepth, uv - vec2(0.0, e.y)).x);
      float nE = max(length(n1 - n2), length(n3 - n4));
      float dE = (abs(d1 + d2 - 2.0 * d0) + abs(d3 + d4 - 2.0 * d0)) / max(d0, 0.001);
      float edge = clamp(smoothstep(0.35, 0.75, nE) + smoothstep(0.012, 0.04, dE), 0.0, 1.0);
      col = mix(col, inkCol, edge * inkK);
      // paper grain that boils, and a vignette
      col += (h(floor(px * 0.5)) - 0.5) * 0.02;
      col *= 1.0 - r2 * 0.25;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** The renderer and its passes. `paint(scene, camera, seed)` draws one frame onto the WebGL canvas. */
export function makeLook(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; // the key light in stage.js casts shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const rtN = new THREE.WebGLRenderTarget(W, H, { depthTexture: new THREE.DepthTexture(W, H), samples: 0 });
  const normalMat = new THREE.MeshNormalMaterial();

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(null, null);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.6, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const comic = new ShaderPass(ComicShader);
  composer.addPass(comic);

  function paint(scene, camera, seed, o = {}) {
    renderPass.scene = scene; renderPass.camera = camera;
    // normals and depth for the ink lines
    const bg = scene.background; scene.background = null;
    const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 1);
    scene.overrideMaterial = normalMat;
    renderer.setRenderTarget(rtN); renderer.clear(); renderer.render(scene, camera);
    scene.overrideMaterial = null; renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevA); scene.background = bg;
    const u = comic.uniforms;
    u.tNormal.value = rtN.texture; u.tDepth.value = rtN.depthTexture;
    u.near.value = camera.near; u.far.value = camera.far; u.seed.value = seed;
    u.dotK.value = o.dotK ?? 1; u.inkK.value = o.inkK ?? 0.92; u.caAmt.value = o.ca ?? 0.0016;
    bloom.strength = o.bloom ?? 0.55;
    composer.render();
  }
  return { renderer, paint };
}
