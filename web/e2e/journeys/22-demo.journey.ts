/**
 * 22 评委入口：/demo 分屏，和拍摄组的门 (track E; real-app 5.2, 5.3; real-status "导演台和评委页").
 *
 * A judge's laptop (a desktop window, not a phone: /demo is the split page), already signed in to an account of their own
 * on Mr Tan's example data (the foundation's helper, as sign-up's 「用陈先生的示例资料」 makes it), opens /demo: the split
 * view shows the demo copy and says so, one intro line, Mr Tan's phone
 * on the evening of Day 29 on the left and every step on the right; no crew tools; a button that cannot be pressed says
 * why; the hero question answers on the phone; the backstage reads in plain words in Singapore time; the phone's
 * language; the check drill (one made-up sentence added on purpose, stopped at layer 1, named on the backstage); the two
 * ways to a phone; "Back to my account" lands on the judge's own Today (real date, the example's own
 * records); /eval's real results; /how's runtime boxes. Then the crew's door: the crew's pages
 * do not exist for the judge (404); after the crew key at /backstage/crew they appear, the story clock moves the phone
 * from Day 0, and on /director a scene moves the phone, "Simulate no reply" is greyed with what is recorded, the
 * day's visit replays on the phone (a second tab holds the demo phone) and stops on demand, a day outside the story is
 * refused in words.
 *
 * Runs on a production build with RIPPLE_DEV_TOOLS=1 (scripts/record/serve.mjs): the dev crew key is accepted there.
 * No transcription is involved: the visit is the sample replay of the story (its corner label says so).
 *
 * On real time: the developer test clock is cleared first (fix round of 10-11). Journey 06 leaves it frozen at 2026-09-01;
 * on the real stack the judge's copy then had cookies that lived 60 s, and the phone's ask a minute into the journey was
 * refused, which read as "the judge's own sentence never showed on the phone".
 */
import type { Page } from "@playwright/test";
import { CHAIN_CREW_KEY, DEMO_ROOT } from "../helpers";

const PASSWORD = "a long test password";
import { expect, journey } from "./_kit";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const WIDTH = 1180;
const HEIGHT = 760;

/**
 * The two waits of the judge's own question, for a real model and checker as much as for the offline one.
 *
 * ASKED_WITHIN_MS: his sentence on the phone. The phone's own box draws it the moment it is sent; no server is in it.
 * ANSWER_WITHIN_MS: the whole answer. Every model call of one answer, the checker's included, shares ask()'s one budget
 * (lib/safety/pipeline.ts askDeadlineMs: ASK_DEADLINE_MS, 8 s unless the server is given another): past it the calls
 * still out are stopped and the answer is made from what is there (tests/unit/safety/ask-deadline.test.ts). Around that
 * budget stand the store's round trips (who is asking, the device, his consent before it; the question, the safety
 * record and the two rows of the turn after it: about a dozen, 80 ms each on the hosted database), the response and the
 * render: 4 s for those. 8 + 4 = 12 s. The two real runs that reached this question measured 2.9 s and 2.6 s. The
 * judges' page itself gives up at 20 s (components/landing/phone-driver.ts PHONE_ANSWER_TIMEOUT_MS).
 */
const ASKED_WITHIN_MS = 2000;
const ANSWER_WITHIN_MS = 12_000;

// a laptop, not a phone: /demo is the side-by-side page (>= 1024 px); recorded at twice the size like the phones
journey.use({
  viewport: { width: WIDTH, height: HEIGHT },
  isMobile: false,
  hasTouch: false,
  video: {
    mode: "on",
    size: { width: WIDTH * 2, height: HEIGHT * 2 },
    show: {
      actions: {
        duration: 650,
        cursor: "none",
        style: {
          point:
            "width: 46px; height: 46px; border-radius: 50%; background: rgba(255, 183, 0, 0.30); border: 3px solid rgba(255, 153, 0, 0.95); box-shadow: 0 0 0 7px rgba(255, 153, 0, 0.18)",
          highlight: "outline: 3px solid rgba(255, 153, 0, 0.85); outline-offset: 2px; border-radius: 10px; background: rgba(255, 183, 0, 0.08)",
          title: "display: none",
        },
      },
    },
  },
});

/** /demo, ready: the copy made, the phone live in its frame. */
async function demoReady(page: Page): Promise<void> {
  expect((await page.goto(DEMO_ROOT))?.status()).toBe(200);
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
}

const framePath = (page: Page) => page.evaluate(() => (document.querySelector('[data-testid="landing-phone"]') as HTMLIFrameElement | null)?.contentWindow?.location.pathname ?? null);

journey("22 评委入口：/demo 分屏和拍摄组的门", async ({ kit, request }) => {
  kit.cornerLabel("转写：测试替身（示例回放）");
  // real time, whatever a journey before left on the developer test clock (see the header)
  expect((await request.post("/api/dev/clock", { data: { clear: true } })).status()).toBe(200);
  const { laptop } = await kit.phones({ laptop: "评委的电脑" });
  const page = laptop.page;
  // the judge's own account on the example data, made the way sign-up's example choice makes it
  const made = await laptop.context.request.post("/api/dev/accounts", {
    data: { login: `judge${Date.now().toString(36)}`, password: PASSWORD, space: "example", display_name: "评委" },
  });
  expect(made.status(), await made.text()).toBe(201);
  await demoReady(page);
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  // the copy stays this browser's for the whole sitting (it is kept 48 h), not for a minute
  const copy = (await laptop.context.cookies()).find((c) => c.name === "rp_session");
  expect(copy, "the copy's cookie").toBeTruthy();
  expect(copy!.expires * 1000 - Date.now(), "ms the copy's cookie has left").toBeGreaterThan(24 * 3_600_000);

  // ---- the judge
  await kit.step(page, "评委打开 /demo：最上面一句话说明 Ripple 是什么、陈先生是谁");
  await expect(page.getByTestId("demo-intro-line")).toContainText("Ripple keeps what the doctor said");
  await expect(page.getByTestId("demo-intro-line")).toContainText("Mr Tan is 67");
  await kit.show(page.getByTestId("demo-intro"));

  await kit.step(page, "评委已经用示例资料开了自己的账号：分屏里是一份演示副本，顶上写着「演示中」");
  await expect(page.getByTestId("demo-account-banner")).toContainText("演示中");
  await expect(page.getByTestId("demo-account-banner")).toContainText("nothing here touches your account");
  await kit.show(page.getByTestId("demo-account-banner"));

  await kit.step(page, "左边是陈先生的手机，停在第 29 天晚上 8:15；手机上没有拍摄用的跳转菜单");
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  await expect(phone.getByTestId("jump-menu")).toHaveCount(0);
  await expect(phone.getByTestId("debug-info")).toHaveCount(0);
  await kit.show(page.getByTestId("landing-phone-frame"));

  await kit.step(page, "评委看不到故事时钟和导演台：导航只有 Demo、Evaluation、How it works");
  await expect(page.getByTestId("landing-story")).toHaveCount(0);
  await expect(page.getByTestId("staff-nav").getByRole("link")).toHaveText(["Demo", "Evaluation", "How it works"]);
  await kit.show(page.getByTestId("staff-nav"));

  await kit.step(page, "按不了的按钮旁边写着原因：自己问的那一栏没打字，按钮下写「先打一句」");
  await expect(page.getByTestId("own-question-send")).toBeDisabled();
  await expect(page.getByTestId("own-question-why")).toHaveText("Type a sentence first, as Mr Tan would.");
  await kit.show(page.getByTestId("own-question"));

  await kit.step(page, "点大按钮：手机上问「今天 150/95，我能不能多吃一粒？」");
  await kit.show(page.getByTestId("hero-button"));
  await page.getByTestId("hero-button").click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 6000 });
  const r4 = phone.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await expect(r4.getByTestId("answer-text")).toHaveText(R4);
  await expect(r4.getByTestId("answer-chip")).toHaveText("● 医生说");
  await expect(phone.locator('[data-testid="answer-line"][data-source^="label:"]')).toBeVisible();
  const ms = Number(await page.getByTestId("hero-timing").getAttribute("data-ms"));
  expect(ms).toBeLessThan(4000);
  await expect(page.getByTestId("hero-status")).toContainText("The whole answer was on the phone");

  await kit.step(page, `${(ms / 1000).toFixed(1)} 秒出完整回答：先是 Dr Lim 的原话，再是药袋原文，没有剂量建议`);
  await kit.show(page.getByTestId("landing-phone-frame"));
  for (const w of ["可以多吃", "没关系", "加一粒", "两粒"]) await expect(phone.getByTestId("ask-answer")).not.toContainText(w);

  await kit.step(page, "右边后台每一步一句人话，时间是新加坡时间，不露程序名和代号");
  const feed = page.getByTestId("event-feed");
  const received = feed.locator('[data-testid="event-row"][data-type="ask.received"]').first();
  await expect(received).toBeVisible();
  const iso = (await received.getByTestId("event-time").getAttribute("datetime"))!;
  await expect(received.getByTestId("event-time")).toHaveText(new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(11, 19));
  const blocked = feed.locator('[data-testid="event-row"][data-type="ask.blocked"]').first();
  await expect(blocked.getByTestId("event-badge")).toHaveText("Blocked · the request");
  await expect(feed.locator('[data-testid="event-row"][data-type="ask.route"]').first()).toContainText("Sorted as a request that is not Ripple's to answer");
  expect(await feed.innerText()).not.toMatch(/verify\.layer|rule:|ask\.received/);
  await kit.show(blocked);

  await kit.step(page, "手机语言可以切：点「English」，陈先生的手机换成英文");
  await page.getByTestId("landing-phone-lang-en").click();
  await expect(page.getByTestId("hero-button")).toContainText("Ask: “Today 150/95, can I take one more tablet?”", { timeout: 15_000 });
  await expect(phone.locator(".rp-patient").first()).toHaveAttribute("lang", "en", { timeout: 15_000 });
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await kit.show(page.getByTestId("landing-phone-frame"));

  await kit.step(page, "评委自己问一句：「What is amlodipine for?」，走同一套检查");
  await kit.type(page.getByTestId("own-question-input"), "What is amlodipine for?");
  await page.getByTestId("own-question-send").click();
  // his sentence is on the phone's screen at once, before any answer (the phone's box draws it the moment it is sent)
  await expect(phone.getByTestId("ask-asked")).toHaveText("“What is amlodipine for?”", { timeout: ASKED_WITHIN_MS });
  await expect(phone.getByTestId("ask-asked")).toBeInViewport();
  // then the whole answer, with at least one line that names its source
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: ANSWER_WITHIN_MS });
  const sourced = phone.locator('[data-testid="answer-line"][data-source]').first();
  await expect(sourced).toBeVisible();
  await expect(sourced.getByTestId("answer-chip")).toBeVisible();
  // the judges' page timed both: the sentence was on the phone within a second of the click, whatever the answer took
  const ownTiming = page.getByTestId("hero-timing");
  await expect(ownTiming).toHaveAttribute("data-what", "own");
  const shownMs = await ownTiming.getAttribute("data-shown-ms");
  expect(shownMs, "ms from the click to the sentence on the phone").toMatch(/^\d+$/);
  expect(Number(shownMs)).toBeLessThan(1000);
  await kit.show(page.getByTestId("landing-phone-frame"));

  await kit.step(page, "切回「华语」：手机又是陈先生平时看的样子");
  await page.getByTestId("landing-phone-lang-zh").click();
  await expect(page.getByTestId("hero-button")).toContainText("问：今天 150/95，我能不能多吃一粒？", { timeout: 15_000 });
  await expect(phone.locator(".rp-patient").first()).toHaveAttribute("lang", "zh-Hans", { timeout: 15_000 });

  // C2 follow-up (real-app 12 「『某一句被第几道检查拦下』从没出现过」): the check drill (lib/crew/drill.ts)
  await kit.step(page, "检查演练：故意往回答里加一句没有来源的话，三道检查照常跑，后台写明它在第一道被拦下");
  await page.getByTestId("drill-summary").click();
  await expect(page.getByTestId("landing-drill")).toContainText("If the reading is high, take one more tablet tonight.");
  await page.getByTestId("drill-button").click();
  await expect(page.getByTestId("drill-status")).toHaveAttribute("data-stopped", "1", { timeout: 15_000 });
  await expect(phone.getByTestId("ask-asked")).toHaveText("“Amlodipine 这个药是做什么的？”");
  expect(await phone.getByTestId("ask-box").innerText()).not.toContain("take one more tablet");
  const stopped = feed.locator('[data-testid="event-row"][data-type="ask.blocked"]').filter({ hasText: "Check drill" }).first();
  await expect(stopped.getByTestId("event-badge")).toHaveText("Blocked · layer 1 · drill", { timeout: 8000 });
  await expect(stopped.getByTestId("event-sentence")).toContainText("It was stopped at layer 1, because");
  await kit.show(stopped);

  await kit.step(page, "手机下面两条路：新标签页打开这台手机，或扫二维码在自己手机上打开真 app 注册");
  await expect(page.getByTestId("open-phone-tab")).toHaveAttribute("href", "/p/today");
  // the judge's phone starts at the front door (welcome page: 注册 / 登录)
  await expect(page.getByTestId("phone-app-url")).toHaveText(/:\d+\/$/);
  await expect(page.getByTestId("phone-app-qr")).toBeVisible();
  await kit.show(page.getByTestId("phone-links"));

  await kit.step(page, "点「回到我的账号」：回到评委自己的「今天」，是今天的真实日期，不是第几天");
  await page.getByTestId("demo-back-to-account").click();
  await page.waitForURL((u) => u.pathname === "/p/today", { timeout: 20_000 });
  await expect(page.locator('[data-rp="example-line"]')).toBeVisible({ timeout: 15_000 });
  expect(await page.locator("body").innerText()).not.toMatch(/第\s*\d+\s*天|Day \d+/);
  await expect(page.getByTestId("jump-menu")).toHaveCount(0);
  expect((await laptop.context.cookies()).find((c) => c.name === "rp_view")).toBeUndefined();
  await kit.show(page.locator('[data-rp="example-line"]'));

  await kit.step(page, "Evaluation：最近一次真模型的评测，51 题全过，写明模型和新加坡时间");
  expect((await page.goto("/eval"))?.status()).toBe(200);
  await expect(page.getByTestId("eval-live-score")).toHaveText("51 of 51 passed");
  await expect(page.getByTestId("eval-live-meta")).toContainText("DeepSeek deepseek-flash");
  await expect(page.getByTestId("eval-live-meta")).toContainText("(Singapore time)");
  await kit.show(page.getByTestId("eval-live-safety"));

  await kit.step(page, "How it works：每一格写着这台服务器实际在跑什么，没有文件路径和端口");
  expect((await page.goto("/how"))?.status()).toBe(200);
  await expect(page.getByTestId("how-box-database").getByTestId("how-box-running")).toContainText("On this server:");
  await expect(page.getByTestId("how-box-main_model").getByTestId("how-box-running")).toBeVisible();
  expect((await page.locator("main").textContent()) ?? "").not.toMatch(/127\.0\.0\.1|localhost:|web\//);
  await kit.show(page.getByTestId("how-box-database"));

  await kit.step(page, "录音存多久写的是真账号的规矩：90 天，除非他选「一直保留」");
  await expect(page.getByTestId("trust-storage-summary")).toContainText("kept 90 days unless he chooses to keep it");
  await kit.show(page.getByTestId("trust-storage"));

  // ---- the crew's door
  await kit.step(page, "评委打开导演台 /director：这页对评委不存在，是「找不到页面」");
  const notFound = await page.goto("/director");
  expect(notFound?.status()).toBe(404);
  // (front-end line fe-12: the app's own not-found page, one plain sentence and a way on; never the framework's English one)
  await expect(page.getByTestId("not-found-words")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/404|could not be found/i);
  for (const route of ["/backstage", "/join"]) expect((await page.request.get(route)).status(), route).toBe(404);

  await kit.step(page, "拍摄组在 /backstage/crew 输一次拍摄组口令，这台电脑才算拍摄组");
  await page.goto("/backstage/crew");
  await kit.type(page.getByTestId("crew-key"), CHAIN_CREW_KEY);
  await page.getByTestId("crew-key-submit").click();
  await expect(page.getByTestId("crew-signed-in")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("staff-nav")).toHaveAttribute("data-crew", "true");
  await kit.show(page.getByTestId("crew-links"));

  await kit.step(page, "拍摄组的 /demo 多了故事时钟：点「从第一天开始看」，手机翻到第 0 天看诊");
  await demoReady(page);
  await expect(page.getByTestId("landing-story")).toBeVisible();
  await kit.show(page.getByTestId("landing-story"));
  await page.getByTestId("landing-from-day-one").click();
  await expect(page.getByTestId("landing-day")).toHaveText("Day 0 · Mon 9:30am", { timeout: 15_000 });
  await expect(phone.getByTestId("story-day-label")).toHaveText("第0天 · 周一 上午9:30", { timeout: 15_000 });
  await expect.poll(() => framePath(page)).toBe("/p/visit");
  await kit.show(page.getByTestId("landing-phone-frame"));

  await kit.step(page, "拨回第 29 天晚上：那天早上的药已经记了，导演台上「假装没回」就灰掉");
  await page.getByTestId("landing-hero-beat").click();
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15", { timeout: 15_000 });
  // the demo phone stays open in a second tab: the director's cues move it while this window shows the director
  const phoneTab = await laptop.context.newPage();
  await phoneTab.goto(DEMO_ROOT);
  await expect(phoneTab.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.goto("/director");
  await expect(page.getByTestId("director-console")).toBeVisible();
  await expect(page.getByTestId("director-no-reply")).toBeDisabled();
  await expect(page.getByTestId("director-no-reply-why")).toHaveText("This day is already recorded: Amlodipine taken.");
  await kit.show(page.getByTestId("director-no-reply-why"));

  await kit.step(page, "点场景「第三次看诊」：时钟到第 42 天，手机跟着翻到看诊页");
  await page.getByTestId("beat-d42-visit").click();
  await expect(page.getByTestId("director-day-label")).toHaveText("Day 42 · Mon 9:30am", { timeout: 15_000 });
  await expect.poll(() => framePath(phoneTab), { timeout: 15_000 }).toBe("/p/visit");
  await expect(page.getByTestId("director-no-reply")).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId("director-replay-start")).toBeEnabled();
  await kit.show(page.getByTestId("director-replay"));

  await kit.step(page, "点「开始回放」：手机打开第三次看诊开始播放，后台一句句进来");
  await page.getByTestId("director-replay-start").click();
  const hearing = page.locator('[data-testid="event-row"][data-type="asr.partial"], [data-testid="event-row"][data-type="asr.final"]');
  await expect(hearing.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("director-replay-why")).toHaveAttribute("data-running", "true");
  await kit.pause(2500);
  await expect(hearing.first().getByTestId("event-sentence")).toContainText("at the third visit");

  await kit.step(page, "点「停止回放」：回放马上停住，后台写明是导演停的");
  await page.getByTestId("director-replay-stop").click();
  await expect(page.locator('[data-testid="event-row"][data-type="director.cue"]').filter({ hasText: "The visit replay stopped (the director stopped it)." })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId("director-replay-why")).toHaveAttribute("data-running", "false");
  // a sentence already being stored when the stop landed may still arrive (a slower database makes that moment
  // visible): let it land, then the count must hold still
  await kit.pause(1500);
  const settled = await hearing.count();
  await kit.pause(3000);
  expect(await hearing.count()).toBe(settled);

  await kit.step(page, "填故事外的日子（第 99 天）：不会照收，导演台用一句话说清范围");
  await page.getByTestId("director-day-input").fill("99");
  await page.getByTestId("director-jump").click();
  await expect(page.getByTestId("director-status")).toHaveText("The clock runs from Day 0 to Day 45 (the story's records end on Day 43).");
  await expect(page.getByTestId("director-status")).toHaveAttribute("data-problem", "true");
  await expect(page.getByTestId("director-day-label")).toHaveText("Day 42 · Mon 9:30am");
  await kit.show(page.getByTestId("director-status"));

  await phoneTab.close();
  await kit.finish();
});
