/**
 * 01 注册和建档, the setting-up half (track C; real-app 2.5, e2e-chains 12; sign-up itself is track A's).
 *
 * A blank account right after a sign-up marked 「家人帮我操作」 (made here through the developer helper with onboarding
 * "started" and assisted: true; track A's sign-up records the same on his consent and sends a blank account to
 * /onboard the same way; 01-signup is that half). His daughter Wei Ling fills it in on his phone: the first screen
 * already says 「家人帮我填」 because sign-up said so. Clinic, breakfast, a weekly habit, medicines later, age, two
 * conditions, allergies skipped, family later, reminders on. What she enters waits for him (every fact of the round is
 * source family, unconfirmed): nothing moves his reminders until he says 对.
 * Then Mr Tan himself goes through it on 「我 › 我的档案」: 对 for most, 改一下 for one (his own words), 不对 for one he
 * does not have. His profile then says who wrote each line, and his morning reminder follows his breakfast.
 *
 * The test clock is frozen at 07:30 today (Singapore) and cleared at the end. 「开提醒」 is track I's enablePush: the
 * headless browser has no push service of its own, so its PushManager is given the subscription of a local push
 * service (tests/support/push-service.ts, allowed with the developer tools on); the server really encrypts and sends
 * 「提醒已经开好了」 there, the script opens it, and the recorder draws exactly that notice on the phone (corner label).
 */
import type { APIRequestContext } from "@playwright/test";
import { startPushService } from "../../tests/support/push-service";
import { expect, journey } from "./_kit";

const PASSWORD = "a long test password";
const CLINIC = "Blossom Family Clinic";

function sgToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

interface ProfileJson {
  profile: {
    clinic: string | null;
    breakfast: string | null;
    reminderAt: string;
    habits: { label: string; days: string[] | "daily"; time: string }[];
    facts: { kind: string; text: string; source: string; confirmed: boolean; editedByHim: boolean }[];
    pending: { kind: string; text: string }[];
    onboarding: string | null;
  };
}

async function profile(api: APIRequestContext): Promise<ProfileJson["profile"]> {
  const r = await api.get("/api/profile");
  expect(r.status()).toBe(200);
  return ((await r.json()) as ProfileJson).profile;
}

journey("01 注册和建档", async ({ kit, request }) => {
  const clock = await request.post("/api/dev/clock", { data: { at: `${sgToday()}T07:30:00+08:00`, frozen: true } });
  expect(clock.status(), await clock.text()).toBe(200);
  kit.cornerLabel("横幅是录屏画的，推送真发了");
  const pushService = await startPushService();
  const pushPhone = pushService.newPhone({ label: "陈先生的手机" });

  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const page = elder.page;
  const api = elder.context.request;
  await elder.context.grantPermissions(["notifications"]);
  // this browser's push service: the local one (a real browser gets FCM's, Mozilla's or Apple's endpoint here)
  await elder.context.addInitScript((sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => {
    // headless Chromium reports Notification.permission "denied" even after the grant (requestPermission says "granted"):
    // read it the way a phone that allowed notifications does
    if (typeof Notification !== "undefined") Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    if (typeof PushManager === "undefined") return;
    const subscription = {
      endpoint: sub.endpoint,
      expirationTime: null,
      options: { applicationServerKey: null, userVisibleOnly: true },
      getKey: () => null,
      toJSON: () => ({ endpoint: sub.endpoint, expirationTime: null, keys: sub.keys }),
      unsubscribe: async () => true,
    };
    let subscribed = false;
    PushManager.prototype.subscribe = async function () {
      subscribed = true;
      return subscription as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      return (subscribed ? subscription : null) as unknown as PushSubscription | null;
    };
  }, { endpoint: pushPhone.endpoint, keys: pushPhone.keys });
  const made = await api.post("/api/dev/accounts", { data: { login: `tan${Date.now().toString(36)}`, password: PASSWORD, space: "blank", onboarding: "started", display_name: "陈先生", assisted: true } });
  expect(made.status(), await made.text()).toBe(201);
  await page.goto("/onboard");
  await page.waitForURL("**/onboard/who");

  const headline = page.locator('[data-rp="headline"]');
  const next = page.getByTestId("onboard-next");

  await kit.step(page, "注册时选了「家人帮我操作」，从空白开始建档。第一屏问：现在是谁在填？「家人帮我填」已经选着");
  await expect(headline).toHaveText("现在是谁在填？");
  await expect(page.locator('[data-rp="text"]').first()).toHaveText("注册时说过是家人帮忙操作。");
  await expect(page.getByTestId("onboard-who-family")).toHaveAttribute("data-current", "true");
  await kit.show(page.getByTestId("onboard-who-family"));

  await kit.step(page, "女儿 Wei Ling 在他的手机上帮他填：点「家人帮我填」往下走（点「跳过」也一样，还是家人填）");
  await page.getByTestId("onboard-who-family").click();
  await page.waitForURL("**/onboard/clinic");
  await expect(page.locator('[data-rp="helped"]')).toContainText("要你自己点「对」以后才算数");
  // the eleven screens are six items; the step bar says which one this screen belongs to
  await expect(page.locator('[data-rp="step"]')).toContainText("建档 · 第 1 项，共 6 项");

  await kit.step(page, "建档一共六项，每一屏都写着：家人填的，要爸爸自己点「对」才算。第 1 项，常去的诊所");
  await kit.type(page.getByTestId("onboard-clinic"), CLINIC);
  await next.click();
  await page.waitForURL("**/onboard/breakfast");

  await kit.step(page, "第 2 项，作息。先问早饭几点：点「早上 7:30」，下面算出早上的药几点提醒");
  await expect(page.locator('[data-rp="step"]')).toContainText("建档 · 第 2 项，共 6 项");
  await page.getByTestId("onboard-breakfast-07:30").click();
  await expect(page.getByTestId("onboard-reminder-at")).toHaveText("他自己点了「对」以后，早上的药会在 早上 7:45 提醒。");
  await next.click();
  await page.waitForURL("**/onboard/habits");

  await kit.step(page, "作息排成一张单子：她写的早饭在上面，标着「等你确认」。再问每周固定做的事：打太极，周二、周四，早上 7:00");
  const waitingBreakfast = page.locator('[data-rp="routine-waiting"]');
  await expect(waitingBreakfast).toContainText("早饭");
  await expect(waitingBreakfast).toContainText("每天 · 早上 7:30");
  await expect(waitingBreakfast).toContainText("等你确认");
  await page.getByTestId("onboard-habit-tai-chi").click();
  await page.getByTestId("onboard-day-Tue").click();
  await page.getByTestId("onboard-day-Thu").click();
  await page.getByTestId("onboard-habit-time-07:00").click();
  await page.getByTestId("onboard-habit-add").click();
  const habit = page.locator('[data-rp="habit"][data-habit="Tai chi"]');
  await expect(habit).toContainText("打太极");
  await expect(habit).toContainText("周二、周四 · 早上 7:00");
  await kit.show(habit);
  await next.click();
  await page.waitForURL("**/onboard/meds");

  await kit.step(page, "药：先点「以后再说」，拍药袋那一页以后再去");
  await expect(page.getByTestId("onboard-meds-photo")).toBeVisible();
  await page.getByTestId("onboard-meds-later").click();
  await page.waitForURL("**/onboard/age");

  await kit.step(page, "年龄：67");
  await kit.type(page.getByTestId("onboard-age"), "67");
  await next.click();
  await page.waitForURL("**/onboard/conditions");

  await kit.step(page, "医生说过的病：她点了「高血压」，又多点了一个「糖尿病」");
  await page.getByTestId("onboard-conditions-high-blood-pressure").click();
  await page.getByTestId("onboard-conditions-diabetes").click();
  await expect(page.getByTestId("onboard-conditions-high-blood-pressure")).toHaveAttribute("aria-pressed", "true");
  await next.click();
  await page.waitForURL("**/onboard/allergies");

  await kit.step(page, "过敏这一屏不知道，点「跳过」：每一屏都能跳过");
  await page.getByTestId("onboard-skip").click();
  await page.waitForURL("**/onboard/family");

  await kit.step(page, "要不要请家人一起看：「以后再说」，邀请在家人那一页做");
  await page.getByTestId("onboard-family-later").click();
  await page.waitForURL("**/onboard/reminders");

  await kit.step(page, "第 6 项，开提醒：一根线写着几点提醒、几点再问、几点记成「没回」。点「开提醒」，手机允许通知，Ripple 马上发来一条「提醒已经开好了」");
  await expect(page.locator('[data-rp="step"]')).toContainText("建档 · 第 6 项，共 6 项");
  // what she wrote about breakfast has not moved his reminders: the line still says the times his space has now
  const reminderLine = page.getByTestId("onboard-reminder-line");
  await expect(reminderLine.locator('[data-line="breakfast"]')).toHaveCount(0);
  await expect(reminderLine.locator('[data-line="first"]')).toContainText("8:45");
  await expect(reminderLine.locator('[data-line="second"]')).toContainText("9:15");
  await expect(reminderLine.locator('[data-line="closes"]')).toContainText("9:45");
  await expect(page.getByTestId("onboard-remind-change")).toHaveCount(0);
  const welcome = pushService.next(pushPhone.id, 15_000);
  await page.getByTestId("onboard-reminders-on").click();
  const pushed = await welcome;
  expect(pushed.status).toBe(201);
  expect(pushed.payload).toMatchObject({ title: "提醒已经开好了", body: "吃药的时间到了，手机会这样提醒你。" });
  await kit.showNotification(page, { title: String(pushed.payload!.title), body: String(pushed.payload!.body) });
  await expect(page.locator('[data-rp="reminders-result"]')).toHaveText("提醒开好了：手机刚收到一条「提醒已经开好了」。");
  await page.waitForURL("**/onboard/done");

  await kit.step(page, "建好了：她填的 6 条都等爸爸自己确认，提醒还照默认的 8:45");
  await expect(page.locator('[data-rp="done-hero"]')).toContainText("建好了。");
  const rows = page.locator('[data-rp="row"]');
  await expect(rows.filter({ hasText: "等你确认" })).toContainText("6 条");
  await expect(rows.filter({ hasText: "早上的药提醒" })).toContainText("早上 8:45");
  let p = await profile(api);
  expect(p.pending.map((f) => f.kind)).toEqual(["clinic", "routine", "routine", "age", "condition", "condition"]);
  expect(p.facts).toEqual([]);
  expect(p.clinic).toBeNull();
  expect(p.reminderAt).toBe("08:45");
  await page.getByTestId("onboard-done").click();
  await page.waitForURL("**/p/today");

  await kit.step(page, "到了「今天」：最上面一行写着家人写了 6 条，请陈先生自己看一下");
  const waiting = page.locator('[data-rp="family-facts-line"]');
  await expect(waiting).toHaveText("家人写了 6 条，请你看一下。");
  await kit.show(waiting);

  await kit.step(page, "陈先生点这一行，打开「我的档案」：家人写的 6 条，一条一条给他认");
  await waiting.click();
  await page.waitForURL("**/p/profile");
  await expect(headline).toContainText("家人写了");
  // one at a time: only the first is on the screen, and the count says which of how many
  await expect(page.locator('[data-rp="confirm-fact"]')).toHaveCount(1);
  await expect(page.locator('[data-rp="confirm-count"]')).toHaveText("第 1 项，共 6 项");

  await kit.step(page, "诊所、早饭、打太极、年龄都对：他一条一条点「对」");
  const card = page.locator('[data-rp="confirm-fact"]').first();
  for (const words of [CLINIC, "早饭 · 早上 7:30", "打太极 · 周二、周四 · 早上 7:00", "67"]) {
    await expect(card).toContainText(words);
    await card.getByTestId("confirm-fact-yes").click();
    await expect(page.locator('[data-rp="confirm-fact"]').filter({ hasText: words })).toHaveCount(0);
  }

  await kit.step(page, "「高血压」他想用自己的话：点「改一下」，写「血压高，医生叫我在家量」");
  await expect(card).toContainText("高血压");
  await card.getByTestId("confirm-fact-change").click();
  await kit.type(card.getByTestId("confirm-fact-words"), "血压高，医生叫我在家量");
  await card.getByTestId("confirm-fact-save").click();
  await expect(page.locator('[data-rp="confirm-fact"]').filter({ hasText: "高血压" })).toHaveCount(0);

  await kit.step(page, "他没有糖尿病：点「不对」，这一条不再出现，也不会被拿去用");
  await expect(card).toContainText("糖尿病");
  await card.getByTestId("confirm-fact-no").click();
  await expect(page.locator('[data-rp="confirm-fact"]')).toHaveCount(0);

  await kit.step(page, "档案页每一条都写着是谁写的，诊所和作息也一样；早饭 7:30 确认以后，早上的药改成 7:45 提醒");
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("我的档案");
  const reminderRow = page.locator('[data-rp="row"]', { hasText: "早上的药提醒" });
  await expect(reminderRow).toContainText("早上 7:45");
  await expect(page.locator('[data-rp="row"]', { hasText: "医生说过的病" })).toContainText("血压高，医生叫我在家量");
  await expect(page.locator('[data-rp="row"]', { hasText: "医生说过的病" })).toContainText("你改过（家人写的）");
  await expect(page.locator('[data-rp="row"]', { hasText: "年龄" })).toContainText("本人确认（家人写的）");
  await expect(page.locator('[data-rp="row"]', { hasText: "常去的诊所" })).toContainText("本人确认（家人写的）");
  await expect(page.locator('[data-rp="row"]', { hasText: "固定要做的事" })).toContainText("本人确认（家人写的）");
  await expect(page.locator('[data-rp="row"]', { hasText: "医生说过的病" })).not.toContainText("糖尿病");
  await kit.show(reminderRow);
  p = await profile(api);
  expect(p).toMatchObject({ clinic: CLINIC, breakfast: "07:30", reminderAt: "07:45", onboarding: "done", pending: [] });
  expect(p.habits).toEqual([{ label: "Tai chi", label_zh: "打太极", days: ["Tue", "Thu"], time: "07:00" }]);
  expect(p.facts.map((f) => [f.kind, f.text, f.source, f.confirmed])).toEqual([
    ["clinic", CLINIC, "family", true],
    ["routine", "早饭 · 早上 7:30", "family", true],
    ["routine", "打太极 · 周二、周四 · 早上 7:00", "family", true],
    ["age", "67", "family", true],
    ["condition", "血压高，医生叫我在家量", "family", true],
  ]);

  const reset = await request.post("/api/dev/clock", { data: { clear: true } });
  expect(reset.status()).toBe(200);
  await pushService.close();
  await kit.finish();
});
