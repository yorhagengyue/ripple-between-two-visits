/**
 * Chain 1 吃药, end to end (docs/plan/e2e-chains.md section 1): three devices in one story, three mornings.
 *
 *   his phone (joined with the code as 本人) · her phone (joined through /join as 家属) · backstage (joined as 后台)
 *
 *   D43 Tue 08:45  the morning reminder: her words and her clip on his phone (nothing is written yet)
 *                  没吃 -> 打太极 (a tai chi day) for amlodipine, 吃了 for losartan      dose_log x2, dose.logged backstage,
 *                                                                                   her /f: today's state, this week
 *   D44 Wed 08:45  吃了 for losartan; 等下 for amlodipine -> 撤销 (no answer again)      dose_log later -> undone
 *            09:15  the second reminder
 *            09:50  the window has closed: unconfirmed / no_reply                     dose_log no_reply (by "director")
 *                   he allowed "no reply" alerts (his own switch page shows it on):   her /f alert for 10月7日 within 5 s
 *   D45 Thu 08:45  吃了 for both: the reminder goes away
 *            10:00  his brief (Today -> 看诊简报) counts exactly what his phone recorded since the D42 visit:
 *                   6 due, 4 taken, 1 missed (the tai chi morning), 1 unconfirmed; GET /api/brief says the same
 *
 * Every step checks the record twice: on the page that shows it and through the API that reads the store.
 * Demo mode: the seed holds doses D9-D41 only and v3 is on D42, so D43-D45 are the phone's own (e2e-chains.md
 * "链 e2e 在演示模式下的一个坑"). D42 is answered first as setup: a skipped day is otherwise settled as "no reply" on
 * the first read of D43 (gap 1.3) and would reach her phone as an alert about a day nobody was asked.
 */
import { expect, test } from "@playwright/test";
import {
  api,
  at,
  closeAll,
  createSession,
  doseRows,
  eventRows,
  getJson,
  joinAs,
  textBelow,
  waitLive,
  CREW_HEADERS,
  joinThroughPageAsCrew,
} from "../helpers";

// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const AML = "med-amlodipine";
const LOS = "med-losartan";
const HER_WORDS = "「爸，早餐吃了吗？药记得吃哦。」";

interface BriefDoses {
  due: number;
  taken: number;
  missed: number;
  unconfirmed: number;
  missedDays: number[];
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  // next dev compiles each route on first use: compile everything the timed steps touch
  const s = await createSession(request, { story_day: 43, story_time: "08:40" });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/join", "/p/today", "/p/family", "/p/brief", "/p/questions", "/f", "/backstage"]) await request.get(p, { headers: cookie });
  for (const p of ["/api/doses", "/api/family/view", "/api/family/alerts", "/api/reminders", "/api/brief", "/api/family/grants"]) await request.get(`${p}?session=${s.id}`);
  await api(request, "/api/doses", s.id, { medication_id: AML, slot: "morning", state: "taken" });
  await at(request, s.id, 43, "08:45");
});

test("吃药: reminder -> 没吃 with a reason / 吃了 / 等下 -> 撤销 -> the window closes -> unconfirmed -> her alert (he allowed it) -> the brief counts it", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const s = await createSession(request, { story_day: 43, story_time: "08:40" });
  // setup: D42 (the v3 visit day) answered, see the header
  await api(request, "/api/doses", s.id, { medication_id: AML, day: 42, slot: "morning", state: "taken" });

  const phone = await joinAs(browser, s.join_code, "patient", "/p/family");
  const daughter = await joinThroughPageAsCrew(browser, s.join_code, "family");
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");
  const pp = phone.page;
  const fp = daughter.page;
  const plays = () =>
    pp.evaluate(() => (window.__rpDailyClipPlays ?? []).filter((p) => p.url.includes("/api/reminders/")).map((p) => ({ auto: p.auto, playing: p.playing })));

  // he allowed it: his own switch page shows "tell her when I do not reply to two reminders" on (the seed's choice)
  await expect(pp.getByTestId("grant-no_reply_alert")).toHaveAttribute("data-on", "true");
  expect((await getJson<{ items: Record<string, boolean> }>(phone, "/api/family/grants", s.id)).items.no_reply_alert).toBe(true);
  await expect(fp.getByTestId("family-alerts")).toHaveAttribute("data-on", "true");
  await expect(fp.getByTestId("family-alert")).toHaveCount(0);
  await pp.goto("/p/today");
  await waitLive(pp);

  // ---- D43 (Tuesday, tai chi) 08:40: nothing asked yet
  await expect(pp.getByTestId("reminder-strip")).toHaveCount(0);
  await expect(pp.getByTestId(`dose-state-${AML}`)).toHaveAttribute("data-state", "none");
  await expect(pp.getByTestId(`dose-state-${LOS}`)).toHaveAttribute("data-state", "none");
  expect(await doseRows(phone, s.id, 43)).toEqual([]);

  // 1. 08:45, after breakfast: the reminder with her words and her (stand-in) clip; nothing is written for it
  await at(request, s.id, 43, "08:45");
  const strip = pp.getByTestId("reminder-strip");
  await expect(strip).toHaveAttribute("data-reminder", "1", { timeout: 5000 });
  await expect(strip).toContainText(HER_WORDS);
  await expect(strip).toContainText("女儿说");
  await expect(strip.getByTestId("reminder-clip-play")).toContainText("代录音");
  await expect.poll(plays, { timeout: 10_000 }).toEqual(expect.arrayContaining([{ auto: true, playing: true }]));
  expect(await doseRows(phone, s.id, 43)).toEqual([]);
  const reminders = await getJson<{ schedule: { first: string; second: string; closes: string } }>(phone, "/api/reminders", s.id);
  expect(reminders.schedule).toEqual({ first: "08:45", second: "09:15", closes: "09:45" });

  // 2. 没吃 for amlodipine -> what happened? -> 打太极 (D43 is a Tuesday)
  await pp.getByTestId(`dose-btn-${AML}-missed`).click();
  const panel = pp.getByTestId(`dose-reason-${AML}`);
  await expect(panel.getByTestId("dose-reason-chip-tai_chi_morning")).toHaveText("打太极");
  await panel.getByTestId("dose-reason-chip-tai_chi_morning").click();
  await expect(pp.getByTestId(`dose-reason-shown-${AML}`)).toHaveText("原因：打太极");
  await expect
    .poll(async () => (await doseRows(phone, s.id, 43)).find((d) => d.medication_id === AML))
    .toMatchObject({ day: 43, slot: "morning", state: "missed", reason: "tai_chi_morning", reason_text: "打太极" });
  await expect(eventRows(desk.page, "dose.logged").filter({ hasText: "Day 43 morning: not taken." })).not.toHaveCount(0, { timeout: 4000 });
  // her phone: today's state for amlodipine follows within seconds (live), and this week counts the missed day
  await expect(fp.getByTestId(`family-dose-${AML}`)).toHaveAttribute("data-state", "missed", { timeout: 5000 });
  await expect(fp.getByTestId("family-doses-missed")).toHaveText("没吃：1 天", { timeout: 5000 });

  // 吃了 for losartan: both answered, the reminder stops
  await pp.getByTestId(`dose-btn-${LOS}-taken`).click();
  await expect(pp.getByTestId(`dose-state-${LOS}`)).toHaveAttribute("data-state", "taken");
  await expect(pp.getByTestId("reminder-strip")).toHaveCount(0);
  await expect
    .poll(async () => (await doseRows(phone, s.id, 43)).map((d) => `${d.medication_id}:${d.state}`).sort())
    .toEqual([`${AML}:missed`, `${LOS}:taken`]);
  await expect(eventRows(desk.page, "dose.logged").filter({ hasText: "Day 43 morning: taken." })).not.toHaveCount(0, { timeout: 4000 });

  // ---- D44 (Wednesday) 08:45: the next morning's reminder
  await at(request, s.id, 44, "08:45");
  await expect(pp.getByTestId("reminder-strip")).toHaveAttribute("data-reminder", "1", { timeout: 5000 });
  await expect(pp.getByTestId(`dose-state-${AML}`)).toHaveAttribute("data-state", "none");
  await pp.getByTestId(`dose-btn-${LOS}-taken`).click();
  await expect(pp.getByTestId(`dose-state-${LOS}`)).toHaveAttribute("data-state", "taken");

  // 3. 等下 for amlodipine: recorded as "later", still asked
  await pp.getByTestId(`dose-btn-${AML}-later`).click();
  await expect(pp.getByTestId(`dose-state-${AML}`)).toHaveText("等下（还没确认）");
  // the bar names the stored state (未确认), not his tap (等下): wording noted as gap 1.11
  await expect(pp.getByTestId("undo-bar")).toContainText("已记下：");
  await expect.poll(async () => (await doseRows(phone, s.id, 44)).find((d) => d.medication_id === AML)).toMatchObject({ state: "unconfirmed", reason: "later" });
  await expect(pp.getByTestId("reminder-strip")).toHaveAttribute("data-reminder", "1");

  // 4. 撤销 (within the undo bar's 12 s, no dialog): no answer again; the store keeps an "undone" row (gap 1.4)
  await pp.getByTestId("undo-btn").click();
  await expect(pp.getByTestId(`dose-state-${AML}`)).toHaveAttribute("data-state", "none");
  await expect.poll(async () => (await doseRows(phone, s.id, 44)).find((d) => d.medication_id === AML)).toMatchObject({ state: "unconfirmed", reason: "undone" });
  await expect(eventRows(desk.page, "dose.logged").filter({ hasText: "Day 44 morning: not confirmed." })).not.toHaveCount(0, { timeout: 4000 });

  // 09:15: the second reminder
  await at(request, s.id, 44, "09:15");
  await expect(pp.getByTestId("reminder-strip")).toHaveAttribute("data-reminder", "2", { timeout: 5000 });
  await expect(fp.getByTestId("family-alert")).toHaveCount(0);

  // 5. 09:50: the window closed with no answer -> unconfirmed, "no reply after two reminders"
  await at(request, s.id, 44, "09:50");
  await expect(pp.getByTestId(`dose-state-${AML}`)).toHaveText("两次提醒都没回（未确认）", { timeout: 5000 });
  await expect(pp.getByTestId("reminder-strip")).toHaveCount(0);
  await expect.poll(async () => (await doseRows(phone, s.id, 44)).find((d) => d.medication_id === AML)).toMatchObject({ state: "unconfirmed", reason: "no_reply" });
  const noReplyRows = eventRows(desk.page, "dose.logged").filter({ hasText: "Day 44 morning: no reply, not confirmed (no reply recorded)." });
  await expect(noReplyRows).not.toHaveCount(0, { timeout: 4000 });
  // settled on read by whichever page or API reads first (gap 1.3): one row in the store; the backstage count is noted
  test.info().annotations.push({ type: "no_reply events backstage", description: String(await noReplyRows.count()) });
  expect((await doseRows(phone, s.id, 44)).filter((d) => d.medication_id === AML)).toHaveLength(1);

  // 6. her phone is told, because he allowed it: one alert, for D44 (10月7日), within 5 s; the API says the same
  const alert = fp.getByTestId("family-alert");
  await expect(alert).toHaveCount(1, { timeout: 5000 });
  await expect(alert).toHaveAttribute("data-day", "44");
  await expect(alert).toContainText("爸爸两次提醒都没回：10月7日早上的药（Amlodipine）。");
  const alerts = await getJson<{ on: boolean; alerts: { day: number; medication_id: string; reminders: number }[] }>(daughter, "/api/family/alerts", s.id);
  expect(alerts).toEqual({ on: true, alerts: [expect.objectContaining({ day: 44, medication_id: AML, reminders: 2 })] });

  // ---- D45 (Thursday) 08:45: 吃了 for both; the reminder goes away
  await at(request, s.id, 45, "08:45");
  await expect(pp.getByTestId("reminder-strip")).toHaveAttribute("data-reminder", "1", { timeout: 5000 });
  await pp.getByTestId(`dose-btn-${AML}-taken`).click();
  await pp.getByTestId(`dose-btn-${LOS}-taken`).click();
  await expect(pp.getByTestId("reminder-strip")).toHaveCount(0);
  await expect.poll(async () => (await doseRows(phone, s.id, 45)).map((d) => `${d.medication_id}:${d.state}`).sort()).toEqual([`${AML}:taken`, `${LOS}:taken`]);
  await expect(fp.getByTestId(`family-dose-${AML}`)).toHaveAttribute("data-state", "taken", { timeout: 5000 });
  // her week (Mon D42 to Thu D45): D42 and D45 all taken, D43 missed, D44 not confirmed
  const week = fp.getByTestId("family-doses");
  await expect(week).toHaveAttribute("data-days-due", "4", { timeout: 5000 });
  await expect(week).toHaveAttribute("data-days-taken", "2");
  await expect(fp.getByTestId("family-doses-days")).toHaveText("4 天里有 2 天吃了药");
  await expect(fp.getByTestId("family-doses-unconfirmed")).toHaveText("未确认：1 天");
  expect(await textBelow(fp, 18)).toEqual([]);

  // 7. 10:00: his brief, from Today's link, counts exactly what his phone recorded since the D42 visit
  await at(request, s.id, 45, "10:00");
  await pp.goto("/p/today");
  await waitLive(pp);
  await pp.getByTestId("link-brief").click();
  await expect(pp.getByTestId("page-brief")).toBeVisible();
  await expect(pp.getByTestId("page-brief")).toHaveAttribute("data-from", "43");
  await expect(pp.getByTestId("page-brief")).toHaveAttribute("data-to", "45");
  const doses = pp.getByTestId("brief-doses");
  await expect(doses).toHaveAttribute("data-due", "6");
  await expect(doses).toHaveAttribute("data-taken", "4");
  await expect(doses).toHaveAttribute("data-missed", "1");
  await expect(doses).toHaveAttribute("data-unconfirmed", "1");
  await expect(pp.getByTestId("brief-doses-missed")).toContainText("打太极");
  expect(await textBelow(pp, 18)).toEqual([]);
  const brief = (await getJson<{ brief: { window: { fromDay: number; toDay: number }; doses: BriefDoses } }>(phone, "/api/brief", s.id)).brief;
  expect(brief.window).toMatchObject({ fromDay: 43, toDay: 45 });
  expect(brief.doses).toMatchObject({ due: 6, taken: 4, missed: 1, unconfirmed: 1, missedDays: [43] });

  // the missed tai chi morning joins the one pattern question already on his list (no second question)
  await pp.goto("/p/questions");
  await waitLive(pp);
  await expect(pp.locator('[data-testid="question"][data-origin="pattern"]')).toHaveCount(1);
  await expect(pp.locator('[data-testid="question"][data-origin="pattern"] [data-testid="question-text"]')).toContainText("打太极");

  await closeAll([phone, daughter, desk]);
});
