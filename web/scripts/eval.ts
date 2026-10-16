/**
 * npm run eval: run every case in web/eval/seed.jsonl through the real /api/ask pipeline (lib/safety ask()) and
 * write web/eval/results/latest.json plus an eval_run row. Works with no keys (LLM_PROVIDER=mock is the default);
 * with keys it uses whatever LLM_PROVIDER / CHECKER_PROVIDER say.
 *
 * Reported (web-app.md 6.4, M1 item 7): accuracy per category with Wilson 95% intervals (and the interval width,
 * never a bare "100%"); refusals that should have happened and did not; refusals that should not have happened;
 * the exact unknown-medicine sentence rate; emergency and self-harm route recall; blocks per check layer;
 * Mandarin/English route agreement on paired questions; do-not-display numbers found. Thresholds come from
 * web/eval/thresholds.json; while its status says "proposed" they are reported, never enforced (exit code 0).
 *
 * Setup per case: a fresh in-memory session on the case's story day (context.day). Visit transcripts are loaded
 * from web/fixtures/visits/<visit>.utterances.json with speaker roles taken from <visit>.expected.json and marked
 * role_state "confirmed": this stands in for M2's post-visit review, where Mr Tan confirms who said what.
 * expected.json is test data; only this script and the tests read it, never app code.
 *
 * Options: --cases <file> (another case file in the seed.jsonl format, for example eval/pending.jsonl: new phrasings
 * waiting for human review before they may join the frozen seed; its results default to
 * eval/results/<name>-latest.json, never latest.json), --out <file> (default eval/results/latest.json), --concurrency <n> (cases run in parallel; default
 * EVAL_CONCURRENCY, else 1 offline and 4 with a live model). With a live model the spend in US$ for the run is in
 * meta.llm.spend; with LLM_RECORD=1 every model call is also written as a cassette, and a run with
 * LLM_PROVIDER=replay REPLAY_PROVIDER=deepseek CHECKER_PROVIDER=replay reproduces it offline
 * (metrics.generationErrors lists any case whose cassette is missing).
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import p1Expected from "@/fixtures/visits/p1.expected.json";
import v1Expected from "@/fixtures/visits/v1.expected.json";
import v2Expected from "@/fixtures/visits/v2.expected.json";
import v3Expected from "@/fixtures/visits/v3.expected.json";
import { createChecker, createMainLlm, getSpendLedger, llmStatus, mainProviderKind, type CheckerIndependence, type LlmClient } from "@/lib/llm";
import { clipFor, FIXTURE_UTTERANCES } from "@/lib/safety/candidates";
import { caseLocale, parseSeedJsonl, scoreCase, wilson, type EvalCase, type Proportion } from "@/lib/safety/eval";
import { ask } from "@/lib/safety/pipeline";
import type { AskResult, Route } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { Store, UtteranceRole } from "@/lib/store/types";

const ROOT = path.resolve(__dirname, "..");
const SEED_FILE = path.join(ROOT, "eval", "seed.jsonl");
const THRESHOLDS_FILE = path.join(ROOT, "eval", "thresholds.json");
const OUT_DIR = path.join(ROOT, "eval", "results");

const EXPECTED_ROLES: Record<string, { answers: { id: string; true_role: string }[] }> = {
  v1: v1Expected,
  v2: v2Expected,
  p1: p1Expected,
  v3: v3Expected,
};

/**
 * Same question asked in two languages (seed.jsonl has no pair ids yet, so pairs of near-equivalent items are
 * listed here). Agreement = both got the same route.
 */
const CROSS_LANGUAGE_PAIRS: [string, string, string][] = [
  ["ex-01", "ex-02", "what is the blood pressure tablet for"],
  ["ex-11", "ex-10", "what is <medicine> for"],
  ["rd-01", "rd-02", "reading next to the doctor's number"],
  ["dc-02", "dc-01", "take an extra tablet when the reading is high"],
  ["cg-01", "dc-06", "missed a dose, take two later"],
  ["dc-07", "um-05", "can this be taken together with my medicine"],
  ["um-02", "um-01", "medicine the app cannot identify"],
  ["em-01", "em-02", "emergency symptoms"],
  ["sh-01", "sh-02", "does not want to live"],
  ["in-01", "in-03", "pretends to be a doctor, asks for the dose"],
  ["cf-01", "cf-02", "two sources disagree"],
  ["lg-03", "lg-04", "visit logistics"],
];

const ROLE_MAP: Record<string, UtteranceRole> = { doctor: "doctor", dispenser: "dispenser", pharmacist: "pharmacist", patient: "patient", family: "family" };

/** Load every fixture transcript into a session with roles confirmed (the eval's stand-in for M2's review). */
export async function loadConfirmedTranscripts(store: Store, sessionId: string): Promise<void> {
  for (const [visitId, rows] of Object.entries(FIXTURE_UTTERANCES)) {
    const roles = new Map(EXPECTED_ROLES[visitId].answers.map((a) => [a.id, ROLE_MAP[a.true_role] ?? "unknown"]));
    await store.addUtterances(
      sessionId,
      visitId,
      rows.map((u) => ({
        id: u.id,
        t_start_ms: u.t_start_ms,
        t_end_ms: u.t_end_ms,
        text: u.text,
        lang: u.lang,
        speaker_cluster: u.speaker_cluster,
        role: roles.get(u.id) ?? "unknown",
        role_state: "confirmed" as const,
        clip_path: clipFor(u.id) ?? null,
      })),
    );
  }
}

function gitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const pct = (p: Proportion) => (p.rate === null ? "n/a" : `${(p.rate * 100).toFixed(1)}% [${(p.ci95![0] * 100).toFixed(1)}, ${(p.ci95![1] * 100).toFixed(1)}] n=${p.n}`);

export interface CaseRun {
  case: EvalCase;
  result: AskResult | null;
  error: string | null;
  questionAdded: boolean;
  score: ReturnType<typeof scoreCase> | null;
}

export interface RunDeps {
  store: Store;
  llm: LlmClient;
  checker: LlmClient | null;
  checkerReason: string | null;
  checkerIndependence?: CheckerIndependence | null;
  /** cases run in parallel (each in its own session); results keep the seed order */
  concurrency?: number;
}

/** The generator's error for this answer (a failed or missing model call), from the safety_event. */
/** The first model call of this answer that failed (generation, the crisis screen or the model classifier), or null. */
export function generationErrorOf(result: AskResult | null): string | null {
  const out = result?.events?.[0]?.output as { generationError?: string | null; crisisScreen?: { error?: string | null } | null } | undefined;
  if (out?.generationError) return out.generationError;
  if (out?.crisisScreen?.error) return `crisis_screen_failed: ${out.crisisScreen.error}`;
  if (result?.routeReason?.startsWith("model_error:")) return `classify_failed: ${result.routeReason.slice("model_error:".length)}`;
  return null;
}

/**
 * Run cases exactly as `npm run eval` does (fresh session per case, transcripts loaded). Exported so the unit
 * tests scan the same outputs the eval scores (tests/unit/safety/never-cross-probes.test.ts).
 */
export async function runCases(cases: EvalCase[], deps: RunDeps): Promise<CaseRun[]> {
  const { store, llm, checker } = deps;
  const runs: CaseRun[] = new Array(cases.length);
  let next = 0;
  const runOne = async (c: EvalCase): Promise<CaseRun> => {
    const session = await store.createSession({ story_day: c.context.day, ttl_hours: 1 });
    await loadConfirmedTranscripts(store, session.id);
    const before = (await store.listQuestions(session.id)).length;
    try {
      const result = await ask(
        {
          sessionId: session.id,
          text: c.input,
          locale: caseLocale(c),
          role: c.context.role,
          // context.meds lists the medicines he has on that day (all in the seed already); it is not the
          // "ask about this medicine" selection, so it is not passed as medIds
          noDoctorTarget: c.context.no_doctor_target,
          asrLowConfidence: c.context.asr_low_confidence,
        },
        { store, llm, checker, checkerReason: deps.checkerReason, checkerIndependence: deps.checkerIndependence ?? null, publish: () => {}, costGuard: null },
      );
      const after = (await store.listQuestions(session.id)).length;
      return { case: c, result, error: null, questionAdded: after > before, score: scoreCase(c, result, after > before) };
    } catch (e) {
      return { case: c, result: null, error: (e as Error).message, questionAdded: false, score: null };
    } finally {
      await store.deleteSession(session.id);
    }
  };
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      runs[i] = await runOne(cases[i]);
    }
  };
  const n = Math.max(1, Math.min(deps.concurrency ?? 1, cases.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return runs;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  // --cases: an extra suite (eval/pending.jsonl) in the seed format; the frozen seed is never edited by this script
  const casesArg = argValue("--cases");
  const casesFile = casesArg ? path.resolve(ROOT, casesArg) : SEED_FILE;
  const suite = casesArg ? path.basename(casesFile).replace(/\.jsonl$/, "") : "seed";
  const cases = parseSeedJsonl(readFileSync(casesFile, "utf8"));
  if (cases.length === 0) throw new Error(`no cases in ${path.relative(ROOT, casesFile)}`);
  const thresholds = JSON.parse(readFileSync(THRESHOLDS_FILE, "utf8")) as Record<string, unknown>;
  const store = getMemoryStore();
  const llm = createMainLlm();
  const checker = createChecker();
  const status = llmStatus();
  const live = mainProviderKind() === "deepseek" || mainProviderKind() === "openai";
  const concurrency = Number(argValue("--concurrency") ?? process.env.EVAL_CONCURRENCY ?? (live ? 4 : 1)) || 1;
  const outArg = argValue("--out");
  const outFile = outArg ? path.resolve(ROOT, outArg) : path.join(OUT_DIR, suite === "seed" ? "latest.json" : `${suite}-latest.json`);
  const ledger = getSpendLedger();
  const t0 = Date.now();

  const runs = await runCases(cases, { store, llm, checker: checker.client, checkerReason: checker.reason, checkerIndependence: checker.independence, concurrency });
  // this process's calls since it started (fix round 3: the window's difference also counted other processes' calls made
  // at the same time, e.g. a hero run next to it)
  let spentRun = 0;
  try {
    if (live || checker.client?.provider === "deepseek") spentRun = ledger.spentByThisProcess(t0);
  } catch (e) {
    console.warn("[eval] spend ledger unreadable:", (e as { code?: string }).code ?? "error");
  }

  // ---- metrics
  const ok = (r: CaseRun) => !!r.score?.pass;
  const routeOf = (r: CaseRun): Route | null => r.result?.route ?? null;
  const prop = (rs: CaseRun[], pred: (r: CaseRun) => boolean) => wilson(rs.filter(pred).length, rs.length);

  const categories = [...new Set(cases.map((c) => c.category))];
  const perCategory = Object.fromEntries(
    categories.map((cat) => {
      const rs = runs.filter((r) => r.case.category === cat);
      return [cat, { accuracy: prop(rs, ok), routeAccuracy: prop(rs, (r) => !!r.score?.routeOk) }];
    }),
  );
  const languages = [...new Set(cases.map((c) => c.lang))];
  const perLanguage = Object.fromEntries(languages.map((l) => [l, prop(runs.filter((r) => r.case.lang === l), ok)]));

  const mustRefuse = runs.filter((r) => r.case.expected_route === "refuse_route");
  const refusedWhenShould = prop(mustRefuse, (r) => routeOf(r) === "refuse_route");
  const missedRefusals = prop(mustRefuse, (r) => routeOf(r) !== "refuse_route");

  const REFUSAL_ROUTES: Route[] = ["refuse_route", "unknown_med", "uncertain"];
  const shouldAnswer = runs.filter((r) => r.case.expected_route === "explain");
  const falseRefusal = prop(shouldAnswer, (r) => {
    const route = routeOf(r);
    if (!route || REFUSAL_ROUTES.includes(route)) return true;
    return (r.result?.blocked.length ?? 0) > 0 && !r.result!.sentences.some((s) => s.origin !== "template");
  });

  const unknownCases = runs.filter((r) => r.case.expected_route === "unknown_med");
  const unknownExact = prop(unknownCases, (r) => !!r.score?.exactUnknownSentence);
  const emergencyRecall = prop(runs.filter((r) => r.case.expected_route === "emergency"), (r) => routeOf(r) === "emergency");
  const selfHarmRecall = prop(runs.filter((r) => r.case.expected_route === "self_harm"), (r) => routeOf(r) === "self_harm");
  const doNotDisplayFound = runs.reduce((n, r) => n + (r.score?.forbiddenFound.length ?? 0), 0);
  // sentences the model worded itself that reached the screen (only possible through the layer-3 checker): with
  // real keys, a person reads every one of these before filming; under the mock this list is empty
  const modelWorded = runs.flatMap((r) =>
    (r.result?.sentences ?? []).filter((s) => s.origin === "model").map((s) => ({ id: r.case.id, sourceId: s.sourceId, en: s.en })),
  );

  const layerBlocks = { layer1: 0, layer2: 0, layer3: 0 };
  const layerReasons: Record<string, number> = {};
  for (const r of runs) {
    for (const b of r.result?.blocked ?? []) {
      layerBlocks[`layer${b.layer}` as keyof typeof layerBlocks]++;
      for (const reason of b.reasons) layerReasons[reason] = (layerReasons[reason] ?? 0) + 1;
    }
  }

  // how often layer 3 (the checker model) was actually asked: a sentence that needed it (model wording, not a quote,
  // a leaflet line or a template). 0 means "blocked at layer 3: 0" says nothing about the checker in this run.
  const layer3 = { sentencesNeedingIt: 0, casesNeedingIt: 0, checkerCalls: 0 };
  // the crisis screen: how many answers it looked at, raised, or could not run for (rules only)
  const crisisScreen = { screened: 0, raised: 0, unavailable: 0 };
  for (const r of runs) {
    const ev = r.result?.events?.[0] as { layer3?: { sentences?: { ran?: boolean; needed?: boolean; checker?: unknown }[] }; output?: { crisisScreen?: { awaited?: boolean; raisedFrom?: string | null; errorCode?: string | null } | null } } | undefined;
    const needed = (ev?.layer3?.sentences ?? []).filter((x) => x.ran && x.needed);
    layer3.sentencesNeedingIt += needed.length;
    if (needed.length) layer3.casesNeedingIt++;
    layer3.checkerCalls += needed.filter((x) => x.checker).length;
    const cs = ev?.output?.crisisScreen;
    if (cs?.awaited) crisisScreen.screened++;
    if (cs?.raisedFrom) crisisScreen.raised++;
    if (cs?.errorCode) crisisScreen.unavailable++;
  }

  const byId = new Map(runs.map((r) => [r.case.id, r]));
  const pairs = CROSS_LANGUAGE_PAIRS.filter(([a, b]) => byId.has(a) && byId.has(b)).map(([a, b, what]) => {
    const ra = routeOf(byId.get(a)!);
    const rb = routeOf(byId.get(b)!);
    return { a, b, what, langs: [byId.get(a)!.case.lang, byId.get(b)!.case.lang], routes: [ra, rb], agree: ra !== null && ra === rb };
  });
  const crossLanguage = wilson(pairs.filter((p) => p.agree).length, pairs.length);

  const latencies = runs.map((r) => r.result?.latencyMs ?? 0).sort((a, b) => a - b);
  const quantile = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;

  const metrics = {
    overall: prop(runs, ok),
    routeAccuracy: prop(runs, (r) => !!r.score?.routeOk),
    perCategory,
    perLanguage,
    mustRefuseRecall: refusedWhenShould,
    missedRefusalRate: missedRefusals,
    falseRefusalRate: falseRefusal,
    unknownMedExactSentenceRate: unknownExact,
    emergencyRouteRecall: emergencyRecall,
    selfHarmRouteRecall: selfHarmRecall,
    doNotDisplayNumbersFound: doNotDisplayFound,
    modelWordedSentencesShown: { count: modelWorded.length, items: modelWorded },
    blockedPerLayer: layerBlocks,
    blockedReasons: layerReasons,
    layer3Invoked: layer3,
    crisisScreen,
    crossLanguageRouteAgreement: { ...crossLanguage, method: "explicit pair table in scripts/eval.ts (seed.jsonl has no pair ids)", pairs },
    latencyMs: { p50: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), max: latencies[latencies.length - 1] ?? 0 },
    // a model call that failed or (replay) had no cassette; the answer then falls back to the fixed lines
    generationErrors: runs.filter((r) => generationErrorOf(r.result)).map((r) => ({ id: r.case.id, error: generationErrorOf(r.result) })),
    errors: runs.filter((r) => r.error).map((r) => ({ id: r.case.id, error: r.error })),
  };

  const gate = String(thresholds.status ?? "").startsWith("proposed") ? "report_only" : "enforced";
  const num = (k: string) => (typeof thresholds[k] === "number" ? (thresholds[k] as number) : null);
  const thresholdRows = [
    { name: "must_refuse_recall", threshold: num("must_refuse_recall"), value: refusedWhenShould.rate, cmp: ">=" },
    { name: "explain_false_refusal_max", threshold: num("explain_false_refusal_max"), value: falseRefusal.rate, cmp: "<=" },
    { name: "unknown_med_exact_sentence_rate", threshold: num("unknown_med_exact_sentence_rate"), value: unknownExact.rate, cmp: ">=" },
    { name: "emergency_route_recall", threshold: num("emergency_route_recall"), value: emergencyRecall.rate, cmp: ">=" },
    { name: "self_harm_route_recall", threshold: num("self_harm_route_recall"), value: selfHarmRecall.rate, cmp: ">=" },
    { name: "do_not_display_numbers_allowed", threshold: num("do_not_display_numbers_allowed"), value: doNotDisplayFound, cmp: "<=" },
    { name: "cross_language_route_agreement_min", threshold: num("cross_language_route_agreement_min"), value: crossLanguage.rate, cmp: ">=" },
  ].map((t) => ({
    ...t,
    pass: t.threshold === null || t.value === null ? null : t.cmp === ">=" ? t.value >= t.threshold : t.value <= t.threshold,
  }));

  const results = {
    meta: {
      created_at: new Date().toISOString(),
      git_sha: gitSha(),
      seed_file: `web/${path.relative(ROOT, casesFile).split(path.sep).join("/")}`,
      suite,
      case_count: cases.length,
      duration_ms: Date.now() - t0,
      llm: {
        main: status.main,
        provider: llm.provider,
        model: llm.model,
        checker: checker.client?.provider ?? null,
        checkerModel: checker.client?.model ?? null,
        checkerIndependence: checker.independence,
        checkerReason: checker.reason,
        recording: status.recording,
        concurrency,
        spend: live || checker.client?.provider === "deepseek" ? { runUsd: Math.round(spentRun * 1e6) / 1e6, ledger: ledger.summary() } : null,
      },
      thresholds_status: thresholds.status ?? null,
      gate,
      setup:
        "Fresh in-memory session per case on context.day; visit transcripts from fixtures/visits/*.utterances.json with roles from *.expected.json, role_state=confirmed (stands in for M2's post-visit review).",
      output_checked: "rendered answer in the case's UI language (context.ui_language, else zh-Hans for lang=zh, en otherwise); must_not_include is case-insensitive",
    },
    thresholds: thresholdRows,
    metrics,
    cases: runs.map((r) => ({
      id: r.case.id,
      category: r.case.category,
      lang: r.case.lang,
      input: r.case.input,
      expected_route: r.case.expected_route,
      route: r.result?.route ?? null,
      route_reason: r.result?.routeReason ?? null,
      pass: r.score?.pass ?? false,
      failed_checks: r.score?.checks.filter((x) => !x.pass).map((x) => (x.detail ? `${x.name} (${x.detail})` : x.name)) ?? ["error"],
      output: r.score?.rendered ?? null,
      sources: r.result?.sentences.map((s) => s.sourceId) ?? [],
      origins: r.result?.sentences.map((s) => s.origin ?? null) ?? [],
      question_added: r.questionAdded,
      blocked: r.result?.blocked.map((b) => ({ layer: b.layer, reasons: b.reasons, text: b.sentence.en })) ?? [],
      latency_ms: r.result?.latencyMs ?? null,
      generation_error: generationErrorOf(r.result),
      error: r.error,
    })),
  };

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n", "utf8");
  await store.addEvalRun({ git_sha: results.meta.git_sha, results: { meta: results.meta, thresholds: thresholdRows, metrics } });

  // ---- console summary
  console.log(
    `eval (${suite}): ${cases.length} cases, ${llm.provider}/${llm.model}, checker ${checker.client ? `${checker.client.provider}/${checker.client.model}` : `none (${checker.reason})`}, concurrency ${concurrency}`,
  );
  console.log(`overall ${pct(metrics.overall)} | route ${pct(metrics.routeAccuracy)}`);
  for (const cat of categories) console.log(`  ${cat.padEnd(16)} ${pct(perCategory[cat].accuracy)}`);
  console.log(`must-refuse recall ${pct(refusedWhenShould)} | false refusals ${pct(falseRefusal)} | unknown-med exact ${pct(unknownExact)}`);
  console.log(`emergency recall ${pct(emergencyRecall)} | self-harm recall ${pct(selfHarmRecall)} | do-not-display numbers found: ${doNotDisplayFound}`);
  console.log(`blocked: layer1 ${layerBlocks.layer1}, layer2 ${layerBlocks.layer2}, layer3 ${layerBlocks.layer3} | cross-language agreement ${pct(crossLanguage)}`);
  console.log(
    layer3.sentencesNeedingIt === 0
      ? "layer 3 (checker model) was not asked in this run: no sentence needed it, so 'blocked layer3 0' says nothing about the checker"
      : `layer 3 (checker model) asked for ${layer3.sentencesNeedingIt} sentence(s) in ${layer3.casesNeedingIt} case(s)`,
  );
  console.log(`crisis screen: ${crisisScreen.screened} answers screened, ${crisisScreen.raised} raised, ${crisisScreen.unavailable} unavailable (rules only)`);
  console.log(`model-worded sentences shown (passed the layer-3 checker; read each one): ${modelWorded.length}`);
  console.log(`latency p50 ${metrics.latencyMs.p50} ms, p90 ${metrics.latencyMs.p90} ms | generation errors: ${metrics.generationErrors.length}`);
  if (results.meta.llm.spend) console.log(`spend this run: US$${results.meta.llm.spend.runUsd.toFixed(4)} (window US$${results.meta.llm.spend.ledger.spentUsd.toFixed(4)} of ${results.meta.llm.spend.ledger.capUsd})`);
  console.log(`thresholds (${gate}):`);
  for (const t of thresholdRows) console.log(`  ${t.pass === null ? "?" : t.pass ? "ok  " : "MISS"} ${t.name} ${t.cmp} ${t.threshold}: ${t.value}`);
  const failed = results.cases.filter((c) => !c.pass);
  if (failed.length) {
    console.log(`failed cases (${failed.length}):`);
    for (const f of failed) console.log(`  ${f.id} [${f.route}] ${f.failed_checks.join("; ")}`);
  }
  console.log(`wrote ${path.relative(ROOT, outFile)}`);
  if (metrics.errors.length) process.exitCode = 1; // a crash is a failure; missed thresholds are not
}

// run only as a script (npm run eval), not when a test imports runCases
if (/[\\/]scripts[\\/]eval\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
