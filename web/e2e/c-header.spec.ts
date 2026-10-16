/**
 * Track C, round 2 (real-app 2.5, 2.16 line 252, 2.23, 4.7):
 *
 *   the header    every screen of his own account has 「我」 at the top right of its header (a link to /p/me), and on the
 *                 example account 「示例资料：陈先生（虚构人物）」 right under the header, once. The walk below opens the
 *                 account's screens one by one. The demo's headers have neither.
 *   「我」        称呼, 语言, 早饭时间和提醒 and 退出登录 are rows of their own; each screen behind them passes the page
 *                 checks (e2e/_checks/page-checks.ts) in 华语 and English; a changed name, language and reminder time
 *                 show on 「我」; 退出登录 signs this phone out.
 *   setting up    a sign-up marked 「家人帮我操作」 makes the round's facts a family member's, whatever the first screen
 *                 is skipped with.
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): a production build
 * started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT names it.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";

async function account(page: Page, space: "example" | "blank", extra: Record<string, unknown> = {}) {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `h${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, space, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
}

const ME = '[data-rp="meta"] a[data-kind="me"][href="/p/me"]';
const LINE = '[data-rp="example-line"]';

/** Open `path`, wait for its header, and count 「我」 in the header and the example line on the screen. */
async function header(page: Page, path: string): Promise<{ me: number; line: number; lineUnderHeader: boolean }> {
  await page.goto(path);
  await expect(page.locator('[data-rp="meta"]').first(), `${path} has a header`).toBeVisible();
  const me = await page.locator(ME).count();
  const line = await page.locator(LINE).count();
  const lineUnderHeader =
    line === 1 &&
    (await page.evaluate(() => {
      const meta = document.querySelector('[data-rp="meta"]');
      const l = document.querySelector('[data-rp="example-line"]');
      if (!meta || !l) return false;
      // the line comes after the header in the document and sits below it on the screen
      return !!(meta.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) && l.getBoundingClientRect().top >= meta.getBoundingClientRect().bottom - 1;
    }));
  return { me, line, lineUnderHeader };
}

test("every screen of an example account: 「我」 in the header, the example line under it, once", async ({ page }) => {
  await account(page, "example");
  // a medicine and a past visit of the example, and a question of his own to change
  await page.goto("/p/meds");
  const medHref = await page.locator('a[href^="/p/meds/"]:not([href="/p/meds/add"])').first().getAttribute("href");
  expect(medHref).toBeTruthy();
  const q = await page.request.post("/api/questions", { data: { text: "我可以去游泳吗？" } });
  const qid = ((await q.json()) as { question: { id: string } }).question.id;

  const withMe = [
    "/p/today",
    "/p/today?change=morning",
    "/p/bp",
    "/p/brief",
    "/p/visit",
    "/p/visit/v1/review",
    "/p/meds",
    medHref!,
    "/p/meds/add",
    "/p/ask",
    "/p/chat",
    "/p/watch",
    "/p/questions",
    "/p/questions/add",
    `/p/questions/${qid}/edit`,
    "/p/questions/answered",
    "/p/questions/skipped",
    "/p/family/invite",
    "/p/profile/times/midday",
  ];
  for (const path of withMe) {
    const seen = await header(page, path);
    expect(seen, path).toEqual({ me: 1, line: 1, lineUnderHeader: true });
  }
  // 「我」 itself, its own screens and the screens whose 「‹ 返回」 already goes there: no second way to the same place,
  // and the example line all the same
  for (const path of ["/p/me", "/p/me/example", "/p/me/devices", "/p/me/notifications", "/p/me/ai", "/p/me/export", "/p/profile", "/p/profile/name", "/p/profile/language", "/p/profile/times", "/p/family", "/p/diet", "/p/prevent"]) {
    const seen = await header(page, path);
    expect(seen, path).toEqual({ me: 0, line: 1, lineUnderHeader: true });
  }
  // the button works: from Today to 「我」
  await page.goto("/p/today");
  await page.locator(ME).click();
  await page.waitForURL("**/p/me");
  await expect(page.locator('[data-rp="me-menu"]')).toBeVisible();
});

test("his own account has 「我」 on every header and no example line; the demo's headers have neither", async ({ page, browser, baseURL }) => {
  await account(page, "blank");
  for (const path of ["/p/today", "/p/bp", "/p/brief", "/p/visit", "/p/meds", "/p/meds/add", "/p/ask", "/p/chat", "/p/watch", "/p/questions", "/p/questions/add"]) {
    const seen = await header(page, path);
    expect({ me: seen.me, line: seen.line }, path).toEqual({ me: 1, line: 0 });
  }
  // a judge's sandbox: the pages that draw the same top line (问一句, 随时说一句) stay as they were
  const judge = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const jp = await judge.newPage();
  await jp.goto("/demo");
  for (const path of ["/p/ask", "/p/chat"]) {
    await jp.goto(path);
    await expect(jp.locator('[data-rp="meta"]').first()).toBeVisible();
    await expect(jp.locator('[data-kind="me"]')).toHaveCount(0);
    await expect(jp.locator(LINE)).toHaveCount(0);
  }
  await judge.close();
});

for (const locale of ["zh-Hans", "en"] as const) {
  test(`「我」: 称呼, 语言, 早饭时间和提醒 as rows of their own, and their screens (${locale})`, async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    await account(page, "blank", { display_name: "陈先生" });
    const zh = locale === "zh-Hans";
    const check = async (path: string, ready: string) => {
      await page.goto(path);
      await expect(page.locator(ready).first()).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
    };
    await check("/p/me", '[data-entry="logout"]');
    const row = (entry: string) => page.locator(`[data-rp="me-entry"][data-entry="${entry}"]`);
    await expect(row("name")).toContainText("陈先生");
    await expect(row("language")).toContainText(zh ? "华语" : "English");
    await expect(row("times")).toContainText(zh ? "早上的药 早上 8:45 提醒" : "morning medicine at 8:45 am");
    // the four rows are there in the design's places: the first three on top, 退出登录 last
    const entries = await page.locator('[data-rp="me-entry"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-entry")));
    expect(entries.slice(0, 3)).toEqual(["name", "language", "times"]);
    expect(entries.at(-1)).toBe("logout");

    // 称呼
    await row("name").click();
    await page.waitForURL("**/p/profile/name");
    await check("/p/profile/name", '[data-testid="me-name-input"]');
    await page.getByTestId("me-name-input").fill(zh ? "陈伯伯" : "Uncle Tan");
    await page.getByTestId("me-name-save").click();
    await page.waitForURL("**/p/me");
    await expect(row("name")).toContainText(zh ? "陈伯伯" : "Uncle Tan");

    // 早饭时间和提醒: breakfast through the setting-up screen and back; the midday time set by hand
    await row("times").click();
    await page.waitForURL("**/p/profile/times");
    await check("/p/profile/times", '[data-rp="slot-times"]');
    await page.locator('[data-rp="times-breakfast"] a').click();
    await page.waitForURL("**/onboard/breakfast?return=/p/profile/times");
    await page.getByTestId("onboard-breakfast-07:30").click();
    await page.getByTestId("onboard-next").click();
    await page.waitForURL("**/p/profile/times");
    const slot = (s: string) => page.locator(`[data-rp="slot-times"] a:has([data-slot="${s}"])`);
    await expect(slot("morning")).toContainText(zh ? "早上 7:45" : "7:45 am");
    await expect(slot("morning").locator("[data-slot]")).toHaveAttribute("data-source", "routine");
    await expect(slot("midday").locator("[data-slot]")).toHaveAttribute("data-source", "app");
    await slot("midday").click();
    await page.waitForURL("**/p/profile/times/midday");
    await check("/p/profile/times/midday", '[data-testid="slot-time-save"]');
    await page.getByTestId("slot-time-12:00").click();
    await expect(page.getByTestId("slot-time-again")).toContainText(zh ? "中午 12:30" : "12:30 pm");
    await page.getByTestId("slot-time-save").click();
    await page.waitForURL("**/p/profile/times");
    await expect(slot("midday")).toContainText(zh ? "中午 12:00" : "12:00 pm");
    await expect(slot("midday").locator("[data-slot]")).toHaveAttribute("data-source", "own");
    // a time outside its part of the day is refused in words, and nothing changes
    await page.goto("/p/profile/times/night");
    await page.getByTestId("slot-time-other").click();
    await page.getByTestId("slot-time-input").fill("23:40");
    await page.getByTestId("slot-time-save").click();
    await expect(page.locator('[data-rp="form-problem"]')).toBeVisible();
    await expectPageChecks(page, { side: "elder" });
    const profile = ((await (await page.request.get("/api/profile")).json()) as { profile: { slots: { slot: string; first: string; source: string }[] } }).profile;
    expect(profile.slots.map((t) => [t.slot, t.first, t.source])).toEqual([
      ["morning", "07:45", "routine"],
      ["midday", "12:00", "own"],
      ["evening", "18:45", "app"],
      ["night", "21:30", "app"],
    ]);
    // he gives the midday time back
    await page.goto("/p/profile/times/midday");
    await page.getByTestId("slot-time-clear").click();
    await page.waitForURL("**/p/profile/times");
    await expect(slot("midday").locator("[data-slot]")).toHaveAttribute("data-source", "app");

    // his profile says who wrote his clinic, breakfast and habits (their fact rows), and still passes the checks
    expect((await page.request.patch("/api/profile", { data: { clinic: "Blossom Family Clinic", habits: [{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:00" }] } })).status()).toBe(200);
    await check("/p/profile", '[data-rp="fact-value"][data-source="patient"]');
    await expect(page.locator('[data-rp="fact-value"][data-source="patient"]')).toHaveCount(3);
    await expect(page.locator('[data-rp="row"]', { hasText: zh ? "常去的诊所" : "Clinic" })).toContainText(zh ? "你自己写的" : "You wrote it");

    // 语言: the other language, kept for his account and this browser
    await page.goto("/p/me");
    await row("language").click();
    await page.waitForURL("**/p/profile/language");
    await check("/p/profile/language", `[data-testid="me-lang-${locale}"][data-current="true"]`);
    const other = zh ? "en" : "zh-Hans";
    await page.getByTestId(`me-lang-${other}`).click();
    await page.waitForURL("**/p/me");
    await expect(row("language")).toContainText(zh ? "English" : "华语");
    await expect(page.locator('[data-rp="page-title"]')).toHaveText(zh ? "Me" : "我");
    expect((await page.context().cookies()).find((c) => c.name === "rp_lang")?.value).toBe(other);

    // 退出登录, straight from 「我」: this phone is signed out and his pages ask him to log in
    await page.getByTestId("me-logout").click();
    await page.waitForURL("**/login**");
    expect((await page.request.get("/api/profile")).status()).toBeGreaterThanOrEqual(400);
  });
}

test("a sign-up marked 「家人帮我操作」: the first screen shows it, skipping keeps it, and what is entered waits for him", async ({ page }) => {
  await account(page, "blank", { onboarding: "started", assisted: true });
  await page.goto("/onboard");
  await page.waitForURL("**/onboard/who");
  await expect(page.getByTestId("onboard-who-family")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("onboard-who-family")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("onboard-who-self")).toHaveAttribute("aria-pressed", "false");
  await expectPageChecks(page, { side: "elder" });
  await page.getByTestId("onboard-skip").click();
  await page.waitForURL("**/onboard/clinic");
  await expect(page.locator('[data-rp="helped"]')).toBeVisible();
  await page.getByTestId("onboard-clinic").fill("Blossom Family Clinic");
  await page.getByTestId("onboard-next").click();
  await page.waitForURL("**/onboard/breakfast");
  const p = ((await (await page.request.get("/api/profile")).json()) as { profile: { clinic: string | null; facts: unknown[]; pending: { kind: string; source: string; confirmed: boolean }[] } }).profile;
  expect(p.clinic).toBeNull();
  expect(p.facts).toEqual([]);
  expect(p.pending.map((f) => [f.kind, f.source, f.confirmed])).toEqual([["clinic", "family", false]]);

  // a sign-up he did himself: the first screen shows 「我自己填」, and what he enters is his own, a setting and a fact
  await page.context().clearCookies();
  await account(page, "blank", { onboarding: "started" });
  await page.goto("/onboard/who");
  await expect(page.getByTestId("onboard-who-self")).toHaveAttribute("data-current", "true");
  await page.getByTestId("onboard-skip").click();
  await page.waitForURL("**/onboard/clinic");
  await expect(page.locator('[data-rp="helped"]')).toHaveCount(0);
  await page.getByTestId("onboard-clinic").fill("Blossom Family Clinic");
  await page.getByTestId("onboard-next").click();
  await page.waitForURL("**/onboard/breakfast");
  const own = ((await (await page.request.get("/api/profile")).json()) as { profile: { clinic: string | null; clinicFact: { source: string } | null; pending: unknown[] } }).profile;
  expect(own).toMatchObject({ clinic: "Blossom Family Clinic", clinicFact: { source: "patient" }, pending: [] });
});
