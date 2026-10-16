/**
 * Screenshots for the owner of the visit screens rebuilt after the timeline draft (web/progress/fe-05.md): one PNG per
 * screen of the draft's group 05, the two screens of group 06 that live on the visit pages, and 通用-2, at 390x844 @2x,
 * named by the draft's screen id, in FE_SHOTS_DIR/05/. A screen longer than the phone is also saved whole as
 * <id>-full.png. Not a test of looks, and never part of a default run: without FE_SHOTS_DIR every test here is
 * skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3760 npx playwright test e2e/fe-shots-05.spec.ts
 *
 * Needs the developer tools (test accounts, the test clock). The recording screens need the stand-in transcription
 * (SPEECH_PROVIDER=devfake); 05-3 (the recording waits for its text) needs a server with none (SPEECH_PROVIDER=mock):
 * each test skips itself on the other kind of server and says so.
 *
 * The screens the draft did not draw are here too, each named after the draft's screen it belongs with: 05-3-saving,
 * 05-3-making-text, 05-3-nothing-recorded, 05-3-not-finished, 05-9-not-sent-yet, 05-9-reopened, 05-9-reopened-nothing-
 * here, 05-9-booking, 通用-2-upload-failed, 通用-2-answer-not-saved (and 通用-2-decline-not-saved, 通用-2-no-microphone).
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const FAKE_MIC = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"];

test.use({ launchOptions: { args: FAKE_MIC } });
test.describe.configure({ mode: "serial", timeout: 420_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

let provider = "unknown";

async function setClock(request: APIRequestContext, at: string, frozen = true): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser, baseURL: string, lang: "zh-Hans" | "en" = "zh-Hans"): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang === "en" ? "en-SG" : "zh-CN", timezoneId: "Asia/Singapore", permissions: ["microphone"] });
  await context.addCookies([{ name: "rp_lang", value: lang, url: baseURL }]);
  return context;
}

async function account(context: BrowserContext, space: "example" | "blank", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, display_name: "陈先生", ...extra } });
  expect(res.status(), await res.text()).toBe(201);
}

/** His clinic, as he tells the app when he sets up (the draft's visits are at 「Blossom Family Clinic」). */
async function hisClinic(context: BrowserContext, clinic = "Blossom Family Clinic"): Promise<void> {
  const res = await context.request.patch("/api/profile", { data: { clinic } });
  expect(res.status(), await res.text()).toBe(200);
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, id: string): Promise<void> {
  const out = path.join(DIR!, "05");
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits on the tab bar
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) {
    // the whole page without the bars fixed at the bottom (they are on the phone-sized picture); the strip of buttons
    // sits at the page's end, where it is once he has scrolled down
    const hide = await page.addStyleTag({ content: ".rpu-tabs, .rpu-say, .rpu-typedock { display: none !important; } .rpu-visit-dock { position: static !important; }" });
    await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
    await hide.evaluate((el) => (el as Element).remove());
  }
}

/** A visit recorded and turned into text by the stand-in (fixture), through the routes; returns its id. */
async function recordedVisit(context: BrowserContext, fixture: string): Promise<string> {
  const api = context.request;
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  return visitId;
}

/** 「是」 on the line on screen, and wait for the next one (or the record). */
async function sayYes(page: Page): Promise<void> {
  const key = await page.getByTestId("review-one").getAttribute("data-key");
  await page.getByTestId("review-yes").click();
  await expect(page.locator(`[data-testid="review-one"][data-key="${key}"]`)).toHaveCount(0);
}

/** 「是」 until the line with these words is the one on screen. */
async function yesUntil(page: Page, words: string): Promise<void> {
  const one = page.getByTestId("review-one");
  for (let i = 0; i < 30; i++) {
    await expect(one).toBeVisible();
    if (((await one.textContent()) ?? "").includes(words)) return;
    await sayYes(page);
  }
  throw new Error(`the review never asked about: ${words}`);
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  provider = health.provider ?? "unknown";
});

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("05 看诊：同意卡、录音中、一句一句认、认完的记录", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  // the draft's first visit: Monday 24 August
  await setClock(request, SGT("2026-08-24", "09:30"), false);
  const context = await phone(browser, baseURL!);
  await account(context, "blank");
  await hisClinic(context);
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
  const page = await context.newPage();

  // the visit tab of an account with no visit yet (real-app 2.25), then where he is
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-empty")).toBeVisible();
  await shot(page, "05-9-empty");
  await page.getByTestId("visit-start").click();
  await expect(page.getByTestId("visit-where")).toBeVisible();
  await shot(page, "05-9-first-visit");
  await page.getByTestId("visit-clinic").click();
  await expect(page.getByTestId("visit-before")).toBeVisible();
  await shot(page, "05-1-before");

  // 05-1: the card for the doctor
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toBeVisible();
  await shot(page, "05-1");

  // 05-2: recording, the last two captions (the stand-in hears the first visit: 0:49 and 0:53 are the doctor's two lines)
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  const visitId = (await live.getAttribute("data-visit"))!;
  await expect(page.getByTestId("visit-captions")).toContainText("chest pain", { timeout: 90_000 });
  await shot(page, "05-2");

  // 05-10a: the visit's own list of what to ask before he leaves, once the server has put it together
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  if (await page.getByTestId("visit-leaving-toggle").count()) {
    await page.getByTestId("visit-leaving-toggle").click();
    await expect(page.getByTestId("visit-leaving")).toBeVisible();
    await shot(page, "05-10a");
    await page.getByTestId("visit-leaving-toggle").click();
  }

  // 05-4: one line at a time; the draft shows the target line with the one before it and the one after it
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  await expect(page.getByTestId("review-queue")).toBeVisible();
  await shot(page, "05-4-first");
  await yesUntil(page, "below 135 over 85");
  await shot(page, "05-4");

  // 05-8: Today while this review is not finished
  await page.goto("/p/today");
  await expect(page.getByTestId("today-visit-review")).toBeVisible();
  await page.getByTestId("today-visit-review").scrollIntoViewIfNeeded();
  await shot(page, "05-8");
  await page.getByTestId("today-visit-review-go").click();
  await expect(page.getByTestId("review-one")).toContainText("below 135 over 85");

  // 05-5: 「不是」 on the warning line: it stays, flagged, with the undo bar; 「撤销」 asks it again
  await sayYes(page);
  await expect(page.getByTestId("review-one")).toContainText("call 995");
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-held")).toBeVisible();
  await shot(page, "05-5");
  await page.getByTestId("review-undo").getByRole("button").click();
  await expect(page.getByTestId("review-one")).toContainText("call 995");
  await shot(page, "05-5-undone");

  // 05-6: the record, before and after 「就这样，存好」
  for (let i = 0; i < 30 && (await page.getByTestId("review-summary").count()) === 0; i++) await sayYes(page);
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await shot(page, "05-6-to-save");
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });
  await shot(page, "05-6");
  // 「我说的话 N 句 · 看一下」: his own lines behind one row of the record
  await page.getByTestId("review-own-lines-open").click();
  await expect(page.getByTestId("review-own-lines")).toBeVisible();
  await shot(page, "05-6-own-lines");
  await page.getByTestId("review-own-lines-done").click();

  // 05-9: the visit tab once there is a visit to read again
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-past")).toBeVisible();
  await shot(page, "05-9-one-visit");
  await context.close();

  // 05-1en: the same card in English
  const english = await phone(browser, baseURL!, "en");
  await account(english, "blank", { locale: "en" });
  await hisClinic(english);
  const en = await english.newPage();
  await en.goto("/p/visit");
  await en.getByTestId("visit-start").click();
  await en.getByTestId("visit-clinic").click();
  await en.getByTestId("visit-direct").click();
  await expect(en.getByTestId("visit-consent")).toBeVisible();
  await shot(en, "05-1en");
  await english.close();
});

test("06-1、06-2 认完以后开的药，柜台的原话", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  // the draft's second visit: Tuesday 1 September
  await setClock(request, SGT("2026-09-01", "10:30"));
  const context = await phone(browser, baseURL!);
  await account(context, "blank");
  await hisClinic(context);
  const visitId = await recordedVisit(context, "v2");
  const page = await context.newPage();
  await page.goto(`/p/visit/${visitId}/review`);
  await expect(page.getByTestId("review-queue")).toBeVisible();

  // 05-7: a doctor's English line with its checked Chinese under it (05-7a), or alone when there is none (05-7b)
  await yesUntil(page, "This tablet works quietly");
  await shot(page, (await page.getByTestId("review-translation").count()) ? "05-7a" : "05-7b");
  for (let i = 0; i < 30 && (await page.getByTestId("review-summary").count()) === 0; i++) await sayYes(page);
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });

  // 06-1: the visit is checked through, and the medicine the doctor prescribed waits for its label
  await expect(page.getByTestId("review-to-meds")).toBeVisible();
  await shot(page, "06-1");

  // 06-2: what the counter said, as its own section of the record
  const counter = page.locator('[data-testid="review-said"][data-speaker="dispenser"]');
  await expect(counter).toBeVisible();
  await counter.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12));
  await page.waitForTimeout(200);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  mkdirSync(path.join(DIR!, "05"), { recursive: true });
  await page.screenshot({ path: path.join(DIR!, "05", "06-2.png") });
  await context.close();
});

test("05-9 看诊记录（示例资料），05-10 离开前要问的", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  // the example data is laid out so that today is the day of its third visit
  await setClock(request, SGT("2026-10-12", "10:00"), false);
  const context = await phone(browser, baseURL!);
  await account(context, "example");
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v3" });
  const page = await context.newPage();
  await page.goto("/p/visit?speed=6");
  await expect(page.getByTestId("visit-where")).toBeVisible();
  await shot(page, "05-9");

  // his own recording of today's follow-up; the stand-in hears the third visit, in which he asks his three questions
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  const toggle = page.getByTestId("visit-leaving-toggle");
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  await toggle.click();
  const list = page.getByTestId("visit-leaving");
  await expect(list).toBeVisible();
  await shot(page, "05-10a");
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 120_000 });
  await page.waitForTimeout(800);
  await shot(page, "05-10b");

  // the record of that visit: what the doctor told him, and what he said next to his own records
  const visitId = (await live.getAttribute("data-visit"))!;
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  await expect(page.getByTestId("review-queue")).toBeVisible();
  // 05-7a: a doctor's English line with its checked Chinese under it (the example's visits carry their translations)
  for (let i = 0; i < 40 && (await page.getByTestId("review-summary").count()) === 0; i++) {
    if (i < 39 && (await page.getByTestId("review-translation").count()) > 0) {
      await shot(page, "05-7a");
      break;
    }
    await sayYes(page);
  }
  for (let i = 0; i < 40 && (await page.getByTestId("review-summary").count()) === 0; i++) await sayYes(page);
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });
  await shot(page, "05-6-with-his-records");

  // the sample replay, left half way: its row on the visit tab says 「示例回放」
  await context.setExtraHTTPHeaders({});
  await page.goto("/p/visit?speed=1");
  await page.getByTestId("visit-sample-start").click();
  await expect(page.getByTestId("visit-live")).toHaveAttribute("data-mode", "replay");
  await expect(page.getByTestId("visit-captions")).toBeVisible({ timeout: 30_000 });
  await shot(page, "05-2-sample-replay");
  await page.goto("/p/visit");
  await expect(page.locator('[data-testid="visit-unfinished-row"][data-sample="true"]')).toBeVisible();
  await shot(page, "05-9-sample-left");
  await context.close();
});

test("手机上留着、不再要传的录音", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  await setClock(request, SGT("2026-10-12", "10:00"), false);
  const context = await phone(browser, baseURL!);
  await account(context, "blank");
  const page = await context.newPage();
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  const visitId = (await live.getAttribute("data-visit"))!;
  await page.waitForTimeout(12_500);
  await page.close({ runBeforeUnload: true });
  // the visit gets its text elsewhere (no recording on the server): the phone's copy is kept, not sent
  const api = context.request;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": "v1" } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  const again = await context.newPage();
  await again.goto("/p/visit");
  await expect(again.getByTestId("visit-held-row")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await shot(again, "05-9-kept-on-the-phone");
  await context.close();
});

test("稿子没画的几屏：正在存录音、没传上去、重新打开、回顾里没存上、我约的日子、这次没有录到", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  await setClock(request, SGT("2026-08-24", "09:30"), false);
  const context = await phone(browser, baseURL!);
  await account(context, "blank");
  await hisClinic(context);
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
  const page = await context.newPage();
  await page.goto("/p/visit?speed=8");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  const visitId = (await live.getAttribute("data-visit"))!;
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });

  // 「录完了」 while the upload is held back: the saving screen. Then the upload is refused: the recording stays on the phone
  let refuse = true;
  let letGo: () => void = () => undefined;
  const heldBack = new Promise<void>((resolve) => (letGo = resolve));
  await context.route("**/api/blob/upload**", async (route) => {
    if (!refuse) return route.continue();
    await heldBack;
    await route.abort();
  });
  await page.getByTestId("visit-stop").click();
  await expect(page.getByTestId("visit-ending")).toHaveAttribute("data-step", "saving");
  await shot(page, "05-3-saving");
  letGo();
  await expect(page.getByTestId("visit-error")).toHaveAttribute("data-error", "upload", { timeout: 30_000 });
  await shot(page, "通用-2-upload-failed");

  // the visit tab offers the recording this phone keeps; its row opens the visit again (nothing is recording there)
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-resume")).toBeVisible({ timeout: 20_000 });
  await shot(page, "05-9-not-sent-yet");
  await page.goto(`/p/visit?visit=${visitId}`);
  await expect(page.getByTestId("visit-reopened")).toHaveAttribute("data-kept", "phone", { timeout: 20_000 });
  await shot(page, "05-9-reopened");

  // 「现在传」: saved, then turned into text (the answer about the text is held back for its picture)
  refuse = false;
  let textNow: () => void = () => undefined;
  const textHeld = new Promise<void>((resolve) => (textNow = resolve));
  await page.route("**/api/asr/jobs/*", async (route) => {
    await textHeld;
    await route.continue();
  });
  await page.getByTestId("visit-resume-send").click();
  await expect(page.getByTestId("visit-ending")).toHaveAttribute("data-step", "transcribing", { timeout: 30_000 });
  await expect(page.getByTestId("visit-ending-saved")).toBeVisible({ timeout: 30_000 });
  await shot(page, "05-3-making-text");
  textNow();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  await expect(page.getByTestId("review-queue")).toBeVisible();
  await page.unroute("**/api/asr/jobs/*");

  // an answer the server did not take: said in view, with 「再试一次」
  const firstKey = await page.getByTestId("review-one").getAttribute("data-key");
  await page.route(`**/api/visits/${visitId}/verdict`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"store_unavailable"}' }));
  await page.getByTestId("review-yes").click();
  await expect(page.getByTestId("review-problem")).toBeVisible();
  await shot(page, "通用-2-answer-not-saved");
  await page.unroute(`**/api/visits/${visitId}/verdict`);
  await page.getByTestId("review-problem-retry").click();
  // the same answer is sent again and saved: the next line is asked
  await expect(page.locator(`[data-testid="review-one"][data-key="${firstKey}"]`)).toHaveCount(0);
  await expect(page.getByTestId("review-problem")).toHaveCount(0);

  // the follow-up planned from this visit: its row on the visit tab, and 「我约的日子」
  for (let i = 0; i < 30 && (await page.getByTestId("review-summary").count()) === 0; i++) await sayYes(page);
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });
  await page.goto("/p/visit");
  await page.getByTestId("visit-planned-row").locator("a").first().click();
  await expect(page.getByTestId("visit-booking")).toBeVisible();
  await shot(page, "05-9-booking");
  await context.close();

  // a visit in which nothing was heard; and one left recording that this phone holds nothing of
  const other = await phone(browser, baseURL!);
  await account(other, "blank");
  await hisClinic(other);
  const quiet = await other.newPage();
  await quiet.goto("/p/visit");
  await quiet.getByTestId("visit-start").click();
  await quiet.getByTestId("visit-clinic").click();
  await quiet.getByTestId("visit-direct").click();
  await quiet.getByTestId("consent-start").click();
  await expect(quiet.getByTestId("visit-live")).toBeVisible();
  await quiet.getByTestId("visit-stop").click();
  await expect(quiet.getByTestId("review-empty")).toBeVisible({ timeout: 60_000 });
  await shot(quiet, "05-3-nothing-recorded");
  const started = await other.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  const elsewhere = ((await started.json()) as { visit: { id: string } }).visit.id;
  await quiet.goto(`/p/visit/${elsewhere}/review`);
  await expect(quiet.getByTestId("review-not-ready")).toBeVisible();
  await shot(quiet, "05-3-not-finished");
  await quiet.goto(`/p/visit?visit=${elsewhere}`);
  await expect(quiet.getByTestId("visit-reopened")).toHaveAttribute("data-kept", "none", { timeout: 20_000 });
  await shot(quiet, "05-9-reopened-nothing-here");
  await other.close();
});

test("电脑上打开：看诊页、同意卡、录音中、一句一句认、记录，都是中间一列", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  await setClock(request, SGT("2026-08-24", "09:30"), false);
  // a laptop's window: app/desktop.css draws every phone page as one column in the middle
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Singapore", permissions: ["microphone"] });
  await context.addCookies([{ name: "rp_lang", value: "zh-Hans", url: baseURL! }]);
  await account(context, "blank");
  await hisClinic(context);
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
  const page = await context.newPage();
  const desk = async (id: string) => {
    mkdirSync(path.join(DIR!, "05"), { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(DIR!, "05", `desk-${id}.png`) });
  };
  await page.goto("/p/visit?speed=8");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toBeVisible();
  await desk("05-1");
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  const visitId = (await live.getAttribute("data-visit"))!;
  await expect(page.getByTestId("visit-captions")).toContainText("chest pain", { timeout: 90_000 });
  await desk("05-2");
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  await yesUntil(page, "below 135 over 85");
  await desk("05-4");
  await sayYes(page);
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-held")).toBeVisible();
  await desk("05-5");
  await page.getByTestId("review-next").click();
  for (let i = 0; i < 30 && (await page.getByTestId("review-summary").count()) === 0; i++) await sayYes(page);
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });
  await desk("05-6");
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-past")).toBeVisible();
  await desk("05-9");
  await context.close();
});

test("05-3 录完了，字幕还没出来（没接转写的服务器）", async ({ browser, request, baseURL }) => {
  test.skip(provider !== "mock", `needs SPEECH_PROVIDER=mock, this server has ${provider}`);
  await setClock(request, SGT("2026-08-24", "09:30"), false);
  const context = await phone(browser, baseURL!);
  await account(context, "blank");
  await hisClinic(context);
  const page = await context.newPage();
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await shot(page, "05-9-first-visit-no-transcription");
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  const visitId = (await live.getAttribute("data-visit"))!;
  await page.waitForTimeout(6_000);
  await shot(page, "05-2-no-captions");
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  await expect(page.getByTestId("review-awaiting")).toBeVisible();
  await expect(page.getByTestId("review-awaiting")).toContainText(/录音（\d+ 分 \d+ 秒）已经存好/);
  await shot(page, "05-3");
  await page.getByTestId("review-own-note-input").fill("医生说下星期再来。");
  await page.getByTestId("review-own-note-save").click();
  await expect(page.getByTestId("review-own-note")).toBeVisible();
  await shot(page, "05-3-own-note");
  // Today's entry for it, and the visit tab's row
  await page.goto("/p/today");
  await expect(page.getByTestId("today-visit-waiting")).toBeVisible();
  await page.getByTestId("today-visit-waiting").scrollIntoViewIfNeeded();
  await shot(page, "05-8-waiting-for-text");
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-unfinished")).toBeVisible();
  await shot(page, "05-9-waiting-for-text");
  await context.close();
});

test("通用-2 出错（看诊页），和看诊这几页别的出错、没有麦克风", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-06", "10:00"), false);
  const context = await phone(browser, baseURL!);
  await account(context, "blank");
  const page = await context.newPage();

  // 通用-2: the visit tab itself could not be drawn. Its own list of visits is made to fail in this browser (a
  // malformed address never reaches a page: the server answers it 400), on a page of its own so nothing else breaks
  const started = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  const broken = await context.newPage();
  await broken.addInitScript(() => {
    const stringify = JSON.stringify.bind(JSON) as (...args: unknown[]) => string;
    JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
      const visits = Array.isArray(value) && value.length > 0 && value.every((v) => v !== null && typeof v === "object" && "audioPath" in v && "status" in v);
      if (visits) throw new Error("the visit tab is broken for this picture");
      return stringify(value, ...rest);
    }) as typeof JSON.stringify;
  });
  await broken.goto("/p/visit");
  await expect(broken.getByTestId("visit-problem")).toBeVisible({ timeout: 30_000 });
  await shot(broken, "通用-2");
  await broken.close();

  // the doctor's 「不同意」 that could not be saved
  await page.goto("/p/visit");
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.route("**/api/visits", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"store_unavailable"}' });
    else await route.continue();
  });
  await page.getByTestId("consent-skip").click();
  await expect(page.getByTestId("visit-decline-failed")).toBeVisible();
  await shot(page, "通用-2-decline-not-saved");
  await page.unroute("**/api/visits");
  await page.getByTestId("visit-decline-failed").locator('[data-rp="retry"]').click();
  await expect(page.getByTestId("visit-declined")).toBeVisible();
  await shot(page, "05-1-declined");
  await context.close();

  // no microphone: nothing looks like a recording
  const mute = await phone(browser, baseURL!);
  await mute.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await account(mute, "blank");
  const quiet = await mute.newPage();
  await quiet.goto("/p/visit");
  await quiet.getByTestId("visit-start").click();
  await quiet.getByTestId("visit-clinic").click();
  await quiet.getByTestId("visit-direct").click();
  await quiet.getByTestId("consent-start").click();
  await expect(quiet.getByTestId("visit-nomic")).toBeVisible({ timeout: 20_000 });
  await shot(quiet, "通用-2-no-microphone");
  await mute.close();
});
