/**
 * Signs for his doctor (10-14, the owner's decision: 「记下这个信号，下次告诉医生；不是问题，只是要告诉医生的情况：什么时候、几点
 * 出现了不舒服」). Server-only.
 *
 * Two kinds, both kept with their time and never judged:
 *   his words      chest pain, a stroke sign or a reading above his doctor's warning line that he told Ripple (POST
 *                  /api/ask: lib/safety/pipeline.ts, classify.ts signalFamily) are kept as his note, word for word, the
 *                  moment he said them. The note is marked by its app_reply (SIGNAL_REPLY_PREFIX: the column is free
 *                  text, so no migration), so it can be listed here as "for the doctor".
 *   his readings   a reading he recorded above his doctor's own warning line (lib/safety/threshold.ts rule A: the line the
 *                  blood pressure page relays and the brief quotes). Nothing is written for it: the reading itself is the
 *                  record, so a reading he corrects or deletes is listed as it is now (or not at all).
 *
 * listDoctorSignals: both kinds since his last visit that happened (lib/visit/happened.ts; a clinic visit, not the
 * pharmacy: on an account one that happened today too, and then only what came after it started; on the demo, as its
 * brief counts, a visit before the story day), or over the last SIGNAL_LOOKBACK_DAYS days when no visit happened yet;
 * newest first. The visit brief shows his words in a section of their own (lib/summary: 「要告诉医生的情况」), its
 * readings next to the doctor's line as before.
 */
import { clockWords, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { warningLineFor } from "@/lib/safety/threshold";
import { isAccount, scopeD0, scopeTz } from "@/lib/store/scope";
import type { NoteRow, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { isClinicVisit } from "@/lib/summary/window";
import { localDate, localHHMM } from "@/lib/time/clock";
import { happenedVisits } from "@/lib/visit/happened";

/** NoteRow.app_reply of his words kept for his doctor: "signal for the doctor: <kind>" (chest, stroke, reading). */
export const SIGNAL_REPLY_PREFIX = "signal for the doctor";

/** The app_reply that marks a note as kept for his doctor. */
export function signalReply(kind: string): string {
  return `${SIGNAL_REPLY_PREFIX}: ${kind}`;
}

/** A note kept for his doctor (signalReply). */
export function isSignalNote(note: Pick<NoteRow, "app_reply">): boolean {
  return typeof note.app_reply === "string" && note.app_reply.startsWith(SIGNAL_REPLY_PREFIX);
}

/** How far back the signs are listed when no visit has happened yet. */
export const SIGNAL_LOOKBACK_DAYS = 30;

/** His date and clock time of a moment: "YYYY-MM-DD" and "HH:MM" (null: the date only). */
export interface SignalMoment {
  date: string;
  time: string | null;
}

/**
 * When a sign was kept, his own date and time. An account: the moment the row was written (the server's clock), in his time
 * zone. The demo: its story date, and the story clock time it was said at when there is one (`storyTime`; a row's own
 * created_at is the real clock there, not the story's).
 */
export function signalMoment(scope: SessionRow, row: { day: number; created_at: string }, storyTime: string | null = null): SignalMoment {
  const ms = Date.parse(row.created_at);
  if (isAccount(scope) && Number.isFinite(ms)) return { date: localDate(ms, scopeTz(scope)), time: localHHMM(ms, scopeTz(scope)) };
  return { date: storyDate(scopeD0(scope), row.day), time: storyTime };
}

/** The moment in words, as the sentence that says it was kept writes it: 「10月14日 16:20」 / "14 Oct, 4:20 pm". */
export function signalMomentWords(locale: Locale, m: SignalMoment): string {
  if (locale === "zh-Hans") return m.time ? `${shortDay(locale, m.date)} ${m.time}` : shortDay(locale, m.date);
  return m.time ? `${shortDay(locale, m.date)}, ${clockWords(locale, m.time)}` : shortDay(locale, m.date);
}

/** One sign for his doctor (listDoctorSignals). */
export interface DoctorSignal {
  /** the note's or the reading's id */
  id: string;
  /** when it was written (ISO) */
  at: string;
  /** his date, YYYY-MM-DD */
  day: string;
  /** his own words as stored; for a reading, the reading as he recorded it (「血压 185/112」 / "Blood pressure 185/112") */
  text: string;
  lang: string | null;
}

/** A sign as the brief and the lists use it: which kind, its story day, and his clock time on an account (null on the demo). */
export interface SignalItem extends DoctorSignal {
  kind: "note" | "reading";
  dayNumber: number;
  time: string | null;
}

/** The visit the signs are counted from (see the header), or null when none happened yet. */
async function lastVisit(store: Store, scope: SessionRow, visits: VisitRow[]): Promise<VisitRow | null> {
  const today = scope.story_day;
  const happened = (await happenedVisits(store, scope.id, visits)).filter((v) => isClinicVisit(v) && (isAccount(scope) ? v.day <= today : v.day < today));
  return happened.sort((a, b) => a.day - b.day || ms(a.created_at) - ms(b.created_at)).at(-1) ?? null;
}

/** An instant as epoch ms (rows from either store; a missing or odd one counts as the earliest). */
const ms = (iso: string): number => {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
};

const readingWords = (locale: Locale, systolic: number, diastolic: number | null) =>
  `${locale === "zh-Hans" ? "血压" : "Blood pressure"} ${systolic}/${diastolic ?? ""}`.replace(/\/$/, "");

/**
 * Every sign since his last visit (or over the last SIGNAL_LOOKBACK_DAYS days), newest first. `readings: false` leaves his
 * readings out (the brief shows them next to the doctor's line already).
 */
export async function doctorSignalItems(store: Store, scope: SessionRow, locale: Locale, opts: { readings?: boolean } = {}): Promise<SignalItem[]> {
  const today = scope.story_day;
  const withReadings = opts.readings !== false;
  const [visits, notes, readings, line] = await Promise.all([
    store.listVisits(scope.id),
    store.listNotes(scope.id, { toDay: today }),
    withReadings ? store.listBp(scope.id, { toDay: today }) : Promise.resolve([]),
    withReadings ? warningLineFor(store, scope.id, { day: today, time: scope.story_time ?? null }) : Promise.resolve(null),
  ]);
  const since = await lastVisit(store, scope, visits);
  // (on the visit's own day, what came from the moment it started: a visit row is written when its recording starts)
  const counts = (day: number, at: string) =>
    since ? day > since.day || (day === since.day && ms(at) >= ms(since.created_at)) : day > today - SIGNAL_LOOKBACK_DAYS;
  const account = isAccount(scope);
  const items: SignalItem[] = [];
  for (const n of notes) {
    if (!isSignalNote(n) || !counts(n.day, n.created_at)) continue;
    const m = signalMoment(scope, n);
    items.push({ kind: "note", id: n.id, at: n.created_at, day: m.date, dayNumber: n.day, time: account ? m.time : null, text: n.text, lang: n.lang });
  }
  if (line) {
    for (const r of readings) {
      if (r.state !== "recorded" || r.systolic === null || !(r.systolic > line.systolic) || r.deleted_at || !counts(r.day, r.created_at)) continue;
      const m = signalMoment(scope, r);
      items.push({ kind: "reading", id: r.id, at: r.created_at, day: m.date, dayNumber: r.day, time: account ? m.time : null, text: readingWords(locale, r.systolic, r.diastolic), lang: locale });
    }
  }
  return items.sort((a, b) => b.dayNumber - a.dayNumber || ms(b.at) - ms(a.at));
}

/**
 * The signs for his doctor since his last visit that happened (or over the last 30 days when there is none), newest
 * first: his own words as stored (chest pain, a stroke sign, a reading he told Ripple), and his readings above the
 * doctor's own warning line; each with the moment it was written (ISO) and his date.
 */
export async function listDoctorSignals(store: Store, scope: SessionRow, locale: Locale): Promise<{ id: string; at: string; day: string; text: string; lang: string | null }[]> {
  return (await doctorSignalItems(store, scope, locale)).map(({ id, at, day, text, lang }) => ({ id, at, day, text, lang }));
}
