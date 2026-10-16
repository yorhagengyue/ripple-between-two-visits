/**
 * "Photograph a label" end to end, server side (web-app.md sections 7 and 8, task M3):
 *
 *   readLabel     photo in the labels bucket -> lib/vision (raw text) -> parse-label (fields) -> lib/vision/check
 *                 (two reads agree, dates and clinic plausible; an unreliable photo is "label_unreadable", a doubtful
 *                 field is left empty) -> signed read token
 *   confirmLabel  the patient confirmed every field -> recognise the medicine (lib/kb matcher) -> write the
 *                 medicine list -> what follows from it:
 *                 - identified: status label_confirmed; a medicine he did not get from the doctor also adds his
 *                   question for the pharmacist "ask about taking this with my other medicines" (no judgement,
 *                   the same for any user who adds such a medicine to a list that has other medicines)
 *                 - not identified: status unidentified, then lib/safety's ask() with the medicine selected, which
 *                   answers with the fixed sentence and adds exactly one question for the pharmacist
 *   relabelMed    a new bag for a medicine he has: back to awaiting_label until the new label is confirmed
 *
 * Where a confirmed label goes: the medicine given by `medId`; else the medicine on the list with the same kb
 * drug and the same origin; else a new row. Every write publishes med.changed (question.created for the question
 * added here; ask() publishes its own events). Server-only.
 *
 * A medicine waiting for its label (C2 round three; real-app 2.16, 6.9: 「拍出来的药对回『等药袋确认』那一行……对不上就说『药袋上的
 * 名字和医生开的不一样，拿去问药剂师』」). On an account the match does not depend on the page having been opened for that
 * medicine (`medId`): a label, photographed or typed, is held against the waiting ones every time (waitingMatch):
 *   - it names a waiting medicine and he says it is from the same place (医生开的): it goes onto that medicine;
 *   - it is not clear (a prescription waits and the label names something else that is not already on his list, or it
 *     names the waiting medicine while he said it is not from the doctor): nothing is written and he is asked which
 *     medicine the label is for (409 label_which { waiting, label_name }). His answer comes back as `medId` (then the
 *     rule above: another name writes nothing and adds his question for the pharmacist, 409 label_mismatch) or as
 *     `other` (none of the waiting ones: saved as its own medicine);
 *   - nothing waits, or he said it is not from the doctor and the names differ, or it is a medicine he already has
 *     again: as before.
 * A demo session keeps the earlier behaviour (its story has no medicine waiting when a label is photographed without one).
 *
 * His consent to AI processing (lib/safety/consent.ts aiConsent; real-app 2.2 step 7, 3.11: 「服务端主动发起的模型调用（抽卡、
 * 读药袋），只对 ai_processing 是 granted、而且后来没有 withdrawn 的人跑」), read for every request on an account (a demo
 * session's synthetic story keeps today's behaviour):
 *   readLabel      off: the photo is handed to no reader at all, model or recorded stand-in (MedsError ai_off, 403). He
 *                  types the label's words himself (addManualMed; for a prescribed medicine awaiting its label, onto
 *                  that medicine).
 *   confirmLabel   the unknown-medicine answer is lib/safety's ask() with his decision passed on: off means the fixed
 *                  sentence and the rules only, no model.
 */
import { publish as busPublish, type BusEventType } from "@/lib/bus";
import { blobPrefix, getBlobStore, pathInSession, type BlobStore } from "@/lib/blob";
import type { Locale } from "@/lib/i18n";
import { getDrug } from "@/lib/kb/load";
import { matchDrug } from "@/lib/kb/match";
import { isDaySlot, slotsFromLabel, sortSlots } from "@/lib/daily/slots";
import { addQuestionFor } from "@/lib/profile/questions";
import { ask, TEMPLATES, UNKNOWN_MED_SENTENCE, type AskDeps, type AskResult } from "@/lib/safety";
import { aiConsent } from "@/lib/safety/consent";
import { isAccount } from "@/lib/store/scope";
import { StoreError, type DaySlot, type MedicationRow, type MedOrigin, type QuestionRow, type Store } from "@/lib/store/types";
import { scopeNowIso } from "@/lib/time/now";
import { storyDate } from "@/lib/story/clock";
import { scopeD0 } from "@/lib/store/scope";
import { readLabelText, VisionError, type ReadLabelDeps } from "@/lib/vision";
import { assessLabelReading, readDate } from "@/lib/vision/check";
import { MedsError } from "./errors";
import { mt } from "./i18n";
import { newMedId } from "./ids";
import { medsNow } from "./on-day";
import { parseLabelText } from "./parse-label";
import { sampleDate, sampleDateShift, sampleLabelOf } from "./sample-label";
import { ReadTokenError, signReadToken, verifyReadToken } from "./read-token";
import { checkAskedTimes, keepAskedTimes } from "./slot-times";
import { zhGenericName } from "./zh-names";
import { CONFIRM_FIELDS, type ConfirmField, type ConfirmOutcome, type LabelFields, type LabelReadResponse, type PatientMedStatus, type StoredLabel } from "./types";

export type Publisher = (sessionId: string, type: BusEventType, say: string, data: unknown) => void;

export interface MedsDeps {
  /** the request subject's scoped store (lib/subject), or a test's store */
  store: Store;
  blob?: BlobStore;
  publish?: Publisher;
  vision?: ReadLabelDeps;
  /** passed to lib/safety ask() for the unknown-medicine answer (its store is this one) */
  ask?: Omit<AskDeps, "store">;
  nowMs?: () => number;
  /** his consent to AI processing, already read (default: read through `store` for this call) */
  aiAllowed?: boolean;
}

const defaultPublish: Publisher = (sid, type, say, data) => void busPublish(sid, type, say, data);

const LABEL_OK: MedicationRow["status"][] = ["label_confirmed", "pharmacist_checked"];

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Amlodipine" (kb display name), else the printed name, else "a medicine Ripple can't identify". */
export function medDisplayName(med: Pick<MedicationRow, "drug_id" | "label">, locale: Locale): string {
  const drug = med.drug_id ? getDrug(med.drug_id) : null;
  if (drug) return cap(drug.display_name);
  const label = med.label as StoredLabel | null;
  return label?.drug_text?.trim() || mt(locale, "name.unknown");
}

/** Name plus strength for question texts and event lines ("Ibuprofen 200 mg"). */
export function medFullName(med: Pick<MedicationRow, "drug_id" | "label">, locale: Locale): string {
  const strength = med.label?.strength;
  return strength && med.drug_id ? `${medDisplayName(med, locale)} ${strength}` : medDisplayName(med, locale);
}

async function sessionOrThrow(store: Store, sessionId: string) {
  const session = await store.getSession(sessionId);
  if (!session) throw new StoreError("session_not_found", `No session ${sessionId}`);
  return session;
}

// ---------------------------------------------------------------- read

export async function readLabel(input: { sessionId: string; path: string }, deps: MedsDeps): Promise<LabelReadResponse> {
  const store = deps.store;
  const blob = deps.blob ?? getBlobStore();
  const pub = deps.publish ?? defaultPublish;
  const { sessionId, path } = input;
  const session = await sessionOrThrow(store, sessionId);
  if (!pathInSession(blobPrefix(session), path)) throw new MedsError("photo_not_in_session", "that photo is not in this session");
  // his consent to AI processing, as it is for this request: without it the photo goes to no reader (he types the label)
  const aiAllowed = deps.aiAllowed ?? (await aiConsent(store, session));
  if (!aiAllowed) {
    pub(sessionId, "med.changed", "Label photo not read: AI processing is off for this account (he types the label himself)", { kind: "label.read_refused", code: "ai_off" });
    throw new MedsError("ai_off", "AI processing is off for this account: the label is typed in, not read from a photo");
  }
  const photo = await blob.getObject("labels", path);
  if (!photo) throw new MedsError("photo_not_found", "no photo at that path; upload it first");

  let text;
  try {
    text = await readLabelText({ bytes: photo.bytes, mime: photo.contentType }, deps.vision);
  } catch (e) {
    if (e instanceof VisionError) {
      pub(sessionId, "med.changed", `Label photo could not be read (${e.code})`, { kind: "label.read_failed", code: e.code });
      throw new MedsError("label_unreadable", "the label could not be read", { code: e.code });
    }
    throw e;
  }
  const visits = await store.listVisits(sessionId);
  const knownClinics = [...new Set(visits.map((v) => v.place))];
  const parsed = parseLabelText(text.text, { knownClinics });
  // one of the example's sample photos on an account that uses them: the date printed on it is the template's own, and
  // is moved to this account's days like every other date of the example (lib/meds/sample-label.ts). Both reads of
  // the same printed date move together, before the checks below look at how old the date is.
  let second = text.second;
  const printedDate = parsed.dispensed;
  if (printedDate && sampleDateShift(session) !== 0 && sampleLabelOf(photo.bytes)) {
    parsed.dispensed = sampleDate(session, printedDate);
    if (second && readDate(second.date) === printedDate) second = { ...second, date: parsed.dispensed };
  }
  // is the reading trustworthy? two reads agree, plausible date and clinic (lib/vision/check.ts)
  // "today" for the label's dispensed date: the scope's day 0 (an account's own, the template's in the demo) + its day
  const check = assessLabelReading(parsed, second, { today: storyDate(scopeD0(session), session.story_day), knownClinics, secondBy: text.secondBy });
  if (check.reject) {
    pub(sessionId, "med.changed", `Label photo could not be read reliably (${check.reject}); asked for a new photo`, { kind: "label.read_failed", code: check.reject, warnings: check.warnings });
    throw new MedsError("label_unreadable", "the label could not be read reliably", { code: check.reject });
  }
  const fields = check.fields;
  const drug = fields.drug_id ? getDrug(fields.drug_id) : null;
  const readToken = signReadToken({ sid: sessionId, path, fields, by: text.provider }, { nowMs: deps.nowMs?.() });

  // the raw text never leaves the server (an unidentified box may print dosing that must not be relayed)
  pub(
    sessionId,
    "med.changed",
    fields.drug_id
      ? `Label read (${text.provider}): "${fields.drug_text}" -> ${fields.drug_id} (${fields.match} match)`
      : `Label read (${text.provider}): "${fields.drug_text ?? "?"}" -> not identified`,
    // reader_error: OCR could not read it for the account's configuration, so a sample photo's recorded reading answered
    { kind: "label.read", provider: text.provider, cassette: text.cassette, fields, warnings: check.warnings, ...(text.readerError ? { reader_error: text.readerError } : {}) },
  );
  return {
    read_token: readToken,
    fields,
    display_name: drug ? cap(drug.display_name) : null,
    provider: text.provider,
    warnings: check.warnings,
    // the slots confirmLabel will set from the label's own time words (the same closed table), so the flow asks about
    // exactly these; null: the words name no time and he chooses
    dose_slots: fields.drug_id ? slotsFromLabel(fields.directions) : null,
  };
}

// ---------------------------------------------------------------- confirm

export interface ConfirmInput {
  sessionId: string;
  readToken: string;
  /** required unless medId is given */
  origin?: MedOrigin;
  /** attach the label to this medicine (the card's "photograph the label", or his answer to "which medicine is this label for") */
  medId?: string;
  /** his answer "none of the medicines waiting for a label": this label is its own medicine (accounts; see waitingMatch) */
  other?: boolean;
  /** the fields the patient ticked "right" */
  confirmed: string[];
  /**
   * C2: the fields he changed while checking, with his words (「改一下」). Every field on the label is either ticked or
   * changed. A changed field is his, never the label's: it is shown as 「你改过」 and never quoted as the label.
   */
  edits?: Partial<Record<ConfirmField, string>>;
  /** C2: when he takes it, when the label's own words name no slot (早上 / 中午 / 晚上 / 睡前: his choice) */
  slots?: DaySlot[];
  /**
   * C2: when a slot's reminder comes, asked once when his settings do not say (real-app 2.16; lib/meds/slot-times.ts,
   * kept through track C's lib/profile/reminder-times.ts): { midday | evening | night: "HH:MM" }
   */
  times?: Partial<Record<DaySlot, string>>;
  locale: Locale;
}

export interface ConfirmResult {
  med: MedicationRow;
  /** display name with strength ("Amlodipine 5 mg"; the printed name when not identified) */
  name: string;
  outcome: ConfirmOutcome;
  created: boolean;
  /** unknown medicine: lib/safety's answer (fixed sentence) */
  answer: Pick<AskResult, "route" | "sentences" | "fixedText" | "fixedTextZh" | "addedQuestionId" | "locale" | "noAiConsent"> | null;
  /** questions added by this confirmation (the pharmacist question for a self-bought medicine, or ask()'s) */
  questions: QuestionRow[];
}

/** Fields that must be ticked: every one the label actually has. */
export function requiredConfirmations(fields: LabelFields): ConfirmField[] {
  return CONFIRM_FIELDS.filter((f) => fields[f] !== null && fields[f] !== "");
}

const EDIT_MAX = 200;

function cleanEdits(edits: ConfirmInput["edits"], fields: LabelFields): Partial<Record<ConfirmField, string>> {
  const out: Partial<Record<ConfirmField, string>> = {};
  for (const f of CONFIRM_FIELDS) {
    const v = edits?.[f];
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim();
    if (!t) throw new MedsError("bad_edit", `an empty ${f}`);
    if ([...t].length > EDIT_MAX) throw new MedsError("bad_edit", `${f} is too long`);
    // the same words as printed: a tick, not a change
    if (t !== (fields[f] ?? "").trim()) out[f] = t;
  }
  return out;
}

/** Same printed name, for "the same box photographed again": NFKC, lower case, letters and digits only. */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return !!n(a) && n(a) === n(b);
}

/** A medicine waiting for its label, as the question "which medicine is this label for" names it. */
export interface WaitingMed {
  id: string;
  /** "Amlodipine" */
  name: string;
  /** 氨氯地平, when the fixed table has it */
  zh: string | null;
}

/**
 * A label that came without `medId`, held against his medicines that wait for one (accounts; the header has the rule).
 * Returns the waiting medicine the label goes onto, or null when it is not one of them (the caller's usual path).
 * Throws label_which when it is not clear: he is asked, nothing is written.
 */
function waitingMatch(x: { visible: MedicationRow[]; drugId: string | null; nameText: string | null; origin: MedOrigin; other: boolean; locale: Locale }): MedicationRow | null {
  const waiting = x.visible.filter((m) => m.status === "awaiting_label" && !!m.drug_id);
  if (!waiting.length) return null;
  const ask = (meds: MedicationRow[]): never => {
    const list: WaitingMed[] = meds.map((m) => ({ id: m.id, name: medDisplayName(m, x.locale), zh: zhGenericName(m.drug_id) }));
    throw new MedsError("label_which", "a medicine waits for its label: which one is this label for?", { waiting: list, label_name: x.nameText });
  };
  // the label names a waiting medicine
  const named = x.drugId ? (waiting.find((m) => m.drug_id === x.drugId) ?? null) : null;
  if (named) {
    if (named.origin === x.origin) return named;
    // he said it is from somewhere else, the name is the waiting medicine's: his word decides, so he is asked
    return x.other ? null : ask([named]);
  }
  const prescribed = waiting.filter((m) => m.origin === "prescription");
  // he said it is not from the doctor and it names something else, or he already answered "none of these"
  if (x.origin !== "prescription" || !prescribed.length || x.other) return null;
  // a medicine from the doctor he already has (the same kb drug, or the same box nobody identified): that one again
  const his = x.visible.filter((m) => m.origin === "prescription" && m.status !== "awaiting_label");
  if (x.drugId ? his.some((m) => m.drug_id === x.drugId) : his.some((m) => !m.drug_id && sameName((m.label as StoredLabel | null)?.drug_text, x.nameText))) return null;
  return ask(prescribed);
}

/**
 * His question for the pharmacist when the label names another medicine than the doctor prescribed (real-app 2.16:
 * 「药袋上的名字和医生开的不一样，拿去问药剂师」). His words in a fixed frame, with both names as written.
 */
export function mismatchQuestionText(locale: Locale, labelName: string, prescribed: string): string {
  return locale === "en"
    ? `The name on my label (${labelName}) is not the one the doctor prescribed (${prescribed}). Is it the same medicine?`
    : `药袋上的名字（${labelName}）和医生开的（${prescribed}）不一样，是同一种药吗？`;
}

export async function confirmLabel(input: ConfirmInput, deps: MedsDeps): Promise<ConfirmResult> {
  const store = deps.store;
  const pub = deps.publish ?? defaultPublish;
  const { sessionId, locale } = input;
  const session = await sessionOrThrow(store, sessionId);
  const day = session.story_day;
  const account = isAccount(session);

  let token;
  try {
    token = verifyReadToken(input.readToken, sessionId, { nowMs: deps.nowMs?.() });
  } catch (e) {
    if (e instanceof ReadTokenError) throw new MedsError(e.code, e.message);
    throw e;
  }
  const fields = token.fields;
  const edits = cleanEdits(input.edits, fields);
  const edited = CONFIRM_FIELDS.filter((f) => edits[f] !== undefined);
  const missing = requiredConfirmations(fields).filter((f) => !input.confirmed.includes(f) && !edited.includes(f));
  if (missing.length) throw new MedsError("not_all_confirmed", "every line on the label has to be checked first", { missing });

  // recognise (after he confirmed the printed name, or wrote it himself): lib/kb's matcher
  const nameText = edits.drug_text ?? fields.drug_text;
  const match = nameText ? matchDrug(nameText, edits.drug_text ? { maxDistance: 0 } : {}) : null;
  const drugId = match?.drugId ?? null;

  const [allMeds, visits] = await Promise.all([store.listMeds(sessionId), store.listVisits(sessionId)]);
  const visible = await medsNow(store, session);
  let target: MedicationRow | null = null;
  if (input.medId) {
    target = allMeds.find((m) => m.id === input.medId) ?? null;
    if (!target) throw new MedsError("med_not_found", `no medicine ${input.medId}`);
    if (target.drug_id && target.drug_id !== drugId) {
      // the label names another medicine than the doctor prescribed: nothing is written to it; his question for the
      // pharmacist instead (accounts; the demo answers the 409 as before)
      const questions: QuestionRow[] = [];
      if (account) {
        const prescribed = medDisplayName(target, locale);
        const labelName = nameText ?? mt(locale, "name.unknown");
        const evidence = `label_mismatch:${target.id}`;
        const open = (await store.listQuestions(sessionId)).find((q) => q.evidence === evidence && q.status === "open");
        if (open) questions.push(open);
        else {
          const q = await store.addQuestion(sessionId, {
            for: "pharmacist",
            origin: "own",
            text: mismatchQuestionText(locale, labelName, prescribed),
            lang: locale,
            created_day: day,
            evidence,
          });
          questions.push(q);
          pub(sessionId, "question.created", `The label does not name the prescribed ${prescribed}: a question for the pharmacist`, { question: q });
        }
      }
      throw new MedsError("label_mismatch", "this label is for a different medicine", { expected: target.drug_id, read: drugId, questions });
    }
  } else {
    const origin = input.origin ?? "prescription";
    // a medicine of his waits for its label: this label is held against it whether or not the page was opened for it
    // (throws label_which when it is not clear which medicine the label is for: he is asked)
    target = account ? waitingMatch({ visible, drugId, nameText: nameText ?? null, origin, other: input.other === true, locale }) : null;
    if (target) {
      // its own label
    } else if (drugId) {
      target = visible.find((m) => m.drug_id === drugId && m.origin === origin) ?? null;
    } else {
      // the same box photographed again (nobody identified it): one medicine, not two
      target = visible.find((m) => !m.drug_id && m.origin === origin && sameName((m.label as StoredLabel | null)?.drug_text, nameText)) ?? null;
    }
  }
  const origin: MedOrigin = target?.origin ?? input.origin ?? "prescription";
  const outcome: ConfirmOutcome = drugId ? "label_confirmed" : "unidentified";
  const previous = (target?.label ?? null) as StoredLabel | null;

  // the label's printed words only for the fields he ticked; his words for the ones he changed (shown as his)
  const printed = (f: ConfirmField) => (edited.includes(f) ? null : fields[f]);
  const directions = drugId ? printed("directions") : null;
  const label: StoredLabel = {
    text: [printed("drug_text"), directions].filter(Boolean).join("\n"),
    drug: drugId,
    strength: edits.strength ?? fields.strength,
    directions,
    dispensed: printed("dispensed"),
    clinic: printed("clinic"),
    photo_fixture: null,
    photo_path: token.path,
    drug_text: nameText,
    slots: drugId && directions ? fields.slots : null,
    indication: fields.indication,
    read_by: token.by,
    question_id: previous?.question_id ?? null,
    confirmed_day: day,
    ...(edited.length ? { edited, edited_values: edits } : {}),
    ...(previous?.patient_status ? { patient_status: previous.patient_status, patient_status_at: previous.patient_status_at ?? null, doctor_question_id: previous.doctor_question_id ?? null } : {}),
  };

  // when he takes it (C2): the label's own time words (a closed table, lib/daily/slots.ts), else his choice; the
  // model never sets a slot. An unidentified box gets none (no reminder for a medicine nobody identified).
  const fromLabel = directions ? slotsFromLabel(directions) : null;
  const chosen = input.slots?.length ? sortSlots(input.slots.filter(isDaySlot)) : null;
  const fromHisWords = edits.directions ? slotsFromLabel(edits.directions) : null;
  const doseSlots = outcome === "unidentified" ? null : (fromLabel ?? chosen ?? fromHisWords ?? null);
  // the reminder time of a slot nobody asked him about yet: his answer, kept once (his own setting from now on; track
  // C's writer). A time outside its part of the day is refused here, before anything is written (400 bad_time).
  if (account && doseSlots && input.times) await keepAskedTimes(store, session, doseSlots, input.times);
  const slotFields = account
    ? {
        dose_slots: doseSlots,
        dose_slots_source: doseSlots ? (fromLabel ? ("label" as const) : ("patient" as const)) : null,
        // from now on: a cell whose first reminder came before this moment is not his (lib/daily); a new bag for a
        // medicine he already takes keeps the moment it became his
        // C2 track J (filming): the moment on the account's own clock (a filming account's story time; real time otherwise)
        start_at: target?.start_at && target.status !== "awaiting_label" ? target.start_at : scopeNowIso(session),
      }
    : {};

  let med: MedicationRow;
  const created = !target;
  if (target) {
    // a target with a kb drug was checked against the read above, so the outcome is that drug's
    med = await store.updateMed(sessionId, target.id, {
      label,
      status: outcome,
      drug_id: target.drug_id ?? drugId,
      ...(account && target.start_day === null ? { start_day: day } : {}),
      ...slotFields,
    });
  } else {
    med = await store.upsertMed(sessionId, {
      id: newMedId(allMeds, drugId),
      origin,
      status: outcome,
      drug_id: drugId,
      label,
      start_day: day,
      prescribed_visit_id: null,
      note: null,
      pharmacist_answer: null,
      ...slotFields,
    });
  }
  const name = medFullName(med, locale);
  pub(
    sessionId,
    "med.changed",
    outcome === "label_confirmed"
      ? `Mr Tan confirmed the label: ${name} (${origin.replace("_", "-")}) is ${created ? "on" : "updated in"} the medicine list${edited.length ? ` (he changed ${edited.join(", ")})` : ""}`
      : `Mr Tan confirmed the label of "${nameText ?? "?"}": not identified, saved as unidentified${created ? "" : " (the same box again)"}`,
    { kind: "label.confirmed", med, outcome, created, match, edited },
  );

  const questions: QuestionRow[] = [];
  let answer: ConfirmResult["answer"] = null;

  if (outcome === "unidentified") {
    if (!previous?.question_id) {
      const res = await ask(
        { sessionId, text: mt(locale, "question.unknown", { name: nameText ?? mt(locale, "name.unknown") }), locale, role: "patient", medIds: [med.id] },
        // his consent to AI processing decides whether any model sees this ask (off: the rules and the fixed sentence)
        { store, publish: pub, aiAllowed: deps.aiAllowed ?? (await aiConsent(store, session)), ...deps.ask },
      );
      answer = {
        route: res.route,
        sentences: res.sentences,
        fixedText: res.fixedText,
        fixedTextZh: res.fixedTextZh,
        addedQuestionId: res.addedQuestionId,
        locale: res.locale,
        // no model saw this ask (his consent to AI processing is off): the fixed sentence and the rules only
        ...(res.noAiConsent ? { noAiConsent: true as const } : {}),
      };
      if (res.addedQuestionId) {
        const q = await store.getQuestion(sessionId, res.addedQuestionId);
        if (q) questions.push(q);
        med = await store.updateMed(sessionId, med.id, { label: { ...label, question_id: res.addedQuestionId } as StoredLabel });
      }
    } else {
      // the same box again: the same fixed sentence (lib/safety's template, word for word), no second question
      answer = { route: "unknown_med", sentences: [], fixedText: UNKNOWN_MED_SENTENCE, fixedTextZh: TEMPLATES.unknown_med.zh, locale };
    }
  } else if (origin !== "prescription") {
    const others = (await medsNow(store, session)).filter((m) => m.id !== med.id);
    if (others.length > 0) {
      // the question text is exactly his sentence; which medicine it is about is in `evidence` (and the event)
      const text = mt(locale, "question.otherMeds");
      const tag = `(${origin.replace("_", "-")}, ${med.id})`;
      const open = await store.listQuestions(sessionId, { status: "open" });
      if (!open.some((q) => q.text === text && q.evidence?.includes(tag))) {
        const q = await store.addQuestion(sessionId, {
          for: "pharmacist",
          origin: "pattern",
          text,
          lang: locale,
          created_day: day,
          evidence: `${name} ${tag} was added to a medicine list that already has ${others.length} other medicine${others.length === 1 ? "" : "s"}`,
        });
        questions.push(q);
        pub(sessionId, "question.created", `Added to the questions for the pharmacist about ${name}: "${text}"`, { question: q });
      }
    }
  }
  void visits;

  return { med, name, outcome, created, answer, questions };
}

// ---------------------------------------------------------------- his own entry (C2)

export interface ManualInput {
  sessionId: string;
  /** the name as he typed it */
  name: string;
  origin: MedOrigin;
  /** when he takes it: his choice (早上 / 中午 / 晚上 / 睡前); empty: not decided yet */
  slots: DaySlot[];
  /** the strength as he typed it, optional */
  strength?: string | null;
  /**
   * the prescribed medicine this typed label is for (a medicine awaiting its label, when he cannot or may not
   * photograph it: his consent to AI processing is off, so no photo is read), or his answer to "which medicine is this
   * label for"
   */
  medId?: string;
  /** his answer "none of the medicines waiting for a label" (accounts; see waitingMatch) */
  other?: boolean;
  /** when a slot's reminder comes, asked once when his settings do not say (lib/meds/slot-times.ts) */
  times?: Partial<Record<DaySlot, string>>;
  locale: Locale;
}

export const MANUAL_NAME_MAX = 80;

/**
 * A medicine he types in himself (no label photo, no visit; real-app 2.16, the integrator's request for /p/meds/add):
 * status "unverified", marked as his own entry (label.typed, read_by "patient"), the slots he chose (dose_slots_source
 * "patient"), from now on. The kb names it only when his words are exactly a kb name or alias (no guessing on a typed
 * name); nothing is quoted from it as a label. The same medicine already on his list is not added twice (409
 * med_exists with that medicine).
 *
 * With `medId` the typed label goes onto that medicine (a prescription awaiting its label): the same rule as a
 * photographed label, the name he typed must be that medicine's (an exact kb name or alias); another name writes
 * nothing and adds his question for the pharmacist (409 label_mismatch, real-app 2.16).
 *
 * Without `medId`, on an account, a typed label is held against the medicines waiting for theirs exactly as a
 * photographed one (waitingMatch): the waiting medicine's own name goes onto it; when it is not clear he is asked
 * (409 label_which).
 */
export async function addManualMed(input: ManualInput, deps: MedsDeps): Promise<{ med: MedicationRow; name: string }> {
  const store = deps.store;
  const pub = deps.publish ?? defaultPublish;
  const session = await sessionOrThrow(store, input.sessionId);
  const typed = input.name.replace(/\s+/g, " ").trim();
  if (!typed) throw new MedsError("bad_name", "the name is empty");
  if ([...typed].length > MANUAL_NAME_MAX) throw new MedsError("bad_name", "the name is too long");
  const strength = input.strength?.replace(/\s+/g, " ").trim() || null;
  if (strength && [...strength].length > 40) throw new MedsError("bad_name", "the strength is too long");
  const drugId = matchDrug(typed, { maxDistance: 0 })?.drugId ?? null;
  const slots = sortSlots(input.slots.filter(isDaySlot));
  // a reminder time outside its part of the day is refused before anything is written (400 bad_time)
  if (isAccount(session) && input.times) checkAskedTimes(input.times, slots);
  if (input.medId) return typedLabelFor(input, { store, pub, session, typed, strength, drugId, slots });
  const keepTimes = () => (isAccount(session) && slots.length && input.times ? keepAskedTimes(store, session, slots, input.times) : Promise.resolve(session));
  const visible = await medsNow(store, session);
  if (isAccount(session)) {
    // a medicine of his waits for its label: the typed label is held against it like a photographed one
    const waiting = waitingMatch({ visible, drugId, nameText: typed, origin: input.origin, other: input.other === true, locale: input.locale });
    if (waiting) return typedLabelFor({ ...input, medId: waiting.id }, { store, pub, session, typed, strength, drugId, slots });
  }
  const same = visible.find((m) => m.origin === input.origin && (drugId ? m.drug_id === drugId : sameName((m.label as StoredLabel | null)?.drug_text, typed)));
  if (same) throw new MedsError("med_exists", "this medicine is on the list already", { med_id: same.id });
  const label: StoredLabel = {
    text: typed,
    drug: drugId,
    strength,
    directions: null,
    dispensed: null,
    clinic: null,
    photo_fixture: null,
    photo_path: null,
    drug_text: typed,
    slots: null,
    indication: null,
    read_by: "patient",
    question_id: null,
    confirmed_day: session.story_day,
    typed: true,
  };
  await keepTimes();
  const med = await store.upsertMed(input.sessionId, {
    id: newMedId(await store.listMeds(input.sessionId), drugId),
    origin: input.origin,
    status: "unverified",
    drug_id: drugId,
    label,
    start_day: session.story_day,
    prescribed_visit_id: null,
    note: null,
    pharmacist_answer: null,
    dose_slots: slots.length ? slots : null,
    dose_slots_source: slots.length ? "patient" : null,
    // C2 track J (filming): on the account's own clock (real time for every account that is not filming)
    start_at: scopeNowIso(session),
  });
  const name = medFullName(med, input.locale);
  pub(input.sessionId, "med.changed", `Mr Tan typed in a medicine himself: ${drugId ?? "not a kb name"} (${input.origin.replace("_", "-")}), not checked`, {
    kind: "manual",
    med,
  });
  return { med, name };
}

/** His typed label for a medicine already on his list (addManualMed with medId). */
async function typedLabelFor(
  input: ManualInput,
  x: { store: Store; pub: Publisher; session: Awaited<ReturnType<typeof sessionOrThrow>>; typed: string; strength: string | null; drugId: string | null; slots: DaySlot[] },
): Promise<{ med: MedicationRow; name: string }> {
  const { store, pub, session, typed, strength, drugId, slots } = x;
  const target = await store.getMed(input.sessionId, input.medId!);
  if (!target) throw new MedsError("med_not_found", `no medicine ${input.medId}`);
  if (target.drug_id && target.drug_id !== drugId) {
    // the name he typed is not the prescribed medicine's: nothing is written to it; his question for the pharmacist
    const prescribed = medDisplayName(target, input.locale);
    const evidence = `label_mismatch:${target.id}`;
    const questions: QuestionRow[] = [];
    const open = (await store.listQuestions(input.sessionId)).find((q) => q.evidence === evidence && q.status === "open");
    if (open) questions.push(open);
    else {
      const q = await store.addQuestion(input.sessionId, { for: "pharmacist", origin: "own", text: mismatchQuestionText(input.locale, typed, prescribed), lang: input.locale, created_day: session.story_day, evidence });
      questions.push(q);
      pub(input.sessionId, "question.created", `The typed label does not name the prescribed ${prescribed}: a question for the pharmacist`, { question: q });
    }
    throw new MedsError("label_mismatch", "this label is for a different medicine", { expected: target.drug_id, read: drugId, questions });
  }
  const previous = (target.label ?? null) as StoredLabel | null;
  const label: StoredLabel = {
    text: typed,
    drug: target.drug_id ?? drugId,
    strength,
    directions: null,
    dispensed: null,
    clinic: null,
    photo_fixture: null,
    photo_path: null,
    drug_text: typed,
    slots: null,
    indication: null,
    read_by: "patient",
    question_id: previous?.question_id ?? null,
    confirmed_day: session.story_day,
    typed: true,
  };
  if (isAccount(session) && slots.length && input.times) await keepAskedTimes(store, session, slots, input.times);
  const med = await store.updateMed(input.sessionId, target.id, {
    label,
    status: "unverified",
    drug_id: target.drug_id ?? drugId,
    ...(target.start_day === null ? { start_day: session.story_day } : {}),
    dose_slots: slots.length ? slots : null,
    dose_slots_source: slots.length ? "patient" : null,
    // from now on (the account's own clock); a medicine he already takes keeps the moment it became his
    start_at: target.start_at && target.status !== "awaiting_label" ? target.start_at : scopeNowIso(session),
  });
  const name = medFullName(med, input.locale);
  pub(input.sessionId, "med.changed", `Mr Tan typed in the label of ${med.drug_id ?? "a medicine"} himself (no photo read), not checked`, { kind: "manual", med, for_med: true });
  return { med, name };
}

// ---------------------------------------------------------------- an unidentified medicine: what he does with it (C2)

/** His question for the doctor when he brings the box (one tap, real-app 12 / e2e-chains 6.1): his words, a fixed frame. */
export function bringToDoctorText(locale: Locale, name: string): string {
  return locale === "en" ? `I brought this box for the doctor to see: “${name}”. Can I take it?` : `我带了这盒药给医生看：「${name}」。可以吃吗？`;
}

/**
 * 「没在吃」 / 「带去给医生看」 on a medicine nobody identified: his own status, the app judges nothing. 「带去给医生看」 also
 * puts his question for the doctor on the list in the same tap (the question list's own rules: never a second row for
 * the same words; lib/profile/questions.ts). null clears the status (the question stays his).
 */
export async function setMedPatientStatus(
  input: { sessionId: string; medId: string; status: PatientMedStatus | null; locale: Locale },
  deps: MedsDeps,
): Promise<{ med: MedicationRow; question: QuestionRow | null }> {
  const store = deps.store;
  const pub = deps.publish ?? defaultPublish;
  const session = await sessionOrThrow(store, input.sessionId);
  const med = await store.getMed(input.sessionId, input.medId);
  if (!med) throw new MedsError("med_not_found", `no medicine ${input.medId}`);
  if (med.drug_id || med.status !== "unidentified") throw new MedsError("not_unidentified", "only a medicine nobody identified has these choices");
  const label = (med.label ?? { text: "" }) as StoredLabel;
  let question: QuestionRow | null = null;
  if (input.status === "bring_to_doctor") {
    const name = label.drug_text?.trim() || mt(input.locale, "name.unknown");
    const out = await addQuestionFor(store, session, { for: "doctor", origin: "own", text: bringToDoctorText(input.locale, name), lang: input.locale, evidence: `bring_to_doctor:${med.id}` });
    question = out.question;
  }
  const updated = await store.updateMed(input.sessionId, med.id, {
    label: {
      ...label,
      patient_status: input.status,
      // C2 track J (filming): on the account's own clock
      patient_status_at: scopeNowIso(session),
      ...(question ? { doctor_question_id: question.id } : {}),
    } as StoredLabel,
  });
  pub(input.sessionId, "med.changed", `Mr Tan says about "${label.drug_text ?? "?"}": ${input.status ?? "no status"}`, { kind: "patient_status", med: updated, status: input.status });
  return { med: updated, question };
}

// ---------------------------------------------------------------- relabel

export async function relabelMed(input: { sessionId: string; medId: string }, deps: MedsDeps): Promise<MedicationRow> {
  const store = deps.store;
  const pub = deps.publish ?? defaultPublish;
  await sessionOrThrow(store, input.sessionId);
  const med = await store.getMed(input.sessionId, input.medId);
  if (!med) throw new MedsError("med_not_found", `no medicine ${input.medId}`);
  if (!med.drug_id) throw new MedsError("cannot_relabel", "an unidentified medicine has no label to confirm");
  if (med.status === "awaiting_label") return med;
  const updated = await store.updateMed(input.sessionId, med.id, { status: "awaiting_label" });
  pub(input.sessionId, "med.changed", `${medFullName(med, "en")}: new label to photograph, awaiting label`, { kind: "label.relabel", med: updated });
  return updated;
}

export { LABEL_OK };
