/**
 * When the store or the identity provider cannot be read (C2 track A; docs/plan/real-app.md 2.25 「存储读不到：照旧拒绝，
 * 不放行，503」): with a store that throws what lib/store/supabase.ts throws (PostgrestError: no response, a timeout, a
 * 5xx) and a provider that throws AuthError unavailable, every way of telling who a request is for answers 503
 * store_unavailable with a plain body: never 400 / 401 / 404 (a guess), never an unhandled 500, never let through.
 *   - the predicate and the shared error mapper (lib/session/http.ts storeErrorResponse)
 *   - requireSubject, requireUser (lib/subject) on every path: his token, the demo's session id, her link
 *   - the account routes (app/api/auth/**, /api/me) through accountRoute
 *   - the proxy: 503 JSON for an API, one plain sentence for a page; no redirect to the login, no cookie cleared
 *   - the Supabase provider: a registry that does not answer is "could not tell", and a refresh keeps its new tokens
 *   - a page: getPageSubject throws StoreUnavailable (the error boundary says the sentence), never "no session"
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));

import { GET as devicesGet } from "@/app/api/auth/devices/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as helpPost } from "@/app/api/auth/recover/help/route";
import { POST as recoverPost } from "@/app/api/auth/recover/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { GET as dosesGet } from "@/app/api/doses/route";
import { GET as familyViewGet } from "@/app/api/family/view/route";
import { GET as codeGet } from "@/app/api/family/links/[id]/reset-code/route";
import { GET as meGet } from "@/app/api/me/route";
import { AuthError, getAuthProvider, type AuthTokens, type MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { GoTrueAuthProvider } from "@/lib/auth/gotrue";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { refreshSession } from "@/lib/auth/refresh";
import { encodeSince, SINCE_COOKIE } from "@/lib/auth/since";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { storeErrorResponse } from "@/lib/session/http";
import { getMemoryStore } from "@/lib/store/memory";
import { PostgrestError } from "@/lib/store/supabase";
import { StoreError } from "@/lib/store/types";
import { getPageSubject, requireSubject, requireUser } from "@/lib/subject";
import { isStoreUnavailable, STORE_RETRY_AFTER_S, STORE_UNAVAILABLE, STORE_UNAVAILABLE_WORDS, StoreUnavailable } from "@/lib/subject/unavailable";
import { proxy } from "@/proxy";

const store = getMemoryStore();
const auth = () => getAuthProvider() as MemoryAuthProvider;
const PASSWORD = "a long test password";
const down = () => new PostgrestError("read", 0, "network");

function req(p: string, cookies: Record<string, string> = {}, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost${p}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}), ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function account(space: "blank" | "example" | "none" = "blank"): Promise<{ tokens: AuthTokens; userId: string; login: string }> {
  const login = `u${randomUUID().slice(0, 10)}`;
  const a = await createAccountWithSpace(store, auth(), { login, password: PASSWORD, space });
  return { tokens: a.tokens, userId: a.userId, login };
}

/** Every read of the store fails the way a database that does not answer fails. */
function storeDown(): void {
  for (const method of ["getAccount", "getAccountByUsername", "getSession", "getCareLink", "listCareLinks", "rateHit", "getRateWindow", "listKnownDevices", "listAccountEvents"] as const) {
    vi.spyOn(store, method).mockRejectedValue(down());
  }
}

async function expect503(res: Response): Promise<void> {
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: STORE_UNAVAILABLE });
  expect(res.headers.get("retry-after")).toBe(String(STORE_RETRY_AFTER_S));
}

afterEach(() => {
  vi.restoreAllMocks();
  jar.cookies.clear();
});

describe("which errors mean the store could not be read", () => {
  it("no response, a timeout, a 5xx, or the database refusing the server's key; and the provider not answering", () => {
    for (const status of [0, 500, 502, 503, 504, 401, 403, 408, 429]) expect(isStoreUnavailable(new PostgrestError("read account", status, "x")), String(status)).toBe(true);
    expect(isStoreUnavailable(new AuthError("unavailable", "auth sign in: no response"))).toBe(true);
    expect(isStoreUnavailable(new StoreUnavailable("somewhere"))).toBe(true);
  });

  it("an answer is not that: a taken key, a missing row, a malformed query, a wrong password, a plain bug", () => {
    for (const status of [400, 404, 406, 409, 422]) expect(isStoreUnavailable(new PostgrestError("add account", status, "23505")), String(status)).toBe(false);
    for (const code of ["invalid_credentials", "user_exists", "invalid_refresh", "weak_password", "not_found"] as const) expect(isStoreUnavailable(new AuthError(code, "x"))).toBe(false);
    for (const err of [new StoreError("not_found"), new StoreError("conflict"), new Error("boom"), new TypeError("x is not a function"), null, undefined, "PostgrestError", { name: "PostgrestError" }]) {
      expect(isStoreUnavailable(err)).toBe(false);
    }
  });

  it("the shared mapper answers 503 with Retry-After; a taken key is still 409 and a bug is still thrown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect503(storeErrorResponse(down()));
    await expect503(storeErrorResponse(new PostgrestError("list doses", 503, "PGRST002")));
    expect(storeErrorResponse(new StoreError("conflict")).status).toBe(409);
    expect(storeErrorResponse(new StoreError("not_configured")).status).toBe(503);
    expect(() => storeErrorResponse(new Error("boom"))).toThrow("boom");
    expect(() => storeErrorResponse(new PostgrestError("add", 400, "PGRST100"))).toThrow(PostgrestError);
  });
});

describe("who the request is for cannot be read: 503, never a guess", () => {
  it("his token: requireSubject and requireUser answer 503, not 401 not_signed_in and not 404 no_profile", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // sanity: with the store up he is found
    expect((await requireSubject(req("/api/doses", { rp_at: a.tokens.access_token }))).ok).toBe(true);
    storeDown();
    const found = await requireSubject(req("/api/doses", { rp_at: a.tokens.access_token }));
    expect(found.ok).toBe(false);
    if (!found.ok) await expect503(found.res);
    const user = await requireUser(req("/api/family/invites/accept", { rp_at: a.tokens.access_token }));
    expect(user.ok).toBe(false);
    if (!user.ok) await expect503(user.res);
  });

  it("only the account row is unreadable, or only his space: still 503", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const getSession = vi.spyOn(store, "getSession").mockRejectedValue(new PostgrestError("read session", 504, ""));
    const found = await requireSubject(req("/api/doses", { rp_at: a.tokens.access_token }));
    if (found.ok) throw new Error("let through");
    await expect503(found.res);
    getSession.mockRestore();
    vi.spyOn(store, "getAccount").mockRejectedValue(new PostgrestError("read account", 500, "XX000"));
    const again = await requireSubject(req("/api/doses", { rp_at: a.tokens.access_token }));
    if (again.ok) throw new Error("let through");
    await expect503(again.res);
  });

  it("the demo's session id and her link: 503 too, not 404 session_not_found / link_not_found", async () => {
    const s = await store.createSession({ story_day: 3, story_time: "09:00", ttl_hours: 1 });
    const her = await account("none");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storeDown();
    const demo = await requireSubject(req(`/api/doses?session=${s.id}`));
    if (demo.ok) throw new Error("let through");
    await expect503(demo.res);
    const cookieOnly = await requireSubject(req("/api/doses", { rp_session: s.id }));
    if (cookieOnly.ok) throw new Error("let through");
    await expect503(cookieOnly.res);
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(store, "getCareLink").mockRejectedValue(down());
    const link = await requireSubject(req(`/api/family/view?link=${randomUUID()}`, { rp_at: her.tokens.access_token }), { allowFamily: true });
    if (link.ok) throw new Error("let through");
    await expect503(link.res);
  });

  it("a route's own answer: a data route and her view are 503 store_unavailable, with nothing of his in the body", async () => {
    const a = await account("example");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storeDown();
    await expect503(await dosesGet(req("/api/doses", { rp_at: a.tokens.access_token })));
    await expect503(await familyViewGet(req(`/api/family/view?link=${randomUUID()}`, { rp_at: a.tokens.access_token })));
  });

  it("nothing but a request with no identity at all is answered as before (400 no_session): nothing was read", async () => {
    storeDown();
    const none = await requireSubject(req("/api/doses"));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.res.status).toBe(400);
  });

  it("the keys of the identity provider cannot be fetched: could not tell, so 503 (not signed out)", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as Awaited<ReturnType<MemoryAuthProvider["keySet"]>>;
    expect(await verifyAccessToken(a.tokens.access_token, { keys: failing, issuer: auth().issuer() })).toEqual({ ok: false, reason: "no_keys" });
    vi.spyOn(auth(), "keySet").mockResolvedValue(failing);
    const found = await requireSubject(req("/api/doses", { rp_at: a.tokens.access_token }));
    if (found.ok) throw new Error("let through");
    await expect503(found.res);
    const page = await proxy(req("/p/today", { rp_at: a.tokens.access_token }));
    expect(page.status).toBe(503);
    // a token that is simply not valid is still "not signed in"
    vi.restoreAllMocks();
    const bad = await requireSubject(req("/api/doses", { rp_at: `${a.tokens.access_token.slice(0, -6)}AAAAAA` }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect([bad.res.status, await bad.res.json()]).toEqual([401, { error: "not_signed_in" }]);
  });
});

describe("the account routes", () => {
  it("signed in, the store down: /api/me, his devices, the refresh check and her code route are 503, not 401", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await meGet(req("/api/me", { rp_at: a.tokens.access_token }))).status).toBe(200);
    storeDown();
    await expect503(await meGet(req("/api/me", { rp_at: a.tokens.access_token })));
    await expect503(await devicesGet(req("/api/auth/devices", { rp_at: a.tokens.access_token })));
    await expect503(await refreshPost(req("/api/auth/refresh", { rp_at: a.tokens.access_token }, { method: "POST", body: {} })));
    await expect503(await codeGet(req(`/api/family/links/${randomUUID()}/reset-code`, { rp_at: a.tokens.access_token }), { params: Promise.resolve({ id: randomUUID() }) }));
  });

  it("logging in, recovering and asking for family help while the store is down: 503, and no cookie is set", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storeDown();
    for (const res of [
      await loginPost(req("/api/auth/login", {}, { body: { login: a.login, password: PASSWORD } })),
      await recoverPost(req("/api/auth/recover", {}, { body: { login: a.login, code: "ABCD-EFGH-JKLM", password: "another long one 9" } })),
      await helpPost(req("/api/auth/recover/help", {}, { body: { login: a.login } })),
    ]) {
      await expect503(res);
      expect(res.headers.getSetCookie().some((c) => c.startsWith("rp_at="))).toBe(false);
    }
  });

  it("the identity provider down during a log-in: 503 (never 「账号或密码不对」), and the failure is not counted against him", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const counted = vi.spyOn(store, "rateHit");
    vi.spyOn(auth(), "signInWithPassword").mockRejectedValue(new AuthError("unavailable", "auth sign in: no response"));
    const res = await loginPost(req("/api/auth/login", {}, { body: { login: a.login, password: PASSWORD } }));
    await expect503(res);
    // only the per-IP hit was counted: no wrong-password bucket for this login
    expect(counted.mock.calls.map((c) => String(c[0])).filter((b) => b.startsWith("a:lf:") || b.startsWith("a:la:"))).toEqual([]);
  });

  it("a sign-up that fails half way because the store stops answering: 503, and the identity it made is removed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const login = `s${randomUUID().slice(0, 9)}`;
    vi.spyOn(store, "createAccount").mockRejectedValue(new PostgrestError("add account", 0, "network"));
    const removed = vi.spyOn(auth(), "deleteUser");
    const res = await signupPost(
      req("/api/auth/signup", {}, {
        body: {
          login,
          password: PASSWORD,
          display_name: "陈先生",
          locale: "zh-Hans",
          assisted: false,
          consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
          space: "blank",
        },
      }),
    );
    await expect503(res);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("rp_at="))).toBe(false);
  });
});

describe("the proxy", () => {
  it("the session registry does not answer: an API gets 503 JSON, a page one plain sentence; no login redirect, no cookie cleared", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(auth(), "sessionAlive").mockRejectedValue(new AuthError("unavailable", "auth session check: no response"));
    const api = await proxy(req("/api/doses", { rp_at: a.tokens.access_token }));
    await expect503(api);
    expect(api.headers.getSetCookie()).toEqual([]);

    const page = await proxy(req("/p/today?remind=dose-morning", { rp_at: a.tokens.access_token }));
    expect(page.status).toBe(503);
    expect(page.headers.get("location")).toBeNull();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("retry-after")).toBe(String(STORE_RETRY_AFTER_S));
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.getSetCookie()).toEqual([]);
    const html = await page.text();
    expect(html).toContain(STORE_UNAVAILABLE_WORDS["zh-Hans"].title);
    expect(html).toContain(STORE_UNAVAILABLE_WORDS["zh-Hans"].body);
    expect(html).toContain('href="/p/today?remind=dose-morning"'); // 「再试一次」 asks for the same page
    expect(html).not.toContain(a.userId);
    const en = await proxy(req("/p/today", { rp_at: a.tokens.access_token, rp_lang: "en" }));
    expect(await en.text()).toContain(STORE_UNAVAILABLE_WORDS.en.title);
    // a write is answered in JSON whatever the path
    await expect503(await proxy(req("/p/today", { rp_at: a.tokens.access_token }, { method: "POST", body: {} })));
    // public pages too: he carries a token, and who he is cannot be told
    expect((await proxy(req("/login", { rp_at: a.tokens.access_token }))).status).toBe(503);
  });

  it("someone with no account token is not affected by it (the demo and the public pages go on)", async () => {
    vi.spyOn(auth(), "sessionAlive").mockRejectedValue(new AuthError("unavailable", "down"));
    expect((await proxy(req("/login"))).status).toBe(200);
    expect((await proxy(req("/p/today"))).status).toBe(307); // nobody: the login, as always
  });

  it("a refresh that worked while the registry cannot be read: the new tokens are kept on the 503, he is not signed out", async () => {
    const a = await account();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(auth(), "sessionAlive").mockRejectedValue(new AuthError("unavailable", "down"));
    const holder = { rp_rt: a.tokens.refresh_token, [SINCE_COOKIE]: encodeSince({ atMs: Date.now(), ephemeral: false }) };
    const outcome = await refreshSession(req("/api/doses", holder), () => auth());
    expect(outcome?.kind).toBe("refreshed");
    const b = await account();
    const res = await proxy(req("/api/doses", { rp_rt: b.tokens.refresh_token, [SINCE_COOKIE]: encodeSince({ atMs: Date.now(), ephemeral: false }) }));
    expect(res.status).toBe(503);
    const set = res.headers.getSetCookie();
    expect(set.some((c) => c.startsWith("rp_at=") && !/Max-Age=0/i.test(c))).toBe(true);
    expect(set.some((c) => c.startsWith("rp_rt=") && !/Max-Age=0/i.test(c))).toBe(true);
    expect(set.some((c) => /Max-Age=0/i.test(c))).toBe(false);
  });
});

describe("the Supabase provider's session registry", () => {
  const sid = () => randomUUID();
  function provider(answer: () => { status: number; body?: unknown } | "network_down") {
    const fetchImpl = (async () => {
      const a = answer();
      if (a === "network_down") throw new TypeError("fetch failed");
      return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return new GoTrueAuthProvider({ url: `https://p${randomUUID().slice(0, 8)}.example.test`, serviceKey: "service", anonKey: "anon", fetch: fetchImpl });
  }

  it("down or broken: 「could not tell」 (AuthError unavailable), never 「signed out」 and never 「signed in」", async () => {
    for (const p of [provider(() => "network_down"), provider(() => ({ status: 500, body: { code: "XX000" } })), provider(() => ({ status: 503 }))]) {
      const err = await p.sessionAlive(sid()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("unavailable");
      expect(isStoreUnavailable(err)).toBe(true);
    }
    // an open row is signed in, a closed or unknown one is not (answers, not failures)
    expect(await provider(() => ({ status: 200, body: [{ ended_at: null }] })).sessionAlive(sid())).toBe(true);
    expect(await provider(() => ({ status: 200, body: [{ ended_at: "2026-10-10T00:00:00Z" }] })).sessionAlive(sid())).toBe(false);
    expect(await provider(() => ({ status: 200, body: [] })).sessionAlive(sid())).toBe(false);
  });
});

describe("a page", () => {
  it("getPageSubject throws StoreUnavailable (the error boundary says the sentence); it never renders 「no session」", async () => {
    const a = await account();
    jar.cookies.set("rp_at", a.tokens.access_token);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(store, "getAccount").mockRejectedValue(down());
    const err = await getPageSubject().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StoreUnavailable);
    expect((err as StoreUnavailable).digest).toBe("RIPPLE_STORE_UNAVAILABLE");
    expect((err as Error).message).not.toContain(a.userId);
  });

  it("the words: one sentence, what still holds, and how to try again, in both languages; nothing about why", () => {
    for (const w of Object.values(STORE_UNAVAILABLE_WORDS)) {
      expect(w.title.length).toBeGreaterThan(5);
      expect(w.body.length).toBeGreaterThan(10);
      expect(w.retry.length).toBeGreaterThan(1);
      expect(`${w.title}${w.body}`).not.toMatch(/database|supabase|postgres|503|error|数据库|错误/i);
    }
  });
});
