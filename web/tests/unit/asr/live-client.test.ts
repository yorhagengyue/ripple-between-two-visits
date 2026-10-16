/**
 * M14 browser side of live captions (LiveWhisperClient) against a fake /api/asr/chunk: chunks grow the
 * caption, the line's final brings the stored utterance, finals are retried and never dropped, chunks of a
 * finished line are dropped, and a fallback answer stops everything and hands over to the replay.
 */
import { describe, expect, it } from "vitest";
import { LiveWhisperClient, type LiveCaption, type LiveFinal } from "@/lib/asr/live-client";
import { parseWav } from "@/lib/visit/wav";

const SR = 16_000;
function voice(ms: number, amp = 0.2): Float32Array {
  const out = new Float32Array(Math.round((ms * SR) / 1000));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = amp * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 180 * t);
  }
  return out;
}
const quiet = (ms: number) => new Float32Array(Math.round((ms * SR) / 1000)).fill(0.0005);

interface Seen {
  url: URL;
  bytes: number;
}

type Answer = (q: URLSearchParams, n: number) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

function server(answer: Answer) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://app.test");
    const body = init?.body as ArrayBuffer;
    seen.push({ url, bytes: body.byteLength });
    // every request carries a real 16 kHz mono 16-bit WAV
    const info = parseWav(new Uint8Array(body));
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(new Headers(init?.headers).get("content-type")).toBe("audio/wav");
    const a = await answer(url.searchParams, seen.length);
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

function client(fetchImpl: typeof fetch, extra: { delayMs?: number; finalBudgetMs?: number; now?: () => number; sessionId?: string | null } = {}) {
  const captions: LiveCaption[] = [];
  const finals: LiveFinal[] = [];
  const drops: string[] = [];
  const fallbacks: [string, string | null][] = [];
  const delays: boolean[] = [];
  const lost: string[] = [];
  const c = new LiveWhisperClient({
    sessionId: "s1",
    visitId: "v1",
    tuning: {},
    fetch: fetchImpl,
    base: "http://app.test",
    onCaption: (x) => captions.push(x),
    onDrop: (id) => drops.push(id),
    onFinal: (f) => finals.push(f),
    onFallback: (r, replay) => fallbacks.push([r, replay]),
    onDelay: (on) => delays.push(on),
    onLineLost: (id) => lost.push(id),
    ...extra,
  });
  return { c, captions, finals, drops, fallbacks, delays, lost };
}

function feed(c: LiveWhisperClient, audio: Float32Array) {
  for (let i = 0; i < audio.length; i += 128) c.feed(audio.slice(i, i + 128), SR);
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("LiveWhisperClient", () => {
  it("posts chunks then the line's final; captions grow; the final carries the stored utterance", async () => {
    const { seen, fetchImpl } = server((q) =>
      q.get("kind") === "chunk"
        ? { status: 200, body: { kind: "chunk", line: q.get("line"), text: `part ${q.get("seq")}`, lang: "en" } }
        : { status: 200, body: { kind: "final", line: q.get("line"), utterances: [{ id: q.get("line"), text: "the whole line", t_start_ms: 300, t_end_ms: 3800 }], view: { v: 1 } } },
    );
    const { c, captions, finals } = client(fetchImpl);
    feed(c, quiet(500));
    feed(c, voice(1600));
    feed(c, quiet(300));
    feed(c, voice(1500));
    feed(c, quiet(900));
    await settle();
    await c.stop(1000);
    const kinds = seen.map((s) => s.url.searchParams.get("kind"));
    expect(kinds.filter((k) => k === "final")).toHaveLength(1);
    expect(kinds.filter((k) => k === "chunk").length).toBeGreaterThanOrEqual(1);
    const q = seen[0].url.searchParams;
    expect(q.get("session")).toBe("s1");
    expect(q.get("visit_id")).toBe("v1");
    expect(q.get("line")).toMatch(/^v1-w[a-z0-9]+-1$/);
    expect(Number(q.get("offset_ms"))).toBeGreaterThan(0);
    expect(captions.length).toBeGreaterThanOrEqual(1);
    expect(captions[0].id).toBe(q.get("line"));
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ line: q.get("line"), view: { v: 1 } });
    // the trace for the e2e: the line's recording-time span and when its final arrived
    const t = c.trace.lines[q.get("line")!];
    expect(t.speechEndMs).toBeGreaterThan(3800);
    expect(t.finalAt).toBeGreaterThanOrEqual(t.closedAt!);
    expect(t.finalText).toBe("the whole line");
    expect(c.trace.t0Wall).not.toBeNull();
  });

  it("on an account's page (no session id) the query names no session: his sign-in names the scope (C2)", async () => {
    const { seen, fetchImpl } = server((q) =>
      q.get("kind") === "chunk"
        ? { status: 200, body: { kind: "chunk", line: q.get("line"), text: "part", lang: "en" } }
        : { status: 200, body: { kind: "final", line: q.get("line"), utterances: [{ id: q.get("line"), text: "the line", t_start_ms: 300, t_end_ms: 1800 }], view: null } },
    );
    const { c, finals } = client(fetchImpl, { sessionId: null });
    feed(c, quiet(400));
    feed(c, voice(1400));
    feed(c, quiet(900));
    await settle();
    await c.stop(1000);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const s of seen) {
      expect(s.url.searchParams.has("session")).toBe(false);
      expect(s.url.searchParams.get("visit_id")).toBe("v1");
    }
    expect(finals).toHaveLength(1);
  });

  it("an empty final drops the caption (silence or a filtered hallucination)", async () => {
    const { fetchImpl } = server((q) => ({ status: 200, body: q.get("kind") === "chunk" ? { text: "", lang: null } : { utterances: [], view: null } }));
    const { c, drops, finals } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(1200));
    feed(c, quiet(800));
    await settle();
    await c.stop(1000);
    expect(finals).toEqual([]);
    expect(drops).toHaveLength(1);
  });

  it("retries a final on 429 / 503 without fallback; never retries a 400", async () => {
    let finalsSeen = 0;
    const { fetchImpl } = server((q) => {
      if (q.get("kind") === "chunk") return { status: 429, body: { error: "busy" } };
      finalsSeen += 1;
      return finalsSeen < 3 ? { status: 503, body: { error: "asr_unavailable", fallback: false } } : { status: 200, body: { utterances: [{ id: "x", text: "ok" }], view: null } };
    });
    const { c, finals, fallbacks } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(1200));
    feed(c, quiet(800));
    await new Promise((r) => setTimeout(r, 2000));
    expect(finalsSeen).toBe(3);
    expect(finals).toHaveLength(1);
    expect(fallbacks).toEqual([]);
    await c.stop(100);
  });

  it("a fallback answer stops sending and hands over to the replay", async () => {
    const { seen, fetchImpl } = server(() => ({ status: 503, body: { error: "asr_unavailable", reason: "unreachable", fallback: true, replay: "v1" } }));
    const { c, fallbacks } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(1600));
    feed(c, quiet(300));
    await settle();
    expect(fallbacks).toEqual([["unreachable", "v1"]]);
    expect(c.active).toBe(false);
    const n = seen.length;
    feed(c, voice(2000));
    feed(c, quiet(800));
    await settle();
    expect(seen.length).toBe(n);
    expect(c.trace.fallback?.reason).toBe("unreachable");
  });

  it("409 asr_fallback_active (another device already switched) also hands over", async () => {
    const { fetchImpl } = server(() => ({ status: 409, body: { error: "asr_fallback_active", reason: "timeout", fallback: true, replay: null } }));
    const { c, fallbacks } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(1600));
    feed(c, quiet(300));
    await settle();
    expect(fallbacks).toEqual([["timeout", null]]);
  });

  it("stop() flushes the line in progress and waits for its final", async () => {
    const { seen, fetchImpl } = server(async (q) => {
      await new Promise((r) => setTimeout(r, 100));
      return { status: 200, body: q.get("kind") === "chunk" ? { text: "x", lang: "en" } : { utterances: [{ id: q.get("line"), text: "done" }], view: null } };
    });
    const { c, finals } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(1500));
    await c.stop(2000);
    expect(seen.map((s) => s.url.searchParams.get("kind"))).toContain("final");
    expect(finals).toHaveLength(1);
    // after stop nothing more leaves
    const n = seen.length;
    feed(c, voice(2000));
    feed(c, quiet(900));
    await settle();
    expect(seen.length).toBe(n);
  });

  it("busy: chunks are held back for retry_after_ms, the final is retried with backoff; captions late, then on time", async () => {
    let busy = true;
    const { seen, fetchImpl } = server((q) => {
      if (busy) return { status: 429, body: { error: "busy", retry_after_ms: 300 } };
      return { status: 200, body: q.get("kind") === "chunk" ? { text: "x", lang: "en" } : { utterances: [{ id: q.get("line"), text: "ok" }], view: null } };
    });
    const { c, finals, delays, lost } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(4000)); // a long line: several chunks
    await settle();
    const sentWhileBusy = seen.length;
    feed(c, voice(2000)); // more chunks arrive during the busy spell: not sent
    await settle();
    expect(seen.length).toBe(sentWhileBusy);
    expect(delays).toEqual([true]);
    busy = false;
    feed(c, quiet(900)); // the line ends: its final is sent even inside the busy window and retried after it
    await new Promise((r) => setTimeout(r, 1500));
    expect(finals).toHaveLength(1);
    expect(lost).toEqual([]);
    expect(delays).toEqual([true, false]);
    await c.stop(100);
  });

  it("a final that keeps failing is given up after its budget and reported lost (never silently)", async () => {
    const { seen, fetchImpl } = server((q) => (q.get("kind") === "chunk" ? { status: 200, body: { text: "x" } } : { status: 429, body: { error: "busy", retry_after_ms: 50 } }));
    const { c, lost, finals } = client(fetchImpl, { finalBudgetMs: 1200 });
    feed(c, quiet(400));
    feed(c, voice(1200));
    feed(c, quiet(800));
    await new Promise((r) => setTimeout(r, 2500));
    const finalsSent = seen.filter((x) => x.url.searchParams.get("kind") === "final").length;
    // 500, 1000 ms backoff fit in 1.2 s; the next one would not
    expect(finalsSent).toBe(2);
    expect(finals).toEqual([]);
    expect(lost).toHaveLength(1);
    expect(c.trace.lines[lost[0]].lostAt).toBeDefined();
    await c.stop(100);
  });

  it("a request that waits longer than the delay makes the captions late", async () => {
    const { fetchImpl } = server(async (q) => {
      await new Promise((r) => setTimeout(r, 400));
      return { status: 200, body: q.get("kind") === "chunk" ? { text: "x" } : { utterances: [{ id: q.get("line"), text: "ok" }], view: null } };
    });
    const { c, delays } = client(fetchImpl, { delayMs: 100 });
    feed(c, quiet(400));
    feed(c, voice(1200));
    feed(c, quiet(800));
    await new Promise((r) => setTimeout(r, 700));
    expect(delays).toEqual([true, false]);
    await c.stop(100);
  });

  it("a final refused for a bad request is reported lost, not retried", async () => {
    const { seen, fetchImpl } = server((q) => (q.get("kind") === "chunk" ? { status: 200, body: { text: "x" } } : { status: 400, body: { error: "invalid_query" } }));
    const { c, lost } = client(fetchImpl);
    feed(c, quiet(400));
    feed(c, voice(1200));
    feed(c, quiet(800));
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.filter((x) => x.url.searchParams.get("kind") === "final")).toHaveLength(1);
    expect(lost).toHaveLength(1);
    await c.stop(100);
  });

  it("the recording clock is the earliest estimate over all blocks (late blocks do not shift it)", () => {
    let t = 10_000;
    const { fetchImpl } = server(() => ({ status: 200, body: { text: "" } }));
    const { c } = client(fetchImpl, { now: () => t });
    // the first block reaches the page 40 ms late (queued), later ones on time
    t = 10_000 + 8 + 40;
    c.feed(new Float32Array(128).fill(0.0005), SR); // 8 ms of audio
    expect(c.trace.t0Wall).toBe(10_040);
    t = 10_000 + 16;
    c.feed(new Float32Array(128).fill(0.0005), SR);
    expect(c.trace.t0Wall).toBe(10_000);
    t = 10_000 + 24 + 90; // a late one later does not move it back
    c.feed(new Float32Array(128).fill(0.0005), SR);
    expect(c.trace.t0Wall).toBe(10_000);
  });

  it("a recorder at 48 kHz is resampled to 16 kHz before cutting", async () => {
    const { seen, fetchImpl } = server((q) => ({ status: 200, body: q.get("kind") === "chunk" ? { text: "x" } : { utterances: [{ id: "a", text: "b" }], view: null } }));
    const { c } = client(fetchImpl);
    const hi = (ms: number, amp: number) => {
      const out = new Float32Array(Math.round(ms * 48));
      for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * 180 * i) / 48_000) * (amp > 0.01 ? 0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / 48_000) : 1);
      return out;
    };
    const a = new Float32Array([...hi(400, 0.0005), ...hi(1500, 0.2), ...hi(900, 0.0005)]);
    for (let i = 0; i < a.length; i += 384) c.feed(a.slice(i, i + 384), 48_000);
    await settle();
    await c.stop(500);
    const final = seen.find((s) => s.url.searchParams.get("kind") === "final")!;
    // about 1.5 s of speech plus pre-roll and tail at 16 kHz, 16-bit
    expect(final.bytes).toBeGreaterThan(44 + 1.5 * 32_000);
    expect(final.bytes).toBeLessThan(44 + 2.6 * 32_000);
    expect(c.trace.samples).toBeGreaterThan(2.7 * 16_000);
  });
});
