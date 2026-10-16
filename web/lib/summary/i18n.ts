/**
 * Words for the visit brief (M7, /p/brief). Same pattern as lib/i18n.ts: `en` first, `zhHans` typed against it.
 * Client-safe.
 *
 * No clinical sentence lives here and no word judges a reading or his adherence (the lib/safety/judgement.ts list,
 * plus 正常 / 偏高 / 危险 / normal / high / dangerous / good). The one comparison is "brief.bp.mirror": it mirrors
 * the doctor's own words in R1 ("we want it below 135 over 85" -> "not below" / 不低于), never 高于 / above / high,
 * and it always sits next to R1 quoted word for word. tests/unit/brief/brief.test.ts ("every dictionary string is
 * free of judgement words") scans every string in both languages.
 * The Chinese is a draft for review, like the other modules' dictionaries.
 */
import type { Locale } from "@/lib/i18n";

const en = {
  "brief.title": "Visit brief",
  "brief.for": "For the doctor",
  "brief.window": "Since the visit on {last}: {from} to {to}",
  "brief.windowFirst": "So far: {from} to {to}",
  // C2 track B: the day of a visit, when the period after it has no day yet (an account's brief)
  "brief.windowNotYet": "Since the visit on {last}: counting starts on {from}",

  "brief.bp.title": "Home blood pressure",
  "brief.bp.summary": "{n} readings, average {s}/{d}",
  "brief.bp.summaryOne": "1 reading: {s}/{d}",
  "brief.bp.unconfirmed": "Not confirmed: {n}",
  "brief.bp.none": "No readings in this period.",
  "brief.bp.mirror": "{n} of them not below the doctor's {s}/{d} of {date}",
  "brief.bp.noTarget": "The doctor had not given a number yet.",
  "brief.bp.doctorSaid": "The doctor's words",

  "brief.doses.title": "Medicine check-ins",
  "brief.doses.headline": "{taken} of {due} doses taken",
  "brief.doses.due": "Due",
  "brief.doses.taken": "Taken",
  "brief.doses.missed": "Missed",
  "brief.doses.unconfirmed": "Not confirmed",
  "brief.doses.missedAll": "The {n} missed were all on {weekdays} ({routine} mornings): {dates}",
  "brief.doses.missedOne": "The 1 missed was on a {weekday} ({routine} morning): {dates}",
  "brief.doses.missedSome": "{k} of the {n} missed were on {weekdays} ({routine} mornings): {dates}",
  "brief.doses.missedDays": "Missed: {dates}",
  "brief.doses.none": "No medicine was due in this period.",
  "brief.doses.meds": "Medicine: {names}",

  "brief.diet.title": "Diet check",
  // 10-14 (the owner's decision): what he told Ripple to tell the doctor (chest pain, a stroke sign, a reading), with when
  "brief.signals.title": "For the doctor",
  "brief.notes.title": "What he noted",
  "brief.notes.chip": "His own words",
  "brief.notes.none": "No notes in this period.",

  "brief.questions.title": "Questions for this visit",
  "brief.questions.none": "No questions waiting.",
  "brief.questions.more": "{n} more on his question list",
  "brief.questions.recordedSummary": "Recorded summary, not his own words",
  "brief.questions.summaryOf": "Recorded summary: ",

  "brief.meds.title": "His medicines",
  "brief.meds.none": "No medicines on his list.",

  "brief.changed": "New since the last visit",

  // ---- C2 track B (accounts): the elder brief and the 「给医生看」 view
  "brief.acc.kicker": "For the doctor · {date}",
  "brief.acc.empty": "No visit recorded yet. After your first visit, this page is ready to show the doctor.",
  "brief.above.title": "The doctor's line ({date}): {s} on top. These readings, next to it:",
  // C2 track S (round 2): the same row before he has reviewed that visit, or after he marked the line "not right"
  "brief.above.titleInferred": "A line from the visit recording ({date}), not yet checked by him: {s} on top. These readings, next to it:",
  "brief.above.titleDisputed": "A line from the visit recording ({date}) that he marked as not right: {s} on top. These readings, next to it:",
  "brief.above.item": "{date}, {time}: {s}/{d}",
  "brief.showDoctor": "Show the doctor",
  // C2 track B, second round: the brief as it was shown (lib/summary/brief-snapshot.ts)
  "brief.shown.last": "Last shown to the doctor",
  "brief.shown.kept": "This is the page shown to the doctor on {when}. It stays as it was.",
  "brief.doneLooking": "Done",
  "brief.translation": "Translation, checked twice · his own words are what counts",
  "brief.notTranslated": "his own words, not translated",
  "brief.translationSummary": "Translation, checked twice · the recorded words are what count",
  "brief.notTranslatedSummary": "not translated",
  "brief.nextVisit": "Next visit: {date}",
  "brief.langSwitch": "华语",

  // ---- the timeline design (front-end line fe-14, group 14): the parts the new layout adds
  // after a note's date when he said it aloud: 「9月30日 · 语音」
  "brief.notes.voice": "voice",
  "brief.loading": "Opening the visit brief…",
  // the second button of the screen that says the brief could not be opened
  "brief.err.today": "Go to Today",
} as const;

export type BriefKey = keyof typeof en;

const zhHans: Record<BriefKey, string> = {
  "brief.title": "就诊简报",
  "brief.for": "给医生看",
  "brief.window": "上次就诊（{last}）之后：{from}到{to}",
  "brief.windowFirst": "到目前为止：{from}到{to}",
  "brief.windowNotYet": "上次就诊（{last}）之后：从{from}开始算",

  "brief.bp.title": "在家测量的血压",
  "brief.bp.summary": "记了 {n} 次，平均 {s}/{d}",
  "brief.bp.summaryOne": "记了 1 次：{s}/{d}",
  "brief.bp.unconfirmed": "未确认：{n} 次",
  "brief.bp.none": "这段时间没有读数。",
  "brief.bp.mirror": "其中 {n} 次不低于医生 {date} 说的 {s}/{d}",
  "brief.bp.noTarget": "医生还没有说过数字。",
  "brief.bp.doctorSaid": "医生的原话",

  "brief.doses.title": "服药记录",
  "brief.doses.headline": "{due} 次中已服药 {taken} 次",
  "brief.doses.due": "应服药",
  "brief.doses.taken": "已服药",
  "brief.doses.missed": "未服药",
  "brief.doses.unconfirmed": "未确认",
  "brief.doses.missedAll": "未服药的 {n} 次都在{weekdays}（{routine}的早上）：{dates}",
  "brief.doses.missedOne": "未服药的 1 次在{weekday}（{routine}的早上）：{dates}",
  "brief.doses.missedSome": "未服药的 {n} 次中有 {k} 次在{weekdays}（{routine}的早上）：{dates}",
  "brief.doses.missedDays": "未服药的日期：{dates}",
  "brief.doses.none": "这段时间没有需要服用的药物。",
  "brief.doses.meds": "药：{names}",

  "brief.diet.title": "饮食核对",
  "brief.signals.title": "要告诉医生的情况",
  "brief.notes.title": "他记下的话",
  "brief.notes.chip": "本人说",
  "brief.notes.none": "这段时间没有记下什么。",

  "brief.questions.title": "这次想问的问题",
  "brief.questions.none": "没有等着问的问题。",
  "brief.questions.more": "问题单上还有 {n} 个",
  "brief.questions.recordedSummary": "记录的摘要，不是他的原话",
  "brief.questions.summaryOf": "记录的摘要：",

  "brief.meds.title": "他的药",
  "brief.meds.none": "药单上没有药。",

  "brief.changed": "上次就诊后新出现",

  // ---- C2 track B（账号）：老人端的简报和「给医生看」
  "brief.acc.kicker": "给医生看 · {date}",
  "brief.acc.empty": "暂无就诊记录。第一次就诊后，这里会有给医生看的一页。",
  "brief.above.title": "医生说过的线（{date}）：上面的数 {s}。放在它旁边的读数：",
  "brief.above.titleInferred": "就诊录音里的线（{date}，他还没核对）：上面的数 {s}。放在它旁边的读数：",
  "brief.above.titleDisputed": "就诊录音里的线（{date}，他标了「不对」）：上面的数 {s}。放在它旁边的读数：",
  "brief.above.item": "{date} {time}：{s}/{d}",
  "brief.showDoctor": "给医生看",
  "brief.shown.last": "上次给医生看的那一页",
  "brief.shown.kept": "这是 {when} 给医生看的那一页，内容不会再变。",
  "brief.doneLooking": "看完了",
  "brief.translation": "翻译（核对过两次）· 原话为准",
  "brief.notTranslated": "他的原话，没有翻译",
  "brief.translationSummary": "翻译（核对过两次）· 以记录的原文为准",
  "brief.notTranslatedSummary": "没有翻译",
  "brief.nextVisit": "下次就诊：{date}",
  "brief.langSwitch": "English",

  // ---- 时间线设计稿（前端 fe-14，第 14 组）：新版式多出来的几处
  "brief.notes.voice": "语音",
  "brief.loading": "正在打开就诊简报…",
  "brief.err.today": "先看今天",
};

const messages: Record<Locale, Record<BriefKey, string>> = { en, "zh-Hans": zhHans };

export function bt(locale: Locale, key: BriefKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** Every string of the dictionary in one language (for the word scans in tests). */
export function allBriefStrings(locale: Locale): string[] {
  return Object.values(messages[locale]);
}

const WEEKDAY_PLURAL: Record<string, string> = {
  Sun: "Sundays",
  Mon: "Mondays",
  Tue: "Tuesdays",
  Wed: "Wednesdays",
  Thu: "Thursdays",
  Fri: "Fridays",
  Sat: "Saturdays",
};
const WEEKDAY_LONG: Record<string, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};
const WEEKDAY_ZH: Record<string, string> = { Sun: "周日", Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六" };

/** ["Tue", "Thu"] -> "Tuesdays and Thursdays" / "周二、周四" */
export function weekdaysPlural(locale: Locale, days: string[]): string {
  if (locale === "zh-Hans") return days.map((d) => WEEKDAY_ZH[d] ?? d).join("、");
  const words = days.map((d) => WEEKDAY_PLURAL[d] ?? d);
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Tue" -> "Tuesday" / "周二" */
export function weekdayName(locale: Locale, day: string): string {
  return locale === "zh-Hans" ? (WEEKDAY_ZH[day] ?? day) : (WEEKDAY_LONG[day] ?? day);
}
