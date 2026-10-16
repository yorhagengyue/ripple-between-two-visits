/**
 * POST /api/auth/recover (docs/plan/real-app.md 2.4, 3.6): { login, code, password, not_my_phone? } -> 200
 * { next, recovery_code } with the sign-in cookies. The code he used stops working; the new one is in this answer only;
 * every other session of his ends; this device's login lock is lifted. Refusals: 401 invalid_recovery (never says which
 * half was wrong), 400 a password problem, 429 too_many { until } (5 an hour per login, 20 per IP).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, refusal, requestFacts, signedInResponse, withDevice } from "@/lib/auth/http";
import { recover } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    login: z.string().max(254),
    code: z.string().max(64),
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
  const r = await recover(accountDeps(), body.data, facts);
  if (!r.ok) return withDevice(refusal(r), req, facts);
  return signedInResponse(req, facts, r.signedIn, { next: r.next, recovery_code: r.code });
});
