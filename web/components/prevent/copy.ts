/**
 * The words of the prevention screen that are Ripple's own interface (design group 11; web/progress/fe-1113.md): the
 * header, the section titles, the buttons and the lines that say what was recorded. Nothing here is a line about a
 * vaccine or a screening: those are the official tables' lines as the back end words them, each with its table, version
 * and page (lib/prevent/items.ts), and the doctor's own words. No line here tells him what to do: every one says what
 * was said, what the table lists or what he recorded (tests/unit/prevent scans this file and the screen).
 *
 * A plain module (no "use client"): the server page reads it for the header, the client screen for the rest.
 */
import type { Locale } from "@/lib/i18n";

export interface PreventWords {
  /** the header: the screen's name and the grey line under it */
  title: string;
  subtitle: string;
  next: string;
  nextValue: (date: string, days: number) => string;
  noAge: string;
  noAgeLink: string;
  doctor: string;
  /** the doctor's section while his record holds no line of the doctor's about a test or a follow-up */
  noDoctor: string;
  table: string;
  /** the tables' section when his age is known and no line is listed for it */
  noTable: string;
  done: string;
  ask: string;
  didIt: string;
  undo: string;
  marked: (date: string) => string;
  lastDone: (date: string) => string;
  source: (s: { name: string; version: string }) => string;
  open: string;
  fact: (text: string) => string;
  toast: string;
  failed: string;
  /** the way from 「已加入下次就诊的问题单」 to the list */
  seeQuestions: string;
}

export const PREVENT_WORDS: Record<Locale, PreventWords> = {
  "zh-Hans": {
    title: "预防",
    subtitle: "筛查和疫苗",
    next: "下次就诊",
    nextValue: (date, days) => (days === 0 ? `${date} · 今天` : `约 ${date} · 还有 ${days} 天`),
    noAge: "你的资料里还没有年龄，表上按年龄列的条目先不列出来。",
    noAgeLink: "去「我的档案」填年龄",
    doctor: "医生在就诊时说的检查",
    noDoctor: "就诊记录里还没有医生说的检查或复诊。",
    table: "官方表上写着的",
    noTable: "按你资料里的年龄和病，官方表上现在没有列出条目。",
    done: "已经做了的",
    ask: "加入问题单，询问医生",
    didIt: "我做过了",
    undo: "撤回",
    marked: (date) => `${date} 记的`,
    lastDone: (date) => `上次记的：${date}`,
    source: (s) => `出处：${s.name}（${s.version}）`,
    open: "看官方原文",
    fact: (text) => `你的资料里记着：${text}`,
    toast: "已记录：我做过了",
    failed: "未能记录，再点一次。",
    seeQuestions: "看问题单",
  },
  en: {
    title: "Prevention",
    subtitle: "Screenings and vaccines",
    next: "Next visit",
    nextValue: (date, days) => (days === 0 ? `${date} · today` : `around ${date} · in ${days} days`),
    noAge: "Your profile has no age yet, so the lines the table lists by age are not shown.",
    // (the screen it leads to is called "My details" in English: lib/profile/copy.ts)
    noAgeLink: "Add your age in My details",
    doctor: "Tests your doctor asked for",
    noDoctor: "Your visit records hold no test or follow-up your doctor spoke of yet.",
    table: "What the official tables list",
    noTable: "For the age and conditions in your profile, the official tables list nothing at the moment.",
    done: "Done",
    ask: "Add to my questions for the doctor",
    didIt: "I've done this",
    undo: "Take back",
    marked: (date) => `noted ${date}`,
    lastDone: (date) => `Last noted: ${date}`,
    source: (s) => `Source: ${s.name} (${s.version})`,
    open: "Open the official page",
    fact: (text) => `Your profile says: ${text}`,
    toast: "Noted: I've done this",
    failed: "Not saved. Tap again.",
    seeQuestions: "See the question list",
  },
};
