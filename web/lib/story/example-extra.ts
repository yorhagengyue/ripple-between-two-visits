/**
 * More of Mr Tan's everyday record, laid out only on an example account (owner 10-15: 「顺手多塞一点数据」; data in
 * web/fixtures/example-extra.json). The story template (web/fixtures/timeline.seed.json) stays as the demo, the crew's
 * filming account and the tests read it; buildExampleSpace (./example.ts) adds these rows to what it lays out:
 *   - morning readings on most days after v2 and a few evening ones, in the story's own range (higher on the four
 *     tai chi mornings his tablet was missed), so the week and the month are not empty;
 *   - notes in his own words about his day, one of them kept for his doctor as a sign (lib/daily/signals.ts: it shows
 *     under 「要告诉医生的情况」 and in the brief, dated as written);
 *   - two questions of his own, open.
 * The same file names the example's doctor (fictional, as the clinic) and the visits' details the rows have no column
 * for (today's visit at 10:30, the clinic visits' doctor): lib/daily/visit-details.ts reads them into the settings.
 * Each row is dated on its story day at the time the file gives (Singapore), so a note written on day 38 says day 38,
 * not the moment the space was laid out. Ids start with "x-" (never one of the template's). Nothing clinical is
 * invented: no doctor's words, no medicine, no diagnosis. Pure (no store, no clock of its own).
 */
import extraJson from "@/fixtures/example-extra.json";
import { signalReply } from "@/lib/daily/signals";
import type { BpReadingRow, DaySlot, NoteRow, NoteSource, QuestionFor, QuestionRow } from "@/lib/store/types";
import { storyDate } from "./clock";

interface ExtraFile {
  meta: { time_zone: string };
  bp_readings: { day: number; slot: string; time: string; systolic: number; diastolic: number }[];
  notes: { day: number; time: string; text_zh: string; source: string; signal?: string }[];
  questions: { id: string; for: string; origin: string; created_day: number; text_zh: string }[];
  /** the template's own readings, made new values on an example account (10-15: within his target after the tablet started) */
  bp_overrides?: { day: number; slot: string; systolic: number; diastolic: number }[];
}

const EXTRA = extraJson as ExtraFile;

/**
 * A template reading as an example account lays it out: the file's override for its day and slot when there is one (the
 * same row, new numbers), else unchanged.
 */
export function exampleReading<R extends { day: number; slot: string; systolic: number | null; diastolic: number | null }>(row: R): R {
  const o = EXTRA.bp_overrides?.find((x) => x.day === row.day && x.slot === row.slot);
  return o ? { ...row, systolic: o.systolic, diastolic: o.diastolic } : row;
}

/** The moment of a story day at a clock time, in the file's time zone, as an ISO string (UTC). */
function at(d0: string, day: number, time: string): string {
  return new Date(`${storyDate(d0, day)}T${time}:00${EXTRA.meta.time_zone}`).toISOString();
}

/** Whether an example account gets these rows: always, except where RIPPLE_EXAMPLE_EXTRA=off (the unit tests). */
export function exampleExtraOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.RIPPLE_EXAMPLE_EXTRA !== "off";
}

export interface ExampleExtraTables {
  bp_readings: BpReadingRow[];
  notes: NoteRow[];
  questions: QuestionRow[];
}

/** The extra rows for an example space whose day 0 is `d0`, only the days before `beforeDay` (today is not laid out). */
export function exampleExtraTables(scopeId: string, d0: string, beforeDay: number): ExampleExtraTables {
  const bp_readings: BpReadingRow[] = EXTRA.bp_readings
    .filter((b) => b.day < beforeDay)
    .map((b) => ({
      id: `x-bp-d${b.day}-${b.slot}`,
      session_id: scopeId,
      day: b.day,
      slot: b.slot as DaySlot,
      systolic: b.systolic,
      diastolic: b.diastolic,
      state: "recorded",
      note: null,
      created_at: at(d0, b.day, b.time),
    }));
  const notes: NoteRow[] = EXTRA.notes
    .filter((n) => n.day < beforeDay)
    .map((n, i) => ({
      id: `x-note-d${n.day}-${i + 1}`,
      session_id: scopeId,
      day: n.day,
      text: n.text_zh,
      source: n.source as NoteSource,
      lang: "zh-Hans",
      app_reply: n.signal ? signalReply(n.signal) : null,
      created_at: at(d0, n.day, n.time),
    }));
  const questions: QuestionRow[] = EXTRA.questions
    .filter((q) => q.created_day < beforeDay)
    .map((q) => ({
      id: q.id,
      session_id: scopeId,
      for: q.for as QuestionFor,
      origin: q.origin as QuestionRow["origin"],
      text: q.text_zh,
      lang: "zh-Hans",
      status: "open",
      answer_text: null,
      answer_utterance_id: null,
      answer_visit_id: null,
      answer_speaker: null,
      asked_at_visit_id: null,
      created_day: q.created_day,
      evidence: null,
      created_at: at(d0, q.created_day, "12:00"),
    }));
  return { bp_readings, notes, questions };
}
