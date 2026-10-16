/**
 * Supabase store (STORE=supabase): the Store interface (lib/store/types.ts) over PostgREST with fetch, no SDK
 * and no new dependency. Server-only: it uses SUPABASE_URL + SUPABASE_SERVICE_KEY (the secret key, which is
 * the service_role and bypasses RLS). The browser never talks to Postgres; every table has RLS on with no
 * policies and no privileges for anon / authenticated (web/supabase/migrations, applied by
 * `node scripts/db/migrate.mjs`; 0008_privileges.sql keeps it that way for every table added later).
 *
 * It behaves like the memory store (the same contract tests run against both, tests/contract/):
 *   - rows are keyed by (session_id, id); lists come back in insertion order (the `seq` column) and then in
 *     the memory store's sort order (day, slot, time), with `seq` stripped;
 *   - timestamps are written from this adapter's clock (`now`, so tests can fix it) and read back as
 *     `toISOString()` strings, exactly as the memory store hands them out;
 *   - a call for an unknown session throws StoreError("session_not_found"), a missing row "not_found";
 *   - createSession and resetSession are one database transaction each (rp_create_session /
 *     rp_reset_session); logDose and setFamilyGrant are single atomic upserts (rp_log_dose /
 *     rp_set_family_grant), so two server instances writing at once do not lose an update.
 * C2 (migrations 0004-0008): an account's session row stores no story clock; every row handed out has story_day /
 * story_time filled (lib/time/clock.ts projectScope). The story clock, a reset and joining devices are refused for an
 * account (StoreError "account_scope"). The C2 columns of the existing tables are handed out only once set
 * (lib/store/rows.ts), so demo rows look exactly as before. Account-level tables (accounts, links, consent, push,
 * limits, leases) and the new modules' tables are read and written here too; the multi-step changes are database
 * functions (rp_create_account_space, rp_reseed_account, rp_update_scope, rp_set_clock_offset, the care-link
 * functions, rp_rate_hit, rp_job_lease).
 *
 * Errors never carry the key, the project URL or a response body: only the operation, the HTTP status and
 * PostgREST's short error code. StoreError messages reach HTTP clients (lib/session/http.ts), so they stay short.
 *
 * Also exported for lib/bus.ts: createSupabaseBusLog() (the bus_event table and rp_bus_publish).
 */
import { createHash, randomUUID } from "node:crypto";
import type { BusEvent, BusEventType, BusLog } from "@/lib/bus";
import { storyDate } from "@/lib/story/clock";
import { buildSeedTables, templateDefaults } from "@/lib/story/seed";
import { DEFAULT_TZ, projectScope, scopeNowMs } from "@/lib/time/clock";
import { now as appNow } from "@/lib/time/now";
import { ACCOUNT_ROW_COLUMNS } from "./account-rows";
import { grantOut, isUserId, scopedTables, withoutUnset, type OptionalColumnTable } from "./rows";
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
  type DayRange,
  type DaySlot,
  type DeliveryKey,
  type DemoSessionRow,
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

// ---------------------------------------------------------------- config

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

/** SUPABASE_URL + SUPABASE_SERVICE_KEY, or null when either is missing. */
export function supabaseStoreConfig(env: Record<string, string | undefined> = process.env): SupabaseConfig | null {
  const url = (env.SUPABASE_URL ?? "").trim();
  const serviceKey = (env.SUPABASE_SERVICE_KEY ?? "").trim();
  return url && serviceKey ? { url, serviceKey } : null;
}

const NOT_CONFIGURED =
  "Supabase store not configured: STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY (web/.env). Unset STORE to use the in-memory store.";

// ---------------------------------------------------------------- PostgREST over fetch

/** A failed PostgREST call. The message has the operation, HTTP status and short error code only. */
export class PostgrestError extends Error {
  readonly status: number;
  readonly code: string;
  /** constraint named in a 23505 / 23503 message, e.g. "session_join_code_key" */
  readonly constraint: string | null;
  /** the message of an exception a database function raised on purpose ("account_scope"), never a body */
  readonly raised: string | null;
  constructor(op: string, status: number, code: string, constraint: string | null = null, raised: string | null = null) {
    super(`Supabase ${op}: ${status ? `HTTP ${status}` : "no response"}${code ? ` (${code})` : ""}`);
    this.name = "PostgrestError";
    this.status = status;
    this.code = code;
    this.constraint = constraint;
    this.raised = raised;
  }
}

const shortCode = (value: unknown): string =>
  String(value ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, 24);

/** The codes this app's own database functions raise (0004-0007): safe to read back as words. */
const RAISED = new Set(["session_not_found", "account_scope", "account_only", "filming_account_only", "demo_kind_only", "append_only", "revoked_by"]);

export interface PostgrestOptions extends SupabaseConfig {
  fetch?: typeof fetch;
  /** per request, default SUPABASE_TIMEOUT_MS or 15000 */
  timeoutMs?: number;
}

type Query = Record<string, string | number | boolean | undefined>;

export class PostgrestClient {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: PostgrestOptions) {
    if (!opts.url || !opts.serviceKey) throw new StoreError("not_configured", NOT_CONFIGURED);
    this.base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
    this.key = opts.serviceKey;
    this.fetchImpl = opts.fetch ?? fetch;
    const envTimeout = Number(process.env.SUPABASE_TIMEOUT_MS);
    this.timeoutMs = opts.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 15_000);
  }

  private url(path: string, query?: Query): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return `${this.base}/${path}${parts.length ? `?${parts.join("&")}` : ""}`;
  }

  async request(
    op: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    opts: { query?: Query; body?: unknown; prefer?: string[] } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      accept: "application/json",
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.prefer?.length) headers.prefer = opts.prefer.join(",");
    const url = this.url(path, opts.query);
    const attempts = method === "GET" ? 2 : 1; // reads are retried once; writes never (no double inserts)
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        if (attempt < attempts) continue;
        throw new PostgrestError(op, 0, "network");
      }
      if (res.ok) {
        if (res.status === 204) return null;
        const text = await res.text();
        return text ? (JSON.parse(text) as unknown) : null;
      }
      let code = "";
      let constraint: string | null = null;
      let raised: string | null = null;
      try {
        const body = (await res.json()) as { code?: unknown; message?: unknown };
        code = shortCode(body.code);
        const message = String(body.message ?? "");
        const m = /constraint "([a-z0-9_]+)"/i.exec(message);
        constraint = m ? m[1] : null;
        raised = RAISED.has(message) ? message : null;
      } catch {
        /* not JSON */
      }
      if (attempt < attempts && (res.status >= 500 || code === "PGRST002")) continue;
      throw new PostgrestError(op, res.status, code, constraint, raised);
    }
  }

  async select<T>(op: string, table: string, query: Query): Promise<T[]> {
    return ((await this.request(op, "GET", table, { query: { select: "*", ...query } })) as T[] | null) ?? [];
  }

  async insert(op: string, table: string, rows: object | object[], opts: { upsertOn?: string } = {}): Promise<void> {
    const prefer = ["return=minimal"];
    if (opts.upsertOn) prefer.push("resolution=merge-duplicates");
    await this.request(op, "POST", table, {
      query: opts.upsertOn ? { on_conflict: opts.upsertOn } : undefined,
      body: rows,
      prefer,
    });
  }

  async update<T>(op: string, table: string, query: Query, patch: object): Promise<T[]> {
    return (
      ((await this.request(op, "PATCH", table, { query: { select: "*", ...query }, body: patch, prefer: ["return=representation"] })) as
        | T[]
        | null) ?? []
    );
  }

  async remove(op: string, table: string, query: Query): Promise<void> {
    await this.request(op, "DELETE", table, { query, prefer: ["return=minimal"] });
  }

  /** DELETE that answers with the deleted rows' `select` columns (to count them). */
  async removeReturning<T>(op: string, table: string, query: Query, select = "*"): Promise<T[]> {
    return ((await this.request(op, "DELETE", table, { query: { select, ...query }, prefer: ["return=representation"] })) as T[] | null) ?? [];
  }

  async rpc<T>(op: string, fn: string, args: object): Promise<T> {
    return (await this.request(op, "POST", `rpc/${fn}`, { body: args })) as T;
  }
}

// ---------------------------------------------------------------- row mapping

const TIMESTAMP_COLUMNS = [
  "created_at",
  "updated_at",
  "expires_at",
  "at",
  // C2
  "tracking_since",
  "audio_deleted_at",
  "start_at",
  "last_seen_at",
  "first_seen_at",
  "used_at",
  "invite_expires_at",
  "accepted_at",
  "confirmed_at",
  "revoked_at",
  "published_at",
  "last_used_at",
  "sent_at",
  "opened_at",
  "started_at",
  "finished_at",
  "measured_at",
  "shown_at",
  "reset_at",
  // C2 track C (0010_c_questions)
  "edited_at",
  // C2 track B (0016_b_bp_changes)
  "deleted_at",
] as const;

/** A row as the memory store hands it out: no `seq`, timestamps as toISOString(). */
function fromDb<T>(raw: unknown): T {
  const row = { ...(raw as Record<string, unknown>) };
  delete row.seq;
  for (const col of TIMESTAMP_COLUMNS) {
    const v = row[col];
    if (typeof v === "string") row[col] = new Date(v).toISOString();
  }
  return row as T;
}

/** Table rows as the memory store hands them out (lib/store/rows.ts: the C2 columns only once set). */
function shape<T>(table: string, row: T): T {
  if (table === "visit" || table === "medication" || table === "question" || table === "reminder_clip") return withoutUnset(table as OptionalColumnTable, row as object) as T;
  // C2 track B (0011_b_daily): the pulse only once set
  if (table === "bp_reading") return withoutUnset("bp_reading", row as object) as T;
  // C2 track B (0018_b_dose_pre_tracking): pre_tracking only once set
  if (table === "dose_log") return withoutUnset("dose_log", row as object) as T;
  if (table === "family_grant") return grantOut(row as FamilyGrantRow) as T;
  return row;
}

const eq = (v: string | number) => `eq.${v}`;

/** Strip undefined so a PATCH never writes a column the caller did not give (JSON does this too). */
function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Columns a patch may not change: the keys and the insertion order. */
function patchBody(patch: object): Record<string, unknown> {
  const body = defined(patch) as Record<string, unknown>;
  delete body.id;
  delete body.session_id;
  delete body.seq;
  delete body.created_at;
  return body;
}

const SLOT_ORDER: Record<DaySlot, number> = { morning: 0, midday: 1, evening: 2, night: 3 };
const slotRank = (slot: string) => SLOT_ORDER[slot as DaySlot] ?? 9;

function byDaySlot<T extends { day: number; slot: DaySlot }>(a: T, b: T): number {
  return a.day - b.day || slotRank(a.slot) - slotRank(b.slot);
}

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const DEFAULT_MEMBER = "wei-ling";
const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
const CONSENT_DECISIONS = new Set(["granted", "declined", "withdrawn"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function joinCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += JOIN_ALPHABET[Math.floor(Math.random() * JOIN_ALPHABET.length)];
  return code;
}

function assertTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new StoreError("invalid", `Unknown time zone ${tz}`);
  }
}

/** Expired sessions are removed this long after they expire (real clock), at most every PRUNE_EVERY_MS. */
const PRUNE_GRACE_MS = 3_600_000;
const PRUNE_EVERY_MS = 10 * 60_000;

// ---------------------------------------------------------------- store

export interface SupabaseStoreOptions extends PostgrestOptions {
  now?: () => Date;
}

export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private readonly db: PostgrestClient;
  private readonly now: () => Date;
  private lastPrune = 0;

  constructor(opts: SupabaseStoreOptions) {
    this.db = new PostgrestClient(opts);
    this.now = opts.now ?? appNow;
  }

  private ts(): string {
    return this.now().toISOString();
  }

  /** C2 track J (filming): each scope's clock as this adapter last read its row (see tsIn). */
  private readonly clocks = new Map<string, { row: Pick<SessionRow, "kind" | "filming" | "clock_offset_ms">; readAt: number }>();

  /**
   * C2 track J (filming): the stamp of a row written into a scope, on that scope's own clock (lib/time/clock.ts
   * scopeNowMs: real now plus a filming account's clock offset; exactly ts() for a demo session and an ordinary
   * account, so they are unchanged). The offset is the scope row's as this adapter last read it: every request reads
   * its scope first, and setClockOffset / setFilmingAccount / reseedAccount refresh it; older than 10 s, the row is read
   * again. (Two server instances: a row written within those 10 s after the other instance moved the clock carries the
   * old offset.)
   */
  private async tsIn(sessionId: string): Promise<string> {
    let c = this.clocks.get(sessionId);
    if (!c || Date.now() - c.readAt > 10_000) {
      await this.sessionRow(sessionId).catch(() => null);
      c = this.clocks.get(sessionId);
    }
    const now = this.now().getTime();
    return new Date(c ? scopeNowMs(c.row, now) : now).toISOString();
  }

  private isExpired(s: SessionRow): boolean {
    return s.expires_at !== null && Date.parse(s.expires_at) <= this.now().getTime();
  }

  /** A session row as handed out: an account's story_day / story_time computed for this moment. */
  private scope(raw: unknown): SessionRow {
    const row = fromDb<SessionRow>(raw);
    if (row.clock_offset_ms !== null && row.clock_offset_ms !== undefined) row.clock_offset_ms = Number(row.clock_offset_ms);
    // C2 track J (filming): remember this scope's clock for the stamps of the rows written into it (tsIn)
    if (this.clocks.size > 5000) this.clocks.clear();
    this.clocks.set(row.id, { row: { kind: row.kind, filming: row.filming, clock_offset_ms: row.clock_offset_ms ?? null }, readAt: Date.now() });
    return projectScope(row, this.now().getTime());
  }

  /** PostgrestError -> StoreError where the cause is the setup, not the call. */
  private setup(err: unknown): never {
    if (err instanceof PostgrestError) {
      if (["PGRST205", "PGRST202", "42P01", "42883"].includes(err.code)) {
        throw new StoreError("not_configured", "Supabase store: the database schema is missing; run node scripts/db/migrate.mjs");
      }
      if (err.status === 401 || err.status === 403) {
        throw new StoreError("not_configured", "Supabase store: the server key was rejected (SUPABASE_SERVICE_KEY)");
      }
    }
    throw err;
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof StoreError) throw err;
      return this.setup(err);
    }
  }

  private async sessionRow(sessionId: string): Promise<SessionRow | null> {
    const rows = await this.db.select<unknown>("read session", "session", { id: eq(sessionId) });
    return rows.length ? this.scope(rows[0]) : null;
  }

  /** The memory store's data(): the session, or session_not_found (expiry is not checked, like memory). */
  private async mustSession(sessionId: string): Promise<SessionRow> {
    const s = await this.sessionRow(sessionId);
    if (!s) throw new StoreError("session_not_found", `No session ${sessionId}`);
    return s;
  }

  /**
   * C2 track D (10-11, the one-second fix round): a scope this adapter read within the last 10 seconds exists. Every
   * request reads its scope first (the same memory tsIn keeps, above), so an empty list or a missing row no longer
   * costs a second round trip to ask whether the session is there: on the hosted database that second trip was paid by
   * every empty read (today's deliveries before the first reminder, a week without readings), one after another.
   * deleteSession / deleteAccount / deleteExpiredSandboxes forget the scope, so a session this adapter deleted is
   * "not found" at once. (Two server instances: for up to 10 s after the other instance deleted a session, an empty
   * read here answers [] instead of session_not_found.)
   */
  private knownScope(sessionId: string): boolean {
    const c = this.clocks.get(sessionId);
    return !!c && Date.now() - c.readAt <= 10_000;
  }

  /** An empty result is only an answer when the session exists. */
  private async orNoSession<T>(sessionId: string, rows: T[]): Promise<T[]> {
    if (rows.length === 0 && !this.knownScope(sessionId)) await this.mustSession(sessionId);
    return rows;
  }

  /** A failed insert: unknown session (or parent visit) -> StoreError; a duplicate key -> invalid. */
  private async insertFailed(err: unknown, sessionId: string, what: string, missingParent?: string): Promise<never> {
    if (err instanceof PostgrestError) {
      if (err.code === "23503") {
        await this.mustSession(sessionId);
        throw new StoreError("not_found", missingParent ?? `Missing parent row for ${what}`);
      }
      if (err.code === "23505") throw new StoreError("invalid", `${what} already exists`);
    }
    return this.setup(err);
  }

  /** The database function refused: a demo-only or account-only operation, or the row is gone. */
  private refused(err: unknown, sessionId: string): never {
    if (err instanceof PostgrestError) {
      if (err.code === "P0002" || err.raised === "session_not_found") throw new StoreError("session_not_found", `No session ${sessionId}`);
      if (err.raised === "account_scope") throw new StoreError("account_scope", "this is for demo sessions only");
      if (err.raised === "account_only" || err.raised === "filming_account_only") throw new StoreError("account_scope", "this is for accounts only");
      if (err.code === "22023" || err.code === "P0001") throw new StoreError("account_scope", "not for this kind of session");
    }
    return this.setup(err);
  }

  private async rows<T>(op: string, table: string, sessionId: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const raw = await this.db.select<unknown>(op, table, { session_id: eq(sessionId), ...query, order: "seq.asc" });
    return this.orNoSession(sessionId, raw.map((r) => shape(table, fromDb<T>(r))));
  }

  /** The newest `limit` rows of a session's table, oldest first (undefined: all). */
  private async newestRows<T>(op: string, table: string, sessionId: string, limit: number | undefined, query: Record<string, string | undefined> = {}): Promise<T[]> {
    if (limit === undefined) return this.rows<T>(op, table, sessionId, query);
    if (!(limit > 0)) {
      await this.mustSession(sessionId);
      return [];
    }
    const raw = await this.db.select<unknown>(op, table, { session_id: eq(sessionId), ...query, order: "seq.desc", limit: Math.floor(limit) });
    return this.orNoSession(sessionId, raw.map((r) => shape(table, fromDb<T>(r))).reverse());
  }

  private async one<T>(op: string, table: string, sessionId: string, id: string, idColumn = "id"): Promise<T | null> {
    const raw = await this.db.select<unknown>(op, table, { session_id: eq(sessionId), [idColumn]: eq(id) });
    if (raw.length) return shape(table, fromDb<T>(raw[0]));
    if (!this.knownScope(sessionId)) await this.mustSession(sessionId);
    return null;
  }

  /** PATCH one row; missing row -> not_found, missing session -> session_not_found. */
  private async patchOne<T>(table: string, sessionId: string, id: string, patch: object, label: string): Promise<T> {
    const body = patchBody(patch);
    const raw = Object.keys(body).length
      ? await this.db.update<unknown>(`update ${table}`, table, { session_id: eq(sessionId), id: eq(id) }, body)
      : await this.db.select<unknown>(`read ${table}`, table, { session_id: eq(sessionId), id: eq(id) });
    if (raw.length) return shape(table, fromDb<T>(raw[0]));
    await this.mustSession(sessionId);
    throw new StoreError("not_found", `No ${label} ${id}`);
  }

  /** DELETE one row; missing row -> not_found, missing session -> session_not_found. */
  private async deleteOne(table: string, sessionId: string, id: string, label: string): Promise<void> {
    const gone = await this.db.removeReturning<unknown>(`delete ${table}`, table, { session_id: eq(sessionId), id: eq(id) }, "id");
    if (gone.length) return;
    await this.mustSession(sessionId);
    throw new StoreError("not_found", `No ${label} ${id}`);
  }

  /** Remove sandboxes that expired more than an hour ago (real clock, so a test clock never deletes live rows). */
  private async pruneExpired(): Promise<void> {
    const real = Date.now();
    if (real - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = real;
    try {
      await this.db.remove("prune expired sessions", "session", {
        kind: eq("sandbox"),
        expires_at: `lt.${new Date(real - PRUNE_GRACE_MS).toISOString()}`,
      });
    } catch (err) {
      console.warn(`[store] could not prune expired sessions: ${(err as Error).message}`);
    }
  }

  /** A session row update that must not touch an account (the story clock, filming mode). */
  private async patchDemo(sessionId: string, patch: Record<string, unknown>): Promise<SessionRow> {
    const raw = await this.db.update<unknown>("update session", "session", { id: eq(sessionId), kind: "neq.account" }, patch);
    if (raw.length) return this.scope(raw[0]);
    await this.mustSession(sessionId); // session_not_found when it does not exist
    throw new StoreError("account_scope", "this is for demo sessions only");
  }

  // ------------------------------------------------------------ sessions

  createSession(opts: CreateSessionOptions = {}): Promise<DemoSessionRow> {
    return this.run(async () => {
      await this.pruneExpired();
      const template = opts.template ?? "mr-tan";
      if (template === "blank") throw new StoreError("invalid", "a demo session needs the template timeline");
      const defaults = templateDefaults(template);
      const now = this.now();
      for (let attempt = 0; ; attempt++) {
        const expires = opts.ttl_hours ? new Date(now.getTime() + opts.ttl_hours * 3_600_000).toISOString() : null;
        const session: DemoSessionRow = {
          id: `demo-${randomUUID()}`,
          join_code: joinCode(),
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
        const tables = buildSeedTables(session.id, session.created_at, template);
        try {
          await this.db.rpc("create session", "rp_create_session", { p_session: session, p_tables: tables });
          return session;
        } catch (err) {
          // a join code already taken: draw another one
          if (err instanceof PostgrestError && err.code === "23505" && err.constraint === "session_join_code_key" && attempt < 8) continue;
          throw err;
        }
      }
    });
  }

  getSession(sessionId: string): Promise<SessionRow | null> {
    return this.run(async () => {
      const s = await this.sessionRow(sessionId);
      return s && !this.isExpired(s) ? s : null;
    });
  }

  getSessionByJoinCode(joinCode: string): Promise<SessionRow | null> {
    return this.run(async () => {
      const code = joinCode.trim().toUpperCase();
      if (!code) return null;
      const rows = await this.db.select<unknown>("read session", "session", { join_code: eq(code) });
      const s = rows.length ? this.scope(rows[0]) : null;
      return s && !this.isExpired(s) ? s : null;
    });
  }

  listSessions(): Promise<SessionRow[]> {
    return this.run(async () => {
      const nowIso = this.ts();
      const rows = await this.db.select<unknown>("list sessions", "session", {
        or: `(expires_at.is.null,expires_at.gt."${nowIso}")`,
        order: "seq.asc",
      });
      return rows.map((r) => this.scope(r)).filter((s) => !this.isExpired(s));
    });
  }

  setStoryDay(sessionId: string, day: number, time?: string | null): Promise<SessionRow> {
    if (!Number.isInteger(day)) return Promise.reject(new StoreError("invalid", `story_day must be an integer, got ${day}`));
    return this.run(async () => {
      const patch: Record<string, unknown> = { story_day: day };
      if (time !== undefined) patch.story_time = time;
      return this.patchDemo(sessionId, patch);
    });
  }

  setFilmingMode(sessionId: string, on: boolean): Promise<SessionRow> {
    return this.run(() => this.patchDemo(sessionId, { filming_mode: on }));
  }

  resetSession(sessionId: string): Promise<SessionRow> {
    return this.run(async () => {
      const s = await this.mustSession(sessionId);
      if (s.kind === "account") throw new StoreError("account_scope", "A reset is for demo sessions only");
      const defaults = templateDefaults(s.template);
      const tables = buildSeedTables(sessionId, this.ts(), s.template);
      try {
        const row = await this.db.rpc<unknown>("reset session", "rp_reset_session", {
          p_session_id: sessionId,
          p_story_day: defaults.story_day,
          p_story_time: defaults.story_time,
          p_tables: tables,
        });
        return this.scope(row);
      } catch (err) {
        return this.refused(err, sessionId);
      }
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    this.clocks.delete(sessionId); // C2 track D: no longer a scope this adapter knows to exist (knownScope)
    return this.run(() => this.db.remove("delete session", "session", { id: eq(sessionId) }));
  }

  deleteExpiredSandboxes(): Promise<number> {
    return this.run(async () => {
      const gone = await this.db.removeReturning<unknown>(
        "delete expired sandboxes",
        "session",
        { kind: eq("sandbox"), expires_at: `lte.${this.ts()}` },
        "id",
      );
      this.clocks.clear(); // C2 track D: which scopes went is not looked at; none is taken as known (knownScope)
      return gone.length;
    });
  }

  // ------------------------------------------------------------ account scopes

  createAccountScope(scope: NewAccountScope): Promise<SessionRow> {
    return this.run(async () => {
      if (!isUserId(scope.user_id)) throw new StoreError("invalid", "an account scope's id is the user's uuid");
      if (!ISO_DATE.test(scope.d0 ?? "")) throw new StoreError("invalid", "an account scope needs d0 (YYYY-MM-DD)");
      const tz = scope.tz ?? DEFAULT_TZ;
      assertTimeZone(tz);
      const nowIso = this.ts();
      const pScope = {
        owner_user_id: scope.user_id,
        template: scope.template ?? "blank",
        created_at: nowIso,
        d0: scope.d0,
        tz,
        settings: scope.settings ?? {},
        onboarding: scope.onboarding ?? null,
        example_data: scope.example_data ?? false,
        tracking_since: scope.tracking_since === undefined ? nowIso : scope.tracking_since,
      };
      try {
        const row = await this.db.rpc<unknown>("create account space", "rp_create_account_space", {
          p_scope: pScope,
          p_tables: scopedTables(scope.user_id, scope.tables),
        });
        return this.scope(row);
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") throw new StoreError("conflict", "this account already has its space");
        if (err instanceof PostgrestError && err.code === "23503") throw new StoreError("invalid", "no such user");
        return this.setup(err);
      }
    });
  }

  listAccountScopes(): Promise<SessionRow[]> {
    return this.run(async () => {
      const rows = await this.db.select<unknown>("list account scopes", "session", { kind: eq("account"), order: "seq.asc" });
      return rows.map((r) => this.scope(r));
    });
  }

  updateScope(scopeId: string, patch: ScopePatch): Promise<SessionRow> {
    return this.run(async () => {
      if (patch.tz !== undefined) assertTimeZone(patch.tz);
      try {
        return this.scope(await this.db.rpc<unknown>("update scope", "rp_update_scope", { p_scope_id: scopeId, p_patch: defined(patch) }));
      } catch (err) {
        return this.refused(err, scopeId);
      }
    });
  }

  setFilmingAccount(scopeId: string, on: boolean): Promise<SessionRow> {
    return this.run(async () => {
      const body: Record<string, unknown> = on ? { filming: true } : { filming: false, clock_offset_ms: null };
      const raw = await this.db.update<unknown>("update session", "session", { id: eq(scopeId), kind: eq("account") }, body);
      if (raw.length) return this.scope(raw[0]);
      await this.mustSession(scopeId);
      throw new StoreError("account_scope", "A filming account is for accounts only");
    });
  }

  setClockOffset(scopeId: string, offsetMs: number | null): Promise<SessionRow> {
    return this.run(async () => {
      if (offsetMs !== null && !Number.isFinite(offsetMs)) throw new StoreError("invalid", "offset must be a number of ms");
      try {
        return this.scope(
          await this.db.rpc<unknown>("set clock offset", "rp_set_clock_offset", {
            p_scope_id: scopeId,
            p_offset_ms: offsetMs === null ? null : Math.round(offsetMs),
            p_now: this.ts(),
          }),
        );
      } catch (err) {
        return this.refused(err, scopeId);
      }
    });
  }

  reseedAccount(scopeId: string, reseed: ReseedAccount): Promise<SessionRow> {
    return this.run(async () => {
      if (reseed.d0 !== undefined && !ISO_DATE.test(reseed.d0)) throw new StoreError("invalid", "d0 must be YYYY-MM-DD");
      const { tables, ...cols } = reseed;
      const t = scopedTables(scopeId, tables);
      try {
        return this.scope(
          await this.db.rpc<unknown>("reseed account", "rp_reseed_account", {
            p_scope_id: scopeId,
            p_patch: defined(cols),
            p_tables: { ...t, family_grants: [] },
          }),
        );
      } catch (err) {
        return this.refused(err, scopeId);
      }
    });
  }

  // ------------------------------------------------------------ members

  addMember(sessionId: string, member: NewMember): Promise<SessionMemberRow> {
    return this.run(async () => {
      const s = await this.mustSession(sessionId);
      if (s.kind === "account") throw new StoreError("account_scope", "Joining a device is for demo sessions only");
      const row: SessionMemberRow = {
        id: member.id ?? newId("member"),
        session_id: sessionId,
        role: member.role,
        device_label: member.device_label ?? null,
        created_at: this.ts(),
      };
      try {
        await this.db.insert("add member", "session_member", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Member ${row.id}`);
      }
      return row;
    });
  }

  listMembers(sessionId: string): Promise<SessionMemberRow[]> {
    return this.run(() => this.rows<SessionMemberRow>("list members", "session_member", sessionId));
  }

  // ------------------------------------------------------------ visits

  listVisits(sessionId: string): Promise<VisitRow[]> {
    return this.run(async () => (await this.rows<VisitRow>("list visits", "visit", sessionId)).sort((a, b) => a.day - b.day));
  }

  getVisit(sessionId: string, visitId: string): Promise<VisitRow | null> {
    return this.run(() => this.one<VisitRow>("read visit", "visit", sessionId, visitId));
  }

  upsertVisit(sessionId: string, visit: NewVisit): Promise<VisitRow> {
    return this.run(async () => {
      if (visit.id) {
        const raw = await this.db.update<unknown>("update visit", "visit", { session_id: eq(sessionId), id: eq(visit.id) }, patchBody(visit));
        if (raw.length) return shape("visit", fromDb<VisitRow>(raw[0]));
      }
      const s = await this.mustSession(sessionId);
      const d0 = scopeD0(s);
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
        created_at: await this.tsIn(sessionId),
        ...defined({ retain_until: visit.retain_until, keep_forever: visit.keep_forever, audio_deleted_at: visit.audio_deleted_at }),
        // C2 track F (0016_f_visit_made): only once set (a row without it never names the column)
        ...defined({ ai_used: visit.ai_used ?? undefined }),
        // C2 track R (0017_r_visit_audio_parts): only once set (a row without it never names the column)
        ...defined({ audio_parts: visit.audio_parts ?? undefined }),
      };
      try {
        await this.db.insert("add visit", "visit", row);
      } catch (err) {
        // inserted by another instance a moment ago: merge into it like the memory store does
        if (visit.id && err instanceof PostgrestError && err.code === "23505") {
          return this.patchOne<VisitRow>("visit", sessionId, visit.id, visit, "visit");
        }
        await this.insertFailed(err, sessionId, `Visit ${row.id}`);
      }
      return shape("visit", row);
    });
  }

  updateVisit(sessionId: string, visitId: string, patch: Patch<VisitRow>): Promise<VisitRow> {
    return this.run(() => this.patchOne<VisitRow>("visit", sessionId, visitId, patch, "visit"));
  }

  // C2 track F, round three: a planned follow-up taken back (its lines and items cascade; a planned visit has none)
  deleteVisit(sessionId: string, visitId: string): Promise<void> {
    return this.run(() => this.deleteOne("visit", sessionId, visitId, "visit"));
  }

  // ------------------------------------------------------------ utterances

  /** Upsert whole rows on (session_id, id); within one call a repeated id keeps its first place, last content. */
  private async upsertRows<T extends { id: string }>(table: string, op: string, sessionId: string, visitId: string, rows: T[]): Promise<void> {
    const byId = new Map<string, T>();
    for (const r of rows) byId.set(r.id, r); // Map keeps the first insertion position, takes the last value
    try {
      await this.db.insert(op, table, [...byId.values()], { upsertOn: "session_id,id" });
    } catch (err) {
      await this.insertFailed(err, sessionId, `${table} row`, `No visit ${visitId}`);
    }
  }

  addUtterances(sessionId: string, visitId: string, rows: NewUtterance[]): Promise<UtteranceRow[]> {
    return this.run(async () => {
      if (rows.length === 0) {
        if (!(await this.one<VisitRow>("read visit", "visit", sessionId, visitId))) throw new StoreError("not_found", `No visit ${visitId}`);
        return [];
      }
      const now = await this.tsIn(sessionId);
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
      await this.upsertRows("utterance", "add utterances", sessionId, visitId, added);
      return structuredClone(added);
    });
  }

  listUtterances(sessionId: string, visitId: string): Promise<UtteranceRow[]> {
    return this.run(async () =>
      (await this.rows<UtteranceRow>("list utterances", "utterance", sessionId, { visit_id: eq(visitId) })).sort(
        (a, b) => a.t_start_ms - b.t_start_ms,
      ),
    );
  }

  updateUtterance(sessionId: string, utteranceId: string, patch: Patch<UtteranceRow>): Promise<UtteranceRow> {
    return this.run(() => this.patchOne<UtteranceRow>("utterance", sessionId, utteranceId, patch, "utterance"));
  }

  // ------------------------------------------------------------ visit items

  addVisitItems(sessionId: string, visitId: string, items: NewVisitItem[]): Promise<VisitItemRow[]> {
    return this.run(async () => {
      if (items.length === 0) {
        if (!(await this.one<VisitRow>("read visit", "visit", sessionId, visitId))) throw new StoreError("not_found", `No visit ${visitId}`);
        return [];
      }
      const now = await this.tsIn(sessionId);
      const added = items.map<VisitItemRow>((it) => ({
        id: it.id ?? newId("item"),
        session_id: sessionId,
        visit_id: visitId,
        type: it.type,
        text: it.text,
        utterance_ids: it.utterance_ids ? [...it.utterance_ids] : [],
        slots: it.slots ? structuredClone(it.slots) : {},
        confirmed_by: it.confirmed_by ?? null,
        required_line: it.required_line ?? null,
        speaker: it.speaker ?? null,
        created_at: now,
      }));
      await this.upsertRows("visit_item", "add visit items", sessionId, visitId, added);
      return structuredClone(added);
    });
  }

  listVisitItems(sessionId: string, filter: VisitItemFilter = {}): Promise<VisitItemRow[]> {
    return this.run(() =>
      this.rows<VisitItemRow>("list visit items", "visit_item", sessionId, {
        visit_id: filter.visit_id === undefined ? undefined : eq(filter.visit_id),
        type: filter.type === undefined ? undefined : eq(filter.type),
        required_line: filter.required_only ? "not.is.null" : undefined,
      }),
    );
  }

  updateVisitItem(sessionId: string, itemId: string, patch: Patch<VisitItemRow>): Promise<VisitItemRow> {
    return this.run(() => this.patchOne<VisitItemRow>("visit_item", sessionId, itemId, patch, "visit item"));
  }

  // ------------------------------------------------------------ medications

  listMeds(sessionId: string): Promise<MedicationRow[]> {
    return this.run(() => this.rows<MedicationRow>("list medications", "medication", sessionId));
  }

  getMed(sessionId: string, medId: string): Promise<MedicationRow | null> {
    return this.run(() => this.one<MedicationRow>("read medication", "medication", sessionId, medId));
  }

  upsertMed(sessionId: string, med: NewMedication): Promise<MedicationRow> {
    return this.run(async () => {
      if (med.id) {
        const raw = await this.db.update<unknown>("update medication", "medication", { session_id: eq(sessionId), id: eq(med.id) }, patchBody(med));
        if (raw.length) return shape("medication", fromDb<MedicationRow>(raw[0]));
      }
      const row: MedicationRow = {
        id: med.id ?? newId("med"),
        session_id: sessionId,
        drug_id: med.drug_id ?? null,
        origin: med.origin,
        label: med.label ? structuredClone(med.label) : null,
        status: med.status,
        start_day: med.start_day ?? null,
        prescribed_visit_id: med.prescribed_visit_id ?? null,
        note: med.note ?? null,
        pharmacist_answer: med.pharmacist_answer ? structuredClone(med.pharmacist_answer) : null,
        created_at: await this.tsIn(sessionId),
        ...defined({ dose_slots: med.dose_slots ? [...med.dose_slots] : med.dose_slots, dose_slots_source: med.dose_slots_source, start_at: med.start_at }),
      };
      try {
        await this.db.insert("add medication", "medication", row);
      } catch (err) {
        if (med.id && err instanceof PostgrestError && err.code === "23505") {
          return this.patchOne<MedicationRow>("medication", sessionId, med.id, med, "medication");
        }
        await this.insertFailed(err, sessionId, `Medication ${row.id}`);
      }
      return shape("medication", row);
    });
  }

  // C2 track F, round three: a prescription that waited for its label, taken back (understanding answers cascade)
  deleteMed(sessionId: string, medId: string): Promise<void> {
    return this.run(() => this.deleteOne("medication", sessionId, medId, "medication"));
  }

  updateMed(sessionId: string, medId: string, patch: Patch<MedicationRow>): Promise<MedicationRow> {
    return this.run(() => this.patchOne<MedicationRow>("medication", sessionId, medId, patch, "medication"));
  }

  // ------------------------------------------------------------ doses

  logDose(sessionId: string, dose: NewDoseLog): Promise<DoseLogRow> {
    return this.run(async () => {
      const row: DoseLogRow = {
        id: dose.id ?? newId("dose"),
        session_id: sessionId,
        medication_id: dose.medication_id,
        day: dose.day,
        slot: dose.slot,
        state: dose.state,
        reason: dose.reason ?? null,
        reason_text: dose.reason_text ?? null,
        // C2 track B (0018): only an account's writers say it; a database before 0018 ignores the key and hands the
        // row back without it (lib/daily/tracking.ts answerCounts reads such a row by the rule as it was)
        ...(typeof dose.pre_tracking === "boolean" ? { pre_tracking: dose.pre_tracking } : {}),
        created_at: dose.created_at ?? (await this.tsIn(sessionId)), // track O: when he tapped (an answer sent late)
      };
      try {
        return shape("dose_log", fromDb<DoseLogRow>(await this.db.rpc<unknown>("log dose", "rp_log_dose", { p_row: row })));
      } catch (err) {
        return this.insertFailed(err, sessionId, `Dose ${row.id}`);
      }
    });
  }

  listDoses(sessionId: string, filter: DoseFilter = {}): Promise<DoseLogRow[]> {
    return this.run(async () => {
      const rows = await this.rows<DoseLogRow>("list doses", "dose_log", sessionId, {
        medication_id: filter.medication_id === undefined ? undefined : eq(filter.medication_id),
        ...dayFilter(filter),
      });
      return rows.sort(byDaySlot);
    });
  }

  // C2 track B: undo removes his answer (the cell is free again)
  deleteDose(sessionId: string, doseId: string): Promise<void> {
    return this.run(() => this.deleteOne("dose_log", sessionId, doseId, "dose"));
  }

  // ------------------------------------------------------------ blood pressure

  addBp(sessionId: string, reading: NewBpReading): Promise<BpReadingRow> {
    return this.run(async () => {
      const row: BpReadingRow = {
        id: reading.id ?? newId("bp"),
        session_id: sessionId,
        day: reading.day,
        slot: reading.slot,
        systolic: reading.systolic ?? null,
        diastolic: reading.diastolic ?? null,
        state: reading.state ?? "recorded",
        note: reading.note ?? null,
        created_at: reading.created_at ?? (await this.tsIn(sessionId)), // track O: when he tapped (a reading sent late)
        // C2 track B (0011_b_daily): only once set (a row without it never names the column)
        ...defined({ pulse: reading.pulse ?? undefined }),
      };
      try {
        await this.db.insert("add reading", "bp_reading", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Reading ${row.id}`);
      }
      return shape("bp_reading", row);
    });
  }

  listBp(sessionId: string, filter?: BpFilter): Promise<BpReadingRow[]> {
    // C2 track B (0016_b_bp_changes): a reading he deleted stays as a row and is left out unless asked for. Filtered
    // here, not in the query, so reading still works on a database where 0014 is not applied yet (no such column)
    return this.run(async () =>
      (await this.rows<BpReadingRow>("list readings", "bp_reading", sessionId, dayFilter(filter))).filter((r) => filter?.includeDeleted === true || !r.deleted_at).sort(byDaySlot),
    );
  }

  updateBp(sessionId: string, readingId: string, patch: Patch<BpReadingRow>): Promise<BpReadingRow> {
    return this.run(() => this.patchOne<BpReadingRow>("bp_reading", sessionId, readingId, patch, "reading"));
  }

  deleteBp(sessionId: string, readingId: string): Promise<void> {
    return this.run(() => this.deleteOne("bp_reading", sessionId, readingId, "reading"));
  }

  // ------------------------------------------------------------ notes

  addNote(sessionId: string, note: NewNote): Promise<NoteRow> {
    return this.run(async () => {
      const row: NoteRow = {
        id: note.id ?? newId("note"),
        session_id: sessionId,
        day: note.day,
        text: note.text,
        source: note.source,
        lang: note.lang ?? null,
        app_reply: note.app_reply ?? null,
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add note", "note", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Note ${row.id}`);
      }
      return row;
    });
  }

  listNotes(sessionId: string, filter?: DayRange): Promise<NoteRow[]> {
    return this.run(async () => (await this.rows<NoteRow>("list notes", "note", sessionId, dayFilter(filter))).sort((a, b) => a.day - b.day));
  }

  // ------------------------------------------------------------ questions

  listQuestions(sessionId: string, filter: QuestionFilter = {}): Promise<QuestionRow[]> {
    return this.run(() =>
      this.rows<QuestionRow>("list questions", "question", sessionId, {
        status: filter.status === undefined ? undefined : eq(filter.status),
        for: filter.for === undefined ? undefined : eq(filter.for),
        origin: filter.origin === undefined ? undefined : eq(filter.origin),
      }),
    );
  }

  getQuestion(sessionId: string, questionId: string): Promise<QuestionRow | null> {
    return this.run(() => this.one<QuestionRow>("read question", "question", sessionId, questionId));
  }

  addQuestion(sessionId: string, question: NewQuestion): Promise<QuestionRow> {
    return this.run(async () => {
      // created_day defaults to the story day (the memory store reads it from the session; an account's is computed)
      const createdDay = question.created_day ?? (await this.mustSession(sessionId)).story_day;
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
        created_day: createdDay,
        evidence: question.evidence ?? null,
        created_at: await this.tsIn(sessionId),
        ...defined({ asked_by_user_id: question.asked_by_user_id }),
      };
      try {
        await this.db.insert("add question", "question", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Question ${row.id}`);
      }
      return shape("question", row);
    });
  }

  updateQuestion(sessionId: string, questionId: string, patch: Patch<QuestionRow>): Promise<QuestionRow> {
    return this.run(() => this.patchOne<QuestionRow>("question", sessionId, questionId, patch, "question"));
  }

  // ------------------------------------------------------------ family grants

  getFamilyGrant(sessionId: string, member: string = DEFAULT_MEMBER): Promise<FamilyGrantRow | null> {
    return this.run(() => this.one<FamilyGrantRow>("read family grant", "family_grant", sessionId, member, "member"));
  }

  setFamilyGrant(sessionId: string, member: string, items: Partial<FamilyGrantItems>): Promise<FamilyGrantRow> {
    return this.run(async () => {
      try {
        return grantOut(
          fromDb<FamilyGrantRow>(
            await this.db.rpc<unknown>("set family grant", "rp_set_family_grant", {
              p_session_id: sessionId,
              p_member: member,
              p_items: defined(items),
              p_now: this.ts(),
            }),
          ),
        );
      } catch (err) {
        return this.insertFailed(err, sessionId, `Grant for ${member}`);
      }
    });
  }

  // ------------------------------------------------------------ reminder clips

  addReminderClip(sessionId: string, clip: NewReminderClip): Promise<ReminderClipRow> {
    return this.run(async () => {
      const row: ReminderClipRow = {
        id: clip.id ?? newId("clip"),
        session_id: sessionId,
        by: clip.by,
        audio_path: clip.audio_path ?? null,
        plays_at: clip.plays_at,
        text: clip.text ?? null,
        lang: clip.lang ?? null,
        created_at: await this.tsIn(sessionId),
        ...defined({ by_user_id: clip.by_user_id, by_label: clip.by_label, link_id: clip.link_id }),
      };
      try {
        await this.db.insert("add reminder clip", "reminder_clip", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Clip ${row.id}`);
      }
      return shape("reminder_clip", row);
    });
  }

  listReminderClips(sessionId: string): Promise<ReminderClipRow[]> {
    return this.run(() => this.rows<ReminderClipRow>("list reminder clips", "reminder_clip", sessionId));
  }

  deleteReminderClip(sessionId: string, clipId: string): Promise<void> {
    return this.run(() => this.deleteOne("reminder_clip", sessionId, clipId, "reminder clip"));
  }

  // ------------------------------------------------------------ safety events

  addSafetyEvent(sessionId: string, event: NewSafetyEvent): Promise<SafetyEventRow> {
    return this.run(async () => {
      const row: SafetyEventRow = {
        id: event.id ?? newId("safety"),
        session_id: sessionId,
        input: event.input,
        lang: event.lang ?? null,
        route: event.route,
        candidates: jsonValue(event.candidates),
        layer1: jsonValue(event.layer1),
        layer2: jsonValue(event.layer2),
        layer3: jsonValue(event.layer3),
        output: jsonValue(event.output),
        blocked: jsonValue(event.blocked),
        latency_ms: event.latency_ms ?? null,
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add safety event", "safety_event", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Safety event ${row.id}`);
      }
      return row;
    });
  }

  listSafetyEvents(sessionId: string, opts: { limit?: number } = {}): Promise<SafetyEventRow[]> {
    return this.run(() => this.newestRows<SafetyEventRow>("list safety events", "safety_event", sessionId, opts.limit));
  }

  // ------------------------------------------------------------ eval runs

  addEvalRun(run: NewEvalRun): Promise<EvalRunRow> {
    return this.run(async () => {
      const row: EvalRunRow = {
        id: run.id ?? newId("eval"),
        git_sha: run.git_sha ?? null,
        results: jsonValue(run.results),
        created_at: this.ts(),
      };
      try {
        await this.db.insert("add eval run", "eval_run", row);
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") throw new StoreError("invalid", `Eval run ${row.id} already exists`);
        throw err;
      }
      return row;
    });
  }

  getLatestEvalRun(): Promise<EvalRunRow | null> {
    return this.run(async () => {
      const raw = await this.db.select<unknown>("read eval run", "eval_run", { order: "seq.desc", limit: 1 });
      return raw.length ? fromDb<EvalRunRow>(raw[0]) : null;
    });
  }

  /** Not in the Store interface: lets live tests remove the eval runs they wrote. */
  deleteEvalRun(id: string): Promise<void> {
    return this.run(() => this.db.remove("delete eval run", "eval_run", { id: eq(id) }));
  }

  // ------------------------------------------------------------ accounts

  createAccount(account: NewAccount): Promise<AccountRow> {
    return this.run(async () => {
      if (!isUserId(account.user_id)) throw new StoreError("invalid", "an account's id is the user's uuid");
      const now = this.ts();
      const row: AccountRow = {
        user_id: account.user_id,
        login_kind: account.login_kind,
        username: account.username ?? null,
        display_name: account.display_name ?? null,
        locale: account.locale ?? null,
        last_seen_at: null,
        created_at: now,
        updated_at: now,
      };
      try {
        await this.db.insert("add account", "account", row);
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") {
          if (err.constraint === "account_username_key") throw new StoreError("conflict", "that username is taken");
          throw new StoreError("invalid", "this account already exists");
        }
        if (err instanceof PostgrestError && err.code === "23503") throw new StoreError("invalid", "no such user");
        if (err instanceof PostgrestError && err.code === "23514") throw new StoreError("invalid", "not a valid account");
        throw err;
      }
      return row;
    });
  }

  getAccount(userId: string): Promise<AccountRow | null> {
    return this.run(async () => {
      if (!isUserId(userId)) return null;
      const rows = await this.db.select<unknown>("read account", "account", { user_id: eq(userId) });
      return rows.length ? fromDb<AccountRow>(rows[0]) : null;
    });
  }

  getAccountByUsername(username: string): Promise<AccountRow | null> {
    return this.run(async () => {
      const u = username.trim().toLowerCase();
      if (!u) return null;
      const rows = await this.db.select<unknown>("read account", "account", { username: eq(u) });
      return rows.length ? fromDb<AccountRow>(rows[0]) : null;
    });
  }

  updateAccount(userId: string, patch: AccountPatch): Promise<AccountRow> {
    return this.run(async () => {
      if (!isUserId(userId)) throw new StoreError("not_found", "No such account");
      let raw: unknown[];
      try {
        raw = await this.db.update<unknown>("update account", "account", { user_id: eq(userId) }, { ...defined(patch), updated_at: this.ts() });
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") throw new StoreError("conflict", "that username is taken");
        throw err;
      }
      if (!raw.length) throw new StoreError("not_found", "No such account");
      return fromDb<AccountRow>(raw[0]);
    });
  }

  deleteAccount(userId: string): Promise<void> {
    return this.run(async () => {
      if (!isUserId(userId)) return;
      this.clocks.delete(userId); // C2 track D: his space goes with him (knownScope)
      // what she leaves behind in other spaces keeps its rows: her clips and the access log keep her label
      await this.db.update("clear clip author", "reminder_clip", { by_user_id: eq(userId) }, { by_user_id: null });
      await this.db.update("clear access log author", "care_access_log", { family_user_id: eq(userId) }, { family_user_id: null });
      // C2 track H (only add): the other two columns that can hold her id in someone else's space
      await this.db.update("clear fact author", "profile_fact", { entered_by_user_id: eq(userId) }, { entered_by_user_id: null });
      await this.db.update("clear question author", "question", { asked_by_user_id: eq(userId) }, { asked_by_user_id: null });
      // the links (as patient and as family; their switches and history go with them), his space, his own records
      await this.db.remove("delete links", "care_link", { or: `(patient_id.eq.${userId},family_id.eq.${userId})` });
      await this.db.remove("delete space", "session", { id: eq(userId) });
      await this.db.remove("delete consent", "consent_record", { user_id: eq(userId) });
      await this.db.remove("delete push", "push_subscription", { user_id: eq(userId) });
      await this.db.remove("delete account", "account", { user_id: eq(userId) });
    });
  }

  setRecoveryCode(userId: string, codeHash: string): Promise<RecoveryCodeRow> {
    return this.run(async () => {
      const row: RecoveryCodeRow = { user_id: userId, code_hash: codeHash, created_at: this.ts() };
      try {
        await this.db.insert("set recovery code", "account_recovery", row, { upsertOn: "user_id" });
      } catch (err) {
        if (err instanceof PostgrestError && (err.code === "23503" || err.code === "22P02")) throw new StoreError("not_found", "No such account");
        throw err;
      }
      return row;
    });
  }

  getRecoveryCode(userId: string): Promise<RecoveryCodeRow | null> {
    return this.run(async () => {
      if (!isUserId(userId)) return null;
      const rows = await this.db.select<unknown>("read recovery code", "account_recovery", { user_id: eq(userId) });
      return rows.length ? fromDb<RecoveryCodeRow>(rows[0]) : null;
    });
  }

  touchKnownDevice(userId: string, deviceHash: string, label?: string | null): Promise<KnownDeviceRow> {
    return this.run(async () => {
      const now = this.ts();
      const patch: Record<string, unknown> = { last_seen_at: now };
      if (label !== undefined) patch.label = label;
      const query = { user_id: eq(userId), device_hash: eq(deviceHash) };
      const updated = await this.db.update<unknown>("touch device", "known_device", query, patch);
      if (updated.length) return fromDb<KnownDeviceRow>(updated[0]);
      const row: KnownDeviceRow = { user_id: userId, device_hash: deviceHash, label: label ?? null, first_seen_at: now, last_seen_at: now };
      try {
        await this.db.insert("add device", "known_device", row);
        return row;
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") {
          const again = await this.db.update<unknown>("touch device", "known_device", query, patch);
          if (again.length) return fromDb<KnownDeviceRow>(again[0]);
        }
        if (err instanceof PostgrestError && (err.code === "23503" || err.code === "22P02")) throw new StoreError("not_found", "No such account");
        throw err;
      }
    });
  }

  listKnownDevices(userId: string): Promise<KnownDeviceRow[]> {
    return this.run(async () => {
      if (!isUserId(userId)) return [];
      return (await this.db.select<unknown>("list devices", "known_device", { user_id: eq(userId), order: "seq.asc" })).map((r) => fromDb<KnownDeviceRow>(r));
    });
  }

  createResetRequest(request: NewResetRequest): Promise<ResetRequestRow> {
    return this.run(async () => {
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
      try {
        await this.db.insert("add reset request", "reset_request", row);
      } catch (err) {
        if (err instanceof PostgrestError && (err.code === "23503" || err.code === "22P02")) throw new StoreError("not_found", "No such account");
        throw err;
      }
      return row;
    });
  }

  getResetRequest(id: string): Promise<ResetRequestRow | null> {
    return this.run(async () => {
      if (!isUserId(id)) return null;
      const rows = await this.db.select<unknown>("read reset request", "reset_request", { id: eq(id) });
      return rows.length ? fromDb<ResetRequestRow>(rows[0]) : null;
    });
  }

  useResetRequest(id: string): Promise<ResetRequestRow | null> {
    return this.run(async () => {
      if (!isUserId(id)) return null;
      const rows = await this.db.update<unknown>("use reset request", "reset_request", { id: eq(id), used_at: "is.null" }, { used_at: this.ts() });
      return rows.length ? fromDb<ResetRequestRow>(rows[0]) : null;
    });
  }

  addAccountEvent(userId: string, kind: string, detail: Record<string, unknown> = {}): Promise<AccountEventRow> {
    return this.run(async () => {
      const row: AccountEventRow = { id: newId("evt"), user_id: userId, kind, detail: structuredClone(detail), created_at: this.ts() };
      try {
        await this.db.insert("add account event", "account_event", row);
      } catch (err) {
        if (err instanceof PostgrestError && (err.code === "23503" || err.code === "22P02")) throw new StoreError("not_found", "No such account");
        throw err;
      }
      return row;
    });
  }

  listAccountEvents(userId: string): Promise<AccountEventRow[]> {
    return this.run(async () => {
      if (!isUserId(userId)) return [];
      return (await this.db.select<unknown>("list account events", "account_event", { user_id: eq(userId), order: "seq.asc" })).map((r) => fromDb<AccountEventRow>(r));
    });
  }

  // ------------------------------------------------------------ family links

  private linkResult(raw: unknown): CareLinkResult {
    const r = raw as { ok?: boolean; code?: string; link?: unknown };
    if (r && r.ok === true && r.link) return { ok: true, link: fromDb<CareLinkRow>(r.link) };
    return { ok: false, code: (r?.code ?? "link_not_found") as Extract<CareLinkResult, { ok: false }>["code"] };
  }

  createInvite(invite: NewCareInvite, items: Partial<FamilyGrantItems> = {}): Promise<CareLinkResult> {
    return this.run(async () => {
      const s = await this.mustSession(invite.patient_id);
      if (s.kind !== "account") throw new StoreError("account_scope", "A family invitation is for accounts only");
      const link = {
        id: invite.id ?? randomUUID(),
        patient_id: invite.patient_id,
        relation: invite.relation ?? null,
        family_label: invite.family_label ?? null,
        patient_label: invite.patient_label ?? null,
        invite_token_hash: invite.invite_token_hash,
        invite_expires_at: invite.invite_expires_at,
      };
      try {
        return this.linkResult(await this.db.rpc<unknown>("create invitation", "rp_invite_create", { p_link: link, p_items: defined(items), p_now: this.ts() }));
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") throw new StoreError("conflict", "that invitation token is already in use");
        throw err;
      }
    });
  }

  acceptInvite(tokenHash: string, familyUserId: string, familyLabel?: string | null): Promise<CareLinkResult> {
    return this.run(async () => {
      if (!tokenHash || !isUserId(familyUserId)) return { ok: false, code: "invite_not_found" } as CareLinkResult;
      return this.linkResult(
        await this.db.rpc<unknown>("accept invitation", "rp_invite_accept", {
          p_token_hash: tokenHash,
          p_family_id: familyUserId,
          p_family_label: familyLabel ?? null,
          p_now: this.ts(),
        }),
      );
    });
  }

  confirmLink(linkId: string, patientUserId: string, yes: boolean): Promise<CareLinkResult> {
    return this.run(async () => {
      if (!isUserId(linkId) || !isUserId(patientUserId)) return { ok: false, code: "link_not_found" } as CareLinkResult;
      return this.linkResult(
        await this.db.rpc<unknown>("confirm link", "rp_link_confirm", { p_link_id: linkId, p_patient_id: patientUserId, p_yes: yes, p_now: this.ts() }),
      );
    });
  }

  revokeLink(linkId: string, actorUserId: string, by: "patient" | "family"): Promise<CareLinkResult> {
    return this.run(async () => {
      if (!isUserId(linkId) || !isUserId(actorUserId)) return { ok: false, code: "link_not_found" } as CareLinkResult;
      return this.linkResult(
        await this.db.rpc<unknown>("revoke link", "rp_link_revoke", { p_link_id: linkId, p_actor_id: actorUserId, p_by: by, p_now: this.ts() }),
      );
    });
  }

  getCareLink(linkId: string): Promise<CareLinkRow | null> {
    return this.run(async () => {
      if (!isUserId(linkId)) return null;
      const rows = await this.db.select<unknown>("read link", "care_link", { id: eq(linkId) });
      return rows.length ? fromDb<CareLinkRow>(rows[0]) : null;
    });
  }

  listCareLinks(filter: CareLinkFilter): Promise<CareLinkRow[]> {
    return this.run(async () => {
      if ((filter.patient_id !== undefined && !isUserId(filter.patient_id)) || (filter.family_id !== undefined && !isUserId(filter.family_id))) return [];
      if (filter.status && filter.status.length === 0) return [];
      const rows = await this.db.select<unknown>("list links", "care_link", {
        patient_id: filter.patient_id === undefined ? undefined : eq(filter.patient_id),
        family_id: filter.family_id === undefined ? undefined : eq(filter.family_id),
        status: filter.status === undefined ? undefined : `in.(${filter.status.join(",")})`,
        order: "seq.asc",
      });
      return rows.map((r) => fromDb<CareLinkRow>(r));
    });
  }

  expireInvites(): Promise<number> {
    return this.run(async () => {
      const now = this.ts();
      const rows = await this.db.update<unknown>(
        "expire invitations",
        "care_link",
        { status: eq("invited"), invite_expires_at: `lte.${now}` },
        { status: "expired", updated_at: now },
      );
      return rows.length;
    });
  }

  listGrantHistory(linkId: string): Promise<GrantHistoryRow[]> {
    return this.run(async () => {
      if (!isUserId(linkId)) return [];
      const rows = await this.db.select<unknown>("list grant history", "care_grant_history", { link_id: eq(linkId), order: "version.asc" });
      return rows.map((r) => {
        const row = fromDb<GrantHistoryRow & { id?: unknown }>(r);
        delete row.id;
        return row;
      });
    });
  }

  addCareAccessLog(sessionId: string, entry: NewCareAccessLog): Promise<CareAccessLogRow> {
    return this.run(async () => {
      const row: CareAccessLogRow = {
        id: entry.id ?? newId("access"),
        session_id: sessionId,
        link_id: entry.link_id ?? null,
        family_user_id: entry.family_user_id ?? null,
        family_label: entry.family_label ?? null,
        route: entry.route,
        items: [...(entry.items ?? [])],
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add access log", "care_access_log", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Access log ${row.id}`);
      }
      return row;
    });
  }

  listCareAccessLog(sessionId: string, opts: { limit?: number } = {}): Promise<CareAccessLogRow[]> {
    return this.run(() => this.newestRows<CareAccessLogRow>("list access log", "care_access_log", sessionId, opts.limit));
  }

  addServiceReadLog(entry: NewServiceReadLog): Promise<ServiceReadLogRow> {
    return this.run(async () => {
      if (!entry.reason?.trim()) throw new StoreError("invalid", "a service read needs a reason");
      const row: ServiceReadLogRow = {
        id: newId("read"),
        actor: entry.actor,
        reason: entry.reason,
        session_id: entry.session_id ?? null,
        tables: [...(entry.tables ?? [])],
        created_at: this.ts(),
      };
      await this.db.insert("add service read", "service_read_log", row);
      return row;
    });
  }

  listServiceReadLog(opts: { session_id?: string } = {}): Promise<ServiceReadLogRow[]> {
    return this.run(async () =>
      (
        await this.db.select<unknown>("list service reads", "service_read_log", {
          session_id: opts.session_id === undefined ? undefined : eq(opts.session_id),
          order: "seq.asc",
        })
      ).map((r) => fromDb<ServiceReadLogRow>(r)),
    );
  }

  // ------------------------------------------------------------ consent

  putConsentText(text: NewConsentText): Promise<ConsentTextRow> {
    return this.run(async () => {
      const row: ConsentTextRow = { ...text, published_at: text.published_at ?? this.ts() };
      try {
        await this.db.insert("add consent text", "consent_text", row);
        return row;
      } catch (err) {
        if (!(err instanceof PostgrestError && err.code === "23505")) throw err;
      }
      const existing = await this.getConsentText(text.kind, text.version, text.locale);
      if (!existing || existing.sha256 !== text.sha256 || existing.text !== text.text) throw new StoreError("invalid", "a published consent text never changes; add a version");
      return existing;
    });
  }

  getConsentText(kind: ConsentKind, version: string, locale: string): Promise<ConsentTextRow | null> {
    return this.run(async () => {
      const rows = await this.db.select<unknown>("read consent text", "consent_text", { kind: eq(kind), version: eq(version), locale: eq(locale) });
      return rows.length ? fromDb<ConsentTextRow>(rows[0]) : null;
    });
  }

  addConsentRecord(record: NewConsentRecord): Promise<ConsentRecordRow> {
    return this.run(async () => {
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
        evidence: jsonValue(record.evidence),
        assisted: record.assisted ?? false,
        created_at: this.ts(),
      };
      try {
        await this.db.insert("add consent", "consent_record", row);
      } catch (err) {
        if (err instanceof PostgrestError && (err.code === "23503" || err.code === "22P02")) throw new StoreError("invalid", "no such user");
        throw err;
      }
      return row;
    });
  }

  listConsentRecords(userId: string, filter: { kind?: ConsentKind } = {}): Promise<ConsentRecordRow[]> {
    return this.run(async () => {
      if (!isUserId(userId)) return [];
      const rows = await this.db.select<unknown>("list consent", "consent_record", {
        user_id: eq(userId),
        kind: filter.kind === undefined ? undefined : eq(filter.kind),
        order: "seq.asc",
      });
      return rows.map((r) => fromDb<ConsentRecordRow>(r));
    });
  }

  // ------------------------------------------------------------ web push and deliveries

  savePushSubscription(sub: NewPushSubscription): Promise<PushSubscriptionRow> {
    // C2 track D (0015_d_push_device.sql): the device the phone subscribed on. A database without that column yet
    // (the migration is a file until the integrator applies it) answers PGRST204 / 42703 for it: the subscription is
    // then saved exactly as before, without the device, so turning reminders on never depends on the migration.
    const save = (device: string | null | undefined): Promise<PushSubscriptionRow> =>
      this.run(async () => {
        const patch = { user_id: sub.user_id, p256dh: sub.p256dh, auth: sub.auth, ...defined({ user_agent: sub.user_agent }), ...(device ? { device_hash: device } : {}) };
        const query = { endpoint: eq(sub.endpoint) };
        const updated = await this.db.update<unknown>("update push subscription", "push_subscription", query, patch);
        if (updated.length) return fromDb<PushSubscriptionRow>(updated[0]);
        const row: PushSubscriptionRow = {
          id: newId("push"),
          user_id: sub.user_id,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          user_agent: sub.user_agent ?? null,
          created_at: this.ts(),
          last_used_at: null,
          ...(device ? { device_hash: device } : {}),
        };
        try {
          await this.db.insert("add push subscription", "push_subscription", row);
          return row;
        } catch (err) {
          if (err instanceof PostgrestError && err.code === "23505") {
            const again = await this.db.update<unknown>("update push subscription", "push_subscription", query, patch);
            if (again.length) return fromDb<PushSubscriptionRow>(again[0]);
          }
          if (err instanceof PostgrestError && (err.code === "23503" || err.code === "22P02")) throw new StoreError("invalid", "no such user");
          throw err;
        }
      });
    if (!sub.device_hash) return save(null);
    return save(sub.device_hash).catch((err: unknown) => {
      if (missingColumn(err)) return save(null);
      throw err;
    });
  }

  listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    return this.run(async () => {
      if (!isUserId(userId)) return [];
      return (await this.db.select<unknown>("list push subscriptions", "push_subscription", { user_id: eq(userId), order: "seq.asc" })).map((r) =>
        fromDb<PushSubscriptionRow>(r),
      );
    });
  }

  deletePushSubscription(endpoint: string): Promise<void> {
    return this.run(() => this.db.remove("delete push subscription", "push_subscription", { endpoint: eq(endpoint) }));
  }

  recordDelivery(sessionId: string, key: DeliveryKey): Promise<{ created: boolean; delivery: ReminderDeliveryRow }> {
    return this.run(async () => {
      const now = await this.tsIn(sessionId);
      const row: ReminderDeliveryRow = { id: newId("delivery"), session_id: sessionId, ...key, sent_at: now, opened_at: null, created_at: now };
      try {
        await this.db.insert("record delivery", "reminder_delivery", row);
        return { created: true, delivery: row };
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") {
          const rows = await this.db.select<unknown>("read delivery", "reminder_delivery", {
            session_id: eq(sessionId),
            kind: eq(key.kind),
            ref: eq(key.ref),
            day: eq(key.day),
            slot: eq(key.slot),
          });
          if (rows.length) return { created: false, delivery: fromDb<ReminderDeliveryRow>(rows[0]) };
        }
        return this.insertFailed(err, sessionId, `Delivery ${row.id}`);
      }
    });
  }

  markDeliveryOpened(sessionId: string, deliveryId: string): Promise<ReminderDeliveryRow> {
    return this.run(async () => {
      const rows = await this.db.update<unknown>(
        "open delivery",
        "reminder_delivery",
        { session_id: eq(sessionId), id: eq(deliveryId), opened_at: "is.null" },
        { opened_at: await this.tsIn(sessionId) },
      );
      if (rows.length) return fromDb<ReminderDeliveryRow>(rows[0]);
      const existing = await this.one<ReminderDeliveryRow>("read delivery", "reminder_delivery", sessionId, deliveryId);
      if (!existing) throw new StoreError("not_found", `No delivery ${deliveryId}`);
      return existing;
    });
  }

  listDeliveries(sessionId: string, filter?: DayRange): Promise<ReminderDeliveryRow[]> {
    return this.run(() => this.rows<ReminderDeliveryRow>("list deliveries", "reminder_delivery", sessionId, dayFilter(filter)));
  }

  // ------------------------------------------------------------ rate limits and the scheduled jobs

  rateHit(bucket: string, windowS: number, limit: number): Promise<RateHit> {
    return this.run(async () => {
      const r = await this.db.rpc<{ count: number; allowed: boolean; reset_at: string }>("rate hit", "rp_rate_hit", {
        p_bucket: bucket,
        p_window_s: Math.max(1, Math.floor(windowS)),
        p_limit: Math.floor(limit),
        p_now: this.ts(),
      });
      return { count: Number(r.count), allowed: r.allowed === true, reset_at: new Date(r.reset_at).toISOString() };
    });
  }

  pruneRateLimits(beforeIso: string): Promise<number> {
    return this.run(async () => (await this.db.removeReturning<unknown>("prune rate limits", "rate_limit", { updated_at: `lt.${beforeIso}` }, "bucket")).length);
  }

  acquireJobLease(name: string, holder: string, ttlS: number): Promise<boolean> {
    return this.run(async () => {
      const got = await this.db.rpc<boolean>("job lease", "rp_job_lease", { p_name: name, p_holder: holder, p_ttl_s: Math.max(1, Math.floor(ttlS)), p_now: this.ts() });
      return got === true;
    });
  }

  releaseJobLease(name: string, holder: string): Promise<void> {
    return this.run(async () => {
      await this.db.rpc("release job lease", "rp_job_release", { p_name: name, p_holder: holder });
    });
  }

  addOpsRun(run: NewOpsRun): Promise<OpsRunRow> {
    return this.run(async () => {
      const row: OpsRunRow = {
        id: run.id ?? newId("run"),
        job: run.job,
        counts: { ...run.counts },
        started_at: run.started_at,
        finished_at: run.finished_at ?? null,
        created_at: this.ts(),
      };
      await this.db.insert("add ops run", "ops_run", row);
      return row;
    });
  }

  listOpsRuns(job?: string): Promise<OpsRunRow[]> {
    return this.run(async () =>
      (await this.db.select<unknown>("list ops runs", "ops_run", { job: job === undefined ? undefined : eq(job), order: "seq.asc" })).map((r) =>
        fromDb<OpsRunRow>(r),
      ),
    );
  }

  // ------------------------------------------------------------ profile facts

  listProfileFacts(sessionId: string, filter: ProfileFactFilter = {}): Promise<ProfileFactRow[]> {
    return this.run(() =>
      this.rows<ProfileFactRow>("list profile facts", "profile_fact", sessionId, {
        hidden: filter.hidden === true ? "is.true" : undefined,
        or: filter.hidden === false ? "(hidden.is.null,hidden.is.false)" : undefined,
        source: filter.source === undefined ? undefined : eq(filter.source),
        confirmed_by: filter.confirmed === undefined ? undefined : filter.confirmed ? "not.is.null" : "is.null",
      }),
    );
  }

  addProfileFact(sessionId: string, fact: NewProfileFact): Promise<ProfileFactRow> {
    return this.run(async () => {
      const createdDay = fact.created_day ?? (await this.mustSession(sessionId)).story_day;
      const row: ProfileFactRow = {
        id: fact.id ?? newId("fact"),
        session_id: sessionId,
        kind: fact.kind,
        text: fact.text,
        source: fact.source,
        entered_by: fact.entered_by ?? null,
        confirmed_by: fact.confirmed_by ?? null,
        visit_item_id: fact.visit_item_id ?? null,
        created_day: createdDay,
        data: jsonValue(fact.data),
        hidden: fact.hidden ?? null,
        entered_by_user_id: fact.entered_by_user_id ?? null,
        link_id: fact.link_id ?? null,
        confirmed_at: fact.confirmed_at ?? null,
        updated_at: fact.updated_at ?? null,
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add profile fact", "profile_fact", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Fact ${row.id}`);
      }
      return row;
    });
  }

  updateProfileFact(sessionId: string, factId: string, patch: Patch<ProfileFactRow>): Promise<ProfileFactRow> {
    return this.run(async () => this.patchOne<ProfileFactRow>("profile_fact", sessionId, factId, { ...patch, updated_at: await this.tsIn(sessionId) }, "fact"));
  }

  // ------------------------------------------------------------ prevention

  listPreventDone(sessionId: string): Promise<PreventDoneRow[]> {
    return this.run(() => this.rows<PreventDoneRow>("list prevention", "prevent_done", sessionId));
  }

  addPreventDone(sessionId: string, row: NewPreventDone): Promise<PreventDoneRow> {
    return this.run(async () => {
      const out: PreventDoneRow = {
        id: row.id ?? newId("prevent"),
        session_id: sessionId,
        item_id: row.item_id,
        day: row.day,
        source: row.source ?? null,
        visit_item_id: row.visit_item_id ?? null,
        note: row.note ?? null,
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add prevention", "prevent_done", out);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Prevention record ${out.id}`);
      }
      return out;
    });
  }

  deletePreventDone(sessionId: string, id: string): Promise<void> {
    return this.run(() => this.deleteOne("prevent_done", sessionId, id, "prevention record"));
  }

  // ------------------------------------------------------------ watch

  addWatchMetrics(sessionId: string, rows: NewWatchMetric[]): Promise<WatchMetricRow[]> {
    return this.run(async () => {
      if (rows.length === 0) {
        await this.mustSession(sessionId);
        return [];
      }
      const now = await this.tsIn(sessionId);
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
      try {
        await this.db.insert("add watch metrics", "watch_metric", added);
      } catch (err) {
        await this.insertFailed(err, sessionId, "Watch metric");
      }
      return structuredClone(added);
    });
  }

  listWatchMetrics(sessionId: string, filter: WatchFilter = {}): Promise<WatchMetricRow[]> {
    return this.run(async () =>
      (
        await this.rows<WatchMetricRow>("list watch metrics", "watch_metric", sessionId, {
          metric: filter.metric === undefined ? undefined : eq(filter.metric),
          ...dayFilter(filter),
        })
      ).sort((a, b) => a.day - b.day),
    );
  }

  // ------------------------------------------------------------ diet

  setDietCheck(sessionId: string, row: NewDietCheck): Promise<DietCheckRow> {
    return this.run(async () => {
      const patch = { answer: row.answer, source_ref: row.source_ref ?? null, note: row.note ?? null };
      const query = { session_id: eq(sessionId), day: eq(row.day), item: eq(row.item) };
      const updated = await this.db.update<unknown>("update diet check", "diet_check", query, patch);
      if (updated.length) return fromDb<DietCheckRow>(updated[0]);
      const out: DietCheckRow = {
        id: row.id ?? newId("diet"),
        session_id: sessionId,
        day: row.day,
        item: row.item,
        answer: row.answer,
        source_ref: row.source_ref ?? null,
        note: row.note ?? null,
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add diet check", "diet_check", out);
        return out;
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") {
          const again = await this.db.update<unknown>("update diet check", "diet_check", query, patch);
          if (again.length) return fromDb<DietCheckRow>(again[0]);
        }
        return this.insertFailed(err, sessionId, `Diet check ${out.id}`);
      }
    });
  }

  listDietChecks(sessionId: string, filter?: DayRange): Promise<DietCheckRow[]> {
    return this.run(async () => (await this.rows<DietCheckRow>("list diet checks", "diet_check", sessionId, dayFilter(filter))).sort((a, b) => a.day - b.day));
  }

  // ------------------------------------------------------------ chat

  addChatMessage(sessionId: string, message: NewChatMessage): Promise<ChatMessageRow> {
    return this.run(async () => {
      const row: ChatMessageRow = {
        id: message.id ?? newId("chat"),
        session_id: sessionId,
        day: message.day,
        role: message.role,
        text: message.text,
        lang: message.lang ?? null,
        safety_event_id: message.safety_event_id ?? null,
        answer: jsonValue(message.answer),
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add chat message", "chat_message", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Chat message ${row.id}`);
      }
      return row;
    });
  }

  listChatMessages(sessionId: string, filter: ChatFilter = {}): Promise<ChatMessageRow[]> {
    return this.run(() => this.newestRows<ChatMessageRow>("list chat", "chat_message", sessionId, filter.limit, dayFilter(filter)));
  }

  // ------------------------------------------------------------ brief snapshots

  addBriefSnapshot(sessionId: string, snapshot: NewBriefSnapshot): Promise<BriefSnapshotRow> {
    return this.run(async () => {
      const row: BriefSnapshotRow = {
        id: snapshot.id ?? newId("brief"),
        session_id: sessionId,
        locale: snapshot.locale ?? null,
        data: jsonValue(snapshot.data),
        shown_at: snapshot.shown_at ?? null,
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add brief snapshot", "brief_snapshot", row);
      } catch (err) {
        await this.insertFailed(err, sessionId, `Brief ${row.id}`);
      }
      return row;
    });
  }

  getBriefSnapshot(sessionId: string, id: string): Promise<BriefSnapshotRow | null> {
    return this.run(() => this.one<BriefSnapshotRow>("read brief", "brief_snapshot", sessionId, id));
  }

  listBriefSnapshots(sessionId: string, opts: { limit?: number } = {}): Promise<BriefSnapshotRow[]> {
    return this.run(() => this.newestRows<BriefSnapshotRow>("list briefs", "brief_snapshot", sessionId, opts.limit));
  }

  markBriefShown(sessionId: string, id: string): Promise<BriefSnapshotRow> {
    return this.run(async () => this.patchOne<BriefSnapshotRow>("brief_snapshot", sessionId, id, { shown_at: await this.tsIn(sessionId) }, "brief"));
  }

  // ------------------------------------------------------------ C2 track A: sign-in protection

  getRateWindow(bucket: string): Promise<RateWindow | null> {
    return this.run(async () => {
      const rows = await this.db.select<{ count: number; window_start: string; window_s: number }>("read rate window", "rate_limit", { bucket: eq(bucket) });
      if (!rows.length) return null;
      const end = Date.parse(rows[0].window_start) + Number(rows[0].window_s) * 1000;
      if (!Number.isFinite(end) || end <= this.now().getTime()) return null;
      return { count: Number(rows[0].count), reset_at: new Date(end).toISOString() };
    });
  }

  clearRate(bucket: string): Promise<void> {
    return this.run(async () => {
      await this.db.remove("clear rate", "rate_limit", { bucket: eq(bucket) });
    });
  }

  // ------------------------------------------------------------ C2 track L: an allowance that is a sum (0015_l_rate_add)

  rateAdd(bucket: string, windowS: number, limit: number, amount: number): Promise<RateHit> {
    return this.run(async () => {
      const r = await this.db.rpc<{ count: number; allowed: boolean; reset_at: string }>("rate add", "rp_rate_add", {
        p_bucket: bucket,
        p_window_s: Math.max(1, Math.floor(windowS)),
        p_limit: Math.floor(limit),
        p_amount: Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0)),
        p_now: this.ts(),
      });
      return { count: Number(r.count), allowed: r.allowed === true, reset_at: new Date(r.reset_at).toISOString() };
    });
  }

  // ------------------------------------------------------------ C2 track A: family-assisted reset (0005 tables, no new migration)

  setLinkResetHelper(linkId: string, patientUserId: string, on: boolean): Promise<CareLinkResult> {
    return this.run(async () => {
      if (!isUserId(linkId) || !isUserId(patientUserId)) return { ok: false, code: "link_not_found" };
      // one statement decides: the link is his and active, or nothing changes
      const rows = await this.db.update<unknown>(
        "set reset helper",
        "care_link",
        { id: eq(linkId), patient_id: eq(patientUserId), status: eq("active") },
        { reset_helper: on, updated_at: this.ts() },
      );
      if (rows.length) return { ok: true, link: fromDb<CareLinkRow>(rows[0]) };
      const found = await this.db.select<unknown>("read link", "care_link", { id: eq(linkId), patient_id: eq(patientUserId) });
      return { ok: false, code: found.length ? "link_closed" : "link_not_found" };
    });
  }

  listResetRequests(userId: string): Promise<ResetRequestRow[]> {
    return this.run(async () => {
      if (!isUserId(userId)) return [];
      return (await this.db.select<unknown>("list reset requests", "reset_request", { user_id: eq(userId), order: "seq.asc" })).map((r) => fromDb<ResetRequestRow>(r));
    });
  }

  setResetRequestCode(id: string, linkId: string, codeHash: string): Promise<ResetRequestRow | null> {
    return this.run(async () => {
      if (!isUserId(id) || !isUserId(linkId)) return null;
      const rows = await this.db.update<unknown>("set reset code", "reset_request", { id: eq(id), used_at: "is.null" }, { link_id: linkId, code_hash: codeHash });
      return rows.length ? fromDb<ResetRequestRow>(rows[0]) : null;
    });
  }

  // ------------------------------------------------------------ translations (C2 track S, 0009_s_translations)

  getTranslation(sessionId: string, direction: TranslationDirection, sourceSha256: string): Promise<TranslationRow | null> {
    return this.run(async () => {
      const raw = await this.db.select<unknown>("read translation", "translation", {
        session_id: eq(sessionId),
        direction: eq(direction),
        source_sha256: eq(sourceSha256),
      });
      if (raw.length) return fromDb<TranslationRow>(raw[0]);
      await this.mustSession(sessionId);
      return null;
    });
  }

  putTranslation(sessionId: string, row: NewTranslation): Promise<TranslationRow> {
    return this.run(async () => {
      const out: TranslationRow = {
        id: row.id ?? newId("tr"),
        session_id: sessionId,
        direction: row.direction,
        source_sha256: row.source_sha256,
        source_text: row.source_text,
        text: row.text ?? null,
        status: row.status,
        checks: jsonValue(row.checks ?? {}),
        created_at: await this.tsIn(sessionId),
      };
      try {
        await this.db.insert("add translation", "translation", out);
        return out;
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") {
          // (direction, source) is already there: the first row stays
          const raw = await this.db.select<unknown>("read translation", "translation", {
            session_id: eq(sessionId),
            direction: eq(row.direction),
            source_sha256: eq(row.source_sha256),
          });
          if (raw.length) return fromDb<TranslationRow>(raw[0]);
        }
        if (err instanceof PostgrestError && err.code === "23514") throw new StoreError("invalid", "A translation must be checked (with its text) or rejected");
        return this.insertFailed(err, sessionId, `Translation ${out.id}`);
      }
    });
  }

  listTranslations(sessionId: string): Promise<TranslationRow[]> {
    return this.run(() => this.rows<TranslationRow>("list translations", "translation", sessionId));
  }

  // ------------------------------------------------------------ the understanding checklist (C2 track F, 0012)

  setUnderstandingAnswer(sessionId: string, row: NewUnderstandingAnswer): Promise<UnderstandingAnswerRow> {
    return this.run(async () => {
      const now = await this.tsIn(sessionId);
      const patch = { answer: row.answer, updated_at: now, ...(row.day !== undefined && row.day !== null ? { day: row.day } : {}) };
      const query = { session_id: eq(sessionId), medication_id: eq(row.medication_id), item: eq(row.item) };
      const updated = await this.db.update<unknown>("update understanding answer", "understanding_answer", query, patch);
      if (updated.length) return fromDb<UnderstandingAnswerRow>(updated[0]);
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
      try {
        await this.db.insert("add understanding answer", "understanding_answer", out);
        return out;
      } catch (err) {
        if (err instanceof PostgrestError && err.code === "23505") {
          const again = await this.db.update<unknown>("update understanding answer", "understanding_answer", query, patch);
          if (again.length) return fromDb<UnderstandingAnswerRow>(again[0]);
        }
        if (err instanceof PostgrestError && err.code === "23514") throw new StoreError("invalid", "Unknown checklist item or answer");
        return this.insertFailed(err, sessionId, `Understanding answer ${out.id}`, `No medicine ${row.medication_id}`);
      }
    });
  }

  listUnderstandingAnswers(sessionId: string, filter: { medication_id?: string } = {}): Promise<UnderstandingAnswerRow[]> {
    return this.run(() =>
      this.rows<UnderstandingAnswerRow>("list understanding answers", "understanding_answer", sessionId, {
        medication_id: filter.medication_id === undefined ? undefined : eq(filter.medication_id),
      }),
    );
  }

  // ------------------------------------------------------------ retention (C2 track H)

  pruneSafetyEvents(sessionId: string, beforeIso: string): Promise<number> {
    return this.run(async () => {
      const before = Date.parse(beforeIso);
      if (!Number.isFinite(before)) throw new StoreError("invalid", "beforeIso must be an ISO time");
      const gone = await this.db.removeReturning<unknown>(
        "prune safety events",
        "safety_event",
        { session_id: eq(sessionId), created_at: `lt.${new Date(before).toISOString()}` },
        "id",
      );
      if (!gone.length) await this.mustSession(sessionId); // session_not_found, like the memory store
      return gone.length;
    });
  }

  /**
   * C2 track H: the rows that still carry this id, by "table.column" (lib/store/account-rows.ts). One small read per
   * column (the column alone, at most 1000 rows: the answer is "how many are left", and anything above zero is a
   * finding). A table this database does not have yet (a migration not applied) counts as none.
   */
  countAccountRows(userId: string): Promise<Record<string, number>> {
    return this.run(async () => {
      const out: Record<string, number> = {};
      if (!isUserId(userId)) return out;
      const pairs = Object.entries(ACCOUNT_ROW_COLUMNS).flatMap(([table, cols]) => cols.map((col) => ({ table, col })));
      for (let i = 0; i < pairs.length; i += 8) {
        await Promise.all(
          pairs.slice(i, i + 8).map(async ({ table, col }) => {
            let rows: unknown[];
            try {
              rows = await this.db.select<unknown>("count account rows", table, { select: col, [col]: eq(userId), limit: 1000 });
            } catch (err) {
              // the table is not there: PostgREST's schema cache does not know it (404 / PGRST205) or PostgreSQL says so (42P01)
              if (err instanceof PostgrestError && (err.status === 404 || err.code === "PGRST205" || err.code === "42P01")) return;
              throw err;
            }
            if (rows.length) out[`${table}.${col}`] = rows.length;
          }),
        );
      }
      return out;
    });
  }

  // ------------------------------------------------------------ C2 track I: web push

  deleteOwnPushSubscription(userId: string, endpoint: string): Promise<boolean> {
    return this.run(
      async () =>
        (await this.db.removeReturning<unknown>("delete own push subscription", "push_subscription", { user_id: eq(userId), endpoint: eq(endpoint) }, "id")).length > 0,
    );
  }
}

/**
 * C2 track D: the database does not have a column the adapter named (a migration written as a file and not applied
 * yet): PostgREST's PGRST204 for a column in the payload, PostgreSQL's 42703 for one in a statement (this.run hands
 * both on as they are).
 */
function missingColumn(err: unknown): boolean {
  return err instanceof PostgrestError && (err.code === "PGRST204" || err.code === "42703");
}

/** JSON columns: undefined is stored as null, and a deep copy is kept (like the memory store's clone). */
function jsonValue(v: unknown): unknown {
  return v === undefined ? null : structuredClone(v);
}

/** Inclusive day range as PostgREST filters (two filters on one column need the and=() form). */
function dayFilter(r?: DayRange): Record<string, string | undefined> {
  if (!r) return {};
  const from = r.fromDay;
  const to = r.toDay;
  if (from !== undefined && to !== undefined) return { and: `(day.gte.${from},day.lte.${to})` };
  if (from !== undefined) return { day: `gte.${from}` };
  if (to !== undefined) return { day: `lte.${to}` };
  return {};
}

// ---------------------------------------------------------------- process-wide instance

type GlobalWithSupabase = typeof globalThis & { __rippleSupabaseStore?: { fingerprint: string; store: SupabaseStore } };

/** The process-wide adapter for the current SUPABASE_URL / SUPABASE_SERVICE_KEY (throws not_configured without them). */
export function getSupabaseStore(env: Record<string, string | undefined> = process.env): SupabaseStore {
  const cfg = supabaseStoreConfig(env);
  if (!cfg) throw new StoreError("not_configured", NOT_CONFIGURED);
  const g = globalThis as GlobalWithSupabase;
  const fingerprint = createHash("sha256").update(`${cfg.url}\n${cfg.serviceKey}`).digest("hex");
  if (g.__rippleSupabaseStore?.fingerprint !== fingerprint) {
    g.__rippleSupabaseStore = { fingerprint, store: new SupabaseStore(cfg) };
  }
  return g.__rippleSupabaseStore.store;
}

/** A new adapter (tests pass `now` and `fetch`). Throws not_configured without a URL and key. */
export function createSupabaseStore(opts?: Partial<SupabaseStoreOptions>): SupabaseStore {
  const cfg = opts?.url && opts?.serviceKey ? { url: opts.url, serviceKey: opts.serviceKey } : supabaseStoreConfig();
  if (!cfg) throw new StoreError("not_configured", NOT_CONFIGURED);
  return new SupabaseStore({ ...opts, ...cfg });
}

// ---------------------------------------------------------------- bus log (lib/bus.ts in supabase mode)

interface BusEventDbRow {
  seq: number;
  type: string;
  say: string;
  data: unknown;
  at: string;
}

const BUS_COLUMNS = "seq,type,say,data,at";

function toBusEvent(sessionId: string, r: BusEventDbRow): BusEvent {
  return {
    id: Number(r.seq),
    type: r.type as BusEventType,
    session_id: sessionId,
    at: new Date(r.at).toISOString(),
    say: r.say,
    data: r.data,
  };
}

/** The bus_event table behind lib/bus.ts (STORE=supabase). Ids are the per-session sequence of rp_bus_publish. */
export function createSupabaseBusLog(cfg: PostgrestOptions, opts: { keep?: number } = {}): BusLog {
  const db = new PostgrestClient(cfg);
  const keep = opts.keep ?? 200;
  return {
    async append(event) {
      const seq = await db.rpc<number | string>("publish event", "rp_bus_publish", {
        p_session_id: event.session_id,
        p_type: event.type,
        p_say: event.say,
        p_data: event.data === undefined ? null : event.data,
        p_at: event.at,
        p_keep: keep,
      });
      return Number(seq);
    },
    async after(sessionId, afterId, limit) {
      const rows = (await db.request("read events", "GET", "bus_event", {
        query: { select: BUS_COLUMNS, session_id: eq(sessionId), seq: `gt.${Math.max(0, Math.floor(afterId))}`, order: "seq.asc", limit },
      })) as BusEventDbRow[] | null;
      return (rows ?? []).map((r) => toBusEvent(sessionId, r));
    },
    async latest(sessionId, limit) {
      const rows = (await db.request("read events", "GET", "bus_event", {
        query: { select: BUS_COLUMNS, session_id: eq(sessionId), order: "seq.desc", limit },
      })) as BusEventDbRow[] | null;
      return (rows ?? []).map((r) => toBusEvent(sessionId, r)).reverse();
    },
    async head(sessionId) {
      const rows = (await db.request("read event head", "GET", "bus_seq", {
        query: { select: "n", session_id: eq(sessionId) },
      })) as { n: number | string }[] | null;
      return rows?.length ? Number(rows[0].n) : 0;
    },
    async clear(sessionId) {
      await db.remove("clear events", "bus_event", { session_id: eq(sessionId) });
    },
    // C2 track H (only add): the 7-day limit on a scope's event history (real-app 3.11 保留期限)
    async prune(sessionId, beforeIso) {
      const gone = await db.removeReturning<unknown>("prune events", "bus_event", { session_id: eq(sessionId), at: `lt.${new Date(beforeIso).toISOString()}` }, "seq");
      return gone.length;
    },
  };
}
