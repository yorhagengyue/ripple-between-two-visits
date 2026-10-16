/**
 * The words of 「随时说一句」 that are Ripple's own interface (design group 04; web/progress/fe-04.md): the header's line,
 * the labels and the buttons of the day's record (/p/chat). Nothing clinical: every sentence Ripple says in reply comes
 * from lib/safety (a fixed template, or someone's own words with their source) and is drawn as it was kept.
 *
 * A plain module (no "use client"): the server page reads it for the header, the client screen for the rest.
 */
import type { Locale } from "@/lib/i18n";

export interface ChatWords {
  /** who a line of his is from, on its node: 「你 · 早上 8:00」 */
  you: string;
  /** the grey line under the date in the header, today; also where a past day's 「‹」 goes back to */
  today: string;
  /** the same line on an earlier day (the date itself is the header's title) */
  thatDay: string;
  /** today, nothing said yet: the one entry of the line */
  empty: string;
  /** an earlier day with nothing kept */
  noneThatDay: string;
  addQuestion: string;
  /** the way from 「已在下次看诊的问题单里」 to the list */
  seeQuestions: string;
  checkIn: string;
  earlier: string;
  dayCount: (n: number) => string;
  failed: string;
}

export const CHAT_WORDS: Record<Locale, ChatWords> = {
  "zh-Hans": {
    you: "你",
    today: "今天说过的话",
    thatDay: "这一天说过的话",
    empty: "今天还没有说过话",
    noneThatDay: "这一天没有说过话。",
    addQuestion: "加入问题单",
    seeQuestions: "看问题单",
    checkIn: "到今天页记录",
    earlier: "以前说过的话",
    dayCount: (n) => `${n} 句`,
    failed: "没有记下，再点一次。",
  },
  en: {
    you: "You",
    today: "What you said today",
    thatDay: "What you said that day",
    empty: "Nothing said today yet",
    noneThatDay: "Nothing was said that day.",
    addQuestion: "Add to my questions",
    seeQuestions: "See the question list",
    checkIn: "Log it on Today",
    earlier: "Earlier days",
    dayCount: (n) => `${n} said`,
    failed: "Not saved. Tap again.",
  },
};
