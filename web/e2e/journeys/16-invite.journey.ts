/**
 * 16 女儿：被邀请和接受 (C2 track D; real-app 2.19, 2.20; the daughter brief A1-A4; the elder brief 16-20 items 2, 3).
 * Two phones side by side: 陈先生的手机 (his real account, Mr Tan's example data) and 女儿的手机 (not signed in).
 *
 *   his phone    「家人」 empty → 邀请家人: her name, daughter, what she calls him → the one-time link (7 days),
 *                for WhatsApp
 *   her phone    opens the link: 「爸爸邀请你看他的 Ripple」, what she will see once he switches it on, what stays hidden
 *                → 接受 → her short sign-up (name, account, password, the terms) → her recovery code once → accepted:
 *                「已经告诉爸爸了，等他在手机上确认是你。」 — she sees nothing (her view answers 403)
 *   his phone    「Wei Ling 接受了邀请，是她吗？」 with her name and account → 是她 → her switches, all six off
 *   her phone    follows by itself: the three first-visit steps (Dad's number kept on her phone, notifications, the
 *                Home Screen) → her home: 「爸爸还没有打开任何一项。」
 *
 * Notifications go through the whole chain (track I's enablePush from her tap, /sw.js, POST /api/push/subscribe, the
 * server's Web Push): only the push service stands in (tests/support/push-service.ts; headless Chromium has none) and
 * the browser's own question is answered 「允许」 by the test. 「通知已经开好了」 is drawn on her phone when her service
 * worker shows it (public/sw.js "rp:push-shown").
 *
 * Run: the server on this track's port with RIPPLE_DEV_TOOLS=1 (scripts/record/serve.mjs), then
 * `node scripts/record/run.mjs 16 --base-url http://localhost:3540`.
 */
import { startPushService } from "../../tests/support/push-service";
import { answerPermissionPrompt, deliverToServiceWorker, listenForShownPushes, stubPushSubscription } from "../push-helpers";
import { expect, journey } from "./_kit";
import { clearClock, herView, newAccount, setClock } from "./_d/family";

journey("16 女儿：被邀请和接受", async ({ kit, request, baseURL }) => {
  await setClock(request, "2026-10-12T19:30:00+08:00");
  const service = await startPushService();
  try {
    kit.cornerLabel("推送服务：本机替身");
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    const pp = elder.page;
    const dp = daughter.page;
    // her phone: the push service's subscription, the browser's question answered 「允许」, what arrives handed to her
    // service worker, and what it shows drawn on her screen
    const herSub = service.newPhone({ label: "女儿的手机" });
    await daughter.context.grantPermissions(["notifications"], { origin: new URL(baseURL ?? "http://localhost:3540").origin });
    await stubPushSubscription(daughter.context, herSub);
    await answerPermissionPrompt(daughter.context, "granted");
    service.onMessage(async (m) => {
      if (m.phone === herSub.id && m.text) await deliverToServiceWorker(dp, m.text);
    });
    const herShown = await listenForShownPushes(daughter.context, async (n, page) => {
      await kit.showNotification(page, { title: n.title, body: n.body });
    });
    await newAccount(elder, { space: "example", displayName: "陈先生", prefix: "tan" });
    const login = `weiling${Math.floor(1000 + Math.random() * 9000)}`;
    await pp.goto("/p/family");
    // her phone before she opens the link: a dark screen (her side is dark), not a white blank page
    await dp.setContent('<html><body style="margin:0;background:#05070A"></body></html>');

    // ------------------------------------------------------------ his invitation
    await kit.step(pp, "陈先生打开「家人」：还没有邀请家人");
    await expect(pp.getByTestId("page-family")).toHaveAttribute("data-state", "none");
    await expect(pp.locator("body")).toContainText("还没有邀请家人");

    await kit.step(pp, "他点「邀请家人」，写上女儿的名字 Wei Ling");
    await pp.getByTestId("family-invite").click();
    await expect(pp.getByTestId("invite-form")).toBeVisible();
    await kit.type(pp.getByTestId("invite-name"), "Wei Ling");
    await expect(pp.locator('[data-testid="invite-relation"] [data-choice="daughter"]')).toHaveAttribute("aria-checked", "true");

    await kit.step(pp, "她是女儿，叫他「爸爸」。他点「做一个邀请链接」");
    await pp.getByTestId("invite-make").click();
    const made = pp.getByTestId("invite-made");
    await expect(made).toBeVisible();
    const url = (await made.getAttribute("data-url"))!;
    const linkId = (await made.getAttribute("data-link"))!;
    expect(url).toMatch(/\/invite\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    await expect(pp.getByTestId("invite-whatsapp")).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\?text=.*${encodeURIComponent("邀请你看他的 Ripple")}`));
    await expect(made).toContainText("7 天内有效，只能用一次");

    await kit.step(pp, "链接用 WhatsApp 发给女儿：一次性，7 天内有效");
    await kit.pause(1200);

    // ------------------------------------------------------------ her side: the invitation
    await kit.step(dp, "Wei Ling 在自己的手机上点开链接：爸爸邀请你看他的 Ripple");
    await dp.goto(new URL(url).pathname);
    await expect(dp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸邀请你看他的 Ripple");
    await expect(dp.getByTestId("invite-sees").locator("li")).toHaveCount(6);
    await expect(dp.locator("body")).toContainText("读数、问题的内容、他的笔记和看诊录音，他不打开就不会给你看。");

    await kit.step(dp, "她能看到什么，每一项都要等爸爸打开；读数和笔记默认不给看");
    await kit.show(dp.getByTestId("invite-sees"));
    await kit.pause(800);

    await kit.step(dp, "她点「接受」，建一个账号：名字、账号、密码");
    await dp.getByTestId("invite-accept").click();
    await expect(dp.getByTestId("her-signup")).toBeVisible();
    await kit.type(dp.getByTestId("her-name"), "Wei Ling");
    await kit.type(dp.getByTestId("her-login"), login);
    await kit.type(dp.getByTestId("her-password"), "jasmine tea 88");

    await kit.step(dp, "勾上「我同意」，点「建好账号」");
    await dp.getByTestId("her-agree").check();
    await dp.getByTestId("her-signup-submit").click();
    await expect(dp.getByTestId("her-code-value")).toHaveText(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    // the code is shown this once: nothing on this screen may load the page again (no way back, no language switch)
    await expect(dp.getByTestId("family-back")).toHaveCount(0);
    await expect(dp.locator('a[href*="/api/profile/lang"]')).toHaveCount(0);

    await kit.step(dp, "账号建好了，恢复码只显示这一次。她抄好，接受爸爸的邀请");
    await kit.pause(900);
    await dp.getByTestId("her-code-done").click();
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "waiting");
    await expect(dp.getByTestId("family-headline")).toHaveText("已经告诉爸爸了，等他在手机上确认是你。");

    await kit.step(dp, "接受了，但爸爸确认以前，她什么都看不到");
    const before = await herView(daughter.context, linkId);
    expect(before.status).toBe(403);
    expect(before.body).toEqual({ error: "link_not_active" });

    // ------------------------------------------------------------ his confirmation
    await kit.step(pp, "陈先生回到「家人」：Wei Ling 接受了邀请，是她吗？下面写着她的名字和账号");
    await pp.getByTestId("invite-back").click();
    await expect(pp.getByTestId("page-family")).toHaveAttribute("data-state", "confirm");
    await expect(pp.locator("body")).toContainText("Wei Ling 接受了邀请，是她吗？");
    await expect(pp.locator("body")).toContainText(login);
    await expect(pp.locator("body")).toContainText("你点「是她」以前，她什么都看不到。");

    await kit.step(pp, "账号对得上，是女儿。他点「是她」");
    await pp.getByTestId("confirm-yes").click();
    await expect(pp.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
    const switches = pp.getByTestId("link-switches").locator('[role="switch"]');
    await expect(switches).toHaveCount(6);
    for (let i = 0; i < 6; i++) await expect(switches.nth(i)).toHaveAttribute("aria-checked", "false");

    // ------------------------------------------------------------ her first visit
    await kit.step(dp, "她的手机自己跟着变：第一次进来，先存爸爸的电话，只存在她的手机上");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-1", { timeout: 8000 });
    await kit.type(dp.getByTestId("phone-input"), "+65 0000 0000");
    await dp.getByTestId("phone-save").click();

    await kit.step(dp, "打开通知：爸爸两次提醒都没回时，她的手机会收到一条。她点「打开通知」，服务器马上推来一条试试");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-2");
    const since = Date.now();
    const welcome = service.next(herSub.id, 20_000);
    await dp.getByTestId("push-on").click();
    const w = await welcome;
    expect(w.status).toBe(201);
    expect(w.payload).toMatchObject({ kind: "welcome", title: "通知已经开好了" });
    await herShown.next({ since, timeoutMs: 15_000 });
    await expect(dp.getByTestId("push-state")).toHaveAttribute("data-state", "on");
    await kit.pause(1500);
    await dp.getByTestId("push-next").click();

    await kit.step(dp, "在 iPhone 上要加到主屏，才收得到通知");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-3");
    await expect(dp.getByTestId("welcome-home-steps").locator("li")).toHaveCount(3);
    await dp.getByTestId("welcome-done").click();

    await kit.step(dp, "她的首页：爸爸还没有打开任何一项。这里只会出现他打开的");
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸还没有打开任何一项。");
    await expect(dp.getByTestId("week-strip")).toHaveCount(0);
    const after = await herView(daughter.context, linkId);
    expect(after.status).toBe(200);
    expect(Object.values(after.body.grants as Record<string, boolean>).every((v) => v === false)).toBe(true);
    expect(after.text).not.toMatch(/systolic|diastolic|"reason"/);

    await kit.step(pp, "陈先生这边：Wei Ling 能看到什么，六项都关着，每项写清楚她会看到什么");
    await kit.show(pp.getByTestId("link-switches"));
    await expect(pp.getByTestId("link-switches")).toContainText("只有吃了、没吃、没回，没有原因");
    await kit.finish();
  } finally {
    await service.close();
    await clearClock(request);
  }
});
