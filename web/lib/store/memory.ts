/**
 * In-process store. One instance per Node process, held on globalThis so `next dev` hot reload and
 * every route handler share it. This is also the filming mode: one long-lived `next start -H 0.0.0.0`
 * on a laptop, phones on the same LAN. Data is lost when the process exits.
 *
 * C2: three kinds of scope share the session map: judges' sandboxes and the crew's filming sessions (demo rows, a
 * stored story clock) and accounts' own spaces (id = the user's id; story_day / story_time computed on every hand-out,
 * lib/time/clock.ts projectScope). The story clock, a reset and joining devices exist only for demo rows; an account
 * asking for them gets StoreError("account_scope"). Account-level tables (accounts, links, consent, push, limits,
 * leases) live beside the sessions. The clock is lib/time/now.ts unless a test passes its own.
 */
import { randomUUID } from "node:crypto";
import { storyDate } from "@/lib/story/clock";
import { buildSeedTables, templateDefaults, type SeedTables } from "@/lib/story/seed";
import { DEFAULT_TZ, projectScope, scopeNowMs } from "@/lib/time/clock";
import { now as appNow } from "@/lib/time/now";
import { grantOut, isUserId, scopedTables, withoutUnset } from "./rows";
import { scopeD0 } from "./scope";
import {
  StoreError,
  type AccountEventRow,
  type AccountPatch,
  type AccountRow,
  type BpFilter,
  type BpReadingRow,
  type BriefSnapshotRow,
  type CareAccessLogRow,
  type CareLinkFilter,
  type CareLinkResult,
  type CareLinkRow,
  type ChatFilter,
  type ChatMessageRow,
  type ConsentKind,
  type ConsentRecordRow,
  type ConsentTextRow,
  type CreateSessionOptions,
  type DaySlot,
  type DayRange,
  type DemoSessionRow,
  type DeliveryKey,
  type DietCheckRow,
  type DoseFilter,
  type DoseLogRow,
  type EvalRunRow,
  type FamilyGrantItems,
  type FamilyGrantRow,
  type GrantHistoryRow,
  type KnownDeviceRow,
  type MedicationRow,
  type NewAccount,
  type NewAccountScope,
  type NewBpReading,
  type NewBriefSnapshot,
  type NewCareAccessLog,
  type NewCareInvite,
  type NewChatMessage,
  type NewTranslation,
  type TranslationDirection,
  type TranslationRow,
  type NewConsentRecord,
  type NewConsentText,
  type NewDietCheck,
  type NewDoseLog,
  type NewEvalRun,
  type NewMedication,
  type NewMember,
  type NewNote,
  type NewOpsRun,
  type NewPreventDone,
  type NewProfileFact,
  type NewPushSubscription,
  type NewQuestion,
  type NewReminderClip,
  type NewResetRequest,
  type NewSafetyEvent,
  type NewServiceReadLog,
  type NewUtterance,
  type NewVisit,
  type NewVisitItem,
  type NewWatchMetric,
  type NoteRow,
  type OpsRunRow,
  type Patch,
  type PreventDoneRow,
  type ProfileFactFilter,
  type ProfileFactRow,
  type PushSubscriptionRow,
  type QuestionFilter,
  type QuestionRow,
  type RateHit,
  type RateWindow,
  type RecoveryCodeRow,
  type ReminderClipRow,
  type ReminderDeliveryRow,
  type ResetRequestRow,
  type ReseedAccount,
  type SafetyEventRow,
  type ScopePatch,
  type ScopeTables,
  type ServiceReadLogRow,
  type SessionMemberRow,
  type SessionRow,
  type Store,
  type UtteranceRow,
  type VisitItemFilter,
  type VisitItemRow,
  type VisitRow,
  type WatchFilter,
  type WatchMetricRow,
  type NewUnderstandingAnswer,
  type UnderstandingAnswerRow,
} from "./types";

/** A session row as kept: an account stores no story clock (it is computed on the way out). */
type StoredSession = Omit<SessionRow, "story_day"> & { story_day: number | null };

interface SessionData extends SeedTables {
  session: StoredSession;
  members: SessionMemberRow[];
  utterances: UtteranceRow[];
  safety_events: SafetyEventRow[];
  // C2
  profile_facts: ProfileFactRow[];
  prevent_done: PreventDoneRow[];
  watch_metrics: WatchMetricRow[];
  diet_checks: DietCheckRow[];
  chat_messages: ChatMessageRow[];
  brief_snapshots: BriefSnapshotRow[];
  deliveries: ReminderDeliveryRow[];
  access_log: CareAccessLogRow[];
  // C2 track S (0009_s_translations): made on first use; a reset or reseed keeps it (the cache of a text is still that
  // text's translation), deleting the scope removes it
  translations?: TranslationRow[];
  // C2 track F (0013_f_understanding): his understanding-checklist answers; they go with the medicines (reset, reseed)
  understanding?: UnderstandingAnswerRow[];
}

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const SLOT_ORDER: Record<DaySlot, number> = { morning: 0, midday: 1, evening: 2, night: 3 };
const DEFAULT_MEMBER = "wei-ling";
const NO_GRANTS: FamilyGrantItems = {
  dose_summary: false,
  bp_summary: false,
  questions_count: false,
  no_reply_alert: false,
  visit_transcripts: false,
  notes: false,
};
const CONSENT_DECISIONS = new Set(["granted", "declined", "withdrawn"]);

const clone = <T>(v: T): T => structuredClone(v);
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;

function inRange(day: number, r?: DayRange): boolean {
  if (!r) return true;
  if (r.fromDay !== undefined && day < r.fromDay) return false;
  if (r.toDay !== undefined && day > r.toDay) return false;
  return true;
}

function byDaySlot<T extends { day: number; slot: DaySlot }>(a: T, b: T): number {
  return a.day - b.day || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
}

/** Strip undefined so `{...row, ...patch}` never overwrites a column with undefined. */
function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The newest `limit` rows, oldest first (undefined: all). */
function newest<T>(rows: T[], limit: number | undefined): T[] {
  if (limit === undefined) return rows;
  return limit > 0 ? rows.slice(-limit) : [];
}

function assertTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new StoreError("invalid", `Unknown time zone ${tz}`);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function emptyExtras(): Pick<
  SessionData,
  "members" | "utterances" | "safety_events" | "profile_facts" | "prevent_done" | "watch_metrics" | "diet_checks" | "chat_messages" | "brief_snapshots" | "deliveries" | "access_log"
> {
  return {
    members: [],
    utterances: [],
    safety_events: [],
    profile_facts: [],
    prevent_done: [],
    watch_metrics: [],
    diet_checks: [],
    chat_messages: [],
    brief_snapshots: [],
    deliveries: [],
    access_log: [],
  };
}

/**
 * C2 track C: the rows of an account's laid-out space, checked as the database checks them before anything is written
 * (a laid-out line belongs to a laid-out visit: utterance_visit_fk), so a refused layout leaves nothing behind.
 */
function laidOutTables(scopeId: string, tables: ScopeTables | undefined): SeedTables {
  const t = scopedTables(scopeId, tables);
  const visits = new Set(t.visits.map((v) => v.id));
  const stray = (t.utterances ?? []).find((u) => !visits.has(u.visit_id));
  if (stray) throw new StoreError("invalid", `Line ${stray.id} names a visit that is not laid out`);
  return t;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private sessions = new Map<string, SessionData>();
  private evalRuns: EvalRunRow[] = [];
  // C2: account-level tables
  private accounts = new Map<string, AccountRow>();
  private recovery = new Map<string, RecoveryCodeRow>();
  private devices: KnownDeviceRow[] = [];
  private resetRequests: ResetRequestRow[] = [];
  private accountEvents: AccountEventRow[] = [];
  private careLinks: CareLinkRow[] = [];
  private grantHistory: GrantHistoryRow[] = [];
  private serviceReads: ServiceReadLogRow[] = [];
  private consentTexts: ConsentTextRow[] = [];
  private consentRecords: ConsentRecordRow[] = [];
  private pushSubs: PushSubscriptionRow[] = [];
  private rateLimits = new Map<string, { window_start: number; window_s: number; count: number; updated_at: string }>();
  private jobLeases = new Map<string, { holder: string; expires_at: number; acquired_at: string }>();
  private opsRuns: OpsRunRow[] = [];
  private now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? appNow;
  }

  private ts(): string {
    return this.now().toISOString();
  }

  /**
   * C2 track J (filming): the stamp of a row written into a scope, on that scope's own clock (lib/time/clock.ts
   * scopeNowMs: real now plus a filming account's clock offset). For a demo session and an ordinary account it is
   * exactly ts(), so they are unchanged. A filming account's answers, readings, notes, questions, medicines, visits,
   * reminders, talk and her views then carry the story's time (「早上 8:52 吃的」 on Today, the brief, her view). Family
   * grants, links, account rows, rate limits and the jobs' own rows stay on the real clock.
   */
  private tsIn(sessionId: string): string {
    const s = this.sessions.get(sessionId)?.session;
    const now = this.now().getTime();
    return new Date(s ? scopeNowMs(s, now) : now).toISOString();
  }

  private data(sessionId: string): SessionData {
    const d = this.sessions.get(sessionId);
    if (!d) throw new StoreError("session_not_found", `No session ${sessionId}`);
    return d;
  }

  /** The row as handed out: an account's story_day / story_time computed for this moment. */
  private view(d: SessionData): SessionRow {
    return projectScope(d.session as SessionRow, this.now().getTime());
  }

  private out(d: SessionData): SessionRow {
    return clone(this.view(d));
  }

  private demoOnly(d: SessionData, what: string): void {
    if (d.session.kind === "account") throw new StoreError("account_scope", `${what} is for demo sessions only`);
  }

  private accountOnly(d: SessionData, what: string): void {
    if (d.session.kind !== "account") throw new StoreError("account_scope", `${what} is for accounts only`);
  }

  private isExpired(s: StoredSession): boolean {
    return s.expires_at !== null && Date.parse(s.expires_at) <= this.now().getTime();
  }

  /** Only judges' sandboxes expire and are removed (never a filming session, never an account). */
  private pruneExpired(): number {
    let n = 0;
    for (const [id, d] of this.sessions) {
      if (d.session.kind === "sandbox" && this.isExpired(d.session)) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }

  private newJoinCode(): string {
    const taken = new Set([...this.sessions.values()].map((d) => d.session.join_code));
    for (;;) {
      let code = "";
      for (let i = 0; i < 6; i++) code += JOIN_ALPHABET[Math.floor(Math.random() * JOIN_ALPHABET.length)];
      if (!taken.has(code)) return code;
    }
  }

  // ------------------------------------------------------------ sessions

  async createSession(opts: CreateSessionOptions = {}): Promise<DemoSessionRow> {
    this.pruneExpired();
    const template = opts.template ?? "mr-tan";
    if (template === "blank") throw new StoreError("invalid", "a demo session needs the template timeline");
    const defaults = templateDefaults(template);
    const now = this.now();
    const expires = opts.ttl_hours ? new Date(now.getTime() + opts.ttl_hours * 3_600_000).toISOString() : null;
    const session: StoredSession = {
      id: `demo-${randomUUID()}`,
      join_code: this.newJoinCode(),
      template,
      story_day: opts.story_day ?? defaults.story_day,
      story_time: opts.story_time === undefined ? defaults.story_time : opts.story_time,
      filming_mode: opts.filming_mode ?? false,
      created_at: now.toISOString(),
      expires_at: expires,
      kind: opts.kind ?? (expires ? "sandbox" : "filming"),
      owner_user_id: null,
      d0: null,
      tz: DEFAULT_TZ,
      settings: {},
      onboarding: null,
      example_data: false,
      tracking_since: null,
      clock_offset_ms: null,
      filming: false,
    };
    const d: SessionData = { session, ...emptyExtras(), ...buildSeedTables(session.id, session.created_at, template) };
    this.sessions.set(session.id, d);
    return this.out(d) as DemoSessionRow;
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    const d = this.sessions.get(sessionId);
    if (!d || this.isExpired(d.session)) return null;
    return this.out(d);
  }

  async getSessionByJoinCode(joinCode: string): Promise<SessionRow | null> {
    const code = joinCode.trim().toUpperCase();
    if (!code) return null;
    for (const d of this.sessions.values()) {
      if (d.session.join_code === code && !this.isExpired(d.session)) return this.out(d);
    }
    return null;
  }

  async listSessions(): Promise<SessionRow[]> {
    return [...this.sessions.values()].filter((d) => !this.isExpired(d.session)).map((d) => this.out(d));
  }

  async setStoryDay(sessionId: string, day: number, time?: string | null): Promise<SessionRow> {
    if (!Number.isInteger(day)) throw new StoreError("invalid", `story_day must be an integer, got ${day}`);
    const d = this.data(sessionId);
    this.demoOnly(d, "The story clock");
    d.session.story_day = day;
    if (time !== undefined) d.session.story_time = time;
    return this.out(d);
  }

  async setFilmingMode(sessionId: string, on: boolean): Promise<SessionRow> {
    const d = this.data(sessionId);
    this.demoOnly(d, "Filming mode");
    d.session.filming_mode = on;
    return this.out(d);
  }

  async resetSession(sessionId: string): Promise<SessionRow> {
    const d = this.data(sessionId);
    this.demoOnly(d, "A reset");
    const defaults = templateDefaults(d.session.template === "blank" ? "mr-tan" : d.session.template);
    d.session.story_day = defaults.story_day;
    d.session.story_time = defaults.story_time;
    Object.assign(d, buildSeedTables(sessionId, this.ts(), d.session.template === "blank" ? "mr-tan" : d.session.template));
    d.utterances = [];
    d.safety_events = [];
    d.profile_facts = [];
    d.prevent_done = [];
    d.watch_metrics = [];
    d.diet_checks = [];
    d.chat_messages = [];
    d.brief_snapshots = [];
    d.understanding = [];
    return this.out(d);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async deleteExpiredSandboxes(): Promise<number> {
    return this.pruneExpired();
  }

  // ------------------------------------------------------------ account scopes

  async createAccountScope(scope: NewAccountScope): Promise<SessionRow> {
    if (!isUserId(scope.user_id)) throw new StoreError("invalid", "an account scope's id is the user's uuid");
    if (!ISO_DATE.test(scope.d0 ?? "")) throw new StoreError("invalid", "an account scope needs d0 (YYYY-MM-DD)");
    if (this.sessions.has(scope.user_id)) throw new StoreError("conflict", "this account already has its space");
    const tz = scope.tz ?? DEFAULT_TZ;
    assertTimeZone(tz);
    const laidOut = laidOutTables(scope.user_id, scope.tables);
    const nowIso = this.ts();
    const session: StoredSession = {
      id: scope.user_id,
      join_code: null,
      template: scope.template ?? "blank",
      story_day: null,
      story_time: null,
      filming_mode: false,
      created_at: nowIso,
      expires_at: null,
      kind: "account",
      owner_user_id: scope.user_id,
      d0: scope.d0,
      tz,
      settings: clone(scope.settings ?? {}),
      onboarding: scope.onboarding ?? null,
      example_data: scope.example_data ?? false,
      tracking_since: scope.tracking_since === undefined ? nowIso : scope.tracking_since,
      clock_offset_ms: null,
      filming: false,
    };
    const d: SessionData = { session, ...emptyExtras(), ...laidOut };
    this.sessions.set(session.id, d);
    return this.out(d);
  }

  async listAccountScopes(): Promise<SessionRow[]> {
    return [...this.sessions.values()].filter((d) => d.session.kind === "account").map((d) => this.out(d));
  }

  async updateScope(scopeId: string, patch: ScopePatch): Promise<SessionRow> {
    const d = this.data(scopeId);
    this.accountOnly(d, "Scope settings");
    if (patch.tz !== undefined) {
      assertTimeZone(patch.tz);
      d.session.tz = patch.tz;
    }
    if (patch.settings !== undefined) d.session.settings = { ...d.session.settings, ...clone(patch.settings) };
    if (patch.onboarding !== undefined) d.session.onboarding = patch.onboarding;
    if (patch.example_data !== undefined) d.session.example_data = patch.example_data;
    if (patch.tracking_since !== undefined) d.session.tracking_since = patch.tracking_since;
    return this.out(d);
  }

  async setFilmingAccount(scopeId: string, on: boolean): Promise<SessionRow> {
    const d = this.data(scopeId);
    this.accountOnly(d, "A filming account");
    d.session.filming = on;
    if (!on) d.session.clock_offset_ms = null;
    return this.out(d);
  }

  async setClockOffset(scopeId: string, offsetMs: number | null): Promise<SessionRow> {
    const d = this.data(scopeId);
    this.accountOnly(d, "A clock offset");
    if (!d.session.filming) throw new StoreError("account_scope", "only a filming account has a clock offset");
    if (offsetMs !== null && !Number.isFinite(offsetMs)) throw new StoreError("invalid", "offset must be a number of ms");
    const offset = offsetMs === null ? null : Math.round(offsetMs);
    d.session.clock_offset_ms = offset;
    // the skipped time is not his: tracking starts again at the scope's new "now"
    d.session.tracking_since = new Date(this.now().getTime() + (offset ?? 0)).toISOString();
    return this.out(d);
  }

  async reseedAccount(scopeId: string, reseed: ReseedAccount): Promise<SessionRow> {
    const d = this.data(scopeId);
    this.accountOnly(d, "A reseed");
    if (reseed.d0 !== undefined && !ISO_DATE.test(reseed.d0)) throw new StoreError("invalid", "d0 must be YYYY-MM-DD");
    const laidOut = laidOutTables(scopeId, reseed.tables);
    if (reseed.template !== undefined) d.session.template = reseed.template;
    if (reseed.d0 !== undefined) d.session.d0 = reseed.d0;
    if (reseed.settings !== undefined) d.session.settings = clone(reseed.settings);
    if (reseed.onboarding !== undefined) d.session.onboarding = reseed.onboarding;
    if (reseed.example_data !== undefined) d.session.example_data = reseed.example_data;
    if (reseed.tracking_since !== undefined) d.session.tracking_since = reseed.tracking_since;
    // his records go; his family links and their switches stay (they are about people, not the timeline), so seed
    // rows never bring grants here (the SQL function drops them too)
    const grants = d.family_grants;
    // (C2 track C: the new rows bring their own utterances and profile facts, empty unless the builder gave them)
    Object.assign(d, laidOut, { family_grants: grants });
    d.safety_events = [];
    d.prevent_done = [];
    d.watch_metrics = [];
    d.diet_checks = [];
    d.chat_messages = [];
    d.brief_snapshots = [];
    d.deliveries = [];
    d.understanding = [];
    return this.out(d);
  }

  // ------------------------------------------------------------ members

  async addMember(sessionId: string, member: NewMember): Promise<SessionMemberRow> {
    const d = this.data(sessionId);
    this.demoOnly(d, "Joining a device");
    const row: SessionMemberRow = {
      id: member.id ?? newId("member"),
      session_id: sessionId,
      role: member.role,
      device_label: member.device_label ?? null,
      created_at: this.ts(),
    };
    d.members.push(row);
    return clone(row);
  }

  async listMembers(sessionId: string): Promise<SessionMemberRow[]> {
    return clone(this.data(sessionId).members);
  }

  // ------------------------------------------------------------ visits

  async listVisits(sessionId: string): Promise<VisitRow[]> {
    return clone([...this.data(sessionId).visits].sort((a, b) => a.day - b.day)).map((v) => withoutUnset("visit", v));
  }

  async getVisit(sessionId: string, visitId: string): Promise<VisitRow | null> {
    const v = this.data(sessionId).visits.find((x) => x.id === visitId);
    return v ? withoutUnset("visit", clone(v)) : null;
  }

  async upsertVisit(sessionId: string, visit: NewVisit): Promise<VisitRow> {
    const d = this.data(sessionId);
    const existing = visit.id ? d.visits.find((x) => x.id === visit.id) : undefined;
    if (existing) {
      Object.assign(existing, defined({ ...visit, id: existing.id }));
      return withoutUnset("visit", clone(existing));
    }
    const d0 = scopeD0(d.session);
    const row: VisitRow = {
      id: visit.id ?? newId("visit"),
      session_id: sessionId,
      kind: visit.kind,
      place: visit.place,
      day: visit.day,
      date: visit.date ?? storyDate(d0, visit.day),
      consent_utterance_id: visit.consent_utterance_id ?? null,
      status: visit.status ?? "recording",
      audio_path: visit.audio_path ?? null,
      script_section: visit.script_section ?? null,
      audio_fixture: visit.audio_fixture ?? null,
      created_at: this.tsIn(sessionId),
      ...defined({ retain_until: visit.retain_until, keep_forever: visit.keep_forever, audio_deleted_at: visit.audio_deleted_at }),
      // C2 track F (0016_f_visit_made): only once set
      ...defined({ ai_used: visit.ai_used }),
      // C2 track R (0017_r_visit_audio_parts): only once set
      ...defined({ audio_parts: visit.audio_parts }),
    };
    d.visits.push(row);
    return withoutUnset("visit", clone(row));
  }

  async updateVisit(sessionId: string, visitId: string, patch: Patch<VisitRow>): Promise<VisitRow> {
    const row = this.data(sessionId).visits.find((x) => x.id === visitId);
    if (!row) throw new StoreError("not_found", `No visit ${visitId}`);
    Object.assign(row, defined(patch));
    return withoutUnset("visit", clone(row));
  }

  // C2 track F, round three: a planned follow-up taken back; its lines and items go with it, as the database's
  // foreign keys do (utterance_visit_fk, visit_item_visit_fk: on delete cascade)
  async deleteVisit(sessionId: string, visitId: string): Promise<void> {
    const d = this.data(sessionId);
    const i = d.visits.findIndex((x) => x.id === visitId);
    if (i < 0) throw new StoreError("not_found", `No visit ${visitId}`);
    d.visits.splice(i, 1);
    d.utterances = d.utterances.filter((u) => u.visit_id !== visitId);
    d.visit_items = d.visit_items.filter((it) => it.visit_id !== visitId);
  }

  // ------------------------------------------------------------ utterances

  async addUtterances(sessionId: string, visitId: string, rows: NewUtterance[]): Promise<UtteranceRow[]> {
    const d = this.data(sessionId);
    if (!d.visits.some((v) => v.id === visitId)) throw new StoreError("not_found", `No visit ${visitId}`);
    const now = this.tsIn(sessionId);
    const added = rows.map<UtteranceRow>((u) => ({
      id: u.id ?? newId("utt"),
      session_id: sessionId,
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
      created_at: now,
    }));
    for (const row of added) {
      const i = d.utterances.findIndex((x) => x.id === row.id);
      if (i >= 0) d.utterances[i] = row;
      else d.utterances.push(row);
    }
    return clone(added);
  }

  async listUtterances(sessionId: string, visitId: string): Promise<UtteranceRow[]> {
    const rows = this.data(sessionId).utterances.filter((u) => u.visit_id === visitId);
    return clone(rows.sort((a, b) => a.t_start_ms - b.t_start_ms));
  }

  async updateUtterance(sessionId: string, utteranceId: string, patch: Patch<UtteranceRow>): Promise<UtteranceRow> {
    const row = this.data(sessionId).utterances.find((u) => u.id === utteranceId);
    if (!row) throw new StoreError("not_found", `No utterance ${utteranceId}`);
    Object.assign(row, defined(patch));
    return clone(row);
  }

  // ------------------------------------------------------------ visit items

  async addVisitItems(sessionId: string, visitId: string, items: NewVisitItem[]): Promise<VisitItemRow[]> {
    const d = this.data(sessionId);
    if (!d.visits.some((v) => v.id === visitId)) throw new StoreError("not_found", `No visit ${visitId}`);
    const now = this.tsIn(sessionId);
    const added = items.map<VisitItemRow>((it) => ({
      id: it.id ?? newId("item"),
      session_id: sessionId,
      visit_id: visitId,
      type: it.type,
      text: it.text,
      utterance_ids: it.utterance_ids ? [...it.utterance_ids] : [],
      slots: it.slots ? clone(it.slots) : {},
      confirmed_by: it.confirmed_by ?? null,
      required_line: it.required_line ?? null,
      speaker: it.speaker ?? null,
      created_at: now,
    }));
    for (const row of added) {
      const i = d.visit_items.findIndex((x) => x.id === row.id);
      if (i >= 0) d.visit_items[i] = row;
      else d.visit_items.push(row);
    }
    return clone(added);
  }

  async listVisitItems(sessionId: string, filter: VisitItemFilter = {}): Promise<VisitItemRow[]> {
    const rows = this.data(sessionId).visit_items.filter(
      (it) =>
        (filter.visit_id === undefined || it.visit_id === filter.visit_id) &&
        (filter.type === undefined || it.type === filter.type) &&
        (!filter.required_only || it.required_line !== null),
    );
    return clone(rows);
  }

  async updateVisitItem(sessionId: string, itemId: string, patch: Patch<VisitItemRow>): Promise<VisitItemRow> {
    const row = this.data(sessionId).visit_items.find((x) => x.id === itemId);
    if (!row) throw new StoreError("not_found", `No visit item ${itemId}`);
    Object.assign(row, defined(clone(patch)));
    return clone(row);
  }

  // ------------------------------------------------------------ medications

  async listMeds(sessionId: string): Promise<MedicationRow[]> {
    return clone(this.data(sessionId).medications).map((m) => withoutUnset("medication", m));
  }

  async getMed(sessionId: string, medId: string): Promise<MedicationRow | null> {
    const m = this.data(sessionId).medications.find((x) => x.id === medId);
    return m ? withoutUnset("medication", clone(m)) : null;
  }

  async upsertMed(sessionId: string, med: NewMedication): Promise<MedicationRow> {
    const d = this.data(sessionId);
    const existing = med.id ? d.medications.find((x) => x.id === med.id) : undefined;
    if (existing) {
      Object.assign(existing, defined(clone({ ...med, id: existing.id })));
      return withoutUnset("medication", clone(existing));
    }
    const row: MedicationRow = {
      id: med.id ?? newId("med"),
      session_id: sessionId,
      drug_id: med.drug_id ?? null,
      origin: med.origin,
      label: med.label ? clone(med.label) : null,
      status: med.status,
      start_day: med.start_day ?? null,
      prescribed_visit_id: med.prescribed_visit_id ?? null,
      note: med.note ?? null,
      pharmacist_answer: med.pharmacist_answer ? clone(med.pharmacist_answer) : null,
      created_at: this.tsIn(sessionId),
      ...defined({ dose_slots: med.dose_slots ? [...med.dose_slots] : med.dose_slots, dose_slots_source: med.dose_slots_source, start_at: med.start_at }),
    };
    d.medications.push(row);
    return withoutUnset("medication", clone(row));
  }

  async updateMed(sessionId: string, medId: string, patch: Patch<MedicationRow>): Promise<MedicationRow> {
    const row = this.data(sessionId).medications.find((x) => x.id === medId);
    if (!row) throw new StoreError("not_found", `No medication ${medId}`);
    Object.assign(row, defined(clone(patch)));
    return withoutUnset("medication", clone(row));
  }

  // C2 track F, round three: a prescription that waited for its label, taken back; its understanding answers go with
  // it, as the database's foreign key does (understanding_answer_medication_fk: on delete cascade)
  async deleteMed(sessionId: string, medId: string): Promise<void> {
    const d = this.data(sessionId);
    const i = d.medications.findIndex((x) => x.id === medId);
    if (i < 0) throw new StoreError("not_found", `No medication ${medId}`);
    d.medications.splice(i, 1);
    if (d.understanding) d.understanding = d.understanding.filter((a) => a.medication_id !== medId);
  }

  // ------------------------------------------------------------ doses

  async logDose(sessionId: string, dose: NewDoseLog): Promise<DoseLogRow> {
    const d = this.data(sessionId);
    const existing = d.dose_logs.find(
      (x) => x.medication_id === dose.medication_id && x.day === dose.day && x.slot === dose.slot,
    );
    if (existing) {
      existing.state = dose.state;
      existing.reason = dose.reason ?? null;
      existing.reason_text = dose.reason_text ?? null;
      // pre_tracking stays as it is, like id and created_at (C2 track B, 0018)
      return withoutUnset("dose_log", clone(existing));
    }
    const row: DoseLogRow = {
      id: dose.id ?? newId("dose"),
      session_id: sessionId,
      medication_id: dose.medication_id,
      day: dose.day,
      slot: dose.slot,
      state: dose.state,
      reason: dose.reason ?? null,
      reason_text: dose.reason_text ?? null,
      // C2 track B (0018): what the row is to a cell outside tracking; only an account's writers say it
      ...(typeof dose.pre_tracking === "boolean" ? { pre_tracking: dose.pre_tracking } : {}),
      created_at: dose.created_at ?? this.tsIn(sessionId), // track O: when he tapped (an answer sent late)
    };
    d.dose_logs.push(row);
    return withoutUnset("dose_log", clone(row));
  }

  async listDoses(sessionId: string, filter: DoseFilter = {}): Promise<DoseLogRow[]> {
    const rows = this.data(sessionId).dose_logs.filter(
      (x) =>
        (filter.medication_id === undefined || x.medication_id === filter.medication_id) && inRange(x.day, filter),
    );
    return clone(rows.sort(byDaySlot)).map((r) => withoutUnset("dose_log", r));
  }

  // C2 track B: undo removes his answer (the cell is free again)
  async deleteDose(sessionId: string, doseId: string): Promise<void> {
    const d = this.data(sessionId);
    const i = d.dose_logs.findIndex((x) => x.id === doseId);
    if (i < 0) throw new StoreError("not_found", `No dose ${doseId}`);
    d.dose_logs.splice(i, 1);
  }

  // ------------------------------------------------------------ blood pressure

  async addBp(sessionId: string, reading: NewBpReading): Promise<BpReadingRow> {
    const d = this.data(sessionId);
    const row: BpReadingRow = {
      id: reading.id ?? newId("bp"),
      session_id: sessionId,
      day: reading.day,
      slot: reading.slot,
      systolic: reading.systolic ?? null,
      diastolic: reading.diastolic ?? null,
      state: reading.state ?? "recorded",
      note: reading.note ?? null,
      created_at: reading.created_at ?? this.tsIn(sessionId), // track O: when he tapped (a reading sent late)
      // C2 track B (0011_b_daily): only once set
      ...defined({ pulse: reading.pulse }),
    };
    d.bp_readings.push(row);
    return withoutUnset("bp_reading", clone(row));
  }

  async listBp(sessionId: string, filter?: BpFilter): Promise<BpReadingRow[]> {
    // C2 track B (0016_b_bp_changes): a reading he deleted stays as a row and is left out unless asked for
    const rows = this.data(sessionId).bp_readings.filter((x) => inRange(x.day, filter) && (filter?.includeDeleted === true || !x.deleted_at));
    // Array.prototype.sort is stable, so insertion order is kept within a slot.
    return clone(rows.sort(byDaySlot)).map((r) => withoutUnset("bp_reading", r));
  }

  async updateBp(sessionId: string, readingId: string, patch: Patch<BpReadingRow>): Promise<BpReadingRow> {
    const row = this.data(sessionId).bp_readings.find((x) => x.id === readingId);
    if (!row) throw new StoreError("not_found", `No reading ${readingId}`);
    Object.assign(row, defined(patch));
    return withoutUnset("bp_reading", clone(row));
  }

  async deleteBp(sessionId: string, readingId: string): Promise<void> {
    const d = this.data(sessionId);
    const i = d.bp_readings.findIndex((x) => x.id === readingId);
    if (i < 0) throw new StoreError("not_found", `No reading ${readingId}`);
    d.bp_readings.splice(i, 1);
  }

  // ------------------------------------------------------------ notes

  async addNote(sessionId: string, note: NewNote): Promise<NoteRow> {
    const d = this.data(sessionId);
    const row: NoteRow = {
      id: note.id ?? newId("note"),
      session_id: sessionId,
      day: note.day,
      text: note.text,
      source: note.source,
      lang: note.lang ?? null,
      app_reply: note.app_reply ?? null,
      created_at: this.tsIn(sessionId),
    };
    d.notes.push(row);
    return clone(row);
  }

  async listNotes(sessionId: string, filter?: DayRange): Promise<NoteRow[]> {
    const rows = this.data(sessionId).notes.filter((x) => inRange(x.day, filter));
    return clone(rows.sort((a, b) => a.day - b.day));
  }

  // ------------------------------------------------------------ questions

  async listQuestions(sessionId: string, filter: QuestionFilter = {}): Promise<QuestionRow[]> {
    const rows = this.data(sessionId).questions.filter(
      (q) =>
        (filter.status === undefined || q.status === filter.status) &&
        (filter.for === undefined || q.for === filter.for) &&
        (filter.origin === undefined || q.origin === filter.origin),
    );
    return clone(rows).map((q) => withoutUnset("question", q));
  }

  async getQuestion(sessionId: string, questionId: string): Promise<QuestionRow | null> {
    const q = this.data(sessionId).questions.find((x) => x.id === questionId);
    return q ? withoutUnset("question", clone(q)) : null;
  }

  async addQuestion(sessionId: string, question: NewQuestion): Promise<QuestionRow> {
    const d = this.data(sessionId);
    if (question.id && d.questions.some((q) => q.id === question.id)) {
      throw new StoreError("invalid", `Question ${question.id} already exists`);
    }
    const row: QuestionRow = {
      id: question.id ?? newId("q"),
      session_id: sessionId,
      for: question.for,
      origin: question.origin,
      text: question.text,
      lang: question.lang ?? null,
      status: question.status ?? "open",
      answer_text: question.answer_text ?? null,
      answer_utterance_id: question.answer_utterance_id ?? null,
      answer_visit_id: question.answer_visit_id ?? null,
      answer_speaker: question.answer_speaker ?? null,
      asked_at_visit_id: question.asked_at_visit_id ?? null,
      created_day: question.created_day ?? this.view(d).story_day,
      evidence: question.evidence ?? null,
      created_at: this.tsIn(sessionId),
      ...defined({ asked_by_user_id: question.asked_by_user_id }),
    };
    d.questions.push(row);
    return withoutUnset("question", clone(row));
  }

  async updateQuestion(sessionId: string, questionId: string, patch: Patch<QuestionRow>): Promise<QuestionRow> {
    const row = this.data(sessionId).questions.find((q) => q.id === questionId);
    if (!row) throw new StoreError("not_found", `No question ${questionId}`);
    Object.assign(row, defined(patch));
    return withoutUnset("question", clone(row));
  }

  // ------------------------------------------------------------ family grants

  async getFamilyGrant(sessionId: string, member: string = DEFAULT_MEMBER): Promise<FamilyGrantRow | null> {
    const g = this.data(sessionId).family_grants.find((x) => x.member === member);
    return g ? grantOut(clone(g)) : null;
  }

  async setFamilyGrant(
    sessionId: string,
    member: string,
    items: Partial<FamilyGrantItems>,
  ): Promise<FamilyGrantRow> {
    const d = this.data(sessionId);
    const now = this.ts();
    let g = d.family_grants.find((x) => x.member === member);
    if (!g) {
      g = { session_id: sessionId, member, items: { ...NO_GRANTS }, created_at: now, updated_at: now };
      d.family_grants.push(g);
    }
    const before = JSON.stringify(g.items);
    g.items = { ...g.items, ...defined(items) };
    g.updated_at = now;
    // an account's grant belongs to a care link: each change is a new version with its history row
    if (g.link_id && JSON.stringify(g.items) !== before) {
      g.version = (g.version ?? 1) + 1;
      this.grantHistory.push({ link_id: g.link_id, session_id: sessionId, version: g.version, items: clone(g.items), created_at: now });
    }
    return grantOut(clone(g));
  }

  // ------------------------------------------------------------ reminder clips

  async addReminderClip(sessionId: string, clip: NewReminderClip): Promise<ReminderClipRow> {
    const d = this.data(sessionId);
    const row: ReminderClipRow = {
      id: clip.id ?? newId("clip"),
      session_id: sessionId,
      by: clip.by,
      audio_path: clip.audio_path ?? null,
      plays_at: clip.plays_at,
      text: clip.text ?? null,
      lang: clip.lang ?? null,
      created_at: this.tsIn(sessionId),
      ...defined({ by_user_id: clip.by_user_id, by_label: clip.by_label, link_id: clip.link_id }),
    };
    d.reminder_clips.push(row);
    return withoutUnset("reminder_clip", clone(row));
  }

  async listReminderClips(sessionId: string): Promise<ReminderClipRow[]> {
    return clone(this.data(sessionId).reminder_clips).map((c) => withoutUnset("reminder_clip", c));
  }

  async deleteReminderClip(sessionId: string, clipId: string): Promise<void> {
    const d = this.data(sessionId);
    const i = d.reminder_clips.findIndex((x) => x.id === clipId);
    if (i < 0) throw new StoreError("not_found", `No reminder clip ${clipId}`);
    d.reminder_clips.splice(i, 1);
  }

  // ------------------------------------------------------------ safety events

  async addSafetyEvent(sessionId: string, event: NewSafetyEvent): Promise<SafetyEventRow> {
    const d = this.data(sessionId);
    const row: SafetyEventRow = {
      id: event.id ?? newId("safety"),
      session_id: sessionId,
      input: event.input,
      lang: event.lang ?? null,
      route: event.route,
      candidates: clone(event.candidates ?? null),
      layer1: clone(event.layer1 ?? null),
      layer2: clone(event.layer2 ?? null),
      layer3: clone(event.layer3 ?? null),
      output: clone(event.output ?? null),
      blocked: clone(event.blocked ?? null),
      latency_ms: event.latency_ms ?? null,
      created_at: this.tsIn(sessionId),
    };
    d.safety_events.push(row);
    return clone(row);
  }

  async listSafetyEvents(sessionId: string, opts: { limit?: number } = {}): Promise<SafetyEventRow[]> {
    const rows = this.data(sessionId).safety_events;
    if (opts.limit === undefined) return clone(rows);
    return opts.limit > 0 ? clone(rows.slice(-opts.limit)) : [];
  }

  // ------------------------------------------------------------ eval runs

  async addEvalRun(run: NewEvalRun): Promise<EvalRunRow> {
    const row: EvalRunRow = {
      id: run.id ?? newId("eval"),
      git_sha: run.git_sha ?? null,
      results: clone(run.results),
      created_at: this.ts(),
    };
    this.evalRuns.push(row);
    return clone(row);
  }

  async getLatestEvalRun(): Promise<EvalRunRow | null> {
    const last = this.evalRuns.at(-1);
    return last ? clone(last) : null;
  }

  // ------------------------------------------------------------ accounts

  async createAccount(account: NewAccount): Promise<AccountRow> {
    if (!isUserId(account.user_id)) throw new StoreError("invalid", "an account's id is the user's uuid");
    if (this.accounts.has(account.user_id)) throw new StoreError("invalid", "this account already exists");
    const username = account.username ?? null;
    if (username && [...this.accounts.values()].some((a) => a.username === username)) throw new StoreError("conflict", "that username is taken");
    const now = this.ts();
    const row: AccountRow = {
      user_id: account.user_id,
      login_kind: account.login_kind,
      username,
      display_name: account.display_name ?? null,
      locale: account.locale ?? null,
      last_seen_at: null,
      created_at: now,
      updated_at: now,
    };
    this.accounts.set(row.user_id, row);
    return clone(row);
  }

  async getAccount(userId: string): Promise<AccountRow | null> {
    const a = this.accounts.get(userId);
    return a ? clone(a) : null;
  }

  async getAccountByUsername(username: string): Promise<AccountRow | null> {
    const u = username.trim().toLowerCase();
    if (!u) return null;
    const a = [...this.accounts.values()].find((x) => x.username === u);
    return a ? clone(a) : null;
  }

  async updateAccount(userId: string, patch: AccountPatch): Promise<AccountRow> {
    const a = this.accounts.get(userId);
    if (!a) throw new StoreError("not_found", "No such account");
    if (patch.username && [...this.accounts.values()].some((x) => x.user_id !== userId && x.username === patch.username)) {
      throw new StoreError("conflict", "that username is taken");
    }
    Object.assign(a, defined(patch), { updated_at: this.ts() });
    return clone(a);
  }

  async deleteAccount(userId: string): Promise<void> {
    // links where he is the patient go with him; links where she is the family member go with her
    const gone = new Set(this.careLinks.filter((l) => l.patient_id === userId || l.family_id === userId).map((l) => l.id));
    this.careLinks = this.careLinks.filter((l) => !gone.has(l.id));
    this.grantHistory = this.grantHistory.filter((h) => !gone.has(h.link_id) && h.session_id !== userId);
    for (const d of this.sessions.values()) {
      d.family_grants = d.family_grants.filter((g) => !(g.link_id && gone.has(g.link_id)));
      for (const c of d.reminder_clips) {
        if (c.by_user_id === userId) c.by_user_id = null;
        if (c.link_id && gone.has(c.link_id)) c.link_id = null;
      }
      // C2 track H (only add): the other two columns that can hold her id in his space are cleared the same way
      // (profile_fact.entered_by_user_id is ON DELETE SET NULL in the schema; question.asked_by_user_id has no key)
      for (const f of d.profile_facts) if (f.entered_by_user_id === userId) f.entered_by_user_id = null;
      for (const q of d.questions) if (q.asked_by_user_id === userId) q.asked_by_user_id = null;
      for (const e of d.access_log) {
        if (e.family_user_id === userId) e.family_user_id = null;
        if (e.link_id && gone.has(e.link_id)) e.link_id = null;
      }
    }
    this.sessions.delete(userId);
    this.accounts.delete(userId);
    this.recovery.delete(userId);
    this.devices = this.devices.filter((x) => x.user_id !== userId);
    this.resetRequests = this.resetRequests.filter((x) => x.user_id !== userId);
    this.accountEvents = this.accountEvents.filter((x) => x.user_id !== userId);
    this.consentRecords = this.consentRecords.filter((x) => x.user_id !== userId);
    this.pushSubs = this.pushSubs.filter((x) => x.user_id !== userId);
  }

  async setRecoveryCode(userId: string, codeHash: string): Promise<RecoveryCodeRow> {
    if (!this.accounts.has(userId)) throw new StoreError("not_found", "No such account");
    const row: RecoveryCodeRow = { user_id: userId, code_hash: codeHash, created_at: this.ts() };
    this.recovery.set(userId, row);
    return clone(row);
  }

  async getRecoveryCode(userId: string): Promise<RecoveryCodeRow | null> {
    const r = this.recovery.get(userId);
    return r ? clone(r) : null;
  }

  async touchKnownDevice(userId: string, deviceHash: string, label?: string | null): Promise<KnownDeviceRow> {
    if (!this.accounts.has(userId)) throw new StoreError("not_found", "No such account");
    const now = this.ts();
    let row = this.devices.find((x) => x.user_id === userId && x.device_hash === deviceHash);
    if (!row) {
      row = { user_id: userId, device_hash: deviceHash, label: label ?? null, first_seen_at: now, last_seen_at: now };
      this.devices.push(row);
    } else {
      row.last_seen_at = now;
      if (label !== undefined) row.label = label;
    }
    return clone(row);
  }

  async listKnownDevices(userId: string): Promise<KnownDeviceRow[]> {
    return clone(this.devices.filter((x) => x.user_id === userId));
  }

  async createResetRequest(request: NewResetRequest): Promise<ResetRequestRow> {
    if (!this.accounts.has(request.user_id)) throw new StoreError("not_found", "No such account");
    const row: ResetRequestRow = {
      id: request.id ?? randomUUID(),
      user_id: request.user_id,
      device_hash: request.device_hash,
      link_id: request.link_id ?? null,
      code_hash: request.code_hash ?? null,
      expires_at: request.expires_at,
      used_at: null,
      created_at: this.ts(),
    };
    this.resetRequests.push(row);
    return clone(row);
  }

  async getResetRequest(id: string): Promise<ResetRequestRow | null> {
    const r = this.resetRequests.find((x) => x.id === id);
    return r ? clone(r) : null;
  }

  async useResetRequest(id: string): Promise<ResetRequestRow | null> {
    const r = this.resetRequests.find((x) => x.id === id);
    if (!r || r.used_at) return null;
    r.used_at = this.ts();
    return clone(r);
  }

  async addAccountEvent(userId: string, kind: string, detail: Record<string, unknown> = {}): Promise<AccountEventRow> {
    if (!this.accounts.has(userId)) throw new StoreError("not_found", "No such account");
    const row: AccountEventRow = { id: newId("evt"), user_id: userId, kind, detail: clone(detail), created_at: this.ts() };
    this.accountEvents.push(row);
    return clone(row);
  }

  async listAccountEvents(userId: string): Promise<AccountEventRow[]> {
    return clone(this.accountEvents.filter((x) => x.user_id === userId));
  }

  // ------------------------------------------------------------ family links

  private link(id: string): CareLinkRow | undefined {
    return this.careLinks.find((l) => l.id === id);
  }

  async createInvite(invite: NewCareInvite, items: Partial<FamilyGrantItems> = {}): Promise<CareLinkResult> {
    const d = this.data(invite.patient_id); // his own space must exist
    this.accountOnly(d, "A family invitation");
    if (invite.invite_token_hash && this.careLinks.some((l) => l.invite_token_hash === invite.invite_token_hash)) {
      throw new StoreError("conflict", "that invitation token is already in use");
    }
    const now = this.ts();
    const link: CareLinkRow = {
      id: invite.id ?? randomUUID(),
      patient_id: invite.patient_id,
      family_id: null,
      relation: invite.relation ?? null,
      family_label: invite.family_label ?? null,
      patient_label: invite.patient_label ?? null,
      status: "invited",
      invite_token_hash: invite.invite_token_hash,
      invite_expires_at: invite.invite_expires_at,
      accepted_at: null,
      confirmed_at: null,
      revoked_at: null,
      revoked_by: null,
      reset_helper: false,
      created_at: now,
      updated_at: now,
    };
    this.careLinks.push(link);
    const grant: FamilyGrantRow = {
      session_id: d.session.id,
      member: link.id,
      items: { ...NO_GRANTS, ...defined(items) },
      created_at: now,
      updated_at: now,
      link_id: link.id,
      version: 1,
    };
    d.family_grants.push(grant);
    this.grantHistory.push({ link_id: link.id, session_id: d.session.id, version: 1, items: clone(grant.items), created_at: now });
    return { ok: true, link: clone(link) };
  }

  async acceptInvite(tokenHash: string, familyUserId: string, familyLabel?: string | null): Promise<CareLinkResult> {
    const l = this.careLinks.find((x) => x.invite_token_hash === tokenHash && tokenHash !== "");
    if (!l) return { ok: false, code: "invite_not_found" };
    if (l.status !== "invited") return { ok: false, code: "invite_used" };
    const now = this.now();
    if (l.invite_expires_at && Date.parse(l.invite_expires_at) <= now.getTime()) {
      l.status = "expired";
      l.updated_at = now.toISOString();
      return { ok: false, code: "invite_expired" };
    }
    if (l.patient_id === familyUserId) return { ok: false, code: "invite_self" };
    if (this.careLinks.some((x) => x.patient_id === l.patient_id && x.family_id === familyUserId && (x.status === "accepted" || x.status === "active"))) {
      return { ok: false, code: "link_exists" };
    }
    l.family_id = familyUserId;
    if (familyLabel) l.family_label = familyLabel;
    l.status = "accepted";
    l.accepted_at = now.toISOString();
    l.updated_at = now.toISOString();
    return { ok: true, link: clone(l) };
  }

  async confirmLink(linkId: string, patientUserId: string, yes: boolean): Promise<CareLinkResult> {
    const l = this.link(linkId);
    if (!l || l.patient_id !== patientUserId) return { ok: false, code: "link_not_found" };
    if (l.status !== "accepted") return { ok: false, code: "link_not_accepted" };
    const now = this.ts();
    l.status = yes ? "active" : "declined";
    if (yes) l.confirmed_at = now;
    l.invite_token_hash = null;
    l.updated_at = now;
    return { ok: true, link: clone(l) };
  }

  async revokeLink(linkId: string, actorUserId: string, by: "patient" | "family"): Promise<CareLinkResult> {
    const l = this.link(linkId);
    if (!l || (by === "patient" ? l.patient_id !== actorUserId : l.family_id !== actorUserId)) return { ok: false, code: "link_not_found" };
    if (l.status === "revoked" || l.status === "declined" || l.status === "expired") return { ok: false, code: "link_closed" };
    const now = this.ts();
    l.status = "revoked";
    l.revoked_at = now;
    l.revoked_by = by;
    l.invite_token_hash = null;
    l.updated_at = now;
    return { ok: true, link: clone(l) };
  }

  async getCareLink(linkId: string): Promise<CareLinkRow | null> {
    const l = this.link(linkId);
    return l ? clone(l) : null;
  }

  async listCareLinks(filter: CareLinkFilter): Promise<CareLinkRow[]> {
    return clone(
      this.careLinks.filter(
        (l) =>
          (filter.patient_id === undefined || l.patient_id === filter.patient_id) &&
          (filter.family_id === undefined || l.family_id === filter.family_id) &&
          (filter.status === undefined || filter.status.includes(l.status)),
      ),
    );
  }

  async expireInvites(): Promise<number> {
    const now = this.now();
    let n = 0;
    for (const l of this.careLinks) {
      if (l.status === "invited" && l.invite_expires_at && Date.parse(l.invite_expires_at) <= now.getTime()) {
        l.status = "expired";
        l.updated_at = now.toISOString();
        n++;
      }
    }
    return n;
  }

  async listGrantHistory(linkId: string): Promise<GrantHistoryRow[]> {
    return clone(this.grantHistory.filter((h) => h.link_id === linkId).sort((a, b) => a.version - b.version));
  }

  async addCareAccessLog(sessionId: string, entry: NewCareAccessLog): Promise<CareAccessLogRow> {
    const d = this.data(sessionId);
    const row: CareAccessLogRow = {
      id: entry.id ?? newId("access"),
      session_id: sessionId,
      link_id: entry.link_id ?? null,
      family_user_id: entry.family_user_id ?? null,
      family_label: entry.family_label ?? null,
      route: entry.route,
      items: [...(entry.items ?? [])],
      created_at: this.tsIn(sessionId),
    };
    d.access_log.push(row);
    return clone(row);
  }

  async listCareAccessLog(sessionId: string, opts: { limit?: number } = {}): Promise<CareAccessLogRow[]> {
    return clone(newest(this.data(sessionId).access_log, opts.limit));
  }

  async addServiceReadLog(entry: NewServiceReadLog): Promise<ServiceReadLogRow> {
    if (!entry.reason?.trim()) throw new StoreError("invalid", "a service read needs a reason");
    const row: ServiceReadLogRow = {
      id: newId("read"),
      actor: entry.actor,
      reason: entry.reason,
      session_id: entry.session_id ?? null,
      tables: [...(entry.tables ?? [])],
      created_at: this.ts(),
    };
    this.serviceReads.push(row);
    return clone(row);
  }

  async listServiceReadLog(opts: { session_id?: string } = {}): Promise<ServiceReadLogRow[]> {
    return clone(this.serviceReads.filter((r) => opts.session_id === undefined || r.session_id === opts.session_id));
  }

  // ------------------------------------------------------------ consent

  async putConsentText(text: NewConsentText): Promise<ConsentTextRow> {
    const existing = this.consentTexts.find((x) => x.kind === text.kind && x.version === text.version && x.locale === text.locale);
    if (existing) {
      if (existing.sha256 !== text.sha256 || existing.text !== text.text) throw new StoreError("invalid", "a published consent text never changes; add a version");
      return clone(existing);
    }
    const row: ConsentTextRow = { ...text, published_at: text.published_at ?? this.ts() };
    this.consentTexts.push(row);
    return clone(row);
  }

  async getConsentText(kind: ConsentKind, version: string, locale: string): Promise<ConsentTextRow | null> {
    const t = this.consentTexts.find((x) => x.kind === kind && x.version === version && x.locale === locale);
    return t ? clone(t) : null;
  }

  async addConsentRecord(record: NewConsentRecord): Promise<ConsentRecordRow> {
    if (!CONSENT_DECISIONS.has(record.decision)) throw new StoreError("invalid", `Unknown consent decision ${record.decision}`);
    const row: ConsentRecordRow = {
      id: record.id ?? newId("consent"),
      user_id: record.user_id,
      scope_id: record.scope_id ?? null,
      kind: record.kind,
      decision: record.decision,
      version: record.version ?? null,
      text_sha256: record.text_sha256 ?? null,
      method: record.method ?? null,
      evidence: clone(record.evidence ?? null),
      assisted: record.assisted ?? false,
      created_at: this.ts(),
    };
    this.consentRecords.push(row);
    return clone(row);
  }

  async listConsentRecords(userId: string, filter: { kind?: ConsentKind } = {}): Promise<ConsentRecordRow[]> {
    return clone(this.consentRecords.filter((r) => r.user_id === userId && (filter.kind === undefined || r.kind === filter.kind)));
  }

  // ------------------------------------------------------------ web push and deliveries

  async savePushSubscription(sub: NewPushSubscription): Promise<PushSubscriptionRow> {
    const existing = this.pushSubs.find((x) => x.endpoint === sub.endpoint);
    if (existing) {
      // C2 track D: the device follows the newest subscribe that names one (a re-subscribe without it keeps what was there)
      Object.assign(existing, { user_id: sub.user_id, p256dh: sub.p256dh, auth: sub.auth, user_agent: sub.user_agent ?? existing.user_agent, device_hash: sub.device_hash ?? existing.device_hash ?? null });
      return clone(existing);
    }
    const row: PushSubscriptionRow = {
      id: newId("push"),
      user_id: sub.user_id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: sub.user_agent ?? null,
      created_at: this.ts(),
      last_used_at: null,
      device_hash: sub.device_hash ?? null,
    };
    this.pushSubs.push(row);
    return clone(row);
  }

  async listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    return clone(this.pushSubs.filter((x) => x.user_id === userId));
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    this.pushSubs = this.pushSubs.filter((x) => x.endpoint !== endpoint);
  }

  async recordDelivery(sessionId: string, key: DeliveryKey): Promise<{ created: boolean; delivery: ReminderDeliveryRow }> {
    const d = this.data(sessionId);
    const existing = d.deliveries.find((x) => x.kind === key.kind && x.ref === key.ref && x.day === key.day && x.slot === key.slot);
    if (existing) return { created: false, delivery: clone(existing) };
    const now = this.tsIn(sessionId);
    const row: ReminderDeliveryRow = { id: newId("delivery"), session_id: sessionId, ...key, sent_at: now, opened_at: null, created_at: now };
    d.deliveries.push(row);
    return { created: true, delivery: clone(row) };
  }

  async markDeliveryOpened(sessionId: string, deliveryId: string): Promise<ReminderDeliveryRow> {
    const row = this.data(sessionId).deliveries.find((x) => x.id === deliveryId);
    if (!row) throw new StoreError("not_found", `No delivery ${deliveryId}`);
    row.opened_at ??= this.tsIn(sessionId);
    return clone(row);
  }

  async listDeliveries(sessionId: string, filter?: DayRange): Promise<ReminderDeliveryRow[]> {
    return clone(this.data(sessionId).deliveries.filter((x) => inRange(x.day, filter)));
  }

  // ------------------------------------------------------------ rate limits and the scheduled jobs

  async rateHit(bucket: string, windowS: number, limit: number): Promise<RateHit> {
    const now = this.now();
    const t = now.getTime();
    let r = this.rateLimits.get(bucket);
    if (!r || r.window_start + r.window_s * 1000 <= t) {
      r = { window_start: t, window_s: windowS, count: 1, updated_at: now.toISOString() };
    } else {
      r = { ...r, count: r.count + 1, updated_at: now.toISOString() };
    }
    this.rateLimits.set(bucket, r);
    return { count: r.count, allowed: r.count <= limit, reset_at: new Date(r.window_start + r.window_s * 1000).toISOString() };
  }

  async pruneRateLimits(beforeIso: string): Promise<number> {
    const before = Date.parse(beforeIso);
    let n = 0;
    for (const [k, r] of this.rateLimits) {
      if (Date.parse(r.updated_at) < before) {
        this.rateLimits.delete(k);
        n++;
      }
    }
    return n;
  }

  async acquireJobLease(name: string, holder: string, ttlS: number): Promise<boolean> {
    const now = this.now();
    const t = now.getTime();
    const cur = this.jobLeases.get(name);
    if (cur && cur.holder !== holder && cur.expires_at > t) return false;
    this.jobLeases.set(name, { holder, expires_at: t + ttlS * 1000, acquired_at: cur && cur.holder === holder ? cur.acquired_at : now.toISOString() });
    return true;
  }

  async releaseJobLease(name: string, holder: string): Promise<void> {
    if (this.jobLeases.get(name)?.holder === holder) this.jobLeases.delete(name);
  }

  async addOpsRun(run: NewOpsRun): Promise<OpsRunRow> {
    const row: OpsRunRow = {
      id: run.id ?? newId("run"),
      job: run.job,
      counts: { ...run.counts },
      started_at: run.started_at,
      finished_at: run.finished_at ?? null,
      created_at: this.ts(),
    };
    this.opsRuns.push(row);
    return clone(row);
  }

  async listOpsRuns(job?: string): Promise<OpsRunRow[]> {
    return clone(this.opsRuns.filter((r) => job === undefined || r.job === job));
  }

  // ------------------------------------------------------------ profile facts

  async listProfileFacts(sessionId: string, filter: ProfileFactFilter = {}): Promise<ProfileFactRow[]> {
    return clone(
      this.data(sessionId).profile_facts.filter(
        (f) =>
          (filter.hidden === undefined || (f.hidden === true) === filter.hidden) &&
          (filter.source === undefined || f.source === filter.source) &&
          (filter.confirmed === undefined || (f.confirmed_by !== null) === filter.confirmed),
      ),
    );
  }

  async addProfileFact(sessionId: string, fact: NewProfileFact): Promise<ProfileFactRow> {
    const d = this.data(sessionId);
    if (fact.id && d.profile_facts.some((f) => f.id === fact.id)) throw new StoreError("invalid", `Fact ${fact.id} already exists`);
    const row: ProfileFactRow = {
      id: fact.id ?? newId("fact"),
      session_id: sessionId,
      kind: fact.kind,
      text: fact.text,
      source: fact.source,
      entered_by: fact.entered_by ?? null,
      confirmed_by: fact.confirmed_by ?? null,
      visit_item_id: fact.visit_item_id ?? null,
      created_day: fact.created_day ?? this.view(d).story_day,
      data: clone(fact.data ?? null),
      hidden: fact.hidden ?? null,
      entered_by_user_id: fact.entered_by_user_id ?? null,
      link_id: fact.link_id ?? null,
      confirmed_at: fact.confirmed_at ?? null,
      updated_at: fact.updated_at ?? null,
      created_at: this.tsIn(sessionId),
    };
    d.profile_facts.push(row);
    return clone(row);
  }

  async updateProfileFact(sessionId: string, factId: string, patch: Patch<ProfileFactRow>): Promise<ProfileFactRow> {
    const row = this.data(sessionId).profile_facts.find((f) => f.id === factId);
    if (!row) throw new StoreError("not_found", `No fact ${factId}`);
    Object.assign(row, defined(clone(patch)), { updated_at: this.tsIn(sessionId) });
    return clone(row);
  }

  // ------------------------------------------------------------ prevention

  async listPreventDone(sessionId: string): Promise<PreventDoneRow[]> {
    return clone(this.data(sessionId).prevent_done);
  }

  async addPreventDone(sessionId: string, row: NewPreventDone): Promise<PreventDoneRow> {
    const d = this.data(sessionId);
    const out: PreventDoneRow = {
      id: row.id ?? newId("prevent"),
      session_id: sessionId,
      item_id: row.item_id,
      day: row.day,
      source: row.source ?? null,
      visit_item_id: row.visit_item_id ?? null,
      note: row.note ?? null,
      created_at: this.tsIn(sessionId),
    };
    d.prevent_done.push(out);
    return clone(out);
  }

  async deletePreventDone(sessionId: string, id: string): Promise<void> {
    const d = this.data(sessionId);
    const i = d.prevent_done.findIndex((x) => x.id === id);
    if (i < 0) throw new StoreError("not_found", `No prevention record ${id}`);
    d.prevent_done.splice(i, 1);
  }

  // ------------------------------------------------------------ watch

  async addWatchMetrics(sessionId: string, rows: NewWatchMetric[]): Promise<WatchMetricRow[]> {
    const d = this.data(sessionId);
    const now = this.tsIn(sessionId);
    const added = rows.map<WatchMetricRow>((r) => ({
      id: r.id ?? newId("watch"),
      session_id: sessionId,
      day: r.day,
      metric: r.metric,
      value: r.value ?? null,
      unit: r.unit ?? null,
      measured_at: r.measured_at ?? null,
      source: r.source ?? null,
      created_at: now,
    }));
    d.watch_metrics.push(...added);
    return clone(added);
  }

  async listWatchMetrics(sessionId: string, filter: WatchFilter = {}): Promise<WatchMetricRow[]> {
    const rows = this.data(sessionId).watch_metrics.filter((r) => inRange(r.day, filter) && (filter.metric === undefined || r.metric === filter.metric));
    return clone(rows.sort((a, b) => a.day - b.day));
  }

  // ------------------------------------------------------------ diet

  async setDietCheck(sessionId: string, row: NewDietCheck): Promise<DietCheckRow> {
    const d = this.data(sessionId);
    const existing = d.diet_checks.find((x) => x.day === row.day && x.item === row.item);
    if (existing) {
      existing.answer = row.answer;
      existing.source_ref = row.source_ref ?? null;
      existing.note = row.note ?? null;
      return clone(existing);
    }
    const out: DietCheckRow = {
      id: row.id ?? newId("diet"),
      session_id: sessionId,
      day: row.day,
      item: row.item,
      answer: row.answer,
      source_ref: row.source_ref ?? null,
      note: row.note ?? null,
      created_at: this.tsIn(sessionId),
    };
    d.diet_checks.push(out);
    return clone(out);
  }

  async listDietChecks(sessionId: string, filter?: DayRange): Promise<DietCheckRow[]> {
    return clone(this.data(sessionId).diet_checks.filter((x) => inRange(x.day, filter)).sort((a, b) => a.day - b.day));
  }

  // ------------------------------------------------------------ chat

  async addChatMessage(sessionId: string, message: NewChatMessage): Promise<ChatMessageRow> {
    const d = this.data(sessionId);
    const row: ChatMessageRow = {
      id: message.id ?? newId("chat"),
      session_id: sessionId,
      day: message.day,
      role: message.role,
      text: message.text,
      lang: message.lang ?? null,
      safety_event_id: message.safety_event_id ?? null,
      answer: clone(message.answer ?? null),
      created_at: this.tsIn(sessionId),
    };
    d.chat_messages.push(row);
    return clone(row);
  }

  async listChatMessages(sessionId: string, filter: ChatFilter = {}): Promise<ChatMessageRow[]> {
    const rows = this.data(sessionId).chat_messages.filter((m) => inRange(m.day, filter));
    return clone(newest(rows, filter.limit));
  }

  // ------------------------------------------------------------ brief snapshots

  async addBriefSnapshot(sessionId: string, snapshot: NewBriefSnapshot): Promise<BriefSnapshotRow> {
    const d = this.data(sessionId);
    const row: BriefSnapshotRow = {
      id: snapshot.id ?? newId("brief"),
      session_id: sessionId,
      locale: snapshot.locale ?? null,
      data: clone(snapshot.data),
      shown_at: snapshot.shown_at ?? null,
      created_at: this.tsIn(sessionId),
    };
    d.brief_snapshots.push(row);
    return clone(row);
  }

  async getBriefSnapshot(sessionId: string, id: string): Promise<BriefSnapshotRow | null> {
    const b = this.data(sessionId).brief_snapshots.find((x) => x.id === id);
    return b ? clone(b) : null;
  }

  async listBriefSnapshots(sessionId: string, opts: { limit?: number } = {}): Promise<BriefSnapshotRow[]> {
    return clone(newest(this.data(sessionId).brief_snapshots, opts.limit));
  }

  async markBriefShown(sessionId: string, id: string): Promise<BriefSnapshotRow> {
    const b = this.data(sessionId).brief_snapshots.find((x) => x.id === id);
    if (!b) throw new StoreError("not_found", `No brief ${id}`);
    b.shown_at = this.tsIn(sessionId);
    return clone(b);
  }

  // ------------------------------------------------------------ C2 track A: sign-in protection

  async getRateWindow(bucket: string): Promise<RateWindow | null> {
    const r = this.rateLimits.get(bucket);
    if (!r) return null;
    const end = r.window_start + r.window_s * 1000;
    if (end <= this.now().getTime()) return null;
    return { count: r.count, reset_at: new Date(end).toISOString() };
  }

  async clearRate(bucket: string): Promise<void> {
    this.rateLimits.delete(bucket);
  }

  // ------------------------------------------------------------ C2 track L: an allowance that is a sum

  async rateAdd(bucket: string, windowS: number, limit: number, amount: number): Promise<RateHit> {
    const now = this.now();
    const t = now.getTime();
    const add = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
    let r = this.rateLimits.get(bucket);
    if (!r || r.window_start + r.window_s * 1000 <= t) {
      r = { window_start: t, window_s: windowS, count: add, updated_at: now.toISOString() };
    } else {
      r = { ...r, count: r.count + add, updated_at: now.toISOString() };
    }
    this.rateLimits.set(bucket, r);
    return { count: r.count, allowed: r.count <= limit, reset_at: new Date(r.window_start + r.window_s * 1000).toISOString() };
  }

  // ------------------------------------------------------------ C2 track A: family-assisted reset

  async setLinkResetHelper(linkId: string, patientUserId: string, on: boolean): Promise<CareLinkResult> {
    const l = this.link(linkId);
    if (!l || l.patient_id !== patientUserId) return { ok: false, code: "link_not_found" };
    if (l.status !== "active") return { ok: false, code: "link_closed" };
    l.reset_helper = on;
    l.updated_at = this.ts();
    return { ok: true, link: clone(l) };
  }

  async listResetRequests(userId: string): Promise<ResetRequestRow[]> {
    return clone(this.resetRequests.filter((x) => x.user_id === userId));
  }

  async setResetRequestCode(id: string, linkId: string, codeHash: string): Promise<ResetRequestRow | null> {
    const r = this.resetRequests.find((x) => x.id === id);
    if (!r || r.used_at) return null;
    r.link_id = linkId;
    r.code_hash = codeHash;
    return clone(r);
  }

  // ------------------------------------------------------------ translations (C2 track S)

  async getTranslation(sessionId: string, direction: TranslationDirection, sourceSha256: string): Promise<TranslationRow | null> {
    const t = (this.data(sessionId).translations ?? []).find((x) => x.direction === direction && x.source_sha256 === sourceSha256);
    return t ? clone(t) : null;
  }

  async putTranslation(sessionId: string, row: NewTranslation): Promise<TranslationRow> {
    const d = this.data(sessionId);
    const list = (d.translations ??= []);
    const have = list.find((x) => x.direction === row.direction && x.source_sha256 === row.source_sha256);
    if (have) return clone(have);
    if (row.status !== "checked" && row.status !== "rejected") throw new StoreError("invalid", `Unknown translation status ${String(row.status)}`);
    if (row.status === "checked" && !row.text) throw new StoreError("invalid", "A checked translation needs its text");
    const out: TranslationRow = {
      id: row.id ?? newId("tr"),
      session_id: sessionId,
      direction: row.direction,
      source_sha256: row.source_sha256,
      source_text: row.source_text,
      text: row.text ?? null,
      status: row.status,
      checks: clone(row.checks ?? {}),
      created_at: this.tsIn(sessionId),
    };
    list.push(out);
    return clone(out);
  }

  async listTranslations(sessionId: string): Promise<TranslationRow[]> {
    return clone(this.data(sessionId).translations ?? []);
  }

  // ------------------------------------------------------------ the understanding checklist (C2 track F)

  async setUnderstandingAnswer(sessionId: string, row: NewUnderstandingAnswer): Promise<UnderstandingAnswerRow> {
    const d = this.data(sessionId);
    if (!d.medications.some((m) => m.id === row.medication_id)) throw new StoreError("not_found", `No medicine ${row.medication_id}`);
    if (!UNDERSTANDING_ITEMS.has(row.item)) throw new StoreError("invalid", `Unknown checklist item ${String(row.item)}`);
    if (row.answer !== "know" && row.answer !== "unsure") throw new StoreError("invalid", `Unknown answer ${String(row.answer)}`);
    const list = (d.understanding ??= []);
    const now = this.tsIn(sessionId);
    const have = list.find((x) => x.medication_id === row.medication_id && x.item === row.item);
    if (have) {
      have.answer = row.answer;
      have.day = row.day ?? have.day;
      have.updated_at = now;
      return clone(have);
    }
    const out: UnderstandingAnswerRow = {
      id: row.id ?? newId("ua"),
      session_id: sessionId,
      medication_id: row.medication_id,
      item: row.item,
      answer: row.answer,
      day: row.day ?? null,
      created_at: now,
      updated_at: now,
    };
    list.push(out);
    return clone(out);
  }

  async listUnderstandingAnswers(sessionId: string, filter: { medication_id?: string } = {}): Promise<UnderstandingAnswerRow[]> {
    const list = this.data(sessionId).understanding ?? [];
    return clone(list.filter((x) => filter.medication_id === undefined || x.medication_id === filter.medication_id));
  }

  // ------------------------------------------------------------ retention (C2 track H)

  async pruneSafetyEvents(sessionId: string, beforeIso: string): Promise<number> {
    const d = this.data(sessionId);
    const before = Date.parse(beforeIso);
    if (!Number.isFinite(before)) throw new StoreError("invalid", "beforeIso must be an ISO time");
    const keep = d.safety_events.filter((e) => Date.parse(e.created_at) >= before);
    const gone = d.safety_events.length - keep.length;
    d.safety_events = keep;
    return gone;
  }

  /** C2 track H: the rows that still carry this id, by "table.column" (the keys of lib/store/account-rows.ts). */
  async countAccountRows(userId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (!isUserId(userId)) return out; // a demo session's id is not a person
    const add = (key: string, n: number) => {
      if (n > 0) out[key] = (out[key] ?? 0) + n;
    };
    const own = this.sessions.get(userId);
    if (own) {
      add("session.id", 1);
      add("session_member.session_id", own.members.length);
      add("visit.session_id", own.visits.length);
      add("utterance.session_id", own.utterances.length);
      add("visit_item.session_id", own.visit_items.length);
      add("medication.session_id", own.medications.length);
      add("understanding_answer.session_id", own.understanding?.length ?? 0);
      add("dose_log.session_id", own.dose_logs.length);
      add("bp_reading.session_id", own.bp_readings.length);
      add("note.session_id", own.notes.length);
      add("question.session_id", own.questions.length);
      add("family_grant.session_id", own.family_grants.length);
      add("reminder_clip.session_id", own.reminder_clips.length);
      add("safety_event.session_id", own.safety_events.length);
      add("profile_fact.session_id", own.profile_facts.length);
      add("watch_metric.session_id", own.watch_metrics.length);
      add("prevent_done.session_id", own.prevent_done.length);
      add("diet_check.session_id", own.diet_checks.length);
      add("chat_message.session_id", own.chat_messages.length);
      add("brief_snapshot.session_id", own.brief_snapshots.length);
      add("translation.session_id", own.translations?.length ?? 0);
      add("reminder_delivery.session_id", own.deliveries.length);
      add("care_access_log.session_id", own.access_log.length);
    }
    for (const d of this.sessions.values()) {
      add("session.owner_user_id", d.session.owner_user_id === userId ? 1 : 0);
      add("question.asked_by_user_id", d.questions.filter((q) => q.asked_by_user_id === userId).length);
      add("reminder_clip.by_user_id", d.reminder_clips.filter((c) => c.by_user_id === userId).length);
      add("profile_fact.entered_by_user_id", d.profile_facts.filter((f) => f.entered_by_user_id === userId).length);
      add("care_access_log.family_user_id", d.access_log.filter((e) => e.family_user_id === userId).length);
    }
    add("account.user_id", this.accounts.has(userId) ? 1 : 0);
    add("account_recovery.user_id", this.recovery.has(userId) ? 1 : 0);
    add("known_device.user_id", this.devices.filter((x) => x.user_id === userId).length);
    add("reset_request.user_id", this.resetRequests.filter((x) => x.user_id === userId).length);
    add("account_event.user_id", this.accountEvents.filter((x) => x.user_id === userId).length);
    add("consent_record.user_id", this.consentRecords.filter((x) => x.user_id === userId).length);
    add("consent_record.scope_id", this.consentRecords.filter((x) => x.scope_id === userId).length);
    add("push_subscription.user_id", this.pushSubs.filter((x) => x.user_id === userId).length);
    add("care_link.patient_id", this.careLinks.filter((l) => l.patient_id === userId).length);
    add("care_link.family_id", this.careLinks.filter((l) => l.family_id === userId).length);
    add("care_grant_history.session_id", this.grantHistory.filter((h) => h.session_id === userId).length);
    // bus_seq, bus_event and account_session are not this store's: the in-process bus and the identity provider hold
    // them here (lib/privacy/delete.ts asks both)
    return out;
  }

  // ------------------------------------------------------------ C2 track I: web push

  async deleteOwnPushSubscription(userId: string, endpoint: string): Promise<boolean> {
    const before = this.pushSubs.length;
    this.pushSubs = this.pushSubs.filter((x) => !(x.user_id === userId && x.endpoint === endpoint));
    return this.pushSubs.length < before;
  }
}

const UNDERSTANDING_ITEMS = new Set<string>(["purpose", "feel_fine", "when", "missed"]);

type GlobalWithStore = typeof globalThis & { __rippleMemoryStore?: MemoryStore };

/** The process-wide instance (survives Next.js dev hot reload). */
export function getMemoryStore(): MemoryStore {
  const g = globalThis as GlobalWithStore;
  g.__rippleMemoryStore ??= new MemoryStore();
  return g.__rippleMemoryStore;
}
