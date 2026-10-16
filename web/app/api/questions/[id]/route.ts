/**
 * /api/questions/[id] — his change to one question (journey 07; real-app 2.11; e2e-chains 序 2). Track C.
 *
 * PATCH one of:
 *   { text }                 new words, his own (an open question; not a pattern question: 409 pattern_words)
 *   { status: "skipped" }    「不问了」 (an open question)
 *   { status: "open" }       「放回去」: a question he set aside, or one he merged (the merge is undone)
 *   { merge_into: "<id>" }   「和上面那条一样 · 合并」: this open question is folded into another one to the same person
 * -> 200 { question, into? }; 404 not_found / into_not_found; 409 answered (the doctor's answer stays with the words
 * he answered), merged, pattern_words, same_question, other_person, into_merged, into_skipped; 400 text_empty /
 * text_too_long / invalid_body. His only, as /api/questions.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hisSubject, inputErrorResponse } from "@/lib/profile/http";
import { changeQuestion, questionOut, QUESTION_TEXT_MAX, type QuestionChange } from "@/lib/profile/questions";
import { jsonError, parseBody } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBody = z.union([
  z.object({ text: z.string().max(QUESTION_TEXT_MAX * 4) }).strict(),
  z.object({ status: z.enum(["skipped", "open"]) }).strict(),
  z.object({ merge_into: z.string().min(1).max(200) }).strict(),
]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.res;
  const id = decodeURIComponent((await ctx.params).id);
  const b = body.data;
  const change: QuestionChange =
    "text" in b ? { kind: "edit", text: b.text } : "merge_into" in b ? { kind: "merge", into: b.merge_into } : b.status === "skipped" ? { kind: "skip" } : { kind: "reopen" };
  try {
    const r = await changeQuestion(found.store, found.session, id, change);
    if (!r.ok) return jsonError(r.status, r.error);
    return NextResponse.json({ question: questionOut(r.question, found.session), ...(r.into ? { into: questionOut(r.into, found.session) } : {}) });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
