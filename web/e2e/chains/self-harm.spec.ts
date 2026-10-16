/**
 * Chain 8 自伤, end to end (docs/plan/e2e-chains.md section 8): he types words of self-harm on Today.
 *
 *   his phone (joined as 本人), backstage (joined as 后台), D29 20:15:
 *     华语界面「我不想活了」 -> within 4 s the B4 templates only: 995 first, then SOS 1767 and SOS CareText 9151 1767,
 *     mindline 1771, and in the Mandarin UI the Care Corner Mandarin line 1800-3535-800; the two numbers table B4-06
 *     says never to show are nowhere (screen or /api/ask); no model call; no question, no note
 *     English UI「I don't want to live anymore」 -> the same four, without the Mandarin line
 *     backstage: sorted as "self harm" by the rules
 *
 * One tap (8.1, closed 10-10, the second test): every number is a link at least 48 px tall, the words unchanged:
 *   tel:995, tel:1767, tel:1771, tel:18003535800 (华语 only), and CareText 9151 1767 a WhatsApp text link (wa.me)
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { api, closeAll, createSession, eventJson, eventRows, getJson, joinAs, askOnPhone, textBelow, waitLive, CREW_HEADERS } from "../helpers";


// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

/** Does a tap 2 px inside the link's top edge, and 2 px inside its bottom edge, land on the link (its whole box is the target)? */
async function tapEdges(link: Locator): Promise<boolean[]> {
  return link.evaluate((a) => {
    a.scrollIntoView({ block: "center" });
    const r = a.getBoundingClientRect();
    const x = r.left + r.width / 2;
    return [document.elementFromPoint(x, r.top + 2) === a, document.elementFromPoint(x, r.bottom - 2) === a];
  });
}

const SELF_HARM = { zh: "我不想活了", en: "I don't want to live anymore" };
const NUMBERS = ["995", "1767", "9151 1767", "1771"];
const MANDARIN_LINE = "1800-3535-800";
const NEVER = ["6389 2222", "63892222", "1800-221-4444", "18002214444"];

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  for (const p of ["/p/today", "/backstage", "/p/questions"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
  await api(request, "/api/ask", s.id, { text: SELF_HARM.zh, locale: "zh-Hans" });
});

async function questionCount(page: Page): Promise<number> {
  await page.goto("/p/questions");
  await waitLive(page);
  const n = await page.getByTestId("question").count();
  await page.goto("/p/today");
  await waitLive(page);
  return n;
}

test("自伤 (华语 and English): 995 first, then SOS 1767, CareText 9151 1767, mindline 1771 (and the Mandarin line in 华语); never the B4-06 numbers; backstage self_harm; nothing else kept", async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");
  const pp = phone.page;
  const notesBefore = (await getJson<{ notes: unknown[] }>(phone, "/api/notes", s.id)).notes.length;
  const questionsBefore = await questionCount(pp);

  for (const lang of ["zh-Hans", "en"] as const) {
    if (lang === "en") {
      await phone.context.addCookies([{ name: "rp_lang", value: "en", url: new URL(pp.url()).origin }]);
      await pp.reload();
      await waitLive(pp);
    }
    const text = lang === "en" ? SELF_HARM.en : SELF_HARM.zh;
    const seen = await askOnPhone(pp, text);
    expect(seen.status).toBe(200);
    expect(seen.ms, `tap -> answer ${seen.ms} ms`).toBeLessThan(4000);
    expect(seen.body?.route).toBe("self_harm");
    expect(seen.body?.llm?.calls, "no model call").toBe(0);
    const ids = seen.body?.sentences?.map((x) => x.sourceId) ?? [];
    expect(ids).toEqual(lang === "en" ? ["referral:B4-01", "referral:B4-02", "referral:B4-03"] : ["referral:B4-01", "referral:B4-02", "referral:B4-03", "referral:B4-04"]);
    const answer = pp.getByTestId("ask-answer");
    await expect(pp.getByTestId("answer-line").first().getByTestId("answer-text")).toContainText("995");
    const shown = await answer.innerText();
    for (const n of NUMBERS) expect(shown, `${lang}: ${n}`).toContain(n);
    if (lang === "en") expect(shown, "no Mandarin hotline in the English UI").not.toContain(MANDARIN_LINE);
    else expect(shown).toContain(MANDARIN_LINE);
    for (const n of NEVER) {
      expect(shown, `${lang}: never ${n}`).not.toContain(n);
      expect(JSON.stringify(seen.body), `${lang}: /api/ask carries ${n}`).not.toContain(n);
    }
    await expect(pp.getByTestId("ask-question-added")).toHaveCount(0);
    expect(await textBelow(pp, 18)).toEqual([]);
  }

  // backstage: both sorted as self harm by the rules
  const routes = eventRows(desk.page, "ask.route").filter({ hasText: "Sorted as words about self-harm" });
  await expect(routes).toHaveCount(2, { timeout: 4000 });
  const raw = await eventJson(routes.first());
  expect(raw.data).toMatchObject({ route: "self_harm" });
  expect(String(raw.data.reason)).toMatch(/^rule:/);

  // nothing else is kept on his side: no note, no question
  expect((await getJson<{ notes: unknown[] }>(phone, "/api/notes", s.id)).notes.length).toBe(notesBefore);
  expect(await questionCount(pp)).toBe(questionsBefore);
  await closeAll([phone, desk]);
});

// 8.1 (= 7.1, P0 item 5, closed 10-10): every number on the self-harm answer is a one-tap link, done in
// components/daily/AnswerView.tsx with components/daily/dial.ts (not EmergencyBlock: the look waits for the designer).
// The calls are tel: links; SOS CareText takes WhatsApp text only, so 9151 1767 opens WhatsApp (wa.me) and is labelled
// so. Each link wraps the digits as the template writes them: the lines read exactly as before.
test("自伤: every number on the answer is a one-tap link (tel: for the calls, WhatsApp text for CareText), at least 48 px tall, the words unchanged (8.1)", async ({
  browser,
  request,
}) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  try {
    const seen = await askOnPhone(phone.page, SELF_HARM.zh);
    expect(seen.body?.route).toBe("self_harm");
    const answer = phone.page.getByTestId("ask-answer");
    await expect(answer).toContainText("1767");
    const links: [string, string][] = [
      ["tel:995", "995"],
      ["tel:1767", "1767"],
      ["https://wa.me/6591511767", "9151 1767"],
      ["tel:1771", "1771"],
      ["tel:18003535800", MANDARIN_LINE],
    ];
    for (const [href, shown] of links) {
      const link = answer.locator(`a[href="${href}"]`);
      await expect(link, href).toHaveCount(1, { timeout: 2000 });
      await expect(link, href).toHaveText(shown);
      await expect(link, href).toBeVisible();
      await expect(link, `${href} looks like a link`).toHaveCSS("text-decoration-line", "underline");
      expect((await link.boundingBox())?.height ?? 0, `${href}: tap height`).toBeGreaterThanOrEqual(48);
      expect(await tapEdges(link), `${href}: a tap at the top and the bottom edge reaches the link`).toEqual([true, true]);
    }
    await expect(answer.locator("a")).toHaveCount(links.length);
    const wa = answer.locator('a[href="https://wa.me/6591511767"]');
    await expect(wa).toHaveAttribute("aria-label", "WhatsApp 发文字 9151 1767");
    await expect(wa).toHaveAttribute("target", "_blank");
    // the lines read exactly as the templates /api/ask sent
    expect(await phone.page.getByTestId("answer-text").allTextContents()).toEqual(seen.body?.sentences?.map((x) => x.zh ?? x.en));
  } finally {
    await closeAll([phone]);
  }
});
