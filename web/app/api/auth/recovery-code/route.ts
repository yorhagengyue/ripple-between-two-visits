/**
 * POST /api/auth/recovery-code { password } (signed in) -> 200 { recovery_code }: a new recovery code, shown this once;
 * the old one stops working. Refusals: 401 not_signed_in, 401 wrong_password, 423 locked { until }.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, json, refusal, requestFacts, withDevice } from "@/lib/auth/http";
import { regenerateRecoveryCode } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().max(200) }).strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const facts = requestFacts(req);
  const r = await regenerateRecoveryCode(accountDeps(), me, body.data, facts);
  if (!r.ok) return withDevice(refusal(r), req, facts);
  return withDevice(json({ recovery_code: r.code }), req, facts);
});
