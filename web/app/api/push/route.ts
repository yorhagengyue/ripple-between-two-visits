/**
 * GET /api/push[?endpoint=…] — where this person's notifications stand (C2 track I). Him or her (requireUser).
 *   200 { configured, subscribed, devices, recent }
 *       configured   this server can send (VAPID keys, lib/push/vapid.ts)
 *       subscribed   the endpoint given (this phone's) is one of this person's subscriptions
 *       devices      how many phones of this person get notifications
 *       recent       his own reminders of yesterday and today: { kind, slot, date, sent_at, opened_at } (empty for her)
 *   401 not_signed_in
 */
import { NextResponse, type NextRequest } from "next/server";
import { recentReminders } from "@/lib/push/deliveries";
import { vapidConfig } from "@/lib/push/vapid";
import { storeErrorResponse } from "@/lib/session/http";
import { requireUser } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const { user, scope, store } = found;
  try {
    const subs = await store.listPushSubscriptions(user.userId);
    const endpoint = req.nextUrl.searchParams.get("endpoint");
    return NextResponse.json(
      {
        configured: vapidConfig() !== null,
        subscribed: !!endpoint && subs.some((s) => s.endpoint === endpoint),
        devices: subs.length,
        recent: scope ? await recentReminders(store, scope) : [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return storeErrorResponse(err);
  }
}
