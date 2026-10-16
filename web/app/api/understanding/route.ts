/**
 * The understanding checklist (task M5 item 4).
 *   GET  ?med_id=  -> { view: { medId, items: [{ id, questionId, questionStatus }] } }
 *   POST { med_id, item: "purpose" | "feel_fine" | "when" | "missed", answer: "know" | "unsure", locale? }
 *        -> 200 { item, answer, question, created }
 *        不确定 adds one question for the doctor (origin understanding_check, his own words) and publishes
 *        question.created; 不确定 again returns that same question (created false); 知道 writes nothing.
 *   400 bad body / no session, 404 unknown session or medicine, 409 not_yet (before the explain card exists).
 * No model scores him.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { UNDERSTANDING_ITEMS } from "@/lib/explain/types";
import { answerUnderstanding, ExplainError, understandingView } from "@/lib/explain/understanding";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const answerBody = z
  .object({
    med_id: z.string().min(1).max(100),
    item: z.enum(UNDERSTANDING_ITEMS),
    answer: z.enum(["know", "unsure"]),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const medId = req.nextUrl.searchParams.get("med_id")?.trim();
  if (!medId) return jsonError(400, "med_id_required");
  try {
    const med = await found.store.getMed(found.session.id, medId);
    if (!med) return jsonError(404, "med_not_found");
    return NextResponse.json({ view: await understandingView(found.store, found.session.id, med.id) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, answerBody);
  if (!body.ok) return body.res;
  try {
    const out = await answerUnderstanding(
      { sessionId: found.session.id, medId: body.data.med_id, item: body.data.item, answer: body.data.answer, locale: body.data.locale ?? "zh-Hans" },
      { store: found.store },
    );
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof ExplainError) return jsonError(err.code === "not_yet" ? 409 : 404, err.code);
    return storeErrorResponse(err);
  }
}
