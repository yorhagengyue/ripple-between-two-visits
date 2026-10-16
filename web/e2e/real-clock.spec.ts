/**
 * Track B, second round, on a real account (C2; real-app 2.7, 6.3, 6.5, 8.3 real/today.spec 「拨到第二天，页头换成新日期，
 * 没有刷新也换」): what the read-only check of the code against the design found, end to end on the elder screens.
 *
 *   the day's clock   one page stays open (blood pressure, not Today); the clock moves to 08:45 and the reminder that is
 *                     due appears on it; the clock moves past his midnight and the header's date changes: no reload
 *   one sound         her reminder is playing; starting the doctor's clip on the same page stops it
 *   the brief         opening 「给医生看」 keeps the page as shown; 「上次给医生看的那一页」 opens it again with the same
 *                     numbers after he logged something new
 *   Today             「Wei Ling 会看到：今天吃了」 stays with the folded row while she can see; a medicine waiting for
 *                     its label has 「拍一下新药的药袋」 with its id; a follow-up from the doctor's words is 「大约 …」 and
 *                     he can set the day he booked
 *
 * Both clocks move together, as real-app 6.3 says: the server's developer test clock (POST /api/dev/clock) and the
 * browser's (Playwright's page.clock). Run against PW_PORT with SPEECH_PROVIDER=devfake.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function account(context: BrowserContext, space: "example" | "blank"): Promise<string> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `b${randomUUID().slice(0, 12)}`, password: "a long test password", space } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { user_id: string }).user_id;
}

/** Both clocks to the same moment: the server's test clock, and the open page's own (timers due by then fire once). */
async function moveBoth(request: APIRequestContext, page: Page, at: string): Promise<void> {
  await setClock(request, at);
  const ahead = Date.parse(at) - (await page.evaluate(() => Date.now()));
  expect(ahead).toBeGreaterThan(0);
  await page.clock.fastForward(ahead);
}

/** A visit recorded with a transcript stand-in and confirmed line by line through the visit API. */
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

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("one page stays open: the reminder comes at 08:45 on the blood pressure page, the date rolls over at his midnight, no reload", async ({ browser, request }) => {
  // laid out Mon 12 Oct 10:00 (d0 Mon 31 Aug): Tuesday's morning window is his, 08:45 / 09:15 / 09:45
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context, "example");
  await setClock(request, SGT("2026-10-13", "08:40"));
  const page = await context.newPage();
  // the browser's clock is the server's: installed before the page loads, running on from 08:40
  await page.clock.install({ time: new Date(SGT("2026-10-13", "08:40")) });
  await page.goto("/p/bp");
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("elder-meta")).toContainText("10月13日 周二");
  await expect(page.getByTestId("day-clock")).toHaveAttribute("data-date", "2026-10-13");
  await expect(page.getByTestId("due-reminder")).toHaveCount(0);
  // a mark only a reload would lose
  await page.evaluate(() => {
    (window as unknown as { __kept?: string }).__kept = "the same page";
  });
  const kept = () => page.evaluate(() => (window as unknown as { __kept?: string }).__kept ?? null);

  // 08:45:30: the first reminder is due; the open page shows it by itself
  await moveBoth(request, page, "2026-10-13T08:45:30+08:00");
  const due = page.getByTestId("due-reminder");
  await expect(due).toBeVisible();
  await expect(due).toHaveAttribute("data-slot", "morning");
  await expect(due).toHaveAttribute("data-stretch", "1");
  await expect(page.getByTestId("due-reminder-words")).toHaveText("早上的药 · 还没记");
  // her words and whose voice it is, as on Today; no medicine name, no dose anywhere in the strip
  await expect(due.getByTestId("her-reminder")).toBeVisible();
  await expect(due).not.toContainText(/amlodipine|5 ?mg/i);
  await expect(page.getByTestId("due-reminder-go")).toHaveAttribute("href", "/p/today?remind=dose-morning");
  expect(await kept()).toBe("the same page");
  await expectPageChecks(page, { side: "elder" });

  // 09:15:30: the second reminder, still without a reload
  await moveBoth(request, page, "2026-10-13T09:15:30+08:00");
  await expect(due).toHaveAttribute("data-stretch", "2");
  expect(await kept()).toBe("the same page");

  // he answers (on another phone, here through the API): the strip goes by itself
  const taken = await context.request.post("/api/doses", { data: { medication_id: "med-amlodipine", slot: "morning", state: "taken" } });
  expect(taken.status(), await taken.text()).toBe(200);
  await expect(due).toHaveCount(0);
  expect(await kept()).toBe("the same page");

  // his midnight: the header says the new day, the page is still the same page
  await moveBoth(request, page, "2026-10-14T00:00:30+08:00");
  await expect(page.getByTestId("elder-meta")).toContainText("10月14日 周三");
  await expect(page.getByTestId("day-clock")).toHaveAttribute("data-date", "2026-10-14");
  expect(await kept()).toBe("the same page");
  // yesterday's reading list is "earlier" now: today has none
  await expect(page.getByTestId("bp-today-empty")).toBeVisible();

  // and the next morning's reminder comes on the new day too
  await moveBoth(request, page, "2026-10-14T08:45:30+08:00");
  await expect(page.getByTestId("due-reminder")).toHaveAttribute("data-slot", "morning");
  expect(await kept()).toBe("the same page");

  // the strip keeps off Today (it has the reminder itself), the visit pages and the page in the doctor's hands
  await page.getByTestId("due-reminder-go").click();
  await page.waitForURL("**/p/today?remind=dose-morning");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-day", "2026-10-14");
  await expect(page.getByTestId("her-reminder")).toHaveCount(1);
  await expect(page.getByTestId("due-reminder")).toHaveCount(0);
  await page.goto("/p/visit");
  await expect(page.getByTestId("due-reminder")).toHaveCount(0);
  await page.goto("/p/brief?show=doctor");
  await expect(page.getByTestId("brief-doctor")).toBeVisible();
  await expect(page.getByTestId("due-reminder")).toHaveCount(0);
  // any other page of his has it: the question list
  await page.goto("/p/questions");
  await expect(page.getByTestId("due-reminder")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});

test("Today with both clocks (real-app 8.3): the reminder comes at 08:45 by itself, 吃了 keeps its undo bar 12 seconds, the header changes day at midnight", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context, "example");
  await setClock(request, SGT("2026-10-13", "08:40"));
  const page = await context.newPage();
  await page.clock.install({ time: new Date(SGT("2026-10-13", "08:40")) });
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-day", "2026-10-13");
  await expect(page.getByTestId("elder-meta")).toContainText("10月13日 周二");
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "coming");
  await expect(page.getByTestId("her-reminder")).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __kept?: string }).__kept = "the same page";
  });
  const kept = () => page.evaluate(() => (window as unknown as { __kept?: string }).__kept ?? null);

  // 08:45:30: the page shows the reminder (her clip, the slot first) without a reload; the strip is not on Today
  await moveBoth(request, page, "2026-10-13T08:45:30+08:00");
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "due");
  await expect(page.getByTestId("her-reminder")).toHaveCount(1);
  await expect(page.getByTestId("due-reminder")).toHaveCount(0);
  await expect(page.getByTestId("elder-meta")).toContainText("早上 8:45");
  expect(await kept()).toBe("the same page");

  // 吃了: the undo bar stays 12 seconds (11 s: still there; 13 s: gone), and the row is folded
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("undo-toast")).toHaveCount(1);
  await page.clock.fastForward(11_000);
  await expect(page.getByTestId("undo-toast")).toHaveCount(1);
  await page.clock.fastForward(2_000);
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);
  await expect(page.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
  expect(await kept()).toBe("the same page");

  // his midnight on Today: the new date in the header and a new day's medicine, no reload
  await moveBoth(request, page, "2026-10-14T00:00:30+08:00");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-day", "2026-10-14");
  await expect(page.getByTestId("elder-meta")).toContainText("10月14日 周三");
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "coming");
  expect(await kept()).toBe("the same page");
  await context.close();
});

test("one sound at a time: her reminder stops when the doctor's clip starts on the same page", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context, "example");
  await setClock(request, SGT("2026-10-13", "08:46"));
  const page = await context.newPage();
  await page.goto("/p/bp");
  const her = page.getByTestId("due-reminder").getByTestId("her-reminder");
  await expect(her).toBeVisible();
  // her clip keeps going until something stops it (the test must not race its few seconds)
  await her.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.loop = true;
  });
  if ((await her.getAttribute("data-state")) !== "playing") await page.getByTestId("her-reminder-play").click();
  await expect(her).toHaveAttribute("data-state", "playing");
  const playing = () => page.evaluate(() => [...document.querySelectorAll("audio")].filter((a) => !a.paused && !a.ended).length);
  expect(await playing()).toBe(1);

  // the doctor's own words on the blood pressure page have a clip: starting it stops hers
  const doctor = page.getByTestId("bp-target").locator('[data-rp="listen"] button').first();
  await expect(doctor).toBeVisible();
  await doctor.click();
  await expect(her).not.toHaveAttribute("data-state", "playing");
  await expect.poll(async () => her.locator("audio").evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  expect(await playing()).toBeLessThanOrEqual(1);
  // and hers again stops the doctor's
  await page.getByTestId("her-reminder-play").click();
  await expect(her).toHaveAttribute("data-state", "playing");
  expect(await playing()).toBe(1);
  await context.close();
});

test("the brief is kept as it was shown: 「给医生看」 records it, 「上次给医生看的那一页」 opens the same numbers again", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context, "example");
  await setClock(request, SGT("2026-10-12", "10:05"));
  const page = await context.newPage();
  await page.goto("/p/brief");
  await expect(page.getByTestId("page-brief")).toHaveAttribute("data-day", "2026-10-12");
  await expect(page.getByTestId("brief-last-shown")).toHaveCount(0);
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "10");

  await page.getByTestId("brief-show-doctor").click();
  await expect(page.getByTestId("brief-doctor")).toHaveAttribute("data-kept", "false");
  await expect(page.getByTestId("brief-shown")).toHaveAttribute("data-shown", "kept");
  const version = await page.getByTestId("brief-shown").getAttribute("data-version");
  expect(version).toMatch(/^[0-9a-f]{12}$/);
  await page.getByTestId("brief-doctor-done").click();
  await page.waitForURL("**/p/brief");
  const last = page.getByTestId("brief-last-shown");
  await expect(last).toContainText("上次给医生看的那一页");
  await expect(last).toContainText("10月12日 周一 · 早上 10:05");
  await expectPageChecks(page, { side: "elder" });

  // he logs a reading afterwards: today's brief has 11, the page he showed still has 10
  await setClock(request, SGT("2026-10-12", "11:00"));
  const reading = await context.request.post("/api/bp", { data: { systolic: 150, diastolic: 95 } });
  expect(reading.status(), await reading.text()).toBe(201);
  await page.goto("/p/brief");
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "11");
  await page.getByTestId("brief-last-shown").locator("a").click();
  await page.waitForURL("**/p/brief?shown=*");
  await expect(page.getByTestId("brief-doctor")).toHaveAttribute("data-kept", "true");
  await expect(page.getByTestId("brief-kept-note")).toContainText("这是 10月12日 周一 · 早上 10:05 给医生看的那一页");
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "10");
  // a kept page records nothing again
  await expect(page.getByTestId("brief-shown")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});

test("Today keeps 「Wei Ling 会看到」 with the folded row; a new medicine asks for its bag with its id; the follow-up is 「大约 …」 until he sets the day", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const him = await browser.newContext();
  await account(him, "example");
  const her = await browser.newContext();
  const made = await her.request.post("/api/dev/accounts", { data: { login: `w${randomUUID().slice(0, 12)}`, password: "a long test password", space: "none", display_name: "Wei Ling", locale: "zh-Hans" } });
  expect(made.status(), await made.text()).toBe(201);
  const invite = await him.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const inv = (await invite.json()) as { path: string; link: { id: string } };
  expect((await her.request.post("/api/family/invites/accept", { data: { token: inv.path.replace(/^\/invite\//, "") } })).ok()).toBe(true);
  expect((await him.request.post(`/api/family/links/${inv.link.id}/confirm`, { data: { yes: true } })).ok()).toBe(true);
  const grant = (items: Record<string, boolean>) => him.request.post(`/api/family/links/${inv.link.id}/grants`, { data: { items } });
  expect((await grant({ dose_summary: true })).ok()).toBe(true);

  // Tue 13 Oct 08:50: 吃了; the row folds; her line is still there when he opens Today again
  await setClock(request, SGT("2026-10-13", "08:50"));
  const page = await him.newPage();
  await page.goto("/p/today");
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(page.getByTestId("dose-done-rows")).toContainText("Wei Ling 会看到：今天吃了");
  await setClock(request, SGT("2026-10-13", "09:30"));
  await page.goto("/p/today");
  await expect(page.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
  await expect(page.getByTestId("dose-her-eyes")).toHaveText("Wei Ling 会看到：今天吃了");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });
  // he switches 「吃药」 off: nobody sees it, the line is gone
  expect((await grant({ dose_summary: false })).ok()).toBe(true);
  await page.goto("/p/today");
  await expect(page.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
  await expect(page.getByTestId("dose-her-eyes")).toHaveCount(0);

  // a visit that day (the v3 transcript stand-in): losartan is prescribed and waits for its bag; "come back in six weeks"
  await setClock(request, SGT("2026-10-13", "10:00"));
  await recordVisit(him, "v3");
  await setClock(request, SGT("2026-10-13", "10:40"));
  await page.goto("/p/today");
  const row = page.getByTestId("new-med-label");
  await expect(row).toContainText("拍一下新药的药袋");
  await expect(row).toContainText("Losartan");
  const href = await row.locator("a").first().getAttribute("href");
  expect(href).toMatch(/^\/p\/meds\/add\?med=.+/);
  // the follow-up: six weeks after Tue 13 Oct is Tue 24 Nov, still the doctor's "about"
  const section = page.getByTestId("countdown-section");
  await expect(section).toHaveAttribute("data-approx", "true");
  await expect(page.getByTestId("countdown-when")).toHaveText("大约 11月24日");
  await expect(page.getByTestId("follow-up-set")).toHaveText("我约的日子");
  await expectPageChecks(page, { side: "elder" });

  // he booked Thu 26 Nov: the row opens track V's screen for it; back on Today the row says his day, without 「大约」
  await page.getByTestId("follow-up-day").locator("a").click();
  await page.waitForURL("**/p/visit?plan=*");
  await expect(page.getByTestId("visit-booking")).toBeVisible();
  await page.getByTestId("visit-book-date").fill("2026-11-26");
  await page.getByTestId("visit-book-save").click();
  await expect(page.getByTestId("visit-booking")).toHaveCount(0);
  await page.goto("/p/today");
  await expect(section).toHaveAttribute("data-approx", "false");
  await expect(page.getByTestId("countdown-when")).toHaveText("11月26日 周四");
  await expect(page.getByTestId("follow-up-set")).toHaveText("改日子");
  await expectPageChecks(page, { side: "elder" });

  // the row opens the camera page for that medicine
  await row.locator("a").first().click();
  await page.waitForURL("**/p/meds/add?med=*");
  await him.close();
  await her.close();
});

test("no medicine to take yet, and the doctor prescribed one: the big button is 「拍一下新药的药袋」 for that medicine", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "09:00"));
  const context = await browser.newContext();
  await account(context, "blank");
  await setClock(request, SGT("2026-10-12", "09:30"));
  // the v2 transcript stand-in: "Amlodipine, 5 milligrams, one tablet every morning." and "Come back in five weeks."
  await recordVisit(context, "v2");
  await setClock(request, SGT("2026-10-12", "10:30"));
  const page = await context.newPage();
  await page.goto("/p/today");
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "no-meds");
  const button = page.getByTestId("dose-empty-label");
  await expect(button).toHaveText(/拍一下新药的药袋/);
  expect(await button.getAttribute("href")).toMatch(/^\/p\/meds\/add\?med=.+/);
  // five weeks after Mon 12 Oct: Mon 16 Nov
  await expect(page.getByTestId("countdown-when")).toHaveText("大约 11月16日");
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});
