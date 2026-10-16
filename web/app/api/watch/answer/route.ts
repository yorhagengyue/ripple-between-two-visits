/**
 * POST /api/watch/answer — his 要 / 不要 to the watch's observation (journey 12; lib/watch/today.ts answerWatch).
 *
 * Body: { key: "rhr:above" | ..., answer: "yes" | "no" } (?locale= or the rp_lang cookie: the question's language)
 *   yes  a question for the doctor goes on his list (origin watch_pattern; never a visit item)
 *   no   only this look is kept
 * Either way the same stretch is not raised again, and nothing more from the watch today.
 * 200 { answer, question: { id, outcome } | null } | 400 bad body | 401 | 403 patient_only | 404 | 409 nothing_to_answer
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hisSubject, inputErrorResponse, requestLocale } from "@/lib/profile/http";
import { jsonError, parseBody } from "@/lib/session/http";
import { answerWatch } from "@/lib/watch/today";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    key: z.string().regex(/^(?:rhr|sleep|steps):(?:above|below)$/),
    answer: z.enum(["yes", "no"]),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  try {
    const r = await answerWatch(found.store, found.session, parsed.data.key, parsed.data.answer, requestLocale(req));
    if (!r.ok) return jsonError(r.status, r.error);
    // 要 publishes question.created through addQuestionFor; the watch's own event (watch.synced) is only for data arriving
    return NextResponse.json({ answer: r.answer, question: r.questionId ? { id: r.questionId, outcome: r.outcome } : null });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
