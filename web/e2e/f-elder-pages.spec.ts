/**
 * Track F's elder screens on a real account pass the automatic page checks (架构审核 「每个页面自动查」: 360 wide with no
 * sideways scroll, text at least 18px, targets at least 48x48, colour contrast AA) in every state the journeys use:
 * /p/visit (where, the card for the doctor, recording, nothing recorded), the review (one line, the summary),
 * /p/meds (list, add: photo, one label line, slots, typed entry, saved, not identified) and the medicine card.
 *
 * Needs the app on PW_PORT with RIPPLE_DEV_TOOLS=1 and SPEECH_PROVIDER=devfake (scripts/record/serve.mjs); skipped on any
 * other server (the full suite runs with mock speech). Screenshots of
 * each state go to F_SHOTS_DIR when it is set (for a person to look at; the checks do not need them).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
  locale: "zh-CN",
  timezoneId: "Asia/Singapore",
});

const SHOTS = process.env.F_SHOTS_DIR?.trim() || null;
const LABEL = (name: string) => path.join(process.cwd(), "fixtures", "labels", `${name}.png`);

async function check(page: Page, name: string): Promise<void> {
  // let entry animations finish (half-transparent text would read as low contrast)
  await page.waitForTimeout(400);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  }
  await expectPageChecks(page, { side: "elder" });
}

async function signUp(page: Page, space: "blank" | "example" = "blank"): Promise<void> {
  const res = await page.request.post("/api/dev/accounts", { data: { login: `fp${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space } });
  expect(res.status(), await res.text()).toBe(201);
}

test.beforeAll(async ({ request }) => {
  // the recording states need the developer tools' stand-in transcription (live captions and a record): the full suite
  // on a mock-speech server skips this file instead of failing it
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  test.skip(health.provider !== "devfake", "needs SPEECH_PROVIDER=devfake (scripts/record/serve.mjs)");
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: true } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test("the visit screens and the review pass the page checks", async ({ page, context }) => {
  test.setTimeout(240_000);
  await signUp(page);
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
  await page.goto("/p/visit?speed=8");
  // track V: a blank account's list is empty (「还没有看诊」 + 「开始」); between where and the card, 「直接开始」
  await page.getByTestId("visit-start").click();
  await expect(page.getByTestId("visit-where")).toBeVisible();
  await check(page, "visit-where");
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toBeVisible();
  await check(page, "visit-consent");
  await page.getByTestId("consent-start").click();
  await expect(page.getByTestId("visit-captions")).toBeVisible({ timeout: 20_000 });
  await check(page, "visit-recording");
  await expect(page.getByTestId("visit-live")).toHaveAttribute("data-stream", "ended", { timeout: 40_000 });
  await page.getByTestId("visit-stop").click();
  await expect(page.getByTestId("review-one")).toBeVisible({ timeout: 60_000 });
  await check(page, "review-one");
  while ((await page.getByTestId("review-queue").count()) > 0) {
    const n = Number(await page.getByTestId("review-queue").getAttribute("data-pending"));
    await page.getByTestId(n === 2 ? "review-no" : "review-yes").click();
    // the next line (one fewer to go), or the summary after the last one
    await expect
      .poll(async () => (await page.getByTestId("review-summary").count()) > 0 || (await page.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== String(n))
      .toBe(true);
    if (n === 2) {
      // 「不是」: the line stays on the screen, flagged, with its undo bar, until 「下一件」
      await expect(page.getByTestId("review-held")).toBeVisible();
      await expect(page.getByTestId("review-undo")).toBeVisible();
      await check(page, "review-held");
      await page.getByTestId("review-next").click();
      await expect(page.getByTestId("review-held")).toHaveCount(0);
    }
  }
  await check(page, "review-summary");
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed");
  await check(page, "review-confirmed");
  // the visit list now has an earlier visit
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-past")).toBeVisible();
  await check(page, "visit-where-past");
});

test("nothing recorded: the review says so", async ({ page, context }) => {
  test.setTimeout(120_000);
  await signUp(page);
  await context.setExtraHTTPHeaders({});
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  await expect(page.getByTestId("visit-live")).toBeVisible();
  await page.getByTestId("visit-stop").click();
  await expect(page.getByTestId("review-empty")).toBeVisible({ timeout: 60_000 });
  await check(page, "review-empty");
});

test("the medicine screens pass the page checks", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page);
  await page.goto("/p/meds");
  await expect(page.getByTestId("meds-list")).toHaveAttribute("data-count", "0");
  await check(page, "meds-empty");
  // typed in by himself
  await page.getByTestId("meds-manual").click();
  await page.getByTestId("add-origin-self_bought").click();
  await expect(page.getByTestId("add-manual")).toBeVisible();
  await page.getByTestId("add-manual-name").fill("Panadol");
  await page.getByTestId("add-slot-night").click();
  await check(page, "add-manual");
  await page.getByTestId("add-manual-save").click();
  // 睡前 has no reminder time in his settings yet: asked once, right here (real-app 2.16)
  await expect(page.getByTestId("add-times")).toHaveAttribute("data-slot", "night");
  await expect(page.getByTestId("add-times")).toHaveAttribute("data-picked", "21:30");
  await check(page, "add-times");
  // track C's question and chips (the same as 「我 › 早饭时间和提醒」): the part's usual times and 「别的时间」
  await expect(page.getByTestId("add-times")).toContainText("睡前的药，");
  await expect(page.getByTestId("add-time-21:30")).toHaveAttribute("aria-pressed", "true");
  // a time outside this part of the day is said right here, nothing is sent
  await page.getByTestId("add-time-other").click();
  await page.getByTestId("add-time-input").fill("23:30");
  await page.getByTestId("add-times-done").click();
  await expect(page.getByTestId("add-time-problem")).toContainText("之间");
  await check(page, "add-times-range");
  await page.getByTestId("add-time-22:00").click();
  await expect(page.getByTestId("add-times")).toHaveAttribute("data-picked", "22:00");
  await expect(page.getByTestId("add-time-problem")).toHaveCount(0);
  await page.getByTestId("add-times-done").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "unverified");
  await check(page, "add-done-typed");
  // not asked a second time: another medicine for 睡前 is saved straight away
  await page.goto("/p/meds/add?manual=1");
  await page.getByTestId("add-origin-supplement").click();
  await page.getByTestId("add-manual-name").fill("Vitamin C");
  await page.getByTestId("add-slot-night").click();
  await page.getByTestId("add-manual-save").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "unverified");
  // a label photo, checked line by line
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-prescription").click();
  await check(page, "add-how");
  await page.getByTestId("add-how-photo").click();
  await check(page, "add-photo");
  await page.getByTestId("add-file").setInputFiles(LABEL("amlodipine"));
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await check(page, "add-check-line");
  await page.getByTestId("add-line-right").click();
  await page.getByTestId("add-line-change").click();
  await check(page, "add-check-edit");
  await page.getByTestId("add-edit-input").fill("5 mg tablet");
  await page.getByTestId("add-line-changed").click();
  await page.getByTestId("add-line-change").click();
  await page.getByTestId("add-edit-input").fill("一天一粒");
  await page.getByTestId("add-line-changed").click();
  await page.getByTestId("add-line-right").click();
  await page.getByTestId("add-line-right").click();
  await expect(page.getByTestId("add-slots")).toBeVisible();
  await page.getByTestId("add-slot-morning").click();
  await check(page, "add-slots");
  await page.getByTestId("add-slots-done").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed");
  await check(page, "add-done-label");
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("med-card")).toBeVisible();
  await check(page, "med-card");
  // a box nobody identifies
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-relative").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-file").setInputFiles(LABEL("relative_box"));
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("add-line-right").click();
  await expect(page.getByTestId("add-unknown")).toBeVisible({ timeout: 20_000 });
  await check(page, "add-unknown");
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("card-unknown-choices")).toBeVisible();
  await page.getByTestId("unknown-bring").click();
  await expect(page.getByTestId("unknown-on-list")).toBeVisible();
  await check(page, "med-card-unknown");
  await page.goto("/p/meds");
  await check(page, "meds-list");
});

test("a recording left on the phone by a closed page is offered again, sent, and then forgotten (real-app 2.13)", async ({ page, context }) => {
  test.setTimeout(180_000);
  await signUp(page);
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  const visitId = (await live.getAttribute("data-visit"))!;
  // past the first 10 s copy, then the page goes away without 录完了
  await page.waitForTimeout(12_500);
  await page.close();

  const again = await context.newPage();
  await again.goto("/p/visit");
  const card = again.getByTestId("visit-resume");
  await expect(card).toHaveAttribute("data-visit", visitId);
  await expect(card).toContainText("还没传");
  await check(again, "visit-resume");
  await again.getByTestId("visit-resume-send").click();
  await again.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  const view = (await (await again.request.get(`/api/visits/${visitId}`)).json()) as { view: { visit: { audioPath: string | null; status: string } } };
  expect(view.view.visit.audioPath).toBeTruthy();
  expect(view.view.visit.status).toBe("review");
  // the copy on the phone is gone: no card next time
  await again.goto("/p/visit");
  await expect(again.getByTestId("visit-where")).toBeVisible();
  await expect(again.getByTestId("visit-resume")).toHaveCount(0);
});
