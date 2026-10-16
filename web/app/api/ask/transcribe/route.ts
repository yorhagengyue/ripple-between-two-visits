/**
 * POST /api/ask/transcribe — the microphone of 问一句 (C2 track S; real-app 2.10): one short recording of his question
 * becomes the words of his question, for him to check on the screen. It asks nothing: the words go to POST /api/ask only
 * when he taps 「问这句」 (components/today/AskMic.tsx). The rules are lib/safety/voice.ts (transcribeRoute).
 *
 * Body: the raw bytes of a 16 kHz mono 16-bit PCM WAV, Content-Type audio/wav, at most 30 s (1 MiB), at least 0.3 s.
 * The scope is the request's subject (the sign-in cookie for an account; ?session= or the rp_session cookie for the demo).
 *
 * 200 { text, lang }    his words as one line, at most 500 characters; text "" when nothing was heard
 * 400 no session | 401 not signed in | 404 unknown session (lib/subject requireSubject)
 * 403 patient_only      her account or Wei Ling's phone: only he asks, the same gate as POST /api/ask
 * 409 no_speech_service the speech provider is not a configured Whisper (the screens draw no microphone then)
 * 413 too_large / too_long
 * 415 wav_required / wav_16k_mono_pcm16_required
 * 422 too_short
 * 429 busy              the service's queue is full: { error, retry_after_ms } with Retry-After
 * 429 too_many          more than 120 spoken questions in his clock hour (counted per person in the store, like his
 *                       asks): { error, limit: "voice_per_hour", retryAfterSec } with Retry-After
 * 503 asr_unavailable   the service did not answer usefully: { error, reason }
 * 500 internal_error
 * Every answer is `Cache-Control: private, no-store`.
 *
 * His voice goes to this app's own Whisper service only (no language model hears it, so it does not wait on his consent
 * to AI processing), and is not kept: no file, no row, and the logs carry reasons only, never what was said.
 */
import type { NextRequest } from "next/server";
import { transcribeRoute } from "@/lib/safety/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  return transcribeRoute(req);
}
