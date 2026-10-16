/**
 * Ripple's own answer (owner 10-15: 「AI 规则太死，一些平常的问题规则答不了，比如说口腔溃疡能不能吃辣这种简单的问题应该要回答 …
 * 写在规则里面完全不好改，应该完全放开」). An ordinary health or daily-life question gets a real, short answer in his language
 * from the model, as the owner's policy file says (policy/answer-policy.md: what it may and may not say, in plain words, edited
 * by him). His own sources still come first: the answer's quotes (his doctor's words, his labels, the leaflets) are shown as
 * before, and this answer stands after them, marked on the screen as general information from Ripple, not his doctor's words.
 * Server-only.
 *
 * One model call: the policy file, then the output format below (kept in code: the parsing depends on it). The payload is
 * his question, his medicines and the sources that may bear on it, so the answer never goes against his doctor's own words.
 * The model also says whom he might ask (doctor, pharmacist or none); the screen then offers to put his question on that
 * list, and nothing is added unless he taps it.
 *
 * What code still checks (guardGeneral; each a code in the safety record, never the model's words), only the lines any
 * careful health assistant keeps:
 *   med_change   it never tells him, or lets him, take more or less of his medicine, double, skip, stop, halve or change it
 *                on his own (「可以多吃一粒」, 「先停药」, "you can skip a dose"); telling him not to do so on his own is fine
 *   diagnosis    it never says he has an illness (「你得了…」, "you have a stroke")
 *   number       no number on the do-not-display list (forbidden.ts)
 *   machinery    no JSON key, brace or model tag in the text (10-16, Hunyuan: see MACHINERY)
 *   language     his language (Chinese with Chinese, English with English)
 *   too_long     a short answer (at most GENERAL_MAX_CHARS of its language)
 * Anything else the policy allows is allowed: general advice, reassurance, food, sleep, exercise, when to see a doctor.
 * When a check fails, the model fails or the time runs out, there is no answer of Ripple's own, and the answer is what it
 * was before 10-15 (his sources, or the fixed sentence that says none answers it, and the question on his list).
 */
import { parseModelJson } from "@/lib/llm/json";
import type { GeneralPayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { createFieldReader } from "@/lib/sse/json-field";
import { findForbiddenNumbers } from "./forbidden";
import { answerPolicy } from "./policy/load";
import { detectLang } from "./text";
import type { Candidate, Gloss, Locale } from "./types";

/**
 * The longest answer kept, in characters of its own language (10-15: one cap of 420 for both dropped an English answer of
 * eighty words, and the old 「不猜测」 reply came back in its place; the policy asks for about 100 字 or 80 words).
 */
export const GENERAL_MAX_CHARS: Record<Locale, number> = { "zh-Hans": 260, en: 900 };

/**
 * The language of Ripple's own answer: the one the question was asked in (the policy: 「用他问问题的语言回答」; since the
 * owner's 10-15 the screens are in English until he sets 华语, and he may still type or say his question in Chinese).
 */
export function answerLocale(question: string, screen: Locale): Locale {
  return question.trim() ? detectLang(question) : screen;
}
/** The longest a general answer may take, model call included (the answer waits for it). */
export const GENERAL_TIMEOUT_MS = 7000;

/** The output format, appended to the owner's policy (kept in code: the parsing depends on it). */
export const GENERAL_FORMAT = [
  "## 输出格式 / Output format",
  "You receive JSON: his question, the language to answer in (`locale`: zh-Hans means Simplified Chinese, en means English), the names of his medicines, and `sources` (his doctor's or pharmacist's own words, his medicine labels, leaflet lines; each with who said it or where it is written).",
  "Answer his question as the rules above say. Use the sources only when they speak to his question, and never go against them.",
  'Reply with JSON only: {"answer": "<your answer, plain text, no lists, no headings>", "ask": "doctor" | "pharmacist" | "none"}.',
  "`ask`: whom he might ask about this, only when that is genuinely useful (the app then offers to add his question to that list); otherwise none.",
].join("\n");

/** What Ripple's own answer did for one ask (safety_event.output.general): codes and counts, never dropped words. */
export interface GeneralRecord {
  shown: boolean;
  /** why there is none: offline_reason (no consent, spend cap, question limit), no_policy, model_failed, time, empty, guard, gate, harness (pipeline.ts harnessHoldsGeneral) */
  why?: string;
  /** the guard codes that dropped it */
  reasons?: string[];
  error?: string;
  calls: number;
  tokens: number;
  ms: number;
  /** the model's suggestion of whom to ask */
  ask?: "doctor" | "pharmacist" | "none";
}

export interface GeneralInput {
  locale: Locale;
  question: string;
  /** his medicines' names (as on his list) */
  medicines: string[];
  /** the candidates of this ask: the ones that may bear on the question go to the model (generalSources) */
  candidates: readonly Candidate[];
  /** the question's topics (classify.ts): sources on them come first */
  topics: string[];
  llm: LlmClient;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * SSE (owner 10-15): the answer's words as the model writes them (the `answer` field read out of the streamed JSON,
   * lib/sse/json-field.ts). Only what the screen shows while it is written: the guards below still read the whole answer
   * once it is complete, and the caller takes the words back (a retraction) when it is not shown.
   */
  onWords?: (text: string) => void;
}

export interface GeneralOutcome {
  /** the answer's text and whom to ask (null: none to show) */
  answer: { text: string; ask: "doctor" | "pharmacist" | "none" } | null;
  record: GeneralRecord;
}

/** Who said a source or where it is written, as the model reads it. */
function byOf(c: Candidate): string {
  if (c.kind === "visit") {
    const confirmed = c.cite?.roleState === "confirmed";
    if (c.attribution === "pharmacist") return "his pharmacist";
    if (c.attribution === "dispenser") return "the clinic counter";
    return c.attribution === "doctor" && confirmed ? "his doctor" : "his doctor (probably)";
  }
  // (10-15: with several medicines a label or a leaflet line says which medicine it is about; without the name the model
  // read the metformin label's "Take TWO tablets" and still wrote that his labels gave no metformin dose)
  const about = c.drugs?.length ? ` for ${c.drugs.join(", ")}` : "";
  if (c.kind === "label") return `his medicine label${about}`;
  if (c.kind === "patient_text" || c.kind === "kb") return `official leaflet${about}`;
  return "his own records";
}

/**
 * The sources the model is given (at most 10): the clinicians' own lines, his labels and the leaflet lines among this ask's
 * candidates, those on the question's topics first. Fixed templates, referral rows and his own logs are left out.
 */
export function generalSources(candidates: readonly Candidate[], topics: string[], locale: Locale): { by: string; text: string }[] {
  const usable = candidates.filter(
    (c) => (c.kind === "visit" && !!c.attribution) || c.kind === "label" || c.kind === "patient_text",
  );
  const onTopic = (c: Candidate) => (c.topics ?? []).some((t) => topics.includes(t));
  const ordered = [...usable.filter(onTopic), ...usable.filter((c) => !onTopic(c))];
  const out: { by: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    const text = (c.kind === "patient_text" && c.restatement ? (locale === "zh-Hans" ? c.restatement.zh : c.restatement.en) : c.span).trim().slice(0, 300);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ by: byOf(c), text });
    if (out.length >= 10) break;
  }
  return out;
}

export function generalPayload(input: Pick<GeneralInput, "locale" | "question" | "medicines" | "candidates" | "topics">): GeneralPayload {
  return {
    task: "general",
    locale: input.locale,
    question: input.question,
    medicines: input.medicines,
    sources: generalSources(input.candidates, input.topics, input.locale),
  };
}

// ---------------------------------------------------------------- the guards

/**
 * He is told, or allowed, to change his medicine on his own: take more or less, an extra or a double dose, skip, stop,
 * halve or switch it. A negation right before it ("不要自己停药", "don't skip a dose") is the opposite and passes.
 */
/** Within a few characters after the verb: a medicine word (「多吃一粒」, 「停掉降压药」), so 「少吃辣的」 is food, not a dose. */
const MEDS_AHEAD = String.raw`(?=[^，。！？,.!?]{0,4}(?:药|藥|粒|片|颗|顆|剂|劑|降压|降壓))`;
/** A change of his medicine (the verbs with 药 or 服 in them are about medicine already; the others need MEDS_AHEAD). */
const MED_VERB =
  String.raw`(?:多服|加服|补服|補服|少服|停服|停用|停药|停藥|减药|減藥|加药|加藥|换药|換藥|` +
  String.raw`(?:多吃|少吃|补吃|補吃|加吃|停吃|停掉|停一停|停几天|停幾天|暂停|暫停|减半|減半|减量|減量|加量|加倍|翻倍|掰开|掰開|掰一半|切一半|换成|換成|跳过|跳過)${MEDS_AHEAD})`;
/** Not when it is about the time before, or names the matter to ask about (「停药之前先问医生」, 「停药的事要问医生」). */
const NOT_BEFORE_ZH = String.raw`(?![^，。！？,.!?]{0,8}(?:之前|以前|的事|的问题|要问|先问|请问|询问|問醫生|问医生|问药剂师))`;
const MED_CHANGE_ZH: RegExp[] = [
  // a modal that permits or tells, then a change of his medicine (「可以多吃一粒」, 「你就先停药」, 「能减半吃药」, 「可以不吃药」); a
  // negation right before the modal is the opposite (「不能自己停药」), and 「不要自己停药」 has no modal at all
  new RegExp(
    String.raw`(?<![不别別勿没沒莫无無])(?:可以|可|能够|能|应该|應該|应当|應當|建议|建議|不妨|最好|就|直接)\s*(?:先|再|自己|直接|暂时|暫時)?\s*(?:${MED_VERB}|不吃药|不吃藥|不服药|不服藥)${NOT_BEFORE_ZH}`,
    "u",
  ),
  // the same as a bare instruction at the start of a clause (「先停药两天看看」, 「今晚加吃一粒降压药」)
  new RegExp(String.raw`(?:^|[，。！？,.!?；;：:]\s*)(?:你)?\s*(?:先|暂时|暫時|今天|今晚|明天)?\s*${MED_VERB}${NOT_BEFORE_ZH}`, "u"),
  // more or fewer tablets, said as fine (「多吃一粒没关系」, 「少吃一片也可以」)
  /(?:多|少|补|補|加)(?:吃|服)(?:了)?\s*(?:[一二两兩三半1-9]\s*)?(?:粒|片|颗|顆|次|剂|劑)[^，。！？,.!?]{0,8}(?:没关系|沒關係|没事|沒事|不要紧|不要緊|也行|也可以|可以|无妨|無妨|问题不大|問題不大)/u,
];
const NOT_BEFORE_EN = String.raw`(?<!\b(?:don'?t|do not|never|not|no need to|shouldn'?t|should not|must not|mustn'?t|avoid|without|before you|before)\s+)`;
const MED_CHANGE_EN: RegExp[] = [
  new RegExp(
    NOT_BEFORE_EN +
      String.raw`\b(?:take|have)\s+(?:an?\s+|one\s+)?(?:extra|another|one more|second|double|additional|half (?:a|the|your))\s+(?:tablet|pill|dose|capsule)s?\b`,
    "i",
  ),
  new RegExp(NOT_BEFORE_EN + String.raw`\b(?:double|halve)\s+(?:up|(?:your|the)\s+(?:dose|tablets?|pills?|medicine|medication))\b`, "i"),
  new RegExp(NOT_BEFORE_EN + String.raw`\bskip\s+(?:a|your|the|today'?s|tonight'?s|this)?\s*(?:morning'?s?\s+|evening'?s?\s+)?(?:dose|tablet|pill|medicine|medication)s?\b`, "i"),
  new RegExp(NOT_BEFORE_EN + String.raw`\bstop\s+(?:taking\s+)?(?:your|the|this|that|these|those)\s+(?:blood pressure\s+|bp\s+)?(?:medicine|medication|tablets?|pills?|meds)\b`, "i"),
  new RegExp(NOT_BEFORE_EN + String.raw`\b(?:increase|reduce|lower|raise|cut|change)\s+(?:the|your)\s+dose\b`, "i"),
  /\b(?:can|may|could|should|it'?s (?:fine|ok(?:ay)?|safe) to)\s+(?:just\s+)?(?:take (?:an? )?(?:extra|another|one more|double)|stop taking|double (?:up|your|the))\b/i,
];

/**
 * The recordings of 10-16 (C3, a red line): under 「I forgot this morning's pill, it's 9pm now, should I take it?」 Ripple's own
 * answer said "you can take the one you forgot now, just not a double dose": when to take his medicine. Any permission or
 * instruction to take, skip, delay or time a dose drops the answer: "you can take", "take it now", "take the one you forgot",
 * "it's fine to skip", "wait until tomorrow's dose", 「可以吃药」, 「现在吃」, 「补吃」. A negation before it ("don't take it
 * now", 「不要补吃」) is the opposite and passes; food is not a dose (「饭后可以吃水果」).
 */
const DOSE_TIMING_EN: RegExp[] = [
  /\byou\s+(?:can|could|may|should|might want to|are able to)\s+(?:still\s+|just\s+|safely\s+|now\s+|go ahead and\s+)?(?:take|have|skip|delay|leave out|miss|swallow)\b/i,
  /(?<!\b(?:don'?t|do not|never|not|shouldn'?t|should not|no need to)\s+)\b(?:take|have|swallow)\s+(?:it|them|that one|this one|the (?:one|dose|tablet|pill|medicine)s?|your (?:dose|tablet|pill|medicine|medication)s?|the (?:missed|forgotten|morning'?s?|evening'?s?) (?:dose|one|tablet|pill)s?)\s+(?:now|right away|straight away|tonight|later|tomorrow|when you remember|as soon as)\b/i,
  /\btake the (?:one|dose|tablet|pill)s? you (?:forgot|missed)\b/i,
  /\b(?:go ahead and|it'?s (?:fine|ok(?:ay)?|safe|alright) to|feel free to)\s+(?:take|have|skip|delay|miss)\b/i,
  /\b(?:wait|hold off|delay)\s+(?:until|till|for)\b[^.?!]{0,40}\b(?:dose|tablet|pill|take)\b/i,
];
const DOSE_TIMING_ZH: RegExp[] = [
  /(?<!(?:不|别|別|勿|没|沒|莫|不要|不用|不必|无须|無須|不需要)(?:自己|先|再|随便|隨便)?)(?:补吃|補吃|补服|補服)/u,
  /(?<![不别別勿没沒莫])(?:可以|可|能|就|直接|马上|馬上|赶紧|趕緊)\s*(?:现在|現在|今晚|今天|晚上|明天|等下|待会|待會)?\s*(?:吃|服用|服)(?=[^，。！？,.!?]{0,4}(?:药|藥|粒|片|颗|顆|它|那颗|那粒|这粒|這粒|忘|漏|剂|劑)|\s*[，。！？,.!?]|$)/u,
  /(?<![不别別勿])(?:现在|現在|今晚|马上|馬上)(?:就)?(?:吃|服)(?:药|藥|它|掉|了吧|吧|那粒|那片)/u,
];

/** He is told he has an illness (「你得了…」, "you have a stroke"). Saying what is common, or what a doctor checks, is fine. */
const DIAGNOSIS: RegExp[] = [
  /你(?:这是|這是|这就是|這就是|得了|患了|肯定是|一定是|就是)[^，。！？,.!?]{0,10}(?:病|症|炎|癌|中风|中風|梗|瘤)/u,
  /\byou\s+(?:definitely\s+|certainly\s+|probably\s+)?(?:have|'ve got|have got)\s+(?:a\s+|an\s+)?(?:[a-z-]+\s+){0,3}(?:disease|infection|cancer|stroke|heart attack|diabetes|syndrome|disorder|tumou?r)\b/i,
  /\bthis is\s+(?:definitely\s+|certainly\s+)?(?:a\s+|an\s+)?(?:stroke|heart attack|cancer|tumou?r)\b/i,
];

const HAN = /\p{Script=Han}/u;

/**
 * Text that is the model's machinery, not an answer (10-16, measured with Hunyuan hy3 on TokenHub when its JSON mode was on:
 * the reply's own JSON tail `","ask":"none"}` inside the answer, `</think:...>` and `<tool_call:...>` tags, "(End.)"). An
 * everyday answer never holds braces, a JSON key or a tag; with any of them it is not shown (the answer is what it was
 * before, as for every other guard).
 */
const MACHINERY = /[{}]|"\s*(?:ask|answer)\s*"\s*:|'\s*(?:ask|answer)\s*'\s*:|<\/?(?:think|tool_call)\b|\(End\.\)/i;

/** Why a general answer may not be shown (codes; empty: it may). Only the lines in the header. */
export function guardGeneral(text: string, locale: Locale): string[] {
  const t = text.normalize("NFKC").trim();
  if (!t) return ["empty"];
  const reasons: string[] = [];
  if ([...MED_CHANGE_ZH, ...MED_CHANGE_EN].some((re) => re.test(t))) reasons.push("med_change");
  if ([...DOSE_TIMING_ZH, ...DOSE_TIMING_EN].some((re) => re.test(t))) reasons.push("dose_timing");
  if (DIAGNOSIS.some((re) => re.test(t))) reasons.push("diagnosis");
  if (findForbiddenNumbers(t).length > 0) reasons.push("number");
  if (MACHINERY.test(t)) reasons.push("machinery");
  if (locale === "zh-Hans" ? !HAN.test(t) : HAN.test(t)) reasons.push("language");
  if (t.length > GENERAL_MAX_CHARS[locale]) reasons.push("too_long");
  return reasons;
}

// ---------------------------------------------------------------- the call

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

function readAnswer(content: string): { text: string; ask: "doctor" | "pharmacist" | "none" } | null {
  let body: unknown;
  try {
    body = parseModelJson(content);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const { answer, ask } = body as { answer?: unknown; ask?: unknown };
  if (typeof answer !== "string") return null;
  return { text: answer.trim(), ask: ask === "doctor" || ask === "pharmacist" ? ask : "none" };
}

/**
 * Ripple's own answer to his question, or none with the reason. Never rejects and never takes longer than its time:
 * whatever goes wrong, the answer goes out without it.
 */
export async function writeGeneral(input: GeneralInput): Promise<GeneralOutcome> {
  const started = performance.now();
  const used = { calls: 0, tokens: 0 };
  const done = (why: string | null, more: Partial<GeneralRecord> = {}, answer: GeneralOutcome["answer"] = null): GeneralOutcome => ({
    answer,
    record: { shown: !!answer, ...(why ? { why } : {}), calls: used.calls, tokens: used.tokens, ms: Math.round(performance.now() - started), ...more },
  });
  const policy = answerPolicy();
  if (!policy) return done("no_policy");
  const ms = Math.max(1, input.timeoutMs ?? GENERAL_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  // SSE: the `answer` field's words as they are written (onWords never throws into the call)
  const words = input.onWords ? createFieldReader("answer") : null;
  const onDelta = words
    ? (piece: string) => {
        const got = words.push(piece);
        if (got) {
          try {
            input.onWords!(got);
          } catch {
            // the screen is gone: the answer is still made and kept
          }
        }
      }
    : undefined;
  try {
    used.calls++;
    const res = await input.llm.chat({
      system: `${policy}\n\n${GENERAL_FORMAT}`,
      user: JSON.stringify(generalPayload({ ...input, locale: answerLocale(input.question, input.locale) })),
      json: true,
      temperature: 0.4,
      maxTokens: 400,
      timeoutMs: ms,
      purpose: "general",
      signal,
      ...(onDelta ? { onDelta } : {}),
    });
    used.tokens += res.tokens;
    const written = readAnswer(res.content);
    if (!written) return done("model_failed", { error: "bad_response" });
    if (!written.text) return done("empty");
    const reasons = guardGeneral(written.text, answerLocale(input.question, input.locale));
    if (reasons.length > 0) {
      console.warn(`[general] Ripple's answer was dropped (${reasons.join(", ")})`);
      return done("guard", { reasons, ask: written.ask });
    }
    return done(null, { ask: written.ask }, written);
  } catch (e) {
    const code = errorCode(e);
    console.warn(`[general] the model did not answer (${code}); no answer of Ripple's own`);
    return done(code === "deadline" || code === "timeout" ? "time" : "model_failed", { error: code });
  }
}

/** The answer as the gloss slot carries it (AskResult.gloss, kind general), standing before `shown[at]`. */
export function generalGloss(answer: { text: string; ask: "doctor" | "pharmacist" | "none" }, locale: Locale, at: number): Gloss {
  return { kind: "general", lang: locale, sentences: [{ text: answer.text, sourceIds: [] }], at, ...(answer.ask !== "none" ? { offer: answer.ask } : {}) };
}
