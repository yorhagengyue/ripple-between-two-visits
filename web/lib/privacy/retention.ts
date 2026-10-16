/**
 * How long his things are kept, and the retention pass over one account (docs/plan/real-app.md 3.11 保留期限; journey
 * 15; C2 track H). Server-only. The scheduled job (lib/jobs/retention.ts) runs retainScope for every account scope with
 * a store bound to it (system mode) and the idle example accounts through lib/privacy/delete.ts.
 *
 *   visit recording   90 days from the visit's date (visit.retain_until once stamped), unless he chose 「一直保留」
 *                     (visit.keep_forever; F's POST /api/visits/[id]/keep). Then the files under
 *                     audio/<his prefix>/visits/<visit id>/ go (the whole recording and every sentence clip cut from
 *                     it), audio_path and those clip paths are cleared and audio_deleted_at is set. The transcript and
 *                     the visit's items stay. C2 track R: a long recording is several files in that same folder
 *                     (visit.audio_parts, lib/visit/recording.ts): every part goes with it and the list is cleared. A stand-in clip (fixtures/visits/clips, 代录音) is the same file for
 *                     everyone and was never his recording: it is left as it is.
 *   safety_event      90 days (it holds his own words; kept only to look into a fault and to count).
 *   example account   30 days without use (real time: his last sign-in or refresh), never a filming account.
 *
 * What is "his" in storage is decided by lib/blob/prefix.ts blobPrefix, the same function the uploads use.
 */
import { isStandInClip } from "@/lib/asr/fixtures";
import type { AuthProvider } from "@/lib/auth/provider";
import { blobPrefix, pathInSession, type BlobStore } from "@/lib/blob";
import { publish } from "@/lib/bus";
import type { SessionRow, Store, UtteranceRow, VisitRow } from "@/lib/store/types";
import { localDate, scopeNowMs } from "@/lib/time/clock";
import { recordingFiles, registeredParts, visitAudioPaths } from "@/lib/visit/recording";
import { AUDIO_KEEP_DAYS, DAY_MS, EXAMPLE_IDLE_DAYS, SAFETY_EVENT_KEEP_DAYS } from "./rules";

export { AUDIO_KEEP_DAYS, DAY_MS, EXAMPLE_IDLE_DAYS, SAFETY_EVENT_KEEP_DAYS };

/** "2026-08-24" + 90 -> "2026-11-22" (calendar days, no time zone involved). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The last day his visit's recording is kept: its stamped retain_until, else the visit date + 90 days. */
export function retainUntil(visit: Pick<VisitRow, "date" | "retain_until">): string {
  return visit.retain_until ?? addDays(visit.date, AUDIO_KEEP_DAYS);
}

/** The visit's files in his storage folder: the whole recording and the sentence clips cut from it (never a stand-in). */
export function ownedAudio(scope: Pick<SessionRow, "id" | "kind">, visit: Pick<VisitRow, "id" | "audio_path" | "audio_parts">, utterances: readonly Pick<UtteranceRow, "id" | "clip_path">[]) {
  const folder = `${blobPrefix(scope)}/visits/${visit.id}/`;
  const mine = (p: string | null | undefined): p is string => !!p && !isStandInClip(p) && pathInSession(blobPrefix(scope), p) && p.startsWith(folder);
  const whole = recordingFiles(visit).map((f) => f.path);
  return {
    folder: folder.slice(0, -1),
    recording: mine(visit.audio_path) ? visit.audio_path : null,
    // C2 track R: the whole recording file by file, in order (one entry for a recording in one file; [] while the
    // server does not hold it, or when a file is not his own)
    files: whole.every(mine) ? whole : [],
    // ... and every recording file the row points at, the parts of an upload that never finished too
    all: visitAudioPaths(visit).filter(mine),
    clips: utterances.filter((u) => mine(u.clip_path)).map((u) => ({ id: u.id, path: u.clip_path as string })),
  };
}

export type RecordingState =
  | { kind: "none" }
  | { kind: "kept_forever" }
  | { kind: "kept_until"; until: string }
  | { kind: "deleted"; on: string; until: string };

/** What his screens say about one visit's recording (his recordings page, his export). */
export function recordingState(
  scope: Pick<SessionRow, "id" | "kind" | "tz">,
  visit: VisitRow,
  utterances: readonly Pick<UtteranceRow, "id" | "clip_path">[],
): RecordingState {
  if (visit.audio_deleted_at) return { kind: "deleted", on: localDate(Date.parse(visit.audio_deleted_at), scope.tz), until: retainUntil(visit) };
  const own = ownedAudio(scope, visit, utterances);
  if (!own.recording && own.clips.length === 0) return { kind: "none" };
  if (visit.keep_forever === true) return { kind: "kept_forever" };
  return { kind: "kept_until", until: retainUntil(visit) };
}

/** Statuses whose recording is still being made or sent: never touched. */
const BUSY = new Set<VisitRow["status"]>(["recording", "transcribing", "planned"]);

/** Is the visit's recording due to go on `today` (his local date)? */
export function recordingDue(visit: VisitRow, today: string): boolean {
  if (BUSY.has(visit.status) || visit.keep_forever === true || visit.audio_deleted_at) return false;
  return today > retainUntil(visit);
}

export interface ScopeRetention {
  /** visits whose recording went */
  visits: number;
  /** files removed from storage */
  files: number;
  /** sentence clip paths cleared */
  clips: number;
  /** visits that got their retain_until written */
  stamped: number;
  /** safety events dropped */
  safety: number;
}

/**
 * One account's retention pass: stamp retain_until on recorded visits that lack it (his review page shows 「录音留到
 * …」 from it), delete the recordings that are due, drop safety events past 90 days. `store` is bound to this scope
 * (system mode); `nowMs` is the app's clock (the developer test clock moves it).
 */
export async function retainScope(store: Store, scope: SessionRow, deps: { blob: BlobStore; nowMs: number }): Promise<ScopeRetention> {
  const out: ScopeRetention = { visits: 0, files: 0, clips: 0, stamped: 0, safety: 0 };
  const today = localDate(scopeNowMs(scope, deps.nowMs), scope.tz);
  const nowIso = new Date(deps.nowMs).toISOString();
  for (const visit of await store.listVisits(scope.id)) {
    if (visit.status === "planned" || visit.audio_deleted_at) continue;
    const utterances = await store.listUtterances(scope.id, visit.id);
    const own = ownedAudio(scope, visit, utterances);
    const hasAudio = !!own.recording || own.all.length > 0 || own.clips.length > 0;
    if (!recordingDue(visit, today)) {
      if (hasAudio && !visit.retain_until && !BUSY.has(visit.status)) {
        await store.updateVisit(scope.id, visit.id, { retain_until: retainUntil(visit) });
        out.stamped += 1;
      }
      continue;
    }
    const removed = await deps.blob.removePrefix("audio", own.folder);
    if (!hasAudio && removed === 0) continue; // a visit that never had a recording: nothing to say about it
    for (const c of own.clips) await store.updateUtterance(scope.id, c.id, { clip_path: null });
    await store.updateVisit(scope.id, visit.id, {
      ...(own.recording ? { audio_path: null } : {}),
      // C2 track R: the parts went with the folder; the list goes too (only named when the row has one)
      ...(registeredParts(visit).length ? { audio_parts: null } : {}),
      retain_until: retainUntil(visit),
      audio_deleted_at: nowIso,
    });
    out.visits += 1;
    out.files += removed;
    out.clips += own.clips.length;
    publish(scope.id, "visit.changed", `Visit ${visit.id}: the recording reached the end of its 90 days and was deleted (transcript kept)`, {
      visit_id: visit.id,
      audio_deleted: true,
    });
  }
  out.safety = await store.pruneSafetyEvents(scope.id, new Date(deps.nowMs - SAFETY_EVENT_KEEP_DAYS * DAY_MS).toISOString());
  return out;
}

/** The latest moment an account was used (real time): his last sign-in or refresh, else when it was made. */
export function lastUsedMs(stamps: readonly (string | null | undefined)[]): number | null {
  const ms = stamps.map((s) => (s ? Date.parse(s) : NaN)).filter((n) => Number.isFinite(n));
  return ms.length ? Math.max(...ms) : null;
}

/**
 * Is this example account idle long enough to go? Real time on both sides: sign-ins and refreshes are stamped with the
 * machine's clock (lib/auth), so they are measured against it too, never against the developer test clock.
 */
export function exampleIdle(scope: Pick<SessionRow, "kind" | "example_data" | "filming">, lastUsed: number | null, realNowMs: number): boolean {
  if (scope.kind !== "account" || !scope.example_data || scope.filming) return false;
  if (lastUsed === null) return false;
  return realNowMs - lastUsed > EXAMPLE_IDLE_DAYS * DAY_MS;
}

/**
 * The example accounts nobody has used for 30 days (never a filming account): their owners' user ids. "Used" is the
 * account's last sign-in and every sign-in session's last refresh (track A's registry); an account that cannot be dated
 * is left alone.
 */
export async function idleExampleAccounts(
  store: Pick<Store, "listAccountScopes" | "getAccount">,
  auth: Pick<AuthProvider, "listSessions">,
  realNowMs: number,
): Promise<string[]> {
  const out: string[] = [];
  for (const scope of await store.listAccountScopes()) {
    const userId = scope.owner_user_id;
    if (!userId || !scope.example_data || scope.filming) continue;
    const [account, sessions] = await Promise.all([store.getAccount(userId), auth.listSessions(userId).catch(() => [])]);
    const last = lastUsedMs([account?.last_seen_at, ...sessions.filter((s) => s.user_id === userId).map((s) => s.last_seen_at)]);
    if (exampleIdle(scope, last, realNowMs)) out.push(userId);
  }
  return out;
}
