/**
 * 03 量血压, on a real account (C2 track B; real-app 2.9; e2e-chains 4 and 16.1). One phone, his.
 *
 * Setup (not recorded): the developer test clock stands at Mon 12 Oct 2026 09:00 and a blank account is made (POST
 * /api/dev/accounts, the phone signed in). At 09:30 his first visit is recorded through the visit API with the v1
 * transcript stand-in (SPEECH_PROVIDER=devfake), finalized, and he confirms his lines and every item: among them the
 * doctor's target (「At home, we want it below 135 over 85.」), the warning line (above 180 on top: A&E or 995) and how
 * often to measure (「…measure at home for one week, morning and evening.」). The jobs run on demand (POST /api/dev/tick).
 *
 *   Tue 13  07:50  Today: 「量血压 · 早上 8:00 起」 (from the doctor's frequency he confirmed; nothing before it)
 *           08:00  the job sends 「该量血压了」 once (the banner is drawn by the recorder: push is track I's)
 *                  /p/bp opens on the week (the timeline draft's 03-3a): 「该量血压了（早上）」 at the top, the doctor's
 *                  words and date under the list; 「记一次血压」 brings the keypad; 142/88 recorded with no word about it
 *                  改一下: the keypad comes back empty, 138/82; 删掉 and its 12 s undo (back on the week)
 *           20:00  the evening reminder; 185/112: the 995 template first, then the doctor's own words, 医生说
 *           20:05  Today: both parts measured, only the times
 *   Wed 14  12:01  the morning passed with no reading: recorded once as not measured; Today says 「早上这次没量」
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext, BrowserContext, Locator } from "@playwright/test";
import { expect, journey } from "./_kit";

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

async function clock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

/** One pass of the blood pressure job (every account on the server; the counts are summed). */
async function tick(request: APIRequestContext): Promise<Record<string, number>> {
  const res = await request.post("/api/dev/tick", { data: { names: ["daily.bp"] } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { reports: { job: string; counts: Record<string, number> }[] };
  return body.reports.find((r) => r.job === "daily.bp")?.counts ?? {};
}

/** His first visit, recorded with the v1 transcript stand-in, finalized and confirmed (his lines, every item right). */
async function firstVisit(context: BrowserContext): Promise<void> {
  const start = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(start.status(), await start.text()).toBe(200);
  const visitId = ((await start.json()) as { visit: { id: string } }).visit.id;
  const job = await context.request.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": "v1" } });
  expect(job.status(), await job.text()).toBe(200);
  const jobId = ((await job.json()) as { job_id: string }).job_id;
  await expect
    .poll(async () => ((await (await context.request.get(`/api/asr/jobs/${encodeURIComponent(jobId)}`)).json()) as { status: string }).status, { timeout: 30_000 })
    .toBe("done");
  const fin = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/finalize`, { data: { job_id: jobId } });
  expect(fin.status(), await fin.text()).toBe(200);
  const view = ((await fin.json()) as { view: { lines: { id: string; role: string }[]; cards: { rows?: { itemId?: string }[] }[] } }).view;
  const mine = view.lines.filter((l) => l.role === "patient").map((l) => l.id);
  const items = Object.fromEntries(view.cards.flatMap((c) => (c.rows ?? []).map((r) => r.itemId).filter(Boolean)).map((id) => [id as string, "right"]));
  const conf = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/confirm`, { data: { mine, items } });
  expect(conf.status(), await conf.text()).toBe(200);
}

async function readingsOf(context: BrowserContext) {
  const res = await context.request.get("/api/bp");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { readings: { day: number; slot: string; systolic: number | null; diastolic: number | null; state: string }[] }).readings;
}

journey.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

journey("03 量血压", async ({ kit, request }) => {
  kit.cornerLabel("转写：测试替身 · 通知横幅：录屏示意");
  await clock(request, SGT("2026-10-12", "09:00"));
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const ctx = elder.context;
  const made = await ctx.request.post("/api/dev/accounts", { data: { login: `tan${randomUUID().slice(0, 8)}`, password: "a long test password", space: "blank" } });
  expect(made.status(), await made.text()).toBe(201);
  await clock(request, SGT("2026-10-12", "09:30"));
  await firstVisit(ctx);
  const pp = elder.page;
  const keypad = pp.locator('[data-rp="bp-keypad"]');
  const type = async (digits: string) => {
    for (const d of digits) await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
  };
  const saved = pp.getByTestId("bp-saved");
  const todayReading = pp.getByTestId("bp-today-reading");
  const show = async (target: Locator) => kit.show(target);

  await clock(request, SGT("2026-10-13", "07:50"));
  await tick(request);
  await pp.goto("/p/today");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await kit.step(pp, "周二 7:50：昨天看诊时医生交代过怎么量，他确认过；「今天」页写着早上 8:00 起量血压");
  const morning = pp.getByTestId("bp-part-morning");
  await expect(morning).toHaveAttribute("data-state", "later");
  await expect(pp.getByTestId("bp-section")).toContainText("早上 8:00 起");
  await expect(pp.getByTestId("bp-part-evening")).toHaveAttribute("data-state", "later");
  await show(pp.getByTestId("bp-section"));

  await kit.step(pp, "8:00 到点提醒：锁屏写「该量血压了」，只提醒一次");
  await clock(request, SGT("2026-10-13", "08:00"));
  expect((await tick(request)).reminded).toBeGreaterThanOrEqual(1);
  expect((await tick(request)).reminded).toBe(0);
  await kit.showNotification(pp, { title: "该量血压了", body: "打开 Ripple 记一次", app: "Ripple", time: "8:00" });
  await kit.pause(2200);
  await pp.goto("/p/bp");
  await expect(pp.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");

  await kit.step(pp, "点开「血压」页：医生交代的这次该量了；下面是他的原话和日期");
  await expect(pp.getByTestId("bp-due")).toContainText("该量血压了（早上）");
  await expect(pp.getByTestId("bp-plan-words")).toContainText("I want you to measure at home for one week, morning and evening.");
  await expect(pp.getByTestId("bp-plan")).toHaveAttribute("data-today", "morning:due,evening:due");
  await expect(pp.getByTestId("bp-target")).toContainText("At home, we want it below 135 over 85.");
  await expect(pp.getByTestId("bp-target")).toHaveAttribute("data-state", "confirmed");
  await show(pp.getByTestId("bp-plan"));
  await kit.pause(1200);
  await show(pp.getByTestId("bp-target"));
  await kit.pause(1200);
  await show(pp.getByTestId("bp-due"));

  await kit.step(pp, "点「记一次血压」，照血压计输 142 和 88，点「记下」：只记数和时间，不评价");
  await pp.getByTestId("bp-record-open").click();
  await show(keypad);
  await type("14288");
  await pp.getByTestId("bp-save").click();
  await expect(saved).toHaveAttribute("data-reading", "142/88");
  await expect(saved).toContainText("记下了：142/88");
  await expect(saved).toContainText("早上 8:00");
  await expect(pp.getByTestId("threshold-relay")).toHaveCount(0);
  await expect(todayReading).toHaveAttribute("data-reading", "142/88");
  await expect.poll(async () => (await readingsOf(ctx)).filter((r) => r.day === 1).map((r) => `${r.slot}:${r.systolic}/${r.diastolic}`)).toEqual(["morning:142/88"]);

  await kit.step(pp, "数看错了：点「改一下」，键盘空着重新输 138/82");
  await show(todayReading);
  await pp.getByTestId("bp-change").click();
  await expect(pp.getByTestId("page-bp")).toContainText("正在改 142/88");
  await show(keypad);
  await type("13882");
  await pp.getByTestId("bp-save").click();
  await expect(saved).toHaveAttribute("data-kind", "corrected");
  await expect(todayReading).toHaveCount(1);
  await expect(todayReading).toHaveAttribute("data-reading", "138/82");
  await expect.poll(async () => (await readingsOf(ctx)).filter((r) => r.day === 1).map((r) => `${r.systolic}/${r.diastolic}`)).toEqual(["138/82"]);

  await kit.step(pp, "点「删掉」，这次读数就没了；底部撤销条 12 秒内能放回来");
  await show(todayReading);
  await pp.getByTestId("bp-delete").click();
  await expect(pp.getByTestId("bp-undo")).toContainText("删掉了：138/82");
  await expect(todayReading).toHaveCount(0);
  await expect.poll(async () => (await readingsOf(ctx)).filter((r) => r.day === 1).length).toBe(0);
  await kit.pause(1200);
  await pp.getByTestId("bp-undo").getByRole("button").click();
  await expect(todayReading).toHaveAttribute("data-reading", "138/82");
  await expect.poll(async () => (await readingsOf(ctx)).filter((r) => r.day === 1).map((r) => `${r.systolic}/${r.diastolic}`)).toEqual(["138/82"]);

  await kit.step(pp, "晚上 8 点又提醒；这次量到 185/112");
  await clock(request, SGT("2026-10-13", "20:00"));
  expect((await tick(request)).reminded).toBeGreaterThanOrEqual(1);
  await kit.showNotification(pp, { title: "该量血压了", body: "打开 Ripple 记一次", app: "Ripple", time: "20:00", durationMs: 2500 });
  await kit.pause(1500);
  await pp.goto("/p/bp");
  await expect(pp.getByTestId("bp-plan")).toHaveAttribute("data-today", "morning:done,evening:due");
  await pp.getByTestId("bp-record-open").click();
  await type("185112");
  await pp.getByTestId("bp-save").click();
  await expect(saved).toHaveAttribute("data-reading", "185/112");

  await kit.step(pp, "185 在医生说的那条线（180）上面：先是固定的 995 那句，下面是医生自己的原话");
  const relay = saved.getByTestId("threshold-relay");
  await expect(relay).toHaveAttribute("data-state", "confirmed");
  await expect(relay.getByTestId("relay-template")).toContainText("现在就打 995 叫救护车，不确定也要打。");
  await expect(relay.getByTestId("relay-doctor")).toContainText("If your reading at home is above 180 on top");
  await expect(relay.locator('a[href^="tel:995"]').first()).toBeVisible();
  await show(relay.getByTestId("relay-doctor"));
  await kit.pause(2500);

  await clock(request, SGT("2026-10-13", "20:05"));
  await pp.goto("/p/today");
  await kit.step(pp, "回到「今天」：早上、晚上都写着量过了和几点，没有一个读数");
  await expect(morning).toHaveAttribute("data-state", "done");
  await expect(pp.getByTestId("bp-part-evening")).toHaveAttribute("data-state", "done");
  await expect(pp.getByTestId("bp-section")).toContainText("早上量过了 · 8:00");
  await expect(pp.getByTestId("bp-section")).toContainText("晚上量过了 · 20:00");
  await expect(pp.getByTestId("bp-section")).not.toContainText("185");
  await show(pp.getByTestId("bp-section"));

  await kit.step(pp, "第二天早上没量：中午 12 点记一次「这次没量」，不催也不评价");
  await clock(request, SGT("2026-10-14", "12:01"));
  expect((await tick(request)).not_measured).toBeGreaterThanOrEqual(1);
  expect((await tick(request)).not_measured).toBe(0);
  await pp.goto("/p/today");
  await expect(morning).toHaveAttribute("data-state", "not_measured");
  await expect(pp.getByTestId("bp-section")).toContainText("早上这次没量");
  await expect.poll(async () => (await readingsOf(ctx)).filter((r) => r.day === 2).map((r) => `${r.slot}:${r.state}`)).toEqual(["morning:unconfirmed"]);
  await show(pp.getByTestId("bp-section"));
  await kit.pause(1500);

  await kit.finish();
});
