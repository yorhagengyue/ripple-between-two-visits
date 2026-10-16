/**
 * The spend ledger fails closed (10-09 wave B; round-3 safety check problem 4). The round-3 check pointed
 * LLM_SPEND_LOG at a folder: statSync read size 0, the spend counted as US$0, every call went out and only a
 * console line ("EISDIR") said the ledger was not written, so a read-only or mistyped ledger path reset the cap on
 * every restart. Now a paid call is refused with LlmError "ledger_unavailable" (507, no failover) whenever the ledger
 * cannot be read or appended, and nothing is sent; a call that happened but could not be written still counts and
 * blocks every later call until the ledger takes its line.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompatClient } from "@/lib/llm";
import type { CompatConfig } from "@/lib/llm/openai";
import { LlmError } from "@/lib/llm/types";
import { SpendLedger, type SpendEntry } from "@/lib/llm/spend";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ripple-ledger-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    // undo a read-only flag left by a failed test so the folder can be removed
    try {
      for (const f of ["ledger.jsonl"]) if (existsSync(path.join(d, f))) chmodSync(path.join(d, f), 0o666);
    } catch {
      /* ignore */
    }
    rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

const CAP = { capUsd: 5, windowMs: 86_400_000 };

function cfg(ledger: SpendLedger, over: Partial<CompatConfig> = {}): CompatConfig {
  return { name: "deepseek", vendor: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-flash", maxTokensField: "max_tokens", jsonMode: true, timeoutMs: 1000, maxAttempts: 1, ledger, ...over };
}

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200 });

const entry = (usd: number): SpendEntry => ({
  at: new Date().toISOString(),
  provider: "deepseek",
  model: "deepseek-flash",
  purpose: "classify",
  ok: true,
  error: null,
  attempts: 1,
  latency_ms: 10,
  prompt_tokens: 10,
  cache_hit_tokens: 0,
  cache_miss_tokens: 10,
  completion_tokens: 2,
  reasoning_tokens: 0,
  usd,
  estimated: false,
});

describe("a ledger that cannot be read or written refuses every paid call", () => {
  it("LLM_SPEND_LOG pointing at a folder (the round-3 reproduction): ledger_unavailable, nothing sent", async () => {
    const dir = tmp();
    const ledger = new SpendLedger({ file: dir, ...CAP });
    expect(() => ledger.reserve(0.001)).toThrow(LlmError);
    try {
      ledger.reserve(0.001);
    } catch (e) {
      expect(e).toMatchObject({ code: "ledger_unavailable", status: 507 });
      // the message names the file-system code, never the path
      expect((e as Error).message).not.toContain(dir);
    }
    const sent = { n: 0 };
    const llm = createCompatClient(cfg(ledger), async () => {
      sent.n++;
      return ok();
    });
    await expect(llm.chat({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ code: "ledger_unavailable" });
    expect(sent.n).toBe(0);
    // the summary reports it instead of throwing (status pages and the eval keep working)
    expect(ledger.summary()).toMatchObject({ ledgerError: expect.any(String), remainingUsd: 0 });
  });

  it("a ledger path whose folder cannot be created (a file is in the way): refused", () => {
    const d = tmp();
    writeFileSync(path.join(d, "blocker"), "x");
    const ledger = new SpendLedger({ file: path.join(d, "blocker", "ledger.jsonl"), ...CAP });
    expect(() => ledger.reserve(0.001)).toThrow(expect.objectContaining({ code: "ledger_unavailable" }));
  });

  it("a read-only ledger file: refused before the call (the zero-byte append fails)", async () => {
    const d = tmp();
    const file = path.join(d, "ledger.jsonl");
    writeFileSync(file, "");
    chmodSync(file, 0o444);
    const ledger = new SpendLedger({ file, ...CAP });
    const sent = { n: 0 };
    const llm = createCompatClient(cfg(ledger), async () => {
      sent.n++;
      return ok();
    });
    await expect(llm.chat({ system: "s", user: "u", maxTokens: 10 })).rejects.toMatchObject({ code: "ledger_unavailable" });
    expect(sent.n).toBe(0);
    chmodSync(file, 0o666);
    await expect(llm.chat({ system: "s", user: "u", maxTokens: 10 })).resolves.toMatchObject({ content: '{"ok":true}' });
    expect(sent.n).toBe(1);
  });

  it("a missing file and folder are created and count as zero spend (the reset still works)", () => {
    const file = path.join(tmp(), "new", "ledger.jsonl");
    const ledger = new SpendLedger({ file, ...CAP });
    const release = ledger.reserve(0.001);
    release();
    expect(existsSync(file)).toBe(true);
    expect(ledger.summary()).toMatchObject({ spentUsd: 0, remainingUsd: 5 });
    expect(ledger.summary().ledgerError).toBeUndefined();
  });

  it("an in-memory ledger (vitest, no file) is unchanged", () => {
    const ledger = new SpendLedger({ file: null, ...CAP });
    ledger.reserve(0.001)();
    ledger.record(entry(0.5));
    expect(ledger.spentUsd()).toBeCloseTo(0.5, 6);
  });
});

describe("a call that happened but could not be written", () => {
  it("still counts, blocks every later call until written, and is written first when the ledger works again", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = tmp();
    const file = path.join(d, "ledger.jsonl");
    const ledger = new SpendLedger({ file, ...CAP });
    ledger.reserve(0.01)();
    // the ledger breaks between the check and the write
    chmodSync(file, 0o444);
    ledger.record(entry(1.25));
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0].join(" "))).not.toContain(d);
    expect(ledger.spentUsd()).toBeCloseTo(1.25, 6);
    expect(ledger.summary()).toMatchObject({ unwritten: 1 });
    expect(() => ledger.reserve(0.01)).toThrow(expect.objectContaining({ code: "ledger_unavailable" }));
    // still broken: a further record is kept too, never lost
    ledger.record(entry(0.25));
    expect(ledger.spentUsd()).toBeCloseTo(1.5, 6);
    // writable again: the two lines are written before the next call goes ahead
    chmodSync(file, 0o666);
    const release = ledger.reserve(0.01);
    release();
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l).usd)).toEqual([1.25, 0.25]);
    expect(ledger.spentUsd()).toBeCloseTo(1.5, 6);
    expect(ledger.summary().unwritten).toBeUndefined();
    // another process reading the same file sees the same spend
    expect(new SpendLedger({ file, ...CAP }).spentUsd()).toBeCloseTo(1.5, 6);
  });

  it("the unwritten spend counts against the cap", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = tmp();
    const file = path.join(d, "ledger.jsonl");
    mkdirSync(d, { recursive: true });
    const ledger = new SpendLedger({ file, capUsd: 1, windowMs: 86_400_000 });
    ledger.reserve(0.01)();
    chmodSync(file, 0o444);
    ledger.record(entry(0.99));
    chmodSync(file, 0o666);
    // written on the next reserve, and 0.99 + 0.02 passes the US$1 cap
    expect(() => ledger.reserve(0.02)).toThrow(expect.objectContaining({ code: "budget" }));
  });
});

describe("fix round 1: summary() and reserve() agree on a ledger path under a regular file", () => {
  it("a path whose parent is a file: summary reports ENOTDIR (not a healthy US$5 left), reserve refuses, nothing is sent", async () => {
    const d = tmp();
    const blocker = path.join(d, "not-a-folder.txt");
    writeFileSync(blocker, "x", "utf8");
    const ledger = new SpendLedger({ file: path.join(blocker, "ledger.jsonl"), ...CAP });
    const s = ledger.summary();
    expect(s.ledgerError).toBe("ENOTDIR");
    expect(s.remainingUsd).toBe(0);
    expect(() => ledger.reserve(0.01)).toThrow(LlmError);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());
    const client = createCompatClient(cfg(ledger));
    await expect(client.chat({ system: "s", user: "u", json: true, purpose: "classify" })).rejects.toMatchObject({ code: "ledger_unavailable", status: 507 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a missing file in a missing folder is still 'no spend yet' (the folder is created on the first call)", () => {
    const d = tmp();
    const ledger = new SpendLedger({ file: path.join(d, "new", "deeper", "ledger.jsonl"), ...CAP });
    expect(ledger.summary()).toMatchObject({ spentUsd: 0, remainingUsd: 5 });
    expect(ledger.summary().ledgerError).toBeUndefined();
    const release = ledger.reserve(0.01);
    release();
    expect(existsSync(path.join(d, "new", "deeper", "ledger.jsonl"))).toBe(true);
  });
});
