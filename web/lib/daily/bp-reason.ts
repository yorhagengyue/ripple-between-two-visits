/**
 * What happened on the day of a reading outside his doctor's target (owner 10-15, the demo video's second scene: he
 * records 152/96, the screen says it is outside the target his doctor set, he holds a button and says 「今天打太极，所以没
 * 怎么吃午饭」; Ripple keeps that as the reason, shows it on the day in both calendars, and puts one question for the next
 * visit on his list). Server-only.
 *
 *   saveReadingReason   his words, exactly as heard (or typed), become one of his notes tied to the reading by its id
 *                       (lib/daily/bp-target.ts reasonNoteId: the note table has no reading column, so no migration),
 *                       dated on the reading's day; note.logged goes on the bus. Then one question for his doctor goes on
 *                       his list (lib/profile/questions.ts addQuestionFor, origin "reading"; its evidence names the
 *                       reading and the note). Said again about the same reading: another note, and the question that is
 *                       still open and in Ripple's words is written again from the newest words (one question per reading).
 *   readingQuestion     the question: written by the main model from the reading, his words and the doctor's target, in
 *                       the language of his phone (his words stay as he said them in the note), short, in the first
 *                       person, as his own question. A question that fails a check is asked for once more, with the
 *                       words that were not allowed named (never his words); then the fixed template below. The template
 *                       too when there is no consent to AI processing, on the offline mock, with the day's spend used up,
 *                       or when the model fails.
 *   questionProblems    the checks every question goes through before it is kept, the model's and the template's alike
 *                       (the safety layer's rules for a sentence Ripple words itself, lib/safety/judgement.ts
 *                       modelWordingHits: nothing judges the reading, compares it, reassures, names a cause or a dose
 *                       change; no directive; no medicine named; no number that is not the reading's, the target's, their
 *                       dates' or his own; no number that must never be shown; a question, in the phone's language). His
 *                       own words, quoted whole, are his and are not checked as Ripple's.
 *
 * Which readings: only one outside the target he confirmed (lib/daily/bp-target.ts outsideTarget, the rule his month, her
 * month and her 「留意」 use); never the 180 warning line's, which keeps track S's relay (lib/safety/threshold.ts).
 */
import { randomBytes } from "node:crypto";
import { publish } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { mentionedDrugIds } from "@/lib/kb/match";
import { parseModelJson } from "@/lib/llm/json";
import type { LlmClient } from "@/lib/llm/types";
import { addQuestionFor, cleanQuestionText, QUESTION_TEXT_MAX, type AddOutcome } from "@/lib/profile/questions";
import { directiveHits } from "@/lib/safety/directive";
import { findForbiddenNumbers } from "@/lib/safety/forbidden";
import { JUDGEMENT_WORDS, modelWordingHits } from "@/lib/safety/judgement";
import { detectLang, digitRuns, hasHan } from "@/lib/safety/text";
import { scopeD0 } from "@/lib/store/scope";
import type { BpReadingRow, NoteRow, NoteSource, QuestionRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { doctorNumbers } from "@/lib/visit/doctor-numbers";
import { isReasonNoteOf, outsideTarget, reasonNoteId, targetRule } from "./bp-target";
import { dayWords } from "./doses";
import { shortDay } from "./i18n";
import { doctorWords, visitDetail } from "./visit-details";

/** His words about one reading: at most this many characters (what the spoken question route gives back is 500). */
export const REASON_MAX = 500;
/** How many times one reading can be talked about (each is a note). */
export const REASONS_PER_READING = 10;
/** His words inside the template question are cut to this many characters. */
const QUOTE_MAX = 160;

export class ReasonError extends Error {
  constructor(readonly code: "empty" | "too_long" | "not_found" | "not_outside_target" | "too_many") {
    super(code);
    this.name = "ReasonError";
  }
}

/** What the question is written from. */
export interface ReasonFacts {
  reading: { systolic: number; diastolic: number };
  /** the reading's date, YYYY-MM-DD */
  date: string;
  /** his words, as heard */
  words: string;
  target: {
    systolic: number;
    diastolic: number;
    /** the date of the visit the doctor gave it at, YYYY-MM-DD */
    date: string;
    /** the doctor's name as a sentence says it (「林医生」 / "Dr Lim"), or null when the record has none */
    doctor: string | null;
  };
}

export type QuestionBy = "model" | "template";

export interface ReadingQuestion {
  text: string;
  lang: Locale;
  by: QuestionBy;
  /** why the template was used: no_model (no consent, the offline mock, the day's spend), model_failed, checks */
  why: "no_model" | "model_failed" | "checks" | null;
}

// ---------------------------------------------------------------- the template

const reading = (f: Pick<ReasonFacts, "reading">) => `${f.reading.systolic}/${f.reading.diastolic}`;

/** His words as the template quotes them: one line, cut at QUOTE_MAX characters. */
export function quotedWords(words: string): string {
  const w = words.replace(/\s+/g, " ").trim();
  const chars = [...w];
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX - 1).join("")}…` : w;
}

/** The fixed question (no model): the day, the reading, his words quoted whole, and what he asks. */
export function templateQuestion(f: ReasonFacts, locale: Locale): string {
  const w = quotedWords(f.words);
  return locale === "zh-Hans"
    ? `${shortDay(locale, f.date)}我量的血压是 ${reading(f)}，我记下的是：「${w}」像这样的日子，我该怎么做？要怎么安排？`
    : `On ${shortDay(locale, f.date)} my blood pressure reading was ${reading(f)}. I noted: “${w}” On a day like that, what should I do, and how should I arrange my day?`;
}

// ---------------------------------------------------------------- the checks

const MED_WORDS = /\b(?:tablets?|pills?|doses?|dosage|medicines?|medications?|drugs?|capsules?|prescriptions?)\b|药|剂量|胶囊|处方/i;
/** Asking what caused the reading (the vocabulary has "because of", "due to", 因为; a question also says "why", 为什么). */
const CAUSE_WORDS = /\b(?:because|why)\b|为什么|为何/i;

/** The numbers a question may carry: the reading's, the target's, the two dates', and any in his own words. */
function allowedNumbers(f: ReasonFacts): Set<string> {
  const parts = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? [m[1], String(Number(m[2])), String(Number(m[3]))] : [];
  };
  return new Set(
    [f.reading.systolic, f.reading.diastolic, f.target.systolic, f.target.diastolic, ...parts(f.date), ...parts(f.target.date), ...digitRuns(f.words)].map((n) => String(Number(n))),
  );
}

/**
 * What is wrong with a question before it may go on his list (empty: nothing). `quoted`: his own words, which may stand in
 * it whole and are then left out of the checks on Ripple's wording.
 */
export function questionProblems(text: string, f: ReasonFacts, locale: Locale, opts: { quoted?: string | null } = {}): string[] {
  const t = text.trim();
  if (!t) return ["empty"];
  const out: string[] = [];
  const quoted = opts.quoted?.trim();
  const own = quoted && t.includes(quoted) ? t.split(quoted).join(" ") : t;
  if (/[\r\n]/.test(t)) out.push("newline");
  if (!/[?？]\s*$/.test(t)) out.push("not_a_question");
  if (locale === "zh-Hans" ? !hasHan(own) : hasHan(own)) out.push("language");
  // Ripple's own words are short; with his words quoted whole the question still fits his list (QUESTION_TEXT_MAX)
  if ([...own].length > (locale === "zh-Hans" ? 120 : 280) || [...t].length > QUESTION_TEXT_MAX) out.push("too_long");
  for (const h of modelWordingHits(own)) out.push(`word:${h.category}`);
  if (CAUSE_WORDS.test(own)) out.push("word:causation");
  for (const h of directiveHits(own)) out.push(`directive:${h.pattern.startsWith("builtin:") ? h.pattern : "glossary"}`);
  if (findForbiddenNumbers(t).length) out.push("forbidden_number");
  if (mentionedDrugIds(own).length || MED_WORDS.test(own)) out.push("medicine");
  const allowed = allowedNumbers(f);
  for (const run of digitRuns(own)) if (!allowed.has(String(Number(run)))) out.push("number");
  return [...new Set(out)];
}

// ---------------------------------------------------------------- the model

/** How many times the model is asked for a question that passes the checks before the template is used. */
export const QUESTION_TRIES = 2;

/** What was wrong with the model's last question, for its next try: the vocabulary words it used and the other problems. */
export function retryNote(q: string, f: ReasonFacts, locale: Locale, problems: readonly string[]): string {
  const quoted = f.words.trim();
  const own = quoted && q.includes(quoted) ? q.split(quoted).join(" ") : q;
  const words = [...new Set([...modelWordingHits(own).map((h) => h.word), ...(own.match(new RegExp(CAUSE_WORDS.source, "gi")) ?? []), ...(own.match(new RegExp(MED_WORDS.source, "gi")) ?? [])])];
  const why: string[] = [];
  if (words.length) why.push(`it used words that are not allowed (${words.join(", ")})`);
  if (problems.includes("not_a_question")) why.push("it did not end with a question mark");
  if (problems.includes("language")) why.push(`it was not in ${locale === "zh-Hans" ? "Simplified Chinese" : "English"}`);
  if (problems.includes("number")) why.push("it had a number that is not the reading's, the target's or a date's");
  if (problems.includes("too_long")) why.push("it was too long");
  if (problems.includes("empty") || problems.includes("newline") || problems.includes("forbidden_number") || problems.some((x) => x.startsWith("directive"))) why.push("it did not follow the rules");
  return `Your last question could not be used: ${why.join("; ") || "it did not follow the rules"}. Write it again, following every rule.`;
}

function prompt(f: ReasonFacts, locale: Locale): { system: string; user: string } {
  const zh = locale === "zh-Hans";
  const banned = [...new Set(Object.values(JUDGEMENT_WORDS[zh ? "zh" : "en"]).flat())];
  const system = [
    "You help an older man write ONE short question that he will ask his own doctor at his next visit.",
    `Write it in ${zh ? "Simplified Chinese" : "English"}, in the first person, as his own question. ${zh ? "At most 60 Chinese characters." : "At most 35 words."}`,
    "It must be one question that ends with a question mark. It asks the doctor what he should do, or how he should arrange his day, on days like the one he described.",
    "Use only the facts given: the reading as written (for example 152/96), the date, and what he said happened that day (you may restate it in your own words in the question's language).",
    "Never answer the question and never give advice.",
    "Never say whether the reading is high, low, normal, good, bad or dangerous, and never compare it with any number.",
    "Never mention any medicine, tablet, pill or dose, and never suggest taking, skipping, stopping or changing one.",
    "Never say or ask what caused the reading.",
    `Do not use any of these words: ${banned.join(zh ? "、" : ", ")}.`,
    zh
      ? "说他吃得少时，用「没怎么吃」「吃得很少」这样的话，不用「少吃」「不吃」「跳过」。"
      : "When you say he ate little, write plainly, such as 'did not eat much lunch' or 'ate very little'; never the word 'skip' (even for a meal), 'only' or 'just'.",
    zh
      ? '形式的例子（另一个人、另一天，不要照抄）：{"question": "我早上在花园干活、早饭吃得晚的日子，该怎么做？早上要怎么安排？"}'
      : 'An example of the form (another man, another day; do not copy it): {"question": "On days I work in the garden all morning and have a late breakfast, what should I do, and how should I plan those mornings?"}',
    'Reply with JSON only: {"question": "..."}',
  ].join("\n");
  const user = JSON.stringify({
    reading: reading(f),
    date: shortDay(locale, f.date),
    his_words: f.words,
    doctor_target: `${f.target.systolic}/${f.target.diastolic}`,
    target_given_by: f.target.doctor ?? (zh ? "医生" : "his doctor"),
    target_given_on: shortDay(locale, f.target.date),
  });
  return { system, user };
}

/**
 * The question for his list (see the header). `llm` null: the fixed template at once (no consent to AI processing, the
 * offline mock, the day's spend used up); the caller decides that and settles the spend. Never throws: a model that fails,
 * or a question that fails a check, gives the template. Logs reasons only, never his words or the question.
 */
export async function readingQuestion(f: ReasonFacts, locale: Locale, llm: LlmClient | null): Promise<ReadingQuestion> {
  const template = (why: ReadingQuestion["why"]): ReadingQuestion => ({ text: templateQuestion(f, locale), lang: locale, by: "template", why });
  if (!llm) return template("no_model");
  try {
    const { system, user } = prompt(f, locale);
    let ask = user;
    for (let attempt = 1; attempt <= QUESTION_TRIES; attempt++) {
      const res = await llm.chat({ system, user: ask, json: true, temperature: 0.3, maxTokens: 300, timeoutMs: 12_000, purpose: "other" });
      const parsed = parseModelJson(res.content) as { question?: unknown } | null;
      const q = typeof parsed?.question === "string" ? parsed.question.replace(/\s+/g, " ").trim() : "";
      const problems = questionProblems(q, f, locale, { quoted: f.words });
      if (!problems.length) return { text: q, lang: locale, by: "model", why: null };
      console.warn(`[bp-reason] the model's question did not pass the checks (try ${attempt} of ${QUESTION_TRIES}): ${problems.slice(0, 6).join(", ")}`);
      // once more, told what was wrong: the words of the vocabulary it used, never his words or the question
      ask = `${user}\n\n${retryNote(q, f, locale, problems)}`;
    }
    return template("checks");
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.warn(`[bp-reason] no question from the model (${typeof code === "string" ? code : "error"}); the fixed question is used`);
    return template("model_failed");
  }
}

// ---------------------------------------------------------------- his words, kept

/** The question this reading put on his list (its evidence names the reading), or null. */
export function questionOfReading(questions: readonly QuestionRow[], readingId: string): QuestionRow | null {
  for (const q of questions) {
    if (q.origin !== "reading" || q.merged_into || !q.evidence) continue;
    try {
      const e = JSON.parse(q.evidence) as { kind?: unknown; reading?: unknown };
      if (e.kind === "reading" && e.reading === readingId) return q;
    } catch {
      /* not this kind of evidence */
    }
  }
  return null;
}

export type ReasonOutcome = AddOutcome | "updated" | "kept";

export interface SavedReason {
  note: NoteRow;
  reading: BpReadingRow;
  question: { id: string; text: string; lang: string | null; outcome: ReasonOutcome; by: QuestionBy | null };
}

/**
 * His words about a reading outside his doctor's target: kept as his note, and one question for his doctor (see the
 * header). `locale`: the phone's language, the question's. `llm`: null for the fixed question (see readingQuestion).
 * Throws ReasonError for words that are empty or too long, a reading that is not his (or not recorded), one that is not
 * outside the target he confirmed, and a reading talked about too often.
 */
export async function saveReadingReason(
  store: Store,
  scope: SessionRow,
  input: { readingId: string; text: string; source?: NoteSource },
  deps: { locale: Locale; llm: LlmClient | null; publish?: typeof publish },
): Promise<SavedReason> {
  const pub = deps.publish ?? publish;
  const words = input.text.replace(/\s+/g, " ").trim();
  if (!words) throw new ReasonError("empty");
  if ([...words].length > REASON_MAX) throw new ReasonError("too_long");
  const [rows, numbers, notes, questions] = await Promise.all([
    store.listBp(scope.id),
    doctorNumbers(store, scope.id, { day: scope.story_day, time: scope.story_time ?? null }),
    store.listNotes(scope.id),
    store.listQuestions(scope.id),
  ]);
  const reading = rows.find((r) => r.id === input.readingId && r.state === "recorded" && !r.deleted_at);
  if (!reading || reading.systolic === null || reading.diastolic === null) throw new ReasonError("not_found");
  const target = numbers.target;
  const rule = targetRule(target);
  if (!target || !rule || !outsideTarget(reading, rule)) throw new ReasonError("not_outside_target");
  if (notes.filter((n) => isReasonNoteOf(n, reading.id)).length >= REASONS_PER_READING) throw new ReasonError("too_many");

  // his words, as heard, dated on the reading's day: the note table has no reading column, the note's id names it
  const note = await store.addNote(scope.id, {
    id: reasonNoteId(reading.id, randomBytes(4).toString("hex")),
    day: reading.day,
    text: words,
    source: input.source ?? "voice_note",
    lang: detectLang(words),
    app_reply: "logged only",
  });
  const short = note.text.length > 80 ? `${note.text.slice(0, 79)}…` : note.text;
  pub(scope.id, "note.logged", `Noted for ${dayWords(scope, reading.day)} (what happened, about the reading ${reading.systolic}/${reading.diastolic}): "${short}"`, { note, reading_id: reading.id });

  const facts: ReasonFacts = {
    reading: { systolic: reading.systolic, diastolic: reading.diastolic },
    date: storyDate(scopeD0(scope), reading.day),
    words,
    target: { systolic: rule.systolic, diastolic: rule.diastolic, date: target.visitDate, doctor: doctorWords(visitDetail(scope, target.visitId).doctor, deps.locale, "short") },
  };
  const evidence = (by: QuestionBy) => JSON.stringify({ kind: "reading", reading: reading.id, note: note.id, by });
  const before = questionOfReading(questions, reading.id);
  if (before && !(before.status === "open" && !before.edited_at)) {
    // he changed its words himself, set it aside, or the doctor answered it: it stays as it is
    return { note, reading, question: { id: before.id, text: before.text, lang: before.lang, outcome: "kept", by: null } };
  }
  const q = await readingQuestion(facts, deps.locale, deps.llm);
  const text = cleanQuestionText(q.text);
  if (before) {
    const row = await store.updateQuestion(scope.id, before.id, { text, lang: q.lang, evidence: evidence(q.by) });
    pub(scope.id, "question.updated", `His question for the doctor, written again from what he said about ${reading.systolic}/${reading.diastolic}`, { question: { ...row, evidence: undefined } });
    return { note, reading, question: { id: row.id, text: row.text, lang: row.lang, outcome: "updated", by: q.by } };
  }
  const added = await addQuestionFor(store, scope, { for: "doctor", origin: "reading", text, lang: q.lang, evidence: evidence(q.by) });
  return { note, reading, question: { id: added.question.id, text: added.question.text, lang: added.question.lang, outcome: added.outcome, by: q.by } };
}
