/**
 * STORE=supabase across two server instances (runs only with STORE_LIVE=1; skipped in the normal e2e run).
 *
 * Do not run this file on its own: `node scripts/db/multi-instance.mjs` builds once, starts two `next start`
 * processes on the same Supabase database (A on 3203 with BUS_STREAM_MAX_MS=4000, B on 3213), runs this spec with
 * PW_PORT=3203 (Playwright reuses A instead of starting `next dev`), restarts B to check that a session survives,
 * and removes every session it created. SUPA_A_URL / SUPA_B_URL tell this spec where the two instances are.
 *
 * Checks:
 *   1. a dose tick posted to instance A reaches an EventSource connected to instance B within 2 s (five ticks);
 *   2. the phone page /p/today served by B shows a tick posted to A within 2 s;
 *   3. a stream on A that ends every 4 s (as a serverless function timeout would end it) comes back with
 *      Last-Event-ID and receives every one of 10 ticks posted to B, once each, in order.
 * The page's EventSource carries the device cookies the spec's own POST /api/session got (sameDevice), as a judge's
 * browser does; with none at all the stream is 403 member_required (10-10).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const LIVE = process.env.STORE_LIVE === "1";
const A = process.env.SUPA_A_URL ?? `http://localhost:${Number(process.env.PW_PORT || 3203)}`;
const B = process.env.SUPA_B_URL ?? "";
const MED = "med-amlodipine";
const LIMIT_MS = 2000;

const created: string[] = [];

type Got = { at: number; data: string; id: string };
interface DoseEvent {
  type: string;
  session_id: string;
  data: { dose: { state: string; day: number } };
}

/** The page's received events of one type (other modules publish more per tick, e.g. question.updated). */
async function received(page: Page, type?: string): Promise<(Got & { event: DoseEvent })[]> {
  const got = await page.evaluate(() => (window as unknown as { __got: Got[] }).__got);
  return got.map((g) => ({ ...g, event: JSON.parse(g.data) as DoseEvent })).filter((g) => !type || g.event.type === type);
}

test.describe.configure({ mode: "serial" });
test.skip(!LIVE, "STORE_LIVE=1 only: run node scripts/db/multi-instance.mjs");

async function createSession(request: APIRequestContext, base: string, body: Record<string, unknown> = {}) {
  const res = await request.post(`${base}/api/session`, { data: body });
  expect(res.status(), await res.text()).toBe(201);
  const session = (await res.json()).session as { id: string; join_code: string; story_day: number };
  created.push(session.id);
  return session;
}

/**
 * The page's EventSource as the sandbox's own device: the cookies POST /api/session set on `request` (rp_session,
 * rp_member, rp_role: the creating device's judge row) go into the page's browser context, as a judge's browser has
 * them. A stream opened with no device cookie at all is 403 member_required since 10-10 (lib/family/gate.ts).
 * Cookies belong to the host, not the port, so the same cookies serve instance A and instance B.
 */
async function sameDevice(request: APIRequestContext, page: Page): Promise<void> {
  const { cookies } = await request.storageState();
  expect(cookies.map((c) => c.name)).toEqual(expect.arrayContaining(["rp_session", "rp_member", "rp_role"]));
  await page.context().addCookies(cookies);
}

async function tick(request: APIRequestContext, base: string, sessionId: string, body: Record<string, unknown>) {
  const res = await request.post(`${base}/api/doses?session=${sessionId}`, { data: { medication_id: MED, slot: "morning", ...body } });
  expect(res.ok(), `${res.status()} ${await res.text()}`).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  expect(B, "SUPA_B_URL is not set: start the two instances with node scripts/db/multi-instance.mjs").not.toBe("");
  for (const base of [A, B]) {
    const res = await request.get(`${base}/api/health`);
    expect(res.ok(), `${base} is not up`).toBeTruthy();
    expect((await res.json()).store, `${base} must run with STORE=supabase`).toBe("supabase");
  }
});

test.afterAll(async () => {
  // delete what this spec created (sessions cascade to every row, bus events included)
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key || !created.length) return;
  for (const id of created) {
    await fetch(`${url}/rest/v1/session?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
  }
});

test("a dose tick posted to instance A reaches an EventSource on instance B within 2 s", async ({ page, request }) => {
  const s = await createSession(request, A);
  // instance B reads the session instance A wrote
  const fromB = await request.get(`${B}/api/session?session=${s.id}`);
  expect(fromB.status()).toBe(200);
  expect((await fromB.json()).session.join_code).toBe(s.join_code);

  await sameDevice(request, page);
  await page.goto(`${B}/api/health`);
  await page.evaluate((sessionId) => {
    const w = window as unknown as { __got: Got[]; __open: number; __es: EventSource };
    w.__got = [];
    w.__open = 0;
    w.__es = new EventSource(`/api/events?session=${sessionId}`);
    w.__es.onopen = () => (w.__open += 1);
    w.__es.onmessage = (e) => w.__got.push({ at: Date.now(), data: e.data, id: e.lastEventId });
  }, s.id);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __open: number }).__open)).toBeGreaterThan(0);
  await page.waitForTimeout(300); // the stream has fixed its resume point

  const latencies: number[] = [];
  const states = ["taken", "missed", "taken", "unconfirmed", "taken"];
  for (let i = 0; i < states.length; i++) {
    const t0 = Date.now();
    await tick(request, A, s.id, { state: states[i], day: 29 });
    await expect.poll(async () => (await received(page, "dose.logged")).length, { timeout: 5000, intervals: [25] }).toBe(i + 1);
    const got = (await received(page, "dose.logged"))[i];
    expect(got.event).toMatchObject({ type: "dose.logged", session_id: s.id, data: { dose: { state: states[i], day: 29 } } });
    latencies.push(got.at - t0);
  }
  test.info().annotations.push({ type: "A→B latency ms", description: latencies.join(", ") });
  console.log(`[supa] dose tick A(${A}) -> EventSource on B(${B}): ${latencies.join(", ")} ms`);
  for (const ms of latencies) expect(ms).toBeLessThanOrEqual(LIMIT_MS);

  // ids are the session's own sequence, one per event of any type, in order, none twice
  await page.waitForTimeout(800);
  const ids = (await received(page)).map((g) => Number(g.id));
  for (let i = 1; i < ids.length; i++) expect(ids[i]).toBe(ids[i - 1] + 1);

  // and the data itself is shared: B's dose log has the last tick
  const doses = await (await request.get(`${B}/api/doses?session=${s.id}&from=29&to=29`)).json();
  expect(doses.doses.find((d: { medication_id: string }) => d.medication_id === MED).state).toBe("taken");
});

test("the phone page served by instance B shows a tick posted to instance A within 2 s", async ({ browser, request }) => {
  const s = await createSession(request, A, { story_day: 15 }); // seed: D15 morning tablet missed (tai chi)
  const context = await browser.newContext({ baseURL: B });
  await context.addCookies([{ name: "rp_session", value: s.id, url: B }]);
  const page = await context.newPage();
  await page.goto("/p/today");
  await expect(page.locator('[data-live="open"]').first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "missed");
  await page.waitForTimeout(500);

  const t0 = Date.now();
  await tick(request, A, s.id, { state: "taken" });
  await expect(page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken", { timeout: LIMIT_MS });
  console.log(`[supa] /p/today on B shows A's tick after ${Date.now() - t0} ms`);
  await context.close();
});

test("a stream that ends every 4 s on A comes back with Last-Event-ID and loses none of 10 ticks posted to B", async ({ page, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, B);
  await sameDevice(request, page);
  await page.goto(`${A}/api/health`);
  await page.evaluate((sessionId) => {
    const w = window as unknown as { __got: Got[]; __open: number; __es: EventSource };
    w.__got = [];
    w.__open = 0;
    w.__es = new EventSource(`/api/events?session=${sessionId}`);
    w.__es.onopen = () => (w.__open += 1);
    w.__es.onmessage = (e) => w.__got.push({ at: Date.now(), data: e.data, id: e.lastEventId });
  }, s.id);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __open: number }).__open)).toBeGreaterThan(0);
  await page.waitForTimeout(300);

  // 10 ticks over ~11 s: the stream on A ends at least twice in between (BUS_STREAM_MAX_MS=4000, retry 1 s)
  for (let i = 0; i < 10; i++) {
    await tick(request, B, s.id, { state: i % 2 ? "taken" : "missed", day: 30 + i });
    await page.waitForTimeout(1100);
  }
  await expect.poll(async () => (await received(page, "dose.logged")).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(10);
  await page.waitForTimeout(1500); // nothing extra arrives late
  const all = await received(page);
  const opens = await page.evaluate(() => (window as unknown as { __open: number }).__open);
  const days = all.filter((g) => g.event.type === "dose.logged").map((g) => g.event.data.dose.day);
  console.log(`[supa] stream on A reconnected ${opens - 1} time(s); received days ${days.join(",")}`);
  expect(opens).toBeGreaterThanOrEqual(3); // the stream really ended and came back
  expect(days).toEqual(Array.from({ length: 10 }, (_, i) => 30 + i)); // all ten, once each, in order
  const ids = all.map((g) => Number(g.id)); // every event of the session, across the reconnects
  for (let i = 1; i < ids.length; i++) expect(ids[i]).toBe(ids[i - 1] + 1);
});
