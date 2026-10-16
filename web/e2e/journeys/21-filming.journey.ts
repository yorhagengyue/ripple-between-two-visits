/**
 * 21 拍摄账号拨到故事任意一天 (C2 track J; real-app 5.4, 8.11; the elder brief's section 21). Two screens side by side:
 * Mr Tan's phone and the director's desk (/director, phone-sized here).
 *
 * Setup (not recorded): the developer test clock stands at Mon 12 Oct 2026 15:00 (real time, frozen); he signs up on his
 * phone with Mr Tan's example data (track A's sign-up route); the director's browser carries the crew's cookie; an
 * ordinary account (李先生) is signed up elsewhere and never marked.
 *
 *   his phone   today page on the real date -> the crew's key typed once at /backstage/crew -> 我 › 拍摄账号 (crew phones
 *               only) -> 「标成拍摄账号」 (his own sign-in and the crew's cookie)
 *   director    lists the filming account (the same code as on the phone) -> lays it out to the hero scene: the phone is
 *               on Tue 22 Sep 2026, 8:15pm, real-looking dates, the story's records up to that evening -> the hero question
 *               answers only with Dr Lim's words and the label -> forward to 8:44 the next morning (his open phone follows
 *               by itself) -> back is refused -> +1 min, pop the 8:45 reminder (the phone opens it: her clip plays) ->
 *               simulate no reply (the clock goes to 9:46; nobody linked, nobody told) -> he logs it late: his 吃了 reads
 *               the story's 9:46, not the real 3pm -> forward two and a half days: the skipped days are never "no reply"
 *               -> the ordinary account cannot be touched (404) -> end filming: the phone is back on 12 Oct, nothing settled
 * Every step checks the screen and the records (his own APIs, the director's API).
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { CHAIN_CREW_KEY, CREW_HEADERS, signUp, waitLive, withCrew } from "../helpers";
import { expect, journey } from "./_kit";

const PASSWORD = "a long test password";
const REAL = "2026-10-12T15:00:00+08:00";
const HERO = "今天 150/95，我能不能多吃一粒？";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
/** A story day must never reach his phone (real-app H3). */
const STORY_DAY = /第\s*\d+\s*天|Day\s+\d+/;

const headerOf = (p: Page) => p.locator('[data-testid="elder-meta"] [data-rp="meta-story"]');

journey.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

journey("21 拍摄账号拨到故事任意一天", async ({ kit, request }) => {
  kit.cornerLabel("通知横幅：录屏示意");
  const clock = await request.post("/api/dev/clock", { data: { at: REAL, frozen: true } });
  expect(clock.status(), await clock.text()).toBe(200);

  const { elder, director } = await kit.phones({ elder: "陈先生的手机", director: "导演台（拍摄组）" });
  const pp = elder.page;
  const dp = director.page;

  // his account, signed up on his phone (track A's route): Mr Tan's example data on today's dates
  await signUp(elder.context, { login: `tan${randomUUID().slice(0, 8)}`, password: PASSWORD, displayName: "陈先生", space: "example" });
  expect((await elder.context.request.post("/api/me/example", { data: { action: "dismiss_intro" } })).status()).toBe(200);
  // the director's laptop is the crew's
  await withCrew(director.context);
  // an ordinary account on someone else's phone, never marked
  await signUp(request, { login: `lee${randomUUID().slice(0, 8)}`, password: PASSWORD, displayName: "李先生", space: "blank" });

  const doses = async (from: number, to = from) => {
    const res = await elder.context.request.get(`/api/doses?from=${from}&to=${to}`);
    expect(res.status()).toBe(200);
    return ((await res.json()) as { doses: { day: number; state: string; reason: string | null }[] }).doses.map((d) => `${d.day}:${d.state}:${d.reason}`);
  };
  const mine = async () => {
    const res = await elder.context.request.get("/api/crew/filming-account");
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as { filming: boolean; ref: string; date: string; time: string | null };
  };

  // ---- his phone, before filming
  await pp.goto("/p/today");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await kit.step(pp, "陈先生的手机：他刚注册的账号，今天页写的是真实日期 10月12日");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-day", "2026-10-12");
  await expect(headerOf(pp)).toContainText("10月12日 周一");

  await kit.step(pp, "拍摄组在这台手机上输一次口令（输入框不显示字），手机就成了拍摄组的");
  await pp.goto("/backstage/crew");
  await kit.type(pp.getByTestId("crew-key"), CHAIN_CREW_KEY);
  await pp.getByTestId("crew-key-submit").click();
  await expect(pp.getByTestId("crew-signed-in")).toBeVisible();

  await pp.goto("/p/me");
  const entry = pp.locator('[data-entry="filming"]');
  await expect(entry).toBeVisible();
  await kit.step(pp, "「我」里多了一项「拍摄账号」：只有带拍摄组口令的手机看得到");
  await kit.show(entry);
  await entry.click();
  await expect(pp.getByTestId("filming-page")).toHaveAttribute("data-filming", "false");
  await expect(pp.getByRole("heading", { level: 1 })).toHaveText("拍摄账号");
  await expect(pp.getByTestId("filming-page")).toContainText("这个账号里的记录会换成陈先生故事里的记录");

  await kit.step(pp, "他自己点「标成拍摄账号」：导演台从这时起才能拨这个账号");
  await pp.getByTestId("filming-mark").click();
  await expect(pp.getByTestId("filming-page")).toHaveAttribute("data-filming", "true");
  await expect(pp.getByRole("heading", { level: 1 })).toHaveText("拍摄账号");
  await expect(pp.getByTestId("filming-page").locator('[data-rp="tl-item"][data-node="ok"]')).toContainText("这是拍摄账号。");
  const me = await mine();
  expect(me).toMatchObject({ filming: true, date: "2026-10-12", time: "15:00" });
  await expect(pp.getByTestId("filming-code")).toContainText(me.ref);

  // ---- the director's desk
  await dp.goto("/director");
  const card = dp.getByTestId(`filming-account-${me.ref}`);
  const status = card.getByTestId("filming-status");
  await expect(card).toBeVisible();
  await kit.step(dp, "导演台列出拍摄账号：只有他亲手标过的这一个，编号和手机上的一样");
  await kit.show(card);
  await expect(card.getByTestId("filming-ref")).toContainText(me.ref);
  await expect(card.getByTestId("filming-now")).toHaveText("Mon 12 Oct 2026 · 3:00pm");

  await kit.step(dp, "导演点「晚上 150/95」这一场：账号铺到故事里 9月22日 晚上 8:15");
  await card.getByTestId("filming-scene-d29-hero").click();
  await expect(status).toContainText("Laid out to the scene “Evening: 150/95, can he take one more tablet?”");
  await expect(card).toHaveAttribute("data-date", "2026-09-22");
  await expect(card).toHaveAttribute("data-time", "20:15");
  await expect(card.getByTestId("filming-now")).toHaveText("Tue 22 Sep 2026 · 8:15pm");
  await kit.show(card.getByTestId("filming-now"));

  // ---- his phone on the hero evening
  await pp.goto("/p/today");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-day", "2026-09-22");
  await kit.step(pp, "他的手机翻到 9月22日 周二晚上 8:15：日期是真的日期，记录是故事里那天以前的");
  await expect(headerOf(pp)).toHaveText("9月22日 周二 · 晚上 8:15");
  await expect(pp.getByTestId("dose-headline")).toHaveAttribute("data-why", "all-done");
  expect(await pp.locator("body").innerText()).not.toMatch(STORY_DAY);
  expect(await doses(29)).toEqual(["29:taken:null"]);

  await pp.goto("/p/ask");
  await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  await kit.step(pp, "主镜头：他问「今天 150/95，我能不能多吃一粒？」");
  await kit.type(pp.getByTestId("ask-input"), HERO);
  const answered = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await pp.getByTestId("ask-field").getByRole("button", { name: "问这句" }).click();
  expect((await answered).status()).toBe(200);
  const turn = pp.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(turn.getByRole("heading", { level: 1 })).toHaveText(HERO, { timeout: 6000 });
  await expect(turn).toHaveAttribute("data-route", "refuse_route");

  await kit.step(pp, "回答只引 Dr Lim 9月1日的原话和药袋，不给剂量；这个问题进了下次看诊的问题单");
  const r4 = turn.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await kit.show(r4);
  await expect(r4.locator("blockquote")).toHaveText(`“${R4}”`);
  await expect(r4.locator('[data-rp="source-tag"]')).toContainText("9月1日 · 0:43");
  await expect(turn.locator('[data-testid="answer-line"][data-source="label:med-amlodipine"]')).toContainText("Take ONE tablet every MORNING");
  await expect(turn.getByTestId("ask-question-added")).toBeVisible();
  for (const w of ["可以多吃", "没关系", "加一粒吧", "吃两粒"]) await expect(turn).not.toContainText(w);

  // ---- forward to the next morning (his phone, open on Today, follows by itself); back is refused
  await pp.goto("/p/today");
  await waitLive(pp);
  await expect(headerOf(pp)).toHaveText("9月22日 周二 · 晚上 8:15");
  await kit.step(dp, "导演把钟往后拨到第二天早上 8:44");
  await card.getByTestId("filming-forward-time").fill("08:44");
  await card.getByTestId("filming-forward-go").click();
  await expect(card).toHaveAttribute("data-time", "08:44");
  await expect(card.getByTestId("filming-now")).toHaveText("Wed 23 Sep 2026 · 8:44am");
  await expect(status).toContainText("Clock moved forward");
  await kit.show(card.getByTestId("filming-now"));

  await kit.step(pp, "他的手机自己翻到 9月23日 早上 8:44，不用刷新：「早上的药，8:45 提醒你。」");
  await expect(headerOf(pp)).toHaveText("9月23日 周三 · 早上 8:44", { timeout: 10_000 });
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-day", "2026-09-23");
  await expect(pp.getByTestId("dose-headline")).toHaveText("早上的药，8:45 提醒你。");

  await kit.step(dp, "想往回拨到前一天晚上：导演台不让，只能往后拨；要回去就重新铺一场");
  await card.getByTestId("filming-forward-date").fill("2026-09-22");
  await card.getByTestId("filming-forward-time").fill("20:00");
  await card.getByTestId("filming-forward-go").click();
  await expect(status).toHaveText("The clock only moves forward. To go back, lay the account out to a scene again.");
  await expect(card).toHaveAttribute("data-time", "08:44");
  await kit.show(status);
  expect(await mine()).toMatchObject({ date: "2026-09-23", time: "08:44" });
  await card.getByTestId("filming-forward-date").fill("");

  // ---- the 8:45 reminder
  await kit.step(dp, "8:45 导演点「弹提醒」：记下早上的第一次提醒，和定时任务发的一样");
  await card.getByTestId("filming-plus-1").click();
  await expect(card).toHaveAttribute("data-time", "08:45");
  await card.getByTestId("filming-reminder").click();
  await expect(status).toContainText("Reminder recorded: the morning medicine, first reminder.");
  await kit.show(status);
  const push = (await (await elder.context.request.get("/api/push")).json()) as { recent: { kind: string; slot: string; date: string }[] };
  expect(push.recent.map((r) => `${r.kind}:${r.slot}:${r.date}`)).toEqual(["dose_first:morning:2026-09-23"]);

  // his phone was open on Today at 8:44: the move to 8:45 refreshed it into the reminder by itself (no second visit, so
  // her clip plays once); the lock-screen banner is drawn by the recorder (push is track I's)
  await kit.showNotification(pp, { title: "早上的药", body: "还没记", app: "Ripple", time: "8:45" });
  await kit.step(pp, "他的手机自己到了 8:45 的提醒：药在最上面，女儿录的提醒自己播出来（代录音）");
  await expect(pp.getByTestId("dose-headline")).toHaveAttribute("data-why", "due");
  await expect(pp.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await expect(headerOf(pp)).toHaveText("9月23日 周三 · 早上 8:45");
  await expect(pp.getByTestId("her-words")).toHaveText("「爸，早餐吃了吗？药记得吃哦。」");
  await expect(pp.getByTestId("her-reminder")).toContainText("代录音");
  const clip = await kit.waitForAudio("/api/reminders/");
  expect(clip.phone).toBe("elder");
  await kit.waitForAudio("/api/reminders/", { until: "ended", timeout: 15_000 });

  // ---- no reply
  await kit.step(dp, "他一直没回：导演点「模拟没回」，钟走到 9:46，这一格记成「没回」");
  await card.getByTestId("filming-no-reply").click();
  await expect(status).toContainText("No reply recorded for the morning medicine (the clock moved to 09:46");
  await expect(card).toHaveAttribute("data-time", "09:46");
  await kit.show(status);
  expect(await doses(30)).toEqual(["30:unconfirmed:no_reply"]);

  await pp.goto("/p/today");
  await kit.step(pp, "他的手机：「早上的药，到 9:45 还没记。」，「吃了」「还没吃」照样能补记");
  await expect(headerOf(pp)).toHaveText("9月23日 周三 · 早上 9:46");
  await expect(pp.getByTestId("dose-headline")).toHaveAttribute("data-why", "closed");
  await expect(pp.getByTestId("dose-headline")).toHaveText("早上的药，到 9:45 还没记。");
  await expect(pp.getByTestId("dose-taken")).toBeVisible();

  // C2-PENDING(D): once the invitation flow (/invite, /p/family) is on c2-real, link Wei Ling here and show her alert on
  // a third screen; the alert itself is covered by tests/unit/crew/filming-account.test.ts ("her alert ...").
  await kit.step(dp, "女儿没有收到「没回」通知：这个账号还没有家属授权（邀请那一步 D 线还没合进来）");
  await expect(status).toContainText("No family member is linked to this account, so nobody was told.");

  // ---- he logs it late: his answer carries the story's time (the real clock says 3pm)
  await kit.step(pp, "他想起来了，补点「吃了」：记下的是故事里的 9:46，不是真实的下午 3 点");
  await pp.getByTestId("dose-taken").click();
  await expect(pp.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(pp.getByTestId("dose-done")).toContainText("早上 9:46 吃的。");
  await expect(pp.getByTestId("undo-toast")).toContainText("已记下：吃了");
  const late = await elder.context.request.get("/api/doses?from=30&to=30");
  expect(((await late.json()) as { doses: { state: string; created_at: string }[] }).doses.map((d) => `${d.state}@${d.created_at}`)).toEqual([
    "taken@2026-09-23T01:46:00.000Z",
  ]);
  await kit.pause(1500);

  // ---- skipped days
  await kit.step(dp, "导演一下拨过两天半，到 9月26日 早上 8:40：跳过的日子不补记「没回」");
  await card.getByTestId("filming-forward-date").fill("2026-09-26");
  await card.getByTestId("filming-forward-time").fill("08:40");
  await card.getByTestId("filming-forward-go").click();
  await expect(card).toHaveAttribute("data-date", "2026-09-26");
  await kit.show(card.getByTestId("filming-now"));
  const tick = await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } });
  expect(tick.status()).toBe(200);
  expect(await doses(31, 33)).toEqual([]);

  await pp.goto("/p/today");
  await kit.step(pp, "他的手机：9月24、25 日没有一条「没记」，今天早上照常 8:45 提醒");
  await expect(headerOf(pp)).toHaveText("9月26日 周六 · 早上 8:40");
  await expect(pp.getByTestId("dose-headline")).toHaveText("早上的药，8:45 提醒你。");
  await expect(pp.getByTestId("dose-row-yesterday-morning")).toHaveCount(0);

  // ---- an ordinary account: never the crew's
  await kit.step(dp, "李先生的普通账号没标成拍摄账号：导演台的名单里没有它，按编号硬改也回 404");
  const lee = await request.get("/api/crew/filming-account", { headers: CREW_HEADERS });
  expect(lee.status()).toBe(200);
  const leeRef = ((await lee.json()) as { ref: string; filming: boolean }).ref;
  expect((await request.get("/api/crew/filming-account")).status()).toBe(404);
  const list = (await (await director.context.request.get("/api/crew/filming-account/accounts")).json()) as { accounts: { ref: string }[] };
  expect(list.accounts.map((a) => a.ref)).toContain(me.ref);
  expect(list.accounts.map((a) => a.ref)).not.toContain(leeRef);
  for (const body of [{ action: "seed", scene: "d29-hero" }, { action: "forward", minutes: 60 }, { action: "no_reply" }, { action: "end" }]) {
    const r = await director.context.request.post(`/api/crew/filming-account/accounts/${leeRef}`, { data: body });
    expect(r.status(), body.action).toBe(404);
  }
  expect(await (await request.get("/api/me")).json()).toMatchObject({ scope: { today: "2026-10-12" } });
  await dp.getByTestId("filming-reload").click();
  await expect(dp.getByTestId("filming-accounts").locator("article")).toHaveCount(list.accounts.length);
  await expect(dp.getByTestId(`filming-account-${leeRef}`)).toHaveCount(0);
  await kit.show(card);

  // ---- end filming
  await kit.step(dp, "导演点「结束拍摄」：账号回到真实日期，不再是拍摄账号");
  await card.getByTestId("filming-end").click();
  await expect(status).toContainText("Filming ended: the account is back on its real date (Mon 12 Oct 2026 · 3:00pm)");
  await kit.show(status);
  expect(await mine()).toEqual({ filming: false, ref: me.ref, date: "2026-10-12", time: "15:00" });

  await pp.goto("/p/today");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-day", "2026-10-12");
  const after = await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } });
  expect(after.status()).toBe(200);
  await kit.step(pp, "他的手机回到 10月12日 周一：拍摄期间跳过的日子没有一条「没回」");
  await expect(headerOf(pp)).toHaveText("10月12日 周一 · 下午 3:00");
  expect(await doses(33, 49)).toEqual([]);
  await expect(dp.getByTestId(`filming-account-${me.ref}`)).toHaveCount(0, { timeout: 8000 });

  await kit.finish();
});
