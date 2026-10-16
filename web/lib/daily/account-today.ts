/**
 * What an account's Today screen shows (C2 track B; real-app 2.7, 2.8, 2.9, 2.12, 2.25). Server-only. The demo keeps
 * app/p/today's own composition.
 *
 *   focus        the one slot that needs him now, shown first with its buttons (吃了 / 还没吃 / 等一下):
 *                  ?change=<slot>              he tapped 「改一下」 on a slot he had answered
 *                  ?when=yesterday&slot=<s>    he is logging yesterday's slot late (补记: today and yesterday only)
 *                  ?remind=dose-<slot>         he opened the reminder notice
 *                  else the slot whose reminder is due now; else a slot whose window closed with no answer (he can
 *                  still log it: 「没记（9:45）」); else the next slot of the day (「8:45 提醒你」, the buttons already
 *                  work); else a slot whose window closed before he started (real-app 4.4: not his, never 「没记」;
 *                  he may still log it, calmly: 「要记的话现在可以记」); none when every slot is answered
 *   rows         every other slot of today in one line each: answered (改一下), no answer (现在记), coming (几点提醒)
 *   yesterday    yesterday's slots left without an answer (a line each, 补记)
 *   reminder     her clip at a reminder: when the focus slot's reminder is due or he came from the notice
 *   herEyes      who will see his answer (active links with 「吃药」 switched on: 「Wei Ling 会看到：今天吃了」)
 *   bp           today's blood pressure line: what the doctor's plan asks for today, or just 「记一次」
 *   next         the next planned visit: within 14 days the countdown (and how many questions wait); a follow-up the
 *                doctor's words planned (「大约 11月20日」, real-app 2.15) at any distance, so he can set the day he booked
 *   awaitingLabel  medicines waiting for their label (real-app 2.16 「拍一下新药的药袋」)
 */
import { preferredClip } from "@/lib/family/clips";
import type { Locale } from "@/lib/i18n";
import { medName } from "@/lib/session/today";
import { isAccount, scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import type { DaySlot, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import type { NextVisit } from "@/lib/summary/account-brief";
import { localHHMM, zonedTimeToUtcMs } from "@/lib/time/clock";
import { accountBpView, type AccountBpPlanView, type BpPartState } from "./bp";
import { accountPartOf } from "./bp-changes";
import { asksNow, buildDoseDay, medsWithoutSlot, scopeSlotSchedule, waitingForHim, type SlotDay } from "./cells";
import { d0Of, routineOf } from "./doses";
import { openQuestionCount } from "./questions";
import { clipRelation } from "@/lib/safety/family-link";
import { remindersView } from "./reminders";
import { reasonOptions } from "./schedule";
import { isDaySlot, SLOT_ORDER } from "./slots";
import type { ReasonOption, ReminderClipView } from "./types";

export interface TodayParams {
  change?: string | null;
  when?: string | null;
  slot?: string | null;
  remind?: string | null;
}

export type FocusWhy = "change" | "yesterday" | "remind" | "due" | "closed" | "coming" | "untracked";

export interface AccountToday {
  day: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM now in his zone */
  time: string;
  slots: SlotDay[];
  focus: { slotDay: SlotDay; why: FocusWhy; when: "today" | "yesterday" } | null;
  /** yesterday's slots with a cell he never answered (or no reply) */
  yesterday: SlotDay[];
  /** started prescription medicines with no slot yet: he says when he takes them */
  noSlot: { id: string; name: string }[];
  /** the reason buttons after 还没吃, per day and slot: his own routine of that day around that slot first, then the fixed ones */
  reasons: Record<"today" | "yesterday", Record<DaySlot, ReasonOption[]>>;
  reminder: ReminderClipView | null;
  /** her labels (family links that see his medicine answers) */
  herEyes: string[];
  /** no prescription medicine on his list at all */
  noMeds: boolean;
  /** today's blood pressure: the doctor's plan for today, part by part (when he measured), or just the count */
  bp: {
    plan: AccountBpPlanView | null;
    parts: { part: "morning" | "evening"; remind: string; done: boolean; dueNow: boolean; state: BpPartState; time: string | null }[];
    todayCount: number;
    lastTime: string | null;
  };
  next: TodayNextVisit | null;
  /** medicines waiting for their label (prescribed at a visit he confirmed, or a new bag): 「拍一下新药的药袋」 */
  awaitingLabel: { id: string; name: string }[];
  /** when this screen next changes by itself (a reminder starts, a window closes, midnight): the page re-reads then */
  nextChangeMs: number | null;
}

const COUNTDOWN_DAYS = 14;

/** The next planned visit as Today shows it. */
export interface TodayNextVisit extends NextVisit {
  id: string;
  questions: number;
  /** within two weeks: the countdown (days left, the questions that wait) */
  soon: boolean;
  /** the date is still worked out from the doctor's words (「大约 6 周后回来」), not a day he booked: 「大约 11月20日」 */
  approx: boolean;
  /** he can set the day he booked (track V's screen /p/visit?plan=<id>, track F's PATCH /api/visits/[id]: a planned follow-up, never the example's sample visit) */
  settable: boolean;
}

/** The next planned visit on or after today, with what Today needs to know about its date (pure, from the rows). */
export function nextVisitForToday(visits: Pick<VisitRow, "id" | "status" | "date" | "place" | "script_section" | "audio_fixture">[], today: string, d0: string, questions: number): TodayNextVisit | null {
  const v = visits.filter((x) => x.status === "planned" && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!v) return null;
  const days = dayOfDate(d0, v.date) - dayOfDate(d0, today);
  const section = v.script_section ?? "";
  // lib/visit/pipeline.ts planFollowUp writes "planned:<visit>"; rescheduleFollowUp adds ":booked" once he gave the day
  const approx = section.startsWith("planned:") && !section.endsWith(":booked");
  const settable = !v.audio_fixture;
  const soon = days <= COUNTDOWN_DAYS;
  if (!soon && !settable) return null;
  return { id: v.id, date: v.date, days, place: v.place, questions, soon, approx, settable };
}

function pickFocus(today: SlotDay[], yesterday: SlotDay[], params: TodayParams): AccountToday["focus"] {
  const slotParam = (v: string | null | undefined) => (v && isDaySlot(v) ? v : null);
  const change = slotParam(params.change);
  if (change) {
    const s = today.find((x) => x.slot === change);
    if (s) return { slotDay: s, why: "change", when: "today" };
  }
  if (params.when === "yesterday") {
    const s = yesterday.find((x) => x.slot === slotParam(params.slot));
    if (s) return { slotDay: s, why: "yesterday", when: "yesterday" };
  }
  const remind = params.remind?.startsWith("dose-") ? slotParam(params.remind.slice(5)) : null;
  if (remind) {
    const s = today.find((x) => x.slot === remind && x.cells.some(waitingForHim));
    if (s) return { slotDay: s, why: "remind", when: "today" };
  }
  const due = today.find((s) => (s.phase === "first" || s.phase === "second") && s.cells.some(waitingForHim));
  if (due) return { slotDay: due, why: "due", when: "today" };
  const closed = [...today].reverse().find((s) => s.phase === "closed" && s.cells.some((c) => c.tracked && (c.state === null || (c.state === "unconfirmed" && c.reason === "no_reply"))));
  if (closed) return { slotDay: closed, why: "closed", when: "today" };
  const coming = today.find((s) => s.phase === "before" && s.cells.some((c) => c.state === null || (c.state === "unconfirmed" && c.reason === "later")));
  if (coming) return { slotDay: coming, why: "coming", when: "today" };
  const untracked = [...today].reverse().find((s) => s.phase === "closed" && s.cells.some((c) => !c.tracked && c.state === null));
  if (untracked) return { slotDay: untracked, why: "untracked", when: "today" };
  return null;
}

/** His herEyes: the labels of active links whose 「吃药」 switch is on (read through his own store: self mode). */
async function herEyes(store: Store, scope: SessionRow): Promise<string[]> {
  if (!scope.owner_user_id) return [];
  try {
    const links = await store.listCareLinks({ patient_id: scope.owner_user_id, status: ["active"] });
    const out: string[] = [];
    for (const l of links) {
      const grant = await store.getFamilyGrant(scope.id, l.id);
      if (grant?.items.dose_summary) out.push(l.family_label?.trim() || l.relation?.trim() || "");
    }
    return out.filter(Boolean);
  } catch {
    return [];
  }
}

export async function accountToday(store: Store, scope: SessionRow, nowMs: number, params: TodayParams, locale: Locale): Promise<AccountToday> {
  if (!isAccount(scope)) throw new Error("accountToday is for an account");
  // C2 track J: the scope's own "now" (a filming account's clock offset; the same instant for every other account) for
  // the time on screen and the moments of its day; nextChangeMs goes back on the app's clock for the page's TimeKeeper
  const at = scopeNow(scope, nowMs);
  const day = scope.story_day;
  const d0 = scopeD0(scope);
  const date = storyDate(d0, day);
  const [meds, doses, reminders, bpView, visits, questions, eyes] = await Promise.all([
    store.listMeds(scope.id),
    store.listDoses(scope.id, { fromDay: day - 1, toDay: day }),
    remindersView(store, scope),
    accountBpView(store, scope, locale, nowMs),
    store.listVisits(scope.id),
    openQuestionCount(store, scope),
    herEyes(store, scope),
  ]);
  const slots = buildDoseDay(scope, day, meds, doses, nowMs);
  const yesterdayAll = buildDoseDay(scope, day - 1, meds, doses, nowMs);
  const yesterday = yesterdayAll.filter((s) => s.phase === "closed" && s.cells.some((c) => c.tracked && (c.state === null || (c.state === "unconfirmed" && c.reason === "no_reply"))));
  const focus = pickFocus(slots, yesterday, params);
  // her clip: he came from the notice, or the slot asks for him now (after 等一下 it is quiet until the second reminder)
  const reminderDue = !!focus && focus.when === "today" && (focus.why === "remind" || asksNow(focus.slotDay));
  // not tied to the focus: the screen may re-read its data while he is choosing why (another device's event)
  const reasonsOn = (d: number) =>
    Object.fromEntries(SLOT_ORDER.map((slot) => [slot, reasonOptions(routineOf(scope), d0Of(scope), d, { slot, schedule: scopeSlotSchedule(scope, slot) })])) as Record<DaySlot, ReasonOption[]>;
  const reasons = { today: reasonsOn(day), yesterday: reasonsOn(day - 1) };
  const next = nextVisitForToday(visits, date, d0, questions);
  const tomorrow = storyDate(d0, day + 1);
  const moments = [
    ...slots.flatMap((x) => [x.firstMs, x.secondMs, x.closeMs]),
    ...(bpView.plan?.today ?? []).flatMap((w) => [zonedTimeToUtcMs(date, w.remind, scopeTz(scope)), zonedTimeToUtcMs(date, w.closes, scopeTz(scope))]),
    zonedTimeToUtcMs(tomorrow, "00:00", scopeTz(scope)),
  ].filter((m) => m > at);
  const todayReadings = bpView.readings.filter((r) => r.day === day && r.state === "recorded");
  return {
    day,
    date,
    time: localHHMM(at, scopeTz(scope)),
    slots,
    focus,
    yesterday,
    noSlot: medsWithoutSlot(scope, meds, day).map((m) => ({ id: m.id, name: medName(m) })),
    reasons,
    reminder: await withRelation(store, scope, reminderDue ? preferredClip(reminders.clips) : null),
    herEyes: eyes,
    noMeds: !meds.some((m) => m.origin === "prescription" && m.start_day !== null && m.start_day <= day),
    bp: {
      plan: bpView.plan,
      parts: (bpView.plan?.today ?? []).map((p) => ({
        part: p.part,
        remind: p.remind,
        done: p.done,
        dueNow: p.dueNow,
        state: p.state,
        time: bpView.readings.filter((r) => r.day === day && r.state === "recorded" && accountPartOf(r) === p.part).at(-1)?.time ?? null,
      })),
      todayCount: todayReadings.length,
      lastTime: todayReadings.at(-1)?.time ?? null,
    },
    next,
    awaitingLabel: meds.filter((m) => m.status === "awaiting_label").map((m) => ({ id: m.id, name: medName(m) })),
    nextChangeMs: moments.length ? Math.min(...moments) - (at - nowMs) : null,
  };
}

export type { DaySlot };

// ---------------------------------------------------------------- C2 track S (round 2): whose recording it is

/** Her clip with the relation of the care link it came through (real-app 6.16: the card's words come from the link). */
async function withRelation(store: Store, scope: SessionRow, clip: ReminderClipView | null): Promise<ReminderClipView | null> {
  if (!clip) return null;
  const relation = await clipRelation(store, scope, clip.id);
  return relation ? { ...clip, by_relation: relation } : clip;
}
