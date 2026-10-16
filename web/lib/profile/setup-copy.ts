/**
 * The words that are new on the setting-up screens and on 「我 › 我的档案」 since they were laid out after the timeline
 * draft (screens 01-5a to 01-5f and 01-6; web/progress/fe-01.md). Chrome only, like lib/profile/copy.ts, which keeps
 * every sentence these screens had before: the questions, 「跳过」, 「以后再说」, 「对 / 改一下 / 不对」, who wrote a line.
 * A new word lives here when the new layout has a part the old one had not: the six items of the step bar, the routine
 * as one list, the nodes of the reminder line, the count of what waits for him. Client-safe.
 */
import type { CLocale } from "./copy";

const pick = <T>(locale: CLocale, zh: T, en: T): T => (locale === "zh-Hans" ? zh : en);

/** The six items setting up asks about (real-app 2.5; the draft's 01-5a to 01-5f). */
export const SETUP_ITEMS = 6;

export function setupCopy(locale: CLocale) {
  return {
    /** the step bar: which of the six items this screen belongs to */
    item: (n: number) => pick(locale, `建档 · 第 ${n} 项，共 ${SETUP_ITEMS} 项`, `Setting up · ${n} of ${SETUP_ITEMS}`),
    // 01-5b: his routine as one list
    routineTitle: pick(locale, ["你每天的作息"], ["Your day"]),
    routineLede: pick(locale, "Ripple 按作息排提醒。", "Ripple times your reminders by it."),
    addOne: pick(locale, "＋ 加一项", "+ Add one"),
    notAdding: pick(locale, "不加了", "Not now"),
    habitChange: pick(locale, "改一下这件事", "Change this one"),
    breakfast: pick(locale, "早饭", "Breakfast"),
    // 01-5c: the second way in
    medsManual: pick(locale, "自己输入", "Type it in"),
    // 01-5f: the reminder line
    firstReminder: pick(locale, "第一次提醒", "First reminder"),
    askedAgain: pick(locale, "再次提醒", "Ripple asks again"),
    noReply: pick(locale, "仍未回应，记录为「未回应」", "Still no answer: recorded as 「no reply」"),
    routine: pick(locale, "作息", "your routine"),
    changeTime: pick(locale, "改时间", "Change the time"),
    // 01-6: one at a time
    nOf: (i: number, n: number) => pick(locale, `第 ${i} 项，共 ${n} 项`, `${i} of ${n}`),
    // 我的档案: the groups of the page
    groupRoutine: pick(locale, "作息", "Your day"),
    groupAbout: pick(locale, "关于你", "About you"),
  };
}
