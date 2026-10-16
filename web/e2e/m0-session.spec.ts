/**
 * M0 acceptance (docs/plan/tasks/M0-skeleton.md, 验收), one test per line, plus the join flow,
 * story clock, filming mode and route shells. No keys, no AI calls: in-memory store + SSE.
 *
 * C2 (track E, the demo fence, lib/crew/gate.ts): the story clock, the director's cues and reset are the film crew's, so
 * this file's `request` carries the crew key (CREW_HEADERS); the backstage, the director and the /join page are opened by
 * crew devices (openCrewDevice), and the jump menu and debug line show on a crew phone only. The judges' page is /demo.
 * A browser with no cookie at all opening /p/today now goes to /login (track A's proxy, real-app 2.1).
 */
import { expect, test } from "@playwright/test";
import {
  api,
  BASE_URL,
  closeAll,
  CREW_HEADERS,
  createSession,
  crewCookie,
  DEMO_ROOT,
  fontPx,
  openCrewDevice,
  openDevice,
  seedDoses,
  textBelow,
  waitLive,
  warmUp,
  withCrew,
  type Device,
} from "./helpers";
import { CREW_COOKIE, crewCookieValue } from "../lib/session/crew-key";
import { DEV_ONLY_CREW_KEY } from "../lib/visit/crew";

/** M8 judge-link gating: filming sessions and filming mode on need the crew key (lib/session/crew-key.ts). */
const CREW_KEY = process.env.SCRIPTED_FALLBACK_KEY || DEV_ONLY_CREW_KEY;

const MED = "med-amlodipine";

// the story clock, the cues, filming mode and reset are the crew's: this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  await warmUp(request);
});

test("a dose tick on phone A reaches phone B and the desktop within 1 second", async ({ browser, request }) => {
  // Day 15 is a tai chi Tuesday: the seed has this morning's tablet as "missed".
  const s = await createSession(request, { story_day: 15 });
  const phoneA = await openDevice(browser, s.id, "/p/today");
  const phoneB = await openDevice(browser, s.id, "/p/today");
  const desk = await openCrewDevice(browser, s.id, "/backstage");
  const devices: Device[] = [phoneA, phoneB, desk];

  for (const phone of [phoneA, phoneB]) {
    await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "missed");
  }
  await expect(desk.page.getByTestId(`backstage-dose-${MED}`)).toHaveAttribute("data-state", "missed");

  const t0 = Date.now();
  await phoneA.page.getByTestId(`dose-btn-${MED}-taken`).click();
  await Promise.all([
    expect(phoneB.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken", { timeout: 1000 }),
    expect(desk.page.getByTestId(`backstage-dose-${MED}`)).toHaveAttribute("data-state", "taken", { timeout: 1000 }),
  ]);
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeLessThan(1000);
  test.info().annotations.push({ type: "sync_ms", description: String(elapsed) });

  await expect(phoneA.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");
  await expect(phoneB.page.getByTestId(`dose-state-${MED}`)).toContainText("吃了");
  await expect(desk.page.locator('[data-testid="event-row"][data-type="dose.logged"]')).toHaveCount(1);
  await closeAll(devices);
});

test("sessions X and Y never see each other's data", async ({ browser, request }) => {
  const x = await createSession(request, { story_day: 15 });
  const y = await createSession(request, { story_day: 15 });
  expect(x.id).not.toBe(y.id);
  expect(x.join_code).not.toBe(y.join_code);

  const phoneX = await openDevice(browser, x.id, "/p/today");
  const phoneY = await openDevice(browser, y.id, "/p/today");
  const deskY = await openCrewDevice(browser, y.id, "/backstage");

  await phoneX.page.getByTestId(`dose-btn-${MED}-taken`).click();
  await expect(phoneX.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");
  await api(request, "/api/director/cue", x.id, { cue: "reminder" });
  await expect(phoneX.page.getByTestId("reminder-card")).toBeVisible();

  // Give any stray event time to arrive, then check Y is untouched.
  await phoneY.page.waitForTimeout(1500);
  await expect(phoneY.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "missed");
  await expect(phoneY.page.getByTestId("reminder-card")).toHaveCount(0);
  await expect(deskY.page.getByTestId(`backstage-dose-${MED}`)).toHaveAttribute("data-state", "missed");
  await expect(deskY.page.getByTestId("event-row")).toHaveCount(0);

  const dosesY = (await (await request.get(`/api/doses?session=${y.id}&from=15&to=15`)).json()).doses;
  const dosesX = (await (await request.get(`/api/doses?session=${x.id}&from=15&to=15`)).json()).doses;
  expect(dosesY.map((d: { state: string }) => d.state)).toEqual(["missed"]);
  expect(dosesX.map((d: { state: string }) => d.state)).toEqual(["taken"]);
  await closeAll([phoneX, phoneY, deskY]);
});

test("director 'pop reminder now' shows the reminder card on every patient page in the session", async ({
  browser,
  request,
}) => {
  const s = await createSession(request, { kind: "filming", story_day: 9, story_time: "08:45", crew_key: CREW_KEY });
  const today = await openDevice(browser, s.id, "/p/today");
  const meds = await openDevice(browser, s.id, "/p/meds");
  const family = await openDevice(browser, s.id, "/f");
  const director = await openCrewDevice(browser, s.id, "/director");

  await director.page.getByTestId("director-reminder").click();
  for (const phone of [today, meds]) {
    const card = phone.page.getByTestId("reminder-card");
    await expect(card).toBeVisible({ timeout: 1000 });
    await expect(card).toContainText("今天早上的药吃了吗？");
    await expect(card).toContainText("女儿说"); // Wei Ling's own recorded words, with their source
    await expect(card).toContainText("Amlodipine");
  }
  await expect(family.page.getByTestId("reminder-card")).toHaveCount(0);

  // Answering on one phone closes the card everywhere and records the dose.
  await today.page.getByTestId("reminder-btn-taken").click();
  await expect(today.page.getByTestId("reminder-card")).toHaveCount(0);
  await expect(meds.page.getByTestId("reminder-card")).toHaveCount(0);
  await expect(today.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");
  await expect(family.page.getByTestId(`family-dose-${MED}`)).toHaveAttribute("data-state", "taken");

  // "Simulate no reply" on a day with no answer yet: card closes, dose recorded as not confirmed.
  await api(request, "/api/clock", s.id, { day: 10, time: "08:45" });
  await expect(today.page.getByTestId("story-day-label")).toContainText("第10天");
  await expect(today.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken"); // seed: D10 taken
  await api(request, "/api/clock", s.id, { day: 43 }); // after the story: nothing recorded yet
  await expect(today.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "none");
  await director.page.getByTestId("director-reminder").click();
  await expect(today.page.getByTestId("reminder-card")).toBeVisible();
  await director.page.getByTestId("director-no-reply").click();
  await expect(today.page.getByTestId("reminder-card")).toHaveCount(0);
  await expect(today.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "unconfirmed");
  await expect(today.page.getByTestId(`dose-state-${MED}`)).toContainText("未确认");
  await closeAll([today, meds, family, director]);
});

test("reset puts the session back to timeline.seed.json", async ({ browser, request }) => {
  const s = await createSession(request); // lands on D29: this morning's tablet is "taken" in the seed
  const phone = await openDevice(browser, s.id, "/p/today");
  await expect(phone.page.getByTestId("story-day-label")).toContainText("第29天");
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");

  // Change things: today's answer, another day's answer, the clock, filming mode.
  await phone.page.getByTestId(`dose-btn-${MED}-missed`).click();
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "missed");
  await api(request, "/api/doses", s.id, { medication_id: MED, day: 20, slot: "morning", state: "missed" });
  await api(request, "/api/doses", s.id, { medication_id: MED, day: 43, slot: "morning", state: "taken" });
  await api(request, "/api/clock", s.id, { day: 3, time: "21:00" });
  await expect(phone.page.getByTestId("story-day-label")).toContainText("第3天");

  const director = await openCrewDevice(browser, s.id, "/director");
  await director.page.getByTestId("director-reset").click();
  await director.page.getByTestId("director-reset-confirm").click();

  // back to the seed, on the evening of Day 29, 8:15pm (C2: the reset sets the time too)
  await expect(phone.page.getByTestId("story-day-label")).toContainText("第29天");
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");
  await expect(director.page.getByTestId("director-day-label")).toContainText("Day 29");

  const doses = (await (await request.get(`/api/doses?session=${s.id}`)).json()).doses as {
    day: number;
    medication_id: string;
    slot: string;
    state: string;
  }[];
  const seed = seedDoses()
    .map((d) => ({ day: d.day, medication_id: d.med, slot: d.slot, state: d.state }))
    .sort((a, b) => a.day - b.day);
  expect(doses.map(({ day, medication_id, slot, state }) => ({ day, medication_id, slot, state }))).toEqual(seed);
  const session = (await (await request.get(`/api/session?session=${s.id}`)).json()).session;
  expect(session).toMatchObject({ id: s.id, join_code: s.join_code, story_day: 29, story_time: "20:15" });
  await closeAll([phone, director]);
});

test("'/demo' answers 200 and gives each judge an own sandbox; '/' is the app's welcome page, with no sandbox", async ({ browser, request }) => {
  const front = await request.get("/", { maxRedirects: 0 });
  expect(front.status()).toBe(200);
  expect(front.headers()["set-cookie"] ?? "").not.toMatch(/rp_session=/);
  const plain = await request.get(DEMO_ROOT, { maxRedirects: 0 });
  expect(plain.status()).toBe(200);

  const codes: string[] = [];
  for (let i = 0; i < 2; i++) {
    // C2: the phone follows the browser's language the first time (a Chinese browser here)
    const context = await browser.newContext({ baseURL: BASE_URL, locale: "zh-CN" });
    const page = await context.newPage();
    const res = await page.goto(DEMO_ROOT);
    expect(res?.status()).toBe(200);
    await waitLive(page);
    await expect(page.getByTestId("landing-phone")).toBeVisible();
    await expect(page.getByTestId("backstage-day-label")).toContainText("Day 29");
    const phone = page.frameLocator('[data-testid="landing-phone"]');
    await expect(phone.getByTestId("story-day-label")).toContainText("第29天");
    const cookie = (await context.cookies()).find((c) => c.name === "rp_session");
    expect(cookie?.value).toBeTruthy();
    const session = (await (await request.get(`/api/session?session=${cookie!.value}`)).json()).session;
    codes.push(session.join_code);
    await context.close();
  }
  expect(codes[0]).not.toBe(codes[1]);
});

test("a phone joins with the code and lands on its role's page (the crew's phone: /join is 404 to anyone else)", async ({ browser, request }) => {
  const s = await createSession(request, { kind: "filming", crew_key: CREW_KEY });
  const outsider = await browser.newContext({ baseURL: BASE_URL });
  expect((await (await outsider.newPage()).goto("/join"))?.status()).toBe(404);
  await outsider.close();
  const context = await withCrew(await browser.newContext({ baseURL: BASE_URL }));
  const page = await context.newPage();
  await page.goto("/join");
  // no role is chosen for the device (real-app 2.20, 5.2): nothing is ticked, the button waits and says why
  for (const role of ["patient", "family", "backstage", "director"]) await expect(page.getByTestId(`join-role-${role}`)).not.toBeChecked();
  await page.getByTestId("join-code-input").fill("NOPE99");
  await expect(page.getByTestId("join-submit")).toBeDisabled();
  await expect(page.getByTestId("join-role-first")).toHaveText("先选这台设备是谁的。");
  await page.getByTestId("join-role-family").check();
  await expect(page.getByTestId("join-role-first")).toHaveCount(0);
  await page.getByTestId("join-submit").click();
  await expect(page.getByTestId("join-error")).toBeVisible();

  await page.goto(`/join?code=${s.join_code.toLowerCase()}`);
  await page.getByTestId("join-role-patient").check();
  await page.getByTestId("join-submit").click();
  await page.waitForURL("**/p/today");
  await waitLive(page);
  await expect(page.getByTestId("debug-info")).toContainText(s.join_code);
  const members = (await (await request.get(`/api/session?session=${s.id}`)).json()).members as { role: string }[];
  expect(members.map((m) => m.role)).toContain("patient");
  await context.close();
});

test("director clock moves every phone's day label; filming mode hides the jump menu and debug line", async ({
  browser,
  request,
}) => {
  const s = await createSession(request, { kind: "filming", crew_key: CREW_KEY });
  const phone = await openCrewDevice(browser, s.id, "/p/today");
  const director = await openCrewDevice(browser, s.id, "/director");
  // the crew's laptop carries the crew cookie (set by /backstage/crew), so its Director page may switch filming on
  await director.context.addCookies([{ name: CREW_COOKIE, value: crewCookieValue(CREW_KEY), url: BASE_URL }]);

  await director.page.getByTestId("beat-d0-visit").click();
  await expect(phone.page.getByTestId("story-day-label")).toHaveText("第0天 · 周一 上午9:30");
  // the phone follows the scene: Day 0 is the first visit (real-status: the scene changed the day, not the page)
  await expect(phone.page).toHaveURL(/\/p\/visit$/, { timeout: 10_000 });
  await director.page.getByTestId("director-next-beat").click();
  await expect(phone.page.getByTestId("story-day-label")).toHaveText("第1天 · 周二 上午7:40");
  await expect(phone.page).toHaveURL(/\/p\/bp$/, { timeout: 10_000 });
  await expect(director.page.getByTestId("director-day-label")).toHaveText("Day 1 · Tue 7:40am");

  await expect(phone.page.getByTestId("jump-menu")).toBeVisible();
  await expect(phone.page.getByTestId("debug-info")).toBeVisible();
  const shell = phone.page.locator(".rp-patient");
  await expect(shell).toHaveAttribute("data-filming", "false");
  await director.page.getByTestId("director-filming").click();
  await expect(shell).toHaveAttribute("data-filming", "true");
  await expect(phone.page.getByTestId("jump-menu")).toHaveCount(0);
  await expect(phone.page.getByTestId("debug-info")).toHaveCount(0);
  expect(await shell.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
  await expect(phone.page.getByTestId("tab-bar")).toBeVisible();
  await director.page.getByTestId("director-filming").click();
  await expect(phone.page.getByTestId("jump-menu")).toBeVisible();
  await closeAll([phone, director]);
});

const PHONE_ROUTES = [
  "/p/today",
  "/p/visit",
  "/p/visit/v1/review",
  "/p/meds",
  "/p/meds/med-amlodipine",
  "/p/meds/add",
  "/p/bp",
  "/p/questions",
  "/p/brief",
  "/f",
];

test("every route in spec section 1 has a shell; every visible text on the phone pages is at least 18px", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  // Day 9 at 08:45: the dose card shows the 吃了 / 没吃 / 等下 buttons; the question link shows its tag.
  const s = await createSession(request, { story_day: 9, story_time: "08:45" });
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
  const page = await context.newPage();
  for (const route of PHONE_ROUTES) {
    const res = await page.goto(route);
    expect(res?.status(), route).toBe(200);
    const shell = page.locator(".rp-patient").first();
    await expect(shell, route).toHaveAttribute("lang", "zh-Hans");
    await waitLive(page); // hydrated: what is measured is what the phone shows
    expect(await textBelow(page, 18), route).toEqual([]);
  }

  // The same Today screen in English (longer tab labels).
  await context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.goto("/p/today");
  await expect(page.locator(".rp-patient").first()).toHaveAttribute("lang", "en");
  await waitLive(page);
  expect(await textBelow(page, 18), "/p/today (en)").toEqual([]);
  await context.clearCookies({ name: "rp_lang" });

  // Phone screens without a session: /join (the crew's phone signs in first), and a /p page on a browser with no
  // cookie at all, which track A's proxy sends to sign in (real-app 2.1: 307 to /login?next=)
  const fresh = await browser.newContext({ baseURL: BASE_URL });
  const lonely = await fresh.newPage();
  await fresh.addCookies([crewCookie()]);
  await lonely.goto("/join");
  await expect(lonely.getByTestId("join-form")).toBeVisible();
  expect(await textBelow(lonely, 18), "/join").toEqual([]);
  await fresh.clearCookies();
  await lonely.goto("/p/today");
  await expect(lonely).toHaveURL(/\/login\?next=%2Fp%2Ftoday$/);
  expect(await textBelow(lonely, 18), "/login after /p/today without a session").toEqual([]);
  await fresh.close();

  // the judges' pages answer everyone; the crew's answer 404 without the crew's cookie and 200 with it
  for (const route of ["/", DEMO_ROOT, "/try", "/eval", "/how"]) {
    const res = await page.goto(route);
    expect(res?.status(), route).toBe(200);
  }
  for (const route of ["/join", "/backstage", "/director"]) {
    const res = await page.goto(route);
    expect(res?.status(), `${route} without the crew`).toBe(404);
  }
  await withCrew(context);
  for (const route of ["/join", "/backstage", "/director"]) {
    const res = await page.goto(route);
    expect(res?.status(), `${route} as the crew`).toBe(200);
  }
  await context.close();
});

test("the reminder card and the 吃了 / 没吃 / 等下 buttons are at least 18px, and 20px in filming mode", async ({
  browser,
  request,
}) => {
  const s = await createSession(request, { kind: "filming", story_day: 43, crew_key: CREW_KEY }); // nothing recorded yet
  const phone = await openDevice(browser, s.id, "/p/today");
  await api(request, "/api/director/cue", s.id, { cue: "reminder" });
  await expect(phone.page.getByTestId("reminder-card")).toBeVisible();

  expect(await textBelow(phone.page, 18), "normal mode").toEqual([]);
  for (const id of [`dose-btn-${MED}-taken`, `dose-btn-${MED}-missed`, `dose-btn-${MED}-later`, "reminder-btn-taken"]) {
    expect(await fontPx(phone.page, id), id).toBeGreaterThanOrEqual(18);
  }

  await api(request, "/api/director/filming", s.id, { on: true, crew_key: CREW_KEY });
  await expect(phone.page.locator(".rp-patient")).toHaveAttribute("data-filming", "true");
  await expect(phone.page.getByTestId("reminder-card")).toBeVisible();
  // Filming mode: no developer chrome left, so only the small labels are exempt.
  expect(await textBelow(phone.page, 18, ".rp-src, .rp-tag, .rp-kicker, .rp-count"), "filming mode").toEqual([]);
  for (const id of [`dose-btn-${MED}-taken`, `dose-btn-${MED}-missed`, `dose-btn-${MED}-later`, "reminder-btn-taken", "reminder-btn-later"]) {
    expect(await fontPx(phone.page, id), `${id} (filming)`).toBeGreaterThanOrEqual(20);
  }
  await closeAll([phone]);
});

test("at 18px the tab bar still fits a 360px phone in both languages, also in filming mode", async ({ browser, request }) => {
  const s = await createSession(request, { kind: "filming", crew_key: CREW_KEY });
  const overflowing = async (lang: string) => {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 360, height: 780 } });
    await context.addCookies([
      { name: "rp_session", value: s.id, url: BASE_URL },
      { name: "rp_lang", value: lang, url: BASE_URL },
    ]);
    const page = await context.newPage();
    await page.goto("/p/today");
    await waitLive(page);
    const tabs = page.getByTestId("tab-bar").locator("a");
    await expect(tabs).toHaveCount(5);
    const result = await tabs.evaluateAll((links) =>
      links
        .filter((a) => a.scrollWidth > a.clientWidth + 1 || parseFloat(getComputedStyle(a).fontSize) < 18)
        .map((a) => `${a.textContent} (${getComputedStyle(a).fontSize}, ${a.scrollWidth}/${a.clientWidth})`),
    );
    await context.close();
    return result;
  };
  for (const lang of ["zh-Hans", "en"]) expect(await overflowing(lang), lang).toEqual([]);
  await api(request, "/api/director/filming", s.id, { on: true, crew_key: CREW_KEY });
  for (const lang of ["zh-Hans", "en"]) expect(await overflowing(lang), `${lang} filming`).toEqual([]);
});
