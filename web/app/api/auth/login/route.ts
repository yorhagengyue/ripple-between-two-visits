/**
 * POST /api/auth/login (docs/plan/real-app.md 2.3, 3.5): { login, password, not_my_phone?, next? } -> 200 { next } with
 * the sign-in cookies (session cookies for 「这不是我的手机」), the device cookie and rp_lang. Refusals: 401
 * invalid_credentials (never says which half was wrong), 423 locked { until } (this device, from the sixth wrong
 * password within 15 minutes, for 15 minutes; the recovery code still works), 429 too_many { until } (per IP). From the
 * tenth wrong password for one login within an hour, over all devices, the answer first waits 2, 4, 8 ... 60 s and is
 * then the usual one (lib/auth/limits.ts has the exact rule).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, refusal, requestFacts, signedInResponse, withDevice } from "@/lib/auth/http";
import { logIn } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    login: z.string().max(254),
    password: z.string().max(200),
    not_my_phone: z.boolean().optional(),
    next: z.string().max(512).optional(),
  })
  .strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const facts = requestFacts(req);
  const r = await logIn(accountDeps(), body.data, facts);
  if (!r.ok) return withDevice(refusal(r), req, facts);
  return signedInResponse(req, facts, r.signedIn, { next: r.next });
});
