/*
 * Ripple's service worker (C2 track I; real-app 2.6, 2.24). Push notifications only: nothing is cached, no request is
 * intercepted, so no page or answer of one person ever stays on a shared phone.
 *
 *   push                 the payload is lib/push/payload.ts PushPayload ({ title, body, url, tag, renotify, delivery,
 *                        kind, lang }). Shown with its tag, so his second reminder replaces the first. Then every open
 *                        Ripple page gets { type: "rp:push-shown", title, body, url, tag, kind, shown, at } by
 *                        postMessage: the journey recordings draw the real notice from it at that moment
 *                        (web/progress/f3.md 「以后要的钩子」), and a page can react to it.
 *   notificationclick    POST /api/push/opened { delivery } with this phone's cookies marks opened_at: his reminder
 *                        on his phone; her "no reply" alert on hers, with ?link=<her link> taken from the alert's own
 *                        address (/f?link=...). Then the tap lands on the notice's url (a path on this site only): an
 *                        open Ripple page goes there and comes to the front, else a new window opens there.
 *   pushsubscriptionchange   the browser renewed the subscription: the new one is sent to /api/push/subscribe and the
 *                        old one removed, so reminders keep coming.
 */
const ORIGIN = self.location.origin;
const HOME = "/p/today";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// C2 track O (real-app 2.25): the offline shell lives in its own file. Since this line, one thing is cached (the static,
// data-free /offline.html) and navigations are answered from the network first, with that shell only when it fails;
// nothing of any person is kept and no API request is intercepted (see public/sw-offline.js).
importScripts("/sw-offline.js");

/** A path on this site, else Today. */
function sitePath(url) {
  try {
    const u = new URL(typeof url === "string" && url ? url : HOME, ORIGIN);
    return u.origin === ORIGIN ? u.pathname + u.search : HOME;
  } catch {
    return HOME;
  }
}

function readPayload(event) {
  try {
    const p = event.data ? event.data.json() : null;
    if (p && typeof p.title === "string" && p.title) return p;
  } catch {
    // not JSON: shown with the plain words below
  }
  return null;
}

self.addEventListener("push", (event) => {
  const p = readPayload(event) || { title: "Ripple", body: "", url: HOME, tag: "ripple", kind: null };
  const url = sitePath(p.url);
  const tag = typeof p.tag === "string" && p.tag ? p.tag : "ripple";
  const body = typeof p.body === "string" ? p.body : "";
  const options = {
    body,
    tag,
    renotify: !!p.renotify,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    lang: p.lang === "en" ? "en" : "zh-Hans",
    timestamp: Date.parse(p.sent_at) || Date.now(),
    data: { url, delivery: typeof p.delivery === "string" ? p.delivery : null, kind: typeof p.kind === "string" ? p.kind : null },
  };
  event.waitUntil(
    (async () => {
      let shown = true;
      try {
        await self.registration.showNotification(p.title, options);
      } catch {
        shown = false;
      }
      const message = { type: "rp:push-shown", title: p.title, body, url, tag, kind: options.data.kind, shown, at: Date.now() };
      const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const page of pages) page.postMessage(message);
    })(),
  );
});

/** Her alert's address names her care link (/f?link=<id>): the id her tap is recorded through. */
function linkOf(url) {
  try {
    return new URL(url, ORIGIN).searchParams.get("link") || "";
  } catch {
    return "";
  }
}

async function markOpened(data) {
  if (!data || !data.delivery) return;
  const link = data.kind === "family_no_reply" ? linkOf(data.url) : "";
  if (data.kind === "family_no_reply" && !link) return;
  try {
    await fetch("/api/push/opened" + (link ? "?link=" + encodeURIComponent(link) : ""), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery: data.delivery }),
      credentials: "same-origin",
    });
  } catch {
    // offline: the tap still opens the page
  }
}

async function openPage(url) {
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const page = pages.find((c) => c.url.indexOf(ORIGIN) === 0 && c.focused) || pages.find((c) => c.url.indexOf(ORIGIN) === 0);
  if (page) {
    let there = false;
    try {
      await page.navigate(url);
      there = true;
    } catch {
      // a page this worker does not control yet cannot be navigated from here
    }
    try {
      await page.focus();
    } catch {
      // focusing needs the tap's permission; the page is already there
    }
    if (there) return;
  }
  try {
    await self.clients.openWindow(url);
  } catch {
    // nothing more to do
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = sitePath(data.url);
  event.waitUntil(Promise.all([markOpened(data), openPage(url)]));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription || null;
      let next = event.newSubscription || null;
      if (!next) {
        let key = old && old.options ? old.options.applicationServerKey : null;
        if (!key) {
          const res = await fetch("/api/push/key", { credentials: "same-origin" });
          if (!res.ok) return;
          const { publicKey } = await res.json();
          key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
        }
        next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const json = next.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, welcome: false }),
        credentials: "same-origin",
      });
      if (old && old.endpoint && old.endpoint !== json.endpoint) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: old.endpoint }),
          credentials: "same-origin",
        });
      }
    })().catch(() => undefined),
  );
});
