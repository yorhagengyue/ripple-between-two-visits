/**
 * A saved recording's length and shape, measured from the WAV itself (lib/care/clip-shape.ts; the v3 draft's E5). Her
 * screen draws a shape only for a file it could read; nothing is made up for the rest.
 */
import { describe, expect, it } from "vitest";
import { barsOf, clipClock, wavShape } from "@/lib/care/clip-shape";

/** A 16-bit PCM WAV: `seconds` of a square wave at `amp` (0..1) in the first half, silence in the second. */
function wav(seconds: number, opts: { rate?: number; channels?: number; bits?: number; amp?: number; extraChunk?: boolean } = {}): ArrayBuffer {
  const rate = opts.rate ?? 16000;
  const channels = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const frames = Math.round(seconds * rate);
  const dataLen = frames * channels * (bits / 8);
  const extra = opts.extraChunk ? 12 : 0;
  const buf = new ArrayBuffer(44 + extra + dataLen);
  const v = new DataView(buf);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + extra + dataLen, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * (bits / 8), true);
  v.setUint16(32, channels * (bits / 8), true);
  v.setUint16(34, bits, true);
  let at = 36;
  if (opts.extraChunk) {
    // a chunk a recorder may write before the samples
    put(at, "LIST");
    v.setUint32(at + 4, 4, true);
    at += 12;
  }
  put(at, "data");
  v.setUint32(at + 4, dataLen, true);
  at += 8;
  if (bits === 16) {
    const amp = Math.round((opts.amp ?? 0.1) * 32767);
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) v.setInt16(at + (i * channels + c) * 2, i < frames / 2 ? (i % 2 ? amp : -amp) : 0, true);
  }
  return buf;
}

describe("a clip's shape, read from the file", () => {
  it("says how long it is and how loud each stretch is", () => {
    const shape = wavShape(wav(4), 26)!;
    expect(shape.seconds).toBeCloseTo(4, 3);
    expect(shape.levels).toHaveLength(26);
    // the first half is sound (0.1 of full scale, times the recorder's gain of 6), the second half silence
    expect(shape.levels[0]).toBeCloseTo(0.6, 1);
    expect(shape.levels[12]).toBeGreaterThan(0.5);
    expect(shape.levels[13]).toBe(0);
    expect(shape.levels[25]).toBe(0);
    for (const l of shape.levels) expect(l).toBeGreaterThanOrEqual(0);
  });

  it("never draws above the top: a loud clip stops at 1", () => {
    expect(Math.max(...wavShape(wav(1, { amp: 0.9 }), 10)!.levels)).toBe(1);
  });

  it("reads stereo, another sample rate, and a file with a chunk before its samples", () => {
    expect(wavShape(wav(2, { channels: 2, rate: 44100 }), 8)!.seconds).toBeCloseTo(2, 3);
    const shape = wavShape(wav(3, { extraChunk: true }), 8)!;
    expect(shape.seconds).toBeCloseTo(3, 3);
    expect(shape.levels[0]).toBeGreaterThan(0.5);
  });

  it("gives nothing for what it cannot read: not a WAV, not 16-bit, no samples", () => {
    expect(wavShape(new ArrayBuffer(10), 8)).toBeNull();
    expect(wavShape(new TextEncoder().encode("x".repeat(64)).buffer as ArrayBuffer, 8)).toBeNull();
    expect(wavShape(wav(1, { bits: 8 }), 8)).toBeNull();
    expect(wavShape(wav(0), 8)).toBeNull();
    expect(wavShape(wav(1), 0)).toBeNull();
  });
});

describe("the bars of a take just recorded", () => {
  it("keeps a short take as it is and takes the loudest of each stretch of a long one", () => {
    expect(barsOf([0.1, 0.2, 0.3], 46)).toEqual([0.1, 0.2, 0.3]);
    expect(barsOf([0.1, 0.9, 0.2, 0.3, 0.4, 0.5], 3)).toEqual([0.9, 0.3, 0.5]);
    expect(barsOf(Array.from({ length: 200 }, (_, i) => i / 200), 46)).toHaveLength(46);
  });

  it("writes a length as minutes and seconds", () => {
    expect(clipClock(4.9)).toBe("0:04");
    expect(clipClock(65)).toBe("1:05");
  });
});
