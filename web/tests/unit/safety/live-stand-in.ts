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
 *
 * The harness (2026-10-16): the single-message crisis screen (task "crisis") is replaced by the risk screen (task
 * "risk_screen", lib/safety/risk/screen.ts), which answers with a Frame. A test that scripts `crisis` the old way still means
 * what it meant: the stand-in answers the risk screen with the frame of that word (frameReply: "self_harm" a wish to die,
 * "emergency" chest pain now for ten minutes, "none" nothing), quoting his message as its evidence, and an error or "hang"
 * scripted for `crisis` is what the risk screen gets.
 */
import type { ComposePayload } from "@/lib/llm/protocol";
import { LlmError, type ChatOpts, type ChatResult, type LlmClient } from "@/lib/llm/types";
import RECORDED from "./recorded-replies.json";

type Task = "classify" | "crisis" | "risk_screen" | "compose" | "support" | "general" | "crisis_words";

/** A risk-screen reply (risk/screen.ts FRAME_REPLY) for one of the old crisis screen's words, quoting his whole message. */
export function frameReply(kind: string, message: string): string {
  const ev = [{ quote: message, from: "message" }];
  const crisis = /"crisis"\s*:\s*"(\w+)"/.exec(kind)?.[1] ?? kind;
  const frame = {
    about: "self",
    acts: ["question"],
    medicines: [],
    amount: { relation: "none", evidence: [] },
    when: "unclear",
    symptoms: crisis === "emergency" ? [{ kind: "chest", now: "yes", minutes: 10, severe: "yes", sudden: "unclear", evidence: ev }] : [],
    looksDifferent: "no",
    stopOrChange: "none",
    selfHarm:
      crisis === "self_harm"
        ? { ideation: "active", plan: "unclear", means: "unclear", soon: "unclear", lethalityQuestion: "no", evidence: ev }
        : { ideation: "none", plan: "no", means: "no", soon: "no", lethalityQuestion: "no", evidence: [] },
    distress: crisis === "self_harm" ? "yes" : "no",
  };
  // an answer that is not one of the three words is not a frame either (the old "invalid answer")
  return ["none", "self_harm", "emergency"].includes(crisis) ? JSON.stringify(frame) : '{"crisis":"maybe"}';
}

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
  /** the old crisis screen's word: the risk screen answers with its frame (frameReply) */
  crisis?: Answer;
  /** the risk screen's own reply (a Frame as JSON), when a test scripts it directly */
  risk_screen?: Answer;
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
      let scripted = script[task];
      if (task === "risk_screen" && scripted === undefined && script.crisis !== undefined) {
        const word = script.crisis;
        const message = String(payload.message ?? "");
        scripted = typeof word === "string" && word !== "hang" ? frameReply(word, message) : typeof word === "function" ? (o, p) => {
          const a = word(o, p);
          return typeof a === "string" && a !== "hang" ? frameReply(a, message) : a;
        } : word;
      }
      const answer = typeof scripted === "function" ? scripted(opts, payload) : scripted;
      const ms = script.ms?.[task] ?? (task === "risk_screen" ? script.ms?.crisis : undefined) ?? 0;
      if (answer === "hang") await wait(Number.POSITIVE_INFINITY, opts.signal);
      else await wait(ms, opts.signal);
      if (answer instanceof Error) throw answer;
      const fallback = task === "crisis" ? '{"crisis":"none","reason":"ordinary question"}' : task === "risk_screen" ? frameReply("none", String(payload.message ?? "")) : task === "classify" ? '{"route":"uncertain","topic":"other","reason":"unclear"}' : task === "support" ? '{"supported":false,"reason":"not stated"}' : '{"sentences":[]}';
      return { content: typeof answer === "string" ? answer : fallback, tokens: 40, provider: "hunyuan", model: "hy3", usd: 0.0002 };
    },
  };
}
