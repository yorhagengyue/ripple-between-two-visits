/**
 * Design group 04 「随时说一句」 after the timeline draft (web/progress/fe-04.md): the page checks (e2e/_checks/page-checks.ts:
 * no sideways scroll at 360px, no text under 18px, no target under 48x48, no contrast violation) on every state of the
 * day's record that e2e/k-pages.spec.ts does not reach, and what the new layout does on a tap:
 *
 *   nothing yet        the one grey entry and the field (a new account; an earlier day with nothing kept)
 *   04-2 to 04-4       the check-in question with its way to Today; the doctor's line in its card, 「加进问题单」, then
 *                      the tick as an entry of its own with 「看问题单」; 「记下来」 then Ripple's 「记下了。」; 「不用」
 *                      puts the two buttons away and keeps nothing
 *   one line           every turn is its own box (chat-turn) and the day's rule runs through all of them
 *   questions          answers to questions on the same line (the doctor's words with 「听原声」, the label, the leaflet,
 *                      995, the helplines): placed with the foundation's pieces, each call one tap
 *   no network         the grey box 「现在没有网络。」 「要连上网才能问。」, the field waits; a request that never reaches
 *                      the server says the same sentence, keeps his words in the field and adds nothing
 *   no consent to AI   the design's one sentence as the answer's last entry, never twice in one answer
 *   Today              the entry 「今天说过的话」 (components/today/ChatSection)
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): `next dev`, or a
 * production build started with scripts/record/serve.mjs. PW_PORT names it. Each test signs a fresh browser in to a new
 * account and opens nothing else first, so it does not depend on what ran before on the same server.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";
const ANKLE = "今天在大巴窑中心走了一圈，脚踝有点肿。";

async function account(page: Page, space: "example" | "blank") {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `c${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, space } });
  expect(r.status(), await r.text()).toBe(201);
}

async function say(page: Page, text: string, locale: "zh-Hans" | "en" = "zh-Hans") {
  expect((await page.request.post("/api/ask", { data: { text, locale } })).status()).toBe(200);
}

async function open(page: Page, path = "/p/chat") {
  await page.goto(path);
  await expect(page.getByTestId("chat-screen")).toBeVisible();
}

const checks = (page: Page) => expectPageChecks(page, { side: "elder" });

for (const locale of ["zh-Hans", "en"] as const) {
  const zh = locale === "zh-Hans";
  test.describe(`design group 04 (${locale})`, () => {
    test.beforeEach(async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    });

    test(`the day's record: nothing yet, then the draft's three screens and what a tap changes (${locale})`, async ({ page }) => {
      await account(page, "example");
      const screen = page.getByTestId("chat-screen");
      const turns = page.getByTestId("chat-turn");

      // nothing said yet: the header (the way back to Today, the date, what the screen holds), one grey entry, the field
      await open(page);
      await expect(screen).toHaveAttribute("data-turns", "0");
      await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/today");
      await expect(page.locator('[data-rp="back"]')).toHaveText(zh ? "今天" : "Today");
      await expect(page.locator('[data-rp="meta-story"]')).toHaveText(zh ? "今天说过的话" : "What you said today");
      await expect(page.getByTestId("chat-empty")).toContainText(zh ? "想说什么，随时说一句。" : "Say anything, any time.");
      await expect(page.locator('[data-kind="lang"]')).toHaveCount(0);
      await expect(page.getByTestId("chat-field")).toBeVisible();
      await checks(page);

      // 04-2, 04-3a, 04-4 on one day: three turns, each its own box, one rule through the day
      for (const text of ["我今天好累。", ANKLE, "今天会下雨吗？"]) await say(page, text, locale);
      await open(page);
      await expect(turns).toHaveCount(3);
      await expect(page.getByTestId("chat-empty")).toHaveCount(0);
      const [t1, t2, t3] = [turns.nth(0), turns.nth(1), turns.nth(2)];
      // his words on his own node, plain; Ripple's fixed sentence on Ripple's node, in its bubble
      await expect(t1.locator('[data-rp="tl-item"]').first()).toHaveAttribute("data-node", "me");
      await expect(t1.getByTestId("chat-his")).toHaveText("我今天好累。");
      await expect(t1.getByTestId("chat-answer")).toHaveAttribute("data-node", "rip");
      await expect(t1.getByTestId("chat-answer").locator('[data-rp="bubble"][data-node="rip"]')).toHaveText(zh ? "记下了。" : "Noted.");
      // one rule for the day: every turn but the last runs on, and a later turn takes the rule in from its top
      expect(await turns.evaluateAll((els) => els.map((el) => el.querySelector(":scope > [data-rp='timeline']")?.getAttribute("data-open") ?? null))).toEqual(["true", "true", null]);
      const railTop = (turn: typeof t1) => turn.locator('[data-rp="tl-item"]').first().locator(".rpu-tl-rail").evaluate((el) => getComputedStyle(el, "::before").top);
      expect(await railTop(t1)).not.toBe("0px");
      expect(await railTop(t2)).toBe("0px");
      expect(await railTop(t3)).toBe("0px");
      // 04-2: the check-in question, and under it the way to Today (no dose is logged here)
      await expect(t1.getByTestId("chat-checkin").getByRole("link")).toHaveAttribute("href", "/p/today");
      // 04-3a: the doctor's own line in a card on the doctor's node, the words in the serif face
      const related = t2.getByTestId("chat-related");
      await expect(related).toHaveAttribute("data-node", "doc");
      await expect(related.locator(".rpu-tl-body")).toHaveAttribute("data-frame", "card");
      await expect(related.locator('[data-rp="source-tag"]')).toContainText(zh ? "医生说" : "Doctor said");
      expect(await related.locator('[data-rp="said"]').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/serif/i);
      await expect(related.getByTestId("chat-related-translation")).toHaveCount(zh ? 1 : 0);
      await expect(t2.getByTestId("chat-related-added")).toHaveCount(0);
      // 04-4: 「记下来」 and 「不用」 under the can't-help sentence
      await expect(t3.getByTestId("chat-write")).toHaveAttribute("data-noted", "false");
      await expect(t3.getByTestId("chat-write-down")).toBeVisible();
      await expect(t3.getByTestId("chat-write-skip")).toBeVisible();
      await checks(page);

      // 04-3b: he taps 「加进问题单」: the button goes, the tick is an entry of its own with the way to the list
      await related.getByTestId("chat-related-add").click();
      const added = t2.getByTestId("chat-related-added");
      await expect(added).toHaveAttribute("data-node", "ok");
      await expect(added).toContainText(zh ? "已在下次看诊的问题单里" : "In the questions for your next visit");
      await expect(added.getByRole("link")).toHaveAttribute("href", "/p/questions");
      await expect(related.getByTestId("chat-related-add")).toHaveCount(0);
      // 「不用」: the two buttons are put away, nothing is kept
      await t3.getByTestId("chat-write-skip").click();
      await expect(t3.getByTestId("chat-write-down")).toHaveCount(0);
      await expect(t3.getByTestId("chat-noted")).toHaveCount(0);
      const notesAfterSkip = ((await (await page.request.get("/api/notes")).json()) as { notes: { text: string }[] }).notes;
      expect(notesAfterSkip.some((n) => n.text === "今天会下雨吗？")).toBe(false);
      await checks(page);

      // the offer is still his after a reload; 「记下来」: Ripple says 「记下了。」 on its own node
      await open(page);
      await turns.nth(2).getByTestId("chat-write-down").click();
      await expect(turns.nth(2).getByTestId("chat-noted")).toHaveText(zh ? "记下了。" : "Noted.");
      await expect(turns.nth(2).getByTestId("chat-write")).toHaveAttribute("data-noted", "true");
      await expect(turns.nth(2).getByTestId("chat-write-down")).toHaveCount(0);
      await checks(page);

      // a day of the past with nothing kept: the header goes back to today's, one dashed entry, no field
      const { date } = (await (await page.request.get("/api/chat")).json()) as { date: string };
      const earlier = new Date(Date.parse(`${date}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
      await open(page, `/p/chat?date=${earlier}`);
      await expect(screen).toHaveAttribute("data-today", "false");
      await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/chat");
      await expect(page.locator('[data-rp="meta-story"]')).toHaveText(zh ? "这一天说过的话" : "What you said that day");
      await expect(page.getByTestId("chat-empty")).toHaveAttribute("data-node", "miss");
      await expect(page.getByTestId("chat-input")).toHaveCount(0);
      // today is among the other days, a row of the card
      await expect(page.getByTestId("chat-day").first()).toHaveAttribute("data-date", date);
      await checks(page);
    });

    test(`answers to questions on the day's line (${locale})`, async ({ page }) => {
      await account(page, "example");
      for (const text of ["今天 150/95，我能不能多吃一粒？", "这个药是做什么的？", "我胸口好痛，左手没力", "有时候真的不想活了"]) await say(page, text, locale);
      await open(page);
      const turns = page.getByTestId("chat-turn");
      await expect(turns).toHaveCount(4);
      // every part is an entry of the line with the node of its source
      const nodes = (i: number) => turns.nth(i).locator('[data-rp="tl-item"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-node")));
      expect(await nodes(0)).toEqual(expect.arrayContaining(["me", "doc", "lab", "rip", "ok"]));
      expect(await nodes(2)).toEqual(expect.arrayContaining(["me", "sos"]));
      expect(new Set(await nodes(3))).toEqual(new Set(["me", "rip"]));
      // 995 is the foundation's card, one tap; each helpline is Ripple's sentence in its bubble with its own numbers
      await expect(turns.nth(2).locator('[data-rp="emergency-call"]')).toHaveAttribute("href", "tel:995");
      const lines = turns.nth(3).locator('[data-testid="chat-part"][data-kind="hotlines"]');
      expect(await lines.count()).toBeGreaterThanOrEqual(3);
      await expect(lines.first().locator('[data-rp="bubble"]')).toBeVisible();
      await expect(lines.first().locator('[data-rp="call"]')).toHaveAttribute("href", "tel:995");
      // where his question went: the tick and the way to the list
      await expect(turns.nth(0).getByTestId("chat-added").getByRole("link")).toHaveAttribute("href", "/p/questions");
      await checks(page);

      // 「听原声」 on the doctor's line: a tap plays it (the pill fills and says so), a tap while it plays stops it
      const clip = turns.nth(0).getByTestId("chat-clip").first();
      const pill = clip.locator('[data-rp="play-pill"]');
      await expect(pill).toHaveAttribute("aria-pressed", "false");
      await pill.click();
      // (a development server compiles the clip's route on its first request)
      await expect(clip).toHaveAttribute("data-playing", "true", { timeout: 30_000 });
      await expect(pill).toHaveAttribute("aria-pressed", "true");
      await pill.click();
      await expect(clip).toHaveAttribute("data-playing", "false");
    });
  });
}

test("without a network: the grey box and a waiting field; a request that never arrives keeps his words and adds nothing", async ({ page, context }) => {
  await account(page, "example");
  await say(page, "我今天好累。");
  await open(page);
  const field = page.getByTestId("chat-field");
  const send = page.getByTestId("chat-input").getByRole("button", { name: "问这句" });
  await expect(page.getByTestId("chat-offline")).toHaveCount(0);

  // the browser says there is no network
  await context.setOffline(true);
  await expect(page.getByTestId("chat-offline")).toContainText("现在没有网络。");
  await expect(page.getByTestId("chat-offline")).toContainText("要连上网才能问。");
  await expect(field).toBeDisabled();
  await expect(send).toBeDisabled();
  await checks(page);
  await context.setOffline(false);
  await expect(page.getByTestId("chat-offline")).toHaveCount(0);
  await expect(field).toBeEnabled();

  // the browser says there is one, but the request never reaches the server: the same sentence, nothing queued
  await page.route("**/api/ask", (route) => route.abort());
  await field.fill("今天在大巴窑中心走了一圈。");
  await send.click();
  await expect(page.getByTestId("chat-input").getByTestId("chat-error")).toHaveText("要连上网才能问。");
  await expect(field).toHaveValue("今天在大巴窑中心走了一圈。");
  await page.unroute("**/api/ask");
  await open(page);
  await expect(page.getByTestId("chat-turn")).toHaveCount(1);
});

test("without his consent to AI processing: an answer says the design's one sentence last and once (real-app 2.10)", async ({ page, baseURL }) => {
  const SENTENCE = "你没有同意用 AI，这里只能帮你记下来、转给医生。";
  await account(page, "example");
  const off = await page.request.post("/api/me/consent", { data: { kind: "ai_processing", on: false }, headers: { origin: new URL(baseURL!).origin } });
  expect(off.status(), await off.text()).toBe(200);
  await say(page, "今天 150/95，我能不能多吃一粒？");
  await say(page, "我可以去游泳吗？");
  await open(page);
  const turns = page.getByTestId("chat-turn");
  await expect(turns).toHaveCount(2);
  // the rules still relay his doctor's words; the sentence is the answer's last entry, a plain point with the grey line
  await expect(turns.nth(0).locator('[data-testid="chat-part"][data-kind="quote"]').first()).toBeVisible();
  const line = turns.nth(0).getByTestId("chat-no-ai");
  await expect(line).toHaveAttribute("data-node", "dot");
  await expect(line).toHaveText(SENTENCE);
  expect(await turns.nth(0).locator('[data-rp="tl-item"]').last().getAttribute("data-testid")).toBe("chat-no-ai");
  // nothing for the rules to relay: the fixed template says the sentence itself, in Ripple's bubble, and no second time
  await expect(turns.nth(1).getByTestId("chat-answer").locator('[data-rp="bubble"]')).toHaveText(`${SENTENCE}我已经把它加进问题单。`);
  await expect(turns.nth(1).getByTestId("chat-no-ai")).toHaveCount(0);
  await checks(page);
});

test("Today's entry 「今天说过的话」: his last words, Ripple's first line, the way to the day's record", async ({ page }) => {
  await account(page, "example");
  await page.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  await say(page, "我今天好累。");
  await page.goto("/p/today");
  const cell = page.getByTestId("today-chat");
  // (the entry is on the day's overview; a medicine slot that needs him right now has the screen to itself)
  test.skip((await cell.count()) === 0, "a medicine slot has the screen at this hour of the server's clock");
  await expect(cell).toHaveAttribute("data-node", "me");
  await expect(cell).toHaveAttribute("data-count", "1");
  await expect(cell.getByTestId("today-chat-last")).toContainText("我今天好累。");
  await expect(cell.getByTestId("today-chat-last")).toContainText("记下了。");
  await expect(cell.getByRole("link", { name: /看今天说过的话/ })).toHaveAttribute("href", "/p/chat");
  await expectPageChecks(page, { side: "elder", scope: '[data-testid="today-chat"]' });
});
