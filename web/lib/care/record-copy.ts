/**
 * The words of 「留意」 on her phone (/f/alert; owner 10-14: only what needs attention is listed, each with a follow-up;
 * everything routine is one line and a way to her calendar). Client-safe, pure. Same pattern as lib/care/her-copy.ts:
 * every sentence in zh-Hans and en, `{dad}` is how she calls him ({his}: her word's 他的 / 她的, or the word itself).
 *
 * The register is a clinical log's: 未服药, 未回应, 血压测量, 就诊. Never the spoken words 吃了 / 没吃 / 没回 on this page,
 * which is why the parts of the day are said here (早间 / 午间 / 晚间 / 睡前) and not taken from another screen's copy.
 *
 * What a sentence here may be: a fact from his record; his own words, quoted and attributed; a comparison of a reading
 * with a number his doctor gave (the doctor's own target, the doctor's own warning level); a QUESTION for the doctor or
 * the pharmacist. Nothing here says what to take, how much, when, or to change or stop a medicine, and nothing judges a
 * reading or an answer on its own.
 */
import type { Locale } from "@/lib/i18n";
import type { DaySlot } from "@/lib/store/types";
import { fillHer } from "./copy";

const zh = {
  // ---- the day an item belongs to
  dayToday: "今天",
  dayYesterday: "昨天",
  // ---- what needs attention (his last 14 days)
  attnHead: "需要留意",
  attnNone: "近 14 日没有需要留意的事。",
  /** he shares nothing with her yet: nothing can be said about his days */
  emptyOff: "{dad}尚未分享任何记录。",
  // ---- everything else, in one line (his last 7 days)
  restHead: "其余记录",
  restLead: "近 7 日",
  restLine: "{lead}：{parts}",
  restDoses: "已服药 {n} 次",
  restDosesOne: "已服药 1 次",
  restBp: "血压测量 {n} 次",
  restBpOne: "血压测量 1 次",
  restVisits: "就诊 {n} 次",
  restVisitsOne: "就诊 1 次",
  restLink: "在日历中查看每日记录",
  // ---- a dose he recorded as not taken
  doseMissedTitle: "{meds} 未服药",
  whySaid: "{dad}说：「{words}」",
  whyNone: "未说明原因",
  // ---- two reminders, no response
  noReplyTitle: "两次提醒均未回应",
  // ---- a reading above a number his doctor gave
  bpWarnTitle: "血压 {bp}，高于医生设定的警戒值 {n}",
  bpTargetTitle: "血压 {bp}，高于医生设定的目标 {target}",
  bpTargetDays: "近 14 日有 {n} 天血压高于医生设定的目标 {target}",
  bpDayLine: "{when}　{bp}",
  // ---- the next planned visit
  nextTitle: "下次就诊",
  visitToday: "今天就诊",
  visitTomorrow: "明天就诊",
  visitIn: "{n} 天后就诊",
  visitWaiting: "问题单上有 {n} 个问题待问",
  visitWaitingOne: "问题单上有 1 个问题待问",
  // ---- his notes
  noteTyped: "笔记",
  noteVoice: "语音笔记",
  /** his own words, as said */
  said: "「{words}」",
  // ---- the follow-up of an item
  followAskDoctor: "建议问医生",
  followAskPharmacist: "建议问药剂师",
  followDo: "可以做的",
  addBtn: "加入问题单",
  added: "已加入问题单",
  addOff: "{dad}没有分享问题单，可以直接转告。",
  addFailed: "没有加上，请再试一次。",
  /** her link is one she bound herself and he has not answered yet: nothing of hers reaches his phone until he does */
  addLocked: "等{dad}在自己的手机上点了「知道了」，才能加入问题单。",
  addAside: "{dad}已将这个问题搁置。",
  // ---- the suggested questions (a question for his doctor, built from his own record; never an instruction)
  askOwn: "{when}的 {med} 未服用，原因是「{reason}」。遇到这种情况，服药时间可以怎么安排？",
  askForgot: "{when}的 {med} 忘记服用。漏服一次后应该怎么处理？",
  askAway: "{when}外出，{med} 未服用。外出时服药时间可以怎么安排？",
  askNotWithMe: "{when}药不在身边，{med} 未服用。这种情况应该怎么处理？",
  askNone: "{when}的 {med} 未服用。漏服一次后应该怎么处理？",
  askBp: "近 7 日有 {n} 次血压高于目标 {target}，最高 {max}。需要注意什么？",
  /** one reading above the target in the last 7 days (the sentence above, for one) */
  askBpOnce: "近 7 日有 1 次血压高于目标 {target}，为 {max}。需要注意什么？",
  /** the reading is more than 7 days back and none since was above the target: the question names that reading */
  askBpDay: "{when}血压 {bp}，高于目标 {target}。需要注意什么？",
  askNote: "{when}的记录：「{words}」。这种情况需要注意什么？",
};

export type RecordKey = keyof typeof zh;

const en: Record<RecordKey, string> = {
  dayToday: "Today",
  dayYesterday: "Yesterday",
  attnHead: "Needs attention",
  attnNone: "Nothing needs attention in the last 14 days.",
  emptyOff: "{dad} isn't sharing any records yet.",
  restHead: "Everything else",
  restLead: "Last 7 days",
  restLine: "{lead}: {parts}",
  restDoses: "{n} doses taken",
  restDosesOne: "1 dose taken",
  restBp: "{n} blood pressure readings",
  restBpOne: "1 blood pressure reading",
  restVisits: "{n} clinic visits",
  restVisitsOne: "1 clinic visit",
  restLink: "See each day in the calendar",
  doseMissedTitle: "{meds} not taken",
  whySaid: "{dad} said: “{words}”",
  whyNone: "No reason given",
  noReplyTitle: "Two reminders, no response",
  bpWarnTitle: "Blood pressure {bp}, above the doctor's warning level of {n}",
  bpTargetTitle: "Blood pressure {bp}, above the doctor's target of {target}",
  bpTargetDays: "Blood pressure above the doctor's target of {target} on {n} days in the last 14",
  bpDayLine: "{when}: {bp}",
  nextTitle: "Next clinic visit",
  visitToday: "Clinic visit today",
  visitTomorrow: "Clinic visit tomorrow",
  visitIn: "Clinic visit in {n} days",
  visitWaiting: "{n} questions waiting on the list",
  visitWaitingOne: "1 question waiting on the list",
  noteTyped: "Note",
  noteVoice: "Voice note",
  said: "“{words}”",
  followAskDoctor: "Suggested question for the doctor",
  followAskPharmacist: "Suggested question for the pharmacist",
  followDo: "What you can do",
  addBtn: "Add to the question list",
  added: "On the question list",
  addOff: "{dad} isn't sharing the question list. You can pass it on directly.",
  addFailed: "That didn't go through. Please try again.",
  addLocked: "Once {dad} taps “Got it” on {his} own phone, this can go on the question list.",
  addAside: "{dad} has set this question aside.",
  askOwn: "The {when} dose of {med} was not taken. The reason given: “{reason}”. How should the timing be handled when this happens?",
  askForgot: "The {when} dose of {med} was forgotten. What should be done after a missed dose?",
  askAway: "Out on {when}, so {med} was not taken. How should doses be timed on days out?",
  askNotWithMe: "The medicine was not at hand on {when}, so {med} was not taken. What should be done in that case?",
  askNone: "The {when} dose of {med} was not taken. What should be done after a missed dose?",
  askBp: "{n} readings in the last 7 days were above the target of {target}; the highest was {max}. Is there anything to watch for?",
  askBpOnce: "1 reading in the last 7 days was above the target of {target}: {max}. Is there anything to watch for?",
  askBpDay: "Blood pressure on {when} was {bp}, above the target of {target}. Is there anything to watch for?",
  askNote: "Noted on {when}: “{words}”. Is there anything to watch for?",
};

const messages: Record<Locale, Record<RecordKey, string>> = { "zh-Hans": zh, en };

/** One of the page's fixed phrases, with its names and numbers filled in (the words for him from `vars.dad`: lib/care/copy.ts fillHer). */
export function rc(locale: Locale, key: RecordKey, vars: Record<string, string | number> = {}): string {
  return fillHer(messages[locale]?.[key] ?? zh[key], locale, vars);
}

/** Every phrase of the page in one language, with its key (for a word scan). */
export function allRecordStrings(locale: Locale): [RecordKey, string][] {
  return Object.entries(messages[locale]) as [RecordKey, string][];
}

const SLOT: Record<Locale, Record<DaySlot, string>> = {
  "zh-Hans": { morning: "早间", midday: "午间", evening: "晚间", night: "睡前" },
  en: { morning: "Morning", midday: "Midday", evening: "Evening", night: "Bedtime" },
};

/** The part of his day, as this page says it: 「早间」 / "Morning". */
export const slotWord = (slot: DaySlot, locale: Locale): string => SLOT[locale][slot];

/** Several names in a row: 「Amlodipine、Losartan」 / "Amlodipine, Losartan". */
export const recordList = (items: readonly string[], locale: Locale): string => items.join(locale === "zh-Hans" ? "、" : ", ");

/** A count with its noun, the one-of-it sentence where English needs another word. */
export function counted(locale: Locale, many: RecordKey, one: RecordKey, n: number): string {
  return n === 1 ? rc(locale, one) : rc(locale, many, { n });
}

/**
 * The one line of 「其余记录」: 「近 7 日：已服药 12 次 · 血压测量 5 次 · 就诊 1 次」. A part that counts nothing is left
 * out; null when every part does (the section is then not drawn).
 */
export function restLine(counts: { doses: number; bp: number; visits: number }, locale: Locale): string | null {
  const parts: string[] = [];
  if (counts.doses > 0) parts.push(counted(locale, "restDoses", "restDosesOne", counts.doses));
  if (counts.bp > 0) parts.push(counted(locale, "restBp", "restBpOne", counts.bp));
  if (counts.visits > 0) parts.push(counted(locale, "restVisits", "restVisitsOne", counts.visits));
  return parts.length ? rc(locale, "restLine", { lead: rc(locale, "restLead"), parts: parts.join(" · ") }) : null;
}
