#!/usr/bin/env node
/**
 * Record one journey: run its script (e2e/journeys/<编号>-<短名>.journey.ts) with playwright.journeys.config.ts against a
 * running app, and put the mp4 where the progress vault expects it.
 *
 *   node scripts/record/run.mjs <编号> [--base-url http://localhost:3430] [--out D:/ripple-c2/rec/out] [--pace 1]
 *
 *   <编号>        the journey number, as in 主文档.md ("07" or "7")
 *   --base-url    the app (default $JOURNEY_BASE_URL or http://localhost:3430); start it with serve.mjs
 *   --out         root folder (default <JOURNEY_REC_DIR>/out, i.e. D:/ripple-c2/rec/out); the mp4 goes to
 *                 <out>/<编号>-<短名>/YYYY-MM-DD-<序号>.mp4 (date in Asia/Singapore, 序号 = next free number that day).
 *                 Point it at the vault's recordings/ folder to record straight into the vault.
 *   --pace        pause multiplier (default 1; 0 = no pauses, a quick check only)
 *
 * Playwright's output goes to stderr; stdout gets one JSON summary:
 *   { journey, name, title, passed, steps: [{ n, t, phone, text }], duration, file, doc, video, clips, warnings, raw, error? }
 * `doc` is the path to give update-doc.mjs once the mp4 is in the vault (recordings/<编号>-<短名>/<file>).
 * Exit code 0 = passed and the mp4 exists; 1 = the journey failed (no mp4 is written); 2 = usage or server problem.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REC = process.env.JOURNEY_REC_DIR?.trim() || (process.platform === "win32" ? "D:/ripple-c2/rec" : path.join(os.tmpdir(), "ripple-c2", "rec"));
const JOURNEYS = path.join(WEB, "e2e", "journeys");
const TZ = "Asia/Singapore";

function fail(code, error, extra = {}) {
  process.stdout.write(`${JSON.stringify({ passed: false, error, ...extra }, null, 1)}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

/** { date: "2026-10-10", stamp: "20261010-153000" } in Singapore time */
function sgNow(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, stamp: `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}` };
}

function clock(t) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._.length !== 1) {
  process.stderr.write(`usage: node scripts/record/run.mjs <编号>|<编号>-<短名> [--base-url URL] [--out DIR] [--pace N]\n`);
  process.exit(args.help ? 0 : 2);
}
// <编号> picks the journey's only script; <编号>-<短名> picks one when a journey has several (01-signup, 01-onboard)
const named = /^(\d{1,2})-([a-z0-9][a-z0-9-]*)$/.exec(String(args._[0]));
const id = (named ? named[1] : String(args._[0])).padStart(2, "0");
if (!/^\d{2}$/.test(id)) fail(2, `journey number must be digits, got ${args._[0]}`);
const specs = existsSync(JOURNEYS)
  ? readdirSync(JOURNEYS).filter(
      (f) => (named ? f === `${id}-${named[2]}.journey.ts` : f.startsWith(`${id}-`)) && /^\d{2}-[a-z0-9][a-z0-9-]*\.journey\.ts$/.test(f),
    )
  : [];
if (specs.length !== 1) {
  fail(2, specs.length ? `more than one script for journey ${id}: ${specs.join(", ")} (pass <编号>-<短名>)` : `no script e2e/journeys/${id}-<短名>.journey.ts`);
}
const spec = specs[0];
const name = spec.replace(/^\d{2}-/, "").replace(/\.journey\.ts$/, "");
const base = String(args["base-url"] || process.env.JOURNEY_BASE_URL || "http://localhost:3430").replace(/\/+$/, "");
const outRoot = path.resolve(String(args.out || path.join(REC, "out")));
const pace = args.pace !== undefined ? String(args.pace) : process.env.JOURNEY_PACE;

// the app must be running (production build: serve.mjs); any HTTP answer will do (plain http/https: fetch's pooled
// sockets trip Node on Windows at process.exit)
const down = await new Promise((resolve) => {
  const req = (base.startsWith("https:") ? https : http).get(base, { agent: false, timeout: 10_000 }, (res) => {
    res.resume();
    resolve(null);
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", (err) => resolve(err.code ?? err.message));
});
if (down) fail(2, `the app does not answer at ${base} (${down}). Start it first: node scripts/record/serve.mjs --port ${new URL(base).port || 80} --build`, { journey: id, name });

const { date, stamp } = sgNow();
const folder = path.join(outRoot, `${id}-${name}`);
const pattern = new RegExp(`^${date}-(\\d+)\\.mp4$`);
// the kit makes the folder when it writes the mp4: a failed run leaves nothing in out/
const taken = (existsSync(folder) ? readdirSync(folder) : []).map((f) => pattern.exec(f)).filter(Boolean).map((m) => Number(m[1]));
const seq = taken.length ? Math.max(...taken) + 1 : 1;
const fileName = `${date}-${seq}.mp4`;
const outFile = path.join(folder, fileName);
const raw = path.join(REC, "raw", `${id}-${name}`, stamp);
const resultFile = path.join(raw, "journey-result.json");
mkdirSync(raw, { recursive: true });

const cli = path.join(WEB, "node_modules", "@playwright", "test", "cli.js");
if (!existsSync(cli)) fail(2, `Playwright is not installed in ${WEB} (npm --prefix ${WEB} install)`);
const env = {
  ...process.env,
  JOURNEY_BASE_URL: base,
  JOURNEY_OUT_FILE: outFile,
  JOURNEY_RESULT: resultFile,
  JOURNEY_RAW_DIR: raw,
  PW_PORT: new URL(base).port || (base.startsWith("https:") ? "443" : "80"),
  ...(pace !== undefined ? { JOURNEY_PACE: pace } : {}),
};
const child = spawn(process.execPath, [cli, "test", "-c", "playwright.journeys.config.ts", `e2e/journeys/${spec}`, "--output", raw], {
  cwd: WEB,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
child.stdout.pipe(process.stderr);
child.stderr.pipe(process.stderr);
const code = await new Promise((resolve) => child.on("close", (c) => resolve(c ?? 1)));

let result = null;
try {
  result = JSON.parse(readFileSync(resultFile, "utf8"));
} catch {
  // the test never reached the kit (syntax error, server gone): Playwright's output above says why
}
const passed = code === 0 && result?.status === "passed" && existsSync(outFile);
const summary = {
  journey: id,
  name,
  title: result?.title ?? null,
  passed,
  steps: (result?.steps ?? []).map((s) => ({ n: s.n, t: s.t === null ? null : clock(s.t), phone: s.label ?? s.phone, text: s.text })),
  duration: passed ? result.duration : null,
  file: passed ? outFile.replace(/\\/g, "/") : null,
  doc: passed ? `recordings/${id}-${name}/${fileName}` : null,
  video: passed
    ? {
        width: result.width,
        height: result.height,
        audio: result.hasAudio,
        sizeMB: Math.round((result.sizeBytes / 1048576) * 100) / 100,
        mbPerMinute: Math.round((result.sizeBytes / 1048576 / (result.duration / 60)) * 100) / 100,
      }
    : null,
  clips: result?.clips ?? [],
  notifications: result?.notifications ?? [],
  warnings: result?.warnings ?? [],
  raw: raw.replace(/\\/g, "/"),
  ...(passed ? {} : { error: result?.error ?? `playwright exited with code ${code}; see its output above (and ${raw.replace(/\\/g, "/")})` }),
};
process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
process.exit(passed ? 0 : 1);
