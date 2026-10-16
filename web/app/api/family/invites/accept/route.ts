/**
 * POST /api/family/invites/accept — she accepts an invitation while signed in (C2 track D; real-app 2.20, 3.10 step 2).
 *   body { token }   the token from /invite/<token>
 *   200 { link: FamilyLinkView, next: "/f?link=<id>" }: the link waits for him to confirm it is her; until then she
 *       sees nothing of his. Her consent record (family_accept) points at the words she was shown.
 *   404 invite_not_found (or a token that does not match), 409 invite_used / invite_self / link_exists, 410
 *   invite_expired, 401 not_signed_in, 429 too_many { until } (20 an hour per IP; track A's limit, real-app 3.5).
 * She may have no space of her own (a family member who only looks): her own account is enough.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { careLocale, failureResponse } from "@/lib/care/http";
import { acceptInviteAs, familyLinks } from "@/lib/care/links";
import { parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";
// C2 track A (only add): real-app 3.5 「接受邀请，每 IP 每小时 20」 -> 429 too_many { until }
import { refusal } from "@/lib/auth/http";
import { bucketKey, clientIp, hitLimit, LIMITS } from "@/lib/auth/limits";
import { accountDeps } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ token: z.string().trim().min(1).max(200) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const b = await parseBody(req, body);
  if (!b.ok) return b.res;
  try {
    // C2 track A (only add): someone trying tokens from one address is slowed (20 an hour; looser with the developer tools on)
    const limited = await hitLimit(accountDeps().store, `a:ai:${bucketKey("ip", clientIp(req.headers))}`, LIMITS.acceptInvitePerIp);
    if (!limited.ok) return refusal({ ok: false, status: 429, error: "too_many", until: limited.until });
    const now = nowMs();
    const r = await acceptInviteAs(careEntryStore(), found.store, b.data.token, found.user.userId, careLocale(req), now);
    if (!r.ok) return failureResponse(r);
    const view = (await familyLinks(found.store, found.user.userId, now)).find((l) => l.id === r.link.id);
    return NextResponse.json({ link: view, next: `/f?link=${encodeURIComponent(r.link.id)}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
