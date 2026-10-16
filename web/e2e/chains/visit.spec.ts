/**
 * Chain 3 看诊, end to end (docs/plan/e2e-chains.md section 3): consent -> recording -> cards -> End visit -> his
 * confirmation -> the answers kept in the doctor's words -> what they are used for afterwards.
 *
 *   D42 09:30 (the v3 visit day), his phone (joined as 本人, a fake microphone), her phone (/join as 家属), backstage.
 *   1. /p/visit: he consents to recording; the consent line carries the story time (上午9:30)    visit "recording"
 *   2. the recording runs; with SPEECH_PROVIDER=mock the v3 replay stands in for the live captions; the check cards
 *      (his readings against R1, 29 of 33 mornings, his own D37 note) and the question list come up; backstage
 *      shows the captions and the cards as they happen
 *   3. End visit: the recording is uploaded (16 kHz WAV), the whole-visit record is made, review          "review"
 *   4. he confirms the new medicine line and every answer the visit holds (five, 10-10: the extra-tablet one too) "confirmed"
 *   5. /p/questions: q-tai-chi, q-knee-2 and q-extra-tablet answered in Dr Lim's own words, 医生说
 *   6. her phone: nothing of the visit while visit records are off; he switches them on: Dr Lim's answers are there
 *   7. D43: he asks whether the two tablets go together; the answer quotes what Dr Lim said at D42 (医生说, 10月5日)
 *
 * Gap 3.9 (closed 10-10; its own test below, a test.fail() until then): D43 「验血要空腹吗？」 quoted the leaflets' "with
 * or without food" lines (about the tablets), not Dr Lim's D42 answer about the blood test. Now the question is about
 * the test (lib/safety/topics.ts: fasting words alone are not the food topic) and a test-only ask has no label or
 * how-to-take leaflet line among its sources (lib/safety/candidates.ts).
 * Not covered here: the answers' own voice (in mock only R1-R4 and Dr Lim's two last D42 lines have stand-in clips;
 * with Whisper the recording is cut per sentence).
 */
import { expect, test } from "@playwright/test";
import { at, closeAll, createSession, eventRows, getJson, joinAs, askOnPhone, textBelow, waitLive, CREW_HEADERS, joinThroughPageAsCrew } from "../helpers";

// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
});

const V3_TAI_CHI_ANSWER = "可以，回来再吃，每天差不多同一个时间就好。Same time every day.";
const V3_KNEE_ANSWER = "Try not to take ibuprofen regularly. It can push your blood pressure up. For the knee, paracetamol is the safer one, and we'll look at the knee properly next time.";
const V3_TOGETHER_ANSWER = "Yes, both together after breakfast is fine.";
const V3_FAST_ANSWER = "No need to fast for this one. Just take your medicine as usual and come in.";
const V3_EXTRA_ANSWER =
  "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today.";

interface VisitSeen {
  view: { visit: { id: string; status: string }; lines: { id: string; role: string }[] };
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 42, story_time: "09:30" });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/p/visit", "/p/visit/v3/review", "/p/questions", "/p/family", "/f", "/backstage", "/join"]) await request.get(p, { headers: cookie });
  await request.get(`/api/visits/v3?session=${s.id}`);
});

test("看诊: consent -> recording -> cards and the question list -> End visit -> review -> confirmed -> answers in the doctor's words -> on her phone once he shares -> quoted the next day", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const s = await createSession(request, { story_day: 42, story_time: "09:30" });
  const daughter = await joinThroughPageAsCrew(browser, s.join_code, "family");
  const phone = await joinAs(browser, s.join_code, "patient", "/p/visit?speed=8");
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");
  const pp = phone.page;

  // 1. he consents; the visit is recording, and the consent line says when (story time, not the wall clock)
  await expect(pp.getByTestId("visit-consent-step")).toBeVisible();
  await pp.getByTestId("consent-yes").click();
  await expect(pp.getByTestId("visit-screen")).toBeVisible({ timeout: 15_000 });
  await expect(pp.getByTestId("visit-consent")).toHaveText("已同意录音 · 上午9:30");
  await expect.poll(async () => (await getJson<VisitSeen>(phone, "/api/visits/v3", s.id)).view.visit.status).toBe("recording");

  // 2. captions and cards as the visit goes on; backstage sees them too
  await expect(pp.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await expect(pp.getByTestId("line-v3-u20")).toBeAttached();
  await expect(pp.getByTestId("chk-v3-u02-bars")).toHaveAttribute("data-ref", "135/85");
  await expect(pp.getByTestId("chk-v3-u02-target")).toContainText("10 次里有 9 次不低于");
  await expect(pp.getByTestId("chk-v3-u04-doses")).toContainText("33 个早上勾了 29 个");
  await expect(pp.getByTestId("chk-v3-u06-note-text")).toHaveText("“今天在大巴窑中心走了一圈，脚踝有点肿。”");
  await expect(pp.getByTestId("qlist-progress")).toHaveText("5 个问题，答了 5 个");
  await expect(pp.getByTestId("card-v3-u07-chip")).toContainText("推断");
  expect(await textBelow(pp, 18)).toEqual([]);
  await expect(eventRows(desk.page, "asr.partial")).not.toHaveCount(0);
  await expect(eventRows(desk.page, "card.created")).not.toHaveCount(0);
  await expect(eventRows(desk.page, "visit.changed").filter({ hasText: "recording started" })).not.toHaveCount(0);

  // 3. End visit: the recording goes up as a 16 kHz mono WAV, the whole-visit record is made, the review opens
  const upload = pp.waitForRequest((r) => r.url().includes("/api/blob/upload") && r.method() === "PUT", { timeout: 30_000 });
  await pp.getByTestId("visit-end").click();
  expect((await upload).headers()["content-type"]).toBe("audio/wav");
  await pp.waitForURL(/\/p\/visit\/v3\/review$/, { timeout: 30_000 });
  await expect(pp.getByTestId("review-status")).toHaveText("等你确认");
  expect((await getJson<VisitSeen>(phone, "/api/visits/v3", s.id)).view.visit.status).toBe("review");
  await expect(eventRows(desk.page, "visit.changed").filter({ hasText: "the full record is ready, waiting for his check" })).not.toHaveCount(0, { timeout: 4000 });

  // 4. he checks the new medicine line and every answer, and confirms
  await expect(pp.getByTestId("review-chip-v3-u07")).toContainText("推断");
  await pp.getByTestId("verdict-v3-u07-right").click();
  const rights = pp.locator('[data-testid^="review-answer-"] [data-testid$="-right"]');
  // the five answers v3 holds: the new-medicine and blood-test questions, tai chi, knee, and the extra tablet (10-10)
  expect(await rights.count()).toBe(5);
  for (let i = 0; i < 5; i++) await rights.nth(i).click();
  await pp.getByTestId("review-confirm").click();
  await expect(pp.getByTestId("review-status")).toHaveText("已确认", { timeout: 10_000 });
  await expect(pp.getByTestId("review-chip-v3-u07")).toContainText("医生说");
  expect((await getJson<VisitSeen>(phone, "/api/visits/v3", s.id)).view.visit.status).toBe("confirmed");
  await expect(eventRows(desk.page, "visit.changed").filter({ hasText: "he confirmed the record" })).toHaveCount(1, { timeout: 4000 });
  await expect(eventRows(desk.page, "question.updated").filter({ hasText: "Answer saved for" })).not.toHaveCount(0);

  // 5. his question list: the answers in Dr Lim's own words, 医生说
  await pp.goto("/p/questions");
  await waitLive(pp);
  for (const [id, words] of [
    ["q-tai-chi", V3_TAI_CHI_ANSWER],
    ["q-knee-2", V3_KNEE_ANSWER],
    ["q-extra-tablet", V3_EXTRA_ANSWER],
  ] as const) {
    const row = pp.locator(`[data-testid="question"][data-question="${id}"]`);
    await expect(row, id).toHaveAttribute("data-status", "answered");
    await expect(row.getByTestId("question-answer-text"), id).toHaveText(words);
    await expect(row.getByTestId("question-answer-chip"), id).toHaveText("● 医生说");
  }
  test.info().annotations.push({ type: "answer voice", description: `clips on the answers: ${await pp.locator('[data-testid="question-answer"] [data-src]').count()} (mock: of the v3 answers only Dr Lim's extra-tablet answer has a stand-in clip)` });

  // 6. her phone: none of it while visit records are off; once he shares them, Dr Lim's answers are there
  const fp = daughter.page;
  await fp.reload();
  await waitLive(fp);
  await expect(fp.getByTestId("family-visits")).toHaveCount(0);
  expect(await fp.evaluate(() => document.body.innerText)).not.toContain(V3_KNEE_ANSWER);
  await pp.goto("/p/family");
  await waitLive(pp);
  await pp.getByTestId("grant-visit_transcripts").click();
  await expect(pp.getByTestId("grant-visit_transcripts")).toHaveAttribute("data-on", "true");
  const visits = fp.getByTestId("family-visits");
  await expect(visits).toContainText(V3_KNEE_ANSWER, { timeout: 2000 });
  await expect(visits).toContainText(V3_TAI_CHI_ANSWER);
  await expect(fp.locator('[data-testid="family-visit"][data-visit="v3"]')).toHaveCount(1);

  // 7. the next day his question about the two tablets is answered with what Dr Lim said at D42
  await at(request, s.id, 43, "10:00");
  await pp.goto("/p/today");
  await waitLive(pp);
  const seen = await askOnPhone(pp, "这两种药可以一起吃吗？");
  expect(seen.status).toBe(200);
  const quoted = pp.locator('[data-testid="answer-line"][data-source^="visit:v3:"]');
  await expect(quoted).toHaveCount(1);
  await expect(quoted.getByTestId("answer-text")).toHaveText(V3_TOGETHER_ANSWER);
  await expect(quoted.getByTestId("answer-chip")).toHaveText("● 医生说");
  await expect(quoted.getByTestId("answer-detail")).toContainText("2026年10月5日");
  await closeAll([phone, daughter, desk]);
});

// 3.9 (found 10-10 with the mock model, closed the same day; it was a test.fail() gap): at D43 「验血要空腹吗？」 was
// answered with the two leaflets' "can be taken with or without food" lines and the label (about the tablets), not with
// Dr Lim's D42 answer about the blood test, which is on his list as answered. 空腹 made it a food question, and the food
// sources filled the answer before the blood-test ones. Now fasting words alone in a blood-test question are not the
// food topic (lib/safety/topics.ts), and a test-only ask has no label or how-to-take leaflet line among its sources
// (lib/safety/candidates.ts): Dr Lim's answer comes first, no food line.
test("看诊, afterwards: the blood-test question the next day quotes Dr Lim's D42 answer, not the leaflets' food lines (3.9)", async ({ request }) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 42, story_time: "09:30", role: "patient" });
  const sid = `?session=${s.id}`;
  const post = async (path: string, data: Record<string, unknown>) => {
    const res = await request.post(`${path}${sid}`, { data });
    expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  await post("/api/visits", { mode: "replay", fixture: "v3" });
  const { duration_ms } = (await post("/api/visits/v3/replay", { speed: 20 })) as { duration_ms: number };
  await expect.poll(async () => (await getJson<VisitSeen>(request, "/api/visits/v3", s.id)).view.lines.length, { timeout: duration_ms / 20 + 20_000 }).toBe(20);
  const job = (await post("/api/asr/jobs", { visit_id: "v3" })) as { job_id: string };
  await expect.poll(async () => (await getJson<{ status: string }>(request, `/api/asr/jobs/${job.job_id}`, s.id)).status, { timeout: 20_000 }).toBe("done");
  await post("/api/visits/v3/finalize", { job_id: job.job_id });
  const { view } = await getJson<{ view: { lines: { id: string; role: string }[]; qlist: { items: { answer?: { itemId?: string } }[] } | null } }>(request, "/api/visits/v3", s.id);
  const items: Record<string, "right"> = {};
  for (const it of view.qlist?.items ?? []) if (it.answer?.itemId) items[it.answer.itemId] = "right";
  await post("/api/visits/v3/confirm", { mine: view.lines.filter((l) => l.role === "patient").map((l) => l.id), items });
  await post("/api/clock", { day: 43, time: "10:00" });
  const answer = (await post("/api/ask", { text: "验血要空腹吗？", locale: "zh-Hans", role: "patient" })) as { sentences: { sourceId: string; en: string }[] };
  expect(answer.sentences.length).toBeGreaterThan(0);
  // Dr Lim's D42 answer first (the doctor's recorded answer outranks any leaflet line), no food line, no label
  expect(answer.sentences[0].en).toBe(V3_FAST_ANSWER);
  expect(answer.sentences.map((x) => x.en)).toContain(V3_FAST_ANSWER);
  expect(answer.sentences.map((x) => x.sourceId).filter((id) => /food|^label:/.test(id))).toEqual([]);
});
