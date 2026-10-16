/**
 * /api/meds/[id] — one medicine.
 *
 * GET   ?locale=en|zh-Hans -> { med, card } the card as the patient sees it (lib/meds/card: every line through
 *       lib/safety's checks, each with its source chip).
 * PATCH { action: "relabel" } -> a new bag for this medicine: status awaiting_label until he photographs and
 *       confirms the new label (409 cannot_relabel for an unidentified medicine).
 * PATCH { action: "patient_status", status: "not_taking" | "bring_to_doctor" | null } (C2) -> a medicine nobody
 *       identified: what he says he does with it; bring_to_doctor also puts his question for the doctor on the list
 *       (one row for the same words). 200 { med, question }. 409 not_unidentified for any other medicine.
 * Session: ?session= or cookie rp_session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildMedCardView } from "@/lib/meds/card";
import { denyFamily } from "@/lib/family/role";
import { MedsError } from "@/lib/meds/errors";
import { medsErrorResponse } from "@/lib/meds/http";
import { relabelMed, setMedPatientStatus } from "@/lib/meds/write";
import { parseBody } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("relabel") }).strict(),
  // C2: a medicine nobody identified: what he does with it (「没在吃」, 「带去给医生看」 adds his question for the doctor)
  z
    .object({ action: z.literal("patient_status"), status: z.enum(["not_taking", "bring_to_doctor"]).nullable(), locale: z.enum(["en", "zh-Hans"]).optional() })
    .strict(),
]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const { id } = await ctx.params;
  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "zh-Hans";
  try {
    const store = found.store;
    const med = await store.getMed(found.session.id, decodeURIComponent(id));
    if (!med) throw new MedsError("med_not_found", `no medicine ${id}`);
    const card = await buildMedCardView(store, found.session.id, med, { day: found.session.story_day, locale });
    return NextResponse.json({ med, card });
  } catch (err) {
    return medsErrorResponse(err, "api/meds/[id] GET");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const parsed = await parseBody(req, patchBody);
  if (!parsed.ok) return parsed.res;
  const { id } = await ctx.params;
  try {
    const b = parsed.data;
    if (b.action === "patient_status") {
      const out = await setMedPatientStatus({ sessionId: found.session.id, medId: decodeURIComponent(id), status: b.status, locale: b.locale ?? "zh-Hans" }, { store: found.store });
      return NextResponse.json(out);
    }
    return NextResponse.json({ med: await relabelMed({ sessionId: found.session.id, medId: decodeURIComponent(id) }, { store: found.store }) });
  } catch (err) {
    return medsErrorResponse(err, "api/meds/[id] PATCH");
  }
}
