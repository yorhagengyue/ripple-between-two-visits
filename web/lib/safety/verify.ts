/**
 * The three checks (spec section 5 steps 4-6, web-app.md 6.3). Every sentence a patient can see goes through
 * all three; a sentence that fails any layer is blocked.
 *
 * Layer 1, source and slots (deterministic): the source id is in this answer's candidate list; the quoted span
 * really is part of that source; every drug, unit, frequency, time and number in the sentence (English and
 * Mandarin) is also in the quoted span after both are normalised with glossary.json. Numbers in a referral row are
 * legal because that row is the cited span. Numbers on the referrals.json B4-06 "do not display" list are blocked
 * whatever the source. And where the words come from (originOf):
 *   - the doctor's, the counter's or a pharmacist's words, a label and a referral row are only ever relayed word
 *     for word: one or more whole sentences of the source, nothing added, nothing cut out of a sentence
 *     (quote_not_verbatim). "R4 + 'But an extra is fine today.'" and "Take it in the morning." (label) stop here.
 *     Word for word means sentence by sentence with the punctuation inside each sentence (text.ts quoteKey): only
 *     case, whitespace, quote style and the mark that ends a sentence are ignored, so a quote whose sentence
 *     boundary moved ("Please don't. Change the dose yourself if ...") is not R4 and stops here too. A sentence
 *     that is a quote (span, patient_text, template, slot_template) is checked and shown in the source's own words
 *     (sourceWords / withSourceWords in verifySentences), never in the generator's string;
 *   - Chinese in `en` must be the source's own words or the label slot template, never model text
 *     (chinese_not_from_source);
 *   - `zh` must be the template's, the patient_text restatement's, the record summary's own Mandarin or the label
 *     slot template (zh_not_from_template): Mandarin is never translated by the model;
 *   - a sentence marked as a template must carry that template's exact text (template_mismatch);
 *   - a leaflet source (patient_text) is shown only as its reviewed restatement. Its span is the kb evidence field,
 *     written for reviewers ("The page adds that the odds of this are very small and that most people have no
 *     trouble with the medicine." sits inside a paragraph about liver injury), so no part of it lifted word for
 *     word is a quote the patient may see (evidence_not_patient_facing); a model rewording of it is borderline
 *     (layer 3).
 *
 * Fix round 3: a spoken line (the doctor's, the counter's, a pharmacist's, R1-R4 too) and a label are shown WHOLE or not
 * at all (sourceQuote): a quote of any of their sentences shows the whole line, never the part the generator picked, so no
 * sentence is ever separated from the one that takes it back, limits it or refuses it. A line is never shown when a
 * boundary inside it turns a refusal round (text.ts ambiguousBoundary: "Please don't; change ...", "Do not take. Two
 * tablets at once.", 「唔得㗎。一次食两粒。」) or when it was cut from the same speaker's line next to it (Candidate.context:
 * "Please don't." | "Change the dose yourself."): quote_not_verbatim with ambiguous_sentence_boundary or cut_from_context.
 *
 * Layer 1 also checks relevance (fix round 1, relevanceReasons): a spoken line other than R1-R4 must be about the
 * medicines asked about (all of them, when the ask is about combining), and an answer to one of his questions only
 * answers an ask on the same topic, so a whole verbatim sentence cannot be lifted out of its conversation. And a
 * quote is whole sentences of the source as the source splits them (text.ts: "0.5" and "approx." are not sentence
 * ends, nor is a line break), standing alone there (not after "Please don't." and not before "Only if needed.").
 *
 * Layer 2, directives and judgements (rules): if the sentence tells him to take / stop / skip / change a medicine,
 * it must be a restatement, carry an attribution (label, doctor, dispenser, pharmacist, leaflet) that matches the
 * source, the cited source must itself be an instruction, and the words must be the source's own (span,
 * patient_text or template; a model-worded directive is blocked: directive_not_verbatim). A sentence the model
 * worded itself may not contain judgement or advice words (judgement.ts: high, normal, fine, no need, caused by,
 * together, extra, 偏高, 没事 ...), minimising words (only, just, most people, no trouble), claims about what a
 * medicine treats or prevents, or statements about what a source leaves out (not mentioned, silent): judgement_word.
 *
 * Layer 3, the checker model: only for borderline sentences, i.e. a model paraphrase of a leaflet field, a record
 * summary or a template that passed layers 1 and 2. The checker gets the WHOLE source text (candidate.span), never
 * only the fragment the generator picked: the fragment is passed as a hint, because a fragment out of its context
 * can say what the source does not ("chest pain (angina) is not mentioned" -> "it does not treat chest pain").
 * With no checker configured, or any checker error (timeout, the caller's deadline, refusal by the spend cap, a
 * reply that is not {"supported": true}), the sentence is blocked: fail closed. The checker is told to answer in
 * JSON and nothing else; only a literal `true` passes. The checks of one answer run in parallel.
 */
import { parseModelJson } from "@/lib/llm/json";
import { LlmError, type LlmClient } from "@/lib/llm/types";
import type { SupportPayload } from "@/lib/llm/protocol";
import { directiveHits } from "./directive";
import { findForbiddenNumbers } from "./forbidden";
import { modelWordingHits, type JudgementHit } from "./judgement";
import { extractSlots, mergeSlots, missingSlots, normalizeDeclared, type SlotCategory, type SlotMismatch, type Slots } from "./slots";
import { ALL_TEMPLATES, type Template } from "./templates";
import { OTHER_SUBSTANCE } from "./substances";
import { sameFacet } from "./topics";
import { ambiguousBoundary, containsNormalized, contextHangs, contextLimits, hasHan, matchWholeSentences, normalizeForCompare, sameQuote, sentenceRunOf } from "./text";
import {
  DIRECTIVE_ATTRIBUTIONS,
  type Candidate,
  type CandidateKind,
  type Layer1Result,
  type Layer2Result,
  type Layer3Result,
  type Sentence,
  type SentenceOrigin,
  type SentenceVerdict,
  UNIDENTIFIED_DRUG,
} from "./types";
import { zhFromSlots } from "./zh";

const DECLARED: { key: keyof Sentence["slots"]; category: SlotCategory }[] = [
  { key: "drug", category: "drugs" },
  { key: "quantity", category: "numbers" },
  { key: "unit", category: "units" },
  { key: "frequency", category: "frequencies" },
  { key: "time", category: "times" },
];

const REASON: Record<SlotCategory, string> = {
  drugs: "drug_not_in_span",
  units: "unit_not_in_span",
  frequencies: "frequency_not_in_span",
  times: "time_not_in_span",
  numbers: "number_not_in_span",
};

/** What the patient asked about, for the relevance rule (VerifyContext.ask; pipeline.ts sets it). */
export interface AskScope {
  /**
   * the medicines the answer is about: the ones the input names or points at, else his prescriptions; plus
   * OTHER_SUBSTANCE (substances.ts) when it also names a supplement, food, drink or a medicine by its use ("fish oil",
   * "my sleeping pill"), or, in a combination ask, any word that is not one of his medicines
   */
  drugs: string[];
  /** the input's topics (topics.ts detectTopics, plus the topic a model classification added) */
  topics: string[];
  /**
   * the input names or points at a medicine of any kind ("my tablet", amlodipine, "my sleeping pill"); false for a
   * question about a food or drink alone ("Can I drink the soup after breakfast?"). Omitted = true (fail closed).
   */
  namedMedicine?: boolean;
  /**
   * C2 track S: the input's own words. With it, a spoken answer to one of his questions (Candidate.answersQuestion) answers
   * only an ask on the same side of their shared topic (topics.ts sameFacet: one more tablet vs half a tablet, ankle
   * swelling vs dizziness, fasting vs when). Omitted: the topic alone decides, as before.
   */
  text?: string;
}

/** Topics where a quote about another medicine, or about no known medicine, must never stand in for an answer. */
const MEDICINE_TOPICS = ["combination", "dose_change", "stopping"];
/** Required lines that are relayed on purpose whatever medicine is asked about: the doctor's numbers and R4. */
const STANDING_TOPICS = ["target", "threshold", "dose_change"];
const STANDING_LINES = ["R1", "R2", "R4"];
/** Label and leaflet topics that speak about taking a medicine with something else (candidates.ts PATIENT_TEXT_TOPIC). */
const COMBINING_TOPICS = ["combination", "grapefruit"];

/**
 * Layer 1, relevance (fix round 1, 10-09): a whole, verbatim sentence can still answer a different question. With the
 * real model, "Can I take my knee painkiller after breakfast with my BP pills?" got the doctor's "Yes, both together
 * after breakfast is fine." (his answer about amlodipine and losartan) as its first line in 11 of 18 combination asks.
 * For a spoken line, the line's medicines (Candidate.about: its own words or its conversation) must fit the ask:
 *   - a line about a medicine nobody identified (the relative's box) answers only an ask about that box;
 *   - a line about other medicines than the ask's (no shared medicine) is not an answer to it, and neither is any line
 *     about a medicine when the ask names only something else (a supplement, a drink, "my sleeping pill");
 *   - in an ask about combining medicines, a spoken line must be about every medicine asked about ("both together is
 *     fine" about amlodipine and losartan says nothing about the painkiller, nor about fish oil, grapefruit juice or a
 *     beer: fix round 2, the real model put it under those asks in 7 of 12);
 *   - a line about no known medicine never answers a combination, dose or stopping ask, nor an ask that names another
 *     substance;
 *   - a spoken answer to one of his questions (Candidate.answers: that question's topics) answers only an ask that
 *     shares a topic with that question ("可以，回来再吃" answered "can I take it after tai chi?", not "can I take it at night?").
 * The doctor's required lines R1-R4 follow the same rules (fix round 2: R3's "So you take it every day, even when you
 * feel fine." is about amlodipine and was shown under "Should I take ibuprofen every day even when I feel fine?"),
 * except the ones relayed on purpose whatever is asked: R1 and R2 (his numbers) and R4 ("Please don't change the dose
 * yourself."), a standing refusal of every dose change.
 * Labels and leaflet restatements are about one medicine each: they never answer an ask about other medicines only (fix
 * round 2: the amlodipine label under "How many ibuprofen can I take for my knee tonight?"), and when the ask is about
 * taking his medicine together with something else, only their lines about combining answer it (not_about_combining:
 * "you can take it alongside a meal" under "... together with a beer after breakfast?"). Templates, referral rows and
 * his own records are not checked here.
 */
export function relevanceReasons(candidate: Candidate, ask: AskScope | undefined): string[] {
  if (!ask) return [];
  const asked = [...new Set(ask.drugs)];
  const askedMeds = asked.filter((d) => d !== OTHER_SUBSTANCE);
  const other = asked.includes(OTHER_SUBSTANCE);
  /** no medicine of the ask among `about` (an ask naming only another substance shares none) */
  const noneShared = (about: string[]) => (askedMeds.length > 0 ? !about.some((d) => askedMeds.includes(d)) : other);

  if (candidate.kind === "label" || candidate.kind === "patient_text") {
    const about = candidate.about ?? candidate.drugs ?? [];
    if (about.length === 0) return [];
    if (about.includes(UNIDENTIFIED_DRUG)) return asked.includes(UNIDENTIFIED_DRUG) ? [] : ["source_about_other_medicine"];
    if (noneShared(about)) return ["source_about_other_medicine"];
    // taking his medicine together with something else (a beer, fish oil, cough syrup): only what the label or leaflet
    // says about combining answers it ("tell your doctor about every other medicine", "avoid grapefruit"), never how to
    // take the tablet ("you can take it alongside a meal", "Take ONE tablet every MORNING" read as "so it is fine")
    if (other && ask.topics.includes("combination") && !(candidate.topics ?? []).some((t) => COMBINING_TOPICS.includes(t))) return ["not_about_combining"];
    return [];
  }
  if (candidate.kind !== "visit") return [];
  const required = candidate.cite?.requiredLine;
  if (required && (STANDING_LINES.includes(required) || (candidate.topics ?? []).some((t) => STANDING_TOPICS.includes(t)))) return [];
  const about = candidate.about ?? candidate.drugs ?? [];
  const reasons: string[] = [];
  if (about.includes(UNIDENTIFIED_DRUG) ? !asked.includes(UNIDENTIFIED_DRUG) : about.length > 0 && noneShared(about)) {
    reasons.push("source_about_other_medicine");
  } else if (ask.topics.includes("combination") && about.length > 0 && !(asked.length > 0 && asked.every((d) => about.includes(d)))) {
    reasons.push("combination_not_all_medicines");
  } else if (about.length === 0 && ((other && ask.namedMedicine !== false) || ask.topics.some((t) => MEDICINE_TOPICS.includes(t)))) {
    // (a line about no medicine still answers a question about a food alone: "Less gravy, don't finish the soup.")
    reasons.push("source_medicine_unknown");
  }
  if (candidate.answers?.length && !ask.topics.some((t) => candidate.answers!.includes(t))) reasons.push("answer_to_another_question");
  else if (candidate.answers?.length && ask.text && candidate.answersQuestion) {
    // C2: the same topic, but the other side of it ("Can I take one more tablet?" answered; "Can I halve it?" asked)
    const shared = ask.topics.filter((t) => candidate.answers!.includes(t));
    if (!shared.some((t) => sameFacet(t, ask.text!, candidate.answersQuestion!))) reasons.push("answer_to_another_question");
  }
  return reasons;
}

export function layer1(sentence: Sentence, candidate: Candidate | undefined, ask?: AskScope): Layer1Result {
  const reasons: string[] = [];
  const forbidden = [...findForbiddenNumbers(sentence.en), ...findForbiddenNumbers(sentence.zh ?? "")];
  if (forbidden.length) reasons.push("do_not_display_number");
  if (!candidate) {
    reasons.push("unknown_source");
    return { pass: false, reasons, detail: { sourceId: sentence.sourceId, forbidden } };
  }
  if (!sentence.span || !(containsNormalized(candidate.span, sentence.span) || containsNormalized(candidate.spanZh ?? "", sentence.span))) {
    reasons.push("span_not_in_source");
  }
  reasons.push(...provenanceReasons(sentence, candidate));
  reasons.push(...relevanceReasons(candidate, ask));

  const spanSlots: Slots = mergeSlots(extractSlots(sentence.span || ""), extractSlots(candidate.spanZh ?? ""));
  const sentenceSlots: Slots = mergeSlots(extractSlots(sentence.en), extractSlots(sentence.zh ?? ""));

  // slots the generator declared must map into the glossary and be present in the span too
  const declared = sentence.slots ?? {};
  for (const { key, category } of DECLARED) {
    const raw = declared[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const id = normalizeDeclared(category, String(raw));
    if (id === null) reasons.push("declared_slot_not_in_glossary");
    else if (!sentenceSlots[category].includes(id)) sentenceSlots[category] = [...sentenceSlots[category], id].sort();
  }
  for (const n of declared.numbers ?? []) {
    const id = normalizeDeclared("numbers", String(n));
    if (id === null) reasons.push("declared_slot_not_in_glossary");
    else if (!sentenceSlots.numbers.includes(id)) sentenceSlots.numbers = [...sentenceSlots.numbers, id].sort();
  }

  const missing: SlotMismatch[] = missingSlots(sentenceSlots, spanSlots);
  for (const m of missing) if (!reasons.includes(REASON[m.category])) reasons.push(REASON[m.category]);
  return { pass: reasons.length === 0, reasons, sentenceSlots, spanSlots, missing, detail: forbidden.length ? { forbidden } : undefined };
}

export function layer2(sentence: Sentence, candidate: Candidate | undefined): Layer2Result {
  const origin = originOf(sentence, candidate);
  const hits = [...directiveHits(sentence.en), ...directiveHits(sentence.zh ?? "")];
  const reasons: string[] = [];
  if (hits.length > 0) {
    if (sentence.speechAct !== "restate") reasons.push("directive_not_restate");
    if (!sentence.attribution || !DIRECTIVE_ATTRIBUTIONS.includes(sentence.attribution)) reasons.push("directive_without_attribution");
    else if (candidate?.attribution && candidate.attribution !== sentence.attribution) reasons.push("attribution_mismatch");
    if (!candidate?.instruction) reasons.push("directive_span_not_instruction");
    // 原样转述: an instruction is only ever relayed in the source's own words or its reviewed restatement
    if (origin === "model") reasons.push("directive_not_verbatim");
  }
  // judgement and advice words only in words someone else said or a human wrote and reviewed
  const judgement: JudgementHit[] = [];
  if (origin === "model") {
    const seen = new Set<string>();
    for (const h of [...modelWordingHits(sentence.en), ...modelWordingHits(sentence.zh ?? "")]) {
      if (seen.has(h.word)) continue;
      seen.add(h.word);
      judgement.push(h);
    }
    if (judgement.length > 0) reasons.push("judgement_word");
  }
  return {
    pass: reasons.length === 0,
    directive: hits.length > 0,
    ...(hits.length > 0 ? { hits } : {}),
    ...(judgement.length > 0 ? { judgement } : {}),
    reasons,
  };
}

/** Source kinds relayed only word for word: spoken lines (doctor, counter, pharmacist), labels, referral rows. */
export const VERBATIM_KINDS: CandidateKind[] = ["visit", "label", "referral"];

/**
 * Fix round 3 (the B2 red team's V1-V5 after fix round 2): a spoken line (the doctor's, the counter's, a pharmacist's,
 * R1-R4 included) and a label are only ever shown WHOLE. A quote of one or more of their sentences is shown as the whole
 * line, never as the part the generator picked, so no sentence is ever shown without the one that limits it ("Take two
 * tablets. No, one." "Take FOUR tablets. Once a WEEK only." "Take two at once. Don't do that."), nor without the refusal
 * before it in any wording ("唔得㗎。一次食两粒。" "வேண்டாம். …"). Before that list grew again, the rule became "the whole line".
 */
export const WHOLE_SOURCE_KINDS: CandidateKind[] = ["visit", "label"];

/**
 * Why a whole spoken line or label may not be shown at all, or null: a sentence boundary inside it that turns a refusal
 * round (text.ts ambiguousBoundary; a label is printed text, so a full stop after a negated verb is not suspect there), or
 * a neighbouring line of the same speaker that leaves it hanging or takes it back (Candidate.context, contextHangs /
 * contextLimits).
 */
export function wholeSourceBlock(candidate: Candidate): "ambiguous_sentence_boundary" | "cut_from_context" | null {
  if (ambiguousBoundary(candidate.span, { printed: candidate.kind === "label" })) return "ambiguous_sentence_boundary";
  const ctx = candidate.context;
  if (ctx && ((ctx.before && contextHangs(ctx.before)) || (ctx.after && contextLimits(ctx.after)))) return "cut_from_context";
  return null;
}

/**
 * The words shown for a quote of `candidate` whose text is `en`, or null when it is not a quote: for a spoken line or a
 * label (WHOLE_SOURCE_KINDS), the whole line when `en` is one or more of its whole sentences and the line may be shown
 * (wholeSourceBlock); for any other source, the matched sentences (text.ts matchWholeSentences).
 */
export function sourceQuote(candidate: Candidate, en: string): string | null {
  if (WHOLE_SOURCE_KINDS.includes(candidate.kind)) {
    const whole = [candidate.span, candidate.spanZh].find((w): w is string => !!w && sentenceRunOf(w, en));
    return whole !== undefined && wholeSourceBlock(candidate) === null ? whole.trim() : null;
  }
  return matchWholeSentences(candidate.span, en) ?? (candidate.spanZh ? matchWholeSentences(candidate.spanZh, en) : null);
}

function templateById(id: string | undefined): Template | undefined {
  return id ? ALL_TEMPLATES.find((t) => t.id === id) : undefined;
}

/**
 * The verbatim test (text.ts sameQuote): sentence by sentence, ignoring only case, whitespace, quote style and the
 * mark that ends a sentence. Punctuation inside a sentence and the sentence boundaries count (10-09 wave B: the
 * old punctuation-blind compare let "Please don't. Change the dose yourself if ..." pass as R4).
 */
const same = (a: string | null | undefined, b: string | null | undefined): boolean => sameQuote(a, b);

/** The Mandarin label template of a label source ("药袋上写着：每天早上吃一粒。"), or null. */
function labelSlotTemplate(candidate: Candidate): string | null {
  return candidate.kind === "label" ? zhFromSlots(candidate.span, "label") : null;
}

/**
 * How the sentence text relates to its source (decides which rules apply and whether layer 3 is needed).
 * Only the pipeline sets origin "template", and only a sentence whose en is that template's en counts as one.
 */
export function originOf(sentence: Sentence, candidate: Candidate | undefined): SentenceOrigin {
  if (sentence.origin === "template") {
    const t = templateById(sentence.templateId);
    if (t && same(t.en, sentence.en)) return "template";
  }
  if (!candidate) return "model";
  if (candidate.restatement && same(sentence.en, candidate.restatement.en)) return "patient_text";
  // a leaflet source is shown only as its reviewed restatement: its evidence text is for reviewers, never a quote
  if (candidate.kind === "patient_text") return "model";
  const quoted = sourceQuote(candidate, sentence.en) !== null;
  if (quoted && containsNormalized(sentence.span, sentence.en)) return "span";
  if (same(sentence.en, labelSlotTemplate(candidate))) return "slot_template";
  return "model";
}

/**
 * The source's own words for a sentence whose origin is a quote (span, patient_text, template, slot_template): the
 * matched sentences of the span as written, the restatement, the template or the label's Mandarin template. null for
 * a model sentence. What the patient reads is this text, never the generator's string (they can differ in case,
 * whitespace, quote style and a final full stop, nothing else).
 */
export function sourceWords(sentence: Sentence, candidate: Candidate | undefined, origin: SentenceOrigin = originOf(sentence, candidate)): string | null {
  switch (origin) {
    case "template":
      return templateById(sentence.templateId)?.en ?? null;
    case "patient_text":
      return candidate?.restatement?.en ?? null;
    case "span":
      return candidate ? sourceQuote(candidate, sentence.en) : null;
    case "slot_template":
      return candidate ? labelSlotTemplate(candidate) : null;
    default:
      return null;
  }
}

/**
 * The sentence with its en replaced by the source's own words when it is a quote (a copy; unchanged otherwise). A span
 * quote also gets those words as its span, so the layer-1 slot check compares against what the source says there, not
 * against the span string the generator chose.
 */
export function withSourceWords(sentence: Sentence, candidate: Candidate | undefined): Sentence {
  const origin = originOf(sentence, candidate);
  const words = sourceWords(sentence, candidate, origin);
  if (words === null) return sentence;
  const span = origin === "span" ? words : sentence.span;
  return words !== sentence.en || span !== sentence.span ? { ...sentence, en: words, span } : sentence;
}

/** Mandarin texts a sentence may carry in `zh` (none of them written by the model). */
function allowedZh(sentence: Sentence, candidate: Candidate, origin: SentenceOrigin): string[] {
  switch (origin) {
    case "template": {
      const t = templateById(sentence.templateId);
      return t ? [t.zh, `${t.en}\n${t.zh}`] : [];
    }
    case "patient_text":
      return candidate.restatement?.zh ? [candidate.restatement.zh] : [];
    case "span": {
      const out: string[] = [];
      if (candidate.spanZh && same(sentence.en, candidate.span)) out.push(candidate.spanZh);
      if (candidate.kind === "label") {
        for (const z of [zhFromSlots(sentence.en, "label"), labelSlotTemplate(candidate)]) if (z) out.push(z);
      }
      return out;
    }
    case "slot_template":
      return [sentence.en];
    default:
      return [];
  }
}

/** Layer-1 rules about where the words come from (see the header). */
export function provenanceReasons(sentence: Sentence, candidate: Candidate): string[] {
  const reasons: string[] = [];
  const origin = originOf(sentence, candidate);
  if (sentence.origin === "template" && origin !== "template") reasons.push("template_mismatch");
  if (VERBATIM_KINDS.includes(candidate.kind) && origin !== "span" && origin !== "template" && origin !== "slot_template") {
    reasons.push("quote_not_verbatim");
    // the words are the source's, but a sentence boundary in them turns a refusal round ("Please don't. Change the dose
    // yourself."), or the line next to it does (fix round 3): named apart for the backstage (fix round 2)
    const inSource = containsNormalized(candidate.span, sentence.en);
    const whole = WHOLE_SOURCE_KINDS.includes(candidate.kind) && inSource ? wholeSourceBlock(candidate) : null;
    if (whole === "cut_from_context") reasons.push("cut_from_context");
    if (whole === "ambiguous_sentence_boundary" || (ambiguousBoundary(sentence.en) && inSource)) reasons.push("ambiguous_sentence_boundary");
  }
  if (origin === "model" && hasHan(sentence.en)) reasons.push("chinese_not_from_source");
  // the kb evidence behind a leaflet restatement, lifted as it stands (a sentence or any part of one): reviewer-facing
  // text out of its context. The live checker passes such a lift even given the whole source ("Most people have no
  // trouble with the medicine." is literally there), so this is decided here, not by layer 3.
  if (candidate.kind === "patient_text" && origin === "model" && containsNormalized(candidate.span, sentence.en)) reasons.push("evidence_not_patient_facing");
  const zh = sentence.zh?.trim();
  if (zh && !allowedZh(sentence, candidate, origin).some((z) => z.trim() === zh)) reasons.push("zh_not_from_template");
  return reasons;
}

export const SYSTEM_SUPPORT = [
  "You are an independent checker for a medication-companion app used by older patients.",
  "You get SOURCE (the complete text of one source: a doctor's words, a medicine label, a leaflet summary written for reviewers, or a summary of the patient's own records),",
  "sometimes FRAGMENT (the part another model says it relied on; a hint only: judge against the whole SOURCE) and SENTENCE (what the app wants to show the patient).",
  "Answer supported only when the SOURCE, read as a whole, says what the SENTENCE says: the same medicine, amounts, times and instructions;",
  "nothing added; nothing made stronger, weaker, more reassuring or more alarming; no new advice.",
  "Not supported, among others: a SENTENCE that turns 'the source does not mention X' or 'the source is silent on X' into a statement about X",
  "(for example that the medicine does or does not treat X); a SENTENCE lifted out of its context so that it now refers to something else",
  "(a reassurance about one rare side effect presented as a general reassurance); words that minimise or judge (only, just, most people, no trouble, fine, normal)",
  "that the SOURCE does not use about the same thing; any claim about what the medicine treats, prevents or protects against that the SOURCE does not state.",
  "If unsure, answer not supported.",
  'Answer with JSON only: {"supported": true|false, "reason": "<few words>"}.',
].join(" ");

/** What the checker is sent: the whole source; the generator's fragment only as a hint when it is not the whole. */
export function supportPayload(sentence: Sentence, candidate: Candidate): SupportPayload {
  const fragment = sentence.span && normalizeForCompare(sentence.span) !== normalizeForCompare(candidate.span) ? sentence.span : undefined;
  return { task: "support", source: candidate.span, ...(fragment ? { fragment } : {}), sentence: sentence.en };
}

export async function layer3(
  sentence: Sentence,
  candidate: Candidate | undefined,
  checker: LlmClient | null,
  checkerReason: string | null,
  signal?: AbortSignal,
): Promise<Layer3Result & { tokens: number }> {
  const origin = originOf(sentence, candidate);
  if (origin !== "model") return { pass: true, needed: false, reasons: [], detail: { origin }, tokens: 0 };
  if (!checker || !candidate) {
    return { pass: false, needed: true, checker: null, reasons: ["no_checker"], detail: { origin, why: checkerReason ?? "no checker configured" }, tokens: 0 };
  }
  const payload = supportPayload(sentence, candidate);
  try {
    const res = await checker.chat({ system: SYSTEM_SUPPORT, user: JSON.stringify(payload), json: true, temperature: 0, maxTokens: 120, purpose: "support", signal });
    const parsed = parseModelJson(res.content) as { supported?: unknown; reason?: unknown } | null;
    if (!parsed || typeof parsed !== "object") throw new Error("checker reply is not a JSON object");
    const supported = parsed.supported === true;
    return {
      pass: supported,
      needed: true,
      checker: checker.provider,
      reasons: supported ? [] : ["checker_not_supported"],
      detail: { origin, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : undefined },
      tokens: res.tokens,
    };
  } catch (e) {
    // no model words: a reply that is not JSON makes JSON.parse quote the checker's reply in its message; only an
    // LlmError's own message (written by lib/llm) is kept, anything else is the code "error"
    return { pass: false, needed: true, checker: checker.provider, reasons: ["checker_error"], detail: { origin, error: e instanceof LlmError ? e.message.slice(0, 200) : "error" }, tokens: 0 };
  }
}

export interface VerifyContext {
  candidates: Map<string, Candidate>;
  checker: LlmClient | null;
  checkerReason: string | null;
  /** the caller's deadline: a check still running when it aborts fails closed (checker_error) */
  signal?: AbortSignal;
  /** what was asked (medicines, topics): the layer-1 relevance rule (relevanceReasons); omitted = not checked */
  ask?: AskScope;
}

/**
 * Run the three layers on each sentence (layer 2 only if layer 1 passed, layer 3 only if both passed). Layers 1
 * and 2 are synchronous rules; the layer-3 checks of all sentences run in parallel. Verdicts keep the input order.
 */
export async function verifySentences(sentences: Sentence[], ctx: VerifyContext): Promise<{ verdicts: SentenceVerdict[]; tokens: number }> {
  const runs = sentences.map(async (input, index): Promise<{ verdict: SentenceVerdict; tokens: number }> => {
    const candidate = ctx.candidates.get(input.sourceId);
    // a quote is checked and shown in the source's own words (verdict.sentence), never in the generator's string
    const sentence = withSourceWords(input, candidate);
    const l1 = layer1(sentence, candidate, ctx.ask);
    if (!l1.pass) return { verdict: { index, sentence, layer1: l1, layer2: null, layer3: null, pass: false, blockedBy: 1 }, tokens: 0 };
    const l2 = layer2(sentence, candidate);
    if (!l2.pass) return { verdict: { index, sentence, layer1: l1, layer2: l2, layer3: null, pass: false, blockedBy: 2 }, tokens: 0 };
    const { tokens, ...l3 } = await layer3(sentence, candidate, ctx.checker, ctx.checkerReason, ctx.signal);
    return { verdict: { index, sentence, layer1: l1, layer2: l2, layer3: l3, pass: l3.pass, blockedBy: l3.pass ? null : 3 }, tokens };
  });
  const done = await Promise.all(runs);
  return { verdicts: done.map((d) => d.verdict), tokens: done.reduce((n, d) => n + d.tokens, 0) };
}
