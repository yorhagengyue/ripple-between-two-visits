/**
 * 02 吃药提醒的推送 (track I; real-app 2.6, 2.7, 2.24, 8.10): the push steps of journeys 02 and 19, on real accounts.
 *
 *   1. He turns reminders on with one tap (「开提醒」): the phone's question is answered 「允许」, /sw.js registers, the phone
 *      subscribes with the server's VAPID key, and 「提醒已经开好了」 arrives through the whole chain. He invites Wei Ling
 *      and she accepts: 「Wei Ling 已经接受」 reaches his phone (nothing clinical on the lock screen), his tap lands on
 *      the confirm card on 「家人」 and is recorded; he confirms her. Wei Ling turns notifications on on her side (track
 *      D's 「打开通知」 on her 「我」 page): 「通知已经开好了」.
 *   2. 08:45 the scheduled job (track B's daily.doses, POST /api/dev/tick) sends the first reminder through track I's
 *      sender; 09:15 the second, with the same tag, replaces it on the phone (one notification left). The lock screen
 *      says 「早上的药」「还没记」, never a medicine name; checked on the payload the push service opened.
 *   3. He taps it: Today opens on the morning card and Wei Ling's reminder plays (her clip, into the mp4); the tap is
 *      written as opened_at on that reminder.
 *   4. 09:45 no answer: with his switch 「两次提醒没回时通知她」 off nothing reaches her phone; he switches it on (track D's
 *      page), the next pass tells her: 「爸爸还没回早上的药」 on her lock screen; her tap opens her home, amber, with the
 *      one action 「打电话给爸爸」, and is recorded on that alert (opened_at, through her link).
 *
 * What is real: the app's pages and service worker, the family link (track D's invite and accept routes, his confirm
 * card), his switches, the server's Web Push (RFC 8291 encryption, RFC 8292 VAPID), the
 * job, the delivery rows. What stands in: the push service (headless Chromium has none; tests/support/push-service.ts
 * checks VAPID and opens each message like FCM would, then hands it to the phone's real service worker through Chrome
 * DevTools' "deliver push message"), the browser's permission question on his phone (drawn; a test cannot click the
 * real one), and the notification banner (drawn by the kit from what the service worker showed, at that moment: f3.md's
 * hook).
 *
 * Accounts: Mr Tan on the example data (today is day 42; amlodipine every morning; Wei Ling's stand-in clip), Wei Ling
 * with no space of her own. The test clock is frozen at today's 08:30 and moved to 08:45, 09:15, 09:45, 09:46; it is
 * cleared at the end.
 */
import type { Page } from "@playwright/test";
import { startPushService, type PushMessage } from "../../tests/support/push-service";
import { answerPermissionPrompt, deliverToServiceWorker, listenForShownPushes, shownNotifications, stubPushSubscription, tapNotification } from "../push-helpers";
import { expect, journey } from "./_kit";

// the new headless Chromium: a service worker may show notifications there (the old headless shell refuses them)
journey.use({ channel: "chromium" });

const PASSWORD = "a long test password";
/** a medicine name, a dose, a reading: never on a lock screen */
const NOT_ON_LOCK_SCREEN = /amlodipine|norvasc|氨氯地平|losartan|氯沙坦|ibuprofen|布洛芬|\d\s*mg|一粒|\d{2,3}\s*\/\s*\d{2,3}/i;

/** Today in Singapore as YYYY-MM-DD. */
function sgToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The browser's own question, as a phone shows it (drawn by the recorder: a test cannot click the real prompt). */
function permissionQuestionHtml(host: string): string {
  return `<style>
.rpj-ask{position:absolute;left:0;right:0;bottom:0;padding:22px 22px 30px;background:#fff;border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.25);
font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:#1f1f1f;animation:rpj-up .3s ease-out both}
.rpj-ask .h{font-size:13px;color:#5f6368;letter-spacing:.02em}
.rpj-ask .q{margin-top:8px;font-size:19px;line-height:26px;font-weight:600}
.rpj-ask .row{display:flex;gap:12px;margin-top:20px}
.rpj-ask .b{flex:1;text-align:center;padding:12px 0;border-radius:999px;font-size:17px;font-weight:600}
.rpj-ask .no{border:1.5px solid #c4c7c5;color:#1f1f1f}
.rpj-ask .yes{background:#0b57d0;color:#fff;position:relative}
.rpj-ask .yes::after{content:"";position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
background:rgba(255,183,0,.30);border:3px solid rgba(255,153,0,.95);box-shadow:0 0 0 7px rgba(255,153,0,.18);opacity:0;animation:rpj-tap .5s ease-out 1.1s forwards}
.rpj-ask .tag{position:absolute;top:-30px;right:12px;font-size:12px;background:#f4b400;color:#1b1b1b;padding:2px 9px;border-radius:999px;font-weight:700}
@keyframes rpj-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes rpj-tap{to{opacity:1}}
</style><div class="rpj-ask"><span class="tag">录屏示意</span><div class="h">${host}</div><div class="q">允许「Ripple」向你发送通知吗？</div><div class="row"><div class="b no">不允许</div><div class="b yes">允许</div></div></div>`;
}

journey("02 吃药提醒的推送：开提醒、8:45 和 9:15 的锁屏提醒、两次没回告诉女儿", async ({ kit, request, baseURL }) => {
  const origin = new URL(baseURL ?? "http://localhost:3600").origin;
  const today = sgToday();
  const tag = `dose-${today}-morning`;
  const alertTag = `no-reply-${today}-morning`;
  const setClock = async (hhmm: string) => {
    const r = await request.post("/api/dev/clock", { data: { at: `${today}T${hhmm}:00+08:00`, frozen: true } });
    expect(r.status(), await r.text()).toBe(200);
  };
  // one pass of track B's job (its counts cover every account on this server: what this journey checks is what
  // reached its own two phones)
  const tick = async (): Promise<void> => {
    const r = await request.post("/api/dev/tick", { data: { names: ["daily.doses"] } });
    expect(r.status(), await r.text()).toBe(200);
    const body = (await r.json()) as { reports: { job: string; outcome: string }[] };
    expect(body.reports.find((x) => x.job === "daily.doses")?.outcome).toBe("ran");
  };

  await setClock("08:30");
  const service = await startPushService();
  try {
    kit.cornerLabel("推送服务：本机替身");
    const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" });
    // new headless Chromium stops sending screencast frames after an element with an endless CSS animation (the
    // loading skeleton's "breathe") goes away: the video would keep showing the skeleton. With reduced motion the
    // skeleton stands still and every later screen reaches the video (the app follows prefers-reduced-motion anyway).
    for (const phone of [elder, daughter]) await phone.page.emulateMedia({ reducedMotion: "reduce" });
    const hisSub = service.newPhone({ label: "陈先生的手机" });
    const herSub = service.newPhone({ label: "女儿的手机" });

    // the phones: real notification permission for the service worker, the push service's subscription, his question
    for (const [phone, sub] of [
      [elder, hisSub],
      [daughter, herSub],
    ] as const) {
      await phone.context.grantPermissions(["notifications"], { origin });
      await stubPushSubscription(phone.context, sub);
    }
    await answerPermissionPrompt(elder.context, "granted", async () => {
      const ask = await elder.page.screencast.showOverlay(permissionQuestionHtml(new URL(origin).host));
      await kit.pause(2200);
      await ask.dispose();
    });
    // what the push service opens goes to that phone's service worker, as FCM would deliver it
    service.onMessage(async (m: PushMessage) => {
      const page = m.phone === hisSub.id ? elder.page : daughter.page;
      if (m.text) await deliverToServiceWorker(page, m.text);
    });
    // what the service worker shows is drawn on that phone at that moment (public/sw.js "rp:push-shown")
    const drawn = async (n: { title: string; body: string }, page: Page) => {
      await kit.showNotification(page, { title: n.title, body: n.body });
    };
    const hisShown = await listenForShownPushes(elder.context, drawn);
    const herShown = await listenForShownPushes(daughter.context, drawn);

    // the accounts (developer tools): his example data at 08:30 today, her account without a space. Their link is made
    // in the journey itself (his invitation and her acceptance through track D's routes, his confirm card); of his
    // switches only 「每天吃药了没有」 goes on there (real-app 2.7's example), 「两次提醒没回时通知她」 stays off until later
    const stamp = Date.now().toString(36);
    const him = await elder.context.request.post("/api/dev/accounts", { data: { login: `tan.${stamp}`, password: PASSWORD, space: "example", display_name: "陈先生" } });
    expect(him.status(), await him.text()).toBe(201);
    const her = await daughter.context.request.post("/api/dev/accounts", { data: { login: `weiling.${stamp}`, password: PASSWORD, space: "none", display_name: "Wei Ling" } });
    expect(her.status(), await her.text()).toBe(201);

    const ep = elder.page;
    const dp = daughter.page;
    const screen = ep.getByTestId("page-me-notifications");
    await ep.goto("/p/me/notifications");
    await expect(screen).toHaveAttribute("data-state", "default");
    // her phone before he invites her: a dark screen (her side is dark), not a white blank page
    await dp.setContent('<html><body style="margin:0;background:#05070A"></body></html>');

    // ---- 1. one tap turns reminders on
    await kit.step(ep, "陈先生打开「我 › 提醒和通知」：提醒还没开，锁屏上只会写「早上的药 · 还没记」");
    await expect(ep.locator('[data-rp="headline"]')).toHaveText("提醒还没开。");
    await expect(screen).toContainText("不写药名");

    await kit.step(ep, "他点「开提醒」，手机问要不要允许通知，他点「允许」");
    let since = Date.now();
    const welcome = service.next(hisSub.id, 20_000);
    await ep.getByTestId("push-on").click();
    const w = await welcome;
    expect(w.status).toBe(201);
    expect(w.payload).toMatchObject({ kind: "welcome", title: "提醒已经开好了", url: "/p/me/notifications" });
    const wShown = await hisShown.next({ since, timeoutMs: 15_000 });
    expect(wShown).toMatchObject({ title: "提醒已经开好了", body: w.payload?.body, url: "/p/me/notifications", shown: true });
    await expect(screen).toHaveAttribute("data-state", "on");
    await expect(ep.getByTestId("push-result")).toHaveText("提醒已经开好了。刚才发了一条试试，手机顶上应该出现了。");
    // the phone subscribed with this server's VAPID key, and that key signed the message; from now on the push service
    // refuses (403) anything for these two phones signed with another key, as FCM would
    expect(await ep.evaluate(() => (window as unknown as { __rpSubscribedWith?: string }).__rpSubscribedWith)).toBe(w.vapidKey);
    hisSub.serverKey = w.vapidKey;
    herSub.serverKey = w.vapidKey;
    await kit.pause(1200);

    await kit.step(ep, "「提醒已经开好了」从服务器真的推到了他的手机。早上的药 8:45 提醒，没回 9:15 再问一次");
    const slotRow = screen.locator('[data-rp="row"]', { hasText: "没回 9:15 再问一次" });
    await expect(slotRow).toHaveText("早上的药8:45，没回 9:15 再问一次");
    await kit.show(slotRow);

    // ---- she accepts his invitation: his phone is told, the tap lands on the confirm card
    await kit.step(ep, "陈先生邀请女儿 Wei Ling，她在自己的手机上接受了。他的手机收到「Wei Ling 已经接受」，锁屏上没有任何病情");
    const invited = await elder.context.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
    expect(invited.status(), await invited.text()).toBe(201);
    const invitation = (await invited.json()) as { path: string; link: { id: string } };
    const linkId = invitation.link.id;
    const acceptTag = `family-accepted-${linkId}`;
    since = Date.now();
    const told = service.next(hisSub.id, 20_000);
    const accepted = await daughter.context.request.post("/api/family/invites/accept", { data: { token: invitation.path.replace(/^\/invite\//, "") } });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const t = await told;
    expect(t).toMatchObject({ status: 201, problem: null, ttl: 3600, urgency: "high" });
    expect(t.payload).toMatchObject({ v: 1, kind: "family_accepted", title: "Wei Ling 已经接受", url: "/p/today?confirm=1", tag: acceptTag, lang: "zh-Hans" });
    expect(typeof t.payload?.delivery).toBe("string");
    expect(t.text).not.toMatch(NOT_ON_LOCK_SCREEN);
    expect(t.text).not.toMatch(/药|血压|看诊/);
    const tShown = await hisShown.next({ since, timeoutMs: 15_000 });
    expect(tShown).toMatchObject({ title: "Wei Ling 已经接受", url: "/p/today?confirm=1", tag: acceptTag, kind: "family_accepted", shown: true });
    // her own phone was told nothing
    expect(service.messages.filter((m) => m.phone === herSub.id && m.at >= since)).toEqual([]);
    await kit.pause(2400);

    // C2 track D (round two; real-app 2.20 step 4): the tap lands on Today's own confirm card, not on 「家人」
    await kit.step(ep, "他点这条通知：手机打开今天页，就是那张确认卡「Wei Ling 接受了邀请，是她吗？」");
    await tapNotification(elder.context, acceptTag);
    await ep.waitForURL(/\/p\/today\?confirm=1$/, { timeout: 15_000 });
    await expect(ep.getByTestId("today-family-confirm")).toBeVisible();
    await expect(ep.locator("body")).toContainText("Wei Ling 接受了邀请，是她吗？");
    expect(await shownNotifications(elder.context, acceptTag)).toEqual([]);
    // the tap is on record: opened_at on that notice
    await expect
      .poll(async () => {
        const r = await elder.context.request.get("/api/push");
        const body = (await r.json()) as { recent: { kind: string; opened_at: string | null }[] };
        return body.recent.find((x) => x.kind === "family_accepted")?.opened_at ?? null;
      })
      .not.toBeNull();
    await kit.pause(1200);

    await kit.step(ep, "是女儿。他点「是她」，再打开「每天吃药了没有」这一项；「两次提醒没回时通知她」先关着");
    await ep.getByTestId("confirm-yes").click();
    await expect(ep.getByTestId("page-family-link")).toHaveAttribute("data-state", "active");
    const doseSwitch = ep.locator('[data-grant="dose_summary"] [role="switch"]');
    await doseSwitch.click();
    await expect(doseSwitch).toHaveAttribute("aria-checked", "true");
    await expect(ep.locator('[data-grant="no_reply_alert"] [role="switch"]')).toHaveAttribute("aria-checked", "false");
    await kit.pause(1000);

    // her phone: her first-visit guide already done, Dad's number saved (track D's journeys do the same), on her 「我」
    await dp.goto(`/f?link=${encodeURIComponent(linkId)}`);
    await dp.evaluate((id) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      localStorage.setItem(`rp_f_phone_${id}`, "+65 0000 0000");
    }, linkId);
    await dp.goto(`/f/me?link=${encodeURIComponent(linkId)}`);
    const herNotifications = dp.getByTestId("me-notifications");
    await expect(herNotifications).toHaveAttribute("data-state", "off");

    // ---- her phone: notifications on, from her own 「我」 page (track D's button calls track I's enablePush)
    await kit.step(dp, "Wei Ling 在她的「我的」里点「通知」，再点「打开通知」：「通知已经开好了」也推到了她的手机");
    // her 「我的」 is rows (the v3 draft's G1): the row opens the screen that turns notifications on (G2)
    await dp.getByTestId("me-notifications-open").click();
    await expect(dp.getByTestId("family-notifications")).toBeVisible();
    since = Date.now();
    const herWelcome = service.next(herSub.id, 20_000);
    await dp.getByTestId("me-push-on").click();
    const hw = await herWelcome;
    expect(hw.status).toBe(201);
    expect(hw.payload).toMatchObject({ kind: "welcome", title: "通知已经开好了", url: "/f" });
    await herShown.next({ since, timeoutMs: 15_000 });
    await expect(herNotifications).toHaveAttribute("data-state", "on");
    await kit.pause(1500);

    // ---- 2. 08:45 the first reminder; 09:15 the second replaces it
    await kit.step(ep, "8:45 到了：定时任务发出第一次提醒。锁屏上只写「早上的药 · 还没记」，没有药名");
    await setClock("08:45");
    since = Date.now();
    const first = service.next(hisSub.id);
    await tick();
    const m1 = await first;
    expect(m1).toMatchObject({ status: 201, problem: null, ttl: 3600, urgency: "high" });
    expect(m1.payload).toMatchObject({ v: 1, kind: "dose_first", title: "早上的药", body: "还没记", url: "/p/today?remind=dose-morning", tag, renotify: false, lang: "zh-Hans" });
    expect(typeof m1.payload?.delivery).toBe("string");
    expect(m1.text).not.toMatch(NOT_ON_LOCK_SCREEN);
    const s1 = await hisShown.next({ since });
    expect(s1).toMatchObject({ title: "早上的药", body: "还没记", url: "/p/today?remind=dose-morning", tag, kind: "dose_first", shown: true });
    expect((await shownNotifications(elder.context, tag)).map((n) => n.data?.kind)).toEqual(["dose_first"]);
    await kit.pause(2600);

    await kit.step(ep, "他在吃早饭，没看手机。9:15 第二次提醒到了：同一个标签，换掉 8:45 那条，锁屏上还是一条");
    await setClock("09:15");
    since = Date.now();
    const second = service.next(hisSub.id);
    await tick();
    const m2 = await second;
    expect(m2.payload).toMatchObject({ kind: "dose_second", title: "早上的药", body: "还没记", url: "/p/today?remind=dose-morning", tag, renotify: true });
    expect(m2.text).not.toMatch(NOT_ON_LOCK_SCREEN);
    expect(m2.payload?.delivery).not.toBe(m1.payload?.delivery);
    const s2 = await hisShown.next({ since });
    expect(s2).toMatchObject({ title: "早上的药", body: "还没记", tag, kind: "dose_second", shown: true });
    const onPhone = await shownNotifications(elder.context, tag);
    expect(onPhone.map((n) => [n.title, n.body, n.data?.kind])).toEqual([["早上的药", "还没记", "dose_second"]]);
    await kit.pause(2600);

    // ---- 3. the tap: Today's morning card and her voice
    await kit.step(ep, "他点这条提醒：手机打开「今天」的早上那张卡，Wei Ling 的提醒自己放了起来");
    await tapNotification(elder.context, tag);
    await ep.waitForURL(/\/p\/today\?remind=dose-morning$/, { timeout: 15_000 });
    const card = ep.locator('[data-testid="her-reminder"], [data-testid="reminder-strip"]').first();
    await expect(card).toBeVisible();
    const clip = await kit.waitForAudio("/api/reminders/", { until: "ended", timeout: 25_000 });
    expect(clip.endWall).not.toBeNull();
    expect(await shownNotifications(elder.context, tag)).toEqual([]);
    // the tap is on record: opened_at on that reminder (the second, the one he tapped)
    await expect
      .poll(async () => {
        const r = await elder.context.request.get("/api/push");
        const body = (await r.json()) as { recent: { kind: string; opened_at: string | null }[] };
        return body.recent.find((x) => x.kind === "dose_second")?.opened_at ?? null;
      })
      .not.toBeNull();
    await kit.pause(1200);

    // ---- 4. 09:45: no answer; her alert only with his switch on
    await kit.step(dp, "9:45 他还是没点「吃了」，记成「没回」。爸爸的「没回时通知她」关着：她的手机什么都没收到");
    await setClock("09:45");
    since = Date.now();
    await tick();
    await kit.pause(2500);
    expect(service.messages.filter((m) => m.phone === herSub.id && m.at >= since)).toEqual([]);
    expect(herShown.all.filter((n) => n.at >= since)).toEqual([]);

    await kit.step(ep, "陈先生在 Wei Ling 的「家人能看到什么」里打开「两次提醒没回时通知她」");
    await ep.goto(`/p/family/${encodeURIComponent(linkId)}`);
    const alertSwitch = ep.locator('[data-grant="no_reply_alert"] [role="switch"]');
    await kit.show(alertSwitch);
    await alertSwitch.click();
    await expect(alertSwitch).toHaveAttribute("aria-checked", "true");
    await kit.pause(1000);

    await kit.step(dp, "下一分钟的定时任务告诉了她：锁屏上「爸爸还没回早上的药」，没有药名");
    await setClock("09:46");
    since = Date.now();
    const alert = service.next(herSub.id);
    await tick();
    const a = await alert;
    // no push is held longer than an hour (real-app 2.24), whatever the job asked for
    expect(a).toMatchObject({ status: 201, problem: null, ttl: 3600 });
    expect(a.payload).toMatchObject({
      kind: "family_no_reply",
      title: "爸爸还没回早上的药",
      body: "8:45 和 9:15 两次提醒都没有回。",
      url: `/f?link=${encodeURIComponent(linkId)}`,
      tag: alertTag,
    });
    expect(typeof a.payload?.delivery).toBe("string");
    expect(a.text).not.toMatch(NOT_ON_LOCK_SCREEN);
    const sa = await herShown.next({ since });
    expect(sa).toMatchObject({ title: "爸爸还没回早上的药", body: "8:45 和 9:15 两次提醒都没有回。", tag: alertTag, kind: "family_no_reply", shown: true });
    // his phone got nothing new
    expect(service.messages.filter((m) => m.phone === hisSub.id && m.at >= since)).toEqual([]);
    await kit.pause(2600);

    await kit.step(dp, "她点这条通知：她的首页变成琥珀色，只有一个主按钮「打电话给爸爸」");
    await tapNotification(daughter.context, alertTag);
    await dp.waitForURL(new RegExp(`/f\\?link=${encodeURIComponent(linkId)}$`), { timeout: 15_000 });
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
    await expect(dp.getByTestId("home-no-reply")).toBeVisible();
    await expect(dp.getByTestId("family-headline")).toHaveText("爸爸还没回早上的药。");
    expect(await shownNotifications(daughter.context, alertTag)).toEqual([]);
    // her tap is on record too (real-app 2.24 「她看到通知」): opened_at on that alert, written through her link by the
    // service worker's POST; she reads it back among the alerts sent to her
    await expect
      .poll(async () => {
        const r = await daughter.context.request.get(`/api/family/alerts?link=${encodeURIComponent(linkId)}`);
        const body = (await r.json()) as { alerts?: { deliveryId: string; openedAt: string | null }[] };
        return body.alerts?.find((x) => x.deliveryId === a.payload?.delivery)?.openedAt ?? null;
      })
      .not.toBeNull();
    await kit.pause(2000);

    await request.post("/api/dev/clock", { data: { clear: true } });
    await kit.finish();
  } finally {
    await request.post("/api/dev/clock", { data: { clear: true } }).catch(() => undefined);
    await service.close();
  }
});
