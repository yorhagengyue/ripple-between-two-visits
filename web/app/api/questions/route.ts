/**
 * /api/questions — his question list (journey 07 「他能自己加、改、跳过问题」; real-app 2.11; e2e-chains 序 2). Track C.
 *
 * GET  ?locale=en|zh-Hans -> { list } what is still to ask, what the doctor or pharmacist answered (word for word, with
 *      the visit's date and the time point in the recording), what he set aside. Real dates, no day numbers, no scope id.
 * POST { text, for?: "doctor" | "pharmacist", origin?: "own" | "preventive" | "watch_pattern" | "chat" |
 *      "understanding_check" } -> his question goes on the list:
 *        201 { question, outcome: "created" }
 *        200 { question, outcome: "merged" }    the same words were already waiting (no second row)
 *        200 { question, outcome: "reopened" }  the same question he had set aside is back
 *        200 { question, outcome: "answered" }  the doctor already answered it: the list shows the answer
 *      400 text_empty / text_too_long / invalid_body. Never takes a day: the store dates it today.
 * His only: a family subject (her link) and, in a demo, her phone get 403 patient_only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hisSubject, inputErrorResponse, requestLocale } from "@/lib/profile/http";
import { ADDABLE_ORIGINS, addQuestionFor, questionList, questionOut, QUESTION_TEXT_MAX } from "@/lib/profile/questions";
import { parseBody, storeErrorResponse } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addBody = z
  .object({
    text: z.string().max(QUESTION_TEXT_MAX * 4),
    for: z.enum(["doctor", "pharmacist"]).optional(),
    origin: z.enum(ADDABLE_ORIGINS).optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  try {
    return NextResponse.json({ list: await questionList(found.store, found.session, requestLocale(req)) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, addBody);
  if (!body.ok) return body.res;
  try {
    const r = await addQuestionFor(found.store, found.session, { text: body.data.text, for: body.data.for, origin: body.data.origin });
    return NextResponse.json({ question: questionOut(r.question, found.session), outcome: r.outcome }, { status: r.outcome === "created" ? 201 : 200 });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
