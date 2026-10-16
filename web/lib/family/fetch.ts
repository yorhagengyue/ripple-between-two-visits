/**
 * Browser calls for Wei Ling's view (/f), Mr Tan's switches (/p/family) and her reminder recorder (M6), with a
 * timeout and an explicit outcome, so no failure is silent: the caller either gets the data or knows why not.
 * Client-safe (fetch, AbortController, timers only).
 *
 *   requestJson   one request; { ok: true, data } or { ok: false, problem } where problem is
 *                   "http"      the server answered non-2xx (status and the API's error code kept)
 *                   "network"   the request never got an answer (offline, connection reset)
 *                   "timeout"   no complete answer within timeoutMs (default 8 s; the request is aborted)
 *                   "bad_body"  2xx, but the body is not JSON or not the expected shape
 *                   "aborted"   the caller cancelled it (component unmounted, a newer request); not an error
 *   retryDelayMs  how long to wait before the next automatic try: 1 s, 2 s, 4 s, 8 s, then every 15 s.
 *   isFamilyViewData / isGrantsResponse / isUploadUrl   shape checks for the three bodies these screens read.
 */
import { GRANT_KEYS, type FamilyViewData, type GrantsResponse } from "./types";

export const FETCH_TIMEOUT_MS = 8_000;
/** a reminder recording (a few seconds of 16 kHz WAV) going up to storage */
export const UPLOAD_TIMEOUT_MS = 60_000;

export type FetchProblem = "http" | "network" | "timeout" | "bad_body" | "aborted";

export type FetchResult<T> = { ok: true; data: T; status: number } | { ok: false; problem: FetchProblem; status?: number; code?: string };

export interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** sent as JSON with Content-Type: application/json */
  json?: unknown;
  /** sent as is (a recording); ignored when `json` is given */
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** the caller's own cancel (unmount, superseded): ends as problem "aborted" */
  signal?: AbortSignal;
  /** "json" (default): the 2xx body must be JSON passing `check`; "any": the body is not read */
  expect?: "json" | "any";
  check?: (x: unknown) => x is T;
}

export async function requestJson<T = unknown>(url: string, opts: RequestOptions<T> = {}): Promise<FetchResult<T>> {
  if (opts.signal?.aborted) return { ok: false, problem: "aborted" };
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  const onCallerAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const failed = (): FetchResult<T> => ({ ok: false, problem: timedOut ? "timeout" : opts.signal?.aborted ? "aborted" : "network" });
  try {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method ?? "GET", headers, body, credentials: "same-origin", cache: "no-store", signal: ctrl.signal });
    } catch {
      return failed();
    }
    if (!res.ok) {
      let code: string | undefined;
      try {
        const err = (await res.json()) as { error?: unknown };
        if (typeof err?.error === "string") code = err.error;
      } catch {
        if (timedOut || opts.signal?.aborted) return failed();
      }
      return { ok: false, problem: "http", status: res.status, code };
    }
    if (opts.expect === "any") return { ok: true, data: undefined as T, status: res.status };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      if (timedOut || opts.signal?.aborted) return failed();
      return { ok: false, problem: "bad_body", status: res.status };
    }
    if (opts.check && !opts.check(data)) return { ok: false, problem: "bad_body", status: res.status };
    return { ok: true, data: data as T, status: res.status };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }
}

const RETRY_STEPS_MS = [1_000, 2_000, 4_000, 8_000];
export const RETRY_MAX_MS = 15_000;

/** Wait before automatic try number `attempt` (0 = the first retry). */
export function retryDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return RETRY_STEPS_MS[0];
  return RETRY_STEPS_MS[Math.floor(attempt)] ?? RETRY_MAX_MS;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function isGrantItems(x: unknown): boolean {
  return isObject(x) && GRANT_KEYS.every((k) => typeof x[k] === "boolean");
}

export function isFamilyViewData(x: unknown): x is FamilyViewData {
  return isObject(x) && typeof x.day === "number" && typeof x.generatedAt === "number" && Number.isFinite(x.generatedAt) && isGrantItems(x.grants);
}

export function isGrantsResponse(x: unknown): x is GrantsResponse {
  return isObject(x) && typeof x.member === "string" && isGrantItems(x.items);
}

export interface UploadUrl {
  path: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

export function isUploadUrl(x: unknown): x is UploadUrl {
  return (
    isObject(x) &&
    typeof x.path === "string" &&
    x.path.length > 0 &&
    typeof x.url === "string" &&
    x.url.length > 0 &&
    typeof x.method === "string" &&
    isObject(x.headers) &&
    Object.values(x.headers).every((v) => typeof v === "string")
  );
}
