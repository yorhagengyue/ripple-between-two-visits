/**
 * Screenshots for the owner of design group 14 「准备下次看诊」 rebuilt after the timeline draft (web/progress/fe-fe-14.md):
 * one PNG per screen state at 390x844 @2x, named by the draft's screen id, in FE_SHOTS_DIR/14/. Not a test of looks, and
 * never part of a default run: without FE_SHOTS_DIR every test here is skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3800 npx playwright test e2e/fe-shots-fe-14.spec.ts
 *
 * Each test makes its own account on the developer test clock (the example data laid out on Mon 12 Oct 2026, or a
 * blank account) and walks to the states the draft draws and the ones it left out. A screen longer than the phone is
 * also saved whole as <id>-full.png. The approach is e2e/fe-shots.spec.ts's.
 *
 * Names: 14-1a, 14-1b, 14-2, 14-3, 14-4, 14-5 are the draft's screens; 14-1-<state>, 14-2-<state>, 14-brief-<state> are
 * the states it did not draw. 14-3 (his words with their checked English) cannot be reached on an offline server (the
 * stand-in model translates nothing): its picture is the page for the doctor with the brief's own component drawn from
 * the same view plus the English a model would have given (see `translated` below); 14-5 is what the offline server
 * really shows.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { AccountBriefView } from "../lib/summary/account-brief";

// a development server compiles a route the first time it is opened: every wait here allows for that
const expect = baseExpect.configure({ timeout: 30_000 });

const DIR = process.env.FE_SHOTS_DIR?.trim();
const GROUP = "14";
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore", ...extra });
}

async function account(context: BrowserContext, space: "example" | "blank" = "example", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. `plain`: a page with scripts off. */
async function shot(page: Page, id: string, plain = false): Promise<void> {
  const out = path.join(DIR!, GROUP);
  mkdirSync(out, { recursive: true });
  if (plain) {
    // nothing can be run in the page: give its fonts a moment and take the picture
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, `${id}.png`) });
    return;
  }
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

/** A visit recorded with a transcript stand-in and confirmed line by line through the visit API (e2e/real-clock.spec.ts). */
async function recordVisit(context: BrowserContext, fixture: "v1" | "v2" | "v3"): Promise<string> {
  const start = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(start.status(), await start.text()).toBe(200);
  const visitId = ((await start.json()) as { visit: { id: string } }).visit.id;
  const job = await context.request.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } });
  expect(job.status(), await job.text()).toBe(200);
  const jobId = ((await job.json()) as { job_id: string }).job_id;
  await expect.poll(async () => ((await (await context.request.get(`/api/asr/jobs/${encodeURIComponent(jobId)}`)).json()) as { status: string }).status).toBe("done");
  const fin = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/finalize`, { data: { job_id: jobId } });
  expect(fin.status(), await fin.text()).toBe(200);
  const view = ((await fin.json()) as { view: { lines: { id: string; role: string }[]; cards: { rows?: { itemId?: string }[] }[] } }).view;
  const mine = view.lines.filter((l) => l.role === "patient").map((l) => l.id);
  const items = Object.fromEntries(view.cards.flatMap((c) => (c.rows ?? []).map((r) => r.itemId).filter(Boolean)).map((id) => [id as string, "right"]));
  const conf = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/confirm`, { data: { mine, items } });
  expect(conf.status(), await conf.text()).toBe(200);
  return visitId;
}

/** What a translating model would have given for the example's own words (the offline stand-in gives nothing). For the 14-3 picture only. */
const EXAMPLE_ENGLISH: Record<string, string> = {
  "我今天好累。": "I am very tired today.",
  "今天在大巴窑中心走了一圈，脚踝有点肿。": "Walked around Toa Payoh Central today. My ankle is a bit swollen.",
  "读数高的时候（例如 150/95）可以多吃一粒吗？": "When my reading is high (e.g. 150/95), can I take an extra tablet?",
  "膝盖止痛药还可以吃吗？": "Can I still take my knee painkiller?",
};

/**
 * 14-3 as it reads once his words have their checked English: the open page for the doctor, with the brief's blocks
 * drawn again by the brief's own component (BriefBody) from the view the server holds (GET /api/brief?lang=en) plus
 * `EXAMPLE_ENGLISH`. Only the picture: nothing is written to the account.
 */
async function translated(page: Page, context: BrowserContext): Promise<void> {
  const res = await context.request.get("/api/brief?locale=en");
  expect(res.status(), await res.text()).toBe(200);
  const view = ((await res.json()) as { brief: AccountBriefView }).brief;
  // the component imports its stylesheet; a test process has no loader for one and needs none (the page has the styles)
  require.extensions[".css"] ??= () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BriefBody } = require("../components/brief/AccountBrief") as typeof import("../components/brief/AccountBrief");
  const html = renderToStaticMarkup(createElement(BriefBody, { view: { ...view, english: { ...view.english, ...EXAMPLE_ENGLISH } }, locale: "en" }));
  await page.getByTestId("brief-body").evaluate((el, markup) => {
    el.outerHTML = markup;
  }, html);
  await expect(page.getByTestId("brief-english").first()).toBeVisible();
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("14 the example account: the question list and every change to it", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  // the example's one-time intro was put away earlier
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await context.newPage();
  await setClock(request, SGT("2026-10-12", "10:10"));
  const open = page.locator('[data-rp="questions-open"]');

  // 14-1a, 14-1b: the two sides of the list
  await page.goto("/p/questions");
  await expect(open).toBeVisible();
  await shot(page, "14-1a");
  await page.locator('[data-seg="pharmacist"]').click();
  await page.waitForURL("**/p/questions?for=pharmacist");
  await expect(page.locator('[data-rp="questions-answered"]')).toBeVisible();
  await shot(page, "14-1b");

  // adding: the empty form says what is missing; then his words, 「加上」, and the list says what happened
  await page.goto("/p/questions");
  await page.getByTestId("questions-add").click();
  await page.waitForURL("**/p/questions/add");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
  await shot(page, "14-1-add-empty");
  await page.getByTestId("question-text-input").fill("我可以去游泳吗？");
  await shot(page, "14-1-add");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("加上了。");
  await page.locator('[data-highlight="true"]').scrollIntoViewIfNeeded();
  await shot(page, "14-1-added");
  const swim = ((await (await context.request.get("/api/questions")).json()) as { list: { open: { id: string; text: string }[] } }).list.open.find((q) => q.text === "我可以去游泳吗？")!.id;

  // the same words again: no second row
  await page.getByTestId("questions-add").click();
  await page.getByTestId("question-text-input").fill("膝盖止痛药还可以吃吗");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("这个问题已经在单子上了。");
  await shot(page, "14-1-already-there");

  // a question the doctor answered before: he is shown the answer
  await page.getByTestId("questions-add").click();
  await page.getByTestId("question-text-input").fill("家里那个机器是绑手腕的，可以用吗？");
  await page.getByTestId("question-submit").click();
  await page.waitForURL("**/p/questions/answered?q=*");
  await expect(page.locator('[data-rp="questions-notice"]')).toBeVisible();
  await shot(page, "14-1-answered-before");

  // 「改一下字」
  await page.goto("/p/questions");
  await page.locator(`[data-rp="question-actions"][data-question="${swim}"] [data-action="edit"]`).click();
  await expect(page.getByTestId("question-text-input")).toHaveValue("我可以去游泳吗？");
  await shot(page, "14-1-edit");
  await page.getByTestId("question-text-input").fill("膝盖止痛药还可以吃吗？");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("改好了。");
  // the same words as the row above it now: 「合并」
  await expect(page.locator(`[data-rp="question-actions"][data-question="${swim}"] [data-action="merge"]`)).toBeVisible();
  await page.locator(`[data-rp="question-actions"][data-question="${swim}"]`).scrollIntoViewIfNeeded();
  await shot(page, "14-1-same-words");
  await page.locator(`[data-rp="question-actions"][data-question="${swim}"] [data-action="merge"]`).click();
  await expect(page.locator('[data-rp="toast"]')).toContainText("合并了");
  await shot(page, "14-1-merged-undo");
  await page.locator('[data-rp="toast"]').getByRole("button").click();
  await expect(page.locator(`[data-rp="questions-open"] [data-question="${swim}"][data-status]`)).toHaveCount(1);

  // 「这条不问了」 and the bar that undoes it; then the set-aside page and 「放回去」
  await page.locator(`[data-rp="question-actions"][data-question="${swim}"] [data-action="skip"]`).click();
  await expect(page.locator('[data-rp="toast"]')).toContainText("这条不问了");
  await shot(page, "14-1-skipped-undo");
  await page.goto("/p/questions/skipped");
  await expect(page.locator('[data-action="put-back"]')).toBeVisible();
  await shot(page, "14-1-skipped");
  await page.locator('[data-action="put-back"]').click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("这个问题放回单子上了。");
  await page.locator('[data-highlight="true"]').scrollIntoViewIfNeeded();
  await shot(page, "14-1-put-back");

  // every answered question on one page
  await page.goto("/p/questions/answered");
  await expect(page.locator('[data-rp="said"]').first()).toBeVisible();
  await shot(page, "14-1-answered");
  await page.goto("/p/questions/skipped");
  await expect(page.getByTestId("questions-skipped-none")).toBeVisible();
  await shot(page, "14-1-skipped-none");

  // in English
  await page.goto("/api/profile/lang?to=en&next=%2Fp%2Fquestions");
  await expect(open).toBeVisible();
  await shot(page, "14-1a-en");
  await page.goto("/p/questions/add");
  await expect(page.getByTestId("question-text-input")).toBeVisible();
  await shot(page, "14-1-add-en");
  await context.close();
});

test("14 the example account: the brief, the page for the doctor, the page kept as it was shown", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await context.newPage();
  await setClock(request, SGT("2026-10-12", "10:10"));

  // 14-2 on the day itself: 「今天看诊。」 and 「今天看医生 · 简报准备好了」
  await page.goto("/p/today");
  const cell = page.locator('[data-today-section="countdown"]');
  await expect(cell).toBeVisible();
  await cell.scrollIntoViewIfNeeded();
  await shot(page, "14-2-today");

  // his own brief (华语), then 14-5 / 14-4: the page he hands over, English first
  await page.getByTestId("countdown-brief").click();
  await expect(page.getByTestId("page-brief")).toBeVisible();
  await shot(page, "14-brief-own");
  await page.getByTestId("brief-show-doctor").click();
  const doctor = page.getByTestId("brief-doctor");
  await expect(doctor).toHaveAttribute("data-lang", "en");
  await expect(page.getByTestId("brief-shown")).toHaveAttribute("data-shown", "kept");
  await shot(page, "14-5");
  await translated(page, context);
  await shot(page, "14-3");
  await page.reload();
  await expect(doctor).toHaveAttribute("data-lang", "en");
  await page.getByTestId("brief-doctor-lang").click();
  await expect(doctor).toHaveAttribute("data-lang", "zh-Hans");
  await shot(page, "14-4");

  // 「看完了」: his brief has a row to the page he showed; it opens that page as it was
  await page.getByTestId("brief-doctor-done").click();
  await expect(page.getByTestId("brief-last-shown")).toBeVisible();
  await page.getByTestId("brief-last-shown").scrollIntoViewIfNeeded();
  await shot(page, "14-brief-last-shown");
  await page.getByTestId("brief-last-shown").locator("a").click();
  await expect(doctor).toHaveAttribute("data-kept", "true");
  await shot(page, "14-brief-kept");

  // a reading next to the doctor's warning line: its own card, with that line quoted
  await setClock(request, SGT("2026-10-12", "10:20"));
  expect((await context.request.post("/api/bp", { data: { id: randomUUID(), systolic: 185, diastolic: 112 } })).status()).toBe(201);
  await setClock(request, SGT("2026-10-12", "10:25"));
  await page.goto("/p/brief");
  await expect(page.getByTestId("brief-above")).toBeVisible();
  await page.getByTestId("brief-bp").scrollIntoViewIfNeeded();
  await shot(page, "14-brief-above");
  await page.goto("/p/brief?show=doctor");
  await expect(page.getByTestId("brief-above")).toBeVisible();
  await page.getByTestId("brief-bp").scrollIntoViewIfNeeded();
  await shot(page, "14-3-above");

  // his own brief in English
  await page.goto("/p/brief?lang=en");
  await expect(page.getByTestId("page-brief")).toBeVisible();
  await shot(page, "14-brief-own-en");
  await context.close();

  // while the brief is put together: the screen's header and quiet bars (what a browser shows before the page arrives)
  const slow = await phone(browser, { javaScriptEnabled: false });
  await setClock(request, SGT("2026-10-12", "10:00"));
  await account(slow);
  await slow.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const waiting = await slow.newPage();
  await waiting.goto("/p/brief");
  await expect(waiting.getByTestId("brief-loading")).toBeVisible();
  await shot(waiting, "14-brief-loading", true);
  await waiting.goto("/p/brief?show=doctor");
  await expect(waiting.getByTestId("brief-loading")).toBeVisible();
  await shot(waiting, "14-3-loading", true);
  await slow.close();

  // when the brief cannot be drawn: the screen says what happened, what still holds, and offers 「再试一次」. Nothing on
  // an offline server fails by itself, so one part of the brief is made to fail here (the doctor's recording cannot be
  // set up in this browser), which is what the brief's boundary is for
  const failing = await phone(browser);
  await failing.addInitScript(() => {
    const w = window as unknown as { __briefFails?: boolean };
    w.__briefFails = true;
    const listen = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function (this: HTMLMediaElement, ...args: Parameters<typeof listen>) {
      if (w.__briefFails) throw new Error("fe-shots: the brief is made to fail here");
      return listen.apply(this, args);
    } as typeof listen;
  });
  await setClock(request, SGT("2026-10-12", "10:00"));
  await account(failing);
  await failing.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const broken = await failing.newPage();
  await broken.goto("/p/brief");
  await expect(broken.getByTestId("brief-error")).toBeVisible();
  await shot(broken, "14-brief-error");
  // 「再试一次」 asks for the brief again, and this time it can be drawn
  await broken.evaluate(() => {
    (window as unknown as { __briefFails?: boolean }).__briefFails = false;
  });
  await broken.getByTestId("brief-error-retry").click();
  await expect(broken.getByTestId("page-brief")).toBeVisible();
  await failing.close();
});

test("14 a blank account: nothing to ask yet, no visit yet", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context, "blank");
  const page = await context.newPage();
  await page.goto("/p/questions");
  await expect(page.getByTestId("questions-add")).toBeVisible();
  await shot(page, "14-1-empty");
  await page.goto("/p/questions/answered");
  await expect(page.getByTestId("questions-answered-none")).toBeVisible();
  await shot(page, "14-1-answered-none");
  await page.goto("/p/brief");
  await expect(page.getByTestId("page-brief")).toBeVisible();
  await shot(page, "14-brief-empty");
  // one question for the pharmacist only: the doctor's side says there is none for the doctor
  expect((await context.request.post("/api/questions", { data: { text: "这两种药可以一起放在药盒里吗？", for: "pharmacist" } })).status()).toBe(201);
  await page.goto("/p/questions?for=doctor");
  await expect(page.getByTestId("questions-none-here")).toBeVisible();
  await shot(page, "14-1-none-for-doctor");
  await context.close();
});

test("14-2 the cell on Today: five days before the follow-up the doctor asked for, and the day he booked", async ({ browser, request }) => {
  // laid out Mon 12 Oct; a visit on Tue 13 Oct (the v3 transcript stand-in): "come back in six weeks" is about Tue 24 Nov
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context);
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await context.newPage();
  const cell = page.locator('[data-today-section="countdown"]');
  // the cell is on the day's overview: once the morning medicine is answered and its undo bar has gone
  const taken = async () => {
    await page.goto("/p/today");
    await page.getByTestId("dose-taken").click();
    await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
    await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 20_000 });
  };
  await setClock(request, SGT("2026-10-13", "08:50"));
  await taken();
  await setClock(request, SGT("2026-10-13", "10:00"));
  await recordVisit(context, "v3");

  // more than two weeks away: the date alone, 「大约」, and 「我约的日子」
  await setClock(request, SGT("2026-10-13", "10:40"));
  await page.goto("/p/today");
  await expect(page.getByTestId("countdown-section")).toHaveAttribute("data-approx", "true");
  await cell.scrollIntoViewIfNeeded();
  await shot(page, "14-2-far");

  // 14-2: Thu 19 Nov, five days before
  await setClock(request, SGT("2026-11-19", "08:50"));
  await taken();
  await setClock(request, SGT("2026-11-19", "09:30"));
  await page.goto("/p/today");
  await expect(page.getByTestId("countdown-section")).toHaveAttribute("data-days", "5");
  await cell.scrollIntoViewIfNeeded();
  await shot(page, "14-2");
  mkdirSync(path.join(DIR!, GROUP), { recursive: true });
  await cell.screenshot({ path: path.join(DIR!, GROUP, "14-2-cell.png") });

  // in English
  await page.goto("/p/today?lang=en");
  await expect(page.getByTestId("countdown-section")).toHaveAttribute("data-days", "5");
  await cell.scrollIntoViewIfNeeded();
  await cell.screenshot({ path: path.join(DIR!, GROUP, "14-2-cell-en.png") });

  // he booked Mon 23 Nov: his day, without 「大约」, and 「改日子」
  await page.goto("/p/today");
  await page.getByTestId("follow-up-day").locator("a").click();
  await page.waitForURL("**/p/visit?plan=*");
  await page.getByTestId("visit-book-date").fill("2026-11-23");
  await page.getByTestId("visit-book-save").click();
  await expect(page.getByTestId("visit-booking")).toHaveCount(0);
  await page.goto("/p/today");
  await expect(page.getByTestId("countdown-section")).toHaveAttribute("data-approx", "false");
  await cell.scrollIntoViewIfNeeded();
  await cell.screenshot({ path: path.join(DIR!, GROUP, "14-2-cell-booked.png") });
  await context.close();
});
