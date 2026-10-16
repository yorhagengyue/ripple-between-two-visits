/**
 * Chain 5 问一句, end to end (docs/plan/e2e-chains.md section 5), the dose-change question of the hero shot:
 *
 *   D29 20:15  he types 「今天 150/95，我能不能多吃一粒？」 on Today (his phone, joined as 本人):
 *              the answer within 4 s is the doctor's own R4 (医生说, date, time point, its clip plays), the label's own
 *              words, and the referral template; no dose advice; the question goes on his list (the seeded
 *              q-extra-tablet of D29, reused, now in his own words)                    safety_event, question.updated
 *              backstage (joined as 后台): the request was blocked and why (asks to change the dose), raw JSON
 *   D41        his brief lists the question for the doctor
 *   D42        the next visit (the v3 sample replay): the question is on the visit's question list; he asks it and Dr
 *              Lim answers (v3-u18 / v3-u19, visits-script D42, added 10-10); End visit -> review -> he confirms each
 *              answer -> the questions the doctor answered, this one included, are stored as the doctor's words
 *              (医生说, 10月5日, the time point 1:34) on /p/questions
 *
 * Gap 5.8 (closed 10-10): v3 used to hold no answer to the extra-tablet question, so q-extra-tablet stayed open after the
 * visit. Dr Lim's answer is now in fixtures/visits/v3.utterances.json (and in the seed's end state); the second test below
 * checks the last link through the routes the visit screen calls.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { api, at, closeAll, createSession, eventJson, eventRows, getJson, joinAs, askOnPhone, textBelow, waitLive, CREW_HEADERS } from "../helpers";


// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const HERO_ZH = "今天 150/95，我能不能多吃一粒？";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const REFER_ZH = "改药的问题要问医生。我已经把这个问题加进下次看诊的问题单。";
const V3_TAI_CHI_ANSWER = "可以，回来再吃，每天差不多同一个时间就好。Same time every day.";
const V3_KNEE_ANSWER = "Try not to take ibuprofen regularly. It can push your blood pressure up. For the knee, paracetamol is the safer one, and we'll look at the knee properly next time.";
// Dr Lim's answer to the hero question at D42 (v3-u19, 94.772 s into the v3 replay: "1:34")
const V3_EXTRA_ANSWER =
  "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today.";
const V3_EXTRA_WHEN = "2026年10月5日 · 1:34 处";

test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/p/today", "/p/questions", "/p/brief", "/backstage", "/p/visit"]) await request.get(p, { headers: cookie });
  await api(request, "/api/ask", s.id, { text: HERO_ZH, locale: "zh-Hans" });
  await request.get(`/api/visits/v2/clip?u=v2-u08&session=${s.id}`);
  await request.get(`/api/brief?session=${s.id}`);
});

/** The status of a question on his list, read from /p/questions as his device sees it (null: not on the page). */
async function questionStatus(device: APIRequestContext, id: string): Promise<string | null> {
  const html = await (await device.get("/p/questions")).text();
  const m = new RegExp(`data-question="${id}"[^>]*data-status="([a-z_]+)"`).exec(html);
  return m ? m[1] : null;
}

/** One question card of /p/questions as his device gets it: status, the answer's chip, its words and its date line. */
async function questionCard(device: APIRequestContext, id: string): Promise<{ status: string | null; chip: string | null; answer: string | null; when: string | null } | null> {
  const html = await (await device.get("/p/questions")).text();
  const start = html.indexOf(`data-question="${id}"`);
  if (start < 0) return null;
  const card = html.slice(start, html.indexOf("</li>", start));
  const plain = (s: string | undefined) =>
    s === undefined
      ? null
      : s
          .replace(/<!-- -->/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .trim();
  return {
    status: /data-status="([a-z_]+)"/.exec(card)?.[1] ?? null,
    chip: /data-testid="question-answer" data-chip="([a-z_]+)"/.exec(card)?.[1] ?? null,
    answer: plain(/data-testid="question-answer-text"[^>]*>([\s\S]*?)<\/p>/.exec(card)?.[1]),
    when: plain(/class="rp-src"[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1]),
  };
}

test("问一句: the dose-change question -> R4 word for word + the label + the referral -> on his list -> backstage shows the block and why -> the next visit stores the doctor's answers", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");
  const pp = phone.page;

  // 1. he types the question and taps send: the whole answer within 4 s
  const seen = await askOnPhone(pp, HERO_ZH);
  expect(seen.status).toBe(200);
  expect(seen.ms, `tap -> answer ${seen.ms} ms`).toBeLessThan(4000);
  expect(seen.body?.route).toBe("refuse_route");
  // the doctor's verbatim line first, then the label, then the referral template: nothing else
  expect(seen.body?.sentences?.map((x) => x.sourceId)).toEqual(["visit:v2:R4", "label:med-amlodipine", "tpl:refer_doctor"]);
  const lines = pp.getByTestId("answer-line");
  await expect(lines).toHaveCount(3);

  const r4 = pp.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await expect(r4.getByTestId("answer-text")).toHaveText(R4);
  await expect(r4.getByTestId("answer-chip")).toHaveText("● 医生说");
  await expect(r4.getByTestId("answer-detail")).toHaveText("2026年9月1日 · 0:43 处 · 代录音");
  await expect(r4.getByTestId("answer-clip")).toHaveAttribute("data-src", `/api/visits/v2/clip?u=v2-u08&session=${s.id}`);
  await r4.getByTestId("answer-clip").click();
  await expect.poll(() => pp.evaluate(() => (window.__rpDailyClipPlays ?? []).some((p) => p.url.includes("v2-u08") && p.playing)), { timeout: 10_000 }).toBe(true);

  const label = pp.locator('[data-testid="answer-line"][data-source="label:med-amlodipine"]');
  await expect(label.getByTestId("answer-chip")).toHaveText("● 药袋");
  await expect(label.getByTestId("answer-label-original")).toHaveText("药袋原文：Take ONE tablet every MORNING");
  await expect(lines.last()).toHaveAttribute("data-source", "tpl:refer_doctor");
  await expect(lines.last().getByTestId("answer-text")).toHaveText(REFER_ZH);
  const answer = pp.getByTestId("ask-answer");
  for (const w of ["可以多吃", "180", "没关系", "不要紧", "加一粒", "两粒"]) await expect(answer).not.toContainText(w);
  expect(await textBelow(pp, 18)).toEqual([]);

  // 2. the question is on his list: the seeded D29 question, reused (never a second one), now in his own words
  expect(seen.body?.addedQuestionId).toBe("q-extra-tablet");
  expect(seen.body?.questionReused).toBe(true);
  const added = pp.getByTestId("ask-question-added");
  await expect(added).toHaveAttribute("data-question", "q-extra-tablet");
  await added.click();
  await pp.waitForURL(/\/p\/questions$/);
  const q = pp.locator('[data-testid="question"][data-question="q-extra-tablet"]');
  await expect(q).toHaveAttribute("data-status", "open");
  await expect(q).toHaveAttribute("data-wording", "own_words");
  await expect(q.getByTestId("question-text")).toHaveText(HERO_ZH);
  await expect(pp.locator('[data-testid="question"][data-origin="refused_question"]')).toHaveCount(1);

  // 3. backstage: what he asked, how it was sorted, and the blocked request with its reason; raw JSON one tap away
  await expect(eventRows(desk.page, "ask.received").getByTestId("event-sentence")).toHaveText(`Mr Tan asked on Day 29: “${HERO_ZH}”`, { timeout: 4000 });
  await expect(eventRows(desk.page, "ask.route").getByTestId("event-sentence")).toContainText("Sorted as a request that is not Ripple's to answer");
  const blocked = eventRows(desk.page, "ask.blocked").filter({ has: desk.page.getByTestId("event-badge").filter({ hasText: "Blocked · the request" }) });
  await expect(blocked).toHaveCount(1);
  await expect(blocked).toHaveAttribute("data-tone", "blocked");
  await expect(blocked.getByTestId("event-why")).toContainText("asks to change the dose");
  const raw = await eventJson(blocked);
  expect(raw).toMatchObject({ type: "ask.blocked", data: { stage: "route", request: HERO_ZH, questionId: "q-extra-tablet", replacedBy: "refer_doctor" } });
  await expect(eventRows(desk.page, "question.updated")).not.toHaveCount(0);

  // 4. D41: the brief for the doctor lists it
  await at(request, s.id, 41, "20:00");
  await pp.goto("/p/brief");
  await waitLive(pp);
  await expect(pp.locator('[data-testid="brief-question"][data-question="q-extra-tablet"]')).toHaveCount(1);
  const brief = (await getJson<{ brief: { questions: { shown: { id: string }[] } } }>(phone, "/api/brief", s.id)).brief;
  expect(brief.questions.shown.map((x) => x.id)).toContain("q-extra-tablet");

  // 5. D42: the next visit (the v3 sample replay, as the landing page and the director's beat open it)
  await at(request, s.id, 42, "09:30");
  await pp.goto("/p/visit?replay=v3&speed=8");
  await expect(pp.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 60_000 });
  // the question is on the visit's list for the doctor, and he asked it: Dr Lim's answer is the next line (v3-u19)
  await expect(pp.getByTestId("q-q-q-extra-tablet")).toBeVisible();
  await expect(pp.getByTestId("q-q-q-extra-tablet")).toHaveAttribute("data-state", "done");
  await expect(pp.getByTestId("qlist-progress")).toHaveText("5 个问题，答了 5 个");

  // End visit -> the whole-visit record -> review: he confirms every answer the visit holds
  await pp.getByTestId("visit-end").click();
  await pp.waitForURL(/\/p\/visit\/v3\/review$/, { timeout: 30_000 });
  await expect(pp.getByTestId("review-status")).toHaveText("等你确认");
  const rights = pp.locator('[data-testid^="review-answer-"] [data-testid$="-right"]');
  const n = await rights.count();
  expect(n, "answers to confirm on the review").toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) await rights.nth(i).click();
  await pp.getByTestId("review-confirm").click();
  await expect(pp.getByTestId("review-status")).toHaveText("已确认", { timeout: 10_000 });
  await expect(eventRows(desk.page, "question.updated").filter({ hasText: "Answer saved for" })).not.toHaveCount(0, { timeout: 4000 });

  // 6. his list: the questions the doctor answered at v3 hold the doctor's own words, marked 医生说; the hero question
  // too, with the date and the time point of Dr Lim's answer in the recording (gap 5.8, closed 10-10)
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
    await expect(row.getByTestId("question-answer"), id).toHaveAttribute("data-chip", "doctor");
    await expect(row.getByTestId("question-answer"), id).toHaveAttribute("data-inferred", "false");
  }
  await expect(pp.locator('[data-testid="question"][data-question="q-extra-tablet"] [data-testid="question-answer"]')).toContainText(V3_EXTRA_WHEN);
  expect(await textBelow(pp, 18)).toEqual([]);
  await closeAll([phone, desk]);
});

// 5.8 (closed 10-10; it was a test.fail() gap): v3 used to hold no exchange in which Dr Lim answers the extra-tablet
// question (5 questions, 4 answered), so the hero question of D29 was never stored as the doctor's words. Gengyue added
// his question and Dr Lim's answer to docs/plan/visits-script.md D42 (v3-u18 / v3-u19 / v3-u20 in
// fixtures/visits/v3.utterances.json). The last link, through the routes the visit screen calls: after the replay and
// his confirmation, q-extra-tablet is answered with Dr Lim's words, 医生说, and the date and time point of v3-u19.
// Before the visit (D42 08:45, 10-10) the seed's answer has not been said: the question waits with no answer line and the
// morning's brief lists it; after his confirmation the brief drops it.
test("问一句, last link: the next visit answers the dose-change question and it is stored as the doctor's words with its time point (5.8)", async ({ request }) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15", role: "patient" });
  const asked = (await api(request, "/api/ask", s.id, { text: HERO_ZH, locale: "zh-Hans", role: "patient" })) as { addedQuestionId: string };
  expect(asked.addedQuestionId).toBe("q-extra-tablet");
  const briefIds = async () => (await getJson<{ brief: { questions: { shown: { id: string }[] } } }>(request, "/api/brief", s.id)).brief.questions.shown.map((q) => q.id);
  await at(request, s.id, 42, "08:45");
  expect(await questionCard(request, "q-extra-tablet")).toEqual({ status: "open", chip: null, answer: null, when: null });
  expect(await briefIds()).toContain("q-extra-tablet");
  await at(request, s.id, 42, "09:30");
  // the v3 replay, through the same routes the visit screen calls
  await api(request, "/api/visits", s.id, { mode: "replay", fixture: "v3" });
  const { duration_ms } = (await api(request, "/api/visits/v3/replay", s.id, { speed: 20 })) as { duration_ms: number };
  await expect
    .poll(async () => (await getJson<{ view: { lines: unknown[] } }>(request, "/api/visits/v3", s.id)).view.lines.length, { timeout: duration_ms / 20 + 20_000 })
    .toBe(20);
  const job = (await api(request, "/api/asr/jobs", s.id, { visit_id: "v3" })) as { job_id: string };
  await expect.poll(async () => (await getJson<{ status: string }>(request, `/api/asr/jobs/${job.job_id}`, s.id)).status, { timeout: 20_000 }).toBe("done");
  await api(request, "/api/visits/v3/finalize", s.id, { job_id: job.job_id });
  const { view } = await getJson<{ view: { lines: { id: string; role: string }[]; qlist: { items: { answer?: { itemId?: string } }[] } | null } }>(request, "/api/visits/v3", s.id);
  const items: Record<string, "right"> = {};
  for (const it of view.qlist?.items ?? []) if (it.answer?.itemId) items[it.answer.itemId] = "right";
  await api(request, "/api/visits/v3/confirm", s.id, { mine: view.lines.filter((l) => l.role === "patient").map((l) => l.id), items });
  expect(await questionStatus(request, "q-tai-chi")).toBe("answered"); // the visit did store the answers it holds
  expect(await questionCard(request, "q-extra-tablet")).toEqual({ status: "answered", chip: "doctor", answer: V3_EXTRA_ANSWER, when: `${V3_EXTRA_WHEN} · 代录音` });
  expect(await briefIds()).not.toContain("q-extra-tablet");
});
