/**
 * The prevention screen /p/prevent (journey 11; M10; 老人端提示词 11; e2e-chains 9). Server-only.
 *
 *   next        the next planned visit (track B's nextPlannedVisit) and how many questions wait for it
 *   doctor      first: what the doctor said about tests and follow-ups at his last clinic visit, word for word with
 *               its date, time point and clip (a confirmed test / follow_up item, or the confirmed line itself; the
 *               example account has only the transcript). 「我做过了」 only: the doctor already asked for it.
 *   table       the table's lines that apply to his age and recorded conditions (lib/prevent/items.ts), each our own
 *               words with the table, version and official page; 「加进问题单」 and 「我做过了」 under each. Cardiovascular
 *               screening switches to 「由你的医生跟进」 with the reason (his profile fact, or the doctor's words).
 *   done        what he marked done, with the date (a yearly line comes back a year later)
 *   caveat      the NAIS line: what suits him and any subsidy is his doctor's to say (C2-12)
 *   noAge       his profile has no age yet: the age-based lines wait (nothing is guessed)
 *
 * His actions (preventAction): done (prevent_done, his tap; source "patient"), undo (that record removed), ask (a
 * question for the doctor, origin preventive, through track C's addQuestionFor: the same words never twice).
 */
import { clipTime, shortDay } from "@/lib/daily/i18n";
import { openQuestionCount } from "@/lib/daily/questions";
import { confirmedClinicianLines, type SaidLine } from "@/lib/chat/said";
import { publish } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { addQuestionFor, questionKey } from "@/lib/profile/questions";
import { scopeD0 } from "@/lib/store/scope";
import type { PreventDoneRow, QuestionRow, SessionRow, Store, VisitItemRow, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { nextPlannedVisit } from "@/lib/summary/account-brief";
import { isClinicVisit } from "@/lib/summary/window";
import { happenedVisits } from "@/lib/visit/happened";
import { knownAboutHim, type KnownCondition } from "./conditions";
import { CARDIO, CARDIO_DIAGNOSES, CARDIO_FOLLOWED, CAVEAT, PREVENT_ITEMS, type PreventItem, type PreventSource } from "./items";
import { zhLookup, type ZhLookup } from "@/lib/translate/shown";

/** A doctor's line as the screen quotes it. */
export interface DoctorQuote {
  visitId: string;
  utteranceId: string;
  text: string;
  lang: "en" | "zh-Hans";
  date: string;
  at: string;
  clipUrl: string | null;
  standIn: boolean;
  /** C2 track S (round 2; real-app 12): the checked Chinese of the doctor's English words (lib/translate/shown.ts), or null */
  zh?: string | null;
}

export interface SourceView {
  name: string;
  url: string;
  version: string;
}

export interface PreventRow {
  /** the kb row id ("C2-03"), or "doctor:<visit>:<utterance>" for the doctor's own words */
  id: string;
  kind: "doctor" | "vaccine" | "screening";
  title: string;
  /** what the table lists, our words (table rows) */
  table: string | null;
  source: SourceView | null;
  /** the doctor's words (doctor rows), or the reason a table row switched (cardiovascular, from a visit) */
  doctor: DoctorQuote | null;
  /** cardiovascular screening once he is diagnosed: 「由你的医生跟进」 and the table's words for it */
  followed: { status: string; table: string; source: SourceView; fact: string | null } | null;
  /** he marked it done, and when (YYYY-MM-DD) */
  done: { id: string; date: string } | null;
  /** a line that comes back: when he last marked it done */
  lastDone: string | null;
  /** its question is on his list (open or answered) */
  questionId: string | null;
  /** the question 「加进问题单」 adds (table rows) */
  canAsk: boolean;
}

export interface PreventView {
  age: number | null;
  next: { date: string; days: number; place: string; questions: number } | null;
  doctor: PreventRow[];
  table: PreventRow[];
  done: PreventRow[];
  caveat: { text: string; source: SourceView };
  noAge: boolean;
}

/** A test or a follow-up in a doctor's words (blood test, scan, "come back", "see me"). */
const TEST_WORDS = /\b(?:blood tests?|urine tests?|tests?|scan|x-?rays?|ECG|check-?up|come back|see me|follow[- ]?up)\b|验血|验尿|化验|检查|复诊|回来/i;

const src = (s: PreventSource, locale: Locale): SourceView => ({ name: s.name[locale], url: s.url, version: s.version[locale] });

function quote(line: SaidLine, locale: Locale, zh?: ZhLookup): DoctorQuote {
  return { visitId: line.visitId, utteranceId: line.utteranceId, text: line.text, lang: line.lang, date: shortDay(locale, line.visitDate), at: clipTime(line.tStartMs), clipUrl: line.clipUrl, standIn: line.standIn, zh: zh?.(line.text) ?? null };
}

const markedOff = (it: VisitItemRow) => it.slots?.superseded === true || it.slots?.rejected === true || it.slots?.disputed === true;

/** The doctor's words about tests and follow-ups at his last clinic visit that happened (newest visit only). */
async function doctorTestLines(store: Store, scope: SessionRow, lines: SaidLine[], visits: VisitRow[]): Promise<SaidLine[]> {
  const happened = (await happenedVisits(store, scope.id, visits)).filter((v) => v.day <= scope.story_day && isClinicVisit(v));
  const last = happened.sort((a, b) => b.day - a.day)[0];
  if (!last) return [];
  const items = (await store.listVisitItems(scope.id, { visit_id: last.id })).filter((it) => (it.type === "test" || it.type === "follow_up") && !markedOff(it));
  const fromItems = new Set(items.flatMap((it) => it.utterance_ids ?? []));
  return lines.filter((l) => l.visitId === last.id && l.role === "doctor" && (fromItems.has(l.utteranceId) || (TEST_WORDS.test(l.text) && !/[?？]\s*$/.test(l.text.trim()))));
}

function latestDone(rows: PreventDoneRow[], id: string): PreventDoneRow | null {
  return rows.filter((r) => r.item_id === id).sort((a, b) => b.day - a.day || b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function questionFor(questions: QuestionRow[], text: string): QuestionRow | null {
  const k = questionKey(text);
  return questions.find((q) => q.for === "doctor" && !q.merged_into && q.status !== "skipped" && questionKey(q.text) === k) ?? null;
}

export async function preventView(store: Store, scope: SessionRow, locale: Locale): Promise<PreventView> {
  const d0 = scopeD0(scope);
  const today = scope.story_day;
  const [known, lines, visits, doneRows, questions, waiting, zh] = await Promise.all([
    knownAboutHim(store, scope),
    confirmedClinicianLines(store, scope, { roles: ["doctor"] }),
    store.listVisits(scope.id),
    store.listPreventDone(scope.id),
    store.listQuestions(scope.id),
    openQuestionCount(store, scope),
    // C2 track S (round 2): the checked Chinese under the doctor's English words
    zhLookup(store, scope, { locale }),
  ]);
  const conditions = new Set(known.conditions.map((c) => c.id));
  const person = { age: known.age, conditions };

  const doneOf = (id: string, everyDays: number | null) => {
    const r = latestDone(doneRows, id);
    if (!r) return { done: null, lastDone: null };
    const current = everyDays === null || today - r.day < everyDays;
    return current ? { done: { id: r.id, date: storyDate(d0, r.day) }, lastDone: null } : { done: null, lastDone: storyDate(d0, r.day) };
  };

  const doctor: PreventRow[] = (await doctorTestLines(store, scope, lines, visits)).map((l) => {
    const id = `doctor:${l.visitId}:${l.utteranceId}`;
    return { id, kind: "doctor", title: l.text, table: null, source: null, doctor: quote(l, locale, zh), followed: null, ...doneOf(id, null), questionId: null, canAsk: false };
  });

  const tableRow = (item: PreventItem): PreventRow => {
    const q = questionFor(questions, item.question[locale]) ?? questionFor(questions, item.question[locale === "en" ? "zh-Hans" : "en"]);
    return { id: item.id, kind: item.kind, title: item.title[locale], table: item.table[locale], source: src(item.source, locale), doctor: null, followed: null, ...doneOf(item.id, item.everyDays), questionId: q?.id ?? null, canAsk: true };
  };

  const table: PreventRow[] = [];
  for (const item of PREVENT_ITEMS) {
    if (item.id === CARDIO.id && known.age !== null && known.age >= 40 && CARDIO_DIAGNOSES.some((c) => conditions.has(c))) {
      const why: KnownCondition = known.conditions.find((c) => CARDIO_DIAGNOSES.includes(c.id))!;
      table.push({
        id: CARDIO_FOLLOWED.id,
        kind: "screening",
        title: CARDIO.title[locale],
        table: null,
        source: null,
        doctor: why.line ? quote(why.line, locale, zh) : null,
        followed: { status: CARDIO_FOLLOWED.status[locale], table: CARDIO_FOLLOWED.table[locale], source: src(CARDIO_FOLLOWED.source, locale), fact: why.from === "profile" ? why.text : null },
        done: null,
        lastDone: null,
        questionId: null,
        canAsk: false,
      });
      continue;
    }
    if (item.applies(person)) table.push(tableRow(item));
  }

  const next = nextPlannedVisit(visits, storyDate(d0, today), d0);
  const all = [...doctor, ...table];
  return {
    age: known.age,
    next: next ? { ...next, questions: waiting } : null,
    doctor: doctor.filter((r) => !r.done),
    table: table.filter((r) => !r.done),
    done: all.filter((r) => r.done),
    caveat: { text: CAVEAT.text[locale], source: src(CAVEAT.source, locale) },
    noAge: known.age === null,
  };
}

export type PreventAction = "done" | "undo" | "ask";

export type PreventActionResult =
  | { ok: true; action: PreventAction; doneId?: string; questionId?: string; outcome?: string }
  | { ok: false; status: 404 | 409; error: "item_not_found" | "not_listed" | "not_done" };

/** His 「我做过了」 / undo / 「加进问题单」 on one line of the screen as it is now. */
export async function preventAction(store: Store, scope: SessionRow, itemId: string, action: PreventAction, locale: Locale): Promise<PreventActionResult> {
  const view = await preventView(store, scope, locale);
  const row = [...view.doctor, ...view.table, ...view.done].find((r) => r.id === itemId);
  if (!row) return { ok: false, status: 404, error: "item_not_found" };
  if (action === "undo") {
    if (!row.done) return { ok: false, status: 409, error: "not_done" };
    await store.deletePreventDone(scope.id, row.done.id);
    publish(scope.id, "prevent.changed", "His prevention list changed.", { item_id: itemId, action: "undo" });
    return { ok: true, action };
  }
  if (row.followed) return { ok: false, status: 409, error: "not_listed" };
  if (action === "done") {
    if (row.done) return { ok: true, action, doneId: row.done.id };
    const rec = await store.addPreventDone(scope.id, { item_id: itemId, day: scope.story_day, source: "patient", visit_item_id: null, note: null });
    publish(scope.id, "prevent.done", "He marked a prevention item as done.", { item_id: itemId });
    return { ok: true, action, doneId: rec.id };
  }
  // ask
  const item = PREVENT_ITEMS.find((i) => i.id === itemId);
  if (!item || !row.canAsk) return { ok: false, status: 409, error: "not_listed" };
  const r = await addQuestionFor(store, scope, { for: "doctor", origin: "preventive", text: item.question[locale], lang: locale, evidence: JSON.stringify({ kind: "prevent", item: item.id }) });
  return { ok: true, action, questionId: r.question.id, outcome: r.outcome };
}
