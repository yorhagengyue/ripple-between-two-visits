/**
 * 25 填账号直接绑定 (line bind; the owner, 2026-10-11: 「如果是子女的话，他需要填入老人的账号，如果是老人的话，也可以填入
 * 子女的账号作为直接绑定，这两个行为都会直接绑定，不需要额外的动作」; web/progress/bind.md). Two phones, 陈先生的手机 and
 * 女儿的手机, Friday evening; two families one after the other on the same two phones.
 *
 *   Wei Ling has just signed up and follows nobody: her /f is the form. She types her father's account, chooses 「爸爸」
 *   and taps 「绑定」: no invitation, no waiting. Her home has what the four default switches show (this week's medicine
 *   days, how many readings, how many questions; the alert when two reminders get no reply) and none of his words.
 *   His Today has the card: who bound his account, when, what she can see. Until he answers nothing of hers reaches his
 *   phone: the place of her recorder says so, and her recording and what she adds to his details are refused.
 *   He taps 「知道了」: the card goes, and her recorder is there without her doing anything; her recording is taken.
 *
 *   The other way round, a second family: Mdm Lim types her daughter's account on 「邀请家人」 and lands on her switches
 *   for her, four on, his visit recordings and notes off. Her daughter opens Ripple and is in, the recorder included.
 *   Then Mdm Lim stops sharing, and her daughter's open page says so within a second. Her daughter tries to bind
 *   again by herself (「绑定另一位长辈」, her mother's account): refused in words; it is her mother's to do (round two).
 *
 * She signs up through the developer accounts (no space of her own, as the sign-up page for a family member makes
 * one): that page is another line's. FAMILY_BIND_MODE is the default, direct.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, journey } from "./_kit";
import { clearClock, herView, newAccount, seenAt, setClock, tappedAt, watchFor, watchTap } from "./_d/family";

/** The stand-in recording the e2e use for her voice (a real WAV with sound). */
const WAV = path.resolve(process.cwd(), "lib", "daily", "assets", "wei-ling-reminder.standin.wav");

/**
 * Her recording through her link, as her recorder sends it: the upload link, the file, then POST /api/reminders.
 * `at`: the step that answered (a link he has not acknowledged is refused at the first one: no upload link is signed).
 */
async function record(her: BrowserContext, linkId: string): Promise<{ status: number; error: string | null; at: "upload" | "register" }> {
  const q = `link=${encodeURIComponent(linkId)}`;
  const up = await her.request.post(`/api/upload-url?${q}`, { data: { kind: "reminder", content_type: "audio/wav" } });
  if (!up.ok()) return { status: up.status(), error: ((await up.json().catch(() => ({}))) as { error?: string }).error ?? null, at: "upload" };
  const u = (await up.json()) as { url: string; method?: string; headers?: Record<string, string>; path: string };
  const put = await her.request.fetch(u.url, { method: u.method === "POST" ? "POST" : "PUT", headers: u.headers, data: readFileSync(WAV) });
  expect(put.ok(), await put.text()).toBe(true);
  const reg = await her.request.post(`/api/reminders?${q}`, { data: { audio_path: u.path }, headers: { "x-ripple-devfake-fixture": "reminder" } });
  return { status: reg.status(), error: ((await reg.json().catch(() => ({}))) as { error?: string }).error ?? null, at: "register" };
}

/** Her first visit's three steps, each put off with 「以后再说」. */
async function skipWelcome(page: Page): Promise<void> {
  const app = page.getByTestId("family-app");
  await expect(app).toHaveAttribute("data-state", "welcome-1", { timeout: 15_000 });
  await page.getByTestId("phone-later").click();
  await expect(app).toHaveAttribute("data-state", "welcome-2");
  await page.getByTestId("push-later").click();
  await expect(app).toHaveAttribute("data-state", "welcome-3");
  await page.getByTestId("welcome-skip").click();
  await expect(app).not.toHaveAttribute("data-state", /^welcome-/);
}

journey("25 填账号直接绑定", async ({ kit, request }) => {
  await setClock(request, "2026-10-16T19:40:00+08:00");
  try {
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    const pp = elder.page;
    const dp = daughter.page;
    const him = await newAccount(elder, { space: "example", displayName: "陈先生", prefix: "tan" });
    await elder.context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
    const her = await newAccount(daughter, { space: "none", displayName: "Wei Ling", prefix: "weiling" });
    await pp.goto("/p/today");
    await expect(pp.getByTestId("page-today")).toBeVisible();
    await expect(pp.getByTestId("today-family-bound")).toHaveCount(0);
    await dp.goto("/f");

    // ------------------------------------------------------------ she types his account
    await kit.step(dp, "Wei Ling 刚注册，还没有在看谁。屏上是一张表：填长辈的账号");
    const app = dp.getByTestId("family-app");
    await expect(app).toHaveAttribute("data-state", "no_link");
    await expect(dp.getByTestId("family-headline")).toHaveText("填长辈的账号");
    await expect(dp.getByTestId("family-lede")).toHaveText(
      "填他注册 Ripple 时用的账号。填好就绑定，你马上能看到：这周吃药的天数、量了几次血压、有几个问题要问医生；提醒两次没回的时候会通知你。他那边会收到一条通知，随时可以解除。",
    );
    await expect(dp.locator("body")).toContainText("他还没有账号？先在他的手机上帮他注册，再回来填。");
    await expect(dp.getByTestId("me-logout")).toBeVisible();

    await kit.step(dp, "她填上爸爸的账号，选「爸爸」，点「绑定」，不用等谁确认");
    await kit.type(dp.getByTestId("bind-account"), him.login);
    await dp.locator('[data-testid="bind-calls"] [data-choice="dad"]').click();
    await expect(dp.locator('[data-testid="bind-calls"] [data-choice="dad"]')).toHaveAttribute("aria-checked", "true");
    await dp.getByTestId("bind-submit").click();
    await dp.waitForURL(/\/f\?link=[0-9a-f-]{36}$/);
    const linkId = new URL(dp.url()).searchParams.get("link")!;
    await skipWelcome(dp);

    await kit.step(dp, "马上绑好了。首页有这一周吃药的天数、量血压的次数、要问医生的问题");
    await expect(app).toHaveAttribute("data-live", "open");
    await expect(dp.getByTestId("week-strip")).toBeVisible();
    await expect(dp.locator('[data-rp="family-stats"]')).toContainText("这周量血压");
    await expect(dp.locator('[data-rp="family-stats"]')).toContainText("要问医生的");

    await kit.step(dp, "看诊录音和爸爸的笔记不在里面，页脚写着没有分享");
    await kit.show(dp.getByTestId("open-shared"));
    await expect(dp.getByTestId("open-shared")).toContainText("他的笔记和看诊录音没有分享。");
    const view = await herView(daughter.context, linkId);
    expect(view.status).toBe(200);
    expect(view.body.grants).toEqual({ dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false });
    expect(view.body).toMatchObject({ visitsShared: false, notesShared: false, patientLabel: "爸爸" });
    const shared = (await (await daughter.context.request.get(`/api/family/shared?link=${linkId}`)).json()) as { visits?: unknown; notes?: unknown };
    // his visit records and his notes are not in what she can ask for
    expect(shared.visits).toBeUndefined();
    expect(shared.notes).toBeUndefined();

    // ------------------------------------------------------------ his card
    await kit.step(pp, "陈先生的今天页多了一张卡：谁绑了他的账号、什么时候、她能看到什么");
    await pp.goto("/p/today?confirm=1");
    const card = pp.getByTestId("today-family-bound");
    await expect(card).toHaveAttribute("data-link", linkId);
    await expect(card.locator(".rpu-tl-title")).toHaveText("Wei Ling 绑定了你的账号");
    await expect(pp.getByTestId("bound-who")).toHaveText(`账号 ${her.login}，10月16日 19:40。`);
    await expect(pp.getByTestId("bound-sees")).toHaveText("她现在能看到：这周吃药的天数、量了几次血压、有几个问题要问医生；提醒两次没回的时候会通知她。");
    await expect(card).toContainText("看诊录音和你的笔记她看不到。");
    await expect(pp.getByTestId("bound-ok")).toHaveText("知道了");
    await expect(pp.getByTestId("bound-remove")).toHaveText("不认识这个人，解除");
    await kit.pause(1500);

    await kit.step(dp, "他点「知道了」以前，她录不了提醒：这一屏只有一句话，没有录音键");
    await dp.getByTestId("record-new").click();
    await expect(dp.getByTestId("family-reminder")).toHaveAttribute("data-state", "locked");
    await expect(dp.getByTestId("reminder-locked").getByTestId("family-headline")).toHaveText("等他在自己的手机上点了「知道了」，你就可以给他录提醒。");
    await expect(dp.getByTestId("recorder")).toHaveCount(0);
    // and the server refuses what her screen does not offer: a recording (no upload link is signed, and the route that
    // would register one refuses too), a line for his details, and what his phone plays now
    expect(await record(daughter.context, linkId)).toEqual({ status: 409, error: "link_not_acknowledged", at: "upload" });
    const register = await daughter.context.request.post(`/api/reminders?link=${linkId}`, { data: { audio_path: "x.wav" } });
    expect([register.status(), await register.json()]).toEqual([409, { error: "link_not_acknowledged" }]);
    const fact = await daughter.context.request.post(`/api/profile/facts?link=${linkId}`, { data: { kind: "other", text: "他喜欢早上去公园" } });
    expect([fact.status(), await fact.json()]).toEqual([409, { error: "link_not_acknowledged" }]);
    expect((await daughter.context.request.get(`/api/reminders?link=${linkId}`)).status()).toBe(409);
    expect((await herView(daughter.context, linkId)).body.reminder ?? null).toBeNull();

    await kit.step(pp, "陈先生认得她，点「知道了」。卡片收起来，今天页照常");
    await pp.getByTestId("bound-ok").click();
    await expect(pp.getByTestId("today-family-bound")).toHaveCount(0);
    await expect(pp.getByTestId("page-today")).toBeVisible();

    await kit.step(dp, "她这边不用刷新，几秒后录音键自己出来：现在可以给爸爸录提醒了");
    await expect(dp.getByTestId("recorder")).toBeVisible({ timeout: 15_000 });
    await expect(dp.getByTestId("rec-start")).toBeVisible();
    await expect(dp.getByTestId("reminder-locked")).toHaveCount(0);
    expect(await record(daughter.context, linkId)).toEqual({ status: 201, error: null, at: "register" });
    await kit.pause(1200);

    // ------------------------------------------------------------ the other way round: he types her account
    // (a second family on the same two phones: Mdm Lim and her daughter Hui Min, signed in before the caption)
    const lim = await newAccount(elder, { space: "example", displayName: "林女士", prefix: "lim" });
    await elder.context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
    const huiMin = await newAccount(daughter, { space: "none", displayName: "Hui Min", prefix: "huimin" });
    expect(lim.login).not.toBe(him.login);
    await pp.goto("/p/family/invite");
    await dp.goto("/f");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "no_link");

    await kit.step(pp, "换一家人，反过来绑：林女士在「邀请家人」最上面填女儿的账号");
    const direct = pp.getByTestId("bind-family");
    await expect(direct.locator('[data-rp="section-title"]')).toHaveText("填家人的账号");
    await expect(direct).toContainText("填她注册 Ripple 时用的账号。填好就绑定，她马上能看到下面四项；看诊录音和你的笔记要你自己打开。");
    await expect(pp.getByTestId("bind-four").locator("[data-item]")).toHaveCount(4);
    await expect(pp.getByTestId("invite-second")).toHaveText("她还没有账号？发一个邀请链接给她。");
    await expect(pp.getByTestId("invite-form")).toBeVisible();
    await kit.type(pp.getByTestId("bind-account"), huiMin.login);

    await kit.step(pp, "点「绑定」，直接到她能看到什么那一页：四项开着，两项关着");
    await pp.getByTestId("bind-submit").click();
    const linkPage = pp.getByTestId("page-family-link");
    await expect(linkPage).toHaveAttribute("data-state", "active", { timeout: 15_000 });
    await expect(pp).toHaveURL(/\/p\/family\/[0-9a-f-]{36}$/);
    const link2 = new URL(pp.url()).pathname.split("/").pop()!;
    const sw = (k: string) => pp.locator(`[data-grant="${k}"] [role="switch"]`);
    for (const k of ["dose_summary", "bp_summary", "questions_count", "no_reply_alert"]) await expect(sw(k), k).toHaveAttribute("aria-checked", "true");
    for (const k of ["visit_transcripts", "notes"]) await expect(sw(k), k).toHaveAttribute("aria-checked", "false");
    // her own act needs no 「知道了」
    await expect(pp.getByTestId("link-bound")).toHaveCount(0);
    await kit.show(pp.locator('[data-grant="notes"]'));

    await kit.step(dp, "女儿 Hui Min 打开 Ripple 就进来了，不用等，也能马上录提醒");
    await dp.goto("/f");
    await dp.waitForURL(new RegExp(`/f\\?link=${link2}$`));
    await skipWelcome(dp);
    await expect(dp.getByTestId("family-headline")).toBeVisible();
    await expect(dp.getByTestId("week-strip")).toBeVisible();
    expect(await record(daughter.context, link2)).toEqual({ status: 201, error: null, at: "register" });
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");

    // ------------------------------------------------------------ she is removed
    await kit.step(pp, "后来林女士不想分享了：点「停止分享给 Hui Min」，再点一下就停");
    await pp.getByTestId("link-stop").click();
    await kit.show(pp.getByTestId("stop-sharing"));
    await watchTap(pp, "stop", '[data-testid="stop-sharing"]');
    await watchFor(dp, "ended", '[data-testid="family-app"][data-state="ended"]');
    await pp.getByTestId("stop-sharing").click();
    await expect(linkPage).toHaveAttribute("data-state", "revoked");
    const lag = (await seenAt(dp, "ended")) - (await tappedAt(pp, "stop"));
    expect(lag).toBeLessThan(1000);

    await kit.step(dp, `她开着的那一页 ${Math.max(1, Math.round(lag))} 毫秒就变了：林女士停止了分享`);
    await expect(dp.getByTestId("family-headline")).toHaveText("林女士停止了分享。");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-ended", "patient");
    await expect(dp.getByTestId("week-strip")).toHaveCount(0);
    expect((await herView(daughter.context, link2)).status).toBe(403);
    await expect(dp.getByTestId("family-lede")).toHaveText("你现在看不到他的记录了。想再看，请他在自己的手机上重新绑定你。");

    // ------------------------------------------------------------ she does not come back by herself
    await kit.step(dp, "她想自己再绑回去：填上林女士的账号，被挡住了，要林女士自己来绑");
    await dp.getByTestId("ended-bind").click();
    await dp.waitForURL(/\/f\?bind=1$/);
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "bind_again");
    await kit.type(dp.getByTestId("bind-account"), lim.login);
    await dp.getByTestId("bind-submit").click();
    await expect(dp.getByTestId("bind-error")).toHaveText("他已经解除了和你的绑定。想再绑定，请他在自己的手机上填你的账号。");
    // nothing was made: her link to Mdm Lim is still the one that ended
    const links = (await (await daughter.context.request.get("/api/family/links")).json()) as { family: { id: string; state: string }[] };
    expect(links.family.map((l) => [l.id, l.state])).toEqual([[link2, "revoked"]]);
    await kit.pause(1500);
    await kit.finish();
  } finally {
    await clearClock(request);
  }
});
