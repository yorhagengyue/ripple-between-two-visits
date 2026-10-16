/**
 * What to eat or drink with a long-term condition (C2 track S; journey 13, routed from track K, whose diet screen met
 * 「我有肾病，可以吃什么？」 answered 「记下了。」 with the 995 line under it): kidney disease, diabetes, heart failure, pregnancy,
 * gout or liver disease. Such a question is his doctor's or a dietitian's to answer: classify.ts classifyRules routes it
 * to refuse_route with the fixed 「这个要问医生或营养师」 (templates.ts refer_diet) and a question on his doctor's list, no
 * model words. No 995 line: nothing in it is a crisis word (the crisis rules run first and keep every emergency).
 *
 * A question (classify.ts isQuestion) that names a condition and asks about food or drink, in words other than the
 * condition's own (糖 in 糖尿病 is not a food). Not when a medicine is named or meant: 吃 is also "take", so 「我有肾病，可以吃
 * 布洛芬吗？」 stays a medicine question (classifyRules also checks named medicines and supplements). A statement
 * (「医生叫我少吃盐」) stays a note. A diet named without a condition (「医生说少盐，那我可以吃咸蛋吗？」, his blood pressure
 * doctor's salt line) is not this rule's: track K's diet screen quotes the doctor's line and the ask goes the usual way.
 */
export type DietCondition = "kidney" | "diabetes" | "heart_failure" | "pregnancy" | "gout" | "liver";

const CONDITIONS: [DietCondition, RegExp][] = [
  [
    "kidney",
    /肾病|腎病|肾脏病|腎臟病|肾不好|腎不好|肾功能|腎功能|肾衰|腎衰|洗肾|洗腎|透析|\bkidneys? (?:disease|problems?|failure)\b|\b(?:bad|weak) kidneys?\b|\bckd\b|\bdialysis\b|\brenal\b|\bsakit buah pinggang\b/i,
  ],
  ["diabetes", /糖尿病|血糖高|高血糖|\bdiabet(?:es|ic)\b|\bhigh (?:blood )?sugar\b|\bsugar (?:is )?high\b|\bkencing manis\b/i],
  ["heart_failure", /心衰|心力衰竭|心脏衰竭|心臟衰竭|\bheart failure\b|\bsakit jantung\b/i],
  ["pregnancy", /怀孕|懷孕|孕妇|孕婦|有身孕|哺乳|喂奶|餵奶|\bpregnan(?:t|cy)\b|\bbreast-?feeding\b|\bmengandung\b|\bhamil\b/i],
  ["gout", /痛风|痛風|尿酸高|高尿酸|\bgout\b|\buric acid\b/i],
  ["liver", /肝病|肝不好|肝硬化|脂肪肝|\bliver (?:disease|problems?)\b|\bfatty liver\b|\bcirrhosis\b/i],
];

/** Food and drink (after the condition's own words are taken out). */
const DIET =
  /吃|喝|饮食|飲食|食物|东西|東西|水果|蔬菜|青菜|肉|饭|飯|粥|面条|麵條|盐|鹽|糖|甜|咸|鹹|汤|湯|零食|咖啡|茶|酒|榴莲|榴槤|\b(?:eat|eating|food|foods|diet|drink|drinking|fruits?|vegetables?|meat|rice|noodles?|salt|salty|sugar|sugary|sweets?|snacks?|meals?|coffee|tea|alcohol|beer|wine|durian|makan|minum)\b/i;

/** A medicine named or meant (then it is a medicine question, whatever the condition). */
const MEDICINE =
  /药|藥|胶囊|膠囊|一粒|两粒|兩粒|半粒|一片|两片|兩片|半片|补品|補品|保健品|\b(?:pills?|tablets?|capsules?|medicines?|medications?|meds|supplements?|vitamins?|ubat)\b/i;

/** The long-term condition the words name, or null (no question or food words needed). */
export function dietCondition(text: string): DietCondition | null {
  for (const [condition, re] of CONDITIONS) if (re.test(text)) return condition;
  return null;
}

/** The condition of a question about what to eat or drink with it, or null (see the header). */
export function specialDiet(text: string, question: boolean): DietCondition | null {
  if (!question || MEDICINE.test(text)) return null;
  const condition = dietCondition(text);
  if (!condition) return null;
  const rest = CONDITIONS.reduce((t, [, re]) => t.replace(new RegExp(re.source, "gi"), " "), text);
  return DIET.test(rest) ? condition : null;
}
