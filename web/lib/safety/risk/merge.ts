/**
 * The rules' frame and the model's, merged (the guided safety harness; risk/types.ts steps 1 to 3). The rules are the floor:
 * the merge can raise a risk the rules saw, never lower it. Call order: checkEvidence(modelFrame, input) first, then
 * mergeFrames(rulesFrame(...), checked.frame); the rules' frame is never put through the evidence check (its baseline "no"
 * and "none" carry no quote by design). With no model frame (offline, the spend cap, no AI consent, a timeout, a bad reply)
 * the result is the rules' frame.
 *
 * The ordering, field by field (the higher wins):
 *   selfHarm.ideation                        active > passive > unclear > none
 *   selfHarm.plan / means / soon / lethalityQuestion, distress, looksDifferent
 *                                            yes > unclear > no
 *   symptoms, by kind (a kind in either frame is kept)
 *     now / severe / sudden                  yes > unclear > no
 *     minutes                                the one that is known; both known: the longer (the more dangerous side of a
 *                                            "how long" threshold, as for chest pain)
 *   stopOrChange                             done > suggested_by_other > asked > none (it has happened > someone pushes > a
 *                                            question)
 *   acts                                     the union ("other" only when nothing else)
 * The facts (not a risk order: they agree, or are not known):
 *   about, when                              the same in both: that; one "unclear": the other's; two different values:
 *                                            "unclear" (the pathways then ask, or speak to him)
 *   amount.relation                          the same: that; one "none" (nothing said about an amount): the other's; two
 *                                            different amounts: "unknown" (how many is then asked)
 *   medicines                                the union of the refs; "unspecified" is dropped once a medicine of his is named.
 *                                            Every ref of the model's to one of his medicines has passed evidence.ts (a
 *                                            checked quote that names it, else it became "unspecified"), and every ref of
 *                                            the rules' is a name match, so two refs are two medicines he named, never a
 *                                            disagreement about one: the union is the "agree" case
 *   evidence                                 concatenated (a quote and its source once)
 *   missing                                  recomputed (rules-floor.ts missingFor)
 * Pure.
 */
import { missingFor } from "./rules-floor";
import type { Evidence, Frame, FrameSymptom, Tri } from "./types";

const TRI: Record<Tri, number> = { no: 0, unclear: 1, yes: 2 };
const IDEATION: Record<Frame["selfHarm"]["ideation"], number> = { none: 0, unclear: 1, passive: 2, active: 3 };
const STOP: Record<Frame["stopOrChange"], number> = { none: 0, asked: 1, suggested_by_other: 2, done: 3 };

const higherTri = (a: Tri, b: Tri): Tri => (TRI[a] >= TRI[b] ? a : b);
const higher = <T extends string>(rank: Record<T, number>, a: T, b: T): T => (rank[a] >= rank[b] ? a : b);

/** Evidence lists joined, each quote and source once. */
function joinEvidence(...lists: Evidence[][]): Evidence[] {
  const out: Evidence[] = [];
  for (const e of lists.flat()) if (!out.some((x) => x.quote === e.quote && x.from === e.from)) out.push({ ...e });
  return out;
}

/** Two values of a fact: the same, one unknown (the other's), or two different ones (unknown). */
function agree<T extends string>(a: T, b: T, unknown: T): T {
  if (a === b) return a;
  if (a === unknown) return b;
  if (b === unknown) return a;
  return unknown;
}

function mergeSymptom(a: FrameSymptom, b: FrameSymptom): FrameSymptom {
  return {
    kind: a.kind,
    now: higherTri(a.now, b.now),
    minutes: a.minutes === null ? b.minutes : b.minutes === null ? a.minutes : Math.max(a.minutes, b.minutes),
    severe: higherTri(a.severe, b.severe),
    sudden: higherTri(a.sudden, b.sudden),
    evidence: joinEvidence(a.evidence, b.evidence),
  };
}

/** The merged frame (see the header for the order of every field). */
export function mergeFrames(rules: Frame, model: Frame | null): Frame {
  if (!model) {
    const f = structuredClone(rules);
    f.missing = missingFor(f);
    return f;
  }
  const symptoms: FrameSymptom[] = [];
  for (const s of [...rules.symptoms, ...model.symptoms]) {
    const i = symptoms.findIndex((x) => x.kind === s.kind);
    if (i < 0) symptoms.push(structuredClone(s));
    else symptoms[i] = mergeSymptom(symptoms[i], s);
  }

  const meds = new Map<string, Evidence[]>();
  for (const m of [...rules.medicines, ...model.medicines]) meds.set(m.ref, joinEvidence(meds.get(m.ref) ?? [], m.evidence));
  if ([...meds.keys()].some((k) => k !== "unspecified" && k !== "unknown")) meds.delete("unspecified");

  const relation =
    rules.amount.relation === model.amount.relation
      ? rules.amount.relation
      : rules.amount.relation === "none"
        ? model.amount.relation
        : model.amount.relation === "none"
          ? rules.amount.relation
          : "unknown";

  const acts = [...new Set([...rules.acts, ...model.acts])];
  const merged: Frame = {
    about: agree(rules.about, model.about, "unclear"),
    acts: acts.length > 1 ? acts.filter((a) => a !== "other") : acts,
    medicines: [...meds.entries()].map(([ref, evidence]) => ({ ref, evidence })),
    amount: { relation, evidence: joinEvidence(rules.amount.evidence, model.amount.evidence) },
    when: agree(rules.when, model.when, "unclear"),
    symptoms,
    looksDifferent: higherTri(rules.looksDifferent, model.looksDifferent),
    stopOrChange: higher(STOP, rules.stopOrChange, model.stopOrChange),
    selfHarm: {
      ideation: higher(IDEATION, rules.selfHarm.ideation, model.selfHarm.ideation),
      plan: higherTri(rules.selfHarm.plan, model.selfHarm.plan),
      means: higherTri(rules.selfHarm.means, model.selfHarm.means),
      soon: higherTri(rules.selfHarm.soon, model.selfHarm.soon),
      lethalityQuestion: higherTri(rules.selfHarm.lethalityQuestion, model.selfHarm.lethalityQuestion),
      evidence: joinEvidence(rules.selfHarm.evidence, model.selfHarm.evidence),
    },
    distress: higherTri(rules.distress, model.distress),
    missing: [],
  };
  merged.missing = missingFor(merged);
  return merged;
}
