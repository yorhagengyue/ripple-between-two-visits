/**
 * POST /api/bp — record a blood pressure reading (task M4 item 3):
 *   demo:    { systolic, diastolic, slot?, day? }  slot defaults from the story clock (before noon morning, after 6pm
 *            evening, else midday; no clock time: morning); day defaults to the story day. { state: "unconfirmed" }
 *            with no numbers records a reading that was due and not taken (未确认). Publishes bp.logged. 201 { reading,
 *            relay } (relay as on an account: null unless the reading is above the doctor's warning line).
 *   account (C2 track B, journey 03): { systolic, diastolic, pulse?, id?, when?, part? } or { state: "unconfirmed" }
 *            (「这次没量」). The day is the server's: today, or yesterday with `when: "yesterday"` (real-app 6.2, like
 *            POST /api/doses); a `day` or `slot` is refused (400). The part of the day is morning or evening by his own
 *            clock (before noon / from noon, real-app 2.9); a reading for yesterday may say which (`part`, else
 *            yesterday's evening). `id` (a uuid his phone made) makes a resend harmless: the same reading comes back.
 *            201 { reading, relay }: relay is track S's relayDoctorThreshold (null unless the reading is above the
 *            doctor's own warning line: then the 995 template first and the doctor's words, verbatim with date, time
 *            point and clip).
 * PATCH /api/bp — an account corrects one of today's readings: { id, systolic, diastolic, pulse? }; the numbers it had
 *   are kept in the reading's history. { id, restore: true } puts back one he deleted today (the undo bar): the same
 *   reading, its time included. 200 { reading, relay }; 404 for a reading that is not today's.
 * DELETE /api/bp — an account deletes one of today's readings: { id }. The row stays as the record of the change
 *   (deleted_at, history; lib/daily/bp-changes.ts) and no list shows it. 200 { deleted: id }; 404 otherwise.
 *            C2 track O (real-app 2.25, a reading kept on the phone while there was no network): `at`, the moment he
 *            tapped, dates the reading (its day, its part of the day, created_at) instead of `when`; 409 too_late when
 *            that day is neither today nor yesterday; 409 other_account when the entry belongs to another account
 *            (lib/offline/owner.ts).
 * GET /api/bp — the screen's data: the demo's (lib/daily/bp.ts bpView: R1 only once said before today, the doctor's
 *   measuring words), an account's (accountBpView: the target he confirmed, the doctor's frequency for today, the
 *   relays of today's readings).
 *
 * Only records and juxtaposes: no evaluation of a reading anywhere in the response.
 * Both are his only: Wei Ling's phone (family role) gets 403 patient_only (lib/family/role.ts denyFamily); she sees
 * a count of readings on /f only while he shares bp_summary.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { publish } from "@/lib/bus";
import { accountBpView, bpView, relayFor } from "@/lib/daily/bp";
import { deleteReading, editReading, recordReading, restoreReading, todaysReading } from "@/lib/daily/bp-changes";
import { dayWords } from "@/lib/daily/doses";
import { denyFamily } from "@/lib/family/role";
import { DEFAULT_PATIENT_LOCALE, LOCALE_COOKIE, toLocale } from "@/lib/i18n";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { daySlot, storyDay } from "@/lib/session/schemas";
import { isAccount } from "@/lib/store/scope";
import type { BpReadingRow, SessionRow } from "@/lib/store/types";
import { isClockTime, parseClockTime } from "@/lib/story/clock";
import { requireSubject } from "@/lib/subject";
// C2 track O: readings that arrive late from the phone's to-send list
import { lateTap } from "@/lib/offline/late";
import { sentForAnotherAccount } from "@/lib/offline/owner";
import { nowMs as appNowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bpBody = z
  .object({
    systolic: z.number().int().min(40).max(300).optional(),
    diastolic: z.number().int().min(20).max(200).optional(),
    slot: daySlot.optional(),
    day: storyDay.optional(),
    state: z.enum(["recorded", "unconfirmed"]).optional(),
  })
  .strict()
  .refine((b) => (b.state === "unconfirmed" ? b.systolic === undefined && b.diastolic === undefined : b.systolic !== undefined && b.diastolic !== undefined), {
    message: "give both numbers, or state unconfirmed with none",
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pulse = z.number().int().min(20).max(250).nullable().optional();

/** An account's reading: no day, no slot (the server's clock decides); `when` says today or yesterday. */
const accountBpBody = z
  .object({
    id: z.string().regex(UUID).optional(),
    systolic: z.number().int().min(40).max(300).optional(),
    diastolic: z.number().int().min(20).max(200).optional(),
    pulse,
    state: z.enum(["recorded", "unconfirmed"]).optional(),
    when: z.enum(["today", "yesterday"]).optional(),
    part: z.enum(["morning", "evening"]).optional(),
    // C2 track O: the moment he tapped, for a reading sent late (an ISO instant)
    at: z.string().min(10).max(40).optional(),
  })
  .strict()
  .refine((b) => (b.state === "unconfirmed" ? b.systolic === undefined && b.diastolic === undefined && (b.pulse ?? null) === null : b.systolic !== undefined && b.diastolic !== undefined), {
    message: "give both numbers, or state unconfirmed with none",
  })
  .refine((b) => b.part === undefined || b.when === "yesterday", { message: "today's part of the day comes from the clock; `part` only with when: yesterday" })
  .refine((b) => b.at === undefined || b.when === undefined, { message: "a reading sent late is dated by `at`; `when` is for one written now" });

const patchBody = z.union([
  z.object({ id: z.string().min(1).max(80), systolic: z.number().int().min(40).max(300), diastolic: z.number().int().min(20).max(200), pulse }).strict(),
  z.object({ id: z.string().min(1).max(80), restore: z.literal(true) }).strict(),
]);

const deleteBody = z.object({ id: z.string().min(1).max(80) }).strict();

function slotFromClock(time: string | null): "morning" | "midday" | "evening" {
  if (!time || !isClockTime(time)) return "morning";
  const m = parseClockTime(time);
  return m < 12 * 60 ? "morning" : m >= 18 * 60 ? "evening" : "midday";
}

function localeOf(req: NextRequest) {
  return toLocale(req.cookies.get(LOCALE_COOKIE)?.value, DEFAULT_PATIENT_LOCALE);
}

function sayOf(s: SessionRow, r: BpReadingRow, verb: string): string {
  return r.state === "unconfirmed"
    ? `Blood pressure, ${dayWords(s, r.day)} ${r.slot}: not taken (unconfirmed)`
    : `${isAccount(s) ? "He" : "Mr Tan"} ${verb} ${r.systolic}/${r.diastolic}, ${dayWords(s, r.day)} ${r.slot}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const s = found.session;
  if (isAccount(s)) {
    // C2 track O: an entry of another account's to-send list is never written here
    if (sentForAnotherAccount(req, found.subject.userId)) return jsonError(409, "other_account");
    const body = await parseBody(req, accountBpBody);
    if (!body.ok) return body.res;
    try {
      const b = body.data;
      // C2 track O: sent late, with the moment he tapped (its own day and part of the day)
      const tap = b.at === undefined ? null : lateTap(s, b.at, appNowMs());
      if (typeof tap === "string") return tap === "too_late" ? jsonError(409, "too_late") : jsonError(400, "invalid", "at is not a time");
      const { reading, again } = await recordReading(found.store, s, {
        id: b.id,
        systolic: b.systolic,
        diastolic: b.diastolic,
        pulse: b.pulse ?? null,
        unconfirmed: b.state === "unconfirmed",
        when: b.when,
        part: b.part,
        tap,
      });
      // a resend (the same uuid): the reading as it is now, nothing written and nothing announced twice
      if (again) return NextResponse.json({ reading, relay: reading.deleted_at ? null : await relayFor(found.store, s, reading, localeOf(req)) }, { status: 200 });
      publish(s.id, "bp.logged", sayOf(s, reading, "recorded"), { reading });
      return NextResponse.json({ reading, relay: await relayFor(found.store, s, reading, localeOf(req)) }, { status: 201 });
    } catch (err) {
      return storeErrorResponse(err);
    }
  }
  const body = await parseBody(req, bpBody);
  if (!body.ok) return body.res;
  try {
    const slot = body.data.slot ?? slotFromClock(s.story_time);
    const day = body.data.day ?? s.story_day;
    const unconfirmed = body.data.state === "unconfirmed";
    const reading = await found.store.addBp(s.id, {
      day,
      slot,
      systolic: unconfirmed ? null : body.data.systolic!,
      diastolic: unconfirmed ? null : body.data.diastolic!,
      state: unconfirmed ? "unconfirmed" : "recorded",
    });
    publish(
      s.id,
      "bp.logged",
      unconfirmed ? `Blood pressure, Day ${day} ${slot}: not taken (unconfirmed)` : `Mr Tan recorded ${reading.systolic}/${reading.diastolic}, Day ${day} ${slot}`,
      { reading },
    );
    // C2 track E (the demo too; real-app 12 「血压 185/112 只说『记下了』」): a reading above the doctor's own warning line
    // brings his words at once, as on an account: the 995 template, then the line with its date, time point and clip
    // (track S's relayDoctorThreshold; null for any other reading, and for 「没量」). Nothing judges the reading.
    return NextResponse.json({ reading, relay: await relayFor(found.store, s, reading, localeOf(req)) }, { status: 201 });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (!isAccount(found.session)) return jsonError(404, "not_found");
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, patchBody);
  if (!body.ok) return body.res;
  try {
    const b = body.data;
    if ("restore" in b) {
      // the undo bar after a delete: the reading he deleted today comes back as it was
      const gone = await todaysReading(found.store, found.session, b.id, { includeDeleted: true });
      if (!gone) return jsonError(404, "not_found", "only a reading deleted today can be put back");
      const reading = gone.deleted_at ? await restoreReading(found.store, found.session, gone) : gone;
      if (gone.deleted_at) publish(found.session.id, "bp.logged", sayOf(found.session, reading, "put back a reading he had deleted:"), { reading, restored: true });
      return NextResponse.json({ reading, relay: await relayFor(found.store, found.session, reading, localeOf(req)) });
    }
    const before = await todaysReading(found.store, found.session, b.id);
    if (!before) return jsonError(404, "not_found", "only today's readings can be changed");
    const reading = await editReading(found.store, found.session, before, { systolic: b.systolic, diastolic: b.diastolic, pulse: b.pulse ?? null });
    publish(found.session.id, "bp.logged", sayOf(found.session, reading, "corrected a reading to"), { reading, corrected: true });
    return NextResponse.json({ reading, relay: await relayFor(found.store, found.session, reading, localeOf(req)) });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  if (!isAccount(found.session)) return jsonError(404, "not_found");
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, deleteBody);
  if (!body.ok) return body.res;
  try {
    const before = await todaysReading(found.store, found.session, body.data.id);
    if (!before) return jsonError(404, "not_found", "only today's readings can be deleted");
    // the row stays as the record of the change (deleted_at and its history); no list shows it any more
    await deleteReading(found.store, found.session, before);
    publish(found.session.id, "bp.logged", `Blood pressure, ${dayWords(found.session, before.day)} ${before.slot}: a reading was deleted`, { reading: { ...before, state: before.state }, deleted: true });
    return NextResponse.json({ deleted: before.id });
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  // readings and R1 reach Wei Ling only as /f's count while he shares bp_summary, never through this route
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  try {
    if (isAccount(found.session)) return NextResponse.json(await accountBpView(found.store, found.session, localeOf(req)));
    return NextResponse.json(await bpView(found.store, found.session));
  } catch (err) {
    return storeErrorResponse(err);
  }
}
