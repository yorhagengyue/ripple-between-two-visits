/**
 * Developer tool: make a test account and sign this browser in (lib/subject/dev.ts). 404 unless the developer tools are
 * on. Real sign-up is track A's /api/auth/signup.
 *   POST { login, password, display_name?, locale?, space?: "blank" | "example" | "none", onboarding?, today?, assisted? }
 *     201 { user_id, login, space, scope: { kind, d0, story_day, example_data } | null } and the rp_at / rp_rt cookies
 *     409 login_taken; 400 with the login-name problem (login_empty, username_invalid, username_reserved,
 *     email_invalid, email_reserved_domain)
 * The user id is in the answer because this is a test tool (tests assert it never appears anywhere else).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { isSecureRequest, setAuthCookies } from "@/lib/auth/cookies";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { jsonError, parseBody } from "@/lib/session/http";
import { StoreError } from "@/lib/store";
import { createDevAccount } from "@/lib/subject/dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountBody = z
  .object({
    login: z.string().min(1).max(254),
    password: z.string().min(1).max(200),
    display_name: z.string().max(80).nullable().optional(),
    locale: z.enum(["en", "zh-Hans"]).nullable().optional(),
    space: z.enum(["blank", "example", "none"]).optional(),
    onboarding: z.enum(["started", "done"]).nullable().optional(),
    today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // C2 track C: sign-up's 「家人帮我操作」
    assisted: z.boolean().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  if (!devToolsEnabled()) return jsonError(404, "not_found");
  const body = await parseBody(req, accountBody);
  if (!body.ok) return body.res;
  try {
    const a = await createDevAccount(body.data);
    const res = NextResponse.json(
      {
        user_id: a.userId,
        login: a.login.kind === "username" ? a.login.username : a.login.email,
        space: body.data.space ?? "blank",
        scope: a.scope ? { kind: a.scope.kind, d0: a.scope.d0, story_day: a.scope.story_day, example_data: a.scope.example_data } : null,
      },
      { status: 201 },
    );
    setAuthCookies(res, a.tokens, isSecureRequest(req));
    return res;
  } catch (err) {
    if (err instanceof AuthError && err.code === "user_exists") return jsonError(409, "login_taken");
    if (err instanceof StoreError && err.code === "conflict") return jsonError(409, "login_taken");
    if (err instanceof AuthError && err.code === "invalid") return jsonError(400, err.message);
    throw err;
  }
}
