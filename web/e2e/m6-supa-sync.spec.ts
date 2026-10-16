/**
 * M6 "a change reaches an open /f", measured under STORE=supabase across two server instances (runs only with
 * STORE_LIVE=1 and SUPA_B_URL set; skipped in the normal e2e run, which uses the in-memory store and keeps 1 s there,
 * e2e/m6-family.spec.ts).
 *
 * The limit here is 2 s for this wave (LIMIT_MS): with the database in Tokyo, switching a section on was measured at
 * p90 about 2.1-2.2 s on one instance (her page re-reads GET /api/family/view, 4-5 round trips of about 190 ms), and
 * Gengyue accepted 2 s on 10-10 until real accounts and a Singapore database come. Switching off stays under 1 s.
 *
 * Mr Tan's phone is served by instance A (SUPA_A_URL, default http://localhost:$PW_PORT), Wei Ling's /f by instance
 * B (SUPA_B_URL), both `next start` with STORE=supabase on the same database, so a switch goes: his tap -> A ->
 * Supabase (family_grant row + the bus table) -> B's event stream -> her page. Each switch is timed from his tap to
 * the change on her page; every one must be under LIMIT_MS. Three rounds of eight switches are logged with p50 / p90.
 *
 * How to run (takes web/.e2e-lock, builds once, starts A on 3203 and B on 3213):
 *   1. npx next build
 *   2. STORE=supabase npx next start -p 3203   and   STORE=supabase npx next start -p 3213
 *   3. STORE_LIVE=1 SUPA_B_URL=http://localhost:3213 PW_PORT=3203 npx playwright test e2e/m6-supa-sync.spec.ts
 * The deploy shape (one always-on server) is the same spec with A = B: one `STORE=supabase next start -p 3221`,
 * then STORE_LIVE=1 SUPA_B_URL=http://localhost:3221 PW_PORT=3221. There the bus hands a stored event straight to
 * the instance's own streams (lib/bus.ts Tail.offer), so no poll sits in the path.
 * The sessions it creates are deleted afterwards (REST, service key from web/.env; nothing is printed).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { waitLive } from "./helpers";

const LIVE = process.env.STORE_LIVE === "1" && !!process.env.SUPA_B_URL;
const A = process.env.SUPA_A_URL ?? `http://localhost:${Number(process.env.PW_PORT || 3203)}`;
const B = process.env.SUPA_B_URL ?? "";
const created: string[] = [];
/** each change is waited for up to 5 s so every one is measured; the limit is checked on the numbers after */
const MEASURE_MS = 5000;
/** this wave's limit under STORE=supabase (Tokyo database): 2 s, accepted by Gengyue on 10-10 (memory store: 1 s) */
const LIMIT_MS = 2000;

test.describe.configure({ mode: "serial" });
test.skip(!LIVE, "STORE_LIVE=1 and SUPA_B_URL only (two next start instances with STORE=supabase)");

test.beforeAll(async ({ request }) => {
  for (const base of [A, B]) {
    const res = await request.get(`${base}/api/health`);
    expect(res.ok(), `${base} is not up`).toBeTruthy();
    expect((await res.json()).store, `${base} must run with STORE=supabase`).toBe("supabase");
  }
});

test.afterAll(async () => {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key || !created.length) return;
  for (const id of created) {
    // sessions cascade to every row, bus events included; the answer lists the deleted row, so a miss is visible
    const res = await fetch(`${url}/rest/v1/session?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}`, Prefer: "return=representation" },
    });
    expect(res.ok, `delete session ${id}: HTTP ${res.status}`).toBe(true);
    expect(((await res.json()) as unknown[]).length, `delete session ${id}`).toBe(1);
  }
});

async function device(browser: Browser, base: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: base });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

test("STORE=supabase, his phone on A and her /f on B: every switch reaches her page within 2 s (measured)", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const res = await request.post(`${A}/api/session`, { data: { story_day: 29 } });
  expect(res.status(), await res.text()).toBe(201);
  const s = (await res.json()).session as { id: string; join_code: string };
  created.push(s.id);
  // B reads the session A wrote
  expect((await request.get(`${B}/api/session?session=${s.id}`)).status()).toBe(200);

  // his phone joins with the code as the patient (member row + cookies), as on the shoot: once she has joined, a device
  // with no row in his session is nobody, and only his row changes the switches (lib/family/identity.ts, role.ts)
  const phone = await device(browser, A);
  const joinHim = await phone.page.context().request.post(`${A}/api/session/join`, { data: { code: s.join_code, role: "patient" } });
  expect(joinHim.status(), await joinHim.text()).toBe(200);
  await phone.page.goto("/p/family");
  await waitLive(phone.page);
  const family = await device(browser, B);
  const join = await family.page.context().request.post(`${B}/api/session/join`, { data: { code: s.join_code, role: "family" } });
  expect(join.status(), await join.text()).toBe(200);
  await family.page.goto("/f");
  await waitLive(family.page);
  const fp = family.page;
  await expect(fp.getByTestId("family-doses")).toBeVisible();

  async function waitOnPage(condition: string): Promise<void> {
    await fp.waitForFunction(condition, null, { polling: "raf", timeout: MEASURE_MS });
  }

  async function flip(key: string, check: () => Promise<void>): Promise<number> {
    const sw = phone.page.getByTestId(`grant-${key}`);
    const before = await sw.getAttribute("data-on");
    const t0 = Date.now();
    await sw.click();
    await check();
    const ms = Date.now() - t0;
    await expect(sw).toHaveAttribute("data-on", before === "true" ? "false" : "true");
    return ms;
  }

  const all: number[] = [];
  const rounds: Record<string, number>[] = [];
  for (let round = 0; round < 3; round += 1) {
    const t: Record<string, number> = {};
    // her page is checked every animation frame (not Playwright's 100/250/500/1000 ms assertion retries), so the
    // numbers are the real delay
    const gone = (id: string) => () => waitOnPage(`!document.querySelector('[data-testid="${id}"]')`);
    const shown = (id: string, text = "") => () =>
      waitOnPage(`(() => { const el = document.querySelector('[data-testid="${id}"]'); return !!el && (el.textContent ?? "").includes(${JSON.stringify(text)}); })()`);
    t.dose_off = await flip("dose_summary", gone("family-doses"));
    t.dose_on = await flip("dose_summary", shown("family-doses"));
    t.notes_on = await flip("notes", shown("family-notes", "我今天好累。"));
    t.notes_off = await flip("notes", gone("family-notes"));
    t.bp_off = await flip("bp_summary", gone("family-bp"));
    t.bp_on = await flip("bp_summary", shown("family-bp"));
    t.transcripts_on = await flip("visit_transcripts", shown("family-visits", "At home, we want it below 135 over 85."));
    t.transcripts_off = await flip("visit_transcripts", gone("family-visits"));
    rounds.push(t);
    all.push(...Object.values(t));
  }
  console.log(`[m6-supa] switch on A -> /f on B, ms: ${JSON.stringify(rounds)}`);
  console.log(`[m6-supa] n=${all.length} p50=${pct(all, 50)} ms p90=${pct(all, 90)} ms max=${Math.max(...all)} ms`);
  // where the time goes: the refetch her page makes after a switch is turned on (GET /api/family/view on B)
  const viewMs: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = Date.now();
    expect((await request.get(`${B}/api/family/view?session=${s.id}`)).status()).toBe(200);
    viewMs.push(Date.now() - t0);
  }
  console.log(`[m6-supa] GET /api/family/view on B, ms: ${JSON.stringify(viewMs)}`);
  // and the first half of every switch: his tap's POST /api/family/grants on A (questions_count off, on, off, on: it
  // ends where the seed has it)
  const postMs: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const t0 = Date.now();
    const r = await phone.page.context().request.post(`${A}/api/family/grants?session=${s.id}`, { data: { items: { questions_count: i % 2 === 1 } } });
    expect(r.status(), await r.text()).toBe(200);
    postMs.push(Date.now() - t0);
  }
  console.log(`[m6-supa] POST /api/family/grants on A (his phone), ms: ${JSON.stringify(postMs)}`);
  for (const [i, t] of rounds.entries()) for (const [what, ms] of Object.entries(t)) expect.soft(ms, `round ${i + 1} ${what}: ${ms} ms`).toBeLessThan(LIMIT_MS);
  // the switches are in the database: a fresh read on B agrees with his phone
  const onB = (await (await request.get(`${B}/api/family/grants?session=${s.id}`)).json()) as { items: Record<string, boolean> };
  expect(onB.items).toMatchObject({ dose_summary: true, bp_summary: true, notes: false, visit_transcripts: false });
  await phone.close();
  await family.close();
});
