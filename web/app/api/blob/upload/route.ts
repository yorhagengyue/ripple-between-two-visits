/**
 * PUT /api/blob/upload?token=... — the local driver's upload link (BLOB_DRIVER=local only; 404 with
 * any other driver). The token is HMAC-signed by /api/upload-url and names the bucket, path, content
 * type and expiry. The request must declare that same content type, and the bytes must really be that
 * type: WebM, or anything else dressed up as WAV, is refused with 415.
 *
 * 200 { bucket, path, bytes } · 403 bad_token / token_expired · 413 too_large · 415 refused type
 */
import { NextResponse, type NextRequest } from "next/server";
import { BUCKET_CONFIG, getLocalBlobStore } from "@/lib/blob";
import { blobErrorResponse } from "@/lib/blob/http";
import { guardOutsideProxy } from "@/lib/guard/request";
import { jsonError } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ANY_BUCKET = Math.max(...Object.values(BUCKET_CONFIG).map((b) => b.maxBytes));

export async function PUT(req: NextRequest): Promise<Response> {
  // C2 track L: the proxy's matcher leaves this route out, so the origin check runs here (lib/guard/request.ts)
  const refused = guardOutsideProxy(req);
  if (refused) return refused;
  let store;
  try {
    store = getLocalBlobStore();
  } catch (err) {
    return blobErrorResponse(err);
  }
  if (!store) return jsonError(404, "not_found");
  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ANY_BUCKET) return jsonError(413, "too_large");
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const saved = await store.acceptUpload(
      req.nextUrl.searchParams.get("token"),
      req.headers.get("content-type"),
      bytes,
    );
    return NextResponse.json({ bucket: saved.bucket, path: saved.path, bytes: saved.bytes });
  } catch (err) {
    return blobErrorResponse(err);
  }
}
