/**
 * AUTH_PROVIDER=supabase (lib/auth/gotrue.ts; C2 F1 item F) against a stand-in for GoTrue: no network, no project.
 * The requests have the shape Supabase Auth expects (the server key only on admin calls, the publishable key for sign-in
 * and refresh, his own token to sign out), GoTrue's errors map to the app's codes, an error never carries a key or the
 * project URL, and its tokens verify against the project's JWKS.
 */
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, getAuthProvider, GoTrueAuthProvider, goTrueConfig } from "@/lib/auth";
import { verifyAccessToken } from "@/lib/auth/jwt";

const SERVICE = "service-key-SECRET-1234";
const ANON = "anon-key-public-5678";

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function stand(answer: (req: Seen) => { status: number; body?: unknown } | "network_down") {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const req: Seen = { method: init?.method ?? "GET", url: String(input), headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(req);
    const a = answer(req);
    if (a === "network_down") throw new TypeError("fetch failed");
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const url = () => `https://p${randomUUID().slice(0, 8)}.example.test`;
/** A JWT-shaped access token (not signed: the provider only reads its session_id and sub without verifying). */
const fakeJwt = (claims: Record<string, unknown>) =>
  [{ alg: "ES256", typ: "JWT" }, claims].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".") + ".sig";
const tokenAnswer = (userId: string, sessionId: string = randomUUID()) => ({
  access_token: fakeJwt({ sub: userId, session_id: sessionId, role: "authenticated" }),
  refresh_token: "rt",
  expires_in: 3600,
  expires_at: 2_000_000_000,
  token_type: "bearer",
  user: { id: userId },
});

afterEach(() => vi.unstubAllGlobals());

describe("configuration", () => {
  it("needs the URL and both keys; the issuer is <url>/auth/v1", () => {
    expect(goTrueConfig({ SUPABASE_URL: "https://x.example.test/", SUPABASE_SERVICE_KEY: "s" })).toBeNull();
    const cfg = goTrueConfig({ SUPABASE_URL: "https://x.example.test/", SUPABASE_SERVICE_KEY: "s", SUPABASE_ANON_KEY: "a" });
    expect(cfg).toEqual({ url: "https://x.example.test", serviceKey: "s", anonKey: "a" });
    expect(new GoTrueAuthProvider(cfg!).issuer()).toBe("https://x.example.test/auth/v1");
    expect(() => getAuthProvider({ AUTH_PROVIDER: "supabase" })).toThrow(AuthError);
  });
});

describe("requests", () => {
  it("creating a user: admin API with the server key, the address confirmed, no mail", async () => {
    const id = randomUUID();
    const base = url();
    const { seen, fetchImpl } = stand(() => ({ status: 200, body: { id, email: "tan@users.ripple.invalid", app_metadata: { login_kind: "username" } } }));
    const p = new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: fetchImpl });
    const u = await p.createUser({ email: "tan@users.ripple.invalid", password: "pw", app_metadata: { login_kind: "username" } });
    expect(u).toEqual({ id, email: "tan@users.ripple.invalid", app_metadata: { login_kind: "username" } });
    expect(seen[0]).toMatchObject({ method: "POST", url: `${base}/auth/v1/admin/users`, body: { email: "tan@users.ripple.invalid", password: "pw", email_confirm: true } });
    expect(seen[0].headers).toMatchObject({ apikey: SERVICE, authorization: `Bearer ${SERVICE}` });
  });

  it("sign-in and refresh use the publishable key at GoTrue, sign-out his own token; the registry alone gets the server key", async () => {
    const id = randomUUID();
    const sid = randomUUID();
    const base = url();
    const answer = tokenAnswer(id, sid);
    const { seen, fetchImpl } = stand((r) => (r.url.includes("/logout") ? { status: 204 } : r.url.includes("/rest/v1/") ? { status: r.method === "PATCH" ? 200 : 201, body: [] } : { status: 200, body: answer }));
    const p = new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: fetchImpl });
    expect(await p.signInWithPassword("tan@users.ripple.invalid", "pw", { deviceHash: "a".repeat(64), deviceLabel: "iPhone · Safari" })).toEqual({
      access_token: answer.access_token,
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: 2_000_000_000,
      user_id: id,
    });
    await p.refresh("rt-1");
    await p.signOut(answer.access_token, "others");
    expect(seen.map((s) => `${s.method} ${s.url.slice(base.length)}`)).toEqual([
      "POST /auth/v1/token?grant_type=password",
      "POST /rest/v1/account_session?on_conflict=session_id",
      "POST /auth/v1/token?grant_type=refresh_token",
      `PATCH /rest/v1/account_session?session_id=eq.${sid}&ended_at=is.null`,
      "POST /auth/v1/logout?scope=others",
      `PATCH /rest/v1/account_session?user_id=eq.${id}&ended_at=is.null&select=session_id&session_id=neq.${sid}`,
    ]);
    expect(seen[0].body).toEqual({ email: "tan@users.ripple.invalid", password: "pw" });
    expect(seen[1].body).toMatchObject({ session_id: sid, user_id: id, device_hash: "a".repeat(64), device_label: "iPhone · Safari", ephemeral: false });
    expect(seen[2].body).toEqual({ refresh_token: "rt-1" });
    expect(seen[5].body).toMatchObject({ ended_reason: "logout_others" });
    for (const i of [0, 2]) expect(seen[i].headers).toMatchObject({ apikey: ANON, authorization: `Bearer ${ANON}` });
    expect(seen[4].headers).toMatchObject({ apikey: ANON, authorization: `Bearer ${answer.access_token}` });
    for (const s of seen) {
      const isRegistry = s.url.startsWith(`${base}/rest/v1/`);
      expect(JSON.stringify(s.headers).includes(SERVICE), s.url).toBe(isRegistry);
    }
  });

  it("password change and deletion are admin calls on the user's id", async () => {
    const base = url();
    const { seen, fetchImpl } = stand(() => ({ status: 200, body: {} }));
    const p = new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: fetchImpl });
    const id = randomUUID();
    await p.updatePassword(id, "new pw");
    await p.deleteUser(id);
    expect(seen.map((s) => `${s.method} ${s.url.slice(base.length)}`)).toEqual([`PUT /auth/v1/admin/users/${id}`, `DELETE /auth/v1/admin/users/${id}`]);
    expect(seen[0].body).toEqual({ password: "new pw" });
    for (const s of seen) expect(s.headers.apikey).toBe(SERVICE);
  });
});

describe("errors", () => {
  async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
    try {
      await p;
      return { code: "ok", message: "" };
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      return { code: (err as AuthError).code, message: (err as AuthError).message };
    }
  }

  it("GoTrue's codes become the app's; the message has no key, no URL and no body", async () => {
    const base = url();
    const cases: [number, unknown, (p: GoTrueAuthProvider) => Promise<unknown>, string][] = [
      [422, { code: 422, error_code: "email_exists", msg: `taken; key ${SERVICE}` }, (p) => p.createUser({ email: "a@b.example", password: "pw" }), "user_exists"],
      [422, { error_code: "weak_password" }, (p) => p.createUser({ email: "a@b.example", password: "pw" }), "weak_password"],
      [400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }, (p) => p.signInWithPassword("a@b.example", "pw"), "invalid_credentials"],
      [400, { error: "invalid_grant", error_description: "Email not confirmed" }, (p) => p.signInWithPassword("a@b.example", "pw"), "invalid_credentials"],
      [400, { error_code: "refresh_token_already_used" }, (p) => p.refresh("rt"), "invalid_refresh"],
      [400, { error_code: "refresh_token_not_found" }, (p) => p.refresh("rt"), "invalid_refresh"],
      [500, "not json", (p) => p.refresh("rt"), "unavailable"],
      [404, { error_code: "user_not_found" }, (p) => p.updatePassword(randomUUID(), "pw"), "not_found"],
    ];
    for (const [status, body, call, want] of cases) {
      const { fetchImpl } = stand(() => ({ status, body }));
      const got = await codeOf(call(new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: fetchImpl })));
      expect(got.code, JSON.stringify(body)).toBe(want);
      expect(got.message).not.toContain(SERVICE);
      expect(got.message).not.toContain(ANON);
      expect(got.message).not.toContain(base);
      expect(got.message).not.toMatch(/taken|Invalid login|Email not confirmed/);
    }
  });

  it("no answer at all is unavailable; an ended session signs out quietly; a user already gone is deleted", async () => {
    const down = stand(() => "network_down");
    const p = new GoTrueAuthProvider({ url: url(), serviceKey: SERVICE, anonKey: ANON, fetch: down.fetchImpl });
    expect((await codeOf(p.signInWithPassword("a@b.example", "pw"))).code).toBe("unavailable");
    const ended = stand(() => ({ status: 401, body: { error_code: "session_not_found" } }));
    await expect(new GoTrueAuthProvider({ url: url(), serviceKey: SERVICE, anonKey: ANON, fetch: ended.fetchImpl }).signOut("t")).resolves.toBeUndefined();
    const gone = stand(() => ({ status: 404, body: { error_code: "user_not_found" } }));
    await expect(new GoTrueAuthProvider({ url: url(), serviceKey: SERVICE, anonKey: ANON, fetch: gone.fetchImpl }).deleteUser(randomUUID())).resolves.toBeUndefined();
  });
});

describe("its tokens", () => {
  it("verify against the project's JWKS (<url>/auth/v1/.well-known/jwks.json) and its issuer", async () => {
    const base = url();
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "project-key", alg: "ES256", use: "sig" };
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      asked.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const p = new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON });
    const sub = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ aud: "authenticated", role: "authenticated", session_id: randomUUID(), is_anonymous: false, email: "tan@users.ripple.invalid" })
      .setProtectedHeader({ alg: "ES256", kid: "project-key", typ: "JWT" })
      .setIssuer(`${base}/auth/v1`)
      .setSubject(sub)
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(privateKey);
    const r = await verifyAccessToken(token, { keys: await p.keySet(), issuer: p.issuer() });
    expect(r.ok && r.token.sub).toBe(sub);
    expect(asked).toEqual([`${base}/auth/v1/.well-known/jwks.json`]);
  });
});

describe("the session registry (public.account_session through PostgREST, track A)", () => {
  const sid = () => randomUUID();
  const provider = (answer: (req: Seen) => { status: number; body?: unknown } | "network_down") => {
    const base = url();
    const s = stand(answer);
    return { base, seen: s.seen, p: new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: s.fetchImpl }) };
  };

  it("a session is alive while its row is open; the answer is kept 30 s; no row or a closed one is not alive", async () => {
    const open = sid();
    const closed = sid();
    const { seen, p } = provider((r) => ({
      status: 200,
      body: r.url.includes(open) ? [{ ended_at: null }] : r.url.includes(closed) ? [{ ended_at: "2026-10-10T01:00:00Z" }] : [],
    }));
    expect(await p.sessionAlive(open)).toBe(true);
    expect(await p.sessionAlive(open)).toBe(true);
    expect(seen.filter((s) => s.url.includes(open))).toHaveLength(1); // cached
    expect(seen[0].url).toContain(`/rest/v1/account_session?session_id=eq.${open}&select=ended_at`);
    expect(seen[0].headers).toMatchObject({ apikey: SERVICE, authorization: `Bearer ${SERVICE}` });
    expect(await p.sessionAlive(closed)).toBe(false);
    expect(await p.sessionAlive(sid())).toBe(false);
    const before = seen.length;
    expect(await p.sessionAlive(null)).toBe(false);
    expect(await p.sessionAlive("not-a-uuid")).toBe(false);
    expect(seen.length).toBe(before); // nothing asked for those
  });

  it("the table not there yet (the migration not applied): alive, with a warning; the registry down: could not tell", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = provider(() => ({ status: 404, body: { code: "PGRST205", message: "Could not find the table" } }));
    expect(await missing.p.sessionAlive(sid())).toBe(true);
    expect(warn).toHaveBeenCalled();
    // real-app 2.25: a registry that does not answer is neither "signed in" nor "signed out" (a hiccup must not log
    // him out); the caller refuses with 503 (tests/unit/auth/unavailable.test.ts)
    const down = provider(() => "network_down");
    await expect(down.p.sessionAlive(sid())).rejects.toMatchObject({ name: "AuthError", code: "unavailable" });
    const broken = provider(() => ({ status: 500, body: { code: "XX000" } }));
    await expect(broken.p.sessionAlive(sid())).rejects.toMatchObject({ name: "AuthError", code: "unavailable" });
  });

  it("ending sessions: by id, by device, all but one; the count comes back and this process forgets them at once", async () => {
    const a = sid();
    const b = sid();
    const user = randomUUID();
    let ended = false;
    const { seen, p } = provider((r) => {
      if (r.method === "PATCH") {
        ended = true;
        return { status: 200, body: [{ session_id: a }] };
      }
      return { status: 200, body: ended ? [{ ended_at: "2026-10-10T01:00:00Z" }] : [{ ended_at: null }] };
    });
    expect(await p.sessionAlive(a)).toBe(true);
    expect(await p.endSessions(user, { sessionIds: [a, b, "junk"], exceptSessionId: b, reason: "logout" })).toBe(1);
    const patch = seen.find((s) => s.method === "PATCH")!;
    expect(patch.url).toContain(`user_id=eq.${user}&ended_at=is.null&select=session_id&session_id=in.(${a})`);
    expect(patch.body).toMatchObject({ ended_reason: "logout" });
    expect(patch.headers.prefer).toBe("return=representation");
    expect(await p.sessionAlive(a)).toBe(false); // asked again, not the cached yes
    await p.endSessions(user, { deviceHash: "b".repeat(64), reason: "device_signed_out" });
    expect(seen.at(-1)!.url).toContain(`device_hash=eq.${"b".repeat(64)}`);
    await p.endSessions(user, { exceptSessionId: a, reason: "password_changed" });
    expect(seen.at(-1)!.url).toContain(`session_id=neq.${a}`);
    const n = seen.length;
    expect(await p.endSessions(user, { sessionIds: [], reason: "logout" })).toBe(0);
    expect(await p.endSessions("not-a-user", { reason: "logout" })).toBe(0);
    expect(seen.length).toBe(n);
  });

  it("a sign-in the registry cannot record is ended at GoTrue and refused; without the table it goes through", async () => {
    const id = randomUUID();
    const broken = provider((r) => (r.url.includes("/rest/v1/") ? { status: 500, body: { code: "XX000" } } : r.url.includes("/logout") ? { status: 204 } : { status: 200, body: tokenAnswer(id) }));
    await expect(broken.p.signInWithPassword("tan@users.ripple.invalid", "pw")).rejects.toMatchObject({ code: "unavailable" });
    expect(broken.seen.map((s) => s.url.slice(broken.base.length))).toContain("/auth/v1/logout?scope=local");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = provider((r) => (r.url.includes("/rest/v1/") ? { status: 404, body: { code: "PGRST205" } } : { status: 200, body: tokenAnswer(id) }));
    await expect(missing.p.signInWithPassword("tan@users.ripple.invalid", "pw")).resolves.toMatchObject({ user_id: id });
    const noSession = provider(() => ({ status: 200, body: { ...tokenAnswer(id), access_token: fakeJwt({ sub: id }) } }));
    await expect(noSession.p.signInWithPassword("tan@users.ripple.invalid", "pw")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("his sessions are listed oldest first, timestamps as ISO strings", async () => {
    const user = randomUUID();
    const row = {
      session_id: sid(),
      user_id: user,
      device_hash: null,
      device_label: null,
      ephemeral: true,
      created_at: "2026-10-10T01:00:00+00:00",
      last_seen_at: "2026-10-10T01:05:00+00:00",
      ended_at: null,
      ended_reason: null,
    };
    const { seen, p } = provider(() => ({ status: 200, body: [row] }));
    expect(await p.listSessions(user)).toEqual([{ ...row, created_at: "2026-10-10T01:00:00.000Z", last_seen_at: "2026-10-10T01:05:00.000Z" }]);
    expect(seen[0].url).toContain(`user_id=eq.${user}`);
    expect(seen[0].url).toContain("order=seq.asc");
  });
});

describe("finding a user, checking a password (track A)", () => {
  it("finds a user by address through the admin list, an exact match only, page by page", async () => {
    const base = url();
    const want = randomUUID();
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), email: `chen.tan${i}@users.ripple.invalid` }));
    const { seen, fetchImpl } = stand((r) => ({ status: 200, body: { users: r.url.includes("page=1&") ? page1 : [{ id: want, email: "chen.tan@users.ripple.invalid" }] } }));
    const p = new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: fetchImpl });
    expect(await p.findUserIdByEmail("Chen.Tan@users.ripple.invalid")).toBe(want);
    expect(seen.map((s) => s.url.slice(base.length))).toEqual([
      "/auth/v1/admin/users?page=1&per_page=100&filter=chen.tan%40users.ripple.invalid",
      "/auth/v1/admin/users?page=2&per_page=100&filter=chen.tan%40users.ripple.invalid",
    ]);
    for (const s of seen) expect(s.headers.apikey).toBe(SERVICE);
    const none = stand(() => ({ status: 200, body: { users: [{ id: randomUUID(), email: "chen.tan2@users.ripple.invalid" }] } }));
    expect(await new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: none.fetchImpl }).findUserIdByEmail("chen.tan@users.ripple.invalid")).toBeNull();
    expect(await p.findUserIdByEmail("no-at-sign")).toBeNull();
  });

  it("checking a password leaves no session behind; a wrong one is false, anything else is an error", async () => {
    const base = url();
    const id = randomUUID();
    const answer = tokenAnswer(id);
    const right = stand((r) => (r.url.includes("/logout") ? { status: 204 } : { status: 200, body: answer }));
    expect(await new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: right.fetchImpl }).checkPassword("a@b.example", "pw")).toBe(true);
    expect(right.seen.map((s) => `${s.method} ${s.url.slice(base.length)}`)).toEqual(["POST /auth/v1/token?grant_type=password", "POST /auth/v1/logout?scope=local"]);
    expect(right.seen[1].headers.authorization).toBe(`Bearer ${answer.access_token}`);
    const wrong = stand(() => ({ status: 400, body: { error_code: "invalid_credentials" } }));
    expect(await new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: wrong.fetchImpl }).checkPassword("a@b.example", "pw")).toBe(false);
    const down = stand(() => "network_down");
    await expect(new GoTrueAuthProvider({ url: base, serviceKey: SERVICE, anonKey: ANON, fetch: down.fetchImpl }).checkPassword("a@b.example", "pw")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
