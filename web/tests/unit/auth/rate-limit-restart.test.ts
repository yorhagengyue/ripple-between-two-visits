/**
 * A restart of the server must not reset a rate-limit count (docs/plan/real-app.md 3.5, line 523: the counts are rows
 * in the database, 「重启不会清零」; 8.2 「单元 auth/rate-limit」, line 1406: 「进程重启后计数还在（内存实现也模拟一次重启）」).
 * This file guards that: the count of a limiter is a row of the store's rate_limit table and nothing else, so wrong
 * passwords counted before a restart still count after it.
 *
 * What a restart is here. Everything that lives in the process is thrown away: every module is loaded again
 * (vi.resetModules() and fresh imports, so a counter kept in a module variable is gone) and every process-wide object
 * the app keeps on globalThis (its `__ripple...` keys: the test clock, caches) is deleted.
 * Two things stay, because on a deployment they are not in the process: the store's rows and the identity provider's
 * users. The memory store has no way to hand its rows to a new instance (the rows are private fields and the
 * constructor takes only a clock), so the database is one MemoryStore instance that the new process is given again;
 * the route test uses the process-wide one, which lib/store/memory.ts keeps on globalThis (`__rippleMemoryStore`) and a
 * fresh import of that module finds again. The memory identity provider keeps its users on globalThis too
 * (`__rippleMemoryAuth`): it stands for Supabase Auth.
 *
 * tests/unit/auth/service.test.ts already restarts the account modules once (three wrong passwords, a restart, the
 * sixth locks) without looking at the rows and without clearing globalThis. Added here: the rows themselves before and
 * after, the restart placed right after the fifth failure, a restart that also loses the database as the control (then
 * the sixth is a plain 401, so it is the rows that carry the count), and every other limiter of the limits table that
 * lib/auth owns.
 *
 * The limits table (real-app 3.5, lines 531-547), row by row, and where its count lives:
 *   登录失败，每「账号 × 设备或 IP」      store, a:lf:<login>:<device> and the lock a:ll:...     here (service and the real route)
 *   登录失败，每账号（所有设备合计）       store, a:la:<login>                                    here
 *   登录，每 IP                           store, a:li:<ip>                                       here
 *   注册，每 IP / 全站；铺示例资料          store, a:si a:sd a:ss a:se                             here (hour row through sign-up; all rows through hitLimit)
 *   恢复码，每账号 / 每 IP                 store, a:rl:<login> / a:ri:<ip>                        here
 *   家人协助重设，每账号                   store, a:fh:<user>                                     here
 *   接受邀请，每 IP                        store, a:ai:<ip>                                       here (through hitLimit, as its route counts)
 *   演示沙盒、读药袋、字幕、上传链接        store, g:..                                            tests/unit/guard/limits.test.ts (a restart keeps them)
 *   (not a row of the table) 拍摄组口令输错  store, c:kf:<client> and the lock c:kl:<client>         here (the door and the gate)
 *   问一句每人、DeepSeek 花费每人          store, usage buckets                                   tests/unit/safety/store-cost-guard.test.ts (a new guard sees the count)
 *   导出，每人                             store, h:ex:<user>:<day>                               lib/privacy/export.ts (read with getRateWindow; not tested here)
 *   DeepSeek 花费，全站                    a file ledger (lib/llm/spend.ts, web/.data), not a store row: it outlives a
 *                                          restart on the same disk; under vitest it is in memory only. Not tested here.
 * Also counted per user x device like the log-in (not a row of the table): a wrong current password when changing the
 * password or the recovery code (a:pf, a:pl): here.
 *
 * The film crew's wrong-key lockout (lib/session/crew-key.ts: one counter of typed wrong keys per client; ten within
 * ten minutes lock that client's typed keys out for ten minutes). The design's table does not list it (it belongs to
 * the demo fence, 5.2). Until C2 track S it was the one counter that lived only in process memory (a Map on
 * globalThis), so a restart forgot nine wrong keys and lifted a lock. Now it is two rows of the store per client, named
 * by an HMAC of the client's address like the per-address rows above: c:kf:<hmac> counts the wrong keys, c:kl:<hmac> is
 * the lock. It counts at two places and is tested through both: the sign-in door (crewSignIn, POST /api/session/crew,
 * the one place that answers in words: 403 crew_key_wrong, then 429 crew_key_attempts) and the gate of every crew-only
 * route (crewCredential, lib/crew/gate.ts isCrew: a wrong key and a locked-out client are both only "not the crew", a
 * 404; a browser that carries the rp_crew cookie keeps working; web/progress/e.md 「拍摄组口令一道门」). Four tests state
 * that the count survives a restart and that a lock survives a restart, each once through each function, with the rows
 * read before and after; two controls walk the same steps in one process, and one loses the database with the restart
 * (then the tenth does not lock, so it is the rows that carry the count).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignupBody } from "@/lib/auth/api";
import { newDeviceId } from "@/lib/auth/device";
import { tokenClaims } from "@/lib/auth/jwt";
import { parseLoginName } from "@/lib/auth/login-name";
import type { AccountDeps, Me, RequestFacts } from "@/lib/auth/service";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { MemoryStore } from "@/lib/store/memory";

const PASSWORD = "plum blossom tea";
const NEW_PASSWORD = "harbour lights 77";
/** The real numbers: no developer-tools loosening of the per-address rows. */
const PROD = { NODE_ENV: "production" };
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

let clock = Date.parse("2026-10-10T02:00:00.000Z");
/** The database: its rows are all that a restart keeps (with the identity provider's users). */
const database = () => new MemoryStore({ now: () => new Date(clock) });

/** The process-wide objects that are not process memory on a deployment: the store's rows, the provider's users. */
const OUTLIVES_A_RESTART = new Set(["__rippleMemoryStore", "__rippleMemoryAuth"]);

/** One process: the account layer as that process loaded it. */
async function boot() {
  const [limits, service, memoryAuth] = await Promise.all([import("@/lib/auth/limits"), import("@/lib/auth/service"), import("@/lib/auth/memory")]);
  return { limits, service, MemoryAuthProvider: memoryAuth.MemoryAuthProvider };
}
type Process = Awaited<ReturnType<typeof boot>>;

/** A restart: every module is loaded again and every process-wide object but the two databases is gone. */
async function restart(): Promise<Process> {
  vi.resetModules();
  const g = globalThis as Record<string, unknown>;
  for (const key of Object.keys(g)) if (key.startsWith("__ripple") && !OUTLIVES_A_RESTART.has(key)) delete g[key];
  return boot();
}

type Deps = AccountDeps & { store: MemoryStore; waits: number[] };
/** What a process's flows are given: the database, a provider object of its own, the real numbers, a wait that only records. */
function depsOf(p: Process, store: MemoryStore): Deps {
  const waits: number[] = [];
  return { store, auth: new p.MemoryAuthProvider(), env: PROD, now: () => clock, wait: async (ms: number) => void waits.push(ms), waits };
}

const phone = (ip: string, over: Partial<RequestFacts> = {}): RequestFacts => ({ ip, deviceId: newDeviceId(), knownDevice: true, userAgent: null, ...over });
const newLogin = () => `rr${randomUUID().slice(0, 8)}`;
function body(space: SignupBody["space"] = "blank", login = newLogin()): SignupBody {
  return {
    login,
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
/** The login's key in a bucket name, as this process computes it. */
function loginKeyOf(p: Process, login: string): string {
  const parsed = parseLoginName(login, PROD);
  if (!parsed.ok) throw new Error("login");
  return p.limits.bucketKey("login", parsed.login.email, PROD);
}
/** The log-in lockout's two buckets for this login on this device, as this process names them. */
const loginBuckets = (p: Process, d: Deps, login: string, facts: RequestFacts) => p.limits.lockBuckets("login", loginKeyOf(p, login), p.service.deviceKeys(facts, d));

async function meOf(d: Deps, accessToken: string): Promise<Me> {
  const c = tokenClaims(accessToken);
  return { userId: c.userId!, sessionId: c.sessionId, account: (await d.store.getAccount(c.userId!))!, email: c.email, ephemeral: false };
}

afterEach(() => vi.restoreAllMocks());

describe("the restart itself", () => {
  it("loads every module again and clears the process's own objects; the store's rows and the provider's users stay", async () => {
    const first = await boot();
    const g = globalThis as Record<string, unknown>;
    const crew = await import("@/lib/session/crew-key");
    const memory = await import("@/lib/store/memory");
    const store = memory.getMemoryStore();
    await store.rateHit("restart:probe", 60, 5);
    await new first.MemoryAuthProvider().createUser({ email: `${newLogin()}@users.ripple.invalid`, password: PASSWORD });
    // the crew's wrong-key count: one wrong key typed at the door, counted with no store handed in (the process-wide one)
    const typist = { get: () => null };
    expect(await crew.crewSignIn(typist, "not the crew's key")).toEqual({ ok: false, status: 403, error: "crew_key_wrong" });
    const bucket = crew.crewBuckets(crew.clientId(typist));
    expect(bucket.failures).toMatch(/^c:kf:[0-9a-f]{32}$/);
    expect((await store.getRateWindow(bucket.failures))?.count).toBe(1);
    // the process keeps no object of its own for it any more (it was a Map on globalThis, __rippleCrewAttempts)
    expect(Object.keys(g).filter((k) => /crew/i.test(k))).toEqual([]);
    expect(Object.keys(g)).toEqual(expect.arrayContaining(["__rippleMemoryStore", "__rippleMemoryAuth"]));

    const second = await restart();
    expect(second.service.logIn).not.toBe(first.service.logIn);
    expect(second.limits.noteFailure).not.toBe(first.limits.noteFailure);
    // process memory is gone; the two databases are still there
    expect(Object.keys(g).filter((k) => /crew/i.test(k))).toEqual([]);
    expect(Object.keys(g)).toEqual(expect.arrayContaining(["__rippleMemoryStore", "__rippleMemoryAuth"]));
    // the memory store's seam: a fresh import of its module finds the same instance and its rows
    const again = (await import("@/lib/store/memory")).getMemoryStore();
    expect(again).toBe(store);
    expect((await again.getRateWindow("restart:probe"))?.count).toBe(1);
    // the crew's wrong key is one of those rows: the new process names the same bucket and still reads the one
    const crewAgain = await import("@/lib/session/crew-key");
    expect(crewAgain.crewSignIn).not.toBe(crew.crewSignIn);
    expect(crewAgain.crewBuckets(crewAgain.clientId(typist))).toEqual(bucket);
    expect((await again.getRateWindow(bucket.failures))?.count).toBe(1);
    await again.clearRate(bucket.failures);
  });
});

describe("log-in failures per account x device (15 分钟 5 次，这一台锁 15 分钟)", () => {
  it("five wrong passwords, a restart, the sixth locks this device: the count is the store's row before and after", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    expect((await first.service.signUp(d1, b, phone("10.1.0.1"))).ok).toBe(true);
    const his = phone("10.1.0.2");
    const start = clock;
    for (let i = 1; i <= 5; i++) expect(await first.service.logIn(d1, { login: b.login, password: `wrong ${i} wrong` }, his), String(i)).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
    const [bucket] = loginBuckets(first, d1, b.login, his);
    expect(bucket.failures).toMatch(/^a:lf:[0-9a-f]{32}:[0-9a-f]{32}$/);
    expect(await db.getRateWindow(bucket.failures)).toEqual({ count: 5, reset_at: iso(start + 15 * MIN) });
    expect(await db.getRateWindow(bucket.lock)).toBeNull();

    const second = await restart();
    const d2 = depsOf(second, db);
    // the new process names the same buckets (the HMAC's salt is configuration, not process memory) and finds the five
    expect(loginBuckets(second, d2, b.login, his)).toEqual([bucket]);
    expect(await db.getRateWindow(bucket.failures)).toEqual({ count: 5, reset_at: iso(start + 15 * MIN) });
    clock += MIN;
    const tried = vi.spyOn(d2.auth, "signInWithPassword");
    expect(await second.service.logIn(d2, { login: b.login, password: "wrong 6 wrong" }, his)).toEqual({ ok: false, status: 423, error: "locked", until: iso(clock + 15 * MIN) });
    expect(tried).toHaveBeenCalledTimes(1); // the sixth was judged (and was wrong); it is the count that locked
    // the lock is a row from this moment; the count it came from is cleared
    expect(await db.getRateWindow(bucket.lock)).toEqual({ count: 1, reset_at: iso(clock + 15 * MIN) });
    expect(await db.getRateWindow(bucket.failures)).toBeNull();
    // another device of his is not affected, before or after
    expect((await second.service.logIn(d2, { login: b.login, password: PASSWORD }, phone("10.1.0.3"))).ok).toBe(true);
  });

  it("the control: the same five and a restart that also loses the database: the sixth is a plain 401", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    await first.service.signUp(d1, b, phone("10.1.1.1"));
    const his = phone("10.1.1.2");
    for (let i = 1; i <= 5; i++) await first.service.logIn(d1, { login: b.login, password: `wrong ${i} wrong` }, his);
    const second = await restart();
    // the users are still at the identity provider; only the rate_limit rows are gone
    const lost = depsOf(second, database());
    expect(await second.service.logIn(lost, { login: b.login, password: "wrong 6 wrong" }, his)).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
    expect((await lost.store.getRateWindow(loginBuckets(second, lost, b.login, his)[0].failures))?.count).toBe(1);
    // and with the rows it locks (the same process, the same device)
    expect(await second.service.logIn(depsOf(second, db), { login: b.login, password: "wrong 6 wrong" }, his)).toMatchObject({ status: 423, error: "locked" });
  });

  it("a lock that was set is still in force after a restart, to the same minute; the recovery code still works on that device", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    const made = await first.service.signUp(d1, b, phone("10.1.2.1"));
    if (!made.ok) throw new Error("sign-up");
    const his = phone("10.1.2.2");
    for (let i = 1; i <= 5; i++) await first.service.logIn(d1, { login: b.login, password: `wrong ${i} wrong` }, his);
    const lockedAt = clock;
    const until = iso(lockedAt + 15 * MIN);
    expect(await first.service.logIn(d1, { login: b.login, password: "wrong 6 wrong" }, his)).toEqual({ ok: false, status: 423, error: "locked", until });
    const [bucket] = loginBuckets(first, d1, b.login, his);

    // a restart one minute into the lock, and another one a second before it ends: locked, and no password is tried
    for (const at of [lockedAt + MIN, lockedAt + 15 * MIN - 1000]) {
      clock = at;
      const p = await restart();
      const d = depsOf(p, db);
      const tried = vi.spyOn(d.auth, "signInWithPassword");
      expect(await p.service.logIn(d, { login: b.login, password: PASSWORD }, his), iso(at)).toEqual({ ok: false, status: 423, error: "locked", until });
      expect(tried).not.toHaveBeenCalled();
      expect(await db.getRateWindow(bucket.lock)).toEqual({ count: 1, reset_at: until });
    }
    // 锁定期间，用过的设备能用恢复码: the new process lifts the lock by clearing its row
    const p = await restart();
    const d = depsOf(p, db);
    const recovered = await p.service.recover(d, { login: b.login, code: made.answer.recovery_code, password: NEW_PASSWORD }, his);
    expect(recovered.ok).toBe(true);
    expect(await db.getRateWindow(bucket.lock)).toBeNull();
    expect((await p.service.logIn(d, { login: b.login, password: NEW_PASSWORD }, his)).ok).toBe(true);
  });

  it("a lock nobody lifts ends with its 15 minutes, after any number of restarts", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    await first.service.signUp(d1, b, phone("10.1.3.1"));
    const his = phone("10.1.3.2");
    for (let i = 1; i <= 6; i++) await first.service.logIn(d1, { login: b.login, password: `wrong ${i} wrong` }, his);
    const lockedAt = clock;
    const p = await restart();
    const d = depsOf(p, db);
    clock = lockedAt + 15 * MIN - 1;
    expect(await p.service.logIn(d, { login: b.login, password: PASSWORD }, his)).toMatchObject({ status: 423 });
    clock = lockedAt + 15 * MIN;
    expect((await p.service.logIn(d, { login: b.login, password: PASSWORD }, his)).ok).toBe(true);
  });
});

describe("the account's progressive delay over all devices (1 小时内第 10 次起先等 2、4、8……秒)", () => {
  it("ten wrong passwords over ten phones, a restart: the eleventh attempt waits 4 s and the right password after it 8 s", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    await first.service.signUp(d1, b, phone("10.2.0.1"));
    const start = clock;
    for (let i = 1; i <= 10; i++) expect(await first.service.logIn(d1, { login: b.login, password: `guess number ${i}` }, phone(`10.2.1.${i}`)), String(i)).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
    expect(d1.waits).toEqual([2000]); // nine went unslowed, the tenth waited first
    const bucket = first.limits.slowdownBucket(loginKeyOf(first, b.login));
    expect(await db.getRateWindow(bucket)).toEqual({ count: 10, reset_at: iso(start + HOUR) });

    const second = await restart();
    const d2 = depsOf(second, db);
    expect(second.limits.slowdownBucket(loginKeyOf(second, b.login))).toBe(bucket);
    clock += 5 * MIN;
    expect(await second.service.logIn(d2, { login: b.login, password: "guess number 11" }, phone("10.2.1.11"))).toEqual({ ok: false, status: 401, error: "invalid_credentials" });
    expect(d2.waits).toEqual([4000]);
    // slowed, never locked: the right password is judged after its wait, and does not clear the count
    expect((await second.service.logIn(d2, { login: b.login, password: PASSWORD }, phone("10.2.1.12"))).ok).toBe(true);
    expect(d2.waits).toEqual([4000, 8000]);
    expect(await db.getRateWindow(bucket)).toEqual({ count: 11, reset_at: iso(start + HOUR) });

    // the control: a process that lost the database does not wait at all
    const third = await restart();
    const lost = depsOf(third, database());
    await third.service.logIn(lost, { login: b.login, password: "guess number 12" }, phone("10.2.1.13"));
    expect(lost.waits).toEqual([]);
    // the hour ends on the row's own clock, whichever process reads it
    clock = start + HOUR;
    const d3 = depsOf(third, db);
    expect((await third.service.logIn(d3, { login: b.login, password: PASSWORD }, phone("10.2.1.14"))).ok).toBe(true);
    expect(d3.waits).toEqual([]);
  });
});

describe("recovery-code attempts (每账号每小时 5，每 IP 每小时 20)", () => {
  it("five wrong codes for one account, a restart: the sixth is 429 even with the right code, until the row's hour ends", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    const made = await first.service.signUp(d1, b, phone("10.3.0.1"));
    if (!made.ok) throw new Error("sign-up");
    const start = clock;
    for (let i = 1; i <= 5; i++) expect(await first.service.recover(d1, { login: b.login, code: "ABCD-EFGH-JKLM", password: NEW_PASSWORD }, phone(`10.3.1.${i}`)), String(i)).toMatchObject({ status: 401, error: "invalid_recovery" });
    const bucket = `a:rl:${loginKeyOf(first, b.login)}`;
    expect(await db.getRateWindow(bucket)).toEqual({ count: 5, reset_at: iso(start + HOUR) });

    const second = await restart();
    const d2 = depsOf(second, db);
    clock += 10 * MIN;
    const changed = vi.spyOn(d2.auth, "updatePassword");
    expect(await second.service.recover(d2, { login: b.login, code: made.answer.recovery_code, password: NEW_PASSWORD }, phone("10.3.1.9"))).toEqual({ ok: false, status: 429, error: "too_many", until: iso(start + HOUR) });
    expect(changed).not.toHaveBeenCalled();
    expect((await db.getRateWindow(`a:rl:${loginKeyOf(second, b.login)}`))?.count).toBe(6);
    // his password is still the old one
    expect((await second.service.logIn(d2, { login: b.login, password: PASSWORD }, phone("10.3.1.10"))).ok).toBe(true);
    // when the hour is over the code works, in yet another process
    clock = start + HOUR;
    const third = await restart();
    expect((await third.service.recover(depsOf(third, db), { login: b.login, code: made.answer.recovery_code, password: NEW_PASSWORD }, phone("10.3.1.11"))).ok).toBe(true);
  });

  it("twenty tries from one address over any accounts, a restart: the twenty-first is 429; another address is not limited", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const start = clock;
    for (let i = 1; i <= 20; i++) expect(await first.service.recover(d1, { login: newLogin(), code: "ABCD-EFGH-JKLM", password: NEW_PASSWORD }, phone("10.3.2.1")), String(i)).toMatchObject({ status: 401 });
    const bucket = `a:ri:${first.limits.bucketKey("ip", "10.3.2.1", PROD)}`;
    expect(await db.getRateWindow(bucket)).toEqual({ count: 20, reset_at: iso(start + HOUR) });
    const second = await restart();
    const d2 = depsOf(second, db);
    expect(await second.service.recover(d2, { login: newLogin(), code: "ABCD-EFGH-JKLM", password: NEW_PASSWORD }, phone("10.3.2.1"))).toEqual({ ok: false, status: 429, error: "too_many", until: iso(start + HOUR) });
    expect(await second.service.recover(d2, { login: newLogin(), code: "ABCD-EFGH-JKLM", password: NEW_PASSWORD }, phone("10.3.2.2"))).toMatchObject({ status: 401 });
  });
});

describe("a wrong current password, per user x device (changing the password, a new recovery code)", () => {
  it("five wrong ones, a restart: the sixth locks that device for these two actions (423), the row carried it", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    const his = phone("10.4.0.1");
    const made = await first.service.signUp(d1, b, his);
    if (!made.ok) throw new Error("sign-up");
    const me = await meOf(d1, made.signedIn.tokens.access_token);
    const start = clock;
    for (let i = 1; i <= 5; i++) expect(await first.service.changePassword(d1, me, { current: `not his ${i} password`, password: NEW_PASSWORD }, his), String(i)).toEqual({ ok: false, status: 401, error: "wrong_password" });
    const [bucket] = first.limits.lockBuckets("password", first.limits.bucketKey("user", me.userId, PROD), first.service.deviceKeys(his, d1));
    expect(bucket.failures).toMatch(/^a:pf:/);
    expect(await db.getRateWindow(bucket.failures)).toEqual({ count: 5, reset_at: iso(start + 15 * MIN) });

    const second = await restart();
    const d2 = depsOf(second, db);
    expect(await second.service.regenerateRecoveryCode(d2, me, { password: "not his 6 password" }, his)).toEqual({ ok: false, status: 423, error: "locked", until: iso(clock + 15 * MIN) });
    // locked now: the right current password is not even checked there, in this process or the next
    const third = await restart();
    const d3 = depsOf(third, db);
    const checked = vi.spyOn(d3.auth, "checkPassword");
    expect(await third.service.changePassword(d3, me, { current: PASSWORD, password: NEW_PASSWORD }, his)).toMatchObject({ status: 423, error: "locked" });
    expect(checked).not.toHaveBeenCalled();
    // his other phone is free
    expect((await third.service.changePassword(d3, me, { current: PASSWORD, password: NEW_PASSWORD }, phone("10.4.0.2"))).ok).toBe(true);
  });
});

describe("the per-address rows of the account routes", () => {
  it("log-in: thirty attempts from one address, a restart, the thirty-first is 429 whatever the password", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const b = body();
    await first.service.signUp(d1, b, phone("10.5.0.9"));
    const start = clock;
    for (let i = 1; i <= 30; i++) expect(await first.service.logIn(d1, { login: newLogin(), password: "nobody here 123" }, phone("10.5.0.1")), String(i)).toMatchObject({ status: 401 });
    expect(await db.getRateWindow(`a:li:${first.limits.bucketKey("ip", "10.5.0.1", PROD)}`)).toEqual({ count: 30, reset_at: iso(start + 15 * MIN) });
    const second = await restart();
    const d2 = depsOf(second, db);
    const tried = vi.spyOn(d2.auth, "signInWithPassword");
    expect(await second.service.logIn(d2, { login: b.login, password: PASSWORD }, phone("10.5.0.1"))).toEqual({ ok: false, status: 429, error: "too_many", until: iso(start + 15 * MIN) });
    expect(tried).not.toHaveBeenCalled();
    expect((await second.service.logIn(d2, { login: b.login, password: PASSWORD }, phone("10.5.0.2"))).ok).toBe(true);
  });

  it("sign-up: five from one address within the hour, a restart, the sixth is 429 and makes nothing", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const start = clock;
    for (let i = 1; i <= 5; i++) expect((await first.service.signUp(d1, body(), phone("10.5.1.1"))).ok, String(i)).toBe(true);
    const second = await restart();
    const d2 = depsOf(second, db);
    const made = vi.spyOn(d2.auth, "createUser");
    const refused = body();
    expect(await second.service.signUp(d2, refused, phone("10.5.1.1"))).toEqual({ ok: false, status: 429, error: "too_many", until: iso(start + HOUR) });
    expect(made).not.toHaveBeenCalled();
    expect(await db.getAccountByUsername(refused.login)).toBeNull();
  });

  it("every row of lib/auth/limits.ts counted by hitLimit: full before a restart is still full after it, to the same moment", async () => {
    const db = database();
    const first = await boot();
    // the rows as the file names them today: a new one has to be put in one of the two lists
    const lockouts = ["loginFailures", "loginSlowdown", "loginLock", "passwordFailures"]; // counted by noteFailure / noteLoginFailure: the tests above
    const windows = [
      "loginPerIp",
      "signupPerIpHour",
      "signupPerIpDay",
      "signupSiteDay",
      "examplePerIpHour",
      "recoverPerLogin",
      "recoverPerIp",
      "checkLoginPerIp",
      "familyResetRequests",
      "familyResetCodes",
      "familyResetPerIp",
      "familyResetCodeTries",
      "readAloudPerIp",
      "acceptInvitePerIp",
      // line bind (only add): binding by account (lib/care/bind.ts), counted by hitLimit like the rows above
      "bindPerUser",
      "bindPerIp",
    ] as const;
    expect(Object.keys(first.limits.LIMITS).sort()).toEqual([...lockouts, ...windows].sort());
    const start = clock;
    for (const name of windows) {
      const row = first.limits.LIMITS[name];
      for (let i = 1; i <= row.limit; i++) expect((await first.limits.hitLimit(db, `t:${name}`, row, PROD)).ok, `${name} ${i}`).toBe(true);
      expect(await db.getRateWindow(`t:${name}`), name).toEqual({ count: row.limit, reset_at: iso(start + row.windowS * 1000) });
    }
    const second = await restart();
    clock += MIN;
    for (const name of windows) {
      const row = second.limits.LIMITS[name];
      expect(await second.limits.hitLimit(db, `t:${name}`, row, PROD), name).toEqual({ ok: false, until: iso(start + row.windowS * 1000) });
    }
    // the control: without the rows every one of them is open again
    const lost = database();
    for (const name of windows) expect((await second.limits.hitLimit(lost, `t:${name}`, second.limits.LIMITS[name], PROD)).ok, name).toBe(true);
  });
});

describe("family-assisted reset (每账号每天 3)", () => {
  it("three requests for help in a day, a restart: the fourth is 429 until the row's day ends", async () => {
    const db = database();
    const first = await boot();
    const d1 = depsOf(first, db);
    const hisPhone = phone("10.6.0.1");
    const b = body();
    const him = await first.service.signUp(d1, b, hisPhone);
    const her = await first.service.signUp(d1, body("none"), phone("10.6.0.2"));
    if (!him.ok || !her.ok) throw new Error("sign-up");
    const he = await meOf(d1, him.signedIn.tokens.access_token);
    const she = await meOf(d1, her.signedIn.tokens.access_token);
    const hash = `h-${randomUUID()}`;
    const inv = await db.createInvite({ patient_id: he.userId, relation: "daughter", family_label: "Wei Ling", patient_label: "爸爸", invite_token_hash: hash, invite_expires_at: iso(clock + 7 * 24 * HOUR) });
    if (!inv.ok) throw new Error("invite");
    await db.acceptInvite(hash, she.userId);
    await db.confirmLink(inv.link.id, he.userId, true);
    const reset1 = await import("@/lib/auth/family-reset");
    expect(await reset1.setResetHelper(d1, he, { link_id: inv.link.id, on: true })).toMatchObject({ ok: true, helper: { on: true } });
    const quiet = { ...d1, sendNotice: async () => ({ sent: 0 }) };
    const start = clock;
    for (let i = 1; i <= 3; i++) expect((await reset1.requestFamilyHelp(quiet, { login: b.login }, hisPhone)).ok, String(i)).toBe(true);
    const bucket = `a:fh:${first.limits.bucketKey("user", he.userId, PROD)}`;
    expect(await db.getRateWindow(bucket)).toEqual({ count: 3, reset_at: iso(start + 24 * HOUR) });

    const second = await restart();
    const reset2 = await import("@/lib/auth/family-reset");
    expect(reset2.requestFamilyHelp).not.toBe(reset1.requestFamilyHelp);
    const d2 = { ...depsOf(second, db), sendNotice: async () => ({ sent: 0 }) };
    clock += HOUR;
    expect(await reset2.requestFamilyHelp(d2, { login: b.login }, hisPhone)).toEqual({ ok: false, status: 429, error: "too_many", until: iso(start + 24 * HOUR) });
    expect((await db.getRateWindow(bucket))?.count).toBe(4);
  });
});

describe("through the real route, on the process-wide memory store (POST /api/auth/login)", () => {
  const post = (handler: (req: NextRequest) => Promise<Response>, device: string, login: string, password: string) =>
    handler(new NextRequest("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json", cookie: `rp_device=${device}` }, body: JSON.stringify({ login, password }) }));

  it("five wrong passwords, a restart of the server code, the sixth answers 423 with when it opens; the right one is refused there too", async () => {
    const { getMemoryStore } = await import("@/lib/store/memory");
    const { getAuthProvider } = await import("@/lib/auth");
    const { createAccountWithSpace } = await import("@/lib/auth/dev-accounts");
    const store = getMemoryStore();
    const login = newLogin();
    await createAccountWithSpace(store, getAuthProvider(), { login, password: PASSWORD, space: "none" });
    const device = newDeviceId();
    const before = await import("@/app/api/auth/login/route");
    for (let i = 1; i <= 5; i++) {
      const res = await post(before.POST, device, login, `wrong ${i} wrong`);
      expect(res.status, String(i)).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_credentials" });
    }
    await restart();
    const after = await import("@/app/api/auth/login/route");
    expect(after.POST).not.toBe(before.POST);
    expect((await import("@/lib/store/memory")).getMemoryStore()).toBe(store);
    const sixth = await post(after.POST, device, login, "wrong 6 wrong");
    expect(sixth.status).toBe(423);
    const answer = (await sixth.json()) as { error: string; until: string };
    expect(answer.error).toBe("locked");
    const wait = Date.parse(answer.until) - Date.now();
    expect(wait).toBeGreaterThan(14 * MIN);
    expect(wait).toBeLessThanOrEqual(15 * MIN);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(14 * 60);
    // locked on this device after one more restart, right password or not; his other phone signs in
    await restart();
    const third = await import("@/app/api/auth/login/route");
    const locked = await post(third.POST, device, login, PASSWORD);
    expect(locked.status).toBe(423);
    expect(await locked.json()).toEqual({ error: "locked", until: answer.until });
    expect((await post(third.POST, newDeviceId(), login, PASSWORD)).status).toBe(200);
  });
});

describe("the film crew's wrong-key lockout: rows of the store, c:kf and c:kl per client (lib/session/crew-key.ts)", () => {
  const KEY = "the film crew's own key, 2026";
  const CREW = { NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: KEY };
  const T0 = Date.parse("2026-10-10T02:00:00.000Z");
  const WRONG = { ok: false, status: 403, error: "crew_key_wrong" };
  const LOCKED = { ok: false, status: 429, error: "crew_key_attempts" };
  type Crew = typeof import("@/lib/session/crew-key");
  /** A request: a key typed into the x-ripple-crew-key header, or the rp_crew cookie a crew browser carries. */
  const request = (x: { header?: string; cookie?: string } = {}) => ({
    headers: { get: (name: string) => (name.toLowerCase() === "x-ripple-crew-key" ? (x.header ?? null) : null) },
    cookies: { get: (name: string) => (name === "rp_crew" && x.cookie ? { value: x.cookie } : undefined) },
  });
  /** The sign-in door (POST /api/session/crew): the one place that answers a typed key in words. The moment is `clock`. */
  const door = (crew: Crew, db: MemoryStore, key: string) => crew.crewSignIn(request().headers, key, CREW, db);
  /** The gate of every crew-only route (lib/crew/gate.ts isCrew): how the request is the crew's, or null (the route then answers 404). */
  const gate = (crew: Crew, db: MemoryStore, x: { header?: string; cookie?: string }) => crew.crewCredential(request(x), null, CREW, db);
  /** The client's two buckets as this process names them (a request with no address a proxy of ours vouches for is "local"). */
  const bucketsOf = (crew: Crew) => crew.crewBuckets(crew.clientId(request().headers), CREW);
  /** Nine wrong keys, one a millisecond, the first at T0 + 1. */
  async function nineAtTheDoor(crew: Crew, db: MemoryStore): Promise<void> {
    for (let i = 1; i <= 9; i++) {
      clock = T0 + i;
      expect(await door(crew, db, `not the key ${i}`), String(i)).toEqual(WRONG);
    }
  }
  async function nineAtTheGate(crew: Crew, db: MemoryStore): Promise<void> {
    for (let i = 1; i <= 9; i++) {
      clock = T0 + i;
      expect(await gate(crew, db, { header: `not the key ${i}` }), String(i)).toBeNull();
    }
  }

  it("the control at the sign-in door, in one process: nine wrong keys are 403, the tenth locks the client out (429), the right key included, for ten minutes", async () => {
    const db = database();
    await restart();
    const crew = await import("@/lib/session/crew-key");
    const b = bucketsOf(crew);
    expect(crew.clientId(request().headers)).toBe("local");
    expect([b.failures, b.lock]).toEqual([expect.stringMatching(/^c:kf:[0-9a-f]{32}$/), expect.stringMatching(/^c:kl:[0-9a-f]{32}$/)]);
    await nineAtTheDoor(crew, db);
    expect(await db.getRateWindow(b.failures)).toEqual({ count: 9, reset_at: iso(T0 + 1 + crew.WRONG_KEY_WINDOW_MS) });
    expect(await db.getRateWindow(b.lock)).toBeNull();
    clock = T0 + 10;
    expect(await door(crew, db, "not the key 10")).toEqual(LOCKED);
    // the lock is a row from this moment; the count it came from is cleared
    expect(await db.getRateWindow(b.lock)).toEqual({ count: 1, reset_at: iso(T0 + 10 + crew.WRONG_KEY_WINDOW_MS) });
    expect(await db.getRateWindow(b.failures)).toBeNull();
    clock = T0 + 11;
    expect(await crew.crewLockedOut("local", CREW, db)).toBe(true);
    expect(await door(crew, db, KEY)).toEqual(LOCKED);
    clock = T0 + 10 + crew.WRONG_KEY_WINDOW_MS - 1;
    expect(await door(crew, db, KEY)).toEqual(LOCKED);
    clock = T0 + 10 + crew.WRONG_KEY_WINDOW_MS;
    expect(await door(crew, db, KEY)).toEqual({ ok: true });
  });

  it("the control at the gate, in one process: a wrong key is only 'not the crew'; after the tenth the right key typed is not looked at, a browser with the cookie still is the crew", async () => {
    const db = database();
    await restart();
    const crew = await import("@/lib/session/crew-key");
    const b = bucketsOf(crew);
    await nineAtTheGate(crew, db);
    // not locked yet: the right key is the crew's, and it does not clear the count (the tenth wrong one still locks)
    clock = T0 + 9;
    expect(await gate(crew, db, { header: KEY })).toBe("header");
    expect((await db.getRateWindow(b.failures))?.count).toBe(9);
    clock = T0 + 10;
    expect(await gate(crew, db, { header: "not the key 10" })).toBeNull();
    clock = T0 + 11;
    expect(await crew.crewLockedOut("local", CREW, db)).toBe(true);
    expect(await gate(crew, db, { header: KEY })).toBeNull();
    expect(await crew.checkCrew(request({ header: KEY }), null, CREW, db)).toEqual({ ok: false, status: 403, error: "crew_key_required" });
    expect(await gate(crew, db, { cookie: crew.crewCookieValue(KEY) })).toBe("cookie");
    // one counter for the gate and the door: the tries typed at the gate locked the door too
    expect(await door(crew, db, KEY)).toEqual(LOCKED);
    clock = T0 + 10 + crew.WRONG_KEY_WINDOW_MS;
    expect(await gate(crew, db, { header: KEY })).toBe("header");
  });

  // Was it.fails while the count was a Map in the process: a restart or a deploy gave someone guessing the key a fresh ten.
  it("the sign-in door: nine wrong keys, a restart: the tenth still locks the client out", async () => {
    const db = database();
    await restart();
    const before = await import("@/lib/session/crew-key");
    await nineAtTheDoor(before, db);
    const b = bucketsOf(before);
    expect(await db.getRateWindow(b.failures)).toEqual({ count: 9, reset_at: iso(T0 + 1 + before.WRONG_KEY_WINDOW_MS) });
    await restart();
    const after = await import("@/lib/session/crew-key");
    expect(after.crewSignIn).not.toBe(before.crewSignIn);
    // the new process names the same buckets (the HMAC's salt is configuration, not process memory) and finds the nine
    expect(bucketsOf(after)).toEqual(b);
    expect(await db.getRateWindow(b.failures)).toEqual({ count: 9, reset_at: iso(T0 + 1 + before.WRONG_KEY_WINDOW_MS) });
    clock = T0 + 10;
    expect(await door(after, db, "not the key 10")).toEqual(LOCKED);
    expect(await db.getRateWindow(b.lock)).toEqual({ count: 1, reset_at: iso(T0 + 10 + after.WRONG_KEY_WINDOW_MS) });
    expect(await db.getRateWindow(b.failures)).toBeNull();
  });

  it("the control: the same nine and a restart that also loses the database: the tenth is a plain 403 and the right key still opens", async () => {
    const db = database();
    await restart();
    const before = await import("@/lib/session/crew-key");
    await nineAtTheDoor(before, db);
    await restart();
    const after = await import("@/lib/session/crew-key");
    const lost = database();
    clock = T0 + 10;
    expect(await door(after, lost, "not the key 10")).toEqual(WRONG);
    expect((await lost.getRateWindow(bucketsOf(after).failures))?.count).toBe(1);
    expect(await lost.getRateWindow(bucketsOf(after).lock)).toBeNull();
    clock = T0 + 11;
    expect(await gate(after, lost, { header: KEY })).toBe("header");
    expect(await door(after, lost, KEY)).toEqual({ ok: true });
    // and with the rows it locks (the same process, the same client)
    expect(await door(after, db, "not the key 10")).toEqual(LOCKED);
    expect(await gate(after, db, { header: KEY })).toBeNull();
  });

  // Was it.fails: the nine tries typed at a crew-only route before a restart no longer counted, so the tenth did not lock.
  it("the gate: nine wrong keys, a restart, the tenth: the right key typed after it is locked out", async () => {
    const db = database();
    await restart();
    const before = await import("@/lib/session/crew-key");
    await nineAtTheGate(before, db);
    const b = bucketsOf(before);
    expect(await db.getRateWindow(b.failures)).toEqual({ count: 9, reset_at: iso(T0 + 1 + before.WRONG_KEY_WINDOW_MS) });
    await restart();
    const after = await import("@/lib/session/crew-key");
    expect(after.crewCredential).not.toBe(before.crewCredential);
    clock = T0 + 10;
    expect(await gate(after, db, { header: "not the key 10" })).toBeNull();
    expect(await db.getRateWindow(b.lock)).toEqual({ count: 1, reset_at: iso(T0 + 10 + after.WRONG_KEY_WINDOW_MS) });
    clock = T0 + 11;
    expect(await gate(after, db, { header: KEY })).toBeNull();
    // the crew's own browser, which carries the cookie, is the crew in the new process too
    expect(await gate(after, db, { cookie: after.crewCookieValue(KEY) })).toBe("cookie");
  });

  // Was it.fails: a client locked out of the sign-in door for ten minutes was let in again at once after a restart.
  it("the sign-in door: a lockout that was set is still in force after a restart", async () => {
    const db = database();
    await restart();
    const before = await import("@/lib/session/crew-key");
    await nineAtTheDoor(before, db);
    clock = T0 + 10;
    expect(await door(before, db, "not the key 10")).toEqual(LOCKED);
    clock = T0 + 11;
    expect(await door(before, db, KEY)).toEqual(LOCKED);
    const until = iso(T0 + 10 + before.WRONG_KEY_WINDOW_MS);
    await restart();
    const after = await import("@/lib/session/crew-key");
    clock = T0 + 12;
    expect(await door(after, db, KEY)).toEqual(LOCKED);
    expect(await db.getRateWindow(bucketsOf(after).lock)).toEqual({ count: 1, reset_at: until });
    // to the same moment, whichever process reads the row
    clock = T0 + 10 + after.WRONG_KEY_WINDOW_MS - 1;
    expect(await door(after, db, KEY)).toEqual(LOCKED);
    clock = T0 + 10 + after.WRONG_KEY_WINDOW_MS;
    expect(await door(after, db, KEY)).toEqual({ ok: true });
  });

  // Was it.fails: after a restart the locked-out client's typed key opened every crew-only route again.
  it("the gate: a lockout that was set is still in force after a restart", async () => {
    const db = database();
    await restart();
    const before = await import("@/lib/session/crew-key");
    await nineAtTheGate(before, db);
    clock = T0 + 10;
    expect(await gate(before, db, { header: "not the key 10" })).toBeNull();
    clock = T0 + 11;
    expect(await before.crewLockedOut("local", CREW, db)).toBe(true);
    expect(await gate(before, db, { header: KEY })).toBeNull();
    await restart();
    const after = await import("@/lib/session/crew-key");
    clock = T0 + 12;
    expect(await gate(after, db, { header: KEY })).toBeNull();
    expect(await after.crewLockedOut("local", CREW, db)).toBe(true);
    clock = T0 + 10 + after.WRONG_KEY_WINDOW_MS;
    expect(await gate(after, db, { header: KEY })).toBe("header");
  });
});
