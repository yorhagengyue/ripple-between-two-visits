/**
 * The demo side of the owner's must-fix list (C2 follow-up, track E; docs/plan/real-app.md 10 and 12), on the running
 * server: what was fixed for accounts first and was still open in the judge sandbox and the crew's filming session.
 *
 *   1. a reading above the doctor's warning line brings his words at once: 995 first, then R2 with date and time point
 *   2. today's questions and answers stay after a refresh
 *   3. the review: "not right" keeps the sentence and marks it 「他说不对」; an answer can be changed after confirming
 *   4. no microphone: said plainly, no running dot, timer or waveform
 *   5. her page: her recordings can be heard and deleted; this week and today never contradict (Day 42)
 *   6. the director's reminder cue shows the words of the clip the phone plays
 *   7. the brief: readings above the warning line on their own row; in English his words say when they are not translated
 *   8. the judges' page: a rules-only emergency reads 「规则当场判断」; the check drill shows a sentence stopped by a named
 *      check on the backstage (real-app 12 「『某一句被第几道检查拦下』从没出现过」)
 *   9. the filming account's panel: laying out to a scene moves his phone by itself; "Simulate no reply" is greyed with
 *      the reason while the day is already recorded
 *  10. his own record on the demo (real-app 12): today's reading can be corrected and deleted; his question list can be
 *      added to, changed, set aside and put back, the same words twice stay one; the Chinese generic name stands next
 *      to the English medicine name; a recording that ended with nothing says so
 *  11. the judges' page and a slow answer (fix round of 10-11; journey 22 on the real stack): the judge's sentence is on
 *      the phone the moment it is sent, with a waiting line, while the answer takes 10 s; an ask the phone could not
 *      send is said at once on both sides; a test clock another journey left frozen weeks back does not shorten the
 *      judge's copy (its cookies had 60 s to live, and the phone's next ask was refused: what the real run met);
 *      switching the phone's language holds the ask buttons until the reloaded page is on the phone
 *
 * The re-watch copy (a visit that already happened, replayed on a later day) is in e2e/m2-visit.spec.ts; the one crew
 * gate in e2e/m2-fallback.spec.ts; /join's unselected role in e2e/m0-session.spec.ts.
 */
import { expect, request as pwRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { api, BASE_URL, closeAll, CREW_HEADERS, createSession, crewCookie, DEMO_ROOT, joinThroughPageAsCrew, openDevice, waitLive, withCrew } from "./helpers";

const R2 =
  "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const HERO = "今天 150/95，我能不能多吃一粒？";
const DRILL_SENTENCE = "If the reading is high, take one more tablet tonight.";

/**
 * A crew call (the story clock, the director's cue: lib/crew/gate.ts). Only these calls carry the crew's key; every phone
 * and the judges' page in this file are ordinary browsers without the crew's cookie unless a test says so.
 */
async function crewPost(request: APIRequestContext, pathname: string, sessionId: string, data: Record<string, unknown>): Promise<void> {
  const res = await request.post(`${pathname}?session=${sessionId}`, { data, headers: CREW_HEADERS });
  expect(res.ok(), `${pathname}: ${res.status()} ${await res.text()}`).toBeTruthy();
}

function wav(samples = 1600): Buffer {
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16_000, 24);
  buf.writeUInt32LE(32_000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(8000 * Math.sin(i / 6)), 44 + i * 2);
  return buf;
}

/** She saves a recording in this copy (the upload link, the file, the clip), as /f does. Returns the clip's id. */
async function herRecording(request: APIRequestContext, sessionId: string, text?: string): Promise<string> {
  const link = (await (await request.post(`/api/upload-url?session=${sessionId}`, { data: { kind: "reminder", content_type: "audio/wav" } })).json()) as { url: string; method: string; headers: Record<string, string>; path: string };
  const put = await request.fetch(link.url, { method: link.method, headers: link.headers, data: wav() });
  expect(put.status(), "upload").toBe(200);
  const reg = await request.post(`/api/reminders?session=${sessionId}`, { data: text ? { audio_path: link.path, text } : { audio_path: link.path } });
  expect(reg.status(), await reg.text()).toBe(201);
  return ((await reg.json()) as { clip: { id: string } }).clip.id;
}

test("blood pressure: 185/112 brings 995 and the doctor's warning line at once, with its date and time point; 150/95 only says recorded", async ({ browser, request }) => {
  const s = await createSession(request); // Day 29, 8:15pm
  const phone = await openDevice(browser, s.id, "/p/bp");
  const page = phone.page;
  await page.getByTestId("bp-input-top").fill("185");
  await page.getByTestId("bp-input-bottom").fill("112");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-record-note")).toHaveText("记下了。");
  const relay = page.getByTestId("bp-record-relay");
  await expect(relay).toHaveAttribute("data-reading", "185/112");
  await expect(relay).toHaveAttribute("data-threshold", "180");
  // the fixed 995 template first (one tap to dial), then Dr Lim's own words, whole, with the visit date, the time point
  // in the recording (as the visit screen shows it) and the clip
  const lines = relay.getByTestId("relay-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.first().getByTestId("relay-dial")).toHaveAttribute("href", "tel:995");
  await expect(lines.first()).toContainText("995");
  const doctor = lines.nth(1);
  await expect(doctor).toHaveAttribute("data-source", "visit:v1:R2");
  await expect(doctor.getByTestId("relay-text")).toHaveText(R2);
  await expect(doctor.getByTestId("relay-chip")).toHaveText("● 医生说");
  await expect(doctor.getByTestId("relay-detail")).toContainText("2026年8月24日 · 0:53 处 · 代录音");
  await expect(doctor.getByTestId("relay-clip")).toBeVisible();
  // nothing judges the reading
  expect(await relay.innerText()).not.toMatch(/偏高|太高|危险|正常/);
  await expect(page.locator('[data-testid="bp-reading"][data-day="29"]').filter({ hasText: "185/112" })).toHaveCount(1, { timeout: 5000 });

  // a reading that is not above the line: recorded, and the relay of the reading before it is gone
  await page.getByTestId("bp-input-top").fill("150");
  await page.getByTestId("bp-input-bottom").fill("95");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-record-relay")).toHaveCount(0);
  await expect(page.getByTestId("bp-record-note")).toHaveText("记下了。");
  await closeAll([phone]);
});

test("Today keeps today's questions and answers after a refresh, newest first, the older ones folded", async ({ browser, request }) => {
  const s = await createSession(request);
  const phone = await openDevice(browser, s.id, "/p/today");
  const page = phone.page;
  await expect(page.getByTestId("ask-earlier")).toHaveCount(0);
  await page.getByTestId("ask-input").fill(HERO);
  await page.getByTestId("ask-send").click();
  await expect(page.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("ask-earlier")).toHaveCount(0);

  await page.reload();
  await waitLive(page);
  const earlier = page.getByTestId("ask-earlier");
  await expect(earlier).toHaveAttribute("data-count", "1", { timeout: 8000 });
  await expect(earlier).toContainText("今天问过的（1）");
  const first = earlier.getByTestId("ask-earlier-turn").first();
  await expect(first).toHaveAttribute("open", "");
  await expect(first.getByTestId("ask-earlier-summary")).toHaveText(`“${HERO}”`);
  const r4 = first.locator('[data-testid="earlier-line"][data-source="visit:v2:R4"]');
  await expect(r4).toContainText(R4);
  await expect(r4.getByTestId("earlier-chip")).toHaveText("● 医生说");
  // nothing is on screen as "the answer just given" until he asks again
  await expect(page.getByTestId("ask-answer")).toHaveCount(0);

  await page.getByTestId("ask-input").fill("Amlodipine 这个药是做什么的？");
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-asked")).toHaveText("“Amlodipine 这个药是做什么的？”", { timeout: 8000 });
  await expect(page.getByTestId("ask-answer")).toHaveCount(1);
  await expect(earlier).toHaveAttribute("data-count", "1");
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId("ask-earlier")).toHaveAttribute("data-count", "2", { timeout: 8000 });
  await expect(page.getByTestId("ask-earlier-summary").first()).toHaveText("“Amlodipine 这个药是做什么的？”");
  await expect(page.getByTestId("ask-earlier-summary").nth(1)).toHaveText(`“${HERO}”`);
  // the next story day starts empty (the crew's clock)
  await crewPost(request, "/api/clock", s.id, { day: 30, time: "08:00" });
  await expect(page.getByTestId("ask-earlier")).toHaveCount(0, { timeout: 8000 });
  await closeAll([phone]);
});
test("the review: \"not right\" keeps the sentence with 他说不对 and a question; after confirming, an answer can still be changed and says so", async ({ browser, request }) => {
  test.setTimeout(150_000);
  const s = await createSession(request, { story_day: 8, story_time: "10:00" }); // the second visit's own day
  const phone = await openDevice(browser, s.id, "/p/visit?replay=v2&speed=20");
  const page = phone.page;
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 60_000 });
  await page.getByTestId("visit-end").click();
  await page.waitForURL(/\/p\/visit\/v2\/review$/, { timeout: 30_000 });
  const disputeQuestion = "看诊记下的这句，我觉得不对";
  const questionsOf = async () => JSON.stringify(await (await request.get(`/api/questions?session=${s.id}&locale=zh-Hans`)).json());
  expect(await questionsOf()).not.toContain(disputeQuestion);

  // he says R4 is not right, R3 is right, and confirms
  await page.getByTestId("verdict-v2-u08-wrong").click();
  await page.getByTestId("verdict-v2-u06-right").click();
  await page.getByTestId("review-confirm").click();
  await expect(page.getByTestId("review-status")).toHaveText("已确认", { timeout: 10_000 });
  // the sentence is still there, whole, marked; a question about it is on his list
  const r4 = page.getByTestId("card-v2-u08");
  await expect(r4).toHaveAttribute("data-disputed", "true");
  await expect(page.getByTestId("card-v2-u08-quote")).toHaveText(`“${R4}”`);
  await expect(page.getByTestId("card-v2-u08-disputed")).toContainText("他说不对");
  await expect(page.getByTestId("card-v2-u08-disputed")).toContainText("原话照留");
  await expect(page.getByTestId("card-v2-u06")).toHaveAttribute("data-disputed", "false");
  expect(await questionsOf()).toContain(disputeQuestion);

  // confirmed, and still editable: the buttons show what he answered
  await expect(page.getByTestId("review-change-hint")).toHaveText("已确认。下面每一条还可以改，改动会留记录。");
  await expect(page.getByTestId("verdict-v2-u08")).toHaveAttribute("data-verdict", "wrong");
  await expect(page.getByTestId("verdict-v2-u08")).toHaveAttribute("data-editable", "true");
  await expect(page.getByTestId("verdict-v2-u06")).toHaveAttribute("data-verdict", "right");
  // he changes his mind about R4: saved at once, the mark goes, the change is kept and shown
  await page.getByTestId("verdict-v2-u08-right").click();
  await expect(page.getByTestId("verdict-v2-u08")).toHaveAttribute("data-verdict", "right", { timeout: 10_000 });
  await expect(page.getByTestId("card-v2-u08")).toHaveAttribute("data-disputed", "false");
  await expect(page.getByTestId("card-v2-u08-chip")).toContainText("医生说");
  await expect(page.getByTestId("card-v2-u08-changed")).toHaveText("改过 1 次");
  // after a reload it is as he left it
  await page.reload();
  await expect(page.getByTestId("verdict-v2-u08")).toHaveAttribute("data-verdict", "right");
  await expect(page.getByTestId("card-v2-u08-changed")).toHaveText("改过 1 次");
  await closeAll([phone]);
});

test("no microphone: the visit screen says so; no listening dot, no timer, no moving waveform", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 30, story_time: "10:00" }); // a day with no visit of the story
  // this browser has no microphone to give (no fake device, no permission)
  const phone = await openDevice(browser, s.id, "/p/visit");
  const page = phone.page;
  await page.getByTestId("consent-yes").click();
  await expect(page.getByTestId("visit-screen")).toBeVisible({ timeout: 15_000 });
  const timer = page.getByTestId("visit-timer");
  await expect(timer).toHaveAttribute("data-mic", "off", { timeout: 15_000 });
  await expect(timer).toHaveAttribute("data-listening", "false");
  await expect(timer).toHaveText("没有麦克风");
  await expect(page.getByTestId("visit-wave")).toHaveAttribute("data-listening", "false");
  await expect(page.getByTestId("visit-kicker")).toHaveText("看诊 · 没有在录音");
  await expect(page.getByTestId("visit-notice")).toContainText("没有在录音");
  // the waveform's bars do not move
  expect(await page.getByTestId("visit-wave").locator("i").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  // ended with nothing in it: the next screen says that nothing was recorded (not "no transcript yet")
  await page.getByTestId("visit-end").click();
  const nothing = page.getByTestId("review-no-transcript");
  await expect(nothing).toHaveAttribute("data-empty-recording", "true", { timeout: 30_000 });
  await expect(nothing).toContainText("这次没有录到话，不算一次看诊");
  await expect(page.getByTestId("review-confirm")).toHaveCount(0);
  await closeAll([phone]);
});

test("her page: a saved recording can be listened to and deleted; his phone falls back to the stand-in; Day 42 morning the week and today agree", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 42, story_time: "08:30" });
  const first = await herRecording(request, s.id, "爸，记得吃药。");
  const second = await herRecording(request, s.id);
  const her = await openDevice(browser, s.id, "/f");
  const page = her.page;

  // Day 42 is a Monday before 9:45: nothing counted this week yet, and today's tablet is still open
  await expect(page.getByTestId("family-doses-none")).toHaveText("本周到现在还没有记录。");
  await expect(page.getByTestId("family-dose-med-amlodipine")).toHaveAttribute("data-state", "none");
  await expect(page.getByTestId("family-doses")).not.toContainText("还没有要吃的药");

  const mine = page.getByTestId("reminder-mine");
  await expect(mine).toHaveAttribute("data-count", "2", { timeout: 8000 });
  const clips = mine.getByTestId("reminder-mine-clip");
  // newest first; the one his phone plays is marked
  await expect(clips.first()).toHaveAttribute("data-clip", second);
  await expect(clips.first()).toHaveAttribute("data-current", "true");
  await expect(clips.nth(1)).toHaveAttribute("data-clip", first);
  await expect(clips.nth(1)).toContainText("爸，记得吃药。");
  // each has its own sound
  const src = await clips.nth(1).getByTestId("reminder-mine-audio").getAttribute("src");
  expect(src).toContain(`/api/reminders/${first}/audio`);
  const audio = await page.request.get(src!);
  expect([audio.status(), audio.headers()["content-type"]]).toEqual([200, "audio/wav"]);
  await clips.nth(1).getByTestId("reminder-mine-listen").click();

  // 「删掉这段」: the newest goes; the one before it now plays
  await clips.first().getByTestId("reminder-mine-delete").click();
  await expect(mine).toHaveAttribute("data-count", "1", { timeout: 8000 });
  await expect(page.getByTestId("reminder-mine-note")).toHaveAttribute("data-note", "deleted");
  await expect(mine.getByTestId("reminder-mine-clip")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("reminder-recorder-current")).toHaveAttribute("data-current", "hers");
  // the last one too: his phone is back on the labelled stand-in, and she can record again
  await mine.getByTestId("reminder-mine-delete").click();
  await expect(mine.getByTestId("reminder-mine-clip")).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByTestId("reminder-recorder-current")).toHaveAttribute("data-current", "stand_in");
  await expect(page.getByTestId("reminder-rec-start")).toBeVisible();
  const left = ((await (await request.get(`/api/reminders?session=${s.id}`)).json()) as { clips: { id: string; stand_in: boolean }[] }).clips;
  expect(left.map((c) => [c.id, c.stand_in])).toEqual([["clip-wei-ling-1", true]]);
  // the story's own clip is not hers to delete
  expect((await page.request.delete(`/api/demo/reminders/clip-wei-ling-1?session=${s.id}`)).status()).toBe(404);
  await closeAll([her]);
});

test("the director's reminder: the card's words are the words of the clip the phone plays (her newest recording)", async ({ browser, request }) => {
  const s = await createSession(request, { kind: "filming", story_day: 9, story_time: "08:45", crew_key: CREW_HEADERS["x-ripple-crew-key"] });
  // her own phone in the filming session (the crew's request is the director's device: it cannot record her reminder)
  const herApi = await pwRequest.newContext({ baseURL: BASE_URL });
  const joined = await herApi.post("/api/session/join", { data: { code: s.join_code, role: "family" } });
  expect(joined.status(), await joined.text()).toBe(200);
  const clip = await herRecording(herApi, s.id, "爸，今天也要吃药。");
  await herApi.dispose();
  // his phone, joined with the code (her phone is in the session, so a device with no row of its own is nobody there)
  const phone = await joinThroughPageAsCrew(browser, s.join_code, "patient");
  await phone.page.goto("/p/bp");
  await waitLive(phone.page);
  await crewPost(request, "/api/director/cue", s.id, { cue: "reminder" });
  const card = phone.page.getByTestId("reminder-card");
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card).toContainText("爸，今天也要吃药。");
  await expect(card).not.toContainText("早餐吃了吗");
  await expect(phone.page.getByTestId("reminder-cue-audio")).toHaveAttribute("data-clip", clip);
  await closeAll([phone]);
});

test("the brief: a reading above the doctor's warning line has its own row next to his words; in English his words say they are not translated", async ({ browser, request }) => {
  const s = await createSession(request);
  await api(request, "/api/bp", s.id, { systolic: 185, diastolic: 112, day: 27, slot: "evening" });
  const phone = await openDevice(browser, s.id, "/p/brief");
  const page = phone.page;
  const above = page.getByTestId("brief-above");
  await expect(above).toHaveAttribute("data-count", "1");
  await expect(above.getByTestId("brief-above-reading")).toHaveAttribute("data-reading", "185/112");
  await expect(above.getByTestId("brief-above-reading")).toContainText("9月20日");
  await expect(above.getByTestId("brief-above-reading")).toContainText("晚上");
  await expect(above.getByTestId("brief-r2")).toContainText(R2);
  await expect(above.getByTestId("brief-r2")).toContainText("医生说");
  expect(await above.innerText()).not.toMatch(/偏高|太高|危险|高于/);

  // English, as the doctor reads it: his Chinese words are not passed off as translated (offline no model translates)
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.reload();
  await expect(page.getByTestId("brief-above")).toContainText("The doctor's line");
  await expect(page.getByTestId("brief-not-translated").first()).toHaveText(/not translated/);
  await expect(page.getByTestId("brief-english")).toHaveCount(0);
  await closeAll([phone]);
});

test("blood pressure: today's reading is corrected and deleted in place; corrected above the warning line his words come; earlier days have no such buttons", async ({ browser, request }) => {
  const s = await createSession(request); // Day 29, 8:15pm
  const phone = await openDevice(browser, s.id, "/p/bp");
  const page = phone.page;
  const today = page.locator('[data-testid="bp-reading"][data-day="29"]');
  const row = (value: string) => today.filter({ has: page.getByTestId("bp-reading-value").getByText(value, { exact: true }) });
  // a slip of the finger: 115 for 151
  await page.getByTestId("bp-input-top").fill("115");
  await page.getByTestId("bp-input-bottom").fill("88");
  await page.getByTestId("bp-save").click();
  await expect(row("115/88")).toHaveCount(1, { timeout: 8000 });

  await row("115/88").getByTestId("bp-edit").click();
  await expect(page.getByTestId("bp-edit-top")).toHaveValue("115");
  await page.getByTestId("bp-edit-top").fill("151");
  await page.getByTestId("bp-edit-save").click();
  await expect(row("151/88")).toHaveCount(1, { timeout: 8000 });
  await expect(row("115/88")).toHaveCount(0);
  await expect(row("151/88").getByTestId("bp-edit-relay")).toHaveCount(0);

  // corrected to above Dr Lim's warning line: 995 and his own words under the row, as for a new reading
  await row("151/88").getByTestId("bp-edit").click();
  await page.getByTestId("bp-edit-top").fill("185");
  await page.getByTestId("bp-edit-bottom").fill("112");
  await page.getByTestId("bp-edit-save").click();
  await expect(row("185/112")).toHaveCount(1, { timeout: 8000 });
  const relay = row("185/112").getByTestId("bp-edit-relay");
  await expect(relay.getByTestId("relay-line")).toHaveCount(2);
  await expect(relay.getByTestId("relay-line").first().getByTestId("relay-dial")).toHaveAttribute("href", "tel:995");
  await expect(relay.getByTestId("relay-line").nth(1).getByTestId("relay-text")).toHaveText(R2);
  expect(await row("185/112").innerText()).not.toMatch(/偏高|太高|危险|正常/);

  // 删 asks once more, in place; 不改了 leaves it; 删掉 takes it off his readings
  await row("185/112").getByTestId("bp-delete").click();
  await expect(row("185/112")).toContainText("删掉这次读数吗？");
  await page.getByTestId("bp-delete-no").click();
  await expect(row("185/112")).toHaveCount(1);
  await row("185/112").getByTestId("bp-delete").click();
  await page.getByTestId("bp-delete-yes").click();
  await expect(row("185/112")).toHaveCount(0, { timeout: 8000 });

  // an earlier day's reading is his record as it stands
  const earlier = page.locator('[data-testid="bp-reading"]:not([data-day="29"])');
  expect(await earlier.count()).toBeGreaterThan(0);
  await expect(earlier.getByTestId("bp-today-tools")).toHaveCount(0);
  await closeAll([phone]);
});

test("his question list: added in his own words, the same words stay one question, changed, set aside, put back; a story question with a recorded answer has no such buttons", async ({ browser, request }) => {
  const s = await createSession(request);
  const phone = await openDevice(browser, s.id, "/p/questions");
  const page = phone.page;
  const own = (text: string) => page.locator('[data-testid="question"][data-origin="own"]').filter({ has: page.getByTestId("question-text").getByText(text, { exact: true }) });
  const words = "这个药要吃到什么时候？";
  await page.getByTestId("question-add-input").fill(words);
  await page.getByTestId("question-add-save").click();
  await expect(page.getByTestId("question-add-note")).toHaveAttribute("data-note", "q.add.created");
  await expect(own(words)).toHaveCount(1, { timeout: 8000 });
  await expect(page.getByTestId("questions-doctor").locator('[data-testid="question"]').first()).toBeVisible();

  // the same words again: still one question, and the page says so
  await page.getByTestId("question-add-input").fill(words);
  await page.getByTestId("question-add-save").click();
  await expect(page.getByTestId("question-add-note")).toHaveAttribute("data-note", "q.add.merged");
  await expect(page.getByTestId("question-add-note")).toHaveText("问题单里已经有这一条，还是一条。");
  await expect(own(words)).toHaveCount(1);

  // 改一下
  const changedWords = "这个药要吃多久？";
  await own(words).getByTestId("question-edit").click();
  await page.getByTestId("question-edit-input").fill(changedWords);
  await page.getByTestId("question-edit-save").click();
  await expect(own(changedWords)).toHaveCount(1, { timeout: 8000 });
  await expect(own(words)).toHaveCount(0);
  // 不问了, then 放回去
  await own(changedWords).getByTestId("question-skip").click();
  await expect(own(changedWords)).toHaveAttribute("data-status", "skipped", { timeout: 8000 });
  await expect(own(changedWords).getByTestId("question-edit")).toHaveCount(0);
  await own(changedWords).getByTestId("question-reopen").click();
  await expect(own(changedWords)).toHaveAttribute("data-status", "open", { timeout: 8000 });

  // for the pharmacist
  await page.getByTestId("question-add-for-pharmacist").click();
  await page.getByTestId("question-add-input").fill("这两种药能不能一起吃？");
  await page.getByTestId("question-add-save").click();
  await expect(page.getByTestId("questions-pharmacist").locator('[data-testid="question"][data-origin="own"]')).toHaveCount(1, { timeout: 8000 });

  // the story's question whose answer is recorded at the third visit: waiting on Day 29, and not his to rewrite
  const seeded = page.locator('[data-testid="question"][data-question="q-extra-tablet"]');
  await expect(seeded).toHaveAttribute("data-status", "open");
  await expect(seeded.getByTestId("question-actions")).toHaveCount(0);
  await closeAll([phone]);
});

test("medicines: the Chinese generic name stands next to the English name on the list and on the card, in 华语 only", async ({ browser, request }) => {
  const s = await createSession(request);
  const phone = await openDevice(browser, s.id, "/p/meds");
  const page = phone.page;
  await expect(page.getByTestId("med-zh-med-amlodipine")).toHaveText("氨氯地平");
  await expect(page.getByTestId("med-row-med-amlodipine")).toContainText("Amlodipine");
  await page.getByTestId("med-row-med-amlodipine").click();
  await expect(page.getByTestId("med-zh-name")).toHaveText("氨氯地平", { timeout: 15_000 });
  // in English the English name stands alone
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.goto("/p/meds");
  await expect(page.getByTestId("med-row-med-amlodipine")).toBeVisible();
  await expect(page.getByTestId("med-zh-med-amlodipine")).toHaveCount(0);
  await closeAll([phone]);
});

async function judgePage(browser: import("@playwright/test").Browser): Promise<{ page: Page; context: BrowserContext; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  expect((await page.goto(DEMO_ROOT))?.status()).toBe(200);
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  return { page, context, close: () => context.close() };
}

test("/demo: an emergency the rules caught reads 规则当场判断, not a time; the check drill shows a sentence stopped at a named layer", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await judgePage(browser);
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  const feed = page.getByTestId("event-feed");

  // a judge types an emergency: the rules answer alone, at once
  await page.getByTestId("own-question-input").fill("我胸口很痛，喘不过气");
  await page.getByTestId("own-question-send").click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-route", "emergency", { timeout: 10_000 });
  const status = page.getByTestId("hero-status");
  await expect(status).toContainText("规则当场判断");
  await expect(status).not.toContainText(/\d\.\d s/);
  await expect(page.getByTestId("hero-timing")).toHaveAttribute("data-rule-only", "true");

  // the check drill: folded under the own-question box; opened, it says what it plants before the judge presses anything
  await page.getByTestId("drill-summary").click();
  await expect(page.getByTestId("landing-drill")).toContainText(DRILL_SENTENCE);
  await page.getByTestId("drill-button").click();
  await expect(page.getByTestId("drill-status")).toHaveAttribute("data-stopped", "1", { timeout: 15_000 });
  await expect(page.getByTestId("drill-status")).toContainText("Stopped at layer 1");
  // the phone: an ordinary answer with its real lines and the referral line; the planted words are not on it
  await expect(phone.getByTestId("ask-asked")).toHaveText("“Amlodipine 这个药是做什么的？”");
  await expect(phone.getByTestId("answer-line").first()).toBeVisible();
  expect(await phone.getByTestId("ask-box").innerText()).not.toContain("take one more tablet");
  // the backstage: the row of the stopped sentence, its layer, its reason in plain words, and that it was planted
  const stopped = feed.locator('[data-testid="event-row"][data-type="ask.blocked"]').filter({ hasText: "Check drill" });
  await expect(stopped).toHaveCount(1, { timeout: 8000 });
  await expect(stopped).toHaveAttribute("data-tone", "blocked");
  await expect(stopped.getByTestId("event-badge")).toHaveText("Blocked · layer 1 · drill");
  await expect(stopped.getByTestId("event-sentence")).toContainText(`a made-up sentence was added to the answer on purpose, “${DRILL_SENTENCE}”`);
  await expect(stopped.getByTestId("event-sentence")).toContainText("It was stopped at layer 1, because");
  await expect(stopped.getByTestId("event-sentence")).not.toContainText(/span_not_in_source|quote_not_verbatim/);
  // the layer's own count row says one sentence was stopped there
  await expect(feed.locator('[data-testid="event-row"][data-type="verify.layer1"]').filter({ hasText: "1 stopped" })).toHaveCount(1);
  // the hero question afterwards is answered as always (the drill is one ask, not a mode)
  await page.getByTestId("hero-button").click();
  await expect(phone.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]')).toBeVisible({ timeout: 8000 });
  expect(await phone.getByTestId("ask-box").innerText()).not.toContain("take one more tablet");
  await close();
});

/**
 * Fix round of 10-11. Journey 22 on the real stack (hosted database, DeepSeek and its checker) stopped where the judge's
 * own sentence should have been on the phone. What it was: the journey before had left the developer test clock frozen
 * weeks back, the judge's copy was given cookies that lived 60 s, and the phone's ask a minute later was refused (403).
 * What it also showed: the phone drew the sentence only together with its answer, and the judges' page kept saying
 * "Asking on the phone…" for 20 s after the phone had been refused. The four tests below hold each part.
 */
const OWN = "What is amlodipine for?";

test("/demo: the judge's sentence is on the phone the moment it is sent, with a waiting line, while the answer takes 10 s (a slow stand-in for a real model)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await judgePage(browser);
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  // The slow stand-in: the phone's own POST /api/ask is held 10 s on its way (the frame's requests pass the page's
  // routes); the answer itself is the offline model's. A model that slow cannot be stood in for on the server: ask()
  // stops every model call at ASK_DEADLINE_MS (8 s) and composes the answer from the sources itself
  // (tests/unit/safety/ask-deadline.test.ts), so the server never takes that long.
  const HOLD_MS = 10_000;
  let held = 0;
  await page.route("**/api/ask?*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held += 1;
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue();
  });
  await page.getByTestId("own-question-input").fill(OWN);
  const t0 = Date.now();
  await page.getByTestId("own-question-send").click();
  // at once: his sentence on the phone, on its screen, the waiting line under it; no answer yet
  const asked = phone.getByTestId("ask-asked");
  await expect(asked).toHaveText(`“${OWN}”`, { timeout: 2000 });
  await expect(phone.getByTestId("ask-pending")).toHaveText("在找医生说过的话……", { timeout: 2000 });
  expect(Date.now() - t0, "ms from the click to the sentence and the waiting line on the phone").toBeLessThan(2500);
  await expect(asked).toBeInViewport();
  await expect(phone.getByTestId("ask-pending")).toBeInViewport();
  await expect(phone.getByTestId("ask-answer")).toHaveCount(0);
  await expect(phone.getByTestId("ask-send")).toBeDisabled();
  // it stands under the phone's own header, not behind it (it used to), and the judges' page was not scrolled away with
  // the phone's: the whole phone and the button that was pressed are still on screen
  const underHeader = async () => {
    const header = (await phone.locator("header").first().boundingBox())!;
    return (await asked.boundingBox())!.y - (header.y + header.height);
  };
  expect(await underHeader(), "px from the phone's header to the sentence").toBeGreaterThanOrEqual(0);
  await expect(phone.getByTestId("story-day-label")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("own-question-send")).toBeInViewport({ ratio: 1 });
  // the judges' page says it is being asked, and its buttons wait (the phone's language too: a reload would take the answer)
  await expect(page.getByTestId("hero-status")).toHaveText("Asking on the phone… watch the backstage below.");
  await expect(page.getByTestId("own-question-send")).toBeDisabled();
  await expect(page.getByTestId("landing-phone-lang-en")).toBeDisabled();
  // half way through the wait it still says so
  await page.waitForTimeout(5000);
  await expect(phone.getByTestId("ask-pending")).toBeVisible();
  await expect(phone.getByTestId("ask-answer")).toHaveCount(0);
  // then the whole answer takes the waiting line's place, under the same sentence, with a line that names its source
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: HOLD_MS + 8000 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(HOLD_MS);
  await expect(phone.getByTestId("ask-pending")).toHaveCount(0);
  await expect(asked).toHaveText(`“${OWN}”`);
  expect(await underHeader(), "px from the phone's header to the sentence, with its answer").toBeGreaterThanOrEqual(0);
  const line = phone.locator('[data-testid="answer-line"][data-source]').first();
  await expect(line).toBeVisible();
  await expect(line.getByTestId("answer-chip")).toBeVisible();
  await expect(page.getByTestId("landing-phone-lang-en")).toBeEnabled();
  expect(held).toBe(1);
  // the time the judges' page shows is the whole wait; the sentence was on the phone within a second of the click
  const timing = page.getByTestId("hero-timing");
  await expect(timing).toHaveAttribute("data-what", "own");
  expect(Number(await timing.getAttribute("data-ms"))).toBeGreaterThanOrEqual(HOLD_MS);
  const shownMs = await timing.getAttribute("data-shown-ms");
  expect(shownMs, "ms from the click to the sentence on the phone").toMatch(/^\d+$/);
  expect(Number(shownMs)).toBeLessThan(1000);
  await close();
});

test("/demo: an ask the phone could not send is said at once on both sides, his sentence stays, and the next try goes through", async ({ browser }) => {
  test.setTimeout(90_000);
  const { page, close } = await judgePage(browser);
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  // what the real run met: the phone's ask refused with 403 (its copy's cookies had gone)
  await page.route("**/api/ask?*", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "member_required" }) }) : route.continue(),
  );
  await page.getByTestId("own-question-input").fill(OWN);
  await page.getByTestId("own-question-send").click();
  // the judges' page stops waiting as soon as the phone says so (it waited 20 s for an answer that could not come)
  await expect(page.getByTestId("hero-status")).toHaveText("The phone did not answer. Reload the page and try again.", { timeout: 3000 });
  // the phone keeps his sentence, its own line under it; nothing is drawn as an answer
  await expect(phone.getByTestId("ask-asked")).toHaveText(`“${OWN}”`);
  await expect(phone.getByTestId("ask-error")).toHaveText("没发出去，再试一次。");
  await expect(phone.getByTestId("ask-error")).toBeInViewport();
  await expect(phone.getByTestId("ask-pending")).toHaveCount(0);
  await expect(phone.getByTestId("ask-answer")).toHaveCount(0);
  // the same sentence again, let through this time: answered, and the error line is gone
  await page.unroute("**/api/ask?*");
  await expect(page.getByTestId("own-question-input")).toHaveValue(OWN);
  await page.getByTestId("own-question-send").click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 10_000 });
  await expect(phone.getByTestId("ask-asked")).toHaveText(`“${OWN}”`);
  await expect(phone.getByTestId("ask-error")).toHaveCount(0);
  await expect(page.getByTestId("hero-status")).toContainText("The whole answer was on the phone");
  await close();
});

test("/demo: a test clock another journey left frozen weeks back does not shorten the judge's copy: its cookies last as long as the copy", async ({ browser, request }) => {
  test.setTimeout(90_000);
  // journey 06 sets the developer test clock to 2026-09-01 10:30 (Singapore) and leaves it; journey 22 ran next
  const set = await request.post("/api/dev/clock", { data: { at: "2026-09-01T10:30:00+08:00", frozen: true } });
  test.skip(set.status() === 404, "the developer tools are off on this server");
  expect(set.status(), await set.text()).toBe(200);
  try {
    const { page, context, close } = await judgePage(browser);
    const cookies = await context.cookies();
    for (const name of ["rp_session", "rp_member", "rp_role"]) {
      const cookie = cookies.find((c) => c.name === name);
      expect(cookie, name).toBeTruthy();
      // the copy is kept 48 h on the app's clock; its cookies were given 60 s (a date made on the test clock, measured
      // against the machine's)
      expect(cookie!.expires * 1000 - Date.now(), `${name}: ms left`).toBeGreaterThan(47 * 3_600_000);
    }
    // and the phone answers as on any other day
    const phone = page.frameLocator('[data-testid="landing-phone"]');
    await page.getByTestId("own-question-input").fill(OWN);
    await page.getByTestId("own-question-send").click();
    await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 10_000 });
    await expect(phone.getByTestId("ask-asked")).toHaveText(`“${OWN}”`);
    await close();
  } finally {
    expect((await request.post("/api/dev/clock", { data: { clear: true } })).status()).toBe(200);
  }
});

test("/demo: switching the phone's language holds the ask buttons until the reloaded page is on the phone; a sentence sent right then is asked there", async ({ browser }) => {
  test.setTimeout(90_000);
  const { page, close } = await judgePage(browser);
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  // the phone's page takes a moment to come back, as it does from a database 80 ms away (1.3 s in the real run)
  await page.route("**/p/today", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByTestId("own-question-input").fill(OWN);
  await page.getByTestId("landing-phone-lang-en").click();
  // the page that is about to go away is not a phone to ask on: the buttons wait (a sentence typed into it was lost
  // with it, and the judges' page waited 20 s for its answer)
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "false", { timeout: 1000 });
  await expect(page.getByTestId("own-question-send")).toBeDisabled();
  // pressed as soon as it can be: asked on the reloaded page, in English
  await page.getByTestId("own-question-send").click();
  await expect(phone.locator(".rp-patient").first()).toHaveAttribute("lang", "en");
  await expect(phone.getByTestId("ask-asked")).toHaveText(`“${OWN}”`, { timeout: 5000 });
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 10_000 });
  await expect(page.getByTestId("hero-status")).toContainText("The whole answer was on the phone");
  await close();
});

test("the filming account's panel: laying out to a scene moves his phone to that scene's page by itself; Simulate no reply is greyed with the reason", async ({ browser }) => {
  test.setTimeout(120_000);
  // his phone: a real account, the crew's cookie, marked as a filming account
  const his = await withCrew(await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" }));
  const phone = await his.newPage();
  const made = await phone.request.post("/api/dev/accounts", { data: { login: `e${Math.random().toString(36).slice(2, 12)}`, password: "a long test password", space: "example", display_name: "陈先生" } });
  expect(made.status(), await made.text()).toBe(201);
  expect((await phone.request.post("/api/crew/filming-account")).status()).toBe(200);
  const ref = ((await (await phone.request.get("/api/crew/filming-account")).json()) as { ref: string }).ref;
  await phone.goto("/p/bp");
  await expect(phone.locator('[data-live="open"]')).toHaveCount(1, { timeout: 15_000 });

  // the director's laptop
  const crew = await withCrew(await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } }));
  const director = await crew.newPage();
  await director.goto("/director");
  const card = director.getByTestId(`filming-account-${ref}`);
  await expect(card).toBeVisible({ timeout: 15_000 });

  // lay it out to the first visit: his phone, sitting on the blood pressure page, opens the visit page by itself
  await card.getByTestId("filming-scene-d0-visit").click();
  await expect(card.getByTestId("filming-status")).toContainText("His phone opens that scene's page by itself.", { timeout: 15_000 });
  await expect(phone).toHaveURL(/\/p\/visit$/, { timeout: 15_000 });
  // nothing is due on Day 0: the button says why it cannot be pressed
  await expect(card.getByTestId("filming-no-reply")).toBeDisabled();
  await expect(card.getByTestId("filming-no-reply-why")).toHaveText("No tablet is due on this day, so there is nothing to leave unanswered.");

  // Day 29, 8:15pm: his phone goes to Today; this morning's tablet is recorded, so "no reply" is greyed with the reason
  await card.getByTestId("filming-scene-d29-hero").click();
  await expect(phone).toHaveURL(/\/p\/today$/, { timeout: 15_000 });
  await expect(card.getByTestId("filming-no-reply")).toBeDisabled();
  await expect(card.getByTestId("filming-no-reply-why")).toHaveText("This day is already recorded: Amlodipine taken.");

  // the next morning before he answers it can be pressed; once pressed it is greyed again, with what was recorded
  await card.getByTestId("filming-forward-time").fill("08:44");
  await card.getByTestId("filming-forward-go").click();
  await expect(card.getByTestId("filming-no-reply")).toBeEnabled({ timeout: 15_000 });
  await card.getByTestId("filming-no-reply").click();
  await expect(card.getByTestId("filming-no-reply")).toBeDisabled({ timeout: 15_000 });
  await expect(card.getByTestId("filming-no-reply-why")).toHaveText("This day is already recorded: Amlodipine no reply.");

  await card.getByTestId("filming-end").click();
  await crew.close();
  await his.close();
});

test("the crew's cookie alone is the gate: every crew-only route is 404 without it, a wrong key in a header gets the same 404; only the door says wrong key", async ({ browser, request }) => {
  void request;
  // a judge's own browser: its own sandbox, its own device row, no crew cookie and no crew header
  const outsider = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: {} });
  const made = await outsider.request.post("/api/session", { data: { kind: "sandbox", role: "judge" } });
  expect(made.status()).toBe(201);
  const s = ((await made.json()) as { session: { id: string } }).session;
  const wrong = { "x-ripple-crew-key": "not-the-key" };
  for (const [method, path, data] of [
    ["POST", `/api/clock?session=${s.id}`, { day: 30 }],
    ["POST", `/api/director/cue?session=${s.id}`, { cue: "reminder" }],
    ["POST", `/api/director/filming?session=${s.id}`, { on: true }],
    ["POST", `/api/director/replay?session=${s.id}`, { action: "stop" }],
    ["POST", `/api/session/reset?session=${s.id}`, {}],
    ["POST", `/api/visits/v1/scripted?session=${s.id}`, { on: true }],
    ["GET", "/api/crew/filming-account/accounts", null],
  ] as const) {
    const res = await outsider.request.fetch(path, { method, ...(data ? { data } : {}) });
    expect([res.status(), ((await res.json()) as { error?: string }).error], `${method} ${path}`).toEqual([404, "not_found"]);
  }
  // a guessed key: the same 404, never "wrong key" (one route here: every wrong key typed from this machine counts
  // towards the one lockout, 10 in 10 minutes, and other specs type the right key after this one; the whole matrix,
  // route by route, is tests/unit/crew/gate.test.ts and tests/unit/subject/account-fence.test.ts)
  const guessed = await outsider.request.post(`/api/clock?session=${s.id}`, { data: { day: 30 }, headers: wrong });
  expect([guessed.status(), ((await guessed.json()) as { error?: string }).error]).toEqual([404, "not_found"]);
  // the sign-in door is the one place that says the key is wrong
  const door = await outsider.request.post("/api/session/crew", { data: { key: "not-the-key" } });
  expect([door.status(), ((await door.json()) as { error?: string }).error]).toEqual([403, "crew_key_wrong"]);
  expect(crewCookie().value).toMatch(/^[0-9a-f]{64}$/);
  await outsider.close();
});
