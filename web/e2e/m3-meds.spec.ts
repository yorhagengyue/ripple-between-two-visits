/**
 * M3 flows on the running app (docs/plan/tasks/M3-meds.md): photograph a label (signed upload -> /api/labels/read
 * -> he checks every line -> /api/meds), the medicine card, the unknown medicine and the pharmacist's later answer,
 * the self-bought ibuprofen. Offline: LLM_PROVIDER=mock reads web/fixtures/cassettes/vision.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { api, closeAll, createSession, openDevice, textBelow, waitLive, CREW_HEADERS } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

const LABELS = path.join(__dirname, "..", "fixtures", "labels");
const png = (name: string) => path.join(LABELS, `${name}.png`);
const expected = (name: string) => JSON.parse(readFileSync(path.join(LABELS, `${name}.expected.json`), "utf8"));
const UNKNOWN = "I'm not able to identify that medication, please check with your pharmacist.";
const R3 =
  "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.";
const P1_U03 = "The label is only in Chinese and I can't confirm what's inside. Please don't take it for now. Bring it to your doctor at your next visit.";
const P1_U01 = "Can I record? I want to ask about this medicine.";
/** what the screen shows under R3: the visit date, the time point in the recording, the stand-in voice */
const R3_SHOWN = {
  "zh-Hans": { tag: "● 医生说", detail: "2026年9月1日 · 0:20 处 · 代录音" },
  en: { tag: "● Doctor said", detail: "1 Sep 2026 · at 0:20 · stand-in voice" },
} as const;

async function card(request: APIRequestContext, sid: string, medId: string, locale = "en") {
  const res = await request.get(`/api/meds/${medId}?session=${sid}&locale=${locale}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).card;
}

/** Photograph the relative's box through the API (signed upload -> read -> confirm): the unknown medicine and its question. */
async function addUnknownBox(request: APIRequestContext, sid: string) {
  const link = (await api(request, "/api/upload-url", sid, { kind: "label", content_type: "image/png" })) as {
    path: string;
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  const put = await request.fetch(link.url, { method: link.method, headers: link.headers, data: readFileSync(png("relative_box")) });
  expect(put.status()).toBe(200);
  const read = (await api(request, "/api/labels/read", sid, { path: link.path })) as { read_token: string };
  const res = await request.post(`/api/meds?session=${sid}`, { data: { read_token: read.read_token, confirmed: ["drug_text"], origin: "relative", locale: "zh-Hans" } });
  expect(res.status()).toBe(201);
  const out = await res.json();
  expect(out.outcome).toBe("unidentified");
  return out as { med: { id: string }; questions: { id: string }[] };
}

/** A class list that says "undefined" means a style object came out empty (see components/meds/classes.ts). */
async function noUndefinedClass(page: Page, where: string) {
  expect(await page.locator('[class~="undefined"]').count(), where).toBe(0);
}

async function tickAllAndSave(page: Page) {
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  const save = page.getByTestId("add-save");
  await expect(save).toBeDisabled();
  for (const btn of await page.locator("[data-testid^='add-right-']").all()) await btn.click();
  await expect(save).toBeEnabled();
  const confirmed = page.waitForResponse((r) => r.url().includes("/api/meds") && r.request().method() === "POST");
  await save.click();
  const res = await confirmed;
  expect(res.status()).toBe(201);
  await expect(page.getByTestId("add-result")).toBeVisible();
  return res.json();
}

test.beforeAll(async ({ request }) => {
  // compile the routes once so the flows below measure the app, not the dev compiler
  const s = await createSession(request);
  for (const p of ["/p/meds", "/p/meds/med-amlodipine", "/p/meds/add"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
  await request.get(`/api/meds?session=${s.id}`);
  await request.get(`/api/labels/sample?name=amlodipine`);
});

test("API: amlodipine label -> fields equal expected.json -> label_confirmed; the card before and after", async ({ request }) => {
  const s = await createSession(request, { story_day: 8 });
  await expect((await request.patch(`/api/meds/med-amlodipine?session=${s.id}`, { data: { action: "relabel" } })).status()).toBe(200);
  const before = await card(request, s.id, "med-amlodipine");
  expect(before.awaitingLabel).toBe(true);
  expect(before.howToTake).toEqual([]);
  expect(before.purpose[0]).toMatchObject({ text: R3, chip: { kind: "doctor", date: "2026-09-01" } });
  expect(before.leaflet.length).toBeGreaterThan(0);

  const link = (await api(request, "/api/upload-url", s.id, { kind: "label", content_type: "image/png" })) as {
    path: string;
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  const put = await request.fetch(link.url, { method: link.method, headers: link.headers, data: readFileSync(png("amlodipine")) });
  expect(put.status()).toBe(200);
  const read = (await api(request, "/api/labels/read", s.id, { path: link.path })) as { read_token: string; fields: Record<string, unknown> };
  const want = expected("amlodipine");
  for (const k of ["drug_text", "drug_id", "strength", "directions", "slots", "dispensed", "clinic"]) expect(read.fields[k], k).toEqual(want[k]);

  const res = await request.post(`/api/meds?session=${s.id}`, {
    data: { read_token: read.read_token, confirmed: ["drug_text", "strength", "directions", "dispensed", "clinic"], med_id: "med-amlodipine", locale: "en" },
  });
  expect(res.status()).toBe(201);
  const out = await res.json();
  expect(out.outcome).toBe("label_confirmed");
  expect(out.med.status).toBe(want.expected_status_after_confirm);

  const after = await card(request, s.id, "med-amlodipine");
  expect(after.awaitingLabel).toBe(false);
  expect(after.purpose.map((l: { chip: { kind: string } }) => l.chip.kind)).toEqual(["doctor", "leaflet"]);
  expect(after.howToTake[0]).toMatchObject({ text: want.directions, chip: { kind: "label", date: want.dispensed } });
});

test("UI: amlodipine card awaiting its label, photograph it, check each line, then the label part appears", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 8 });
  await request.patch(`/api/meds/med-amlodipine?session=${s.id}`, { data: { action: "relabel" } });
  const phone = await openDevice(browser, s.id, "/p/meds/med-amlodipine");
  const { page } = phone;

  await expect(page.getByTestId("awaiting-label")).toBeVisible();
  await expect(page.getByTestId("card-how-to-take")).toHaveCount(0);
  await expect(page.getByTestId("card-leaflet")).toBeVisible();
  const purpose = page.getByTestId("card-purpose").getByTestId("card-line");
  await expect(purpose.first()).toHaveAttribute("data-chip", "doctor");
  await expect(purpose.first()).toContainText(R3);
  await expect(purpose.first()).toContainText("医生说");
  await expect(purpose.first().getByTestId("card-line-source")).toHaveText(R3_SHOWN["zh-Hans"].detail);
  await expect(purpose.nth(1)).toHaveAttribute("data-chip", "leaflet");
  expect(await textBelow(page, 18), "card awaiting label").toEqual([]);
  await noUndefinedClass(page, "card awaiting label");

  await page.getByTestId("awaiting-photograph").click();
  await expect(page.getByTestId("add-photo")).toBeVisible();
  await waitLive(page);
  expect(await textBelow(page, 18), "add: photo step").toEqual([]);
  await page.getByTestId("add-file").setInputFiles(png("amlodipine"));
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("add-value-drug_text")).toHaveText("AMLODIPINE 5MG TABLET");
  await expect(page.getByTestId("add-value-strength")).toHaveText("5 mg");
  await expect(page.getByTestId("add-value-directions")).toHaveText("Take ONE tablet every MORNING");
  await expect(page.getByTestId("add-value-dispensed")).toHaveText("2026年9月1日");
  await expect(page.getByTestId("add-value-clinic")).toHaveText("Blossom Family Clinic (fictional)");
  expect(await textBelow(page, 18), "add: check step").toEqual([]);
  await noUndefinedClass(page, "add: check step");

  const out = await tickAllAndSave(page);
  expect(out.outcome).toBe("label_confirmed");
  await expect(page.getByTestId("add-result")).toHaveAttribute("data-outcome", "label_confirmed");
  await expect(page.getByTestId("add-result").getByTestId("med-status")).toHaveAttribute("data-status", "label_confirmed");
  expect(await textBelow(page, 18), "add: result").toEqual([]);
  await noUndefinedClass(page, "add: result");

  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("page-med-detail")).toHaveAttribute("data-status", "label_confirmed");
  await expect(page.getByTestId("awaiting-label")).toHaveCount(0);
  const how = page.getByTestId("card-how-to-take").getByTestId("card-line");
  await expect(how).toHaveAttribute("data-chip", "label");
  await expect(how).toContainText("药袋");
  await expect(how).toContainText("Take ONE tablet every MORNING");
  await expect(page.getByTestId("card-purpose").getByTestId("card-line").first()).toHaveAttribute("data-chip", "doctor");
  await closeAll([phone]);
});

test("UI: R3 on the amlodipine card shows who said it, the visit date and the time point (D8, D29, D43; 华语 and English)", async ({ browser, request }) => {
  test.setTimeout(90_000);
  for (const day of [8, 29, 43]) {
    const s = await createSession(request, { story_day: day });
    const phone = await openDevice(browser, s.id, "/p/meds/med-amlodipine");
    const { page } = phone;
    for (const lang of ["zh-Hans", "en"] as const) {
      if (lang === "en") {
        await phone.context.addCookies([{ name: "rp_lang", value: "en", url: page.url() }]);
        await page.reload();
        await waitLive(page);
      }
      const r3 = page.getByTestId("card-purpose").getByTestId("card-line").first();
      await expect(r3, `D${day} ${lang}`).toHaveAttribute("data-source", "visit:v2:R3");
      await expect(r3.getByTestId("card-line-text")).toHaveText(R3);
      await expect(r3.getByTestId("card-line-tag")).toHaveText(R3_SHOWN[lang].tag);
      await expect(r3.getByTestId("card-line-source"), `D${day} ${lang}`).toHaveText(R3_SHOWN[lang].detail);
    }
    await closeAll([phone]);
  }
});

test("UI: the box from a relative -> the fixed sentence and one question for the pharmacist; D12 answer links to it", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 8 });
  const phone = await openDevice(browser, s.id, "/p/meds/add");
  const { page } = phone;
  expect(await textBelow(page, 18), "add: origin step").toEqual([]);
  await page.getByTestId("add-origin-relative").click();
  await page.getByTestId("add-sample-relative_box").click(); // the sample takes the same upload path as a photo
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-testid^='add-field-']")).toHaveCount(1);
  await expect(page.getByTestId("add-value-drug_text")).toHaveText("宁和平压丸");
  for (const banned of expected("relative_box").must_not_relay as string[]) await expect(page.locator("body")).not.toContainText(banned);

  const out = await tickAllAndSave(page);
  expect(out.outcome).toBe("unidentified");
  expect(out.answer.fixedText).toBe(UNKNOWN);
  expect(out.questions).toHaveLength(1);
  expect(out.questions[0]).toMatchObject({ for: "pharmacist", origin: "unidentified_medicine" });
  const sentence = page.getByTestId("add-answer-sentence");
  await expect(sentence).toHaveCount(1);
  await expect(sentence).toContainText(UNKNOWN);
  await expect(page.getByTestId("add-question")).toHaveCount(1);
  expect(await textBelow(page, 18), "add: unknown result").toEqual([]);

  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("card-unknown")).toContainText(UNKNOWN);
  await expect(page.getByTestId("card-question")).toHaveAttribute("data-status", "open");
  await expect(page.getByTestId("answer-picker")).toHaveCount(0); // the pharmacy visit is on D12
  for (const banned of expected("relative_box").must_not_relay as string[]) await expect(page.locator("body")).not.toContainText(banned);

  await api(request, "/api/clock", s.id, { day: 12 });
  await expect(page.getByTestId("answer-picker")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("answer-choice")).toHaveCount(3); // the pharmacy visit's lines only
  await page.getByTestId("answer-pick-p1-u03").click();
  // he names who said it; nothing is inferred (web-app.md section 8)
  const naming = page.getByTestId("answer-speaker");
  await expect(naming).toBeVisible();
  await expect(naming.getByTestId("answer-speaker-doctor")).toHaveCount(0); // nobody but the pharmacist works at a pharmacy
  await expect(naming.getByTestId("answer-speaker-unsure")).toBeVisible();
  expect(await textBelow(page, 18), "naming who said it").toEqual([]);
  await noUndefinedClass(page, "naming who said it");
  await naming.getByTestId("answer-speaker-pharmacist").click();
  await expect(page.getByTestId("card-question")).toHaveAttribute("data-status", "answered", { timeout: 10_000 });
  const answer = page.getByTestId("card-answer-line");
  await expect(answer).toContainText(P1_U03);
  await expect(answer).toHaveAttribute("data-chip", "pharmacist");
  expect(await textBelow(page, 18), "unknown card with the answer").toEqual([]);

  const linked = await card(request, s.id, out.med.id);
  expect(linked.question).toMatchObject({ id: out.questions[0].id, status: "answered" });
  expect(linked.question.answer.text).toBe(P1_U03);
  await closeAll([phone]);
});

test("UI: an answer nobody is named for never shows as the pharmacist's; the doctor's later visit is not offered", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 8 });
  const out = await addUnknownBox(request, s.id);
  await api(request, "/api/clock", s.id, { day: 43 }); // the question is still open after D42
  const phone = await openDevice(browser, s.id, `/p/meds/${out.med.id}`);
  const { page } = phone;
  const question = page.getByTestId("card-question");
  await expect(question).toHaveAttribute("data-status", "open");
  const choices = page.getByTestId("answer-choice");
  await expect(choices).toHaveCount(3);
  expect(await choices.evaluateAll((els) => els.map((e) => e.getAttribute("data-utterance")))).toEqual(["p1-u01", "p1-u02", "p1-u03"]);
  for (const chip of await choices.evaluateAll((els) => els.map((e) => e.getAttribute("data-chip")))) expect(chip).toBe("recording");
  await expect(question).not.toContainText("ibuprofen");

  // the line Dr Lim said at D42 cannot be linked to the question for the pharmacist, whoever is named
  for (const speaker of [undefined, "pharmacist"]) {
    const res = await request.post(`/api/meds/${out.med.id}/answer?session=${s.id}`, { data: { visit_id: "v3", utterance_id: "v3-u17", ...(speaker ? { speaker } : {}) } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("visit_not_for_question");
  }

  // his own line, "not sure" who said it: saved, shown as a recording, never as the pharmacist's
  await page.getByTestId("answer-pick-p1-u01").click();
  await page.getByTestId("answer-speaker").getByTestId("answer-speaker-unsure").click();
  await expect(question).toHaveAttribute("data-status", "answered", { timeout: 10_000 });
  const answer = page.getByTestId("card-answer-line");
  await expect(answer).toHaveAttribute("data-chip", "recording");
  await expect(answer.getByTestId("card-line-tag")).toHaveText("● 录音");
  await expect(answer.getByTestId("card-line-text")).toHaveText(P1_U01);
  await expect(question).not.toContainText("药剂师说");
  await expect(page.getByTestId("answer-picker")).toBeVisible(); // nobody named yet: he can pick again
  expect(await textBelow(page, 18), "answer with nobody named").toEqual([]);
  await noUndefinedClass(page, "answer with nobody named");

  // then the right line, naming the pharmacist
  await page.getByTestId("answer-pick-p1-u03").click();
  await page.getByTestId("answer-speaker").getByTestId("answer-speaker-pharmacist").click();
  await expect(answer).toHaveAttribute("data-chip", "pharmacist", { timeout: 10_000 });
  await expect(answer.getByTestId("card-line-text")).toHaveText(P1_U03);
  await expect(page.getByTestId("answer-picker")).toHaveCount(0);
  const linked = await card(request, s.id, out.med.id);
  expect(linked.question).toMatchObject({ id: out.questions[0].id, status: "answered", answerSpeaker: "pharmacist" });
  await closeAll([phone]);
});

test("UI: self-bought ibuprofen -> the standard leaflet card and his question for the pharmacist, no blood pressure or amlodipine", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 29 });
  const phone = await openDevice(browser, s.id, "/p/meds/add");
  const { page } = phone;
  await page.getByTestId("add-origin-self_bought").click();
  await page.getByTestId("add-file").setInputFiles(png("ibuprofen"));
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("add-value-drug_text")).toHaveText("IBUPROFEN 200 mg");
  await expect(page.getByTestId("add-field-directions")).toHaveCount(0);
  const out = await tickAllAndSave(page);
  expect(out.outcome).toBe("label_confirmed");
  expect(out.med.id).toBe("med-ibuprofen");
  expect(out.answer).toBeNull();
  expect(out.questions.map((q: { text: string; for: string }) => [q.for, q.text])).toEqual([["pharmacist", "这个药和我其他的药一起吃，要问药剂师"]]);
  await expect(page.getByTestId("add-question")).toHaveText("这个药和我其他的药一起吃，要问药剂师");

  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("page-med-detail")).toHaveAttribute("data-med", "med-ibuprofen");
  for (const lang of ["zh-Hans", "en"]) {
    if (lang === "en") {
      await phone.context.addCookies([{ name: "rp_lang", value: "en", url: page.url() }]);
      await page.reload();
      await waitLive(page);
    }
    const cardText = ((await page.getByTestId("med-card").innerText()) + (await page.getByTestId("med-name").innerText())).toLowerCase();
    for (const banned of ["blood pressure", "血压", "amlodipine"]) expect(cardText, `${lang}: ${banned}`).not.toContain(banned);
    await expect(page.getByTestId("card-purpose").getByTestId("card-line")).toHaveAttribute("data-chip", "leaflet");
    await expect(page.getByTestId("card-how-to-take")).toHaveCount(0);
    expect(await textBelow(page, 18), `ibuprofen card ${lang}`).toEqual([]);
  }

  // "ask about this": his question goes through /api/ask; nothing in the answer is the app's own verdict
  await page.getByTestId("ask-quick-2").click();
  const result = page.getByTestId("ask-result");
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toHaveAttribute("data-route", "refuse_route");
  await expect(page.getByTestId("ask-question-added")).toBeVisible();
  for (const chip of await page.getByTestId("ask-sentence").evaluateAll((els) => els.map((e) => e.getAttribute("data-chip")))) {
    expect(["doctor", "dispenser", "pharmacist", "label", "leaflet", "ripple"]).toContain(chip);
  }
  const said = (await result.innerText()).toLowerCase();
  for (const verdict of ["safe to take", "can be taken together", "fine to take", "no interaction", "it's ok to take"]) expect(said).not.toContain(verdict);
  await closeAll([phone]);
});

test("the medicine list: grouped by origin, each with its status; every text at least 18px", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 43 });
  const phone = await openDevice(browser, s.id, "/p/meds");
  const { page } = phone;
  for (const origin of ["prescription", "self_bought", "relative"]) await expect(page.getByTestId(`meds-group-${origin}`)).toBeVisible();
  await expect(page.getByTestId("med-row-med-amlodipine")).toHaveAttribute("data-status", "label_confirmed");
  await expect(page.getByTestId("med-row-med-losartan")).toHaveAttribute("data-status", "awaiting_label");
  await expect(page.getByTestId("med-row-med-relative-box")).toHaveAttribute("data-status", "unidentified");
  await expect(page.getByTestId("med-row-med-losartan")).toContainText("等药袋确认");
  expect(await textBelow(page, 18)).toEqual([]);
  await noUndefinedClass(page, "list");
  await page.getByTestId("med-row-med-losartan").click();
  await expect(page.getByTestId("awaiting-label")).toBeVisible();
  expect(await textBelow(page, 18), "losartan card").toEqual([]);
  await closeAll([phone]);
});

/**
 * Screenshots of the M3 screens at phone width for the owner's review: M3_SHOTS=<folder> PW_PORT=3202 npx playwright
 * test e2e/m3-meds.spec.ts -g screenshots. Skipped otherwise.
 */
test("screenshots of the M3 screens", async ({ browser, request }) => {
  const dir = process.env.M3_SHOTS;
  test.skip(!dir, "set M3_SHOTS=<folder> to write screenshots");
  test.setTimeout(120_000);
  const s = await createSession(request, { story_day: 12 });
  await request.patch(`/api/meds/med-amlodipine?session=${s.id}`, { data: { action: "relabel" } });
  const phone = await openDevice(browser, s.id, "/p/meds");
  const { page } = phone;
  await page.setViewportSize({ width: 390, height: 844 });
  const shot = async (name: string) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir!, `${name}.png`), fullPage: true });
  };
  await shot("01-list");
  await page.goto("/p/meds/med-amlodipine");
  await waitLive(page);
  await shot("02-amlodipine-awaiting");
  await page.getByTestId("awaiting-photograph").click();
  await page.getByTestId("add-file").setInputFiles(png("amlodipine"));
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  await shot("03-check-amlodipine");
  await tickAllAndSave(page);
  await shot("04-result-amlodipine");
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("card-how-to-take")).toBeVisible();
  await shot("05-amlodipine-card");
  await page.goto("/p/meds/add");
  await waitLive(page);
  await shot("06-add-origin");
  await page.getByTestId("add-origin-relative").click();
  await shot("07-add-photo");
  await page.getByTestId("add-sample-relative_box").click();
  await tickAllAndSave(page);
  await shot("08-result-relative");
  await page.getByTestId("add-open-card").click();
  await expect(page.getByTestId("answer-picker")).toBeVisible();
  await shot("09-unknown-card-pick-answer");
  await page.goto("/p/meds/med-ibuprofen");
  await waitLive(page);
  await page.getByTestId("ask-quick-2").click();
  await expect(page.getByTestId("ask-result")).toBeVisible({ timeout: 15_000 });
  await shot("10-ibuprofen-ask");
  await closeAll([phone]);
});
