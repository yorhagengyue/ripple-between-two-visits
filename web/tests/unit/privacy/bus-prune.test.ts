/**
 * A scope's event history is kept 7 days at most (docs/plan/real-app.md 3.11 保留期限: bus_event 「每个范围最近 200 条，且不超过
 * 7 天」; C2 track H). The 200 are trimmed on publish (lib/bus.ts, 0003_bus.sql); the 7 days are Bus.pruneBefore, called
 * by the hourly job for every account scope:
 *   - in-process (STORE=memory): events made before the moment leave this process's history, the later ones stay,
 *     another scope's are untouched, listeners keep listening and ids keep counting up
 *   - with a shared log (STORE=supabase): the log's prune is asked with the moment as an ISO time; the request the
 *     Supabase log sends deletes that scope's bus_event rows with `at` before it and counts them
 *   - opt-in, on a real PostgreSQL with the migrations applied (PGlite; RIPPLE_PGLITE_MODULE as for the store
 *     contract): rows written through rp_bus_publish, the old ones gone, the sequence still counting up
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bus, type BusEvent, type BusLog } from "@/lib/bus";
import { createSupabaseBusLog, SupabaseStore } from "@/lib/store/supabase";
import { fakePostgrest, type SqlClient } from "../../support/fake-postgrest";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-10T03:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("Bus.pruneBefore, in-process", () => {
  it("drops the scope's events made before the moment, keeps the rest and every other scope's", async () => {
    const bus = new Bus();
    const heard: number[] = [];
    bus.subscribe("scope-a", (e) => heard.push(e.id));
    vi.useFakeTimers({ toFake: ["Date"], now: NOW - 9 * DAY });
    bus.publish("scope-a", "dose.logged", "nine days ago", {});
    bus.publish("scope-b", "dose.logged", "theirs, nine days ago", {});
    vi.setSystemTime(NOW - 7 * DAY - 1000);
    bus.publish("scope-a", "dose.logged", "a second over seven days ago", {});
    vi.setSystemTime(NOW - 7 * DAY + 1000);
    bus.publish("scope-a", "dose.logged", "a second under seven days ago", {});
    vi.setSystemTime(NOW);
    bus.publish("scope-a", "dose.logged", "now", {});

    expect(await bus.pruneBefore("scope-a", NOW - 7 * DAY)).toBe(2);
    expect(bus.recent("scope-a").map((e) => e.say)).toEqual(["a second under seven days ago", "now"]);
    expect(bus.recent("scope-b").map((e) => e.say)).toEqual(["theirs, nine days ago"]);
    expect(await bus.pruneBefore("scope-a", NOW - 7 * DAY)).toBe(0);
    expect(await bus.pruneBefore("nobody", NOW)).toBe(0);
    // the stream goes on: the listener is still there and the next id is the next number
    const next = bus.publish("scope-a", "dose.logged", "after", {});
    expect(heard.at(-1)).toBe(next.id);
    expect(next.id).toBeGreaterThan(heard[0]);
    // everything of a scope can go; an empty history reads as none
    expect(await bus.pruneBefore("scope-a", NOW + DAY)).toBe(3);
    expect(bus.recent("scope-a")).toEqual([]);
    expect(await bus.head("scope-a")).toBe(0);
  });
});

describe("Bus.pruneBefore, with a shared log", () => {
  it("asks the log to prune with the moment as an ISO time and returns its count; a log without prune prunes nothing", async () => {
    const asked: [string, string][] = [];
    const log: BusLog = {
      append: async () => 1,
      after: async () => [],
      latest: async () => [],
      head: async () => 0,
      clear: async () => undefined,
      prune: async (sessionId, beforeIso) => {
        asked.push([sessionId, beforeIso]);
        return 5;
      },
    };
    const bus = new Bus({ log });
    expect(await bus.pruneBefore("scope-a", NOW - 7 * DAY)).toBe(5);
    expect(asked).toEqual([["scope-a", "2026-10-03T03:00:00.000Z"]]);
    bus.close();
    const { prune: _prune, ...noPrune } = log;
    void _prune;
    const older = new Bus({ log: noPrune });
    expect(await older.pruneBefore("scope-a", NOW)).toBe(0);
    older.close();
  });

  it("the Supabase log deletes that scope's bus_event rows with `at` before the moment and counts them", async () => {
    const calls: { url: string; method: string; prefer: string }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", prefer: (init?.headers as Record<string, string>).prefer ?? "" });
      return new Response(JSON.stringify([{ seq: 1 }, { seq: 2 }, { seq: 3 }]), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const log = createSupabaseBusLog({ url: "https://proj.supabase.test", serviceKey: "fake-key", fetch: fetchImpl });
    expect(await log.prune!("scope-a", "2026-10-03T03:00:00.000Z")).toBe(3);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe("DELETE");
    expect(url.pathname).toBe("/rest/v1/bus_event");
    expect(url.searchParams.get("session_id")).toBe("eq.scope-a");
    expect(url.searchParams.get("at")).toBe("lt.2026-10-03T03:00:00.000Z");
    expect(url.searchParams.get("select")).toBe("seq");
    expect(calls[0].prefer).toContain("return=representation");
  });
});

// ---- opt-in: the real table and rp_bus_publish on PGlite
const MODULE = process.env.RIPPLE_PGLITE_MODULE?.trim();
type PgliteLike = SqlClient & { exec(sql: string): Promise<unknown> };

describe.skipIf(!MODULE)("the Supabase bus log's prune on PostgreSQL (PGlite, opt-in)", () => {
  it("rows older than the moment go, the newer ones and another scope's stay, and the sequence keeps counting up", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(MODULE!).href)) as { PGlite: new () => PgliteLike };
    const db = new mod.PGlite();
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
    `);
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
      await db.exec("begin");
      await db.exec(readFileSync(path.join(dir, f), "utf8"));
      await db.exec("commit");
    }
    const cfg = { url: "http://pglite.test", serviceKey: "test-key", fetch: fakePostgrest(db) };
    const store = new SupabaseStore(cfg);
    const a = (await store.createSession()).id;
    const b = (await store.createSession()).id;
    const log = createSupabaseBusLog(cfg);
    const event = (sessionId: string, at: number, say: string): Omit<BusEvent, "id"> => ({ type: "dose.logged", session_id: sessionId, at: new Date(at).toISOString(), say, data: null });
    await log.append(event(a, NOW - 9 * DAY, "old 1"));
    await log.append(event(a, NOW - 8 * DAY, "old 2"));
    await log.append(event(a, NOW - 1 * DAY, "new"));
    await log.append(event(b, NOW - 9 * DAY, "theirs"));

    expect(await log.prune!(a, new Date(NOW - 7 * DAY).toISOString())).toBe(2);
    expect((await log.latest(a, 10)).map((e) => e.say)).toEqual(["new"]);
    expect((await log.latest(b, 10)).map((e) => e.say)).toEqual(["theirs"]);
    expect(await log.prune!(a, new Date(NOW - 7 * DAY).toISOString())).toBe(0);
    expect(await log.head(a)).toBe(3);
    expect(await log.append(event(a, NOW, "next"))).toBe(4);
  }, 60_000);
});
