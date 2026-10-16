/**
 * 13 饮食 — on a real account (C2 track K; 老人端提示词 13; M16; e2e-chains 11).
 *
 *   10月12日 19:00 (developer test clock, frozen)   a new account with Mr Tan's example data (his first visit was 8月31日:
 *                                                   Dr Lim's "Cut down on salt. Less gravy, don't finish the soup." is in
 *                                                   his record; at 9月8日 Dr Lim said his blood pressure is high; he takes
 *                                                   amlodipine)
 *   Today         the day's one question, under blood pressure (track K's DietCheckSection in track B's Today), there
 *                 only because Dr Lim gave a diet instruction and taken from his words: 「今天的汤，有没有喝完？」
 *                 有 / 没有 / 不记得; 没有 is noted, never judged
 *   「我」 → 饮食   Dr Lim's own words first (医生说 · 8月31日 · 0:42) with today's answer under them; the official lines
 *                 for high blood pressure, each with its source page and review date; grapefruit only from the leaflet;
 *                 his hawker dishes (鸡饭, 汤面) with the official eating-out lines; the referral for a special diet
 *   three days    his morning medicine is answered in the morning (off screen); each evening the question is on Today
 *                 again and he answers it there; the week's line counts his answers (the same line the brief carries)
 */
import { expect, journey } from "./_kit";
import { advanceClock, clearClock, getJson, newAccount, openPage, setClock, takeMorningDose } from "./_k/account";

const DR = "Cut down on salt. Less gravy, don't finish the soup. And keep up your morning walks.";
const NEVER = /你应该|你需要|建议|能降|降血压的|控制血压|\d+\s*(?:克|毫克|g\b|mg\b)/;
const HOUR = 3_600_000;

journey("13 饮食", async ({ kit, request }) => {
  await setClock(request, "2026-10-12T19:00:00+08:00");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await newAccount(elder, { space: "example" });
  await openPage(elder, "/p/today");

  const check = pp.getByTestId("diet-check");
  const answer = (a: "yes" | "no" | "unsure") => check.locator(`[data-testid="diet-answer"][data-answer="${a}"]`);
  const onToday = pp.getByTestId("today-diet");

  await kit.step(pp, "陈先生（示例资料）晚上打开今天页：量血压的下面有今天的一问，因为医生交代过饮食");
  await expect(onToday).toBeVisible();
  await expect(onToday.getByTestId("diet-check")).toHaveAttribute("data-today", "none");
  await kit.show(onToday);

  await kit.step(pp, "问的就是医生那句话里的：「今天的汤，有没有喝完？」有、没有、不记得");
  await expect(check).toHaveAttribute("data-item", "soup");
  await expect(check).toContainText("今天的汤，有没有喝完？");
  await expect(answer("yes")).toHaveText("有");
  await expect(answer("no")).toHaveText("没有");
  await expect(answer("unsure")).toHaveText("不记得");

  await kit.step(pp, "他点「没有」：记下来，不说好坏");
  await answer("no").click();
  await expect(check.getByTestId("diet-answered")).toContainText("已记下：没有");
  await expect(check).not.toContainText(/很好|不错|好棒|太好|不好|应该/);

  await kit.step(pp, "想看详细：在「我」里点「饮食」");
  await openPage(elder, "/p/me");
  const entry = pp.locator('[data-entry="diet"]');
  await kit.show(entry);
  await entry.click();
  await pp.waitForURL(/\/p\/diet$/);
  await expect(pp.getByTestId("diet-screen")).toBeVisible();

  await kit.step(pp, "最上面是医生自己说的饮食的话：8月31日看诊时，录音 0:42；他今天的回答也在这里");
  const dr = check.getByTestId("diet-doctor");
  await expect(dr).toHaveAttribute("data-source", "v1:v1-u07");
  await expect(dr.locator('[data-rp="said"]')).toContainText(DR);
  await expect(dr.locator('[data-rp="source-tag"]')).toContainText("8月31日 · 0:42");
  await expect(check).toHaveAttribute("data-today", "no");
  await expect(check.getByTestId("diet-answered")).toContainText("已记下：没有");

  await kit.step(pp, "下面是官方的饮食条目：他有高血压，每条写明是哪个官方页面、哪天核对的");
  const cond = pp.locator('[data-testid="diet-condition"][data-condition="hypertension"]');
  await expect(cond).toBeVisible();
  const lines = cond.getByTestId("diet-line");
  expect(await lines.count()).toBeGreaterThanOrEqual(4);
  await expect(lines.first()).toContainText("写着");
  await expect(lines.first()).toContainText("2026年10月10日 核对");
  expect(await lines.first().getAttribute("data-url")).toMatch(/^https:\/\/(?:www\.)?(?:healthhub\.sg|hpb\.gov\.sg)\//);
  await kit.show(lines.first());

  await kit.step(pp, "西柚只来自药的单张：吃氨氯地平期间不要吃西柚");
  const gf = pp.getByTestId("diet-grapefruit");
  await expect(gf).toContainText("单张写着：吃氨氯地平期间不要吃西柚。");
  await kit.show(gf);

  await kit.step(pp, "他常在小贩中心吃鸡饭和汤面：点「我常吃的小贩中心食物」，再点这两样");
  // his own dishes have a screen of their own (the timeline design's 13-2)
  const openFoods = pp.getByTestId("diet-foods-open");
  await kit.show(openFoods);
  await openFoods.click();
  await pp.waitForURL(/\/p\/diet\?view=foods$/);
  const food = (id: string) => pp.locator(`[data-testid="diet-food"][data-food="${id}"]`);
  await kit.show(food("chicken_rice"));
  await food("chicken_rice").click();
  await expect(food("chicken_rice")).toHaveAttribute("aria-pressed", "true");
  await food("noodle_soup").click();
  await expect(food("noodle_soup")).toHaveAttribute("aria-pressed", "true");

  await kit.step(pp, "每样下面列出官方写的吃法，同样带出处");
  const picked = pp.getByTestId("diet-picked");
  await expect(picked).toHaveCount(2);
  await expect(picked.nth(0)).toHaveAttribute("data-food", "chicken_rice");
  await expect(picked.nth(0).getByTestId("diet-line").first()).toBeVisible();
  await kit.show(picked.nth(0));
  await kit.show(picked.nth(1));

  await kit.step(pp, "回到饮食页，最后一句：肾病、心衰这类要特别注意饮食的，问医生或营养师");
  await pp.locator('[data-rp="back"]').click();
  await pp.waitForURL(/\/p\/diet$/);
  const special = pp.getByTestId("diet-special");
  await expect(special).toHaveAttribute("data-first", "false");
  await expect(special).toContainText("问医生或营养师");
  await kit.show(special);
  expect(await pp.getByTestId("diet-screen").innerText()).not.toMatch(NEVER);

  await kit.step(pp, "接下来三个晚上：早上的药他早上就记了；晚上今天页上又是这一问，他每天回答一次");
  for (const a of ["yes", "unsure", "no"] as const) {
    await advanceClock(request, 13 * HOUR + 50 * 60_000); // the next morning, 8:50
    await takeMorningDose(elder);
    await advanceClock(request, 10 * HOUR + 10 * 60_000); // that evening, 19:00
    await openPage(elder, "/p/today");
    await expect(onToday.getByTestId("diet-check")).toHaveAttribute("data-today", "none");
    await expect(onToday).toContainText("今天的汤，有没有喝完？");
    await answer(a).click();
    await expect(check.getByTestId("diet-answered")).toHaveAttribute("data-answer", a);
    await kit.pause(600);
  }

  await kit.step(pp, "这一周的饮食核对只数他的回答：7 天里答了 4 天，汤喝完 1 天、没喝完 2 天、不记得 1 天");
  await openPage(elder, "/p/diet");
  const week = pp.getByTestId("diet-week");
  await expect(week).toContainText("7 天里答了 4 天；汤喝完了 1 天，没喝完 2 天，不记得 1 天。");
  await kit.show(week);
  const view = await getJson<{ week: string | null }>(elder, "/api/diet");
  expect(view.week).toContain("10月9日–10月15日");

  await clearClock(request);
  await kit.finish();
});
