/**
 * 20 女儿：被撤回授权 (C2 track D; real-app 2.22 「他『停止分享给她』：点完立刻生效…她开着的页面 1 秒内显示『爸爸已经停止
 * 分享』，事件流断开，之后的请求一律 403」; the daughter brief H1; the elder brief 16-20 item 5). Two phones: 陈先生的手机 (his
 * account, Mr Tan's example data) and 女儿的手机 (her account, confirmed, three items shared, Dad's number saved), Friday
 * evening; he took his morning medicine at 8:50 (set up before the first step, not recorded).
 *
 *   her home is open, live
 *   he opens her page on his phone: what she sees, when she looked, and 「停止分享给 Wei Ling」
 *   one tap: his phone says it has stopped; her open page shows 「爸爸停止了分享。」 within a second (both pages time it),
 *   her live stream has ended, and her next request is refused (403 link_not_active). She keeps 「打电话给爸爸」, and
 *   「我的」 at the top right: her own account's rows (name, password, devices, recovery code, log out, delete)
 *   his family list says sharing stopped, and he can invite her again
 */
import { expect, journey } from "./_kit";
import { clearClock, herView, linkFamily, newAccount, seenAt, setClock, setSwitches, tappedAt, watchFor, watchTap } from "./_d/family";

journey("20 女儿：被撤回授权", async ({ kit, request }) => {
  await setClock(request, "2026-10-16T07:30:00+08:00");
  try {
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    const pp = elder.page;
    const dp = daughter.page;
    await newAccount(elder, { space: "example", displayName: "陈先生", prefix: "tan" });
    await newAccount(daughter, { space: "none", displayName: "Wei Ling", prefix: "wl" });
    const linkId = await linkFamily(elder.context, daughter.context);
    await setSwitches(elder.context, linkId, { dose_summary: true, bp_summary: true, questions_count: true });
    // the morning: he taps 「吃了」 at 8:50; then the evening
    await setClock(request, "2026-10-16T08:50:00+08:00");
    await pp.goto("/p/today");
    await expect(pp.getByTestId("dose-actions")).toBeVisible();
    await pp.getByTestId("dose-taken").click();
    await expect(pp.getByTestId("dose-done")).toBeVisible();
    await setClock(request, "2026-10-16T19:40:00+08:00");
    await dp.goto(`/f?link=${linkId}`);
    await dp.evaluate((id) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
    }, linkId);
    await dp.reload();
    await pp.goto(`/p/family/${linkId}`);

    await kit.step(dp, "周五晚上，Wei Ling 的首页开着：爸爸早上 8:50 吃了药；这一周、量血压的次数、要问医生的问题");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸 8:50 吃了早上的药。");
    await expect(dp.getByTestId("week-strip")).toBeVisible();
    await expect(dp.locator("body")).toContainText("这周量血压");

    await kit.step(pp, "陈先生打开 Wei Ling 那一页：她能看到的三项开着，下面记着她最近一次什么时候看过");
    await expect(pp.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
    await expect(pp.locator('[data-grant="dose_summary"] [role="switch"]')).toHaveAttribute("aria-checked", "true");
    await pp.reload();
    // (the timeline draft: the list of her looks is a screen of its own, journey 17 opens it; her latest look stays here)
    await expect(pp.getByTestId("last-look")).toHaveText("Wei Ling 最近一次看：今天 19:40");

    // (the timeline draft's 20-1: stopping has a screen of its own, one tap from her page)
    await kit.step(pp, "他想停一阵。往下点「停止分享给 Wei Ling」，到停止那一屏：一下就停，之后可以再邀请她");
    await pp.getByTestId("link-stop").click();
    await kit.show(pp.getByTestId("stop-sharing"));
    await watchTap(pp, "stop", '[data-testid="stop-sharing"]');
    await watchFor(dp, "ended", '[data-testid="family-app"][data-state="ended"]');
    await pp.getByTestId("stop-sharing").click();
    await expect(pp.getByTestId("page-family-link")).toHaveAttribute("data-state", "revoked");
    const lag = (await seenAt(dp, "ended")) - (await tappedAt(pp, "stop"));
    expect(lag).toBeLessThan(1000);

    await kit.step(dp, `她那边 ${Math.max(1, Math.round(lag))} 毫秒就变了：爸爸停止了分享，她看不到他的记录了`);
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸停止了分享。");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-ended", "patient");
    await expect(dp.getByTestId("week-strip")).toHaveCount(0);
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "closed");

    await kit.step(dp, "连接已经断开，再要数据一律被拒；留下「打电话给爸爸」，和右上角的「我的」");
    const after = await herView(daughter.context, linkId);
    expect(after.status).toBe(403);
    expect(after.body).toEqual({ error: "link_not_active" });
    const stream = await daughter.context.request.get(`/api/events?link=${linkId}`);
    expect(stream.status()).toBe(403);
    await expect(dp.getByTestId("call-dad")).toHaveAttribute("href", "tel:+6500000000");

    // (the v3 draft's H1 keeps 「我的」: her own account needs no link in force)
    await kit.step(dp, "她自己的账号还在。点「我的」：名字、改密码、登录和设备、换恢复码、退出、删除账号；和爸爸有关的几行不在了");
    await dp.getByTestId("open-me").click();
    await expect(dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸停止了分享。");
    for (const row of ["me-name", "me-password", "me-devices", "me-recovery", "me-logout", "me-delete"]) await expect(dp.getByTestId(row), row).toBeVisible();
    for (const row of ["me-notifications-open", "me-phone", "open-facts", "me-leave-open"]) await expect(dp.getByTestId(row), row).toHaveCount(0);
    await kit.pause(1500); // her page stays under its own caption for a moment

    await kit.step(pp, "陈先生这边：已经停止分享。想让她再看，可以重新邀请她");
    await expect(pp.locator("body")).toContainText("Wei Ling 现在看不到你的任何记录");
    await expect(pp.getByTestId("invite-again")).toBeVisible();

    await kit.step(pp, "家人列表里写着「已停止分享」");
    await pp.goto("/p/family");
    await expect(pp.getByTestId("page-family")).toHaveAttribute("data-state", "none");
    await expect(pp.locator("body")).toContainText("已停止分享");
    await kit.finish();
  } finally {
    await clearClock(request);
  }
});
