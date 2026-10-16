/**
 * Chain 13 家属授权, end to end (docs/plan/e2e-chains.md section 13): what Wei Ling's phone gets is what he allows.
 *
 *   D43 18:00. Her phone joins through /join (家属) and lands on /f; his phone joins through /join (本人).
 *   1. he writes a note on Today (log_only -> note)            note row; her /f, her /api/family/view: nothing of it
 *   2. he opens 家人能看到什么 from Today and turns 笔记 on      family_grant notes = true; her /f shows the note < 2 s
 *   3. he turns it off again                                    family_grant notes = false; gone from /f < 2 s
 *   4. her own event stream (the raw bytes her EventSource reads) never carried the note, on or off
 *   5. her phone never sees his pages: every /p/* answers her with a redirect to /f that carries none of his words,
 *      and her browser lands on /f
 *   6. her phone never acts for him: doses, asking, notes, readings, switches, the clock, confirming a visit are
 *      403 patient_only, and his records are unchanged
 *
 * A second test: a private window on her phone cannot use the join code she was given to join his session as him
 * (gap 13.1, fixed 10-10 by lib/family/join.ts; it was marked test.fail() until then).
 */
import { expect, test } from "@playwright/test";
import { BASE_URL, closeAll, createSession, getJson, askOnPhone, openEventStream, textBelow, waitLive, CREW_HEADERS, joinThroughPageAsCrew } from "../helpers";

// C2 (lib/crew/gate.ts): the story clock is the film crew's; this file's request fixture carries the crew key, and phones
// that join through the /join page are the crew's phones (joinThroughPageAsCrew)
test.use({ extraHTTPHeaders: CREW_HEADERS });

const NOTE = "今天下午在大巴窑中心坐了一会儿，跟老朋友喝茶。";
const NOTE_D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const R1 = "At home, we want it below 135 over 85.";
/** his pages (every /p/* that renders) */
const HIS_PAGES = ["/p/today", "/p/bp", "/p/meds", "/p/meds/med-amlodipine", "/p/meds/add", "/p/questions", "/p/visit", "/p/visit/v1/review", "/p/brief", "/p/family"];

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 43, story_time: "18:00" });
  const cookie = { cookie: `rp_session=${s.id}` };
  for (const p of ["/join", "/f", "/p/today", "/p/family", ...HIS_PAGES]) await request.get(p, { headers: cookie });
  for (const p of ["/api/family/view", "/api/family/grants", "/api/family/alerts", "/api/notes", "/api/reminders"]) await request.get(`${p}?session=${s.id}`);
});

test("家属授权: he turns a section on -> she sees it -> he turns it off -> she no longer sees it; her phone never sees his pages and never acts for him", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 43, story_time: "18:00" });
  const daughter = await joinThroughPageAsCrew(browser, s.join_code, "family");
  const phone = await joinThroughPageAsCrew(browser, s.join_code, "patient");
  const fp = daughter.page;
  const pp = phone.page;
  await expect(fp.getByTestId("page-family")).toBeVisible();
  await expect(pp.getByTestId("page-today")).toBeVisible();
  // her raw event stream, open before he writes anything
  const herStream = await openEventStream(daughter, s.id);
  expect(herStream.status).toBe(200);
  await expect.poll(() => herStream.text()).toContain("connected");

  try {
    // start: the seed's switches; his notes are not hers to see
    await expect(fp.getByTestId("family-allowed-notes")).toHaveAttribute("data-on", "false");
    await expect(fp.getByTestId("family-notes")).toHaveCount(0);

    // 1. he writes a note on Today
    const note = await askOnPhone(pp, NOTE);
    expect(note.status).toBe(200);
    expect(note.body?.route).toBe("log_only");
    await expect(pp.getByTestId("ask-answer")).toContainText("记下了");
    const hisNotes = (await getJson<{ notes: { day: number; text: string }[] }>(phone, "/api/notes", s.id)).notes;
    expect(hisNotes.filter((n) => n.day === 43).map((n) => n.text)).toEqual([NOTE]);
    // nothing of it reaches her: not on /f, not in her view
    await fp.waitForTimeout(1500);
    expect(await fp.evaluate(() => document.body.innerText)).not.toContain(NOTE);
    expect(JSON.stringify(await getJson(daughter, "/api/family/view", s.id))).not.toContain(NOTE);

    // 2. he opens 家人能看到什么 from Today and turns 笔记 on
    await pp.getByTestId("link-family-grants").click();
    await expect(pp.getByTestId("page-family-grants")).toBeVisible();
    const sw = pp.getByTestId("grant-notes");
    await expect(sw).toHaveAttribute("data-on", "false");
    let t0 = Date.now();
    await sw.click();
    await expect(sw).toHaveAttribute("data-on", "true");
    await expect(fp.getByTestId("family-notes")).toContainText(NOTE, { timeout: 2000 });
    const onMs = Date.now() - t0;
    await expect(fp.getByTestId("family-notes")).toContainText(NOTE_D37); // his earlier notes come with it
    await expect(fp.getByTestId("family-allowed-notes")).toHaveAttribute("data-on", "true");
    expect((await getJson<{ items: Record<string, boolean> }>(phone, "/api/family/grants", s.id)).items.notes).toBe(true);
    expect(JSON.stringify(await getJson(daughter, "/api/family/view", s.id))).toContain(NOTE);
    expect(await textBelow(fp, 18)).toEqual([]);

    // 3. he turns it off: gone from her phone
    t0 = Date.now();
    await sw.click();
    await expect(sw).toHaveAttribute("data-on", "false");
    await expect(fp.getByTestId("family-notes")).toHaveCount(0, { timeout: 2000 });
    const offMs = Date.now() - t0;
    test.info().annotations.push({ type: "switch -> /f", description: `on ${onMs} ms, off ${offMs} ms` });
    await expect(fp.getByTestId("family-allowed-notes")).toHaveAttribute("data-on", "false");
    expect((await getJson<{ items: Record<string, boolean> }>(phone, "/api/family/grants", s.id)).items.notes).toBe(false);
    expect(JSON.stringify(await getJson(daughter, "/api/family/view", s.id))).not.toContain(NOTE);
    await fp.reload();
    await waitLive(fp);
    expect(await fp.evaluate(() => document.body.innerText)).not.toContain(NOTE);

    // 4. her own stream carried the switch changes but never the note, what he typed, or his visit lines
    await expect.poll(() => herStream.text()).toContain("family_grant.changed");
    const streamed = herStream.text();
    for (const x of [NOTE, NOTE_D37, R1, "note.logged", "ask.received", "rp_member"]) expect(streamed, `her stream carries ${x}`).not.toContain(x);
  } finally {
    herStream.stop();
  }

  // 5. her phone never sees his pages: a redirect to /f that carries none of his words; her browser lands on /f
  for (const p of HIS_PAGES) {
    const raw = await daughter.context.request.get(p, { maxRedirects: 0 });
    expect.soft([302, 303, 307, 308], `${p}: ${raw.status()}`).toContain(raw.status());
    expect.soft(raw.headers()["location"] ?? "", p).toMatch(/\/f$/);
    const body = await raw.text();
    for (const x of [NOTE, NOTE_D37, R1, "150/95"]) expect.soft(body.includes(x), `${p} answer carries ${x}`).toBe(false);
  }
  for (const p of ["/p/today", "/p/questions", "/p/visit/v1/review"]) {
    await fp.goto(p);
    await expect(fp, p).toHaveURL(/\/f$/);
    await expect(fp.getByTestId("page-family")).toBeVisible();
    expect(await fp.evaluate(() => document.body.innerText), p).not.toContain(NOTE);
  }

  // 6. her phone never acts for him; his records stay as they were
  const before = {
    doses: await getJson<{ doses: unknown[] }>(phone, "/api/doses", s.id),
    notes: (await getJson<{ notes: unknown[] }>(phone, "/api/notes", s.id)).notes.length,
    grants: (await getJson<{ items: Record<string, boolean> }>(phone, "/api/family/grants", s.id)).items,
    day: (await getJson<{ session: { story_day: number; story_time: string | null } }>(phone, "/api/session", s.id)).session,
  };
  const q = `?session=${s.id}`;
  const acts: [string, string, Record<string, unknown>][] = [
    ["tick his tablet", `/api/doses${q}`, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }],
    ["ask in his name", `/api/ask${q}`, { text: "我今天好累", locale: "zh-Hans" }],
    ["write his note", `/api/notes${q}`, { text: "我今天好累" }],
    ["record his reading", `/api/bp${q}`, { systolic: 128, diastolic: 80 }],
    ["change his switches", `/api/family/grants${q}`, { items: { notes: true, visit_transcripts: true } }],
    ["move the story clock", `/api/clock${q}`, { day: 44 }],
    ["confirm his visit", `/api/visits/v1/confirm${q}`, { mine: [], items: {} }],
  ];
  for (const [what, url, data] of acts) {
    const res = await daughter.context.request.post(url, { data });
    expect.soft(res.status(), what).toBe(403);
    expect.soft(((await res.json().catch(() => ({}))) as { error?: string }).error, what).toBe("patient_only");
  }
  // /f has no button that acts for him
  await fp.goto("/f");
  await waitLive(fp);
  await expect(fp.locator("[data-testid^='dose-btn'], [data-testid^='grant-'], [data-testid='ask-input']")).toHaveCount(0);
  const after = {
    doses: await getJson<{ doses: unknown[] }>(phone, "/api/doses", s.id),
    notes: (await getJson<{ notes: unknown[] }>(phone, "/api/notes", s.id)).notes.length,
    grants: (await getJson<{ items: Record<string, boolean> }>(phone, "/api/family/grants", s.id)).items,
    day: (await getJson<{ session: { story_day: number; story_time: string | null } }>(phone, "/api/session", s.id)).session,
  };
  expect(after.doses).toEqual(before.doses);
  expect(after.notes).toBe(before.notes);
  expect(after.grants).toEqual(before.grants);
  expect({ day: after.day.story_day, time: after.day.story_time }).toEqual({ day: before.day.story_day, time: before.day.story_time });
  await closeAll([phone, daughter]);
});

// Gap 13.1 (B1 verification 10-10 defect 1): the join code is shared with her, and POST /api/session/join used to take
// any role from the body, so a private window on her phone (no cookies) joined his session as "patient" and then read
// his notes. Fixed 10-10 by the family-privacy line (lib/family/join.ts, called by app/api/session/join/route.ts): once
// his phone has joined as the patient, the code cannot make another device him (403 patient_exists). This test was
// marked test.fail() until it passed unexpectedly in the final full run of 10-10; now it is a plain guard. The refusal
// must be a 403 (not merely "not ok"), so a server error can never pass for it.
test("家属授权: her phone in a private window cannot join his session as him with the code she was given (13.1)", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 43, story_time: "18:00" });
  const phone = await joinThroughPageAsCrew(browser, s.join_code, "patient");
  const daughter = await joinThroughPageAsCrew(browser, s.join_code, "family");
  await expect(daughter.page.getByTestId("page-family")).toBeVisible();
  const privateWindow = await browser.newContext({ baseURL: BASE_URL });
  try {
    // without cookies her private window is nobody in his session (B1, lib/family/identity.ts "stranger")
    expect((await privateWindow.request.get(`/api/notes?session=${s.id}`)).status()).toBe(403);
    const join = await privateWindow.request.post("/api/session/join", { data: { code: s.join_code, role: "patient" } });
    expect(join.status(), `join as patient from her private window: ${await join.text()}`).toBe(403);
    const notes = await privateWindow.request.get(`/api/notes?session=${s.id}`);
    expect(notes.status(), "his notes from her private window").toBe(403);
    // his own phone is still him
    expect((await phone.context.request.get(`/api/notes?session=${s.id}`)).status()).toBe(200);
  } finally {
    await privateWindow.close();
    await closeAll([phone, daughter]);
  }
});
