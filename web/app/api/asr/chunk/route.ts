/**
 * POST /api/asr/chunk — live captions with SPEECH_PROVIDER=whisper (task M14) or tencent (lib/asr/tencent.ts).
 *
 * Body: the raw bytes of a 16 kHz mono 16-bit PCM WAV, Content-Type audio/wav, at most 30 s (1 MiB).
 * Query: session (or the rp_session cookie), visit_id, kind = chunk | final, line (the live line's id,
 *        "<visit_id>-w<...>"), offset_ms (where the audio starts on the recording's clock), seq (chunk number
 *        within the line), line_start_ms, lang_hint (en | zh: the language of the line so far).
 *
 *   kind=chunk  2-3 s of the line, cut at a pause: large-v3-turbo; the line's text so far is published as
 *               asr.partial (every device sees the growing caption). 200 { kind, line, text, chunk_text, lang }.
 *               With tencent there are no partial captions (each request is a paid recognition task): a chunk is
 *               answered 200 { kind, line, ignored: "no_partials" } at once, nothing is sent and nothing is counted.
 *   kind=final  the whole line after it ended: transcribed again as one piece and stored as one utterance
 *               (speaker unknown; roles inferred from what is said), items extracted, asr.final and
 *               card.created published (lib/visit/pipeline processChunk). 200 { kind, line, utterances,
 *               view, new_cards }. An empty transcript (silence, a filtered hallucination) stores nothing.
 *               On an account (scene 1, 10-15) the line also carries a print of its voice, made here from its audio
 *               (lib/visit/voiceprint.ts): the pipeline groups the recording's voices and combines them with what is
 *               said (lib/visit/speakers.ts); the audio itself is not kept.
 *
 * Tencent: a final is one recognition task (CreateRecTask, then DescribeTaskStatus until done, about 2-3 s). One that
 * fails is not yet a fallback, since the lines are the only requests: the line is opened again so the page's retry is
 * taken, and the captions fall back after a second failure in a row, a failed health check after a timeout or a lost
 * connection, or a configuration the service refuses (keys, the service not opened, the balance).
 *
 * When the Whisper service does not answer, the visit's live captions fall back (once per visit: asr.fallback,
 * and 503 { error: "asr_unavailable", reason, fallback: true, replay }; the page shows a notice and starts the
 * replay when `replay` is set; later chunks get 409 asr_fallback_active):
 *   - a final that fails (unreachable, timeout, 5xx, loading), or a second chunk in a row (tencent: see above);
 *   - a chunk that times out or cannot connect when a health check right after it fails too (a hung or dead
 *     service is known after one chunk, a slow chunk on a working service is not a fallback);
 *   - a wrong token (unauthorized): a configuration problem that waiting will not fix, at once;
 *   - "busy" (the service's live queue is full) for WHISPER_BUSY_FALLBACK_MS without one success in between.
 *     Shorter busy spells answer 429 { error: "busy", retry_after_ms } at once (no retry here: the page backs
 *     off, so one visit cannot multiply the load on a busy GPU).
 * replay is the visit's replay file, or null (no replay file, or ASR_REPLAY_FALLBACK=off: then the live
 * captions stop, the recording goes on, and the record is made from the recording at the end).
 *
 * The service refusing the request (400, 413, 415, 422: a bad piece of audio, not a failure of the service) is
 * answered with that status and { error: "asr_rejected", reason, fallback: false }: no failure count, no fallback.
 *
 * Errors: 400 bad query, 404 visit_not_found, 409 not_whisper (neither whisper nor tencent) / not_recording,
 * 413 too_large / too_long, 415 wav_required / wav_16k_mono_pcm16_required (never WebM; only PCM, format 1 or
 * EXTENSIBLE PCM, as the service takes), 422 too_short,
 * 429 busy (this session already has requests in flight, or the service's live queue is full).
 * Logs carry reasons and timings only, never what was said.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getLiveTranscriber, livePartials, liveTranscriberLabel, WhisperUnavailable } from "@/lib/asr";
import { acquireSlot, lineText, liveLine, markFallback, releaseSlot, whisperLive } from "@/lib/asr/whisper-live";
import { publish } from "@/lib/bus";
import { jsonError } from "@/lib/session/http";
import { visitErrorResponse } from "@/lib/visit/http";
import { processChunk } from "@/lib/visit/pipeline";
import { replayFixtureFor } from "@/lib/visit/view";
import { parseWav, pcmRange, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import { voicePrint, type VoicePrint } from "@/lib/visit/voiceprint";
import { isAccount } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";
import { limitByPerson } from "@/lib/subject/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 30 s of 16 kHz mono 16-bit audio is 960 000 bytes; 1 MiB leaves room for the header. */
const MAX_CHUNK_BYTES = 1_048_576;
const MAX_CHUNK_MS = 30_000;
const MIN_CHUNK_MS = 100;
const WAV_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
const SIX_HOURS = 6 * 3600 * 1000;

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const query = z.object({
  visit_id: id,
  kind: z.enum(["chunk", "final"]),
  line: id,
  offset_ms: z.coerce.number().int().min(0).max(SIX_HOURS),
  seq: z.coerce.number().int().min(0).max(100_000).default(0),
  line_start_ms: z.coerce.number().int().min(0).max(SIX_HOURS).optional(),
  lang_hint: z.enum(["en", "zh"]).optional(),
});

/** the health check after a chunk that timed out or could not connect */
const PROBE_TIMEOUT_MS = 1000;

/**
 * The print of a live line's voice (scene 1, 10-15; lib/visit/voiceprint.ts): made from the line's own audio and handed
 * to the pipeline with its words, which groups the recording's voices with it (lib/visit/speakers.ts). The audio is not
 * kept. null when the line holds too little speech to tell a voice (or it cannot be read).
 */
function linePrint(bytes: Uint8Array, durationMs: number): VoicePrint | null {
  try {
    const pcm = pcmRange(bytes, 0, durationMs + 1);
    return pcm ? voicePrint(pcm.samples, pcm.sampleRate) : null;
  } catch {
    return null;
  }
}

function short(text: string, n = 60): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

async function readCapped(req: NextRequest, limit: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

export async function POST(req: NextRequest): Promise<Response> {
  const found = await requireSubject(req);
  if (!found.ok) return found.res;
  const session = found.session;
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonError(400, "invalid_query", parsed.error.issues);
  const q = parsed.data;
  if (!q.line.startsWith(`${q.visit_id}-w`)) return jsonError(400, "invalid_line", "line ids are <visit_id>-w<...>");

  const live = getLiveTranscriber();
  if (!live) return jsonError(409, "not_whisper", "live chunks are only taken with SPEECH_PROVIDER=whisper or tencent");
  // Tencent: whole lines only; a partial chunk is answered at once, sent nowhere and not counted
  if (q.kind === "chunk" && !livePartials(live)) return NextResponse.json({ kind: "chunk", line: q.line, ignored: "no_partials" });
  const label = liveTranscriberLabel(live);

  const ctype = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!WAV_TYPES.has(ctype)) return jsonError(415, "wav_required", "Content-Type must be audio/wav (16 kHz mono 16-bit PCM); WebM is never accepted");
  const bytes = await readCapped(req, MAX_CHUNK_BYTES);
  if (!bytes) return jsonError(413, "too_large", `a chunk is at most ${MAX_CHUNK_BYTES} bytes`);
  const info = parseWav(bytes);
  if (!info) return jsonError(415, "wav_16k_mono_pcm16_required", "not a RIFF/WAVE PCM file");
  if (info.sampleRate !== TARGET_SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) {
    return jsonError(415, "wav_16k_mono_pcm16_required", `got ${info.sampleRate} Hz, ${info.channels} channel(s), ${info.bitsPerSample}-bit`);
  }
  if (info.durationMs > MAX_CHUNK_MS) return jsonError(413, "too_long", "a chunk is at most 30 s");
  if (info.durationMs < MIN_CHUNK_MS) return jsonError(422, "too_short", "a chunk is at least 0.1 s");
  // C2 track L: live captions, 4 hours of audio a day per person, counted in seconds (real-app 3.5; lib/guard/limits.ts)
  const over = await limitByPerson(found.subject, "captionAudio", info.durationMs / 1000);
  if (over) return over;

  try {
    const visit = await found.store.getVisit(session.id, q.visit_id);
    if (!visit) return jsonError(404, "visit_not_found");
    if (visit.status !== "recording") return jsonError(409, "not_recording");
    const replay = live.replayFallback ? replayFixtureFor(visit) : null;
    const state = whisperLive(session.id, visit.id);
    if (state.fellBack) {
      return NextResponse.json({ error: "asr_fallback_active", reason: state.fellBack.reason, fallback: true, replay }, { status: 409 });
    }
    const line = liveLine(state, q.line, q.line_start_ms ?? q.offset_ms);
    if (line.closed) return NextResponse.json({ kind: q.kind, line: q.line, ignored: "line_closed" });
    if (!acquireSlot(session.id)) return NextResponse.json({ error: "busy" }, { status: 429, headers: { "Retry-After": "1" } });
    // a final closes the line before the service answers: a retried final or a late chunk is then ignored
    if (q.kind === "final") line.closed = true;

    const fallBack = (reason: string) => {
      if (markFallback(session.id, visit.id, reason, "live")) {
        publish(session.id, "asr.fallback", `${label} did not answer (${reason}): visit ${visit.id} ${replay ? "switches to the replay" : "keeps recording without live captions"}`, {
          visit_id: visit.id,
          reason,
          during: "live",
          replay,
          provider: live.name,
        });
      }
      return NextResponse.json({ error: "asr_unavailable", reason, fallback: true, replay }, { status: 503 });
    };

    try {
      const result = await live.client.chunk(bytes, { kind: q.kind, langHint: q.lang_hint ?? line.lang ?? state.lastLang });
      state.failStreak = 0;
      state.busySince = null;
      state.okChunks += 1;
      if (result.lang) {
        line.lang = result.lang;
        state.lastLang = result.lang;
      }
      const timing = { model: result.model, model_ms: result.modelMs, round_trip_ms: result.roundTripMs };

      if (q.kind === "chunk") {
        if (line.closed) return NextResponse.json({ kind: "chunk", line: q.line, ignored: "line_closed" });
        line.parts.set(q.seq, result.text);
        const text = lineText(line);
        if (text) {
          publish(session.id, "asr.partial", `Hearing: "${short(text)}…"`, {
            visit_id: visit.id,
            utterance: { id: q.line, t_start_ms: line.startMs, t_end_ms: q.offset_ms + info.durationMs, speaker_cluster: null, lang: line.lang, text },
            started_at: null,
            speed: 1,
            source: live.name,
          });
        }
        return NextResponse.json({ kind: "chunk", line: q.line, text, chunk_text: result.text, lang: result.lang, ...timing });
      }

      // final: the whole line, one utterance
      const text = result.text.trim();
      if (!text) return NextResponse.json({ kind: "final", line: q.line, utterances: [], view: null, new_cards: [], ...timing });
      const first = result.segments[0];
      const last = result.segments.at(-1);
      const tStart = q.offset_ms + (first ? first.start_ms : 0);
      const tEnd = Math.max(tStart, q.offset_ms + (last ? last.end_ms : info.durationMs));
      // an account's line carries the print of its voice: who is speaking comes from the voices and the words (scene 1)
      const voice = isAccount(session) ? { voice: linePrint(bytes, info.durationMs) } : {};
      const r = await processChunk(found.store, session, visit.id, [
        { id: q.line, t_start_ms: tStart, t_end_ms: tEnd, speaker_cluster: null, lang: result.lang, text, ...voice },
      ]);
      return NextResponse.json({ kind: "final", line: q.line, utterances: r.utterances, view: r.view, new_cards: r.newCards, confidence: result.confidence, ...timing });
    } catch (err) {
      if (!(err instanceof WhisperUnavailable)) throw err;
      if (err.clientError) {
        // the service refused this piece of audio (bad WAV, too long or too short, a bad parameter): the service is
        // fine, so this is not a failure of it. No failure count, no fallback, no asr.fallback; the page drops the
        // piece (a final stays closed: the same bytes would be refused again; the record is made from the
        // recording at the end).
        console.warn(`[asr] ${live.name} refused a ${q.kind}: ${err.reason}`);
        return NextResponse.json({ error: "asr_rejected", reason: err.reason, fallback: false }, { status: err.status ?? 422 });
      }
      if (err.busy) {
        if (q.kind === "final") line.closed = false; // the page sends this line again after retry_after_ms
        const now = Date.now();
        state.busySince ??= now;
        const busyFor = now - state.busySince;
        if (busyFor >= live.config.busyFallbackMs) {
          console.warn(`[asr] ${live.name} busy for ${busyFor} ms: live captions fall back`);
          return fallBack("busy");
        }
        const retryMs = Math.max(250, err.retryAfterMs ?? 1000);
        return NextResponse.json(
          { error: "busy", retry_after_ms: retryMs, busy_for_ms: busyFor },
          { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryMs / 1000))) } },
        );
      }
      state.failStreak += 1;
      console.warn(`[asr] ${live.name} ${q.kind} failed: ${err.reason} (streak ${state.failStreak})`);
      // Whisper: a final that fails is a fallback at once (its chunks already showed the service is unwell). Tencent sends
      // only finals: one that fails waits for a second in a row
      let switchNow = (q.kind === "final" && livePartials(live)) || state.failStreak >= 2 || err.misconfigured;
      if (!switchNow && (err.reason === "timeout" || err.reason === "unreachable")) {
        // one slow chunk on a working service is not a fallback; a health check that fails too means it is gone
        switchNow = (await live.probe(PROBE_TIMEOUT_MS)) !== null;
      }
      if (switchNow) return fallBack(err.reason);
      // the line is not lost yet: the page sends it again within its budget, and this time it is taken
      if (q.kind === "final") line.closed = false;
      return NextResponse.json({ error: "asr_unavailable", reason: err.reason, fallback: false }, { status: 503 });
    } finally {
      releaseSlot(session.id);
    }
  } catch (err) {
    return visitErrorResponse(err);
  }
}
