/**
 * The sentence at the top of the sheet (owner's decision of 10-14, modelled on his iOS app's server: ripple-core
 * src/lib/explain.ts gathers the evidence in code, ONE model call writes the short verdict from it, and guards drop a
 * verdict that says what it must not). Server-only.
 *
 * The evidence is lib/explain/evidence.ts's: the lines under 「Ripple 查看了什么」 and the quoted sources. The model sees
 * those and nothing else (never his other records, never the screen), and answers { verdict, abstain } in the request's
 * language. Its sentence is shown only when every guard below lets it through; otherwise, and whenever no model may or
 * can write one, the sheet shows the sentence evidence.ts built from the same facts, and the answer says why
 * (HoldRead.verdictBy "records", verdictWhy):
 *
 *   fixed            this thing never gets a model's words (a reading above the doctor's warning line, the warning line
 *                    itself, a medicine nobody identified, a question still waiting for the doctor)
 *   no_consent       he has not agreed to AI processing (lib/safety/consent.ts): no model sees anything
 *   spend_cap        his day's model spend is used up (real-app 3.5; lib/llm/person-spend.ts)
 *   no_model         no model is configured (the offline mock)
 *   model_failed     no answer within 8 seconds, an error, or an answer that is not the JSON asked for
 *   model_abstained  the model said the facts do not say
 *   guard            the model's sentence was dropped (the reasons go to the server log as codes, never its words)
 *
 * The line it must hold (the challenge's own): explain in plain words and show where each thing comes from; never what
 * to take, how much, to change, skip or stop; never an illness; never that he is fine or in danger. Comparing a reading
 * with the doctor's own number is allowed: it is the doctor's number, and it has to be in the evidence.
 *
 * A family member's long press (owner's decision of 10-14): the same call, the same gates and the same guards. The gates
 * are HIS: his consent to AI processing and his day's spend (the route reads both for his scope). The evidence is the
 * one cut by his switches for her link (evidence.ts), so the model sees nothing she may not. She is the reader and he
 * is the subject: SYSTEM_EXPLAIN_FAMILY says so, the payload carries how she calls him, and one more guard drops a
 * sentence that speaks to her as if she were him (second_person) or points at an illness of his in the third person.
 */
import { elderWords } from "@/lib/care/copy";
import { createMainLlm } from "@/lib/llm";
import { parseModelJson } from "@/lib/llm/json";
import type { ExplainAnswer, ExplainPayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { isDirective } from "@/lib/safety/directive";
import { createFieldReader } from "@/lib/sse/json-field";
import { modelWordingHits } from "@/lib/safety/judgement";
import { hasHan } from "@/lib/safety/text";
import type { Sentence } from "@/lib/safety/types";
import { sourceBy } from "./copy";
import type { Evidence } from "./evidence";
import type { HoldLocale, VerdictWhy, WordsViewer } from "./subjects";

/** The whole call, waiting for a slot and every attempt included. */
export const EXPLAIN_TIMEOUT_MS = 8000;

export const SYSTEM_EXPLAIN = [
  "You write for an elderly patient about ONE thing from his own records: the thing he pressed and held on his phone.",
  "You are given its name, FACTS built from his records, and SOURCES (his doctor's own words, his medicine label, an official leaflet).",
  "Rules:",
  "1. At most two short sentences, in plain and professional words (zh-Hans: 已服药 / 未服药 / 就诊 / 测量血压, never 吃了 / 没吃 / 看诊), in the language `locale` names (zh-Hans: Simplified Chinese; en: English).",
  "2. Use only the facts and sources given. Add no number, date, name or fact that is not in them.",
  "3. You may say what a medicine is for when a given source says it.",
  "4. You may say how a reading stands against the doctor's own number that is given (below it, or not below it). Compare with no other number.",
  "5. Never tell him to take, skip, add, change, stop or re-time any medicine or dose. Never say what dose is right.",
  "6. Never name or suggest an illness.",
  "7. Never say he is fine or in danger, and never call a reading good, bad, normal, high or low.",
  "8. If the facts do not say, say that his records do not say and that he can ask his doctor or pharmacist, and set abstain to true.",
  '9. Output JSON only: {"verdict": string, "abstain": boolean}.',
].join("\n");

/** The same task when a family member holds it: she reads, he is the one the records are about. */
export const SYSTEM_EXPLAIN_FAMILY = [
  "You write for a family member of an elderly patient about ONE thing from the patient's records: a thing he agreed to share with her, which she pressed and held on her phone.",
  "You are given its name, FACTS built from his records, and SOURCES (his doctor's own words, his medicine label, an official leaflet). Only what he shares with her is given.",
  "Rules:",
  "1. At most two short sentences, in plain and professional words, in the language `locale` names (zh-Hans: Simplified Chinese; en: English).",
  "2. Use only the facts and sources given. Add no number, date, name or fact that is not in them.",
  '3. The reader is the family member, not the patient. Write about him in the third person: in Simplified Chinese call him by the word in `patient` (or the pronoun in `pronoun`); in English use the pronouns in `pronoun` (he/his, she/her) or the word in `patient`. Never write 你 or "you".',
  "4. You may say what a medicine is for when a given source says it.",
  "5. You may say how a reading stands against the doctor's own number that is given (below it, or not below it). Compare with no other number.",
  "6. Never tell anyone to take, skip, add, change, stop or re-time any medicine or dose. Never say what dose is right. Never tell her what to do about his health.",
  "7. Never name or suggest an illness.",
  "8. Never say he is fine or in danger, and never call a reading good, bad, normal, high or low.",
  "9. If the facts do not say, say that the shared records do not say and that his doctor or pharmacist can be asked, and set abstain to true.",
  '10. Output JSON only: {"verdict": string, "abstain": boolean}.',
].join("\n");

// ---------------------------------------------------------------- the guards

/** 华语: how much to take, or whether to. */
export const DOSE_DIRECTIVE_ZH = /多吃|少吃|加量|减量|停药|换药|不用吃|可以不吃|应该吃|加一粒|多一粒|少一粒|减一粒|加倍|翻倍|减半|别吃|不要吃|不必吃|不能吃|停吃|停用|停掉|改吃|补吃|补服|跳过|必须吃|记得吃|按时吃|继续吃/u;

const DOSE_VERBS = "take|taking|skip|skipping|stop|stopping|increase|increasing|decrease|decreasing|reduce|reducing|double|doubling|halve|halving|add|adding|change|changing|switch|switching";
const DOSE_OBJECTS = "tablets?|pills?|capsules?|doses?|dosage|medicines?|medications?|meds|drugs?|mg|mcg|ml";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** English: one of the verbs followed, in the same sentence, by a medicine or dose word (or one of the medicines' names). */
export function doseDirectiveEn(names: readonly string[] = []): RegExp {
  const named = names
    .flatMap((n) => n.split(/\s+/).slice(0, 1))
    .filter((n) => /^[A-Za-z][A-Za-z-]{3,}$/.test(n))
    .map(escape);
  return new RegExp(`\\b(?:${DOSE_VERBS})\\b[^.!?;]{0,40}?\\b(?:${[DOSE_OBJECTS, ...named].join("|")})\\b`, "i");
}
export const DOSE_DIRECTIVE_EN = doseDirectiveEn();

/** The names of illnesses and the words that go with a diagnosis. One the given sources say themselves is let through. */
export const DIAGNOSIS_EN = /\b(?:hypertension|hypotension|high blood pressure|low blood pressure|diabet\w*|strokes?|heart (?:attack|failure|disease)|angina|kidney (?:disease|failure)|cancer|tumou?rs?|infections?|diseases?|illness(?:es)?|disorders?|syndromes?|conditions?|diagnos\w*|symptoms?)\b/gi;
export const DIAGNOSIS_ZH = /高血压|低血压|糖尿病|中风|心脏病|心梗|心衰|心绞痛|肾病|肾衰|癌|肿瘤|感染|疾病|病情|病症|症状|诊断|患有|得了|生病/gu;
/**
 * A verb on the blood pressure written before it: 升高血压 / 提高血压 / 降低血压 ("raises / lowers the blood pressure") hold
 * 高血压 / 低血压 as characters without naming the illness.
 */
const BP_VERB = /[升提抬增降减減][高低](?=血[压壓])/gu;

/**
 * The illness names a sentence uses (DIAGNOSIS_EN, DIAGNOSIS_ZH), a verb on the blood pressure left out (BP_VERB; 10-14: the
 * summary point 「医生说布洛芬会升高血压」 was dropped as naming 高血压, which its line "It can push your blood pressure up"
 * does not).
 */
export function illnessWords(text: string): string[] {
  const t = text.replace(BP_VERB, "··");
  return [...(t.match(DIAGNOSIS_EN) ?? []), ...(t.match(DIAGNOSIS_ZH) ?? [])];
}

/** Pointing at an illness without naming one. */
export const SUGGESTS_ILLNESS = /\byou (?:may|might|could|probably|likely|seem to|appear to) (?:have|be (?:ill|sick|unwell))\b|\bsigns? of\b|\bsymptoms? of\b|\b(?:could|may|might) (?:be|mean|indicate|suggest)\b|\bindicat(?:e|es|ing)\b|可能是|说明你|表示你|意味着|怀疑|像是/iu;
/** A family member's sentence that speaks to her as if she were him. */
export const SECOND_PERSON = /[你您]|\byou(?:r|rs|rself)?\b/iu;
/** Pointing at an illness of his in the third person (her sentence), in either language. */
export const SUGGESTS_ILLNESS_OF_HIM = /\bhe (?:may|might|could|probably|likely|seems to|appears to) (?:have|be (?:ill|sick|unwell))\b|说明(?:他|她)|表示(?:他|她)/iu;
/** A reading set against a number: only the doctor's own, which the verdict then has to name. */
export const COMPARISON = /\b(?:above|below|higher|lower|more than|less than|exceed\w*|beyond)\b|超过|高于|低于|以上|以下|大于|小于/iu;

/** At most two sentences: a decimal point, "Dr." and "a.m." do not end one. */
export function sentenceCount(text: string): number {
  const t = text
    .replace(/(\d)\.(\d)/g, "$1·$2")
    .replace(/\b(Dr|Mr|Mrs|Ms)\./g, "$1")
    .replace(/\b([ap])\.m\./gi, "$1m");
  return t
    .split(/[.!?。！？]+/u)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

const numbersIn = (text: string): string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * What a guarded sentence may draw on: the evidence of a long press, or (lib/safety/gloss.ts, an answer's own words) the
 * quotes a sentence rests on with no facts and no name of their own.
 */
export type GuardGiven = Pick<Evidence, "checked" | "sources" | "meds"> & { subject: Pick<Evidence["subject"], "name"> };

/** Everything the model was given, both languages of each source, as one text (what its sentence may draw on). */
function evidenceText(ev: GuardGiven): string {
  return [ev.subject.name, ...ev.checked, ...ev.sources.flatMap((s) => [s.en, s.zh ?? "", s.translation?.text ?? ""])].join("\n");
}

/** The numbers a clinician said, in the given sources. */
function doctorNumbers(sources: readonly Sentence[]): Set<string> {
  return new Set(sources.filter((s) => s.sourceId.startsWith("visit:")).flatMap((s) => numbersIn(s.en)));
}

/**
 * Why the model's sentence may not be shown (codes; empty: it may). Over-blocks on purpose: a dropped sentence becomes
 * the one built from his records, which is safe.
 */
export function guardVerdict(verdict: string, ev: GuardGiven, locale: HoldLocale, viewer: WordsViewer = { kind: "self" }): string[] {
  const text = verdict.normalize("NFKC").trim();
  const reasons: string[] = [];
  if (!text) return ["empty"];
  if (viewer.kind === "family") {
    // she is the reader: a sentence addressed to 「你」 is written to the wrong person
    if (SECOND_PERSON.test(text)) reasons.push("second_person");
    // 「说明爸爸…」: the same pointing at an illness, with her word for him
    if (SUGGESTS_ILLNESS_OF_HIM.test(text) || (viewer.dad && new RegExp(`(?:说明|表示)${escape(viewer.dad)}`, "u").test(text))) reasons.push("suggests_illness");
  }
  if (sentenceCount(text) > 2 || [...text].length > 280) reasons.push("too_long");
  if (hasHan(text) !== (locale === "zh-Hans")) reasons.push("language");
  if (DOSE_DIRECTIVE_ZH.test(text) || doseDirectiveEn(ev.meds).test(text)) reasons.push("dose_directive");
  if (isDirective(text)) reasons.push("directive");
  // an illness the model names itself; a word the given sources use (what the leaflet says the medicine is for) may stay
  const given = evidenceText(ev).toLowerCase();
  const named = illnessWords(text);
  if (named.some((word) => !given.includes(word.toLowerCase()))) reasons.push("diagnosis");
  if (SUGGESTS_ILLNESS.test(text) && !reasons.includes("suggests_illness")) reasons.push("suggests_illness");
  // judging words (fine, normal, dangerous, 没事, 偏高 ...), reassurance, permission, causes, combinations, dose changes,
  // and what a model-worded sentence may not claim (only, treats, "does not say"): the safety layer's own vocabulary
  // for a sentence a model wrote (lib/safety/judgement.ts modelWordingHits). Read without the illness names the sources
  // gave, so "high blood pressure" out of the leaflet is not taken for "high". "higher" / "lower" and the comparison
  // words are the next rule's; "you may" is how English says he can ask.
  let plain = text;
  for (const word of named) plain = plain.split(word).join(" ");
  const judged = modelWordingHits(plain).filter((h) => h.category !== "comparison" && !(h.category === "evaluation" && (h.word === "higher" || h.word === "lower")) && h.word !== "you may");
  if (judged.length) reasons.push(...new Set(judged.map((h) => `judgement_${h.category}`)));
  // a comparison is only ever with the doctor's own number, and the sentence has to name it
  const said = numbersIn(text);
  if (COMPARISON.test(text)) {
    const doctors = doctorNumbers(ev.sources);
    if (!said.some((n) => doctors.has(n))) reasons.push("comparison");
  }
  // no number of the model's own
  const known = new Set(numbersIn(evidenceText(ev)));
  if (said.some((n) => !known.has(n))) reasons.push("number");
  return reasons;
}

// ---------------------------------------------------------------- the call

export function explainPayload(ev: Evidence, locale: HoldLocale, viewer: WordsViewer = { kind: "self" }): ExplainPayload {
  const byOf = (s: Sentence) =>
    s.attribution === "doctor" || s.attribution === "dispenser" || s.attribution === "pharmacist" || s.attribution === "label" || s.attribution === "leaflet"
      ? s.attribution
      : s.sourceId.startsWith("visit:")
        ? "recording"
        : "records";
  return {
    task: "explain",
    locale,
    subjectType: ev.subject.type,
    subject: ev.subject.name,
    facts: ev.checked,
    // a fixed template among the sources (995) is the app's own sentence, not a source to read from
    sources: ev.sources.filter((s) => s.origin !== "template").map((s) => ({ by: sourceBy(byOf(s)), text: locale === "zh-Hans" && s.zh && s.attribution === "leaflet" ? s.zh : s.en })),
    // a family member's: who reads, and her word for him (his own payload has neither key)
    // her word decides the pronoun (lib/care/copy.ts elderWords): a link she calls 妈妈 is written about as 她 / she
    ...(viewer.kind === "family" ? { reader: "family" as const, patient: viewer.dad, pronoun: locale === "zh-Hans" ? elderWords(viewer.dad, "zh-Hans").he : `${elderWords(viewer.dad, "en").he}/${elderWords(viewer.dad, "en").his}` } : {}),
  };
}

export interface VerdictResult {
  verdict: string;
  abstain: boolean;
  by: "model" | "records";
  why?: VerdictWhy;
}

/** Verdicts the guards let through, by the evidence's id: holding the same thing again with the same records asks no model. */
type GlobalWithCache = typeof globalThis & { __rippleExplainVerdicts?: Map<string, string> };
const CACHE_MAX = 300;
function cache(): Map<string, string> {
  const g = globalThis as GlobalWithCache;
  return (g.__rippleExplainVerdicts ??= new Map());
}

export interface VerdictOptions {
  locale: HoldLocale;
  /** his consent to AI processing */
  aiAllowed: boolean;
  /** his day's model spend is used up */
  spendCapped?: boolean;
  /** the client to ask (default: the main model); the mock is never asked */
  llm?: LlmClient;
  /** who reads the sentence (default: he himself); the evidence given must be the one built for that reader */
  viewer?: WordsViewer;
  /**
   * SSE (owner 10-15): the sentence's words as the model writes them (the `verdict` field read out of the streamed JSON).
   * Shown while it is written; the guards still read the whole answer, and the caller takes the words back when the
   * sentence built from his records stands instead (abstain, a guard, a failure).
   */
  onWords?: (text: string) => void;
}

/** The sentence for this evidence: the model's when it may be asked and its words pass, else the one built from his records. */
export async function writeVerdict(ev: Evidence, opts: VerdictOptions): Promise<VerdictResult> {
  const records = (why: VerdictWhy): VerdictResult => ({ verdict: ev.verdict, abstain: ev.abstain, by: "records", why });
  const viewer: WordsViewer = opts.viewer ?? { kind: "self" };
  if (ev.fixed) return records("fixed");
  if (!opts.aiAllowed) return records("no_consent");
  if (opts.spendCapped) return records("spend_cap");
  const llm = opts.llm ?? createMainLlm();
  if (llm.provider === "mock") return records("no_model");
  const kept = cache().get(ev.answerId);
  if (kept) return { verdict: kept, abstain: false, by: "model" };
  let content: string;
  // SSE: the `verdict` field's words as they are written (onWords never throws into the call)
  const words = opts.onWords ? createFieldReader("verdict") : null;
  const onDelta = words
    ? (piece: string) => {
        const got = words.push(piece);
        if (got) {
          try {
            opts.onWords!(got);
          } catch {
            // the sheet is gone
          }
        }
      }
    : undefined;
  try {
    const res = await llm.chat({
      system: viewer.kind === "family" ? SYSTEM_EXPLAIN_FAMILY : SYSTEM_EXPLAIN,
      user: JSON.stringify(explainPayload(ev, opts.locale, viewer)),
      json: true,
      temperature: 0.2,
      maxTokens: 220,
      timeoutMs: EXPLAIN_TIMEOUT_MS,
      purpose: "explain",
      signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
      ...(onDelta ? { onDelta } : {}),
    });
    content = res.content;
  } catch (e) {
    // a code only, never a message (it can echo text)
    console.warn(`[explain] the model did not answer (${(e as { code?: unknown } | null)?.code ?? (e as Error)?.name ?? "error"}); the sentence is built from his records`);
    return records("model_failed");
  }
  let answer: Partial<Record<keyof ExplainAnswer, unknown>> | null;
  try {
    answer = parseModelJson(content) as Partial<Record<keyof ExplainAnswer, unknown>> | null;
  } catch {
    return records("model_failed");
  }
  if (!answer || typeof answer.verdict !== "string") return records("model_failed");
  if (answer.abstain === true) return records("model_abstained");
  const verdict = answer.verdict.trim();
  const reasons = guardVerdict(verdict, ev, opts.locale, viewer);
  if (reasons.length) {
    console.warn(`[explain] the model's sentence about a ${ev.subject.type} was dropped (${reasons.join(", ")})`);
    return records("guard");
  }
  const c = cache();
  if (c.size >= CACHE_MAX) c.delete(c.keys().next().value as string);
  c.set(ev.answerId, verdict);
  return { verdict, abstain: false, by: "model" };
}
