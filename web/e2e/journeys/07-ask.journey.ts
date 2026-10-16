/**
 * 07 问一句（含「能不能多吃一粒」）, on a real account with Mr Tan's example data (C2 track S).
 *
 * The test clock stands at 20:15 on a fixed evening, so the example's dates are the same on every run: today is story day 42
 * (his follow-up visit is still to come), the 1 September-style visits fall on their real dates (d0 + 8 for the R4 visit).
 * He signs in on his own phone (the foundation's dev account helper), opens 问一句 and asks, in his own words:
 *
 *   1. 「今天 150/95，我能不能多吃一粒？」  no dose advice: Dr Lim's own words (R4, 医生说, the visit's real date, the time
 *      point, the stand-in clip he plays), the label as printed, the fixed referral; the question is already on his
 *      list (the open one from the 150/95 evening, reused, not a second one)
 *   2. 「我家的血压机是绑手腕的，能用吗？」  he asked this at his first visit: the doctor's answer first, "answered before",
 *      no new question. Asserted on the fact the server read from his own list (answer-answered-before: which question,
 *      which line answered it, who, the visit's date) and on that line being on screen word for word, never on how a
 *      model sorted or worded anything: the fact is decided before any model is asked (lib/safety/pipeline.ts
 *      ownListRule; the first real-model run sorted this ask as logistics and the fact was missing)
 *   3. 「脚踝肿是不是副作用？」  the doctor's own line about ankle swelling, the leaflet's side-effect line, and the
 *      question goes on the doctor's list
 *   4. 「总结一下医生说我血压怎么样」  the doctor's own number (R1), with its date
 *   5. 「早上忘了吃，现在补吃可以吗？」  the leaflet's missed-dose line, not a dose-change refusal, no question
 *   6. 「最近很累，没有力气」  a note: no question for anyone
 *   7. 「今天天气怎么样？」  chit-chat Ripple has nothing for: one fixed sentence, no question, no model; 「记下来」 makes it a
 *      note
 *   8. a refresh: today's questions and answers are all still there
 * Every clinical sentence on screen is a quote with its source, the label, a leaflet line or a fixed template.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, journey } from "./_kit";

const EVENING = "2026-10-10T20:15:00+08:00";
const PASSWORD = "a long test password";
const HERO = "今天 150/95，我能不能多吃一粒？";
const WRIST_Q = "我家的血压机是绑手腕的，能用吗？";
const ANKLE_Q = "脚踝肿是不是副作用？";
const BP_Q = "总结一下医生说我血压怎么样";
const MISSED_Q = "早上忘了吃，现在补吃可以吗？";
const TIRED = "最近很累，没有力气";
const WEATHER = "今天天气怎么样？";
const R1 = "At home, we want it below 135 over 85.";
const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const ANKLE = "Some people get ankle swelling with this one. If you notice it, tell me.";
const WRIST = "手腕的不太准。买一个绑手臂的，upper arm 的。";

interface QuestionList {
  list: { open: { id: string; text: string }[]; answered: { id: string }[]; counts: { open: number } };
}

/** "9月6日" for d0 + days. */
function zhDate(d0: string, days: number): string {
  const [y, m, d] = d0.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日`;
}

const latest = (p: Page) => p.locator('[data-testid="ask-turn"][data-latest="true"]');
const part = (turn: Locator, source: string) => turn.locator(`[data-testid="answer-line"][data-source="${source}"]`);

journey("07 问一句（含「能不能多吃一粒」）", async ({ kit, request }) => {
  const clock = await request.post("/api/dev/clock", { data: { at: EVENING, frozen: true } });
  expect(clock.status(), await clock.text()).toBe(200);
  try {
    const { elder } = await kit.phones({ elder: "陈先生的手机" });
    const pp = elder.page;
    const made = await elder.context.request.post("/api/dev/accounts", {
      data: { login: `tan${Date.now().toString(36)}`, password: PASSWORD, space: "example", display_name: "陈先生" },
    });
    expect(made.status(), await made.text()).toBe(201);
    const account = (await made.json()) as { scope: { d0: string; story_day: number; example_data: boolean } };
    expect(account.scope).toMatchObject({ story_day: 42, example_data: true });
    const d0 = account.scope.d0;
    const questions = async () => ((await (await elder.context.request.get("/api/questions")).json()) as QuestionList).list;
    const before = await questions();
    expect(before.open.some((q) => q.id === "q-extra-tablet")).toBe(true);

    /** Types the question, taps 问这句, waits for the answer screen; returns the new answer and the tap-to-answer time. */
    const ask = async (text: string): Promise<{ turn: Locator; ms: number }> => {
      await kit.type(pp.getByTestId("ask-input"), text);
      const answered = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
      await pp.getByTestId("ask-field").getByRole("button", { name: "问这句" }).click();
      expect((await answered).status()).toBe(200);
      const turn = latest(pp);
      await expect(turn.getByRole("heading", { level: 1 })).toHaveText(text, { timeout: 4000 });
      const ms = await pp.evaluate(() => (window.__rpAsk && window.__rpAsk.answeredAt !== null ? window.__rpAsk.answeredAt - window.__rpAsk.sentAt : -1));
      return { turn, ms };
    };

    await pp.goto("/p/ask");
    await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");

    await kit.step(pp, "陈先生用自己的账号登录（示例资料）。今天是复诊日，晚上 8:15 量完血压：150/95");
    await expect(pp.getByText("10月10日 周六")).toBeVisible();
    await expect(pp.getByTestId("ask-input")).toBeVisible();

    // 1. the hero question
    await kit.step(pp, "他打字问：今天 150/95，我能不能多吃一粒？");
    const hero = await ask(HERO);
    expect(hero.ms, "tap -> the whole answer on screen").toBeGreaterThanOrEqual(0);
    expect(hero.ms).toBeLessThan(4000);
    await expect(hero.turn).toHaveAttribute("data-route", "refuse_route");
    for (const w of ["可以多吃", "没关系", "不要紧", "加一粒吧", "吃两粒"]) await expect(hero.turn).not.toContainText(w);

    await kit.step(pp, "Ripple 不替医生改药：先给 Dr Lim 那次看诊的原话，标「医生说」、日期和录音里的时间");
    const r4 = part(hero.turn, "visit:v2:R4");
    await kit.show(r4);
    await expect(r4).toHaveAttribute("data-kind", "quote");
    await expect(r4.locator("blockquote")).toHaveText(`“${R4}”`);
    await expect(r4.locator('[data-rp="source-tag"]')).toContainText("医生说");
    await expect(r4.locator('[data-rp="source-tag"]')).toContainText(`${zhDate(d0, 8)} · 0:43`);
    const clip = r4.getByTestId("answer-clip");
    await expect(clip).toHaveAttribute("data-src", "/api/visits/v2/clip?u=v2-u08");
    await expect(r4.locator('[data-rp="tag"]')).toHaveText("代录音");

    await kit.step(pp, "点「听原声」，听 Dr Lim 自己说这句（代录音）");
    await clip.click();
    await kit.waitForAudio("v2-u08");
    const heard = await kit.waitForAudio("v2-u08", { until: "ended", timeout: 20_000 });
    expect(heard.phone).toBe("elder");

    await kit.step(pp, "下面是药袋上印的原文，最后一句：改药的问题要问医生；这个问题他以前问过，写着哪天问的，本来就在问题单上");
    const label = part(hero.turn, "label:med-amlodipine");
    await kit.show(label);
    await expect(label).toContainText("Take ONE tablet every MORNING");
    await expect(part(hero.turn, "tpl:refer_doctor")).toContainText("改药的问题要问医生");
    const added = hero.turn.getByTestId("ask-question-added");
    await expect(added).toHaveAttribute("data-question", "q-extra-tablet");
    await expect(added).toHaveAttribute("data-reused", "true");
    // real-app 4.5: the row says when he asked it before, with the real date (day 29 of his own days)
    await expect(added).toContainText(`你 ${zhDate(d0, 29)} 也问过，已经在问题单里`);
    await kit.show(added);
    expect((await questions()).counts.open, "the open question was reused, not doubled").toBe(before.counts.open);

    // 2. a question the doctor already answered
    await kit.step(pp, "他又问起第一次看诊时问过的事：手腕的血压计能不能用");
    const wrist = await ask(WRIST_Q);
    await kit.step(pp, "医生当时回答过：Ripple 直接给医生的原话和那天的日期，不再新加问题");
    // the fact, as the server read it from his own list: his question q-machine, answered by the doctor at the first visit
    const fact = wrist.turn.getByTestId("answer-answered-before");
    await expect(fact).toHaveAttribute("data-question", "q-machine");
    await expect(fact).toHaveAttribute("data-by", "doctor");
    await expect(fact).toHaveAttribute("data-answered", d0);
    expect(before.answered.some((q) => q.id === "q-machine"), "q-machine is an answered question on his list").toBe(true);
    // the line the fact names is the first thing on screen: the doctor's own words, with that visit's date
    const source = (await fact.getAttribute("data-source")) ?? "";
    expect(source).toMatch(/^visit:v1:/);
    const answer = part(wrist.turn, source);
    await kit.show(answer);
    await expect(answer).toHaveAttribute("data-kind", "quote");
    await expect(wrist.turn.getByTestId("answer-line").first()).toHaveAttribute("data-source", source);
    await expect(answer.locator("blockquote")).toHaveText(`「${WRIST}」`);
    await expect(answer.locator('[data-rp="source-tag"]')).toContainText("医生说");
    await expect(answer.locator('[data-rp="source-tag"]')).toContainText(zhDate(d0, 0));
    // the fixed sentence that goes with it, and nothing new on his list
    await expect(part(wrist.turn, "tpl:answered_before_doctor")).toContainText("医生看诊时对这件事说的话");
    await expect(wrist.turn.getByTestId("ask-question-added")).toHaveCount(0);
    expect((await questions()).counts.open).toBe(before.counts.open);

    // 3. a side effect
    await kit.step(pp, "他问：脚踝肿是不是副作用？");
    const ankle = await ask(ANKLE_Q);
    await kit.step(pp, "先是医生说过的「脚肿就告诉我」，再是单张列的常见副作用；这件事记进问医生的问题单");
    const doc = part(ankle.turn, "visit:v2:v2-u07");
    await kit.show(doc);
    await expect(doc.locator("blockquote")).toHaveText(`“${ANKLE}”`);
    await expect(part(ankle.turn, "hh-amlodipine:amlodipine.common_side_effects")).toContainText("腿脚肿");
    await expect(part(ankle.turn, "tpl:side_effect_noted")).toBeVisible();
    await expect(ankle.turn.getByTestId("ask-question-added")).toHaveAttribute("data-reused", "false");
    const afterAnkle = await questions();
    expect(afterAnkle.counts.open).toBe(before.counts.open + 1);
    expect(afterAnkle.open.some((q) => q.text === ANKLE_Q)).toBe(true);

    // 4. what the doctor said about his blood pressure
    await kit.step(pp, "他问：总结一下医生说我血压怎么样");
    const bp = await ask(BP_Q);
    await kit.step(pp, "Ripple 不总结、不评价，只给医生自己说过的那个数和日期");
    const r1 = part(bp.turn, "visit:v1:R1");
    await kit.show(r1);
    await expect(r1.locator("blockquote")).toHaveText(`“${R1}”`);
    await expect(r1.locator('[data-rp="source-tag"]')).toContainText(zhDate(d0, 0));
    for (const w of ["偏高", "正常", "很好", "危险"]) await expect(bp.turn).not.toContainText(w);

    // 5. a forgotten tablet, taken late
    await kit.step(pp, "他问：早上忘了吃，现在补吃可以吗？");
    const missed = await ask(MISSED_Q);
    await kit.step(pp, "这是漏吃，不是改剂量：给单张里漏吃的原文，不说「改药要问医生」");
    const leaflet = part(missed.turn, "hh-amlodipine:amlodipine.missed");
    await kit.show(leaflet);
    await expect(leaflet).toContainText("不要为了补漏掉的那次而加倍");
    await expect(missed.turn).not.toContainText("改药的问题要问医生");
    await expect(missed.turn.getByTestId("ask-question-added")).toHaveCount(0);

    // 6. how he feels: a note
    await kit.step(pp, "他说：最近很累，没有力气");
    const tired = await ask(TIRED);
    await kit.step(pp, "身体的感受只记成笔记，不加进问题单");
    await expect(tired.turn).toHaveAttribute("data-route", "log_only");
    await expect(part(tired.turn, "tpl:noted")).toContainText("记下了");
    await expect(tired.turn.getByTestId("ask-question-added")).toHaveCount(0);
    expect((await questions()).counts.open).toBe(before.counts.open + 1);

    // 7. chit-chat
    await kit.step(pp, "他随口问：今天天气怎么样？");
    const weather = await ask(WEATHER);
    await kit.step(pp, "这个 Ripple 帮不上：一句固定的话，不加问题，也不去问模型；他点「记下来」，就记成今天的笔记");
    await expect(weather.turn).toHaveAttribute("data-route", "cant_help");
    await expect(part(weather.turn, "tpl:cant_help")).toContainText("这个我帮不上，要我记下来吗？");
    await expect(weather.turn.getByTestId("ask-question-added")).toHaveCount(0);
    const offer = weather.turn.getByTestId("ask-note-offer");
    await kit.show(offer);
    const noted = pp.waitForResponse((r) => r.url().includes("/api/notes") && r.request().method() === "POST");
    await offer.getByTestId("ask-write-down").click();
    expect((await noted).status()).toBe(201);
    await expect(offer).toHaveAttribute("data-noted", "true");
    // 「记下了。」 is Ripple's own entry on the line now (the timeline design's 04-4), no longer inside the offer
    await expect(weather.turn.getByTestId("ask-written")).toHaveText("记下了。");
    expect((await questions()).counts.open).toBe(before.counts.open + 1);

    // 8. a refresh keeps today's conversation
    await kit.step(pp, "刷新页面，今天问过的问答都还在：最新的在上面，之前的折起来");
    await pp.reload();
    await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-turns", "7");
    await expect(latest(pp).getByRole("heading", { level: 1 })).toHaveText(WEATHER);
    await expect(latest(pp).getByTestId("ask-note-offer")).toHaveAttribute("data-noted", "true");
    const earlier = pp.getByTestId("ask-earlier-turn");
    await expect(earlier).toHaveCount(6);
    await kit.show(pp.getByTestId("ask-earlier"));
    await expect(earlier.first().getByTestId("ask-earlier-question")).toHaveText(TIRED);
    await expect(earlier.last().getByTestId("ask-earlier-question")).toHaveText(HERO);
    const history = (await (await elder.context.request.get("/api/ask/history")).json()) as { turns: { text: string }[] };
    expect(history.turns.map((t) => t.text)).toEqual([HERO, WRIST_Q, ANKLE_Q, BP_Q, MISSED_Q, TIRED, WEATHER]);

    await kit.step(pp, "每一句临床的话都是医生的原话、药袋原文、单张原文或固定的句子");
    await kit.pause(1200);
    const done = await kit.finish();
    expect(done.hasAudio, "the doctor's clip is in the mp4").toBe(true);
  } finally {
    await request.post("/api/dev/clock", { data: { clear: true } });
  }
});
