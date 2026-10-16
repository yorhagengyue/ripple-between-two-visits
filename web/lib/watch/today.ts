/**
 * The watch on Today and his answer to it (journey 12; 老人端提示词 12.2: 「你的静息心率三周都高于你平时的范围，要把这件事加进
 * 下次 check-in 的问题吗？」回答「要」「不要」). Server-only.
 *
 *   watchToday(store, scope, locale)        the card for Today's watch slot, or null: no watch data, nothing outside
 *                                           his usual range, or he answered this stretch on an earlier day. The day he
 *                                           answers, the card stays (answered: 「已在下次看诊的问题单里」 or 「好，不加。」), so a
 *                                           refresh of Today never takes it away while he reads it
 *   answerWatch(store, scope, key, answer)  要: a question for the doctor goes on his list (origin watch_pattern, track C's
 *                                           addQuestionFor; never a visit item, never "go and see a doctor"); 不要: only
 *                                           this look is kept. Either way the same stretch is not raised again.
 *
 * His answers are kept in his scope's settings under `watch_answers` (track K's key; no migration):
 *   { "rhr:above": { day, answer: "yes" | "no", question_id? } }
 * The same stretch: the stretch now on screen began on or before the day he answered. Once his numbers come back into
 * his usual range and later leave it again, that is a new stretch and he is asked again. At most one card a day: the day
 * he answered, only that card (answered).
 *
 * Accounts only: a demo session (a judge's sandbox, the crew's session) has no watch, gets no card and keeps no answer
 * (its scope row is never written: updateScope is an account's own).
 */
import { addQuestionFor } from "@/lib/profile/questions";
import type { Locale } from "@/lib/i18n";
import type { SessionRow, Store } from "@/lib/store/types";
import { watchData } from "./data";
import { METRIC_INFO, type WatchMetric } from "./metrics";
import { episodeFor, episodeKey, observe, SPECS, type WatchEpisode } from "./observe";
import { ASK_SENTENCE, observationSentence, questionText, usualWords } from "./sentences";

export const ANSWERS_KEY = "watch_answers";

export interface WatchAnswerRecord {
  day: number;
  answer: "yes" | "no";
  question_id?: string;
}

export type WatchAnswers = Record<string, WatchAnswerRecord>;

export function watchAnswers(scope: Pick<SessionRow, "settings">): WatchAnswers {
  const raw = scope.settings?.[ANSWERS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WatchAnswers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<WatchAnswerRecord> | null;
    if (r && typeof r.day === "number" && (r.answer === "yes" || r.answer === "no")) out[k] = { day: r.day, answer: r.answer, ...(typeof r.question_id === "string" ? { question_id: r.question_id } : {}) };
  }
  return out;
}

/** He already answered this stretch (it began on or before the day he answered). */
export function answeredStretch(e: WatchEpisode, answers: WatchAnswers): WatchAnswerRecord | null {
  const a = answers[episodeKey(e)];
  return a && e.runStart <= a.day ? a : null;
}

export interface WatchCardData {
  /** "rhr:above": what his answer is kept under */
  key: string;
  metric: WatchMetric;
  /** the observation, a fixed sentence in `locale` */
  sentence: string;
  /** 「要把这件事加进下次 check-in 的问题吗？」 */
  ask: string;
  /** his usual range in words, 「63–69 次/分」 */
  usual: string;
  /** the metric's name, 「静息心率」 */
  name: string;
  /** the numbers are the example account's synthetic watch (示例数据) */
  example: boolean;
  /** he answered this card today (it stays on screen for the day, answered); null: still asking */
  answered: { answer: "yes" | "no"; questionId: string | null } | null;
}

export function cardOf(e: WatchEpisode, locale: Locale, example: boolean): WatchCardData {
  return {
    key: episodeKey(e),
    metric: e.metric,
    sentence: observationSentence(e, locale),
    ask: ASK_SENTENCE[locale],
    usual: usualWords(e.metric, e.usual, locale),
    name: METRIC_INFO[e.metric].name[locale],
    example,
    answered: null,
  };
}

/** Today's stretch outside his usual range that he has not answered yet, with the data it came from. */
export async function currentEpisode(store: Store, scope: SessionRow): Promise<{ episode: WatchEpisode | null; example: boolean; answeredToday: boolean }> {
  const data = await watchData(store, scope);
  const answers = watchAnswers(scope);
  const answeredToday = Object.values(answers).some((a) => a.day === scope.story_day);
  const episode = data.has ? observe(data.series, scope.story_day, (e) => answeredStretch(e, answers) !== null) : null;
  return { episode, example: data.source === "example", answeredToday };
}

/**
 * The card for Today's watch slot (track B's TodayLayout `watch`) and the watch screen: the stretch he answered today
 * (answered), else the one he has not answered, else null.
 */
export async function watchToday(store: Store, scope: SessionRow, locale: Locale): Promise<WatchCardData | null> {
  if (scope.kind !== "account") return null;
  const data = await watchData(store, scope);
  if (!data.has) return null;
  const example = data.source === "example";
  const answers = watchAnswers(scope);
  const todays = Object.entries(answers).find(([, a]) => a.day === scope.story_day);
  if (todays) {
    const [key, a] = todays;
    const spec = SPECS.find((sp) => episodeKey(sp) === key);
    const e = spec ? episodeFor(spec, data.series[spec.metric] ?? [], scope.story_day) : null;
    return e ? { ...cardOf(e, locale, example), answered: { answer: a.answer, questionId: a.question_id ?? null } } : null;
  }
  const episode = observe(data.series, scope.story_day, (e) => answeredStretch(e, answers) !== null);
  return episode ? cardOf(episode, locale, example) : null;
}

export type WatchAnswerResult =
  | { ok: true; answer: "yes" | "no"; questionId: string | null; outcome: "created" | "merged" | "reopened" | "answered" | null }
  | { ok: false; status: 409; error: "nothing_to_answer" };

/** His 要 / 不要 on the stretch now on screen (`key` must still be it). */
export async function answerWatch(store: Store, scope: SessionRow, key: string, answer: "yes" | "no", locale: Locale): Promise<WatchAnswerResult> {
  if (scope.kind !== "account") return { ok: false, status: 409, error: "nothing_to_answer" };
  const { episode } = await currentEpisode(store, scope);
  if (!episode || episodeKey(episode) !== key) return { ok: false, status: 409, error: "nothing_to_answer" };
  let questionId: string | null = null;
  let outcome: "created" | "merged" | "reopened" | "answered" | null = null;
  if (answer === "yes") {
    const r = await addQuestionFor(store, scope, {
      for: "doctor",
      origin: "watch_pattern",
      text: questionText(episode, locale),
      lang: locale,
      evidence: JSON.stringify({ kind: "watch", metric: episode.metric, direction: episode.direction, count: episode.count, unit: episode.unit, usual: { low: episode.usual.low, high: episode.usual.high }, recent: episode.recent }),
    });
    questionId = r.question.id;
    outcome = r.outcome;
  }
  const answers = { ...watchAnswers(scope), [key]: { day: scope.story_day, answer, ...(questionId ? { question_id: questionId } : {}) } };
  await store.updateScope(scope.id, { settings: { [ANSWERS_KEY]: answers } });
  return { ok: true, answer, questionId, outcome };
}
