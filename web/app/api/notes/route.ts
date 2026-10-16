/**
 * GET /api/notes — his notes up to the story day (a note written on a later story day is not shown yet).
 * POST /api/notes — { text, source?: "typed" | "voice_note" } a note for the story day, saved as is, nothing
 *   added; publishes note.logged. Returns { note }. (Sentences typed into Today's box go through /api/ask, whose
 *   log_only route saves them as notes the same way.)
 * Both are his only: Wei Ling's phone (family role) gets 403 patient_only (lib/family/role.ts denyFamily); she sees
 * his notes on /f only while he shares them.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { dayWords } from "@/lib/daily/doses";
import { denyFamily } from "@/lib/family/role";
import { detectLang } from "@/lib/safety/text";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noteBody = z
  .object({
    text: z.string().trim().min(1).max(1000),
    source: z.enum(["typed", "voice_note"]).optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  // his notes reach Wei Ling only through /f while he shares them (lib/family/view.ts), never through this route
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  try {
    return NextResponse.json({ notes: await found.store.listNotes(found.session.id, { toDay: found.session.story_day }) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, noteBody);
  if (!body.ok) return body.res;
  try {
    const s = found.session;
    const note = await found.store.addNote(s.id, {
      day: s.story_day,
      text: body.data.text,
      source: body.data.source ?? "typed",
      lang: detectLang(body.data.text),
      app_reply: "logged only",
    });
    const short = note.text.length > 80 ? `${note.text.slice(0, 79)}…` : note.text;
    // an account's sentence names the real date, never a story day (C2 track B)
    publish(s.id, "note.logged", `Noted for ${dayWords(s, s.story_day)}: "${short}"`, { note });
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
