/**
 * The recorder's output format: 16 kHz mono 16-bit PCM WAV (RIFF/WAVE), which the Storage layer accepts;
 * WebM is never produced and is refused. Per-sentence clips are cut from such a file.
 */
import { describe, expect, it } from "vitest";
import { checkWrite, sniffContentType } from "@/lib/blob/validate";
import { concatFloat32, encodeWav, parseWav, resampleLinear, sliceWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import { webmBytes } from "../blob/fixtures";

function tone(seconds: number, rate = TARGET_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return out;
}

describe("WAV encoding", () => {
  it("writes a 16 kHz mono 16-bit PCM WAV that Storage accepts as audio/wav", () => {
    const bytes = encodeWav(tone(1));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    expect(parseWav(bytes)).toMatchObject({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataOffset: 44, dataLength: 32000, durationMs: 1000 });
    expect(sniffContentType(bytes)).toBe("audio/wav");
    expect(checkWrite("audio", "s1/visits/v1/recording-x.wav", bytes, "audio/wav")).toBe("audio/wav");
  });

  it("WebM bytes are not a WAV and are refused by Storage", () => {
    expect(parseWav(webmBytes())).toBeNull();
    expect(sniffContentType(webmBytes())).toBe("audio/webm");
    expect(() => checkWrite("audio", "s1/visits/v1/recording-x.wav", webmBytes(), "audio/wav")).toThrow();
    expect(() => checkWrite("audio", "s1/visits/v1/recording-x.webm", webmBytes(), "audio/webm")).toThrow();
  });

  it("clamps samples and accepts Int16 input", () => {
    const loud = encodeWav(new Float32Array([2, -2, 0]));
    const view = new DataView(loud.buffer);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, -32768, 0]);
    expect(parseWav(encodeWav(new Int16Array([1, 2, 3])))!.dataLength).toBe(6);
  });
});

describe("cutting clips", () => {
  it("slices [start, end) of the recording into its own WAV", () => {
    const whole = encodeWav(tone(3));
    const clip = sliceWav(whole, 1000, 2500)!;
    expect(parseWav(clip)).toMatchObject({ sampleRate: 16000, channels: 1, durationMs: 1500 });
    expect(sliceWav(whole, 5000, 6000)).toBeNull();
    expect(sliceWav(webmBytes(), 0, 100)).toBeNull();
  });
});

describe("resampling", () => {
  it("48 kHz blocks become 16 kHz", () => {
    const at48 = concatFloat32([tone(0.5, 48000), tone(0.5, 48000)]);
    expect(resampleLinear(at48, 48000).length).toBe(16000);
    const same = tone(0.1);
    expect(resampleLinear(same, 16000)).toBe(same);
  });
});
