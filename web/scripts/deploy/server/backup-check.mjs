#!/usr/bin/env node
/**
 * The daily check of the backups, on the server (C2 track P; docs/plan/hosting.md 5.14 item 3). Installed by
 * provision.sh as /usr/local/lib/ripple/backup-check.mjs, started by ripple-backup-check.service (root, 04:00
 * Singapore time, after the backup). It decrypts nothing: the private key is not on this machine.
 *
 * It checks, for the last 7 days (or since the first backup, when that is more recent):
 *   - every day has a db/ object and a blob/ object;
 *   - no object is less than half the size of the one before it;
 *   - every object starts with age's header (rclone cat --head 64: the first bytes only);
 *   - no object was overwritten in the last 14 days: with versioning on, a second upload under a name leaves the first
 *     as an older version, and our names carry the time, so a name is never written twice in normal running.
 * Only when all of that holds it requests BACKUP_HEARTBEAT_URL; a day without that request makes the outside monitor
 * write to the owner. Any problem: exit code 1 (the unit fails), no request, and last-check.json names the objects.
 *
 * Not configured (a COS setting is missing): it says so, writes that to last-check.json and ends well.
 * The only rclone commands are lsjson, lsf and cat: nothing is written, deleted or moved in the bucket.
 */
import { AGE_HEADER, COS_SETTINGS, paths, rcloneEnv, realSys, stampOf, writeState } from "./backup.mjs";

const val = (env, name) => (env[name] ?? "").trim();
const DAY_MS = 86_400_000;
const NAME = /^(db|blob)\/(\d{4}-\d{2}-\d{2})T(\d{6})\.(dump|tar)\.age$/;
/** how rclone names an older version of an object: -vYYYY-MM-DD-HHMMSS-mmm before the last extension */
const VERSION = /^(.*)-v(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})(\.[^./]*)?$/;

/** The Singapore calendar day of a moment, "2026-10-16". */
export function dayOf(ms) {
  return stampOf(ms).slice(0, 10);
}

/**
 * Judge a listing. `objects`: [{ path, size }] of current objects; `versioned`: every name `rclone lsf --s3-versions`
 * printed; `heads`: path → the first bytes of that object as text (only asked for the objects in the window).
 * Returns the sentences that are wrong (empty: all good), the overwritten object names, and which objects are in the
 * window (the caller reads their first bytes).
 */
export function judge(objects, versioned, heads, nowMs) {
  const problems = [];
  const parsed = objects
    .map((o) => {
      const m = NAME.exec(o.path);
      return m ? { path: o.path, size: Number(o.size), kind: m[1], day: m[2], stamp: `${m[2]}T${m[3]}` } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0));
  if (!parsed.length) return { problems: ["there is no backup object in the bucket at all"], overwritten: [], window: [] };

  const days = [];
  for (let i = 6; i >= 0; i--) days.push(dayOf(nowMs - i * DAY_MS));
  const firstDay = parsed[0].day;
  const required = days.filter((d) => d >= firstDay);
  const window = parsed.filter((o) => o.day >= days[0]);
  for (const day of required) {
    for (const kind of ["db", "blob"]) {
      if (!parsed.some((o) => o.kind === kind && o.day === day)) problems.push(`no ${kind}/ backup for ${day}`);
    }
  }
  for (const kind of ["db", "blob"]) {
    const series = parsed.filter((o) => o.kind === kind);
    series.forEach((o, i) => {
      if (i > 0 && o.day >= days[0] && o.size < series[i - 1].size / 2) problems.push(`${o.path} is less than half the size of the one before it`);
    });
  }
  for (const o of window) {
    if (heads && !(heads[o.path] ?? "").startsWith(AGE_HEADER)) problems.push(`${o.path} does not start with the age header`);
  }

  // an older version next to a current object of the same name, made in the last 14 days: it was overwritten
  const current = new Set(objects.map((o) => o.path));
  const overwritten = new Set();
  for (const name of versioned) {
    const m = VERSION.exec(name);
    if (!m) continue;
    const original = `${m[1]}${m[9] ?? ""}`;
    const when = Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7]));
    if (current.has(original) && nowMs - when <= 14 * DAY_MS) overwritten.add(original);
  }
  for (const name of overwritten) problems.push(`${name} was overwritten (an older version exists under the same name): use the older version from the bucket's history`);
  return { problems, overwritten: [...overwritten].sort(), window: window.map((o) => o.path) };
}

/**
 * One check. Returns the exit code: 0 all good or not configured, 1 a problem (the unit fails, no heartbeat).
 * @param {any} sys
 * @param {Record<string, string | undefined>} env
 * @param {ReturnType<typeof paths>} P
 * @returns {Promise<number>}
 */
export async function runCheck(sys = realSys(), env = process.env, P = paths(process.env.RIPPLE_SANDBOX_ROOT ?? "")) {
  const at = new Date(sys.now()).toISOString();
  const missing = COS_SETTINGS.filter((n) => !val(env, n));
  if (missing.length) {
    writeState(P, "last-check.json", { kind: "backup-check", status: "not_configured", at, missing });
    sys.say(`backup-check: not configured (missing: ${missing.join(", ")}); nothing was checked`);
    return 0;
  }
  const remote = `cos:${val(env, "BACKUP_COS_BUCKET")}`;
  const renv = rcloneEnv(env);
  const fail = (problems, overwritten = []) => {
    writeState(P, "last-check.json", { kind: "backup-check", status: "failed", at, problems, overwritten });
    for (const p of problems) sys.say(`backup-check: BAD  ${p}`);
    sys.say("backup-check: FAILED; the heartbeat was not sent");
    return 1;
  };

  const ls = sys.run("rclone", ["lsjson", "-R", "--files-only", "--s3-no-check-bucket", remote], { env: renv, timeoutMs: 300_000 });
  let listing = null;
  try {
    listing = JSON.parse(ls.stdout);
  } catch {
    // not JSON
  }
  if (ls.code !== 0 || !Array.isArray(listing)) return fail(["the bucket could not be listed"]);
  const objects = listing.map((o) => ({ path: String(o.Path), size: Number(o.Size) }));

  const lsf = sys.run("rclone", ["lsf", "-R", "--files-only", "--s3-versions", "--s3-no-check-bucket", remote], { env: renv, timeoutMs: 300_000 });
  if (lsf.code !== 0) return fail(["the bucket's versions could not be listed (is versioning on, may the key list versions?)"]);
  const versioned = lsf.stdout.split(/\r?\n/).filter(Boolean);

  const first = judge(objects, versioned, null, sys.now());
  const heads = {};
  for (const p of first.window) {
    const head = sys.run("rclone", ["cat", "--head", "64", "--s3-no-check-bucket", `${remote}/${p}`], { env: renv, timeoutMs: 120_000 });
    heads[p] = head.code === 0 ? String(head.stdout).slice(0, 64) : "";
  }
  const verdict = judge(objects, versioned, heads, sys.now());
  if (!val(env, "BACKUP_HEARTBEAT_URL")) verdict.problems.push("BACKUP_HEARTBEAT_URL is not set: nobody would hear when a check fails");
  if (verdict.problems.length) return fail(verdict.problems, verdict.overwritten);

  let pinged = false;
  try {
    const res = await sys.fetch(val(env, "BACKUP_HEARTBEAT_URL"), { method: "GET", signal: AbortSignal.timeout(20_000) });
    pinged = res.ok;
  } catch {
    // counted below
  }
  writeState(P, "last-check.json", { kind: "backup-check", status: pinged ? "ok" : "ok_heartbeat_failed", at, checked: verdict.window.length, overwritten: [] });
  sys.say(pinged ? `backup-check: ok (${verdict.window.length} objects of the last 7 days); heartbeat sent` : "backup-check: the backups are fine but the heartbeat request failed");
  return pinged ? 0 : 1;
}

if (/[\\/]backup-check\.mjs$/.test(process.argv[1] ?? "")) {
  process.exit(await runCheck());
}
