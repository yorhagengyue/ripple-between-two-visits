/**
 * lib/bus.ts in STORE=supabase mode and GET /api/events tailing, against an in-memory fake of the bus_event
 * table (same contract as createSupabaseBusLog: per-session ids without gaps). Two Bus objects sharing one log
 * stand for two server instances. The real table is exercised by supabase.live.test.ts and the multi-instance
 * check (scripts/db/multi-instance.mjs + e2e/supa-multi-instance.spec.ts).
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/events/route";
import { Bus, type BusEvent, type BusLog } from "@/lib/bus";
import { getMemoryStore } from "@/lib/store/memory";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeLog implements BusLog {
  private events = new Map<string, BusEvent[]>();
  private heads = new Map<string, number>();
  delay: () => number = () => 0;
  failNext = 0;
  reads = 0;

  async append(event: Omit<BusEvent, "id">): Promise<number> {
    const d = this.delay();
    if (d) await sleep(d);
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("Supabase publish event: HTTP 503 (PGRST002)");
    }
    const id = (this.heads.get(event.session_id) ?? 0) + 1;
    this.heads.set(event.session_id, id);
    const list = this.events.get(event.session_id) ?? [];
    list.push(structuredClone({ ...event, id }));
    this.events.set(event.session_id, list);
    return id;
  }
  async after(sessionId: string, afterId: number, limit: number): Promise<BusEvent[]> {
    this.reads++;
    return structuredClone((this.events.get(sessionId) ?? []).filter((e) => e.id > afterId).slice(0, limit));
  }
  async latest(sessionId: string, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).slice(-limit));
  }
  async head(sessionId: string): Promise<number> {
    return this.heads.get(sessionId) ?? 0;
  }
  async clear(sessionId: string): Promise<void> {
    this.events.set(sessionId, []);
  }
  stored(sessionId: string): BusEvent[] {
    return this.events.get(sessionId) ?? [];
  }
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await sleep(5);
  }
}

const buses: Bus[] = [];
function instance(log: BusLog, pollMs = 20): Bus {
  const b = new Bus({ log, pollMs, lingerMs: 50 });
  buses.push(b);
  return b;
}

afterEach(() => {
  for (const b of buses.splice(0)) b.close();
  vi.unstubAllEnvs();
});

describe("bus, STORE=supabase mode (shared log)", () => {
  it("an event published on instance A reaches a listener on instance B, in order, with stored ids", async () => {
    const log = new FakeLog();
    const a = instance(log);
    const b = instance(log);
    expect(a.isRemote).toBe(true);
    const got: BusEvent[] = [];
    b.subscribe("S", (e) => got.push(e));
    const e1 = a.publish("S", "dose.logged", "陈先生勾了「吃了」", { state: "taken" });
    a.publish("S", "clock.changed", "Day 30", { day: 30 });
    a.publish("OTHER", "clock.changed", "not mine", {});
    a.publish("S", "director.cue", "reminder", { cue: "reminder" });
    await until(() => got.length === 3);
    expect(got.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(got.map((e) => e.say)).toEqual(["陈先生勾了「吃了」", "Day 30", "reminder"]);
    expect(got[0]).toMatchObject({ session_id: "S", type: "dose.logged", data: { state: "taken" } });
    await a.flush();
    expect(e1.id).toBe(1); // the returned event gets its stored id
    await sleep(60);
    expect(got).toHaveLength(3); // nothing twice
  });

  it("stores one session's events in publish order even when writes are slow", async () => {
    const log = new FakeLog();
    log.delay = () => Math.floor(Math.random() * 12);
    const a = instance(log);
    for (let i = 0; i < 10; i++) a.publish("S", "asr.partial", `p${i}`, { i });
    await a.flush("S");
    expect(log.stored("S").map((e) => [e.id, e.say])).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, `p${i}`]));
  });

  it("snapshots the payload at publish time", async () => {
    const log = new FakeLog();
    log.delay = () => 10;
    const a = instance(log);
    const data = { state: "taken" };
    a.publish("S", "dose.logged", "x", data);
    data.state = "changed later";
    await a.flush();
    expect(log.stored("S")[0].data).toEqual({ state: "taken" });
  });

  it("a failed write is logged, never thrown, and later events still go through", async () => {
    const log = new FakeLog();
    log.failNext = 1;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = instance(log);
    expect(() => a.publish("S", "dose.logged", "lost", {})).not.toThrow();
    a.publish("S", "dose.logged", "kept", {});
    await a.flush();
    expect(log.stored("S").map((e) => e.say)).toEqual(["kept"]);
    expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toMatch(/could not store event dose\.logged/);
    warn.mockRestore();
  });

  it("recent() serves this instance's tail only while it is current; clearHistory empties the table copy", async () => {
    const log = new FakeLog();
    const a = instance(log);
    const b = instance(log);
    a.publish("S", "clock.changed", "Day 8", {});
    a.publish("S", "clock.changed", "Day 9", {});
    await a.flush();
    expect(b.recent("S")).toEqual([]); // no tailer here: unknown, not stale
    expect(await b.head("S")).toBe(2);
    expect((await b.after("S", 1)).map((e) => e.say)).toEqual(["Day 9"]);
    const off = b.subscribe("S", () => {});
    await until(() => b.recent("S").length === 2);
    expect(b.recent("S", { limit: 1 })[0]).toMatchObject({ id: 2, say: "Day 9" });
    b.clearHistory("S");
    expect(b.recent("S")).toEqual([]);
    await b.flush("S");
    expect(log.stored("S")).toEqual([]);
    expect(await b.head("S")).toBe(2); // ids keep counting
    a.publish("S", "session.reset", "reset", {});
    await until(() => b.recent("S").length === 1);
    expect(b.recent("S")[0]).toMatchObject({ id: 3, type: "session.reset" });
    off();
  });

  it("the memory mode is unchanged: no log, synchronous delivery, process-wide ids", () => {
    const bus = new Bus();
    expect(bus.isRemote).toBe(false);
    const got: number[] = [];
    bus.subscribe("S", (e) => got.push(e.id));
    const e = bus.publish("S", "dose.logged", "x", {});
    expect(got).toEqual([e.id]);
    expect(e.id).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ GET /api/events with a shared log

const decoder = new TextDecoder();

/** Read the stream for `ms` (or until it ends) and return the text. */
async function readFor(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<{ text: string; ended: boolean }> {
  let text = "";
  const end = Date.now() + ms;
  for (;;) {
    const left = end - Date.now();
    if (left <= 0) return { text, ended: false };
    const r = await Promise.race([reader.read(), sleep(left).then(() => null)]);
    if (r === null) return { text, ended: false };
    if (r.done) return { text, ended: true };
    text += decoder.decode(r.value);
  }
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: RegExp | string, ms = 3000): Promise<string> {
  let text = "";
  const end = Date.now() + ms;
  while (!(typeof needle === "string" ? text.includes(needle) : needle.test(text))) {
    const left = end - Date.now();
    if (left <= 0) throw new Error(`no ${needle} within ${ms} ms; got: ${text}`);
    const r = await Promise.race([reader.read(), sleep(left).then(() => null)]);
    if (r === null) continue;
    if (r.done) throw new Error(`stream ended before ${needle}; got: ${text}`);
    text += decoder.decode(r.value);
  }
  return text;
}

const dataOf = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as BusEvent);

type G = typeof globalThis & { __rippleBus?: Bus };

async function withProcessBus<T>(bus: Bus, run: () => Promise<T>): Promise<T> {
  const g = globalThis as G;
  const before = g.__rippleBus;
  g.__rippleBus = bus;
  try {
    return await run();
  } finally {
    g.__rippleBus = before;
  }
}

function open(sessionId: string, opts: { since?: number; lastEventId?: number } = {}) {
  const abort = new AbortController();
  const q = opts.since === undefined ? "" : `&since=${opts.since}`;
  const headers: Record<string, string> = {};
  if (opts.lastEventId !== undefined) headers["last-event-id"] = String(opts.lastEventId);
  const req = new NextRequest(`http://localhost/api/events?session=${sessionId}${q}`, { headers, signal: abort.signal });
  return { abort, res: GET(req) };
}

describe("GET /api/events, STORE=supabase mode", () => {
  it("streams events published on another instance, after a bare id line with the resume point", async () => {
    const log = new FakeLog();
    const here = instance(log); // the instance holding the stream
    const there = instance(log); // the instance the dose tick was posted to
    const s = await getMemoryStore().createSession();
    there.publish(s.id, "clock.changed", "old event", {});
    await there.flush();

    await withProcessBus(here, async () => {
      const { abort, res } = open(s.id, { since: 0 });
      const r = await res;
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/event-stream");
      const reader = r.body!.getReader();
      const first = await readUntil(reader, /id: 1\n\n/);
      expect(first).toContain("retry: 1000");
      expect(dataOf(first)).toEqual([]); // since=0: start at the newest id, no replay of the old event
      expect(here.listenerCount(s.id)).toBe(1);

      const t0 = Date.now();
      there.publish(s.id, "dose.logged", "陈先生勾了「吃了」", { state: "taken" });
      there.publish("other-session", "dose.logged", "not mine", {});
      const text = await readUntil(reader, "id: 2\ndata: ");
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(dataOf(text)).toEqual([expect.objectContaining({ id: 2, session_id: s.id, say: "陈先生勾了「吃了」", data: { state: "taken" } })]);

      abort.abort();
      await until(() => here.listenerCount(s.id) === 0);
    });
  });

  it("resumes exactly after Last-Event-ID, and ?since=<n> replays after n", async () => {
    const log = new FakeLog();
    const here = instance(log);
    const s = await getMemoryStore().createSession();
    for (const say of ["e1", "e2", "e3"]) here.publish(s.id, "clock.changed", say, {});
    await here.flush();

    await withProcessBus(here, async () => {
      const resumed = open(s.id, { since: 0, lastEventId: 1 }); // the header wins over ?since
      const reader = (await resumed.res).body!.getReader();
      const text = await readUntil(reader, "id: 3\ndata: ");
      expect(dataOf(text).map((e) => e.say)).toEqual(["e2", "e3"]);
      expect(text.indexOf("id: 1\n\n")).toBeGreaterThanOrEqual(0);
      resumed.abort.abort();

      const since = open(s.id, { since: 2 });
      const reader2 = (await since.res).body!.getReader();
      expect(dataOf(await readUntil(reader2, "id: 3\ndata: ")).map((e) => e.say)).toEqual(["e3"]);
      since.abort.abort();
    });
  });

  it("a stream that ends (function timeout) loses nothing: the browser comes back with Last-Event-ID", async () => {
    vi.stubEnv("BUS_STREAM_MAX_MS", "250");
    const log = new FakeLog();
    const here = instance(log);
    const there = instance(log);
    const s = await getMemoryStore().createSession();

    await withProcessBus(here, async () => {
      const seen: BusEvent[] = [];
      let lastId: number | undefined;
      let published = 0;
      // the page's first connection is open (resume point known) before anything is published
      let conn = open(s.id, { since: 0 });
      let reader = (await conn.res).body!.getReader();
      let pending = await readUntil(reader, "id: 0\n\n");
      const publisher = (async () => {
        for (let i = 0; i < 12; i++) {
          there.publish(s.id, "dose.logged", `tick ${i}`, { i });
          published++;
          await sleep(60);
        }
        await there.flush();
      })();
      let reconnects = 0;
      while (seen.length < 12) {
        if (reconnects > 0) {
          conn = open(s.id, lastId === undefined ? { since: 0 } : { lastEventId: lastId });
          reader = (await conn.res).body!.getReader();
          pending = "";
        }
        const got = await readFor(reader, 2000);
        const text = pending + got.text;
        const ended = got.ended;
        for (const line of text.split("\n")) {
          const m = /^id: (\d+)$/.exec(line);
          if (m) lastId = Number(m[1]);
        }
        seen.push(...dataOf(text));
        if (!ended) conn.abort.abort();
        reconnects++;
        expect(reconnects).toBeLessThan(20);
        await sleep(30); // the reconnect gap; events published now must not be lost
      }
      await publisher;
      expect(published).toBe(12);
      expect(reconnects).toBeGreaterThan(1); // the stream really ended and came back
      expect(seen.map((e) => e.say)).toEqual(Array.from({ length: 12 }, (_, i) => `tick ${i}`));
      expect(seen.map((e) => e.id)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });
  });

  it("fills a gap from the table before sending a newer event", async () => {
    const log = new FakeLog();
    const here = instance(log, 1000); // slow tail: the connection must not wait for it
    const s = await getMemoryStore().createSession();
    await withProcessBus(here, async () => {
      const conn = open(s.id, { lastEventId: 0 });
      const reader = (await conn.res).body!.getReader();
      await readUntil(reader, "id: 0\n\n");
      // three events land in the table at once; the tailer (and so the stream) must deliver all, in order
      for (const say of ["a", "b", "c"]) await log.append({ type: "clock.changed", session_id: s.id, at: new Date().toISOString(), say, data: null });
      const text = await readUntil(reader, "id: 3\ndata: ", 3000);
      expect(dataOf(text).map((e) => [e.id, e.say])).toEqual([
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]);
      conn.abort.abort();
    });
  });

  it("still answers 400 / 404 before touching the log", async () => {
    const log = new FakeLog();
    await withProcessBus(instance(log), async () => {
      expect((await GET(new NextRequest("http://localhost/api/events"))).status).toBe(400);
      expect((await GET(new NextRequest("http://localhost/api/events?session=missing"))).status).toBe(404);
      expect(log.reads).toBe(0);
    });
  });
});
