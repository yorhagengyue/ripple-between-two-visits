/**
 * GET /api/me (docs/plan/real-app.md 3.4): his account as the app may show it (lib/auth/api.ts MeAnswer): login, display
 * name, language, his space in short, the links where he is the patient and where she is the family member, the latest
 * decision per consent, and whether this sign-in is 「这不是我的手机」. No user id, no scope id, no invitation-token hash.
 * 401 not_signed_in.
 */
import type { NextRequest } from "next/server";
import { accountRoute, json } from "@/lib/auth/http";
import { meAnswer } from "@/lib/auth/service";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = accountRoute(async (req: NextRequest): Promise<Response> => {
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  return json(await meAnswer(accountDeps(), me));
});
