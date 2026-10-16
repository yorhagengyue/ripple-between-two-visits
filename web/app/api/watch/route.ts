/**
 * GET /api/watch — his watch screen's data (journey 12; lib/watch/view.ts): the three numbers (resting heart rate, sleep,
 * steps) against his own usual range, the last weeks' averages, and the one observation he has not answered yet.
 * Blood pressure is never in it. The example account's synthetic watch is laid out on first read (示例数据).
 *
 * 200 WatchView | 400 no session | 401 not signed in | 403 patient_only (her phone, a scheduled job) | 404
 * Nothing in the answer names the scope.
 */
import { NextResponse, type NextRequest } from "next/server";
import { hisSubject, requestLocale } from "@/lib/profile/http";
import { storeErrorResponse } from "@/lib/session/http";
import { watchView } from "@/lib/watch/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  try {
    return NextResponse.json(await watchView(found.store, found.session, requestLocale(req)));
  } catch (err) {
    return storeErrorResponse(err);
  }
}
