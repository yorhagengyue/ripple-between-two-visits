/**
 * Developer tool: the process-wide test clock (lib/time/now.ts). 404 unless the developer tools are on
 * (NODE_ENV not production, or RIPPLE_DEV_TOOLS=1; lib/dev/enabled.ts).
 *   GET                                   { now, clock }  (clock null: real time)
 *   POST { at, frozen? }                  jump to a moment (ISO or epoch ms); it keeps flowing unless frozen
 *   POST { offset_ms, frozen? }           real time + offset
 *   POST { advance_ms }                   move the current clock forward (or back) by this much
 *   POST { clear: true } or {}            back to real time
 * Every account's "today" follows it at once (lib/time/clock.ts). It never moves tracking_since: time that passes on
 * the test clock is time that passed (a reminder left unanswered becomes "no reply" at the next tick).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { jsonError, parseBody } from "@/lib/session/http";
import { advanceTestClock, nowIso, setTestClock, testClock } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clockBody = z
  .object({
    at: z.union([z.string().min(1).max(40), z.number()]).optional(),
    offset_ms: z.number().finite().optional(),
    advance_ms: z.number().finite().optional(),
    frozen: z.boolean().optional(),
    clear: z.boolean().optional(),
  })
  .strict();

const notFound = () => jsonError(404, "not_found");

export async function GET(): Promise<Response> {
  if (!devToolsEnabled()) return notFound();
  return NextResponse.json({ now: nowIso(), clock: testClock() });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!devToolsEnabled()) return notFound();
  const body = await parseBody(req, clockBody);
  if (!body.ok) return body.res;
  const b = body.data;
  try {
    if (b.advance_ms !== undefined) advanceTestClock(b.advance_ms);
    else if (b.clear || (b.at === undefined && b.offset_ms === undefined)) setTestClock(null);
    else setTestClock({ at: b.at, offsetMs: b.offset_ms, frozen: b.frozen });
  } catch (err) {
    return jsonError(400, "invalid_clock", err instanceof Error ? err.message : undefined);
  }
  return NextResponse.json({ now: nowIso(), clock: testClock() });
}
