/**
 * Every API route decides who is asking by itself (docs/plan/real-app.md 3.7 「写接口自己查身份，不靠代理」, 8.2 「单元
 * auth/routes-require-subject」; track A). The proxy is not in front of these calls: each exported method of every
 * app/api/** /route.ts is called directly.
 *
 *   no cookie at all        the route refuses: 401 not_signed_in, 400 no_session (the C2 decision for a request with no
 *                           identity at all: lib/subject/resolve.ts), 404 for what does not exist for a stranger (the
 *                           crew's and the developers' routes), or another 4xx. Never a 2xx, never a 5xx, except the
 *                           routes in PUBLIC, each with its reason.
 *   B's cookie, ?session=<A's account id>
 *                           404 session_not_found (or the route's own refusal): an account's space is never reached by
 *                           its id, and nothing of A's changes.
 *
 * A new route that answers a stranger with 2xx fails here until it is listed in PUBLIC with a reason.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { signedInUser } from "@/lib/subject/resolve";
import { agreedLink } from "../../support/agreed-link";
import { everythingOf as everythingIn, resetAllLimits } from "../../support/everything-of";
import { findId } from "../../support/id-needles";

const WEB = process.cwd();
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Routes a request with no identity may get a 2xx from, and why. "METHOD path" as the files spell it. */
const PUBLIC: Record<string, string> = {
  // real-app 3.7: 公开接口 /api/auth/*
  "POST /api/auth/check-login": "sign-up asks whether a login is free before there is any account (rate-limited per IP)",
  "POST /api/auth/logout": "signing out answers 200 even when nobody was signed in: the cookies go either way",
  // the demo's own doors (real-app 3.7: POST /api/demo/{enter,leave}, the judges' sandbox, GET /api/health)
  "GET /api/health": "liveness for the hosting check: says only that the server answers",
  // 10-15: three ticks with the streamed answers' headers, no data of anyone: checks the public front does not hold a stream back
  "GET /api/health/stream": "the streaming check: three ticks half a second apart, no data of anyone",
  "POST /api/session": "a judge's sandbox is made without an account (the demo's front door; a filming session needs the crew)",
  "POST /api/demo/view": "/demo marks this browser as looking at the demo (a cookie, no data)",
  "DELETE /api/demo/view": "「回到我的账号」 clears that mark (a cookie, no data)",
  // routes that hold nobody's data
  "GET /api/profile/lang": "the 「中/EN」 link: sets the language cookie and goes back to a path on this site (303)",
  "GET /api/push/key": "this server's VAPID public key, public by nature (a browser subscribes with it)",
  "GET /api/asr/health": "which speech provider is in use and whether it answers; the details are for the crew only",
  "GET /api/session/crew": "does this browser carry the crew's cookie? { crew: false } for a stranger",
  "DELETE /api/session/crew": "clears the crew's cookie on this browser (nothing else)",
  "POST /api/preflight/upload": "the hosting check: counts the bytes of a body and stores nothing",
  "GET /api/preflight/wait": "the hosting check: answers after a wait and holds no data",
};

/** A query a route needs so the scan stays fast (the hosting check's wait would otherwise hold 30 s). */
const QUERY: Record<string, string> = { "GET /api/preflight/wait": "ms=0" };

/** The developers' tools: checked on their own below (404 once the developer tools are off). */
const isDevTool = (p: string) => p.startsWith("/api/dev/");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

const apiPath = (file: string) => `/${path.relative(WEB, path.dirname(file)).split(path.sep).join("/").replace(/^app\//, "")}`;
/** The URL of a route with every [param] filled in. */
const urlOf = (p: string) => p.replace(/\[([^\]]+)\]/g, (_m, name: string) => (name === "id" ? randomUUID() : "x"));
const paramsOf = (p: string): Record<string, string> => Object.fromEntries([...p.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1], m[1] === "id" ? randomUUID() : "x"]));

interface Called {
  key: string;
  status: number;
  error: string | null;
}

async function call(file: string, method: Method, handler: Handler, opts: { cookie?: string; query?: string } = {}): Promise<Called> {
  const p = apiPath(file);
  const body = method === "GET" || method === "DELETE" ? undefined : "{}";
  const query = [QUERY[`${method} ${p}`], opts.query].filter(Boolean).join("&");
  const req = new NextRequest(`http://localhost${urlOf(p)}${query ? `?${query}` : ""}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body,
  });
  const res = await handler(req, { params: Promise.resolve(paramsOf(p)) });
  let error: string | null = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      error = ((await res.clone().json()) as { error?: string }).error ?? null;
    } catch {
      /* not JSON after all */
    }
  }
  // a stream (the events route) is cancelled, so nothing keeps running
  await res.body?.cancel().catch(() => undefined);
  return { key: `${method} ${p}`, status: res.status, error };
}

const store = getMemoryStore();
const savedEnv = { ...process.env };
let blobDir: string;
let handlers: { file: string; method: Method; handler: Handler }[] = [];
let a: TestAccount;
let b: TestAccount;

beforeAll(async () => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-routes-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  for (const file of routeFiles(path.join(WEB, "app", "api")).sort()) {
    const mod = (await import(/* @vite-ignore */ file)) as Partial<Record<Method, Handler>>;
    for (const method of METHODS) if (typeof mod[method] === "function") handlers.push({ file, method, handler: mod[method]! });
  }
  a = await createAccountWithSpace(store, getAuthProvider(), { login: `ra${randomUUID().slice(0, 9)}`, password: "a long test password", space: "example" });
  b = await createAccountWithSpace(store, getAuthProvider(), { login: `rb${randomUUID().slice(0, 9)}`, password: "a long test password", space: "example" });
}, 120_000);

afterAll(() => {
  process.env = savedEnv;
  vi.restoreAllMocks();
  rmSync(blobDir, { recursive: true, force: true });
  handlers = [];
});

describe("every route decides who is asking", () => {
  it("the scan finds the app's routes, and PUBLIC names only routes that exist", () => {
    expect(handlers.length).toBeGreaterThan(120);
    const keys = new Set(handlers.map((h) => `${h.method} ${apiPath(h.file)}`));
    for (const k of Object.keys(PUBLIC)) expect(keys.has(k), `PUBLIC lists ${k}, which is not a route`).toBe(true);
    for (const reason of Object.values(PUBLIC)) expect(reason.length).toBeGreaterThan(20);
    // the routes of real-app 3.7's own list are in the scan
    for (const k of ["POST /api/visits", "POST /api/labels/read", "POST /api/tts", "POST /api/upload-url", "POST /api/asr/chunk", "POST /api/session/reset", "POST /api/director/cue", "GET /api/me", "POST /api/doses"]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it("no cookie at all: refused with a 4xx by the route itself, never 2xx and never 5xx (PUBLIC excepted)", async () => {
    const wrong: string[] = [];
    for (const h of handlers) {
      if (isDevTool(apiPath(h.file))) continue;
      let r: Called;
      try {
        r = await call(h.file, h.method, h.handler);
      } catch (err) {
        wrong.push(`${h.method} ${apiPath(h.file)}: threw ${err instanceof Error ? err.message.slice(0, 80) : "an error"}`);
        continue;
      }
      if (PUBLIC[r.key]) continue;
      if (r.status < 400 || r.status >= 500) wrong.push(`${r.key}: ${r.status}${r.error ? ` ${r.error}` : ""}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("the developers' tools (/api/dev/*) do not exist once the developer tools are off: 404 for every method", async () => {
    const dev = handlers.filter((h) => isDevTool(apiPath(h.file)));
    expect(dev.length).toBeGreaterThanOrEqual(4);
    const saved = { ...process.env };
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.RIPPLE_DEV_TOOLS;
    try {
      for (const h of dev) {
        const r = await call(h.file, h.method, h.handler);
        expect([r.key, r.status]).toEqual([r.key, 404]);
      }
    } finally {
      process.env = saved;
    }
  });

  it("the account's own routes answer 401 not_signed_in whatever the body (who is asking comes first)", async () => {
    const mine = handlers.filter((h) => /^\/api\/(auth\/(devices|password|recovery-code|notice-seen|refresh)|auth\/recover\/helper|me$)/.test(apiPath(h.file)));
    expect(mine.length).toBeGreaterThanOrEqual(7);
    for (const h of mine) {
      const r = await call(h.file, h.method, h.handler);
      expect([r.key, r.status, r.error]).toEqual([r.key, 401, "not_signed_in"]);
    }
  });

  it("B's cookie with ?session=<A's account id>: 404 (or the route's own refusal), and nothing of A's changes", async () => {
    const before = JSON.stringify({
      doses: await store.listDoses(a.userId),
      bp: await store.listBp(a.userId),
      notes: await store.listNotes(a.userId),
      questions: await store.listQuestions(a.userId),
      visits: await store.listVisits(a.userId),
      meds: await store.listMeds(a.userId),
      facts: await store.listProfileFacts(a.userId),
      grant: await store.getFamilyGrant(a.userId),
      links: await store.listCareLinks({ patient_id: a.userId }),
      events: (await store.listAccountEvents(a.userId)).length,
    });
    const wrong: string[] = [];
    let notFound = 0;
    for (const h of handlers) {
      if (PUBLIC[`${h.method} ${apiPath(h.file)}`] || isDevTool(apiPath(h.file))) continue;
      let r: Called;
      try {
        r = await call(h.file, h.method, h.handler, { cookie: `rp_at=${b.tokens.access_token}`, query: `session=${a.userId}` });
      } catch (err) {
        wrong.push(`${h.method} ${apiPath(h.file)}: threw ${err instanceof Error ? err.message.slice(0, 80) : "an error"}`);
        continue;
      }
      if (r.status === 404) notFound += 1;
      // a route that does not read ?session= at all (the account's own routes) answers for B, never for A; a 5xx is a bug
      if (r.status >= 500) wrong.push(`${r.key}: ${r.status}`);
    }
    expect(wrong).toEqual([]);
    // most of the app's routes resolve their subject and so answer 404 session_not_found
    expect(notFound).toBeGreaterThan(80);
    const after = JSON.stringify({
      doses: await store.listDoses(a.userId),
      bp: await store.listBp(a.userId),
      notes: await store.listNotes(a.userId),
      questions: await store.listQuestions(a.userId),
      visits: await store.listVisits(a.userId),
      meds: await store.listMeds(a.userId),
      facts: await store.listProfileFacts(a.userId),
      grant: await store.getFamilyGrant(a.userId),
      links: await store.listCareLinks({ patient_id: a.userId }),
      events: (await store.listAccountEvents(a.userId)).length,
    });
    expect(after).toBe(before);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------------------------
// C2 track G: the same scan, asserted cell by cell (real-app 8.2 lines 1408-1410, H1 line 1101; web/progress/g.md).
//
// The checks above accept any 4xx from a stranger and count the 404s of the two-account case. That lets three things
// through: a route that reads the body before it asks who is calling (its 400 looks like a refusal), a route that
// answers another account's pointer with something other than 404 as long as most routes do not, and a route that is
// pointed at another person's space by something other than ?session=. Below, every handler is called and every answer
// is compared with the one answer that handler is allowed to give:
//
//   a stranger (no cookie)   exactly 400 no_session or 401 not_signed_in (the recorded C2 decision: web/progress/f1.md
//                            「什么都没带的请求还是回 400 no_session；带了坏 token 回 401 not_signed_in」). Any other answer needs
//                            the route's line in PUBLIC (above) or STRANGER (below): the exact answer, and the reason.
//                            A list entry that no longer matches what the route answers fails too.
//   B signed in, pointing at A's space by every way a request can name a space
//                            ?session=<A>, rp_view=demo + rp_session=<A>: 404 session_not_found on every route that
//                            resolves a space; a route that never reads them (the account's own routes, the public ones,
//                            the crew's) answers exactly what it answers B alone.
//                            rp_session=<A> next to B's token: B's own answer (the token wins: lib/subject/resolve.ts).
//                            ?link=<a care link between A and someone else>: 404 link_not_found on her entry routes,
//                            B's own answer everywhere else.
//                            a path id of one of A's rows: never found, never a 2xx.
//   a stranger pointing at A  rp_session=<A> or ?session=<A> without a token: 404 session_not_found (the same answer as
//                            for an id that does not exist), or the route's answer to any stranger.
// No answer in any of these calls carries a word of A's (A's rows hold a marker word no other account has), A's id, A's
// login, or the id of A's link; and everything the store holds of A is byte for byte what it was.
//
// B is signed in again before every call (signing out, the device list and the password routes end B's session, which
// would turn every later call into a stranger's), and the rate-limit buckets are emptied (the scan calls each route
// more often than a person may).

/**
 * What a route that does not refuse a stranger by identity answers to a request with no cookie and an empty body, and
 * why that is right. "METHOD path" as the files spell it. (PUBLIC, above, are the ones that answer 2xx.)
 */
const STRANGER: Record<string, { answer: string; why: string }> = {
  // ---- the doors: the calls a person makes before anyone is signed in (real-app 3.7 公开接口 /api/auth/*)
  "POST /api/auth/check-login": { answer: "400 invalid_body", why: "sign-up asks whether a login is free; an empty body is refused before anything is looked up" },
  "POST /api/auth/login": { answer: "400 invalid_body", why: "logging in: the login and password are the identity; an empty body is refused" },
  "POST /api/auth/signup": { answer: "400 invalid_body", why: "signing up: no account exists yet" },
  "POST /api/auth/recover": { answer: "400 invalid_body", why: "the recovery code resets a password for someone who cannot sign in" },
  "POST /api/auth/recover/family": { answer: "400 invalid_body", why: "the six digits a family member read out, typed on his own phone while signed out" },
  "POST /api/auth/recover/help": { answer: "400 invalid_body", why: "he asks his family for help while signed out; the answer never says whether the account exists" },
  "POST /api/auth/read-aloud": { answer: "400 invalid_body", why: "the sign-up and recovery screens read their own fixed text aloud before anyone is signed in; no person's data" },
  "POST /api/session/join": { answer: "400 invalid_body", why: "the demo's door: a join code names a demo session, never an account (lib/subject/entry.ts)" },
  "POST /api/session/crew": { answer: "400 invalid_body", why: "the film crew's sign-in: the key is the identity; wrong keys are counted and locked out" },
  // ---- the film crew's routes: for anyone without the crew's key they do not exist (real-app 5.2, lib/crew/gate.ts)
  "POST /api/clock": { answer: "404 not_found", why: "the story clock is the crew's" },
  "POST /api/director/cue": { answer: "404 not_found", why: "the director's cues are the crew's" },
  "POST /api/director/filming": { answer: "404 not_found", why: "filming mode is the crew's" },
  "POST /api/director/replay": { answer: "404 not_found", why: "starting a replay from the director's desk is the crew's" },
  "POST /api/session/reset": { answer: "404 not_found", why: "resetting a demo session is the crew's" },
  "POST /api/visits/[id]/scripted": { answer: "404 not_found", why: "the scripted fallback is the crew's" },
  "GET /api/real": { answer: "404 not_found", why: "the real-recording trial is the crew's" },
  "POST /api/real": { answer: "404 not_found", why: "the real-recording trial is the crew's" },
  "GET /api/real/[id]": { answer: "404 not_found", why: "the real-recording trial is the crew's" },
  "DELETE /api/real/[id]": { answer: "404 not_found", why: "the real-recording trial is the crew's" },
  "GET /api/crew/filming-account": { answer: "404 not_found", why: "the filming account's mark is shown to the crew only (the crew's key comes before the sign-in)" },
  "POST /api/crew/filming-account": { answer: "404 not_found", why: "marking a filming account needs the crew's key first" },
  "DELETE /api/crew/filming-account": { answer: "404 not_found", why: "ending filming needs the crew's key first" },
  "GET /api/crew/filming-account/accounts": { answer: "404 not_found", why: "the director's list of filming accounts is the crew's" },
  "GET /api/crew/filming-account/accounts/[ref]": { answer: "404 not_found", why: "one filming account on the director's desk is the crew's" },
  "POST /api/crew/filming-account/accounts/[ref]": { answer: "404 not_found", why: "the director's actions on a filming account are the crew's" },
  // ---- the two byte routes of the local file store: the signed token in the link is the whole identity
  "GET /api/blob/read": { answer: "403 bad_token", why: "a signed 10-minute link made for one path by a route that checked the owner; nothing without the token" },
  "PUT /api/blob/upload": { answer: "403 bad_token", why: "the same, for an upload" },
  // ---- nobody's data
  "GET /api/labels/sample": { answer: "404 unknown_sample", why: "the synthetic sample labels of the demo are public pictures (the judges' landing warms them up); without a name there is none" },
};

/** A well-formed request for the public routes that answer 4xx to an empty one: with it a stranger does get the 2xx. */
const WELL_FORMED: Record<string, { query?: string; body?: unknown; status: number }> = {
  "POST /api/auth/check-login": { body: { login: "nobody.here2468" }, status: 200 },
  "GET /api/labels/sample": { query: "name=amlodipine", status: 200 },
};

const PASSWORD_G = "a long test password";
/** A word no seed row, no template and no other account has: it marks A's rows. */
const MARK = "zqxmarkofa";

interface Ask {
  cookie?: string;
  query?: string;
  /** the value of every [segment] (default: a fresh uuid) */
  segment?: string;
  body?: unknown;
}
interface Answer {
  key: string;
  /** "404 session_not_found", "200", ... */
  answer: string;
  status: number;
  /** the body as far as it came within a moment (a stream gives its first frames) */
  text: string;
}
type Route = { file: string; method: Method; handler: Handler };

async function bodyText(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const type = res.headers.get("content-type") ?? "";
  const stream = type.includes("text/event-stream");
  const binary = /^(image|audio|video|application\/octet-stream)/.test(type);
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), stream ? 150 : 3000))]);
      if (!next || next.done) break;
      if (!binary) text += decoder.decode(next.value, { stream: true });
      if (stream && text.length > 0) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

async function ask(h: Route, opts: Ask = {}): Promise<Answer> {
  const p = apiPath(h.file);
  const key = `${h.method} ${p}`;
  const seg = opts.segment ?? randomUUID();
  const url = p.replace(/\[([^\]]+)\]/g, () => encodeURIComponent(seg));
  const params = Object.fromEntries([...p.matchAll(/\[([^\]]+)\]/g)].map((m) => [m[1], seg]));
  const sendsBody = h.method !== "GET" && h.method !== "DELETE";
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : sendsBody ? "{}" : undefined;
  const query = [QUERY[key], opts.query].filter(Boolean).join("&");
  const req = new NextRequest(`http://localhost${url}${query ? `?${query}` : ""}`, {
    method: h.method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body,
  });
  const res = await h.handler(req, { params: Promise.resolve(params) });
  const text = await bodyText(res);
  let error = "";
  try {
    error = String((JSON.parse(text) as { error?: unknown }).error ?? "");
  } catch {
    /* not JSON */
  }
  return { key, answer: `${res.status}${error ? ` ${error}` : ""}`, status: res.status, text };
}

const resetLimits = (): void => resetAllLimits(store);

describe("every route, cell by cell (track G)", () => {
  const deps = { store, auth: () => getAuthProvider() };
  const everythingOf = (userId: string): string => everythingIn(store, userId);
  let routes: Route[] = [];
  let ga: TestAccount; // A: the person pointed at
  let gb: TestAccount; // B: signed in, unrelated to A
  let gc: TestAccount; // C: A's family member
  let bToken = "";
  let linkAC = "";
  /** ids of rows only A has */
  const mine: Record<string, string> = {};
  let before = "";
  let beforeB = "";

  const route = (key: string): Route => {
    const h = routes.find((x) => `${x.method} ${apiPath(x.file)}` === key);
    if (!h) throw new Error(`no route ${key}`);
    return h;
  };

  /** B signed in (again when a route ended the session), and no bucket full. */
  async function ready(): Promise<string> {
    resetLimits();
    if (!(await signedInUser(bToken, deps))) bToken = (await getAuthProvider().signInWithPassword(gb.login.email, PASSWORD_G)).access_token;
    return `rp_at=${bToken}`;
  }

  /** The words that must never reach anyone but A (and C through her link): A's marker and ids. */
  const leaks = (text: string): string[] => {
    const lower = text.toLowerCase();
    return [MARK, ga.userId, ga.login.email, gc.userId, linkAC, ...Object.values(mine)].filter((w) => w && lower.includes(w.toLowerCase()));
  };

  /** Has anything of A's changed since the last look? (Then say so once, and go on from the new state.) */
  const changedA = (): boolean => {
    const now = everythingOf(ga.userId);
    if (now === before) return false;
    before = now;
    return true;
  };

  beforeAll(async () => {
    routes = handlers.filter((h) => !isDevTool(apiPath(h.file)));
    const auth = getAuthProvider();
    const id = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    ga = await createAccountWithSpace(store, auth, { login: id("ga"), password: PASSWORD_G, space: "example", display_name: `Mr ${MARK}` });
    gb = await createAccountWithSpace(store, auth, { login: id("gb"), password: PASSWORD_G, space: "example" });
    gc = await createAccountWithSpace(store, auth, { login: id("gc"), password: PASSWORD_G, space: "none", display_name: "Wei Ling" });
    bToken = gb.tokens.access_token;
    const A = ga.userId;
    // rows only A has, each with A's marker in its words and an id no other account has
    mine.visit = `g-visit-${randomUUID()}`;
    await store.upsertVisit(A, { id: mine.visit, kind: "follow_up", place: `${MARK} clinic`, day: 20, status: "confirmed" });
    mine.utterance = `g-utt-${randomUUID()}`;
    await store.addUtterances(A, mine.visit, [{ id: mine.utterance, t_start_ms: 0, t_end_ms: 2000, text: `${MARK} the doctor said this to A only`, role: "doctor", role_state: "confirmed" }]);
    mine.med = `g-med-${randomUUID()}`;
    await store.upsertMed(A, { id: mine.med, origin: "self_bought", status: "unidentified", note: `${MARK} a medicine only A has` });
    mine.note = (await store.addNote(A, { day: 30, text: `${MARK} a note of A's`, source: "typed" })).id;
    mine.question = (await store.addQuestion(A, { for: "doctor", origin: "own", text: `${MARK} a question of A's` })).id;
    mine.fact = (await store.addProfileFact(A, { kind: "condition", text: `${MARK} a condition of A's`, source: "patient" })).id;
    mine.bp = (await store.addBp(A, { day: 30, slot: "morning", systolic: 177, diastolic: 111 })).id;
    mine.delivery = (await store.recordDelivery(A, { kind: "dose_first", ref: "morning", day: 41, slot: "morning" })).delivery.id;
    mine.endpoint = `https://fcm.googleapis.com/fcm/send/${MARK}-${randomUUID()}`;
    await store.savePushSubscription({ user_id: A, endpoint: mine.endpoint, p256dh: "p".repeat(87), auth: "a".repeat(22) });
    // A's family member C, through an active link with every switch on, and her recording for him
    const hash = `h-${randomUUID()}`;
    const inv = await store.createInvite({ patient_id: A, family_label: `Wei ${MARK}`, relation: "daughter", patient_label: "爸爸", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 3600_000).toISOString() }, {});
    if (!inv.ok) throw new Error(inv.code);
    linkAC = inv.link.id;
    const accepted = await store.acceptInvite(hash, gc.userId, "Wei Ling");
    if (!accepted.ok) throw new Error(accepted.code);
    const confirmed = await store.confirmLink(linkAC, A, true);
    if (!confirmed.ok) throw new Error(confirmed.code);
    await store.setFamilyGrant(A, linkAC, { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true });
    // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
    await agreedLink(store, { id: linkAC, patient_id: A, family_id: gc.userId });
    mine.clip = (await store.addReminderClip(A, { by: "wei-ling", plays_at: "after_breakfast", text: `${MARK} 爸爸吃药`, by_label: "Wei Ling", by_user_id: gc.userId, link_id: linkAC })).id;
    before = everythingOf(A);
    beforeB = everythingOf(gb.userId);
  }, 120_000);

  it("the fixtures hold: A's marker is in A's own answers (so the scan for it can fail), and in what A shares with C", async () => {
    const aCookie = `rp_at=${ga.tokens.access_token}`;
    for (const [key, opts] of [
      ["GET /api/notes", {}],
      ["GET /api/questions", {}],
      ["GET /api/visits/[id]", { segment: mine.visit }],
      ["GET /api/me", {}],
    ] as [string, Ask][]) {
      const own = await ask(route(key), { ...opts, cookie: aCookie });
      expect([key, own.status]).toEqual([key, 200]);
      expect(own.text.toLowerCase(), key).toContain(MARK);
    }
    // through her active link C reads what A shares: the marker goes where A sent it
    const hers = await ask(route("GET /api/family/shared"), { cookie: `rp_at=${gc.tokens.access_token}`, query: `link=${linkAC}` });
    expect(hers.status).toBe(200);
    expect(hers.text.toLowerCase()).toContain(MARK);
    expect(before.toLowerCase().split(MARK).length).toBeGreaterThan(8);
    // A's and C's own reads are not counted as changes below (her look is written to his access log by design)
    before = everythingOf(ga.userId);
  });

  it("a stranger: exactly 400 no_session or 401 not_signed_in, or the route's own line in PUBLIC / STRANGER", async () => {
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const h of routes) {
      resetLimits();
      const r = await ask(h);
      seen.add(r.key);
      if (leaks(r.text).length) wrong.push(`${r.key}: the answer to a stranger names ${leaks(r.text).join(", ")}`);
      const listed = STRANGER[r.key];
      if (listed) {
        if (r.answer !== listed.answer) wrong.push(`${r.key}: STRANGER says ${listed.answer}, the route answers ${r.answer}`);
        continue;
      }
      if (PUBLIC[r.key]) {
        if (r.status >= 400) wrong.push(`${r.key}: PUBLIC, but a stranger gets ${r.answer} (give it a line in STRANGER with the exact answer, or take it off PUBLIC)`);
        continue;
      }
      if (r.answer !== "400 no_session" && r.answer !== "401 not_signed_in") wrong.push(`${r.key}: ${r.answer}`);
    }
    expect(wrong).toEqual([]);
    // the lists hold nothing stale and nothing unexplained
    for (const [k, v] of Object.entries(STRANGER)) {
      expect(seen.has(k), `STRANGER lists ${k}, which is not a route`).toBe(true);
      expect(v.why.length, k).toBeGreaterThan(20);
    }
    // on both lists only with a well-formed request that shows the 2xx
    expect(Object.keys(PUBLIC).filter((k) => k in STRANGER && !(k in WELL_FORMED))).toEqual([]);
    expect(changedA()).toBe(false);
  }, 120_000);

  it("the public routes that refuse an empty request do answer a well-formed one from a stranger", async () => {
    for (const [key, w] of Object.entries(WELL_FORMED)) {
      resetLimits();
      const r = await ask(route(key), { query: w.query, body: w.body });
      expect([key, r.status]).toEqual([key, w.status]);
      expect(leaks(r.text), key).toEqual([]);
    }
    // the example account's own sample label is not a public picture
    expect((await ask(route("GET /api/labels/sample"), { query: "name=losartan" })).answer).toBe("404 unknown_sample");
  });

  it("B signed in, pointing at A's space by ?session=, by the cookies, and by A's link: 404 or B's own answer, never A's", async () => {
    const wrong: string[] = [];
    const A = ga.userId;
    let notFound = 0;
    let linkRefused = 0;
    for (const h of routes) {
      resetLimits();
      const stranger = (await ask(h)).answer;
      // a route that resolves a space answers a stranger 400 no_session; every other route never reads the pointers
      const resolves = stranger === "400 no_session";
      const check = (name: string, r: Answer, allowed: string[]) => {
        if (leaks(r.text).length) wrong.push(`${r.key} [${name}]: the answer names ${leaks(r.text).join(", ")}`);
        if (r.status >= 500) wrong.push(`${r.key} [${name}]: ${r.answer}`);
        else if (!allowed.includes(r.answer)) wrong.push(`${r.key} [${name}]: ${r.answer}, expected ${allowed.join(" or ")}`);
        if (r.answer === "404 session_not_found") notFound += 1;
        if (r.answer === "404 link_not_found") linkRefused += 1;
      };
      const alone = await ask(h, { cookie: await ready() });
      check("B alone", alone, [alone.answer]);
      const own = alone.answer;
      check("B + ?session=A", await ask(h, { cookie: await ready(), query: `session=${A}` }), [resolves ? "404 session_not_found" : own]);
      check("B + rp_view=demo + rp_session=A", await ask(h, { cookie: `${await ready()}; rp_view=demo; rp_session=${A}` }), [resolves ? "404 session_not_found" : own]);
      check("B + rp_session=A", await ask(h, { cookie: `${await ready()}; rp_session=${A}` }), [own]);
      check("B + ?link=A's link", await ask(h, { cookie: await ready(), query: `link=${linkAC}` }), ["404 link_not_found", own]);
      resetLimits();
      check("a stranger + rp_session=A", await ask(h, { cookie: `rp_session=${A}` }), [resolves ? "404 session_not_found" : stranger]);
      resetLimits();
      check("a stranger + ?session=A", await ask(h, { query: `session=${A}` }), [resolves ? "404 session_not_found" : stranger]);
      resetLimits();
      check("a stranger + ?link=A's link", await ask(h, { query: `link=${linkAC}` }), [stranger]);
      if (changedA()) wrong.push(`${h.method} ${apiPath(h.file)}: something of A's changed`);
    }
    expect(wrong).toEqual([]);
    // the scan did meet both refusals, many times (so it is not vacuous)
    expect(notFound).toBeGreaterThan(300);
    expect(linkRefused).toBeGreaterThanOrEqual(13);
  }, 300_000);

  it("B signed in, naming A's rows in the path: never found, never a 2xx, nothing of A's changes", async () => {
    const wrong: string[] = [];
    const dynamic = routes.filter((h) => /\[/.test(apiPath(h.file)));
    expect(dynamic.length).toBeGreaterThan(25);
    const pointers = [...Object.entries(mine).filter(([what]) => what !== "endpoint"), ["link", linkAC], ["account", ga.userId]] as [string, string][];
    for (const h of dynamic) {
      for (const [what, value] of pointers) {
        const bodies = h.method === "GET" || h.method === "DELETE" ? [undefined] : [undefined, { id: value, text: "hello", state: "taken", yes: true, on: true, status: "skipped", items: { dose_summary: true } }];
        for (const body of bodies) {
          const r = await ask(h, { cookie: await ready(), segment: value, body });
          // the id B sent may be echoed back; anything else of A's may not
          const named = leaks(r.text.split(value).join(""));
          if (named.length) wrong.push(`${r.key} [A's ${what}]: the answer names ${named.join(", ")}`);
          if (r.status >= 500 || r.status < 400) wrong.push(`${r.key} [A's ${what}]: ${r.answer}`);
        }
      }
      if (changedA()) wrong.push(`${h.method} ${apiPath(h.file)}: something of A's changed`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("B (and B's family member) naming A's files and rows in a body or a query: each refused as designed, nothing of A's is read or changed", async () => {
    const A = `rp_at=${ga.tokens.access_token}`;
    const wav = readFileSync(path.join(WEB, "fixtures", "visits", "clips", "v1-u08.wav"));
    const png = readFileSync(path.join(WEB, "fixtures", "labels", "amlodipine.png"));
    /** One file uploaded through the signed link a route handed out (the local file store's own byte route). */
    const upload = async (cookie: string, body: Record<string, unknown>, bytes: Buffer, query = ""): Promise<string> => {
      const link = await ask(route("POST /api/upload-url"), { cookie, body, query });
      expect(link.status, link.text.slice(0, 200)).toBe(200);
      const plan = JSON.parse(link.text) as { path: string; url: string; headers: Record<string, string> };
      const { PUT } = (await import("@/app/api/blob/upload/route")) as { PUT: (req: NextRequest) => Promise<Response> };
      const put = await PUT(new NextRequest(`http://localhost${plan.url}`, { method: "PUT", headers: plan.headers, body: new Uint8Array(bytes) }));
      expect(put.status).toBe(200);
      return plan.path;
    };
    // A's own files: a label photo, a visit's recording with one of its lines cut from it, and C's reminder recording for him
    resetLimits();
    const labelPath = await upload(A, { kind: "label", content_type: "image/png" }, png);
    const started = await ask(route("POST /api/visits"), { cookie: A, body: { mode: "record", consent: { given: true } } });
    expect(started.status, started.text.slice(0, 200)).toBe(200);
    const visitA = (JSON.parse(started.text) as { visit: { id: string } }).visit.id;
    const recPath = await upload(A, { kind: "recording", content_type: "audio/wav", visit_id: visitA }, wav);
    const uttA = `g-utt-${randomUUID()}`;
    await store.addUtterances(ga.userId, visitA, [{ id: uttA, t_start_ms: 0, t_end_ms: 1000, text: `${MARK} a line with its sound`, role: "doctor", role_state: "confirmed", clip_path: recPath }]);
    const C = `rp_at=${gc.tokens.access_token}`;
    const remPath = await upload(C, { kind: "reminder", content_type: "audio/wav" }, wav, `link=${linkAC}`);
    const registered = await ask(route("POST /api/reminders"), { cookie: C, query: `link=${linkAC}`, body: { audio_path: remPath } });
    expect(registered.status, registered.text.slice(0, 200)).toBe(201);
    const clipA = (JSON.parse(registered.text) as { clip: { id: string } }).clip.id;
    // B's family member D, through her own active link to B
    const gd = await createAccountWithSpace(store, getAuthProvider(), { login: `gd${randomUUID().replace(/-/g, "").slice(0, 10)}`, password: PASSWORD_G, space: "none", display_name: "D" });
    const hash = `h-${randomUUID()}`;
    const inv = await store.createInvite({ patient_id: gb.userId, family_label: "D", relation: "daughter", patient_label: "爸爸", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 3600_000).toISOString() }, {});
    if (!inv.ok) throw new Error(inv.code);
    await store.acceptInvite(hash, gd.userId, "D");
    await store.confirmLink(inv.link.id, gb.userId, true);
    await store.setFamilyGrant(gb.userId, inv.link.id, { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true });
    // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
    await agreedLink(store, { id: inv.link.id, patient_id: gb.userId, family_id: gd.userId });
    const linkBD = inv.link.id;
    const D = `rp_at=${gd.tokens.access_token}`;
    const B = await ready();
    const startedB = await ask(route("POST /api/visits"), { cookie: B, body: { mode: "record", consent: { given: true } } });
    expect(startedB.status, startedB.text.slice(0, 200)).toBe(200);
    const visitB = (JSON.parse(startedB.text) as { visit: { id: string } }).visit.id;
    mine.visit2 = visitA;
    mine.utterance2 = uttA;
    mine.clip2 = clipA;

    // the positive controls: the same calls on A's own side (and C's, through her link) do work
    expect((await ask(route("POST /api/labels/read"), { cookie: A, body: { path: labelPath } })).status).toBe(200);
    expect((await ask(route("GET /api/visits/[id]/clip"), { cookie: A, segment: visitA, query: `u=${uttA}` })).status).toBe(200);
    expect((await ask(route("GET /api/family/clip"), { cookie: C, query: `link=${linkAC}&visit=${visitA}&u=${uttA}` })).status).toBe(200);
    expect((await ask(route("GET /api/reminders/[id]/audio"), { cookie: C, segment: clipA, query: `link=${linkAC}` })).status).toBe(200);
    before = everythingOf(ga.userId); // A's own writes above, and her plays (written to his access log by design)

    const cases: [string, string, string, Ask][] = [
      // [what is tried, the route, the designed answer, the request]
      ["A's label photo read as B's", "POST /api/labels/read", "403 photo_not_in_session", { cookie: B, body: { path: labelPath } }],
      ["A's recording given to B's own visit", "POST /api/asr/jobs", "400 invalid_audio_path", { cookie: B, body: { visit_id: visitB, audio_path: recPath } }],
      ["A's visit transcribed by B", "POST /api/asr/jobs", "404 visit_not_found", { cookie: B, body: { visit_id: visitA, audio_path: recPath } }],
      ["an upload link into A's visit", "POST /api/upload-url", "404 visit_not_found", { cookie: B, body: { kind: "recording", content_type: "audio/wav", visit_id: visitA } }],
      ["the transcript job of A's visit", "GET /api/asr/jobs", "404 visit_not_found", { cookie: B, query: `visit_id=${visitA}` }],
      ["a live-caption token for A's visit", "POST /api/asr/realtime-token", "404 visit_not_found", { cookie: B, body: { visit_id: visitA } }],
      ["A's recording in B's export", "GET /api/me/export/recording", "404 no_recording", { cookie: B, query: `visit=${visitA}` }],
      ["A's line played from B's own visit", "GET /api/visits/[id]/clip", "404 no_clip", { cookie: B, segment: visitB, query: `u=${uttA}` }],
      ["A's line played from A's visit", "GET /api/visits/[id]/clip", "404 visit_not_found", { cookie: B, segment: visitA, query: `u=${uttA}` }],
      ["A's line played through D's link to B", "GET /api/family/clip", "404 no_clip", { cookie: D, query: `link=${linkBD}&visit=${visitA}&u=${uttA}` }],
      ["A's line played by D through A's link", "GET /api/family/clip", "404 link_not_found", { cookie: D, query: `link=${linkAC}&visit=${visitA}&u=${uttA}` }],
      ["C's recording for A registered for B by D", "POST /api/reminders", "403 path_not_in_session", { cookie: D, query: `link=${linkBD}`, body: { audio_path: remPath } }],
      ["C's recording for A played by D", "GET /api/reminders/[id]/audio", "404 no_audio", { cookie: D, segment: clipA, query: `link=${linkBD}` }],
      ["C's recording for A played by B", "GET /api/reminders/[id]/audio", "404 no_audio", { cookie: B, segment: clipA }],
      ["C's recording for A deleted by D", "DELETE /api/reminders/[id]", "404 not_found", { cookie: D, segment: clipA, query: `link=${linkBD}` }],
      ["A's reminder marked opened by B", "POST /api/push/opened", "404 delivery_not_found", { cookie: B, body: { delivery: mine.delivery } }],
      ["A's medicine answered by B", "POST /api/doses", "404 not_found", { cookie: B, body: { medication_id: mine.med, slot: "morning", state: "taken" } }],
      ["A's medicine given new times by B", "POST /api/doses/slots", "404 not_found", { cookie: B, body: { medication_id: mine.med, slots: ["evening"] } }],
      ["A's link made B's password helper", "POST /api/auth/recover/helper", "404 link_not_found", { cookie: B, body: { link_id: linkAC, on: true } }],
      ["A's view through A's link, asked by D", "GET /api/family/view", "404 link_not_found", { cookie: D, query: `link=${linkAC}` }],
    ];
    const wrong: string[] = [];
    for (const [what, key, designed, request] of cases) {
      resetLimits();
      const r = await ask(route(key), request);
      if (r.answer !== designed) wrong.push(`${what} (${key}): ${r.answer}, designed ${designed}`);
      // an id the caller sent may be echoed in the refusal; anything else of A's may not
      const sent = JSON.stringify(request);
      const named = leaks(r.text).filter((w) => !sent.includes(w));
      if (named.length) wrong.push(`${what} (${key}): the answer names ${named.join(", ")}`);
      if (changedA()) wrong.push(`${what} (${key}): something of A's changed`);
    }
    // a push endpoint is a browser's own secret: knowing A's does not remove it or test it
    const removed = await ask(route("DELETE /api/push/subscribe"), { cookie: await ready(), body: { endpoint: mine.endpoint } });
    if (removed.answer !== "200" || !/"removed":\s*(false|0)/.test(removed.text)) wrong.push(`B removing A's push endpoint: ${removed.answer} ${removed.text.slice(0, 80)}`);
    const tested = await ask(route("POST /api/push/test"), { cookie: await ready(), body: { endpoint: mine.endpoint } });
    if (tested.status !== 503 && !/"sent":\s*0/.test(tested.text)) wrong.push(`B testing A's push endpoint: ${tested.answer} ${tested.text.slice(0, 80)}`);
    if ((await store.listPushSubscriptions(ga.userId)).length !== 1) wrong.push("A's push subscription is gone");
    if (changedA()) wrong.push("the push calls changed something of A's");
    expect(wrong).toEqual([]);
  }, 120_000);

  it("after all of it: A's rows never moved into B's space", () => {
    expect(everythingOf(gb.userId).toLowerCase().includes(MARK)).toBe(false);
    expect(beforeB.toLowerCase().includes(MARK)).toBe(false);
  });

  it("A's own answers never carry A's own id, not as it is and not inside a token (H1)", async () => {
    // the helper finds an id inside base64 text, at every alignment (so a token cannot hide one)
    for (const pad of ["", "x", "xy"]) {
      const token = Buffer.from(`${pad}{"sid":"${ga.userId}","v":1}`).toString("base64url");
      expect(findId(`{"read_token":"${token}.sig"}`, ga.userId)).toEqual(["base64"]);
    }
    expect(findId(`{"id":"${ga.userId}"}`, ga.userId)).toEqual(["plain"]);
    expect(findId(`{"id":"${gb.userId}"}`, ga.userId)).toEqual([]);

    const auth = getAuthProvider();
    let aToken = ga.tokens.access_token;
    const asA = async (): Promise<string> => {
      resetLimits();
      if (!(await signedInUser(aToken, deps))) aToken = (await auth.signInWithPassword(ga.login.email, PASSWORD_G)).access_token;
      return `rp_at=${aToken}`;
    };
    const wrong: string[] = [];
    let answered = 0;
    const look = (r: Answer, what = r.key) => {
      if (r.status < 300) answered += 1;
      const forms = findId(r.text, ga.userId);
      if (forms.length) wrong.push(`${what}: his own id (${forms.join(", ")})`);
    };
    // a label photo of his, read: the answer carries a token for the confirmation that follows
    const png = readFileSync(path.join(WEB, "fixtures", "labels", "amlodipine.png"));
    const link = await ask(route("POST /api/upload-url"), { cookie: await asA(), body: { kind: "label", content_type: "image/png" } });
    look(link);
    const plan = JSON.parse(link.text) as { path: string; url: string; headers: Record<string, string> };
    const { PUT } = (await import("@/app/api/blob/upload/route")) as { PUT: (req: NextRequest) => Promise<Response> };
    expect((await PUT(new NextRequest(`http://localhost${plan.url}`, { method: "PUT", headers: plan.headers, body: new Uint8Array(png) }))).status).toBe(200);
    const read = await ask(route("POST /api/labels/read"), { cookie: await asA(), body: { path: plan.path } });
    expect(read.status, read.text.slice(0, 120)).toBe(200);
    look(read, "POST /api/labels/read (his own label photo)");
    // his visit, his hero question, a reading, a note: the everyday writes
    for (const [key, opts] of [
      ["POST /api/ask", { body: { text: "今天 150/95，我能不能多吃一粒？" } }],
      ["POST /api/bp", { body: { id: randomUUID(), systolic: 138, diastolic: 86 } }],
      ["POST /api/notes", { body: { text: "a little tired today" } }],
      ["POST /api/doses", { body: { medication_id: "med-amlodipine", slot: "morning", state: "taken" } }],
      ["POST /api/family/invites", { body: { family_label: "Mei", relation: "daughter", patient_label: "爸爸" } }],
      ["GET /api/visits/[id]", { segment: "v2" }],
      ["GET /api/visits/[id]", { segment: mine.visit }],
      ["GET /api/meds/[id]", { segment: "med-amlodipine" }],
      ["GET /api/family/links/[id]/access", { segment: linkAC }],
    ] as [string, Ask][]) {
      const r = await ask(route(key), { ...opts, cookie: await asA() });
      if (r.status >= 400) wrong.push(`${key}: ${r.answer} (the request of this test is not well formed any more)`);
      look(r);
    }
    // and every route once more with an empty request, as himself
    for (const h of routes) look(await ask(h, { cookie: await asA() }));
    expect(wrong).toEqual([]);
    expect(answered).toBeGreaterThan(45);
  }, 120_000);
});
