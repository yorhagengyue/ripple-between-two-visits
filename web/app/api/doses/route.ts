/**
 * POST /api/doses — dose check-in (spec section 2, task M4 item 1):
 *   demo:    { medication_id, slot, state: "taken" | "missed" | "unconfirmed", day?, reason?, reason_text? }
 *            day defaults to the story day; one row per (medicine, day, slot), a later answer replaces an earlier one.
 *            - 等下 is unconfirmed with reason "later";
 *            - 没吃 then a reason: reason is a chip code (forgot, away, not_with_me, <routine>_morning) or "own_words"
 *              with reason_text in his words;
 *            - undo posts the previous answer again, or unconfirmed with reason "undone" when there was none.
 *   account (C2 track B): { medication_id, slot, state, reason?, reason_text?, when?: "today" | "yesterday" }. The day is
 *            the server's (real-app 2.8): a `day` field is refused (400). The answer is written as a fresh row (when he
 *            answered), for a cell that is his: 404 no such medicine, 409 not_due (not taken in that slot that day).
 *            C2 track O (real-app 2.25, an answer kept on the phone while there was no network): `at`, the moment he
 *            tapped, dates the answer and its day (`when` is then counted from the tap); 409 too_late when that day is
 *            neither today nor yesterday; 409 other_account when the entry belongs to another account
 *            (lib/offline/owner.ts); 200 { dose, kept: true } when his later answer already stands (lib/offline/late.ts).
 *   Wei Ling (family role) cannot answer for him: 403 patient_only (lib/family/role.ts, M6).
 *   Publishes dose.logged. After a missed dose the routine pattern question is brought up to date
 *   (lib/daily/patterns.ts). Returns { dose }.
 * DELETE /api/doses — an account's undo (C2 track B; e2e-chains 序 24): { medication_id, slot, when?, restore? }. The
 *   cell's row is deleted (no answer again), or the answer he had before (restore) is put back. 200 { dose | null }.
 *   The demo has no DELETE (404): its undo writes "undone", as before.
 * GET /api/doses?from=&to=&medication_id= — the dose log (inclusive day range). Every read first settles doses
 *   whose reminder window has closed with no answer (unconfirmed, reason "no_reply"; lib/daily/doses.ts): the demo by
 *   the story clock, an account its tracked cells of yesterday and today.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { answerDose, checkIn, DoseAnswerError, settleNoReply, undoDose } from "@/lib/daily/doses";
import { syncPatternQuestions } from "@/lib/daily/patterns";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { daySlot, doseBody, doseState } from "@/lib/session/schemas";
import { isAccount } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";
// C2 track O: answers that arrive late from the phone's to-send list
import { lateDose } from "@/lib/offline/late";
import { sentForAnotherAccount } from "@/lib/offline/owner";
import { nowMs as appNowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const when = z.enum(["today", "yesterday"]);

/** An account's answer: no day (the server picks today or yesterday). */
const accountDoseBody = z
  .object({
    medication_id: z.string().min(1).max(80),
    slot: daySlot,
    state: doseState,
    reason: z.string().max(40).nullable().optional(),
    reason_text: z.string().max(200).nullable().optional(),
    when: when.optional(),
    // C2 track O: the moment he tapped, for an answer sent late (an ISO instant)
    at: z.string().min(10).max(40).optional(),
  })
  .strict();

const undoBody = z
  .object({
    medication_id: z.string().min(1).max(80),
    slot: daySlot,
    when: when.optional(),
    restore: z
      .object({ state: doseState, reason: z.string().max(40).nullable().optional(), reason_text: z.string().max(200).nullable().optional() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

function answerError(err: unknown): NextResponse {
  if (err instanceof DoseAnswerError) {
    if (err.code === "not_found") return jsonError(404, "not_found", err.message);
    if (err.code === "not_due") return jsonError(409, "not_due", err.message);
    return jsonError(400, "invalid", err.message);
  }
  return storeErrorResponse(err);
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const store = found.store;
  if (isAccount(found.session)) {
    // C2 track O: an entry of another account's to-send list is never written here
    if (sentForAnotherAccount(req, found.subject.userId)) return jsonError(409, "other_account");
    const body = await parseBody(req, accountDoseBody);
    if (!body.ok) return body.res;
    try {
      const { at, ...answer } = body.data;
      // C2 track O: sent late, with the moment he tapped
      const late = at === undefined ? null : await lateDose(store, found.session, answer, at, appNowMs());
      if (late && "refused" in late) return late.refused === "too_late" ? jsonError(409, "too_late") : jsonError(400, "invalid", "at is not a time");
      if (late && "stands" in late) return NextResponse.json({ dose: late.stands, kept: true });
      const dose = await answerDose(store, found.session, late ? { ...answer, late } : answer);
      if (dose.state === "missed") await syncPatternQuestions(store, found.session);
      return NextResponse.json({ dose });
    } catch (err) {
      return answerError(err);
    }
  }
  const body = await parseBody(req, doseBody);
  if (!body.ok) return body.res;
  try {
    const dose = await checkIn(store, found.session, body.data);
    if (dose.state === "missed") await syncPatternQuestions(store, found.session);
    return NextResponse.json({ dose });
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
  const body = await parseBody(req, undoBody);
  if (!body.ok) return body.res;
  try {
    const dose = await undoDose(found.store, found.session, body.data);
    await syncPatternQuestions(found.store, found.session);
    return NextResponse.json({ dose });
  } catch (err) {
    return answerError(err);
  }
}

function dayParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

export async function GET(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const q = req.nextUrl.searchParams;
  try {
    const store = found.store;
    await settleNoReply(store, found.session);
    const doses = await store.listDoses(found.session.id, {
      fromDay: dayParam(q.get("from")),
      toDay: dayParam(q.get("to")),
      medication_id: q.get("medication_id") ?? undefined,
    });
    return NextResponse.json({ doses });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
