/**
 * Design group 14 「准备下次看诊」 in the timeline design (front-end line fe-14; web/progress/fe-fe-14.md): what the new
 * layout adds to the question list and the brief, and the page checks (e2e/_checks/page-checks.ts: no sideways scroll at
 * 360px, text at least 18px, targets at least 48x48, AA contrast) on every state of these pages, in 华语 and English.
 *
 *   the question list   its two sides (问医生 / 问药剂师) with how many each holds; a question added for the pharmacist
 *                       opens the pharmacist's side, and 「这条不问了」 and 「撤销」 leave him on it; an answered question
 *                       sits under 「已答的」 with the answer in the doctor's words, on the list and on the page of all
 *                       answered questions; the same words twice offer 「合并」
 *   the brief           whole sentences as rows; the page for the doctor is English first with one tap to 华语 on the
 *                       two-part control, has no 「我」 and no tab bar; a reading next to the warning line is a row of
 *                       its own; the page kept as it was shown says so
 * The states other specs already check (c-pages: the list's pages; real-daily and real-clock: the brief, the page for
 * the doctor, the kept page, the cell on Today) are checked again here only where this line added a state.
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): a production build
 * started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT names it.
 */
import { randomUUID } from "node:crypto";
import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { checkTextScaling, expectPageChecks } from "./_checks/page-checks";

// a development server compiles a route the first time it is opened: every wait here allows for that
const expect = baseExpect.configure({ timeout: 30_000 });

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
test.describe.configure({ mode: "serial", timeout: 240_000 });

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

/** A dev account signed in on this page's browser (never open "/" first: e2e/c-pages.spec.ts says why). */
async function account(page: Page, space: "example" | "blank") {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `q${randomUUID().slice(0, 12)}`, password: "a long test password", space } });
  expect(r.status(), await r.text()).toBe(201);
  if (space === "example") await page.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
}

async function addQuestion(page: Page, text: string, who: "doctor" | "pharmacist" = "doctor"): Promise<string> {
  const r = await page.request.post("/api/questions", { data: { text, for: who } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return ((await r.json()) as { question: { id: string } }).question.id;
}

async function checks(page: Page) {
  await expectPageChecks(page, { side: "elder" });
}

/** With the phone's text at 200% the words grow with it and the page still does not scroll sideways at 360px. */
async function scales(page: Page) {
  const s = await checkTextScaling(page, { factor: 2 });
  expect(s.count, "sampled text").toBeGreaterThan(3);
  expect(s.minRatio, "every sampled text grew with the root").toBeGreaterThanOrEqual(1.95);
  expect(s.overflow.doc, `sideways scroll at 200%: ${s.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("the question list has two sides; a question for the pharmacist is added, set aside and put back on the pharmacist's side", async ({ page, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  await account(page, "example");
  await setClock(request, SGT("2026-10-12", "10:10"));
  await page.goto("/p/questions");
  const open = page.locator('[data-rp="questions-open"]');
  const answered = page.locator('[data-rp="questions-answered"]');
  const seg = (who: string) => page.locator(`[data-rp="segmented"] [data-seg="${who}"]`);

  // the doctor's side: the screen's name and its one sentence, the two sides with their counts, 3 to ask, 2 answered
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("要问的");
  await expect(page.locator('[data-rp="headline"]')).toHaveText("下次看诊要问 3 个问题。");
  await expect(seg("doctor")).toHaveText("问医生 · 5");
  await expect(seg("doctor")).toHaveAttribute("aria-current", "true");
  await expect(seg("pharmacist")).toHaveText("问药剂师 · 1");
  await expect(open.locator("[data-question][data-status]")).toHaveCount(3);
  await expect(open.locator('[data-rp="section-title"]')).toHaveText("还没问的 · 3 个");
  // each question: his node, where it came from and when, his words, its buttons
  const knee = open.locator('[data-question="q-knee-2"][data-status]');
  await expect(knee).toHaveAttribute("data-node", "me");
  await expect(knee.locator(".rpu-tl-head")).toHaveText("我自己想问的 · 9月30日");
  await expect(knee.locator(".rpu-q-text")).toHaveText("膝盖止痛药还可以吃吗？");
  await expect(knee.locator('[data-rp="question-actions"] [data-action="edit"]')).toHaveText("改一下字");
  await expect(knee.locator('[data-rp="question-actions"] [data-action="skip"]')).toHaveText("这条不问了");
  // the pattern keeps Ripple's wording: no 「改一下字」
  await expect(open.locator('[data-question="q-tai-chi"][data-status] [data-action="edit"]')).toHaveCount(0);
  // the answered ones of this side, each with the doctor's own words
  await expect(answered.locator('[data-rp="section-title"]')).toHaveText("已答的 · 2 个");
  const wrist = answered.locator('[data-rp="question"][data-question="q-machine"]');
  // the pair is one element with a box of its own (it can be seen and scrolled to), holding the question and its answer
  await expect(wrist).toBeVisible();
  await expect(wrist.locator(".rpu-q-text")).toHaveText("家里那个机器是绑手腕的，可以用吗？");
  await expect(wrist.locator('[data-rp="question-answer"]')).toHaveAttribute("data-speaker", "doctor");
  await expect(wrist.locator('[data-rp="source-tag"]')).toHaveText("医生说 · 8月31日 · 1:15 处");
  await expect(wrist.locator('[data-rp="said"]')).toHaveText("手腕的不太准。买一个绑手臂的，upper arm 的。");
  // the checked Chinese under the doctor's English answer, with its label
  const kneeAnswer = answered.locator('[data-rp="question"][data-question="q-knee-1"]');
  await expect(kneeAnswer.getByTestId("answer-translation")).toContainText("中文翻译，以英文原话为准");
  await checks(page);
  await scales(page);

  // the pharmacist's side: nothing to ask, one answered, in the pharmacist's words
  await seg("pharmacist").click();
  await page.waitForURL("**/p/questions?for=pharmacist");
  await expect(seg("pharmacist")).toHaveAttribute("aria-current", "true");
  await expect(open).toHaveCount(0);
  await expect(answered.locator('[data-rp="section-title"]')).toHaveText("已答的 · 1 个");
  await expect(answered.locator('[data-rp="source-tag"]')).toContainText("药剂师说");
  await checks(page);

  // 「加一个问题」 from this side starts on 「问药剂师」; the list comes back on this side with the new row marked
  await page.getByTestId("questions-add").click();
  await page.waitForURL("**/p/questions/add?for=pharmacist");
  await expect(page.locator('[data-who="pharmacist"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="form-problem"]')).toHaveText("先写下你的问题。");
  await checks(page);
  await page.getByTestId("question-text-input").fill("这两种药可以放在同一个药盒里吗？");
  await expect(page.locator('[data-rp="form-problem"]')).toHaveCount(0);
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("加上了。");
  await expect(seg("pharmacist")).toHaveAttribute("aria-current", "true");
  await expect(seg("pharmacist")).toHaveText("问药剂师 · 2");
  const mine = open.locator("[data-question][data-status]", { hasText: "这两种药可以放在同一个药盒里吗？" });
  await expect(mine).toHaveAttribute("data-highlight", "true");
  await expect(mine).toContainText("刚加上的");
  await expect(page.locator('[data-rp="headline"]')).toHaveText("下次看诊要问 4 个问题。");
  await checks(page);
  const id = (await mine.getAttribute("data-question"))!;

  // 「这条不问了」: the row goes, the bar undoes it, and he is still on the pharmacist's side
  await page.locator(`[data-rp="question-actions"][data-question="${id}"] [data-action="skip"]`).click();
  const toast = page.locator('[data-rp="toast"]');
  await expect(toast).toContainText("这条不问了");
  await expect(seg("pharmacist")).toHaveAttribute("aria-current", "true");
  await expect(open).toHaveCount(0);
  await checks(page);
  await toast.getByRole("button").click();
  await expect(open.locator(`[data-question="${id}"][data-status]`)).toHaveCount(1);
  await expect(seg("pharmacist")).toHaveAttribute("aria-current", "true");
  expect(new URL(page.url()).search).toBe("?for=pharmacist");

  // set aside for good: its page has it with 「放回去」, and putting it back opens the side it is on
  await page.locator(`[data-rp="question-actions"][data-question="${id}"] [data-action="skip"]`).click();
  await expect(toast).toContainText("这条不问了");
  await page.goto("/p/questions/skipped");
  await expect(page.locator(`[data-question="${id}"][data-status="skipped"] .rpu-q-text`)).toHaveText("这两种药可以放在同一个药盒里吗？");
  await checks(page);
  await page.locator('[data-action="put-back"]').click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("这个问题放回单子上了。");
  await expect(seg("pharmacist")).toHaveAttribute("aria-current", "true");
  await expect(open.locator(`[data-question="${id}"][data-status]`)).toContainText("放回来了");
  await page.goto("/p/questions/skipped");
  await expect(page.getByTestId("questions-skipped-none")).toHaveText("没有不问了的问题。");
  await checks(page);
});

test("the same words twice offer 「合并」; a question the doctor answered before opens that answer; every answered question is on one page", async ({ page, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  await account(page, "example");
  await setClock(request, SGT("2026-10-12", "10:10"));
  const swim = await addQuestion(page, "我可以去游泳吗？");
  // he changes its words into the words of the row above it
  await page.goto(`/p/questions/${swim}/edit`);
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("改一下这个问题");
  await page.getByTestId("question-text-input").fill("膝盖止痛药还可以吃吗？");
  await checks(page);
  await page.getByTestId("question-submit").click();
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("改好了。");
  const row = page.locator(`[data-rp="questions-open"] [data-question="${swim}"][data-status]`);
  await expect(row).toContainText("刚改过");
  await expect(row).toContainText("你改过的字");
  const merge = page.locator(`[data-rp="question-actions"][data-question="${swim}"] [data-action="merge"]`);
  await expect(merge).toHaveText("和上面那条一样，合并");
  await checks(page);
  await merge.click();
  await expect(page.locator('[data-rp="toast"]')).toContainText("合并了");
  await expect(row).toHaveCount(0);
  await checks(page);

  // the words of a question the doctor already answered: he is shown that answer, marked, on the page of all answers
  await page.goto("/p/questions/add");
  await page.getByTestId("question-text-input").fill("家里那个机器是绑手腕的，可以用吗？");
  await page.getByTestId("question-submit").click();
  await page.waitForURL("**/p/questions/answered?q=q-machine");
  await expect(page.locator('[data-rp="questions-notice"]')).toHaveText("医生已经回答过这个问题。");
  await expect(page.locator('[data-rp="question"][data-question="q-machine"]')).toHaveAttribute("data-highlight", "true");
  // the doctor's and the pharmacist's answers together, question then answer, one line
  await expect(page.locator('[data-rp="question"][data-status="answered"]')).toHaveCount(3);
  await expect(page.locator('[data-rp="question"] [data-rp="question-answer"]')).toHaveCount(3);
  expect(await page.locator('[data-rp="tl-item"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-node")))).toEqual(["me", "doc", "me", "doc", "me", "doc"]);
  // the rule runs through the pairs: it starts at the first node, ends at the last, and is whole in between
  const rails = await page.locator('[data-rp="tl-item"] > .rpu-tl-rail').evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el, "::before");
      return { shown: cs.display !== "none", fromTop: cs.top !== "0px", toBottom: cs.bottom === "0px" };
    }),
  );
  expect(rails.map((r) => r.shown)).toEqual([true, true, true, true, true, true]);
  expect(rails[0]).toMatchObject({ fromTop: true, toBottom: true });
  expect(rails.slice(1, 5).every((r) => !r.fromTop && r.toBottom)).toBe(true);
  expect(rails[5]).toMatchObject({ fromTop: false, toBottom: false });
  await checks(page);
});

test("a blank account: nothing to ask, nothing answered, no brief yet; then one question for the pharmacist only", async ({ page, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  await account(page, "blank");
  await page.goto("/p/questions");
  await expect(page.locator('[data-rp="headline"]')).toHaveText("还没有要问的。");
  await expect(page.locator('[data-rp="questions-open"]')).toHaveCount(0);
  await expect(page.getByTestId("questions-none-here")).toHaveCount(0);
  await expect(page.getByTestId("questions-add")).toBeVisible();
  await checks(page);
  await page.goto("/p/questions/answered");
  await expect(page.getByTestId("questions-answered-none")).toHaveText("还没有回答过的问题。");
  await checks(page);
  await page.goto("/p/brief");
  await expect(page.getByTestId("brief-empty")).toHaveText("还没有看诊记录。第一次看诊后，这里会有给医生看的一页。");
  await expect(page.getByTestId("brief-show-doctor")).toHaveCount(0);
  await checks(page);

  await addQuestion(page, "这两种药可以放在同一个药盒里吗？", "pharmacist");
  await page.goto("/p/questions?for=doctor");
  await expect(page.locator('[data-rp="headline"]')).toHaveText("下次看诊要问 1 个问题。");
  await expect(page.getByTestId("questions-none-here")).toHaveText("还没有要问医生的。");
  await checks(page);
});

test("when the brief cannot be drawn the screen says so and 「再试一次」 draws it; before it arrives the screen shows its header and bars", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  // nothing on an offline server fails by itself: one part of the brief is made to fail in this browser (the doctor's
  // recording cannot be set up), which is what the brief's boundary is for (components/brief/BriefError.tsx)
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await context.addInitScript(() => {
    const w = window as unknown as { __briefFails?: boolean };
    w.__briefFails = true;
    const listen = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function (this: HTMLMediaElement, ...args: Parameters<typeof listen>) {
      if (w.__briefFails) throw new Error("fe-14-pages: the brief is made to fail here");
      return listen.apply(this, args);
    } as typeof listen;
  });
  const page = await context.newPage();
  await account(page, "example");
  await page.goto("/p/brief");
  const failed = page.getByTestId("brief-error");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("现在读不到资料。");
  await expect(failed).toContainText("你记下的东西都还在");
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("看诊简报");
  await expect(failed.locator('a[href="/p/today"]')).toHaveText("先看今天");
  // it is still a page of his: the tab bar stays
  await expect(page.locator('[data-rp="tabbar"]')).toBeVisible();
  await expect(page.getByTestId("page-brief")).toHaveCount(0);
  await checks(page);
  await page.evaluate(() => {
    (window as unknown as { __briefFails?: boolean }).__briefFails = false;
  });
  await page.getByTestId("brief-error-retry").click();
  await expect(page.getByTestId("page-brief")).toBeVisible();
  await expect(failed).toHaveCount(0);
  await context.close();

  // the page as the server first sends it: the screen's header, one line that says what is being opened, quiet bars,
  // and the brief itself after them (a browser without scripts shows exactly this part)
  const plain = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  const made = await plain.request.post("/api/dev/accounts", { data: { login: `q${randomUUID().slice(0, 12)}`, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  const waiting = await plain.newPage();
  await waiting.goto("/p/brief");
  await expect(waiting.getByTestId("brief-loading")).toBeVisible();
  await expect(waiting.getByTestId("brief-loading")).toContainText("正在打开看诊简报…");
  await expect(waiting.locator('[data-rp="page-title"]').first()).toHaveText("看诊简报");
  await waiting.goto("/p/brief?show=doctor");
  await expect(waiting.getByTestId("brief-loading")).toContainText("Opening the visit brief…");
  await expect(waiting.locator('[data-rp="tabbar"]:visible')).toHaveCount(0);
  await plain.close();
});

for (const locale of ["zh-Hans", "en"] as const) {
  test(`the brief in the timeline design: his page, the page for the doctor, a reading next to the warning line, the kept page (${locale})`, async ({ page, request, baseURL }) => {
    await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    const zh = locale === "zh-Hans";
    await setClock(request, SGT("2026-10-12", "10:00"));
    await account(page, "example");
    await setClock(request, SGT("2026-10-12", "10:05"));
    expect((await page.request.post("/api/bp", { data: { id: randomUUID(), systolic: 185, diastolic: 112 } })).status()).toBe(201);
    await setClock(request, SGT("2026-10-12", "10:10"));

    // his own page: the screen's name, the period under it, 「我」, the tab bar; sentences whole, as rows
    await page.goto("/p/brief");
    await expect(page.locator('[data-rp="page-title"]')).toHaveText(zh ? "看诊简报" : "Visit brief");
    await expect(page.getByTestId("brief-window")).toHaveText(zh ? "上次看诊（9月8日）之后：9月9日到10月12日" : "Since the visit on 8 Sep: 9 Sep to 12 Oct");
    await expect(page.locator('[data-rp="meta"] a[data-kind="me"]')).toHaveCount(1);
    await expect(page.locator('[data-rp="tabbar"]')).toBeVisible();
    const bp = page.getByTestId("brief-bp");
    await expect(bp.locator('[data-rp="list-item"]').first()).toContainText(zh ? "记了 11 次，平均 144/87" : "11 readings, average 144/87");
    await expect(page.getByTestId("brief-bp-mirror")).toHaveText(zh ? "其中 10 次不低于医生 8月31日 说的 135/85" : "10 of them not below the doctor's 135/85 of 31 Aug");
    const target = page.getByTestId("brief-target");
    await expect(target).toHaveAttribute("data-node", "doc");
    await expect(target.locator('[data-rp="said"]')).toHaveText("“At home, we want it below 135 over 85.”");
    await expect(target.locator('[data-rp="listen"] button')).toContainText(zh ? "听原声" : "Hear it");
    // the reading next to the doctor's warning line: its own card, one row, the line quoted under it
    const above = page.getByTestId("brief-above");
    await expect(above).toHaveAttribute("data-count", "1");
    await expect(above.getByTestId("brief-above-title")).toHaveText(zh ? "医生说过的线（8月31日）：上面的数 180。放在它旁边的读数：" : "The doctor's line (31 Aug): 180 on top. These readings, next to it:");
    await expect(above.getByTestId("brief-above-reading")).toHaveText(zh ? "185/11210月12日 早上 10:05" : "185/11212 Oct, 10:05 am");
    await expect(above.locator('[data-rp="said"]')).toContainText("180");
    await expect(page.getByTestId("brief-doses-missed")).toHaveText(
      zh ? "没吃的 4 次都在周二、周四（打太极的早上）：9月15日、9月17日、9月24日、10月6日" : "The 4 missed were all on Tuesdays and Thursdays (tai chi mornings): 15 Sep, 17 Sep, 24 Sep, 6 Oct",
    );
    await expect(page.getByTestId("brief-note")).toHaveCount(2);
    await expect(page.getByTestId("brief-question").locator('[data-mk="num"]')).toHaveText(["1", "2", "3"]);
    await checks(page);
    await scales(page);

    // the page for the doctor: English first whatever his language, no 「我」, no tab bar, the two-part control
    await page.getByTestId("brief-show-doctor").click();
    const doctor = page.getByTestId("brief-doctor");
    await expect(doctor).toHaveAttribute("data-lang", "en");
    await expect(page.getByTestId("brief-shown")).toHaveAttribute("data-shown", "kept");
    await expect(doctor.locator('[data-rp="page-title"]')).toHaveText("For the doctor");
    await expect(doctor.locator('[data-rp="meta-story"]')).toHaveText("Since the visit on 8 Sep: 9 Sep to 12 Oct");
    await expect(page.locator('[data-kind="me"]')).toHaveCount(0);
    await expect(page.locator('[data-rp="tabbar"]')).toHaveCount(0);
    await expect(doctor.locator('[data-seg="en"]')).toHaveAttribute("aria-pressed", "true");
    await expect(doctor.locator('[data-seg="zh-Hans"]')).toHaveText("华语");
    // offline nothing is translated: his notes say so, and stay in his words
    await expect(doctor.getByTestId("brief-note").first()).toContainText("his own words, not translated");
    await expect(doctor.locator('[data-verbatim="note"]')).toHaveCount(2);
    await expect(doctor.locator('[data-rp="listen"]')).toHaveCount(0);
    await checks(page);
    await doctor.locator('[data-seg="zh-Hans"]').click();
    await expect(doctor).toHaveAttribute("data-lang", "zh-Hans");
    await expect(doctor.locator('[data-rp="page-title"]')).toHaveText("给医生看");
    await expect(doctor.locator('[data-seg="zh-Hans"]')).toHaveAttribute("aria-pressed", "true");
    await expect(doctor.getByTestId("brief-target-translation")).toContainText("中文翻译，以英文原话为准");
    await checks(page);
    // the header's way back and 「看完了」 go to the same place
    expect(await doctor.locator('[data-rp="back"]').getAttribute("href")).toBe(await page.getByTestId("brief-doctor-done").getAttribute("href"));
    await page.getByTestId("brief-doctor-done").click();
    await page.waitForURL("**/p/brief");

    // the page kept as it was shown: a row of his brief opens it, and it says what it is, in his language
    const last = page.getByTestId("brief-last-shown");
    await expect(last.locator('[data-rp="list-item"]')).toContainText(zh ? "上次给医生看的那一页" : "Last shown to the doctor");
    await checks(page);
    await last.locator("a").click();
    await expect(doctor).toHaveAttribute("data-kept", "true");
    await expect(page.getByTestId("brief-kept-note")).toContainText(zh ? "给医生看的那一页，内容不会再变" : "It stays as it was.");
    await expect(doctor.getByTestId("brief-above")).toHaveAttribute("data-count", "1");
    await checks(page);
  });
}
