/**
 * Store round trips on the ask path (C2 track S, the latency pass of 10-10). Against the Tokyo test database every store
 * call from Singapore costs 140-300 ms, and the hero question took 4.6 s when the ask path read the same rows several
 * times, one after another. A counting wrapper around the memory store records every call the request makes (the store
 * calling itself is not a round trip), each held back a few ms so that calls made side by side really overlap, and gives
 * each call a depth: one more than the deepest call that had finished when it started. The deepest call is the number of
 * round trips the answer waited for in a row.
 *
 * The hero question on the example account, through POST /api/ask: no read twice with the same arguments, at most 6 round
 * trips in a row (his sign-in account, the scope row, the reads side by side, the transcripts, the safety record, the two
 * chat rows side by side) and 20 calls in all; the safety record and both chat rows are written.
 * C2 round 2: 17 became 20 with his counters in the store (lib/safety/cost-guard.ts StoreCostGuard): the hit on his hour's
 * questions and the two reads of his day's tokens and spend, all three side by side with the other reads (round trip 3),
 * so the answer waits no longer for them: still 6 in a row.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety/pipeline";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";

const HERO = "今天 150/95，我能不能多吃一粒？";
const inside = new AsyncLocalStorage<boolean>();

interface Call {
  method: string;
  args: string;
  depth: number;
}

/** Wrap the memory store's methods for one measurement (see the header). */
function countRoundTrips(store: object, latencyMs = 5) {
  const s = store as Record<string, unknown>;
  const calls: Call[] = [];
  let doneDepth = 0;
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(store)).filter((n) => n !== "constructor" && typeof s[n] === "function");
  for (const name of names) {
    const orig = (s[name] as (...a: unknown[]) => unknown).bind(store);
    s[name] = (...args: unknown[]) => {
      if (inside.getStore()) return orig(...args);
      const out = inside.run(true, () => orig(...args));
      if (!out || typeof (out as Promise<unknown>).then !== "function") return out;
      const call: Call = { method: name, args: JSON.stringify(args), depth: doneDepth + 1 };
      calls.push(call);
      return (async () => {
        try {
          await new Promise((r) => setTimeout(r, latencyMs));
          return await out;
        } finally {
          doneDepth = Math.max(doneDepth, call.depth);
        }
      })();
    };
  }
  return {
    calls,
    depth: () => calls.reduce((m, c) => Math.max(m, c.depth), 0),
    /** reads made more than once with the same arguments */
    repeatedReads: () => {
      const seen = new Map<string, number>();
      for (const c of calls) if (/^(get|list)/.test(c.method)) seen.set(`${c.method}${c.args}`, (seen.get(`${c.method}${c.args}`) ?? 0) + 1);
      return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    },
    count: (method: string) => calls.filter((c) => c.method === method).length,
    restore: () => {
      for (const n of names) delete s[n];
    },
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("store round trips for the hero question", () => {
  it("POST /api/ask on the example account: no read twice, at most 6 round trips in a row, 20 calls", async () => {
    const store = getMemoryStore();
    const him = await createAccountWithSpace(store, getAuthProvider(), { login: `rt${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
    const m = countRoundTrips(store);
    restore = m.restore;
    const res = await askPost(
      new NextRequest("http://localhost/api/ask", {
        method: "POST",
        headers: { cookie: `rp_at=${him.tokens.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ text: HERO, locale: "zh-Hans" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AskResult;
    expect(body).toMatchObject({ route: "refuse_route", addedQuestionId: "q-extra-tablet", questionReused: true });
    const trace = m.calls.map((c) => `${c.depth} ${c.method}`).join("\n");
    expect(m.repeatedReads(), trace).toEqual([]);
    expect(m.depth(), trace).toBeLessThanOrEqual(6);
    expect(m.calls.length, trace).toBeLessThanOrEqual(20);
    // his counters: one hit, two reads, none of them after the reads they sit beside
    expect(m.count("rateHit")).toBe(1);
    expect(m.count("getRateWindow")).toBe(2);
    const readsDepth = m.calls.find((c) => c.method === "listVisits")!.depth;
    for (const c of m.calls.filter((x) => x.method === "rateHit" || x.method === "getRateWindow")) expect(c.depth, trace).toBeLessThanOrEqual(readsDepth);
    // the safety record is never dropped, and today's turn is kept before the answer goes out
    expect(m.count("addSafetyEvent")).toBe(1);
    expect(m.count("addChatMessage")).toBe(2);
  });

  it("ask() on the demo's evening of day 29: no read twice, at most 4 round trips in a row", async () => {
    const store = getMemoryStore();
    const s = await store.createSession({ story_day: 29, story_time: "20:15", ttl_hours: 1 });
    const m = countRoundTrips(store);
    restore = m.restore;
    const r = await ask({ sessionId: s.id, text: HERO, locale: "zh-Hans", role: "patient" }, { store, llm: createMockLlm(), checker: null, checkerReason: "test", publish: () => {}, costGuard: null });
    expect(r).toMatchObject({ route: "refuse_route", addedQuestionId: "q-extra-tablet" });
    const trace = m.calls.map((c) => `${c.depth} ${c.method}`).join("\n");
    expect(m.repeatedReads(), trace).toEqual([]);
    expect(m.depth(), trace).toBeLessThanOrEqual(4);
    expect(m.count("addSafetyEvent")).toBe(1);
  });
});
