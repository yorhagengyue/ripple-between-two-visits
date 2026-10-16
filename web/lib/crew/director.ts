/**
 * What the director's buttons do beyond the story clock and the cues of lib/session/ops.ts (C2 track E; real-status
 * "导演台和评委页"): move the phones to a page, start and stop a visit replay, and stop a running replay before the clock
 * moves or the session is reset. Server-only: every function takes the request's scoped store and publishes on the
 * session's bus.
 *
 *   showOnPhones     director.cue { cue: "show", path }: every patient phone of the session opens that page of his
 *   stopReplays      every visit replay of the session that is still pushing sentences stops at its next step
 *                    (lib/visit/state.ts stopStream); director.cue { cue: "replay_stopped" } when one was running
 *   replayableToday  the sample visit (v1, v2, v3) that happens on the story day, if any
 */
import { publish } from "@/lib/bus";
import type { SessionRow, Store, VisitRow } from "@/lib/store";
import { stopStream, visitLive } from "@/lib/visit/state";
import { isPhonePath, type ReplayStoppedCueData, type ShowCueData } from "./cues";
import { plainBeat, REPLAYABLE_VISITS } from "./story";

/** Every patient phone of the session opens `path` (one of his pages). */
export function showOnPhones(sessionId: string, path: string, why: ShowCueData["why"], beat: string | null = null): ShowCueData {
  if (!isPhonePath(path)) throw new Error(`not a phone page: ${path}`);
  const data: ShowCueData = { cue: "show", path, why, beat };
  const what = why === "replay" ? "the visit, to play it" : (plainBeat(beat) ?? path);
  publish<ShowCueData>(sessionId, "director.cue", `Director: the phones open ${what}`, data);
  return data;
}

/** The visits of the session whose replay is pushing sentences right now. */
export async function runningReplays(store: Pick<Store, "listVisits">, session: Pick<SessionRow, "id">): Promise<string[]> {
  const visits = await store.listVisits(session.id);
  return visits.filter((v) => visitLive(session.id, v.id).stream?.state === "running").map((v) => v.id);
}

/**
 * Stop every replay of the session that is still running: each stops before its next sentence. Publishes
 * replay_stopped when one was running (nothing otherwise). Returns the visits it stopped.
 */
export async function stopReplays(store: Pick<Store, "listVisits">, session: Pick<SessionRow, "id">, why: ReplayStoppedCueData["why"]): Promise<string[]> {
  const running = await runningReplays(store, session);
  for (const id of running) stopStream(session.id, id);
  if (running.length) {
    const words = why === "director" ? "the director stopped it" : why === "clock" ? "the story clock moved" : "the session was reset";
    publish<ReplayStoppedCueData>(session.id, "director.cue", `Replay stopped (${words})`, { cue: "replay_stopped", visits: running, why });
  }
  return running;
}

/** The sample visit that happens on the story day (Day 0: v1, Day 8: v2, Day 42: v3), or null. */
export async function replayableToday(store: Pick<Store, "listVisits">, session: Pick<SessionRow, "id" | "story_day">): Promise<VisitRow | null> {
  const visits = await store.listVisits(session.id);
  return visits.find((v) => REPLAYABLE_VISITS.includes(v.id) && v.day === session.story_day) ?? null;
}
