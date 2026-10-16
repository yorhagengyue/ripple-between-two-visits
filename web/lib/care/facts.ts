/**
 * What she adds to his details (C2 track D, round two; real-app 3.10 「补档案：她写的事实是 source = family、confirmed_by =
 * null。他点『对』之前，不进任何引用来源；他点『对』以后，她的 /f 出现『爸爸确认了』」, 2.5 建档, M11). Server-only.
 *
 * She proposes through her active link (POST /api/profile/facts?link=, track C's route; family mode's one fact write,
 * lib/subject/scoped-store.ts factProposed); he answers 对 / 改一下 / 不对 on his own phone (track C's profile screens).
 * This module is her side of it:
 *
 *   HER_FACT_KINDS            the kinds her screen offers and the route accepts from her: what the design's 建档 asks a
 *                             family member (the condition a doctor named, an allergy, his usual clinic, when he has
 *                             breakfast) and a free line. His name, age, home and language are his own to state.
 *   familyFactProblem(input)  why a proposal of hers is refused, or null. Her words go on his phone as 「Wei Ling 写了：
 *                             ……对吗？」, so a dose or a reading never passes (the app relays those only as a clinician's
 *                             or a label's own words); a routine must be a well-formed breakfast time whose words are
 *                             exactly that time's (「早饭 · 早上 7:30」), because his 「对」 puts the entry into the settings
 *                             his reminders run on: what he reads is what gets set; nothing else may carry data.
 *   breakfastProposal(time)   the routine fact for 「早饭一般几点」, built exactly as his own onboarding builds it
 *   herFacts(store, scope, linkId)   what she wrote through this link and how it stands: waiting, or confirmed.
 *                             One he answered 「不对」 is no longer shown (M11). Her own words only: when he changed
 *                             the wording (改一下), she sees what she wrote and that he confirmed it, not his words
 *                             (his details are not one of the six switches).
 *   herFactsSummary(facts)    the two counts her home shows
 *
 * Nothing here explains, infers or advises: a condition is her words about him, waiting for his own answer.
 */
import { cleanTime, type FactKind } from "@/lib/profile/facts";
import { clockWords } from "@/lib/profile/dates";
import { lockScreenProblems } from "@/lib/push/payload";
import { extractSlots } from "@/lib/safety/slots";
import type { ProfileFactRow, ScopeRoutineEntry, SessionRow, Store } from "@/lib/store/types";
import type { HerFact, HerFactsSummary } from "./home-types";

/** The kinds a family member may propose (a subset of track C's FACT_KINDS). */
export const HER_FACT_KINDS = ["condition", "allergy", "clinic", "routine", "other"] as const satisfies readonly FactKind[];
export type HerFactKind = (typeof HER_FACT_KINDS)[number];

export type FamilyFactProblem = "kind_not_for_family" | "text_clinical" | "routine_invalid" | "data_not_allowed";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A dose (a number with a dose unit, 两粒) or a reading (150/95) in her words. */
export function hasDoseOrReading(text: string): boolean {
  const t = text.normalize("NFKC");
  if (extractSlots(t).units.length > 0) return true;
  return lockScreenProblems(t).some((p) => p === "dose" || p === "reading");
}

/** Why a family member's proposal is refused (400 with this code), or null. */
export function familyFactProblem(input: { kind: string; text: string; data?: unknown }): FamilyFactProblem | null {
  if (!(HER_FACT_KINDS as readonly string[]).includes(input.kind)) return "kind_not_for_family";
  if (hasDoseOrReading(input.text)) return "text_clinical";
  if (input.kind === "routine") {
    const entry = isObj(input.data) ? input.data.entry : null;
    if (!isObj(entry) || Object.keys(input.data as object).length !== 1) return "routine_invalid";
    const keys = Object.keys(entry).sort().join(",");
    if (keys !== "days,label,label_zh,time") return "routine_invalid";
    if (entry.label !== "Breakfast" || entry.label_zh !== "早饭" || entry.days !== "daily" || typeof entry.time !== "string") return "routine_invalid";
    try {
      if (cleanTime(entry.time) !== entry.time) return "routine_invalid";
      // the words he reads and answers 「对」 to are the entry his settings get: the text is the entry's own, never free
      if (input.text !== breakfastProposal(entry.time).text) return "routine_invalid";
    } catch {
      return "routine_invalid";
    }
    return null;
  }
  return input.data === undefined || input.data === null ? null : "data_not_allowed";
}

/** 「早饭一般几点」 as a proposal: the same entry and words his own onboarding writes (lib/profile/onboarding.ts). */
export function breakfastProposal(time: string): { kind: "routine"; text: string; data: { entry: ScopeRoutineEntry } } {
  const entry: ScopeRoutineEntry = { label: "Breakfast", label_zh: "早饭", days: "daily", time: cleanTime(time) };
  return { kind: "routine", text: `早饭 · ${clockWords(entry.time, "zh-Hans")}`, data: { entry } };
}

/** One fact as she may see it: what she wrote, and whether he has confirmed it. */
export function herFact(f: ProfileFactRow): HerFact {
  const original = isObj(f.data) && typeof f.data.edited_from === "string" ? f.data.edited_from : null;
  const entry = f.kind === "routine" && isObj(f.data) && isObj(f.data.entry) ? f.data.entry : null;
  return {
    id: f.id,
    kind: f.kind,
    text: original ?? f.text,
    time: entry && typeof entry.time === "string" ? entry.time : null,
    state: f.confirmed_by ? "confirmed" : "waiting",
    edited: original !== null,
    at: f.created_at,
    confirmedAt: f.confirmed_by ? (f.confirmed_at ?? null) : null,
  };
}

/** What she wrote through this link, newest first; one he said 「不对」 to is left out. */
export async function herFacts(store: Pick<Store, "listProfileFacts">, scope: Pick<SessionRow, "id">, linkId: string): Promise<HerFact[]> {
  const rows = await store.listProfileFacts(scope.id);
  return rows
    .filter((f) => f.source === "family" && f.link_id === linkId && f.hidden !== true)
    .map(herFact)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function herFactsSummary(facts: readonly HerFact[]): HerFactsSummary {
  return { waiting: facts.filter((f) => f.state === "waiting").length, confirmed: facts.filter((f) => f.state === "confirmed").length };
}
