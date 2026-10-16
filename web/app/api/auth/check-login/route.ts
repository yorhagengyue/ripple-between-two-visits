/**
 * POST /api/auth/check-login { login }: is this a login he can sign up with (the sign-up's account screen asks when he
 * taps 下一步)? 200 { ok, kind: "username" | "email" } · 400 with the login problem (login_empty, username_invalid,
 * username_reserved, email_invalid, email_reserved_domain) · 409 login_taken · 429 too_many. Rate-limited per IP.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, json, refusal, requestFacts } from "@/lib/auth/http";
import { checkLogin } from "@/lib/auth/service";
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
  const r = await checkLogin(accountDeps(), body.data.login, requestFacts(req));
  return r.ok ? json({ ok: true, kind: r.kind }) : refusal(r);
});
