/**
 * GET /api/visits/[id]/clip?u=<utteranceId> — the audio of one sentence, for "play the doctor's own words".
 *
 * - a stand-in clip (web/fixtures/visits/clips/<id>.wav, synthetic voices for R1-R4 until real recordings
 *   exist): served from the fixtures folder; the UI labels it 代录音 / stand-in recording;
 * - a clip cut from the visit recording (Storage, audio bucket, path under this session): read through the
 *   blob store.
 * Only sentences of this session's visit (or, for a seeded visit with no transcript yet, a stand-in clip of
 * that visit's replay file). Supports one Range so <audio> can seek. 404 when there is no clip.
 *
 * &s=k (10-14): only sentence k of the line (from 0), or &s=k-m sentences k to m as one stretch, cut out of a stand-in clip
 * that has a sentence index (lib/asr/sentences.ts; web/fixtures/visits/clips/sentences.json) as a WAV file of its own
 * (lib/visit/wav.ts sliceWav), with the same Range support. Any other s, and any s on a clip with no index (a real
 * recording, for now), is 404. Without s: the whole clip, as before.
 */
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { fixtureClipFile, fixtureClipPath, isStandInClip } from "@/lib/asr";
import { sentenceCut, standInClipId } from "@/lib/asr/sentences";
import { sliceWav } from "@/lib/visit/wav";
import { blobPrefix, getBlobStore, pathInSession } from "@/lib/blob";
import { jsonError } from "@/lib/session/http";
import { isAccount } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";
import { replayFixtureFor } from "@/lib/visit/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function audioResponse(req: NextRequest, source: Uint8Array, standIn: boolean): Response {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(source);
  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "X-Ripple-Stand-In": standIn ? "1" : "0",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const part = bytes.slice(start, end + 1);
    return new Response(part, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(part.length) },
    });
  }
  return new Response(bytes, { status: 200, headers: { ...headers, "Content-Length": String(bytes.length) } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const { id } = await ctx.params;
  const visitId = decodeURIComponent(id);
  const u = req.nextUrl.searchParams.get("u")?.trim() ?? "";
  if (!u) return jsonError(400, "missing_utterance");
  const store = found.store;
  const visit = await store.getVisit(found.session.id, visitId);
  if (!visit) return jsonError(404, "visit_not_found");

  const row = (await store.listUtterances(found.session.id, visitId)).find((x) => x.id === u) ?? null;
  let clipPath = row?.clip_path ?? null;
  // a stand-in clip found by the line's id alone: the demo as before; on an account only for a visit that has a replay
  // of its own (lib/visit/view.ts replayFixtureFor: the example's sample visits), never because his own visit is called "v1" (H6)
  if (!row && u.startsWith(`${visitId}-`) && !(isAccount(found.session) && !replayFixtureFor(visit))) clipPath = fixtureClipPath(u);
  if (!clipPath) return jsonError(404, "no_clip");
  // one sentence (or a run of them) of the line: only from a stand-in clip with a sentence index
  const s = req.nextUrl.searchParams.get("s");

  if (isStandInClip(clipPath)) {
    const file = fixtureClipFile(clipPath);
    if (!file) return jsonError(404, "no_clip");
    const cut = s === null ? null : sentenceCut(standInClipId(clipPath) ?? "", s);
    if (s !== null && !cut) return jsonError(404, "no_sentence");
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(file));
    } catch {
      return jsonError(404, "no_clip");
    }
    const audio = cut ? sliceWav(bytes, cut.startMs, cut.endMs) : bytes;
    if (!audio) return jsonError(404, "no_sentence");
    return audioResponse(req, audio, true);
  }
  if (s !== null) return jsonError(404, "no_sentence");
  if (!pathInSession(blobPrefix(found.session), clipPath)) return jsonError(404, "no_clip");
  const obj = await getBlobStore().getObject("audio", clipPath);
  if (!obj) return jsonError(404, "no_clip");
  return audioResponse(req, obj.bytes, false);
}
