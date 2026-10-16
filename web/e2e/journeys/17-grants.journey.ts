/**
 * 17 女儿：只看到爸爸打开的项 (C2 track D; real-app 2.21, 2.22; the daughter brief B, C1, F1, F2; the elder brief 16-20
 * items 1 and 4). Two phones side by side: 陈先生的手机 (his account, Mr Tan's example data) and 女儿的手机 (her account,
 * already confirmed by him), on a Tuesday at 8:20 before the morning reminder.
 *
 *   her home starts empty: every switch is off
 *   he switches on 「每天吃药了没有」: her week appears within a second (both pages time it), the big sentence says
 *   when the reminder comes; 「这周量了几次血压」: a count, never a reading (her raw answer holds no numbers of his)
 *   she opens 「爸爸让你看到的」: two items on, four 「没有分享」
 *   he switches on his notes: a quiet line on her home says so and the row appears; she reads them; he switches them
 *   off: gone (her view no longer holds them)
 *   her week, day by day: one state per day, no medicine names (the v3 draft's C1)
 *   his page: when she looked, item by item, and every change of the switches
 */
import { expect, journey } from "./_kit";
import { clearClock, herView, linkFamily, newAccount, seenAt, setClock, tappedAt, watchFor, watchTap } from "./_d/family";

journey("17 女儿：只看到爸爸打开的项", async ({ kit, request }) => {
  await setClock(request, "2026-10-13T08:20:00+08:00");
  try {
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    const pp = elder.page;
    const dp = daughter.page;
    await newAccount(elder, { space: "example", displayName: "陈先生", prefix: "tan" });
    await newAccount(daughter, { space: "none", displayName: "Wei Ling", prefix: "wl" });
    const linkId = await linkFamily(elder.context, daughter.context);
    await dp.goto(`/f?link=${linkId}`);
    await dp.evaluate((id) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
    }, linkId);
    await dp.reload();
    await pp.goto(`/p/family/${linkId}`);
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");

    await kit.step(dp, "Wei Ling 的首页：爸爸还没有打开任何一项，这里什么都没有");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸还没有打开任何一项。");

    await kit.step(pp, "陈先生在 Wei Ling 的「家人能看到什么」里打开「每天吃药了没有」");
    await watchTap(pp, "dose", '[data-grant="dose_summary"] [role="switch"]');
    await watchFor(dp, "week", '[data-testid="week-strip"]');
    await pp.locator('[data-grant="dose_summary"] [role="switch"]').click();
    await expect(pp.locator('[data-grant="dose_summary"] [role="switch"]')).toHaveAttribute("aria-checked", "true");
    const lag = (await seenAt(dp, "week")) - (await tappedAt(pp, "dose"));
    expect(lag).toBeLessThan(1000);

    await kit.step(dp, `她那边 ${Math.max(1, Math.round(lag))} 毫秒就出现了：这一周七个圆点，形状和颜色一起说吃了没有`);
    await expect(dp.getByTestId("week-strip").locator("li")).toHaveCount(7);
    await expect(dp.getByTestId("family-headline")).toHaveText("早上的药 8:45 提醒他。");
    await expect(dp.getByTestId("week-summary")).toContainText("天里吃了");

    await kit.step(pp, "他再打开「这周量了几次血压」");
    await pp.locator('[data-grant="bp_summary"] [role="switch"]').click();
    await expect(pp.locator('[data-grant="bp_summary"] [role="switch"]')).toHaveAttribute("aria-checked", "true");

    await kit.step(dp, "她只看到量了几次，看不到读数");
    await expect(dp.locator("body")).toContainText("这周量血压");
    const raw = await herView(daughter.context, linkId);
    expect(raw.status).toBe(200);
    expect(raw.text).not.toMatch(/systolic|diastolic|"reason"|reason_text/);
    expect((raw.body.bp as { count: number }).count).toBeGreaterThanOrEqual(0);

    await kit.step(dp, "她点「爸爸让你看到的」：开着的两项打勾，其余四项写「没有分享」");
    await dp.getByTestId("open-shared").click();
    await expect(dp.getByTestId("family-shared")).toBeVisible();
    await expect(dp.locator('[data-shared="true"]')).toHaveCount(2);
    await expect(dp.locator('[data-shared="false"]')).toHaveCount(4);
    await expect(dp.getByTestId("shared-items")).toContainText("这些开关只有爸爸能在他的手机上改。");
    await kit.pause(800);
    await dp.getByTestId("family-back").click();
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");

    await kit.step(pp, "陈先生又打开「我自己写的笔记」");
    await pp.locator('[data-grant="notes"] [role="switch"]').click();
    await expect(pp.locator('[data-grant="notes"] [role="switch"]')).toHaveAttribute("aria-checked", "true");

    await kit.step(dp, "她的首页上面安静地多了一行：爸爸刚把「他自己写的笔记」分享给你了，旁边一个「看看」");
    await expect(dp.getByTestId("family-notice")).toContainText("他自己写的笔记");

    await kit.step(dp, "她点「看看」，看到爸爸自己记的话，写着哪天、是打字还是说的");
    await dp.getByTestId("family-notice-open").click();
    await expect(dp.getByTestId("shared-notes")).toBeVisible();
    await expect(dp.getByTestId("shared-note").first()).toBeVisible();
    await kit.pause(900);

    await kit.step(pp, "陈先生想了想，又把笔记关掉");
    await pp.locator('[data-grant="notes"] [role="switch"]').click();
    await expect(pp.locator('[data-grant="notes"] [role="switch"]')).toHaveAttribute("aria-checked", "false");
    const noNotes = await daughter.context.request.get(`/api/family/shared?link=${linkId}`);
    expect(((await noNotes.json()) as { notes?: unknown }).notes).toBeUndefined();

    await kit.step(dp, "她再看就没有了：爸爸还没有分享笔记。分不分享，由爸爸在他的手机上决定");
    await dp.reload();
    await expect(dp.getByTestId("shared-notes")).toHaveCount(0);
    await expect(dp.getByTestId("family-notes")).toHaveAttribute("data-state", "not_shared");
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸还没有分享笔记。");
    await dp.getByTestId("not-shared-home").click();
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");

    await kit.step(dp, "她点「这一周」：每天一行，只写吃了、没吃、没回，不写药名，也不写原因");
    await dp.getByTestId("week-strip").click();
    await expect(dp.getByTestId("day-list").locator("li")).toHaveCount(7);
    await expect(dp.getByTestId("day-list")).toContainText("还没到");
    await expect(dp.getByTestId("day-list")).not.toContainText("Amlodipine");
    await expect(dp.getByTestId("day-list")).not.toContainText("今天早上的药");

    // (the timeline draft's 19-1: her looks and the changes of the switches are a screen of their own, one tap from her page)
    await kit.step(pp, "陈先生点「她什么时候看过」：她什么时候看过，看了哪一项；开关每改一次都记着");
    await pp.getByTestId("link-seen").click();
    await kit.show(pp.getByTestId("access-log"));
    await expect(pp.getByTestId("access-log")).toContainText("你的吃药情况");
    await expect(pp.locator("body")).toContainText("打开了「每天吃药了没有」");
    await expect(pp.locator("body")).toContainText("关掉了「我自己写的笔记」");
    await kit.finish();
  } finally {
    await clearClock(request);
  }
});
