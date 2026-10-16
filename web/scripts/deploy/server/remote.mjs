/**
 * What the deploy scripts do ON the server (C2 track P; docs/plan/hosting.md 5.7, 5.10, 10). One file, no imports
 * outside Node: the local scripts send it through ssh's standard input and run it as root with
 *
 *   sudo -n /usr/local/bin/node --input-type=module - <operation> [arguments]
 *
 * so the server never keeps a copy that could fall behind the checkout. Operations:
 *
 *   env-apply [no-restart]     put the staged /etc/ripple/web.env.new in place (the old one becomes web.env.prev),
 *                              restart the app, compare /api/health with the staged expectation; on a difference put
 *                              the previous file back and restart again. With no-restart (a change of the code and the
 *                              environment together: the running version could not report the new expectation) the
 *                              files are put in place and nothing is restarted: the next release restarts and compares
 *   env-restore                swap web.env with web.env.prev, restart, compare
 *   secrets-apply <parts>      parts: edge, backup. Put the staged edge.env / backup.env / backup.age.pub in place
 *                              (each old one becomes .prev); for edge restart Caddy and check it is running
 *   secrets-restore <parts>    swap each with its .prev; for edge restart Caddy
 *   release <id> <tarball>     unpack as the service user, npm ci and next build as that user, switch, restart, check
 *                              health and the build id; on any failure switch back by itself; keep five versions
 *   rollback [<id>]            switch to the version before the current one (or the named one), restart, check;
 *                              on failure switch back. Never touches the database.
 *   status                     read-only: version, services, recent errors, disk, memory, certificate, backups.
 *                              Never opens an environment file.
 *
 * Nothing here prints a file's contents or an environment variable's value. The last line of every operation is
 * RIPPLE_RESULT {json} for the local script. Exit code 0: done; 3: failed and put back as it was; 4: failed, nothing
 * to put back; 2: refused before changing anything.
 *
 * The functions take a `sys` (commands, files, time, the local health request): the unit tests hand in a fake one.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const HEALTH_URL = "http://127.0.0.1:3200/api/health";
export const KEEP_RELEASES = 5;
export const RELEASE_ID = /^\d{8}T\d{6}-[0-9a-f]{7,40}$/;

export function paths(root = "") {
  return {
    webEnv: `${root}/etc/ripple/web.env`,
    webExpect: `${root}/etc/ripple/web.expect.json`,
    edgeEnv: `${root}/etc/caddy/edge.env`,
    backupEnv: `${root}/etc/ripple/backup.env`,
    backupPub: `${root}/etc/ripple/backup.age.pub`,
    releases: `${root}/srv/ripple/releases`,
    current: `${root}/srv/ripple/current`,
    shared: `${root}/srv/ripple/shared`,
    backupState: `${root}/var/lib/ripple-backup`,
    caddyCerts: `${root}/var/lib/caddy/.local/share/caddy/certificates`,
    rebootFlag: `${root}/var/run/reboot-required`,
  };
}

export class Refused extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

/** The real machine. */
export function realSys() {
  return {
    run(bin, args, opts = {}) {
      const r = spawnSync(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024 });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.code ?? "error") : "") };
    },
    /** a long command (the build): not blocking, so memory can be sampled while it runs */
    runLong(bin, args, opts = {}) {
      return new Promise((resolve) => {
        const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
        let tail = "";
        const keep = (c) => {
          tail = (tail + c).slice(-6000);
        };
        child.stdout.setEncoding("utf8").on("data", keep);
        child.stderr.setEncoding("utf8").on("data", keep);
        child.on("error", () => resolve({ code: 127, tail }));
        child.on("close", (code) => resolve({ code: code ?? 1, tail }));
      });
    },
    exists: (p) => fs.existsSync(p),
    read: (p) => fs.readFileSync(p, "utf8"),
    list: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []),
    stat(p) {
      const s = fs.statSync(p);
      return { mode: (s.mode & 0o777).toString(8).padStart(4, "0"), bytes: s.size, modified: s.mtime.toISOString() };
    },
    /** a copy with the same owner and mode (cp -p) */
    copy(src, dst) {
      const s = fs.statSync(src);
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, s.mode & 0o777);
      try {
        fs.chownSync(dst, s.uid, s.gid);
      } catch {
        // not root (never on the server)
      }
    },
    rename: (a, b) => fs.renameSync(a, b),
    remove: (p) => fs.rmSync(p, { recursive: true, force: true }),
    /** where a symbolic link points, or null */
    linkTarget(p) {
      try {
        return fs.readlinkSync(p);
      } catch {
        return null;
      }
    },
    /** point the link at the target in one step (a new link renamed over the old one) */
    pointLink(link, target) {
      const tmp = `${link}.new`;
      fs.rmSync(tmp, { force: true });
      fs.symlinkSync(target, tmp);
      fs.renameSync(tmp, link);
    },
    memUsedMb() {
      try {
        const info = Object.fromEntries(
          fs
            .readFileSync("/proc/meminfo", "utf8")
            .split("\n")
            .map((l) => /^(\w+):\s+(\d+)/.exec(l))
            .filter(Boolean)
            .map((m) => [m[1], Number(m[2])]),
        );
        return { ram: Math.round((info.MemTotal - info.MemAvailable) / 1024), swap: Math.round((info.SwapTotal - info.SwapFree) / 1024) };
      } catch {
        return null;
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    /** GET the app's own health on the loopback address: { status, body } or null when nothing answers */
    getHealth(timeoutMs = 5000) {
      return new Promise((resolve) => {
        const req = http.get(HEALTH_URL, { agent: false, timeout: timeoutMs }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: null });
            }
          });
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(null));
      });
    },
    say: (line) => console.log(line),
  };
}

// ------------------------------------------------------------------ health

const show = (v) => (v === null ? "null" : v === undefined ? "nothing" : String(v));

/**
 * How a health answer differs from what was pushed (empty: it matches). Values in a health answer are provider names
 * and true / false, so the sentences are safe to print.
 */
export function compareHealth(got, expect, build) {
  const diffs = [];
  if (!got || got.ok !== true) diffs.push("ok is not true");
  for (const [key, want] of Object.entries(expect ?? {})) {
    if ((got ?? {})[key] !== want) diffs.push(`${key}: pushed ${show(want)}, running ${show((got ?? {})[key])}`);
  }
  if (build && (got ?? {}).build !== build) diffs.push("build: the server is not running the build that was just made");
  return diffs;
}

function readExpect(sys, file) {
  if (!sys.exists(file)) return null;
  try {
    return JSON.parse(sys.read(file));
  } catch {
    return null;
  }
}

/**
 * Wait for the app to answer and compare. Nothing answering yet is waited for (the process is starting); an answer
 * that differs is final at once: waiting does not change a configuration.
 * @param {any} sys
 * @param {{ expect?: any, build?: string | null, timeoutMs?: number, everyMs?: number }} opts
 */
export async function waitHealthy(sys, { expect, build, timeoutMs = 60_000, everyMs = 2000 }) {
  const until = sys.now() + timeoutMs;
  let answered = false;
  for (;;) {
    const res = await sys.getHealth();
    if (res && res.status === 200 && res.body) {
      answered = true;
      const diffs = compareHealth(res.body, expect, build);
      return { ok: diffs.length === 0, diffs, answered };
    }
    if (sys.now() >= until) return { ok: false, diffs: [answered ? "the health route stopped answering" : `nothing answered on the app's port within ${Math.round(timeoutMs / 1000)} s`], answered };
    await sys.sleep(everyMs);
  }
}

function restart(sys, unit) {
  return sys.run("systemctl", ["restart", unit], { timeoutMs: 90_000 }).code === 0;
}

// ------------------------------------------------------------------ files with a previous copy

/** Put file.new in place; the file that was there becomes file.prev. Returns whether there was one. */
function promote(sys, file) {
  const had = sys.exists(file);
  if (had) sys.copy(file, `${file}.prev`);
  sys.rename(`${file}.new`, file);
  return had;
}

/** Swap a file with its .prev (so restoring is itself undone by restoring again). */
function swapPrev(sys, file) {
  if (!sys.exists(`${file}.prev`)) return false;
  if (sys.exists(file)) {
    sys.rename(file, `${file}.swap`);
    sys.rename(`${file}.prev`, file);
    sys.rename(`${file}.swap`, `${file}.prev`);
  } else sys.rename(`${file}.prev`, file);
  return true;
}

export async function envApply(sys, P, opts = {}) {
  if (!sys.exists(`${P.webEnv}.new`)) throw new Refused("no staged environment file on the server (web.env.new): nothing was changed");
  const hadPrev = promote(sys, P.webEnv);
  // null: no expectation came with this file; true / false: whether there was one before it
  const hadExpect = sys.exists(`${P.webExpect}.new`) ? promote(sys, P.webExpect) : null;
  sys.say(`web.env: in place${hadPrev ? " (the one before is web.env.prev)" : " (first one; nothing before it)"}`);
  if (opts.noRestart) {
    sys.say("not restarted (no-restart): the running app keeps the environment it started with; the next release restarts with this file and compares; push-env --restore-prev puts the one before back");
    return { code: 0, result: { op: "env-apply", status: "staged", restarted: false, noRestart: true } };
  }
  if (!sys.linkTarget(P.current)) {
    sys.say("no release is installed yet: the app was not restarted and nothing could be compared; the first release checks this file");
    return { code: 0, result: { op: "env-apply", status: "staged", restarted: false } };
  }
  const started = restart(sys, "ripple-web");
  const check = started ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), timeoutMs: opts.timeoutMs }) : { ok: false, diffs: ["systemctl restart ripple-web failed"], answered: false };
  if (check.ok) {
    sys.say("restarted; the running app reports what was pushed");
    return { code: 0, result: { op: "env-apply", status: "ok", restarted: true } };
  }
  for (const d of check.diffs) sys.say(`DIFFERS  ${d}`);
  if (!hadPrev) {
    sys.say("there is no previous environment file to put back: the new file stays; fix the deploy file and push again");
    return { code: 4, result: { op: "env-apply", status: "failed_no_previous", diffs: check.diffs } };
  }
  swapPrev(sys, P.webEnv);
  sys.remove(`${P.webEnv}.prev`); // the rejected file: the deploy file on the owner's computer is the source
  // the expectation goes back with the file it describes
  if (hadExpect === true) {
    swapPrev(sys, P.webExpect);
    sys.remove(`${P.webExpect}.prev`);
  } else if (hadExpect === false) sys.remove(P.webExpect);
  const back = restart(sys, "ripple-web") ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), timeoutMs: opts.timeoutMs }) : { ok: false };
  sys.say(`the previous environment file is back in place and the app was restarted (${back.ok ? "it reports what that file says" : "it does NOT report healthy: look at status"})`);
  return { code: 3, result: { op: "env-apply", status: "restored", diffs: check.diffs, restored_healthy: back.ok === true } };
}

export async function envRestore(sys, P, opts = {}) {
  if (!sys.exists(`${P.webEnv}.prev`)) throw new Refused("there is no web.env.prev on the server: nothing to restore");
  swapPrev(sys, P.webEnv);
  swapPrev(sys, P.webExpect);
  sys.say("web.env: the previous file is in place (the one it replaced is now web.env.prev)");
  if (!sys.linkTarget(P.current)) return { code: 0, result: { op: "env-restore", status: "staged", restarted: false } };
  const check = restart(sys, "ripple-web") ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), timeoutMs: opts.timeoutMs }) : { ok: false, diffs: ["systemctl restart ripple-web failed"] };
  for (const d of check.diffs ?? []) sys.say(`DIFFERS  ${d}`);
  sys.say(check.ok ? "restarted; the running app reports what the restored file says" : "restarted, but the app does not report what the restored file says");
  return { code: check.ok ? 0 : 4, result: { op: "env-restore", status: check.ok ? "ok" : "unhealthy", diffs: check.diffs ?? [] } };
}

function partsOf(args) {
  const parts = args.filter((a) => a === "edge" || a === "backup");
  if (!parts.length || parts.length !== args.length) throw new Refused("say which secrets: edge, backup or both");
  return parts;
}

function caddyRunning(sys) {
  return sys.run("systemctl", ["is-active", "caddy"]).stdout.trim() === "active";
}

export async function secretsApply(sys, P, args) {
  const parts = partsOf(args);
  const files = [...(parts.includes("edge") ? [P.edgeEnv] : []), ...(parts.includes("backup") ? [P.backupEnv, P.backupPub] : [])];
  const missing = files.filter((f) => !sys.exists(`${f}.new`));
  if (missing.length) throw new Refused(`not staged on the server: ${missing.map((f) => `${path.basename(f)}.new`).join(", ")}; nothing was changed`);
  let hadEdge = false;
  for (const f of files) {
    const had = promote(sys, f);
    if (f === P.edgeEnv) hadEdge = had;
    sys.say(`${path.basename(f)}: in place${had ? ` (the one before is ${path.basename(f)}.prev)` : ""}`);
  }
  if (!parts.includes("edge")) return { code: 0, result: { op: "secrets-apply", status: "ok", parts } };
  restart(sys, "caddy");
  if (caddyRunning(sys)) {
    sys.say("Caddy restarted and is running with the new origin lock");
    return { code: 0, result: { op: "secrets-apply", status: "ok", parts, caddy: "active" } };
  }
  if (!hadEdge) {
    sys.say("Caddy is not running after the restart and there is no previous edge.env to put back (journalctl -u caddy says why)");
    return { code: 4, result: { op: "secrets-apply", status: "failed_no_previous", parts, caddy: "inactive" } };
  }
  swapPrev(sys, P.edgeEnv);
  sys.remove(`${P.edgeEnv}.prev`);
  restart(sys, "caddy");
  const back = caddyRunning(sys);
  sys.say(`Caddy did not come up with the new edge.env: the previous one is back in place (Caddy is ${back ? "running" : "NOT running"})`);
  return { code: 3, result: { op: "secrets-apply", status: "restored", parts, caddy: back ? "active" : "inactive" } };
}

export async function secretsRestore(sys, P, args) {
  const parts = partsOf(args);
  const files = [...(parts.includes("edge") ? [P.edgeEnv] : []), ...(parts.includes("backup") ? [P.backupEnv, P.backupPub] : [])];
  const restored = files.filter((f) => swapPrev(sys, f)).map((f) => path.basename(f));
  if (!restored.length) throw new Refused("no .prev copy of those files on the server: nothing to restore");
  sys.say(`restored from .prev: ${restored.join(", ")}`);
  let caddy;
  if (restored.includes(path.basename(P.edgeEnv))) {
    restart(sys, "caddy");
    caddy = caddyRunning(sys) ? "active" : "inactive";
    sys.say(`Caddy restarted: ${caddy}`);
  }
  return { code: caddy === "inactive" ? 4 : 0, result: { op: "secrets-restore", status: caddy === "inactive" ? "unhealthy" : "ok", restored, caddy } };
}

// ------------------------------------------------------------------ releases

const BUILD_ENV_KEEP = ["PATH", "LANG", "LC_ALL", "TZ"];

function releaseIds(sys, P) {
  return sys
    .list(P.releases)
    .filter((n) => RELEASE_ID.test(n))
    .sort();
}

function currentId(sys, P) {
  const target = sys.linkTarget(P.current);
  return target ? path.basename(target) : null;
}

function buildIdOf(sys, dir) {
  const file = `${dir}/.next/BUILD_ID`;
  return sys.exists(file) ? sys.read(file).trim() : null;
}

/** Which release folders go: all but the newest `keep`, and never the one `current` points at. */
export function toPrune(ids, current, keep = KEEP_RELEASES) {
  const sorted = [...ids].sort();
  const kept = new Set(sorted.slice(-keep));
  if (current) kept.add(current);
  return sorted.filter((id) => !kept.has(id));
}

export async function release(sys, P, args, opts = {}) {
  const [id, tarball] = args;
  if (!id || !RELEASE_ID.test(id)) throw new Refused("the release name must look like 20261016T093000-<commit>");
  if (!tarball || !sys.exists(tarball)) throw new Refused("the uploaded archive is not on the server");
  const dir = `${P.releases}/${id}`;
  if (sys.exists(dir)) throw new Refused("a release with this name is already on the server");
  if (!sys.exists(P.webEnv)) throw new Refused("the server has no /etc/ripple/web.env yet: run push-env first (the app cannot start without it)");

  // the service user owns the folder: next start writes .next/cache, and ProtectSystem=strict lets it write nowhere else
  const asRipple = (argv, o = {}) => ["runuser", ["-u", "ripple", "--", ...argv], o];
  const env = Object.fromEntries(BUILD_ENV_KEEP.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  // no NODE_ENV: with NODE_ENV=production npm would skip the dev dependencies next build needs (tailwindcss, typescript)
  const buildEnv = { ...env, PATH: `/usr/local/bin:${env.PATH ?? "/usr/bin:/bin"}`, HOME: P.shared, npm_config_cache: `${P.shared}/npm-cache`, NEXT_TELEMETRY_DISABLED: "1" };

  const fail = (message, code = 4) => {
    sys.remove(dir);
    sys.remove(tarball);
    sys.say(message);
    return { code, result: { op: "release", status: "failed", release: id, stage: message.split(":")[0] } };
  };

  if (sys.run("install", ["-d", "-o", "ripple", "-g", "ripple", "-m", "0755", dir]).code !== 0) return fail("unpack: could not create the release folder");
  if (sys.run(...asRipple(["tar", "-xzf", tarball, "-C", dir])).code !== 0) return fail("unpack: the archive could not be unpacked");
  // an archive that is not the web folder (an empty one unpacks without an error) must not reach npm
  if (!sys.exists(`${dir}/package.json`) || !sys.exists(`${dir}/package-lock.json`)) return fail("unpack: the archive has no package.json and package-lock.json at its top, so it is not the app's web folder; the running version was not touched");
  sys.remove(tarball);

  let peak = { ram: 0, swap: 0 };
  const sample = () => {
    const m = sys.memUsedMb();
    if (m) peak = { ram: Math.max(peak.ram, m.ram), swap: Math.max(peak.swap, m.swap) };
  };
  sample();
  const timer = opts.noSampling ? null : setInterval(sample, 1000);
  const started = sys.now();
  let built;
  try {
    const ci = await sys.runLong(...asRipple(["npm", "ci", "--no-audit", "--no-fund"], { cwd: dir, env: buildEnv }));
    if (ci.code !== 0) {
      sys.say(ci.tail.split("\n").slice(-15).join("\n"));
      return fail("install: npm ci failed; the running version was not touched");
    }
    built = await sys.runLong(...asRipple(["/usr/local/bin/node", "node_modules/next/dist/bin/next", "build"], { cwd: dir, env: buildEnv }));
  } finally {
    if (timer) clearInterval(timer);
    sample();
  }
  if (built.code !== 0) {
    sys.say(built.tail.split("\n").slice(-25).join("\n"));
    return fail("build: next build failed; the running version was not touched");
  }
  const build = buildIdOf(sys, dir);
  if (!build) return fail("build: next build left no .next/BUILD_ID; the running version was not touched");
  const buildSeconds = Math.round((sys.now() - started) / 1000);
  sys.say(`built in ${buildSeconds} s; peak memory in use during the build ${peak.ram} MB, swap ${peak.swap} MB`);

  const previous = currentId(sys, P);
  sys.pointLink(P.current, dir);
  const check = restart(sys, "ripple-web") ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), build, timeoutMs: opts.timeoutMs }) : { ok: false, diffs: ["systemctl restart ripple-web failed"] };
  if (!check.ok) {
    for (const d of check.diffs) sys.say(`DIFFERS  ${d}`);
    if (previous) {
      sys.pointLink(P.current, `${P.releases}/${previous}`);
      const back = restart(sys, "ripple-web") ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), build: buildIdOf(sys, `${P.releases}/${previous}`), timeoutMs: opts.timeoutMs }) : { ok: false };
      sys.remove(dir);
      sys.say(`the new version did not pass its health check: switched back to ${previous} (${back.ok ? "it is healthy" : "it does NOT report healthy: look at status"})`);
      return { code: 3, result: { op: "release", status: "switched_back", release: id, current: previous, diffs: check.diffs, previous_healthy: back.ok === true } };
    }
    sys.run("systemctl", ["stop", "ripple-web"]);
    sys.say("the first version did not pass its health check and there is no version to switch back to: the app is stopped, the release folder is kept for looking at (journalctl -u ripple-web)");
    return { code: 4, result: { op: "release", status: "failed_no_previous", release: id, diffs: check.diffs } };
  }

  const pruned = toPrune(releaseIds(sys, P), id);
  for (const old of pruned) sys.remove(`${P.releases}/${old}`);
  sys.say(`running ${id} (build ${build}); kept ${releaseIds(sys, P).length} version(s), removed ${pruned.length}`);
  return { code: 0, result: { op: "release", status: "ok", release: id, previous, build, build_seconds: buildSeconds, peak_ram_mb: peak.ram, peak_swap_mb: peak.swap, removed: pruned } };
}

/** The version a rollback goes to: the named one, or the newest one older than the current. */
export function rollbackTarget(ids, current, wanted) {
  if (wanted) return ids.includes(wanted) && wanted !== current ? wanted : null;
  const older = [...ids].sort().filter((id) => !current || id < current);
  return older.length ? older[older.length - 1] : null;
}

export async function rollback(sys, P, args, opts = {}) {
  const wanted = args[0];
  if (wanted && !RELEASE_ID.test(wanted)) throw new Refused("that is not a release name");
  const ids = releaseIds(sys, P);
  const current = currentId(sys, P);
  sys.say(`versions on the server: ${ids.map((id) => (id === current ? `${id} (current)` : id)).join(", ") || "none"}`);
  const target = rollbackTarget(ids, current, wanted);
  if (!target) throw new Refused(wanted ? "that version is not on the server, or it is the one running" : "there is no older version on the server to go back to");
  sys.pointLink(P.current, `${P.releases}/${target}`);
  const check = restart(sys, "ripple-web") ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), build: buildIdOf(sys, `${P.releases}/${target}`), timeoutMs: opts.timeoutMs }) : { ok: false, diffs: ["systemctl restart ripple-web failed"] };
  if (check.ok) {
    sys.say(`running ${target}; the database was not touched`);
    return { code: 0, result: { op: "rollback", status: "ok", release: target, previous: current } };
  }
  for (const d of check.diffs) sys.say(`DIFFERS  ${d}`);
  if (current) {
    sys.pointLink(P.current, `${P.releases}/${current}`);
    const back = restart(sys, "ripple-web") ? await waitHealthy(sys, { expect: readExpect(sys, P.webExpect), build: buildIdOf(sys, `${P.releases}/${current}`), timeoutMs: opts.timeoutMs }) : { ok: false };
    sys.say(`${target} did not pass its health check: back on ${current} (${back.ok ? "it is healthy" : "it does NOT report healthy"})`);
    return { code: 3, result: { op: "rollback", status: "switched_back", release: current, diffs: check.diffs } };
  }
  return { code: 4, result: { op: "rollback", status: "unhealthy", release: target, diffs: check.diffs } };
}

// ------------------------------------------------------------------ status (read-only)

function certFiles(sys, dir, depth = 0) {
  if (depth > 4) return [];
  const out = [];
  for (const name of sys.list(dir)) {
    const p = `${dir}/${name}`;
    if (name.endsWith(".crt")) out.push(p);
    else if (!name.includes(".") || depth < 2) out.push(...certFiles(sys, p, depth + 1));
  }
  return out;
}

function backupLine(sys, file, label) {
  if (!sys.exists(file)) return `${label}: never ran`;
  try {
    const j = JSON.parse(sys.read(file));
    const bits = [j.status, j.at, j.db?.object && `${j.db.object} ${j.db.bytes} bytes`, j.blob?.object && `${j.blob.object} ${j.blob.bytes} bytes`];
    if (Array.isArray(j.missing) && j.missing.length) bits.push(`missing: ${j.missing.join(", ")}`);
    if (Array.isArray(j.problems) && j.problems.length) bits.push(`problems: ${j.problems.join("; ")}`);
    if (Array.isArray(j.overwritten) && j.overwritten.length) bits.push(`OVERWRITTEN: ${j.overwritten.join(", ")}`);
    return `${label}: ${bits.filter(Boolean).join(" | ")}`;
  } catch {
    return `${label}: the result file cannot be read`;
  }
}

export async function status(sys, P) {
  const one = (bin, args) => sys.run(bin, args, { timeoutMs: 20_000 }).stdout.trim();
  const current = currentId(sys, P);
  sys.say(`version: ${current ?? "none installed"}${current ? ` (build ${buildIdOf(sys, `${P.releases}/${current}`) ?? "unknown"})` : ""}`);
  sys.say(`versions kept: ${releaseIds(sys, P).join(", ") || "none"}`);
  for (const unit of ["ripple-web", "caddy", "ripple-backup.timer", "ripple-backup-check.timer"]) sys.say(`service ${unit}: ${one("systemctl", ["is-active", unit]) || "unknown"}`);
  const health = await sys.getHealth();
  if (!health) sys.say("health: nothing answers on the app's port");
  else {
    const body = health.body ?? {};
    const expect = readExpect(sys, P.webExpect);
    sys.say(`health: HTTP ${health.status} ${Object.keys(expect ?? { ok: 1, store: 1 }).map((k) => `${k}=${show(body[k])}`).join(" ")}`);
    const diffs = expect ? compareHealth(body, expect) : [];
    sys.say(expect ? (diffs.length ? diffs.map((d) => `DIFFERS  ${d}`).join("\n") : "health matches what was pushed") : "no pushed expectation on the server to compare with");
  }
  // which configuration files exist: name, mode, when written. Never their contents.
  for (const f of [P.webEnv, `${P.webEnv}.prev`, P.edgeEnv, P.backupEnv, P.backupPub]) {
    if (!sys.exists(f)) sys.say(`file ${path.basename(f)}: not there`);
    else {
      const s = sys.stat(f);
      sys.say(`file ${path.basename(f)}: mode ${s.mode}, written ${s.modified}`);
    }
  }
  sys.say(backupLine(sys, `${P.backupState}/last.json`, "last backup"));
  sys.say(backupLine(sys, `${P.backupState}/last-check.json`, "last backup check"));
  for (const crt of certFiles(sys, P.caddyCerts)) sys.say(`certificate ${path.basename(crt, ".crt")}: ${one("openssl", ["x509", "-enddate", "-noout", "-in", crt]) || "unreadable"}`);
  sys.say(`time zone: ${one("timedatectl", ["show", "-p", "Timezone", "--value"]) || "unknown"}`);
  sys.say(`disk /: ${one("df", ["-h", "--output=size,used,avail,pcent", "/"]).split("\n").pop()?.trim() ?? "unknown"}`);
  sys.say(`memory (MB): ${one("free", ["-m"]).split("\n").slice(1).map((l) => l.replace(/\s+/g, " ").trim()).join(" ; ")}`);
  if (sys.exists(P.rebootFlag)) sys.say("the system says a restart is required (an update was installed)");
  const errors = one("journalctl", ["-u", "ripple-web", "-p", "err", "-n", "30", "--no-pager", "-o", "short-iso"]);
  sys.say(`recent errors of ripple-web (${errors ? errors.split("\n").length : 0}):`);
  if (errors) sys.say(errors);
  return { code: 0, result: { op: "status", status: "ok", release: current } };
}

// ------------------------------------------------------------------ entry

export const OPERATIONS = { "env-apply": envApply, "env-restore": envRestore, "secrets-apply": secretsApply, "secrets-restore": secretsRestore, release, rollback, status };

export async function cli(argv, sys = realSys(), P = paths(process.env.RIPPLE_SANDBOX_ROOT ?? "")) {
  const [op, ...args] = argv;
  const run = OPERATIONS[op];
  let outcome;
  try {
    if (!run) throw new Refused(`unknown operation; one of: ${Object.keys(OPERATIONS).join(", ")}`);
    if (op === "env-apply" && args.some((a) => a !== "no-restart")) throw new Refused("env-apply takes only no-restart");
    outcome =
      op === "env-apply" ? await run(sys, P, { noRestart: args.includes("no-restart") }) : op === "env-restore" || op === "status" ? await run(sys, P) : await run(sys, P, args);
  } catch (err) {
    if (!(err instanceof Refused)) {
      sys.say(`FAILED: ${err instanceof Error ? err.message : "unexpected error"}`);
      sys.say(`RIPPLE_RESULT ${JSON.stringify({ op, status: "crashed" })}`);
      return 1;
    }
    sys.say(`REFUSED: ${err.message}`);
    sys.say(`RIPPLE_RESULT ${JSON.stringify({ op, status: "refused" })}`);
    return err.code;
  }
  sys.say(`RIPPLE_RESULT ${JSON.stringify(outcome.result)}`);
  return outcome.code;
}

// started through `node --input-type=module - <operation>` (the script on standard input) or as a file
if (process.argv[1] === "-" || /[\\/]remote\.mjs$/.test(process.argv[1] ?? "")) {
  process.exit(await cli(process.argv.slice(2)));
}
