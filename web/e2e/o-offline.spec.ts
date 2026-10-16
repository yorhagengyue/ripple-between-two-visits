/**
 * Track O (C2; real-app 2.25): what the phone does without a network, and what it forgets at logout. On a real account,
 * in a real browser with the network switched off (context.setOffline), with the automatic page checks
 * (e2e/_checks/page-checks.ts) on every screen this track changed or added.
 *
 * Run against a production build on PW_PORT (node scripts/record/serve.mjs --port <port> --build: the developer tools
 * are on there; `next dev` reloads pages under Playwright). The developer test clock moves time.
 * O_SHOTS_DIR=<a folder outside web/> also writes a screenshot of each state (nothing is written without it).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { linkFamily, newAccount, TEST_PASSWORD } from "./journeys/_d/family";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
test.describe.configure({ mode: "serial", timeout: 180_000 });

const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;
const at = (date: string, hhmm: string) => Date.parse(SGT(date, hhmm));

async function setClock(request: APIRequestContext, when: string): Promise<void> {
  const res = await request.post("/api/dev/clock", { data: { at: when, frozen: true } });
  expect(res.status(), await res.text()).toBe(200);
}

/** A test account signed in on this phone (the foundation's developer tool); Mr Tan's example data unless said. */
async function account(context: BrowserContext, space: "example" | "blank" = "example"): Promise<string> {
  const login = `o${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const res = await context.request.post("/api/dev/accounts", { data: { login, password: TEST_PASSWORD, space } });
  expect(res.status(), await res.text()).toBe(201);
  return login;
}

interface Dose {
  medication_id: string;
  day: number;
  slot: string;
  state: string;
  reason: string | null;
  created_at: string;
}

/** His dose rows of a day, read with the phone's own sign-in (from the test process: not affected by setOffline). */
async function doses(context: BrowserContext, day: number): Promise<Dose[]> {
  const res = await context.request.get(`/api/doses?from=${day}&to=${day}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { doses: Dose[] }).doses;
}

interface Reading {
  id: string;
  day: number;
  slot: string;
  time: string;
  systolic: number | null;
  diastolic: number | null;
  state: string;
}

async function readings(context: BrowserContext): Promise<Reading[]> {
  const res = await context.request.get("/api/bp");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { readings: Reading[] }).readings.filter((r) => r.state === "recorded");
}

async function openToday(page: Page, query = ""): Promise<void> {
  await page.goto(`/p/today${query}`);
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
}

/** The service worker controls the page and holds the shell (the page asked for it when it opened). */
async function shellKept(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("rp-shell-")).length), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
}

/** What the phone keeps, as the page's own origin sees it. */
async function phoneKeeps(page: Page) {
  return page.evaluate(async () => {
    const list = JSON.parse(window.localStorage.getItem("rp_outbox_v1") ?? "[]") as { kind: string; state: string; at: string; why: string | null }[];
    return {
      list,
      keys: Object.keys(window.localStorage).sort(),
      session: Object.keys(window.sessionStorage).sort(),
      caches: await caches.keys(),
      databases: (await indexedDB.databases()).map((d) => d.name ?? ""),
    };
  });
}

async function typeReading(page: Page, digits: string): Promise<void> {
  const keypad = page.locator('[data-rp="bp-keypad"]');
  // the blood pressure page opens on the week (the timeline draft's 03-3a): 「记一次血压」 brings the keypad, on the phone
  // itself, so also without a network (the keypad is already there after a reading was taken out again)
  if (!(await keypad.isVisible())) await page.getByTestId("bp-record-open").click();
  for (const d of digits) await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
  await page.getByTestId("bp-save").click();
}

const SHOTS = process.env.O_SHOTS_DIR?.trim();
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("no network: a medicine and a reading are kept on the phone, 已记下（等连网）, and go out once, with the time he tapped", async ({ browser, request }) => {
  // laid out on Mon 12 Oct (day 42 of the example); Tue 13 Oct 08:46 the morning reminder is due
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context);
  await setClock(request, SGT("2026-10-13", "08:46"));
  const today = await context.newPage();
  await openToday(today);
  await expect(today.getByTestId("dose-taken")).toBeVisible();
  await expect(today.getByTestId("offline-note")).toHaveCount(0);
  const bp = await context.newPage();
  await bp.goto("/p/bp");
  await expect(bp.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
  await shellKept(today);

  // ---- the network goes
  await context.setOffline(true);
  await expect(today.getByTestId("offline-line")).toHaveText("现在没有网络。在这一页记下的，连上网就发出去。");
  await expectPageChecks(today, { side: "elder" });

  // he takes his morning medicine
  await today.getByTestId("dose-taken").click();
  await expect(today.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(today.getByTestId("dose-done")).toContainText("早上 8:46 吃的。");
  await expect(today.getByTestId("outbox-waiting")).toContainText("已记下（等连网）");
  await expect(today.getByTestId("outbox-waiting").getByTestId("outbox-entry")).toHaveText(/早上的药 · 早上 8:46.*吃了/);
  await expect(today.getByTestId("dose-failed")).toHaveCount(0);
  await expectPageChecks(today, { side: "elder" });
  await shot(today, "today-offline-taken");

  // he records a reading on the blood pressure page
  await expect(bp.getByTestId("offline-line")).toBeVisible();
  await typeReading(bp, "13882");
  await expect(bp.getByTestId("bp-saved")).toHaveAttribute("data-reading", "138/82");
  await expect(bp.getByTestId("outbox-waiting")).toContainText("已记下（等连网）");
  await expect(bp.locator('[data-testid="outbox-entry"][data-kind="bp"]')).toHaveText(/血压 · 早上 8:46.*138\/82/);
  await expect(bp.getByTestId("outbox-take-out")).toBeVisible();
  await expectPageChecks(bp, { side: "elder" });
  await shot(bp, "bp-offline-recorded");

  // nothing reached the server, and nothing was asked of it
  expect(await doses(context, 43)).toEqual([]);
  expect((await readings(context)).filter((r) => r.day === 43)).toEqual([]);
  const kept = (await phoneKeeps(today)).list;
  expect(kept.map((e) => [e.kind, e.state])).toEqual([
    ["dose", "waiting"],
    ["bp", "waiting"],
  ]);
  for (const e of kept) expect(Date.parse(e.at) - at("2026-10-13", "08:46")).toBeLessThan(120_000);

  // the undo bar passes; the screen keeps saying what he answered while it waits
  await expect(today.getByTestId("undo-toast")).toHaveCount(0, { timeout: 20_000 });
  await expect(today.getByTestId("dose-done")).toHaveAttribute("data-kind", "taken");
  await expect(today.getByTestId("page-today")).toBeVisible();
  await shot(today, "today-offline-after-undo-bar");

  // opening the app again without a network: the shell, which names nothing and says how many wait
  const cold = await context.newPage();
  await cold.goto("/p/today");
  await expect(cold.getByTestId("offline-shell")).toBeVisible();
  await expect(cold.locator("h1")).toHaveText("现在没有网络。");
  await expect(cold.getByTestId("shell-waiting")).toHaveText("这台手机上有 2 条已经记下，连上网就发出去。");
  await expect(cold.getByTestId("page-today")).toHaveCount(0);
  await expectPageChecks(cold, { side: "elder" });
  await shot(cold, "shell-two-waiting");
  const shellText = await cold.locator("body").innerText();
  expect(shellText).not.toMatch(/138|82|Amlodipine|氨氯地平/);

  // ---- 10:20, the network is back (the clock moved while the phone was offline)
  await setClock(request, SGT("2026-10-13", "10:20"));
  await context.setOffline(false);
  await expect.poll(async () => (await doses(context, 43)).map((d) => d.state), { timeout: 30_000 }).toEqual(["taken"]);
  await expect.poll(async () => (await readings(context)).filter((r) => r.day === 43).map((r) => `${r.systolic}/${r.diastolic}`), { timeout: 30_000 }).toEqual(["138/82"]);
  // recorded with the moment he tapped (8:46), not the moment it went out (10:20)
  const [dose] = await doses(context, 43);
  expect(dose).toMatchObject({ medication_id: "med-amlodipine", slot: "morning", state: "taken" });
  expect(Date.parse(dose.created_at) - at("2026-10-13", "08:46")).toBeGreaterThanOrEqual(0);
  expect(Date.parse(dose.created_at) - at("2026-10-13", "08:46")).toBeLessThan(120_000);
  const [reading] = (await readings(context)).filter((r) => r.day === 43);
  expect(reading).toMatchObject({ slot: "morning", time: "08:46" });

  // the phone's list is empty and the pages show the server's own state again
  await expect(today.getByTestId("offline-note")).toHaveCount(0, { timeout: 30_000 });
  await expect(bp.getByTestId("offline-note")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await phoneKeeps(today)).list).toEqual([]);
  // (the "记好了" view gives way to the day's overview once the server's data is read again)
  await expect(today.getByTestId("dose-headline")).toHaveAttribute("data-why", "all-done", { timeout: 30_000 });
  await expect(today.getByTestId("dose-headline")).toHaveText("今天的药都记好了。");
  await expect(today.getByTestId("page-today")).toContainText("早上 · 8:46 记的");
  await expect(today.getByTestId("dose-taken")).toHaveCount(0);
  await expect(bp.getByTestId("bp-today-reading")).toHaveAttribute("data-reading", "138/82");
  await expect(bp.getByTestId("bp-today-reading")).toContainText("8:46");
  await expectPageChecks(today, { side: "elder" });
  await expectPageChecks(bp, { side: "elder" });
  await shot(today, "today-back-online");
  await shot(bp, "bp-back-online");
  // the shell went back by itself to the page he asked for
  await expect(cold.getByTestId("page-today")).toHaveAttribute("data-scope", "account", { timeout: 30_000 });

  // once: another page load and another minute change nothing
  await today.reload();
  await expect(today.getByTestId("page-today")).toBeVisible();
  await today.waitForTimeout(1500);
  expect(await doses(context, 43)).toHaveLength(1);
  expect((await readings(context)).filter((r) => r.day === 43)).toHaveLength(1);
  await context.close();
});

test("no network: undo takes the answer out of the phone's list; a mistyped reading can be taken out; nothing is sent later", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context);
  await setClock(request, SGT("2026-10-13", "08:46"));
  const today = await context.newPage();
  await openToday(today);
  const bp = await context.newPage();
  await bp.goto("/p/bp");
  await expect(bp.getByTestId("page-bp")).toBeVisible();
  await context.setOffline(true);

  // 还没吃, then why, then undo: both taps were only ever on the phone
  await today.getByTestId("dose-missed").click();
  await expect(today.getByTestId("dose-reasons")).toBeVisible();
  await expect(today.getByTestId("outbox-waiting").getByTestId("outbox-entry")).toHaveText(/早上的药.*没吃/);
  await today.getByTestId("dose-reasons").locator("[data-reason]").first().click();
  await expect(today.getByTestId("dose-done")).toHaveAttribute("data-kind", "missed");
  expect((await phoneKeeps(today)).list.filter((e) => e.kind === "dose")).toHaveLength(1);
  await today.getByTestId("undo-toast").getByRole("button").click();
  await expect(today.getByTestId("outbox-waiting")).toHaveCount(0);
  await expect(today.getByTestId("dose-taken")).toBeVisible();
  await expect(today.getByTestId("dose-failed")).toHaveCount(0);
  expect((await phoneKeeps(today)).list).toEqual([]);

  // a reading typed wrong is taken out again; the page no longer says it was recorded
  await typeReading(bp, "18812");
  await expect(bp.getByTestId("bp-saved")).toHaveAttribute("data-reading", "188/12");
  await bp.getByTestId("outbox-take-out").click();
  await expect(bp.getByTestId("bp-saved")).toHaveCount(0);
  await expect(bp.getByTestId("outbox-waiting")).toHaveCount(0);
  await expect(bp.locator('[data-rp="bp-keypad"]')).toBeVisible();
  // 「这次没量」 is kept the same way
  await bp.getByTestId("bp-skip").click();
  await expect(bp.getByTestId("bp-saved")).toHaveAttribute("data-kind", "skipped");
  await expect(bp.locator('[data-testid="outbox-entry"][data-kind="bp"]')).toHaveText(/血压.*这次没量/);
  await bp.getByTestId("outbox-take-out").click();
  expect((await phoneKeeps(bp)).list).toEqual([]);

  await context.setOffline(false);
  await expect(today.getByTestId("offline-line")).toHaveCount(0);
  await today.waitForTimeout(2000);
  expect(await doses(context, 43)).toEqual([]);
  const res = await context.request.get("/api/bp");
  expect(((await res.json()) as { readings: Reading[] }).readings.filter((r) => r.day === 43)).toEqual([]);
  await context.close();
});

test("no network: the open page stays when its own timer fires; another page of the app is the shell, and comes back by itself", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context);
  // three seconds before the 8:45 reminder: the page will re-read its data by itself in a few seconds
  await setClock(request, "2026-10-13T08:44:57+08:00");
  const page = await context.newPage();
  await openToday(page);
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "coming");
  await shellKept(page);
  await context.setOffline(true);
  await expect(page.getByTestId("offline-line")).toBeVisible();
  await setClock(request, SGT("2026-10-13", "08:46"));
  // the timer has fired by now: without a network the page neither re-reads nor reloads, it is still Today as it was
  await page.waitForTimeout(6000);
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("offline-shell")).toHaveCount(0);
  await expect(page.getByTestId("dose-headline")).toHaveAttribute("data-why", "coming");
  await expect(page.getByTestId("dose-taken")).toBeVisible();
  // (the timeline draft's Today header has no 「中/EN」: the language is under 「我」, so there is no switch to tap here)
  await expect(page.getByTestId("elder-meta").locator('[data-kind="lang"]')).toHaveCount(0);

  // the network comes back: the re-read that was waiting happens now, on the same page (no reload): the reminder is due
  await page.evaluate(() => ((window as unknown as { __stillHere?: boolean }).__stillHere = true));
  await context.setOffline(false);
  await expect(page.getByTestId("dose-headline")).not.toHaveAttribute("data-why", "coming", { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(true);
  await expect(page.getByTestId("offline-line")).toHaveCount(0);
  await expect(page.getByTestId("dose-taken")).toHaveText(/吃了/);
  // the rest in English (his language is kept in the rp_lang cookie; Today is read again in it)
  await context.addCookies([{ name: "rp_lang", value: "en", url: page.url() }]);
  await page.reload();
  await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  await expect(page.getByTestId("dose-taken")).toHaveText(/Taken/);
  await shellKept(page);

  // the network goes again and he taps 「血压」: that page cannot be opened without one, the shell stands at its address
  await context.setOffline(true);
  await expect(page.getByTestId("offline-line")).toHaveText("No connection right now. What you record on this page is sent once you are back online.");
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("outbox-waiting")).toContainText("Recorded (waiting for a connection)");
  await expect(page.getByTestId("outbox-waiting").getByTestId("outbox-entry")).toHaveText(/Morning medicine · .*8:46.*Taken/);
  await expectPageChecks(page, { side: "elder" });
  await shot(page, "today-offline-taken-en");
  await page.locator('[data-rp="tabbar"] a[href="/p/bp"]').click();
  await expect(page.getByTestId("offline-shell")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/p/bp");
  await expect(page.locator("h1")).toHaveText("No connection right now.");
  await expect(page.getByTestId("shell-waiting")).toHaveText("1 thing you recorded is kept on this phone and will be sent once you are back online.");
  await expectPageChecks(page, { side: "elder" });
  await shot(page, "shell-one-waiting-en");

  // the network is back: the page he asked for opens by itself, and what waited goes out from it
  await context.setOffline(false);
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-scope", "account", { timeout: 30_000 });
  await expect.poll(async () => (await doses(context, 43)).map((d) => d.state), { timeout: 30_000 }).toEqual(["taken"]);
  await expect(page.getByTestId("offline-note")).toHaveCount(0, { timeout: 30_000 });
  await context.close();
});

test("asking without a network: 要连上网才能问, and the question is never queued", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context);
  await setClock(request, SGT("2026-10-13", "08:40"));
  const page = await context.newPage();
  await openToday(page);
  // Today's typing dock (the draft's 04-1): 「打字」 puts the field in the place of the 「按一下说 / 打字」 bar
  await page.getByTestId("say-type").click();
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "today");
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/ask") && r.method() === "POST") asked.push(r.url());
  });

  await context.setOffline(true);
  await page.getByTestId("ask-input").fill("今天 150/95，我能不能多吃一粒？");
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-error")).toHaveText("要连上网才能问。");
  // what he typed stays; nothing was sent and nothing is kept to send later
  await expect(page.getByTestId("ask-input")).toHaveValue("今天 150/95，我能不能多吃一粒？");
  expect(asked).toEqual([]);
  expect((await phoneKeeps(page)).list).toEqual([]);
  await expectPageChecks(page, { side: "elder" });
  await shot(page, "today-ask-offline");

  await context.setOffline(false);
  await expect(page.getByTestId("offline-line")).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(asked).toEqual([]);
  const history = await context.request.get("/api/ask/history");
  expect(((await history.json()) as { turns: unknown[] }).turns).toEqual([]);

  // the answer's own screen says the same; with the network back the same question goes through
  await page.goto("/p/ask");
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
  await context.setOffline(true);
  await page.getByTestId("ask-input").fill("今天 150/95，我能不能多吃一粒？");
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-error")).toHaveText("要连上网才能问。");
  await expectPageChecks(page, { side: "elder" });
  await context.setOffline(false);
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-section")).toHaveAttribute("data-turns", "1", { timeout: 30_000 });
  await expect(page.getByTestId("ask-error")).toHaveCount(0);
  await context.close();
});

test("an entry the server refuses stays on the screen with what went wrong, until he puts it away", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  await account(context);
  await setClock(request, SGT("2026-10-13", "08:46"));
  const today = await context.newPage();
  await openToday(today);
  await context.setOffline(true);
  await today.getByTestId("dose-taken").click();
  await expect(today.getByTestId("outbox-waiting")).toBeVisible();

  // the phone stays offline for three days
  await setClock(request, SGT("2026-10-16", "09:30"));
  await context.setOffline(false);
  const refused = today.getByTestId("outbox-refused");
  await expect(refused).toBeVisible({ timeout: 30_000 });
  await expect(refused).toContainText("没有记上");
  await expect(refused.getByTestId("outbox-entry")).toHaveAttribute("data-why", "too_late");
  // an entry of another day says which day it was
  await expect(refused.getByTestId("outbox-entry")).toContainText("早上的药 · 10月13日 周二 · 早上 8:46");
  await expect(refused).toContainText("隔了一天多才连上网，这一条记不上了。");
  await expect(today.getByTestId("outbox-waiting")).toHaveCount(0);
  // his late answer was not written. C2 track B, second round (real-app 6.5): every tracked cell whose window closed is
  // settled, also three days back, so that morning holds the system's own 「没回」 and nothing of his
  expect((await doses(context, 43)).map((d) => [d.state, d.reason])).toEqual([["unconfirmed", "no_reply"]]);

  // still there on another page and after opening the app again; only 「知道了」 puts it away
  await today.goto("/p/bp");
  await expect(today.getByTestId("outbox-refused")).toContainText("隔了一天多才连上网，这一条记不上了。");
  await expectPageChecks(today, { side: "elder" });
  await openToday(today);
  await expect(today.getByTestId("outbox-refused")).toBeVisible();
  await expectPageChecks(today, { side: "elder" });
  await shot(today, "today-refused");
  expect((await phoneKeeps(today)).list.map((e) => [e.state, e.why])).toEqual([["refused", "too_late"]]);
  await today.getByTestId("outbox-put-away").click();
  await expect(today.getByTestId("offline-note")).toHaveCount(0);
  expect((await phoneKeeps(today)).list).toEqual([]);
  await context.close();
});

test("a sign-in that ended: the answer is kept, he lands on /login?next=, and it goes out when he is back", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  const login = await account(context);
  await setClock(request, SGT("2026-10-13", "08:46"));
  const today = await context.newPage();
  await openToday(today);
  // his sign-in ends (signed out from another device): the phone's cookies are no longer a sign-in
  expect((await context.request.delete("/api/dev/login")).ok()).toBe(true);

  await today.getByTestId("dose-taken").click();
  await today.waitForURL(/\/login\?next=%2Fp%2Ftoday/);
  const kept = (await phoneKeeps(today)).list;
  expect(kept.map((e) => [e.kind, e.state])).toEqual([["dose", "waiting"]]);

  // he logs in again (some minutes later) and comes back to the page he was on
  await setClock(request, SGT("2026-10-13", "09:05"));
  const back = await context.request.post("/api/dev/login", { data: { login, password: TEST_PASSWORD } });
  expect(back.ok(), await back.text()).toBe(true);
  await openToday(today);
  await expect.poll(async () => (await doses(context, 43)).map((d) => d.state), { timeout: 30_000 }).toEqual(["taken"]);
  const [dose] = await doses(context, 43);
  expect(Date.parse(dose.created_at) - at("2026-10-13", "08:46")).toBeLessThan(120_000);
  await expect(today.getByTestId("offline-note")).toHaveCount(0, { timeout: 30_000 });
  await context.close();
});

test("logging out clears the to-send list, a recording not uploaded and the page cache; the next account sends nothing of his", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  const hisLogin = await account(context);
  await setClock(request, SGT("2026-10-13", "08:46"));
  const page = await context.newPage();
  await openToday(page);
  await shellKept(page);

  // a visit recording still on the phone (the store of components/visit/elder/recording-store.ts), and her kind of keys
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("ripple-recordings", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("chunks", { keyPath: ["visitId", "seq"] });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("chunks", "readwrite");
          tx.objectStore("chunks").put({ visitId: "visit-not-uploaded", seq: 0, rate: 16000, pcm: new Float32Array(1600), at: Date.now() });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.evaluate(() => {
    window.localStorage.setItem("rp_f_phone_some-link", "+65 0000 0000");
    window.localStorage.setItem("rp_f_welcomed_some-link", "1");
    window.sessionStorage.setItem("anything", "1");
  });

  // an answer and a reading that could not go out
  await context.setOffline(true);
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("outbox-waiting")).toBeVisible();
  // the server stays out of reach for what he records (the rest of the app answers, so he can log out)
  await context.route(/\/api\/(doses|bp)$/, (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.fallback()));
  await context.setOffline(false);
  await page.goto("/p/bp");
  await typeReading(page, "15095");
  await expect(page.getByTestId("outbox-waiting").getByTestId("outbox-entry")).toHaveCount(2);

  const before = await phoneKeeps(page);
  expect(before.list.map((e) => [e.kind, e.state])).toEqual([
    ["dose", "waiting"],
    ["bp", "waiting"],
  ]);
  expect(before.keys).toEqual(expect.arrayContaining(["rp_outbox_v1", "rp_outbox_owner", "rp_f_phone_some-link", "rp_f_welcomed_some-link"]));
  expect(before.caches.filter((k) => k.startsWith("rp-shell-"))).toHaveLength(1);
  expect(before.databases).toContain("ripple-recordings");

  // 我 → 登录和设备 → 退出登录
  await page.goto("/p/me/devices");
  await page.getByTestId("logout").click();
  await page.waitForURL(/\/login/);
  const after = await phoneKeeps(page);
  expect(after.list).toEqual([]);
  expect(after.keys).toEqual([]);
  expect(after.session).toEqual([]);
  expect(after.caches).toEqual([]);
  expect(after.databases).toEqual([]);

  // the login page itself puts nothing back, and without the shell a navigation offline simply fails
  await page.reload();
  await expect.poll(async () => (await phoneKeeps(page)).caches).toEqual([]);

  // the next person signs in on this phone; the server is reachable again
  await context.unroute(/\/api\/(doses|bp)$/);
  await account(context);
  await openToday(page);
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(await doses(context, 43)).toEqual([]);
  expect((await readings(context)).filter((r) => r.day === 43)).toEqual([]);
  // nor did anything reach his own account
  const his = await browser.newContext();
  expect((await his.request.post("/api/dev/login", { data: { login: hisLogin, password: TEST_PASSWORD } })).ok()).toBe(true);
  expect(await doses(his, 43)).toEqual([]);
  expect((await readings(his)).filter((r) => r.day === 43)).toEqual([]);
  await his.close();
  await context.close();
});

test("another account on the same phone without a logout: his entries stay unseen and unsent, and go out under his own sign-in", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-12", "10:00"));
  const context = await browser.newContext();
  const hisLogin = await account(context);
  await setClock(request, SGT("2026-10-13", "08:46"));
  const page = await context.newPage();
  await openToday(page);
  await context.setOffline(true);
  await page.getByTestId("dose-taken").click();
  await expect(page.getByTestId("outbox-waiting")).toBeVisible();
  // his sign-in ends while the phone is offline (not a logout); someone else signs in on this phone
  await account(context);
  await context.setOffline(false);
  await setClock(request, SGT("2026-10-13", "09:10"));
  await openToday(page);
  await expect(page.getByTestId("dose-taken")).toBeVisible();
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
  await page.waitForTimeout(2500);
  // nothing of his was written under the other account, and his entry is still on the phone, his
  expect(await doses(context, 43)).toEqual([]);
  expect((await phoneKeeps(page)).list.map((e) => [e.kind, e.state])).toEqual([["dose", "waiting"]]);

  // he signs in again on this phone: now it goes out, under his account, with the time he tapped
  expect((await context.request.post("/api/dev/login", { data: { login: hisLogin, password: TEST_PASSWORD } })).ok()).toBe(true);
  await openToday(page);
  await expect.poll(async () => (await doses(context, 43)).map((d) => d.state), { timeout: 30_000 }).toEqual(["taken"]);
  expect(Date.parse((await doses(context, 43))[0].created_at) - at("2026-10-13", "08:46")).toBeLessThan(120_000);
  expect((await phoneKeeps(page)).list).toEqual([]);
  await context.close();
});

test("her logout clears what her phone kept for her (Dad's number, the welcome mark)", async ({ browser, request }) => {
  await setClock(request, SGT("2026-10-13", "11:00"));
  const him = await browser.newContext();
  const her = await browser.newContext();
  await newAccount(him, { space: "example", displayName: "陈先生", prefix: "o" });
  await newAccount(her, { space: "none", displayName: "Wei Ling", prefix: "o" });
  const linkId = await linkFamily(him, her);
  const page = await her.newPage();
  await page.goto(`/f/phone?link=${linkId}&back=${encodeURIComponent(`/f/me?link=${linkId}`)}`);
  await page.getByTestId("phone-input").fill("+65 0000 0000");
  await page.getByTestId("phone-save").click();
  await expect(page.getByTestId("family-me")).toBeVisible();
  await page.evaluate((id) => window.localStorage.setItem(`rp_f_welcomed_${id}`, "1"), linkId);
  expect((await phoneKeeps(page)).keys).toEqual([`rp_f_phone_${linkId}`, `rp_f_welcomed_${linkId}`]);

  await page.getByTestId("me-logout").click();
  await page.waitForURL(/\/login/);
  const after = await phoneKeeps(page);
  expect(after.keys).toEqual([]);
  expect(after.caches).toEqual([]);
  expect(after.databases).toEqual([]);
  await him.close();
  await her.close();
});

test("the shell on its own: both languages, the page checks, and nothing of anyone in it", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await page.goto("/offline.html");
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("offline-shell")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("现在没有网络。");
  await expect(page.getByTestId("shell-waiting")).toBeHidden();
  await expect(page.getByTestId("shell-again")).toHaveText("再试一次");
  await expectPageChecks(page, { side: "elder" });
  await shot(page, "shell-zh");
  await context.addCookies([{ name: "rp_lang", value: "en", url: page.url() }]);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("No connection right now.");
  await expect(page.getByTestId("shell-again")).toHaveText("Try again");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectPageChecks(page, { side: "elder" });
  await shot(page, "shell-en");
  await context.close();
});
