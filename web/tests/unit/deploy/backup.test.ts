/**
 * The server's backup and backup check (scripts/deploy/server/backup.mjs, backup-check.mjs; C2 track P;
 * docs/plan/hosting.md 5.14). The tools (psql, pg_dump, pg_restore, age, rclone, tar) and the storage API are
 * stand-ins that behave as the real ones would on disk; a temporary folder stands in for /.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dayOf, judge, runCheck } from "@/scripts/deploy/server/backup-check.mjs";
import { listBucket, missingSettings, paths, pgEnv, rcloneEnv, runBackup, stampOf } from "@/scripts/deploy/server/backup.mjs";

const NOW = Date.parse("2026-10-15T19:00:05.000Z"); // 03:00:05 on the 16th in Singapore
const DB_PASSWORD = "FakeProdPassw0rdZZ";
const ENV = {
  SUPABASE_DB_URL: `postgresql://postgres.prodfakerefabcdefghij:${DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  BACKUP_COS_BUCKET: "fake-ripple-backup-1250000000",
  BACKUP_COS_REGION: "ap-singapore",
  BACKUP_COS_SECRET_ID: "AKIDFAKEcosid0123456789ZZ",
  BACKUP_COS_SECRET_KEY: "FAKEcoskey0123456789abcdefZZ",
  BACKUP_HEARTBEAT_URL: "https://heartbeat.fake-ripple-zz.example/ping/FAKEtoken0123456789",
  SUPABASE_URL: "https://prodfakerefabcdefghij.supabase.co",
  SUPABASE_SERVICE_KEY: "sb_secret_FAKEPRODservice0123456789zz",
};
const SECRETS = [DB_PASSWORD, ENV.BACKUP_COS_SECRET_ID, ENV.BACKUP_COS_SECRET_KEY, ENV.SUPABASE_SERVICE_KEY, ENV.BACKUP_HEARTBEAT_URL];
const LIST_OK = "1; 2615 2200 SCHEMA - auth supabase_admin\n4012; 0 16500 TABLE DATA auth users supabase_auth_admin\n4013; 0 17001 TABLE DATA public session postgres\n4014; 0 17002 TABLE DATA public visit postgres\n";

const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Call {
  bin: string;
  args: string[];
  env: Record<string, string>;
}

function world(opts: { serverVersion?: string; list?: { code: number; stdout: string }; pgMajor?: string; recipient?: string | null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ripple-backup-test-")).replace(/\\/g, "/");
  made.push(root);
  const P = paths(root);
  mkdirSync(`${root}/etc/ripple`, { recursive: true });
  mkdirSync(`${P.pgRoot}/${opts.pgMajor ?? "17"}/bin`, { recursive: true });
  writeFileSync(`${P.pgRoot}/${opts.pgMajor ?? "17"}/bin/pg_dump`, "");
  if (opts.recipient !== null) writeFileSync(P.recipient, `${opts.recipient ?? `age1${"q".repeat(58)}`}\n`);
  const calls: Call[] = [];
  const said: string[] = [];
  const uploaded = new Map<string, number>();
  const fetched: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const workDirs: string[] = [];
  /** exit codes for tools whose command matches */
  const failing: Array<[RegExp, number]> = [];
  /** what the bucket listing answers instead of what was uploaded */
  const state = { lieAboutSize: false, buckets: { audio: { "": [{ name: "scope-a", id: null }], "scope-a/": [{ name: "visit-1.wav", id: "f1" }, { name: "reminders", id: null }], "scope-a/reminders/": [{ name: "r1.wav", id: "f2" }] }, labels: { "": [{ name: "scope-a", id: null }], "scope-a/": [{ name: "label-1.jpg", id: "f3" }] } } as Record<string, Record<string, Array<{ name: string; id: string | null }>>>, storageStatus: 200 };
  const sys = {
    run(bin: string, args: string[], o: { env?: Record<string, string> } = {}) {
      const name = path.basename(bin);
      const text = `${name} ${args.join(" ")}`;
      calls.push({ bin: name, args, env: o.env ?? {} });
      const code = failing.find(([re]) => re.test(text))?.[1] ?? 0;
      if (code) return { code, stdout: "", stderr: "stand-in failure" };
      if (name === "psql") return { code: 0, stdout: `${opts.serverVersion ?? "170006"}\n`, stderr: "" };
      if (name === "pg_dump") writeFileSync(args.find((a) => a.startsWith("--file="))!.slice(7), "PGDMP the plain dump with real rows in it");
      if (name === "pg_restore") return { code: opts.list?.code ?? 0, stdout: opts.list?.stdout ?? LIST_OK, stderr: "" };
      if (name === "age") writeFileSync(args[args.indexOf("-o") + 1], `age-encryption.org/v1\n-> X25519 stand-in\n${"x".repeat(statSync(args.at(-1)!).size)}`);
      if (name === "tar") writeFileSync(args[1], "a tar of the downloaded files");
      if (name === "rclone" && args[0] === "copyto") uploaded.set(args.at(-1)!, statSync(args.at(-2)!).size);
      if (name === "rclone" && args[0] === "lsjson") {
        const size = uploaded.get(args.at(-1)!);
        return { code: 0, stdout: JSON.stringify(size === undefined ? [] : [{ Path: path.basename(args.at(-1)!), Size: state.lieAboutSize ? size - 1 : size }]), stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    async fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
      fetched.push({ url, method: init.method ?? "GET", headers: init.headers ?? {} });
      const list = /\/storage\/v1\/object\/list\/([a-z]+)$/.exec(url);
      if (list) {
        if (state.storageStatus !== 200) return new Response("no", { status: state.storageStatus });
        const { prefix, offset } = JSON.parse(init.body ?? "{}") as { prefix: string; offset: number };
        return Response.json(offset ? [] : (state.buckets[list[1]]?.[prefix] ?? []));
      }
      return new Response(`the bytes of ${url.split("/storage/v1/object/")[1]}`);
    },
    now: () => NOW,
    mkdtemp() {
      const dir = mkdtempSync(path.join(root, "work-")).replace(/\\/g, "/");
      workDirs.push(dir);
      return dir;
    },
    say: (line: string) => void said.push(line),
  };
  const last = (name = "last.json") => JSON.parse(readFileSync(`${P.state}/${name}`, "utf8")) as Record<string, unknown>;
  return { root, P, sys, calls, said, uploaded, fetched, workDirs, failing, state, last };
}

const names = (w: ReturnType<typeof world>) => w.calls.map((c) => `${c.bin} ${c.args[0] ?? ""}`.trim());

describe("backup", () => {
  it("names objects by Singapore time", () => {
    expect(stampOf(NOW)).toBe("2026-10-16T030005");
    expect(dayOf(NOW)).toBe("2026-10-16");
    expect(dayOf(Date.parse("2026-10-15T15:59:59Z"))).toBe("2026-10-15");
  });

  it("not configured: says so cleanly, writes that down, runs nothing, exit 0", async () => {
    const w = world({ recipient: null });
    expect(await runBackup(w.sys, {}, w.P)).toBe(0);
    expect(w.calls).toHaveLength(0);
    expect(w.fetched).toHaveLength(0);
    expect(w.said.join("\n")).toMatch(/^backup: not configured \(missing: SUPABASE_DB_URL, BACKUP_COS_BUCKET, .*\/etc\/ripple\/backup\.age\.pub\); nothing was done$/);
    expect(w.last()).toMatchObject({ kind: "backup", status: "not_configured", missing: expect.arrayContaining(["BACKUP_COS_BUCKET", "/etc/ripple/backup.age.pub"]) });
  });

  it("is not configured while the bucket exists but the key does not, and the other way round", () => {
    const noKey = world({ recipient: null });
    expect(missingSettings(ENV, noKey.P)).toEqual(["/etc/ripple/backup.age.pub"]);
    const privateKey = world({ recipient: "AGE-SECRET-KEY-1NOTAPUBLICKEY" });
    expect(missingSettings(ENV, privateKey.P)).toEqual(["/etc/ripple/backup.age.pub"]);
    const noBucket = world();
    expect(missingSettings({ ...ENV, BACKUP_COS_BUCKET: "", BACKUP_COS_SECRET_KEY: " " }, noBucket.P)).toEqual(["BACKUP_COS_BUCKET", "BACKUP_COS_SECRET_KEY"]);
  });

  it("a good run: version, dump of public and auth, read it back, encrypt, upload, list; then the files; nothing plain is left", async () => {
    const w = world();
    expect(await runBackup(w.sys, ENV, w.P)).toBe(0);
    expect(names(w)).toEqual(["psql -X", "pg_dump --format=custom", "pg_restore --list", "age -R", "rclone copyto", "rclone lsjson", "tar -cf", "age -R", "rclone copyto", "rclone lsjson"]);
    const dump = w.calls[1];
    expect(dump.args).toEqual(expect.arrayContaining(["--schema=public", "--schema=auth", "--format=custom", "--no-password"]));
    expect([...w.uploaded.keys()]).toEqual(["cos:fake-ripple-backup-1250000000/db/2026-10-16T030005.dump.age", "cos:fake-ripple-backup-1250000000/blob/2026-10-16T030005.tar.age"]);
    expect(w.last()).toMatchObject({ status: "ok", stamp: "2026-10-16T030005", pg: { client: 17, server: 17 }, db: { object: "db/2026-10-16T030005.dump.age", tables: 3 }, blob: { object: "blob/2026-10-16T030005.tar.age", files: 3 } });
    expect(String((w.last().db as { sha256: string }).sha256)).toMatch(/^[0-9a-f]{64}$/);
    // the three files of the two buckets were fetched with the service key, by path
    expect(w.fetched.filter((f) => f.method === "GET").map((f) => f.url.split("/storage/v1/object/")[1])).toEqual(["audio/scope-a/visit-1.wav", "audio/scope-a/reminders/r1.wav", "labels/scope-a/label-1.jpg"]);
    // the work folder is gone: no plain dump, no downloaded file, no tar
    expect(w.workDirs).toHaveLength(1);
    expect(existsSync(w.workDirs[0])).toBe(false);
  });

  it("keeps every secret off the command lines and out of what it says and writes", async () => {
    const w = world();
    await runBackup(w.sys, ENV, w.P);
    const commandLines = w.calls.map((c) => `${c.bin} ${c.args.join(" ")}`).join("\n");
    for (const secret of SECRETS) expect(commandLines.includes(secret)).toBe(false);
    expect(commandLines).not.toContain("pooler.supabase.com");
    for (const secret of [...SECRETS, "pooler.supabase.com", "prodfakeref"]) {
      expect(w.said.join("\n").includes(secret)).toBe(false);
      expect(readFileSync(`${w.P.state}/last.json`, "utf8").includes(secret)).toBe(false);
    }
    // they travel in the environment of the tool that needs them
    expect(w.calls[0].env).toMatchObject({ PGPASSWORD: DB_PASSWORD, PGHOST: "aws-0-ap-southeast-1.pooler.supabase.com", PGUSER: "postgres.prodfakerefabcdefghij", PGSSLMODE: "require" });
    expect(w.calls.find((c) => c.bin === "rclone")!.env).toMatchObject({ RCLONE_CONFIG_COS_SECRET_ACCESS_KEY: ENV.BACKUP_COS_SECRET_KEY, RCLONE_CONFIG_COS_ENDPOINT: "cos.ap-singapore.myqcloud.com", RCLONE_CONFIG_COS_NO_CHECK_BUCKET: "true" });
    expect(pgEnv("postgresql://u%40x:p%21w@h/db").PGPASSWORD).toBe("p!w");
    expect(rcloneEnv(ENV).RCLONE_CONFIG_COS_PROVIDER).toBe("TencentCOS");
  });

  it("does not run a pg_dump that is older than the database", async () => {
    const w = world({ serverVersion: "180002" });
    expect(await runBackup(w.sys, ENV, w.P)).toBe(1);
    expect(names(w)).toEqual(["psql -X"]);
    expect(w.said.join("\n")).toContain("backup: FAILED: pg_dump 17 is older than the database (18): run provision again with --pg-major 18");
    expect(w.last()).toMatchObject({ status: "failed", error: expect.stringContaining("older than the database") });
    expect(existsSync(w.workDirs[0])).toBe(false);
  });

  it("uses the newest client installed, so a newer one put there by provision is picked up", async () => {
    const w = world({ serverVersion: "180002" });
    mkdirSync(`${w.P.pgRoot}/18/bin`, { recursive: true });
    writeFileSync(`${w.P.pgRoot}/18/bin/pg_dump`, "");
    expect(await runBackup(w.sys, ENV, w.P)).toBe(0);
    expect(w.last()).toMatchObject({ pg: { client: 18, server: 18 } });
  });

  it("uploads nothing when the dump cannot be read back", async () => {
    const w = world({ list: { code: 1, stdout: "" } });
    expect(await runBackup(w.sys, ENV, w.P)).toBe(1);
    expect(names(w)).toEqual(["psql -X", "pg_dump --format=custom", "pg_restore --list"]);
    expect(w.uploaded.size).toBe(0);
    expect(w.said.join("\n")).toMatch(/pg_restore --list cannot read the dump: nothing was uploaded/);
    expect(existsSync(w.workDirs[0])).toBe(false);
  });

  it("uploads nothing when the accounts are not in the dump", async () => {
    const w = world({ list: { code: 0, stdout: "4013; 0 17001 TABLE DATA public session postgres\n" } });
    expect(await runBackup(w.sys, ENV, w.P)).toBe(1);
    expect(w.uploaded.size).toBe(0);
    expect(w.said.join("\n")).toMatch(/no auth\.users in it: nothing was uploaded/);
  });

  it("fails loudly when pg_dump, the encryption or the upload fails, and leaves nothing plain behind", async () => {
    for (const [pattern, said] of [[/^pg_dump/, /pg_dump failed/], [/^age/, /age could not encrypt/], [/^rclone copyto/, /the upload of db\/.* failed/]] as Array<[RegExp, RegExp]>) {
      const w = world();
      w.failing.push([pattern, 1]);
      expect(await runBackup(w.sys, ENV, w.P)).toBe(1);
      expect(w.said.join("\n")).toMatch(said);
      expect(existsSync(w.workDirs[0])).toBe(false);
      expect(w.last().status).toBe("failed");
    }
  });

  it("does not trust an upload it cannot find again with the size that was sent", async () => {
    const w = world();
    w.state.lieAboutSize = true;
    expect(await runBackup(w.sys, ENV, w.P)).toBe(1);
    expect(w.said.join("\n")).toMatch(/is not in the bucket with the size that was sent/);
  });

  it("fails when the files cannot be listed, and refuses an object name that could leave the work folder", async () => {
    const down = world();
    down.state.storageStatus = 503;
    expect(await runBackup(down.sys, ENV, down.P)).toBe(1);
    expect(down.said.join("\n")).toMatch(/listing the bucket audio failed \(HTTP 503\)/);
    const evil = world();
    evil.state.buckets.audio[""] = [{ name: "..", id: null }];
    await expect(listBucket(evil.sys, ENV, "audio")).rejects.toThrow(/cannot be a file name/);
    expect(await runBackup(evil.sys, ENV, evil.P)).toBe(1);
    expect(existsSync(evil.workDirs[0])).toBe(false);
  });

  it("never deletes or overwrites anything in the bucket: the only rclone commands are copyto --immutable and lsjson", async () => {
    const w = world();
    await runBackup(w.sys, ENV, w.P);
    const rclone = w.calls.filter((c) => c.bin === "rclone");
    expect([...new Set(rclone.map((c) => c.args[0]))].sort()).toEqual(["copyto", "lsjson"]);
    for (const c of rclone.filter((r) => r.args[0] === "copyto")) expect(c.args).toContain("--immutable");
    expect(readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "deploy", "server", "backup.mjs"), "utf8")).not.toMatch(/"(delete|deletefile|purge|rmdir|rmdirs|sync|move|moveto|cleanup)"/);
  });
});

describe("backup-check: judging a listing", () => {
  const MB = 1_000_000;
  /** one db and one blob object for each of the last `days` days, 03:00 */
  const daily = (days: number, size = 10 * MB) => {
    const out: Array<{ path: string; size: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = dayOf(NOW - i * 86_400_000);
      out.push({ path: `db/${day}T030000.dump.age`, size }, { path: `blob/${day}T030500.tar.age`, size: size * 3 });
    }
    return out;
  };
  const headsFor = (objects: Array<{ path: string }>) => Object.fromEntries(objects.map((o) => [o.path, "age-encryption.org/v1\n-> X25519 abc"]));

  it("seven days, steady sizes, age headers, no versions: nothing wrong", () => {
    const objects = daily(9);
    const verdict = judge(objects, objects.map((o) => o.path), headsFor(objects), NOW);
    expect(verdict.problems).toEqual([]);
    expect(verdict.window).toHaveLength(14);
  });

  it("in the first days after going live, only the days since the first backup are required", () => {
    const objects = daily(2);
    expect(judge(objects, [], headsFor(objects), NOW).problems).toEqual([]);
  });

  it("a missing day, for either kind", () => {
    const objects = daily(7).filter((o) => o.path !== "db/2026-10-14T030000.dump.age" && o.path !== "blob/2026-10-16T030500.tar.age");
    expect(judge(objects, [], headsFor(objects), NOW).problems).toEqual(["no db/ backup for 2026-10-14", "no blob/ backup for 2026-10-16"]);
  });

  it("an object less than half the size of the one before it", () => {
    const objects = daily(7);
    objects.find((o) => o.path === "db/2026-10-15T030000.dump.age")!.size = 4 * MB;
    expect(judge(objects, [], headsFor(objects), NOW).problems).toEqual(["db/2026-10-15T030000.dump.age is less than half the size of the one before it"]);
  });

  it("an object that does not start with the age header", () => {
    const objects = daily(3);
    const heads = headsFor(objects);
    heads["db/2026-10-16T030000.dump.age"] = "PGDMP plain dump";
    delete heads["blob/2026-10-15T030500.tar.age"];
    expect(judge(objects, [], heads, NOW).problems).toEqual(["blob/2026-10-15T030500.tar.age does not start with the age header", "db/2026-10-16T030000.dump.age does not start with the age header"]);
  });

  it("an overwritten object: an older version under a name that still has a current one, in the last 14 days", () => {
    const objects = daily(7);
    const versioned = [...objects.map((o) => o.path), "db/2026-10-14T030000.dump-v2026-10-13-190000-000.age"];
    const verdict = judge(objects, versioned, headsFor(objects), NOW);
    expect(verdict.overwritten).toEqual(["db/2026-10-14T030000.dump.age"]);
    expect(verdict.problems).toEqual(["db/2026-10-14T030000.dump.age was overwritten (an older version exists under the same name): use the older version from the bucket's history"]);
  });

  it("an older version whose current object has expired, or that is older than 14 days, is the lifecycle rule at work", () => {
    const objects = daily(7);
    const versioned = [...objects.map((o) => o.path), "db/2026-09-20T030000.dump-v2026-09-19-190000-000.age", "db/2026-10-12T030000.dump-v2026-09-01-190000-000.age"];
    expect(judge(objects, versioned, headsFor(objects), NOW).problems).toEqual([]);
  });

  it("an empty bucket", () => {
    expect(judge([], [], {}, NOW).problems).toEqual(["there is no backup object in the bucket at all"]);
    expect(judge([{ path: "something-else.txt", size: 1 }], [], {}, NOW).problems).toHaveLength(1);
  });
});

describe("backup-check: a run", () => {
  function checkWorld(objects: Array<{ path: string; size: number }>, opts: { versioned?: string[]; head?: (p: string) => string; pingOk?: boolean } = {}) {
    const w = world();
    const pings: string[] = [];
    const sys = {
      ...w.sys,
      run(bin: string, args: string[], o: { env?: Record<string, string> } = {}) {
        w.calls.push({ bin, args, env: o.env ?? {} });
        if (args[0] === "lsjson") return { code: 0, stdout: JSON.stringify(objects.map((x) => ({ Path: x.path, Size: x.size }))), stderr: "" };
        if (args[0] === "lsf") return { code: 0, stdout: `${(opts.versioned ?? objects.map((x) => x.path)).join("\n")}\n`, stderr: "" };
        if (args[0] === "cat") return { code: 0, stdout: (opts.head ?? (() => "age-encryption.org/v1\n-> X25519"))(args.at(-1)!.split("1250000000/")[1]), stderr: "" };
        return { code: 1, stdout: "", stderr: "" };
      },
      async fetch(url: string) {
        pings.push(url);
        return new Response("ok", { status: opts.pingOk === false ? 500 : 200 });
      },
    };
    return { ...w, sys, pings };
  }
  const week = () => {
    const out: Array<{ path: string; size: number }> = [];
    for (let i = 6; i >= 0; i--) out.push({ path: `db/${dayOf(NOW - i * 86_400_000)}T030000.dump.age`, size: 5_000_000 }, { path: `blob/${dayOf(NOW - i * 86_400_000)}T030500.tar.age`, size: 9_000_000 });
    return out;
  };

  it("not configured: says so cleanly, lists nothing, pings nothing, exit 0", async () => {
    const w = checkWorld(week());
    expect(await runCheck(w.sys, {}, w.P)).toBe(0);
    expect(w.calls).toHaveLength(0);
    expect(w.pings).toHaveLength(0);
    expect(w.said.join("\n")).toMatch(/^backup-check: not configured \(missing: BACKUP_COS_BUCKET, BACKUP_COS_REGION, BACKUP_COS_SECRET_ID, BACKUP_COS_SECRET_KEY\); nothing was checked$/);
    expect(w.last("last-check.json")).toMatchObject({ kind: "backup-check", status: "not_configured" });
  });

  it("all good: reads the first bytes of each object of the week, then sends the heartbeat", async () => {
    const w = checkWorld(week());
    expect(await runCheck(w.sys, ENV, w.P)).toBe(0);
    expect(w.pings).toEqual([ENV.BACKUP_HEARTBEAT_URL]);
    expect(w.calls.filter((c) => c.args[0] === "cat")).toHaveLength(14);
    expect(w.calls.find((c) => c.args[0] === "cat")!.args).toEqual(expect.arrayContaining(["--head", "64"]));
    expect(w.calls.find((c) => c.args[0] === "lsf")!.args).toContain("--s3-versions");
    expect(w.last("last-check.json")).toMatchObject({ status: "ok", checked: 14, overwritten: [] });
    const commandLines = w.calls.map((c) => c.args.join(" ")).join("\n");
    for (const secret of SECRETS) expect((commandLines + w.said.join("\n")).includes(secret)).toBe(false);
  });

  it("anything wrong: the service fails, no heartbeat, and the file names what", async () => {
    const overwritten = checkWorld(week(), { versioned: [...week().map((o) => o.path), "blob/2026-10-15T030500.tar-v2026-10-14-190500-000.age"] });
    expect(await runCheck(overwritten.sys, ENV, overwritten.P)).toBe(1);
    expect(overwritten.pings).toEqual([]);
    expect(overwritten.last("last-check.json")).toMatchObject({ status: "failed", overwritten: ["blob/2026-10-15T030500.tar.age"] });
    expect(overwritten.said.join("\n")).toMatch(/backup-check: FAILED; the heartbeat was not sent/);

    const missing = checkWorld(week().slice(0, -2));
    expect(await runCheck(missing.sys, ENV, missing.P)).toBe(1);
    expect(missing.pings).toEqual([]);
    expect(missing.last("last-check.json").problems).toEqual(["no db/ backup for 2026-10-16", "no blob/ backup for 2026-10-16"]);

    const plain = checkWorld(week(), { head: (p) => (p.startsWith("db/2026-10-16") ? "PGDMP" : "age-encryption.org/v1\n") });
    expect(await runCheck(plain.sys, ENV, plain.P)).toBe(1);
    expect(plain.pings).toEqual([]);
  });

  it("fails without a heartbeat address (nobody would hear), and when the heartbeat itself fails", async () => {
    const none = checkWorld(week());
    expect(await runCheck(none.sys, { ...ENV, BACKUP_HEARTBEAT_URL: "" }, none.P)).toBe(1);
    expect(none.pings).toEqual([]);
    const down = checkWorld(week(), { pingOk: false });
    expect(await runCheck(down.sys, ENV, down.P)).toBe(1);
    expect(down.last("last-check.json")).toMatchObject({ status: "ok_heartbeat_failed" });
  });

  it("only ever lists and reads: lsjson, lsf and cat", async () => {
    const w = checkWorld(week());
    await runCheck(w.sys, ENV, w.P);
    expect([...new Set(w.calls.map((c) => c.args[0]))].sort()).toEqual(["cat", "lsf", "lsjson"]);
    expect(readdirSync(w.P.state)).toEqual(["last-check.json"]);
  });
});
