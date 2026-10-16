/**
 * /api/prevent — his prevention screen (journey 11; M10; lib/prevent/view.ts).
 *
 * GET   200 PreventView: the doctor's words about tests and follow-ups first, the table's lines for his age and recorded
 *       conditions (our words, each with the table, version and official page), what he marked done, the caveat
 * POST  { item, action: "done" | "undo" | "ask" } (?locale= or the rp_lang cookie: the question's language)
 *         done  he did it (a record with today's date); undo  that record goes; ask  a question for his doctor (origin
 *         preventive; the same words never twice)
 *       200 { action, done?: { id }, question?: { id, outcome } } | 400 | 404 item_not_found | 409 not_listed / not_done
 * 401 not signed in | 403 patient_only (her phone, a scheduled job). Nothing in an answer names the scope.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hisSubject, inputErrorResponse, requestLocale } from "@/lib/profile/http";
import { preventAction, preventView } from "@/lib/prevent/view";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  try {
    return NextResponse.json(await preventView(found.store, found.session, requestLocale(req)));
  } catch (err) {
    return storeErrorResponse(err);
  }
}

const body = z
  .object({
    item: z.string().min(1).max(200),
    action: z.enum(["done", "undo", "ask"]),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  try {
    const r = await preventAction(found.store, found.session, parsed.data.item, parsed.data.action, requestLocale(req));
    if (!r.ok) return jsonError(r.status, r.error);
    return NextResponse.json({
      action: r.action,
      ...(r.doneId ? { done: { id: r.doneId } } : {}),
      ...(r.questionId ? { question: { id: r.questionId, outcome: r.outcome } } : {}),
    });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
