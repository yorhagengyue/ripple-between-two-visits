// The studio: one scene, one camera, every set and character built once; renderAt(t) poses everything for time t,
// paints the 3D frame through the comic look, then the 2D comic layer on top. Chapters register shots on SHOTS.
import * as THREE from "three";
import { makeLook, W, H } from "./look.js";
import { SHOTS, shotAt, DURATION } from "./timeline.js";
import { STAGE } from "./stage.js";
// Fonts first: sets paint signs into canvas textures at build time, so the comic font must be loaded before chapters.
await document.fonts.load('64px "Bangers"');
// ?only=c03_bp loads just that chapter (so one broken chapter cannot break another's renders); otherwise all of them.
const only = new URLSearchParams(location.search).get("only");
if (only) await import(`./chapters/${only}.js`); else await import("./chapters/index.js");

const glCanvas = document.getElementById("gl");
const out = document.getElementById("out");
const ctx = out.getContext("2d");
const look = makeLook(glCanvas);

window.gpuInfo = () => {
  const gl = look.renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
};

async function paintAt(t) {
  const { shot, lt } = shotAt(t);
  const ov = [];
  const waits = [];
  STAGE.reset();
  const look2 = shot ? (await shot.fn({ t, lt, dur: shot.b - shot.a, ov, wait: (p) => waits.push(p), stage: STAGE })) || {} : {};
  await Promise.all(waits);
  if (look2.plain) {
    // the sober second part: no 3D, no comic pass; a flat background and the 2D layer only
    ctx.fillStyle = look2.bg ?? "#0f1724"; ctx.fillRect(0, 0, W, H);
  } else {
    look.paint(STAGE.scene, STAGE.camera, Math.floor(t * 12), look2);
    ctx.drawImage(glCanvas, 0, 0, W, H);
  }
  for (const f of ov) await f(ctx);
}

// The sound pass: paint each frame of a range and record, against film time, every sound-effect word as it lands,
// every hit flash, and which recording (clip, source second) each app panel shows. Nothing is encoded.
window.logRange = async (a, b, fps = 30) => {
  const log = { sfx: [], flash: [], frames: [], bubbles: [] };
  window.__logBubble = (lines, x, y, voice) => log.bubbles.push({ t: now, text: lines.join(" / "), x: Math.round(x), y: Math.round(y), voice: voice ?? null });
  let now = 0;
  window.__logSfx = (txt, age, x, size) => { const hit = Math.round((now - age) * 1000) / 1000; if (!log.sfx.some((e) => e.txt === txt && Math.abs(e.hit - hit) < 0.05)) log.sfx.push({ txt, hit, x, size }); };
  window.__logFlash = (age) => { const hit = Math.round((now - age) * 1000) / 1000; if (!log.flash.some((e) => Math.abs(e - hit) < 0.05)) log.flash.push(hit); };
  window.__logFrame = (clip, sec) => log.frames.push({ t: now, clip, sec: Math.round(sec * 1000) / 1000 });
  for (let i = Math.round(a * fps); i < Math.round(b * fps); i++) { now = i / fps; await paintAt(now); }
  window.__logSfx = window.__logFlash = window.__logFrame = window.__logBubble = undefined;
  return log;
};

window.renderAt = async (t, type = "image/png", q = 0.95) => {
  await paintAt(t);
  return out.toDataURL(type, q);
};

window.renderSheet = async (ts, cols = 3, w = 640) => {
  const h = Math.round((w * H) / W), rows = Math.ceil(ts.length / cols);
  const sheet = document.createElement("canvas"); sheet.width = cols * w; sheet.height = rows * (h + 26);
  const s = sheet.getContext("2d"); s.fillStyle = "#111"; s.fillRect(0, 0, sheet.width, sheet.height);
  const ms = [];
  for (let i = 0; i < ts.length; i++) {
    const t0 = performance.now(); await paintAt(ts[i]); ms.push(Math.round(performance.now() - t0));
    const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 26);
    s.drawImage(out, x, y + 26, w, h);
    s.fillStyle = "#ffd94a"; s.font = "bold 18px system-ui"; s.fillText(`${ts[i].toFixed(2)} s  ${shotAt(ts[i]).shot?.name ?? "-"}`, x + 6, y + 19);
  }
  return { url: sheet.toDataURL("image/jpeg", 0.88), ms };
};

await document.fonts.load('64px "Bangers"');
await document.fonts.ready;
window.ready = true;

// Scrubbing in a normal browser tab.
if (!location.search.includes("render")) {
  const scrub = document.getElementById("scrub"), tt = document.getElementById("tt");
  scrub.max = DURATION;
  let busy = false, want = 0;
  const go = async () => { if (busy) return; busy = true; while (want !== null) { const t = want; want = null; await paintAt(t); tt.textContent = `${t.toFixed(2)} s  ${shotAt(t).shot?.name ?? ""}`; } busy = false; };
  scrub.oninput = () => { want = +scrub.value; go(); };
  want = 0; go();
}
