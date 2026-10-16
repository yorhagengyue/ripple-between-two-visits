/**
 * The diet screen /p/diet and the daily diet check (journey 13; M16; 老人端提示词 13; e2e-chains 11). Server-only.
 *
 *   doctor     first: the doctor's own words about food, word for word, newest visit first (lib/diet/doctor.ts)
 *   check      the day's one question, only while there is such a line (lib/diet/check.ts); his answer today, if any
 *   week       the last 7 days' answers, counts only: the same line the brief carries (lib/diet/summary.ts)
 *   special    kidney disease or heart failure recorded: the fixed referral to his doctor or a dietitian comes first and
 *              the general lines are not listed (they are not written for a special diet); otherwise it is the last line
 *   official   the kb lines for the conditions recorded about him (hypertension, diabetes, high cholesterol), each with
 *              its publisher, page, the page's own date and the date we reviewed it (lib/diet/kb.ts)
 *   foods      the hawker dishes he picked (settings.diet_foods, track K's key) and the eating-out lines for each
 *   grapefruit only from his medicine's leaflet, only while amlodipine is on his list (kb/patient_text.json)
 *
 * dietCheckToday is Today's section data (track B mounts DietCheckSection): null when there is nothing to ask (no
 * doctor's diet line, or he answered today). answerDietCheck records his 有 / 没有 / 不记得 (one per day; answering again
 * changes it). setFoods keeps his picks on his account; a demo session (a judge's sandbox, the crew's session) keeps none
 * and shows no picker: its scope row is never written (only an account's settings are his to change).
 */
import { publish } from "@/lib/bus";
import { clipTime, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { getPatientText, getSource } from "@/lib/kb/load";
import { knownAboutHim, type ConditionId } from "@/lib/prevent/conditions";
import type { SessionRow, Store } from "@/lib/store/types";
import { ANSWER_WORDS, checkElementFor, isDietAnswer, sourceRefOf, type CheckElementId, type DietAnswer } from "./check";
import { doctorDietLines, type DoctorDietLine } from "./doctor";
import { dietKb, foodById, isDietCondition, lineText, linesForCondition, linesForFood, sourceOf, type DietCondition, type DietLine } from "./kb";
import { weeklyDietLine } from "./summary";
import { zhLookup, type ZhLookup } from "@/lib/translate/shown";

export const FOODS_KEY = "diet_foods";

/** The fixed referral for a special diet (M16: 特殊饮食（肾病、心衰等）一律转医生或营养师). Ripple's own sentence. */
export const SPECIAL_DIET: Record<Locale, string> = {
  "zh-Hans": "肾病、心衰这类要特别注意饮食的情况，吃什么请问医生或营养师。",
  en: "With kidney disease, heart failure or another condition that needs a special diet, ask your doctor or a dietitian what to eat.",
};

const CONDITION_NAMES: Record<DietCondition, Record<Locale, string>> = {
  hypertension: { "zh-Hans": "高血压", en: "High blood pressure" },
  diabetes: { "zh-Hans": "糖尿病", en: "Diabetes" },
  high_cholesterol: { "zh-Hans": "高胆固醇", en: "High cholesterol" },
};

const SPECIAL_CONDITIONS: readonly ConditionId[] = ["kidney_disease", "heart_disease"];

export interface DoctorWordsView {
  visitId: string;
  utteranceId: string;
  text: string;
  lang: "en" | "zh-Hans";
  /** 「8月29日」 */
  date: string;
  /** 「0:42」 */
  at: string;
  clipUrl: string | null;
  standIn: boolean;
  /** C2 track S (round 2; real-app 12): the checked Chinese of the doctor's English words (lib/translate/shown.ts), or null */
  zh?: string | null;
}

export interface OfficialLineView {
  id: string;
  text: string;
  source: { publisher: string; title: string; url: string; pageDate: string | null; reviewed: string };
}

export interface DietCheckData {
  /** the element asked about ("soup", ...) */
  item: CheckElementId;
  /** the fixed question in his language */
  question: string;
  /** the doctor's line it comes from, word for word */
  doctor: DoctorWordsView;
  /** the three answers' words: 有 / 没有 / 不记得 */
  answers: Record<DietAnswer, string>;
  /** his answer today, if he gave one */
  today: DietAnswer | null;
}

export interface DietView {
  doctor: DoctorWordsView[];
  check: DietCheckData | null;
  /** the last 7 days' answers in words (the brief's line), or null */
  week: string | null;
  special: { text: string; first: boolean };
  conditions: { id: DietCondition; name: string; lines: OfficialLineView[] }[];
  /** nothing recorded that the kb has lines for */
  noCondition: boolean;
  /** canPick: he can pick dishes here (an account; a demo session keeps no picks, so it shows no picker) */
  foods: { canPick: boolean; all: { id: string; name: string; picked: boolean }[]; picked: { id: string; name: string; lines: OfficialLineView[] }[] };
  grapefruit: { text: string; source: { title: string; url: string; pageDate: string | null } } | null;
}

function words(line: DoctorDietLine, locale: Locale, zh?: ZhLookup): DoctorWordsView {
  return { visitId: line.visitId, utteranceId: line.utteranceId, text: line.text, lang: line.lang, date: shortDay(locale, line.visitDate), at: clipTime(line.tStartMs), clipUrl: line.clipUrl, standIn: line.standIn, zh: zh?.(line.text) ?? null };
}

function official(line: DietLine, locale: Locale): OfficialLineView {
  const s = sourceOf(line);
  return { id: line.id, text: lineText(line, locale), source: { publisher: s.publisher, title: s.title, url: s.url, pageDate: s.page_date, reviewed: s.reviewed } };
}

export function pickedFoods(scope: Pick<SessionRow, "settings">): string[] {
  const raw = scope.settings?.[FOODS_KEY];
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && !!foodById(x)) : [];
}

function checkOf(lines: DoctorDietLine[], todayRows: { item: string; answer: string }[], locale: Locale, zh?: ZhLookup): DietCheckData | null {
  const line = lines[0];
  if (!line) return null;
  const el = checkElementFor(line.text);
  const mine = todayRows.find((r) => r.item === el.id);
  return { item: el.id, question: el.question[locale], doctor: words(line, locale, zh), answers: ANSWER_WORDS[locale], today: mine && isDietAnswer(mine.answer) ? mine.answer : null };
}

/** He takes amlodipine (any row naming it on his list): the leaflet's grapefruit line applies. */
async function grapefruitLine(store: Store, scope: SessionRow, locale: Locale): Promise<DietView["grapefruit"]> {
  const meds = await store.listMeds(scope.id);
  const on = meds.some((m) => m.drug_id === "amlodipine" && m.status !== "unidentified" && (m.start_day === null || m.start_day <= scope.story_day));
  if (!on) return null;
  const entry = getPatientText("amlodipine.grapefruit");
  const src = entry ? getSource(entry.source_id) : null;
  if (!entry || !src) return null;
  // the page's own review date, as the kb noted it ("Article last reviewed 02 March 2026 (...)")
  const reviewed = /reviewed\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(src.page_date ?? "")?.[1] ?? null;
  return { text: locale === "zh-Hans" ? entry.zh : entry.en, source: { title: src.title, url: src.url, pageDate: reviewed } };
}

export async function dietView(store: Store, scope: SessionRow, locale: Locale): Promise<DietView> {
  const day = scope.story_day;
  const [lines, known, todayRows, week, grapefruit, zh] = await Promise.all([
    doctorDietLines(store, scope),
    knownAboutHim(store, scope),
    store.listDietChecks(scope.id, { fromDay: day, toDay: day }),
    weeklyDietLine(store, scope, locale),
    grapefruitLine(store, scope, locale),
    // C2 track S (round 2): the checked Chinese under the doctor's English words
    zhLookup(store, scope, { locale }),
  ]);
  const special = known.conditions.some((c) => SPECIAL_CONDITIONS.includes(c.id));
  const dietConditions = [...new Set(known.conditions.map((c) => c.id).filter(isDietCondition))];
  const picked = pickedFoods(scope);
  // a dish's lines: the eating-out ones, and a condition's own only when that condition is his; a line already listed
  // under his condition is not repeated under the dish
  const shownForCondition = new Set(special ? [] : dietConditions.flatMap((c) => linesForCondition(c).map((l) => l.id)));
  const forFood = (food: string) => linesForFood(food).filter((l) => (l.conditions.length === 0 || l.conditions.some((c) => dietConditions.includes(c))) && !shownForCondition.has(l.id));
  return {
    doctor: lines.map((l) => words(l, locale, zh)),
    check: checkOf(lines, todayRows, locale, zh),
    week: week?.text ?? null,
    special: { text: SPECIAL_DIET[locale], first: special },
    conditions: special ? [] : dietConditions.map((id) => ({ id, name: CONDITION_NAMES[id][locale], lines: linesForCondition(id).map((l) => official(l, locale)) })),
    noCondition: dietConditions.length === 0,
    foods: {
      canPick: scope.kind === "account",
      all: dietKb().foods.map((f) => ({ id: f.id, name: locale === "zh-Hans" ? f.zh : f.en, picked: picked.includes(f.id) })),
      picked: special ? [] : picked.map((id) => ({ id, name: (locale === "zh-Hans" ? foodById(id)?.zh : foodById(id)?.en) ?? id, lines: forFood(id).map((l) => official(l, locale)) })),
    },
    grapefruit,
  };
}

/** Today's diet section: the day's question while there is a doctor's diet line and no answer today, else null. */
export async function dietCheckToday(store: Store, scope: SessionRow, locale: Locale): Promise<DietCheckData | null> {
  const day = scope.story_day;
  const [lines, todayRows, zh] = await Promise.all([doctorDietLines(store, scope), store.listDietChecks(scope.id, { fromDay: day, toDay: day }), zhLookup(store, scope, { locale })]);
  const check = checkOf(lines, todayRows, locale, zh);
  return check && check.today === null ? check : null;
}

export type DietAnswerResult = { ok: true; item: CheckElementId; answer: DietAnswer } | { ok: false; status: 409; error: "no_diet_check" };

/** His answer to today's question (answering again the same day changes it). Publishes diet.checked (no words). */
export async function answerDietCheck(store: Store, scope: SessionRow, answer: DietAnswer): Promise<DietAnswerResult> {
  const line = (await doctorDietLines(store, scope))[0];
  if (!line) return { ok: false, status: 409, error: "no_diet_check" };
  const el = checkElementFor(line.text);
  await store.setDietCheck(scope.id, { day: scope.story_day, item: el.id, answer, source_ref: sourceRefOf(line) });
  publish(scope.id, "diet.checked", "He answered today's food check.", { item: el.id });
  return { ok: true, item: el.id, answer };
}

/**
 * His hawker dishes (ids from kb/diet.json foods; unknown ids dropped), kept in his account's settings. null: nothing
 * kept, the scope is not an account (a demo session's scope row is never written: updateScope is an account's own).
 */
export async function setFoods(store: Store, scope: SessionRow, foods: string[]): Promise<string[] | null> {
  if (scope.kind !== "account") return null;
  const keep = [...new Set(foods)].filter((f) => !!foodById(f));
  await store.updateScope(scope.id, { settings: { [FOODS_KEY]: keep } });
  return keep;
}
