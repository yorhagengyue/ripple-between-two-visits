/**
 * 04 随时说一句 — on a real account (C2 track K; 老人端提示词 04; M13; e2e-chains 5.1, 5.3).
 *
 *   10月12日 08:00 (developer test clock, frozen: the morning reminder is at 8:45, so Today shows the day's overview and
 *               today's medicine has no answer yet)   a new account with Mr Tan's example data (today is its day 42; his
 *               visit of 9月8日 is in his record, Dr Lim's lines confirmed)
 *   Today       「我今天好累。」 in Today's field (track S's 问一句): 「记下了。」 and, today's medicine not logged yet,
 *               「今天的药吃了吗？」 (no cause words); back on Today, the conversation section (track K's ChatSection)
 *   /p/chat     today's conversation as one line (the timeline draft's 04-2 to 04-4: his words on his own node, Ripple's
 *               fixed sentences in their bubble); the ankle note: 「记下了。」 and Dr Lim's own line about ankle swelling
 *               (9月8日, 0:37) in a card with 「加进问题单」, added only when he taps; the weather: track S's 「这个我帮不
 *               上，要我记下来吗？」 (no model, no question), 「记下来」 makes it a note. Every sentence goes through POST
 *               /api/ask
 *   reload      the day's turns are still there
 *   next day    today is empty; yesterday's conversation is under 「以前说过的话」, read only
 */
import { expect, journey } from "./_kit";
import { advanceClock, clearClock, getJson, newAccount, openPage, questions, setClock } from "./_k/account";

const ANKLE = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const DR_ANKLE = "Some people get ankle swelling with this one. If you notice it, tell me.";

journey("04 随时说一句", async ({ kit, request }) => {
  await setClock(request, "2026-10-12T08:00:00+08:00");
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  const pp = elder.page;
  await newAccount(elder, { space: "example" });
  await openPage(elder, "/p/today");
  const before = await questions(elder);

  const screen = pp.getByTestId("chat-screen");
  const field = pp.getByTestId("chat-field");
  const send = pp.getByTestId("chat-input").getByRole("button", { name: "问这句" });
  const turns = pp.getByTestId("chat-turn");
  const say = async (text: string, count: number) => {
    await kit.type(field, text);
    await send.click();
    await expect(turns).toHaveCount(count, { timeout: 15_000 });
    await expect(field).toHaveValue("");
  };

  await kit.step(pp, "陈先生（示例资料）早上打开今天页：底下一直有「按一下说」「打字」，点「打字」输入框就出来");
  await expect(pp.getByTestId("say-speak")).toBeVisible();
  await pp.getByTestId("say-type").click();
  const ask = pp.locator('[data-testid="ask-section"][data-mode="today"]');
  await expect(ask).toBeVisible();
  await kit.show(ask);

  await kit.step(pp, "他在今天页打一句「我今天好累。」");
  await kit.type(pp.getByTestId("ask-input"), "我今天好累。");
  await pp.getByTestId("ask-send").click();
  await pp.waitForURL(/\/p\/ask$/);
  const answer = pp.locator('[data-testid="ask-turn"][data-latest="true"]');
  await expect(answer).toHaveAttribute("data-route", "log_only");

  await kit.step(pp, "Ripple 回「记下了。」；今天的药还没记，再问一句「今天的药吃了吗？」，不说累和药有关");
  await expect(answer).toContainText("记下了。");
  await expect(answer).toContainText("今天的药吃了吗？");
  await expect(answer).not.toContainText(/因为|导致|引起|原因|是药/);

  await kit.step(pp, "回到今天页：「今天说过的话」这一块记着他刚说的");
  await openPage(elder, "/p/today");
  const section = pp.getByTestId("today-chat");
  await expect(section).toHaveAttribute("data-count", "1");
  await expect(section.getByTestId("today-chat-last")).toContainText("我今天好累。");
  await expect(section.getByTestId("today-chat-last")).toContainText("记下了。");
  await kit.show(section);

  await kit.step(pp, "点「看今天说过的话」：一天一段，按时间排，他的话和 Ripple 的回答分得清");
  await section.getByRole("link", { name: /看今天说过的话/ }).click();
  await pp.waitForURL(/\/p\/chat$/);
  await expect(screen).toHaveAttribute("data-today", "true");
  await expect(turns).toHaveCount(1);
  await expect(turns.nth(0).getByTestId("chat-his")).toHaveText("我今天好累。");
  await expect(turns.nth(0).getByTestId("chat-checkin")).toContainText("去今天页记");

  await kit.step(pp, "他在这里又说一句：「今天在大巴窑中心走了一圈，脚踝有点肿。」");
  await say(ANKLE, 2);
  const t2 = turns.nth(1);
  await expect(t2).toHaveAttribute("data-route", "log_only");
  await expect(t2.getByTestId("chat-answer")).toContainText("记下了。");

  await kit.step(pp, "「记下了。」下面，放着医生 9月8日看诊时自己说的那句（录音 0:37），讲的正是脚踝肿");
  const related = t2.getByTestId("chat-related");
  await expect(related).toHaveAttribute("data-source", "v2:v2-u07");
  await expect(related.locator('[data-rp="said"]')).toContainText(DR_ANKLE);
  await expect(related.locator('[data-rp="source-tag"]')).toContainText("医生说");
  await expect(related.locator('[data-rp="source-tag"]')).toContainText("9月8日 · 0:37");
  await kit.show(related.locator('[data-rp="said"]'));
  expect((await questions(elder)).length).toBe(before.length);

  await kit.step(pp, "他点「加进问题单」，这句话才进下次看诊要问医生的问题单");
  await kit.show(related.getByTestId("chat-related-add"));
  await related.getByTestId("chat-related-add").click();
  // (the timeline draft's 04-3b: the tick is an entry of its own on the day's line, after the doctor's card)
  await expect(t2.getByTestId("chat-related-added")).toContainText("已在下次看诊的问题单里");
  const added = (await questions(elder)).filter((q) => !before.some((b) => b.id === q.id));
  expect(added).toEqual([expect.objectContaining({ for: "doctor", origin: "chat", text: ANKLE, status: "open" })]);

  await kit.step(pp, "他问「今天会下雨吗？」");
  await say("今天会下雨吗？", 3);
  const t3 = turns.nth(2);
  await expect(t3).toHaveAttribute("data-route", "cant_help");

  await kit.step(pp, "Ripple 说「这个我帮不上，要我记下来吗？」：不去找答案，也不加进问题单");
  await expect(t3.getByTestId("chat-answer")).toContainText("这个我帮不上，要我记下来吗？");
  await expect(t3.getByTestId("chat-write-down")).toContainText("记下来");
  await kit.show(t3.getByTestId("chat-write-down"));
  expect((await questions(elder)).length).toBe(before.length + 1);

  await kit.step(pp, "他点「记下来」：记成他的一条笔记，Ripple 说「记下了。」");
  await t3.getByTestId("chat-write-down").click();
  await expect(t3.getByTestId("chat-noted")).toContainText("记下了。");
  await expect(t3.getByTestId("chat-write-down")).toHaveCount(0);
  const notes = (await getJson<{ notes: { text: string }[] }>(elder, "/api/notes")).notes;
  expect(notes.some((n) => n.text === "今天会下雨吗？")).toBe(true);

  await kit.step(pp, "刷新以后，今天说过的三句和回答都还在");
  await openPage(elder, "/p/chat");
  await expect(turns).toHaveCount(3);
  await expect(turns.nth(1).getByTestId("chat-related-added")).toBeVisible();
  await expect(turns.nth(2).getByTestId("chat-noted")).toBeVisible();

  await kit.step(pp, "第二天早上再打开：今天还是空的，昨天的三句在「以前说过的话」里");
  await advanceClock(request, 24 * 3_600_000);
  await openPage(elder, "/p/chat");
  await expect(screen).toHaveAttribute("data-turns", "0");
  const yesterday = pp.getByTestId("chat-day").first();
  await expect(yesterday).toHaveAttribute("data-date", "2026-10-12");
  await expect(yesterday).toContainText("10月12日 · 3 句");
  await kit.show(yesterday);

  await kit.step(pp, "点进去：昨天的对话按时间排好，只能看，不能再改");
  await yesterday.click();
  await pp.waitForURL(/\/p\/chat\?date=2026-10-12$/);
  await expect(screen).toHaveAttribute("data-today", "false");
  // (the timeline draft's header: the date is the title, what the screen holds is the line under it)
  await expect(pp.locator('[data-rp="page-title"]')).toHaveText("10月12日 周一");
  await expect(pp.locator('[data-rp="meta-story"]')).toHaveText("这一天说过的话");
  await expect(turns).toHaveCount(3);
  await expect(pp.getByTestId("chat-input")).toHaveCount(0);
  await expect(turns.nth(0).getByTestId("chat-his")).toHaveText("我今天好累。");

  await clearClock(request);
  await kit.finish();
});
