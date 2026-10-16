/**
 * 问一句 by voice, on a server that can listen (SPEECH_PROVIDER=whisper with its address and token; real-app 2.10). The
 * default e2e server has no transcription service, the ask screen then draws nothing of the microphone, and every test
 * here is skipped (e2e/s-ask-page.spec.ts checks that there is no microphone). To run them:
 *
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7966 WHISPER_TOKEN=<43 characters or more> \
 *     node scripts/record/serve.mjs --port 3700 --build --detach
 *   PW_PORT=3700 npx playwright test e2e/s-ask-voice.spec.ts
 *
 * Nothing has to listen on that address: what Whisper would answer is stood in for at the browser (POST
 * /api/ask/transcribe is routed here), and the microphone is Chromium's stand-in device. The screens are the timeline
 * draft's 07-1a (listening), 07-1b (his words, to check before asking), 通用-4b (the microphone refused) and 通用-4c (no
 * microphone); each passes the page checks, and typing stays possible in every one of them.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

const PHONE = { viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" } as const;
test.use({ ...PHONE, launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

const HEARD = "这个药是做什么的？";

test.beforeEach(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json()) as { provider?: string };
  test.skip(health.provider !== "whisper", "this server has no transcription service: the ask screen draws no microphone");
});

async function account(context: BrowserContext): Promise<void> {
  const made = await context.request.post("/api/dev/accounts", { data: { login: `sv${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
}

async function phone(browser: Browser, init?: () => void): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(PHONE);
  if (init) await context.addInitScript(init);
  await account(context);
  const page = await context.newPage();
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  return { context, page };
}

test("he says his question: listening, the words he said to check, and only 「问这句」 asks them", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await phone(browser);
  await context.grantPermissions(["microphone"]);
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask") && r.method() === "POST") asked.push(r.postData() ?? "");
  });
  const sent: number[] = [];
  await page.route("**/api/ask/transcribe", async (route) => {
    sent.push(route.request().postDataBuffer()?.length ?? 0);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: HEARD }) });
  });

  // idle: the field first, the worded microphone button next to 「问这句」
  const mic = page.getByTestId("ask-mic");
  await expect(mic).toHaveText("按一下开始说，说完再按一下");
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });

  // listening (07-1a): the microphone has the screen; 「说完了」 ends it, 「改用打字」 lets it go
  await mic.click();
  const section = page.getByTestId("ask-mic-section");
  await expect(section).toHaveAttribute("data-state", "listening");
  await expect(page.locator('[data-rp="mic-stage"]')).toContainText("正在听，说完再按一下");
  await expect(page.getByTestId("ask-mic")).toHaveText("说完了");
  await expect(page.getByTestId("ask-mic")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-input")).toBeHidden();
  await expectPageChecks(page, { side: "elder" });
  // 「改用打字」: nothing is sent, the field is back
  await page.getByTestId("ask-mic-cancel").click();
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);

  // again, and this time he finishes: his words are shown, nothing is asked yet (07-1b)
  await page.getByTestId("ask-mic").click();
  await expect(section).toHaveAttribute("data-state", "listening");
  await page.waitForTimeout(800);
  await page.getByTestId("ask-mic").click();
  await expect(page.getByTestId("ask-heard")).toHaveText(HEARD);
  expect(sent.length).toBe(1);
  expect(sent[0]).toBeGreaterThan(44);
  expect(asked).toEqual([]);
  await expectPageChecks(page, { side: "elder" });

  // 「重新说」 puts the words away; said again, 「问这句」 asks them as a typed question is asked
  await page.getByTestId("ask-heard-again").click();
  await expect(page.getByTestId("ask-heard")).toHaveCount(0);
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await page.getByTestId("ask-mic").click();
  await expect(section).toHaveAttribute("data-state", "listening");
  await page.waitForTimeout(800);
  await page.getByTestId("ask-mic").click();
  await expect(page.getByTestId("ask-heard")).toHaveText(HEARD);
  await page.getByTestId("ask-heard-send").click();
  await expect(page.locator('[data-testid="ask-turn"][data-latest="true"]').getByRole("heading", { level: 1 })).toHaveText(HEARD, { timeout: 10_000 });
  expect(asked.map((b) => (JSON.parse(b) as { text: string }).text)).toEqual([HEARD]);
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await context.close();
});

test("he comes through 「按一下说」 (/p/ask?speak=1): the screen opens listening, and a refresh does not listen again", async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  await context.grantPermissions(["microphone"]);
  await account(context);
  const page = await context.newPage();
  await page.goto("/p/today");
  await expect(page.getByTestId("say-speak")).toBeEnabled();
  await page.getByTestId("say-speak").click();
  await page.waitForURL("**/p/ask");
  await expect(page.getByTestId("ask-mic-section")).toHaveAttribute("data-state", "listening");
  await page.getByTestId("ask-mic-cancel").click();
  await page.reload();
  await expect(page.getByTestId("ask-mic-section")).toHaveAttribute("data-state", "idle");
  await context.close();
});

test("the microphone refused (通用-4b): a box says where to switch it on; the button and the field stay", async ({ browser }) => {
  const { context, page } = await phone(browser, () => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.getByTestId("ask-mic").click();
  const note = page.getByTestId("ask-mic-note");
  await expect(note).toHaveAttribute("data-state", "denied");
  await expect(note).toContainText("麦克风被关掉了");
  await expect(page.getByTestId("ask-mic")).toBeEnabled();
  await expect(page.getByTestId("ask-input")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });
  await context.close();
});

test("no microphone on this phone (通用-4c): a box says so, no button to ask for one; typing asks", async ({ browser }) => {
  const { context, page } = await phone(browser, () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await page.getByTestId("ask-mic").click();
  const note = page.getByTestId("ask-mic-note");
  await expect(note).toHaveAttribute("data-state", "unavailable");
  await expect(note).toContainText("这台手机用不了麦克风");
  await expect(page.getByTestId("ask-mic")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });
  await page.getByTestId("ask-input").fill("今天 150/95，我能不能多吃一粒？");
  await page.getByTestId("ask-send").click();
  await expect(page.locator('[data-testid="ask-turn"][data-latest="true"]').getByRole("heading", { level: 1 })).toHaveText("今天 150/95，我能不能多吃一粒？", { timeout: 10_000 });
  await context.close();
});
