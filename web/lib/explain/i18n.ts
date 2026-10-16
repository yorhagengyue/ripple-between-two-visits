/**
 * Interface words of the explain card and the understanding checklist (task M5). Only chrome and his own
 * questions live here: no clinical sentence comes from this file (those are R3, counter lines and patient_text,
 * lib/explain/card.ts). zh-Hans is typed against the English keys, so a missing translation fails typecheck.
 * The Mandarin is a draft for a Mandarin reader to review. No right / wrong wording, no judgement words.
 * Client-safe.
 */
import type { Locale } from "@/lib/i18n";
import type { UnderstandingItem } from "./types";

const en = {
  "card.title": "Why take it when you feel fine",
  "card.kicker": "From your visit and the leaflet",
  "card.sourceTap": "Tap the source to hear it",
  "card.standIn": "stand-in recording",
  "card.playing": "Playing",
  "card.at": "at {time}",
  "card.hidden": "{n} line is waiting for review and is not shown.",
  "card.hiddenMany": "{n} lines are waiting for review and are not shown.",
  "read.button": "Read the card aloud",
  "read.loading": "Getting the audio…",
  "read.playing": "Reading aloud…",
  "read.stop": "Stop",
  "read.failed": "Read-aloud does not work at the moment.",
  "read.mock": "test voice",

  "check.title": "What I understand",
  "check.intro": "For each one, tap what is true for you. Anything you are not sure about goes on your list for the next visit.",
  "check.know": "I know",
  "check.unsure": "Not sure",
  "check.item.purpose": "What this medicine is for",
  "check.item.feel_fine": "Whether to take it when I feel fine",
  "check.item.when": "When to take it",
  "check.item.missed": "What to do if I miss one",
  "check.noted": "Noted: I know",
  "check.onList": "On your list for the next visit",
  "check.openList": "Open my questions",
  "check.failed": "That did not go through. Please try again.",

  "q.purpose": "{name}: what is this medicine for?",
  "q.feel_fine": "{name}: do I take it when I feel fine?",
  "q.when": "{name}: when do I take it?",
  "q.missed": "{name}: what do I do if I miss one?",
};

export type ExplainKey = keyof typeof en;

const zhHans: Record<ExplainKey, string> = {
  "card.title": "没有不适时为什么也要服用",
  "card.kicker": "来自就诊录音和单张",
  "card.sourceTap": "点出处，听原声",
  "card.standIn": "代录音",
  "card.playing": "正在播放",
  "card.at": "{time} 处",
  "card.hidden": "有 {n} 句在等审核，暂不显示。",
  "card.hiddenMany": "有 {n} 句在等审核，暂不显示。",
  "read.button": "朗读这张卡",
  "read.loading": "正在准备声音…",
  "read.playing": "正在朗读…",
  "read.stop": "停",
  "read.failed": "朗读现在用不了。",
  "read.mock": "测试声音",

  "check.title": "理解清单",
  "check.intro": "每一项按你自己的情况点一下。不确定的，会加入下次就诊的问题单。",
  "check.know": "知道",
  "check.unsure": "不确定",
  // owner 10-14: the items' names in professional words (components/meds/elder/CardParts.tsx ITEM_WORDS says the same);
  // the questions below stay as they were: 不确定 puts them on his list in his own voice
  "check.item.purpose": "药物用途",
  "check.item.feel_fine": "没有不适时是否服用",
  "check.item.when": "服药时间",
  "check.item.missed": "漏服时如何处理",
  "check.noted": "已记录：知道",
  "check.onList": "已加入下次就诊的问题单",
  "check.openList": "打开问题单",
  "check.failed": "没有成功，请再点一次。",

  "q.purpose": "{name}：这个药是做什么的？",
  "q.feel_fine": "{name}：没感觉要不要吃？",
  "q.when": "{name}：什么时候吃？",
  "q.missed": "{name}：漏了怎么办？",
};

const messages: Record<Locale, Record<ExplainKey, string>> = { en, "zh-Hans": zhHans };

export function et(locale: Locale, key: ExplainKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** The checklist item's label (four fixed items). */
export function itemLabel(locale: Locale, item: UnderstandingItem): string {
  return et(locale, `check.item.${item}` as ExplainKey);
}

/** The question 不确定 puts on his list, in his own voice. */
export function itemQuestion(locale: Locale, item: UnderstandingItem, name: string): string {
  return et(locale, `q.${item}` as ExplainKey, { name });
}

/** Every interface string, both languages (tests scan them for judgement and right / wrong wording). */
export function allExplainStrings(): string[] {
  return [...Object.values(en), ...Object.values(zhHans)];
}
