// render.mjs: paint the promo in headless Chrome, frame by frame, from studio.html.
//   node render.mjs --probe                                        which GPU WebGL gets in headless Chrome
//   node render.mjs --sheet=1,2.5,4 [--cols=3] [--w=640] --out=out/check/a.jpg   contact sheet of several times
//   node render.mjs --stills=1.2,4 --out=out/stills               full-size PNG stills
//   node render.mjs --clip=0:6 [--fps=30] [--fresh] --out=out/test.mp4   short clip (no audio); cached frames are reused unless --fresh
//   node render.mjs --frames=0:90 [--fps=30] [--workers=3]        full-size JPEG frames into out/frames (resumable)
//   node render.mjs --encode [--audio=assets/music.mp3] --out=out/promo.mp4
//   add --only=c03_bp to any of these to load just that chapter file (src/chapters/c03_bp.js)
// Every frame is a pure function of time (window.renderAt(t)), so frames can render out of order and in parallel.
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

// Work from this file's folder, so `node D:/ripple-c2/film/promo/render.mjs ...` works from anywhere (out/ paths are
// relative to the promo folder).
process.chdir(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const ROOT = resolve(".");
const CHROME = args.chrome || process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const fps = +(args.fps || 30);
const FRAMES_DIR = args.dir || "out/frames";

const run = (cmd, a) => new Promise((ok, bad) => { const p = spawn(cmd, a, { stdio: "inherit" }); p.on("close", (c) => (c ? bad(new Error(cmd + " exited " + c)) : ok())); });

if (args.encode) {
  const out = args.out || "out/promo.mp4";
  const n = readdirSync(FRAMES_DIR).filter((f) => f.endsWith(".jpg")).length;
  console.log(`encoding ${n} frames -> ${out}`);
  const a = ["-y", "-loglevel", "error", "-stats", "-framerate", String(fps), "-i", `${FRAMES_DIR}/f%05d.jpg`];
  if (args.audio) a.push("-i", args.audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest");
  a.push("-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
  await run("ffmpeg", a);
  console.log("wrote " + out);
  process.exit(0);
}

// A small static server: ES modules and fonts do not load from file:// pages.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "max-age=3600" });
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  args: ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization", "--enable-webgl", "--window-size=1920,1080",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
});
const done = async (code = 0) => { await browser.close(); server.close(); process.exit(code); };

async function openPage(tag = "") {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  page.on("console", (m) => { if (["error", "warn"].includes(m.type())) console.log(`[page${tag}]`, m.text()); });
  page.on("pageerror", (e) => console.log(`[page error${tag}]`, e.message));
  await page.goto(`${BASE}/studio.html?render${args.only ? "&only=" + args.only : ""}`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.ready === true", { timeout: 120000 });
  return page;
}
const frameOf = async (page, t, type, q) => {
  const url = await page.evaluate((t, type, q) => window.renderAt(t, type, q), t, type, q);
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
};
const times = (s) => String(s).split(",").map(Number);

if (args.probe) {
  const page = await openPage();
  console.log(await page.evaluate(() => window.gpuInfo()));
  await done();
}

if (args.sheet) {
  const page = await openPage();
  const out = args.out || "out/sheet.jpg"; mkdirSync(dirname(out), { recursive: true });
  const { url, ms } = await page.evaluate((ts, c, w) => window.renderSheet(ts, c, w), times(args.sheet), +(args.cols || 3), +(args.w || 640));
  writeFileSync(out, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  console.log(`${out}  ms/frame: ${ms.join(" ")}`);
  await done();
}

if (args.stills) {
  const page = await openPage();
  const out = args.out || "out/stills"; mkdirSync(out, { recursive: true });
  for (const s of times(args.stills)) {
    const t0 = Date.now(); const buf = await frameOf(page, s, "image/png");
    writeFileSync(join(out, `t${s.toFixed(2)}.png`), buf); console.log(`t=${s}  ${Date.now() - t0} ms`);
  }
  await done();
}

async function paintFrames(a, b, dir, workers) {
  mkdirSync(dir, { recursive: true });
  const first = Math.round(a * fps), last = Math.round(b * fps) - 1;
  const todo = [];
  for (let i = first; i <= last; i++) if (!existsSync(join(dir, `f${String(i).padStart(5, "0")}.jpg`))) todo.push(i);
  console.log(`${todo.length} of ${last - first + 1} frames to paint with ${workers} worker(s)`);
  let next = 0, painted = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await openPage(` w${w}`);
    while (next < todo.length) {
      const i = todo[next++]; const f = join(dir, `f${String(i).padStart(5, "0")}.jpg`);
      const buf = await frameOf(page, i / fps, "image/jpeg", 0.95);
      writeFileSync(f + ".tmp", buf); renameSync(f + ".tmp", f);
      if (++painted % 30 === 0) console.log(`${painted}/${todo.length}  ${((Date.now() - t0) / painted).toFixed(0)} ms/frame`);
    }
    await page.close();
  }));
}

if (args.clip) {
  const [a, b] = String(args.clip).split(":").map(Number);
  const dir = `out/clip-${args.only ? args.only + "-" : ""}${a}-${b}`;
  // --fresh: move the cached frames aside (never deleted) so nothing stale is reused after a code change
  if (args.fresh && existsSync(dir)) renameSync(dir, `${dir}-old-${Date.now()}`);
  await paintFrames(a, b, dir, +(args.workers || 2));
  const out = args.out || `out/clip-${a}-${b}.mp4`;
  const first = Math.round(a * fps);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-start_number", String(first), "-i", `${dir}/f%05d.jpg`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  console.log("wrote " + out);
  await done();
}

if (args.log) {
  // node render.mjs --log=0:205 --out=out/log-0-205.json   the sound pass (see window.logRange in main.js)
  const [a, b] = String(args.log).split(":").map(Number);
  const page = await openPage();
  const t0 = Date.now();
  const log = await page.evaluate((a, b, fps) => window.logRange(a, b, fps), a, b, fps);
  const out = args.out || `out/log-${a}-${b}.json`; mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(log));
  console.log(`${out}: ${log.sfx.length} sound words, ${log.flash.length} flashes, ${log.frames.length} panel frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await done();
}

if (args.frames) {
  const [a, b] = String(args.frames).split(":").map(Number);
  await paintFrames(a, b, FRAMES_DIR, +(args.workers || 3));
  await done();
}

console.log("nothing to do; see the header of render.mjs");
await done(1);
