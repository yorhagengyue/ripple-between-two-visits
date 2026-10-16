/**
 * POST /api/meds/manual — a medicine he types in himself (C2 track F; the label photo's other way in, /p/meds/add).
 *
 * Body: { name, origin, slots: ("morning" | "midday" | "evening" | "night")[], strength?, med_id?, locale? }
 * 201 { med, name }: status "unverified", marked as his own entry (label.typed), the slots he chose (dose_slots_source
 * "patient"), from now on. 409 med_exists { detail: { med_id } } when the same medicine is on his list already; 400
 * bad_name. Wei Ling cannot add a medicine for him: 403 patient_only (the demo's family role).
 * med_id: the typed label is for that medicine (a prescription awaiting its label; with his consent to AI processing
 * off no photo is read, so this is how its label gets in). 404 med_not_found; 409 label_mismatch { detail: { questions } }
 * when the name he typed is not that medicine's (nothing is written; his question for the pharmacist is added once).
 * Without med_id, on an account with a medicine waiting for its label, the typed name is held against the waiting ones
 * like a photographed label: its own name goes onto it; when it is not clear, 409 label_which { detail: { waiting,
 * label_name } } and nothing is written (the page asks him and sends again with med_id or other: true).
 * times: 400 bad_time { detail: { slot, from, to } } for a time outside its part of the day (nothing is written).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { denyFamily } from "@/lib/family/role";
import { medsErrorResponse } from "@/lib/meds/http";
import { MED_ORIGINS } from "@/lib/meds/types";
import { addManualMed, MANUAL_NAME_MAX } from "@/lib/meds/write";
import { parseBody } from "@/lib/session/http";
import type { MedOrigin } from "@/lib/store/types";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    name: z.string().min(1).max(MANUAL_NAME_MAX * 4),
    origin: z.enum(MED_ORIGINS as [MedOrigin, ...MedOrigin[]]),
    slots: z.array(z.enum(["morning", "midday", "evening", "night"])).max(4),
    strength: z.string().max(80).nullable().optional(),
    med_id: z.string().trim().min(1).max(100).optional(),
    /** a slot's reminder time ("HH:MM"), asked once when his settings do not say (real-app 2.16) */
    times: z.partialRecord(z.enum(["midday", "evening", "night"]), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).optional(),
    /** "none of the medicines waiting for a label": this is its own medicine */
    other: z.boolean().optional(),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  try {
    const out = await addManualMed(
      { sessionId: found.session.id, name: b.name, origin: b.origin, slots: b.slots, strength: b.strength ?? null, medId: b.med_id, other: b.other, times: b.times, locale: b.locale ?? "zh-Hans" },
      { store: found.store },
    );
    return NextResponse.json(out, { status: 201 });
  } catch (err) {
    return medsErrorResponse(err, "api/meds/manual POST");
  }
}
