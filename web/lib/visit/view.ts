/**
 * Builds the visit screen's data (VisitView) from the store: lines with speaker state, the three card types
 * (doctor's notes, checks, the question list) and the three counters. Used by the visit routes, the replay
 * loop and the server-rendered pages. Server-only.
 */
import { speechProviderName, isStandInClip } from "@/lib/asr";
import { fixtureUtterances, replayIdForAudioFixture } from "@/lib/asr/fixtures";
import { getDrug } from "@/lib/kb/load";
import { findDrugMentions } from "@/lib/kb/match";
import { clipUrlFor } from "@/lib/safety/candidates";
import { aiConsent } from "@/lib/safety/consent";
import { classifyRules } from "@/lib/safety/classify";
import { askedWordsByQuestion, isPatternOrigin, questionWords } from "@/lib/daily/questions";
import type { QuestionWording } from "@/lib/daily/types";
import { TEMPLATES } from "@/lib/safety/templates";
import type { MedicationRow, SessionRow, Store, UtteranceRow, VisitItemRow, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { scopeD0, scopeRoutine } from "@/lib/store/scope";
import { bpTrigger, buildBpCheck, buildMedCheck, buildNoteCheck, medTrigger, noteTrigger, targetFromR1, type RoutineEntry } from "./checks";
import { crewKeySource } from "./crew";
import { DOC_CARD_TYPES, variantOf } from "./extract";
import { fallbackAllowed, filmingSession } from "./fallback";
import { isMedicationText, matchingLabel } from "./medication";
import { buildQuestionList, questionListAnchor, type QListDraft } from "./questions";
import { accountCheckSummary, bpCheckFromSummary, briefThree, medCheckFromSummary, visitStartedMs } from "./account-check";
import type { VisitCheckSummary } from "@/lib/summary/visit-check";
import { isClinician } from "./roles";
import { SUPERSEDED_LANG, visitLive } from "./state";
import { addDays, looksLikeQuestion } from "./text";
import { verdictHistory, verdictOf } from "./verdict";
import { copiedFrom, happenedVisits, isReplayCopy } from "./happened";
import { visitNotes } from "./own-note";
import { isSummaryItem, storedSummary } from "./summary-item";
import { readOnce, warm } from "./read-once";
import { transcriptGaveUp } from "./transcript-tries";
import { keptTranslations } from "./translate";
import type {
  CardView,
  CheckCardView,
  ClipView,
  DocCardView,
  DocRow,
  LineView,
  MarkView,
  QItemView,
  RoleDisplay,
  VisitAccountView,
  VisitView,
} from "./types";

export const liveUtterances = (rows: UtteranceRow[]): UtteranceRow[] => rows.filter((u) => u.lang !== SUPERSEDED_LANG);
export const liveItems = (rows: VisitItemRow[]): VisitItemRow[] => rows.filter((it) => it.slots?.superseded !== true);

/**
 * The replay file that stands in for this visit's audio (mock speech), or null: only the visit's own audio_fixture
 * decides (the template's visits v1, v2, p1, v3 and the example account's planned visit carry one); a visit whose id
 * happens to be "v1" without it never replays (C2, real-app H6).
 */
export function replayFixtureFor(visit: Pick<VisitRow, "id" | "audio_fixture">): string | null {
  return replayIdForAudioFixture(visit.audio_fixture);
}

/** Drug ids of prescriptions he was already taking before this visit. */
export function priorPrescriptions(meds: MedicationRow[], visitDay: number): string[] {
  return [
    ...new Set(
      meds.filter((m) => m.origin === "prescription" && m.drug_id && m.start_day !== null && m.start_day < visitDay).map((m) => m.drug_id!),
    ),
  ];
}

/** The last clinic (not pharmacy) visit before this one. */
export function previousClinicVisit(visits: VisitRow[], visit: VisitRow): VisitRow | null {
  return (
    visits
      .filter((v) => v.id !== visit.id && v.kind !== "pharmacy" && v.day < visit.day)
      .sort((a, b) => b.day - a.day)[0] ?? null
  );
}

/** The line's clip link: with &session= for a demo session (a bare id string is one), never an account's id. */
export function clipUrl(scope: string | (Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind">>), visitId: string, utteranceId: string): string {
  return clipUrlFor(scope, visitId, utteranceId);
}

function drugName(id: string): string {
  return getDrug(id)?.display_name ?? id;
}

/** A medicine card whose speaker is only inferred: headed "To confirm", not a clinician's note (components/visit/labels.ts). */
export function isToConfirm(c: Pick<DocCardView, "medication" | "display">): boolean {
  return c.medication && c.display !== "confirmed" && c.display !== "label";
}

function displayOf(u: Pick<UtteranceRow, "role_state" | "role">, medication: boolean, label: MedicationRow | null): RoleDisplay {
  if (u.role_state === "confirmed") return "confirmed";
  // a clinician's medicine sentence that agrees with a confirmed label may show who said it
  if (medication && label && isClinician(u.role)) return "label";
  if (u.role_state === "inferred") return "inferred";
  return "unknown";
}

export interface ViewOptions {
  /** override the session row (tests) */
  session?: SessionRow;
}

/**
 * What an account's review page says beyond the record: his own lines about the visit, whether its transcript is still
 * awaited or could not be made, whether his consent to AI processing is off, and whether it is the example's sample
 * visit. The consent is his account's row: read only through a store that may (his own page's, or a plain store in a
 * test); her view and a scheduled job's store never ask (false).
 */
async function accountView(
  store: Store,
  session: SessionRow,
  visit: VisitRow,
  notes: { id: string; text: string; created_at: string }[],
  visits: VisitRow[],
  items: VisitItemRow[],
): Promise<VisitAccountView> {
  const ownNotes = visitNotes(notes, visit.id).map((n) => ({ id: n.id, text: n.text, at: n.created_at }));
  const transcript = visit.status === "awaiting_transcript" ? (transcriptGaveUp(await store.listDeliveries(session.id), visit.id) ? ("failed" as const) : ("waiting" as const)) : null;
  const mode = (store as { mode?: string }).mode;
  const mayReadConsent = mode === undefined || mode === "self";
  // not while he is recording (the live screen builds this view for every sentence)
  const aiOffNow = mayReadConsent && visit.status !== "recording" ? !(await aiConsent(store, session)) : false;
  // how this visit's record was made, kept with the visit when it was made (0016_f_visit_made): the sentence describes
  // this visit, not his setting as it happens to be today. Before the record is made, and for a visit made before
  // this was kept, his setting as it is now.
  const recorded = (visit.status === "review" || visit.status === "confirmed") && typeof visit.ai_used === "boolean";
  const aiOff = !mayReadConsent ? false : recorded ? visit.ai_used === false : aiOffNow;
  // the follow-up planned from a line of this visit (planFollowUp: "<item id>-planned"), while it is still to come
  const mine = new Set(items.map((it) => `${it.id}-planned`));
  const planned = visits.find((v) => v.status === "planned" && mine.has(v.id)) ?? null;
  const followUp = planned ? { id: planned.id, date: planned.date, approx: !planned.script_section?.endsWith(":booked") } : null;
  return { ownNotes, transcript, aiOff, aiOffFrom: recorded ? "record" : "setting", aiOffNow, sample: !!replayFixtureFor(visit) || isReplayCopy(visit), followUp };
}

/**
 * The transcripts of other visits this screen reads (asked for together, lib/visit/read-once.ts): a visit that is not
 * confirmed yet (did it happen? lib/visit/happened.ts), and on an account the earlier visits whose target or warning
 * line the readings are put next to and the visits that answered his questions (track B's visitCheckSummary).
 */
function otherTranscripts(session: SessionRow, visitId: string, visits: VisitRow[], items: VisitItemRow[], questions: { answer_visit_id?: string | null }[]): string[] {
  const need = new Set<string>();
  for (const v of visits) if (v.status !== "planned" && v.status !== "confirmed" && !isReplayCopy(v)) need.add(v.id);
  if (session.kind === "account") {
    const known = new Set(visits.map((v) => v.id));
    for (const it of items) if ((it.type === "target" || it.type === "threshold") && known.has(it.visit_id)) need.add(it.visit_id);
    for (const q of questions) if (q.answer_visit_id && known.has(q.answer_visit_id)) need.add(q.answer_visit_id);
  }
  need.delete(visitId);
  return [...need];
}

/**
 * Everything the visit screen reads, asked for together: his tables in one round trip to the database, then the other
 * visits' transcripts it needs in a second one. `store` is a request's readOnce store (lib/visit/read-once.ts): every
 * read after this, the brief's numbers included, is answered from it. Read failures are left to the code that needs
 * the rows. Called by buildVisitView, and at the start of each answer of the review (lib/visit/pipeline.ts).
 */
export async function warmVisitReads(store: Store, session: SessionRow, visitId: string): Promise<void> {
  const sessionId = session.id;
  const account = session.kind === "account";
  const mode = (store as { mode?: string }).mode;
  // his consent to AI processing is his account's row: read only through a store that may (accountView)
  const mayReadConsent = account && !!session.owner_user_id && (mode === undefined || mode === "self");
  await warm([
    store.listVisits(sessionId),
    store.listUtterances(sessionId, visitId),
    store.listVisitItems(sessionId),
    store.listMeds(sessionId),
    store.listQuestions(sessionId),
    store.listBp(sessionId),
    store.listDoses(sessionId),
    store.listNotes(sessionId),
    ...(account ? [store.listSafetyEvents(sessionId), store.listTranslations(sessionId)] : []),
    ...(mayReadConsent ? [store.listConsentRecords(session.owner_user_id!)] : []),
  ]);
  const [visits, items, questions] = await Promise.all([store.listVisits(sessionId), store.listVisitItems(sessionId), store.listQuestions(sessionId)]).catch(() => [[], [], []] as [VisitRow[], VisitItemRow[], { answer_visit_id?: string | null }[]]);
  await warm(otherTranscripts(session, visitId, visits, items, questions).map((id) => store.listUtterances(sessionId, id)));
}

export async function buildVisitView(base: Store, sessionId: string, visitId: string, opts: ViewOptions = {}): Promise<VisitView | null> {
  // one request reads each table once (lib/visit/read-once.ts): what this screen needs is asked for together here. A
  // caller that already holds such a store (the review's answers, lib/visit/pipeline.ts) shares its reads.
  const store = readOnce(base);
  const session = opts.session ?? (await store.getSession(sessionId));
  if (!session) return null;
  const account = session.kind === "account";
  await warmVisitReads(store, session, visitId);
  const visit = await store.getVisit(sessionId, visitId);
  if (!visit) return null;
  const [uttsAll, itemsEvery, meds, visits, questions, bp, doses, notes] = await Promise.all([
    store.listUtterances(sessionId, visitId),
    store.listVisitItems(sessionId),
    store.listMeds(sessionId),
    store.listVisits(sessionId),
    store.listQuestions(sessionId),
    store.listBp(sessionId),
    store.listDoses(sessionId),
    store.listNotes(sessionId),
  ]);
  // Ripple's summary is read apart (account.summary below): it is never a card, a question's answer or the record
  const itemsAll = itemsEvery.filter((it) => it.visit_id === visitId && !isSummaryItem(it));
  const requiredLines = itemsEvery.filter((it) => (it.required_line ?? null) !== null);
  const d0 = scopeD0(session);
  const utts = liveUtterances(uttsAll);
  // items he said are not right stay on the screen, flagged (C2: never deleted); they no longer answer questions
  const cardItems = liveItems(itemsAll);
  const items = cardItems.filter((it) => it.slots?.rejected !== true);
  const live = visitLive(sessionId, visitId);
  const ended = visit.status !== "recording" || live.stream?.state === "ended";

  // C2: an account's check cards and question list count as the brief does at the moment the visit started (track B's
  // visitCheckSummary, lib/visit/account-check.ts); read once, only when a card or the list needs it
  const startedMs = visitStartedMs(visit, itemsAll, uttsAll);
  let summary: Promise<VisitCheckSummary> | null = null;
  const checkSummary = () => (summary ??= accountCheckSummary(store, session, visit, startedMs));

  // ---- question list first: answers to medicine questions count as medicine sentences
  const qLines = utts.map((u) => ({ id: u.id, text: u.text, role: u.role, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms }));
  // an account's clinic visit lists the brief's three questions (and any asked or answered in it), not every open one
  let listed = questions;
  let three: Set<string> | undefined;
  // which words a question is shown with on an account (lib/daily/questions.ts questionWords, as his question list
  // does): his own latest words once he asked it himself; a question that is only a recorded summary (the example's
  // seeded 「读数高的时候…可以多吃一粒吗？」 before he asks it) is never shown as what he said
  const shownWords = new Map<string, { text: string; wording: QuestionWording }>();
  if (account && visit.kind !== "pharmacy" && questionListAnchor(qLines, ended) >= 0) {
    three = briefThree(await checkSummary());
    // Ripple's own questions for this visit (rq-<visit>-…) keep their rows too
    const brief = three;
    listed = questions.filter((q) => brief.has(q.id) || q.asked_at_visit_id === visit.id || q.answer_visit_id === visit.id || q.id.startsWith(`rq-${visit.id}-`));
  }
  if (account) {
    const asked = await askedWordsByQuestion(store, sessionId);
    for (const q of listed) {
      if (isPatternOrigin(q.origin)) shownWords.set(q.id, { text: q.text, wording: "pattern" });
      else {
        const words = questionWords(q, asked.get(q.id));
        shownWords.set(q.id, { text: words.text, wording: words.wording });
      }
    }
  }
  // C2 track E: a demo's re-watch (a replay copy of a seeded visit) lists the questions of the visit it copies (the
  // seed's questions name that visit: asked there, answered there), so its screen shows what that visit's would
  const listOwner = !account ? copiedFrom(visit) : null;
  const qdraft: QListDraft | null = buildQuestionList({
    visit: listOwner ? { ...visit, id: listOwner } : visit,
    lines: qLines,
    items,
    questions: listed,
    requiredLines,
    visits,
    priorPrescriptions: priorPrescriptions(meds, visit.day),
    ended,
    listedBefore: three,
  });

  // ---- lines
  const labelOpts = visit.status === "recording" ? { before: visit.date } : { notAfter: storyDate(d0, session.story_day) };
  const itemsByLine = new Map<string, VisitItemRow[]>();
  for (const it of cardItems) for (const id of it.utterance_ids) itemsByLine.set(id, [...(itemsByLine.get(id) ?? []), it]);
  const medicationAnswer = new Set<string>();
  for (const q of qdraft?.items ?? []) if (q.medication && q.answerBy) medicationAnswer.add(q.answerBy);

  const marks = new Map<string, MarkView[]>();
  const addMark = (id: string, m: MarkView) => marks.set(id, [...(marks.get(id) ?? []), m]);
  const clipOf = (u: UtteranceRow): ClipView | null =>
    u.clip_path ? { url: clipUrl(session, visitId, u.id), standIn: isStandInClip(u.clip_path) } : null;

  // a side-effect line ("Some people get ankle swelling with this one. If you notice it, tell me.") names no
  // drug, but after a prescription in the same visit it is about that medicine: the hard rule applies to it too
  let prescribedEarlier = false;
  const lines: LineView[] = utts.map((u) => {
    const its = itemsByLine.get(u.id) ?? [];
    const medication =
      isMedicationText(u.text) ||
      medicationAnswer.has(u.id) ||
      its.some((it) => it.type === "medication" || it.type === "purpose") ||
      (prescribedEarlier && its.some((it) => variantOf(it) === "watch"));
    if (its.some((it) => it.type === "medication")) prescribedEarlier = true;
    const label = medication ? matchingLabel(u.text, meds, labelOpts) : null;
    for (const it of its) {
      if (it.type !== "medication") continue;
      for (const m of findDrugMentions(u.text)) addMark(u.id, { text: u.text.substr(m.index, m.alias.length), kind: "doc" });
    }
    return {
      id: u.id,
      tStartMs: u.t_start_ms,
      tEndMs: u.t_end_ms,
      text: u.text,
      lang: u.lang,
      role: u.role,
      roleState: u.role_state,
      display: displayOf(u, medication, label),
      medication,
      scriptedFallback: u.scripted_fallback,
      clip: clipOf(u),
      marks: [],
      inQuestion: qdraft?.lineToItem.get(u.id) ?? null,
    };
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // ---- doctor's-note cards: one per sentence
  const cards: CardView[] = [];
  for (const l of lines) {
    const its = (itemsByLine.get(l.id) ?? []).filter((it) => DOC_CARD_TYPES.includes(it.type));
    if (its.length === 0) continue;
    const rows: DocRow[] = its.map((it) => {
      const drug = typeof it.slots?.drug === "string" ? (it.slots.drug as string) : undefined;
      const days = typeof it.slots?.days === "number" ? (it.slots.days as number) : undefined;
      return {
        variant: variantOf(it),
        itemId: it.id,
        drug,
        drugName: drug ? drugName(drug) : undefined,
        strength: typeof it.slots?.strength === "string" ? (it.slots.strength as string) : undefined,
        isNew: it.slots?.is_new === true,
        dueDate: days !== undefined ? addDays(visit.date, days) : undefined,
        dueApprox: it.slots?.approx === true,
        requiredLine: it.required_line,
        confirmedBy: it.confirmed_by,
        verdict: verdictOf(it),
        disputed: it.slots?.disputed === true || it.slots?.rejected === true,
        // C2 track E: the demo's review says when an answer was changed after it was given
        ...(verdictHistory(it).length ? { changes: verdictHistory(it).length } : {}),
      };
    });
    const card: DocCardView = {
      id: `doc-${l.id}`,
      kind: "doc",
      anchor: l.id,
      rows,
      quote: l.text,
      tStartMs: l.tStartMs,
      role: l.role,
      display: l.display,
      medication: l.medication,
      clip: l.clip,
      disputed: rows.every((r) => r.disputed),
    };
    cards.push(card);
  }

  // ---- check cards: his words against his own records
  // the window starts after the last clinic visit that happened (an empty recording is not "the last visit")
  const prev = previousClinicVisit(await happenedVisits(store, sessionId, visits), visit);
  const fromDay = prev ? prev.day + 1 : Math.max(0, visit.day - 30);
  const toDay = visit.day - 1;
  const r1 = requiredLines.find((r) => r.required_line === "R1") ?? null;
  const r1Visit = r1 ? visits.find((v) => v.id === r1.visit_id) ?? null : null;
  let target = null;
  if (r1 && r1Visit && r1Visit.day < visit.day) {
    const r1Utts = liveUtterances(await store.listUtterances(sessionId, r1Visit.id));
    const said = r1Utts.find((u) => r1.utterance_ids.includes(u.id)) ?? null;
    const fixtureLine = (fixtureUtterances(r1Visit.id) ?? []).find((f) => f.text.trim() === r1.text.trim()) ?? null;
    // the seeded line of a confirmed visit is part of his confirmed record; a transcript line counts once he confirmed it
    const display: RoleDisplay = said ? (said.role_state === "confirmed" ? "confirmed" : "inferred") : r1Visit.status === "confirmed" ? "confirmed" : "inferred";
    target = targetFromR1(r1, r1Visit, display, said?.t_start_ms ?? fixtureLine?.t_start_ms ?? null);
  }
  const routine = scopeRoutine(session) as RoutineEntry[];
  const checkLines = lines.map((l) => ({ id: l.id, text: l.text, role: l.role }));
  for (let i = 0; i < checkLines.length; i++) {
    const l = lines[i];
    const mk = (body: Record<string, unknown>, check: string): CheckCardView =>
      ({ id: `chk-${l.id}-${check}`, kind: "chk", anchor: l.id, d0, ...body }) as unknown as CheckCardView;
    const bpPhrase = bpTrigger(checkLines, i);
    if (bpPhrase) {
      const data = account ? bpCheckFromSummary(await checkSummary(), bp, visit.day, startedMs) : buildBpCheck(bp, fromDay, toDay, d0, target);
      if (data) {
        cards.push(mk({ ...data }, "bp"));
        addMark(l.id, { text: bpPhrase, kind: "chk" });
      }
    }
    const medPhrase = medTrigger(checkLines, i);
    let medCard = false;
    if (medPhrase) {
      const data = account ? medCheckFromSummary(await checkSummary(), meds, drugName) : buildMedCheck(meds, doses, fromDay, toDay, d0, routine, drugName);
      if (data) {
        cards.push(mk({ ...data }, "med"));
        addMark(l.id, { text: medPhrase, kind: "chk" });
        medCard = true;
      }
    }
    const noteHit = noteTrigger(checkLines, i);
    if (noteHit) {
      // an account's notes: the summary's window, written before the visit started
      const data = account
        ? await (async () => {
            const w = (await checkSummary()).window;
            const before = notes.filter((n) => n.day < visit.day || Date.parse(n.created_at) <= startedMs);
            return buildNoteCheck(before, w.fromDay, w.toDay, d0, noteHit.symptoms);
          })()
        : buildNoteCheck(notes, fromDay, toDay, d0, noteHit.symptoms);
      if (data) {
        cards.push(mk({ ...data }, "note"));
        addMark(l.id, { text: noteHit.phrase, kind: "chk" });
      }
    }
    if (l.role === "patient" && !medCard) {
      const c = classifyRules(l.text, { doctorThresholdSystolic: null, meds });
      // only "nobody can identify it" (a relative's box, a Chinese-only label) asked as a question; a name the
      // glossary does not know (rule:unknown_name) is too easy to trip on ordinary Singlish words in a transcript
      if (c?.route === "unknown_med" && c.reason === "rule:unidentifiable" && looksLikeQuestion(l.text)) {
        cards.push(mk({ check: "unknown_med", en: TEMPLATES.unknown_med.en, zh: TEMPLATES.unknown_med.zh }, "unknown_med"));
      }
    }
  }
  for (const l of lines) l.marks = marks.get(l.id) ?? [];
  // an account's clinician lines: the Chinese kept at the end of the visit (never translated here)
  if (account) {
    const kept = await keptTranslations(store, sessionId, lines.filter((l) => isClinician(l.role)));
    for (const l of lines) l.translation = kept.get(l.id) ?? null;
  }

  // ---- question list view
  let qlist: VisitView["qlist"] = null;
  if (qdraft) {
    const qitems: QItemView[] = qdraft.items.map((d) => {
      const answerId = d.answerBy ?? d.autoAnswerBy;
      const ans = answerId ? lineById.get(answerId) ?? null : null;
      // an answer he said is not right stays in the list, flagged (its item is in cardItems, not in items)
      const answerItem = ans ? cardItems.find((it) => it.utterance_ids.includes(ans.id) && (it.type === "answer" || it.type === "target")) ?? null : null;
      // an account: the words his question list shows it with (his own latest words; never a recorded summary as his)
      const shown = d.questionId ? shownWords.get(d.questionId) : undefined;
      return {
        id: d.id,
        why: d.why,
        text: shown && d.text.own !== undefined ? { ...d.text, own: shown.text } : d.text,
        ...(shown ? { wording: shown.wording } : {}),
        createdDay: d.createdDay,
        questionId: d.questionId,
        state: ans ? "done" : d.askedBy ? "now" : "not_asked",
        askedBy: d.askedBy,
        answer: ans
          ? {
              utteranceId: ans.id,
              itemId: answerItem?.id ?? null,
              verdict: answerItem ? verdictOf(answerItem) : null,
              ...(answerItem && verdictHistory(answerItem).length ? { changes: verdictHistory(answerItem).length } : {}),
              text: ans.text,
              role: ans.role,
              display: ans.display,
              tStartMs: ans.tStartMs,
              auto: !d.answerBy,
            }
          : null,
        medication: d.medication || (ans?.medication ?? false),
      };
    });
    qlist = { anchor: qdraft.anchor, items: qitems, answered: qitems.filter((q) => q.state === "done").length };
  }

  // ---- order cards by their sentence
  const order = new Map(lines.map((l, i) => [l.id, i]));
  cards.sort((a, b) => (order.get(a.anchor) ?? 0) - (order.get(b.anchor) ?? 0));

  // ---- consent
  const screenConsent = items.find((it) => it.type === "consent" && it.slots?.variant === "screen") ?? null;
  const given = items.find((it) => it.type === "consent" && it.slots?.variant === "given") ?? null;
  const consentUtt = visit.consent_utterance_id ?? given?.utterance_ids[0] ?? null;
  // C2 follow-up (one gate): `allowed` says the scope can use the fallback (a filming scope); whether THIS browser may
  // switch it is the crew's cookie, asked by the screen (components/session/useCrewBrowser) and enforced by the route.
  // `unlockable`: a key exists on this server, so a filming phone that is not the crew's yet can sign in on the screen.
  const fb = fallbackAllowed(session);
  const unlockable = fb && crewKeySource() !== "none";

  let speech: VisitView["speech"] = "mock";
  try {
    speech = speechProviderName();
  } catch {
    speech = "mock";
  }

  return {
    visit: {
      id: visit.id,
      day: visit.day,
      date: visit.date,
      kind: visit.kind,
      place: visit.place,
      status: visit.status,
      audioPath: visit.audio_path,
      scriptSection: visit.script_section,
    },
    d0,
    consent: {
      given: !!(screenConsent || consentUtt),
      at: typeof screenConsent?.slots?.at === "string" ? (screenConsent.slots.at as string) : null,
      storyDay: typeof screenConsent?.slots?.story_day === "number" ? (screenConsent.slots.story_day as number) : null,
      storyTime: typeof screenConsent?.slots?.story_time === "string" ? (screenConsent.slots.story_time as string) : null,
      utteranceId: consentUtt,
      role: consentUtt ? lineById.get(consentUtt)?.role ?? null : null,
    },
    lines,
    cards,
    qlist,
    counts: {
      doc: cards.filter((c) => c.kind === "doc" && !isToConfirm(c)).length,
      toConfirm: cards.filter((c) => c.kind === "doc" && isToConfirm(c)).length,
      chk: cards.filter((c) => c.kind === "chk").length,
      q: qlist?.items.length ?? 0,
    },
    stream: live.stream
      ? { state: live.stream.state, fixture: live.stream.fixture, speed: live.stream.speed, startedAt: live.stream.startedAt }
      : { state: "idle", fixture: null, speed: 1, startedAt: null },
    fallback: { allowed: fb, on: fb && live.fallbackOn, unlockable },
    // C2 track E: the demo's replay of a visit that already happened is a re-watch (a copy): its screen says so
    ...(!account && isReplayCopy(visit) ? { rewatch: true } : {}),
    replayable: replayFixtureFor(visit),
    speech,
    ...(account ? { account: { ...(await accountView(store, session, visit, notes, visits, itemsAll)), summary: storedSummary(itemsEvery, visitId) } } : {}),
  };
}
