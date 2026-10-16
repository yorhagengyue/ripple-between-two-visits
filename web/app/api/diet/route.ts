/**
 * GET /api/diet — his diet screen (journey 13; M16; lib/diet/view.ts dietView): the doctor's own words about food
 * first, the day's check while there is such a line, the last 7 days' answers (counts only), the official lines for the
 * conditions recorded about him and for the hawker dishes he picked (each with its source and review date), the
 * leaflet's grapefruit line while amlodipine is on his list, and the referral for a special diet.
 *
 * 200 DietView | 400 no session | 401 not signed in | 403 patient_only (her phone, a scheduled job) | 404
 * Nothing in the answer names the scope.
 */
import { NextResponse, type NextRequest } from "next/server";
import { dietView } from "@/lib/diet/view";
import { hisSubject, requestLocale } from "@/lib/profile/http";
import { storeErrorResponse } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  try {
    return NextResponse.json(await dietView(found.store, found.session, requestLocale(req)));
  } catch (err) {
    return storeErrorResponse(err);
  }
}
