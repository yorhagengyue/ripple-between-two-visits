/**
 * The visit flow on his own account, against the written design (C2 track V; docs/plan/real-app.md 2.12-2.14, 2.25,
 * 4.4, 4.6). His recording on the phone is the thing these tests protect:
 *
 *   - an unfinished visit reopened by its row (?visit=<id>) uploads the copy kept on the phone, never an empty record;
 *   - the last seconds are on the phone too (a short recording, a failed upload, a page that goes to the background);
 *   - a kept copy is never deleted because its visit is not on the page's list, and another account signed in on the
 *     same phone neither sees nor deletes it;
 *   - the phone copy goes only once the server holds the recording.
 * And the screens the design asks for: 「还没有看诊」 + 「开始」 on an empty list, the planned follow-up on its own row,
 * 「先给医生看简报」 / 「直接开始」 between where and consent, a doctor's 「不同意」 that is recorded before the screen says
 * so, the fixed line on a server without transcription, 「录音已存，等转写」 on Today, 「示例回放」 on the sample replay.
 *
 * Needs the app on PW_PORT with the developer tools on (scripts/record/serve.mjs). Runs on SPEECH_PROVIDER=devfake and
 * on mock: the tests that need one of them skip on the other (the file says which at each test).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
  locale: "zh-CN",
  timezoneId: "Asia/Singapore",
});

const SHOTS = process.env.V_SHOTS_DIR?.trim() || null;
const PASSWORD = "a long test password";
let provider = "unknown";

async function check(page: Page, name: string): Promise<void> {
  // let entry animations finish (half-transparent text would read as low contrast)
  await page.waitForTimeout(400);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  }
  await expectPageChecks(page, { side: "elder" });
}

async function signUp(page: Page, space: "blank" | "example" = "blank"): Promise<string> {
  const login = `vv${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const res = await page.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space, display_name: "陈先生", locale: "zh-Hans" } });
  expect(res.status(), await res.text()).toBe(201);
  return login;
}

async function signIn(context: BrowserContext, login: string): Promise<void> {
  const res = await context.request.post("/api/dev/login", { data: { login, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
}

/** Seconds of recording kept in this browser's IndexedDB, by visit id (every store that holds PCM rows). */
async function keptSeconds(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === "ripple-recordings")) return {};
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("ripple-recordings");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const out: Record<string, number> = {};
    try {
      for (const name of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(name, "readonly").objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result as unknown[]);
          req.onerror = () => reject(req.error);
        });
        for (const r of rows as { visitId?: string; pcm?: Float32Array; rate?: number }[]) {
          if (!r.visitId || !r.pcm || !r.rate) continue;
          out[r.visitId] = (out[r.visitId] ?? 0) + r.pcm.length / r.rate;
        }
      }
    } finally {
      db.close();
    }
    return out;
  });
}

async function visitOnServer(page: Page, visitId: string): Promise<{ status: string; audioPath: string | null }> {
  const res = await page.request.get(`/api/visits/${visitId}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { view: { visit: { status: string; audioPath: string | null } } }).view.visit;
}

/** /p/visit → where → clinic or pharmacy → 「直接开始」 → the card for the doctor. */
async function toConsent(page: Page, place: "clinic" | "pharmacy" = "clinic"): Promise<void> {
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-empty").or(page.getByTestId("visit-where"))).toBeVisible();
  if (await page.getByTestId("visit-empty").count()) await page.getByTestId("visit-start").click();
  await page.getByTestId(`visit-${place}`).click();
  await expect(page.getByTestId("visit-before")).toBeVisible();
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toHaveAttribute("data-place", place);
}

/** Start recording; returns the visit's id. */
async function startRecording(page: Page): Promise<string> {
  await toConsent(page);
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  return (await live.getAttribute("data-visit"))!;
}

/** The page goes to the background (the phone is locked, another app comes up): what a phone browser tells the page. */
async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  provider = health.provider ?? "unknown";
  // a moving clock: the visits made one after another get different times (the list is newest first)
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: false } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
  test.skip(provider !== "mock" && provider !== "devfake", `needs SPEECH_PROVIDER=mock or devfake, this server has ${provider}`);
});

test("an empty visit list says so and has one button to start (real-app 2.25)", async ({ page }) => {
  await signUp(page);
  await page.goto("/p/visit");
  const empty = page.getByTestId("visit-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("还没有看诊");
  await expect(page.getByTestId("visit-start")).toHaveText("开始");
  await check(page, "visit-empty");
  await page.getByTestId("visit-start").click();
  await expect(page.getByTestId("visit-where")).toBeVisible();
  await expect(page.getByTestId("visit-where")).toContainText("在哪里看？");
  await check(page, "visit-where");
});

test("between where and consent: show the doctor the brief first (and come back to the visit), or start (real-app 2.12)", async ({ page }) => {
  await signUp(page);
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  const before = page.getByTestId("visit-before");
  await expect(before).toBeVisible();
  await expect(page.getByTestId("visit-brief-first")).toHaveText("先给医生看简报");
  await expect(page.getByTestId("visit-direct")).toHaveText("直接开始");
  await check(page, "visit-before");

  // the brief for the doctor, then back into the visit at the card for the doctor (the place he chose is kept)
  await page.getByTestId("visit-brief-first").click();
  await expect(page.getByTestId("brief-doctor")).toBeVisible();
  await page.getByTestId("brief-doctor-done").click();
  await expect(page.getByTestId("visit-consent")).toHaveAttribute("data-place", "clinic");
  expect(new URL(page.url()).pathname).toBe("/p/visit");

  // the pharmacy keeps its place through the same detour
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-pharmacy").click();
  await page.getByTestId("visit-brief-first").click();
  await page.getByTestId("brief-doctor-done").click();
  await expect(page.getByTestId("visit-consent")).toHaveAttribute("data-place", "pharmacy");

  // 「直接开始」 goes straight to the card
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toHaveAttribute("data-place", "clinic");
  // the brief opened on its own still goes back to the brief
  await page.goto("/p/brief?show=doctor");
  await page.getByTestId("brief-doctor-done").click();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe("/p/brief");
});

test("the doctor's 「不同意」 is on record before the screen says so; a failed save says so and can be tried again (real-app 2.12)", async ({ page }) => {
  await signUp(page);
  await toConsent(page);
  await expect(page.getByTestId("consent-skip")).toHaveText("医生不同意");
  let fail = true;
  await page.route("**/api/visits", async (route) => {
    if (fail && route.request().method() === "POST") await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"store_unavailable"}' });
    else await route.continue();
  });
  await page.getByTestId("consent-skip").click();
  // not saved: the screen does not say it was noted
  await expect(page.getByTestId("visit-decline-failed")).toBeVisible();
  await expect(page.getByTestId("visit-declined")).toHaveCount(0);
  await check(page, "visit-decline-failed");
  const declined = async () => {
    const res = await page.request.post("/api/me/export", { data: {} });
    expect(res.status(), await res.text()).toBe(200);
    // his own export (journey 15) lists his consent records
    const file = (await res.json()) as { tables: { consents: { kind: string; decision: string }[] } };
    return file.tables.consents.filter((c) => c.kind === "visit_recording" && c.decision === "declined").length;
  };
  expect(await declined()).toBe(0);
  fail = false;
  await page.getByTestId("visit-decline-failed").locator('[data-rp="retry"]').click();
  await expect(page.getByTestId("visit-declined")).toBeVisible();
  expect(await declined()).toBe(1);
  await check(page, "visit-declined");
});

test("an unfinished visit reopened from its row uploads the recording kept on the phone (real-app 2.13, 2.14)", async ({ page, context }) => {
  test.setTimeout(180_000);
  await signUp(page);
  const visitId = await startRecording(page);
  // past the first 10 s copy, then the page goes away without 录完了
  await page.waitForTimeout(12_500);
  await page.close();

  const again = await context.newPage();
  await again.goto("/p/visit");
  // the list's row for the visit he left: 「接着结束」 opens ?visit=<id>
  const row = again.getByTestId("visit-unfinished-row").filter({ has: again.locator(`a[href*="visit=${visitId}"]`) });
  await expect(row).toHaveCount(1);
  expect((await keptSeconds(again))[visitId]).toBeGreaterThan(9);
  await row.locator("a").click();
  await again.waitForURL(new RegExp(`/p/visit\\?visit=${visitId}$`));
  // never a recording screen (nothing is recording now): the kept recording, and one button to send it
  const reopened = again.getByTestId("visit-reopened");
  await expect(reopened).toBeVisible();
  await expect(again.getByTestId("visit-live")).toHaveCount(0);
  const card = again.getByTestId("visit-resume");
  await expect(card).toHaveAttribute("data-visit", visitId);
  await expect(card).toContainText("还没传");
  await check(again, "visit-reopened-kept");
  await again.getByTestId("visit-resume-send").click();
  await again.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  // the server holds the recording, and only now the phone copy is gone
  const saved = await visitOnServer(again, visitId);
  expect(saved.audioPath).toBeTruthy();
  expect(saved.status).toBe(provider === "mock" ? "awaiting_transcript" : "review");
  expect((await keptSeconds(again))[visitId] ?? 0).toBe(0);
});

test("the last seconds are on the phone: a short recording whose upload fails is kept, offered again and sent (real-app 2.13, 2.14)", async ({ page, context }) => {
  test.setTimeout(180_000);
  await signUp(page);
  const visitId = await startRecording(page);
  await page.waitForTimeout(4_000);
  let fail = true;
  await context.route("**/api/blob/upload**", async (route) => {
    if (fail) await route.abort();
    else await route.continue();
  });
  await page.getByTestId("visit-stop").click();
  const error = page.getByTestId("visit-error");
  await expect(error).toHaveAttribute("data-error", "upload", { timeout: 30_000 });
  await expect(error).toContainText("还在手机上");
  // the whole recording is on the phone, its last seconds too (not only the blocks of full 10 s)
  const recorded = await page.evaluate(() => (window.__rpLastRecording?.durationMs ?? 0) / 1000);
  expect(recorded).toBeGreaterThan(3);
  expect((await keptSeconds(page))[visitId]).toBeGreaterThan(recorded - 0.3);
  // a second failure keeps it as well
  await error.locator('[data-rp="retry"]').click();
  await expect(error).toHaveAttribute("data-error", "upload", { timeout: 30_000 });
  expect((await keptSeconds(page))[visitId]).toBeGreaterThan(recorded - 0.3);
  expect((await visitOnServer(page, visitId)).audioPath).toBeNull();
  await page.close();

  // he comes back later: the card on the visit page, 「现在传」 sends it
  const again = await context.newPage();
  await again.goto("/p/visit");
  const card = again.getByTestId("visit-resume");
  await expect(card).toHaveAttribute("data-visit", visitId);
  await check(again, "visit-where-resume");
  fail = false;
  await again.getByTestId("visit-resume-send").click();
  await again.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  expect((await visitOnServer(again, visitId)).audioPath).toBeTruthy();
  expect((await keptSeconds(again))[visitId] ?? 0).toBe(0);
});

test("a page that goes to the background keeps what was recorded so far (real-app 2.13)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await signUp(page);
  const visitId = await startRecording(page);
  await page.waitForTimeout(3_500);
  await hide(page);
  expect((await keptSeconds(page))[visitId]).toBeGreaterThan(2.5);
  await page.close();
  const again = await context.newPage();
  await again.goto("/p/visit");
  await expect(again.getByTestId("visit-resume")).toHaveAttribute("data-visit", visitId);
});

for (const how of ["the tab is closed", "the tab leaves for another page"] as const) {
  test(`${how} a few seconds into the recording: those seconds are on the phone (real-app 2.13)`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await signUp(page);
    const visitId = await startRecording(page);
    await page.waitForTimeout(4_000);
    // no 录完了, and no 10 s copy yet: only what the page writes as it goes away
    if (how === "the tab is closed") await page.close({ runBeforeUnload: true });
    else await page.goto("about:blank");
    const again = how === "the tab is closed" ? await context.newPage() : page;
    await again.waitForTimeout(500);
    await again.goto("/p/visit");
    const card = again.getByTestId("visit-resume");
    await expect(card).toHaveAttribute("data-visit", visitId);
    expect((await keptSeconds(again))[visitId]).toBeGreaterThan(3);
    await again.getByTestId("visit-resume-send").click();
    await again.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
    expect((await visitOnServer(again, visitId)).audioPath).toBeTruthy();
  });
}

test("a kept recording is not deleted for being off the list, and another account on the same phone neither sees nor deletes it (real-app 2.13)", async ({ page, context }) => {
  test.setTimeout(240_000);
  const first = await signUp(page);
  const visitId = await startRecording(page);
  await page.waitForTimeout(12_500);
  await page.close();

  // six more visits started and left, each newer than the one with the recording
  for (let i = 0; i < 6; i++) {
    const res = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
    expect(res.status(), await res.text()).toBe(200);
  }
  const his = await context.newPage();
  await his.goto("/p/visit");
  await expect(his.getByTestId("visit-where")).toBeVisible();
  await expect(his.getByTestId("visit-resume")).toHaveAttribute("data-visit", visitId);
  expect((await keptSeconds(his))[visitId]).toBeGreaterThan(9);
  // every unfinished visit has its row (the list is not cut short)
  await expect(his.getByTestId("visit-unfinished-row")).toHaveCount(7);
  await check(his, "visit-where-many");

  // someone else signs in on the same phone
  await signUp(his);
  await his.goto("/p/visit");
  await expect(his.getByTestId("visit-empty")).toBeVisible();
  await expect(his.getByTestId("visit-resume")).toHaveCount(0);
  await his.getByTestId("visit-start").click();
  await expect(his.getByTestId("visit-where")).toBeVisible();
  await expect(his.getByTestId("visit-resume")).toHaveCount(0);
  await his.waitForTimeout(800);
  expect((await keptSeconds(his))[visitId]).toBeGreaterThan(9);
  // the other account cannot send it either (the visit is not theirs)
  expect((await his.request.get(`/api/visits/${visitId}`)).status()).toBe(404);

  // he signs in again: his recording is still there, and goes up
  await signIn(context, first);
  await his.goto("/p/visit");
  await expect(his.getByTestId("visit-resume")).toHaveAttribute("data-visit", visitId);
  await his.getByTestId("visit-resume-send").click();
  await his.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  expect((await visitOnServer(his, visitId)).audioPath).toBeTruthy();
  expect((await keptSeconds(his))[visitId] ?? 0).toBe(0);
});

test("logging out forgets the recording this phone kept, also while a tab still holds it open, and that tab keeps nothing more (real-app 2.25)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const login = await signUp(page);
  const visitId = await startRecording(page);
  await page.waitForTimeout(11_000);
  expect((await keptSeconds(page))[visitId]).toBeGreaterThan(9);

  // another tab of the same phone: 我 → 登录和设备 → 退出登录 (track O's lib/offline/forget.ts deletes the database)
  const other = await context.newPage();
  await other.goto("/p/me/devices");
  await other.getByTestId("logout").click();
  await other.waitForURL(/\/login/);
  const databases = () => other.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  await expect.poll(databases, { timeout: 10_000 }).not.toContain("ripple-recordings");
  // the recording tab is still open: past its next 10 s copy, nothing was put back
  await other.waitForTimeout(11_000);
  expect(await databases()).not.toContain("ripple-recordings");
  await page.close();

  // he signs in again on this phone: nothing of the old recording is offered
  await signIn(context, login);
  await other.goto("/p/visit");
  await expect(other.getByTestId("visit-where")).toBeVisible();
  await other.waitForTimeout(800);
  await expect(other.getByTestId("visit-resume")).toHaveCount(0);
});

test("an unfinished visit with nothing on this phone says so and can be ended (real-app 2.13)", async ({ page, context }) => {
  await signUp(page);
  const started = await context.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  await page.goto(`/p/visit?visit=${visitId}`);
  const reopened = page.getByTestId("visit-reopened");
  await expect(reopened).toHaveAttribute("data-kept", "none");
  await expect(page.getByTestId("visit-live")).toHaveCount(0);
  await expect(page.getByTestId("visit-resume")).toHaveCount(0);
  await check(page, "visit-reopened-none");
  await page.getByTestId("visit-reopened-end").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  expect((await visitOnServer(page, visitId)).audioPath).toBeNull();
});

test("a server without transcription says so on the visit's first screens; Today shows the visit waiting for its text (real-app 2.14)", async ({ page }) => {
  test.skip(provider !== "mock", "needs SPEECH_PROVIDER=mock (the judges' deployment)");
  test.setTimeout(120_000);
  const LINE = "这台服务器没接转写服务。可以录音，录音会保存；转写服务接上后再出文字，并通知你。";
  await signUp(page);
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-empty")).toContainText(LINE);
  await check(page, "visit-empty-mock");
  await page.getByTestId("visit-start").click();
  await expect(page.getByTestId("visit-where")).toContainText(LINE);
  await check(page, "visit-where-mock");
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  const visitId = (await live.getAttribute("data-visit"))!;
  // no captions here: the fixed sentence (real-app 2.13), nothing that promises text right after
  await expect(page.getByTestId("visit-notice")).toHaveText("这台服务器没接转写：录音照常保存。");
  await page.waitForTimeout(3_000);
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  await expect(page.getByTestId("review-awaiting")).toBeVisible();
  const saved = await visitOnServer(page, visitId);
  expect(saved.status).toBe("awaiting_transcript");
  expect(saved.audioPath).toBeTruthy();
  expect((await keptSeconds(page))[visitId] ?? 0).toBe(0);

  // Today: 「录音已存，等转写」, one row, to the visit's review
  await page.goto("/p/today");
  const waiting = page.getByTestId("today-visit-waiting");
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("录音已存，等转写");
  await expect(waiting.locator("a")).toHaveAttribute("href", `/p/visit/${visitId}/review`);
  await check(page, "today-visit-waiting");
  // and the visit list
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-unfinished-row").filter({ hasText: "录音已存，等转写" })).toHaveCount(1);
});

test("a server with transcription does not show the no-transcription line", async ({ page }) => {
  test.skip(provider !== "devfake", "needs SPEECH_PROVIDER=devfake");
  await signUp(page);
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-empty")).toBeVisible();
  await expect(page.getByTestId("visit-empty")).not.toContainText("没接转写");
  await page.goto("/p/today");
  await expect(page.getByTestId("today-visit-waiting")).toHaveCount(0);
});

test("a planned follow-up has its own row: 「大约 …」, then the day he booked (「我约的日子」), 「今天的复诊（计划）」 on the day, and a clinic visit continues it (real-app 4.4, 2.15)", async ({ page, context }) => {
  test.skip(provider !== "devfake", "needs SPEECH_PROVIDER=devfake (the follow-up comes from a visit's record)");
  test.setTimeout(180_000);
  const DEVFAKE = { "x-ripple-devfake-fixture": "v1" };
  await signUp(page);
  const api = context.request;
  // a visit whose record has 「Come back in about a week」, confirmed: the follow-up is planned a week on
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: DEVFAKE })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  await page.goto(`/p/visit/${visitId}/review`);
  while ((await page.getByTestId("review-summary").count()) === 0) {
    const n = await page.getByTestId("review-queue").getAttribute("data-pending");
    await page.getByTestId("review-yes").click();
    await expect.poll(async () => (await page.getByTestId("review-summary").count()) > 0 || (await page.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== n).toBe(true);
  }
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed");

  await page.goto("/p/visit");
  const planned = page.getByTestId("visit-planned-row");
  await expect(planned).toHaveCount(1);
  await expect(planned).toHaveAttribute("data-today", "false");
  await expect(planned).toContainText("大约 10月19日");
  await expect(planned).toContainText("复诊（计划）");
  await check(page, "visit-where-planned");
  const plannedId = (await planned.getAttribute("data-visit"))!;

  // 「我约的日子」: he booked the 21st. A save the server refuses says so; the next one goes through
  await planned.getByRole("link").click();
  const booking = page.getByTestId("visit-booking");
  await expect(booking).toHaveAttribute("data-visit", plannedId);
  await expect(page.getByTestId("visit-book-date")).toHaveValue("2026-10-19");
  await check(page, "visit-booking");
  await page.getByTestId("visit-book-date").fill("2026-10-21");
  let fail = true;
  await page.route(`**/api/visits/${plannedId}`, async (route) => {
    if (fail && route.request().method() === "PATCH") await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"store_unavailable"}' });
    else await route.continue();
  });
  await page.getByTestId("visit-book-save").click();
  await expect(page.getByTestId("visit-book-failed")).toBeVisible();
  await expect(booking).toBeVisible();
  fail = false;
  await page.getByTestId("visit-book-save").click();
  await expect(page.getByTestId("visit-where")).toBeVisible();
  await expect(planned).toHaveAttribute("data-visit", plannedId);
  await expect(planned).toContainText("10月21日的复诊（计划）");
  await expect(planned).not.toContainText("大约");
  expect(new URL(page.url()).search).toBe("");
  // the address of that screen works by itself too (Today can link to it), and 「返回」 leaves it
  await page.goto(`/p/visit?plan=${plannedId}`);
  await expect(booking).toBeVisible();
  await expect(page.getByTestId("visit-book-date")).toHaveValue("2026-10-21");
  await page.locator('[data-rp="back"]').click();
  await expect(page.getByTestId("visit-where")).toBeVisible();

  // the day comes
  expect((await api.post("/api/dev/clock", { data: { at: "2026-10-21T09:30:00+08:00", frozen: false } })).status()).toBe(200);
  try {
    await page.goto("/p/visit");
    await expect(planned).toHaveAttribute("data-today", "true");
    await expect(planned).toContainText("今天的复诊（计划）");
    await check(page, "visit-where-planned-today");
    await page.getByTestId("visit-clinic").click();
    await page.getByTestId("visit-direct").click();
    await page.getByTestId("consent-start").click();
    await expect(page.getByTestId("visit-live")).toHaveAttribute("data-visit", plannedId);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${plannedId}/review$`), { timeout: 60_000 });
    await page.goto("/p/visit");
    // recorded now: no longer a plan
    await expect(page.getByTestId("visit-planned-row")).toHaveCount(0);
  } finally {
    await api.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: false } });
  }
});

test("the example account: today's follow-up is a planned row, and the sample replay says 「示例回放」 on every screen, after a reload too (real-app 4.4, 4.6)", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, "example");
  await page.goto("/p/visit?speed=8");
  await expect(page.getByTestId("visit-where")).toBeVisible();
  const planned = page.getByTestId("visit-planned-row");
  await expect(planned).toHaveCount(1);
  await expect(planned).toContainText("今天的复诊（计划）");
  await check(page, "visit-where-example");
  await page.getByTestId("visit-sample-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "replay");
  const label = page.getByTestId("visit-sample-label");
  await expect(label).toHaveText("示例回放");
  // nothing is being recorded: no red 「正在录」
  await expect(live.locator('[data-rp="recording"]')).toHaveCount(0);
  await expect(page.getByTestId("visit-captions")).toBeVisible({ timeout: 30_000 });
  await expect(label).toBeVisible();
  await check(page, "visit-sample-live");
  const visitId = (await live.getAttribute("data-visit"))!;

  await page.reload();
  await expect(live).toHaveAttribute("data-mode", "replay");
  await expect(live).toHaveAttribute("data-visit", visitId);
  await expect(label).toHaveText("示例回放");
  await expect(page.getByTestId("visit-reopened")).toHaveCount(0);
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await expect(label).toBeVisible();
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(/\/p\/visit\/[^/]+\/review$/, { timeout: 60_000 });
});
