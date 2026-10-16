/**
 * Realtime captions for SPEECH_PROVIDER=mock (spec section 4: "实时字幕按文件里的时间点逐句推送"). The server
 * replays web/fixtures/visits/<visit>.utterances.json on a clock, `speed` times real time:
 *   - asr.partial at t_start + 300 ms (and half way through long lines): the caption appears while the
 *     sentence is still being said;
 *   - at t_end the sentence is final: processChunk() stores it, infers roles, extracts items and publishes
 *     asr.final (with the whole screen state) and card.created for each new card.
 * Phones and backstage receive these on the session's event stream (/api/events). The same path runs for a
 * judge's "replay a sample visit" and for a recorded visit while speech is mocked.
 *
 * Extraction runs at the end of every sentence: the plan's 10-15 s chunks would hold a finished sentence
 * up to 15 s, and a card must show within 5 s of the sentence ending. /api/visits/[id]/extract takes any
 * chunk size for a realtime client that batches.
 *
 * Server-only; timers live in the Node process (one long-running `next start`, like the memory store). The replay keeps
 * the store it was started with (the request subject's scoped store) for its whole run.
 */
import { fixtureUtterances, replaySchedule } from "@/lib/asr";
import { publish } from "@/lib/bus";
import type { SessionRow, Store } from "@/lib/store";
import { processChunk } from "./pipeline";
import { beginStream, isCurrentStream, visitLive } from "./state";

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 20;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export interface ReplayStart {
  startedAt: number;
  speed: number;
  fixture: string;
  lines: number;
  durationMs: number;
}

export function startReplay(
  store: Store,
  session: SessionRow,
  visitId: string,
  fixture: string,
  opts: { speed?: number; source?: "replay" | "live" } = {},
): ReplayStart {
  const lines = fixtureUtterances(fixture);
  if (!lines) throw new Error(`No replay file for ${fixture}`);
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, opts.speed ?? 1));
  const startedAt = Date.now();
  const stream = beginStream(session.id, visitId, { fixture, speed, startedAt, source: opts.source ?? "replay" });
  const steps = replaySchedule(lines);
  const lastFinal = steps.map((s) => s.kind).lastIndexOf("final");

  void (async () => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await sleep(startedAt + step.atMs / speed - Date.now());
      if (!isCurrentStream(session.id, visitId, stream.generation)) return;
      const u = step.utterance;
      const id = u.id.startsWith(`${visitId}-`) ? u.id : `${visitId}-${u.id}`;
      try {
        if (step.kind === "partial") {
          publish(session.id, "asr.partial", `Hearing: "${step.text}…"`, {
            visit_id: visitId,
            utterance: { id, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms, speaker_cluster: u.speaker_cluster, lang: u.lang, text: step.text },
            started_at: startedAt,
            speed,
          });
        } else {
          const current = (await store.getSession(session.id)) ?? null;
          if (!current) return; // the session expired or was deleted
          // ended early (End visit) or reset back to the seed: stop pushing
          if ((await store.getVisit(session.id, visitId))?.status !== "recording") return;
          // stopped (the director, the story clock, a reset) while the two reads above were on their way: with a
          // database some distance away that is long enough for a stop to land, and this sentence must not follow it
          if (!isCurrentStream(session.id, visitId, stream.generation)) return;
          if (i === lastFinal) visitLive(session.id, visitId).stream!.state = "ended";
          await processChunk(store, current, visitId, [
            { id, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms, speaker_cluster: u.speaker_cluster, lang: u.lang, text: u.text },
          ]);
        }
      } catch (err) {
        console.warn(`[replay] ${visitId} step ${i} failed: ${(err as Error).message}`);
        if ((err as { code?: string }).code === "session_not_found" || (err as { code?: string }).code === "visit_not_found") return;
      }
    }
  })();

  const last = lines.at(-1);
  return { startedAt, speed, fixture, lines: lines.length, durationMs: last ? last.t_end_ms : 0 };
}
