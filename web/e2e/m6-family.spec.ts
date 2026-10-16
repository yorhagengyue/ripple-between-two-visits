/**
 * M6 on the devices (docs/plan/tasks/M6-family.md and this round's literal requirements):
 *   - /f shows only what Mr Tan granted, with the seed's defaults (this week's medicine days, readings count,
 *     questions waiting; transcripts and notes off);
 *   - his 「家人能看到什么」 page (/p/family) changes a switch and an open /f follows within 1 s (measured, both ways;
 *     this is the in-memory store; under STORE=supabase the limit is 2 s this wave, e2e/m6-supa-sync.spec.ts);
 *   - Wei Ling (family role) gets 403 from the grants API, POST /api/doses, answering / confirming questions and
 *     confirming medicines; /f has no such buttons;
 *   - with visit_transcripts off, /f holds none of R1-R4 and no visit line (text scan in zh and en);
 *   - she records her reminder on /f with the WAV recorder (no WebM), it is stored through the signed upload and
 *     POST /api/reminders, and at the next reminder time his phone plays HER clip, labelled 女儿的录音, on any /p/ page;
 *   - "no reply after two reminders": both the ON and the OFF state, set through his switch.
 * Fixer round 1 (the independent verification's findings in these paths):
 *   - her phone opening his brief (/p/brief) or his switch page (/p/family) lands on /f; the redirect answer itself
 *     carries none of his notes, readings or R1 (defect 1, the part in these paths);
 *   - the reminder strip plays her clip on /p/meds/[id], /p/meds/add, /p/visit and /p/visit/[id]/review too;
 *   - /f says when a refetch fails and recovers by itself; the switch page says when it cannot read the switches
 *     after a reset; her recorder keeps the recording when saving fails, so she saves again (defect 4);
 *   - "Not taken: 1 day" in English (defect 6);
 *   - Ripple's own words on /f (zh, en, every switch on) hold no judgement word; the one exemption is the heading
 *     爸爸允许你看的 (允许 is about sharing, not a clinical permission) (note 8).
 * His phone joins with the session's code as "patient" (member row + cookies), the way it does on the shoot: once
 * Wei Ling has joined, a device with no row in his session is nobody (lib/family/identity.ts), and only a device with
 * his row (or the judge's own sandbox row, which `request` holds after createSession) changes the switches.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { judgementHits } from "../lib/safety/judgement";
import { api, BASE_URL, closeAll, CREW_HEADERS, createSession, textBelow, waitLive, type Device } from "./helpers";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
  // C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the key
  extraHTTPHeaders: CREW_HEADERS,
});

const MED = "med-amlodipine";
const FIXTURES = path.join(__dirname, "..", "fixtures");
const NOTE_D20 = "我今天好累。";
const NOTE_D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const R1 = "At home, we want it below 135 over 85.";

/** Everything said at a visit in the story: R1-R4, every replay transcript line, every recorded answer. */
function visitTexts(): string[] {
  const seed = JSON.parse(readFileSync(path.join(FIXTURES, "timeline.seed.json"), "utf8")) as {
    required_doctor_lines: { text: string }[];
    questions: { answer?: { text: string } }[];
  };
  const out = [...seed.required_doctor_lines.map((r) => r.text), ...seed.questions.flatMap((q) => (q.answer ? [q.answer.text] : []))];
  for (const v of ["v1", "v2", "p1", "v3"]) {
    const f = JSON.parse(readFileSync(path.join(FIXTURES, "visits", `${v}.utterances.json`), "utf8")) as { utterances: { text: string }[] };
    out.push(...f.utterances.map((u) => u.text));
  }
  return [...new Set(out)];
}

/** Wei Ling's phone: joined with the session's code as "family" (member row + cookies), opened on /f. */
async function joinAsFamily(browser: Browser, code: string): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const res = await context.request.post("/api/session/join", { data: { code, role: "family" } });
  expect(res.status(), await res.text()).toBe(200);
  const page = await context.newPage();
  await page.goto("/f");
  await waitLive(page);
  return { context, page };
}

/** Mr Tan's phone: joined with the session's code as "patient" (member row + cookies), opened on `pathname`. */
async function joinAsHim(browser: Browser, code: string, pathname: string): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const res = await context.request.post("/api/session/join", { data: { code, role: "patient" } });
  expect(res.status(), await res.text()).toBe(200);
  const page = await context.newPage();
  await page.goto(pathname);
  await waitLive(page);
  return { context, page };
}

async function grant(request: APIRequestContext, sid: string, items: Record<string, boolean>) {
  await api(request, "/api/family/grants", sid, { items });
}

/** Click his switch and time how long until /f shows the result (ms). */
async function flip(phone: Page, family: Page, key: string, check: () => Promise<void>): Promise<number> {
  const sw = phone.getByTestId(`grant-${key}`);
  const before = await sw.getAttribute("data-on");
  const t0 = Date.now();
  await sw.click();
  await check();
  const ms = Date.now() - t0;
  await expect(sw).toHaveAttribute("data-on", before === "true" ? "false" : "true");
  return ms;
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  // next dev compiles each route on first use: warm up everything the timed checks touch
  const s = await createSession(request, { story_day: 29 });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/p/family", "/f", "/p/today", "/p/bp", "/p/meds", "/p/brief"]) await request.get(p, { headers: cookie });
  for (const p of ["/api/family/view", "/api/family/grants", "/api/family/alerts", "/api/reminders"]) await request.get(`${p}?session=${s.id}`);
  await grant(request, s.id, { notes: true });
  await grant(request, s.id, { notes: false });
  await api(request, "/api/upload-url", s.id, { kind: "reminder", content_type: "audio/wav" });
  await api(request, "/api/clock", s.id, { day: 29, time: "08:45" });
});

test("/f shows only what he granted, with the seed's defaults; no buttons that act for him", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29 });
  const family = await joinAsFamily(browser, s.join_code);
  const page = family.page;
  const doses = page.getByTestId("family-doses");
  await expect(doses).toHaveAttribute("data-days-taken", "2"); // Mon 21 Sep and Tue 22 Sep
  await expect(doses).toHaveAttribute("data-days-due", "2");
  await expect(doses).toContainText("2 天里有 2 天吃了药");
  await expect(page.getByTestId(`family-dose-${MED}`)).toHaveAttribute("data-state", "taken");
  await expect(page.getByTestId("family-bp")).toContainText("本周量了 2 次");
  await expect(page.getByTestId("family-questions")).toContainText("有 2 个问题等下次看诊问");
  await expect(page.getByTestId("family-visits")).toHaveCount(0);
  await expect(page.getByTestId("family-notes")).toHaveCount(0);
  await expect(page.getByTestId("family-allowed-visit_transcripts")).toHaveAttribute("data-on", "false");
  await expect(page.getByTestId("family-allowed-notes")).toHaveAttribute("data-on", "false");
  // she can look, not act
  await expect(page.getByRole("button", { name: /吃了|没吃|等下|确认|就是这句|拍药袋|Taken|Confirm/ })).toHaveCount(0);
  await expect(page.locator("[data-testid^='dose-btn'], [data-testid^='reminder-btn'], [data-testid^='grant-']")).toHaveCount(0);
  expect(await textBelow(page, 18)).toEqual([]);
  await closeAll([family]);
});

test("a switch on his phone reaches an open /f within 1 s, both ways (measured)", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 29 });
  const phone = await joinAsHim(browser, s.join_code, "/p/family");
  const family = await joinAsFamily(browser, s.join_code);
  await expect(phone.page.getByTestId("grant-dose_summary")).toHaveAttribute("data-on", "true");
  expect(await textBelow(phone.page, 18)).toEqual([]);

  const times: Record<string, number> = {};
  times.dose_off = await flip(phone.page, family.page, "dose_summary", () => expect(family.page.getByTestId("family-doses")).toHaveCount(0, { timeout: 1000 }));
  times.dose_on = await flip(phone.page, family.page, "dose_summary", () => expect(family.page.getByTestId("family-doses")).toBeVisible({ timeout: 1000 }));
  times.notes_on = await flip(phone.page, family.page, "notes", () => expect(family.page.getByTestId("family-notes")).toContainText("我今天好累。", { timeout: 1000 }));
  times.notes_off = await flip(phone.page, family.page, "notes", () => expect(family.page.getByTestId("family-notes")).toHaveCount(0, { timeout: 1000 }));
  times.bp_off = await flip(phone.page, family.page, "bp_summary", () => expect(family.page.getByTestId("family-bp")).toHaveCount(0, { timeout: 1000 }));
  times.questions_off = await flip(phone.page, family.page, "questions_count", () => expect(family.page.getByTestId("family-questions")).toHaveCount(0, { timeout: 1000 }));
  times.transcripts_on = await flip(phone.page, family.page, "visit_transcripts", () =>
    expect(family.page.getByTestId("family-visits")).toContainText("At home, we want it below 135 over 85.", { timeout: 1000 }),
  );
  for (const [what, ms] of Object.entries(times)) expect(ms, `${what}: ${ms} ms`).toBeLessThan(1000);
  console.log(`[m6] switch -> /f: ${JSON.stringify(times)}`);
  // the switches survive a reload on both phones
  await phone.page.reload();
  await expect(phone.page.getByTestId("grant-bp_summary")).toHaveAttribute("data-on", "false");
  await family.page.reload();
  await expect(family.page.getByTestId("family-bp")).toHaveCount(0);
  await expect(family.page.getByTestId("family-visits")).toBeVisible();
  // 英文界面 of the switch page, still 18px
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await phone.page.reload();
  await expect(phone.page.getByRole("heading", { name: "What my family can see" })).toBeVisible();
  expect(await textBelow(phone.page, 18)).toEqual([]);
  await closeAll([phone, family]);
});

test("Wei Ling gets 403 from the grants API, doses, answering / confirming questions and confirming medicines", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29 });
  const family = await joinAsFamily(browser, s.join_code);
  const r = family.context.request;
  const sid = `session=${s.id}`;
  const calls: [string, string, Record<string, unknown>][] = [
    ["grants", `/api/family/grants?${sid}`, { items: { visit_transcripts: true } }],
    ["doses", `/api/doses?${sid}`, { medication_id: MED, slot: "morning", state: "missed" }],
    ["answer a question", `/api/meds/med-relative-box/answer?${sid}`, { visit_id: "p1", utterance_id: "p1-u03", speaker: "pharmacist" }],
    ["confirm a visit", `/api/visits/v1/confirm?${sid}`, { mine: [], items: {} }],
    ["confirm a medicine", `/api/meds?${sid}`, { read_token: "x".repeat(20), confirmed: [], origin: "self_bought" }],
  ];
  for (const [what, url, data] of calls) {
    const res = await r.post(url, { data });
    expect(res.status(), what).toBe(403);
    expect((await res.json()).error, what).toBe("patient_only");
  }
  // nothing changed: the switch is still off, D29's dose is still taken
  expect((await (await request.get(`/api/family/grants?${sid}`)).json()).items.visit_transcripts).toBe(false);
  expect((await (await request.get(`/api/doses?${sid}&from=29&to=29`)).json()).doses[0].state).toBe("taken");
  await expect(family.page.getByTestId(`family-dose-${MED}`)).toHaveAttribute("data-state", "taken");
  // his phone may
  const ok = await request.post(`/api/family/grants?${sid}`, { data: { items: { notes: true } } });
  expect(ok.status()).toBe(200);
  await closeAll([family]);
});

test("with visit_transcripts off, /f holds none of R1-R4 and no visit line (zh and en text scan)", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const texts = visitTexts();
  expect(texts.length).toBeGreaterThanOrEqual(49); // R1-R4 (also transcript lines), 49 transcript lines, 3 answers, de-duplicated
  const s = await createSession(request, { story_day: 43 }); // every visit has happened
  await grant(request, s.id, { notes: true }); // everything else on
  const family = await joinAsFamily(browser, s.join_code);
  const phone = await joinAsHim(browser, s.join_code, "/p/family");

  async function scan(where: string) {
    const shown = await family.page.evaluate(() => document.body.innerText);
    const html = await family.page.content();
    for (const t of texts) {
      expect(shown.includes(t), `${where} (text): ${t}`).toBe(false);
      expect(html.includes(t), `${where} (html): ${t}`).toBe(false);
    }
  }
  await expect(family.page.getByTestId("family-notes")).toBeVisible();
  await scan("zh, off");

  // switched on, the same words are there (the scan looks at the right thing)
  await phone.page.getByTestId("grant-visit_transcripts").click();
  const visits = family.page.getByTestId("family-visits");
  await expect(visits).toContainText("At home, we want it below 135 over 85.", { timeout: 1000 });
  await expect(visits).toContainText("Please don't change the dose yourself.");
  await expect(visits).toContainText("手腕的不太准。买一个绑手臂的，upper arm 的。");
  // and off again, gone within a second
  await phone.page.getByTestId("grant-visit_transcripts").click();
  await expect(visits).toHaveCount(0, { timeout: 1000 });
  await scan("zh, switched off again");

  await family.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await family.page.reload();
  await waitLive(family.page);
  await expect(family.page.getByTestId("family-notes")).toBeVisible();
  await scan("en, off");
  expect(await textBelow(family.page, 18)).toEqual([]);
  await closeAll([family, phone]);
});

test("Wei Ling records her reminder on /f (WAV, no WebM); at the next reminder time his phone plays HER clip, 女儿的录音, on any page", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 42, story_time: "08:00" }); // D42: no answer in the seed yet
  const family = await joinAsFamily(browser, s.join_code);
  const phone = await joinAsHim(browser, s.join_code, "/p/bp"); // not Today: the player lives in the frame
  const fp = family.page;
  const audioTypes: string[] = [];
  fp.on("request", (r) => {
    const ct = r.headers()["content-type"] ?? "";
    if (ct.startsWith("audio/") || ct.startsWith("video/")) audioTypes.push(ct);
  });

  const recorder = fp.getByTestId("reminder-recorder");
  await expect(recorder.getByTestId("reminder-recorder-current")).toHaveAttribute("data-current", "stand_in");
  expect(await textBelow(fp, 18)).toEqual([]);
  await recorder.getByTestId("reminder-rec-start").click();
  await expect(recorder.getByTestId("reminder-recording")).toBeVisible({ timeout: 10_000 });
  await fp.waitForTimeout(1500);
  await recorder.getByTestId("reminder-rec-stop").click();
  await expect(recorder.getByTestId("reminder-rec-save")).toBeVisible();
  const rec = (await fp.evaluate(() => window.__rpLastRecording))!;
  expect(rec).toMatchObject({ type: "audio/wav", sampleRate: 16000 });
  expect(rec.durationMs).toBeGreaterThan(500);
  const head = Buffer.from(rec.header);
  expect(head.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(head.subarray(8, 12).toString("ascii")).toBe("WAVE");
  expect(head.readUInt16LE(22)).toBe(1); // mono
  expect(head.readUInt32LE(24)).toBe(16_000);

  const put = fp.waitForRequest((r) => r.url().includes("/api/blob/upload") && r.method() === "PUT");
  const registered = fp.waitForResponse((r) => r.url().includes("/api/reminders") && r.request().method() === "POST");
  await recorder.getByTestId("reminder-rec-text").fill("爸，记得吃药，我晚上打给你。");
  await recorder.getByTestId("reminder-rec-save").click();
  const upload = await put;
  expect(upload.headers()["content-type"]).toBe("audio/wav");
  expect((await upload.response())?.status()).toBe(200); // the upload route checked the bytes: RIFF/WAVE, not WebM
  const reg = await registered;
  expect(reg.status()).toBe(201);
  const clip = (await reg.json()).clip as { id: string; audio_path: string; by: string };
  expect(clip.by).toBe("wei-ling");
  expect(clip.audio_path).toMatch(new RegExp(`^${s.id}/reminders/.+\\.wav$`));
  await expect(recorder.getByTestId("reminder-rec-saved")).toBeVisible();
  expect(audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
  expect(audioTypes).toContain("audio/wav");

  // the stored clip is hers, not the stand-in
  const list = (await (await request.get(`/api/reminders?session=${s.id}`)).json()).clips as { id: string; stand_in: boolean; audio_url: string | null }[];
  expect(list.find((c) => c.id === clip.id)).toMatchObject({ stand_in: false });
  const audio = await request.get(`/api/reminders/${clip.id}/audio?session=${s.id}`);
  expect(audio.headers()["x-ripple-stand-in"]).toBe("0");

  // the next reminder time: 08:45 after breakfast; he is on the blood pressure page
  await api(request, "/api/clock", s.id, { day: 42, time: "08:45" });
  const strip = phone.page.getByTestId("reminder-strip");
  await expect(strip).toHaveAttribute("data-reminder", "1", { timeout: 5000 });
  await expect(strip).toHaveAttribute("data-clip", clip.id);
  await expect(strip.getByTestId("reminder-clip-source")).toHaveText("女儿的录音");
  await expect(strip).not.toContainText("代录音");
  await expect(strip).toContainText("爸，记得吃药，我晚上打给你。");
  await expect(strip.getByTestId("reminder-clip-play")).toHaveAttribute("data-stand-in", "0");
  await expect(strip.getByTestId("reminder-clip-play")).toHaveAttribute("data-src", new RegExp(`/api/reminders/${clip.id}/audio`));
  await expect
    .poll(() => phone.page.evaluate(() => (window.__rpDailyClipPlays ?? []).filter((p) => p.url.includes("/api/reminders/")).map((p) => ({ url: p.url, auto: p.auto, playing: p.playing }))), { timeout: 10_000 })
    .toContainEqual({ url: expect.stringContaining(clip.id), auto: true, playing: true });
  expect(await textBelow(phone.page, 18)).toEqual([]);
  // the four pages the verification did not walk: the frame's strip is there and plays her clip on each
  for (const where of [`/p/meds/${MED}`, "/p/meds/add", "/p/visit", "/p/visit/v1/review"]) {
    await phone.page.goto(where);
    await waitLive(phone.page);
    const here = phone.page.getByTestId("reminder-strip");
    await expect(here, where).toHaveCount(1);
    await expect(here, where).toHaveAttribute("data-clip", clip.id);
    await expect(here.getByTestId("reminder-clip-source"), where).toHaveText("女儿的录音");
    await expect(here, where).not.toContainText("代录音");
    await expect
      .poll(() => phone.page.evaluate(() => (window.__rpDailyClipPlays ?? []).filter((p) => p.url.includes("/api/reminders/")).map((p) => ({ url: p.url, auto: p.auto, playing: p.playing }))), {
        timeout: 10_000,
        message: where,
      })
      .toContainEqual({ url: expect.stringContaining(clip.id), auto: true, playing: true });
  }
  // on Today there is exactly one player (the page's own), playing her clip too
  await phone.page.goto("/p/today");
  await waitLive(phone.page);
  await expect(phone.page.getByTestId("reminder-strip")).toHaveCount(1);
  await expect(phone.page.getByTestId("reminder-strip")).toHaveAttribute("data-clip", clip.id);
  // English label
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await phone.page.goto("/p/meds");
  await waitLive(phone.page);
  await expect(phone.page.getByTestId("reminder-clip-source")).toHaveText("Wei Ling's recording");
  await closeAll([family, phone]);
  await api(request, "/api/session/reset", s.id); // deletes her test recording from storage
});

test("'no reply after two reminders': OFF through his switch, nothing reaches /f; ON through his switch, it does", async ({ browser, request }) => {
  test.setTimeout(120_000);
  // OFF
  const off = await createSession(request, { story_day: 42, story_time: "08:30" });
  const phoneOff = await joinAsHim(browser, off.join_code, "/p/family");
  const familyOff = await joinAsFamily(browser, off.join_code);
  await expect(familyOff.page.getByTestId("family-alerts")).toHaveAttribute("data-on", "true");
  await phoneOff.page.getByTestId("grant-no_reply_alert").click();
  await expect(phoneOff.page.getByTestId("grant-no_reply_alert")).toHaveAttribute("data-on", "false");
  await expect(familyOff.page.getByTestId("family-alerts")).toHaveAttribute("data-on", "false", { timeout: 1000 });
  await api(request, "/api/clock", off.id, { day: 42, time: "08:45" });
  await api(request, "/api/clock", off.id, { day: 42, time: "09:15" });
  await api(request, "/api/clock", off.id, { day: 42, time: "09:50" }); // window closed: no reply after two reminders
  const doses = (await (await request.get(`/api/doses?session=${off.id}&from=42&to=42`)).json()).doses;
  expect(doses).toEqual([expect.objectContaining({ medication_id: MED, state: "unconfirmed", reason: "no_reply" })]);
  await familyOff.page.waitForTimeout(2500);
  await expect(familyOff.page.getByTestId("family-alert")).toHaveCount(0);
  await expect(familyOff.page.getByTestId("family-alerts")).toHaveAttribute("data-on", "false");
  expect(await (await request.get(`/api/family/alerts?session=${off.id}`)).json()).toEqual({ on: false, alerts: [] });
  await closeAll([phoneOff, familyOff]);

  // ON (switched off and on again on his phone)
  const on = await createSession(request, { story_day: 42, story_time: "08:30" });
  const phoneOn = await joinAsHim(browser, on.join_code, "/p/family");
  const familyOn = await joinAsFamily(browser, on.join_code);
  await phoneOn.page.getByTestId("grant-no_reply_alert").click();
  await expect(familyOn.page.getByTestId("family-alerts")).toHaveAttribute("data-on", "false", { timeout: 1000 });
  await phoneOn.page.getByTestId("grant-no_reply_alert").click();
  await expect(phoneOn.page.getByTestId("grant-no_reply_alert")).toHaveAttribute("data-on", "true");
  await api(request, "/api/clock", on.id, { day: 42, time: "08:45" });
  await api(request, "/api/clock", on.id, { day: 42, time: "09:15" });
  await api(request, "/api/clock", on.id, { day: 42, time: "09:50" });
  await expect(familyOn.page.getByTestId("family-alert")).toHaveCount(1, { timeout: 5000 });
  await expect(familyOn.page.getByTestId("family-alert")).toContainText("爸爸两次提醒都没回：10月5日早上的药（Amlodipine）。");
  // and he can switch it off again: the alert leaves her phone within a second
  await phoneOn.page.getByTestId("grant-no_reply_alert").click();
  await expect(familyOn.page.getByTestId("family-alert")).toHaveCount(0, { timeout: 1000 });
  await closeAll([phoneOn, familyOn]);
});

test("Today leads to the brief and to 家人能看到什么; 18px at 360px wide", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29 });
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 360, height: 780 } });
  await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
  const page = await context.newPage();
  await page.goto("/p/today");
  await waitLive(page);
  await expect(page.getByTestId("link-brief")).toHaveAttribute("href", "/p/brief");
  await page.getByTestId("link-family-grants").click();
  await expect(page.getByTestId("page-family-grants")).toBeVisible();
  await expect(page.getByRole("heading", { name: "家人能看到什么" })).toBeVisible();
  expect(await textBelow(page, 18)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("her phone opening his brief or his switch page lands on /f; the redirect itself carries none of his words", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 41 }); // seed defaults: notes and visit transcripts off
  const family = await joinAsFamily(browser, s.join_code);
  // his own device sees both notes and R1 on the brief (the scan below looks for the right words)
  const phone = await joinAsHim(browser, s.join_code, "/p/brief");
  await expect(phone.page.getByTestId("page-brief")).toContainText(NOTE_D37);
  await expect(phone.page.getByTestId("page-brief")).toContainText(R1);

  for (const where of ["/p/brief", "/p/family"]) {
    // the answer to her request is a redirect to /f, with nothing of his in it
    const raw = await family.context.request.get(where, { maxRedirects: 0 });
    expect([302, 303, 307, 308], `${where}: ${raw.status()}`).toContain(raw.status());
    expect(raw.headers()["location"], where).toMatch(/\/f$/);
    const body = await raw.text();
    for (const words of [NOTE_D20, NOTE_D37, R1, "140/85", "150/95"]) expect(body.includes(words), `${where} body: ${words}`).toBe(false);
    // in her browser she ends up on /f, which shows only what he allows
    await family.page.goto(where);
    await expect(family.page).toHaveURL(/\/f$/);
    await expect(family.page.getByTestId("page-family")).toBeVisible();
    await expect(family.page.getByTestId("page-brief")).toHaveCount(0);
    await expect(family.page.getByTestId("page-family-grants")).toHaveCount(0);
    await expect(family.page.locator("[data-testid^='grant-']")).toHaveCount(0);
    const shown = await family.page.evaluate(() => document.body.innerText);
    for (const words of [NOTE_D20, NOTE_D37, R1]) expect(shown.includes(words), `${where} -> /f: ${words}`).toBe(false);
  }
  // his switch page still opens for him
  await phone.page.goto("/p/family");
  await expect(phone.page.getByTestId("page-family-grants")).toBeVisible();
  await closeAll([family, phone]);
});

test("/f says when a refetch fails, keeps what it shows, and recovers by itself", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const s = await createSession(request, { story_day: 29 });
  const phone = await joinAsHim(browser, s.join_code, "/p/family");
  const family = await joinAsFamily(browser, s.join_code);
  const fp = family.page;
  await expect(fp.getByTestId("family-doses")).toBeVisible();
  await expect(fp.getByTestId("family-view-error")).toHaveCount(0);
  let failed = 0;
  await fp.route("**/api/family/view*", async (route) => {
    failed += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) });
  });
  // he switches his notes on: her refetch fails
  await phone.page.getByTestId("grant-notes").click();
  await expect(fp.getByTestId("family-view-error")).toBeVisible({ timeout: 1000 });
  await expect(fp.getByTestId("family-view-error")).toHaveText("没能取到爸爸的最新情况，正在重试…");
  await expect(fp.getByTestId("family-view")).toHaveAttribute("data-load-failed", "true");
  await expect(fp.getByTestId("family-allowed-notes")).toHaveAttribute("data-on", "true"); // the switch itself came with the event
  await expect(fp.getByTestId("family-notes")).toHaveCount(0);
  await expect(fp.getByTestId("family-doses")).toBeVisible(); // what was shown stays
  // it keeps trying by itself (1 s, then 2 s)
  await expect.poll(() => failed, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  // the server answers again: the section arrives without any new event, and the line goes
  await fp.unroute("**/api/family/view*");
  await expect(fp.getByTestId("family-notes")).toContainText(NOTE_D20, { timeout: 10_000 });
  await expect(fp.getByTestId("family-view-error")).toHaveCount(0);
  await expect(fp.getByTestId("family-view")).toHaveAttribute("data-load-failed", "false");
  // English, and a connection that drops instead of a 500
  await family.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await fp.reload();
  await waitLive(fp);
  await fp.route("**/api/family/view*", (route) => route.abort("connectionreset"));
  await phone.page.getByTestId("grant-visit_transcripts").click();
  await expect(fp.getByTestId("family-view-error")).toHaveText("Could not get Dad's latest updates. Trying again…", { timeout: 1000 });
  await fp.unroute("**/api/family/view*");
  await expect(fp.getByTestId("family-visits")).toBeVisible({ timeout: 10_000 });
  await expect(fp.getByTestId("family-view-error")).toHaveCount(0);
  expect(await textBelow(fp, 18)).toEqual([]);
  await closeAll([phone, family]);
});

test("his switch page says when it cannot read the switches after a reset, and catches up by itself", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const s = await createSession(request, { story_day: 29 });
  const phone = await joinAsHim(browser, s.join_code, "/p/family");
  const pp = phone.page;
  await pp.getByTestId("grant-dose_summary").click();
  await expect(pp.getByTestId("grant-dose_summary")).toHaveAttribute("data-on", "false");
  await pp.route("**/api/family/grants*", (route) =>
    route.request().method() === "GET" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "store_unavailable" }) }) : route.continue(),
  );
  await api(request, "/api/session/reset", s.id); // back to the seed: dose_summary on again
  await expect(pp.getByTestId("grant-load-error")).toBeVisible({ timeout: 2000 });
  await expect(pp.getByTestId("grant-load-error")).toHaveText("没能读到现在的开关，正在重试…下面显示的可能不是最新的。");
  await expect(pp.getByTestId("grant-dose_summary")).toHaveAttribute("data-on", "false"); // stale, and the line says so
  await pp.unroute("**/api/family/grants*");
  await expect(pp.getByTestId("grant-dose_summary")).toHaveAttribute("data-on", "true", { timeout: 10_000 });
  await expect(pp.getByTestId("grant-load-error")).toHaveCount(0);
  // a tap that gets no answer puts the switch back and says so
  await pp.route("**/api/family/grants*", (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));
  await pp.getByTestId("grant-notes").click();
  await expect(pp.getByTestId("grant-error")).toHaveText("没改成，再试一次。");
  await expect(pp.getByTestId("grant-notes")).toHaveAttribute("data-on", "false");
  await pp.unroute("**/api/family/grants*");
  expect((await (await request.get(`/api/family/grants?session=${s.id}`)).json()).items.notes).toBe(false);
  await closeAll([phone]);
});

test("her recorder keeps the recording when saving fails, says so, and saves on the next tap", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 42, story_time: "08:00" });
  const family = await joinAsFamily(browser, s.join_code);
  const fp = family.page;
  const recorder = fp.getByTestId("reminder-recorder");
  await recorder.getByTestId("reminder-rec-start").click();
  await expect(recorder.getByTestId("reminder-recording")).toBeVisible({ timeout: 10_000 });
  await fp.waitForTimeout(1200);
  await recorder.getByTestId("reminder-rec-stop").click();
  await expect(recorder.getByTestId("reminder-rec-save")).toBeVisible();
  // registering the clip fails once
  await fp.route("**/api/reminders*", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) }) : route.continue(),
  );
  await recorder.getByTestId("reminder-rec-save").click();
  await expect(recorder.getByTestId("reminder-rec-error")).toHaveText("没存上。录音还在，再点一次「存下来给爸爸」。");
  await expect(recorder).toHaveAttribute("data-phase", "error");
  await expect(recorder.getByTestId("reminder-rec-save")).toBeVisible(); // the recording is still there
  await expect(recorder.getByTestId("reminder-rec-preview")).toBeVisible();
  expect((await (await request.get(`/api/reminders?session=${s.id}`)).json()).clips.filter((c: { stand_in: boolean }) => !c.stand_in)).toEqual([]);
  await fp.unroute("**/api/reminders*");
  const registered = fp.waitForResponse((r) => r.url().includes("/api/reminders") && r.request().method() === "POST");
  await recorder.getByTestId("reminder-rec-save").click();
  expect((await registered).status()).toBe(201);
  await expect(recorder.getByTestId("reminder-rec-saved")).toBeVisible();
  await expect(recorder.getByTestId("reminder-rec-error")).toHaveCount(0);
  const mine = (await (await request.get(`/api/reminders?session=${s.id}`)).json()).clips.filter((c: { stand_in: boolean; audio_url: string | null }) => !c.stand_in && c.audio_url);
  expect(mine).toHaveLength(1);
  await closeAll([family]);
  await api(request, "/api/session/reset", s.id); // deletes her test recordings from storage
});

test("English /f counts one day in the singular: 'Not taken: 1 day'", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 15, story_time: "23:00" }); // Tue 8 Sep: the tai-chi morning missed
  const family = await joinAsFamily(browser, s.join_code);
  await family.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await family.page.reload();
  await waitLive(family.page);
  await expect(family.page.getByTestId("family-doses-missed")).toHaveText("Not taken: 1 day");
  await expect(family.page.getByTestId("family-doses")).not.toContainText("1 days");
  await closeAll([family]);
});

test("Ripple's own words on /f hold no judgement word (zh, en, every switch on); the one exemption is the sharing heading", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const s = await createSession(request, { story_day: 43 });
  await grant(request, s.id, { notes: true, visit_transcripts: true });
  const family = await joinAsFamily(browser, s.join_code);
  const fp = family.page;
  const EXEMPT: Record<string, string> = { zh: "爸爸允许你看的", en: "What Dad lets you see" };
  for (const locale of ["zh", "en"] as const) {
    if (locale === "en") {
      await family.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
      await fp.reload();
      await waitLive(fp);
    }
    await expect(fp.getByTestId("family-visits")).toBeVisible();
    await expect(fp.getByTestId("family-notes")).toBeVisible();
    const { all, own } = await fp.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, [data-verbatim]").forEach((el) => el.remove());
      return { all: document.body.innerText, own: (clone.textContent ?? "").replace(/\s+/g, " ") };
    });
    // the quotes are there and do hold such words (R4 "if your readings are high"): the scan looks at the right page
    expect(judgementHits(all).length, `${locale}: quoted words`).toBeGreaterThan(0);
    expect(own.includes(EXEMPT[locale]), `${locale}: heading`).toBe(true);
    const hits = judgementHits(own.split(EXEMPT[locale]).join(" "));
    expect(hits, `${locale}: Ripple's own words`).toEqual([]);
    // and the exemption is exactly that heading: without it the only hit is 允许 (zh), none in English
    expect(judgementHits(own).map((h) => h.word), locale).toEqual(locale === "zh" ? ["允许"] : []);
  }
  await closeAll([family]);
});
