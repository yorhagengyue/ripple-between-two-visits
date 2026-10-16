/**
 * 09 急症, on a real account with Mr Tan's example data (C2 track S). The emergency answers never wait for a model: the
 * rules route them, the fixed 995 template comes first in the red block with a one-tap call, and his own doctor's warning
 * line (R2, from his first visit) follows word for word with its date, time point and clip.
 *
 *   1. 「我胸口好痛，左手没力」             the red 995 block (tel:995), then Dr Lim's R2; no helpline numbers; no model call
 *   2. 「右边身体觉得很重」                 one side heavy is recognised by the rules (it used to need the model)
 *   3. 「降压药会不会引起胸口痛？」         995 first, then the doctor's line, then the leaflet's side-effect line (the 10-10
 *                                           decision), and still no question for anyone
 *   4. 「我刚量了血压 185/112」             a reading above his doctor's own number (180): 995 and the doctor's words
 *   4b. the blood pressure page            the same reading copied from the monitor with the keypad: under the saved
 *                                           reading the same red 995 block and the same doctor's line (track B's page draws
 *                                           what lib/safety/threshold.ts relayDoctorThreshold returns); no word about the
 *                                           numbers
 *   5. afterwards                          the questions and answers stay on his phone only (today's history), nothing
 *                                           went on the question list
 */
import type { Locator, Page } from "@playwright/test";
import { expect, journey } from "./_kit";

const EVENING = "2026-10-10T20:15:00+08:00";
const PASSWORD = "a long test password";
const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const CALL_995 = "现在就打 995 叫救护车，不确定也要打。";
const CHEST = "我胸口好痛，左手没力";
const HEAVY = "右边身体觉得很重";
const CAUSE = "降压药会不会引起胸口痛？";
const READING = "我刚量了血压 185/112";
const NEVER = ["1767", "1771", "9151", "1800-3535-800", "6389 2222", "1800-221-4444"];

function zhDate(d0: string, days: number): string {
  const [y, m, d] = d0.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日`;
}

const latest = (p: Page) => p.locator('[data-testid="ask-turn"][data-latest="true"]');
const part = (turn: Locator, source: string) => turn.locator(`[data-testid="answer-line"][data-source="${source}"]`);

journey("09 急症", async ({ kit, request }) => {
  const clock = await request.post("/api/dev/clock", { data: { at: EVENING, frozen: true } });
  expect(clock.status(), await clock.text()).toBe(200);
  try {
    const { elder } = await kit.phones({ elder: "陈先生的手机" });
    const pp = elder.page;
    const made = await elder.context.request.post("/api/dev/accounts", { data: { login: `tan09${Date.now().toString(36)}`, password: PASSWORD, space: "example" } });
    expect(made.status(), await made.text()).toBe(201);
    const d0 = ((await made.json()) as { scope: { d0: string } }).scope.d0;
    const openBefore = ((await (await elder.context.request.get("/api/questions")).json()) as { list: { counts: { open: number } } }).list.counts.open;

    /** Asks and returns the answer and its body (route, model calls). */
    const ask = async (text: string) => {
      await kit.type(pp.getByTestId("ask-input"), text);
      const answered = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
      await pp.getByTestId("ask-field").getByRole("button", { name: "问这句" }).click();
      const res = await answered;
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { route: string; llm: { calls: number }; sentences: { sourceId: string }[]; addedQuestionId?: string };
      const turn = latest(pp);
      await expect(turn.getByRole("heading", { level: 1 })).toHaveText(text, { timeout: 4000 });
      const raw = JSON.stringify(body);
      for (const n of NEVER) expect(raw, `no ${n} in an emergency answer`).not.toContain(n);
      return { turn, body };
    };
    /** The red block with the fixed sentence and its one-tap call. */
    const expectRedBlock = async (turn: Locator) => {
      const block = turn.locator('[data-testid="answer-line"][data-kind="emergency"]');
      await expect(block).toHaveCount(1);
      await expect(block.locator('[data-rp="emergency"] h2')).toHaveText(CALL_995);
      const call = block.locator('[data-rp="emergency-call"]');
      await expect(call).toHaveAttribute("href", "tel:995");
      const box = await call.boundingBox();
      expect(box!.height, "the call button is easy to tap").toBeGreaterThanOrEqual(48);
      return block;
    };

    await pp.goto("/p/ask");
    await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
    await kit.step(pp, "陈先生的账号（示例资料），晚上 8:15。急症的回答不等模型，规则当场判断");

    // 1. chest pain and a weak arm
    await kit.step(pp, "他打字：我胸口好痛，左手没力");
    const chest = await ask(CHEST);
    expect(chest.body).toMatchObject({ route: "emergency", llm: { calls: 0 } });
    await kit.step(pp, "第一句就是红色的「现在就打 995」，一按就拨号");
    await expectRedBlock(chest.turn);
    await kit.step(pp, "下面是 Dr Lim 第一次看诊时交代的原话：超过 180、胸口痛、一边没力就打 995");
    const r2 = part(chest.turn, "visit:v1:R2");
    await kit.show(r2);
    await expect(r2.locator("blockquote")).toHaveText(`“${R2}”`);
    await expect(r2.locator('[data-rp="source-tag"]')).toContainText("医生说");
    // R2 starts 53.681 s into the recording: 0:53, the figure the visit screen and the demo show for it (a time point
    // is cut to whole seconds everywhere since track B's fix round; this card used to round it to 0:54)
    await expect(r2.locator('[data-rp="source-tag"]')).toContainText(`${zhDate(d0, 0)} · 0:53`);
    await expect(r2.getByTestId("answer-clip")).toHaveAttribute("data-src", "/api/visits/v1/clip?u=v1-u09");
    // R2's own "call 995" is the doctor's words: plain text, never a second call button
    await expect(r2.locator("a[href^='tel:']")).toHaveCount(0);

    // 2. one side heavy
    await kit.step(pp, "他又说：右边身体觉得很重");
    const heavy = await ask(HEAVY);
    expect(heavy.body).toMatchObject({ route: "emergency", llm: { calls: 0 } });
    expect(heavy.body.sentences.map((s) => s.sourceId)).toEqual(["referral:B1-03", "visit:v1:R2"]);
    await kit.step(pp, "一边身体沉重是中风的征兆：规则认得出，同样先给 995");
    await expectRedBlock(heavy.turn);

    // 3. chest pain asked as the BP medicine's doing
    await kit.step(pp, "他问：降压药会不会引起胸口痛？");
    const cause = await ask(CAUSE);
    expect(cause.body.route).toBe("emergency");
    expect(cause.body.sentences.map((s) => s.sourceId)).toEqual(["referral:B1-01", "visit:v1:R2", "hh-amlodipine:amlodipine.common_side_effects"]);
    await kit.step(pp, "胸口痛先当急症：先给 995 和医生的话，后面附单张里副作用的原文");
    await expectRedBlock(cause.turn);
    const leaflet = part(cause.turn, "hh-amlodipine:amlodipine.common_side_effects");
    await kit.show(leaflet);
    await expect(leaflet).toContainText("单张列出的常见副作用");
    expect(cause.body.addedQuestionId).toBeUndefined();

    // 4. a reading above his doctor's number
    await kit.step(pp, "他打字说：我刚量了血压 185/112");
    const reading = await ask(READING);
    expect(reading.body).toMatchObject({ route: "emergency", llm: { calls: 0 } });
    await kit.step(pp, "读数超过医生自己说的 180：不评价读数，只给 995 和医生那句原话");
    await expectRedBlock(reading.turn);
    await expect(part(reading.turn, "visit:v1:R2").locator("blockquote")).toHaveText(`“${R2}”`);
    for (const w of ["偏高", "危险", "太高", "正常"]) await expect(reading.turn).not.toContainText(w);

    // 4b. the same reading on the blood pressure page
    await kit.step(pp, "他到「血压」页点「记一次血压」，照着血压计按 185/112，点记下");
    await pp.goto("/p/bp");
    await expect(pp.getByTestId("page-bp")).toHaveAttribute("data-scope", "account");
    // the page opens on the week (the timeline draft's 03-3a); 「记一次血压」 brings the keypad
    await pp.getByTestId("bp-record-open").click();
    const keypad = pp.locator('[data-rp="bp-keypad"]');
    for (const d of "185112") await keypad.locator(".rpu-key", { hasText: new RegExp(`^${d}$`) }).click();
    await pp.getByTestId("bp-save").click();
    await expect(pp.getByTestId("bp-saved")).toHaveAttribute("data-reading", "185/112");
    await kit.step(pp, "存好的读数下面就是红色的 995 和医生那句原话，和问一句里的一样；读数本身不评价");
    const relay = pp.getByTestId("bp-saved").getByTestId("threshold-relay");
    await kit.show(relay);
    await expect(relay).toHaveAttribute("data-state", "confirmed");
    await expect(relay.getByTestId("relay-template")).toContainText(CALL_995);
    await expect(relay.locator('a[href^="tel:995"]').first()).toBeVisible();
    await expect(relay.getByTestId("relay-doctor")).toContainText(R2);
    for (const w of ["偏高", "危险", "太高", "正常"]) await expect(pp.getByTestId("bp-saved")).not.toContainText(w);

    // 5. afterwards: only on his phone
    await kit.step(pp, "回到问一句：这几问只留在他自己的手机上，刷新还在，问题单里没有多出东西");
    await pp.goto("/p/ask");
    await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-turns", "4");
    await expect(latest(pp).getByRole("heading", { level: 1 })).toHaveText(READING);
    await kit.show(pp.getByTestId("ask-earlier"));
    const history = (await (await elder.context.request.get("/api/ask/history")).json()) as { turns: { text: string; answer: { route: string } }[] };
    expect(history.turns.map((t) => [t.text, t.answer.route])).toEqual([
      [CHEST, "emergency"],
      [HEAVY, "emergency"],
      [CAUSE, "emergency"],
      [READING, "emergency"],
    ]);
    const openAfter = ((await (await elder.context.request.get("/api/questions")).json()) as { list: { counts: { open: number } } }).list.counts.open;
    expect(openAfter).toBe(openBefore);

    await kit.pause(1200);
    await kit.finish();
  } finally {
    await request.post("/api/dev/clock", { data: { clear: true } });
  }
});
