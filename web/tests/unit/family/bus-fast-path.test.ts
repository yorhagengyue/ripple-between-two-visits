/**
 * lib/bus.ts, STORE=supabase, the local publish fast path (wave B, M6 "a switch reaches her within 1 s" on the
 * one-server deploy shape): an event published on this instance reaches this instance's listeners as soon as it is
 * stored, without waiting for the tailer's next read of the table. The table stays the source of truth: the id comes
 * from it, other instances still read the event there, an id gap is filled from the table first, and nothing is
 * delivered twice. Against an in-memory fake of the bus_event table with slow reads (so a poll cannot be what
 * delivered the event).
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as eventsGet } from "@/app/api/events/route";
import { Bus, type BusEvent, type BusLog } from "@/lib/bus";
import { getMemoryStore } from "@/lib/store/memory";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SlowLog implements BusLog {
  private events = new Map<string, BusEvent[]>();
  readDelayMs = 0;
  appendDelayMs = 0;
  failAppends = 0;
  reads = 0;
  async append(event: Omit<BusEvent, "id">): Promise<number> {
    if (this.appendDelayMs) await sleep(this.appendDelayMs);
    if (this.failAppends > 0) {
      this.failAppends--;
      throw new Error("Supabase publish event: HTTP 503");
    }
    const list = this.events.get(event.session_id) ?? [];
    const id = list.length + 1;
    list.push(structuredClone({ ...event, id }));
    this.events.set(event.session_id, list);
    return id;
  }
  async after(sessionId: string, afterId: number, limit: number): Promise<BusEvent[]> {
    this.reads++;
    const out = structuredClone((this.events.get(sessionId) ?? []).filter((e) => e.id > afterId).slice(0, limit));
    if (this.readDelayMs) await sleep(this.readDelayMs);
    return out;
  }
  async latest(sessionId: string, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).slice(-limit));
  }
  async head(sessionId: string): Promise<number> {
    return (this.events.get(sessionId) ?? []).length;
  }
  async clear(): Promise<void> {}
}

const buses: Bus[] = [];
function instance(log: BusLog, pollMs: number): Bus {
  const b = new Bus({ log, pollMs, lingerMs: 50 });
  buses.push(b);
  return b;
}
afterEach(() => {
  for (const b of buses.splice(0)) b.close();
  vi.restoreAllMocks();
});

async function until(check: () => boolean, ms: number): Promise<number> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`not within ${ms} ms`);
    await sleep(2);
  }
  return Date.now() - t0;
}

describe("bus, STORE=supabase: local publish fast path", () => {
  it("a local listener gets the event once it is stored, long before the next read of the table would bring it, and only once", async () => {
    const log = new SlowLog();
    const bus = instance(log, 60_000); // no poll during the test
    const got: BusEvent[] = [];
    bus.subscribe("s1", (e) => got.push(e));
    await sleep(20); // the tailer has read the head
    log.readDelayMs = 800; // any read of the table from now on is slow
    const ms = await (async () => {
      bus.publish("s1", "family_grant.changed", "switch", { grant: { items: { notes: true } } });
      return until(() => got.length === 1, 400);
    })();
    expect(ms).toBeLessThan(400);
    expect(got[0]).toMatchObject({ id: 1, type: "family_grant.changed", session_id: "s1", data: { grant: { items: { notes: true } } } });
    // the slow read that was under way returns the same event: it is not delivered again
    await sleep(900);
    expect(got.map((e) => e.id)).toEqual([1]);
    // it is in this instance's copy of the tail too (recent() for a page rendered here)
    expect(bus.recent("s1").map((e) => e.id)).toEqual([1]);
  });

  it("delivers what was stored, not the caller's object changed afterwards", async () => {
    const log = new SlowLog();
    const bus = instance(log, 60_000);
    const got: BusEvent[] = [];
    bus.subscribe("s1", (e) => got.push(e));
    await sleep(20);
    const data = { note: { text: "原话" } };
    bus.publish("s1", "note.logged", "note", data);
    data.note.text = "changed later";
    await until(() => got.length === 1, 400);
    expect(got[0].data).toEqual({ note: { text: "原话" } });
  });

  it("an id gap left by another instance is filled from the table first: in order, no duplicates", async () => {
    const log = new SlowLog();
    const here = instance(log, 60_000);
    const there = instance(log, 60_000);
    const got: number[] = [];
    here.subscribe("s1", (e) => got.push(e.id));
    await sleep(20);
    there.publish("s1", "dose.logged", "from the other instance", {}); // id 1, not read here yet (no poll)
    await there.flush();
    here.publish("s1", "family_grant.changed", "local", {}); // id 2: a gap at 1, so the table is read
    await until(() => got.length === 2, 1000);
    await sleep(50);
    expect(got).toEqual([1, 2]);
  });

  it("a failed write delivers nothing; the next event still goes through", async () => {
    const log = new SlowLog();
    const bus = instance(log, 60_000);
    const got: number[] = [];
    bus.subscribe("s1", (e) => got.push(e.id));
    await sleep(20);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    log.failAppends = 1;
    bus.publish("s1", "bp.logged", "lost", {});
    bus.publish("s1", "bp.logged", "kept", {});
    await until(() => got.length === 1, 400);
    await sleep(30);
    expect(got).toEqual([1]);
  });

  it("an instance with no listener for the session delivers nothing and starts no tail", async () => {
    const log = new SlowLog();
    const bus = instance(log, 60_000);
    bus.publish("s9", "clock.changed", "x", {});
    await bus.flush();
    expect(bus.listenerCount("s9")).toBe(0);
    expect(log.reads).toBe(0);
  });

  it("through GET /api/events on one instance: his switch reaches her stream without waiting for a poll", async () => {
    const log = new SlowLog();
    const bus = instance(log, 60_000);
    const g = globalThis as { __rippleBus?: Bus };
    const before = g.__rippleBus;
    g.__rippleBus = bus;
    const abort = new AbortController();
    try {
      const s = await getMemoryStore().createSession({ story_day: 29, ttl_hours: 1 });
      const member = await getMemoryStore().addMember(s.id, { role: "family" });
      const res = await eventsGet(
        new NextRequest(`http://localhost/api/events?session=${s.id}`, { headers: { cookie: `rp_session=${s.id}; rp_member=${member.id}; rp_role=family` }, signal: abort.signal }),
      );
      let text = "";
      const reader = res.body!.getReader();
      void (async () => {
        for (;;) {
          const r = await reader.read();
          if (r.done) return;
          text += new TextDecoder().decode(r.value);
        }
      })().catch(() => {});
      await until(() => text.includes("id: 0"), 1000);
      await sleep(20);
      log.readDelayMs = 2000;
      bus.publish(s.id, "family_grant.changed", "He let Wei Ling see his notes", {
        grant: { session_id: s.id, member: "wei-ling", items: { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: true }, created_at: "x", updated_at: "y" },
        changed: { notes: true },
      });
      const ms = await until(() => text.includes('"family_grant.changed"'), 500);
      expect(ms).toBeLessThan(500);
      expect(text).toContain('"notes":true');
      expect(text).not.toContain("He let Wei Ling"); // her filter still applies: no `say`
    } finally {
      abort.abort();
      g.__rippleBus = before;
    }
  });
});
