/**
 * GET /api/reminders/[id]/audio — the audio of one reminder clip (audio/wav, one Range supported so <audio> can
 * seek). X-Ripple-Stand-In: 1 when it is the synthetic stand-in voice (the UI labels it 代录音). Only this
 * session's clips; 404 when the clip has no audio. Her phone naming a session that is not its own, and a device with
 * no row in a session she has joined, get 403 (lib/family/role.ts denyOutsider; the proxy gate answers first).
 *
 * Line bind (only add, round two): through her care link, 409 link_not_acknowledged while he has not acknowledged it
 * (lib/care/ack.ts). The recording his phone plays may be another family member's voice: someone who bound his account
 * by typing it hears none of it before he has answered.
 */
import type { NextRequest } from "next/server";
import { LINK_NOT_ACKNOWLEDGED, linkAcknowledged } from "@/lib/care/ack";
import { reminderAudio } from "@/lib/daily/reminders";
import { denyOutsider } from "@/lib/family/role";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { bindEntryStore } from "@/lib/subject/bind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const denied = await denyOutsider(req, found.session);
  if (denied) return denied;
  if (found.subject.kind === "account" && found.subject.relation === "family" && found.subject.link) {
    try {
      if (!(await linkAcknowledged(bindEntryStore(), found.subject.link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
    } catch (err) {
      return storeErrorResponse(err);
    }
  }
  const { id } = await ctx.params;
  const audio = await reminderAudio(found.store, found.session, decodeURIComponent(id));
  if (!audio) return jsonError(404, "no_audio");
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(audio.bytes);
  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "X-Ripple-Stand-In": audio.standIn ? "1" : "0",
  };
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
