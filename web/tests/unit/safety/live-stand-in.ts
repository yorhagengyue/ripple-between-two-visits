/**
 * A stand-in for the live model in unit tests (fix round of 10-11): a client that is NOT the offline mock (its provider
 * is "hunyuan", the main model since 10-16, so the pipeline takes every live-model path: the crisis screen, the model's
 * classification, the spend wrapper) and answers each task in the shape of the app's protocol, without a network.
 *
 * Two compose replies of a real model are kept as samples (./recorded-replies.json): recorded on 10-09 from the main model
 * of that day (DeepSeek, retired on 10-16; its cassettes went with it), for the hero question and "What is amlodipine
 * for?". `recorded()` returns one as it was. They show the reply shape a real model writes; they are not Hunyuan's
 * replies, and nothing here measures Hunyuan's times (not recorded yet). Where nothing was recorded (the classification
 * of a question no rule knows), the test says what the model answers, in the reply's real shape: {"route", "topic",
 * "reason"}.
 */
import type { ComposePayload } from "@/lib/llm/protocol";
import { LlmError, type ChatOpts, type ChatResult, type LlmClient } from "@/lib/llm/types";
import RECORDED from "./recorded-replies.json";

type Task = "classify" | "crisis" | "compose" | "support" | "general" | "crisis_words";

/** The real model's reply recorded for this task and these words, as it was; throws when none was recorded. */
export function recorded(task: Task, input: string): string {
  const hit = task === "compose" ? (RECORDED.compose as Record<string, string>)[input] : undefined;
  if (!hit) throw new Error(`no recorded ${task} reply for "${input}"`);
  return hit;
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

export const deadline = () => new LlmError("deadline", "hunyuan: stopped at the caller's deadline", 504);

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
    provider: "hunyuan",
    model: "hy3",
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
      return { content: typeof answer === "string" ? answer : fallback, tokens: 40, provider: "hunyuan", model: "hy3", usd: 0.0002 };
    },
  };
}
