/**
 * The film crew's one gate (lib/crew/gate.ts, real-app 5.2): anyone who is not the crew gets 404, the answer of a route
 * that does not exist, whether nothing was sent, a stale cookie, or a typed key that is wrong; the crew's cookie or key
 * goes through; pages look at the cookie only. Wrong typed keys are counted once (lib/session/crew-key.ts) and the only
 * place that answers them in words is the sign-in door (crewSignIn: 403, then 429). Which keys count follows the
 * developer-tools switch: the dev key on a recording build (RIPPLE_DEV_TOOLS=1), never on a production build without it.
 *
 * The count is rows of the store (two rate-limit buckets per client), so every check is awaited. The routes count in the
 * process-wide store, on the app's clock; where a test moves time it hands the crew functions a store of its own with a
 * clock it sets (clocked()). A restart keeping the count is tests/unit/auth/rate-limit-restart.test.ts.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crewGate, crewNotFound, isCrew, isCrewPage, requireCrewPage } from "@/lib/crew/gate";
import {
  acceptedCrewKeys,
  checkCrew,
  CREW_COOKIE,
  crewBuckets,
  crewCookieValue,
  crewCredential,
  crewGateSource,
  crewLockedOut,
  crewSignIn,
  MAX_WRONG_KEYS,
  resetCrewAttempts,
  WRONG_KEY_WINDOW_MS,
  type CrewAttemptStore,
} from "@/lib/session/crew-key";
import { getMemoryStore, MemoryStore } from "@/lib/store/memory";
import { crewAttemptStore } from "@/lib/subject/limits";
import { ScopeViolation } from "@/lib/subject/scoped-store";
import { advanceTestClock, setTestClock } from "@/lib/time/now";
import { crewKeySource, DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined) }),
}));

const ENV_KEY = "crew-gate-test-key-77";

function req(headers: Record<string, string> = {}, ip = "10.0.0.1"): NextRequest {
  return new NextRequest("http://localhost:3550/api/clock", { method: "POST", headers: { "x-forwarded-for": ip, ...headers } });
}

const cookie = (key: string) => ({ cookie: `${CREW_COOKIE}=${crewCookieValue(key)}` });

/** A database of the test's own with a clock the test moves; the crew functions take it in place of the process-wide one. */
function clocked(): { store: MemoryStore; start: number; at: (ms: number) => void } {
  const start = Date.parse("2026-10-10T02:00:00.000Z");
  let clock = start;
  return { store: new MemoryStore({ now: () => new Date(clock) }), start, at: (ms) => void (clock = ms) };
}

beforeEach(async () => {
  // C2 track L: these tests tell clients apart by X-Forwarded-For; that is only believed behind a proxy of ours (lib/guard/client-ip.ts)
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  await resetCrewAttempts();
  jar.values.clear();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await resetCrewAttempts();
});

describe("which keys count: the developer-tools switch", () => {
  it("the dev key while the developer tools are on (next dev, vitest, a recording build), never on a plain production build", () => {
    expect(acceptedCrewKeys({ NODE_ENV: "development" })).toEqual([DEV_ONLY_CREW_KEY]);
    expect(acceptedCrewKeys({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })).toEqual([DEV_ONLY_CREW_KEY]);
    expect(acceptedCrewKeys({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toEqual([ENV_KEY, DEV_ONLY_CREW_KEY]);
    expect(acceptedCrewKeys({ NODE_ENV: "production" })).toEqual([]);
    expect(acceptedCrewKeys({ NODE_ENV: "production", SCRIPTED_FALLBACK_KEY: ENV_KEY })).toEqual([ENV_KEY]);
    expect(crewGateSource({ NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" })).toBe("dev_default");
    expect(crewGateSource({ NODE_ENV: "production" })).toBe("none");
  });

  it("the scripted fallback's own key follows the same switch", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    expect(crewKeySource()).toBe("none");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "1");
    expect(crewKeySource()).toBe("dev_default");
  });
});

describe("routes: crewGate and isCrew", () => {
  it("no credential at all: 404 not_found, the same answer as a route that does not exist", async () => {
    const res = await crewGate(req());
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "not_found" });
    expect(await crewNotFound().json()).toEqual({ error: "not_found" });
    expect(await isCrew(req())).toBe(false);
  });

  it("the crew's cookie, the key in the header, or the key in the body: through", async () => {
    expect(await crewGate(req(cookie(DEV_ONLY_CREW_KEY)))).toBeNull();
    expect(await crewGate(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toBeNull();
    expect(await crewGate(req(), DEV_ONLY_CREW_KEY)).toBeNull();
    expect(await isCrew(req(cookie(DEV_ONLY_CREW_KEY)))).toBe(true);
    expect(await isCrew(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toBe(true);
    expect(await isCrew(req(), DEV_ONLY_CREW_KEY)).toBe(true);
  });

  it("a stale cookie alone (the key changed) reads like no key: 404, and counts nothing", async () => {
    for (let i = 0; i < MAX_WRONG_KEYS + 2; i++) expect((await crewGate(req(cookie("an-old-key"))))?.status).toBe(404);
    // not locked out by the stale cookie: the right key still works
    expect(await crewGate(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toBeNull();
    // and no row was written for it
    expect(await getMemoryStore().getRateWindow(crewBuckets("10.0.0.1").failures)).toBeNull();
  });

  it("a typed wrong key is not the crew either: the same 404, never \"wrong key\"", async () => {
    for (const wrong of [await crewGate(req({ "x-ripple-crew-key": "letmein" })), await crewGate(req(), "letmein")]) {
      expect(wrong?.status).toBe(404);
      expect(await wrong?.json()).toEqual({ error: "not_found" });
    }
    expect(await isCrew(req({ "x-ripple-crew-key": "letmein" }))).toBe(false);
    // three wrong keys, three counted, in the store's row for this client (named by an HMAC, never the address)
    const b = crewBuckets("10.0.0.1");
    expect(b.failures).toMatch(/^c:kf:[0-9a-f]{32}$/);
    expect(b.failures).not.toContain("10.0.0.1");
    expect((await getMemoryStore().getRateWindow(b.failures))?.count).toBe(3);
  });

  it(`${MAX_WRONG_KEYS} wrong typed keys from one client: its typed keys stop counting for ten minutes (still 404), the cookie and other clients are not affected`, async () => {
    for (let i = 0; i < MAX_WRONG_KEYS; i++) expect(await crewCredential(req({ "x-ripple-crew-key": `guess-${i}` }))).toBeNull();
    // locked out: even the right key, typed, is not looked at
    expect(await crewCredential(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toBeNull();
    expect(await crewLockedOut("10.0.0.1")).toBe(true);
    expect((await crewGate(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY })))?.status).toBe(404);
    expect((await crewGate(req(), DEV_ONLY_CREW_KEY))?.status).toBe(404);
    // a browser of the same client that already carries the cookie keeps working (one phone's typos do not stop the laptop)
    expect(await crewGate(req(cookie(DEV_ONLY_CREW_KEY)))).toBeNull();
    expect(await crewGate(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }, "10.0.0.2"))).toBeNull();
    expect(await crewLockedOut("10.0.0.2")).toBe(false);
  });

  it("the lock is ten minutes from the tenth wrong key; after it the typed key counts again (a store with a clock the test moves)", async () => {
    const t = clocked();
    const typed = (key: string) => crewCredential(req({ "x-ripple-crew-key": key }), null, process.env, t.store);
    for (let i = 0; i < MAX_WRONG_KEYS; i++) expect(await typed(`guess-${i}`)).toBeNull();
    t.at(t.start + 1000);
    expect(await typed(DEV_ONLY_CREW_KEY)).toBeNull();
    expect(await crewLockedOut("10.0.0.1", process.env, t.store)).toBe(true);
    expect(await t.store.getRateWindow(crewBuckets("10.0.0.1").lock)).toEqual({ count: 1, reset_at: new Date(t.start + WRONG_KEY_WINDOW_MS).toISOString() });
    t.at(t.start + WRONG_KEY_WINDOW_MS - 1);
    expect(await typed(DEV_ONLY_CREW_KEY)).toBeNull();
    // after the window the typed key counts again
    t.at(t.start + WRONG_KEY_WINDOW_MS + 2000);
    expect(await typed(DEV_ONLY_CREW_KEY)).toBe("header");
    // the process-wide store saw none of it
    expect(await crewLockedOut("10.0.0.1")).toBe(false);
  });

  it("nine wrong keys spread over more than ten minutes never lock: the count is a window of ten minutes from the first", async () => {
    const t = clocked();
    const typed = (key: string) => crewCredential(req({ "x-ripple-crew-key": key }), null, process.env, t.store);
    for (let i = 0; i < MAX_WRONG_KEYS - 1; i++) expect(await typed(`guess-${i}`)).toBeNull();
    t.at(t.start + WRONG_KEY_WINDOW_MS);
    for (let i = 0; i < MAX_WRONG_KEYS - 1; i++) expect(await typed(`later-${i}`)).toBeNull();
    expect(await crewLockedOut("10.0.0.1", process.env, t.store)).toBe(false);
    expect(await typed(DEV_ONLY_CREW_KEY)).toBe("header");
    // a right key does not clear the count: the next wrong one is the tenth of this window
    expect(await typed("the-tenth")).toBeNull();
    expect(await typed(DEV_ONLY_CREW_KEY)).toBeNull();
  });

  it("the gate's answer as a value (the join rule's own refusal): the crew, or crew_key_required; nothing else", async () => {
    expect(await checkCrew(req(cookie(DEV_ONLY_CREW_KEY)))).toEqual({ ok: true, via: "cookie" });
    expect(await checkCrew(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toEqual({ ok: true, via: "header" });
    expect(await checkCrew(req(), DEV_ONLY_CREW_KEY)).toEqual({ ok: true, via: "body" });
    for (const r of [req(), req(cookie("an-old-key")), req({ "x-ripple-crew-key": "letmein" })]) expect(await checkCrew(r)).toEqual({ ok: false, status: 403, error: "crew_key_required" });
  });

  it("a plain production build (no SCRIPTED_FALLBACK_KEY, no developer tools): nobody is the crew", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", "");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    expect((await crewGate(req(cookie(DEV_ONLY_CREW_KEY))))?.status).toBe(404);
    expect((await crewGate(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY })))?.status).toBe(404);
    expect(await isCrew(req(cookie(DEV_ONLY_CREW_KEY)))).toBe(false);
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", ENV_KEY);
    expect(await crewGate(req(cookie(ENV_KEY)))).toBeNull();
    expect(await crewGate(req({ "x-ripple-crew-key": ENV_KEY }, "10.0.0.9"))).toBeNull();
  });
});

describe("the sign-in door: the one place a typed key is answered in words", () => {
  const headers = (ip = "10.0.1.1") => new Headers({ "x-forwarded-for": ip });

  it("the right key: in; nothing typed: crew_key_required; a wrong key: 403 crew_key_wrong", async () => {
    expect(await crewSignIn(headers(), DEV_ONLY_CREW_KEY)).toEqual({ ok: true });
    expect(await crewSignIn(headers(), "  ")).toEqual({ ok: false, status: 403, error: "crew_key_required" });
    expect(await crewSignIn(headers(), "letmein")).toEqual({ ok: false, status: 403, error: "crew_key_wrong" });
  });

  it(`the ${MAX_WRONG_KEYS}th wrong key and everything after it for ten minutes: 429 crew_key_attempts, for that client only`, async () => {
    const t = clocked();
    const door = (key: string, ip?: string) => crewSignIn(headers(ip), key, process.env, t.store);
    for (let i = 1; i < MAX_WRONG_KEYS; i++) expect(await door(`guess-${i}`)).toMatchObject({ status: 403, error: "crew_key_wrong" });
    expect(await door("one-more")).toEqual({ ok: false, status: 429, error: "crew_key_attempts" });
    t.at(t.start + 1000);
    expect(await door(DEV_ONLY_CREW_KEY)).toEqual({ ok: false, status: 429, error: "crew_key_attempts" });
    expect(await door(DEV_ONLY_CREW_KEY, "10.0.1.2")).toEqual({ ok: true });
    t.at(t.start + WRONG_KEY_WINDOW_MS - 1);
    expect(await door(DEV_ONLY_CREW_KEY)).toEqual({ ok: false, status: 429, error: "crew_key_attempts" });
    t.at(t.start + WRONG_KEY_WINDOW_MS + 2000);
    expect(await door(DEV_ONLY_CREW_KEY)).toEqual({ ok: true });
  });

  it("the same on the process-wide store, where the routes count: the tenth is 429, the right key after it too, another client is in", async () => {
    for (let i = 1; i < MAX_WRONG_KEYS; i++) expect(await crewSignIn(headers(), `guess-${i}`)).toMatchObject({ status: 403, error: "crew_key_wrong" });
    expect(await crewSignIn(headers(), "one-more")).toEqual({ ok: false, status: 429, error: "crew_key_attempts" });
    expect(await crewSignIn(headers(), DEV_ONLY_CREW_KEY)).toEqual({ ok: false, status: 429, error: "crew_key_attempts" });
    expect(await crewSignIn(headers("10.0.1.2"), DEV_ONLY_CREW_KEY)).toEqual({ ok: true });
  });

  it("one counter: wrong keys at the door and in a header add up", async () => {
    for (let i = 0; i < MAX_WRONG_KEYS - 1; i++) await crewCredential(req({ "x-ripple-crew-key": `guess-${i}` }, "10.0.1.7"));
    expect(await crewSignIn(headers("10.0.1.7"), "the-tenth")).toMatchObject({ status: 429 });
  });
});

describe("where the count lives: the store's rows, asked only when a key was typed", () => {
  /** A store that fails on every call, and counts the calls. */
  function broken(): { store: CrewAttemptStore; calls: () => number } {
    let calls = 0;
    const fail = async (): Promise<never> => {
      calls++;
      throw new Error("database unreachable");
    };
    return { store: { rateHit: fail, getRateWindow: fail, clearRate: fail }, calls: () => calls };
  }

  it("the crew's cookie, a stale cookie alone, and no credential at all make no store call", async () => {
    const b = broken();
    expect(await crewCredential(req(cookie(DEV_ONLY_CREW_KEY)), null, process.env, b.store)).toBe("cookie");
    expect(await checkCrew(req(cookie(DEV_ONLY_CREW_KEY)), null, process.env, b.store)).toEqual({ ok: true, via: "cookie" });
    // the cookie wins before a typed key is looked at, right or wrong
    expect(await crewCredential(req({ ...cookie(DEV_ONLY_CREW_KEY), "x-ripple-crew-key": "letmein" }), "letmein", process.env, b.store)).toBe("cookie");
    expect(await crewCredential(req(cookie("an-old-key")), null, process.env, b.store)).toBeNull();
    expect(await crewCredential(req(), null, process.env, b.store)).toBeNull();
    expect(await crewCredential(req(), "   ", process.env, b.store)).toBeNull();
    expect(await crewSignIn(new Headers(), "  ", process.env, b.store)).toEqual({ ok: false, status: 403, error: "crew_key_required" });
    expect(b.calls()).toBe(0);
  });

  it("a store that fails while a typed key is checked: not the crew, right key or wrong, and one line that names neither the key nor the address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = broken();
    expect(await crewCredential(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }), null, process.env, b.store)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await crewCredential(req(), "letmein-77", process.env, b.store)).toBeNull();
    expect(await checkCrew(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }), null, process.env, b.store)).toEqual({ ok: false, status: 403, error: "crew_key_required" });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(b.calls()).toBe(3);
    const said = JSON.stringify(warn.mock.calls);
    for (const secret of [DEV_ONLY_CREW_KEY, "letmein-77", "10.0.0.1"]) expect(said).not.toContain(secret);
    // the sign-in door does not word a failing store as a wrong key: the error goes to the caller
    await expect(crewSignIn(new Headers(), DEV_ONLY_CREW_KEY, process.env, b.store)).rejects.toThrow("database unreachable");
    warn.mockRestore();
  });

  it("a store that fails only when it writes: the right key is still the crew's, a wrong one is not the crew and is not counted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: CrewAttemptStore = {
      getRateWindow: async () => null,
      rateHit: async () => Promise.reject(new Error("database unreachable")),
      clearRate: async () => undefined,
    };
    expect(await crewCredential(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }), null, process.env, store)).toBe("header");
    expect(warn).not.toHaveBeenCalled();
    expect(await crewCredential(req({ "x-ripple-crew-key": "letmein" }), null, process.env, store)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("the process-wide store is reached through three methods only (lib/subject/limits.ts crewAttemptStore)", async () => {
    const base = new MemoryStore();
    const narrow = crewAttemptStore(base) as unknown as MemoryStore;
    expect(await narrow.rateHit("b", 60, 1)).toMatchObject({ count: 1 });
    expect((await narrow.getRateWindow("b"))?.count).toBe(1);
    await narrow.clearRate("b");
    expect(await base.getRateWindow("b")).toBeNull();
    expect(() => narrow.rateAdd("b", 60, 10, 4)).toThrow(ScopeViolation);
    expect(() => narrow.listSessions()).toThrow(ScopeViolation);
    expect(() => narrow.getAccount("u")).toThrow(ScopeViolation);
  });

  it("resetCrewAttempts (tests only) clears what this process counted, in the store it was counted in", async () => {
    const t = clocked();
    for (let i = 0; i < MAX_WRONG_KEYS; i++) await crewCredential(req({ "x-ripple-crew-key": `guess-${i}` }), null, process.env, t.store);
    for (let i = 0; i < 3; i++) await crewCredential(req({ "x-ripple-crew-key": `guess-${i}` }, "10.0.0.5"));
    expect(await crewLockedOut("10.0.0.1", process.env, t.store)).toBe(true);
    expect((await getMemoryStore().getRateWindow(crewBuckets("10.0.0.5").failures))?.count).toBe(3);
    await resetCrewAttempts();
    expect(await crewLockedOut("10.0.0.1", process.env, t.store)).toBe(false);
    expect(await getMemoryStore().getRateWindow(crewBuckets("10.0.0.5").failures)).toBeNull();
  });
});

describe("the developer test clock moved back: a window that started in the future is not kept", () => {
  afterEach(() => {
    vi.unstubAllEnvs(); // the clock can only be put back with the developer tools on
    setTestClock(null);
  });

  it("a lock set while the clock was three weeks ahead is gone when the clock is real again; so is a count", async () => {
    const real = Date.now();
    setTestClock({ at: real + 21 * 24 * 3_600_000, frozen: true });
    for (let i = 0; i < MAX_WRONG_KEYS; i++) expect(await crewCredential(req({ "x-ripple-crew-key": `guess-${i}` }))).toBeNull();
    for (let i = 0; i < MAX_WRONG_KEYS - 1; i++) expect(await crewCredential(req({ "x-ripple-crew-key": `guess-${i}` }, "10.0.0.3"))).toBeNull();
    // on that clock the first client is locked for its ten minutes, to the millisecond
    expect(await crewLockedOut("10.0.0.1")).toBe(true);
    advanceTestClock(WRONG_KEY_WINDOW_MS - 1);
    expect(await crewCredential(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toBeNull();
    setTestClock(null);
    // back at the real time both rows would end three weeks from now: they are started again
    expect(await crewLockedOut("10.0.0.1")).toBe(false);
    expect(await crewCredential(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }))).toBe("header");
    expect(await getMemoryStore().getRateWindow(crewBuckets("10.0.0.1").lock)).toBeNull();
    // the second client's nine: its next wrong key is the first of a new window, not the tenth
    expect(await crewCredential(req({ "x-ripple-crew-key": "one-more" }, "10.0.0.3"))).toBeNull();
    expect((await getMemoryStore().getRateWindow(crewBuckets("10.0.0.3").failures))?.count).toBe(1);
    expect(await crewCredential(req({ "x-ripple-crew-key": DEV_ONLY_CREW_KEY }, "10.0.0.3"))).toBe("header");
  });

  it("only where that clock exists: on a plain production build no lock is doubted, whenever it ends", async () => {
    const b = crewBuckets("10.0.0.4");
    // a lock row that ends a month from now, as only a clock that moved back could have left it
    await getMemoryStore().rateHit(b.lock, 30 * 24 * 3600, 0);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    vi.stubEnv("SCRIPTED_FALLBACK_KEY", ENV_KEY);
    expect(await crewLockedOut("10.0.0.4")).toBe(true);
    expect((await crewGate(req({ "x-ripple-crew-key": ENV_KEY }, "10.0.0.4")))?.status).toBe(404);
    expect(await crewSignIn(new Headers({ "x-forwarded-for": "10.0.0.4" }), ENV_KEY)).toEqual({ ok: false, status: 429, error: "crew_key_attempts" });
    expect((await getMemoryStore().getRateWindow(b.lock))?.count).toBe(1);
    // the recording build (the developer tools on, where the test clock can be set): the same row is started again
    vi.stubEnv("RIPPLE_DEV_TOOLS", "1");
    expect(await crewLockedOut("10.0.0.4")).toBe(false);
    expect(await crewGate(req({ "x-ripple-crew-key": ENV_KEY }, "10.0.0.4"))).toBeNull();
    await getMemoryStore().clearRate(b.lock);
  });
});

describe("pages: the cookie only", () => {
  it("isCrewPage is true for the crew's cookie only; requireCrewPage renders Next's 404 for anyone else", async () => {
    expect(await isCrewPage()).toBe(false);
    await expect(requireCrewPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    jar.values.set(CREW_COOKIE, crewCookieValue("an-old-key"));
    expect(await isCrewPage()).toBe(false);
    jar.values.set(CREW_COOKIE, crewCookieValue(DEV_ONLY_CREW_KEY));
    expect(await isCrewPage()).toBe(true);
    await expect(requireCrewPage()).resolves.toBeUndefined();
  });
});
