/**
 * One walk through the three places of binding by account (line bind; web/progress/bind.md), in both directions,
 * shared by the checks (e2e/bind.spec.ts) and the pictures (e2e/fe-shots-bind.spec.ts). Not a spec by itself.
 *
 *   she binds   her /f with no link: the form, a refusal in words, the tap; her home opens with what the four default
 *               switches show; the place of her recorder says what she waits for. His phone: the card on Today (the
 *               notice lands there), the row and her page under 「家人」; 「知道了」, and her recorder is there.
 *   he binds    his 「邀请家人」: the direct way above the invitation, two refusals in words, the tap; he lands on his
 *               switches for her, four on; the list of changes says what the link started with.
 *   he removes  a third family member binds him; he taps 「不认识这个人，解除」 and her open page says he stopped.
 *   round two   (the integrator, 2026-10-11) before he has answered she gets nothing of the reminder his phone plays;
 *               his page of the person he removed says she bound his account herself and offers no 「重新邀请」; her
 *               ended screens carry 「绑定另一位长辈」, which opens the form again (/f?bind=1), and the form refuses
 *               the elder who removed her in words; 「我的」 has the row 「再绑定一位长辈」; the two sentences about what
 *               she sees say "what is switched on"; the invitation's own words (family_accept 2026-10-11).
 *
 * The accounts are test accounts made through POST /api/dev/accounts (his: Mr Tan's example data; hers: no space), on
 * the developer test clock (Mon 12 Oct 2026, evening: no medicine slot is waiting for him). Everything else goes through
 * the pages and the real routes. At each state the walk calls `at(page, id, side)`.
 *
 * The test clock is one per server: one walk at a time on a port.
 */
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type WalkLang = "zh-Hans" | "en";
export type WalkSide = "elder" | "family";
export const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const PASSWORD = "a long test password";

export async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

export async function clearClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/clock", { data: { clear: true } });
}

async function phone(browser: Browser, baseURL: string, lang: WalkLang, scale: number): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await context.addCookies([{ name: "rp_lang", value: lang, url: baseURL }]);
  return context;
}

/** A test account signed in on this phone; the account name it signs in with. */
async function account(context: BrowserContext, space: "example" | "none", name: string, locale: WalkLang, prefix: string): Promise<string> {
  const login = `${prefix}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const res = await context.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space, display_name: name, locale } });
  expect(res.status(), await res.text()).toBe(201);
  return login;
}

/** Her first visit's three steps, each put off (「以后再说」): her home is what the walk is about. */
export async function skipWelcome(page: Page): Promise<void> {
  const app = page.getByTestId("family-app");
  await expect(app).toHaveAttribute("data-state", "welcome-1", { timeout: 15_000 });
  await page.getByTestId("phone-later").click();
  await expect(app).toHaveAttribute("data-state", "welcome-2");
  await page.getByTestId("push-later").click();
  await expect(app).toHaveAttribute("data-state", "welcome-3");
  await page.getByTestId("welcome-skip").click();
  await expect(app).not.toHaveAttribute("data-state", /^welcome-/);
}

export interface WalkOptions {
  lang?: WalkLang;
  /** 2 for pictures, 1 for checks */
  scale?: number;
  /** called at every state, with the page on it and the side whose page it is */
  at: (page: Page, id: string, side: WalkSide) => Promise<void>;
}

export const WALK_STATES = [
  "f-form",
  "f-form-not-found",
  "f-home-bound",
  "f-reminder-locked",
  "f-facts-locked",
  "today-bound",
  "family-list-bound",
  "link-bound",
  "today-after-ok",
  "f-reminder-open",
  "invite-direct",
  "invite-direct-refused",
  "link-four-on",
  "seen-bound",
  "today-bound-stranger",
  "f-removed",
  "link-removed",
  // round two
  "f-bind-again",
  "f-bind-removed",
  "f-ended-plain",
  "f-me-ended",
  "f-me-bind",
  "access-lede",
  "invite-consent",
] as const;

export async function walkBinding(browser: Browser, request: APIRequestContext, baseURL: string, opts: WalkOptions): Promise<void> {
  const lang = opts.lang ?? "zh-Hans";
  const zh = lang === "zh-Hans";
  const at = opts.at;
  const scale = opts.scale ?? 1;
  await setClock(request, SGT("2026-10-12", "19:30"));

  // ================================================================= she binds
  const him = await phone(browser, baseURL, lang, scale);
  const hisLogin = await account(him, "example", "陈先生", lang, "tan");
  // the example's one-time intro was put away earlier
  await him.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const pp = await him.newPage();
  const her = await phone(browser, baseURL, lang, scale);
  const herLogin = await account(her, "none", "Wei Ling", lang, "weiling");
  const dp = await her.newPage();
  const app = dp.getByTestId("family-app");

  // ---- her /f with no link: the form
  await dp.goto("/f");
  await expect(app).toHaveAttribute("data-state", "no_link");
  await expect(dp.getByTestId("family-headline")).toHaveText(zh ? "填长辈的账号" : "Enter your elder's account");
  await expect(dp.getByTestId("bind-where")).toHaveText(zh ? "你还没有在看谁的 Ripple。" : "You are not following anyone's Ripple yet.");
  await expect(dp.getByTestId("family-lede")).toContainText(zh ? "填好就绑定，你马上能看到：这周吃药的天数、量了几次血压、有几个问题要问医生" : "Once you link, you can see at once");
  await expect(dp.locator('[data-testid="bind-calls"] [data-choice="name"]')).toHaveAttribute("aria-checked", "true");
  await expect(dp.getByTestId("me-logout")).toBeVisible();
  await at(dp, "f-form", "family");

  // a refusal is said in words under the form: nothing typed, then an account that is not there
  await dp.getByTestId("bind-submit").click();
  await expect(dp.getByTestId("bind-error")).toHaveText(zh ? "先填上长辈的账号。" : "Type your elder's account first.");
  await dp.getByTestId("bind-account").fill(`nobody-${randomUUID().slice(0, 8)}`);
  await dp.getByTestId("bind-submit").click();
  await expect(dp.getByTestId("bind-error")).toHaveText(zh ? "没有找到这个账号。看看有没有打错。" : "No such account was found. Check the spelling.");
  await at(dp, "f-form-not-found", "family");
  // her own account, then another family member's
  await dp.getByTestId("bind-account").fill(herLogin);
  await dp.getByTestId("bind-submit").click();
  await expect(dp.getByTestId("bind-error")).toHaveText(zh ? "这是你自己的账号。这里填长辈的账号。" : "That is your own account. Type your elder's account here.");

  // ---- the tap: she is linked at once and her home opens (after the three first-visit steps)
  await dp.getByTestId("bind-account").fill(hisLogin);
  await expect(dp.getByTestId("bind-error")).toHaveCount(0);
  await dp.locator('[data-testid="bind-calls"] [data-choice="dad"]').click();
  await expect(dp.locator('[data-testid="bind-calls"] [data-choice="dad"]')).toHaveAttribute("aria-checked", "true");
  await dp.getByTestId("bind-submit").click();
  await dp.waitForURL(/\/f\?link=[0-9a-f-]{36}$/);
  const linkId = new URL(dp.url()).searchParams.get("link")!;
  await skipWelcome(dp);
  // the four default sections, and none of his words
  await expect(dp.getByTestId("week-strip")).toBeVisible();
  await expect(dp.locator('[data-rp="family-stats"]')).toContainText(zh ? "这周量血压" : "Blood pressure this week");
  await expect(dp.locator('[data-rp="family-stats"]')).toContainText(zh ? "要问医生的" : "Questions for the doctor");
  type HomeView = { grants: Record<string, boolean>; visitsShared: boolean; notesShared: boolean; patientLabel: string; reminder: { at: string } | null };
  const view = (await (await her.request.get(`/api/family/view?link=${linkId}`)).json()) as HomeView;
  expect(view.grants).toEqual({ dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false });
  expect(view).toMatchObject({ visitsShared: false, notesShared: false, patientLabel: zh ? "爸爸" : "Dad" });
  // round two: before he has answered, nothing of the reminder his phone plays (not on her home, not as a list)
  expect(view.reminder).toBeNull();
  expect((await her.request.get(`/api/reminders?link=${linkId}`)).status()).toBe(409);
  await at(dp, "f-home-bound", "family");

  // ---- the place of her recorder, before he has answered
  await dp.getByTestId("record-new").click();
  await expect(dp.getByTestId("family-reminder")).toHaveAttribute("data-state", "locked");
  await expect(dp.getByTestId("reminder-locked").getByTestId("family-headline")).toHaveText(zh ? "等他在自己的手机上点了「知道了」，你就可以给他录提醒。" : "Once he taps “Got it” on his own phone, you can record a reminder for him.");
  await expect(dp.getByTestId("recorder")).toHaveCount(0);
  await at(dp, "f-reminder-locked", "family");
  // the other thing of hers that would reach his phone, a line for his details: her screen says what she waits for
  // (trying again would not help), and nothing was stored
  const reminderUrl = dp.url();
  await dp.goto(`/f/facts?link=${linkId}`);
  await expect(dp.getByTestId("family-facts")).toBeVisible();
  await dp.getByTestId("fact-text").fill(zh ? "他喜欢早上去公园" : "He likes the park in the morning");
  await dp.getByTestId("fact-send").click();
  await expect(dp.getByTestId("fact-error")).toHaveText(zh ? "等他在自己的手机上点了「知道了」，你就可以给他补充资料。" : "Once he taps “Got it” on his own phone, you can add to his details.");
  await expect(dp.getByTestId("family-facts")).toHaveAttribute("data-waiting", "0");
  await at(dp, "f-facts-locked", "family");
  await dp.goto(reminderUrl);
  await expect(dp.getByTestId("reminder-locked")).toBeVisible();

  // ---- his phone: the card on Today (where the notice lands), the row and her page under 「家人」
  await pp.goto("/p/today?confirm=1");
  const card = pp.getByTestId("today-family-bound");
  await expect(card).toHaveAttribute("data-link", linkId);
  await expect(card.locator(".rpu-tl-title")).toHaveText(zh ? "Wei Ling 绑定了你的账号" : "Wei Ling linked to your account");
  await expect(pp.getByTestId("bound-who")).toHaveText(zh ? `账号 ${herLogin}，10月12日 19:30。` : `Account ${herLogin}, 12 Oct 19:30.`);
  await expect(pp.getByTestId("bound-sees")).toHaveText(
    zh
      ? "她现在能看到：这周吃药的天数、量了几次血压、有几个问题要问医生；提醒两次没回的时候会通知她。"
      : "She can now see: the days you took your medicine this week, how many times you measured your blood pressure, and how many questions you have for the doctor; and she is told when two reminders get no reply.",
  );
  await expect(card).toContainText(zh ? "看诊录音和你的笔记她看不到。" : "She cannot see your visit recordings or your notes.");
  await expect(pp.getByTestId("bound-ok")).toHaveText(zh ? "知道了" : "Got it");
  await expect(pp.getByTestId("bound-remove")).toHaveText(zh ? "不认识这个人，解除" : "I do not know this person. Remove");
  await at(pp, "today-bound", "elder");

  await pp.goto("/p/family");
  const row = pp.locator(`[data-testid="family-list"] [data-link="${linkId}"]`);
  await expect(row).toHaveAttribute("data-ack", "no");
  await expect(row).toContainText(zh ? "绑定了你的账号，等你看一下" : "Linked to your account; waiting for you to look");
  // round two: the list's lead says what is switched on (four are on that he did not switch on himself)
  await expect(pp.getByTestId("page-family")).toContainText(zh ? "她只能看到开着的这几项。随时能关。" : "She sees only what is switched on. Switch it off any time.");
  await at(pp, "family-list-bound", "elder");

  await row.click();
  const linkPage = pp.getByTestId("page-family-link");
  await expect(linkPage).toHaveAttribute("data-state", "active");
  await expect(linkPage).toHaveAttribute("data-ack", "no");
  await expect(pp.getByTestId("link-bound")).toBeVisible();
  const on = (k: string) => pp.locator(`[data-grant="${k}"] [role="switch"]`);
  for (const k of ["dose_summary", "bp_summary", "questions_count", "no_reply_alert"]) await expect(on(k), k).toHaveAttribute("aria-checked", "true");
  for (const k of ["visit_transcripts", "notes"]) await expect(on(k), k).toHaveAttribute("aria-checked", "false");
  await at(pp, "link-bound", "elder");

  // ---- 「知道了」 on Today: the card goes, and her recorder is there without her doing anything
  await pp.goto("/p/today?confirm=1");
  await pp.getByTestId("bound-ok").click();
  await expect(pp.getByTestId("today-family-bound")).toHaveCount(0);
  await expect(pp.getByTestId("page-today")).toBeVisible();
  await at(pp, "today-after-ok", "elder");
  await expect(dp.getByTestId("recorder")).toBeVisible({ timeout: 15_000 });
  await expect(dp.getByTestId("reminder-locked")).toHaveCount(0);
  await at(dp, "f-reminder-open", "family");
  // round two: and now the reminder his phone plays is hers to see, as for any family member in force
  expect(((await (await her.request.get(`/api/family/view?link=${linkId}`)).json()) as HomeView).reminder).toMatchObject({ at: expect.stringMatching(/^\d{1,2}:\d{2}$/) });
  expect((await her.request.get(`/api/reminders?link=${linkId}`)).status()).toBe(200);
  // and under 「家人」 her row and her page are an ordinary link's again
  await pp.goto(`/p/family/${linkId}`);
  await expect(linkPage).not.toHaveAttribute("data-ack", "no");
  await expect(pp.getByTestId("link-bound")).toHaveCount(0);

  // ================================================================= he binds
  const him2 = await phone(browser, baseURL, lang, scale);
  const his2Login = await account(him2, "example", "林女士", lang, "lim");
  await him2.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const p2 = await him2.newPage();
  const her2 = await phone(browser, baseURL, lang, scale);
  const her2Login = await account(her2, "none", "Hui Min", lang, "huimin");

  await p2.goto("/p/family/invite");
  const direct = p2.getByTestId("bind-family");
  await expect(direct).toBeVisible();
  await expect(direct.locator('[data-rp="section-title"]')).toHaveText(zh ? "填家人的账号" : "Enter a family member's account");
  await expect(direct).toContainText(zh ? "填好就绑定，她马上能看到下面四项；看诊录音和你的笔记要你自己打开。" : "she can see the four items below at once");
  await expect(p2.getByTestId("bind-four").locator("[data-item]")).toHaveCount(4);
  // the invitation is still there, as the second way
  await expect(p2.getByTestId("invite-second")).toHaveText(zh ? "她还没有账号？发一个邀请链接给她。" : "She has no account yet? Send her an invitation link.");
  await expect(p2.getByTestId("invite-form")).toBeVisible();
  await expect(p2.getByTestId("invite-make")).toBeVisible();
  await at(p2, "invite-direct", "elder");

  // refusals in words: his own account, then another elder's
  await p2.getByTestId("bind-account").fill(his2Login);
  await p2.getByTestId("bind-submit").click();
  await expect(p2.getByTestId("bind-error")).toHaveText(zh ? "这是你自己的账号。这里填家人的账号。" : "That is your own account. Type the family member's account here.");
  await p2.getByTestId("bind-account").fill(hisLogin);
  await p2.getByTestId("bind-submit").click();
  await expect(p2.getByTestId("bind-error")).toHaveText(zh ? "这个账号也是长辈的账号，绑定不了。" : "That account is an elder's account too. It cannot be linked.");
  await at(p2, "invite-direct-refused", "elder");

  // the tap: he lands on his switches for her, four on, and nothing asks him to acknowledge his own act
  await p2.getByTestId("bind-account").fill(her2Login);
  await p2.getByTestId("bind-submit").click();
  const link2 = p2.getByTestId("page-family-link");
  await expect(link2).toHaveAttribute("data-state", "active", { timeout: 15_000 });
  await expect(p2).toHaveURL(/\/p\/family\/[0-9a-f-]{36}$/);
  await expect(link2).not.toHaveAttribute("data-ack", "no");
  await expect(p2.getByTestId("link-bound")).toHaveCount(0);
  const on2 = (k: string) => p2.locator(`[data-grant="${k}"] [role="switch"]`);
  for (const k of ["dose_summary", "bp_summary", "questions_count", "no_reply_alert"]) await expect(on2(k), k).toHaveAttribute("aria-checked", "true");
  for (const k of ["visit_transcripts", "notes"]) await expect(on2(k), k).toHaveAttribute("aria-checked", "false");
  await at(p2, "link-four-on", "elder");
  const link2Id = new URL(p2.url()).pathname.split("/").pop()!;
  // her side: she opens Ripple and is in, with nothing to wait for
  const d2 = await her2.newPage();
  await d2.goto("/f");
  await d2.waitForURL(new RegExp(`/f\\?link=${link2Id}$`));
  await skipWelcome(d2);
  await d2.getByTestId("record-new").click();
  await expect(d2.getByTestId("recorder")).toBeVisible();
  await expect(d2.getByTestId("reminder-locked")).toHaveCount(0);

  // the list of changes says what the link started with
  await p2.getByTestId("link-seen").click();
  await expect(p2.getByTestId("page-family-seen")).toBeVisible();
  await expect(p2.getByTestId("grant-history")).toContainText(zh ? "第 1 版：填账号绑定时，开着这几项" : "Version 1: when the account was linked, these were on");
  await expect(p2.getByTestId("grant-history")).not.toContainText(zh ? "全部关着" : "all off");
  await at(p2, "seen-bound", "elder");

  // ================================================================= he removes someone he does not know
  const stranger = await phone(browser, baseURL, lang, scale);
  await account(stranger, "none", "Ah Beng", lang, "ahbeng");
  const sp = await stranger.newPage();
  await sp.goto("/f");
  await sp.getByTestId("bind-account").fill(his2Login);
  await sp.getByTestId("bind-submit").click();
  await sp.waitForURL(/\/f\?link=[0-9a-f-]{36}$/);
  const link3 = new URL(sp.url()).searchParams.get("link")!;
  await skipWelcome(sp);
  await expect(sp.getByTestId("family-app")).toHaveAttribute("data-live", "open");

  await p2.goto("/p/today?confirm=1");
  await expect(p2.getByTestId("today-family-bound")).toHaveAttribute("data-link", link3);
  await expect(p2.getByTestId("today-family-bound").locator(".rpu-tl-title")).toHaveText(zh ? "Ah Beng 绑定了你的账号" : "Ah Beng linked to your account");
  await at(p2, "today-bound-stranger", "elder");
  await p2.getByTestId("bound-remove").click();
  await expect(p2.getByTestId("today-family-bound")).toHaveCount(0);
  // her open page says he stopped, as it does for any link he ends
  await expect(sp.getByTestId("family-app")).toHaveAttribute("data-state", "ended", { timeout: 10_000 });
  await expect(sp.getByTestId("family-headline")).toHaveText(zh ? "林女士停止了分享。" : /stopped sharing/);
  // round two: what she can do now is ask him, or bind someone else
  await expect(sp.getByTestId("family-lede")).toHaveText(zh ? "你现在看不到他的记录了。想再看，请他在自己的手机上重新绑定你。" : "You can no longer see his records. To see them again, ask him to link you again on his own phone.");
  await expect(sp.getByTestId("ended-bind")).toHaveText(zh ? "绑定另一位长辈" : "Link another elder");
  await at(sp, "f-removed", "family");
  // and her page under 「家人」: someone who bound his account herself and whom he removed without ever answering.
  // One line says so, and nothing offers to invite that person; the family member he bound himself is untouched
  await p2.goto(`/p/family/${link3}`);
  await expect(link2).toHaveAttribute("data-state", "revoked");
  await expect(link2).toHaveAttribute("data-stranger", "true");
  await expect(p2.getByTestId("link-ended")).toContainText(zh ? "这个人自己绑定了你的账号，你已经解除。" : "This person linked to your account by themselves. You have removed them.");
  await expect(p2.getByTestId("invite-again")).toHaveCount(0);
  await at(p2, "link-removed", "elder");
  expect((await her2.request.get(`/api/family/view?link=${link2Id}`)).status()).toBe(200);
  expect((await stranger.request.get(`/api/family/view?link=${link3}`)).status()).toBe(403);

  // ================================================================= round two: her way back to the form
  // ---- 「绑定另一位长辈」 opens the form again; the elder who removed her is refused in words
  await sp.getByTestId("ended-bind").click();
  await sp.waitForURL(/\/f\?bind=1$/);
  await expect(sp.getByTestId("family-app")).toHaveAttribute("data-state", "bind_again");
  await expect(sp.getByTestId("bind-where")).toHaveText(zh ? "再绑定一位长辈" : "Link one more elder");
  await expect(sp.getByTestId("family-headline")).toHaveText(zh ? "填长辈的账号" : "Enter your elder's account");
  await expect(sp.getByTestId("family-back")).toBeVisible();
  await expect(sp.getByTestId("me-logout")).toHaveCount(0);
  await at(sp, "f-bind-again", "family");
  await sp.getByTestId("bind-account").fill(his2Login);
  await sp.getByTestId("bind-submit").click();
  await expect(sp.getByTestId("bind-error")).toHaveText(
    zh ? "他已经解除了和你的绑定。想再绑定，请他在自己的手机上填你的账号。" : "He has removed the link with you. To link again, ask him to enter your account on his own phone.",
  );
  await at(sp, "f-bind-removed", "family");
  // nothing was made: her one link to him is the one he ended, and his phone has no new card
  const hers = ((await (await stranger.request.get("/api/family/links")).json()) as { family: { id: string; state: string }[] }).family;
  expect(hers.map((l) => [l.id, l.state])).toEqual([[link3, "revoked"]]);
  await p2.goto("/p/today?confirm=1");
  await expect(p2.getByTestId("page-today")).toBeVisible();
  await expect(p2.getByTestId("today-family-bound")).toHaveCount(0);

  // ---- her page read again from the server says the same, with the same quiet button; 「我的」 has the row
  await sp.getByTestId("family-back").click();
  await sp.waitForURL(new RegExp(`/f\\?link=${link3}$`));
  await expect(sp.getByTestId("family-app")).toHaveAttribute("data-state", "ended");
  await expect(sp.getByTestId("ended-bind")).toBeVisible();
  await at(sp, "f-ended-plain", "family");
  await sp.getByTestId("open-me").click();
  await expect(sp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");
  await expect(sp.getByTestId("me-bind")).toContainText(zh ? "再绑定一位长辈" : "Link one more elder");
  await at(sp, "f-me-ended", "family");
  // the row opens the form; another elder's account binds her at once (and waits for his answer, like any such link)
  await sp.getByTestId("me-bind").click();
  await sp.waitForURL(/\/f\?bind=1$/);
  await sp.getByTestId("bind-account").fill(hisLogin);
  await sp.getByTestId("bind-submit").click();
  await sp.waitForURL(/\/f\?link=[0-9a-f-]{36}$/);
  const link4 = new URL(sp.url()).searchParams.get("link")!;
  expect(link4).not.toBe(link3);
  expect(((await (await stranger.request.get(`/api/family/view?link=${link4}`)).json()) as HomeView).reminder).toBeNull();
  // a family member in force has the same row under 「我的」
  await d2.goto(`/f/me?link=${link2Id}`);
  await expect(d2.getByTestId("family-me")).toHaveAttribute("data-state", "active");
  await expect(d2.getByTestId("me-bind")).toBeVisible();
  await d2.getByTestId("me-bind").scrollIntoViewIfNeeded();
  await at(d2, "f-me-bind", "family");

  // ---- the other sentence about what she sees: 「家人什么时候看过」 under 「我的数据」
  await pp.goto("/p/me/export/access");
  await expect(pp.getByTestId("page-access")).toContainText(zh ? "她只能看到开着的这几项。" : "She sees only what is switched on.");
  await at(pp, "access-lede", "elder");

  // ---- the invitation's own words (family_accept 2026-10-11): both ways a link is made
  const invited = (await (await him.request.post("/api/family/invites", { data: { family_label: "Mei", relation: "daughter", patient_label: zh ? "爸爸" : "Dad" } })).json()) as { path: string };
  const guest = await phone(browser, baseURL, lang, scale);
  const gp = await guest.newPage();
  await gp.goto(invited.path);
  await expect(gp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
  await gp.getByTestId("invite-consent").locator("summary").click();
  await expect(gp.getByTestId("invite-consent")).toContainText(zh ? "他发邀请请你来的，每一项一开始都是关着的" : "If he invited you, every item starts switched off");
  await expect(gp.getByTestId("invite-consent")).toContainText(zh ? "填账号绑定的，一开始开着四项" : "four items start switched on");
  await gp.getByTestId("invite-consent").scrollIntoViewIfNeeded();
  await at(gp, "invite-consent", "family");

  for (const c of [him, her, him2, her2, stranger, guest]) await c.close();
}
