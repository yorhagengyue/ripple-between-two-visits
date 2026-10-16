/**
 * Mandarin for clinical sentences without a model translation (web-app.md 6.2: "临床句子由槽位套模板生成").
 * A label line such as "Take ONE tablet every MORNING" becomes 药品标签：每天早上服用一片。 from its slots
 * (number 1, unit tablet, time morning). When the slots are not enough for a full template, there is no zh and
 * the UI shows the original words. The owner's decision of 2026-10-14: professional words (服用, 一片, 药品标签),
 * not 吃 / 一粒 / 药袋上写着; the two places that take the lead-in off again (components/daily/answer-parts.ts
 * LEAD_INS, components/today/dose-parts.tsx) know both the new lead-in and the old one, for answers kept before.
 */
import { getKb } from "@/lib/kb/load";
import { extractSlots } from "./slots";
import { hasHan, sentencePieces } from "./text";
import type { Attribution } from "./types";

const PREFIX: Record<Attribution, string> = {
  label: "药品标签：",
  doctor: "医生说：",
  dispenser: "柜台说：",
  pharmacist: "药剂师说：",
  leaflet: "单张写着：",
};

const NUMBER_ZH: Record<string, string> = {
  "0.5": "半",
  "1": "一",
  "2": "两",
  "3": "三",
  "4": "四",
  "5": "五",
  "6": "六",
  "7": "七",
  "8": "八",
  "9": "九",
  "10": "十",
};
const UNIT_ZH: Record<string, string> = { tablet: "片", capsule: "粒胶囊", mg: "毫克" };
/** "with or without food": said after the dose, not in front of it */
const EITHER_WAY = "餐前餐后均可";
const TIME_ZH: Record<string, string> = {
  morning: "早上",
  night: "晚上",
  evening: "傍晚",
  after_breakfast: "早餐后",
  after_food: "餐后",
  with_or_without_food: EITHER_WAY,
};
const FREQ_ZH: Record<string, string> = {
  once_daily: "每天一次",
  twice_daily: "每天两次",
  three_times_daily: "每天三次",
  when_needed: "需要时",
  twice_weekly: "每周两次",
};

/**
 * Words a plain "how to take" line may have besides its slots: "Take ONE tablet every MORNING", "Take 1 tablet once
 * daily", "Take half a tablet each day". Anything else (not, do, avoid, more, than, only, if, instead, exceed, at once,
 * maximum ...) means the line says more than its slots, and the slots alone would turn "Do not take more than 2
 * tablets a day" into 吃两粒 (fix round 1, 10-09): then there is no template and the UI shows the label's own words.
 */
const PLAIN_WORDS = new Set(["take", "every", "each", "a", "an", "day", "daily", "per"]);

function plainHowToTake(text: string, s: ReturnType<typeof extractSlots>): boolean {
  const kb = getKb().glossary;
  const allowed = new Set(PLAIN_WORDS);
  const addWords = (alias: string) => {
    for (const w of alias.toLowerCase().split(/\s+/)) if (w) allowed.add(w);
  };
  for (const aliases of Object.values(kb.units)) aliases.forEach(addWords);
  for (const [value, aliases] of Object.entries(kb.numbers)) if (s.numbers.includes(value)) aliases.forEach(addWords);
  for (const id of s.times) (kb.times[id] ?? []).forEach(addWords);
  for (const id of s.frequencies) (kb.frequencies[id] ?? []).forEach(addWords);
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?/g, " ")
    .split(/[^\p{L}']+/u)
    .filter(Boolean);
  return words.every((w) => allowed.has(w));
}

/**
 * Template Mandarin for a plain "how to take" line, or null when the slots do not make a whole sentence (needs one
 * number and one unit; time and frequency optional; no drug name, no second number) or the line says anything its
 * slots do not carry (a negation, a limit, a condition: plainHowToTake). A line in Chinese already is the words to show.
 */
export function zhFromSlots(text: string, attribution: Attribution | undefined): string | null {
  if (hasHan(text)) return null;
  // one sentence only (fix round 3): "Take ONE tablet every MORNING. Take ONE tablet every NIGHT." would come out as one
  // merged Mandarin line, and a label's later sentence can limit its first; the UI shows the label's own words
  if (sentencePieces(text).filter((p) => /\p{L}/u.test(p)).length > 1) return null;
  const s = extractSlots(text);
  if (s.numbers.length !== 1 || s.units.length !== 1 || s.drugs.length > 0) return null;
  if (!plainHowToTake(text, s)) return null;
  const qty = NUMBER_ZH[s.numbers[0]];
  const unit = UNIT_ZH[s.units[0]];
  if (!qty || !unit) return null;
  const every = /\bevery\b|每天|每日/i.test(text) && s.frequencies.length === 0 ? "每天" : "";
  const freq = s.frequencies.map((f) => FREQ_ZH[f]).filter(Boolean).join("");
  const times = s.times.map((t) => TIME_ZH[t]).filter(Boolean);
  if (times.length !== s.times.length || freq.length === 0 && s.frequencies.length > 0) return null;
  const when = times.filter((t) => t !== EITHER_WAY).join("");
  const food = times.includes(EITHER_WAY) ? `，${EITHER_WAY}` : "";
  const prefix = attribution ? PREFIX[attribution] : "";
  return `${prefix}${freq}${every}${when}服用${qty}${unit}${food}。`;
}

export function attributionPrefixZh(attribution: Attribution): string {
  return PREFIX[attribution];
}
