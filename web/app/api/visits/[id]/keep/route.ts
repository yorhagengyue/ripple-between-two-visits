/**
 * POST /api/visits/[id]/keep — keep this visit's recording for good, or not (C2 track F; real-app 2.15: 「页底一行『录音留到
 * 1月7日 · 一直保留』，旁边一个开关。打开时写 consent_record（retention_keep_forever）」). The retention job (journey 15) deletes a
 * recording after retain_until unless keep_forever is set.
 *
 * Body: { keep: boolean, assisted? }. 200 { visit }. An account also keeps the decision as a consent record (granted, or
 * withdrawn when he turns it off) with the version and sha256 of the retention text in force (track H's
 * lib/privacy/consents.ts: consent-texts-more.ts retention_keep_forever, in his language) and assisted (what the
 * request says, else what sign-up recorded). 404 visit_not_found. Wei Ling cannot change it: 403 patient_only (the
 * demo's family role).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { denyFamily } from "@/lib/family/role";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { assistedEvidence, consentStamp } from "@/lib/privacy/consents";
import { jsonError, parseBody } from "@/lib/session/http";
import { isAccount } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";
import { nowIso } from "@/lib/time/now";
import { helpedOnDevice } from "@/lib/visit/consent";
import { visitErrorResponse } from "@/lib/visit/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ keep: z.boolean(), assisted: z.boolean().optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const { id } = await ctx.params;
  const visitId = decodeURIComponent(id);
  try {
    const visit = await found.store.getVisit(found.session.id, visitId);
    if (!visit) return jsonError(404, "visit_not_found");
    const updated = await found.store.updateVisit(found.session.id, visit.id, { keep_forever: parsed.data.keep });
    if (isAccount(found.session) && found.session.owner_user_id) {
      // the words his screen stands for, in his language: the record carries their version and sha256
      const stamp = consentStamp("retention_keep_forever", req.cookies.get(LOCALE_COOKIE)?.value === "en" ? "en" : "zh-Hans");
      const assisted = await helpedOnDevice(found.store, found.session.owner_user_id, parsed.data.assisted);
      await found.store.addConsentRecord({
        user_id: found.session.owner_user_id,
        scope_id: found.session.id,
        kind: "retention_keep_forever",
        decision: parsed.data.keep ? "granted" : "withdrawn",
        version: stamp.version,
        text_sha256: stamp.text_sha256,
        method: "tap",
        evidence: { visit_id: visit.id, at: nowIso(), locale: stamp.locale, ...assistedEvidence(assisted) },
        assisted,
      });
    }
    publish(found.session.id, "visit.changed", `Visit ${visit.id}: recording ${parsed.data.keep ? "kept for good" : "kept until its date"}`, { visit: updated, keep_forever: parsed.data.keep });
    return NextResponse.json({ visit: updated });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
