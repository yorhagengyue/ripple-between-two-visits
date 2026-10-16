/**
 * The store contract (tests/contract/store.contract.ts) against the Supabase adapter (lib/store/supabase.ts) on a real
 * PostgreSQL with every migration applied (supabase/migrations 0001-0008), offline: PGlite (PostgreSQL compiled to
 * WebAssembly) behind a small PostgREST stand-in (tests/support/fake-postgrest.ts). It proves the adapter and the SQL
 * agree with the memory store, including the C2 functions, constraints and the privilege check, without a project.
 *
 * Opt-in: PGlite is not a dependency of this app. Install it anywhere and point RIPPLE_PGLITE_MODULE at its entry:
 *
 *   mkdir D:/tmp/pglite && cd D:/tmp/pglite && npm install @electric-sql/pglite@0.3.7
 *   RIPPLE_PGLITE_MODULE=D:/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js npx vitest run tests/unit/store/pglite.contract.test.ts
 *
 * Supabase's own pieces are stood in for: the roles anon / authenticated / service_role, auth.users (the accounts'
 * foreign keys), and Supabase's default grants to anon and authenticated (so 0008 has something to take back).
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/lib/store/supabase";
import { describeStoreContract } from "../../contract/store.contract";
import { fakePostgrest, type SqlClient } from "../../support/fake-postgrest";

const MODULE = process.env.RIPPLE_PGLITE_MODULE?.trim();

type PgliteLike = SqlClient & { exec(sql: string): Promise<unknown> };

async function database(): Promise<PgliteLike> {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(MODULE!).href)) as { PGlite: new () => PgliteLike };
  const db = new mod.PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    await db.exec("begin");
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await db.exec("commit");
  }
  return db;
}

const db = MODULE ? await database() : null;

if (db) {
  const fetchImpl = fakePostgrest(db);
  describeStoreContract("supabase adapter over PGlite (migrations 0001-0008)", {
    create: ({ now }) => new SupabaseStore({ url: "http://pglite.test", serviceKey: "test-key", fetch: fetchImpl, now }),
    sharedDatabase: true,
    timeoutMs: 60_000,
    async newUserId() {
      const id = randomUUID();
      await db.query("insert into auth.users (id) values ($1::uuid)", [id]);
      return id;
    },
  });

  describe("the database grants nothing to anon or authenticated (scripts/db/check-privileges.mjs)", () => {
    it("the merge check finds no problem after every migration", async () => {
      const { CHECK_SQL } = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "db", "check-privileges.mjs")).href)) as { CHECK_SQL: string };
      const { rows } = await db.query(CHECK_SQL);
      expect(rows).toEqual([]);
    });
  });
} else {
  describe.skip("store contract over PGlite (set RIPPLE_PGLITE_MODULE to run it)", () => {
    it("skipped", () => {});
  });
}
