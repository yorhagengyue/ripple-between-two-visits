/**
 * The microphone's first blocks, before the live captions are ready (client-safe; no React).
 *
 * The recorder starts when he consents; the live Whisper client can only start once POST /api/asr/realtime-token
 * has answered, which first asks the service's /health (up to WHISPER_HEALTH_TIMEOUT_MS, 1.5 s). Whatever he says
 * in between is in the recording but would never reach the live captions, and the live client's sample 0 would
 * not be the recording's sample 0 (its clock would run late by that gap). So the page keeps those blocks here and
 * hands them to the live client first, in order, when it starts.
 *
 * Bounded: past `maxMs` the oldest blocks are dropped and handed over as silence of the same length, so the live
 * client's clock still matches the recording's.
 *
 * BlockClock is the recorder's own clock: the wall time of the recording's sample 0, estimated as the earliest
 * "arrival time - audio received so far" over all blocks (blocks reach the main thread late and in bursts, never
 * early). e2e reads it as window.__rpRecorder.
 */

export interface Block {
  block: Float32Array;
  rate: number;
}

export class EarlyBlocks {
  private blocks: Block[] = [];
  private keptMs = 0;
  /** samples dropped from the front (at droppedRate) */
  private dropped = 0;
  private droppedRate = 0;

  constructor(readonly maxMs = 60_000) {}

  get bufferedMs(): number {
    return this.keptMs + (this.droppedRate ? (this.dropped / this.droppedRate) * 1000 : 0);
  }

  push(block: Float32Array, rate: number): void {
    if (!block.length || !(rate > 0)) return;
    this.blocks.push({ block, rate });
    this.keptMs += (block.length / rate) * 1000;
    while (this.keptMs > this.maxMs && this.blocks.length > 1) {
      const old = this.blocks.shift()!;
      this.keptMs -= (old.block.length / old.rate) * 1000;
      // one recording has one sample rate (its AudioContext's)
      this.droppedRate = old.rate;
      this.dropped += old.block.length;
    }
  }

  /**
   * Hand everything over, oldest first: dropped audio as silence of the same length, then the kept blocks.
   * Returns how many input samples were handed over. The buffer is empty afterwards.
   */
  drain(feed: (block: Float32Array, rate: number) => void): number {
    let samples = 0;
    if (this.dropped > 0) {
      const piece = 4096;
      for (let left = this.dropped; left > 0; left -= piece) {
        const n = Math.min(piece, left);
        feed(new Float32Array(n), this.droppedRate);
        samples += n;
      }
    }
    for (const b of this.blocks) {
      feed(b.block, b.rate);
      samples += b.block.length;
    }
    this.clear();
    return samples;
  }

  clear(): void {
    this.blocks = [];
    this.keptMs = 0;
    this.dropped = 0;
    this.droppedRate = 0;
  }
}

export interface RecorderClockTrace {
  /** wall time (ms) of the recording's sample 0 */
  t0Wall: number | null;
  /** audio received so far, ms, and in samples at the recorder's rate */
  receivedMs: number;
  samples: number;
  blocks: number;
}

export class BlockClock {
  readonly trace: RecorderClockTrace = { t0Wall: null, receivedMs: 0, samples: 0, blocks: 0 };

  observe(samples: number, rate: number, now: number): void {
    if (!(rate > 0)) return;
    this.trace.receivedMs += (samples / rate) * 1000;
    this.trace.samples += samples;
    this.trace.blocks += 1;
    const t0 = now - this.trace.receivedMs;
    if (this.trace.t0Wall === null || t0 < this.trace.t0Wall) this.trace.t0Wall = t0;
  }
}
