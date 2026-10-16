/**
 * The words of her month calendar (/f/month; owner 10-14: 「日历页面应该是一份月份的日历」). Client-safe, pure. Same pattern
 * as lib/care/her-copy.ts: `zh-Hans` and `en`, every phrase a fixed template with names and numbers filled in.
 * `{dad}` is how she calls him (herPage gives it). Short phrases, no full stop on a heading, nothing clinical: the
 * page repeats what he recorded and never says what to do about it.
 *
 * Words that exist already are used from where they are and are not written again here: the place's name 「日历」
 * (lib/ui/copy.ts familyCopy().tabs.week), the weekday letters and 「10月14日 周三」 (lib/care/copy.ts weekdayShort,
 * dateLine), 「这些是爸爸同意给你看的。」 (privacyLine) and the kind of a visit (lib/care/visit-words.ts). His reason for
 * 「没吃」, a medicine's name, a place and a question are his records' own words, shown as they are stored.
 *
 * Owner 10-15 (the demo video): a reading outside the target his doctor set is said as her 「留意」 says it (「高于医生设定的
 * 目标」, lib/care/record-copy.ts), with the doctor's numbers, who and when; what he said happened that day, his notes, the
 * visit's time and doctor, and the day's sheet's 「关闭」.
 */
import type { Locale } from "@/lib/i18n";
import type { DaySlot } from "@/lib/store/types";
import { fillHer } from "./copy";

const zh = {
  // ---- the month's own row: one month back, back to this month, one month on
  navLabel: "换月份",
  prev: "上一个月",
  next: "下一个月",
  today: "今天",
  // ---- what each marker means (the legend's words; a cell's marker says the same to a screen reader)
  legendLabel: "图例",
  lg_taken: "全部已服药",
  lg_missed: "有未服药",
  lg_no_reply: "提醒未回应",
  lg_pending: "待记录",
  lg_bp: "血压测量",
  lg_bpAbove: "血压高于医生设定的目标",
  lg_visit: "就诊",
  // ---- the chosen day
  dayEmpty: "这天没有{dad}分享的记录",
  st_taken: "已服药",
  st_missed: "未服药",
  st_no_reply: "未回应",
  st_waiting: "待回应",
  st_pending: "未到时间",
  st_untracked: "无记录",
  slot_morning: "早间",
  slot_midday: "午间",
  slot_evening: "晚间",
  slot_night: "睡前",
  reason: "原因：{reason}",
  bp: "血压",
  pulse: "脉搏 {n}",
  visitPast: "就诊",
  visitPlanned: "预约就诊",
  visitLines: "{dad}已确认 {n} 条",
  askDoctor: "待问医生",
  askPharmacist: "待问药剂师",
  // ---- owner 10-15: a reading outside the doctor's target, what he said that day, his notes, the day's sheet
  /** 「高于林医生设定的目标 135/85（9月3日）」 */
  bpAbove: "高于{doctor}设定的目标 {target}（{date}）",
  theDoctor: "医生",
  /** what he said happened that day, his words as stored */
  bpReason: "{dad}记下：「{words}」",
  /** under one of his notes */
  noteSub: "{dad}记的",
  /** a question Ripple wrote from his reading and his words */
  fromReading: "来自血压读数",
  close: "关闭",
};

export type MonthKey = keyof typeof zh;

/** Every key of the page's phrases (for a word scan: tests/unit/care/her-pronoun.test.ts). */
export const monthKeys = (): MonthKey[] => Object.keys(zh) as MonthKey[];

const en: Record<MonthKey, string> = {
  navLabel: "Change month",
  prev: "Previous",
  next: "Next",
  today: "Today",
  legendLabel: "Legend",
  lg_taken: "All medicine taken",
  lg_missed: "A medicine not taken",
  lg_no_reply: "No reply",
  lg_pending: "Not logged yet",
  lg_bp: "Blood pressure measured",
  lg_bpAbove: "Blood pressure above the doctor's target",
  lg_visit: "Visit",
  dayEmpty: "Nothing {dad} shares on this day",
  st_taken: "Taken",
  st_missed: "Not taken",
  st_no_reply: "No reply",
  st_waiting: "No answer yet",
  st_pending: "Not yet",
  st_untracked: "No record",
  slot_morning: "Morning",
  slot_midday: "Midday",
  slot_evening: "Evening",
  slot_night: "Bedtime",
  reason: "Reason: {reason}",
  bp: "Blood pressure",
  pulse: "Pulse {n}",
  visitPast: "Visit",
  visitPlanned: "Visit planned",
  visitLines: "{dad} confirmed {n} lines",
  askDoctor: "To ask the doctor",
  askPharmacist: "To ask the pharmacist",
  bpAbove: "Above the target {doctor} set: {target} ({date})",
  theDoctor: "the doctor",
  bpReason: "{dad} noted: “{words}”",
  noteSub: "{dad}'s note",
  fromReading: "From a blood pressure reading",
  close: "Close",
};

const messages: Record<Locale, Record<MonthKey, string>> = { "zh-Hans": zh, en };

/** One phrase of the page, its names filled in (the words for him from `vars.dad`, as lib/care/copy.ts fillHer does). */
export function mc(locale: Locale, key: MonthKey, vars: Record<string, string | number> = {}): string {
  return fillHer(messages[locale]?.[key] ?? zh[key], locale, vars);
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" -> 「2026年10月」 / "October 2026" */
export function monthWords(ym: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  const mo = Number(m[2]);
  return locale === "zh-Hans" ? `${m[1]}年${mo}月` : `${MONTHS_EN[mo - 1] ?? ""} ${m[1]}`.trim();
}

/** The part of the day a medicine or a reading belongs to: 「早上」 / "Morning". */
export const slotWord = (slot: DaySlot, locale: Locale) => mc(locale, `slot_${slot}` as MonthKey);

/** One medicine's answer in a word: 「吃了」「没吃」「没回」「还没回」「还没到」「没有记录」. */
export const stateWord = (mark: string, locale: Locale) => (`st_${mark}` in zh ? mc(locale, `st_${mark}` as MonthKey) : "");

/** 「爸爸确认了 3 句」 / "Dad confirmed 3 lines" ("1 line"). */
export function linesWords(n: number, dad: string, locale: Locale): string {
  const t = mc(locale, "visitLines", { dad, n });
  return locale === "en" && n === 1 ? t.replace(/lines$/, "line") : t;
}

/**
 * 「原因：打太极」: the reason he gave for 「没吃」, as it is stored with his answer (the choice he tapped, or his own words:
 * lib/care/home.ts cellReason, the rule her home follows); null when he gave none.
 */
export function reasonWords(reason: string | null, locale: Locale): string | null {
  return reason ? mc(locale, "reason", { reason }) : null;
}
