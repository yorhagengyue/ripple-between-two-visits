/**
 * Web push in a test browser (C2 track I). Headless Chromium has no push service: PushManager.subscribe() is refused
 * ("Registration failed - permission denied"). So a test phone subscribes to the local push service of
 * tests/support/push-service.ts instead: everything the app does stays real (the tap, the permission, /sw.js, the
 * VAPID key, POST /api/push/subscribe, the server's encrypted and signed request), only the push service is ours. What
 * that service opens is handed to the phone's real service worker with Chrome DevTools' "deliver push message", the
 * same event a phone gets from FCM.
 *
 *   await stubPushSubscription(context, phone)        before the first page: subscribe() returns `phone`'s subscription
 *   const hub = await listenForShownPushes(context)   the service worker's hook (public/sw.js postMessage
 *                                                     "rp:push-shown") reaches the test: hub.next() / hub.all
 *   await deliverToServiceWorker(page, text)          the push event, through CDP (needs a Chromium page)
 *   await tapNotification(context, tag)               the notification's tap: a notificationclick on the shown one
 *   await answerPermissionPrompt(context, "granted")  the browser's question answered on the tap (the page reads
 *                                                     "default" before it, as a phone that was never asked)
 *
 * Which Chromium: a service worker shows notifications only in the new headless mode (test.use({ channel: "chromium" })).
 * In the old headless shell showNotification fails, and after context.grantPermissions(["notifications"]) the page still
 * reads Notification.permission "denied" while requestPermission() resolves "granted"; lib/push/client.ts enablePush
 * trusts requestPermission(), and public/sw.js still posts its "rp:push-shown" hook (shown: false), so a recording can
 * draw the notice either way. With new headless, also emulate reduced motion on recorded phones (progress/i.md).
 */
import type { BrowserContext, CDPSession, Page } from "@playwright/test";

export interface StubbedPhone {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Make PushManager.subscribe / getSubscription answer with `phone`'s subscription (kept across reloads). */
export async function stubPushSubscription(context: BrowserContext, phone: StubbedPhone): Promise<void> {
  await context.addInitScript((p: StubbedPhone) => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__rpPushStubbed || typeof PushManager === "undefined") return;
    w.__rpPushStubbed = true;
    const KEY = "__rpTestPushSubscription";
    const bytes = (b64url: string) => {
      const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out.buffer;
    };
    const make = (serverKey: string | null): PushSubscription => {
      const sub = {
        endpoint: p.endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: serverKey ? bytes(serverKey) : null },
        getKey: (name: string) => (name === "p256dh" ? bytes(p.keys.p256dh) : name === "auth" ? bytes(p.keys.auth) : null),
        toJSON: () => ({ endpoint: p.endpoint, expirationTime: null, keys: { ...p.keys } }),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      };
      return sub as unknown as PushSubscription;
    };
    const keyText = (k: unknown): string | null => {
      if (!k) return null;
      const view = k instanceof ArrayBuffer ? new Uint8Array(k) : ArrayBuffer.isView(k) ? new Uint8Array(k.buffer, k.byteOffset, k.byteLength) : null;
      if (!view) return typeof k === "string" ? k : null;
      let s = "";
      for (const b of view) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    // (no permission check here: the old headless shell reads Notification.permission "denied" even after a grant;
    // the app subscribes only after requestPermission() answered "granted")
    PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
      const serverKey = keyText(options?.applicationServerKey);
      localStorage.setItem(KEY, serverKey ?? "");
      (window as unknown as Record<string, unknown>).__rpSubscribedWith = serverKey;
      return make(serverKey);
    };
    PushManager.prototype.getSubscription = async function () {
      const saved = localStorage.getItem(KEY);
      return saved === null ? null : make(saved || null);
    };
    PushManager.prototype.permissionState = async function () {
      return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "prompt";
    };
  }, phone);
}

/**
 * The browser's own question 「允许通知吗？」, answered `answer` the first time a page asks (a test cannot click the real
 * prompt, and headless Chromium answers it "denied" by itself). Until then the page reads permission "default", as on
 * a phone that was never asked; the answer is kept across reloads. `onAsk` runs while the question is "up" (the
 * journey draws it). For a service worker to show notifications, grant the context's real permission as well.
 */
export async function answerPermissionPrompt(context: BrowserContext, answer: NotificationPermission, onAsk?: () => Promise<void>): Promise<void> {
  if (onAsk) await context.exposeBinding("__rpPermissionAsked", async () => onAsk());
  await context.addInitScript(
    ({ answer: a, withBinding }: { answer: NotificationPermission; withBinding: boolean }) => {
      const w = window as unknown as Record<string, unknown>;
      if (w.__rpPermissionStubbed || typeof Notification === "undefined") return;
      w.__rpPermissionStubbed = true;
      const KEY = "__rpTestNotificationPermission";
      const read = () => (localStorage.getItem(KEY) ?? "default") as NotificationPermission;
      Object.defineProperty(Notification, "permission", { configurable: true, get: read });
      Notification.requestPermission = async () => {
        if (read() !== "default") return read();
        if (withBinding) await (w.__rpPermissionAsked as () => Promise<void>)();
        localStorage.setItem(KEY, a);
        return a;
      };
    },
    { answer, withBinding: !!onAsk },
  );
}

export interface ShownPush {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: string | null;
  shown: boolean;
  at: number;
}

export interface ShownHub {
  all: ShownPush[];
  /** the next notification the service worker shows on this phone (or one already shown after `since`) */
  next(opts?: { since?: number; timeoutMs?: number }): Promise<ShownPush>;
}

/**
 * The service worker's hook: every page of this context records { type: "rp:push-shown", ... } in
 * window.__rpPushShown and tells the test, which can then draw the notice at that moment (the recording kit).
 */
export async function listenForShownPushes(context: BrowserContext, onShown?: (n: ShownPush, page: Page) => void | Promise<void>): Promise<ShownHub> {
  const all: ShownPush[] = [];
  const waiters: { since: number; resolve: (n: ShownPush) => void }[] = [];
  await context.exposeBinding("__rpPushShownToTest", async (source, n: ShownPush) => {
    all.push(n);
    for (const w of waiters.filter((x) => n.at >= x.since)) w.resolve(n);
    waiters.splice(0, waiters.length, ...waiters.filter((x) => n.at < x.since));
    if (onShown) await onShown(n, source.page);
  });
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__rpPushShownHooked || !("serviceWorker" in navigator)) return;
    w.__rpPushShownHooked = true;
    w.__rpPushShown = [];
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      const d = e.data as { type?: string } | null;
      if (!d || d.type !== "rp:push-shown") return;
      (w.__rpPushShown as unknown[]).push(d);
      const tell = w.__rpPushShownToTest as ((x: unknown) => Promise<unknown>) | undefined;
      void tell?.(d)?.catch?.(() => undefined);
    });
    navigator.serviceWorker.startMessages?.();
  });
  return {
    all,
    next({ since = 0, timeoutMs = 10_000 } = {}) {
      const done = all.find((n) => n.at >= since);
      if (done) return Promise.resolve(done);
      return new Promise<ShownPush>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the service worker showed no notification within ${timeoutMs} ms`)), timeoutMs);
        waiters.push({
          since,
          resolve: (n) => {
            clearTimeout(timer);
            resolve(n);
          },
        });
      });
    },
  };
}

const cdpSessions = new WeakMap<Page, { cdp: CDPSession; registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] }>();

/** Deliver one push message (the opened text) to this page's origin's service worker, as the push service would. */
export async function deliverToServiceWorker(page: Page, data: string): Promise<void> {
  let s = cdpSessions.get(page);
  if (!s) {
    const cdp = await page.context().newCDPSession(page);
    const registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] = [];
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e: { registrations: typeof registrations }) => {
      for (const r of e.registrations) {
        const i = registrations.findIndex((x) => x.registrationId === r.registrationId);
        if (i >= 0) registrations[i] = r;
        else registrations.push(r);
      }
    });
    await cdp.send("ServiceWorker.enable");
    s = { cdp, registrations };
    cdpSessions.set(page, s);
  }
  const origin = new URL(page.url()).origin;
  const deadline = Date.now() + 5000;
  let reg = s.registrations.find((r) => !r.isDeleted && r.scopeURL.startsWith(origin));
  while (!reg && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    reg = s.registrations.find((r) => !r.isDeleted && r.scopeURL.startsWith(origin));
  }
  if (!reg) throw new Error(`no service worker registered for ${origin}`);
  await s.cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId: reg.registrationId, data });
}

/** The service worker's global, as far as these helpers use it (the DOM types have no ServiceWorkerGlobalScope). */
interface WorkerScope {
  registration: { getNotifications(filter?: { tag?: string }): Promise<{ title: string; body: string; tag: string; data: unknown }[]> };
  dispatchEvent(event: Event): boolean;
  NotificationEvent: new (type: string, init: { notification: unknown }) => Event;
}

/** How many notifications with this tag the phone shows now, and their data (read in the service worker). */
export async function shownNotifications(context: BrowserContext, tag?: string): Promise<{ title: string; body: string; tag: string; data: Record<string, unknown> | null }[]> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 5000 }));
  return worker.evaluate(async (t) => {
    const scope = self as unknown as WorkerScope;
    const list = await scope.registration.getNotifications(t ? { tag: t } : undefined);
    return list.map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: (n.data as Record<string, unknown>) ?? null }));
  }, tag ?? null);
}

/** The notification's tap: a notificationclick on the one shown with this tag, run by the service worker's own handler. */
export async function tapNotification(context: BrowserContext, tag: string): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 5000 }));
  const result = await worker.evaluate(async (t) => {
    const scope = self as unknown as WorkerScope;
    const [n] = await scope.registration.getNotifications({ tag: t });
    if (!n) return "no notification with that tag";
    scope.dispatchEvent(new scope.NotificationEvent("notificationclick", { notification: n }));
    return "tapped";
  }, tag);
  if (result !== "tapped") throw new Error(result);
}
