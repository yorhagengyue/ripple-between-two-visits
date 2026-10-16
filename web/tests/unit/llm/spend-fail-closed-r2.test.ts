/**
 * Fix round 2 for the spend ledger (10-09, the B2 red team's defects):
 *   - a damaged line (not JSON, no time, a usd that is not a finite number) used to count as US$0, so a damaged ledger
 *     under-counted the spend (probe: one 4.9 line, one garbage line and one line with "usd":"4.9" summed to 4.9). Now
 *     every paid call is refused ("ledger_unavailable", corrupt_line), nothing is sent, until the file is repaired,
 *     moved or truncated; summary() reports it with nothing remaining;
 *   - under vitest the ledger is in memory even when LLM_SPEND_LOG is exported in the shell (unit tests appended fake
 *     calls to the shared ledger).
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCompatClient } from "@/lib/llm";
import type { CompatConfig } from "@/lib/llm/openai";
import { LlmError } from "@/lib/llm/types";
import { resolveSpendLog, SpendLedger, TRUNCATED_LINE_USD } from "@/lib/llm/spend";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ripple-ledger-r2-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CAP = { capUsd: 5, windowMs: 86_400_000 };
const line = (usd: unknown) => JSON.stringify({ at: new Date().toISOString(), provider: "deepseek", model: "deepseek-flash", purpose: "classify", ok: true, usd }) + "\n";
const cfg = (ledger: SpendLedger): CompatConfig => ({
  name: "deepseek",
  vendor: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-test",
  model: "deepseek-flash",
  maxTokensField: "max_tokens",
  jsonMode: true,
  timeoutMs: 1000,
  maxAttempts: 1,
  ledger,
});

describe("a damaged ledger line fails closed", () => {
  it.each([
    ["garbage", "this is not json\n"],
    ["usd as a string", line("4.9")],
    ["usd missing", line(undefined)],
    ["no time", JSON.stringify({ usd: 1 }) + "\n"],
  ])("%s: reserve() refuses with ledger_unavailable (corrupt_line), summary() shows nothing remaining", (_name, bad) => {
    const file = path.join(tmp(), "ledger.jsonl");
    writeFileSync(file, line(4.9) + bad + line(0.01), "utf8");
    const ledger = new SpendLedger({ file, ...CAP });
    let err: unknown;
    try {
      ledger.reserve(0.001);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("ledger_unavailable");
    expect((err as LlmError).message).toContain("corrupt_line");
    expect(ledger.summary()).toMatchObject({ ledgerError: "corrupt_line", remainingUsd: 0 });
    // sticky: reading again does not forget the damage
    expect(() => ledger.reserve(0.001)).toThrow(/corrupt_line/);
  });

  it("nothing is sent while the ledger is damaged; taking the line out (the file shrinks) lets calls through again", async () => {
    const file = path.join(tmp(), "ledger.jsonl");
    writeFileSync(file, line(0.5) + "garbage line\n", "utf8");
    const ledger = new SpendLedger({ file, ...CAP });
    let sent = 0;
    const client = createCompatClient(cfg(ledger), async () => {
      sent++;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200 });
    });
    await expect(client.chat({ system: "s", user: "u", json: true, purpose: "classify" })).rejects.toMatchObject({ code: "ledger_unavailable" });
    expect(sent).toBe(0);
    writeFileSync(file, line(0.5), "utf8");
    await client.chat({ system: "s", user: "u", json: true, purpose: "classify" });
    expect(sent).toBe(1);
    expect(ledger.summary().spentUsd).toBeGreaterThanOrEqual(0.5);
  });

  it("a partly written last line (no newline yet) is not damage: it counts as TRUNCATED_LINE_USD until it is complete (fix round 3)", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    const full = line(1.25);
    writeFileSync(file, line(0.5) + full.slice(0, 20), "utf8");
    const ledger = new SpendLedger({ file, ...CAP });
    // never under-counted while it is cut off (it used to count as US$0 until its newline arrived)
    expect(ledger.summary()).toMatchObject({ spentUsd: 0.5 + TRUNCATED_LINE_USD, truncatedLines: 1 });
    appendFileSync(file, full.slice(20), "utf8");
    expect(ledger.summary()).toMatchObject({ spentUsd: 1.75 });
    expect(ledger.summary().truncatedLines).toBeUndefined();
  });

  it("a negative usd still counts as 0, never as a refund (not damage)", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    writeFileSync(file, line(1) + line(-3), "utf8");
    expect(new SpendLedger({ file, ...CAP }).summary()).toMatchObject({ spentUsd: 1 });
  });
});

describe("unit tests never write the shared ledger", () => {
  it("VITEST wins over an exported LLM_SPEND_LOG; a test opts in with LLM_SPEND_LOG_IN_TESTS=1", () => {
    expect(resolveSpendLog({ VITEST: "true", LLM_SPEND_LOG: "D:/somewhere/llm-spend.jsonl" })).toEqual({ file: null, unavailable: null });
    expect(resolveSpendLog({ VITEST: "true", LLM_SPEND_LOG: "x.jsonl", LLM_SPEND_LOG_IN_TESTS: "1" }).file).toBe(path.resolve("x.jsonl"));
    expect(resolveSpendLog({ LLM_SPEND_LOG: "x.jsonl" }).file).toBe(path.resolve("x.jsonl"));
  });
});
