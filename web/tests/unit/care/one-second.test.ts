/**
 * 「她那边 1 秒内跟着变」 on a database that is a round trip away (C2 track D, the fix round of 10-11; real-app 2.22, 3.10
 * 撤回). The first run of the journeys on the hosted database took 1.7 s from his 「停止分享给她」 to her screen and 4 s
 * from a switch to her week; every test before that ran on the memory store, where a call costs nothing.
 *
 * Here the process-wide store is the memory store with every call 80 ms later (tests/support/slow-store.ts), and the
 * bus runs its shared-log mode (the one the hosted store uses) over a log in memory that is just as slow. Real routes,
 * real time. What is measured, from the moment his request starts:
 *
 *   a switch off     her stream's frame (what her page hides on) and the calls his request made before it published
 *   a switch on      the copy of her home her stream pushes (her page shows the section from it, without asking)
 *   the stop         her stream's closing frame
 *
 * Each has two kinds of assertion: the time (under a second at 80 ms a call, with a wide margin at 5 ms), and the
 * store calls on the way, by name and by how many deep they are. The second kind is the one that cannot drift: the
 * code this replaced made 8 calls before publishing (now 4 for a switch, 3 for the stop), stored the event before
 * delivering it, and read her link twice before sending her anything; her page then asked for her home, 23 calls and
 * 10 deep (now pushed by her stream: 1 deep). On that code ten of the twelve cases here fail: every count, and the
 * switch-on case outright (measured there at 80 ms a call: 883 ms to her frame for a switch, 888 ms for the stop).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET as eventsGet } from "@/app/api/events/route";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as grantsPost } from "@/app/api/family/links/[id]/grants/route";
import { POST as revokePost } from "@/app/api/family/links/[id]/revoke/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { Bus, type BusLog } from "@/lib/bus";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { getMemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems } from "@/lib/store/types";
import { installSlowStore, MemoryEventLog, rounds, slowLog, wait, type SlowStore, type StoreCall } from "../../support/slow-store";

const decoder = new TextDecoder();
const PASSWORD = "a long test password";
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "example" | "none", display: string): Promise<TestAccount> => createAccountWithSpace(getMemoryStore(), getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: PASSWORD, space, display_name: display });
const t = (a: TestAccount) => a.tokens.access_token;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function req(p: string, opts: { token?: string; body?: unknown; signal?: AbortSignal } = {}): NextRequest {
  const headers: Record<string, string> = opts.token ? { cookie: `rp_at=${opts.token}` } : {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
}

/** He invites, she accepts, he confirms: through the real routes, on the plain store (before it is made slow). */
async function linked(him: TestAccount, her: TestAccount): Promise<string> {
  const res = await invitePost(req("/api/family/invites", { token: t(him), body: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } }));
  const body = (await res.json()) as { link: { id: string }; path: string };
  expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: body.path.replace(/^\/invite\//, "") } }))).status).toBe(200);
  expect((await confirmPost(req(`/api/family/links/${body.link.id}/confirm`, { token: t(him), body: { yes: true } }), params(body.link.id))).status).toBe(200);
  return body.link.id;
}
const setSwitches = (him: TestAccount, id: string, items: Partial<FamilyGrantItems>) => grantsPost(req(`/api/family/links/${id}/grants`, { token: t(him), body: { items } }), params(id));

// ------------------------------------------------------------------ the slow world

type G = typeof globalThis & { __rippleBus?: Bus };
let slow: SlowStore | null = null;
const buses: Bus[] = [];
let busBefore: Bus | undefined;
let swapped = false;

afterEach(() => {
  slow?.restore();
  slow = null;
  for (const b of buses.splice(0)) b.close();
  if (swapped) (globalThis as G).__rippleBus = busBefore;
  swapped = false;
});

function installBus(bus: Bus): Bus {
  const g = globalThis as G;
  if (!swapped) busBefore = g.__rippleBus;
  swapped = true;
  g.__rippleBus = bus;
  if (!buses.includes(bus)) buses.push(bus);
  return bus;
}

/** A bus in the hosted store's mode: events stored in a shared log `delay` away, read back every 300 ms (BUS_POLL_MS). */
const sharedBus = (log: BusLog, delay: number) => new Bus({ log: slowLog(log, delay), pollMs: 300, lingerMs: 50 });

/** When this bus was asked to publish, by event type (the moment his request has done what must come first). */
function publishTimes(bus: Bus): Map<string, number> {
  const times = new Map<string, number>();
  const publish = bus.publish.bind(bus);
  bus.publish = ((scope: string, type: Parameters<Bus["publish"]>[1], say: string, data: unknown) => {
    if (!times.has(type)) times.set(type, performance.now());
    return publish(scope, type, say, data);
  }) as Bus["publish"];
  return times;
}

// ------------------------------------------------------------------ her stream, as her browser reads it

interface Frame {
  /** the SSE event name ("message" when none) */
  event: string;
  data: Record<string, unknown>;
  /** performance.now() when the chunk that completed it was read */
  at: number;
}

function herStream(her: TestAccount, linkId: string) {
  const abort = new AbortController();
  const opened = eventsGet(req(`/api/events?link=${linkId}&since=0&view=1`, { token: t(her), signal: abort.signal }));
  const frames: Frame[] = [];
  let raw = "";
  let done = false;
  const waiting: { wake: (() => void) | null } = { wake: null };
  const pumping = (async () => {
    const res = await opened;
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let buffer = "";
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      const at = performance.now();
      const chunk = decoder.decode(r.value);
      raw += chunk;
      buffer += chunk;
      for (;;) {
        const cut = buffer.indexOf("\n\n");
        if (cut < 0) break;
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const lines = block.split("\n");
        const data = lines.find((l) => l.startsWith("data: "));
        if (!data) continue;
        frames.push({ event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message", data: JSON.parse(data.slice(6)) as Record<string, unknown>, at });
      }
      waiting.wake?.();
    }
    done = true;
    waiting.wake?.();
  })();
  /** The first frame from index `from` on that matches, waiting up to `maxMs`. */
  async function next(match: (f: Frame) => boolean, from = 0, maxMs = 6000): Promise<Frame> {
    const until = performance.now() + maxMs;
    for (;;) {
      const hit = frames.slice(from).find(match);
      if (hit) return hit;
      if (done || performance.now() > until) throw new Error(`her stream had no such frame; it got: ${frames.map((f) => `${f.event}:${String(f.data.type ?? "")}`).join(", ") || "nothing"}`);
      await Promise.race([new Promise<void>((resolve) => (waiting.wake = resolve)), wait(20)]);
    }
  }
  /** The stream is open: its first lines are in. */
  async function connected(maxMs = 6000): Promise<void> {
    const until = performance.now() + maxMs;
    while (!raw.includes(": connected")) {
      if (done || performance.now() > until) throw new Error("her stream did not open");
      await Promise.race([new Promise<void>((resolve) => (waiting.wake = resolve)), wait(20)]);
    }
  }
  return {
    frames,
    next,
    connected,
    raw: () => raw,
    ended: () => done,
    close: async () => {
      abort.abort();
      await pumping.catch(() => {});
    },
  };
}

const isSwitches = (f: Frame) => f.event === "message" && f.data.type === "family_grant.changed";
const switchesIn = (f: Frame) => (f.data.data as { grant: { items: FamilyGrantItems; version: number } }).grant;
const isView = (f: Frame) => f.event === "view";
const isClose = (f: Frame) => f.event === "message" && f.data.type === "care_link.revoked";
const names = (calls: readonly StoreCall[]) => calls.map((c) => c.name);
/** ONE_SECOND_PRINT=1 prints each measured time (the numbers in web/progress/d.md come from here). */
const note = (what: string, ms: number) => {
  if (process.env.ONE_SECOND_PRINT) console.log(`[one-second] ${what}: ${Math.round(ms)} ms`);
};

interface World {
  him: TestAccount;
  her: TestAccount;
  id: string;
  bus: Bus;
  slow: SlowStore;
  published: Map<string, number>;
  stream: ReturnType<typeof herStream>;
}

/**
 * Two accounts, linked, his switches as given; then the store and the bus become `delay` away and her page's stream is
 * opened (and has settled: its first frame is in, and the bus is following his channel).
 */
async function world(delay: number, mode: "shared log" | "in process", switches: Partial<FamilyGrantItems>): Promise<World> {
  const him = await account("example", "陈先生");
  const her = await account("none", "Wei Ling");
  const id = await linked(him, her);
  if (Object.keys(switches).length) expect((await setSwitches(him, id, switches)).status).toBe(200);
  const bus = installBus(mode === "shared log" ? sharedBus(new MemoryEventLog(), delay) : new Bus());
  const published = publishTimes(bus);
  slow = installSlowStore(delay);
  const stream = herStream(her, id);
  await stream.connected();
  await wait(delay * 4 + 150); // her switches are read, the bus has read his channel's head and its first page
  return { him, her, id, bus, slow, published, stream };
}

const CASES: { delay: number; mode: "shared log" | "in process"; underMs: number }[] = [
  // the hosted database as it was on the first real run, and as it is deployed (the same region)
  { delay: 80, mode: "shared log", underMs: 1000 },
  { delay: 5, mode: "shared log", underMs: 300 },
  // one always-on server with the memory store's bus (the offline gate's mode), made slow all the same
  { delay: 80, mode: "in process", underMs: 1000 },
];

for (const { delay, mode, underMs } of CASES) {
  describe(`a store ${delay} ms away, ${mode === "shared log" ? "events through the shared log" : "events in process"}`, () => {
    it("he switches 「每天吃药了没有」 off: her stream says so after four calls of his request, before anything else", async () => {
      const w = await world(delay, mode, { dose_summary: true, bp_summary: true });
      const before = w.stream.frames.length;
      w.slow.reset();
      const t0 = performance.now();
      const answered = setSwitches(w.him, w.id, { dose_summary: false }).then((r) => ({ status: r.status, at: performance.now() }));
      const frame = await w.stream.next(isSwitches, before);
      const lag = frame.at - t0;

      // what her page hides on: his switches for her link, with which change of them this is
      expect(switchesIn(frame).items).toMatchObject({ dose_summary: false, bp_summary: true });
      note(`${delay} ms, ${mode}: switch off -> her frame`, lag);
      expect(lag).toBeLessThan(underMs);

      // his request, up to the event: who he is (2), his link (1), the write (1). Nothing else is in front of her.
      const publishedAt = w.published.get("family_grant.changed")!;
      const first = w.slow.calls.filter((c) => c.start < publishedAt);
      expect(names(first)).toEqual(["getAccount", "getSession", "listCareLinks", "setFamilyGrant"]);
      expect(rounds(first)).toBe(4);
      // and her frame left with the publish: not after the event was stored, not after a re-read of her link
      expect(frame.at - publishedAt).toBeLessThan(delay / 2 + 25);
      expect(names(w.slow.calls.filter((c) => c.start < frame.at))).not.toContain("getCareLink");

      // the rest of his request follows: the consent record (three more calls), then his answer
      const his = await answered;
      expect(his.status).toBe(200);
      expect(his.at).toBeGreaterThan(frame.at);
      note(`${delay} ms, ${mode}: switch off -> his own answer`, his.at - t0);
      const mine = names(w.slow.calls.filter((c) => c.start < his.at));
      for (const n of ["listConsentRecords", "putConsentText", "addConsentRecord"]) expect(mine).toContain(n);

      // then the nice refresh: her home as it is now, pushed (no request of hers), with nothing of the section left
      const view = await w.stream.next(isView, before);
      const home = view.data as unknown as FamilyHomeData;
      expect(view.at).toBeGreaterThan(frame.at);
      expect(home.grants.dose_summary).toBe(false);
      expect(home.grantsVersion).toBe(switchesIn(frame).version);
      expect(home.week).toBeNull();
      expect(home.status).toBeNull();
      expect(home.timeline).toEqual([]);
      expect(home.bp).not.toBeNull();
      // the stored copy of the event reaches the stream too (shared log): it is not sent a second time
      await wait(delay * 2 + 400);
      expect(w.stream.frames.slice(before).filter(isSwitches)).toHaveLength(1);
      await w.stream.close();
    }, 20_000);

    it("he switches it on: her home with the week is pushed to her, five calls deep from his tap", async () => {
      const w = await world(delay, mode, {});
      const before = w.stream.frames.length;
      w.slow.reset();
      const t0 = performance.now();
      const answered = setSwitches(w.him, w.id, { dose_summary: true });
      const view = await w.stream.next((f) => isView(f) && (f.data as unknown as FamilyHomeData).week !== null, before);
      const lag = view.at - t0;
      const home = view.data as unknown as FamilyHomeData;
      expect(home.week?.days).toHaveLength(7);
      expect(home.status).not.toBeNull();
      note(`${delay} ms, ${mode}: switch on -> her home with the week`, lag);
      expect(lag).toBeLessThan(underMs);

      // four calls of his request, then ONE round on her stream: every section built from what the stream holds, the
      // three reads that check it (his scope, her link, her switches), and her access-log row, all together
      const onTheWay = w.slow.calls.filter((c) => c.start < view.at && !["listConsentRecords", "putConsentText", "addConsentRecord"].includes(c.name));
      expect(rounds(onTheWay)).toBe(5);
      const pushed = names(onTheWay.slice(4));
      for (const n of ["getSession", "listCareLinks", "getFamilyGrant", "listMeds", "listDoses", "addCareAccessLog"]) expect(pushed).toContain(n);
      expect(names(onTheWay).filter((n) => n === "listMeds")).toHaveLength(1); // the week is counted from the rows already read
      expect(names(onTheWay).filter((n) => n === "listDoses")).toHaveLength(1);
      expect(names(onTheWay)).toContain("addCareAccessLog"); // no copy of his day leaves without her look being logged
      expect((await answered).status).toBe(200);
      await w.stream.close();
    }, 20_000);

    it("he stops sharing: her stream closes after three calls of his request", async () => {
      const w = await world(delay, mode, { dose_summary: true, bp_summary: true, questions_count: true });
      const before = w.stream.frames.length;
      w.slow.reset();
      const t0 = performance.now();
      const answered = revokePost(req(`/api/family/links/${w.id}/revoke`, { token: t(w.him), body: {} }), params(w.id)).then((r) => ({ status: r.status, at: performance.now() }));
      const frame = await w.stream.next(isClose, before);
      const lag = frame.at - t0;
      expect(frame.data.data).toEqual({ link: { id: w.id, status: "revoked", by: "patient" } });
      note(`${delay} ms, ${mode}: stop -> her closing frame`, lag);
      expect(lag).toBeLessThan(underMs);

      // who he is (2) and the store's own revoke, which refuses a link that is not his: nothing is read first
      const publishedAt = w.published.get("care_link.revoked")!;
      const first = w.slow.calls.filter((c) => c.start < publishedAt);
      expect(names(first)).toEqual(["getAccount", "getSession", "revokeLink"]);
      expect(rounds(first)).toBe(3);
      expect(frame.at - publishedAt).toBeLessThan(delay / 2 + 25);

      // his consent is withdrawn after that, and the whole request is six calls
      const his = await answered;
      expect(his.status).toBe(200);
      expect(names(w.slow.calls.filter((c) => c.start < his.at))).toEqual(["getAccount", "getSession", "revokeLink", "listConsentRecords", "putConsentText", "addConsentRecord"]);

      // her stream is over, nothing of his came after the closing frame, and her next read is refused
      await wait(delay * 2 + 100);
      expect(w.stream.ended()).toBe(true);
      expect(w.stream.frames.slice(before)).toHaveLength(1);
      const again = await viewGet(req(`/api/family/view?link=${w.id}`, { token: t(w.her) }));
      expect(again.status).toBe(403);
      await w.stream.close();
    }, 20_000);
  });
}

describe("her home, read by her page (GET /api/family/view)", () => {
  it("is five rounds of calls with three sections on (it was ten): who she is, then her switches and the looks, then everything", async () => {
    const him = await account("example", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    await setSwitches(him, id, { dose_summary: true, bp_summary: true, no_reply_alert: true });
    slow = installSlowStore(20);
    const res = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
    expect(res.status).toBe(200);
    const home = (await res.json()) as FamilyHomeData;
    expect(home.week?.days).toHaveLength(7);
    expect(home.bp).not.toBeNull();
    expect(home.grantsVersion).toBeGreaterThan(1);
    const calls = slow.calls;
    note(`her home read by her page: ${calls.length} calls, ${rounds(calls)} rounds`, calls.at(-1)!.end - calls[0].start);
    // getAccount, getCareLink, getSession (lib/subject, one after another), then two rounds
    expect(names(calls).slice(0, 3)).toEqual(["getAccount", "getCareLink", "getSession"]);
    expect(rounds(calls)).toBe(5);
    expect(names(calls).filter((n) => n === "listMeds")).toHaveLength(1);
    expect(names(calls).filter((n) => n === "listDoses")).toHaveLength(1);
    // with the questions on, their recorded answers are one more round
    slow.restore();
    await setSwitches(him, id, { questions_count: true });
    slow = installSlowStore(20);
    const more = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
    expect(((await more.json()) as FamilyHomeData).questions).not.toBeNull();
    expect(rounds(slow.calls)).toBeLessThanOrEqual(6);
  }, 20_000);
});

describe("two server instances", () => {
  /** His request is answered by one instance, her stream is held by the other; they share the store and the event log. */
  async function twoInstances(delay: number) {
    const him = await account("example", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    expect((await setSwitches(him, id, { dose_summary: true })).status).toBe(200);
    const log = new MemoryEventLog();
    const hers = installBus(sharedBus(log, delay));
    slow = installSlowStore(delay);
    const stream = herStream(her, id);
    await stream.connected();
    await wait(delay * 4 + 150);
    // from here on this process is "the other instance": its publishes are not heard by her stream's bus directly
    const his = installBus(sharedBus(log, delay));
    expect(his).not.toBe(hers);
    return { him, her, id, stream };
  }

  it("5 ms away: her stream follows his switch and his stop through the shared log, within the poll (300 ms) and a few calls", async () => {
    const w = await twoInstances(5);
    let before = w.stream.frames.length;
    let t0 = performance.now();
    expect((await setSwitches(w.him, w.id, { dose_summary: false })).status).toBe(200);
    const off = await w.stream.next(isSwitches, before);
    expect(switchesIn(off).items.dose_summary).toBe(false);
    note("5 ms, two instances: switch off -> her frame", off.at - t0);
    expect(off.at - t0).toBeLessThan(500);

    before = w.stream.frames.length;
    t0 = performance.now();
    expect((await revokePost(req(`/api/family/links/${w.id}/revoke`, { token: t(w.him), body: {} }), params(w.id))).status).toBe(200);
    const close = await w.stream.next(isClose, before);
    note("5 ms, two instances: stop -> her closing frame", close.at - t0);
    expect(close.at - t0).toBeLessThan(500);
    await w.stream.close();
  }, 20_000);

  it("80 ms away: still inside the second (three calls, the event's write, one poll, one read)", async () => {
    const w = await twoInstances(80);
    const before = w.stream.frames.length;
    const t0 = performance.now();
    const answered = revokePost(req(`/api/family/links/${w.id}/revoke`, { token: t(w.him), body: {} }), params(w.id));
    const close = await w.stream.next(isClose, before);
    note("80 ms, two instances: stop -> her closing frame", close.at - t0);
    expect(close.at - t0).toBeLessThan(1000);
    expect((await answered).status).toBe(200);
    await w.stream.close();
  }, 20_000);
});
