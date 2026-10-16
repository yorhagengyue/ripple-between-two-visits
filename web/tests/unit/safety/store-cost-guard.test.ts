/**
 * The ask limits counted in the store (C2 track S, round 2; real-app 3.5 「问一句，每人：每小时 60 次、每天 20 万 token」 and
 * 「DeepSeek 花费，每人每天 US$0.20：不发请求，安全层照旧把关」; 6.11 「成本保护按范围计，对账号就是按人」). Every test gives the
 * store its own clock, and the guard the same one.
 *
 *   - a restart or a second instance does not reset anything: every ask makes a new guard, and two store-backed guards
 *     over the same store share the counts
 *   - per person: an account by its user, a demo scope by itself; another person is not affected
 *   - his hour and his day: the scope's time zone, not UTC (08:00 SGT is the same UTC day as 07:59 SGT, another local day
 *     is not), and a filming account's own clock
 *   - the retry time is true: the next full hour for the hourly limit, his next midnight for the daily one
 *   - the spend cap refuses nothing: ask() answers with no model call
 */
import { describe, expect, it } from "vitest";
import { PersonSpend, usagePerson } from "@/lib/llm/person-spend";
import type { ChatResult, LlmClient } from "@/lib/llm/types";
import { ask, CostLimitError, StoreCostGuard, storeCostGuard } from "@/lib/safety";
import { MemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { usageStore } from "@/lib/subject/usage";

/** 2026-10-10 10:42:10 in Singapore (UTC+8). */
const T0 = Date.parse("2026-10-10T02:42:10.000Z");

function world(start = T0) {
  let now = start;
  const store = new MemoryStore({ now: () => new Date(now) });
  return {
    store,
    now: () => now,
    set: (ms: number) => {
      now = ms;
    },
    add: (ms: number) => {
      now += ms;
    },
  };
}

const account = (id: string, more: Partial<SessionRow> = {}) => ({ id, kind: "account" as const, owner_user_id: id, tz: "Asia/Singapore", ...more });
const LIMITS = { requestsPerHour: 3, tokensPerDay: 1000 };

async function refusal(p: Promise<void>): Promise<CostLimitError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof CostLimitError) return e;
    throw e;
  }
}

describe("questions an hour, in the store", () => {
  it("the limit-th ask is admitted, the next one is refused until the next full hour on his clock; a new guard (a restart, another instance) sees the same count", async () => {
    const w = world();
    const him = account("u-hour");
    const guard = () => storeCostGuard(usageStore(w.store), him, { limits: LIMITS, nowMs: w.now });
    for (let i = 0; i < 3; i++) expect(await refusal(guard().admit(him.id)), `ask ${i + 1}`).toBeNull();
    const over = await refusal(guard().admit(him.id));
    expect(over?.limit).toBe("requests_per_hour");
    // 10:42:10 -> 11:00:00 is 17 min 50 s
    expect(over?.retryAfterSec).toBe(17 * 60 + 50);
    // a second process over the same store: its own guard class, the same answer
    const other = new StoreCostGuard(usageStore(w.store), usagePerson(him, w.now), { limits: LIMITS });
    expect((await refusal(other.admit(him.id)))?.limit).toBe("requests_per_hour");
    // crisis answers are never refused (and still counted)
    expect(await refusal(guard().admit(him.id, { exempt: true }))).toBeNull();
    // 10:59:59 still refused; 11:00:00 a new hour
    w.set(Date.parse("2026-10-10T02:59:59.000Z"));
    expect((await refusal(guard().admit(him.id)))?.retryAfterSec).toBe(1);
    w.set(Date.parse("2026-10-10T03:00:00.000Z"));
    expect(await refusal(guard().admit(him.id))).toBeNull();
    expect((await guard().snapshot()).requestsThisHour).toBe(1);
  });

  it("is per person: another account, and a demo scope with the same id string, have their own counts", async () => {
    const w = world();
    const him = account("u-a");
    const guardFor = (scope: Parameters<typeof storeCostGuard>[1]) => storeCostGuard(usageStore(w.store), scope, { limits: LIMITS, nowMs: w.now });
    for (let i = 0; i < 4; i++) await refusal(guardFor(him).admit(him.id));
    expect((await refusal(guardFor(him).admit(him.id)))?.limit).toBe("requests_per_hour");
    expect(await refusal(guardFor(account("u-b")).admit("u-b"))).toBeNull();
    expect(await refusal(guardFor({ id: "u-a", kind: "sandbox" }).admit("u-a"))).toBeNull();
  });

  it("the bucket is named by an HMAC, never the person's id", async () => {
    const w = world();
    const him = account("0b6f6c1e-aaaa-4bbb-8ccc-1234567890ab");
    const seen: string[] = [];
    const spy = { rateHit: (b: string, s: number, l: number) => (seen.push(b), w.store.rateHit(b, s, l)), rateAdd: (b: string, s: number, l: number, a: number) => (seen.push(b), w.store.rateAdd(b, s, l, a)), getRateWindow: (b: string) => (seen.push(b), w.store.getRateWindow(b)) };
    const g = storeCostGuard(spy, him, { limits: LIMITS, nowMs: w.now });
    await g.admit(him.id);
    g.addTokens(him.id, 10);
    g.addSpend(0.001);
    await g.settle();
    expect(seen.length).toBe(5);
    for (const b of seen) expect(b).not.toContain(him.id);
    expect(seen.some((b) => /^ask:h:[0-9a-f]{32}:2026-10-10T10$/.test(b))).toBe(true);
    expect(seen.some((b) => /^ask:t:[0-9a-f]{32}:2026-10-10$/.test(b))).toBe(true);
    expect(seen.some((b) => /^llm:u:[0-9a-f]{32}:2026-10-10$/.test(b))).toBe(true);
  });
});

describe("model tokens a day, in the store", () => {
  it("at the limit questions are refused until his next midnight: the Singapore day, not the UTC day", async () => {
    // 07:30 SGT on 10-10 is 23:30 UTC on 10-09: the UTC day turns half an hour later, his day does not
    const w = world(Date.parse("2026-10-09T23:30:00.000Z"));
    const him = account("u-tok");
    const guard = () => storeCostGuard(usageStore(w.store), him, { limits: LIMITS, nowMs: w.now });
    const g1 = guard();
    await g1.admit(him.id);
    g1.addTokens(him.id, 600);
    g1.addTokens(him.id, 400);
    await g1.settle();
    expect((await guard().snapshot()).tokensToday).toBe(1000);
    const over = await refusal(guard().admit(him.id));
    expect(over?.limit).toBe("tokens_per_day");
    // 07:30 -> 24:00 SGT is 16.5 hours
    expect(over?.retryAfterSec).toBe(16.5 * 3600);
    // past UTC midnight (08:10 SGT, a new clock hour): still the same day for him
    w.set(Date.parse("2026-10-10T00:10:00.000Z"));
    expect((await refusal(guard().admit(him.id)))?.limit).toBe("tokens_per_day");
    // 23:59:59 SGT: one second left
    w.set(Date.parse("2026-10-10T15:59:59.000Z"));
    expect((await refusal(guard().admit(him.id)))?.retryAfterSec).toBe(1);
    // his midnight: a new day, nothing counted yet
    w.set(Date.parse("2026-10-10T16:00:00.000Z"));
    expect(await refusal(guard().admit(him.id))).toBeNull();
    expect((await guard().snapshot()).tokensToday).toBe(0);
    // crisis answers were never refused meanwhile
    w.set(Date.parse("2026-10-10T00:10:00.000Z"));
    expect(await refusal(guard().admit(him.id, { exempt: true }))).toBeNull();
  });

  it("a scope in another time zone has its own midnight; a filming account's clock offset moves his day", async () => {
    const w = world(Date.parse("2026-10-10T02:00:00.000Z")); // 10:00 SGT, 22:00 the day before in New York
    const ny = account("u-ny", { tz: "America/New_York" });
    const g = storeCostGuard(usageStore(w.store), ny, { limits: LIMITS, nowMs: w.now });
    await g.admit(ny.id);
    g.addTokens(ny.id, 1000);
    await g.settle();
    const over = await refusal(storeCostGuard(usageStore(w.store), ny, { limits: LIMITS, nowMs: w.now }).admit(ny.id));
    expect(over?.limit).toBe("tokens_per_day");
    expect(over?.retryAfterSec).toBe(2 * 3600);
    // a filming account three days ahead: its own day's bucket, empty
    const filming = account("u-ny", { tz: "America/New_York", filming: true, clock_offset_ms: 3 * 86_400_000 });
    expect(await refusal(storeCostGuard(usageStore(w.store), filming, { limits: LIMITS, nowMs: w.now }).admit(ny.id))).toBeNull();
  });

  it("a store that cannot sum (the migration is not applied) is logged and the ask goes on", async () => {
    const w = world();
    const him = account("u-nosum");
    const broken = { rateHit: w.store.rateHit.bind(w.store), getRateWindow: w.store.getRateWindow.bind(w.store), rateAdd: async () => Promise.reject(Object.assign(new Error("no function"), { code: "not_configured" })) };
    const g = storeCostGuard(broken, him, { limits: LIMITS, nowMs: w.now });
    await g.admit(him.id);
    g.addTokens(him.id, 5000);
    g.addSpend(1);
    await expect(g.settle()).resolves.toBeUndefined();
    expect(await refusal(storeCostGuard(broken, him, { limits: LIMITS, nowMs: w.now }).admit(him.id))).toBeNull();
  });
});

describe("the per-person model spend cap", () => {
  it("counts US$ per person and local day in the store, and says capped at US$0.20", async () => {
    const w = world(Date.parse("2026-10-09T23:30:00.000Z")); // 07:30 SGT on 10-10
    const him = usagePerson(account("u-spend"), w.now);
    const mine = () => new PersonSpend(usageStore(w.store), him);
    const a = mine();
    expect(a.capUsd).toBe(0.2);
    expect(await a.capped()).toBe(false);
    a.add(0.12);
    a.add(undefined);
    a.add(-1);
    await a.settle();
    expect(await mine().spentUsd()).toBeCloseTo(0.12, 6);
    expect(await mine().capped()).toBe(false);
    const b = mine();
    b.add(0.08);
    await b.settle();
    expect(await mine().capped()).toBe(true);
    // another person is not capped
    expect(await new PersonSpend(usageStore(w.store), usagePerson(account("u-other"), w.now)).capped()).toBe(false);
    // past UTC midnight: still his day; at his midnight: a new day
    w.set(Date.parse("2026-10-10T00:30:00.000Z"));
    expect(await mine().capped()).toBe(true);
    w.set(Date.parse("2026-10-10T16:00:01.000Z"));
    expect(await mine().capped()).toBe(false);
    expect(await mine().spentUsd()).toBe(0);
  });

  it("wrap() adds what each call cost; LLM_PERSON_SPEND_CAP_USD changes the cap", async () => {
    const w = world();
    const him = usagePerson(account("u-wrap"), w.now);
    const spend = new PersonSpend(usageStore(w.store), him, { env: { LLM_PERSON_SPEND_CAP_USD: "0.01" } });
    expect(spend.capUsd).toBe(0.01);
    const live: LlmClient = { provider: "fake-live", model: "fake", chat: async (): Promise<ChatResult> => ({ content: "{}", tokens: 100, usd: 0.006 }) };
    const counted = spend.wrap(live);
    expect(counted.provider).toBe("fake-live");
    await counted.chat({ system: "s", user: "u" });
    await counted.chat({ system: "s", user: "u" });
    await spend.settle();
    expect(await new PersonSpend(usageStore(w.store), him, { capUsd: 0.01 }).capped()).toBe(true);
    expect(spend.wrap(null)).toBeNull();
  });

  it("ask(): under the cap the model is called and its cost counted; at the cap no request is sent and the rules answer (no 429)", async () => {
    const w = world();
    const s = await w.store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 72 });
    let calls = 0;
    const live = {
      provider: "fake-live",
      model: "fake",
      chat: async (): Promise<ChatResult> => {
        calls++;
        return { content: '{"crisis":"none"}', tokens: 500, usd: 0.15 };
      },
    } as LlmClient;
    const guard = () => storeCostGuard(usageStore(w.store), s, { nowMs: w.now });
    const g1 = guard();
    const first = await ask({ sessionId: s.id, text: "Everything feels heavy today", locale: "en" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: g1 });
    expect(first.route).toBe("log_only");
    expect(first.spendCapped).toBeUndefined();
    expect(calls).toBeGreaterThan(0);
    await g1.settle();
    const snap1 = await guard().snapshot();
    expect(snap1.spendUsdToday).toBeCloseTo(0.15 * calls, 6);
    expect(snap1.tokensToday).toBe(500 * calls);
    expect(snap1.requestsThisHour).toBe(1);
    // one more paid ask takes him past US$0.20
    const g2 = guard();
    const before = calls;
    await ask({ sessionId: s.id, text: "The weather was fine and I walked to the market", locale: "en" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: g2 });
    await g2.settle();
    expect(calls).toBeGreaterThan(before);
    // at the cap: a question is still answered, by the rules and the offline composer, and no request is sent
    const sent = calls;
    const g3 = guard();
    const capped = await ask({ sessionId: s.id, text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: g3 });
    expect(calls, "no model call at the cap").toBe(sent);
    expect(capped.spendCapped).toBe(true);
    expect(capped.route).toBe("refuse_route");
    expect(capped.llm.provider).toBe("mock");
    expect(capped.sentences.some((x) => x.sourceId.includes("R4"))).toBe(true);
    expect((capped.events[0].output as { spendCapped: boolean }).spendCapped).toBe(true);
    // 10-14 (the owner's decision): a plain note at the cap is only the note; a note whose own words carry a crisis cue
    // word carries the fixed safety line (no crisis screen looked at it), and says why
    const g4 = guard();
    const note = await ask({ sessionId: s.id, text: "I feel a bit tired today", locale: "en" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: g4 });
    expect(note.sentences.map((x) => x.templateId)).not.toContain("safety_line");
    expect((note.events[0].output as { safetyLine: unknown }).safetyLine).toBeNull();
    const weak = await ask({ sessionId: s.id, text: "I feel weak today", locale: "en" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: guard() });
    expect(weak.sentences.map((x) => x.templateId)).toContain("safety_line");
    expect((weak.events[0].output as { safetyLine: unknown }).safetyLine).toEqual({ reason: "spend_cap", cue: true });
    // an emergency never waits for any of it
    const em = await ask({ sessionId: s.id, text: "I have chest pain right now", locale: "en" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: guard() });
    expect(em.route).toBe("emergency");
    expect(em.spendCapped).toBeUndefined();
    expect(calls).toBe(sent);
    // his next day: the model is asked again
    w.add(24 * 3_600_000);
    const g5 = guard();
    const next = await ask({ sessionId: s.id, text: "Everything feels heavy today", locale: "en" }, { store: w.store, llm: live, checker: null, checkerReason: "test", publish: () => {}, costGuard: g5 });
    expect(next.spendCapped).toBeUndefined();
    expect(calls).toBeGreaterThan(sent);
  });
});

describe("the usage counters' way to the store", () => {
  it("hands out the three counter methods and nothing else", async () => {
    const w = world();
    const u = usageStore(w.store);
    expect((await u.rateHit("x", 60, 1)).count).toBe(1);
    expect((await u.rateAdd("x", 60, 10, 4)).count).toBe(5);
    expect((await u.getRateWindow("x"))?.count).toBe(5);
    expect(() => (u as unknown as { listVisits: (id: string) => unknown }).listVisits("s")).toThrow(/usage counters/);
    expect(() => (u as unknown as { clearRate: (b: string) => unknown }).clearRate("x")).toThrow(/usage counters/);
  });
});
