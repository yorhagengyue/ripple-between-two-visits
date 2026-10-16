/**
 * GET /api/health — liveness for deploy checks: the server time and, by name only, how this process is configured
 * (lib/ops/health.ts): the store, where files go, the identity provider, the main model provider, the checker, the
 * speech and read-aloud providers, whether the scheduled jobs run here, whether this is the real deployment, whether
 * web push can be sent, and the build's id.
 * Never reports keys, URLs or their values, and nothing about people.
 */
import { buildIdOf, healthReport } from "@/lib/ops/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  // ok, store and time are what the deploy checks have always read (scripts/preflight.ts, the multi-instance check)
  return Response.json({ ok: true, ...healthReport(), build: buildIdOf(), time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
