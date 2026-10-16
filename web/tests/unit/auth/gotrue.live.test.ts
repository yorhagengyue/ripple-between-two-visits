/**
 * Supabase Auth (GoTrue) and the session registry against the real project (track A). Skipped unless AUTH_LIVE=1.
 *
 *   cd web && AUTH_LIVE=1 npx vitest run tests/unit/auth/gotrue.live.test.ts
 *
 * Reads web/.env (SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY). Needs supabase/migrations up to
 * 0012_a_sessions.sql applied (the registry table; the account tables of 0005 for the sign-up flow). Every user it
 * makes is created and deleted through the admin API (deleting a user removes his registry rows and, through the
 * account row, his space and consents). Assertions compare statuses and values only: a failure never prints a key.
 *
 * What it proves on the project:
 *   - tokens are ES256 with a kid, iss <SUPABASE_URL>/auth/v1, aud authenticated, verified through the JWKS; their
 *     lifetime is the project's setting (3600 s on 10-10) and the app does not rely on it (rp_at is 15 minutes);
 *   - every sign-in is entered in public.account_session with its device; sessionAlive reads it; a refresh keeps the
 *     session id; ending by device, all-but-one and everything closes the right sessions; GoTrue's own refresh is
 *     refused after logout?scope=others;
 *   - the admin lookup by address finds a user; checking a password leaves no session open;
 *   - the account flows (lib/auth/service.ts) over the Supabase store: sign up, log in with the lockout, recover with
 *     the code (single use), delete.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { GoTrueAuthProvider, goTrueConfig, type GoTrueConfig } from "@/lib/auth/gotrue";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { AuthError } from "@/lib/auth/provider";
import { logIn, recover, signUp, type AccountDeps } from "@/lib/auth/service";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { SupabaseStore, supabaseStoreConfig } from "@/lib/store/supabase";

const LIVE = process.env.AUTH_LIVE === "1";
const TIMEOUT = 90_000;

let cfg: GoTrueConfig | null = null;
if (LIVE) {
  const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  cfg = goTrueConfig();
  if (!cfg) throw new Error("AUTH_LIVE=1 needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY in web/.env");
}

const created: string[] = [];
const sid = (accessToken: string) => String(decodeJwt(accessToken).session_id);
const email = () => `live-a-${randomUUID().slice(0, 12)}@users.ripple.invalid`;
const password = () => `live ${randomBytes(9).toString("base64url")}`;

describe.skipIf(!LIVE)("Supabase Auth and the session registry (live, AUTH_LIVE=1)", () => {
  const p = () => new GoTrueAuthProvider(cfg!);

  afterAll(async () => {
    const provider = p();
    for (const id of created) await provider.deleteUser(id);
  }, 120_000);

  it(
    "tokens: ES256 with a kid, the project's issuer and audience, verified through the JWKS; the project's lifetime is reported, not relied on",
    async () => {
      const provider = p();
      const e = email();
      const pw = password();
      const user = await provider.createUser({ email: e, password: pw, app_metadata: { login_kind: "email" } });
      created.push(user.id);
      const t = await provider.signInWithPassword(e, pw, { deviceHash: "a".repeat(64), deviceLabel: "live test" });
      const header = decodeProtectedHeader(t.access_token);
      expect(header.alg).toBe("ES256");
      expect(typeof header.kid).toBe("string");
      const v = await verifyAccessToken(t.access_token, { keys: await provider.keySet(), issuer: provider.issuer() });
      expect(v.ok).toBe(true);
      if (v.ok) {
        expect(v.token.sub).toBe(user.id);
        expect(v.token.claims.iss).toBe(`${cfg!.url}/auth/v1`);
      }
      expect(t.expires_in).toBeGreaterThan(0);
      console.info(`[auth live] access tokens live ${t.expires_in} s on this project (the app keeps one 15 minutes)`);
    },
    TIMEOUT,
  );

  it(
    "the registry: a sign-in is entered with its device, a refresh keeps the session, ending by device / all-but-one / all",
    async () => {
      const provider = p();
      const e = email();
      const pw = password();
      const user = await provider.createUser({ email: e, password: pw });
      created.push(user.id);
      const phone = await provider.signInWithPassword(e, pw, { deviceHash: "1".repeat(64), deviceLabel: "iPhone · Safari" });
      const tablet = await provider.signInWithPassword(e, pw, { deviceHash: "2".repeat(64), deviceLabel: "Android · Chrome", ephemeral: true });
      const listed = await provider.listSessions(user.id);
      expect(listed.map((s) => [s.session_id, s.device_label, s.ephemeral, s.ended_at])).toEqual([
        [sid(phone.access_token), "iPhone · Safari", false, null],
        [sid(tablet.access_token), "Android · Chrome", true, null],
      ]);
      expect(await provider.sessionAlive(sid(phone.access_token))).toBe(true);
      const refreshed = await provider.refresh(phone.refresh_token);
      expect(sid(refreshed.access_token)).toBe(sid(phone.access_token));

      expect(await provider.endSessions(user.id, { deviceHash: "2".repeat(64), reason: "device_signed_out" })).toBe(1);
      expect(await provider.sessionAlive(sid(tablet.access_token))).toBe(false);
      expect(await provider.sessionAlive(sid(phone.access_token))).toBe(true);

      // a new password: a fresh session for this device, every other one ends, GoTrue refuses the old refresh token
      const next = password();
      await provider.updatePassword(user.id, next);
      const fresh = await provider.signInWithPassword(e, next, { deviceHash: "1".repeat(64) });
      await provider.endSessions(user.id, { exceptSessionId: sid(fresh.access_token), reason: "password_changed" });
      await provider.signOut(fresh.access_token, "others");
      expect(await provider.sessionAlive(sid(phone.access_token))).toBe(false);
      expect(await provider.sessionAlive(sid(fresh.access_token))).toBe(true);
      await expect(provider.refresh(refreshed.refresh_token)).rejects.toMatchObject({ code: "invalid_refresh" });

      await provider.signOut(fresh.access_token, "global");
      expect(await provider.sessionAlive(sid(fresh.access_token))).toBe(false);
      expect((await provider.listSessions(user.id)).every((s) => s.ended_at !== null)).toBe(true);

      await provider.deleteUser(user.id);
      expect(await provider.listSessions(user.id)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "the admin lookup by address; a password check leaves no session; a wrong password is refused",
    async () => {
      const provider = p();
      const e = email();
      const pw = password();
      const user = await provider.createUser({ email: e, password: pw });
      created.push(user.id);
      expect(await provider.findUserIdByEmail(e.toUpperCase())).toBe(user.id);
      expect(await provider.findUserIdByEmail(email())).toBeNull();
      expect(await provider.checkPassword(e, pw)).toBe(true);
      expect(await provider.checkPassword(e, "not the password at all")).toBe(false);
      expect(await provider.listSessions(user.id)).toEqual([]);
      await expect(provider.signInWithPassword(e, "not the password at all")).rejects.toBeInstanceOf(AuthError);
    },
    TIMEOUT,
  );

  it(
    "the account flows over the Supabase store: sign up, the lockout, recovery with a single-use code",
    async () => {
      const storeCfg = supabaseStoreConfig();
      expect(storeCfg).not.toBeNull();
      const d: AccountDeps = { store: new SupabaseStore(storeCfg!), auth: p() };
      const login = `live.${randomUUID().slice(0, 8)}`;
      const pw = password();
      const facts = { ip: "203.0.113.7", deviceId: randomBytes(24).toString("base64url"), knownDevice: true, userAgent: "live test" };
      const s = await signUp(
        d,
        {
          login,
          password: pw,
          display_name: "Live",
          locale: "en",
          assisted: false,
          consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "declined", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
          space: "blank",
        },
        facts,
      );
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      created.push(s.signedIn.tokens.user_id);
      for (let i = 1; i <= 4; i++) expect(await logIn(d, { login, password: `wrong ${i} wrong` }, facts)).toMatchObject({ status: 401 });
      expect(await logIn(d, { login, password: "wrong 5 wrong" }, facts)).toMatchObject({ status: 423 });
      const r = await recover(d, { login, code: s.answer.recovery_code, password: `${pw} new` }, facts);
      expect(r.ok).toBe(true);
      expect(await recover(d, { login, code: s.answer.recovery_code, password: `${pw} newer` }, facts)).toMatchObject({ status: 401, error: "invalid_recovery" });
      expect((await logIn(d, { login, password: `${pw} new` }, facts)).ok).toBe(true);
      await d.store.deleteAccount(s.signedIn.tokens.user_id);
    },
    TIMEOUT,
  );
});
