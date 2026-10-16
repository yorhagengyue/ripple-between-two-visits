/**
 * Page checks on track J's screen (架构审核 「每个页面自动查」; e2e/_checks/page-checks.ts): 「拍摄账号」 /p/me/filming, not
 * marked and marked with its clock moved by the director, in 华语 and in English: no sideways scroll at 360px, no text
 * under 18px, no target under 48x48, no contrast violation, text that doubles with the phone's font size, zoom allowed.
 * And the gate on his phone: without the film crew's cookie the page is a 404 and 「我」 has no 拍摄账号 row.
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts; the dev crew key): a
 * production build started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT names it.
 */
import { expect, test } from "@playwright/test";
import { checkTextScaling, checkZoomAllowed, expectPageChecks } from "./_checks/page-checks";
import { withCrew } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";
const login = () => `j${Math.random().toString(36).slice(2, 12)}`;

for (const locale of ["zh-Hans", "en"] as const) {
  test(`拍摄账号 (${locale}): not marked, then marked and moved by the director; both pass the page checks`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    await withCrew(context);
    const made = await page.request.post("/api/dev/accounts", { data: { login: login(), password: PASSWORD, space: "example", display_name: "陈先生", locale } });
    expect(made.status(), await made.text()).toBe(201);

    await page.goto("/p/me/filming");
    await expect(page.getByTestId("filming-page")).toHaveAttribute("data-filming", "false");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "zh-Hans" ? "拍摄账号" : "Filming account");
    await expectPageChecks(page, { side: "elder" });

    await page.getByTestId("filming-mark").click();
    await expect(page.getByTestId("filming-page")).toHaveAttribute("data-filming", "true");
    const ref = ((await (await page.request.get("/api/crew/filming-account")).json()) as { ref: string }).ref;
    const seeded = await page.request.post(`/api/crew/filming-account/accounts/${ref}`, { data: { action: "seed", scene: "d29-hero" } });
    expect(seeded.status(), await seeded.text()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("filming-now")).toContainText(locale === "zh-Hans" ? "9月22日 周二 · 晚上 8:15（导演拨的）" : "(moved by the director)");
    await expect(page.getByTestId("filming-code")).toContainText(ref);
    await expectPageChecks(page, { side: "elder" });
    expect((await checkZoomAllowed(page)).blocked).toBe(false);
    const s = await checkTextScaling(page, { factor: 2 });
    expect(s.count, "sampled text").toBeGreaterThan(3);
    expect(s.minRatio, "every sampled text grew with the root").toBeGreaterThanOrEqual(1.95);
    expect(s.overflow.doc, `sideways scroll at 200%: ${s.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);

    // 「结束拍摄」 on his phone: the real date again, not a filming account any more
    await page.getByTestId("filming-end").click();
    await expect(page.getByTestId("filming-page")).toHaveAttribute("data-filming", "false");
    await expect(page.getByTestId("filming-now")).not.toContainText(locale === "zh-Hans" ? "9月22日" : "22 Sep");
  });
}

test("a filming account at the second visit: the sample visit and the sample labels with the crew's cookie, not without it", async ({ page, context }) => {
  await withCrew(context);
  const made = await page.request.post("/api/dev/accounts", { data: { login: login(), password: PASSWORD, space: "example", display_name: "陈先生" } });
  expect(made.status(), await made.text()).toBe(201);
  expect((await page.request.post("/api/crew/filming-account")).status()).toBe(200);
  const ref = ((await (await page.request.get("/api/crew/filming-account")).json()) as { ref: string }).ref;
  expect((await page.request.post(`/api/crew/filming-account/accounts/${ref}`, { data: { action: "seed", scene: "d8-visit" } })).status()).toBe(200);

  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-sample")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
  await page.goto("/p/meds/add");
  await page.getByRole("button", { name: "医生开的" }).click();
  await page.getByRole("button", { name: "拍药袋" }).click();
  await expect(page.getByTestId("add-sample-amlodipine")).toBeVisible();

  // the same phone without the crew's cookie: an account like any other (and the label route refuses)
  await context.clearCookies({ name: "rp_crew" });
  await page.goto("/p/visit");
  await expect(page.locator('[data-testid="visit-sample"]')).toHaveCount(0);
  await page.goto("/p/meds/add");
  await page.getByRole("button", { name: "医生开的" }).click();
  await page.getByRole("button", { name: "拍药袋" }).click();
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await expect(page.locator('[data-testid="add-sample-amlodipine"]')).toHaveCount(0);
  expect((await page.request.get("/api/labels/sample?name=amlodipine")).status()).toBe(403);
});

test("without the crew's cookie: 拍摄账号 is a 404 and 「我」 has no such row; the routes do not exist", async ({ page }) => {
  const made = await page.request.post("/api/dev/accounts", { data: { login: login(), password: PASSWORD, space: "example", display_name: "陈先生" } });
  expect(made.status(), await made.text()).toBe(201);
  await page.goto("/p/me");
  await expect(page.locator('[data-rp="me-menu"]')).toBeVisible();
  await expect(page.locator('[data-entry="filming"]')).toHaveCount(0);
  const res = await page.goto("/p/me/filming");
  expect(res?.status()).toBe(404);
  expect((await page.request.post("/api/crew/filming-account")).status()).toBe(404);
  expect((await page.request.get("/api/crew/filming-account/accounts")).status()).toBe(404);
});
