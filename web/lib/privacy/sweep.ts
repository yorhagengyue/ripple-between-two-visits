/**
 * The nightly orphan-file sweep (docs/plan/real-app.md 3.11 「每晚有一次孤儿扫描兜底」; C2 track H). Server-only.
 *
 * Two kinds of file nobody needs any more:
 *   - a top-level folder that is no live scope's prefix: a deleted or expired judge's sandbox, or an account that is
 *     gone. Live prefixes are computed with lib/blob/prefix.ts blobPrefix, the same function the uploads use (an
 *     account's folder is "a" + 31 hex characters, a demo session's is its id).
 *   - inside a live account's folder, a file under visits/, labels/ or reminders/ that no row points at: what track C's
 *     reseed and clear of the example account leave behind, a label photo read but never confirmed, a reminder
 *     uploaded but never registered. Rows that point at files: visit.audio_path, visit.audio_parts (C2 track R: the
 *     parts of a long recording, from the moment each is registered, so a part is never an orphan while its visit
 *     lives, also while later parts are still arriving), utterance.clip_path, medication.label.photo_path,
 *     reminder_clip.audio_path. Any other folder is left alone.
 * Only files older than the grace period go (an upload is registered within minutes), so a scope being made or a file
 * on its way is never touched; a file the storage cannot date counts as new. Counts only, never a path.
 *
 * The sweep reads and deletes through the BlobStore interface alone (listPrefixes, listFiles, removeObjects), so it
 * runs the same on the local driver and on Supabase Storage. One folder that cannot be listed or cleaned (the storage
 * did not answer) is counted as failed and the pass goes on; the next night tries it again.
 */
import { BLOB_BUCKETS, blobPrefix, type BlobFileInfo, type BlobStore } from "@/lib/blob";
import type { SessionRow, Store } from "@/lib/store/types";
import { systemSubject } from "@/lib/subject/resolve";
import { visitAudioPaths } from "@/lib/visit/recording";
import { DAY_MS, ORPHAN_GRACE_DAYS } from "./rules";

export const ORPHAN_GRACE_MS = ORPHAN_GRACE_DAYS * DAY_MS;
/** The folders the uploads use under a scope's prefix (lib/blob/paths.ts planUpload). */
const KNOWN_FOLDERS = new Set(["visits", "labels", "reminders"]);

export interface SweepCounts {
  /** top-level folders looked at, both buckets */
  prefixes: number;
  /** of those, no live scope's */
  orphan_prefixes: number;
  /** files deleted from orphan folders */
  files: number;
  /** files deleted inside live accounts' folders, no row pointing at them */
  unreferenced: number;
  /** orphan or unreferenced files left because they are younger than the grace period (or cannot be dated) */
  kept_young: number;
  /** folders the storage could not list or clean this pass (nothing more was deleted in them) */
  folders_failed: number;
}

/** The paths an account's rows point at (in its own folder or not; the sweep only compares). */
export async function referencedPaths(store: Store, scope: SessionRow): Promise<Set<string>> {
  const s = systemSubject(store, scope).store;
  const out = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (p) out.add(p);
  };
  const visits = await s.listVisits(scope.id);
  for (const v of visits) {
    for (const p of visitAudioPaths(v)) add(p);
    for (const u of await s.listUtterances(scope.id, v.id)) add(u.clip_path);
  }
  for (const m of await s.listMeds(scope.id)) add(m.label?.photo_path);
  for (const c of await s.listReminderClips(scope.id)) add(c.audio_path);
  return out;
}

/** One sweep (see the header). `store` is the process-wide store (every scope's prefix and rows). */
export async function sweepOrphans(store: Store, blob: BlobStore, opts: { realNowMs: number; graceMs?: number }): Promise<SweepCounts> {
  const counts: SweepCounts = { prefixes: 0, orphan_prefixes: 0, files: 0, unreferenced: 0, kept_young: 0, folders_failed: 0 };
  const before = opts.realNowMs - (opts.graceMs ?? ORPHAN_GRACE_MS);
  const old = (f: BlobFileInfo) => f.lastModifiedMs !== null && f.lastModifiedMs < before;
  const live = new Map<string, SessionRow>();
  for (const s of await store.listSessions()) live.set(blobPrefix(s), s);
  for (const s of await store.listAccountScopes()) live.set(blobPrefix(s), s);
  const refs = new Map<string, Set<string>>();

  for (const bucket of BLOB_BUCKETS) {
    for (const top of await blob.listPrefixes(bucket)) {
      counts.prefixes += 1;
      const scope = live.get(top);
      if (scope && scope.kind !== "account") continue; // a live demo session: its reset clears its own folder
      try {
        const files = await blob.listFiles(bucket, top);
        const gone: string[] = [];
        if (!scope) {
          counts.orphan_prefixes += 1;
          for (const f of files) {
            if (old(f)) gone.push(f.path);
            else counts.kept_young += 1;
          }
          counts.files += await blob.removeObjects(bucket, gone);
          continue;
        }
        let referenced = refs.get(top);
        if (!referenced) {
          referenced = await referencedPaths(store, scope);
          refs.set(top, referenced);
        }
        for (const f of files) {
          const folder = f.path.split("/")[1];
          if (!KNOWN_FOLDERS.has(folder) || referenced.has(f.path)) continue;
          if (old(f)) gone.push(f.path);
          else counts.kept_young += 1;
        }
        counts.unreferenced += await blob.removeObjects(bucket, gone);
      } catch {
        counts.folders_failed += 1;
      }
    }
  }
  return counts;
}
