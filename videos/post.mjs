// post.mjs: burn the version-4 captions and part markers onto the assembled frames (captions-v4.json), in headless
// Chrome with the film's Bangers font (post.html does the drawing).
//   node post.mjs --check                              validate every caption's layout (at most two lines, inside its box)
//   node post.mjs --sheet=out/check/x.jpg --at=12.4,15 [--ids=c03a,c05b] [--edges] [--debug] [--cols=3] [--w=640]
//        contact sheet of burned frames at final film seconds (--edges: the first and last frame of each caption)
//   node post.mjs --frames [--workers=3]               out/frames-v4-raw -> out/frames-v4 (every frame)
// Run from anywhere (paths are relative to the promo folder). Frames without a caption are hard links to the raw frame;
// captioned frames are written to a .tmp file and renamed into place, so a hard-linked frame (which shares its data
// with the master renders in frames-v2, frames-t, frames-a) is never opened for writing.
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, linkSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

process.chdir(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const ROOT = resolve(".");
const CHROME = args.chrome || process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SRC = args.src || "out/frames-v4-raw", DST = args.dst || "out/frames-v4";
const spec = JSON.parse(readFileSync(args.captions || "captions-v4.json", "utf-8"));
const FPS = spec.fps ?? 30;
const map = JSON.parse(readFileSync(join(SRC, "map.json"), "utf-8"));
const TOTAL = map.frames;
const name = (o) => `f${String(o).padStart(5, "0")}.jpg`;

// expand presets: a caption's position is a preset name plus optional overrides
const caps = spec.captions.map((c) => {
  const pos = { ...(spec.presets[c.position] ?? {}), ...(c.pos ?? {}) };
  if (!spec.presets[c.position] && !c.pos) throw new Error(`caption ${c.id}: unknown position ${c.position}`);
  const fa = Math.round(c.start * FPS), fb = Math.round(c.end * FPS);   // visible on frames [fa, fb)
  return { ...c, pos, fa, fb };
});
// the frames of the in and out moves; adjacent captions never share a frame
const IN = spec.inFrames ?? 5, OUT = spec.outFrames ?? 5;
const activeAt = (o) => caps.filter((c) => o >= c.fa && o < c.fb).map((cap) => ({ cap, kin: Math.min(1, (o - cap.fa + 1) / IN), kout: Math.min(1, (cap.fb - o) / OUT) }));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0, args: ["--window-size=1920,1080"] });
const done = async (code = 0) => { await browser.close(); server.close(); process.exit(code); };
async function openPage(tag = "") {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  page.on("console", (m) => { if (["error", "warn"].includes(m.type())) console.log(`[page${tag}]`, m.text()); });
  page.on("pageerror", (e) => console.log(`[page error${tag}]`, e.message));
  await page.goto(`${BASE}/post.html`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.ready === true", { timeout: 60000 });
  return page;
}
const srcUrl = (o) => `${BASE}/${SRC}/${name(o)}`;
// the same file on disk (a hard link): compare the file ids as bigints (Windows file ids exceed 2^53)
const sameFile = (a, b) => { const x = statSync(a, { bigint: true }), y = statSync(b, { bigint: true }); return x.ino === y.ino && x.dev === y.dev; };
// a stale .tmp could be a hard link left by an interrupted run: move it aside (never write through it, never delete)
const clearTmp = (d) => { if (existsSync(d + ".tmp")) renameSync(d + ".tmp", `${d}.tmp.old-${Date.now()}`); };

// overlaps between captions, and the timing rules (at least 2.5 s, at least 0.3 s a word)
function lint() {
  const msgs = [];
  const sorted = [...caps].sort((a, b) => a.fa - b.fa);
  sorted.forEach((c, i) => {
    const words = (c.style === "part" ? c.head : c.text).split(/\s+/).filter((w) => /\w/.test(w)).length, dur = (c.fb - c.fa) / FPS;
    if (dur < 2.5 - 1e-6) msgs.push(`${c.id}: ${dur.toFixed(2)} s is under 2.5 s`);
    if (dur < words * 0.3 - 1e-6) msgs.push(`${c.id}: ${words} words in ${dur.toFixed(2)} s is under 0.3 s a word`);
    if (words > 14) msgs.push(`${c.id}: ${words} words`);
    if (i && sorted[i - 1].fb > c.fa) msgs.push(`${sorted[i - 1].id} and ${c.id} overlap`);
    if (c.fb > TOTAL) msgs.push(`${c.id} ends after the film`);
  });
  return msgs;
}

const page = await openPage();
const report = await page.evaluate((caps) => window.check(caps), caps);
const bad = report.filter((r) => r.errs.length);
const lintMsgs = lint();
if (args.check) {
  for (const r of report) console.log(`${r.id.padEnd(6)} ${r.errs.length ? "FAIL " + r.errs.join("; ") : "ok"}  rect ${r.rect}  | ${r.lines.join(" / ")}`);
  for (const m of lintMsgs) console.log("timing: " + m);
}
if (bad.length || lintMsgs.length) {
  console.log(`${bad.length} layout errors, ${lintMsgs.length} timing errors`);
  if (!args.check && !args.force) await done(1);
}
if (args.check) await done(bad.length || lintMsgs.length ? 1 : 0);

if (args.sheet) {
  const pick = args.ids ? caps.filter((c) => String(args.ids).split(",").includes(c.id)) : caps;
  const items = [];
  if (args.edges) for (const c of pick) for (const o of [c.fa, c.fb - 1]) items.push({ src: srcUrl(o), active: activeAt(o), label: `${c.id} ${o === c.fa ? "first" : "last"} f${o} ${(o / FPS).toFixed(2)} s` });
  if (args.at) for (const s of String(args.at).split(",").map(Number)) { const o = Math.round(s * FPS); items.push({ src: srcUrl(o), active: activeAt(o), label: `${s.toFixed(2)} s f${o} ${activeAt(o).map((a) => a.cap.id).join(",")}` }); }
  if (args.every) { // every N seconds inside each picked caption
    const step = Math.round(+args.every * FPS);
    for (const c of pick) for (let o = c.fa; o < c.fb; o += step) items.push({ src: srcUrl(o), active: activeAt(o), label: `${c.id} f${o} ${(o / FPS).toFixed(2)} s` });
  }
  const url = await page.evaluate((items, cols, w, dbg) => window.sheet(items, cols, w, dbg), items, +(args.cols || 3), +(args.w || 640), !!args.debug);
  mkdirSync(dirname(args.sheet), { recursive: true });
  writeFileSync(args.sheet, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  console.log(`${args.sheet}: ${items.length} frames`);
  await done();
}

if (args.frames) {
  mkdirSync(DST, { recursive: true });
  const workers = +(args.workers || 3);
  const todo = []; let linked = 0, kept = 0;
  for (let o = 0; o < TOTAL; o++) {
    const s = join(SRC, name(o)), d = join(DST, name(o));
    if (!existsSync(s)) { console.log("missing source " + s); await done(1); }
    if (activeAt(o).length) { todo.push(o); continue; }
    // no caption: the frame is the raw frame itself (a hard link); replace whatever is there unless it already is
    if (existsSync(d) && sameFile(d, s)) { kept++; continue; }
    clearTmp(d); linkSync(s, d + ".tmp"); renameSync(d + ".tmp", d); linked++;
  }
  console.log(`${TOTAL} frames: ${kept} links already in place, ${linked} linked, ${todo.length} to burn with ${workers} worker(s)`);
  let next = 0, n = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const pg = w === 0 ? page : await openPage(` w${w}`);
    while (next < todo.length) {
      const o = todo[next++], d = join(DST, name(o));
      const url = await pg.evaluate((src, active) => window.burn(src, active, 0.95), srcUrl(o), activeAt(o));
      clearTmp(d); writeFileSync(d + ".tmp", Buffer.from(url.slice(url.indexOf(",") + 1), "base64"), { flag: "wx" });
      renameSync(d + ".tmp", d);   // swaps the directory entry; a hard-linked original is left untouched
      if (++n % 300 === 0) console.log(`${n}/${todo.length}  ${((Date.now() - t0) / n).toFixed(0)} ms/frame`);
    }
  }));
  const files = readdirSync(DST).filter((f) => /^f\d{5}\.jpg$/.test(f)).length;
  console.log(`done: ${files} frames in ${DST} (expected ${TOTAL}), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await done(files === TOTAL ? 0 : 1);
}

console.log("nothing to do; see the header of post.mjs");
await done(1);
