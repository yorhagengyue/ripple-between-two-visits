/**
 * 02 吃药提醒和没吃的原因, on a real account (C2 track B; real-app 2.7, 2.8; e2e-chains chain 1). One phone, his.
 *
 * Setup (not recorded): the developer test clock stands at Mon 12 Oct 2026 10:00 and an account is made with Mr Tan's
 * example data (POST /api/dev/accounts, the phone signed in): breakfast at 08:30, tai chi on Tuesday and Thursday
 * mornings, amlodipine's label says every morning. The jobs run on demand (POST /api/dev/tick) after the clock moves.
 *
 *   Tue 13  08:40  Today: 「早上的药，8:45 提醒你。」, the buttons already work, nothing chosen
 *           08:45  the job sends the first reminder once (the banner is drawn by the recorder: push is track I's);
 *                  the notice opens the slot: her reminder plays by itself (stand-in voice), the medicine, its label
 *                  a tai chi morning: 还没吃, then why, his routine first: 打太极; recorded with his reason
 *   Wed 14  08:52  吃了: 「记好了。早上 8:52 吃的。」 written at 08:52; 撤销 deletes the row; 吃了 again
 *   Thu 15  08:50  等一下: 「好，9:15 再问你。」; 09:15 the second reminder still comes; 吃了 at 09:16
 *   Fri 16         both reminders go out and he opens neither; 09:46 the job settles the cell as no reply:
 *                  「早上的药，到 9:45 还没记。」; 10:20 he logs it late, written at 10:20; the slot folds into one
 *                  line with 「改一下」 once the undo bar is gone
 * Every step checks the screen and the record (GET /api/doses).
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { expect, journey } from "./_kit";

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

async function clock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

/** One pass of the medicine job (every account on the server; the counts are summed). */
async function tick(request: APIRequestContext): Promise<Record<string, number>> {
  const res = await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { reports: { job: string; counts: Record<string, number> }[] };
  return body.reports.find((r) => r.job === "daily.doses")?.counts ?? {};
}

async function doses(context: BrowserContext, day: number) {
  const res = await context.request.get(`/api/doses?from=${day}&to=${day}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { doses: { state: string; reason: string | null; created_at: string }[] }).doses;
}

journey.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

journey("02 吃药提醒和没吃的原因", async ({ kit, request }) => {
  kit.cornerLabel("通知横幅：录屏示意");
  await clock(request, SGT("2026-10-12", "10:00"));
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const ctx = elder.context;
  const made = await ctx.request.post("/api/dev/accounts", { data: { login: `tan${randomUUID().slice(0, 8)}`, password: "a long test password", space: "example" } });
  expect(made.status(), await made.text()).toBe(201);
  // the example's one-time intro was put away earlier (track C's 「知道了」)
  const dismissed = await ctx.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  expect(dismissed.status(), await dismissed.text()).toBe(200);
  const pp = elder.page;
  const headline = pp.getByTestId("dose-headline");
  const done = pp.getByTestId("dose-done");
  const toast = pp.getByTestId("undo-toast");
  const aml = pp.getByTestId("dose-med-med-amlodipine");

  await clock(request, SGT("2026-10-13", "08:40"));
  await pp.goto("/p/today");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-scope", "account");

  await kit.step(pp, "周二 8:40：「今天」页写着早上的药 8:45 提醒他");
  await expect(headline).toHaveAttribute("data-why", "coming");
  await expect(headline).toHaveText("早上的药，8:45 提醒你。");
  // yesterday's window closed before he started: not his, no 「现在记」 row for it
  await expect(pp.getByTestId("dose-row-yesterday-morning")).toHaveCount(0);
  await kit.show(headline);
  await expect(aml).toContainText("Amlodipine 5 mg");
  await expect(aml).toContainText("Take ONE tablet every MORNING");
  await expect(pp.getByTestId("dose-taken")).toBeVisible();
  await expect(pp.getByTestId("dose-taken")).not.toHaveAttribute("aria-pressed", /.*/);
  expect(await doses(ctx, 43)).toEqual([]);

  await kit.step(pp, "8:45 第一次提醒：锁屏只写「早上的药 · 还没记」，不写药名");
  await clock(request, SGT("2026-10-13", "08:45"));
  expect((await tick(request)).first).toBeGreaterThanOrEqual(1);
  expect((await tick(request)).first).toBe(0);
  await kit.showNotification(pp, { title: "早上的药", body: "还没记", app: "Ripple", time: "8:45" });
  await kit.pause(2200);
  await pp.goto("/p/today?remind=dose-morning");

  await kit.step(pp, "点开提醒：药在最上面，女儿录的提醒自己播出来（代录音）");
  await expect(headline).toHaveAttribute("data-why", "remind");
  await expect(headline).toHaveText("早上的药，还没记。");
  await expect(pp.getByTestId("her-words")).toHaveText("「爸，早餐吃了吗？药记得吃哦。」");
  await expect(pp.getByTestId("her-reminder")).toContainText("代录音");
  const clip = await kit.waitForAudio("/api/reminders/");
  expect(clip.phone).toBe("elder");
  await kit.waitForAudio("/api/reminders/", { until: "ended", timeout: 15_000 });

  await kit.step(pp, "今天他要打太极，药还没吃，点「还没吃」");
  await pp.getByTestId("dose-missed").click();
  await expect(pp.getByTestId("dose-reasons")).toBeVisible();
  await expect(toast).toContainText("已记下：还没吃");
  await expect.poll(async () => (await doses(ctx, 43)).map((d) => `${d.state}:${d.reason}`)).toEqual(["missed:null"]);

  await kit.step(pp, "只问原因，不说教：他自己的作息排第一，点「打太极」");
  await expect(pp.getByTestId("dose-reasons").locator("[data-reason]").first()).toHaveAttribute("data-reason", "tai_chi_morning");
  await pp.getByTestId("dose-reasons").locator('[data-reason="tai_chi_morning"]').click();
  await expect(done).toHaveAttribute("data-kind", "missed");
  await expect(done).toContainText("原因：打太极");
  await expect(toast).toContainText("已记下：没吃（打太极）");
  await expect.poll(async () => (await doses(ctx, 43)).map((d) => `${d.state}:${d.reason}`)).toEqual(["missed:tai_chi_morning"]);

  await kit.step(pp, "周三 8:45 又提醒；这次吃了，8:52 点「吃了」");
  await clock(request, SGT("2026-10-14", "08:45"));
  expect((await tick(request)).first).toBeGreaterThanOrEqual(1);
  await kit.showNotification(pp, { title: "早上的药", body: "还没记", app: "Ripple", time: "8:45", durationMs: 2500 });
  await kit.pause(1500);
  await pp.goto("/p/today?remind=dose-morning");
  await expect(headline).toHaveText("早上的药，还没记。");
  await clock(request, SGT("2026-10-14", "08:52"));
  await pp.getByTestId("dose-taken").click();
  await expect(done).toHaveAttribute("data-kind", "taken");
  await expect(done).toContainText("记好了。");
  await expect(done).toContainText("早上 8:52 吃的。");
  await expect(toast).toContainText("已记下：吃了");
  await expect.poll(async () => (await doses(ctx, 44)).map((d) => `${d.state}@${d.created_at}`)).toEqual(["taken@2026-10-14T00:52:00.000Z"]);

  await kit.step(pp, "按错了：底部撤销条留 12 秒，点「撤销」，这条记录就删掉");
  await toast.getByRole("button").click();
  await expect.poll(async () => (await doses(ctx, 44)).length).toBe(0);
  await expect(headline).toHaveText("早上的药，还没记。");

  await kit.step(pp, "再点一次「吃了」：直接记好，没有确认框");
  await pp.getByTestId("dose-taken").click();
  await expect(done).toHaveAttribute("data-kind", "taken");
  await expect.poll(async () => (await doses(ctx, 44)).map((d) => d.state)).toEqual(["taken"]);

  await clock(request, SGT("2026-10-15", "08:50"));
  await pp.goto("/p/today");
  await kit.step(pp, "周四 8:50 他在忙，点「等一下」：9:15 再问他");
  await pp.getByTestId("dose-later").click();
  await expect(done).toHaveAttribute("data-kind", "later");
  await expect(done).toHaveText("好，9:15 再问你。");
  await expect(toast).toContainText("已记下：等一下");
  await expect.poll(async () => (await doses(ctx, 45)).map((d) => `${d.state}:${d.reason}`)).toEqual(["unconfirmed:later"]);

  await kit.step(pp, "9:15 第二次提醒照样来；他点开，记下「吃了」");
  await clock(request, SGT("2026-10-15", "09:15"));
  expect((await tick(request)).second).toBeGreaterThanOrEqual(1);
  await kit.showNotification(pp, { title: "早上的药", body: "还没记", app: "Ripple", time: "9:15", durationMs: 2500 });
  await kit.pause(1500);
  await pp.goto("/p/today?remind=dose-morning");
  await expect(headline).toHaveText("早上的药，还没记。");
  await clock(request, SGT("2026-10-15", "09:16"));
  await pp.getByTestId("dose-taken").click();
  await expect(done).toContainText("早上 9:16 吃的。");
  await expect.poll(async () => (await doses(ctx, 45)).map((d) => d.state)).toEqual(["taken"]);

  await clock(request, SGT("2026-10-16", "08:30"));
  await pp.goto("/p/today");
  await expect(headline).toHaveText("早上的药，8:45 提醒你。");
  await kit.step(pp, "周五他出门了：8:45 和 9:15 两次提醒都没有点开");
  await clock(request, SGT("2026-10-16", "08:45"));
  expect((await tick(request)).first).toBeGreaterThanOrEqual(1);
  await kit.showNotification(pp, { title: "早上的药", body: "还没记", app: "Ripple", time: "8:45", durationMs: 2500 });
  await kit.pause(3000);
  await clock(request, SGT("2026-10-16", "09:15"));
  expect((await tick(request)).second).toBeGreaterThanOrEqual(1);
  await kit.showNotification(pp, { title: "早上的药", body: "还没记", app: "Ripple", time: "9:15", durationMs: 2500 });
  await kit.pause(3000);
  expect(await doses(ctx, 46)).toEqual([]);

  // the job settles the window at 09:45; the screen he opens next shows it (the caption comes with that screen)
  await clock(request, SGT("2026-10-16", "09:46"));
  expect((await tick(request)).settled).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await doses(ctx, 46)).map((d) => `${d.state}:${d.reason}`)).toEqual(["unconfirmed:no_reply"]);
  await pp.goto("/p/today");
  await expect(headline).toHaveAttribute("data-why", "closed");
  await expect(headline).toHaveText("早上的药，到 9:45 还没记。");
  await expect(pp.getByTestId("dose-taken")).toBeVisible();
  await expect(pp.getByTestId("dose-later")).toHaveCount(0);
  await kit.step(pp, "9:45 窗口关了还没有回答：服务端记成「没回」，「吃了」「还没吃」照样能点");

  await kit.step(pp, "10:20 他想起来补记「吃了」：记下的时间是 10:20");
  await clock(request, SGT("2026-10-16", "10:20"));
  await pp.getByTestId("dose-taken").click();
  await expect(done).toContainText("早上 10:20 吃的。");
  await expect.poll(async () => (await doses(ctx, 46)).map((d) => `${d.state}@${d.created_at}`)).toEqual(["taken@2026-10-16T02:20:00.000Z"]);
  await expect(toast).toHaveCount(0, { timeout: 16_000 });

  await kit.step(pp, "撤销条收起后，今天的药收成一行，旁边一个「改一下」");
  await expect(headline).toHaveText("今天的药都记好了。");
  const row = pp.getByTestId("dose-row-morning");
  await expect(row).toHaveAttribute("data-state", "taken");
  await expect(pp.getByTestId("dose-section")).toContainText("早上 · 10:20 记的");
  await expect(pp.getByTestId("dose-section").getByRole("link", { name: "改一下" })).toBeVisible();
  await kit.pause(1500);

  await kit.finish();
});
