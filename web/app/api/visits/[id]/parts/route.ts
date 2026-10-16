/**
 * /api/visits/[id]/parts — the parts of a long visit recording, one at a time (C2 track R; lib/visit/parts.ts).
 *
 * A visit longer than one part (20 minutes of audio) does not fit in one file of the audio bucket. The phone sends it
 * as consecutive files, each through its own upload link (POST /api/upload-url, kind "recording", exactly as a whole
 * recording), and tells the server about each one here before it sends the next. The server keeps the list on the
 * visit (visit.audio_parts) and is the only one that says what it has: the phone asks (GET) before it goes on, and
 * drops its own copy of a part only with the path this route answered for it.
 *
 * GET   200 { parts: [{ seq, path, ms }], complete, path }   what the server has, in order. `complete`: the whole
 *       recording is there (POST /api/asr/jobs closed the list, or it is a recording in one file); nothing more is
 *       taken, and `path` is the recording's (the first part's; null while it is not complete).
 *
 * POST  { seq, path }   `seq`: 0 for the first part, then 1, 2, ... ; `path`: where the phone uploaded it.
 *       The server reads the file and measures it itself: it must be a 16 kHz mono 16-bit WAV under this visit's own
 *       folder. A length the phone might state is never used.
 *       200 { parts, complete: false }   the part is on the list (the same answer when this seq is already there with
 *                                        this path: the phone asking again after an answer it did not get)
 *       400 invalid_audio_path           not a recording file of this visit in his own storage folder
 *       404 visit_not_found | audio_not_found (the file is not in storage: the upload did not finish)
 *       409 out_of_order { have }        seq is past the next one: the phone sends parts in order
 *       409 part_exists { have }         seq is already there with another file (a confirmed part is never replaced:
 *                                        the phone may have dropped its copy of it)
 *       409 recording_complete           the visit already has its whole recording
 *       409 not_recorded                 a planned visit, or one he already confirmed
 *       413 too_many_parts               more parts than a visit may have (lib/visit/parts.ts MAX_PARTS)
 *       415 not_wav | wrong_format | empty
 *
 * His own only (never through a family link). A recording that fits in one file never comes here: it is uploaded and
 * handed to POST /api/asr/jobs as before, and its visit has no list.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { blobPrefix, getBlobStore, pathInSession } from "@/lib/blob";
import { blobErrorResponse } from "@/lib/blob/http";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { StoreError } from "@/lib/store";
import type { VisitAudioPart, VisitRow } from "@/lib/store/types";
import { requireSubject } from "@/lib/subject";
import { MAX_PARTS } from "@/lib/visit/parts";
import { registeredParts } from "@/lib/visit/recording";
import { measurePart } from "@/lib/visit/recording-audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const partBody = z
  .object({
    seq: z.number().int().min(0).max(1000),
    path: z.string().trim().min(1).max(512),
  })
  .strict();

const listed = (parts: VisitAudioPart[]) => parts.map((p, seq) => ({ seq, path: p.path, ms: p.ms }));

/** A recording file directly in this visit's folder under the scope's own prefix (never a sentence clip). */
function recordingFileOf(prefix: string, visitId: string, path: string): boolean {
  const folder = `${prefix}/visits/${visitId}/`;
  if (!pathInSession(prefix, path) || !path.startsWith(folder)) return false;
  return /^recording-[A-Za-z0-9._-]+\.wav$/.test(path.slice(folder.length));
}

async function visitOf(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const found = await requireSubject(req);
  if (!found.ok) return { ok: false as const, res: found.res };
  const { id } = await ctx.params;
  const visit: VisitRow | null = await found.store.getVisit(found.session.id, decodeURIComponent(id));
  if (!visit) return { ok: false as const, res: jsonError(404, "visit_not_found") };
  return { ok: true as const, found, visit };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const v = await visitOf(req, ctx);
    if (!v.ok) return v.res;
    return NextResponse.json({ parts: listed(registeredParts(v.visit)), complete: !!v.visit.audio_path, path: v.visit.audio_path ?? null });
  } catch (err) {
    if (err instanceof StoreError) return storeErrorResponse(err);
    throw err;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const v = await visitOf(req, ctx);
    if (!v.ok) return v.res;
    const denied = await denyFamily(req, v.found.session);
    if (denied) return denied;
    const body = await parseBody(req, partBody);
    if (!body.ok) return body.res;
    const { found, visit } = v;
    const { seq, path } = body.data;
    const have = registeredParts(visit);
    const prefix = blobPrefix(found.session);
    if (!recordingFileOf(prefix, visit.id, path)) return jsonError(400, "invalid_audio_path");
    // asked again after an answer that never arrived: the same answer, nothing written
    if (seq < have.length && have[seq].path === path && !visit.audio_path) return NextResponse.json({ parts: listed(have), complete: false });
    if (visit.audio_path) return NextResponse.json({ error: "recording_complete", have: have.length }, { status: 409 });
    if (visit.status === "planned" || visit.status === "confirmed") return jsonError(409, "not_recorded");
    if (seq < have.length) return NextResponse.json({ error: "part_exists", have: have.length }, { status: 409 });
    if (seq > have.length) return NextResponse.json({ error: "out_of_order", have: have.length }, { status: 409 });
    if (seq >= MAX_PARTS) return jsonError(413, "too_many_parts");
    // a file is one part only
    if (have.some((p) => p.path === path)) return NextResponse.json({ error: "part_exists", have: have.length }, { status: 409 });

    const file = await getBlobStore().getObject("audio", path);
    if (!file) return jsonError(404, "audio_not_found");
    const measured = measurePart(file.bytes);
    if (!measured.ok) return jsonError(415, measured.why);

    const parts = [...have, { path, ms: measured.ms }];
    const updated = await found.store.updateVisit(found.session.id, visit.id, { audio_parts: parts });
    return NextResponse.json({ parts: listed(registeredParts(updated)), complete: false });
  } catch (err) {
    if (err instanceof StoreError) return storeErrorResponse(err);
    return blobErrorResponse(err);
  }
}
