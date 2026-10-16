/**
 * POST /api/profile/facts — a fact for his profile (M11; real-app 2.5; e2e-chains 12 step 2). Track C.
 *
 * { kind: "name" | "age" | "home" | "language" | "condition" | "allergy" | "clinic" | "routine" | "other", text, data? }
 * -> 201 { fact }
 *   on his own account: his fact (source patient, confirmed as he writes it)
 *   through her care link (?link=<id>, track D's /f): her proposal (source family, unconfirmed, by her and her link); it
 *   waits for his 对 / 改一下 / 不对 and is used nowhere until then
 * 400 kind_unknown / text_empty / text_too_long / invalid_body.
 * C2 track D (only add), for her proposals only (lib/care/facts.ts familyFactProblem): 400 kind_not_for_family (her
 * kinds are condition, allergy, clinic, routine, other), text_clinical (a dose or a reading in her words),
 * routine_invalid (a routine must be the breakfast entry with a real time), data_not_allowed (no other kind has data).
 * Line bind (only add), for her proposals only: 409 link_not_acknowledged while he has not acknowledged her link
 * (lib/care/ack.ts): her words would go on his phone as 「… 写了：……对吗？」.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { addFact, FACT_KINDS, factOut, type FactAuthor } from "@/lib/profile/facts";
import { hisSubject, inputErrorResponse } from "@/lib/profile/http";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
// C2 track D (only add): what a family member may propose
import { familyFactProblem } from "@/lib/care/facts";
// line bind (only add): what she proposes reaches his phone, so it waits for his acknowledgement of her link
import { LINK_NOT_ACKNOWLEDGED, linkAcknowledged } from "@/lib/care/ack";
import { bindEntryStore } from "@/lib/subject/bind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factBody = z
  .object({
    kind: z.enum(FACT_KINDS),
    text: z.string().max(800),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const body = await parseBody(req, factBody);
  if (!body.ok) return body.res;
  const s = found.subject;
  const author: FactAuthor =
    s.relation === "family" && s.userId && s.link ? { kind: "family", userId: s.userId, linkId: s.link.id, label: s.link.family_label } : { kind: "patient" };
  // C2 track D (only add): her words go on his phone as 「Wei Ling 写了：……」, and his 「对」 puts a routine into his settings
  if (author.kind === "family") {
    // line bind (only add): a link he has not acknowledged proposes nothing
    try {
      if (s.link && !(await linkAcknowledged(bindEntryStore(), s.link))) return jsonError(409, LINK_NOT_ACKNOWLEDGED);
    } catch (err) {
      return storeErrorResponse(err);
    }
    const problem = familyFactProblem(body.data);
    if (problem) return jsonError(400, problem);
  }
  try {
    const fact = await addFact(found.store, found.session, { kind: body.data.kind, text: body.data.text, data: body.data.data ?? null }, author);
    return NextResponse.json({ fact: factOut(fact) }, { status: 201 });
  } catch (err) {
    return inputErrorResponse(err);
  }
}
