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
 *
 * The guided harness (2026-10-16, lib/safety/risk/types.ts): an answer may end on one scripted follow-up question with
 * buttons (AskResult.followUp); it is kept with the answer, so a refreshed page draws it again. His tap is a new ask whose
 * `text` is the option's words and whose `reply` names the question and the options he chose; that reply is kept on his
 * own row (the patient row's `answer` slot, which held nothing: { reply }), so the page can tell the question was
 * answered, and with what, and draws it that way. The risk summary (AskResult.risk) is never kept here: it never reaches
 * his screen.
 */
import type { ChatMessageRow, Store } from "@/lib/store/types";
import type { FollowUpReply } from "./risk/types";
import { renderText } from "./render";
import type { AskResult, Locale } from "./types";

/**
 * An answer as his screen showed it (AskResult without the safety record, timings or model details). Ripple's own
 * explanation of the quotes (gloss.ts) is kept as it was shown, so a re-read draws the same words in the same place; so is
 * the harness's follow-up question (2026-10-16), and never its risk summary.
 */
export type StoredAnswer = Pick<
  AskResult,
  "route" | "sentences" | "addedQuestionId" | "questionReused" | "reusedQuestion" | "fixedText" | "fixedTextZh" | "locale" | "answeredBefore" | "noAiConsent" | "costLimited" | "gloss" | "followUp"
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
  /**
   * harness (2026-10-16): this ask was his tap on an earlier answer's follow-up question (the question's id and the options
   * he chose; `text` is their words). The earlier answer's question is drawn answered, with these options marked.
   */
  reply?: FollowUpReply;
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
    ...(r.followUp ? { followUp: r.followUp } : {}),
  };
}

/** What his own row keeps beside his words: the follow-up he answered with this ask (harness, 2026-10-16). */
interface StoredAsk {
  reply: FollowUpReply;
}

function storedReply(v: unknown): FollowUpReply | undefined {
  const r = v && typeof v === "object" ? (v as Partial<StoredAsk>).reply : undefined;
  if (!r || typeof r.followUpId !== "string" || !Array.isArray(r.optionIds)) return undefined;
  const optionIds = r.optionIds.filter((id): id is string => typeof id === "string");
  return optionIds.length ? { followUpId: r.followUpId, optionIds } : undefined;
}

/**
 * Keep one ask and its answer as today's two chat rows (his words, then Ripple's). Both are written side by side (C2
 * latency pass: one round trip, not two): his row is asked for first, and pairTurns pairs them by their safety event,
 * whatever order the database numbers them in.
 */
export async function recordAskTurn(
  store: Store,
  sessionId: string,
  ask: { day: number; text: string; lang: string | null; result: AskResult; reply?: FollowUpReply },
): Promise<AskTurn> {
  const safetyEventId = ask.result.events[0]?.id ?? null;
  const answer = storedAnswer(ask.result);
  const locale: Locale = ask.result.locale;
  // his tap on a follow-up question: kept on his own row, so the question it answered is drawn answered on a re-read
  const kept: StoredAsk | null = ask.reply ? { reply: { followUpId: ask.reply.followUpId, optionIds: [...ask.reply.optionIds] } } : null;
  const [mine] = await Promise.all([
    store.addChatMessage(sessionId, { day: ask.day, role: "patient", text: ask.text, lang: ask.lang, safety_event_id: safetyEventId, ...(kept ? { answer: kept } : {}) }),
    store.addChatMessage(sessionId, {
      day: ask.day,
      role: "ripple",
      text: renderText(ask.result, locale),
      lang: locale,
      safety_event_id: safetyEventId,
      answer,
    }),
  ]);
  return { id: mine.id, day: mine.day, at: mine.created_at, text: mine.text, lang: mine.lang, answer, ...(kept ? { reply: kept.reply } : {}) };
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
    const answered = storedReply(m.answer);
    turns.push({ id: m.id, day: m.day, at: m.created_at, text: m.text, lang: m.lang, answer: reply && isStoredAnswer(reply.answer) ? reply.answer : null, ...(answered ? { reply: answered } : {}) });
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
