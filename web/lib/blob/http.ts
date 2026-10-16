/**
 * Route-handler helpers for blob errors. Server-only.
 */
import { NextResponse } from "next/server";
import { BlobError, blobErrorStatus } from "./types";

/** BlobError -> JSON error with its status (415 for webm and other refused types); rethrow anything else. */
export function blobErrorResponse(err: unknown): NextResponse {
  if (err instanceof BlobError) {
    return NextResponse.json({ error: err.code, detail: err.message }, { status: blobErrorStatus(err.code) });
  }
  throw err;
}
