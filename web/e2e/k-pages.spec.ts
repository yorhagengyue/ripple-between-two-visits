/**
 * Page checks on track K's screens (架构审核 「每个页面自动查」; e2e/_checks/page-checks.ts): no sideways scroll at 360px,
 * no text under 18px, no target under 48x48, no contrast violation — on the conversation (with a note, the doctor's line
 * under the ankle note, track S's can't-help answer, an earlier day), the watch (the observation, the trends; with no watch data),
 * prevention (the example; no age yet), the diet screen (the doctor's words and the day's question, official lines,
 * his hawker dishes, grapefruit; a special diet), and 「我」 with the two rows, in 华语 and in English.
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): a production build
 * started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT names it (track K: 3580).
 * Independent of what ran before on the same server: each test signs a fresh browser in to a new account and opens
 * nothing else first (a demo page would leave demo cookies, which the subject resolution reads before the account's),
 * and "today" is the server's (a developer test clock another spec left behind moves it).
 */
import { expect, test, type Page } from "@playwright/test";
import { checkTextScaling, expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";

async function account(page: Page, space: "example" | "blank") {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `k${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, space } });
  expect(r.status(), await r.text()).toBe(201);
}

async function check(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.locator(ready).first()).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
}

for (const locale of ["zh-Hans", "en"] as const) {
  test.describe(`track K screens (${locale})`, () => {
    test.beforeEach(async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    });

    test(`the conversation (${locale})`, async ({ page }) => {
      await account(page, "example");
      for (const text of ["我今天好累。", "今天在大巴窑中心走了一圈，脚踝有点肿。", "今天会下雨吗？"]) {
        expect((await page.request.post("/api/ask", { data: { text, locale } })).status()).toBe(200);
      }
      await check(page, "/p/chat", '[data-testid="chat-related"]');
      await expect(page.getByTestId("chat-turn")).toHaveCount(3);
      await checkTextScaling(page);
      // a day by its date (the server's today: a test clock may be set), read only
      const { date } = (await (await page.request.get("/api/chat")).json()) as { date: string };
      await check(page, `/p/chat?date=${date}`, '[data-testid="chat-turn"]');
    });

    test(`the watch (${locale})`, async ({ page }) => {
      await account(page, "example");
      await check(page, "/p/watch", '[data-testid="watch-card"]');
      await expect(page.getByTestId("watch-trend")).toHaveCount(3);
      await checkTextScaling(page);
      await account(page, "blank");
      await check(page, "/p/watch", '[data-testid="page-watch"][data-has="false"]');
    });

    test(`prevention and 「我」 (${locale})`, async ({ page }) => {
      await account(page, "example");
      await check(page, "/p/prevent", '[data-testid="prevent-row"][data-item="C1-03"]');
      await checkTextScaling(page);
      await check(page, "/p/me", '[data-entry="prevent"]');
      await expect(page.locator('[data-entry="diet"]')).toBeVisible();
      await account(page, "blank");
      await check(page, "/p/prevent", '[data-testid="prevent-noage"]');
    });

    test(`the diet screen (${locale})`, async ({ page }) => {
      await account(page, "example");
      expect((await page.request.post("/api/diet/foods", { data: { foods: ["chicken_rice", "noodle_soup", "kopi_teh"] } })).status()).toBe(200);
      await check(page, "/p/diet", '[data-testid="diet-check"]');
      await expect(page.getByTestId("diet-grapefruit")).toBeVisible();
      await checkTextScaling(page);
      // his hawker dishes are a screen of their own since the timeline design (13-2)
      await check(page, "/p/diet?view=foods", '[data-testid="diet-picked"]');
      await expect(page.getByTestId("diet-picked")).toHaveCount(3);
      expect((await page.request.post("/api/diet/check", { data: { answer: "no" } })).status()).toBe(200);
      await check(page, "/p/diet", '[data-testid="diet-answered"]');
      await account(page, "blank");
      for (const text of ["高血压", "肾病"]) expect((await page.request.post("/api/profile/facts", { data: { kind: "condition", text } })).status()).toBe(201);
      await check(page, "/p/diet", '[data-testid="diet-special"][data-first="true"]');
    });
  });
}
