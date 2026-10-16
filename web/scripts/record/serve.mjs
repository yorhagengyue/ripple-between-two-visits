#!/usr/bin/env node
/**
 * Serve the app for journey recordings: a production build (`next build` + `next start`; `next dev` falls into
 * reload loops under Playwright) with RIPPLE_DEV_TOOLS=1, so the foundation's dev tools (test clock, dev accounts,
 * devfake transcription) answer on the production build.
 *
 *   node scripts/record/serve.mjs [--port 3430] [--host 127.0.0.1] [--build] [--detach | --stop] [--no-offline]
 *
 *   --port        default 3430
 *   --host        passed to `next start -H` (default: Next's own, every interface)
 *   --build       run `next build` first (needed after code changes; .next is per checkout)
 *   --detach      start in the background, log to <JOURNEY_REC_DIR>/serve-<port>.log, wait until it answers, print
 *                 { url, pid, log } and exit; stop it later with --stop. Without --detach it runs in this terminal.
 *   --stop        stop the server a --detach started on that port
 *   --no-offline  keep the providers from web/.env (the integration server); by default every provider is offline:
 *                 STORE=memory AUTH_PROVIDER=memory LLM_PROVIDER=mock CHECKER_PROVIDER=mock SPEECH_PROVIDER=mock
 *                 TTS_PROVIDER=mock BLOB_DRIVER=local (a variable already set in the environment wins, e.g.
 *                 SPEECH_PROVIDER=devfake or BLOB_LOCAL_DIR=D:/ripple-c2/blob/<line>)
 *
 * Agents: a server started from an agent's shell can die with the session; on Windows start this script itself with
 * PowerShell Start-Process (see e2e/journeys/README.md), or use --detach.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REC = process.env.JOURNEY_REC_DIR?.trim() || (process.platform === "win32" ? "D:/ripple-c2/rec" : path.join(os.tmpdir(), "ripple-c2", "rec"));
const NEXT = path.join(WEB, "node_modules", "next", "dist", "bin", "next");

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${f}=`));
  return eq ? eq.slice(f.length + 1) : d;
};
if (flag("-h") || flag("--help")) {
  process.stderr.write("usage: node scripts/record/serve.mjs [--port 3430] [--host 127.0.0.1] [--build] [--detach | --stop] [--no-offline]\n");
  process.exit(0);
}
const port = Number(opt("--port", "3430"));
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write(`bad --port ${opt("--port")}\n`);
  process.exit(2);
}
const url = `http://localhost:${port}`;
const pidFile = path.join(REC, `serve-${port}.pid`);
const logFile = path.join(REC, `serve-${port}.log`);

/** Any HTTP answer from the port counts (plain http.get: fetch's pooled sockets trip Node on Windows at process.exit). */
function answers() {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false, timeout: 3000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

if (flag("--stop")) {
  if (!existsSync(pidFile)) {
    process.stderr.write(`no ${pidFile}: nothing started with --detach on port ${port}\n`);
    process.exit(1);
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
  rmSync(pidFile, { force: true });
  process.stdout.write(`${JSON.stringify({ stopped: pid, port })}\n`);
  process.exit(0);
}

if (await answers()) {
  process.stderr.write(`something already answers at ${url}; stop it first (or use another --port)\n`);
  process.exit(1);
}

const env = { ...process.env, RIPPLE_DEV_TOOLS: "1", NEXT_TELEMETRY_DISABLED: "1" };
if (!flag("--no-offline")) {
  const offline = {
    STORE: "memory",
    AUTH_PROVIDER: "memory",
    LLM_PROVIDER: "mock",
    CHECKER_PROVIDER: "mock",
    SPEECH_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    BLOB_DRIVER: "local",
    BLOB_LOCAL_DIR: path.join(path.dirname(REC), "blob", `rec-${port}`),
  };
  for (const [k, v] of Object.entries(offline)) if (!process.env[k]?.trim()) env[k] = v;
}

if (flag("--build")) {
  process.stderr.write(`next build in ${WEB}\n`);
  const b = spawnSync(process.execPath, [NEXT, "build"], { cwd: WEB, env, stdio: ["ignore", 2, 2] });
  if (b.status !== 0) {
    process.stderr.write(`next build failed (${b.status})\n`);
    process.exit(1);
  }
}
if (!existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
  process.stderr.write(`no production build in ${path.join(WEB, ".next")}: add --build\n`);
  process.exit(1);
}

const host = opt("--host", "");
const startArgs = [NEXT, "start", "-p", String(port), ...(host ? ["-H", host] : [])];
if (flag("--detach")) {
  mkdirSync(REC, { recursive: true });
  const fd = openSync(logFile, "a");
  const child = spawn(process.execPath, startArgs, { cwd: WEB, env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  closeSync(fd);
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  for (let i = 0; i < 120 && !(await answers()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await answers())) {
    process.stderr.write(`the server did not answer within 60 s; see ${logFile}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ url, pid: child.pid, log: logFile.replace(/\\/g, "/"), devTools: true, offline: !flag("--no-offline") })}\n`);
  process.exit(0);
}

const child = spawn(process.execPath, startArgs, { cwd: WEB, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("close", (code) => process.exit(code ?? 0));
