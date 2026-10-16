/**
 * edge-check (C2 track P; docs/plan/hosting.md 5.12, real-app.md 3.4 and 3.12, audits au2 / au3): every check against
 * a scripted edge, passing and failing. No request leaves the test: fetch is a stand-in.
 */
import { describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { cacheStatus, CHECK_NAMES, type EdgeDeps, type EdgeTarget, main as edgeCheck, runChecks } from "@/scripts/deploy/edge-check";
import { APP_DOMAIN, APP_EXTRA, expectNoLeak, fakeFiles, fullDeploy, ORIGIN_DOMAIN, PROD_REF, quietOutput } from "./helpers";

const WEB = webRoot();
const APP = `https://${APP_DOMAIN}`;
const ORIGIN = `https://${ORIGIN_DOMAIN}`;
const AUTH = `https://${PROD_REF}.supabase.co`;
const ASSET = "/_next/static/chunks/main-abc123.js";

const GOOD_HEALTH = { ok: true, store: "supabase", blob: "supabase", auth: "supabase", llm: "deepseek", checker: "deepseek", speech: "mock", speech_problem: null, tts: "mock", tts_ready: true, jobs: true, deployed: true, push: true, build: "BUILD-1" };

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
}

type Route = (req: Seen, nth: number) => Response | Promise<Response> | undefined;

/** A stream that says it is connected, then pings; it stays open until the reader goes away, or ends after `endAfterMs`. */
function eventStream(opts: { connected?: boolean; pingEveryMs?: number; endAfterMs?: number } = {}): Response {
  let timer: ReturnType<typeof setInterval> | undefined;
  let end: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      if (opts.connected !== false) controller.enqueue(enc.encode(": connected\n\n"));
      if (opts.pingEveryMs) timer = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), opts.pingEveryMs);
      if (opts.endAfterMs !== undefined)
        end = setTimeout(() => {
          clearInterval(timer);
          controller.close();
        }, opts.endAfterMs);
    },
    cancel() {
      clearInterval(timer);
      clearTimeout(end);
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** A deployment where everything is as it should be; `over` replaces single routes. */
function edge(over: Route = () => undefined) {
  const seen: Seen[] = [];
  let clock = 0;
  const counts = new Map<string, number>();
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const req: Seen = { method: (init.method ?? "GET").toUpperCase(), url, headers: Object.fromEntries(new Headers(init.headers).entries()) };
    seen.push(req);
    const nth = (counts.get(`${req.method} ${url}`) ?? 0) + 1;
    counts.set(`${req.method} ${url}`, nth);
    const mine = await over(req, nth);
    if (mine) return mine;
    if (url === `${APP}/api/health`) return Response.json({ ...GOOD_HEALTH, time: new Date(1_800_000_000_000 + clock++ * 1000).toISOString() });
    if (url === `${ORIGIN}/api/health`) return new Response("", { status: 403 });
    if (url === `${APP}/api/session` && req.method === "POST") {
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", "rp_session=sess_1; Path=/; HttpOnly");
      headers.append("Set-Cookie", "rp_member=mem_1; Path=/; HttpOnly");
      return new Response(JSON.stringify({ session: { id: "sess_1" } }), { status: 201, headers });
    }
    if (url === `${APP}/api/events?session=sess_1`) return req.headers.cookie?.includes("rp_member=mem_1") ? eventStream({ pingEveryMs: 20 }) : new Response("", { status: 403 });
    if (url.startsWith(`${APP}/api/preflight/wait?ms=`)) {
      const ms = Number(new URL(url).searchParams.get("ms"));
      await new Promise((r) => setTimeout(r, ms));
      return Response.json({ waited_ms: ms });
    }
    if (url === `${APP}/login`) return new Response(`<html><script src="${ASSET}"></script></html>`, { status: 200, headers: { "EO-Cache-Status": "MISS", "Cache-Control": "private, no-cache, no-store" } });
    if (url === `${APP}${ASSET}`) return new Response("js", { status: 200, headers: { "Cache-Control": "public, max-age=31536000, immutable", "EO-Cache-Status": nth === 1 ? "MISS" : "HIT" } });
    if (url === `${APP}/p/today`) return new Response("", { status: 307, headers: { Location: "/login?next=%2Fp%2Ftoday" } });
    if ([`${APP}/director`, `${APP}/backstage`, `${APP}/backstage/real`].includes(url)) return new Response("not found", { status: 404 });
    if (url === `${AUTH}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ kty: "EC", alg: "ES256", kid: "k1", crv: "P-256" }] });
    if (url === `${AUTH}/auth/v1/settings`) return Response.json({ disable_signup: true, external: { anonymous_users: false, email: true } });
    return new Response("unexpected request in a test", { status: 599 });
  }) as typeof fetch;
  // longMs 200, not 40: the check wants 98% of the wait, and a timer on Windows can fire a millisecond early (39 of 40 fails, 199 of 200 passes)
  const deps: Partial<EdgeDeps> = { fetchFn, sleep: async () => {}, sseMs: 150, pingGapMs: 90, longMs: 200 };
  return { seen, deps };
}

const TARGET: EdgeTarget = { app: APP, origin: ORIGIN, supabaseUrl: AUTH, anonKey: "sb_publishable_FAKEPRODanon0123456789zz" };
const run = async (over?: Route, target: Partial<EdgeTarget> = {}) => {
  const e = edge(over);
  const results = await runChecks({ fetchFn: fetch, sleep: async () => {}, now: () => Date.now(), sseMs: 150, pingGapMs: 90, longMs: 200, ...e.deps } as EdgeDeps, { ...TARGET, ...target });
  return { results, byName: Object.fromEntries(results.map((r) => [r.name, r])), seen: e.seen };
};
const json = (body: unknown, status = 200) => Response.json(body as object, { status });

describe("edge-check: a deployment as it should be", () => {
  it("passes all eleven checks", async () => {
    const { results } = await run();
    expect(results.map((r) => r.name)).toEqual([...CHECK_NAMES]);
    expect(results.filter((r) => r.verdict !== "PASS")).toEqual([]);
  });

  it("sends an Origin with its one POST, never the origin lock, and nothing but GETs to the sign-in service", async () => {
    const { seen } = await run();
    const posts = seen.filter((r) => r.method !== "GET");
    expect(posts.map((r) => r.url)).toEqual([`${APP}/api/session`]);
    expect(posts[0].headers.origin).toBe(APP);
    expect(seen.filter((r) => r.url.startsWith(AUTH)).map((r) => r.method)).toEqual(["GET", "GET"]);
    const lockHeaders = seen.filter((r) => r.headers["x-ripple-edge"]);
    expect(lockHeaders.map((r) => r.headers["x-ripple-edge"])).toEqual(["edge-check-not-the-lock-0000000000000000"]);
    for (const r of seen) expect(JSON.stringify(r.headers)).not.toContain(APP_EXTRA.EDGE_SECRET);
    // the event stream is opened with the sandbox's own device cookies, as a phone would
    expect(seen.find((r) => r.url.includes("/api/events"))!.headers.cookie).toBe("rp_session=sess_1; rp_member=mem_1");
  });

  it("compares the two open decisions only when told what they are", async () => {
    const whisper = { ...GOOD_HEALTH, speech: "whisper" };
    const route: Route = (req) => (req.url === `${APP}/api/health` ? json({ ...whisper, time: String(Math.random()) }) : undefined);
    expect((await run(route)).byName.health.verdict).toBe("PASS");
    expect((await run(route)).byName.health.detail).toContain("speech=whisper");
    const told = (await run(route, { speech: "mock", tts: "mock" })).byName.health;
    expect(told.verdict).toBe("FAIL");
    expect(told.detail).toBe("speech is whisper, must be mock");
  });
});

describe("edge-check: what each check catches", () => {
  const healthOf = (body: Record<string, unknown>): Route => (req) => (req.url === `${APP}/api/health` ? json({ ...GOOD_HEALTH, time: String(Math.random()), ...body }) : undefined);

  it("health: a provider that fell back, a server that is not the deployment, or no answer", async () => {
    expect((await run(healthOf({ llm: "mock", checker: "none" }))).byName.health.detail).toBe("llm is mock, must be deepseek; checker is none, must be deepseek");
    expect((await run(healthOf({ deployed: false }))).byName.health.verdict).toBe("FAIL");
    expect((await run(healthOf({ store: "memory" }))).byName.health.verdict).toBe("FAIL");
    expect((await run(healthOf({ push: false }))).byName.health.detail).toMatch(/push is false/);
    const down = await run((req) => (req.url === `${APP}/api/health` ? new Response("", { status: 502 }) : undefined));
    expect(down.byName.health.detail).toBe("GET /api/health → HTTP 502");
    expect(down.byName["health-fresh"].verdict).toBe("FAIL");
    const dead = await run((req) => (req.url === `${APP}/api/health` ? Promise.reject(new TypeError("fetch failed")) : undefined));
    expect(dead.byName.health.verdict).toBe("FAIL");
  });

  it("health-fresh: an answer served from the edge's cache", async () => {
    const cached = await run((req) => (req.url === `${APP}/api/health` ? json({ ...GOOD_HEALTH, time: "2026-10-16T01:00:00.000Z" }) : undefined));
    expect(cached.byName["health-fresh"]).toMatchObject({ verdict: "FAIL", detail: expect.stringContaining("same server time") });
  });

  it("origin-lock: an origin that answers without the lock, or to a wrong one", async () => {
    const open = await run((req) => (req.url === `${ORIGIN}/api/health` ? json(GOOD_HEALTH) : undefined));
    expect(open.byName["origin-lock"]).toMatchObject({ verdict: "FAIL", detail: expect.stringContaining("the app can be reached around the edge") });
    const sloppy = await run((req) => (req.url === `${ORIGIN}/api/health` ? (req.headers["x-ripple-edge"] ? json(GOOD_HEALTH) : new Response("", { status: 403 })) : undefined));
    expect(sloppy.byName["origin-lock"].detail).toMatch(/answered HTTP 200 to a wrong lock/);
    const dead = await run((req) => (req.url === `${ORIGIN}/api/health` ? Promise.reject(new TypeError("fetch failed")) : undefined));
    expect(dead.byName["origin-lock"].detail).toMatch(/are 80 and 443 open, is Caddy running/);
  });

  it("event-stream: cut by the edge, held back, silent, refused, or no sandbox", async () => {
    const stream = (res: () => Response): Route => (req) => (req.url.includes("/api/events") ? res() : undefined);
    expect((await run(stream(() => eventStream({ pingEveryMs: 20, endAfterMs: 60 })))).byName["event-stream"].detail).toMatch(/the stream ended after \d+ s \(it must stay open/);
    expect((await run(stream(() => eventStream({ connected: true })))).byName["event-stream"].detail).toMatch(/nothing arrived for .* s \(pings come every 20 s\)/);
    expect((await run(stream(() => new Response("", { status: 524 })))).byName["event-stream"].detail).toBe("GET /api/events → HTTP 524");
    const limited = await run((req) => (req.method === "POST" ? json({ error: "too_many" }, 429) : undefined));
    expect(limited.byName["event-stream"].detail).toMatch(/sandbox limit for this address is used up/);
    const refused = await run((req) => (req.method === "POST" ? json({ error: "bad_origin" }, 403) : undefined));
    expect(refused.byName["event-stream"].detail).toBe("POST /api/session → HTTP 403");
  });

  it("long-request: the edge's default origin timeout, or something answering early", async () => {
    const cut = await run((req) => (req.url.includes("/api/preflight/wait") ? new Response("", { status: 524 }) : undefined));
    expect(cut.byName["long-request"].detail).toMatch(/HTTP 524 .*origin timeout is still the default/);
    const early = await run((req) => (req.url.includes("/api/preflight/wait") ? json({ waited_ms: 0 }) : undefined));
    expect(early.byName["long-request"].detail).toMatch(/before the wait finished/);
  });

  it("static-cache: no one-year header, no hit on the second request, or a header the script does not know", async () => {
    const asset = (headers: (nth: number) => Record<string, string>): Route => (req, nth) => (req.url === `${APP}${ASSET}` ? new Response("js", { status: 200, headers: headers(nth) }) : undefined);
    expect((await run(asset(() => ({ "Cache-Control": "no-store", "EO-Cache-Status": "MISS" })))).byName["static-cache"].detail).toMatch(/does not carry Cache-Control: max-age=31536000, immutable/);
    expect((await run(asset(() => ({ "Cache-Control": "public, max-age=31536000, immutable", "EO-Cache-Status": "MISS" })))).byName["static-cache"].detail).toMatch(/second request was not a cache hit/);
    const unknown = (await run(asset(() => ({ "Cache-Control": "public, max-age=31536000, immutable", "X-Some-Edge": "1" })))).byName["static-cache"];
    expect(unknown.verdict).toBe("HAND");
    expect(unknown.detail).toMatch(/headers: cache-control, .*x-some-edge/);
    const noAsset = await run((req) => (req.url === `${APP}/login` ? new Response("<html>no scripts</html>", { headers: { "EO-Cache-Status": "MISS" } }) : undefined));
    expect(noAsset.byName["static-cache"].verdict).toBe("FAIL");
  });

  it("pages-not-cached: a page answered from the edge's cache", async () => {
    const hit = await run((req, nth) => (req.url === `${APP}/login` ? new Response(`<script src="${ASSET}"></script>`, { headers: { "EO-Cache-Status": nth === 1 ? "MISS" : "HIT" } }) : undefined));
    expect(hit.byName["pages-not-cached"]).toMatchObject({ verdict: "FAIL", detail: expect.stringContaining("from its cache") });
    const unknown = await run((req) => (req.url === `${APP}/login` ? new Response(`<script src="${ASSET}"></script>`) : undefined));
    expect(unknown.byName["pages-not-cached"].verdict).toBe("HAND");
  });

  it("reads the cache status from the headers edges use", () => {
    expect(cacheStatus(new Headers({ "EO-Cache-Status": "HIT" }))).toBe("hit");
    expect(cacheStatus(new Headers({ "EO-Cache-Status": "MISS" }))).toBe("miss");
    expect(cacheStatus(new Headers({ "X-Cache-Lookup": "Cache Hit" }))).toBe("hit");
    expect(cacheStatus(new Headers({ "X-Cache-Lookup": "Cache Miss" }))).toBe("miss");
    expect(cacheStatus(new Headers({ "X-Cache": "Hit from MemCache" }))).toBe("hit");
    expect(cacheStatus(new Headers({ Server: "edge" }))).toBe("unknown");
  });

  it("signed-out: /p/today that opens, or goes somewhere else", async () => {
    expect((await run((req) => (req.url === `${APP}/p/today` ? new Response("<html>today</html>") : undefined))).byName["signed-out"].detail).toMatch(/HTTP 200 \(must be a redirect to \/login\)/);
    expect((await run((req) => (req.url === `${APP}/p/today` ? new Response("", { status: 307, headers: { Location: "/demo" } }) : undefined))).byName["signed-out"].detail).toBe("HTTP 307, but not to /login");
  });

  it("director-404: a film crew page that opens", async () => {
    const res = await run((req) => (req.url === `${APP}/backstage` ? new Response("<html>backstage</html>") : undefined));
    expect(res.byName["director-404"]).toMatchObject({ verdict: "FAIL", detail: expect.stringContaining("/backstage → HTTP 200") });
  });

  it("auth-keys: a shared secret instead of asymmetric keys", async () => {
    const keys = (body: unknown): Route => (req) => (req.url.endsWith("/jwks.json") ? json(body) : undefined);
    expect((await run(keys({ keys: [] }))).byName["auth-keys"].detail).toMatch(/publishes no key: it still signs with a shared secret \(HS256\)/);
    expect((await run(keys({ keys: [{ kty: "oct", alg: "HS256" }, { kty: "EC", alg: "ES256" }] }))).byName["auth-keys"].detail).toBe("1 of 2 published keys are not asymmetric");
    expect((await run(keys({ keys: [{ kty: "RSA", alg: "RS256" }] }))).byName["auth-keys"].verdict).toBe("PASS");
    expect((await run((req) => (req.url.endsWith("/jwks.json") ? new Response("", { status: 404 }) : undefined))).byName["auth-keys"].verdict).toBe("FAIL");
  });

  it("signup-closed: open sign-up, anonymous sign-in, or a settings document that does not say", async () => {
    const settings = (body: unknown, status = 200): Route => (req) => (req.url.endsWith("/auth/v1/settings") ? json(body, status) : undefined);
    expect((await run(settings({ disable_signup: false, external: { anonymous_users: false } }))).byName["signup-closed"].detail).toMatch(/public sign-up is OPEN/);
    expect((await run(settings({ disable_signup: true, external: { anonymous_users: true } }))).byName["signup-closed"].detail).toMatch(/anonymous sign-in is ON/);
    expect((await run(settings({ external: {} }))).byName["signup-closed"].verdict).toBe("HAND");
    expect((await run(settings({ message: "No API key found" }, 401))).byName["signup-closed"].verdict).toBe("HAND");
    const { seen } = await run(settings({ disable_signup: false }));
    expect(seen.filter((r) => r.url.startsWith(AUTH) && r.method !== "GET")).toEqual([]);
    expect(seen.find((r) => r.url.endsWith("/auth/v1/settings"))!.headers.apikey).toBe(TARGET.anonKey);
  });
});

describe("edge-check: the script", () => {
  const go = async (f: ReturnType<typeof fakeFiles>, argv: string[], over?: Route) => {
    const e = edge(over);
    const out = quietOutput();
    const code = await edgeCheck([...argv, ...f.flags], out, e.deps, WEB);
    return { code, text: out.text(), seen: e.seen };
  };

  it("sends nothing without --yes and nothing in a dry run", async () => {
    const f = fakeFiles();
    const refused = await go(f, []);
    expect(refused.code).toBe(2);
    expect(refused.seen).toHaveLength(0);
    const dry = await go(f, ["--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.seen).toHaveLength(0);
    expect(dry.text).toContain("GET  https://<DEPLOY_ORIGIN_DOMAIN>/api/health  without the lock, and with a made-up one (the real lock is never sent)");
    expect(dry.text).toContain("GET  <SUPABASE_URL>/auth/v1/settings");
    expectNoLeak(dry.text, f);
  });

  it("refuses a --url that is not the deploy file's public name", async () => {
    const res = await go(fakeFiles(), ["--url", "https://staging.somewhere-else.example", "--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/--url is not https:\/\/<DEPLOY_APP_DOMAIN>/);
    expect(res.seen).toHaveLength(0);
    expect((await go(fakeFiles(), ["--url", `https://${APP_DOMAIN}/`, "--dry-run"])).code).toBe(0);
  });

  it("with --yes: eleven lines, exit 0 when all pass, and no value of the deploy file in the output", async () => {
    const f = fullDeploy();
    const res = await go(f, ["--yes", "--speech", "mock", "--tts", "mock"]);
    expect(res.code).toBe(0);
    expect(res.text).toContain("edge-check: 11 passed, 0 failed, 0 to check by hand.");
    expect(res.text).toMatch(/Not checked by this script .*token lifetime \(900 s\)/);
    expectNoLeak(res.text, f);
  });

  it("exits 1 when a check fails, and says CHECK BY HAND for what it cannot decide", async () => {
    const res = await go(fakeFiles(), ["--yes"], (req) => {
      if (req.url.endsWith("/auth/v1/settings")) return json({ disable_signup: false });
      if (req.url === `${APP}/login`) return new Response(`<script src="${ASSET}"></script>`);
      return undefined;
    });
    expect(res.code).toBe(1);
    expect(res.text).toMatch(/FAIL {2}signup-closed\s+public sign-up is OPEN/);
    expect(res.text).toMatch(/CHECK BY HAND {2}pages-not-cached/);
    expect(res.text).toContain("edge-check: 9 passed, 1 failed, 1 to check by hand.");
  });

  it("needs the two names, the project address and the publishable key", async () => {
    const res = await go(fakeFiles({ SUPABASE_ANON_KEY: null }), ["--yes"]);
    expect(res.code).toBe(2);
    expect(res.text).toMatch(/SUPABASE_ANON_KEY is not set/);
    expect(res.seen).toHaveLength(0);
  });
});
