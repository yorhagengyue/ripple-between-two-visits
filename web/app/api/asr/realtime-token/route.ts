/**
 * POST /api/asr/realtime-token — how the browser gets its live captions (spec section 2). The speech
 * provider's keys never reach the browser.
 *
 * Body: { visit_id? }. 200 { provider, token, expires_at, ... }.
 *   - mock: a fake token. The captions are pushed by the server: the page then calls
 *     POST /api/visits/[id]/replay with source "live" and listens on /api/events.
 *   - whisper: checks that the Whisper service is ready, healthy and takes this app's token (GET /health with
 *     the token, short timeout). Ready: { provider: "whisper", live: <segmentation tuning>, replay } and the page
 *     posts 2-3 s WAV chunks to /api/asr/chunk (replay: what the page may play when it has no microphone).
 *     Otherwise (unreachable, timeout, loading, stuck, unauthorized = the token differs, not_configured)
 *     asr.fallback is published for the visit and the answer is { provider: "mock", fallback: { reason, replay } }:
 *     the page shows a notice and plays the replay when `replay` is set (null: no replay file for this visit,
 *     or ASR_REPLAY_FALLBACK=off; the recording goes on without live captions).
 *   - tencent (lib/asr/tencent.ts): the same as whisper, after a check that recognises nothing (DescribeTaskStatus for
 *     a task that does not exist: the key pair, the region and the service answer). Ready: { provider: "tencent", live,
 *     partials: false, delay_ms, replay }: the page sends whole lines only (each one is a paid recognition task, so no
 *     2-3 s partial captions) and says the captions are late only after delay_ms (a line takes 2-3 s). Not ready: the
 *     same fallback as whisper's (asr.fallback, { provider: "mock", fallback }).
 *   - trtc: 503 not_configured (stub).
 *   - devfake (the developer tools' stand-in, never on a real deployment): { provider: "devfake", replay } where replay
 *     is the visit's own sample audio's fixture, else the fixture the test names in x-ripple-devfake-fixture; the page
 *     plays it as the live captions (POST /api/visits/[id]/replay, source "live"), and the whole-visit transcript is the
 *     same fixture. Journeys that use it say so on screen (「转写：测试替身」).
 */
import { NextResponse, type NextRequest } from "next/server";
import { asLiveTranscriber, devfakeFixture, getSpeechProvider, livePartials, liveTranscriberLabel, MockSpeechProvider, SpeechError, TENCENT_ASR_DEFAULTS, TencentSpeechProvider } from "@/lib/asr";
import { DEFAULT_LIVE_TUNING, liveTuning } from "@/lib/asr/segmenter";
import { liveTuningFromEnv } from "@/lib/asr/whisper";
import { markFallback, resetWhisperLive } from "@/lib/asr/whisper-live";
import { publish } from "@/lib/bus";
import { jsonError, parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { realtimeTokenBody } from "@/lib/visit/schemas";
import { replayFixtureFor } from "@/lib/visit/view";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, realtimeTokenBody);
  if (!body.ok) return body.res;
  try {
    const visit = body.data.visit_id ? await found.store.getVisit(found.session.id, body.data.visit_id) : null;
    if (body.data.visit_id && !visit) return jsonError(404, "visit_not_found");
    const speech = getSpeechProvider();
    // whisper and tencent: the page sends its lines to /api/asr/chunk (lib/asr/index.ts getLiveTranscriber)
    const live = asLiveTranscriber(speech);

    if (live) {
      try {
        const { token, expiresAt } = await live.realtimeToken();
        if (visit) resetWhisperLive(found.session.id, visit.id);
        const partials = livePartials(live);
        return NextResponse.json({
          provider: live.name,
          token,
          expires_at: expiresAt,
          live: live instanceof TencentSpeechProvider ? live.liveTuning() : liveTuning({ ...DEFAULT_LIVE_TUNING, ...liveTuningFromEnv() }),
          partials,
          // a whole line takes 2-3 s to come back: "captions are late" only after this
          ...(partials ? {} : { delay_ms: TENCENT_ASR_DEFAULTS.captionDelayMs }),
          replay: visit && live.replayFallback ? replayFixtureFor(visit) : null,
        });
      } catch (err) {
        if (!(err instanceof SpeechError) || err.code !== "unavailable") throw err;
        const reason = err.message || "unreachable";
        const replay = visit && live.replayFallback ? replayFixtureFor(visit) : null;
        if (visit) {
          resetWhisperLive(found.session.id, visit.id);
          markFallback(found.session.id, visit.id, reason, "start");
          publish(found.session.id, "asr.fallback", `${liveTranscriberLabel(live)} did not answer (${reason}): visit ${visit.id} ${replay ? "uses the replay" : "records without live captions"}`, {
            visit_id: visit.id,
            reason,
            during: "start",
            replay,
            provider: live.name,
          });
        }
        console.warn(`[asr] ${live.name} not ready at the start of a visit: ${reason}`);
        const mock = await new MockSpeechProvider().realtimeToken();
        return NextResponse.json({ provider: "mock", token: mock.token, expires_at: mock.expiresAt, fallback: { reason, replay } });
      }
    }

    const { token, expiresAt } = await speech.realtimeToken();
    if (speech.name === "devfake") {
      const replay = (visit ? replayFixtureFor(visit) : null) ?? devfakeFixture(req);
      return NextResponse.json({ provider: "devfake", token, expires_at: expiresAt, replay });
    }
    return NextResponse.json({ provider: speech.name, token, expires_at: expiresAt });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
