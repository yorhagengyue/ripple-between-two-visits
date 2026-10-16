/**
 * Mock item extraction (deterministic heuristics; LLM_PROVIDER=mock/stub). Input: the visit's lines in
 * order with their inferred roles, the session's required doctor lines (R1-R4, matched sentence by sentence with
 * text.ts sameSentence: case, spacing, quote style and a final full stop may differ, nothing else), and
 * kb/glossary.json (drug names and units, through lib/kb and lib/safety/slots). Output: visit_item drafts
 * (spec section 3 types) whose `text` is always the whole sentence as said. Nothing here writes clinical
 * text of its own.
 *
 * `fromIndex`: only lines from that index get items; earlier lines are context (the previous chunk's last
 * lines, so a question and its answer, or a consent request and the yes, can sit in different chunks).
 *
 * Item ids are deterministic (`<utterance>-<type>`, `<utterance>-medication-<drug>`), so a replay or the
 * whole-visit pass after the visit overwrites instead of duplicating. A required line said in its own
 * visit reuses the seeded row id (item-R1 ...), which fills in its utterance_ids.
 *
 * Pure; server and client safe apart from lib/kb (JSON).
 */
import { findDrugMentions } from "@/lib/kb/match";
import type { RequiredLineId, UtteranceRole, VisitItemRow, VisitItemType } from "@/lib/store/types";
import { isMedicationText } from "./medication";
import { isClinician } from "./roles";
import {
  anyMatch,
  daysFromNow,
  hasHan,
  isAffirmative,
  isConsentRequest,
  followUpIndex,
  isFollowUpCue,
  isTeachBack,
  looksLikeQuestion,
  sameSentence,
} from "./text";
import type { DocVariant } from "./types";

export interface ExtractLine {
  id: string;
  text: string;
  role: UtteranceRole;
  t_start_ms: number;
  t_end_ms: number;
}

export interface ExtractContext {
  visit: { id: string; day: number; kind: string };
  /** the session's required doctor lines (visit_item rows with required_line) */
  requiredLines: Pick<VisitItemRow, "id" | "visit_id" | "type" | "text" | "required_line" | "slots" | "speaker">[];
  /** drug ids of prescriptions he was already taking before this visit */
  priorPrescriptions: string[];
}

export interface ItemDraft {
  id: string;
  type: VisitItemType;
  text: string;
  utterance_ids: string[];
  slots: Record<string, unknown>;
  required_line: RequiredLineId | null;
  speaker: UtteranceRole | null;
}

const REQUIRED_VARIANT: Record<string, DocVariant> = {
  target: "target",
  threshold: "threshold",
  purpose: "purpose",
  instruction: "dose_rule",
};

const RE = {
  readingPair: /(\d{2,3})\s*(?:over|\/|／)\s*(\d{2,3})/i,
  readingNow: /\btoday\b|\bnow\b|\bi took it\b|\bjust now\b|今天|刚才|现在/i,
  comparative: /\b(?:below|under|above|less than|more than|over \d{3} on top)\b|以下|以上|超过/i,
  target: [/\b(?:below|under|less than)\s+(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i, /(\d{2,3})\s*[\/／]\s*(\d{2,3})\s*以下/],
  thresholdAbove: /\babove\s+(\d{2,3})\b|超过\s*(\d{2,3})/i,
  thresholdWhere: /\bA&E\b|\b995\b|\bemergency\b|急诊|救护车/i,
  measureHome: [/\bmeasure\b[^.]*\bat home\b/i, /\bat home\b[^.]*\bmeasure\b/i, /\bkeep measuring\b/i, /在家量|继续量/],
  howToMeasure: [
    /\bsit down\b/i,
    /\brest (?:five|5) minutes\b/i,
    /\barm on the table\b/i,
    /\blevel of your heart\b/i,
    /\btwo readings\b/i,
    /\bno coffee\b/i,
    /\bwrite down the average\b/i,
    /坐下|休息五分钟|手放在桌上|和心脏一样高/,
  ],
  lifestyle: [/\bsalt\b|\bgravy\b|\bsoup\b|\bwalks?\b|\bexercise\b|\bdiet\b/i, /少盐|少吃咸|运动|散步/],
  diagnosis: [/\byour blood pressure is high\b|\byou have (?:high blood pressure|hypertension|diabetes)\b|\bthese confirm it\b/i, /你有高血压|确定是高血压/],
  doseContext: /\d|\bmilligrams?\b|\bmg\b|\btablets?\b|\bstart\b|\badd\b|\bkeep\b|\bprescribe\b|\bcontinue\b|粒|毫克|片/i,
  keep: /\b(?:keep|continue|stay on|same)\b|继续|照旧/i,
  purpose: [/\bthis (?:tablet|medicine|pill) (?:works|is for|helps|protects)\b|\bso you take it\b/i, /是用来|这个药是治/],
  watch: [/\bif you notice\b|\bside effects?\b|\bwatch (?:out )?for\b/i, /副作用|如果发现/],
  doseRule: [/\bdon'?t change the dose\b|\bdo not change the dose\b/i, /不要自己(?:加|减|改)/],
  missedDose: [/忘了吃|忘记吃|想起来就吃/, /\bif you (?:forget|miss)\b|\bmissed dose\b/i],
  test: [/\bblood test\b|\burine test\b|\bx-?ray\b|\bscan\b|\bECG\b/i, /验血|抽血|验尿|检查肾/],
  general: [/\b(?:i want you to|you need to|you should|please|make sure|remember to|bring)\b/i, /记得|一定要|要记住/],
  ask: /\bi want to ask\b|我想问/i,
};

function strengthAfter(text: string, from: number, to: number): string | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(?:mg|milligrams?|毫克)/i.exec(text.slice(from, to));
  return m ? `${m[1]} mg` : undefined;
}

/** The clause around a position (split at commas, semicolons and "and"). */
function clauseAt(text: string, index: number): string {
  const parts = text.split(/(?<=[,，;；])|\band\b/i);
  let pos = 0;
  for (const p of parts) {
    if (index >= pos && index < pos + p.length) return p;
    pos += p.length;
  }
  return text;
}

function isPatientAsk(line: ExtractLine): boolean {
  if (line.role !== "patient") return false;
  if (isTeachBack(line.text)) return false;
  return looksLikeQuestion(line.text) || RE.ask.test(line.text);
}

/** A consent "yes": a short affirmative right after someone asked to record. */
function isConsentGiven(lines: ExtractLine[], i: number): boolean {
  const prev = lines[i - 1];
  return !!prev && isConsentRequest(prev.text) && prev.role !== lines[i].role && isAffirmative(lines[i].text);
}

/** The patient's question this clinician line answers: the line just before it, or two before when the line in between was only the consent yes. */
export function answeredQuestion(lines: ExtractLine[], i: number): ExtractLine | null {
  for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
    const l = lines[j];
    if (isPatientAsk(l)) {
      if (j === i - 1) return isConsentRequest(l.text) ? null : l;
      // two back: "Can I record? I want to ask about this medicine." / "Sure." / <answer>
      return isConsentGiven(lines, j + 1) && RE.ask.test(l.text) ? l : null;
    }
    if (j === i - 1 && isConsentGiven(lines, j)) continue;
    return null;
  }
  return null;
}

export function extractItems(lines: ExtractLine[], fromIndex: number, ctx: ExtractContext): ItemDraft[] {
  const out: ItemDraft[] = [];
  for (let i = Math.max(0, fromIndex); i < lines.length; i++) {
    const u = lines[i];
    const prev = lines[i - 1];
    const push = (type: VisitItemType, slots: Record<string, unknown> = {}, idSuffix?: string) => {
      out.push({
        id: `${u.id}-${type}${idSuffix ? `-${idSuffix}` : ""}`,
        type,
        text: u.text,
        utterance_ids: [u.id],
        slots,
        required_line: null,
        speaker: u.role,
      });
    };

    // 1. the session's required doctor lines, the same sentences (punctuation inside a sentence counts: text.ts sameSentence)
    const req = ctx.requiredLines.find((r) => r.required_line && sameSentence(r.text, u.text));
    if (req) {
      out.push({
        id: req.visit_id === ctx.visit.id ? req.id : `${u.id}-${req.required_line}`,
        type: req.type,
        text: u.text,
        utterance_ids: [u.id],
        slots: { ...(req.slots ?? {}), variant: REQUIRED_VARIANT[req.type] ?? "instruction" },
        required_line: req.required_line,
        speaker: req.speaker ?? "doctor",
      });
      continue;
    }

    // 2. consent: the request, and the other person's yes
    if (isConsentRequest(u.text)) {
      push("consent", { variant: "request" });
      continue;
    }
    if (isConsentGiven(lines, i)) {
      push("consent", { variant: "given", request_utterance_id: prev!.id });
      continue;
    }

    // 3. teach-back confirmed by the counter
    if (prev && prev.role === "patient" && isTeachBack(prev.text) && isClinician(u.role) && isAffirmative(u.text)) {
      push("answer", { teach_back: true, question_utterance_id: prev.id });
      continue;
    }

    // 4. his own lines: questions only (check cards are built from his records, not stored as items)
    if (u.role === "patient") {
      if (looksLikeQuestion(u.text) && !isTeachBack(u.text)) {
        push("question", { medication: isMedicationText(u.text) });
      }
      continue;
    }
    if (!isClinician(u.role)) continue;

    // 5. an answer to the question he just asked
    const q = answeredQuestion(lines, i);
    if (q) {
      push("answer", { question_utterance_id: q.id });
      continue;
    }

    // 6. clinician rules (a line can carry more than one)
    const before = out.length;
    const isQuestionLine = looksLikeQuestion(u.text);
    const pair = RE.readingPair.exec(u.text);
    if (pair && RE.readingNow.test(u.text) && !RE.comparative.test(u.text)) {
      push("reading", { variant: "reading", systolic: Number(pair[1]), diastolic: Number(pair[2]), setting: "clinic" });
    }
    const target = RE.target.map((re) => re.exec(u.text)).find(Boolean);
    if (target) push("target", { variant: "target", systolic: Number(target[1]), diastolic: Number(target[2]) });
    const above = RE.thresholdAbove.exec(u.text);
    if (above && RE.thresholdWhere.test(u.text)) push("threshold", { variant: "threshold", systolic: Number(above[1] ?? above[2]) });

    const howToMeasure = RE.howToMeasure.filter((re) => re.test(u.text)).length >= 2;
    if (howToMeasure) push("instruction", { variant: "how_to_measure" }, "how_to_measure");
    else if (anyMatch(RE.measureHome, u.text) && !isQuestionLine) push("instruction", { variant: "measure_home" }, "measure_home");
    if (!howToMeasure && anyMatch(RE.lifestyle, u.text) && !isQuestionLine) push("lifestyle", { variant: "lifestyle" });
    if (anyMatch(RE.diagnosis, u.text)) push("diagnosis", { variant: "diagnosis" });

    const mentions = findDrugMentions(u.text);
    if (mentions.length && RE.doseContext.test(u.text) && !isQuestionLine) {
      if (u.role === "doctor") {
        mentions.forEach((m, k) => {
          const next = mentions[k + 1]?.index ?? u.text.length;
          const clause = clauseAt(u.text, m.index);
          const isNew = !RE.keep.test(clause) && !ctx.priorPrescriptions.includes(m.drugId);
          push(
            "medication",
            { variant: isNew ? "new_med" : "med", drug: m.drugId, strength: strengthAfter(u.text, m.index, next), is_new: isNew },
            m.drugId,
          );
        });
      } else {
        push("instruction", { variant: "how_to_take", drug: mentions[0].drugId }, "how_to_take");
      }
    }
    if (anyMatch(RE.purpose, u.text)) push("purpose", { variant: "purpose" });
    if (anyMatch(RE.watch, u.text) && !isQuestionLine) push("instruction", { variant: "watch" }, "watch");
    if (anyMatch(RE.doseRule, u.text)) push("instruction", { variant: "dose_rule" }, "dose_rule");
    if (anyMatch(RE.missedDose, u.text) && !isQuestionLine) push("instruction", { variant: "missed_dose" }, "missed_dose");
    // "Do a blood test ... in two weeks, and come back ... in six weeks": each date from its own words
    const cue = followUpIndex(u.text);
    if (isFollowUpCue(u.text) && !isQuestionLine) {
      const when = daysFromNow(u.text.slice(Math.max(0, cue)));
      push("follow_up", { variant: "follow_up", ...(when ? { days: when.days, approx: when.approx, phrase: when.phrase } : {}) });
    }
    const testAt = RE.test.map((re) => re.exec(u.text)?.index ?? -1).filter((i) => i >= 0);
    if (testAt.length && !isQuestionLine) {
      const from = Math.min(...testAt);
      const when = daysFromNow(u.text.slice(from, cue > from ? cue : undefined));
      push("test", {
        variant: "test",
        blood: /\bblood test\b|验血|抽血/i.test(u.text),
        ...(when ? { days: when.days, approx: when.approx, phrase: when.phrase } : {}),
      });
    }
    if (out.length === before && !isQuestionLine && anyMatch(RE.general, u.text)) {
      push("instruction", { variant: "instruction" }, "instruction");
    }
    // Mandarin instructions from the counter that name no drug ("每天早上一粒" is caught above)
    if (out.length === before && hasHan(u.text) && u.role === "dispenser" && isMedicationText(u.text) && !isQuestionLine) {
      push("instruction", { variant: "how_to_take" }, "how_to_take");
    }
  }
  return out;
}

/** Which doc-card variant an item shows as. */
export function variantOf(item: Pick<ItemDraft, "type" | "slots">): DocVariant {
  const v = item.slots?.variant;
  if (typeof v === "string") return v as DocVariant;
  if (item.type === "medication") return "med";
  return (["reading", "lifestyle", "target", "threshold", "diagnosis", "purpose", "follow_up", "test"] as const).includes(
    item.type as never,
  )
    ? (item.type as DocVariant)
    : "instruction";
}

/** Item types that make a blue doctor's-note card. */
export const DOC_CARD_TYPES: VisitItemType[] = [
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
];
