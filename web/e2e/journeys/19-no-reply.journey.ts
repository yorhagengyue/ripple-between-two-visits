/**
 * 19 女儿：爸爸没回提醒时收到通知 (C2 track D; real-app 2.24 两次没回, 3.10 「两次没回」推送; the daughter brief B2, B5,
 * D1-D3). Two phones: 陈先生的手机 (his account, Mr Tan's example data) and 女儿的手机 (her account, confirmed, with 「每天
 * 吃药了没有」 and 「两次提醒没回时通知她」 on, Dad's number saved on her phone). A Thursday morning; the jobs run once at
 * each reminder time (JOBS=1 is off on a track's server: POST /api/dev/tick).
 *
 *   8:30   her home: 「早上的药 8:45 提醒他。」
 *   8:45   his phone gets the reminder; he leaves the phone on the table. Her home: 「刚提醒过爸爸，还没回。」
 *   9:15   the second reminder; still no answer
 *   9:45   the window closes: logged as 「没回」 and her phone is told (the notice is drawn on her screen until track I's
 *          web push lands): 「爸爸还没回早上的药」, no medicine named. Her home turns amber with one action, the call;
 *          「看今天早上」 shows the morning as a timeline and his last entry; 「打电话给爸爸」 dials the number she saved
 *   10:02  he answers after her call: 「吃了」. Her screen calms down by itself: 「爸爸 10:02 吃了早上的药。」
 */
import { expect, journey } from "./_kit";
import { clearClock, herView, linkFamily, newAccount, setClock, setSwitches, tick } from "./_d/family";

journey("19 女儿：爸爸没回提醒时收到通知", async ({ kit, request }) => {
  await setClock(request, "2026-10-15T07:30:00+08:00");
  try {
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    const pp = elder.page;
    const dp = daughter.page;
    await newAccount(elder, { space: "example", displayName: "陈先生", prefix: "tan" });
    await newAccount(daughter, { space: "none", displayName: "Wei Ling", prefix: "wl" });
    const linkId = await linkFamily(elder.context, daughter.context);
    await setSwitches(elder.context, linkId, { dose_summary: true, no_reply_alert: true, bp_summary: true });
    await setClock(request, "2026-10-15T08:30:00+08:00");
    await dp.goto(`/f?link=${linkId}`);
    await dp.evaluate((id) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
    }, linkId);
    await dp.reload();
    await pp.goto("/p/today");
    const herHome = async () => {
      await dp.goto(`/f?link=${linkId}`);
      await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
    };

    await kit.step(dp, "周四早上 8:30，Wei Ling 在上班路上看一眼：早上的药 8:45 提醒他");
    await expect(dp.getByTestId("family-headline")).toHaveText("早上的药 8:45 提醒他。");

    // 8:45 the first reminder
    await setClock(request, "2026-10-15T08:45:00+08:00");
    await tick(request);
    await kit.step(pp, "8:45，陈先生的手机来了提醒。他出门了，手机留在桌上");
    await kit.showNotification(pp, { title: "Ripple", body: "早上的药，还没记", time: "8:45" });
    await pp.goto("/p/today");
    await expect(pp.getByTestId("dose-actions")).toBeVisible();
    await kit.pause(1200);

    await kit.step(dp, "她那边：刚提醒过爸爸，还没回");
    await herHome();
    await expect(dp.getByTestId("family-headline")).toHaveText("刚提醒过爸爸，还没回。");
    await expect(dp.getByTestId("family-timeline")).toContainText("8:45");

    // 9:15 the second reminder
    await setClock(request, "2026-10-15T09:15:00+08:00");
    await tick(request);
    await kit.step(pp, "9:15 又提醒了一次，还是没有人点");
    await kit.showNotification(pp, { title: "Ripple", body: "早上的药，还没记", time: "9:15" });
    await kit.pause(1500);

    // 9:45 the window closes: no reply, she is told
    await setClock(request, "2026-10-15T09:45:00+08:00");
    const run = (await tick(request)) as { reports: { job: string; outcome: string }[] };
    expect(run.reports.find((r) => r.job === "daily.doses")?.outcome).toBe("ran");
    // the job's counts cover every account on this server: what this journey checks is her own link's alert
    const told = await herView(daughter.context, linkId);
    expect((told.body.noReply as { sentAt: string | null } | null)?.sentAt).toBeTruthy();
    await kit.step(dp, "9:45 记成「没回」。她的手机收到一条通知，没有写药名（推送画在画面上）");
    await kit.showNotification(dp, { title: "Ripple", body: "爸爸还没回早上的药", time: "9:45" });
    await kit.pause(1800);

    await kit.step(dp, "她点开通知：首页变成琥珀色，只有一个主按钮「打电话给爸爸」");
    await herHome();
    await expect(dp.getByTestId("home-no-reply")).toBeVisible();
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸还没回早上的药。");
    await expect(dp.locator('[data-variant="warn"]')).toHaveCount(1);
    await expect(dp.locator('[data-variant="primary"]')).toHaveCount(0);

    await kit.step(dp, "她点「看今天早上」：8:45、9:15 两次提醒都没有回，9:45 记成「没回」并告诉她");
    await dp.getByTestId("home-no-reply-open").click();
    await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "no_reply");
    const lines = dp.getByTestId("family-timeline").locator("li");
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toContainText("8:45");
    await expect(lines.nth(0)).toContainText("没有回");
    await expect(lines.nth(1)).toContainText("9:15");
    await expect(lines.nth(2)).toContainText("记成「没回」，告诉你");
    await expect(dp.getByTestId("no-reply-last")).toContainText("他上一次记录");

    await kit.step(dp, "下面写着：Ripple 不会替他记药，也不会一直响。要不要打电话，她来决定");
    await expect(dp.locator("body")).toContainText("Ripple 不会替他记药，也不会一直响。");
    await expect(dp.getByTestId("call-dad")).toHaveAttribute("href", "tel:+6500000000");

    await kit.step(dp, "她点「打电话给爸爸」，手机拨出她存好的号码");
    await dp.getByTestId("call-dad").hover();
    await kit.pause(1200);

    // 10:02 he answers after the call
    await setClock(request, "2026-10-15T10:02:00+08:00");
    await kit.step(pp, "10:02，陈先生接了电话，回来在今天页补点「吃了」");
    await pp.goto("/p/today");
    await expect(pp.getByTestId("dose-actions")).toBeVisible();
    await pp.getByTestId("dose-taken").click();
    await expect(pp.getByTestId("dose-done")).toBeVisible();

    await kit.step(dp, "她那一屏自己安静下来：爸爸 10:02 吃了早上的药，时间线多了一行");
    await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "answered", { timeout: 15_000 });
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸 10:02 吃了早上的药。");
    await expect(dp.getByTestId("family-timeline")).toContainText("他补记了「吃了」");
    await kit.finish();
  } finally {
    await clearClock(request);
  }
});
