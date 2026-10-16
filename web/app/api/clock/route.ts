/**
 * POST /api/clock — move the story clock (the crew's remote; broadcast to every device in the session).
 *   body: { day, time? }            jump to a day of the story ("HH:MM" or null; omitted time = no time shown)
 *      or { beat: "next" | "prev" | <beat id> }   (scenes in lib/session/beats.ts)
 *      show: true (optional)        with a scene: every patient phone of the session opens that scene's page
 *                                   (lib/crew/story.ts pageForBeat; the director's scene buttons send it)
 *   The clock runs from Day 0 to Day 45: the story (its records end on Day 43) and two quiet days after it
 *   (lib/crew/story.ts CLOCK_LAST_DAY); any other day is 400 outside_story, with a plain sentence;
 *   409 { error: "end_of_story" | "start_of_story" }, 400 { error: "unknown_beat" }.
 *   A visit replay still running in the session is stopped first (real-status: a rollback mid-replay kept pushing the
 *   later visit's sentences). Publishes clock.changed with the updated session row. Returns { session, beat }.
 *
 * The crew's only (lib/crew/gate.ts): without the crew's cookie or key, 404 not_found, the same as a route that does not
 * exist; an account (whose day is the real date) is 404 too. Wei Ling's phone in a demo session may not move it: 403
 * patient_only (lib/family/role.ts denyFamily; the proxy gate answers her first).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { stopReplays, showOnPhones } from "@/lib/crew/director";
import { crewGate } from "@/lib/crew/gate";
import { inStory, OUTSIDE_STORY, pageForBeat } from "@/lib/crew/story";
import { denyFamily } from "@/lib/family/role";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { ClockError, moveClock } from "@/lib/session/ops";
import { clockTime } from "@/lib/session/schemas";
import { requireDemoSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** lib/session/schemas.ts clockBody, plus the director's `show` (the day is checked against the story below). */
const directorClockBody = z
  .object({
    day: z.number().int().optional(),
    time: clockTime.nullable().optional(),
    beat: z.string().min(1).max(40).optional(),
    show: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.day !== undefined || b.beat !== undefined, { message: "give day or beat" });

export async function POST(req: NextRequest): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  // the story clock is the demo's: an account (whose day is the real date) gets 404
  const found = await requireDemoSubject(req);
  if (!found.ok) return found.res;
  const denied = await denyFamily(req, found.session);
  if (denied) return denied;
  const body = await parseBody(req, directorClockBody);
  if (!body.ok) return body.res;
  const { day, time, beat, show } = body.data;
  if (day !== undefined && !inStory(day)) return jsonError(400, "outside_story", OUTSIDE_STORY);
  try {
    await stopReplays(found.store, found.session, "clock");
    const out = await moveClock(found.store, found.session, beat !== undefined ? { beat } : { day, time });
    if (show && out.beat) showOnPhones(found.session.id, pageForBeat(out.beat.id), "scene", out.beat.id);
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof ClockError) return jsonError(err.code === "unknown_beat" ? 400 : 409, err.code);
    return storeErrorResponse(err);
  }
}
