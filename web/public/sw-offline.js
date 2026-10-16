/*
 * The offline shell (C2 track O; real-app 2.25 「页面缓存只放应用外壳，不缓存任何接口数据」). Loaded by public/sw.js with one
 * importScripts line; the push handlers there are track I's and are not touched.
 *
 * What "shell" means here: every page of the app is drawn on the server from one person's own data, so no page of the
 * app can be kept. The shell is one small static page, /offline.html, that names nobody and holds nothing of anyone:
 * 「现在没有网络」, how many entries wait on this phone (read from the phone's own list by the page's script), and a way
 * back. That is all this worker ever caches.
 *
 *   never cached      /api/** (not even looked at), any page of the app, any answer to a navigation, anything fetched
 *                     with cookies. The shell is fetched with credentials "omit", must not be a redirect, and must
 *                     carry the shell's own marker, or it is not kept.
 *   the network wins  only navigations are handled, and each one goes to the network first, unchanged. The cache is
 *                     read only when that fails (no network): then, and only then, the shell is shown in its place.
 *                     Everything else (scripts, styles, RSC fetches, the event stream, every API call) is not
 *                     intercepted at all.
 *   per build         the cache is named rp-shell-<sha256 of the shell's bytes>: a build that ships another shell gets
 *                     another cache, and every other rp-shell-* cache is deleted when it is filled.
 *   only signed in    the shell is cached when an account's own page asks for it (message "rp:shell-keep", sent by
 *                     components/offline/OfflineProvider on every page load), never at install. Logging out deletes
 *                     every cache from the page (lib/offline/forget.ts) and nothing puts the shell back until someone
 *                     is signed in on this phone again. "rp:shell-drop" deletes it from here.
 */
const SHELL_URL = "/offline.html";
const SHELL_PREFIX = "rp-shell-";
const SHELL_MARK = '<meta name="rp-shell" content="1"';

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function shellCaches() {
  return (await caches.keys()).filter((k) => k.indexOf(SHELL_PREFIX) === 0);
}

/** Fetch the shell without cookies and keep it under this build's name; other builds' shells go. */
async function keepShell() {
  const res = await fetch(SHELL_URL, { cache: "no-cache", credentials: "omit", redirect: "error" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || res.redirected || type.indexOf("text/html") !== 0) return false;
  const bytes = await res.arrayBuffer();
  if (new TextDecoder().decode(bytes).indexOf(SHELL_MARK) < 0) return false;
  const name = SHELL_PREFIX + (await sha256Hex(bytes)).slice(0, 32);
  const names = await shellCaches();
  if (names.indexOf(name) < 0) {
    const cache = await caches.open(name);
    await cache.put(SHELL_URL, new Response(bytes, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }));
  }
  await Promise.all(names.filter((k) => k !== name).map((k) => caches.delete(k)));
  return true;
}

async function dropShell() {
  await Promise.all((await shellCaches()).map((k) => caches.delete(k)));
}

async function cachedShell() {
  for (const name of await shellCaches()) {
    const hit = await (await caches.open(name)).match(SHELL_URL);
    if (hit) return hit;
  }
  return null;
}

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "rp:shell-keep") event.waitUntil(keepShell().catch(() => false));
  if (type === "rp:shell-drop") event.waitUntil(dropShell().catch(() => undefined));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // navigations only; an API address is never handled, whatever asks for it
  if (req.method !== "GET" || req.mode !== "navigate") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (err) {
        const shell = await cachedShell().catch(() => null);
        if (shell) return shell;
        throw err;
      }
    })(),
  );
});
