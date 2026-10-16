/**
 * Model client interface (docs/plan/spec.md section 4).
 *
 *   interface LlmClient {
 *     chat(opts: { system; user; json?; temperature?; maxTokens?; images?: { mime; base64 }[] })
 *       : Promise<{ content: string; tokens: number }>;
 *   }
 *
 * Implementations: openai.ts (HTTP, ported from ripple-core src/lib/llm.ts; serves Tencent Cloud Hunyuan through
 * hunyuan.ts, OpenAI and the OpenAI-compatible vendors), replay.ts (cassettes in web/fixtures/cassettes), mock.ts
 * (deterministic, no network). Server-only.
 * Streaming is an option of the same call (ChatOpts.onDelta), not a method of its own, so every wrapper that rebuilds a
 * client from provider, model and chat (the pipeline's spend counter, PersonSpend.wrap, withRecording) passes it on.
 */

export interface ChatImage {
  mime: string; // image/png, image/jpeg
  base64: string; // no data: prefix
}

/** What a call is for: written to the spend ledger (never the prompt itself). */
export type LlmPurpose = "classify" | "crisis" | "compose" | "support" | "vision" | "extract" | "explain" | "gloss" | "summary" | "general" | "crisis_words" | "probe" | "other";

export interface ChatOpts {
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  images?: ChatImage[];
  /** per-call timeout for one attempt (vision and whole-visit extraction need longer than a short answer) */
  timeoutMs?: number;
  purpose?: LlmPurpose;
  /**
   * The caller's overall deadline (ask()'s total time budget). When it aborts, the call stops at once: no further
   * attempt, no failover to another vendor, LlmError "deadline". Mock and replay clients answer at once and ignore it.
   */
  signal?: AbortSignal;
  /**
   * Streaming (owner 10-15: 「需要非常完整的 SSE 的输出」): the reply's content, piece by piece, as the model writes it (raw
   * content, so a JSON-mode reply arrives as fragments of its JSON; lib/sse/json-field.ts reads one string field out of
   * them). The call still resolves to the whole ChatResult, spend counted as for any call. A client that cannot stream
   * (replay) calls it once with the whole content; ChatResult.streamed says whether it was called at all. Once a piece
   * has gone out, a failure is not retried and never fails over (the caller would see the words twice).
   */
  onDelta?: (text: string) => void;
}

/** Token split as the vendor reports it (cached prompt tokens where the vendor reports them, Hunyuan's CachedTokens). */
export interface ChatUsage {
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export interface ChatResult {
  content: string;
  tokens: number;
  // extensions (all optional so a plain { content, tokens } satisfies the spec shape)
  provider?: string;
  model?: string;
  attempts?: number;
  latencyMs?: number;
  failedOver?: boolean;
  /** replay: the cassette file that answered */
  cassette?: string;
  usage?: ChatUsage;
  /** cost of this call at the price table's (peak) prices, US$ */
  usd?: number;
  /** "stop", "length" (cut off: JSON is then incomplete) ... */
  finishReason?: string | null;
  /** ChatOpts.onDelta was called with the content (in pieces, or once with all of it) */
  streamed?: boolean;
}

export interface LlmClient {
  /** provider name as configured: hunyuan, openai, gemini, replay:hunyuan, mock ... */
  readonly provider: string;
  readonly model: string;
  chat(opts: ChatOpts): Promise<ChatResult>;
}

export type LlmErrorCode =
  | "not_configured"
  | "unreachable"
  | "timeout"
  | "upstream"
  | "auth"
  | "insufficient_balance"
  | "busy"
  | "budget"
  /** the spend ledger cannot be read or appended: no paid call is made (fail closed, spend.ts) */
  | "ledger_unavailable"
  | "cassette_missing"
  | "bad_response"
  | "deadline";

export class LlmError extends Error {
  readonly status: number;
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string, status = 502) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status;
  }
}
