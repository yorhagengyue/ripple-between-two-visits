/**
 * Page checks on track C's screens (架构审核 「每个页面自动查」; e2e/_checks/page-checks.ts): no sideways scroll at 360px,
 * no text under 18px, no target under 48x48, no contrast violation, on his question list (and its add, change,
 * answered and set-aside screens), his profile (with a family member's facts waiting, and without), 「我」, the example
 * account's page and banner, and every setting-up screen, in 华语 and in English.
 * The setting-up screens and the profile are laid out after the timeline draft's 01-5a to 01-5f and 01-6
 * (web/progress/fe-01.md): the checks also open the states that layout added (the routine as a list with its form,
 * breakfast changed in place, the reminder line and 「改时间」, a save that failed, the facts one at a time).
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): a production build
 * started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT names it.
 */
import { expect, test, type Page } from "@playwright/test";
import { checkTextScaling, expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";

/**
 * A dev account signed in on this page's browser. Never open "/" first: it goes to /demo, which makes a judge sandbox and
 * sets rp_view=demo, and a browser looking at the demo is answered by the demo before its account (lib/subject/resolve.ts).
 */
async function account(page: Page, space: "example" | "blank", extra: Record<string, unknown> = {}) {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `c${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, space, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
}

async function check(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.locator(ready).first()).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

for (const locale of ["zh-Hans", "en"] as const) {
  test.describe(`track C screens (${locale})`, () => {
    test(`「开提醒」: every outcome of track I's enablePush reads right and can be left (${locale})`, async ({ browser, baseURL }) => {
      // a refusal (this browser's own answer when nobody allowed notifications), an iPhone outside the home screen, a
      // browser without push: the step says what happened in one sentence and offers 「下一步」
      for (const setup of ["denied", "iphone", "unsupported"] as const) {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 390, height: 844 },
          locale: "zh-CN",
          timezoneId: "Asia/Singapore",
          ...(setup === "iphone" ? { userAgent: IPHONE_UA, isMobile: true, hasTouch: true } : {}),
        });
        if (setup === "unsupported") await context.addInitScript(() => void delete (window as unknown as { PushManager?: unknown }).PushManager);
        const page = await context.newPage();
        await context.addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
        await account(page, "blank", { onboarding: "started" });
        await check(page, "/onboard/reminders", '[data-testid="onboard-reminders-on"]');
        await page.getByTestId("onboard-reminders-on").click();
        const result = page.locator('[data-rp="reminders-result"]');
        await expect(result).toBeVisible();
        const state = await result.getAttribute("data-state");
        if (setup === "iphone") expect(state).toBe("needs_home_screen");
        else if (setup === "unsupported") expect(state).toBe("unsupported");
        else expect(["denied", "default"]).toContain(state);
        await expectPageChecks(page, { side: "elder" });
        // whatever happened, he can go on: 「下一步」 (settled) or 「以后再说」 (he may try again)
        const next = page.getByTestId(state === "default" ? "onboard-reminders-later" : "onboard-reminders-next");
        await next.click();
        await page.waitForURL("**/onboard/done");
        await context.close();
      }
    });

    test(`the example account: question list, its screens, profile, 「我」, the example page (${locale})`, async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      await account(page, "example");
      // a question of his own and one set aside, so every part of the list is drawn
      const add = await page.request.post("/api/questions", { data: { text: locale === "en" ? "Can I go swimming?" : "我可以去游泳吗？" } });
      const id = ((await add.json()) as { question: { id: string } }).question.id;
      await page.request.post("/api/questions", { data: { text: locale === "en" ? "Can I fly next month?" : "下个月可以坐飞机吗？" } }).then(async (r) => {
        const q = ((await r.json()) as { question: { id: string } }).question.id;
        await page.request.patch(`/api/questions/${q}`, { data: { status: "skipped" } });
      });
      await check(page, "/p/questions", '[data-rp="questions-open"]');
      await checkTextScaling(page);
      await check(page, `/p/questions?done=skip&q=${id}`, '[data-rp="toast"]');
      await check(page, "/p/questions/add", '[data-testid="question-text-input"]');
      await check(page, `/p/questions/${id}/edit`, '[data-testid="question-text-input"]');
      await check(page, "/p/questions/answered", '[data-rp="said"]');
      await check(page, "/p/questions/skipped", '[data-action="put-back"]');
      await check(page, "/p/profile", '[data-rp="fact-value"]');
      await check(page, "/p/me", '[data-entry="example-reseed"]');
      await expect(page.locator('[data-entry="example-clear"]')).toBeVisible();
      await check(page, "/p/me/example", '[data-rp="example-actions"]');
      await check(page, "/p/me/example?do=reseed", '[data-rp="example-actions"][data-only="reseed"]');
      await check(page, "/p/me/example?do=clear", '[data-rp="example-actions"][data-only="clear"]');
      // Today (track B's screen): the example's banner shows on the calm overview, so the clock stands at 07:00, before
      // the morning reminder; while a dose needs him only the example's quiet line is there
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      expect((await page.request.post("/api/dev/clock", { data: { at: `${today}T07:00:00+08:00`, frozen: true } })).status()).toBe(200);
      try {
        await page.goto("/p/today");
        await expect(page.locator('[data-rp="example-banner"]')).toBeVisible();
        await expectPageChecks(page, { side: "elder" });
      } finally {
        await page.request.post("/api/dev/clock", { data: { clear: true } });
      }
      await page.goto("/p/today?change=morning");
      await expect(page.locator('[data-rp="example-line"]')).toBeVisible();
    });

    test(`setting up, every screen, and a family member's facts waiting on the profile (${locale})`, async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      await account(page, "blank", { onboarding: "started" });
      await check(page, "/onboard/who", '[data-testid="onboard-who-self"]');
      await page.request.post("/api/profile/onboard", { data: { step: "who", by: "family" } });
      await check(page, "/onboard/clinic", '[data-testid="onboard-clinic"]');
      await page.request.post("/api/profile/onboard", { data: { step: "clinic", clinic: "Blossom Family Clinic" } });
      await check(page, "/onboard/breakfast", '[data-testid="onboard-breakfast-08:30"]');
      await page.getByTestId("onboard-breakfast-08:30").click();
      await page.getByTestId("onboard-breakfast-other").click();
      await expectPageChecks(page, { side: "elder" });
      await page.request.post("/api/profile/onboard", { data: { step: "breakfast", time: "08:00" } });
      // the routine as a list: nothing weekly yet, so the question about the week stands open; its parts come one after
      // the other (what, then which days, then what time)
      await check(page, "/onboard/habits", '[data-testid="onboard-habit-add"]');
      await expect(page.locator('[data-rp="routine-waiting"]')).toHaveCount(1);
      await page.getByTestId("onboard-habit-own").click();
      await page.getByTestId("onboard-habit-own-input").fill(locale === "en" ? "Line dancing" : "广场舞");
      await page.getByTestId("onboard-day-Sat").click();
      await page.getByTestId("onboard-habit-time-other").click();
      await expectPageChecks(page, { side: "elder" });
      await page.request.post("/api/profile/onboard", { data: { step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:00" }] } });
      // what she wrote is listed with its tag and cannot be changed here; 「＋ 加一项」 opens the question again
      await check(page, "/onboard/habits", '[data-testid="onboard-habit-new"]');
      await expect(page.locator('[data-rp="routine-waiting"]')).toHaveCount(2);
      await expect(page.locator('[data-rp="routine-waiting"]').first()).toContainText(locale === "en" ? "Waiting for you" : "等你确认");
      await expect(page.locator('[data-rp="habit"]')).toHaveCount(0);
      for (const [step, ready] of [
        ["meds", '[data-testid="onboard-meds-photo"]'],
        ["age", '[data-testid="onboard-age"]'],
        ["conditions", '[data-testid="onboard-conditions-own"]'],
        ["allergies", '[data-testid="onboard-allergies-none"]'],
        ["family", '[data-testid="onboard-family-invite"]'],
        ["reminders", '[data-testid="onboard-reminders-on"]'],
        ["done", '[data-testid="onboard-done"]'],
      ] as const) {
        await check(page, `/onboard/${step}`, ready);
      }
      await page.request.post("/api/profile/onboard", { data: { step: "age", age: 67 } });
      await page.request.post("/api/profile/onboard", { data: { step: "done" } });
      // Today's calm overview says what waits for him, and the line opens his profile
      await page.goto("/p/today");
      const waiting = page.locator('[data-rp="family-facts-line"]');
      await expect(waiting).toHaveText(locale === "en" ? "Your family wrote 4 things. Please check them." : "家人写了 4 条，请你看一下。");
      await expectPageChecks(page, { side: "elder" });
      await waiting.click();
      await page.waitForURL("**/p/profile");
      // one at a time: the count says which of how many, and only that one is on the screen
      await check(page, "/p/profile", '[data-rp="confirm-fact"]');
      await expect(page.locator('[data-rp="confirm-fact"]')).toHaveCount(1);
      await expect(page.locator('[data-rp="confirm-count"]')).toHaveText(locale === "en" ? "1 of 4" : "第 1 项，共 4 项");
      await page.locator('[data-rp="confirm-fact"]').first().getByTestId("confirm-fact-change").click();
      await expectPageChecks(page, { side: "elder" });
      // 「不改了」 puts the three answers back; 「对」 moves on to the next one, and the count keeps its total
      await page.getByTestId("confirm-fact-keep").click();
      await page.getByTestId("confirm-fact-yes").click();
      await expect(page.locator('[data-rp="confirm-count"]')).toHaveText(locale === "en" ? "2 of 4" : "第 2 项，共 4 项");
      for (let i = 0; i < 3; i++) {
        const fact = await page.locator('[data-rp="confirm-fact"]').getAttribute("data-fact");
        await page.getByTestId("confirm-fact-yes").click();
        await expect(page.locator(`[data-rp="confirm-fact"][data-fact="${fact}"]`)).toHaveCount(0);
      }
      // nothing waits any more: his profile, every row saying who wrote it
      await expect(page.locator('[data-rp="page-title"]')).toBeVisible();
      await expect(page.locator('[data-rp="fact-value"][data-source="family"]')).toHaveCount(3);
      await expectPageChecks(page, { side: "elder" });
    });

    test(`setting up by himself: the routine list, breakfast changed in place, the reminder line and 「改时间」, a save that failed (${locale})`, async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      await account(page, "blank", { onboarding: "started" });
      const zh = locale === "zh-Hans";
      const answer = async (data: Record<string, unknown>) => expect((await page.request.post("/api/profile/onboard", { data })).status()).toBe(200);
      await answer({ step: "who", by: "self" });
      // the step bar says which of the six items a screen belongs to
      await check(page, "/onboard/clinic", '[data-testid="onboard-clinic"]');
      await expect(page.locator('[data-rp="step"]')).toContainText(zh ? "建档 · 第 1 项，共 6 项" : "Setting up · 1 of 6");
      // a save that does not go through says so in the dock, and nothing is lost
      await page.route("**/api/profile/onboard", (route) => route.abort());
      await page.getByTestId("onboard-clinic").fill("Blossom Family Clinic");
      await page.getByTestId("onboard-next").click();
      await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
      await page.unroute("**/api/profile/onboard");
      await page.getByTestId("onboard-next").click();
      await page.waitForURL("**/onboard/breakfast");
      await answer({ step: "breakfast", time: "08:30" });
      await answer({ step: "habits", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:30" }] });

      // 01-5b: breakfast and the weekly entry, earliest first, each with 「改」
      await check(page, "/onboard/habits", '[data-rp="habit"][data-habit="Tai chi"]');
      await expect(page.locator('[data-rp="step"]')).toContainText(zh ? "建档 · 第 2 项，共 6 项" : "Setting up · 2 of 6");
      const rows = page.locator('[data-testid="onboard-routine"] [data-rp]');
      await expect(rows.first()).toHaveAttribute("data-rp", "habit");
      await expect(rows.last()).toHaveAttribute("data-rp", "routine-breakfast");
      await expect(rows.last()).toContainText(zh ? "每天 · 早上 8:30" : "Every day · 8:30 am");
      // 「改」 on a weekly entry opens it filled in, with 「删掉」
      await page.locator('[data-rp="habit"][data-habit="Tai chi"]').click();
      await expect(page.getByTestId("onboard-day-Tue")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("onboard-habit-time-07:30")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('[data-action="habit-remove"]')).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
      await page.getByTestId("onboard-habit-cancel").click();
      // 「改」 on breakfast changes it in place, and the list says the new time
      await page.getByTestId("onboard-breakfast-change").click();
      await page.getByTestId("onboard-breakfast-09:00").click();
      await expect(page.getByTestId("onboard-reminder-at")).toContainText(zh ? "早上 9:15" : "9:15 am");
      await expectPageChecks(page, { side: "elder" });
      await page.getByTestId("onboard-breakfast-save").click();
      await expect(page.locator('[data-rp="routine-breakfast"]')).toContainText(zh ? "每天 · 早上 9:00" : "Every day · 9:00 am");
      expect(((await (await page.request.get("/api/profile")).json()) as { profile: { breakfast: string; reminderAt: string } }).profile).toMatchObject({ breakfast: "09:00", reminderAt: "09:15" });

      // 01-5f: the line of when the reminders come is what the back end computes: breakfast, +15, +30, +30
      await check(page, "/onboard/reminders", '[data-testid="onboard-reminder-line"]');
      const line = (name: string) => page.locator(`[data-testid="onboard-reminder-line"] [data-line="${name}"]`);
      await expect(line("breakfast")).toContainText("9:00");
      await expect(line("first")).toContainText("9:15");
      await expect(line("second")).toContainText("9:45");
      await expect(line("closes")).toContainText("10:15");
      // 「改时间」: the first reminder, and the other two follow it
      await page.getByTestId("onboard-remind-change").click();
      await page.waitForURL("**/onboard/reminders?edit=time");
      await page.getByTestId("onboard-remind-time-08:00").click();
      await expect(page.getByTestId("onboard-remind-again")).toContainText(zh ? "早上 8:30" : "8:30 am");
      await expectPageChecks(page, { side: "elder" });
      await page.getByTestId("onboard-remind-save").click();
      await page.waitForURL((url) => url.pathname === "/onboard/reminders" && url.search === "");
      await expect(line("first")).toContainText("8:00");
      await expect(line("second")).toContainText("8:30");
      await expect(line("closes")).toContainText("9:00");
      await expectPageChecks(page, { side: "elder" });

      // 01-5c: the second way in goes to the add page's typing screen
      await check(page, "/onboard/meds", '[data-testid="onboard-meds-manual"]');
      await page.getByTestId("onboard-meds-manual").click();
      await page.waitForURL((url) => url.pathname === "/p/meds/add" && url.searchParams.get("from") === "onboard" && url.searchParams.get("manual") === "1");

      // his profile once he is set up, and a screen opened from it to change something: no step bar, 「不改了 / 改好了」
      await answer({ step: "done" });
      await check(page, "/p/profile", '[data-rp="fact-value"][data-source="patient"]');
      await check(page, "/onboard/habits?return=/p/profile", '[data-rp="habit"]');
      await expect(page.locator('[data-rp="step"]')).toHaveCount(0);
      await check(page, "/onboard/conditions?return=/p/profile", '[data-testid="onboard-conditions-own"]');
    });
  });
}
