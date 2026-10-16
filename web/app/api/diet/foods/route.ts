/**
 * POST /api/diet/foods — the hawker dishes he picked (journey 13: 他常吃的小贩中心食物由他自己选). Body: { foods: string[] }
 * (ids from kb/diet.json foods; unknown ids are dropped). Kept in his account's settings (diet_foods).
 * 200 { foods } | 400 | 401 | 403 patient_only | 404 (also a demo session: it keeps no picks and shows no picker)
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { setFoods } from "@/lib/diet/view";
import { hisSubject } from "@/lib/profile/http";
import { jsonError, parseBody, storeErrorResponse } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ foods: z.array(z.string().max(40)).max(30) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const found = await hisSubject(req);
  if (!found.ok) return found.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  try {
    const foods = await setFoods(found.store, found.session, parsed.data.foods);
    if (!foods) return jsonError(404, "not_found");
    return NextResponse.json({ foods });
  } catch (err) {
    return storeErrorResponse(err);
  }
}
