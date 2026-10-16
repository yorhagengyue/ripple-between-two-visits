/**
 * npx tsx scripts/deploy/edge-check.ts [--url https://<DEPLOY_APP_DOMAIN>] [--speech mock|whisper|tencent] [--tts mock|trtc] --dry-run | --yes
 *
 * The go-live checks, from the owner's computer through the public name (C2 track P; docs/plan/hosting.md 5.12 items
 * 1-5, real-app.md 3.4 "Supabase Auth 后台要设的" and 3.12 "上线核对加几条"; the audits au2 and au3 asked for the last five):
 *
 *   health            /api/health through the public name: ok, the production providers, deployed, jobs, push
 *   health-fresh      two requests a second apart carry different server times (the edge does not cache answers)
 *   origin-lock       the origin name answers 403 without the lock, and 403 with a wrong one
 *   event-stream      a sandbox's event stream stays open through the edge for three minutes, with its pings
 *   long-request      a request that takes 30 seconds is answered (the edge's origin timeout rule is in force)
 *   static-cache      a /_next/static file carries its one-year immutable header and the second request is a cache hit
 *   pages-not-cached  a page is not answered from the edge's cache
 *   signed-out        /p/today without cookies answers a redirect to /login
 *   director-404      /director, /backstage and /backstage/real answer 404
 *   auth-keys         the sign-in service publishes asymmetric signing keys only (no shared secret)
 *   signup-closed     public sign-up and anonymous sign-in are off at the sign-in service
 *
 * What it sends: GETs, plus one POST /api/session that opens a throwaway demo sandbox for the event stream (it
 * expires after 48 hours; ten sandboxes an hour are allowed per address). That POST is why it asks for --yes. It never
 * sends the origin lock anywhere, never posts to the sign-in service (a sign-up probe would create a real account if
 * sign-up were open), and prints no value of the deploy file.
 *
 * --url must be the deploy file's public name: the checks only ever run against the deployment that file names.
 * A check the script cannot decide (the edge's cache header has a name it does not know) is reported as CHECK BY HAND,
 * not as passed. Exit code 1 when any check fails.
 */
import { webRoot } from "@/lib/llm/root";
import { requiredHealth } from "./lib/app-env";
import { DeployError, finish, guardMain, modeOf, Output, parseArgs, runPlan, startedAs, type Step } from "./lib/cli";
import { DOMAIN_NAMES, loadContext, requireNames } from "./lib/deploy-file";

export type Verdict = "PASS" | "FAIL" | "HAND";

export interface CheckResult {
  name: string;
  verdict: Verdict;
  detail: string;
}

export interface EdgeDeps {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** how long the event stream must stay open (three minutes) and how far apart its pings may be */
  sseMs: number;
  pingGapMs: number;
  /** how long the long request takes (30 seconds) */
  longMs: number;
}

export const REAL_DEPS: EdgeDeps = { fetchFn: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), sseMs: 180_000, pingGapMs: 45_000, longMs: 30_000 };

export interface EdgeTarget {
  app: string;
  origin: string;
  supabaseUrl: string;
  anonKey: string;
  /** given: speech and tts are compared too; not given: reported */
  speech?: string;
  tts?: string;
}

const pass = (name: string, detail: string): CheckResult => ({ name, verdict: "PASS", detail });
const fail = (name: string, detail: string): CheckResult => ({ name, verdict: "FAIL", detail });
const hand = (name: string, detail: string): CheckResult => ({ name, verdict: "HAND", detail });

function get(d: EdgeDeps, url: string, init: RequestInit = {}, ms = 20_000): Promise<Response> {
  return d.fetchFn(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(ms) });
}

const why = (err: unknown) => ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError" ? "no answer in time" : "the request failed (name not resolved, connection refused or certificate)");

/** hit / miss as the edge reports it, or unknown when none of the headers we know is there. */
export function cacheStatus(h: Headers): "hit" | "miss" | "unknown" {
  for (const name of ["eo-cache-status", "x-cache-lookup", "x-cache", "x-cache-status", "cf-cache-status"]) {
    const v = h.get(name);
    if (!v) continue;
    return /hit/i.test(v) && !/miss/i.test(v) ? "hit" : "miss";
  }
  return "unknown";
}

const headerNames = (h: Headers) => [...h.keys()].sort().join(", ");

export async function checkHealth(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  let first: Record<string, unknown> | null = null;
  try {
    const res = await get(d, `${t.app}/api/health`);
    first = res.status === 200 ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
    if (!first) out.push(fail("health", `GET /api/health → HTTP ${res.status}`));
    else {
      const want = requiredHealth({ speech: (t.speech ?? "mock") as "mock" | "whisper" | "tencent", tts: (t.tts ?? "mock") as "mock" | "trtc" });
      if (!t.speech) {
        delete want.speech;
        delete want.speech_problem;
      }
      if (!t.tts) delete want.tts;
      const diffs = Object.entries({ ok: true, ...want }).filter(([k, v]) => first![k] !== v).map(([k, v]) => `${k} is ${String(first![k])}, must be ${String(v)}`);
      const reported = `speech=${String(first.speech)} tts=${String(first.tts)} build=${String(first.build)}`;
      out.push(diffs.length ? fail("health", diffs.join("; ")) : pass("health", `ok, production providers, deployed, jobs, push; ${reported}`));
    }
  } catch (err) {
    out.push(fail("health", why(err)));
  }
  if (!first) {
    out.push(fail("health-fresh", "no first answer to compare with"));
    return out;
  }
  try {
    await d.sleep(1100);
    const res = await get(d, `${t.app}/api/health`);
    const second = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!second?.time || second.time === first.time) out.push(fail("health-fresh", "two requests a second apart carry the same server time: the edge answered from a cache"));
    else out.push(cacheStatus(res.headers) === "hit" ? fail("health-fresh", "the edge reports a cache hit for /api/health") : pass("health-fresh", "the second answer carries a later server time"));
  } catch (err) {
    out.push(fail("health-fresh", why(err)));
  }
  return out;
}

export async function checkOriginLock(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  try {
    const bare = await get(d, `${t.origin}/api/health`);
    if (bare.status !== 403) return fail("origin-lock", `the origin name answered HTTP ${bare.status} without the lock (must be 403): the app can be reached around the edge`);
    // a made-up value, never the real one: the lock is only ever sent by the edge
    const wrong = await get(d, `${t.origin}/api/health`, { headers: { "X-Ripple-Edge": "edge-check-not-the-lock-0000000000000000" } });
    return wrong.status === 403 ? pass("origin-lock", "403 without the lock and 403 with a wrong one") : fail("origin-lock", `the origin name answered HTTP ${wrong.status} to a wrong lock (must be 403)`);
  } catch (err) {
    return fail("origin-lock", `${why(err)} (is the origin name's record pointing at the server, are 80 and 443 open, is Caddy running?)`);
  }
}

function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0].trim())
    .filter((pair) => pair.includes("="))
    .join("; ");
}

export async function checkEventStream(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  const name = "event-stream";
  const seconds = Math.round(d.sseMs / 1000);
  let sessionId = "";
  let cookie = "";
  try {
    // a script names the site it acts on, as a browser's Origin does: a deployment refuses a write without it
    const res = await get(d, `${t.app}/api/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: t.app }, body: JSON.stringify({ kind: "sandbox", device_label: "edge-check" }) });
    if (res.status === 429) return fail(name, "the sandbox limit for this address is used up (ten an hour): try again in an hour");
    const data = (await res.json().catch(() => null)) as { session?: { id?: string } } | null;
    sessionId = data?.session?.id ?? "";
    cookie = cookiesFrom(res);
    if (res.status !== 201 || !sessionId || !cookie) return fail(name, `POST /api/session → HTTP ${res.status}${sessionId && !cookie ? ", no device cookie" : ""}`);
  } catch (err) {
    return fail(name, `opening a sandbox: ${why(err)}`);
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) return fail(name, "the sandbox id is not a plain id");
  const ctrl = new AbortController();
  try {
    const opening = setTimeout(() => ctrl.abort(), 20_000);
    const res = await d.fetchFn(`${t.app}/api/events?session=${sessionId}`, { signal: ctrl.signal, headers: { Accept: "text/event-stream", Cookie: cookie } });
    clearTimeout(opening);
    if (res.status !== 200 || !res.body) return fail(name, `GET /api/events → HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const started = d.now();
    let lastData = started;
    let head = "";
    let connected = false;
    let pings = 0;
    for (;;) {
      const elapsed = d.now() - started;
      if (elapsed >= d.sseMs) break;
      const wait = Math.min(d.sseMs - elapsed, (connected ? d.pingGapMs : 10_000) - (d.now() - lastData));
      if (wait <= 0) return fail(name, connected ? `nothing arrived for ${Math.round(d.pingGapMs / 1000)} s (pings come every 20 s): the edge is holding the stream back` : "the stream sent nothing in its first 10 s (the edge is buffering it)");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), wait)))]);
      clearTimeout(timer);
      if (chunk === null) continue;
      if (chunk.done) return fail(name, `the stream ended after ${Math.round((d.now() - started) / 1000)} s (it must stay open ${seconds} s; an origin timeout of the edge, or 524)`);
      lastData = d.now();
      const piece = decoder.decode(chunk.value, { stream: true });
      if (!connected) {
        head = (head + piece).slice(0, 4000);
        connected = head.includes(": connected");
      }
      pings += (piece.match(/: ping/g) ?? []).length;
    }
    if (!connected) return fail(name, "the stream never said it was connected");
    return pass(name, `open for ${seconds} s through the edge, ${pings} pings`);
  } catch (err) {
    return fail(name, why(err));
  } finally {
    ctrl.abort();
  }
}

export async function checkLongRequest(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  const started = d.now();
  try {
    const res = await get(d, `${t.app}/api/preflight/wait?ms=${d.longMs}`, {}, d.longMs + 20_000);
    const elapsed = d.now() - started;
    if (res.status !== 200) return fail("long-request", `HTTP ${res.status} after ${(elapsed / 1000).toFixed(1)} s (524: the edge's origin timeout is still the default)`);
    return elapsed >= d.longMs * 0.98 ? pass("long-request", `HTTP 200 after ${(elapsed / 1000).toFixed(1)} s`) : fail("long-request", `answered after ${(elapsed / 1000).toFixed(1)} s, before the wait finished: something else replied`);
  } catch (err) {
    return fail("long-request", why(err));
  }
}

export async function checkCaching(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  let html = "";
  try {
    const page = await get(d, `${t.app}/login`);
    html = page.status === 200 ? await page.text() : "";
    if (!html) out.push(fail("pages-not-cached", `GET /login → HTTP ${page.status}`));
    else {
      const again = await get(d, `${t.app}/login`);
      const status = cacheStatus(again.headers);
      if (status === "hit") out.push(fail("pages-not-cached", "the edge answered /login from its cache: the no-cache rule for pages is missing or below the static rule"));
      else if (status === "miss") out.push(pass("pages-not-cached", "the second request for /login went to the origin"));
      else out.push(hand("pages-not-cached", `no cache header the script knows in the answer (headers: ${headerNames(again.headers)}); look for the edge's cache status header`));
    }
  } catch (err) {
    out.push(fail("pages-not-cached", why(err)));
  }
  const asset = /\/_next\/static\/[A-Za-z0-9_\-./~%]+\.(?:js|css)/.exec(html)?.[0];
  if (!asset) {
    out.push(fail("static-cache", "no /_next/static file found in the /login page"));
    return out;
  }
  try {
    const first = await get(d, `${t.app}${asset}`);
    const second = await get(d, `${t.app}${asset}`);
    const cc = second.headers.get("cache-control") ?? "";
    if (first.status !== 200 || second.status !== 200) out.push(fail("static-cache", `HTTP ${first.status} / ${second.status} for a static file`));
    else if (!/immutable/.test(cc) || !/max-age=31536000/.test(cc)) out.push(fail("static-cache", "the static file does not carry Cache-Control: max-age=31536000, immutable"));
    else {
      const status = cacheStatus(second.headers);
      if (status === "hit") out.push(pass("static-cache", "one-year immutable header, second request served from the edge's cache"));
      else if (status === "miss") out.push(fail("static-cache", "the second request was not a cache hit: the static rule is missing, or it sits above the no-cache rule"));
      else out.push(hand("static-cache", `the header is right, but no cache header the script knows says hit or miss (headers: ${headerNames(second.headers)})`));
    }
  } catch (err) {
    out.push(fail("static-cache", why(err)));
  }
  return out;
}

export async function checkSignedOut(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  try {
    const res = await get(d, `${t.app}/p/today`);
    const location = res.headers.get("location") ?? "";
    let to = "";
    try {
      to = new URL(location, t.app).pathname;
    } catch {
      // not a URL
    }
    if (![301, 302, 303, 307, 308].includes(res.status)) return fail("signed-out", `GET /p/today without cookies → HTTP ${res.status} (must be a redirect to /login)`);
    return to === "/login" ? pass("signed-out", `HTTP ${res.status} to /login`) : fail("signed-out", `HTTP ${res.status}, but not to /login`);
  } catch (err) {
    return fail("signed-out", why(err));
  }
}

export async function checkDirector(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  const bad: string[] = [];
  try {
    for (const p of ["/director", "/backstage", "/backstage/real"]) {
      const res = await get(d, `${t.app}${p}`);
      if (res.status !== 404) bad.push(`${p} → HTTP ${res.status}`);
    }
  } catch (err) {
    return fail("director-404", why(err));
  }
  return bad.length ? fail("director-404", `${bad.join("; ")} (must be 404: is SCRIPTED_FALLBACK_KEY set on the server?)`) : pass("director-404", "/director, /backstage and /backstage/real answer 404");
}

export async function checkAuthKeys(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  try {
    const res = await get(d, `${t.supabaseUrl}/auth/v1/.well-known/jwks.json`);
    const body = (await res.json().catch(() => null)) as { keys?: Array<{ kty?: string; alg?: string }> } | null;
    if (res.status !== 200 || !Array.isArray(body?.keys)) return fail("auth-keys", `the sign-in service's key list → HTTP ${res.status}`);
    if (!body.keys.length) return fail("auth-keys", "the sign-in service publishes no key: it still signs with a shared secret (HS256), which the app refuses. Dashboard: Authentication, JWT signing keys, switch to an asymmetric key");
    const symmetric = body.keys.filter((k) => !["EC", "RSA", "OKP"].includes(k.kty ?? "") || /^HS/i.test(k.alg ?? ""));
    return symmetric.length ? fail("auth-keys", `${symmetric.length} of ${body.keys.length} published keys are not asymmetric`) : pass("auth-keys", `${body.keys.length} asymmetric key(s): ${[...new Set(body.keys.map((k) => k.alg ?? k.kty))].join(", ")}`);
  } catch (err) {
    return fail("auth-keys", why(err));
  }
}

export async function checkSignupClosed(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult> {
  try {
    // the settings document says it; a sign-up attempt is never made (it would create an account if sign-up were open)
    const res = await get(d, `${t.supabaseUrl}/auth/v1/settings`, { headers: { apikey: t.anonKey } });
    const body = (await res.json().catch(() => null)) as { disable_signup?: unknown; external?: { anonymous_users?: unknown } } | null;
    if (res.status !== 200 || !body) return hand("signup-closed", `the sign-in service's settings → HTTP ${res.status}; look in the dashboard: Authentication, Sign In / Providers, "Allow new users to sign up" must be off`);
    if (typeof body.disable_signup !== "boolean") return hand("signup-closed", "the settings document does not say whether sign-up is open; look in the dashboard");
    const problems = [...(body.disable_signup ? [] : ["public sign-up is OPEN: anyone with the publishable key can create accounts around the app's rules and limits"]), ...(body.external?.anonymous_users === true ? ["anonymous sign-in is ON"] : [])];
    return problems.length ? fail("signup-closed", `${problems.join("; ")}. Dashboard: Authentication, Sign In / Providers`) : pass("signup-closed", "public sign-up is off, anonymous sign-in is off");
  } catch (err) {
    return fail("signup-closed", why(err));
  }
}

export const CHECK_NAMES = ["health", "health-fresh", "origin-lock", "event-stream", "long-request", "pages-not-cached", "static-cache", "signed-out", "director-404", "auth-keys", "signup-closed"] as const;

/** Every check, in order; the two slow ones (event stream, long request) run side by side. */
export async function runChecks(d: EdgeDeps, t: EdgeTarget): Promise<CheckResult[]> {
  const health = await checkHealth(d, t);
  const lock = await checkOriginLock(d, t);
  const [stream, long] = await Promise.all([checkEventStream(d, t), checkLongRequest(d, t)]);
  const caching = await checkCaching(d, t);
  const rest = [await checkSignedOut(d, t), await checkDirector(d, t), await checkAuthKeys(d, t), await checkSignupClosed(d, t)];
  return [...health, lock, stream, long, ...caching, ...rest];
}

export async function main(argv: readonly string[], out: Output, deps: Partial<EdgeDeps> = {}, webDir: string = webRoot()): Promise<number> {
  const d: EdgeDeps = { ...REAL_DEPS, ...deps };
  return guardMain(out, async () => {
    const args = parseArgs(argv, { value: ["url", "speech", "tts"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/edge-check.ts [--url https://<DEPLOY_APP_DOMAIN>] [--speech mock|whisper|tencent] [--tts mock|trtc] --dry-run | --yes");
      return 0;
    }
    const mode = modeOf(args);
    const ctx = loadContext(args, webDir, out);
    requireNames(ctx, [...DOMAIN_NAMES, "SUPABASE_URL", "SUPABASE_ANON_KEY"], "the go-live checks");
    const v = ctx.deploy.values;
    const app = `https://${v.DEPLOY_APP_DOMAIN}`;
    const url = args.value("url");
    if (url !== undefined && url.replace(/\/+$/, "").toLowerCase() !== app) throw new DeployError("--url is not https://<DEPLOY_APP_DOMAIN> of the deploy file: these checks only ever run against the deployment that file names");
    const speech = args.value("speech");
    const tts = args.value("tts");
    if (speech !== undefined && speech !== "mock" && speech !== "whisper" && speech !== "tencent") throw new DeployError("--speech is mock, whisper or tencent");
    if (tts !== undefined && tts !== "mock" && tts !== "trtc") throw new DeployError("--tts is mock or trtc");
    const target: EdgeTarget = { app, origin: `https://${v.DEPLOY_ORIGIN_DOMAIN}`, supabaseUrl: v.SUPABASE_URL.replace(/\/+$/, ""), anonKey: v.SUPABASE_ANON_KEY, speech, tts };

    let results: CheckResult[] = [];
    const steps: Step[] = [
      {
        title: "through the public name, the origin name and the sign-in service: eleven checks (about three and a half minutes)",
        show: [
          "GET  https://<DEPLOY_APP_DOMAIN>/api/health  (twice, a second apart)",
          "GET  https://<DEPLOY_ORIGIN_DOMAIN>/api/health  without the lock, and with a made-up one (the real lock is never sent)",
          'POST https://<DEPLOY_APP_DOMAIN>/api/session  {"kind":"sandbox"}  (a throwaway demo sandbox; expires after 48 h)',
          "GET  https://<DEPLOY_APP_DOMAIN>/api/events?session=<that sandbox>  held open for 180 s",
          "GET  https://<DEPLOY_APP_DOMAIN>/api/preflight/wait?ms=30000",
          "GET  https://<DEPLOY_APP_DOMAIN>/login  (twice), and one /_next/static file it names (twice)",
          "GET  https://<DEPLOY_APP_DOMAIN>/p/today  (no cookies), /director, /backstage, /backstage/real",
          "GET  <SUPABASE_URL>/auth/v1/.well-known/jwks.json",
          "GET  <SUPABASE_URL>/auth/v1/settings  (with the publishable key; nothing is posted to the sign-in service)",
          `health is compared with: the production providers${speech ? `, speech=${speech}` : ""}${tts ? `, tts=${tts}` : ""}${speech && tts ? "" : " (pass --speech and --tts to compare those too)"}`,
        ],
        run: async () => {
          results = await runChecks(d, target);
        },
      },
    ];
    const planned = await runPlan(out, mode, "edge-check", steps);
    if (mode !== "act") return planned;
    for (const r of results) out.say(`  ${r.verdict === "HAND" ? "CHECK BY HAND" : r.verdict}  ${r.name.padEnd(17)} ${r.detail}`);
    const count = (verdict: Verdict) => results.filter((r) => r.verdict === verdict).length;
    out.say(`edge-check: ${count("PASS")} passed, ${count("FAIL")} failed, ${count("HAND")} to check by hand.`);
    out.say("Not checked by this script (the owner looks, README): the sign-in service's token lifetime (900 s), refresh rotation with a 10 s reuse interval, minimum password length 8; two phones in one session; the main question answered within 4 s.");
    return count("FAIL") ? 1 : 0;
  });
}

if (startedAs("edge-check")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
