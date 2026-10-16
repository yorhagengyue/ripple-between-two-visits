/**
 * Hardening of the model client after the round-1 check (10-09 fixer, defects 8 and 9; then on DeepSeek, since 10-16
 * with Hunyuan's TokenHub configuration):
 *
 *   spend       a call reserves its estimate once per attempt, so attempts that time out and are charged can never
 *               take the spend past the cap; the ledger lives in web/.data wherever a process was started from.
 *   checker     its own concurrency queue (a busy main model cannot hold it), and CHECKER_TIMEOUT_MS bounds the whole
 *               check, waiting for a slot included.
 *   privacy     LLM_RECORD is refused where the prompts could be a real patient's (production, STORE=supabase);
 *               llmStatus() names the failover vendor that would receive the full prompt.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkerConfig, checkerTimeoutMs, createCompatClient, llmStatus, recording, recordingBlockedReason } from "@/lib/llm";
import { acquireSlot, slotStatus, type CompatConfig } from "@/lib/llm/openai";
import { findWebRoot, moduleDir, webRoot } from "@/lib/llm/root";
import { estimateUsd, resolveSpendLog, SpendLedger, spendLogPath } from "@/lib/llm/spend";
import { LlmError } from "@/lib/llm/types";

const WEB = path.resolve(__dirname, "..", "..", "..");

function cfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "hunyuan",
    vendor: "tencent",
    baseUrl: "https://tokenhub-intl.tencentcloudmaas.com/v1",
    apiKey: "sk-test",
    model: "hy3",
    maxTokensField: "max_tokens",
    jsonMode: false,
    timeoutMs: 30,
    maxAttempts: 2,
    ...over,
  };
}

const hanging = (sent: { n: number }) => (_url: string, init: RequestInit) =>
  new Promise<Response>((_res, reject) => {
    sent.n++;
    init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
  });

const ok = (content = '{"ok":true}') =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200 });

describe("spend: one reservation per attempt", () => {
  const opts = { system: "s", user: "u", maxTokens: 100 };
  const estimate = estimateUsd("hy3", { text: "su", maxTokens: 100 });

  it("a call that may make two attempts needs room for two estimates (refused before anything is sent)", async () => {
    const sent = { n: 0 };
    const ledger = new SpendLedger({ file: null, capUsd: estimate * 1.5, windowMs: 86_400_000 });
    const llm = createCompatClient(cfg({ ledger }), async () => {
      sent.n++;
      return ok();
    });
    await expect(llm.chat(opts)).rejects.toMatchObject({ code: "budget" });
    expect(sent.n).toBe(0);
  });

  it("two timed-out attempts are charged two estimates, and that stays within the cap", async () => {
    const sent = { n: 0 };
    const cap = estimate * 2.0001;
    const ledger = new SpendLedger({ file: null, capUsd: cap, windowMs: 86_400_000 });
    const llm = createCompatClient(cfg({ ledger }), hanging(sent));
    await expect(llm.chat(opts)).rejects.toMatchObject({ code: "timeout" });
    expect(sent.n).toBe(2);
    const spent = ledger.spentUsd();
    expect(spent).toBeCloseTo(estimate * 2, 6);
    expect(spent).toBeLessThanOrEqual(cap);
    expect(ledger.summary().inFlightUsd).toBe(0);
  });
});

describe("spend: one ledger for web/, wherever the process started", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("finds web/ from web/, from web/scripts/llm and from the repository root", () => {
    expect(webRoot(WEB)).toBe(WEB);
    expect(webRoot(path.join(WEB, "scripts", "llm"))).toBe(WEB);
    expect(webRoot(path.dirname(WEB))).toBe(WEB);
  });

  it("from a folder outside the repository it still finds web/, from the module's own folder (fix round 1)", () => {
    const d = mkdtempSync(path.join(tmpdir(), "ripple-root-"));
    dirs.push(d);
    expect(findWebRoot(d)).toBe(WEB);
    expect(webRoot(d)).toBe(WEB);
    expect(moduleDir()).toBe(path.join(WEB, "lib", "llm"));
  });

  it("when web/ cannot be found at all, the ledger refuses every paid call instead of starting a fresh one (fix round 1)", () => {
    const d = mkdtempSync(path.join(tmpdir(), "ripple-root-"));
    dirs.push(d);
    expect(findWebRoot(d, null)).toBeNull();
    // the cassette folder and the key check only read: they fall back to the start folder
    expect(webRoot(path.dirname(WEB))).toBe(WEB);
    const resolved = resolveSpendLog({}, () => findWebRoot(d, null));
    expect(resolved).toEqual({ file: null, unavailable: "no_web_root" });
    const ledger = new SpendLedger({ file: resolved.file, unavailable: resolved.unavailable, capUsd: 5, windowMs: 3_600_000 });
    expect(() => ledger.reserve(0.01)).toThrow(LlmError);
    try {
      ledger.reserve(0.01);
    } catch (e) {
      expect((e as LlmError).code).toBe("ledger_unavailable");
      expect((e as LlmError).status).toBe(507);
      expect((e as LlmError).message).not.toContain(d);
    }
    expect(ledger.summary()).toMatchObject({ ledgerError: "no_web_root", remainingUsd: 0 });
    // with web/ found, the same call resolves to web/.data/llm-spend.jsonl
    expect(resolveSpendLog({}, () => WEB)).toEqual({ file: path.join(WEB, ".data", "llm-spend.jsonl"), unavailable: null });
  });

  it("the default ledger is web/.data/llm-spend.jsonl (outside vitest), LLM_SPEND_LOG overrides it", () => {
    expect(spendLogPath({})).toBe(path.join(WEB, ".data", "llm-spend.jsonl"));
    expect(spendLogPath({ VITEST: "true" })).toBeNull();
    expect(spendLogPath({ LLM_SPEND_LOG: "x/y.jsonl" })).toBe(path.resolve("x/y.jsonl"));
  });
});

describe("checker: own queue, one time bound for the whole check", () => {
  const env = { LLM_PROVIDER: "hunyuan", HUNYUAN_API_KEY: "sk-test", CHECKER_PROVIDER: "hunyuan" };

  it("the Hunyuan checker waits in its own queue and CHECKER_TIMEOUT_MS covers queue wait and the attempt", () => {
    const c = checkerConfig(env).config!;
    expect(c.slotKey).toBe("hunyuan:checker");
    expect(c.totalTimeoutMs).toBe(10_000);
    expect(c.queueTimeoutMs).toBe(10_000);
    expect(checkerTimeoutMs({ CHECKER_TIMEOUT_MS: "4000" })).toBe(4000);
    expect(checkerConfig({ ...env, CHECKER_TIMEOUT_MS: "4000" }).config!.totalTimeoutMs).toBe(4000);
  });

  it("a main model with every slot busy does not delay the checker", async () => {
    const releases = await Promise.all(Array.from({ length: 2 }, () => acquireSlot("hunyuan-test-main", 2, 1000)));
    expect(slotStatus("hunyuan-test-main").active).toBe(2);
    const checker = createCompatClient(cfg({ name: "hunyuan-test-main", slotKey: "hunyuan-test-main:checker", maxConcurrency: 2, ledger: null }), async () => ok('{"supported": true}'));
    const t0 = Date.now();
    await expect(checker.chat({ system: "s", user: "u" })).resolves.toMatchObject({ content: '{"supported": true}' });
    expect(Date.now() - t0).toBeLessThan(500);
    for (const r of releases) r();
  });

  it("waiting for a checker slot counts against the time bound (fails closed as a timeout, not after 15 s)", async () => {
    const hold = await acquireSlot("hunyuan-test-chk", 1, 1000);
    const checker = createCompatClient(cfg({ name: "hunyuan-test", slotKey: "hunyuan-test-chk", maxConcurrency: 1, totalTimeoutMs: 150, queueTimeoutMs: 15_000, ledger: null }), async () => ok());
    const t0 = Date.now();
    await expect(checker.chat({ system: "s", user: "u" })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(slotStatus("hunyuan-test-chk").waiting).toBe(0);
    hold();
  });

  it("the time bound also stops a hanging attempt and its retries", async () => {
    const sent = { n: 0 };
    const checker = createCompatClient(cfg({ timeoutMs: 10_000, maxAttempts: 3, totalTimeoutMs: 120, ledger: null }), hanging(sent));
    const t0 = Date.now();
    await expect(checker.chat({ system: "s", user: "u" })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(sent.n).toBe(1);
  });
});

describe("privacy: recording and failover", () => {
  it("LLM_RECORD is refused where prompts may be a real patient's, unless explicitly allowed", () => {
    expect(recording({ LLM_RECORD: "1" })).toBe(true);
    expect(recording({ LLM_RECORD: "1", NODE_ENV: "production" })).toBe(false);
    expect(recording({ LLM_RECORD: "1", STORE: "supabase" })).toBe(false);
    expect(recordingBlockedReason({ STORE: "supabase" })).toBe("STORE=supabase");
    expect(recording({ LLM_RECORD: "1", STORE: "supabase", LLM_RECORD_ALLOW_REAL_DATA: "1" })).toBe(true);
    expect(recording({})).toBe(false);
  });

  it("llmStatus names the failover vendor that would receive the full prompt, and whether recording was refused", () => {
    const s = llmStatus({ LLM_PROVIDER: "hunyuan", HUNYUAN_API_KEY: "sk-test", LLM_FALLBACK_PROVIDER: "openai", LLM_FALLBACK_API_KEY: "sk-o", LLM_FALLBACK_MODEL: "gpt-x", LLM_RECORD: "1", STORE: "supabase", VITEST: "true" });
    expect(s.fallback).toEqual({ provider: "openai", vendor: "openai", model: "gpt-x", receivesPatientContent: true });
    expect(s).toMatchObject({ recording: false, recordingBlocked: "STORE=supabase" });
    expect(JSON.stringify(s)).not.toContain("sk-");
    expect(llmStatus({ LLM_PROVIDER: "mock" }).fallback).toBeNull();
  });
});
