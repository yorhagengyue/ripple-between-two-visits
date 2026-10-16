/**
 * Chain 7 急症, end to end (docs/plan/e2e-chains.md section 7): what he types on Today when something is wrong now.
 *
 *   his phone (joined as 本人), backstage (joined as 后台), D29 20:15 (R2 was said at the D0 visit):
 *     chest pain and stroke words, in Mandarin and in English -> within 4 s the first line is the fixed 995 template
 *     (kb/referrals.json table B1), then R2 in Dr Lim's own words (医生说 / Doctor said, 24 Aug, 0:53); no helpline
 *     numbers, none of the numbers B4 says never to show; no question, no note; no model call
 *     backstage: each one sorted as "emergency" by the rules, the raw JSON says so
 *   the same with the model unavailable: this session's model budget is used up (the cost guard,
 *     lib/safety/cost-guard.ts, the way tests/unit/safety/api-ask.test.ts does it in process): 995 still first;
 *     a question that needs the model is refused on screen; a chest statement still shows a 995 line (rules only)
 *
 *   one tap (7.1, closed 10-10): the 995 in the template is a tel:995 link at least 48 px tall, the line's words
 *     unchanged (components/daily/dial.ts, AnswerView); R2's own "call 995" (the doctor's words) stays plain text
 *
 *   D0 before the visit (7.5, closed 10-10; a test.fail() gap until then): the 995 template alone, no R2, which Dr Lim
 *     only says at the 09:30 visit; the blood pressure page agrees (no doctor's number yet)
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

const R2 = "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";
const CALL_995 = { zh: "现在就打 995 叫救护车，不确定也要打。", en: "Call 995 now for an ambulance, even if you are not sure." };
/** helplines (B4) and the numbers table B4-06 says never to show */
const NOT_HERE = ["1767", "1771", "9151", "1800-3535-800", "6389 2222", "63892222", "1800-221-4444", "18002214444"];

const CASES: { lang: "zh-Hans" | "en"; text: string; what: string }[] = [
  { lang: "zh-Hans", text: "我胸口好痛，左手没力", what: "chest pain, one arm weak" },
  { lang: "zh-Hans", text: "我右手突然没力，说话也说不清楚", what: "stroke: one side weak, speech" },
  { lang: "en", text: "My chest hurts and my left arm is weak", what: "chest pain, one arm weak" },
  { lang: "en", text: "My face is drooping on one side and my speech is slurred", what: "stroke: face, speech" },
];

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/p/today", "/backstage", "/p/questions"]) await request.get(p, { headers: cookie });
  await api(request, "/api/ask", s.id, { text: CASES[0].text, locale: "zh-Hans" });
  await request.get(`/api/notes?session=${s.id}`);
});

async function setLang(page: Page, lang: "zh-Hans" | "en") {
  await page.context().addCookies([{ name: "rp_lang", value: lang, url: new URL(page.url()).origin }]);
  await page.reload();
  await waitLive(page);
}

/** On screen: the first line is the 995 template, then R2 word for word with who said it and when. */
async function expect995ThenR2(page: Page, lang: "zh-Hans" | "en") {
  const lines = page.getByTestId("answer-line");
  await expect(lines.first()).toHaveAttribute("data-source", /^referral:B1-\d\d$/);
  await expect(lines.first().getByTestId("answer-text")).toHaveText(lang === "en" ? CALL_995.en : CALL_995.zh);
  const r2 = page.locator('[data-testid="answer-line"][data-source="visit:v1:R2"]');
  await expect(r2.getByTestId("answer-text")).toHaveText(R2);
  await expect(r2.getByTestId("answer-chip")).toHaveText(lang === "en" ? "● Doctor said" : "● 医生说");
  await expect(r2.getByTestId("answer-detail")).toContainText(lang === "en" ? "24 Aug 2026 · at 0:53" : "2026年8月24日 · 0:53 处");
  await expect(lines).toHaveCount(2);
  const shown = await page.getByTestId("ask-answer").innerText();
  for (const n of NOT_HERE) expect(shown, `on screen: ${n}`).not.toContain(n);
  await expect(page.getByTestId("ask-question-added")).toHaveCount(0);
}

test("急症 (mock model): chest pain and stroke words in 华语 and English -> the 995 template first, R2 in the doctor's words -> backstage shows the emergency route; nothing else is kept", async ({
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");
  const pp = phone.page;
  const notesBefore = (await getJson<{ notes: unknown[] }>(phone, "/api/notes", s.id)).notes.length;
  const questionsBefore = await (async () => {
    await pp.goto("/p/questions");
    await waitLive(pp);
    const n = await pp.getByTestId("question").count();
    await pp.goto("/p/today");
    await waitLive(pp);
    return n;
  })();

  let lang: "zh-Hans" | "en" = "zh-Hans";
  for (const c of CASES) {
    if (c.lang !== lang) {
      await setLang(pp, c.lang);
      lang = c.lang;
    }
    const seen = await askOnPhone(pp, c.text);
    expect(seen.status, c.text).toBe(200);
    expect(seen.ms, `${c.text}: tap -> answer ${seen.ms} ms`).toBeLessThan(4000);
    expect(seen.body?.route, c.text).toBe("emergency");
    expect(seen.body?.llm?.calls, `${c.text}: no model call`).toBe(0);
    expect(seen.body?.sentences?.[0]?.sourceId, c.text).toMatch(/^referral:B1-\d\d$/);
    expect(seen.body?.addedQuestionId ?? null, c.text).toBeNull();
    for (const n of NOT_HERE) expect(JSON.stringify(seen.body), `${c.text}: ${n} in /api/ask`).not.toContain(n);
    await expect995ThenR2(pp, c.lang);
    expect(await textBelow(pp, 18)).toEqual([]);
  }

  // backstage: every one of them sorted as an emergency by the rules (no model), and answered with the template
  const routes = eventRows(desk.page, "ask.route").filter({ hasText: "Sorted as an emergency" });
  await expect(routes).toHaveCount(CASES.length, { timeout: 4000 });
  const raw = await eventJson(routes.first());
  expect(raw.data).toMatchObject({ route: "emergency" });
  expect(String(raw.data.reason)).toMatch(/^rule:/);
  await expect(eventRows(desk.page, "ask.answered").filter({ hasText: "Answered (an emergency)" })).toHaveCount(CASES.length);
  for (const c of CASES) await expect(eventRows(desk.page, "ask.received").filter({ hasText: c.text })).toHaveCount(1);

  // nothing else is kept on his side: no note, no question
  expect((await getJson<{ notes: unknown[] }>(phone, "/api/notes", s.id)).notes.length).toBe(notesBefore);
  await pp.goto("/p/questions");
  await waitLive(pp);
  await expect(pp.getByTestId("question")).toHaveCount(questionsBefore);
  await closeAll([phone, desk]);
});

test("急症 with the model unavailable (the session's model budget used up): 995 still comes first; a question that needs the model is refused and says so; a chest statement still shows 995", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const pp = phone.page;
  // the cost guard counts every question this session asks in the last hour (COST_REQ_PER_HOUR, default 60): ask
  // from his own phone until it answers 429, as tests/unit/safety/api-ask.test.ts fills it in process
  let used = 0;
  for (; used < 400; used++) {
    const r = await phone.context.request.post(`/api/ask?session=${s.id}`, { data: { text: "What is amlodipine for?", locale: "en", role: "patient" } });
    if (r.status() === 429) {
      expect((await r.json()).limit).toBe("requests_per_hour");
      break;
    }
    expect(r.status(), `ask #${used + 1}`).toBe(200);
  }
  expect(used, "the budget ran out before 400 questions").toBeLessThan(400);
  test.info().annotations.push({ type: "cost guard", description: `429 after ${used} questions this hour` });
  const desk = await joinAs(browser, s.join_code, "backstage", "/backstage");

  // 1. an emergency is never refused by the guard and needs no model: 995 first, R2, as with the model
  const em = await askOnPhone(pp, CASES[0].text);
  expect(em.status).toBe(200);
  expect(em.body?.route).toBe("emergency");
  expect(em.body?.llm?.calls).toBe(0);
  await expect995ThenR2(pp, "zh-Hans");
  await expect(eventRows(desk.page, "ask.route").filter({ hasText: "Sorted as an emergency" })).toHaveCount(1, { timeout: 4000 });

  // 2. a question that needs the model: refused, and the phone says so (no answer is made up)
  const q = await askOnPhone(pp, "这个药是做什么的？");
  expect(q.status).toBe(429);
  await expect(pp.getByTestId("ask-error")).toHaveText("这个小时问得太多了，等一下再试。");
  await expect(pp.getByTestId("ask-answer")).toHaveCount(0);
  const guard = eventRows(desk.page, "ask.blocked").filter({ hasText: "Cost guard: requests per hour reached" });
  await expect(guard.last()).toHaveAttribute("data-tone", "blocked", { timeout: 4000 });
  await expect(guard.last().getByTestId("event-badge")).toHaveText("Blocked · cost guard");

  // 3. a statement near a crisis word ("胸口") is still answered, by the rules alone, and a 995 line is on screen
  const st = await askOnPhone(pp, "我胸口有点不舒服");
  expect(st.status).toBe(200);
  const shown = await pp.getByTestId("ask-answer").innerText();
  expect(shown).toContain("995");
  for (const n of ["1767", "1771"]) expect(shown).not.toContain(n);
  if (st.body?.route === "log_only") {
    // today's rules: a note, rules only (no model), with the fixed safety line last
    expect(st.body.costLimited?.limit).toBe("requests_per_hour");
    await expect(pp.getByTestId("answer-line").last()).toHaveAttribute("data-source", "referral:B4-01");
    await expect(eventRows(desk.page, "ask.route").filter({ hasText: "rules only" })).not.toHaveCount(0, { timeout: 4000 });
  } else {
    // (if the rules come to read this as an emergency, the 995 template leads instead)
    expect(st.body?.route).toBe("emergency");
  }
  await closeAll([phone, desk]);
});

// 7.5 (r3 review problem 2; closed 10-10, a test.fail() gap until then): on D0 before the 09:30 visit the emergency
// answer used to quote R2, which Dr Lim only says at that visit. Seed visits are all status "confirmed" (the story's end
// state) and lib/safety/candidates.ts kept every visit with v.day <= story_day (lib/safety/pipeline.ts the same for the R2
// threshold). Now a visit on the story day counts once it has happened (lib/safety/line-state.ts visitHappened): once this
// session holds its record (replayed, recorded, or recording now), or when the clock has no time of day.
test("急症 on D0 before the first visit: 995 only, R2 is not quoted before Dr Lim has said it (7.5)", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 0, story_time: "08:00" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  // closed in finally: a context left open with its event stream after a failing test has been followed by a crashed
  // worker in the next test (exit 0xC0000409, PROGRESS 10-10)
  try {
    // the blood pressure page agrees that the doctor has not said a number yet today
    await phone.page.goto("/p/bp");
    await waitLive(phone.page);
    await expect(phone.page.getByTestId("bp-target")).toHaveCount(0);
    await phone.page.goto("/p/today");
    await waitLive(phone.page);
    const seen = await askOnPhone(phone.page, CASES[0].text);
    expect(seen.body?.route).toBe("emergency");
    await expect(phone.page.getByTestId("answer-line").first().getByTestId("answer-text")).toHaveText(CALL_995.zh);
    // R2 is not quoted before Dr Lim has said it: the 995 template alone
    expect(seen.body?.sentences?.map((x) => x.sourceId)).not.toContain("visit:v1:R2");
    await expect(phone.page.locator('[data-testid="answer-line"][data-source="visit:v1:R2"]')).toHaveCount(0);
    await expect(phone.page.getByTestId("answer-line")).toHaveCount(1);
  } finally {
    await closeAll([phone]);
  }
});

// 7.1 (P0 item 5, closed 10-10): the 995 in the fixed template is a one-tap dial link. Done in
// components/daily/AnswerView.tsx with components/daily/dial.ts (a link around the digits exactly as the template writes
// them, at least 48 px tall), not with components/ui/EmergencyBlock.tsx: the look waits for the designer, and the block
// adds words of its own ("打 995"). Only the template's number is a link: R2's "call 995" is Dr Lim's own words.
test("急症: the 995 in the template is a one-tap dial link (tel:995), at least 48 px tall, the words unchanged; R2's 995 is not a link (7.1)", async ({
  browser,
  request,
}) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await joinAs(browser, s.join_code, "patient", "/p/today");
  const pp = phone.page;
  try {
    for (const c of [CASES[0], CASES[2]]) {
      if (c.lang === "en") await setLang(pp, "en");
      const seen = await askOnPhone(pp, c.text);
      expect(seen.body?.route, c.text).toBe("emergency");
      await expect(pp.getByTestId("answer-line").first().getByTestId("answer-text")).toHaveText(c.lang === "en" ? CALL_995.en : CALL_995.zh);
      const dial = pp.locator('[data-testid="ask-answer"] a[href^="tel:995"]');
      await expect(dial).toBeVisible({ timeout: 2000 });
      await expect(dial).toHaveAttribute("href", "tel:995");
      await expect(dial).toHaveText("995");
      await expect(dial, "looks like a link").toHaveCSS("text-decoration-line", "underline");
      expect((await dial.boundingBox())?.height ?? 0, `${c.lang}: tap height`).toBeGreaterThanOrEqual(48);
      expect(await tapEdges(dial), `${c.lang}: a tap at the top and the bottom edge reaches the link`).toEqual([true, true]);
      await expect(pp.locator('[data-testid="ask-answer"] a')).toHaveCount(1);
      const r2 = pp.locator('[data-testid="answer-line"][data-source="visit:v1:R2"]');
      await expect(r2.getByTestId("answer-text")).toHaveText(R2);
      await expect(r2.locator("a")).toHaveCount(0);
    }
  } finally {
    await closeAll([phone]);
  }
});
