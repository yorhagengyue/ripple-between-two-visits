/**
 * The pharmacist's later answer to an unknown-medicine question (task M3 item 4: 药剂师后来的回答（D12 录音）能对回
 * 这条问题). The patient points at the line in the visit recording that answered it; the question keeps that line
 * word for word (answer_text) with its utterance id, visit and speaker, and the medicine keeps it as
 * pharmacist_answer once the pharmacist is confirmed as the speaker.
 *
 * Which question belongs to a medicine: the one its label raised (label.question_id, written by confirmLabel), or
 * for the seeded box, the unknown-medicine question whose recorded answer is the medicine's pharmacist_answer.
 *
 * Which lines may answer it: lines from the visits where the person the question is for works (a question for
 * the pharmacist: pharmacy visits; for the doctor: clinic visits), after the day the question was raised (a
 * pharmacy visit on that same day counts for a question for the pharmacist), up to the story day. His own and his
 * family's confirmed lines are left out. Lines come from the visit transcript in the store (M2). While M2 has not
 * written one for that visit and speech is the mock provider (or the developer tools' stand-in, devfake), the replay
 * transcript web/fixtures/visits/<visit>.utterances.json is the transcript.
 *
 * Who said it (web-app.md section 8: a medication sentence never becomes "the pharmacist said" by inference): a
 * clinician role confirmed in the store (his post-visit review); otherwise the speaker he names himself when he
 * links the line (only a role that works at that kind of visit), or nobody (null) when he says he is not sure; when
 * he names nobody at all (an API call without `speaker`), the speaker the question already records for this same
 * line, or nobody. The kind of visit never decides the speaker.
 * With no speaker, lib/safety gives the answer no attribution: the card's chip reads "recording", and a line that
 * tells him to take or stop a medicine fails the safety checks and is not shown. Server-only.
 */
import { publish as busPublish } from "@/lib/bus";
import { replayIdForAudioFixture } from "@/lib/asr/fixtures";
import { FIXTURE_UTTERANCES } from "@/lib/safety/candidates";
import { StoreError, type MedicationRow, type Patch, type QuestionRow, type Store, type UtteranceRole, type VisitRow } from "@/lib/store/types";
import { MedsError } from "./errors";
import type { AnswerChoice, AnswerSpeaker, StoredLabel } from "./types";
import type { Publisher } from "./write";

type Env = Record<string, string | undefined>;

const CLINICIANS: UtteranceRole[] = ["doctor", "dispenser", "pharmacist"];

function clinician(role: UtteranceRole | null | undefined): AnswerSpeaker | null {
  return role && CLINICIANS.includes(role) ? (role as AnswerSpeaker) : null;
}

/** Who works at this kind of visit, i.e. whom he may name as the speaker of one of its lines. */
export function speakersAt(visit: Pick<VisitRow, "kind">): AnswerSpeaker[] {
  return visit.kind === "pharmacy" ? ["pharmacist"] : ["doctor", "dispenser"];
}

/** A visit where the question's addressee works, after the question was raised (see the header). */
export function visitAnswersQuestion(visit: Pick<VisitRow, "kind" | "day">, question: Pick<QuestionRow, "for" | "created_day">): boolean {
  const pharmacy = visit.kind === "pharmacy";
  if ((question.for === "pharmacist") !== pharmacy) return false;
  const from = question.created_day ?? 0;
  return visit.day > from || (visit.day === from && pharmacy);
}

/**
 * SPEECH_PROVIDER unset, mock, or the developer tools' stand-in devfake (C2: it replays the same files as mock): the
 * replay transcript stands in for a visit with no stored transcript. A real transcription service (whisper, trtc) never.
 */
export function fixtureTranscriptAllowed(env: Env = process.env): boolean {
  const p = (env.SPEECH_PROVIDER ?? "").trim().toLowerCase();
  return p === "" || p === "mock" || p === "devfake";
}

export function questionForMed(med: MedicationRow, questions: QuestionRow[]): QuestionRow | null {
  const qid = (med.label as StoredLabel | null)?.question_id;
  if (qid) return questions.find((q) => q.id === qid) ?? null;
  const answer = med.pharmacist_answer?.text?.trim();
  if (med.status === "unidentified" && answer) {
    return questions.find((q) => q.origin === "unidentified_medicine" && q.answer_text?.trim() === answer) ?? null;
  }
  return null;
}

interface Line {
  id: string;
  text: string;
  t_start_ms: number;
  role: UtteranceRole | null;
  confirmed: boolean;
}

async function visitLines(store: Store, sessionId: string, visit: Pick<VisitRow, "id" | "audio_fixture">, env: Env): Promise<Line[]> {
  const visitId = visit.id;
  // M2 marks transcript lines replaced by the full-recording pass with lang "x-superseded" (web/PROGRESS.md, M2)
  const stored = (await store.listUtterances(sessionId, visitId)).filter((u) => u.lang !== "x-superseded");
  if (stored.length > 0) {
    return stored.map((u) => ({ id: u.id, text: u.text, t_start_ms: u.t_start_ms, role: u.role, confirmed: u.role_state === "confirmed" }));
  }
  if (!fixtureTranscriptAllowed(env)) return [];
  // the replay file stands in only for a visit whose own audio_fixture names it (the story's visits, the example's
  // samples), never because a visit is called "p1" (real-app H6: replays go by visit.audio_fixture alone)
  if (replayIdForAudioFixture(visit.audio_fixture) !== visitId) return [];
  return (FIXTURE_UTTERANCES[visitId] ?? []).map((u) => ({ id: u.id, text: u.text, t_start_ms: u.t_start_ms, role: null, confirmed: false }));
}

/**
 * Lines that may answer a question that is open (or answered with nobody named as the speaker): from the visits
 * where its addressee works, after the question was raised, up to the story day (visitAnswersQuestion); his own and
 * his family's confirmed lines are left out. Each line carries its confirmed clinician speaker (or null) and whom
 * he may name as its speaker.
 */
export async function answerChoices(
  store: Store,
  sessionId: string,
  question: QuestionRow,
  day: number,
  env: Env = process.env,
): Promise<AnswerChoice[]> {
  // open, or answered with nobody named as the speaker: he may pick the line again and say who said it
  if (question.status === "skipped" || (question.status === "answered" && clinician(question.answer_speaker))) return [];
  const visits = (await store.listVisits(sessionId)).filter((v) => v.day <= day && visitAnswersQuestion(v, question));
  const out: AnswerChoice[] = [];
  for (const v of visits) {
    const speakerOptions = speakersAt(v);
    for (const l of await visitLines(store, sessionId, v, env)) {
      if (l.confirmed && (l.role === "patient" || l.role === "family")) continue;
      out.push({
        visitId: v.id,
        visitDate: v.date,
        utteranceId: l.id,
        text: l.text,
        tStartMs: l.t_start_ms,
        speaker: l.confirmed ? clinician(l.role) : null,
        speakerOptions,
      });
    }
  }
  return out;
}

export interface LinkInput {
  sessionId: string;
  /** the medicine whose question is answered */
  medId?: string;
  /** or the question directly */
  questionId?: string;
  visitId: string;
  utteranceId: string;
  /**
   * who said it, as he names it; only a role that works at that kind of visit. null: he is not sure. Omitted: the
   * speaker the question already records for this same line, if any.
   */
  speaker?: AnswerSpeaker | null;
}

export interface LinkDeps {
  /** the request subject's scoped store (lib/subject), or a test's store */
  store: Store;
  publish?: Publisher;
  env?: Env;
}

export async function linkAnswer(input: LinkInput, deps: LinkDeps): Promise<{ question: QuestionRow; med: MedicationRow | null }> {
  const store = deps.store;
  const pub: Publisher = deps.publish ?? ((sid, type, say, data) => void busPublish(sid, type, say, data));
  const env = deps.env ?? process.env;
  const { sessionId } = input;
  const session = await store.getSession(sessionId);
  if (!session) throw new StoreError("session_not_found", `No session ${sessionId}`);

  let med: MedicationRow | null = null;
  let question: QuestionRow | null = null;
  if (input.medId) {
    med = await store.getMed(sessionId, input.medId);
    if (!med) throw new MedsError("med_not_found", `no medicine ${input.medId}`);
    question = questionForMed(med, await store.listQuestions(sessionId));
  } else if (input.questionId) {
    question = await store.getQuestion(sessionId, input.questionId);
  }
  if (!question) throw new MedsError("no_question", "no question to answer");

  const visit = await store.getVisit(sessionId, input.visitId);
  if (!visit) throw new MedsError("visit_not_found", `no visit ${input.visitId}`);
  if (visit.day > session.story_day) throw new MedsError("visit_not_yet", `visit ${visit.id} is on day ${visit.day}; the story is on day ${session.story_day}`);
  if (!visitAnswersQuestion(visit, question)) {
    throw new MedsError("visit_not_for_question", `visit ${visit.id} (${visit.kind}, day ${visit.day}) is not where the ${question.for} answers question ${question.id}`);
  }

  const line = (await visitLines(store, sessionId, visit, env)).find((l) => l.id === input.utteranceId);
  if (!line) throw new MedsError("utterance_not_found", `no line ${input.utteranceId} in visit ${visit.id}`);
  if (line.confirmed && (line.role === "patient" || line.role === "family")) {
    throw new MedsError("not_an_answer", `line ${line.id} is confirmed as the ${line.role}'s own words`);
  }

  const picked = input.speaker;
  if (picked && !speakersAt(visit).includes(picked)) {
    throw new MedsError("speaker_not_at_visit", `a ${picked} does not speak at a ${visit.kind} visit`);
  }
  const confirmedRole = line.confirmed ? clinician(line.role) : null;
  const sameRecord = question.answer_text?.trim() === line.text.trim() && question.answer_visit_id === visit.id;
  const recorded = sameRecord ? clinician(question.answer_speaker) : null;
  const speaker: AnswerSpeaker | null = confirmedRole ?? (picked === undefined ? recorded : picked);

  question = await store.updateQuestion(sessionId, question.id, {
    status: "answered",
    answer_text: line.text,
    answer_utterance_id: line.id,
    answer_visit_id: visit.id,
    answer_speaker: speaker,
  });
  pub(sessionId, "question.updated", `Answer linked from visit ${visit.id} (${line.id}, ${speaker ?? "speaker not confirmed"}): "${line.text.slice(0, 80)}"`, {
    question,
  });

  if (med) {
    const patch: Patch<MedicationRow> = {};
    // the medicine remembers its question by id, so it is found again whatever the answer says
    const label = med.label as StoredLabel | null;
    if (label && label.question_id !== question.id) patch.label = { ...label, question_id: question.id } as StoredLabel;
    // it keeps the pharmacist's answer only when the pharmacist is confirmed as the speaker
    if (question.for === "pharmacist") {
      const pharmacistAnswer = speaker === "pharmacist" ? { visit_id: visit.id, text: line.text } : null;
      const unchanged = med.pharmacist_answer?.visit_id === pharmacistAnswer?.visit_id && med.pharmacist_answer?.text === pharmacistAnswer?.text;
      if (!unchanged) patch.pharmacist_answer = pharmacistAnswer;
    }
    if (Object.keys(patch).length > 0) {
      med = await store.updateMed(sessionId, med.id, patch);
      const say = speaker === "pharmacist" ? `pharmacist's answer saved from visit ${visit.id}` : `answer from visit ${visit.id} saved (speaker: ${speaker ?? "not confirmed"})`;
      pub(sessionId, "med.changed", `${med.id}: ${say}`, { kind: "answer.linked", med });
    }
  }
  return { question, med };
}
