/**
 * GET /api/blob/read?token=... — the local driver's signed read link (BLOB_DRIVER=local only; 404 with
 * any other driver). Serves the object with its content type; supports a single "Range: bytes=a-b" so
 * <audio> elements can seek.
 *
 * 200 / 206 bytes · 403 bad_token / token_expired · 404 not_found · 416 bad range
 */
import { type NextRequest } from "next/server";
import { getLocalBlobStore } from "@/lib/blob";
import { blobErrorResponse } from "@/lib/blob/http";
import { jsonError } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const store = getLocalBlobStore();
    if (!store) return jsonError(404, "not_found");
    const { bucket, path } = store.readToken(req.nextUrl.searchParams.get("token"));
    const obj = await store.getObject(bucket, path);
    if (!obj) return jsonError(404, "not_found");
    const size = obj.bytes.byteLength;
    const headers: Record<string, string> = {
      "content-type": obj.contentType,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
    };
    const range = parseRange(req.headers.get("range"), size);
    if (range === "invalid") {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    }
    if (range) {
      const part = obj.bytes.slice(range.start, range.end + 1);
      return new Response(part, {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
          "content-length": String(part.byteLength),
        },
      });
    }
    return new Response(obj.bytes.slice(), { status: 200, headers: { ...headers, "content-length": String(size) } });
  } catch (err) {
    return blobErrorResponse(err);
  }
}
