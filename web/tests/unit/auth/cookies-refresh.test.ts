/**
 * The sign-in cookies and keeping him signed in (lib/auth/cookies.ts, lib/auth/refresh.ts, web/proxy.ts; C2 F1 item F,
 * then track A; real-app 3.4):
 *   - rp_at lives 15 minutes at most whatever the token's exp says (Supabase signs hour-long tokens on the project);
 *     rp_rt 30 days (rolling); rp_since (signed) 180 days; all httpOnly, SameSite=Lax, Secure when the request came over
 *     https; 「这不是我的手机」 makes all three session cookies;
 *   - the proxy refreshes when under a minute of the app's 15 minutes is left (or of the token's exp, or the cookie is
 *     gone), and the page or route sees the new token in the same request;
 *   - it signs the browser out on a refused refresh token, a missing or forged rp_since, a sign-in past its limit
 *     (12 hours for 「这不是我的手机」), or a session the registry has closed;
 *   - a valid token is not enough: no account row, or a closed session, is signed out (lib/subject);
 *   - a browser that is nobody is sent from /p/* and /onboard to /login?next= (pages only, never the demo's phones).
 */
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, getAuthProvider, type AuthProvider, type AuthTokens, type MemoryAuthProvider } from "@/lib/auth";
import { ACCESS_COOKIE, authCookies, clearAuthCookies, isSecureRequest, REFRESH_COOKIE, SINCE_COOKIE, setAuthCookies } from "@/lib/auth/cookies";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { accessSecondsLeft } from "@/lib/auth/jwt";
import { forwardedHeaders, refreshSession, REFRESH_WITHIN_S } from "@/lib/auth/refresh";
import { decodeSince, encodeSince, sinceExpired } from "@/lib/auth/since";
import { getMemoryStore } from "@/lib/store/memory";
import { requireSubject } from "@/lib/subject";
import { proxy } from "@/proxy";

const store = getMemoryStore();
const auth = () => getAuthProvider() as MemoryAuthProvider;
const PASSWORD = "a long test password";
const since = (atMs = Date.now(), ephemeral = false) => encodeSince({ atMs, ephemeral });

function req(p: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}, base = "http://localhost"): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`${base}${p}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });
}

async function signedIn(): Promise<AuthTokens> {
  const a = await createAccountWithSpace(store, auth(), { login: `c${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "blank" });
  return a.tokens;
}

/** A refresh-token holder's cookies: the refresh token and a valid rp_since. */
const holder = (t: AuthTokens, extra: Record<string, string> = {}) => ({ rp_rt: t.refresh_token, [SINCE_COOKIE]: since(), ...extra });

afterEach(() => vi.restoreAllMocks());

describe("the cookies", () => {
  it("Secure follows the request: https, or a proxy in front that says so", () => {
    expect(isSecureRequest(req("/", {}, {}, "https://ripple.example.test"))).toBe(true);
    expect(isSecureRequest(req("/", {}, { "x-forwarded-proto": "https" }))).toBe(true);
    expect(isSecureRequest(req("/", {}, { "x-forwarded-proto": "HTTPS, http" }))).toBe(true);
    expect(isSecureRequest(req("/"))).toBe(false);
    expect(isSecureRequest(req("/", {}, { "x-forwarded-proto": "http" }))).toBe(false);
  });

  it("rp_at lives 15 minutes at most even for an hour-long token, rp_rt 30 days, rp_since 180 days; httpOnly, Lax, path /", () => {
    const now = Date.now();
    const hour: AuthTokens = { access_token: "at", refresh_token: "rt", expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user_id: randomUUID() };
    const [at, rt, sn] = authCookies(hour, false, now);
    expect([at[0], rt[0], sn[0]]).toEqual([ACCESS_COOKIE, REFRESH_COOKIE, SINCE_COOKIE]);
    expect(at[2]).toEqual({ path: "/", httpOnly: true, sameSite: "lax", secure: false, maxAge: 900 });
    expect(rt[2]).toEqual({ path: "/", httpOnly: true, sameSite: "lax", secure: false, maxAge: 30 * 24 * 3600 });
    expect(sn[2]).toEqual({ path: "/", httpOnly: true, sameSite: "lax", secure: false, maxAge: 180 * 24 * 3600 });
    expect(decodeSince(sn[1])).toEqual({ atMs: now, ephemeral: false });
    // a token that ends sooner than 15 minutes: its own end
    const short: AuthTokens = { ...hour, expires_at: Math.floor(now / 1000) + 300 };
    expect(authCookies(short, false, now)[0][2].maxAge).toBe(300);
    expect(authCookies(hour, true, now).every(([, , o]) => o.secure)).toBe(true);
  });

  it("「这不是我的手机」: the three sign-in cookies have no expiry (gone when the browser closes)", () => {
    const now = Date.now();
    const tokens: AuthTokens = { access_token: "at", refresh_token: "rt", expires_in: 900, expires_at: Math.floor(now / 1000) + 900, user_id: randomUUID() };
    const cookies = authCookies(tokens, false, now, { atMs: now, ephemeral: true });
    for (const [, , o] of cookies) expect(o.maxAge).toBeUndefined();
    expect(decodeSince(cookies[2][1])).toEqual({ atMs: now, ephemeral: true });
  });

  it("on the wire: HttpOnly and SameSite=lax always, Secure only over https; clearing sets Max-Age=0 on all three", () => {
    const tokens: AuthTokens = { access_token: "at", refresh_token: "rt", expires_in: 900, expires_at: Math.floor(Date.now() / 1000) + 900, user_id: randomUUID() };
    const plain = NextResponse.json({});
    setAuthCookies(plain, tokens, false);
    const secure = NextResponse.json({});
    setAuthCookies(secure, tokens, true);
    for (const c of plain.headers.getSetCookie()) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=lax/i);
      expect(c).not.toMatch(/Secure/i);
    }
    expect(secure.headers.getSetCookie().every((c) => /;\s*Secure/i.test(c))).toBe(true);
    const cleared = NextResponse.json({});
    clearAuthCookies(cleared, false);
    const set = cleared.headers.getSetCookie();
    expect(set.map((c) => c.split("=")[0])).toEqual([ACCESS_COOKIE, REFRESH_COOKIE, SINCE_COOKIE]);
    for (const c of set) expect(c).toMatch(/Max-Age=0/i);
  });
});

describe("rp_since", () => {
  it("is signed: a changed time or flag, another secret, or garbage does not decode", () => {
    const v = encodeSince({ atMs: 1_760_000_000_000, ephemeral: false });
    expect(decodeSince(v)).toEqual({ atMs: 1_760_000_000_000, ephemeral: false });
    expect(decodeSince(v.replace("1760000000000", "1760000000001"))).toBeNull();
    expect(decodeSince(v.replace(".0.", ".1."))).toBeNull();
    expect(decodeSince(v, { AUTH_COOKIE_SECRET: "x".repeat(40) })).toBeNull();
    for (const bad of [undefined, "", "abc", "1.0.", "1.2.xxx"]) expect(decodeSince(bad)).toBeNull();
  });

  it("an ordinary sign-in runs 180 days, 「这不是我的手机」 12 hours; a start in the future is bad", () => {
    const now = Date.now();
    const H = 3600_000;
    expect(sinceExpired({ atMs: now - 179 * 24 * H, ephemeral: false }, now)).toBe(false);
    expect(sinceExpired({ atMs: now - 181 * 24 * H, ephemeral: false }, now)).toBe(true);
    expect(sinceExpired({ atMs: now - 11 * H, ephemeral: true }, now)).toBe(false);
    expect(sinceExpired({ atMs: now - 13 * H, ephemeral: true }, now)).toBe(true);
    expect(sinceExpired({ atMs: now + H, ephemeral: false }, now)).toBe(true);
  });
});

describe("refreshSession: near the end of the app's 15 minutes, trade the refresh token", () => {
  it("does nothing without rp_rt (the demo, anonymous) or with plenty of time left", async () => {
    const t = await signedIn();
    expect(await refreshSession(req("/p/today"), auth)).toBeNull();
    expect(await refreshSession(req("/p/today", { rp_session: "demo-x", rp_role: "patient" }), auth)).toBeNull();
    expect(await refreshSession(req("/p/today", holder(t, { rp_at: t.access_token })), auth)).toBeNull();
  });

  it(`refreshes when the access token has under ${REFRESH_WITHIN_S} s left, or is gone`, async () => {
    const t = await signedIn();
    const gone = await refreshSession(req("/p/today", holder(t)), auth);
    expect(gone?.kind).toBe("refreshed");
    const t2 = await signedIn();
    vi.spyOn(Date, "now").mockReturnValue((t2.expires_at - 30) * 1000);
    const late = await refreshSession(req("/p/today", holder(t2, { rp_at: t2.access_token })), auth);
    expect(late?.kind).toBe("refreshed");
    if (late?.kind === "refreshed") {
      expect(late.tokens.refresh_token).not.toBe(t2.refresh_token);
      expect(late.since.ephemeral).toBe(false);
    }
  });

  it("an hour-long token (Supabase's) is refreshed by its 15th minute, not its 60th", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    void exportJWK;
    const iat = Math.floor(Date.now() / 1000);
    const hourLong = await new SignJWT({ role: "authenticated", session_id: randomUUID() })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(privateKey);
    expect(accessSecondsLeft(hourLong, iat * 1000)).toBe(900);
    expect(accessSecondsLeft(hourLong, (iat + 850) * 1000)).toBe(50); // under a minute of its 15: refresh now
    const refresh = vi.fn(async () => {
      throw new AuthError("unavailable", "down");
    });
    vi.spyOn(Date, "now").mockReturnValue((iat + 850) * 1000);
    await refreshSession(req("/p/today", { rp_at: hourLong, rp_rt: "rt", [SINCE_COOKIE]: since((iat - 10) * 1000) }), () => ({ refresh }) as unknown as AuthProvider);
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockClear();
    vi.spyOn(Date, "now").mockReturnValue((iat + 300) * 1000);
    await refreshSession(req("/p/today", { rp_at: hourLong, rp_rt: "rt", [SINCE_COOKIE]: since((iat - 10) * 1000) }), () => ({ refresh }) as unknown as AuthProvider);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a refused refresh token signs him out; a provider that is down leaves the request as it is", async () => {
    expect(await refreshSession(req("/p/today", { rp_rt: "used-or-forged", [SINCE_COOKIE]: since() }), auth)).toEqual({ kind: "signed_out", secure: false });
    const down = { refresh: async () => Promise.reject(new AuthError("unavailable", "down")) } as unknown as AuthProvider;
    expect(await refreshSession(req("/p/today", { rp_rt: "anything", [SINCE_COOKIE]: since() }), () => down)).toBeNull();
  });

  it("no rp_since, a forged one, or one past its limit: signed out without asking the provider", async () => {
    const t = await signedIn();
    const refresh = vi.spyOn(auth(), "refresh");
    for (const s of [undefined, "1760000000000.0.forgedforgedforgedforgedforgedforgedforged000", since(Date.now() - 181 * 86_400_000), since(Date.now() - 13 * 3600_000, true)]) {
      const cookies: Record<string, string> = { rp_rt: t.refresh_token };
      if (s) cookies[SINCE_COOKIE] = s;
      expect(await refreshSession(req("/p/today", cookies), auth)).toEqual({ kind: "signed_out", secure: false });
    }
    expect(refresh).not.toHaveBeenCalled();
    // 「这不是我的手机」 within its 12 hours refreshes, and stays ephemeral
    const ok = await refreshSession(req("/p/today", { rp_rt: t.refresh_token, [SINCE_COOKIE]: since(Date.now() - 3600_000, true) }), auth);
    expect(ok?.kind === "refreshed" && ok.since.ephemeral).toBe(true);
  });

  it("a session closed in the registry (signed out from another device) is not refreshed", async () => {
    const t = await signedIn();
    await auth().endSessions(t.user_id, { reason: "device_signed_out" });
    expect(await refreshSession(req("/p/today", holder(t)), auth)).toEqual({ kind: "signed_out", secure: false });
  });

  it("forwardedHeaders swaps the sign-in cookies in the request and keeps the others", async () => {
    const t = await signedIn();
    const r = req("/p/today", holder(t, { rp_view: "demo", other: "1" }));
    const out = await refreshSession(r, auth);
    expect(out?.kind).toBe("refreshed");
    if (out?.kind !== "refreshed") return;
    const cookie = forwardedHeaders(r, out).get("cookie")!;
    expect(cookie).toContain(`rp_at=${out.tokens.access_token}`);
    expect(cookie).toContain(`rp_rt=${out.tokens.refresh_token}`);
    expect(cookie).toContain(`${SINCE_COOKIE}=`);
    expect(cookie).toContain("rp_view=demo");
    expect(cookie).toContain("other=1");
    const signedOut = forwardedHeaders(req("/p/today", { rp_at: "x", rp_rt: "y", [SINCE_COOKIE]: "z", other: "1" }), { kind: "signed_out", secure: false });
    expect(signedOut.get("cookie")).toBe("other=1");
    expect(forwardedHeaders(req("/p/today", { rp_rt: "y" }), { kind: "signed_out", secure: false }).get("cookie")).toBeNull();
  });
});

describe("through the proxy", () => {
  it("an expiring session: new cookies on the response, and the route sees the new token in this very request", async () => {
    const t = await signedIn();
    const res = await proxy(req("/api/doses", holder(t)));
    const set = res.headers.getSetCookie();
    const at = set.find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    expect(at).toMatch(/HttpOnly/i);
    expect(at).toMatch(/Max-Age=(899|900);/i); // computed from the clock: a slow machine can cross a second
    expect(set.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(true);
    const newToken = at!.slice(ACCESS_COOKIE.length + 1).split(";")[0];
    expect(res.headers.get("x-middleware-request-cookie")).toContain(`${ACCESS_COOKIE}=${newToken}`);
  });

  it("over https the refreshed cookies are Secure", async () => {
    const t = await signedIn();
    const res = await proxy(req("/api/doses", holder(t), { "x-forwarded-proto": "https" }));
    const set = res.headers.getSetCookie();
    expect(set.length).toBe(3);
    for (const c of set) expect(c).toMatch(/;\s*Secure/i);
  });

  it("a refused refresh token: the sign-in cookies cleared, and the request goes on without them", async () => {
    const res = await proxy(req("/api/doses", { rp_rt: "forged", rp_at: "forged", [SINCE_COOKIE]: since(), rp_view: "demo" }));
    const set = res.headers.getSetCookie();
    expect(set.filter((c) => /Max-Age=0/i.test(c))).toHaveLength(3);
    expect(res.headers.get("x-middleware-request-cookie")).toBe("rp_view=demo");
  });

  it("a signed-in account is not sent to /f by an old demo family cookie on the same phone; naming the demo session is", async () => {
    const s = await store.createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
    const member = await store.addMember(s.id, { role: "family" });
    const herPhone = { rp_session: s.id, rp_member: member.id, rp_role: "family" };
    const t = await signedIn();
    expect((await proxy(req("/p/today", herPhone))).status).toBe(307);
    const signed = await proxy(req("/p/today", { ...herPhone, rp_at: t.access_token }));
    expect(signed.status).toBe(200);
    expect(signed.headers.get("location")).toBeNull();
    // the demo named on purpose, or a token that does not verify: the gate as before
    expect((await proxy(req(`/p/today?session=${s.id}`, { ...herPhone, rp_at: t.access_token }))).status).toBe(307);
    expect((await proxy(req("/p/today", { ...herPhone, rp_at: `${t.access_token.slice(0, -4)}AAAA` }))).status).toBe(307);
  });

  it("nobody signed in: his pages send the browser to /login?next=, and back there afterwards", async () => {
    for (const [path, next] of [
      ["/p/today", "/p/today"],
      ["/p/me/devices", "/p/me/devices"],
      ["/onboard", "/onboard"],
      ["/p/bp?remind=bp&_rsc=abc", "/p/bp?remind=bp"],
    ]) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname).toBe("/login");
      expect(loc.searchParams.get("next"), path).toBe(next);
    }
    // a closed session is nobody too, and its cookies go
    const t = await signedIn();
    await auth().endSessions(t.user_id, { reason: "logout" });
    const closed = await proxy(req("/p/today", { rp_at: t.access_token }));
    expect(closed.status).toBe(307);
    expect(new URL(closed.headers.get("location")!).pathname).toBe("/login");
  });

  it("the redirect is for pages only: APIs answer as before, public pages and the demo's phones pass", async () => {
    expect((await proxy(req("/api/doses"))).status).toBe(200); // the route answers (400 no_session, as before)
    for (const p of ["/", "/login", "/signup", "/recover", "/privacy", "/demo", "/design"]) expect((await proxy(req(p))).status, p).toBe(200);
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    expect((await proxy(req("/p/today", { rp_session: s.id }))).status).toBe(200);
    const t = await signedIn();
    expect((await proxy(req("/p/today", { rp_at: t.access_token }))).status).toBe(200);
    // a POST to a page path is never redirected
    expect((await proxy(new NextRequest("http://localhost/p/today", { method: "POST" }))).status).toBe(200);
  });
});

describe("a valid token is not enough", () => {
  it("a verified token whose user has no account row is signed out (401 not_signed_in), not a new space", async () => {
    const e = `orphan${randomUUID().slice(0, 8)}@example.test`;
    await auth().createUser({ email: e, password: PASSWORD });
    const t = await auth().signInWithPassword(e, PASSWORD);
    const found = await requireSubject(req("/api/doses", { rp_at: t.access_token }));
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.res.status).toBe(401);
      expect(await found.res.json()).toEqual({ error: "not_signed_in" });
    }
  });

  it("a token whose provider session was signed out is refused", async () => {
    const t = await signedIn();
    expect((await requireSubject(req("/api/doses", { rp_at: t.access_token }))).ok).toBe(true);
    await auth().signOut(t.access_token, "local");
    expect((await requireSubject(req("/api/doses", { rp_at: t.access_token }))).ok).toBe(false);
  });

  it("a session ended from the registry (another device signed it out) is refused at once", async () => {
    const t = await signedIn();
    expect((await requireSubject(req("/api/doses", { rp_at: t.access_token }))).ok).toBe(true);
    expect(await auth().endSessions(t.user_id, { reason: "device_signed_out" })).toBe(1);
    expect((await requireSubject(req("/api/doses", { rp_at: t.access_token }))).ok).toBe(false);
  });
});
