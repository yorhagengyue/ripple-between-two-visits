/**
 * POST /api/visits/[id]/extract — a chunk of finished sentences from the realtime transcription: store them,
 * infer who said each (with the roles already decided and the last lines as context), extract the items
 * and return the visit screen's data. Publishes asr.final, utterance.role, card.created (and
 * scripted_fallback when the filming-only fallback replaced a sentence).
 *
 * Body: { utterances: [{ id?, t_start_ms, t_end_ms, speaker_cluster?, lang?, text }], fallback?: boolean }
 * `fallback` switches the scripted fallback for this visit, for the crew only (C2 track E, real-app 5.2: the one gate,
 * lib/crew/gate.ts isCrew; the rp_crew cookie or the crew key header): a request with the flag from anyone else is 404
 * not_found, like POST /api/visits/[id]/scripted; with the crew, 403 fallback_filming_only in a judge sandbox.
 *
 * Any chunk size: the mock replay sends one sentence at a time; a realtime client may send what it heard in
 * the last 10-15 s (web-app.md section 8). 200 { utterances, view, new_cards }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { crewNotFound, isCrew } from "@/lib/crew/gate";
import { parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { processChunk } from "@/lib/visit/pipeline";
import { extractBody } from "@/lib/visit/schemas";
import { requireDemoSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  // sentences from the browser are never "what the doctor said" on an account: its record comes only from the server's
  // own transcription (C2 trust boundary); the replay client is the demo's. An account gets 404.
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, extractBody);
  if (!body.ok) return body.res;
  // the fallback flag is the crew's switch: for anyone else it does not exist (the sentences alone are still welcome
  // without the flag)
  if (body.data.fallback !== undefined && !(await isCrew(req))) return crewNotFound();
  const { id } = await ctx.params;
  try {
    const r = await processChunk(found.store, found.session, decodeURIComponent(id), body.data.utterances, { fallback: body.data.fallback });
    return NextResponse.json({ utterances: r.utterances, view: r.view, new_cards: r.newCards });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
