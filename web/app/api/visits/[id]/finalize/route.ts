/**
 * POST /api/visits/[id]/finalize — the whole-visit transcript is back (POST /api/asr/jobs, then poll
 * GET /api/asr/jobs/[id]): replace the live lines with it, infer roles and extract items in one pass, cut
 * per-sentence clips when the transcript came from the recording, set status "review".
 *
 * Body: { job_id }. 200 { view }. 404 job_not_found (or a job of another session), 409 job_not_done.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSpeechProvider } from "@/lib/asr";
import { jsonError, parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { finalizeVisit } from "@/lib/visit/pipeline";
import { finalizeBody } from "@/lib/visit/schemas";
import { jobOwner } from "@/lib/visit/state";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, finalizeBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  const visitId = decodeURIComponent(id);
  const owner = jobOwner(body.data.job_id);
  if (!owner || owner.sessionId !== found.session.id || owner.visitId !== visitId) return jsonError(404, "job_not_found");
  try {
    const job = await getSpeechProvider().getFileJob(body.data.job_id);
    if (job.status === "pending") return jsonError(409, "job_not_done", "the transcript is not ready yet");
    if (job.status === "failed") return jsonError(502, "job_failed", job.error ?? "speech job failed");
    const view = await finalizeVisit(found.store, found.session, visitId, job);
    return NextResponse.json({ view });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
