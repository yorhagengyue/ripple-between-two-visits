"use client";

/**
 * What an account's pages do about the network (C2 track O; real-app 2.25). Mounted once around his pages
 * (app/p/layout.tsx, the account branch only: the demo keeps nothing on a phone).
 *
 *   - tells the pages whose phone this is (the opaque owner tag, lib/offline/owner.ts) and anchors the phone's clock on
 *     the server's (lib/offline/client.ts tapNow), so an answer kept on the phone carries the moment he tapped;
 *   - sends the to-send list when a page opens, when the network is back, when the app comes to the front, and every
 *     20 s while something waits; when something left the list (sent from this tab or another one) the page re-reads
 *     its server data;
 *   - registers the service worker and asks it to keep the offline shell (public/sw-offline.js): the shell is on this
 *     phone only while someone is signed in on it.
 * Renders nothing of its own.
 */
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { anchorClock, flushOutbox, isOffline, LIST_KEY, OUTBOX_EVENT, refreshWhenOnline, rememberOwner, type OfflineKit } from "@/lib/offline/client";
import type { OutboxEntry } from "@/lib/offline/outbox";

const NO_KIT: OfflineKit = { owner: null };
const KitContext = createContext<OfflineKit>(NO_KIT);

/** Whose phone this is; `owner: null` outside an account's pages (then nothing is ever kept on the phone). */
export function useOfflineKit(): OfflineKit {
  return useContext(KitContext);
}

const RETRY_MS = 20_000;

async function keepShell(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    // the same worker track I registers when he turns reminders on; "none": its imported file is checked for updates too
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "rp:shell-keep" });
  } catch {
    // no service worker here (not https, a private window): the app simply does not open without a network
  }
}

export function OfflineProvider({ owner, nowMs, children }: { owner: string; nowMs: number; children: ReactNode }) {
  const kit = useMemo<OfflineKit>(() => ({ owner }), [owner]);

  useEffect(() => {
    anchorClock(nowMs);
  }, [nowMs]);

  useEffect(() => {
    rememberOwner(owner);
    void keepShell();
  }, [owner]);

  useEffect(() => {
    let live = true;
    const go = () => {
      if (live && !isOffline()) void flushOutbox(kit);
    };
    const front = () => {
      if (document.visibilityState === "visible") go();
    };
    go();
    window.addEventListener("online", go);
    document.addEventListener("visibilitychange", front);
    const timer = window.setInterval(go, RETRY_MS);
    return () => {
      live = false;
      window.removeEventListener("online", go);
      document.removeEventListener("visibilitychange", front);
      window.clearInterval(timer);
    };
  }, [kit]);

  return (
    <KitContext.Provider value={kit}>
      <OutboxWatcher />
      {children}
    </KitContext.Provider>
  );
}

/** Fewer entries waiting than a moment ago (sent, from any tab; or refused): the page reads the server's data again. */
function OutboxWatcher() {
  const router = useRouter();
  const waiting = useOutbox().filter((e) => e.state === "waiting").length;
  const before = useRef(waiting);
  useEffect(() => {
    if (waiting < before.current) refreshWhenOnline(router);
    before.current = waiting;
  }, [waiting, router]);
  return null;
}

// ---- reading the list from a component

function subscribe(onChange: () => void): () => void {
  const storage = (e: StorageEvent) => {
    if (e.key === null || e.key === LIST_KEY) onChange();
  };
  window.addEventListener(OUTBOX_EVENT, onChange);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(OUTBOX_EVENT, onChange);
    window.removeEventListener("storage", storage);
  };
}

function rawList(): string {
  try {
    return window.localStorage.getItem(LIST_KEY) ?? "";
  } catch {
    return "";
  }
}

/** This account's entries on the phone (waiting and refused), kept current; empty on the server and outside an account. */
export function useOutbox(): OutboxEntry[] {
  const { owner } = useOfflineKit();
  const raw = useSyncExternalStore(subscribe, rawList, () => "");
  return useMemo(() => {
    if (!owner || !raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]).filter((e) => e && e.owner === owner && (e.state === "waiting" || e.state === "refused")) : [];
    } catch {
      return [];
    }
  }, [raw, owner]);
}

function subscribeNetwork(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** True while the browser says there is no network. */
export function useNoNetwork(): boolean {
  return useSyncExternalStore(subscribeNetwork, isOffline, () => false);
}
