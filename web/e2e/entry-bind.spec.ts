/**
 * The way in, end to end, as the owner described it on 2026-10-11: open the app, say which side you are, sign up or log
 * in, and bind by typing the other person's account; no step after that.
 *
 * The door and the two sides are line entry's (e2e/fe-entry.spec.ts), the binding is line bind's (e2e/bind.spec.ts and
 * bind-walk.ts). Each was built without the other; this walks them joined, through the pages only:
 *
 *   a son or daughter   the door (the splash plays) -> 「注册」 -> 「你是哪一位？」 -> 「我是子女」 -> her six steps (the
 *                       terms she agrees to say what binding does) -> her page asks for the elder's account -> she
 *                       types it -> his day opens with what the four switches show, and her recorder is closed
 *   that elder          his Today shows 「Wei Ling 绑定了你的账号」; he taps 「知道了」 and her recorder opens
 *   an elder            the door -> 「登录」 -> 「你是哪一位？」 -> 「我是长辈」 -> his log-in -> 「邀请家人」: he types a family
 *                       member's account and lands on his switches for her, four on
 *
 * The elders are test accounts (POST /api/dev/accounts, Mr Tan's example data); she is made by the pages. The test
 * clock stands at Mon 12 Oct 2026, 19:30 in Singapore, as in bind-walk: no medicine slot is waiting for him.
 */
import { expect, test } from "@playwright/test";
import { clearClock, setClock, SGT, skipWelcome } from "./bind-walk";
import { newLogin, phone } from "./fe-auth-kit";
import { newAccount, TEST_PASSWORD } from "./journeys/_d/family";

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.afterAll(async ({ request }) => {
  await clearClock(request);
});

test("a daughter: from the door through 「我是子女」 and her sign-up to his day, by typing his account; he sees who bound him", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "19:30"));

  // the elder she will bind: an account that exists, on his own phone
  const his = await phone(browser, { reducedMotion: true });
  const him = await newAccount(his.context, { space: "example", displayName: "陈先生", prefix: "eb" });
  await his.context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });

  // ---- her phone: the door, with the cold start's splash
  const hers = await phone(browser);
  const page = hers.page;
  await page.goto("/");
  await expect(page.getByTestId("front-door")).toBeVisible();
  await expect(page.locator('[data-rp="splash"]')).toBeHidden({ timeout: 15_000 });
  await page.getByTestId("front-door-signup").click();
  await expect(page).toHaveURL(/\/who\?do=signup/);
  await page.getByTestId("who-family").click();
  await expect(page).toHaveURL(/\/signup\?as=family/);

  // ---- her six steps
  const next = () => page.getByTestId("signup-next").click();
  const herLogin = newLogin("wl");
  await expect(page.getByTestId("signup-step-name")).toHaveAttribute("data-flow", "family");
  await page.getByTestId("signup-name").fill("Wei Ling");
  await next();
  await page.getByTestId("signup-login").fill(herLogin);
  await next();
  await expect(page.getByTestId("signup-step-password")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("signup-password").fill(TEST_PASSWORD);
  await next();
  // the terms in force say what typing an account does, before she agrees
  await expect(page.getByTestId("signup-terms-text")).toContainText("你填了家人的账号，或者家人填了你的账号，就绑定了");
  await page.getByTestId("signup-agree").click();
  await expect(page.getByTestId("signup-step-ai")).toBeVisible();
  await page.getByTestId("signup-ai-agree").click();
  await expect(page.getByTestId("signup-step-code")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("signup-kept").click();
  await expect(page).toHaveURL(/\/f$/);

  // ---- her page asks for the elder's account; typing it is all there is
  await expect(page.getByTestId("family-headline")).toHaveText("填长辈的账号");
  await page.getByTestId("bind-account").fill(him.login);
  await page.getByTestId("bind-submit").click();
  await page.waitForURL(/\/f\?link=[0-9a-f-]{36}$/);
  const linkId = new URL(page.url()).searchParams.get("link")!;
  await skipWelcome(page);
  await expect(page.getByTestId("week-strip")).toBeVisible();
  const view = (await (await hers.context.request.get(`/api/family/view?link=${linkId}`)).json()) as { grants: Record<string, boolean> };
  expect(view.grants).toEqual({ dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false });
  // nothing of hers reaches his phone before he has answered
  await page.getByTestId("record-new").click();
  await expect(page.getByTestId("reminder-locked")).toBeVisible();
  await expect(page.getByTestId("recorder")).toHaveCount(0);

  // ---- his phone: who bound him, and the two answers
  await his.page.goto("/p/today?confirm=1");
  const card = his.page.getByTestId("today-family-bound");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Wei Ling");
  await expect(his.page.getByTestId("bound-who")).toContainText(herLogin);
  await expect(his.page.getByTestId("bound-remove")).toHaveText("不认识这个人，解除");
  await his.page.getByTestId("bound-ok").click();
  await expect(card).toHaveCount(0);
  await expect(his.page.getByTestId("page-today")).toBeVisible();

  // ---- and now her recorder is there
  await expect(page.getByTestId("recorder")).toBeVisible({ timeout: 15_000 });

  await his.context.close();
  await hers.context.close();
});

test("an elder: from the door through 「我是长辈」 and his log-in to 「邀请家人」, where typing her account binds her with four items on", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "19:30"));

  // the two accounts, each made on a phone that is then put away
  const made = await phone(browser, { reducedMotion: true });
  const him = await newAccount(made.context, { space: "example", displayName: "林女士", prefix: "el" });
  await made.context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  await made.context.close();
  const madeHer = await phone(browser, { reducedMotion: true });
  const her = await newAccount(madeHer.context, { space: "none", displayName: "Hui Min", prefix: "hm" });
  await madeHer.context.close();

  // ---- his phone, not signed in: the door, 「登录」, his side
  const { context, page } = await phone(browser, { reducedMotion: true });
  await page.goto("/");
  await page.getByTestId("front-door-login").click();
  await expect(page).toHaveURL(/\/who\?do=login/);
  await page.getByTestId("who-elder").click();
  await expect(page).toHaveURL(/\/login\?as=elder/);
  await page.getByTestId("login-login").fill(him.login);
  await page.getByTestId("login-next").click();
  await expect(page.getByTestId("login-step-password")).toBeVisible();
  await page.getByTestId("login-password").fill(TEST_PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/p\/today/, { timeout: 30_000 });

  // ---- 「邀请家人」: her account, one tap
  await page.goto("/p/family/invite");
  await expect(page.getByTestId("bind-family")).toBeVisible();
  await page.getByTestId("bind-account").fill(her.login);
  await page.getByTestId("bind-submit").click();
  await expect(page.getByTestId("page-family-link")).toHaveAttribute("data-state", "active", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/p\/family\/[0-9a-f-]{36}$/);
  const linkId = page.url().split("/").pop()!;

  // ---- she logs in on her side and his day is there: nothing waited for anyone
  const hers = await phone(browser, { reducedMotion: true });
  await hers.page.goto("/login?as=family");
  await hers.page.getByTestId("login-login").fill(her.login);
  await hers.page.getByTestId("login-next").click();
  await hers.page.getByTestId("login-password").fill(TEST_PASSWORD);
  await hers.page.getByTestId("login-submit").click();
  await expect(hers.page).toHaveURL(/\/f/, { timeout: 30_000 });
  const view = (await (await hers.context.request.get(`/api/family/view?link=${linkId}`)).json()) as { grants: Record<string, boolean> };
  expect(view.grants).toEqual({ dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false });

  await context.close();
  await hers.context.close();
});
