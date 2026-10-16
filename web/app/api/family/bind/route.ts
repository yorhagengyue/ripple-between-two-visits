/**
 * POST /api/family/bind — bind by account (line bind; lib/care/bind.ts): a family member types the elder's account, or
 * the elder types the family member's, and the two are linked at once.
 *   body { account, label?, assisted? }
 *       account    what was typed in the account field: a username or an e-mail address
 *       label      how she calls him (「爸爸」, 「妈妈」); without one, his own name
 *       assisted   someone is helping him on his device right now (his record keeps it; absent: what his sign-up recorded)
 *   200 { link, role: "patient" | "family", made, state: "active" | "accepted", next }
 *       link       the link as the caller's own side sees it (FamilyLinkView for her, PatientLinkView for him)
 *       made       false when the two were linked already (nothing is written then)
 *       state      "accepted" only in FAMILY_BIND_MODE=confirm, for a link she started: it waits for his 「是她」
 *       next       /f?link=<id> for her, /p/family/<id> for him
 *   404 account_not_found (not a login, or nobody's: one answer for both), 409 bind_self,
 *   409 bind_wrong_kind { detail: "both_elder" | "both_family" }, 429 too_many { until } (10 an hour per signed-in
 *   person, 30 an hour per IP), 401 not_signed_in.
 *   403 bind_removed: she types the account of an elder who removed her before (he stopped a link with her, or said
 *   「不是」). She does not come back by her own act; he can bind her himself, or invite her and confirm her.
 * The signed-in person may have no space of their own (a family member who only looks): their own account is enough.
 * Another site's write is refused by the proxy before it gets here, as for every family route.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { refusal } from "@/lib/auth/http";
import { clientIp } from "@/lib/auth/limits";
import { bindByAccount } from "@/lib/care/bind";
import { careLocale } from "@/lib/care/http";
import { familyLinks, patientLinks } from "@/lib/care/links";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";
import { accountDeps } from "@/lib/subject/account";
import { bindEntryStore } from "@/lib/subject/bind";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    account: z.string().trim().min(1).max(254),
    label: z.string().trim().max(40).optional(),
    assisted: z.boolean().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    const { store, auth } = accountDeps();
    const me = found.user;
    const r = await bindByAccount(
      { entry: bindEntryStore(), own: found.store, auth, limits: store },
      { userId: me.userId, account: me.account, ip: clientIp(req.headers), locale: careLocale(req), assisted: b.data.assisted },
      { account: b.data.account, label: b.data.label },
    );
    if (!r.ok) {
      if (r.error === "too_many") return refusal({ ok: false, status: 429, error: "too_many", until: r.until });
      return jsonError(r.status, r.error, r.detail);
    }
    const now = nowMs();
    const link =
      r.role === "family"
        ? (await familyLinks(found.store, me.userId, now)).find((l) => l.id === r.link.id)
        : found.scope
          ? (await patientLinks(found.store, careEntryStore(), found.scope, me.userId, now)).find((l) => l.id === r.link.id)
          : undefined;
    return NextResponse.json({ link, role: r.role, made: r.made, state: r.state, next: r.next }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
