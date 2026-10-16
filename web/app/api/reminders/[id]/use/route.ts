/**
 * POST /api/reminders/[id]/use?link=<her care link> — 「换回这段」: one of her older recordings plays again (C2 track D;
 * the daughter brief E5). A fresh row pointing at the same file and words, so it is her newest (lib/family/clips.ts
 * preferredClip). Anyone else's clip, and his own account: 404.
 *   200 { ok: true, id }.
 * Line bind (only add): 409 link_not_acknowledged while he has not acknowledged her link (lib/care/ack.ts). A clip of
 * hers from an earlier link is still hers by her user id, so without this it could play again through a link she bound
 * herself.
 */
import { NextResponse, type NextRequest } from "next/server";
import { publish } from "@/lib/bus";
import { herOf, notFound, routeId } from "@/lib/care/http";
import { useHerClip } from "@/lib/care/reminders";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
// line bind (only add)
import { LINK_NOT_ACKNOWLEDGED, linkAcknowledged } from "@/lib/care/ack";
import { bindEntryStore } from "@/lib/subject/bind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const her = herOf(found.subject);
  if (!her) return notFound();
  try {
    // line bind (only add): a link he has not acknowledged plays nothing on his phone
    if (found.subject.link && !(await linkAcknowledged(bindEntryStore(), found.subject.link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
    const row = await useHerClip(found.store, found.session, her.linkId, her.userId, await routeId(ctx));
    if (!row) return notFound();
    publish(found.session.id, "reminder.clip_added", "A family member chose a reminder recording again", { clip: { id: row.id } });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
