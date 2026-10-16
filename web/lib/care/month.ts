/**
 * Her month calendar on a real account (/f/month?link=&m=&d=; owner 10-14: 「日历页面应该是一份月份的日历，而周和主页
 * 重复了」, laid out as the iOS app's calendar). Server-only, read only: nothing here writes to his space (the
 * access-log row is the page's, lib/care/access-log.ts) and nothing settles a window.
 *
 *   monthAt(ask, today, first)                      which month and which day the address means, held inside what she
 *                                                   may page through: his first day on Ripple to the current month
 *   familyMonth(store, scope, grants, ask, nowMs)   the month's cells (one per day, with the markers she may see) and
 *                                                   the chosen day's records, each kind only while its switch is on
 *
 * What a switch shows here (the rule of 10-14: a switch that is on shows that kind in full):
 *   dose_summary        a day's mark, the same one as her week (lib/care/home.ts dayMark over lib/daily/cells.ts
 *                       buildDoseDay), and on the chosen day each medicine by name with his answer, the time he tapped
 *                       and the reason he gave for 「没吃」
 *   bp_summary          a marker on a day with a recorded reading, and on the chosen day each reading with its numbers
 *   questions_count     the days of his visits, planned and past, with where and what kind of visit (the next visit's
 *                       date and place ride on this switch on her home), and on the chosen day the questions he put on
 *                       his list that day, in their words
 *   visit_transcripts   the days of his visits too (with where and what kind), and on the chosen day how many of the
 *                       clinicians' lines he confirmed at a visit that happened; the page links to its record
 *   notes               (owner 10-15, the demo video's second scene) on the chosen day his notes in his own words, and
 *                       under a reading what he said happened that day (lib/daily/bp-target.ts: a note whose id names
 *                       the reading); with bp_summary off such a note is one of the day's notes
 * Owner 10-15 too: with bp_summary on, a day with a reading outside the target his doctor set (the one rule of
 * lib/daily/bp-target.ts, the target he confirmed: lib/visit/doctor-numbers.ts) is marked, and so is that reading on the
 * chosen day, with the target's numbers, its date and the doctor who gave it; a visit carries its time and its doctor
 * when the scope's settings have them (lib/daily/visit-details.ts).
 * A switch that is off is not read at all: nothing of that kind is in the result.
 *
 * Round trips: everything the month needs is asked at once (as her home does); a second round reads the transcript of
 * a visit in this month that is not confirmed yet (did it happen: lib/visit/happened.ts) and of the chosen day's visit
 * (how many lines), side by side.
 */
import { latestReasons, outsideTarget, targetRule } from "@/lib/daily/bp-target";
import { buildDoseDay, type SlotDay } from "@/lib/daily/cells";
import { isPatternOrigin, questionDay } from "@/lib/daily/questions";
import { liveTranscript } from "@/lib/safety/line-state";
import { scopeD0, scopeTz } from "@/lib/store/scope";
import type { BpReadingRow, DaySlot, DoseLogRow, FamilyGrantItems, MedicationRow, NoteRow, NoteSource, QuestionFor, QuestionRow, SessionRow, Store, UtteranceRow, VisitRow } from "@/lib/store/types";
import { dayOfDate, storyDate, weekdayIndex } from "@/lib/story/clock";
import { localDate } from "@/lib/time/clock";
import { visitDetail, type DoctorName } from "@/lib/daily/visit-details";
import { doctorNumbers, type DoctorNumbers } from "@/lib/visit/doctor-numbers";
import { isReplayCopy, visitHappened } from "@/lib/visit/happened";
import { cellMark, cellReason, dayMark, slotView } from "./home";
import type { CellMark, DayMark } from "./home-types";

type Grant = keyof FamilyGrantItems;

/** His switches this page shows something for. With none of them on there is no calendar (the page sends her home). */
export const MONTH_GRANTS: readonly Grant[] = ["dose_summary", "bp_summary", "questions_count", "visit_transcripts"];

/**
 * The switches of this page that are on: what the page shows and what her access-log row names. His notes come with a
 * calendar (owner 10-15: on the chosen day, and under a reading), never make one on their own.
 */
export function monthShown(grants: FamilyGrantItems): Grant[] {
  const on = MONTH_GRANTS.filter((k) => grants[k]);
  return on.length && grants.notes ? [...on, "notes"] : on;
}

/** /f/month?link=…[&m=YYYY-MM][&d=YYYY-MM-DD] (her-view.ts herPaths has no entry for it yet). */
export function monthPath(linkId: string, ym?: string | null, date?: string | null): string {
  return `/f/month?link=${encodeURIComponent(linkId)}${ym ? `&m=${ym}` : ""}${date ? `&d=${date}` : ""}`;
}

// ------------------------------------------------------------------ which month, which day

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const two = (n: number) => String(n).padStart(2, "0");

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026-10", -1 -> "2026-09" */
export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}`;
}

/** A date that exists ("2026-02-30" does not), or null. */
function realDate(date: string | undefined): string | null {
  const m = date ? YMD.exec(date) : null;
  if (!m) return null;
  return Number(m[3]) <= daysInMonth(`${m[1]}-${m[2]}`) ? m[0] : null;
}

export interface MonthAt {
  /** the month shown, "YYYY-MM" */
  ym: string;
  /** the chosen day, always a day of that month */
  chosen: string;
  /** the earliest month she may open (his first day on Ripple) and the latest (the current one) */
  floor: string;
  current: string;
}

/**
 * The month and the day an address means. `m` names the month, else the month of `d`, else the current one; held
 * between the month of `first` (his first day: no record of his is older) and the current month. The chosen day is `d`
 * when it falls inside that month; else today in the current month, the last day of an earlier one.
 */
export function monthAt(ask: { m?: string; d?: string }, today: string, first: string): MonthAt {
  const current = today.slice(0, 7);
  const floor = first.slice(0, 7) < current ? first.slice(0, 7) : current;
  const day = realDate(ask.d);
  const asked = ask.m && YM.test(ask.m) ? ask.m : day ? day.slice(0, 7) : current;
  const ym = asked < floor ? floor : asked > current ? current : asked;
  const chosen = day && day.slice(0, 7) === ym ? day : ym === current ? today : `${ym}-${two(daysInMonth(ym))}`;
  return { ym, chosen, floor, current };
}

// ------------------------------------------------------------------ what the page gets

/** One day of the grid. A marker is there only while its switch is on. */
export interface MonthCell {
  date: string;
  /** 1 to 31 */
  dom: number;
  isToday: boolean;
  future: boolean;
  /** dose_summary on: the day's mark, as on her week ("none": nothing to record that day); null: not shared */
  dose: DayMark | null;
  /** bp_summary on, and a reading was recorded that day */
  bp: boolean;
  /** bp_summary on, and a reading that day is outside the target his doctor set (lib/daily/bp-target.ts) */
  bpAbove: boolean;
  /** questions_count or visit_transcripts on: a visit that happened that day ("past") or is planned for it */
  visit: "past" | "planned" | null;
}

/** One medicine in one part of the chosen day. */
export interface MonthDose {
  /** date|slot|medicine id: the cell this row stands for (it has no row of its own until he answers) */
  ref: string;
  slot: DaySlot;
  medicationId: string;
  name: string;
  strength: string | null;
  mark: CellMark;
  /** when he tapped (ISO), for an answer he gave on that day; null: no time is kept for it */
  at: string | null;
  /** the reason he gave for 「没吃」, in the words stored with his answer (lib/care/home.ts cellReason: her home's rule); null: none given */
  reason: string | null;
}

export interface MonthBp {
  id: string;
  slot: DaySlot;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  /** when he recorded it (ISO), when that was on the day itself */
  at: string | null;
  /** outside the target his doctor set (the month's `target`) */
  above: boolean;
  /** notes on: what he said happened that day, his latest words about this reading; else null */
  reason: MonthNote | null;
}

/** One of his notes, in his own words as stored. */
export interface MonthNote {
  id: string;
  text: string;
  lang: string | null;
  /** when he said or wrote it (ISO) */
  at: string;
  source: NoteSource;
}

/** The target a reading is compared with: the doctor's two numbers, the visit's date, and the doctor when known. */
export interface MonthTarget {
  systolic: number;
  diastolic: number;
  /** YYYY-MM-DD of the visit it was given at */
  date: string;
  doctor: DoctorName | null;
}

export interface MonthVisit {
  id: string;
  state: "past" | "planned";
  /** where, and what kind of visit (lib/care/visit-words.ts words it): with the day, as the next visit's place on her home */
  place: string | null;
  kind: string | null;
  /** visit_transcripts on, a visit that happened: how many of the clinicians' lines he confirmed; else null */
  lines: number | null;
  /** visit_transcripts on, a visit that happened: its record can be opened (/f/shared/visit/<id>) */
  open: boolean;
  /** the visit's time ("10:30") and its doctor, when the scope's settings have them (lib/daily/visit-details.ts) */
  time: string | null;
  doctor: DoctorName | null;
}

export interface MonthQuestion {
  id: string;
  for: QuestionFor;
  text: string;
  lang: string | null;
  /** where it came from ("reading": Ripple wrote it from a reading and his words, lib/daily/bp-reason.ts) */
  origin: string;
}

/** The chosen day: each list is null while its switch is off (not read), empty when the day has none. */
export interface MonthDay {
  date: string;
  isToday: boolean;
  future: boolean;
  doses: MonthDose[] | null;
  bp: MonthBp[] | null;
  visits: MonthVisit[] | null;
  questions: MonthQuestion[] | null;
  /** notes on: his notes of that day (what he said about a reading shown above is under it instead) */
  notes: MonthNote[] | null;
}

export interface MonthView {
  ym: string;
  /** his today (his time zone) */
  today: string;
  isCurrent: boolean;
  /** the month before and after, when she may open it */
  prev: string | null;
  next: string | null;
  /** empty cells before the 1st, the week starting on Monday */
  lead: number;
  cells: MonthCell[];
  day: MonthDay;
  /** the switches whose records this copy holds (her access-log row names them) */
  shown: Grant[];
  /** today's reminder moments ("08:45"), when today is on the page and his medicine is shared: the page reads itself again as each passes */
  moments: string[];
  /** bp_summary on and a target he confirmed: what the marks compare with (the legend and a reading's line say it) */
  target: MonthTarget | null;
}

// ------------------------------------------------------------------ the month

const CLINICIANS = new Set(["doctor", "dispenser", "pharmacist"]);
const none = <T>(): Promise<T[]> => Promise.resolve([]);

/** One day's slots from rows already read; a day still to come has its medicines due, none answered. */
function daySlots(scope: SessionRow, day: number, meds: MedicationRow[], rows: DoseLogRow[], nowMs: number): SlotDay[] {
  if (day > scope.story_day) return buildDoseDay(scope, day, meds, [], nowMs).map((s) => ({ ...s, phase: "before" as const }));
  return buildDoseDay(scope, day, meds, rows, nowMs);
}

/** The day's mark, as her week's (lib/care/home.ts dayView): no reply first, then missed, then all taken. */
function markOf(scope: SessionRow, day: number, slots: SlotDay[], tz: string): DayMark {
  // a day still to come has no mark: nothing is due on it yet (10-15, the demo video: two weeks of dashed rings drowned
  // the one reading outside the target)
  if (day > scope.story_day) return "none";
  return dayMark(slots.map((s) => slotView(s, tz)).filter((s) => s.cells.length));
}

/** Each medicine of the day with his answer, the time he tapped (an answer given on that day) and his reason. */
function doseLines(slots: SlotDay[], tz: string): MonthDose[] {
  const out: MonthDose[] = [];
  for (const s of slots) {
    for (const c of s.cells) {
      const mark = cellMark(c, s.phase);
      if (!mark) continue;
      const sameDay = !!c.answeredAt && localDate(Date.parse(c.answeredAt), tz) === s.date;
      out.push({
        ref: `${s.date}|${s.slot}|${c.medicationId}`,
        slot: s.slot,
        medicationId: c.medicationId,
        name: c.name,
        strength: c.strength,
        mark,
        at: (mark === "taken" || mark === "missed") && sameDay ? c.answeredAt : null,
        reason: cellReason(c),
      });
    }
  }
  return out;
}

const noteOf = (n: NoteRow): MonthNote => ({ id: n.id, text: n.text, lang: n.lang, at: n.created_at, source: n.source });

function bpLines(rows: BpReadingRow[], day: number, date: string, tz: string, above: (r: BpReadingRow) => boolean, reasons: Map<string, NoteRow> | null): MonthBp[] {
  const out: MonthBp[] = [];
  for (const r of rows) {
    if (r.day !== day || r.state !== "recorded" || r.systolic === null || r.diastolic === null) continue;
    const reason = reasons?.get(r.id);
    out.push({
      id: r.id,
      slot: r.slot,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse ?? null,
      at: localDate(Date.parse(r.created_at), tz) === date ? r.created_at : null,
      above: above(r),
      reason: reason ? noteOf(reason) : null,
    });
  }
  return out;
}

/**
 * The questions he put on his list on `day`, in their words: his own, and the ones other parts of Ripple put there
 * for him. Left out: a question Ripple words from a pattern in his log (not his words, and rewritten as the log
 * changes), one he set aside (「不问了」) and a duplicate he merged into another.
 */
function questionLines(questions: QuestionRow[], visits: VisitRow[], day: number): MonthQuestion[] {
  return questions
    .filter((q) => !q.merged_into && q.status !== "skipped" && !isPatternOrigin(q.origin) && questionDay(q, visits) === day)
    .map((q) => ({ id: q.id, for: q.for, text: q.text, lang: q.lang, origin: q.origin }));
}

export async function familyMonth(store: Store, scope: SessionRow, grants: FamilyGrantItems, ask: { m?: string; d?: string }, nowMs: number): Promise<MonthView> {
  const d0 = scopeD0(scope);
  const tz = scopeTz(scope);
  const todayDay = scope.story_day;
  const today = storyDate(d0, todayDay);
  const at = monthAt(ask, today, storyDate(d0, 0));
  const { ym } = at;
  const first = dayOfDate(d0, `${ym}-01`);
  const last = first + daysInMonth(ym) - 1;
  const upTo = Math.min(last, todayDay);
  const chosenDay = dayOfDate(d0, at.chosen);
  const visitsOn = grants.questions_count || grants.visit_transcripts;

  // everything at once: each is a round trip on a hosted database, and none depends on another
  const [meds, doses, readings, visits, questions, notes, numbers] = await Promise.all([
    grants.dose_summary ? store.listMeds(scope.id) : none<MedicationRow>(),
    grants.dose_summary ? store.listDoses(scope.id, { fromDay: first, toDay: upTo }) : none<DoseLogRow>(),
    grants.bp_summary ? store.listBp(scope.id, { fromDay: first, toDay: upTo }) : none<BpReadingRow>(),
    visitsOn ? store.listVisits(scope.id) : none<VisitRow>(),
    grants.questions_count ? store.listQuestions(scope.id) : none<QuestionRow>(),
    grants.notes ? store.listNotes(scope.id, { fromDay: first, toDay: upTo }) : none<NoteRow>(),
    // the target he confirmed (none: nothing is compared), only where his readings are shown
    grants.bp_summary ? doctorNumbers(store, scope.id, { day: todayDay, time: scope.story_time ?? null }) : Promise.resolve<DoctorNumbers | null>(null),
  ]);
  const rule = targetRule(numbers?.target);
  const above = (r: BpReadingRow) => outsideTarget(r, rule);
  // what he said about a reading: his latest note about it (the note's id names it)
  const reasons = grants.notes ? latestReasons(notes) : null;

  // ---- his visits of this month: one planned for today or later, or one that left a record (lib/visit/happened.ts)
  const dateOf = (v: VisitRow) => v.date || storyDate(d0, v.day);
  const inMonth = visits.filter((v) => dateOf(v).slice(0, 7) === ym && !isReplayCopy(v));
  const planned = inMonth.filter((v) => v.status === "planned" && dateOf(v) >= today);
  const held = inMonth.filter((v) => v.status !== "planned" && dateOf(v) <= today);
  // a confirmed visit happened whatever its transcript; the others, and the chosen day's (its lines are counted), are read
  const countLines = (v: VisitRow) => grants.visit_transcripts && dateOf(v) === at.chosen;
  const transcripts: (UtteranceRow[] | null)[] = await Promise.all(held.map((v) => (v.status !== "confirmed" || countLines(v) ? store.listUtterances(scope.id, v.id).then(liveTranscript) : null)));
  const past = held.map((v, i) => ({ v, lines: transcripts[i] })).filter(({ v, lines }) => v.status === "confirmed" || visitHappened(v, { lines: lines ?? [] }));
  const visitOn = new Map<string, "past" | "planned">();
  for (const v of planned) visitOn.set(dateOf(v), "planned");
  for (const { v } of past) visitOn.set(dateOf(v), "past");

  // ---- the grid
  const dosesByDay = new Map<number, DoseLogRow[]>();
  for (const d of doses) dosesByDay.set(d.day, [...(dosesByDay.get(d.day) ?? []), d]);
  const bpDays = new Set(readings.filter((r) => r.state === "recorded").map((r) => r.day));
  const aboveDays = new Set(readings.filter(above).map((r) => r.day));
  const slotsOf = new Map<number, SlotDay[]>();
  const cells: MonthCell[] = [];
  for (let day = first; day <= last; day++) {
    const date = storyDate(d0, day);
    const slots = grants.dose_summary ? daySlots(scope, day, meds, dosesByDay.get(day) ?? [], nowMs) : [];
    slotsOf.set(day, slots);
    cells.push({
      date,
      dom: day - first + 1,
      isToday: day === todayDay,
      future: day > todayDay,
      dose: grants.dose_summary ? markOf(scope, day, slots, tz) : null,
      bp: bpDays.has(day),
      bpAbove: aboveDays.has(day),
      visit: visitOn.get(date) ?? null,
    });
  }

  // ---- the chosen day
  const dayVisits: MonthVisit[] = [
    ...past
      .filter(({ v }) => dateOf(v) === at.chosen)
      .map(({ v, lines }): MonthVisit => ({
        id: v.id,
        state: "past",
        place: v.place?.trim() || null,
        kind: v.kind,
        lines: grants.visit_transcripts ? (lines ?? []).filter((u) => CLINICIANS.has(u.role) && u.role_state === "confirmed").length : null,
        open: grants.visit_transcripts,
        ...visitDetail(scope, v.id),
      })),
    ...planned
      .filter((v) => dateOf(v) === at.chosen)
      .map((v): MonthVisit => ({ id: v.id, state: "planned", place: v.place?.trim() || null, kind: v.kind, lines: null, open: false, ...visitDetail(scope, v.id) })),
  ];
  const dayBp = grants.bp_summary ? bpLines(readings, chosenDay, at.chosen, tz, above, reasons) : null;
  // his notes of the day; what he said about a reading shown above stands under it, not here
  const underReading = new Set((dayBp ?? []).flatMap((r) => (r.reason ? [r.reason.id] : [])));
  const dayNotes = grants.notes ? notes.filter((n) => n.day === chosenDay && n.text.trim() && !underReading.has(n.id)).map(noteOf) : null;
  const day: MonthDay = {
    date: at.chosen,
    isToday: chosenDay === todayDay,
    future: chosenDay > todayDay,
    doses: grants.dose_summary ? doseLines(slotsOf.get(chosenDay) ?? [], tz) : null,
    bp: dayBp,
    visits: visitsOn ? dayVisits : null,
    questions: grants.questions_count ? (chosenDay <= todayDay ? questionLines(questions, visits, chosenDay) : []) : null,
    notes: dayNotes,
  };

  const todaySlots = at.ym === at.current ? (slotsOf.get(todayDay) ?? []) : [];
  return {
    ym,
    today,
    isCurrent: ym === at.current,
    prev: ym > at.floor ? shiftMonth(ym, -1) : null,
    next: ym < at.current ? shiftMonth(ym, 1) : null,
    lead: (weekdayIndex(d0, first) + 6) % 7,
    cells,
    day,
    shown: monthShown(grants),
    moments: todaySlots.flatMap((s) => [s.schedule.first, s.schedule.second, s.schedule.closes]),
    target: rule && numbers?.target ? { systolic: rule.systolic, diastolic: rule.diastolic, date: numbers.target.visitDate, doctor: visitDetail(scope, numbers.target.visitId).doctor } : null,
  };
}
