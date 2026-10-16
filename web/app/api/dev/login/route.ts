/**
 * Developer tool: sign this browser in as an existing test account (lib/subject/dev.ts), or out. 404 unless the
 * developer tools are on. Real log-in and log-out are track A's /api/auth/login and /api/auth/logout.
 *   POST { login, password }   200 { ok: true } and the rp_at / rp_rt cookies; 401 invalid_credentials
 *   DELETE                     200 { ok: true }, both cookies cleared
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clearAuthCookies, isSecureRequest, setAuthCookies } from "@/lib/auth/cookies";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { jsonError, parseBody } from "@/lib/session/http";
import { devSignIn } from "@/lib/subject/dev";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginBody = z.object({ login: z.string().min(1).max(254), password: z.string().min(1).max(200) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  if (!devToolsEnabled()) return jsonError(404, "not_found");
  const body = await parseBody(req, loginBody);
  if (!body.ok) return body.res;
  const tokens = await devSignIn(body.data.login, body.data.password);
  if (!tokens) return jsonError(401, "invalid_credentials");
  const res = NextResponse.json({ ok: true });
  setAuthCookies(res, tokens, isSecureRequest(req));
  return res;
}

export async function DELETE(req: NextRequest): Promise<Response> {
  if (!devToolsEnabled()) return jsonError(404, "not_found");
  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res, isSecureRequest(req));
  return res;
}
