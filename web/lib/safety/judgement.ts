/**
 * Judgement and advice vocabulary for layer 2 (.codebuddy/rules/never-cross: no evaluation of readings, no
 * comparison line the doctor did not say, no verdict on two medicines together, no "the medicine caused it", no
 * reassurance or permission, no dose change). Layers 1 and 2 used to let these through whenever the sentence had
 * no number and no medicine name ("Your reading is high.", "你的血压偏高。", "It is not above 180, so no need to
 * go to A&E."), leaving the layer-3 checker model as the only guard.
 *
 * Scope: only sentences the model wrote itself (origin "model"). The doctor's own words, label lines, the reviewed
 * patient_text restatements and the fixed templates are exempt, because they legitimately contain some of these
 * words (R3 "even when you feel fine", R4 "if your readings are high", the self-harm template "in danger now").
 *
 * Matching: English words on word boundaries, case-insensitive; Chinese as whole multi-character words, never a
 * single character, so 这个药是早上吃的 and 可以问药剂师 do not match. Questions are checked too: "Is your
 * reading too high?" is an evaluation in question form.
 *
 * The list lives here until web/kb/glossary.json gets a judgement section (web/kb is owned by the data side).
 * It over-blocks on purpose: a blocked paraphrase becomes the referral template and a question, which is safe.
 *
 * 10-09 (DeepSeek fixer, after the live layer-3 checker passed three app-worded claims):
 *   - minimising: "only", "just", "most people", "no trouble" ("you missed only 3", "Most people have no trouble
 *     with the medicine." lifted out of a paragraph about liver injury);
 *   - efficacy: what a medicine treats, cures, prevents or protects against ("Chest pain (angina) is not something it
 *     treats." made out of "chest pain (angina) is not mentioned"); the reviewed restatements say what it is for;
 *   - absence: "not mentioned", "does not say", "silent": what a source leaves out is never turned into a statement.
 * These three are CLAIM_CATEGORIES: layer 2 checks them on model-worded sentences (modelWordingHits); judgementHits
 * keeps the original seven, because lib/daily/bp.ts also uses it to filter the doctor's own measuring lines.
 */

export type JudgementCategory =
  | "evaluation"
  | "comparison"
  | "reassurance"
  | "causation"
  | "interaction"
  | "permission"
  | "dose_change"
  | "minimising"
  | "efficacy"
  | "absence";

const EN: Record<JudgementCategory, string[]> = {
  evaluation: [
    "high",
    "higher",
    "highest",
    "low",
    "lower",
    "lowest",
    "too much",
    "too little",
    "normal",
    "abnormal",
    "fine",
    "ok",
    "okay",
    "alright",
    "all right",
    "good",
    "great",
    "bad",
    "better",
    "worse",
    "safe",
    "safer",
    "safely",
    "unsafe",
    "danger",
    "dangerous",
    "risky",
    "serious",
    "worrying",
    "concerning",
    "healthy",
    "unhealthy",
    "elevated",
    "borderline",
    "perfect",
    "under control",
    "well controlled",
    "on target",
    "in range",
    "within range",
    "out of range",
  ],
  comparison: ["above", "below", "over", "under", "more than", "less than", "exceed", "exceeds", "exceeded", "exceeding", "beyond"],
  reassurance: [
    "no need",
    "not need",
    "don't need",
    "do not need",
    "doesn't need",
    "does not need",
    "needn't",
    "not necessary",
    "unnecessary",
    "nothing to worry",
    "don't worry",
    "do not worry",
    "no worries",
    "no problem",
    "not a problem",
    "won't hurt",
    "will not hurt",
    "harmless",
    "no harm",
    "nothing wrong",
    "won't matter",
    "doesn't matter",
    "does not matter",
  ],
  causation: [
    "caused",
    "cause",
    "causes",
    "causing",
    "because of",
    "due to",
    "side effect",
    "side effects",
    "result of",
    "related to",
    "triggered",
    "from the medicine",
    "from the medication",
    "from the tablet",
    "from the tablets",
    "from your medicine",
    "from your tablet",
    "from this medicine",
    "from this tablet",
  ],
  interaction: [
    "together",
    "at the same time",
    "combine",
    "combined",
    "combining",
    "combination",
    "mix",
    "mixing",
    "interact",
    "interacts",
    "interaction",
    "interactions",
    "along with",
    "with each other",
    "compatible",
  ],
  permission: ["allowed", "permitted", "you may", "it's fine", "is fine", "is ok", "is okay", "ok to", "okay to"],
  dose_change: [
    "extra",
    "additional",
    "one more",
    "another tablet",
    "another dose",
    "double",
    "doubling",
    "skip",
    "skipping",
    "stop",
    "stopping",
    "increase",
    "decrease",
    "reduce",
    "cut down",
  ],
  minimising: [
    "only",
    "just",
    "merely",
    "simply",
    "barely",
    "hardly",
    "mostly",
    "most people",
    "most patients",
    "few people",
    "no trouble",
    "no problems",
    "nothing serious",
    "not serious",
    "very small",
    "very low",
    "tiny",
    "rare",
    "rarely",
    "very rare",
    "unlikely",
    "mild",
    "slight",
    "slightly",
    "a little",
    "minor",
  ],
  efficacy: [
    "treat",
    "treats",
    "treated",
    "treating",
    "treatment",
    "cure",
    "cures",
    "cured",
    "heal",
    "heals",
    "prevent",
    "prevents",
    "prevented",
    "prevention",
    "protect",
    "protects",
    "protection",
    "effective",
    "ineffective",
    "works for",
    "work for",
    "good for",
  ],
  absence: [
    "not mentioned",
    "not mention",
    "doesn't mention",
    "does not mention",
    "no mention",
    "not listed",
    "isn't listed",
    "doesn't say",
    "does not say",
    "says nothing",
    "nothing about",
    "silent",
    "not stated",
    "does not state",
    "doesn't state",
  ],
};

const ZH: Record<JudgementCategory, string[]> = {
  evaluation: [
    "偏高",
    "偏低",
    "过高",
    "过低",
    "太高",
    "太低",
    "高了",
    "低了",
    "很高",
    "有点高",
    "比较高",
    "较高",
    "较低",
    "升高",
    "正常",
    "异常",
    "危险",
    "安全",
    "严重",
    "没事",
    "没问题",
    "不要紧",
    "还好",
    "很好",
    "不错",
    "挺好",
    "好转",
    "变好",
    "变差",
    "恶化",
    "达标",
    "超标",
    "控制得",
    "稳定",
    "健康",
  ],
  comparison: ["超过", "高于", "低于", "不到", "以上", "以下", "大于", "小于"],
  reassurance: ["不用", "不需要", "没必要", "不必", "别担心", "不用担心", "放心", "没关系"],
  causation: ["引起", "导致", "造成", "因为", "由于", "副作用", "害的"],
  interaction: ["一起吃", "同时吃", "一起服用", "同时服用", "一起用", "同时用", "相互作用", "冲突", "混着吃", "搭配"],
  permission: ["可以多吃", "可以少吃", "可以停", "可以不吃", "允许"],
  dose_change: ["多吃", "少吃", "多一粒", "加一粒", "加量", "减量", "加药", "减药", "停药", "跳过", "加倍", "翻倍"],
  minimising: ["只有", "只是", "仅仅", "大多数人", "多数人", "很少", "罕见", "极少", "轻微", "一点点"],
  efficacy: ["治疗", "治好", "治愈", "能治", "可以治", "预防", "保护", "有效", "无效"],
  absence: ["没有提到", "没提到", "未提及", "没有说", "没说到", "没有写", "没写"],
};

interface Compiled {
  category: JudgementCategory;
  word: string;
  re: RegExp;
}

let compiled: Compiled[] | null = null;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patterns(): Compiled[] {
  if (compiled) return compiled;
  const out: Compiled[] = [];
  for (const [category, words] of Object.entries(EN) as [JudgementCategory, string[]][]) {
    for (const word of words) {
      const body = word.split(/\s+/).map(escape).join("\\s+");
      out.push({ category, word, re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu") });
    }
  }
  for (const [category, words] of Object.entries(ZH) as [JudgementCategory, string[]][]) {
    for (const word of words) out.push({ category, word, re: new RegExp(escape(word), "u") });
  }
  compiled = out;
  return out;
}

export interface JudgementHit {
  category: JudgementCategory;
  word: string;
}

/** Categories only checked on model-worded sentences (see the header). */
export const CLAIM_CATEGORIES: JudgementCategory[] = ["minimising", "efficacy", "absence"];

function hits(text: string, keep: (c: JudgementCategory) => boolean): JudgementHit[] {
  const t = text.normalize("NFKC").replace(/[‘’ʼ]/g, "'");
  return patterns()
    .filter((p) => keep(p.category) && p.re.test(t))
    .map(({ category, word }) => ({ category, word }));
}

/** Judgement or advice words in a text (empty = none). Apostrophes are straightened first ("don’t worry"). */
export function judgementHits(text: string): JudgementHit[] {
  return hits(text, (c) => !CLAIM_CATEGORIES.includes(c));
}

/** Everything a model-worded sentence may not contain: judgement and advice words plus the claim categories. */
export function modelWordingHits(text: string): JudgementHit[] {
  return hits(text, () => true);
}

/** The whole vocabulary, for tests and the backstage view. */
export const JUDGEMENT_WORDS: { en: Readonly<Record<JudgementCategory, string[]>>; zh: Readonly<Record<JudgementCategory, string[]>> } = { en: EN, zh: ZH };
