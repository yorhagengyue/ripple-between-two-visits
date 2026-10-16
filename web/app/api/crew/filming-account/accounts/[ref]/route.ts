/**
 * /api/crew/filming-account/accounts/[ref] — one filming account on the director's desk (C2 track J; real-app 5.4 step
 * 3-4, 8.11). Crew only (404 not_found for anyone else, lib/crew/gate.ts). `ref` is the account's code; an account that
 * is not marked as a filming account answers exactly like one that does not exist: 404 not_found.
 *
 *   GET   -> { account }
 *   POST  { action: "seed", scene }               lay it out to a scene (lib/session/beats.ts id)
 *         { action: "seed", day, time }           ... or to a moment of the story (Day 0 to 45, HH:MM)
 *                                                 either with `story`, the director's story sheet (lib/crew/story-edits.ts:
 *                                                 the story is laid out with its changes in; `done.storyEdits` counts them)
 *         { action: "forward", minutes }          move its clock forward by some minutes
 *         { action: "forward", time, date? }      ... or to the next HH:MM (on YYYY-MM-DD when given)
 *         { action: "reminder", slot? }           pop the slot's reminder now (the one still waiting for him)
 *         { action: "no_reply", slot? }           the slot's window closes now with no reply (her alert when he allows it)
 *         { action: "fallback", on }              the scripted fallback for the visit being recorded on his phone today
 *         { action: "end" }                       end filming: the real date again, unmarked
 *         -> 200 { account (null after "end"), done }
 * A refusal is 409 (forward_only, beyond_clock, nothing_waiting, not_laid_out, no_visit) or 400 (unknown_scene, invalid), always
 * with `detail`, a sentence for the director.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  endFilming,
  filmingAccountView,
  findFilming,
  fireReminder,
  FilmingError,
  filmingState,
  moveForward,
  seedToMoment,
  setFilmingFallback,
  simulateNoReply,
} from "@/lib/crew/filming-account";
import { crewGate, crewNotFound } from "@/lib/crew/gate";
import { countStoryEdits, storyEditsSchema } from "@/lib/crew/story-edits";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";
import { filmingEntry } from "@/lib/subject/filming";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slot = z.enum(["morning", "midday", "evening", "night"]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const actionBody = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("seed"), scene: z.string().min(1).max(40).optional(), day: z.number().int().optional(), time: hhmm.optional(), story: storyEditsSchema.optional() })
    .strict(),
  z.object({ action: z.literal("forward"), minutes: z.number().int().min(1).max(7 * 24 * 60).optional(), time: hhmm.optional(), date: isoDate.optional() }).strict(),
  z.object({ action: z.literal("reminder"), slot: slot.optional() }).strict(),
  z.object({ action: z.literal("no_reply"), slot: slot.optional() }).strict(),
  z.object({ action: z.literal("fallback"), on: z.boolean() }).strict(),
  z.object({ action: z.literal("end") }).strict(),
]);

type Params = { params: Promise<{ ref: string }> };

function refusal(err: FilmingError): NextResponse {
  const status = err.code === "invalid" || err.code === "unknown_scene" ? 400 : 409;
  return jsonError(status, err.code, err.message);
}

export async function GET(req: NextRequest, ctx: Params): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  const subject = await findFilming(decodeURIComponent((await ctx.params).ref));
  if (!subject) return crewNotFound();
  return NextResponse.json({ account: await filmingAccountView(subject.scope.id) });
}

export async function POST(req: NextRequest, ctx: Params): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  const body = await parseBody(req, actionBody);
  if (!body.ok) return body.res;
  const subject = await findFilming(decodeURIComponent((await ctx.params).ref));
  if (!subject) return crewNotFound();
  const id = subject.scope.id;
  const realNow = nowMs();
  try {
    const b = body.data;
    let done: unknown;
    switch (b.action) {
      case "seed": {
        const target = b.scene ? { scene: b.scene } : b.day !== undefined && b.time ? { day: b.day, time: b.time } : null;
        if (!target) return jsonError(400, "invalid", "Name a scene, or a day and a time.");
        done = { ...filmingState(await seedToMoment(subject, target, realNow, b.story ?? null)), storyEdits: countStoryEdits(b.story) };
        break;
      }
      case "forward": {
        const to = b.minutes !== undefined ? { minutes: b.minutes } : b.time ? { time: b.time, ...(b.date ? { date: b.date } : {}) } : null;
        if (!to) return jsonError(400, "invalid", "Give the minutes, or a time to move to.");
        done = filmingState(await moveForward(subject, to, realNow));
        break;
      }
      case "reminder":
      case "no_reply": {
        const account = await filmingEntry().accountRow(id);
        const deps = { locale: account?.locale === "en" ? ("en" as const) : ("zh-Hans" as const) };
        done = b.action === "reminder" ? await fireReminder(subject, { slot: b.slot }, realNow, deps) : await simulateNoReply(subject, { slot: b.slot }, realNow, deps);
        break;
      }
      case "fallback": {
        done = await setFilmingFallback(subject, b.on);
        break;
      }
      case "end": {
        const scope = (await subject.store.getSession(id)) ?? subject.scope;
        const row = await endFilming(subject.store, scope, realNow, "director");
        done = { ended: true, ...filmingState(row) };
        break;
      }
    }
    return NextResponse.json({ account: await filmingAccountView(id), done });
  } catch (err) {
    if (err instanceof FilmingError) return refusal(err);
    return storeErrorResponse(err);
  }
}
