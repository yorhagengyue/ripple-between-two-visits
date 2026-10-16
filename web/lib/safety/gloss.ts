/**
 * Owner 10-15 (the rules were too rigid): the pipeline no longer calls writeGloss. Ripple's own answer (general.ts) stands
 * in its place, in the same slot of the answer (AskResult.gloss, kind general). glossAt is still used to place it, and an
 * answer kept with an explanation before then is still drawn as it was (components/daily/answer-parts.ts).
 *
 * Ripple's own words under an answer's quotes (owner's decision of 2026-10-14, the challenge's own line: explain in
 * patient-friendly language; its red line: never medication advice). Ripple may explain in its own words, every sentence
 * with its source, never what to take, how much, to change or to stop. The long press does this for one record
 * (lib/explain/verdict.ts writeVerdict); this does it for an answer of POST /api/ask. Server-only.
 *
 * Once the answer's quotes are chosen and have passed the three checks (pipeline.ts `shown`), ONE model call writes at most
 * two short sentences, in his language and in plain professional words (已服药 / 未服药 / 就诊 / 测量血压), about what the
 * quoted words say for his question. Each sentence names the quotes it rests on (their source ids); a sentence that names
 * none of the quotes shown is dropped, the others may stand. Every guard below must pass every sentence that is left, else
 * nothing is added: the answer is exactly what it is without a model.
 *
 * Which answers (the gate, in this order; the record's `why` names the first one that says no):
 *   not_this_route  only explain, uncertain and refuse_route: the routes that relay his sources and refer him. Never the
 *                   emergency, self-harm or unknown-medicine routes, a note, chit-chat, or logistics (the app's own answers
 *                   about sharing, a refill or the next visit)
 *   crisis          never an answer that carries 995, A&E or a helpline anywhere: the fixed safety line under words near a
 *                   crisis, one tablet too many already taken (its fixed sentence names 995), the doctor's warning line
 *                   quoted under a question about it
 *   no_quote        at least one quote among what is shown: a clinician's own words from a visit, the label, the leaflet's
 *                   reviewed line. His own records are not quotes (a count is Ripple's, not anyone's words); nor is a
 *                   fixed template or a refused injection
 *   no_consent, spend_cap, rate_limited, no_model
 *                   a live model: the pipeline's main client is the offline mock whenever no model may be asked for him (no
 *                   consent to AI processing, consent.ts; his day's model spend used up, lib/subject/usage.ts; the
 *                   question limit), and the mock is never asked (the record names which, as verdict.ts does). Nor is a
 *                   replay client (no_model): it answers only the prompts that were recorded, and the recorded eval
 *                   (eval/results/deepseek-run2.json) replays as it was recorded
 *   no_checker      a checker that can pass a sentence (layer 3, verify.ts): with none configured, the mock or a replay
 *                   checker, no sentence a model worded is ever shown (fail closed, as for every restatement and every
 *                   translation, lib/translate), so the model is not asked either
 *   time            the call and its checks together get the explain route's time (verdict.ts EXPLAIN_TIMEOUT_MS), or the
 *                   answer's whole budget when that is shorter (pipeline.ts); past it there is no explanation and the
 *                   answer goes out without one
 *
 * The guards (guardGlossSentence; each a code in the safety record and the server log, never the model's words):
 *   untied               (one sentence) no source id among the quotes shown: that sentence is dropped
 *   too_long             more than two sentences in all
 *   guardVerdict         verdict.ts's own, given only the quotes the sentence rests on: language, too_long, dose_directive
 *                        (zh and en), directive (directive.ts: the glossary's patterns, the imperative, "you must"),
 *                        diagnosis (an illness those quotes do not name), suggests_illness, judgement_* (judgement.ts:
 *                        reassurance such as 不用担心, permission, dose change, evaluation, causation, minimising,
 *                        efficacy, absence), comparison (only with the doctor's own number), number (a digit they lack)
 *   slot_*               layer 1's slot check (slots.ts): no medicine, unit, frequency, time or number (English number words
 *                        and Chinese numerals before a unit included) that those quotes do not have
 *   number_words         a number written out (一百四十, forty) that those quotes do not have
 *   dose                 no dose at all, not even the label's: an amount with a unit (一粒, 5 mg, one tablet) or how often
 *   instruction          no take / stop / change / skip / more / less: 多吃, 少吃, 停, 加量, 减量, 换, 可以吃, 要服, 服用 ...;
 *                        "you can take", "keep taking", "one more tablet", "less medicine" ...
 *   medicine             no medicine those quotes do not name: a KB medicine (kb/match.ts), a word that looks like one
 *                        (classify.ts unknownDrugName), a supplement or a medicine named by its use (substances.ts)
 *   register             never 吃了 / 没吃 / 看诊
 *   do_not_display_number  a number on referrals.json's B4-06 list (forbidden.ts)
 *   checker_*            layer 3 (verify.ts layer3): the checker model, given the whole words of the quotes the sentence
 *                        rests on, says the sentence says what they say; a no, an error or the time fails closed
 *
 * The explanation is kept with the answer exactly as shown (AskResult.gloss; turns.ts keeps it with the turn) and drawn as
 * Ripple's entry right after the last quote (components/daily/AnswerCard.tsx), each sentence with chips naming the quotes
 * it rests on, and gloss-note.ts's line under it.
 */
import { sourceBy } from "@/lib/explain/copy";
import { EXPLAIN_TIMEOUT_MS, guardVerdict, sentenceCount } from "@/lib/explain/verdict";
import { mentionedDrugIds } from "@/lib/kb/match";
import { parseModelJson } from "@/lib/llm/json";
import type { GlossPayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { unknownDrugName } from "./classify";
import { findForbiddenNumbers } from "./forbidden";
import { extractSlots, missingSlots } from "./slots";
import { otherSubstances } from "./substances";
import type { Candidate, Gloss, GlossSentence, Locale, Route, Sentence } from "./types";
import { layer3 } from "./verify";

/** The explain route's time (lib/explain/verdict.ts): the call and its checks together. */
export const GLOSS_TIMEOUT_MS = EXPLAIN_TIMEOUT_MS;

/** The routes whose answers relay his sources and refer him (see the header). */
export const GLOSS_ROUTES: readonly Route[] = ["explain", "uncertain", "refuse_route"];

const MAX_SENTENCES = 2;

export const SYSTEM_GLOSS = [
  "You write for an elderly patient who asked his medication-companion app a question. The app answered by showing SOURCES word for word: his doctor's (or pharmacist's) own words from his visit records, his medicine label as printed, an official leaflet's line.",
  "You explain in plain words what those quoted words say about his question. You are given his question and the SOURCES, each with its id, who said it or where it is written, and its words.",
  "Rules:",
  "1. At most two short sentences, in the language `locale` names (zh-Hans: Simplified Chinese; en: English), in plain and professional words (zh-Hans: 已服药 / 未服药 / 就诊 / 测量血压, never 吃了 / 没吃 / 看诊).",
  "2. Each sentence says what one or more of the SOURCES say and lists their ids in `sourceIds`. Never write a sentence that no source says.",
  "3. Use only what the SOURCES say. Add no number, dose, time, date, medicine name or fact that is not in them.",
  "4. Never tell him to take, not take, skip, stop, change, add, double, halve or re-time any medicine or dose. Never say how much to take or how often, not even by repeating the label (it is shown already).",
  "5. Never name or suggest an illness, a cause or a diagnosis.",
  "6. Never reassure or alarm him (no \"don't worry\", \"it is fine\", \"it is safe\", \"it is dangerous\"), and never call a reading good, bad, normal, high or low.",
  "7. Say who said it when a source names the speaker (the doctor said ...); when the speaker is not confirmed, do not say who it was.",
  "8. Give no advice of your own: the app adds its own sentence about whom to ask.",
  "9. If the SOURCES do not speak to his question, write no sentence.",
  '10. Output JSON only: {"sentences": [{"text": string, "sourceIds": [string]}]}.',
].join("\n");

// ---------------------------------------------------------------- which answers

/**
 * A sentence that is someone's words or a printed source: a visit line, the label, the leaflet's reviewed line. Never a
 * model's paraphrase (one that passed layer 3 is drawn under the leaflet's tag): Ripple's words rest on sources only.
 */
export function isGlossQuote(s: Sentence): boolean {
  if (s.origin === "template" || s.templateId || s.origin === "model") return false;
  return s.sourceId.startsWith("visit:") || s.sourceId.startsWith("label:") || s.attribution === "leaflet" || s.origin === "patient_text";
}

/** 995, A&E or a helpline in an answer: no explanation of Ripple's next to them. */
const CRISIS_WORDS = /(?<!\d)995(?!\d)|\bA\s*&\s*E\b|急诊|急診|急症室/i;
const CRISIS_TEMPLATE = /^(?:emergency_|self_harm_)|^(?:safety_line|extra_dose_taken)$/;

export function carriesCrisis(shown: readonly Sentence[]): boolean {
  return shown.some((s) => CRISIS_TEMPLATE.test(s.templateId ?? "") || CRISIS_WORDS.test(`${s.en}\n${s.zh ?? ""}`));
}

/** Where the explanation stands: right after the last sentence that is not one of Ripple's fixed ones (the last quote). */
export function glossAt(shown: readonly Sentence[]): number {
  let last = -1;
  shown.forEach((s, i) => {
    if (s.origin !== "template" && !s.templateId) last = i;
  });
  return last + 1;
}

const offline = (c: LlmClient | null): boolean => !c || c.provider === "mock" || c.provider.startsWith("replay");

// ---------------------------------------------------------------- the payload

/** Who said a quote, as the model reads it: a speaker only when he confirmed it (as the answer's own head line says it). */
function byOf(s: Sentence): Parameters<typeof sourceBy>[0] {
  if (s.sourceId.startsWith("visit:")) {
    const a = s.attribution;
    return (a === "doctor" || a === "pharmacist" || a === "dispenser") && s.cite?.roleState === "confirmed" ? a : "recording";
  }
  if (s.sourceId.startsWith("label:")) return "label";
  return "leaflet";
}

/** A quote's words as he reads them: the leaflet's reviewed line in his language, else the original words. */
function quoteText(s: Sentence, locale: Locale): string {
  return locale === "zh-Hans" && s.zh && !s.sourceId.startsWith("visit:") && !s.sourceId.startsWith("label:") ? s.zh : s.en;
}

export function glossPayload(question: string, quotes: readonly Sentence[], locale: Locale): GlossPayload {
  return { task: "gloss", locale, question, sources: quotes.map((s) => ({ id: s.sourceId, by: sourceBy(byOf(s)), text: quoteText(s, locale) })) };
}

// ---------------------------------------------------------------- the guards

/** An amount with a unit: a dose, even the label's own. */
const DOSE_ZH = /(?:\d+(?:\.\d+)?|[一二两兩三四五六七八九十百半几幾])\s*(?:粒|片|颗|顆|毫克|毫升|微克|克|mg|mcg|ml|胶囊|膠囊|袋|包|支|滴|剂|劑)/iu;
const DOSE_EN =
  /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|half|a|an|another|extra|single|double)\s*-?\s*(?:tablets?|pills?|capsules?|caps|mg|mcg|ml|milligrams?|doses?|puffs?|drops?|sachets?)\b|\d(?:\.\d+)?\s*(?:mg|mcg|ml)\b/i;
/** Take / stop / change / skip / more / less, in either language (the brief's list, and the ways round it). */
const INSTRUCTION_ZH =
  /多吃|少吃|多服|少服|停|加量|减量|減量|加药|加藥|减药|減藥|换|換|可以吃|可以服|能吃|能服|不吃|别吃|別吃|别服|補吃|补吃|补服|補服|改吃|改服|(?:增加|减少|減少|提高|降低|调整|調整|改变|改變|更改)\s*(?:剂量|劑量|用量|药量|藥量|用药|用藥)|(?:要|得|该|該|应该|應該|应当|應當|必须|必須|需要|记得|記得|按时|按時|继续|繼續|坚持|堅持|照常|马上|馬上|立刻|现在|現在)\s*(?:按时|按時)?\s*(?:吃|服)|(?:吃|服)\s*(?:\d|[一二两兩三四五六七八九十半几幾])|(?<![已未])服用/u;
const INSTRUCTION_EN = new RegExp(
  [
    String.raw`\b(?:you|he|she|they|patients?)\s+(?:can|could|may|might|should|must|need\s+to|needs\s+to|have\s+to|has\s+to|ought\s+to|is\s+to|are\s+to|had\s+better)\s+(?:not\s+|still\s+|also\s+|safely\s+|just\s+)?(?:take|stop|skip|change|switch|double|halve|increase|decrease|reduce|add|miss|cut|continue|keep|start|use)\b`,
    String.raw`\b(?:keep|continue|start|stop|quit)\s+taking\b`,
    String.raw`\b(?:one\s+more|another|extra|additional|more|less|fewer)\s+(?:\w+\s+)?(?:tablets?|pills?|capsules?|doses?|medicines?|medications?|meds|mg)\b`,
  ].join("|"),
  "i",
);
/** The plain register the owner keeps out (10-14): 已服药 / 未服药 / 就诊. */
const REGISTER_ZH = /吃了|没吃|沒吃|看诊|看診/u;

const ZH_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 萬: 10000 };

/** A Chinese numeral written out (一百四十 -> 140, 十五 -> 15, 一四零 -> 140), or null. */
function zhNumber(run: string): number | null {
  if ([...run].every((c) => c in ZH_DIGIT)) return Number([...run].map((c) => ZH_DIGIT[c]).join(""));
  let total = 0;
  let digit = 0;
  for (const c of run) {
    if (c in ZH_DIGIT) digit = ZH_DIGIT[c];
    else if (c in ZH_UNIT) {
      total += (digit || 1) * ZH_UNIT[c];
      digit = 0;
    } else return null;
  }
  return total + digit;
}

const EN_NUMBERS: Record<string, number> = {
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

/** Numbers written out in words: two or more Chinese numerals in a row, and English number words from eleven up. */
function spelledNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[零〇一二两兩三四五六七八九十百千万萬]{2,}/gu)) {
    const n = zhNumber(m[0]);
    if (n !== null) out.push(n);
  }
  for (const m of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) if (m[0] in EN_NUMBERS) out.push(EN_NUMBERS[m[0]]);
  return out;
}

/** The numbers of a text in every form the guards read: digits, numbers written out, and layer 1's number slots. */
function numbersOf(text: string): Set<string> {
  const out = new Set<string>(extractSlots(text).numbers);
  for (const d of text.match(/\d+(?:\.\d+)?/g) ?? []) out.add(String(Number(d)));
  for (const n of spelledNumbers(text)) out.add(String(n));
  return out;
}

/** The words of the quotes a sentence rests on, every language they are shown in. */
function wordsOf(quotes: readonly Sentence[]): string {
  return quotes.flatMap((s) => [s.en, s.zh ?? "", s.translation?.text ?? ""]).join("\n");
}

/**
 * Why one sentence of the explanation may not be shown (codes; empty: it may), given the quotes it rests on. Over-blocks on
 * purpose: a dropped explanation leaves the answer as it is without one, which is safe.
 */
export function guardGlossSentence(sentence: string, rests: readonly Sentence[], locale: Locale): string[] {
  const text = sentence.normalize("NFKC").trim();
  if (!text) return ["empty"];
  const given = wordsOf(rests);
  const givenSlots = extractSlots(given);
  // (no facts and no name of their own: only the quotes' words count as given, his typed reading included in none)
  const reasons = new Set<string>(guardVerdict(text, { subject: { name: "" }, checked: [], sources: [...rests], meds: [...givenSlots.drugs, ...mentionedDrugIds(text)] }, locale));
  const own = extractSlots(text);
  for (const m of missingSlots(own, givenSlots)) reasons.add(`slot_${m.category}`);
  const known = numbersOf(given);
  if (spelledNumbers(text).some((n) => !known.has(String(n)))) reasons.add("number_words");
  if (DOSE_ZH.test(text) || DOSE_EN.test(text) || own.frequencies.length > 0) reasons.add("dose");
  if (INSTRUCTION_ZH.test(text) || INSTRUCTION_EN.test(text)) reasons.add("instruction");
  const quoted = new Set(mentionedDrugIds(given));
  const theirs = otherSubstances(given);
  const others = new Set([...theirs.medicines, ...theirs.foods]);
  const mine = otherSubstances(text);
  if (
    mentionedDrugIds(text).some((d) => !quoted.has(d)) ||
    unknownDrugName(text) !== null ||
    [...mine.medicines, ...mine.foods].some((x) => !others.has(x) && !given.toLowerCase().includes(x))
  ) {
    reasons.add("medicine");
  }
  if (REGISTER_ZH.test(text)) reasons.add("register");
  if (findForbiddenNumbers(text).length > 0) reasons.add("do_not_display_number");
  return [...reasons];
}

// ---------------------------------------------------------------- the call

/** Why there is no explanation; the first four of the model's gate as verdict.ts names them (no_consent, spend_cap). */
export type GlossWhy =
  | "not_this_route"
  | "crisis"
  | "no_quote"
  | "no_consent"
  | "spend_cap"
  | "rate_limited"
  | "no_model"
  | "no_checker"
  | "model_failed"
  | "time"
  | "nothing_said"
  | "untied"
  | "guard"
  | "checker";

/** What the explanation did for one answer (safety_event.output.gloss): codes and counts, never the dropped words. */
export interface GlossRecord {
  shown: boolean;
  why?: GlossWhy;
  /** the guard or checker codes that dropped it */
  reasons?: string[];
  /** sentences the model wrote that named no quote shown (dropped one by one) */
  untied?: number;
  /** an error's code when the model or the time stopped it (deadline, timeout, budget, bad_response ...) */
  error?: string;
  /** the checker that ran */
  checker?: string;
  /** main-model calls (0 or 1), the tokens of that call and of its checks, the time it took */
  calls: number;
  tokens: number;
  ms: number;
  /** what was shown (the same as AskResult.gloss.sentences) */
  sentences?: GlossSentence[];
}

export interface GlossInput {
  route: Route;
  /** the answer's language */
  locale: Locale;
  /** his words */
  question: string;
  /** the answer as it is shown (pipeline.ts `shown`: after the three checks) */
  shown: readonly Sentence[];
  /** the answer's main client: the offline mock whenever no model may be asked for him (see the header) */
  llm: LlmClient;
  /** the layer-3 checker (null: none configured) */
  checker: LlmClient | null;
  checkerReason?: string | null;
  /** the whole time for the call and its checks (default GLOSS_TIMEOUT_MS) */
  timeoutMs?: number;
  /**
   * why the pipeline's client is the offline mock for this answer, when it knows (no consent, the spend cap, the question
   * limit): the record then names that instead of no_model
   */
  offline?: "no_consent" | "spend_cap" | "rate_limited";
}

export interface GlossOutcome {
  gloss: Gloss | null;
  record: GlossRecord;
}

/** A short code for an error, never its message (a vendor's message can echo the prompt). */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

/** The model's sentences as written: { sentences: [{ text, sourceIds }] } (a bare array is read the same way). */
function readAnswer(content: string): { text: string; sourceIds: string[] }[] | null {
  let body: unknown;
  try {
    body = parseModelJson(content);
  } catch {
    return null;
  }
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? (body as { sentences?: unknown }).sentences : null;
  if (!Array.isArray(list)) return null;
  const out: { text: string; sourceIds: string[] }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { text, sourceIds, sourceId } = item as { text?: unknown; sourceIds?: unknown; sourceId?: unknown };
    if (typeof text !== "string" || !text.trim()) continue;
    const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds ?? sourceId];
    out.push({ text: text.trim(), sourceIds: [...new Set(ids.filter((x): x is string => typeof x === "string"))] });
  }
  return out;
}

/** `work`, or "time" when it has not settled within `ms` (a client that does not stop at its signal cannot hold the answer). */
function within<T>(ms: number, work: Promise<T>): Promise<T | "time"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("time"), ms);
    work.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Ripple's explanation of this answer's quotes, or null with the reason (see the header). Never rejects and never takes
 * longer than its time: whatever goes wrong, the answer goes out as it is.
 */
export async function writeGloss(input: GlossInput): Promise<GlossOutcome> {
  const started = performance.now();
  const record = (why: GlossWhy, more: Partial<GlossRecord> = {}): GlossOutcome => ({
    gloss: null,
    record: { shown: false, why, calls: 0, tokens: 0, ms: Math.round(performance.now() - started), ...more },
  });
  try {
    if (!GLOSS_ROUTES.includes(input.route)) return record("not_this_route");
    if (carriesCrisis(input.shown)) return record("crisis");
    // the quotes as they are now (the answer's sentences can still gain a translation while this runs)
    const quotes = input.shown.filter(isGlossQuote).map((s) => ({ ...s }));
    if (quotes.length === 0) return record("no_quote");
    if (offline(input.llm)) return record(input.offline ?? "no_model");
    if (offline(input.checker)) return record("no_checker");
    const at = glossAt(input.shown);
    const ms = Math.max(1, input.timeoutMs ?? GLOSS_TIMEOUT_MS);
    const used = { calls: 0, tokens: 0 };
    const outcome = await within(ms, compose(input, quotes, at, ms, used)).catch((e: unknown) => record("model_failed", { error: errorCode(e) }));
    if (outcome === "time") {
      console.warn("[gloss] no explanation: the model and its checks did not finish in time");
      return record("time", { calls: used.calls, tokens: used.tokens, checker: input.checker!.provider });
    }
    return { gloss: outcome.gloss, record: { ...outcome.record, calls: used.calls, tokens: used.tokens, ms: Math.round(performance.now() - started) } };
  } catch (e) {
    // (a guard that throws is a bug; the answer still goes out as it is)
    console.error(`[gloss] failed (${errorCode(e)}); the answer goes out without an explanation`);
    return record("model_failed", { error: errorCode(e) });
  }
}

async function compose(input: GlossInput, quotes: Sentence[], at: number, ms: number, used: { calls: number; tokens: number }): Promise<GlossOutcome> {
  const checker = input.checker!;
  const signal = AbortSignal.timeout(ms);
  const fail = (why: GlossWhy, more: Partial<GlossRecord> = {}): GlossOutcome => ({ gloss: null, record: { shown: false, why, checker: checker.provider, calls: 0, tokens: 0, ms: 0, ...more } });
  let content: string;
  try {
    used.calls++;
    const res = await input.llm.chat({
      system: SYSTEM_GLOSS,
      user: JSON.stringify(glossPayload(input.question, quotes, input.locale)),
      json: true,
      temperature: 0.2,
      maxTokens: 300,
      timeoutMs: ms,
      purpose: "gloss",
      signal,
    });
    used.tokens += res.tokens;
    content = res.content;
  } catch (e) {
    const code = errorCode(e);
    console.warn(`[gloss] the model did not answer (${code}); no explanation`);
    return fail(code === "deadline" || code === "timeout" ? "time" : "model_failed", { error: code });
  }
  const written = readAnswer(content);
  if (written === null) return fail("model_failed", { error: "bad_response" });
  if (written.length === 0) return fail("nothing_said");

  // every sentence rests on quotes he sees, or it is dropped
  const byId = new Map(quotes.map((q) => [q.sourceId, q]));
  const tied = written.map((w) => ({ text: w.text, sourceIds: w.sourceIds.filter((id) => byId.has(id)) })).filter((w) => w.sourceIds.length > 0);
  const untied = written.length - tied.length;
  if (tied.length === 0) return fail("untied", { untied });

  const reasons = new Set<string>();
  if (tied.length > MAX_SENTENCES || tied.reduce((n, w) => n + sentenceCount(w.text), 0) > MAX_SENTENCES) reasons.add("too_long");
  for (const w of tied) for (const r of guardGlossSentence(w.text, w.sourceIds.map((id) => byId.get(id)!), input.locale)) reasons.add(r);
  if (reasons.size > 0) {
    console.warn(`[gloss] the model's explanation was dropped (${[...reasons].join(", ")})`);
    return fail("guard", { reasons: [...reasons], untied });
  }

  // layer 3, as for every sentence a model words: the checker reads the whole words of the quotes it rests on
  const checks = await Promise.all(
    tied.map((w) => {
      const source = w.sourceIds
        .map((id) => byId.get(id)!)
        .map((q) => [...new Set([q.en, q.zh ?? ""].filter(Boolean))].join("\n"))
        .join("\n\n");
      const candidate: Candidate = { sourceId: "gloss", kind: "kb", span: source };
      const sentence: Sentence = { speechAct: "restate", sourceId: "gloss", span: "", slots: {}, en: w.text };
      return layer3(sentence, candidate, checker, input.checkerReason ?? null, signal);
    }),
  );
  for (const c of checks) used.tokens += c.tokens;
  const failed = [...new Set(checks.flatMap((c) => (c.pass ? [] : c.reasons)))];
  if (failed.length > 0) {
    console.warn(`[gloss] the checker did not confirm the explanation (${failed.join(", ")})`);
    return fail("checker", { reasons: failed, untied });
  }
  // (shown as written: the guards read the NFKC form, which would turn 「，」 into ",")
  const sentences: GlossSentence[] = tied.map((w) => ({ text: w.text.trim(), sourceIds: w.sourceIds }));
  return {
    gloss: { kind: "gloss", lang: input.locale, sentences, at },
    record: { shown: true, checker: checker.provider, calls: 0, tokens: 0, ms: 0, ...(untied ? { untied } : {}), sentences },
  };
}
