/**
 * The daily diet check (journey 13; M16 「医生交代过饮食的，才有每天的核对（「今天的汤喝完了吗？」是 / 否）」; 老人端提示词
 * 13.5: 每天一问只在医生给过饮食交代时出现，他回答有 / 没有 / 不记得). Client-safe (pure).
 *
 * One question a day, a fixed sentence written here by hand and picked by rule from the doctor's own diet line: the
 * first thing in CHECK_ELEMENTS his words name (soup before gravy before sweet drinks before fried food); a line that
 * names none of them gets the general question about the doctor's words themselves. The question is a check (what he
 * did today), never advice: it does not tell him what to eat, and his answer is recorded, never judged.
 *
 * Stored as diet_check rows (0007): one per day per element (`item`), `answer` "yes" | "no" | "unsure", `source_ref`
 * "<visit id>:<utterance id>" (the doctor's line the question came from).
 */
import type { Locale } from "@/lib/i18n";

export const DIET_ANSWERS = ["yes", "no", "unsure"] as const;
export type DietAnswer = (typeof DIET_ANSWERS)[number];

export const isDietAnswer = (v: unknown): v is DietAnswer => typeof v === "string" && (DIET_ANSWERS as readonly string[]).includes(v);

export type CheckElementId = "soup" | "gravy" | "sweet_drinks" | "fried" | "general";

export interface CheckElement {
  id: CheckElementId;
  /** what in the doctor's words picks this element (null: the general question) */
  pattern: RegExp | null;
  question: Record<Locale, string>;
  /** the brief's count line: what "yes" / "no" / "don't remember" mean for this question */
  counts: Record<Locale, (n: { yes: number; no: number; unsure: number }) => string>;
}

const zhCounts = (yes: string, no: string) => (n: { yes: number; no: number; unsure: number }) => `${yes} ${n.yes} 天，${no} ${n.no} 天，不记得 ${n.unsure} 天`;
const enDays = (k: number) => `${k} day${k === 1 ? "" : "s"}`;

/** In order: the first one the doctor's words name is the day's question. */
export const CHECK_ELEMENTS: readonly CheckElement[] = [
  {
    id: "soup",
    pattern: /\bsoups?\b|汤/i,
    question: { "zh-Hans": "今天的汤，有没有喝完？", en: "Did you finish the soup today?" },
    counts: {
      "zh-Hans": zhCounts("汤喝完了", "没喝完"),
      en: (n) => `finished the soup on ${enDays(n.yes)}, did not on ${enDays(n.no)}, did not remember on ${enDays(n.unsure)}`,
    },
  },
  {
    id: "gravy",
    pattern: /\bgravy\b|汁/i,
    question: { "zh-Hans": "今天吃饭，有没有淋汁？", en: "Did you have gravy on your food today?" },
    counts: {
      "zh-Hans": zhCounts("淋了汁", "没淋汁"),
      en: (n) => `had gravy on ${enDays(n.yes)}, did not on ${enDays(n.no)}, did not remember on ${enDays(n.unsure)}`,
    },
  },
  {
    id: "sweet_drinks",
    pattern: /\b(?:sweet|sugary|soft|fizzy) drinks?\b|甜的饮料|甜饮料|汽水|含糖饮料/i,
    question: { "zh-Hans": "今天有没有喝甜的饮料？", en: "Did you have a sweet drink today?" },
    counts: {
      "zh-Hans": zhCounts("喝了甜饮料", "没喝"),
      en: (n) => `had a sweet drink on ${enDays(n.yes)}, did not on ${enDays(n.no)}, did not remember on ${enDays(n.unsure)}`,
    },
  },
  {
    id: "fried",
    pattern: /\b(?:deep[- ])?fried\b|油炸|炸的/i,
    question: { "zh-Hans": "今天有没有吃油炸的东西？", en: "Did you eat fried food today?" },
    counts: {
      "zh-Hans": zhCounts("吃了油炸的", "没吃"),
      en: (n) => `ate fried food on ${enDays(n.yes)}, did not on ${enDays(n.no)}, did not remember on ${enDays(n.unsure)}`,
    },
  },
  {
    id: "general",
    pattern: null,
    question: { "zh-Hans": "今天吃东西，有没有照医生这句话？", en: "Today, did you eat the way the doctor said?" },
    counts: {
      "zh-Hans": (n) => `答「有」${n.yes} 天，「没有」${n.no} 天，「不记得」${n.unsure} 天`,
      en: (n) => `answered "yes" on ${enDays(n.yes)}, "no" on ${enDays(n.no)}, "don't remember" on ${enDays(n.unsure)}`,
    },
  },
];

const GENERAL = CHECK_ELEMENTS[CHECK_ELEMENTS.length - 1];

/** The element a doctor's diet line asks about (CHECK_ELEMENTS order; the general question when it names none). */
export function checkElementFor(doctorWords: string): CheckElement {
  return CHECK_ELEMENTS.find((e) => e.pattern && e.pattern.test(doctorWords)) ?? GENERAL;
}

export function checkElementById(id: string): CheckElement | null {
  return CHECK_ELEMENTS.find((e) => e.id === id) ?? null;
}

/** The buttons under the question, in this order: 有 / 没有 / 不记得. */
export const ANSWER_WORDS: Record<Locale, Record<DietAnswer, string>> = {
  "zh-Hans": { yes: "有", no: "没有", unsure: "不记得" },
  en: { yes: "Yes", no: "No", unsure: "Don't remember" },
};

/** "<visit id>:<utterance id>", the doctor's line a check came from. */
export const sourceRefOf = (line: { visitId: string; utteranceId: string }) => `${line.visitId}:${line.utteranceId}`;
