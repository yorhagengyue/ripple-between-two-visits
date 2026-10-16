/**
 * M14 live segmentation: chunks are cut at pauses (or the quietest moment once 3 s long), lines end at a
 * 550 ms pause, silence and a steady hum are never sent, and the recording clock is kept in samples.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_TUNING, LiveSegmenter, liveTuning, StreamResampler, type ChunkPiece, type LinePiece, type Piece } from "@/lib/asr/segmenter";

const SR = 16_000;
const n = (ms: number) => Math.round((ms * SR) / 1000);

/** A voice-like signal: 180 Hz carrier with a 4 Hz syllable envelope that never quite reaches silence. */
function voice(ms: number, amp = 0.2, seed = 1): Float32Array {
  const out = new Float32Array(n(ms));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t + seed);
    out[i] = amp * env * Math.sin(2 * Math.PI * 180 * t);
  }
  return out;
}

/** Room noise (deterministic pseudo-random). */
function room(ms: number, amp = 0.0008, seed = 7): Float32Array {
  const out = new Float32Array(n(ms));
  let x = seed;
  for (let i = 0; i < out.length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out[i] = amp * ((x / 2147483648) * 2 - 1);
  }
  return out;
}

function hum(ms: number, amp: number): Float32Array {
  const out = new Float32Array(n(ms));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * 50 * i) / SR);
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i % b.length] ?? 0);
  return out;
}

/** Feed in 128-sample blocks like the AudioWorklet does. */
function run(seg: LiveSegmenter, audio: Float32Array, block = 128): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < audio.length; i += block) out.push(...seg.push(audio.slice(i, i + block)));
  return out;
}

const chunks = (ps: Piece[]) => ps.filter((p): p is ChunkPiece => p.type === "chunk");
const lines = (ps: Piece[]) => ps.filter((p): p is LinePiece => p.type === "line");
const toMs = (s: number) => Math.round((s / SR) * 1000);

describe("LiveSegmenter", () => {
  it("cuts a chunk at a short pause once it holds a second of speech, and ends the line at a long pause", () => {
    const audio = concat(room(500), voice(1800), room(300), voice(1500, 0.2, 3), room(900));
    const ps = run(new LiveSegmenter(), audio);
    const ls = lines(ps);
    expect(ls).toHaveLength(1);
    const cs = chunks(ps);
    expect(cs).toHaveLength(2);
    // first chunk ends inside the 300 ms pause (2300-2600 ms), the second covers the rest of the speech
    expect(toMs(cs[0].end)).toBeGreaterThanOrEqual(2300);
    expect(toMs(cs[0].end)).toBeLessThanOrEqual(2600);
    expect(cs[1].start).toBe(cs[0].end);
    expect(toMs(cs[1].end)).toBeGreaterThanOrEqual(4100);
    // the line starts a little before the speech (pre-roll) and ends just after it
    expect(toMs(ls[0].start)).toBeGreaterThanOrEqual(200);
    expect(toMs(ls[0].start)).toBeLessThanOrEqual(500);
    expect(toMs(ls[0].speechEnd)).toBeGreaterThanOrEqual(4060);
    expect(toMs(ls[0].speechEnd)).toBeLessThanOrEqual(4160);
    expect(ls[0].samples.length).toBe(ls[0].end - ls[0].start);
    expect(cs.every((c) => c.line === 1 && c.lineStart === ls[0].start)).toBe(true);
  });

  it("emits the line soon after the speech ends: within the line gap plus one frame", () => {
    const seg = new LiveSegmenter();
    const speech = concat(room(400), voice(1200));
    const ps1 = run(seg, speech);
    expect(lines(ps1)).toHaveLength(0);
    let fedMs = 0;
    let got: Piece[] = [];
    while (!lines(got).length && fedMs < 2000) {
      got = run(seg, room(20));
      fedMs += 20;
    }
    expect(lines(got)).toHaveLength(1);
    expect(fedMs).toBeGreaterThanOrEqual(DEFAULT_LIVE_TUNING.lineGapMs - 40);
    expect(fedMs).toBeLessThanOrEqual(DEFAULT_LIVE_TUNING.lineGapMs + 60);
  });

  it("two sentences separated by more than the line gap are two lines", () => {
    const ps = run(new LiveSegmenter(), concat(room(400), voice(1500), room(800), voice(1200, 0.2, 2), room(800)));
    const ls = lines(ps);
    expect(ls.map((l) => l.line)).toEqual([1, 2]);
    expect(ls[1].start).toBeGreaterThan(ls[0].end);
  });

  it("continuous speech is cut every 3 s at most, at the quietest frame", () => {
    const ps = run(new LiveSegmenter(), concat(room(300), voice(8000), room(800)));
    const cs = chunks(ps);
    expect(cs.length).toBeGreaterThanOrEqual(3);
    for (const c of cs) expect(toMs(c.end - c.start)).toBeLessThanOrEqual(DEFAULT_LIVE_TUNING.maxChunkMs + 40);
    // consecutive chunks leave no gap and do not overlap
    for (let i = 1; i < cs.length; i++) expect(cs[i].start).toBe(cs[i - 1].end);
    expect(lines(ps)).toHaveLength(1);
  });

  it("a line longer than the maximum is split and the speech goes on in a new line", () => {
    const seg = new LiveSegmenter({ maxLineMs: 6000 });
    const ps = run(seg, concat(room(300), voice(14_000), room(800)));
    const ls = lines(ps);
    expect(ls.length).toBeGreaterThanOrEqual(2);
    for (const l of ls) expect(toMs(l.end - l.start)).toBeLessThanOrEqual(6100);
  });

  it("silence, short clicks and a steady hum send nothing", () => {
    expect(run(new LiveSegmenter(), room(5000))).toEqual([]);
    expect(run(new LiveSegmenter(), concat(room(500), voice(40), room(1500)))).toEqual([]);
    // a 100 ms click or tap is too short to be a word: dropped, not transcribed
    expect(run(new LiveSegmenter(), concat(room(500), voice(100, 0.3), room(1500)))).toEqual([]);
  });

  it("keeps a short answer: a 220 ms \"对。\" is a line of its own", () => {
    const ps = run(new LiveSegmenter(), concat(room(500), voice(1500), room(700), voice(220, 0.3, 2), room(900)));
    expect(lines(ps)).toHaveLength(2);
    expect(toMs(lines(ps)[1].speechEnd - lines(ps)[1].start)).toBeGreaterThanOrEqual(200);
    // a fridge / air-con hum from the start: the floor is calibrated on it
    expect(run(new LiveSegmenter(), hum(6000, 0.02))).toEqual([]);
  });

  it("finds speech over a steady hum", () => {
    const bg = hum(6000, 0.01);
    const audio = add(concat(room(800), voice(2000, 0.25), room(2000)), bg);
    const ls = lines(run(new LiveSegmenter(), audio));
    expect(ls).toHaveLength(1);
    expect(toMs(ls[0].speechEnd)).toBeGreaterThan(2600);
    expect(toMs(ls[0].speechEnd)).toBeLessThan(3000);
  });

  it("flush closes the line in progress (pause, end of visit); nothing to flush when quiet", () => {
    const seg = new LiveSegmenter();
    run(seg, concat(room(400), voice(1500)));
    expect(seg.speaking).toBe(true);
    const ps = seg.flush();
    expect(lines(ps)).toHaveLength(1);
    expect(chunks(ps)).toHaveLength(1);
    expect(seg.speaking).toBe(false);
    expect(seg.flush()).toEqual([]);
  });

  it("keeps the recording clock in samples", () => {
    const seg = new LiveSegmenter();
    run(seg, room(1234));
    expect(seg.position).toBe(n(1234));
  });

  it("clamps a tuning from the server", () => {
    expect(liveTuning({ lineGapMs: 5, maxChunkMs: 1e9, minChunkMs: 99_999 })).toMatchObject({ lineGapMs: 200, maxChunkMs: 10_000, minChunkMs: 5000 });
    expect(liveTuning({ chunkGapMs: 900, lineGapMs: 300 }).chunkGapMs).toBe(300);
    expect(liveTuning(null)).toEqual(DEFAULT_LIVE_TUNING);
  });
});

describe("StreamResampler", () => {
  it("48 kHz -> 16 kHz in blocks gives the same samples as one pass, and keeps a sine's frequency", () => {
    const src = new Float32Array(48_000);
    for (let i = 0; i < src.length; i++) src[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000);
    const whole = new StreamResampler(48_000).push(src);
    const r = new StreamResampler(48_000);
    const parts: number[] = [];
    for (let i = 0; i < src.length; i += 128) parts.push(...r.push(src.slice(i, i + 128)));
    expect(Math.abs(parts.length - whole.length)).toBeLessThanOrEqual(1);
    expect(whole.length).toBeGreaterThan(15_990);
    for (let i = 0; i < 1000; i++) expect(parts[i]).toBeCloseTo(whole[i], 5);
    // zero crossings: 440 Hz -> 880 per second
    let crossings = 0;
    for (let i = 1; i < whole.length; i++) if (whole[i - 1] < 0 !== whole[i] < 0) crossings++;
    expect(crossings).toBeGreaterThan(870);
    expect(crossings).toBeLessThan(890);
  });

  it("16 kHz passes through untouched", () => {
    const x = new Float32Array([0.1, 0.2]);
    expect(new StreamResampler(16_000).push(x)).toBe(x);
  });
});
