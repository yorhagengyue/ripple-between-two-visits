/**
 * Shared by the deploy-script tests (C2 track P): a made-up deploy file and test file in a temporary folder, a command
 * runner that records instead of running, and the check that no value of those files shows up in what a script prints.
 * Every value here is invented and distinctive, so finding one in an output cannot be a coincidence. Nothing in these
 * tests reads web/.env or web/.env.deploy, and nothing connects anywhere.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect } from "vitest";
import { generateVapidKeys } from "@/lib/push/crypto";
import { Output } from "@/scripts/deploy/lib/cli";
import type { Cmd, CmdResult, Runner } from "@/scripts/deploy/lib/exec";

export const PROD_REF = "prodfakerefabcdefghij";
export const TEST_REF = "testfakerefklmnopqrst";
export const APP_DOMAIN = "app.fake-ripple-zz.example";
export const ORIGIN_DOMAIN = "origin.fake-ripple-zz.example";

const vapid = generateVapidKeys();

/** every temporary folder these helpers made for the test file that imported them, removed when that file is done */
const madeDirs: string[] = [];
afterAll(() => {
  for (const dir of madeDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What the owner's deploy file holds today: how to reach the server, the two names, the production project. */
export function baseDeploy(dir: string): Record<string, string> {
  return {
    DEPLOY_HOST: "203.0.113.77",
    // short on purpose: too short for the output's blanket hiding, so a leak of it means a command was shown by value
    DEPLOY_USER: "dq7x",
    DEPLOY_SSH_KEY: path.join(dir, "fake-key-zz.pem"),
    DEPLOY_APP_DOMAIN: APP_DOMAIN,
    DEPLOY_ORIGIN_DOMAIN: ORIGIN_DOMAIN,
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    SUPABASE_ANON_KEY: "sb_publishable_FAKEPRODanon0123456789zz",
    SUPABASE_SERVICE_KEY: "sb_secret_FAKEPRODservice0123456789zz",
    SUPABASE_DB_URL: `postgresql://postgres.${PROD_REF}:FakeProdPassw0rdZZ@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  };
}

/** Everything a push-env needs on top: the owner's key and decision, and the secrets this computer makes. */
export const APP_EXTRA: Record<string, string> = {
  HUNYUAN_API_KEY: "sk-FAKEtokenhub0123456789abcdefZZ",
  AUTH_USERNAME_DOMAIN: "users.fake-ripple-zz.example",
  EDGE_SECRET: "FAKEedge-0123456789abcdefghijklmnopqrstuvZZ",
  BLOB_SIGNING_SECRET: "FAKEblob-0123456789abcdefghijklmnopqrstuvZZ",
  AUTH_COOKIE_SECRET: "FAKEcookie-0123456789abcdefghijklmnopqrstZZ",
  RATE_LIMIT_SALT: "FAKEsalt-0123456789abcdefghijklmnopqrstuvZZ",
  RECOVERY_PEPPER: "FAKEpepper-0123456789abcdefghijklmnopqrstZZ",
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
};

export const BACKUP_EXTRA: Record<string, string> = {
  BACKUP_COS_BUCKET: "fake-ripple-backup-1250000000",
  BACKUP_COS_REGION: "ap-singapore",
  BACKUP_COS_SECRET_ID: "AKIDFAKEcosid0123456789ZZ",
  BACKUP_COS_SECRET_KEY: "FAKEcoskey0123456789abcdefZZ",
  BACKUP_HEARTBEAT_URL: "https://heartbeat.fake-ripple-zz.example/ping/FAKEtoken0123456789",
  BACKUP_AGE_RECIPIENT: `age1${"q".repeat(58)}`,
};

export const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
  SUPABASE_ANON_KEY: "sb_publishable_FAKETESTanon0123456789zz",
  SUPABASE_SERVICE_KEY: "sb_secret_FAKETESTservice0123456789zz",
  SUPABASE_DB_URL: `postgresql://postgres.${TEST_REF}:FakeTestPassw0rdZZ@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  STORE: "supabase",
};

export interface FakeFiles {
  dir: string;
  deployFile: string;
  testFile: string;
  values: Record<string, string>;
  test: Record<string, string>;
  /** the options that point a script at these two files */
  flags: string[];
}

const envText = (values: Record<string, string>) =>
  `${Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;

/**
 * Write a fake deploy file and a fake test file. `set`: extra or replaced names (null removes one).
 * `withTest: false` leaves the test file out.
 */
export function fakeFiles(set: Record<string, string | null> = {}, opts: { test?: Record<string, string | null>; withTest?: boolean; raw?: string } = {}): FakeFiles {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ripple-deploy-test-"));
  madeDirs.push(dir);
  const values = baseDeploy(dir);
  writeFileSync(values.DEPLOY_SSH_KEY, "not a key: a stand-in file for tests\n");
  for (const [k, v] of Object.entries(set)) {
    if (v === null) delete values[k];
    else values[k] = v;
  }
  const test = { ...TEST_ENV };
  for (const [k, v] of Object.entries(opts.test ?? {})) {
    if (v === null) delete test[k];
    else test[k] = v;
  }
  const deployFile = path.join(dir, "fake.env.deploy");
  const testFile = path.join(dir, "fake.env");
  writeFileSync(deployFile, envText(values) + (opts.raw ?? ""));
  if (opts.withTest !== false) writeFileSync(testFile, envText(test));
  return { dir, deployFile, testFile, values, test, flags: ["--deploy-file", deployFile, "--test-env", testFile] };
}

export const fullDeploy = (set: Record<string, string | null> = {}, opts: Parameters<typeof fakeFiles>[1] = {}) => fakeFiles({ ...APP_EXTRA, ...set }, opts);

export function quietOutput(): Output {
  return new Output(() => {});
}

export interface FakeRun {
  run: Runner;
  calls: Cmd[];
}

/** A runner that starts nothing: it records each command and answers what `answer` says (default: exit 0, no output). */
export function fakeRunner(answer: (cmd: Cmd, nth: number) => Partial<CmdResult> | void = () => {}): FakeRun {
  const calls: Cmd[] = [];
  const run: Runner = async (cmd) => {
    calls.push(cmd);
    return { code: 0, stdout: "", stderr: "", ...(answer(cmd, calls.length) ?? {}) };
  };
  return { run, calls };
}

/** The remote operation a recorded ssh command runs ("env-apply", "release", ...), or null. */
export function remoteOpOf(cmd: Cmd): string | null {
  const remote = cmd.args[cmd.args.length - 1] ?? "";
  return /--input-type=module - (\S+)/.exec(remote)?.[1] ?? null;
}

export const resultLine = (result: Record<string, unknown>) => `RIPPLE_RESULT ${JSON.stringify(result)}\n`;

/** Every piece of the fake files that must never be printed: the values, and the parts of the addresses. */
export function forbiddenPieces(f: FakeFiles): string[] {
  const pieces = new Set<string>();
  const current = { ...f.values };
  // values a script appended while it ran (created secrets) count too
  for (const line of readFileSync(f.deployFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.+)$/.exec(line);
    if (m) current[m[1]] = m[2];
  }
  for (const v of [...Object.values(current), ...Object.values(f.test)]) {
    if (v.length >= 4 && !["supabase", "ap-singapore"].includes(v)) pieces.add(v);
  }
  for (const extra of [PROD_REF, TEST_REF, "FakeProdPassw0rdZZ", "FakeTestPassw0rdZZ", "pooler.supabase.com", "fake-ripple-zz", "203.0.113.77", "fake-key-zz"]) pieces.add(extra);
  return [...pieces];
}

export function expectNoLeak(text: string, f: FakeFiles): void {
  for (const piece of forbiddenPieces(f)) expect(text.includes(piece), `the output contains a value of the fake files (${piece.slice(0, 6)}…)`).toBe(false);
}
