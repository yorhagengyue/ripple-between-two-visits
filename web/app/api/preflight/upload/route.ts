/**
 * POST /api/preflight/upload — reads the raw body and answers with its size; nothing is stored.
 * Used by `npm run preflight -- --url <preview>` to check that a 4 MB request body gets through the
 * hosting platform (web-app.md section 2, item 9). Bodies over 8 MB are cut off with 413.
 */
import { guardOutsideProxy } from "@/lib/guard/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  // C2 track L: the proxy's matcher leaves this route out, so the origin check runs here (lib/guard/request.ts)
  const refused = guardOutsideProxy(req);
  if (refused) return refused;
  if (!req.body) return Response.json({ bytes: 0 });
  const reader = req.body.getReader();
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      return Response.json({ error: "too_large", max_bytes: MAX_BYTES }, { status: 413 });
    }
  }
  return Response.json({ bytes });
}
