/**
 * Screenshots for the owner of design group 04 「随时说一句」 rebuilt after the timeline draft (web/progress/fe-04.md): one
 * PNG per screen state at 390x844 @2x in 华语, named by the draft's screen id, in FE_SHOTS_DIR/04/. Not a test of looks,
 * and never part of a default run: without FE_SHOTS_DIR every test here is skipped, so nothing is written anywhere.
 * (The approach of e2e/fe-shots.spec.ts, which belongs to the Today line.)
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe PW_PORT=3820 npx playwright test e2e/fe-shots-fe-04.spec.ts
 *
 * One account with the example data on the developer test clock (laid out on Mon 12 Oct 2026). Each of the draft's
 * screens is a day of its own, so its picture is that day's record from the top, as the draft draws it; the states the
 * draft did not draw follow (04-0-*, 04-en, 04-offline, 04-past-day, 04-x-*). Every sentence goes through POST
 * /api/ask, as the screen itself sends it. A screen longer than the phone is also saved whole as <id>-full.png.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function phone(browser: Browser, locale: "zh-CN" | "en-SG" = "zh-CN"): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale, timezoneId: "Asia/Singapore" });
}

async function account(context: BrowserContext, space: "example" | "blank" = "example", extra: Record<string, unknown> = {}): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `s${randomUUID().slice(0, 12)}`, password: "a long test password", space, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
}

async function say(context: BrowserContext, text: string, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<void> {
  const res = await context.request.post("/api/ask", { data: { text, locale } });
  expect(res.status(), await res.text()).toBe(200);
}

/** One PNG of the phone's screen; a page longer than the phone is saved whole as well. */
async function shot(page: Page, id: string): Promise<void> {
  const out = path.join(DIR!, "04");
  mkdirSync(out, { recursive: true });
  // the Next dev badge sits on the tab bar
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${id}.png`) });
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8);
  if (tall) {
    // the whole page without what is fixed at the bottom (those bars are on the phone-sized picture)
    const hide = await page.addStyleTag({ content: ".rpu-tabs, .rpu-say, .rpu-typedock, .rpu-toast[data-placement='fixed'] { display: none !important; }" });
    await page.screenshot({ path: path.join(out, `${id}-full.png`), fullPage: true });
    await hide.evaluate((el) => (el as Element).remove());
  }
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("04 随时说一句", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "08:00"));
  const context = await phone(browser);
  await account(context);
  // the example's one-time intro was put away earlier
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  const page = await context.newPage();
  const screen = page.getByTestId("chat-screen");
  const turns = page.getByTestId("chat-turn");
  const open = async (query = "") => {
    await page.goto(`/p/chat${query}`);
    await expect(screen).toBeVisible();
  };

  // Mon 12 Oct. Nothing said yet today
  await open();
  await expect(screen).toHaveAttribute("data-turns", "0");
  await shot(page, "04-0-empty");

  // 04-2: 「我今天好累。」, 「记下了。」, and today's medicine not logged yet: 「今天的药吃了吗？」
  await say(context, "我今天好累。");
  await open();
  await expect(turns).toHaveCount(1);
  await shot(page, "04-2");

  // Today's entry 「今天说过的话」
  await page.goto("/p/today");
  await expect(page.getByTestId("today-chat")).toBeVisible();
  await page.getByTestId("today-chat").scrollIntoViewIfNeeded();
  await shot(page, "04-today-cell");

  // Tue 13 Oct. Today is empty again, Monday is under the earlier days
  await setClock(request, SGT("2026-10-13", "08:20"));
  await open();
  await expect(page.getByTestId("chat-day").first()).toBeVisible();
  await shot(page, "04-0-earlier-days");

  // 04-3a: the ankle note, the doctor's own line under it, 「加进问题单」
  await say(context, "今天在大巴窑中心走了一圈，脚踝有点肿。");
  await open();
  await expect(turns).toHaveCount(1);
  await expect(page.getByTestId("chat-related")).toBeVisible();
  await shot(page, "04-3a");

  // 04-3b: he tapped 「加进问题单」
  await page.getByTestId("chat-related-add").click();
  await expect(page.getByTestId("chat-related-added")).toBeVisible();
  await page.getByTestId("chat-related-added").scrollIntoViewIfNeeded();
  await shot(page, "04-3b");

  // Wed 14 Oct. 04-4: something Ripple cannot help with, and the offer to note it
  await setClock(request, SGT("2026-10-14", "08:40"));
  await say(context, "明天会下雨吗？");
  await open();
  await expect(turns).toHaveCount(1);
  await expect(page.getByTestId("chat-write-down")).toBeVisible();
  await shot(page, "04-4");
  // 「记下来」: Ripple says 「记下了。」
  await page.getByTestId("chat-write-down").click();
  await expect(page.getByTestId("chat-noted")).toBeVisible();
  await shot(page, "04-4-noted");
  // 「不用」 on a second one: the two buttons are put away
  await say(context, "今天会下雨吗？");
  await open();
  await expect(turns).toHaveCount(2);
  await turns.nth(1).getByTestId("chat-write-skip").click();
  await expect(turns.nth(1).getByTestId("chat-write-down")).toHaveCount(0);
  await turns.nth(1).scrollIntoViewIfNeeded();
  await shot(page, "04-4-declined");

  // the same day in English
  await open("?lang=en");
  await shot(page, "04-en");

  // no network: the grey box says so, the field waits
  await open();
  await context.setOffline(true);
  await expect(page.getByTestId("chat-offline")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "04-offline");
  await context.setOffline(false);

  // an earlier day, read only
  await open("?date=2026-10-13");
  await expect(screen).toHaveAttribute("data-today", "false");
  await shot(page, "04-past-day");

  // Thu 15 Oct. Answers to questions on the same line (groups 07, 09 and 10 own their look; here they are placed on
  // the day's line): the hero question, what the medicine is for, chest pain, and words near self-harm
  await setClock(request, SGT("2026-10-15", "08:30"));
  for (const text of ["今天 150/95，我能不能多吃一粒？", "这个药是做什么的？", "我胸口好痛，左手没力", "有时候真的不想活了"]) await say(context, text);
  await open();
  await expect(turns).toHaveCount(4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "04-x-answers");

  // Fri 16 Oct. He has taken back his consent to AI processing: an answer says so, last and once
  await setClock(request, SGT("2026-10-16", "08:30"));
  const off = await context.request.post("/api/me/consent", { data: { kind: "ai_processing", on: false }, headers: { origin: new URL(page.url()).origin } });
  expect(off.status(), await off.text()).toBe(200);
  for (const text of ["今天 150/95，我能不能多吃一粒？", "我可以去游泳吗？"]) await say(context, text);
  await open();
  await expect(turns).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "04-x-no-ai");
  await context.close();
});

test("04 随时说一句 · 评委沙盒（旧的手机框）", async ({ browser }) => {
  // a judge's sandbox keeps the demo's own frame (app/p/layout.tsx); the day's record inside it is the same screen
  const context = await phone(browser);
  const page = await context.newPage();
  // the judge's page makes the sandbox itself (POST /api/session) once it is open
  const made = page.waitForResponse((r) => r.url().endsWith("/api/session") && r.request().method() === "POST");
  await page.goto("/demo");
  expect((await made).status()).toBe(201);
  await page.goto("/p/chat");
  await expect(page.getByTestId("chat-screen")).toBeVisible();
  await say(context, "我今天好累。");
  await page.goto("/p/chat");
  await expect(page.getByTestId("chat-turn")).toHaveCount(1);
  await shot(page, "04-0-demo");
  await context.close();
});

test("04 随时说一句 · 没有记录的账号", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "08:00"));
  const context = await phone(browser);
  await account(context, "blank");
  const page = await context.newPage();
  await page.goto("/p/chat");
  await expect(page.getByTestId("chat-screen")).toHaveAttribute("data-turns", "0");
  await shot(page, "04-0-empty-blank");
  // a day of the past with nothing kept
  await page.goto("/p/chat?date=2026-10-10");
  await expect(page.getByTestId("chat-screen")).toHaveAttribute("data-today", "false");
  await shot(page, "04-0-past-empty");
  await context.close();
});
