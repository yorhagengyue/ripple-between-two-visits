/**
 * Her view of his day on a real account (C2 track D; the daughter brief B-D, F; real-app 2.21). Server-only, read only:
 * nothing here writes to his space (the access-log row is the page's, lib/care/access-log.ts), nothing settles a
 * window (that is the scheduled job's: lib/jobs/daily.ts).
 *
 *   familyHome(store, scope, link, nowMs)      the home: today's headline state, today's timeline, the 7-day strip,
 *                                              the counts, the no-reply alert, the reminder that plays
 *   familyWeek(store, scope, nowMs, offset)    one week, day by day, each medicine named (「这一周」 and the week before)
 *
 * The medicines and their states come from the same cells his Today uses (lib/daily/cells.ts buildDoseDay), so this
 * week and today name the same medicines, each by its own name; the week's numbers come from track B's
 * scopeDoseSummary, the same as his visit brief. Each section is built only while its switch is on.
 *
 * The owner's decision of 2026-10-14: the same six switches, each showing its kind in full while it is on. A missed
 * dose carries the reason he gave (dose_summary); the blood pressure part carries this week's readings (bp_summary); the
 * questions part carries the waiting questions' words and the next visit's place (questions_count). The store does not
 * enforce the switches: this file does, and lib/care/hide.ts does the same on her page. With the no-reply switch on
 * alone her home still carries the alert in its own form and nothing else of his medicine (no name, no answer, no reason).
 *
 * Round trips (10-11, the one-second fix round): on a hosted database every store call is a round trip, and her home
 * is read again whenever something of his changes. It used to be seven calls deep after her switches were known (her
 * facts, then the day, then the week reading the medicines and doses a second and third time, then the questions, then
 * the access log's read and write); now everything is asked at once and the week is counted from the rows already
 * read: one round, two when the questions' recorded answers are read (tests/unit/care/one-second.test.ts counts them).
 * The detail of 10-14 costs no round: the reason is on the dose rows and the readings are the rows already read; the
 * questions' words come from the list that used to be read for the count alone (and his visits are read once, not twice).
 *
 *   herHomeNow(store, scope, who, nowMs)       her switches, her home and her look logged: what GET /api/family/view
 *                                              answers, what /f renders and what her stream pushes after a switch
 */
import { buildDoseDay, scopeSlotSchedule, type DoseCell, type SlotDay } from "@/lib/daily/cells";
import { DELIVERY } from "@/lib/daily/no-reply";
import { herFacts, herFactsSummary } from "./facts";
import { answerMoment, questionDay, questionVisible, questionWaiting } from "@/lib/daily/questions";
import { remindersView } from "@/lib/daily/reminders";
import { preferredClip } from "@/lib/family/clips";
import { NO_GRANTS } from "@/lib/family/types";
import { scopeD0, scopeTz } from "@/lib/store/scope";
import { localDate } from "@/lib/time/clock";
import type { BpReadingRow, CareAccessLogRow, CareLinkRow, DaySlot, DoseLogRow, FamilyGrantItems, FamilyGrantRow, MedicationRow, QuestionRow, ReminderDeliveryRow, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { SLOT_ORDER } from "@/lib/daily/slots";
import { storyDate, weekdayIndex } from "@/lib/story/clock";
import { nextPlannedVisit } from "@/lib/summary/account-brief";
// owner 10-15: the next visit's time and doctor (lib/daily/visit-details.ts)
import { visitDetail } from "@/lib/daily/visit-details";
import { summarizeBp } from "@/lib/summary/bp";
import type { WeeklyRoutine } from "@/lib/summary/doses";
import { scopeDoseSummary, summarizeAccountDoses } from "@/lib/summary/scope-doses";
import { isAccount, scopeRoutine } from "@/lib/store/scope";
import { logLookAfter, recentLooks } from "./access-log";
// line bind (round two): what the reminder says is not for a link he has not acknowledged
import { bindEntryStore } from "@/lib/subject/bind";
import { linkAcknowledged } from "./ack";
import { alertTimeline } from "./hide";
// the family texts asked again: the copy says so (the cut itself is her store's, lib/subject/scoped-store.ts)
import { isHeld, type LinkConsent } from "./reconsent";
// scene 1 (10-15): the visit he is recording now, for her banner
import { recordingNow } from "./live-visit";
// owner 10-16 (only add): the kind of 「爸爸跟 Ripple 说了一件可能要留意的事」 (lib/care/told.ts)
import { TOLD_KIND } from "./told";
import type { BpReadingView, CellMark, CellView, DayMark, FamilyHomeData, NoReplyView, QuestionView, ReminderNow, SlotView, TimelineLine, TodayStatus, WeekDayView, WeekView } from "./home-types";

/** The oldest week she can page back to. */
export const WEEKS_BACK = 3;

/** How many of the waiting questions her home carries the words of: the newest (owner, 10-14). The count is of all. */
export const QUESTIONS_SHOWN = 5;

// ------------------------------------------------------------------ cells and days

/**
 * One cell as she may see it: taken, missed, no reply, still waiting, not yet; untracked: its window closed before he
 * started using Ripple (no record, never counted as 「没回」); null: an untracked cell still to come or open.
 */
export function cellMark(c: Pick<DoseCell, "state" | "reason" | "tracked">, phase: SlotDay["phase"]): CellMark | null {
  if (c.state === "taken") return "taken";
  if (c.state === "missed") return "missed";
  if (c.state === "unconfirmed") {
    if (c.reason === "no_reply") return "no_reply";
    return phase === "closed" ? "no_reply" : "waiting";
  }
  // no answer
  if (phase === "closed") return c.tracked ? "no_reply" : "untracked";
  if (phase === "before") return "pending";
  return c.tracked ? "waiting" : "pending";
}

/**
 * The reason he gave for a dose he did not take, as she may see it (owner, 10-14): what is stored with his answer and
 * what his own Today shows (the words of the reason he tapped, or his own words; never the option's code). Only a
 * missed dose has one: 等一下 and 「没回」 are states, not reasons.
 */
export function cellReason(c: Pick<DoseCell, "state" | "reasonText">): string | null {
  return c.state === "missed" ? c.reasonText?.trim() || null : null;
}

/**
 * One slot as she may see it. A time is shown only for an answer he gave on that day (a row written later, or laid out
 * by the example's seeding, keeps its state and shows no time).
 */
export function slotView(s: SlotDay, tz = "Asia/Singapore"): SlotView {
  const cells: CellView[] = [];
  for (const c of s.cells) {
    const mark = cellMark(c, s.phase);
    if (!mark) continue;
    const sameDay = !!c.answeredAt && localDate(Date.parse(c.answeredAt), tz) === s.date;
    cells.push({ medicationId: c.medicationId, name: c.name, strength: c.strength, mark, at: (mark === "taken" || mark === "missed") && sameDay ? c.answeredAt : null, reason: cellReason(c) });
  }
  return { slot: s.slot, first: s.schedule.first, second: s.schedule.second, closes: s.schedule.closes, phase: s.phase, cells };
}

/** A day's mark: no reply first (it is the one she acts on), then missed, then all taken; nothing to record: none. */
export function dayMark(slots: readonly SlotView[]): DayMark {
  const marks = slots.flatMap((s) => s.cells.map((c) => c.mark)).filter((m) => m !== "untracked");
  if (!marks.length) return "none";
  if (marks.includes("no_reply")) return "no_reply";
  if (marks.includes("missed")) return "missed";
  if (marks.every((m) => m === "taken")) return "taken";
  return "pending";
}

function mondayOf(scope: SessionRow, day: number): number {
  return day - ((weekdayIndex(scopeD0(scope), day) + 6) % 7);
}

function dayView(scope: SessionRow, day: number, meds: MedicationRow[], doses: DoseLogRow[], nowMs: number, today: number): WeekDayView {
  const d0 = scopeD0(scope);
  const tz = scopeTz(scope);
  const slots = day > today ? futureSlots(scope, day, meds, nowMs) : buildDoseDay(scope, day, meds, doses, nowMs).map((s) => slotView(s, tz)).filter((s) => s.cells.length);
  return { date: storyDate(d0, day), weekday: weekdayIndex(d0, day), isToday: day === today, mark: day > today ? (slots.length ? "pending" : "none") : dayMark(slots), slots };
}

/** A day still to come: the medicines due then, all "pending". */
function futureSlots(scope: SessionRow, day: number, meds: MedicationRow[], nowMs: number): SlotView[] {
  return buildDoseDay(scope, day, meds, [], nowMs).map((s) => ({ ...slotView({ ...s, phase: "before" }), phase: "before" as const })).filter((s) => s.cells.length);
}

const weekOffset = (offset: number) => Math.max(-WEEKS_BACK, Math.min(0, Math.trunc(offset) || 0));

/** One week's rows and its two numbers (days with something to record, days with every dose taken). */
function weekFrom(scope: SessionRow, meds: MedicationRow[], doses: DoseLogRow[], nowMs: number, off: number, counts: { due: number; allTaken: number }): WeekView {
  const today = scope.story_day;
  const from = mondayOf(scope, today) + 7 * off;
  const to = from + 6;
  const days: WeekDayView[] = [];
  for (let d = from; d <= to; d++) days.push(dayView(scope, d, meds, doses, nowMs, today));
  const d0 = scopeD0(scope);
  return { offset: off, fromDate: storyDate(d0, from), toDate: storyDate(d0, to), days, daysDue: counts.due, daysAllTaken: counts.allTaken };
}

/**
 * An account's week from rows already read: `meds` are his medicines, `doses` cover at least that week up to today.
 * The two numbers are track B's cell-by-cell count (summarizeAccountDoses: what scopeDoseSummary gives an account,
 * without reading the medicines and doses again).
 */
function accountWeek(scope: SessionRow, meds: MedicationRow[], doses: DoseLogRow[], nowMs: number, off: number): WeekView {
  const today = scope.story_day;
  const from = mondayOf(scope, today) + 7 * off;
  const upTo = Math.min(from + 6, today);
  const inWeek = doses.filter((d) => d.day >= from && d.day <= upTo);
  const summary = from <= today ? summarizeAccountDoses({ scope, meds, doses: inWeek, fromDay: from, toDay: upTo, nowMs, routine: scopeRoutine(scope) as WeeklyRoutine[] }) : null;
  return weekFrom(scope, meds, inWeek, nowMs, off, { due: summary?.days.length ?? 0, allTaken: summary?.daysAllTaken ?? 0 });
}

/** One week (Monday to Sunday) of his medicine, each medicine named. offset 0 = this week, -1 = the week before. */
export async function familyWeek(store: Store, scope: SessionRow, nowMs: number, offset = 0): Promise<WeekView> {
  const off = weekOffset(offset);
  const today = scope.story_day;
  const from = mondayOf(scope, today) + 7 * off;
  const upTo = Math.min(from + 6, today);
  if (isAccount(scope)) {
    const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: from, toDay: upTo })]);
    return accountWeek(scope, meds, doses, nowMs, off);
  }
  // not an account (her pages are an account's; kept for a caller that hands in a demo row): counted as before
  const [meds, doses, summary] = await Promise.all([
    store.listMeds(scope.id),
    store.listDoses(scope.id, { fromDay: from, toDay: upTo }),
    from <= today ? scopeDoseSummary(store, scope, { fromDay: from, toDay: upTo, nowMs }) : null,
  ]);
  return weekFrom(scope, meds, doses, nowMs, off, { due: summary?.days.length ?? 0, allTaken: summary?.daysAllTaken ?? 0 });
}

// ------------------------------------------------------------------ today

/** The slot that matters now: one being reminded, else the latest that closed, else the next one. */
export function mainSlot(slots: readonly SlotView[]): SlotView | null {
  const reminding = slots.find((s) => (s.phase === "first" || s.phase === "second") && s.cells.length);
  if (reminding) return reminding;
  const closed = slots.filter((s) => s.phase === "closed" && s.cells.length);
  if (closed.length) return closed[closed.length - 1];
  return slots.find((s) => s.cells.length) ?? null;
}

export function todayStatus(slot: SlotView | null, noReplyAlert: boolean): TodayStatus {
  if (!slot || !slot.cells.length) return { state: "no_meds", slot: null, at: null };
  const marks = slot.cells.map((c) => c.mark).filter((m) => m !== "untracked");
  if (!marks.length) return { state: "untracked", slot, at: null };
  const at = slot.cells.map((c) => c.at).filter((x): x is string => !!x).sort().at(-1) ?? null;
  if (marks.includes("no_reply")) return { state: noReplyAlert ? "no_reply" : "not_logged", slot, at };
  if (marks.includes("waiting")) return { state: "reminding", slot, at };
  if (marks.every((m) => m === "pending")) return { state: "before", slot, at: null };
  if (marks.every((m) => m === "taken")) return { state: "taken", slot, at };
  if (marks.every((m) => m === "missed")) return { state: "missed", slot, at };
  if (marks.every((m) => m === "taken" || m === "missed")) return { state: "mixed", slot, at };
  return { state: "reminding", slot, at };
}

/** Today's slot as a timeline: the reminders sent, his answers, the moment it became "no reply" and whether she was told. */
export function slotTimeline(input: {
  slot: SlotView;
  cells: readonly DoseCell[];
  closeMs: number;
  deliveries: readonly ReminderDeliveryRow[];
  linkId: string;
  day: number;
}): TimelineLine[] {
  const { slot, closeMs, deliveries, linkId, day } = input;
  const mine = deliveries.filter((d) => d.day === day && d.slot === slot.slot);
  const lines: TimelineLine[] = [];
  const first = mine.find((d) => d.kind === DELIVERY.doseFirst);
  const second = mine.find((d) => d.kind === DELIVERY.doseSecond);
  const told = mine.find((d) => d.kind === DELIVERY.familyNoReply && d.ref === linkId);
  const answered = input.cells.filter((c) => (c.state === "taken" || c.state === "missed") && c.answeredAt);
  const late = answered.some((c) => Date.parse(c.answeredAt!) >= closeMs);
  const wentNoReply = slot.cells.some((c) => c.mark === "no_reply") || late;
  const onTime = (iso: string) => Date.parse(iso) < closeMs;
  const unansweredAt = (sent: string) => wentNoReply && !answered.some((c) => onTime(c.answeredAt!) && c.answeredAt! >= sent);
  if (first) lines.push({ at: first.sent_at, kind: "reminded", meds: [], unanswered: unansweredAt(first.sent_at) });
  if (second) lines.push({ at: second.sent_at, kind: "reminded_again", meds: [], unanswered: unansweredAt(second.sent_at) });
  // answers, grouped by state and minute
  const groups = new Map<string, { at: string; kind: TimelineLine["kind"]; meds: string[] }>();
  for (const c of input.cells) {
    if (c.state === "unconfirmed" && c.reason === "later" && c.answeredAt) {
      const key = `later|${c.answeredAt.slice(0, 16)}`;
      const g = groups.get(key) ?? { at: c.answeredAt, kind: "later" as const, meds: [] };
      g.meds.push(c.name);
      groups.set(key, g);
      continue;
    }
    if ((c.state !== "taken" && c.state !== "missed") || !c.answeredAt) continue;
    const isLate = !onTime(c.answeredAt);
    const kind: TimelineLine["kind"] = c.state === "taken" ? (isLate ? "late_taken" : "taken") : isLate ? "late_missed" : "missed";
    const key = `${kind}|${c.answeredAt.slice(0, 16)}`;
    const g = groups.get(key) ?? { at: c.answeredAt, kind, meds: [] };
    g.meds.push(c.name);
    groups.set(key, g);
  }
  lines.push(...groups.values());
  if (wentNoReply) lines.push(told ? { at: told.sent_at, kind: "told_you", meds: [] } : { at: new Date(closeMs).toISOString(), kind: "no_reply", meds: [] });
  return lines.sort((a, b) => a.at.localeCompare(b.at) || order(a.kind) - order(b.kind));
}

const ORDER: TimelineLine["kind"][] = ["reminded", "later", "reminded_again", "taken", "missed", "no_reply", "told_you", "late_taken", "late_missed", "answered"];
const order = (k: TimelineLine["kind"]) => ORDER.indexOf(k);

// alertTimeline (the alert's own lines when only the no-reply switch is on) lives in ./hide: her page cuts its copy
// down with the same rule the moment he switches the dose section off
export { alertTimeline };

// ------------------------------------------------------------------ readings and questions (owner, 10-14: in full)

/**
 * The readings from `fromDay` to `toDay` as she may see them, newest first: the rows the count is of (recorded, both
 * numbers; lib/summary/bp.ts summarizeBp). A time only for a reading he recorded on its own day, as for a dose.
 * Each carries its row's id and nothing else of the row: her screen names the reading by it when she holds it (the long
 * press on her side, owner 10-14: lib/care/her-holds.ts, POST /api/explain?link=).
 */
export function readingViews(scope: SessionRow, readings: readonly BpReadingRow[], fromDay: number, toDay: number): BpReadingView[] {
  const d0 = scopeD0(scope);
  const tz = scopeTz(scope);
  const out: BpReadingView[] = [];
  const newestFirst = [...readings].sort((a, b) => b.day - a.day || SLOT_ORDER.indexOf(b.slot) - SLOT_ORDER.indexOf(a.slot) || b.created_at.localeCompare(a.created_at));
  for (const r of newestFirst) {
    if (r.day < fromDay || r.day > toDay || r.state !== "recorded" || r.systolic === null || r.diastolic === null) continue;
    const date = storyDate(d0, r.day);
    out.push({ id: r.id, date, slot: r.slot, at: localDate(Date.parse(r.created_at), tz) === date ? r.created_at : null, systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse ?? null });
  }
  return out;
}

/**
 * The questions on his list still waiting for a visit at this moment, and his visits: what lib/daily/questions.ts
 * openQuestionCount counts, as rows (the count alone was read here until 10-14). One round, and one more when recorded
 * answers are read; his visits are read once for both the questions and the next visit.
 */
async function waitingQuestions(store: Store, scope: SessionRow): Promise<{ waiting: QuestionRow[]; visits: VisitRow[] }> {
  const [questions, visits] = await Promise.all([store.listQuestions(scope.id), store.listVisits(scope.id)]);
  const moment = await answerMoment(store, scope, visits, questions);
  return { waiting: questions.filter((q) => questionVisible(q, visits, scope.story_day) && questionWaiting(q, visits, moment)), visits };
}

/**
 * The words of the waiting questions she may see, newest first, QUESTIONS_SHOWN at most: each as it is stored on his
 * list, with who it is for. Newest: when it was written; rows laid out together (the example's history) by their day on
 * his list, then by their place in it. Each carries its id, for the same long press as a reading's.
 */
export function questionViews(waiting: readonly QuestionRow[], visits: readonly Pick<VisitRow, "id" | "day">[]): QuestionView[] {
  const day = (q: QuestionRow) => questionDay(q, [...visits]) ?? -1;
  return waiting
    .map((q, i) => ({ q, i }))
    .sort((a, b) => b.q.created_at.localeCompare(a.q.created_at) || day(b.q) - day(a.q) || b.i - a.i)
    .slice(0, QUESTIONS_SHOWN)
    .map(({ q }) => ({ id: q.id, for: q.for, text: q.text, lang: q.lang }));
}

// ------------------------------------------------------------------ the home

/**
 * Owner 10-16: the newest notice 「爸爸跟 Ripple 说了一件可能要留意的事」 sent to her link today (lib/care/told.ts TOLD_KIND),
 * id and when it went; null when none. Under no switch (the baseline). Only the delivery row: no word of what was said.
 */
async function newestTold(store: Store, scopeId: string, linkId: string, today: number): Promise<{ id: string; at: string } | null> {
  const rows = (await store.listDeliveries(scopeId, { fromDay: today, toDay: today })).filter((d) => d.kind === TOLD_KIND && d.ref === linkId);
  const last = rows.sort((a, b) => a.sent_at.localeCompare(b.sent_at)).at(-1);
  return last ? { id: last.id, at: last.sent_at } : null;
}

export interface HomeInput {
  link: Pick<CareLinkRow, "id" | "patient_label">;
  /** her switches through this link (the caller read them through her link) */
  grants: FamilyGrantItems;
  /** which change of the switches `grants` is (the grant row's version); goes out as grantsVersion */
  version?: number;
  /**
   * Line bind (round two): has he acknowledged this link (lib/care/ack.ts)? Absent: asked here, in the same round as
   * everything else, through binding's narrow store (her own store cannot read his account's rows). While he has not,
   * her home carries what the four default switches show and nothing else: no reminder (its words, whose voice, its time).
   */
  acknowledged?: boolean;
  /**
   * The family texts asked again (lib/care/reconsent.ts): whether each of them has agreed to the text in force, as her
   * request's subject read it. Only said on the copy (`reconsent`, for the line and her card): the switches the caller
   * passes in were already cut by her store (lib/subject/scoped-store.ts). Absent: nothing waits.
   */
  consent?: LinkConsent | null;
}

export async function familyHome(store: Store, scope: SessionRow, input: HomeInput, nowMs: number): Promise<FamilyHomeData> {
  const grants = { ...NO_GRANTS, ...input.grants };
  const today = scope.story_day;
  const d0 = scopeD0(scope);
  const out: FamilyHomeData = {
    linkId: input.link.id,
    patientLabel: input.link.patient_label,
    today: storyDate(d0, today),
    generatedAt: nowMs,
    grants,
    grantsVersion: input.version ?? 0,
    status: null,
    timeline: [],
    week: null,
    noReply: null,
    bp: null,
    questions: null,
    lastRecord: null,
    visitsShared: grants.visit_transcripts,
    notesShared: grants.notes,
    reminder: null,
    facts: { waiting: 0, confirmed: 0 },
    // only on a copy whose link waits (a copy of a link in good standing is exactly what it was)
    ...(isHeld(input.consent) ? { reconsent: { his: !!input.consent?.his, hers: !!input.consent?.hers } } : {}),
  };
  const needDoses = grants.dose_summary || grants.no_reply_alert;
  // everything at once: each of these is a round trip on a hosted database, and none depends on another
  const [facts, meds, doses, deliveries, readings, reminders, asked, acknowledged, recording, told] = await Promise.all([
    // what she added to his details through this link, and whether he confirmed it (her own writing, whatever his switches)
    herFacts(store, scope, input.link.id),
    needDoses ? store.listMeds(scope.id) : Promise.resolve([] as MedicationRow[]),
    needDoses || grants.bp_summary ? store.listDoses(scope.id, { fromDay: today - 7, toDay: today }) : Promise.resolve([] as DoseLogRow[]),
    needDoses ? store.listDeliveries(scope.id, { fromDay: today, toDay: today }) : Promise.resolve([] as ReminderDeliveryRow[]),
    grants.bp_summary ? store.listBp(scope.id, { fromDay: today - 7, toDay: today }) : Promise.resolve([]),
    remindersView(store, scope),
    grants.questions_count ? waitingQuestions(store, scope) : Promise.resolve(null),
    // line bind: one read for a link that carries no mark, in this same round (an account's scope id is his user id)
    input.acknowledged ?? (isAccount(scope) ? linkAcknowledged(bindEntryStore(), { id: input.link.id, patient_id: scope.id }) : true),
    // scene 1 (10-15): a visit he is recording right now (her banner; whatever his switches, see below)
    isAccount(scope) && !isHeld(input.consent) ? recordingNow(store, scope, nowMs).catch(() => null) : Promise.resolve(null),
    // owner 10-16 (lib/care/told.ts): what he told Ripple today that may need attention, sent to her link. The baseline:
    // whatever his switches, and also while her link waits for the family text
    isAccount(scope) ? newestTold(store, scope.id, input.link.id, today).catch(() => null) : Promise.resolve(null),
  ]);
  if (told) out.told = told;
  // her banner: that he is recording a visit now, once he has acknowledged her link; the visit itself only with his
  // visit records (lib/care/live-visit.ts)
  if (recording && acknowledged) out.liveVisit = { id: recording.id, startedAt: recording.startedAt, shared: grants.visit_transcripts };
  out.facts = herFactsSummary(facts);

  // the reminder his phone plays (hers to see whatever his switches, once he has acknowledged her link: a family member
  // who bound his account by typing it gets nothing beyond the four default items before he has answered)
  const clip = preferredClip(reminders.clips);
  if (clip && acknowledged) {
    out.reminder = {
      text: clip.text ?? null,
      whose: clip.stand_in ? "stand_in" : clip.by === input.link.id ? "yours" : "other",
      at: scopeSlotSchedule(scope, "morning").first,
    };
  }

  if (needDoses) {
    const raw = buildDoseDay(scope, today, meds, doses, nowMs);
    const views = raw.map((s) => slotView(s, scopeTz(scope)));
    const main = mainSlot(views);
    const status = todayStatus(main, grants.no_reply_alert);
    const rawMain = main ? raw.find((r) => r.slot === main.slot) : undefined;
    const timeline = main && rawMain ? slotTimeline({ slot: main, cells: rawMain.cells, closeMs: rawMain.closeMs, deliveries, linkId: input.link.id, day: today }) : [];
    if (grants.dose_summary) {
      out.status = status;
      out.timeline = timeline;
      // this week from the rows above (they reach back seven days; the week starts on Monday, six days back at most)
      out.week = isAccount(scope) ? accountWeek(scope, meds, doses, nowMs, 0) : await familyWeek(store, scope, nowMs, 0);
    }
    if (grants.no_reply_alert && main && rawMain) {
      const answered = rawMain.cells.filter((c) => (c.state === "taken" || c.state === "missed") && c.answeredAt && Date.parse(c.answeredAt) >= rawMain.closeMs);
      const stillNoReply = main.cells.some((c) => c.mark === "no_reply");
      if (stillNoReply || answered.length) {
        const told = deliveries.find((d) => d.kind === DELIVERY.familyNoReply && d.ref === input.link.id && d.day === today && d.slot === main.slot);
        const states = new Set(main.cells.map((c) => c.mark));
        const noReply: NoReplyView = {
          slot: main,
          sentAt: told?.sent_at ?? null,
          answeredSince: !stillNoReply,
          answer: stillNoReply ? null : states.has("missed") && states.has("taken") ? "mixed" : states.has("missed") ? "missed" : "taken",
          answeredAt: answered.map((c) => c.answeredAt!).sort().at(-1) ?? null,
        };
        if (grants.dose_summary) out.noReply = noReply;
        else {
          // only 「两次提醒没回时通知她」 on: the alert is what that switch shares, so her home shows it as it would with the
          // dose switch on (the amber state, its timeline, 打电话给爸爸), but never which medicine, what he answered or the week.
          // Unchanged by the decision of 10-14: the cells go, and the reason of a dose he did not take goes with them
          const slot: SlotView = { ...main, cells: [] };
          out.noReply = { ...noReply, slot, answer: null };
          out.status = stillNoReply ? { state: "no_reply", slot, at: null } : { state: "answered", slot, at: noReply.answeredAt };
          out.timeline = alertTimeline(timeline, stillNoReply ? null : noReply.answeredAt);
        }
      }
    }
  }

  if (grants.bp_summary) {
    const monday = mondayOf(scope, today);
    // owner, 10-14: this week's readings themselves, with the count they add up to (before: the count alone)
    out.bp = { count: summarizeBp(readings, monday, today, null).count, readings: readingViews(scope, readings, monday, today) };
  }
  if (asked) {
    // owner, 10-14: the waiting questions' words, and where the next visit is (before: how many, and the date)
    const next = nextPlannedVisit(asked.visits, out.today, d0);
    // owner 10-15: with its time and its doctor when the scope has them
    const nextRow = next ? asked.visits.find((v) => v.status === "planned" && v.date === next.date) : undefined;
    const detail = nextRow ? visitDetail(scope, nextRow.id) : null;
    out.questions = {
      waiting: asked.waiting.length,
      items: questionViews(asked.waiting, asked.visits),
      nextVisit: next?.date ?? null,
      nextVisitPlace: next?.place?.trim() || null,
      nextVisitTime: detail?.time ?? null,
      nextVisitDoctor: detail?.doctor ?? null,
    };
  }

  // his last record she may know of: only from the sections she sees; a time only when he made it on that day
  const tz = scopeTz(scope);
  const records: { day: number; slot: DaySlot; created: string; what: "dose" | "bp" }[] = [];
  if (grants.dose_summary) for (const d of doses) if (d.state === "taken" || d.state === "missed") records.push({ day: d.day, slot: d.slot, created: d.created_at, what: "dose" });
  if (grants.bp_summary) for (const r of readings) if (r.state === "recorded") records.push({ day: r.day, slot: r.slot, created: r.created_at, what: "bp" });
  const order = (x: { day: number; slot: DaySlot; created: string }) => `${String(x.day + 100000).padStart(7, "0")}|${SLOT_ORDER.indexOf(x.slot)}|${x.created}`;
  const last = records.filter((x) => x.day <= today).sort((a, b) => order(a).localeCompare(order(b))).at(-1);
  if (last) {
    const date = storyDate(d0, last.day);
    out.lastRecord = { at: localDate(Date.parse(last.created), tz) === date ? last.created : null, date, slot: last.slot, what: last.what };
  }
  return out;
}

/** The sections a home shows, for her access-log row. */
export function shownSections(home: Pick<FamilyHomeData, "grants">): string[] {
  return (Object.keys(home.grants) as (keyof FamilyGrantItems)[]).filter((k) => home.grants[k]);
}

/**
 * Her home as it is now, with her look logged: her switches for this link read from the store (never taken from the
 * caller), every section that is on, and the access-log row (lib/care/access-log.ts: no copy of his day leaves without
 * it). Two rounds of calls: her switches and the recent looks, then the sections and the new row (three when the
 * questions' recorded answers are read).
 */
export async function herHomeNow(
  store: Store,
  scope: SessionRow,
  /** `consent`: her request's subject's (lib/care/reconsent.ts), said on the copy; her store has cut the switches already */
  who: { link: Pick<CareLinkRow, "id" | "patient_label" | "family_label">; userId: string; consent?: LinkConsent | null },
  nowMs: number,
  /** her switches and the recent looks when the caller has just read them with other things (her stream: lib/care/her-stream.ts) */
  have?: { grant: FamilyGrantRow | null; recent: readonly CareAccessLogRow[] },
): Promise<FamilyHomeData> {
  const [grant, recent] = have ? [have.grant, have.recent] : await Promise.all([store.getFamilyGrant(scope.id, who.link.id), recentLooks(store, scope.id)]);
  const grants = { ...NO_GRANTS, ...(grant?.items ?? {}) };
  const look = { linkId: who.link.id, userId: who.userId, label: who.link.family_label, route: "/f", items: shownSections({ grants }) };
  const [home] = await Promise.all([familyHome(store, scope, { link: who.link, grants, version: grant?.version ?? 0, consent: who.consent }, nowMs), logLookAfter(store, scope.id, look, nowMs, recent)]);
  return home;
}
