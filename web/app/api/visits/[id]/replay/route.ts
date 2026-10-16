/**
 * POST /api/visits/[id]/replay — start the mock realtime stream for a visit (SPEECH_PROVIDER=mock).
 *
 * Body: { speed?: 0.25..20 (default 1, real time), source?: "replay" | "live" }
 * The server pushes asr.partial / asr.final / card.created on the session's event stream at the time points
 * of web/fixtures/visits/<visit>.utterances.json. The visit must be recording (POST /api/visits first).
 * 200 { started_at, speed, fixture, lines, duration_ms }. 409 no_replay (no replay file, or
 * SPEECH_PROVIDER=trtc), 409 not_recording. With SPEECH_PROVIDER=whisper it runs too: sample visits, and the
 * recording visit's fallback when the Whisper service does not answer (asr.fallback).
 */
import { NextResponse, type NextRequest } from "next/server";
import { devfakeFixture, speechProviderName } from "@/lib/asr";
import { jsonError, parseBody } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { startReplay } from "@/lib/visit/replay";
import { replayBody } from "@/lib/visit/schemas";
import { replayFixtureFor } from "@/lib/visit/view";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const body = await parseBody(req, replayBody);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  try {
    const visit = await found.store.getVisit(found.session.id, decodeURIComponent(id));
    if (!visit) return jsonError(404, "visit_not_found");
    // replays never touch speech recognition: they run with mock, and with whisper (sample visits, and the
    // fallback when the Whisper service does not answer); only the trtc stub refuses
    if (speechProviderName() === "trtc") return jsonError(409, "no_replay", "the realtime replay does not run with SPEECH_PROVIDER=trtc");
    // the developer tools' stand-in (SPEECH_PROVIDER=devfake) plays the fixture a test names as a recording's live
    // captions; anything else replays only the visit's own sample audio (C2, real-app H6)
    const fixture = replayFixtureFor(visit) ?? (speechProviderName() === "devfake" ? devfakeFixture(req) : null);
    if (!fixture) return jsonError(409, "no_replay", `no replay file for visit ${visit.id}`);
    if (visit.status !== "recording") return jsonError(409, "not_recording");
    const r = startReplay(found.store, found.session, visit.id, fixture, body.data);
    return NextResponse.json({ started_at: r.startedAt, speed: r.speed, fixture: r.fixture, lines: r.lines, duration_ms: r.durationMs });
  } catch (err) {
    return visitErrorResponse(err);
  }
}
