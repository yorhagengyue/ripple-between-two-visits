/**
 * Page checks on track H's screens (架构审核 「每个页面自动查」; e2e/_checks/page-checks.ts): no sideways scroll at 360px,
 * no text under 18px, no target under 48x48, no contrast violation. 「我的数据」 (before and after an export, and with
 * none left today), 「看诊录音留多久」 (a recording kept until its date, one kept for good, one deleted), 「家人什么时候看过」
 * (empty and with a look), 「AI 处理」 (on and off), 「删除账号」 (both screens, a wrong password, the last screen), her
 * own 「删除我的账号」 from her 「我的」 (her side: 16px text, 44px targets) with what it leaves behind, and /privacy
 * with the published consent texts, in 华语 and in English.
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts, the test clock, the
 * retention tick): a production build started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT
 * names it. Family links go through track D's real routes (e2e/journeys/_d/family.ts). With SPEECH_PROVIDER=devfake the
 * visits get their stand-in transcript; with mock they wait for it, which these screens do not mind.
 */
import { expect, test, type Page } from "@playwright/test";
import { checkTextScaling, expectPageChecks } from "./_checks/page-checks";
import { linkFamily, setSwitches } from "./journeys/_d/family";
import { clearClock, devAccount, fixtureWav, H_PASSWORD, recordVisit, setClock, tickRetention } from "./journeys/_h/my-data";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
test.describe.configure({ mode: "serial" });

async function check(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.locator(ready).first()).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
}

for (const locale of ["zh-Hans", "en"] as const) {
  test.describe(`track H screens (${locale})`, () => {
    test.afterEach(async ({ request }) => {
      await clearClock(request);
    });

    test(`我的数据, recordings, the access log, AI processing (${locale})`, async ({ page, request, baseURL, browser }) => {
      await page.goto("/privacy");
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      const api = page.request;
      await setClock(request, "2026-08-24T09:30:00+08:00");
      await devAccount(api, { prefix: "hp", space: "blank", displayName: "陈先生", locale });
      const v1 = await recordVisit(api, { fixture: "v1", wav: fixtureWav("v1-u08") });
      await setClock(request, "2026-09-01T10:30:00+08:00");
      const v2 = await recordVisit(api, { fixture: "v2", wav: fixtureWav("v2-u08") });
      await setClock(request, "2026-10-10T10:00:00+08:00");

      await check(page, "/p/me", '[data-entry="data"]');
      await check(page, "/p/me/export", '[data-testid="export-button"]');
      await checkTextScaling(page);
      // after an export: the done state
      const dl = page.waitForEvent("download");
      await page.getByTestId("export-button").click();
      await dl;
      await expect(page.getByTestId("export-done")).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
      // none left today
      for (let i = 0; i < 2; i++) {
        const more = page.waitForEvent("download");
        await page.getByTestId("export-button").click();
        await more;
      }
      await expect(page.getByTestId("export-none-left")).toBeVisible();
      await expectPageChecks(page, { side: "elder" });

      await check(page, "/p/me/export/access", '[data-testid="page-access"]');
      await check(page, "/p/me/export/recordings", '[data-testid="recording"]');
      // one kept for good, then 91 days on: one deleted
      await page.locator(`[data-testid="recording"][data-visit="${v2.id}"]`).getByRole("switch").click();
      await expect(page.locator(`[data-testid="recording"][data-visit="${v2.id}"]`)).toHaveAttribute("data-state", "kept_forever");
      await setClock(request, "2026-11-24T10:00:00+08:00");
      await tickRetention(request);
      await check(page, "/p/me/export/recordings", `[data-testid="recording"][data-visit="${v1.id}"][data-state="deleted"]`);
      await checkTextScaling(page);

      // her look: track D's link, and her own /f writes the row
      const herContext = await browser.newContext();
      await devAccount(herContext.request, { prefix: "hw", space: "none", displayName: "Wei Ling" });
      const linkId = await linkFamily(page.context(), herContext, { label: "Wei Ling", calls: "爸爸" });
      await setSwitches(page.context(), linkId, { dose_summary: true });
      const herPage = await herContext.newPage();
      await herPage.goto(`/f?link=${linkId}`);
      await expect(herPage.getByTestId("family-app")).toBeVisible();
      await herContext.close();
      await check(page, "/p/me/export/access", '[data-testid="access-row"]');

      await check(page, "/p/me/ai", '[data-testid="page-ai"][data-on="true"]');
      // two switches: AI processing itself (named by its grant), and under the text 「有人在旁边帮我操作」
      const aiSwitch = page.getByTestId("page-ai").locator('[data-grant="ai_processing"]').getByRole("switch");
      await aiSwitch.click();
      await expect(page.getByTestId("page-ai")).toHaveAttribute("data-on", "false");
      await expect(page.getByTestId("ai-notice")).toBeVisible();
      const alone = (await (await page.request.get("/api/me")).json()) as { consents: { kind: string; decision: string; assisted: boolean }[] };
      expect(alone.consents.find((c) => c.kind === "ai_processing")).toMatchObject({ decision: "withdrawn", assisted: false });
      // someone is helping him: the tap is still his, and the record says he was helped
      await page.getByTestId("ai-helped").getByRole("switch").click();
      await expect(page.getByTestId("ai-helped")).toHaveAttribute("data-on", "true");
      await aiSwitch.click();
      await expect(page.getByTestId("page-ai")).toHaveAttribute("data-on", "true");
      const helped = (await (await page.request.get("/api/me")).json()) as { consents: { kind: string; decision: string; assisted: boolean }[] };
      expect(helped.consents.find((c) => c.kind === "ai_processing")).toMatchObject({ decision: "granted", assisted: true });
      await expectPageChecks(page, { side: "elder" });
      await checkTextScaling(page);
    });

    test(`删除账号: both screens, a wrong password, the last screen (${locale})`, async ({ page, baseURL }) => {
      await page.goto("/privacy");
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      await devAccount(page.request, { prefix: "hd", space: "blank", displayName: "陈先生", locale });
      await check(page, "/p/me/delete", '[data-testid="delete-step-what"]');
      await checkTextScaling(page);
      await page.getByTestId("delete-continue").click();
      await expect(page.getByTestId("delete-step-password")).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
      await page.getByTestId("delete-password").fill("not the password");
      await page.getByTestId("delete-submit").click();
      await expect(page.getByTestId("delete-error")).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
      await page.getByTestId("delete-password").fill(H_PASSWORD);
      await page.getByTestId("delete-submit").click();
      await expect(page.getByTestId("delete-done")).toBeVisible();
      await expectPageChecks(page, { side: "elder" });
      expect((await page.request.get("/api/me")).status()).toBe(401);
    });

    test(`her own account: 「删除我的账号」 from her 「我的」, both screens, a wrong password, the last screen (${locale})`, async ({ page, browser, baseURL }) => {
      await page.goto("/privacy");
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      await devAccount(page.request, { prefix: "hf", space: "blank", displayName: "陈先生", locale });
      const herContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
      await herContext.addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      const her = await devAccount(herContext.request, { prefix: "hw", space: "none", displayName: "Wei Ling", locale });
      const linkId = await linkFamily(page.context(), herContext, { label: "Wei Ling", calls: "爸爸" });
      await setSwitches(page.context(), linkId, { dose_summary: true });
      const hp = await herContext.newPage();
      await hp.goto(`/f?link=${linkId}`); // her look, written by her page
      await hp.goto(`/f/me?link=${linkId}`);
      await expect(hp.getByTestId("me-delete")).toBeVisible();
      await expectPageChecks(hp, { side: "family" });
      await hp.getByTestId("me-delete").click();
      await expect(hp.getByTestId("her-delete-what")).toBeVisible();
      await expect(hp.getByTestId("her-delete-goes")).toContainText(locale === "en" ? "your link to 爸爸" : "你和爸爸的联系");
      await expect(hp.getByTestId("her-delete-stays")).toContainText(locale === "en" ? "only your name" : "只写着你的称呼");
      await expectPageChecks(hp, { side: "family" });
      await hp.getByTestId("her-delete-continue").click();
      await expect(hp.getByTestId("her-delete-password")).toBeVisible();
      await expectPageChecks(hp, { side: "family" });
      await hp.getByTestId("her-delete-input").fill("not the password");
      await hp.getByTestId("her-delete-submit").click();
      await expect(hp.getByTestId("her-delete-error")).toBeVisible();
      await expectPageChecks(hp, { side: "family" });
      await hp.getByTestId("her-delete-input").fill(H_PASSWORD);
      await hp.getByTestId("her-delete-submit").click();
      await expect(hp.getByTestId("her-delete-done")).toBeVisible();
      await expectPageChecks(hp, { side: "family" });
      // she is gone: no sign-in, no login, no link; his records stay and his access log keeps her name only
      expect((await herContext.request.get("/api/me")).status()).toBe(401);
      expect((await herContext.request.post("/api/auth/login", { data: { login: her.login, password: H_PASSWORD } })).status()).toBe(401);
      const his = (await (await page.request.get("/api/me")).json()) as { links: { as_patient: unknown[] } };
      expect(his.links.as_patient).toEqual([]);
      await page.goto("/p/me/export/access");
      await expect(page.getByTestId("access-row").first()).toContainText("Wei Ling");
      await herContext.close();
    });

    test(`/privacy, signed out, with the consent texts (${locale})`, async ({ page }) => {
      await check(page, `/privacy?lang=${locale}`, '[data-testid="page-privacy"]');
      await expect(page.getByTestId("page-privacy")).toHaveAttribute("data-locale", locale);
      await expect(page.getByTestId("page-privacy")).toContainText(locale === "en" ? "Tokyo" : "东京");
      await expect(page.getByTestId("page-privacy")).toContainText(locale === "en" ? "Tencent Cloud's Hunyuan model" : "腾讯云的混元模型");
      await expect(page.getByTestId("privacy-officer")).toHaveText(locale === "en" ? "the YoRHa2 team" : "YoRHa2 团队");
      const consents = page.getByTestId("privacy-consents").locator("article");
      await expect(consents).toHaveCount(8);
      expect(await consents.evaluateAll((els) => els.map((e) => e.getAttribute("data-consent")))).toEqual(["terms_privacy", "ai_processing", "example_data", "visit_recording", "retention_keep_forever", "family_accept", "family_share", "family_reset_helper"]);
      // what a family member sees whatever the six switches say (the morning reminder's time) is said in the notice
      await expect(page.locator('[data-section="who"]')).toContainText(locale === "en" ? "not governed by the six switches" : "不归这六个开关管");
      await expect(page.getByTestId("page-privacy")).toHaveAttribute("data-version", "2026-10-16");
      for (const sha of await consents.evaluateAll((els) => els.map((e) => e.getAttribute("data-sha256")))) expect(sha).toMatch(/^[0-9a-f]{64}$/);
      await page.getByTestId("privacy-consents").locator("summary").first().click();
      await expectPageChecks(page, { side: "elder" });
      await checkTextScaling(page, { sample: "[data-testid=page-privacy] p" });
    });
  });
}
