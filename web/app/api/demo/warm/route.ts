/**
 * GET /api/demo/warm — the judges' page loads the question pipeline once before the first click (C2 follow-up, track E;
 * real-app 10 「落地页预热发一个 400，控制台有红字 … 预热改成不报错的请求」). Nothing is asked, written or published: the
 * modules the first answer needs (the rules, the sources, the checks) are imported, and the answer is 204. The page
 * used to post an empty body to /api/ask and ignore the 400.
 *
 * For the demo's own copy only (?session= or the rp_session cookie the page already holds): 204, no body. No session:
 * the usual 4xx of every route; an account: 404 (it has no judges' page).
 */
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (found.subject.kind !== "demo") return jsonError(404, "not_found");
  try {
    await import("@/lib/safety");
  } catch (err) {
    // a warm-up never fails the page
    console.warn("[demo/warm] could not load the pipeline", err instanceof Error ? err.message.slice(0, 160) : "");
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
