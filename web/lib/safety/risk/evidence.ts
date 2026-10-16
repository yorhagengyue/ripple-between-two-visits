/**
 * The asymmetric evidence check (the guided safety harness, step 3; risk/types.ts). The risk screen quotes his words for every
 * field; this checks the quotes and decides what an unchecked field is worth. It runs on the MODEL's frame, before
 * mergeFrames (the rules' frame carries the baseline "no" and "none" with no quote by design, so checking it would turn every
 * answer into a question).
 *
 * A quote checks when it is a substring of the text it names (his message, or "turn:<n>", n turns back, 1 = the one before;
 * only his own turns: Ripple's lines carry "hurt yourself" and "995" and are never his words), after normalising whitespace,
 * case and full- / half-width marks (NFKC, curly quotes straightened, Chinese marks to their plain forms), or a substring of
 * that text's reading for the rules (normalize.ts: "kil myslef" quoted as "kill myself"). A quote that does not check is
 * dropped: no words of the model's are kept as his.
 *
 * Why asymmetric (the research report, "证据核对可能把间接信号吃掉" and P0 「证据核对改成不对称」): "I will be seeing my wife
 * again soon" can be quoted, but "this is a passive wish to die" is the model's reading of it; if a raising field that cannot
 * be checked were cleared, the check would remove exactly the hardest, indirect signals. STCC's rule is that a disposition
 * may be raised freely and lowered only with cause; Infermedica's that "unknown" never equals "no". So:
 *
 *   RAISING fields with no checked quote become "unclear" (a question to him), never "no" or "none" (effect "to_possible"):
 *     selfHarm.ideation active / passive, selfHarm.plan / means / soon / lethalityQuestion "yes", distress "yes" (these
 *     rest on selfHarm.evidence); a symptom's now / severe / sudden "yes" (its own evidence); an amount beyond the label (its
 *     own evidence: an unchecked one is "unknown", more but how much not known); looksDifferent "yes" (the medicines'
 *     evidence);
 *   LOWERING fields with no checked quote become unknown, "unclear" (effect "to_unknown"):
 *     - a symptom "not now" must quote words that place it in the past and say it is over, "not severe" words that call it
 *       mild, "not sudden" words that say it came on gradually (rules-floor.ts saysOver / saysMild / saysGradual); minutes
 *       with no checked quote are null;
 *     - ideation "none", lethalityQuestion "no" and distress "no" need a checked self-harm quote when self-harm is in
 *       question: his watch state is on, the rules see any self-harm signal or distress in his message or his turns
 *       (rulesFrame), his words carry a self-harm cue word (classify.ts selfHarmCue), or the frame itself raises another
 *       self-harm field or says distress "yes". With none of these they are the baseline, not a lowering, and stand;
 *     - plan / means / soon "no" beside a wish to die (ideation active, passive or unclear) need a checked quote that says
 *       no about that very thing (a negation with a plan, means or time word: "I have no plan", "no pills at home", 今晚不会):
 *       "no plan" is his to say, never the model's to assume ("I wish I would not wake up" has a "not" and says nothing of
 *       a plan);
 *     - about "other_adult" (it moves the crisis off him) needs a person other than him named in his message or a checked
 *       quote (he, she, my wife, 我老婆, dia ...);
 *     - amount "none" when his message carries an overdose word the rules know (emergencyCue "overdose") and the rules' own
 *       frame found no amount;
 *   medicines: a ref to one of his medicines must have a checked quote that names it (its name, brand, Chinese name or what
 *   it is for), else it is "unspecified" (which one is then asked; the model never picks one for him); a ref not on his list
 *   is "unknown".
 *
 * stopOrChange, when and acts are not checked: they route to a pathway's questions, which ask rather than decide. `missing` is
 * recomputed. Pure.
 */
import { findDrugMentions, matchDrug, normalizeName } from "@/lib/kb/match";
import { emergencyCue, selfHarmCue } from "../classify";
import { normalizedVariants, normalizeForRules } from "./normalize";
import { missingFor, rulesFrame, saysGradual, saysMild, saysOver } from "./rules-floor";
import type { Evidence, Frame, RiskScreenInput } from "./types";

export interface EvidenceMiss {
  field: string;
  effect: "to_unknown" | "to_possible";
}

/** Whitespace, case and full- / half-width marks normalised; the quote's own stray end marks trimmed. */
function key(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[。｡]/g, ".")
    .replace(/[、]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}
const trimQuote = (s: string) => key(s).replace(/^[\s"'.,;:!?()]+|[\s"'.,;:!?()]+$/g, "");

/** The text a quote names: his message, or one of his own last turns (never Ripple's). */
function sourceOf(e: Evidence, input: RiskScreenInput): string | null {
  if (e.from === "message") return input.message;
  const m = /^turn:(\d{1,2})$/.exec(e.from);
  if (!m) return null;
  const n = Number(m[1]);
  const turn = n >= 1 ? input.turns[input.turns.length - n] : undefined;
  return turn && turn.role === "patient" ? turn.text : null;
}

/** A quote of his words that is really his (see the header). Two characters at least. */
export function quoteChecks(e: Evidence, input: RiskScreenInput): boolean {
  const q = trimQuote(e.quote);
  if ([...q].length < 2) return false;
  const src = sourceOf(e, input);
  if (src === null) return false;
  return key(src).includes(q) || key(normalizeForRules(src)).includes(q);
}

/** A negation in his words ("no plan", "I don't have any", 没有, tak). */
const NEGATION = /\b(?:no|not|never|none|nothing|don'?t|doesn'?t|didn'?t|won'?t|haven'?t|isn'?t|aren'?t|wouldn'?t|no longer|tak|tidak|bukan)\b|没|不|無|无|冇|唔|毋/i;
/** What a "no" must be about: a plan, the means, the time ("I have no plan", "I don't have any pills at home", 今晚不会). */
const SAYS_NO_ABOUT: Record<"plan" | "means" | "soon", RegExp> = {
  plan: /\b(?:plan\w*|intend\w*|going to|gonna|method|how|do it|do anything|act on)\b|计划|打算|方法|做傻事/i,
  means: /\b(?:pills?|tablets?|medicines?|meds|means|anything|stuff|rope|charcoal|knife)\b|药|东西|工具/i,
  soon: /\b(?:tonight|today|now|soon|any ?time soon|anytime|right away)\b|今晚|今天|现在|马上/i,
};
/** A person other than him (about "other_adult" must name one). */
const OTHER_PERSON =
  /\b(?:he|she|they|him|her|them|his|dad|daddy|father|papa|mum|mom|mummy|mommy|mother|grandpa|grandma|grandfather|grandmother|granny|husband|wife|son|daughter|brother|sister|friend|neighbou?r|uncle|auntie|aunty|cousin|in-laws?|missus|ah ma|ah gong|ah kong|ah po|dia|bapa|ayah|abah|emak|mak|ibu|suami|isteri|anak|datuk|atuk|nenek)\b|他|她|佢|伊|爸|妈|媽|老公|老婆|丈夫|妻子|太太|先生|儿子|兒子|女儿|女兒|哥|姐|弟|妹|爷爷|爺爺|奶奶|外公|外婆|老伴|朋友|邻居|鄰居|அப்பா|அம்மா|கணவர்|மனைவி|மகன்|மகள்|அவர்/iu;

/** What his medicine is for, by KB id (rules-floor.ts reads the same words). */
const CLASS_OF: Record<string, RegExp> = {
  amlodipine: /blood pressure|\bbp\b|hypertension|high blood|降压|血压/i,
  losartan: /blood pressure|\bbp\b|hypertension|high blood|降压|血压/i,
  atorvastatin: /cholesterol|statin|降脂|胆固醇|膽固醇|血脂/i,
  metformin: /diabet|sugar|降糖|糖尿|血糖/i,
  paracetamol: /pain ?killer|pain (?:pill|tablet|medicine)|止痛/i,
  ibuprofen: /pain ?killer|pain (?:pill|tablet|medicine)|止痛/i,
  aspirin: /blood thinner|薄血/i,
};

/** A quote names one of his medicines: its name, a KB name or alias of the same drug, or what it is for. */
function namesMedicine(quote: string, med: { name: string }): boolean {
  const q = key(quote);
  const name = normalizeName(med.name);
  if (name.length >= 2 && q.includes(name)) return true;
  const kb = matchDrug(med.name)?.drugId ?? findDrugMentions(med.name)[0]?.drugId ?? null;
  if (!kb) return false;
  if (findDrugMentions(quote).some((m) => m.drugId === kb)) return true;
  return !!CLASS_OF[kb]?.test(q);
}

/**
 * The model's frame with its evidence checked (see the header): quotes that do not check dropped, unchecked raising fields
 * "unclear" (possible), unchecked lowering fields unknown, every change recorded.
 */
export function checkEvidence(frame: Frame, input: RiskScreenInput): { frame: Frame; misses: EvidenceMiss[] } {
  const misses: EvidenceMiss[] = [];
  const miss = (field: string, effect: EvidenceMiss["effect"]) => misses.push({ field, effect });
  const checked = (list: Evidence[]) => list.filter((e) => quoteChecks(e, input));
  const f: Frame = structuredClone(frame);

  // ---- self-harm (and distress, which rests on the same quotes)
  const shEv = checked(f.selfHarm.evidence);
  f.selfHarm.evidence = shEv;
  const sh = f.selfHarm;
  const has = shEv.length > 0;
  const floor = rulesFrame(input.message, { meds: input.meds, turns: input.turns });
  const his = [input.message, ...input.turns.filter((t) => t.role === "patient").slice(-10).map((t) => t.text)];
  const cue = his.some((t) => normalizedVariants(t).some((v) => selfHarmCue(v)));
  const floorSignal =
    floor.selfHarm.ideation !== "none" || floor.selfHarm.lethalityQuestion !== "no" || floor.selfHarm.means !== "no" || floor.distress !== "no";
  // (distress "unclear" alone does not put self-harm in question: the screen marks it on any worried message, a wife who will
  // not wake up included)
  const frameRaises = sh.ideation !== "none" || sh.plan !== "no" || sh.means !== "no" || sh.soon !== "no" || sh.lethalityQuestion !== "no" || f.distress === "yes";
  const inQuestion = input.watch || floorSignal || cue || frameRaises;

  // raising, unchecked -> possible
  if (!has) {
    if (sh.ideation === "active" || sh.ideation === "passive") {
      sh.ideation = "unclear";
      miss("selfHarm.ideation", "to_possible");
    }
    for (const k of ["plan", "means", "soon", "lethalityQuestion"] as const) {
      if (sh[k] === "yes") {
        sh[k] = "unclear";
        miss(`selfHarm.${k}`, "to_possible");
      }
    }
    if (f.distress === "yes") {
      f.distress = "unclear";
      miss("distress", "to_possible");
    }
  }
  // lowering, unchecked, while self-harm is in question -> unknown
  if (inQuestion && !has) {
    if (sh.ideation === "none") {
      sh.ideation = "unclear";
      miss("selfHarm.ideation", "to_unknown");
    }
    if (sh.lethalityQuestion === "no") {
      sh.lethalityQuestion = "unclear";
      miss("selfHarm.lethalityQuestion", "to_unknown");
    }
    if (f.distress === "no") {
      f.distress = "unclear";
      miss("distress", "to_unknown");
    }
  }
  // "no plan / no means / not soon" beside a wish to die: only when his checked words say no about that very thing
  if (sh.ideation !== "none") {
    for (const k of ["plan", "means", "soon"] as const) {
      if (sh[k] === "no" && !shEv.some((e) => NEGATION.test(e.quote) && SAYS_NO_ABOUT[k].test(e.quote))) {
        sh[k] = "unclear";
        miss(`selfHarm.${k}`, "to_unknown");
      }
    }
  }

  // ---- symptoms: each against its own quotes
  for (const s of f.symptoms) {
    const ev = checked(s.evidence);
    s.evidence = ev;
    const words = ev.map((e) => e.quote).join(" ");
    const field = (k: string) => `symptoms.${s.kind}.${k}`;
    if (s.now === "yes" && !ev.length) {
      s.now = "unclear";
      miss(field("now"), "to_possible");
    } else if (s.now === "no" && !(ev.length && saysOver(s.kind, words))) {
      s.now = "unclear";
      miss(field("now"), "to_unknown");
    }
    if (s.severe === "yes" && !ev.length) {
      s.severe = "unclear";
      miss(field("severe"), "to_possible");
    } else if (s.severe === "no" && !(ev.length && saysMild(words))) {
      s.severe = "unclear";
      miss(field("severe"), "to_unknown");
    }
    if (s.sudden === "yes" && !ev.length) {
      s.sudden = "unclear";
      miss(field("sudden"), "to_possible");
    } else if (s.sudden === "no" && !(ev.length && saysGradual(words))) {
      s.sudden = "unclear";
      miss(field("sudden"), "to_unknown");
    }
    if (s.minutes !== null && !ev.length) {
      s.minutes = null;
      miss(field("minutes"), "to_unknown");
    }
  }

  // ---- amount
  const amountEv = checked(f.amount.evidence);
  f.amount.evidence = amountEv;
  if (f.amount.relation !== "none" && f.amount.relation !== "unknown" && !amountEv.length) {
    f.amount.relation = "unknown";
    miss("amount", "to_possible");
  } else if (f.amount.relation === "none" && !amountEv.length && floor.amount.relation === "none" && emergencyCue(input.message).includes("overdose")) {
    f.amount.relation = "unknown";
    miss("amount", "to_unknown");
  }

  // ---- medicines: his, named in a checked quote; else unspecified; not his: unknown
  const byId = new Map(input.meds.map((m) => [m.id, m]));
  const meds = new Map<string, Evidence[]>();
  for (const m of f.medicines) {
    const ev = checked(m.evidence);
    let ref = m.ref;
    const med = byId.get(ref);
    if (med && !ev.some((e) => namesMedicine(e.quote, med))) {
      ref = "unspecified";
      miss(`medicines.${m.ref}`, "to_unknown");
    } else if (!med && ref !== "unknown" && ref !== "unspecified") {
      ref = "unknown";
      miss(`medicines.${m.ref}`, "to_unknown");
    }
    const list = meds.get(ref) ?? [];
    for (const e of ev) if (!list.some((x) => x.quote === e.quote && x.from === e.from)) list.push(e);
    meds.set(ref, list);
  }
  // (an unspecified medicine next to one he named is the same words twice)
  if (meds.has("unspecified") && [...meds.keys()].some((k) => byId.has(k)) && !meds.get("unspecified")!.length) meds.delete("unspecified");
  f.medicines = [...meds.entries()].map(([ref, evidence]) => ({ ref, evidence }));
  if (f.looksDifferent === "yes" && !f.medicines.some((m) => m.evidence.length)) {
    f.looksDifferent = "unclear";
    miss("looksDifferent", "to_possible");
  }

  // ---- whose it is: "other_adult" moves it off him, so another person must be named
  if (f.about === "other_adult") {
    const named = OTHER_PERSON.test(input.message) || [...shEv, ...amountEv, ...f.symptoms.flatMap((s) => s.evidence)].some((e) => OTHER_PERSON.test(e.quote));
    if (!named) {
      f.about = "unclear";
      miss("about", "to_unknown");
    }
  }

  f.missing = missingFor(f);
  return { frame: f, misses };
}
