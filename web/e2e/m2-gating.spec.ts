/**
 * Day gating on the visit screens (the seed is the whole timeline, D0-D42; pages filter by the story day):
 *   - a visit later in the story has no review yet: no doctor's lines, no clips, no "Confirmed";
 *   - the sample replays on the consent screen are only the visits that have happened;
 *   - once the story reaches the day, both appear.
 * And the consent line shows the story time he agreed at, never the device's wall clock.
 */
import { expect, test } from "@playwright/test";
import { api, closeAll, createSession, openDevice, textBelow, CREW_HEADERS } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

test("Day 0: the Day 8 visit has no review yet and no sample replay; on Day 8 both appear", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 0 });
  const phone = await openDevice(browser, s.id, "/p/visit/v2/review");
  const page = phone.page;
  await expect(page.getByTestId("review-not-yet")).toBeVisible();
  await expect(page.getByTestId("review-not-yet")).toContainText("第8天");
  await expect(page.getByTestId("review-not-yet")).toContainText("第0天");
  await expect(page.getByTestId("review-seed-lines")).toHaveCount(0);
  await expect(page.getByTestId("review-status")).toHaveCount(0);
  await expect(page.locator("[data-clip-url]")).toHaveCount(0);
  for (const word of ["医生说", "已确认", "代录音", "This tablet works quietly"]) await expect(page.locator("body")).not.toContainText(word);
  expect(await textBelow(page, 18)).toEqual([]);

  // the consent screen offers only the visits that have happened
  await page.goto("/p/visit");
  await expect(page.getByTestId("replay-v1")).toBeVisible();
  await expect(page.getByTestId("replay-v2")).toHaveCount(0);
  await expect(page.getByTestId("replay-v3")).toHaveCount(0);
  await expect(page.getByTestId("replay-later")).toBeVisible();
  // a link straight to a later replay does not start it
  await page.goto("/p/visit?replay=v3&speed=20");
  await expect(page.getByTestId("visit-consent-step")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("visit-screen")).toHaveCount(0);
  // nor does the API
  const res = await request.post(`/api/visits?session=${s.id}`, { data: { mode: "replay", fixture: "v2" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("visit_not_yet");
  expect((await request.get(`/api/visits/v2?session=${s.id}`)).status()).toBe(409);

  // the director moves the story to Day 8: the review shows the doctor's words kept for that visit, the replay is offered
  await api(request, "/api/clock", s.id, { day: 8 });
  await page.goto("/p/visit/v2/review");
  await expect(page.getByTestId("review-not-yet")).toHaveCount(0);
  await expect(page.getByTestId("seed-R3")).toBeVisible();
  await expect(page.getByTestId("seed-R4")).toBeVisible();
  await expect(page.getByTestId("seed-R4-play-label")).toHaveText("代录音");
  await page.goto("/p/visit");
  await expect(page.getByTestId("replay-v2")).toBeVisible();
  await expect(page.getByTestId("replay-v3")).toHaveCount(0);
  await closeAll([phone]);
});

test("the consent line shows the story time he agreed at, not the wall clock", async ({ browser, request }) => {
  // Day 0 at 09:30 (the D0 beat): "已同意录音 · 上午9:30"
  const timed = await createSession(request, { story_day: 0, story_time: "09:30" });
  await api(request, "/api/visits", timed.id, { mode: "record", consent: { given: true, at: "2026-10-09T20:21:00.000Z" } });
  const phone = await openDevice(browser, timed.id, "/p/visit?visit=v1&mode=record");
  await expect(phone.page.getByTestId("visit-consent")).toHaveText("已同意录音 · 上午9:30");

  // no story time on the clock: no time at all (never the device's 4:21)
  const untimed = await createSession(request, { story_day: 0 });
  await api(request, "/api/visits", untimed.id, { mode: "record", consent: { given: true, at: "2026-10-09T20:21:00.000Z" } });
  const other = await openDevice(browser, untimed.id, "/p/visit?visit=v1&mode=record");
  await expect(other.page.getByTestId("visit-consent")).toHaveText("已同意录音");
  await closeAll([phone, other]);
});
