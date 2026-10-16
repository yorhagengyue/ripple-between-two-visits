/**
 * M4 cross-module fix on the phone: replay v2, confirm R4 but leave R3 unconfirmed. The visit screen says 推断：医生
 * for R3; the medicine card (/p/meds/med-amlodipine) and an answer from /api/ask on Today say the same, never 医生说;
 * R4, which he confirmed, is 医生说 in the hero answer.
 *
 * On Day 8, the second visit's own day: the replay is the visit itself (written in place). On a later day the same
 * replay is a re-watch in a copy and the visit's lines keep their labels (C2: e2e/m2-visit.spec.ts, the last test).
 */
import { expect, test } from "@playwright/test";
import { closeAll, createSession, openDevice } from "./helpers";

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 8 });
  for (const p of ["/p/visit", "/p/visit/v2/review", "/p/meds/med-amlodipine", "/p/today"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
});

test("R3 left unconfirmed after a v2 replay: 推断：医生 on the visit screen, the medicine card and /api/ask alike", async ({ browser, request }) => {
  test.setTimeout(150_000);
  const s = await createSession(request, { story_day: 8, story_time: "10:00" }); // the visit's own day
  const phone = await openDevice(browser, s.id, "/p/visit?replay=v2&speed=20");
  const page = phone.page;
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 60_000 });
  await page.getByTestId("visit-end").click();
  await page.waitForURL(/\/p\/visit\/v2\/review$/, { timeout: 30_000 });
  await expect(page.getByTestId("card-v2-u06-chip")).toContainText("推断：医生");
  // he confirms R4 only
  await page.getByTestId("verdict-v2-u08-right").click();
  await page.getByTestId("review-confirm").click();
  await expect(page.getByTestId("review-status")).toHaveText("已确认", { timeout: 10_000 });
  await expect(page.getByTestId("card-v2-u06-chip")).toContainText("推断：医生");
  await expect(page.getByTestId("card-v2-u08-chip")).toContainText("医生说");

  // the medicine card
  await page.goto("/p/meds/med-amlodipine");
  const r3 = page.locator('[data-testid="card-line"][data-source="visit:v2:R3"]');
  await expect(r3.getByTestId("card-line-tag")).toHaveText("● 推断：医生");
  await expect(r3).not.toContainText("医生说");

  // /api/ask on Today
  await page.goto("/p/today");
  await page.getByTestId("ask-input").fill("我感觉很好，为什么还要吃这个药？");
  await page.getByTestId("ask-send").click();
  const r3a = page.locator('[data-testid="answer-line"][data-source="visit:v2:R3"]');
  await expect(r3a.getByTestId("answer-chip")).toHaveText("● 推断：医生", { timeout: 4000 });
  await expect(r3a).toHaveAttribute("data-inferred", "true");
  await page.getByTestId("ask-input").fill("今天 150/95，我能不能多吃一粒？");
  await page.getByTestId("ask-send").click();
  await expect(page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"] [data-testid="answer-chip"]')).toHaveText("● 医生说", { timeout: 4000 });
  await closeAll([phone]);
});
