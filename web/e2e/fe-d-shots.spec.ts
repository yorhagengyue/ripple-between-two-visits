/**
 * Pictures of Wei Ling's screens, for a person to judge them against the v3 draft (the fe-d track; notes in
 * web/progress/fe-d.md). Written only when FE_D_SHOTS_DIR is set:
 *
 *   FE_D_SHOTS_DIR=D:/ripple-c2/shots/fe-d PW_PORT=3720 npx playwright test e2e/fe-d-shots.spec.ts --output <outside web/>
 *
 * One picture per main state, 390x844 at 2x (the whole page when it is longer), named by the draft's group and number:
 * A1.png ... I5.png. Next to them checks.json: what the page checks (e2e/_checks/page-checks.ts) found on each screen.
 * Nothing about looks is asserted here; e2e/d-pages.spec.ts and e2e/d-round2.spec.ts assert the page checks.
 *
 * Needs a server with the developer tools on (the test clock, dev accounts). Her words under a reminder need
 * SPEECH_PROVIDER=devfake on that server; with mock her clip has no words and those lines are simply not drawn.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { startPushService, type PushService } from "../tests/support/push-service";
import { runPageChecks } from "./_checks/page-checks";
import { clearClock, linkFamily, newAccount, setClock, setSwitches, tick } from "./journeys/_d/family";
import { answerPermissionPrompt, stubPushSubscription } from "./push-helpers";

const DIR = process.env.FE_D_SHOTS_DIR?.trim() || null;
const STAND_IN = path.resolve(process.cwd(), "lib", "daily", "assets", "wei-ling-reminder.standin.wav");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
/** a Saturday, like the draft's B screens (「9月19日 周六」): Monday to Friday behind it, Sunday still to come */
const DAY = "2026-10-17";
const at = (hhmm: string, day = DAY) => `${day}T${hhmm}:00+08:00`;
type Lang = "zh-Hans" | "en";

test.describe.configure({ mode: "serial" });
test.skip(!DIR, "FE_D_SHOTS_DIR is not set: no pictures are written");
// her phone can record: the fake microphone plays the stand-in sentence
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${STAND_IN}`] },
});

let service: PushService;
test.beforeAll(async () => {
  service = await startPushService();
});
test.afterAll(async () => {
  await service?.close();
});
// the test clock is the server's own: every test puts it back
test.afterEach(async ({ request }) => {
  await clearClock(request);
});

async function phone(browser: Browser, baseURL: string, locale: Lang = "zh-Hans", extra: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore", ...extra });
  await context.addCookies([{ name: "rp_lang", value: locale, url: baseURL }]);
  return context;
}

const setLang = (context: BrowserContext, baseURL: string, locale: Lang) => context.addCookies([{ name: "rp_lang", value: locale, url: baseURL }]);

/** Her first-visit steps are done on this phone; Dad's number is saved unless `number` is null. */
async function welcomed(page: Page, linkId: string, number: string | null = "+65 0000 0000"): Promise<void> {
  await page.evaluate(
    ({ id, n }) => {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
      if (n) localStorage.setItem(`rp_f_phone_${id}`, n);
      else localStorage.removeItem(`rp_f_phone_${id}`);
    },
    { id: linkId, n: number },
  );
}

/** One picture, and what the page checks say about the screen. */
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(DIR!, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
  await page.waitForTimeout(350);
  const r = await runPageChecks(page, { side: "family" });
  const file = path.join(DIR!, "checks.json");
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  all[name] = {
    url: new URL(page.url()).pathname,
    height: await page.evaluate(() => document.documentElement.scrollHeight),
    sideways: r.overflow.doc > 0 || r.overflow.body > 0 ? r.overflow.offenders : [],
    smallText: r.smallText,
    smallTargets: r.smallTargets,
    contrast: r.contrast,
  };
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  await page.screenshot({ path: path.join(DIR!, `${name}.png`), fullPage: true, animations: "disabled" });
}

/** Her own recording, registered through her link as the recorder does (the words come from the devfake stand-in). */
async function herRecording(her: BrowserContext, linkId: string, fixture = "reminder"): Promise<void> {
  const q = `link=${encodeURIComponent(linkId)}`;
  const up = await her.request.post(`/api/upload-url?${q}`, { data: { kind: "reminder", content_type: "audio/wav" } });
  expect(up.ok(), await up.text()).toBe(true);
  const u = (await up.json()) as { url: string; method?: string; headers?: Record<string, string>; path: string };
  const put = await her.request.fetch(u.url, { method: u.method === "POST" ? "POST" : "PUT", headers: u.headers, data: readFileSync(STAND_IN) });
  expect(put.ok(), await put.text()).toBe(true);
  const reg = await her.request.post(`/api/reminders?${q}`, { data: { audio_path: u.path }, headers: { "x-ripple-devfake-fixture": fixture } });
  expect(reg.ok(), await reg.text()).toBe(true);
}

/** Mr Tan's example account and Wei Ling's, linked and confirmed, made at 7:30 so today's morning is his to answer. */
async function pair(browser: Browser, baseURL: string, request: APIRequestContext, opts: { locale?: Lang; switches?: Record<string, boolean>; herExtra?: Parameters<Browser["newContext"]>[0]; init?: (her: BrowserContext) => Promise<unknown>; day?: string } = {}) {
  await setClock(request, at("07:30", opts.day ?? DAY));
  const him = await phone(browser, baseURL);
  const her = await phone(browser, baseURL, opts.locale ?? "zh-Hans", opts.herExtra);
  if (opts.init) await opts.init(her);
  await newAccount(him, { space: "example", displayName: "陈先生", prefix: "sh" });
  await newAccount(her, { space: "none", displayName: "Wei Ling", prefix: "sw" });
  const linkId = await linkFamily(him, her);
  if (opts.switches) await setSwitches(him, linkId, opts.switches);
  const dp = await her.newPage();
  return { him, her, linkId, dp };
}

const home = (linkId: string) => `/f?link=${encodeURIComponent(linkId)}`;

async function openHome(dp: Page, linkId: string): Promise<void> {
  await dp.goto(home(linkId));
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
}

/** He answers this morning's medicine on his own phone (his own route). */
async function heAnswers(him: BrowserContext, state: "taken" | "missed"): Promise<void> {
  const r = await him.request.post("/api/doses", { data: { medication_id: "med-amlodipine", slot: "morning", state, ...(state === "missed" ? { reason: "forgot" } : {}) } });
  expect(r.ok(), await r.text()).toBe(true);
}

const SHARE_COUNTS = { dose_summary: true, bp_summary: true, questions_count: true };

test("B, D, I4: her home through a morning nobody answers, the no-reply screen, and after he answers", async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const sub = service.newPhone({ label: "her phone" });
  const { him, her, linkId, dp } = await pair(browser, baseURL!, request, {
    switches: { ...SHARE_COUNTS, no_reply_alert: true },
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  await herRecording(her, linkId);
  await dp.goto(home(linkId));
  await welcomed(dp, linkId);
  await setClock(request, at("08:30"));
  await openHome(dp, linkId);

  // I4: he lets her be told, and this phone has no notifications yet
  await expect(dp.getByTestId("push-nudge-on")).toBeVisible({ timeout: 10_000 });
  await shot(dp, "I4");
  await dp.getByTestId("push-nudge-on").click();
  await expect(dp.getByTestId("push-nudge-said")).toBeVisible({ timeout: 15_000 });
  await openHome(dp, linkId);
  await expect(dp.getByTestId("push-nudge")).toHaveCount(0);

  // B1: 8:30, the reminder is still to come
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "before");
  await shot(dp, "B1");

  // B2: 8:50, reminded once, no answer yet
  await setClock(request, at("08:45"));
  await tick(request);
  await setClock(request, at("08:50"));
  await openHome(dp, linkId);
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "reminding");
  await shot(dp, "B2");

  // B5: 9:50, neither reminder answered
  await setClock(request, at("09:15"));
  await tick(request);
  await setClock(request, at("09:45"));
  await tick(request);
  await setClock(request, at("09:50"));
  await openHome(dp, linkId);
  await expect(dp.getByTestId("home-no-reply")).toBeVisible();
  await shot(dp, "B5");

  // D2: the morning, line by line
  await dp.getByTestId("home-no-reply-open").click();
  await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "no_reply");
  await shot(dp, "D2");
  await setLang(her, baseURL!, "en");
  await dp.reload();
  await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "no_reply");
  await shot(dp, "D2-EN");
  await setLang(her, baseURL!, "zh-Hans");

  // D4: no number saved yet, 「打电话给爸爸」 asks for it once
  await welcomed(dp, linkId, null);
  await dp.reload();
  await dp.getByTestId("call-dad").click();
  await expect(dp.getByTestId("phone-sheet")).toBeVisible();
  await shot(dp, "D4");
  await dp.getByTestId("phone-sheet-later").click();
  await welcomed(dp, linkId);

  // D3: 10:02, he taps 「吃了」 after all; her open screen calms down by itself
  await dp.reload();
  await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-live", "open");
  await setClock(request, at("10:02"));
  await heAnswers(him, "taken");
  await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "answered", { timeout: 20_000 });
  await setClock(request, at("10:03"));
  await shot(dp, "D3");
  await him.close();
  await her.close();
});

test("B3, B3-EN, B4, F2, I3: he took it, in English, he said no, he just shared something, no network", async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  // B3: he tapped 「吃了」 at 8:52, after her reminder played at 8:45
  const a = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS });
  await herRecording(a.her, a.linkId);
  await a.dp.goto(home(a.linkId));
  await welcomed(a.dp, a.linkId);
  await setClock(request, at("08:45"));
  await tick(request);
  await setClock(request, at("08:52"));
  await heAnswers(a.him, "taken");
  await setClock(request, at("12:31"));
  await openHome(a.dp, a.linkId);
  await expect(a.dp.getByTestId("family-app")).toHaveAttribute("data-state", "taken");
  await shot(a.dp, "B3");
  await setLang(a.her, baseURL!, "en");
  await openHome(a.dp, a.linkId);
  await shot(a.dp, "B3-EN");
  await setLang(a.her, baseURL!, "zh-Hans");

  // F2: he switches his visit records on while her home is open
  await openHome(a.dp, a.linkId);
  await setSwitches(a.him, a.linkId, { ...SHARE_COUNTS, visit_transcripts: true });
  await expect(a.dp.getByTestId("family-notice")).toBeVisible({ timeout: 10_000 });
  await shot(a.dp, "F2");

  // I3: the phone loses its network; the next read fails and the screen says what it is showing
  await openHome(a.dp, a.linkId);
  await a.her.setOffline(true);
  await a.dp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(a.dp.getByTestId("family-notice")).toBeVisible({ timeout: 10_000 });
  await shot(a.dp, "I3");
  await a.her.setOffline(false);
  await a.him.close();
  await a.her.close();

  // B4: he tapped 「没吃」 at 9:05
  const b = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS });
  await b.dp.goto(home(b.linkId));
  await welcomed(b.dp, b.linkId);
  await setClock(request, at("08:45"));
  await tick(request);
  await setClock(request, at("09:05"));
  await heAnswers(b.him, "missed");
  await openHome(b.dp, b.linkId);
  await expect(b.dp.getByTestId("family-app")).toHaveAttribute("data-state", "missed");
  await shot(b.dp, "B4");
  await b.him.close();
  await b.her.close();
});

test("A, H3, H4: the invitation, her sign-up and login, waiting, the three first-visit steps, the empty home", async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  await setClock(request, at("20:14"));
  const him = await phone(browser, baseURL!);
  const her = await phone(browser, baseURL!, "zh-Hans", { userAgent: IPHONE_UA, isMobile: true, hasTouch: true });
  await newAccount(him, { space: "example", displayName: "陈先生", prefix: "sh" });
  const made = await him.request.post("/api/family/invites", { data: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } });
  expect(made.status(), await made.text()).toBe(201);
  const body = (await made.json()) as { path: string; link: { id: string } };
  const linkId = body.link.id;
  const dp = await her.newPage();

  await dp.goto(body.path);
  await expect(dp.getByTestId("invite-page")).toHaveAttribute("data-state", "open");
  await shot(dp, "A1");
  await dp.goto(`${body.path}/join`);
  await expect(dp.getByTestId("her-signup")).toBeVisible();
  await shot(dp, "A2");
  await dp.goto(`${body.path}/login`);
  await expect(dp.getByTestId("her-login-form")).toBeVisible();
  await shot(dp, "A2b");
  await dp.goto("/invite/00000000-0000-4000-8000-000000000000.not-an-invitation");
  await expect(dp.getByTestId("invite-page")).not.toHaveAttribute("data-state", "open");
  await shot(dp, "H3");

  // she signs up through the form: the filled sign-up, then her recovery code (kept from before the draft)
  await dp.goto(`${body.path}/join`);
  await dp.getByTestId("her-name").fill("Wei Ling");
  await dp.getByTestId("her-login").fill(`weiling${Math.floor(1000 + Math.random() * 9000)}`);
  await dp.getByTestId("her-password").fill("jasmine tea 88");
  await dp.getByTestId("her-agree").check();
  await shot(dp, "A2-filled");
  await dp.getByTestId("her-signup-submit").click();
  await expect(dp.getByTestId("her-code-value")).toBeVisible();
  await shot(dp, "A2-code");
  await dp.getByTestId("her-code-done").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "waiting");
  await shot(dp, "A3");

  const confirmed = await him.request.post(`/api/family/links/${linkId}/confirm`, { data: { yes: true } });
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-1", { timeout: 15_000 });
  await shot(dp, "A4a");
  await dp.getByTestId("phone-later").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-2");
  await shot(dp, "A4b");
  await dp.getByTestId("push-later").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "welcome-3");
  await shot(dp, "A4c");
  await dp.getByTestId("welcome-done").click();
  await expect(dp.getByTestId("family-app")).toHaveAttribute("data-state", "nothing_shared");
  await shot(dp, "H4");
  await him.close();
  await her.close();
});

/** The phone's answer about the microphone, fixed: never asked yet ("prompt"), or refused ("denied"). */
async function microphone(context: BrowserContext, state: "prompt" | "denied"): Promise<void> {
  await context.addInitScript((st) => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d: PermissionDescriptor) => ((d.name as string) === "microphone" ? Promise.resolve({ state: st } as PermissionStatus) : query(d));
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("not allowed", "NotAllowedError"));
  }, state);
}

test("E, I5: her reminder from the first screen to the saved one, her recordings, the microphone asked for and refused", async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  const { him, her, linkId, dp } = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS });
  await her.grantPermissions(["microphone"]);
  await her.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "reminder" });
  await dp.goto(home(linkId));
  await welcomed(dp, linkId);
  await setClock(request, at("12:32"));
  const studio = dp.getByTestId("reminder-studio");

  // E1: before recording; what plays now is the stand-in voice
  await dp.goto(`/f/reminder?link=${linkId}`);
  await expect(studio).toHaveAttribute("data-state", "idle");
  await shot(dp, "E1");

  // E2: a take is running
  await dp.getByTestId("rec-start").click();
  await expect(studio).toHaveAttribute("data-state", "recording");
  await dp.waitForTimeout(3200);
  await shot(dp, "E2");
  await dp.waitForTimeout(600);

  // E3: recorded, not yet used
  await dp.getByTestId("rec-stop").click();
  await expect(studio).toHaveAttribute("data-state", "recorded");
  await shot(dp, "E3");

  // E4: 「就用这段」
  await dp.getByTestId("rec-use").click();
  await expect(studio).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await shot(dp, "E4");

  // E5: her recordings; the one that plays carries the tick
  await dp.getByTestId("rec-new").click();
  await expect(studio).toHaveAttribute("data-state", "idle");
  await dp.getByTestId("rec-mine-open").click();
  await expect(dp.getByTestId("rec-mine-row")).toHaveCount(1);
  await expect(dp.getByTestId("rec-mine-length")).toBeVisible({ timeout: 10_000 });
  await shot(dp, "E5");

  // E3-EN: the same screen in English
  await setLang(her, baseURL!, "en");
  await dp.goto(`/f/reminder?link=${linkId}`);
  await dp.getByTestId("rec-start").click();
  await expect(studio).toHaveAttribute("data-state", "recording");
  await dp.waitForTimeout(3800);
  await dp.getByTestId("rec-stop").click();
  await expect(studio).toHaveAttribute("data-state", "recorded");
  await shot(dp, "E3-EN");
  await him.close();
  await her.close();

  // E6: the first time, what the microphone is for, before the phone asks
  const b = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS, init: (c) => microphone(c, "prompt") });
  await b.dp.goto(home(b.linkId));
  await welcomed(b.dp, b.linkId);
  await b.dp.goto(`/f/reminder?link=${b.linkId}`);
  await b.dp.getByTestId("rec-start").click();
  await expect(b.dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "mic-ask");
  await shot(b.dp, "E6");
  await b.him.close();
  await b.her.close();

  // I5: the microphone is refused in the phone's settings (an iPhone: the three steps)
  const c = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS, herExtra: { userAgent: IPHONE_UA, isMobile: true, hasTouch: true }, init: (x) => microphone(x, "denied") });
  await c.dp.goto(home(c.linkId));
  await welcomed(c.dp, c.linkId);
  await c.dp.goto(`/f/reminder?link=${c.linkId}`);
  await c.dp.getByTestId("rec-start").click();
  await expect(c.dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "mic-denied");
  await shot(c.dp, "I5");
  await c.him.close();
  await c.her.close();
});

test("C: the week day by day, and the week before", async ({ browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const { him, her, linkId, dp } = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS });
  await dp.goto(home(linkId));
  await welcomed(dp, linkId);
  await setClock(request, at("08:45"));
  await tick(request);
  await setClock(request, at("08:52"));
  await heAnswers(him, "taken");
  await setClock(request, at("12:32"));
  await openHome(dp, linkId);
  await dp.getByTestId("week-strip").click();
  await expect(dp.getByTestId("family-week")).toHaveAttribute("data-offset", "0");
  await expect(dp.getByTestId("day-list").locator("li")).toHaveCount(7);
  await shot(dp, "C1");
  await dp.getByTestId("week-earlier").click();
  await expect(dp.getByTestId("family-week")).toHaveAttribute("data-offset", "-1");
  await shot(dp, "C2");
  await him.close();
  await her.close();
});

test("F: what he shares, his visit records, one visit, his notes, and a screen he has not shared", async ({ browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const { him, her, linkId, dp } = await pair(browser, baseURL!, request, { switches: { ...SHARE_COUNTS, no_reply_alert: true } });
  await dp.goto(home(linkId));
  await welcomed(dp, linkId);
  await setClock(request, at("12:35"));

  // F1: four items on, his visit records and his notes not shared
  await dp.goto(`/f/shared?link=${linkId}`);
  await expect(dp.getByTestId("shared-items")).toBeVisible();
  await shot(dp, "F1");
  // F6: a row that is not shared still opens its screen, which says so
  await dp.locator('[data-grant="visit_transcripts"]').click();
  await expect(dp.getByTestId("family-visits")).toHaveAttribute("data-state", "not_shared");
  await shot(dp, "F6");

  // F3, F4, F5: he switches both on
  await setSwitches(him, linkId, { ...SHARE_COUNTS, no_reply_alert: true, visit_transcripts: true, notes: true });
  await dp.goto(`/f/shared/visits?link=${linkId}`);
  await expect(dp.getByTestId("family-visits")).toHaveAttribute("data-state", "shown");
  await shot(dp, "F3");
  const visit = dp.getByTestId("shared-visit").last();
  if (await visit.count()) {
    await visit.click();
    await expect(dp.getByTestId("family-visit")).toHaveAttribute("data-state", "shown");
    await shot(dp, "F4");
  }
  await dp.goto(`/f/shared/notes?link=${linkId}`);
  await expect(dp.getByTestId("family-notes")).toHaveAttribute("data-state", "shown");
  await shot(dp, "F5");
  await him.close();
  await her.close();
});

test("G, H1, H2: her own page and the screens behind its rows, he stops sharing, she leaves, her own page after each", async ({ browser, baseURL, request }) => {
  test.setTimeout(240_000);
  // her phone can be told: notifications turned on from 「我的」→「通知」
  const sub = service.newPhone({ label: "her phone" });
  const a = await pair(browser, baseURL!, request, {
    switches: SHARE_COUNTS,
    init: async (c) => {
      await answerPermissionPrompt(c, "granted");
      await stubPushSubscription(c, sub);
    },
  });
  await a.dp.goto(home(a.linkId));
  await welcomed(a.dp, a.linkId);
  await setClock(request, at("21:00"));
  await a.dp.goto(`/f/me/notifications?link=${a.linkId}`);
  await a.dp.getByTestId("me-push-on").click();
  await expect(a.dp.getByTestId("me-notifications")).toHaveAttribute("data-state", "on", { timeout: 15_000 });
  await shot(a.dp, "G2-on");

  // G1: 「我的」
  await a.dp.goto(`/f/me?link=${a.linkId}`);
  await expect(a.dp.getByTestId("me-notifications")).toHaveAttribute("data-state", "on");
  await shot(a.dp, "G1");
  // G3: his number
  await a.dp.getByTestId("me-phone").click();
  await expect(a.dp.getByTestId("phone-input")).toBeVisible();
  await shot(a.dp, "G3");
  // G4: leaving, before she decides
  await a.dp.goto(`/f/me/leave?link=${a.linkId}`);
  await expect(a.dp.getByTestId("family-leave")).toBeVisible();
  await shot(a.dp, "G4");
  // G5: deleting her account: what follows, then her password (kept from before the draft)
  await a.dp.goto(`/f/me/delete?link=${a.linkId}`);
  await expect(a.dp.getByTestId("her-delete-what")).toBeVisible();
  await shot(a.dp, "G5");
  await a.dp.getByTestId("her-delete-continue").click();
  await expect(a.dp.getByTestId("her-delete-password")).toBeVisible();
  await shot(a.dp, "G5-password");

  // H1: he stops sharing while her home is open
  await openHome(a.dp, a.linkId);
  const stopped = await a.him.request.post(`/api/family/links/${a.linkId}/revoke`, { data: {} });
  expect(stopped.ok(), await stopped.text()).toBe(true);
  await expect(a.dp.getByTestId("family-app")).toHaveAttribute("data-state", "ended", { timeout: 10_000 });
  await shot(a.dp, "H1");
  // 「我的」 from H1 (not drawn in the draft): her own account's rows alone
  await a.dp.getByTestId("open-me").click();
  await expect(a.dp.getByTestId("family-me")).toHaveAttribute("data-state", "revoked");
  await shot(a.dp, "G1-ended");
  await a.him.close();
  await a.her.close();

  // G2: an iPhone whose notifications are switched off in its settings (Ripple is on the Home Screen)
  const b = await pair(browser, baseURL!, request, {
    switches: SHARE_COUNTS,
    herExtra: { userAgent: IPHONE_UA, isMobile: true, hasTouch: true },
    init: (c) =>
      c.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
        Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" });
        Notification.requestPermission = async () => "denied";
      }),
  });
  await b.dp.goto(home(b.linkId));
  await welcomed(b.dp, b.linkId);
  await b.dp.goto(`/f/me/notifications?link=${b.linkId}`);
  await expect(b.dp.getByTestId("me-notifications")).toHaveAttribute("data-state", "denied");
  await shot(b.dp, "G2");
  // the screen behind 「怎么加到主屏」
  await b.dp.getByTestId("notifications-install").click();
  await expect(b.dp.getByTestId("family-install")).toBeVisible();
  await shot(b.dp, "G2-install");

  // H2: she leaves by herself
  await b.dp.goto(`/f/me/leave?link=${b.linkId}`);
  await b.dp.getByTestId("me-leave").click();
  await expect(b.dp.getByTestId("family-app")).toHaveAttribute("data-state", "left", { timeout: 10_000 });
  await shot(b.dp, "H2");
  // 「我的」 from H2
  await b.dp.getByTestId("open-me").click();
  await expect(b.dp.getByTestId("family-me")).toHaveAttribute("data-state", "left");
  await shot(b.dp, "G1-left");
  await b.him.close();
  await b.her.close();
});

test("I1: her home while his day is still being read", async ({ browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const { him, her, linkId, dp } = await pair(browser, baseURL!, request, { switches: SHARE_COUNTS });
  await dp.goto(home(linkId));
  await welcomed(dp, linkId);
  await setClock(request, at("12:31"));
  // the server sends the screen's own shape first and his day right behind it, in the same answer. The picture is of
  // the first part alone: the answer is cut where the second part begins.
  await dp.route(
    (u) => u.pathname === "/f",
    async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      const html = await res.text();
      const cut = html.indexOf('<div hidden id="S:');
      await route.fulfill({ response: res, body: cut > 0 ? html.slice(0, cut) : html });
    },
  );
  await dp.goto(home(linkId));
  await expect(dp.getByTestId("family-loading")).toBeVisible();
  await expect(dp.getByTestId("family-app")).toHaveCount(0);
  await shot(dp, "I1");
  await him.close();
  await her.close();
});
