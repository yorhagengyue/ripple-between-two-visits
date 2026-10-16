#!/usr/bin/env node
/**
 * The daily backup, on the server (C2 track P; docs/plan/hosting.md 5.14 item 2, real-app.md 3.12). Installed by
 * provision.sh as /usr/local/lib/ripple/backup.mjs and started by ripple-backup.service (root, 03:00 Singapore time);
 * by hand: sudo systemctl start ripple-backup.service. No imports outside Node.
 *
 * One run:
 *   1. not configured (a setting or the public key is missing): say so, write that to last.json, end well. Nothing else.
 *   2. compare versions: a pg_dump older than the database's major version does not run (it would refuse anyway).
 *   3. pg_dump --format=custom of the schemas public AND auth (the accounts live in auth; public's rows point at
 *      auth.users) into a private temporary folder.
 *   4. pg_restore --list must read the dump and find auth.users in it; otherwise nothing is uploaded.
 *   5. sha256, encrypt with age for the public key in /etc/ripple/backup.age.pub, delete the plain dump, upload as
 *      db/<date>T<time>.dump.age (Singapore time), list it again and compare the size.
 *   6. the two private buckets (audio, labels): list and download with the service key, tar, encrypt, delete the plain
 *      copies, upload as blob/<date>T<time>.tar.age, list it again.
 *   7. write /var/lib/ripple-backup/last.json (names, sizes, the hash; never a setting's value).
 * The temporary folder is removed whatever happens. Nothing is ever deleted or overwritten in the bucket: the only
 * rclone commands are copyto (with --immutable) and lsjson; expiry is the bucket's lifecycle rule.
 *
 * Secrets stay off command lines: the database password goes to psql / pg_dump through PG* environment variables, the
 * COS keys to rclone through RCLONE_CONFIG_* variables.
 *
 * Settings: /etc/ripple/backup.env (SUPABASE_DB_URL, BACKUP_COS_BUCKET, BACKUP_COS_REGION, BACKUP_COS_SECRET_ID,
 * BACKUP_COS_SECRET_KEY) and /etc/ripple/web.env (SUPABASE_URL, SUPABASE_SERVICE_KEY), both loaded by systemd.
 *
 * Not verified against a real project (no server yet): that the pooler's postgres role may dump every table of the
 * auth schema. If it may not, pg_dump fails, this run fails loudly and last.json says so.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const BUCKETS = ["audio", "labels"];
export const AGE_HEADER = "age-encryption.org/v1";
export const COS_SETTINGS = ["BACKUP_COS_BUCKET", "BACKUP_COS_REGION", "BACKUP_COS_SECRET_ID", "BACKUP_COS_SECRET_KEY"];
const NEEDED = ["SUPABASE_DB_URL", ...COS_SETTINGS, "SUPABASE_URL", "SUPABASE_SERVICE_KEY"];

export function paths(root = "") {
  return { recipient: `${root}/etc/ripple/backup.age.pub`, state: `${root}/var/lib/ripple-backup`, pgRoot: `${root}/usr/lib/postgresql` };
}

/** The real machine. */
export function realSys() {
  return {
    run(bin, args, opts = {}) {
      const r = spawnSync(bin, args, { env: { ...process.env, ...(opts.env ?? {}) }, encoding: opts.binary ? "buffer" : "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, timeout: opts.timeoutMs });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: String(r.stderr ?? "") };
    },
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    mkdtemp: () => fs.mkdtempSync(path.join(os.tmpdir(), "ripple-backup-")),
    say: (line) => console.log(line),
  };
}

const val = (env, name) => (env[name] ?? "").trim();

/** Singapore has no daylight saving: local time is UTC+8. "2026-10-16T030000" */
export function stampOf(ms) {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace(/:/g, "");
}

/** What is missing for a backup (names only); empty when it is configured. */
export function missingSettings(env, P, needed = NEEDED) {
  const missing = needed.filter((n) => !val(env, n));
  let recipient = "";
  try {
    recipient = fs.readFileSync(P.recipient, "utf8").trim();
  } catch {
    // no file
  }
  if (!/^age1[a-z0-9]{20,}$/.test(recipient)) missing.push("/etc/ripple/backup.age.pub");
  return missing;
}

/** rclone's remote "cos", from the environment only: no configuration file with keys in it. */
export function rcloneEnv(env) {
  return {
    RCLONE_CONFIG_COS_TYPE: "s3",
    RCLONE_CONFIG_COS_PROVIDER: "TencentCOS",
    RCLONE_CONFIG_COS_ACCESS_KEY_ID: val(env, "BACKUP_COS_SECRET_ID"),
    RCLONE_CONFIG_COS_SECRET_ACCESS_KEY: val(env, "BACKUP_COS_SECRET_KEY"),
    RCLONE_CONFIG_COS_ENDPOINT: `cos.${val(env, "BACKUP_COS_REGION")}.myqcloud.com`,
    // the sub-account may not create or look up buckets
    RCLONE_CONFIG_COS_NO_CHECK_BUCKET: "true",
  };
}

/** The connection, as libpq's environment variables (nothing of it on a command line). */
export function pgEnv(dbUrl) {
  const u = new URL(dbUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "20",
    PGAPPNAME: "ripple-backup",
  };
}

/** The newest PostgreSQL client installed under /usr/lib/postgresql/<major>/bin, or null. */
export function pgBinDir(P) {
  let majors = [];
  try {
    majors = fs.readdirSync(P.pgRoot).filter((d) => /^\d+$/.test(d) && fs.existsSync(`${P.pgRoot}/${d}/bin/pg_dump`));
  } catch {
    // none
  }
  majors.sort((a, b) => Number(b) - Number(a));
  return majors.length ? { dir: `${P.pgRoot}/${majors[0]}/bin`, major: Number(majors[0]) } : null;
}

export function writeState(P, name, state) {
  fs.mkdirSync(P.state, { recursive: true });
  fs.writeFileSync(`${P.state}/${name}`, `${JSON.stringify(state, null, 1)}\n`, { mode: 0o644 });
}

class Failed extends Error {}

function sha256File(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n = fs.readSync(fd, buf, 0, buf.length, null); n > 0; n = fs.readSync(fd, buf, 0, buf.length, null)) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** age for the public key file, then the plain file goes; the result must start with age's header. */
function encrypt(sys, P, plain, out) {
  const r = sys.run("age", ["-R", P.recipient, "-o", out, plain]);
  fs.rmSync(plain, { force: true });
  if (r.code !== 0 || !fs.existsSync(out)) throw new Failed("age could not encrypt (is /etc/ripple/backup.age.pub a public key?)");
  const fd = fs.openSync(out, "r");
  const head = Buffer.alloc(AGE_HEADER.length);
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  if (head.toString("latin1") !== AGE_HEADER) throw new Failed("the encrypted file does not start with the age header");
}

/** Upload one file under a name that does not exist yet, then list it and compare the size. */
function upload(sys, env, file, object) {
  const remote = `cos:${val(env, "BACKUP_COS_BUCKET")}/${object}`;
  const bytes = fs.statSync(file).size;
  const up = sys.run("rclone", ["copyto", "--immutable", "--s3-no-check-bucket", file, remote], { env: rcloneEnv(env), timeoutMs: 2 * 3600_000 });
  if (up.code !== 0) throw new Failed(`the upload of ${object} failed`);
  const ls = sys.run("rclone", ["lsjson", "--s3-no-check-bucket", remote], { env: rcloneEnv(env), timeoutMs: 120_000 });
  let listed = [];
  try {
    listed = JSON.parse(ls.stdout);
  } catch {
    // not JSON
  }
  if (ls.code !== 0 || !Array.isArray(listed) || listed.length !== 1 || listed[0].Size !== bytes) throw new Failed(`${object} is not in the bucket with the size that was sent`);
  return { object, bytes };
}

/** Every file path in a bucket, through the Storage API's list call (folders are entries without an id). */
export async function listBucket(sys, env, bucket, prefix = "") {
  const base = val(env, "SUPABASE_URL").replace(/\/+$/, "");
  const key = val(env, "SUPABASE_SERVICE_KEY");
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await sys.fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Failed(`listing the bucket ${bucket} failed (HTTP ${res.status})`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Failed(`listing the bucket ${bucket} gave no list`);
    for (const row of rows) {
      const name = String(row?.name ?? "");
      if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Failed(`the bucket ${bucket} has an object name that cannot be a file name`);
      if (row.id === null || row.id === undefined) out.push(...(await listBucket(sys, env, bucket, `${prefix}${name}/`)));
      else out.push(`${prefix}${name}`);
    }
    if (rows.length < 1000) return out;
  }
}

async function downloadBuckets(sys, env, dir) {
  const base = val(env, "SUPABASE_URL").replace(/\/+$/, "");
  const key = val(env, "SUPABASE_SERVICE_KEY");
  let files = 0;
  for (const bucket of BUCKETS) {
    fs.mkdirSync(`${dir}/${bucket}`, { recursive: true });
    for (const p of await listBucket(sys, env, bucket)) {
      const dest = `${dir}/${bucket}/${p}`;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const res = await sys.fetch(`${base}/storage/v1/object/${bucket}/${p.split("/").map(encodeURIComponent).join("/")}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok || !res.body) throw new Failed(`downloading from the bucket ${bucket} failed (HTTP ${res.status})`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest, { mode: 0o600 }));
      files++;
    }
  }
  return files;
}

/**
 * One backup run. Returns the exit code: 0 done or not configured, 1 failed. `env` is the process environment (the
 * two files systemd loaded); `P` the paths; `sys` the machine.
 * @param {any} sys
 * @param {Record<string, string | undefined>} env
 * @param {ReturnType<typeof paths>} P
 * @returns {Promise<number>}
 */
export async function runBackup(sys = realSys(), env = process.env, P = paths(process.env.RIPPLE_SANDBOX_ROOT ?? "")) {
  const at = new Date(sys.now()).toISOString();
  const missing = missingSettings(env, P);
  if (missing.length) {
    writeState(P, "last.json", { kind: "backup", status: "not_configured", at, missing });
    sys.say(`backup: not configured (missing: ${missing.join(", ")}); nothing was done`);
    return 0;
  }
  const stamp = stampOf(sys.now());
  const work = sys.mkdtemp();
  try {
    fs.chmodSync(work, 0o700);
    const pg = pgBinDir(P);
    if (!pg) throw new Failed("no PostgreSQL client under /usr/lib/postgresql: run provision again");
    const conn = pgEnv(val(env, "SUPABASE_DB_URL"));
    const version = sys.run(`${pg.dir}/psql`, ["-X", "-A", "-t", "-w", "-c", "show server_version_num"], { env: conn, timeoutMs: 60_000 });
    const serverMajor = Math.floor(Number(version.stdout.trim()) / 10_000);
    if (version.code !== 0 || !serverMajor) throw new Failed("could not read the database's version (connection or credentials)");
    if (pg.major < serverMajor) throw new Failed(`pg_dump ${pg.major} is older than the database (${serverMajor}): run provision again with --pg-major ${serverMajor}`);

    const dump = `${work}/db.dump`;
    const dumped = sys.run(`${pg.dir}/pg_dump`, ["--format=custom", "--no-password", "--schema=public", "--schema=auth", `--file=${dump}`], { env: conn, timeoutMs: 2 * 3600_000 });
    if (dumped.code !== 0 || !fs.existsSync(dump)) throw new Failed("pg_dump failed (if it names a table of the auth schema, the database role may not read it)");
    const listed = sys.run(`${pg.dir}/pg_restore`, ["--list", dump], { timeoutMs: 600_000 });
    if (listed.code !== 0) throw new Failed("pg_restore --list cannot read the dump: nothing was uploaded");
    if (!/TABLE DATA auth users\b/.test(listed.stdout)) throw new Failed("the dump has no auth.users in it: nothing was uploaded");
    const tables = (listed.stdout.match(/ TABLE DATA /g) ?? []).length;
    const sha256 = sha256File(dump);
    const dumpBytes = fs.statSync(dump).size;
    encrypt(sys, P, dump, `${dump}.age`);
    const db = upload(sys, env, `${dump}.age`, `db/${stamp}.dump.age`);
    fs.rmSync(`${dump}.age`, { force: true });
    sys.say(`backup: database uploaded as ${db.object} (${db.bytes} bytes, ${tables} tables)`);

    const files = await downloadBuckets(sys, env, `${work}/blob`);
    const tar = `${work}/blob.tar`;
    if (sys.run("tar", ["-cf", tar, "-C", work, "blob"], { timeoutMs: 2 * 3600_000 }).code !== 0 || !fs.existsSync(tar)) throw new Failed("tar of the downloaded files failed");
    fs.rmSync(`${work}/blob`, { recursive: true, force: true });
    encrypt(sys, P, tar, `${tar}.age`);
    const blob = upload(sys, env, `${tar}.age`, `blob/${stamp}.tar.age`);
    sys.say(`backup: files uploaded as ${blob.object} (${blob.bytes} bytes, ${files} files)`);

    writeState(P, "last.json", { kind: "backup", status: "ok", at, stamp, pg: { client: pg.major, server: serverMajor }, db: { ...db, sha256, plain_bytes: dumpBytes, tables }, blob: { ...blob, files } });
    return 0;
  } catch (err) {
    // a Failed message is written here and names no value; anything else is reduced to its kind
    const why = err instanceof Failed ? err.message : `unexpected ${err?.code ?? err?.name ?? "error"}`;
    writeState(P, "last.json", { kind: "backup", status: "failed", at, stamp, error: why });
    sys.say(`backup: FAILED: ${why}`);
    return 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (/[\\/]backup\.mjs$/.test(process.argv[1] ?? "")) {
  process.exit(await runBackup());
}
