/**
 * Track F, round two, in the browser (real-app 2.2 step 7, 2.5 step 3, 2.16, 4.6):
 *   1. his consent to AI processing off: the visit's review says so with the way to change it; /p/meds/add has no
 *      camera, says so, and he types the label; for a prescribed medicine awaiting its label the typed label goes onto
 *      that medicine; on again under 「我」: the camera is back;
 *   2. the example account's sample visit: its review carries 「示例回放」; the losartan it prescribes is confirmed with
 *      the example's own sample label (real-app 4.6);
 *   3. /p/meds/add opened from setting up his account goes on with setting up, on 「以后再说」 and after adding.
 * Every new state passes the page checks (360 wide, 18px text, 48px targets, contrast).
 *
 * Needs the app on PW_PORT with RIPPLE_DEV_TOOLS=1 and SPEECH_PROVIDER=devfake (scripts/record/serve.mjs); skipped on any
 * other server. Screenshots go to F_SHOTS_DIR when it is set.
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

async function check(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `r2-${name}.png`), fullPage: true });
  }
  await expectPageChecks(page, { side: "elder" });
}

async function signUp(page: Page, opts: { space?: "blank" | "example"; onboarding?: "started" | "done" } = {}): Promise<void> {
  const res = await page.request.post("/api/dev/accounts", {
    data: { login: `f2${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space: opts.space ?? "blank", ...(opts.onboarding ? { onboarding: opts.onboarding } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function setAi(page: Page, on: boolean): Promise<void> {
  const res = await page.request.post("/api/me/consent", { data: { kind: "ai_processing", on } });
  expect(res.status(), await res.text()).toBe(200);
}

/** A visit recorded and turned into text by the stand-in (fixture), through the routes; returns its id. */
async function recordedVisit(page: Page, fixture: string): Promise<string> {
  const api = page.request;
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(started.status(), await started.text()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  return visitId;
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  test.skip(health.provider !== "devfake", "needs SPEECH_PROVIDER=devfake (scripts/record/serve.mjs)");
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: true } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test("AI processing off: the review says so; no camera for a label, he types it (onto the prescribed medicine); on again: the camera is back", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page);
  await setAi(page, false);

  // ---- the visit's review: one sentence that AI is off, and the way to 「我」
  const visitId = await recordedVisit(page, "v2");
  await page.goto(`/p/visit/${visitId}/review`);
  await expect(page.getByTestId("review-queue")).toBeVisible();
  // round three: the sentence is about this visit (kept with it when its record was made), in the past tense
  const note = page.getByTestId("review-ai-off");
  await expect(note).toContainText("这次看诊做记录时 AI 处理没开");
  await expect(note).toHaveAttribute("data-from", "record");
  await expect(note.locator('a[href="/p/me/ai"]')).toContainText("去「我」里改");
  await expect(page.getByTestId("review-sample")).toHaveCount(0);
  await check(page, "review-ai-off");
  // he says the prescription line is the doctor's: amlodipine is on his list, awaiting its label
  for (let i = 0; i < 20 && (await page.getByTestId("review-queue").count()) > 0; i++) {
    const n = await page.getByTestId("review-queue").getAttribute("data-pending");
    await page.getByTestId("review-yes").click();
    await expect.poll(async () => (await page.getByTestId("review-summary").count()) > 0 || (await page.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== n).toBe(true);
  }
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await expect(page.getByTestId("review-ai-off")).toBeVisible();
  await check(page, "review-summary-ai-off");
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed");

  // ---- his medicines: the label of the prescribed medicine is typed, not photographed
  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-amlodipine")).toHaveAttribute("data-status", "awaiting_label");
  await page.getByTestId("meds-photo-awaiting").click();
  const manual = page.getByTestId("add-manual");
  await expect(manual).toHaveAttribute("data-ai-off", "true");
  await expect(page.getByTestId("add-ai-off")).toContainText("AI 处理没开：药袋上的字要你自己输入。");
  await expect(page.getByTestId("add-ai-off").locator('a[href="/p/me/ai"]')).toBeVisible();
  await expect(page.getByTestId("add-take-photo")).toHaveCount(0);
  await expect(page.getByTestId("add-file")).toHaveCount(0);
  await expect(page.getByTestId("add-manual-name")).toHaveValue(/Amlodipine/);
  await page.getByTestId("add-manual-name").fill("Amlodipine");
  await page.getByTestId("add-manual-strength").fill("5 mg");
  await page.getByTestId("add-slot-morning").click();
  await check(page, "add-typed-label-ai-off");
  await page.getByTestId("add-manual-save").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "unverified");
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-med", "med-amlodipine");
  await page.goto("/p/meds");
  await expect(page.getByTestId("meds-list")).toHaveAttribute("data-count", "1");
  await expect(page.getByTestId("med-row-med-amlodipine")).toHaveAttribute("data-typed", "true");

  // ---- another medicine: the choice has no camera either
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-self_bought").click();
  await expect(page.getByTestId("add-how")).toHaveAttribute("data-ai-off", "true");
  await expect(page.getByTestId("add-how-photo")).toHaveCount(0);
  await expect(page.getByTestId("add-ai-off")).toBeVisible();
  await check(page, "add-how-ai-off");
  // the server refuses a photo too, whatever the page shows
  const refused = await page.request.post("/api/labels/read", { data: { path: "nowhere/labels/x.png" } });
  expect([403]).toContain(refused.status());

  // ---- on again under 「我」: the next page has the camera
  await setAi(page, true);
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-self_bought").click();
  await expect(page.getByTestId("add-how")).toHaveAttribute("data-ai-off", "false");
  await expect(page.getByTestId("add-how-photo")).toBeVisible();
  await expect(page.getByTestId("add-ai-off")).toHaveCount(0);
  // round three: this visit's record was made while AI was off, and the review keeps saying so; with AI on again the
  // way to 「我」 is gone (the setting is on; it changes the visits to come, not this one)
  await page.goto(`/p/visit/${visitId}/review`);
  await expect(page.getByTestId("review-summary")).toBeVisible();
  const made = page.getByTestId("review-ai-off");
  await expect(made).toContainText("这次看诊做记录时 AI 处理没开");
  await expect(made).toHaveAttribute("data-now", "on");
  await expect(made.locator('a[href="/p/me/ai"]')).toHaveCount(0);
  await check(page, "review-made-ai-off");
  // a visit recorded now is made with AI on: its review says nothing about AI
  const later = await recordedVisit(page, "v1");
  await page.goto(`/p/visit/${later}/review`);
  await expect(page.getByTestId("review-queue")).toBeVisible();
  await expect(page.getByTestId("review-ai-off")).toHaveCount(0);
  // and turning AI off afterwards does not put the sentence on that visit
  await setAi(page, false);
  await page.goto(`/p/visit/${later}/review`);
  await expect(page.getByTestId("review-queue")).toBeVisible();
  await expect(page.getByTestId("review-ai-off")).toHaveCount(0);
});

test("the example account's sample visit: its review says 示例回放 on the lines and on the summary", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { space: "example" });
  await page.goto("/p/visit?speed=12");
  await expect(page.getByTestId("visit-where")).toBeVisible();
  await page.getByTestId("visit-sample-start").click();
  await expect(page.getByTestId("visit-live")).toHaveAttribute("data-mode", "replay");
  await expect(page.getByTestId("visit-live")).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await page.getByTestId("visit-stop").click();
  await expect(page.getByTestId("review-one")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("review-sample")).toHaveText("示例回放");
  await expect(page.getByTestId("review-banner")).toContainText("陈先生的示例看诊，不是你的看诊。");
  await check(page, "review-sample-line");
  for (let i = 0; i < 40 && (await page.getByTestId("review-queue").count()) > 0; i++) {
    const n = await page.getByTestId("review-queue").getAttribute("data-pending");
    await expect(page.getByTestId("review-sample")).toHaveText("示例回放");
    await page.getByTestId("review-yes").click();
    await expect.poll(async () => (await page.getByTestId("review-summary").count()) > 0 || (await page.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== n).toBe(true);
  }
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await expect(page.getByTestId("review-sample")).toHaveText("示例回放");
  await check(page, "review-sample-summary");

  // real-app 4.6: the sample visit prescribed losartan; its sample label is offered first and confirms that medicine
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed");
  await expect(page.getByTestId("review-sample")).toHaveText("示例回放");
  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "awaiting_label");
  await page.getByTestId("meds-photo-awaiting").click();
  await expect(page.getByTestId("add-photo")).toBeVisible();
  const samples = page.locator('[data-testid^="add-sample-"]');
  await expect(samples).toHaveCount(4);
  await expect(samples.first()).toHaveAttribute("data-testid", "add-sample-losartan");
  await check(page, "add-photo-samples");
  await page.getByTestId("add-sample-losartan").click();
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("add-check-value")).toContainText("LOSARTAN");
  for (let i = 0; i < 6 && (await page.getByTestId("add-check").count()) > 0; i++) {
    const index = await page.getByTestId("add-check").getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect.poll(async () => (await page.getByTestId("add-check").count()) === 0 || (await page.getByTestId("add-check").getAttribute("data-index", { timeout: 500 }).catch(() => null)) !== index).toBe(true);
  }
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed", { timeout: 20_000 });
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-med", "med-losartan");
});

test("去拍药袋 from setting up his account: 以后再说 and the way on after adding both go to the screen that follows", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { onboarding: "started" });
  // the medicines screen of setting up
  await page.goto("/onboard/meds");
  await page.getByTestId("onboard-meds-photo").click();
  await page.waitForURL(/\/p\/meds\/add\?from=onboard$/);
  await page.getByTestId("add-origin-prescription").click();
  await expect(page.getByTestId("add-how")).toBeVisible();
  await page.getByTestId("add-later").click();
  await page.waitForURL(/\/onboard\/age$/);

  // again, this time he adds one: the first button goes on with setting up
  await page.goto("/p/meds/add?from=onboard");
  await page.getByTestId("add-origin-self_bought").click();
  await page.getByTestId("add-how-manual").click();
  await page.getByTestId("add-manual-name").fill("Panadol");
  await page.getByTestId("add-slot-morning").click();
  await page.getByTestId("add-manual-save").click();
  await expect(page.getByTestId("add-done")).toBeVisible();
  const onward = page.getByTestId("add-continue");
  await expect(onward).toHaveText("接着建档");
  await check(page, "add-done-from-onboard");
  await onward.click();
  await page.waitForURL(/\/onboard\/age$/);

  // a path from outside is never followed
  await page.goto("/p/meds/add?next=https://evil.example/x");
  await page.getByTestId("add-origin-prescription").click();
  await expect(page.getByTestId("add-later")).toHaveAttribute("href", "/p/meds");
});
