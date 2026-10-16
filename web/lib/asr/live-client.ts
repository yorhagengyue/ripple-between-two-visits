/**
 * The browser side of live captions with SPEECH_PROVIDER=whisper or tencent (client-safe; no React).
 *
 * With tencent (`partials: false` from /api/asr/realtime-token) only whole lines are sent: each request there is a paid
 * recognition task, so the 2-3 s partial chunks are not sent at all and a caption appears when its line is done (the
 * token's delay_ms, longer than DELAY_MS, decides when the captions count as late).
 *
 * Microphone blocks -> (resample to 16 kHz if needed) -> LiveSegmenter -> chunks and lines -> WAV ->
 * POST /api/asr/chunk. Chunk answers grow the line's caption at once; a line's final answer carries the
 * stored utterance and the whole visit screen (cards). Finals queue ahead of chunks; chunks of a line whose
 * final is already queued are dropped. At most two requests are in flight.
 *
 * When the service is slow or busy:
 *   - "busy" (429): chunks are not sent until the server's retry_after_ms has passed (they would only add load
 *     to a full GPU queue); a final is sent again after max(retry_after_ms, 500 ms x 2^tries, capped at 4 s);
 *   - a final that our server cannot answer (network error, 503 without fallback) is retried the same way;
 *   - a final is given up after FINAL_BUDGET_MS from its first send: onLineLost() tells the page (the words are
 *     still in the recording, so the formal transcript at "End visit" has them);
 *   - onDelay(true) when a request has been waiting DELAY_MS, or the server says busy; onDelay(false) at the next
 *     answer with text. The server falls back by itself after WHISPER_BUSY_FALLBACK_MS of busy answers, which is
 *     shorter than FINAL_BUDGET_MS, so a final retried through a busy spell receives that fallback.
 * When the server says the Whisper service is down ({ fallback: true }), sending stops for good and
 * onFallback() tells the page (the replay, when there is one).
 *
 * The page hands over the blocks recorded before this client existed first (lib/asr/early-blocks.ts), so sample 0
 * here is the recording's sample 0: line spans are on the recording's clock, and nothing he said before the client
 * started is missing from the live captions.
 *
 * e2e hook: window.__rpLive records the recording clock (wall time of sample 0), how much audio was handed over
 * from before the client started (bufferedSamples, at attachedAt) and fed in all (inputSamples), and, per line, its
 * recording-time span, every caption shown with its wall time, and when the final arrived.
 */
import { encodeWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import { LiveSegmenter, StreamResampler, type ChunkPiece, type LinePiece, type LiveTuning } from "./segmenter";

export interface LiveCaption {
  id: string;
  text: string;
  t_start_ms: number;
}

export interface LiveFinal<View = unknown, Utterance = unknown> {
  line: string;
  view: View | null;
  utterances: Utterance[];
}

export interface LiveClientOptions<View = unknown, Utterance = unknown> {
  /** the demo session (?session=); null on an account's page, which the sign-in cookie names (C2) */
  sessionId: string | null;
  visitId: string;
  tuning: Partial<LiveTuning>;
  onCaption(c: LiveCaption): void;
  /** the line turned out to be silence or noise: remove its caption */
  onDrop(lineId: string): void;
  onFinal(f: LiveFinal<View, Utterance>): void;
  onFallback(reason: string, replay: string | null): void;
  /** captions are late (a slow or busy service) / on time again */
  onDelay?(delayed: boolean): void;
  /** a finished line could not be captioned (its final was given up); the recording still has it */
  onLineLost?(lineId: string): void;
  fetch?: typeof fetch;
  now?: () => number;
  /** base URL for tests (default: same origin) */
  base?: string;
  /** tests: DELAY_MS and FINAL_BUDGET_MS (delayMs also from the token: tencent's lines take 2-3 s) */
  delayMs?: number;
  finalBudgetMs?: number;
  /** send the 2-3 s partial chunks (whisper); false: whole lines only (tencent). Default true */
  partials?: boolean;
}

interface Job {
  kind: "chunk" | "final";
  lineId: string;
  lineStartMs: number;
  offsetMs: number;
  seq: number;
  samples: Float32Array;
  tries: number;
  /** wall time of the first send (finals: the retry budget counts from here) */
  firstSentAt: number | null;
}

export interface LiveLineTrace {
  startMs: number;
  endMs?: number;
  speechEndMs?: number;
  closedAt?: number;
  finalAt?: number;
  finalText?: string;
  /** the final was given up (FINAL_BUDGET_MS) */
  lostAt?: number;
  captions: { at: number; text: string }[];
}

export interface LiveTrace {
  visitId: string;
  /** wall time (ms) of recording sample 0: the earliest estimate over all blocks (now - audio received so far) */
  t0Wall: number | null;
  /** input samples (at the recorder's rate) fed so far, the early ones included */
  inputSamples: number;
  /** wall time the page attached this client, and how many recorder samples it handed over from before that */
  attachedAt: number | null;
  bufferedSamples: number;
  sampleRate: number;
  samples: number;
  lines: Record<string, LiveLineTrace>;
  /** offsetMs / durMs on the recording clock; sentAt / doneAt wall time */
  requests: { kind: string; line: string; offsetMs: number; durMs: number; sentAt: number; doneAt?: number; status?: number }[];
  fallback: { reason: string; at: number } | null;
}

declare global {
  interface Window {
    __rpLive?: LiveTrace;
  }
}

const MAX_IN_FLIGHT = 2;
/** a request waiting this long makes the captions "late" (the page says so) */
export const DELAY_MS = 2500;
/** a final is given up this long after its first send */
export const FINAL_BUDGET_MS = 20_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 4000;
const ms = (samples: number) => Math.round((samples / TARGET_SAMPLE_RATE) * 1000);

export class LiveWhisperClient<View = unknown, Utterance = unknown> {
  private readonly seg: LiveSegmenter;
  private resampler: StreamResampler | null = null;
  private readonly stamp: string;
  private readonly queue: Job[] = [];
  private inFlight = 0;
  /** finals waiting for their retry timer */
  private retrying = 0;
  private stopped = false;
  private fellBack = false;
  private delayed = false;
  /** no chunk leaves before this wall time (the server said busy) */
  private busyUntil = 0;
  /** input samples received so far, at the recorder's own rate (for the t0 estimate) */
  private inputSamples = 0;
  private readonly lineLang = new Map<string, string>();
  private readonly finalQueued = new Set<string>();
  private lastLang: string | null = null;
  private idle: (() => void)[] = [];
  readonly trace: LiveTrace;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: LiveClientOptions<View, Utterance>) {
    this.seg = new LiveSegmenter(opts.tuning, TARGET_SAMPLE_RATE);
    this.now = opts.now ?? (() => Date.now());
    this.stamp = this.now().toString(36);
    this.fetchImpl = opts.fetch ?? ((...a) => fetch(...a));
    this.trace = {
      visitId: opts.visitId,
      t0Wall: null,
      inputSamples: 0,
      attachedAt: null,
      bufferedSamples: 0,
      sampleRate: TARGET_SAMPLE_RATE,
      samples: 0,
      lines: {},
      requests: [],
      fallback: null,
    };
    if (typeof window !== "undefined") window.__rpLive = this.trace;
  }

  get active(): boolean {
    return !this.stopped && !this.fellBack;
  }

  private lineId(n: number): string {
    return `${this.opts.visitId}-w${this.stamp}-${n}`;
  }

  /** The page attached this client after handing over `bufferedSamples` recorded before it existed. */
  markAttached(bufferedSamples: number): void {
    this.trace.attachedAt = this.now();
    this.trace.bufferedSamples = bufferedSamples;
  }

  /** One block from the recorder (any sample rate). */
  feed(block: Float32Array, sampleRate: number): void {
    if (!this.active) return;
    // blocks reach the main thread late and in bursts: the earliest "now - audio so far" is the best clock
    // (blocks handed over from before the client existed give late estimates, which the minimum ignores)
    this.inputSamples += block.length;
    this.trace.inputSamples = this.inputSamples;
    const t0 = this.now() - (this.inputSamples / sampleRate) * 1000;
    if (this.trace.t0Wall === null || t0 < this.trace.t0Wall) this.trace.t0Wall = t0;
    let data = block;
    if (sampleRate !== TARGET_SAMPLE_RATE) {
      if (!this.resampler || this.resampler.fromRate !== sampleRate) this.resampler = new StreamResampler(sampleRate, TARGET_SAMPLE_RATE);
      data = this.resampler.push(block);
    }
    const pieces = this.seg.push(data);
    this.trace.samples = this.seg.position;
    for (const p of pieces) this.take(p);
    this.pump();
  }

  /** Pause: the line in progress ends here. */
  pause(): void {
    if (!this.active) return;
    for (const p of this.seg.flush()) this.take(p);
    this.pump();
  }

  /** End of the visit: close the line, wait (at most timeoutMs) for the queued finals, then stop. */
  async stop(timeoutMs = 3000): Promise<void> {
    if (this.active) {
      for (const p of this.seg.flush()) this.take(p);
      // chunks are not worth waiting for any more; finals are
      for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].kind === "chunk") this.queue.splice(i, 1);
      this.pump();
      if (!this.isIdle()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          this.idle.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    }
    this.stopped = true;
    this.queue.length = 0;
    this.setDelayed(false);
  }

  private isIdle(): boolean {
    return this.inFlight === 0 && this.queue.length === 0 && this.retrying === 0;
  }

  private wakeIdle(): void {
    if (!this.isIdle()) return;
    for (const w of this.idle.splice(0)) w();
  }

  private setDelayed(on: boolean): void {
    if (this.delayed === on) return;
    this.delayed = on;
    try {
      this.opts.onDelay?.(on);
    } catch {
      // the page's notice must not break the captions
    }
  }

  private take(p: ChunkPiece | LinePiece): void {
    const lineId = this.lineId(p.line);
    if (p.type === "chunk") {
      this.trace.lines[lineId] ??= { startMs: ms(p.lineStart), captions: [] };
      // whole lines only (tencent): the line's final carries its caption
      if (this.opts.partials === false) return;
      if (this.finalQueued.has(lineId)) return;
      this.queue.push({ kind: "chunk", lineId, lineStartMs: ms(p.lineStart), offsetMs: ms(p.start), seq: p.seq, samples: p.samples, tries: 0, firstSentAt: null });
    } else {
      const t = (this.trace.lines[lineId] ??= { startMs: ms(p.start), captions: [] });
      t.endMs = ms(p.end);
      t.speechEndMs = ms(p.speechEnd);
      t.closedAt = this.now();
      this.finalQueued.add(lineId);
      // chunks of this line that have not left yet are superseded by the final
      for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].kind === "chunk" && this.queue[i].lineId === lineId) this.queue.splice(i, 1);
      this.queue.push({ kind: "final", lineId, lineStartMs: ms(p.start), offsetMs: ms(p.start), seq: p.chunks + 1, samples: p.samples, tries: 0, firstSentAt: null });
    }
  }

  private next(): Job | undefined {
    const f = this.queue.findIndex((j) => j.kind === "final");
    if (f >= 0) return this.queue.splice(f, 1)[0];
    // while the service is busy, live chunks are dropped rather than sent into a full queue
    while (this.queue.length && this.now() < this.busyUntil) this.queue.shift();
    return this.queue.shift();
  }

  private pump(): void {
    while (!this.fellBack && !this.stopped && this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const job = this.next();
      if (!job) break;
      this.inFlight += 1;
      void this.send(job).finally(() => {
        this.inFlight -= 1;
        this.pump();
        this.wakeIdle();
      });
    }
    this.wakeIdle();
  }

  /** A final is tried again after a backoff, within FINAL_BUDGET_MS of its first send; then it is lost. */
  private retry(job: Job, retryAfterMs: number | null): void {
    if (job.kind !== "final" || this.stopped || this.fellBack) return;
    const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** job.tries);
    const delay = Math.max(retryAfterMs ?? 0, backoff);
    if (job.firstSentAt !== null && this.now() + delay - job.firstSentAt > (this.opts.finalBudgetMs ?? FINAL_BUDGET_MS)) {
      this.lose(job.lineId);
      return;
    }
    job.tries += 1;
    this.retrying += 1;
    setTimeout(() => {
      this.retrying -= 1;
      if (this.stopped || this.fellBack) {
        this.wakeIdle();
        return;
      }
      this.queue.unshift(job);
      this.pump();
    }, delay);
  }

  private lose(lineId: string): void {
    const t = this.trace.lines[lineId];
    if (t) t.lostAt = this.now();
    try {
      this.opts.onLineLost?.(lineId);
    } catch {
      // the page's notice must not break the captions
    }
  }

  private async send(job: Job): Promise<void> {
    const params = new URLSearchParams({
      ...(this.opts.sessionId ? { session: this.opts.sessionId } : {}),
      visit_id: this.opts.visitId,
      kind: job.kind,
      line: job.lineId,
      offset_ms: String(job.offsetMs),
      seq: String(job.seq),
      line_start_ms: String(job.lineStartMs),
    });
    const hint = this.lineLang.get(job.lineId) ?? this.lastLang;
    if (hint === "en" || hint === "zh") params.set("lang_hint", hint);
    const wav = encodeWav(job.samples, TARGET_SAMPLE_RATE);
    const rec: LiveTrace["requests"][number] = { kind: job.kind, line: job.lineId, offsetMs: job.offsetMs, durMs: ms(job.samples.length), sentAt: this.now() };
    job.firstSentAt ??= rec.sentAt;
    this.trace.requests.push(rec);
    if (this.trace.requests.length > 500) this.trace.requests.splice(0, this.trace.requests.length - 500);
    const slow = setTimeout(() => {
      if (rec.doneAt === undefined && this.active) this.setDelayed(true);
    }, this.opts.delayMs ?? DELAY_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.base ?? ""}/api/asr/chunk?${params}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav.buffer as ArrayBuffer,
        credentials: "same-origin",
        signal: AbortSignal.timeout(job.kind === "final" ? 15_000 : 6_000),
      });
    } catch {
      clearTimeout(slow);
      rec.doneAt = this.now();
      // our own server did not answer: a final is tried again, a chunk is dropped
      if (this.active) this.setDelayed(true);
      this.retry(job, null);
      return;
    }
    clearTimeout(slow);
    rec.doneAt = this.now();
    rec.status = res.status;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 200) {
      this.setDelayed(false);
      if (body.ignored) return;
      const lang = typeof body.lang === "string" ? body.lang : null;
      if (lang) {
        this.lineLang.set(job.lineId, lang);
        this.lastLang = lang;
      }
      const trace = (this.trace.lines[job.lineId] ??= { startMs: job.lineStartMs, captions: [] });
      if (job.kind === "chunk") {
        const text = typeof body.text === "string" ? body.text : "";
        if (!text || (this.finalQueued.has(job.lineId) && trace.finalAt)) return;
        trace.captions.push({ at: this.now(), text });
        this.opts.onCaption({ id: job.lineId, text, t_start_ms: job.lineStartMs });
        return;
      }
      const utterances = Array.isArray(body.utterances) ? (body.utterances as Utterance[]) : [];
      trace.finalAt = this.now();
      if (!utterances.length) {
        trace.finalText = "";
        this.opts.onDrop(job.lineId);
        return;
      }
      trace.finalText = String((utterances[0] as { text?: unknown }).text ?? "");
      trace.captions.push({ at: trace.finalAt, text: trace.finalText });
      this.opts.onFinal({ line: job.lineId, view: (body.view ?? null) as View | null, utterances });
      return;
    }
    if ((res.status === 503 || res.status === 409) && body.fallback === true) {
      this.fellBack = true;
      this.queue.length = 0;
      this.setDelayed(false);
      const reason = typeof body.reason === "string" ? body.reason : "unavailable";
      this.trace.fallback = { reason, at: this.now() };
      this.opts.onFallback(reason, typeof body.replay === "string" ? body.replay : null);
      return;
    }
    if (res.status === 409 && body.error === "not_recording") {
      this.stopped = true;
      this.queue.length = 0;
      this.setDelayed(false);
      return;
    }
    if (res.status === 429 || res.status === 503) {
      const fromBody = typeof body.retry_after_ms === "number" && Number.isFinite(body.retry_after_ms) ? body.retry_after_ms : null;
      const fromHeader = Number(res.headers.get("retry-after"));
      const retryAfter = fromBody ?? (Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader * 1000 : null);
      if (res.status === 429) this.busyUntil = this.now() + Math.min(retryAfter ?? 1000, 10_000);
      this.setDelayed(true);
      this.retry(job, retryAfter);
      return;
    }
    // any other 4xx: a bad request is not retried (it would fail the same way); a final is then lost
    if (job.kind === "final") this.lose(job.lineId);
  }
}
