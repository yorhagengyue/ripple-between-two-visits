/**
 * Round 2 of the model fixes (10-09, then on DeepSeek, retired on 10-16), the low findings of the round-2 checks on
 * lib/llm and scripts/llm, kept for the clients that remain (the OpenAI-compatible wire here; Hunyuan's own error codes
 * in hunyuan.test.ts):
 *   - a vendor error body never reaches LlmError.message (it goes to safety_event and the console): status only;
 *   - the spend ledger never counts a negative or non-numeric usd line as a refund;
 *   - every ledger line says which run and process made the call (LLM_RUN_LABEL, pid), so "this run spent nothing"
 *     can be shown while other processes use the model; scripts/llm/spend.ts sums one run;
 *   - scripts/llm/env-check.ts says whether a key comes from web/.env or an overriding environment value, without
 *     printing it.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompatClient, upstreamError, type CompatConfig } from "@/lib/llm/openai";
import { countedUsd, runLabel, SpendLedger, type SpendEntry } from "@/lib/llm/spend";
import { keySource, keySourceLines, parseEnvFile } from "@/scripts/llm/env-check";
import { readLedger, runOf, summarise } from "@/scripts/llm/spend";

const KEY = "sk-test-round2-abcdef";
const SECRET_ECHO = "PATIENT-SAID-今天150/95";

function oaCfg(over: Partial<CompatConfig> = {}): CompatConfig {
  return {
    name: "openai",
    vendor: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: KEY,
    model: "gpt-5.4-mini",
    maxTokensField: "max_completion_tokens",
    jsonMode: true,
    timeoutMs: 200,
    maxAttempts: 1,
    ledger: null,
    ...over,
  };
}

const entry = (over: Partial<SpendEntry> = {}): SpendEntry => ({
  at: new Date().toISOString(),
  provider: "hunyuan",
  model: "hy3",
  purpose: "compose",
  ok: true,
  error: null,
  attempts: 1,
  latency_ms: 10,
  prompt_tokens: 1,
  cache_hit_tokens: 0,
  cache_miss_tokens: 1,
  completion_tokens: 1,
  reasoning_tokens: 0,
  usd: 0.01,
  estimated: false,
  ...over,
});

describe("vendor error text never reaches the error message", () => {
  for (const status of [400, 404, 422, 429, 500, 503]) {
    it(`${status}: provider name and status only`, async () => {
      const client = createCompatClient(oaCfg(), async () => new Response(JSON.stringify({ error: { message: `bad request near "${SECRET_ECHO}"` } }), { status }));
      const err = (await client.chat({ system: "s", user: SECRET_ECHO }).catch((e) => e)) as Error & { code: string };
      expect(err.message).toBe(`openai ${status}: request failed`);
      expect(err.message).not.toContain("PATIENT");
      expect(err.code).toBe("upstream");
    });
  }
  it("401 / 402 keep their own fixed messages", () => {
    expect(upstreamError({ name: "openai" }, 401).message).toBe("openai 401: API key rejected");
    expect(upstreamError({ name: "openai" }, 402).code).toBe("insufficient_balance");
  });
});

describe("the ledger never counts a refund", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-spend-r2-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a hand-written negative line counts as 0 (was read as -4.99 spent)", () => {
    const file = path.join(dir, "ledger.jsonl");
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), usd: 0.01 }) + "\n");
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), usd: -5 }) + "\n");
    const ledger = new SpendLedger({ file, capUsd: 5, windowMs: 86_400_000 });
    expect(ledger.spentUsd()).toBeCloseTo(0.01, 6);
    // a usd that is not a number is damage, not 0 (fix round 2): every paid call is refused until it is repaired
    for (const bad of ['"3"', "null"]) {
      const f = path.join(dir, `ledger-${bad.length}.jsonl`);
      appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), usd: 0.01 }) + "\n");
      appendFileSync(f, `{"at":"${new Date().toISOString()}","usd":${bad}}\n`);
      expect(() => new SpendLedger({ file: f, capUsd: 5, windowMs: 86_400_000 }).spentUsd(), bad).toThrow(/corrupt_line/);
    }
  });
  it("record() clamps too, in the file and in memory", () => {
    const file = path.join(dir, "ledger.jsonl");
    const ledger = new SpendLedger({ file, capUsd: 5, windowMs: 86_400_000 });
    ledger.record(entry({ usd: -2 }));
    expect(JSON.parse(readFileSync(file, "utf8").trim()).usd).toBe(0);
    const mem = new SpendLedger({ file: null, capUsd: 5, windowMs: 86_400_000 });
    mem.record(entry({ usd: -2 }));
    mem.record(entry({ usd: 0.5 }));
    expect(mem.spentUsd()).toBeCloseTo(0.5, 6);
  });
  it("countedUsd", () => {
    expect([countedUsd(0.2), countedUsd(-1), countedUsd(Number.NaN), countedUsd(Infinity), countedUsd("1"), countedUsd(undefined)]).toEqual([0.2, 0, 0, 0, 0, 0]);
  });
});

describe("every ledger line says which run made it", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ripple-spend-run-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("run label and pid on each line; the label must be a short plain word", () => {
    expect(runLabel({ LLM_RUN_LABEL: "eval-run1" })).toBe("eval-run1");
    expect(runLabel({})).toBe(`pid:${process.pid}`);
    expect(runLabel({ LLM_RUN_LABEL: "has space; rm -rf" })).toBe(`pid:${process.pid}`);
    expect(runLabel({ LLM_RUN_LABEL: "x".repeat(41) })).toBe(`pid:${process.pid}`);
    const file = path.join(dir, "ledger.jsonl");
    const ledger = new SpendLedger({ file, capUsd: 5, windowMs: 86_400_000 });
    ledger.record(entry());
    ledger.record(entry({ run: "e2e" }));
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ pid: process.pid });
    expect(typeof lines[0].run).toBe("string");
    expect(lines[1]).toMatchObject({ run: "e2e", pid: process.pid });
  });

  it("spend.ts sums by run: a run with no line spent nothing, whatever else the ledger holds", () => {
    const file = path.join(dir, "ledger.jsonl");
    for (const e of [entry({ run: "safety-attacks", usd: 0.02 }), entry({ run: "safety-attacks", usd: 0.03 }), entry({ run: "eval-run1", usd: 0.06 }), { ...entry({ usd: 0.01 }), run: undefined, pid: 42 }]) {
      appendFileSync(file, JSON.stringify(e) + "\n");
    }
    appendFileSync(file, JSON.stringify({ ...entry({ usd: 0.5 }), run: undefined, pid: undefined }) + "\n");
    const rows = readLedger(file, 0);
    const byRun = Object.fromEntries(summarise(rows, runOf).map((r) => [r.key, r.usd]));
    expect(byRun).toEqual({ "safety-attacks": 0.05, "eval-run1": 0.06, "pid:42": 0.01, "(before run labels)": 0.5 });
    expect(rows.filter((e) => runOf(e) === "e2e")).toHaveLength(0);
  });
});

describe("which key a process uses (env-check)", () => {
  const FILE = parseEnvFile(["# comment", "HUNYUAN_API_KEY=sk-file-value", "export OPENAI_API_KEY='sk-openai'", "EMPTY=", "  CHECKER_API_KEY = \"sk-checker\"  "].join("\n"));
  it("parses KEY=value lines, quotes and export", () => {
    expect(FILE).toEqual({ HUNYUAN_API_KEY: "sk-file-value", OPENAI_API_KEY: "sk-openai", EMPTY: "", CHECKER_API_KEY: "sk-checker" });
  });
  it("same, differs, environment only, not set", () => {
    expect(keySource("HUNYUAN_API_KEY", { HUNYUAN_API_KEY: "sk-file-value" }, FILE)).toBe("web/.env");
    expect(keySource("HUNYUAN_API_KEY", { HUNYUAN_API_KEY: "sk-user-env-value" }, FILE)).toBe("environment, DIFFERS from web/.env");
    expect(keySource("HUNYUAN_API_KEY", { HUNYUAN_API_KEY: "sk-x" }, {})).toBe("environment only");
    expect(keySource("HUNYUAN_API_KEY", {}, FILE)).toBe("not set");
  });
  it("the report lines carry names and sources only, never a value", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ripple-envcheck-"));
    try {
      const file = path.join(dir, ".env");
      appendFileSync(file, "HUNYUAN_API_KEY=sk-file-value\n");
      const lines = keySourceLines({ HUNYUAN_API_KEY: "sk-user-env-value" }, file);
      expect(lines).toContain("HUNYUAN_API_KEY: environment, DIFFERS from web/.env");
      expect(lines.join("\n")).not.toMatch(/sk-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
