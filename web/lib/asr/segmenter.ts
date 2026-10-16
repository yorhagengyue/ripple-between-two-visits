/**
 * Live caption segmentation for SPEECH_PROVIDER=whisper (client-safe, no DOM): microphone samples (16 kHz
 * mono float) in, two kinds of pieces out.
 *
 *   chunk  2-3 s of speech, cut at a pause of at least `chunkGapMs` once it holds `minChunkMs`, or at the
 *          quietest 20 ms frame of the last second when it reaches `maxChunkMs`. Never cut inside a word on
 *          purpose: a chunk boundary is a pause or the quietest moment. Transcribed by large-v3-turbo and
 *          shown at once as the growing caption of the line.
 *   line   speech up to a pause of `lineGapMs` (the end of a sentence or a turn), at most `maxLineMs`. The
 *          whole line is transcribed once more (better than the chunks glued together) and becomes one
 *          utterance: stored, roles inferred, items extracted, cards shown.
 *
 * Speech detection is energy based with a noise floor that follows the room (falls fast, rises slowly), so
 * a fan or a clinic hum does not count as speech. Silent stretches are never sent (Whisper invents
 * "Thank you." on silence).
 *
 * All positions are sample indexes since the recorder started (the recording's own clock, which stops
 * while paused), so live lines and the whole-visit transcript share one time line.
 */

export interface LiveTuning {
  chunkGapMs: number;
  minChunkMs: number;
  maxChunkMs: number;
  lineGapMs: number;
  maxLineMs: number;
  preRollMs: number;
}

export const DEFAULT_LIVE_TUNING: LiveTuning = {
  chunkGapMs: 240,
  minChunkMs: 1000,
  maxChunkMs: 3000,
  lineGapMs: 550,
  maxLineMs: 25_000,
  preRollMs: 200,
};

/** Clamp a tuning received from the server to sane ranges. */
export function liveTuning(raw: Partial<LiveTuning> | null | undefined): LiveTuning {
  const t = { ...DEFAULT_LIVE_TUNING, ...(raw ?? {}) };
  const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  const out: LiveTuning = {
    chunkGapMs: clamp(t.chunkGapMs, 100, 1000, DEFAULT_LIVE_TUNING.chunkGapMs),
    minChunkMs: clamp(t.minChunkMs, 300, 5000, DEFAULT_LIVE_TUNING.minChunkMs),
    maxChunkMs: clamp(t.maxChunkMs, 1000, 10_000, DEFAULT_LIVE_TUNING.maxChunkMs),
    lineGapMs: clamp(t.lineGapMs, 200, 3000, DEFAULT_LIVE_TUNING.lineGapMs),
    maxLineMs: clamp(t.maxLineMs, 3000, 28_000, DEFAULT_LIVE_TUNING.maxLineMs),
    preRollMs: clamp(t.preRollMs, 0, 1000, DEFAULT_LIVE_TUNING.preRollMs),
  };
  if (out.minChunkMs > out.maxChunkMs) out.minChunkMs = out.maxChunkMs;
  if (out.chunkGapMs > out.lineGapMs) out.chunkGapMs = out.lineGapMs;
  return out;
}

export interface ChunkPiece {
  type: "chunk";
  line: number;
  seq: number;
  /** where the line started (sample index) */
  lineStart: number;
  start: number;
  end: number;
  samples: Float32Array;
}

export interface LinePiece {
  type: "line";
  line: number;
  start: number;
  end: number;
  /** voiced end (the last frame above the speech threshold) */
  speechEnd: number;
  samples: Float32Array;
  chunks: number;
}

export type Piece = ChunkPiece | LinePiece;

const FRAME_MS = 20;
const ONSET_FRAMES = 3; // 60 ms above the speech threshold starts a line
const MIN_VOICED_MS = 120; // a chunk with less voiced audio than this is not sent
// a line with less speech (a click, a tap on the table) is dropped; a short answer ("对。", "Yes.", ~200 ms) is kept
const MIN_LINE_VOICED_MS = 140;
const TAIL_MS = 120; // keep this much of the pause at the end of a chunk
const LINE_TAIL_MS = 200;
const FLOOR_MIN = 0.0003;
const FLOOR_MAX = 0.05;
const CALIBRATION_FRAMES = 10; // the first 200 ms set the starting noise floor
const FLOOR_RISE = 1.004; // per 20 ms frame: about 22 % a second
const FLOOR_WINDOW = 75; // the floor never rises above the quietest frame of the last 1.5 s

export class LiveSegmenter {
  readonly sampleRate: number;
  readonly tuning: LiveTuning;
  private readonly frame: number;
  // samples kept: from `bufStart` (absolute index) on
  private buf: Float32Array = new Float32Array(16_000 * 4);
  private bufLen = 0;
  private bufStart = 0;
  private pending: Float32Array = new Float32Array(0); // samples not yet framed
  private pos = 0; // absolute index of the next sample to frame
  private floor = 0.002;
  private calibration: number[] = [];
  private recent: number[] = [];
  private onset = 0;
  private inLine = false;
  private lineNo = 0;
  private lineStart = 0;
  private chunkStart = 0;
  private chunkSeq = 0;
  private chunkVoiced = 0; // voiced samples in the current chunk
  private lineVoiced = 0; // voiced samples in the current line
  private lastVoicedEnd = 0;
  private silentFrames = 0;
  private frameRms: { at: number; rms: number }[] = []; // frames of the current chunk (for the quietest cut)

  constructor(tuning: Partial<LiveTuning> = {}, sampleRate = 16_000) {
    this.sampleRate = sampleRate;
    this.tuning = liveTuning(tuning);
    this.frame = Math.round((sampleRate * FRAME_MS) / 1000);
  }

  private ms(n: number): number {
    return Math.round((n * this.sampleRate) / 1000);
  }

  /** samples consumed so far (the recording clock) */
  get position(): number {
    return this.pos + this.pending.length;
  }

  get speaking(): boolean {
    return this.inLine;
  }

  /** the noise floor estimate (RMS), for tests and diagnostics */
  get noiseFloor(): number {
    return this.floor;
  }

  private append(block: Float32Array): void {
    if (this.bufLen + block.length > this.buf.length) {
      const next = new Float32Array(Math.max(this.buf.length * 2, this.bufLen + block.length));
      next.set(this.buf.subarray(0, this.bufLen));
      this.buf = next;
    }
    this.buf.set(block, this.bufLen);
    this.bufLen += block.length;
  }

  private slice(from: number, to: number): Float32Array {
    const a = Math.max(from, this.bufStart) - this.bufStart;
    const b = Math.min(to, this.bufStart + this.bufLen) - this.bufStart;
    return b > a ? this.buf.slice(a, b) : new Float32Array(0);
  }

  /** forget samples before `keepFrom` */
  private trim(keepFrom: number): void {
    const drop = Math.min(this.bufLen, Math.max(0, keepFrom - this.bufStart));
    if (drop <= 0) return;
    this.buf.copyWithin(0, drop, this.bufLen);
    this.bufLen -= drop;
    this.bufStart += drop;
  }

  push(block: Float32Array): Piece[] {
    const out: Piece[] = [];
    this.append(block);
    let data = block;
    if (this.pending.length) {
      data = new Float32Array(this.pending.length + block.length);
      data.set(this.pending);
      data.set(block, this.pending.length);
    }
    let i = 0;
    for (; i + this.frame <= data.length; i += this.frame) {
      let sum = 0;
      for (let k = i; k < i + this.frame; k++) sum += data[k] * data[k];
      this.onFrame(Math.sqrt(sum / this.frame), out);
      this.pos += this.frame;
    }
    this.pending = data.slice(i);
    if (!this.inLine) this.trim(this.pos - this.ms(this.tuning.preRollMs) - this.frame * ONSET_FRAMES);
    return out;
  }

  /** Close the current line now (pause, end of visit). */
  flush(): Piece[] {
    const out: Piece[] = [];
    if (this.inLine) this.closeLine(out, this.lastVoicedEnd + this.ms(LINE_TAIL_MS));
    return out;
  }

  private onFrame(rms: number, out: Piece[]): void {
    const frameStart = this.pos;
    const frameEnd = this.pos + this.frame;
    // noise floor: the first 200 ms set it (the room before anyone speaks); then it falls quickly to
    // quieter frames and rises slowly (about 22 % a second), so a steady hum stops counting as speech
    if (this.calibration.length < CALIBRATION_FRAMES) {
      this.calibration.push(rms);
      if (this.calibration.length === CALIBRATION_FRAMES) {
        const sorted = [...this.calibration].sort((a, b) => a - b);
        this.floor = Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, sorted[Math.floor(sorted.length / 2)]));
      }
    }
    this.recent.push(rms);
    if (this.recent.length > FLOOR_WINDOW) this.recent.shift();
    if (this.calibration.length >= CALIBRATION_FRAMES) {
      if (rms < this.floor) this.floor = Math.max(FLOOR_MIN, 0.7 * this.floor + 0.3 * rms);
      else {
        // words have gaps: the quietest frame of the last 1.5 s is the room, not the voice
        let quietest = Infinity;
        for (const r of this.recent) if (r < quietest) quietest = r;
        this.floor = Math.min(FLOOR_MAX, quietest, this.floor * FLOOR_RISE);
        if (this.floor < FLOOR_MIN) this.floor = FLOOR_MIN;
      }
    }
    const onThr = Math.max(this.floor * 4, 0.006);
    const offThr = Math.max(this.floor * 2.5, 0.004);

    if (!this.inLine) {
      if (this.calibration.length < CALIBRATION_FRAMES) return; // still learning the room
      this.onset = rms > onThr ? this.onset + 1 : 0;
      if (this.onset >= ONSET_FRAMES) {
        this.inLine = true;
        this.lineNo += 1;
        this.chunkSeq = 0;
        const start = Math.max(0, frameStart - this.frame * (ONSET_FRAMES - 1) - this.ms(this.tuning.preRollMs));
        this.lineStart = Math.max(start, this.bufStart);
        this.chunkStart = this.lineStart;
        this.chunkVoiced = this.frame * ONSET_FRAMES;
        this.lineVoiced = this.frame * ONSET_FRAMES;
        this.lastVoicedEnd = frameEnd;
        this.silentFrames = 0;
        this.frameRms = [];
        this.onset = 0;
      }
      return;
    }

    this.frameRms.push({ at: frameStart, rms });
    if (rms > offThr) {
      this.silentFrames = 0;
      this.lastVoicedEnd = frameEnd;
      this.chunkVoiced += this.frame;
      this.lineVoiced += this.frame;
    } else {
      this.silentFrames += 1;
    }
    const silenceMs = this.silentFrames * FRAME_MS;

    // end of the line: a long enough pause
    if (silenceMs >= this.tuning.lineGapMs) {
      this.closeLine(out, Math.min(frameEnd, this.lastVoicedEnd + this.ms(LINE_TAIL_MS)));
      return;
    }
    // a chunk at a short pause, once it holds enough speech
    const chunkLen = this.lastVoicedEnd - this.chunkStart;
    if (silenceMs >= this.tuning.chunkGapMs && this.silentFrames * FRAME_MS - FRAME_MS < this.tuning.chunkGapMs && chunkLen >= this.ms(this.tuning.minChunkMs)) {
      this.emitChunk(out, this.lastVoicedEnd + this.ms(TAIL_MS));
    } else if (frameEnd - this.chunkStart >= this.ms(this.tuning.maxChunkMs)) {
      // too long without a pause: cut at the quietest frame of the last second
      const from = frameEnd - this.ms(1000);
      let best: { at: number; rms: number } | null = null;
      for (const f of this.frameRms) if (f.at >= from && (!best || f.rms < best.rms)) best = f;
      const cut = best && best.at > this.chunkStart + this.ms(300) ? best.at + Math.round(this.frame / 2) : frameEnd;
      this.emitChunk(out, cut);
    }
    // a very long line: close it at the last chunk cut and go on in a new line
    if (this.inLine && frameEnd - this.lineStart >= this.ms(this.tuning.maxLineMs)) {
      const cut = this.chunkStart > this.lineStart + this.ms(1000) ? this.chunkStart : frameEnd;
      if (cut === frameEnd) this.emitChunk(out, frameEnd);
      this.emitLine(out, cut);
      // the speech goes on: a new line starts at the cut
      this.inLine = true;
      this.lineNo += 1;
      this.chunkSeq = 0;
      this.lineStart = cut;
      this.lineVoiced = 0;
      this.chunkStart = Math.max(this.chunkStart, cut);
      this.frameRms = this.frameRms.filter((f) => f.at >= cut);
    }
  }

  private emitChunk(out: Piece[], end: number): void {
    const stop = Math.min(end, this.pos + this.frame);
    if (stop <= this.chunkStart) return;
    if (this.chunkVoiced >= this.ms(MIN_VOICED_MS)) {
      out.push({
        type: "chunk",
        line: this.lineNo,
        seq: ++this.chunkSeq,
        lineStart: this.lineStart,
        start: this.chunkStart,
        end: stop,
        samples: this.slice(this.chunkStart, stop),
      });
    }
    this.chunkStart = stop;
    this.chunkVoiced = 0;
    this.frameRms = this.frameRms.filter((f) => f.at >= stop);
  }

  private emitLine(out: Piece[], end: number): void {
    const stop = Math.min(end, this.pos + this.frame);
    // chunks of this line already handed out in an earlier batch (their captions need the line's final)
    const earlier = this.chunkSeq - out.filter((p) => p.type === "chunk" && p.line === this.lineNo).length;
    if (this.lineVoiced < this.ms(MIN_LINE_VOICED_MS) && earlier === 0) {
      // too little speech to be a word (a click, a tap): drop the line and its chunks
      for (let i = out.length - 1; i >= 0; i--) if (out[i].line === this.lineNo) out.splice(i, 1);
      return;
    }
    out.push({
      type: "line",
      line: this.lineNo,
      start: this.lineStart,
      end: stop,
      speechEnd: Math.min(this.lastVoicedEnd, stop),
      samples: this.slice(this.lineStart, stop),
      chunks: this.chunkSeq,
    });
  }

  private closeLine(out: Piece[], end: number): void {
    // the last words of the line, if no chunk carried them yet
    if (this.lastVoicedEnd > this.chunkStart) this.emitChunk(out, Math.min(end, this.lastVoicedEnd + this.ms(TAIL_MS)));
    this.emitLine(out, end);
    this.inLine = false;
    this.onset = 0;
    this.silentFrames = 0;
    this.frameRms = [];
    this.trim(this.pos - this.ms(this.tuning.preRollMs));
  }
}

/** Streaming linear resampler (for a browser that will not open a 16 kHz AudioContext). */
export class StreamResampler {
  private carry: number | null = null;
  private t = 0; // position of the next output sample, in input samples, relative to the current block

  constructor(
    readonly fromRate: number,
    readonly toRate = 16_000,
  ) {}

  push(input: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return input;
    const ratio = this.fromRate / this.toRate;
    // virtual block: [carry, ...input]; index 0 is the carry when present
    const offset = this.carry === null ? 0 : 1;
    const at = (j: number) => (j < offset ? (this.carry as number) : input[j - offset]);
    const len = input.length + offset;
    const out: number[] = [];
    let t = this.t;
    while (t + 1 < len) {
      const j = Math.floor(t);
      const frac = t - j;
      out.push(at(j) + (at(j + 1) - at(j)) * frac);
      t += ratio;
    }
    this.carry = input.length ? input[input.length - 1] : this.carry;
    this.t = t - (len - 1);
    return Float32Array.from(out);
  }
}
