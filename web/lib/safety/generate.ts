/**
 * Step 3 of /api/ask (spec section 5): structured generation. The model gets the input and the candidate
 * sources and may only answer with Sentence[] as JSON; every sourceId must come from the candidates. Fields the
 * pipeline owns (zh, origin, templateId, cite) are dropped from model output: Mandarin comes from patient_text
 * or a template, never from the model.
 *
 * The prompt carries the same topic-to-source table the offline composer uses (protocol.ts TOPIC_SOURCES), and the
 * composer's source policy is applied to every model's answer in code (applySourcePolicy), so a live model picks
 * from the same sources by the same rules. Nothing here decides whether a sentence is safe: the three checks do.
 */
import { z } from "zod";
import { TOPIC_SOURCES, type ComposeCandidate, type ComposePayload } from "@/lib/llm/protocol";
import { parseModelJson } from "@/lib/llm/json";
import { LlmError, type LlmClient } from "@/lib/llm/types";
import type { Candidate, Locale, Route, Sentence } from "./types";

export const SYSTEM_COMPOSE = [
  "You write the answer card of a medication-companion app for an older patient in Singapore.",
  "You never give clinical advice of your own. You may only restate the candidate sources you are given.",
  "Rules:",
  "1. Output JSON only: {\"sentences\": [{\"speechAct\", \"sourceId\", \"span\", \"slots\", \"en\", \"attribution\"}]}.",
  "2. sourceId must be one of the candidates' sourceId values. span must be copied exactly from that candidate's span.",
  "3. en is the candidate's restatement.en copied exactly when it has one; otherwise one or more whole sentences copied exactly from its span. Never reword, shorten, merge or translate.",
  "4. Do not add numbers, doses, times, medicine names or judgements (normal, high, dangerous) that the span does not contain.",
  "5. Never compare a reading with a number the doctor did not say. Never say whether two medicines can be taken together.",
  "6. attribution is who said it: label, doctor, dispenser, pharmacist or leaflet (copy it from the candidate).",
  "7. speechAct is restate for quoted or restated content, logistics for appointments and app matters.",
  "8. Use only the candidates that answer the input's topics, for the medicines in drugs. Return an empty list when none do.",
  "9. Write English only; the app adds Mandarin itself.",
  "10. slots lists only values written in the span itself (a medicine name only if the span names it); use {} when the span has none.",
  `11. Which candidate topics answer which input topic: ${Object.entries(TOPIC_SOURCES)
    .map(([topic, sources]) => `${topic} -> ${sources.join(" + ")}`)
    .join("; ")}. Within a topic, use the candidates in that order.`,
  "12. A medicine's label candidate is the authority on how to take it: when the input is about food, timing, a missed dose or the dose, include that medicine's label candidate if there is one.",
  "13. When a patient_text candidate answers a topic, do not also quote a dispenser's or pharmacist's line on that topic (except for route uncertain, where each source that disagrees gets its own sentence). The doctor's words always stay.",
].join("\n");

const sentenceSchema = z.object({
  speechAct: z.enum(["restate", "question", "referral", "logistics"]).catch("restate"),
  sourceId: z.string().catch(""),
  span: z.string().catch(""),
  slots: z
    .object({
      drug: z.string().optional(),
      quantity: z.string().optional(),
      unit: z.string().optional(),
      frequency: z.string().optional(),
      time: z.string().optional(),
      numbers: z.array(z.coerce.string()).optional(),
    })
    .catch({}),
  en: z.string(),
  attribution: z.enum(["label", "doctor", "dispenser", "pharmacist", "leaflet"]).optional().catch(undefined),
});

export interface GenerateInput {
  route: Route;
  locale: Locale;
  input: string;
  topics: string[];
  drugs: string[];
  candidates: Candidate[];
  maxSentences?: number;
  /** ask()'s deadline for generation: past it the call stops and the answer is a generation failure */
  signal?: AbortSignal;
}

/**
 * A model item that was not even a sentence, recorded without the model's words (fix round 2: the reply text used to
 * be kept as `raw` and reached safety_event.output.rejected and /api/ask): why, how long it was, and the source it
 * named when that is one of this answer's candidates.
 */
export interface RejectedItem {
  reason: "not_json" | "no_sentences_array" | "invalid_sentence" | "source_policy";
  /** characters of the reply (not_json, no_sentences_array) or of the item's JSON (invalid_sentence) */
  length?: number;
  /** the candidate the item cited, only when it is one of the candidates given to the model */
  sourceId?: string;
}

export interface GenerateOutput {
  sentences: Sentence[];
  /** model items that were not even a sentence (bad JSON shape); never the model's text */
  rejected: RejectedItem[];
  tokens: number;
  error?: string;
}

/**
 * A generator error as a code: the LlmError code; a short identifier an error carries as `code` (deadline, timeout);
 * "deadline" for an abort or timeout of the caller's signal; else "error". Never the message, which can echo text.
 */
function errorCode(e: unknown): string {
  if (e instanceof LlmError) return e.code;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

/** The candidate id an item names, when it is one of this answer's candidates (never free text). */
function knownSourceId(item: unknown, candidates: Candidate[]): string | undefined {
  const id = item && typeof item === "object" ? (item as { sourceId?: unknown }).sourceId : undefined;
  return typeof id === "string" && candidates.some((c) => c.sourceId === id) ? id : undefined;
}

/** Candidates as the model sees them (no citations, no internal fields). Template rows are left out. */
export function toComposeCandidates(candidates: Candidate[]): ComposeCandidate[] {
  return candidates
    .filter((c) => !c.topics?.includes("template") && !c.topics?.includes("referral"))
    .map((c) => ({
      sourceId: c.sourceId,
      kind: c.kind,
      span: c.span,
      attribution: c.attribution,
      drugs: c.drugs,
      topics: c.topics,
      restatement: c.restatement ? { en: c.restatement.en, zh: c.restatement.zh } : undefined,
    }));
}

export function composePayload(input: GenerateInput): ComposePayload {
  return {
    task: "compose",
    route: input.route,
    locale: input.locale,
    input: input.input,
    topics: input.topics,
    drugs: input.drugs,
    candidates: toComposeCandidates(input.candidates),
    maxSentences: input.maxSentences ?? 4,
  };
}

/**
 * The composer's source policy (mock.ts composeDeterministic), applied to every model's answer: when a reviewed
 * leaflet restatement (patient_text) answers a topic, the counter's or a pharmacist's spoken lines on that topic
 * are left to the visit review screens; the doctor's words stay. Not for "uncertain", where every source that
 * disagrees is shown with its own tag. Only ever removes sentences.
 */
export function applySourcePolicy(sentences: Sentence[], candidates: Candidate[], route: Route): { kept: Sentence[]; dropped: Sentence[] } {
  if (route === "uncertain") return { kept: sentences, dropped: [] };
  const byId = new Map(candidates.map((c) => [c.sourceId, c]));
  const leafletTopics = new Set(
    sentences.flatMap((s) => {
      const c = byId.get(s.sourceId);
      return c?.kind === "patient_text" ? (c.topics ?? []) : [];
    }),
  );
  const kept: Sentence[] = [];
  const dropped: Sentence[] = [];
  for (const s of sentences) {
    const c = byId.get(s.sourceId);
    const spokenNotDoctor = c?.kind === "visit" && !!c.attribution && c.attribution !== "doctor";
    if (spokenNotDoctor && (c!.topics ?? []).some((t) => leafletTopics.has(t))) dropped.push(s);
    else kept.push(s);
  }
  return { kept, dropped };
}

export async function generateSentences(llm: LlmClient, input: GenerateInput): Promise<GenerateOutput> {
  const payload = composePayload(input);
  let content: string;
  let tokens = 0;
  try {
    const res = await llm.chat({ system: SYSTEM_COMPOSE, user: JSON.stringify(payload), json: true, temperature: 0, maxTokens: 900, purpose: "compose", signal: input.signal });
    content = res.content;
    tokens = res.tokens;
  } catch (e) {
    // a code only, never the message (fix round 2: no model or vendor words in records)
    return { sentences: [], rejected: [], tokens, error: `generation_failed: ${errorCode(e)}` };
  }
  let raw: unknown;
  try {
    raw = parseModelJson(content);
  } catch {
    return { sentences: [], rejected: [{ reason: "not_json", length: content.length }], tokens, error: "bad_json" };
  }
  const items = Array.isArray(raw) ? raw : (raw as { sentences?: unknown })?.sentences;
  if (!Array.isArray(items)) return { sentences: [], rejected: [{ reason: "no_sentences_array", length: content.length }], tokens, error: "bad_shape" };
  const sentences: Sentence[] = [];
  const rejected: GenerateOutput["rejected"] = [];
  for (const item of items.slice(0, (input.maxSentences ?? 4) + 4)) {
    const parsed = sentenceSchema.safeParse(item);
    if (!parsed.success) {
      const sourceId = knownSourceId(item, input.candidates);
      rejected.push({ reason: "invalid_sentence", length: JSON.stringify(item ?? null).length, ...(sourceId ? { sourceId } : {}) });
      continue;
    }
    const s = parsed.data;
    sentences.push({ speechAct: s.speechAct, sourceId: s.sourceId, span: s.span, slots: s.slots, en: s.en, attribution: s.attribution });
  }
  const { kept, dropped } = applySourcePolicy(sentences, input.candidates, input.route);
  for (const d of dropped) rejected.push({ reason: "source_policy", ...(knownSourceId(d, input.candidates) ? { sourceId: d.sourceId } : {}) });
  return { sentences: kept, rejected, tokens };
}
