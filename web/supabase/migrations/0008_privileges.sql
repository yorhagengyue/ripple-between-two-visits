-- The database's one door (C2 architecture review 10-10, "数据库的门"): only the server, with the service key, reads
-- and writes. anon and authenticated (the publishable key, a signed-in user's own JWT) get nothing: no table, no
-- sequence, no function, now or later. Every table keeps RLS enabled with no policies, as a second lock. There is no
-- RLS-policy migration on purpose: the store layer (web/lib/subject's scoped store) is the single gate, and
-- scripts/db/check-privileges.mjs proves this file's promise on every merge.
--
-- Written as a file only; the integrator applies it (node scripts/db/migrate.mjs, which runs as the role that creates
-- the objects, `postgres` on Supabase) and then runs node scripts/db/check-privileges.mjs.

-- ---------------------------------------------------------------- objects created from now on

-- Default privileges belong to the role that creates the objects. Revoke for the role running this migration (the
-- migration runner, which creates every later object) and for `postgres` when that is another role: Supabase's own
-- setup grants anon and authenticated everything on tables, sequences and functions that `postgres` creates in public.
-- PostgreSQL itself grants EXECUTE on every new function to PUBLIC globally, and a per-schema REVOKE cannot take back a
-- global default, so that one is revoked without IN SCHEMA as well.
do $$
declare
  r text;
begin
  for r in
    select distinct rolname from pg_roles where rolname = current_user or rolname = 'postgres'
  loop
    execute format('alter default privileges for role %I in schema public revoke all on tables from anon, authenticated', r);
    execute format('alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated', r);
    execute format('alter default privileges for role %I in schema public revoke all on functions from public, anon, authenticated', r);
    execute format('alter default privileges for role %I revoke execute on functions from public', r);
    -- the server keeps what it needs on what that role creates
    execute format('alter default privileges for role %I in schema public grant all on tables to service_role', r);
    execute format('alter default privileges for role %I in schema public grant usage, select on sequences to service_role', r);
    execute format('alter default privileges for role %I in schema public grant execute on functions to service_role', r);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- objects that exist now

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- RLS stays on for every table in public (a table someone adds without it is switched on here; no policies are added)
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end;
$$;
