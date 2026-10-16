/**
 * 10 自伤, on a real account (C2 track S). A sentence that sounds like he might hurt himself never goes to a model and never
 * gets a lecture: the fixed helpline sentences, calm, each number one tap away (995 the only red one; SOS 1767; SOS
 * CareText by WhatsApp text 9151 1767; mindline 1771; in the Mandarin UI the Care Corner Mandarin line 1800-3535-800). The
 * numbers that kb/referrals.json B4-06 says never to show appear nowhere. Nothing goes on his question list, and the
 * conversation stays on his own phone.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, journey } from "./_kit";

const EVENING = "2026-10-10T21:40:00+08:00";
const PASSWORD = "a long test password";
const WORDS = "我觉得活着没什么意思，只会拖累孩子";
const AGAIN = "有时候真的不想活了";
const NEVER = ["6389 2222", "63892222", "1800-221-4444", "18002214444"];

const latest = (p: Page) => p.locator('[data-testid="ask-turn"][data-latest="true"]');

/** The helpline buttons of an answer: number and where a tap goes. */
async function calls(turn: Locator): Promise<[string, string][]> {
  const links = turn.locator('[data-testid="answer-line"][data-kind="hotlines"] a[data-rp="call"]');
  const n = await links.count();
  const out: [string, string][] = [];
  for (let i = 0; i < n; i++) out.push([(await links.nth(i).locator(".rpu-call-num").innerText()).trim(), (await links.nth(i).getAttribute("href")) ?? ""]);
  return out;
}

journey("10 自伤", async ({ kit, request }) => {
  const clock = await request.post("/api/dev/clock", { data: { at: EVENING, frozen: true } });
  expect(clock.status(), await clock.text()).toBe(200);
  try {
    const { elder } = await kit.phones({ elder: "陈先生的手机" });
    const pp = elder.page;
    const made = await elder.context.request.post("/api/dev/accounts", { data: { login: `tan10${Date.now().toString(36)}`, password: PASSWORD, space: "example" } });
    expect(made.status(), await made.text()).toBe(201);
    const openBefore = ((await (await elder.context.request.get("/api/questions")).json()) as { list: { counts: { open: number } } }).list.counts.open;

    const ask = async (text: string) => {
      await kit.type(pp.getByTestId("ask-input"), text);
      const answered = pp.waitForResponse((r) => r.url().includes("/api/ask") && r.request().method() === "POST");
      await pp.getByTestId("ask-field").getByRole("button", { name: "问这句" }).click();
      const res = await answered;
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { route: string; llm: { calls: number }; addedQuestionId?: string };
      const turn = latest(pp);
      await expect(turn.getByRole("heading", { level: 1 })).toHaveText(text, { timeout: 4000 });
      const raw = JSON.stringify(body);
      for (const n of NEVER) expect(raw, `never ${n}`).not.toContain(n);
      for (const n of NEVER) await expect(pp.locator("body")).not.toContainText(n);
      return { turn, body };
    };

    await pp.goto("/p/ask");
    await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-mode", "screen");
    await kit.step(pp, "晚上 9:40，陈先生一个人在家，打开「问一句」");

    await kit.step(pp, "他打了一句心里话：我觉得活着没什么意思，只会拖累孩子");
    const first = await ask(WORDS);
    expect(first.body).toMatchObject({ route: "self_harm", llm: { calls: 0 } });
    expect(first.body.addedQuestionId).toBeUndefined();

    await kit.step(pp, "Ripple 不讲道理、不交给模型：几句固定的话，每个号码一按就能打");
    const lines = first.turn.locator('[data-testid="answer-line"][data-kind="hotlines"] .rpu-hotline');
    await expect(lines).toHaveCount(4);
    await expect(lines.nth(0)).toContainText("如果你觉得可能会伤害自己");
    await expect(first.turn).not.toContainText("记下了");
    expect(await calls(first.turn)).toEqual([
      ["995", "tel:995"],
      ["1767", "tel:1767"],
      ["9151 1767", "https://wa.me/6591511767"],
      ["1771", "tel:1771"],
      ["1800-3535-800", "tel:18003535800"],
    ]);
    const red = first.turn.locator('a[data-rp="call"][data-urgent="true"]');
    await expect(red).toHaveCount(1);
    await expect(red.locator(".rpu-call-num")).toHaveText("995");

    await kit.step(pp, "只有 995 是红色；SOS 1767、WhatsApp 发文字 9151 1767、mindline 1771，还有华语热线");
    await kit.show(lines.nth(3));
    await expect(first.turn.locator('a[href="https://wa.me/6591511767"]')).toContainText("WhatsApp 发文字");
    for (const link of await first.turn.locator('[data-testid="answer-line"][data-kind="hotlines"] a[data-rp="call"]').all()) {
      const box = await link.boundingBox();
      expect(box!.height, "every number is easy to tap").toBeGreaterThanOrEqual(48);
    }

    await kit.step(pp, "过了一会儿他又说：有时候真的不想活了");
    const again = await ask(AGAIN);
    expect(again.body).toMatchObject({ route: "self_harm", llm: { calls: 0 } });
    await kit.step(pp, "还是同样平静的几句话和号码，不加进问题单，也不通知别人");
    expect((await calls(again.turn)).map(([n]) => n)).toEqual(["995", "1767", "9151 1767", "1771", "1800-3535-800"]);
    const openAfter = ((await (await elder.context.request.get("/api/questions")).json()) as { list: { counts: { open: number } } }).list.counts.open;
    expect(openAfter).toBe(openBefore);

    await kit.step(pp, "这两句只留在他自己的手机上：刷新以后还在");
    await pp.reload();
    await expect(pp.getByTestId("ask-section")).toHaveAttribute("data-turns", "2");
    await expect(latest(pp).getByRole("heading", { level: 1 })).toHaveText(AGAIN);
    const history = (await (await elder.context.request.get("/api/ask/history")).json()) as { turns: { text: string; answer: { route: string } }[] };
    expect(history.turns.map((t) => [t.text, t.answer.route])).toEqual([
      [WORDS, "self_harm"],
      [AGAIN, "self_harm"],
    ]);

    await kit.pause(1200);
    await kit.finish();
  } finally {
    await request.post("/api/dev/clock", { data: { clear: true } });
  }
});
