#!/usr/bin/env node
/**
 * Proof and housekeeping for the Supabase database (never prints a key, URL or host).
 *
 *   cd web && node scripts/db/inspect.mjs --rls      only the RLS listing (the catalog; no data table is read)
 *   cd web && node scripts/db/inspect.mjs --counts --actor <who> --reason "<why, in a sentence>"
 *                                                    only the row counts
 *   cd web && node scripts/db/inspect.mjs --actor <who> --reason "<why>"
 *                                                    RLS listing + row counts
 *   cd web && node scripts/db/inspect.mjs            RLS listing; the row counts are skipped and it says so
 *
 * C2 track H: the row counts read the data tables with the database's own connection, so they need who and why
 * (--actor, --reason; ./audit.mjs) and leave one row in service_read_log before any table is counted (real-app 3.11
 * 「运维排障：脚本必须带一句理由……没有理由就拒绝运行」). --counts without them stops with exit code 2. A script that calls this
 * one passes its own name and reason.
 *
 * RLS listing: every table in schema public with pg_class.relrowsecurity, the number of policies on it
 * (pg_policies), and whether anon / authenticated hold any table privilege. Exit code 1 when a table has
 * RLS off, has any policy, or grants anything to anon / authenticated.
 * Row counts: exact count(*) per table.
 */
import { logServiceRead, readReason } from "./audit.mjs";
import { connect, safeError } from "./env.mjs";

const wantRls = !process.argv.includes("--counts");
let wantCounts = !process.argv.includes("--rls");
// C2 track H (only add): no reason, no read of the data tables
const why = wantCounts ? readReason(process.argv.slice(2)) : null;
if (why && !why.ok) {
  if (process.argv.includes("--counts")) {
    console.error(why.message);
    process.exit(2);
  }
  console.log(`row counts skipped: ${why.message}`);
  wantCounts = false;
}

async function main() {
  const client = await connect();
  let bad = 0;
  try {
    const { rows: tables } = await client.query(`
      select c.relname as table,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as force_rls,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                and (p.roles && array['anon','authenticated','public']::name[])) as client_policies,
             has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_priv,
             has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as auth_priv
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`);

    if (wantRls) {
      console.log("RLS (schema public): table | relrowsecurity | policies | anon/authenticated privileges");
      for (const t of tables) {
        const ok = t.rls && t.policies === 0 && !t.anon_priv && !t.auth_priv;
        if (!ok) bad++;
        console.log(
          `  ${ok ? "ok " : "BAD"}  ${t.table.padEnd(18)} relrowsecurity=${t.rls}  policies=${t.policies}  ` +
            `anon=${t.anon_priv ? "yes" : "no"}  authenticated=${t.auth_priv ? "yes" : "no"}`,
        );
      }
      const { rows: fns } = await client.query(`
        select p.proname as fn,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' order by p.proname`);
      console.log("functions (schema public): anon/authenticated EXECUTE");
      for (const f of fns) {
        const ok = !f.anon_exec && !f.auth_exec;
        if (!ok) bad++;
        console.log(`  ${ok ? "ok " : "BAD"}  ${f.fn.padEnd(22)} anon=${f.anon_exec ? "yes" : "no"}  authenticated=${f.auth_exec ? "yes" : "no"}`);
      }
      console.log(`${tables.length} tables, ${tables.filter((t) => t.rls).length} with RLS enabled, ${tables.reduce((n, t) => n + t.policies, 0)} policies in total`);
    }

    if (wantCounts) {
      // the audit row first (who, why, which tables; counts only, about no one person): if it cannot be written, nothing is counted
      const logId = await logServiceRead(client, { actor: why.actor, reason: why.reason, tables: tables.map((t) => t.table) });
      console.log(`service_read_log: ${logId}`);
      console.log("row counts:");
      for (const t of tables) {
        const { rows } = await client.query(`select count(*)::int as n from public."${t.table.replace(/"/g, '""')}"`);
        console.log(`  ${t.table.padEnd(18)} ${rows[0].n}`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
  if (bad) {
    console.error(`${bad} problem(s) above`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`inspect: ${safeError(err)}`);
  process.exit(1);
});
