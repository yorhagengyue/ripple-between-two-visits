/**
 * The server's log line (docs/plan/real-app.md 3.11 日志和审计; C2 track H). Server-only.
 *
 *   log("info", "me.export", { route: "/api/me/export", status: 200, ms: 41, user: userId, counts: { files: 3 } })
 *   -> [ripple] {"t":"2026-10-10T12:00:00.000Z","level":"info","event":"me.export","route":"/api/me/export",...}
 *
 * What a line may carry is a whitelist, field by field: the route as the code names it (a query string is cut, an id in
 * the path becomes ":id"), the method, the status, how long it took, an error or outcome code, a job name, counts, and
 * the user as a one-way hash. Nothing else gets through: no request or response body, no event `say`, no model input or
 * output, no free text of any kind. A field that is not on the list is dropped; a value that does not have the shape of
 * its field is written as "redacted". So a patient's words cannot reach the log through this exit, whatever a caller
 * passes (tests/unit/privacy/log.test.ts). scripts/check/log-scan.ts checks a server log afterwards.
 *
 * Track H's routes and jobs log only through here. Other modules' console calls are their tracks' own.
 */
import { createHash } from "node:crypto";
import { realNowMs } from "@/lib/time/now";

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  /** the route as the code names it ("/api/me/export", "/api/visits/[id]/keep") */
  route?: string;
  method?: string;
  status?: number;
  ms?: number;
  /** an error or outcome code: lower case letters, digits and _ . : - */
  code?: string;
  /** a user's id: written as a one-way hash, never as given */
  user?: string | null;
  /** a scheduled job's name */
  job?: string;
  /** counts only (lower-case keys, finite numbers) */
  counts?: Record<string, number>;
}

/** The fields a line may carry, in the order they are written. */
export const LOG_FIELDS = ["route", "method", "status", "ms", "code", "user", "job", "counts"] as const;

const EVENT = /^[a-z][a-z0-9_.:-]{0,63}$/;
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const COUNT_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const ROUTE = /^\/[A-Za-z0-9/_.[\]:-]{0,160}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const REDACTED = "redacted";
const MAX_COUNTS = 24;

/** A user's id as a log line carries it: 16 hex characters of a sha256, the same id always the same hash. */
export function userHash(userId: string): string {
  return createHash("sha256").update(`ripple-log:${userId}`, "utf8").digest("hex").slice(0, 16);
}

function cleanRoute(value: unknown): string {
  if (typeof value !== "string") return REDACTED;
  const path = value.split(/[?#]/)[0].replace(UUID, ":id");
  return ROUTE.test(path) ? path : REDACTED;
}

function cleanCounts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_COUNTS) break;
    if (!COUNT_KEY.test(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = Math.round(v * 1000) / 1000;
  }
  return out;
}

/** The fields as they will be written (whitelisted and shaped). Pure. */
export function cleanFields(fields: LogFields | Record<string, unknown>): Record<string, unknown> {
  const f = fields as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of LOG_FIELDS) {
    const v = f[key];
    if (v === undefined || v === null) continue;
    switch (key) {
      case "route":
        out.route = cleanRoute(v);
        break;
      case "method":
        if (typeof v === "string" && METHODS.has(v.toUpperCase())) out.method = v.toUpperCase();
        break;
      case "status":
        if (typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599) out.status = v;
        break;
      case "ms":
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) out.ms = Math.round(v);
        break;
      case "code":
      case "job":
        out[key] = typeof v === "string" && CODE.test(v) ? v : REDACTED;
        break;
      case "user":
        out.user = typeof v === "string" && v ? userHash(v) : REDACTED;
        break;
      case "counts": {
        const c = cleanCounts(v);
        if (c) out.counts = c;
        break;
      }
    }
  }
  return out;
}

/** One log line as text (what log() prints). Pure apart from the time. */
export function logLine(level: LogLevel, event: string, fields: LogFields = {}): string {
  const body = { t: new Date(realNowMs()).toISOString(), level, event: EVENT.test(event) ? event : "event", ...cleanFields(fields) };
  return `[ripple] ${JSON.stringify(body)}`;
}

/** Print one whitelisted line (console.log / warn / error by level). Never throws. */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  try {
    const line = logLine(level, event, fields);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    /* a log line never costs the request */
  }
}

/** The whitelisted code for a thrown value: its `code` when it has one of the right shape, else "error". */
export function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && CODE.test(code) ? code : "error";
}
