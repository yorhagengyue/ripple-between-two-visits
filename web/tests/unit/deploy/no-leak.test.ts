/**
 * No deploy script prints a value of the deploy file (or of the test file): names only (C2 track P).
 * Every script is run three ways against the fake files: as a dry run, with --yes and tools that succeed, and with
 * --yes and tools that fail while spitting every secret back in their output (as a real ssh, psql or git might echo a
 * host, a user or a connection string in an error). Whatever each script printed is searched for every value.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { main as backupVerify } from "@/scripts/deploy/backup-verify";
import { main as checkEnv } from "@/scripts/deploy/check-env";
import { main as edgeCheck } from "@/scripts/deploy/edge-check";
import { Output } from "@/scripts/deploy/lib/cli";
import { type Cmd, realRunner, type Runner } from "@/scripts/deploy/lib/exec";
import { main as prodDb } from "@/scripts/deploy/prod-db";
import { main as provision } from "@/scripts/deploy/provision";
import { main as pushEnv } from "@/scripts/deploy/push-env";
import { main as pushSecrets } from "@/scripts/deploy/push-secrets";
import { main as release } from "@/scripts/deploy/release";
import { main as rollback } from "@/scripts/deploy/rollback";
import { main as status } from "@/scripts/deploy/status";
import { APP_EXTRA, BACKUP_EXTRA, expectNoLeak, type FakeFiles, fakeFiles, forbiddenPieces, quietOutput, remoteOpOf, resultLine } from "./helpers";

const WEB = webRoot();
const SHA = "d99d02f0123456789abcdef0123456789abcdef0";

type Script = (argv: string[], out: Output, run: Runner, fetchFn: typeof fetch) => Promise<number>;

const SCRIPTS: Array<{ name: string; argv: string[]; run: Script }> = [
  { name: "check-env", argv: ["--speech", "whisper", "--tts", "trtc"], run: (a, o) => checkEnv(a, o, WEB) },
  { name: "check-env --create-secrets", argv: ["--create-secrets"], run: (a, o) => checkEnv(a, o, WEB) },
  { name: "provision", argv: [], run: (a, o, r) => provision(a, o, r, WEB) },
  { name: "prod-db migrate", argv: ["migrate"], run: (a, o, r) => prodDb(a, o, r, WEB) },
  { name: "prod-db migrate --status", argv: ["migrate", "--status"], run: (a, o, r) => prodDb(a, o, r, WEB) },
  { name: "prod-db inspect", argv: ["inspect", "--counts", "--actor", "owner", "--reason", "leak test of the output"], run: (a, o, r) => prodDb(a, o, r, WEB) },
  { name: "prod-db setup-storage", argv: ["setup-storage"], run: (a, o, r) => prodDb(a, o, r, WEB) },
  { name: "prod-db privileges", argv: ["privileges"], run: (a, o, r) => prodDb(a, o, r, WEB) },
  { name: "prod-db preflight", argv: ["preflight"], run: (a, o, r) => prodDb(a, o, r, WEB) },
  { name: "push-env", argv: ["--speech", "mock", "--tts", "mock"], run: (a, o, r) => pushEnv(a, o, r, WEB) },
  { name: "push-env --restore-prev", argv: ["--restore-prev"], run: (a, o, r) => pushEnv(a, o, r, WEB) },
  { name: "push-secrets", argv: [], run: (a, o, r) => pushSecrets(a, o, r, WEB) },
  { name: "push-secrets --restore-prev", argv: ["--restore-prev"], run: (a, o, r) => pushSecrets(a, o, r, WEB) },
  { name: "release", argv: ["--commit", SHA], run: (a, o, r, f) => release(a, o, { run: r, fetchFn: f, now: () => new Date("2026-10-16T01:30:00Z") }, WEB) },
  { name: "rollback", argv: [], run: (a, o, r) => rollback(a, o, r, WEB) },
  { name: "status", argv: [], run: (a, o, r) => status(a, o, r, WEB) },
  { name: "edge-check", argv: ["--speech", "mock", "--tts", "mock"], run: (a, o, _r, f) => edgeCheck(a, o, { fetchFn: f, sleep: async () => {}, sseMs: 30, pingGapMs: 20, longMs: 10 }, WEB) },
];

/**
 * Everything a careless tool could echo: every value of both fake files, the project references and the database
 * passwords on their own, and the login as ssh prints it. (The other forbidden pieces are fragments of these, there to
 * catch half a value in an output; no tool prints them alone.)
 */
const FRAGMENTS = ["pooler.supabase.com", "fake-ripple-zz", "fake-key-zz"];
const spill = (f: FakeFiles) => `${forbiddenPieces(f).filter((p) => !FRAGMENTS.includes(p)).join(" | ")} | ${f.values.DEPLOY_USER}@${f.values.DEPLOY_HOST}: Permission denied (publickey)\n`;

function setup() {
  const f = fakeFiles({ ...APP_EXTRA, ...BACKUP_EXTRA, DEPLOY_ACME_EMAIL: "ops@fake-ripple-zz.example" });
  const backup = path.join(f.dir, "2026-10-16T030000.dump.age");
  const identity = path.join(f.dir, "owner-age-key.txt");
  writeFileSync(backup, "age-encryption.org/v1\n");
  writeFileSync(identity, "stand-in\n");
  return { f, backup, identity };
}

describe("no script prints a value of the deploy file", () => {
  for (const script of SCRIPTS) {
    it(`${script.name}: dry run`, async () => {
      const { f } = setup();
      const out = quietOutput();
      let calls = 0;
      const code = await script.run([...script.argv, ...f.flags, "--dry-run"], out, async () => (calls++, { code: 0, stdout: "", stderr: "" }), (async () => (calls++, new Response(""))) as typeof fetch);
      expect(calls, "a dry run starts nothing and requests nothing").toBe(0);
      expect([0, 1]).toContain(code);
      expect(out.lines.length).toBeGreaterThan(1);
      expectNoLeak(out.text(), f);
    });

    it(`${script.name}: --yes, tools succeed and echo everything`, async () => {
      const { f } = setup();
      const out = quietOutput();
      const run: Runner = async (cmd: Cmd) => {
        const op = remoteOpOf(cmd);
        // what the real runner does with a child's lines: they go through the output
        if (cmd.echo) out.say(`    | ${spill(f)}`);
        return { code: 0, stdout: spill(f) + (op ? resultLine({ op, status: "ok", release: "20261016T013000-d99d02f", build: "B" }) : SHA), stderr: spill(f) };
      };
      await script.run([...script.argv, ...f.flags, "--yes"], out, run, (async () => Response.json({ ok: true, build: "B", echo: spill(f) })) as typeof fetch);
      expectNoLeak(out.text(), f);
    });

    it(`${script.name}: --yes, tools fail and echo everything`, async () => {
      const { f } = setup();
      const out = quietOutput();
      const run: Runner = async (cmd: Cmd) => {
        if (cmd.echo) out.say(`    | ${spill(f)}`);
        return { code: 1, stdout: spill(f), stderr: `error: could not connect: ${spill(f)}` };
      };
      await script.run([...script.argv, ...f.flags, "--yes"], out, run, (async () => new Response(spill(f), { status: 502, headers: { "X-Echo": "fake-ripple-zz" } })) as typeof fetch);
      expectNoLeak(out.text(), f);
    });
  }

  it("backup-verify: dry run, a good drill, and tools that fail while echoing everything", async () => {
    for (const mode of ["dry", "good", "bad"] as const) {
      const { f, backup, identity } = setup();
      const out = quietOutput();
      const run: Runner = async (cmd) => {
        if (mode === "bad" && cmd.bin !== "age-keygen") return { code: 1, stdout: spill(f), stderr: spill(f) };
        if (cmd.bin === "age-keygen") return { code: 0, stdout: `${BACKUP_EXTRA.BACKUP_AGE_RECIPIENT}\n`, stderr: "" };
        if (cmd.bin === "pg_restore" && cmd.args[0] === "--list") return { code: 0, stdout: "1; 0 1 TABLE DATA auth users x\n2; 0 2 TABLE DATA public session x\n", stderr: "" };
        if (cmd.bin === "psql") return { code: 0, stdout: (cmd.args.at(-1) ?? "").includes("pg_tables") ? "auth.users\npublic.session\n" : "0\n", stderr: spill(f) };
        return { code: 0, stdout: "", stderr: spill(f) };
      };
      await backupVerify(["--file", backup, "--identity", identity, "--restore", ...f.flags, ...(mode === "dry" ? ["--dry-run"] : [])], out, run, WEB);
      expect(out.lines.length).toBeGreaterThan(1);
      expectNoLeak(out.text(), f);
    }
  });

  it("the real runner passes a child's own output through the same hiding", async () => {
    const { f } = setup();
    const lines: string[] = [];
    const out = new Output((line) => lines.push(line));
    out.hide(f.values);
    const res = await realRunner(out)({
      bin: process.execPath,
      args: ["-e", "console.log('connecting to ' + process.env.LEAK_A); console.error('refused: ' + process.env.LEAK_B)"],
      env: { ...process.env, LEAK_A: f.values.SUPABASE_DB_URL, LEAK_B: f.values.SUPABASE_SERVICE_KEY },
      show: "node -e <print>",
      echo: true,
    });
    expect(res.code).toBe(0);
    expect(lines.join("\n")).toContain("connecting to <SUPABASE_DB_URL>");
    expect(lines.join("\n")).toContain("refused: <SUPABASE_SERVICE_KEY>");
    expectNoLeak(lines.join("\n"), f);
  });

  it("every script of the folder is in this test", async () => {
    const { readdirSync } = await import("node:fs");
    const scripts = readdirSync(path.join(WEB, "scripts", "deploy")).filter((n) => n.endsWith(".ts")).map((n) => n.replace(/\.ts$/, ""));
    const covered = new Set([...SCRIPTS.map((s) => s.name.split(" ")[0]), "backup-verify"]);
    expect(scripts.filter((n) => !covered.has(n))).toEqual([]);
  });
});
