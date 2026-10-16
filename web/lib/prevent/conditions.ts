/**
 * What is known about him that decides which prevention lines and diet lines apply (journeys 11, 13; M10 steps 1 and 4;
 * M16). Server-only. Recorded, never inferred:
 *
 *   age          the age fact in his profile (track C; he confirmed it): data.years, or the number he typed
 *   conditions   from three places, each kept with where it came from:
 *                  his profile        a condition fact he wrote or confirmed (高血压 / High blood pressure ...)
 *                  a visit item       a diagnosis item made at a visit that happened, not marked off in his review
 *                  the doctor's words a line he confirmed the doctor said that states the diagnosis in so many words
 *                                     ("Your blood pressure is high.", "You have diabetes.") — the example account
 *                                     has no diagnosis items, only the confirmed transcript (v2-u04)
 *                Never from a medicine on his list, never from a reading: that would be Ripple deciding.
 */
import { confirmedClinicianLines, type SaidLine } from "@/lib/chat/said";
import type { SessionRow, Store, VisitItemRow } from "@/lib/store/types";
import { happenedVisits } from "@/lib/visit/happened";

export type ConditionId = "hypertension" | "diabetes" | "high_cholesterol" | "heart_disease" | "kidney_disease" | "lung_disease" | "stroke";

interface ConditionWords {
  id: ConditionId;
  /** in his own words or a diagnosis item's text */
  words: RegExp;
  /** a doctor's line that states it (only the three the doctor says this way in the story's clinic) */
  doctor?: readonly RegExp[];
}

export const CONDITION_WORDS: readonly ConditionWords[] = [
  {
    id: "hypertension",
    words: /高血压|血压高|high blood pressure|hypertension/i,
    doctor: [/\byour blood pressure is (?:high|too high)\b/i, /\byou have (?:high blood pressure|hypertension)\b/i, /你有高血压|你是高血压/],
  },
  {
    id: "diabetes",
    words: /糖尿病|diabetes/i,
    doctor: [/\byou have (?:type [12] )?diabetes\b/i, /\byour (?:blood )?sugar is (?:high|too high)\b/i, /你有糖尿病/],
  },
  {
    id: "high_cholesterol",
    words: /高胆固醇|胆固醇高|high cholesterol|high blood cholesterol|hyperlipid/i,
    doctor: [/\byour cholesterol is (?:high|too high)\b/i, /\byou have high (?:blood )?cholesterol\b/i, /你的胆固醇(?:太)?高/],
  },
  { id: "heart_disease", words: /心脏病|心衰|心力衰竭|heart disease|heart failure/i },
  { id: "kidney_disease", words: /肾病|肾脏病|肾衰|kidney disease|kidney failure/i },
  { id: "lung_disease", words: /哮喘|慢阻肺|肺病|asthma|COPD|lung disease/i },
  { id: "stroke", words: /中风|stroke/i },
];

export interface KnownCondition {
  id: ConditionId;
  from: "profile" | "visit";
  /** his fact's words, or the doctor's line word for word */
  text: string;
  /** the doctor's line, when it came from a visit */
  line: SaidLine | null;
}

export interface KnownAboutHim {
  age: number | null;
  conditions: KnownCondition[];
}

const shownFact = (f: { confirmed_by: string | null; hidden: boolean | null }) => f.confirmed_by !== null && f.hidden !== true;
const markedOff = (it: VisitItemRow) => it.slots?.superseded === true || it.slots?.rejected === true || it.slots?.disputed === true;

export function conditionsIn(text: string): ConditionId[] {
  return CONDITION_WORDS.filter((c) => c.words.test(text)).map((c) => c.id);
}

export async function knownAboutHim(store: Store, scope: SessionRow): Promise<KnownAboutHim> {
  const [facts, items, lines, visits] = await Promise.all([
    store.listProfileFacts(scope.id),
    store.listVisitItems(scope.id, { type: "diagnosis" }),
    confirmedClinicianLines(store, scope, { roles: ["doctor"] }),
    happenedVisits(store, scope.id),
  ]);
  const shown = facts.filter(shownFact);
  const ageFact = shown.filter((f) => f.kind === "age").at(-1);
  const years = (ageFact?.data as { years?: unknown } | null)?.years;
  const age = typeof years === "number" && Number.isFinite(years) ? years : ageFact && /^\d{1,3}$/.test(ageFact.text.trim()) ? Number(ageFact.text.trim()) : null;

  const out: KnownCondition[] = [];
  const add = (c: KnownCondition) => {
    if (!out.some((x) => x.id === c.id)) out.push(c);
  };
  for (const f of shown.filter((x) => x.kind === "condition")) for (const id of conditionsIn(f.text)) add({ id, from: "profile", text: f.text, line: null });
  const happened = new Set(visits.filter((v) => v.day <= scope.story_day).map((v) => v.id));
  for (const it of items) {
    if (!happened.has(it.visit_id) || markedOff(it)) continue;
    const line = lines.find((l) => it.utterance_ids?.includes(l.utteranceId)) ?? null;
    for (const id of conditionsIn(`${it.text} ${line?.text ?? ""}`)) add({ id, from: "visit", text: line?.text ?? it.text, line });
  }
  for (const line of lines) {
    for (const c of CONDITION_WORDS) if (c.doctor?.some((re) => re.test(line.text))) add({ id: c.id, from: "visit", text: line.text, line });
  }
  return { age, conditions: out };
}

export const hasCondition = (k: Pick<KnownAboutHim, "conditions">, ...ids: ConditionId[]) => k.conditions.some((c) => ids.includes(c.id));
