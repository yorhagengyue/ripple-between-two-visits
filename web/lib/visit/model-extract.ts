/**
 * Visit item extraction with the main model (web-app.md: the main model does "看诊事项抽取"), used on the
 * whole-visit pass (finalizeVisit). The live per-sentence pass stays on the deterministic rules in extract.ts, so a
 * card still appears within 5 s of a sentence; the model only adds what the rules missed once the full transcript
 * is in (real recordings, where the doctor's words are not the script's).
 *
 * Never cross: the model writes no text. It only points at sentence ids and picks labels:
 *   { "items": [{ "utterance_id", "type", "variant"?, "required_line"? }] }
 * and every label is checked in code before it becomes an item:
 *   - the id must be one of the sentences of this pass, said by a clinician (doctor, counter, pharmacist), or by
 *     him for a "question"; context lines, family and unknown speakers never get items;
 *   - the type must be a card type (consent and answers stay with the rules, which link them to the request or the
 *     question); an instruction variant must be one of the known variants;
 *   - the item's text is always the whole sentence as said, and its time points are that sentence's; every slot
 *     (numbers, medicine, strength, days) is read from the sentence's own words by code, never taken from the model;
 *     a "medication" needs a medicine kb/glossary.json knows by name in that sentence, a "reading" needs the pair of
 *     numbers in it;
 *   - a required line (R1-R4) is accepted only when the sentence is a clinician's, says the same thing as the seeded
 *     line and has its type. "The same thing" is a closed rule, not a list of dangerous words (10-09 DeepSeek fixer,
 *     round 2: an open list let "..., then you may add a tablet", "unless your readings are high", "Otherwise you can
 *     adjust it", a moved "not", "and" for "or" and "until you feel fine" through as the doctor's R line):
 *       word overlap >= REQUIRED_LINE_MIN_OVERLAP; the same number of negations; no POLARITY_WORDS added or dropped;
 *       every number of the seeded line present and no other number; and, after dropping FUNCTION_WORDS (articles,
 *       possessives, a few prepositions, fillers and particles) from both, the remaining words in the same order.
 *     So only function words may differ ("to be below", "by yourself", "the next visit", "your heart", "A and E" for
 *     "A&E"); any other added, dropped, swapped or moved word (and, or, unless, except, otherwise, until, only, then,
 *     may, if, when, even, add, adjust, up, repeat, rest ...) means it is not that line. The rules accept only
 *     identical words.
 *   - a required line found this way is still the transcript's sentence, not the seed's: it reaches /api/ask only after
 *     he has confirmed it in the after-visit review (slots.extracted_by "model"; lib/safety/candidates.ts), like every
 *     other extracted item, while the rules' identical-words R lines keep counting at once.
 * Merging (mergeDrafts): the rules win every collision (same item id, same type on the same sentence, a required
 * line already matched); a model required line replaces the rule items of its sentence, like the rules do.
 * Any model failure (timeout, spend cap, cassette missing, bad JSON) leaves the rules' items as they are.
 *
 * Server-only through lib/kb (JSON) and the model client; pure apart from the one chat call.
 */
import { findDrugMentions } from "@/lib/kb/match";
import { parseModelJson } from "@/lib/llm/json";
import type { LlmClient } from "@/lib/llm/types";
import type { RequiredLineId, UtteranceRole, VisitItemType } from "@/lib/store/types";
import type { ExtractContext, ExtractLine, ItemDraft } from "./extract";
import { isClinician } from "./roles";
import { daysFromNow } from "./text";

/** Card types the model may label. */
export const MODEL_ITEM_TYPES = [
  "reading",
  "instruction",
  "lifestyle",
  "target",
  "threshold",
  "diagnosis",
  "medication",
  "purpose",
  "follow_up",
  "test",
  "question",
] as const satisfies readonly VisitItemType[];
type ModelItemType = (typeof MODEL_ITEM_TYPES)[number];

export const INSTRUCTION_VARIANTS = ["measure_home", "how_to_measure", "dose_rule", "watch", "how_to_take", "missed_dose", "instruction"] as const;
type InstructionVariant = (typeof INSTRUCTION_VARIANTS)[number];

export const REQUIRED_LINE_MIN_OVERLAP = 0.75;

export const EXTRACT_SYSTEM = [
  "You label the sentences of a medical visit transcript for a medication-companion app used by an older patient in Singapore.",
  "You never write, translate or rephrase anything: you only point at sentence ids and choose labels. The app shows each sentence exactly as it was said.",
  'Output JSON only: {"items": [{"utterance_id": "<id>", "type": "<type>", "variant": "<variant or null>", "required_line": "<R1-R4 or null>"}]}.',
  "Types (a sentence may get more than one; small talk gets none):",
  "reading = a clinician states a measurement taken now (for example today's blood pressure);",
  "target = a clinician states the goal for home readings;",
  "threshold = a clinician states a reading or symptoms at which to go to A&E or call 995;",
  "instruction = a clinician tells the patient to do something, with variant measure_home (measure at home), how_to_measure (how to take a reading),",
  "dose_rule (do not change the dose yourself), watch (side effects to look out for and report), how_to_take (how to take a medicine),",
  "missed_dose (what to do after a missed dose) or instruction (anything else);",
  "lifestyle = diet, salt, exercise or walking advice; diagnosis = a clinician tells the patient he has a condition;",
  "medication = a clinician prescribes, starts, continues or changes a named medicine; purpose = why a medicine is taken;",
  "follow_up = when to come back; test = a blood test, urine test or scan to do; question = the patient asks something.",
  "Only label sentences whose role is doctor, dispenser or pharmacist, or the patient's own questions; never label lines marked context.",
  "required_line: when a sentence says the same thing as one of the required lines given (same numbers, same instruction), put that id; otherwise null.",
  "Return an empty list when nothing applies.",
].join(" ");

export interface ModelExtractPayload {
  task: "extract_items";
  visit_kind: string;
  required_lines: { id: RequiredLineId; type: string; text: string }[];
  lines: { id: string; role: UtteranceRole; text: string; context?: true }[];
}

export function extractPayload(lines: ExtractLine[], fromIndex: number, ctx: ExtractContext): ModelExtractPayload {
  return {
    task: "extract_items",
    visit_kind: ctx.visit.kind,
    required_lines: ctx.requiredLines
      .filter((r) => r.required_line)
      .map((r) => ({ id: r.required_line as RequiredLineId, type: r.type, text: r.text }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    lines: lines.map((l, i) => ({ id: l.id, role: l.role, text: l.text, ...(i < fromIndex ? { context: true as const } : {}) })),
  };
}

// ------------------------------------------------------------------ checks on the model's labels

/** Word tokens for the overlap test: Latin words and numbers, and single Han characters. Negative contractions
 * are spelled out ("don't" -> do not, "can't" / "cannot" -> can not, "won't" -> will not), so "don't" and
 * "do not" are the same words and a dropped "n't" is a missing "not". */
export function tokens(s: string): string[] {
  const t = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    // A&E, A and E, accident and emergency: one word, so "and" never has to be ignored
    .replace(/\ba\s*&\s*e\b|\ba\s+and\s+e\b|\baccident\s+(?:and|&)\s+emergency\b/g, " aande ");
  const raw = t.match(/\p{Script=Han}|[\p{L}\p{N}']+/gu) ?? [];
  const out: string[] = [];
  for (const w of raw) {
    if (w === "cannot") out.push("can", "not");
    else if (w === "won't") out.push("will", "not");
    else if (w === "can't") out.push("can", "not");
    else if (w === "shan't") out.push("shall", "not");
    else if (w.endsWith("n't") && w.length > 3) out.push(w.slice(0, -3), "not");
    else out.push(w);
  }
  return out;
}

/** Negation words (English after tokens() spelled out the contractions; Mandarin single characters). */
export const NEGATION_WORDS = new Set(["not", "no", "never", "nothing", "none", "neither", "nor", "without", "dont", "不", "别", "没", "勿", "莫", "未", "甭"]);

/**
 * Words that change what a line asks or says when one is added or dropped: direction and amount, what to do with
 * the medicine, where to go. A required line that differs from the seeded one in any of these is not that line.
 */
export const POLARITY_WORDS = new Set([
  "above", "below", "over", "under", "more", "less", "fewer", "higher", "lower", "high", "low", "increase", "decrease",
  "reduce", "raise", "extra", "double", "half", "another", "additional", "maximum", "minimum",
  "take", "skip", "stop", "start", "change", "miss", "continue", "keep", "avoid", "eat", "drink", "measure", "check",
  "call", "go", "come", "write", "tell", "ignore", "wait",
  "before", "after", "morning", "night", "evening", "daily", "weekly", "twice", "once",
  "多", "少", "加", "减", "停", "吃", "打", "去", "写", "高", "低", "上", "下", "早", "晚", "超",
]);

/**
 * The only words that may be added, dropped or swapped between a transcript and the seeded required line: articles,
 * possessives and pronouns, a few prepositions and forms of "be", fillers and sentence particles. Everything else
 * must be the same words in the same order. Deliberately not here: and, or, unless, except, otherwise, until, only,
 * then, may, can, if, when, even, just, do, not, any verb or number.
 */
export const FUNCTION_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "your", "my", "his", "her", "their", "our", "it", "its", "them",
  "to", "be", "by", "of", "at", "in", "on", "is", "are", "please",
  "um", "uh", "er", "erm", "eh", "ah", "oh", "ok", "okay", "so", "well", "yeah", "lah", "la", "leh", "lor", "hor", "mah",
  "的", "了", "吧", "啊", "呢", "嗯", "哦", "呀", "嘛",
]);

/** The words of a sentence that carry its meaning, in order (tokens() without FUNCTION_WORDS). */
export function contentWords(s: string): string[] {
  return tokens(s).filter((w) => !FUNCTION_WORDS.has(w));
}

/** Dice overlap of the two token bags (1 = same words). */
export function wordOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const bag = new Map<string, number>();
  for (const w of tb) bag.set(w, (bag.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of ta) {
    const n = bag.get(w) ?? 0;
    if (n > 0) {
      common++;
      bag.set(w, n - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

const numbersIn = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? [];

/** Tokens of a that are not in b (as bags: a word said twice in a and once in b leaves one). */
function bagMinus(a: string[], b: string[]): string[] {
  const bag = new Map<string, number>();
  for (const w of b) bag.set(w, (bag.get(w) ?? 0) + 1);
  const out: string[] = [];
  for (const w of a) {
    const n = bag.get(w) ?? 0;
    if (n > 0) bag.set(w, n - 1);
    else out.push(w);
  }
  return out;
}

/** Why a sentence is not the seeded required line, or null when it is (see the header). */
export function requiredLineMismatch(text: string, required: { text: string; slots?: Record<string, unknown> | null }): string | null {
  if (wordOverlap(text, required.text) < REQUIRED_LINE_MIN_OVERLAP) return "low_overlap";
  const said = tokens(text);
  const seeded = tokens(required.text);
  const negations = (ws: string[]) => ws.filter((w) => NEGATION_WORDS.has(w)).length;
  if (negations(said) !== negations(seeded)) return "negation_differs";
  const changed = [...bagMinus(said, seeded), ...bagMinus(seeded, said)];
  if (changed.some((w) => POLARITY_WORDS.has(w))) return "meaning_word_differs";
  const need = new Set([...numbersIn(required.text), ...Object.values(required.slots ?? {}).filter((v) => typeof v === "number").map(String)]);
  const have = new Set(numbersIn(text));
  if (![...need].every((n) => have.has(n))) return "number_missing";
  if (![...have].every((n) => need.has(n))) return "number_added";
  // closed rule: apart from function words, the same words in the same order (a moved "not", "and" for "or",
  // "unless", "then you may add a tablet" ... are all different lines)
  const a = contentWords(text);
  const b = contentWords(required.text);
  if (a.length !== b.length || a.some((w, i) => w !== b[i])) return "content_words_differ";
  return null;
}

/** The sentence says what the seeded required line says (see the header). */
export function matchesRequiredLine(text: string, required: { text: string; slots?: Record<string, unknown> | null }): boolean {
  return requiredLineMismatch(text, required) === null;
}

const PAIR = /(\d{2,3})\s*(?:over|\/|／)\s*(\d{2,3})/i;
const ABOVE = /\babove\s+(\d{2,3})\b|超过\s*(\d{2,3})/i;
const STRENGTH = /(\d+(?:\.\d+)?)\s*(?:mg|milligrams?|毫克)/i;
const KEEP = /\b(?:keep|continue|stay on|same)\b|继续|照旧/i;

/** Slots read from the sentence itself for one label; null = the label does not fit the words (dropped). */
function slotsFor(type: ModelItemType, variant: string, line: ExtractLine, ctx: ExtractContext): Record<string, unknown>[] | null {
  const text = line.text;
  switch (type) {
    case "reading": {
      const m = PAIR.exec(text);
      return m ? [{ variant: "reading", systolic: Number(m[1]), diastolic: Number(m[2]), setting: "clinic" }] : null;
    }
    case "target": {
      const m = PAIR.exec(text);
      return [{ variant: "target", ...(m ? { systolic: Number(m[1]), diastolic: Number(m[2]) } : {}) }];
    }
    case "threshold": {
      const m = ABOVE.exec(text);
      return [{ variant: "threshold", ...(m ? { systolic: Number(m[1] ?? m[2]) } : {}) }];
    }
    case "medication": {
      const mentions = findDrugMentions(text);
      if (!mentions.length) return null;
      return mentions.map((m, k) => {
        const next = mentions[k + 1]?.index ?? text.length;
        const strength = STRENGTH.exec(text.slice(m.index, next));
        const isNew = !KEEP.test(text) && !ctx.priorPrescriptions.includes(m.drugId);
        return { variant: isNew ? "new_med" : "med", drug: m.drugId, ...(strength ? { strength: `${strength[1]} mg` } : {}), is_new: isNew };
      });
    }
    case "instruction": {
      const v = (INSTRUCTION_VARIANTS as readonly string[]).includes(variant) ? (variant as InstructionVariant) : "instruction";
      const drug = v === "how_to_take" ? findDrugMentions(text)[0]?.drugId : undefined;
      return [{ variant: v, ...(drug ? { drug } : {}) }];
    }
    case "follow_up":
    case "test": {
      const when = daysFromNow(text);
      return [
        {
          variant: type,
          ...(type === "test" ? { blood: /\bblood test\b|验血|抽血/i.test(text) } : {}),
          ...(when ? { days: when.days, approx: when.approx, phrase: when.phrase } : {}),
        },
      ];
    }
    case "question":
      return [{ medication: findDrugMentions(text).length > 0 || /\b(?:medicine|tablet|pill)s?\b|药/i.test(text) }];
    default:
      return [{ variant: type }];
  }
}

const idFor = (lineId: string, type: string, slots: Record<string, unknown>): string => {
  if (type === "medication" && typeof slots.drug === "string") return `${lineId}-medication-${slots.drug}`;
  if (type === "instruction" && typeof slots.variant === "string" && slots.variant !== "instruction") return `${lineId}-instruction-${slots.variant}`;
  if (type === "instruction") return `${lineId}-instruction-instruction`;
  return `${lineId}-${type}`;
};

const REQUIRED_VARIANT: Record<string, string> = { target: "target", threshold: "threshold", purpose: "purpose", instruction: "dose_rule" };

export interface ModelLabel {
  utterance_id?: unknown;
  type?: unknown;
  variant?: unknown;
  required_line?: unknown;
}

export interface Rejected {
  label: { utterance_id: string | null; type: string | null };
  reason: string;
}

/** Turn the model's labels into item drafts, dropping every label the sentence's own words do not support. */
export function draftsFromLabels(labels: unknown, lines: ExtractLine[], fromIndex: number, ctx: ExtractContext): { drafts: ItemDraft[]; rejected: Rejected[] } {
  const drafts: ItemDraft[] = [];
  const rejected: Rejected[] = [];
  if (!Array.isArray(labels)) return { drafts, rejected: [{ label: { utterance_id: null, type: null }, reason: "no_items_array" }] };
  const inPass = new Map(lines.slice(Math.max(0, fromIndex)).map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const raw of labels.slice(0, 200) as ModelLabel[]) {
    const uid = typeof raw?.utterance_id === "string" ? raw.utterance_id : null;
    const type = typeof raw?.type === "string" ? raw.type : null;
    const reject = (reason: string) => rejected.push({ label: { utterance_id: uid, type }, reason });
    const line = uid ? inPass.get(uid) : undefined;
    if (!line) {
      reject(uid && lines.some((l) => l.id === uid) ? "context_line" : "unknown_utterance");
      continue;
    }
    if (!type || !(MODEL_ITEM_TYPES as readonly string[]).includes(type)) {
      reject("unknown_type");
      continue;
    }
    const t = type as ModelItemType;
    if (t === "question" ? line.role !== "patient" : !isClinician(line.role)) {
      reject("wrong_speaker");
      continue;
    }
    const variant = typeof raw.variant === "string" ? raw.variant : "";

    // a required line: only when the words really are that line's
    const reqId = typeof raw.required_line === "string" && /^R[1-4]$/.test(raw.required_line) ? (raw.required_line as RequiredLineId) : null;
    if (reqId) {
      const req = ctx.requiredLines.find((r) => r.required_line === reqId);
      if (!req || req.type !== t || !matchesRequiredLine(line.text, req)) {
        reject("required_line_mismatch");
        // fall through: the label may still be a plain item of this type
      } else {
        const id = req.visit_id === ctx.visit.id ? req.id : `${line.id}-${reqId}`;
        if (!seen.has(id)) {
          seen.add(id);
          drafts.push({
            id,
            type: req.type,
            text: line.text,
            utterance_ids: [line.id],
            slots: { ...(req.slots ?? {}), variant: REQUIRED_VARIANT[req.type] ?? "instruction", extracted_by: "model" },
            required_line: reqId,
            speaker: req.speaker ?? "doctor",
          });
        }
        continue;
      }
    }

    // every slot comes from the sentence's own words; a label they do not support is dropped
    const slotsList = slotsFor(t, variant, line, ctx);
    if (!slotsList) {
      reject(t === "medication" ? "no_known_medicine_in_sentence" : "numbers_not_in_sentence");
      continue;
    }
    for (const slots of slotsList) {
      const id = idFor(line.id, t, slots);
      if (seen.has(id)) continue;
      seen.add(id);
      drafts.push({
        id,
        type: t,
        text: line.text,
        utterance_ids: [line.id],
        slots: { ...slots, extracted_by: "model" },
        required_line: null,
        speaker: line.role,
      });
    }
  }
  return { drafts, rejected };
}

/** Rules first; model drafts only where they add something (see the header). */
export function mergeDrafts(rules: ItemDraft[], model: ItemDraft[]): { drafts: ItemDraft[]; added: ItemDraft[] } {
  let out = [...rules];
  const added: ItemDraft[] = [];
  const ruleRequired = new Set(rules.filter((d) => d.required_line).map((d) => d.required_line));
  for (const m of model) {
    const line = m.utterance_ids[0];
    const onLine = out.filter((d) => d.utterance_ids.includes(line));
    if (m.required_line) {
      if (ruleRequired.has(m.required_line) || onLine.some((d) => d.required_line)) continue;
      // a required line is the only item of its sentence (as in the rules)
      out = out.filter((d) => !d.utterance_ids.includes(line) || d.type === "consent");
      out.push(m);
      added.push(m);
      ruleRequired.add(m.required_line);
      continue;
    }
    if (onLine.some((d) => d.required_line || d.id === m.id || d.type === m.type)) continue;
    // consent and answer sentences belong to the rules
    if (onLine.some((d) => d.type === "consent" || d.type === "answer")) continue;
    out.push(m);
    added.push(m);
  }
  return { drafts: out, added };
}

export interface ModelExtractResult {
  drafts: ItemDraft[];
  rejected: Rejected[];
  tokens: number;
  provider: string;
  model: string;
  error: string | null;
  latencyMs: number;
}

/** Ask the model for labels and check them. Never throws: a failure is `error` with no drafts. */
export async function extractWithModel(
  llm: LlmClient,
  lines: ExtractLine[],
  fromIndex: number,
  ctx: ExtractContext,
  opts: { timeoutMs?: number } = {},
): Promise<ModelExtractResult> {
  const t0 = Date.now();
  const base = { provider: llm.provider, model: llm.model };
  const labelable = lines.slice(Math.max(0, fromIndex)).some((l) => isClinician(l.role) || l.role === "patient");
  if (!labelable) return { ...base, drafts: [], rejected: [], tokens: 0, error: null, latencyMs: 0 };
  let content: string;
  let tokens = 0;
  try {
    const res = await llm.chat({
      system: EXTRACT_SYSTEM,
      user: JSON.stringify(extractPayload(lines, fromIndex, ctx)),
      json: true,
      temperature: 0,
      maxTokens: 1500,
      timeoutMs: opts.timeoutMs,
      purpose: "extract",
    });
    content = res.content;
    tokens = res.tokens;
  } catch (e) {
    return { ...base, drafts: [], rejected: [], tokens, error: `model_failed: ${(e as Error).message.slice(0, 160)}`, latencyMs: Date.now() - t0 };
  }
  let parsed: unknown;
  try {
    parsed = parseModelJson(content);
  } catch {
    return { ...base, drafts: [], rejected: [], tokens, error: "bad_json", latencyMs: Date.now() - t0 };
  }
  const items = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown } | null)?.items;
  const { drafts, rejected } = draftsFromLabels(items, lines, fromIndex, ctx);
  return { ...base, drafts, rejected, tokens, error: Array.isArray(items) ? null : "bad_shape", latencyMs: Date.now() - t0 };
}
