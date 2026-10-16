/**
 * GET /api/family/alerts — "no reply after two reminders" for Wei Ling (task M4 item 5).
 *
 * Demo: { on, alerts: [{ id, day, date, slot, medication_id, name, reminders }] }
 * Only while Mr Tan has switched family_grant.no_reply_alert on; off -> { on: false, alerts: [] } for every role.
 * Each read first settles doses whose reminder window closed with no answer (lib/daily/doses.ts).
 *
 * Her real account (C2 track D, ?link=): { on, alerts: HerNoReplyAlert[] }, track B's familyNoReplyAlerts for her link
 * (the alerts sent to her in the last 7 days, newest first) cut down to what his switches for her link share
 * (lib/care/alerts.ts herAlerts, the rule of her home): with only no_reply_alert on, that there was no reply, when, and
 * whether he answered since and when; only while dose_summary is on too, the slot's medicines by name, what he answered
 * and, for a dose he did not take, the reason he gave in his words (as her home: the owner's decision of 2026-10-14);
 * the reason's code never. no_reply_alert off -> { on: false, alerts: [] }. Nothing is settled or written on her read.
 * His own account: 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { herAlerts } from "@/lib/care/alerts";
import { familyAlerts } from "@/lib/daily/alerts";
import { settleNoReply } from "@/lib/daily/doses";
import { familyNoReplyAlerts } from "@/lib/daily/no-reply";
import { readGrants } from "@/lib/family/grants";
import { storeErrorResponse } from "@/lib/session/http";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  try {
    const store = found.store;
    const link = found.subject.link;
    if (found.subject.kind === "account") {
      if (found.subject.relation !== "family" || !link) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const grants = await readGrants(store, found.session, link.id);
      if (!grants.items.no_reply_alert) return NextResponse.json({ on: false, alerts: [] }, { headers: { "Cache-Control": "no-store" } });
      const alerts = herAlerts(await familyNoReplyAlerts(store, found.session, link.id), grants.items);
      return NextResponse.json({ on: true, alerts }, { headers: { "Cache-Control": "no-store" } });
    }
    // a family read writes nothing of his (the demo's own page still settles on read, as before)
    if (!link) await settleNoReply(store, found.session);
    return NextResponse.json(await familyAlerts(store, found.session));
  } catch (err) {
    return storeErrorResponse(err);
  }
}
