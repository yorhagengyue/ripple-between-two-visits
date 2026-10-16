/**
 * The visit pipeline behind /api/visits/** and the realtime replay (server-only):
 *
 *   startVisit     consent step done: pick the visit row, status "recording", note the consent and its time
 *   processChunk   a chunk of finished sentences (one sentence in the replay, any size from a realtime
 *                  client): store, infer roles with the previous roles and last lines as context, extract
 *                  items, publish asr.final / utterance.role / card.created
 *   finalizeVisit  the whole-visit transcript is back: replace the live lines, roles and items in one pass,
 *                  cut per-sentence clips from the recording when the transcript came from the audio,
 *                  status "review". With a real main model (LLM_PROVIDER hunyuan / openai / replay) the model
 *                  also labels the whole transcript (model-extract.ts) and adds what the rules missed; the
 *                  model writes no text, and any failure leaves the rules' items
 *   confirmVisit   he marks his own lines and checks each item: roles become confirmed, answered questions
 *                  are written to his question list, status "confirmed"
 *   setItemVerdict one answer of the one-line-at-a-time review (C2): saved as he taps, and again after he confirmed
 *                  (an edit, kept in the item's history)
 *
 * C2 (real accounts, track F):
 *   - an account's recording is a new visit row with a full uuid, or today's planned follow-up he confirmed earlier
 *     (planned, no sample audio); its place is his clinic, or the pharmacy he chose; the doctor's answer to the consent
 *     card is a consent_record (granted or declined, the card's version and hash, the wall clock); the recording is
 *     kept RETAIN_DAYS unless he keeps it;
 *   - "not right" flags an item instead of deleting it (slots.disputed, a question for the doctor); a line with the
 *     warning line or 995 stays on the emergency path (never slots.rejected), every other one leaves the sources;
 *   - confirming a prescription puts the medicine on his list as awaiting its label (linked to the visit), and a
 *     follow-up he confirmed becomes a planned visit (accounts only; the demo's seed already has both);
 *   - a replay of a visit he already confirmed is written to a copy (lib/visit/happened.ts COPY_PREFIX): his labels
 *     never go back to "inferred";
 *   - at the pharmacy he never records onto today's planned clinic follow-up (real-app 2.12: where he is decides the
 *     visit's kind and who speaks);
 *   - no recording starts without the doctor's answer to the consent card in the request (consent_required); the
 *     doctor's yes found in the recording is kept twice: consent_utterance_id as before, and its own consent record
 *     (method "spoken", the sentence's id in its evidence) next to the tap's, once per visit; every record carries the
 *     card's version and hash (track H's lib/privacy/consents.ts consentStamp: the card is the registry's
 *     visit_recording text), and assisted = true with its note when someone helps him on his device (what the request
 *     says, else what sign-up recorded; the spoken record follows its visit's tap);
 *   - the example account's sample visit is said to be one: its events are marked `sample` ("sample recording");
 *   - without his consent to AI processing (lib/safety/consent.ts) the whole-visit record is made by the rules only:
 *     no model sees the transcript (the translation has the same gate, lib/visit/translate.ts).
 *
 * C2 round three:
 *   - how the record was made is kept with the visit (visit.ai_used, 0016_f_visit_made): the review's sentence about
 *     AI processing describes that visit, not his setting as it happens to be today;
 *   - an answer he changes away from 「是」 takes back what that 「是」 created, as long as nothing of his hangs on it
 *     (real-app 2.15, 12 「确认后还能改，改动留历史」): the prescription that still waits for its label leaves his list, the
 *     planned follow-up that is still only planned (and not on a day he booked himself) is no longer planned. The
 *     item's history says what was taken back; 「是」 again puts it back;
 *   - 「哪几句是我说的」 (real-app 2.15): one line whose speaker nobody could tell, marked as his own or given back
 *     (setLineMine), saved as he taps, before or after he confirmed.
 *
 * Ripple's summary (owner's decision of 10-14; lib/visit/ripple-summary.ts): processChunk hands every stored line of an
 * account's recording to the live notes (at most one model call per 15 s, in the background, with his consent and a live
 * model); finalizeVisit starts the final summary in the background once the record is made, kept with the visit as its
 * own item. That item is never one he answers: a verdict on it is refused (applyVerdicts), so it can never become a
 * confirmed source.
 *
 * Writes go through the Store; every change is published on the bus right after (the store never publishes). Every
 * entry point takes the store it may use: the request subject's scoped store (lib/subject).
 */
import { createHash, randomUUID } from "node:crypto";
import { fixtureClipPath, fixtureUtterances, type FileJobResult } from "@/lib/asr";
import { blobPrefix, getBlobStore } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { createMainLlm, mainProviderKind } from "@/lib/llm";
import { personSpendFor } from "@/lib/subject/usage";
import type { LlmClient } from "@/lib/llm/types";
import { newMedId } from "@/lib/meds/ids";
import { assistedEvidence, consentStamp } from "@/lib/privacy/consents";
import { aiConsent } from "@/lib/safety/consent";
import { StoreError, type MedicationRow, type QuestionRow, type RoleState, type SessionRow, type Store, type UtteranceRole, type UtteranceRow, type VisitItemRow, type VisitRow } from "@/lib/store";
import { isAccount, scopeClinic, scopeD0 } from "@/lib/store/scope";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import { nowIso } from "@/lib/time/now";
import { CONSENT_CARD_EN, CONSENT_CARD_VERSION, helpedOnDevice, RETAIN_DAYS } from "./consent";
import { devfakeExtractor } from "./devfake-extract";
import { extractItems, type ExtractLine, type ItemDraft } from "./extract";
import { alignToScript, fallbackAllowed, scriptFor } from "./fallback";
import { COPY_PREFIX, copiedFrom, isReplayCopy } from "./happened";
import { readOnce } from "./read-once";
import { extractWithModel, mergeDrafts } from "./model-extract";
import { inferRoles } from "./roles";
import { SUPERSEDED_LANG, clearVisitLive, visitLive } from "./state";
import { addDays, sameWords } from "./text";
import { translateVisitLines } from "./translate";
import { emergencyItem, verdictOf, type ItemVerdict } from "./verdict";
import type { CardView, VisitView } from "./types";
import { buildVisitView, liveItems, liveUtterances, priorPrescriptions, replayFixtureFor, warmVisitReads } from "./view";
import { openRecording } from "./recording-audio";
import { depsOr, noteVisitLines, resetLiveSummary, summaryGate, writeFinalSummary } from "./ripple-summary";
import { isSummaryItem } from "./summary-item";
// scene 1 (10-15): who is speaking, from the voice and the words together
import { addPrints, liveSpeakers, voiceOf, withSpeakerLock, type LiveSpeakers } from "./live-speakers";
import { combineRoles, type SpeakerVote, type SpeakerVoteRole } from "./speakers";
import { nameSpeakers, ruleVote, SPEAKER_BATCH, SPEAKER_CONTEXT_LINES, type SpeakerLine, type SpeakerPeople } from "./speaker-words";
import type { VoicePrint } from "./voiceprint";

export type VisitErrorCode =
  | "visit_not_found"
  | "visit_not_yet"
  | "no_replay"
  | "fallback_filming_only"
  | "fallback_locked"
  | "fallback_disabled"
  | "fallback_key_attempts"
  | "job_not_done"
  | "consent_required"
  | "not_planned"
  | "invalid";

export class VisitError extends Error {
  constructor(
    readonly code: VisitErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "VisitError";
  }
}

export interface IncomingUtterance {
  id?: string;
  t_start_ms: number;
  t_end_ms: number;
  speaker_cluster?: number | null;
  lang?: string | null;
  text: string;
  /**
   * The print of the line's voice (lib/visit/voiceprint.ts; null: too little speech), made by POST /api/asr/chunk from
   * the line's audio. On an account a chunk that carries one decides its speakers from the voices and the words of the
   * whole recording (lib/visit/speakers.ts); without it, as before (lib/visit/roles.ts).
   */
  voice?: VoicePrint | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function short(text: string, n = 60): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

async function mustVisit(s: Store, sessionId: string, visitId: string): Promise<VisitRow> {
  const v = await s.getVisit(sessionId, visitId);
  if (!v) throw new VisitError("visit_not_found");
  return v;
}

async function requiredRefs(s: Store, sessionId: string) {
  const rows = await s.listVisitItems(sessionId, { required_only: true });
  return { rows, refs: rows.map((r) => ({ text: r.text, speaker: r.speaker })) };
}

/** A fixture line's id ("v1-u08"). */
const FIXTURE_LINE = /^([a-z0-9]+)-u\d{2,3}$/;
/** The fixture line's id at the end of a line id ("v1-again-ab12cd-v1-u08" -> "v1-u08"). */
const FIXTURE_TAIL = /(?:^|-)([a-z0-9]+-u\d{2,3})$/;

/** A fixture stand-in clip only when the sentence really is that fixture line (same id and words). */
function standInClip(id: string, text: string): string | null {
  const m = FIXTURE_LINE.exec(id);
  if (!m) return null;
  const line = (fixtureUtterances(m[1]) ?? []).find((f) => f.id === id);
  if (!line || !sameWords(line.text, text)) return null;
  return fixtureClipPath(id);
}

// ------------------------------------------------------------------ start

export interface StartVisitInput {
  mode: "record" | "replay";
  /** replay: v1 / v2 / v3 / p1 */
  fixture?: string;
  /** `assisted` (an account): someone is helping him on his device right now; absent: what sign-up recorded */
  consent?: { given: boolean; at?: string; statement?: string; assisted?: boolean };
  /** an account's recording: at the clinic (default) or the pharmacy (real-app 2.12 「在哪里看？」) */
  place?: "clinic" | "pharmacy";
}

/** Where an account's visit is when he has not told the app his clinic (stored like the seed's English place names). */
export const DEFAULT_PLACE = { clinic: "Clinic", pharmacy: "Pharmacy" } as const;

/** sha256 (hex) of the consent card's English sentence: kept in every consent record. */
export function consentCardSha(): string {
  return createHash("sha256").update(CONSENT_CARD_EN, "utf8").digest("hex");
}

/** Today's planned follow-up an account records on: planned, with no sample audio (the example's v3 is played, not recorded). */
function plannedToday(visits: VisitRow[], day: number): VisitRow | null {
  return visits.find((v) => v.day === day && v.status === "planned" && !v.audio_fixture) ?? null;
}

/** He confirmed this visit's record here: a replay of it must not touch his labels (it goes to a copy). */
async function confirmedHere(s: Store, sessionId: string, visit: VisitRow): Promise<boolean> {
  if (visit.status !== "confirmed") return false;
  const lines = liveUtterances(await s.listUtterances(sessionId, visit.id));
  return lines.some((u) => u.role_state === "confirmed");
}

/**
 * C2 track E (real-app 12: 「重放一次已经确认过的看诊，不改原来那次的标签（回放写进一份副本）… /demo 上评委也会碰到」): in a demo
 * scope the seed's visits are his confirmed record with no transcript stored (the story's end state). One that already
 * happened in the story (an earlier story day) and was never replayed or recorded here is watched again in a copy too, so
 * its lines keep reading 医生说 on every screen while the replay runs and after it. On its own story day the replay is
 * the visit itself happening (the crew films it; the Day 42 visit of the demo): that one is written in place, as before.
 */
async function seedConfirmedBefore(s: Store, session: SessionRow, visit: VisitRow): Promise<boolean> {
  if (isAccount(session) || visit.status !== "confirmed" || visit.day >= session.story_day || isReplayCopy(visit)) return false;
  return liveUtterances(await s.listUtterances(session.id, visit.id)).length === 0;
}

/** A demo scope's replay copy (see seedConfirmedBefore): a re-watch, never the story's own record of that visit. */
function demoRewatch(session: Pick<SessionRow, "kind">, visit: Pick<VisitRow, "script_section">): boolean {
  return !isAccount(session) && isReplayCopy(visit);
}

/** A new visit row that replays `visit` again (a re-watch: lib/visit/happened.ts never counts it as a visit). */
async function replayCopy(s: Store, session: SessionRow, visit: VisitRow): Promise<VisitRow> {
  const account = isAccount(session);
  const id = account ? randomUUID() : `${visit.id}-again-${randomUUID().slice(0, 6)}`;
  return s.upsertVisit(session.id, {
    id,
    kind: visit.kind,
    place: visit.place,
    // an account's re-watch is today's; the demo's keeps the day (and date) of the visit it copies, so its screen is
    // worked out against the same records as that visit (the check cards, the question list, the medicines by then)
    day: account ? session.story_day : visit.day,
    ...(account ? {} : { date: visit.date }),
    status: "recording",
    script_section: `${COPY_PREFIX}${copiedFrom(visit) ?? visit.id}`,
    audio_fixture: visit.audio_fixture,
  });
}

/** The rows of his account a consent record needs: the request's own store, or the process store in a scheduled job. */
type ConsentStore = Pick<Store, "listConsentRecords" | "addConsentRecord">;

/**
 * One visit_recording record, complete (real-app 3.11): the version and sha256 of the card's text in force (track H's
 * registry, lib/privacy/consents.ts), how it was given, the evidence with the helper's note, assisted. The text row
 * itself is published by H's module (its hourly job and its own writer): this store may not write that global table.
 */
async function writeRecordingConsent(
  s: ConsentStore,
  session: SessionRow,
  input: { decision: "granted" | "declined"; method: "tap" | "spoken"; evidence: Record<string, unknown>; assisted: boolean },
): Promise<void> {
  const stamp = consentStamp("visit_recording", "en");
  await s.addConsentRecord({
    user_id: session.owner_user_id!,
    scope_id: session.id,
    kind: "visit_recording",
    decision: input.decision,
    version: stamp.version,
    text_sha256: stamp.text_sha256,
    method: input.method,
    evidence: { ...input.evidence, locale: stamp.locale, ...assistedEvidence(input.assisted) },
    assisted: input.assisted,
  });
}

/** An account's sample visit (the example's recorded visit, or a replay copy): never his own visit, and said so. */
export function isSampleVisit(session: Pick<SessionRow, "kind">, visit: Pick<VisitRow, "id" | "audio_fixture" | "script_section">): boolean {
  return isAccount(session) && (!!replayFixtureFor(visit) || isReplayCopy(visit));
}

/** The doctor said no to the consent card: an account keeps the decision (declined, the card's version and hash). */
export async function declineRecording(s: Store, session: SessionRow, input: { place?: "clinic" | "pharmacy"; assisted?: boolean } = {}): Promise<void> {
  if (!isAccount(session) || !session.owner_user_id) return; // the demo records nothing for a "no", as before
  await writeRecordingConsent(s, session, {
    decision: "declined",
    method: "tap",
    evidence: { place: input.place ?? "clinic", at: nowIso() },
    assisted: await helpedOnDevice(s, session.owner_user_id, input.assisted),
  });
  publish(session.id, "consent.recorded", "The doctor said no to recording: nothing was recorded", { kind: "visit_recording", decision: "declined" });
}

/**
 * The doctor's yes as it was said in the recording (real-app 2.12: 「录音里说出的同意那句照旧存 consent_utterance_id，另补一条
 * method = spoken」): its own consent record on an account, once per visit, next to the tap's. Only his own recording: a
 * sample replay's "yes" (the example's visit, a replay copy) is not his doctor's.
 */
async function recordSpokenConsent(s: ConsentStore, session: SessionRow, visit: VisitRow, utteranceId: string): Promise<void> {
  if (!isAccount(session) || !session.owner_user_id) return;
  if (isSampleVisit(session, visit)) return;
  const before = await s.listConsentRecords(session.owner_user_id, { kind: "visit_recording" });
  const ofVisit = before.filter((r) => (r.evidence as { visit_id?: unknown } | null)?.visit_id === visit.id);
  if (ofVisit.some((r) => r.method === "spoken")) return;
  // the same visit's tap says whether someone was helping him then; a visit without one: what sign-up recorded
  const tap = ofVisit.find((r) => r.method === "tap");
  await writeRecordingConsent(s, session, {
    decision: "granted",
    method: "spoken",
    evidence: { visit_id: visit.id, utterance_id: utteranceId, at: nowIso() },
    assisted: tap ? tap.assisted === true : await helpedOnDevice(s, session.owner_user_id),
  });
  publish(session.id, "consent.recorded", "The yes to recording was heard in the recording itself: kept as its own consent record", {
    kind: "visit_recording",
    decision: "granted",
    method: "spoken",
    visit_id: visit.id,
  });
}

/** The visit row for this recording: the replayed visit, the visit on today's story day, or a new one. */
export async function startVisit(s: Store, session: SessionRow, input: StartVisitInput): Promise<VisitRow> {
  let visit: VisitRow | null = null;
  const account = isAccount(session);
  if (input.mode === "replay") {
    if (!input.fixture || !fixtureUtterances(input.fixture)) throw new VisitError("no_replay", `No replay file for ${input.fixture}`);
    visit = await s.getVisit(session.id, input.fixture);
    if (!visit) throw new VisitError("visit_not_found");
    // an account replays only a visit whose own audio_fixture names this replay (the example's sample visit): a visit
    // of his own that happens to be called "v1" is not taken, reset and emptied (real-app H6)
    if (account && replayFixtureFor(visit) !== input.fixture) throw new VisitError("no_replay", `No replay file for visit ${visit.id}`);
    // day gating: a sample visit later in the story would show records from days that have not happened
    if (visit.day > session.story_day) {
      throw new VisitError("visit_not_yet", `visit ${visit.id} is on day ${visit.day}; the story is on day ${session.story_day}`);
    }
    // played again after he confirmed it: a copy, so his confirmed labels stay as they are
    if ((await confirmedHere(s, session.id, visit)) || (await seedConfirmedBefore(s, session, visit))) visit = await replayCopy(s, session, visit);
  } else if (account) {
    // real-app 3.11: before every visit. An account's recording starts only with the doctor's yes in the request (the
    // consent card's button); a "no" never reaches here (POST /api/visits answers it), a request without it is refused
    if (!input.consent?.given) throw new VisitError("consent_required", "a recording starts only after the doctor's answer to the consent card");
    const pharmacy = input.place === "pharmacy";
    // today's planned follow-up is a clinic visit: at the pharmacy he records a visit of its own (its speakers are the
    // counter and the pharmacist, lib/visit/roles.ts), and the follow-up stays planned
    visit = pharmacy ? null : plannedToday(await s.listVisits(session.id), session.story_day);
    if (!visit) {
      visit = await s.upsertVisit(session.id, {
        id: randomUUID(),
        kind: pharmacy ? "pharmacy" : "clinic",
        // his clinic when he told the app; the pharmacy he is at has no name here
        place: pharmacy ? DEFAULT_PLACE.pharmacy : (scopeClinic(session) ?? DEFAULT_PLACE.clinic),
        day: session.story_day,
      });
    }
  } else {
    visit = (await s.listVisits(session.id)).find((v) => v.day === session.story_day) ?? null;
    if (!visit) {
      // his clinic: the scope's own (an account's settings), else the template's (the demo)
      visit = await s.upsertVisit(session.id, {
        id: `visit-${randomUUID().slice(0, 8)}`,
        kind: "follow_up",
        place: scopeClinic(session) ?? "Clinic",
        day: session.story_day,
      });
    }
  }
  clearVisitLive(session.id, visit.id);
  // a new recording of this visit starts its live notes again
  resetLiveSummary(session.id, visit.id);
  visit = await s.updateVisit(session.id, visit.id, {
    status: "recording",
    audio_path: null,
    // C2 track R: a row that is recorded on again starts without the parts of an earlier recording (only named when
    // the row has any: a visit without parts never writes the column)
    ...(visit.audio_parts?.length ? { audio_parts: null } : {}),
    consent_utterance_id: null,
    // an account's recording is kept RETAIN_DAYS unless he chooses to keep it (journey 15 deletes it after that)
    ...(account && input.mode === "record" ? { retain_until: addDays(visit.date, RETAIN_DAYS), keep_forever: false } : {}),
  });
  if (account && input.mode === "record" && input.consent?.given) {
    // an account keeps the wall clock only (real-app 2.12), never a story moment; the browser's clock is not used
    const at = nowIso();
    await s.addVisitItems(session.id, visit.id, [
      {
        id: `${visit.id}-consent-screen`,
        type: "consent",
        text: input.consent.statement ?? "Consent to record given on the consent screen.",
        slots: { variant: "screen", at, card_version: CONSENT_CARD_VERSION },
        speaker: "patient",
      },
    ]);
    if (session.owner_user_id) {
      await writeRecordingConsent(s, session, {
        decision: "granted",
        method: "tap",
        evidence: { visit_id: visit.id, place: input.place ?? "clinic", at },
        assisted: await helpedOnDevice(s, session.owner_user_id, input.consent.assisted),
      });
    }
  } else if (input.mode === "record" && input.consent?.given) {
    await s.addVisitItems(session.id, visit.id, [
      {
        id: `${visit.id}-consent-screen`,
        type: "consent",
        text: input.consent.statement ?? "Consent to record given on the consent screen.",
        // `at` is the wall clock (audit); the screen shows the story moment (story_day / story_time)
        slots: {
          variant: "screen",
          at: input.consent.at ?? new Date().toISOString(),
          story_day: session.story_day,
          story_time: session.story_time ?? null,
        },
        speaker: "patient",
      },
    ]);
  }
  // an account's replay is the example's recorded visit, never his own: the event says "sample recording" (real-app 4.6)
  const sample = input.mode === "replay" && isSampleVisit(session, visit);
  publish(
    session.id,
    "visit.changed",
    sample ? `Sample recording: visit ${visit.id} is being replayed (the example's visit, not his own)` : `Visit ${visit.id} (Day ${visit.day}): ${input.mode === "replay" ? "replay started" : "recording started"}`,
    { visit, mode: input.mode, ...(sample ? { sample: true } : {}) },
  );
  return visit;
}

// ------------------------------------------------------------------ items

/** Upsert drafts; items of the re-extracted lines that were not produced again are hidden (superseded). */
async function applyItems(s: Store, sessionId: string, visitId: string, lineIds: Set<string>, drafts: ItemDraft[]): Promise<void> {
  if (drafts.length) await s.addVisitItems(sessionId, visitId, drafts);
  const keep = new Set(drafts.map((d) => d.id));
  const existing = await s.listVisitItems(sessionId, { visit_id: visitId });
  const gone = existing.filter((it) => !keep.has(it.id) && it.slots?.superseded !== true && it.utterance_ids.some((id) => lineIds.has(id)));
  // (side by side: one round trip to the database for all of them)
  await Promise.all(
    gone.map((it) =>
      it.required_line && it.id.startsWith("item-")
        ? // a seeded required line keeps its row; only its link to the sentence goes
          s.updateVisitItem(sessionId, it.id, { utterance_ids: [] })
        : s.updateVisitItem(sessionId, it.id, { slots: { ...it.slots, superseded: true } }),
    ),
  );
}

function extractContext(visit: VisitRow, required: VisitItemRow[], meds: Awaited<ReturnType<Store["listMeds"]>>) {
  return {
    visit: { id: visit.id, day: visit.day, kind: visit.kind },
    // a replay copy never adds another R1-R4 row: the visit it copies keeps them
    requiredLines: isReplayCopy(visit) ? [] : required,
    priorPrescriptions: priorPrescriptions(meds, visit.day),
  };
}

function toExtractLine(u: UtteranceRow): ExtractLine {
  return { id: u.id, text: u.text, role: u.role, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms };
}

// ------------------------------------------------------------------ chunk

export interface ChunkResult {
  utterances: UtteranceRow[];
  view: VisitView;
  newCards: CardView[];
}

const CONTEXT_LINES = 4;
const EXTRACT_CONTEXT = 6;

export async function processChunk(
  store: Store,
  session: SessionRow,
  visitId: string,
  incoming: IncomingUtterance[],
  opts: { fallback?: boolean } = {},
): Promise<ChunkResult> {
  // scene 1 (10-15): an account's live line with a voice print. Its speakers come from the voices and the words of the
  // whole recording; the chunk and the model's later answers take turns (lib/visit/live-speakers.ts)
  if (isAccount(session) && incoming.some((u) => u.voice !== undefined)) {
    const sp = liveSpeakers(session.id, visitId, true)!;
    return withSpeakerLock(sp, () => processLines(store, session, visitId, incoming, opts, sp));
  }
  return processLines(store, session, visitId, incoming, opts, null);
}

async function processLines(
  store: Store,
  session: SessionRow,
  visitId: string,
  incoming: IncomingUtterance[],
  opts: { fallback?: boolean },
  sp: LiveSpeakers | null,
): Promise<ChunkResult> {
  // each of his tables is read once for this chunk, together (lib/visit/read-once.ts)
  const s = await reviewStore(store, session, visitId);
  const visit = await mustVisit(s, session.id, visitId);
  const live = visitLive(session.id, visitId);
  if (opts.fallback !== undefined) {
    assertFallbackAllowed(session);
    live.fallbackOn = opts.fallback;
  }
  const fallbackOn = live.fallbackOn && fallbackAllowed(session);
  const existing = liveUtterances(await s.listUtterances(session.id, visitId));
  const { rows: required, refs } = await requiredRefs(s, session.id);

  // ids, scripted fallback, stand-in clips
  // C2 track J (filming): the visit's own replay, or a filming account's scene script (lib/visit/fallback.ts scriptFor)
  const script = fallbackOn ? scriptFor(session, visit) : [];
  // script lines already said (heard correctly before the switch went on) are used up
  for (const e of existing) {
    const same = script.find((l) => sameWords(l.text, e.text));
    if (same) live.usedScript.add(same.id);
  }
  const taken = new Set(existing.map((u) => u.id));
  let n = existing.length;
  const prepared: (IncomingUtterance & { id: string; scripted: boolean; heard: string; fixtureId: string })[] = [];
  for (const u of incoming) {
    let text = u.text.trim();
    const heard = text;
    let scripted = false;
    if (fallbackOn && script.length) {
      const a = alignToScript(text, script, live.usedScript);
      if (a) {
        live.usedScript.add(a.line.id);
        if (a.fallback) {
          text = a.line.text;
          scripted = true;
        }
      }
    }
    let id = u.id && u.id.startsWith(`${visitId}-`) && !taken.has(u.id) ? u.id : "";
    if (!id) {
      do id = `${visitId}-u${pad(++n)}`;
      while (taken.has(id));
    }
    taken.add(id);
    // the replay file's own line id names the line's stand-in clip. A copy's lines get ids of their own: the stream
    // sends "<copy>-v1-u08", a client the bare "v1-u08"; either way the id ends with the file's (standInClip then checks
    // that the words are that line's)
    const fixtureId = FIXTURE_TAIL.exec(u.id ?? "")?.[1] ?? id;
    prepared.push({ ...u, id, text, scripted, heard, fixtureId });
  }

  const changed: { id: string; role: UtteranceRole; state: string }[] = [];
  let roleOf: (id: string) => { role: UtteranceRole; state: RoleState };
  let voiceFor: (p: (typeof prepared)[number]) => number | null;
  if (sp) {
    // scene 1 (10-15): the voices of every line of the recording grouped again with the new prints, the new lines'
    // words voted on by the rules at once (the model's votes follow, labelLinesLater), and every line's role from
    // both (lib/visit/speakers.ts combineRoles). A re-grouping can move any earlier line: each one that changed is
    // written, its voice too
    for (const p of prepared) {
      if (!sp.cues.has(p.id)) sp.cues.set(p.id, ruleVote(p.text));
      if (!sp.votes.has(p.id)) sp.votes.set(p.id, sp.cues.get(p.id)!);
    }
    addPrints(sp, prepared.map((p) => ({ id: p.id, print: p.voice ?? null })));
    const decided = decideSpeakers(sp, [...existing, ...prepared.map((p) => ({ id: p.id, text: p.text, speaker_cluster: null, role: "unknown" as const, role_state: "unknown" as const }))], visit.kind);
    await Promise.all(
      existing.map(async (u) => {
        const r = decided.get(u.id);
        if (!r || u.role_state === "confirmed") return;
        const voice = voiceOf(sp, u);
        if (r.role === u.role && r.state === u.role_state && voice === u.speaker_cluster) return;
        const roleMoved = r.role !== u.role || r.state !== u.role_state;
        await s.updateUtterance(session.id, u.id, { role: r.role, role_state: r.state, speaker_cluster: voice });
        u.role = r.role;
        u.role_state = r.state;
        u.speaker_cluster = voice;
        if (roleMoved) changed.push({ id: u.id, role: r.role, state: r.state });
      }),
    );
    roleOf = (id) => decided.get(id) ?? { role: "unknown", state: "unknown" };
    voiceFor = (p) => sp.voices.get(p.id) ?? null;
  } else {
    // roles: the chunk plus the last lines, with the roles already decided as priors
    const priors = new Map<number, UtteranceRole>();
    for (const u of existing) if (u.speaker_cluster !== null && u.role !== "unknown") priors.set(u.speaker_cluster, u.role);
    const recent = existing.slice(-CONTEXT_LINES);
    const roles = inferRoles(
      [...recent, ...prepared.map((p) => ({ id: p.id, speaker_cluster: p.speaker_cluster ?? null, text: p.text }))],
      { visitKind: visit.kind, requiredLines: refs, priors },
    );
    for (const u of recent) {
      const r = roles.byLine.get(u.id);
      if (!r || u.role_state === "confirmed") continue;
      if (r.role !== u.role || r.state !== u.role_state) {
        await s.updateUtterance(session.id, u.id, { role: r.role, role_state: r.state });
        u.role = r.role;
        u.role_state = r.state;
        changed.push({ id: u.id, role: r.role, state: r.state });
      }
    }
    roleOf = (id) => roles.byLine.get(id)!;
    voiceFor = (p) => p.speaker_cluster ?? null;
  }
  const stored = await s.addUtterances(
    session.id,
    visitId,
    prepared.map((p) => {
      const r = roleOf(p.id);
      return {
        id: p.id,
        t_start_ms: p.t_start_ms,
        t_end_ms: p.t_end_ms,
        speaker_cluster: voiceFor(p),
        lang: p.lang ?? null,
        text: p.text,
        role: r.role,
        role_state: r.state,
        // on an account, a stand-in clip only for a visit with a replay of its own (H6: never by the line's id alone)
        clip_path: p.scripted || (isAccount(session) && !replayFixtureFor(visit)) ? null : standInClip(p.fixtureId, p.text),
        scripted_fallback: p.scripted,
      };
    }),
  );
  for (const u of stored) changed.push({ id: u.id, role: u.role, state: u.role_state });

  // items: from the earliest line whose role changed, with a few lines before it as context
  const all = [...existing, ...stored];
  const firstChunk = existing.length;
  const firstChanged = changed.map((c) => all.findIndex((u) => u.id === c.id)).filter((i) => i >= 0);
  const from = Math.min(firstChunk, ...firstChanged);
  const start = Math.max(0, from - EXTRACT_CONTEXT);
  const meds = await s.listMeds(session.id);
  const drafts = extractItems(all.slice(start).map(toExtractLine), from - start, extractContext(visit, required, meds));
  await applyItems(s, session.id, visitId, new Set(all.slice(from).map((u) => u.id)), drafts);
  const consent = drafts.find((d) => d.type === "consent" && d.slots.variant === "given");
  if (consent && !visit.consent_utterance_id) await s.updateVisit(session.id, visitId, { consent_utterance_id: consent.utterance_ids[0] });
  if (consent?.utterance_ids[0]) await recordSpokenConsent(s, session, visit, consent.utterance_ids[0]);

  // publish
  for (const p of prepared) {
    if (!p.scripted) continue;
    publish(session.id, "scripted_fallback", `Scripted fallback: showed the script line instead of "${short(p.heard)}"`, {
      visit_id: visitId,
      utterance_id: p.id,
      heard: p.heard,
      script: p.text,
    });
  }
  const view = (await buildVisitView(s, session.id, visitId, { session }))!;
  const newCards = view.cards.filter((c) => !live.knownCards.has(c.id));
  if (view.qlist && !live.knownCards.has(`qlist-${view.qlist.anchor}`)) live.knownCards.add(`qlist-${view.qlist.anchor}`);
  for (const c of newCards) live.knownCards.add(c.id);
  if (changed.length) {
    publish(
      session.id,
      "utterance.role",
      changed.length === 1 ? `Speaker of ${changed[0].id}: ${changed[0].role} (${changed[0].state})` : `Speakers updated for ${changed.length} lines`,
      { visit_id: visitId, changes: changed },
    );
  }
  publish(
    session.id,
    "asr.final",
    stored.length === 1 ? `Heard (${stored[0].role}): "${short(stored[0].text)}"` : `Heard ${stored.length} sentences`,
    { visit_id: visitId, utterances: stored, view },
  );
  for (const c of newCards) {
    publish(session.id, "card.created", cardSay(c), { visit_id: visitId, card: c });
  }
  // Ripple's live notes (lib/visit/ripple-summary.ts): at most one model call per 15 s, in the background, with the
  // caller's own store (this request's reads are over by then)
  if (stored.length) noteVisitLines(store, session, visitId);
  // scene 1: the model's vote on who said the new lines, in the background (never holding up the caption)
  if (sp && stored.length) labelLinesLater(store, session, visitId, stored.map((u) => u.id));
  return { utterances: stored, view, newCards };
}

// ------------------------------------------------------------------ speakers (scene 1, 10-15)

type SpeakerRow = Pick<UtteranceRow, "id" | "text" | "speaker_cluster" | "role" | "role_state">;

/** Every line's role from its voice and the votes of the words (lib/visit/speakers.ts combineRoles). A line with no vote yet gets the rules' now. */
function decideSpeakers(sp: LiveSpeakers, lines: readonly SpeakerRow[], visitKind: string): Map<string, { role: UtteranceRole; state: RoleState }> {
  for (const u of lines) {
    if (!sp.cues.has(u.id)) sp.cues.set(u.id, ruleVote(u.text));
    if (!sp.votes.has(u.id)) sp.votes.set(u.id, sp.cues.get(u.id)!);
  }
  return combineRoles(
    lines.map((u) => ({ id: u.id, voice: voiceOf(sp, u), vote: sp.votes.get(u.id) ?? null, cue: sp.cues.get(u.id) ?? null, confirmed: u.role_state === "confirmed" ? u.role : null })),
    { visitKind },
  ).byLine;
}

/** The vote role a stored role stands for (what the model is told an earlier line was taken to be). */
function voteRole(role: UtteranceRole): SpeakerVoteRole | null {
  if (role === "patient" || role === "family") return role;
  return role === "unknown" ? null : "doctor";
}

/** The people in the room as the model is told: his name, and the family member he shares with (her name). */
async function roomPeople(store: Store, session: SessionRow): Promise<SpeakerPeople> {
  const uid = session.owner_user_id;
  if (!uid) return {};
  const [account, links] = await Promise.all([store.getAccount(uid).catch(() => null), store.listCareLinks({ patient_id: uid, status: ["active"] }).catch(() => [])]);
  const her = links.find((l) => l.family_label?.trim());
  const family = her ? `${her.family_label!.trim()}${her.relation ? ` (${her.relation})` : ""}` : null;
  return { patient: account?.display_name?.trim() || null, family };
}

/**
 * The model's vote on who said these lines, in the background (never throws, never holds up the caption): with the
 * gates of Ripple's summary (a real account, a live model, his consent to AI processing, his day's spend: summaryGate),
 * one call at a time per recording for at most SPEAKER_BATCH lines, the lines that come meanwhile in the next. Each
 * answer is applied at once (applySpeakers). Offline, or without his consent, nothing is asked: the rules' votes stay.
 */
function labelLinesLater(store: Store, session: SessionRow, visitId: string, ids: readonly string[]): void {
  const sp = liveSpeakers(session.id, visitId);
  if (!sp) return;
  for (const id of ids) if (!sp.queue.includes(id)) sp.queue.push(id);
  if (sp.running || !sp.queue.length) return;
  sp.running = runLabels(store, session, visitId, sp).finally(() => {
    sp.running = null;
    if (sp.queue.length && liveSpeakers(session.id, visitId) === sp) labelLinesLater(store, session, visitId, []);
  });
}

/** Resolves once no model call for the recording's speakers is running (tests). */
export async function speakersIdle(sessionId: string, visitId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const sp = liveSpeakers(sessionId, visitId);
    if (!sp?.running) return;
    await sp.running;
  }
}

async function runLabels(store: Store, session: SessionRow, visitId: string, sp: LiveSpeakers): Promise<void> {
  try {
    const gate = await summaryGate(store, session, depsOr(undefined));
    if (!gate.ok) {
      sp.queue = [];
      return;
    }
    try {
      sp.people ??= await roomPeople(store, session);
      while (sp.queue.length && liveSpeakers(session.id, visitId) === sp) {
        const batch = new Set(sp.queue.splice(0, SPEAKER_BATCH));
        const visit = await store.getVisit(session.id, visitId);
        if (!visit || visit.status !== "recording") {
          sp.queue = [];
          return;
        }
        const lines = liveUtterances(await store.listUtterances(session.id, visitId));
        const first = lines.findIndex((u) => batch.has(u.id));
        if (first < 0) continue;
        const asLine = (u: UtteranceRow): SpeakerLine => ({ id: u.id, text: u.text, by: u.role_state === "unknown" ? null : voteRole(u.role) });
        const context = lines.slice(Math.max(0, first - SPEAKER_CONTEXT_LINES), first).map(asLine);
        const fresh = lines.filter((u) => batch.has(u.id)).map(asLine);
        const out = await nameSpeakers(gate.llm, context, fresh, { people: sp.people });
        sp.calls.push({ ms: out.ms, lines: fresh.length, votes: out.votes.size, error: out.error });
        if (out.error) console.warn(`[speakers] the model did not name the speakers of ${fresh.length} line(s): ${out.error}`);
        if (!out.votes.size) continue;
        for (const [id, vote] of out.votes) sp.votes.set(id, vote);
        await withSpeakerLock(sp, () => applySpeakers(store, session, visitId));
      }
    } finally {
      void gate.settle();
    }
  } catch (err) {
    sp.queue = [];
    console.warn(`[speakers] skipped: ${err instanceof Error ? err.name : "error"}`);
  }
}

/**
 * The roles of a recording's lines again from the voices and the latest votes (the model has just answered): every line
 * whose role or voice moved is written, the items are extracted again from the earliest line whose role moved (as a
 * chunk does), and utterance.role says which lines changed, with the visit's view for his screen. Only while the visit
 * records: once it has ended, the whole-visit record decides (finalizeVisit). Returns the ids of the lines whose role moved.
 */
export async function applySpeakers(store: Store, session: SessionRow, visitId: string): Promise<string[]> {
  const sp = liveSpeakers(session.id, visitId);
  if (!sp) return [];
  const s = await reviewStore(store, session, visitId);
  const visit = await s.getVisit(session.id, visitId);
  if (!visit || visit.status !== "recording") return [];
  const all = liveUtterances(await s.listUtterances(session.id, visitId));
  const decided = decideSpeakers(sp, all, visit.kind);
  const changed: { id: string; role: UtteranceRole; state: RoleState }[] = [];
  await Promise.all(
    all.map(async (u) => {
      const r = decided.get(u.id);
      if (!r || u.role_state === "confirmed") return;
      const voice = voiceOf(sp, u);
      if (r.role === u.role && r.state === u.role_state && voice === u.speaker_cluster) return;
      const roleMoved = r.role !== u.role || r.state !== u.role_state;
      await s.updateUtterance(session.id, u.id, { role: r.role, role_state: r.state, speaker_cluster: voice });
      u.role = r.role;
      u.role_state = r.state;
      u.speaker_cluster = voice;
      if (roleMoved) changed.push({ id: u.id, role: r.role, state: r.state });
    }),
  );
  if (!changed.length) return [];
  const from = Math.min(...changed.map((c) => all.findIndex((u) => u.id === c.id)).filter((i) => i >= 0));
  const start = Math.max(0, from - EXTRACT_CONTEXT);
  const { rows: required } = await requiredRefs(s, session.id);
  const meds = await s.listMeds(session.id);
  const drafts = extractItems(all.slice(start).map(toExtractLine), from - start, extractContext(visit, required, meds));
  await applyItems(s, session.id, visitId, new Set(all.slice(from).map((u) => u.id)), drafts);
  const view = (await buildVisitView(s, session.id, visitId, { session }))!;
  const live = visitLive(session.id, visitId);
  const newCards = view.cards.filter((c) => !live.knownCards.has(c.id));
  for (const c of newCards) live.knownCards.add(c.id);
  publish(
    session.id,
    "utterance.role",
    changed.length === 1 ? `Speaker of ${changed[0].id}: ${changed[0].role} (${changed[0].state}), from the voice and the words` : `Speakers updated for ${changed.length} lines, from the voices and the words`,
    { visit_id: visitId, changes: changed, view },
  );
  for (const c of newCards) publish(session.id, "card.created", cardSay(c), { visit_id: visitId, card: c });
  return changed.map((c) => c.id);
}

function cardSay(c: CardView): string {
  if (c.kind === "doc") {
    const r = c.rows.map((x) => `${x.variant}${x.requiredLine ? ` (${x.requiredLine})` : ""}`).join(", ");
    return `Card: doctor's note · ${r} · "${short(c.quote, 50)}"`;
  }
  return `Card: check · ${c.check}`;
}

// ------------------------------------------------------------------ finalize

/** Reuse the live line id that overlaps a formal line most (at least half of the shorter one). */
function overlapId(f: { tStartMs: number; tEndMs: number }, live: UtteranceRow[], used: Set<string>): string | null {
  let best: { id: string; share: number } | null = null;
  for (const u of live) {
    if (used.has(u.id)) continue;
    const inter = Math.min(f.tEndMs, u.t_end_ms) - Math.max(f.tStartMs, u.t_start_ms);
    if (inter <= 0) continue;
    const share = inter / Math.max(1, Math.min(f.tEndMs - f.tStartMs, u.t_end_ms - u.t_start_ms));
    if (share >= 0.5 && (!best || share > best.share)) best = { id: u.id, share };
  }
  return best?.id ?? null;
}

export interface ExtractionInfo {
  /** "rules" (mock provider, the model failed, or he has not agreed to AI processing) or "rules+model" */
  source: "rules" | "rules+model";
  /** his consent to AI processing was off: no model saw the transcript (absent when it was on) */
  aiOff?: true;
  provider: string | null;
  model: string | null;
  /** items the model added on top of the rules */
  added: number;
  /** model labels dropped by the checks in model-extract.ts */
  rejected: number;
  error: string | null;
  latencyMs: number;
}

/** Per-attempt timeout for the whole-visit labelling call. */
function extractTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LLM_EXTRACT_TIMEOUT_MS);
  return env.LLM_EXTRACT_TIMEOUT_MS && Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Rules, then (with a real model) the model's labels merged in. `llm: null` = rules only. */
async function extractWholeVisit(
  lines: ExtractLine[],
  ctx: ReturnType<typeof extractContext>,
  llm: LlmClient | null | undefined,
): Promise<{ drafts: ItemDraft[]; info: ExtractionInfo }> {
  const rules = extractItems(lines, 0, ctx);
  // offline (the mock model) the rules alone; the developer tools can stand a model-shaped labeller in for a journey
  // run (lib/visit/devfake-extract.ts: null unless that run asked for it)
  const client = llm === undefined ? (mainProviderKind() === "mock" ? devfakeExtractor() : createMainLlm()) : llm;
  if (!client) return { drafts: rules, info: { source: "rules", provider: null, model: null, added: 0, rejected: 0, error: null, latencyMs: 0 } };
  const res = await extractWithModel(client, lines, 0, ctx, { timeoutMs: extractTimeoutMs() });
  const base = { provider: res.provider, model: res.model, rejected: res.rejected.length, latencyMs: res.latencyMs };
  if (res.error) {
    console.warn(`[visit] model extraction failed; rules only: ${res.error.split(":")[0]}`);
    return { drafts: rules, info: { ...base, source: "rules", added: 0, error: res.error } };
  }
  const merged = mergeDrafts(rules, res.drafts);
  return { drafts: merged.drafts, info: { ...base, source: "rules+model", added: merged.added.length, error: null } };
}

/**
 * Scene 1 (10-15): the speakers of the whole-visit record, from the voices and the words (lib/visit/speakers.ts
 * combineRoles). The voices: the transcription service's own speaker numbers when it separated them (a recording of one
 * piece: lib/asr/tencent.ts), else the voice each sentence's live line had. The words: the vote of the live line the
 * sentence reuses the id of, or overlaps most (the model's when it answered, else the rules'), else the rules' on the
 * sentence. null when the recording had neither live voices nor the service's numbers: the roles are found as before.
 */
function finalSpeakers(
  session: SessionRow,
  visit: VisitRow,
  formal: readonly { tStartMs: number; tEndMs: number; speaker: number | null }[],
  ids: readonly string[],
  words: readonly { text: string }[],
  live: readonly UtteranceRow[],
): { byLine: Map<string, { role: UtteranceRole; state: RoleState }>; voices: (number | null)[] } | null {
  const sp = liveSpeakers(session.id, visit.id);
  const diarized = formal.some((f) => f.speaker !== null && f.speaker !== undefined);
  if (!diarized && !(sp && sp.prints.size)) return null;
  const liveById = new Map(live.map((u) => [u.id, u]));
  /** the live line a sentence of the record reuses the id of, or else overlaps most */
  const near = (i: number): UtteranceRow | null => {
    const same = liveById.get(ids[i]);
    if (same) return same;
    let best: { u: UtteranceRow; ms: number } | null = null;
    for (const u of live) {
      const ms = Math.min(formal[i].tEndMs, u.t_end_ms) - Math.max(formal[i].tStartMs, u.t_start_ms);
      if (ms > 0 && (!best || ms > best.ms)) best = { u, ms };
    }
    return best?.u ?? null;
  };
  const lines = formal.map((f, i) => {
    const u = near(i);
    const cue = ruleVote(words[i].text);
    const vote: SpeakerVote = (u && sp?.votes.get(u.id)) || cue;
    const voice = diarized ? (f.speaker ?? null) : u ? (sp ? voiceOf(sp, u) : u.speaker_cluster) : null;
    return { id: ids[i], voice, vote, cue };
  });
  return { byLine: combineRoles(lines, { visitKind: visit.kind }).byLine, voices: lines.map((l) => l.voice) };
}

export async function finalizeVisit(
  store: Store,
  session: SessionRow,
  visitId: string,
  job: FileJobResult,
  /**
   * `llm`: the labelling model (tests; null = rules only). `aiAllowed`: his consent to AI processing, already read
   * (default: read here through `account`). `account`: the store that reaches his account rows (consent records);
   * default `store`, the request's own store. A scheduled job's store is bound to the scope only (system mode), so
   * lib/asr/pending.ts hands the process store here.
   */
  opts: { llm?: LlmClient | null; aiAllowed?: boolean; account?: ConsentStore } = {},
): Promise<VisitView> {
  // each of his tables is read once for this request, together (lib/visit/read-once.ts)
  const s = await reviewStore(store, session, visitId);
  const visit = await mustVisit(s, session.id, visitId);
  if (job.status !== "done") throw new VisitError("job_not_done", `speech job is ${job.status}`);
  const live = liveUtterances(await s.listUtterances(session.id, visitId));
  const formal = (job.utterances ?? []).slice().sort((a, b) => a.tStartMs - b.tStartMs);

  // ids: the replay file's own ids, else the overlapping live line, else new
  const used = new Set<string>();
  let n = 0;
  const ids = formal.map((f) => {
    let id = f.id && f.id.startsWith(`${visitId}-`) ? f.id : overlapId(f, live, used);
    if (!id || used.has(id)) {
      do id = `${visitId}-f${pad(++n)}`;
      while (used.has(id) || live.some((u) => u.id === id));
    }
    used.add(id);
    return id;
  });
  // (side by side: one round trip to the database for all the live lines the record replaces)
  await Promise.all(live.filter((u) => !used.has(u.id)).map((u) => s.updateUtterance(session.id, u.id, { lang: SUPERSEDED_LANG, role: "unknown", role_state: "unknown" })));

  // C2 track J (filming): the crew's scripted fallback on a filming account (switched on for this visit by the crew):
  // a sentence the transcription misheard shows the scene's script line instead (lib/visit/fallback.ts scriptFor),
  // marked scripted_fallback, as the live captions do. A demo session's whole transcript and every other account: as is.
  const fallbackLive = visitLive(session.id, visitId);
  const script = isAccount(session) && fallbackLive.fallbackOn && fallbackAllowed(session) ? scriptFor(session, visit) : [];
  const usedScript = new Set<string>();
  const words = formal.map((f) => {
    const a = script.length ? alignToScript(f.text, script, usedScript) : null;
    if (!a) return { text: f.text, scripted: false };
    usedScript.add(a.line.id);
    return a.fallback ? { text: a.line.text, scripted: true } : { text: f.text, scripted: false };
  });

  // roles in one pass over the whole visit (confirmed roles stay). Scene 1 (10-15): an account's recording whose speakers
  // were heard live (voice prints and votes) or separated by the transcription service is decided by the voices and the
  // words together (finalSpeakers); anything else, as before (lib/visit/roles.ts)
  const { rows: required, refs } = await requiredRefs(s, session.id);
  const voiced = isAccount(session) && job.source === "audio" ? finalSpeakers(session, visit, formal, ids, words, live) : null;
  const roles = voiced ?? inferRoles(
    formal.map((f, i) => ({ id: ids[i], speaker_cluster: f.speaker, text: words[i].text })),
    { visitKind: visit.kind, requiredLines: refs },
  );
  const confirmed = new Map(live.filter((u) => u.role_state === "confirmed").map((u) => [u.id, u.role]));

  // per-sentence clips: cut from the recording when the transcript came from that audio. C2 track R: a long recording
  // is several files and the lines' times run over all of them; a sentence that crosses a cut is cut from both
  // (lib/visit/recording-audio.ts)
  let audio = job.source === "audio" ? openRecording(getBlobStore(), visit) : null;
  // the recording is not in storage: as before, nothing is cut
  if (audio && !(await audio.load(0))) audio = null;
  const rows = [];
  for (let i = 0; i < formal.length; i++) {
    const f = formal[i];
    const id = ids[i];
    let clip: string | null = null;
    if (words[i].scripted) {
      // a script line stands in for what was misheard: no clip of the recording under it (as the live captions do)
    } else if (audio) {
      const seg = await audio.clip(f.tStartMs, f.tEndMs);
      if (seg) {
        const path = `${blobPrefix(session)}/visits/${visitId}/segments/${id}.wav`;
        await getBlobStore().putObject("audio", path, seg, "audio/wav");
        clip = path;
      }
    } else if (!isAccount(session) || job.source === "fixture" || replayFixtureFor(visit)) {
      // a stand-in transcript (mock replay, the devfake stand-in) names its fixture line: its stand-in clip, if any.
      // On an account only for such a transcript or a visit with a replay of its own: a transcript made from his own
      // recording never gets the story's clip because its line happens to be called "v1-u08" (real-app H6)
      clip = standInClip(f.id && FIXTURE_LINE.test(f.id) ? f.id : id, f.text);
    }
    const r = roles.byLine.get(id)!;
    const keep = confirmed.get(id);
    rows.push({
      id,
      t_start_ms: f.tStartMs,
      t_end_ms: f.tEndMs,
      speaker_cluster: voiced ? voiced.voices[i] : f.speaker,
      lang: f.lang ?? null,
      text: words[i].text,
      role: keep ?? r.role,
      role_state: keep ? ("confirmed" as const) : r.state,
      clip_path: clip,
      scripted_fallback: words[i].scripted,
    });
  }
  const stored = rows.length ? await s.addUtterances(session.id, visitId, rows) : [];
  for (let i = 0; i < formal.length; i++) {
    if (!words[i].scripted) continue;
    publish(session.id, "scripted_fallback", `Scripted fallback: showed the script line instead of "${short(formal[i].text)}"`, {
      visit_id: visitId,
      utterance_id: ids[i],
      heard: formal[i].text,
      script: words[i].text,
    });
  }

  // items in one pass
  const meds = await s.listMeds(session.id);
  // his consent to AI processing, read for this request (an account's latest ai_processing decision; a demo session's
  // synthetic story is allowed as before): without it no model sees the transcript, the rules alone make the record
  const accountRows: ConsentStore = opts.account ?? s;
  const aiAllowed = opts.aiAllowed ?? (await aiConsent(accountRows as Store, session));
  // C2 track S (round 2; real-app 3.5 「DeepSeek 花费，每人每天 US$0.20：不发请求」): the labelling call is counted in his day's
  // model spend, and once that is used up the rules alone label the visit, as they do offline (lib/llm/person-spend.ts)
  const spend = aiAllowed && opts.llm === undefined && mainProviderKind() !== "mock" ? personSpendFor(session) : null;
  const labeller = !aiAllowed ? null : !spend ? opts.llm : (await spend.capped()) ? null : spend.wrap(createMainLlm());
  const made = await extractWholeVisit(stored.map(toExtractLine), extractContext(visit, required, meds), labeller);
  void spend?.settle();
  const drafts = made.drafts;
  const extraction: ExtractionInfo = aiAllowed ? made.info : { ...made.info, aiOff: true };
  await applyItems(s, session.id, visitId, new Set([...stored.map((u) => u.id), ...live.map((u) => u.id)]), drafts);
  const consent = drafts.find((d) => d.type === "consent" && d.slots.variant === "given");
  const updated = await s.updateVisit(session.id, visitId, {
    status: "review",
    consent_utterance_id: consent?.utterance_ids[0] ?? visit.consent_utterance_id,
  });
  if (consent?.utterance_ids[0]) await recordSpokenConsent(accountRows, session, visit, consent.utterance_ids[0]);
  // how this record was made, kept with the visit (0016_f_visit_made): the review describes this visit from it. Its
  // own update, best effort: a database that does not have the column yet still gets the record (the review then
  // falls back to his setting as it is now, lib/visit/view.ts).
  let kept = updated;
  if (isAccount(session)) {
    try {
      kept = await s.updateVisit(session.id, visitId, { ai_used: aiAllowed });
    } catch (err) {
      console.warn(`[visit] how the record was made could not be kept: ${err instanceof Error ? err.name : "error"}`);
    }
  }
  const sample = isSampleVisit(session, visit);
  const l = visitLive(session.id, visitId);
  if (l.stream) l.stream = { ...l.stream, state: "ended" };
  const modelNote =
    extraction.source === "rules+model"
      ? `; ${extraction.model} labelled it too (${extraction.added} more item${extraction.added === 1 ? "" : "s"}, ${extraction.rejected} label${extraction.rejected === 1 ? "" : "s"} dropped)`
      : extraction.error
        ? "; model labelling failed, rules only"
        : extraction.aiOff
          ? "; AI processing is off for this account, rules only"
          : "";
  publish(session.id, "visit.changed", `${sample ? "Sample recording: visit" : "Visit"} ${visitId}: full record ready (${stored.length} sentences)${modelNote}; waiting for his check`, {
    visit: kept,
    extraction,
    ...(sample ? { sample: true } : {}),
  });
  // an account's visit: the doctor's English lines are translated once now, in the background, and kept (track S's
  // lib/translate, two checks); the review shows a kept translation under the English, or the English alone
  if (isAccount(session) && aiAllowed) {
    // (with the caller's own store: the translation goes on after this request and its reads are over)
    void translateVisitLines(store, session, visitId, { aiAllowed }).catch((err: unknown) => console.warn(`[visit] translation skipped: ${err instanceof Error ? err.name : "error"}`));
    // Ripple's final summary from the whole transcript, in the background (lib/visit/ripple-summary.ts): kept with the
    // visit and announced to his open review; never a source. His consent as read for this record; his language from
    // his account, read through the store that reaches it
    const accountStore = typeof (opts.account as Partial<Store> | undefined)?.getAccount === "function" ? (opts.account as unknown as Pick<Store, "getAccount">) : store;
    void writeFinalSummary(store, session, visitId, { aiAllowed, accountStore });
  }
  return (await buildVisitView(s, session.id, visitId, { session }))!;
}

// ------------------------------------------------------------------ confirm

export type { ItemVerdict } from "./verdict";

export interface ConfirmInput {
  /** utterance ids he says are his */
  mine: string[];
  /** item id -> his answer (lib/visit/verdict.ts) */
  items: Record<string, ItemVerdict>;
  locale?: "en" | "zh-Hans";
}

const CLINICIAN_ROLES: UtteranceRole[] = ["doctor", "dispenser", "pharmacist"];

/** His question when he says a line of the visit is not right: a fixed frame around the line, quoted word for word. */
export function disputedQuestionText(locale: "en" | "zh-Hans", quote: string): string {
  return locale === "en" ? `I think this line from my visit is not right: “${quote}”` : `看诊记下的这句，我觉得不对：“${quote}”`;
}

export const disputeEvidence = (visitId: string, lineId: string) => `visit_disputed:${visitId}:${lineId}`;

/** The visit a prescription or a follow-up belongs to: a replay copy's are the visit it copies. */
const ownerVisitId = (visit: VisitRow) => copiedFrom(visit) ?? visit.id;

/** A prescription he confirmed: on his list, awaiting its label, linked to the visit (accounts; the demo's seed has it). */
async function prescribe(s: Store, session: SessionRow, visit: VisitRow, it: VisitItemRow): Promise<MedicationRow | null> {
  const drug = typeof it.slots?.drug === "string" ? (it.slots.drug as string) : null;
  if (it.type !== "medication" || !drug) return null;
  const meds = await s.listMeds(session.id);
  // already on his list (the medicine he keeps taking, or a second confirmation): nothing new
  if (meds.some((m) => m.drug_id === drug && m.origin === "prescription")) return null;
  const med = await s.upsertMed(session.id, {
    id: newMedId(meds, drug),
    origin: "prescription",
    status: "awaiting_label",
    drug_id: drug,
    label: null,
    start_day: null,
    prescribed_visit_id: ownerVisitId(visit),
    note: null,
    pharmacist_answer: null,
  });
  publish(session.id, "med.changed", `Prescribed at the visit: ${drug}, awaiting its label`, { kind: "prescribed", med, visit_id: ownerVisitId(visit), item_id: it.id });
  return med;
}

/** A follow-up he confirmed ("come back in six weeks"): a planned visit about that day (accounts). */
async function planFollowUp(s: Store, session: SessionRow, visit: VisitRow, it: VisitItemRow): Promise<VisitRow | null> {
  if (it.type !== "follow_up" || visit.kind === "pharmacy") return null;
  const days = typeof it.slots?.days === "number" ? (it.slots.days as number) : null;
  if (days === null || days <= 0) return null;
  const id = `${it.id}-planned`;
  if (await s.getVisit(session.id, id)) return null;
  const owner = (await s.getVisit(session.id, ownerVisitId(visit))) ?? visit;
  const planned = await s.upsertVisit(session.id, {
    id,
    kind: "follow_up",
    place: owner.place,
    day: owner.day + days,
    status: "planned",
    script_section: `planned:${owner.id}`,
  });
  publish(session.id, "visit.changed", `Follow-up planned for about ${planned.date}`, { visit: planned, planned_from: owner.id, approx: it.slots?.approx === true });
  return planned;
}

/** script_section of a planned follow-up whose day he set himself ("planned:<visit>:booked"): no longer "about". */
const BOOKED_SUFFIX = ":booked";

/**
 * Is this planned follow-up's date still "about" (true), or the day he booked (false)? real-app 2.15: the row is written
 * 「大约 11月20日」 until he changes it to 「我约的日子」. Its date always comes from a phrase like "in six weeks"
 * (lib/visit/text.ts daysFromNow reads no calendar date), so there is no exact day of the doctor's to tell apart, and
 * whether his sentence had the word "about" does not make the reckoned day any more certain. The review page says the
 * same of the same visit (lib/visit/view.ts visitAccountView).
 */
export async function plannedIsApprox(_s: Store, _sessionId: string, visit: Pick<VisitRow, "id" | "script_section">): Promise<boolean> {
  // only a row planFollowUp made from the doctor's line ("planned:<visit>"); a planned visit set another way (the
  // example's follow-up, a row with no line behind it) has its plain day
  const section = visit.script_section ?? "";
  return section.startsWith("planned:") && !section.endsWith(BOOKED_SUFFIX);
}

/**
 * 「我约的日子」 (real-app 2.15: a confirmed follow-up is a planned visit on 「大约 11月20日」, which he can change to the day
 * he booked). Only an account's planned follow-up (never the example's sample visit, never a visit that started);
 * a real date, today or later. The row keeps its id, so recording on that day lands on it.
 */
export async function rescheduleFollowUp(s: Store, session: SessionRow, visitId: string, date: string): Promise<{ visit: VisitRow; approx: boolean }> {
  const visit = await mustVisit(s, session.id, visitId);
  if (!isAccount(session) || visit.status !== "planned" || !!visit.audio_fixture) throw new VisitError("not_planned", "only a planned follow-up's day can be changed");
  const d0 = scopeD0(session);
  const [y, m, d] = date.split("-").map(Number);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === date;
  if (!real) throw new VisitError("invalid", "not a date");
  if (date < storyDate(d0, session.story_day)) throw new VisitError("invalid", "that day has passed");
  const section = visit.script_section ?? "planned:";
  const updated = await s.updateVisit(session.id, visit.id, {
    day: dayOfDate(d0, date),
    date,
    script_section: section.endsWith(BOOKED_SUFFIX) ? section : `${section}${BOOKED_SUFFIX}`,
  });
  publish(session.id, "visit.changed", `Follow-up: he set the day he booked (${date})`, { visit: updated, booked: true });
  return { visit: updated, approx: false };
}

/** What an answer changed away from 「是」 took back (kept in the item's history next to the change). */
type Undone = { med: string } | { visit: string };

/**
 * He no longer says the doctor prescribed it: the medicine this visit put on his list leaves it, as long as nothing of
 * his hangs on it. Only the row prescribe() made for this visit and this drug, still waiting for its label, with no
 * label and never started; and only when no other line of the visit he still says 「是」 to names the same drug. A
 * medicine whose label he already confirmed is his by the label and stays.
 */
async function unprescribe(s: Store, session: SessionRow, visit: VisitRow, it: VisitItemRow, all: Iterable<VisitItemRow>): Promise<Undone | null> {
  const drug = typeof it.slots?.drug === "string" ? (it.slots.drug as string) : null;
  if (it.type !== "medication" || !drug) return null;
  for (const other of all) if (other.id !== it.id && other.type === "medication" && other.slots?.drug === drug && verdictOf(other) === "right") return null;
  const owner = ownerVisitId(visit);
  const med = (await s.listMeds(session.id)).find((m) => m.drug_id === drug && m.origin === "prescription" && m.prescribed_visit_id === owner);
  if (!med || med.status !== "awaiting_label" || med.label !== null || med.start_day !== null) return null;
  await s.deleteMed(session.id, med.id);
  publish(session.id, "med.changed", `He took back that ${drug} was prescribed at the visit: it is off his list (it still waited for its label)`, {
    kind: "prescription_withdrawn",
    med,
    visit_id: owner,
    item_id: it.id,
  });
  return { med: med.id };
}

/**
 * He no longer says the doctor told him to come back: the follow-up planFollowUp() planned from this line is no longer
 * planned, as long as it is still only planned and its day is still the doctor's "about six weeks" (a day he booked
 * himself is his own and stays).
 */
async function unplanFollowUp(s: Store, session: SessionRow, it: VisitItemRow): Promise<Undone | null> {
  if (it.type !== "follow_up") return null;
  const planned = await s.getVisit(session.id, `${it.id}-planned`);
  if (!planned || planned.status !== "planned" || planned.script_section?.endsWith(BOOKED_SUFFIX)) return null;
  await s.deleteVisit(session.id, planned.id);
  publish(session.id, "visit.changed", `Follow-up about ${planned.date} is no longer planned: he took back the line it came from`, { visit: planned, withdrawn: true, item_id: it.id });
  return { visit: planned.id };
}

interface ApplyOptions {
  /** the review's "these lines were mine" (confirmVisit); null: his lines are left as they are (one answer at a time) */
  mine: Set<string> | null;
  locale: "en" | "zh-Hans";
}

/** His answers on the items, their lines, the questions and what follows from them. Returns the items it changed. */
async function applyVerdicts(s: Store, session: SessionRow, visit: VisitRow, verdicts: Record<string, ItemVerdict>, opts: ApplyOptions): Promise<VisitItemRow[]> {
  // the reads side by side (through a request's readOnce store they are already there: lib/visit/read-once.ts)
  const [lineRows, itemRows, questions] = await Promise.all([
    s.listUtterances(session.id, visit.id),
    s.listVisitItems(session.id, { visit_id: visit.id }),
    s.listQuestions(session.id),
  ]);
  const lines = liveUtterances(lineRows);
  // Ripple's summary is never one of his answers: a verdict on it is refused below (unknown item), so it can never become
  // a confirmed source (lib/visit/ripple-summary.ts)
  const items = liveItems(itemRows).filter((it) => !isSummaryItem(it));
  if (opts.mine) {
    const known = new Set(lines.map((u) => u.id));
    for (const id of opts.mine) if (!known.has(id)) throw new VisitError("invalid", `unknown utterance ${id}`);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of Object.keys(verdicts)) if (!byId.has(id)) throw new VisitError("invalid", `unknown item ${id}`);
  const at = nowIso();

  // items: the answer, and the change in its history when he answers differently from before
  // (the items of one line are written side by side: one round trip to the database, not one per item)
  const changed: VisitItemRow[] = [];
  const newlyWrong: VisitItemRow[] = [];
  const noLongerWrong: VisitItemRow[] = [];
  const answered = await Promise.all(
    Object.entries(verdicts).map(async ([id, verdict]) => {
      const it = byId.get(id)!;
      const before = verdictOf(it);
      const history = Array.isArray(it.slots?.history) ? (it.slots.history as unknown[]) : [];
      const slots: Record<string, unknown> = {
        ...it.slots,
        verdict,
        verdict_at: at,
        disputed: verdict === "wrong",
        rejected: verdict === "wrong" && !emergencyItem(it),
        ...(before !== null && before !== verdict ? { history: [...history, { at, from: before, to: verdict }] } : {}),
      };
      const row = await s.updateVisitItem(session.id, it.id, { confirmed_by: verdict === "right" ? "patient" : null, slots });
      return { id, verdict, before, row };
    }),
  );
  for (const { id, verdict, before, row } of answered) {
    byId.set(id, row);
    changed.push(row);
    if (verdict === "wrong" && before !== "wrong") newlyWrong.push(row);
    if (verdict !== "wrong" && before === "wrong") noLongerWrong.push(row);
  }

  // lines: his own are his (confirmVisit); a line with an item he says is right is the clinician's, confirmed; a line he
  // confirmed before whose items he no longer says are right goes back to the app's guess
  const rightLines = new Map<string, UtteranceRole | null>();
  for (const it of byId.values()) if (verdictOf(it) === "right") for (const lid of it.utterance_ids) rightLines.set(lid, it.speaker);
  const touched = new Set(changed.flatMap((it) => it.utterance_ids));
  const changes: { id: string; role: UtteranceRole; state: UtteranceRow["role_state"] }[] = [];
  for (const u of lines) {
    let role = u.role;
    let state = u.role_state;
    if (opts.mine?.has(u.id)) {
      role = "patient";
      state = "confirmed";
    } else if (opts.mine && u.role === "patient") {
      // he says it was not him
      role = "unknown";
      state = "unknown";
    } else if (rightLines.has(u.id)) {
      const speaker = rightLines.get(u.id);
      if (CLINICIAN_ROLES.includes(u.role)) state = "confirmed";
      else if (speaker && CLINICIAN_ROLES.includes(speaker)) {
        role = speaker;
        state = "confirmed";
      }
    } else if (touched.has(u.id) && u.role_state === "confirmed" && CLINICIAN_ROLES.includes(u.role)) {
      state = "inferred";
    }
    if (role !== u.role || state !== u.role_state) changes.push({ id: u.id, role, state });
  }

  // "not right": one question per line for the person who said it (never twice); changing his mind skips it again
  const audience = visit.kind === "pharmacy" ? "pharmacist" : "doctor";
  const doneLines = new Set<string>();
  // what is written, and what is said about it afterwards, in this order (the writes themselves go side by side)
  const questionWrites: { write: () => Promise<QuestionRow>; say: (row: QuestionRow) => void }[] = [];
  for (const it of newlyWrong) {
    for (const lid of it.utterance_ids) {
      if (doneLines.has(lid)) continue;
      doneLines.add(lid);
      const evidence = disputeEvidence(ownerVisitId(visit), lid);
      const open = questions.find((q) => q.evidence === evidence);
      const line = lines.find((u) => u.id === lid);
      if (open && open.status !== "skipped") continue;
      if (open) {
        questionWrites.push({
          write: () => s.updateQuestion(session.id, open.id, { status: "open" }),
          say: (row) => publish(session.id, "question.updated", "He says a line of the visit is not right (again)", { question: row }),
        });
        continue;
      }
      questionWrites.push({
        write: () =>
          s.addQuestion(session.id, {
            for: audience,
            origin: "own",
            text: disputedQuestionText(opts.locale, line?.text ?? it.text),
            lang: opts.locale,
            status: "open",
            created_day: session.story_day,
            evidence,
          }),
        say: (row) => publish(session.id, "question.created", "He says a line of the visit is not right: a question for next time", { question: row, disputed: { visit_id: visit.id, line_id: lid } }),
      });
    }
  }
  const skipping = new Set<string>();
  for (const it of noLongerWrong) {
    // he takes it back: the question goes (skipped), unless another item of the line is still "not right"
    for (const lid of it.utterance_ids) {
      if ([...byId.values()].some((x) => x.utterance_ids.includes(lid) && verdictOf(x) === "wrong")) continue;
      const q = questions.find((x) => x.evidence === disputeEvidence(ownerVisitId(visit), lid) && x.status === "open");
      if (!q || skipping.has(q.id)) continue;
      skipping.add(q.id);
      questionWrites.push({
        write: () => s.updateQuestion(session.id, q.id, { status: "skipped" }),
        say: (row) => publish(session.id, "question.updated", "He took back that a line of the visit is not right", { question: row }),
      });
    }
  }
  // the lines' speakers and the questions: one round trip to the database for all of them
  const [, questionRows] = await Promise.all([
    Promise.all(changes.map((c) => s.updateUtterance(session.id, c.id, { role: c.role, role_state: c.state }))),
    Promise.all(questionWrites.map((w) => w.write())),
  ]);
  if (changes.length) publish(session.id, "utterance.role", `He confirmed who said what (${changes.length} lines)`, { visit_id: visit.id, changes });
  questionWrites.forEach((w, i) => w.say(questionRows[i]));

  // what follows from a confirmed prescription or follow-up (an account's: the demo's seed already has both), and what
  // an answer changed away from 「是」 takes back again (the item's history keeps what was taken back)
  if (isAccount(session)) {
    for (let i = 0; i < changed.length; i++) {
      const it = changed[i];
      if (verdictOf(it) === "right") {
        await prescribe(s, session, visit, it);
        await planFollowUp(s, session, visit, it);
        continue;
      }
      const undone = [await unprescribe(s, session, visit, it, byId.values()), await unplanFollowUp(s, session, it)].filter((u): u is Undone => !!u);
      if (!undone.length) continue;
      const history = Array.isArray(it.slots?.history) ? [...(it.slots.history as Record<string, unknown>[])] : [];
      const last = history.at(-1);
      // normally the change just written above; an item with no change of its own (answered 不是 from the start) gets a line
      if (last && last.at === at) history[history.length - 1] = { ...last, undone };
      else history.push({ at, from: verdictOf(it), to: verdictOf(it), undone });
      const row = await s.updateVisitItem(session.id, it.id, { slots: { ...it.slots, history } });
      byId.set(it.id, row);
      changed[i] = row;
    }
  }
  return changed;
}

/**
 * His question list: the answers he confirmed are written with the clinician's own words; an answer he takes back
 * after confirming (an edit) puts its question back to open.
 */
async function syncAnswers(s: Store, session: SessionRow, visit: VisitRow, locale: "en" | "zh-Hans", createRippleQuestions: boolean): Promise<void> {
  // the reads side by side; through a request's readOnce store (lib/visit/read-once.ts) all of them, the view's
  // included, are answered from what the request already read
  const [lineRows, itemRows, stored, view] = await Promise.all([
    s.listUtterances(session.id, visit.id),
    s.listVisitItems(session.id, { visit_id: visit.id }),
    s.listQuestions(session.id),
    buildVisitView(s, session.id, visit.id, { session }),
  ]);
  const lines = liveUtterances(lineRows);
  const items = liveItems(itemRows);
  const storedById = new Map(stored.map((q) => [q.id, q]));
  const audience = visit.kind === "pharmacy" ? "pharmacist" : "doctor";
  const answerItem = (utteranceId: string) => items.find((it) => it.utterance_ids.includes(utteranceId) && (it.type === "answer" || it.type === "target"));
  const answerOk = (utteranceId: string) => {
    const it = answerItem(utteranceId);
    return !!it && verdictOf(it) === "right";
  };
  // what is written, and what is said about it afterwards, in the list's order (the writes go side by side: one round
  // trip to the database for all his answered questions, not two per question)
  const writes: { write: () => Promise<QuestionRow>; say: (row: QuestionRow) => void }[] = [];
  for (const q of view?.qlist?.items ?? []) {
    const ans = q.answer && answerOk(q.answer.utteranceId) ? q.answer : null;
    const patch = ans
      ? {
          status: "answered" as const,
          answer_text: ans.text,
          answer_utterance_id: ans.utteranceId,
          answer_visit_id: visit.id,
          answer_speaker: lines.find((u) => u.id === ans.utteranceId)?.role ?? ans.role,
          asked_at_visit_id: visit.id,
        }
      : null;
    if (q.questionId) {
      const questionId = q.questionId;
      const was = storedById.get(questionId) ?? null;
      if (patch) {
        if (was && was.status === "answered" && was.answer_utterance_id === patch.answer_utterance_id) continue;
        writes.push({
          write: () => s.updateQuestion(session.id, questionId, patch),
          say: (row) => publish(session.id, "question.updated", `Question answered at visit ${visit.id}: "${short(row.text)}"`, { question: row }),
        });
      } else if (was && was.status === "answered" && was.answer_visit_id === visit.id && q.answer && was.answer_utterance_id === q.answer.utteranceId) {
        writes.push({
          write: () => s.updateQuestion(session.id, questionId, { status: "open", answer_text: null, answer_utterance_id: null, answer_visit_id: null, answer_speaker: null }),
          say: (row) => publish(session.id, "question.updated", `He took back an answer of visit ${visit.id}: "${short(row.text)}" is open again`, { question: row }),
        });
      }
    } else if (createRippleQuestions && !storedById.has(q.id)) {
      const text = locale === "en" ? q.text.en ?? q.text.zh ?? "" : q.text.zh ?? q.text.en ?? "";
      writes.push({
        write: () =>
          s.addQuestion(session.id, {
            id: q.id,
            for: audience,
            origin: "before_you_go",
            text,
            lang: locale,
            status: patch ? "answered" : "open",
            created_day: visit.day,
            asked_at_visit_id: patch ? visit.id : null,
            evidence: q.why,
            ...(patch ?? {}),
          }),
        say: (row) => publish(session.id, "question.created", `Question from visit ${visit.id}: "${short(row.text)}" (${row.status})`, { question: row }),
      });
    }
  }
  const rows = await Promise.all(writes.map((w) => w.write()));
  writes.forEach((w, i) => w.say(rows[i]));
}

/**
 * The store of one answer of the review: each of his tables is read once for the whole request, together, at its start
 * (lib/visit/read-once.ts; the first run against the real database: 「就这样，存好」 asked the store 72 times, 66 of them
 * one after another, and took more than ten seconds). What the request writes it reads again; nothing else.
 */
async function reviewStore(store: Store, session: SessionRow, visitId: string): Promise<Store> {
  const s = readOnce(store);
  await warmVisitReads(s, session, visitId);
  return s;
}

export async function confirmVisit(store: Store, session: SessionRow, visitId: string, input: ConfirmInput): Promise<VisitView> {
  const s = await reviewStore(store, session, visitId);
  const visit = await mustVisit(s, session.id, visitId);
  const locale = input.locale ?? "zh-Hans";
  await applyVerdicts(s, session, visit, input.items, { mine: new Set(input.mine), locale });
  // C2 track E: a demo's re-watch (a replay copy of a seeded visit) is checked on its own screen; the story's questions
  // keep the answers of the visit itself (they are that visit's record, not the copy's)
  if (!demoRewatch(session, visit)) await syncAnswers(s, session, visit, locale, true);
  const updated = await s.updateVisit(session.id, visitId, { status: "confirmed" });
  const sample = isSampleVisit(session, visit);
  publish(session.id, "visit.changed", `${sample ? "Sample recording: visit" : "Visit"} ${visitId}: he confirmed the record`, { visit: updated, ...(sample ? { sample: true } : {}) });
  return (await buildVisitView(s, session.id, visitId, { session }))!;
}

/**
 * One answer of the one-line-at-a-time review (C2), saved as he taps: the items of one line (a card's rows, or an
 * answer), before or after he confirmed the visit. After it was confirmed it is an edit: the item's history keeps it,
 * and his question list follows (an answer he takes back is open again).
 */
export async function setItemVerdict(
  store: Store,
  session: SessionRow,
  visitId: string,
  input: { items: string[]; verdict: ItemVerdict; locale?: "en" | "zh-Hans" },
): Promise<VisitView> {
  const s = await reviewStore(store, session, visitId);
  const visit = await mustVisit(s, session.id, visitId);
  if (visit.status !== "review" && visit.status !== "confirmed") throw new VisitError("invalid", `visit ${visitId} is ${visit.status}: nothing to check yet`);
  if (input.items.length === 0) throw new VisitError("invalid", "no item");
  const locale = input.locale ?? "zh-Hans";
  await applyVerdicts(s, session, visit, Object.fromEntries(input.items.map((id) => [id, input.verdict])), { mine: null, locale });
  if (visit.status === "confirmed" && !demoRewatch(session, visit)) await syncAnswers(s, session, visit, locale, false);
  publish(session.id, "visit.changed", `Visit ${visitId}: he ${visit.status === "confirmed" ? "changed" : "answered"} one line of the record`, {
    visit_id: visitId,
    verdict: input.verdict,
    items: input.items,
  });
  return (await buildVisitView(s, session.id, visitId, { session }))!;
}

/**
 * 「哪几句是我说的」 (real-app 2.15: 他点出哪几句是自己说的), one line at a time, saved as he taps, before or after he
 * confirmed the visit. For a line whose speaker nobody could tell: `mine: true` makes it his own (patient, confirmed);
 * `mine: false` gives a line he had marked back (unknown again). A line he already said is the clinician's (an item
 * he answered 「是」 to) is not his to take here: he changes that answer first. Nothing else about the line changes.
 */
export async function setLineMine(store: Store, session: SessionRow, visitId: string, input: { line: string; mine: boolean }): Promise<VisitView> {
  const s = await reviewStore(store, session, visitId);
  const visit = await mustVisit(s, session.id, visitId);
  if (visit.status !== "review" && visit.status !== "confirmed") throw new VisitError("invalid", `visit ${visitId} is ${visit.status}: nothing to check yet`);
  const u = liveUtterances(await s.listUtterances(session.id, visit.id)).find((x) => x.id === input.line);
  if (!u) throw new VisitError("invalid", `unknown utterance ${input.line}`);
  let next: { role: UtteranceRole; role_state: "confirmed" | "unknown" } | null = null;
  if (input.mine) {
    const items = liveItems(await s.listVisitItems(session.id, { visit_id: visit.id }));
    const clinicians = items.some((it) => it.utterance_ids.includes(u.id) && verdictOf(it) === "right") || (CLINICIAN_ROLES.includes(u.role) && u.role_state === "confirmed");
    if (clinicians) throw new VisitError("invalid", "he said this line is the clinician's: that answer is changed first");
    if (!(u.role === "patient" && u.role_state === "confirmed")) next = { role: "patient", role_state: "confirmed" };
  } else if (u.role === "patient") {
    next = { role: "unknown", role_state: "unknown" };
  }
  if (next) {
    await s.updateUtterance(session.id, u.id, next);
    publish(session.id, "utterance.role", `He ${input.mine ? "said a line was his own" : "took back that a line was his own"}`, {
      visit_id: visit.id,
      changes: [{ id: u.id, role: next.role, state: next.role_state }],
    });
  }
  return (await buildVisitView(s, session.id, visitId, { session }))!;
}

// ------------------------------------------------------------------ fallback switch

/**
 * Throws unless this scope may use the scripted fallback: a filming scope (never a judge sandbox, never an ordinary
 * account). That the caller is the crew is the route's own check (lib/crew/gate.ts isCrew, real-app 5.2: one gate):
 * every caller of processChunk's `fallback` option and of setScriptedFallback has asked it.
 */
function assertFallbackAllowed(session: SessionRow): void {
  if (!fallbackAllowed(session)) throw new VisitError("fallback_filming_only");
}

/**
 * Switch the scripted fallback for a visit. For the crew only: the route (POST /api/visits/[id]/scripted) and the
 * director's filming-account action have asked lib/crew/gate.ts before calling. In a judge sandbox the answer is always
 * fallback_filming_only.
 */
export async function setScriptedFallback(s: Store, session: SessionRow, visitId: string, on: boolean): Promise<boolean> {
  assertFallbackAllowed(session);
  await mustVisit(s, session.id, visitId);
  visitLive(session.id, visitId).fallbackOn = on;
  return on;
}

export { StoreError };
