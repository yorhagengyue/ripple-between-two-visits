/**
 * One walk through every state of his family screens (the timeline draft's 16-20 and the states it did not draw;
 * front-end line fe-fam), shared by the page checks (e2e/fe-fam-pages.spec.ts) and the screenshots
 * (e2e/fe-shots-fe-fam.spec.ts). Not a spec by itself.
 *
 * His account is Mr Tan's example data on the developer test clock (Mon 12 Oct 2026, evening); the family members are
 * test accounts made through POST /api/dev/accounts; invitations, her acceptance, her look and her leaving go through
 * the real routes. At each state the walk calls `at(page, id)`: the draft's screen id where the draft drew the state
 * ("16-1", "17-2", "18-1", "19-1", "20-1", "20-2"), a plain name where it did not ("list-none", "invited", "expired").
 *
 * The test clock is one per server: one walk at a time on a port.
 */
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type WalkLang = "zh-Hans" | "en";
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

async function account(context: BrowserContext, space: "example" | "none", name: string, locale: WalkLang): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `w${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: PASSWORD, space, display_name: name, locale } });
  expect(res.status(), await res.text()).toBe(201);
}

async function ok(context: BrowserContext, path: string, data: unknown = {}): Promise<Record<string, unknown>> {
  const res = await context.request.post(path, { data });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** His invitation through the route itself: the link's id and the one-time token. */
async function invite(him: BrowserContext, label: string, relation: string): Promise<{ id: string; token: string }> {
  const made = await ok(him, "/api/family/invites", { family_label: label, relation, patient_label: "爸爸" });
  return { id: (made.link as { id: string }).id, token: String(made.path).replace(/^\/invite\//, "") };
}

export interface WalkOptions {
  lang?: WalkLang;
  /** 2 for pictures, 1 for checks */
  scale?: number;
  /** called at every state, with the page on it */
  at: (page: Page, id: string) => Promise<void>;
}

export async function walkHisFamily(browser: Browser, request: APIRequestContext, baseURL: string, opts: WalkOptions): Promise<void> {
  const lang = opts.lang ?? "zh-Hans";
  const zh = lang === "zh-Hans";
  const at = opts.at;
  const DAY = "2026-10-12";
  await setClock(request, SGT(DAY, "19:30"));
  const him = await phone(browser, baseURL, lang, opts.scale ?? 1);
  await account(him, "example", "陈先生", lang);
  // the example's one-time intro was put away earlier
  await him.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await him.newPage();
  const her = async (name: string): Promise<BrowserContext> => {
    const c = await phone(browser, baseURL, "zh-Hans", 1);
    await account(c, "none", name, "zh-Hans");
    return c;
  };
  const family = page.getByTestId("page-family");
  const linkPage = page.getByTestId("page-family-link");

  // ---- nobody yet
  await page.goto("/p/family");
  await expect(family).toHaveAttribute("data-state", "none");
  await at(page, "list-none");

  // ---- 17-1: the invitation, with the three things the back end asks; a name is needed
  await page.getByTestId("family-invite").click();
  await expect(page.getByTestId("invite-form")).toBeVisible();
  await at(page, "17-1");
  await page.getByTestId("invite-make").click();
  await expect(page.getByTestId("invite-form").getByRole("alert")).toHaveText(zh ? "先写上她叫什么。" : "Write her name first.");
  await at(page, "17-1-name-missing");
  await page.getByTestId("invite-name").fill("Wei Ling");
  await expect(page.getByTestId("invite-form").getByRole("alert")).toHaveCount(0);

  // ---- 17-2: the link, 「发给她」, 「复制」, the code, and where it stands
  await page.getByTestId("invite-make").click();
  const made = page.getByTestId("invite-made");
  await expect(made).toHaveAttribute("data-state", "invited");
  await expect(page.getByTestId("invite-steps")).toHaveAttribute("data-state", "invited");
  await expect(page.getByTestId("invite-steps")).toContainText(zh ? "10月19日 以前有效" : "Works until 19 Oct");
  await at(page, "17-2");
  const token = new URL((await made.getAttribute("data-url"))!).pathname.replace(/^\/invite\//, "");
  const linkId = (await made.getAttribute("data-link"))!;

  // she accepts on her own phone: his open screen follows; the link is used up, so only the steps stay
  const weiLing = await her("Wei Ling");
  await ok(weiLing, "/api/family/invites/accept", { token });
  await expect(made).toHaveAttribute("data-state", "accepted", { timeout: 15_000 });
  await expect(page.getByTestId("invite-steps")).toHaveAttribute("data-state", "accepted");
  await expect(page.getByTestId("invite-whatsapp")).toHaveCount(0);
  await expect(page.getByTestId("invite-qr")).toHaveCount(0);
  await at(page, "17-2-accepted");

  // ---- 18-1: 「是她吗？」 on 「家人」 and on Today
  await page.getByTestId("invite-to-confirm").click();
  await expect(family).toHaveAttribute("data-state", "confirm");
  await expect(family).toHaveAttribute("data-link", linkId);
  await at(page, "18-1");
  await page.goto("/p/today?confirm=1");
  await expect(page.getByTestId("today-family-confirm")).toHaveAttribute("data-link", linkId);
  await at(page, "18-1-today");
  // her own page of the link leads to the question as well
  await page.goto(`/p/family/${linkId}`);
  await expect(family).toHaveAttribute("data-state", "confirm");

  // ---- 16-1: her switches, all off after 「是她」
  await page.getByTestId("confirm-yes").click();
  await expect(linkPage).toHaveAttribute("data-state", "active");
  const switches = page.getByTestId("link-switches").locator('[role="switch"]');
  await expect(switches).toHaveCount(6);
  await expect(page.getByTestId("last-look")).toHaveText(zh ? "她还没有看过。" : "She has not looked yet.");
  await at(page, "16-1-all-off");

  // a change that does not reach the server says so and goes back
  await page.route("**/api/family/links/*/grants", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.locator('[data-grant="dose_summary"] [role="switch"]').click();
  await expect(page.getByTestId("link-switches").getByRole("alert")).toHaveText(zh ? "没改成，再试一次。" : "That did not change. Try again.");
  await expect(page.locator('[data-grant="dose_summary"] [role="switch"]')).toHaveAttribute("aria-checked", "false");
  await at(page, "16-1-failed");
  await page.unroute("**/api/family/links/*/grants");

  // the draft's 16-1: four on, the last two off; her phone has no notifications yet, and she looked once
  await page.locator('[data-grant="dose_summary"] [role="switch"]').click();
  await expect(page.locator('[data-grant="dose_summary"] [role="switch"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("link-switches").getByRole("alert")).toHaveCount(0);
  await setClock(request, SGT(DAY, "19:32"));
  await ok(him, `/api/family/links/${linkId}/grants`, { items: { bp_summary: true, questions_count: true, no_reply_alert: true, notes: true } });
  await setClock(request, SGT(DAY, "19:34"));
  await ok(him, `/api/family/links/${linkId}/grants`, { items: { notes: false } });
  await setClock(request, SGT(DAY, "19:40"));
  expect((await weiLing.request.get(`/api/family/view?link=${linkId}`)).status()).toBe(200);
  await page.reload();
  await expect(page.locator('[data-grant="no_reply_alert"] [role="switch"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("her-push-off")).toBeVisible();
  await expect(page.getByTestId("last-look")).toHaveText(zh ? "Wei Ling 最近一次看：今天 19:40" : "Wei Ling last looked today 19:40");
  await at(page, "16-1");

  // ---- 19-1: when she looked, and the changes of the switches
  await page.getByTestId("link-seen").click();
  await expect(page.getByTestId("page-family-seen")).toHaveAttribute("data-state", "list");
  await expect(page.getByTestId("access-log")).toContainText(zh ? "看了你的吃药情况" : "Looked at your medicine check-ins");
  await expect(page.getByTestId("grant-history")).toContainText(zh ? "打开了「每天吃药了没有」" : "switched on “Whether I took my medicine each day”");
  await expect(page.getByTestId("grant-history")).toContainText(zh ? "第 1 版：邀请时，全部关着" : "Version 1: at the invitation, all off");
  await at(page, "19-1");
  await page.locator('[data-rp="back"]').click();
  await expect(linkPage).toHaveAttribute("data-state", "active");

  // ---- 20-1 and 20-2: the stop screen, then her page says it has stopped
  await page.getByTestId("link-stop").click();
  await expect(page.getByTestId("page-family-stop")).toBeVisible();
  await expect(page.getByTestId("stop-sharing")).toBeVisible();
  await at(page, "20-1");
  await page.getByTestId("stop-sharing").click();
  await expect(linkPage).toHaveAttribute("data-state", "revoked");
  await expect(page.getByTestId("invite-again")).toBeVisible();
  await expect(page.locator('[data-rp="toast"]')).toHaveCount(0);
  await at(page, "20-2");
  // the two screens of a link that is no longer in force lead back to her page
  for (const sub of ["seen", "stop"]) {
    await page.goto(`/p/family/${linkId}/${sub}`);
    await expect(linkPage).toHaveAttribute("data-state", "revoked");
  }
  await page.goto("/p/family");
  await expect(family).toHaveAttribute("data-state", "none");
  await expect(page.getByTestId("family-ended")).toContainText(zh ? "已停止分享" : "Sharing stopped");
  await at(page, "list-ended");

  // ---- an invitation waiting; one he takes back
  const son = await invite(him, "Kok Leong", "son");
  await page.goto(`/p/family/${son.id}`);
  await expect(linkPage).toHaveAttribute("data-state", "invited");
  await expect(page.getByTestId("invite-steps")).toHaveAttribute("data-state", "invited");
  await at(page, "invited");
  await page.getByTestId("cancel-invite").click();
  await expect(family).toBeVisible();
  await page.goto(`/p/family/${son.id}`);
  await expect(linkPage).toHaveAttribute("data-cancelled", "true");
  await at(page, "cancelled");

  // ---- she leaves; he says it is not her; an invitation runs out
  const second = await invite(him, "Wei Ling", "daughter");
  await ok(weiLing, "/api/family/invites/accept", { token: second.token });
  await ok(him, `/api/family/links/${second.id}/confirm`, { yes: true });
  await ok(weiLing, `/api/family/links/${second.id}/leave`);
  await page.goto(`/p/family/${second.id}`);
  await expect(linkPage).toHaveAttribute("data-state", "left");
  await at(page, "left");

  const stranger = await her("Someone");
  const wrong = await invite(him, "Mei", "other");
  await ok(stranger, "/api/family/invites/accept", { token: wrong.token });
  await page.goto("/p/family");
  await expect(family).toHaveAttribute("data-state", "confirm");
  await page.getByTestId("confirm-no").click();
  await expect(family).not.toHaveAttribute("data-state", "confirm");
  await page.goto(`/p/family/${wrong.id}`);
  await expect(linkPage).toHaveAttribute("data-state", "declined");
  await at(page, "declined");

  const late = await invite(him, "Siew Lan", "wife");
  // (an afternoon: no reminder of his is due, so the screen is his family page alone)
  await setClock(request, SGT("2026-10-20", "14:00"));
  await page.goto(`/p/family/${late.id}`);
  await expect(linkPage).toHaveAttribute("data-state", "expired");
  await at(page, "expired");
  await setClock(request, SGT(DAY, "19:50"));

  // ---- the list: someone confirmed, someone invited, the ones that ended
  const third = await invite(him, "Wei Ling", "daughter");
  await ok(weiLing, "/api/family/invites/accept", { token: third.token });
  await ok(him, `/api/family/links/${third.id}/confirm`, { yes: true });
  await page.goto("/p/family");
  await expect(family).toHaveAttribute("data-state", "list");
  await expect(page.getByTestId("family-list").locator('[data-state="active"]')).toHaveCount(1);
  await expect(page.getByTestId("family-list").locator('[data-state="invited"]')).toHaveCount(1);
  await at(page, "list");

  // ---- he confirms her on another phone while the screen of the link he made is still open: it follows
  await page.goto("/p/family/invite");
  await page.getByTestId("invite-name").fill("Hui Min");
  await page.getByTestId("invite-make").click();
  await expect(made).toHaveAttribute("data-state", "invited");
  const huiMin = await her("Hui Min");
  const fourth = { id: (await made.getAttribute("data-link"))!, token: new URL((await made.getAttribute("data-url"))!).pathname.replace(/^\/invite\//, "") };
  await ok(huiMin, "/api/family/invites/accept", { token: fourth.token });
  await ok(him, `/api/family/links/${fourth.id}/confirm`, { yes: true });
  await expect(made).toHaveAttribute("data-state", "active", { timeout: 15_000 });
  await expect(page.getByTestId("invite-steps")).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("invite-to-switches")).toHaveAttribute("href", `/p/family/${fourth.id}`);
  await at(page, "17-2-confirmed");

  // ---- five invitations waiting: no sixth
  for (const n of ["Ah Hock", "Bee Lian", "Chee Keong", "Dolly"]) await invite(him, n, "other");
  await page.goto("/p/family/invite");
  await expect(page.getByTestId("invite-full")).toBeVisible();
  await expect(page.getByTestId("invite-form")).toHaveCount(0);
  await at(page, "invite-full");

  await him.close();
  await weiLing.close();
  await stranger.close();
  await huiMin.close();
}
