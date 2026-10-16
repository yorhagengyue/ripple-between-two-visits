/**
 * GET /api/family/clip?link=<her care link>&visit=<id>&u=<utteranceId> — the sound of one line he shares with her (C2
 * track D; the daughter brief F4 「听原声」). Only while 「看诊录音和逐字稿」 is on for her link, and only a clinician's
 * line he confirmed (the same lines lib/care/shared.ts lists): a stand-in voice from the fixtures (X-Ripple-Stand-In: 1,
 * labelled 代录音) or the clip cut from his recording. One Range supported so <audio> can seek. 404 otherwise.
 */
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { fixtureClipFile, isStandInClip } from "@/lib/asr";
import { blobPrefix, getBlobStore, pathInSession } from "@/lib/blob";
import { herOf, notFound } from "@/lib/care/http";
import { readGrants } from "@/lib/family/grants";
import { jsonError } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function audio(req: NextRequest, source: Uint8Array, standIn: boolean): Response {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(source);
  const headers: Record<string, string> = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300", "X-Ripple-Stand-In": standIn ? "1" : "0" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    const start = Math.max(0, range[1] ? Number(range[1]) : size - Number(range[2]));
    const end = Math.min(size - 1, range[1] && range[2] ? Number(range[2]) : size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    const part = bytes.slice(start, end + 1);
    return new Response(part, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(part.length) } });
  }
  return new Response(bytes, { status: 200, headers: { ...headers, "Content-Length": String(bytes.length) } });
}

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const her = herOf(found.subject);
  if (!her) return notFound();
  const { items } = await readGrants(found.store, found.session, her.linkId);
  if (!items.visit_transcripts) return jsonError(403, "not_shared");
  const visitId = req.nextUrl.searchParams.get("visit")?.trim() ?? "";
  const u = req.nextUrl.searchParams.get("u")?.trim() ?? "";
  if (!visitId || !u) return jsonError(400, "missing_line");
  const row = (await found.store.listUtterances(found.session.id, visitId)).find((x) => x.id === u);
  if (!row || !row.clip_path || row.role_state !== "confirmed" || !["doctor", "dispenser", "pharmacist"].includes(row.role)) return jsonError(404, "no_clip");
  if (isStandInClip(row.clip_path)) {
    const file = fixtureClipFile(row.clip_path);
    if (!file) return jsonError(404, "no_clip");
    try {
      return audio(req, new Uint8Array(await readFile(file)), true);
    } catch {
      return jsonError(404, "no_clip");
    }
  }
  if (!pathInSession(blobPrefix(found.session), row.clip_path)) return jsonError(404, "no_clip");
  const obj = await getBlobStore().getObject("audio", row.clip_path);
  return obj ? audio(req, obj.bytes, false) : jsonError(404, "no_clip");
}
