/**
 * 「我的药」 after the timeline draft (web/progress/fe-06.md): the screens and states that are new with the rebuild pass
 * the automatic page checks (架构审核 「每个页面自动查」: 360 wide with no sideways scroll, text at least 18px, targets at
 * least 48x48, colour contrast AA), in 华语 and in English. The states the first build already had are checked by
 * e2e/f-elder-pages.spec.ts, f-round2.spec.ts and f-round3.spec.ts; here:
 *
 *   the list with every origin's card and a medicine that waits for its label (06-6), the card of that medicine,
 *   one medicine's card (06-7), the explain card as its own screen (06-8), the checklist as its own screen with an
 *   answer of each kind (06-9), the step before the camera with the example's samples (06-3), every line of the label
 *   on one screen (06-4a), the same bag again (06-4b: nothing is written), typing it in with its button in the dock
 *   strip, in reach on a step taller than the phone (06-5), the screen of a box nobody identified with
 *   his choice (08-1b, 08-2) and its card after the pharmacist answered (08-3), and a photo nothing can be read from
 *   (the red box: what is still there, what he can do).
 *
 * Needs the app on PW_PORT with RIPPLE_DEV_TOOLS=1 and SPEECH_PROVIDER=devfake (scripts/record/serve.mjs, or `next dev`
 * with web/.env.local); skipped on any other server.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Singapore" });

const LABEL = (name: string) => path.join(process.cwd(), "fixtures", "labels", `${name}.png`);

async function check(page: Page): Promise<void> {
  // let entry animations finish (half-transparent text would read as low contrast)
  await page.waitForTimeout(400);
  await expectPageChecks(page, { side: "elder" });
}

async function signUp(page: Page, space: "blank" | "example"): Promise<void> {
  const res = await page.request.post("/api/dev/accounts", { data: { login: `m6${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space, display_name: "陈先生" } });
  expect(res.status(), await res.text()).toBe(201);
}

/** A visit recorded and turned into text by the stand-in (fixture), through the routes; then 「是」 to the prescription. */
async function prescribed(api: APIRequestContext, fixture: string): Promise<void> {
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(started.status(), await started.text()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status, { timeout: 60_000 }).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  const view = ((await (await api.get(`/api/visits/${visitId}`)).json()) as { view: { cards: { kind: string; rows: { variant: string; itemId: string }[] }[] } }).view;
  for (const c of view.cards) {
    if (c.kind !== "doc" || !c.rows.some((r) => r.variant === "new_med" || r.variant === "med")) continue;
    const res = await api.post(`/api/visits/${visitId}/verdict`, { data: { items: c.rows.map((r) => r.itemId), verdict: "right", locale: "zh-Hans" } });
    expect(res.status(), await res.text()).toBe(200);
  }
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  test.skip(health.provider !== "devfake", "needs SPEECH_PROVIDER=devfake (scripts/record/serve.mjs)");
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: true } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

for (const locale of ["zh-Hans", "en"] as const) {
  test(`the example account's medicines: the list, the cards, the explain card, the checklist, the label's lines, the same bag again (${locale})`, async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const zh = locale === "zh-Hans";
    await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    await signUp(page, "example");
    await page.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
    await prescribed(page.request, "v3");

    // 06-6: every origin has its card; Losartan waits for its label and is said first
    await page.goto("/p/meds");
    await expect(page.getByTestId("meds-list")).toHaveAttribute("data-count", "4");
    await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "awaiting_label");
    await expect(page.getByTestId("meds-awaiting")).toContainText(zh ? "Losartan 等你拍药袋" : "Losartan is waiting for its label");
    for (const origin of ["prescription", "self_bought", "relative", "supplement"]) await expect(page.getByTestId(`meds-group-${origin}`)).toBeVisible();
    await expect(page.getByTestId("meds-group-supplement")).toContainText(zh ? "还没有" : "None yet");
    await check(page);

    // the card of the medicine that waits
    await page.getByTestId("med-row-med-losartan").click();
    await expect(page.getByTestId("med-awaiting")).toBeVisible();
    await expect(page.getByTestId("med-photograph")).toBeVisible();
    await check(page);

    // 06-7: one medicine's card; its sections, the way to the explain card and to the checklist
    await page.goto("/p/meds/med-amlodipine");
    const card = page.getByTestId("med-card");
    await expect(card).toHaveAttribute("data-view", "card");
    await expect(page.getByTestId("card-purpose")).toBeVisible();
    await expect(page.getByTestId("card-how-to-take")).toContainText("Take ONE tablet every MORNING");
    await expect(page.getByTestId("med-slots")).toHaveAttribute("data-source", "label");
    await expect(page.getByTestId("card-leaflet")).toBeVisible();
    // the explain card's lines and the checklist are not on the card itself any more
    await expect(page.getByTestId("explain-line")).toHaveCount(0);
    await expect(page.getByTestId("card-checklist")).toHaveCount(0);
    await check(page);

    // 06-8: the explain card, a screen of its own; the way back is the card
    await page.getByTestId("card-explain-open").click();
    await expect(card).toHaveAttribute("data-view", "why");
    await expect(page).toHaveURL(/\/p\/meds\/med-amlodipine\?view=why$/);
    await expect(page.getByTestId("card-explain").locator('[data-testid="explain-line"][data-kind="doctor"]')).toContainText("This tablet works quietly");
    await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/meds/med-amlodipine");
    await check(page);
    // the doctor's line has its recording: 「听原声」 plays it, a second tap stops it
    const listen = page.getByTestId("card-explain").getByTestId("card-listen").first();
    await listen.getByRole("button").click();
    await expect(listen).toHaveAttribute("data-playing", "true");
    await listen.getByRole("button").click();
    await expect(listen).toHaveAttribute("data-playing", "false");

    // 06-9: the checklist, a screen of its own: 知道 for one, 不确定 for another (on his list), kept after a reload
    await page.getByTestId("card-check-open").click();
    await expect(card).toHaveAttribute("data-view", "check");
    await page.getByTestId("check-purpose-know").click();
    await expect(page.getByTestId("check-purpose")).toHaveAttribute("data-answer", "know");
    await page.getByTestId("check-feel_fine-unsure").click();
    await expect(page.getByTestId("check-feel_fine")).toHaveAttribute("data-answer", "unsure");
    await expect(page.getByTestId("check-feel_fine").locator('a[href="/p/questions"]')).toBeVisible();
    await check(page);
    await page.reload();
    await expect(page.getByTestId("check-purpose")).toHaveAttribute("data-answer", "know");
    await expect(page.getByTestId("check-feel_fine")).toHaveAttribute("data-answer", "unsure");
    await expect(page.getByTestId("check-when")).toHaveAttribute("data-answer", "none");

    // 06-3: the step before the camera, with the example's samples (the one for this medicine first)
    await page.goto("/p/meds/add?med=med-losartan");
    await expect(page.getByTestId("add-photo")).toBeVisible();
    await expect(page.locator('[data-testid^="add-sample-"]').first()).toHaveAttribute("data-testid", "add-sample-losartan");
    await check(page);

    // 06-4a: every line of the label on one screen; the first line still to answer carries the walk's hooks
    await page.getByTestId("add-sample-losartan").click();
    const lines = page.getByTestId("add-check");
    await expect(lines).toBeVisible({ timeout: 30_000 });
    await expect(lines).toHaveAttribute("data-total", "5");
    await expect(lines).toHaveAttribute("data-index", "0");
    for (const f of ["drug_text", "strength", "directions", "dispensed", "clinic"]) await expect(page.getByTestId(`add-row-${f}`)).toBeVisible();
    await expect(page.getByTestId("add-check-value")).toHaveAttribute("data-field", "drug_text");
    await expect(page.getByTestId("add-check-left")).toHaveAttribute("data-left", "5");
    // the label's own time words say which reminder they set
    await expect(page.getByTestId("add-row-directions")).toContainText(zh ? "早上提醒" : "Morning reminder");
    await check(page);
    // a line answered out of turn: the walk's hooks stay on the first line still to answer
    await page.getByTestId("add-right-clinic").click();
    await expect(page.getByTestId("add-row-clinic")).toHaveAttribute("data-state", "yes");
    await expect(lines).toHaveAttribute("data-index", "0");
    await expect(page.getByTestId("add-check-left")).toHaveAttribute("data-left", "4");
    await page.getByTestId("add-line-right").click();
    await expect(lines).toHaveAttribute("data-index", "1");
    // 「改」 opens the line's own field; 「改好了」 keeps his words, marked as his
    await page.getByTestId("add-line-change").click();
    await page.getByTestId("add-edit-input").fill("50 mg tablet");
    await check(page);
    await page.getByTestId("add-line-changed").click();
    await expect(page.getByTestId("add-row-strength")).toHaveAttribute("data-state", "edit");
    await expect(page.getByTestId("add-row-strength")).toContainText(zh ? "你改过" : "You changed this");
    await expect(lines).toHaveAttribute("data-index", "2");
    // nothing is saved while a line is still to answer; the last answer saves
    expect(((await (await page.request.get("/api/meds")).json()) as { groups: { items: { id: string; status: string }[] }[] }).groups.flatMap((g) => g.items).find((m) => m.id === "med-losartan")?.status).toBe("awaiting_label");
    await page.getByTestId("add-line-right").click();
    await page.getByTestId("add-line-right").click();
    await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed", { timeout: 30_000 });
    await expect(page.getByTestId("add-done")).toHaveAttribute("data-med", "med-losartan");
    await check(page);

    // 06-4b: the amlodipine bag again: said before anything is asked, and nothing is written
    const before = await (await page.request.get("/api/meds/med-amlodipine")).json();
    await page.goto("/p/meds/add");
    await page.getByTestId("add-origin-prescription").click();
    await page.getByTestId("add-how-photo").click();
    await page.getByTestId("add-sample-amlodipine").click();
    const same = page.getByTestId("add-same");
    await expect(same).toBeVisible({ timeout: 30_000 });
    await expect(same).toHaveAttribute("data-med", "med-amlodipine");
    await expect(page.getByTestId("add-same-box")).toContainText(zh ? "这盒已经在你的药里。" : "This one is already in your medicines.");
    await expect(page.getByTestId("add-same-box")).toContainText("Amlodipine 5 mg");
    await expect(page.getByTestId("add-check")).toHaveCount(0);
    await check(page);
    expect(await (await page.request.get("/api/meds/med-amlodipine")).json()).toEqual(before);
    // he may check this label again all the same, or go back to the camera
    await page.getByTestId("add-same-check").click();
    await expect(page.getByTestId("add-check")).toHaveAttribute("data-total", "5");
    await page.locator('[data-rp="back"]').click();
    await expect(page.getByTestId("add-photo")).toBeVisible();
    await expect(page).toHaveURL(/\/p\/meds\/add$/);

    // 06-5: typed in by himself. The step's button is in the draft's dock strip: on this account the blocks are taller
    // than the phone, and 「存好」 is in reach all the same, above the tab bar, with nothing scrolled
    await page.goto("/p/meds/add?manual=1");
    await page.getByTestId("add-origin-self_bought").click();
    await expect(page.getByTestId("add-manual")).toBeVisible();
    await page.getByTestId("add-manual-name").fill("Ibuprofen 200 mg");
    await page.getByTestId("add-slot-night").click();
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8), "the step is taller than the phone").toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const save = (await page.getByTestId("add-manual-save").boundingBox())!;
    const tabs = (await page.locator(".rpu-tabs").boundingBox())!;
    expect(save.y).toBeGreaterThan(0);
    expect(save.y + save.height, "「存好」 ends above the tab bar").toBeLessThanOrEqual(tabs.y + 0.5);
    await check(page);

    // 08-3: the box nobody identified, after the pharmacist answered: the fixed sentence, the answer, the question
    await page.goto("/p/meds/med-relative-box");
    await expect(page.getByTestId("med-unknown-sentence")).toContainText("I'm not able to identify that medication, please check with your pharmacist.");
    await expect(page.getByTestId("med-question")).toHaveAttribute("data-status", "answered");
    await expect(page.getByTestId("med-question-answer")).toContainText("The label is only in Chinese");
    await page.getByTestId("unknown-not-taking").click();
    await expect(page.getByTestId("card-unknown-choices")).toHaveAttribute("data-status", "not_taking");
    await check(page);
  });
}

test("a box nobody identified, right after the photo: his choice is on that screen (08-1b, 08-2); a photo nothing can be read from says what is still there", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, "blank");
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-relative").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-file").setInputFiles(LABEL("relative_box"));
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("add-line-right").click();
  const unknown = page.getByTestId("add-unknown");
  await expect(unknown).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("add-unknown-sentence")).toContainText("I'm not able to identify that medication, please check with your pharmacist.");
  await expect(page.getByTestId("add-unknown-sentence")).toContainText("我认不出这个药，请拿去问药剂师。");
  await expect(page.getByTestId("add-unknown-on-list")).toContainText("已加进问题单：问药剂师");
  // the box's own dosing words are on his photo only, never in the page's words
  await expect(page.locator("body")).not.toContainText("一次六粒");
  const choices = page.getByTestId("add-unknown-choices");
  await expect(choices).toHaveAttribute("data-status", "none");
  await check(page);
  await page.getByTestId("add-unknown-not-taking").click();
  await expect(choices).toHaveAttribute("data-status", "not_taking");
  await expect(page.getByTestId("add-unknown-doctor-list")).toHaveCount(0);
  await page.getByTestId("add-unknown-bring").click();
  await expect(choices).toHaveAttribute("data-status", "bring_to_doctor");
  await expect(page.getByTestId("add-unknown-doctor-list")).toContainText("已在下次看诊的问题单里");
  await check(page);
  const medId = (await unknown.getAttribute("data-med"))!;
  // the card knows the same choice
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("med-unknown-sentence")).toBeVisible();
  await expect(page.getByTestId("card-unknown-choices")).toHaveAttribute("data-status", "bring_to_doctor");
  await expect(page.getByTestId("unknown-on-list")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/p/meds/${medId}$`));

  // a photo nothing can be read from: the red box, and the ways on
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-self_bought").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-file").setInputFiles(path.join(process.cwd(), "public", "icons", "icon-192.png"));
  const error = page.getByTestId("add-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toHaveAttribute("data-problem", "unreadable");
  await expect(error).toContainText("药袋看不清，再拍一张。");
  await expect(error).toContainText("你的药单没有变。");
  await check(page);
  await page.getByTestId("add-retry").click();
  await expect(page.getByTestId("add-how")).toBeVisible();
});
