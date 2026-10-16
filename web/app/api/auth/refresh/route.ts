/**
 * POST /api/auth/refresh: the browser's shared refresh (lib/session/client.ts), sent once when an API answered 401
 * not_signed_in. The proxy (web/proxy.ts) has already traded the refresh token on the way in when the access token was
 * old or gone, and its new cookies ride on this answer; here only the result is told: 200 { ok: true } while the request
 * is signed in, 401 not_signed_in otherwise (the page then sends him to /login?next=).
 */
import type { NextRequest } from "next/server";
import { accountRoute, guardPost, json } from "@/lib/auth/http";
import { currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  return me ? json({ ok: true }) : json({ error: "not_signed_in" }, 401);
});
