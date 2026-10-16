/**
 * Track B on a real account (C2; real-app 8.3 real/today.spec): the medicine day, blood pressure and the brief, on the
 * new elder screens, with the automatic page checks (e2e/_checks/page-checks.ts) on every screen. The developer test
 * clock moves time (POST /api/dev/clock) and the jobs run on demand (POST /api/dev/tick). Run against a dev server on
 * PW_PORT with SPEECH_PROVIDER=devfake (the blood pressure test records a visit with the v1 transcript stand-in).
 */
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { startPushService } from "../tests/support/push-service";
import { withCrew } from "./helpers";
import { answerPermissionPrompt, stubPushSubscription } from "./push-helpers";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
// her clip starts by itself, as on the other reminder specs (the refused case has its own test at the end)
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

async function setClock(request: APIRequestContext, at: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

async function tick(request: APIRequestContext): Promise<Record<string, Record<string, number>>> {
  const res = await request.post("/api/dev/tick", { data: {} });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { reports: { job: string; counts: Record<string, number> }[] };
  return Object.fromEntries(body.reports.map((r) => [r.job, r.counts]));
}

async function account(context: BrowserContext, space: "example" | "blank"): Promise<string> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `b${randomUUID().slice(0, 12)}`, password: "a long test password", space } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { user_id: string }).user_id;
}

async function doses(context: BrowserContext, day: number) {
  const res = await context.request.get(`/api/doses?from=${day}&to=${day}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { doses: { state: string; reason: string | null; slot: string; created_at: string }[] }).doses;
}

/** A real phone's rule (e2e/m6-autoplay.spec.ts): play() is refused until a trusted tap or key reached the page. */
function refuseAutoplayUntilTapped() {
  const play = HTMLMediaElement.prototype.play;
  let tapped = false;
  for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted) tapped = true;
      },
      { capture: true },
    );
  }
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (!tapped) return Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", "NotAllowedError"));
    return play.call(this);
  };
}

/** His readings as the account's blood pressure page reads them (GET /api/bp). */
async function bpReadings(context: BrowserContext) {
  const res = await context.request.get("/api/bp");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { readings: { day: number; slot: string; state: string }[] }).readings;
}

async function openToday(page: Page, query = ""): Promise<void> {
  await page.goto(`/p/today${query}`);
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("an account's medicine day: 8:45 reminder, her clip, 没吃 and why, 吃了 and undo, 等一下, no reply then 10:20", async ({ browser, request }) => {
  // laid out on Mon 12 Oct at 10:00: d0 Mon 31 Aug, tai chi on Tue and Thu; today's window closed before he started
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context, "example");
  const page = await context.newPage();

  // Tue 13 Oct 08:40: before the reminder the buttons already work; nothing is chosen
  await setClock(request, SGT("2026-10-13", "08:40"));
  await openToday(page);
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "coming");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，8:45 提醒你。");
  // the day is one line: his routine up to now comes first (breakfast at 8:30 is where he is), and the bar to say or
  // type a sentence is always at the bottom
  await expect(page.getByTestId("today-routine-now")).toContainText("8:30");
  await expect(page.getByTestId("say-type")).toBeVisible();
  await expect(page.getByTestId("dose-taken")).toBeVisible();
  await expect(page.getByTestId("dose-taken")).not.toHaveAttribute("aria-pressed", /.*/);
  await expect(page.getByTestId("dose-med-med-amlodipine")).toContainText("Amlodipine 5 mg");
  await expect(page.getByTestId("dose-med-med-amlodipine")).toContainText("Take ONE tablet every MORNING");
  await expectPageChecks(page, { side: "elder" });

  // 08:45: the job sends the first reminder once; the notice opens the slot with her clip
  await setClock(request, SGT("2026-10-13", "08:45"));
  expect((await tick(request))["daily.doses"].first).toBeGreaterThanOrEqual(1);
  expect((await tick(request))["daily.doses"].first).toBe(0);
  await openToday(page, "?remind=dose-morning");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await expect(page.getByTestId("her-reminder")).toBeVisible();
  await expect(page.getByTestId("her-words")).toHaveText("「爸，早餐吃了吗？药记得吃哦。」");
  await expect(page.getByTestId("her-reminder")).toContainText("代录音");
  // 「看原文」 on the medicine's row opens the medicine's page
  await expect(page.getByTestId("dose-med-label-med-amlodipine")).toHaveAttribute("href", "/p/meds/med-amlodipine");
  await expectPageChecks(page, { side: "elder" });

  // a tai chi morning: 还没吃, then why (打太极 first), recorded with his reason
  await page.getByTestId("dose-missed").click();
  await expect(page.getByTestId("dose-reasons")).toBeVisible();
  await expect(page.getByTestId("dose-reasons").locator("[data-reason]").first()).toHaveAttribute("data-reason", "tai_chi_morning");
  await expect(page.getByTestId("undo-toast")).toContainText("已记下：还没吃");
  await page.getByTestId("dose-reasons").locator('[data-reason="tai_chi_morning"]').click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "missed");
  await expect(page.getByTestId("dose-done")).toContainText("打太极");
  await expect(page.getByTestId("undo-toast")).toContainText("已记下：没吃（打太极）");
  await expect.poll(async () => (await doses(context, 43)).map((d) => `${d.state}:${d.reason}`)).toEqual(["missed:tai_chi_morning"]);

  // Wed 14 Oct 08:52: 吃了, written at 08:52; undo deletes the row; 吃了 again
  await setClock(request, SGT("2026-10-14", "08:52"));
  await openToday(page);
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(page.getByTestId("dose-done")).toContainText("早上 8:52 吃的。");
  await expect(page.getByTestId("undo-toast")).toContainText("已记下：吃了");
  await expectPageChecks(page, { side: "elder" });
  await expect.poll(async () => (await doses(context, 44)).map((d) => d.state)).toEqual(["taken"]);
  await page.getByTestId("undo-toast").getByRole("button").click();
  await expect.poll(async () => (await doses(context, 44)).length).toBe(0);
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect.poll(async () => (await doses(context, 44)).map((d) => d.state)).toEqual(["taken"]);

  // Thu 15 Oct 08:50: 等一下 says when Ripple asks again; the second reminder still comes
  await setClock(request, SGT("2026-10-15", "08:50"));
  await openToday(page);
  await page.getByTestId("dose-later").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "later");
  await expect(page.getByTestId("dose-done")).toHaveText("好，9:15 再问你。");
  await expect(page.getByTestId("undo-toast")).toContainText("已记下：等一下");
  await setClock(request, SGT("2026-10-15", "09:15"));
  expect((await tick(request))["daily.doses"].second).toBeGreaterThanOrEqual(1);
  // from the second reminder on, the screen asks again
  await openToday(page, "?remind=dose-morning");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await expect(page.getByTestId("dose-taken")).toBeVisible();

  // Fri 16 Oct: no answer at all -> at 09:45 the window is settled as no reply; at 10:20 he logs it, written at 10:20
  await setClock(request, SGT("2026-10-16", "09:46"));
  await tick(request);
  await expect.poll(async () => (await doses(context, 46)).map((d) => `${d.state}:${d.reason}`)).toEqual(["unconfirmed:no_reply"]);
  await openToday(page);
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "closed");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，到 9:45 还没记。");
  // the line says what happened before: both reminders went out
  await expect(page.getByTestId("dose-section")).toContainText("8:45提醒过");
  await expect(page.getByTestId("dose-section")).toContainText("9:15又问了一次");
  await expect(page.getByTestId("dose-later")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });
  await setClock(request, SGT("2026-10-16", "10:20"));
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toContainText("早上 10:20 吃的。");
  await expect.poll(async () => (await doses(context, 46)).map((d) => d.state)).toEqual(["taken"]);

  // the day is the server's: a day in the request is refused; yesterday may be answered
  const withDay = await context.request.post("/api/doses", { data: { medication_id: "med-amlodipine", slot: "morning", state: "taken", day: 40 } });
  expect(withDay.status()).toBe(400);
  const y = await context.request.post("/api/doses", { data: { medication_id: "med-amlodipine", slot: "morning", state: "taken", when: "yesterday" } });
  expect(y.status()).toBe(200);
  expect(((await y.json()) as { dose: { day: number } }).dose.day).toBe(45);
  await context.close();
});

test("an account's blood pressure: the doctor's frequency, keypad, change, delete, the relay above the warning line", async ({ browser, request }) => {
  // a blank account; his first visit (the v1 transcript stand-in) is recorded and confirmed through the visit API
  await setClock(request, SGT("2026-10-12", "09:00"));
  const context = await browser.newContext();
  await account(context, "blank");
  await setClock(request, SGT("2026-10-12", "09:30"));
  const start = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(start.status(), await start.text()).toBe(200);
  const visitId = ((await start.json()) as { visit: { id: string } }).visit.id;
  const job = await context.request.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": "v1" } });
  expect(job.status(), await job.text()).toBe(200);
  const jobId = ((await job.json()) as { job_id: string }).job_id;
  await expect.poll(async () => ((await (await context.request.get(`/api/asr/jobs/${encodeURIComponent(jobId)}`)).json()) as { status: string }).status).toBe("done");
  const fin = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/finalize`, { data: { job_id: jobId } });
  expect(fin.status(), await fin.text()).toBe(200);
  const view = ((await fin.json()) as { view: { lines: { id: string; role: string }[]; cards: { rows?: { itemId?: string }[] }[] } }).view;
  const mine = view.lines.filter((l) => l.role === "patient").map((l) => l.id);
  const items = Object.fromEntries(view.cards.flatMap((c) => (c.rows ?? []).map((r) => r.itemId).filter(Boolean)).map((id) => [id as string, "right"]));
  const conf = await context.request.post(`/api/visits/${encodeURIComponent(visitId)}/confirm`, { data: { mine, items } });
  expect(conf.status(), await conf.text()).toBe(200);

  // Tue 13 Oct 08:01: the doctor's "one week, morning and evening" -> this morning's reminder, once
  await setClock(request, SGT("2026-10-13", "08:01"));
  expect((await tick(request))["daily.bp"].reminded).toBeGreaterThanOrEqual(1);
  const page = await context.newPage();
  await page.goto("/p/today");
  await expect(page.getByTestId("bp-part-morning")).toHaveAttribute("data-state", "due");
  await page.goto("/p/bp");
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("bp-target")).toContainText("At home, we want it below 135 over 85.");
  await expect(page.getByTestId("bp-target")).toHaveAttribute("data-state", "confirmed");
  await expect(page.getByTestId("bp-plan-words")).toContainText("measure at home for one week, morning and evening");
  await expect(page.getByTestId("bp-plan")).toHaveAttribute("data-today", "morning:due,evening:due");
  await expectPageChecks(page, { side: "elder" });

  // the page opens on the week (the timeline draft's 03-3a); 「记一次血压」 brings the keypad (03-1)
  await page.getByTestId("bp-record-open").click();
  const keypad = page.locator('[data-rp="bp-keypad"]');
  const type = async (digits: string) => {
    for (const d of digits) await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
  };
  await type("14288");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-reading", "142/88");
  await expect(page.getByTestId("threshold-relay")).toHaveCount(0);
  await expect(page.getByTestId("bp-today-reading")).toHaveAttribute("data-reading", "142/88");
  await expectPageChecks(page, { side: "elder" });

  // change it: the keypad comes back empty under 「正在改 142/88」; 138/82 is saved on the same reading
  await page.getByTestId("bp-change").click();
  await expect(page.getByTestId("page-bp")).toContainText("正在改 142/88");
  await type("13882");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-kind", "corrected");
  await expect(page.getByTestId("bp-today-reading")).toHaveAttribute("data-reading", "138/82");
  await expect(page.getByTestId("bp-today-reading")).toHaveCount(1);

  // delete it, and undo
  await page.getByTestId("bp-delete").click();
  await expect(page.getByTestId("bp-undo")).toContainText("删掉了：138/82");
  await expect(page.getByTestId("bp-today-reading")).toHaveCount(0);
  await page.getByTestId("bp-undo").getByRole("button").click();
  await expect(page.getByTestId("bp-today-reading")).toHaveAttribute("data-reading", "138/82");

  // a reading above the doctor's warning line: the 995 template first, then his words, 医生说 (confirmed)
  // (the delete went back to the week, the draft's 03-5b: the saved view is gone, the keypad is one tap away)
  await expect(page.getByTestId("bp-again")).toHaveCount(0);
  await page.getByTestId("bp-record-open").click();
  await type("185112");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-saved")).toHaveAttribute("data-reading", "185/112");
  const relay = page.getByTestId("bp-saved").getByTestId("threshold-relay");
  await expect(relay).toHaveAttribute("data-state", "confirmed");
  await expect(relay.getByTestId("relay-template")).toContainText("现在就打 995 叫救护车，不确定也要打。");
  await expect(relay.getByTestId("relay-doctor")).toContainText("If your reading at home is above 180 on top");
  await expect(relay.locator('a[href^="tel:995"]').first()).toBeVisible();
  await expectPageChecks(page, { side: "elder" });

  // the morning part is done: Today says so; at noon nothing is recorded as not measured for it. The job serves every
  // account on the server (other specs leave accounts with a doctor's plan behind), so its counts are not this
  // account's: this account's own readings are what is checked
  await page.goto("/p/today");
  await expect(page.getByTestId("bp-part-morning")).toHaveAttribute("data-state", "done");
  const notMeasured = async () => (await bpReadings(context)).filter((r) => r.day === 1 && r.state === "unconfirmed").map((r) => r.slot);
  await setClock(request, SGT("2026-10-13", "12:01"));
  await tick(request);
  expect(await notMeasured()).toEqual([]);
  // the evening part passes with nothing: one "not measured" for it, written once however often the job runs
  await setClock(request, SGT("2026-10-13", "23:01"));
  await tick(request);
  await tick(request);
  expect(await notMeasured()).toEqual(["evening"]);
  await page.goto("/p/today");
  await expect(page.getByTestId("bp-part-evening")).toHaveAttribute("data-state", "not_measured");
  await context.close();
});

test("a reading from yesterday: no entry on the day he started; the next day 早上 or 晚上, the keypad, 「记下了」 with yesterday's date", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "09:00"));
  const context = await browser.newContext();
  await account(context, "blank");
  const page = await context.newPage();
  // the day his space began there is no yesterday in it: no entry, and the address shows the usual screen
  await page.goto("/p/bp");
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("bp-yesterday-entry")).toHaveCount(0);
  await page.goto("/p/bp?when=yesterday");
  await expect(page.getByTestId("page-bp")).toBeVisible();
  await expect(page.getByTestId("page-bp-yesterday")).toHaveCount(0);

  // Tue 13 Oct 08:00: he measured last night and did not write it down
  await setClock(request, SGT("2026-10-13", "08:00"));
  await page.goto("/p/bp");
  await expect(page.getByTestId("bp-yesterday-open")).toHaveText("补记昨天的读数");
  await expectPageChecks(page, { side: "elder" });
  await page.getByTestId("bp-yesterday-open").click();
  const y = page.getByTestId("page-bp-yesterday");
  await expect(y).toHaveAttribute("data-date", "2026-10-12");
  await expect(y).toContainText("昨天是10月12日。选是什么时候量的：");
  // one thing on this screen: no keypad before he says which reading it was
  await expect(page.locator('[data-rp="bp-keypad"]')).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });

  await page.getByTestId("bp-yesterday-evening").click();
  await expect(y).toHaveAttribute("data-part", "evening");
  await expect(page.getByTestId("bp-yesterday-typing")).toHaveText("昨天（10月12日）晚上。输当时的两个数：");
  await expectPageChecks(page, { side: "elder" });
  // he can still change his mind about which reading it was
  await page.getByTestId("bp-yesterday-other").click();
  await page.getByTestId("bp-yesterday-morning").click();
  await expect(page.getByTestId("bp-yesterday-typing")).toContainText("昨天（10月12日）早上");
  await page.getByTestId("bp-yesterday-other").click();
  await page.getByTestId("bp-yesterday-evening").click();

  const keypad = page.locator('[data-rp="bp-keypad"]');
  for (const d of "13884") await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
  await page.getByTestId("bp-save").click();
  const saved = page.getByTestId("bp-yesterday-saved");
  await expect(saved).toHaveAttribute("data-reading", "138/84");
  await expect(saved).toHaveAttribute("data-part", "evening");
  await expect(saved).toContainText("记下了：138/84");
  await expect(saved).toContainText("昨天（10月12日）晚上");
  await expect(page.getByTestId("threshold-relay")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });

  // the record: yesterday (his day 0), the evening reading; nothing of today
  expect((await bpReadings(context)).map((r) => [r.day, r.slot, r.state])).toEqual([[0, "evening", "recorded"]]);
  await page.getByTestId("bp-yesterday-done").click();
  await expect(page.getByTestId("page-bp")).toBeVisible();
  await expect(page.getByTestId("bp-today-empty")).toBeVisible();
  await expect(page.getByTestId("bp-earlier-reading")).toHaveText("138/84");
  await expect(page.getByTestId("page-bp")).toContainText("10月12日 晚上");
  // the English screen says the same day and part
  await page.goto("/p/bp?when=yesterday&lang=en");
  await expect(page.getByTestId("page-bp-yesterday")).toContainText("Yesterday was 12 Oct. Choose when it was measured:");
  await context.close();
});

test("an account's brief: since the last visit that happened, the doctor's view in English", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context, "example");
  const page = await context.newPage();
  // Today first: this morning's window closed before he started (real-app 4.4), a calm line, the day's overview stays
  await openToday(page);
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "untracked");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，要记的话现在可以记。");
  await expect(page.getByTestId("countdown-section")).toHaveAttribute("data-days", "0");
  await expectPageChecks(page, { side: "elder" });
  await page.goto("/p/brief");
  await expect(page.getByTestId("page-brief")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("brief-window")).toHaveText("上次看诊（9月8日）之后：9月9日到10月12日");
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "10");
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-avg", "140/85");
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-not-below", "9");
  await expect(page.getByTestId("brief-doses")).toHaveAttribute("data-due", "33");
  await expect(page.getByTestId("brief-doses")).toHaveAttribute("data-taken", "29");
  await expect(page.getByTestId("brief-questions")).toHaveAttribute("data-count", "3");
  // track K's diet line only once he answered a diet check in the window: none on the fresh example
  await expect(page.getByTestId("brief-diet")).toHaveCount(0);
  await expectPageChecks(page, { side: "elder" });
  await page.getByTestId("brief-show-doctor").click();
  await expect(page.getByTestId("brief-doctor")).toHaveAttribute("data-lang", "en");
  await expect(page.getByTestId("brief-doctor")).toContainText("Since the visit on 8 Sep");
  await expect(page.getByTestId("brief-doctor")).toContainText("10 readings, average 140/85");
  // the example's q-extra-tablet is a recorded summary until he asks it himself: said so, never "his own words"
  const summary = page.getByTestId("brief-doctor").locator('[data-testid="brief-question"][data-question="q-extra-tablet"]');
  await expect(summary).toHaveAttribute("data-wording", "recorded_summary");
  await expect(summary).toContainText("Recorded summary, not his own words");
  await expect(summary).not.toContainText("his own words, not translated");
  await expectPageChecks(page, { side: "elder" });
  await page.getByTestId("brief-doctor-lang").click();
  await expect(page.getByTestId("brief-doctor")).toHaveAttribute("data-lang", "zh-Hans");
  await page.getByTestId("brief-doctor-done").click();
  await expect(page.getByTestId("page-brief")).toBeVisible();

  // track K's daily diet question is its own entry of the day's line, after blood pressure (Dr Lim's diet line at v1):
  // his answer is noted, the question is gone until tomorrow, and the brief now carries the count
  await openToday(page);
  const diet = page.getByTestId("today-diet");
  await expect(diet).toBeVisible();
  await expect(page.locator('[data-today-section="diet"]').getByTestId("today-diet")).toHaveCount(1);
  await expect(page.locator('[data-today-section="bp"] ~ [data-today-section="diet"]')).toHaveCount(1);
  await diet.locator('[data-testid="diet-answer"][data-answer="no"]').click();
  await expect(diet.getByTestId("diet-answered")).toContainText("已记下");
  await expectPageChecks(page, { side: "elder" });
  await openToday(page);
  await expect(page.getByTestId("today-diet")).toHaveCount(0);
  await page.goto("/p/brief");
  await expect(page.getByTestId("brief-diet")).toContainText("34 天里答了 1 天");
  await context.close();
});

test("her reminder when the browser refuses to start it: the big tap button, whose voice it is, and one tap plays it", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await context.addInitScript(refuseAutoplayUntilTapped);
  await account(context, "example");
  const page = await context.newPage();
  await setClock(request, SGT("2026-10-13", "08:45"));
  await openToday(page, "?remind=dose-morning");
  const reminder = page.getByTestId("her-reminder");
  await expect(reminder).toHaveAttribute("data-state", "blocked");
  await expect(page.getByTestId("her-words")).toHaveText("「爸，早餐吃了吗？药记得吃哦。」");
  await expect(reminder).toContainText("代录音");
  await expectPageChecks(page, { side: "elder" });
  await reminder.getByRole("button").first().click();
  await expect(reminder).toHaveAttribute("data-state", "playing");
  await expect(reminder).toContainText("代录音");
  await context.close();
});

test("someone accepted his invitation: Today asks only that (是她 / 不是), a medicine due first, and it is gone once he answers", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const him = await browser.newContext();
  await account(him, "example");
  const her = await browser.newContext();
  const herLogin = `w${randomUUID().slice(0, 12)}`;
  const made = await her.request.post("/api/dev/accounts", { data: { login: herLogin, password: "a long test password", space: "none", display_name: "Wei Ling", locale: "zh-Hans" } });
  expect(made.status(), await made.text()).toBe(201);
  // his invitation and her acceptance through track D's routes; his 「是她」 is what this test is about
  const invite = await him.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const inv = (await invite.json()) as { path: string; link: { id: string } };
  const accepted = await her.request.post("/api/family/invites/accept", { data: { token: inv.path.replace(/^\/invite\//, "") } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  const linkId = inv.link.id;

  const page = await him.newPage();
  await openToday(page);
  const card = page.getByTestId("today-family-confirm");
  await expect(card).toHaveAttribute("data-link", linkId);
  await expect(page.getByTestId("page-today")).toContainText("Wei Ling 接受了邀请，是她吗？");
  await expect(page.getByTestId("page-today")).toContainText(herLogin);
  // the one thing on the screen: no medicine, blood pressure, countdown or ask section under it
  await expect(page.locator("[data-today-section]")).toHaveCount(0);
  await expect(page.getByTestId("confirm-yes")).toBeVisible();
  await expectPageChecks(page, { side: "elder" });

  // a medicine at its reminder time comes first; the question waits
  await setClock(request, SGT("2026-10-13", "08:46"));
  await openToday(page, "?remind=dose-morning");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await expect(page.getByTestId("today-family-confirm")).toHaveCount(0);

  // back on Monday morning's calm: 是她 opens her switches; Today no longer asks
  await setClock(request, SGT("2026-10-12", "10:05"));
  await openToday(page);
  await page.getByTestId("confirm-yes").click();
  await page.waitForURL(`**/p/family/${linkId}`);
  await openToday(page);
  await expect(page.getByTestId("today-family-confirm")).toHaveCount(0);
  await expect(page.getByTestId("dose-headline")).toBeVisible();
  await him.close();
  await her.close();
});

test("an example account's Today: what the example is, in its box, once; one row leads to the ask screen's 「可以这样问」, where a tap only fills the field", async ({ browser, request }) => {
  // before the morning reminder: Today's calm overview, with the example's banner
  await setClock(request, SGT("2026-10-12", "07:40"));
  const context = await browser.newContext();
  await account(context, "example");
  const page = await context.newPage();
  await openToday(page);
  // the one-time intro (the timeline design's 22-1): the tinted box and 「知道了」
  const intro = page.locator('[data-rp="example-intro"]');
  await expect(intro.locator('[data-rp="box"][data-variant="tint"]')).toContainText("这是陈先生的示例资料");
  await expectPageChecks(page, { side: "elder" });
  await page.locator('[data-action="example-intro-dismiss"]').click();
  await expect(intro).toHaveCount(0);
  // the three sentences are on the ask screen (22-2): Today has no button that asks by itself, only the way there
  await expect(page.locator('[data-action="example-ask"]')).toHaveCount(0);
  const row = page.locator('[data-action="example-asks-open"]');
  await expect(row).toContainText("可以这样问");
  await expect(row).toContainText("示例");
  await expect(row).toContainText("今天 150/95，我能不能多吃一粒？");
  await expectPageChecks(page, { side: "elder" });
  await row.click();
  await page.waitForURL("**/p/ask");
  const asks = page.locator('[data-rp="example-asks"] [data-action="example-ask"]');
  await expect(asks).toHaveText(["今天 150/95，我能不能多吃一粒？", "我今天好累", "胸口痛"]);
  await asks.first().click();
  await expect(page.getByTestId("ask-input")).toHaveValue("今天 150/95，我能不能多吃一粒？");
  // nothing was asked for him
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-turns", "0");
  await context.close();
});

/** A browser that was never asked about notifications (a test browser answers "denied" before anyone asked). */
function neverAsked() {
  Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
}
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test("Today offers this phone's reminders once (通用-5a to 5d): the reason first, the browser's question only after his tap, allowed: subscribed and said once; refused: said once with the way to 「提醒和通知」; 「以后再说」 remembered; an iPhone's three steps", async ({ browser, request, baseURL }) => {
  // before the morning reminder: Today's calm overview; the example's one-time intro was put away earlier
  await setClock(request, SGT("2026-10-12", "07:40"));
  const phone = { baseURL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" } as const;
  const signedIn = async (context: BrowserContext): Promise<Page> => {
    await account(context, "example");
    expect((await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } })).status()).toBe(200);
    const page = await context.newPage();
    await openToday(page);
    return page;
  };

  // 通用-5a: the box says when the first reminder is and what happens without; nothing was asked of the browser yet
  const first = await browser.newContext(phone);
  await first.addInitScript(neverAsked);
  await first.addInitScript(() => {
    (window as unknown as { __asked: number }).__asked = 0;
    const ask = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...args: Parameters<typeof Notification.requestPermission>) => {
      (window as unknown as { __asked: number }).__asked += 1;
      return ask(...args);
    };
  });
  const page = await signedIn(first);
  const prompt = page.getByTestId("today-push");
  await expect(prompt).toHaveAttribute("data-state", "ask");
  await expect(prompt).toContainText("8:45 提醒你吃药，要打开通知吗？");
  await expect(prompt).toContainText("不开也能用：打开 Ripple 就看得到提醒。");
  expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked), "the browser is asked only after his tap").toBe(0);
  await expectPageChecks(page, { side: "elder" });
  // while a medicine waits for his answer the screen is about that: no box above it; it is back with the day's overview
  await setClock(request, SGT("2026-10-12", "08:46"));
  await openToday(page);
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await expect(prompt).toHaveCount(0);
  await setClock(request, SGT("2026-10-12", "07:40"));
  await openToday(page);
  await expect(prompt).toHaveAttribute("data-state", "ask");
  // 「以后再说」: the box goes and stays away on this phone; 「我 › 提醒和通知」 keeps the button
  await page.getByTestId("today-push-later").click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("dose-headline")).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await first.close();

  // 通用-5b, 5c: 「开提醒」 is what asks the browser; this one refuses, and Today says so once with the way to the settings
  // (the browser's own question is answered 「不允许」 on the first ask, and the browser remembers it: push-helpers)
  const second = await browser.newContext(phone);
  await answerPermissionPrompt(second, "denied");
  const refused = await signedIn(second);
  await refused.getByTestId("today-push-on").click();
  const line = refused.getByTestId("today-push");
  await expect(line).toHaveAttribute("data-state", "denied");
  await expect(line).toContainText("提醒没开：打开 app 时才看得到。");
  await expect(refused.getByTestId("today-push-settings")).toHaveAttribute("href", "/p/me/notifications");
  await expect(refused.getByTestId("today-push-on")).toHaveCount(0);
  await expectPageChecks(refused, { side: "elder" });
  // never asked again (real-app 2.6): on the next visit a browser he refused shows nothing here
  await refused.reload();
  await expect(refused.getByTestId("dose-headline")).toBeVisible();
  await expect(refused.getByTestId("today-push")).toHaveCount(0);
  await second.close();

  // 通用-5b, allowed: this phone is subscribed, the server's 「提醒已经开好了」 reaches it, and the box says so once
  // (the phone's push service is the tests' own, as in e2e/push.spec.ts: headless Chromium has none)
  const service = await startPushService();
  try {
    const sub = service.newPhone({ label: "today-offer" });
    const allowing = await browser.newContext(phone);
    await answerPermissionPrompt(allowing, "granted");
    await stubPushSubscription(allowing, sub);
    const allowed = await signedIn(allowing);
    await expect(allowed.getByTestId("today-push")).toHaveAttribute("data-state", "ask");
    const welcome = service.next(sub.id);
    await allowed.getByTestId("today-push-on").click();
    await expect(allowed.getByTestId("today-push")).toHaveAttribute("data-state", "on");
    await expect(allowed.getByTestId("today-push")).toHaveText("提醒已经开好了。");
    expect((await welcome).payload).toMatchObject({ kind: "welcome", title: "提醒已经开好了" });
    await expectPageChecks(allowed, { side: "elder" });
    // on the next visit nothing is left of it
    await allowed.reload();
    await expect(allowed.getByTestId("dose-headline")).toBeVisible();
    await expect(allowed.getByTestId("today-push")).toHaveCount(0);
    await allowing.close();
  } finally {
    await service.close();
  }

  // 通用-5d: an iPhone that did not open Ripple from the Home Screen: why, and the three steps; no button that cannot work
  const third = await browser.newContext({ ...phone, userAgent: IPHONE_UA, isMobile: true, hasTouch: true });
  const iphone = await signedIn(third);
  const steps = iphone.getByTestId("today-push");
  await expect(steps).toHaveAttribute("data-state", "ios");
  await expect(steps).toContainText("iPhone 要先把 Ripple 加到主屏幕，才收得到提醒。");
  await expect(steps.locator('[data-rp="home-screen-steps"] [data-rp="row"]')).toHaveCount(3);
  await expect(iphone.getByTestId("today-push-on")).toHaveCount(0);
  await expectPageChecks(iphone, { side: "elder" });
  await iphone.getByTestId("today-push-later").click();
  await expect(steps).toHaveCount(0);
  await third.close();
});

test("a tapped tab whose page is slow to come (通用-1): the tab looks chosen at once, a line over the tab bar says 「正在打开今天的记录…」, and after three seconds 「还在打开，网络有点慢。」", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await account(context, "example");
  const page = await context.newPage();
  await page.goto("/p/questions");
  await expect(page.locator('[data-rp="questions-open"]')).toBeVisible();
  await page.waitForLoadState("networkidle");
  const tabs = page.locator('[data-rp="tabbar"]:visible');
  const today = tabs.locator('a[data-tab="today"]');
  const wait = page.getByTestId("tab-wait");
  await expect(wait).toHaveCount(0);
  /** the page's own data is held on its way (what the tab bar's link fetched ahead of the tap is let through) */
  const hold = async (path: RegExp, ms: number): Promise<{ held: number }> => {
    const seen = { held: 0 };
    await page.route(path, async (route) => {
      const h = route.request().headers();
      if (h["next-router-prefetch"] || h["next-router-segment-prefetch"]) return route.continue();
      seen.held += 1;
      await new Promise((r) => setTimeout(r, ms));
      await route.continue();
    });
    return seen;
  };

  const todayHeld = await hold(/\/p\/today\?_rsc=/, 6000);
  await today.click();
  // at once: the tab he tapped looks chosen, the one he is leaving no longer; the page is still the old one
  await expect(today.locator('[data-rp="tab-going"]')).toHaveCount(1);
  expect(await today.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("800");
  expect(await tabs.locator('a[data-tab="questions"]').evaluate((el) => getComputedStyle(el).fontWeight)).toBe("500");
  // after a moment: one line over the bar, in the draft's words for Today
  await expect(wait).toHaveAttribute("data-slow", "false");
  await expect(wait).toHaveAttribute("data-tab", "today");
  await expect(wait).toHaveText("正在打开今天的记录…");
  expect(new URL(page.url()).pathname).toBe("/p/questions");
  // it stands on the bar's top edge, as wide as the bar, and the page under it did not move
  const bar = (await tabs.boundingBox())!;
  const line = (await wait.boundingBox())!;
  expect(Math.abs(line.y + line.height - bar.y)).toBeLessThanOrEqual(1.5);
  expect(Math.round(line.width)).toBe(Math.round(bar.width));
  await expectPageChecks(page, { side: "elder" });
  // after three seconds it says that it is slow, and that sentence is the one a screen reader hears
  await expect(wait).toHaveAttribute("data-slow", "true", { timeout: 6000 });
  await expect(wait.locator('[role="status"]')).toHaveText("还在打开，网络有点慢。");
  await expectPageChecks(page, { side: "elder" });
  // then the day itself, and nothing of the wait is left
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account", { timeout: 15_000 });
  await expect(wait).toHaveCount(0);
  await expect(page.locator('[data-rp="tab-going"]')).toHaveCount(0);
  expect(todayHeld.held).toBeGreaterThan(0);
  await page.unroute(/\/p\/today\?_rsc=/);

  // another tab: the short sentence; a page that is there within three seconds never says it is slow
  const medsHeld = await hold(/\/p\/meds\?_rsc=/, 1500);
  await tabs.locator('a[data-tab="meds"]').click();
  await expect(wait).toHaveText("正在打开……");
  await expect(wait).toHaveAttribute("data-slow", "false");
  // (he is leaving Today: its 「按一下说」 bar stands where the line goes, and gives the place up for that moment)
  await expect(page.locator('[data-rp="say-bar"]')).toBeHidden();
  await page.waitForURL(/\/p\/meds$/, { timeout: 15_000 });
  await expect(wait).toHaveCount(0);
  expect(medsHeld.held).toBeGreaterThan(0);
  await context.close();
});

test("a filming account's Today (通用-6): laid out to a morning of the story, the day is drawn as on any other day and nothing of the crew's is on the phone", async ({ browser, request, baseURL }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  // his phone carries his own sign-in and the crew's cookie (real-app 12, 「拍摄账号」); the director lays it out to
  // Sat 19 Sep of the story (Day 26) at 8:46, a minute after the morning reminder
  const context = await withCrew(await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" }));
  await account(context, "example");
  expect((await context.request.post("/api/crew/filming-account")).status()).toBe(200);
  const ref = ((await (await context.request.get("/api/crew/filming-account")).json()) as { ref: string }).ref;
  const laid = await context.request.post(`/api/crew/filming-account/accounts/${ref}`, { data: { action: "seed", day: 26, time: "08:46" } });
  expect(laid.status(), await laid.text()).toBe(200);

  const page = await context.newPage();
  /** what only the crew may see: the story's day number, the jump menu, the debug line, the account's filming code */
  const nothingOfTheCrew = async (where: string) => {
    await expect(page.locator('[data-testid="jump-menu"], [data-testid="debug-info"], [data-testid="story-day-label"]'), where).toHaveCount(0);
    const text = await page.locator("body").innerText();
    expect(text, where).not.toMatch(/Day\s?\d+|第\s*\d+\s*天|加入码|拍摄|场次|示例/);
    expect(text, where).not.toContain(ref);
  };
  await openToday(page);
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-day", "2026-09-19");
  await expect(page.locator('[data-rp="meta"]')).toContainText("9月19日 周六");
  await expect(page.getByTestId("dose-headline")).toHaveText("早上的药，还没记。");
  await nothingOfTheCrew("Today at the reminder");
  await expectPageChecks(page, { side: "elder" });
  // the rest is as on any other day: 「吃了」 is written at the story's minute, and the day's line has it afterwards
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(page.getByTestId("dose-done")).toContainText(/早上 8:4[67] 吃的。/);
  await openToday(page);
  await nothingOfTheCrew("Today after 「吃了」");
  await expectPageChecks(page, { side: "elder" });
  // the ask screen of the same phone: no example sentences (the records are the story's, not an example), nothing of the crew's
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  await expect(page.locator('[data-rp="example-asks"]')).toHaveCount(0);
  await nothingOfTheCrew("问一句");
  // filming ends: the account is on the real date again
  expect((await context.request.post(`/api/crew/filming-account/accounts/${ref}`, { data: { action: "end" } })).status()).toBe(200);
  await context.close();
});
