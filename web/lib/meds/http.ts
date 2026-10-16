/** Route-handler helpers for the M3 routes: errors -> JSON with the right status. Server-only. */
import { NextResponse } from "next/server";
import { BlobError } from "@/lib/blob";
import { blobErrorResponse } from "@/lib/blob/http";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { StoreError } from "@/lib/store/types";
import { MedsError } from "./errors";

export function medsErrorResponse(err: unknown, where: string): NextResponse {
  if (err instanceof MedsError) return jsonError(err.status, err.code, err.detail ?? err.message);
  if (err instanceof StoreError) return storeErrorResponse(err);
  if (err instanceof BlobError) return blobErrorResponse(err);
  console.error(`[${where}] failed`, (err as Error)?.message);
  return jsonError(500, "internal_error");
}
