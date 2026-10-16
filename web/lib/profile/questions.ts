/**
 * His question list as he keeps it (journey 07 「他能自己加、改、跳过问题」, journeys 14 and 22; real-app 2.11;
 * e2e-chains 序 2). Track C. Server-only.
 *
 *   addQuestionFor   a question goes on his list: his own (「加一个问题」), or one another module raises for him (a
 *                    prevention item, a watch pattern, his chat), or one a family member puts there from her 「留意」
 *                    (lib/care/family-questions.ts: the row then says who, asked_by_user_id, and his list shows
 *                    「家人加的」). The same words already there are never a second row:
 *                    an open one is reused (merged), a skipped one is put back, one the doctor already answered is
 *                    handed back with that answer (C2 architecture review: 再问一遍医生已经回答过的问题 → 直接给医生的回答).
 *   changeQuestion   his changes: new words (edited_at, so the list shows them as his own), 「不问了」 (skipped),
 *                    「放回去」 (open again; undoes a merge too), 「合并」 a duplicate into another question (skipped,
 *                    merged_into). Pattern questions keep Ripple's wording (it is rewritten from his log), answered
 *                    questions keep the words the doctor answered.
 *   questionList     the list his page shows: what is still to ask first, the doctor's or pharmacist's answer word for
 *                    word with its date and time point in the recording, what he set aside last; merged rows left out;
 *                    duplicates of an earlier open question marked so he can merge them with one tap.
 *
 * Nothing here words a clinical sentence: the list holds his words, Ripple's pattern wording (lib/daily/patterns.ts)
 * and the clinicians' recorded answers (verbatim, lib/daily/questions.ts). No day number leaves this module in text:
 * dates are real dates (d0 + day).
 */
import { publish } from "@/lib/bus";
import { fixtureClipPath, fixtureUtterances, isStandInClip, replayIdForAudioFixture } from "@/lib/asr/fixtures";
import { d0Of } from "@/lib/daily/doses";
import { answerMoment, answerVisible, questionsView } from "@/lib/daily/questions";
import type { LineChip, QuestionItemView } from "@/lib/daily/types";
import type { Locale } from "@/lib/i18n";
import { detectLang, normalizeForCompare } from "@/lib/safety/text";
import type { QuestionFor, QuestionOrigin, QuestionRow, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { scopedUrl } from "@/lib/subject/url";
import { nowIso } from "@/lib/time/now";

export const QUESTION_TEXT_MAX = 300;

/** Origins other modules may add through addQuestionFor (Ripple's refused / pattern / before-you-go have their own). */
export const ADDABLE_ORIGINS = ["own", "preventive", "watch_pattern", "chat", "understanding_check"] as const;
export type AddableOrigin = (typeof ADDABLE_ORIGINS)[number];
/**
 * Origins only a server module puts on his list (never a request's own origin: POST /api/questions takes
 * ADDABLE_ORIGINS): "reading", a question Ripple wrote from a reading outside his doctor's target and his words about
 * that day (lib/daily/bp-reason.ts; owner 10-15).
 */
export const MODULE_ORIGINS = ["reading"] as const;
export type ModuleOrigin = (typeof MODULE_ORIGINS)[number];

/** The words of a question for "is it the same question?": NFKC, lower case, no spaces or punctuation. */
export function questionKey(text: string): string {
  return normalizeForCompare(text);
}

type Publisher = (scopeId: string, type: "question.created" | "question.updated", say: string, data: unknown) => void;

/**
 * A question row as an event may carry it: which family member asked is her account's id and goes to no page (his
 * stream sends an event's data as it is); that it came from family does.
 */
function rowForEvent(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("asked_by_user_id" in value)) return value;
  const { asked_by_user_id: by, ...rest } = value as QuestionRow;
  return by ? { ...rest, from_family: true } : rest;
}
const defaultPublish: Publisher = (sid, type, say, data) =>
  void publish(sid, type, say, typeof data === "object" && data !== null ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, rowForEvent(v)])) : data);

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------- add

export interface AddQuestionInput {
  /** who to ask; default the doctor */
  for?: QuestionFor;
  /** his words, as he typed or said them */
  text: string;
  /** default "own" */
  origin?: AddableOrigin | ModuleOrigin;
  /** default: detected from the words */
  lang?: string | null;
  /** why another module raised it (a prevention item id, a watch pattern's facts); never shown as his words */
  evidence?: string | null;
  /** the family member who put it on his list (her user id); absent: he did, or Ripple for him */
  askedByUserId?: string | null;
}

/** created: a new row; merged: the same open question; reopened: the same question he had set aside; answered: already answered. */
export type AddOutcome = "created" | "merged" | "reopened" | "answered";

export interface AddQuestionResult {
  question: QuestionRow;
  outcome: AddOutcome;
}

export class QuestionInputError extends Error {
  constructor(readonly code: "text_empty" | "text_too_long" | "origin_not_addable") {
    super(code);
    this.name = "QuestionInputError";
  }
}

/** The text as stored: trimmed, inner runs of whitespace kept as one space. */
export function cleanQuestionText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) throw new QuestionInputError("text_empty");
  if ([...t].length > QUESTION_TEXT_MAX) throw new QuestionInputError("text_too_long");
  return t;
}

/** Is the recorded answer said by now (a demo's seeded answer from a later visit is not)? One read of the moment. */
async function answeredNow(store: Store, scope: SessionRow, rows: QuestionRow[], visits: VisitRow[]): Promise<Set<string>> {
  const answered = rows.filter((q) => q.status === "answered" && q.answer_text);
  if (!answered.length) return new Set();
  const moment = await answerMoment(store, scope, visits, answered);
  return new Set(answered.filter((q) => answerVisible(q, visits, moment)).map((q) => q.id));
}

/**
 * Put a question on his list (his own, or raised for him by another module), without ever making a second row for
 * the same words to the same person. `scope` is the subject's scope row (its id names the scope; never a row's
 * session_id). Publishes question.created, or question.updated with reused: true.
 */
export async function addQuestionFor(store: Store, scope: SessionRow, input: AddQuestionInput, opts: { publish?: Publisher } = {}): Promise<AddQuestionResult> {
  const pub = opts.publish ?? defaultPublish;
  const origin = input.origin ?? "own";
  if (![...ADDABLE_ORIGINS, ...MODULE_ORIGINS].includes(origin)) throw new QuestionInputError("origin_not_addable");
  const text = cleanQuestionText(input.text);
  const who: QuestionFor = input.for ?? "doctor";
  const key = questionKey(text);
  const [rows, visits] = await Promise.all([store.listQuestions(scope.id), store.listVisits(scope.id)]);
  const same = rows.filter((q) => q.for === who && !q.merged_into && questionKey(q.text) === key);

  if (same.length) {
    const said = await answeredNow(store, scope, same, visits);
    const answered = same.find((q) => said.has(q.id));
    if (answered) return { question: answered, outcome: "answered" };
    const open = same.find((q) => q.status === "open" || q.status === "answered");
    if (open) {
      pub(scope.id, "question.updated", `Already on his questions for the ${who}: "${short(open.text)}"`, { question: open, reused: true });
      return { question: open, outcome: "merged" };
    }
    const skipped = same.find((q) => q.status === "skipped");
    if (skipped) {
      const row = await store.updateQuestion(scope.id, skipped.id, { status: "open" });
      pub(scope.id, "question.updated", `Back on his questions for the ${who}: "${short(row.text)}"`, { question: row, reused: true });
      return { question: row, outcome: "reopened" };
    }
  }

  const row = await store.addQuestion(scope.id, {
    for: who,
    origin: origin as QuestionOrigin,
    text,
    lang: input.lang ?? detectLang(text),
    evidence: input.evidence ?? null,
    ...(input.askedByUserId ? { asked_by_user_id: input.askedByUserId } : {}),
  });
  pub(scope.id, "question.created", `Added to his questions for the ${who}: "${short(text)}"`, { question: row });
  return { question: row, outcome: "created" };
}

// ---------------------------------------------------------------- change

export type QuestionChange = { kind: "edit"; text: string } | { kind: "skip" } | { kind: "reopen" } | { kind: "merge"; into: string };

export type ChangeErrorCode =
  | "not_found"
  | "merged"
  | "answered"
  | "pattern_words"
  | "same_question"
  | "other_person"
  | "into_not_found"
  | "into_merged"
  | "into_skipped";

export type ChangeResult = { ok: true; question: QuestionRow; into?: QuestionRow } | { ok: false; status: 404 | 409; error: ChangeErrorCode };

const refuse = (status: 404 | 409, error: ChangeErrorCode): ChangeResult => ({ ok: false, status, error });

/** His change to one question on his list. Publishes question.updated. Text problems throw QuestionInputError. */
export async function changeQuestion(store: Store, scope: SessionRow, id: string, change: QuestionChange, opts: { publish?: Publisher; now?: () => string } = {}): Promise<ChangeResult> {
  const pub = opts.publish ?? defaultPublish;
  const stamp = opts.now ?? nowIso;
  const q = await store.getQuestion(scope.id, id);
  if (!q) return refuse(404, "not_found");

  if (change.kind === "reopen") {
    if (q.status === "answered") return refuse(409, "answered");
    if (q.status === "open" && !q.merged_into) return { ok: true, question: q };
    const row = await store.updateQuestion(scope.id, id, { status: "open", merged_into: null });
    pub(scope.id, "question.updated", `He put a question back on his list: "${short(row.text)}"`, { question: row });
    return { ok: true, question: row };
  }

  if (q.merged_into) return refuse(409, "merged");
  if (q.status === "answered") return refuse(409, "answered");

  if (change.kind === "skip") {
    if (q.status === "skipped") return { ok: true, question: q };
    const row = await store.updateQuestion(scope.id, id, { status: "skipped" });
    pub(scope.id, "question.updated", `He set a question aside: "${short(row.text)}"`, { question: row });
    return { ok: true, question: row };
  }

  if (change.kind === "edit") {
    if (q.origin === "pattern" || q.origin === "watch_pattern") return refuse(409, "pattern_words");
    const text = cleanQuestionText(change.text);
    if (text === q.text) return { ok: true, question: q };
    const row = await store.updateQuestion(scope.id, id, { text, lang: detectLang(text), edited_at: stamp() });
    pub(scope.id, "question.updated", `He changed the words of a question: "${short(text)}"`, { question: row });
    return { ok: true, question: row };
  }

  // merge this one into another: it is set aside, pointing at the one he keeps
  if (q.status !== "open") return refuse(409, "into_skipped");
  if (change.into === id) return refuse(409, "same_question");
  const into = await store.getQuestion(scope.id, change.into);
  if (!into) return refuse(404, "into_not_found");
  if (into.merged_into) return refuse(409, "into_merged");
  if (into.status === "skipped") return refuse(409, "into_skipped");
  if (into.for !== q.for) return refuse(409, "other_person");
  const row = await store.updateQuestion(scope.id, id, { status: "skipped", merged_into: into.id });
  // anything folded into this one now points at the one he keeps
  for (const other of await store.listQuestions(scope.id)) {
    if (other.merged_into === id) await store.updateQuestion(scope.id, other.id, { merged_into: into.id });
  }
  pub(scope.id, "question.updated", `He merged a question into another one: "${short(into.text)}"`, { question: row, merged_into: into.id });
  return { ok: true, question: row, into };
}

// ---------------------------------------------------------------- the list

/** A clinician's recorded answer, word for word, with where and when it was said. */
export interface ListAnswer {
  text: string;
  lang: string;
  /** who said it ("doctor", "pharmacist", "dispenser"), or "recording" when the speaker is not known */
  speaker: LineChip["kind"];
  /** the speaker is Ripple's inference, not confirmed by him */
  inferred: boolean;
  /** the visit's real date */
  date: string | null;
  /** where in the recording, ms; null when not known */
  tStartMs: number | null;
  /** the clip to listen to, or null */
  clipUrl: string | null;
  /** the clip is a stand-in voice */
  standIn: boolean;
  visitId: string;
}

export interface ListQuestion {
  id: string;
  for: QuestionFor;
  origin: QuestionOrigin;
  /** his words (or Ripple's wording of a pattern) */
  text: string;
  lang: string | null;
  wording: "own_words" | "recorded_summary" | "pattern";
  /** a recorded summary shown beside his own words */
  summary: { text: string; lang: string | null } | null;
  status: "open" | "answered" | "skipped";
  /** the real date it went on the list */
  createdDate: string | null;
  /** he changed the words himself */
  edited: boolean;
  canEdit: boolean;
  /** an earlier open question to the same person with the same words: he can merge this one into it */
  duplicateOf: string | null;
  /** a family member put it on his list (lib/care/family-questions.ts); who is not said */
  fromFamily: boolean;
  answer: ListAnswer | null;
}

export interface QuestionList {
  /** still to ask, in list order */
  open: ListQuestion[];
  /** answered at a visit */
  answered: ListQuestion[];
  /** set aside (not the merged ones) */
  skipped: ListQuestion[];
  counts: { open: number; doctor: number; pharmacist: number; answered: number; skipped: number };
}

/** Time point and clip of a seeded answer linked to a replay line (the example's answered questions). */
function replayLine(visit: Pick<VisitRow, "id" | "audio_fixture"> | undefined, utteranceId: string | null): { tStartMs: number; clip: string | null } | null {
  if (!visit || !utteranceId) return null;
  const replay = replayIdForAudioFixture(visit.audio_fixture);
  const line = replay ? fixtureUtterances(replay)?.find((u) => u.id === utteranceId) : undefined;
  if (!line) return null;
  return { tStartMs: line.t_start_ms, clip: fixtureClipPath(line.id) };
}

function answerOf(item: QuestionItemView, row: QuestionRow | undefined, visits: VisitRow[], scope: SessionRow): ListAnswer | null {
  const a = item.answer;
  if (!a) return null;
  const visit = visits.find((v) => v.id === a.visitId);
  let tStartMs = a.tStartMs ?? a.chip.tStartMs ?? null;
  let clipUrl = a.clipUrl;
  let standIn = !!a.chip.standInVoice;
  if (tStartMs === null) {
    const line = replayLine(visit, row?.answer_utterance_id ?? null);
    if (line) {
      tStartMs = line.tStartMs;
      if (!clipUrl && line.clip && row?.answer_utterance_id) {
        clipUrl = scopedUrl(scope, `/api/visits/${encodeURIComponent(a.visitId)}/clip?u=${encodeURIComponent(row.answer_utterance_id)}`);
        standIn = isStandInClip(line.clip);
      }
    }
  }
  return {
    text: a.text,
    lang: detectLang(a.text),
    speaker: a.chip.kind,
    inferred: !!a.chip.inferred,
    date: a.date || a.chip.date || visit?.date || null,
    tStartMs,
    clipUrl: clipUrl ?? null,
    standIn,
    visitId: a.visitId,
  };
}

/** The list his page shows (and GET /api/questions answers). */
export async function questionList(store: Store, scope: SessionRow, locale: Locale): Promise<QuestionList> {
  const [view, rows, visits] = await Promise.all([questionsView(store, scope, locale), store.listQuestions(scope.id), store.listVisits(scope.id)]);
  const byId = new Map(rows.map((q) => [q.id, q]));
  const d0 = d0Of(scope);
  const items: ListQuestion[] = [];
  for (const item of [...view.doctor, ...view.pharmacist]) {
    const row = byId.get(item.id);
    if (row?.merged_into) continue;
    const edited = !!row?.edited_at;
    const pattern = item.wording === "pattern" || item.origin === "pattern" || item.origin === "watch_pattern";
    items.push({
      id: item.id,
      for: item.for,
      origin: item.origin,
      text: edited && row ? row.text : item.text,
      lang: edited && row ? row.lang : item.lang,
      wording: edited ? "own_words" : item.wording,
      summary: edited ? null : item.summary,
      status: item.status,
      createdDate: item.createdDay === null ? null : storyDate(d0, item.createdDay),
      edited,
      canEdit: item.status === "open" && !pattern,
      duplicateOf: null,
      fromFamily: !!row?.asked_by_user_id,
      answer: item.status === "answered" ? answerOf(item, row, visits, scope) : null,
    });
  }
  // the list order: what is still to ask, doctor first, then pharmacist (questionsView keeps insertion order inside)
  const open = items.filter((q) => q.status === "open");
  const seen = new Map<string, string>();
  for (const q of open) {
    if (q.wording === "pattern") continue;
    const k = `${q.for}:${questionKey(q.text)}`;
    const first = seen.get(k);
    if (first) q.duplicateOf = first;
    else seen.set(k, q.id);
  }
  const answered = items.filter((q) => q.status === "answered");
  const skipped = items.filter((q) => q.status === "skipped");
  return {
    open,
    answered,
    skipped,
    counts: {
      open: open.length,
      doctor: open.filter((q) => q.for === "doctor").length,
      pharmacist: open.filter((q) => q.for === "pharmacist").length,
      answered: answered.length,
      skipped: skipped.length,
    },
  };
}

export type QuestionOut = Omit<QuestionRow, "session_id" | "evidence" | "created_day" | "asked_by_user_id"> & {
  created_date: string | null;
  /** a family member put it on his list; which one (asked_by_user_id) is not sent */
  from_family: boolean;
};

/** A question row as a response may carry it: no scope id, no internal evidence (which may name day numbers). */
export function questionOut(q: QuestionRow, scope: SessionRow): QuestionOut {
  const out: Record<string, unknown> = { ...q };
  for (const k of ["session_id", "evidence", "created_day", "asked_by_user_id"]) delete out[k];
  out.created_date = q.created_day === null ? null : storyDate(d0Of(scope), q.created_day);
  out.from_family = !!q.asked_by_user_id;
  return out as QuestionOut;
}

