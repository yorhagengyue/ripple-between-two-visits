/**
 * GET /api/real/[id] — a real-recording demo run (lib/asr/real-demo.ts): { state: transcribing | extracting |
 * checking | done | failed, progress, error, result }. The result holds the lines (Whisper's sentences with their
 * time points and the speaker as the dataset marks it: annotated turns and separate channels), the doctor's-note cards (each the doctor's sentence as
 * heard, with its time points), how items were extracted and the safety report (checked, passed, withheld,
 * never_cross). The crew's only (lib/crew/gate.ts): without the crew's cookie or key 404 not_found; 404 when the run is
 * unknown (or older than an hour).
 *
 * DELETE /api/real/[id] — stop a run that is still going: { cancelled: true | false }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { demoAccess } from "@/lib/asr/real-demo-access";
import { cancelDemo, getDemo, publicJob, type DemoJob } from "@/lib/asr/real-demo";
import { jsonError } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Found = { ok: true; job: DemoJob } | { ok: false; res: Response };

async function find(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Found> {
  const access = await demoAccess(req);
  if (!access.ok) return { ok: false, res: access.res };
  const { id } = await ctx.params;
  if (!/^real-[0-9a-f-]{36}$/.test(id)) return { ok: false, res: jsonError(404, "job_not_found") };
  const job = getDemo(id);
  if (!job) return { ok: false, res: jsonError(404, "job_not_found") };
  return { ok: true, job };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const f = await find(req, ctx);
  if (!f.ok) return f.res;
  return NextResponse.json(publicJob(f.job));
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const f = await find(req, ctx);
  if (!f.ok) return f.res;
  return NextResponse.json({ job_id: f.job.id, cancelled: cancelDemo(f.job) });
}
