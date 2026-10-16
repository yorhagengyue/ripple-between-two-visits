/**
 * What this phone forgets when someone logs out of it (C2 track O; real-app 2.25 「退出登录时，手机上的待发清单、没传完的录音
 * 和页面缓存全部清掉。家里共用的手机尤其要紧」, 3.11 「手机上留的东西在上传完成或退出登录时清掉」). Client only.
 *
 * Everything this origin stored in the browser goes, for whoever is leaving, him or her:
 *   localStorage, sessionStorage   whole: the to-send list, its owner tag and clock anchor (lib/offline/client.ts), her
 *                                  per-link keys (lib/care/device.ts rp_f_phone_<link>, rp_f_welcomed_<link>), and
 *                                  anything a later track keeps there. Nothing in them is meant to outlive a sign-in.
 *   IndexedDB                      every database of this origin: recordings not uploaded yet
 *                                  (components/visit/elder/recording-store.ts) and whatever else is kept there.
 *   the page cache                 every Cache Storage cache: the offline shell (public/sw-offline.js). The service
 *                                  worker puts the shell back only when a signed-in account's page asks for it again.
 * Cookies are the server's (POST /api/auth/logout clears the sign-in); the push subscription is track I's own line.
 *
 * Never throws and never hangs: each step is best effort and the whole thing gives up after 3 s, so logging out always
 * goes on to the login page.
 */

import { RECORDINGS_DB } from "@/lib/visit/recordings-db";

/**
 * The recordings' database by name (track V's lib/visit/recordings-db.ts, the name recording-store.ts opens), for
 * browsers without indexedDB.databases() (older Safari and Firefox). Every browser that can list its databases deletes
 * all of them, whatever they are called.
 */
export { RECORDINGS_DB };

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // another tab holds it open: the deletion is queued by the browser and happens when that tab lets go
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function forgetDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const names = new Set<string>([RECORDINGS_DB]);
  try {
    const list = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    for (const d of list) if (d.name) names.add(d.name);
  } catch {
    // cannot list: the known one is still deleted
  }
  await Promise.all([...names].map(deleteDb));
}

async function forgetCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    // no Cache Storage here (not a secure context): nothing was cached
  }
}

function forgetStorage(): void {
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      pick().clear();
    } catch {
      // storage blocked: nothing was kept
    }
  }
}

/** Call it after the server ended the sign-in and before leaving for the login page. */
export async function forgetThisPhone(): Promise<void> {
  if (typeof window === "undefined") return;
  forgetStorage();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 3000);
  });
  await Promise.race([Promise.all([forgetDatabases(), forgetCaches()]).then(() => undefined), giveUp]).catch(() => undefined);
  clearTimeout(timer);
  // a tab that was still writing while this ran: the list is cleared once more on the way out
  forgetStorage();
}
