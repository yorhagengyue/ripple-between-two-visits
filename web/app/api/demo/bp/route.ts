/**
 * /api/demo/bp — he corrects or deletes one of today's readings on the demo's blood pressure page (C2 follow-up, track
 * E; real-app 12 「血压记错不能删改 … 当天的读数能删、能改，改动留记录」). The account's page does this through PATCH and
 * DELETE /api/bp; those answer a demo scope 404, so the judge sandbox and the crew's filming session have their own.
 *
 *   PATCH  { id, systolic, diastolic } -> 200 { reading, relay }   today's reading with the new numbers; relay as on
 *          POST /api/bp (null unless the corrected reading is above the doctor's warning line: then 995 and his words)
 *   DELETE { id }                      -> 200 { deleted: id }
 * 404 not_found: no such reading, or one that is not the story day's (earlier days are his record as it stands), or an
 * account. 403 patient_only: Wei Ling's phone (his readings are his). 400: a body that is not the two numbers.
 * The change is kept as it is on an account: a bp.logged event that says "corrected" or "deleted" with the reading
 * (the backstage shows it; the store row holds the numbers that count now). Nothing judges a reading.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { relayFor } from "@/lib/daily/bp";
import { denyFamily } from "@/lib/family/role";
import { DEFAULT_PATIENT_LOCALE, LOCALE_COOKIE, toLocale } from "@/lib/i18n";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import type { BpReadingRow } from "@/lib/store/types";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBody = z
  .object({ id: z.string().min(1).max(80), systolic: z.number().int().min(40).max(300), diastolic: z.number().int().min(20).max(200) })
  .strict();
const deleteBody = z.object({ id: z.string().min(1).max(80) }).strict();

type Found = Extract<Awaited<ReturnType<typeof requireSubject>>, { ok: true }>;

/** His own demo copy, or the refusal. */
async function hisDemo(req: NextRequest): Promise<{ ok: true; found: Found } | { ok: false; res: Response }> {
  const found = await requireSubject(req);
  if (!found.ok) return { ok: false, res: found.res };
  if (found.subject.kind !== "demo") return { ok: false, res: jsonError(404, "not_found") };
  const denied = await denyFamily(req, found.session);
  if (denied) return { ok: false, res: denied };
  return { ok: true, found };
}

/** One of the story day's readings, or null. */
async function todays(found: Found, id: string): Promise<BpReadingRow | null> {
  const day = found.session.story_day;
  return (await found.store.listBp(found.session.id, { fromDay: day, toDay: day })).find((r) => r.id === id) ?? null;
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const his = await hisDemo(req);
  if (!his.ok) return his.res;
  const { found } = his;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.res;
  try {
    const before = await todays(found, body.data.id);
    if (!before) return jsonError(404, "not_found", "only today's readings can be changed");
    const reading = await found.store.updateBp(found.session.id, before.id, { systolic: body.data.systolic, diastolic: body.data.diastolic, state: "recorded" });
    publish(found.session.id, "bp.logged", `Mr Tan corrected a reading to ${reading.systolic}/${reading.diastolic}, Day ${reading.day} ${reading.slot}`, {
      reading,
      corrected: true,
      was: { systolic: before.systolic, diastolic: before.diastolic },
    });
    const locale = toLocale(req.cookies.get(LOCALE_COOKIE)?.value, DEFAULT_PATIENT_LOCALE);
    return NextResponse.json({ reading, relay: await relayFor(found.store, found.session, reading, locale) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const his = await hisDemo(req);
  if (!his.ok) return his.res;
  const { found } = his;
  const body = await parseBody(req, deleteBody);
  if (!body.ok) return body.res;
  try {
    const before = await todays(found, body.data.id);
    if (!before) return jsonError(404, "not_found", "only today's readings can be deleted");
    await found.store.deleteBp(found.session.id, before.id);
    publish(found.session.id, "bp.logged", `Blood pressure, Day ${before.day} ${before.slot}: a reading was deleted`, { reading: before, deleted: true });
    return NextResponse.json({ deleted: before.id });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
