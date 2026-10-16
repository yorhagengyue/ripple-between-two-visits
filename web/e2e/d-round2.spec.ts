/**
 * Track D, round two (docs/plan/real-app.md 2.20 step 4, 2.21, 3.10 补档案, 3.11 删除账号 step 5, 2.6): the screens and
 * flows added after the design was read against the code, each with the page checks (e2e/_checks/page-checks.ts), in
 * 华语 and in English:
 *   - she adds a line to his details from /f/facts; a dose is refused; her home says how her lines stand; he taps 对 and
 *     her open home says 「爸爸确认了你补充的资料。」 by itself, her list says 「爸爸确认了」
 *   - he deletes his account while her home is open: it says 「这个联系已经结束。」; so does /f afterwards, with the old
 *     link in the address and with none
 *   - the notice 「Wei Ling 已经接受」 opens /p/today?confirm=1: the confirm card comes first even while the morning's
 *     medicine waits for him; without `confirm` the medicine is first
 *   - her 「我的」: Android's 「装到主屏」 while the browser offers it, the iPhone's three pictured steps when Ripple is
 *     not on the Home Screen; the same steps in her first visit
 *   - she already has an account: logging in from the invitation brings her back to it, and her own tap on 「接受」
 *     accepts; his sign-up was made with someone helping: the confirm card says the tap is his own, and the consent
 *     record is marked assisted
 * Runs against a server with the developer tools on (PW_PORT), like e2e/d-pages.spec.ts. D_SHOTS_DIR saves pictures.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { logOut, signUp } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";
const SHOTS = process.env.D_SHOTS_DIR?.trim() || null;
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
type Lang = "zh-Hans" | "en";

async function phone(browser: Browser, baseURL: string, locale: Lang, opts: { userAgent?: string } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore", ...(opts.userAgent ? { userAgent: opts.userAgent, isMobile: true, hasTouch: true } : {}) });
  await context.addCookies([{ name: "rp_lang", value: locale, url: baseURL }]);
  return context;
}

async function account(context: BrowserContext, space: "example" | "blank" | "none", name: string): Promise<void> {
  const login = `d${Math.random().toString(36).slice(2, 12)}`;
  const r = await context.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space, display_name: name, locale: "zh-Hans" } });
  expect(r.status(), await r.text()).toBe(201);
}

async function ok(context: BrowserContext, p: string, data: unknown): Promise<Record<string, unknown>> {
  const r = await context.request.post(p, { data });
  expect(r.ok(), `${p}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

/** His invitation, her acceptance, his confirmation, through the real routes. */
async function link(him: BrowserContext, her: BrowserContext, confirm = true): Promise<string> {
  const made = await ok(him, "/api/family/invites", { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" });
  const id = (made.link as { id: string }).id;
  await ok(her, "/api/family/invites/accept", { token: String(made.path).replace(/^\/invite\//, "") });
  if (confirm) await ok(him, `/api/family/links/${id}/confirm`, { yes: true });
  return id;
}

/** Her first-visit steps are done on this phone (lib/care/device.ts keeps that in localStorage). */
async function welcomed(page: Page, linkId: string): Promise<void> {
  await page.evaluate((id) => {
    localStorage.setItem(`rp_f_welcomed_${id}`, "1");
    localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
  }, linkId);
}

async function check(page: Page, side: "family" | "elder", name: string, locale: string): Promise<void> {
  await expectPageChecks(page, { side });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `r2-${name}-${locale}.png`), fullPage: true });
  }
}

async function clock(request: APIRequestContext, at: string | null): Promise<void> {
  await request.post("/api/dev/clock", { data: at ? { at, frozen: true } : { clear: true } });
}

for (const locale of ["zh-Hans", "en"] as const) {
  const zh = locale === "zh-Hans";
  test.describe(`track D round two (${locale})`, () => {
    test(`she adds to his details; he confirms; her screens say so (${locale})`, async ({ browser, baseURL }) => {
      const him = await phone(browser, baseURL!, "zh-Hans");
      const her = await phone(browser, baseURL!, locale);
      await account(him, "blank", "陈先生");
      await account(her, "none", "Wei Ling");
      const id = await link(him, her);
      const dp = await her.newPage();
      await dp.goto(`/f?link=${id}`);
      await welcomed(dp, id);
      await dp.reload();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");

      // from her home to 「我的」, and from there to the screen (its way in sits under 「我的」); nothing written yet
      await dp.getByTestId("open-me").click();
      await dp.waitForURL(/\/f\/me\?link=/);
      await dp.getByTestId("open-facts").click();
      await dp.waitForURL(/\/f\/facts\?link=/);
      await expect(dp.getByTestId("family-facts")).toHaveAttribute("data-waiting", "0");
      await expect(dp.getByTestId("family-headline")).toHaveText(zh ? "给爸爸的资料补充一条。" : "Add a line to 爸爸's details.");
      await expect(dp.getByTestId("her-facts")).toHaveCount(0);
      await check(dp, "family", "facts-empty", locale);

      // a dose is refused, in words; nothing is written
      await dp.getByTestId("fact-text").fill("每天吃两粒");
      await dp.getByTestId("fact-send").click();
      await expect(dp.getByTestId("fact-error")).toHaveText(zh ? "剂量和读数不写在这里。" : "Doses and readings don't go here.");
      await expect(dp.getByTestId("family-facts")).toHaveAttribute("data-waiting", "0");
      await check(dp, "family", "facts-refused", locale);

      // a condition, then his breakfast time
      await dp.getByTestId("fact-text").fill("爸爸有乙肝");
      await dp.getByTestId("fact-send").click();
      await expect(dp.getByTestId("fact-sent")).toBeVisible();
      await expect(dp.getByTestId("family-facts")).toHaveAttribute("data-waiting", "1");
      await dp.getByTestId("fact-kind-routine").click();
      await dp.getByTestId("fact-time").fill("07:30");
      await dp.getByTestId("fact-send").click();
      await expect(dp.getByTestId("family-facts")).toHaveAttribute("data-waiting", "2");
      const waiting = dp.getByTestId("her-fact-waiting");
      await expect(waiting).toHaveCount(2);
      await expect(dp.getByTestId("her-facts")).toContainText("爸爸有乙肝");
      await expect(dp.getByTestId("her-facts")).toContainText(zh ? "早上 7:30" : "7:30 am");
      await expect(waiting.first()).toContainText(zh ? "等爸爸确认" : "Waiting for 爸爸");
      await check(dp, "family", "facts-waiting", locale);

      // his side has them as proposals, with her name; his reminders have not moved
      const profile = (await (await him.request.get("/api/profile")).json()) as { profile: { pending: { id: string; text: string; kind: string }[] } };
      expect(profile.profile.pending.map((f) => f.kind).sort()).toEqual(["condition", "routine"]);
      const condition = profile.profile.pending.find((f) => f.kind === "condition")!;
      const routine = profile.profile.pending.find((f) => f.kind === "routine")!;

      // her home: the row says how her lines stand
      await dp.goto(`/f?link=${id}`);
      const row = dp.locator('[data-rp="family-stat"]', { hasText: zh ? "你补充的资料" : "What you added" });
      await expect(row).toContainText(zh ? "2 条等爸爸确认" : "2 waiting for 爸爸");
      await check(dp, "family", "home-facts-waiting", locale);

      // he taps 对 on his own phone (track C's route): her open home says so by itself
      const answered = await him.request.patch(`/api/profile/facts/${condition.id}`, { data: { answer: "yes" } });
      expect(answered.status(), await answered.text()).toBe(200);
      await expect(dp.getByTestId("family-notice")).toHaveText(zh ? "爸爸确认了你补充的资料。" : "爸爸 confirmed what you added.", { timeout: 5000 });
      await expect(row).toContainText(zh ? "1 条等爸爸确认" : "1 waiting for 爸爸");
      expect((await him.request.patch(`/api/profile/facts/${routine.id}`, { data: { answer: "yes" } })).status()).toBe(200);
      await expect(row).toContainText(zh ? "爸爸确认了" : "爸爸 confirmed", { timeout: 5000 });
      await check(dp, "family", "home-facts-confirmed", locale);

      // her list: 「爸爸确认了」 on both
      await row.click();
      await dp.waitForURL(/\/f\/facts\?link=/);
      await expect(dp.getByTestId("her-fact-confirmed")).toHaveCount(2);
      await expect(dp.getByTestId("her-fact-confirmed").first()).toContainText(zh ? "爸爸确认了" : "爸爸 confirmed");
      await check(dp, "family", "facts-confirmed", locale);

      // a line he answers 不对 while her list is open goes away by itself
      await dp.getByTestId("fact-kind-other").click();
      await dp.getByTestId("fact-text").fill("他喜欢早上去公园");
      await dp.getByTestId("fact-send").click();
      await expect(dp.getByTestId("her-fact-waiting")).toHaveCount(1);
      const again = (await (await him.request.get("/api/profile")).json()) as { profile: { pending: { id: string }[] } };
      expect((await him.request.patch(`/api/profile/facts/${again.profile.pending[0].id}`, { data: { answer: "no" } })).status()).toBe(200);
      await expect(dp.getByTestId("her-fact-waiting")).toHaveCount(0, { timeout: 5000 });
      await expect(dp.getByTestId("her-facts")).not.toContainText("公园");
      await him.close();
      await her.close();
    });

    test(`his account is deleted: her open home, then /f, say the connection has ended (${locale})`, async ({ browser, baseURL }) => {
      const him = await phone(browser, baseURL!, "zh-Hans");
      const her = await phone(browser, baseURL!, locale);
      await account(him, "blank", "陈先生");
      await account(her, "none", "Wei Ling");
      const id = await link(him, her);
      const dp = await her.newPage();
      await dp.goto(`/f?link=${id}`);
      await welcomed(dp, id);
      await dp.reload();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");

      const gone = await him.request.post("/api/me/delete", { data: { password: PASSWORD, confirm: true } });
      expect(gone.status(), await gone.text()).toBe(200);

      const words = zh ? "这个联系已经结束。" : "This connection has ended.";
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "gone", { timeout: 5000 });
      await expect(dp.getByTestId("family-headline")).toHaveText(words);
      await check(dp, "family", "gone-open-page", locale);
      // what track H saw: /f with no link in the address, and it was her only link
      await dp.goto("/f");
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "gone");
      await expect(dp.getByTestId("family-headline")).toHaveText(words);
      await expect(dp.locator("body")).not.toContainText(zh ? "你还没有在看谁" : "not following anyone");
      await check(dp, "family", "gone-no-link", locale);
      await dp.goto(`/f?link=${id}`);
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "gone");
      // a sub-page of the old link leads to the same sentence
      await dp.goto(`/f/facts?link=${id}`);
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "gone");
      await him.close();
      await her.close();
    });

    test(`the accepted notice lands on Today's confirm card, even while the morning's medicine waits (${locale})`, async ({ browser, baseURL, request }) => {
      await clock(request, "2026-10-13T07:30:00+08:00");
      try {
        const him = await phone(browser, baseURL!, locale);
        const her = await phone(browser, baseURL!, "zh-Hans");
        await account(him, "example", "陈先生");
        await account(her, "none", "Wei Ling");
        const id = await link(him, her, false);
        // 8:50: the first reminder is out and the slot is waiting for him
        await clock(request, "2026-10-13T08:50:00+08:00");
        expect((await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } })).status()).toBe(200);
        const hp = await him.newPage();
        await hp.goto("/p/today");
        await expect(hp.getByTestId("dose-actions")).toBeVisible();
        await expect(hp.getByTestId("today-family-confirm")).toHaveCount(0);
        // the notice's own address
        await hp.goto("/p/today?confirm=1");
        const card = hp.getByTestId("today-family-confirm");
        await expect(card).toBeVisible();
        await expect(card).toHaveAttribute("data-link", id);
        await expect(hp.getByTestId("dose-actions")).toHaveCount(0);
        await expect(hp.locator("body")).toContainText(zh ? "Wei Ling 接受了邀请，是她吗？" : "Wei Ling accepted");
        await check(hp, "elder", "today-confirm-first", locale);
        await hp.getByTestId("confirm-yes").click();
        await expect(hp.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
        // the medicine is still waiting on Today
        await hp.goto("/p/today?confirm=1");
        await expect(hp.getByTestId("dose-actions")).toBeVisible();
        await expect(hp.getByTestId("today-family-confirm")).toHaveCount(0);
        await him.close();
        await her.close();
      } finally {
        await clock(request, null);
      }
    });

    test(`logging in from an invitation is not accepting; a helped account's confirm card says the tap is his own (${locale})`, async ({ browser, baseURL }) => {
      // his sign-up, made with someone helping him (real-app 2.2 step 5)
      const him = await phone(browser, baseURL!, locale);
      await signUp(him, { login: `h${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, displayName: "陈先生", assisted: true, space: "example", locale });
      // she has an account already and is signed out on this phone
      const her = await phone(browser, baseURL!, locale);
      const herLogin = `w${Math.random().toString(36).slice(2, 12)}`;
      await signUp(her, { login: herLogin, password: PASSWORD, displayName: "Wei Ling", space: "none", ai: "declined", locale });
      await logOut(her);
      // the sign-up set this phone's language from the account; the signed-out phone keeps the one under test
      await her.addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
      const made = await ok(him, "/api/family/invites", { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" });
      const id = (made.link as { id: string }).id;
      const invitation = String(made.path);

      const dp = await her.newPage();
      await dp.goto(invitation);
      await expect(dp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
      // signed out, 「接受」 leads to her sign-up, and the sign-up offers the login (the v3 draft's A2: 「已经有账号？登录」)
      await dp.getByTestId("invite-accept").click();
      await expect(dp.getByTestId("her-signup")).toBeVisible();
      await dp.getByTestId("invite-login").click();
      await expect(dp.getByTestId("her-login-form")).toBeVisible();
      await expect(dp.getByTestId("family-headline")).toHaveText(zh ? "登录你的账号。" : "Log in to your account.");
      await check(dp, "family", "invite-login-first", locale);
      await dp.getByTestId("her-login-name").fill(herLogin);
      await dp.getByTestId("her-login-password").fill(PASSWORD);
      await dp.getByTestId("her-login-submit").click();
      // back on the invitation, signed in; nothing is accepted yet
      await dp.waitForURL((u) => u.pathname === invitation);
      await expect(dp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
      const links = (await (await him.request.get("/api/family/links")).json()) as { patient: { id: string; state: string }[] };
      expect(links.patient.find((l) => l.id === id)?.state).toBe("invited");
      // her own tap accepts
      await dp.getByTestId("invite-accept").click();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "waiting");

      // his confirm card, on Today and on 「家人」: the tap is his own
      const hp = await him.newPage();
      for (const where of ["/p/today?confirm=1", "/p/family"]) {
        await hp.goto(where);
        await expect(hp.getByTestId("confirm-self")).toHaveText(zh ? "请陈先生本人点。" : "陈先生 should tap this himself.");
        await check(hp, "elder", `confirm-self-${where === "/p/family" ? "family" : "today"}`, locale);
      }
      await hp.getByTestId("confirm-yes").click();
      await expect(hp.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
      const me = (await (await him.request.get("/api/me")).json()) as { consents: { kind: string; decision: string; version: string; assisted: boolean }[] };
      expect(me.consents.find((c) => c.kind === "family_share")).toMatchObject({ decision: "granted", version: "2026-10-11", assisted: true });
      await him.close();
      await her.close();
    });

    test(`her 「我的」: Android's install button and the iPhone's pictured steps (${locale})`, async ({ browser, baseURL }) => {
      const him = await phone(browser, baseURL!, "zh-Hans");
      await account(him, "blank", "陈先生");

      // Android: the browser's offer, caught on another page of hers, shows as her button on 「我的」
      const her = await phone(browser, baseURL!, locale);
      await account(her, "none", "Wei Ling");
      const id = await link(him, her);
      const dp = await her.newPage();
      await dp.goto(`/f?link=${id}`);
      await welcomed(dp, id);
      await dp.goto(`/f/me?link=${id}`);
      await expect(dp.getByTestId("family-me")).toBeVisible();
      await expect(dp.getByTestId("her-install")).toHaveCount(0);
      const prevented = await dp.evaluate(() => {
        const w = window as unknown as { __rpPrompted: number };
        w.__rpPrompted = 0;
        const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
        e.prompt = async () => {
          w.__rpPrompted += 1;
        };
        e.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
      expect(prevented).toBe(true);
      const install = dp.getByTestId("her-install-android");
      await expect(install).toHaveText(zh ? "装到主屏" : "Add to Home Screen");
      await expect(dp.getByTestId("her-ios-steps")).toHaveCount(0);
      await check(dp, "family", "me-android-install", locale);
      await install.click();
      expect(await dp.evaluate(() => (window as unknown as { __rpPrompted: number }).__rpPrompted)).toBe(1);
      await expect(install).toHaveCount(0);
      await her.close();

      // iPhone, not opened from the Home Screen: the three pictured steps, in her colours and her words
      const sister = await phone(browser, baseURL!, locale, { userAgent: IPHONE_UA });
      await account(sister, "none", "Wei Ling");
      const id2 = await link(him, sister);
      const ip = await sister.newPage();
      await ip.goto(`/f?link=${id2}`);
      await expect(ip.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-1");
      await ip.getByTestId("phone-later").click();
      await expect(ip.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-2");
      await ip.getByTestId("push-later").click();
      await expect(ip.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-3");
      const first = ip.getByTestId("welcome-home-steps").getByTestId("her-ios-steps");
      await expect(first.locator("li")).toHaveCount(3);
      await expect(first.locator('[data-rp="step-picture"]')).toHaveCount(3);
      await check(ip, "family", "welcome-3-pictured", locale);
      await ip.getByTestId("welcome-done").click();
      await ip.goto(`/f/me?link=${id2}`);
      await expect(ip.getByTestId("me-notifications")).toHaveAttribute("data-state", "needs_home_screen");
      // 「我的」 is rows only (the v3 draft's G1): the steps are behind 「通知」 → 「怎么加到主屏」, and behind 「加到主屏」
      await expect(ip.getByTestId("her-ios-steps")).toHaveCount(0);
      await check(ip, "family", "me-iphone", locale);
      await ip.getByTestId("me-notifications-open").click();
      await expect(ip.getByTestId("family-notifications")).toBeVisible();
      await expect(ip.getByTestId("me-notifications")).toHaveAttribute("data-state", "needs_home_screen");
      await check(ip, "family", "me-notifications-iphone", locale);
      await ip.getByTestId("notifications-install").click();
      await expect(ip.getByTestId("family-install")).toBeVisible();
      const steps = ip.getByTestId("her-ios-steps");
      await expect(steps.locator("li")).toHaveCount(3);
      await expect(steps.locator('[data-rp="step-picture"]')).toHaveCount(3);
      await expect(steps.locator("li").nth(2)).toContainText(zh ? "打开通知" : "Turn on notifications");
      await expect(steps).not.toContainText(zh ? "开提醒" : "Turn on reminders");
      // her dark direction: the pictures sit on her surface colour, not on his light tint
      const tile = await steps.locator('[data-rp="step-picture"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(tile).toBe("rgb(30, 34, 39)");
      await check(ip, "family", "me-iphone-steps", locale);
      await sister.close();
      await him.close();
    });
  });
}
