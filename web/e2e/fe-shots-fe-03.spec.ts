/**
 * Screenshots of the blood pressure screens rebuilt after the timeline draft's group 03 (web/progress/fe-03.md): one PNG
 * per screen state at 390x844 @2x in 华语, named by the draft's screen id, in FE_SHOTS_DIR/03/. The approach is
 * e2e/fe-shots.spec.ts's: not a test of looks, and never part of a default run: without FE_SHOTS_DIR every test here is
 * skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3810 npx playwright test e2e/fe-shots-fe-03.spec.ts
 *
 * The screens the draft draws come from the example account on the developer test clock (laid out on Mon 12 Oct 2026):
 * a reading on Monday and one on Friday make the week of 03-3a, the example's first week is 03-3b. The states the draft
 * does not draw (no readings yet, the doctor's plan due now, a sentence he has not confirmed, yesterday's reading,
 * English) come from a blank account with a visit recorded through the transcript stand-in (SPEECH_PROVIDER=devfake).
 * Two tests need a production build: the states without a network (`next dev` reloads a page that loses its
 * connection), and the page while it opens and when it could not be opened (the loading screen is shown from the tab
 * link's prefetch, which only a production build does). The last test is the same page in a laptop's window
 * (1280x800, names 03-x-desk-*): the phone's column in the middle, the undo strip and the tab bar inside it.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function tick(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/dev/tick", { data: {} });
  expect(res.status()).toBe(200);
}

async function phone(browser: Browser, locale: "zh-CN" | "en-SG" = "zh-CN"): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale, timezoneId: "Asia/Singapore" });
}

async function account(context: BrowserContext, space: "example" | "blank" = "example"): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space } });
  expect(res.status(), await res.text()).toBe(201);
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function picture(page: Page, id: string): Promise<void> {
  const out = path.join(DIR!, "03");
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits on the tab bar
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) {
    // the whole page without what is fixed at the bottom (those bars are on the phone-sized picture)
    const hide = await page.addStyleTag({ content: ".rpu-tabs, .rpu-say, .rpu-typedock, .rpu-toast[data-placement='fixed'] { display: none !important; }" });
    await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
    await hide.evaluate((el) => (el as Element).remove());
  }
}

/**
 * Every state that is photographed is first held to the page checks (e2e/_checks/page-checks.ts): text at least 18px,
 * targets at least 48px, AA contrast, no sideways scroll at 360px.
 */
async function shot(page: Page, id: string): Promise<void> {
  await expectPageChecks(page, { side: "elder" });
  await picture(page, id);
}

async function type(page: Page, digits: string): Promise<void> {
  const keypad = page.locator('[data-rp="bp-keypad"]');
  for (const d of digits) await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
}

async function openBp(page: Page, query = ""): Promise<void> {
  await page.goto(`/p/bp${query}`);
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
}

/** A visit recorded with the v1 transcript stand-in; `confirm`: he goes through its review and says every line is right. */
async function firstVisit(context: BrowserContext, confirm: boolean): Promise<void> {
  const start = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(start.status(), await start.text()).toBe(200);
  const visitId = ((await start.json()) as { visit: { id: string } }).visit.id;
  const job = await context.request.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": "v1" } });
  expect(job.status(), await job.text()).toBe(200);
  const jobId = ((await job.json()) as { job_id: string }).job_id;
  await expect.poll(async () => ((await (await context.request.get(`/api/asr/jobs/${encodeURIComponent(jobId)}`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe("done");
  const fin = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/finalize`, { data: { job_id: jobId } });
  expect(fin.status(), await fin.text()).toBe(200);
  if (!confirm) return;
  const view = ((await fin.json()) as { view: { lines: { id: string; role: string }[]; cards: { rows?: { itemId?: string }[] }[] } }).view;
  const mine = view.lines.filter((l) => l.role === "patient").map((l) => l.id);
  const items = Object.fromEntries(view.cards.flatMap((c) => (c.rows ?? []).map((r) => r.itemId).filter(Boolean)).map((id) => [id as string, "right"]));
  const conf = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/confirm`, { data: { mine, items } });
  expect(conf.status(), await conf.text()).toBe(200);
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("03 量血压：稿子画的八屏", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  // Monday's reading (the draft's 126/82 on the Monday of its week)
  await setClock(request, SGT("2026-10-12", "10:05"));
  expect((await context.request.post("/api/bp", { data: { systolic: 126, diastolic: 82 } })).status()).toBe(201);
  const page = await context.newPage();

  // Fri 16 Oct. 03-1: the keypad with 142 and 85 typed, the lower number's row is the one he is on
  await setClock(request, SGT("2026-10-16", "08:20"));
  await openBp(page);
  await page.getByTestId("bp-record-open").click();
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-mode", "record");
  await type(page, "14285");
  await shot(page, "03-1");

  // 03-2: after saving: his entry, the doctor's number next to it, the undo strip
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-reading", "142/85");
  await expect(page.getByTestId("bp-saved-undo").locator(".rpu-toast")).toBeVisible();
  await shot(page, "03-2");
  await expect(page.getByTestId("bp-saved-undo")).toHaveCount(0, { timeout: 16_000 });
  await shot(page, "03-2-after");

  // 03-5a: changing today's reading; 03-5b: deleted, the week with the undo strip
  await page.getByTestId("bp-change").click();
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-mode", "edit");
  await shot(page, "03-5a");
  await page.getByTestId("bp-delete").click();
  await expect(page.getByTestId("bp-undo").locator(".rpu-toast")).toBeVisible();
  await expect(page.getByTestId("bp-week")).toHaveAttribute("data-count", "1");
  await shot(page, "03-5b");
  await page.getByTestId("bp-undo").getByRole("button").click();
  await expect(page.getByTestId("bp-week")).toHaveAttribute("data-count", "2");

  // Sat 17 Oct 8:47. 03-4: Today's cell (the morning's medicine answered first, as in the draft)
  await setClock(request, SGT("2026-10-17", "08:47"));
  await tick(request);
  await page.goto("/p/today?remind=dose-morning");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 16_000 });
  await page.goto("/p/today");
  const cell = page.locator('[data-today-section="bp"]');
  await expect(cell.getByTestId("bp-section")).toBeVisible();
  await expect(cell.getByTestId("bp-cell-week")).toBeVisible({ timeout: 15_000 });
  await cell.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "03-4");

  // 03-3a: the week, two readings, today is Saturday
  await openBp(page);
  await expect(page.getByTestId("bp-week")).toHaveAttribute("data-count", "2");
  await shot(page, "03-3a");

  // 03-3b: back to the example's first week (the one with a reading that was not taken)
  for (let i = 0; i < 12 && (await page.getByTestId("bp-week").getAttribute("data-monday")) !== "2026-08-31"; i++) await page.getByTestId("bp-week-prev").click();
  await expect(page.getByTestId("bp-week")).toHaveAttribute("data-monday", "2026-08-31");
  await shot(page, "03-3b");
  await page.getByTestId("bp-week-next").click();
  await shot(page, "03-3b-next-week");

  // 03-6: a reading above the doctor's warning line (he confirmed that sentence in the example: 医生说)
  await setClock(request, SGT("2026-10-17", "20:00"));
  await openBp(page, "?do=record");
  await type(page, "18696");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved").getByTestId("threshold-relay")).toBeVisible();
  await shot(page, "03-6-confirmed");
  // the week keeps his doctor's words next to that reading for the day
  await page.getByTestId("bp-back").click();
  await expect(page.getByTestId("bp-today-relay")).toBeVisible();
  await shot(page, "03-6-week-same-day");
  await context.close();
});

test("03 稿子没画的：空的、医生安排的这次到点了、他还没认过的那句、补记昨天、English", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "09:00"));
  const context = await phone(browser);
  await account(context, "blank");
  const page = await context.newPage();

  // no readings, no number from a doctor yet
  await openBp(page);
  await expect(page.getByTestId("bp-no-target")).toBeVisible();
  await shot(page, "03-x-empty");
  await page.getByTestId("bp-record-open").click();
  await shot(page, "03-x-record-empty");
  // 「这次没量」
  await page.getByTestId("bp-skip").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-kind", "skipped");
  await shot(page, "03-x-skipped");
  await page.getByTestId("bp-back").click();
  await shot(page, "03-x-week-skipped");
  await page.getByTestId("bp-today-reading").click();
  await shot(page, "03-x-edit-skipped");
  await page.getByTestId("bp-delete").click();
  await expect(page.getByTestId("bp-today-empty")).toBeVisible();

  // his first visit, recorded and not gone through yet: a reading above the warning line gets 「好像是医生说的」
  await setClock(request, SGT("2026-10-12", "09:30"));
  await firstVisit(context, false);
  await setClock(request, SGT("2026-10-12", "20:10"));
  await openBp(page, "?do=record");
  await type(page, "18696");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-reading", "186/96");
  await expect(page.getByTestId("bp-saved").getByTestId("threshold-relay")).toHaveAttribute("data-state", "inferred");
  await shot(page, "03-6");
  await context.close();

  // the doctor's plan (「measure at home for one week, morning and evening」) he confirmed: due at 8:00 the next morning
  await setClock(request, SGT("2026-10-12", "09:00"));
  const planned = await phone(browser);
  await account(planned, "blank");
  await setClock(request, SGT("2026-10-12", "09:30"));
  await firstVisit(planned, true);
  await setClock(request, SGT("2026-10-13", "08:00"));
  await request.post("/api/dev/tick", { data: { names: ["daily.bp"] } });
  const pp = await planned.newPage();
  await pp.goto("/p/today");
  await expect(pp.getByTestId("bp-part-morning")).toHaveAttribute("data-state", "due");
  await expect(pp.getByTestId("bp-cell-how")).toBeVisible({ timeout: 15_000 });
  await pp.locator('[data-today-section="bp"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(pp, "03-4-due");
  await openBp(pp);
  await expect(pp.getByTestId("bp-due")).toBeVisible();
  await shot(pp, "03-x-due");
  await pp.getByTestId("bp-record-open").click();
  await type(pp, "14288");
  await pp.getByTestId("bp-save").click();
  await expect(pp.getByTestId("bp-saved")).toHaveAttribute("data-reading", "142/88");
  await expect(pp.getByTestId("bp-saved-undo")).toHaveCount(0, { timeout: 16_000 });
  await pp.getByTestId("bp-back").click();
  await shot(pp, "03-x-week-plan-done");

  // a reading from yesterday
  await pp.getByTestId("bp-yesterday-open").click();
  await expect(pp.getByTestId("page-bp-yesterday")).toBeVisible();
  await shot(pp, "03-x-yesterday-which");
  await pp.getByTestId("bp-yesterday-evening").click();
  await type(pp, "13884");
  await shot(pp, "03-x-yesterday-typing");
  await pp.getByTestId("bp-save").click();
  await expect(pp.getByTestId("bp-yesterday-saved")).toHaveAttribute("data-reading", "138/84");
  await shot(pp, "03-x-yesterday-saved");

  // English
  await openBp(pp, "?lang=en");
  await shot(pp, "03-x-week-en");

  // a reading from yesterday above the doctor's warning line (he confirmed that sentence here): the same red card and
  // words as for a reading of today, his entry on the same line, no tab bar
  await pp.goto("/p/bp?when=yesterday");
  await pp.getByTestId("bp-yesterday-morning").click();
  await type(pp, "18696");
  await pp.getByTestId("bp-save").click();
  await expect(pp.getByTestId("bp-yesterday-saved").getByTestId("threshold-relay")).toHaveAttribute("data-state", "confirmed");
  await shot(pp, "03-x-yesterday-relay");
  await planned.close();
});

test("03 没网：已记下（等连网）、没有记上", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  await setClock(request, SGT("2026-10-13", "10:46"));
  const page = await context.newPage();
  await openBp(page);
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
  await context.setOffline(true);
  await expect(page.getByTestId("offline-line")).toBeVisible();
  await shot(page, "03-x-offline-week");
  await page.getByTestId("bp-record-open").click();
  await type(page, "13882");
  await shot(page, "03-x-offline-record");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-reading", "138/82");
  await expect(page.getByTestId("outbox-waiting")).toBeVisible();
  await shot(page, "03-x-offline-saved");
  await context.setOffline(false);
  await expect(page.getByTestId("offline-note")).toHaveCount(0, { timeout: 30_000 });

  // a reading that waited on the phone for more than a day is not taken by the server (409 too_late): it stays on the
  // page as 「没有记上」 with the reason, until he taps 「知道了」
  await openBp(page);
  await context.setOffline(true);
  await expect(page.getByTestId("offline-line")).toBeVisible();
  await page.getByTestId("bp-record-open").click();
  await type(page, "14186");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("outbox-waiting")).toBeVisible();
  await setClock(request, SGT("2026-10-16", "10:30"));
  await context.setOffline(false);
  await expect(page.getByTestId("outbox-refused")).toBeVisible({ timeout: 30_000 });
  await openBp(page);
  await expect(page.getByTestId("outbox-refused")).toBeVisible();
  await shot(page, "03-x-refused");
  await page.getByTestId("outbox-put-away").click();
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
  await context.close();
});

test("03 打开中和打不开", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });

  // slow to open (app/p/bp/loading.tsx): the tab's link already holds the page's loading screen (a production build
  // prefetches it); the page's own answer is held back here until both pictures are taken. Nothing in the app is changed
  const page = await context.newPage();
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toBeVisible();
  await page.waitForLoadState("networkidle");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  const isBp = (url: URL) => url.pathname === "/p/bp";
  await page.route(isBp, async (route) => {
    await held;
    await route.continue();
  });
  await page.locator('.rpu-tabs a[href="/p/bp"]').click();
  await expect(page.getByTestId("page-bp-loading")).toBeVisible();
  await shot(page, "03-x-loading");
  await expect(page.getByTestId("bp-loading-slow")).toBeVisible({ timeout: 10_000 });
  await shot(page, "03-x-loading-slow");
  release();
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-scope", "account", { timeout: 15_000 });
  await page.unroute(isBp);
  await page.close();

  // could not be drawn (app/p/bp/error.tsx): in this browser only, the page's own step after /p/bp?do=record (it puts
  // the address back to /p/bp) is made to fail, once, so the page's error screen takes over. Once: the router writes
  // the same address itself right after, outside any error screen of the app
  const broken = await context.newPage();
  await broken.addInitScript(() => {
    const original = window.history.replaceState;
    let failed = false;
    window.history.replaceState = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      if (!failed && url === "/p/bp") {
        failed = true;
        throw new Error("fe-shots: the blood pressure page is made to fail here");
      }
      return original.call(this, data, unused, url);
    };
  });
  await broken.goto("/p/bp?do=record");
  await expect(broken.getByTestId("store-unavailable")).toBeVisible();
  await expect(broken.getByTestId("store-unavailable-retry")).toBeVisible();
  await shot(broken, "03-x-error");
  await context.close();
});

test("03 电脑上：中间一列，撤销条和标签栏在列里", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:05"));
  // a laptop's window (app/desktop.css: from 720px up every phone page is one column, 430px wide)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  expect((await context.request.post("/api/bp", { data: { systolic: 126, diastolic: 82 } })).status()).toBe(201);
  await setClock(request, SGT("2026-10-16", "08:20"));
  const page = await context.newPage();
  await openBp(page);
  await picture(page, "03-x-desk-week");
  await page.getByTestId("bp-record-open").click();
  await type(page, "14285");
  await picture(page, "03-x-desk-record");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved-undo").locator(".rpu-toast")).toBeVisible();
  // the column, the tab bar and the undo strip are one box: [left, width]
  const boxes = await page.evaluate(() =>
    [".rpu-screen", ".rpu-tabs", ".rpu-toast"].map((selector) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? [Math.round(r.left), Math.round(r.width)] : null;
    }),
  );
  expect(boxes[0]?.[1]).toBe(430);
  expect(boxes[1]).toEqual(boxes[0]);
  expect(boxes[2]).toEqual(boxes[0]);
  await picture(page, "03-x-desk-saved");
  await context.close();
});
