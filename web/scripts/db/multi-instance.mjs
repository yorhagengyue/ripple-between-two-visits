#!/usr/bin/env node
/**
 * Multi-instance check for STORE=supabase (live; needs STORE_LIVE=1 and the Supabase keys in web/.env).
 *
 *   cd web && STORE_LIVE=1 node scripts/db/multi-instance.mjs            build, then check
 *   cd web && STORE_LIVE=1 node scripts/db/multi-instance.mjs --no-build use the existing .next build
 *
 * 1. Takes the shared lock web/.e2e-lock (mkdir; waits 20 s at a time up to 30 min; a lock older than
 *    40 min is stale and taken over) and releases it at the end, also on failure or Ctrl+C.
 * 2. `next build` once (retried twice, a minute apart, if another builder's half-written file breaks it).
 * 3. Starts two `next start` processes on the same database: A on 3203 (BUS_STREAM_MAX_MS=4000, so its event
 *    streams end every 4 s like a serverless function timeout) and B on 3213, both STORE=supabase.
 * 4. Runs e2e/supa-multi-instance.spec.ts with PW_PORT=3203 (Playwright reuses A, starts no dev server):
 *    a dose tick posted to A reaches an EventSource on B within 2 s; B's /p/today shows it within 2 s; a stream
 *    on A that keeps ending loses none of 10 ticks posted to B.
 * 5. Restart: creates a session on B, stops B, starts it again, reads the session (cookie) and its doses back,
 *    unchanged, from the new process and from A. Every call sends the cookies its POST /api/session set (the
 *    sandbox's own device), as a browser does: a call with no device at all is refused (403 member_required).
 * 6. Deletes every session it created, stops both processes, prints the row counts of every table.
 *
 * Server logs go to a temp folder (printed). Nothing here prints a key, the database URL or a host.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, loadEnv, safeError, WEB } from "./env.mjs";

const LOCK = path.join(WEB, ".e2e-lock");
const LABEL = "supabase adapter: multi-instance check (scripts/db/multi-instance.mjs)";
const PORT_A = 3203;
const PORT_B = 3213;
const A = `http://localhost:${PORT_A}`;
const B = `http://localhost:${PORT_B}`;
const NEXT_BIN = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
const PW_CLI = path.join(WEB, "node_modules", "@playwright", "test", "cli.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noBuild = process.argv.includes("--no-build");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ripple-supa-"));
const children = new Map(); // name -> child process
let lockHeld = false;
const createdSessions = [];
const results = [];

function step(ok, name, detail = "") {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ------------------------------------------------------------------ lock

async function acquireLock() {
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(path.join(LOCK, "owner.txt"), `${LABEL}\npid ${process.pid}\nsince ${new Date().toISOString()}\n`, "utf8");
      lockHeld = true;
      console.log("lock: web/.e2e-lock taken");
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    let ageMs = 0;
    let owner = "unknown owner";
    try {
      const ownerFile = path.join(LOCK, "owner.txt");
      const stamp = existsSync(ownerFile) ? statSync(ownerFile).mtimeMs : statSync(LOCK).mtimeMs;
      ageMs = Date.now() - stamp;
      if (existsSync(ownerFile)) owner = readFileSync(ownerFile, "utf8").split("\n")[0].slice(0, 120);
    } catch {
      continue; // released between the two calls
    }
    if (ageMs > 40 * 60_000) {
      console.log(`lock: stale (${Math.round(ageMs / 60_000)} min, ${owner}); taking it over`);
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    if (Date.now() - started > 30 * 60_000) throw new Error("waited 30 minutes for web/.e2e-lock");
    console.log(`lock: held by "${owner}" for ${Math.round(ageMs / 1000)} s; retrying in 20 s`);
    await sleep(20_000);
  }
}

function releaseLock() {
  if (!lockHeld) return;
  rmSync(LOCK, { recursive: true, force: true });
  lockHeld = false;
  console.log("lock: web/.e2e-lock released");
}

// ------------------------------------------------------------------ processes

async function up(base) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function waitFor(check, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

function startInstance(name, port, extraEnv = {}) {
  const log = path.join(tmp, `${name}-${port}.log`);
  const fd = openSync(log, "a");
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port)], {
    cwd: WEB,
    // C2 track L: RIPPLE_DEV_TOOLS=1 because the spec drives these instances with Playwright's request helpers, which
    // send neither Origin nor Sec-Fetch-Site; only a developer build takes such a write (lib/guard/request.ts)
    env: { ...process.env, STORE: "supabase", RIPPLE_DEV_TOOLS: "1", ...extraEnv },
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  children.set(name, child);
  return child;
}

async function startAndWait(name, port, extraEnv) {
  startInstance(name, port, extraEnv);
  await waitFor(async () => (await up(`http://localhost:${port}`))?.store === "supabase", 90_000, `${name} on ${port} (STORE=supabase)`);
  console.log(`${name}: next start on ${port}, STORE=supabase`);
}

async function stopInstance(name, port) {
  const child = children.get(name);
  children.delete(name);
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  await waitFor(async () => !(await up(`http://localhost:${port}`)), 30_000, `port ${port} to be free`);
}

function stopAllSync() {
  for (const child of children.values()) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  }
  children.clear();
}

function run(cmd, args, env = process.env) {
  return spawnSync(cmd, args, { cwd: WEB, stdio: "inherit", env, windowsHide: true }).status ?? 1;
}

// ------------------------------------------------------------------ checks

/** The cookies a response set, as the Cookie header a browser sends back: name=value pairs, attributes dropped. */
function cookiesFrom(res) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0].trim())
    .filter((pair) => pair.includes("="))
    .join("; ");
}

/** A call as this script's device (its cookies); the JSON answer, or an error naming the call and its status. */
async function asDevice(url, cookie, init = {}) {
  // C2 track L: a script names the site it acts on, as a browser's Origin does (lib/guard/request.ts)
  const res = await fetch(url, { ...init, headers: { origin: new URL(url).origin, ...init.headers, cookie } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${new URL(url).pathname} on ${new URL(url).port}: HTTP ${res.status}`);
  return res.json();
}

async function restartCheck() {
  const res = await fetch(`${B}/api/session`, { method: "POST", headers: { "content-type": "application/json", origin: B }, body: "{}" });
  if (res.status !== 201) throw new Error(`POST /api/session on B: HTTP ${res.status}`);
  const { session } = await res.json();
  createdSessions.push(session.id);
  // This script's own device: the cookies POST /api/session set (rp_session, rp_member, rp_role: the sandbox's judge
  // row), sent back on every call as a browser does. A call that presents no device at all is refused (403
  // member_required, lib/family/gate.ts), so a bare ?session= call would only read the error.
  const cookie = cookiesFrom(res);
  if (!cookie.includes("rp_member=")) throw new Error("POST /api/session on B set no device cookie (rp_member)");
  const doses = `/api/doses?session=${session.id}`;
  const dosesBefore = await asDevice(`${B}${doses}`, cookie);
  await asDevice(`${B}${doses}`, cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ medication_id: "med-amlodipine", slot: "morning", state: "taken", day: 15 }),
  });
  const dosesTicked = await asDevice(`${B}${doses}`, cookie);

  await stopInstance("B", PORT_B);
  console.log("B: stopped");
  await startAndWait("B", PORT_B);

  const again = await fetch(`${B}/api/session`, { headers: { cookie } });
  const body = again.status === 200 ? await again.json() : null;
  const same = body && body.session.id === session.id && body.session.join_code === session.join_code && body.session.created_at === session.created_at;
  step(Boolean(same), "session survives a restart of the process (cookie read on the new B)", `HTTP ${again.status}`);
  const dosesAfter = await asDevice(`${B}${doses}`, cookie);
  step(JSON.stringify(dosesAfter) === JSON.stringify(dosesTicked), "its dose log is unchanged after the restart", `${dosesAfter.doses?.length} rows`);
  step(
    JSON.stringify(dosesTicked) !== JSON.stringify(dosesBefore),
    "the tick written before the restart is there",
    "D15 morning amlodipine taken",
  );
  const viaA = await fetch(`${A}/api/session`, { headers: { cookie } });
  step(viaA.status === 200, "the other instance reads the same session", `HTTP ${viaA.status}`);
}

async function deleteSessions(ids) {
  if (!ids.length) return;
  const client = await connect();
  try {
    const r = await client.query("delete from public.session where id = any($1::text[])", [ids]);
    console.log(`cleanup: deleted ${r.rowCount} session(s) this script created`);
  } finally {
    await client.end().catch(() => {});
  }
}

// ------------------------------------------------------------------ main

async function main() {
  if (process.env.STORE_LIVE !== "1") {
    console.log("STORE_LIVE is not 1: nothing to do (this check talks to the real Supabase project)");
    return;
  }
  loadEnv();
  if (!(process.env.SUPABASE_URL ?? "").trim() || !(process.env.SUPABASE_SERVICE_KEY ?? "").trim()) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set (web/.env)");
  }
  console.log(`logs: ${tmp}`);
  if (run(process.execPath, [path.join(WEB, "scripts", "db", "migrate.mjs"), "--status"]) !== 0) throw new Error("migration status failed");

  await acquireLock();
  for (const [base, port] of [[A, PORT_A], [B, PORT_B]]) {
    if (await up(base)) throw new Error(`port ${port} is already in use; stop that server first`);
  }

  if (!noBuild) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      console.log(`build: next build (attempt ${attempt})`);
      ok = run(process.execPath, [NEXT_BIN, "build"]) === 0;
      if (!ok && attempt < 3) {
        console.log("build failed; waiting 60 s (another builder may be mid-edit)");
        await sleep(60_000);
      }
    }
    if (!ok) throw new Error("next build failed three times");
    step(true, "next build");
  }

  await startAndWait("A", PORT_A, { BUS_STREAM_MAX_MS: "4000" });
  await startAndWait("B", PORT_B);

  const pwOut = path.join(tmp, "playwright");
  const pw = run(
    process.execPath,
    [PW_CLI, "test", "e2e/supa-multi-instance.spec.ts", "--output", pwOut, "--reporter", "list"],
    { ...process.env, PW_PORT: String(PORT_A), STORE_LIVE: "1", SUPA_A_URL: A, SUPA_B_URL: B },
  );
  step(pw === 0, "e2e/supa-multi-instance.spec.ts (A -> EventSource on B within 2 s; /p/today on B; stream timeouts lose nothing)", `exit ${pw}`);

  await restartCheck();
}

async function finish(code) {
  try {
    await deleteSessions(createdSessions);
  } catch (err) {
    console.error(`cleanup failed: ${safeError(err)}`);
    code = 1;
  }
  stopAllSync();
  await sleep(1000);
  releaseLock();
  // C2 track H: inspect.mjs counts rows only with who and why (they go to service_read_log)
  if (process.env.STORE_LIVE === "1") {
    run(process.execPath, [path.join(WEB, "scripts", "db", "inspect.mjs"), "--counts", "--actor", "multi-instance.mjs", "--reason", "row counts left in the test database after the multi-instance check"]);
  }
  const failed = results.filter((r) => !r.ok);
  if (results.length) console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length || code ? 1 : 0);
}

process.on("SIGINT", () => {
  console.log("interrupted");
  stopAllSync();
  releaseLock();
  process.exit(130);
});

main()
  .then(() => finish(0))
  .catch(async (err) => {
    console.error(`multi-instance: ${safeError(err)}`);
    await finish(1);
  });
