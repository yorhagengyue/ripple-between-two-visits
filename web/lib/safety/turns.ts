/**
 * Today's questions and answers, kept (C2 track S; real-status v1 「刷新以后，之前的问答全没了」, real-app 12 「今天页留着今天问过的
 * 问答，能往回翻」; journeys 04 and 07). Server-only.
 *
 * POST /api/ask writes each ask as two chat_message rows of the scope (the foundation's table, 0007): his words (role
 * patient) and Ripple's answer (role ripple, `answer` = the answer as it was shown: StoredAnswer), both carrying the ask's
 * safety_event id. GET /api/ask/history and the /p/ask screen read them back by story day (askTurns), so a refresh, another
 * tab or track K's chat screen shows the same conversation.
 *
 * His own record: rows go through the subject's scoped store (an account's come back with session_id ""), and nothing
 * here is shared with his family (her view is built elsewhere, from her switches). What is kept of an answer is what was on
 * his screen, never the safety layer's inner record (candidates, the three checks, blocked sentences: safety_event).
 */
import type { ChatMessageRow, Store } from "@/lib/store/types";
import { renderText } from "./render";
import type { AskResult, Locale } from "./types";

/**
 * An answer as his screen showed it (AskResult without the safety record, timings or model details). Ripple's own
 * explanation of the quotes (gloss.ts) is kept as it was shown, so a re-read draws the same words in the same place.
 */
export type StoredAnswer = Pick<
  AskResult,
  "route" | "sentences" | "addedQuestionId" | "questionReused" | "reusedQuestion" | "fixedText" | "fixedTextZh" | "locale" | "answeredBefore" | "noAiConsent" | "costLimited" | "gloss"
>;

/** One ask: his words and Ripple's answer (null when the answer row is missing). */
export interface AskTurn {
  /** his message's id */
  id: string;
  day: number;
  /** when he asked (ISO) */
  at: string;
  text: string;
  lang: string | null;
  answer: StoredAnswer | null;
  /**
   * chit-chat only (route cant_help: 「这个我帮不上，要我记下来吗？」): his words are among that day's notes, so the screen says
   * 「记下了。」 instead of offering 「记下来」 again (askTurns sets it; a turn just answered has none)
   */
  noted?: boolean;
}

export function storedAnswer(r: AskResult): StoredAnswer {
  return {
    route: r.route,
    sentences: r.sentences,
    locale: r.locale,
    ...(r.addedQuestionId ? { addedQuestionId: r.addedQuestionId } : {}),
    ...(r.questionReused ? { questionReused: r.questionReused } : {}),
    ...(r.reusedQuestion ? { reusedQuestion: r.reusedQuestion } : {}),
    ...(r.fixedText ? { fixedText: r.fixedText } : {}),
    ...(r.fixedTextZh ? { fixedTextZh: r.fixedTextZh } : {}),
    ...(r.answeredBefore ? { answeredBefore: r.answeredBefore } : {}),
    ...(r.noAiConsent ? { noAiConsent: r.noAiConsent } : {}),
    ...(r.costLimited ? { costLimited: r.costLimited } : {}),
    ...(r.gloss ? { gloss: r.gloss } : {}),
  };
}

/**
 * Keep one ask and its answer as today's two chat rows (his words, then Ripple's). Both are written side by side (C2
 * latency pass: one round trip, not two): his row is asked for first, and pairTurns pairs them by their safety event,
 * whatever order the database numbers them in.
 */
export async function recordAskTurn(
  store: Store,
  sessionId: string,
  ask: { day: number; text: string; lang: string | null; result: AskResult },
): Promise<AskTurn> {
  const safetyEventId = ask.result.events[0]?.id ?? null;
  const answer = storedAnswer(ask.result);
  const locale: Locale = ask.result.locale;
  const [mine] = await Promise.all([
    store.addChatMessage(sessionId, { day: ask.day, role: "patient", text: ask.text, lang: ask.lang, safety_event_id: safetyEventId }),
    store.addChatMessage(sessionId, {
      day: ask.day,
      role: "ripple",
      text: renderText(ask.result, locale),
      lang: locale,
      safety_event_id: safetyEventId,
      answer,
    }),
  ]);
  return { id: mine.id, day: mine.day, at: mine.created_at, text: mine.text, lang: mine.lang, answer };
}

function isStoredAnswer(v: unknown): v is StoredAnswer {
  return !!v && typeof v === "object" && typeof (v as { route?: unknown }).route === "string" && Array.isArray((v as { sentences?: unknown }).sentences);
}

/**
 * The asks of one story day, oldest first, each with its answer: his row and the Ripple row with the same safety event (or,
 * without one, the Ripple row right after it). Rows another writer left (his lines with no answer yet) come with answer null.
 */
export function pairTurns(rows: ChatMessageRow[]): AskTurn[] {
  const turns: AskTurn[] = [];
  const used = new Set<string>();
  rows.forEach((m, i) => {
    if (m.role !== "patient") return;
    let reply: ChatMessageRow | undefined;
    if (m.safety_event_id) reply = rows.find((r) => r.role === "ripple" && r.safety_event_id === m.safety_event_id && !used.has(r.id));
    else if (rows[i + 1]?.role === "ripple" && !rows[i + 1].safety_event_id) reply = rows[i + 1];
    if (reply) used.add(reply.id);
    turns.push({ id: m.id, day: m.day, at: m.created_at, text: m.text, lang: m.lang, answer: reply && isStoredAnswer(reply.answer) ? reply.answer : null });
  });
  return turns;
}

/**
 * The asks of story day `day`, oldest first (pairTurns of the scope's chat rows); a chit-chat turn says whether he had its
 * words written down that day (`noted`: a note with the same words).
 */
export async function askTurns(store: Store, sessionId: string, day: number): Promise<AskTurn[]> {
  const turns = pairTurns(await store.listChatMessages(sessionId, { fromDay: day, toDay: day }));
  if (!turns.some((t) => t.answer?.route === "cant_help")) return turns;
  const notes = new Set((await store.listNotes(sessionId, { fromDay: day, toDay: day })).map((n) => n.text.trim()));
  return turns.map((t) => (t.answer?.route === "cant_help" ? { ...t, noted: notes.has(t.text.trim()) } : t));
}
