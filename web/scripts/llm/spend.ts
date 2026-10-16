/**
 * What the live models cost: a summary of the spend ledger (lib/llm/spend.ts) for the rolling window, by model and
 * by purpose, with latency percentiles per purpose. Reads only counts, token numbers, latencies and US$ (the ledger
 * never holds a prompt). No model call, no key needed.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/llm/spend.ts [--hours 24] [--since <ISO time>] [--run <label>] [--out <file>]
 *
 * --run keeps only the lines one run recorded (LLM_RUN_LABEL, or "pid:<process id>"); the summary is also split by
 * run, so a run that spent nothing shows no line even while other processes call the model.
 *
 * The ledger is web/.data/llm-spend.jsonl wherever this is started from (LLM_SPEND_LOG overrides it); the cap is
 * LLM_SPEND_CAP_USD (default 5).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { countedUsd, spendCapUsd, spendLogPath, type SpendEntry } from "@/lib/llm/spend";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

export interface SpendRow {
  key: string;
  calls: number;
  failed: number;
  usd: number;
  promptTokens: number;
  completionTokens: number;
  p50Ms: number | null;
  p90Ms: number | null;
}

/** Group ledger lines by a key (model, purpose ...). Pure, for tests. */
export function summarise(entries: SpendEntry[], keyOf: (e: SpendEntry) => string): SpendRow[] {
  const groups = new Map<string, SpendEntry[]>();
  for (const e of entries) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
  return [...groups.entries()]
    .map(([key, es]) => ({
      key,
      calls: es.length,
      failed: es.filter((e) => !e.ok).length,
      usd: Math.round(es.reduce((n, e) => n + countedUsd(e.usd), 0) * 1e6) / 1e6,
      promptTokens: es.reduce((n, e) => n + e.prompt_tokens, 0),
      completionTokens: es.reduce((n, e) => n + e.completion_tokens, 0),
      p50Ms: quantile(es.filter((e) => e.ok).map((e) => e.latency_ms), 0.5),
      p90Ms: quantile(es.filter((e) => e.ok).map((e) => e.latency_ms), 0.9),
    }))
    .sort((a, b) => b.usd - a.usd);
}

/** The run a line belongs to: its run label, else its pid, else "(before run labels)". */
export function runOf(e: SpendEntry): string {
  return e.run ?? (e.pid !== undefined ? `pid:${e.pid}` : "(before run labels)");
}

/** Ledger lines in [since, now]; damaged lines are skipped. */
export function readLedger(file: string, sinceMs: number): SpendEntry[] {
  if (!existsSync(file)) return [];
  const out: SpendEntry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as SpendEntry;
      if (Date.parse(e.at) >= sinceMs) out.push(e);
    } catch {
      // skip a damaged line
    }
  }
  return out;
}

function main() {
  const file = spendLogPath({ ...process.env, VITEST: undefined });
  if (!file) throw new Error("no ledger file");
  const hours = Number(argValue("--hours") ?? 24);
  const since = argValue("--since") ? Date.parse(argValue("--since")!) : Date.now() - hours * 3_600_000;
  const run = argValue("--run");
  const entries = readLedger(file, since).filter((e) => !run || runOf(e) === run);
  const total = Math.round(entries.reduce((n, e) => n + countedUsd(e.usd), 0) * 1e6) / 1e6;
  const summary = {
    at: new Date().toISOString(),
    since: new Date(since).toISOString(),
    capUsd: spendCapUsd(),
    calls: entries.length,
    usd: total,
    byModel: summarise(entries, (e) => `${e.provider}/${e.model}`),
    byPurpose: summarise(entries, (e) => `${e.model} ${e.purpose}`),
    byRun: summarise(entries, runOf),
    ...(run ? { run } : {}),
  };
  console.log(`ledger since ${summary.since}: ${summary.calls} calls, US$${total.toFixed(4)} of the US$${summary.capUsd} cap`);
  for (const r of summary.byRun) console.log(`  run ${r.key.padEnd(28)} ${String(r.calls).padStart(4)} calls  US$${r.usd.toFixed(4)}`);
  for (const r of summary.byPurpose) console.log(`  ${r.key.padEnd(32)} ${String(r.calls).padStart(4)} calls  ${String(r.failed).padStart(3)} failed  US$${r.usd.toFixed(4)}  p50 ${r.p50Ms ?? "-"} ms  p90 ${r.p90Ms ?? "-"} ms`);
  const out = argValue("--out");
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2) + "\n", "utf8");
}

if (/[\\/]scripts[\\/]llm[\\/]spend\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) main();
