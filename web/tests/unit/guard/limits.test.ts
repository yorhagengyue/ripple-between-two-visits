/**
 * The limits-table rows track L built (lib/guard/limits.ts, lib/subject/limits.ts; real-app 3.5 lines 541-545), each
 * with the store's clock in the test's hands: counted in the store's rate_limit buckets, a fixed window from the first
 * hit, 429 with the time to try again, and the routes that count against them.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as chunkPOST } from "@/app/api/asr/chunk/route";
import { POST as labelReadPOST } from "@/app/api/labels/read/route";
import { POST as sessionPOST } from "@/app/api/session/route";
import { POST as ttsPOST } from "@/app/api/tts/route";
import { POST as uploadUrlPOST } from "@/app/api/upload-url/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { WhisperSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { LIMITS } from "@/lib/auth/limits";
import { countAgainst, GUARD_DEV_FACTOR, GUARD_LIMITS, personKey, retryAfterS, type GuardLimit } from "@/lib/guard/limits";
import { MemoryStore, getMemoryStore } from "@/lib/store/memory";
import { StoreError } from "@/lib/store/types";
import { ScopeViolation } from "@/lib/subject";
import { limitStore, overResponse } from "@/lib/subject/limits";
import { encodeWav } from "@/lib/visit/wav";
import { fakeConfig, fakeWhisper, type FakeWhisper } from "../asr/fake-whisper";
import { newSession } from "../visit/helpers";

/** A real server: the developer tools are off, so the table's own numbers apply. */
const PROD = { NODE_ENV: "production" };
const T0 = Date.parse("2026-10-10T02:00:00.000Z");

function clocked() {
  const clock = { now: T0 };
  const store = new MemoryStore({ now: () => new Date(clock.now) });
  const count = (name: GuardLimit, who: string, amount?: number, env: Record<string, string | undefined> = PROD) =>
    countAgainst(store, name, who, { env, nowMs: clock.now, ...(amount === undefined ? {} : { amount }) });
  return { clock, store, count };
}

describe("the rows are the table's", () => {
  it("numbers, windows and what each counts by", () => {
    expect(GUARD_LIMITS).toEqual({
      demoSandbox: { per: "ip", windowS: 3600, limit: 10, bucket: "g:ds", unit: "request" },
      labelRead: { per: "person", windowS: 86_400, limit: 30, bucket: "g:lr", unit: "request" },
      captionAudio: { per: "person", windowS: 86_400, limit: 14_400, bucket: "g:ca", unit: "second of audio" },
      uploadLink: { per: "person", windowS: 3600, limit: 100, bucket: "g:ul", unit: "request" },
      // not in the design's table: the neighbour's number (the sign-in screens' read-aloud, 30 an hour)
      readAloud: { per: "person", windowS: 3600, limit: 30, bucket: "g:ra", unit: "request" },
    });
    expect(GUARD_LIMITS.readAloud.limit).toBe(LIMITS.readAloudPerIp.limit);
    expect(new Set(Object.values(GUARD_LIMITS).map((r) => r.bucket)).size).toBe(5);
  });
});

describe.each([
  ["demoSandbox", "203.0.113.9", "203.0.113.10", 10, 3600],
  ["labelRead", "u:11111111-1111-4111-8111-111111111111", "u:22222222-2222-4222-8222-222222222222", 30, 86_400],
  ["uploadLink", "u:11111111-1111-4111-8111-111111111111", "s:demo-abc", 100, 3600],
  ["readAloud", "u:11111111-1111-4111-8111-111111111111", "u:22222222-2222-4222-8222-222222222222", 30, 3600],
] as const)("%s", (name, who, other, limit, windowS) => {
  it(`${limit} pass, the next is refused until the window ends, and someone else is not affected`, async () => {
    const { clock, count } = clocked();
    for (let i = 1; i <= limit; i++) expect(await count(name, who), `hit ${i}`).toBeNull();
    const over = await count(name, who);
    expect(over).toEqual({ limit: name, until: new Date(T0 + windowS * 1000).toISOString() });
    expect(await count(name, other)).toBeNull();
    // still refused a moment before the window ends, and the time to try again does not move
    clock.now = T0 + windowS * 1000 - 1000;
    expect(await count(name, who)).toEqual(over);
    expect(retryAfterS(over!.until, clock.now)).toBe(1);
    // a new window starts with the first hit after it
    clock.now = T0 + windowS * 1000;
    expect(await count(name, who)).toBeNull();
  });
});

describe("captionAudio: 4 hours of audio a day, counted in seconds", () => {
  const who = "u:33333333-3333-4333-8333-333333333333";

  it("the seconds add up to 14400; the piece that goes over is refused until the day's window ends", async () => {
    const { clock, count } = clocked();
    for (let i = 0; i < 479; i++) expect(await count("captionAudio", who, 30)).toBeNull(); // 3 h 59 min 30 s
    expect(await count("captionAudio", who, 29.2)).toBeNull(); // rounded up to 30: exactly 4 hours
    const over = await count("captionAudio", who, 0.3);
    expect(over).toEqual({ limit: "captionAudio", until: new Date(T0 + 86_400_000).toISOString() });
    expect(await count("captionAudio", "u:someone-else", 30)).toBeNull();
    clock.now = T0 + 86_400_000;
    expect(await count("captionAudio", who, 2.5)).toBeNull();
  });

  it("a piece counts its whole seconds, rounded up (2.3 s is 3)", async () => {
    const { store, count } = clocked();
    const add = vi.spyOn(store, "rateAdd");
    await count("captionAudio", who, 2.3);
    await count("captionAudio", who, 30);
    expect(add.mock.calls.map((c) => c[3])).toEqual([3, 30]);
    expect(add.mock.calls[0][2]).toBe(14_400);
  });

  it("a database without the summed counter (the migration not applied yet) lets the audio through and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, count } = clocked();
    vi.spyOn(store, "rateAdd").mockRejectedValue(new StoreError("not_configured", "the database schema is missing"));
    expect(await count("captionAudio", who, 10)).toBeNull();
    expect(await count("captionAudio", who, 10)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("rp_rate_add");
    // any other failure, and the plain counter's, is not swallowed
    vi.spyOn(store, "rateAdd").mockRejectedValue(new Error("boom"));
    await expect(count("captionAudio", who, 10)).rejects.toThrow("boom");
    vi.spyOn(store, "rateHit").mockRejectedValue(new StoreError("not_configured", "x"));
    await expect(count("labelRead", who)).rejects.toBeInstanceOf(StoreError);
    vi.restoreAllMocks();
  });
});

describe("how they are counted", () => {
  it("the bucket is named by an HMAC of the address or the person, never the value", async () => {
    const { store, count } = clocked();
    const hit = vi.spyOn(store, "rateHit");
    await count("demoSandbox", "203.0.113.9");
    await count("labelRead", "u:11111111-1111-4111-8111-111111111111");
    const names = hit.mock.calls.map((c) => c[0]);
    expect(names[0]).toMatch(/^g:ds:[0-9a-f]{32}$/);
    expect(names[1]).toMatch(/^g:lr:[0-9a-f]{32}$/);
    for (const n of names) {
      expect(n).not.toContain("203.0.113.9");
      expect(n).not.toContain("11111111");
    }
    // the same value under another row is another bucket
    await count("uploadLink", "203.0.113.9");
    expect(hit.mock.calls[2][0].slice(5)).not.toBe(names[0].slice(5)); // keyed as a person there, not as an address
    expect(hit.mock.calls[2][0].slice(0, 5)).toBe("g:ul:");
  });

  it("they live in the store: another process with the same store sees the count (a restart keeps them)", async () => {
    const { store, clock } = clocked();
    for (let i = 0; i < 10; i++) await countAgainst(store, "demoSandbox", "203.0.113.9", { env: PROD, nowMs: clock.now });
    // nothing is kept in this module: a fresh import of the counter over the same store is refused at once
    vi.resetModules();
    const fresh = await import("@/lib/guard/limits");
    expect(await fresh.countAgainst(store, "demoSandbox", "203.0.113.9", { env: PROD, nowMs: clock.now })).toMatchObject({ limit: "demoSandbox" });
  });

  it(`where the developer tools are on every row is ${GUARD_DEV_FACTOR} times looser (the e2e suite opens a sandbox per test)`, async () => {
    const { store, count } = clocked();
    const hit = vi.spyOn(store, "rateHit");
    for (const env of [{ NODE_ENV: "test" }, { NODE_ENV: "production", RIPPLE_DEV_TOOLS: "1" }]) {
      for (let i = 0; i < 25; i++) expect(await count("demoSandbox", `203.0.113.${env.NODE_ENV === "test" ? 1 : 2}`, undefined, env)).toBeNull();
    }
    expect(hit.mock.calls[0][2]).toBe(10 * GUARD_DEV_FACTOR);
    expect(GUARD_DEV_FACTOR).toBeGreaterThanOrEqual(1000);
  });

  it("a window left behind by a clock that moved back (the test clock) is started again", async () => {
    const { clock, count } = clocked();
    clock.now = T0 + 30 * 86_400_000; // a spec set a date a month ahead and opened sandboxes there
    for (let i = 0; i < 10; i++) await count("demoSandbox", "203.0.113.9");
    expect(await count("demoSandbox", "203.0.113.9")).not.toBeNull();
    clock.now = T0; // the test clock was cleared: without the fix this bucket stayed shut for a month
    expect(await count("demoSandbox", "203.0.113.9")).toBeNull();
    for (let i = 0; i < 9; i++) expect(await count("demoSandbox", "203.0.113.9")).toBeNull();
    expect(await count("demoSandbox", "203.0.113.9")).toMatchObject({ until: new Date(T0 + 3_600_000).toISOString() });
  });

  it("每人: an account's user, her own user when she comes through a link, the sandbox for a demo phone", () => {
    expect(personKey({ userId: "u1", scope: { id: "u1" } })).toBe("u:u1");
    expect(personKey({ userId: "her", scope: { id: "his" } })).toBe("u:her");
    expect(personKey({ userId: null, scope: { id: "demo-abc" } })).toBe("s:demo-abc");
  });
});

describe("the limits' way to the store", () => {
  it("exactly the three rate methods; anything else of the process-wide store is refused", async () => {
    const base = new MemoryStore();
    const narrow = limitStore(base) as unknown as MemoryStore;
    expect(await narrow.rateHit("b", 60, 1)).toMatchObject({ count: 1 });
    expect(await narrow.rateAdd("b", 60, 10, 4)).toMatchObject({ count: 5 });
    await narrow.clearRate("b");
    expect(() => narrow.listSessions()).toThrow(ScopeViolation);
    expect(() => narrow.getAccount("u")).toThrow(ScopeViolation);
    expect(() => narrow.getRateWindow("b")).toThrow(ScopeViolation);
  });

  it("the refusal: 429 too_many with the row, when to try again, Retry-After, never cached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const res = overResponse({ limit: "labelRead", until: new Date(T0 + 90_500).toISOString() });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too_many", limit: "labelRead", until: new Date(T0 + 90_500).toISOString(), retry_after_ms: 91_000 });
    expect(res.headers.get("retry-after")).toBe("91");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------------------------- the routes

const BASE = "http://localhost:3640";
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function tooMany(res: Response, name: GuardLimit): Promise<void> {
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: string; limit: string; until: string };
  expect(body).toMatchObject({ error: "too_many", limit: name });
  expect(Date.parse(body.until)).toBeGreaterThan(Date.now());
  expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
}

describe("the routes count against their row (a real server: developer tools off)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("POST /api/session: the 11th sandbox from one address in an hour is 429; another address still opens one", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const from = (addr: string) => ({ "x-forwarded-for": addr });
    for (let i = 0; i < 10; i++) expect((await sessionPOST(post("/api/session", {}, from(ip)))).status, `sandbox ${i + 1}`).toBe(201);
    await tooMany(await sessionPOST(post("/api/session", {}, from(ip))), "demoSandbox");
    await tooMany(await sessionPOST(post("/api/session", { kind: "sandbox", role: "judge" }, from(ip))), "demoSandbox");
    expect((await sessionPOST(post("/api/session", {}, from("198.51.100.250")))).status).toBe(201);
    // the crew's filming session is not a sandbox: its own gate answers (no key here: 404), not this limit
    expect((await sessionPOST(post("/api/session", { kind: "filming" }, from(ip)))).status).toBe(404);
  });

  it("POST /api/labels/read: 30 a day per person; the 31st is 429 before anything is read", async () => {
    const s = await newSession({ story_day: 29 });
    const read = () => labelReadPOST(post(`/api/labels/read?session=${s.id}`, { path: `${s.id}/labels/none.png` }));
    expect((await read()).status).not.toBe(429);
    for (let i = 0; i < 29; i++) expect(await countAgainst(limitStore(getMemoryStore()), "labelRead", personKey({ userId: null, scope: s }), { env: PROD })).toBeNull();
    await tooMany(await read(), "labelRead");
    const other = await newSession({ story_day: 29 });
    expect((await labelReadPOST(post(`/api/labels/read?session=${other.id}`, { path: `${other.id}/labels/none.png` }))).status).not.toBe(429);
  });

  it("POST /api/tts: 30 cards read aloud an hour per person; the 31st is 429 before the voice service is asked", async () => {
    const s = await newSession({ story_day: 29 });
    const read = () => ttsPOST(post(`/api/tts?session=${s.id}`, { card: "explain", med_id: "med-amlodipine" }));
    const first = await read();
    expect(first.status).not.toBe(429);
    for (let i = 0; i < 29; i++) expect(await countAgainst(limitStore(getMemoryStore()), "readAloud", personKey({ userId: null, scope: s }), { env: PROD })).toBeNull();
    await tooMany(await read(), "readAloud");
    const other = await newSession({ story_day: 29 });
    expect((await ttsPOST(post(`/api/tts?session=${other.id}`, { card: "explain", med_id: "med-amlodipine" }))).status).not.toBe(429);
  });

  it("POST /api/upload-url: 100 an hour per person (an account's user)", async () => {
    const a = await createAccountWithSpace(getMemoryStore(), getAuthProvider(), { login: `u${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const ask = () => uploadUrlPOST(post("/api/upload-url", { kind: "label", content_type: "image/png" }, { cookie: `rp_at=${a.tokens.access_token}` }));
    expect((await ask()).status).toBe(200);
    for (let i = 0; i < 99; i++) expect(await countAgainst(limitStore(getMemoryStore()), "uploadLink", `u:${a.userId}`, { env: PROD })).toBeNull();
    await tooMany(await ask(), "uploadLink");
  });
});

describe("POST /api/asr/chunk counts the audio it is given", () => {
  const speech = () => {
    const g = globalThis as unknown as { __rippleSpeech?: Map<string, unknown> };
    g.__rippleSpeech ??= new Map();
    return g.__rippleSpeech;
  };
  let fake: FakeWhisper;
  beforeEach(() => {
    vi.stubEnv("SPEECH_PROVIDER", "whisper");
    fake = fakeWhisper();
    speech().set("whisper", new WhisperSpeechProvider({ config: fakeConfig(), fetch: fake.fetch }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    speech().delete("whisper");
  });

  let line = 0;
  const chunk = (sessionId: string, seconds: number) =>
    new NextRequest(`${BASE}/api/asr/chunk?${new URLSearchParams({ session: sessionId, visit_id: "v1", kind: "chunk", line: `v1-wlimit-${++line}`, offset_ms: "1000", seq: "1" })}`, {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: encodeWav(new Float32Array(16_000 * seconds).fill(0.05)) as unknown as BodyInit,
    });

  it("each piece adds its seconds; past 4 hours in a day the next piece is 429 with when to come back, and no audio is sent on", async () => {
    const s = await newSession({ story_day: 0 });
    expect((await visitsPOST(post(`/api/visits?session=${s.id}`, { mode: "record", consent: { given: true } }))).status).toBe(200);
    const add = vi.spyOn(getMemoryStore(), "rateAdd");
    expect((await chunkPOST(chunk(s.id, 2))).status).toBe(200);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][3]).toBe(2);
    expect(add.mock.calls[0][0]).toMatch(/^g:ca:[0-9a-f]{32}$/);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIPPLE_DEV_TOOLS", "");
    // 2 s so far; 479 pieces of 30 s and one of 28 s make exactly 4 hours
    const who = personKey({ userId: null, scope: s });
    for (let i = 0; i < 479; i++) expect(await countAgainst(limitStore(getMemoryStore()), "captionAudio", who, { env: PROD, amount: 30 })).toBeNull();
    expect(await countAgainst(limitStore(getMemoryStore()), "captionAudio", who, { env: PROD, amount: 28 })).toBeNull();
    const sent = fake.calls.length;
    const res = await chunkPOST(chunk(s.id, 2));
    const copy = res.clone();
    await tooMany(res, "captionAudio");
    expect(fake.calls.length).toBe(sent); // refused before the service is asked
    expect(((await copy.json()) as { retry_after_ms: number }).retry_after_ms).toBeGreaterThan(0);
    add.mockRestore();
  });
});
