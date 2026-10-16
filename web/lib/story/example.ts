/**
 * Mr Tan's example data laid out on an account's real dates (docs/plan/real-app.md 4.1-4.3), and seedAccount: the one
 * way an account's space is laid out (track A's sign-up, the developer helper, the example account's "lay it out
 * again" and "start from my own"). First version from the C2 foundation (F1); track C owns this file.
 *
 *   4.1 the anchor   today is story day 42: d0 = today - 42 (Singapore dates); nothing is laid out on or after day 42
 *                    except v3, today's planned follow-up (status planned, its audio_fixture kept, no transcript).
 *   4.2 the tables   v1, v2, p1 with their dates recomputed as d0 + day; R1-R4; amlodipine, ibuprofen and the relative's
 *                    box, the bag's dispensed date moved by the same shift; losartan (prescribed at v3) is not there yet;
 *                    33 doses (4 missed on tai chi mornings), 24 readings, 2 notes, 6 questions (an answer recorded at v3
 *                    is not given yet: that question is open); since 10-15 also the rows of ./example-extra.ts (28 more
 *                    readings, 11 notes in his own words, one of them a sign kept for his doctor, 2 open questions of his own); his daughter's clip with by_label "Wei Ling（示例）" and
 *                    no author account; no family grant and no link. His profile: 「陈先生（示例）」, age, home and
 *                    languages as facts he confirmed (source patient); clinic and routine live in the scope's settings.
 *                    The three past visits keep their recordings' transcripts (the replay files' lines), each line's
 *                    speaker worked out as a replay does (lib/visit/roles.ts) and confirmed, as he would have in the
 *                    review after each visit; the answers on his list point at their lines.
 *   4.3 the weekdays the template's d0 is a Monday and tai chi is on Tue and Thu; the new d0 falls on another weekday,
 *                    so every weekday-specific habit moves by the same number of days and the four missed mornings stay
 *                    on tai chi days. The moved routine and his clinic are written into the scope's settings.
 *   4.4 untracked    tracking_since is the moment the space is laid out: a reminder window that closed before it is
 *                    never settled as "no reply" (lib/daily/doses.ts) and not counted where the summaries honour it.
 *
 *   more medicines   since 10-15 (scene 3 of the owner's film) also ./example-meds.ts: metformin, atorvastatin and aspirin,
 *                    label confirmed, with their doses from day 9 (the four tai chi mornings missed for every morning one).
 *
 *   one step         everything above is laid out in one store call (createAccountScope / reseedAccount with the
 *                    tables, which the database runs as one transaction, real-app 4.1): the nine seed tables and, since
 *                    migration 0014, the past visits' transcripts and the profile's facts too. A sign-up or a 「重新铺一
 *                    遍」 that fails leaves all of it or none of it. Two things follow the call and are safe to repeat:
 *                    ensureExampleWhole (writes the transcripts and facts only where they are missing: a database
 *                    whose seed function predates 0014 ignores them; it runs again on his next page until nothing is
 *                    missing) and the pattern question's wording (syncPatternQuestions, which Today and the brief run
 *                    on every open anyway).
 *
 * buildExampleSpace and exampleProfileFacts are pure (no store, no clock of their own). seedAccount, reseedExample
 * and clearExample write through the store they are given (never the process-wide store: the caller's store decides
 * the rights).
 */
import { fixtureClipPath, fixtureUtterances, replayIdForAudioFixture } from "@/lib/asr/fixtures";
import { syncPatternQuestions } from "@/lib/daily/patterns";
// 10-15 (the demo video's visit details): the clinic visits' doctor and today's visit time, in the settings
import { exampleVisitDetails, VISIT_DETAILS_KEY } from "@/lib/daily/visit-details";
import { inferRoles } from "@/lib/visit/roles";
import { DEFAULT_TZ, localDate } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { storyDate, weekdayIndex } from "./clock";
import { exampleExtraOn, exampleExtraTables, exampleReading } from "./example-extra";
import { exampleMedsOn, exampleMedsTables } from "./example-meds";
import { buildSeedTables, loadTemplate, type SeedTables } from "./seed";
import type { NewProfileFact, NewUtterance, OnboardingState, ProfileFactRow, ScopeRoutineEntry, ScopeSettings, SessionRow, Store, UtteranceRow, VisitRow } from "@/lib/store/types";

/** Story day of "today" on an example account. */
export const EXAMPLE_TODAY_DAY = 42;
/** The persona's language codes as he would say them. */
const LANGUAGE_WORDS: Record<string, string> = { "zh-Hans": "华语", "en-SG": "英语", en: "英语", ms: "马来语", ta: "淡米尔语" };
/** The example daughter's label on her clip (no account behind it). */
export const EXAMPLE_FAMILY_LABEL = "Wei Ling（示例）";
/** How the example profile names him (a fact in his profile; the account's own display name is left alone). */
export const EXAMPLE_PROFILE_NAME = "陈先生（示例）";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const [a, b] = [fromIso, toIso].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / DAY_MS);
}

/** The id of the replay line that says `answer` word for word, in the visit's recording (its audio_fixture), or null. */
function answerLineId(audioFixture: string | null, answer: string | null): string | null {
  const replay = replayIdForAudioFixture(audioFixture);
  if (!replay || !answer) return null;
  return fixtureUtterances(replay)?.find((u) => u.text.trim() === answer.trim())?.id ?? null;
}

/** The template's routine with every weekday-specific habit moved by `shift` days (daily habits unchanged). */
export function rotateRoutine(routine: ScopeRoutineEntry[], shift: number): ScopeRoutineEntry[] {
  const k = ((shift % 7) + 7) % 7;
  return routine.map((r) =>
    Array.isArray(r.days) ? { ...r, days: r.days.map((d) => WEEKDAYS[(WEEKDAYS.indexOf(d) + k) % 7] ?? d) } : { ...r },
  );
}

export interface ExampleSpace {
  d0: string;
  settings: ScopeSettings;
  tables: SeedTables;
}

/**
 * The example space for an account whose Singapore date today is `today` ("YYYY-MM-DD"). `nowIso` stamps the rows'
 * created_at. Rows carry `scopeId` as their session_id.
 */
export function buildExampleSpace(scopeId: string, opts: { today: string; nowIso: string }): ExampleSpace {
  const seed = loadTemplate("mr-tan");
  const seedD0 = seed.meta.d0;
  const d0 = addDays(opts.today, -EXAMPLE_TODAY_DAY);
  const shift = daysBetween(seedD0, d0);
  const t = buildSeedTables(scopeId, opts.nowIso, "mr-tan");

  const later = new Set(t.visits.filter((v) => v.day >= EXAMPLE_TODAY_DAY).map((v) => v.id));
  const visits = t.visits.map((v) =>
    later.has(v.id) ? { ...v, date: storyDate(d0, v.day), status: "planned" as const } : { ...v, date: storyDate(d0, v.day) },
  );
  const medications = t.medications
    .filter((m) => !(m.prescribed_visit_id && later.has(m.prescribed_visit_id)) && !(m.start_day !== null && m.start_day >= EXAMPLE_TODAY_DAY))
    .map((m) => (m.label?.dispensed ? { ...m, label: { ...m.label, dispensed: addDays(m.label.dispensed, shift) } } : m));
  // an answer given at a visit that has not happened yet (v3, today) is not there; an answer from a past visit is linked
  // to its line in that visit's recording (the replay file), so the list can say where in the recording it was said
  const questions = t.questions.map((q) =>
    q.answer_visit_id && later.has(q.answer_visit_id)
      ? { ...q, status: "open" as const, answer_text: null, answer_utterance_id: null, answer_visit_id: null, answer_speaker: null }
      : { ...q, answer_utterance_id: q.answer_utterance_id ?? answerLineId(visits.find((v) => v.id === q.answer_visit_id)?.audio_fixture ?? null, q.answer_text) },
  );
  const reminder_clips = t.reminder_clips.map((c) => ({ ...c, by_user_id: null, by_label: EXAMPLE_FAMILY_LABEL }));
  const keep = <R extends { day: number }>(rows: R[]) => rows.filter((r) => r.day < EXAMPLE_TODAY_DAY);

  const routine = rotateRoutine((seed.persona.routine ?? []) as ScopeRoutineEntry[], weekdayIndex(d0, 0) - weekdayIndex(seedD0, 0));
  // 10-15 (the owner: 「顺手多塞一点数据」): more of his everyday record, on the example account only (./example-extra.ts)
  const extra = exampleExtraOn() ? exampleExtraTables(scopeId, d0, EXAMPLE_TODAY_DAY) : { bp_readings: [], notes: [], questions: [] };
  // 10-15 (scene 3 of the owner's film): three more of his medicines, with their labels and doses (./example-meds.ts)
  const moreMeds = exampleMedsOn() ? exampleMedsTables(scopeId, { d0, beforeDay: EXAMPLE_TODAY_DAY, nowIso: opts.nowIso }) : { medications: [], dose_logs: [] };
  // the past visits' transcripts and the profile's facts go in with the rest (one step: real-app 4.1)
  const utterances: UtteranceRow[] = exampleUtterances(visits).flatMap((t) =>
    t.rows.map((u) => ({
      id: u.id!,
      session_id: scopeId,
      visit_id: t.visitId,
      t_start_ms: u.t_start_ms,
      t_end_ms: u.t_end_ms,
      speaker_cluster: u.speaker_cluster ?? null,
      role: u.role ?? "unknown",
      role_state: u.role_state ?? "unknown",
      text: u.text,
      lang: u.lang ?? null,
      clip_path: u.clip_path ?? null,
      scripted_fallback: u.scripted_fallback ?? false,
      created_at: opts.nowIso,
    })),
  );
  const profile_facts: ProfileFactRow[] = exampleProfileFacts(opts.nowIso).map((f) => ({
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
    created_at: opts.nowIso,
  }));
  return {
    d0,
    settings: { clinic: seed.persona.healthier_sg_clinic ?? null, routine, [VISIT_DETAILS_KEY]: exampleVisitDetails() },
    tables: {
      utterances,
      profile_facts,
      visits,
      visit_items: t.visit_items.filter((it) => !later.has(it.visit_id)),
      medications: [...medications, ...moreMeds.medications],
      // C2 track B (fix round 10-11; real-app 4.4): each laid-out dose says it is his record from before tracking began
      // (DoseLogRow.pre_tracking), so the summaries count it for what it is, not for the moment it was written at
      dose_logs: [...keep(t.dose_logs).map((d) => ({ ...d, pre_tracking: true })), ...moreMeds.dose_logs],
      bp_readings: [...keep(t.bp_readings).map((r) => (exampleExtraOn() ? exampleReading(r) : r)), ...extra.bp_readings],
      notes: [...keep(t.notes), ...extra.notes],
      questions: [...questions, ...extra.questions],
      family_grants: [],
      reminder_clips,
    },
  };
}

/**
 * The example profile (4.2 档案): the persona's non-clinical facts, as facts he entered and confirmed when he started
 * (day 0). His clinic and routine are not here: they are the scope's settings. Nothing clinical is invented.
 */
export function exampleProfileFacts(nowIso: string): NewProfileFact[] {
  const p = loadTemplate("mr-tan").persona;
  const base = { source: "patient" as const, entered_by: "patient", confirmed_by: "patient", confirmed_at: nowIso, created_day: 0 };
  const facts: NewProfileFact[] = [{ ...base, id: "fact-name", kind: "name", text: EXAMPLE_PROFILE_NAME, data: { example: true } }];
  if (typeof p.age === "number") facts.push({ ...base, id: "fact-age", kind: "age", text: String(p.age), data: { years: p.age } });
  if (p.home) facts.push({ ...base, id: "fact-home", kind: "home", text: p.home, data: null });
  if (p.languages?.length) facts.push({ ...base, id: "fact-languages", kind: "language", text: p.languages.map((l) => LANGUAGE_WORDS[l] ?? l).join("、"), data: { languages: [...p.languages] } });
  return facts;
}

/**
 * The transcripts of the example's past visits (v1, v2, p1): every line of the visit's replay file, its speaker worked
 * out from what the lines say (lib/visit/roles.ts inferRoles, as a replay does) and confirmed (he went through each
 * visit's review in the story), the stand-in clip where there is one. v3, today's planned visit, has none.
 */
export function exampleUtterances(visits: Pick<VisitRow, "id" | "kind" | "day" | "status" | "audio_fixture">[]): { visitId: string; rows: NewUtterance[] }[] {
  const required = loadTemplate("mr-tan").required_doctor_lines.map((r) => ({ text: r.text, speaker: r.speaker }));
  const out: { visitId: string; rows: NewUtterance[] }[] = [];
  for (const v of visits) {
    if (v.status === "planned" || v.day >= EXAMPLE_TODAY_DAY) continue;
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

// ---------------------------------------------------------------- seedAccount (store-facing)

export type SeedSpace = "blank" | "example";

/**
 * Settings keys that belong to the laid-out timeline (reset by a reseed or a clear); every other key is kept. With the
 * routine go the reminder times set on top of it, and who was filling in the last setting-up round.
 */
export const TIMELINE_SETTINGS_KEYS = ["clinic", "routine", "reminder_time", "reminder_times", "onboarding_step", "onboarding_by", "example_intro_dismissed", "visit_details"] as const;

export interface SeedAccountInput {
  /** the account's user id; its space's id is the same */
  userId: string;
  space: SeedSpace;
  /** the moment the space is laid out (default: the app's clock, lib/time/now); also its tracking_since */
  nowMs?: number;
  /**
   * His date today ("YYYY-MM-DD" in tz). Default: the date of nowMs in tz. Only for a caller that must pin it (the
   * developer helper's `today`); it must agree with the clock the store reads, or "today" is not day 42.
   */
  today?: string;
  /** default Asia/Singapore */
  tz?: string;
  /** default: "started" for blank (he goes to /onboard), "done" for the example */
  onboarding?: OnboardingState | null;
  /** extra settings to keep (his UI language: { locale }) */
  settings?: ScopeSettings;
}

function times(input: { nowMs?: number; today?: string; tz?: string }) {
  const ms = input.nowMs ?? appNowMs();
  const tz = input.tz ?? DEFAULT_TZ;
  return { nowIso: new Date(ms).toISOString(), today: input.today ?? localDate(ms, tz), tz };
}

/**
 * Is anything of the example's transcripts or profile facts missing, and if so, write exactly that. Safe to repeat.
 *
 * With migration 0014 the layout's one call wrote them all and this only reads the profile's facts once. A database
 * whose seed function predates 0014 ignored the two tables: then the transcripts are written first (a line with the
 * same id is replaced, so a second run changes nothing) and the facts last, each only if it is not there. Because the
 * facts come last, "every example fact is there" means nothing is missing, and that one read is the whole check. A run
 * that fails in between is completed by the next: seedAccount and reseedExample call this right after the layout, and
 * app/p/layout.tsx calls it when he next opens a page of an example account.
 * Returns true when it wrote something.
 */
export async function ensureExampleWhole(store: Store, scope: Pick<SessionRow, "id" | "example_data" | "tracking_since">): Promise<boolean> {
  if (!scope.example_data) return false;
  const want = exampleProfileFacts(scope.tracking_since ?? new Date(appNowMs()).toISOString());
  const have = new Set((await store.listProfileFacts(scope.id)).map((f) => f.id));
  if (want.every((f) => have.has(f.id!))) return false;
  for (const t of exampleUtterances(await store.listVisits(scope.id))) {
    const there = new Set((await store.listUtterances(scope.id, t.visitId)).map((u) => u.id));
    if (t.rows.some((u) => !there.has(u.id!))) await store.addUtterances(scope.id, t.visitId, t.rows);
  }
  for (const fact of want) if (!have.has(fact.id!)) await store.addProfileFact(scope.id, fact);
  return true;
}

/** The example's pattern question (q-tai-chi) worded from his log on the new dates (lib/daily/patterns.ts). */
async function syncExamplePatterns(store: Store, scope: SessionRow): Promise<void> {
  await syncPatternQuestions(store, scope);
}

/**
 * Lay out a new account's space: blank (no rows, d0 today, onboarding "started") or Mr Tan's example data on today's
 * dates (4.1-4.4, onboarding "done"). Creates the scope with every row of the example in the same step
 * (store.createAccountScope: one transaction), then makes sure nothing is missing (ensureExampleWhole) and words its
 * pattern question from the log. Returns the scope row with "today" computed.
 *
 * Track A's sign-up calls it after the account row exists; a step that fails throws, and the caller removes the
 * half-made account (real-app 3.4: no half account is left behind).
 */
export async function seedAccount(store: Store, input: SeedAccountInput): Promise<SessionRow> {
  const { nowIso, today, tz } = times(input);
  if (input.space === "blank") {
    return store.createAccountScope({
      user_id: input.userId,
      d0: today,
      template: "blank",
      tz,
      settings: { ...(input.settings ?? {}) },
      onboarding: input.onboarding === undefined ? "started" : input.onboarding,
      example_data: false,
      tracking_since: nowIso,
    });
  }
  const ex = buildExampleSpace(input.userId, { today, nowIso });
  const scope = await store.createAccountScope({
    user_id: input.userId,
    d0: ex.d0,
    template: "mr-tan",
    tz,
    settings: { ...(input.settings ?? {}), ...ex.settings },
    onboarding: input.onboarding === undefined ? "done" : input.onboarding,
    example_data: true,
    tracking_since: nowIso,
    tables: ex.tables,
  });
  await ensureExampleWhole(store, scope);
  await syncExamplePatterns(store, scope);
  return (await store.getSession(scope.id)) ?? scope;
}

/** His settings without the timeline's keys (his language and other tracks' keys stay). */
export function settingsKept(settings: ScopeSettings | null | undefined): ScopeSettings {
  const out: ScopeSettings = { ...(settings ?? {}) };
  for (const k of TIMELINE_SETTINGS_KEYS) delete out[k];
  return out;
}

/**
 * The example account's 「重新铺一遍」 (4.7): every record of the space goes (not his family links and their switches) and
 * Mr Tan's example is laid out again on today's dates, tracking from now, in one store call (one transaction: the old
 * data stays whole or the new data is whole). Accounts only (the store refuses others).
 */
export async function reseedExample(store: Store, scope: SessionRow, opts: { nowMs?: number } = {}): Promise<SessionRow> {
  const { nowIso, today } = times({ nowMs: opts.nowMs, tz: scope.tz });
  const ex = buildExampleSpace(scope.id, { today, nowIso });
  const row = await store.reseedAccount(scope.id, {
    template: "mr-tan",
    d0: ex.d0,
    settings: { ...settingsKept(scope.settings), ...ex.settings },
    onboarding: "done",
    example_data: true,
    tracking_since: nowIso,
    tables: ex.tables,
  });
  await ensureExampleWhole(store, row);
  await syncExamplePatterns(store, row);
  return (await store.getSession(scope.id)) ?? row;
}

/**
 * The example account's 「清空，从我自己的开始」 (4.7): every record goes and the space becomes a blank one with d0 today,
 * tracking from now, onboarding started (he goes to /onboard). His family links and their switches stay.
 */
export async function clearExample(store: Store, scope: SessionRow, opts: { nowMs?: number } = {}): Promise<SessionRow> {
  const { nowIso, today } = times({ nowMs: opts.nowMs, tz: scope.tz });
  return store.reseedAccount(scope.id, {
    template: "blank",
    d0: today,
    settings: settingsKept(scope.settings),
    onboarding: "started",
    example_data: false,
    tracking_since: nowIso,
    tables: {},
  });
}
