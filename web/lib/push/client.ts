/**
 * Turning notifications on and off from a page (C2 track I; real-app 2.6). Browser only: client components import it.
 * For him (/p/me/notifications, the onboarding's 「开提醒」 step, track C) and for her (her side's settings, track D).
 *
 *   pushEnvironment()        what this browser can do: notifications, a service worker, push; an iPhone, and whether
 *                            Ripple was opened from the home screen (iOS only gives push to a home-screen web app)
 *   readPushStatus()         permission, this phone's subscription, and whether the server has it
 *   enablePush({ welcome })  call it straight from a tap (the browser asks for permission only on a tap): asks, then
 *                            registers /sw.js, subscribes with the server's VAPID key, sends the subscription to
 *                            POST /api/push/subscribe, and the server sends 「提醒已经开好了」 to this phone. It is "on"
 *                            only when that notice went out (real-app 2.6: 他看得到才算成功); otherwise nothing is kept
 *                            on the server or in the browser and the answer is "failed". After a refusal the browser
 *                            answers "denied" at once and shows nothing.
 *   disablePush()            this phone stops: the server row goes, the browser's subscription ends
 *   sendTestPush()           「发一条试试」 to this phone
 *   forgetPushOnSignOut()    before he signs out: this phone is no longer his for notifications (the server row goes,
 *                            the browser's subscription ends); with `everywhere`, every phone of his
 *
 * Results are states, not exceptions: "unsupported" | "needs_home_screen" | "default" | "denied" | "on" | "off" |
 * "failed" (server or push service refused; nothing changed on the server).
 */
import { fetchSignedIn } from "@/lib/session/client";

export type PushState = "unsupported" | "needs_home_screen" | "default" | "denied" | "off" | "on" | "failed";

export interface PushEnvironment {
  notifications: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  /** an iPhone or iPad (Safari, or any browser there: all use Safari's engine) */
  ios: boolean;
  /** opened from the home screen (a standalone web app) */
  standalone: boolean;
  android: boolean;
}

export function pushEnvironment(): PushEnvironment {
  if (typeof window === "undefined") return { notifications: false, serviceWorker: false, pushManager: false, ios: false, standalone: false, android: false };
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    notifications: "Notification" in window,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    ios,
    standalone,
    android: /Android/.test(ua),
  };
}

/** What stands in the way before even asking: an iPhone outside the home screen, or a browser without push. */
export function blockedState(env: PushEnvironment = pushEnvironment()): PushState | null {
  if (env.ios && !env.standalone) return "needs_home_screen";
  if (!env.notifications || !env.serviceWorker || !env.pushManager) return "unsupported";
  return null;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true; // the browser does not say: keep it
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

export interface PushStatus {
  state: PushState;
  permission: NotificationPermission | "unsupported";
  /** this phone has a subscription the server knows */
  serverKnows: boolean;
  /** this person's phones that get notifications */
  devices: number;
}

/**
 * The notification permission, read without asking. Notification.permission is the answer, except that some browsers'
 * property lags their permission store (headless Chromium reads "denied" after a grant while requestPermission()
 * resolves "granted"): a "denied" is checked once more against navigator.permissions, which agrees in real browsers.
 */
async function currentPermission(): Promise<NotificationPermission> {
  const p = Notification.permission;
  if (p !== "denied") return p;
  try {
    const status = await navigator.permissions?.query({ name: "notifications" as PermissionName });
    if (status?.state === "granted") return "granted";
  } catch {
    // no Permissions API here: the property stands
  }
  return p;
}

/** enablePush() is at work in this tab: its fresh subscription is not on the server yet, and is not a stranger's. */
let enabling = 0;

/**
 * Where this phone stands, without asking anything.
 *
 * A shared phone: if the browser still holds a subscription the server does not know as this person's (someone else
 * turned reminders on here and their sign-in ended without 「退出登录」), it is ended here, so that person's reminders stop
 * reaching this phone (their row goes when the push service next answers 410). This person starts from "off".
 */
export async function readPushStatus(): Promise<PushStatus> {
  const env = pushEnvironment();
  const blocked = blockedState(env);
  const permission: PushStatus["permission"] = env.notifications ? await currentPermission() : "unsupported";
  if (blocked) return { state: blocked, permission, serverKnows: false, devices: 0 };
  if (permission === "denied") return { state: "denied", permission, serverKnows: false, devices: 0 };
  const sub = permission === "granted" ? await existingSubscription() : null;
  let serverKnows = false;
  let devices = 0;
  try {
    const q = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
    const res = await fetchSignedIn(`/api/push${q}`, { method: "GET" });
    if (res.ok) {
      const body = (await res.json()) as { subscribed?: boolean; devices?: number };
      serverKnows = !!body.subscribed;
      devices = body.devices ?? 0;
      if (sub && body.subscribed === false && enabling === 0) await sub.unsubscribe().catch(() => false);
    }
  } catch {
    // offline: say what the phone itself knows
  }
  const state: PushState = permission === "default" ? "default" : sub && serverKnows ? "on" : "off";
  return { state, permission, serverKnows, devices };
}

export interface EnableResult {
  state: PushState;
  /** the welcome push reached the push service (1) or not (0); "on" with a welcome asked for always has 1 */
  sent: number;
}

/** Turn notifications on for this phone. Call it directly from a tap. */
export async function enablePush(opts: { welcome?: boolean } = {}): Promise<EnableResult> {
  const blocked = blockedState();
  if (blocked) return { state: blocked, sent: 0 };
  // first, while the tap still counts: the browser's own question. Its answer is trusted over the property (which can
  // lag, see currentPermission); a browser he already refused answers "denied" at once without asking again.
  let permission: NotificationPermission = Notification.permission;
  if (permission !== "granted") permission = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  if (permission !== "granted") return { state: permission === "denied" ? "denied" : "default", sent: 0 };
  enabling += 1;
  try {
    const reg = await registration();
    const keyRes = await fetch("/api/push/key", { credentials: "same-origin" });
    if (!keyRes.ok) return { state: "failed", sent: 0 };
    const key = keyBytes(((await keyRes.json()) as { publicKey: string }).publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = sub.toJSON();
    const res = await fetchSignedIn("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, welcome: opts.welcome ?? true }),
    });
    if (!res.ok) return { state: "failed", sent: 0 };
    const body = (await res.json()) as { subscribed?: boolean; sent?: number };
    const sent = body.sent ?? 0;
    // the welcome did not get through (the server kept nothing): drop the subscription here too, so nothing half-on
    // is left and the next try makes a fresh one. Reminders count as on only once that notice went out.
    if (body.subscribed === false || ((opts.welcome ?? true) && sent < 1)) {
      if (body.subscribed !== false) await fetchSignedIn("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: json.endpoint }) }).catch(() => null);
      await sub.unsubscribe().catch(() => false);
      return { state: "failed", sent: 0 };
    }
    return { state: "on", sent };
  } catch {
    return { state: "failed", sent: 0 };
  } finally {
    enabling -= 1;
  }
}

/** This phone stops getting notifications (the server forgets it, the browser ends the subscription). */
export async function disablePush(): Promise<PushState> {
  const sub = await existingSubscription();
  if (!sub) return "off";
  try {
    const res = await fetchSignedIn("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    if (!res.ok) return "failed";
  } catch {
    return "failed";
  }
  await sub.unsubscribe().catch(() => false);
  return "off";
}

/**
 * Before signing out (real-app 2.3; a shared phone must not keep getting his reminders): this phone's subscription is
 * removed on the server while his sign-in still counts, and ended in the browser. With `everywhere` (「退出所有设备」)
 * every phone of his is removed on the server; each of those phones' own subscription dies when the push service
 * next answers. Never throws and never holds signing out back: without a network the browser's subscription still
 * ends, and the server's row goes when the push service answers 410 for it.
 */
export async function forgetPushOnSignOut(everywhere = false): Promise<void> {
  try {
    const sub = await existingSubscription();
    if (!sub && !everywhere) return;
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(everywhere ? { all: true } : { endpoint: sub!.endpoint }),
      // a server that does not answer must not keep him signed in
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(4000) : undefined,
    }).catch(() => null);
    if (sub) await sub.unsubscribe().catch(() => false);
  } catch {
    // signing out goes on
  }
}

/** 「发一条试试」 to this phone: how many push services took it (0 or 1). */
export async function sendTestPush(): Promise<number> {
  const sub = await existingSubscription();
  try {
    const res = await fetchSignedIn("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub ? { endpoint: sub.endpoint } : {}),
    });
    if (!res.ok) return 0;
    return ((await res.json()) as { sent?: number }).sent ?? 0;
  } catch {
    return 0;
  }
}
