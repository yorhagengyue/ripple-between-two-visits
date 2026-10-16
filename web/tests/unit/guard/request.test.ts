/**
 * What a data route's body may be (lib/guard/request.ts; track L; real-app 3.4 line 512: 「改数据的接口只收
 * application/json」): JSON or no body, 415 otherwise, with the byte routes listed. Through web/proxy.ts for every
 * route its matcher sees. (Where a write comes from is track A's: tests/unit/auth/proxy-front.test.ts.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { BYTE_ROUTES, guardBody, isByteRoute, jsonOrEmpty, matchesRoutePath } from "@/lib/guard/request";
import { config, proxy } from "@/proxy";

const SITE = "https://app.ripple.example";

function req(method: string, p: string, headers: Record<string, string> = {}, body?: string): NextRequest {
  return new NextRequest(`${SITE}${p}`, { method, headers, ...(body === undefined ? {} : { body }) });
}
const browser = (extra: Record<string, string> = {}) => ({ origin: SITE, "sec-fetch-site": "same-origin", ...extra });
const json = { "content-type": "application/json" };
const errorOf = async (res: Response | null) => (res ? { status: res.status, ...((await res.json()) as { error: string }) } : null);

describe("guardBody", () => {
  it("reading is never checked", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(guardBody(req(m, "/api/doses", { "content-type": "text/plain" })), m).toBeNull();
  });

  it("JSON, with or without a charset, passes; so does a write with no body at all", () => {
    expect(guardBody(req("POST", "/api/doses", json, "{}"))).toBeNull();
    expect(guardBody(req("PATCH", "/api/bp", { "content-type": "application/json; charset=utf-8" }, "{}"))).toBeNull();
    expect(guardBody(req("POST", "/api/session/reset"))).toBeNull();
    expect(guardBody(req("DELETE", "/api/reminders/r1"))).toBeNull();
    expect(guardBody(req("POST", "/api/family/links/l1/leave", { "content-length": "0" }))).toBeNull();
  });

  it("anything else to a data route is 415 invalid_body", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "audio/wav", "application/jsonp"]) {
      expect(await errorOf(guardBody(req("POST", "/api/doses", { "content-type": type }, "a=1"))), type).toEqual({ status: 415, error: "invalid_body" });
    }
    for (const m of ["PUT", "PATCH", "DELETE"]) expect(await errorOf(guardBody(req(m, "/api/meds/m1", { "content-type": "text/plain" }, "x"))), m).toEqual({ status: 415, error: "invalid_body" });
    // a body with no type at all
    expect(await errorOf(guardBody(req("POST", "/api/doses", { "content-length": "3" })))).toEqual({ status: 415, error: "invalid_body" });
    expect(await errorOf(guardBody(req("POST", "/api/doses", { "transfer-encoding": "chunked" })))).toEqual({ status: 415, error: "invalid_body" });
  });

  it("pages are not data routes: their bodies are left to Next", () => {
    expect(guardBody(req("POST", "/login", { "content-type": "text/plain" }, "x"))).toBeNull();
    expect(guardBody(req("POST", "/p/today", { "content-type": "application/x-www-form-urlencoded" }, "a=1"))).toBeNull();
  });

  it("the byte routes take their bytes, and only with their own method", async () => {
    expect(guardBody(req("POST", "/api/asr/chunk", { "content-type": "audio/wav" }, "RIFF"))).toBeNull();
    expect(guardBody(req("POST", "/api/ask/transcribe", { "content-type": "audio/wav" }, "RIFF"))).toBeNull(); // track S's microphone
    expect(guardBody(req("PUT", "/api/blob/upload", { "content-type": "image/png" }, "PNG"))).toBeNull();
    expect(guardBody(req("POST", "/api/preflight/upload", { "content-type": "application/octet-stream" }, "0000"))).toBeNull();
    expect(await errorOf(guardBody(req("POST", "/api/blob/upload", { "content-type": "image/png" }, "PNG")))).toEqual({ status: 415, error: "invalid_body" });
    expect(await errorOf(guardBody(req("POST", "/api/asr/chunk/extra", { "content-type": "audio/wav" }, "RIFF")))).toEqual({ status: 415, error: "invalid_body" });
    expect(isByteRoute("post", "/api/asr/chunk")).toBe(true);
    expect(isByteRoute("POST", "/api/doses")).toBe(false);
  });

  it("a row's path is the route's folder: a [name] segment stands for any one segment (for routes to come)", () => {
    expect(matchesRoutePath("/api/visits/[id]/parts", "/api/visits/v-123/parts")).toBe(true);
    expect(matchesRoutePath("/api/visits/[id]/parts", "/api/visits//parts")).toBe(false);
    expect(matchesRoutePath("/api/visits/[id]/parts", "/api/visits/v-123/parts/2")).toBe(false);
    expect(matchesRoutePath("/api/visits/[id]/parts", "/api/visits/v-123")).toBe(false);
    expect(matchesRoutePath("/api/asr/chunk", "/api/asr/chunk")).toBe(true);
    expect(matchesRoutePath("/api/asr/chunk", "/api/asr/chunks")).toBe(false);
  });

  it("jsonOrEmpty", () => {
    const h = (init: Record<string, string>) => new Headers(init);
    expect(jsonOrEmpty(h({}))).toBe(true);
    expect(jsonOrEmpty(h({ "content-length": "0" }))).toBe(true);
    expect(jsonOrEmpty(h({ "content-type": "Application/JSON" }))).toBe(true);
    expect(jsonOrEmpty(h({ "content-type": "text/plain", "content-length": "0" }))).toBe(false);
    expect(jsonOrEmpty(h({ "content-length": "12" }))).toBe(false);
  });
});

describe("through web/proxy.ts", () => {
  it("a body that is not JSON is 415 before anything else runs (no cookie read, no session refreshed), with the fixed headers", async () => {
    const res = await proxy(req("POST", "/api/doses", browser({ "content-type": "text/plain", cookie: "rp_rt=anything; rp_at=anything" }), "{}"));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("JSON, no body, and the audio route's bytes are passed on to their routes", async () => {
    for (const r of [
      req("POST", "/api/doses", browser(json), "{}"),
      req("DELETE", "/api/reminders/r1", browser()),
      req("POST", "/api/asr/chunk?visit_id=v1", browser({ "content-type": "audio/wav" }), "RIFF"),
    ]) {
      const res = await proxy(r);
      expect(res.status, r.nextUrl.pathname).toBe(200);
      expect(res.headers.get("x-middleware-next"), r.nextUrl.pathname).toBe("1");
    }
  });

  it("another site's write is refused for its origin first (track A's check), whatever its body is", async () => {
    const res = await proxy(req("POST", "/api/doses", { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" }, "{}"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
  });

  it("the two upload routes are outside the proxy's matcher: they are byte routes, so the body rule has nothing to say there", () => {
    const matcher = config.matcher.join(" ");
    for (const p of ["api/blob/upload", "api/preflight/upload"]) expect(matcher).toContain(p);
  });
});

describe("the byte routes are exactly the routes that read bytes", () => {
  const API = path.join(process.cwd(), "app", "api");
  function routes(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? routes(p) : name === "route.ts" ? [p] : [];
    });
  }
  const urlOf = (file: string) => `/api/${path.relative(API, path.dirname(file)).split(path.sep).join("/")}`;
  /** a handler that takes the body as bytes, a stream, a form or a blob (JSON goes through parseBody / req.json) */
  const READS_BYTES = /\breq(?:uest)?\.(?:arrayBuffer|formData|blob|bytes)\(|\breq(?:uest)?\.body\b/;
  /** A route file and the lib files it imports directly (a route may hand its request to lib/**, as /api/ask/transcribe does). */
  function sourcesOf(routeFile: string): string[] {
    const own = readFileSync(routeFile, "utf8");
    const out = [own];
    for (const m of own.matchAll(/from "@\/(lib\/[^"]+)"/g)) {
      for (const candidate of [`${m[1]}.ts`, `${m[1]}.tsx`, `${m[1]}/index.ts`]) {
        const p = path.join(process.cwd(), ...candidate.split("/"));
        if (existsSync(p)) {
          out.push(readFileSync(p, "utf8"));
          break;
        }
      }
    }
    return out;
  }

  it("every route that reads raw bytes is listed, and every listed route exists with that method", () => {
    const all = routes(API);
    expect(all.length).toBeGreaterThan(80);
    // only a route with a write method can take a body (a GET-only route may share a lib file with one that does)
    const writes = (f: string) => /export (?:async function|const) (?:POST|PUT|PATCH|DELETE)\b/.test(readFileSync(f, "utf8"));
    const readers = all.filter((f) => writes(f) && sourcesOf(f).some((src) => READS_BYTES.test(src))).map(urlOf).sort();
    // a route missing here answers 415 at the proxy: add its row to BYTE_ROUTES (lib/guard/request.ts says how)
    expect(readers).toEqual(BYTE_ROUTES.map((r) => r.path).sort());
    for (const r of BYTE_ROUTES) {
      const src = readFileSync(path.join(API, ...r.path.replace("/api/", "").split("/"), "route.ts"), "utf8");
      expect(src, r.path).toMatch(new RegExp(`export async function ${r.method}\\b`));
    }
  });
});
