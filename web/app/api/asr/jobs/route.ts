/**
 * POST /api/asr/jobs — the whole-visit transcript (the formal record).
 *
 * Body: { visit_id, audio_path?, parts?, speakers?, lang? }
 *   - audio_path: the recording uploaded through /api/upload-url (kind "recording", audio/wav). It must be
 *     this session's file; it is saved on the visit (visit.audio_path).
 *   - parts (C2 track R): a long recording was uploaded as this many files, each registered through
 *     POST /api/visits/[id]/parts. The visit's list must hold exactly that many (409 parts_missing { have } otherwise:
 *     the phone goes on from the first part the server does not have). The list is then the recording: visit.audio_path
 *     becomes the first part's path (the list is closed), and the job reads the parts one after another, its
 *     transcript's times running over the whole visit. A visit whose list was closed earlier (a retry, a page opened
 *     again) uses it without `parts`. Parts still arriving are never a recording: a request without `parts` on such a
 *     visit goes on as if there were none.
 *   - without audio_path (a replay) the transcript is the visit's replay file (mock, and whisper too).
 * Query (whisper, optional): audio_missing = too_large | upload_failed | skipped: why a recorded visit comes
 * without its recording (the page could not or did not upload it); it is the fallback's reason.
 * Sets the visit's status to "transcribing". 200 { job_id, status: "pending", wait_ms }. Poll
 * GET /api/asr/jobs/[id] for up to wait_ms, then POST /api/visits/[id]/finalize. While the visit's job is still
 * pending, a second POST returns that job ({ job_id, status: "pending", wait_ms: the time it still has, reused: true })
 * instead of starting another one for the same recording.
 * DELETE /api/asr/jobs/[id] stops waiting for the service (whisper): the record keeps the live captions.
 *
 * SPEECH_PROVIDER=whisper: the recording's bytes go to the Whisper service (large-v3, VAD, word timestamps,
 * hotwords; no diarisation, speaker = null). A recorded visit is one started after the consent screen (its
 * consent item), or one with live Whisper lines or the replay standing in on screen (realtime stream source
 * "live"); a sample replay (stream source "replay", or none of these) is not.
 *   - recorded, recording here: the service; when it cannot make the transcript the record keeps this visit's
 *     live Whisper lines, else the job fails (never the script);
 *   - recorded, no recording in the request: the recording already saved on the visit (an earlier attempt
 *     uploaded it), else the live Whisper lines (asr.fallback, reason no_audio or audio_missing), else failed;
 *   - the screen showed the replay while recording and ASR_REPLAY_FALLBACK is on: the record follows the replay
 *     (announced when the live captions fell back);
 *   - a sample replay: the replay file (not a fallback).
 * The record's fallback publishes asr.fallback (during "file") once per visit, however often End visit is tapped
 * while the service is down (each attempt is still logged on the server).
 * A service that accepted the recording and then restarted is waited for (the job's awaiting_transcript state, up to
 * WHISPER_REDO_WAIT_MS) and gets the recording again; wait_ms covers that wait and the second attempt.
 * SPEECH_PROVIDER=tencent works the same way (lib/asr/tencent.ts): the recording is cut into pieces of at most 100 s at
 * pauses, recognised three at a time, and the record falls back to the live lines exactly as above; wait_ms is the time
 * its pieces may take.
 * 503 not_configured when SPEECH_PROVIDER=trtc (stub).
 *
 * C2 (an account's recorded visit with no transcription service: SPEECH_PROVIDER=mock and no sample audio on the visit):
 * no job and never the script. The recording is kept on the visit and its status becomes "awaiting_transcript";
 * 200 { job_id: null, status: "awaiting_transcript", audio_saved }. The page says the recording is saved and waits
 * for its text (real-app 2.14); lib/asr/pending.ts sends it once Whisper answers.
 *
 * GET /api/asr/jobs?visit_id= — the page reopened a visit that is still "transcribing": { job_id } when this
 * server still has its job (the page waits for it again); otherwise the job was lost (the web server restarted:
 * jobs live in process memory until item 10) and the visit goes back to "recording", { job_id: null,
 * visit_reset: true }, so End visit works again with the recording saved on the visit.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asLiveTranscriber, DEVFAKE_HEADER, getSpeechProvider, liveTranscriberLabel, type FileJobInput } from "@/lib/asr";
import { rememberVisitJob, visitJob, visitJobWaitLeft } from "@/lib/asr/visit-jobs";
import { markFallback, markFileFallback } from "@/lib/asr/whisper-live";
import { blobPrefix, getBlobStore, pathInSession } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { jsonError, parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { asrJobBody } from "@/lib/visit/schemas";
import { completeParts, registeredParts } from "@/lib/visit/recording";
import { openRecording, partLoaders } from "@/lib/visit/recording-audio";
import { liveUtterances, replayFixtureFor } from "@/lib/visit/view";
import { jobOwner, rememberJob, stopStream, visitLive } from "@/lib/visit/state";
import { isAccount } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOCK_WAIT_MS = 120_000;
/** a job that only has to pick the live lines (no recording to transcribe) */
const NO_AUDIO_WAIT_MS = 30_000;

const audioMissing = z.enum(["too_large", "upload_failed", "skipped"]);

/** A recording of this visit under the scope's own prefix (lib/blob/prefix.ts). */
function ownRecording(prefix: string, visitId: string, path: string | null | undefined): path is string {
  return !!path && pathInSession(prefix, path) && path.startsWith(`${prefix}/visits/${visitId}/`);
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, asrJobBody);
  if (!body.ok) return body.res;
  const missingRaw = req.nextUrl.searchParams.get("audio_missing");
  const missing = missingRaw === null ? null : audioMissing.safeParse(missingRaw);
  if (missing && !missing.success) return jsonError(400, "invalid_query", "audio_missing is too_large, upload_failed or skipped");
  const sessionId = found.session.id;
  const store = found.store;
  try {
    const visit = await store.getVisit(sessionId, body.data.visit_id);
    if (!visit) return jsonError(404, "visit_not_found");
    const given = body.data.audio_path ?? null;
    const prefix = blobPrefix(found.session);
    if (given && !ownRecording(prefix, visit.id, given)) return jsonError(400, "invalid_audio_path");
    // C2 track R: a recording in several files. With `parts` in the request the phone says the list is whole: it is,
    // when the server has exactly that many. Without it, only a list closed earlier counts (audio_path names its first
    // part); parts still arriving are not a recording, and a path handed over by itself is a recording in one file.
    const registered = registeredParts(visit);
    const closed = completeParts(visit);
    let parts = body.data.parts === undefined && (!given || given === closed?.[0].path) ? closed : null;
    if (body.data.parts !== undefined) {
      if (registered.length !== body.data.parts) return NextResponse.json({ error: "parts_missing", have: registered.length }, { status: 409 });
      if (registered.some((p) => !ownRecording(prefix, visit.id, p.path))) return jsonError(400, "invalid_audio_path");
      if (given && given !== registered[0].path) return jsonError(400, "invalid_audio_path");
      parts = registered;
    }

    const speech = getSpeechProvider();
    // End visit tapped again while this visit's job is still pending (a double tap, or a page that stopped waiting
    // before the server did): the same job and the time it still has, never a second job for the same recording
    // (which would book the GPU twice and race the first one to the record)
    const pendingId = visitJob(sessionId, visit.id);
    if (pendingId && jobOwner(pendingId)?.sessionId === sessionId) {
      const prev = await speech.getFileJob(pendingId).catch(() => null);
      if (prev?.status === "pending") {
        return NextResponse.json({ job_id: pendingId, status: "pending", wait_ms: Math.max(NO_AUDIO_WAIT_MS, visitJobWaitLeft(sessionId, visit.id)), reused: true });
      }
    }
    // whisper or tencent: transcribes the recording here (lib/asr/index.ts getLiveTranscriber)
    const transcriber = asLiveTranscriber(speech);
    const stream = visitLive(sessionId, visit.id).stream;
    const live = liveUtterances(await store.listUtterances(sessionId, visit.id));
    const whisperLines = live.filter((u) => u.id.startsWith(`${visit.id}-w`));
    // a sample replay runs a stream with source "replay"; a recording was consented to on the consent screen,
    // has live Whisper lines, or had the replay standing in on screen (source "live")
    const consented = transcriber ? (await store.listVisitItems(sessionId, { visit_id: visit.id })).some((i) => i.id === `${visit.id}-consent-screen`) : false;
    const recorded = !!transcriber && stream?.source !== "replay" && (consented || whisperLines.length > 0 || stream?.source === "live");
    const replayOnScreen = stream?.source === "live";
    // a retry after a failed transcript, or a page reloaded after its upload: the recording saved on the visit
    const audioPath = parts
      ? parts[0].path
      : (given ?? (recorded && !(missing?.success && missing.data === "skipped") && ownRecording(prefix, visit.id, visit.audio_path) ? visit.audio_path : null));
    const audio = audioPath ? await getBlobStore().getObject("audio", audioPath) : null;
    if ((given || body.data.parts !== undefined) && !audio) return jsonError(404, "audio_not_found");
    // the whole recording, file by file (the first one is already read)
    const recording = parts && audio ? openRecording(getBlobStore(), { audio_path: parts[0].path, audio_parts: parts }, { first: audio.bytes }) : null;
    // a recording in one file handed over for a visit that still lists parts of an upload nobody finished: that list is
    // not this recording (a list that is in use never gets here: its first part is the path)
    const staleParts = !parts && !!audioPath && registered.length > 0;
    const savedAudio = audioPath ? { audio_path: audioPath, ...(staleParts ? { audio_parts: null } : {}) } : {};

    // people present: the speakers heard live, at least two
    const clusters = new Set(live.map((u) => u.speaker_cluster).filter((c) => c !== null));
    const speakers = body.data.speakers ?? Math.max(2, clusters.size);
    const fixture = replayFixtureFor(visit);
    // an account's recording with no transcription service: it waits for its text, never the script (real-app 2.14, H6)
    if (isAccount(found.session) && speech.name === "mock" && !fixture) {
      const updated = await store.updateVisit(sessionId, visit.id, { status: "awaiting_transcript", ...savedAudio });
      stopStream(sessionId, visit.id);
      publish(sessionId, "visit.changed", `Visit ${visit.id}: recording saved, waiting for its transcript (no transcription service)`, { visit: updated, awaiting_transcript: true });
      return NextResponse.json({ job_id: null, status: "awaiting_transcript", audio_saved: !!audioPath });
    }
    const url = audioPath ? await getBlobStore().signedReadUrl("audio", audioPath, 3600) : `fixture:${fixture ?? "none"}`;

    const input: FileJobInput = { url, speakers, lang: body.data.lang ?? "zh-en-mixed", fixture: fixture ?? undefined };
    // the developer tools' stand-in transcribes a recorded visit as the fixture a test names (SPEECH_PROVIDER=devfake)
    if (speech.name === "devfake") {
      input.devfakeFixture = req.headers.get(DEVFAKE_HEADER)?.trim() || undefined;
      if (audio) input.audio = audio.bytes;
    }
    let waitMs = MOCK_WAIT_MS;
    if (transcriber && (audio || recorded)) {
      input.recorded = recorded;
      if (recording && recording.files.length > 1) input.audioParts = partLoaders(recording);
      else if (audio) input.audio = audio.bytes;
      else input.missingAudio = missing?.success ? missing.data : "no_audio";
      // the screen showed the replay: the record follows the replay too (ASR_REPLAY_FALLBACK on only)
      input.preferFixture = replayOnScreen && !!fixture && transcriber.replayFallback;
      input.liveUtterances = whisperLines.map((u) => ({ id: u.id, tStartMs: u.t_start_ms, tEndMs: u.t_end_ms, speaker: null, text: u.text, ...(u.lang ? { lang: u.lang } : {}) }));
      input.onFallback = (fb) => {
        if (fb.reason === "live_fallback") return; // announced when the live captions fell back
        markFallback(sessionId, visit.id, fb.reason, "file");
        console.warn(`[asr] ${transcriber.name} file job fell back: ${fb.reason} -> ${fb.used}`);
        // once per visit: a patient tapping End again while the service is down is one problem, not several
        if (!markFileFallback(sessionId, visit.id, fb.reason)) return;
        const waited = fb.waitedMs ? `; waited ${Math.round(fb.waitedMs / 1000)} s for it to come back` : "";
        publish(sessionId, "asr.fallback", `${liveTranscriberLabel(transcriber)} did not make the full transcript of visit ${visit.id} (${fb.reason}${waited})`, {
          visit_id: visit.id,
          reason: fb.reason,
          during: "file",
          used: fb.used,
          replay: transcriber.replayFallback ? fixture : null,
          // the recording is kept on the visit: End visit again transcribes it once the service is back
          audio_saved: !!audioPath,
          ...(fb.waitedMs ? { waited_ms: fb.waitedMs } : {}),
          provider: transcriber.name,
        });
      };
      // the job may wait for a restarted service and send the recording again (awaiting_transcript): the page
      // waits for all of it
      waitMs = recording && parts && recording.files.length > 1 ? transcriber.budgetMsForParts(parts.map((p) => p.ms)) + 30_000 : audio ? transcriber.budgetMs(audio.bytes) + 30_000 : NO_AUDIO_WAIT_MS;
    }
    const { jobId } = await speech.createFileJob(input);
    rememberJob(jobId, { sessionId, visitId: visit.id, provider: speech.name });
    rememberVisitJob(sessionId, visit.id, jobId, waitMs);
    stopStream(sessionId, visit.id);
    const updated = await store.updateVisit(sessionId, visit.id, { status: "transcribing", ...savedAudio });
    publish(sessionId, "visit.changed", `Visit ${visit.id}: making the full transcript (${speakers} speakers)`, { visit: updated, job_id: jobId });
    return NextResponse.json({ job_id: jobId, status: "pending", wait_ms: waitMs });
  } catch (err) {
    return visitErrorResponse(err);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const visitId = req.nextUrl.searchParams.get("visit_id");
  if (!visitId || !/^[A-Za-z0-9_-]{1,80}$/.test(visitId)) return jsonError(400, "invalid_query", "visit_id is required");
  const sessionId = found.session.id;
  try {
    const store = found.store;
    const visit = await store.getVisit(sessionId, visitId);
    if (!visit) return jsonError(404, "visit_not_found");
    const jobId = visitJob(sessionId, visit.id);
    const owner = jobId ? jobOwner(jobId) : null;
    if (jobId && owner && owner.sessionId === sessionId) {
      const job = await getSpeechProvider().getFileJob(jobId).catch(() => null);
      if (job) return NextResponse.json({ job_id: jobId, status: job.status, visit_status: visit.status });
    }
    if (visit.status === "transcribing") {
      const updated = await store.updateVisit(sessionId, visit.id, { status: "recording" });
      publish(sessionId, "visit.changed", `Visit ${visit.id}: its transcript job was lost (the server restarted); the visit can be ended again`, { visit: updated });
      return NextResponse.json({ job_id: null, visit_reset: true, visit_status: updated.status });
    }
    return NextResponse.json({ job_id: null, visit_status: visit.status });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
