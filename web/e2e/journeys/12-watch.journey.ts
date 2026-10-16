/**
 * 12 手表 — on a real account (C2 track K; 老人端提示词 12; M12; e2e-chains 10).
 *
 *   10月12日 08:00 (developer test clock, frozen: the morning reminder is at 8:45, so Today shows the day's overview)
 *               a new account with Mr Tan's example data; its watch is his synthetic example watch (示例数据,
 *               fixtures/watch.seed.json), laid out up to today
 *   Today       the watch section (track K's WatchSection in track B's Today): only when there is something to say:
 *               「你的静息心率三周都高于你平时的范围。」 against his own usual range, and 「要把这件事加进下次 check-in 的问题
 *               吗？」 要 / 不要
 *   要          a question for the doctor goes on his list (origin watch_pattern); the card says so
 *   /p/watch    「手表」, 「只和你自己平时比」 (the timeline design's 12-1): resting heart rate, sleep and steps, one at a
 *               time, against his usual range: the last four weeks as a line, what the watch said and his answer, the
 *               weekly averages; no blood pressure, no medicine, no cause anywhere
 *   next day    the same stretch is not raised again: no watch section on Today
 */
import { expect, journey } from "./_kit";
import { advanceClock, clearClock, getJson, newAccount, openPage, questions, setClock } from "./_k/account";

const NEVER = /血压|mmHg|药|amlodipine|losartan|因为|导致|由于|引起|原因|正常|偏高|危险|你应该|你需要|建议/;

journey("12 手表", async ({ kit, request }) => {
  await setClock(request, "2026-10-12T08:00:00+08:00");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await newAccount(elder, { space: "example" });
  const before = await questions(elder);
  await openPage(elder, "/p/today");

  const today = pp.getByTestId("today-watch");
  const card = today.getByTestId("watch-card");

  await kit.step(pp, "陈先生（示例资料）早上打开今天页：手表这一块有话说才出现，用的是示例账号的合成数据");
  await expect(pp.locator('[data-today-section="watch"]')).toBeVisible();
  await expect(card).toContainText("示例数据");
  await kit.show(card);

  await kit.step(pp, "只说一件事：他的静息心率，三周都高于他自己平时的范围");
  await expect(card).toHaveAttribute("data-key", "rhr:above");
  await expect(card.getByTestId("watch-sentence")).toHaveText("你的静息心率三周都高于你平时的范围。");
  await expect(card).toContainText("你平时的范围：63–69 次/分");
  expect(await card.innerText()).not.toMatch(NEVER);

  await kit.step(pp, "下面问他：「要把这件事加进下次 check-in 的问题吗？」要不要，他自己定");
  await expect(card).toContainText("要把这件事加进下次 check-in 的问题吗？");
  await expect(card.getByTestId("watch-yes")).toHaveText("要");
  await expect(card.getByTestId("watch-no")).toHaveText("不要");
  expect((await questions(elder)).length).toBe(before.length);
  await kit.show(card.getByTestId("watch-yes"));

  await kit.step(pp, "他点「要」：这件事加进下次看诊要问医生的问题单");
  await card.getByTestId("watch-yes").click();
  await expect(card.getByTestId("watch-added")).toContainText("已在下次看诊的问题单里");
  const added = (await questions(elder)).filter((q) => !before.some((b) => b.id === q.id));
  expect(added).toEqual([expect.objectContaining({ for: "doctor", origin: "watch_pattern", status: "open" })]);
  expect(added[0].text).toBe("手表显示，我的静息心率三周都高于我平时的范围（平时 63–69 次/分，最近一周平均 75）。");
  expect(added[0].text).not.toMatch(NEVER);

  await kit.step(pp, "点「看手表上的走势」：「手表」这一屏，先是静息心率，只和他自己平时比");
  await card.getByRole("link", { name: "看手表上的走势" }).click();
  await pp.waitForURL(/\/p\/watch$/);
  await expect(pp.locator('[data-rp="page-title"]')).toHaveText("手表");
  await expect(pp.locator('[data-rp="meta-story"]')).toHaveText("只和你自己平时比");
  // the three numbers are all in the page, one shown at a time: it opens on the one the watch spoke about
  const trends = pp.getByTestId("watch-trend");
  await expect(trends).toHaveCount(3);
  await expect(trends.nth(0)).toHaveAttribute("data-metric", "rhr");
  await expect(trends.nth(1)).toHaveAttribute("data-metric", "sleep");
  await expect(trends.nth(2)).toHaveAttribute("data-metric", "steps");
  await expect(pp.getByTestId("watch-pick")).toHaveAttribute("data-shown", "rhr");
  await expect(trends.nth(0)).toBeVisible();
  await expect(trends.nth(1)).toBeHidden();
  await expect(trends.nth(2)).toBeHidden();
  await expect(pp.getByTestId("watch-card")).toHaveAttribute("data-state", "added");
  const rhrWeeks = pp.locator('[data-testid="watch-weeks"][data-metric="rhr"]').getByTestId("watch-week");
  await expect(rhrWeeks.nth(0)).toHaveAttribute("data-outside", "above");
  await expect(rhrWeeks.nth(1)).toHaveAttribute("data-outside", "above");
  await expect(rhrWeeks.nth(2)).toHaveAttribute("data-outside", "above");
  await expect(rhrWeeks.nth(4)).toHaveAttribute("data-outside", "no");
  await kit.show(trends.nth(0).getByTestId("watch-chart"));

  await kit.step(pp, "图下面是手表今天说的那一句，和他早上的回答：已经在问题单里");
  await expect(pp.getByTestId("watch-added")).toContainText("已在下次看诊的问题单里");
  await kit.show(pp.getByTestId("watch-added"));

  await kit.step(pp, "每周的平均写在下面；高于范围的那三周写明了，不说好坏");
  await kit.show(rhrWeeks.nth(2));

  await kit.step(pp, "上面换着看睡眠、步数：整页不提血压、不提药、不说原因");
  expect(await pp.getByTestId("page-watch").innerText()).not.toMatch(NEVER);
  for (const metric of ["sleep", "steps"] as const) {
    await pp.getByTestId("watch-pick").locator(`[data-seg="${metric}"]`).click();
    const shown = pp.locator(`[data-testid="watch-trend"][data-metric="${metric}"]`);
    await expect(shown).toBeVisible();
    await expect(trends.nth(0)).toBeHidden();
    await kit.show(shown.getByTestId("watch-chart"));
    expect(await pp.getByTestId("page-watch").innerText()).not.toMatch(NEVER);
  }
  await expect(pp.getByTestId("watch-source")).toContainText("示例数据");

  await kit.step(pp, "问题单里多了这一条，写明是手表上看到的");
  await openPage(elder, "/p/questions");
  const q = pp.getByText("手表显示，我的静息心率三周都高于我平时的范围", { exact: false }).first();
  await expect(q).toBeVisible();
  await kit.show(q);

  await kit.step(pp, "第二天早上：还是同一段，今天页上没有再问一遍");
  await advanceClock(request, 24 * 3_600_000);
  await openPage(elder, "/p/today");
  await expect(pp.locator('[data-today-section="bp"]')).toBeVisible();
  await expect(pp.getByTestId("today-watch")).toHaveCount(0);
  const view = await getJson<{ card: unknown }>(elder, "/api/watch");
  expect(view.card).toBeNull();

  await clearClock(request);
  await kit.finish();
});
