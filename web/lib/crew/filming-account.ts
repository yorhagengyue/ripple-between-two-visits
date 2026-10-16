/**
 * The filming account (C2 track J; docs/plan/real-app.md 5.4, 5.6, 8.11; journey 21). Server-only.
 *
 * The film crew plays the story on a real account: a phone signs up like anyone, its owner marks the account as a
 * filming account on that phone (his own sign-in and the crew's cookie: app/api/crew/filming-account), and from then on
 * the director's laptop (/director, components/director/FilmingAccountPanel) can:
 *
 *   lay it out to a scene   every record of the space is replaced by Mr Tan's story as it stood at that moment, on the
 *                           story's own dates (d0 = the template's 2026-08-24, so the props' bag says 9月1日 like the
 *                           phone), and the account's clock is offset so that its "now" is the scene's date and time
 *                           (Day 29 20:15 = 2026-09-22 20:15). Time keeps flowing from there.
 *   move forward            to a clock time (the next one, or on a given date) or by some minutes; never back (to go
 *                           back, lay it out to a scene again). Days 0 to 45 of the story (lib/crew/story.ts).
 *   pop the reminder        the slot's reminder now: the delivery is recorded and the notice goes to his phones (web
 *                           push, track I), exactly what the scheduled job sends at 8:45; only for a slot still waiting
 *                           for him.
 *   simulate no reply       the slot's window closes now: the clock moves to the window's close (9:45, plus a minute)
 *                           when it is not there yet, the waiting cells are recorded "no reply" by the director, and his
 *                           family is told when he lets them (D's links, his no-reply switch).
 *   end filming             the offset goes, the account is a normal account again on its real date.
 *
 * Never cross (C2 rule): filming moves time and lays out the story; it never writes a clinical sentence of its own. Every
 * record it lays out is the template's (fixtures/timeline.seed.json, the replay files' lines); every notice uses track
 * B's fixed words.
 *
 * The story sheet (ux pass 10-13, lib/crew/story-edits.ts): the director may send small changes with a "lay out" (which
 * mornings he took the tablet, a reading, a note or a question of his own, whether a bag is read yet), and the story is
 * laid out with them. They are his own records, never a sentence of Ripple's or a doctor's line; the sheet lives in the
 * director's browser and comes again with every layout, so going back to a scene keeps it.
 *
 * Skipped time is never "no reply" (real-app 5.4): every change of the offset moves tracking_since to the scope's new
 * "now" (the store does it: setClockOffset), so a reminder window that closed in the skipped time is not his. Before a
 * move, the windows that closed in the time that was lived are settled first (what the scheduled job would have done
 * within the minute). "Simulate no reply" is the one deliberate "no reply".
 *
 * The crew can act on an account only while it is marked (lib/subject/filming.ts); an ordinary account answers like a
 * missing one. Every action publishes account.changed (by: director) or dose.logged (by: director) on the account's bus.
 */
import { createHash } from "node:crypto";
import { publish } from "@/lib/bus";
import { familyRecipients } from "@/lib/care/recipients";
import type { FamilyRecipient } from "@/lib/care/types";
import { bpPartTimes } from "@/lib/daily/bp-schedule";
import { buildDoseDay, waitingForHim, type SlotDay } from "@/lib/daily/cells";
import { settleAccountNoReply } from "@/lib/daily/doses";
import { dt, shortTime, type DailyKey } from "@/lib/daily/i18n";
import { DELIVERY } from "@/lib/daily/no-reply";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { slotSchedule, type RoutineEntry } from "@/lib/daily/schedule";
import type { Locale } from "@/lib/i18n";
import { fixtureClipPath, fixtureUtterances, replayIdForAudioFixture } from "@/lib/asr/fixtures";
import { sendNotice, type Notice } from "@/lib/jobs/notify";
import { BEATS, currentBeat, findBeat } from "@/lib/session/beats";
import type { DoseLoggedData } from "@/lib/session/events";
import { medName } from "@/lib/session/today";
import { isAccount, scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import type {
  AccountRow,
  BpReadingRow,
  DaySlot,
  NewProfileFact,
  NewUtterance,
  ProfileFactRow,
  ReminderClipRow,
  ScopeRoutineEntry,
  ScopeSettings,
  SessionRow,
  Store,
  UtteranceRow,
  VisitRow,
} from "@/lib/store/types";
import { exampleProfileFacts, settingsKept } from "@/lib/story/example";
import { dayOfDate, storyDate } from "@/lib/story/clock";
import { buildSeedTables, loadTemplate, type SeedTables } from "@/lib/story/seed";
import { filmingEntry, isFilmingScope, type FilmingEntry } from "@/lib/subject/filming";
import type { Subject } from "@/lib/subject/types";
import { DEFAULT_TZ, localDate, localHHMM, zonedTimeToUtcMs } from "@/lib/time/clock";
import { scriptFor } from "@/lib/visit/fallback";
import { setScriptedFallback } from "@/lib/visit/pipeline";
import { inferRoles } from "@/lib/visit/roles";
import { nowMs as appNowMs } from "@/lib/time/now";
import type { ShowCueData } from "./cues";
import { CLOCK_LAST_DAY, inStory, OUTSIDE_STORY, pageForBeat, plainBeat } from "./story";
import { applyStoryEdits, countStoryEdits, StoryEditError, type StoryEdits } from "./story-edits";

/** Day 0 of the story, the template's own date (the props' label says 9月1日 = Day 8 on these dates). */
export const FILMING_D0: string = loadTemplate("mr-tan").meta.d0;

const MINUTE = 60_000;
/** How long a visit of the story lasts: a visit that started less than this before a scene is the scene itself. */
const VISIT_MS = 60 * MINUTE;
/** The daughter on the story's stand-in clip (an account of hers, when linked, labels her own clips). */
const STORY_DAUGHTER = "Wei Ling";

// ---------------------------------------------------------------- errors

export type FilmingErrorCode = "forward_only" | "beyond_clock" | "nothing_waiting" | "not_laid_out" | "unknown_scene" | "invalid" | "no_visit";

/** Why the director's action was refused; `message` is a sentence the director reads. */
export class FilmingError extends Error {
  constructor(
    readonly code: FilmingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FilmingError";
  }
}

// ---------------------------------------------------------------- the account's handle on the director's desk

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * The account's code on the director's desk and on his phone's 拍摄账号 page: six letters and digits derived from the
 * scope id (never the id itself). The crew matches the phone to the row by it; it opens nothing by itself.
 */
export function filmingRef(scopeId: string): string {
  const h = createHash("sha256").update(`ripple-filming-account-v1\n${scopeId}`, "utf8").digest();
  let out = "";
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[h[i] % REF_ALPHABET.length];
  return out;
}

// ---------------------------------------------------------------- the story's moments

/** The instant of story day `day` at `hhmm` on the story's own dates (d0 2026-08-24, Singapore). */
export function storyMoment(day: number, hhmm: string, tz: string = DEFAULT_TZ): number {
  return zonedTimeToUtcMs(storyDate(FILMING_D0, day), hhmm, tz);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** A visit's start: the time of the scene that films it (the first visit 09:30, the pharmacy 11:00), else 09:30. */
function visitStart(v: Pick<VisitRow, "day">): string {
  return BEATS.find((b) => b.day === v.day && /visit|pharmacy/.test(b.id))?.time ?? "09:30";
}

/** A scene or a moment of the story, checked: the scene's day and time, or the given ones (Day 0 to Day 45). */
export function resolveMoment(target: { scene: string } | { day: number; time: string }): { day: number; time: string; scene: string | null } {
  if ("scene" in target) {
    const b = findBeat(target.scene);
    if (!b) throw new FilmingError("unknown_scene", "That scene is not in the story.");
    return { day: b.day, time: b.time, scene: b.id };
  }
  if (!inStory(target.day)) throw new FilmingError("beyond_clock", OUTSIDE_STORY);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(target.time)) throw new FilmingError("invalid", "The time is HH:MM, 24-hour.");
  return { day: target.day, time: target.time, scene: currentBeat(target.day, target.time)?.id ?? null };
}

// ---------------------------------------------------------------- the story laid out up to a moment (pure)

export interface StoryLayout {
  /** the instant the scope's "now" is at (and tracking starts from) */
  at: number;
  d0: string;
  /** his clinic and routine (the template's, on its own weekdays) */
  settings: ScopeSettings;
  /**
   * Everything the layout writes, for one store call (C2 follow-up, as the example account's seed since migration 0014:
   * the transcripts and the profile facts go in with the rest, so a layout cannot be left half-filled). `utterances` and
   * `profile_facts` are `transcripts` and `facts` below as rows.
   */
  tables: SeedTables & { utterances: UtteranceRow[]; profile_facts: ProfileFactRow[] };
  /** his profile: the persona's non-clinical facts he confirmed on day 0 (name, age, home, languages) */
  facts: NewProfileFact[];
  /** the transcripts of the visits that happened before the moment, every speaker confirmed (as after each review) */
  transcripts: { visitId: string; rows: NewUtterance[] }[];
}

/** A transcript line as the row the one-call layout writes (the same fields store.addUtterances fills in). */
function utteranceRow(scopeId: string, visitId: string, u: NewUtterance, createdAt: string): UtteranceRow {
  return {
    id: u.id!,
    session_id: scopeId,
    visit_id: visitId,
    t_start_ms: u.t_start_ms,
    t_end_ms: u.t_end_ms,
    speaker_cluster: u.speaker_cluster ?? null,
    role: u.role ?? "unknown",
    role_state: u.role_state ?? "unknown",
    text: u.text,
    lang: u.lang ?? null,
    clip_path: u.clip_path ?? null,
    scripted_fallback: u.scripted_fallback ?? false,
    created_at: createdAt,
  };
}

/** A profile fact as the row the one-call layout writes (the same fields store.addProfileFact fills in). */
function factRow(scopeId: string, f: NewProfileFact, createdAt: string): ProfileFactRow {
  return {
    id: f.id!,
    session_id: scopeId,
    kind: f.kind,
    text: f.text,
    source: f.source,
    entered_by: f.entered_by ?? null,
    confirmed_by: f.confirmed_by ?? null,
    visit_item_id: null,
    created_day: f.created_day ?? 0,
    data: f.data ?? null,
    hidden: null,
    entered_by_user_id: null,
    link_id: null,
    confirmed_at: f.confirmed_at ?? null,
    updated_at: null,
    created_at: createdAt,
  };
}

/** The replay line that says `answer` word for word, in the visit's recording, or null. */
function answerLineId(audioFixture: string | null, answer: string | null): string | null {
  const replay = replayIdForAudioFixture(audioFixture);
  if (!replay || !answer) return null;
  return fixtureUtterances(replay)?.find((u) => u.text.trim() === answer.trim())?.id ?? null;
}

/** Every line of each happened visit's recording, each line's speaker worked out as a replay does, and confirmed. */
function storyTranscripts(visits: Pick<VisitRow, "id" | "kind" | "status" | "audio_fixture">[]): StoryLayout["transcripts"] {
  const required = loadTemplate("mr-tan").required_doctor_lines.map((r) => ({ text: r.text, speaker: r.speaker }));
  const out: StoryLayout["transcripts"] = [];
  for (const v of visits) {
    if (v.status === "planned") continue;
    const replay = replayIdForAudioFixture(v.audio_fixture);
    const lines = replay ? fixtureUtterances(replay) : null;
    if (!lines?.length) continue;
    const roles = inferRoles(
      lines.map((u) => ({ id: u.id, speaker_cluster: u.speaker_cluster, text: u.text })),
      { visitKind: v.kind, requiredLines: required },
    );
    out.push({
      visitId: v.id,
      rows: lines.map((u) => {
        const role = roles.byLine.get(u.id)?.role ?? "unknown";
        return {
          id: u.id,
          t_start_ms: u.t_start_ms,
          t_end_ms: u.t_end_ms,
          speaker_cluster: u.speaker_cluster,
          role,
          role_state: role === "unknown" ? "unknown" : "confirmed",
          text: u.text,
          lang: u.lang,
          clip_path: fixtureClipPath(u.id),
          scripted_fallback: false,
        };
      }),
    });
  }
  return out;
}

/**
 * Mr Tan's story as it stood at story day `day`, `time`, on the story's own dates. A record is laid out when it
 * happened before that moment, stamped with the moment it happened (so the screens read 「早上 · 8:47 记的」, and a
 * window of a medicine he had is his from then on):
 *   visits        happened once their hour is over (a scene that films a visit has it still to come: planned, its
 *                 recording reference kept); a pharmacy visit still to come is not an appointment, so it is not there
 *   doctor lines  R1-R4 with their visit; transcripts of the happened visits (lib/visit/roles.ts, confirmed)
 *   medicines     prescribed at a visit that happened; the others from their start day (the bag's dates unchanged)
 *   doses         a slot's answer once its window closed (9:45), written two minutes after its first reminder
 *   readings      a reading five minutes after its part of the day starts (8:05, 20:05: the hero's 150/95 is there at
 *                 20:15); "not measured" when the part ends (12:00, 23:00)
 *   notes         at 18:00 of their day (the ankle scene at 18:00 has it still to say)
 *   questions     a question for a visit an hour before that visit; the others at 20:15 of their day (the hero question
 *                 itself is asked in the scene); answered only once the answering visit happened
 *   her clip      her own recordings when her account has made any (kept across layouts), else the story's stand-in
 *                 labelled "Wei Ling"
 * `edits` is the director's story sheet (lib/crew/story-edits.ts): the template's records with its changes in, before
 * any of the above is decided, so a changed morning or an added reading is there from its own moment on like the rest.
 * A sheet that names something the story does not have throws StoryEditError.
 * Rows carry `scopeId` as their session_id. No clock, no store: the caller writes it.
 */
export function layoutAtMoment(
  scopeId: string,
  moment: { day: number; time: string },
  opts: { tz?: string; keepClips?: ReminderClipRow[]; edits?: StoryEdits | null } = {},
): StoryLayout {
  const tz = opts.tz || DEFAULT_TZ;
  const seed = loadTemplate("mr-tan");
  const routine = (seed.persona.routine ?? []) as RoutineEntry[];
  const at = storyMoment(moment.day, moment.time, tz);
  const dayStart = storyMoment(0, "08:00", tz);
  const t = applyStoryEdits(buildSeedTables(scopeId, iso(dayStart), "mr-tan"), opts.edits, { session_id: scopeId, created_at: iso(dayStart) });

  const startOf = new Map(t.visits.map((v) => [v.id, storyMoment(v.day, visitStart(v), tz)]));
  const happened = new Set(t.visits.filter((v) => (startOf.get(v.id) ?? Infinity) + VISIT_MS <= at).map((v) => v.id));
  const visitEnd = (id: string) => (startOf.get(id) ?? dayStart) + VISIT_MS;

  const visits: VisitRow[] = t.visits
    .filter((v) => happened.has(v.id) || v.kind !== "pharmacy")
    .map((v) =>
      happened.has(v.id)
        ? { ...v, created_at: iso(startOf.get(v.id)!) }
        : { ...v, status: "planned" as const, created_at: iso(Math.min(at, startOf.get(v.id) ?? at)) },
    );

  const visit_items = t.visit_items.filter((it) => happened.has(it.visit_id)).map((it) => ({ ...it, created_at: iso(visitEnd(it.visit_id)) }));

  const medications = t.medications
    .filter((m) => (m.prescribed_visit_id ? happened.has(m.prescribed_visit_id) : m.start_day === null || m.start_day <= moment.day))
    .map((m) => ({ ...m, created_at: iso(Math.min(at, m.prescribed_visit_id ? visitEnd(m.prescribed_visit_id) : storyMoment(m.start_day ?? 0, "08:00", tz))) }));
  const medIds = new Set(medications.map((m) => m.id));

  const schedule = (slot: DaySlot) => slotSchedule(routine, slot);
  const dose_logs = t.dose_logs
    .filter((d) => medIds.has(d.medication_id) && storyMoment(d.day, schedule(d.slot).closes, tz) <= at)
    // C2 track B (fix round 10-11): each laid-out dose says it is the record from before tracking began
    // (DoseLogRow.pre_tracking; lib/daily/tracking.ts), as the example's laid-out mornings do
    .map((d) => ({ ...d, created_at: iso(storyMoment(d.day, schedule(d.slot).first, tz) + 2 * MINUTE), pre_tracking: true }));

  const bpAt = (b: BpReadingRow): number => {
    const part = b.slot === "morning" ? "morning" : "evening";
    const times = bpPartTimes(routine, part);
    return b.state === "recorded" && b.systolic !== null ? storyMoment(b.day, times.remind, tz) + 5 * MINUTE : storyMoment(b.day, times.closes, tz);
  };
  const bp_readings = t.bp_readings.filter((b) => bpAt(b) < at).map((b) => ({ ...b, created_at: iso(bpAt(b)) }));

  const noteAt = (day: number) => storyMoment(day, "18:00", tz);
  const notes = t.notes.filter((n) => noteAt(n.day) < at).map((n) => ({ ...n, created_at: iso(noteAt(n.day)) }));

  const questionAt = (q: SeedTables["questions"][number]): number =>
    q.asked_at_visit_id ? (startOf.get(q.asked_at_visit_id) ?? dayStart) - VISIT_MS : storyMoment(q.created_day ?? 0, "20:15", tz);
  const questions = t.questions
    .filter((q) => questionAt(q) < at)
    .map((q) => {
      const answered = !!q.answer_visit_id && happened.has(q.answer_visit_id);
      const base = { ...q, created_at: iso(questionAt(q)) };
      if (answered) {
        const audio = visits.find((v) => v.id === q.answer_visit_id)?.audio_fixture ?? null;
        return { ...base, answer_utterance_id: q.answer_utterance_id ?? answerLineId(audio, q.answer_text) };
      }
      return { ...base, status: q.status === "answered" ? ("open" as const) : q.status, answer_text: null, answer_utterance_id: null, answer_visit_id: null, answer_speaker: null };
    });

  const kept = (opts.keepClips ?? []).filter((c) => !!c.by_user_id);
  const reminder_clips: ReminderClipRow[] = kept.length
    ? kept.map((c) => ({ ...c, session_id: scopeId }))
    : t.reminder_clips.map((c) => ({ ...c, by_user_id: null, by_label: STORY_DAUGHTER, created_at: iso(dayStart) }));

  const name = seed.persona.chinese_name ?? seed.persona.display_name;
  const facts = exampleProfileFacts(iso(dayStart)).map((f) => (f.kind === "name" ? { ...f, text: name, data: null } : f));

  const transcripts = storyTranscripts(visits);
  // each visit's lines are stamped when that visit ended, the facts on day 0 (the day he confirmed them)
  const utterances = transcripts.flatMap((tr) => tr.rows.map((u) => utteranceRow(scopeId, tr.visitId, u, iso(visitEnd(tr.visitId)))));
  const profile_facts = facts.map((f) => factRow(scopeId, f, iso(dayStart)));

  return {
    at,
    d0: FILMING_D0,
    settings: { clinic: seed.persona.healthier_sg_clinic ?? null, routine: routine as ScopeRoutineEntry[] },
    tables: { visits, visit_items, medications, dose_logs, bp_readings, notes, questions, family_grants: [], reminder_clips, utterances, profile_facts },
    facts,
    transcripts,
  };
}

// ---------------------------------------------------------------- where an account stands

export interface FilmingState {
  filming: boolean;
  ref: string;
  /** laid out to the story (its dates are the story's own) */
  laidOut: boolean;
  /** YYYY-MM-DD and HH:MM of the account's "now" */
  date: string;
  time: string | null;
  /** the story day (the director's word; never shown on his phone) */
  day: number;
  /** the clock offset in ms (null: real time) */
  offsetMs: number | null;
  trackingSince: string | null;
  /** the scene it is sitting on exactly, if any */
  scene: string | null;
}

export function filmingState(scope: SessionRow): FilmingState {
  const d0 = scopeD0(scope);
  const laidOut = scope.d0 === FILMING_D0 && scope.template === "mr-tan";
  return {
    filming: scope.filming === true,
    ref: filmingRef(scope.id),
    laidOut,
    date: storyDate(d0, scope.story_day),
    time: scope.story_time,
    day: scope.story_day,
    offsetMs: scope.clock_offset_ms ?? null,
    trackingSince: scope.tracking_since,
    scene: laidOut ? (currentBeat(scope.story_day, scope.story_time)?.id ?? null) : null,
  };
}

/** One row of the director's list. */
export interface FilmingAccountView extends FilmingState {
  /** how the account is called: its display name, else its username */
  name: string;
  username: string | null;
  /** the scene it sits on, in words a judge may read (lib/crew/story.ts) */
  sceneTitle: string | null;
  /**
   * C2 follow-up (real-app 12 「这一格已经有记录时按钮灰掉，写『这天已经记了：吃了』」): why "Simulate no reply" cannot be pressed
   * now, in the director's words, or null when it can. The panel greys the button with this sentence instead of letting
   * the tap fail (the demo console's noReplyBlocked, components/director/DirectorConsole.tsx).
   */
  noReplyWhy: string | null;
}

function accountView(scope: SessionRow, account: AccountRow | null, noReplyWhy: string | null): FilmingAccountView {
  const state = filmingState(scope);
  return {
    ...state,
    name: account?.display_name?.trim() || account?.username || "—",
    username: account?.username ?? null,
    sceneTitle: plainBeat(state.scene, "en"),
    noReplyWhy,
  };
}

// ---------------------------------------------------------------- the bus

function announce(scopeId: string, action: string, by: "director" | "patient", words: string): void {
  publish(scopeId, "account.changed", `Filming account: ${words}`, { kind: "filming", action, by });
}

/**
 * C2 follow-up (real-app 12 「铺到那一拍时手机翻到那一页」): his phone opens the page that tells the scene, by itself, as the
 * demo's phones do when the director jumps to a scene (lib/crew/cues.ts "show", components/session/SceneFollower, mounted
 * for a filming account by app/p/layout.tsx). The path is one of his own pages (lib/crew/story.ts pageForBeat); the cue
 * carries no scene id and no story day (an account's stream never names them), and her stream drops director.cue.
 */
function showScenePage(scopeId: string, scene: string | null): void {
  const data: ShowCueData = { cue: "show", path: pageForBeat(scene), why: "scene", beat: null };
  publish(scopeId, "director.cue", "Filming account: his phone opens the scene's page", data);
}

// ---------------------------------------------------------------- his phone: mark, and end

/** He marks his own account as the filming account (his own store, self mode). Nothing else changes yet. */
export async function markFilming(store: Store, scope: SessionRow): Promise<SessionRow> {
  if (!isAccount(scope)) throw new FilmingError("invalid", "Only an account can be a filming account.");
  if (scope.filming) return scope;
  const row = await store.setFilmingAccount(scope.id, true);
  announce(scope.id, "mark", "patient", "marked for filming on his phone");
  return row;
}

/**
 * End filming (the director, or his phone): the windows of the time that was lived are settled, the offset goes
 * (tracking starts again at the real now: the time between is never "no reply"), and the account is unmarked.
 */
export async function endFilming(store: Store, scope: SessionRow, realNow: number, by: "director" | "patient" = "director"): Promise<SessionRow> {
  if (!isFilmingScope(scope)) return scope;
  await settleAccountNoReply(store, scope, realNow);
  await store.setClockOffset(scope.id, null);
  const row = await store.setFilmingAccount(scope.id, false);
  announce(scope.id, "end", by, "filming ended; back to the real date");
  return row;
}

// ---------------------------------------------------------------- the director's desk

/** Every filming account, for the director's list. */
export async function listFilmingAccounts(entry: FilmingEntry = filmingEntry(), realNow: number = appNowMs()): Promise<FilmingAccountView[]> {
  const scopes = await entry.filmingScopes();
  return Promise.all(
    scopes.map(async (s) => {
      const subject = await entry.filmingSubject(s.id);
      // a list row never fails the list: when today's cells cannot be read the button stays on and the server answers the tap
      const why = subject ? await noReplyWhyFor(subject, realNow).catch(() => null) : null;
      return accountView(subject?.scope ?? s, await entry.accountRow(s.id), why);
    }),
  );
}

/** The filming account behind a code (system mode), or null: no such account, or one that is not marked. */
export async function findFilming(ref: string, entry: FilmingEntry = filmingEntry()): Promise<Subject | null> {
  const want = ref.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(want)) return null;
  const scope = (await entry.filmingScopes()).find((s) => filmingRef(s.id) === want);
  return scope ? entry.filmingSubject(scope.id) : null;
}

/** One account as the director's list shows it (after an action). */
export async function filmingAccountView(scopeId: string, entry: FilmingEntry = filmingEntry(), realNow: number = appNowMs()): Promise<FilmingAccountView | null> {
  const subject = await entry.filmingSubject(scopeId);
  return subject ? accountView(subject.scope, await entry.accountRow(scopeId), await noReplyWhyFor(subject, realNow).catch(() => null)) : null;
}

/** The scope as it is now (the subject's copy may be from before an earlier action). */
async function fresh(subject: Subject): Promise<SessionRow> {
  const row = await subject.store.getSession(subject.scope.id);
  if (!isFilmingScope(row)) throw new FilmingError("invalid", "This account is no longer a filming account.");
  return row;
}

/**
 * Is anything of the layout's transcripts or profile facts missing, and if so, write exactly that (the filming account's
 * lib/story/example.ts ensureExampleWhole). One read when the one call wrote them all. Otherwise the transcripts first
 * (a line with the same id is replaced) and the facts last, each only if it is not there: "every fact is there" then
 * means nothing is missing, so a run that failed in between is completed by laying the account out again, and by this.
 * Returns true when it wrote something.
 */
export async function ensureLayoutWhole(
  store: Pick<Store, "listProfileFacts" | "listUtterances" | "addUtterances" | "addProfileFact">,
  scopeId: string,
  lay: Pick<StoryLayout, "facts" | "transcripts">,
): Promise<boolean> {
  const have = new Set((await store.listProfileFacts(scopeId)).map((f) => f.id));
  if (lay.facts.every((f) => have.has(f.id!))) return false;
  for (const tr of lay.transcripts) {
    const there = new Set((await store.listUtterances(scopeId, tr.visitId)).map((u) => u.id));
    if (tr.rows.some((u) => !there.has(u.id!))) await store.addUtterances(scopeId, tr.visitId, tr.rows);
  }
  for (const f of lay.facts) if (!have.has(f.id!)) await store.addProfileFact(scopeId, f);
  return true;
}

/**
 * Lay the account out to a scene (or a moment of the story): every record of the space is replaced by the story as it
 * stood then (layoutAtMoment; his family links and their switches stay, his daughter's own clips too), his settings keep
 * their own keys (his language), and the clock is offset so that the account's "now" is that moment. With the
 * director's story sheet (`edits`), the story is laid out with its changes in; a sheet the story cannot take is refused
 * before anything is written (FilmingError "invalid", the sentence says what).
 */
export async function seedToMoment(
  subject: Subject,
  target: { scene: string } | { day: number; time: string },
  realNow: number,
  edits: StoryEdits | null = null,
): Promise<SessionRow> {
  const scope = await fresh(subject);
  const store = subject.store;
  const m = resolveMoment(target);
  const tz = scopeTz(scope);
  const keepClips = await store.listReminderClips(scope.id);
  let lay: StoryLayout;
  try {
    lay = layoutAtMoment(scope.id, m, { tz, keepClips, edits });
  } catch (err) {
    if (err instanceof StoryEditError) throw new FilmingError("invalid", err.message);
    throw err;
  }
  await store.reseedAccount(scope.id, {
    template: "mr-tan",
    d0: lay.d0,
    settings: { ...settingsKept(scope.settings), ...lay.settings },
    onboarding: "done",
    example_data: false,
    tracking_since: iso(lay.at),
    tables: lay.tables,
  });
  // the transcripts and the facts went in with that one call (lay.tables); a database whose seed function is older
  // than migration 0014 ignores the two tables, and then they are written here
  await ensureLayoutWhole(store, scope.id, lay);
  const row = await store.setClockOffset(scope.id, lay.at - realNow);
  await syncPatternQuestions(store, row);
  const changed = countStoryEdits(edits);
  announce(scope.id, "seed", "director", `laid out to ${m.scene ?? `day ${m.day}`} ${m.time}${changed ? ` with ${changed} story sheet change${changed === 1 ? "" : "s"}` : ""}`);
  showScenePage(scope.id, m.scene);
  return (await store.getSession(scope.id)) ?? row;
}

/** Where a forward move goes: some minutes on, or the next HH:MM (on `date` when given). */
export type ForwardTarget = { minutes: number } | { time: string; date?: string };

/** The instant a forward move asks for, from the account's "now" (no check). */
export function forwardInstant(scope: SessionRow, to: ForwardTarget, realNow: number): number {
  const current = scopeNow(scope, realNow);
  const tz = scopeTz(scope);
  if ("minutes" in to) return current + Math.round(to.minutes) * MINUTE;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(to.time)) throw new FilmingError("invalid", "The time is HH:MM, 24-hour.");
  if (to.date && !/^\d{4}-\d{2}-\d{2}$/.test(to.date)) throw new FilmingError("invalid", "The date is YYYY-MM-DD.");
  const date = to.date ?? localDate(current, tz);
  const target = zonedTimeToUtcMs(date, to.time, tz);
  return !to.date && target <= current ? zonedTimeToUtcMs(addDays(date, 1), to.time, tz) : target;
}

/**
 * Move the account's clock forward (never back). What was lived until now is settled first; the new offset moves
 * tracking_since to the new "now", so the windows in the skipped time are never "no reply".
 */
export async function moveForward(subject: Subject, to: ForwardTarget, realNow: number): Promise<SessionRow> {
  const scope = await fresh(subject);
  if (scope.d0 !== FILMING_D0 || scope.template !== "mr-tan") throw new FilmingError("not_laid_out", "Lay the account out to a scene first.");
  const current = scopeNow(scope, realNow);
  const target = forwardInstant(scope, to, realNow);
  if (target <= current) throw new FilmingError("forward_only", "The clock only moves forward. To go back, lay the account out to a scene again.");
  const tz = scopeTz(scope);
  const day = dayOfDate(scopeD0(scope), localDate(target, tz));
  if (!inStory(day) || day > CLOCK_LAST_DAY) throw new FilmingError("beyond_clock", OUTSIDE_STORY);
  await settleAccountNoReply(subject.store, scope, realNow);
  const row = await subject.store.setClockOffset(scope.id, target - realNow);
  announce(scope.id, "forward", "director", `clock moved forward to ${localDate(target, tz)} ${localHHMM(target, tz)}`);
  return row;
}

// ---------------------------------------------------------------- the reminder and "no reply"

export interface CueDeps {
  /** where notices go (default lib/jobs/notify.ts sendNotice: track I's web push) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
  /** his language for his notice (default 华语) */
  locale?: Locale;
  /** his family members who may be told (default track D's familyRecipients) */
  recipients?: (scopeId: string) => Promise<FamilyRecipient[]>;
}

const slotMed = (slot: DaySlot) => `slotMed.${slot}` as DailyKey;

/** A cell that is open for an answer: none yet, or 「等一下」. */
const open = (c: SlotDay["cells"][number]) => c.state === null || (c.state === "unconfirmed" && c.reason === "later");

/** What is recorded in a slot today, in words for the director (the refusal of a cue on an answered slot). */
function recordedWords(s: SlotDay | undefined): string {
  if (!s || !s.cells.length) return "There is no medicine in that part of the day.";
  const words = s.cells.map((c) => `${c.name} ${c.state === "taken" ? "taken" : c.state === "missed" ? "not taken" : c.reason === "no_reply" ? "no reply" : "open"}`);
  return `This slot is already recorded: ${words.join(", ")}.`;
}

/**
 * Why "Simulate no reply" cannot be pressed for a day with these slots, or null when it can (a cell is still open):
 * simulateNoReply's own precondition, said before the tap in the demo console's words ("This day is already recorded:
 * Amlodipine taken."). Pure.
 */
export function noReplyBlockedWords(days: SlotDay[]): string | null {
  const withMeds = days.filter((d) => d.cells.length > 0);
  if (withMeds.length === 0) return "No tablet is due on this day, so there is nothing to leave unanswered.";
  if (withMeds.some((d) => d.cells.some(open))) return null;
  const words = withMeds.flatMap((d) => d.cells.map((c) => `${c.name} ${c.state === "taken" ? "taken" : c.state === "missed" ? "not taken" : c.reason === "no_reply" ? "no reply" : "not confirmed"}`));
  return `This day is already recorded: ${words.join(", ")}.`;
}

/** noReplyBlockedWords for the account's today, read from its store. */
async function noReplyWhyFor(subject: Subject, realNow: number): Promise<string | null> {
  const scope = (await subject.store.getSession(subject.scope.id)) ?? subject.scope;
  const today = scope.story_day;
  const [meds, doses] = await Promise.all([subject.store.listMeds(scope.id), subject.store.listDoses(scope.id, { fromDay: today, toDay: today })]);
  return noReplyBlockedWords(buildDoseDay(scope, today, meds, doses, realNow));
}

function pickSlot(days: SlotDay[], slot: DaySlot | undefined, wanted: (s: SlotDay) => boolean): SlotDay | undefined {
  if (slot) return days.find((d) => d.slot === slot);
  return (
    days.find((d) => (d.phase === "first" || d.phase === "second") && wanted(d)) ??
    days.find((d) => d.phase === "before" && wanted(d)) ??
    days.find(wanted) ??
    days[0]
  );
}

export interface ReminderFired {
  slot: DaySlot;
  /** dose_first, or dose_second when the first one already went */
  kind: string;
  /** YYYY-MM-DD of the slot (the account's today) */
  date: string;
  /** notices the sender reported as sent (0 until his phone subscribed to push) */
  sent: number;
  /** both reminders had already gone: the second one was sent again */
  again: boolean;
}

/** Pop the slot's reminder now (the one the job sends at 8:45), only while a cell of the slot is waiting for him. */
export async function fireReminder(subject: Subject, input: { slot?: DaySlot }, realNow: number, deps: CueDeps = {}): Promise<ReminderFired> {
  const scope = await fresh(subject);
  const store = subject.store;
  const today = scope.story_day;
  const [meds, doses] = await Promise.all([store.listMeds(scope.id), store.listDoses(scope.id, { fromDay: today, toDay: today })]);
  const days = buildDoseDay(scope, today, meds, doses, realNow);
  const s = pickSlot(days, input.slot, (d) => d.cells.some(waitingForHim));
  if (!s || !s.cells.some(waitingForHim)) throw new FilmingError("nothing_waiting", recordedWords(s));
  let kind: string = DELIVERY.doseFirst;
  let r = await store.recordDelivery(scope.id, { kind, ref: "dose", day: today, slot: s.slot });
  let again = false;
  if (!r.created) {
    kind = DELIVERY.doseSecond;
    r = await store.recordDelivery(scope.id, { kind, ref: "dose", day: today, slot: s.slot });
    again = !r.created;
  }
  const locale = deps.locale ?? "zh-Hans";
  const notice: Notice = {
    kind: kind === DELIVERY.doseFirst ? "dose_first" : "dose_second",
    to: { role: "patient", userId: scope.owner_user_id! },
    title: dt(locale, slotMed(s.slot)),
    body: dt(locale, "notice.dose.body"),
    url: `/p/today?remind=dose-${s.slot}`,
    tag: `dose-${s.date}-${s.slot}`,
    ttlS: 3600,
    deliveryId: r.delivery.id,
    scopeId: scope.id,
    locale,
  };
  const sent = (await (deps.send ?? sendNotice)(notice, store)).sent;
  return { slot: s.slot, kind, date: s.date, sent, again };
}

export interface NoReplySimulated {
  slot: DaySlot;
  date: string;
  /** the cells recorded "no reply" */
  written: number;
  /** the account's clock moved to the window's close (HH:MM), or null when it was already past it */
  movedTo: string | null;
  /** family members told */
  family: number;
  /** why nobody was told: no linked family member, or his no-reply switch is off for each of them */
  familyWhy: "no_link" | "switch_off" | null;
}

/**
 * The slot's window closes now with no answer: the clock moves to its close (plus a minute) when it is not there yet,
 * this one window stays his (tracking_since just before its close, so the move does not make it skipped time), the
 * waiting cells are recorded unconfirmed / no reply by the director, and each family member whose no-reply switch he
 * turned on is told once (reminder_delivery family_no_reply: the scheduled job never tells her twice).
 */
export async function simulateNoReply(subject: Subject, input: { slot?: DaySlot }, realNow: number, deps: CueDeps = {}): Promise<NoReplySimulated> {
  const store = subject.store;
  let scope = await fresh(subject);
  const today = scope.story_day;
  const tz = scopeTz(scope);
  const meds = await store.listMeds(scope.id);
  const before = buildDoseDay(scope, today, meds, await store.listDoses(scope.id, { fromDay: today, toDay: today }), realNow);
  const target = pickSlot(before, input.slot, (d) => d.cells.some(open));
  if (!target || !target.cells.some(open)) throw new FilmingError("nothing_waiting", recordedWords(target));

  let movedTo: string | null = null;
  if (scopeNow(scope, realNow) < target.closeMs) {
    await settleAccountNoReply(store, scope, realNow);
    scope = await store.setClockOffset(scope.id, target.closeMs + MINUTE - realNow);
    movedTo = localHHMM(target.closeMs + MINUTE, tz);
  }
  const since = scope.tracking_since ? Date.parse(scope.tracking_since) : Number.NEGATIVE_INFINITY;
  if (since >= target.closeMs) scope = await store.updateScope(scope.id, { tracking_since: iso(target.closeMs - 1) });

  const doses = await store.listDoses(scope.id, { fromDay: today, toDay: today });
  const slotDay = buildDoseDay(scope, today, meds, doses, realNow).find((d) => d.slot === target.slot);
  let written = 0;
  for (const c of slotDay?.cells.filter(open) ?? []) {
    if (c.row) await store.deleteDose(scope.id, c.row.id).catch(() => undefined);
    const dose = await store.logDose(scope.id, { medication_id: c.medicationId, day: today, slot: target.slot, state: "unconfirmed", reason: "no_reply" });
    written += 1;
    const med = meds.find((m) => m.id === c.medicationId);
    publish<DoseLoggedData>(
      scope.id,
      "dose.logged",
      `Director: no reply recorded for ${med ? medName(med) : c.name}, ${target.slot} (the window closed at ${target.schedule.closes})`,
      { dose, name: c.name, by: "director" },
    );
  }

  const recipients = await (deps.recipients ?? ((id: string) => familyRecipients(id)))(scope.id).catch(() => [] as FamilyRecipient[]);
  const on = recipients.filter((r) => r.noReplyAlert);
  let family = 0;
  for (const r of on) {
    const { created, delivery } = await store.recordDelivery(scope.id, { kind: DELIVERY.familyNoReply, ref: r.linkId, day: today, slot: target.slot });
    if (!created) continue;
    family += 1;
    const who = r.patientLabel?.trim() || dt(r.locale, "notice.family.who");
    await (deps.send ?? sendNotice)(
      {
        kind: "family_no_reply",
        to: { role: "family", userId: r.userId, linkId: r.linkId },
        title: dt(r.locale, "notice.family.title", { who, slotMed: dt(r.locale, slotMed(target.slot)).toLowerCase() }),
        body: dt(r.locale, "notice.family.body", { first: shortTime(target.schedule.first), second: shortTime(target.schedule.second) }),
        url: `/f?link=${encodeURIComponent(r.linkId)}`,
        tag: `no-reply-${target.date}-${target.slot}`,
        ttlS: 6 * 3600,
        deliveryId: delivery.id,
        scopeId: scope.id,
        locale: r.locale,
      },
      store,
    );
  }
  return {
    slot: target.slot,
    date: target.date,
    written,
    movedTo,
    family,
    familyWhy: family > 0 || on.length > 0 ? null : recipients.length ? "switch_off" : "no_link",
  };
}

// ---------------------------------------------------------------- the scripted fallback (second round)

export interface FallbackSet {
  /** the visit the switch is on (today's, being recorded) */
  visit: string;
  /** YYYY-MM-DD of that visit */
  date: string;
  on: boolean;
  /** the story has a script for this day's visit (Day 0, 8, 12, 42): without one the switch changes nothing */
  script: boolean;
}

const OPEN_VISIT = new Set(["recording", "transcribing", "awaiting_transcript"]);

/**
 * The crew's scripted fallback for the visit being recorded on his phone today (real-app 5.2, 5.4: 剧本兜底 on a filming
 * account): the crew's own request unlocks it, as on a filming session, and with it on a sentence the transcription
 * mishears shows the scene's script line (lib/visit/pipeline.ts, live captions and the whole transcript). The switch
 * belongs to one visit, so it is set after the visit starts.
 */
export async function setFilmingFallback(subject: Subject, on: boolean): Promise<FallbackSet> {
  const scope = await fresh(subject);
  const visits = await subject.store.listVisits(scope.id);
  const visit = visits
    .filter((v) => v.day === scope.story_day && OPEN_VISIT.has(v.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!visit) throw new FilmingError("no_visit", "No visit is being recorded on the phone today. Start the visit first: the fallback belongs to that visit.");
  // the director's request passed the crew's gate (the route); a filming account is a filming scope: nothing to unlock
  const set = await setScriptedFallback(subject.store, scope, visit.id, on);
  return { visit: visit.id, date: visit.date, on: set, script: scriptFor(scope, visit).length > 0 };
}
