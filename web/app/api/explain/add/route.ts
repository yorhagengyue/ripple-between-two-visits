/**
 * POST /api/explain/add?link=<her care link>: 「加入待问问题」 on a family member's sheet (owner's decision of 2026-10-14:
 * the long press is on the family side too, with the same sheet, add-to-list included).
 *
 * Body: { subject_type, subject_ref, locale?: "en" | "zh-Hans" }: what she held, as for POST /api/explain. NEVER the
 * question's words: the server builds them again from his records as she may see them (lib/explain/evidence.ts, her
 * viewer), so nothing she could type reaches his list from here. The words are the family frame around the thing's
 * name (lib/explain/copy.ts askAboutText: 「关于{name}，想请医生说明。」), for the doctor or the pharmacist as the thing
 * says.
 * 200 { outcome: "created" | "merged" | "reopened" | "answered", added: true }
 * 400 bad body | 401 not signed in | 403 family_only (his own account, a demo session), not_shared (he does not share
 * his questions with her: 「要问医生的问题」 is off), link_not_active | 404 not_found (no such thing, or not hers to hold,
 * or nothing to add: it is a question on his list already), link_not_found | 409 link_not_acknowledged (she bound the
 * link herself and he has not answered yet: nothing of hers reaches his phone until he does, lib/care/ack.ts, as for
 * POST /api/family/questions) | 500
 *
 * Her store reads his space and cannot write a question (lib/subject/scoped-store.ts family mode); the write is
 * lib/care/family-questions.ts addFamilyQuestion's, which puts it on his list as hers through this link.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { LINK_NOT_ACKNOWLEDGED } from "@/lib/care/ack";
import { addFamilyQuestion } from "@/lib/care/family-questions";
import { buildEvidence } from "@/lib/explain/evidence";
import { herViewer } from "@/lib/explain/family";
import { HOLD_TYPES, REF_MAX } from "@/lib/explain/subjects";
import { requestLocale } from "@/lib/profile/http";
import { readOnce } from "@/lib/safety/read-once";
import { StoreError } from "@/lib/store";
import { requireSubject } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    subject_type: z.enum(HOLD_TYPES),
    subject_ref: z.string().max(REF_MAX).default(""),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  // nothing else is read: a `text` in the body is refused, not ignored
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const { subject, session, store } = found;
  if (subject.kind !== "account" || subject.relation !== "family") return Response.json({ error: "family_only" }, { status: 403 });

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    body = parsed.data;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const locale = body.locale ?? requestLocale(req);

  try {
    const ro = readOnce(store);
    const her = await herViewer({ subject, session, store: ro }, locale);
    if (!her) return Response.json({ error: "family_only" }, { status: 403 });
    // his questions are not shared with her: she cannot put one on his list; nor before he has acknowledged her link
    const may = await her.mayAdd();
    if (may === "not_shared") return Response.json({ error: "not_shared" }, { status: 403 });
    if (may !== "ok") return Response.json({ error: LINK_NOT_ACKNOWLEDGED }, { status: 409 });
    if (!her.mayHold(body.subject_type)) return Response.json({ error: "not_found" }, { status: 404 });
    // the thing again, as she may see it now: its name is the question's subject. No model is asked, nothing is translated
    const evidence = await buildEvidence({ store: ro, scope: session, subject: { type: body.subject_type, ref: body.subject_ref }, locale, nowMs: nowMs(), aiAllowed: false, viewer: her.evidence });
    if (!evidence?.ask) return Response.json({ error: "not_found" }, { status: 404 });
    const { outcome } = await addFamilyQuestion(store, session, { linkId: her.linkId, userId: her.userId, text: evidence.ask.text, for: evidence.ask.for });
    // "aside": he set these words aside on his list, and nothing was put back
    return Response.json({ outcome, added: outcome !== "aside" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof StoreError && e.code === "session_not_found") return Response.json({ error: "session_not_found" }, { status: 404 });
    console.error("[api/explain/add] failed", (e as Error).message);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
