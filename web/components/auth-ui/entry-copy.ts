/**
 * The words that are new with the way in (line fe-entry; web/progress/fe-entry.md): 「你是哪一位？」 and its two choices,
 * the small link from one side's log-in to the other's, and the two examples in a son's or daughter's sign-up where
 * the elder's own (「陈先生」, chen.tan) would not fit. Every other word on these screens is lib/auth/copy.ts and the
 * consent texts, as before. Fixed copy, 华语 first; never anything clinical. Client-safe.
 */
import type { AuthSide } from "@/lib/ui/auth-tokens";
import type { AuthLocale } from "./AuthScreen";

const zh = {
  /** /who: the title, and each choice with its one line */
  whoTitle: "你是哪一位？",
  elderTitle: "我是长辈",
  elderLine: "记录就诊、服药和血压",
  familyTitle: "我是子女",
  familyLine: "看看爸爸妈妈今天好不好",
  /** her sign-up: the examples in the name and the account fields, and what an empty name is told */
  familyNamePlaceholder: "例如：Wei Ling",
  familyNameMissing: "写一个称呼，例如「Wei Ling」。",
  familyAccountPlaceholder: "例如：weiling88",
};

export type EntryCopy = typeof zh;

const en: EntryCopy = {
  whoTitle: "Who are you?",
  elderTitle: "I am the elder",
  elderLine: "My visits, medicine and readings",
  familyTitle: "I am the son or daughter",
  familyLine: "See how my parent is doing today",
  familyNamePlaceholder: "e.g. Wei Ling",
  familyNameMissing: "Write a name, e.g. Wei Ling.",
  familyAccountPlaceholder: "e.g. weiling88",
};

export function entryCopy(locale: AuthLocale): EntryCopy {
  return locale === "en" ? en : zh;
}

/** 「我是长辈」 / 「我是子女」: how a side names itself, on /who and on the small link to that side's log-in. */
export function sideTitle(side: AuthSide, locale: AuthLocale): string {
  const w = entryCopy(locale);
  return side === "elder" ? w.elderTitle : w.familyTitle;
}
