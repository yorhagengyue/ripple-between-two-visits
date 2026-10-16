/**
 * 「留意」 on her phone (/f/alert), as the owner decided it on 2026-10-14: it does not list every routine thing. It shows
 * what needs attention, each item with its detail and a follow-up, and sums everything else up in one line with a way
 * to her calendar. Server-only, read only: nothing here writes to his space (her look is logged by the page,
 * lib/care/access-log.ts; a question she puts on his list goes through lib/care/family-questions.ts) and nothing
 * settles a window (the scheduled job's).
 *
 *   herRecord(store, scope, input, nowMs)   his last ATTENTION_DAYS days as her switches allow them: the next planned
 *                                           visit, the items that need attention (newest first), and the routine
 *                                           entries of the last REST_DAYS days the one line is counted from
 *
 * What needs attention, each only while its switch is on (nothing is read for a switch that is off):
 *
 *   dose_missed  (dose_summary)     a part of a day in which he recorded a medicine as not taken: which medicines, and
 *                                   the reason in his own words (or that he gave none). Follow-up: a question for his
 *                                   doctor, worded by the reason he chose (the code stays here: it only picks the
 *                                   sentence). It is offered whatever stands on his list about the same habit: a line
 *                                   Ripple put there from the pattern in his log says what happened, this one asks what
 *                                   to do about it (owner 10-14: 「周四我要打太极，那么我周四能不能换个时间吃药」)
 *   no_reply     (no_reply_alert)   two reminders of a past day got no response and he has still not answered that part
 *                                   of the day. The medicines by name only with dose_summary on. Follow-up: call him.
 *                                   Today's open one is the block at the top of her screen (her home's data), and one he
 *                                   answered since is routine.
 *   bp_high      (bp_summary)       a reading above a number HIS DOCTOR gave and he confirmed (lib/visit/doctor-numbers:
 *                                   the confirmed target, the confirmed warning level; with neither, no reading is ever
 *                                   an item). Above the warning level: call him. Above the target: a question for the
 *                                   doctor that counts the last 7 days; the readings of one day fold into the highest.
 *   visit_soon   (questions_count)  the next planned visit is within VISIT_SOON_DAYS days and questions still wait.
 *   note         (notes)            each note of his in the last REST_DAYS days, word for word. Follow-up: a question.
 *
 * Everything else is routine: a dose taken, a reading that is not above the doctor's numbers (or with none confirmed), a
 * visit that happened. Not listed, only counted (`count`), from the last REST_DAYS days. His questions are neither
 * listed nor counted here: they are read only to say how many wait for the visit and which follow-up is on his list.
 *
 * The red line (the hackathon's, unchanged): Ripple never says what to take, how much, to change or to stop a medicine,
 * and never judges on its own. A follow-up is one of two things only: something she can do herself (call him), or a
 * QUESTION for his doctor built from his own record. A reading is compared with the doctor's own recorded number and
 * with nothing else, strictly ("above"): a reading equal to the number is not above it and is routine.
 *
 * Every entry says which switches show it (`switches`, any one of them) and which of its parts one switch alone shows
 * (`only`), so her open page takes a kind away the moment he switches it off (components/family/RecordFeed.tsx
 * allowedEntries), before the page is read again.
 *
 * Round trips: two rounds. First everything her switches allow, side by side (and whether he has acknowledged her link);
 * then, side by side again and only as needed: the moment his recorded answers are read at (which questions still
 * wait) and his doctor's numbers (once a reading is there to compare).
 */
import { outsideTarget, targetRule } from "@/lib/daily/bp-target";
// owner 10-15: the next visit's time and doctor (lib/daily/visit-details.ts)
import { doctorWords, visitDetail } from "@/lib/daily/visit-details";
import { buildDoseDay, scopeSlotSchedule, slotInstants, type DoseCell } from "@/lib/daily/cells";
import { shownState } from "@/lib/daily/dose-state";
import { DELIVERY } from "@/lib/daily/no-reply";
import { answerMoment, questionVisible, questionWaiting, type AnswerMoment } from "@/lib/daily/questions";
import { FIXED_REASONS, routineSlug, type RoutineEntry } from "@/lib/daily/schedule";
import { isDaySlot } from "@/lib/daily/slots";
import { NO_GRANTS } from "@/lib/family/types";
import type { Locale } from "@/lib/i18n";
import { QUESTION_TEXT_MAX, questionKey } from "@/lib/profile/questions";
import { isAccount, scopeD0, scopeRoutine, scopeTz } from "@/lib/store/scope";
import type { BpReadingRow, CareLinkRow, DaySlot, DoseLogRow, FamilyGrantItems, MedicationRow, NoteRow, QuestionFor, QuestionRow, ReminderDeliveryRow, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { bindEntryStore } from "@/lib/subject/bind";
import { localDate, zonedTimeToUtcMs } from "@/lib/time/clock";
import { doctorNumbers, type DoctorNumbers } from "@/lib/visit/doctor-numbers";
import { happenedVisits } from "@/lib/visit/happened";
import { linkAcknowledged } from "./ack";
import { bpWords, dateLine, dayWords } from "./copy";
import { cellMark, cellReason } from "./home";
import { rc, recordList, slotWord, type RecordKey } from "./record-copy";

/** How far back what needs attention reaches, today included. */
export const ATTENTION_DAYS = 14;
/** How far back the one line of everything else counts (and his notes are items), today included. */
export const REST_DAYS = 7;
/** A planned visit this many days away, or nearer, is an item while questions wait for it. */
export const VISIT_SOON_DAYS = 7;

type Grant = keyof FamilyGrantItems;

/** What record an entry is of; with `ref`, what a held card asks Ripple about (data-explain-type). */
export type RecordKind = "dose" | "no_reply" | "bp" | "visit" | "next_visit" | "note";

/** Why an entry needs attention. */
export type AttentionKind = "dose_missed" | "no_reply" | "bp_high" | "visit_soon" | "note";

/** One line under an entry's title. */
export interface RecordLine {
  text: string;
  /** the language of `text` when it is his own words and he wrote them in another one */
  lang?: string | null;
  /**
   * his own words: "said" is drawn attributed (「爸爸说：「…」」, the screen knows how she calls him), "quote" as the words
   * alone in their marks (a note). Absent: a plain line (a medicine's name, a place, 「未说明原因」)
   */
  as?: "said" | "quote";
}

/** A question for his doctor or pharmacist that she can put on his list with one tap. */
export interface RecordAsk {
  text: string;
  for: QuestionFor;
  /** the same words stand on his list already (knowable only with questions_count on) */
  added: boolean;
  /** he set these very words aside on his list: she is told so, and cannot put them back (asking or not is his) */
  aside?: boolean;
}

export interface RecordEntry {
  /** unique in the list, and the same from one build to the next (POST /api/family/questions names an entry by it) */
  id: string;
  kind: RecordKind;
  /** an item of 「需要留意」; false: the next-visit row, or a routine entry that is only counted */
  attention: boolean;
  attn?: AttentionKind;
  /** where the entry stands in the order (ISO); the moment it was made when `timed` */
  at: string;
  /** `at` is the moment he made it: shown as a time. false: the entry says its day, and its part of the day (`slot`) */
  timed: boolean;
  /** his date it belongs to, YYYY-MM-DD */
  day: string;
  /** the part of his day it is said by: a dose, a reminder, a reading with no time kept */
  slot?: DaySlot;
  /** the fact: 「Amlodipine 未服药」, 「血压 142/88，高于医生设定的目标 135/85」; "" for an entry that is only counted */
  title: string;
  /** the next-visit row's date */
  value?: string;
  /** the lines under the title: his reason, the medicines' names, the place */
  lines?: RecordLine[];
  /** the record's own id; date:slot for a dose and for a reminder ("2026-10-14:morning"); "" for the next visit */
  ref: string;
  /** a routine entry: how many it adds to the one line of 「其余记录」 (doses taken in that part of the day; 1 reading; 1 visit) */
  count?: number;
  /** follow-up: a suggested question */
  ask?: RecordAsk;
  /** follow-up: something she can do herself, call him */
  call?: boolean;
  /** his switches that show this entry: any one of them being on is enough */
  switches: Grant[];
  /** the parts of the entry one switch alone shows: gone when that switch is off */
  only?: Partial<Record<"value" | "lines", Grant>>;
}

export interface HerRecord {
  linkId: string;
  /** his today, YYYY-MM-DD */
  today: string;
  /** the server's now (ms) when built; her page keeps the newer copy */
  generatedAt: number;
  grants: FamilyGrantItems;
  /** which change of his switches this copy was built at (the link's grant version; 0 when the caller did not say) */
  grantsVersion: number;
  /** how many days back what needs attention reaches */
  days: number;
  /** the switches whose records were read for it, for her access-log row */
  shown: Grant[];
  /**
   * he has acknowledged her link (lib/care/ack.ts). false: she bound it herself and he has not answered yet, so nothing
   * of hers reaches his phone: a suggested question is shown, and cannot be put on his list
   */
  acknowledged: boolean;
  entries: RecordEntry[];
}

export interface RecordInput {
  link: Pick<CareLinkRow, "id">;
  /** her user id, as her home's call carries it; nothing in the record depends on who she is (her look is the page's to log) */
  userId?: string;
  /** her switches through this link; absent: read here (one more round) */
  grants?: FamilyGrantItems;
  /** which change of the switches `grants` is */
  version?: number;
  /** the language the entries are worded in (her page's); absent: zh-Hans */
  locale?: Locale;
  /** has he acknowledged this link; absent: asked here, in the first round (as her home does, lib/care/home.ts) */
  acknowledged?: boolean;
}

const LOCALES: readonly Locale[] = ["zh-Hans", "en"];

/**
 * His words as a question quotes them: on one line, as a question is stored (lib/profile/questions.ts
 * cleanQuestionText), and without the full stop they end on (the sentence around them brings its own: 「…」。).
 */
const flat = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/[。.]+$/, "");

/**
 * A suggested question from its sentence, never longer than his list takes: when his own words make it too long, they
 * are cut short (with an ellipsis), the sentence around them stays whole.
 */
function fitted(locale: Locale, key: RecordKey, vars: Record<string, string | number>, words?: string): string {
  const full = rc(locale, key, vars);
  const over = [...full].length - QUESTION_TEXT_MAX;
  if (over <= 0 || !words) return full;
  const own = [...String(vars[words] ?? "")];
  const kept = own.slice(0, Math.max(0, own.length - over - 1)).join("").trimEnd();
  return rc(locale, key, { ...vars, [words]: `${kept}…` });
}

/** 「10月12日早间」 / "12 Oct morning": a day and its part, inside a question. */
function slotWhen(date: string, slot: DaySlot, locale: Locale): string {
  return locale === "zh-Hans" ? `${dayWords(date, locale)}${slotWord(slot, locale)}` : `${dayWords(date, locale)} ${slotWord(slot, locale).toLowerCase()}`;
}

/** Whole days from one date to another (YYYY-MM-DD). */
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Where a visit will be, as his record says it; nothing when it says nothing. */
const placeOf = (v: Pick<VisitRow, "place">): string | undefined => (typeof v.place === "string" ? v.place.trim() : "") || undefined;

/** The three reasons his screen always offers (lib/daily/schedule.ts FIXED_REASONS); each has its own question. */
type FixedReason = "forgot" | "away" | "not_with_me";
const isFixed = (code: string): code is FixedReason => code === "forgot" || code === "away" || code === "not_with_me";

/**
 * Why a dose was not taken, as the follow-up needs it:
 *   forgot / away / not_with_me   the reason he tapped; the words are the ones stored with it, else the chip's
 *   own                           his own words
 *   routine                       one of his own weekly habits, offered as a reason on its days (lib/daily/schedule.ts
 *                                 reasonOptions: "<the habit's slug>_<the part of the day>"); the words are the ones
 *                                 stored with it, else the habit's name
 *   none                          he gave no reason
 * The code never leaves this module: only the words do.
 */
interface Why {
  kind: FixedReason | "own" | "routine" | "none";
  /** per language (his stored words are the same in both; a chip's or a habit's name is said in the page's language) */
  words: Record<Locale, string | null>;
  /** the habit's slug, for a routine reason */
  slug: string | null;
}

function whyOf(c: Pick<DoseCell, "state" | "reason" | "reasonText">, routine: readonly RoutineEntry[]): Why {
  const said = cellReason(c);
  const both = (zh: string | null, en: string | null): Record<Locale, string | null> => ({ "zh-Hans": zh, en });
  const code = (c.reason ?? "").trim();
  if (isFixed(code)) {
    const chip = FIXED_REASONS.find((r) => r.code === code)?.label;
    return { kind: code, words: both(said ?? chip?.zh ?? null, said ?? chip?.en ?? null), slug: null };
  }
  if (!code || code === "own_words") return { kind: said ? "own" : "none", words: both(said, said), slug: null };
  const slug = code.replace(/_(morning|midday|evening|night)$/, "");
  const habit = routine.find((r) => routineSlug(r.label) === slug);
  return { kind: "routine", words: both(said ?? habit?.label_zh ?? habit?.label ?? null, said ?? habit?.label ?? null), slug };
}

/** The sentence a missed dose's question is built from. */
function doseAsk(why: Why, date: string, slot: DaySlot, names: readonly string[], locale: Locale): string {
  const vars = { when: slotWhen(date, slot, locale), med: recordList(names, locale) };
  if (isFixed(why.kind)) return rc(locale, why.kind === "forgot" ? "askForgot" : why.kind === "away" ? "askAway" : "askNotWithMe", vars);
  const reason = why.kind === "none" ? null : why.words[locale];
  return reason ? fitted(locale, "askOwn", { ...vars, reason: flat(reason) }, "reason") : rc(locale, "askNone", vars);
}

type Reading = BpReadingRow & { systolic: number; diastolic: number };

/** The higher of two readings: by the upper number, then the lower one. */
const higher = (a: Reading, b: Reading): Reading => (b.systolic > a.systolic || (b.systolic === a.systolic && b.diastolic > a.diastolic) ? b : a);

export async function herRecord(store: Store, scope: SessionRow, input: RecordInput, nowMs: number): Promise<HerRecord> {
  const locale: Locale = input.locale ?? "zh-Hans";
  const linkId = input.link.id;
  let grants: FamilyGrantItems;
  let version = input.version ?? 0;
  if (input.grants) grants = { ...NO_GRANTS, ...input.grants };
  else {
    const row = await store.getFamilyGrant(scope.id, linkId);
    grants = { ...NO_GRANTS, ...(row?.items ?? {}) };
    version = input.version ?? row?.version ?? 0;
  }
  const d0 = scopeD0(scope);
  const tz = scopeTz(scope);
  const today = scope.story_day;
  const fromDay = today - (ATTENTION_DAYS - 1);
  const restFrom = today - (REST_DAYS - 1);
  const range = { fromDay, toDay: today };
  const dateOf = (day: number) => storyDate(d0, day);
  const todayDate = dateOf(today);
  const routine = scopeRoutine(scope) as RoutineEntry[];

  const needDoses = grants.dose_summary || grants.no_reply_alert;
  const needVisits = grants.questions_count || grants.visit_transcripts;
  // ---- the first round: everything at once (each of these is a round trip on a hosted database), and nothing is asked
  // for a switch that is off
  const [meds, doses, deliveries, readingRows, notes, questions, visits, acknowledged] = await Promise.all([
    needDoses ? store.listMeds(scope.id) : Promise.resolve([] as MedicationRow[]),
    needDoses ? store.listDoses(scope.id, range) : Promise.resolve([] as DoseLogRow[]),
    grants.no_reply_alert ? store.listDeliveries(scope.id, range) : Promise.resolve([] as ReminderDeliveryRow[]),
    grants.bp_summary ? store.listBp(scope.id, range) : Promise.resolve([] as BpReadingRow[]),
    grants.notes ? store.listNotes(scope.id, { fromDay: restFrom, toDay: today }) : Promise.resolve([] as NoteRow[]),
    grants.questions_count ? store.listQuestions(scope.id) : Promise.resolve([] as QuestionRow[]),
    needVisits ? store.listVisits(scope.id) : Promise.resolve([] as VisitRow[]),
    // her link's own state, not a record of his: one read for a link that carries no mark (an account's scope id is his user id)
    input.acknowledged ?? (isAccount(scope) ? linkAcknowledged(bindEntryStore(), { id: linkId, patient_id: scope.id }) : true),
  ]);

  // a reading he recorded with both numbers, as her home counts them (lib/care/home.ts readingViews)
  const readings = readingRows.filter((r): r is Reading => r.state === "recorded" && r.systolic !== null && r.diastolic !== null && r.day >= fromDay && r.day <= today);
  // the days his medicine is read cell by cell
  const slotDays = grants.dose_summary ? Array.from({ length: ATTENTION_DAYS }, (_, i) => buildDoseDay(scope, fromDay + i, meds, doses, nowMs)).flat() : [];
  const recentVisits = needVisits ? visits.filter((v) => v.day >= restFrom && v.day <= today) : [];

  // ---- the second round, side by side, each only when something read above needs it
  const [moment, numbers, happened] = await Promise.all([
    grants.questions_count && questions.length ? answerMoment(store, scope, visits, questions) : Promise.resolve<AnswerMoment | null>(null),
    readings.length ? doctorNumbers(store, scope.id, { day: today, time: scope.story_time ?? null }) : Promise.resolve<DoctorNumbers | null>(null),
    recentVisits.length ? happenedVisits(store, scope.id, recentVisits) : Promise.resolve([] as VisitRow[]),
  ]);

  const entries: RecordEntry[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();
  const noon = (date: string) => zonedTimeToUtcMs(date, "12:00", tz);
  /** A row's own moment when it was written on the day it belongs to; else a place in that day's order and no time. */
  const momentOf = (created: string | null | undefined, date: string, fallbackMs: number): { at: string; timed: boolean } => {
    const ms = created ? Date.parse(created) : Number.NaN;
    return Number.isFinite(ms) && localDate(ms, tz) === date ? { at: iso(ms), timed: true } : { at: iso(fallbackMs), timed: false };
  };

  // ---- his list, as far as the follow-ups need it (only with questions_count on: the list is empty otherwise)
  /** the words that stand on his list: not set aside, not folded into another question */
  const onHisList = new Set<string>();
  for (const q of questions) if (!q.merged_into && q.status !== "skipped") onHisList.add(`${q.for}:${questionKey(q.text)}`);
  /** the words he set aside (and did not fold into another question): hers to see, not hers to put back */
  const setAside = new Set<string>();
  for (const q of questions) if (!q.merged_into && q.status === "skipped") setAside.add(`${q.for}:${questionKey(q.text)}`);
  /** how many of his questions still wait for a visit: her home's count (lib/care/home.ts waitingQuestions) */
  const waiting = moment ? questions.filter((q) => questionVisible(q, visits, today) && questionWaiting(q, visits, moment)) : [];
  /**
   * A suggested question. `build` words it in a language; it is marked added when its words in either language stand
   * on his list (she may have added it while her page was in the other one).
   */
  const askOf = (build: (l: Locale) => string, who: QuestionFor = "doctor"): RecordAsk => {
    const text = build(locale);
    const keys = LOCALES.map((l) => `${who}:${questionKey(l === locale ? text : build(l))}`);
    const added = keys.some((k) => onHisList.has(k));
    const aside = !added && keys.some((k) => setAside.has(k));
    return aside ? { text, for: who, added, aside } : { text, for: who, added };
  };

  // ---- his medicine, cell by cell (the cells her week is drawn from: lib/daily/cells.ts buildDoseDay)
  /** the medicines of a part of a day nobody answered, by name (for the reminder's item, with dose_summary on) */
  const unanswered = new Map<string, string[]>();
  if (grants.dose_summary) {
    for (const s of slotDays) {
      let taken = 0;
      let lastTaken: string | null = null;
      const noReply: string[] = [];
      // the medicines he did not take, grouped by the reason he gave: one item per reason
      const groups = new Map<string, { why: Why; names: string[]; at: string | null }>();
      for (const c of s.cells) {
        const mark = cellMark(c, s.phase);
        const sameDay = !!c.answeredAt && localDate(Date.parse(c.answeredAt), tz) === s.date;
        if (mark === "taken") {
          taken += 1;
          if (sameDay && (!lastTaken || c.answeredAt! > lastTaken)) lastTaken = c.answeredAt;
        } else if (mark === "no_reply") noReply.push(c.name);
        else if (mark === "missed") {
          const why = whyOf(c, routine);
          const key = `${why.kind}|${why.slug ?? ""}|${why.words["zh-Hans"] ?? ""}`;
          const g = groups.get(key) ?? { why, names: [], at: null };
          g.names.push(c.name);
          if (sameDay && (!g.at || c.answeredAt! > g.at)) g.at = c.answeredAt;
          groups.set(key, g);
        }
      }
      if (noReply.length) unanswered.set(`${s.day}|${s.slot}`, noReply);
      let n = 0;
      for (const g of groups.values()) {
        const said = g.why.kind === "none" ? null : g.why.words[locale];
        entries.push({
          id: n === 0 ? `missed:${s.date}:${s.slot}` : `missed:${s.date}:${s.slot}:${n + 1}`,
          kind: "dose",
          attention: true,
          attn: "dose_missed",
          at: g.at ? iso(Date.parse(g.at)) : iso(s.closeMs),
          timed: false,
          day: s.date,
          slot: s.slot,
          title: rc(locale, "doseMissedTitle", { meds: recordList(g.names, locale) }),
          lines: [said ? { text: said, as: "said" } : { text: rc(locale, "whyNone") }],
          ref: `${s.date}:${s.slot}`,
          ask: askOf((l) => doseAsk(g.why, s.date, s.slot, g.names, l)),
          switches: ["dose_summary"],
        });
        n += 1;
      }
      // routine: the doses he took in that part of the day are only counted
      if (taken > 0 && s.day >= restFrom) {
        entries.push({
          id: `dose:${s.date}:${s.slot}`,
          kind: "dose",
          attention: false,
          at: lastTaken ? iso(Date.parse(lastTaken)) : iso(s.closeMs),
          timed: false,
          day: s.date,
          slot: s.slot,
          title: "",
          ref: `${s.date}:${s.slot}`,
          count: taken,
          switches: ["dose_summary"],
        });
      }
    }
  }

  // ---- the alerts sent to her on a past day that he has still not answered (lib/daily/no-reply.ts familyNoReplyAlerts
  // reads the same rows). Today's is the open block on top of her screen; one he answered since is routine
  if (grants.no_reply_alert) {
    const seen = new Set<string>();
    for (const del of deliveries) {
      if (del.kind !== DELIVERY.familyNoReply || del.ref !== linkId || !isDaySlot(del.slot) || del.day < fromDay || del.day >= today) continue;
      const slot: DaySlot = del.slot;
      const key = `${del.day}|${slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const answers = doses.filter((d) => d.day === del.day && d.slot === slot).map((d) => shownState(d));
      if (answers.length > 0 && answers.every((a) => a === "taken" || a === "missed")) continue;
      const date = dateOf(del.day);
      const names = unanswered.get(key);
      entries.push({
        id: `no_reply:${date}:${slot}`,
        kind: "no_reply",
        attention: true,
        attn: "no_reply",
        at: momentOf(del.sent_at, date, slotInstants(scope, del.day, scopeSlotSchedule(scope, slot)).closeMs).at,
        timed: false,
        day: date,
        slot,
        title: rc(locale, "noReplyTitle"),
        // which medicines: the dose switch's to show, never the alert's
        lines: names?.length ? [{ text: recordList(names, locale) }] : undefined,
        ref: `${date}:${slot}`,
        call: true,
        switches: ["no_reply_alert"],
        only: names?.length ? { lines: "dose_summary" } : undefined,
      });
    }
  }

  // ---- his readings, each against his doctor's own numbers (the ones he confirmed; with neither, nothing is compared)
  if (grants.bp_summary) {
    const target = targetRule(numbers?.target);
    const warning = numbers?.threshold ? { systolic: numbers.threshold.systolic, since: numbers.threshold.visitDay } : null;
    // strictly above, and only a reading taken since the visit the number was given at
    const overWarning = (r: Reading) => !!warning && r.day >= warning.since && r.systolic > warning.systolic;
    // (the one rule of lib/daily/bp-target.ts: his calendar, hers and the blood pressure page's card read it too)
    const overTarget = (r: Reading) => outsideTarget(r, target);
    const targetWords = target ? bpWords(target) : "";
    // the question counts the last REST_DAYS days: how many readings above the target, and the highest of them
    const week = readings.filter((r) => r.day >= restFrom && overTarget(r));
    const weekMax = week.length ? week.reduce(higher) : null;
    const targetAsk = (r: Reading, l: Locale): string => {
      if (week.length > 1) return rc(l, "askBp", { n: week.length, target: targetWords, max: bpWords(weekMax!) });
      if (week.length === 1) return rc(l, "askBpOnce", { target: targetWords, max: bpWords(weekMax!) });
      return rc(l, "askBpDay", { when: dayWords(dateOf(r.day), l), bp: bpWords(r), target: targetWords });
    };
    // above the target and not above the warning level: the readings of one day fold into the highest
    const byDay = new Map<number, Reading>();
    for (const r of readings) if (overTarget(r) && !overWarning(r)) byDay.set(r.day, byDay.has(r.day) ? higher(byDay.get(r.day)!, r) : r);
    // ... and the days fold into ONE item, the newest day's, which lists each day's highest (owner 10-14: 留意 says
    // what needs attention once, it does not repeat one thing per day)
    const days = [...byDay.values()].sort((a, b) => b.day - a.day);
    const lead = days[0] ?? null;
    const inLead = new Set(days.map((r) => r.id));
    const dayLines = days.length > 1 ? days.map((r) => ({ text: rc(locale, "bpDayLine", { when: dayWords(dateOf(r.day), locale), bp: bpWords(r) }) })) : undefined;
    for (const r of readings) {
      const date = dateOf(r.day);
      const when = momentOf(r.created_at, date, slotInstants(scope, r.day, scopeSlotSchedule(scope, r.slot)).firstMs);
      const base = { kind: "bp" as const, ...when, day: date, slot: when.timed ? undefined : r.slot, ref: r.id, switches: ["bp_summary"] as Grant[] };
      if (overWarning(r)) {
        entries.push({ ...base, id: `bp:${r.id}`, attention: true, attn: "bp_high", title: rc(locale, "bpWarnTitle", { bp: bpWords(r), n: warning!.systolic }), call: true });
      } else if (lead && r.id === lead.id) {
        const title = days.length > 1 ? rc(locale, "bpTargetDays", { n: days.length, target: targetWords }) : rc(locale, "bpTargetTitle", { bp: bpWords(r), target: targetWords });
        entries.push({ ...base, id: `bp:${r.id}`, attention: true, attn: "bp_high", title, lines: dayLines, ask: askOf((l) => targetAsk(r, l)) });
      } else if (inLead.has(r.id)) {
        // an earlier day's highest: a line of the item above, so it is neither an item nor one of 「其余记录」
        continue;
      } else if (r.day >= restFrom) {
        // routine: not above his doctor's numbers (or none confirmed), or folded into the day's highest
        entries.push({ ...base, id: `bp:${r.id}`, attention: false, title: "", count: 1 });
      }
    }
  }

  // ---- the visits that happened are routine; they show under questions_count or visit_transcripts, as her calendar's
  for (const v of happened) {
    const date = v.date || dateOf(v.day);
    entries.push({ id: `visit:${v.id}`, kind: "visit", attention: false, ...momentOf(v.created_at, date, noon(date)), day: date, title: "", ref: v.id, count: 1, switches: ["questions_count", "visit_transcripts"] });
  }

  if (grants.questions_count) {
    // ---- the next planned visit (lib/summary/account-brief.ts nextPlannedVisit's rule): a row of its own, always
    const next = visits.filter((v) => v.status === "planned" && v.date >= todayDate).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next) {
      // owner 10-15: with its time and its doctor when the scope has them (「10:30　Blossom Family Clinic」, 「Dr Lim …」)
      const detail = visitDetail(scope, next.id);
      const place = [detail.time, placeOf(next)].filter(Boolean).join("　") || undefined;
      const doctor = doctorWords(detail.doctor, locale);
      const at = iso(zonedTimeToUtcMs(next.date, "00:00", tz));
      entries.push({
        id: "next_visit",
        kind: "next_visit",
        attention: false,
        at,
        timed: false,
        day: next.date,
        title: rc(locale, "nextTitle"),
        value: next.date === todayDate ? rc(locale, "dayToday") : dateLine(next.date, locale),
        lines: place || doctor ? [...(place ? [{ text: place }] : []), ...(doctor ? [{ text: doctor }] : [])] : undefined,
        ref: "",
        switches: ["questions_count"],
      });
      // ---- and an item once it is near while questions still wait for it
      const away = daysBetween(todayDate, next.date);
      if (away <= VISIT_SOON_DAYS && waiting.length > 0) {
        entries.push({
          id: "visit_soon",
          kind: "next_visit",
          attention: true,
          attn: "visit_soon",
          at,
          timed: false,
          day: next.date,
          title: away === 0 ? rc(locale, "visitToday") : away === 1 ? rc(locale, "visitTomorrow") : rc(locale, "visitIn", { n: away }),
          lines: [...(place ? [{ text: place }] : []), ...(doctor ? [{ text: doctor }] : []), { text: waiting.length === 1 ? rc(locale, "visitWaitingOne") : rc(locale, "visitWaiting", { n: waiting.length }) }],
          ref: "",
          switches: ["questions_count"],
        });
      }
    }
  }

  // ---- each note of his of the last REST_DAYS days, word for word
  if (grants.notes) {
    for (const n of notes) {
      if (n.day < restFrom || n.day > today || !n.text.trim()) continue;
      const date = dateOf(n.day);
      entries.push({
        id: `note:${n.id}`,
        kind: "note",
        attention: true,
        attn: "note",
        ...momentOf(n.created_at, date, noon(date)),
        day: date,
        title: rc(locale, n.source === "voice_note" ? "noteVoice" : "noteTyped"),
        lines: [{ text: n.text, lang: n.lang, as: "quote" }],
        ref: n.id,
        ask: askOf((l) => fitted(l, "askNote", { when: dayWords(date, l), words: flat(n.text) }, "words")),
        switches: ["notes"],
      });
    }
  }

  // the next visit's row first, and its item first of what needs attention (it is what is coming); then newest first,
  // by his day and then by the moment
  const lead = (e: RecordEntry) => (e.kind !== "next_visit" ? 2 : e.attention ? 1 : 0);
  entries.sort((a, b) => lead(a) - lead(b) || b.day.localeCompare(a.day) || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

  return {
    linkId,
    today: todayDate,
    generatedAt: nowMs,
    grants,
    grantsVersion: version,
    days: ATTENTION_DAYS,
    shown: (Object.keys(grants) as Grant[]).filter((k) => grants[k]),
    acknowledged,
    entries,
  };
}
