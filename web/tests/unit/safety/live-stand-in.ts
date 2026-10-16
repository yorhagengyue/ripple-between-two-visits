/**
 * A stand-in for the live model in unit tests (fix round of 10-11): a client that is NOT the offline mock (its provider
 * is "deepseek", so the pipeline takes every live-model path: the crisis screen, the model's classification, the spend
 * wrapper) and answers each task in the shape the real deepseek-flash answers, without a network.
 *
 * Where a recorded answer exists it is used as recorded: fixtures/cassettes holds real deepseek-flash replies (10-09).
 * A cassette is keyed by the whole prompt. The eval's own setup still produces those prompts (the replay eval hits every
 * cassette), and so does the hero question on a fresh demo copy; an account's prompts carry its real dates and most other
 * demo asks have a longer candidate list than on 10-09, so replaying by key misses there (measured 10-11: 7 of 8 asks).
 * `recorded()` finds the cassette by the task and the patient's words instead and returns the model's reply as it was.
 * Where nothing was recorded (the classification of a question no rule knows: one cassette in all), the test says what
 * the model answers, in the reply's real shape: {"route", "topic", "reason"}.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ComposePayload } from "@/lib/llm/protocol";
import { cassetteDir, type Cassette } from "@/lib/llm/replay";
import { LlmError, type ChatOpts, type ChatResult, type LlmClient } from "@/lib/llm/types";

type Task = "classify" | "crisis" | "compose" | "support" | "general" | "crisis_words";

let cassettes: { task: string; input: string; reply: string; latencyMs: number | null }[] | null = null;

function load(): NonNullable<typeof cassettes> {
  if (cassettes) return cassettes;
  cassettes = [];
  const dir = cassetteDir({});
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Cassette;
    if (c.request.provider !== "deepseek") continue;
    try {
      const p = JSON.parse(c.request.user) as { task?: string; input?: string };
      if (p.task && typeof p.input === "string") cassettes.push({ task: p.task, input: p.input, reply: c.response.content, latencyMs: c.response.latency_ms ?? null });
    } catch {
      // not a task payload (a label photo prompt)
    }
  }
  return cassettes;
}

/** The real deepseek-flash reply recorded for this task and these words, as it was; throws when none was recorded. */
export function recorded(task: Task, input: string): string {
  const hit = load().find((c) => c.task === task && c.input === input);
  if (!hit) throw new Error(`no recorded ${task} reply for "${input}"`);
  return hit.reply;
}

/** The latencies of the recorded compose calls, in ms (what a real compose takes). */
export function recordedComposeLatencies(): number[] {
  return load().flatMap((c) => (c.task === "compose" && c.latencyMs ? [c.latencyMs] : [])).sort((a, b) => a - b);
}

/** A compose reply in the real shape, citing the given candidates of the prompt word for word (the model "picked" them). */
export function composeReply(payload: ComposePayload, sourceIds: string[]): string {
  const sentences = sourceIds.flatMap((id) => {
    const c = payload.candidates.find((x) => x.sourceId === id);
    return c ? [{ speechAct: "restate", sourceId: c.sourceId, span: c.span, slots: {}, en: c.restatement ? c.restatement.en : c.span, attribution: c.attribution }] : [];
  });
  return JSON.stringify({ sentences });
}

/** What the stand-in does for one task: a reply (or a function of the prompt), an error to throw, or "hang" until the deadline. */
type Answer = string | Error | "hang" | ((opts: ChatOpts, payload: Record<string, unknown>) => string | Error | "hang");

export interface StandIn {
  classify?: Answer;
  crisis?: Answer;
  compose?: Answer;
  support?: Answer;
  /**
   * owner 10-15: Ripple's own answer (general.ts) and the 995 wording (crisis-words.ts). Unscripted, the stand-in replies
   * with nothing usable for them, so the answer is what it was before (the fallback those modules keep)
   */
  general?: Answer;
  crisis_words?: Answer;
  /** how long each call takes before it answers (ms); a call stops with "deadline" when its signal aborts first */
  ms?: Partial<Record<Task, number>>;
  calls?: { task: Task; opts: ChatOpts; startedAt: number }[];
}

export const deadline = () => new LlmError("deadline", "deepseek: stopped at the caller's deadline", 504);

/** The stand-in client. Unscripted tasks answer as the real model usually does: no crisis, nothing to compose. */
export function liveStandIn(script: StandIn = {}): LlmClient {
  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(deadline());
      const t = Number.isFinite(ms) ? setTimeout(resolve, ms) : null;
      signal?.addEventListener("abort", () => {
        if (t) clearTimeout(t);
        reject(deadline());
      });
    });
  return {
    provider: "deepseek",
    model: "deepseek-flash",
    async chat(opts): Promise<ChatResult> {
      const payload = JSON.parse(opts.user) as Record<string, unknown> & { task: Task };
      const task = payload.task;
      script.calls?.push({ task, opts, startedAt: performance.now() });
      const scripted = script[task];
      const answer = typeof scripted === "function" ? scripted(opts, payload) : scripted;
      if (answer === "hang") await wait(Number.POSITIVE_INFINITY, opts.signal);
      else await wait(script.ms?.[task] ?? 0, opts.signal);
      if (answer instanceof Error) throw answer;
      const fallback = task === "crisis" ? '{"crisis":"none","reason":"ordinary question"}' : task === "classify" ? '{"route":"uncertain","topic":"other","reason":"unclear"}' : task === "support" ? '{"supported":false,"reason":"not stated"}' : '{"sentences":[]}';
      return { content: typeof answer === "string" ? answer : fallback, tokens: 40, provider: "deepseek", model: "deepseek-flash", usd: 0.0002 };
    },
  };
}
