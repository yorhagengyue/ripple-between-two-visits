/**
 * POST /api/auth/recover/help { login } (signed out; docs/plan/real-app.md 2.4 step 2, 3.6; track A): he asks his family
 * to help him reset a forgotten password. -> 200 { expires_at, helpers: ["Wei Ling"] }: a request that lasts 10 minutes
 * and is bound to this browser's device (rp_device); she is then given a 6-digit code on her own phone
 * (POST /api/family/links/[id]/reset-code) and he types it here (POST /api/auth/recover/family).
 * Refusals: 403 help_unavailable (one answer for an unknown login, a phone he has not used in the last 180 days, or no
 * family member switched on: it never says which), 429 too_many { until } (three requests per account a day; 20 an hour
 * per IP).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requestFamilyHelp } from "@/lib/auth/family-reset";
import { accountRoute, guardPost, json, refusal, requestFacts } from "@/lib/auth/http";
import { parseBody } from "@/lib/session/http";
import { accountDeps } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ login: z.string().max(254) }).strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const r = await requestFamilyHelp(accountDeps(), body.data, requestFacts(req));
  return r.ok ? json({ expires_at: r.expires_at, helpers: r.helpers }) : refusal(r);
});
