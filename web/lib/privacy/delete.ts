/**
 * Deleting an account, all of it (docs/plan/real-app.md 3.11 删除账号; journey 15; C2 track H). Server-only; pure apart
 * from the store, the identity provider and the blob store it is given (the route and the idle-example job give the
 * process-wide ones, the tests their own).
 *
 * The order, each step checked before the next:
 *   1. storage first: every file under his prefix in both buckets (his recordings and clips, label photos, and the
 *      reminders she recorded for him, which live in his folder) is removed, then both folders are listed again and
 *      must be empty. Anything left: stop with 503 storage_not_empty and change nothing else; he is still signed in
 *      and can tap again.
 *      A family member's own recordings are in other people's folders, with her tag in the file name
 *      (lib/blob/prefix.ts blobUserTag): the ones a reminder of theirs points at stay with them (real-app 3.10 「她录给他的
 *      提醒……留在他名下」), the ones nothing points at (uploaded and never saved) go now.
 *   2. his scope's event history goes, then the family links end at once (track D's endLinksOf): his links are revoked
 *      so her page and stream end; links where this person is the family member are left.
 *   3. every sign-in session of his ends (the session registry: his tokens stop working at once), then the identity
 *      itself goes (the provider's admin delete; on Supabase that cascades through every table that names him).
 *   4. the app's rows (store.deleteAccount: the account, his space and every row in it, his links, consents, push
 *      subscriptions; reminders she recorded elsewhere keep their rows with her id cleared, the access logs keep her
 *      label).
 *   5. the check (real-app 「每张表按 session_id 或 user_id 计数为 0，两个桶的前缀为空」): every column that can hold his user id
 *      or his scope id is counted (store.countAccountRows over lib/store/account-rows.ts, a list held to the schema by
 *      a test), his sign-in sessions and his channel's event history are asked for, and both of his storage folders
 *      are listed again (a file can land after step 1 through an upload link issued before it). Anything found is
 *      deleted once more and counted; what is still there after that is `leftover`. ops_run gets one row
 *      "delete_account" with counts only.
 *
 * Kept on purpose: service_read_log (operators' reads: who, why, which tables) is an audit trail and keeps its rows;
 * the scope id in them then names nobody.
 *
 * confirmPassword re-builds track A's private check from A's exported pieces (the same lock per user × device as a
 * password change), so a wrong password here counts toward the same lockout.
 */
import { BLOB_BUCKETS, blobPrefix, blobUserTag, reminderFileOf, type BlobStore } from "@/lib/blob";
import { getBus } from "@/lib/bus";
import { endLinksOf } from "@/lib/care/end";
import type { Env } from "@/lib/dev/enabled";
import { deviceHash } from "@/lib/auth/device";
import { bucketKey, clearFailures, LIMITS, lockBuckets, lockState, noteFailure } from "@/lib/auth/limits";
import { normalizePassword } from "@/lib/auth/passwords";
import type { AuthProvider } from "@/lib/auth/provider";
import { loginOf, type Me, type RequestFacts } from "@/lib/auth/service";
import { careEntryStore, type CareEntryStore } from "@/lib/subject/care";
import { isAccount } from "@/lib/store/scope";
import type { SessionRow, Store } from "@/lib/store/types";
import { realNowMs } from "@/lib/time/now";

export interface DeleteDeps {
  /** the process-wide store (account-level rows, his scope, the links) */
  store: Store;
  auth: AuthProvider;
  blob: BlobStore;
  /** the care flow's narrow store for ending links (default: over `store`) */
  care?: CareEntryStore;
  /** drops a scope's event history (default: the process bus) */
  clearEvents?: (scopeId: string) => void;
  /** how many events are still stored for a scope (default: asks the process bus) */
  eventsLeft?: (scopeId: string) => Promise<number>;
  env?: Env;
}

export type DeleteRefusal = { ok: false; status: number; error: "storage_not_empty" | "storage_failed" | "identity_failed" };

export interface DeleteCounts {
  /** files removed from his storage in step 1 */
  files: number;
  /** files found in his folders at the last check (they landed while the deletion ran) and removed */
  files_late: number;
  /** her recordings in other people's folders that no reminder pointed at, removed */
  her_files_removed: number;
  /** her recordings that stay with the people she recorded them for */
  her_clips_kept: number;
  links_revoked: number;
  links_left: number;
  sessions: number;
  /** rows, events and files still found after everything was deleted a second time (0 when it went as it should) */
  leftover: number;
}

export type DeleteResult = { ok: true; counts: DeleteCounts; leftover: Record<string, number> } | DeleteRefusal;

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** How many files are under the prefix, by bucket (only buckets with files are listed). */
async function filesUnder(blob: BlobStore, prefix: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const bucket of BLOB_BUCKETS) {
    const n = (await blob.listFiles(bucket, prefix)).length;
    if (n) out[bucket] = n;
  }
  return out;
}

/** Every file under the prefix in both buckets, removed; then both are listed again. Returns [removed, still there]. */
async function clearStorage(blob: BlobStore, prefix: string): Promise<[number, number]> {
  let removed = 0;
  for (const bucket of BLOB_BUCKETS) removed += await blob.removePrefix(bucket, prefix);
  return [removed, total(await filesUnder(blob, prefix))];
}

/**
 * Everything still stored that names this person, after the deletion (step 5 of the header): "table.column" -> rows,
 * "storage.<bucket>" -> files. {} means nothing is left. `scope` is his own space as it was (null: he had none).
 */
export async function remainingRows(
  deps: Pick<DeleteDeps, "store" | "auth" | "blob" | "eventsLeft">,
  who: { userId: string; scope: Pick<SessionRow, "id" | "kind"> | null },
): Promise<Record<string, number>> {
  const out: Record<string, number> = { ...(await deps.store.countAccountRows(who.userId)) };
  const most = (key: string, n: number) => {
    if (n > 0) out[key] = Math.max(out[key] ?? 0, n);
  };
  // his sign-in sessions live with the identity provider (its registry is public.account_session on Supabase)
  most("account_session.user_id", (await deps.auth.listSessions(who.userId).catch(() => [])).filter((s) => s.user_id === who.userId).length);
  if (who.scope) {
    // his channel's history: the in-process bus, or bus_event behind it
    most("bus_event.session_id", await (deps.eventsLeft ?? eventsStored)(who.scope.id));
    for (const [bucket, n] of Object.entries(await filesUnder(deps.blob, blobPrefix(who.scope)))) out[`storage.${bucket}`] = n;
  }
  return out;
}

/** Events still stored for a scope: the process bus's own history, or the shared log behind it (STORE=supabase). */
async function eventsStored(scopeId: string): Promise<number> {
  return (await getBus().after(scopeId, 0, 200).catch(() => [])).length;
}

/**
 * Her recordings in the folders of the people she has (or had) a link to, found by her tag in the file name: the ones
 * a reminder points at stay (counted as kept), the others are removed now. A folder the storage cannot list is left to
 * the nightly sweep. `patientIds` are those people's user ids (an account's scope id is its user id).
 */
async function clearHerLooseRecordings(deps: Pick<DeleteDeps, "store" | "blob">, userId: string, patientIds: readonly string[]): Promise<{ removed: number; kept: number }> {
  const tag = blobUserTag(userId);
  const out = { removed: 0, kept: 0 };
  for (const patientId of new Set(patientIds)) {
    try {
      const prefix = blobPrefix({ id: patientId, kind: "account" });
      const hers = (await deps.blob.listFiles("audio", `${prefix}/reminders`)).filter((f) => reminderFileOf(prefix, tag, f.path));
      if (!hers.length) continue;
      const registered = new Set((await deps.store.listReminderClips(patientId)).map((c) => c.audio_path));
      const loose = hers.filter((f) => !registered.has(f.path)).map((f) => f.path);
      out.kept += hers.length - loose.length;
      out.removed += await deps.blob.removeObjects("audio", loose);
    } catch {
      /* his space is gone, or the storage did not answer: the sweep removes what no reminder points at */
    }
  }
  return out;
}

/**
 * Delete everything of `userId` (see the header for the order). The caller has already made sure it is his wish (his
 * password, or the idle-example rule). `reason` goes into ops_run as a count only.
 */
export async function deleteAccountEverywhere(deps: DeleteDeps, userId: string, opts: { reason: "user" | "example_idle" }): Promise<DeleteResult> {
  const started = new Date(realNowMs()).toISOString();
  const { store, auth } = deps;
  const row = await store.getSession(userId);
  const scope: SessionRow | null = row && isAccount(row) && row.owner_user_id === userId ? row : null;
  const counts: DeleteCounts = { files: 0, files_late: 0, her_files_removed: 0, her_clips_kept: 0, links_revoked: 0, links_left: 0, sessions: 0, leftover: 0 };
  const clearEvents = deps.clearEvents ?? ((id: string) => getBus().clearHistory(id));

  // the people this person recorded reminders for (read before the links go)
  const patients = (await store.listCareLinks({ family_id: userId })).map((l) => l.patient_id);

  // 1. storage first, and empty when listed again
  if (scope) {
    try {
      const [removed, left] = await clearStorage(deps.blob, blobPrefix(scope));
      counts.files = removed;
      if (left > 0) return { ok: false, status: 503, error: "storage_not_empty" };
    } catch {
      return { ok: false, status: 503, error: "storage_failed" };
    }
  }
  const hers = await clearHerLooseRecordings(deps, userId, patients);
  counts.her_files_removed = hers.removed;
  counts.her_clips_kept = hers.kept;

  // 2. her page and stream end at once. His scope's event history goes first, so what is left on his channel is only
  //    the link-ended events she has to receive (no content of his).
  if (scope) clearEvents(scope.id);
  const ended = await endLinksOf(userId, { store: deps.care ?? careEntryStore(store) });
  counts.links_revoked = ended.revoked;
  counts.links_left = ended.left;

  // 3. his sessions end, then the identity goes
  counts.sessions = await auth.endSessions(userId, { reason: "account_deleted" }).catch(() => 0);
  try {
    await auth.deleteUser(userId);
  } catch {
    return { ok: false, status: 503, error: "identity_failed" };
  }

  // 4. the app's rows
  await store.deleteAccount(userId);

  // 5. count everything again; anything found goes once more and is counted. The link-ended events reached her open
  //    stream when they were published, so his channel's history can go for good now.
  if (scope) clearEvents(scope.id);
  const who = { userId, scope };
  let leftover = await remainingRows(deps, who).catch(() => ({ check_failed: 1 }) as Record<string, number>);
  if (total(leftover) > 0) {
    if (scope) {
      const late = Object.keys(leftover).some((k) => k.startsWith("storage."));
      if (late) {
        const again = await clearStorage(deps.blob, blobPrefix(scope)).catch(() => [0, 0] as [number, number]);
        counts.files_late = again[0];
      }
      clearEvents(scope.id);
    }
    await store.deleteAccount(userId).catch(() => undefined);
    leftover = await remainingRows(deps, who).catch(() => ({ check_failed: 1 }) as Record<string, number>);
  }
  counts.leftover = total(leftover);
  await store
    .addOpsRun({
      job: "delete_account",
      counts: { ...counts, idle_example: opts.reason === "example_idle" ? 1 : 0, with_space: scope ? 1 : 0 },
      started_at: started,
      finished_at: new Date(realNowMs()).toISOString(),
    })
    .catch(() => undefined);
  return { ok: true, counts, leftover };
}

export type PasswordCheck = { ok: true } | { ok: false; status: number; error: "not_signed_in" | "wrong_password" | "locked"; until?: string };

/**
 * His current password, with the same lockout as changing it (track A: per user × device, 5 wrong in 15 minutes lock
 * that device for 15 minutes). A browser without a device cookie is counted on the id it is about to get and on its
 * address, like A's flows.
 */
export async function confirmPassword(deps: Pick<DeleteDeps, "store" | "auth" | "env">, me: Me, password: string, facts: RequestFacts): Promise<PasswordCheck> {
  const env = deps.env ?? process.env;
  const login = loginOf(me.account, me.email);
  if (!login) return { ok: false, status: 401, error: "not_signed_in" };
  const own = deviceHash(facts.deviceId).slice(0, 32);
  const devices = facts.knownDevice ? [own] : [own, `ip-${bucketKey("ip", facts.ip, env)}`];
  const buckets = lockBuckets("password", bucketKey("user", me.userId, env), devices);
  const lock = await lockState(deps.store, buckets);
  if (lock.locked) return { ok: false, status: 423, error: "locked", until: lock.until };
  if (!(await deps.auth.checkPassword(login.email, normalizePassword(password)))) {
    const after = await noteFailure(deps.store, buckets, LIMITS.passwordFailures);
    return after.locked ? { ok: false, status: 423, error: "locked", until: after.until } : { ok: false, status: 401, error: "wrong_password" };
  }
  await clearFailures(deps.store, buckets);
  return { ok: true };
}
