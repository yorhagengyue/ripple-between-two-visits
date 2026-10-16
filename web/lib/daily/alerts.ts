/**
 * "No reply after two reminders" for Wei Ling (task M4 item 5). Server-only.
 *
 * An alert exists for a morning dose recorded unconfirmed with reason "no_reply": the answer window closed after
 * the first and the second reminder (schedule.ts), or the director simulated exactly that in filming. Wei Ling
 * gets it only while Mr Tan has switched family_grant.no_reply_alert on; with it off the answer is empty and
 * says so (on: false), whatever role asks. Only the last seven story days, nothing after the story day.
 */
import { medName } from "@/lib/session/today";
import type { SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { d0Of } from "./doses";
import type { FamilyAlert, FamilyAlertsResponse } from "./types";

export const ALERT_DAYS = 7;
export const FAMILY_MEMBER = "wei-ling";

export async function familyAlerts(store: Store, session: SessionRow): Promise<FamilyAlertsResponse> {
  const grant = await store.getFamilyGrant(session.id, FAMILY_MEMBER);
  if (!grant?.items.no_reply_alert) return { on: false, alerts: [] };
  const day = session.story_day;
  const d0 = d0Of(session);
  const [doses, meds] = await Promise.all([store.listDoses(session.id, { fromDay: Math.max(0, day - ALERT_DAYS + 1), toDay: day }), store.listMeds(session.id)]);
  const alerts: FamilyAlert[] = doses
    .filter((d) => d.state === "unconfirmed" && d.reason === "no_reply")
    .map((d) => {
      const med = meds.find((m) => m.id === d.medication_id);
      return {
        id: d.id,
        day: d.day,
        date: storyDate(d0, d.day),
        slot: d.slot,
        medication_id: d.medication_id,
        name: med ? medName(med) : d.medication_id,
        reminders: 2,
      };
    })
    .sort((a, b) => b.day - a.day);
  return { on: true, alerts };
}
