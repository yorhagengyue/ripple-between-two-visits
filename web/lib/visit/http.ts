/**
 * Error mapping for the visit and speech routes. Server-only.
 */
import type { NextResponse } from "next/server";
import { SpeechError } from "@/lib/asr/types";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { StoreError } from "@/lib/store/types";
import { VisitError } from "./pipeline";

const VISIT_STATUS: Record<VisitError["code"], number> = {
  visit_not_found: 404,
  visit_not_yet: 409,
  no_replay: 409,
  fallback_filming_only: 403,
  fallback_locked: 403,
  fallback_disabled: 403,
  fallback_key_attempts: 429,
  job_not_done: 409,
  consent_required: 400,
  not_planned: 409,
  invalid: 400,
};

export function visitErrorResponse(err: unknown): NextResponse {
  if (err instanceof VisitError) return jsonError(VISIT_STATUS[err.code], err.code, err.message);
  if (err instanceof SpeechError) {
    const status = err.code === "not_configured" ? 503 : err.code === "not_found" ? 404 : 400;
    return jsonError(status, err.code, err.message);
  }
  if (err instanceof StoreError) return storeErrorResponse(err);
  throw err;
}
