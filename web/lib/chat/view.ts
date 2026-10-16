/**
 * His conversation with Ripple, kept day by day (journey 04; M13 step 6 「对话按天存」; 老人端提示词 04.2: 一天一段记录，按时间排，
 * 他的话和 Ripple 的固定回答分得清). Server-only.
 *
 *   chatDay(store, scope, day, locale)   one day's turns, oldest first, and the other days he talked (newest first)
 *   chatToday(store, scope, locale)      Today's chat slot: how many today, the last exchange, earlier days
 *
 * The rows are the scope's chat_message rows, all kept by track S (lib/safety/turns.ts recordAskTurn, read back with
 * askTurns): every sentence he says goes through POST /api/ask, chit-chat included (S's cant_help route: 「这个我帮不上，要
 * 我记下来吗？」, `noted` once his words are among that day's notes). Track K writes no chat row. Under a note about a
 * symptom his doctor talked about, the doctor's own line rides along (lib/chat/related.ts) with whether his words are on
 * his question list already. Nothing here writes a sentence or names the scope.
 */
import { clipTime, dateWords, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { questionKey } from "@/lib/profile/questions";
import { askTurns, type AskTurn, type StoredAnswer } from "@/lib/safety/turns";
import { scopeD0, scopeTz } from "@/lib/store/scope";
import type { QuestionRow, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { localHHMM } from "@/lib/time/clock";
import { relatedDoctorLine } from "./related";
import { confirmedClinicianLines, type SaidLine } from "./said";
import { zhLookup, type ZhLookup } from "@/lib/translate/shown";

/** A doctor's line as the chat screen quotes it. */
export interface QuotedLineView {
  visitId: string;
  utteranceId: string;
  text: string;
  lang: "en" | "zh-Hans";
  /** the visit's date, short: 「9月6日」 / "6 Sep" */
  date: string;
  /** time point in the recording, 「0:37」 */
  at: string;
  clipUrl: string | null;
  standIn: boolean;
  /** C2 track S (round 2; real-app 12): the checked Chinese of the doctor's English words (lib/translate/shown.ts), or null */
  zh?: string | null;
}

export interface ChatTurnView {
  /** his row's id */
  id: string;
  /** when he said it, HH:MM in his zone */
  time: string;
  text: string;
  lang: string | null;
  /** Ripple's answer (track S's), word for word as it was shown; null when the answer row is missing */
  answer: StoredAnswer | null;
  /** chit-chat (route cant_help): his words are among that day's notes (S's askTurns) */
  noted: boolean;
  /** a note about a symptom his doctor talked about: the doctor's line */
  related: QuotedLineView | null;
  /** his words are on his question list already (only looked up where `related` is) */
  added: { questionId: string } | null;
  /** Ripple's check-in question 「今天的药吃了吗？」 is in the answer (its reply buttons lead to Today) */
  checkIn: boolean;
}

export interface ChatDayRef {
  day: number;
  date: string;
  /** what he said that day */
  count: number;
}

export interface ChatDayView {
  day: number;
  date: string;
  dateWords: string;
  isToday: boolean;
  turns: ChatTurnView[];
  /** the other days with a conversation, newest first */
  days: ChatDayRef[];
}

function quoted(line: SaidLine, locale: Locale, zh?: ZhLookup): QuotedLineView {
  return {
    zh: zh?.(line.text) ?? null,
    visitId: line.visitId,
    utteranceId: line.utteranceId,
    text: line.text,
    lang: line.lang,
    date: shortDay(locale, line.visitDate),
    at: clipTime(line.tStartMs),
    clipUrl: line.clipUrl,
    standIn: line.standIn,
  };
}

function sameWordsQuestion(questions: QuestionRow[], text: string): QuestionRow | null {
  const k = questionKey(text);
  return questions.find((q) => q.for === "doctor" && !q.merged_into && questionKey(q.text) === k) ?? null;
}

/** S's turns of one day as the chat screen draws them (before the doctor's line and the question list are looked up). */
export function turnsOf(turns: AskTurn[], tz: string): Omit<ChatTurnView, "related" | "added">[] {
  return turns.map((t) => ({
    id: t.id,
    time: localHHMM(Date.parse(t.at), tz),
    text: t.text,
    lang: t.lang,
    answer: t.answer,
    noted: t.noted === true,
    checkIn: !!t.answer?.sentences.some((s) => s.templateId === "check_in_dose"),
  }));
}

/** Days he talked to Ripple (his own lines counted), newest first. */
export async function chatDays(store: Store, scope: SessionRow): Promise<ChatDayRef[]> {
  const rows = await store.listChatMessages(scope.id, { toDay: scope.story_day });
  const d0 = scopeD0(scope);
  const counts = new Map<number, number>();
  for (const r of rows) if (r.role === "patient") counts.set(r.day, (counts.get(r.day) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([day, count]) => ({ day, date: storyDate(d0, day), count }));
}

export async function chatDay(store: Store, scope: SessionRow, day: number, locale: Locale): Promise<ChatDayView> {
  const d0 = scopeD0(scope);
  const [kept, days] = await Promise.all([askTurns(store, scope.id, day), chatDays(store, scope)]);
  const base = turnsOf(kept, scopeTz(scope));
  const notes = base.filter((t) => t.answer?.route === "log_only");
  let doctorLines: SaidLine[] = [];
  let questions: QuestionRow[] = [];
  // (C2 track S, round 2: and the checked Chinese under the doctor's English words)
  let zh: ZhLookup | undefined;
  if (notes.length) [doctorLines, questions, zh] = await Promise.all([confirmedClinicianLines(store, scope, { roles: ["doctor"] }), store.listQuestions(scope.id), zhLookup(store, scope, { locale })]);
  const turns: ChatTurnView[] = base.map((t) => {
    const line = t.answer?.route === "log_only" ? relatedDoctorLine(t.text, doctorLines) : null;
    const q = line ? sameWordsQuestion(questions, t.text) : null;
    return { ...t, related: line ? quoted(line, locale, zh) : null, added: q ? { questionId: q.id } : null };
  });
  const date = storyDate(d0, day);
  return { day, date, dateWords: dateWords(locale, date), isToday: day === scope.story_day, turns, days: days.filter((d) => d.day !== day) };
}

export interface ChatTodayData {
  /** what he said today */
  count: number;
  /** today's last exchange: his words and the first line of Ripple's reply */
  last: { text: string; reply: string | null } | null;
  /** earlier days with a conversation */
  earlierDays: number;
}

function firstLine(t: Omit<ChatTurnView, "related" | "added">, locale: Locale): string | null {
  const s = t.answer?.sentences[0];
  if (!s) return null;
  return locale === "zh-Hans" && s.zh ? s.zh : s.en;
}

/** Today's chat slot (track B's TodayLayout `chat`): null when he never talked to Ripple. */
export async function chatToday(store: Store, scope: SessionRow, locale: Locale): Promise<ChatTodayData | null> {
  const day = scope.story_day;
  const [kept, days] = await Promise.all([askTurns(store, scope.id, day), chatDays(store, scope)]);
  const turns = turnsOf(kept, scopeTz(scope));
  const earlierDays = days.filter((d) => d.day < day).length;
  if (!turns.length && !earlierDays) return null;
  const last = turns[turns.length - 1];
  return { count: turns.length, last: last ? { text: last.text, reply: firstLine(last, locale) } : null, earlierDays };
}
