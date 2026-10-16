/**
 * The words of the pieces every user can land on whatever page they asked for (front-end line fe-12;
 * web/progress/fe-12.md): the not-found page, the screen for a page that could not be drawn, and the mark that shows
 * the next page is on its way. One plain sentence each and a way on: never a code, never the fault's own text, never an
 * apology (tests/unit/site/site.test.ts scans every string here).
 *
 * The sentences for "the records cannot be read" are not here: they are fixed copy, lib/subject/unavailable.ts
 * (STORE_UNAVAILABLE_WORDS), and the screen takes them from there.
 *
 * A plain module (no "use client"): the server page (app/not-found.tsx) and the client parts both read it.
 */
export type SiteLocale = "zh-Hans" | "en";

export interface SiteWords {
  /**
   * The not-found page (real-app 2.25 line 351: 「不是他的东西 … 404，不说存不存在」): the same sentence for an address
   * that never existed and for one that is someone else's, and nothing of what was asked for.
   */
  notFound: string;
  /** a page that could not be drawn, when the fault is not the store: what happened, and what still holds */
  fault: { title: string; body: string; retry: string };
  /** the ways on: his Today (the not-found page; the fault screen, 「先看今天」 as the draft's error screen has it), the front door */
  backToToday: string;
  seeToday: string;
  toFront: string;
  /** what a screen reader hears while the next page is on its way */
  opening: string;
}

export const SITE_WORDS: Record<SiteLocale, SiteWords> = {
  "zh-Hans": {
    notFound: "这个地址打不开。",
    fault: { title: "这一页这次没打开。", body: "你记下的东西都还在。", retry: "再试一次" },
    backToToday: "回到今天",
    seeToday: "先看今天",
    toFront: "回到首页",
    opening: "正在打开……",
  },
  en: {
    notFound: "This address cannot be opened.",
    fault: { title: "This page did not open this time.", body: "Everything you saved is still there.", retry: "Try again" },
    backToToday: "Back to Today",
    seeToday: "Go to Today",
    toFront: "Go to the front page",
    opening: "Opening…",
  },
};

export function siteWords(locale: string | null | undefined): SiteWords {
  return locale === "en" ? SITE_WORDS.en : SITE_WORDS["zh-Hans"];
}

/** Every string, for the test that scans them. */
export function allSiteWords(): string[] {
  return Object.values(SITE_WORDS).flatMap((w) => [w.notFound, w.fault.title, w.fault.body, w.fault.retry, w.backToToday, w.seeToday, w.toFront, w.opening]);
}

/**
 * The language of a screen that has no page to tell it (the fault screen): the phone's own choice (the rp_lang
 * cookie), else the browser's, else 华语. Client only; on the server it is 华语.
 */
export function phoneLanguage(): SiteLocale {
  if (typeof document === "undefined") return "zh-Hans";
  const cookie = /(?:^|;\s*)rp_lang=([^;]+)/.exec(document.cookie)?.[1];
  if (cookie === "en" || cookie === "zh-Hans") return cookie;
  return (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "zh-Hans";
}
