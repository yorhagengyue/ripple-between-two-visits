/**
 * M5 on the phone (docs/plan/tasks/M5-explain.md and this round's literal requirements), mock providers, no keys:
 *   1. the explain card 「为什么没感觉也要吃」 on /p/meds/med-amlodipine: absent on D7, present from D8; every
 *      sentence carries its source label; R3 verbatim with 医生说; tapping R3's label plays the v2 R3 clip
 *      (audio reaches 'playing', bytes equal fixtures/visits/clips/v2-u06.wav), labelled 代录音 / stand-in recording;
 *   2. read-aloud: POST /api/tts (TTS_PROVIDER=mock) returns WAV for the whole zh card, the button plays it, and
 *      the text read is exactly the card's sentences;
 *   3. the understanding checklist: four items, 知道 / 不确定; 不确定 adds exactly one question per item (origin
 *      understanding_check) shown on the question list in his words; again adds nothing; no right / wrong wording;
 *   4. medication day gating: the relative's box is not on /p/meds on D0 and D7, and is there from D8;
 *   5. every text on the page at least 18px (source labels excepted).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { api, closeAll, createSession, openDevice, textBelow, CREW_HEADERS } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

const MED_PAGE = "/p/meds/med-amlodipine";
const R3 =
  "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.";
const R3_CLIP = readFileSync(path.join(__dirname, "..", "fixtures", "visits", "clips", "v2-u06.wav"));

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  // next dev compiles each route on its first request
  const s = await createSession(request, { story_day: 9 });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of [MED_PAGE, "/p/meds", "/p/questions"]) await request.get(p, { headers: cookie });
  await request.post(`/api/tts?session=${s.id}`, { data: { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" } });
  await request.get(`/api/understanding?session=${s.id}&med_id=med-amlodipine`);
  await request.get(`/api/visits/v2/clip?u=v2-u06&session=${s.id}`);
});

async function waitPlaying(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.locator(selector).evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0), { timeout: 10_000 })
    .toBe(true);
}

test("explain card: absent on D7, there from D8; sourced lines; R3's label plays the R3 clip (代录音)", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 7 });
  const phone = await openDevice(browser, s.id, MED_PAGE);
  const page = phone.page;
  await expect(page.getByTestId("page-med-detail")).toBeVisible();
  await expect(page.getByTestId("explain-card")).toHaveCount(0);
  await expect(page.getByTestId("understanding-checklist")).toHaveCount(0);

  await api(request, "/api/clock", s.id, { day: 8 });
  await page.reload();
  const card = page.getByTestId("explain-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("explain-title")).toHaveText("为什么没感觉也要吃");
  const lines = card.getByTestId("explain-line");
  await expect(lines.first()).toHaveAttribute("data-source", "visit:v2:R3");
  await expect(lines.first().getByTestId("explain-line-text")).toHaveText(R3);
  await expect(lines.first().getByTestId("explain-chip")).toHaveText("● 医生说");
  await expect(lines.first().getByTestId("explain-line-source")).toHaveText("2026年9月1日 · 0:20 处");
  // every sentence has its source label; the others are the leaflet's own Mandarin
  const n = await lines.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) {
    await expect(lines.nth(i).getByTestId("explain-chip")).toHaveText(/^● (医生说|推断：医生|柜台说|药剂师说|单张)$/);
    expect(await lines.nth(i).getAttribute("data-kind")).toMatch(/^(doctor|counter|leaflet)$/);
  }
  await expect(lines.nth(1)).toHaveAttribute("data-kind", "leaflet");
  await expect(lines.nth(1).getByTestId("explain-line-text")).toHaveText("氨氯地平用来降血压，它让血管放松、变宽。");

  // tap R3's source label: the clip plays, and it is the R3 stand-in clip
  const chip = card.getByTestId("explain-clip-chip");
  await expect(chip.getByTestId("explain-clip-label")).toContainText("代录音");
  const src = (await chip.getAttribute("data-src"))!;
  expect(src).toContain("/api/visits/v2/clip?u=v2-u06");
  await chip.click();
  await waitPlaying(page, '[data-testid="explain-clip-audio"]');
  await expect(chip).toHaveAttribute("data-playing", "true");
  expect(await page.evaluate(() => window.__rpExplainClips?.at(-1)?.playing)).toBe(true);
  const clip = await page.request.get(src);
  expect(clip.status()).toBe(200);
  expect(clip.headers()["x-ripple-stand-in"]).toBe("1");
  expect(Buffer.from(await clip.body()).equals(R3_CLIP)).toBe(true);

  // English: the same words, Doctor said, stand-in recording
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: page.url() }]);
  await page.reload();
  const en = page.getByTestId("explain-card");
  await expect(en.getByTestId("explain-title")).toHaveText("Why take it when you feel fine");
  await expect(en.getByTestId("explain-line").first().getByTestId("explain-line-text")).toHaveText(R3);
  await expect(en.getByTestId("explain-line").first().getByTestId("explain-chip")).toHaveText("● Doctor said");
  await expect(en.getByTestId("explain-clip-label")).toContainText("stand-in recording");
  await closeAll([phone]);
});

test("read-aloud: mock TTS returns WAV for the whole zh card, the button plays it, the text is the card's own", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 9 });
  const phone = await openDevice(browser, s.id, MED_PAGE);
  const page = phone.page;
  const card = page.getByTestId("explain-card");
  await expect(card).toBeVisible();
  const shown = await card.getByTestId("explain-line-text").allTextContents();
  const expectedSha = createHash("sha256").update(shown.join("\n"), "utf8").digest("hex");

  const tts = page.waitForResponse((r) => r.url().includes("/api/tts") && r.request().method() === "POST");
  await card.getByTestId("explain-read-aloud").click();
  const res = await tts;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("audio/wav");
  expect(res.headers()["x-ripple-tts-provider"]).toBe("mock");
  expect(res.headers()["x-ripple-tts-sha256"]).toBe(expectedSha); // exactly the card's sentences, nothing added
  expect(res.request().postDataJSON()).toEqual({ card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" });
  // the same request again for its bytes (the page consumed the first body as a blob): a playable WAV
  const again = await page.request.post(`/api/tts?session=${s.id}`, { data: { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" } });
  expect(again.headers()["x-ripple-tts-sha256"]).toBe(expectedSha);
  const body = await again.body();
  expect(body.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(body.subarray(8, 12).toString("ascii")).toBe("WAVE");
  expect(body.readUInt32LE(24)).toBe(16000); // sample rate
  expect(body.length).toBeGreaterThan(44 + 16000 * 2 * 3); // more than 3 s of audio for the whole card

  await waitPlaying(page, '[data-testid="explain-read-audio"]');
  await expect(card.getByTestId("explain-read-aloud")).toHaveAttribute("data-state", "playing");
  expect(await page.evaluate(() => window.__rpTts)).toMatchObject({ status: 200, provider: "mock", sha256: expectedSha, playing: true });
  expect(await page.evaluate(() => window.__rpTts?.bytes)).toBe(body.length);
  await expect(card.getByTestId("explain-read-synthetic")).toHaveText("测试声音");
  await closeAll([phone]);
});

test("understanding checklist: four items; 不确定 adds one question per item (understanding_check), never twice; on the question list", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 9 });
  const phone = await openDevice(browser, s.id, MED_PAGE);
  const page = phone.page;
  const list = page.getByTestId("understanding-checklist");
  await expect(list).toBeVisible();
  const labels = await list.locator('[data-testid$="-label"]').allTextContents();
  expect(labels).toEqual(["这个药是做什么的", "没感觉要不要吃", "什么时候吃", "漏了怎么办"]);
  for (const id of ["purpose", "feel_fine", "when", "missed"]) {
    await expect(list.getByTestId(`check-${id}-know`)).toHaveText("知道");
    await expect(list.getByTestId(`check-${id}-unsure`)).toHaveText("不确定");
  }
  const count = async () =>
    ((await (await request.get(`/api/understanding?session=${s.id}&med_id=med-amlodipine`)).json()).view.items as { questionId: string | null }[]).filter((i) => i.questionId).length;

  // 知道: nothing goes on the list
  await list.getByTestId("check-purpose-know").click();
  await expect(list.getByTestId("check-purpose")).toHaveAttribute("data-answer", "know");
  await expect(list.getByTestId("check-purpose-noted")).toHaveText("记下了：知道");
  expect(await count()).toBe(0);

  // 不确定: one question; again: still one
  await list.getByTestId("check-feel_fine-unsure").click();
  await expect(list.getByTestId("check-feel_fine-on-list")).toBeVisible();
  await expect(list.getByTestId("check-feel_fine")).toHaveAttribute("data-answer", "unsure");
  expect(await count()).toBe(1);
  await list.getByTestId("check-feel_fine-unsure").click();
  await expect(list.getByTestId("check-feel_fine-unsure")).toBeEnabled();
  await page.waitForTimeout(300);
  expect(await count()).toBe(1);
  await list.getByTestId("check-missed-unsure").click();
  await expect(list.getByTestId("check-missed-on-list")).toBeVisible();
  expect(await count()).toBe(2);

  // after a reload the items on the list still say so
  await page.reload();
  await expect(page.getByTestId("check-feel_fine")).toHaveAttribute("data-answer", "unsure");
  await expect(page.getByTestId("check-missed")).toHaveAttribute("data-answer", "unsure");

  // no right / wrong wording, no score
  const text = await list.innerText();
  for (const w of ["对", "错", "正确", "分", "答对"]) expect(text).not.toContain(w);

  // the question list shows them in his words, once each
  await page.goto("/p/questions");
  const mine = page.locator('[data-testid="question"][data-origin="understanding_check"]');
  await expect(mine).toHaveCount(2);
  await expect(mine.filter({ hasText: "Amlodipine：没感觉要不要吃？" })).toHaveCount(1);
  await expect(mine.filter({ hasText: "Amlodipine：漏了怎么办？" })).toHaveCount(1);
  // labelled as his own question, the same tag as one he typed himself (q.origin.own)
  expect(await mine.locator(":scope > .rp-tag").allTextContents()).toEqual(["自己想问的", "自己想问的"]);
  await closeAll([phone]);
});

test("medication day gating: the relative's box is not on /p/meds on D0 or D7, and is there from D8", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 0 });
  const phone = await openDevice(browser, s.id, "/p/meds");
  const page = phone.page;
  await expect(page.getByTestId("page-meds")).toBeVisible();
  await expect(page.getByTestId("med-row-med-relative-box")).toHaveCount(0);
  await expect(page.getByTestId("meds-group-relative")).toHaveCount(0);
  for (const [day, there] of [
    [7, false],
    [8, true],
  ] as const) {
    await api(request, "/api/clock", s.id, { day });
    await page.reload();
    await expect(page.getByTestId("page-meds")).toBeVisible();
    await expect(page.getByTestId("med-row-med-relative-box"), `D${day}`).toHaveCount(there ? 1 : 0);
  }
  await expect(page.getByTestId("med-row-med-relative-box")).toHaveAttribute("data-status", "unidentified");
  await closeAll([phone]);
});

test("the medicine page with the explain card and the checklist: every text at least 18px (source labels excepted), both languages", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 9 });
  const phone = await openDevice(browser, s.id, MED_PAGE);
  const page = phone.page;
  await expect(page.getByTestId("explain-card")).toBeVisible();
  await page.getByTestId("check-when-unsure").click();
  await expect(page.getByTestId("check-when-on-list")).toBeVisible();
  expect(await textBelow(page, 18)).toEqual([]);
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: page.url() }]);
  await page.reload();
  await expect(page.getByTestId("explain-title")).toHaveText("Why take it when you feel fine");
  expect(await textBelow(page, 18)).toEqual([]);
  await closeAll([phone]);
});
