/**
 * A small PostgREST stand-in over a real PostgreSQL connection, for tests only: it answers the requests
 * lib/store/supabase.ts makes (the filters, ordering, limits, upserts, Prefer headers and rpc calls it uses), so the
 * store contract (tests/contract/store.contract.ts) can run against the Supabase adapter and the real migrations
 * without a Supabase project (tests/unit/store/pglite.contract.test.ts, opt-in).
 *
 * Not a general PostgREST: only what the adapter sends. Errors come back the way PostgREST shapes them
 * ({ code, message }, 409 for unique / foreign-key violations, 400 for bad input and raised exceptions).
 */

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

type Col = { name: string; type: string };

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Split a PostgREST logic list "(a.eq.1,b.gt."x,y")" into its parts, respecting quotes and parentheses. */
function splitTopLevel(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of inner) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const unquote = (v: string) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

class Sql {
  params: unknown[] = [];
  constructor(private readonly cols: Map<string, Col>) {}

  param(value: unknown, type: string): string {
    this.params.push(value);
    return `$${this.params.length}::${type}`;
  }

  colType(col: string): string {
    const c = this.cols.get(col);
    if (!c) throw new PgrstError(400, "PGRST204", `column ${col} does not exist`);
    return c.type;
  }

  /** One filter "op.value" on a column, as SQL. */
  filter(col: string, expr: string): string {
    const c = `t.${quoteIdent(col)}`;
    const not = expr.startsWith("not.");
    const e = not ? expr.slice(4) : expr;
    const dot = e.indexOf(".");
    const op = dot < 0 ? e : e.slice(0, dot);
    const raw = dot < 0 ? "" : e.slice(dot + 1);
    let sql: string;
    switch (op) {
      case "is":
        sql = raw === "null" ? `${c} is null` : raw === "true" ? `${c} is true` : raw === "false" ? `${c} is false` : "false";
        break;
      case "in": {
        const items = splitTopLevel(raw.replace(/^\(/, "").replace(/\)$/, "")).map(unquote);
        sql = `${c} = any(${this.param(items, `${this.colType(col)}[]`)})`;
        break;
      }
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
        sql = `${c} ${sym} ${this.param(unquote(raw), this.colType(col))}`;
        break;
      }
      default:
        throw new PgrstError(400, "PGRST100", `unsupported operator ${op}`);
    }
    return not ? `not (${sql})` : sql;
  }

  /** "(a.eq.1,b.is.null)" joined with `joiner`. */
  logic(list: string, joiner: "or" | "and"): string {
    const parts = splitTopLevel(list.replace(/^\(/, "").replace(/\)$/, "")).map((p) => {
      const m = /^([a-z_][a-z0-9_]*)\.(.*)$/i.exec(p);
      if (!m) throw new PgrstError(400, "PGRST100", `bad logic part ${p}`);
      return this.filter(m[1], m[2]);
    });
    return `(${parts.join(` ${joiner} `)})`;
  }
}

class PgrstError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const RESERVED = new Set(["select", "order", "limit", "on_conflict", "columns"]);

function project(row: Record<string, unknown>, select: string | null): Record<string, unknown> {
  if (!select || select === "*") return row;
  const out: Record<string, unknown> = {};
  for (const c of select.split(",").map((x) => x.trim()).filter(Boolean)) out[c] = row[c];
  return out;
}

function statusFor(code: string): number {
  if (code === "23505" || code === "23503") return 409;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code.startsWith("22") || code.startsWith("23") || code === "P0001") return 400;
  return 500;
}

/** A fetch that answers the adapter's PostgREST calls from `db`. */
export function fakePostgrest(db: SqlClient): typeof fetch {
  const colCache = new Map<string, Map<string, Col>>();
  const fnCache = new Map<string, { names: string[]; types: string[]; ret: string }>();

  async function columns(table: string): Promise<Map<string, Col>> {
    let m = colCache.get(table);
    if (!m) {
      const { rows } = await db.query<{ column_name: string; type: string }>(
        `select a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped`,
        [table],
      );
      if (!rows.length) throw new PgrstError(404, "PGRST205", `table ${table} not found`);
      m = new Map(rows.map((r) => [r.column_name, { name: r.column_name, type: r.type }]));
      colCache.set(table, m);
    }
    return m;
  }

  async function fn(name: string) {
    let f = fnCache.get(name);
    if (!f) {
      const { rows } = await db.query<{ names: string[] | null; types: string[]; ret: string }>(
        `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
                format_type(p.prorettype, null) as ret
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      if (!rows.length) throw new PgrstError(404, "PGRST202", `function ${name} not found`);
      f = { names: rows[0].names ?? [], types: rows[0].types, ret: rows[0].ret };
      fnCache.set(name, f);
    }
    return f;
  }

  async function handle(method: string, path: string, q: URLSearchParams, prefer: string, bodyText: string | null): Promise<{ status: number; body: unknown }> {
    const body = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
    if (path.startsWith("rpc/")) {
      const name = path.slice(4);
      const f = await fn(name);
      const args = (body ?? {}) as Record<string, unknown>;
      const sql = new Sql(new Map());
      const parts: string[] = [];
      for (const [k, v] of Object.entries(args)) {
        const i = f.names.indexOf(k);
        if (i < 0) throw new PgrstError(404, "PGRST202", `no argument ${k} on ${name}`);
        const type = f.types[i];
        const value =
          v === null || v === undefined
            ? null
            : type === "jsonb" || type === "json" || typeof v === "object"
              ? JSON.stringify(v)
              : typeof v === "boolean"
                ? v
                : String(v);
        parts.push(`${quoteIdent(k)} => ${sql.param(value, type)}`);
      }
      const call = `public.${quoteIdent(name)}(${parts.join(", ")})`;
      if (f.ret === "void") {
        await db.query(`select ${call}`, sql.params);
        return { status: 200, body: null };
      }
      const { rows } = await db.query<{ r: unknown }>(`select to_jsonb(${call}) as r`, sql.params);
      return { status: 200, body: rows[0]?.r ?? null };
    }

    const table = path;
    const cols = await columns(table);
    const sql = new Sql(cols);
    const where: string[] = [];
    for (const [k, v] of q.entries()) {
      if (RESERVED.has(k)) continue;
      if (k === "or" || k === "and") where.push(sql.logic(v, k));
      else where.push(sql.filter(k, v));
    }
    const whereSql = where.length ? ` where ${where.join(" and ")}` : "";
    const select = q.get("select");
    const representation = prefer.includes("return=representation");

    if (method === "GET") {
      let s = `select to_jsonb(t.*) as r from public.${quoteIdent(table)} t${whereSql}`;
      const order = q.get("order");
      if (order) {
        s += ` order by ${order
          .split(",")
          .map((o) => {
            const [c, dir] = o.split(".");
            if (!cols.has(c)) throw new PgrstError(400, "PGRST100", `bad order ${o}`);
            return `t.${quoteIdent(c)} ${dir === "desc" ? "desc" : "asc"}`;
          })
          .join(", ")}`;
      }
      const limit = q.get("limit");
      if (limit) s += ` limit ${Math.max(0, Math.floor(Number(limit)))}`;
      const { rows } = await db.query<{ r: Record<string, unknown> }>(s, sql.params);
      return { status: 200, body: rows.map((x) => project(x.r, select)) };
    }

    if (method === "DELETE") {
      const { rows } = await db.query<{ r: Record<string, unknown> }>(`delete from public.${quoteIdent(table)} t${whereSql} returning to_jsonb(t.*) as r`, sql.params);
      return representation ? { status: 200, body: rows.map((x) => project(x.r, select)) } : { status: 204, body: null };
    }

    if (method === "PATCH") {
      const patch = (body ?? {}) as Record<string, unknown>;
      const keys = Object.keys(patch);
      for (const k of keys) if (!cols.has(k)) throw new PgrstError(400, "PGRST204", `column ${k} does not exist`);
      if (!keys.length) return { status: 200, body: [] };
      const rec = sql.param(JSON.stringify(patch), "jsonb");
      const sets = keys.map((k) => `${quoteIdent(k)} = r.${quoteIdent(k)}`).join(", ");
      const s = `update public.${quoteIdent(table)} t set ${sets} from (select * from jsonb_populate_record(null::public.${quoteIdent(table)}, ${rec})) r${whereSql} returning to_jsonb(t.*) as r`;
      const { rows } = await db.query<{ r: Record<string, unknown> }>(s, sql.params);
      return representation ? { status: 200, body: rows.map((x) => project(x.r, select)) } : { status: 204, body: null };
    }

    if (method === "POST") {
      const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      if (!list.length) return { status: 201, body: representation ? [] : null };
      const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
      for (const k of keys) if (!cols.has(k)) throw new PgrstError(400, "PGRST204", `column ${k} does not exist`);
      const colList = keys.map(quoteIdent).join(", ");
      const rec = sql.param(JSON.stringify(list), "jsonb");
      let s = `insert into public.${quoteIdent(table)} as t (${colList})
        select ${keys.map((k) => `r.${quoteIdent(k)}`).join(", ")}
        from jsonb_array_elements(${rec}) with ordinality as e(j, n)
        cross join lateral jsonb_populate_record(null::public.${quoteIdent(table)}, e.j) as r
        order by e.n`;
      const onConflict = q.get("on_conflict");
      if (onConflict && prefer.includes("resolution=merge-duplicates")) {
        const conflict = onConflict.split(",").map((c) => c.trim());
        const updates = keys.filter((k) => !conflict.includes(k));
        s += ` on conflict (${conflict.map(quoteIdent).join(", ")}) do ${updates.length ? `update set ${updates.map((k) => `${quoteIdent(k)} = excluded.${quoteIdent(k)}`).join(", ")}` : "nothing"}`;
      }
      s += " returning to_jsonb(t.*) as r";
      const { rows } = await db.query<{ r: Record<string, unknown> }>(s, sql.params);
      return representation ? { status: 201, body: rows.map((x) => project(x.r, select)) } : { status: 201, body: null };
    }

    throw new PgrstError(405, "PGRST117", `method ${method}`);
  }

  // one statement at a time, like a single connection
  let chain: Promise<unknown> = Promise.resolve();

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const marker = "/rest/v1/";
    const at = url.pathname.indexOf(marker);
    const path = decodeURIComponent(url.pathname.slice(at + marker.length));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const prefer = headers.get("prefer") ?? "";
    const bodyText = typeof init?.body === "string" ? init.body : null;
    const run = chain.then(() => handle(method, path, url.searchParams, prefer, bodyText));
    chain = run.catch(() => {});
    try {
      const { status, body } = await run;
      if (status === 204 || body === null) return new Response(status === 204 ? null : "null", { status: status === 204 ? 204 : status, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    } catch (err) {
      const e = err as { code?: string; message?: string; status?: number };
      const code = String(e.code ?? "XX000");
      if (process.env.FAKE_PGRST_DEBUG) console.error(`[fake-postgrest] ${method} ${path}: ${code} ${e.message}`);
      const status = err instanceof PgrstError ? err.status : statusFor(code);
      return new Response(JSON.stringify({ code, message: e.message ?? "", details: null, hint: null }), { status, headers: { "content-type": "application/json" } });
    }
  }) as typeof fetch;
}
