/**
 * M8 backstage (/backstage) and /how:
 *   1. every event as one plain sentence with its raw JSON one tap away; the refused hero request and the blocked
 *      layer stand out; who-said-it changes and scripted fallback stand out; text at least 18px on a light page;
 *   2. a reader who scrolled up is not moved by new events (they are added below, a button counts them);
 *   3. /how at 390 px and 1440 px: everything there, no sideways page scroll, products from one config, never
 *      "TRTC speech recognition".
 */
import { expect, test, type Page } from "@playwright/test";
import { DEV_ONLY_CREW_KEY } from "../lib/visit/crew";
import { api, BASE_URL, closeAll, CREW_HEADERS, createSession, openCrewDevice, textBelow } from "./helpers";

const CREW_KEY = process.env.SCRIPTED_FALLBACK_KEY || DEV_ONLY_CREW_KEY;
const HERO_ZH = "今天 150/95，我能不能多吃一粒？";

// C2 (lib/crew/gate.ts): the backstage, the story clock and the scripted fallback are the film crew's
test.use({ extraHTTPHeaders: CREW_HEADERS });

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request);
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/backstage", "/how"]) await request.get(p, { headers: cookie });
  await api(request, "/api/ask", s.id, { text: HERO_ZH, locale: "zh-Hans" });
});

const rows = (page: Page, type?: string) => page.locator(type ? `[data-testid="event-row"][data-type="${type}"]` : '[data-testid="event-row"]');

test("events read as sentences with raw JSON; blocks, who-said-it and scripted fallback stand out; 18px text", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { kind: "filming", story_day: 0, filming_mode: true, crew_key: CREW_KEY });
  const desk = await openCrewDevice(browser, s.id, "/backstage");
  const page = desk.page;
  await expect(page.getByTestId("event-feed-empty")).toBeVisible();

  // the hero question (Day 29 evening): every step a sentence, the refused request highlighted with why; asked from his
  // phone (who asks is the device's member row since C2, never the body's role)
  await api(request, "/api/clock", s.id, { day: 29, time: "20:15" });
  const his = await browser.newContext({ baseURL: BASE_URL });
  const joined = await his.request.post("/api/session/join", { data: { code: s.join_code, role: "patient" } });
  expect(joined.status(), await joined.text()).toBe(200);
  await api(his.request, "/api/ask", s.id, { text: HERO_ZH, locale: "zh-Hans" });
  await his.close();
  await expect(rows(page, "ask.answered")).toHaveCount(1, { timeout: 4000 });
  await expect(rows(page, "ask.received").getByTestId("event-sentence")).toHaveText(`Mr Tan asked on Day 29: “${HERO_ZH}”`);
  const refused = rows(page, "ask.blocked").first();
  await expect(refused).toHaveAttribute("data-tone", "blocked");
  await expect(refused.getByTestId("event-badge")).toHaveText("Blocked · the request");
  await expect(refused.getByTestId("event-sentence")).toContainText("Not answered");
  await expect(refused.getByTestId("event-why")).toContainText("asks to change the dose");
  await expect(rows(page, "verify.layer3").getByTestId("event-sentence")).toContainText("not needed");
  for (const row of await rows(page).all()) await expect(row).toHaveAttribute("data-known", "true");

  // raw JSON, one tap away
  const raw = refused.getByTestId("event-raw");
  await raw.locator("summary").click();
  const json = JSON.parse((await refused.getByTestId("event-raw-json").textContent())!);
  expect(json).toMatchObject({ type: "ask.blocked", data: { stage: "route", request: HERO_ZH } });

  // (a sentence stopped at layer 1-3 shows "Blocked · layer N" and the reasons: tests/unit/backstage/sentences.test.ts)

  // who said it: a D0 recording with the crew's scripted fallback, as on the filming laptop
  await api(request, "/api/clock", s.id, { day: 0, time: "09:30" });
  await api(request, "/api/visits", s.id, { mode: "record", consent: { given: true } });
  const unlock = await request.post(`/api/visits/v1/scripted?session=${s.id}`, { data: { on: true, key: CREW_KEY } });
  expect(unlock.status()).toBe(200);
  await api(request, "/api/visits/v1/extract", s.id, {
    utterances: [{ t_start_ms: 1500, t_end_ms: 6115, speaker_cluster: 0, text: "Doctor, can I record? My daughter wants me to use this app." }],
  });
  await api(request, "/api/visits/v1/extract", s.id, { utterances: [{ t_start_ms: 6815, t_end_ms: 8015, speaker_cluster: 1, text: "Shore, know prob lame." }] });
  const fallback = rows(page, "scripted_fallback").first();
  await expect(fallback).toHaveAttribute("data-tone", "fallback", { timeout: 4000 });
  await expect(fallback.getByTestId("event-badge")).toHaveText("Scripted fallback");
  await expect(fallback.getByTestId("event-sentence")).toContainText("Sure, no problem.");
  const role = rows(page, "utterance.role").first();
  await expect(role).toHaveAttribute("data-tone", "role", { timeout: 4000 });
  await expect(role.getByTestId("event-badge")).toHaveText("Who said it");
  // counted by who and how sure, never by sentence id (C2: no codes on a screen judges read)
  await expect(role.getByTestId("event-sentence")).toContainText("Who said it at the first visit:");
  await expect(role.getByTestId("event-sentence")).not.toContainText("v1-u");

  // light page, text at least 18px (the shared page header excepted)
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="event-feed"]')!).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
  expect(await textBelow(page, 18, "header")).toEqual([]);
  await closeAll([desk]);
});

test("a reader who scrolled up is not moved: new events are added below and counted", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  // enough rows to scroll
  for (let i = 0; i < 4; i++) await api(request, "/api/ask", s.id, { text: i % 2 ? "我今天好累" : HERO_ZH, locale: "zh-Hans", role: "patient" });
  const desk = await openCrewDevice(browser, s.id, "/backstage");
  const page = desk.page;
  const list = page.getByTestId("event-list");
  await expect(rows(page).first()).toBeVisible();
  const scrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 100);
  expect(scrollable).toBe(true);
  // it starts at the newest event
  expect(await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);

  // the reader scrolls up to read an older row
  await list.evaluate((el) => {
    el.scrollTop = 40;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(200);
  const before = await rows(page).count();
  const anchor = rows(page).nth(1);
  const anchorTop = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await api(request, "/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "taken" });
  await api(request, "/api/ask", s.id, { text: HERO_ZH, locale: "zh-Hans", role: "patient" });
  await expect.poll(() => rows(page).count(), { timeout: 4000 }).toBeGreaterThan(before + 3);
  await expect(page.getByTestId("event-new")).toBeVisible();
  expect(Number(await page.getByTestId("event-new").getAttribute("data-count"))).toBeGreaterThan(3);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(40);
  expect(await anchor.evaluate((el) => el.getBoundingClientRect().top)).toBe(anchorTop);

  // the button brings the newest into view and following resumes
  await page.getByTestId("event-new").click();
  await expect(page.getByTestId("event-new")).toHaveCount(0);
  expect(await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
  await api(request, "/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "missed" });
  await expect(rows(page, "dose.logged")).toHaveCount(2, { timeout: 4000 });
  await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
  await expect(page.getByTestId("event-new")).toHaveCount(0);
  await closeAll([desk]);
});

for (const width of [390, 1440]) {
  test(`/how at ${width} px: architecture, trust boundary and AIHGle, no sideways page scroll`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width, height: 900 } });
    const page = await context.newPage();
    expect((await page.goto("/how"))?.status()).toBe(200);
    await expect(page.getByTestId("page-how")).toBeVisible();
    for (const id of ["phones", "app", "hosting", "main_model", "checker", "stt", "tts", "database"]) await expect(page.getByTestId(`how-box-${id}`)).toBeVisible();
    await expect(page.getByTestId("how-box-main_model")).toContainText("Tencent Cloud Hunyuan");
    await expect(page.getByTestId("how-box-main_model")).toContainText("hy3");
    await expect(page.getByTestId("how-box-main_model")).toContainText("thinking mode off");
    await expect(page.getByTestId("how-box-checker")).toContainText("hy4-preview");
    await expect(page.getByTestId("how-box-checker")).toContainText("same vendor as the main model");
    await expect(page.getByTestId("how-box-checker")).toContainText("has not been run with these two models yet");
    await expect(page.getByTestId("how-box-stt")).toContainText("Local Whisper on the filming laptop");
    await expect(page.getByTestId("how-box-stt")).toContainText("large-v3-turbo (live captions), large-v3 (full transcript)");
    await expect(page.getByTestId("how-box-stt")).toContainText("recorded replays");
    await expect(page.getByTestId("how-box-tts")).toContainText("Tencent TRTC TTS");
    await expect(page.getByTestId("how-box-tts")).toContainText("mock until keys exist");
    await expect(page.getByTestId("how-box-hosting")).toContainText("Tencent Cloud Lighthouse + EdgeOne");
    await expect(page.getByTestId("how-box-hosting")).toHaveAttribute("data-status", "planned");
    await expect(page.getByTestId("how-box-hosting")).toContainText("decided, not running yet");
    await expect(page.getByTestId("how-box-database")).toContainText("Supabase");
    await expect(page.getByTestId("trust-server")).toContainText("same vendor as the main model");
    await expect(page.getByTestId("how-no-clinical-text")).toContainText("No component originates clinical text");
    await expect(page.getByTestId("trust-storage")).toContainText("a reset deletes every file of that copy");
    await expect(page.getByTestId("trust-storage-summary")).toContainText("kept 90 days unless he chooses to keep it");
    // C2: every box says what this server runs (the e2e server: the offline stand-ins and the memory store)
    await expect(page.getByTestId("how-box-database").getByTestId("how-box-running")).toContainText("kept in this server's memory");
    await expect(page.getByTestId("how-box-main_model").getByTestId("how-box-running")).toBeVisible();
    await expect(page.getByTestId("trust-family")).toBeVisible();
    await expect(page.getByTestId("aihgle-quote")).toHaveCount(3);
    await expect(page.getByTestId("aihgle-citation")).toHaveText("AIHGle 2.0 (MOH & HSA, March 2026), Table 3, p.15");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/TRTC\s*语音识别|TRTC speech recognition/i);
    // no file paths, addresses or ports (real-status), open or folded
    const all = (await page.locator("main").textContent()) ?? ""; // main: not the page's inline framework scripts
    expect(all).not.toMatch(/127\.0\.0\.1|localhost:|:7810|web\/|lib\/|\.json\b/);
    // the real-recording page is the crew's: a judge gets its credit, not a link that answers 404
    await expect(page.getByTestId("how-real-credit")).toBeVisible();
    await expect(page.getByTestId("how-real-link")).toHaveCount(0);
    // everything renders, nothing scrolls sideways
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
    for (const id of ["how-architecture", "how-trust", "how-aihgle"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await context.close();
  });
}
