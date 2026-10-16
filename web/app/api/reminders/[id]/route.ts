/**
 * DELETE /api/reminders/[id]?link=<her care link> — 「删掉这段」: one of her own recordings (C2 track D; the daughter brief
 * E3, E5). Every row of hers pointing at that file goes; his phone then plays her next newest recording, else the
 * labelled stand-in. The recording itself goes with them, at once: the file she uploaded (her tag in its name,
 * lib/blob/prefix.ts pathOwnedBy) is removed from his storage once no row points at it (real-app section 10 「她的录音能
 * 听回、能删」). A file that will not go is left to the nightly sweep. Anyone else's clip, and his own account: 404.
 *   200 { ok: true, removed }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getBlobStore, pathOwnedBy } from "@/lib/blob";
import { publish } from "@/lib/bus";
import { herOf, notFound, routeId } from "@/lib/care/http";
import { deleteHerClip } from "@/lib/care/reminders";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const her = herOf(found.subject);
  if (!her) return notFound();
  try {
    const id = await routeId(ctx);
    const file = (await found.store.listReminderClips(found.session.id)).find((c) => c.id === id && c.by_user_id === her.userId)?.audio_path ?? null;
    const removed = await deleteHerClip(found.store, found.session, her.userId, id);
    if (!removed) return notFound();
    // her own upload, and nothing points at it any more: the recording goes now, not at the next sweep
    if (file && pathOwnedBy(found.subject, file) && !(await found.store.listReminderClips(found.session.id)).some((c) => c.audio_path === file)) {
      await getBlobStore()
        .removeObjects("audio", [file])
        .catch(() => 0);
    }
    publish(found.session.id, "reminder.clip_added", "A family member removed a reminder recording", { removed });
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
