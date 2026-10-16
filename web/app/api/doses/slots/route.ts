/**
 * POST /api/doses/slots — when he takes a medicine, in his own words (C2 track B; real-app 2.16 「没有时间词时，由他自己选
 * 「早上 / 中午 / 晚上 / 睡前」，标「你选的时间」」). Accounts only (the demo: 404).
 *
 * Body: { medication_id, slots: ("morning" | "midday" | "evening" | "night")[] } (one to four, each once). Only a
 * prescription medicine on his list. Writes dose_slots with dose_slots_source "patient"; a medicine that had no time
 * of day until now (or no start moment) starts at this moment, so his reminders start with the next window
 * (lib/daily/cells.ts cellActive) and no earlier day is ever settled as "no reply" for a time he had not chosen yet.
 * Publishes med.changed. 200 { medication: { id, dose_slots, dose_slots_source } }.
 * Wei Ling (family role): 403 patient_only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { doseSlotsOf, sortSlots } from "@/lib/daily/slots";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { daySlot } from "@/lib/session/schemas";
import { isAccount } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";
import { scopeNowIso } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slotsBody = z
  .object({
    medication_id: z.string().min(1).max(80),
    slots: z.array(daySlot).min(1).max(4),
  })
  .strict()
  .refine((b) => new Set(b.slots).size === b.slots.length, { message: "each slot once" });

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (!isAccount(found.session)) return jsonError(404, "not_found");
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, slotsBody);
  if (!body.ok) return body.res;
  try {
    const store = found.store;
    const med = await store.getMed(found.session.id, body.data.medication_id);
    if (!med || med.origin !== "prescription") return jsonError(404, "not_found");
    const slots = sortSlots(body.data.slots);
    // the medicine had no time of day yet: its cells begin now (the days since its label was confirmed were never asked)
    const firstChoice = doseSlotsOf(found.session, med).slots.length === 0;
    const row = await store.updateMed(found.session.id, med.id, { dose_slots: slots, dose_slots_source: "patient", ...(med.start_at && !firstChoice ? {} : { start_at: scopeNowIso(found.session) }) /* C2 track J (filming): the account's own clock */ });
    publish(found.session.id, "med.changed", "He said when he takes one of his medicines.", { kind: "slots.chosen", med: { id: row.id, drug_id: row.drug_id, origin: row.origin }, slots });
    return NextResponse.json({ medication: { id: row.id, dose_slots: row.dose_slots ?? slots, dose_slots_source: row.dose_slots_source ?? "patient" } });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
