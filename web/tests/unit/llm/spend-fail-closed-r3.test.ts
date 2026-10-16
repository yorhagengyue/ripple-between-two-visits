/**
 * Fix round 3 for the spend ledger (10-10, the B2 checks after fix round 2):
 *   - summary() reported a healthy ledger for a read-only file while reserve() refused every call (EPERM): summary() now
 *     makes the same file test, without writing;
 *   - a cut-off last line (a process killed while appending) counted as US$0 while waiting for its newline, and the next
 *     record() glued its own line onto it, making one damaged line that stopped every paid call: a cut-off line now counts
 *     as TRUNCATED_LINE_USD (more than any one call), and a stale one gets a newline before the next line;
 *   - the eval's "spend this run" was the window's difference, other processes' calls included: spentByThisProcess.
 */
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LlmError } from "@/lib/llm/types";
import { SpendLedger, TRUNCATED_LINE_USD } from "@/lib/llm/spend";

const dirs: string[] = [];
const files: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ripple-ledger-r3-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const f of files.splice(0)) {
    try {
      chmodSync(f, 0o666);
    } catch {
      // already gone
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CAP = { capUsd: 5, windowMs: 86_400_000 };
const line = (usd: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: new Date().toISOString(), provider: "hunyuan", model: "hy3", purpose: "classify", ok: true, usd, ...extra }) + "\n";
const entry = (usd: number) => ({
  at: new Date().toISOString(),
  provider: "hunyuan",
  model: "hy3",
  purpose: "classify" as const,
  ok: true,
  error: null,
  attempts: 1,
  latency_ms: 5,
  prompt_tokens: 1,
  cache_hit_tokens: 0,
  cache_miss_tokens: 1,
  completion_tokens: 1,
  reasoning_tokens: 0,
  usd,
  estimated: false,
});

describe("summary() reports what reserve() would do", () => {
  it("a read-only ledger file: summary() reports the file-system code and nothing remaining, reserve() refuses the same way", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    writeFileSync(file, line(0.5), "utf8");
    chmodSync(file, 0o444);
    files.push(file);
    const ledger = new SpendLedger({ file, ...CAP });
    const s = ledger.summary();
    expect(s.ledgerError).toMatch(/^(EPERM|EACCES)$/);
    expect(s.remainingUsd).toBe(0);
    let err: unknown;
    try {
      ledger.reserve(0.001);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("ledger_unavailable");
    expect((err as LlmError).message).toContain(s.ledgerError!);
  });

  it("a path under a regular file and a folder in the file's place: both report an error, as reserve() refuses", () => {
    const dir = tmp();
    const blocker = path.join(dir, "not-a-folder");
    writeFileSync(blocker, "x", "utf8");
    const under = new SpendLedger({ file: path.join(blocker, "ledger.jsonl"), ...CAP });
    expect(under.summary().ledgerError).toBeTruthy();
    expect(() => under.reserve(0.001)).toThrow(/ledger_unavailable|spend ledger unavailable/);
    const folder = new SpendLedger({ file: dir, ...CAP });
    expect(folder.summary().ledgerError).toBeTruthy();
    expect(() => folder.reserve(0.001)).toThrow(/spend ledger unavailable/);
  });

  it("a writable ledger and a missing one (created on the first call) are healthy", () => {
    const dir = tmp();
    const ok = new SpendLedger({ file: path.join(dir, "ledger.jsonl"), ...CAP });
    expect(ok.summary().ledgerError).toBeUndefined();
    writeFileSync(path.join(dir, "ledger.jsonl"), line(0.25), "utf8");
    expect(ok.summary()).toMatchObject({ spentUsd: 0.25 });
    expect(ok.summary().ledgerError).toBeUndefined();
  });
});

describe("a cut-off line is never counted as less than a call could cost", () => {
  it("a cut-off last line counts as TRUNCATED_LINE_USD; once complete it counts as written", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    const full = line(0.01);
    writeFileSync(file, line(0.5) + full.slice(0, 25), "utf8");
    const ledger = new SpendLedger({ file, ...CAP });
    expect(ledger.spentUsd()).toBeCloseTo(0.5 + TRUNCATED_LINE_USD, 9);
    appendFileSync(file, full.slice(25), "utf8");
    expect(ledger.spentUsd()).toBeCloseTo(0.51, 9);
    expect(TRUNCATED_LINE_USD).toBeGreaterThan(0.1);
  });

  it("a dead write (stale cut-off line): the next record starts a new line, nothing is glued, calls go on, the cut-off line counts", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    writeFileSync(file, line(0.5) + line(0.01).slice(0, 40), "utf8");
    // ten seconds later: the cut-off line is stale (STALE_PARTIAL_MS)
    const ledger = new SpendLedger({ file, ...CAP, now: () => Date.now() + 10_000 });
    ledger.record(entry(0.02));
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines[2]).toMatch(/^\{"at":/);
    expect(() => JSON.parse(lines[2])).not.toThrow();
    // the cut-off line is a line of its own now, counted as TRUNCATED_LINE_USD; no corrupt_line
    expect(ledger.spentUsd()).toBeCloseTo(0.5 + TRUNCATED_LINE_USD + 0.02, 9);
    expect(ledger.summary().ledgerError).toBeUndefined();
    expect(ledger.summary().truncatedLines).toBe(1);
    expect(() => ledger.reserve(0.001)()).not.toThrow();
    // a fresh reader of the same file agrees
    expect(new SpendLedger({ file, ...CAP }).spentUsd()).toBeCloseTo(0.5 + TRUNCATED_LINE_USD + 0.02, 9);
  });

  it("a line that is not a ledger line at all is still damage: every paid call refused (corrupt_line)", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    writeFileSync(file, line(0.5) + "garbage line\n", "utf8");
    const ledger = new SpendLedger({ file, ...CAP });
    expect(() => ledger.spentUsd()).toThrow(/corrupt_line/);
    expect(ledger.summary()).toMatchObject({ ledgerError: "corrupt_line", remainingUsd: 0 });
  });
});

describe("spend of this run", () => {
  it("counts only this process's lines since the run started, not another process's calls at the same time", () => {
    const file = path.join(tmp(), "ledger.jsonl");
    const t0 = Date.now() - 1000;
    writeFileSync(
      file,
      [
        line(0.3, { at: new Date(t0 - 60_000).toISOString(), pid: process.pid }), // this process, before the run
        line(0.2, { pid: process.pid + 1 }), // another process, during the run
        line(0.05, { pid: process.pid }), // this run
      ].join(""),
      "utf8",
    );
    const ledger = new SpendLedger({ file, ...CAP });
    ledger.record(entry(0.01)); // this run, through record()
    expect(ledger.spentByThisProcess(t0)).toBeCloseTo(0.06, 9);
    expect(ledger.spentUsd()).toBeCloseTo(0.56, 9);
  });
});
