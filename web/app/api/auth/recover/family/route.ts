/**
 * POST /api/auth/recover/family { login, code, password, not_my_phone? } (docs/plan/real-app.md 2.4 step 4, 3.6; track
 * A): he types the 6 digits she read to him, and a new password, on the phone that asked for help. -> 200
 * { next, helper } with the sign-in cookies: the new password is set, every earlier session of his has ended, the
 * request is spent, his switch is as it was, and an account event says she helped (his Today page tells him).
 * Refusals: 401 invalid_family_code (one answer for a wrong account, another phone such as hers or one he never used,
 * no code yet, a wrong or used code, more than 10 minutes, or a helper he switched off since), 400 a password problem,
 * 429 too_many { until }.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { recoverWithFamily } from "@/lib/auth/family-reset";
import { accountRoute, guardPost, refusal, requestFacts, signedInResponse } from "@/lib/auth/http";
import { parseBody } from "@/lib/session/http";
import { accountDeps } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    login: z.string().max(254),
    code: z.string().max(32),
    password: z.string().max(200),
    not_my_phone: z.boolean().optional(),
  })
  .strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const facts = requestFacts(req);
  const r = await recoverWithFamily(accountDeps(), body.data, facts);
  if (!r.ok) return refusal(r);
  return signedInResponse(req, facts, r.signedIn, { next: r.next, helper: r.helper });
});
