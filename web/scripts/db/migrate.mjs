#!/usr/bin/env node
/**
 * Apply web/supabase/migrations/*.sql to the project's own Supabase database.
 *
 *   cd web && node scripts/db/migrate.mjs            apply what is new
 *   cd web && node scripts/db/migrate.mjs --status   list applied / pending, change nothing
 *
 * Connection: SUPABASE_DB_URL from web/.env (the session pooler string). It is never printed.
 * Each file runs in its own transaction and is recorded in public.schema_migrations (file name and
 * sha256), so running this twice is a no-op. A file that was edited after it was applied stops the run:
 * write a new migration instead. A pg advisory lock keeps two runs from applying the same file.
 * After applying anything it asks PostgREST to reload its schema cache (NOTIFY pgrst).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { connect, safeError, WEB } from "./env.mjs";

const DIR = path.join(WEB, "supabase", "migrations");
const LOCK_KEY = 4_826_115_310; // pg_advisory_lock key for this runner

const statusOnly = process.argv.includes("--status");

function migrationFiles() {
  return readdirSync(DIR)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort();
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

async function main() {
  const files = migrationFiles();
  if (!files.length) throw new Error(`no migrations in ${path.relative(WEB, DIR)}`);
  const client = await connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      create table if not exists public.schema_migrations (
        filename   text        primary key,
        sha256     text        not null,
        applied_at timestamptz not null default now()
      );
      alter table public.schema_migrations enable row level security;
      revoke all on table public.schema_migrations from anon, authenticated;
    `);
    const applied = new Map(
      (await client.query("select filename, sha256 from public.schema_migrations")).rows.map((r) => [r.filename, r.sha256]),
    );

    let ran = 0;
    for (const file of files) {
      const sql = readFileSync(path.join(DIR, file), "utf8");
      const hash = sha256(sql);
      const before = applied.get(file);
      if (before) {
        if (before !== hash) {
          throw new Error(`${file} changed after it was applied (sha256 differs); add a new migration instead of editing it`);
        }
        console.log(`  applied   ${file}`);
        continue;
      }
      if (statusOnly) {
        console.log(`  pending   ${file}`);
        continue;
      }
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into public.schema_migrations (filename, sha256) values ($1, $2)", [file, hash]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw new Error(`${file} failed and was rolled back: ${safeError(err)}`);
      }
      ran++;
      console.log(`  NEW       ${file}`);
    }
    const unknown = [...applied.keys()].filter((f) => !files.includes(f));
    for (const f of unknown) console.log(`  (recorded but no file) ${f}`);

    if (ran > 0) {
      await client.query("notify pgrst, 'reload schema'");
      console.log(`applied ${ran} migration(s); asked PostgREST to reload its schema cache`);
    } else {
      console.log(statusOnly ? "status only; nothing changed" : "nothing to apply (no-op)");
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`migrate: ${safeError(err)}`);
  process.exit(1);
});
