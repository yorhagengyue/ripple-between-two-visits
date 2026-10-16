/**
 * The session registry (supabase/migrations 0012_a_sessions.sql, lib/auth/gotrue.ts; track A) on a real PostgreSQL with
 * every migration applied, offline: PGlite behind the small PostgREST stand-in (tests/support/fake-postgrest.ts), and a
 * stand-in for GoTrue's token and logout endpoints. It proves the Supabase provider and the table agree: a sign-in
 * enters its session with the device, sessionAlive reads it, ending by id, by device and "all but this one" closes the
 * right rows, a refresh keeps the session, the reason and the time are kept, and deleting the user removes his rows.
 *
 * Opt-in like the store contract over PGlite (the same module):
 *   RIPPLE_PGLITE_MODULE=D:/ripple-c2/tmp/f1/pglite/node_modules/@electric-sql/pglite/dist/index.js npx vitest run tests/unit/auth/sessions.pglite.test.ts
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { GoTrueAuthProvider } from "@/lib/auth/gotrue";
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
  `);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    await db.exec("begin");
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
    await db.exec("commit");
  }
  return db;
}

const fakeJwt = (claims: Record<string, unknown>) => [{ alg: "ES256", typ: "JWT" }, claims].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".") + ".sig";

if (MODULE) {
  const db = await database();
  const rest = fakePostgrest(db);
  const base = "http://pglite.test";
  /** GoTrue: every password sign-in for `user` opens a new session id; a refresh keeps the session of its token. */
  const goTrue = (user: string) => {
    const sessions = new Map<string, string>(); // refresh token -> session id
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/rest/v1/")) return rest(input, init);
      if (url.includes("/logout")) return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body ?? "{}")) as { refresh_token?: string };
      const sid = url.includes("grant_type=refresh_token") ? sessions.get(body.refresh_token ?? "")! : randomUUID();
      const rt = randomUUID();
      sessions.set(rt, sid);
      return new Response(JSON.stringify({ access_token: fakeJwt({ sub: user, session_id: sid }), refresh_token: rt, expires_in: 3600, expires_at: 2_000_000_000, user: { id: user } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  };
  const sid = (accessToken: string) => (JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()) as { session_id: string }).session_id;

  describe("the session registry over PGlite (0012_a_sessions.sql)", () => {
    it("sign-ins enter their sessions; alive, listed, ended by id, by device and all-but-one; deleting the user removes them", async () => {
      const user = randomUUID();
      await db.query("insert into auth.users (id) values ($1::uuid)", [user]);
      const p = new GoTrueAuthProvider({ url: base, serviceKey: "test-key", anonKey: "anon-key", fetch: goTrue(user) });
      const phoneHash = "a".repeat(64);
      const tabletHash = "b".repeat(64);
      const phone = await p.signInWithPassword("tan@users.ripple.invalid", "pw", { deviceHash: phoneHash, deviceLabel: "iPhone · Safari" });
      const tablet = await p.signInWithPassword("tan@users.ripple.invalid", "pw", { deviceHash: tabletHash, deviceLabel: "Android · Chrome", ephemeral: true });
      const third = await p.signInWithPassword("tan@users.ripple.invalid", "pw", { deviceHash: phoneHash });
      for (const t of [phone, tablet, third]) expect(await p.sessionAlive(sid(t.access_token))).toBe(true);

      // a refresh keeps the session (and touches last_seen_at)
      const refreshed = await p.refresh(phone.refresh_token);
      expect(sid(refreshed.access_token)).toBe(sid(phone.access_token));

      const listed = await p.listSessions(user);
      expect(listed.map((s) => [s.device_hash === phoneHash ? "phone" : "tablet", s.device_label, s.ephemeral, s.ended_at])).toEqual([
        ["phone", "iPhone · Safari", false, null],
        ["tablet", "Android · Chrome", true, null],
        ["phone", null, false, null],
      ]);

      // the tablet signed out from his devices page
      expect(await p.endSessions(user, { deviceHash: tabletHash, reason: "device_signed_out" })).toBe(1);
      expect(await p.sessionAlive(sid(tablet.access_token))).toBe(false);
      expect(await p.sessionAlive(sid(phone.access_token))).toBe(true);
      // a new password: all but the one he is on
      expect(await p.endSessions(user, { exceptSessionId: sid(third.access_token), reason: "password_changed" })).toBe(1);
      expect(await p.sessionAlive(sid(phone.access_token))).toBe(false);
      expect(await p.sessionAlive(sid(third.access_token))).toBe(true);
      // ending what is already ended counts nothing
      expect(await p.endSessions(user, { sessionIds: [sid(phone.access_token)], reason: "logout" })).toBe(0);
      const after = await p.listSessions(user);
      expect(after.map((s) => s.ended_reason)).toEqual(["password_changed", "device_signed_out", null]);
      expect(after.every((s) => (s.ended_at === null) === (s.ended_reason === null))).toBe(true);

      // log out this one through the provider
      await p.signOut(third.access_token, "local");
      expect(await p.sessionAlive(sid(third.access_token))).toBe(false);

      // deleting the user (Supabase Auth) takes his rows with him
      await db.query("delete from auth.users where id = $1::uuid", [user]);
      expect(await p.listSessions(user)).toEqual([]);
    });

    it("the table refuses what it should: a bad device hash, a session of a user that does not exist, an ended row without a reason", async () => {
      const user = randomUUID();
      await db.query("insert into auth.users (id) values ($1::uuid)", [user]);
      await expect(db.query("insert into public.account_session (session_id, user_id, device_hash) values ($1::uuid, $2::uuid, 'not-a-hash')", [randomUUID(), user])).rejects.toThrow();
      await expect(db.query("insert into public.account_session (session_id, user_id) values ($1::uuid, $2::uuid)", [randomUUID(), randomUUID()])).rejects.toThrow();
      await expect(db.query("insert into public.account_session (session_id, user_id, ended_at) values ($1::uuid, $2::uuid, now())", [randomUUID(), user])).rejects.toThrow();
    });

    it("nobody but the server: anon and authenticated have no privilege on the table", async () => {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean; rls: boolean }>(
        `select has_table_privilege('anon', 'public.account_session', 'SELECT,INSERT,UPDATE,DELETE') as anon,
                has_table_privilege('authenticated', 'public.account_session', 'SELECT,INSERT,UPDATE,DELETE') as authenticated,
                has_table_privilege('service_role', 'public.account_session', 'SELECT,INSERT,UPDATE') as service,
                (select relrowsecurity from pg_class where oid = 'public.account_session'::regclass) as rls`,
      );
      expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true, rls: true });
    });
  });
} else {
  describe.skip("the session registry over PGlite (set RIPPLE_PGLITE_MODULE to run it)", () => {
    it("skipped", () => {});
  });
}
