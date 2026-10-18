/**
 * 22 评委入口和示例资料 (track C): a judge's account on Mr Tan's example data (real-app 2.2, 4.1-4.8).
 *
 * The account is made the way sign-up's 「用陈先生的示例资料」 makes it (seedAccount; here through the developer helper,
 * POST /api/dev/accounts with space "example", until track A's sign-up pages are merged): today is day 42 of his
 * story, his six weeks are laid out on the real dates before it. On Today: the quiet example line, the one-time intro
 * (put away for good), and the row 「可以这样问」, which opens the ask screen with the example's three sentences (a tap
 * only fills the box). The hero question is answered from the example's
 * own records on shifted dates (Dr Lim's R4 with its clip, the label, no dose advice). His question list: add, the same
 * words again (merged, no second row), change the words, set one aside and undo, the doctor's answers word for word
 * with the date and the time point in the recording. Then the example's own page: lay it out again (back to day 42,
 * his additions gone), and start from his own (a blank space, setting up begins).
 *
 * The test clock is frozen at 07:40 today (Singapore), before the morning reminder, so Today shows its calm overview
 * (with the example's banner) every run; it is cleared at the end. The ask is track S's: Today's field, then the answer's
 * own screen (/p/ask). The past visits' transcripts are the replay files laid out as the example's records: corner label.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, journey } from "./_kit";

const PASSWORD = "a long test password";
const HERO = "今天 150/95，我能不能多吃一粒？";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const KNEE_ANSWER = "Which one? Bring it next time and show me. For now, try not to take it every day.";
const SWIM = "我可以去游泳吗？";
const SWIM_EDITED = "我可以去游泳池游泳吗？";

/** Today in Singapore, and n days from it, as YYYY-MM-DD. */
function sgDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
const zhShort = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

async function questionList(request: APIRequestContext) {
  const r = await request.get("/api/questions");
  expect(r.status()).toBe(200);
  return ((await r.json()) as { list: { open: { id: string; text: string }[]; answered: { id: string }[]; skipped: { id: string }[] } }).list;
}

async function openList(page: Page) {
  await page.goto("/p/questions");
  await expect(page.locator('[data-rp="questions-open"]')).toBeVisible();
}

journey("22 评委入口和示例资料", async ({ kit, request }) => {
  const today = sgDate();
  const v2Date = sgDate(-34); // d0 + 8, d0 = today - 42
  const clock = await request.post("/api/dev/clock", { data: { at: `${today}T07:40:00+08:00`, frozen: true } });
  expect(clock.status(), await clock.text()).toBe(200);
  kit.cornerLabel("转写：测试替身（示例资料）");

  const { judge } = await kit.phones({ judge: "评委的手机" });
  const page = judge.page;
  const api = judge.context.request;
  const made = await api.post("/api/dev/accounts", { data: { login: `judge${Date.now().toString(36)}`, password: PASSWORD, space: "example", display_name: "评委" } });
  expect(made.status(), await made.text()).toBe(201);
  expect(((await made.json()) as { scope: { story_day: number; example_data: boolean } }).scope).toMatchObject({ story_day: 42, example_data: true });
  await judge.open("/p/today");

  // ---- Today on the example
  await kit.step(page, "评委用「陈先生的示例资料」开了账号：最上面一行写明这是示例资料，下面一张说明卡");
  const line = page.locator('[data-rp="example-line"]');
  await expect(line).toContainText("陈先生的示例资料（虚构）");
  const intro = page.locator('[data-rp="example-intro"]');
  await expect(intro).toContainText("他 6 周前第一次看医生，后来开了降压药，今天要去复诊。");
  await kit.show(intro);

  await kit.step(page, "说明卡只出现一次：点「知道了」收起，刷新也不再出现");
  await page.locator('[data-action="example-intro-dismiss"]').click();
  await expect(intro).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-live="open"]').first()).toBeAttached();
  await expect(line).toBeVisible();
  await expect(intro).toHaveCount(0);

  await kit.step(page, "今天页上有一行「可以这样问」，点开是问一句：三句都标着示例，点第一句，字只是填进输入框");
  // the three sentences are on the ask screen (the timeline design's 22-2); Today keeps one row that leads there
  const toAsks = page.locator('[data-action="example-asks-open"]');
  await expect(toAsks).toContainText(HERO);
  await kit.show(toAsks);
  await toAsks.click();
  await page.waitForURL("**/p/ask");
  const asks = page.locator('[data-action="example-ask"]');
  await expect(asks).toHaveCount(3);
  await kit.show(page.locator('[data-rp="example-asks"]'));
  await asks.first().click();
  const input = page.getByTestId("ask-input");
  await expect(input).toHaveValue(HERO);
  await kit.show(input);

  await kit.step(page, "点「问这句」：Ripple 不答剂量，先给 Dr Lim 在第二次看诊时的原话，日期按今天往回推");
  const answered = page.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await page.getByTestId("ask-field").locator('button[type="submit"]').click();
  const res = await answered;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { route?: string; sentences?: { sourceId: string }[]; addedQuestionId?: string };
  expect(body.route).toBe("refuse_route");
  expect(body.sentences?.map((s) => s.sourceId)).toContain("visit:v2:R4");
  await page.waitForURL("**/p/ask");
  const turn = page.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(turn).toHaveAttribute("data-route", "refuse_route");
  const r4 = turn.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await kit.show(r4);
  await expect(r4.locator('[data-rp="said"]')).toContainText(R4);
  await expect(r4.locator('[data-rp="source-tag"]')).toContainText("医生说");
  await expect(r4.locator('[data-rp="source-tag"]')).toContainText(`${zhShort(v2Date)} · 0:43`);
  for (const w of ["可以多吃", "没关系", "不要紧", "加一粒", "两粒"]) await expect(turn).not.toContainText(w);

  await kit.step(page, "点原话下面的「听原声」，听这句原声（代录音）");
  const clip = r4.getByTestId("answer-clip");
  await expect(clip).toHaveAttribute("data-src", "/api/visits/v2/clip?u=v2-u08");
  await clip.click(); // the clip hook is the play button itself (track S's answer card)
  await kit.waitForAudio("v2-u08", { until: "ended", timeout: 20_000 });

  // ---- his question list
  await kit.step(page, "这个问题记在问题单上：打开「要问的」，下次看诊要问的问题，用他自己的话");
  const added = turn.locator('[data-testid="ask-question-added"], [data-testid="answer-answered-before"]').first();
  await expect(added).toBeVisible();
  await added.locator("a").first().click();
  await page.waitForURL("**/p/questions");
  await expect(page.locator('[data-rp="questions-open"]')).toBeVisible();
  if (body.addedQuestionId) await expect(page.locator(`[data-rp="questions-open"] [data-question="${body.addedQuestionId}"][data-status]`)).toHaveCount(1);
  await expect(page.locator('[data-rp="headline"]')).toContainText("下次看诊要问");
  const knee = page.locator('[data-question="q-knee-2"]').first();
  await expect(knee).toContainText("膝盖止痛药还可以吃吗？");
  await expect(page.locator('[data-question="q-tai-chi"]').first()).toContainText("打太极");
  const before = await questionList(api);

  await kit.step(page, "点「加一个问题」：写下想问医生的话，点「加上」");
  await page.getByTestId("questions-add").click();
  await kit.type(page.getByTestId("question-text-input"), SWIM);
  await expect(page.locator('[data-who="doctor"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("加上了。");
  const swimRow = page.locator('[data-rp="questions-open"] [data-question]', { hasText: SWIM }).first();
  await expect(swimRow).toBeVisible();
  await expect(swimRow).toContainText("刚加上的");
  await kit.show(swimRow);
  const afterAdd = await questionList(api);
  expect(afterAdd.open.length).toBe(before.open.length + 1);
  const swimId = afterAdd.open.find((q) => q.text === SWIM)!.id;

  await kit.step(page, "同样的问题再加一次：不会多出一条，告诉他已经在单子上了");
  await page.getByTestId("questions-add").click();
  await kit.type(page.getByTestId("question-text-input"), "膝盖止痛药还可以吃吗");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("这个问题已经在单子上了。");
  await expect(page.locator('[data-question="q-knee-2"]').first()).toContainText("已经在单子上");
  await kit.show(page.locator('[data-question="q-knee-2"]').first());
  expect((await questionList(api)).open.length).toBe(afterAdd.open.length);

  await kit.step(page, "点「改一下字」，把问题改成自己更想问的说法");
  await page.locator(`[data-rp="question-actions"][data-question="${swimId}"] [data-action="edit"]`).click();
  await expect(page.getByTestId("question-text-input")).toHaveValue(SWIM);
  await kit.type(page.getByTestId("question-text-input"), SWIM_EDITED);
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("改好了。");
  await expect(page.locator(`[data-question="${swimId}"]`).first()).toContainText(SWIM_EDITED);

  await kit.step(page, "点「这条不问了」：这条马上收起，底下的黑条 12 秒内能撤销");
  await page.locator(`[data-rp="question-actions"][data-question="${swimId}"] [data-action="skip"]`).click();
  const toast = page.locator('[data-rp="toast"]');
  await expect(toast).toContainText("这条不问了");
  await expect(page.locator(`[data-rp="questions-open"] [data-question="${swimId}"][data-status]`)).toHaveCount(0);
  expect((await questionList(api)).skipped.map((q) => q.id)).toContain(swimId);

  await kit.step(page, "点「撤销」：问题回到单子上");
  await toast.getByRole("button").click();
  await expect(page.locator(`[data-rp="questions-open"] [data-question="${swimId}"][data-status]`)).toHaveCount(1);
  expect((await questionList(api)).open.map((q) => q.id)).toContain(swimId);

  await kit.step(page, "「医生回答过的」：医生的原话一字不改，标着哪天、录音里第几分几秒");
  await page.locator('a[href="/p/questions/answered"]').click();
  const kneeAnswer = page.locator('[data-question="q-knee-1"]');
  await expect(kneeAnswer.locator('[data-rp="said"]')).toHaveText(KNEE_ANSWER);
  await expect(kneeAnswer.locator('[data-rp="source-tag"]')).toContainText("医生说");
  await expect(kneeAnswer.locator('[data-rp="source-tag"]')).toContainText(`${zhShort(v2Date)} · 1:04 处`);
  await kit.show(kneeAnswer);

  // ---- the example's own page
  await kit.step(page, "每一屏页头下面都有「陈先生的示例资料（虚构）」这一行，点开写着从哪天开始、今天是复诊那天");
  await openList(page);
  await expect(page.locator('[data-rp="example-line"]')).toHaveCount(1);
  await page.locator('[data-rp="example-line"]').click();
  await page.waitForURL("**/p/me/example");
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("示例资料");
  await expect(page.locator('[data-rp="example-actions"]')).toBeVisible();

  await kit.step(page, "页头右上的「我」里，示例账号多两行：「重新铺一遍示例资料」和「清空，从我自己的开始」");
  await openList(page);
  await page.locator('[data-kind="me"]').click();
  await page.waitForURL("**/p/me");
  await expect(page.locator('[data-entry="example-reseed"]')).toContainText("重新铺一遍示例资料");
  await expect(page.locator('[data-entry="example-clear"]')).toContainText("清空，从我自己的开始");
  await kit.show(page.locator('[data-entry="example-reseed"]'));

  await kit.step(page, "点「重新铺一遍示例资料」：这一屏说清会清掉什么，再点一下才做；按今天重新铺好六周，刚才加的问题都清掉");
  await page.locator('[data-entry="example-reseed"]').click();
  await page.waitForURL("**/p/me/example?do=reseed");
  await expect(page.locator('[data-rp="example-actions"]')).toContainText("你点过的、记下的都会清掉");
  await page.locator('[data-action="example-reseed"]').click();
  await page.waitForURL("**/p/today");
  await expect(page.locator('[data-rp="example-intro"]')).toBeVisible();
  const reseeded = await questionList(api);
  expect(reseeded.open.map((q) => q.id).sort()).toEqual(["q-extra-tablet", "q-knee-2", "q-tai-chi"]);
  expect(reseeded.open.some((q) => q.text === SWIM_EDITED)).toBe(false);
  const scope = (await (await api.get("/api/profile")).json()) as { profile: { example: boolean; onboarding: string } };
  expect(scope.profile).toMatchObject({ example: true, onboarding: "done" });

  await kit.step(page, "想从自己的资料开始：点「清空，从我自己的开始」，示例全部删掉，从建档开始");
  await page.goto("/p/me");
  await page.locator('[data-entry="example-clear"]').click();
  await page.waitForURL("**/p/me/example?do=clear");
  await page.locator('[data-action="example-clear"]').click();
  await page.waitForURL("**/onboard/who");
  await expect(page.locator('[data-rp="headline"]')).toHaveText("现在是谁在填？");
  const cleared = (await (await api.get("/api/profile")).json()) as { profile: { example: boolean; onboarding: string; clinic: string | null } };
  expect(cleared.profile).toMatchObject({ example: false, onboarding: "started", clinic: null });
  expect((await questionList(api)).open).toEqual([]);

  const reset = await request.post("/api/dev/clock", { data: { clear: true } });
  expect(reset.status()).toBe(200);
  await kit.finish();
});
