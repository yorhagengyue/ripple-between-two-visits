/**
 * The event stream ends itself (lib/guard/stream.ts, app/api/events/route.ts; track L; real-app 3.4 line 476): 5 minutes
 * by default with either store, the browser told to come straight back, and nothing lost or repeated across the
 * change. (The same for STORE=supabase is tests/unit/store/bus-remote.test.ts.)
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/events/route";
import { publish, type BusEvent } from "@/lib/bus";
import { DEFAULT_STREAM_MAX_MS, MAX_STREAM_MAX_MS, MIN_STREAM_MAX_MS, RENEW_FRAME, RENEW_RETRY_MS, streamMaxMs } from "@/lib/guard/stream";
import { getMemoryStore } from "@/lib/store/memory";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decoder = new TextDecoder();

afterEach(() => vi.unstubAllEnvs());

function open(sessionId: string, opts: { since?: number; lastEventId?: number } = {}) {
  const abort = new AbortController();
  const headers: Record<string, string> = {};
  if (opts.lastEventId !== undefined) headers["last-event-id"] = String(opts.lastEventId);
  const q = opts.since === undefined ? "" : `&since=${opts.since}`;
  return { abort, res: GET(new NextRequest(`http://localhost/api/events?session=${sessionId}${q}`, { headers, signal: abort.signal })) };
}

/** Everything a stream sends until it ends by itself (or `ms` pass: then `ended` is false). */
async function readAll(res: Response, ms: number): Promise<{ text: string; ended: boolean; tookMs: number }> {
  const reader = res.body!.getReader();
  const started = Date.now();
  let text = "";
  for (;;) {
    const left = started + ms - Date.now();
    if (left <= 0) return { text, ended: false, tookMs: Date.now() - started };
    const r = await Promise.race([reader.read(), sleep(left).then(() => null)]);
    if (r === null) continue;
    if (r.done) return { text, ended: true, tookMs: Date.now() - started };
    text += decoder.decode(r.value);
  }
}

const dataOf = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as BusEvent);
const lastId = (text: string) => Number([...text.matchAll(/^id: (\d+)$/gm)].at(-1)?.[1] ?? NaN);

describe("how long a stream lives", () => {
  it("5 minutes when BUS_STREAM_MAX_MS is not set, not a number, zero or negative: there is no 'no limit' any more", () => {
    expect(DEFAULT_STREAM_MAX_MS).toBe(300_000);
    for (const v of [undefined, "", " ", "abc", "0", "-5", "NaN"]) expect(streamMaxMs({ BUS_STREAM_MAX_MS: v }), String(v)).toBe(300_000);
  });

  it("the value set (hosting: 290000), kept between a tenth of a second and 15 minutes", () => {
    expect(streamMaxMs({ BUS_STREAM_MAX_MS: "290000" })).toBe(290_000);
    expect(streamMaxMs({ BUS_STREAM_MAX_MS: " 4000 " })).toBe(4000);
    expect(streamMaxMs({ BUS_STREAM_MAX_MS: "1" })).toBe(MIN_STREAM_MAX_MS);
    expect(streamMaxMs({ BUS_STREAM_MAX_MS: "86400000" })).toBe(MAX_STREAM_MAX_MS);
    expect(MAX_STREAM_MAX_MS).toBe(15 * 60_000);
  });

  it("the last frame of a stream that ends on time only shortens the browser's reconnect delay", () => {
    expect(RENEW_FRAME).toBe(`retry: ${RENEW_RETRY_MS}\n\n`);
    expect(RENEW_RETRY_MS).toBeLessThanOrEqual(250);
    expect(dataOf(RENEW_FRAME)).toEqual([]);
  });
});

describe("GET /api/events with the in-memory store", () => {
  it("ends by itself after BUS_STREAM_MAX_MS, the come-straight-back frame last", async () => {
    vi.stubEnv("BUS_STREAM_MAX_MS", "300");
    const s = await getMemoryStore().createSession();
    const { res } = open(s.id, { since: 0 });
    const r = await res;
    expect(r.status).toBe(200);
    const got = await readAll(r, 3000);
    expect(got.ended).toBe(true);
    expect(got.tookMs).toBeGreaterThanOrEqual(250);
    expect(got.tookMs).toBeLessThan(2000);
    expect(got.text.startsWith("retry: 1000\n: connected")).toBe(true);
    expect(got.text.endsWith(RENEW_FRAME)).toBe(true);
  });

  it("without the variable a stream is still open long after that (the default is minutes, not none and not seconds)", async () => {
    vi.stubEnv("BUS_STREAM_MAX_MS", "");
    const s = await getMemoryStore().createSession();
    const { res, abort } = open(s.id, { since: 0 });
    const got = await readAll(await res, 600);
    expect(got.ended).toBe(false);
    abort.abort();
  });

  it("a page that follows across the change loses nothing and sees nothing twice (Last-Event-ID)", async () => {
    vi.stubEnv("BUS_STREAM_MAX_MS", "250");
    const s = await getMemoryStore().createSession();
    const seen: BusEvent[] = [];
    let last: number | undefined;
    let connections = 0;
    let published = 0;
    const publisher = (async () => {
      for (let i = 0; i < 14; i++) {
        publish(s.id, "dose.logged", `tick ${i}`, { i });
        published++;
        await sleep(55);
      }
    })();
    const deadline = Date.now() + 8000;
    while (seen.length < 14 && Date.now() < deadline) {
      const { res } = open(s.id, last === undefined ? { since: 0 } : { lastEventId: last });
      connections++;
      const got = await readAll(await res, 2000);
      expect(got.ended).toBe(true);
      seen.push(...dataOf(got.text));
      const id = lastId(got.text);
      if (Number.isFinite(id)) last = id;
      await sleep(RENEW_RETRY_MS); // the browser's reconnect gap: what is published now must not be lost
    }
    await publisher;
    expect(published).toBe(14);
    expect(connections).toBeGreaterThan(2); // the stream really ended and came back, more than once
    expect(seen.map((e) => e.say)).toEqual(Array.from({ length: 14 }, (_, i) => `tick ${i}`));
    expect(new Set(seen.map((e) => e.id)).size).toBe(14);
  });
});
