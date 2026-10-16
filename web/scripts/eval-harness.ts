/**
 * The guided safety harness's eval (web/eval/harness/README.md): every case and script of web/eval/harness/*.jsonl through
 * the real ask() pipeline, scored by lib/safety/eval-harness.ts. The frozen seed eval (scripts/eval.ts, eval/seed.jsonl,
 * eval/results/) is not touched: results go to D:/ripple-c2/tmp/harness-1016/ unless --out says otherwise, and no eval_run
 * row is written.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/eval-harness.ts [--mode mock|live|timeout] [--repeat N] [--concurrency N]
 *        [--out <file>] [--only <category | id prefix>] [--no-walk] [--dir <corpus dir>]
 *   (live and timeout need web/.env's key: node --env-file=.env ...; a key set in the shell wins over the file)
 *
 * Modes:
 *   mock     the offline mock model (LLM_PROVIDER=mock): rules, the offline composer and code only
 *   live     Hunyuan (hy3, checker hy4-preview) as POST /api/ask runs it
 *   timeout  live, but every model call whose purpose is "risk_screen" waits until it is aborted (the screen always times
 *            out): the degraded path the harness promises still runs on code and buttons
 * --repeat N (live default 3, else 1): a case passes only if every run passes (worst-of-N); each run is a fresh session.
 *
 * Setup per run, as scripts/eval.ts: a fresh in-memory session on the case's story day (context.day, default 45), the visit
 * transcripts loaded with confirmed roles (loadConfirmedTranscripts). As POST /api/ask does, each ask is kept as his turn
 * (recordAskTurn), so the engine reads the conversation from where it reads it in the app. context.turns are asked first,
 * one by one. His family's notice goes to a spy (familyTold), never to a phone. A follow-up is answered as the screen would:
 * a new ask whose text is the chosen option's words and whose `reply` names the question and the option.
 *
 * Pathway cases (expected.followUpPathway set): after the case's answer, the "walk" answers every further question on the
 * calm side (first-calm) until none comes (at most MAX_WALK): the number of questions a calm person is asked (--no-walk off).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { familyAlarm } from "@/lib/care/told";
import { createChecker, createMainLlm, getSpendLedger, llmStatus, mainProviderKind, type LlmClient } from "@/lib/llm";
import {
  answerText,
  DEFAULT_DAY,
  harnessLocale,
  harnessMetrics,
  MAX_WALK,
  mergeCorpora,
  observe,
  parseHarnessJsonl,
  pickOption,
  replyText,
  scoreAnswer,
  withHeldPurpose,
  withTally,
  worstSeverity,
  type AnswerScore,
  type CallTally,
  type Expected,
  type Failure,
  type HarnessCorpus,
  type HarnessMetrics,
  type Severity,
  type HarnessScript,
  type Observed,
  type ScoredCase,
  type ScoredRun,
  type ScoredScript,
  type ScoredScriptRun,
  type Selector,
  Pacer,
  type SingleCase,
} from "@/lib/safety/eval-harness";
import { ask, type AskDeps, type AskInput } from "@/lib/safety/pipeline";
import { renderText } from "@/lib/safety/render";
import { detectLang } from "@/lib/safety/text";
import { recordAskTurn } from "@/lib/safety/turns";
import type { PathwayId } from "@/lib/safety/risk/types";
import type { AskResult, Locale } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { Store } from "@/lib/store/types";
import { loadConfirmedTranscripts } from "@/scripts/eval";

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DIR = path.join(ROOT, "eval", "harness");
const DEFAULT_OUT_DIR = "D:/ripple-c2/tmp/harness-1016";

type Mode = "mock" | "live" | "timeout";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A held-out file (heldout-*.jsonl): kept out of a corpus run, run on its own with --only heldout. */
export const isHeldOutFile = (file: string) => file.startsWith("heldout");

/**
 * The corpus files of a folder. `set`: "corpus" (every file but the held-out ones; the default), "heldout" (only those),
 * "all". The held-out files are for measuring the engine after it was fixed against the corpus: whoever fixes the engine
 * does not open them.
 */
export function loadCorpus(dir = DEFAULT_DIR, set: "corpus" | "heldout" | "all" = "corpus"): HarnessCorpus {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => set === "all" || (set === "heldout") === isHeldOutFile(f))
    .sort();
  return mergeCorpora(files.map((f) => parseHarnessJsonl(readFileSync(path.join(dir, f), "utf8"), f)));
}

/** One conversation's asking: a session, the deps, and the spy for his family's notice. */
interface Conversation {
  store: Store;
  sessionId: string;
  day: number;
  locale: Locale;
  deps: AskDeps;
  /** tellFamily calls (the spy) and the route's signals of the last ask (its "ask.route" event) */
  told: { count: number; signals: string[] };
  /** live runs: the pacing and the vendor's 429s (env), and whether any ask of this conversation met a 429 */
  env: Env;
  rateLimited: boolean;
  /** the risk screen's errors of this conversation's asks (risk.screen.error: deadline, timeout, upstream ...) */
  screenErrors: string[];
}

interface Asked {
  result: AskResult;
  obs: Observed;
  latencyMs: number;
}

async function askOnce(conv: Conversation, text: string, reply?: AskInput["reply"]): Promise<Asked> {
  // live: no ask starts until the last minute's model calls leave room for it (TokenHub: 60 a minute per model, shared)
  if (conv.env.pacer) conv.env.paced.ms += await conv.env.pacer.waitTurn();
  const before = conv.told.count;
  const before429 = conv.env.rate.count429;
  conv.told.signals = [];
  const result = await ask({ sessionId: conv.sessionId, text, locale: conv.locale, ...(reply ? { reply } : {}) }, conv.deps);
  // the family notice is started without being waited for: let it reach the spy
  await new Promise((r) => setImmediate(r));
  await recordAskTurn(conv.store, conv.sessionId, { day: conv.day, text, lang: detectLang(text), result }).catch(() => undefined);
  // the app tells his family only on an account (pipeline.ts); these sessions are the demo's, so "told" here is the spy or
  // what the app's own rule (lib/care/told.ts familyAlarm) would have done on his account
  const wouldTell = familyAlarm({ route: result.route, signals: conv.told.signals, sentences: result.sentences }) !== null;
  if (conv.env.rate.count429 > before429) conv.rateLimited = true;
  if (result.risk?.screen?.error) conv.screenErrors.push(result.risk.screen.error);
  return { result, obs: observe(result, { familyToldSpy: conv.told.count > before || wouldTell }), latencyMs: result.latencyMs };
}

/** Answer the last answer's follow-up with a selector; null when there is none or no option fits. */
async function replyTo(conv: Conversation, last: AskResult, sel: Selector): Promise<{ asked: Asked; how: string; text: string } | null> {
  const f = last.followUp;
  if (!f) return null;
  const pick = pickOption(f, sel);
  if (!pick) return null;
  const text = replyText(f, pick.ids, conv.locale) || pick.ids.join(", ");
  const asked = await askOnce(conv, text, { followUpId: f.id, optionIds: pick.ids });
  return { asked, how: `${f.pathway}#${f.step}: ${pick.how} -> ${pick.ids.join("+")}`, text };
}

interface CaseRunOut extends ScoredRun {
  route: string;
  output: string;
  /** every line in both languages and the follow-up question with its options (what mustNotInclude reads; --rescore) */
  shown: string;
  /** risk.screen.error of this run's asks (the screen gave no frame: deadline, timeout, upstream ...) */
  screenErrors?: string[];
  error: string | null;
  walk?: { questions: number; trail: string[]; end: { level: number; ladder: string } | null };
  turnsBefore: { text: string; level: number; ladder: string; followUp: string | null }[];
}

interface ScriptRunOut extends ScoredScriptRun {
  /** replies that could not be made, answers that never came */
  extra: Failure[];
  screenErrors?: string[];
  error: string | null;
  trail: { said: string; how?: string; level: number; ladder: string; followUp: string | null; watch: boolean | null; failures: string[] }[];
}

const errorObs = (route = "error"): Observed => ({
  source: "derived",
  level: 4,
  ladder: "none",
  rows: [],
  frameSource: "error",
  followUp: null,
  familyTold: false,
  watch: null,
  route,
  routeReason: "error",
  templates: [],
});

interface Env {
  store: Store;
  llm: LlmClient;
  checker: LlmClient | null;
  checkerReason: string | null;
  walk: boolean;
  /** live and timeout modes: keeps the run under the vendor's per-minute limit */
  pacer: Pacer | null;
  /** HTTP 429s the vendor answered in this process (a tap on fetch; with concurrency 1 each is this ask's) */
  rate: { count429: number };
  /** time spent waiting for the pacer */
  paced: { ms: number };
}

async function withConversation<T>(env: Env, c: { lang: string; context?: SingleCase["context"] }, fn: (conv: Conversation) => Promise<T>): Promise<T> {
  const day = c.context?.day ?? DEFAULT_DAY;
  const session = await env.store.createSession({ story_day: day, ttl_hours: 1 });
  await loadConfirmedTranscripts(env.store, session.id);
  const told = { count: 0, signals: [] as string[] };
  const conv: Conversation = {
    store: env.store,
    sessionId: session.id,
    day,
    locale: harnessLocale(c),
    told,
    env,
    rateLimited: false,
    screenErrors: [],
    deps: {
      store: env.store,
      llm: env.llm,
      checker: env.checker,
      checkerReason: env.checkerReason,
      publish: (_sid, type, _say, data) => {
        if (type === "ask.route") told.signals = ((data as { signals?: string[] } | null)?.signals ?? []).slice();
      },
      costGuard: null,
      tellFamily: async () => {
        told.count++;
        return { sent: 0 };
      },
    },
  };
  try {
    return await fn(conv);
  } finally {
    await env.store.deleteSession(session.id).catch(() => undefined);
  }
}

const failureText = (f: Failure) => `${f.severity} ${f.check}${f.detail ? ` (${f.detail})` : ""}`;

const brief = (a: Asked) => ({ level: a.obs.level, ladder: a.obs.ladder, followUp: a.obs.followUp ? `${a.obs.followUp.pathway}#${a.obs.followUp.step}` : null });

async function runCase(env: Env, c: SingleCase): Promise<CaseRunOut> {
  try {
    return await withConversation(env, c, async (conv) => {
      const turnsBefore: CaseRunOut["turnsBefore"] = [];
      for (const t of c.context?.turns ?? []) turnsBefore.push({ text: t, ...brief(await askOnce(conv, t)) });
      const a = await askOnce(conv, c.input);
      const score = scoreAnswer(c.expected, a.obs, answerText(a.result), c.severityIfMissed);
      const t = answerText(a.result);
      const out: CaseRunOut = {
        obs: a.obs,
        score,
        latencyMs: a.latencyMs,
        route: a.result.route,
        output: renderText(a.result, conv.locale),
        shown: `${t.sentences}\n${t.followUp}`,
        error: null,
        turnsBefore,
      };
      if (env.walk && typeof c.expected.followUpPathway === "string") {
        const trail: string[] = [];
        let last = a;
        let questions = a.result.followUp ? 1 : 0;
        while (last.result.followUp && questions <= MAX_WALK) {
          const r = (await replyTo(conv, last.result, "first-calm")) ?? (await replyTo(conv, last.result, { optionIndex: 0 }));
          if (!r) break;
          trail.push(r.how);
          last = r.asked;
          if (last.result.followUp) questions++;
        }
        out.walkQuestions = questions;
        out.walk = { questions, trail, end: trail.length ? { level: last.obs.level, ladder: last.obs.ladder } : null };
      }
      out.rateLimited = conv.rateLimited;
      out.screenErrors = conv.screenErrors;
      return out;
    });
  } catch (e) {
    const failure: Failure = { check: "error", severity: c.severityIfMissed, detail: (e as Error).message };
    return { obs: errorObs(), score: { pass: false, failures: [failure], worst: c.severityIfMissed }, latencyMs: 0, route: "error", output: "", shown: "", error: (e as Error).message, turnsBefore: [] };
  }
}

async function runScript(env: Env, s: HarnessScript): Promise<ScriptRunOut> {
  const turns: ScriptRunOut["turns"] = [];
  const trail: ScriptRunOut["trail"] = [];
  const extra: Failure[] = [];
  let followUps = 0;
  let last: Asked | null = null;
  const seen = { rateLimited: false, screenErrors: [] as string[] };
  const note = (said: string, a: Asked, how?: string) => {
    if (a.result.followUp) followUps++;
    trail.push({ said, ...(how ? { how } : {}), ...brief(a), watch: a.obs.watch, failures: [] });
  };
  try {
    await withConversation(env, s, async (conv) => {
      for (const [i, t] of s.turns.entries()) {
        let answered: Asked | null = null;
        if (t.replyWith) {
          const r = last ? await replyTo(conv, last.result, t.replyWith) : null;
          if (r) {
            answered = r.asked;
            note(`(tap) ${r.text}`, r.asked, r.how);
            for (let n = 0; t.untilDone && answered.result.followUp && n < MAX_WALK; n++) {
              const more = await replyTo(conv, answered.result, t.replyWith);
              if (!more) break;
              answered = more.asked;
              note(`(tap) ${more.text}`, more.asked, more.how);
            }
          } else {
            const f = last?.result.followUp;
            const why = f ? "no_option_fits" : "no_follow_up_to_reply_to";
            extra.push({ check: `turn${i + 1}:${why}`, severity: "S3", ...(f ? { detail: `${f.pathway}: ${f.options.map((o) => o.id).join(", ")}` } : {}) });
            if (t.text) {
              answered = await askOnce(conv, t.text);
              note(t.text, answered, `typed (${why})`);
            }
          }
        } else if (t.text) {
          answered = await askOnce(conv, t.text);
          note(t.text, answered);
        }
        if (answered) last = answered;
        if (t.expected) {
          if (answered) {
            const sc = scoreAnswer(t.expected, answered.obs, answerText(answered.result), s.severityIfMissed);
            turns.push({ obs: answered.obs, score: sc });
            trail[trail.length - 1].failures = sc.failures.map(failureText);
          } else {
            turns.push({ obs: null, score: null, note: "no answer for this turn" });
            extra.push({ check: `turn${i + 1}:no_answer`, severity: s.severityIfMissed });
          }
        }
      }
      seen.rateLimited = conv.rateLimited;
      seen.screenErrors = conv.screenErrors;
    });
  } catch (e) {
    const failure: Failure = { check: "error", severity: s.severityIfMissed, detail: (e as Error).message };
    return { turns, end: { pass: false, failures: [failure], worst: s.severityIfMissed }, followUps, pass: false, worst: s.severityIfMissed, extra, error: failure.detail!, trail };
  }
  // the end state alone decides follow-up completion; the script passes when every turn, every reply and the end pass
  // (assigned inside the conversation's callback, which the compiler does not follow)
  const final = last as Asked | null;
  const end: AnswerScore = final
    ? scoreAnswer(s.expectedEnd, final.obs, answerText(final.result), s.severityIfMissed)
    : { pass: false, failures: [{ check: "no_answer", severity: s.severityIfMissed }], worst: s.severityIfMissed };
  const pass = end.pass && extra.length === 0 && turns.every((t) => t.score?.pass ?? false);
  const worst = worstSeverity([end.worst, ...extra.map((x) => x.severity), ...turns.map((t) => t.score?.worst ?? null)]);
  return { turns, end, followUps, pass, worst, extra, error: null, trail, rateLimited: seen.rateLimited, screenErrors: seen.screenErrors };
}

function gitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const pct = (p: { rate: number | null; ci95: [number, number] | null; n: number; k?: number }) =>
  p.rate === null ? `n/a (n=0)` : `${(p.rate * 100).toFixed(1)}% [${(p.ci95![0] * 100).toFixed(1)}, ${(p.ci95![1] * 100).toFixed(1)}] ${p.k}/${p.n}`;

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

async function main() {
  const rescoreFile = argValue("--rescore");
  if (rescoreFile) {
    const from = path.resolve(ROOT, rescoreFile);
    return rescore(from, argValue("--out") ? path.resolve(ROOT, argValue("--out")!) : from.replace(/\.json$/, "-rescored.json"));
  }
  const mode = (argValue("--mode") ?? "mock") as Mode;
  if (!["mock", "live", "timeout"].includes(mode)) throw new Error(`--mode must be mock, live or timeout (got ${mode})`);
  // the provider is chosen before any client is made (createMainLlm reads the environment when called)
  if (mode === "mock") process.env.LLM_PROVIDER = "mock";
  else {
    process.env.LLM_PROVIDER = "hunyuan";
    process.env.CHECKER_PROVIDER = process.env.CHECKER_PROVIDER || "hunyuan";
    if (mainProviderKind() !== "hunyuan") throw new Error(`--mode ${mode} needs Hunyuan (${llmStatus().hunyuanProblem ?? "not configured"}); run with node --env-file=.env`);
  }
  const repeat = Math.max(1, Number(argValue("--repeat") ?? (mode === "live" ? 3 : 1)) || 1);
  // live: one ask at a time by default, paced under --rpm calls a minute per model (TokenHub allows 60 a minute per model
  // on a key other agents share; over it a 429 with Retry-After 60)
  const concurrency = Math.max(1, Number(argValue("--concurrency") ?? (mode === "mock" ? 4 : 1)) || 1);
  const rpm = Math.max(10, Number(argValue("--rpm") ?? 30) || 30);
  const pacer = mode === "mock" ? null : new Pacer(rpm);
  const rate = { count429: 0 };
  if (mode !== "mock") {
    // a tap on fetch: counts the vendor's 429s (status only, never a body), so a rate-limited answer is set apart, not
    // counted as a miss; the clients made below take this fetch
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const res = await realFetch(input, init);
      if (res.status === 429) {
        rate.count429++;
        pacer?.rateLimited(Math.max(1, Number(res.headers.get("retry-after")) || 60) * 1000);
      }
      return res;
    }) as typeof fetch;
  }
  const only = argValue("--only");
  const dir = argValue("--dir") ? path.resolve(ROOT, argValue("--dir")!) : DEFAULT_DIR;
  const outFile = argValue("--out") ? path.resolve(ROOT, argValue("--out")!) : path.join(DEFAULT_OUT_DIR, `${mode}-${stamp()}.json`);
  if (path.resolve(outFile).replace(/\\/g, "/").includes("/eval/results/")) throw new Error("the harness eval never writes eval/results/ (the frozen seed's)");

  // --only heldout: the held-out files alone; any other --only narrows the corpus (held-out files left out)
  const heldout = only === "heldout";
  const corpus = loadCorpus(dir, heldout ? "heldout" : "corpus");
  const pick = <T extends { id: string; category: string }>(xs: T[]) => (only && !heldout ? xs.filter((x) => x.category === only || x.id.startsWith(only)) : xs);
  const singles = pick(corpus.singles);
  const scripts = pick(corpus.scripts);
  if (!singles.length && !scripts.length) throw new Error(`nothing matches --only ${only}`);

  const tally = new Map<string, CallTally>();
  const baseLlm = createMainLlm();
  const llm = withTally(mode === "timeout" ? withHeldPurpose(baseLlm, "risk_screen") : baseLlm, tally, pacer ?? undefined);
  const checker = createChecker();
  const checkerClient = checker.client ? withTally(checker.client, tally, pacer ?? undefined) : null;
  const store = getMemoryStore();
  const paced = { ms: 0 };
  const env: Env = { store, llm, checker: checkerClient, checkerReason: checker.reason, walk: !process.argv.includes("--no-walk"), pacer, rate, paced };
  const ledger = getSpendLedger();
  const t0 = Date.now();
  // whether the harness answers is read from the answers themselves (a RiskSummary on them), after the run
  const tree = existsSync(path.join(ROOT, "lib", "safety", "risk", "screen.ts")) ? "risk/ in the tree" : "no risk/ in the tree";
  console.log(`harness eval: mode ${mode}, ${llm.provider}/${llm.model}, checker ${checkerClient ? `${checkerClient.provider}/${checkerClient.model}` : `none (${checker.reason})`}, repeat ${repeat}, concurrency ${concurrency}, ${singles.length} cases + ${scripts.length} scripts, ${tree}`);

  // every (case, run) and (script, run) is one job; results keep the corpus order
  const caseRuns: CaseRunOut[][] = singles.map(() => []);
  const scriptRuns: ScriptRunOut[][] = scripts.map(() => []);
  const jobs: (() => Promise<void>)[] = [];
  for (let r = 0; r < repeat; r++) {
    singles.forEach((c, i) => jobs.push(async () => void caseRuns[i].push(await runCase(env, c))));
    scripts.forEach((s, i) => jobs.push(async () => void scriptRuns[i].push(await runScript(env, s))));
  }
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      await j();
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));

  const scoredCases: ScoredCase[] = singles.map((c, i) => ({ c, runs: caseRuns[i] }));
  const scoredScripts: ScoredScript[] = scripts.map((s, i) => ({ s, runs: scriptRuns[i] }));
  const metrics = harnessMetrics(scoredCases, scoredScripts);

  let spentRun = 0;
  if (mode !== "mock") {
    try {
      spentRun = ledger.spentByThisProcess(t0);
    } catch (e) {
      console.warn("[harness] spend ledger unreadable:", (e as { code?: string }).code ?? "error");
    }
  }
  const calls = Object.fromEntries(
    [...tally.entries()].map(([k, t]) => {
      const ms = [...t.ms].sort((a, b) => a - b);
      return [k, { calls: t.calls, errors: t.errors, usd: Math.round(t.usd * 1e6) / 1e6, p50Ms: ms[Math.floor(ms.length / 2)] ?? 0, p90Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.9))] ?? 0 }];
    }),
  );

  const results = {
    meta: {
      created_at: new Date().toISOString(),
      git_sha: gitSha(),
      mode,
      repeat,
      concurrency,
      only: only ?? null,
      corpus: path.relative(ROOT, dir).split(path.sep).join("/"),
      cases: singles.length,
      scripts: scripts.length,
      engine: metrics.riskSource.harness > 0 ? (metrics.riskSource.derived > 0 ? "harness on some answers" : "harness") : `today's pipeline (no RiskSummary; ${tree})`,
      duration_ms: Date.now() - t0,
      llm: { main: llm.provider, model: llm.model, checker: checkerClient?.provider ?? null, checkerModel: checkerClient?.model ?? null, checkerReason: checker.reason },
      spend: mode === "mock" ? null : { runUsd: Math.round(spentRun * 1e6) / 1e6, byPurpose: calls },
      calls,
      pacing: pacer ? { rpm, waitedMs: paced.ms, http429: rate.count429 } : null,
      walk: env.walk,
      scoring: "web/eval/harness/README.md; worst-of-N: a case passes only if every run passes; recall counts a case caught only if every run caught it",
    },
    metrics,
    cases: singles.map((c, i) => ({ c, runs: caseRuns[i] })).map(({ c, runs }) => ({
      id: c.id,
      category: c.category,
      sub: c.sub,
      lang: c.lang,
      input: c.input,
      expected: c.expected,
      severityIfMissed: c.severityIfMissed,
      passedRuns: runs.filter((r) => r.score.pass).length,
      runs: runs.length,
      worst: worstSeverity(runs.map((r) => r.score.worst)),
      results: runs.map((r) => ({
        source: r.obs.source,
        level: r.obs.level,
        ladder: r.obs.ladder,
        rows: r.obs.rows,
        frameSource: r.obs.frameSource,
        followUp: r.obs.followUp ? `${r.obs.followUp.pathway}#${r.obs.followUp.step}/${r.obs.followUp.of}` : null,
        familyTold: r.obs.familyTold,
        watch: r.obs.watch,
        route: r.route,
        routeReason: r.obs.routeReason,
        templates: r.obs.templates,
        pass: r.score.pass,
        failures: r.score.failures.map(failureText),
        latencyMs: r.latencyMs,
        rateLimited: r.rateLimited ?? false,
        screenErrors: r.screenErrors ?? [],
        output: r.output,
        shown: r.shown,
        ...(r.turnsBefore.length ? { turnsBefore: r.turnsBefore } : {}),
        ...(r.walk ? { walk: r.walk } : {}),
        error: r.error,
      })),
    })),
    scripts: scripts.map((s, i) => ({ s, runs: scriptRuns[i] })).map(({ s, runs }) => ({
      id: s.id,
      sub: s.sub,
      lang: s.lang,
      severityIfMissed: s.severityIfMissed,
      expectedEnd: s.expectedEnd,
      passedRuns: runs.filter((r) => r.pass).length,
      endReachedRuns: runs.filter((r) => r.end.pass).length,
      runs: runs.length,
      worst: worstSeverity(runs.map((r) => r.worst)),
      results: runs.map((r) => ({
        pass: r.pass,
        end: r.end.failures.map(failureText),
        extra: r.extra.map(failureText),
        followUps: r.followUps,
        rateLimited: r.rateLimited ?? false,
        screenErrors: r.screenErrors ?? [],
        trail: r.trail,
        error: r.error,
      })),
    })),
  };

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n", "utf8");

  printSummary(metrics, calls, results.meta.spend?.runUsd ?? null, outFile);
  const screenErrors: Record<string, number> = {};
  for (const r of [...caseRuns.flat(), ...scriptRuns.flat()]) for (const e of r.screenErrors ?? []) screenErrors[e] = (screenErrors[e] ?? 0) + 1;
  if (Object.keys(screenErrors).length) console.log(`risk screen gave no frame (the rules' frame stood): ${JSON.stringify(screenErrors)}`);
  if (pacer) console.log(`pacing: ${rpm} calls a minute per model, waited ${Math.round(paced.ms / 1000)} s; the vendor answered 429 ${rate.count429} times`);
}

function printSummary(m: HarnessMetrics, calls: Record<string, { calls: number; errors: number }>, spendUsd: number | null, outFile: string) {
  console.log(`risk read from (case answers): ${m.riskSource.harness} harness, ${m.riskSource.derived} derived from the route (no RiskSummary)`);
  console.log(
    `rate limited by the vendor (429, left out of every metric): ${m.rateLimited.caseRuns} case runs, ${m.rateLimited.scriptRuns} script runs${m.rateLimited.unscored.length ? `; unscored: ${m.rateLimited.unscored.join(", ")}` : ""}`,
  );
  console.log(`cases pass ${pct(m.overall.cases)} | scripts pass ${pct(m.overall.scripts)}`);
  console.log(`crisis recall (level 1 / ladder >= thoughts) ${pct(m.crisisRecall)}`);
  console.log(`ladder recall (expected >= possible) ${pct(m.ladderRecall)}`);
  console.log(`false 995 (level 1 where it fails the case) ${pct(m.false995Rate)}`);
  console.log(`hard negatives: over-escalation ${pct(m.hardNegatives.overEscalation)} | ladder raised ${pct(m.hardNegatives.ladderRaised)} | 995 ${pct(m.hardNegatives.false995)}`);
  console.log(`follow-up completion (scripts ending as expected) ${pct(m.followUpCompletion)}`);
  console.log(`follow-ups: asked when expected ${pct(m.followUps.askedWhenExpected)} | mean questions per pathway case ${m.followUps.meanQuestionsPerPathwayCase} (calm walk) | per script ${m.followUps.perScript}`);
  console.log(`failures: S1 ${m.failuresBySeverity.S1.count}, S2 ${m.failuresBySeverity.S2.count}, S3 ${m.failuresBySeverity.S3.count}${m.flaky.length ? ` | flaky ${m.flaky.length}` : ""}`);
  if (m.failuresBySeverity.S1.ids.length) console.log(`  S1: ${m.failuresBySeverity.S1.ids.join(", ")}`);
  console.log("by language:");
  for (const [k, v] of Object.entries(m.byLanguage)) console.log(`  ${k.padEnd(9)} pass ${pct(v.pass)} | crisis ${pct(v.crisisRecall)} | ladder ${pct(v.ladderRecall)} | S1 ${v.S1}`);
  console.log("by category:");
  for (const [k, v] of Object.entries(m.byCategory)) console.log(`  ${k.padEnd(15)} pass ${pct(v.pass)} | crisis ${pct(v.crisisRecall)} | ladder ${pct(v.ladderRecall)} | S1 ${v.S1}`);
  console.log(`latency p50 ${m.latencyMs.p50} ms, p90 ${m.latencyMs.p90} ms, max ${m.latencyMs.max} ms`);
  console.log(`model calls: ${Object.entries(calls).map(([k, v]) => `${k} ${v.calls}${v.errors ? ` (${v.errors} failed)` : ""}`).join(", ") || "none"}`);
  if (spendUsd !== null) console.log(`spend this run: US$${spendUsd.toFixed(4)}`);
  console.log(`wrote ${outFile}`);
}

/** A results file's case and script, as written by main(). */
interface SavedResults {
  meta: Record<string, unknown> & { calls?: Record<string, { calls: number; errors: number }>; spend?: { runUsd: number } | null };
  cases: {
    id: string;
    results: {
      source: Observed["source"];
      level: Observed["level"];
      ladder: Observed["ladder"];
      rows: string[];
      frameSource: string;
      followUp: string | null;
      familyTold: boolean;
      watch: boolean | null;
      route: string;
      routeReason: string;
      templates: string[];
      latencyMs: number;
      output: string;
      shown?: string;
      walk?: { questions: number };
      rateLimited?: boolean;
    }[];
  }[];
  scripts: { id: string; results: { pass: boolean; end: string[]; extra: string[]; followUps: number; rateLimited?: boolean }[] }[];
}

const severityOf = (failure: string): Severity => failure.split(" ")[0] as Severity;

/**
 * --rescore <results.json>: score a saved run again with the corpus and the scoring as they are now (no model call, no
 * ask). Cases are scored again from what was kept of each answer (`shown`, both languages; a file from before `shown` was
 * kept has only `output`, the answer in his language, so a mustNotInclude pattern is then checked in that language
 * alone). Scripts keep the verdicts they had (their turns' lines were not kept).
 */
function rescore(file: string, outFile: string) {
  const saved = JSON.parse(readFileSync(file, "utf8")) as SavedResults;
  const corpus = loadCorpus(DEFAULT_DIR, "all");
  const scoredCases: ScoredCase[] = corpus.singles
    .filter((c) => saved.cases.some((x) => x.id === c.id))
    .map((c) => ({
      c,
      runs: saved.cases
        .find((x) => x.id === c.id)!
        .results.map((r) => {
          const [pathway, rest] = (r.followUp ?? "").split("#");
          const [step, of] = (rest ?? "").split("/");
          const obs: Observed = {
            source: r.source,
            level: r.level,
            ladder: r.ladder,
            rows: r.rows,
            frameSource: r.frameSource,
            followUp: r.followUp ? { pathway: pathway as PathwayId, step: Number(step), of: Number(of), templateId: "", optionIds: [] } : null,
            familyTold: r.familyTold,
            watch: r.watch,
            route: r.route,
            routeReason: r.routeReason,
            templates: r.templates,
          };
          const text = { sentences: r.shown ?? r.output, followUp: "", templates: r.templates };
          return { obs, score: scoreAnswer(c.expected, obs, text, c.severityIfMissed), latencyMs: r.latencyMs, rateLimited: r.rateLimited === true, ...(r.walk ? { walkQuestions: r.walk.questions } : {}) };
        }),
    }));
  const scoredScripts: ScoredScript[] = corpus.scripts
    .filter((s) => saved.scripts.some((x) => x.id === s.id))
    .map((s) => ({
      s,
      runs: saved.scripts
        .find((x) => x.id === s.id)!
        .results.map((r) => {
          const endWorst = worstSeverity(r.end.map(severityOf));
          return {
            turns: [],
            end: { pass: r.end.length === 0, failures: r.end.map((f) => ({ check: f, severity: severityOf(f) })), worst: endWorst },
            followUps: r.followUps,
            rateLimited: r.rateLimited === true,
            pass: r.pass,
            worst: r.pass ? null : (worstSeverity([endWorst, ...r.extra.map(severityOf)]) ?? s.severityIfMissed),
          };
        }),
    }));
  const metrics = harnessMetrics(scoredCases, scoredScripts);
  const out = {
    meta: { ...saved.meta, rescored_at: new Date().toISOString(), rescored_from: file, rescored_with: gitSha() },
    metrics,
    cases: scoredCases.map(({ c, runs }) => ({
      id: c.id,
      category: c.category,
      sub: c.sub,
      lang: c.lang,
      input: c.input,
      expected: c.expected,
      passedRuns: runs.filter((r) => r.score.pass).length,
      runs: runs.length,
      worst: worstSeverity(runs.map((r) => r.score.worst)),
      results: runs.map((r) => ({ level: r.obs.level, ladder: r.obs.ladder, followUp: r.obs.followUp?.pathway ?? null, templates: r.obs.templates, failures: r.score.failures.map(failureText) })),
    })),
    scripts: saved.scripts,
  };
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`re-scored ${file} (${scoredCases.length} cases, ${scoredScripts.length} scripts as they were)`);
  printSummary(metrics, saved.meta.calls ?? {}, saved.meta.spend?.runUsd ?? null, outFile);
}

// run only as a script, not when a test imports it
if (/[\\/]scripts[\\/]eval-harness\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export type { Expected };
