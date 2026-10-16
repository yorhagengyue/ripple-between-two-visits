/**
 * 16 kHz mono 16-bit PCM WAV: encode (browser recorder), parse and slice (per-sentence clips on the server).
 * The Storage layer refuses anything that does not start with RIFF....WAVE, and WebM never gets this far.
 * No node: imports; runs in the browser and on the server.
 */

export const TARGET_SAMPLE_RATE = 16_000;

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
  durationMs: number;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Float samples (-1..1) or Int16 samples -> a complete mono 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array | Int16Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, n * 2, true);
  let off = 44;
  if (samples instanceof Int16Array) {
    for (let i = 0; i < n; i++, off += 2) view.setInt16(off, samples[i], true);
  } else {
    for (let i = 0; i < n; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Uint8Array(buf);
}

/** WAVE_FORMAT_PCM, and WAVE_FORMAT_EXTENSIBLE (whose real format is the first two bytes of its sub-format GUID). */
const FORMAT_PCM = 1;
const FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Header facts of a PCM WAV, or null when it is not one: not RIFF/WAVE, no fmt chunk before the data chunk, a fmt
 * chunk shorter than 16 bytes, or a format other than PCM (format 1, or EXTENSIBLE whose sub-format is PCM).
 * The same rules as the Whisper service's intake (services/whisper/ripple_whisper/wavfile.py parse_wav), so a file
 * this accepts is not refused there for its format: a-law, mu-law, ADPCM (format 2), float (3) and an EXTENSIBLE
 * float are all null here. A data size of 0 or 0xFFFFFFFF (a streaming writer that never went back to fill it in)
 * means "the rest of the file", as in the service.
 */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.length) return null;
      let format = view.getUint16(body, true);
      if (format === FORMAT_EXTENSIBLE && size >= 40 && body + 40 <= bytes.length) format = view.getUint16(body + 24, true);
      fmt = { format, channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt || fmt.format !== FORMAT_PCM) return null;
      const dataLength = size === 0 || size === 0xffffffff ? bytes.length - body : Math.min(size, bytes.length - body);
      const bytesPerMs = (fmt.sampleRate * fmt.channels * (fmt.bits / 8)) / 1000;
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        dataOffset: body,
        dataLength,
        durationMs: bytesPerMs > 0 ? Math.floor(dataLength / bytesPerMs) : 0,
      };
    }
    off = body + size + (size % 2);
  }
  return null;
}

/**
 * The samples of [startMs, endMs) of a mono 16-bit WAV, with the file's sample rate; null when it is not such a file or
 * the range is outside the audio. (C2 track R: a sentence clip of a recording in several files is these ranges of two
 * files, joined.)
 */
export function pcmRange(bytes: Uint8Array, startMs: number, endMs: number): { samples: Int16Array; sampleRate: number } | null {
  const info = parseWav(bytes);
  if (!info || info.channels !== 1 || info.bitsPerSample !== 16) return null;
  const bytesPerMs = (info.sampleRate * 2) / 1000;
  const from = Math.max(0, Math.floor((startMs * bytesPerMs) / 2) * 2);
  const to = Math.min(info.dataLength, Math.floor((endMs * bytesPerMs) / 2) * 2);
  if (to - from < 2) return null;
  const pcm = bytes.slice(info.dataOffset + from, info.dataOffset + to);
  return { samples: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2), sampleRate: info.sampleRate };
}

/** A new WAV holding [startMs, endMs) of a mono 16-bit WAV; null when the range is outside the audio. */
export function sliceWav(bytes: Uint8Array, startMs: number, endMs: number): Uint8Array | null {
  const range = pcmRange(bytes, startMs, endMs);
  return range ? encodeWav(range.samples, range.sampleRate) : null;
}

/** Float samples (-1..1) -> 16-bit samples, exactly as encodeWav writes them. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Join runs of 16-bit samples into one array. */
export function concatInt16(chunks: readonly Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Linear resampling for browsers that will not open a 16 kHz AudioContext. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Join recorded chunks into one array. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
