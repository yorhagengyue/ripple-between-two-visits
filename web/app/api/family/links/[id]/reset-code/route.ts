/**
 * /api/family/links/[id]/reset-code (docs/plan/real-app.md 2.4 step 3, 3.6, 3.10 「她自己的动作：拿协助重设的码」; track A,
 * a new file in track D's folder). Hers, for one of her own active links, and only while he has switched her on as his
 * helper (care_link.reset_helper):
 *   GET  -> 200 { enabled, pending, expires_at }: is he asking for help right now? Her /f asks this; it reads nothing
 *           of his records and writes nothing.
 *   POST -> 200 { code, expires_at }: a 6-digit code for his open request, in this answer only (the server keeps its
 *           hash). She reads it to him; it works only typed on the phone he asked from. 409 helper_off (he has not
 *           switched her on), 409 no_request (he is not asking, or his 10 minutes have passed), 429 too_many { until }
 *           (three codes for his account a day).
 * Refusals: 401 not_signed_in, 404 link_not_found (no such link, or not hers), 403 link_not_active.
 *
 * This is her own action as herself, like accepting an invitation: it does not go through his space (no ?link=, no
 * family-mode store), and it never tells her his password or changes what he shares.
 */
import type { NextRequest } from "next/server";
import { issueFamilyResetCode, pendingFamilyHelp } from "@/lib/auth/family-reset";
import { accountRoute, guardPost, json, refusal } from "@/lib/auth/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = accountRoute(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const { id } = await ctx.params;
  const r = await pendingFamilyHelp(accountDeps(), me, id);
  return r.ok ? json({ enabled: r.enabled, pending: r.pending, expires_at: r.expires_at }) : refusal(r);
});

export const POST = accountRoute(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const { id } = await ctx.params;
  const r = await issueFamilyResetCode(accountDeps(), me, id);
  return r.ok ? json({ code: r.code, expires_at: r.expires_at }) : refusal(r);
});
