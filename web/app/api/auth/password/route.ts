/**
 * POST /api/auth/password { current, password } (signed in) -> 200 { ok: true } with new sign-in cookies: the new
 * password is set, every other session of his ends (other devices log in again), this browser keeps going on a new
 * session. Refusals: 401 not_signed_in, 401 wrong_password, 423 locked { until } (the sixth wrong one in 15 minutes on this
 * device), 400 a password problem.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, json, refusal, requestFacts, signedInResponse } from "@/lib/auth/http";
import { changePassword } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ current: z.string().max(200), password: z.string().max(200) }).strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const facts = requestFacts(req);
  const r = await changePassword(accountDeps(), me, body.data, facts);
  if (!r.ok) return refusal(r);
  return signedInResponse(req, facts, r.signedIn, { ok: true });
});
