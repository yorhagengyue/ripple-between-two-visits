/**
 * The store contract (tests/contract/store.contract.ts) against the real Supabase project, the checks that only make
 * sense on a shared database, and the database's door. The live parts are skipped unless STORE_LIVE=1.
 *
 * What the integrator runs (from web/, on the TEST project, never the production one):
 *
 *   bash         STORE_LIVE=1 npx vitest run tests/unit/store/supabase.live.test.ts
 *   PowerShell   $env:STORE_LIVE = "1"; npx vitest run tests/unit/store/supabase.live.test.ts
 *
 * It reads web/.env. The variables it needs (names only; a missing one fails the run with its name, nothing is
 * skipped and there is no hand list to fall back to):
 *
 *   SUPABASE_URL           the project
 *   SUPABASE_SERVICE_KEY   the server's key: the store, the admin API that makes and deletes the two test accounts
 *   SUPABASE_ANON_KEY      the publishable key: the password grant, and the apikey header of every door request
 *   SUPABASE_DB_URL        the session pooler string scripts/db/migrate.mjs and check-privileges.mjs use: the table and
 *                          function lists come from the database's own catalog over this connection (PostgREST does
 *                          not serve information_schema). One read-only transaction, SELECT statements only.
 *
 * The schema must be migrated (node scripts/db/migrate.mjs, 0001-0016) and the two buckets must exist (npx tsx
 * scripts/setup-storage.ts). The adapter is built here with explicit config, never through getStore() and STORE
 * (web/.env says STORE=memory). No app server should run its scheduled jobs against the test project meanwhile: the
 * door test counts the two test accounts' rows before and after, and a job that settles a dose for one of them in
 * between would show as a difference.
 *
 * The door (track G). docs/plan/real-app.md 3.9 (lines 694-728) and 8.8 (lines 1500-1512): anyone with an account can
 * take their own token and the publishable key and call PostgREST directly, so the database itself must refuse them.
 * Line 728: the live test lists the tables from information_schema, so a table added later cannot be forgotten. The
 * audit (au3 row 3) found a hand-written list that left out translation, account_session and understanding_answer,
 * and no request made with a second account's token. Here:
 *
 *   - the lists come from the catalog at run time (tests/support/db-door.ts): every table of schema public
 *     (information_schema.tables, cross-checked with pg_class), every table with a session_id column
 *     (information_schema.columns), every function (pg_proc). The short hand lists below are a floor only: the catalog
 *     must contain at least those, so an empty or wrong catalog query cannot pass;
 *   - two accounts are made through the admin API, A with the example space and a row in more tables, B with a blank
 *     space; B is A's daughter with every switch on (8.8: her token still reads none of his rows, before and after he
 *     stops sharing). Each has its own access token from the password grant;
 *   - with B's token: no row of any table, whole or filtered on A's id or on her own; no insert, update or delete; no
 *     function, without arguments or with A's id in every parameter that takes an id. The same with the publishable
 *     key alone. Afterwards A's and B's rows are counted with the server's key and are what they were;
 *   - what a request cannot tell is asked from the catalog over the direct connection: row level security on and no
 *     policy on every table, no privilege for anon or authenticated on any table, column, sequence or function (a
 *     granted function that stops at its own tables answers 403 like one that may not be called), and the merge
 *     gate's own query (scripts/db/check-privileges.mjs), which also covers default privileges;
 *   - the two buckets: nothing listed, read, signed, written or removed with B's token (line 726);
 *   - both accounts and everything made are deleted at the end, also after a failure, and the last test asserts they
 *     are gone (line 1372), asking the database itself.
 *
 * Where this follows a recorded decision and not the design. The design's table (lines 709-722) gives a person
 * "select own" and a few own writes through policies. The build decided otherwise and wrote it down (web/progress/
 * f1.md lines 12, 21, 103; supabase/migrations/0008_privileges.sql; scripts/db/check-privileges.mjs): RLS on for every
 * table, no policy at all, no privilege for anon or authenticated on any table, sequence or function; only the
 * server's key reads and writes. So the designed "own" check becomes stricter here: A's own token reads and writes
 * nothing either, not even A's own rows, and a table with any policy is a finding. The same decision is why 8.8's
 * "A may not insert an utterance / a doctor's line / a question with an answer" is covered by "A inserts nothing".
 *
 * Nothing secret is printed. Every request goes through Door (tests/support/db-door.ts): what comes back is a status,
 * a short error code, a row count and, for an error, its one-line message after redaction; the body itself is never
 * handed out. Every assertion compares table and function names, HTTP statuses, error codes and counts. No header,
 * URL, key, token or address is put into a message. The redaction has its own tests at the end of this file, which
 * always run.
 *
 * Offline (opt-in like tests/unit/store/pglite.contract.test.ts, the same module: PGlite is not a dependency):
 *
 *   RIPPLE_PGLITE_MODULE=<...>/@electric-sql/pglite/dist/index.js npx vitest run tests/unit/store/supabase.live.test.ts
 *
 * runs the same catalog queries and the same door checks against a real PostgreSQL with every migration applied. The
 * stand-in for PostgREST (tests/support/fake-postgrest.ts) is run under the role a real request would have (anon for
 * the publishable key, authenticated for a person's token), so PostgreSQL itself refuses. That proves the queries, the
 * lists and the probes; what Supabase's own gateway, GoTrue and Storage answer is proven only by the live run. A
 * second database with the door opened on purpose shows that each check turns red.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { GoTrueAuthProvider } from "@/lib/auth/gotrue";
import { BLOB_BUCKETS, blobPrefix, createSupabaseBlobStore } from "@/lib/blob";
import type { BusEvent } from "@/lib/bus";
import { accountRowKeys } from "@/lib/store/account-rows";
import { createSupabaseBusLog, SupabaseStore, supabaseStoreConfig, type SupabaseConfig } from "@/lib/store/supabase";
import type { SessionRow } from "@/lib/store/types";
import { describeStoreContract, type Created } from "../../contract/store.contract";
import {
  catalogDisagreements,
  CLIENT_ROLES,
  countRows,
  Door,
  probeFunctions,
  probeReads,
  probeWrites,
  readCatalog,
  redact,
  rlsOff,
  rowsLeft,
  rpcArguments,
  said,
  secretsFrom,
  withPolicies,
  type Caller,
  type Catalog,
  type Person,
} from "../../support/db-door";
import { fakePostgrest, type SqlClient } from "../../support/fake-postgrest";
import { labelPng, wavBytes } from "../blob/fixtures";

const LIVE = process.env.STORE_LIVE === "1";
const PGLITE_MODULE = process.env.RIPPLE_PGLITE_MODULE?.trim();
const TIMEOUT = 60_000;
const DOOR_TIMEOUT = 180_000;
const WEB = fileURLToPath(new URL("../../../", import.meta.url));

let cfg: SupabaseConfig | null = null;
if (LIVE) {
  const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  cfg = supabaseStoreConfig();
  if (!cfg) throw new Error("STORE_LIVE=1 needs SUPABASE_URL and SUPABASE_SERVICE_KEY in web/.env");
}

// ---------------------------------------------------------------- the catalog: a floor, never the list

/**
 * The catalog must list at least these: the old hand list plus the three it had left out. (The migration runner's own
 * ledger, schema_migrations, is not part of the floor: it is there only when scripts/db/migrate.mjs made it, and then
 * the catalog lists it and it is probed like every other table.)
 */
const KNOWN_TABLES = [
  "session", "session_member", "visit", "utterance", "visit_item", "medication", "dose_log", "bp_reading", "note",
  "question", "family_grant", "reminder_clip", "safety_event", "eval_run", "profile_fact", "watch_metric",
  "prevent_done", "bus_event", "bus_seq",
  // C2 (0004-0007)
  "account", "account_recovery", "known_device", "reset_request", "account_event", "care_link", "care_grant_history",
  "care_access_log", "service_read_log", "consent_text", "consent_record", "push_subscription", "reminder_delivery",
  "rate_limit", "job_lease", "ops_run", "diet_check", "chat_message", "brief_snapshot",
  // the three the audit found missing (0009, 0012, 0013)
  "translation", "account_session", "understanding_answer",
];
/** ... and at least these among the tables with a session_id column ... */
const KNOWN_SESSION_ID_TABLES = [
  "visit", "utterance", "visit_item", "medication", "dose_log", "bp_reading", "note", "question", "family_grant", "reminder_clip",
  "safety_event", "bus_event", "translation", "account_session", "understanding_answer",
];
/** ... and at least these functions. */
const KNOWN_FUNCTIONS = ["rp_create_session", "rp_reset_session", "rp_log_dose", "rp_set_family_grant", "rp_bus_publish", "rp_create_account_space", "rp_reseed_account", "rp_invite_accept", "rp_rate_hit", "rp_rate_add"];
/** Where A must have rows after the set-up (so there is something to leak), counted with the server's key. */
const A_HAS_ROWS = [
  "session", "visit", "utterance", "visit_item", "medication", "dose_log", "bp_reading", "note", "question", "profile_fact",
  "reminder_clip", "safety_event", "chat_message", "translation", "understanding_answer", "account", "account_session",
  "account_event", "known_device", "consent_record", "care_link", "family_grant", "care_grant_history",
];
/** Where B must have rows of her own. */
const B_HAS_ROWS = ["session", "note", "account", "account_session", "consent_record", "care_link"];

// ---------------------------------------------------------------- the direct connection (the catalog)

type PgClient = SqlClient & { end(): Promise<void> };

/**
 * Catalog queries on the project's own database, through the connection scripts/db/migrate.mjs and
 * check-privileges.mjs use (scripts/db/env.mjs: SUPABASE_DB_URL, never printed). One read-only transaction.
 */
async function liveSql<T>(run: (db: SqlClient) => Promise<T>): Promise<T> {
  if (!(process.env.SUPABASE_DB_URL ?? "").trim()) {
    throw new Error(
      "STORE_LIVE=1 needs SUPABASE_DB_URL in web/.env (the session pooler string scripts/db/migrate.mjs uses): the table and function lists come from the database's own catalog, and there is no hand list to fall back to",
    );
  }
  const env = (await import(/* @vite-ignore */ pathToFileURL(path.join(WEB, "scripts", "db", "env.mjs")).href)) as {
    connect(): Promise<PgClient>;
    safeError(err: unknown): string;
  };
  const client = await env.connect(); // its own errors carry no URL, host, user or password
  try {
    await client.query("begin transaction read only");
    return await run(client);
  } catch (err) {
    throw new Error(`the catalog could not be read: ${redact(env.safeError(err), secretsFrom(process.env))}`);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end().catch(() => {});
  }
}

let liveCatalogOnce: Promise<Catalog> | null = null;
const liveCatalog = (): Promise<Catalog> => (liveCatalogOnce ??= liveSql(readCatalog));

/** The merge gate's own query (scripts/db/check-privileges.mjs): one row per violation, default privileges included. */
async function mergeGateProblems(db: SqlClient): Promise<string[]> {
  const { CHECK_SQL } = (await import(/* @vite-ignore */ pathToFileURL(path.join(WEB, "scripts", "db", "check-privileges.mjs")).href)) as { CHECK_SQL: string };
  const { rows } = await db.query<{ kind: string; name: string; problem: string }>(CHECK_SQL);
  return rows.map((r) => `${r.kind} ${r.name}: ${r.problem}`);
}

// ---------------------------------------------------------------- the store contract and the shared-database checks (live)

/** Auth users this file created (GoTrue admin API); deleting one cascades to its account, scope and care links. */
const authUsers: string[] = [];

function adminHeaders(): Record<string, string> {
  return { apikey: cfg!.serviceKey, authorization: `Bearer ${cfg!.serviceKey}`, "content-type": "application/json" };
}

/** A real auth user, so the account tables' foreign keys to auth.users hold. Its password is random and never kept. */
async function newAuthUserId(): Promise<string> {
  const res = await fetch(`${cfg!.url.replace(/\/+$/, "")}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ email: `contract-${randomUUID().slice(0, 12)}@users.ripple.invalid`, password: randomBytes(24).toString("base64url"), email_confirm: true }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (res.status !== 200 || !body.id) throw new Error(`auth admin: create user answered HTTP ${res.status}`);
  authUsers.push(body.id);
  return body.id;
}

async function deleteAuthUser(id: string): Promise<void> {
  const res = await fetch(`${cfg!.url.replace(/\/+$/, "")}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders() });
  if (res.status !== 200 && res.status !== 404) throw new Error(`auth admin: delete user answered HTTP ${res.status}`);
}

async function cleanup(created: Created): Promise<void> {
  if (!cfg) return;
  const store = new SupabaseStore(cfg);
  for (const id of created.sessions) await store.deleteSession(id);
  for (const id of created.evalRuns) await store.deleteEvalRun(id);
  for (const id of new Set([...authUsers, ...created.users])) await deleteAuthUser(id);
  // every session is gone again
  for (const id of created.sessions) expect(await store.getSession(id)).toBeNull();
}

if (LIVE) {
  describeStoreContract("supabase (live)", {
    create: ({ now }) => new SupabaseStore({ ...cfg!, now }),
    sharedDatabase: true,
    cleanup,
    timeoutMs: TIMEOUT,
    newUserId: newAuthUserId,
  });
}

describe.skipIf(!LIVE)("supabase store, shared-database checks (live, STORE_LIVE=1)", () => {
  const created: Created = { sessions: [], evalRuns: [], users: [] };
  let a: SupabaseStore;
  let b: SupabaseStore;

  beforeAll(() => {
    a = new SupabaseStore(cfg!);
    b = new SupabaseStore(cfg!); // a second adapter = another server instance / process
  });

  afterAll(async () => {
    await cleanup(created);
  }, 120_000);

  it("a session written by one instance is read back by another (restart / second instance)", async () => {
    const s = await a.createSession({ story_day: 15, story_time: "07:40" });
    created.sessions.push(s.id);
    expect(await b.getSession(s.id)).toEqual(s);
    expect(await b.getSessionByJoinCode(s.join_code)).toEqual(s);
    await a.logDose(s.id, { medication_id: "med-amlodipine", day: 15, slot: "morning", state: "taken" });
    expect((await b.listDoses(s.id, { fromDay: 15, toDay: 15 })).find((d) => d.medication_id === "med-amlodipine")!.state).toBe("taken");
  }, TIMEOUT);

  it("concurrent writes from two instances do not lose updates", async () => {
    const s = await a.createSession();
    created.sessions.push(s.id);
    // same (medicine, day, slot) from both at once: still one row
    await Promise.all([
      a.logDose(s.id, { medication_id: "med-losartan", day: 43, slot: "morning", state: "unconfirmed" }),
      b.logDose(s.id, { medication_id: "med-losartan", day: 43, slot: "morning", state: "taken" }),
    ]);
    const rows = (await a.listDoses(s.id, { medication_id: "med-losartan" })).filter((d) => d.day === 43);
    expect(rows).toHaveLength(1);
    // two different switches at once: both kept (atomic merge)
    await Promise.all([a.setFamilyGrant(s.id, "wei-ling", { notes: true }), b.setFamilyGrant(s.id, "wei-ling", { bp_summary: true })]);
    expect((await a.getFamilyGrant(s.id))!.items).toMatchObject({ notes: true, bp_summary: true, dose_summary: true });
  }, TIMEOUT);

  // The publishable key's checks moved to "the database's door" below, where they run over the catalog's lists.

  it("bus log: ids are a per-session sequence without gaps, also with two publishers at once", async () => {
    const s = await a.createSession();
    created.sessions.push(s.id);
    const logA = createSupabaseBusLog(cfg!);
    const logB = createSupabaseBusLog(cfg!);
    expect(await logA.head(s.id)).toBe(0);
    const at = new Date().toISOString();
    const ids = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? logA : logB).append({ type: "dose.logged", session_id: s.id, at, say: `e${i}`, data: { i, zh: "吃了" } }),
      ),
    );
    expect([...ids].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await logB.head(s.id)).toBe(12);
    const all: BusEvent[] = await logB.after(s.id, 0, 200);
    expect(all.map((e) => e.id)).toEqual(ids.slice().sort((x, y) => x - y));
    expect(all[0]).toMatchObject({ session_id: s.id, type: "dose.logged", at });
    expect(all.every((e) => (e.data as { zh: string }).zh === "吃了")).toBe(true);
    expect((await logA.after(s.id, 10, 200)).map((e) => e.id)).toEqual([11, 12]);
    expect((await logA.latest(s.id, 3)).map((e) => e.id)).toEqual([10, 11, 12]);
    await logA.clear(s.id);
    expect(await logA.after(s.id, 0, 200)).toEqual([]);
    expect(await logA.head(s.id)).toBe(12); // ids keep counting after a clear
    expect(await logA.append({ type: "session.reset", session_id: s.id, at, say: "reset", data: null })).toBe(13);
    // an event for a session that does not exist is refused (foreign key), not stored
    await expect(logA.append({ type: "dose.logged", session_id: "no-such-session", at, say: "x", data: null })).rejects.toThrow();
  }, TIMEOUT);

  it("deleting a session leaves no rows behind in any table with a session_id column (the catalog's list)", async () => {
    const catalog = await liveCatalog();
    // a demo session's id is a text id: account_session.session_id is a uuid and the sign-in session's own id, not a scope
    const tables = catalog.tables.filter((t) => t.columns.some((c) => c.name === "session_id" && c.type === "text")).map((t) => t.name);
    const floor = ["session_member", "visit", "utterance", "visit_item", "medication", "dose_log", "bp_reading", "note", "question", "family_grant", "reminder_clip", "safety_event", "bus_event", "bus_seq", "translation", "understanding_answer"];
    expect(floor.filter((t) => !tables.includes(t)), "known tables the catalog did not list").toEqual([]);

    const s = await a.createSession();
    await a.addMember(s.id, { role: "patient" });
    await a.addUtterances(s.id, "v1", [{ t_start_ms: 0, t_end_ms: 1, text: "x" }]);
    await a.addSafetyEvent(s.id, { input: "x", route: "explain" });
    await createSupabaseBusLog(cfg!).append({ type: "dose.logged", session_id: s.id, at: new Date().toISOString(), say: "x", data: null });
    await a.deleteSession(s.id);

    const door = new Door({ url: cfg!.url, secrets: secretsFrom(process.env) });
    const left: string[] = [];
    for (const table of tables) {
      const r = await door.call(`/rest/v1/${table}?select=session_id&session_id=eq.${encodeURIComponent(s.id)}`, { apikey: cfg!.serviceKey, bearer: cfg!.serviceKey });
      if (r.status !== 200 || r.rows !== 0) left.push(`${table}: ${said(r)}`);
    }
    expect(left).toEqual([]);
  }, TIMEOUT);
});

// ---------------------------------------------------------------- the database's door

/** One database the door is tested on: the live project, or PGlite behind the stand-ins. */
interface DoorWorld {
  url: string;
  serviceKey: string;
  anonKey: string;
  /** the stand-ins' fetch; left out: the network */
  fetch?: typeof fetch;
  /** what must never reach a message */
  secrets: string[];
  /** catalog queries on the database's own connection */
  sql<T>(run: (db: SqlClient) => Promise<T>): Promise<T>;
}

interface Party extends Person {
  email: string;
  token: string;
  scope: SessionRow;
}

interface Made {
  label: string;
  id: string;
  email: string;
}

interface Scene {
  w: DoorWorld;
  door: Door;
  store: SupabaseStore;
  auth: GoTrueAuthProvider;
  catalog: Catalog;
  /** a name no real row has: the text arguments of the function calls, the folder of the test's files */
  tag: string;
  server: Caller;
  publishable: Caller;
  a: Party;
  b: Party;
  asA: Caller;
  asB: Caller;
  linkId: string;
  /** A's and B's rows per table, counted with the server's key right after the set-up */
  before: { a: Record<string, number>; b: Record<string, number> };
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The catalog, the two accounts and what they hold. Every account that was made is pushed onto `made` at once, so the
 * clean-up finds it also when a later step fails.
 */
async function openScene(w: DoorWorld, made: Made[]): Promise<Scene> {
  const door = new Door({ url: w.url, fetch: w.fetch, secrets: w.secrets });
  const store = new SupabaseStore({ url: w.url, serviceKey: w.serviceKey, fetch: w.fetch });
  const auth = new GoTrueAuthProvider({ url: w.url, serviceKey: w.serviceKey, anonKey: w.anonKey, fetch: w.fetch });
  const catalog = await w.sql(readCatalog);
  const run = randomUUID().slice(0, 12);
  const tag = `door-${run}`;

  // a username login: the identity service gets <username>@<the internal domain>, an address that never receives mail
  const person = async (label: "A" | "B", space: "example" | "blank"): Promise<Party> => {
    const acct = await createAccountWithSpace(store, auth, {
      login: `live-g-${label.toLowerCase()}-${run}`,
      password: `live ${randomBytes(9).toString("base64url")}`,
      display_name: `Door test ${label}`,
      space,
    });
    made.push({ label, id: acct.userId, email: acct.login.email });
    door.remember(acct.tokens.access_token, acct.tokens.refresh_token, acct.login.email);
    if (!acct.scope) throw new Error(`${label}: the account was made without a space`);
    return { label, id: acct.userId, email: acct.login.email, token: acct.tokens.access_token, scope: acct.scope };
  };
  const a = await person("A", "example");
  const b = await person("B", "blank");

  // A: a row in more tables than the example lays out, the audit's three among them (account_session came with the sign-in)
  const day = a.scope.story_day;
  const med = (await store.listMeds(a.id))[0];
  if (!med) throw new Error("A: the example space has no medicine");
  await store.addNote(a.id, { day, text: "door test", source: "typed" });
  await store.addQuestion(a.id, { for: "doctor", origin: "own", text: "door test" });
  await store.addBp(a.id, { day, slot: "evening", systolic: 128, diastolic: 82 });
  await store.logDose(a.id, { medication_id: med.id, day, slot: "night", state: "taken" });
  await store.putTranslation(a.id, { direction: "en>zh-Hans", source_sha256: sha256(tag), source_text: "door test", text: "door test", status: "checked" });
  await store.setUnderstandingAnswer(a.id, { medication_id: med.id, item: "purpose", answer: "know" });
  await store.addChatMessage(a.id, { day, role: "patient", text: "door test" });
  await store.addSafetyEvent(a.id, { input: "door test", route: "explain" });
  await store.touchKnownDevice(a.id, sha256(`${tag}-device`), "door test");
  await store.addAccountEvent(a.id, "door_test");
  // B: one row of her own in her own space
  await store.addNote(b.id, { day: b.scope.story_day, text: "door test", source: "typed" });

  // B is his daughter, the link is active and every switch is on (8.8: her token still reads none of his rows)
  const tokenHash = sha256(`${tag}-invite`);
  const step = async (what: string, result: Promise<{ ok: true; link: { id: string } } | { ok: false; code: string }>): Promise<string> => {
    const r = await result;
    if (!r.ok) throw new Error(`the care link: ${what} answered ${r.code}`);
    return r.link.id;
  };
  const linkId = await step("invite", store.createInvite({ patient_id: a.id, relation: "daughter", family_label: "Door test B", invite_token_hash: tokenHash, invite_expires_at: new Date(Date.now() + 3_600_000).toISOString() }));
  await step("accept", store.acceptInvite(tokenHash, b.id, "Door test B"));
  await step("confirm", store.confirmLink(linkId, a.id, true));
  await store.setFamilyGrant(a.id, linkId, { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true });

  const server: Caller = { label: "the server's key", apikey: w.serviceKey, bearer: w.serviceKey };
  const publishable: Caller = { label: "the publishable key", apikey: w.anonKey, bearer: w.anonKey };
  const asA: Caller = { label: "A", apikey: w.anonKey, bearer: a.token };
  const asB: Caller = { label: "B", apikey: w.anonKey, bearer: b.token };
  const before = { a: (await countRows(door, catalog.tables, server, a)).counts, b: (await countRows(door, catalog.tables, server, b)).counts };
  return { w, door, store, auth, catalog, tag, server, publishable, a, b, asA, asB, linkId, before };
}

/**
 * Delete every account that was made and say what is left: [] when A, B and everything of theirs are gone. Safe to
 * run twice. The sentences name tables, columns and counts only.
 */
async function closeScene(w: DoorWorld, made: readonly Made[], opts: { storage: boolean; tag?: string }): Promise<string[]> {
  const left: string[] = [];
  if (!made.length) return left;
  const store = new SupabaseStore({ url: w.url, serviceKey: w.serviceKey, fetch: w.fetch });
  const auth = new GoTrueAuthProvider({ url: w.url, serviceKey: w.serviceKey, anonKey: w.anonKey, fetch: w.fetch });
  const door = new Door({ url: w.url, fetch: w.fetch, secrets: w.secrets });
  const server = { apikey: w.serviceKey, bearer: w.serviceKey };
  if (opts.storage) {
    const blob = createSupabaseBlobStore({ url: w.url, serviceKey: w.serviceKey });
    for (const m of made) {
      for (const bucket of BLOB_BUCKETS) {
        await blob.removePrefix(bucket, blobPrefix({ id: m.id, kind: "account" })).catch(() => left.push(`${m.label}: the files in ${bucket} could not be removed`));
      }
    }
  }
  for (const m of made) {
    await store.deleteAccount(m.id).catch(() => left.push(`${m.label}: the account's rows could not be deleted`));
    await auth.deleteUser(m.id).catch(() => left.push(`${m.label}: the identity could not be deleted`));
  }
  // rows an open door could have let a function call make outside any account (named after this run's tag)
  if (opts.tag) {
    await door.call(`/rest/v1/rate_limit?bucket=eq.${encodeURIComponent(opts.tag)}`, { ...server, method: "DELETE" });
    await door.call(`/rest/v1/job_lease?name=eq.${encodeURIComponent(opts.tag)}`, { ...server, method: "DELETE" });
  }
  // gone: the app's own check, the identity, and every id column of the catalog asked from the database itself
  const catalog = await w.sql(readCatalog);
  for (const m of made) {
    if ((await store.getAccount(m.id)) !== null) left.push(`${m.label}: the account row is still there`);
    if ((await store.getSession(m.id)) !== null) left.push(`${m.label}: the space is still there`);
    for (const [key, n] of Object.entries(await store.countAccountRows(m.id))) left.push(`${m.label}: ${key} still has ${n} row(s)`);
    if ((await auth.findUserIdByEmail(m.email)) !== null) left.push(`${m.label}: the identity is still there`);
    for (const row of await w.sql((db) => rowsLeft(db, catalog.tables, m.id))) left.push(`${m.label}: ${row}`);
  }
  return [...new Set(left)];
}

/** The door's checks, the same on the live project and on PGlite behind the stand-ins. */
function describeDoor(title: string, opts: { skip: boolean; world: () => Promise<DoorWorld>; storage: boolean; timeout: number }): void {
  describe.skipIf(opts.skip)(title, () => {
    const T = opts.timeout;
    const made: Made[] = [];
    let w: DoorWorld | null = null;
    let s: Scene;
    let cleaned = false;

    beforeAll(async () => {
      w = await opts.world();
      s = await openScene(w, made);
    }, T * 2);

    afterAll(async () => {
      if (cleaned || !w) return;
      const left = await closeScene(w, made, { storage: opts.storage, tag: s?.tag });
      if (left.length) throw new Error(`the door test left something behind: ${left.join("; ")}`);
    }, T * 2);

    /** A's and B's rows, counted again with the server's key: what they were after the set-up. */
    async function nothingChanged(): Promise<void> {
      const a = await countRows(s.door, s.catalog.tables, s.server, s.a);
      const b = await countRows(s.door, s.catalog.tables, s.server, s.b);
      expect([...a.findings, ...b.findings]).toEqual([]);
      expect(a.counts, "A's rows per table").toEqual(s.before.a);
      expect(b.counts, "B's rows per table").toEqual(s.before.b);
    }

    it("the lists come from the database's catalog and hold at least the known tables and functions", () => {
      const tables = s.catalog.tables.map((t) => t.name);
      const functions = s.catalog.functions.map((f) => f.name);
      expect(KNOWN_TABLES.filter((t) => !tables.includes(t)), "known tables the catalog did not list").toEqual([]);
      expect(KNOWN_SESSION_ID_TABLES.filter((t) => !s.catalog.sessionIdTables.includes(t)), "known session_id tables the catalog did not list").toEqual([]);
      expect(KNOWN_FUNCTIONS.filter((f) => !functions.includes(f)), "known functions the catalog did not list").toEqual([]);
      expect(catalogDisagreements(s.catalog), "information_schema.tables and pg_class disagree").toEqual([]);
      // every column the app itself counts as naming a person (lib/store/account-rows.ts) is an id column here
      const idColumns = new Set(s.catalog.tables.flatMap((t) => t.idColumns.map((c) => `${t.name}.${c}`)));
      expect(accountRowKeys().filter((k) => !idColumns.has(k)), "the app's person columns the catalog rule did not find").toEqual([]);
      // every function PostgREST serves can be called by name: each input parameter has one
      expect(s.catalog.functions.filter((f) => f.callable && Object.keys(rpcArguments(f, s.a.id, s.tag)).length !== f.args.filter((x) => ["i", "b", "v"].includes(x.mode)).length).map((f) => f.signature)).toEqual([]);
    });

    it("every table has row level security on and no policy; anon and authenticated may use no table, column, sequence or function", async () => {
      expect(s.catalog.clientRoles, "the roles the privilege list is about").toEqual([...CLIENT_ROLES]);
      expect(rlsOff(s.catalog), "tables with row level security off").toEqual([]);
      expect(withPolicies(s.catalog), "tables with a policy (the recorded decision has none)").toEqual([]);
      expect(s.catalog.open, "what anon or authenticated may use").toEqual([]);
      expect(await w!.sql(mergeGateProblems), "scripts/db/check-privileges.mjs on this database").toEqual([]);
    }, T);

    it("control: the server's key reads A's and B's rows through the same paths and filters", async () => {
      const a = await countRows(s.door, s.catalog.tables, s.server, s.a);
      const b = await countRows(s.door, s.catalog.tables, s.server, s.b);
      expect([...a.findings, ...b.findings]).toEqual([]);
      expect(A_HAS_ROWS.filter((t) => !(a.counts[t] > 0)), "tables where A should have rows").toEqual([]);
      expect(B_HAS_ROWS.filter((t) => !(b.counts[t] > 0)), "tables where B should have rows").toEqual([]);
      // every table with a session_id column was counted
      expect(s.catalog.sessionIdTables.filter((t) => a.counts[t] === undefined)).toEqual([]);
    }, T);

    it("B, his daughter with every switch on, reads no row with her own token: every table, whole and filtered on his id and on her own", async () => {
      const r = await probeReads(s.door, s.catalog.tables, s.asB, [s.a, s.b]);
      expect(r.findings).toEqual([]);
      expect(r.refused + r.empty).toBe(r.asked);
      expect(r.asked).toBeGreaterThanOrEqual(s.catalog.tables.length + 2 * s.catalog.sessionIdTables.length);
    }, T);

    it("B writes nothing: no insert as him or as herself, no update and no delete of his rows or her own", async () => {
      const onHim = await probeWrites(s.door, s.catalog.tables, s.asB, s.a, s.tag);
      const onHerself = await probeWrites(s.door, s.catalog.tables, s.asB, s.b, s.tag);
      expect([...onHim.findings, ...onHerself.findings]).toEqual([]);
      expect(onHim.refused).toBe(onHim.asked);
      expect(onHim.asked).toBeGreaterThanOrEqual(3 * s.catalog.sessionIdTables.length);
      await nothingChanged();
    }, T);

    it("B calls no function: each one without arguments, and with his id in every parameter that takes an id", async () => {
      const r = await probeFunctions(s.door, s.catalog.functions, s.asB, s.a, s.tag);
      expect(r.findings).toEqual([]);
      expect(r.refused).toBe(r.asked);
      expect(r.asked).toBeGreaterThanOrEqual(s.catalog.functions.length + s.catalog.functions.filter((f) => f.callable).length);
      await nothingChanged();
    }, T);

    it("A reads, writes and calls nothing with his own token either, not even his own rows (the recorded decision, stricter than the design's 'select own')", async () => {
      const reads = await probeReads(s.door, s.catalog.tables, s.asA, [s.a]);
      const writes = await probeWrites(s.door, s.catalog.tables, s.asA, s.a, s.tag);
      const calls = await probeFunctions(s.door, s.catalog.functions, s.asA, s.a, s.tag);
      expect([...reads.findings, ...writes.findings, ...calls.findings]).toEqual([]);
      expect(reads.refused + reads.empty).toBe(reads.asked);
      await nothingChanged();
    }, T);

    it("the publishable key alone, without a token: nothing readable, writable or callable; a wrong key is refused", async () => {
      const reads = await probeReads(s.door, s.catalog.tables, s.publishable, [s.a, s.b]);
      const bare = await probeReads(s.door, s.catalog.tables, { label: "the publishable key (apikey header only)", apikey: w!.anonKey }, [s.a]);
      const writes = await probeWrites(s.door, s.catalog.tables, s.publishable, s.a, s.tag);
      const calls = await probeFunctions(s.door, s.catalog.functions, s.publishable, s.a, s.tag);
      expect([...reads.findings, ...bare.findings, ...writes.findings, ...calls.findings]).toEqual([]);
      expect(reads.refused + reads.empty).toBe(reads.asked);
      const wrong = await s.door.call("/rest/v1/session?select=id&limit=1", { apikey: "not-a-key", bearer: "not-a-key" });
      expect([401, 403], "a wrong key").toContain(wrong.status);
      await nothingChanged();
    }, T);

    it("after he stops sharing, B still reads no row of his (8.8: the same before and after)", async () => {
      const revoked = await s.store.revokeLink(s.linkId, s.a.id, "patient");
      expect(revoked.ok).toBe(true);
      const r = await probeReads(s.door, s.catalog.tables, s.asB, [s.a]);
      expect(r.findings).toEqual([]);
      expect(r.refused + r.empty).toBe(r.asked);
    }, T);

    it.skipIf(!opts.storage)("the two buckets: with B's token, A's own token or the publishable key, nothing is listed, read, signed, written or removed (line 726)", async () => {
      const blob = createSupabaseBlobStore({ url: w!.url, serviceKey: w!.serviceKey });
      const folderA = `${blobPrefix(s.a.scope)}/${s.tag}`;
      const folderB = `${blobPrefix(s.b.scope)}/${s.tag}`;
      const files = { audio: { path: `${folderA}/a.wav`, bytes: wavBytes(), type: "audio/wav", ext: "wav" }, labels: { path: `${folderA}/p.png`, bytes: labelPng(), type: "image/png", ext: "png" } };
      for (const bucket of BLOB_BUCKETS) await blob.putObject(bucket, files[bucket].path, files[bucket].bytes, files[bucket].type);

      const findings: string[] = [];
      const ok = (status: number) => status >= 200 && status < 300;
      for (const who of [s.asB, s.asA, s.publishable]) {
        const creds = { apikey: who.apikey, bearer: who.bearer };
        // the buckets themselves are not listed
        const buckets = await s.door.call("/storage/v1/bucket", creds);
        if (buckets.status === 0 || (ok(buckets.status) && buckets.rows !== 0)) findings.push(`${who.label} list the buckets: ${buckets.status === 0 ? "no response" : `HTTP ${buckets.status}, ${buckets.rows ?? "?"} bucket(s)`}`);
        for (const bucket of BLOB_BUCKETS) {
          const file = files[bucket];
          // read: the three addresses an object has
          for (const kind of ["object", "object/authenticated", "object/public"]) {
            const r = await s.door.call(`/storage/v1/${kind}/${bucket}/${file.path}`, creds);
            if (r.status === 0 || ok(r.status)) findings.push(`${who.label} read A's file in ${bucket} (${kind}): ${r.status === 0 ? "no response" : `HTTP ${r.status}`}`);
          }
          // list: the top of the bucket, A's folder, the folder of the file. Storage answers 200 with [] when the caller may see nothing
          for (const [what, prefix] of [["the top", ""], ["A's folder", `${blobPrefix(s.a.scope)}/`], ["the file's folder", `${folderA}/`]] as const) {
            const r = await s.door.call(`/storage/v1/object/list/${bucket}`, { ...creds, method: "POST", body: { prefix, limit: 100, offset: 0 } });
            if (r.status === 0 || (ok(r.status) && r.rows !== 0)) findings.push(`${who.label} list ${what} of ${bucket}: ${r.status === 0 ? "no response" : `HTTP ${r.status}, ${r.rows ?? "?"} entr(ies)`}`);
          }
          // sign: no read link of her own making
          const signed = await s.door.call(`/storage/v1/object/sign/${bucket}/${file.path}`, { ...creds, method: "POST", body: { expiresIn: 60 } });
          if (signed.status === 0 || ok(signed.status)) findings.push(`${who.label} sign a link to A's file in ${bucket}: ${signed.status === 0 ? "no response" : `HTTP ${signed.status}`}`);
          // write: into A's folder and into B's own
          for (const [whose, folder] of [["A's", folderA], ["B's", folderB]] as const) {
            const target = `${folder}/by-${who === s.asB ? "b" : who === s.asA ? "a" : "nobody"}.${file.ext}`;
            const r = await s.door.call(`/storage/v1/object/${bucket}/${target}`, { ...creds, method: "POST", bytes: file.bytes, contentType: file.type });
            if (r.status === 0 || ok(r.status)) findings.push(`${who.label} write into ${whose} folder in ${bucket}: ${r.status === 0 ? "no response" : `HTTP ${r.status}`}`);
            if ((await blob.getObject(bucket, target)) !== null) findings.push(`${who.label} write into ${whose} folder in ${bucket}: the file is there`);
          }
          // remove: whatever the answer, A's file is still there
          await s.door.call(`/storage/v1/object/${bucket}`, { ...creds, method: "DELETE", body: { prefixes: [file.path] } });
          if ((await blob.getObject(bucket, file.path)) === null) findings.push(`${who.label} remove A's file in ${bucket}: the file is gone`);
        }
      }
      expect(findings).toEqual([]);
    }, T);

    it("clean-up: A, B and everything made for them are deleted, and nothing of theirs is left (line 1372)", async () => {
      expect(made.map((m) => m.label)).toEqual(["A", "B"]);
      // the question "what is left" finds them while they are there, so [] afterwards means gone
      for (const who of [s.a, s.b]) {
        const there = await w!.sql((db) => rowsLeft(db, s.catalog.tables, who.id));
        expect(there, `${who.label} before the clean-up`).toEqual(expect.arrayContaining(["auth.users: 1", "account.user_id: 1", "session.id: 1"]));
      }
      const left = await closeScene(w!, made, { storage: opts.storage, tag: s.tag });
      expect(left).toEqual([]);
      cleaned = true;
    }, T * 2);
  });
}

async function liveWorld(): Promise<DoorWorld> {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? "").trim();
  const missing = [
    ["SUPABASE_URL", url],
    ["SUPABASE_SERVICE_KEY", serviceKey],
    ["SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_DB_URL", (process.env.SUPABASE_DB_URL ?? "").trim()],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`STORE_LIVE=1: the door test needs ${missing.join(", ")} in web/.env`);
  return { url, serviceKey, anonKey, secrets: secretsFrom(process.env), sql: liveSql };
}

describeDoor("the database's door: a person's own token and the publishable key get nothing (live, STORE_LIVE=1)", { skip: !LIVE, world: liveWorld, storage: true, timeout: DOOR_TIMEOUT });

// ---------------------------------------------------------------- offline: the same checks on PGlite with the migrations applied

type PgliteLike = SqlClient & { exec(sql: string): Promise<unknown>; transaction<T>(run: (tx: SqlClient) => Promise<T>): Promise<T> };

/** The database tests/unit/store/pglite.contract.test.ts builds: Supabase's roles, auth.users and default grants stood in for, every migration applied. */
async function pgliteDatabase(): Promise<PgliteLike> {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(PGLITE_MODULE!).href)) as { PGlite: new () => PgliteLike };
  const db = new mod.PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(WEB, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    await db.exec("begin");
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await db.exec("commit");
  }
  return db;
}

/**
 * Supabase's front, stood in for over one PGlite database:
 *   /rest/v1   tests/support/fake-postgrest.ts, run under the role the request's token gives it, as PostgREST does: the
 *              server's key runs as the contract test runs it, the publishable key as anon, a token the password grant
 *              issued as authenticated (set local role, one transaction per statement). A key it does not know is 401.
 *              Where PostgreSQL says "no function with these arguments" (42883) PostgREST answers 404 PGRST202.
 *   /auth/v1   the four GoTrue calls the set-up makes: create a user, the password grant, find by address, delete.
 * It has no Storage. The keys and tokens are made here and open nothing anywhere else.
 */
function pgliteWorld(db: PgliteLike): DoorWorld {
  const url = "http://pglite.test";
  const serviceKey = `stand-in-server-key-${randomUUID()}`;
  const anonKey = `stand-in-publishable-key-${randomUUID()}`;
  const users = new Map<string, { id: string; password: string }>(); // by address
  const tokens = new Map<string, string>(); // access token -> user id
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = (userId: string) => `${part({ alg: "ES256", typ: "JWT" })}.${part({ sub: userId, session_id: randomUUID(), role: "authenticated" })}.${randomBytes(24).toString("base64url")}`;

  const under = (role: "anon" | "authenticated"): SqlClient => ({
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      db.transaction(async (tx) => {
        await tx.query(`set local role ${role}`);
        return tx.query<T>(sql, params);
      }),
  });
  const rest = { server: fakePostgrest(db), anon: fakePostgrest(under("anon")), authenticated: fakePostgrest(under("authenticated")) };

  async function goTrue(u: URL, init?: RequestInit): Promise<Response> {
    const route = u.pathname.slice("/auth/v1/".length);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = (typeof init?.body === "string" && init.body ? JSON.parse(init.body) : {}) as { email?: string; password?: string; app_metadata?: unknown };
    if (route === "admin/users" && method === "POST") {
      const id = randomUUID();
      await db.query("insert into auth.users (id, email) values ($1::uuid, $2)", [id, body.email]);
      users.set(String(body.email), { id, password: String(body.password) });
      return json(200, { id, email: body.email, app_metadata: body.app_metadata ?? {} });
    }
    if (route === "admin/users" && method === "GET") {
      const filter = u.searchParams.get("filter") ?? "";
      return json(200, { users: [...users].filter(([email]) => email.includes(filter)).map(([email, user]) => ({ id: user.id, email })) });
    }
    if (route.startsWith("admin/users/") && method === "DELETE") {
      const id = route.slice("admin/users/".length);
      const hit = [...users].find(([, user]) => user.id === id);
      if (!hit) return json(404, { error_code: "user_not_found" });
      users.delete(hit[0]);
      await db.query("delete from auth.users where id = $1::uuid", [id]);
      return json(200, {});
    }
    if (route === "token" && u.searchParams.get("grant_type") === "password") {
      const user = users.get(String(body.email));
      if (!user || user.password !== body.password) return json(400, { error_code: "invalid_credentials" });
      const access = accessToken(user.id);
      tokens.set(access, user.id);
      return json(200, { access_token: access, refresh_token: randomBytes(9).toString("base64url"), expires_in: 3600, expires_at: 2_000_000_000, user: { id: user.id } });
    }
    if (route === "logout") return new Response(null, { status: 204 });
    return json(404, { error_code: "not_stood_in" });
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    if (u.pathname.startsWith("/auth/v1/")) return goTrue(u, init);
    if (!u.pathname.startsWith("/rest/v1/")) return json(404, { error: "not_stood_in" });
    const apikey = headers.get("apikey") ?? "";
    const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (apikey !== serviceKey && apikey !== anonKey) return json(401, { message: "Invalid API key" });
    const key = bearer || apikey;
    const door = key === serviceKey ? rest.server : key === anonKey ? rest.anon : tokens.has(key) ? rest.authenticated : null;
    if (!door) return json(401, { code: "PGRST301", message: "the token is not one this stand-in issued" });
    const res = await door(input, init);
    if (res.status === 500) {
      const problem = (await res.clone().json().catch(() => null)) as { code?: string } | null;
      if (problem?.code === "42883") return json(404, { code: "PGRST202", message: "no function with these argument names" });
    }
    return res;
  }) as typeof fetch;

  return { url, serviceKey, anonKey, fetch: fetchImpl, secrets: [serviceKey, anonKey], sql: (run) => run(db) };
}

if (PGLITE_MODULE) {
  describeDoor("the database's door on PGlite with every migration applied (offline; the stand-ins run each request under its role)", {
    skip: false,
    world: async () => pgliteWorld(await pgliteDatabase()),
    storage: false,
    timeout: 120_000,
  });

  /**
   * The positive control: a second database with the door opened in the six ways a later migration could open it.
   * Each check must name exactly what was opened, or it could not be trusted when it is green. It also shows what
   * each layer can see: a request tells rows, writes and a function that did its work; only the catalog tells a
   * privilege that row level security or the function's own tables still stop (4, 5, 6).
   */
  describe("the door checks turn red on a database with the door opened on purpose (PGlite)", () => {
    const made: Made[] = [];
    let w: DoorWorld | null = null;
    let s: Scene;

    beforeAll(async () => {
      const db = await pgliteDatabase();
      await db.exec(`
        -- 1. a policy that lets every signed-in person read every note
        grant select on public.note to authenticated;
        create policy door_open_note on public.note for select to authenticated using (true);
        -- 2. a table with row level security switched off and the grants Supabase hands out by default
        alter table public.dose_log disable row level security;
        grant all on public.dose_log to authenticated;
        -- 3. a function a signed-in person may call, running with its owner's rights (the design's own idea for a
        --    family summary, line 705): it does its work
        alter function public.rp_rate_hit(text, integer, integer, timestamptz) security definer;
        grant execute on function public.rp_rate_hit(text, integer, integer, timestamptz) to authenticated;
        -- 4. a function a signed-in person may call, running with the caller's rights: it starts and stops at its table
        grant execute on function public.rp_job_release(text, text) to authenticated;
        -- 5. a privilege without a policy: no row comes out, and the decision is broken all the same
        grant select on public.bp_reading to anon;
        -- 6. a grant on one column only
        grant select (tz) on public.session to authenticated;
      `);
      w = pgliteWorld(db);
      s = await openScene(w, made);
    }, 240_000);

    afterAll(async () => {
      if (w) await closeScene(w, made, { storage: false, tag: s?.tag });
    }, 240_000);

    it("the catalog names the policy, the table without row level security and every privilege that was granted", async () => {
      expect(rlsOff(s.catalog)).toEqual(["dose_log"]);
      expect(withPolicies(s.catalog)).toEqual(["note: 1"]);
      expect(s.catalog.open).toEqual([
        "column of table session: authenticated has SELECT",
        "function rp_job_release(p_name text, p_holder text): authenticated has EXECUTE",
        "function rp_rate_hit(p_bucket text, p_window_s integer, p_limit integer, p_now timestamp with time zone): authenticated has EXECUTE",
        "table bp_reading: anon has SELECT",
        "table dose_log: authenticated has DELETE",
        "table dose_log: authenticated has INSERT",
        "table dose_log: authenticated has REFERENCES",
        "table dose_log: authenticated has SELECT",
        "table dose_log: authenticated has TRIGGER",
        "table dose_log: authenticated has TRUNCATE",
        "table dose_log: authenticated has UPDATE",
        "table note: authenticated has SELECT",
      ]);
      const gate = await w!.sql(mergeGateProblems);
      expect(gate).toContain("table dose_log: row level security is off");
      expect(gate).toContain("table note: 1 policy");
    });

    it("B's reads name the two tables that give rows, with how many; a privilege without a policy gives none", async () => {
      const r = await probeReads(s.door, s.catalog.tables, s.asB, [s.a, s.b]);
      expect(r.findings).toEqual([
        "B read dose_log: HTTP 200, 5 row(s)",
        "B read dose_log where session_id = A: HTTP 200, 5 row(s)",
        "B read note: HTTP 200, 4 row(s)",
        "B read note where session_id = A: HTTP 200, 3 row(s)",
        "B read note where session_id = B: HTTP 200, 1 row(s)",
      ]);
      expect(r.refused + r.empty).toBe(r.asked - 5);
      // bp_reading: anon may select, row level security lets no row out. The read is clean; the catalog check is what names it.
      expect((await probeReads(s.door, s.catalog.tables, s.publishable, [s.a])).findings).toEqual([]);
    });

    it("B's call of the function that did its work is named, and the row it made outside any account is found by its tag", async () => {
      const r = await probeFunctions(s.door, s.catalog.functions, s.asB, s.a, s.tag);
      // rp_job_release answers 403 like a function she may not call: it started and was refused at its table. The catalog names it.
      expect(r.findings).toEqual(["B call rp_rate_hit with A's id: HTTP 200"]);
      expect(r.refused).toBe(r.asked - 1);
      const made = await s.door.call(`/rest/v1/rate_limit?select=bucket&bucket=eq.${s.tag}`, { apikey: s.server.apikey, bearer: s.server.bearer });
      expect([made.status, made.rows]).toEqual([200, 1]);
    });

    it("B's writes to the open table are named (a constraint stopping one row is not a refusal), and A's rows are seen to be gone", async () => {
      const r = await probeWrites(s.door, s.catalog.tables, s.asB, s.a, s.tag);
      // the insert got as far as the not-null check; PostgreSQL's own sentence follows the code and is not pinned
      expect(r.findings.map((f) => f.replace(/ \(.*\)$/, ""))).toEqual([
        "B insert into dose_log with session_id = A: HTTP 400 23502",
        "B update dose_log where session_id = A: HTTP 200, 34 row(s)",
        "B delete from dose_log where session_id = A: HTTP 200, 34 row(s)",
      ]);
      expect(r.findings[0]).toMatch(/23502 \(.+\)$/);
      const after = (await countRows(s.door, s.catalog.tables, s.server, s.a)).counts;
      expect(s.before.a.dose_log).toBe(34);
      expect(after.dose_log).toBe(0);
      expect({ ...after, dose_log: 34 }).toEqual(s.before.a);
    });

    it("the clean-up still leaves nothing behind", async () => {
      expect(await closeScene(w!, made, { storage: false, tag: s.tag })).toEqual([]);
      const junk = await s.door.call(`/rest/v1/rate_limit?select=bucket&bucket=eq.${s.tag}`, { apikey: s.server.apikey, bearer: s.server.bearer });
      expect([junk.status, junk.rows]).toEqual([200, 0]);
    });
  });
} else {
  describe.skip("the database's door on PGlite (set RIPPLE_PGLITE_MODULE to run it)", () => {
    it("skipped", () => {});
  });
}

// ---------------------------------------------------------------- always: nothing secret in a message

describe("the door tests print nothing secret (tests/support/db-door.ts)", () => {
  // look-alikes only, put together here so that no key-shaped text stands in this file
  const jwt = ["ey", "JhbGciOiJFUzI1NiIsImtpZCI6ImZha2UifQ", ".", "ey", "Jzdwi0iJmYWtlLXVzZXIiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9", ".", "c2lnbmF0dXJlLW5vdC1yZWFs"].join("");
  const serviceKey = ["sb", "secret", "Zm9yLXRoZS1yZWRhY3QtdGVzdA"].join("_");
  const anonKey = ["sb", "publishable", "bm90LWEtcmVhbC1rZXk"].join("_");
  const legacyKey = ["ey", "JhbGciOiJIUzI1NiJ9", ".", "ey", "Jyb2xlIjoic2VydmljZV9yb2xlIn0", ".", "bGVnYWN5LXNpZ25hdHVyZQ"].join("");
  const dbPassword = "p%40ss-w0rd-Zx9";
  const dbUrl = `${["postgres", "ql"].join("")}://postgres.abcdefghijklmnopqrst:${dbPassword}@aws-0-ap-southeast-1.pooler.example.test:5432/postgres`;
  const projectUrl = "https://abcdefghijklmnopqrst.example.test";
  const email = "live-g-a-0123abcd-456@users.ripple.invalid";
  const refresh = "r3fr3sh-t0k3n";
  const env = { SUPABASE_URL: `${projectUrl}/`, SUPABASE_SERVICE_KEY: serviceKey, SUPABASE_ANON_KEY: anonKey, SUPABASE_DB_URL: dbUrl };
  const all = [jwt, serviceKey, anonKey, legacyKey, dbUrl, dbPassword, decodeURIComponent(dbPassword), "postgres.abcdefghijklmnopqrst", "aws-0-ap-southeast-1.pooler.example.test", projectUrl, "abcdefghijklmnopqrst.example.test", email, refresh];

  it("redact replaces keys, tokens, the database URL and its parts, the project URL and addresses, and keeps the rest", () => {
    const body = JSON.stringify({
      code: "42501",
      message: `permission denied for table note; apikey ${anonKey}; Authorization: Bearer ${jwt}; server ${serviceKey} / ${legacyKey}`,
      hint: `connect ${dbUrl} (password ${decodeURIComponent(dbPassword)}) at ${projectUrl}/rest/v1/note for ${email}, refresh ${refresh}`,
    });
    const out = redact(body, [...secretsFrom(env), refresh]);
    for (const secret of all) expect(out.includes(secret), "a secret survived").toBe(false);
    expect(out).toContain("42501");
    expect(out).toContain("permission denied for table note");
    expect(out).toContain("/rest/v1/note");
    // without knowing any value: the shapes alone are enough for a token, a key, a database URL and an address
    const blind = redact(`a ${jwt} b ${serviceKey} c ${anonKey} d ${dbUrl} e ${email} f Bearer ${refresh}xyz g`);
    for (const secret of [jwt, serviceKey, anonKey, dbUrl, dbPassword, email, `${refresh}xyz`]) expect(blind.includes(secret), "a secret-shaped value survived").toBe(false);
    expect(blind).toBe("a <redacted-jwt> b <redacted-key> c <redacted-key> d <redacted-db-url> e <redacted-email> f Bearer <redacted> g");
    // values that are not text, and nothing to do
    expect(redact({ token: jwt, n: 1 })).toBe('{"token":"<redacted-jwt>","n":1}');
    expect(redact(undefined)).toBe("");
    expect(redact("HTTP 403 42501, 0 row(s)")).toBe("HTTP 403 42501, 0 row(s)");
  });

  it("secretsFrom names the keys, the database URL and its password, user and host, and the project URL and host", () => {
    const secrets = secretsFrom(env);
    for (const s of [serviceKey, anonKey, dbUrl, dbPassword, decodeURIComponent(dbPassword), "postgres.abcdefghijklmnopqrst", "aws-0-ap-southeast-1.pooler.example.test", projectUrl, "abcdefghijklmnopqrst.example.test"]) {
      expect(secrets.includes(s), "a value is missing from the list").toBe(true);
    }
    expect(secretsFrom({})).toEqual([]);
  });

  it("a Door answer is a status, a short code, a row count and an error's redacted message: never the body, a header or the URL", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const echo = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), headers });
      if (String(input).includes("/boom")) throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND abcdefghijklmnopqrst.example.test (${headers.get("authorization")})`);
      if (String(input).includes("/busy")) return new Response("upstream", { status: 503 });
      if (String(input).includes("/rows")) return new Response(JSON.stringify([{ session_id: "s-1", note: email }, { session_id: "s-2", token: headers.get("authorization") }]), { status: 200 });
      // an error body that repeats everything the request carried, as a careless upstream might
      return new Response(
        JSON.stringify({
          code: "42501",
          message: `permission denied for table note: ${headers.get("apikey")} / ${headers.get("authorization")} at ${String(input)} for ${email}`,
          details: `Failing row contains (${email}, ${dbUrl})`,
          hint: dbUrl,
        }),
        { status: 403 },
      );
    }) as typeof fetch;
    const door = new Door({ url: `${projectUrl}/`, fetch: echo, secrets: secretsFrom(env) });
    door.remember(refresh);

    const denied = await door.call("/rest/v1/note?select=*", { apikey: anonKey, bearer: jwt });
    // the request itself carries the credentials, and only the request
    expect(seen[0].url).toBe(`${projectUrl}/rest/v1/note?select=*`);
    expect(seen[0].headers.get("apikey")).toBe(anonKey);
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(Object.keys(denied).sort()).toEqual(["code", "message", "rows", "status"]);
    expect([denied.status, denied.code, denied.rows]).toEqual([403, "42501", null]);
    expect(denied.message).toBe("permission denied for table note: <redacted> / Bearer <redacted> at <redacted>/rest/v1/note?select=* for <redacted-email>");
    expect(said(denied)).toBe(`HTTP 403 42501 (${denied.message})`);
    for (const secret of all) expect(JSON.stringify(denied).includes(secret), "a secret survived in the answer").toBe(false);

    // a token that was only ever sent as a credential is redacted too, whatever it looks like
    const odd = await door.call("/rest/v1/note", { apikey: anonKey, bearer: "opaque-token-0001" });
    expect(odd.message.includes("opaque-token-0001")).toBe(false);
    expect(odd.message).toContain("permission denied for table note");

    // rows are counted, never handed out
    const rows = await door.call("/rows", { apikey: anonKey, bearer: jwt });
    expect(rows).toEqual({ status: 200, code: "", rows: 2, message: "" });
    expect(said(rows)).toBe("HTTP 200, 2 row(s)");

    // a long message is cut, a busy gateway and a dead connection are asked once more and then reported without the host
    const long = await new Door({ url: projectUrl, fetch: (async () => new Response(JSON.stringify({ code: "XX000", message: "x".repeat(400) }), { status: 500 })) as typeof fetch }).call("/rest/v1/note");
    expect(long.message).toBe(`${"x".repeat(140)}...`);
    const before = seen.length;
    const busy = await door.call("/busy", { apikey: anonKey });
    expect(busy).toEqual({ status: 503, code: "", rows: null, message: "" });
    const failed = await door.call("/boom", { apikey: anonKey, bearer: jwt });
    expect(failed).toEqual({ status: 0, code: "network", rows: null, message: "" });
    expect(said(failed)).toBe("no response");
    expect(seen.length - before).toBe(4);
  });

  it("the live run does not start without its variables and names the missing ones (there is no hand list to fall back to)", async () => {
    const names = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL"];
    const kept = names.map((name) => [name, process.env[name]] as const);
    try {
      for (const name of names) delete process.env[name];
      await expect(liveWorld()).rejects.toThrow("STORE_LIVE=1: the door test needs SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, SUPABASE_DB_URL in web/.env");
      process.env.SUPABASE_URL = projectUrl;
      process.env.SUPABASE_SERVICE_KEY = serviceKey;
      process.env.SUPABASE_ANON_KEY = anonKey;
      await expect(liveWorld()).rejects.toThrow("STORE_LIVE=1: the door test needs SUPABASE_DB_URL in web/.env");
      // the catalog reader itself stops before it opens anything
      await expect(liveSql(async () => "not reached")).rejects.toThrow(/^STORE_LIVE=1 needs SUPABASE_DB_URL in web\/\.env/);
    } finally {
      for (const [name, value] of kept) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("the argument object of a function call comes from the catalog's parameter names and types", () => {
    const fn = {
      name: "rp_example",
      signature: "rp_example(...)",
      returns: "jsonb",
      kind: "f",
      callable: true,
      args: [
        { name: "p_session_id", type: "text", mode: "i" },
        { name: "p_scope_id", type: "text", mode: "i" },
        { name: "p_user_id", type: "uuid", mode: "i" },
        { name: "p_patient_id", type: "uuid", mode: "i" },
        { name: "p_member", type: "text", mode: "i" },
        { name: "p_items", type: "jsonb", mode: "i" },
        { name: "p_limit", type: "integer", mode: "i" },
        { name: "p_yes", type: "boolean", mode: "i" },
        { name: "p_now", type: "timestamp with time zone", mode: "i" },
        { name: "p_tags", type: "text[]", mode: "i" },
        { name: "result", type: "jsonb", mode: "o" },
      ],
    };
    const person = "11111111-2222-4333-8444-555555555555";
    expect(rpcArguments(fn, person, "door-tag", "2026-10-11T00:00:00.000Z")).toEqual({
      p_session_id: person,
      p_scope_id: person,
      p_user_id: person,
      p_patient_id: person,
      p_member: "door-tag",
      p_items: { id: "door-tag", session_id: person, scope_id: person, user_id: person, owner_user_id: person, patient_id: person, family_id: person },
      p_limit: 1,
      p_yes: true,
      p_now: "2026-10-11T00:00:00.000Z",
      p_tags: [],
    });
  });
});
