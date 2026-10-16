/**
 * The 995 and self-harm answers in a person's words (owner 10-15: 「995 的回答太僵硬了」). The rules still find every crisis
 * (classify.ts: emergency and self-harm words, the crisis screen) and the fixed sentences are still made first
 * (templates.ts), so an emergency always has an answer. Then, with a live model, ONE short call words Ripple's own lines
 * of that answer for what he actually said, in his language, calm and short, the action first, as the owner's policy file
 * says (policy/answer-policy.md: the emergency and self-harm sections). Server-only.
 *
 * What it rewrites: Ripple's action lines (emergency_995, the overdose sentences, the 995 sentence of a sign kept for his
 * doctor, the self-harm 995 sentence) and the line that says his words were kept for his doctor (signal_recorded), as one
 * sentence or a few, standing where the first of them stood. It never touches his doctor's own words (quoted as before) or
 * the helplines (SOS, mindline, Care Corner: fixed lines with their call buttons, always shown after it).
 *
 * The words replace the fixed ones only when (guardCrisisWords): every number of the fixed lines is in them (995; the date
 * and time his words were kept), a 995 that was "if it gets bad" stays conditional (urgencyOf: his own chest pain or a
 * reading kept for his doctor, 10-14), no other number is (only those, his own and his doctor's line's), nothing on the
 * do-not-display list, no medicine or dose (no aspirin, no tablets: the policy says so too), his language, short. Otherwise,
 * offline (the mock), without his consent, at the spend cap or the question limit, when the policy file cannot be read, when
 * the model fails or takes longer than CRISIS_WORDS_TIMEOUT_MS: the fixed sentences as they are. The answer keeps each
 * replaced line's templateId on the new sentence (origin "voiced"), so the screen draws it the same way: the red card
 * with its 995 button, or Ripple's line with its call buttons.
 */
import { parseModelJson } from "@/lib/llm/json";
import type { CrisisWordsPayload } from "@/lib/llm/protocol";
import type { LlmClient } from "@/lib/llm/types";
import { findForbiddenNumbers } from "./forbidden";
import { answerPolicy } from "./policy/load";
import type { Locale, Route, Sentence } from "./types";

/** The longest the crisis answer waits for the model; past it the fixed sentences go out. */
export const CRISIS_WORDS_TIMEOUT_MS = 2500;
/** The longest wording kept (characters). */
export const CRISIS_WORDS_MAX_CHARS = 260;

/** Ripple's own lines of a crisis answer that the model may word (the helplines are not among them). */
export const VOICED_TEMPLATES = [
  "emergency_995",
  "emergency_overdose",
  "emergency_overdose_other",
  "signal_995_chest",
  "signal_995_stroke",
  "signal_995_unwell",
  "signal_recorded",
  "self_harm_995",
  "self_harm_995_other",
];

export const CRISIS_FORMAT = [
  "## 输出格式 / Output format",
  "You receive JSON: his message, the kind of crisis (`kind`: emergency or self_harm), the fixed sentences Ripple would otherwise show (`fixed`), his doctor's warning line when it is shown with your words (`doctorLine`), when his words were kept for his doctor (`noted`, or null) and whether he is telling about someone else (`someoneElse`: then speak about them).",
  "Write Ripple's answer in place of the fixed sentences, for what he said, as the emergency or self-harm rules above say, in the language `locale` names (zh-Hans: Simplified Chinese; en: English). The fixed sentences say what must be said, not how: do not copy them, say it in your own words and name what he told you. Keep every action and every number of them (995, the nearest A&E). When `noted` is given, say his words were kept for his doctor and write that time exactly as given.",
  "`urgency` now: tell him to call 995 now (or go to the nearest A&E). `urgency` if_worse: nothing says it is happening badly now; his words are kept for his doctor, and 995 is only for when it gets bad: keep the conditions of the fixed sentence (if ... then call 995) and never tell him to call 995 right now.",
  "His doctor's warning line, when given, is shown right after your words in the doctor's own voice: do not repeat or retell it.",
  "At most three short sentences. No phone number other than 995. No medicine, no tablets, no dose.",
  'Reply with JSON only: {"answer": "<your words>"}.',
].join("\n");

export interface CrisisWordsRecord {
  voiced: boolean;
  /** why the fixed sentences stand: offline, no_policy, nothing (no line to word), model_failed, time, empty, guard */
  why?: string;
  reasons?: string[];
  error?: string;
  /** the template ids it stands in for */
  replaced?: string[];
  calls: number;
  tokens: number;
  ms: number;
}

export interface CrisisWordsInput {
  route: Route;
  locale: Locale;
  /** his words */
  message: string;
  /** the answer as it stands after the checks (fixed sentences, his doctor's line) */
  shown: readonly Sentence[];
  someoneElse: boolean;
  llm: LlmClient;
  /** why the client is the offline mock, when it is (no consent, the spend cap, the question limit) */
  offline?: string;
  timeoutMs?: number;
  /** the answer's own deadline: the wording stops there too, whichever comes first */
  signal?: AbortSignal;
}

const HAN = /\p{Script=Han}/u;
const textOf = (s: Sentence, locale: Locale) => (locale === "zh-Hans" && s.zh ? s.zh : s.en);
const numbersIn = (text: string): string[] => (text.match(/\d+/g) ?? []).map((n) => String(Number(n)));

/** A medicine, a tablet or a dose in Ripple's own crisis words: never (the policy says so too). */
const MEDICINE = /阿司匹林|阿斯匹林|硝酸甘油|舌下|吃药|吃藥|服药|服藥|药片|藥片|(?:[一二两兩三半1-9]\s*)(?:粒|片|颗|顆)|\b(?:aspirin|nitroglycerin|gtn|sorbitrate|tablets?|pills?|medicines?|medications?|dose)\b/i;

/** The "when" of the line that says his words were kept for his doctor (「（10月15日 02:22）」, "(14 Oct, 4:20 pm)"). */
export function notedWhen(s: Sentence | undefined, locale: Locale): string | null {
  if (!s) return null;
  const m = textOf(s, locale).match(/（([^）]+)）|\(([^)]+)\)/);
  return m ? (m[1] ?? m[2]).trim() : null;
}

/** Why the model's crisis words may not stand in for the fixed ones (codes; empty: they may). */
/** The conditional 995 of a sign kept for his doctor (10-14): only these two are "if it gets bad"; every other line is "now". */
const IF_WORSE = ["signal_995_chest", "signal_995_unwell"];
/** A condition in the words ("要是…", "if …"): an if_worse answer keeps its 995 conditional. */
const CONDITION = /要是|如果|万一|萬一|假如|一旦|若是|倘若|if|should (?:it|the|you)|in case/i;

/** now, or if_worse when every action line among the targets is a conditional one (see IF_WORSE). */
export function urgencyOf(targetIds: readonly string[]): "now" | "if_worse" {
  const actions = targetIds.filter((id) => id !== "signal_recorded");
  return actions.length > 0 && actions.every((id) => IF_WORSE.includes(id)) ? "if_worse" : "now";
}

export function guardCrisisWords(
  answer: string,
  input: { locale: Locale; fixed: string[]; noted: string | null; message: string; doctorLine?: string; urgency?: "now" | "if_worse" },
): string[] {
  const t = answer.normalize("NFKC").trim();
  if (!t) return ["empty"];
  const reasons: string[] = [];
  const required = new Set([...input.fixed.flatMap(numbersIn), ...(input.noted ? numbersIn(input.noted) : [])]);
  const own = new Set(numbersIn(t));
  if ([...required].some((n) => !own.has(n))) reasons.push("missing_number");
  const allowed = new Set([...required, ...numbersIn(input.message), ...(input.doctorLine ? numbersIn(input.doctorLine) : [])]);
  if ([...own].some((n) => !allowed.has(n))) reasons.push("other_number");
  if (findForbiddenNumbers(t).length > 0) reasons.push("do_not_display_number");
  if (MEDICINE.test(t)) reasons.push("medicine");
  if (input.locale === "zh-Hans" ? !HAN.test(t) : HAN.test(t)) reasons.push("language");
  if (input.urgency === "if_worse" && !CONDITION.test(t)) reasons.push("not_conditional");
  if (t.length > CRISIS_WORDS_MAX_CHARS) reasons.push("too_long");
  return reasons;
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[a-z_]{1,32}$/.test(code)) return code;
  const name = (e as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" ? "deadline" : "error";
}

/**
 * The answer with Ripple's crisis lines in a person's words, or as it was (see the header). Never rejects and never takes
 * longer than its time.
 */
export async function voiceCrisis(input: CrisisWordsInput): Promise<{ sentences: Sentence[]; record: CrisisWordsRecord }> {
  const started = performance.now();
  const used = { calls: 0, tokens: 0 };
  const keep = (why: string, more: Partial<CrisisWordsRecord> = {}) => ({
    sentences: [...input.shown],
    record: { voiced: false, why, calls: used.calls, tokens: used.tokens, ms: Math.round(performance.now() - started), ...more },
  });
  if (input.route !== "emergency" && input.route !== "self_harm") return keep("not_this_route");
  const targets = input.shown.filter((s) => VOICED_TEMPLATES.includes(s.templateId ?? ""));
  if (targets.length === 0) return keep("nothing");
  const replaced = targets.map((s) => s.templateId!);
  if (input.offline) return keep(input.offline, { replaced });
  if (input.llm.provider === "mock" || input.llm.provider.startsWith("replay")) return keep("offline", { replaced });
  const policy = answerPolicy();
  if (!policy) return keep("no_policy", { replaced });

  const fixed = targets.map((s) => textOf(s, input.locale));
  const urgency = urgencyOf(replaced);
  const noted = notedWhen(
    targets.find((s) => s.templateId === "signal_recorded"),
    input.locale,
  );
  const doctor = input.shown.find((s) => s.sourceId.startsWith("visit:"));
  const doctorLine = doctor ? (input.locale === "zh-Hans" && doctor.translation?.text ? doctor.translation.text : doctor.en) : undefined;
  const payload: CrisisWordsPayload = {
    task: "crisis_words",
    locale: input.locale,
    message: input.message,
    kind: input.route,
    urgency,
    fixed,
    ...(doctorLine ? { doctorLine } : {}),
    noted,
    someoneElse: input.someoneElse,
  };
  const ms = Math.max(1, input.timeoutMs ?? CRISIS_WORDS_TIMEOUT_MS);
  let answer: string;
  try {
    used.calls++;
    const res = await input.llm.chat({
      system: `${policy}\n\n${CRISIS_FORMAT}`,
      user: JSON.stringify(payload),
      json: true,
      temperature: 0.3,
      maxTokens: 220,
      timeoutMs: ms,
      purpose: "crisis_words",
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
    });
    used.tokens += res.tokens;
    let body: unknown;
    try {
      body = parseModelJson(res.content);
    } catch {
      return keep("model_failed", { error: "bad_response", replaced });
    }
    const a = body && typeof body === "object" ? (body as { answer?: unknown }).answer : undefined;
    if (typeof a !== "string" || !a.trim()) return keep("empty", { replaced });
    answer = a.trim();
  } catch (e) {
    const code = errorCode(e);
    console.warn(`[crisis-words] the model did not answer (${code}); the fixed sentences stand`);
    return keep(code === "deadline" || code === "timeout" ? "time" : "model_failed", { error: code, replaced });
  }
  const reasons = guardCrisisWords(answer, { locale: input.locale, fixed, noted, message: input.message, doctorLine, urgency });
  if (reasons.length > 0) {
    console.warn(`[crisis-words] the model's words were dropped (${reasons.join(", ")}); the fixed sentences stand`);
    return keep("guard", { reasons, replaced });
  }
  // one sentence where the first fixed line stood, drawn as the line that carries the action (its templateId: the red card,
  // or Ripple's line with the 995 button; never as the plain "kept for your doctor" line), the other fixed lines left out
  const first = targets[0];
  const lead = targets.find((s) => s.templateId !== "signal_recorded") ?? first;
  const voiced: Sentence = { ...lead, en: answer, zh: answer, origin: "voiced" };
  const sentences: Sentence[] = [];
  for (const s of input.shown) {
    if (s === first) sentences.push(voiced);
    else if (!targets.includes(s)) sentences.push(s);
  }
  return { sentences, record: { voiced: true, replaced, calls: used.calls, tokens: used.tokens, ms: Math.round(performance.now() - started) } };
}
