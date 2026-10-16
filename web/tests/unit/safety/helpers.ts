import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockLlm } from "@/lib/llm";
import type { MockInjection } from "@/lib/llm/mock";
import type { LlmClient } from "@/lib/llm/types";
import type { BusEventType } from "@/lib/bus";
import { caseLocale, parseSeedJsonl, type EvalCase } from "@/lib/safety/eval";
import { ask, type AskInput } from "@/lib/safety/pipeline";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";

export const SEED_CASES: EvalCase[] = parseSeedJsonl(readFileSync(fileURLToPath(new URL("../../../eval/seed.jsonl", import.meta.url)), "utf8"));

export function seedCase(id: string): EvalCase {
  const c = SEED_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no seed case ${id}`);
  return c;
}

export interface Published {
  type: BusEventType;
  say: string;
  data: unknown;
}

export interface Run {
  result: AskResult;
  sessionId: string;
  questionsBefore: number;
  questionsAfter: number;
  events: Published[];
}

export async function runAsk(
  input: Omit<AskInput, "sessionId"> & { day?: number },
  opts: { inject?: MockInjection; checker?: LlmClient | null; llm?: LlmClient } = {},
): Promise<Run> {
  const store = getMemoryStore();
  const session = await store.createSession({ story_day: input.day ?? 29, ttl_hours: 1 });
  const questionsBefore = (await store.listQuestions(session.id)).length;
  const events: Published[] = [];
  const result = await ask(
    { ...input, sessionId: session.id },
    {
      store,
      llm: opts.llm ?? createMockLlm({ inject: opts.inject ?? null }),
      checker: opts.checker ?? null,
      checkerReason: opts.checker ? null : "no checker in unit tests",
      publish: (_sid, type, say, data) => events.push({ type, say, data }),
      costGuard: null,
    },
  );
  const questionsAfter = (await store.listQuestions(session.id)).length;
  return { result, sessionId: session.id, questionsBefore, questionsAfter, events };
}

/** Run a seed.jsonl case the way the eval does (minus the transcript preload). */
export function runSeedCase(id: string, opts: { inject?: MockInjection } = {}): Promise<Run> {
  const c = seedCase(id);
  return runAsk(
    {
      text: c.input,
      day: c.context.day,
      locale: caseLocale(c),
      role: c.context.role,
      noDoctorTarget: c.context.no_doctor_target,
      asrLowConfidence: c.context.asr_low_confidence,
    },
    opts,
  );
}
