/**
 * M6 privacy, route by route: Wei Ling's phone gets nothing Mr Tan did not grant, from every page and every API the
 * app has. The routes are read from the files (app/api/**\/route.ts with their exported methods, app/**\/page.tsx),
 * not from a list, so a route added later is probed the day it appears.
 *
 * The expected policy is written here independently of lib/family/gate.ts (the unit test checks that file against the
 * same folders):
 *   pages  /f and /join open (200, and none of what he switched off is in them); every other page is a 307 to /f
 *          whose answer carries none of his data, for a normal request and for a client-side navigation (RSC: 1).
 *   APIs   only what /f and /join need answer her (FAMILY_ALLOWED below, each checked for what it gives back); the
 *          two upload routes the gate leaves out are checked for not taking anything without a signed token; every
 *          other method on every other route is 403 patient_only, before the handler reads the body.
 *   his    a GET that is closed to her is not patient_only for his own phone (so the 403 is about her, not a broken
 *          route); after the whole sweep his notes, readings, doses, medicines, questions, switches, reminders and
 *          story clock are exactly as before (nothing she sent acted for him).
 *   forged a device that joined as family and then sets rp_role=patient is still family (the member row decides).
 *   nobody once she has joined, a device with no row in his session is nobody (lib/family/identity.ts): her phone
 *          with its cookies dropped (a private window, fetch with credentials "omit"), or with forged ones (his session
 *          id, rp_role=patient or family, no member id), gets 403 member_required from every API route, the
 *          allow-list included, and every page but /join sends it to /join; nothing of his changes.
 *   elsewhere  her phone naming another real session (?session= wins over the cookie) gets 403 patient_only from
 *          every API route there, the allow-list included.
 *   rejoin her phone has the session's code (she joined with it; it is no longer on her /f or her stream): joining
 *          again as patient, director, backstage or judge is 403 before the handler, also when the request names a
 *          session her phone has no row in; joining again as family gives her own row back. A fresh phone (a private
 *          window) with the code cannot become him once his phone has joined (403 patient_exists), nor the director
 *          or backstage without the crew key, nor a judge at all (lib/family/join.ts).
 *   no identity  before anyone has joined as family (a judge's sandbox, the shoot before she joins), a request with
 *          no cookie at all (a private window, curl with only ?session=) gets 403 member_required from every API
 *          route except the few that read nothing of his (ANONYMOUS_ALLOWED: joining, its own sandbox, the session
 *          row without its members, the dataset page, the health checks); every page under app/p opened with no cookie
 *          shows nothing of his; nothing of his changes.
 *
 * D41 with the seed's switches: dose summary, readings count, questions count and the no-reply alert on; visit
 * transcripts and his notes off.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext } from "@playwright/test";
import { BASE_URL, createSession, waitLive } from "./helpers";

const APP = path.join(__dirname, "..", "app");
const NOTE_D20 = "我今天好累。";
const NOTE_D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const R1 = "At home, we want it below 135 over 85.";
/** what he has switched off at D41 (notes, visit transcripts) and what is never hers (reading numbers, beats) */
const OFF_CONTENT = [NOTE_D20, NOTE_D37, R1, "150/95", "126/82", '"systolic"', "He mentions his ankle"];

/** What her phone may call, and what each must answer (her own reminder clip id is filled in at run time). */
const FAMILY_ALLOWED = [
  "GET /api/family/view",
  "GET /api/family/alerts",
  "GET /api/events",
  "GET /api/reminders",
  "POST /api/reminders",
  "GET /api/reminders/[id]/audio",
  // C2 (real-app 12 「她录的提醒存完听不回、删不掉」): 「删掉这段」 on the demo's /f, her own recordings only
  "DELETE /api/demo/reminders/[id]",
  "POST /api/upload-url",
  "POST /api/session/join",
  "GET /api/health",
] as const;
/** What a request with no device at all may call about a session nobody joined as family (none of it his data). */
const ANONYMOUS_ALLOWED = ["POST /api/session/join", "POST /api/session", "GET /api/session", "GET /api/real", "GET /api/health", "GET /api/asr/health"] as const;
/** Left out of the gate on purpose (lib/family/gate.ts OUTSIDE_GATE): checked here for not taking anything. */
const OUTSIDE_GATE = ["PUT /api/blob/upload", "POST /api/preflight/upload"] as const;
const FAMILY_PAGES = ["/f", "/join"];

/** Bodies that would act for him if anything let them through (the gate answers before reading them). */
const BODIES: Record<string, unknown> = {
  "POST /api/ask": { text: "我可以多吃一粒降压药吗？", locale: "zh-Hans" },
  "POST /api/bp": { systolic: 151, diastolic: 97 },
  "POST /api/clock": { day: 0 },
  "POST /api/director/cue": { cue: "no_reply" },
  "POST /api/director/filming": { on: true },
  "POST /api/doses": { medication_id: "med-amlodipine", slot: "morning", state: "missed" },
  "POST /api/family/grants": { items: { notes: true, visit_transcripts: true } },
  "POST /api/meds": { read_token: "x".repeat(20), confirmed: [], origin: "self_bought" },
  "PATCH /api/meds/[id]": { action: "relabel" },
  "POST /api/meds/[id]/answer": { visit_id: "p1", utterance_id: "p1-u03", speaker: "pharmacist" },
  "POST /api/notes": { text: "她替他写的一句。" },
  "POST /api/session": { story_day: 0 },
  "POST /api/session/reset": {},
  "POST /api/understanding": { med_id: "med-amlodipine", item: "feel_fine", answer: "unsure" },
  "POST /api/upload-url": { kind: "label", content_type: "image/png" },
  "POST /api/visits": { mode: "replay" },
  "POST /api/visits/[id]/confirm": { mine: [], items: {} },
  "POST /api/visits/[id]/replay": { speed: 20 },
  "POST /api/tts": { text: "hello" },
};

// ------------------------------------------------------------------ the routes, from the files

function find(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...find(p, name));
    else if (e.name === name) out.push(p);
  }
  return out;
}

/** app/api/meds/[id]/route.ts -> /api/meds/[id]; route groups "(x)" do not count. */
function routeOf(file: string): string {
  const segs = path.relative(APP, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segs.join("/")}`;
}

function apiRoutes(): { key: string; method: string; route: string }[] {
  const out: { key: string; method: string; route: string }[] = [];
  for (const file of find(path.join(APP, "api"), "route.ts")) {
    const src = readFileSync(file, "utf8");
    const methods = new Set<string>();
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)) methods.add(m[1] ?? m[2]);
    for (const method of methods) out.push({ key: `${method} ${routeOf(file)}`, method, route: routeOf(file) });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function pageRoutes(): string[] {
  return find(APP, "page.tsx").map(routeOf).sort();
}

/**
 * A path for each dynamic segment: his real ids where the seed has them (so his own phone gets real data on the
 * same URL), a placeholder for any other (a route added later is still probed: her answer comes from the gate,
 * before the handler looks the id up).
 */
function concrete(route: string, clipId: string): string {
  return route
    .replace(/^\/api\/meds\/\[id\]/, "/api/meds/med-amlodipine")
    .replace(/^\/api\/visits\/\[id\]/, "/api/visits/v1")
    .replace(/^\/api\/reminders\/\[id\]/, `/api/reminders/${clipId}`)
    .replace(/^\/api\/asr\/jobs\/\[id\]/, "/api/asr/jobs/job-probe")
    .replace(/^\/p\/meds\/\[id\]/, "/p/meds/med-amlodipine")
    .replace(/^\/p\/visit\/\[id\]/, "/p/visit/v1")
    .replace(/^\/design\/today\/\[state\]/, "/design/today/default")
    .replace(/\[\[?\.{0,3}[^\]/]+\]\]?/g, "probe-id");
}

function withSession(p: string, sid: string): string {
  const extra = p.startsWith("/api/visits/v1/clip") ? "&u=v1-u08" : p.startsWith("/api/preflight/wait") ? "&ms=0" : "";
  return `${p}${p.includes("?") ? "&" : "?"}session=${encodeURIComponent(sid)}${extra}`;
}

async function call(r: APIRequestContext, method: string, url: string, data?: unknown): Promise<APIResponse> {
  return r.fetch(url, { method, data: method === "GET" || method === "DELETE" ? undefined : (data ?? {}), maxRedirects: 0, timeout: 15_000 });
}

// ------------------------------------------------------------------ devices and his data

async function joinAsFamily(browser: Browser, code: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const res = await context.request.post("/api/session/join", { data: { code, role: "family" } });
  expect(res.status(), await res.text()).toBe(200);
  return context;
}

/** Everything of his that an action in his name could change, read from his own phone. */
async function hisData(request: APIRequestContext, sid: string) {
  const q = `session=${sid}`;
  const json = async (p: string) => (await request.get(`${p}${p.includes("?") ? "&" : "?"}${q}`)).json();
  const session = (await json("/api/session")) as { session: { story_day: number; story_time: string | null; filming_mode: boolean } };
  const html = await (await request.get("/p/questions")).text();
  return {
    notes: await json("/api/notes"),
    bp: await json("/api/bp"),
    doses: await json("/api/doses?from=0&to=60"),
    meds: await json("/api/meds"),
    grants: ((await json("/api/family/grants")) as { items: unknown }).items,
    clips: ((await json("/api/reminders")) as { clips: { id: string }[] }).clips.map((c) => c.id),
    clock: { day: session.session.story_day, time: session.session.story_time, filming: session.session.filming_mode },
    questions: (html.match(/data-testid="question"/g) ?? []).length,
  };
}

function expectNoOffContent(body: string, where: string) {
  for (const x of OFF_CONTENT) expect.soft(body.includes(x), `${where} carries ${x}`).toBe(false);
}

// ------------------------------------------------------------------ the sweep

test("every API route: her phone gets only what /f needs; everything else is 403 patient_only and nothing of his changes", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const routes = apiRoutes();
  const keys = routes.map((r) => r.key);
  // the policy names real routes (a rename cannot leave a stale allow entry behind)
  for (const k of [...FAMILY_ALLOWED, ...OUTSIDE_GATE]) expect(keys, `${k} exists`).toContain(k);
  expect(routes.length).toBeGreaterThanOrEqual(50);

  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const her = await joinAsFamily(browser, s.join_code);
  const clipId = ((await (await request.get(`/api/reminders?session=${s.id}`)).json()) as { clips: { id: string }[] }).clips[0]?.id;
  expect(clipId, "the seed has a reminder clip").toBeTruthy();
  const before = await hisData(request, s.id);
  expect(JSON.stringify(before.notes)).toContain(NOTE_D37); // the snapshot looks at the right data

  const closed: string[] = [];
  for (const r of routes) {
    const url = withSession(concrete(r.route, clipId), s.id);
    if ((FAMILY_ALLOWED as readonly string[]).includes(r.key) || (OUTSIDE_GATE as readonly string[]).includes(r.key)) continue;
    if (r.method === "GET") {
      // his phone: whatever the route answers, it is not "patient_only" (the 403 below is about her)
      const his = await call(request, "GET", url);
      const hisBody = await his.text();
      expect.soft(his.status() === 403 && hisBody.includes('"patient_only"'), `${r.key}: his own phone is refused`).toBe(false);
    }
    const res = await call(her.request, r.method, url, BODIES[r.key]);
    const body = await res.text();
    expect.soft(res.status(), `${r.key} -> ${res.status()} ${body.slice(0, 160)}`).toBe(403);
    if (res.status() === 403) expect.soft(JSON.parse(body).error, r.key).toBe("patient_only");
    expectNoOffContent(body, r.key);
    closed.push(r.key);
  }
  // the upload link: her reminder only; his visit audio and bag photos are refused
  for (const kind of ["label", "recording", "segment"]) {
    const res = await call(her.request, "POST", withSession("/api/upload-url", s.id), { kind, content_type: kind === "label" ? "image/png" : "audio/wav", visit_id: "v1", utterance_id: "v1-u08" });
    expect.soft(res.status(), `upload-url kind ${kind}`).toBe(403);
  }
  const link = await call(her.request, "POST", withSession("/api/upload-url", s.id), { kind: "reminder", content_type: "audio/wav" });
  expect(link.status(), await link.text()).toBe(200);
  expect(((await link.json()) as { path: string }).path).toMatch(new RegExp(`^${s.id}/reminders/.+\\.wav$`));

  // what she may read holds nothing he switched off
  for (const p of ["/api/family/view", "/api/family/alerts", "/api/reminders", "/api/health"]) {
    const res = await call(her.request, "GET", withSession(p, s.id));
    expect.soft(res.status(), p).toBe(200);
    expectNoOffContent(await res.text(), p);
  }
  const audio = await call(her.request, "GET", withSession(`/api/reminders/${clipId}/audio`, s.id));
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toContain("audio/wav");
  // 「删掉这段」 reaches its handler and deletes nothing that is not hers: the story's own clip is 404 and stays
  const del = await call(her.request, "DELETE", withSession(`/api/demo/reminders/${clipId}`, s.id));
  expect(del.status(), "the story's clip is not hers to delete").toBe(404);
  expect(((await (await request.get(`/api/reminders?session=${s.id}`)).json()) as { clips: { id: string }[] }).clips.map((c) => c.id)).toContain(clipId);
  // registering and joining reach their handlers (and do nothing with these bodies); joining only as family
  const reg = await call(her.request, "POST", withSession("/api/reminders", s.id), {});
  expect(reg.status(), "her empty registration reaches the route's own validation").toBe(400);
  const join = await call(her.request, "POST", "/api/session/join", { code: "NOPE99", role: "family" });
  expect(join.status(), "her join as family reaches the handler (no such code)").toBe(404);
  const asHim = await call(her.request, "POST", "/api/session/join", { code: "NOPE99", role: "patient" });
  expect(asHim.status(), "her join as anyone else is refused before the handler").toBe(403);
  // the two uploads outside the gate take nothing without a signed token
  const put = await her.request.fetch(withSession("/api/blob/upload", s.id), { method: "PUT", headers: { "content-type": "audio/wav" }, data: Buffer.from("RIFF0000WAVE") });
  expect(put.status(), "blob upload without a token").toBeGreaterThanOrEqual(400);
  const pre = await call(her.request, "POST", "/api/preflight/upload", "x".repeat(1000));
  expectNoOffContent(await pre.text(), "preflight upload");

  // her live stream opens (filtered; the content is checked in m6-privacy defect 2)
  const page = await her.newPage();
  await page.goto("/f");
  await waitLive(page);
  const stream = await page.evaluate(async (sid) => {
    const ctrl = new AbortController();
    const res = await fetch(`/api/events?session=${encodeURIComponent(sid)}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    return { status: res.status, type: res.headers.get("content-type") ?? "", first };
  }, s.id);
  expect(stream.status).toBe(200);
  expect(stream.type).toContain("text/event-stream");
  expect(stream.first).toContain("connected");

  // nothing she sent acted for him
  expect(await hisData(request, s.id)).toEqual(before);
  console.log(`[m6-privacy-routes] ${routes.length} API method+route pairs: ${closed.length} closed to her, ${FAMILY_ALLOWED.length} open to her, ${OUTSIDE_GATE.length} outside the gate`);
  await her.close();
});

test("every page: /f and /join open with nothing he switched off; every other page sends her to /f, also on a client-side navigation", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const pages = pageRoutes();
  for (const p of FAMILY_PAGES) expect(pages, `${p} exists`).toContain(p);
  expect(pages).toContain("/p/today");
  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const her = await joinAsFamily(browser, s.join_code);
  // a client-side navigation asks for the RSC payload; a layout does not run for it, the gate does
  const rsc = { RSC: "1", "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(["", { children: ["p", { children: ["today", { children: ["__PAGE__", {}] }] }] }, null, null, true])) };
  for (const route of pages) {
    const p = concrete(route, "none");
    const res = await her.request.get(p, { maxRedirects: 0 });
    const body = await res.text();
    if (FAMILY_PAGES.includes(route)) {
      // the gate lets her open both; /join itself is the film crew's since C2 (lib/crew/gate.ts) and answers her 404
      expect.soft(res.status(), p).toBe(route === "/join" ? 404 : 200);
    } else {
      expect.soft(res.status(), p).toBe(307);
      expect.soft(res.headers().location ?? "", p).toMatch(/\/f$/);
      const nav = await her.request.get(p, { maxRedirects: 0, headers: rsc });
      const navBody = await nav.text();
      expect.soft(nav.status(), `${p} (RSC navigation): ${navBody.slice(0, 120)}`).toBe(307);
      expect.soft(nav.headers().location ?? "", `${p} (RSC navigation)`).toMatch(/\/f$/);
      expectNoOffContent(navBody, `${p} (RSC navigation)`);
    }
    expectNoOffContent(body, p);
  }
  await her.close();
});

test("the member row decides: rp_role=patient on her phone is still her; a role cookie with no row is nobody", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const her = await joinAsFamily(browser, s.join_code);
  await her.addCookies([{ name: "rp_role", value: "patient", url: BASE_URL }]);
  const cookieOnly = await browser.newContext({ baseURL: BASE_URL });
  await cookieOnly.addCookies([
    { name: "rp_session", value: s.id, url: BASE_URL },
    { name: "rp_role", value: "family", url: BASE_URL },
  ]);
  for (const [ctx, home, code] of [
    [her, "/f", "patient_only"],
    [cookieOnly, "/join", "member_required"],
  ] as const) {
    for (const p of ["/p/bp", "/p/visit/v1/review", "/backstage", "/"]) {
      const res = await ctx.request.get(p, { maxRedirects: 0 });
      expect.soft(res.status(), p).toBe(307);
      expect.soft(res.headers().location ?? "", p).toMatch(new RegExp(`${home}$`));
      expectNoOffContent(await res.text(), p);
    }
    for (const p of ["/api/visits/v1", "/api/doses", "/api/notes", "/api/session"]) {
      const res = await ctx.request.get(withSession(p, s.id));
      expect.soft(res.status(), p).toBe(403);
      expect.soft(((await res.json()) as { error: string }).error, `${home} ${p}`).toBe(code);
    }
    const reset = await ctx.request.post(withSession("/api/session/reset", s.id), { data: {} });
    expect.soft(reset.status(), "reset").toBe(403);
  }
  // his own phone is unaffected by her cookies
  expect((await request.get(withSession("/api/visits/v1", s.id))).status()).toBe(200);
  await her.close();
  await cookieOnly.close();
});

test("every API route and page, once she has joined: a device with no row in his session (her phone, cookies dropped or forged) gets nothing", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const routes = apiRoutes();
  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const her = await joinAsFamily(browser, s.join_code);
  const clipId = ((await (await request.get(`/api/reminders?session=${s.id}`)).json()) as { clips: { id: string }[] }).clips[0]?.id;
  const before = await hisData(request, s.id);
  // three ways of being nobody: no cookies at all (what a private window sends), and two forged cookie sets
  const dropped = await browser.newContext({ baseURL: BASE_URL });
  const forgedPatient = await browser.newContext({ baseURL: BASE_URL });
  await forgedPatient.addCookies([
    { name: "rp_session", value: s.id, url: BASE_URL },
    { name: "rp_role", value: "patient", url: BASE_URL },
  ]);
  const forgedMember = await browser.newContext({ baseURL: BASE_URL });
  await forgedMember.addCookies([
    { name: "rp_session", value: s.id, url: BASE_URL },
    { name: "rp_member", value: "member-made-up", url: BASE_URL },
    { name: "rp_role", value: "patient", url: BASE_URL },
  ]);
  let probes = 0;
  for (const [who, ctx] of [
    ["cookies dropped", dropped],
    ["his session id + rp_role=patient", forgedPatient],
    ["a made-up member id", forgedMember],
  ] as const) {
    for (const r of routes) {
      if ((OUTSIDE_GATE as readonly string[]).includes(r.key)) continue;
      const url = withSession(concrete(r.route, clipId), s.id);
      if (r.key === "POST /api/session/join") {
        // joining with the code is the one way in: it reaches the handler (a wrong code: 404), nothing else does
        const join = await call(ctx.request, "POST", url, { code: "NOPE99", role: "patient" });
        expect.soft(join.status(), `${who}: join reaches the handler`).toBe(404);
        continue;
      }
      const res = await call(ctx.request, r.method, url, BODIES[r.key]);
      const body = await res.text();
      expect.soft(res.status(), `${who}: ${r.key} -> ${res.status()} ${body.slice(0, 120)}`).toBe(403);
      if (res.status() === 403) expect.soft(JSON.parse(body).error, `${who}: ${r.key}`).toBe("member_required");
      expectNoOffContent(body, `${who}: ${r.key}`);
      probes += 1;
    }
  }
  // pages read the rp_session cookie: the forged ones are sent to /join (the one page the gate lets them open), with
  // nothing; and /join itself is the film crew's since C2 (lib/crew/gate.ts): without the crew's cookie it answers 404
  for (const route of pageRoutes()) {
    const p = concrete(route, "none");
    const res = await forgedPatient.request.get(p, { maxRedirects: 0 });
    const body = await res.text();
    if (route === "/join") {
      expect.soft(res.status(), p).toBe(404);
    } else {
      expect.soft(res.status(), p).toBe(307);
      expect.soft(res.headers().location ?? "", p).toMatch(/\/join$/);
    }
    expectNoOffContent(body, `forged page ${p}`);
  }
  // nothing changed, her own phone still works, his phone still reads
  expect(await hisData(request, s.id)).toEqual(before);
  expect((await her.request.get(withSession("/api/family/view", s.id))).status()).toBe(200);
  console.log(`[m6-privacy-routes] nobody in his session: ${probes} API probes (${routes.length} method+route pairs x 3 devices, the ${OUTSIDE_GATE.length} outside the gate left out)`);
  await Promise.all([dropped.close(), forgedPatient.close(), forgedMember.close(), her.close()]);
});

test("every API route, from her phone naming another real session: 403 patient_only there, the allow-list included", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const routes = apiRoutes();
  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const her = await joinAsFamily(browser, s.join_code);
  // T: another family's session, opened from another browser
  const elsewhere = await browser.newContext({ baseURL: BASE_URL });
  const tRes = await elsewhere.request.post("/api/session", { data: { story_day: 41, story_time: "20:15", role: "patient" } });
  expect(tRes.status(), await tRes.text()).toBe(201);
  const t = ((await tRes.json()) as { session: { id: string } }).session.id;
  const tClip = ((await (await elsewhere.request.get(`/api/reminders?session=${t}`)).json()) as { clips: { id: string }[] }).clips[0]?.id;
  const tBefore = await hisData(elsewhere.request, t);
  for (const r of routes) {
    if ((OUTSIDE_GATE as readonly string[]).includes(r.key)) continue;
    const url = withSession(concrete(r.route, tClip), t);
    const allowed = (FAMILY_ALLOWED as readonly string[]).includes(r.key);
    const data = BODIES[r.key] ?? (r.key === "POST /api/upload-url" ? { kind: "reminder", content_type: "audio/wav" } : r.key === "POST /api/session/join" ? { code: "NOPE99", role: "family" } : undefined);
    const res = await call(her.request, r.method, url, data);
    const body = await res.text();
    expect.soft(res.status(), `${allowed ? "(allow-list) " : ""}${r.key} -> ${res.status()} ${body.slice(0, 120)}`).toBe(403);
    if (res.status() === 403) expect.soft(JSON.parse(body).error, r.key).toBe("patient_only");
  }
  expect(await hisData(elsewhere.request, t)).toEqual(tBefore);
  await elsewhere.close();
  await her.close();
});

/** A request with no cookie at all, the way a private window or curl with only ?session= sends it (no cookie jar). */
async function bare(method: string, url: string, data?: unknown): Promise<{ status: number; type: string; text: string; cookies: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const hasBody = method !== "GET" && method !== "DELETE" && method !== "HEAD";
    const res = await fetch(`${BASE_URL}${url}`, {
      method,
      redirect: "manual",
      signal: ctrl.signal,
      headers: hasBody ? { "content-type": "application/json" } : {},
      body: hasBody ? JSON.stringify(data ?? {}) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    let text = "";
    if (type.includes("text/event-stream")) {
      // a stream that was let through: read what it sends first, then stop (the assertion below fails on the 200)
      const reader = res.body!.getReader();
      const first = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      text = first && first.value ? new TextDecoder().decode(first.value) : "";
      ctrl.abort();
    } else {
      text = await res.text();
    }
    return { status: res.status, type, text, cookies: res.headers.get("set-cookie") ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

test("attacker sweep, no identity: before anyone joined as family, a request with no cookie gets nothing of his from any API route or page", async ({ request }) => {
  test.setTimeout(240_000);
  const routes = apiRoutes();
  const keys = routes.map((r) => r.key);
  for (const k of ANONYMOUS_ALLOWED) expect(keys, `${k} exists`).toContain(k);
  // his session, made by his phone (patient row + cookies on `request`); Wei Ling has not joined it: a judge's sandbox,
  // or the shoot before her phone joins. The attacker knows its id (that is the case left after the stranger rule).
  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const clipId = ((await (await request.get(`/api/reminders?session=${s.id}`)).json()) as { clips: { id: string }[] }).clips[0]?.id;
  const hisMember = ((await request.storageState()).cookies.find((c) => c.name === "rp_member") ?? { value: "" }).value;
  expect(hisMember, "his phone holds its member cookie (the credential that must not leak)").toBeTruthy();
  const before = await hisData(request, s.id);
  expect(JSON.stringify(before.notes)).toContain(NOTE_D37);

  let refused = 0;
  const open: string[] = [];
  for (const r of routes) {
    if ((OUTSIDE_GATE as readonly string[]).includes(r.key) || r.key === "POST /api/session/join") continue;
    const url = withSession(concrete(r.route, clipId), s.id);
    const res = await bare(r.method, url, BODIES[r.key]);
    // nothing of his, whatever the answer: no note, no reading number, no R1, not his member id (the rp_member credential)
    expectNoOffContent(res.text, `no identity: ${r.key}`);
    expect.soft(res.text.includes(hisMember), `no identity: ${r.key} carries his member id`).toBe(false);
    if ((ANONYMOUS_ALLOWED as readonly string[]).includes(r.key)) {
      expect.soft(res.status, `no identity: ${r.key} (allowed) -> ${res.status} ${res.text.slice(0, 120)}`).not.toBe(403);
      open.push(r.key);
      continue;
    }
    expect.soft(res.status, `no identity: ${r.key} -> ${res.status} ${res.text.slice(0, 120)}`).toBe(403);
    if (res.status === 403) expect.soft(JSON.parse(res.text).error, `no identity: ${r.key}`).toBe("member_required");
    refused += 1;
  }
  expect(open.sort()).toEqual(ANONYMOUS_ALLOWED.filter((k) => k !== "POST /api/session/join").sort());
  // the session row it may read has no member list at all (and so no member id)
  const row = await bare("GET", withSession("/api/session", s.id));
  expect(row.status).toBe(200);
  expect(Object.keys(JSON.parse(row.text) as object)).toEqual(["session"]);
  // his own phone still reads its session with the members' roles, never their ids
  const his = await request.get(withSession("/api/session", s.id));
  const hisText = await his.text();
  expect((JSON.parse(hisText) as { members: { role: string }[] }).members.map((m) => m.role)).toEqual(["patient"]);
  expect(hisText).not.toContain(hisMember);

  // pages read the rp_session cookie, so with no cookie every page under app/p is the "no session" screen: nothing of
  // his, also when the URL names his session
  let pages = 0;
  for (const route of pageRoutes().filter((p) => p === "/p" || p.startsWith("/p/") || p === "/f")) {
    for (const p of [concrete(route, "none"), withSession(concrete(route, "none"), s.id)]) {
      const res = await bare("GET", p);
      expect.soft([200, 307, 308], `no identity: page ${p} -> ${res.status}`).toContain(res.status);
      expectNoOffContent(res.text, `no identity: page ${p}`);
      expect.soft(res.text.includes(s.join_code), `no identity: page ${p} shows the code`).toBe(false);
      pages += 1;
    }
  }

  // the code (say she learnt it) cannot make a device with no cookie his, the director, backstage or a judge
  for (const [role, code] of [
    ["patient", "patient_exists"],
    ["director", "crew_key_required"],
    ["backstage", "crew_key_required"],
    ["judge", "role_not_joinable"],
  ] as const) {
    const res = await bare("POST", "/api/session/join", { code: s.join_code, role });
    expect.soft(res.status, `no identity: join as ${role} -> ${res.text.slice(0, 120)}`).toBe(403);
    if (res.status === 403) expect.soft(JSON.parse(res.text).error, `no identity: join as ${role}`).toBe(code);
    expect.soft(res.cookies, `no identity: join as ${role} sets no cookie`).toBe("");
  }
  expect(await hisData(request, s.id)).toEqual(before);
  console.log(`[m6-privacy-routes] no identity in his session before she joined: ${refused} API pairs refused (403 member_required), ${open.length} open that read nothing of his, ${pages} page requests with nothing of his`);
});

test("rejoining: the code cannot make her phone, or a fresh phone, his (or staff); joining again as family gives her own row back", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 41, story_time: "20:15", role: "patient" });
  const her = await joinAsFamily(browser, s.join_code);
  // she has the code (she joined with it), but her own /f no longer shows it (not in the page, not in its debug line)
  expect(await (await her.request.get("/f")).text()).not.toContain(s.join_code);
  const members = async () => ((await (await request.get(withSession("/api/session", s.id))).json()) as { members: { role: string }[] }).members.map((m) => m.role).sort();
  const before = await members();
  expect(before).toEqual(["family", "patient"]);
  const herCookiesBefore = (await her.cookies()).map((c) => `${c.name}=${c.value}`).sort();

  // a second real session she has no row in (opened from another browser, so his phone's cookies stay on his session)
  const elsewhere = await browser.newContext({ baseURL: BASE_URL });
  const otherRes = await elsewhere.request.post("/api/session", { data: { story_day: 0 } });
  expect(otherRes.status(), await otherRes.text()).toBe(201);
  const otherId = ((await otherRes.json()) as { session: { id: string } }).session.id;
  await elsewhere.close();

  for (const role of ["patient", "director", "backstage", "judge"]) {
    // without ?session= the gate reads her rp_session cookie; with it, the named session. The join route reads only
    // the code, so naming a session her phone has no row in (made up, or someone else's) must not shed her role.
    for (const url of [
      "/api/session/join",
      withSession("/api/session/join", s.id),
      withSession("/api/session/join", "nope00"),
      withSession("/api/session/join", otherId),
    ]) {
      const res = await call(her.request, "POST", url, { code: s.join_code, role });
      const body = await res.text();
      expect.soft(res.status(), `${role} via ${url}: ${body.slice(0, 120)}`).toBe(403);
      if (res.status() === 403) expect.soft(JSON.parse(body).error, `${role} via ${url}`).toBe("patient_only");
      expect.soft(res.headers()["set-cookie"] ?? "", `${role}: no new cookies`).toBe("");
    }
  }
  // opening a session of her own is closed too, whatever session the request names
  for (const url of ["/api/session", withSession("/api/session", "nope00"), withSession("/api/session", otherId)]) {
    const res = await call(her.request, "POST", url, { story_day: 0 });
    expect.soft(res.status(), `create via ${url}`).toBe(403);
  }
  // nobody was added, her cookies are what they were, and she is still family everywhere
  expect(await members()).toEqual(before);
  expect((await her.cookies()).map((c) => `${c.name}=${c.value}`).sort()).toEqual(herCookiesBefore);
  for (const p of ["/api/notes", "/api/bp", "/api/session"]) {
    const res = await her.request.get(withSession(p, s.id));
    expect.soft(res.status(), p).toBe(403);
    expectNoOffContent(await res.text(), p);
  }
  for (const p of ["/p/today", "/p/bp"]) {
    const res = await her.request.get(p, { maxRedirects: 0 });
    expect.soft(res.status(), p).toBe(307);
    expectNoOffContent(await res.text(), p);
  }

  // joining again as family is still hers: 200, lands on /f, and she gets her own row back (no second row)
  const again = await call(her.request, "POST", "/api/session/join", { code: s.join_code, role: "family" });
  expect(again.status(), await again.text()).toBe(200);
  expect(((await again.json()) as { next: string }).next).toBe("/f");
  expect(await members()).toEqual(["family", "patient"]);
  expect((await her.request.get(withSession("/api/notes", s.id))).status()).toBe(403);
  // a fresh phone with the code (her private window): his phone is already in, so it cannot become him; staff roles
  // need the crew key, a judge is never joined; nothing is added, and it reads nothing of his
  for (const [role, code] of [
    ["patient", "patient_exists"],
    ["director", "crew_key_required"],
    ["backstage", "crew_key_required"],
    ["judge", "role_not_joinable"],
  ] as const) {
    const fresh = await browser.newContext({ baseURL: BASE_URL });
    const res = await fresh.request.post("/api/session/join", { data: { code: s.join_code, role } });
    const body = await res.text();
    expect.soft(res.status(), `fresh phone as ${role}: ${body.slice(0, 120)}`).toBe(403);
    if (res.status() === 403) expect.soft(JSON.parse(body).error, `fresh phone as ${role}`).toBe(code);
    expect.soft((await fresh.cookies()).map((c) => c.name), `fresh phone as ${role}: no cookies`).toEqual([]);
    const notes = await fresh.request.get(withSession("/api/notes", s.id));
    expect.soft(notes.status(), `fresh phone as ${role}, then his notes`).toBe(403);
    expectNoOffContent(await notes.text(), `fresh phone as ${role}, then his notes`);
    await fresh.close();
  }
  expect(await members()).toEqual(["family", "patient"]);
  expect((await request.get(withSession("/api/notes", s.id))).status()).toBe(200);
  await her.close();
});
