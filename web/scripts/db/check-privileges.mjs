#!/usr/bin/env node
/**
 * The merge gate's database check (C2 施工约定, 合并门禁 4): only the server may touch the database.
 *
 *   cd web && node scripts/db/check-privileges.mjs
 *
 * One SQL query lists every violation in schema public:
 *   - a table (or partitioned table) with row level security off;
 *   - a table with any policy at all (the design has none: the server's scoped store is the gate, not RLS);
 *   - a table, sequence or function that anon or authenticated may use (directly or through PUBLIC);
 *   - a default privilege that would give anon, authenticated or PUBLIC something on objects created later.
 * Exit code 0 and "ok" when there is none; 1 with one line per violation otherwise; 2 when it cannot connect.
 *
 * Connection: SUPABASE_DB_URL (web/.env or the environment), never printed (scripts/db/env.mjs).
 */
import { connect, safeError } from "./env.mjs";

export const CHECK_SQL = `
with tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
sequences as (
  select c.oid, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
),
functions as (
  select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
client_roles as (
  select rolname from pg_roles where rolname in ('anon', 'authenticated')
)
select 'table' as kind, t.relname as name, 'row level security is off' as problem
  from tables t where not t.relrowsecurity
union all
select 'table', t.relname, count(p.*)::text || ' polic' || case when count(p.*) = 1 then 'y' else 'ies' end
  from tables t join pg_policies p on p.schemaname = 'public' and p.tablename = t.relname
  group by t.relname
union all
select 'table', t.relname, r.rolname || ' has a privilege on it'
  from tables t cross join client_roles r
  where has_table_privilege(r.rolname, t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
union all
select 'sequence', s.relname, r.rolname || ' may use it'
  from sequences s cross join client_roles r
  where has_sequence_privilege(r.rolname, s.oid, 'USAGE,SELECT,UPDATE')
union all
select 'function', f.name, r.rolname || ' may execute it'
  from functions f cross join client_roles r
  where has_function_privilege(r.rolname, f.oid, 'EXECUTE')
union all
select 'default privilege', coalesce(pg_get_userbyid(d.defaclrole), '?') || ' on ' ||
       case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' else d.defaclobjtype::text end ||
       case when d.defaclnamespace = 0 then ' (all schemas)' else '' end,
       'grants ' || coalesce(nullif(a.grantee_name, ''), 'PUBLIC') || ' ' || a.privilege_type || ' on what it creates'
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) as e
  cross join lateral (select case when e.grantee = 0 then '' else pg_get_userbyid(e.grantee) end as grantee_name, e.privilege_type) as a
  where (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
    and d.defaclobjtype in ('r', 'S', 'f')
    -- the roles that create this app's objects (the migration runner; postgres on Supabase): Supabase's own admin roles
    -- keep their defaults for what they create, which is never in this app's tables
    and pg_get_userbyid(d.defaclrole) in (current_user, 'postgres')
    and (a.grantee_name in ('anon', 'authenticated') or a.grantee_name = '')
order by 1, 2, 3
`;

async function main() {
  let client;
  try {
    client = await connect();
  } catch (err) {
    console.error(`check-privileges: cannot connect: ${safeError(err)}`);
    process.exit(2);
  }
  try {
    const { rows } = await client.query(CHECK_SQL);
    if (rows.length === 0) {
      console.log("check-privileges: ok (every public table has RLS on and no policy; anon and authenticated get nothing)");
      return;
    }
    console.log(`check-privileges: ${rows.length} problem${rows.length === 1 ? "" : "s"}`);
    for (const r of rows) console.log(`  BAD  ${r.kind.padEnd(17)} ${r.name}: ${r.problem}`);
    process.exitCode = 1;
  } catch (err) {
    console.error(`check-privileges: the check failed: ${safeError(err)}`);
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && /check-privileges\.mjs$/.test(process.argv[1])) await main();
