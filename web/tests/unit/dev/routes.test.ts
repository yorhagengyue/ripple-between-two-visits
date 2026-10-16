/**
 * The developer routes (app/api/dev/**; C2 F1 item H): the test clock, a tick of the scheduled jobs, test accounts and
 * test sign-in. A 404 on a production build unless RIPPLE_DEV_TOOLS=1; with it (the integrator's recording build),
 * they work.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as accountsPost } from "@/app/api/dev/accounts/route";
import { GET as clockGet, POST as clockPost } from "@/app/api/dev/clock/route";
import { DELETE as loginDelete, POST as loginPost } from "@/app/api/dev/login/route";
import { POST as tickPost } from "@/app/api/dev/tick/route";
import { GET as medsGet } from "@/app/api/meds/route";
import { getMemoryStore } from "@/lib/store/memory";
import { setTestClock, testClock } from "@/lib/time/now";

const store = getMemoryStore();
const PASSWORD = "a long test password";

function req(p: string, opts: { method?: string; body?: unknown; cookies?: Record<string, string>; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const cookie = Object.entries(opts.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookie) headers.cookie = cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
const login = () => `dev${randomUUID().slice(0, 10)}`;
const cookieValue = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .split(";")[0];

afterEach(() => {
  vi.unstubAllEnvs();
  setTestClock(null);
});

describe("a production build without RIPPLE_DEV_TOOLS=1", () => {
  it("every developer route is a 404, and nothing happens", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const accountsBefore = (await store.listAccountScopes()).length;
    const answers = [
      await clockGet(),
      await clockPost(req("/api/dev/clock", { body: { offset_ms: 86_400_000 } })),
      await tickPost(req("/api/dev/tick", { body: {} })),
      await accountsPost(req("/api/dev/accounts", { body: { login: login(), password: PASSWORD } })),
      await loginPost(req("/api/dev/login", { body: { login: "anyone", password: PASSWORD } })),
      await loginDelete(req("/api/dev/login", { method: "DELETE" })),
    ];
    for (const r of answers) {
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "not_found" });
      expect(r.headers.getSetCookie()).toEqual([]);
    }
    vi.unstubAllEnvs();
    expect(testClock()).toBeNull();
    expect((await store.listAccountScopes()).length).toBe(accountsBefore);
  });
});

describe("with the developer tools on (here: a production build with RIPPLE_DEV_TOOLS=1)", () => {
  const on = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "1");
  };

  it("the clock: jump, advance, read, clear", async () => {
    on();
    const at = "2026-11-03T01:00:00.000Z";
    let r = await clockPost(req("/api/dev/clock", { body: { at, frozen: true } }));
    expect(r.status).toBe(200);
    expect((await r.json()).now).toBe(at);
    r = await clockPost(req("/api/dev/clock", { body: { advance_ms: 3_600_000 } }));
    expect((await r.json()).now).toBe("2026-11-03T02:00:00.000Z");
    expect((await (await clockGet()).json()).now).toBe("2026-11-03T02:00:00.000Z");
    r = await clockPost(req("/api/dev/clock", { body: { clear: true } }));
    expect((await r.json()).clock).toBeNull();
    expect((await clockPost(req("/api/dev/clock", { body: { at: "not a time" } }))).status).toBe(400);
    expect((await clockPost(req("/api/dev/clock", { body: { at, unknown: 1 } }))).status).toBe(400);
  });

  it("an account's today follows the clock at once", async () => {
    on();
    const r = await accountsPost(req("/api/dev/accounts", { body: { login: login(), password: PASSWORD, space: "blank" } }));
    const { user_id } = await r.json();
    const before = (await store.getSession(user_id))!.story_day;
    await clockPost(req("/api/dev/clock", { body: { offset_ms: 2 * 86_400_000 } }));
    expect((await store.getSession(user_id))!.story_day).toBe(before + 2);
  });

  it("a test account: 201, signed in by cookie, a space of its own; the same login twice is 409; a bad login is 400", async () => {
    on();
    const name = login();
    const r = await accountsPost(req("/api/dev/accounts", { body: { login: name, password: PASSWORD, space: "example", display_name: "Mr Tan" } }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ login: name, space: "example", scope: { kind: "account", example_data: true } });
    expect(body.user_id).toMatch(/^[0-9a-f-]{36}$/);
    const at = cookieValue(r, "rp_at");
    expect(at).toBeTruthy();
    expect(cookieValue(r, "rp_rt")).toBeTruthy();
    for (const c of r.headers.getSetCookie()) expect(c).toMatch(/HttpOnly/i);
    // the cookie is his sign-in: the everyday routes answer for his own space, without his id
    const meds = await medsGet(req("/api/meds", { cookies: { rp_at: at! } }));
    expect(meds.status).toBe(200);
    const text = await meds.text();
    expect(text).toContain("amlodipine");
    expect(text).not.toContain(body.user_id);

    const again = await accountsPost(req("/api/dev/accounts", { body: { login: name.toUpperCase(), password: PASSWORD } }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "login_taken" });
    for (const [bad, error] of [
      ["ab", "username_invalid"],
      ["admin", "username_reserved"],
      ["someone@users.ripple.invalid", "email_reserved_domain"],
    ]) {
      const res = await accountsPost(req("/api/dev/accounts", { body: { login: bad, password: PASSWORD } }));
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error, bad).toBe(error);
    }
    expect((await accountsPost(req("/api/dev/accounts", { body: { login: login(), password: PASSWORD, role: "admin" } }))).status).toBe(400);
  });

  it("over https the cookies are Secure", async () => {
    on();
    const r = await accountsPost(req("/api/dev/accounts", { body: { login: login(), password: PASSWORD }, headers: { "x-forwarded-proto": "https" } }));
    expect(r.status).toBe(201);
    for (const c of r.headers.getSetCookie()) expect(c).toMatch(/;\s*Secure/i);
  });

  it("sign-in and sign-out", async () => {
    on();
    const name = login();
    await accountsPost(req("/api/dev/accounts", { body: { login: name, password: PASSWORD } }));
    const ok = await loginPost(req("/api/dev/login", { body: { login: name, password: PASSWORD } }));
    expect(ok.status).toBe(200);
    expect(cookieValue(ok, "rp_at")).toBeTruthy();
    for (const [l, p] of [
      [name, "wrong password"],
      [login(), PASSWORD],
      ["ab", PASSWORD],
    ]) {
      const bad = await loginPost(req("/api/dev/login", { body: { login: l, password: p } }));
      expect(bad.status).toBe(401);
      expect(await bad.json()).toEqual({ error: "invalid_credentials" });
    }
    const out = await loginDelete(req("/api/dev/login", { method: "DELETE" }));
    expect(out.status).toBe(200);
    // rp_at, rp_rt and (track A) rp_since, the signed sign-in time
    expect(out.headers.getSetCookie().filter((c) => /Max-Age=0/i.test(c))).toHaveLength(3);
  });

  it("a tick runs the registered jobs now (the runner's own no-op job here)", async () => {
    on();
    const before = (await store.listOpsRuns("noop")).length;
    const r = await tickPost(req("/api/dev/tick", { body: { names: ["noop"] } }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.reports).toEqual([{ job: "noop", outcome: "ran", counts: { ran: 1 } }]);
    expect((await store.listOpsRuns("noop")).length).toBe(before + 1);
    // not forced: it ran a moment ago
    const again = await (await tickPost(req("/api/dev/tick", { body: { names: ["noop"], force: false } }))).json();
    expect(again.reports).toEqual([{ job: "noop", outcome: "skipped_not_due", counts: {} }]);
  });
});
