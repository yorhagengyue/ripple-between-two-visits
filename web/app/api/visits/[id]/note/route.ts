/**
 * POST /api/visits/[id]/note — 「先自己记一句」 (C2 track F; real-app 2.14): while a visit waits for its transcript he
 * writes a line of his own about it. It is saved as one of his notes (the note table, exactly like track B's
 * POST /api/notes: source "typed", today's day, his words unchanged, note.logged), tied to the visit by its id
 * (lib/visit/own-note.ts), and shown on that visit's review as 「本人记的」. It is never a line of the visit: nothing
 * quotes it as the doctor's.
 *
 * Body: { text } (one line, up to 300 characters). 201 { note: { id, text, at }, notes: [...] } (his lines about this
 * visit, oldest first). 404 visit_not_found; 409 visit_not_waiting when the visit is not waiting for its transcript
 * (after the text is there he checks the record itself); 400 empty / too_long; 409 too_many.
 * His only: Wei Ling's phone gets 403 patient_only (the demo's family role); her account never reaches his visits here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";
import { visitErrorResponse } from "@/lib/visit/http";
import { addVisitNote, OWN_NOTE_MAX, OwnNoteError, visitNotes } from "@/lib/visit/own-note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noteBody = z.object({ text: z.string().max(OWN_NOTE_MAX * 4) }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, noteBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  const visitId = decodeURIComponent(id);
  try {
    const visit = await found.store.getVisit(found.session.id, visitId);
    if (!visit) return jsonError(404, "visit_not_found");
    if (visit.status !== "awaiting_transcript") return jsonError(409, "visit_not_waiting", "this visit is not waiting for its transcript");
    const note = await addVisitNote(found.store, found.session, visit.id, body.data.text);
    const notes = visitNotes(await found.store.listNotes(found.session.id), visit.id).map((n) => ({ id: n.id, text: n.text, at: n.created_at }));
    return NextResponse.json({ note: { id: note.id, text: note.text, at: note.created_at }, notes }, { status: 201 });
  } catch (err) {
    if (err instanceof OwnNoteError) return jsonError(err.code === "too_many" ? 409 : 400, err.code);
    return visitErrorResponse(err);
  }
}
