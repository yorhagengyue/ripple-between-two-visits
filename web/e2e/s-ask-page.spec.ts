/**
 * The 问一句 screen (/p/ask, C2 track S) passes the page checks (e2e/_checks/page-checks.ts) in each state an account sees:
 * the start (an example account: 「可以这样问」, a tap only fills the field), without a network, the hero answer (the
 * doctor's words with the clip, the label, the referral, "already on the list"), the red 995 block with the doctor's
 * warning line, the helplines (no tab bar under either), chit-chat with 「记下来」 and then 「记下了。」, and today's
 * earlier questions opened; text follows the phone's text size and pinch zoom is never blocked. Then: no consent to AI
 * processing, and a sign-in that ended while he was asking (his sentence waits on the phone for the trip to the login
 * page). Needs the developer tools (next dev, or RIPPLE_DEV_TOOLS=1) for the account.
 */
import { expect, test, type Page } from "@playwright/test";
import { checkTextScaling, checkZoomAllowed, expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

async function ask(page: Page, text: string) {
  await page.getByTestId("ask-input").fill(text);
  const answered = page.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await page.getByTestId("ask-field").getByRole("button", { name: "问这句" }).click();
  expect((await answered).status()).toBe(200);
  await expect(page.locator('[data-testid="ask-turn"][data-latest="true"]').getByRole("heading", { level: 1 })).toHaveText(text, { timeout: 8000 });
}

test("问一句: every state of /p/ask passes the page checks (360 px, 18 px text, 48 px targets, AA contrast)", async ({ page }) => {
  test.setTimeout(120_000);
  const made = await page.request.post("/api/dev/accounts", { data: { login: `pc${Date.now().toString(36)}`, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);

  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  // the e2e server runs the mock speech provider: no transcription service, so no microphone at all (real-app 2.10)
  await expect(page.getByTestId("ask-mic")).toHaveCount(0);
  // the header: the way back, 「问一句」 and the date; the question he asks will be the screen's heading, so the title is not
  await expect(page.locator('[data-rp="meta"] [data-rp="page-title"]')).toHaveText("问一句");
  await expect(page.locator('[data-rp="meta"]').getByRole("heading")).toHaveCount(0);
  // an example account's start (the timeline draft's 22-2): 「可以这样问」, marked 示例, the example's three sentences; a tap
  // only puts the words into the field (real-app 4.7)
  const start = page.getByTestId("ask-start");
  await expect(start.getByRole("heading", { level: 1 })).toContainText("可以这样问");
  await expect(start.getByRole("heading", { level: 1 })).toContainText("示例");
  const examples = start.locator('[data-action="example-ask"]');
  await expect(examples).toHaveText(["今天 150/95，我能不能多吃一粒？", "我今天好累", "胸口痛"]);
  await expectPageChecks(page, { side: "elder" });
  await checkZoomAllowed(page);
  await examples.nth(1).click();
  await expect(page.getByTestId("ask-input")).toHaveValue("我今天好累");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-turns", "0");
  await page.getByTestId("ask-input").fill("");

  // without a network (通用-3): a grey box says so at the top; with the network back it is gone
  await page.context().setOffline(true);
  await expect(page.getByTestId("ask-offline")).toContainText("现在没有网络。");
  await expectPageChecks(page, { side: "elder" });
  await page.context().setOffline(false);
  await expect(page.getByTestId("ask-offline")).toHaveCount(0);
  await expect(page.locator(".rpu-tabs")).toBeVisible();

  await ask(page, "今天 150/95，我能不能多吃一粒？");
  await expect(page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]')).toBeVisible();
  // the answer is one line: his question, then each part under the node of where it comes from, in lib/safety's order
  const hero = page.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(hero.locator('[data-rp="tl-item"]').first()).toHaveAttribute("data-node", "me");
  expect(await hero.getByTestId("answer-line").evaluateAll((els) => els.map((e) => [e.getAttribute("data-kind"), e.getAttribute("data-node")]))).toEqual([
    ["quote", "doc"],
    ["label", "lab"],
    ["ripple", "rip"],
  ]);
  await expect(hero.getByTestId("ask-question-added")).toHaveAttribute("data-node", "ok");
  await expect(page.getByTestId("ask-start")).toHaveCount(0);
  await expect(page.locator(".rpu-tabs")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });

  await ask(page, "我胸口好痛，左手没力");
  await expect(page.locator('[data-testid="answer-line"][data-kind="emergency"]')).toBeVisible();
  // 995 has the screen: no tab bar under it (the draft's 09-1); the field to say more stays
  await expect(page.locator(".rpu-tabs")).toBeHidden();
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });

  await ask(page, "我觉得活着没什么意思，只会拖累孩子");
  await expect(page.locator('[data-testid="answer-line"][data-kind="hotlines"]')).toBeVisible();
  await expect(page.locator(".rpu-tabs")).toBeHidden();
  await expectPageChecks(page, { side: "elder" });

  // chit-chat: the fixed sentence and 「记下来」, then 「记下了。」
  await ask(page, "今天天气怎么样？");
  await expect(page.locator(".rpu-tabs")).toBeVisible();
  await expect(page.getByTestId("ask-write-down")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
  await page.getByTestId("ask-write-down").click();
  await expect(page.getByTestId("ask-written")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });

  await page.reload();
  // today's earlier questions are a list (the draft's 07-6); a row opens its answer, which does not say the question again
  await expect(page.getByTestId("ask-earlier-turn")).toHaveCount(3);
  await page.getByTestId("ask-earlier-turn").first().locator("summary").click();
  await expect(page.getByTestId("ask-earlier-turn").first().locator('[data-testid="ask-turn"]')).toBeVisible();
  await expect(page.getByTestId("ask-earlier-turn").first().getByRole("heading")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });
  await checkTextScaling(page);
});

test("问一句 without his consent to AI processing: the screen says the design's one sentence, once, on /p/ask and on Today (real-app 2.10)", async ({ page }) => {
  test.setTimeout(90_000);
  const SENTENCE = "你没有同意用 AI，这里只能帮你记下来、转给医生。";
  const made = await page.request.post("/api/dev/accounts", { data: { login: `na${Date.now().toString(36)}`, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  const base = new URL(page.url() === "about:blank" ? (test.info().project.use.baseURL ?? "http://localhost") : page.url()).origin;
  const off = await page.request.post("/api/me/consent", { data: { kind: "ai_processing", on: false }, headers: { origin: base } });
  expect(off.status(), await off.text()).toBe(200);

  // before he asks anything: the sentence is on the screen, in a grey box at the top with the way to where he changes it
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-no-ai")).toHaveText(SENTENCE);
  await expect(page.getByTestId("ask-no-ai-change")).toHaveAttribute("href", "/p/me/ai");
  await expectPageChecks(page, { side: "elder" });

  // the rules still relay his doctor's words; the sentence stays, and is not repeated under the answer
  await ask(page, "今天 150/95，我能不能多吃一粒？");
  await expect(page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]')).toBeVisible();
  await expect(page.getByTestId("ask-no-ai")).toHaveCount(1);
  await expect(page.getByTestId("answer-no-ai")).toHaveCount(0);
  // the row under the answer says when he asked it before (real-app 4.5)
  await expect(page.getByTestId("ask-question-added")).toContainText("也问过，已经在问题单里");
  await expectPageChecks(page, { side: "elder" });

  // nothing for the rules to relay: the fixed template says the same sentence, then where his question went
  await ask(page, "我可以去游泳吗？");
  const turn = page.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(turn.getByTestId("answer-text")).toHaveText(`${SENTENCE}我已经把它加进问题单。`);
  await expect(page.getByTestId("answer-no-ai")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });

  // Today's typing dock says it too (the draft's 04-1: 「打字」 puts the field in the place of the 「按一下说 / 打字」 bar)
  await page.goto("/p/today");
  await page.getByTestId("say-type").click();
  await expect(page.getByTestId("ask-no-ai")).toHaveText(SENTENCE);

  // with his consent back on the sentence is gone
  const on = await page.request.post("/api/me/consent", { data: { kind: "ai_processing", on: true }, headers: { origin: base } });
  expect(on.status(), await on.text()).toBe(200);
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  await expect(page.getByTestId("ask-no-ai")).toHaveCount(0);
});

test("问一句 when his sign-in has ended: the sentence he was sending waits on this phone, is back in the field after he logs in, and is asked only when he taps", async ({ page }) => {
  test.setTimeout(120_000);
  const PASSWORD = "a long test password";
  const login = `sd${Date.now().toString(36)}`;
  const made = await page.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  const Q = "今天 150/95，我能不能多吃一粒？";
  const TIRED = "我今天好累";
  /** what this phone keeps of a sentence on its way (sessionStorage; components/today/AskSection.tsx) */
  const kept = async () => JSON.parse((await page.evaluate(() => window.sessionStorage.getItem("rp_ask_draft"))) ?? "null") as { text: string } | null;
  const asked = async () => ((await (await page.request.get("/api/ask/history")).json()) as { turns: { text: string }[] }).turns.map((t) => t.text);
  /** his sign-in ends (signed out from another device): the phone's cookies are no longer a sign-in */
  const signInEnds = async () => expect((await page.request.delete("/api/dev/login")).ok()).toBe(true);
  const logsInAgain = async () => {
    const back = await page.request.post("/api/dev/login", { data: { login, password: PASSWORD } });
    expect(back.ok(), await back.text()).toBe(true);
  };

  // ---- on the ask screen
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  expect(await kept()).toBeNull();
  await signInEnds();
  await page.getByTestId("ask-input").fill(Q);
  await page.getByTestId("ask-send").click();
  await page.waitForURL(/\/login\?next=%2Fp%2Fask/);
  expect(await kept()).toMatchObject({ text: Q });

  // he logs in again and is back on the screen: his words are in the field, and nothing was asked for him
  await logsInAgain();
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-input")).toHaveValue(Q);
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-turns", "0");
  expect(await asked()).toEqual([]);
  // he taps 「问这句」 himself: answered, and the phone forgets the sentence
  await ask(page, Q);
  expect(await kept()).toBeNull();
  expect(await asked()).toEqual([Q]);
  await page.reload();
  await expect(page.getByTestId("ask-input")).toHaveValue("");

  // ---- on Today's typing dock
  await page.goto("/p/today");
  await page.getByTestId("say-type").click();
  await page.getByTestId("ask-input").fill(TIRED);
  await signInEnds();
  await page.getByTestId("ask-send").click();
  await page.waitForURL(/\/login\?next=%2Fp%2Ftoday/);
  expect(await kept()).toMatchObject({ text: TIRED });
  await logsInAgain();
  await page.goto("/p/today");
  // the dock is open with his words; he did not have to tap 「打字」 again
  await expect(page.locator('[data-testid="ask-section"][data-mode="today"]')).toBeVisible();
  await expect(page.getByTestId("ask-input")).toHaveValue(TIRED);
  expect(await asked()).toEqual([Q]);
  // he empties the field: the phone forgets it, and Today opens as usual again
  await page.getByTestId("ask-input").fill("");
  expect(await kept()).toBeNull();
  await page.reload();
  await expect(page.getByTestId("say-type")).toBeVisible();
  await expect(page.getByTestId("ask-section")).toHaveCount(0);
});
