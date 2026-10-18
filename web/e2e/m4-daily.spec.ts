/**
 * M4 acceptance on the phone (docs/plan/tasks/M4-daily.md), mock providers, no keys:
 *   1. hero on /p/today (seed D29 evening): tap to full answer <= 4 s; R4 word for word (医生说) with its stand-in
 *      clip (代录音) that plays, the label's own words, the question already on today's list, ask.blocked backstage;
 *   2. 「我今天好累」: a note; 「吃了吗」 only while today's dose has no answer; never a cause;
 *   3. the dose check-in: 没吃 -> reason chips (打太极 on a tai chi day) or his own words; Undo bar >= 10 s, no
 *      dialog; 等下 is unconfirmed; the window closing with no answer -> unconfirmed (no reply);
 *   4. the tai chi pattern: exactly one question, pattern words only;
 *   5. blood pressure: no comparison line before R1; from D1 the readings next to R1 with its date and time point;
 *      no judgement word on the page in either language.
 */
import { expect, test, type Page } from "@playwright/test";
import { api, BASE_URL, closeAll, CREW_HEADERS, createSession, openCrewDevice, openDevice, textBelow, waitLive } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and the backstage are the film crew's; this file's request fixture carries the key
test.use({ extraHTTPHeaders: CREW_HEADERS });

const MED = "med-amlodipine";
const R1 = "At home, we want it below 135 over 85.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const HERO_ZH = "今天 150/95，我能不能多吃一粒？";
const HERO_EN = "Today 150/95, can I take one more tablet?";
const ADVICE = ["换", "改到", "建议", "move", "switch", "should", "try"];
const JUDGE = ["偏高", "正常", "high", "normal", "good"];

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  // compile every route the timed flows use once (next dev compiles on first request)
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/p/today", "/p/bp", "/p/questions", "/p/meds/med-amlodipine", "/f", "/backstage"]) await request.get(p, { headers: cookie });
  await api(request, "/api/ask", s.id, { text: HERO_ZH, locale: "zh-Hans" });
  await request.get(`/api/family/alerts?session=${s.id}`);
  await request.get(`/api/reminders?session=${s.id}`);
  await request.get(`/api/visits/v2/clip?u=v2-u08&session=${s.id}`);
});

async function ask(page: Page, text: string): Promise<number> {
  await page.getByTestId("ask-input").fill(text);
  const t0 = Date.now();
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 4000 });
  return Date.now() - t0;
}

test("hero on /p/today: tap to full answer within 4 s; R4 with its playable stand-in clip, the label, one question, ask.blocked", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await openDevice(browser, s.id, "/p/today");
  const desk = await openCrewDevice(browser, s.id, "/backstage");
  const page = phone.page;

  // tap -> the whole answer on screen (R4, the label, the referral, the question note)
  const ms = await ask(page, HERO_ZH);
  const r4 = page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await expect(r4).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId("ask-question-added")).toBeVisible({ timeout: 4000 });
  expect(ms).toBeLessThan(4000);
  const inPage = await page.evaluate(() => (window.__rpAsk && window.__rpAsk.answeredAt !== null ? window.__rpAsk.answeredAt - window.__rpAsk.sentAt : null));
  expect(inPage).not.toBeNull();
  expect(inPage!).toBeLessThan(4000);
  test.info().annotations.push({ type: "hero_tap_to_answer_ms", description: `${ms} (in page ${Math.round(inPage!)})` });

  // R4: the doctor's own words, 医生说, date and time point, 代录音, and the clip plays
  await expect(r4.getByTestId("answer-text")).toHaveText(R4);
  await expect(r4.getByTestId("answer-chip")).toHaveText("● 医生说");
  await expect(r4.getByTestId("answer-detail")).toHaveText("2026年9月1日 · 0:43 处 · 代录音");
  const clip = r4.getByTestId("answer-clip");
  await expect(clip).toContainText("代录音");
  const url = await clip.getAttribute("data-src");
  expect(url).toBe(`/api/visits/v2/clip?u=v2-u08&session=${s.id}`);
  const served = await request.get(url!);
  expect(served.status()).toBe(200);
  expect(served.headers()["x-ripple-stand-in"]).toBe("1");
  await clip.click();
  await expect.poll(async () => page.evaluate(() => (window.__rpDailyClipPlays ?? []).some((p) => p.url.includes("v2-u08") && p.playing)), { timeout: 10_000 }).toBe(true);

  // the label's own words under its Mandarin template; the referral; no dose advice; no 180
  const label = page.locator('[data-testid="answer-line"][data-source="label:med-amlodipine"]');
  await expect(label.getByTestId("answer-chip")).toHaveText("● 药品标签");
  await expect(label.getByTestId("answer-label-original")).toHaveText("药袋原文：Take ONE tablet every MORNING");
  const answer = page.getByTestId("ask-answer");
  for (const w of ["可以多吃", "180", "没关系", "不要紧"]) await expect(answer).not.toContainText(w);
  await expect(page.locator('[data-testid="answer-line"]')).toHaveCount(3);

  // exactly one question: the seeded q-extra-tablet of D29 is reused
  await expect(page.getByTestId("ask-question-added")).toHaveAttribute("data-question", "q-extra-tablet");
  await expect(page.getByTestId("ask-question-added")).toHaveAttribute("data-reused", "true");
  // backstage shows the refused request
  await expect(desk.page.locator('[data-testid="event-row"][data-type="ask.blocked"]')).toHaveCount(1, { timeout: 2000 });

  expect(await textBelow(page, 18)).toEqual([]);

  // wave B: the reused seeded question now shows his own words; the seed's wording is labelled a recorded summary
  await page.goto("/p/questions");
  const seeded = page.locator('[data-testid="question"][data-question="q-extra-tablet"]');
  await expect(seeded).toHaveAttribute("data-wording", "own_words");
  await expect(seeded.getByTestId("question-text")).toHaveText(HERO_ZH);
  await expect(seeded.getByTestId("question-summary")).toContainText("记录的摘要：读数高的时候（例如 150/95）可以多吃一粒吗？");
  await closeAll([phone, desk]);
});

test("hero in English: Doctor said, stand-in recording, the label's words; still one question", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([
    { name: "rp_session", value: s.id, url: BASE_URL },
    { name: "rp_lang", value: "en", url: BASE_URL },
  ]);
  const page = await context.newPage();
  await page.goto("/p/today");
  await waitLive(page);
  expect(await ask(page, HERO_EN)).toBeLessThan(4000);
  const r4 = page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await expect(r4.getByTestId("answer-chip")).toHaveText("● Doctor said");
  await expect(r4.getByTestId("answer-text")).toHaveText(R4);
  await expect(r4.getByTestId("answer-clip")).toContainText("stand-in recording");
  await expect(page.locator('[data-testid="answer-line"][data-source="label:med-amlodipine"] [data-testid="answer-text"]')).toHaveText("Take ONE tablet every MORNING");
  await expect(page.getByTestId("ask-question-added")).toHaveAttribute("data-question", "q-extra-tablet");
  await context.close();
});

test("我今天好累: a note; 吃了吗 only while today's dose has no answer; never a cause", async ({ browser, request }) => {
  // D29 evening: the morning tablet is recorded (seed: taken)
  const answered = await createSession(request, { story_day: 29, story_time: "20:15" });
  const a = await openDevice(browser, answered.id, "/p/today");
  await ask(a.page, "我今天好累");
  const outA = a.page.getByTestId("ask-answer");
  await expect(outA).toContainText("已记录");
  await expect(outA).not.toContainText("吃了吗");
  // wave B: offline (mock) no crisis screen looked at the note, so the fixed safety line follows it
  await expect(outA).toContainText("如果突然很不舒服，或者觉得可能会伤害自己，请打 995，或者去最近的急诊。");
  // D42 morning: nothing recorded yet
  const open = await createSession(request, { story_day: 42, story_time: "08:00" });
  const b = await openDevice(browser, open.id, "/p/today");
  await ask(b.page, "我今天好累");
  const outB = b.page.getByTestId("ask-answer");
  await expect(outB).toContainText("记下了");
  await expect(outB).toContainText("今天的药吃了吗？");
  for (const out of [outA, outB]) for (const w of ["因为", "副作用", "because", "side effect"]) await expect(out).not.toContainText(w);
  const notes = (await (await request.get(`/api/notes?session=${open.id}`)).json()).notes as { day: number; text: string }[];
  expect(notes.filter((n) => n.day === 42).map((n) => n.text)).toEqual(["我今天好累"]);
  await closeAll([a, b]);
});

test("dose check-in: 没吃 asks why (chips + own words), Undo bar stays >= 10 s, no dialog; 等下 is unconfirmed", async ({ browser, request }) => {
  test.setTimeout(90_000);
  // D43 is a Tuesday (tai chi): amlodipine and the new losartan are due, nothing recorded yet
  const s = await createSession(request, { story_day: 43, story_time: "08:50" });
  const phone = await openDevice(browser, s.id, "/p/today");
  const page = phone.page;
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  await expect(page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "none");

  await page.getByTestId(`dose-btn-${MED}-missed`).click();
  const t0 = Date.now();
  await expect(page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "missed");
  const panel = page.getByTestId(`dose-reason-${MED}`);
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("dose-reason-chip-tai_chi_morning")).toHaveText("打太极");
  for (const code of ["forgot", "away", "not_with_me"]) await expect(panel.getByTestId(`dose-reason-chip-${code}`)).toBeVisible();
  await expect(panel.getByTestId("dose-reason-input")).toBeVisible();
  await expect(page.getByTestId("undo-bar")).toContainText("未服药撤销");
  await panel.getByTestId("dose-reason-chip-tai_chi_morning").click();
  await expect(page.getByTestId(`dose-reason-shown-${MED}`)).toHaveText("原因：打太极");
  const logged = (await (await request.get(`/api/doses?session=${s.id}&from=43&to=43&medication_id=${MED}`)).json()).doses;
  expect(logged[0]).toMatchObject({ state: "missed", reason: "tai_chi_morning", reason_text: "打太极" });
  expect(await textBelow(page, 18)).toEqual([]);

  // the undo bar does not leave before 10 s
  await page.waitForTimeout(Math.max(0, 9_600 - (Date.now() - t0)));
  await expect(page.getByTestId("undo-bar")).toBeVisible();
  await expect(page.getByTestId("undo-bar")).toBeHidden({ timeout: 6_000 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(10_000);

  // 吃了 then Undo: back to 没吃 with his reason
  await page.getByTestId(`dose-btn-${MED}-taken`).click();
  await expect(page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "taken");
  await page.getByTestId("undo-btn").click();
  await expect(page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "missed");
  await expect(page.getByTestId(`dose-reason-shown-${MED}`)).toHaveText("原因：打太极");

  // his own words for the other medicine; 等下 then Undo goes back to "not recorded yet"
  await page.getByTestId("dose-btn-med-losartan-missed").click();
  await page.getByTestId(`dose-reason-med-losartan`).getByTestId("dose-reason-input").fill("早上去看朋友");
  await page.getByTestId(`dose-reason-med-losartan`).getByTestId("dose-reason-save").click();
  await expect(page.getByTestId("dose-reason-shown-med-losartan")).toHaveText("原因：早上去看朋友");
  await page.getByTestId("dose-btn-med-losartan-later").click();
  await expect(page.getByTestId("dose-state-med-losartan")).toHaveAttribute("data-state", "unconfirmed");
  await expect(page.getByTestId("dose-state-med-losartan")).toHaveText("稍后服用（尚未确认）");
  await page.getByTestId("undo-btn").click();
  await expect(page.getByTestId("dose-state-med-losartan")).toHaveAttribute("data-state", "missed");
  expect(dialogs).toBe(0);
  await closeAll([phone]);
});

test("no answer when the reminder window closes: unconfirmed, no reply after two reminders", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 42, story_time: "09:00" });
  const phone = await openDevice(browser, s.id, "/p/today");
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "none");
  await api(request, "/api/clock", s.id, { day: 42, time: "09:50" });
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveAttribute("data-state", "unconfirmed", { timeout: 5000 });
  await expect(phone.page.getByTestId(`dose-state-${MED}`)).toHaveText("两次提醒均未回应（未确认）");
  await closeAll([phone]);
});

test("the tai chi pattern: exactly one question, the pattern only (zh and en)", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29 });
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
  const page = await context.newPage();
  for (const lang of ["zh-Hans", "en"]) {
    await context.addCookies([{ name: "rp_lang", value: lang, url: BASE_URL }]);
    await page.goto("/p/questions");
    await waitLive(page);
    const pattern = page.locator('[data-testid="question"][data-origin="pattern"]');
    await expect(pattern).toHaveCount(1);
    const text = (await pattern.getByTestId("question-text").textContent()) ?? "";
    expect(text).toContain(lang === "en" ? "tai chi" : "打太极");
    for (const w of ADVICE) expect(text.toLowerCase(), w).not.toContain(w);
    // story-day gating: q-knee-2 (D30) is not there yet, q-extra-tablet (D29) is
    await expect(page.locator('[data-question="q-knee-2"]')).toHaveCount(0);
    await expect(page.locator('[data-question="q-extra-tablet"]')).toHaveCount(1);
    expect(await textBelow(page, 18)).toEqual([]);
  }
  await context.close();
});

test("blood pressure: no comparison line on D0; from D1 R1 word for word with date and time; no judgement words", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 0, story_time: "09:30" });
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
  const page = await context.newPage();
  const scan = async () => {
    const body = (await page.locator("main, body").first().innerText()).toLowerCase();
    for (const w of JUDGE) expect(body, `"${w}" on /p/bp`).not.toContain(w);
  };

  await page.goto("/p/bp");
  await waitLive(page);
  await expect(page.getByTestId("page-bp")).toHaveAttribute("data-target", "none");
  await expect(page.getByTestId("bp-target")).toHaveCount(0);
  await expect(page.getByTestId("bp-ref-line")).toHaveCount(0);
  await expect(page.getByTestId("bp-only-record")).toBeVisible();
  await scan();

  await api(request, "/api/clock", s.id, { day: 1, time: "07:40" });
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId("bp-target")).toBeVisible();
  await expect(page.getByTestId("bp-target")).toContainText(R1);
  await expect(page.getByTestId("bp-target")).toContainText("Doctor said");
  await expect(page.getByTestId("bp-target")).toContainText("24 Aug 2026 · at 0:49 · stand-in recording");
  await expect(page.getByTestId("bp-chart")).toHaveAttribute("data-ref", "135/85");
  await expect(page.getByTestId("bp-ref-line")).toHaveCount(2);
  await expect(page.getByTestId("bp-reading")).toHaveCount(2);
  await scan();
  expect(await textBelow(page, 18)).toEqual([]);

  // D29: readings up to the story day, the reading that was not taken shows 未确认; record one more
  await api(request, "/api/clock", s.id, { day: 29, time: "20:15" });
  await page.reload();
  await waitLive(page);
  await expect(page.locator('[data-testid="bp-reading"][data-day="3"][data-state="unconfirmed"]')).toContainText("Not confirmed");
  expect(await page.locator('[data-testid="bp-reading"]').evaluateAll((els) => els.every((e) => Number(e.getAttribute("data-day")) <= 29))).toBe(true);
  await page.getByTestId("bp-input-top").fill("150");
  await page.getByTestId("bp-input-bottom").fill("95");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-record-note")).toHaveText("Recorded");
  await expect(page.locator('[data-testid="bp-reading"][data-day="29"]')).toHaveCount(2, { timeout: 5000 });
  await scan();

  // English
  await context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId("bp-target")).toContainText("Doctor said");
  await expect(page.getByTestId("bp-target")).toContainText("24 Aug 2026 · at 0:49 · stand-in recording");
  await scan();
  await context.close();
});
