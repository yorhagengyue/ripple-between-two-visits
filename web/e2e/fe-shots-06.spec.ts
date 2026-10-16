/**
 * Screenshots for the owner of 「我的药」 rebuilt after the timeline draft (web/progress/fe-06.md): one PNG per screen
 * at 390x844 @2x in 华语, named by the draft's screen id, in FE_SHOTS_DIR/06/ and FE_SHOTS_DIR/08/. Not a test of looks,
 * and never part of a default run: without FE_SHOTS_DIR every test here is skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3780 npx playwright test e2e/fe-shots-06.spec.ts
 *
 * Needs the developer tools and the stand-in transcription (SPEECH_PROVIDER=devfake: the example's third visit is
 * recorded through the routes so that Losartan waits for its label). Each test makes its own account on the developer
 * test clock (the example data, laid out on Mon 12 Oct 2026). A screen longer than the phone is also saved whole as
 * <id>-full.png. States the draft did not draw are saved as 06-x-<state>.png; the English interface of the main
 * screens as <id>-en.png (the draft draws 06 and 08 in 华语 only: these are looked at for words that do not fit), and
 * five screens in a computer's window as 06-desk-<name>.png (the phone's column, the dock strip and the dark camera step).
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const LABEL = (name: string) => path.join(process.cwd(), "fixtures", "labels", `${name}.png`);

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore" });
}

async function account(context: BrowserContext, space: "example" | "blank"): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `m${randomUUID().slice(0, 12)}`, password: "a long test password", space, display_name: "陈先生" } });
  expect(res.status(), await res.text()).toBe(201);
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, group: "06" | "08", id: string): Promise<void> {
  const out = path.join(DIR!, group);
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits on the tab bar
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) {
    // the whole page without what is fixed at the bottom (those bars are on the phone-sized picture)
    const hide = await page.addStyleTag({ content: ".rpu-tabs, .rpu-say, .rpu-typedock, .rpu-toast[data-placement='fixed'] { display: none !important; }" });
    await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
    await hide.evaluate((el) => (el as Element).remove());
  }
}

/** A visit recorded and turned into text by the stand-in (fixture), through the routes; returns its id. */
async function recordedVisit(api: APIRequestContext, fixture: string): Promise<string> {
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(started.status(), await started.text()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status, { timeout: 60_000 }).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  return visitId;
}

/** He says 「是」 to every line of the visit's record that carries a row of one of these kinds. */
async function sayYes(api: APIRequestContext, visitId: string, variants: string[]): Promise<void> {
  const view = ((await (await api.get(`/api/visits/${visitId}`)).json()) as { view: { cards: { kind: string; rows: { variant: string; itemId: string }[] }[] } }).view;
  for (const c of view.cards) {
    if (c.kind !== "doc" || !c.rows.some((r) => variants.includes(r.variant))) continue;
    const res = await api.post(`/api/visits/${visitId}/verdict`, { data: { items: c.rows.map((r) => r.itemId), verdict: "right", locale: "zh-Hans" } });
    expect(res.status(), await res.text()).toBe(200);
  }
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  test.skip(health.provider !== "devfake", "needs SPEECH_PROVIDER=devfake (the example's third visit is recorded through the routes)");
});

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("06 开药到会吃：我的药、药卡、讲解卡、理解清单、拍药袋、逐项确认", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context, "example");
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const api = context.request;
  const page = await context.newPage();

  // the example's third visit, recorded through the routes: Dr Lim adds Losartan, which then waits for its label
  const visitId = await recordedVisit(api, "v3");
  await sayYes(api, visitId, ["new_med", "med"]);

  // 06-6: his medicines by where they came from, one status each
  await page.goto("/p/meds");
  await expect(page.getByTestId("meds-list")).toBeVisible();
  await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "awaiting_label");
  await shot(page, "06", "06-6");

  // 06-7: one medicine's card
  await page.getByTestId("med-row-med-amlodipine").click();
  await expect(page.getByTestId("med-card")).toHaveAttribute("data-view", "card");
  await expect(page.getByTestId("card-how-to-take")).toBeVisible();
  await shot(page, "06", "06-7");

  // 06-8: the explain card
  await page.getByTestId("card-explain-open").click();
  await expect(page.getByTestId("card-explain")).toBeVisible();
  await expect(page.getByTestId("explain-line").first()).toBeVisible();
  await shot(page, "06", "06-8");
  // one of its recordings playing
  await page.getByTestId("card-listen").first().getByRole("button").click();
  await expect(page.getByTestId("card-listen").first()).toHaveAttribute("data-playing", "true");
  await shot(page, "06", "06-8-playing");

  // 06-9: the checklist: 知道 for the first, 不确定 for the second
  await page.getByTestId("card-check-open").click();
  await expect(page.getByTestId("card-checklist")).toBeVisible();
  await shot(page, "06", "06-9-before");
  await page.getByTestId("check-purpose-know").click();
  await expect(page.getByTestId("check-purpose")).toHaveAttribute("data-answer", "know");
  await page.getByTestId("check-feel_fine-unsure").click();
  await expect(page.getByTestId("check-feel_fine")).toHaveAttribute("data-answer", "unsure");
  await expect(page.getByTestId("check-feel_fine")).toContainText("已在下次看诊的问题单里");
  await shot(page, "06", "06-9");

  // the card of a medicine that waits for its label
  await page.goto("/p/meds/med-losartan");
  await expect(page.getByTestId("med-awaiting")).toBeVisible();
  await shot(page, "06", "06-x-card-awaiting");

  // 06-3: before the camera; the example account has the sample labels
  await page.getByTestId("med-photograph").click();
  await expect(page.getByTestId("add-photo")).toBeVisible();
  await expect(page.getByTestId("add-sample-losartan")).toBeVisible();
  await shot(page, "06", "06-3");

  // 06-4a: every line of the label; three of five answered, as the draft draws it
  await page.getByTestId("add-sample-losartan").click();
  const check = page.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  await shot(page, "06", "06-4a-start");
  for (let i = 0; i < 3; i++) {
    const index = await check.getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect(check).not.toHaveAttribute("data-index", index ?? "");
  }
  await shot(page, "06", "06-4a");
  // 「改」 on the date line opens its field
  await page.getByTestId("add-line-change").click();
  await expect(page.getByTestId("add-edit-input")).toBeVisible();
  await shot(page, "06", "06-4a-edit");
  await page.getByTestId("add-line-right").click();
  await page.getByTestId("add-line-right").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed", { timeout: 30_000 });
  await shot(page, "06", "06-x-saved");

  // 06-4b: the amlodipine bag again
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-prescription").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-sample-amlodipine").click();
  await expect(page.getByTestId("add-same")).toBeVisible({ timeout: 30_000 });
  await shot(page, "06", "06-4b");

  // 06-5: no label, typed in by himself
  await page.goto("/p/meds/add?manual=1");
  await expect(page.getByTestId("add-origin")).toBeVisible();
  await shot(page, "06", "06-x-origin");
  await page.getByTestId("add-origin-self_bought").click();
  await expect(page.getByTestId("add-manual")).toBeVisible();
  await page.getByTestId("add-manual-name").fill("Ibuprofen 200 mg");
  await page.getByTestId("add-slot-night").click();
  await page.getByTestId("add-manual-name").blur();
  await shot(page, "06", "06-5");

  // 08-3: the box nobody identified, after the pharmacist answered
  await page.goto("/p/meds/med-relative-box");
  await expect(page.getByTestId("card-unknown-choices")).toBeVisible();
  await page.getByTestId("unknown-not-taking").click();
  await expect(page.getByTestId("card-unknown-choices")).toHaveAttribute("data-status", "not_taking");
  await shot(page, "08", "08-3");

  // the list once Losartan's label is checked
  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "label_confirmed");
  await shot(page, "06", "06-6-after");
  await context.close();
});

test("08 认不出的药：拍那盒药、认不出、选了状态", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "19:30"));
  const context = await phone(browser);
  await account(context, "blank");
  const page = await context.newPage();

  // an empty list
  await page.goto("/p/meds");
  await expect(page.getByTestId("meds-list")).toHaveAttribute("data-count", "0");
  await shot(page, "06", "06-x-empty");

  await page.getByTestId("meds-photo").click();
  await expect(page.getByTestId("add-origin")).toBeVisible();
  await page.getByTestId("add-origin-relative").click();
  await expect(page.getByTestId("add-how")).toBeVisible();
  await shot(page, "06", "06-x-how");

  // 08-1a: before the camera
  await page.getByTestId("add-how-photo").click();
  await expect(page.getByTestId("add-photo")).toBeVisible();
  await shot(page, "08", "08-1a");

  // the photo is being read (held back a moment so the screen can be seen)
  await page.route(
    "**/api/labels/read",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByTestId("add-file").setInputFiles(LABEL("relative_box"));
  await expect(page.getByTestId("add-working")).toBeVisible();
  await shot(page, "06", "06-x-reading");

  // the one line read from the box
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 30_000 });
  await shot(page, "08", "08-x-check");

  // 08-1b: nobody identified it
  await page.getByTestId("add-line-right").click();
  await expect(page.getByTestId("add-unknown")).toBeVisible({ timeout: 30_000 });
  await shot(page, "08", "08-1b");

  // 08-2: he says what he does with it
  await page.getByTestId("add-unknown-not-taking").click();
  await expect(page.getByTestId("add-unknown-choices")).toHaveAttribute("data-status", "not_taking");
  await shot(page, "08", "08-2");
  await page.getByTestId("add-unknown-bring").click();
  await expect(page.getByTestId("add-unknown-doctor-list")).toBeVisible();
  await shot(page, "08", "08-2-bring");

  // its card, before any answer
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("med-unknown-sentence")).toBeVisible();
  await shot(page, "08", "08-x-card-open");

  // a photo nothing can be read from: what failed, what is still there, what to do
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-self_bought").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-file").setInputFiles(path.join(process.cwd(), "public", "icons", "icon-192.png"));
  await expect(page.getByTestId("add-error")).toBeVisible({ timeout: 30_000 });
  await shot(page, "06", "06-x-error");

  // a label whose words name no time: he chooses; then a reminder time nobody asked him yet
  await page.goto("/p/meds/add?manual=1");
  await page.getByTestId("add-origin-supplement").click();
  await page.getByTestId("add-manual-name").fill("Vitamin C");
  await page.getByTestId("add-slot-night").click();
  await page.getByTestId("add-manual-save").click();
  await expect(page.getByTestId("add-times")).toBeVisible();
  await shot(page, "06", "06-x-times");
  // 「别的时间」: the field under the chips, and a time outside this part of the day said in the red box
  await page.getByTestId("add-time-other").click();
  await page.getByTestId("add-time-input").fill("23:30");
  await page.getByTestId("add-times-done").click();
  await expect(page.getByTestId("add-time-problem")).toBeVisible();
  await shot(page, "06", "06-x-times-other");
  await page.getByTestId("add-time-21:30").click();
  await expect(page.getByTestId("add-time-problem")).toHaveCount(0);
  await page.getByTestId("add-times-done").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "unverified");
  await shot(page, "06", "06-x-saved-typed");
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("med-typed")).toBeVisible();
  await shot(page, "06", "06-x-card-typed");
  await context.close();
});

test("06 and 08 in English: the list, the card, the explain card, the checklist, the camera step, the label's lines, typing it in, the box nobody identified", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await context.addCookies([{ name: "rp_lang", value: "en", url: baseURL! }]);
  await account(context, "example");
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const api = context.request;
  const page = await context.newPage();
  const visitId = await recordedVisit(api, "v3");
  await sayYes(api, visitId, ["new_med", "med"]);

  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "awaiting_label");
  await shot(page, "06", "06-6-en");

  await page.getByTestId("med-row-med-amlodipine").click();
  await expect(page.getByTestId("card-how-to-take")).toBeVisible();
  await shot(page, "06", "06-7-en");

  await page.getByTestId("card-explain-open").click();
  await expect(page.getByTestId("explain-line").first()).toBeVisible();
  await shot(page, "06", "06-8-en");

  await page.getByTestId("card-check-open").click();
  await page.getByTestId("check-purpose-know").click();
  await expect(page.getByTestId("check-purpose")).toHaveAttribute("data-answer", "know");
  await page.getByTestId("check-feel_fine-unsure").click();
  await expect(page.getByTestId("check-feel_fine")).toHaveAttribute("data-answer", "unsure");
  await shot(page, "06", "06-9-en");

  await page.goto("/p/meds/add?med=med-losartan");
  await expect(page.getByTestId("add-sample-losartan")).toBeVisible();
  await shot(page, "06", "06-3-en");

  await page.getByTestId("add-sample-losartan").click();
  const check = page.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 3; i++) {
    const index = await check.getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect(check).not.toHaveAttribute("data-index", index ?? "");
  }
  await shot(page, "06", "06-4a-en");

  await page.goto("/p/meds/add?manual=1");
  await page.getByTestId("add-origin-self_bought").click();
  await page.getByTestId("add-manual-name").fill("Ibuprofen 200 mg");
  await page.getByTestId("add-slot-night").click();
  await page.getByTestId("add-manual-name").blur();
  await shot(page, "06", "06-5-en");

  await page.goto("/p/meds/med-relative-box");
  await expect(page.getByTestId("card-unknown-choices")).toBeVisible();
  await shot(page, "08", "08-3-en");

  // the list again with the longest status words on a row (「Bring to the doctor」)
  await page.getByTestId("unknown-bring").click();
  await expect(page.getByTestId("card-unknown-choices")).toHaveAttribute("data-status", "bring_to_doctor");
  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-relative-box")).toBeVisible();
  await page.getByTestId("med-row-med-relative-box").scrollIntoViewIfNeeded();
  await shot(page, "06", "06-6-en-after");
  await context.close();
});

test("06 on a computer (1280x720): the list, a card, the camera step, the label's lines and typing it in, each in the phone's column", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await account(context, "example");
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const api = context.request;
  const page = await context.newPage();
  const visitId = await recordedVisit(api, "v3");
  await sayYes(api, visitId, ["new_med", "med"]);

  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "awaiting_label");
  await shot(page, "06", "06-desk-list");

  await page.goto("/p/meds/med-amlodipine");
  await expect(page.getByTestId("card-how-to-take")).toBeVisible();
  await shot(page, "06", "06-desk-card");

  // the camera step is a dark page: a dark stage behind its column
  await page.goto("/p/meds/add?med=med-losartan");
  await expect(page.getByTestId("add-sample-losartan")).toBeVisible();
  await shot(page, "06", "06-desk-camera");

  // the dock strip stays inside the column, at the foot of the window
  await page.getByTestId("add-sample-losartan").click();
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 30_000 });
  await shot(page, "06", "06-desk-check");

  await page.goto("/p/meds/add?manual=1");
  await page.getByTestId("add-origin-self_bought").click();
  await page.getByTestId("add-manual-name").fill("Ibuprofen 200 mg");
  await page.getByTestId("add-manual-name").blur();
  await shot(page, "06", "06-desk-manual");
  await context.close();
});

test("06 稿子没画的状态：这是哪种药的药袋、名字对不上、药袋没写时间", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await phone(browser);
  await account(context, "blank");
  const api = context.request;
  const page = await context.newPage();

  // Dr Lim prescribed Amlodipine (the second visit, through the routes): it waits for its label
  const visitId = await recordedVisit(api, "v2");
  await sayYes(api, visitId, ["new_med", "med"]);
  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-amlodipine")).toHaveAttribute("data-status", "awaiting_label");
  await shot(page, "06", "06-x-list-awaiting");

  // another medicine's label, the page not opened for the waiting one: he is asked which medicine it is for
  await page.getByTestId("meds-photo").click();
  await page.getByTestId("add-origin-prescription").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-file").setInputFiles(LABEL("losartan"));
  const check = page.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 8 && (await check.count()) > 0; i++) {
    const index = await check.getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect.poll(async () => (await check.count()) === 0 || (await check.getAttribute("data-index", { timeout: 500 }).catch(() => null)) !== index).toBe(true);
  }
  await expect(page.getByTestId("add-which")).toBeVisible({ timeout: 30_000 });
  await shot(page, "06", "06-x-which");

  // 「是」: the label names another medicine than the doctor prescribed
  await page.getByTestId("add-which-med-amlodipine").click();
  await expect(page.getByTestId("add-mismatch")).toBeVisible({ timeout: 30_000 });
  await shot(page, "06", "06-x-mismatch");

  // the waiting medicine's own label, its directions changed to words that name no time: he chooses when
  await page.goto("/p/meds/add?med=med-amlodipine");
  await page.getByTestId("add-file").setInputFiles(LABEL("amlodipine"));
  await expect(check).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("add-line-right").click();
  await page.getByTestId("add-line-right").click();
  await page.getByTestId("add-line-change").click();
  await page.getByTestId("add-edit-input").fill("一天一粒");
  await page.getByTestId("add-line-changed").click();
  await expect(page.getByTestId("add-row-directions")).toHaveAttribute("data-state", "edit");
  await shot(page, "06", "06-x-check-changed");
  await page.getByTestId("add-line-right").click();
  await page.getByTestId("add-line-right").click();
  await expect(page.getByTestId("add-slots")).toBeVisible();
  await page.getByTestId("add-slot-morning").click();
  await shot(page, "06", "06-x-slots");
  await page.getByTestId("add-slots-done").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed", { timeout: 30_000 });
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("med-edited")).toBeVisible();
  await shot(page, "06", "06-x-card-edited");
  await context.close();
});
