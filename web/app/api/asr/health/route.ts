/**
 * GET /api/asr/health — which speech provider this server uses and, for whisper or tencent, whether the service can be
 * used now. Never returns the service address, the token or a key.
 *
 *   public:   { provider, whisper?: { configured, reachable, ready, healthy, reason? } }
 *   crew:     + { status, device, models, gpu, token: "ok" | "rejected", stuck_workers, replay_fallback }, for the
 *             filming checklist and the M14 e2e (replay_fallback: ASR_REPLAY_FALLBACK, whether a failing service may
 *             hand the visit screen to the sample replay). "Crew" is lib/crew/gate.ts isCrew (the rp_crew cookie or the
 *             crew key header), the one gate of every crew-only page and route (real-app 5.2). The hardware and model
 *             names stay off the public answer; anyone else gets the public answer, with no sign that there is more.
 *
 * reason: not_configured:<why> | unreachable | timeout | loading | engine_error | stuck | unauthorized (the
 * service refuses WHISPER_TOKEN: web/.env and services/whisper/.env differ).
 *
 * tencent (lib/asr/tencent.ts): { provider: "tencent", tencent: { configured, reachable, ready, healthy, reason? } } from
 * a check that recognises nothing (DescribeTaskStatus for a task that does not exist; nothing is billed): asked now for
 * the crew, otherwise the answer kept from the last minute.
 * reason: not_configured:<no_keys | no_secret_id | no_secret_key | bad_region | bad_engine | bad_endpoint> |
 * not_configured:service_not_enabled | not_configured:no_balance | unauthorized (the key pair is wrong) | unreachable |
 * timeout | busy | http_*. Crew: + { region, engine }.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSpeechProvider, getWhisperProvider, speechProviderName, TencentSpeechProvider, WhisperUnavailable } from "@/lib/asr";
import { isCrew } from "@/lib/crew/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  let provider: string;
  try {
    provider = speechProviderName();
  } catch {
    return NextResponse.json({ provider: "invalid" }, { status: 500 });
  }
  if (provider === "tencent") {
    const tencent = getSpeechProvider();
    if (!(tencent instanceof TencentSpeechProvider)) return NextResponse.json({ provider });
    const crew = await isCrew(req);
    const crewOnly = crew ? { region: tencent.config.region, engine: tencent.config.engine } : {};
    if (tencent.config.problem) {
      return NextResponse.json({ provider, tencent: { configured: false, reachable: false, ready: false, healthy: false, reason: `not_configured:${tencent.config.problem}`, ...crewOnly } });
    }
    // the crew's checklist asks now; anyone else gets the answer kept from the last minute (a public route must not
    // become a way to send requests to the vendor in our name)
    const reason = await tencent.probe(crew ? tencent.config.requestTimeoutMs : undefined);
    const reachable = reason !== "unreachable" && reason !== "timeout";
    return NextResponse.json({ provider, tencent: { configured: true, reachable, ready: !reason, healthy: !reason, ...(reason ? { reason } : {}), ...crewOnly } });
  }
  const whisper = getWhisperProvider();
  if (!whisper) return NextResponse.json({ provider });
  const crew = await isCrew(req);
  const configured = whisper.config.problem === null;
  if (!configured) {
    return NextResponse.json({ provider, whisper: { configured, reachable: false, ready: false, healthy: false, reason: `not_configured:${whisper.config.problem}` } });
  }
  try {
    const h = await whisper.client.health({ auth: true });
    const reason =
      h.tokenOk === false ? "unauthorized" : !h.ready ? (h.status === "error" ? "engine_error" : "loading") : h.healthy === false ? (h.status === "stuck" ? "stuck" : "unhealthy") : undefined;
    const usable = !reason;
    return NextResponse.json({
      provider,
      whisper: {
        configured,
        reachable: true,
        ready: h.ready,
        healthy: usable,
        ...(reason ? { reason } : {}),
        ...(crew
          ? {
              status: h.status,
              device: h.device,
              models: h.models,
              gpu: h.gpu,
              token: h.tokenOk === false ? "rejected" : h.tokenOk === true ? "ok" : "unknown",
              stuck_workers: h.stuckWorkers,
              replay_fallback: whisper.replayFallback,
            }
          : {}),
      },
    });
  } catch (err) {
    const reason = err instanceof WhisperUnavailable ? err.reason : "unreachable";
    return NextResponse.json({ provider, whisper: { configured, reachable: false, ready: false, healthy: false, reason, ...(crew ? { replay_fallback: whisper.replayFallback } : {}) } });
  }
}
