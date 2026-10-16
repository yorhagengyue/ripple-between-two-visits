/**
 * lib/visit/wav.ts parseWav takes PCM only (format 1, or WAVE_FORMAT_EXTENSIBLE whose sub-format is PCM), the same
 * rules as the Whisper service's intake (services/whisper/ripple_whisper/wavfile.py). Before B3 it ignored the format
 * code, so a format-2 file passed the web app's check, the service refused it with 415 and the web app counted that
 * as "the service did not answer" (PROGRESS 10-09, Whisper reliability round 3, problem 1).
 */
import { describe, expect, it } from "vitest";
import { encodeWav, parseWav, sliceWav } from "@/lib/visit/wav";

const SECOND = new Float32Array(16_000).fill(0.05);

/** A WAV with a chosen fmt chunk (format code, fmt size, EXTENSIBLE sub-format) around 1 s of 16 kHz mono 16-bit samples. */
function wavWith(opts: { format: number; fmtSize?: number; subFormat?: number; dataSize?: number; dataFirst?: boolean }): Uint8Array {
  const pcm = encodeWav(SECOND).slice(44);
  const fmtSize = opts.fmtSize ?? (opts.format === 0xfffe ? 40 : 16);
  // a declared fmt size under 16 still gets 16 bytes written (the parser must refuse it by the declared size)
  const fmt = new Uint8Array(8 + Math.max(fmtSize, 16));
  const fv = new DataView(fmt.buffer);
  fmt.set([0x66, 0x6d, 0x74, 0x20]); // "fmt "
  fv.setUint32(4, fmtSize, true);
  fv.setUint16(8, opts.format, true);
  fv.setUint16(10, 1, true);
  fv.setUint32(12, 16_000, true);
  fv.setUint32(16, 32_000, true);
  fv.setUint16(20, 2, true);
  fv.setUint16(22, 16, true);
  if (fmtSize >= 40) {
    fv.setUint16(24, 22, true); // cbSize
    fv.setUint16(26, 16, true); // valid bits
    fv.setUint32(28, 4, true); // channel mask
    // sub-format GUID {0000000X-0000-0010-8000-00AA00389B71}: X = 1 PCM, 3 IEEE float
    fv.setUint16(32, opts.subFormat ?? 1, true);
    fmt.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 34);
  }
  const data = new Uint8Array(8 + pcm.length);
  data.set([0x64, 0x61, 0x74, 0x61]); // "data"
  new DataView(data.buffer).setUint32(4, opts.dataSize ?? pcm.length, true);
  data.set(pcm, 8);
  const chunks = opts.dataFirst ? [data, fmt] : [fmt, data];
  const body = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  let off = 12;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe("parseWav: PCM only, as the service", () => {
  it("format 1 (what the browser recorder writes) is taken", () => {
    expect(parseWav(encodeWav(SECOND))).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, durationMs: 1000 });
    expect(parseWav(wavWith({ format: 1 }))).toMatchObject({ durationMs: 1000, dataLength: 32_000 });
  });

  it.each([
    [2, "ADPCM"],
    [3, "IEEE float"],
    [6, "a-law"],
    [7, "mu-law"],
    [0x55, "MP3"],
  ])("format %i (%s) is not a PCM WAV", (format) => {
    expect(parseWav(wavWith({ format }))).toBeNull();
  });

  it("WAVE_FORMAT_EXTENSIBLE: PCM sub-format taken, float sub-format refused, a fmt too short to say refused", () => {
    expect(parseWav(wavWith({ format: 0xfffe }))).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, durationMs: 1000 });
    expect(parseWav(wavWith({ format: 0xfffe, subFormat: 3 }))).toBeNull();
    expect(parseWav(wavWith({ format: 0xfffe, fmtSize: 18 }))).toBeNull();
  });

  it("a broken header is refused: fmt shorter than 16 bytes, data before fmt", () => {
    expect(parseWav(wavWith({ format: 1, fmtSize: 14 }))).toBeNull();
    expect(parseWav(wavWith({ format: 1, dataFirst: true }))).toBeNull();
  });

  it("a data size of 0 or 0xFFFFFFFF (a streaming writer) means the rest of the file, as in the service", () => {
    expect(parseWav(wavWith({ format: 1, dataSize: 0 }))).toMatchObject({ dataLength: 32_000, durationMs: 1000 });
    expect(parseWav(wavWith({ format: 1, dataSize: 0xffffffff }))).toMatchObject({ dataLength: 32_000, durationMs: 1000 });
    // a header that claims more than is there: what is there
    expect(parseWav(wavWith({ format: 1, dataSize: 999_999 }))).toMatchObject({ dataLength: 32_000 });
  });

  it("clips are only cut from PCM", () => {
    expect(sliceWav(wavWith({ format: 1 }), 0, 500)).not.toBeNull();
    expect(sliceWav(wavWith({ format: 2 }), 0, 500)).toBeNull();
  });
});
