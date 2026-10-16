/**
 * 24 示例账号整条线：从注册到看诊后的简报 (C2 track G; docs/plan/real-app.md 8.12, lines 1561-1569; section 4).
 * The design names this test `e2e/real/journey-example.spec.ts`. It is written with the recording kit, so that the same
 * walk can be recorded as an mp4, and the kit takes only files named `NN-name.journey.ts`: hence this name and place.
 *
 * ONE account that signs up choosing Mr Tan's example data, one continuous walk, in the design's order. One phone.
 * The person signs up through the app's real pages. The only developer tools used are the test clock (POST
 * /api/dev/clock) and one pass of the medicine job (POST /api/dev/tick): a person cannot move time or wait for a job.
 * Today is the server's real "today" in Singapore; every date below is worked out from it (_g/example.ts).
 *
 *   1  10:00  注册 choosing the example → Today: the real date, never 「第」 and 「天」 together; this morning's medicine
 *             is not held against him (its window closed before he started); the visit is today, 3 questions
 *   2  10:02  the brief: 33 mornings, 29 taken, the 4 missed on the two tai chi weekdays of this d0; 10 readings,
 *             average 140/85, 9 not below the doctor's 135/85; three questions
 *   3  10:05  he asks the hero line: Dr Lim's R4 word for word with its real date (d0 + 8) and its recording, the
 *             label's own line, 「你 X月X日 也问过，已经在问题单里」; no dose in the answer; his list has the same rows
 *   4  10:10  the sample visit: 「示例看诊 · 回放」 replays today's planned follow-up from its own file, labelled 示例回放 on
 *             every screen; the visit's check cards and the brief of the same moment say the same numbers; the review,
 *             one line at a time; he confirms; his three questions are answered in the doctor's own sentences
 *   5  10:40  「我的药」 has one more row, Losartan 「等药袋确认」; he takes the example's own sample label and confirms it
 *             line by line; the medicine card is there with its morning slot, the label's line and the leaflet's
 *   6  10:50  the brief after the visit: its window starts tomorrow, nothing from before the visit is counted in it;
 *             the next morning (08:45 reminder, 吃了) it counts that morning's two medicines and nothing else
 *   7         「清空，从我自己的开始」 under 我 → /onboard: no example line, no visit, no medicine, no question
 *             the leak watch (e2e/real/_leak.ts, H1 and H3) on the phone for the whole walk
 *
 * Where the built app differs from the design's list, the app is followed:
 *   - Step 1's 「今天的药『还没记』」: a 10:00 start is after this morning's window closed (09:45), so the cell is not
 *     tracked (real-app 4.4) and Today says 「早上的药，要记的话现在可以记。」 (track B's recorded decision, also asserted by
 *     14-brief.journey.ts): a calm line, never 「没记」.
 *   - Step 2's 「10 次读数」: the example holds 24 readings (days 1 to 39); the brief counts the 10 that fall in its
 *     window (the day after the second visit to today).
 *   - Step 4's 「核对卡」: no screen of an account shows the visit's check cards (the live screen only counts them in
 *     「记下了 N 件」). Their numbers are read from his own API (GET /api/visits/<id>) and compared with the brief read
 *     at the same moment, before the visit has a line. Reported by track G.
 *   - Step 4: the replay runs at 12 times its speed (/p/visit?speed=12, a parameter of the page itself), about ten
 *     seconds instead of two minutes.
 *   - Step 6: on the day of the visit the brief's window is empty (from tomorrow to today). The page says when it
 *     starts, 「上次看诊（X月d日）之后：从X月(d+1)日开始算」 (track B's fix round; it used to write the two dates as a span,
 *     which read backwards). The journey asserts that sentence, the window's dates, that nothing is counted, and the
 *     usual sentence the next morning.
 *
 * Environment. Offline (the default, what track G ran):
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7966 WHISPER_TOKEN=<any 43 characters or more> \
 *     node scripts/record/serve.mjs --port <port> --build --detach        (memory store, memory sign-in, stub model)
 *   node scripts/record/run.mjs 24 --base-url http://localhost:<port>
 * The transcription setting does not matter to this journey (the sample replay reads its own file and must run on a
 * server without any transcription service: nothing listens on 7966 here, and that is part of what is checked); it is
 * written as above so that 23 and 24 run on the same server.
 *
 * Against the real test database and the real model (the integrator):
 *   node scripts/record/serve.mjs --port <port> --no-offline
 * with web/.env pointing at the TEST project (STORE=supabase, AUTH_PROVIDER=supabase and their keys; migrations
 * 0001-0017 applied) and LLM_PROVIDER=deepseek with its key; TTS_PROVIDER as it is; RIPPLE_DEPLOYED unset; JOBS unset
 * (the journey ticks the medicine job itself); RIPPLE_DEV_TOOLS=1 (serve.mjs sets it). Then
 *   JOURNEY_MODEL=real node scripts/record/run.mjs 24 --base-url http://localhost:<port>
 * JOURNEY_MODEL=real (see _g/mode.ts) keeps every assertion the design requires with any model and drops only the
 * stub's exact output: the exact list of an answer's sentences, the exact number and order of the review's lines, the
 * exact spelling of the label's fields, 「nothing is left to ask」. With the real database and the stub model
 * (LLM_PROVIDER=mock CHECKER_PROVIDER=mock in the environment of serve.mjs), leave JOURNEY_MODEL unset.
 * Nobody else may use that server meanwhile: the test clock is one clock for the whole process, and the journey moves
 * it to tomorrow. Each run makes one account (sign-ups per address: 5 an hour, 500 with the developer tools on) and
 * deletes it at the end; a run that fails deletes it too when the phone is still open. Nothing here is offline-only:
 * no fake microphone, no stand-in service.
 */
import type { BrowserContext, Page } from "@playwright/test";
import type { VisitView } from "@/lib/visit/types";
import { LeakWatch } from "../real/_leak";
import { expect, journey } from "./_kit";
import { deleteAccount, getJson, HIS_PASSWORD, me, newLoginName, signUpThroughPages, userIdOf } from "./_g/account";
import { addDays, clearClock, setClock, sgt, sgToday, tickDoses, utcOf, zhDay } from "./_g/clock";
import { exampleDates, sampleLine } from "./_g/example";
import { settleWithin } from "./_g/leak";
import { REAL_MODEL } from "./_g/mode";
import { clipAt, sayYes, type ReviewLine } from "./_g/review";

const HERO = "今天 150/95，我能不能多吃一粒？";
const R1 = "At home, we want it below 135 over 85.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const LABEL_LINE = "Take ONE tablet every MORNING";
/** the label line's Chinese as the answer card shows it under the tag 「药袋上写着」 (the API's sentence is 「药袋上写着：每天早上吃一粒。」) */
const LABEL_LINE_ZH = "每天早上吃一粒。";
/** words that would answer "can I take one more" (tests/unit/story/example-hero.test.ts) */
const DOSE_WORDS = /可以多吃|能多吃|多吃一粒|加一粒|两粒|extra tablet|two tablets|one more|another tablet|\byes\b/i;
const THREE = ["q-extra-tablet", "q-tai-chi", "q-knee-2"];
/** how the example's records word the question he asked on day 29 (a recorded summary, not his words) */

/** The sample visit's lines he is asked about, in the order of the recording (fixtures/visits/v3.utterances.json). */
const PRESCRIBED = sampleLine("v3-u07");
const FOLLOW_UP = sampleLine("v3-u08");
const TOGETHER = sampleLine("v3-u11");
const FASTING = sampleLine("v3-u13");
const AFTER_TAI_CHI = sampleLine("v3-u15");
const KNEE = sampleLine("v3-u17");
const NO_EXTRA = sampleLine("v3-u19");
const WARNING = sampleLine("v3-u20");
/** which line answers which of his three questions (fixtures/visits/v3.expected.json; seed-account-rules.test.ts rule 8) */
const ANSWERED_BY: Record<string, { id: string; text: string; start_ms: number }> = { "q-tai-chi": AFTER_TAI_CHI, "q-knee-2": KNEE, "q-extra-tablet": NO_EXTRA };

interface DoseRow {
  medication_id: string;
  day: number;
  slot: string;
  state: string;
  created_at: string;
}
interface MedItem {
  id: string;
  status: string;
  slots: string[];
}
interface QuestionOut {
  id: string;
  text: string;
  /** whose words `text` is: "own_words", "recorded_summary" or "pattern" (lib/profile/questions.ts) */
  wording: string;
  origin: string;
  status: string;
  answer?: { text: string; speaker: string; date: string; tStartMs: number | null; inferred: boolean; visitId?: string } | null;
}
interface QuestionListOut {
  list: { open: QuestionOut[]; answered: QuestionOut[]; skipped: QuestionOut[]; counts: { open: number; answered: number; skipped: number } };
}
interface BriefOut {
  brief: {
    kind: string;
    date: string;
    window: { fromDay: number; toDay: number; fromDate: string; toDate: string; lastVisit: { id: string; date: string } | null };
    bp: { count: number; unconfirmed: number; avgSystolic: number | null; avgDiastolic: number | null; notBelow: number | null };
    targetLine: { text: string; state: string; systolic: number; diastolic: number | null; date: string } | null;
    doses: {
      due: number;
      taken: number;
      missed: number;
      unconfirmed: number;
      missedDays: number[];
      routine: { label: string; weekdays: string[]; all: boolean } | null;
      days: { day: number; date: string; weekday: string; due: number; taken: number; missed: number; unconfirmed: number }[];
      meds: { id: string }[];
    };
    notes: { date: string; text: string }[];
    questions: { shown: { id: string; text: string; origin: string }[]; more: number };
    nextVisit: { date: string; days: number } | null;
  };
}
type Card = VisitView["cards"][number];

/** The account this run has made and not yet deleted: a run that fails tidies up after itself too. */
const accounts: { context: BrowserContext; password: string }[] = [];

journey.afterEach(async () => {
  for (const m of accounts.splice(0)) await m.context.request.post("/api/me/delete", { data: { password: m.password, confirm: true } }).catch(() => undefined);
});

journey.afterAll(async ({ request }) => {
  await clearClock(request);
});

journey("24 示例账号整条线：从注册到看诊后的简报", async ({ kit, request }) => {
  journey.setTimeout(20 * 60_000);

  // ---- the days: the server's real today in Singapore is day 42 of his story
  const TODAY = sgToday();
  const TOMORROW = addDays(TODAY, 1);
  const ex = exampleDates(TODAY);
  const V1 = ex.day(0);
  const V2 = ex.day(8);
  const ASKED = ex.day(29);
  const clock = (date: string, hhmm: string) => setClock(request, sgt(date, hhmm));

  await clock(TODAY, "10:00");
  kit.cornerLabel("看诊：示例回放（代录音）");
  const { judge } = await kit.phones({ judge: "评委的手机" });
  const pp = judge.page;
  const ctx = judge.context;
  const watch = new LeakWatch();
  watch.attach(ctx, "example");
  /** the end of a step: the leak watch looks at the screen as it stands */
  const seen = async (page: Page = pp) => watch.page(page, "example");
  const login = newLoginName("judge");
  await pp.goto("/");

  const questions = async () => (await getJson<QuestionListOut>(ctx, "/api/questions")).list;
  const meds = async (): Promise<MedItem[]> => (await getJson<{ groups: { items: MedItem[] }[] }>(ctx, "/api/meds")).groups.flatMap((g) => g.items);
  const brief = async () => (await getJson<BriefOut>(ctx, "/api/brief")).brief;
  const doseRows = async (from: number, to: number): Promise<DoseRow[]> => (await getJson<{ doses: DoseRow[] }>(ctx, `/api/doses?from=${from}&to=${to}`)).doses;

  // =================================================================== 1. sign-up with the example, Today
  await kit.step(pp, "评委第一次打开 Ripple，在欢迎页点「注册」");
  await expect(pp.getByTestId("front-door-signup")).toHaveText("注册");
  // the app opens as the iOS app does (line fe-entry): the cold start's black screen with the mark drawing itself in
  // lies over the welcome for about 3.6 s and ends by itself; the welcome's buttons are his when it is gone
  await expect(pp.locator('[data-rp="splash"]')).toBeHidden({ timeout: 20_000 });
  await seen();
  await pp.getByTestId("front-door-signup").click();
  // 「注册」 leads to 「你是哪一位？」: the example is the elder's side, so he says he is the elder
  await expect(pp).toHaveURL(/\/who\?do=signup$/);
  await kit.step(pp, "先问是哪一位：示例资料是长辈这一边的，点「我是长辈」");
  await expect(pp.getByTestId("who").getByRole("heading", { level: 1 })).toHaveText("你是哪一位？");
  await expect(pp.getByTestId("who-elder")).toContainText("我是长辈");
  await seen();
  await pp.getByTestId("who-elder").click();
  await expect(pp).toHaveURL(/\/signup\?as=elder$/);

  const signedUp = await signUpThroughPages(kit, judge, { name: "评委", login, password: HIS_PASSWORD, space: "example", afterStep: seen });
  await pp.waitForURL("**/p/today");
  accounts.push({ context: ctx, password: HIS_PASSWORD });
  watch.addId("his user id (his scope id)", await userIdOf(ctx));
  const mine = await me(ctx);
  expect(mine.status).toBe(200);
  expect(mine.body).toMatchObject({ account: { login, display_name: "评委", login_kind: "username" }, scope: { example_data: true, onboarding: "done" } });
  expect(JSON.stringify(mine.body)).not.toContain(signedUp.recoveryCode);

  await kit.step(pp, "示例资料按今天铺好：页头是真实日期，不写第几天");
  await expect(pp.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
  const header = pp.locator('[data-rp="meta"]').first();
  await expect(header).toContainText(zhDay(TODAY));
  // 「页头没有『第』『天』连在一起」, and nowhere else on the page either
  await expect(header).not.toContainText(/第\s*\d*\s*天/);
  await expect(pp.locator("body")).not.toContainText(/第\s*\d+\s*天|Day\s?\d+/);
  await expect(pp.locator('[data-rp="example-line"]')).toContainText("示例资料：陈先生（虚构人物）");
  const intro = pp.locator('[data-rp="example-intro"]');
  await expect(intro).toContainText("他 6 周前第一次看医生，后来开了降压药，今天要去复诊。");
  await seen();
  await pp.locator('[data-action="example-intro-dismiss"]').click();
  await expect(intro).toHaveCount(0);

  await kit.step(pp, "今早的药在他注册前就过了时间：不算没记");
  const doseHeadline = pp.getByTestId("dose-headline");
  // 10:00 is after this morning's window closed (09:45): the cell is not tracked, and nothing says 「没记」
  await expect(doseHeadline).toHaveAttribute("data-why", "untracked");
  await expect(doseHeadline).toHaveText("早上的药，要记的话现在可以记。");
  expect(await doseRows(42, 42), "nothing is laid out on today").toEqual([]);
  const countdown = pp.getByTestId("countdown-section");
  await expect(countdown).toHaveAttribute("data-days", "0");
  await expect(pp.getByTestId("countdown-when")).toHaveText("今天");
  await expect(pp.getByTestId("countdown-questions")).toHaveText("3 个");
  await expect(pp.getByTestId("countdown-brief")).toHaveText("今天看医生 · 简报准备好了");
  await kit.show(countdown);
  await seen();

  // =================================================================== 2. the brief before the visit
  await clock(TODAY, "10:02");
  await kit.step(pp, "点「简报」：从上次看诊第二天到今天，都是真实日期");
  await pp.getByTestId("countdown-brief").click();
  const briefPage = pp.getByTestId("page-brief");
  await expect(briefPage).toHaveAttribute("data-scope", "account");
  await expect(briefPage).toHaveAttribute("data-from", ex.day(9));
  await expect(briefPage).toHaveAttribute("data-to", TODAY);
  await expect(pp.getByTestId("brief-window")).toHaveText(`上次看诊（${zhDay(V2)}）之后：${zhDay(ex.day(9))}到${zhDay(TODAY)}`);
  await expect(briefPage).not.toContainText(/第\s*\d+\s*天|Day\s?\d+/);
  await seen();

  await kit.step(pp, "血压记了 10 次，平均 140/85，旁边是医生的原话");
  const briefBp = pp.getByTestId("brief-bp");
  // the example holds 24 readings (days 1 to 39); these are the 10 in the brief's window
  await expect(briefBp).toHaveAttribute("data-count", "10");
  await expect(briefBp).toHaveAttribute("data-avg", "140/85");
  await expect(briefBp).toHaveAttribute("data-not-below", "9");
  await expect(briefBp).toContainText("记了 10 次，平均 140/85");
  await expect(pp.getByTestId("brief-bp-mirror")).toHaveText(`其中 9 次不低于医生 ${zhDay(V1)} 说的 135/85`);
  const briefTarget = pp.getByTestId("brief-target");
  await expect(briefTarget).toHaveAttribute("data-state", "confirmed");
  await expect(briefTarget).toContainText(`“${R1}”`);
  await expect(briefTarget).toContainText(`${V1.slice(0, 4)}年${zhDay(V1)}`);
  await kit.show(briefBp);
  await seen();

  await kit.step(pp, `33 个早上吃了 29 个，没吃的 4 个都在${ex.taiChiZh}`);
  const briefDoses = pp.getByTestId("brief-doses");
  await expect(briefDoses).toHaveAttribute("data-due", "33");
  await expect(briefDoses).toHaveAttribute("data-taken", "29");
  await expect(briefDoses).toHaveAttribute("data-missed", "4");
  await expect(briefDoses).toHaveAttribute("data-unconfirmed", "0");
  await expect(briefDoses).toContainText("33 次里吃了 29 次");
  await expect(pp.getByTestId("brief-doses-missed")).toHaveText(`没吃的 4 次都在${ex.taiChiZh}（打太极的早上）：${ex.missedZh}`);
  await kit.show(briefDoses);
  const before = await brief();
  expect(before).toMatchObject({ kind: "account", date: TODAY, window: { fromDay: 9, toDay: 42, fromDate: ex.day(9), toDate: TODAY, lastVisit: { id: "v2", date: V2 } } });
  expect({ due: before.doses.due, taken: before.doses.taken, missed: before.doses.missed, unconfirmed: before.doses.unconfirmed }).toEqual({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
  expect(before.doses.missedDays).toEqual([15, 17, 24, 36]);
  expect(before.doses.routine).toMatchObject({ label: "Tai chi", weekdays: ex.taiChi, all: true });
  expect(before.doses.days.filter((d) => d.missed > 0).map((d) => d.date)).toEqual(ex.missedDates);
  expect(new Set(before.doses.days.filter((d) => d.missed > 0).map((d) => d.weekday))).toEqual(new Set(ex.taiChi));
  expect(before.bp).toMatchObject({ count: 10, unconfirmed: 0, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
  expect(before.targetLine).toMatchObject({ text: R1, state: "confirmed", systolic: 135, diastolic: 85, date: V1 });
  expect(before.notes.map((n) => n.date)).toEqual([ex.day(20), ex.day(37)]);
  // today's planned follow-up is not a visit that happened: it is the next one
  expect(before.nextVisit).toMatchObject({ date: TODAY, days: 0 });
  await seen();

  await kit.step(pp, "要问医生的三个问题，漏吃的那条写着真实日期");
  const briefQuestions = pp.getByTestId("brief-questions");
  await expect(briefQuestions).toHaveAttribute("data-count", "3");
  for (const [i, id] of THREE.entries()) await expect(briefQuestions.getByTestId("brief-question").nth(i)).toHaveAttribute("data-question", id);
  await expect(briefQuestions.locator('[data-question="q-tai-chi"]')).toContainText(`我漏吃的 4 个早上都在打太极的日子（${ex.taiChiZh}）：${ex.missedZh}。`);
  expect(before.questions.shown.map((q) => q.id)).toEqual(THREE);
  expect(before.questions.more).toBe(0);
  await kit.show(briefQuestions);
  const listBefore = await questions();
  expect(listBefore.open.map((q) => q.id)).toEqual(THREE);
  expect(listBefore.counts).toMatchObject({ open: 3, answered: 3, skipped: 0 });
  await seen();

  // =================================================================== 3. the hero line
  await clock(TODAY, "10:05");
  await pp.goto("/p/today");
  await kit.step(pp, "回到今天页，点「可以这样问」那一行，再点第一句");
  // the three sentences are on the ask screen (the timeline design's 22-2); Today keeps one row that leads there
  await pp.locator('[data-action="example-asks-open"]').click();
  await pp.waitForURL("**/p/ask");
  const asks = pp.locator('[data-action="example-ask"]');
  await expect(asks).toHaveCount(3);
  await kit.show(pp.locator('[data-rp="example-asks"]'));
  await asks.first().click();
  await expect(pp.getByTestId("ask-input")).toHaveValue(HERO);
  await seen();

  await kit.step(pp, "问这句：不答剂量，先给 Dr Lim 的原话和真实日期");
  const askAnswered = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
  await pp.getByTestId("ask-field").locator('button[type="submit"]').click();
  const askRes = await askAnswered;
  expect(askRes.status()).toBe(200);
  const askBody = (await askRes.json()) as { route?: string; routeReason?: string; sentences?: { sourceId: string; en?: string; zh?: string | null }[] };
  // refused by the dose-change rule, whatever the model: no dose advice
  expect(askBody.route).toBe("refuse_route");
  expect(askBody.routeReason).toBe("rule:dose_change");
  const sources = (askBody.sentences ?? []).map((s) => s.sourceId);
  if (REAL_MODEL) for (const need of ["visit:v2:R4", "label:med-amlodipine"]) expect(sources).toContain(need);
  else expect(sources).toEqual(["visit:v2:R4", "label:med-amlodipine", "tpl:refer_doctor"]);
  expect((askBody.sentences ?? []).flatMap((s) => [s.en ?? "", s.zh ?? ""]).join("\n")).not.toMatch(DOSE_WORDS);
  await pp.waitForURL("**/p/ask");
  const turn = pp.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(turn).toHaveAttribute("data-route", "refuse_route");
  const r4 = turn.locator('[data-testid="answer-line"][data-source="visit:v2:R4"]');
  await kit.show(r4);
  await expect(r4.locator('[data-rp="said"]')).toContainText(R4);
  await expect(r4.locator('[data-rp="source-tag"]')).toContainText("医生说");
  // the second visit's real date (d0 + 8) and the time point in its recording
  await expect(r4.locator('[data-rp="source-tag"]')).toContainText(`${zhDay(V2)} · 0:43`);
  for (const w of ["可以多吃", "没关系", "不要紧", "加一粒", "两粒"]) await expect(turn).not.toContainText(w);
  await seen();

  await kit.step(pp, "点「听原声」：这句是 Dr Lim 说的（代录音）");
  const clip = r4.getByTestId("answer-clip");
  await expect(clip).toHaveAttribute("data-src", "/api/visits/v2/clip?u=v2-u08");
  await clip.click();
  await kit.waitForAudio("v2-u08", { until: "ended", timeout: 30_000 });

  await kit.step(pp, "再引药袋上的原文；这个问题早就在问题单里");
  const labelLine = turn.locator('[data-testid="answer-line"][data-source="label:med-amlodipine"]');
  await expect(labelLine).toContainText("药袋上写着");
  await expect(labelLine).toContainText(LABEL_LINE);
  await expect(labelLine).toContainText(LABEL_LINE_ZH);
  expect(askBody.sentences?.find((s) => s.sourceId === "label:med-amlodipine")).toMatchObject({ en: LABEL_LINE, zh: `药袋上写着：${LABEL_LINE_ZH}` });
  await kit.show(labelLine);
  const onList = turn.getByTestId("ask-question-added");
  await expect(onList).toHaveAttribute("data-question", "q-extra-tablet");
  await expect(onList).toHaveAttribute("data-reused", "true");
  await expect(onList).toHaveAttribute("data-asked", ASKED);
  await expect(onList).toContainText(`你 ${zhDay(ASKED)} 也问过，已经在问题单里`);
  await kit.show(onList);
  // his list has the same rows as before he asked, and the brief still shows the same three
  const listAfterAsk = await questions();
  expect(listAfterAsk.open.map((q) => q.id)).toEqual(THREE);
  expect(listAfterAsk.counts).toMatchObject({ open: 3, answered: 3, skipped: 0 });
  await seen();

  // =================================================================== 4. the sample visit
  await clock(TODAY, "10:10");
  // the brief of this moment, read before the visit has a line (afterwards the brief counts from the visit)
  const atVisit = await brief();
  expect(atVisit.questions.shown.map((q) => q.id)).toEqual(THREE);
  await pp.goto("/p/visit?speed=12");
  await kit.step(pp, "看诊页：今天的复诊还在计划里，下面有示例看诊的回放");
  await expect(pp.getByTestId("visit-where")).toBeVisible();
  await expect(pp.getByTestId("visit-planned")).toContainText("今天的复诊（计划）");
  const sample = pp.getByTestId("visit-sample");
  await expect(sample).toContainText("陈先生今天的复诊，录好的示例，不是你的看诊。");
  await expect(pp.getByTestId("visit-sample-start")).toHaveText("示例看诊 · 回放");
  await kit.show(sample);
  await seen();

  await kit.step(pp, "点「示例看诊 · 回放」：字幕来自录好的示例，标着示例回放");
  await pp.getByTestId("visit-sample-start").click();
  const live = pp.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "replay");
  // it is today's planned follow-up itself, not a new visit
  await expect(live).toHaveAttribute("data-visit", "v3");
  await expect(pp.getByTestId("visit-sample-label")).toHaveText("示例回放");
  await expect(live).toContainText("示例回放：字幕来自录好的示例。");
  await expect(pp.getByTestId("visit-captions")).toBeVisible({ timeout: 20_000 });
  await seen();
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  const visitView = async (): Promise<VisitView> => (await getJson<{ view: VisitView }>(ctx, "/api/visits/v3")).view;

  await kit.step(pp, "回放里的核对数字，和刚才那份简报是同一组数");
  const replayed = await visitView();
  expect(replayed.visit).toMatchObject({ id: "v3", date: TODAY, status: "recording" });
  expect(replayed.lines).toHaveLength(20);
  const checks = replayed.cards.filter((c: Card) => c.kind === "chk") as unknown as Record<string, unknown>[];
  const medCheck = checks.find((c) => c.check === "med")!;
  const bpCheck = checks.find((c) => c.check === "bp")!;
  expect(medCheck, "the visit has a check card for his medicines").toBeTruthy();
  expect(bpCheck, "the visit has a check card for his readings").toBeTruthy();
  // 「核对卡和简报同数」 (4.4, rule 5): the card's numbers are the brief's of the same moment, over the same dates
  expect({ due: medCheck.total, taken: medCheck.taken, missed: medCheck.missed, unconfirmed: medCheck.unconfirmed }).toEqual({ due: atVisit.doses.due, taken: atVisit.doses.taken, missed: atVisit.doses.missed, unconfirmed: atVisit.doses.unconfirmed });
  expect({ due: medCheck.total, taken: medCheck.taken, missed: medCheck.missed, unconfirmed: medCheck.unconfirmed }).toEqual({ due: 33, taken: 29, missed: 4, unconfirmed: 0 });
  expect(medCheck.missedDays).toEqual(atVisit.doses.missedDays);
  expect(medCheck.routine).toMatchObject({ label: "Tai chi", days: ex.taiChi });
  expect([medCheck.fromDate, medCheck.toDate]).toEqual([atVisit.window.fromDate, atVisit.window.toDate]);
  expect({ count: bpCheck.recorded, avgSystolic: bpCheck.avgSystolic, avgDiastolic: bpCheck.avgDiastolic, notBelow: bpCheck.notBelow }).toEqual({ count: atVisit.bp.count, avgSystolic: atVisit.bp.avgSystolic, avgDiastolic: atVisit.bp.avgDiastolic, notBelow: atVisit.bp.notBelow });
  expect({ count: bpCheck.recorded, avgSystolic: bpCheck.avgSystolic, avgDiastolic: bpCheck.avgDiastolic, notBelow: bpCheck.notBelow }).toEqual({ count: 10, avgSystolic: 140, avgDiastolic: 85, notBelow: 9 });
  expect([bpCheck.fromDate, bpCheck.toDate]).toEqual([atVisit.window.fromDate, atVisit.window.toDate]);
  const noted = pp.getByTestId("visit-noted");
  await expect(noted).toHaveAttribute("data-count", String(replayed.counts.doc + replayed.counts.toConfirm + replayed.counts.chk));
  await kit.show(noted);
  await seen();

  await kit.step(pp, "点「录完了」：进回顾，每一屏都标着示例回放");
  await clock(TODAY, "10:20");
  await pp.getByTestId("visit-stop").click();
  await pp.waitForURL(/\/p\/visit\/v3\/review$/, { timeout: 90_000 });
  const one = pp.getByTestId("review-one");
  await expect(one).toBeVisible({ timeout: 60_000 });
  await expect(pp.getByTestId("review-sample")).toHaveText("示例回放");
  await expect(pp.getByTestId("review-banner")).toContainText("陈先生的示例看诊，不是你的看诊。");
  const record = await visitView();
  expect(record.visit.status).toBe("review");
  // no recording of anybody was made or kept: the transcript is the sample's own file
  expect(record.visit.audioPath).toBeNull();
  expect(record.lines.map((l) => [l.id, l.tStartMs, l.text])).toEqual(Array.from({ length: 20 }, (_, i) => sampleLine(`v3-u${String(i + 1).padStart(2, "0")}`)).map((l) => [l.id, l.start_ms, l.text]));
  await seen();

  const listNow = await questions();
  const wording = (id: string) => listNow.open.find((q) => q.id === id)!.text;
  // whose words a question is, as his list has it: only his own are shown as 「你问：」 (lib/daily/questions.ts)
  const asked = (id: string) => ({ asked: wording(id), own: listNow.open.find((q) => q.id === id)!.wording === "own_words" });
  expect(wording("q-extra-tablet")).toBe(HERO);
  expect([asked("q-tai-chi").own, asked("q-knee-2").own, asked("q-extra-tablet").own]).toEqual([false, true, true]);
  const QUEUE: ReviewLine[] = [
    PRESCRIBED,
    FOLLOW_UP,
    TOGETHER,
    FASTING,
    // Ripple worded this one from his records: 「问题单上：」
    { ...AFTER_TAI_CHI, ...asked("q-tai-chi") },
    // he wrote this one himself: 「你问：」
    { ...KNEE, ...asked("q-knee-2") },
    // the example kept only a summary of this one until he typed it himself today (step 3): the review shows his own
    // words now, as his list does (track G reported the summary under 「你问：」; track F's fix round 3 changed it)
    { ...NO_EXTRA, ...asked("q-extra-tablet") },
    WARNING,
  ];
  const captions = [
    "一次认一句：医生加开 Losartan，他点「是」",
    "两周后验血、六周后回来复诊：是，医生说的",
    "两种药可以一起吃：是，医生说的",
    "验血不用空腹：是，医生说的",
    "打完太极回来再吃：这是他问题单上那条的回答",
    "膝盖止痛药那条，医生也当场回答了",
    "「能不能多吃一粒」：医生说不要自己加",
    "超过 180 或胸痛就打 995：是，医生说的",
  ];
  await sayYes(pp, QUEUE, {
    beforeYes: async (_l, i) => {
      await kit.step(pp, captions[i]);
      await expect(pp.getByTestId("review-sample")).toHaveText("示例回放");
    },
    afterEach: seen,
  });
  const summary = pp.getByTestId("review-summary");
  await expect(summary).toBeVisible();
  if (!REAL_MODEL) {
    await expect(summary.getByTestId("review-row")).toHaveCount(QUEUE.length);
    await expect(summary.locator('[data-testid="review-row"][data-verdict="right"]')).toHaveCount(QUEUE.length);
  }
  for (const l of QUEUE) await expect(summary.locator('[data-testid="review-row"][data-verdict="right"]', { hasText: l.text })).toHaveCount(1);

  await kit.step(pp, "点「就这样，存好」：记录确认，复诊排在六周后");
  await expect(pp.getByTestId("review-sample")).toHaveText("示例回放");
  await seen();
  await kit.show(pp.getByTestId("review-save"));
  await pp.getByTestId("review-save").click();
  await expect(summary).toHaveAttribute("data-status", "confirmed");
  await expect(pp.getByTestId("review-sample")).toHaveText("示例回放");
  const followUp = pp.getByTestId("review-follow-up");
  await expect(followUp).toHaveAttribute("data-date", addDays(TODAY, 42));
  await expect(followUp).toContainText(`大约 ${zhDay(addDays(TODAY, 42))}`);
  const confirmed = await visitView();
  expect(confirmed.visit.status).toBe("confirmed");
  const rowsOf = (text: string) => confirmed.cards.flatMap((c) => (c.kind === "doc" && c.quote === text ? c.rows : [])).map((r) => [r.variant, r.drug ?? null, r.verdict]);
  expect(rowsOf(PRESCRIBED.text)).toEqual([
    ["med", "amlodipine", "right"],
    ["new_med", "losartan", "right"],
  ]);
  expect(rowsOf(FOLLOW_UP.text)).toEqual([
    ["follow_up", null, "right"],
    ["test", null, "right"],
  ]);
  expect(rowsOf(WARNING.text)).toEqual([
    ["threshold", null, "right"],
    ["how_to_measure", null, "right"],
  ]);
  for (const l of QUEUE) expect(confirmed.lines.find((x) => x.text === l.text), l.text).toMatchObject({ role: "doctor", roleState: "confirmed" });
  await seen();

  await kit.step(pp, "问题单上那三条都回答了，存的是医生的原话");
  // rule 8: answered, the doctor's own sentence, its speaker, the visit's real date and the time point in the recording
  const afterVisit = await questions();
  for (const id of THREE) {
    const line = ANSWERED_BY[id];
    const q = afterVisit.answered.find((x) => x.id === id);
    expect(q, `${id} is answered`).toBeTruthy();
    expect(q!.answer, id).toMatchObject({ text: line.text, speaker: "doctor", inferred: false, date: TODAY, tStartMs: line.start_ms, visitId: "v3" });
  }
  expect(THREE.map((id) => afterVisit.answered.find((q) => q.id === id)!.answer!.tStartMs)).toEqual([94772, 65166, 74142]);
  if (!REAL_MODEL) {
    // nothing is left to ask: the three, the three answered at earlier visits, and the two Ripple raised at this visit
    expect(afterVisit.open).toEqual([]);
    expect(afterVisit.counts).toMatchObject({ open: 0, answered: 8, skipped: 0 });
  }
  await pp.goto("/p/questions/answered");
  for (const id of THREE) {
    const line = ANSWERED_BY[id];
    const answerBlock = pp.locator(`[data-rp="question"][data-question="${id}"] [data-rp="question-answer"]`);
    await expect(answerBlock).toHaveAttribute("data-speaker", "doctor");
    await expect(answerBlock).toHaveAttribute("data-inferred", "false");
    await expect(answerBlock.locator('[data-rp="said"]')).toHaveText(line.text);
    await expect(answerBlock.locator('[data-rp="source-tag"]')).toContainText("医生说");
    await expect(answerBlock.locator('[data-rp="source-tag"]')).toContainText(`${zhDay(TODAY)} · ${clipAt(line.start_ms)}`);
  }
  await kit.show(pp.locator('[data-rp="question"][data-question="q-extra-tablet"] [data-rp="question-answer"]'));
  await seen();

  // =================================================================== 5. losartan waits for its label
  await clock(TODAY, "10:40");
  await pp.goto("/p/meds");
  await kit.step(pp, "「我的药」多了一行 Losartan，等药袋确认");
  const losartanRow = pp.getByTestId("med-row-med-losartan");
  await expect(losartanRow).toHaveAttribute("data-status", "awaiting_label");
  await expect(losartanRow).toContainText("等药袋确认");
  expect((await meds()).map((m) => [m.id, m.status, m.slots]).sort()).toEqual([
    ["med-amlodipine", "label_confirmed", ["morning"]],
    ["med-ibuprofen", "label_confirmed", []],
    ["med-losartan", "awaiting_label", []],
    ["med-relative-box", "unidentified", []],
  ]);
  await kit.show(losartanRow);
  await seen();

  await kit.step(pp, "点「拍 Losartan 的药袋」：示例账号有一张示例药袋");
  await pp.getByTestId("meds-photo-awaiting").click();
  await expect(pp.getByTestId("add-photo")).toBeVisible();
  await expect(pp.getByTestId("add-photo")).toContainText("拍 Losartan 的药袋");
  const samples = pp.locator('[data-testid^="add-sample-"]');
  await expect(samples).toHaveCount(4);
  // the medicine that waits for its label comes first
  await expect(samples.first()).toHaveAttribute("data-testid", "add-sample-losartan");
  await seen();
  await pp.getByTestId("add-sample-losartan").click();
  const check = pp.getByTestId("add-check");
  await expect(check).toBeVisible({ timeout: 30_000 });

  await kit.step(pp, "药名、规格、用法、日期、诊所，逐行点「对」");
  const value = pp.getByTestId("add-check-value");
  if (REAL_MODEL) {
    // a real model reads the picture in its own spelling: the medicine's name must be there, every line is confirmed
    await expect(value).toContainText(/losartan/i);
    for (let i = 0; i < 12 && (await check.count()) > 0; i++) {
      const index = await check.getAttribute("data-index");
      await pp.getByTestId("add-line-right").click();
      await expect.poll(async () => (await check.count()) === 0 || (await check.getAttribute("data-index", { timeout: 500 }).catch(() => null)) !== index).toBe(true);
    }
  } else {
    await expect(check).toHaveAttribute("data-total", "5");
    // the date line: the sample picture carries one printed date (the template's own day 42, 5 Oct 2026), whatever
    // today is; on an account it is then not the day of the visit that prescribed the medicine. Reported by track G;
    // here only that the line is a date
    for (const [field, text] of [
      ["drug_text", "LOSARTAN 50MG TABLET"],
      ["strength", "50 mg"],
      ["directions", "Take ONE tablet every MORNING"],
      ["dispensed", /\d{1,2}月\d{1,2}日/],
      ["clinic", "Blossom Family Clinic"],
    ] as const) {
      await expect(value).toHaveAttribute("data-field", field);
      await expect(value).toContainText(text);
      await pp.getByTestId("add-line-right").click();
      await kit.pause(400);
    }
  }
  const added = pp.getByTestId("add-done");
  await expect(added).toBeVisible({ timeout: 30_000 });
  await expect(added).toHaveAttribute("data-status", "label_confirmed");
  await expect(added).toHaveAttribute("data-med", "med-losartan");
  await expect(added).toContainText("早上吃");
  expect((await meds()).map((m) => [m.id, m.status, m.slots]).sort()).toEqual([
    ["med-amlodipine", "label_confirmed", ["morning"]],
    ["med-ibuprofen", "label_confirmed", []],
    ["med-losartan", "label_confirmed", ["morning"]],
    ["med-relative-box", "unidentified", []],
  ]);
  await seen();

  await kit.step(pp, "药卡出来了：早上吃，用法是药袋上的原文");
  await pp.getByTestId("add-open-card").click();
  const card = pp.getByTestId("med-card");
  await expect(card).toHaveAttribute("data-status", "label_confirmed");
  await expect(pp.locator("body")).toContainText("Losartan 50 mg");
  await expect(pp.locator("body")).toContainText("医生开的");
  await expect(pp.getByTestId("med-slots")).toHaveAttribute("data-source", "label");
  await expect(pp.getByTestId("med-slots")).toContainText("早上吃");
  // 「为什么吃」: the sample visit has no sentence of the doctor's that gives the new medicine's purpose, so the card
  // shows the official leaflet's line under its source (never a sentence of the app's own)
  await expect(pp.getByTestId("card-purpose")).toContainText("单张写着");
  await expect(pp.getByTestId("card-purpose")).toContainText("healthhub.sg");
  await expect(pp.getByTestId("card-how-to-take")).toContainText("药袋上写着");
  await expect(pp.getByTestId("card-how-to-take")).toContainText("Take ONE tablet every MORNING");
  await kit.show(pp.getByTestId("card-purpose"));
  await seen();

  // =================================================================== 6. the brief after the visit
  await clock(TODAY, "10:50");
  await pp.goto("/p/brief");
  await kit.step(pp, "看诊以后的简报从明天算起：看诊前的都不再算进来");
  await expect(briefPage).toHaveAttribute("data-scope", "account");
  // the window starts the day after today's visit; until tomorrow it is empty (see the header: how the page words it)
  await expect(briefPage).toHaveAttribute("data-from", TOMORROW);
  await expect(briefPage).toHaveAttribute("data-to", TODAY);
  // the day of the visit the period has no day yet: the line says when it starts (it used to read 「明天到今天」)
  await expect(pp.getByTestId("brief-window")).toHaveText(`上次看诊（${zhDay(TODAY)}）之后：从${zhDay(TOMORROW)}开始算`);
  await expect(briefBp).toHaveAttribute("data-count", "0");
  await expect(briefBp).toContainText("这段时间没有读数。");
  await expect(briefDoses).toHaveAttribute("data-due", "0");
  await expect(briefDoses).toContainText("这段时间没有要吃的药。");
  await expect(briefPage).not.toContainText("33 次里吃了 29 次");
  await expect(briefPage).not.toContainText(/第\s*\d+\s*天|Day\s?\d+/);
  const sameDay = await brief();
  expect(sameDay).toMatchObject({ date: TODAY, window: { fromDay: 43, toDay: 42, fromDate: TOMORROW, toDate: TODAY, lastVisit: { id: "v3", date: TODAY } } });
  expect({ due: sameDay.doses.due, taken: sameDay.doses.taken, missed: sameDay.doses.missed, unconfirmed: sameDay.doses.unconfirmed }).toEqual({ due: 0, taken: 0, missed: 0, unconfirmed: 0 });
  expect(sameDay.doses.days).toEqual([]);
  expect(sameDay.bp).toMatchObject({ count: 0, avgSystolic: null, avgDiastolic: null });
  // the doctor's number is still the one he gave at the first visit; the next visit is the follow-up in six weeks
  expect(sameDay.targetLine).toMatchObject({ text: R1, state: "confirmed", date: V1 });
  expect(sameDay.nextVisit).toMatchObject({ date: addDays(TODAY, 42), days: 42 });
  if (!REAL_MODEL) {
    await expect(briefQuestions).toHaveAttribute("data-count", "0");
    expect(sameDay.questions.shown).toEqual([]);
  }
  for (const id of THREE) expect(sameDay.questions.shown.map((q) => q.id)).not.toContain(id);
  await seen();

  await kit.step(pp, "第二天 8:45 提醒：两种药各自记，他两个都点「吃了」");
  await clock(TOMORROW, "08:45");
  expect((await tickDoses(request)).first).toBeGreaterThanOrEqual(1);
  const reminders = (await getJson<{ recent: { kind: string; slot: string; date: string; sent_at: string }[] }>(ctx, "/api/push")).recent.filter((r) => r.kind.startsWith("dose_"));
  expect(reminders.map((r) => [r.kind, r.slot, r.date, r.sent_at])).toEqual([["dose_first", "morning", TOMORROW, utcOf(TOMORROW, "08:45")]]);
  await pp.goto("/p/today?remind=dose-morning");
  await expect(doseHeadline).toHaveText("早上的药，还没记。");
  await expect(pp.getByTestId("dose-med-med-amlodipine")).toContainText("Amlodipine 5 mg");
  await expect(pp.getByTestId("dose-med-med-losartan")).toContainText("Losartan 50 mg");
  await expect(pp.getByText(zhDay(TOMORROW)).first()).toBeVisible();
  await clock(TOMORROW, "08:50");
  // two medicines in the slot: each is answered by itself (the timeline draft's 02-7), then the slot is one entry
  for (const med of ["med-amlodipine", "med-losartan"]) {
    await pp.getByTestId(`dose-taken-${med}`).click();
    await expect(pp.getByTestId(`dose-taken-${med}`)).toHaveCount(0);
  }
  await expect(pp.getByTestId("dose-row-morning")).toHaveAttribute("data-state", "taken");
  await expect(pp.getByTestId("dose-row-morning")).toContainText("早上 · 8:50 记的");
  await expect
    .poll(async () => (await doseRows(43, 43)).map((r) => `${r.medication_id} ${r.slot} ${r.state}@${r.created_at}`).sort())
    .toEqual([`med-amlodipine morning taken@${utcOf(TOMORROW, "08:50")}`, `med-losartan morning taken@${utcOf(TOMORROW, "08:50")}`]);
  await seen();

  await clock(TOMORROW, "09:00");
  await pp.goto("/p/brief");
  await kit.step(pp, "这天的简报只有今早这两格：2 次里吃了 2 次");
  await expect(briefPage).toHaveAttribute("data-from", TOMORROW);
  await expect(briefPage).toHaveAttribute("data-to", TOMORROW);
  await expect(pp.getByTestId("brief-window")).toHaveText(`上次看诊（${zhDay(TODAY)}）之后：${zhDay(TOMORROW)}到${zhDay(TOMORROW)}`);
  await expect(briefDoses).toHaveAttribute("data-due", "2");
  await expect(briefDoses).toHaveAttribute("data-taken", "2");
  await expect(briefDoses).toHaveAttribute("data-missed", "0");
  await expect(briefDoses).toHaveAttribute("data-unconfirmed", "0");
  await expect(briefDoses).toContainText("2 次里吃了 2 次");
  await expect(briefDoses).toContainText("Amlodipine 5 mg");
  await expect(briefDoses).toContainText("Losartan 50 mg");
  await expect(briefBp).toHaveAttribute("data-count", "0");
  await kit.show(briefDoses);
  const nextDay = await brief();
  expect(nextDay).toMatchObject({ date: TOMORROW, window: { fromDay: 43, toDay: 43, fromDate: TOMORROW, toDate: TOMORROW, lastVisit: { id: "v3", date: TODAY } } });
  expect(nextDay.doses.days.map((d) => ({ date: d.date, due: d.due, taken: d.taken, missed: d.missed, unconfirmed: d.unconfirmed }))).toEqual([{ date: TOMORROW, due: 2, taken: 2, missed: 0, unconfirmed: 0 }]);
  expect(nextDay.doses.meds.map((m) => m.id).sort()).toEqual(["med-amlodipine", "med-losartan"]);
  expect(nextDay.doses.missedDays).toEqual([]);
  expect(nextDay.nextVisit).toMatchObject({ date: addDays(TODAY, 42), days: 41 });
  await seen();

  // =================================================================== 7. 「清空，从我自己的开始」
  await pp.goto("/p/me");
  await kit.step(pp, "「我」里点「清空，从我自己的开始」");
  const clearEntry = pp.locator('[data-entry="example-clear"]');
  await expect(clearEntry).toContainText("清空，从我自己的开始");
  await kit.show(clearEntry);
  await seen();
  await clearEntry.click();
  await pp.waitForURL("**/p/me/example?do=clear");
  await expect(pp.locator('[data-rp="example-actions"]')).toBeVisible();
  await seen();

  await kit.step(pp, "再点一下才清：示例全部删掉，从建档开始");
  await pp.locator('[data-action="example-clear"]').click();
  await pp.waitForURL("**/onboard/who");
  await expect(pp.locator('[data-rp="headline"]')).toHaveText("现在是谁在填？");
  await expect(pp.locator('[data-rp="example-line"]')).toHaveCount(0);
  const cleared = (await getJson<{ profile: { example: boolean; onboarding: string; clinic: string | null; habits: unknown[] } }>(ctx, "/api/profile")).profile;
  expect(cleared).toMatchObject({ example: false, onboarding: "started", clinic: null, habits: [] });
  expect((await me(ctx)).body).toMatchObject({ account: { login }, scope: { example_data: false, onboarding: "started" } });
  // the example is gone: no question, no medicine, no dose, no reading, no visit that the brief could count from
  const emptyList = await questions();
  expect([emptyList.open, emptyList.answered, emptyList.skipped]).toEqual([[], [], []]);
  expect(await meds()).toEqual([]);
  expect(await doseRows(0, 60)).toEqual([]);
  expect((await getJson<{ readings: unknown[] }>(ctx, "/api/bp")).readings).toEqual([]);
  const gone = await ctx.request.get("/api/visits/v3");
  expect(gone.status()).toBe(404);
  await watch.api("example", gone);
  const blankBrief = await brief();
  expect(blankBrief.window.lastVisit).toBeNull();
  expect(blankBrief.questions.shown).toEqual([]);
  await seen();

  // =================================================================== the leak watch over the whole walk
  await settleWithin(watch);
  expect(watch.seen.pages, "the watch looked at the screens").toBeGreaterThan(40);
  expect(watch.seen.api, "the watch looked at the API answers").toBeGreaterThan(10);
  expect(watch.report()).toEqual([]);

  // ---- off screen: the account is deleted through the app's own route
  await deleteAccount(ctx, HIS_PASSWORD);
  accounts.length = 0;
  await clearClock(request);
  await kit.finish();
});
