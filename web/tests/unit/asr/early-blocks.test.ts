/**
 * Round 2: the microphone blocks recorded before the live client exists (it waits for /api/asr/realtime-token)
 * are handed to it first, so his first words reach the live captions and the live clock's sample 0 is the
 * recording's sample 0 (lib/asr/early-blocks, wired in components/visit/VisitFlow).
 */
import { describe, expect, it } from "vitest";
import { BlockClock, EarlyBlocks } from "@/lib/asr/early-blocks";
import { LiveWhisperClient } from "@/lib/asr/live-client";

const SR = 16_000;
const block = (n: number, v: number) => new Float32Array(n).fill(v);

describe("EarlyBlocks", () => {
  it("hands the blocks over in order, then is empty", () => {
    const e = new EarlyBlocks();
    e.push(block(128, 0.1), SR);
    e.push(block(64, 0.2), SR);
    e.push(new Float32Array(0), SR); // ignored
    expect(e.bufferedMs).toBe(12);
    const got: [number, number, number][] = [];
    expect(e.drain((b, r) => got.push([b.length, Math.round(b[0] * 10) / 10, r]))).toBe(192);
    expect(got).toEqual([[128, 0.1, SR], [64, 0.2, SR]]);
    expect(e.drain(() => got.push([0, 0, 0]))).toBe(0);
    expect(e.bufferedMs).toBe(0);
  });

  it("past its bound it drops the oldest blocks and hands them over as silence of the same length", () => {
    const e = new EarlyBlocks(100); // 100 ms
    for (let i = 0; i < 20; i++) e.push(block(160, 0.3), SR); // 20 x 10 ms
    const got: Float32Array[] = [];
    const n = e.drain((b) => got.push(b));
    expect(n).toBe(20 * 160); // the clock stays aligned: nothing is skipped
    const all = got.flatMap((b) => Array.from(b));
    expect(all.slice(0, 10 * 160).every((x) => x === 0)).toBe(true); // the dropped 100 ms are silence
    expect(all.slice(10 * 160).every((x) => Math.abs(x - 0.3) < 1e-6)).toBe(true); // the newest 100 ms kept
  });

  it("clear() forgets everything (no live captions on this visit)", () => {
    const e = new EarlyBlocks();
    e.push(block(128, 0.1), SR);
    e.clear();
    expect(e.drain(() => undefined)).toBe(0);
  });
});

describe("BlockClock", () => {
  it("is the earliest arrival - audio so far over all blocks", () => {
    const c = new BlockClock();
    c.observe(128, SR, 10_000 + 8 + 30); // the first block 30 ms late
    expect(c.trace.t0Wall).toBe(10_030);
    c.observe(128, SR, 10_000 + 16); // on time
    expect(c.trace.t0Wall).toBe(10_000);
    c.observe(128, SR, 10_000 + 24 + 200); // a late one does not move it
    expect(c.trace).toEqual({ t0Wall: 10_000, receivedMs: 24, samples: 384, blocks: 3 });
  });
});

describe("the page's wiring: recorder -> clock + early blocks -> live client", () => {
  it("the live client attached 300 ms late still starts at the recording's sample 0 and hears what was said before", () => {
    let t = 10_000;
    const fetchImpl = (async () => new Response(JSON.stringify({ text: "" }), { status: 200 })) as typeof fetch;
    const clock = new BlockClock();
    const early = new EarlyBlocks();
    let live: LiveWhisperClient | null = null;
    const onBlock = (b: Float32Array, rate: number) => {
      clock.observe(b.length, rate, t);
      if (live) live.feed(b, rate);
      else early.push(b, rate);
    };
    // speech from 100 ms to 1.5 s, then quiet; 8 ms blocks arriving on time
    const voiced = (ms: number) => ms >= 100 && ms < 1500;
    let ms = 0;
    const step = () => {
      const b = new Float32Array(128);
      for (let i = 0; i < b.length; i++) {
        const tt = (ms + (i * 1000) / SR) / 1000;
        b[i] = voiced(ms) ? 0.2 * Math.sin(2 * Math.PI * 180 * tt) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * tt)) : 0.0005;
      }
      ms += 8;
      t = 10_000 + ms;
      onBlock(b, SR);
    };
    while (ms < 300) step(); // the realtime token is on its way: nothing is live yet
    const c = new LiveWhisperClient({
      sessionId: "s1",
      visitId: "v1",
      tuning: {},
      fetch: fetchImpl,
      base: "http://app.test",
      now: () => t,
      onCaption: () => undefined,
      onDrop: () => undefined,
      onFinal: () => undefined,
      onFallback: () => undefined,
    });
    const buffered = early.drain((b, r) => c.feed(b, r));
    c.markAttached(buffered);
    live = c;
    while (ms < 3000) step();
    expect(c.trace.bufferedSamples).toBe(38 * 128); // 38 blocks of 8 ms before the client existed
    expect(c.trace.attachedAt).toBe(10_304);
    // every recorder sample reached the live client, so its clock is the recording's
    expect(c.trace.inputSamples).toBe(clock.trace.samples);
    expect(c.trace.t0Wall).toBe(clock.trace.t0Wall);
    expect(clock.trace.t0Wall).toBe(10_000);
    // the first line starts where he started speaking (100 ms), not where the client attached (300 ms)
    const first = Object.values(c.trace.lines)[0];
    expect(first).toBeDefined();
    expect(first.startMs).toBeLessThan(200);
    void c.stop(0);
  });
});
