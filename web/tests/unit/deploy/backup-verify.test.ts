/**
 * backup-verify, the restore drill on the owner's computer (C2 track P; docs/plan/hosting.md 5.14 item 4). age and the
 * PostgreSQL tools are a recording runner. It must never restore anywhere but this computer, never hand a production or
 * test connection to a tool, print names and counts only, and always remove the plain backup.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { localPgEnv, main as verify, tablesIn } from "@/scripts/deploy/backup-verify";
import type { Cmd, CmdResult } from "@/scripts/deploy/lib/exec";
import { BACKUP_EXTRA, expectNoLeak, fakeFiles, fakeRunner, quietOutput, TEST_ENV } from "./helpers";

const WEB = webRoot();
const NOW = () => new Date("2026-10-20T02:03:04.000Z");
const DB = "ripple_verify_20261020020304";
const LIST = "; Archive created at 2026-10-16\n4012; 0 16500 TABLE DATA auth users supabase_auth_admin\n4013; 0 17001 TABLE DATA public session postgres\n4014; 0 17002 TABLE DATA public visit postgres\n";

function setup(set: Record<string, string | null> = {}, kind: "dump" | "tar" = "dump") {
  const f = fakeFiles({ ...BACKUP_EXTRA, ...set });
  const file = path.join(f.dir, kind === "dump" ? "2026-10-16T030000.dump.age" : "2026-10-16T030500.tar.age");
  const identity = path.join(f.dir, "owner-age-key.txt");
  writeFileSync(file, "age-encryption.org/v1\nstand-in");
  writeFileSync(identity, "# stand-in for the owner's private key file\n");
  return { f, file, identity };
}

/** Tools that behave: the key matches, the dump lists, the scratch database counts 5 rows a table and has no orphan. */
function tools(over: (cmd: Cmd) => Partial<CmdResult> | void = () => {}) {
  return fakeRunner((cmd) => {
    const mine = over(cmd);
    if (mine) return mine;
    if (cmd.bin === "age-keygen") return { stdout: `${BACKUP_EXTRA.BACKUP_AGE_RECIPIENT}\n` };
    if (cmd.bin === "pg_restore" && cmd.args[0] === "--list") return { stdout: LIST };
    if (cmd.bin === "tar") return { stdout: "blob/\nblob/audio/\nblob/audio/scope-a/visit-1.wav\nblob/labels/scope-a/label-1.jpg\n" };
    if (cmd.bin === "psql") {
      const sql = cmd.args.at(-1) ?? "";
      if (sql.includes("pg_tables")) return { stdout: "auth.users\npublic.session\npublic.visit\n" };
      if (sql.includes("not exists")) return { stdout: "0\n" };
      return { stdout: "5\n" };
    }
    return {};
  });
}

const go = async (s: ReturnType<typeof setup>, argv: string[], r = tools()) => {
  const out = quietOutput();
  const code = await verify([...argv, ...s.f.flags], out, r.run, WEB, NOW);
  return { code, text: out.text(), calls: r.calls };
};
const plainPathOf = (calls: Cmd[]) => calls.find((c) => c.bin === "age")!.args[calls.find((c) => c.bin === "age")!.args.indexOf("-o") + 1];

describe("backup-verify", () => {
  it("not configured (no public key in the deploy file): says so cleanly, runs nothing, exit 0", async () => {
    const s = setup({ BACKUP_AGE_RECIPIENT: null, BACKUP_COS_BUCKET: null, BACKUP_COS_REGION: null, BACKUP_COS_SECRET_ID: null, BACKUP_COS_SECRET_KEY: null, BACKUP_HEARTBEAT_URL: null });
    const res = await go(s, []);
    expect(res.code).toBe(0);
    expect(res.calls).toHaveLength(0);
    expect(res.text).toMatch(/^backup-verify: not configured \(the deploy file has no BACKUP_AGE_RECIPIENT/);
  });

  it("needs the file and the private key file, and a file named as the server names backups", async () => {
    const s = setup();
    expect((await go(s, ["--file", s.file])).text).toMatch(/--file .* and --identity .* are both needed/);
    expect((await go(s, ["--file", path.join(s.f.dir, "backup.zip"), "--identity", s.identity])).text).toMatch(/\.dump\.age or .*\.tar\.age/);
    expect((await go(s, ["--file", path.join(s.f.dir, "missing.dump.age"), "--identity", s.identity])).text).toMatch(/--file does not exist/);
    const tar = setup({}, "tar");
    expect((await go(tar, ["--file", tar.file, "--identity", tar.identity, "--restore"])).text).toMatch(/--restore is for a database backup/);
  });

  it("refuses to restore anywhere but this computer", async () => {
    const s = setup();
    for (const host of ["db.prodfakerefabcdefghij.supabase.co", "aws-0-ap-southeast-1.pooler.supabase.com", "203.0.113.77", "10.0.0.5"]) {
      const res = await go(s, ["--file", s.file, "--identity", s.identity, "--restore", "--pg-host", host]);
      expect(res.code, host).toBe(2);
      expect(res.text, host).toMatch(/--pg-host must be 127\.0\.0\.1, localhost or ::1.*never into the production or the test database/);
      expect(res.calls, host).toHaveLength(0);
    }
  });

  it("a dry run prints the plan and touches nothing", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity, "--restore", "--dry-run"]);
    expect(res.code).toBe(0);
    expect(res.calls).toHaveLength(0);
    expect(res.text).toContain(`createdb ${DB}`);
    expect(res.text).toContain(`dropdb ${DB}`);
    expect(res.text).toContain("Dry run: nothing was touched.");
  });

  it("refuses a private key that is not the pair of the server's public key, before decrypting anything", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity], tools((cmd) => (cmd.bin === "age-keygen" ? { stdout: `age1${"z".repeat(58)}\n` } : undefined)));
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/this private key is not the pair of BACKUP_AGE_RECIPIENT/);
    expect(res.calls.map((c) => c.bin)).toEqual(["age-keygen"]);
  });

  it("says what is not installed", async () => {
    const s = setup();
    const noAge = await go(s, ["--file", s.file, "--identity", s.identity], tools((cmd) => (cmd.bin === "age-keygen" ? { code: 127 } : undefined)));
    expect(noAge.text).toMatch(/age is not installed on this computer/);
    const noPg = await go(s, ["--file", s.file, "--identity", s.identity], tools((cmd) => (cmd.bin === "pg_restore" ? { code: 127 } : undefined)));
    expect(noPg.text).toMatch(/PostgreSQL's client tools are not installed/);
    expect(existsSync(path.dirname(plainPathOf(noPg.calls)))).toBe(false);
  });

  it("without --restore: decrypts, reads the table of contents, lists table names, removes the plain copy", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity]);
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => `${c.bin} ${c.args[0]}`)).toEqual(["age-keygen -y", "age -d", "pg_restore --list"]);
    expect(res.text).toContain("the dump reads: 3 tables with data: auth.users, public.session, public.visit");
    expect(res.text).toContain("the temporary folder with the plain backup is removed.");
    expect(existsSync(path.dirname(plainPathOf(res.calls)))).toBe(false);
    expect(tablesIn(LIST)).toEqual(["auth.users", "public.session", "public.visit"]);
  });

  it("refuses a dump that cannot be read, or that has no accounts in it", async () => {
    const s = setup();
    const unreadable = await go(s, ["--file", s.file, "--identity", s.identity, "--restore"], tools((cmd) => (cmd.bin === "pg_restore" ? { code: 1 } : undefined)));
    expect(unreadable.code).toBe(1);
    expect(unreadable.calls.some((c) => c.bin === "createdb")).toBe(false);
    const noAccounts = await go(s, ["--file", s.file, "--identity", s.identity], tools((cmd) => (cmd.bin === "pg_restore" ? { stdout: "4013; 0 17001 TABLE DATA public session postgres\n" } : undefined)));
    expect(noAccounts.code).toBe(1);
    expect(noAccounts.text).toMatch(/the dump has no auth\.users/);
  });

  it("--restore: a scratch database on this computer, counts by table, the account check, then the database is dropped", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity, "--restore"]);
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => c.bin)).toEqual(["age-keygen", "age", "pg_restore", "createdb", "pg_restore", "psql", "psql", "psql", "psql", "psql", "dropdb"]);
    expect(res.calls[3].args).toEqual([DB]);
    expect(res.calls[4].args.slice(0, 3)).toEqual(["--no-owner", "--no-privileges", `--dbname=${DB}`]);
    expect(res.calls.at(-1)!.args).toEqual(["--if-exists", DB]);
    expect(res.text).toMatch(/auth\.users\s+5\n/);
    expect(res.text).toMatch(/public\.session\s+5\n/);
    expect(res.text).toContain("every account space points at an account that was restored");
    expect(res.text).toMatch(/Not proven here: signing in with a restored password/);
    expect(existsSync(path.dirname(plainPathOf(res.calls)))).toBe(false);
  });

  it("hands the PostgreSQL tools this computer's server only: no production or test value in any command or environment", async () => {
    const s = setup();
    const r = tools();
    const before = { ...process.env };
    process.env.SUPABASE_DB_URL = TEST_ENV.SUPABASE_DB_URL;
    process.env.DATABASE_URL = s.f.values.SUPABASE_DB_URL;
    process.env.PGHOST = "aws-0-ap-southeast-1.pooler.supabase.com";
    try {
      await go(s, ["--file", s.file, "--identity", s.identity, "--restore"], r);
    } finally {
      for (const name of ["SUPABASE_DB_URL", "DATABASE_URL", "PGHOST"]) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
    }
    const pgCalls = r.calls.filter((c) => ["createdb", "dropdb", "psql"].includes(c.bin) || (c.bin === "pg_restore" && c.args[0] !== "--list"));
    expect(pgCalls.length).toBeGreaterThan(5);
    for (const call of pgCalls) {
      expect(call.env?.PGHOST).toBe("127.0.0.1");
      expect(Object.keys(call.env ?? {}).filter((n) => /^(SUPABASE_|DATABASE_URL|PGSERVICE|PGDATABASE)/.test(n))).toEqual([]);
    }
    const everything = r.calls.map((c) => `${c.args.join(" ")} ${JSON.stringify(Object.entries(c.env ?? {}).filter(([n]) => /^(PG|SUPABASE|DATABASE)/.test(n)))}`).join("\n");
    for (const value of [s.f.values.SUPABASE_DB_URL, TEST_ENV.SUPABASE_DB_URL, "pooler.supabase.com", "FakeProdPassw0rdZZ", "FakeTestPassw0rdZZ"]) expect(everything.includes(value)).toBe(false);
    expect(localPgEnv({ PGHOST: "elsewhere", PGPASSWORD: "local-pw", supabase_db_url: "x", PATH: "/bin" }, "localhost", "5433", "me")).toEqual({ PGPASSWORD: "local-pw", PATH: "/bin", PGHOST: "localhost", PGPORT: "5433", PGUSER: "me", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "ripple-backup-verify" });
  });

  it("an account space without its account fails the drill; the scratch database and the plain copy still go", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity, "--restore"], tools((cmd) => (cmd.bin === "psql" && (cmd.args.at(-1) ?? "").includes("not exists") ? { stdout: "2\n" } : undefined)));
    expect(res.code).toBe(1);
    expect(res.text).toMatch(/2 account space\(s\) point at an account that is not in the restored auth\.users/);
    expect(res.calls.at(-1)!.bin).toBe("dropdb");
    expect(existsSync(path.dirname(plainPathOf(res.calls)))).toBe(false);
  });

  it("a table with data in the dump that did not arrive fails the drill", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity, "--restore"], tools((cmd) => (cmd.bin === "psql" && (cmd.args.at(-1) ?? "").includes("pg_tables") ? { stdout: "public.session\npublic.visit\n" } : undefined)));
    expect(res.code).toBe(1);
    expect(res.text).toMatch(/did not arrive: auth\.users/);
    expect(res.calls.at(-1)!.bin).toBe("dropdb");
  });

  it("prints names and counts only, and no value of the deploy file", async () => {
    const s = setup();
    const res = await go(s, ["--file", s.file, "--identity", s.identity, "--restore"]);
    expectNoLeak(res.text, s.f);
    // every psql command is a count or a catalog listing: no row is ever selected
    for (const call of res.calls.filter((c) => c.bin === "psql")) expect(call.args.at(-1)).toMatch(/^select (count\(\*\)|schemaname \|\| '\.' \|\| tablename) from /);
  });

  it("a files backup: decrypts, counts the archive's files, prints no names", async () => {
    const s = setup({}, "tar");
    const res = await go(s, ["--file", s.file, "--identity", s.identity]);
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => c.bin)).toEqual(["age-keygen", "age", "tar"]);
    expect(res.text).toContain("the archive reads: 2 files");
    expect(res.text).not.toContain("visit-1.wav");
    expect(existsSync(path.dirname(plainPathOf(res.calls)))).toBe(false);
  });
});
