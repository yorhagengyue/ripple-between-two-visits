/**
 * A saved recording's length and shape, read from the file itself (the fe-d track; the v3 draft's E5 draws each of her
 * recordings as a small waveform with its length). Nothing about a clip's sound is stored beside it, so her screen
 * reads the WAV it is about to play anyway and measures it: how long it is, and how loud each stretch is. A file that
 * is not plain 16-bit PCM gives null, and the screen then draws no shape for it. Client-safe, pure but for the fetch.
 */

export interface ClipShape {
  /** the clip's length */
  seconds: number;
  /** one level per bar, 0..1 (the same scale as the live shape while recording) */
  levels: number[];
}

const tag = (v: DataView, at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

/** `bars` levels and the length of a 16-bit PCM WAV; null for anything else. */
export function wavShape(buf: ArrayBuffer, bars: number): ClipShape | null {
  const v = new DataView(buf);
  if (bars < 1 || v.byteLength < 44 || tag(v, 0) !== "RIFF" || tag(v, 8) !== "WAVE") return null;
  let off = 12;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let dataAt = -1;
  let dataLen = 0;
  while (off + 8 <= v.byteLength) {
    const id = tag(v, off);
    const len = v.getUint32(off + 4, true);
    if (id === "fmt " && off + 24 <= v.byteLength) {
      format = v.getUint16(off + 8, true);
      channels = v.getUint16(off + 10, true);
      rate = v.getUint32(off + 12, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === "data") {
      dataAt = off + 8;
      dataLen = Math.min(len, v.byteLength - dataAt);
      break;
    }
    off += 8 + len + (len % 2);
  }
  if (dataAt < 0 || format !== 1 || bits !== 16 || channels < 1 || rate <= 0) return null;
  const frame = 2 * channels;
  const frames = Math.floor(dataLen / frame);
  if (!frames) return null;
  const levels: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * frames) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * frames) / bars));
    // a few hundred samples say how loud a stretch is
    const step = Math.max(1, Math.floor((to - from) / 400));
    let sum = 0;
    let n = 0;
    for (let i = from; i < to && i < frames; i += step) {
      const s = v.getInt16(dataAt + i * frame, true) / 32768;
      sum += s * s;
      n += 1;
    }
    levels.push(Math.min(1, Math.sqrt(sum / Math.max(1, n)) * 6));
  }
  return { seconds: frames / rate, levels };
}

/** The shape of the clip behind `url` (her own link to its sound); null when it cannot be read. */
export async function clipShape(url: string, bars: number, signal?: AbortSignal): Promise<ClipShape | null> {
  try {
    const res = await fetch(url, { credentials: "same-origin", signal });
    if (!res.ok) return null;
    return wavShape(await res.arrayBuffer(), bars);
  } catch {
    return null;
  }
}

/** `n` bars for levels already measured (a take just recorded): the loudest of each stretch. */
export function barsOf(levels: readonly number[], n: number): number[] {
  if (levels.length <= n) return [...levels];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * levels.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / n));
    out.push(Math.max(...levels.slice(from, to)));
  }
  return out;
}

/** "0:04" */
export const clipClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
