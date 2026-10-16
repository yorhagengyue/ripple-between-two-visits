/**
 * POST /api/push/test — 「发一条试试」 (C2 track I; real-app 2.23): a test notification to the signed-in person's own
 * phones, or to one of them ({ endpoint }). Him or her (requireUser).
 *   200 { sent, devices }   sent: how many push services took it; a phone the push service no longer knows is removed
 *   401 not_signed_in; 503 push_unavailable
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_ENDPOINT_LENGTH } from "@/lib/push/endpoint";
import { pushLocaleFor, sendOwnPush } from "@/lib/push/own";
import { vapidConfig } from "@/lib/push/vapid";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testBody = z.object({ endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH).optional() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  if (!vapidConfig()) return jsonError(503, "push_unavailable");
  const body = await parseBody(req, testBody);
  if (!body.ok) return body.res;
  const { user, scope, store } = found;
  try {
    const counts = await sendOwnPush(store, user.userId, "test", { locale: pushLocaleFor(user.account, req.cookies), patient: !!scope, endpoint: body.data.endpoint });
    const devices = (await store.listPushSubscriptions(user.userId)).length;
    return NextResponse.json({ sent: counts.sent, devices });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
