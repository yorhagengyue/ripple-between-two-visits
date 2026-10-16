/**
 * One medicine card (task M3 item 3, web-app.md section 7): what it is for, how to take it, the leaflet's points,
 * each part with its own source chip. Every line is a candidate source from lib/safety (buildCandidates) and goes
 * through lib/safety's three checks (verifySentences) before it is shown; a line that fails is left out and listed
 * in `hidden`. Nothing here writes clinical text:
 *
 *   purpose      the doctor's own words about why he takes it (visit items of type purpose, e.g. R3, with the
 *                visit date and the time point in the recording), then the leaflet restatement (patient_text)
 *   how to take  the confirmed label's directions, word for word (Mandarin: lib/safety's label template)
 *   leaflet      the other patient_text restatements for this drug
 *   unknown      lib/safety's fixed unknown-medicine sentence, and the recorded answer to its question once it
 *                exists; its chip names the speaker only when he confirmed who said it (lib/meds/answers.ts),
 *                otherwise it reads "recording", and an instruction nobody is named for fails the checks
 *
 * Doctor lines are only the "purpose" items for this drug, so other things said about a medicine (for example a
 * later remark about ibuprofen) never land on its card: the card of a self-bought medicine is the standard leaflet
 * card any user would get. "Awaiting label" follows the medicine's status, not the absence of directions (a
 * self-bought box has no directions and is still confirmed). Server-only.
 */
import type { Locale } from "@/lib/i18n";
import { buildCandidates, originOf, TEMPLATES, verifySentences, zhFromSlots, type Candidate, type Sentence } from "@/lib/safety";
import type { MedicationRow, Store } from "@/lib/store/types";
import { doseSlotsOf } from "@/lib/daily/slots";
import { answerChoices, questionForMed } from "./answers";
import { medDisplayName } from "./write";
import { CONFIRM_FIELDS, type AnswerSpeaker, type CardChip, type CardLine, type CardQuestion, type ChipKind, type MedCardView, type StoredLabel } from "./types";
import { zhGenericName } from "./zh-names";

type Section = "purpose" | "howToTake" | "leaflet" | "unknown" | "answer";

interface Draft {
  section: Section;
  sentence: Sentence;
  candidate: Candidate;
}

const LABEL_OK: MedicationRow["status"][] = ["label_confirmed", "pharmacist_checked"];

function sentenceFrom(c: Candidate): Sentence {
  return {
    speechAct: "restate",
    sourceId: c.sourceId,
    span: c.span,
    slots: {},
    en: c.restatement ? c.restatement.en : c.span,
    zh: c.restatement?.zh,
    attribution: c.attribution,
    cite: c.cite,
  };
}

function chipFor(s: Sentence, c: Candidate, med: MedicationRow): CardChip {
  if (s.origin === "template") return { kind: "ripple" };
  const kind: ChipKind =
    s.attribution === "doctor" || s.attribution === "dispenser" || s.attribution === "pharmacist" || s.attribution === "label" || s.attribution === "leaflet"
      ? s.attribution
      : c.kind === "log"
        ? "records"
        : c.kind === "visit"
          ? "recording"
          : "ripple";
  if (kind === "label") return { kind, date: med.label?.dispensed ?? null };
  if (kind === "leaflet") {
    let host: string | null = null;
    try {
      host = c.cite?.url ? new URL(c.cite.url).hostname.replace(/^www\./, "") : null;
    } catch {
      host = null;
    }
    return { kind, title: host, url: c.cite?.url ?? null, reviewStatus: c.cite?.reviewStatus ?? null };
  }
  const inferred = (kind === "doctor" || kind === "dispenser" || kind === "pharmacist") && c.cite?.roleState === "inferred";
  return { kind, date: c.cite?.date ?? null, tStartMs: c.cite?.tStartMs ?? null, standInVoice: !!c.cite?.standInVoice, ...(inferred ? { inferred } : {}) };
}

function lineFor(d: Draft, med: MedicationRow, locale: Locale): CardLine {
  const s = d.sentence;
  const chip = chipFor(s, d.candidate, med);
  if (d.section === "unknown") {
    // the fixed English sentence, and the reviewed Mandarin line under it in the zh-Hans UI (web-app.md 6.3)
    return { text: s.en, secondLine: locale === "zh-Hans" && s.zh ? s.zh : null, secondIsOriginal: false, chip, sourceId: s.sourceId };
  }
  if (locale === "zh-Hans" && s.zh) {
    const isLabelTemplate = d.candidate.kind === "label";
    return { text: s.zh, secondLine: isLabelTemplate ? s.en : null, secondIsOriginal: isLabelTemplate, chip, sourceId: s.sourceId };
  }
  return { text: s.en, secondLine: null, secondIsOriginal: false, chip, sourceId: s.sourceId };
}

export interface CardOptions {
  day: number;
  locale: Locale;
  env?: Record<string, string | undefined>;
}

export async function buildMedCardView(store: Store, sessionId: string, med: MedicationRow, opts: CardOptions): Promise<MedCardView> {
  const { day, locale } = opts;
  const stored = med.label as StoredLabel | null;
  const scope = await store.getSession(sessionId);
  const cands = await buildCandidates(store, sessionId, { day, route: "explain", topics: ["why_take", "purpose"] });
  const drugId = med.drug_id;
  const drafts: Draft[] = [];
  const add = (section: Section, candidate: Candidate | undefined, sentence?: Sentence) => {
    if (candidate) drafts.push({ section, candidate, sentence: sentence ?? sentenceFrom(candidate) });
  };

  if (drugId) {
    // purpose: the doctor's words first (R3), then the leaflet
    for (const c of cands.list) {
      if (c.kind === "visit" && c.topics?.includes("why_take") && c.drugs?.includes(drugId)) add("purpose", c);
    }
    add("purpose", cands.list.find((c) => c.kind === "patient_text" && c.restatement?.id === `${drugId}.purpose`));

    // how to take: the confirmed label, word for word
    const directions = med.label?.directions;
    if (LABEL_OK.includes(med.status) && directions) {
      const c = cands.byId.get(`label:${med.id}`);
      if (c && c.span.trim() === directions.trim()) add("howToTake", c, { ...sentenceFrom(c), en: directions, zh: zhFromSlots(directions, "label") ?? undefined });
    }

    // the other leaflet points
    for (const c of cands.list) {
      const id = c.restatement?.id;
      if (c.kind === "patient_text" && id?.startsWith(`${drugId}.`) && id !== `${drugId}.purpose`) add("leaflet", c);
    }
  }

  // an unidentified medicine: the fixed sentence (lib/safety template)
  if (med.status === "unidentified" || !drugId) {
    const t = TEMPLATES.unknown_med;
    const c = cands.byId.get(`tpl:${t.id}`);
    if (c) add("unknown", c, { speechAct: t.speechAct, sourceId: c.sourceId, span: c.span, slots: {}, en: t.en, zh: t.zh, origin: "template", templateId: t.id });
  }

  // the question this medicine raised, and its recorded answer (only once that visit has happened)
  const questions = await store.listQuestions(sessionId);
  const q = questionForMed(med, questions);
  if (q?.answer_text && q.answer_visit_id) {
    const answer = q.answer_text.trim();
    add(
      "answer",
      cands.list.find((c) => c.kind === "visit" && c.span.trim() === answer && c.cite?.visitId === q.answer_visit_id),
    );
  }

  // the source decides attribution and origin (as lib/safety's pipeline does), then the three checks
  for (const d of drafts) {
    if (d.sentence.origin === "template") continue;
    if (d.candidate.attribution) d.sentence.attribution = d.candidate.attribution;
    d.sentence.cite = d.candidate.cite;
    d.sentence.origin = originOf(d.sentence, d.candidate);
  }
  const { verdicts } = await verifySentences(
    drafts.map((d) => d.sentence),
    { candidates: cands.byId, checker: null, checkerReason: "medicine card: quotes, leaflet restatements and templates only" },
  );

  const view: MedCardView = {
    medId: med.id,
    drugId,
    name: medDisplayName(med, locale),
    strength: med.label?.strength ?? null,
    origin: med.origin,
    status: med.status,
    awaitingLabel: med.status === "awaiting_label",
    purpose: [],
    howToTake: [],
    leaflet: [],
    unknown: [],
    question: null,
    hidden: [],
    // C2 (track F): the Chinese generic name from the checked table, his own changes and entries, his status, the slots
    zhName: zhGenericName(drugId),
    edited: CONFIRM_FIELDS.filter((f) => typeof stored?.edited_values?.[f] === "string").map((f) => ({ field: f, value: stored!.edited_values![f]! })),
    typed: stored?.typed === true,
    patientStatus: stored?.patient_status ?? null,
    slots: (() => {
      const s = scope ? doseSlotsOf(scope, med) : { slots: [], source: null };
      return { slots: s.slots, source: s.source === "label" || s.source === "patient" ? s.source : null };
    })(),
  };
  let answerLine: CardLine | null = null;
  let answerHidden = false;
  for (const v of verdicts) {
    const d = drafts[v.index];
    if (!v.pass) {
      view.hidden.push({ sourceId: d.sentence.sourceId, section: d.section, reasons: [...v.layer1.reasons, ...(v.layer2?.reasons ?? []), ...(v.layer3?.reasons ?? [])] });
      if (d.section === "answer") answerHidden = true;
      continue;
    }
    const line = lineFor(d, med, locale);
    if (d.section === "answer") answerLine = line;
    else view[d.section].push(line);
  }

  if (q) {
    const card: CardQuestion = {
      id: q.id,
      text: q.text,
      for: q.for,
      status: q.status,
      answer: answerLine,
      answerSpeaker: q.answer_speaker === "doctor" || q.answer_speaker === "dispenser" || q.answer_speaker === "pharmacist" ? (q.answer_speaker as AnswerSpeaker) : null,
      answerHidden,
      answerChoices: await answerChoices(store, sessionId, q, day, opts.env),
    };
    view.question = card;
  }
  return view;
}

/** Everything a card would put on screen, as plain text (tests: "the card contains none of ..."). */
export function cardText(view: MedCardView): string {
  const lines = [...view.purpose, ...view.howToTake, ...view.leaflet, ...view.unknown, ...(view.question?.answer ? [view.question.answer] : [])];
  return [view.name, view.strength ?? "", ...lines.flatMap((l) => [l.text, l.secondLine ?? ""]), view.question?.text ?? ""].join("\n");
}

export type { StoredLabel };
