/**
 * /api/push/subscribe — this phone gets Ripple's notifications, or stops (C2 track I; real-app 2.6, 8.10). For the
 * signed-in person, him or her (a family member has no space of her own: requireUser, not requireSubject).
 *
 *   POST { endpoint, keys: { p256dh, auth }, expirationTime?, welcome? }
 *        -> 201 { subscribed: true, sent: 1 }   the subscription is kept (one row per endpoint: subscribing again
 *           updates it, and a phone that was someone else's becomes this person's) and 「提醒已经开好了」 went to this
 *           phone only. Turning reminders on counts only when that notice could be sent (real-app 2.6: 他看得到才算
 *           成功), so:
 *        -> 200 { subscribed: false, sent: 0 }   the welcome did not get through: the push service does not know
 *           this subscription (404/410) or did not take the message (an error, a timeout). The row is gone again;
 *           nothing changed, and the phone may try once more
 *        -> 201 { subscribed: true, sent: 0 }   only with welcome: false (the service worker renewing a subscription
 *           that was already proven): kept, nothing sent
 *        400 endpoint_invalid / endpoint_not_allowed (only the browsers' push services: lib/push/endpoint.ts) /
 *            keys_invalid; 401 not_signed_in; 503 push_unavailable (no VAPID keys here)
 *   DELETE { endpoint } -> 200 { removed }   only the person's own row with that endpoint
 *   DELETE { all: true } -> 200 { removed, count }   every phone of this person (「退出所有设备」: lib/push/client.ts
 *        forgetPushOnSignOut), so no phone he signed out of keeps getting his reminders
 * Publishes push.subscribed / push.unsubscribed on his space (counts only; her phone's stream drops push.*).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEVICE_COOKIE } from "@/lib/auth/cookies";
import { deviceHash, isDeviceId } from "@/lib/auth/device";
import { publish } from "@/lib/bus";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { checkEndpoint, checkKeys, MAX_ENDPOINT_LENGTH } from "@/lib/push/endpoint";
import { pushLocaleFor, sendOwnPush } from "@/lib/push/own";
import { vapidConfig } from "@/lib/push/vapid";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscribeBody = z
  .object({
    endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
    expirationTime: z.number().nullable().optional(),
    welcome: z.boolean().optional(),
  })
  .strict();

const unsubscribeBody = z.union([z.object({ endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH) }).strict(), z.object({ all: z.literal(true) }).strict()]);

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  if (!vapidConfig()) return jsonError(503, "push_unavailable");
  const body = await parseBody(req, subscribeBody);
  if (!body.ok) return body.res;
  const endpoint = checkEndpoint(body.data.endpoint, { devTools: devToolsEnabled() });
  if (!endpoint.ok) return jsonError(400, endpoint.error);
  if (!checkKeys(body.data.keys)) return jsonError(400, "keys_invalid");
  const { user, scope, store } = found;
  try {
    await store.savePushSubscription({
      user_id: user.userId,
      endpoint: body.data.endpoint,
      p256dh: body.data.keys.p256dh,
      auth: body.data.keys.auth,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200) || null,
      // C2 track D (only add): which of his devices this is (the rp_device cookie's hash, as his sign-in sessions hold
      // it), so 「退出这台」 from another phone takes this subscription with it (lib/auth/service.ts signOutDevice)
      device_hash: deviceOf(req),
    });
    let sent = 0;
    if (body.data.welcome !== false) {
      const locale = pushLocaleFor(user.account, req.cookies);
      const counts = await sendOwnPush(store, user.userId, "welcome", { locale, patient: !!scope, endpoint: body.data.endpoint });
      // 他看得到才算成功 (real-app 2.6): a welcome the push service did not take leaves no subscription behind. A phone
      // it does not know (404/410) took its row with it already; any other failure takes it here.
      if (counts.sent < 1) {
        if (counts.gone < 1) await store.deleteOwnPushSubscription(user.userId, body.data.endpoint);
        return NextResponse.json({ subscribed: false, sent: 0 });
      }
      sent = counts.sent;
    }
    const devices = (await store.listPushSubscriptions(user.userId)).length;
    if (scope) publish(scope.id, "push.subscribed", "This phone can now receive Ripple's reminders as notifications.", { count: devices });
    return NextResponse.json({ subscribed: true, sent }, { status: 201 });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

/** C2 track D (only add): this browser's device, as the store keeps it; null without the cookie. */
function deviceOf(req: NextRequest): string | null {
  const cookie = req.cookies.get(DEVICE_COOKIE)?.value;
  return isDeviceId(cookie) ? deviceHash(cookie) : null;
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, unsubscribeBody);
  if (!body.ok) return body.res;
  const { user, scope, store } = found;
  try {
    if ("all" in body.data) {
      let count = 0;
      for (const row of await store.listPushSubscriptions(user.userId)) if (await store.deleteOwnPushSubscription(user.userId, row.endpoint)) count += 1;
      if (count && scope) publish(scope.id, "push.unsubscribed", "No phone receives Ripple's notifications any more.", { count: 0 });
      return NextResponse.json({ removed: count > 0, count });
    }
    const removed = await store.deleteOwnPushSubscription(user.userId, body.data.endpoint);
    if (removed && scope) publish(scope.id, "push.unsubscribed", "This phone no longer receives Ripple's notifications.", { count: (await store.listPushSubscriptions(user.userId)).length });
    return NextResponse.json({ removed });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
