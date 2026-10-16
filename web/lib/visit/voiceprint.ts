/**
 * A small fingerprint of a voice, made from one live line's audio (scene 1 of the owner's video, 2026-10-15: who is
 * speaking is found from the voice and from the words together; lib/visit/speakers.ts combines the two).
 *
 * What it is, for 16 kHz mono 16-bit PCM (the phone's recording; any other rate is read as it is):
 *   timbre   the means and the spreads of 12 mel-frequency cepstral coefficients (MFCC 1-12) over the frames that carry
 *            speech: pre-emphasis 0.97, 25 ms Hamming frames every 10 ms, a 512-point FFT, 26 mel filters from 64 Hz to
 *            7.6 kHz, the log of each, a DCT, the usual sinusoidal lifter (L = 22) so every coefficient counts alike
 *   pitch    the median and the spread (interquartile range) of the voice's pitch in semitones, by YIN on the signal
 *            at 8 kHz, every 20 ms of speech, between 60 and 400 Hz
 * Frames that carry speech are those within 30 dB of the line's loudest frame and above -55 dBFS. A line with less
 * than MIN_SPEECH_MS of speech has no print (null): a short "ok" says too little about a voice, and a missing print is
 * better than a wrong one (the words still say who it was).
 *
 * voiceDistance puts two prints on one scale where about 1 is "the same voice, another sentence" and 2.5 or more is
 * "someone else"; the weights were set on Windows' voices pitched apart and are checked in tests/unit/visit/speakers.
 * Nothing here keeps the audio: a print is 26 numbers and cannot be turned back into speech.
 *
 * Pure and dependency-free (no node: imports): the server computes it, a test can too.
 */

export const MIN_SPEECH_MS = 400;
/** A print resting on less speech than this is weak: it may join a voice that is already known, never start one. */
export const STRONG_SPEECH_MS = 900;

export interface VoicePrint {
  /** liftered MFCC 1-12, mean over the speech frames */
  mean: number[];
  /** their standard deviations */
  spread: number[];
  /** median pitch, semitones above 55 Hz; null when too little of the line was voiced */
  pitch: number | null;
  /** interquartile range of the pitch, semitones */
  pitchRange: number | null;
  /** the speech the print rests on, ms */
  speechMs: number;
}

const FRAME = 400; // 25 ms at 16 kHz
const HOP = 160; // 10 ms
const NFFT = 512;
const N_MEL = 26;
const N_CEP = 12;
const LIFTER = 22;
const F_MIN = 64;
const F_MAX = 7600;

// ------------------------------------------------------------------ tables (made once per sample rate)

interface Tables {
  rate: number;
  hamming: Float64Array;
  /** per mel filter: first bin and weights */
  mel: { from: number; w: Float64Array }[];
  /** DCT-II rows 1..N_CEP over N_MEL inputs, orthonormal */
  dct: Float64Array[];
  lifter: Float64Array;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

let cached: Tables | null = null;

const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

function tables(rate: number): Tables {
  if (cached && cached.rate === rate) return cached;
  const hamming = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const bins = NFFT / 2 + 1;
  const top = Math.min(F_MAX, rate / 2);
  const lo = hz2mel(F_MIN);
  const hi = hz2mel(top);
  const points = Array.from({ length: N_MEL + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (N_MEL + 1)));
  const binHz = rate / NFFT;
  const mel: Tables["mel"] = [];
  for (let m = 1; m <= N_MEL; m++) {
    const [a, b, c] = [points[m - 1], points[m], points[m + 1]];
    const from = Math.max(0, Math.floor(a / binHz));
    const to = Math.min(bins - 1, Math.ceil(c / binHz));
    const w = new Float64Array(to - from + 1);
    for (let k = from; k <= to; k++) {
      const f = k * binHz;
      w[k - from] = f <= a || f >= c ? 0 : f <= b ? (f - a) / (b - a) : (c - f) / (c - b);
    }
    mel.push({ from, w });
  }
  const dct: Float64Array[] = [];
  for (let k = 1; k <= N_CEP; k++) {
    const row = new Float64Array(N_MEL);
    for (let n = 0; n < N_MEL; n++) row[n] = Math.sqrt(2 / N_MEL) * Math.cos((Math.PI * k * (n + 0.5)) / N_MEL);
    dct.push(row);
  }
  const lifter = new Float64Array(N_CEP);
  for (let k = 1; k <= N_CEP; k++) lifter[k - 1] = 1 + (LIFTER / 2) * Math.sin((Math.PI * k) / LIFTER);
  const bitsN = Math.log2(NFFT);
  const rev = new Uint32Array(NFFT);
  for (let i = 0; i < NFFT; i++) {
    let r = 0;
    for (let b = 0; b < bitsN; b++) r |= ((i >> b) & 1) << (bitsN - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(NFFT / 2);
  const sin = new Float64Array(NFFT / 2);
  for (let i = 0; i < NFFT / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / NFFT);
    sin[i] = Math.sin((-2 * Math.PI * i) / NFFT);
  }
  cached = { rate, hamming, mel, dct, lifter, rev, cos, sin };
  return cached;
}

/** In-place radix-2 FFT of NFFT points. */
function fft(re: Float64Array, im: Float64Array, t: Tables): void {
  for (let i = 0; i < NFFT; i++) {
    const j = t.rev[i];
    if (j > i) {
      let x = re[i];
      re[i] = re[j];
      re[j] = x;
      x = im[i];
      im[i] = im[j];
      im[j] = x;
    }
  }
  for (let size = 2; size <= NFFT; size *= 2) {
    const half = size / 2;
    const step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = t.cos[k * step];
        const wi = t.sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

// ------------------------------------------------------------------ pitch (YIN at 8 kHz)

const YIN_RATE = 8000;
const YIN_WINDOW = 200; // 25 ms
const TAU_MIN = Math.floor(YIN_RATE / 400);
const TAU_MAX = Math.ceil(YIN_RATE / 60);
const YIN_THRESHOLD = 0.15;

/** The pitch (Hz) of the 8 kHz frame starting at `s`, or null when it is not voiced. `d` and `n` are scratch space. */
function yin(x: Float64Array, s: number, d: Float64Array, n: Float64Array): number | null {
  if (s + YIN_WINDOW + TAU_MAX >= x.length) return null;
  d[0] = 0;
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    let sum = 0;
    for (let j = 0; j < YIN_WINDOW; j++) {
      const v = x[s + j] - x[s + j + tau];
      sum += v * v;
    }
    d[tau] = sum;
  }
  // cumulative mean normalised difference
  let running = 0;
  n[0] = 1;
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    running += d[tau];
    n[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = TAU_MIN; t <= TAU_MAX; t++) {
    if (n[t] < YIN_THRESHOLD) {
      while (t + 1 <= TAU_MAX && n[t + 1] < n[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // parabolic interpolation around the minimum
  let better = tau;
  if (tau > 1 && tau < TAU_MAX) {
    const a = n[tau - 1];
    const b = n[tau];
    const c = n[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return YIN_RATE / better;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const quantile = (sorted: number[], q: number): number => {
  const p = (sorted.length - 1) * q;
  const i = Math.floor(p);
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * (p - i) : sorted[i];
};

// ------------------------------------------------------------------ the print

/** The fingerprint of one line's audio (Int16 PCM or floats in -1..1), or null when it holds too little speech. */
export function voicePrint(samples: Int16Array | Float32Array | Float64Array, rate = 16_000): VoicePrint | null {
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  const n = samples.length;
  if (n < FRAME * 2 || rate < 8000) return null;
  const t = tables(rate);
  const x = new Float64Array(n);
  let dc = 0;
  for (let i = 0; i < n; i++) dc += samples[i] * scale;
  dc /= n;
  for (let i = 0; i < n; i++) x[i] = samples[i] * scale - dc;

  // frame energies (dBFS) for the speech gate
  const frames = Math.floor((n - FRAME) / HOP) + 1;
  const energy = new Float64Array(frames);
  let loudest = -Infinity;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const s = f * HOP;
    for (let i = 0; i < FRAME; i++) e += x[s + i] * x[s + i];
    energy[f] = 10 * Math.log10(e / FRAME + 1e-12);
    if (energy[f] > loudest) loudest = energy[f];
  }
  const gate = Math.max(loudest - 30, -55);
  const speech: number[] = [];
  for (let f = 0; f < frames; f++) if (energy[f] >= gate) speech.push(f);
  const speechMs = speech.length * (HOP / rate) * 1000;
  if (speechMs < MIN_SPEECH_MS) return null;

  // MFCC over the speech frames
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const logMel = new Float64Array(N_MEL);
  const sum = new Float64Array(N_CEP);
  const sumSq = new Float64Array(N_CEP);
  for (const f of speech) {
    const s = f * HOP;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME; i++) {
      const prev = s + i > 0 ? x[s + i - 1] : 0;
      re[i] = (x[s + i] - 0.97 * prev) * t.hamming[i];
    }
    fft(re, im, t);
    for (let m = 0; m < N_MEL; m++) {
      const { from, w } = t.mel[m];
      let e = 0;
      for (let k = 0; k < w.length; k++) {
        const b = from + k;
        e += w[k] * ((re[b] * re[b] + im[b] * im[b]) / NFFT);
      }
      logMel[m] = Math.log(Math.max(e, 1e-10));
    }
    for (let k = 0; k < N_CEP; k++) {
      let c = 0;
      const row = t.dct[k];
      for (let m = 0; m < N_MEL; m++) c += row[m] * logMel[m];
      c *= t.lifter[k];
      sum[k] += c;
      sumSq[k] += c * c;
    }
  }
  const count = speech.length;
  const mean = Array.from(sum, (v) => v / count);
  const spread = Array.from(sumSq, (v, k) => Math.sqrt(Math.max(0, v / count - mean[k] * mean[k])));

  // pitch: YIN at 8 kHz on every other speech frame
  const half = Math.floor(n / 2);
  const x8 = new Float64Array(half);
  for (let i = 0; i < half; i++) x8[i] = (x[2 * i] + x[2 * i + 1]) / 2;
  const ratio = rate / 2 / YIN_RATE; // 1 at 16 kHz
  const d = new Float64Array(TAU_MAX + 1);
  const nd = new Float64Array(TAU_MAX + 1);
  const tones: number[] = [];
  for (let i = 0; i < speech.length; i += 2) {
    const s8 = Math.round((speech[i] * HOP) / 2 / ratio);
    const hz = ratio === 1 ? yin(x8, s8, d, nd) : null;
    if (hz && hz >= 60 && hz <= 400) tones.push(12 * Math.log2(hz / 55));
  }
  let pitch: number | null = null;
  let pitchRange: number | null = null;
  if (tones.length >= 8) {
    // octave slips (a frame read at half or twice the voice's pitch) are dropped around the first median
    const m0 = median(tones);
    const kept = tones.filter((v) => Math.abs(v - m0) < 7).sort((a, b) => a - b);
    if (kept.length >= 6) {
      pitch = median(kept);
      pitchRange = quantile(kept, 0.75) - quantile(kept, 0.25);
    }
  }
  return { mean, spread, pitch, pitchRange, speechMs: Math.round(speechMs) };
}

// ------------------------------------------------------------------ distance

/** How far apart one liftered coefficient's mean is, typically, for the same voice in two sentences. */
export const TIMBRE_SCALE = 4;
/** The same for the spreads. */
export const SPREAD_SCALE = 3;
/** The same for the median pitch, semitones. */
export const PITCH_SCALE = 2;

/**
 * How far apart two prints are: the root of a weighted mean of squares of the timbre (means), the spreads and the
 * pitch, each divided by its usual within-voice difference. About 1 for one voice, more for two.
 */
export function voiceDistance(a: VoicePrint, b: VoicePrint): number {
  let t = 0;
  for (let k = 0; k < N_CEP; k++) t += (a.mean[k] - b.mean[k]) ** 2;
  t = Math.sqrt(t / N_CEP) / TIMBRE_SCALE;
  let s = 0;
  for (let k = 0; k < N_CEP; k++) s += (a.spread[k] - b.spread[k]) ** 2;
  s = Math.sqrt(s / N_CEP) / SPREAD_SCALE;
  const parts: [number, number][] = [
    [t, 1],
    [s, 0.5],
  ];
  if (a.pitch !== null && b.pitch !== null) parts.push([Math.abs(a.pitch - b.pitch) / PITCH_SCALE, 1]);
  const w = parts.reduce((n, [, x]) => n + x, 0);
  return Math.sqrt(parts.reduce((n, [v, x]) => n + x * v * v, 0) / w);
}

/** The mean of several prints (a voice's centre): coefficient by coefficient; pitch over those that have one. */
export function meanPrint(prints: readonly VoicePrint[]): VoicePrint | null {
  if (!prints.length) return null;
  const avg = (pick: (p: VoicePrint) => number[]) => Array.from({ length: N_CEP }, (_, k) => prints.reduce((n, p) => n + pick(p)[k], 0) / prints.length);
  const pitched = prints.filter((p) => p.pitch !== null);
  return {
    mean: avg((p) => p.mean),
    spread: avg((p) => p.spread),
    pitch: pitched.length ? pitched.reduce((n, p) => n + p.pitch!, 0) / pitched.length : null,
    pitchRange: pitched.length ? pitched.reduce((n, p) => n + (p.pitchRange ?? 0), 0) / pitched.length : null,
    speechMs: prints.reduce((n, p) => n + p.speechMs, 0),
  };
}
