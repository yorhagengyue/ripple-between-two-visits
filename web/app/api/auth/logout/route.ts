/**
 * POST /api/auth/logout { everywhere?: boolean } -> 200 { next: "/login" }, the sign-in cookies cleared. This browser's
 * session ends (or, with everywhere, every session of his: 「退出所有设备」), in the session registry and at the
 * provider. Answers 200 even when nobody was signed in (the cookies go either way). The device cookie stays.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { accountRoute, guardPost, signedOutResponse } from "@/lib/auth/http";
import { logOut } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ everywhere: z.boolean().optional() }).strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const me = await currentUser(req);
  await logOut(accountDeps(), me ? (req.cookies.get(ACCESS_COOKIE)?.value ?? null) : null, body.data.everywhere === true, me?.userId ?? null);
  return signedOutResponse(req, { next: "/login" });
});
