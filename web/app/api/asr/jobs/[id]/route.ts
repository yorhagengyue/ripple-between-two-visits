/**
 * GET /api/asr/jobs/[id] — status of a whole-visit transcript job: { status: pending | done | failed,
 * utterances?: [{ tStartMs, tEndMs, speaker, text }], source?, fallback? }. Only the session that created the
 * job can read it (404 otherwise). A failed job puts its visit back to "recording" (it was "transcribing"), so
 * "End visit" can be tapped again: the page keeps the recording and sends it again.
 *   - failed while the recording is saved on the visit and the speech service could not make it (down, stuck,
 *     refused): `deferred: true`. Nothing is lost: End visit again (now, or once the service is back) makes the
 *     record from the saved recording. The page says so instead of a bare "try again".
 *     C2, on an account: the visit waits for its text instead ("awaiting_transcript", `awaiting_transcript: true`;
 *     real-app 2.14): his page opens the review, which says the recording is saved and has no text yet, and
 *     lib/asr/pending.ts sends the recording once the service answers.
 *   - ?visit_id=<visit>: when this server does not know the job (it restarted: jobs live in process memory until
 *     item 10 of the plan), that visit, if still "transcribing", goes back to "recording":
 *     404 { error: "job_not_found", visit_reset: true }, and the page creates the job again.
 *
 * DELETE /api/asr/jobs/[id] — he does not want to wait any longer for the whole-recording transcript
 * (SPEECH_PROVIDER=whisper or tencent): the job stops and finishes with the live captions of this visit (or fails
 * when there are none); asr.fallback says "cancelled". 200 { cancelled: true } while the job was still running,
 * { cancelled: false } when it had already finished; 409 not_cancellable for other providers.
 */
import { NextResponse, type NextRequest } from "next/server";
import { asLiveTranscriber, getSpeechProvider } from "@/lib/asr";
import { blobPrefix, pathInSession } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { jsonError } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { jobOwner } from "@/lib/visit/state";
import { isAccount } from "@/lib/store/scope";
import { requireSubject, type ScopedStore } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Owned =
  | { ok: false; res: Response; sessionId?: string; store?: ScopedStore }
  | { ok: true; jobId: string; owner: NonNullable<ReturnType<typeof jobOwner>>; sessionId: string; store: ScopedStore };

async function owned(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Owned> {
  const found = await requireSubject(req);
  if (!found.ok) return { ok: false, res: found.res };
  const { id } = await ctx.params;
  const jobId = decodeURIComponent(id);
  const owner = jobOwner(jobId);
  if (!owner || owner.sessionId !== found.session.id) return { ok: false, res: jsonError(404, "job_not_found"), sessionId: found.session.id, store: found.store };
  return { ok: true, jobId, owner, sessionId: found.session.id, store: found.store };
}

/**
 * Reasons a whisper or tencent job fails although the recording is fine: making the record later can work. Not when the
 * service refused the recording itself (rejected_*: the same bytes would be refused again), nor when it never got it.
 */
function serviceProblem(error: string | undefined, fallbackUsed: string | undefined): boolean {
  if (fallbackUsed !== "none" || !error) return false;
  const reason = error.replace(/^(?:whisper|tencent)_unavailable:/, "");
  if (reason.startsWith("rejected_")) return false;
  return !["no_audio", "upload_failed", "skipped", "too_large", "cancelled", "internal_error"].includes(reason);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const o = await owned(req, ctx);
  if (!o.ok) {
    const visitId = req.nextUrl.searchParams.get("visit_id");
    if (!o.sessionId || !o.store || !visitId || !/^[A-Za-z0-9_-]{1,80}$/.test(visitId)) return o.res;
    // the job is unknown here: if its visit still waits for it, let End visit work again
    try {
      const store = o.store;
      const visit = await store.getVisit(o.sessionId, visitId);
      if (!visit || visit.status !== "transcribing") return o.res;
      const updated = await store.updateVisit(o.sessionId, visit.id, { status: "recording" });
      publish(o.sessionId, "visit.changed", `Visit ${visit.id}: its transcript job was lost (the server restarted); the visit can be ended again`, { visit: updated });
      return NextResponse.json({ error: "job_not_found", visit_reset: true }, { status: 404 });
    } catch (err) {
      return visitErrorResponse(err);
    }
  }
  try {
    const job = await getSpeechProvider().getFileJob(o.jobId);
    let deferred = false;
    let awaiting = false;
    if (job.status === "failed") {
      const store = o.store;
      const visit = await store.getVisit(o.sessionId, o.owner.visitId);
      const scope = await store.getSession(o.sessionId);
      const prefix = blobPrefix(scope ?? { id: o.sessionId });
      const saved = !!visit?.audio_path && pathInSession(prefix, visit.audio_path) && visit.audio_path.startsWith(`${prefix}/visits/${visit.id}/`);
      deferred = saved && serviceProblem(job.error, job.fallback?.used);
      // C2: an account's saved recording waits for its text (the review page says so; lib/asr/pending.ts sends it
      // once the service answers), instead of going back to "recording" for him to end again
      awaiting = deferred && !!scope && isAccount(scope);
      if (visit && visit.status === "transcribing") {
        if (awaiting) {
          const updated = await store.updateVisit(o.sessionId, visit.id, { status: "awaiting_transcript" });
          publish(o.sessionId, "visit.changed", `Visit ${visit.id}: recording saved, waiting for its transcript (the transcription service did not make it)`, {
            visit: updated,
            awaiting_transcript: true,
          });
        } else {
          const updated = await store.updateVisit(o.sessionId, visit.id, { status: "recording" });
          publish(o.sessionId, "visit.changed", `Visit ${visit.id}: the full transcript could not be made; the visit can be ended again`, { visit: updated });
        }
      }
    }
    return NextResponse.json({ job_id: o.jobId, visit_id: o.owner.visitId, ...job, ...(deferred ? { deferred: true } : {}), ...(awaiting ? { awaiting_transcript: true } : {}) });
  } catch (err) {
    return visitErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const o = await owned(req, ctx);
  if (!o.ok) return o.res;
  const speech = asLiveTranscriber(getSpeechProvider());
  if (!speech) return jsonError(409, "not_cancellable", "only a whisper or tencent transcript can be cut short");
  try {
    const cancelled = await speech.cancelFileJob(o.jobId);
    return NextResponse.json({ job_id: o.jobId, cancelled });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
