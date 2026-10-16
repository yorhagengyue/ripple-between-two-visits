/**
 * /api/meds — the medicine list (spec section 2: 药单增改、确认标签).
 *
 * GET  -> { day, groups } the medicines that exist on the story day, grouped by origin, with their status.
 * POST -> the patient confirmed a label read: { read_token, confirmed: string[], origin?, med_id?, locale? }
 *   read_token  from POST /api/labels/read (the fields are inside it, signed; the client cannot change them)
 *   confirmed   the fields he ticked "right"; every field the label has must be ticked (400 not_all_confirmed)
 *   origin      prescription | self_bought | relative | supplement (needed unless med_id is given)
 *   med_id      put the label on this medicine (409 label_mismatch when it is a different kb drug; on an account the
 *               detail carries his question for the pharmacist, added once)
 *   edits       C2: the fields he changed, with his words (each label field is ticked or changed; a changed one is his,
 *               never quoted as the label's)
 *   slots       C2: when he takes it, when the label's words name no time (else the label's words decide)
 *   times       C2: { midday | evening | night: "HH:MM" } when that slot's reminder comes, asked once when his settings
 *               do not say (real-app 2.16); kept as his own reminder time, never changed by a later request; a time
 *               outside its part of the day is 400 bad_time { detail: { slot, from, to } } and nothing is written
 *   other       C2: his answer "none of the medicines waiting for a label" (see 409 label_which)
 *   409 label_which { detail: { waiting: [{ id, name, zh }], label_name } }  an account with a medicine waiting for
 *       its label, no med_id, and it is not clear whether this label is its own (lib/meds/write.ts waitingMatch):
 *       nothing is written; the page asks him and sends the same request again with med_id (one of `waiting`) or
 *       other: true
 *   201 { med, outcome: "label_confirmed" | "unidentified", created, answer, questions }
 *       answer: for an unidentified medicine, lib/safety's answer (route unknown_med, the fixed sentence) and the
 *       one question it added for the pharmacist. questions: the questions this confirmation added.
 * POST from Wei Ling (family role): 403 patient_only, she cannot confirm a medicine for him (lib/family/role.ts, M6).
 * Session: ?session= or cookie rp_session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { medsErrorResponse } from "@/lib/meds/http";
import { denyFamily } from "@/lib/family/role";
import { listMedGroups } from "@/lib/meds/list";
import { CONFIRM_FIELDS, MED_ORIGINS } from "@/lib/meds/types";
import { confirmLabel } from "@/lib/meds/write";
import { parseBody } from "@/lib/session/http";
import type { MedOrigin } from "@/lib/store/types";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmBody = z
  .object({
    read_token: z.string().min(10).max(20_000),
    confirmed: z.array(z.string().max(40)).max(10),
    origin: z.enum(MED_ORIGINS as [MedOrigin, ...MedOrigin[]]).optional(),
    med_id: z.string().trim().min(1).max(100).optional(),
    /** C2: the fields he changed while checking ("改一下"), with his words */
    edits: z.partialRecord(z.enum(CONFIRM_FIELDS), z.string().max(400)).optional(),
    /** C2: when he takes it, when the label names no time (his choice) */
    slots: z.array(z.enum(["morning", "midday", "evening", "night"])).max(4).optional(),
    /** C2: a slot's reminder time, asked once when his settings do not say */
    times: z.partialRecord(z.enum(["midday", "evening", "night"]), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).optional(),
    /** C2: "none of the medicines waiting for a label": this label is its own medicine */
    other: z.boolean().optional(),
    locale: z.enum(["en", "zh-Hans"]).optional(),
  })
  .strict()
  .refine((b) => b.origin || b.med_id, { message: "origin or med_id is required" });

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "zh-Hans";
  try {
    const day = found.session.story_day;
    return NextResponse.json({ day, groups: await listMedGroups(found.store, found.session.id, day, locale, found.session.story_time) });
  } catch (err) {
    return medsErrorResponse(err, "api/meds GET");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const parsed = await parseBody(req, confirmBody);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  try {
    const res = await confirmLabel({
      sessionId: found.session.id,
      readToken: b.read_token,
      confirmed: b.confirmed,
      origin: b.origin,
      medId: b.med_id,
      edits: b.edits,
      slots: b.slots,
      times: b.times,
      other: b.other,
      locale: b.locale ?? "zh-Hans",
    }, { store: found.store });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    return medsErrorResponse(err, "api/meds POST");
  }
}
