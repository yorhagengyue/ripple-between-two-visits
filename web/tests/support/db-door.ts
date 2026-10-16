/**
 * The database's door as a test sees it (track G; used by tests/unit/store/supabase.live.test.ts). Tests only.
 *
 * docs/plan/real-app.md 3.9 (line 696): anyone with an account can take their own token and the publishable key and
 * call PostgREST directly, without our server, so the database itself must refuse them. Line 728: the live test lists
 * the tables from information_schema, so a table added later cannot be forgotten. This file holds the three pieces
 * that test needs, each usable against the real project and against PGlite with the migrations applied:
 *
 *   redact / Door     the one wrapper around fetch. A key, a token, the database URL or an e-mail address can reach a
 *                     test's output only through a message, so every answer is handed out as a status, a short error
 *                     code, a row count and, for an error, its one-line message after redact(). The body itself (the
 *                     rows) is never handed out.
 *   readCatalog       what exists, from the database's own catalog: every table of schema public
 *                     (information_schema.tables, cross-checked with pg_class), their columns
 *                     (information_schema.columns), every function (pg_proc), and what anon and authenticated may use.
 *   the probes        the requests a signed-in person could make by hand, for every table and function of the catalog,
 *                     each returning its findings as short sentences (a table or function name, an HTTP status, an
 *                     error code, a row count; never a body, a header or a URL).
 *
 * The recorded decision the probes hold the door to (web/progress/f1.md lines 12, 21, 103; 0008_privileges.sql;
 * scripts/db/check-privileges.mjs): stricter than the design's "select own". RLS is on for every table, there is no
 * policy at all, and anon and authenticated have no privilege on any table, sequence or function. Only the server's
 * key reads and writes. So a person's own token gets nothing either, not even the person's own rows.
 */
import type { SqlClient } from "./fake-postgrest";

// ---------------------------------------------------------------- nothing secret in a message

const MIN_SECRET = 6;
const DB_URL_LIKE = /\bpostgres(?:ql)?:\/\/[^\s"'<>)]+/gi;
const BEARER_LIKE = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+){0,2}/g;
const API_KEY_LIKE = /\bsb_[a-z]+_[A-Za-z0-9_-]{4,}/g;
const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * `text` with everything that could be a secret replaced: each of `secrets` exactly as given (longest first), then
 * anything that looks like a database URL, a bearer token, a JWT, a Supabase API key or an e-mail address.
 */
export function redact(text: unknown, secrets: Iterable<string | null | undefined> = []): string {
  let out = asText(text);
  const exact = [...new Set([...secrets].filter((s): s is string => typeof s === "string" && s.length >= MIN_SECRET))].sort((a, b) => b.length - a.length);
  for (const s of exact) out = out.split(s).join("<redacted>");
  return out
    .replace(DB_URL_LIKE, "<redacted-db-url>")
    .replace(BEARER_LIKE, "Bearer <redacted>")
    .replace(JWT_LIKE, "<redacted-jwt>")
    .replace(API_KEY_LIKE, "<redacted-key>")
    .replace(EMAIL_LIKE, "<redacted-email>");
}

/** The values of the environment that must never be printed: the keys, the database URL and its parts, the project URL and its host. */
export function secretsFrom(env: Record<string, string | undefined>): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (s.length >= MIN_SECRET) out.add(s);
  };
  const decoded = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  add(env.SUPABASE_SERVICE_KEY);
  add(env.SUPABASE_ANON_KEY);
  add(env.SUPABASE_DB_URL);
  add((env.SUPABASE_URL ?? "").trim().replace(/\/+$/, ""));
  for (const raw of [env.SUPABASE_DB_URL, env.SUPABASE_URL]) {
    try {
      const u = new URL((raw ?? "").trim());
      for (const part of [u.password, decoded(u.password), u.username, decoded(u.username), u.host, u.hostname]) add(part);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

// ---------------------------------------------------------------- the one wrapper around fetch

export interface DoorRequest {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** the apikey header (the publishable key, or the server's key for a control) */
  apikey?: string;
  /** the Authorization header's token; left out, no Authorization header is sent */
  bearer?: string;
  /** a JSON body */
  body?: unknown;
  /** raw bytes instead of a JSON body (a Storage upload), with their content type */
  bytes?: Uint8Array;
  contentType?: string;
  prefer?: string;
}

export interface DoorAnswer {
  /** the HTTP status; 0 when there was no response at all */
  status: number;
  /** the answer's short error code ("42501", "PGRST202", "network"); "" when it has none */
  code: string;
  /** how many entries the body has when it is a JSON array; null otherwise */
  rows: number | null;
  /** an error answer's own one-line message, after redact() and cut short; "" for anything else. Never rows. */
  message: string;
}

const shortCode = (value: unknown): string =>
  String(value ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, 24);

const MESSAGE_MAX = 140;

/** "HTTP 403 42501" / "HTTP 200, 3 row(s)" / "no response": what an answer was, for a message. */
export function said(a: Pick<DoorAnswer, "status" | "code"> & Partial<Pick<DoorAnswer, "rows" | "message">>): string {
  if (a.status === 0) return "no response";
  return `HTTP ${a.status}${a.code ? ` ${a.code}` : ""}${a.rows !== null && a.rows !== undefined ? `, ${a.rows} row(s)` : ""}${a.message ? ` (${a.message})` : ""}`;
}

/**
 * Every request of the door tests goes through here. A request never throws (no response, after a second try, is
 * status 0), no header, no URL and no body is ever part of what comes back, and every credential a request carried is
 * remembered as a secret, so it is replaced in every message from then on.
 */
export class Door {
  private readonly root: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly secrets = new Set<string>();

  constructor(opts: { url: string; fetch?: typeof fetch; secrets?: Iterable<string | null | undefined>; timeoutMs?: number }) {
    this.root = opts.url.trim().replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.remember(this.root, ...(opts.secrets ?? []));
  }

  /** More values to keep out of every message (a person's tokens, an address). */
  remember(...values: (string | null | undefined)[]): void {
    for (const v of values) if (typeof v === "string" && v.length >= MIN_SECRET) this.secrets.add(v);
  }

  redact(text: unknown): string {
    return redact(text, this.secrets);
  }

  /** `path` starts at the project's root: "/rest/v1/note?select=*". */
  async call(path: string, req: DoorRequest = {}): Promise<DoorAnswer> {
    this.remember(req.apikey, req.bearer);
    const headers: Record<string, string> = { accept: "application/json" };
    if (req.apikey) headers.apikey = req.apikey;
    if (req.bearer) headers.authorization = `Bearer ${req.bearer}`;
    if (req.prefer) headers.prefer = req.prefer;
    let body: BodyInit | undefined;
    if (req.bytes) {
      headers["content-type"] = req.contentType ?? "application/octet-stream";
      body = Buffer.from(req.bytes);
    } else if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }
    let status = 0;
    let raw = "";
    // one more try when there was no answer or the gateway was busy: every request here is one the door must refuse
    // (or a read), so asking twice changes nothing
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.root}${path}`, { method: req.method ?? "GET", headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
        status = res.status;
        raw = await res.text();
      } catch {
        // the error of a failed fetch names the host: nothing of it is kept
        status = 0;
        raw = "";
      }
      if (status !== 0 && status !== 502 && status !== 503 && status !== 504) break;
    }
    if (status === 0) return { status: 0, code: "network", rows: null, message: "" };
    let code = "";
    let rows: number | null = null;
    let message = "";
    try {
      const json = raw ? (JSON.parse(raw) as unknown) : null;
      if (Array.isArray(json)) rows = json.length;
      else if (json && typeof json === "object") {
        const o = json as { code?: unknown; error_code?: unknown; error?: unknown; message?: unknown; msg?: unknown };
        code = shortCode(typeof o.code === "string" || typeof o.code === "number" ? o.code : (o.error_code ?? o.error));
        // only an error says why, and only in its message: never details or hint (PostgreSQL puts the failing row there)
        if (status >= 400) message = asText(o.message ?? o.msg).replace(/\s+/g, " ").trim();
      }
    } catch {
      /* not JSON */
    }
    message = this.redact(message);
    if (message.length > MESSAGE_MAX) message = `${message.slice(0, MESSAGE_MAX)}...`;
    return { status, code: this.redact(code), rows, message };
  }
}

// ---------------------------------------------------------------- the catalog

/** information_schema.tables: the design's list (real-app.md line 728). */
export const TABLES_SQL = `
select t.table_name::text as name, t.table_type::text as type
from information_schema.tables t
where t.table_schema = 'public'
order by 1`;

/** pg_class: the same list from the catalog itself, with what information_schema does not say (and materialized views). */
export const RELATIONS_SQL = `
select c.relname::text as name, c.relkind::text as kind, c.relrowsecurity as rls,
       (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
order by 1`;

/** information_schema.columns: which table has a session_id column, and every other column that can name a person. */
export const COLUMNS_SQL = `
select c.table_name::text as table_name, c.column_name::text as name, c.data_type::text as type
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position`;

/** Foreign keys inside schema public: the column a session_id points at (session.id) names a scope too. */
export const REFERENCES_SQL = `
select src.relname::text as table_name, a.attname::text as column_name, ref.relname::text as ref_table, fa.attname::text as ref_column
from pg_constraint c
join pg_namespace n on n.oid = c.connamespace
join pg_class src on src.oid = c.conrelid
join pg_class ref on ref.oid = c.confrelid
join pg_namespace rn on rn.oid = ref.relnamespace
join lateral unnest(c.conkey, c.confkey) as k(att, fatt) on true
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att
join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.fatt
where c.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
order by 1, 2, 3, 4`;

/** pg_proc: every function, procedure and aggregate of schema public with its parameters (names, types, modes). */
export const FUNCTIONS_SQL = `
select p.proname::text as name,
       pg_get_function_identity_arguments(p.oid)::text as identity,
       format_type(p.prorettype, null)::text as returns,
       p.prokind::text as kind,
       coalesce((
         select json_agg(json_build_object(
                  'name', coalesce(p.proargnames[a.i], ''),
                  'type', format_type(a.typ, null),
                  'mode', coalesce(p.proargmodes[a.i]::text, 'i')) order by a.i)
         from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as a(typ, i)
       ), '[]'::json)::text as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1, 2`;

/** The two roles a browser can be: the publishable key (anon) and a signed-in person's own token (authenticated). */
export const CLIENT_ROLES = ["anon", "authenticated"] as const;

export const ROLES_SQL = `select rolname::text as name from pg_roles where rolname in ('anon', 'authenticated') order by 1`;

/**
 * Everything anon or authenticated may use in schema public, one row per (object, role, privilege): a table, view or
 * foreign table (also through a grant on single columns), a sequence, a function. Grants to PUBLIC count: the has_*
 * functions answer for the role as PostgreSQL would.
 */
export const CLIENT_PRIVILEGES_SQL = `
with roles as (
  select rolname from pg_roles where rolname in ('anon', 'authenticated')
),
relations as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
sequences as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
),
functions as (
  select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select 'table' as kind, t.relname::text as name, r.rolname::text as role, x.privilege
  from relations t cross join roles r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as x(privilege)
  where has_table_privilege(r.rolname, t.oid, x.privilege)
union all
select 'column of table', t.relname::text, r.rolname::text, x.privilege
  from relations t cross join roles r
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as x(privilege)
  where has_any_column_privilege(r.rolname, t.oid, x.privilege) and not has_table_privilege(r.rolname, t.oid, x.privilege)
union all
select 'sequence', s.relname::text, r.rolname::text, x.privilege
  from sequences s cross join roles r
  cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as x(privilege)
  where has_sequence_privilege(r.rolname, s.oid, x.privilege)
union all
select 'function', f.name::text, r.rolname::text, 'EXECUTE'
  from functions f cross join roles r
  where has_function_privilege(r.rolname, f.oid, 'EXECUTE')
order by 1, 2, 3, 4`;

const RELATION_KINDS: Record<string, string> = { r: "table", p: "partitioned table", v: "view", m: "materialized view", f: "foreign table" };
const LISTED_TYPES: Record<string, string> = { "BASE TABLE": "table", VIEW: "view", "FOREIGN": "foreign table", "FOREIGN TABLE": "foreign table" };

/**
 * A column that can name a person or a scope, by its name: the rule lib/store/account-rows.ts writes down (an account's
 * scope id is its user id). The column such a column points at with a foreign key counts too (session.id).
 */
export const ID_COLUMN = /^(?:session_id|scope_id|user_id|patient_id|family_id)$|_user_id$/;

export interface CatalogTable {
  name: string;
  /** "table", "partitioned table", "view", "materialized view" or "foreign table" */
  kind: string;
  /** information_schema.tables lists it */
  listed: boolean;
  /** pg_class lists it */
  inPgClass: boolean;
  rls: boolean;
  policies: number;
  columns: { name: string; type: string }[];
  /** the columns that can name a person or a scope (ID_COLUMN, and what such columns reference), in column order */
  idColumns: string[];
}

export interface CatalogArgument {
  name: string;
  type: string;
  /** i (in), o (out), b (inout), v (variadic), t (table) */
  mode: string;
}

export interface CatalogFunction {
  name: string;
  /** "rp_rate_hit(p_bucket text, p_window_s integer, ...)" */
  signature: string;
  returns: string;
  /** f (function), p (procedure), a (aggregate), w (window) */
  kind: string;
  args: CatalogArgument[];
  /** PostgREST serves it under /rpc: a plain function that does not return trigger */
  callable: boolean;
}

export interface Catalog {
  tables: CatalogTable[];
  /** every table with a session_id column (information_schema.columns) */
  sessionIdTables: string[];
  functions: CatalogFunction[];
  /** which of anon / authenticated exist in this database (both must, or the privilege list below says nothing) */
  clientRoles: string[];
  /** what anon or authenticated may use, one sentence each: "table note: authenticated has SELECT"; [] is the decision */
  open: string[];
}

const isTableKind = (kind: string) => kind === "table" || kind === "partitioned table";

/** The tables (not views) whose row level security is off. */
export function rlsOff(catalog: Catalog): string[] {
  return catalog.tables.filter((t) => isTableKind(t.kind) && !t.rls).map((t) => t.name);
}

/** "note: 1" for every table that has a policy (the recorded decision has none anywhere). */
export function withPolicies(catalog: Catalog): string[] {
  return catalog.tables.filter((t) => t.policies > 0).map((t) => `${t.name}: ${t.policies}`);
}

/** Names the two catalog sources disagree on (a materialized view is in pg_class only, by definition). */
export function catalogDisagreements(catalog: Catalog): string[] {
  return catalog.tables
    .filter((t) => (!t.listed && t.kind !== "materialized view") || !t.inPgClass)
    .map((t) => `${t.name}: ${t.listed ? "in information_schema.tables only" : "in pg_class only"}`);
}

/** Read the catalog. SELECT statements only; the same queries on the live project and on PGlite. */
export async function readCatalog(db: SqlClient): Promise<Catalog> {
  const listed = (await db.query<{ name: string; type: string }>(TABLES_SQL)).rows;
  const relations = (await db.query<{ name: string; kind: string; rls: boolean; policies: number }>(RELATIONS_SQL)).rows;
  const columns = (await db.query<{ table_name: string; name: string; type: string }>(COLUMNS_SQL)).rows;
  const references = (await db.query<{ table_name: string; column_name: string; ref_table: string; ref_column: string }>(REFERENCES_SQL)).rows;
  const functions = (await db.query<{ name: string; identity: string; returns: string; kind: string; args: string }>(FUNCTIONS_SQL)).rows;
  const roles = (await db.query<{ name: string }>(ROLES_SQL)).rows;
  const privileges = (await db.query<{ kind: string; name: string; role: string; privilege: string }>(CLIENT_PRIVILEGES_SQL)).rows;

  const byName = new Map<string, CatalogTable>();
  for (const r of relations) {
    byName.set(r.name, { name: r.name, kind: RELATION_KINDS[r.kind] ?? r.kind, listed: false, inPgClass: true, rls: r.rls === true, policies: Number(r.policies) || 0, columns: [], idColumns: [] });
  }
  for (const t of listed) {
    const known = byName.get(t.name);
    if (known) known.listed = true;
    else byName.set(t.name, { name: t.name, kind: LISTED_TYPES[t.type] ?? t.type, listed: true, inPgClass: false, rls: false, policies: 0, columns: [], idColumns: [] });
  }
  for (const c of columns) byName.get(c.table_name)?.columns.push({ name: c.name, type: c.type });
  // a column an id column points at names the same person or scope (session.id, account.user_id)
  const referenced = new Set(references.filter((r) => ID_COLUMN.test(r.column_name)).map((r) => `${r.ref_table}.${r.ref_column}`));
  for (const t of byName.values()) {
    t.idColumns = t.columns.filter((c) => ID_COLUMN.test(c.name) || referenced.has(`${t.name}.${c.name}`)).map((c) => c.name);
  }
  const tables = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    tables,
    sessionIdTables: tables.filter((t) => t.columns.some((c) => c.name === "session_id")).map((t) => t.name),
    functions: functions.map((f) => ({
      name: f.name,
      signature: `${f.name}(${f.identity})`,
      returns: f.returns,
      kind: f.kind,
      args: JSON.parse(f.args) as CatalogArgument[],
      callable: f.kind === "f" && f.returns !== "trigger" && f.returns !== "event_trigger",
    })),
    clientRoles: roles.map((r) => r.name),
    open: privileges.map((p) => `${p.kind} ${p.name}: ${p.role} has ${p.privilege}`),
  };
}

// ---------------------------------------------------------------- the requests a person could make by hand

/** Who is asking: the label goes into messages ("B"), the credentials never do. */
export interface Caller {
  label: string;
  apikey: string;
  /** a person's access token, or the key again; left out: only the apikey header */
  bearer?: string;
}

/** Whose rows: the label goes into messages ("A"), the id only into requests. */
export interface Person {
  label: string;
  id: string;
}

export interface ProbeResult {
  /** how many requests were made */
  asked: number;
  /** answered 401 or 403 (permission denied), or 404 where that counts as a refusal */
  refused: number;
  /** answered 200 with an empty list */
  empty: number;
  /** everything else, one sentence each; [] is the designed answer */
  findings: string[];
}

const REST = "/rest/v1";
const enc = encodeURIComponent;
const creds = (who: Caller): Pick<DoorRequest, "apikey" | "bearer"> => ({ apikey: who.apikey, bearer: who.bearer });

async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(run));
}

const DENIED = [401, 403];

/**
 * Reads. For every table of the catalog: the whole table, and the table filtered on each of its id columns for each
 * of `people` ("?session_id=eq.<A>"). The answer must be a refusal (401, 403; 404 when PostgREST does not serve the
 * table at all) or 200 with an empty list. Anything else is a finding; rows are counted, never shown.
 */
export async function probeReads(door: Door, tables: readonly CatalogTable[], who: Caller, people: readonly Person[], batch = 8): Promise<ProbeResult> {
  const asks: { what: string; path: string }[] = [];
  for (const t of tables) {
    asks.push({ what: `${who.label} read ${t.name}`, path: `${REST}/${enc(t.name)}?select=*&limit=5` });
    for (const col of t.idColumns) {
      for (const p of people) {
        asks.push({ what: `${who.label} read ${t.name} where ${col} = ${p.label}`, path: `${REST}/${enc(t.name)}?select=*&${enc(col)}=eq.${enc(p.id)}&limit=5` });
      }
    }
  }
  const out: ProbeResult = { asked: asks.length, refused: 0, empty: 0, findings: [] };
  const findings: (string | null)[] = new Array<string | null>(asks.length).fill(null);
  await inBatches(
    asks.map((a, i) => ({ ...a, i })),
    batch,
    async (a) => {
      const r = await door.call(a.path, creds(who));
      if (DENIED.includes(r.status) || r.status === 404) out.refused++;
      else if (r.status === 200 && r.rows === 0) out.empty++;
      else findings[a.i] = `${a.what}: ${said(r)}`;
    },
  );
  out.findings = findings.filter((f): f is string => f !== null);
  return out;
}

/**
 * Writes. For every table and each of its id columns: an insert of a row that carries `person`'s id in that column,
 * an update and a delete of the rows that carry it (the update sets the column to the value it has, so even an open
 * door would change no row's content). A table without an id column gets an insert of a row with its first column
 * set to `tag` (a name no real row has). With no privilege on any table, PostgREST answers 401 (publishable key) or
 * 403 (a person's token) before PostgreSQL looks at the row: 400, 409 or 422 would mean the role may write and only a
 * constraint stopped this row, so those are findings too.
 *
 * These are real requests. On a database whose door is open they do what they say: the delete on session removes
 * `person`'s whole space (every table cascades from it). That is why `person` is only ever a test account, why the
 * caller counts the rows afterwards (countRows), and why a red run still cleans up.
 */
export async function probeWrites(door: Door, tables: readonly CatalogTable[], who: Caller, person: Person, tag: string, batch = 8): Promise<ProbeResult> {
  const asks: { what: string; path: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown }[] = [];
  const nowIso = new Date().toISOString();
  for (const t of tables) {
    const base = `${REST}/${enc(t.name)}`;
    if (!t.idColumns.length) {
      const first = t.columns[0];
      const row = first ? { [first.name]: argumentValue({ name: first.name, type: first.type, mode: "i" }, person.id, tag, nowIso) } : {};
      asks.push({ what: `${who.label} insert into ${t.name}`, path: base, method: "POST", body: row });
    }
    for (const col of t.idColumns) {
      const filter = `?${enc(col)}=eq.${enc(person.id)}`;
      asks.push({ what: `${who.label} insert into ${t.name} with ${col} = ${person.label}`, path: base, method: "POST", body: { [col]: person.id } });
      asks.push({ what: `${who.label} update ${t.name} where ${col} = ${person.label}`, path: `${base}${filter}`, method: "PATCH", body: { [col]: person.id } });
      asks.push({ what: `${who.label} delete from ${t.name} where ${col} = ${person.label}`, path: `${base}${filter}`, method: "DELETE" });
    }
  }
  const out: ProbeResult = { asked: asks.length, refused: 0, empty: 0, findings: [] };
  const findings: (string | null)[] = new Array<string | null>(asks.length).fill(null);
  await inBatches(
    asks.map((a, i) => ({ ...a, i })),
    batch,
    async (a) => {
      const r = await door.call(a.path, { ...creds(who), method: a.method, body: a.body, prefer: "return=representation" });
      if (DENIED.includes(r.status)) out.refused++;
      else findings[a.i] = `${a.what}: ${said(r)}`;
    },
  );
  out.findings = findings.filter((f): f is string => f !== null);
  return out;
}

/** A value of the parameter's type. An id-like parameter (uuid, or text named *_id) and every object carry `personId`. */
function argumentValue(arg: CatalogArgument, personId: string, tag: string, nowIso: string): unknown {
  const type = arg.type.toLowerCase();
  if (type.endsWith("[]")) return [];
  if (type === "json" || type === "jsonb") {
    return { id: tag, session_id: personId, scope_id: personId, user_id: personId, owner_user_id: personId, patient_id: personId, family_id: personId };
  }
  if (type === "uuid") return personId;
  if (type === "boolean") return true;
  if (/^(smallint|integer|bigint|numeric|real|double precision)/.test(type)) return 1;
  if (type.startsWith("timestamp")) return nowIso;
  if (type === "date") return nowIso.slice(0, 10);
  if (type.startsWith("time")) return "08:00";
  if (/^(text|character|name)/.test(type)) return /_id$/.test(arg.name) ? personId : tag;
  return null;
}

/**
 * The argument object for POST /rpc/<name>, from the catalog's parameter names and types: every input parameter is
 * there (so PostgREST finds the function), p_session_id / p_scope_id / p_user_id / p_patient_id and the like are
 * `personId`, every other text is `tag` (a name no real row has).
 */
export function rpcArguments(fn: CatalogFunction, personId: string, tag: string, nowIso: string = new Date().toISOString()): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const arg of fn.args) {
    if (!arg.name || !["i", "b", "v"].includes(arg.mode)) continue;
    out[arg.name] = argumentValue(arg, personId, tag, nowIso);
  }
  return out;
}

/**
 * Calls. Every function of the catalog twice: with an empty body, and with every parameter named and `person`'s id
 * where a parameter takes an id. The empty call may be refused as 401, 403 or 404 (PostgREST finds no function without
 * parameters). The full call of a function PostgREST serves must be 401 or 403: a 404 there would mean the call was
 * not understood and proves nothing, a 400 that PostgreSQL ran the function. A trigger function is not served: 404.
 */
export async function probeFunctions(door: Door, functions: readonly CatalogFunction[], who: Caller, person: Person, tag: string, batch = 8): Promise<ProbeResult> {
  const asks: { what: string; path: string; body: Record<string, unknown>; allowed: number[] }[] = [];
  for (const f of functions) {
    const path = `${REST}/rpc/${enc(f.name)}`;
    const full = rpcArguments(f, person.id, tag);
    const named = Object.keys(full).length;
    const inputs = f.args.filter((a) => ["i", "b", "v"].includes(a.mode)).length;
    const strict = f.callable && named === inputs;
    asks.push({ what: `${who.label} call ${f.name} without arguments`, path, body: {}, allowed: strict && inputs === 0 ? DENIED : [...DENIED, 404] });
    if (named > 0) asks.push({ what: `${who.label} call ${f.name} with ${person.label}'s id`, path, body: full, allowed: strict ? DENIED : [...DENIED, 404] });
  }
  const out: ProbeResult = { asked: asks.length, refused: 0, empty: 0, findings: [] };
  const findings: (string | null)[] = new Array<string | null>(asks.length).fill(null);
  await inBatches(
    asks.map((a, i) => ({ ...a, i })),
    batch,
    async (a) => {
      const r = await door.call(a.path, { ...creds(who), method: "POST", body: a.body });
      if (a.allowed.includes(r.status)) out.refused++;
      else findings[a.i] = `${a.what}: ${said(r)}`;
    },
  );
  out.findings = findings.filter((f): f is string => f !== null);
  return out;
}

export interface RowCounts {
  /** table -> how many rows carry the person's id in one of the table's id columns (every table with an id column) */
  counts: Record<string, number>;
  /** a table the server's key could not read through the same door, or a count that hit the page size */
  findings: string[];
}

const COUNT_PAGE = 1000;

/**
 * The control, with the server's key through the same door and the same filters: how many rows of each table carry
 * `person`'s id. It proves the paths and filters of the probes are right (a typo would answer 400 or 404 here), it says
 * where there is something to leak, and taken before and after it shows that nothing was written or removed. Only the
 * id columns are selected: no content is read.
 */
export async function countRows(door: Door, tables: readonly CatalogTable[], service: Caller, person: Person, batch = 8): Promise<RowCounts> {
  const counts: Record<string, number> = {};
  const findings: string[] = [];
  await inBatches(tables, batch, async (t) => {
    const cols = t.idColumns;
    const filter = !cols.length ? "" : cols.length === 1 ? `&${enc(cols[0])}=eq.${enc(person.id)}` : `&or=${enc(`(${cols.map((c) => `${c}.eq.${person.id}`).join(",")})`)}`;
    const select = cols.length ? cols.map(enc).join(",") : "*";
    const r = await door.call(`${REST}/${enc(t.name)}?select=${select}${filter}&limit=${cols.length ? COUNT_PAGE : 1}`, creds(service));
    // 206: PostgREST's answer to a page that is not the whole table
    if ((r.status !== 200 && r.status !== 206) || r.rows === null) findings.push(`${service.label} read ${t.name}: ${said(r)}`);
    else if (cols.length) {
      counts[t.name] = r.rows;
      if (r.rows >= COUNT_PAGE) findings.push(`${service.label} read ${t.name}: ${r.rows} rows, the count is cut off at the page size`);
    }
  });
  findings.sort();
  return { counts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))), findings };
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * After a person was deleted: what still carries the id, asked from the database itself. "table.column: n" for every id
 * column of the catalog that still has rows, and "auth.users: n" for the identity. [] means nothing is left.
 */
export async function rowsLeft(db: SqlClient, tables: readonly CatalogTable[], personId: string): Promise<string[]> {
  const out: string[] = [];
  for (const t of tables) {
    if (t.kind !== "table" && t.kind !== "partitioned table") continue;
    for (const col of t.idColumns) {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${quoteIdent(t.name)} where ${quoteIdent(col)}::text = $1`, [personId]);
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) out.push(`${t.name}.${col}: ${n}`);
    }
  }
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from auth.users where id::text = $1", [personId]);
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) out.push(`auth.users: ${n}`);
  return out;
}
