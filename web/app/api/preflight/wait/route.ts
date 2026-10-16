/**
 * GET /api/preflight/wait?ms=30000 — answers after `ms` milliseconds (capped at 35 s).
 * Used by `npm run preflight -- --url <preview>` to check that the hosting platform lets a request run
 * for 30 seconds (web-app.md section 2, item 9). Holds no data.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MS = 35_000;

export async function GET(req: NextRequest): Promise<Response> {
  const asked = Number(req.nextUrl.searchParams.get("ms") ?? "30000");
  const ms = Number.isFinite(asked) ? Math.min(Math.max(0, Math.floor(asked)), MAX_MS) : 30_000;
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  return Response.json({ waited_ms: Date.now() - started });
}
