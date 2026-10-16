/**
 * Daily dose check-in (task M4 item 1). Server-only.
 *
 *   taken / missed      his answer (吃了 / 没吃); 没吃 then asks what happened (reason chips or his own words)
 *   unconfirmed         等下 (reason "later"), an undone answer (reason "undone", shown as not answered yet),
 *                       or no answer when the reminder window closed (reason "no_reply", see schedule.ts)
 *
 * settleNoReply() is the "timer": there is no background job, so every read of the daily screens and APIs first
 * records, for each due dose whose window has closed with no answer, unconfirmed / no_reply (and publishes
 * dose.logged). It is idempotent: a second call writes nothing. With no story time, today's window stays open.
 *
 * The store has no delete for dose rows, so undo writes the previous answer back, or unconfirmed / "undone" when
 * there was none (rendered as "not recorded yet"; the window logic still settles it as no reply later).
 *
 * C2 (an account's space): d0 and the routine come from the scope row, never the template (lib/store/scope.ts); and a
 * window is only settled when it closed after both the scope's tracking_since and the medicine's confirmation time
 * (start_at, else the moment the medicine was added): a window that closed before he started using Ripple, or before
 * he had the medicine, is not his missed dose (architecture review, finding 12). Demo rows settle as before.
 *
 * C2 track B, accounts only (the demo functions above keep their behaviour and signatures):
 *   - every slot he takes a medicine in (lib/daily/cells.ts, lib/daily/slots.ts), each with its own window;
 *   - settleNoReply settles every closed, tracked, unanswered cell since tracking began (the scheduled job, and his own
 *     reads: it is idempotent; her reads never write: family mode cannot);
 *   - answerDose writes his answer as a fresh row (an earlier row of the cell is deleted first), so the row's
 *     created_at is when he answered: 「10:20 记的」 after a window that closed at 09:45 with no reply;
 *   - undoDose deletes the row (the cell is unanswered again), or puts back the answer he had before;
 *   - the day comes from the server ("today" or "yesterday", real-app 2.8), never from the request.
 */
import { publish } from "@/lib/bus";
import type { DoseLoggedData } from "@/lib/session/events";
import { DOSE_SLOT, isDue, medName } from "@/lib/session/today";
import { isAccount, scopeD0, scopeReminderTime, scopeRoutine, scopeTz, type ScopeLike } from "@/lib/store/scope";
import { StoreError, type DaySlot, type DoseLogRow, type DoseState, type MedicationRow, type SessionRow, type Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { buildDoseDay, firstTrackedDay, openClosedCells, type DoseCell, type SlotDay } from "./cells";
import { shownState } from "./dose-state";
import { shortDay } from "./i18n";
import { reminderSchedule, windowClosed, type RoutineEntry } from "./schedule";
import { answerPreTracking, trackedAfterMs } from "./tracking";
import type { ReminderSchedule, TodayDose } from "./types";

/** His routine: the scope's own (an account), else the template's (the demo). */
export function routineOf(session: ScopeLike): RoutineEntry[] {
  return scopeRoutine(session) as RoutineEntry[];
}

/** Day 0: the account's d0, else the template's (the demo: 2026-08-24). */
export function d0Of(session: ScopeLike): string {
  return scopeD0(session);
}

/** Morning schedule: his own reminder time (an account's settings), else the first clip's plays_at, else after breakfast. */
export async function scheduleFor(store: Store, session: SessionRow): Promise<ReminderSchedule> {
  const clips = await store.listReminderClips(session.id);
  return reminderSchedule(routineOf(session), scopeReminderTime(session) ?? clips[0]?.plays_at ?? "after_breakfast");
}

/**
 * The earliest moment (epoch ms) after which a window of this medicine counts as his, on an account: the later of
 * the scope's tracking_since and the medicine's start_at (else when it was added). null on a demo row (no bound).
 * (Lives in ./tracking so lib/daily/cells.ts can use it too.)
 */
export { trackedAfterMs };

/** When the answer window of this day closes, as an instant in the scope's time (d0 + day at `closes` in its zone). */
export function windowCloseMs(session: SessionRow, day: number, closes: string): number {
  return zonedTimeToUtcMs(storyDate(scopeD0(session), day), closes, scopeTz(session));
}

export { shownState };

/** Today's due doses (prescriptions by start day, morning slot) with his answers and reasons. */
export async function todayDoses(store: Store, session: SessionRow): Promise<TodayDose[]> {
  const day = session.story_day;
  const [meds, doses] = await Promise.all([store.listMeds(session.id), store.listDoses(session.id, { fromDay: day, toDay: day })]);
  return meds
    .filter((m) => isDue(m, day))
    .map((m) => {
      const row = doses.find((d) => d.medication_id === m.id && d.slot === DOSE_SLOT) ?? null;
      return {
        medication_id: m.id,
        day,
        slot: DOSE_SLOT,
        name: medName(m),
        strength: m.label?.strength ?? null,
        label_confirmed: m.status === "label_confirmed" || m.status === "pharmacist_checked",
        state: shownState(row),
        reason: row && shownState(row) !== null ? row.reason : null,
        reason_text: row && shownState(row) !== null ? row.reason_text : null,
      };
    });
}

/**
 * Record unconfirmed / no_reply for every due morning dose whose answer window has closed with no answer (no row,
 * or an undone one). Returns the rows it wrote.
 *
 * An account (C2 track B): every slot, every day since tracking began, tracked cells only (settleAccountNoReply).
 */
export async function settleNoReply(store: Store, session: SessionRow): Promise<DoseLogRow[]> {
  if (isAccount(session)) return (await settleAccountNoReply(store, session, appNowMs())).map((s) => s.dose);
  const schedule = await scheduleFor(store, session);
  const [meds, doses] = await Promise.all([store.listMeds(session.id), store.listDoses(session.id, { toDay: session.story_day })]);
  const written: DoseLogRow[] = [];
  const by = isAccount(session) ? "system" : "director";
  for (const m of meds) {
    if (!isDue(m, session.story_day) || m.start_day === null) continue;
    const after = trackedAfterMs(session, m);
    for (let day = m.start_day; day <= session.story_day; day++) {
      if (!windowClosed(day, session.story_day, session.story_time, schedule)) continue;
      // an account: only windows that closed after he started tracking and after he had this medicine
      if (after !== null && windowCloseMs(session, day, schedule.closes) <= after) continue;
      const row = doses.find((d) => d.medication_id === m.id && d.day === day && d.slot === DOSE_SLOT);
      if (row && shownState(row) !== null) continue;
      const dose = await store.logDose(session.id, { medication_id: m.id, day, slot: DOSE_SLOT, state: "unconfirmed", reason: "no_reply" });
      written.push(dose);
      const name = medName(m);
      publish<DoseLoggedData>(
        session.id,
        "dose.logged",
        `No reply after two reminders: ${name}, Day ${day} ${DOSE_SLOT}, recorded as not confirmed (window closed ${schedule.closes})`,
        { dose, name, by },
      );
    }
  }
  return written;
}

export interface CheckInInput {
  medication_id: string;
  slot: DaySlot;
  state: DoseState;
  day?: number;
  reason?: string | null;
  reason_text?: string | null;
}

const WORDS: Record<DoseState, string> = { taken: "taken", missed: "not taken", unconfirmed: "later (not confirmed yet)" };

/** Write one answer (or an undo) and publish dose.logged; the same event shape as M0's tick. */
export async function checkIn(store: Store, session: SessionRow, input: CheckInInput): Promise<DoseLogRow> {
  const med = await store.getMed(session.id, input.medication_id);
  if (!med) throw new StoreError("not_found", `No medication ${input.medication_id}`);
  const day = input.day ?? session.story_day;
  const dose = await store.logDose(session.id, {
    medication_id: med.id,
    day,
    slot: input.slot,
    state: input.state,
    reason: input.reason ?? null,
    reason_text: input.reason_text ?? null,
  });
  const name = medName(med);
  const why = input.reason && !["later", "undone"].includes(input.reason) ? ` (reason: ${input.reason_text || input.reason})` : "";
  const when = dayWords(session, day);
  const say =
    input.reason === "undone"
      ? `${who(session)} undid his answer: ${name}, ${when} ${input.slot} (no answer yet)`
      : `${who(session)} ticked ${WORDS[input.state]}: ${name}, ${when} ${input.slot}${why}`;
  publish<DoseLoggedData>(session.id, "dose.logged", say, { dose, name, by: "patient" });
  return dose;
}

// ---------------------------------------------------------------- C2 track B: an account's answers and settling

/**
 * A day in a backstage sentence: the demo's story day ("Day 43"), an account's real date ("12 Oct"). An account's
 * sentences never carry a story day or its scope id (F1 handoff; architecture review H4).
 */
export function dayWords(scope: Pick<SessionRow, "kind" | "d0" | "template">, day: number): string {
  return isAccount(scope) ? shortDay("en", storyDate(scopeD0(scope), day)) : `Day ${day}`;
}

/** Who answered, in a backstage sentence: the demo's Mr Tan; on an account, no name (he is not the story's Mr Tan). */
function who(scope: Pick<SessionRow, "kind">): string {
  return isAccount(scope) ? "He" : "Mr Tan";
}

/** "today" or "yesterday": the only days an account may answer for (real-app 2.8; the server picks the day). */
export type AnswerDay = "today" | "yesterday";

export function dayOf(scope: Pick<SessionRow, "story_day">, when: AnswerDay | undefined): number {
  return when === "yesterday" ? scope.story_day - 1 : scope.story_day;
}

/** Why an answer cannot be written (the route turns these into 4xx). */
export class DoseAnswerError extends Error {
  constructor(
    readonly code: "not_found" | "not_due" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "DoseAnswerError";
  }
}

export interface AnswerInput {
  medication_id: string;
  slot: DaySlot;
  state: DoseState;
  reason?: string | null;
  reason_text?: string | null;
  when?: AnswerDay;
  /**
   * C2 track O (real-app 2.25): an answer kept on the phone while there was no network, sent late. The cell's day and the
   * moment he tapped, both worked out by the server (lib/offline/late.ts lateDose), never taken from the request as sent.
   */
  late?: { day: number; at: string };
}

/** The cell an account's answer is about, or a DoseAnswerError (no such medicine, or no such cell on that day). */
async function cellFor(store: Store, scope: SessionRow, medicationId: string, slot: DaySlot, day: number, nowMs: number): Promise<{ slotDay: SlotDay; cell: DoseCell; med: MedicationRow }> {
  const med = await store.getMed(scope.id, medicationId);
  if (!med) throw new DoseAnswerError("not_found", `No medication ${medicationId}`);
  const doses = await store.listDoses(scope.id, { fromDay: day, toDay: day, medication_id: med.id });
  const slotDay = buildDoseDay(scope, day, [med], doses, nowMs).find((s) => s.slot === slot);
  const cell = slotDay?.cells.find((c) => c.medicationId === med.id);
  if (!slotDay || !cell) throw new DoseAnswerError("not_due", `${medName(med)} is not taken in the ${slot} slot on that day`);
  return { slotDay, cell, med };
}

/**
 * His answer on an account (吃了 / 还没吃 + why / 等一下): the cell's earlier row, if any, is deleted and the answer is
 * written as a fresh row, so its created_at is when he answered. Publishes dose.logged (by patient).
 *
 * The fresh row says what it is to a cell outside tracking (real-app 4.4; lib/daily/tracking.ts answerPreTracking),
 * read from the cell before its earlier row goes: a correction of an answer that counted there (the example's laid-out
 * mornings, 「昨天」 through the API) counts in its place, so the morning keeps its place in every count with the new
 * answer; an answer on a window that was never his and held nothing that counted is his own note on Today.
 */
export async function answerDose(store: Store, scope: SessionRow, input: AnswerInput, nowMs: number = appNowMs()): Promise<DoseLogRow> {
  if (!isAccount(scope)) throw new DoseAnswerError("invalid", "answerDose is for an account (the demo uses checkIn)");
  if (input.reason === "undone") throw new DoseAnswerError("invalid", "undo is DELETE /api/doses");
  const day = input.late?.day ?? dayOf(scope, input.when); // track O: a late answer names its own day
  const { cell, med } = await cellFor(store, scope, input.medication_id, input.slot, day, nowMs);
  const preTracking = answerPreTracking(cell);
  if (cell.row) await store.deleteDose(scope.id, cell.row.id).catch((err: unknown) => {
    if (!(err instanceof StoreError && err.code === "not_found")) throw err;
  });
  const dose = await store.logDose(scope.id, {
    medication_id: med.id,
    day,
    slot: input.slot,
    state: input.state,
    reason: input.reason ?? null,
    reason_text: input.reason_text ?? null,
    pre_tracking: preTracking,
    ...(input.late ? { created_at: input.late.at } : {}), // track O: when he tapped, not when it arrived
  });
  const name = medName(med);
  const why = input.reason && !["later", "no_reply"].includes(input.reason) ? ` (reason: ${input.reason_text || input.reason})` : "";
  const words = input.state === "unconfirmed" && input.reason === "later" ? "later (not confirmed yet)" : WORDS[input.state];
  publish<DoseLoggedData>(scope.id, "dose.logged", `He ticked ${words}: ${name}, ${dayWords(scope, day)} ${input.slot}${why}`, { dose, name, by: "patient" });
  return dose;
}

export interface UndoInput {
  medication_id: string;
  slot: DaySlot;
  when?: AnswerDay;
  /** the answer he had before the one being undone (from his undo bar); without it the cell is left unanswered */
  restore?: { state: DoseState; reason?: string | null; reason_text?: string | null } | null;
}

/**
 * Undo on an account: the cell's row is deleted (no answer again, e2e-chains 序 24), or, when he had answered before,
 * that answer is written back (a fresh row). Returns the row now in the cell, or null.
 */
export async function undoDose(store: Store, scope: SessionRow, input: UndoInput, nowMs: number = appNowMs()): Promise<DoseLogRow | null> {
  if (!isAccount(scope)) throw new DoseAnswerError("invalid", "undoDose is for an account (the demo writes 'undone')");
  // the answer he had before goes back as an answer: answerDose replaces the row itself, and reads what the cell held
  // before it does (a put-back on a laid-out morning still counts; deleting first would make it a note)
  if (input.restore) {
    return answerDose(store, scope, { medication_id: input.medication_id, slot: input.slot, when: input.when, ...input.restore }, nowMs);
  }
  const day = dayOf(scope, input.when);
  const { cell, med } = await cellFor(store, scope, input.medication_id, input.slot, day, nowMs);
  if (cell.row) await store.deleteDose(scope.id, cell.row.id).catch((err: unknown) => {
    if (!(err instanceof StoreError && err.code === "not_found")) throw err;
  });
  const name = medName(med);
  // the cell has no row now: dose.logged with the deleted row read as "no answer" (state unconfirmed, reason undone),
  // so every open page clears it the way it always read an undone answer (lib/daily/dose-state.ts shownState)
  const gone: DoseLogRow = {
    id: cell.row?.id ?? `undone-${med.id}-${day}-${input.slot}`,
    session_id: scope.id,
    medication_id: med.id,
    day,
    slot: input.slot,
    state: "unconfirmed",
    reason: "undone",
    reason_text: null,
    created_at: new Date(nowMs).toISOString(),
  };
  publish<DoseLoggedData>(scope.id, "dose.logged", `He undid his answer: ${name}, ${dayWords(scope, day)} ${input.slot} (no answer yet)`, { dose: gone, name, by: "patient" });
  return null;
}

/** One cell the settling wrote as "no reply". */
export interface SettledCell {
  dose: DoseLogRow;
  name: string;
  slot: DaySlot;
  day: number;
  /** HH:MM the window closed */
  closes: string;
  closeMs: number;
}

/**
 * An account's settling (the scheduled job; his own reads too, it is idempotent): every cell since tracking began whose
 * window has closed, that is tracked (lib/daily/cells.ts: it closed after the scope's tracking_since and after he had
 * the medicine) and has no answer, becomes unconfirmed / no_reply, written by the system (real-app 6.5, 3.11: 只结算关窗
 * 晚于 max(tracking_since, start_at) 的格子). Not only yesterday and today: a server that was down for three days, or a
 * phone he did not open for a week, leaves no tracked cell without its row, so the record and the summaries (which count
 * such a cell as not confirmed either way) say the same. "Later" (等一下) is an answer and stays as it is. Returns what
 * it wrote, oldest first. Her alert is not sent from here and never for an old cell (lib/daily/dose-run.ts).
 */
export async function settleAccountNoReply(store: Store, scope: SessionRow, nowMs: number): Promise<SettledCell[]> {
  if (!isAccount(scope)) return [];
  const today = scope.story_day;
  const meds = await store.listMeds(scope.id);
  const first = firstTrackedDay(scope, meds);
  if (first === null) return [];
  const fromDay = Math.min(first, today);
  const doses = await store.listDoses(scope.id, { fromDay, toDay: today });
  const out: SettledCell[] = [];
  for (const cell of openClosedCells(scope, meds, doses, fromDay, today, nowMs)) {
    // an old "undone" row (written by a demo-era client) is replaced like no row at all
    if (cell.row) await store.deleteDose(scope.id, cell.row.id).catch(() => undefined);
    const name = medName(cell.med);
    // a tracked cell's own record (never laid-out history): a plain row, like his answers (DoseLogRow.pre_tracking)
    const dose = await store.logDose(scope.id, { medication_id: cell.med.id, day: cell.day, slot: cell.slot, state: "unconfirmed", reason: "no_reply", pre_tracking: false });
    out.push({ dose, name, slot: cell.slot, day: cell.day, closes: cell.schedule.closes, closeMs: cell.closeMs });
    publish<DoseLoggedData>(
      scope.id,
      "dose.logged",
      `No reply after two reminders: ${name}, ${dayWords(scope, cell.day)} ${cell.slot}, recorded as not confirmed (window closed ${cell.schedule.closes})`,
      { dose, name, by: "system" },
    );
  }
  return out;
}
