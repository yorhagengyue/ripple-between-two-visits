/**
 * The "Before you go" question list (v3 design): when the doctor invites questions ("anything else?") or
 * closes with the next visit, or the talk pauses, or the visit ends, Ripple shows the questions worth
 * asking. Ripple asks; it never answers. An answer is the clinician's next sentence, kept word for word.
 *
 * Where the questions come from:
 *   - his own question list (store `question` rows): asked at this visit, or still open from before it;
 *   - "Ripple noticed" questions about something that happened in this visit: a new medicine while he
 *     already takes one, a blood test, or "measure at home" before any doctor's number exists. Their wording
 *     is fixed below (questions only, no statements), in both languages.
 *
 * Matching what he asks to a list item is by shared concepts (glossary drug ids plus a few bilingual
 * keywords), deterministic. Pure apart from lib/kb (JSON).
 */
import { getDrug } from "@/lib/kb/load";
import { mentionedDrugIds } from "@/lib/kb/match";
import type { QuestionRow, UtteranceRole, VisitItemRow, VisitRow } from "@/lib/store/types";
import { isMedicationText } from "./medication";
import { isClinician } from "./roles";
import { isConsentRequest, isFollowUpCue, isQuestionInvite, isTeachBack, looksLikeQuestion } from "./text";
import type { QItemWhy } from "./types";

/** Ripple's own question wordings. Questions only; each one is put to the clinician, never answered by Ripple. */
export const RIPPLE_QUESTIONS = {
  target: { en: "What number counts as normal for me?", zh: "我多少算正常？" },
  newMed: { en: "Can I take {new} and {current} together?", zh: "{new} 和 {current} 可以一起吃吗？" },
  bloodTest: { en: "For the blood test, do I need to fast?", zh: "验血要空腹吗？" },
} as const;

const CONCEPTS: Record<string, RegExp[]> = {
  together: [/\btogether\b|\bsame time\b/i, /一起|同时/],
  fast: [/\bfast(?:ing)?\b|\bskip breakfast\b|\bempty stomach\b/i, /空腹|禁食|不吃早餐/],
  blood_test: [/\bblood test\b/i, /验血|抽血/],
  tai_chi: [/\btai ?chi\b/i, /太极/],
  knee: [/\bknees?\b/i, /膝盖/],
  painkiller: [/\bpain ?killers?\b/i, /止痛/],
  machine: [/\bmachine\b|\bmonitor\b|\bwrist\b|\bcuff\b/i, /机器|手腕|血压计/],
  extra: [/\bextra\b|\bone more\b|\banother tablet\b/i, /多吃|多一粒|加一粒/],
  normal: [/\bnormal\b|\btarget\b/i, /正常|多少算/],
  forget: [/\bforg[eo]t\b|\bmiss(?:ed)?\b/i, /忘记|忘了|漏/],
  relative: [/\brelatives?\b|\bfrom china\b/i, /亲戚|中国带/],
};

export function concepts(text: string): Set<string> {
  const out = new Set<string>();
  for (const [name, res] of Object.entries(CONCEPTS)) if (res.some((re) => re.test(text))) out.add(name);
  for (const id of mentionedDrugIds(text)) out.add(`drug:${id}`);
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export interface QLine {
  id: string;
  text: string;
  role: UtteranceRole;
  t_start_ms: number;
  t_end_ms: number;
}

export interface QDraft {
  id: string;
  why: QItemWhy;
  text: { own?: string; en?: string; zh?: string };
  createdDay: number | null;
  questionId: string | null;
  askedBy: string | null;
  answerBy: string | null;
  autoAnswerBy: string | null;
  medication: boolean;
  /** extra facts for writing the question row on confirm */
  drug?: string;
}

export interface QListDraft {
  anchor: string;
  items: QDraft[];
  /** line id -> list item id, for lines shown under a question */
  lineToItem: Map<string, string>;
}

export interface QuestionListInput {
  visit: Pick<VisitRow, "id" | "day" | "kind">;
  lines: QLine[];
  /** this visit's live items */
  items: VisitItemRow[];
  /** the session's question rows */
  questions: QuestionRow[];
  /** the session's required lines (R1-R4) and the visits, to tell whether R1 already exists */
  requiredLines: VisitItemRow[];
  visits: Pick<VisitRow, "id" | "day">[];
  /** drug ids of prescriptions he already takes */
  priorPrescriptions: string[];
  /** the visit is over (or the replay ended): the list shows even without a closing line */
  ended: boolean;
  /**
   * An account's clinic visit (C2): the brief's three questions as of the moment it started (lib/visit/account-check.ts).
   * These are listed even when he wrote them that morning, as the brief lists them.
   */
  listedBefore?: ReadonlySet<string>;
}

const PAUSE_MS = 8000;

/** Index of the line the question list follows, or -1 when it does not show yet. */
export function questionListAnchor(lines: QLine[], ended: boolean): number {
  const invite = lines.findIndex((l) => isClinician(l.role) && isQuestionInvite(l.text));
  if (invite >= 0) return invite;
  const closing = lines.findIndex((l) => isClinician(l.role) && isFollowUpCue(l.text) && !looksLikeQuestion(l.text));
  if (closing >= 0) return closing;
  for (let i = 0; i + 1 < lines.length; i++) if (lines[i + 1].t_start_ms - lines[i].t_end_ms >= PAUSE_MS) return i;
  return ended && lines.length > 0 ? lines.length - 1 : -1;
}

const ORIGIN_ORDER: QItemWhy[] = [
  "ripple_target",
  "ripple_new_med",
  "ripple_test",
  "pattern",
  "own",
  "before_you_go",
  "unidentified_medicine",
  "understanding_check",
  "refused_question",
];

function drugName(id: string): string {
  return getDrug(id)?.display_name ?? id;
}

function isPatientQuestion(l: QLine): boolean {
  return l.role === "patient" && looksLikeQuestion(l.text) && !isTeachBack(l.text) && !isConsentRequest(l.text);
}

export function buildQuestionList(input: QuestionListInput): QListDraft | null {
  const { visit, lines, items } = input;
  const anchorIndex = questionListAnchor(lines, input.ended);
  if (anchorIndex < 0) return null;

  const drafts: QDraft[] = [];
  const base = { askedBy: null, answerBy: null, autoAnswerBy: null, createdDay: visit.day, questionId: null as string | null };
  const visitDay = new Map(input.visits.map((v) => [v.id, v.day]));

  // Ripple noticed: "measure at home" with no doctor's number yet
  const measureHome = items.some((it) => it.slots?.variant === "measure_home");
  const earlierTarget = input.requiredLines.some(
    (r) => r.type === "target" && r.visit_id !== visit.id && (visitDay.get(r.visit_id) ?? Infinity) < visit.day,
  );
  if (measureHome && !earlierTarget) {
    const target = items.find((it) => it.type === "target");
    drafts.push({
      ...base,
      id: `rq-${visit.id}-target`,
      why: "ripple_target",
      text: { ...RIPPLE_QUESTIONS.target },
      autoAnswerBy: target?.utterance_ids[0] ?? null,
      medication: false,
    });
  }
  // Ripple noticed: a new medicine while he already takes one
  for (const it of items) {
    if (it.type !== "medication" || it.slots?.is_new !== true || typeof it.slots?.drug !== "string") continue;
    const current = input.priorPrescriptions.find((d) => d !== it.slots.drug);
    if (!current) continue;
    const vars = { new: drugName(it.slots.drug as string), current: drugName(current) };
    drafts.push({
      ...base,
      id: `rq-${visit.id}-newmed-${it.slots.drug}`,
      why: "ripple_new_med",
      text: {
        en: RIPPLE_QUESTIONS.newMed.en.replace("{new}", vars.new).replace("{current}", vars.current),
        zh: RIPPLE_QUESTIONS.newMed.zh.replace("{new}", vars.new).replace("{current}", vars.current),
      },
      medication: true,
      drug: it.slots.drug as string,
    });
  }
  // Ripple noticed: a blood test today
  if (items.some((it) => it.type === "test" && it.slots?.blood === true)) {
    drafts.push({ ...base, id: `rq-${visit.id}-test`, why: "ripple_test", text: { ...RIPPLE_QUESTIONS.bloodTest }, medication: false });
  }

  // his question list
  const audience = visit.kind === "pharmacy" ? "pharmacist" : "doctor";
  const rippleIds = new Set(drafts.map((d) => d.id));
  for (const q of input.questions) {
    if (rippleIds.has(q.id)) {
      const d = drafts.find((x) => x.id === q.id)!;
      d.questionId = q.id;
      continue;
    }
    const here = q.asked_at_visit_id === visit.id || q.answer_visit_id === visit.id;
    const openBefore = q.status === "open" && q.for === audience && (input.listedBefore?.has(q.id) || q.created_day === null || q.created_day < visit.day);
    if (!here && !openBefore) continue;
    drafts.push({
      ...base,
      id: `q-${q.id}`,
      why: q.origin,
      text: { own: q.text },
      createdDay: q.created_day,
      questionId: q.id,
      medication: ["pattern", "refused_question", "unidentified_medicine"].includes(q.origin) || isMedicationText(q.text),
    });
  }
  drafts.sort((a, b) => {
    const oa = ORIGIN_ORDER.indexOf(a.why);
    const ob = ORIGIN_ORDER.indexOf(b.why);
    if (oa !== ob) return oa - ob;
    return (a.createdDay ?? 0) - (b.createdDay ?? 0);
  });
  if (drafts.length === 0) return null;

  // what he asked after the list showed, and the answer that followed
  const lineToItem = new Map<string, string>();
  const textOf = (d: QDraft) => [d.text.own, d.text.en, d.text.zh].filter(Boolean).join(" \n ");
  for (let i = anchorIndex + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!isPatientQuestion(l)) continue;
    const asked = concepts(l.text);
    let best: QDraft | null = null;
    let bestScore = 0;
    for (const d of drafts) {
      if (d.askedBy || d.autoAnswerBy) continue;
      const score = overlap(asked, concepts(textOf(d)));
      if (score > bestScore) {
        best = d;
        bestScore = score;
      }
    }
    if (!best) continue;
    best.askedBy = l.id;
    lineToItem.set(l.id, best.id);
    const next = lines[i + 1];
    if (next && isClinician(next.role)) {
      best.answerBy = next.id;
      lineToItem.set(next.id, best.id);
      if (isMedicationText(next.text)) best.medication = true;
    }
  }
  return { anchor: lines[anchorIndex].id, items: drafts, lineToItem };
}
