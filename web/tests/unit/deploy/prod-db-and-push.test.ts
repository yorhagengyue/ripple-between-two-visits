/**
 * prod-db, push-env and push-secrets (C2 track P): one test per refusal of docs/plan/hosting.md section 6, and what a
 * run with --yes sends. Nothing is started: the runner records.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { buildWebEnv, expectedHealth, FIXED, formatEnvFile, requiredHealth, switchesOf, webEnvProblems } from "@/scripts/deploy/lib/app-env";
import { parseArgs } from "@/scripts/deploy/lib/cli";
import { loadContext, readEnvFile } from "@/scripts/deploy/lib/deploy-file";
import { childEnv, main as prodDb } from "@/scripts/deploy/prod-db";
import { main as pushEnv } from "@/scripts/deploy/push-env";
import { backupState, main as pushSecrets } from "@/scripts/deploy/push-secrets";
import { APP_DOMAIN, APP_EXTRA, BACKUP_EXTRA, expectNoLeak, fakeFiles, fakeRunner, fullDeploy, PROD_REF, quietOutput, remoteOpOf, resultLine, TEST_ENV, TEST_REF } from "./helpers";

const WEB = webRoot();
const ctxOf = (f: ReturnType<typeof fakeFiles>) => loadContext(parseArgs(f.flags), WEB, quietOutput());

describe("prod-db", () => {
  const go = async (f: ReturnType<typeof fakeFiles>, argv: string[], answer?: Parameters<typeof fakeRunner>[0]) => {
    const out = quietOutput();
    const r = fakeRunner(answer);
    const code = await prodDb([...argv, ...f.flags], out, r.run, WEB);
    return { code, text: out.text(), calls: r.calls };
  };

  it("refuses when one of the four database variables is missing: an empty one would fall back to the test project", async () => {
    for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_DB_URL"]) {
      const res = await go(fakeFiles({ [name]: null }), ["migrate", "--yes"]);
      expect(res.code, name).toBe(2);
      expect(res.text, name).toMatch(new RegExp(`REFUSED:[\\s\\S]*${name} is not set`));
      expect(res.calls, name).toHaveLength(0);
    }
  });

  it("refuses when the production address is the test project's", async () => {
    const res = await go(fakeFiles({ SUPABASE_URL: TEST_ENV.SUPABASE_URL, SUPABASE_DB_URL: `postgresql://postgres.${TEST_REF}:AnotherPassw0rdZZ@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` }), ["migrate", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/SUPABASE_URL in the deploy file is the test project's/);
    expect(res.calls).toHaveLength(0);
  });

  it("refuses when the production connection string is the test database's", async () => {
    const res = await go(fakeFiles({ SUPABASE_DB_URL: TEST_ENV.SUPABASE_DB_URL }), ["migrate", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/REFUSED/);
    expect(res.calls).toHaveLength(0);
  });

  it("refuses when the connection string names another project than the address", async () => {
    const res = await go(fakeFiles({ SUPABASE_DB_URL: "postgresql://postgres.otherfakerefuvwxyzabcd:SomePassw0rdZZ@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres" }), ["inspect", "--rls", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/SUPABASE_DB_URL names another project than SUPABASE_URL/);
    expect(res.calls).toHaveLength(0);
  });

  it("starts nothing without --yes, and nothing in a dry run", async () => {
    const f = fakeFiles();
    const refused = await go(f, ["migrate"]);
    expect(refused.code).toBe(2);
    expect(refused.text).toMatch(/Nothing was done/);
    expect(refused.calls).toHaveLength(0);
    const dry = await go(f, ["migrate", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.text).toContain("node scripts/db/migrate.mjs");
    expect(dry.text).toMatch(/migration files in this checkout \(\d+\): 0001_tables\.sql/);
    expect(dry.calls).toHaveLength(0);
  });

  it("puts the production project's four variables into the child, over whatever the shell had", async () => {
    const f = fakeFiles();
    const env = childEnv(ctxOf(f), { SUPABASE_URL: TEST_ENV.SUPABASE_URL, SUPABASE_DB_URL: TEST_ENV.SUPABASE_DB_URL, PREVIEW_URL: "https://elsewhere.example", PATH: "/bin" });
    expect(env.SUPABASE_URL).toBe(f.values.SUPABASE_URL);
    expect(env.SUPABASE_DB_URL).toBe(f.values.SUPABASE_DB_URL);
    expect(env.SUPABASE_SERVICE_KEY).toBe(f.values.SUPABASE_SERVICE_KEY);
    expect(env.SUPABASE_ANON_KEY).toBe(f.values.SUPABASE_ANON_KEY);
    expect(env.PREVIEW_URL).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });

  it("calls the existing script for each subcommand, from web/, and never puts a value on the command line", async () => {
    const f = fakeFiles();
    const cases: Array<[string[], RegExp]> = [
      [["migrate"], /scripts\/db\/migrate\.mjs$/],
      [["migrate", "--status"], /--status$/],
      [["inspect", "--rls"], /scripts\/db\/inspect\.mjs --rls$/],
      [["setup-storage"], /tsx.*cli\.mjs scripts\/setup-storage\.ts$/],
      [["privileges"], /scripts\/db\/check-privileges\.mjs$/],
      [["preflight"], new RegExp(`scripts/preflight\\.ts --url https://${APP_DOMAIN.replace(/\./g, "\\.")}$`)],
    ];
    for (const [argv, want] of cases) {
      const res = await go(f, [...argv, "--yes"]);
      expect(res.code, argv.join(" ")).toBe(0);
      expect(res.calls).toHaveLength(1);
      const call = res.calls[0];
      expect(call.args.join(" ").replace(/\\/g, "/"), argv.join(" ")).toMatch(want);
      expect(call.cwd).toBe(WEB);
      expect(call.env?.SUPABASE_DB_URL).toBe(f.values.SUPABASE_DB_URL);
      for (const secret of [f.values.SUPABASE_DB_URL, f.values.SUPABASE_SERVICE_KEY, f.values.SUPABASE_ANON_KEY]) expect(call.args.join(" ")).not.toContain(secret);
    }
  });

  it("row counts need who and why; with them the reason is passed on", async () => {
    const f = fakeFiles();
    const refused = await go(f, ["inspect", "--counts", "--yes"]);
    expect(refused.code).toBe(2);
    expect(refused.text).toMatch(/needs --actor <who> and --reason/);
    expect(refused.calls).toHaveLength(0);
    const ok = await go(f, ["inspect", "--counts", "--actor", "gengyue", "--reason", "first deployment: is the database empty", "--yes"]);
    expect(ok.calls[0].args.slice(-5)).toEqual(["--counts", "--actor", "gengyue", "--reason", "first deployment: is the database empty"]);
  });

  it("refuses a preflight against any link but the deploy file's public name", async () => {
    const res = await go(fakeFiles(), ["preflight", "--url", "https://staging.somewhere-else.example", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/--url is not https:\/\/<DEPLOY_APP_DOMAIN>/);
    expect(res.calls).toHaveLength(0);
  });

  it("prints the project as eight characters of a hash, never its reference or host; the child's exit code is the script's", async () => {
    const f = fakeFiles();
    const res = await go(f, ["migrate", "--status", "--yes"], () => ({ code: 1, stdout: `could not connect to aws-0-ap-southeast-1.pooler.supabase.com as postgres.${PROD_REF}\n` }));
    expect(res.code).toBe(1);
    expect(res.text).toMatch(/Production project \(sha256 of its reference, first 8\): [0-9a-f]{8}\./);
    expectNoLeak(res.text, f);
  });

  it("refuses an unknown subcommand", async () => {
    const res = await go(fakeFiles(), ["drop-everything", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.calls).toHaveLength(0);
  });
});

describe("the app's environment file", () => {
  const sw = { speech: "mock", tts: "mock" } as const;

  it("is what the deployed app starts with: no problem, and the health it will report", () => {
    const ctx = ctxOf(fullDeploy());
    const web = buildWebEnv(ctx, sw);
    expect(webEnvProblems(ctx, web, sw)).toEqual([]);
    for (const [name, value] of Object.entries(FIXED)) expect(web.env[name]).toBe(value);
    expect(web.env.APP_BASE_URL).toBe(`https://${APP_DOMAIN}`);
    expect(web.env.BUS_STREAM_MAX_MS).toBe("290000");
    expect(web.env.SPEECH_PROVIDER).toBe("mock");
    expect(web.env.SUPABASE_ANON_KEY).toBe(ctx.deploy.values.SUPABASE_ANON_KEY);
    expect(web.env.EDGE_SECRET).toBe(APP_EXTRA.EDGE_SECRET);
    expect(expectedHealth(web.env)).toEqual({ store: "supabase", blob: "supabase", auth: "supabase", llm: "hunyuan", checker: "hunyuan", speech: "mock", speech_problem: null, tts: "mock", jobs: true, deployed: true, push: true });
  });

  it("never holds the connection string, a deploy-only name or a backup setting", () => {
    const ctx = ctxOf(fullDeploy({ ...BACKUP_EXTRA, DEPLOY_ACME_EMAIL: "ops@fake-ripple-zz.example" }));
    const names = Object.keys(buildWebEnv(ctx, sw).env);
    expect(names).not.toContain("SUPABASE_DB_URL");
    expect(names.filter((n) => /^(DEPLOY_|BACKUP_)/.test(n))).toEqual([]);
  });

  it("requires both switches: neither open decision has a default", () => {
    expect(() => switchesOf(parseArgs(["--tts", "mock"], { value: ["speech", "tts", "profile"] }))).toThrow(/transcription service/);
    expect(() => switchesOf(parseArgs(["--speech", "mock"], { value: ["speech", "tts", "profile"] }))).toThrow(/read-aloud voice/);
    expect(() => switchesOf(parseArgs(["--speech", "siri", "--tts", "mock"], { value: ["speech", "tts", "profile"] }))).toThrow(/transcription service/);
    expect(switchesOf(parseArgs(["--profile", "judges", "--tts", "mock"], { value: ["speech", "tts", "profile"] }))).toEqual({ speech: "mock", tts: "mock" });
    expect(switchesOf(parseArgs(["--profile", "commercial", "--tts", "trtc"], { value: ["speech", "tts", "profile"] }))).toEqual({ speech: "whisper", tts: "trtc" });
    expect(() => switchesOf(parseArgs(["--profile", "judges", "--speech", "whisper", "--tts", "mock"], { value: ["speech", "tts", "profile"] }))).toThrow(/--profile judges means --speech mock/);
  });

  it("without a transcription service, writes mock and none of the service's settings, whatever the file says", () => {
    const ctx = ctxOf(fullDeploy({ SPEECH_PROVIDER: "whisper", WHISPER_URL: "https://asr.fake-ripple-zz.example", WHISPER_TOKEN: "FAKEwhisper-0123456789abcdefghijklmnopZZ", ASR_REPLAY_FALLBACK: "on" }));
    const web = buildWebEnv(ctx, sw);
    expect(web.env.SPEECH_PROVIDER).toBe("mock");
    expect(Object.keys(web.env).filter((n) => /^(WHISPER_|ASR_)/.test(n))).toEqual([]);
    expect(web.left.map((l) => l.name).sort()).toEqual(["ASR_REPLAY_FALLBACK", "SPEECH_PROVIDER", "WHISPER_TOKEN", "WHISPER_URL"]);
    expect(webEnvProblems(ctx, web, sw)).toEqual([]);
  });

  const problemsFor = (set: Record<string, string | null>, switches: { speech: "mock" | "whisper" | "tencent"; tts: "mock" | "trtc" } = sw) => {
    const ctx = ctxOf(fullDeploy(set));
    return webEnvProblems(ctx, buildWebEnv(ctx, switches), switches);
  };

  it("refuses a store or file driver that is not supabase (the file may not contradict what the script writes)", () => {
    expect(() => buildWebEnv(ctxOf(fullDeploy({ STORE: "memory" })), sw)).toThrow(/STORE is written by the script.*always supabase/);
    expect(() => buildWebEnv(ctxOf(fullDeploy({ BLOB_DRIVER: "local" })), sw)).toThrow(/BLOB_DRIVER is written by the script/);
    expect(() => buildWebEnv(ctxOf(fullDeploy({ AUTH_PROVIDER: "memory" })), sw)).toThrow(/AUTH_PROVIDER is written by the script/);
    expect(() => buildWebEnv(ctxOf(fullDeploy({ APP_BASE_URL: "http://localhost:3200" })), sw)).toThrow(/APP_BASE_URL is written by the script/);
    // repeating the script's own value is fine
    expect(buildWebEnv(ctxOf(fullDeploy({ STORE: "supabase", APP_BASE_URL: `https://${APP_DOMAIN}/` })), sw).env.STORE).toBe("supabase");
  });

  it("refuses a main model that is not Hunyuan, including the key left empty", () => {
    expect(() => buildWebEnv(ctxOf(fullDeploy({ LLM_PROVIDER: "mock" })), sw)).toThrow(/LLM_PROVIDER is written by the script/);
    const problems = problemsFor({ HUNYUAN_API_KEY: null });
    expect(problems.join("\n")).toMatch(/HUNYUAN_API_KEY is not set \(the owner supplies it/);
    expect(problems.join("\n")).toMatch(/the app would run with llm=mock; a deployment needs llm=hunyuan/);
  });

  it("refuses a checker that is missing, a mock or a replay", () => {
    expect(() => buildWebEnv(ctxOf(fullDeploy({ CHECKER_PROVIDER: "mock" })), sw)).toThrow(/CHECKER_PROVIDER is written by the script/);
    expect(() => buildWebEnv(ctxOf(fullDeploy({ CHECKER_PROVIDER: "replay" })), sw)).toThrow(/CHECKER_PROVIDER is written by the script/);
    expect(problemsFor({ HUNYUAN_API_KEY: null }).join("\n")).toMatch(/checker=none; a deployment needs checker=hunyuan/);
    // the checker may not be the main model itself: the app then has no checker
    expect(problemsFor({ CHECKER_MODEL: "hy3", LLM_MODEL: "hy3" }).join("\n")).toMatch(/checker=none/);
  });

  it("with a transcription service, refuses a missing, malformed or plain-http address and a missing or short token", () => {
    const whisper = { speech: "whisper", tts: "mock" } as const;
    const token = "FAKEwhisper-0123456789abcdefghijklmnopZZ";
    expect(problemsFor({ WHISPER_URL: "https://asr.fake-ripple-zz.example", WHISPER_TOKEN: token }, whisper)).toEqual([]);
    expect(problemsFor({ WHISPER_TOKEN: token }, whisper).join("\n")).toMatch(/speech_problem=no_url/);
    expect(problemsFor({ WHISPER_URL: "asr dot example", WHISPER_TOKEN: token }, whisper).join("\n")).toMatch(/speech_problem=bad_url/);
    expect(problemsFor({ WHISPER_URL: "https://asr.fake-ripple-zz.example" }, whisper).join("\n")).toMatch(/speech_problem=no_token/);
    expect(problemsFor({ WHISPER_URL: "https://asr.fake-ripple-zz.example", WHISPER_TOKEN: "short" }, whisper).join("\n")).toMatch(/speech_problem=short_token/);
    expect(problemsFor({ WHISPER_URL: "http://asr.fake-ripple-zz.example", WHISPER_TOKEN: token }, whisper).join("\n")).toMatch(/WHISPER_URL is not https:\/\//);
    const ctx = ctxOf(fullDeploy({ WHISPER_URL: "https://asr.fake-ripple-zz.example", WHISPER_TOKEN: token }));
    expect(buildWebEnv(ctx, whisper).env.ASR_REPLAY_FALLBACK).toBe("off");
    expect(() => buildWebEnv(ctxOf(fullDeploy({ ASR_REPLAY_FALLBACK: "on" })), whisper)).toThrow(/ASR_REPLAY_FALLBACK is written by the script/);
  });

  // the owner's decision of 2026-10-14: Tencent Cloud speech recognition (lib/asr/tencent.ts)
  it("--speech tencent: the key pair and its own settings go in, the replay fallback off; a missing key is named, never a value", () => {
    const tencent = { speech: "tencent", tts: "mock" } as const;
    expect(switchesOf(parseArgs(["--speech", "tencent", "--tts", "mock"], { value: ["speech", "tts", "profile"] }))).toEqual(tencent);
    const keys = { TENCENT_SECRET_ID: "AKIDFAKEtencent0123456789", TENCENT_SECRET_KEY: "FAKEtencentkey0123456789" };
    const ctx = ctxOf(fullDeploy({ ...keys, TENCENT_ASR_ENGINE: "16k_zh-PY", TRTC_SDK_APP_ID: "1400000000" }));
    const web = buildWebEnv(ctx, tencent);
    expect(webEnvProblems(ctx, web, tencent)).toEqual([]);
    expect(web.env).toMatchObject({ SPEECH_PROVIDER: "tencent", ASR_REPLAY_FALLBACK: "off", ...keys, TENCENT_ASR_ENGINE: "16k_zh-PY" });
    // read-aloud's own application id stays out without --tts trtc; the one key pair serves both
    expect(web.env.TRTC_SDK_APP_ID).toBeUndefined();
    expect(web.left).toEqual(expect.arrayContaining([{ name: "TRTC_SDK_APP_ID", why: "only with --tts trtc" }]));
    expect(expectedHealth(web.env)).toMatchObject({ speech: "tencent", speech_problem: null });
    // a missing key: named twice (the health it would report, and which variable), never a value
    const missing = problemsFor({ TENCENT_SECRET_ID: "AKIDFAKEtencent0123456789" }, tencent).join("\n");
    expect(missing).toMatch(/speech_problem=no_secret_key; a deployment needs speech_problem=null/);
    expect(missing).toMatch(/speech recognition \(--speech tencent\): TENCENT_SECRET_KEY is not set/);
    expect(missing).not.toContain("AKIDFAKEtencent0123456789");
    expect(problemsFor({ ...keys, TENCENT_ASR_ENGINE: "8k_zh" }, tencent).join("\n")).toMatch(/TENCENT_ASR_ENGINE is not a 16 kHz engine name/);
    // without --speech tencent its settings stay on this computer; the key pair goes only with --tts trtc
    const mockCtx = ctxOf(fullDeploy({ ...keys, TENCENT_ASR_REGION: "ap-singapore" }));
    const mockWeb = buildWebEnv(mockCtx, sw);
    expect(Object.keys(mockWeb.env).filter((n) => /^TENCENT_/.test(n))).toEqual([]);
    expect(mockWeb.left).toEqual(
      expect.arrayContaining([
        { name: "TENCENT_ASR_REGION", why: "only with --speech tencent" },
        { name: "TENCENT_SECRET_ID", why: "only with --speech tencent or --tts trtc" },
      ]),
    );
    expect(requiredHealth(tencent)).toMatchObject({ speech: "tencent", speech_problem: null });
  });

  it("with the real voice, refuses an incomplete configuration", () => {
    const trtc = { speech: "mock", tts: "trtc" } as const;
    expect(problemsFor({ TRTC_SDK_APP_ID: "1400000000", TENCENT_SECRET_ID: "AKIDFAKEtencent0123456789", TENCENT_SECRET_KEY: "FAKEtencentkey0123456789" }, trtc)).toEqual([]);
    expect(problemsFor({}, trtc).join("\n")).toMatch(/tts=mock; a deployment needs tts=trtc/);
    expect(problemsFor({ TRTC_SDK_APP_ID: "1400000000" }, trtc).join("\n")).toMatch(/read-aloud \(--tts trtc\): TENCENT_SECRET_ID is not set/);
    // and without the switch its keys stay on this computer
    const ctx = ctxOf(fullDeploy({ TRTC_SDK_APP_ID: "1400000000", TENCENT_SECRET_ID: "AKIDFAKEtencent0123456789", TENCENT_SECRET_KEY: "FAKEtencentkey0123456789" }));
    expect(Object.keys(buildWebEnv(ctx, sw).env).filter((n) => /^(TRTC_|TENCENT_)/.test(n))).toEqual([]);
  });

  it("refuses a missing or short BLOB_SIGNING_SECRET", () => {
    expect(problemsFor({ BLOB_SIGNING_SECRET: null }).join("\n")).toMatch(/BLOB_SIGNING_SECRET is not set/);
    expect(problemsFor({ BLOB_SIGNING_SECRET: "too-short" }).join("\n")).toMatch(/BLOB_SIGNING_SECRET is shorter than 32/);
  });

  it("refuses what the server itself would refuse to start with: short or development account secrets", () => {
    expect(problemsFor({ AUTH_COOKIE_SECRET: null }).join("\n")).toMatch(/AUTH_COOKIE_SECRET is not set/);
    expect(problemsFor({ RATE_LIMIT_SALT: "ripple-dev-only-rate-limit-salt-not-for-deployment" }).join("\n")).toMatch(/RATE_LIMIT_SALT is the development value/);
    expect(problemsFor({ RECOVERY_PEPPER: "short" }).join("\n")).toMatch(/RECOVERY_PEPPER is shorter than 32/);
  });

  it("refuses a missing origin lock, a missing push key pair, a missing publishable key and a missing username domain", () => {
    expect(problemsFor({ EDGE_SECRET: null }).join("\n")).toMatch(/EDGE_SECRET is not set/);
    expect(problemsFor({ VAPID_PRIVATE_KEY: null }).join("\n")).toMatch(/push=false; a deployment needs push=true/);
    expect(problemsFor({ SUPABASE_ANON_KEY: null }).join("\n")).toMatch(/SUPABASE_ANON_KEY is not set/);
    expect(problemsFor({ AUTH_USERNAME_DOMAIN: null }).join("\n")).toMatch(/AUTH_USERNAME_DOMAIN is not set \(the owner supplies it: .*cannot change after the first account/);
  });

  it("writes a file systemd and a shell read the same way, and refuses a value it cannot write", () => {
    const text = formatEnvFile({ PLAIN: "abc-DEF_123:/x.y", SPACED: "two words", JSON_VALUE: '{"a": 1}', URL: "postgresql://u:p%21@h:5432/db?x=1&y=2" }, "header");
    expect(text).toBe("# header\nJSON_VALUE='{\"a\": 1}'\nPLAIN=abc-DEF_123:/x.y\nSPACED='two words'\nURL='postgresql://u:p%21@h:5432/db?x=1&y=2'\n");
    expect(() => formatEnvFile({ BAD: "it's" }, "h")).toThrow(/BAD contains a single quote/);
    expect(() => formatEnvFile({ BAD: "two\nlines" }, "h")).toThrow(/BAD contains/);
  });
});

describe("push-env", () => {
  const go = async (f: ReturnType<typeof fakeFiles>, argv: string[], answer?: Parameters<typeof fakeRunner>[0]) => {
    const out = quietOutput();
    const r = fakeRunner(answer);
    const code = await pushEnv([...argv, ...f.flags], out, r.run, WEB);
    return { code, text: out.text(), calls: r.calls };
  };
  const applied = (status: string, code = 0) => (cmd: Parameters<Parameters<typeof fakeRunner>[0] & object>[0]) => (remoteOpOf(cmd) === "env-apply" ? { code, stdout: resultLine({ op: "env-apply", status }) } : undefined);

  it("refuses without the two switches, before anything else", async () => {
    const res = await go(fullDeploy(), ["--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/--speech mock/);
    expect(res.calls).toHaveLength(0);
  });

  it("today's deploy file: says which secrets a real run would create and that only the owner has the model key", async () => {
    const f = fakeFiles();
    const before = readFileSync(f.deployFile, "utf8");
    const res = await go(f, ["--speech", "mock", "--tts", "mock", "--dry-run"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/A run with --yes would first create in the deploy file: EDGE_SECRET, BLOB_SIGNING_SECRET, AUTH_COOKIE_SECRET, RATE_LIMIT_SALT, RECOVERY_PEPPER, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY/);
    expect(res.text).toMatch(/REFUSED: this environment would not be a working deployment[\s\S]*HUNYUAN_API_KEY is not set \(the owner supplies it/);
    expect(res.text).toMatch(/AUTH_USERNAME_DOMAIN is not set/);
    expect(res.text).not.toMatch(/EDGE_SECRET is not set|push=false/);
    expect(readFileSync(f.deployFile, "utf8")).toBe(before);
    expect(res.calls).toHaveLength(0);
    expectNoLeak(res.text, f);
  });

  it("a dry run with everything in place prints the plan by name and touches nothing", async () => {
    const f = fullDeploy();
    const res = await go(f, ["--speech", "mock", "--tts", "mock", "--dry-run"]);
    expect(res.code).toBe(0);
    expect(res.calls).toHaveLength(0);
    expect(res.text).toContain('ssh -i <DEPLOY_SSH_KEY> <DEPLOY_USER>@<DEPLOY_HOST> "sudo -n install -m 0600 -o root -g root /dev/null /etc/ripple/web.env.new && sudo -n tee /etc/ripple/web.env.new > /dev/null"');
    expect(res.text).toContain("RIPPLE_DEPLOYED=1");
    expect(res.text).toContain("APP_BASE_URL=https://<DEPLOY_APP_DOMAIN>");
    expect(res.text).toMatch(/from the deploy file \(values not shown\): .*HUNYUAN_API_KEY.*SUPABASE_SERVICE_KEY/);
    expect(res.text).toContain("expected health: store=supabase blob=supabase auth=supabase llm=hunyuan checker=hunyuan speech=mock speech_problem=null tts=mock jobs=true deployed=true push=true");
    expect(res.text).toContain("Dry run: nothing was touched.");
    expectNoLeak(res.text, f);
  });

  it("--no-restart (the move to Hunyuan): the plan applies the file without a restart and says the next release compares", async () => {
    const f = fullDeploy();
    const res = await go(f, ["--speech", "mock", "--tts", "mock", "--no-restart", "--dry-run"]);
    expect(res.code).toBe(0);
    expect(res.calls).toHaveLength(0);
    expect(res.text).toContain("node --input-type=module - env-apply no-restart");
    expect(res.text).toContain("WITHOUT restarting ripple-web (--no-restart): the next release restarts with it and compares");
    expectNoLeak(res.text, f);
  });

  it("does nothing without --yes", async () => {
    const res = await go(fullDeploy(), ["--speech", "mock", "--tts", "mock"]);
    expect(res.code).toBe(2);
    expect(res.calls).toHaveLength(0);
  });

  it("with --yes: stages the file and the expectation through standard input, then applies; the values are in the file, never on a command line", async () => {
    const f = fullDeploy();
    const res = await go(f, ["--speech", "mock", "--tts", "mock", "--yes"], applied("ok"));
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => c.bin)).toEqual(["ssh", "ssh", "ssh"]);
    const [putEnv, putExpect, apply] = res.calls;
    expect(putEnv.args.at(-1)).toBe("sudo -n install -m 0600 -o root -g root /dev/null /etc/ripple/web.env.new && sudo -n tee /etc/ripple/web.env.new > /dev/null");
    expect(putEnv.args).toContain(`${f.values.DEPLOY_USER}@${f.values.DEPLOY_HOST}`);
    expect(putEnv.args).toContain("BatchMode=yes");
    const sent = String(putEnv.stdin);
    expect(sent).toContain(`HUNYUAN_API_KEY=${APP_EXTRA.HUNYUAN_API_KEY}`);
    expect(sent).toContain(`EDGE_SECRET=${APP_EXTRA.EDGE_SECRET}`);
    expect(sent).toContain("TRUSTED_PROXY_HOPS=1");
    expect(sent).not.toContain("SUPABASE_DB_URL");
    expect(sent).not.toContain("FakeProdPassw0rdZZ");
    expect(JSON.parse(String(putExpect.stdin))).toMatchObject({ llm: "hunyuan", speech: "mock", deployed: true });
    expect(remoteOpOf(apply)).toBe("env-apply");
    expect(String(apply.stdin)).toContain("export async function envApply");
    for (const call of res.calls) for (const secret of Object.values(APP_EXTRA)) expect(call.args.join(" ")).not.toContain(secret);
    expect(res.text).toContain("the running app reports what was pushed");
    expectNoLeak(res.text, f);
  });

  it("creates the missing secrets in the deploy file on the first run with --yes, without showing them", async () => {
    const f = fakeFiles({ HUNYUAN_API_KEY: APP_EXTRA.HUNYUAN_API_KEY, AUTH_USERNAME_DOMAIN: APP_EXTRA.AUTH_USERNAME_DOMAIN });
    const res = await go(f, ["--speech", "mock", "--tts", "mock", "--yes"], applied("staged"));
    expect(res.code).toBe(0);
    expect(res.text).toMatch(/Created in the deploy file \(values not shown\): EDGE_SECRET/);
    const now = readEnvFile(f.deployFile).values;
    expect(now.EDGE_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(String(res.calls[0].stdin)).toContain(`EDGE_SECRET=${now.EDGE_SECRET}`);
    expect(res.text).toContain("no release is installed yet");
    expectNoLeak(res.text, f);
  });

  it("when the running app reports something else, says the previous file is back and exits 3", async () => {
    const res = await go(fullDeploy(), ["--speech", "mock", "--tts", "mock", "--yes"], applied("restored", 3));
    expect(res.code).toBe(3);
    expect(res.text).toMatch(/REFUSED: the running app did not report what was pushed; the previous environment file is back in place/);
  });

  it("stops when staging fails (the server was not provisioned) and does not apply", async () => {
    const res = await go(fullDeploy(), ["--speech", "mock", "--tts", "mock", "--yes"], (_cmd, nth) => (nth === 1 ? { code: 1, stderr: "install: cannot create regular file '/etc/ripple/web.env.new': No such file or directory" } : undefined));
    expect(res.code).toBe(1);
    expect(res.calls).toHaveLength(1);
    expect(res.text).toMatch(/has provision run/);
  });

  it("refuses the test project as the app's database", async () => {
    const res = await go(fullDeploy({ SUPABASE_URL: TEST_ENV.SUPABASE_URL, SUPABASE_DB_URL: null }), ["--speech", "mock", "--tts", "mock", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/SUPABASE_URL in the deploy file is the test project's/);
    expect(res.calls).toHaveLength(0);
  });

  it("refuses a film crew key and an unknown name before anything else", async () => {
    const sets: Array<Record<string, string>> = [{ SCRIPTED_FALLBACK_KEY: "crew-key-zz-0123456789" }, { RIPPLE_DEEPSEEK_API_KEY: "sk-old-name-zz-0123456789" }];
    for (const set of sets) {
      const res = await go(fullDeploy(set), ["--speech", "mock", "--tts", "mock", "--yes"]);
      expect(res.code).toBe(2);
      expect(res.text).toMatch(/the deploy file has 1 problem/);
      expect(res.calls).toHaveLength(0);
    }
  });

  it("refuses a --host that is not the deploy file's server", async () => {
    const res = await go(fullDeploy(), ["--speech", "mock", "--tts", "mock", "--host", "198.51.100.9", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/--host is not the DEPLOY_HOST of the deploy file/);
    expect(res.calls).toHaveLength(0);
  });

  it("--restore-prev swaps the files back on the server and needs --yes", async () => {
    const f = fullDeploy();
    expect((await go(f, ["--restore-prev"])).calls).toHaveLength(0);
    const res = await go(f, ["--restore-prev", "--yes"]);
    expect(res.code).toBe(0);
    expect(res.calls.map(remoteOpOf)).toEqual(["env-restore"]);
  });
});

describe("push-secrets", () => {
  const go = async (f: ReturnType<typeof fakeFiles>, argv: string[], answer?: Parameters<typeof fakeRunner>[0]) => {
    const out = quietOutput();
    const r = fakeRunner(answer);
    const code = await pushSecrets([...argv, ...f.flags], out, r.run, WEB);
    return { code, text: out.text(), calls: r.calls };
  };

  it("refuses an EDGE_SECRET shorter than 32 characters or with characters a header cannot carry", async () => {
    for (const value of ["short-zz-secret", "has spaces and {braces} 0123456789012345678901234567890"]) {
      const res = await go(fakeFiles({ EDGE_SECRET: value }), ["--yes"]);
      expect(res.code).toBe(2);
      expect(res.text).toMatch(/EDGE_SECRET must be 32 or more characters of letters, digits, - and _/);
      expect(res.calls).toHaveLength(0);
    }
  });

  it("while no backup setting exists: pushes the origin lock and says the backup is not configured", async () => {
    const f = fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET });
    expect(backupState(loadContext(parseArgs(f.flags), WEB, quietOutput())).state).toBe("none");
    const res = await go(f, ["--yes"], (cmd) => (remoteOpOf(cmd) ? { stdout: resultLine({ op: "secrets-apply", status: "ok" }) } : undefined));
    expect(res.code).toBe(0);
    expect(res.text).toMatch(/backup: not configured, nothing pushed for it \(the owner supplies BACKUP_COS_BUCKET/);
    expect(res.calls).toHaveLength(2);
    expect(res.calls[0].args.at(-1)).toContain("/etc/caddy/edge.env.new");
    expect(String(res.calls[0].stdin)).toContain(`EDGE_SECRET=${APP_EXTRA.EDGE_SECRET}\n`);
    expect(res.calls[1].args.at(-1)).toMatch(/- secrets-apply edge$/);
    expectNoLeak(res.text, f);
  });

  it("--only backup while it is not configured says so cleanly and sends nothing", async () => {
    const res = await go(fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET }), ["--only", "backup", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/backup: not configured\. The owner supplies: BACKUP_COS_BUCKET/);
    expect(res.calls).toHaveLength(0);
  });

  it("refuses when a COS setting or the heartbeat address is missing", async () => {
    for (const name of ["BACKUP_COS_BUCKET", "BACKUP_COS_REGION", "BACKUP_COS_SECRET_ID", "BACKUP_COS_SECRET_KEY", "BACKUP_HEARTBEAT_URL", "BACKUP_AGE_RECIPIENT"]) {
      const res = await go(fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET, ...BACKUP_EXTRA, [name]: null }), ["--yes"]);
      expect(res.code, name).toBe(2);
      expect(res.text, name).toMatch(new RegExp(`the backup settings are incomplete; nothing was sent[\\s\\S]*${name}`));
      expect(res.calls, name).toHaveLength(0);
    }
  });

  it("refuses a public key that is not an age key, and a heartbeat address that is not https", async () => {
    const bad = await go(fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET, ...BACKUP_EXTRA, BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-1NOTTHEPUBLICHALFZZ" }), ["--yes"]);
    expect(bad.code).toBe(2);
    expect(bad.text).toMatch(/BACKUP_AGE_RECIPIENT is not an age public key/);
    expect(bad.calls).toHaveLength(0);
    const http = await go(fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET, ...BACKUP_EXTRA, BACKUP_HEARTBEAT_URL: "http://heartbeat.fake-ripple-zz.example/ping" }), ["--yes"]);
    expect(http.code).toBe(2);
    expect(http.text).toMatch(/BACKUP_HEARTBEAT_URL is not an https:\/\/ address/);
    expect(http.calls).toHaveLength(0);
  });

  it("refuses the test database's connection string for the backup", async () => {
    const res = await go(fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET, ...BACKUP_EXTRA, SUPABASE_URL: TEST_ENV.SUPABASE_URL, SUPABASE_DB_URL: TEST_ENV.SUPABASE_DB_URL }), ["--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/test (project|database)/);
    expect(res.calls).toHaveLength(0);
  });

  it("with everything: three files through standard input with their modes, then one apply for both parts", async () => {
    const f = fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET, ...BACKUP_EXTRA });
    const res = await go(f, ["--yes"], (cmd) => (remoteOpOf(cmd) ? { stdout: resultLine({ op: "secrets-apply", status: "ok" }) } : undefined));
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => c.args.at(-1))).toEqual([
      "sudo -n install -m 0600 -o root -g root /dev/null /etc/caddy/edge.env.new && sudo -n tee /etc/caddy/edge.env.new > /dev/null",
      "sudo -n install -m 0600 -o root -g root /dev/null /etc/ripple/backup.env.new && sudo -n tee /etc/ripple/backup.env.new > /dev/null",
      "sudo -n install -m 0644 -o root -g root /dev/null /etc/ripple/backup.age.pub.new && sudo -n tee /etc/ripple/backup.age.pub.new > /dev/null",
      "sudo -n /usr/local/bin/node --input-type=module - secrets-apply edge backup",
    ]);
    const backupEnv = String(res.calls[1].stdin);
    expect(backupEnv).toContain(`SUPABASE_DB_URL=${f.values.SUPABASE_DB_URL}\n`);
    expect(backupEnv).toContain(`BACKUP_COS_SECRET_KEY=${BACKUP_EXTRA.BACKUP_COS_SECRET_KEY}`);
    expect(backupEnv).not.toContain("SUPABASE_SERVICE_KEY");
    expect(String(res.calls[2].stdin)).toBe(`${BACKUP_EXTRA.BACKUP_AGE_RECIPIENT}\n`);
    for (const call of res.calls) expect(call.args.join(" ")).not.toContain("FakeProdPassw0rdZZ");
    expectNoLeak(res.text, f);
  });

  it("creates the origin lock on first use, does nothing without --yes, and reports Caddy not coming up", async () => {
    const f = fakeFiles();
    const dry = await go(f, ["--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.text).toMatch(/would first create in the deploy file: EDGE_SECRET/);
    expect(dry.calls).toHaveLength(0);
    expect(readEnvFile(f.deployFile).values.EDGE_SECRET).toBeUndefined();
    expect((await go(f, [])).calls).toHaveLength(0);
    const res = await go(f, ["--yes"], (cmd) => (remoteOpOf(cmd) ? { code: 3, stdout: resultLine({ op: "secrets-apply", status: "restored" }) } : undefined));
    expect(readEnvFile(f.deployFile).values.EDGE_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.code).toBe(3);
    expect(res.text).toMatch(/Caddy did not come up with the new origin lock; the previous edge\.env is back in place/);
    expectNoLeak(res.text, f);
  });

  it("--restore-prev swaps the named parts back", async () => {
    const res = await go(fakeFiles({ EDGE_SECRET: APP_EXTRA.EDGE_SECRET }), ["--restore-prev", "--only", "edge", "--yes"]);
    expect(res.code).toBe(0);
    expect(res.calls.map((c) => c.args.at(-1))).toEqual(["sudo -n /usr/local/bin/node --input-type=module - secrets-restore edge"]);
  });
});
