/**
 * M4 item 5 on the devices: Wei Ling's clip plays at the reminder time (and on the director's cue in filming); after
 * two reminders with no reply the alert reaches her phone (/f) while family_grant.no_reply_alert is on (the seed).
 * The "off" state has no switch screen yet (M6 builds /api/family/grants): it is covered by
 * tests/unit/daily/reminders-alerts.test.ts through the same route.
 * Autoplay is allowed in this browser so the "plays at the reminder time" part can be observed.
 */
import { expect, test } from "@playwright/test";
import { api, closeAll, CREW_HEADERS, createSession, openCrewDevice, openDevice, textBelow } from "./helpers";
import { DEV_ONLY_CREW_KEY } from "../lib/visit/crew";

/** M8 judge-link gating: a filming session needs the crew key (lib/session/crew-key.ts). */
const CREW_KEY = process.env.SCRIPTED_FALLBACK_KEY || DEV_ONLY_CREW_KEY;

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
// C2 (lib/crew/gate.ts): the story clock and the cues are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

const MED = "med-amlodipine";

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 42, story_time: "08:30" });
  for (const p of ["/p/today", "/f", "/director"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
  await request.get(`/api/family/alerts?session=${s.id}`);
  await request.get(`/api/reminders/clip-wei-ling-1/audio?session=${s.id}`);
});

const plays = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window.__rpDailyClipPlays ?? []).filter((p) => p.url.includes("/api/reminders/")).map((p) => ({ auto: p.auto, playing: p.playing })));

test("the reminder at its time: first and second reminder play her clip; the window closes into 'no reply'; Wei Ling is told", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { kind: "filming", story_day: 42, story_time: "08:30", crew_key: CREW_KEY });
  const phone = await openDevice(browser, s.id, "/p/today");
  const family = await openDevice(browser, s.id, "/f");
  await expect(phone.page.getByTestId("reminder-strip")).toHaveCount(0);
  await expect(family.page.getByTestId("family-alerts")).toHaveAttribute("data-on", "true");
  await expect(family.page.getByTestId("family-alert")).toHaveCount(0);

  // 08:45, after breakfast: the first reminder, her words (女儿说) and her clip plays by itself
  await api(request, "/api/clock", s.id, { day: 42, time: "08:45" });
  const strip = phone.page.getByTestId("reminder-strip");
  await expect(strip).toHaveAttribute("data-reminder", "1", { timeout: 5000 });
  await expect(strip).toContainText("「爸，早餐吃了吗？药记得吃哦。」");
  await expect(strip).toContainText("女儿说");
  await expect(strip.getByTestId("reminder-clip-play")).toContainText("代录音");
  await expect.poll(() => plays(phone.page), { timeout: 10_000 }).toEqual(expect.arrayContaining([{ auto: true, playing: true }]));
  expect(await textBelow(phone.page, 18)).toEqual([]);

  // 09:15: the second reminder plays again
  await api(request, "/api/clock", s.id, { day: 42, time: "09:15" });
  await expect(strip).toHaveAttribute("data-reminder", "2", { timeout: 5000 });
  await expect.poll(async () => (await plays(phone.page)).filter((p) => p.auto).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // 09:50: no reply after two reminders -> unconfirmed, and the alert reaches Wei Ling (grant on in the seed)
  await api(request, "/api/clock", s.id, { day: 42, time: "09:50" });
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveText("两次提醒都没回（未确认）", { timeout: 5000 });
  await expect(phone.page.getByTestId("reminder-strip")).toHaveCount(0);
  await expect(family.page.getByTestId("family-alert")).toHaveCount(1, { timeout: 5000 });
  await expect(family.page.getByTestId("family-alert")).toContainText("爸爸两次提醒都没回：10月5日早上的药（Amlodipine）。");
  expect(await textBelow(family.page, 18)).toEqual([]);
  await closeAll([phone, family]);
});

test("an answer stops the reminders and nobody is told", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 42, story_time: "08:45" });
  const phone = await openDevice(browser, s.id, "/p/today");
  const family = await openDevice(browser, s.id, "/f");
  await expect(phone.page.getByTestId("reminder-strip")).toHaveAttribute("data-reminder", "1");
  await phone.page.getByTestId(`dose-btn-${MED}-taken`).click();
  await expect(phone.page.getByTestId("reminder-strip")).toHaveCount(0);
  await api(request, "/api/clock", s.id, { day: 42, time: "09:50" });
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");
  await family.page.waitForTimeout(1000);
  await expect(family.page.getByTestId("family-alert")).toHaveCount(0);
  await closeAll([phone, family]);
});

test("filming: the director's reminder cue plays her clip on the phone; 'simulate no reply' alerts Wei Ling", async ({ browser, request }) => {
  const s = await createSession(request, { kind: "filming", story_day: 42, story_time: "08:30", crew_key: CREW_KEY });
  const phone = await openDevice(browser, s.id, "/p/today");
  const family = await openDevice(browser, s.id, "/f");
  const director = await openCrewDevice(browser, s.id, "/director");
  await director.page.getByTestId("director-reminder").click();
  await expect(phone.page.getByTestId("reminder-card")).toBeVisible(); // M0's card with her words
  await expect(phone.page.getByTestId("reminder-cue-audio")).toBeVisible({ timeout: 2000 });
  await expect.poll(() => plays(phone.page), { timeout: 10_000 }).toEqual(expect.arrayContaining([{ auto: true, playing: true }]));
  await director.page.getByTestId("director-reminder").click();
  await director.page.getByTestId("director-no-reply").click();
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "unconfirmed");
  await expect(family.page.getByTestId("family-alert")).toHaveCount(1, { timeout: 5000 });
  await closeAll([phone, family, director]);
});
