/**
 * What else an ask is about besides his own, identified medicines (fix round 2, 10-09: the B2 red team's never-cross
 * finding 1). With the real model, "Can I take my BP pills together with fish oil after breakfast?" got the doctor's
 * "Yes, both together after breakfast is fine." (about amlodipine and losartan) as its first line in 7 of 12 asks:
 * the ask's medicines were read as only the KB drugs it names, so fish oil, grapefruit juice, beer, vitamins, cough
 * syrup or "my diabetes medicine" dropped out, the ask collapsed to his two prescriptions, and the doctor's answer
 * about exactly those two "covered" it.
 *
 * Two checks, both fail closed (an unknown word counts as something else; the cost is a referral instead of a quote):
 *   - otherSubstances: supplements, foods and drinks, and medicines named by what they are for ("sleeping pill",
 *     "diabetes medicine", 安眠药, 感冒药) that are not one of his identified medicines; in any ask;
 *   - unresolvedInCombination: in an ask about taking things together, every word must be one this app knows (his
 *     medicines, the seven KB drugs, the words of asking and of meal times). Anything else ("Xanax", "Panadol Cold and
 *     Flu", a Malay or Tamil word) is a party the doctor's answer was not about.
 * Pure functions; no model.
 */
import { findDrugMentions, matchDrug } from "@/lib/kb/match";

/** Marker in an ask's medicines (verify.ts AskScope.drugs): it also names something that is not one of his identified medicines. */
export const OTHER_SUBSTANCE = "other_substance";

/** Supplements and other non-KB products (identified, but never answered by a line about his medicines). */
const NON_KB_PRODUCTS: RegExp[] = [
  /\bfish oil\b|\bomega[- ]?3s?\b|\bmulti-?vitamins?\b|\bvitamins?\b|\bcalcium\b|\bglucosamine\b|\bsupplements?\b|\bginseng\b|\bbird'?s nest\b|\bcollagen\b|\bprobiotics?\b|\bherbal\b|\bherbs?\b|\btcm\b|\bchinese medicine\b|\bjamu\b|\bminyak ikan\b|\bubat (?:tradisional|kampung|cina)\b/i,
  /鱼油|魚油|维他命|維他命|维生素|維生素|钙片|鈣片|葡萄糖胺|保健品|补品|補品|人参|人參|燕窝|燕窩|中药|中藥|草药|草藥|凉茶|涼茶|偏方|补药|補藥/,
];

/** Foods and drinks (grapefruit is in the leaflets, but the doctor's answers are about medicines only). */
const FOOD_DRINK: RegExp[] = [
  /\bgrapefruits?\b|\bpomelos?\b|\bjuice\b|\bbeers?\b|\balcohol\w*\b|\bwines?\b|\bliquor\b|\bwhisk(?:e)?y\b|\bbrandy\b|\bcoffee\b|\bkopi\b|\btea\b|\bteh\b|\bmilk\b|\bsoda\b|\bcoke\b|\bdurian\b|\benergy drinks?\b|\bsusu\b|\bjus\b|\barak\b|\bbir\b|\bsoup\b/i,
  /西柚|葡萄柚|柚子|果汁|啤酒|酒|咖啡|奶茶|茶|牛奶|汽水|可乐|可樂|榴莲|榴槤|汤|湯/,
];

/** Medicine nouns: a word before one says which medicine ("sleeping pill", "cough syrup", "BP pills"). */
const MED_NOUN_RE =
  /([\p{L}][\p{L}'’-]*)\s+(?:and\s+[\p{L}'’-]+\s+)?(?:medicines?|medications?|meds|pills?|tablets?|capsules?|syrups?|drops|creams?|ointments?|tonics?|jabs?|injections?|inhalers?|patch(?:es)?|lozenges?|sachets?)\b/giu;

/**
 * Words before a medicine noun that keep it his own medicine: determiners, numbers, amounts, times, colours and sizes,
 * verbs of taking, his BP medicine, his knee. Any other word names another medicine ("sleeping", "cough", "diabetes",
 * "wife's", "Xanax"): fail closed.
 */
const OWN_QUALIFIERS = new Set([
  // determiners, pronouns, prepositions, question words
  "my", "the", "his", "her", "your", "their", "our", "these", "those", "this", "that", "both", "all", "any", "some", "a", "an",
  "each", "every", "few", "several", "many", "much", "enough", "of", "and", "or", "but", "with", "without", "to", "for",
  "about", "if", "per", "than", "instead", "from", "at", "in", "on", "after", "before", "it", "them", "they", "i", "me", "we",
  "you", "what", "which", "how", "when", "why", "can", "could", "should", "may", "must", "is", "are", "was", "be", "ok",
  "okay", "please", "just", "only", "also", "still", "too", "so", "then", "now",
  // numbers and amounts
  "one", "two", "three", "four", "five", "ten", "first", "second", "third", "next", "last", "another", "additional", "extra",
  "spare", "more", "less", "fewer", "same", "half", "whole", "full", "single", "double", "both", "ones", "mg", "milligram",
  "milligrams", "dose", "doses",
  // times
  "daily", "morning", "evening", "night", "nightly", "bedtime", "today's", "tonight's", "morning's", "yesterday's",
  "tomorrow's", "today", "tonight", "yesterday", "tomorrow", "usual", "regular", "normal", "routine", "current", "present",
  "existing", "old", "new", "original", "previous", "earlier", "later", "missed", "forgotten", "remaining", "leftover",
  // what it looks like
  "white", "pink", "yellow", "blue", "orange", "red", "green", "small", "little", "tiny", "round", "oval", "big", "large",
  // verbs of taking and handling
  "take", "takes", "taking", "took", "taken", "eat", "eating", "ate", "have", "having", "had", "swallow", "swallowed", "need",
  "needs", "skip", "skipped", "stop", "stopping", "stopped", "miss", "forgot", "forget", "crush", "cut", "split", "break",
  "chew", "halve", "increase", "reduce", "lower", "raise", "change", "switch", "finish", "finished", "buy", "bought", "get",
  "got", "collect", "refill", "order", "use", "using", "keep", "give", "gave", "bring", "show",
  // his own medicine and where it came from
  "prescribed", "prescription", "clinic", "doctor's", "doctor", "pharmacy", "own", "bp", "pressure", "hypertension", "high",
  "knee", "pain", "pain-killer", "blood", "generic",
]);

/** Characters right before 药 / 藥 that keep it his own medicine (降压药, 我的药, 这些药, 吃药, 两种降压药 ...). */
const OWN_BEFORE_YAO = new Set([..."压壓痛个個种種吃服食的粒颗顆片些新色这這那把和跟与與是了买買拿配续續换換加减減停掉完点點包盒瓶袋要能不没沒都也就还還再多少剩有啲嘅我你他她用小大白黄黃红紅蓝藍粉圆圓"]);
/** 药 / 藥 followed by these is not a medicine named by its use (药袋, 药房, 药剂师 ...). */
const YAO_COMPOUND_AFTER = /^[袋房剂劑师師单單盒丸片物]/u;

export interface OtherSubstances {
  /** supplements and medicines named by what they are for (not his identified medicines) */
  medicines: string[];
  /** foods and drinks */
  foods: string[];
}

/** Supplements, foods and drinks, and medicines named by their use, in an ask (see the header). */
export function otherSubstances(raw: string): OtherSubstances {
  const text = raw.replace(/\p{Cf}/gu, "");
  const medicines = new Set<string>();
  const foods = new Set<string>();
  for (const re of NON_KB_PRODUCTS) for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))) medicines.add(m[0].toLowerCase());
  for (const re of FOOD_DRINK) for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))) foods.add(m[0].toLowerCase());
  for (const m of text.normalize("NFKC").matchAll(MED_NOUN_RE)) {
    const q = m[1].toLowerCase().replace(/[’]/g, "'");
    if (OWN_QUALIFIERS.has(q) || matchDrug(q, { maxDistance: 0 }) || /^(?:blood|pain|bp)/.test(q)) continue;
    if (/painkillers?$/.test(q)) continue;
    medicines.add(m[0].toLowerCase());
  }
  const t = text.normalize("NFKC");
  for (let i = t.indexOf("药"); i >= 0; i = t.indexOf("药", i + 1)) yaoCheck(t, i, medicines);
  for (let i = t.indexOf("藥"); i >= 0; i = t.indexOf("藥", i + 1)) yaoCheck(t, i, medicines);
  return { medicines: [...medicines], foods: [...foods] };
}

function yaoCheck(t: string, i: number, out: Set<string>): void {
  if (YAO_COMPOUND_AFTER.test(t.slice(i + 1))) return;
  const before = t[i - 1];
  if (before === undefined || !/\p{Script=Han}/u.test(before) || OWN_BEFORE_YAO.has(before)) return;
  // a KB drug's Chinese name right before it (氨氯地平药) is his medicine too
  if (findDrugMentions(t.slice(Math.max(0, i - 8), i)).some((d) => /\p{Script=Han}/u.test(d.alias))) return;
  out.add(t.slice(Math.max(0, i - 3), i + 1));
}

/** True when the ask names any supplement, food, drink or medicine named by its use (otherSubstances). */
export function mentionsOtherSubstance(text: string): boolean {
  const o = otherSubstances(text);
  return o.medicines.length > 0 || o.foods.length > 0;
}

/**
 * Words of an ask about taking things together that are not a party to it: asking, taking, his medicines, meal and
 * day times, Singlish fillers. Any other word may be a party nobody answered for, so it makes the ask "with something
 * else" (unresolvedInCombination).
 */
const COMBINATION_VOCAB = new Set([
  // asking
  "can", "could", "may", "might", "should", "shall", "must", "will", "would", "do", "does", "did", "is", "are", "was", "be",
  "it", "its", "it's", "ok", "okay", "alright", "fine", "safe", "possible", "allowed", "or", "not", "no", "yes", "please",
  "pls", "doctor", "doc", "said", "say", "says", "tell", "me", "i", "i'm", "im", "we", "you", "he", "she", "him", "his", "her",
  "my", "the", "a", "an", "to", "with", "and", "plus", "together", "same", "time", "at", "in", "on", "of", "for", "after",
  "before", "during", "together", "also", "too", "both", "two", "2", "all", "these", "those", "this", "that", "them", "they",
  "one", "ones", "lah", "leh", "ah", "ar", "hor", "meh", "lor", "liao", "one", "can't", "cannot", "eat", "eating", "ate",
  "take", "taking", "took", "taken", "have", "having", "had", "swallow", "mix", "mixing", "combine", "combining", "use",
  "using", "still", "now", "then", "so", "if", "what", "about", "how", "is", "include", "includes", "does", "that", "every",
  "day", "daily", "today", "tonight", "morning", "evening", "night", "breakfast", "lunch", "dinner", "meal", "meals", "food",
  "empty", "stomach", "pill", "pills", "tablet", "tablets", "medicine", "medicines", "medication", "medications", "meds",
  "bp", "blood", "pressure", "high", "knee", "painkiller", "painkillers", "pain", "killer", "killers", "white", "small",
  "new", "usual", "prescribed", "both", "and", "together", "first", "second", "other",
]);

/** Chinese words of a combination ask that are not a party (asking, taking, his BP medicine, his knee painkiller, meal times). */
const COMBINATION_ZH = [
  "两种降压药", "兩種降壓藥", "降压药", "降壓藥", "血压药", "血壓藥", "止痛药", "止痛藥", "膝盖", "膝蓋", "这两粒", "這兩粒",
  "两粒", "兩粒", "两种", "兩種", "两个", "兩個", "这两种", "這兩種", "一起吃", "一起服", "同时吃", "同時吃", "一起", "同时", "同時",
  "可以吗", "可以嗎", "可不可以", "能不能", "行不行", "好不好", "要不要", "是不是", "得唔得", "可唔可以", "早餐后", "早餐後",
  "早饭后", "早飯後", "早餐", "早饭", "早飯", "饭后", "飯後", "饭前", "飯前", "吃饭", "吃飯", "医生", "醫生", "请问", "請問",
  "每天", "早上", "晚上", "今天", "今晚", "我的", "我", "的", "药", "藥", "吃", "服", "食", "和", "跟", "与", "與", "同", "还有",
  "還有", "可以", "能", "吗", "嗎", "呢", "啊", "呀", "这个", "這個", "那个", "那個", "这", "這", "那", "粒", "片", "颗", "顆",
  "都", "也", "一", "两", "兩", "二", "种", "種", "个", "個", "后", "後", "前",
];

/**
 * In an ask about taking things together: true when it holds a word that is not one of his identified medicines nor
 * a word of asking, taking or meal times (COMBINATION_VOCAB, COMBINATION_ZH). Fail closed: "Can I take both with
 * Xanax?" "Panadol Cold and Flu" "dengan ubat batuk" all count as "with something else".
 */
export function unresolvedInCombination(text: string): boolean {
  let t = text.normalize("NFKC").toLowerCase().replace(/[’ʼ]/g, "'");
  // his medicines by name (the seven KB drugs and their aliases, Latin and Chinese)
  const mentions = findDrugMentions(t).sort((a, b) => b.index - a.index);
  for (const m of mentions) t = `${t.slice(0, m.index)} ${t.slice(m.index + m.alias.length)}`;
  // Chinese: take away the known words, longest first; any Han character left is something else
  let zh = t.replace(/[^\p{Script=Han}]+/gu, " ");
  for (const w of [...COMBINATION_ZH].sort((a, b) => b.length - a.length)) zh = zh.split(w).join(" ");
  if (/\p{Script=Han}/u.test(zh)) return true;
  // Latin words: each one must be known
  const words = t.replace(/\p{Script=Han}+/gu, " ").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  return words.some((w) => !COMBINATION_VOCAB.has(w) && !/^\d+(?:mg)?$/.test(w));
}
