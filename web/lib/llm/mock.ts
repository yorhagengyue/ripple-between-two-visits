/**
 * Deterministic offline "model" (LLM_PROVIDER=mock, alias stub; the default when no key is set). It never calls
 * a network and never writes clinical text of its own:
 *
 * - compose: picks candidates whose topics answer the input's topics (TOPIC_SOURCES) and whose drugs match,
 *   and returns each one word for word: a patient_text restatement as written, any other source as its span.
 *   So everything it says comes from label fields, required doctor lines and other confirmed visit lines,
 *   patient_text.json, referrals.json or his own records.
 * - classify: "uncertain" (the rule classifier is the real classifier offline).
 * - crisis: "none" (the crisis rules are the only crisis screen offline).
 * - support (layer 3 checker): never confirms a paraphrase.
 * - explain (a long press on one of his records, lib/explain/verdict.ts): no sentence of its own and abstain: true, so
 *   the sheet shows the sentence built from his records (verdict.ts does not even ask the mock; this is for a caller
 *   that does).
 * - gloss (Ripple's words under an answer's quotes, lib/safety/gloss.ts): no sentence, so an answer is what it always was
 *   (gloss.ts does not ask the mock either).
 * - summary (Ripple's notes of a visit, lib/visit/ripple-summary.ts): no point, so the recording screen shows the
 *   captions alone and the review the doctor's lines alone (ripple-summary.ts does not ask the mock either).
 * - general (Ripple's own answer, lib/safety/general.ts; owner 10-15): one canned general answer (MOCK_GENERAL), marked as
 *   an offline example, so the offline app shows where that answer goes. It names no medicine and no dose.
 * - crisis_words (the 995 and self-harm answers in a person's words): an empty answer, so the fixed sentences stand
 *   (crisis-words.ts does not ask the mock either).
 *
 * Test hook: setMockInjection(fn) (or the `inject` option) appends sentences to every compose answer, so a test
 * can slip in an unsupported instruction ("You can take an extra tablet ...") and watch the checks block it.
 * setMockGeneral(answer) makes the general task answer with other words (a test of what happens when the guard drops
 * Ripple's own answer after it was streamed); null puts MOCK_GENERAL back.
 *
 * Streaming (ChatOpts.onDelta, owner 10-15): the reply's content goes out in small pieces (MOCK_STREAM_CHARS characters,
 * default 4) a short wait apart (MOCK_STREAM_DELAY_MS, default 30 ms), as a model's would, then the call resolves with
 * the whole content. Only when onDelta is given: every other call still answers at once.
 */
import { DRUG_FREE_TOPICS, TOPIC_SOURCES, type ComposedSentence, type ComposePayload, type TaskPayload } from "./protocol";
import type { ChatOpts, ChatResult, LlmClient } from "./types";

export type MockInjection = (payload: ComposePayload) => ComposedSentence[];

type GlobalWithHook = typeof globalThis & { __rippleMockInjection?: MockInjection | null; __rippleMockGeneral?: { answer: string; ask: string } | null };

/** Global injection hook for tests that go through getLlm() (route handlers). Pass null to clear. */
export function setMockInjection(fn: MockInjection | null): void {
  (globalThis as GlobalWithHook).__rippleMockInjection = fn;
}

function globalInjection(): MockInjection | null {
  return (globalThis as GlobalWithHook).__rippleMockInjection ?? null;
}

/** Test hook: the general task's answer (both languages) until cleared with null (see the header). */
export function setMockGeneral(answer: { answer: string; ask: string } | null): void {
  (globalThis as GlobalWithHook).__rippleMockGeneral = answer;
}

const positiveEnv = (name: string, fallback: number): number => {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The content in small pieces, a short wait apart (ChatOpts.onDelta; see the header). */
async function streamOut(content: string, onDelta: (text: string) => void): Promise<void> {
  const size = Math.max(1, Math.floor(positiveEnv("MOCK_STREAM_CHARS", 4)) || 1);
  const delay = positiveEnv("MOCK_STREAM_DELAY_MS", 30);
  const chars = [...content];
  for (let i = 0; i < chars.length; i += size) {
    if (i > 0 && delay > 0) await new Promise((r) => setTimeout(r, delay));
    onDelta(chars.slice(i, i + size).join(""));
  }
}

/** The deterministic composer. Exported for tests. */
export function composeDeterministic(payload: ComposePayload): ComposedSentence[] {
  const out: ComposedSentence[] = [];
  const used = new Set<string>();
  const wantedDrugs = new Set(payload.drugs);
  for (const topic of payload.topics) {
    const sourceTopics = TOPIC_SOURCES[topic];
    if (!sourceTopics) continue;
    let picks = payload.candidates.filter((c) => (c.topics ?? []).some((t) => sourceTopics.includes(t)));
    if (!DRUG_FREE_TOPICS.has(topic)) {
      picks = picks.filter((c) => !c.drugs?.length || c.drugs.some((d) => wantedDrugs.has(d)));
    }
    // the doctor's words come first; when a leaflet restatement answers the topic, the counter's or a
    // pharmacist's spoken lines on the same topic are left to the visit review screens
    if (picks.some((c) => c.kind === "patient_text")) {
      picks = picks.filter((c) => c.kind !== "visit" || c.attribution === "doctor");
    }
    // within a topic, sources in TOPIC_SOURCES order (his readings before the doctor's target, for example)
    const rank = (c: (typeof picks)[number]) => Math.min(...(c.topics ?? []).map((t) => sourceTopics.indexOf(t)).filter((i) => i >= 0));
    picks = picks.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
    if (topic === "appointment" && picks.length > 1) picks = picks.slice(-1); // the most recent visit's line
    for (const c of picks) {
      if (used.has(c.sourceId) || out.length >= payload.maxSentences) continue;
      used.add(c.sourceId);
      out.push({
        speechAct: "restate",
        sourceId: c.sourceId,
        span: c.span,
        slots: {},
        en: c.restatement ? c.restatement.en : c.span,
        attribution: c.attribution,
      });
    }
  }
  return out;
}

export interface MockOptions {
  inject?: MockInjection | null;
}

/** The offline stand-in for Ripple's own answer (lib/safety/general.ts): general words, no medicine, no dose. */
export const MOCK_GENERAL = {
  zh: { answer: "（离线示例回答）一般来说，先多休息、多喝水，饮食清淡一些，留意身体有没有变化。如果几天都没有好转，或者越来越不舒服，就去看医生。", ask: "doctor" },
  en: {
    answer: "(Offline example answer) In general, rest, drink enough water, keep meals light and notice how you feel. If it does not get better in a few days, or you feel worse, see your doctor.",
    ask: "doctor",
  },
} as const;

export function createMockLlm(opts: MockOptions = {}): LlmClient {
  return {
    provider: "mock",
    model: "deterministic-composer",
    async chat(chat: ChatOpts): Promise<ChatResult> {
      let payload: TaskPayload | null = null;
      try {
        payload = JSON.parse(chat.user) as TaskPayload;
      } catch {
        payload = null;
      }
      let body: unknown = {};
      if (payload?.task === "compose") {
        const sentences = composeDeterministic(payload);
        const inject = opts.inject ?? globalInjection();
        if (inject) sentences.push(...inject(payload));
        body = { sentences };
      } else if (payload?.task === "classify") {
        body = { route: "uncertain", topic: "other", reason: "mock model: no rule matched" };
      } else if (payload?.task === "crisis") {
        body = { crisis: "none", reason: "mock model: the crisis rules decide offline" };
      } else if (payload?.task === "support") {
        body = { supported: false, reason: "mock checker never confirms a paraphrase" };
      } else if (payload?.task === "explain") {
        body = { verdict: "", abstain: true };
      } else if (payload?.task === "gloss") {
        body = { sentences: [] };
      } else if (payload?.task === "summary") {
        body = { points: [] };
      } else if (payload?.task === "general") {
        // (owner 10-15) a plausible canned answer, so the offline app shows where Ripple's own answer goes; the same words
        // whatever was asked, never about a medicine or a dose
        body = (globalThis as GlobalWithHook).__rippleMockGeneral ?? (payload.locale === "zh-Hans" ? MOCK_GENERAL.zh : MOCK_GENERAL.en);
      } else if (payload?.task === "crisis_words") {
        // never asked (lib/safety/crisis-words.ts keeps the fixed sentences offline); an empty answer keeps them too
        body = { answer: "" };
      }
      const content = JSON.stringify(body);
      if (chat.onDelta) await streamOut(content, chat.onDelta);
      return { content, tokens: 0, provider: "mock", model: "deterministic-composer", attempts: 0, latencyMs: 0, ...(chat.onDelta ? { streamed: true } : {}) };
    },
  };
}

/** A mock checker whose verdict a test decides (layer 3 "supported" path); it is given the whole source text. */
export function createDecidingChecker(decide: (source: string, sentence: string, fragment?: string) => boolean, name = "mock-checker"): LlmClient {
  return {
    provider: name,
    model: "test",
    async chat(chat: ChatOpts): Promise<ChatResult> {
      const p = JSON.parse(chat.user) as TaskPayload;
      const supported = p.task === "support" ? decide(p.source, p.sentence, p.fragment) : false;
      return { content: JSON.stringify({ supported, reason: supported ? "test: supported" : "test: not supported" }), tokens: 0 };
    },
  };
}
