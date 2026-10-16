/**
 * What /eval shows (real-status: the page was an empty shell; real-app 12: "/eval 显示最近一次评测的真实结果（条数、通过数、
 * 时间、模型）"): the latest run of the frozen 51-question set with the real model (the newest file in web/eval/results
 * whose provider is not the offline stand-in), and the latest offline run next to it (results/latest.json, the run every
 * merge repeats with the deterministic stand-in). Read from disk on each request, so a new `npm run eval` shows up without
 * a rebuild; a server without the files says so. Only the numbers are taken: never a file path, a key or the spend
 * ledger's location. Server-only.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Rate {
  n: number;
  k: number;
  rate: number;
  ci95: [number, number] | null;
}

export interface EvalRunView {
  /** ISO time the run finished */
  at: string;
  cases: number;
  passed: number;
  overall: Rate;
  provider: string;
  model: string;
  checkerModel: string | null;
  /** the checker is the main model's vendor (a different model) */
  sameVendorChecker: boolean;
  categories: { name: string; n: number; k: number }[];
  languages: { name: string; n: number; k: number }[];
  safety: {
    mustRefuse: Rate | null;
    falseRefusal: Rate | null;
    emergency: Rate | null;
    selfHarm: Rate | null;
    unknownMedSentence: Rate | null;
    hiddenNumbersShown: number | null;
    modelWordedShown: number | null;
  };
  blocked: { layer1: number; layer2: number; layer3: number } | null;
  checkerCalls: number | null;
  latency: { p50: number; p95: number; max: number } | null;
  costUsd: number | null;
  thresholdsPassed: number | null;
  thresholdsTotal: number | null;
}

export interface EvalPage {
  live: EvalRunView | null;
  offline: EvalRunView | null;
  /** questions written and waiting for review (eval/pending.jsonl), not part of the frozen set */
  pending: number | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function rate(v: unknown): Rate | null {
  const r = obj(v);
  const n = num(r.n);
  const k = num(r.k);
  if (n === null || k === null) return null;
  const ci = Array.isArray(r.ci95) && r.ci95.length === 2 && r.ci95.every((x) => typeof x === "number") ? (r.ci95 as [number, number]) : null;
  return { n, k, rate: num(r.rate) ?? (n ? k / n : 0), ci95: ci };
}

/** One results file as /eval shows it, or null when it is not a run of the question set. */
export function evalRunView(raw: unknown): EvalRunView | null {
  const j = obj(raw);
  const meta = obj(j.meta);
  const metrics = obj(j.metrics);
  const llm = obj(meta.llm);
  const overall = rate(metrics.overall);
  const at = str(meta.created_at);
  const cases = num(meta.case_count);
  if (!overall || !at || cases === null) return null;
  const perCat = obj(metrics.perCategory);
  const categories = Object.entries(perCat)
    .map(([name, v]) => ({ name, r: rate(obj(v).accuracy) }))
    .filter((c): c is { name: string; r: Rate } => !!c.r)
    .map(({ name, r }) => ({ name, n: r.n, k: r.k }));
  const languages = Object.entries(obj(metrics.perLanguage))
    .map(([name, v]) => ({ name, r: rate(v) }))
    .filter((c): c is { name: string; r: Rate } => !!c.r)
    .map(({ name, r }) => ({ name, n: r.n, k: r.k }));
  const blocked = obj(metrics.blockedPerLayer);
  const latency = obj(metrics.latencyMs);
  const thresholds = Array.isArray(j.thresholds) ? (j.thresholds as unknown[]).map(obj) : null;
  return {
    at,
    cases,
    passed: overall.k,
    overall,
    provider: str(llm.provider) ?? str(llm.main) ?? "unknown",
    model: str(llm.model) ?? "unknown",
    checkerModel: str(llm.checkerModel),
    sameVendorChecker: llm.checkerIndependence === "same_vendor",
    categories,
    languages,
    safety: {
      mustRefuse: rate(metrics.mustRefuseRecall),
      falseRefusal: rate(metrics.falseRefusalRate),
      emergency: rate(metrics.emergencyRouteRecall),
      selfHarm: rate(metrics.selfHarmRouteRecall),
      unknownMedSentence: rate(metrics.unknownMedExactSentenceRate),
      hiddenNumbersShown: num(metrics.doNotDisplayNumbersFound),
      modelWordedShown: num(obj(metrics.modelWordedSentencesShown).count),
    },
    blocked: num(blocked.layer1) !== null ? { layer1: num(blocked.layer1)!, layer2: num(blocked.layer2) ?? 0, layer3: num(blocked.layer3) ?? 0 } : null,
    checkerCalls: num(obj(metrics.layer3Invoked).checkerCalls),
    latency: num(latency.p50) !== null ? { p50: num(latency.p50)!, p95: num(latency.p95) ?? num(latency.p50)!, max: num(latency.max) ?? num(latency.p50)! } : null,
    costUsd: num(obj(llm.spend).runUsd),
    thresholdsPassed: thresholds ? thresholds.filter((t) => t.pass === true).length : null,
    thresholdsTotal: thresholds ? thresholds.length : null,
  };
}

const isOffline = (v: EvalRunView) => v.provider === "mock" || v.provider === "replay";

/** The newest live run and the offline run of a results folder (web/eval/results by default). */
export function readEvalPage(dir: string = path.join(process.cwd(), "eval")): EvalPage {
  const resultsDir = path.join(dir, "results");
  let views: EvalRunView[] = [];
  let offline: EvalRunView | null = null;
  try {
    for (const name of readdirSync(resultsDir)) {
      if (!name.endsWith(".json")) continue;
      let view: EvalRunView | null = null;
      try {
        view = evalRunView(JSON.parse(readFileSync(path.join(resultsDir, name), "utf8")));
      } catch {
        view = null;
      }
      if (!view) continue;
      if (name === "latest.json") offline = isOffline(view) ? view : offline;
      views.push(view);
    }
  } catch {
    views = [];
  }
  const live = views.filter((v) => !isOffline(v)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  offline ??= views.filter(isOffline).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  let pending: number | null = null;
  try {
    pending = readFileSync(path.join(dir, "pending.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim()).length;
  } catch {
    pending = null;
  }
  return { live, offline, pending };
}
