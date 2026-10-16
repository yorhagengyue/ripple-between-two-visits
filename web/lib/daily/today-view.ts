/**
 * The plain data an account's Today screen hands to the browser (C2 track B). Built on the server from
 * lib/daily/account-today.ts; client-safe types. No scope id, no row id but the medicine's, no story day.
 */
import type { Locale } from "@/lib/i18n";
import type { DaySlot, DoseState } from "@/lib/store/types";
import { localHHMM } from "@/lib/time/clock";
import type { AccountToday, FocusWhy } from "./account-today";
import type { SlotDay } from "./cells";
import type { ReminderSchedule } from "./types";

export interface DoseMedView {
  medicationId: string;
  name: string;
  strength: string | null;
  /** the label's own words */
  labelWords: string | null;
  /** the label line's Mandarin slot template (药袋上写着：…), or null */
  labelZh: string | null;
  /** he chose the time himself (no time words on the label) */
  slotChosen: boolean;
  state: DoseState | null;
  reason: string | null;
  reasonText: string | null;
  /** local HH:MM he answered */
  answeredTime: string | null;
  tracked: boolean;
}

export interface DoseSlotView {
  slot: DaySlot;
  when: "today" | "yesterday";
  /** YYYY-MM-DD */
  date: string;
  schedule: ReminderSchedule;
  phase: SlotDay["phase"];
  meds: DoseMedView[];
}

export interface ReasonView {
  code: string;
  label: string;
}

export interface TodayDoseData {
  /** his time zone (the answers' times are shown in it) */
  tz: string;
  date: string;
  /** HH:MM now */
  time: string;
  focus: { slot: DoseSlotView; why: FocusWhy } | null;
  /** today's other slots */
  others: DoseSlotView[];
  /** yesterday's slots left without an answer */
  yesterday: DoseSlotView[];
  /** the reason buttons after 还没吃, per day and slot (his own routine around that slot first), in his language */
  reasons: Record<"today" | "yesterday", Record<DaySlot, ReasonView[]>>;
  herEyes: string[];
  noMeds: boolean;
  noSlot: { id: string; name: string }[];
  /** medicines waiting for their label: 「拍一下新药的药袋」 opens the camera page for that medicine */
  awaitingLabel: { id: string; name: string }[];
}

function slotView(s: SlotDay, when: "today" | "yesterday", tz: string): DoseSlotView {
  return {
    slot: s.slot,
    when,
    date: s.date,
    schedule: s.schedule,
    phase: s.phase,
    meds: s.cells.map((c) => ({
      medicationId: c.medicationId,
      name: c.name,
      strength: c.strength,
      labelWords: c.labelWords,
      labelZh: c.labelZh,
      slotChosen: c.slotSource === "patient",
      state: c.state,
      reason: c.reason,
      reasonText: c.reasonText,
      answeredTime: c.answeredAt ? localHHMM(Date.parse(c.answeredAt), tz) : null,
      tracked: c.tracked,
    })),
  };
}

export function todayDoseData(t: AccountToday, locale: Locale, tz: string): TodayDoseData {
  const focusSlot = t.focus ? slotView(t.focus.slotDay, t.focus.when, tz) : null;
  return {
    tz,
    date: t.date,
    time: t.time,
    focus: focusSlot && t.focus ? { slot: focusSlot, why: t.focus.why } : null,
    others: t.slots.filter((s) => !(t.focus && t.focus.when === "today" && s.slot === t.focus.slotDay.slot)).map((s) => slotView(s, "today", tz)),
    yesterday: t.yesterday.filter((s) => !(t.focus && t.focus.when === "yesterday" && s.slot === t.focus.slotDay.slot)).map((s) => slotView(s, "yesterday", tz)),
    reasons: { today: reasonViews(t.reasons.today, locale), yesterday: reasonViews(t.reasons.yesterday, locale) },
    herEyes: t.herEyes,
    noMeds: t.noMeds,
    noSlot: t.noSlot,
    awaitingLabel: t.awaitingLabel,
  };
}

function reasonViews(bySlot: AccountToday["reasons"]["today"], locale: Locale): Record<DaySlot, ReasonView[]> {
  const out = {} as Record<DaySlot, ReasonView[]>;
  for (const slot of Object.keys(bySlot) as DaySlot[]) out[slot] = bySlot[slot].map((r) => ({ code: r.code, label: locale === "zh-Hans" ? r.label.zh : r.label.en }));
  return out;
}

/** The reason buttons for a slot on screen: that day's, that slot's. */
export function reasonsFor(data: Pick<TodayDoseData, "reasons">, slot: Pick<DoseSlotView, "slot" | "when">): ReasonView[] {
  return data.reasons[slot.when === "yesterday" ? "yesterday" : "today"][slot.slot] ?? [];
}

/** A cell he still has to answer in a slot (no answer, 等一下, or the system's no reply). */
export function stillOpen(m: Pick<DoseMedView, "state" | "reason">): boolean {
  return m.state === null || (m.state === "unconfirmed" && (m.reason === "later" || m.reason === "no_reply"));
}
