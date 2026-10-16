/**
 * The deploy scripts' shared parts (C2 track P): options, the three modes, the output that hides values, the deploy
 * file's names and shapes, the secrets made locally, and check-env.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { vapidPairMatches } from "@/lib/push/crypto";
import { checkEnv, main as checkEnvMain } from "@/scripts/deploy/check-env";
import { FIXED } from "@/scripts/deploy/lib/app-env";
import { DeployError, finish, modeOf, Output, parseArgs, runPlan, type Step } from "@/scripts/deploy/lib/cli";
import {
  appNamesFrom,
  createSecrets,
  CREATABLE,
  fileOnlyNames,
  keyRole,
  loadContext,
  missingCreatable,
  nameProblems,
  parseEnvText,
  projectRefOfDbUrl,
  projectRefOfUrl,
  readAppNames,
  readEnvFile,
  refuseTestDatabase,
  sha8,
  shapeProblem,
} from "@/scripts/deploy/lib/deploy-file";
import { APP_EXTRA, BACKUP_EXTRA, expectNoLeak, fakeFiles, fullDeploy, PROD_REF, quietOutput, TEST_ENV, TEST_REF } from "./helpers";

const WEB = webRoot();

describe("options and modes", () => {
  it("stops on an option it does not know, so a mistyped --dry-run never becomes a real run", () => {
    expect(() => parseArgs(["--dryrun"])).toThrow(DeployError);
    expect(() => parseArgs(["--yes", "--dry_run"])).toThrow(/unknown option/);
  });

  it("reads --name value and --name=value, and refuses a missing or repeated value", () => {
    const a = parseArgs(["migrate", "--deploy-file", "x", "--speech=mock"], { value: ["speech"] });
    expect(a.positional).toEqual(["migrate"]);
    expect(a.value("deploy-file")).toBe("x");
    expect(a.value("speech")).toBe("mock");
    expect(() => parseArgs(["--speech"], { value: ["speech"] })).toThrow(/needs a value/);
    expect(() => parseArgs(["--speech", "--yes"], { value: ["speech"] })).toThrow(/needs a value/);
    expect(() => parseArgs(["--speech", "a", "--speech", "b"], { value: ["speech"] })).toThrow(/twice/);
    expect(() => parseArgs(["--yes=1"])).toThrow(/takes no value/);
  });

  it("acts only with --yes, and --dry-run wins over it", () => {
    expect(modeOf(parseArgs([]))).toBe("refuse");
    expect(modeOf(parseArgs(["--yes"]))).toBe("act");
    expect(modeOf(parseArgs(["--dry-run"]))).toBe("dry-run");
    expect(modeOf(parseArgs(["--yes", "--dry-run"]))).toBe("dry-run");
  });

  it("runs no step without --yes and none in a dry run, and says so", async () => {
    let ran = 0;
    const steps: Step[] = [{ title: "one", show: ["cmd"], run: async () => void ran++ }];
    const refuse = quietOutput();
    expect(await runPlan(refuse, "refuse", "plan", steps)).toBe(2);
    expect(refuse.text()).toMatch(/Nothing was done.*--yes/);
    const dry = quietOutput();
    expect(await runPlan(dry, "dry-run", "plan", steps)).toBe(0);
    expect(dry.text()).toContain("Dry run: nothing was touched.");
    expect(ran).toBe(0);
    expect(await runPlan(quietOutput(), "act", "plan", steps)).toBe(0);
    expect(ran).toBe(1);
  });
});

describe("the output hides values", () => {
  it("prints a hidden value as its name, the longest match first", () => {
    const out = quietOutput();
    out.hide({ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_KEY: "sb_secret_long-value-0123456789" });
    out.say("GET https://abcdefghijklmnopqrst.supabase.co/rest/v1 with sb_secret_long-value-0123456789");
    expect(out.text()).toBe("GET <SUPABASE_URL>/rest/v1 with <SUPABASE_SERVICE_KEY>");
  });

  it("also hides a connection string's host, user and password on their own", () => {
    const out = quietOutput();
    out.hide({ SUPABASE_DB_URL: "postgresql://postgres.abcdefghijklmnopqrst:S3cretPass%21word@aws-0-xx.pooler.supabase.com:5432/postgres" });
    out.say("could not connect to aws-0-xx.pooler.supabase.com as postgres.abcdefghijklmnopqrst (S3cretPass!word / S3cretPass%21word)");
    expect(out.text()).not.toMatch(/pooler|abcdefghijklmnopqrst|S3cret/);
  });

  it("hides a short value where it stands as a word, the login in front of an @, and a project reference on its own", () => {
    const out = quietOutput();
    out.hide({ DEPLOY_USER: "ubuntu", DEPLOY_SSH_PORT: "2222", SHORT: "dq7x", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_DB_URL: "postgresql://postgres.abcdefghijklmnopqrst:S3cretPassword@aws-0-xx.pooler.supabase.com:5432/postgres" });
    out.say("ubuntu@203.0.113.9: Permission denied; Ubuntu 24.04, archive.ubuntu.com");
    out.say("dq7x said dq7xyz, 2222 files; project abcdefghijklmnopqrst is paused");
    expect(out.lines[0]).toBe("<DEPLOY_USER>@203.0.113.9: Permission denied; Ubuntu 24.04, archive.ubuntu.com");
    expect(out.lines[1]).toBe("<SHORT> said dq7xyz, 2222 files; project <SUPABASE_URL part> is paused");
  });

  it("labels a test-file value differently and leaves ordinary words alone", () => {
    const out = quietOutput();
    out.hide({ DEPLOY_USER: "ubuntu", SPEECH: "mock" });
    out.hide({ SUPABASE_URL: "https://testtesttesttesttest.supabase.co" }, (n) => `<test ${n}>`);
    out.say("ubuntu runs mock against https://testtesttesttesttest.supabase.co");
    expect(out.text()).toBe("ubuntu runs mock against <test SUPABASE_URL>");
  });
});

describe("the deploy file's names", () => {
  it("finds duplicates and lines that are not NAME=value, and drops empty values", () => {
    const f = parseEnvText("A=1\n# note\n\nB=\nthis is not a line\nA=2\nexport C='x y'\n");
    expect(f.names).toEqual(["A", "B", "C"]);
    expect(f.duplicates).toEqual(["A"]);
    expect(f.badLines).toEqual([5]);
    expect(f.values.B).toBeUndefined();
    expect(f.values.C).toBe("x y");
  });

  it("takes the app's names and the [not deployed] marks from .env.example", () => {
    const names = appNamesFrom("# note\nSTORE=memory   # memory | supabase\nPREVIEW_URL=   # [not deployed] local\n# COMMENTED=1\nSTORE=again\n");
    expect(names.all).toEqual(["STORE", "PREVIEW_URL"]);
    expect(names.notDeployed).toEqual(["PREVIEW_URL"]);
  });

  it("the real .env.example marks exactly these names as never deployed", () => {
    // adding a name to .env.example is a decision made there: marked or not. This pin makes a change of the list visible.
    expect(readAppNames(WEB).notDeployed.sort()).toEqual(
      ["ADP_APP_KEY", "BLOB_LOCAL_DIR", "CASSETTE_DIR", "MOCK_ASR_JOB_MS", "OPENAI_API_KEY", "PREVIEW_URL", "REPLAY_CHECKER_PROVIDER", "REPLAY_PROVIDER", "RIPPLE_DEV_TOOLS", "SCRIPTED_FALLBACK_KEY", "SUPABASE_DB_URL", "TRTC_SDK_SECRET_KEY"].sort(),
    );
  });

  it("every name the scripts write or create is an app name of .env.example, and none is marked", () => {
    const app = readAppNames(WEB);
    for (const name of [...Object.keys(FIXED), ...CREATABLE, "APP_BASE_URL", "SPEECH_PROVIDER", "TTS_PROVIDER", "ASR_REPLAY_FALLBACK", "BUS_STREAM_MAX_MS", "RIPPLE_PUBLIC_HOSTS", "VAPID_SUBJECT", "SUPABASE_ANON_KEY", "AUTH_USERNAME_DOMAIN", "RIPPLE_DEEPSEEK_API_KEY"]) {
      expect(app.all, name).toContain(name);
      expect(app.notDeployed, name).not.toContain(name);
    }
    // the deploy-only names are not app names
    for (const name of fileOnlyNames().filter((n) => n !== "SUPABASE_DB_URL")) expect(app.all, name).not.toContain(name);
  });

  it("refuses unknown names, retired names, test-only switches and marked names with a value", () => {
    const app = readAppNames(WEB);
    const file = parseEnvText("DEPLOY_HOST=1.2.3.4\nDEEPSEEK_API_KEY=x\nRIPPLE_TEST_CLOCK=2026-01-01\nSCRIPTED_FALLBACK_KEY=crew\nPREVIEW_URL=\nSUPABASE_DB_URL=postgres://x\nSUPABSE_URL=typo\n");
    const problems = nameProblems(file, app);
    expect(problems.filter((p) => /is not a name these scripts know/.test(p)).map((p) => p.split(" ")[0])).toEqual(["DEEPSEEK_API_KEY", "RIPPLE_TEST_CLOCK", "SUPABSE_URL"]);
    expect(problems.some((p) => p.startsWith("SCRIPTED_FALLBACK_KEY is marked [not deployed]"))).toBe(true);
    // marked but empty is fine; the connection string is marked for the app and still belongs in this file
    expect(problems.some((p) => p.startsWith("PREVIEW_URL"))).toBe(false);
    expect(problems.some((p) => p.startsWith("SUPABASE_DB_URL"))).toBe(false);
  });

  it("stops every script at a name problem, naming the names and no value", () => {
    const f = fakeFiles({ SUPABSE_URL: "https://typo-value-zz.example" });
    const out = quietOutput();
    expect(() => loadContext(parseArgs(f.flags), WEB, out)).toThrow(/SUPABSE_URL is not a name/);
    try {
      loadContext(parseArgs(f.flags), WEB, out);
    } catch (err) {
      expect((err as Error).message).not.toContain("typo-value-zz");
    }
  });

  it("stops when the deploy file does not exist", () => {
    expect(() => loadContext(parseArgs(["--deploy-file", path.join(WEB, "no-such-file.env.deploy")]), WEB, quietOutput())).toThrow(/no deploy file/);
  });
});

describe("shapes", () => {
  const all = { ...fakeFiles().values };
  const bad = (name: string, value: string, more: Record<string, string> = {}) => shapeProblem(name, value, { ...all, ...more, [name]: value });

  it("accepts the fake file as it is", () => {
    for (const [name, value] of Object.entries({ ...all, ...APP_EXTRA, ...BACKUP_EXTRA })) expect(shapeProblem(name, value, { ...all, ...APP_EXTRA, ...BACKUP_EXTRA }), name).toBeNull();
  });

  it("names what is wrong, never the value", () => {
    expect(bad("DEPLOY_HOST", "not a host!")).toMatch(/IPv4 address or a host name/);
    expect(bad("DEPLOY_USER", "Ubuntu User")).toMatch(/user name/);
    expect(bad("DEPLOY_SSH_KEY", "/no/such/key-zz.pem")).toMatch(/does not exist/);
    expect(bad("DEPLOY_APP_DOMAIN", "https://app.example.com")).toMatch(/host name/);
    expect(bad("DEPLOY_APP_DOMAIN", all.DEPLOY_ORIGIN_DOMAIN)).toMatch(/must differ/);
    expect(bad("SUPABASE_URL", "http://localhost:54321")).toMatch(/supabase\.co/);
    expect(bad("SUPABASE_DB_URL", "https://example.com")).toMatch(/postgres:\/\//);
    expect(bad("SUPABASE_DB_URL", `postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`)).toMatch(/IPv6 only/);
    expect(bad("SUPABASE_DB_URL", `postgresql://postgres.${PROD_REF}@aws-0.pooler.supabase.com:5432/postgres`)).toMatch(/no password/);
    expect(bad("SUPABASE_DB_URL", `postgresql://postgres.${TEST_REF}:pw@aws-0.pooler.supabase.com:5432/postgres`)).toMatch(/another project than SUPABASE_URL/);
    expect(bad("SUPABASE_ANON_KEY", "sb_secret_swapped-0123456789")).toMatch(/secret \(service\) key/);
    expect(bad("SUPABASE_SERVICE_KEY", "sb_publishable_swapped-0123456789")).toMatch(/publishable \(anon\) key/);
    expect(bad("SUPABASE_ANON_KEY", all.SUPABASE_SERVICE_KEY)).toMatch(/same as SUPABASE_SERVICE_KEY/);
    expect(bad("EDGE_SECRET", "short")).toMatch(/32 or more/);
    expect(bad("EDGE_SECRET", "has spaces and {braces} 0123456789012345678901234567890")).toMatch(/letters, digits/);
    expect(bad("BLOB_SIGNING_SECRET", "short")).toMatch(/shorter than 32/);
    expect(bad("BACKUP_AGE_RECIPIENT", "AGE-SECRET-KEY-1ZZZ")).toMatch(/not an age public key/);
    expect(bad("BACKUP_HEARTBEAT_URL", "http://heartbeat.example/ping")).toMatch(/https/);
    expect(bad("BACKUP_COS_BUCKET", "NoAppId")).toMatch(/bucket name/);
    expect(bad("VAPID_PUBLIC_KEY", APP_EXTRA.VAPID_PUBLIC_KEY, { VAPID_PRIVATE_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).toMatch(/does not belong/);
    expect(bad("VAPID_PUBLIC_KEY", APP_EXTRA.VAPID_PUBLIC_KEY)).toMatch(/other half is missing/);
  });

  it("reads a key's role from old-style keys too, without a network call", () => {
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    expect(keyRole(jwt("anon"))).toBe("publishable");
    expect(keyRole(jwt("service_role"))).toBe("secret");
    expect(keyRole("something-else")).toBeNull();
  });

  it("names a project by the first 8 characters of its hash only", () => {
    expect(projectRefOfUrl(`https://${PROD_REF}.supabase.co`)).toBe(PROD_REF);
    expect(projectRefOfDbUrl(`postgresql://postgres.${PROD_REF}:pw@aws-0.pooler.supabase.com:6543/postgres`)).toBe(PROD_REF);
    expect(sha8(PROD_REF)).toMatch(/^[0-9a-f]{8}$/);
    expect(sha8(PROD_REF)).not.toBe(sha8(TEST_REF));
  });
});

describe("production is never the test project", () => {
  const ctxOf = (f: ReturnType<typeof fakeFiles>) => loadContext(parseArgs(f.flags), WEB, quietOutput());

  it("accepts two different projects", () => {
    expect(refuseTestDatabase(ctxOf(fakeFiles()))).toBeNull();
  });

  it("refuses the test project's address", () => {
    expect(() => refuseTestDatabase(ctxOf(fakeFiles({ SUPABASE_URL: TEST_ENV.SUPABASE_URL })))).toThrow(/SUPABASE_URL in the deploy file is the test project's/);
    expect(() => refuseTestDatabase(ctxOf(fakeFiles({ SUPABASE_URL: `${TEST_ENV.SUPABASE_URL.toUpperCase().replace("HTTPS", "https")}/` })))).toThrow(/test project/);
  });

  it("refuses the test database's connection string", () => {
    expect(() => refuseTestDatabase(ctxOf(fakeFiles({ SUPABASE_DB_URL: TEST_ENV.SUPABASE_DB_URL })))).toThrow(/SUPABASE_DB_URL in the deploy file is the test database's/);
  });

  it("refuses the test project's key and the same project under another connection string", () => {
    expect(() => refuseTestDatabase(ctxOf(fakeFiles({ SUPABASE_SERVICE_KEY: TEST_ENV.SUPABASE_SERVICE_KEY })))).toThrow(/test project's key/);
    expect(() => refuseTestDatabase(ctxOf(fakeFiles({ SUPABASE_DB_URL: `postgresql://postgres.${TEST_REF}:OtherPassw0rd@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` })))).toThrow(/same Supabase project as web\/\.env/);
  });

  it("says so when there is no test file to compare with", () => {
    expect(refuseTestDatabase(ctxOf(fakeFiles({}, { withTest: false })))).toMatch(/no test file to compare with/);
  });
});

describe("secrets made on this computer", () => {
  it("creates only what is missing, appends it, and never replaces a value", () => {
    const f = fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET });
    const before = readFileSync(f.deployFile, "utf8");
    expect(missingCreatable(readEnvFile(f.deployFile).values).sort()).toEqual(CREATABLE.filter((n) => n !== "EDGE_SECRET").sort());
    const made = createSecrets(readEnvFile(f.deployFile));
    expect(made.sort()).toEqual(CREATABLE.filter((n) => n !== "EDGE_SECRET").sort());
    const after = readFileSync(f.deployFile, "utf8");
    expect(after.startsWith(before)).toBe(true);
    const values = readEnvFile(f.deployFile).values;
    expect(values.EDGE_SECRET).toBe(APP_EXTRA.EDGE_SECRET);
    for (const name of ["BLOB_SIGNING_SECRET", "AUTH_COOKIE_SECRET", "RATE_LIMIT_SALT", "RECOVERY_PEPPER"]) expect(values[name]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(["BLOB_SIGNING_SECRET", "AUTH_COOKIE_SECRET", "RATE_LIMIT_SALT", "RECOVERY_PEPPER"].map((n) => values[n])).size).toBe(4);
    expect(vapidPairMatches({ publicKey: values.VAPID_PUBLIC_KEY, privateKey: values.VAPID_PRIVATE_KEY })).toBe(true);
    expect(createSecrets(readEnvFile(f.deployFile))).toEqual([]);
    expect(readFileSync(f.deployFile, "utf8")).toBe(after);
  });

  it("leaves half a key pair alone", () => {
    const f = fakeFiles({ VAPID_PUBLIC_KEY: APP_EXTRA.VAPID_PUBLIC_KEY });
    expect(missingCreatable(readEnvFile(f.deployFile).values)).not.toContain("VAPID_PRIVATE_KEY");
  });

  it("appends after a file that does not end with a line break", () => {
    const f = fakeFiles();
    writeFileSync(f.deployFile, readFileSync(f.deployFile, "utf8").trimEnd());
    createSecrets(readEnvFile(f.deployFile), ["EDGE_SECRET"]);
    const file = readEnvFile(f.deployFile);
    expect(file.badLines).toEqual([]);
    expect(file.values.SUPABASE_DB_URL).toBe(f.values.SUPABASE_DB_URL);
    expect(file.values.EDGE_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("check-env", () => {
  it("with today's deploy file: provision and prod-db are ready, the rest says what is missing and who supplies it", async () => {
    const f = fakeFiles();
    const out = quietOutput();
    expect(await checkEnvMain(f.flags, out, WEB)).toBe(0);
    const text = out.text();
    expect(text).toMatch(/ready\s+provision/);
    expect(text).toMatch(/ready\s+prod-db/);
    expect(text).toMatch(/blocked\s+push-env/);
    expect(text).toMatch(/only the owner can supply: RIPPLE_DEEPSEEK_API_KEY, AUTH_USERNAME_DOMAIN/);
    expect(text).toMatch(/created here on first use.*EDGE_SECRET/);
    expect(text).toMatch(/blocked\s+push-secrets \(backup\)/);
    expect(text).toMatch(/BACKUP_AGE_RECIPIENT: the public half/);
    expect(text).toContain("the production project is not the test project of web/.env: ok");
    expectNoLeak(text, f);
  });

  it("shows what each open decision adds", () => {
    const ctx = loadContext(parseArgs(fullDeploy().flags), WEB, quietOutput());
    const pushEnv = (speech?: string, tts?: string) => checkEnv(ctx, speech, tts).stages.find((s) => s.name === "push-env")!;
    expect(pushEnv("mock", "mock").ready).toBe(true);
    expect(pushEnv("whisper", "mock").missingOwner).toEqual(["WHISPER_URL", "WHISPER_TOKEN"]);
    expect(pushEnv("mock", "trtc").missingOwner).toEqual(["TRTC_SDK_APP_ID", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY"]);
    // Tencent Cloud speech recognition: the key pair (one pair for read-aloud too, named once)
    expect(pushEnv("tencent", "mock").missingOwner).toEqual(["TENCENT_SECRET_ID", "TENCENT_SECRET_KEY"]);
    expect(pushEnv("tencent", "trtc").missingOwner).toEqual(["TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TRTC_SDK_APP_ID"]);
  });

  it("fails on a malformed value and on the test project, by name", async () => {
    const f = fakeFiles({ DEPLOY_ORIGIN_DOMAIN: "https://origin.fake-ripple-zz.example/", SUPABASE_URL: TEST_ENV.SUPABASE_URL });
    const out = quietOutput();
    expect(await checkEnvMain(f.flags, out, WEB)).toBe(1);
    expect(out.text()).toMatch(/BAD\s+DEPLOY_ORIGIN_DOMAIN is not a host name/);
    expect(out.text()).toMatch(/BAD: SUPABASE_URL in the deploy file is the test project's/);
    expectNoLeak(out.text(), f);
  });

  it("--create-secrets only says what it would create without --yes, and creates without showing with it", async () => {
    const f = fakeFiles();
    const before = readFileSync(f.deployFile, "utf8");
    const dry = quietOutput();
    await checkEnvMain([...f.flags, "--create-secrets"], dry, WEB);
    expect(dry.text()).toMatch(/would create and append.*EDGE_SECRET.*Nothing was written/);
    expect(readFileSync(f.deployFile, "utf8")).toBe(before);
    const act = quietOutput();
    await checkEnvMain([...f.flags, "--create-secrets", "--yes"], act, WEB);
    expect(act.text()).toMatch(/created and appended to the deploy file \(values not shown\)/);
    expect(missingCreatable(readEnvFile(f.deployFile).values)).toEqual([]);
    expectNoLeak(act.text(), f);
  });
});

describe("the template and the README", () => {
  const DEPLOY = path.join(WEB, "scripts", "deploy");

  it("the template holds no value but the login user, and only names the scripts know", () => {
    const text = readFileSync(path.join(DEPLOY, "env.deploy.example"), "utf8");
    const file = parseEnvText(text);
    expect(file.badLines).toEqual([]);
    expect(file.values).toEqual({ DEPLOY_USER: "ubuntu" });
    expect(nameProblems(file, readAppNames(WEB))).toEqual([]);
    // the names it only mentions in comments are known too
    const mentioned = [...text.matchAll(/^# ([A-Z][A-Z0-9_]{3,})=/gm)].flatMap((m) => m[1]);
    const also = [...text.matchAll(/^# ((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?: {2,}[A-Z][A-Z0-9]*_[A-Z0-9_]+)*)(?: {2,}|$)/gm)].flatMap((m) => m[1].split(/\s+/));
    const known = new Set([...readAppNames(WEB).all, ...fileOnlyNames()]);
    expect([...mentioned, ...also].length).toBeGreaterThan(15);
    for (const name of [...mentioned, ...also]) expect(known.has(name), name).toBe(true);
  });

  it("the README names every script of the folder and the two open decisions as switches", () => {
    const readme = readFileSync(path.join(DEPLOY, "README.md"), "utf8");
    const scripts = readdirSync(DEPLOY).filter((n) => n.endsWith(".ts"));
    expect(scripts.length).toBe(10);
    for (const name of scripts) expect(readme, name).toContain(`\`${name}`);
    for (const name of ["server/backup.mjs", "server/backup-check.mjs", "server/provision.sh"]) expect(readme, name).toContain(name);
    expect(readme).toContain("--speech mock\\|whisper\\|tencent --tts mock\\|trtc");
    expect(readme).toMatch(/The two decisions still open are switches of `push-env\.ts`, required on every run/);
    expect(readme).toMatch(/TCP 80 and (TCP )?443/);
    expect(readme).toContain("X-Ripple-Edge");
    expect(readme).toContain("Allow new users to sign up");
    expect(readme).toContain("versioning switched on first");
  });

  it("every script ends through finish(): none calls process.exit() the moment its last request returned", () => {
    // On Windows that call aborts Node while a fetch's connection is still closing (exit code 127 after a release that
    // succeeded); finish() sets the code and lets the process end by itself.
    for (const name of readdirSync(DEPLOY).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(path.join(DEPLOY, name), "utf8");
      expect(text, name).toMatch(/void main\(process\.argv\.slice\(2\), new Output\(\)\)\.then\(finish\);/);
      expect(text, name).not.toMatch(/process\.exit\(/);
    }
    const before = process.exitCode;
    vi.useFakeTimers();
    try {
      finish(3);
      expect(process.exitCode).toBe(3);
      expect(vi.getTimerCount()).toBe(1); // the five-second fallback only: no exit at once
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      process.exitCode = before;
    }
  });
});
