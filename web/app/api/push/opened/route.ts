/**
 * POST /api/push/opened[?link=<her care link>] { delivery } — a notification was tapped (C2 track I; real-app 2.24:
 * 「点开时记 opened_at，于是『他看到提醒』『她看到通知』都有记录」). The service worker calls it from the notification's
 * tap, with that phone's cookies; the delivery id came in the push payload (never a scope id).
 *
 *   his phone   no ?link=: his own space (requireSubject, self). Only his own kinds (his reminders, 「Wei Ling 已经
 *               接受」: lib/push/deliveries.ts HIS_KINDS), never her alert.
 *   her phone   ?link=<her link> (the id her alert's address carries): his space through her active link (family mode).
 *               Only the alert that was sent to that link (kind family_no_reply, ref = the link). This is the one mark
 *               she can leave on his reminders; the scoped store refuses every other row (lib/subject/scoped-store.ts).
 *
 *   200 { recorded: true, opened_at }   the first tap's time stays (a second tap changes nothing)
 *   202 { recorded: false }             a demo device: nothing is written
 *   403 link_not_active / 404 link_not_found   her link ended, or is not hers
 *   404 delivery_not_found              not one of this person's notices of the last few days
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { HER_KINDS, HIS_KINDS, OPENED_LOOKBACK_DAYS } from "@/lib/push/deliveries";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openedBody = z.object({ delivery: z.string().min(1).max(100) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const body = await parseBody(req, openedBody);
  if (!body.ok) return body.res;
  const { subject, session, store } = found;
  const hers = subject.kind === "account" && subject.relation === "family" && !!subject.link;
  const his = subject.kind === "account" && subject.relation === "self";
  if (!hers && !his) return NextResponse.json({ recorded: false }, { status: 202 });
  try {
    const today = session.story_day;
    const row = (await store.listDeliveries(session.id, { fromDay: today - OPENED_LOOKBACK_DAYS, toDay: today })).find((d) => d.id === body.data.delivery);
    // (owner 10-16, only add: her 「爸爸跟 Ripple 说了…」 notice too: HER_KINDS)
    const theirs = !!row && (hers ? HER_KINDS.has(row.kind) && row.ref === subject.link!.id : HIS_KINDS.has(row.kind));
    if (!row || !theirs) return jsonError(404, "delivery_not_found");
    const opened = await store.markDeliveryOpened(session.id, row.id);
    if (!row.opened_at) {
      const said = row.kind === "family_no_reply" ? "A family member opened the no-reply notification on her phone." : "A family member opened a notification on her phone.";
      publish(session.id, "push.opened", hers ? said : "A reminder was opened on the phone.", {
        kind: row.kind,
        slot: row.slot,
        by: hers ? "family" : "patient",
      });
    }
    return NextResponse.json({ recorded: true, opened_at: opened.opened_at });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
