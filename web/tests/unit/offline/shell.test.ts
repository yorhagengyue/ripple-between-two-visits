/**
 * The offline shell (C2 track O; real-app 2.25 「页面缓存只放应用外壳，不缓存任何接口数据」): public/sw-offline.js run here against
 * a stand-in for the service worker's world (its events, Cache Storage, fetch), and public/offline.html read as text.
 * What must hold: only navigations are handled and the network always wins; no API address is ever handled; no answer to
 * a navigation is ever cached; the only thing cached is the static shell, fetched without cookies, per build, and only
 * when a signed-in page asks; and the shell itself fetches and names nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const PUBLIC = path.resolve(__dirname, "../../../public");
const SW = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
const SW_OFFLINE = readFileSync(path.join(PUBLIC, "sw-offline.js"), "utf8");
const SHELL = readFileSync(path.join(PUBLIC, "offline.html"), "utf8");
const ORIGIN = "http://localhost:3630";

type Listener = (event: unknown) => void;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** A service worker's world, small: listeners, Cache Storage, and a network the test scripts. */
function world() {
  const listeners = new Map<string, Listener[]>();
  const stores = new Map<string, Map<string, Response>>();
  const puts: { cache: string; url: string }[] = [];
  const fetched: FetchCall[] = [];
  const net = { handler: (async () => new Response("", { status: 404 })) as (url: string, init?: RequestInit) => Promise<unknown> };
  const caches = {
    keys: async () => [...stores.keys()],
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (url: string, res: Response) => {
          puts.push({ cache: name, url });
          store.set(url, res);
        },
        match: async (url: string) => store.get(url)?.clone(),
      };
    },
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  };
  const fetchFn = async (input: string | { url: string }, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    fetched.push({ url, init });
    return net.handler(url, init);
  };
  // the worker file is a classic script: it is run as one, with its world handed in
  new Function("self", "caches", "fetch", "crypto", SW_OFFLINE)(self, caches, fetchFn, globalThis.crypto);

  async function message(type: string): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const fn of listeners.get("message") ?? []) fn({ data: { type }, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);
  }

  /** Dispatch a fetch event; `responded` is what the worker answered with, or undefined when it left the request alone. */
  function request(url: string, over: { method?: string; mode?: string } = {}) {
    let responded: Promise<Response> | undefined;
    const event = {
      request: { url: url.startsWith("http") ? url : `${ORIGIN}${url}`, method: over.method ?? "GET", mode: over.mode ?? "navigate" },
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
      waitUntil: () => undefined,
    };
    for (const fn of listeners.get("fetch") ?? []) fn(event);
    return responded;
  }

  return { listeners, stores, puts, fetched, net, message, request };
}

const shellResponse = (body = SHELL, type = "text/html; charset=UTF-8") => new Response(body, { status: 200, headers: { "content-type": type } });

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

describe("public/sw.js loads the offline file", () => {
  it("with exactly one importScripts line", () => {
    const lines = SW.split(/\r?\n/).filter((l) => /importScripts\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    expect(lines).toEqual(['importScripts("/sw-offline.js");']);
  });
});

describe("what the worker handles", () => {
  it("leaves everything that is not a navigation alone: scripts, styles, RSC fetches, the event stream, every API call", () => {
    for (const [url, mode] of [
      ["/_next/static/chunks/main.js", "no-cors"],
      ["/_next/static/css/app.css", "no-cors"],
      ["/p/today?_rsc=abc12", "cors"],
      ["/api/events", "cors"],
      ["/api/doses", "same-origin"],
      ["/api/bp", "same-origin"],
      ["/api/ask/history", "same-origin"],
      ["/manifest.webmanifest", "cors"],
      ["/icons/icon-192.png", "no-cors"],
    ] as const) {
      expect(w.request(url, { mode }), url).toBeUndefined();
    }
    expect(w.request("/api/doses", { method: "POST", mode: "same-origin" })).toBeUndefined();
    expect(w.fetched).toEqual([]);
  });

  it("never handles an API address, a form post, or another origin, even as a navigation", () => {
    expect(w.request("/api/brief")).toBeUndefined();
    expect(w.request("/api/blob/abc")).toBeUndefined();
    expect(w.request("/login", { method: "POST" })).toBeUndefined();
    expect(w.request("https://example.org/p/today")).toBeUndefined();
    expect(w.fetched).toEqual([]);
  });

  it("a navigation goes to the network, unchanged, and its answer is passed on and never cached", async () => {
    await w.message("rp:shell-keep").catch(() => undefined);
    w.net.handler = async (url) => (url.endsWith("/offline.html") ? shellResponse() : new Response("<html>his Today, his medicines</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await w.message("rp:shell-keep");
    const putsBefore = w.puts.length;
    for (const url of ["/p/today", "/p/bp", "/p/ask", "/f?link=abc", "/login?next=%2Fp%2Ftoday", "/"]) {
      const res = await w.request(url)!;
      expect(await res.text(), url).toBe("<html>his Today, his medicines</html>");
    }
    expect(w.puts.length).toBe(putsBefore);
    // an error page from the server is an answer too: passed on, the shell is not shown in its place
    w.net.handler = async () => new Response("down", { status: 503 });
    expect((await w.request("/p/today")!).status).toBe(503);
    // everything in Cache Storage is the shell
    for (const store of w.stores.values()) expect([...store.keys()]).toEqual(["/offline.html"]);
  });

  it("without a network and without a shell, the navigation fails as it always did", async () => {
    w.net.handler = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(w.request("/p/today")!).rejects.toThrow("Failed to fetch");
  });
});

describe("the shell in the cache", () => {
  it("is not cached at install or activate, only when a signed-in page asks; then a failed navigation shows it", async () => {
    expect([...w.listeners.keys()].sort()).toEqual(["fetch", "message"]);
    expect(w.fetched).toEqual([]);
    w.net.handler = async (url) => {
      if (url.endsWith("/offline.html")) return shellResponse();
      throw new TypeError("Failed to fetch");
    };
    await w.message("rp:shell-keep");
    // fetched without cookies, never from the HTTP cache, a redirect is an error
    expect(w.fetched).toEqual([{ url: "/offline.html", init: { cache: "no-cache", credentials: "omit", redirect: "error" } }]);
    expect([...w.stores.keys()]).toHaveLength(1);
    expect([...w.stores.keys()][0]).toMatch(/^rp-shell-[0-9a-f]{32}$/);
    for (const url of ["/p/today", "/p/bp", "/p/ask", "/p/questions", "/f"]) {
      const res = await w.request(url)!;
      expect(res.status).toBe(200);
      expect(await res.text(), url).toBe(SHELL);
    }
  });

  it("is named by its own bytes: another build's shell replaces it, the same build's is kept as it is", async () => {
    w.net.handler = async () => shellResponse();
    await w.message("rp:shell-keep");
    const first = [...w.stores.keys()];
    await w.message("rp:shell-keep");
    expect([...w.stores.keys()]).toEqual(first);
    expect(w.puts).toHaveLength(1);
    w.net.handler = async () => shellResponse(SHELL.replace("</main>", "<!-- next build --></main>"));
    await w.message("rp:shell-keep");
    const second = [...w.stores.keys()];
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
  });

  it("only the shell itself is kept: a redirect, another page, a page of his, or something that is not HTML is not", async () => {
    const refused: (() => Promise<unknown>)[] = [
      // the proxy sent this device somewhere else (redirect: "error" makes the real fetch reject)
      async () => {
        throw new TypeError("redirect mode is set to error");
      },
      async () => ({ ok: true, redirected: true, headers: new Headers({ "content-type": "text/html" }), arrayBuffer: async () => new TextEncoder().encode(SHELL).buffer }),
      async () => new Response("<html><body>今天 Amlodipine 5 mg</body></html>", { status: 200, headers: { "content-type": "text/html" } }),
      async () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
      async () => new Response(SHELL, { status: 200, headers: { "content-type": "application/json" } }),
      async () => new Response(SHELL, { status: 404, headers: { "content-type": "text/html" } }),
      async () => new Response(SHELL, { status: 503, headers: { "content-type": "text/html" } }),
    ];
    for (const handler of refused) {
      w.net.handler = handler;
      await w.message("rp:shell-keep");
      expect(w.puts).toEqual([]);
      expect([...w.stores.keys()]).toEqual([]);
    }
  });

  it("rp:shell-drop deletes it; after that a failed navigation fails again", async () => {
    w.net.handler = async (url) => {
      if (url.endsWith("/offline.html")) return shellResponse();
      throw new TypeError("Failed to fetch");
    };
    await w.message("rp:shell-keep");
    expect(await (await w.request("/p/today")!).text()).toBe(SHELL);
    await w.message("rp:shell-drop");
    expect([...w.stores.keys()]).toEqual([]);
    await expect(w.request("/p/today")!).rejects.toThrow("Failed to fetch");
  });
});

describe("public/offline.html", () => {
  it("carries the worker's marker and loads nothing: no script file, stylesheet, image, font or address", () => {
    expect(SHELL).toContain('<meta name="rp-shell" content="1"');
    expect(SHELL).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(SHELL).not.toMatch(/<link\b/i);
    expect(SHELL).not.toMatch(/<img\b|<iframe\b|<video\b|<audio\b/i);
    expect(SHELL).not.toMatch(/url\(/i);
    expect(SHELL).not.toMatch(/https?:\/\//i);
    expect(SHELL).not.toMatch(/@import|@font-face/i);
  });

  it("asks the network for one thing only, without cookies: whether it is back", () => {
    const fetches = SHELL.match(/fetch\([^)]*\)/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain('"/manifest.webmanifest"');
    expect(fetches[0]).toContain('credentials: "omit"');
    expect(SHELL).not.toMatch(/\/api\//);
    expect(SHELL).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
  });

  it("reads only the phone's own list (a count), its owner tag and the language cookie; writes nothing", () => {
    const keys = [...SHELL.matchAll(/localStorage\.(\w+)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(keys.sort()).toEqual(["getItem rp_outbox_owner", "getItem rp_outbox_v1"]);
    expect(SHELL).not.toMatch(/setItem|removeItem|sessionStorage|indexedDB|document\.cookie\s*=/);
    // the count is shown, never an entry's contents
    expect(SHELL).not.toMatch(/\.body\b|\.label\b|systolic|medication/);
  });

  it("follows the elder screens (the timeline design): nothing under 18, one sentence on top, one worded button 72 high", () => {
    const sizes = [...SHELL.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(18);
    expect(SHELL).not.toMatch(/font-size:\s*[\d.]+px/);
    // the draft's filled button: 72 high, the accent, white words
    expect(SHELL).toMatch(/\.btn\s*\{[^}]*min-height:\s*4\.5rem/);
    expect(SHELL).toMatch(/\.btn\s*\{[^}]*background:\s*#6a4c93/i);
    // the design's ground and ink, and none of the first look's colours
    expect(SHELL).toMatch(/background:\s*#f2f5f9/i);
    expect(SHELL).toMatch(/color:\s*#18202c/i);
    expect(SHELL).not.toMatch(/#f6f3ed|#0a6b63|#17191b|#d9d2c5/i);
    expect(SHELL.match(/<h1\b/g)).toHaveLength(1);
    expect(SHELL.match(/<button\b/g)).toHaveLength(1);
    expect(SHELL).toContain('data-rp-side="elder"');
    expect(SHELL).toContain("现在没有网络。");
    expect(SHELL).not.toMatch(/user-scalable|maximum-scale/);
  });
});
