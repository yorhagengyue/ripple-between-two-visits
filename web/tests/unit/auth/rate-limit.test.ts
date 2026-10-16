/**
 * The limits table of docs/plan/real-app.md 3.5, row by row for the account routes (track A; 8.2 「单元 auth/rate-limit」),
 * with the real numbers (no developer-tools loosening: env NODE_ENV=production). Each row: what is counted, where it
 * stops, what the answer is, and that the neighbouring bucket is not touched.
 *
 *   登录失败，每「账号 × 设备或 IP」   15 分钟 5 次，这一台锁 15 分钟     423 + until       service.test.ts (the sixth locks)
 *   登录失败，每账号（所有设备合计）    1 小时内第 10 次起先等 2、4、8…60 秒   照常判断         service.test.ts (the slow-down)
 *   登录，每 IP                        15 分钟 30 次                          429               here
 *   注册，每 IP                        每小时 5、每天 20；全站每天 300         429               here
 *   注册并铺示例资料，每 IP            每小时 3                               429               here
 *   恢复码，每账号 / 每 IP             每小时 5 / 20                          429               here
 *   家人协助重设，每账号               每天 3                                 429               reset-assist.test.ts
 *   接受邀请，每 IP                    每小时 20                              429               here (track D's route)
 * The remaining rows (the demo sandbox, asking, label reads, captions, upload links, export, spend) belong to the
 * tracks that own those routes.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { getAuthProvider } from "@/lib/auth";
import type { SignupBody } from "@/lib/auth/api";
import { accountCopy } from "@/lib/auth/copy";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { newDeviceId } from "@/lib/auth/device";
import { bucketKey, DEV_LIMIT_FACTOR, hitLimit, LIMITS, slowdownMs, SLOWDOWN_STEPS_S } from "@/lib/auth/limits";
import { MemoryAuthProvider } from "@/lib/auth/memory";
import { logIn, recover, signUp, type AccountDeps, type RequestFacts } from "@/lib/auth/service";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";

const PASSWORD = "plum blossom tea";
const PROD = { NODE_ENV: "production" };

let clock = Date.parse("2026-10-10T02:00:00.000Z");
function deps(): AccountDeps & { store: MemoryStore; auth: MemoryAuthProvider } {
  return { store: new MemoryStore({ now: () => new Date(clock) }), auth: new MemoryAuthProvider(), env: PROD, wait: async () => undefined, now: () => clock };
}
const phone = (ip: string, over: Partial<RequestFacts> = {}): RequestFacts => ({ ip, deviceId: newDeviceId(), knownDevice: true, userAgent: null, ...over });
const login = () => `rl${randomUUID().slice(0, 8)}`;
function body(space: SignupBody["space"] = "blank"): SignupBody {
  return {
    login: login(),
    password: PASSWORD,
    display_name: "陈先生",
    locale: "zh-Hans",
    assisted: false,
    consents: {
      terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy },
      ai_processing: { decision: "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing },
      ...(space === "example" ? { example_data: { version: CURRENT_CONSENT_VERSIONS.example_data } } : {}),
    },
    space,
  };
}
const ipKey = (ip: string) => bucketKey("ip", ip, PROD);
/** Fill a bucket up to n hits without doing the slow work each hit stands for. */
async function fill(store: MemoryStore, bucket: string, windowS: number, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await store.rateHit(bucket, windowS, 1_000_000);
}

afterEach(() => vi.restoreAllMocks());

describe("the numbers are the design's", () => {
  it("every row of real-app 3.5 that lib/auth/limits.ts holds", () => {
    expect(LIMITS.loginFailures).toEqual({ windowS: 900, limit: 5 }); // five answered, the sixth locks
    expect(LIMITS.loginLock.windowS).toBe(900);
    expect(LIMITS.loginSlowdown).toEqual({ windowS: 3600, limit: 9 }); // nine unslowed, from the tenth on a wait
    expect([...SLOWDOWN_STEPS_S]).toEqual([2, 4, 8, 16, 32, 60]);
    expect(LIMITS.loginPerIp).toEqual({ windowS: 900, limit: 30 });
    expect(LIMITS.signupPerIpHour).toEqual({ windowS: 3600, limit: 5 });
    expect(LIMITS.signupPerIpDay).toEqual({ windowS: 86_400, limit: 20 });
    expect(LIMITS.signupSiteDay).toEqual({ windowS: 86_400, limit: 300 });
    expect(LIMITS.examplePerIpHour).toEqual({ windowS: 3600, limit: 3 });
    expect(LIMITS.recoverPerLogin).toEqual({ windowS: 3600, limit: 5 });
    expect(LIMITS.recoverPerIp).toEqual({ windowS: 3600, limit: 20 });
    expect(LIMITS.familyResetRequests).toEqual({ windowS: 86_400, limit: 3 });
    expect(LIMITS.familyResetCodes).toEqual({ windowS: 86_400, limit: 3 });
    expect(LIMITS.acceptInvitePerIp).toEqual({ windowS: 3600, limit: 20 });
  });

  it("the slow-down: nothing for the first nine wrong passwords, then 2, 4, 8, 16, 32, 60 and 60 from then on", () => {
    for (let n = 0; n <= 8; n++) expect(slowdownMs(n), String(n)).toBe(0);
    expect([9, 10, 11, 12, 13, 14, 15, 50, 1000].map(slowdownMs)).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000]);
    for (const odd of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) expect(slowdownMs(odd)).toBe(0);
  });

  it("the developer tools loosen only the per-IP limits (100 times), never a lock or the slow-down", async () => {
    const store = new MemoryStore({ now: () => new Date(clock) });
    for (let i = 1; i <= LIMITS.loginPerIp.limit; i++) expect((await hitLimit(store, "b:prod", LIMITS.loginPerIp, PROD)).ok).toBe(true);
    expect((await hitLimit(store, "b:prod", LIMITS.loginPerIp, PROD)).ok).toBe(false);
    for (let i = 1; i <= LIMITS.loginPerIp.limit + 1; i++) expect((await hitLimit(store, "b:dev", LIMITS.loginPerIp, { NODE_ENV: "test" })).ok).toBe(true);
    expect(DEV_LIMIT_FACTOR).toBe(100);
    // the lock with the developer tools on: still the sixth wrong password
    const d = { ...deps(), env: { NODE_ENV: "test" } };
    const b = body();
    await signUp(d, b, phone("10.1.0.1"));
    const his = phone("10.1.0.2");
    for (let i = 1; i <= 5; i++) expect(await logIn(d, { login: b.login, password: `wrong ${i} wrong` }, his)).toMatchObject({ status: 401 });
    expect(await logIn(d, { login: b.login, password: "wrong 6 wrong" }, his)).toMatchObject({ status: 423 });
  });
});

describe("登录，每 IP：15 分钟 30 次", () => {
  it("the 31st attempt from one address in 15 minutes is 429 with when to come back, right password or not; another address is free", async () => {
    const d = deps();
    const b = body();
    await signUp(d, b, phone("10.2.0.9"));
    const start = clock;
    // thirty attempts from one address (each on a new phone and another login, so no lock and no slow-down is in play)
    for (let i = 1; i <= 30; i++) expect(await logIn(d, { login: login(), password: "nobody here 123" }, phone("10.2.0.1")), String(i)).toMatchObject({ status: 401 });
    const tried = vi.spyOn(d.auth, "signInWithPassword");
    expect(await logIn(d, { login: b.login, password: PASSWORD }, phone("10.2.0.1"))).toEqual({ ok: false, status: 429, error: "too_many", until: new Date(start + 15 * 60_000).toISOString() });
    expect(tried).not.toHaveBeenCalled();
    expect((await logIn(d, { login: b.login, password: PASSWORD }, phone("10.2.0.2"))).ok).toBe(true);
    clock = start + 15 * 60_000 + 1000;
    expect((await logIn(d, { login: b.login, password: PASSWORD }, phone("10.2.0.1"))).ok).toBe(true);
  });
});

describe("注册，每 IP：每小时 5、每天 20；全站每天 300；铺示例资料每小时 3", () => {
  it("the sixth sign-up from one address within the hour is 429 and makes nothing; an hour later it works", async () => {
    const d = deps();
    const start = clock;
    for (let i = 1; i <= 5; i++) expect((await signUp(d, body(), phone("10.3.0.1"))).ok, String(i)).toBe(true);
    const made = vi.spyOn(d.auth, "createUser");
    expect(await signUp(d, body(), phone("10.3.0.1"))).toEqual({ ok: false, status: 429, error: "too_many", until: new Date(start + 3600_000).toISOString() });
    expect(made).not.toHaveBeenCalled();
    expect((await signUp(d, body(), phone("10.3.0.2"))).ok).toBe(true); // another address
    clock = start + 3600_000 + 1000;
    expect((await signUp(d, body(), phone("10.3.0.1"))).ok).toBe(true);
  });

  it("twenty in a day from one address: the 21st is 429 until the day's window ends, even spread over the hours", async () => {
    const d = deps();
    const start = clock;
    await fill(d.store, `a:sd:${ipKey("10.3.1.1")}`, 86_400, 20);
    expect(await signUp(d, body(), phone("10.3.1.1"))).toEqual({ ok: false, status: 429, error: "too_many", until: new Date(start + 86_400_000).toISOString() });
    clock = start + 86_400_000 + 1000;
    expect((await signUp(d, body(), phone("10.3.1.1"))).ok).toBe(true);
  });

  it("the whole site: 300 a day, then everyone is 429", async () => {
    const d = deps();
    await fill(d.store, "a:ss", 86_400, 299);
    expect((await signUp(d, body(), phone("10.3.2.1"))).ok).toBe(true); // the 300th
    expect(await signUp(d, body(), phone("10.3.2.2"))).toMatchObject({ ok: false, status: 429, error: "too_many" });
  });

  it("with Mr Tan's example data: three an hour per address; a blank sign-up from there still works", async () => {
    const d = deps();
    for (let i = 1; i <= 3; i++) expect((await signUp(d, body("example"), phone("10.3.3.1"))).ok, String(i)).toBe(true);
    expect(await signUp(d, body("example"), phone("10.3.3.1"))).toMatchObject({ ok: false, status: 429, error: "too_many" });
    expect((await signUp(d, body("blank"), phone("10.3.3.1"))).ok).toBe(true);
  });

  it("the sign-up screen's words for it: 「这台设备今天注册太多次了」 with when to come back", () => {
    expect(accountCopy("zh-Hans").signupTooMany("10:35")).toBe("这台设备今天注册太多次了，10:35 以后再试。");
    expect(accountCopy("en").signupTooMany("10:35")).toBe("Too many sign-ups from this device today. Try again after 10:35.");
  });
});

describe("恢复码，每账号 / 每 IP：每小时 5 / 20", () => {
  it("five tries an hour for one account whatever the address; the sixth is 429 even with the right code", async () => {
    const d = deps();
    const b = body();
    const s = await signUp(d, b, phone("10.4.0.1"));
    if (!s.ok) throw new Error("sign-up");
    const start = clock;
    for (let i = 1; i <= 5; i++) expect(await recover(d, { login: b.login, code: "ABCD-EFGH-JKLM", password: "another long one 9" }, phone(`10.4.1.${i}`)), String(i)).toMatchObject({ status: 401, error: "invalid_recovery" });
    expect(await recover(d, { login: b.login, code: s.answer.recovery_code, password: "another long one 9" }, phone("10.4.1.9"))).toEqual({ ok: false, status: 429, error: "too_many", until: new Date(start + 3600_000).toISOString() });
    // another account is not limited by this one
    const other = body();
    const so = await signUp(d, other, phone("10.4.0.2"));
    if (!so.ok) throw new Error("sign-up");
    expect((await recover(d, { login: other.login, code: so.answer.recovery_code, password: "another long one 9" }, phone("10.4.1.9"))).ok).toBe(true);
    clock = start + 3600_000 + 1000;
    expect((await recover(d, { login: b.login, code: s.answer.recovery_code, password: "another long one 9" }, phone("10.4.1.9"))).ok).toBe(true);
  });

  it("twenty tries an hour from one address over any accounts; the 21st is 429", async () => {
    const d = deps();
    for (let i = 1; i <= 20; i++) expect(await recover(d, { login: login(), code: "ABCD-EFGH-JKLM", password: "another long one 9" }, phone("10.4.2.1")), String(i)).toMatchObject({ status: 401 });
    expect(await recover(d, { login: login(), code: "ABCD-EFGH-JKLM", password: "another long one 9" }, phone("10.4.2.1"))).toMatchObject({ ok: false, status: 429, error: "too_many" });
    expect(await recover(d, { login: login(), code: "ABCD-EFGH-JKLM", password: "another long one 9" }, phone("10.4.2.2"))).toMatchObject({ status: 401 });
  });
});

describe("接受邀请，每 IP：每小时 20", () => {
  it("the 21st acceptance from one address in an hour is 429 with Retry-After; another address is not limited", async () => {
    const saved = { ...process.env };
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.RIPPLE_DEV_TOOLS = "0";
    process.env.TRUSTED_PROXY_HOPS = "1"; // C2 track L: X-Forwarded-For is believed only behind a proxy of ours (lib/guard/client-ip.ts)
    try {
      const her = await createAccountWithSpace(getMemoryStore(), getAuthProvider(), { login: `ai${randomUUID().slice(0, 9)}`, password: "a long test password", space: "none" });
      const ip = `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      const req = (from: string) =>
        new NextRequest("http://localhost/api/family/invites/accept", { method: "POST", headers: { "content-type": "application/json", cookie: `rp_at=${her.tokens.access_token}`, "x-forwarded-for": from }, body: JSON.stringify({ token: `${randomUUID()}.not-a-token` }) });
      for (let i = 1; i <= 20; i++) expect((await acceptPost(req(ip))).status, String(i)).toBe(404); // a token that matches nothing
      const over = await acceptPost(req(ip));
      expect(over.status).toBe(429);
      expect(((await over.json()) as { error: string }).error).toBe("too_many");
      expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(3500);
      expect((await acceptPost(req(`${ip}9`))).status).toBe(404);
      // signed out is still 401 before any counting
      const anon = await acceptPost(new NextRequest("http://localhost/api/family/invites/accept", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: "{}" }));
      expect(anon.status).toBe(401);
    } finally {
      process.env = saved;
    }
  });
});
