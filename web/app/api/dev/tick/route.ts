/**
 * Developer tool: run the scheduled jobs once (lib/jobs/runner.ts), now. 404 unless the developer tools are on.
 *   POST { names?: string[], force?: boolean (default true) }  ->  { now, reports: [{ job, outcome, counts }] }
 * Tests and journey scripts move the test clock (POST /api/dev/clock) and then tick, instead of waiting for the
 * JOBS=1 loop.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { runDueJobs } from "@/lib/jobs/runner";
import { jsonError, parseBody } from "@/lib/session/http";
import { nowIso } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tickBody = z
  .object({
    names: z.array(z.string().min(1).max(64)).max(50).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  if (!devToolsEnabled()) return jsonError(404, "not_found");
  const body = await parseBody(req, tickBody);
  if (!body.ok) return body.res;
  const reports = await runDueJobs({ names: body.data.names, force: body.data.force ?? true });
  return NextResponse.json({ now: nowIso(), reports });
}
