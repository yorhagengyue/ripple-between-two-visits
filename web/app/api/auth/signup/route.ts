/**
 * POST /api/auth/signup (docs/plan/real-app.md 2.2, 3.4): SignupBody (lib/auth/api.ts) -> 201 SignupAnswer
 * { next, recovery_code, login } with the sign-in cookies, the device cookie and rp_lang. The recovery code is in this
 * answer only. Refusals: 400 invalid_body, a login problem or a password problem (password_short, password_long,
 * password_common, password_like_login), 400 consent_required, 409 consent_version (the screen showed an old text),
 * 409 login_taken, 429 too_many { until }. The flow is lib/auth/service.ts signUp; it removes what it made when a step
 * fails.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, refusal, requestFacts, signedInResponse } from "@/lib/auth/http";
import { signUp } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const version = z.string().min(1).max(40);
const schema = z
  .object({
    login: z.string().max(254),
    password: z.string().max(200),
    display_name: z.string().trim().min(1).max(40),
    locale: z.enum(["zh-Hans", "en"]),
    assisted: z.boolean(),
    consents: z
      .object({
        terms_privacy: z.object({ version }).strict(),
        ai_processing: z.object({ decision: z.enum(["granted", "declined"]), version }).strict(),
        example_data: z.object({ version }).strict().optional(),
      })
      .strict(),
    space: z.enum(["blank", "example", "none"]),
  })
  .strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const facts = requestFacts(req);
  const r = await signUp(accountDeps(), body.data, facts);
  if (!r.ok) return refusal(r);
  return signedInResponse(req, facts, r.signedIn, r.answer, 201);
});
