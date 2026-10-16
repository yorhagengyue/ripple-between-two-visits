/**
 * Track F, round three, in the browser (real-app 2.15-2.17, 6.9-6.10):
 *   1. a medicine waits for its label and he photographs a label without the page having been opened for it: a label
 *      naming another medicine is not quietly saved as a new one. He is asked 「这是医生开的 … 的药袋吗？」; 「是」 is the
 *      mismatch (「药袋上的名字和医生开的不一样，拿去问药剂师」, a question for the pharmacist), 「不是」 saves it as its own
 *      medicine; the waiting medicine's own label goes onto it;
 *   2. the review: the follow-up planned from the visit shows 「大约 …」 and can be changed to the day he booked; an
 *      answer changed to 「不是」 takes back the prescription that still waits for its label and the follow-up that is
 *      still only planned, and 「是」 puts them back;
 *   3. with the mock voice his medicine card has no 「读给我听」, and POST /api/tts answers his account 404.
 * Every new state passes the page checks (360 wide, 18px text, 48px targets, contrast).
 *
 * Needs the app on PW_PORT with RIPPLE_DEV_TOOLS=1 and SPEECH_PROVIDER=devfake (scripts/record/serve.mjs); skipped on any
 * other server. Screenshots go to F_SHOTS_DIR when it is set.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { VisitView } from "../lib/visit/types";
import { expectPageChecks } from "./_checks/page-checks";

test.use({
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  timezoneId: "Asia/Singapore",
});

const SHOTS = process.env.F_SHOTS_DIR?.trim() || null;
const LABEL = (name: string) => path.join(process.cwd(), "fixtures", "labels", `${name}.png`);

async function check(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `r3-${name}.png`), fullPage: true });
  }
  await expectPageChecks(page, { side: "elder" });
}

async function signUp(page: Page): Promise<void> {
  const res = await page.request.post("/api/dev/accounts", { data: { login: `f3${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space: "blank" } });
  expect(res.status(), await res.text()).toBe(201);
}

/** A visit recorded and turned into text by the stand-in (fixture), through the routes; returns its id. */
async function recordedVisit(page: Page, fixture: string): Promise<string> {
  const api = page.request;
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true } } });
  expect(started.status(), await started.text()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
  return visitId;
}

async function viewOf(page: Page, visitId: string): Promise<VisitView> {
  return ((await (await page.request.get(`/api/visits/${visitId}`)).json()) as { view: VisitView }).view;
}

/** The card of the visit's record that carries a row of this kind (its line and its items). */
async function cardWith(page: Page, visitId: string, variants: string[]): Promise<{ anchor: string; items: string[] }> {
  const view = await viewOf(page, visitId);
  for (const c of view.cards) {
    if (c.kind !== "doc") continue;
    if (c.rows.some((r) => variants.includes(r.variant))) return { anchor: c.anchor, items: c.rows.map((r) => r.itemId) };
  }
  throw new Error(`no card with ${variants.join("/")}`);
}

async function answer(page: Page, visitId: string, items: string[], verdict: "right" | "wrong" | "unsure"): Promise<void> {
  const res = await page.request.post(`/api/visits/${visitId}/verdict`, { data: { items, verdict, locale: "zh-Hans" } });
  expect(res.status(), await res.text()).toBe(200);
}

type MedRow = { id: string; status: string };
async function meds(page: Page): Promise<MedRow[]> {
  const out = (await (await page.request.get("/api/meds")).json()) as { groups: { items: MedRow[] }[] };
  return out.groups.flatMap((g) => g.items);
}

/** His questions still to ask (GET /api/questions). */
async function openQuestions(page: Page): Promise<{ text: string; for: string }[]> {
  const out = (await (await page.request.get("/api/questions")).json()) as { list: { open: { text: string; for: string }[] } };
  return out.list.open;
}

/** 「对」 on every line of the label on screen, until the flow moves on. */
async function tickEveryLine(page: Page): Promise<void> {
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 6 && (await page.getByTestId("add-check").count()) > 0; i++) {
    const index = await page.getByTestId("add-check").getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect.poll(async () => (await page.getByTestId("add-check").count()) === 0 || (await page.getByTestId("add-check").getAttribute("data-index", { timeout: 500 }).catch(() => null)) !== index).toBe(true);
  }
}

/** /p/meds/add opened without ?med=, 「医生开的」, a photo of this label, every line ticked. */
async function photographFromDoctor(page: Page, label: string): Promise<void> {
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-prescription").click();
  await page.getByTestId("add-how-photo").click();
  await page.getByTestId("add-file").setInputFiles(LABEL(label));
  await tickEveryLine(page);
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  test.skip(health.provider !== "devfake", "needs SPEECH_PROVIDER=devfake (scripts/record/serve.mjs)");
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: true } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test("a medicine waits for its label: a label for another medicine asks him instead of becoming a new medicine; 是 is the mismatch, 不是 saves it, its own label goes onto it", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v2");
  const prescription = await cardWith(page, visitId, ["new_med", "med"]);
  await answer(page, visitId, prescription.items, "right");
  expect(await meds(page)).toEqual([expect.objectContaining({ id: "med-amlodipine", status: "awaiting_label" })]);

  // ---- the losartan label, the page opened without ?med= (the way Today's link opens it)
  await photographFromDoctor(page, "losartan");
  const which = page.getByTestId("add-which");
  await expect(which).toBeVisible({ timeout: 20_000 });
  await expect(which).toHaveAttribute("data-waiting", "1");
  await expect(which).toContainText("这是医生开的 Amlodipine 氨氯地平 的药袋吗？");
  await expect(page.getByTestId("add-which-label")).toContainText(/LOSARTAN/i);
  await check(page, "add-which");
  // nothing was written while he is asked
  expect(await meds(page)).toHaveLength(1);

  // 「是」: the label he photographed for that medicine names another one
  await page.getByTestId("add-which-med-amlodipine").click();
  const mismatch = page.getByTestId("add-mismatch");
  await expect(mismatch).toBeVisible({ timeout: 20_000 });
  await expect(mismatch).toContainText("药袋上的名字和医生开的不一样，拿去问药剂师。");
  await expect(mismatch).toContainText("已加进问题单：问药剂师");
  await check(page, "add-which-mismatch");
  expect(await meds(page)).toEqual([expect.objectContaining({ id: "med-amlodipine", status: "awaiting_label" })]);
  expect((await openQuestions(page)).filter((q) => q.for === "pharmacist" && q.text.includes("和医生开的（Amlodipine）不一样"))).toHaveLength(1);

  // ---- the same label again, this time 「不是，是另一种药」: its own medicine, and the prescribed one keeps waiting
  await photographFromDoctor(page, "losartan");
  await expect(page.getByTestId("add-which")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("add-which-other").click();
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed", { timeout: 20_000 });
  const after = await meds(page);
  expect(after).toHaveLength(2);
  expect(after.find((m) => m.id === "med-amlodipine")).toMatchObject({ status: "awaiting_label" });
  // no second question for the pharmacist
  expect((await openQuestions(page)).filter((q) => q.text.includes("和医生开的（Amlodipine）不一样"))).toHaveLength(1);

  // ---- the waiting medicine's own label, still without ?med=: no question, it goes onto that medicine
  await photographFromDoctor(page, "amlodipine");
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-med", "med-amlodipine", { timeout: 20_000 });
  await expect(page.getByTestId("add-done")).toHaveAttribute("data-status", "label_confirmed");
  await expect(page.getByTestId("add-which")).toHaveCount(0);
  expect((await meds(page)).map((m) => m.status)).toEqual(["label_confirmed", "label_confirmed"]);
});

test("the review: the follow-up's day (大约, then the day he booked); an answer changed to 不是 takes the waiting prescription and the planned follow-up back, 是 puts them back", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v2");
  await page.goto(`/p/visit/${visitId}/review`);
  await expect(page.getByTestId("review-queue")).toBeVisible();
  for (let i = 0; i < 30 && (await page.getByTestId("review-queue").count()) > 0; i++) {
    const n = await page.getByTestId("review-queue").getAttribute("data-pending");
    await page.getByTestId("review-yes").click();
    await expect.poll(async () => (await page.getByTestId("review-summary").count()) > 0 || (await page.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== n).toBe(true);
  }
  await expect(page.getByTestId("review-summary")).toBeVisible();
  expect(await meds(page)).toEqual([expect.objectContaining({ id: "med-amlodipine", status: "awaiting_label" })]);

  // ---- the follow-up planned from the doctor's "come back": about that day
  const followUp = page.getByTestId("review-follow-up");
  await expect(followUp).toHaveAttribute("data-approx", "true");
  await expect(followUp).toContainText("大约");
  await check(page, "review-follow-up");

  // ---- he changes the follow-up line to 不是: no longer planned; 是 again: planned again
  const fuCard = await cardWith(page, visitId, ["follow_up"]);
  const fuRow = page.locator(`[data-testid="review-row"][data-line="${fuCard.anchor}"]`);
  await fuRow.getByTestId("review-change").click();
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await expect(fuRow).toHaveAttribute("data-verdict", "wrong");
  await expect(page.getByTestId("review-follow-up")).toHaveCount(0);
  expect((await viewOf(page, visitId)).account?.followUp).toBeNull();
  await fuRow.getByTestId("review-change").click();
  await page.getByTestId("review-yes").click();
  await expect(page.getByTestId("review-follow-up")).toHaveAttribute("data-approx", "true");

  // ---- 「改成我约的日子」: a day that has passed is refused in words; the day he booked is kept
  await page.getByTestId("review-follow-up-change").click();
  await page.getByTestId("review-follow-up-date").fill("2026-10-01");
  await page.getByTestId("review-follow-up-save").click();
  await expect(page.getByTestId("review-follow-up-bad")).toContainText("选今天或以后的日子");
  await check(page, "review-follow-up-date");
  await page.getByTestId("review-follow-up-date").fill("2026-11-20");
  await page.getByTestId("review-follow-up-save").click();
  await expect(page.getByTestId("review-follow-up")).toHaveAttribute("data-approx", "false");
  await expect(page.getByTestId("review-follow-up")).toContainText("11月20日 · 你约的日子");
  expect((await viewOf(page, visitId)).account?.followUp).toMatchObject({ date: "2026-11-20", approx: false });

  // ---- the prescription line changed to 不是: the medicine that still waited for its label is off his list
  const rx = await cardWith(page, visitId, ["new_med", "med"]);
  const rxRow = page.locator(`[data-testid="review-row"][data-line="${rx.anchor}"]`);
  await rxRow.getByTestId("review-change").click();
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await expect(rxRow).toHaveAttribute("data-verdict", "wrong");
  expect(await meds(page)).toEqual([]);
  await page.goto("/p/meds");
  await expect(page.getByTestId("meds-list")).toHaveAttribute("data-count", "0");
  // 是 again: back on his list, waiting for its label
  await page.goto(`/p/visit/${visitId}/review`);
  await rxRow.getByTestId("review-change").click();
  await page.getByTestId("review-yes").click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
  expect(await meds(page)).toEqual([expect.objectContaining({ id: "med-amlodipine", status: "awaiting_label" })]);
  // the day he booked himself stays his whatever he says about the line
  await fuRow.getByTestId("review-change").click();
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-follow-up")).toContainText("11月20日 · 你约的日子");
});

test("the mock voice: his medicine card has no 读给我听 under the explain section, and POST /api/tts answers his account 404", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v2");
  await answer(page, visitId, (await cardWith(page, visitId, ["new_med", "med"])).items, "right");
  await answer(page, visitId, (await cardWith(page, visitId, ["purpose"])).items, "right");
  // the explain card is a screen of its own under the card (the timeline draft's 06-8): the card links to it
  await page.goto("/p/meds/med-amlodipine");
  await page.getByTestId("card-explain-open").click();
  await expect(page.getByTestId("card-explain")).toBeVisible();
  await expect(page.getByTestId("explain-line").first()).toBeVisible();
  await expect(page.getByTestId("card-read-aloud")).toHaveCount(0);
  await expect(page.getByText("读给我听")).toHaveCount(0);
  const res = await page.request.post("/api/tts", { data: { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" } });
  expect([res.status(), await res.json()]).toEqual([404, { error: "tts_unavailable" }]);
  await check(page, "med-card-explain-no-read-aloud");
});
