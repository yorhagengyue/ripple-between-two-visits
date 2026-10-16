/**
 * Chain 6 认不出的药, the input-box path (docs/plan/e2e-chains.md section 6, step 2b and gap 6.2; the photo path from the
 * relative's box to the D12 pharmacist's answer is e2e/m3-meds.spec.ts):
 *
 *   D29 20:15, his phone (joined as 本人) and backstage (joined as 后台):
 *     1. he types 「我亲戚给的宁和平压丸是什么药？」: within 4 s the fixed sentence "I'm not able to identify that
 *        medication, please check with your pharmacist." with the Mandarin line under it; nothing else; no model call
 *     2. one question for the pharmacist on his list (origin unidentified_medicine), in his own words
 *     3. backstage: sorted as "unknown med" by the rules
 *     4. English UI: the fixed sentence, without a Mandarin line
 * 6.4 (found and closed 10-10; a test.fail() gap until then): asking the same thing again that day added a second
 * pharmacist question (the hero question and the photo path reuse theirs). Now the typed ask reuses today's open
 * question for the same medicine (lib/safety/pipeline.ts sameUnknownMedicineQuestion). 6.1 (he marks the box "bring it
 * to the doctor", a question for the doctor) is not built yet.
 */
import { expect, test } from "@playwright/test";
import { api, closeAll, createSession, eventJson, eventRows, joinAs, askOnPhone, textBelow, waitLive, CREW_HEADERS } from "../helpers";


// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

const FIXED = "I'm not able to identify that medication, please check with your pharmacist.";
const FIXED_ZH = "我认不出这个药，请拿去问药剂师。";
const ASK_ZH = "我亲戚给的宁和平压丸是什么药？";
const ASK_EN = "What is Ningheping pill that my relative gave me?";

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  for (const p of ["/p/today", "/p/questions", "/backstage"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
  await api(request, "/api/ask", s.id, { text: ASK_ZH, locale: "zh-Hans" });
});

test("认不出的药 (input box): the fixed sentence word for word, one question for the pharmacist in his words, backstage unknown_med; English too", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");
  const pp = phone.page;

  // 1. the fixed sentence, then the Mandarin line; nothing else
  const seen = await askOnPhone(pp, ASK_ZH);
  expect(seen.status).toBe(200);
  expect(seen.ms, `tap -> answer ${seen.ms} ms`).toBeLessThan(4000);
  expect(seen.body?.route).toBe("unknown_med");
  expect(seen.body?.llm?.calls).toBe(0);
  expect(seen.body?.sentences?.map((x) => x.sourceId)).toEqual(["tpl:unknown_med"]);
  expect(seen.body?.sentences?.[0]?.en).toBe(FIXED);
  const line = pp.getByTestId("answer-line");
  await expect(line).toHaveCount(1);
  await expect(line.getByTestId("answer-text")).toContainText(FIXED);
  await expect(line.getByTestId("answer-text")).toContainText(FIXED_ZH);
  expect(await textBelow(pp, 18)).toEqual([]);

  // 2. the question for the pharmacist, in his words
  const qid = seen.body?.addedQuestionId;
  expect(qid).toBeTruthy();
  await pp.getByTestId("ask-question-added").click();
  await pp.waitForURL(/\/p\/questions$/);
  const q = pp.locator(`[data-testid="questions-pharmacist"] [data-testid="question"][data-question="${qid}"]`);
  await expect(q).toHaveAttribute("data-origin", "unidentified_medicine");
  await expect(q).toHaveAttribute("data-status", "open");
  await expect(q.getByTestId("question-text")).toHaveText(ASK_ZH);

  // 3. backstage: the rules sorted it as an unknown medicine (no model)
  const route = eventRows(desk.page, "ask.route").filter({ hasText: "Sorted as a medicine Ripple cannot identify" });
  await expect(route).toHaveCount(1, { timeout: 4000 });
  expect((await eventJson(route)).data).toMatchObject({ route: "unknown_med" });

  // 4. English UI: the fixed sentence alone
  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: new URL(pp.url()).origin }]);
  await pp.goto("/p/today");
  await waitLive(pp);
  const en = await askOnPhone(pp, ASK_EN);
  expect(en.body?.route).toBe("unknown_med");
  await expect(pp.getByTestId("answer-line").getByTestId("answer-text")).toHaveText(FIXED);
  await closeAll([phone, desk]);
});

// 6.4 (lib/safety/pipeline.ts step 7, found and closed 10-10; a test.fail() gap until then): the unknown-medicine route
// added a new pharmacist question every time, even for the same words on the same day, while the hero question reuses
// today's open one (unit daily/hero) and a second photo of the same box adds none (unit meds/meds). Now today's open
// unidentified_medicine question with the same words (or the same unrecognised name) is reused.
test("认不出的药: asking the same thing twice the same day keeps one question for the pharmacist (6.4)", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  try {
    const first = await askOnPhone(phone.page, ASK_ZH);
    expect(first.body?.route).toBe("unknown_med");
    expect(first.body?.addedQuestionId).toBeTruthy();
    const second = await askOnPhone(phone.page, ASK_ZH);
    expect(second.body?.route).toBe("unknown_med");
    expect(second.body?.addedQuestionId).toBe(first.body?.addedQuestionId);
    expect(second.body?.questionReused).toBe(true);
    // one question for the pharmacist on his list, in his words
    await phone.page.goto("/p/questions");
    await waitLive(phone.page);
    await expect(phone.page.locator('[data-testid="questions-pharmacist"] [data-testid="question"][data-origin="unidentified_medicine"][data-status="open"]')).toHaveCount(1);
  } finally {
    await closeAll([phone]);
  }
});
