/**
 * No microphone on his visit page (C2 track V; real-app 第三波必修: 「没有麦克风时直接说清楚，不显示假的计时和声波」). The browser of
 * this file has no fake microphone and no microphone permission, so getUserMedia is refused, as on a phone where he
 * tapped 「不允许」: the page says so in plain words, shows nothing that looks like a recording in progress (no red bar,
 * no timer, no 「录完了」), starts no visit, and leaves him two ways on: try again, or go back.
 *
 * Needs the app on PW_PORT with the developer tools on (any speech provider).
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({
  viewport: { width: 390, height: 844 },
  // no --use-fake-ui-for-media-stream and no fake device: the permission prompt is never answered with yes
  launchOptions: { args: [] },
  permissions: [],
  locale: "zh-CN",
  timezoneId: "Asia/Singapore",
});

test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: false } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test("the microphone is refused: the screen says so, nothing looks like a recording, no visit is started", async ({ page }) => {
  const res = await page.request.post("/api/dev/accounts", { data: { login: `vn${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space: "blank" } });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();

  const nomic = page.getByTestId("visit-nomic");
  await expect(nomic).toBeVisible({ timeout: 20_000 });
  expect(["denied", "unavailable"]).toContain(await nomic.getAttribute("data-mic"));
  await expect(nomic).toContainText("麦克风");
  await expect(nomic).toContainText("没有在录音");
  // nothing of a recording in progress
  await expect(page.getByTestId("visit-live")).toHaveCount(0);
  await expect(page.locator('[data-rp="recording"]')).toHaveCount(0);
  await expect(page.getByTestId("visit-stop")).toHaveCount(0);
  await expect(page.getByText("正在录")).toHaveCount(0);
  // no timer (the top line's clock is the day's time, outside this block)
  await expect(nomic.getByText(/\d\d:\d\d/)).toHaveCount(0);
  await page.waitForTimeout(400);
  await expectPageChecks(page, { side: "elder" });

  // no visit was started for it: nothing unfinished is left behind
  const list = async () => {
    await page.goto("/p/visit");
    return page.getByTestId("visit-unfinished-row").count();
  };
  expect(await list()).toBe(0);
  await expect(page.getByTestId("visit-empty")).toBeVisible();

  // try again: still refused, still said plainly; back: the first screen
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  await expect(nomic).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("visit-mic-retry").click();
  await expect(nomic).toBeVisible();
  await expect(page.getByTestId("visit-mic-retry")).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByTestId("visit-live")).toHaveCount(0);
  await page.getByTestId("visit-mic-back").click();
  await expect(page.getByTestId("visit-empty")).toBeVisible();
});
