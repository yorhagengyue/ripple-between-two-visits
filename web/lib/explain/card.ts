/**
 * The explain card 「为什么没感觉也要吃」 / "Why take it when you feel fine" (task M5 item 1, web-app.md section 5,
 * D9). Server-only.
 *
 * Every line is one of exactly three things, each a lib/safety candidate source (buildCandidates) and each put
 * through lib/safety's three checks (verifySentences) before it is shown; a line that fails is left out and listed
 * in `hidden`:
 *   1. R3, the doctor's words at the visit that prescribed the medicine (the purpose line of that visit),
 *      verbatim in the language he said it. Its chip follows this session's transcript (lib/safety/line-state.ts):
 *      推断：医生 / Inferred: doctor after a replay he has not confirmed, 医生说 / Doctor said otherwise. Its
 *      stand-in clip (fixtures/visits/clips/v2-u06.wav) plays from the chip.
 *   2. Lines of the clinic counter (or a pharmacist) at that same visit, verbatim, only once he confirmed who said
 *      them in the after-visit review, and only lines about this medicine or what to do if he misses one.
 *   3. This medicine's patient_text.json restatements: what it is for, stopping, a missed dose (their own en / zh).
 *
 * Nothing on the card is written here, and no model is called: Mandarin is the restatement's own zh field; the
 * doctor's and the counter's words stay in their own language with a Mandarin source label. The card exists only
 * once R3 has been said in the story (D8 for amlodipine); before that buildExplainCard returns null.
 */
import type { Locale } from "@/lib/i18n";
import type { LlmClient } from "@/lib/llm/types";
import { chipFromSentence } from "@/lib/meds/chips";
import { medDisplayName } from "@/lib/meds/write";
import { buildCandidates, originOf, verifySentences, type Candidate, type CandidateSet, type Sentence } from "@/lib/safety";
import type { MedicationRow, Store } from "@/lib/store/types";
import type { ExplainCardView, ExplainLine, ExplainLineKind } from "./types";

/** The patient_text restatements this card uses, in screen order (`<drug>.<suffix>`). */
export const LEAFLET_SUFFIXES = ["purpose", "stopping", "missed"] as const;
const COUNTER_ATTRIBUTIONS = new Set(["dispenser", "pharmacist"]);
const COUNTER_TOPICS = new Set(["missed", "food"]);

export interface ExplainOptions {
  day: number;
  locale: Locale;
}

export interface ExplainDeps {
  /** layer-3 checker; never needed here (every line is a quote or a reviewed restatement), so it is never called */
  checker?: LlmClient | null;
}

interface Picked {
  kind: ExplainLineKind;
  candidate: Candidate;
}

/** The candidate sources the card may use, in screen order (exported for tests). */
export function pickExplainSources(cands: Pick<CandidateSet, "list">, med: Pick<MedicationRow, "drug_id" | "prescribed_visit_id">): Picked[] {
  const drugId = med.drug_id;
  if (!drugId || !med.prescribed_visit_id) return [];
  const visitId = med.prescribed_visit_id;
  // the doctor's reason said at the prescribing visit: R3 in the demo; on an account the purpose line he confirmed in
  // his review (lib/safety's candidates hold an account's lines only once he confirmed them)
  const r3 =
    cands.list.find((c) => c.kind === "visit" && !!c.cite?.requiredLine && c.cite.visitId === visitId && c.topics?.includes("why_take") && c.drugs?.includes(drugId)) ??
    cands.list.find((c) => c.kind === "visit" && c.cite?.visitId === visitId && c.cite.roleState === "confirmed" && c.attribution === "doctor" && c.topics?.includes("why_take") && c.drugs?.includes(drugId));
  if (!r3) return [];
  const counter = cands.list
    .filter(
      (c) =>
        c.kind === "visit" &&
        c !== r3 &&
        !c.cite?.requiredLine &&
        !!c.cite?.utteranceId &&
        c.cite.visitId === visitId &&
        c.cite.roleState === "confirmed" &&
        !!c.attribution &&
        COUNTER_ATTRIBUTIONS.has(c.attribution) &&
        (c.drugs?.includes(drugId) || (c.topics ?? []).some((t) => COUNTER_TOPICS.has(t))),
    )
    .sort((a, b) => (a.cite?.tStartMs ?? 0) - (b.cite?.tStartMs ?? 0));
  const leaflet = LEAFLET_SUFFIXES.map((suffix) => cands.list.find((c) => c.kind === "patient_text" && c.restatement?.id === `${drugId}.${suffix}`)).filter(
    (c): c is Candidate => !!c,
  );
  return [{ kind: "doctor", candidate: r3 }, ...counter.map((candidate) => ({ kind: "counter" as const, candidate })), ...leaflet.map((candidate) => ({ kind: "leaflet" as const, candidate }))];
}

/** A sentence that relays the source as it is (the pipeline's rules: the source decides attribution and origin). */
export function sentenceFor(c: Candidate): Sentence {
  const s: Sentence = {
    speechAct: "restate",
    sourceId: c.sourceId,
    span: c.span,
    slots: {},
    en: c.restatement ? c.restatement.en : c.span,
    zh: c.restatement?.zh,
    attribution: c.attribution,
    cite: c.cite,
  };
  s.origin = originOf(s, c);
  return s;
}

const hasHan = (text: string) => /\p{Script=Han}/u.test(text);

function lineFor(kind: ExplainLineKind, s: Sentence, locale: Locale): ExplainLine {
  // doctor and counter: the words as said; leaflet: the restatement in the UI language (its own zh field)
  const text = kind === "leaflet" && locale === "zh-Hans" && s.zh ? s.zh : s.en;
  return {
    kind,
    sourceId: s.sourceId,
    text,
    lang: hasHan(text) ? "zh-Hans" : "en",
    chip: chipFromSentence(s),
    requiredLine: s.cite?.requiredLine ?? null,
    clip: s.cite?.clipUrl ? { url: s.cite.clipUrl, standIn: !!s.cite.standInVoice } : null,
  };
}

/** What read-aloud sends to text-to-speech: the rendered sentences, in order, one per line, nothing added. */
export function explainSpeechText(lines: Pick<ExplainLine, "text">[]): string {
  return lines.map((l) => l.text).join("\n");
}

export async function buildExplainCard(
  store: Store,
  sessionId: string,
  med: MedicationRow,
  opts: ExplainOptions,
  deps: ExplainDeps = {},
): Promise<ExplainCardView | null> {
  if (!med.drug_id || !med.prescribed_visit_id) return null;
  const cands = await buildCandidates(store, sessionId, { day: opts.day, route: "explain", topics: ["why_take", "purpose", "missed", "stopping"] });
  const picked = pickExplainSources(cands, med);
  if (picked.length === 0) return null;

  const sentences = picked.map((p) => sentenceFor(p.candidate));
  const { verdicts } = await verifySentences(sentences, {
    candidates: cands.byId,
    checker: deps.checker ?? null,
    checkerReason: "explain card: the doctor's and the counter's own words and reviewed leaflet restatements only",
  });

  const lines: ExplainLine[] = [];
  const hidden: ExplainCardView["hidden"] = [];
  for (const v of verdicts) {
    const p = picked[v.index];
    if (!v.pass) {
      hidden.push({ sourceId: v.sentence.sourceId, reasons: [...v.layer1.reasons, ...(v.layer2?.reasons ?? []), ...(v.layer3?.reasons ?? [])] });
      continue;
    }
    lines.push(lineFor(p.kind, v.sentence, opts.locale));
  }
  // the card is about the doctor's reason; without R3 on screen there is no card
  if (!lines.some((l) => l.kind === "doctor")) return null;
  return {
    medId: med.id,
    drugId: med.drug_id,
    name: medDisplayName(med, opts.locale),
    lines,
    speechText: explainSpeechText(lines),
    hidden,
  };
}
