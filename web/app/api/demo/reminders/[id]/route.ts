/**
 * DELETE /api/demo/reminders/[id] — 「删掉这段」 on the demo's /f (C2 follow-up, track E; real-app 12 「她录的提醒存完听不回、
 * 删不掉」): one of the recordings Wei Ling made in this copy of the story (a judge's sandbox, the crew's filming session).
 * His phone then plays her next newest recording, else the story's labelled stand-in voice.
 *
 *   200 { ok: true, removed: 1 }
 *   403 family_only / patient_only / member_required   only her side deletes (the same rule as recording one,
 *                                                      lib/family/reminders.ts reminderAuthorFor): his phone, backstage
 *                                                      and the director cannot remove her recording
 *   404 not_found   no such clip in this copy; the story's own clip (the stand-in is not hers to delete); any account
 *                   (her real account deletes through DELETE /api/reminders/[id]?link=, track D)
 *   503 role_unavailable   the copy's devices could not be read just now
 *
 * The clip's row goes; its file stays in this copy's folder until the copy is reset or expires (lib/blob has no
 * single-file delete), and nothing links to it any more. Publishes reminder.clip_added { removed } so his phone and her
 * page read the clips again.
 */
import { NextResponse, type NextRequest } from "next/server";
import { blobPrefix, pathInSession } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { reminderAuthorFor } from "@/lib/family/reminders";
import { roleUnavailable } from "@/lib/family/role";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (found.subject.kind !== "demo") return jsonError(404, "not_found");
  const s = found.session;
  const author = await reminderAuthorFor(req, s);
  if (!author.ok) return author.status === 503 ? roleUnavailable() : jsonError(author.status, author.code);
  const { id } = await ctx.params;
  try {
    const clip = (await found.store.listReminderClips(s.id)).find((c) => c.id === decodeURIComponent(id));
    // hers: a recording uploaded into this copy (its file is this copy's own); the story's clip has no such file
    if (!clip || !clip.audio_path || !pathInSession(blobPrefix(s), clip.audio_path)) return jsonError(404, "not_found");
    await found.store.deleteReminderClip(s.id, clip.id);
    publish(s.id, "reminder.clip_added", "Wei Ling deleted one of her reminder recordings", { removed: 1, clip_id: clip.id });
    return NextResponse.json({ ok: true, removed: 1 });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
