/**
 * /api/crew/filming-account — his own account as the filming account (C2 track J; real-app 5.4 step 2, 8.11). For the film
 * crew only: without the crew's cookie or key every method answers 404 not_found, like a route that does not exist
 * (lib/crew/gate.ts: a wrong typed key included). The account is always the signed-in one: nobody marks or ends
 * another person's account here, and an account is a filming account only after its owner marked it on his own phone.
 *
 *   GET     -> { filming, ref, date, time }               where his account stands; `ref` is its code on the director's desk
 *   POST    -> 200 { filming: true, ref, date, time }      mark it (nothing else changes until the director acts)
 *   DELETE  -> 200 { filming: false, ref, date, time }     end filming from his phone: the real date again, unmarked
 *
 * 401 not_signed_in without his sign-in; 404 not_found for a signed-in person with no space of their own. No story day,
 * no scope id in any answer (his phone's JSON).
 */
import { NextResponse, type NextRequest } from "next/server";
import { endFilming, filmingState, markFilming } from "@/lib/crew/filming-account";
import { crewGate, crewNotFound } from "@/lib/crew/gate";
import { storeErrorResponse } from "@/lib/session/http";
import type { SessionRow } from "@/lib/store/types";
import { requireUser } from "@/lib/subject";
import { nowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** His phone's view: no story day, no id. */
function ownView(scope: SessionRow) {
  const s = filmingState(scope);
  return { filming: s.filming, ref: s.ref, date: s.date, time: s.time };
}

async function his(req: NextRequest) {
  const gate = await crewGate(req);
  if (gate) return { ok: false as const, res: gate };
  const found = await requireUser(req);
  if (!found.ok) return found;
  if (!found.scope) return { ok: false as const, res: crewNotFound() };
  return { ok: true as const, scope: found.scope, store: found.store };
}

export async function GET(req: NextRequest): Promise<Response> {
  const me = await his(req);
  if (!me.ok) return me.res;
  return NextResponse.json(ownView(me.scope));
}

export async function POST(req: NextRequest): Promise<Response> {
  const me = await his(req);
  if (!me.ok) return me.res;
  try {
    return NextResponse.json(ownView(await markFilming(me.store, me.scope)));
  } catch (err) {
    return storeErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const me = await his(req);
  if (!me.ok) return me.res;
  try {
    const row = await endFilming(me.store, me.scope, nowMs(), "patient");
    return NextResponse.json(ownView((await me.store.getSession(me.scope.id)) ?? row));
  } catch (err) {
    return storeErrorResponse(err);
  }
}
