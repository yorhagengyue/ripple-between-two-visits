/**
 * Chain 14 复诊简报, end to end (docs/plan/e2e-chains.md section 14): the brief before the visit, the same numbers at the
 * visit, the questions answered there, and the next brief starting after it.
 *
 *   D41 20:00 (the day before v3), his phone (joined as 本人):
 *     1. Today -> 看诊简报: since 2 Sep (the D8 visit), 10 readings, average 140/85, 9 not below R1 (R1 word for word,
 *        医生说), 29 of 33 doses with the 4 missed all on tai chi days, the D37 note in his words, and three questions
 *        (q-extra-tablet, q-tai-chi, q-knee-2); GET /api/brief gives the same
 *   D42 09:30, the v3 visit (the sample replay):
 *     2. before the replay, that morning's brief still lists the three questions and /p/questions shows q-extra-tablet
 *        waiting (等下次看诊问) with no answer: the seed's answer is from a visit that has not happened yet (10-10; it
 *        used to read "answered" with no words, and the brief dropped it); then the check cards show the brief's numbers
 *        (R1's 135/85 line, 9 of 10 not below, 29 of 33 mornings) and the visit's question list holds the brief's three
 *     3. End visit -> review -> he confirms the answers -> the brief's three questions (q-extra-tablet, q-tai-chi,
 *        q-knee-2) answered in Dr Lim's words (q-extra-tablet since 10-10, gap 5.8 closed), and gone from the brief
 *   D43 10:00:
 *     4. the next brief starts after the visit (6 Oct): no reading yet, only today's two doses, and the three answered
 *        questions are gone from it
 * Not here: a kept copy of the D41 brief (gap 14.2, not built: there is nothing to open).
 */
import { expect, test } from "@playwright/test";
import { at, closeAll, createSession, getJson, joinAs, textBelow, waitLive, CREW_HEADERS } from "../helpers";


// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const R1 = "At home, we want it below 135 over 85.";
const NOTE_D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";

interface BriefSeen {
  brief: {
    window: { fromDay: number; toDay: number; fromDate: string };
    bp: { count: number; avgSystolic: number | null; avgDiastolic: number | null; notBelow: number | null };
    doses: { due: number; taken: number; missed: number; unconfirmed: number; missedDays: number[] };
    questions: { shown: { id: string }[]; more: number };
  };
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 41, story_time: "20:00" });
  for (const p of ["/p/today", "/p/brief", "/p/visit", "/p/questions"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
  await request.get(`/api/brief?session=${s.id}`);
});

test("复诊简报: D41 brief -> the D42 check cards say the same -> its questions asked and answered at the visit -> the next brief starts after the visit", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const s = await createSession(request, { story_day: 41, story_time: "20:00" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const pp = phone.page;

  // 1. D41: Today -> 看诊简报
  await pp.getByTestId("link-brief").click();
  const page = pp.getByTestId("page-brief");
  await expect(page).toBeVisible();
  await expect(page).toHaveAttribute("data-from", "9");
  await expect(page).toHaveAttribute("data-to", "41");
  const bp = pp.getByTestId("brief-bp");
  await expect(bp).toHaveAttribute("data-count", "10");
  await expect(bp).toHaveAttribute("data-avg", "140/85");
  await expect(bp).toHaveAttribute("data-not-below", "9");
  await expect(pp.getByTestId("brief-r1")).toContainText(R1);
  const doses = pp.getByTestId("brief-doses");
  await expect(doses).toHaveAttribute("data-due", "33");
  await expect(doses).toHaveAttribute("data-taken", "29");
  await expect(doses).toHaveAttribute("data-missed", "4");
  await expect(pp.getByTestId("brief-doses-missed")).toContainText("打太极");
  await expect(pp.getByTestId("brief-notes")).toContainText(NOTE_D37);
  const questions = pp.getByTestId("brief-question");
  await expect(questions).toHaveCount(3);
  expect(await questions.evaluateAll((els) => els.map((e) => e.getAttribute("data-question")))).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
  expect(await textBelow(pp, 18)).toEqual([]);
  const before = (await getJson<BriefSeen>(phone, "/api/brief", s.id)).brief;
  expect(before.window).toMatchObject({ fromDay: 9, toDay: 41 });
  expect(before.bp).toMatchObject({ count: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
  expect(before.doses).toMatchObject({ due: 33, taken: 29, missed: 4 });
  expect(before.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);

  // 2. D42 09:30, the visit not replayed yet: Dr Lim has not answered, so the morning brief still lists the refused
  // question and his list shows it waiting, with no answer
  await at(request, s.id, 42, "09:30");
  const morning = (await getJson<BriefSeen>(phone, "/api/brief", s.id)).brief;
  expect(morning.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
  await pp.goto("/p/brief");
  await waitLive(pp);
  await expect(questions).toHaveCount(3);
  expect(await questions.evaluateAll((els) => els.map((e) => e.getAttribute("data-question")))).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
  await pp.goto("/p/questions");
  await waitLive(pp);
  const waiting = pp.locator('[data-testid="question"][data-question="q-extra-tablet"]');
  await expect(waiting).toHaveAttribute("data-status", "open");
  await expect(waiting.getByTestId("question-status")).toHaveText("等下次看诊问");
  await expect(waiting.getByTestId("question-answer")).toHaveCount(0);

  // the v3 visit; the check cards carry the brief's numbers, its question list the brief's questions
  await pp.goto("/p/visit?replay=v3&speed=8");
  await expect(pp.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 60_000 });
  await expect(pp.getByTestId("chk-v3-u02-bars")).toHaveAttribute("data-ref", "135/85");
  await expect(pp.getByTestId("chk-v3-u02-summary")).toContainText(`平均 ${before.bp.avgSystolic}/${before.bp.avgDiastolic}`);
  await expect(pp.getByTestId("chk-v3-u02-target")).toContainText(`${before.bp.count} 次里有 ${before.bp.notBelow} 次不低于`);
  await expect(pp.getByTestId("chk-v3-u04-doses")).toContainText(`${before.doses.due} 个早上勾了 ${before.doses.taken} 个`);
  for (const id of before.questions.shown.map((q) => q.id)) await expect(pp.getByTestId(`q-q-${id}`), `${id} on the visit's list`).toBeVisible();

  // 3. End visit -> review -> he confirms the answers
  await pp.getByTestId("visit-end").click();
  await pp.waitForURL(/\/p\/visit\/v3\/review$/, { timeout: 30_000 });
  const rights = pp.locator('[data-testid^="review-answer-"] [data-testid$="-right"]');
  const n = await rights.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) await rights.nth(i).click();
  await pp.getByTestId("review-confirm").click();
  await expect(pp.getByTestId("review-status")).toHaveText("已确认", { timeout: 10_000 });
  await pp.goto("/p/questions");
  await waitLive(pp);
  for (const id of ["q-extra-tablet", "q-tai-chi", "q-knee-2"]) {
    await expect(pp.locator(`[data-testid="question"][data-question="${id}"]`), id).toHaveAttribute("data-status", "answered");
    await expect(pp.locator(`[data-testid="question"][data-question="${id}"] [data-testid="question-answer-chip"]`), id).toHaveText("● 医生说");
  }
  // the same day's brief no longer lists what the visit answered
  const afterVisit = (await getJson<BriefSeen>(phone, "/api/brief", s.id)).brief.questions.shown.map((q) => q.id);
  for (const id of ["q-extra-tablet", "q-tai-chi", "q-knee-2"]) expect(afterVisit, id).not.toContain(id);

  // 4. D43: the next brief starts after the visit: no reading yet, today's two doses only, the answered questions gone
  await at(request, s.id, 43, "10:00");
  await pp.goto("/p/today");
  await waitLive(pp);
  await pp.getByTestId("link-brief").click();
  await expect(page).toHaveAttribute("data-from", "43");
  await expect(page).toHaveAttribute("data-to", "43");
  await expect(bp).toHaveAttribute("data-count", "0");
  await expect(doses).toHaveAttribute("data-due", "2"); // amlodipine and the new losartan, D43 (window closed, no answer)
  await expect(doses).toHaveAttribute("data-taken", "0");
  await expect(pp.getByTestId("brief-notes")).not.toContainText(NOTE_D37);
  const after = (await getJson<BriefSeen>(phone, "/api/brief", s.id)).brief;
  expect(after.window).toMatchObject({ fromDay: 43, toDay: 43, fromDate: "2026-10-06" });
  expect(after.bp.count).toBe(0);
  expect(after.doses).toMatchObject({ due: 2, taken: 0, missed: 0, unconfirmed: 2 });
  const ids = after.questions.shown.map((q) => q.id);
  expect(ids).not.toContain("q-extra-tablet");
  expect(ids).not.toContain("q-tai-chi");
  expect(ids).not.toContain("q-knee-2");
  test.info().annotations.push({ type: "D43 brief questions", description: ids.join(", ") || "(none)" });
  await closeAll([phone]);
});
