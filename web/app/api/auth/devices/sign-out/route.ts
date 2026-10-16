/**
 * POST /api/auth/devices/sign-out { device } (signed in) -> 200 { ended, current }: every open sign-in on that device
 * ends (its tokens stop working at once). Naming this very device signs this browser out as well (its cookies are
 * cleared). 401 not_signed_in · 404 device_not_found (not one of his).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountRoute, guardPost, json, refusal, requestFacts, signedOutResponse } from "@/lib/auth/http";
import { signOutDevice } from "@/lib/auth/service";
import { parseBody } from "@/lib/session/http";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ device: z.string().max(64) }).strict();

export const POST = accountRoute(async (req: NextRequest): Promise<Response> => {
  const bad = guardPost(req);
  if (bad) return bad;
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  const body = await parseBody(req, schema);
  if (!body.ok) return body.res;
  const r = await signOutDevice(accountDeps(), me, body.data.device, requestFacts(req));
  if (!r.ok) return refusal(r);
  return r.current ? signedOutResponse(req, { ended: r.ended, current: true }) : json({ ended: r.ended, current: false });
});
