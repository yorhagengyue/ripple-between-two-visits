/**
 * The account routes over HTTP (app/api/auth/**, app/api/me; track A): what the browser gets back. The cookies (rp_at
 * 15 minutes, rp_rt, rp_since, a new rp_device, rp_lang), the refusals with their status and Retry-After, the origin and
 * content-type guard, /api/me without ids, a log-out that ends the token at once. In-memory store and identity.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as checkLoginPost } from "@/app/api/auth/check-login/route";
import { GET as devicesGet } from "@/app/api/auth/devices/route";
import { POST as deviceSignOutPost } from "@/app/api/auth/devices/sign-out/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as passwordPost } from "@/app/api/auth/password/route";
import { POST as recoverPost } from "@/app/api/auth/recover/route";
import { POST as recoveryCodePost } from "@/app/api/auth/recovery-code/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { GET as meGet } from "@/app/api/me/route";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";

const PASSWORD = "plum blossom tea";
const BASE = "http://localhost:3510";

/** A browser: keeps the cookies the answers set. */
class Browser {
  jar = new Map<string, string>();
  constructor(readonly ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1") {}
  cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  keep(res: Response): Response {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [name, ...rest] = pair.split("=");
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) this.jar.delete(name.trim());
      else this.jar.set(name.trim(), rest.join("="));
    }
    return res;
  }
  req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
    const headers: Record<string, string> = { "user-agent": this.ua, ...(init.headers ?? {}) };
    if (this.jar.size) headers.cookie = this.cookie();
    if (init.body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    return new NextRequest(`${BASE}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  }
}

function signupBody(login: string, over: Record<string, unknown> = {}) {
  return {
    login,
    password: PASSWORD,
    display_name: "陈先生",
    locale: "zh-Hans",
    assisted: false,
    consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
    space: "blank",
    ...over,
  };
}

const newLogin = () => `r${randomUUID().slice(0, 9)}`;

async function signedUp(b = new Browser()): Promise<{ b: Browser; login: string; code: string }> {
  const login = newLogin();
  const res = b.keep(await signupPost(b.req("/api/auth/signup", { body: signupBody(login) })));
  expect(res.status).toBe(201);
  return { b, login, code: ((await res.json()) as { recovery_code: string }).recovery_code };
}

describe("sign-up over HTTP", () => {
  it("201 with the code once, and the cookies: rp_at for 15 minutes, rp_rt, rp_since, a device id, his language", async () => {
    const b = new Browser();
    const login = newLogin();
    const res = await signupPost(b.req("/api/auth/signup", { body: signupBody(login, { locale: "en" }) }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const answer = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(answer).sort()).toEqual(["login", "next", "recovery_code"]);
    expect(answer).toMatchObject({ login, next: "/onboard" });
    const set = res.headers.getSetCookie();
    const named = (n: string) => set.find((c) => c.startsWith(`${n}=`)) ?? "";
    expect(named("rp_at")).toMatch(/Max-Age=(899|900);/i); // computed from the clock: a slow machine can cross a second
    expect(named("rp_rt")).toMatch(/Max-Age=2592000/i);
    expect(named("rp_since")).toMatch(/Max-Age=15552000/i);
    expect(named("rp_device")).toMatch(/Max-Age=34560000/i);
    expect(named("rp_lang")).toMatch(/^rp_lang=en;/);
    for (const n of ["rp_at", "rp_rt", "rp_since", "rp_device"]) expect(named(n), n).toMatch(/HttpOnly/i);
  });

  it("the body is checked: missing fields 400, a taken name 409, an old consent text 409", async () => {
    const { b, login } = await signedUp();
    expect((await signupPost(b.req("/api/auth/signup", { body: { login: "x" } }))).status).toBe(400);
    const taken = await signupPost(new Browser().req("/api/auth/signup", { body: signupBody(login) }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "login_taken" });
    const old = await signupPost(new Browser().req("/api/auth/signup", { body: signupBody(newLogin(), { consents: { terms_privacy: { version: "1999-01-01" }, ai_processing: { decision: "granted", version: "1999-01-01" } } }) }));
    expect(old.status).toBe(409);
    expect(await old.json()).toEqual({ error: "consent_version" });
  });

  it("is the name free?", async () => {
    const { login } = await signedUp();
    const b = new Browser();
    expect(await (await checkLoginPost(b.req("/api/auth/check-login", { body: { login: newLogin() } }))).json()).toEqual({ ok: true, kind: "username" });
    const taken = await checkLoginPost(b.req("/api/auth/check-login", { body: { login } }));
    expect([taken.status, await taken.json()]).toEqual([409, { error: "login_taken" }]);
    const bad = await checkLoginPost(b.req("/api/auth/check-login", { body: { login: "root" } }));
    expect([bad.status, await bad.json()]).toEqual([400, { error: "username_reserved" }]);
  });
});

describe("the guard on every POST", () => {
  it("another site's Origin or a cross-site fetch is 403 bad_origin; this site's passes", async () => {
    const b = new Browser();
    const body = { login: newLogin(), password: PASSWORD };
    const refused: Record<string, string>[] = [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { origin: "not a url" }];
    for (const headers of refused) {
      const res = await loginPost(b.req("/api/auth/login", { body, headers }));
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await res.json()).toEqual({ error: "bad_origin" });
    }
    expect((await loginPost(b.req("/api/auth/login", { body, headers: { origin: BASE, "sec-fetch-site": "same-origin" } }))).status).toBe(401);
  });

  it("a form post (not JSON) is 415", async () => {
    const res = await loginPost(new Browser().req("/api/auth/login", { body: { login: "a" }, headers: { "content-type": "text/plain" } }));
    expect(res.status).toBe(415);
  });
});

describe("log in, refresh, log out over HTTP", () => {
  it("a wrong password is 401; the sixth is 423 with when it opens and Retry-After; the browser keeps one device id", async () => {
    const { login } = await signedUp();
    const b = new Browser();
    const first = b.keep(await loginPost(b.req("/api/auth/login", { body: { login, password: "nope nope 1" } })));
    expect([first.status, await first.json()]).toEqual([401, { error: "invalid_credentials" }]);
    const device = b.jar.get("rp_device");
    expect(device).toBeTruthy();
    for (let i = 2; i <= 5; i++) expect((await loginPost(b.req("/api/auth/login", { body: { login, password: `nope nope ${i}` } }))).status).toBe(401);
    const sixth = await loginPost(b.req("/api/auth/login", { body: { login, password: "nope nope 6" } }));
    expect(sixth.status).toBe(423);
    const body = (await sixth.json()) as { error: string; until: string };
    expect(body.error).toBe("locked");
    expect(Date.parse(body.until) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(14 * 60);
    expect(b.jar.get("rp_device")).toBe(device);
    // the right password on this device: still 423; on another browser: in
    expect((await loginPost(b.req("/api/auth/login", { body: { login, password: PASSWORD } }))).status).toBe(423);
    const other = new Browser();
    const ok = other.keep(await loginPost(other.req("/api/auth/login", { body: { login, password: PASSWORD, next: "/p/today" } })));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ next: "/onboard" }); // a blank space whose onboarding is not done
  });

  it("「这不是我的手机」: the sign-in cookies carry no expiry", async () => {
    const { login } = await signedUp();
    const b = new Browser();
    const res = await loginPost(b.req("/api/auth/login", { body: { login, password: PASSWORD, not_my_phone: true } }));
    expect(res.status).toBe(200);
    for (const c of res.headers.getSetCookie().filter((c) => /^(rp_at|rp_rt|rp_since)=/.test(c))) expect(c).not.toMatch(/Max-Age|Expires/i);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("rp_device="))).toMatch(/Max-Age=/i);
  });

  it("/api/me with the cookies (no ids in it); refresh says signed in; log out ends the token at once", async () => {
    const { b, login } = await signedUp();
    const me = await meGet(b.req("/api/me"));
    expect(me.status).toBe(200);
    const text = await me.clone().text();
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); // no user or scope id
    expect(((await me.json()) as { account: { login: string } }).account.login).toBe(login);
    expect((await refreshPost(b.req("/api/auth/refresh", { body: {} }))).status).toBe(200);
    const token = b.jar.get("rp_at")!;
    const out = b.keep(await logoutPost(b.req("/api/auth/logout", { body: {} })));
    expect([out.status, await out.json()]).toEqual([200, { next: "/login" }]);
    expect(b.jar.has("rp_at") || b.jar.has("rp_rt") || b.jar.has("rp_since")).toBe(false);
    expect(b.jar.has("rp_device")).toBe(true);
    // the old token, sent again by hand, is refused: its session ended
    const stale = new Browser();
    stale.jar.set("rp_at", token);
    expect((await meGet(stale.req("/api/me"))).status).toBe(401);
    expect((await refreshPost(stale.req("/api/auth/refresh", { body: {} }))).status).toBe(401);
    expect((await logoutPost(new Browser().req("/api/auth/logout", { body: {} }))).status).toBe(200); // nobody: fine
  });
});

describe("recovery, a new password, a new code, devices over HTTP", () => {
  it("recovery signs this browser in with a new code; the other browser is signed out", async () => {
    const { b: old, login, code } = await signedUp();
    const b = new Browser();
    const res = b.keep(await recoverPost(b.req("/api/auth/recover", { body: { login, code, password: "harbour lights 77" } })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { next: string; recovery_code: string };
    expect(body.recovery_code).not.toBe(code);
    expect((await meGet(b.req("/api/me"))).status).toBe(200);
    expect((await meGet(old.req("/api/me"))).status).toBe(401);
    const again = await recoverPost(new Browser().req("/api/auth/recover", { body: { login, code, password: "harbour lights 78" } }));
    expect([again.status, await again.json()]).toEqual([401, { error: "invalid_recovery" }]);
  });

  it("a new password and a new code need the current password; his devices list and sign-out", async () => {
    const { b, login } = await signedUp();
    const tablet = new Browser("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36");
    tablet.keep(await loginPost(tablet.req("/api/auth/login", { body: { login, password: PASSWORD } })));
    const devices = (await (await devicesGet(b.req("/api/auth/devices"))).json()) as { devices: { ref: string; label: string; current: boolean; signed_in: boolean }[] };
    expect(devices.devices.map((d) => [d.label, d.current, d.signed_in])).toEqual([
      ["iPhone · Safari", true, true],
      ["Android · Chrome", false, true],
    ]);
    const out = await deviceSignOutPost(b.req("/api/auth/devices/sign-out", { body: { device: devices.devices[1].ref } }));
    expect(await out.json()).toEqual({ ended: 1, current: false });
    expect((await meGet(tablet.req("/api/me"))).status).toBe(401);

    expect((await recoveryCodePost(b.req("/api/auth/recovery-code", { body: { password: "wrong one here" } }))).status).toBe(401);
    const code = await recoveryCodePost(b.req("/api/auth/recovery-code", { body: { password: PASSWORD } }));
    expect(code.status).toBe(200);
    expect(((await code.json()) as { recovery_code: string }).recovery_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const pw = b.keep(await passwordPost(b.req("/api/auth/password", { body: { current: PASSWORD, password: "harbour lights 77" } })));
    expect([pw.status, await pw.json()]).toEqual([200, { ok: true }]);
    expect((await meGet(b.req("/api/me"))).status).toBe(200); // this browser goes on, on its new session
    expect((await loginPost(new Browser().req("/api/auth/login", { body: { login, password: "harbour lights 77" } }))).status).toBe(200);
    expect((await passwordPost(new Browser().req("/api/auth/password", { body: { current: PASSWORD, password: "x" } }))).status).toBe(401);
  });
});
