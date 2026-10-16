/**
 * Page checks on track D's screens (架构审核 「每个页面自动查」; e2e/_checks/page-checks.ts): no sideways scroll at 360px,
 * no text under 16px on her phone (18px on his), no target under 44x44 (48x48 on his), no contrast violation (axe), on
 * every screen of hers (the invitation, her sign-up and login, waiting, the first-visit steps, her home empty and with
 * what he shares, the week, no reply, the recorder, what he shares, one visit, her page, Dad's number, the ended screen
 * and her page as it opens from there)
 * and of his (family, the invitation, the confirm card, one family member, stopped), in 华语 and in English.
 *
 * D_SHOTS_DIR=<folder> also saves a 390x844 picture of each screen there (for a person to judge the look).
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): a production build
 * started with scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1), or `next dev`. PW_PORT names it.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";
const SHOTS = process.env.D_SHOTS_DIR?.trim() || null;

async function account(context: BrowserContext, space: "example" | "blank" | "none", name: string): Promise<string> {
  const login = `d${Math.random().toString(36).slice(2, 12)}`;
  const r = await context.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space, display_name: name, locale: "zh-Hans" } });
  expect(r.status(), await r.text()).toBe(201);
  return login;
}

async function invite(him: BrowserContext): Promise<{ token: string; id: string }> {
  const r = await him.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
  expect(r.status(), await r.text()).toBe(201);
  const body = (await r.json()) as { path: string; link: { id: string } };
  return { token: body.path.replace(/^\/invite\//, ""), id: body.link.id };
}

async function ok(context: BrowserContext, p: string, data: unknown): Promise<void> {
  const r = await context.request.post(p, { data });
  expect(r.ok(), `${p}: ${await r.text()}`).toBe(true);
}

async function setLang(context: BrowserContext, baseURL: string, locale: string): Promise<void> {
  await context.addCookies([{ name: "rp_lang", value: locale, url: baseURL }]);
}

async function clock(request: APIRequestContext, at: string | null): Promise<void> {
  await request.post("/api/dev/clock", { data: at ? { at, frozen: true } : { clear: true } });
}

async function check(page: Page, side: "family" | "elder", name: string, locale: string): Promise<void> {
  // the fade-in has finished; then the four checks
  await expectPageChecks(page, { side });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}-${locale}.png`), fullPage: true });
  }
}

/** Her first-visit steps are done on this phone (lib/care/device.ts keeps that in localStorage). */
async function welcomed(page: Page, linkId: string): Promise<void> {
  await page.evaluate((id) => {
    localStorage.setItem(`rp_f_welcomed_${id}`, "1");
    localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
  }, linkId);
}

for (const locale of ["zh-Hans", "en"] as const) {
  test.describe(`track D screens (${locale})`, () => {
    test(`invitation, sign-up, waiting, first visit, home, his family screens (${locale})`, async ({ browser, baseURL }) => {
      // the walk is long since the v3 relay (about thirty screens of hers and his, each with the page checks): on a busy
      // machine, or the first time a dev server builds these pages, it does not fit the default half minute
      test.setTimeout(120_000);
      const him = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
      const her = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
      await setLang(him, baseURL!, locale);
      await setLang(her, baseURL!, locale);
      const hp = await him.newPage();
      const dp = await her.newPage();
      await account(him, "example", "陈先生");

      // his family screen, empty; the invitation form; the made link
      await hp.goto("/p/family");
      await expect(hp.getByTestId("page-family")).toHaveAttribute("data-state", "none");
      await check(hp, "elder", "p-family-none", locale);
      await hp.goto("/p/family/invite");
      await expect(hp.getByTestId("invite-form")).toBeVisible();
      await check(hp, "elder", "p-family-invite", locale);
      await hp.getByTestId("invite-name").fill("Wei Ling");
      await hp.getByTestId("invite-make").click();
      await expect(hp.getByTestId("invite-made")).toBeVisible();
      await check(hp, "elder", "p-family-invite-made", locale);
      const url = (await hp.getByTestId("invite-made").getAttribute("data-url"))!;
      const linkId = (await hp.getByTestId("invite-made").getAttribute("data-link"))!;
      const pathName = new URL(url).pathname;

      // her: the invitation, her sign-up, her login
      await dp.goto(pathName);
      await expect(dp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
      await check(dp, "family", "invite-open", locale);
      await dp.goto(`${pathName}/join`);
      await expect(dp.getByTestId("her-signup")).toBeVisible();
      await check(dp, "family", "invite-join", locale);
      await dp.goto(`${pathName}/login`);
      await expect(dp.getByTestId("her-login-form")).toBeVisible();
      await check(dp, "family", "invite-login", locale);

      // she signs up and accepts: waiting
      await account(her, "none", "Wei Ling");
      await ok(her, "/api/family/invites/accept", { token: pathName.replace(/^\/invite\//, "") });
      await dp.goto(`/f?link=${linkId}`);
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "waiting");
      await check(dp, "family", "f-waiting", locale);

      // his confirm card
      await hp.goto("/p/family");
      await expect(hp.getByTestId("page-family")).toHaveAttribute("data-state", "confirm");
      await check(hp, "elder", "p-family-confirm", locale);
      await hp.getByTestId("confirm-yes").click();
      await expect(hp.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
      await check(hp, "elder", "p-family-link", locale);

      // her first visit, three steps
      await dp.goto(`/f?link=${linkId}`);
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-1");
      await check(dp, "family", "f-welcome-1", locale);
      await dp.getByTestId("phone-input").fill("+65 0000 0000");
      await dp.getByTestId("phone-save").click();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-2");
      await check(dp, "family", "f-welcome-2", locale);
      await dp.getByTestId("push-later").click();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-3");
      await check(dp, "family", "f-welcome-3", locale);
      await dp.getByTestId("welcome-done").click();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");
      await check(dp, "family", "f-home-empty", locale);
      // nothing is shared yet: the screens behind his visit records and his notes say so (the v3 draft's F6)
      await dp.goto(`/f/shared/visits?link=${linkId}`);
      await expect(dp.getByTestId("family-visits")).toHaveAttribute("data-state", "not_shared");
      await check(dp, "family", "f-visits-not-shared", locale);
      await dp.goto(`/f/shared/notes?link=${linkId}`);
      await expect(dp.getByTestId("family-notes")).toHaveAttribute("data-state", "not_shared");
      await check(dp, "family", "f-notes-not-shared", locale);
      await dp.getByTestId("not-shared-home").click();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");

      // he shares everything: her home with the week, the counts, the visits and notes rows
      await ok(him, `/api/family/links/${linkId}/grants`, { items: { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true } });
      await dp.reload();
      await expect(dp.getByTestId("week-strip")).toBeVisible();
      await check(dp, "family", "f-home-shared", locale);
      await dp.goto(`/f/week?link=${linkId}`);
      await expect(dp.getByTestId("day-list")).toBeVisible();
      await check(dp, "family", "f-week", locale);
      // the v3 draft's C1: 「往前一周」 leads a week back; 「回到这一周」 is there only on an earlier week; one state per day, no names
      // this step runs on the real clock: from Monday midnight until the week's first dose is due her headline is
      // 「这周还没有要记的药。」 (lib/care/her-copy.ts weekHeadNone), any other time it names the week. Either is this week's.
      await expect(dp.getByTestId("family-headline")).toContainText(locale === "zh-Hans" ? /这一周|这周还没有要记的药/ : /This week|No medicine to log this week yet/);
      await expect(dp.getByTestId("day-list").locator("li")).toHaveCount(7);
      await expect(dp.getByTestId("day-list")).not.toContainText("Amlodipine");
      await expect(dp.getByTestId("week-this")).toHaveCount(0);
      await dp.getByTestId("week-earlier").click();
      await expect(dp.getByTestId("family-week")).toHaveAttribute("data-offset", "-1");
      await expect(dp.getByTestId("week-this")).toBeVisible();
      await check(dp, "family", "f-week-before", locale);
      await dp.goto(`/f/shared?link=${linkId}`);
      await expect(dp.getByTestId("shared-items")).toBeVisible();
      await check(dp, "family", "f-shared", locale);
      // his visit records and his notes have screens of their own (F3, F5), reached from their rows
      await dp.locator('[data-grant="visit_transcripts"]').click();
      await expect(dp.getByTestId("family-visits")).toHaveAttribute("data-state", "shown");
      await check(dp, "family", "f-visits", locale);
      const visit = dp.getByTestId("shared-visit").first();
      if (await visit.count()) {
        await visit.click();
        await expect(dp.getByTestId("family-visit")).toHaveAttribute("data-state", "shown");
        await check(dp, "family", "f-visit", locale);
      }
      await dp.goto(`/f/shared?link=${linkId}`);
      await dp.locator('[data-grant="notes"]').click();
      await expect(dp.getByTestId("family-notes")).toHaveAttribute("data-state", "shown");
      await check(dp, "family", "f-notes", locale);
      await dp.goto(`/f/reminder?link=${linkId}`);
      await expect(dp.getByTestId("reminder-studio")).toBeVisible();
      await check(dp, "family", "f-reminder", locale);
      // 「我录过的」 has a screen of its own (E5); she has recorded nothing, so it lists what his phone plays: the stand-in
      await dp.getByTestId("rec-mine-open").click();
      await expect(dp.getByTestId("rec-mine")).toHaveAttribute("data-count", "0");
      await expect(dp.getByTestId("rec-mine-other")).toContainText(locale === "zh-Hans" ? "代录音" : "stand-in voice");
      await check(dp, "family", "f-reminder-mine", locale);
      await dp.goto(`/f/me?link=${linkId}`);
      await expect(dp.getByTestId("family-me")).toBeVisible();
      await expect(dp.getByTestId("family-headline")).toHaveText(locale === "zh-Hans" ? "你在看爸爸的 Ripple。" : "You follow Dad's Ripple.");
      await check(dp, "family", "f-me", locale);
      // the screens behind its rows (the v3 draft's G2 to G4, and the Home Screen steps): each opens from its row
      await dp.getByTestId("me-notifications-open").click();
      await expect(dp.getByTestId("family-notifications")).toBeVisible();
      await expect(dp.getByTestId("me-notifications")).not.toHaveAttribute("data-state", "reading");
      await check(dp, "family", "f-me-notifications", locale);
      await dp.getByTestId("family-back").click();
      await dp.getByTestId("me-phone").click();
      await expect(dp.getByTestId("phone-input")).toBeVisible();
      await expect(dp.getByTestId("family-headline")).toHaveText(locale === "zh-Hans" ? "存一下爸爸的电话。" : "Save Dad's number.");
      await check(dp, "family", "f-phone", locale);
      await dp.getByTestId("family-back").click();
      await dp.getByTestId("me-install").click();
      await expect(dp.getByTestId("family-install")).toBeVisible();
      await check(dp, "family", "f-me-install", locale);
      await dp.getByTestId("install-done").click();
      await dp.getByTestId("me-leave-open").click();
      await expect(dp.getByTestId("family-leave")).toBeVisible();
      await expect(dp.getByTestId("leave-what").locator("li")).toHaveCount(4);
      await check(dp, "family", "f-me-leave", locale);
      // 「先不要」 changes nothing
      await dp.getByTestId("leave-not-now").click();
      await expect(dp.getByTestId("family-me")).toBeVisible();
      await dp.goto(`/f/alert?link=${linkId}`);
      await expect(dp.getByTestId("family-alert")).toBeVisible();
      await check(dp, "family", "f-alert-calm", locale);

      // he stops sharing: her ended screen, his stopped screen
      await dp.goto(`/f?link=${linkId}`);
      await welcomed(dp, linkId);
      await ok(him, `/api/family/links/${linkId}/revoke`, {});
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "ended", { timeout: 5000 });
      await check(dp, "family", "f-ended", locale);
      // the screen that says so keeps 「我的」 at the top right (the v3 draft's H1): her own page still opens, with her
      // own account's rows alone and nothing that needs him
      await dp.getByTestId("open-me").click();
      await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");
      await expect(dp.getByTestId("family-headline")).toHaveText(locale === "zh-Hans" ? "爸爸停止了分享。" : "Dad stopped sharing.");
      for (const row of ["me-name", "me-sign-in", "me-password", "me-devices", "me-recovery", "me-lang-zh", "me-logout", "me-delete"]) await expect(dp.getByTestId(row), row).toBeVisible();
      for (const row of ["me-notifications-open", "me-phone", "open-facts", "me-install", "me-leave-open"]) await expect(dp.getByTestId(row), row).toHaveCount(0);
      await check(dp, "family", "f-me-ended", locale);
      // its way back is the same sentence, now as the server draws it, with 「我的」 again
      await dp.getByTestId("family-back").click();
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "ended");
      await expect(dp.getByTestId("open-me")).toBeVisible();
      await check(dp, "family", "f-ended-later", locale);
      await hp.goto(`/p/family/${linkId}`);
      await expect(hp.getByTestId("page-family-link")).toHaveAttribute("data-state", "revoked");
      await check(hp, "elder", "p-family-stopped", locale);
      await him.close();
      await her.close();
    });

    test(`no reply: her alert screen and her home (${locale})`, async ({ browser, baseURL, request }) => {
      // the morning before the reminders, so today's cell is tracked; then past the window, and the jobs run once
      await clock(request, "2026-10-13T07:30:00+08:00");
      try {
        const him = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
        const her = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
        await setLang(her, baseURL!, locale);
        await account(him, "example", "陈先生");
        await account(her, "none", "Wei Ling");
        const inv = await invite(him);
        await ok(her, "/api/family/invites/accept", { token: inv.token });
        await ok(him, `/api/family/links/${inv.id}/confirm`, { yes: true });
        await ok(him, `/api/family/links/${inv.id}/grants`, { items: { dose_summary: true, no_reply_alert: true, bp_summary: true } });
        for (const at of ["2026-10-13T08:46:00+08:00", "2026-10-13T09:16:00+08:00", "2026-10-13T09:46:00+08:00"]) {
          await clock(request, at);
          expect((await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } })).status()).toBe(200);
        }
        const dp = await her.newPage();
        await dp.goto(`/f?link=${inv.id}`);
        await welcomed(dp, inv.id);
        await dp.reload();
        await expect(dp.getByTestId("home-no-reply")).toBeVisible();
        await check(dp, "family", "f-home-no-reply", locale);
        await dp.goto(`/f/alert?link=${inv.id}`);
        await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "no_reply");
        await expect(dp.getByTestId("family-timeline").locator("li")).toHaveCount(3);
        await check(dp, "family", "f-alert", locale);
        // only 「两次提醒没回时通知她」 on (found by track I): the same alert, without the week or any medicine name
        await ok(him, `/api/family/links/${inv.id}/grants`, { items: { dose_summary: false, no_reply_alert: true, bp_summary: false } });
        await dp.goto(`/f?link=${inv.id}`);
        await expect(dp.getByTestId("home-no-reply")).toBeVisible();
        // (he is what she calls him, 「爸爸」, in either language)
        await expect(dp.getByTestId("family-headline")).toHaveText(locale === "zh-Hans" ? "爸爸还没回早上的药。" : "爸爸 hasn't answered about his morning medicine.");
        await expect(dp.getByTestId("week-strip")).toHaveCount(0);
        await check(dp, "family", "f-home-no-reply-alert-only", locale);
        await dp.goto(`/f/alert?link=${inv.id}`);
        await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "no_reply");
        await expect(dp.getByTestId("family-timeline").locator("li")).toHaveCount(3);
        await expect(dp.locator("body")).not.toContainText("Amlodipine");
        // D4: no number saved on this phone: 「打电话给爸爸」 opens the bottom sheet instead of dialling
        await dp.evaluate((id) => localStorage.removeItem(`rp_f_phone_${id}`), inv.id);
        await dp.reload();
        await dp.getByTestId("call-dad").click();
        await expect(dp.getByTestId("phone-sheet")).toBeVisible();
        await check(dp, "family", "f-alert-sheet", locale);
        await dp.getByTestId("phone-sheet-later").click();
        await expect(dp.getByTestId("phone-sheet")).toHaveCount(0);
        await welcomed(dp, inv.id);
        // D3: he answers after all (his medicine shared again): her open screen calms down by itself, the earlier lines
        // go quiet and its one button leads home
        await ok(him, `/api/family/links/${inv.id}/grants`, { items: { dose_summary: true, no_reply_alert: true, bp_summary: true } });
        await dp.reload();
        await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-live", "open");
        await clock(request, "2026-10-13T10:02:00+08:00");
        await ok(him, "/api/doses", { medication_id: "med-amlodipine", slot: "morning", state: "taken" });
        await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "answered", { timeout: 15_000 });
        await expect(dp.getByTestId("family-headline")).toHaveText(locale === "zh-Hans" ? "爸爸 10:02 吃了早上的药。" : "爸爸 took his morning medicine at 10:02.");
        await expect(dp.getByTestId("family-timeline").locator("li")).toHaveCount(4);
        await expect(dp.getByTestId("family-timeline").locator('li[data-state="past"]')).toHaveCount(3);
        await expect(dp.getByTestId("alert-home")).toBeVisible();
        await expect(dp.getByTestId("call-dad")).toHaveCount(0);
        await check(dp, "family", "f-alert-answered", locale);
        await him.close();
        await her.close();
      } finally {
        await clock(request, null);
      }
    });
  });
}
