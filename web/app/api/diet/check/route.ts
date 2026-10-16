/**
 * POST /api/diet/check — his answer to today's diet question (journey 13; lib/diet/view.ts answerDietCheck).
 * Body: { answer: "yes" | "no" | "unsure" } (有 / 没有 / 不记得). The question is the server's: the one the doctor's newest
 * diet line asks (lib/diet/check.ts). One answer per day; answering again the same day changes it. Never judged.
 *
 * 200 { item, answer } | 400 | 401 | 403 patient_only | 404 | 409 no_diet_check (no doctor's diet line: nothing to ask)
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DIET_ANSWERS } from "@/lib/diet/check";
import { answerDietCheck } from "@/lib/diet/view";
import { hisSubject } from "@/lib/profile/http";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ answer: z.enum(DIET_ANSWERS) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  try {
    const r = await answerDietCheck(found.store, found.session, parsed.data.answer);
    if (!r.ok) return jsonError(r.status, r.error);
    return NextResponse.json({ item: r.item, answer: r.answer });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
