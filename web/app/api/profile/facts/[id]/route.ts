/**
 * PATCH /api/profile/facts/[id] — his answer about one fact (M11; real-app 2.5; e2e-chains 12 step 3). Track C.
 *
 * A family member's fact that waits for him:
 *   { answer: "yes" }               对: confirmed (a routine or clinic goes into his settings)
 *   { answer: "edit", text }        改一下: his words, confirmed
 *   { answer: "no" }                不对: hidden (kept for the record, never shown or used)
 * His own fact:
 *   { text }                        new words
 *   { hidden: true }                删掉 (hidden)
 * -> 200 { fact }; 404 not_found; 409 not_pending / hidden; 400 text_empty / text_too_long / invalid_body.
 * His own account (or a demo's patient phone) only: she proposes, only he confirms.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { answerFamilyFact, changeOwnFact, factOut, type FactAnswer } from "@/lib/profile/facts";
import { hisSubject, inputErrorResponse } from "@/lib/profile/http";
import { jsonError, parseBody } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBody = z.union([
  z.object({ answer: z.enum(["yes", "no"]) }).strict(),
  z.object({ answer: z.literal("edit"), text: z.string().max(800) }).strict(),
  z.object({ text: z.string().max(800) }).strict(),
  z.object({ hidden: z.literal(true) }).strict(),
]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.res;
  const id = decodeURIComponent((await ctx.params).id);
  const b = body.data;
  try {
    const r =
      "answer" in b
        ? await answerFamilyFact(found.store, found.session, id, (b.answer === "edit" ? { kind: "edit", text: (b as { text: string }).text } : { kind: b.answer }) as FactAnswer)
        : await changeOwnFact(found.store, found.session, id, "hidden" in b ? { hidden: true } : { text: b.text });
    if (!r.ok) return jsonError(r.status, r.error);
    return NextResponse.json({ fact: factOut(r.fact) });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
