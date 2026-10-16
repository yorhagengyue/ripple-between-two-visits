/**
 * OpenAI-compatible chat client, ported from ripple-core src/lib/llm.ts (read-only reference). Serves OpenAI,
 * DeepSeek (the main model and the layer-3 checker since 10-09) and the other compatible vendors in index.ts.
 *
 * Kept from ripple-core: POST {baseUrl}/chat/completions with a Bearer key; bounded retries on a dropped socket,
 * a timeout or a retryable status (429/5xx) with exponential backoff and jitter, honouring Retry-After; other 4xx
 * fail fast; one failover call to a configured fallback provider when the primary is down (502/503/504); an
 * in-process concurrency cap; GPT-5.x needs `max_completion_tokens` instead of `max_tokens`.
 *
 * Changed for this app: no telemetry (ripple-core's recordLlmCall wrote to its production database); per-attempt
 * timeouts are configurable (LLM_TIMEOUT_MS, a per-call `timeoutMs`; the response body is read inside the same
 * timeout, so a stalled body cannot hang a request); attempts default to 2; the concurrency cap queues callers
 * (LLM_QUEUE_TIMEOUT_MS) instead of failing at once; `images` are sent as data-URL image parts; vendor body fields
 * come from `extraBody` (DeepSeek: `thinking: { type: "disabled" }`); every call is priced and written to the
 * spend ledger (spend.ts) and refused when the US$ cap would be passed; the reservation covers every attempt the
 * call may make, so charged retries cannot pass the cap. Keys are never logged, and neither error messages nor the
 * ledger carry prompt text.
 *
 * Deadlines: ChatOpts.signal is the caller's overall deadline (ask()'s total budget): when it aborts, the call stops
 * where it is (in the queue, mid-request or in a backoff), makes no further attempt and never fails over to another
 * vendor (LlmError "deadline"). CompatConfig.totalTimeoutMs bounds one whole call the same way (queue wait,
 * attempts and backoff together; LlmError "timeout"): the layer-3 checker uses it, so waiting for a slot counts
 * against CHECKER_TIMEOUT_MS. slotKey separates the concurrency queues (the checker does not queue behind the main
 * model).
 *
 * Privacy: a configured fallback receives the same prompt (the patient's words and his records) as the primary;
 * configure one only with a vendor that may process that data (see web/.env.example).
 *
 * Streaming (owner 10-15, SSE on every screen that waits for the model): with ChatOpts.onDelta the request asks for
 * `stream: true` and `stream_options.include_usage`; the event-stream body is read inside the same per-attempt timeout,
 * each content piece goes to onDelta as it comes (lib/sse/frames.ts parses the frames), and the completion body is
 * rebuilt from the pieces, so pricing, the ledger and the result are the same as for a plain call. The token counts come
 * from the last chunk; a stream that ends without it is charged its estimate (estimated: true). A failure before the
 * first piece is retried and may fail over as before; after it, never (the words are on his screen already). A vendor
 * that answers a streamed request with a plain body gives its content to onDelta once.
 */
import { createSseParser, EVENT_STREAM } from "@/lib/sse/frames";
import { estimateUsd, costUsd, getSpendLedger, type SpendLedger } from "./spend";
import { LlmError, type ChatOpts, type ChatResult, type ChatUsage, type LlmClient } from "./types";

export interface CompatConfig {
  /** provider name for logs and cassettes (openai, deepseek, gemini ...) */
  name: string;
  /** company behind the model */
  vendor: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  /** send response_format json_object when opts.json is set */
  jsonMode: boolean;
  /** per attempt; default LLM_TIMEOUT_MS or 20 s. ChatOpts.timeoutMs overrides it for one call */
  timeoutMs?: number;
  maxAttempts?: number;
  /** one failover target used when this provider is down */
  fallback?: CompatConfig | null;
  /** vendor-specific body fields merged into every request (DeepSeek: { thinking: { type: "disabled" } }) */
  extraBody?: Record<string, unknown>;
  /** parallel calls to this provider from this process; 0 = no cap. Default LLM_MAX_CONCURRENCY */
  maxConcurrency?: number;
  /** how long a call waits for a free slot before failing "busy"; default LLM_QUEUE_TIMEOUT_MS or 15 s */
  queueTimeoutMs?: number;
  /** concurrency queue this client waits in; default `name` (the checker gets its own) */
  slotKey?: string;
  /** upper bound for one whole call: queue wait, every attempt and the backoff between them (LlmError "timeout") */
  totalTimeoutMs?: number;
  /** spend ledger; undefined = the process ledger (spend.ts), null = none */
  ledger?: SpendLedger | null;
  /** floor for the completion budget (thinking mode spends tokens before the answer) */
  minMaxTokens?: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const PROVIDER_DOWN = new Set([502, 503, 504]);

type Env = Record<string, string | undefined>;

const positive = (v: string | undefined): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export function defaultTimeoutMs(env: Env = process.env): number {
  return positive(env.LLM_TIMEOUT_MS) ?? 20_000;
}

export function defaultMaxAttempts(env: Env = process.env): number {
  const n = positive(env.LLM_MAX_ATTEMPTS);
  return n ? Math.floor(n) : 2;
}

export function defaultMaxConcurrency(env: Env = process.env): number {
  const n = positive(env.LLM_MAX_CONCURRENCY);
  return n ? Math.floor(n) : 0;
}

export function defaultQueueTimeoutMs(env: Env = process.env): number {
  return positive(env.LLM_QUEUE_TIMEOUT_MS) ?? 15_000;
}

// ---- in-process concurrency cap (a counting semaphore per provider, callers wait in line) -----------------
interface Slots {
  active: number;
  waiters: (() => void)[];
}
type GlobalWithSlots = typeof globalThis & { __rippleLlmSlots?: Map<string, Slots> };

function slotsFor(key: string): Slots {
  const g = globalThis as GlobalWithSlots;
  g.__rippleLlmSlots ??= new Map();
  let s = g.__rippleLlmSlots.get(key);
  if (!s) {
    s = { active: 0, waiters: [] };
    g.__rippleLlmSlots.set(key, s);
  }
  return s;
}

/**
 * Wait for a slot (cap 0 = no cap). Resolves to the release function; rejects "busy" after waitMs, or with the
 * signal's error as soon as `signal` aborts (the waiter leaves the queue).
 */
export function acquireSlot(key: string, cap: number, waitMs: number, signal?: AbortSignal, onAbort?: () => Error): Promise<() => void> {
  const abortError = () => (onAbort ? onAbort() : new LlmError("deadline", `${key}: deadline reached while waiting for a model slot`, 504));
  if (signal?.aborted) return Promise.reject(abortError());
  if (!cap || cap <= 0) return Promise.resolve(() => {});
  const s = slotsFor(key);
  const release = () => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      s.active--;
      const next = s.waiters.shift();
      if (next) next();
    };
  };
  if (s.active < cap) {
    s.active++;
    return Promise.resolve(release());
  }
  return new Promise((resolve, reject) => {
    const leave = () => {
      const i = s.waiters.indexOf(waiter);
      if (i >= 0) s.waiters.splice(i, 1);
    };
    const aborted = () => {
      clearTimeout(timer);
      leave();
      reject(abortError());
    };
    const waiter = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      s.active++;
      resolve(release());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      leave();
      reject(new LlmError("busy", `${key}: all ${cap} model slots busy for ${waitMs} ms`, 503));
    }, waitMs);
    signal?.addEventListener("abort", aborted, { once: true });
    s.waiters.push(waiter);
  });
}

/** Calls in flight and waiting for one provider (tests, the backstage). */
export function slotStatus(key: string): { active: number; waiting: number } {
  const s = slotsFor(key);
  return { active: s.active, waiting: s.waiters.length };
}

type UserContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

/** The user message content: plain text, or text plus data-URL image parts when images are given. */
export function userContent(opts: ChatOpts): UserContent {
  if (!opts.images?.length) return opts.user;
  return [
    { type: "text", text: opts.user },
    ...opts.images.map((img) => ({ type: "image_url" as const, image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
  ];
}

/**
 * The JSON body sent to {baseUrl}/chat/completions (exported for tests; contains no key). With ChatOpts.onDelta the reply
 * streams (`stream: true`) and its last chunk carries the token counts (`stream_options.include_usage`).
 */
export function buildPayload(cfg: CompatConfig, opts: ChatOpts): Record<string, unknown> {
  return {
    model: cfg.model,
    temperature: opts.temperature ?? 0.2,
    ...(opts.maxTokens ? { [cfg.maxTokensField]: Math.max(opts.maxTokens, cfg.minMaxTokens ?? 0) } : {}),
    ...(opts.json && cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(cfg.extraBody ?? {}),
    ...(opts.onDelta ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: userContent(opts) },
    ],
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface RawReply {
  status: number;
  ok: boolean;
  text: string;
  attempts: number;
  /** attempts that ran into the timeout or were cut by the deadline (the vendor may still bill them) */
  timedOut: number;
  /** the reply came as an event stream: `text` is the completion body rebuilt from its chunks */
  streamed?: boolean;
  /** a streamed reply ended without the chunk that carries the token counts (the call is then charged its estimate) */
  noUsage?: boolean;
}

/** Where a streamed reply's pieces go, and how many have gone (none: a failure may still be retried). */
interface StreamTap {
  onDelta: (text: string) => void;
  emitted: number;
}

interface StreamChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: CompletionBody["usage"];
}

/**
 * Read an event-stream reply to its end: every content piece goes to the tap as it comes, and the completion body is
 * rebuilt from the pieces (content, finish_reason, and the usage of the last chunk), so the rest of the call reads it as
 * it reads a plain reply. A chunk that is not JSON is passed over (DeepSeek's keep-alive lines are comments already).
 */
async function readStream(resp: Response, tap: StreamTap): Promise<{ text: string; noUsage: boolean }> {
  let content = "";
  let finish: string | null = null;
  let usage: CompletionBody["usage"] | undefined;
  const parser = createSseParser((frame) => {
    if (frame.data === "[DONE]") return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(frame.data) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    const piece = choice?.delta?.content;
    if (typeof piece === "string" && piece) {
      content += piece;
      tap.emitted++;
      tap.onDelta(piece);
    }
  });
  const reader = resp.body?.getReader();
  if (!reader) {
    parser.push(await resp.text());
  } else {
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (value) parser.push(decoder.decode(value, { stream: true }));
      if (done) break;
    }
    parser.push(decoder.decode());
  }
  parser.end();
  const body: CompletionBody = { choices: [{ message: { content }, finish_reason: finish }], ...(usage ? { usage } : {}) };
  return { text: JSON.stringify(body), noUsage: !usage };
}

/** The signals one call runs under: `outer` aborts the call (the caller's deadline or totalTimeoutMs). */
interface CallSignals {
  outer?: AbortSignal;
  /** the caller's own deadline (ChatOpts.signal): its abort is "deadline", the total time bound's is "timeout" */
  caller?: AbortSignal;
}

/** Sleep that ends early when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** The error for a call stopped by its outer signal. */
function stoppedError(cfg: CompatConfig, sig: CallSignals, timedOut: number, attempts: number): LlmError {
  const err = sig.caller?.aborted
    ? new LlmError("deadline", `${cfg.name}: stopped at the caller's deadline`, 504)
    : new LlmError("timeout", `${cfg.name}: no answer within ${cfg.totalTimeoutMs} ms`, 504);
  Object.assign(err, { timedOut, attempts });
  return err;
}

const isTimeout = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
};

/** Short, content-free description of a network error (no request text, no key). */
function errorKind(e: unknown): string {
  if (isTimeout(e)) return "timeout";
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  return code ? String(code) : (e as Error)?.name ?? "error";
}

export function backoffMs(attempt: number, retryAfter: string | null, random: () => number = Math.random): number {
  const ra = Number(retryAfter);
  if (retryAfter && Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 8_000);
  return Math.min(400 * 2 ** (attempt - 1), 4_000) + Math.floor(random() * 250);
}

async function postChat(cfg: CompatConfig, payload: object, timeoutMs: number, fetchImpl: FetchLike, sig: CallSignals = {}, tap?: StreamTap): Promise<RawReply> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(payload),
  };
  const maxAttempts = Math.max(1, cfg.maxAttempts ?? defaultMaxAttempts());
  let lastErr: unknown;
  let timedOut = 0;
  let made = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (sig.outer?.aborted) throw stoppedError(cfg, sig, timedOut, made);
    made = attempt;
    try {
      // the timeout covers the headers and the body (DeepSeek keeps a slow request open with blank lines), a streamed
      // body to its last chunk
      const perAttempt = AbortSignal.timeout(timeoutMs);
      const resp = await fetchImpl(url, { ...init, signal: sig.outer ? AbortSignal.any([perAttempt, sig.outer]) : perAttempt });
      if (tap && resp.ok && (resp.headers.get("content-type") ?? "").toLowerCase().includes(EVENT_STREAM)) {
        const read = await readStream(resp, tap);
        return { status: resp.status, ok: true, text: read.text, attempts: attempt, timedOut, streamed: true, noUsage: read.noUsage };
      }
      const text = await resp.text();
      if (resp.ok || !RETRYABLE.has(resp.status) || attempt === maxAttempts) {
        return { status: resp.status, ok: resp.ok, text, attempts: attempt, timedOut };
      }
      lastErr = new LlmError("upstream", `${cfg.name} ${resp.status}`, 502);
      await sleep(backoffMs(attempt, resp.headers.get("retry-after")), sig.outer);
    } catch (e) {
      lastErr = e; // timeout / abort / dropped socket: the next attempt opens a new connection
      if (isTimeout(e) || sig.outer?.aborted) timedOut++;
      if (sig.outer?.aborted) throw Object.assign(stoppedError(cfg, sig, timedOut, made), tap?.emitted ? { emitted: true } : {});
      if (tap?.emitted) {
        // words of this reply are on his screen already: another attempt would write them a second time
        const err = isTimeout(e)
          ? new LlmError("timeout", `${cfg.name} timed out after ${timeoutMs} ms while streaming`, 504)
          : new LlmError("unreachable", `${cfg.name} stream broke off (${errorKind(e)})`, 504);
        throw Object.assign(err, { timedOut, attempts: made, emitted: true });
      }
      if (attempt < maxAttempts) await sleep(backoffMs(attempt, null), sig.outer);
    }
  }
  if (sig.outer?.aborted) throw stoppedError(cfg, sig, timedOut, made);
  if (isTimeout(lastErr)) {
    const err = new LlmError("timeout", `${cfg.name} timed out after ${timeoutMs} ms (${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"})`, 504);
    (err as LlmError & { timedOut?: number }).timedOut = timedOut;
    throw err;
  }
  const err = new LlmError("unreachable", `${cfg.name} unreachable (${errorKind(lastErr)})`, 504);
  (err as LlmError & { timedOut?: number }).timedOut = timedOut;
  throw err;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

interface CompletionBody {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export function parseUsage(body: CompletionBody): ChatUsage & { total: number } {
  const u = body.usage ?? {};
  const promptTokens = num(u.prompt_tokens);
  const cacheHitTokens = num(u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens);
  const cacheMissTokens = u.prompt_cache_miss_tokens !== undefined ? num(u.prompt_cache_miss_tokens) : Math.max(0, promptTokens - cacheHitTokens);
  const completionTokens = num(u.completion_tokens);
  const reasoningTokens = num(u.completion_tokens_details?.reasoning_tokens);
  return { promptTokens, cacheHitTokens, cacheMissTokens, completionTokens, reasoningTokens, total: num(u.total_tokens) || promptTokens + completionTokens };
}

/**
 * Upstream status -> error code and the status the failover logic reads. The message is the provider name and the
 * HTTP status only: the vendor's error body is text we do not control (it could echo part of the request), and this
 * message reaches safety_event.output.generationError and the server console (round-2 check).
 */
export function upstreamError(cfg: Pick<CompatConfig, "name">, status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError("auth", `${cfg.name} ${status}: API key rejected`, status);
  if (status === 402) return new LlmError("insufficient_balance", `${cfg.name} 402: account balance is used up`, 402);
  // 5xx and a 429 that survived the retries count as "provider down" (failover); other 4xx are our mistake
  const mapped = PROVIDER_DOWN.has(status) ? status : status >= 500 || status === 429 ? 503 : status;
  return new LlmError("upstream", `${cfg.name} ${status}: request failed`, mapped);
}

async function chatOnce(cfg: CompatConfig, opts: ChatOpts, fetchImpl: FetchLike, sig: CallSignals = {}): Promise<ChatResult> {
  if (!cfg.apiKey) throw new LlmError("not_configured", `${cfg.name}: API key not configured`, 503);
  const ledger = cfg.ledger === undefined ? getSpendLedger() : cfg.ledger;
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs ?? defaultTimeoutMs();
  const payload = buildPayload(cfg, opts);
  const estimate = estimateUsd(cfg.model, {
    text: opts.system + opts.user,
    images: opts.images?.length ?? 0,
    maxTokens: opts.maxTokens ? Math.max(opts.maxTokens, cfg.minMaxTokens ?? 0) : cfg.minMaxTokens,
  });
  // every attempt may be billed (a timed-out attempt is charged at its estimate), so hold one estimate per attempt
  const maxAttempts = Math.max(1, cfg.maxAttempts ?? defaultMaxAttempts());
  const release = ledger ? ledger.reserve(estimate * maxAttempts) : () => {};
  const t0 = Date.now();
  const purpose = opts.purpose ?? "other";
  const entryBase = { provider: cfg.name, model: cfg.model, purpose };
  const tap: StreamTap | undefined = opts.onDelta ? { onDelta: opts.onDelta, emitted: 0 } : undefined;
  try {
    let raw: RawReply;
    try {
      raw = await postChat(cfg, payload, timeoutMs, fetchImpl, sig, tap);
    } catch (e) {
      const timedOut = (e as { timedOut?: number }).timedOut ?? 0;
      const attempts = (e as { attempts?: number }).attempts;
      ledger?.record({
        at: new Date().toISOString(),
        ...entryBase,
        ok: false,
        error: e instanceof LlmError ? e.code : "error",
        attempts: attempts ?? maxAttempts,
        latency_ms: Date.now() - t0,
        prompt_tokens: 0,
        cache_hit_tokens: 0,
        cache_miss_tokens: 0,
        completion_tokens: 0,
        reasoning_tokens: 0,
        usd: timedOut * estimate,
        estimated: timedOut > 0,
      });
      throw e;
    }
    const latencyMs = Date.now() - t0;
    const timedOutUsd = raw.timedOut * estimate;
    if (!raw.ok) {
      const err = upstreamError(cfg, raw.status);
      ledger?.record({
        at: new Date().toISOString(),
        ...entryBase,
        ok: false,
        error: err.code,
        attempts: raw.attempts,
        latency_ms: latencyMs,
        prompt_tokens: 0,
        cache_hit_tokens: 0,
        cache_miss_tokens: 0,
        completion_tokens: 0,
        reasoning_tokens: 0,
        usd: timedOutUsd,
        estimated: raw.timedOut > 0,
      });
      throw err;
    }
    let data: CompletionBody;
    try {
      data = JSON.parse(raw.text) as CompletionBody;
    } catch {
      ledger?.record({
        at: new Date().toISOString(),
        ...entryBase,
        ok: false,
        error: "bad_response",
        attempts: raw.attempts,
        latency_ms: latencyMs,
        prompt_tokens: 0,
        cache_hit_tokens: 0,
        cache_miss_tokens: 0,
        completion_tokens: 0,
        reasoning_tokens: 0,
        // the vendor answered 200, so it may have billed the call: charge the estimate
        usd: estimate + timedOutUsd,
        estimated: true,
      });
      throw new LlmError("bad_response", `${cfg.name}: response is not JSON`, 502);
    }
    const usage = parseUsage(data);
    // a streamed reply whose last chunk (the token counts) never came is charged its estimate, as a timed-out attempt is
    const usd = (raw.noUsage ? estimate : costUsd(cfg.model, usage)) + timedOutUsd;
    ledger?.record({
      at: new Date().toISOString(),
      ...entryBase,
      ok: true,
      error: null,
      attempts: raw.attempts,
      latency_ms: latencyMs,
      prompt_tokens: usage.promptTokens,
      cache_hit_tokens: usage.cacheHitTokens,
      cache_miss_tokens: usage.cacheMissTokens,
      completion_tokens: usage.completionTokens,
      reasoning_tokens: usage.reasoningTokens,
      usd,
      estimated: raw.timedOut > 0 || !!raw.noUsage,
    });
    const choice = data?.choices?.[0];
    const { total, ...split } = usage;
    const content = choice?.message?.content ?? "";
    // asked to stream, answered in one piece (a vendor that ignores `stream`): the caller still gets the words, once
    if (tap && !raw.streamed && content) {
      tap.emitted++;
      tap.onDelta(content);
    }
    return {
      content,
      tokens: total,
      provider: cfg.name,
      model: cfg.model,
      attempts: raw.attempts,
      latencyMs,
      failedOver: false,
      usage: split,
      usd,
      finishReason: choice?.finish_reason ?? null,
      ...(tap ? { streamed: tap.emitted > 0 } : {}),
    };
  } finally {
    release();
  }
}

/** An OpenAI-compatible client. `fetchImpl` is for tests (no network in unit tests). */
export function createCompatClient(cfg: CompatConfig, fetchImpl: FetchLike = fetch): LlmClient {
  const cap = cfg.maxConcurrency ?? defaultMaxConcurrency();
  const queueMs = cfg.queueTimeoutMs ?? defaultQueueTimeoutMs();
  const slotKey = cfg.slotKey ?? cfg.name;
  return {
    provider: cfg.name,
    model: cfg.model,
    async chat(opts: ChatOpts) {
      const parts = [opts.signal, cfg.totalTimeoutMs ? AbortSignal.timeout(cfg.totalTimeoutMs) : undefined].filter((x): x is AbortSignal => !!x);
      const sig: CallSignals = { caller: opts.signal, outer: parts.length > 1 ? AbortSignal.any(parts) : parts[0] };
      const release = await acquireSlot(slotKey, cap, queueMs, sig.outer, () => stoppedError(cfg, sig, 0, 0));
      try {
        return await chatOnce(cfg, opts, fetchImpl, sig);
      } catch (e) {
        const fb = cfg.fallback;
        // never fail over once the caller's deadline or the call's own time bound has passed, nor once a streamed reply
        // has put words on his screen (the other vendor would start them again)
        const emitted = (e as { emitted?: boolean } | null)?.emitted === true;
        if (fb && fb.apiKey && e instanceof LlmError && e.code !== "deadline" && !sig.outer?.aborted && !emitted && PROVIDER_DOWN.has(e.status)) {
          console.warn(`[llm] ${cfg.name} down (${e.status}); failing over to ${fb.name}`);
          const res = await chatOnce(fb, opts, fetchImpl, sig);
          return { ...res, failedOver: true };
        }
        throw e;
      } finally {
        release();
      }
    },
  };
}
