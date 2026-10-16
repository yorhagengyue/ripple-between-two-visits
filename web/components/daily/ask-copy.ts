/**
 * The words of the 问一句 screens that are Ripple's own interface (C2 track S): labels, buttons, the date line and the
 * waiting words. Nothing clinical: every clinical sentence on these screens comes from lib/safety (a quote with its source,
 * a label, a leaflet line or a fixed template). Client-safe.
 */
import { GENERAL_NOTE, GLOSS_NOTE } from "@/lib/safety/gloss-note";
import { NO_AI_SENTENCE } from "@/lib/safety/no-ai";
import type { UiLocale } from "@/lib/ui/tokens";

export interface AskCopy {
  section: string;
  prompt: readonly string[];
  promptAgain: string;
  fieldLabel: string;
  earlier: string;
  earlierCount: (n: number) => string;
  showAnswer: string;
  todayAsked: (n: number) => string;
  sending: string;
  /** SSE (owner 10-15): the line under his question while Ripple writes its own answer (`sending` is the line before it) */
  writing: string;
  failed: string;
  /** C2 track O (real-app 2.25): asking needs the network and is never queued */
  offline: string;
  /** his hour's questions are used up: asking works again at `at` (the next full hour, "11:00") */
  tooMany: (at: string | null) => string;
  /** his day's allowance is used up: asking works again tomorrow (his next midnight) */
  tooManyToday: string;
  listen: string;
  listening: string;
  translation: string;
  questions: string;
  /** real-app 4.5: his question was already on the list from an earlier day: when he asked it before (a short date) */
  askedBefore: (date: string) => string;
  /** real-app 2.10: the one sentence for "no consent to AI processing" (lib/safety/no-ai.ts), on the screen and as a footer */
  noAi: string;
  /** under that sentence on the ask screen: the way to where he changes it (「我 → AI 处理」; the words the medicine and visit screens use) */
  noAiChange: string;
  whatsapp: string;
  doctorSaid: string;
  pharmacistSaid: string;
  dispenserSaid: string;
  recordFrom: string;
  leafletFrom: (title: string) => string;
  /** under chit-chat Ripple has nothing for (route cant_help): the offer, done, and a failed save */
  writeDown: string;
  written: string;
  writeFailed: string;
  /** the microphone (components/today/AskMic.tsx): his recording is being turned into words */
  voiceSending: string;
  /** nothing was heard in the recording */
  voiceNothing: string;
  /** the speech service did not make the words: typing still works */
  voiceFailed: string;
  /** 10-14: the quiet line under Ripple's own explanation of the quotes (lib/safety/gloss.ts, gloss-note.ts) */
  glossNote: string;
  /** owner 10-15: the quiet line under Ripple's own answer (lib/safety/general.ts, gloss-note.ts GENERAL_NOTE) */
  generalNote: string;
  /** owner 10-15: under Ripple's own answer, when it suggests asking someone: put his question on that list */
  offerToList: (who: "doctor" | "pharmacist") => string;
  /** owner 10-15: after he tapped it */
  offerAdded: string;
  /** owner 10-15: the list could not be reached */
  offerFailed: string;
  /**
   * 10-14: the chips after each sentence of that explanation, naming the quote it rests on (a visit line's chip adds the
   * date it was said: 「医生 9月10日」); who said a visit line is worded as its own entry words it (「好像是医生」 until he
   * confirmed the speaker)
   */
  glossFrom: { doctor: string; inferredDoctor: string; pharmacist: string; dispenser: string; label: string; leaflet: string };
  /**
   * the guided harness (2026-10-16): under a follow-up question where more than one answer may be chosen, the button that
   * sends what he ticked (the question and its options are lib/safety's own words, templates.ts)
   */
  followUpDone: string;
  /** 10-16: when the question cannot show on arrival with the 995 line, the chip that takes him to it */
  followUpChip: string;
}

const ZH: AskCopy = {
  // owner 10-14: the screen's name is 「提问」 (it was 「问一句」); 记下 / 记下了 are 记录 / 已记录
  section: "提问",
  prompt: ["想问什么，", "打字问。"],
  promptAgain: "还想问什么，打字问。",
  fieldLabel: "打字问",
  earlier: "今天早些时候问过的",
  earlierCount: (n) => `今天问过 ${n} 次`,
  showAnswer: "看回答",
  todayAsked: (n) => `今天问过 ${n} 次`,
  sending: "在找医生说过的话……",
  writing: "正在写……",
  failed: "没有发出去，再试一次。",
  offline: "要连上网才能问。",
  tooMany: (at) => (at ? `这个小时问得太多了，${at} 以后再问。` : "这个小时问得太多了，请稍后再问。"),
  tooManyToday: "今天问得太多了，明天再问。",
  listen: "听原声",
  listening: "正在播",
  translation: "中文翻译，以英文原话为准",
  questions: "去问题单",
  askedBefore: (date) => `${date} 问过 · 已在问题单`,
  noAi: NO_AI_SENTENCE.zh,
  noAiChange: "去「我」里改",
  whatsapp: "WhatsApp 发文字",
  doctorSaid: "医生说",
  pharmacistSaid: "药剂师说",
  dispenserSaid: "柜台说",
  recordFrom: "你自己的记录",
  leafletFrom: (title) => `单张：${title}`,
  writeDown: "记录下来",
  written: "已记录。",
  writeFailed: "未能记录，请再点一次。",
  voiceSending: "正在转成文字……",
  voiceNothing: "没听清。再说一次，或者打字问。",
  voiceFailed: "现在转不成文字，先打字问。",
  glossNote: GLOSS_NOTE.zh,
  generalNote: GENERAL_NOTE.zh,
  offerToList: (who) => (who === "pharmacist" ? "加到问题单，问药剂师" : "加到问题单，问医生"),
  offerAdded: "已加到问题单。",
  offerFailed: "没加上，请再试一次。",
  glossFrom: { doctor: "医生", inferredDoctor: "好像是医生", pharmacist: "药剂师", dispenser: "柜台", label: "药品标签", leaflet: "单张" },
  followUpDone: "好了",
  followUpChip: "Ripple 想问你一句 ↓",
};

const EN: AskCopy = {
  section: "Ask",
  prompt: ["What would you like", "to ask? Type it."],
  promptAgain: "Anything else? Type it.",
  fieldLabel: "Type your question",
  earlier: "Asked earlier today",
  earlierCount: (n) => `Asked ${n} ${n === 1 ? "time" : "times"} earlier today`,
  showAnswer: "Answer",
  todayAsked: (n) => `Asked ${n} ${n === 1 ? "time" : "times"} today`,
  sending: "Looking for what your doctor said…",
  writing: "Writing…",
  failed: "That did not go through. Try again.",
  offline: "You need a connection to ask.",
  tooMany: (at) => (at ? `Too many questions this hour. Ask again after ${at}.` : "Too many questions this hour. Ask again a little later."),
  tooManyToday: "Too many questions today. Ask again tomorrow.",
  listen: "Play the recording",
  listening: "Playing",
  translation: "Translation, the original words come first",
  questions: "Go to the question list",
  askedBefore: (date) => `Asked on ${date} · on your list`,
  noAi: NO_AI_SENTENCE.en,
  noAiChange: "Change it under Me",
  whatsapp: "WhatsApp text",
  doctorSaid: "Doctor said",
  pharmacistSaid: "Pharmacist said",
  dispenserSaid: "Counter staff said",
  recordFrom: "Your own records",
  leafletFrom: (title) => `Leaflet: ${title}`,
  writeDown: "Write it down",
  written: "Noted.",
  writeFailed: "That did not save. Tap again.",
  voiceSending: "Turning it into words…",
  voiceNothing: "I did not catch that. Say it again, or type it.",
  voiceFailed: "I can't turn speech into words right now. Please type it.",
  glossNote: GLOSS_NOTE.en,
  generalNote: GENERAL_NOTE.en,
  offerToList: (who) => (who === "pharmacist" ? "Add to my questions for the pharmacist" : "Add to my questions for the doctor"),
  offerAdded: "Added to your questions.",
  offerFailed: "That did not work. Please try again.",
  glossFrom: { doctor: "Doctor", inferredDoctor: "Probably the doctor", pharmacist: "Pharmacist", dispenser: "Counter staff", label: "Label", leaflet: "Leaflet" },
  followUpDone: "Done",
  followUpChip: "Ripple has a question for you ↓",
};

export function askCopy(locale: UiLocale): AskCopy {
  return locale === "en" ? EN : ZH;
}

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string): { y: number; m: number; d: number; w: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return { y, m: mo, d, w: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** "10月10日 周六" / "Sat 10 Oct" from "2026-10-10". */
export function dateLine(iso: string, locale: UiLocale): string {
  const p = parts(iso);
  if (!p) return iso;
  return locale === "en" ? `${WEEKDAYS_EN[p.w]} ${p.d} ${MONTHS_EN[p.m - 1]}` : `${p.m}月${p.d}日 周${WEEKDAYS_ZH[p.w]}`;
}

/** "9月6日" / "6 Sep" from "2026-09-06" (the date a line was said). */
export function shortDate(iso: string, locale: UiLocale): string {
  const p = parts(iso);
  if (!p) return iso;
  return locale === "en" ? `${p.d} ${MONTHS_EN[p.m - 1]}` : `${p.m}月${p.d}日`;
}

/**
 * What he reads when POST /api/ask answers 429 (real-app 2.10; C2 round 2): which limit it was decides the sentence, so
 * each one is true. `limit` "tokens_per_day": his day's allowance, back at his next midnight: 「今天问得太多了，明天再问。」.
 * Anything else is the hourly limit: 「这个小时问得太多了，11:00 以后再问。」 with the time the server gave (retryAt: the next
 * full hour). `body`: the 429's JSON as it came.
 */
export function limitWords(locale: UiLocale, body: { limit?: unknown; retryAt?: unknown } | null | undefined): string {
  const copy = askCopy(locale);
  if (body?.limit === "tokens_per_day") return copy.tooManyToday;
  return copy.tooMany(clockAt(typeof body?.retryAt === "string" ? body.retryAt : null));
}

/**
 * The row under an answer that says where his question went (real-app 4.5; C2 round 2): a question that was already on his
 * list from an earlier day says when he asked it, with the real date (「你 9月22日 也问过，已经在问题单里」); a new one, or one
 * from today, says `added` (「已在下次看诊的问题单里」).
 */
export function questionRowWords(locale: UiLocale, answer: { questionReused?: boolean; reusedQuestion?: { date: string } }, added: string): string {
  const r = answer.questionReused ? answer.reusedQuestion : undefined;
  return r ? askCopy(locale).askedBefore(shortDate(r.date, locale)) : added;
}

/** "10:42" in Singapore time, for "ask again after 10:42". */
export function clockAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).format(new Date(t));
}
