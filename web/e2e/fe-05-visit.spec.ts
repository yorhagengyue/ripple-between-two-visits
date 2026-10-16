/**
 * The visit screens as the timeline draft's 05 group draws them (web/progress/fe-05.md): the states that are new with
 * this layout, each with the automatic page checks (360 wide with no sideways scroll, text at least 18px, targets at
 * least 48x48, contrast AA):
 *
 *   05-1   the line under the header of the card for the doctor: his clinic by its name once the app knows it
 *   05-5   after 「不是」 the line stays on the screen, flagged, with its undo bar; 「撤销」 asks the line again and takes
 *          the flag and its question back; 「下一件」 goes on, and the line is shown above the next one as he answered it
 *   05-8   Today's entry for a review he has not finished: 「接着认」 opens it, 「结束」 confirms the visit as it stands
 *   05-10  while he records, the visit's own list of what to ask before he leaves
 *   通用-2  the visit pages' own error screen; and, in the review, an answer that could not be saved: said where he can
 *          see it, with a 「再试一次」 that sends the same answer again
 * and three small pieces the back end already had routes for (D:/ripple-c2/frontend/known-ui-gaps.md, FE 1-3):
 *   - 「我说的话 N 句 · 看一下」 on the record: a line Ripple took for his can be given back, before and after he saved;
 *   - a sample replay left half way says 「示例回放」 on its row of the visit tab;
 *   - a recording this phone keeps for a visit that no longer needs it is shown on the visit tab and can be played.
 *
 * Needs the app on PW_PORT with the developer tools on and SPEECH_PROVIDER=devfake (the web/.env.local of a front-end
 * worktree, or scripts/record/serve.mjs); skipped on any other server, except the last test, which needs a server with
 * no transcription (SPEECH_PROVIDER=mock) and skips on every other one.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { VisitView } from "../lib/visit/types";
import { expectPageChecks } from "./_checks/page-checks";

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
  locale: "zh-CN",
  timezoneId: "Asia/Singapore",
});

let provider = "unknown";

async function check(page: Page): Promise<void> {
  // let entry animations finish (half-transparent text would read as low contrast)
  await page.waitForTimeout(400);
  await expectPageChecks(page, { side: "elder" });
}

async function signUp(page: Page, space: "blank" | "example" = "blank"): Promise<void> {
  const res = await page.request.post("/api/dev/accounts", { data: { login: `fv${randomUUID().replace(/-/g, "").slice(0, 12)}`, password: "a long test password", space } });
  expect(res.status(), await res.text()).toBe(201);
}

/** A visit recorded and turned into text by the stand-in (fixture), through the routes; returns its id. */
async function recordedVisit(page: Page, fixture: string): Promise<string> {
  const api = page.request;
  const started = await api.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  const visitId = ((await started.json()) as { visit: { id: string } }).visit.id;
  await textFor(page, visitId, fixture);
  return visitId;
}

/** The stand-in makes this visit's text (as if another device had ended it): the visit goes to its review. */
async function textFor(page: Page, visitId: string, fixture: string): Promise<void> {
  const api = page.request;
  const job = (await (await api.post("/api/asr/jobs", { data: { visit_id: visitId }, headers: { "x-ripple-devfake-fixture": fixture } })).json()) as { job_id: string };
  await expect.poll(async () => ((await (await api.get(`/api/asr/jobs/${job.job_id}?visit_id=${visitId}`)).json()) as { status: string }).status).toBe("done");
  expect((await api.post(`/api/visits/${visitId}/finalize`, { data: { job_id: job.job_id } })).status()).toBe(200);
}

async function viewOf(page: Page, visitId: string): Promise<VisitView> {
  return ((await (await page.request.get(`/api/visits/${visitId}`)).json()) as { view: VisitView }).view;
}

/** His answers on the items of the line with this id, as the server has them. */
async function verdictsOf(page: Page, visitId: string, lineId: string): Promise<string[]> {
  const card = (await viewOf(page, visitId)).cards.find((c) => c.kind === "doc" && c.anchor === lineId);
  return card && card.kind === "doc" ? card.rows.map((r) => r.verdict ?? "none") : [];
}

async function openQuestions(page: Page): Promise<{ text: string; for: string }[]> {
  const out = (await (await page.request.get("/api/questions")).json()) as { list: { open: { text: string; for: string }[] } };
  return out.list.open;
}

/** 「是」 to every line still to ask, until the record shows. */
async function yesToAll(page: Page): Promise<void> {
  for (let i = 0; i < 40 && (await page.getByTestId("review-summary").count()) === 0; i++) {
    const key = await page.getByTestId("review-one").getAttribute("data-key");
    await page.getByTestId("review-yes").click();
    await expect(page.locator(`[data-testid="review-one"][data-key="${key}"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId("review-summary")).toBeVisible();
}

/**
 * Makes the visit tab's own screen fail while it is drawn in this browser (until `window.__rpBreakVisit` is set to
 * false): the page's first line of work there is to put the list of his visits into one string, and that call throws
 * for exactly that list. A malformed address is no way to get there (the server answers it 400 before any page), and a
 * visit that does not exist is a 404; this is the smallest thing that breaks the page itself.
 */
async function breakVisitTab(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __rpBreakVisit?: boolean; __rpBroke?: number };
    w.__rpBreakVisit = true;
    w.__rpBroke = 0;
    const stringify = JSON.stringify.bind(JSON) as (...args: unknown[]) => string;
    JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
      const visits = Array.isArray(value) && value.length > 0 && value.every((v) => v !== null && typeof v === "object" && "audioPath" in v && "status" in v);
      if (w.__rpBreakVisit && visits) {
        w.__rpBroke = (w.__rpBroke ?? 0) + 1;
        throw new Error("the visit tab is broken for this test");
      }
      return stringify(value, ...rest);
    }) as typeof JSON.stringify;
  });
}

test.beforeAll(async ({ request }) => {
  const health = (await (await request.get("/api/asr/health")).json().catch(() => ({}))) as { provider?: string };
  provider = health.provider ?? "unknown";
  const res = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: false } });
  test.skip(res.status() === 404, "the developer tools are off on this server");
});

test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("05-5: after 「不是」 the line stays, flagged, with its undo bar; 「撤销」 asks it again and takes the flag and its question back; 「下一件」 goes on", async ({ page }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(120_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v1");
  await page.goto(`/p/visit/${visitId}/review`);
  const one = page.getByTestId("review-one");
  await expect(one).toBeVisible();
  // the header's second line says which one this is; the same words are inside the line for a screen reader
  await expect(page.getByTestId("review-progress")).toHaveText(/^第 1 件 \/ 共 \d+ 件$/);
  await expect(one).toContainText(/第 1 件 \/ 共 \d+ 件/);
  await expect(page.getByTestId("review-after")).toContainText("下一件，等你认");
  const key = (await one.getAttribute("data-key"))!;
  const line = (await one.getAttribute("data-line"))!;
  const questionsBefore = (await openQuestions(page)).length;

  await page.getByTestId("review-no").click();
  const held = page.getByTestId("review-held");
  await expect(held).toHaveAttribute("data-key", key);
  await expect(held).toContainText("你说不对 · 已加进问题单");
  await expect(held).toContainText("这一条留着，不删。");
  await expect(one).toHaveCount(0);
  await expect(page.getByTestId("review-undo")).toContainText("已记下：不是");
  await check(page);
  expect(await verdictsOf(page, visitId, line)).toContain("wrong");
  expect((await openQuestions(page)).length).toBe(questionsBefore + 1);

  // 「撤销」: asked again; the server has no "not answered yet", so it holds 「不记得」, and the question is taken back
  await page.getByTestId("review-undo").getByRole("button").click();
  await expect(one).toHaveAttribute("data-key", key);
  await expect(held).toHaveCount(0);
  expect((await verdictsOf(page, visitId, line)).every((v) => v === "unsure")).toBe(true);
  expect((await openQuestions(page)).length).toBe(questionsBefore);

  // 「不是」 again, then 「下一件」: the next line is asked, with this one above it as he answered it
  await page.getByTestId("review-no").click();
  await expect(held).toBeVisible();
  await page.getByTestId("review-next").click();
  await expect(held).toHaveCount(0);
  await expect(one).toBeVisible();
  expect(await one.getAttribute("data-key")).not.toBe(key);
  const before = page.getByTestId("review-before");
  await expect(before).toHaveAttribute("data-line", line);
  await expect(before).toHaveAttribute("data-verdict", "wrong");
  await expect(before).toContainText("你说不对 · 已加进问题单");
  await check(page);

  // a line changed from the record goes straight back to the record (no held screen there)
  await yesToAll(page);
  const row = page.locator(`[data-testid="review-row"][data-line="${line}"]`);
  await expect(row).toHaveAttribute("data-verdict", "wrong");
  await row.getByTestId("review-change").click();
  await page.getByTestId("review-yes").click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await expect(row).toHaveAttribute("data-verdict", "right");
  await row.getByTestId("review-change").click();
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await expect(page.getByTestId("review-held")).toHaveCount(0);
  await expect(row).toHaveAttribute("data-verdict", "wrong");
  await check(page);
});

test("「我说的话 N 句 · 看一下」: a line taken for his can be given back, before and after he saved, and taken again", async ({ page }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(120_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v1");
  const all = (await viewOf(page, visitId)).lines.filter((l) => l.role === "patient");
  expect(all.length).toBeGreaterThan(1);
  // two of them to give back: the second one a line that is not shown under a question of his (so the record lists it
  // among 「哪几句是你说的？」 once it is nobody's)
  const second_ = all.find((l, i) => i > 0 && !l.inQuestion)!;
  expect(second_).toBeTruthy();
  const his = [all[0], second_, ...all.filter((l) => l !== all[0] && l !== second_)];
  await page.goto(`/p/visit/${visitId}/review`);
  await yesToAll(page);

  // one row of the record, not the lines themselves
  const open = page.getByTestId("review-own-lines-open");
  await expect(open).toHaveAttribute("data-count", String(his.length));
  await expect(open).toContainText(`我说的话 ${his.length} 句`);
  await expect(page.getByTestId("review-own-lines-row")).toHaveCount(0);
  await open.click();
  const screen = page.getByTestId("review-own-lines");
  await expect(screen).toBeVisible();
  const rows = page.getByTestId("review-own-lines-row");
  await expect(rows).toHaveCount(his.length);
  // before he saved, every one of them is the app's guess, and says so
  const first = page.locator(`[data-testid="review-own-lines-row"][data-line="${his[0].id}"]`);
  await expect(first).toContainText(his[0].text);
  await expect(first).toContainText("好像是你说的");
  await check(page);

  // 「不是我说的」: nobody's line now, said on the same row; 「是我说的」 takes it again, as his own
  await first.getByTestId("review-own-lines-toggle").click();
  await expect(first).toHaveAttribute("data-mine", "false");
  await expect(first).toContainText("没听出是谁说的");
  expect((await viewOf(page, visitId)).lines.find((l) => l.id === his[0].id)).toMatchObject({ role: "unknown", roleState: "unknown" });
  await first.getByTestId("review-own-lines-toggle").click();
  await expect(first).toHaveAttribute("data-mine", "true");
  await expect(first).toContainText("你说的");
  expect((await viewOf(page, visitId)).lines.find((l) => l.id === his[0].id)).toMatchObject({ role: "patient", roleState: "confirmed" });

  // back to the record, save; afterwards a line can still be given back
  await page.getByTestId("review-own-lines-done").click();
  await expect(page.getByTestId("review-summary")).toBeVisible();
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });
  await page.getByTestId("review-own-lines-open").click();
  const second = page.locator(`[data-testid="review-own-lines-row"][data-line="${his[1].id}"]`);
  await expect(second).toContainText("你说的");
  await second.getByTestId("review-own-lines-toggle").click();
  await expect(second).toHaveAttribute("data-mine", "false");
  expect((await viewOf(page, visitId)).lines.find((l) => l.id === his[1].id)).toMatchObject({ role: "unknown", roleState: "unknown" });
  // the header's way back leaves the screen too; the record now counts one line fewer and lists the one given back
  await screen.locator('[data-rp="back"]').click();
  await expect(page.getByTestId("review-own-lines-open")).toHaveAttribute("data-count", String(his.length - 1));
  await expect(page.locator(`[data-testid="review-mine-row"][data-line="${his[1].id}"]`)).toContainText("没听出是谁说的");
  await check(page);
});

test("a sample replay left half way says 「示例回放」 on its row of the visit tab", async ({ page }) => {
  test.skip(provider !== "devfake" && provider !== "mock", `needs SPEECH_PROVIDER=devfake or mock, this server has ${provider}`);
  test.setTimeout(120_000);
  await signUp(page, "example");
  await page.goto("/p/visit?speed=1");
  await expect(page.getByTestId("visit-where")).toBeVisible();
  // the sample visit: what it is and the button that plays it, together
  await expect(page.getByTestId("visit-sample")).toContainText("陈先生今天的复诊，录好的示例，不是你的看诊。");
  await page.getByTestId("visit-sample-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "replay");
  const visitId = (await live.getAttribute("data-visit"))!;
  // he leaves before its end
  await page.goto("/p/visit");
  const row = page.locator(`[data-testid="visit-unfinished-row"]:has(a[href*="visit=${visitId}"])`);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-sample", "true");
  await expect(row).toContainText("示例回放");
  await check(page);
  // his own recording never carries it
  const own = await page.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "pharmacy" } });
  expect(own.status(), await own.text()).toBe(200);
  const ownId = ((await own.json()) as { visit: { id: string } }).visit.id;
  await page.goto("/p/visit");
  const ownRow = page.locator(`[data-testid="visit-unfinished-row"]:has(a[href*="visit=${ownId}"])`);
  await expect(ownRow).toHaveCount(1);
  await expect(ownRow).not.toHaveAttribute("data-sample", "true");
  await expect(ownRow).not.toContainText("示例回放");
});

test("a recording this phone keeps for a visit that no longer needs it is shown on the visit tab and can be played; it is neither sent nor removed", async ({ page, context }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(180_000);
  await signUp(page);
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  const visitId = (await live.getAttribute("data-visit"))!;
  // a few seconds, then the page goes away without 录完了: the phone keeps what was recorded
  await page.waitForTimeout(4_500);
  await page.close({ runBeforeUnload: true });

  const again = await context.newPage();
  await again.waitForTimeout(500);
  // meanwhile the visit got its text elsewhere and has no recording on the server: the copy on the phone must not be
  // sent any more (it would start that record again), and it is not the server's to delete
  await textFor(again, visitId, "v1");
  await again.goto("/p/visit");
  await expect(again.getByTestId("visit-where")).toBeVisible();
  const held = again.getByTestId("visit-held");
  await expect(held).toHaveAttribute("data-count", "1");
  const row = again.getByTestId("visit-held-row");
  await expect(row).toHaveAttribute("data-visit", visitId);
  await expect(row).toContainText(/这台手机上还留着一段录音（\d+ 分 \d+ 秒）。/);
  await expect(row).toContainText("退出登录时会清掉");
  // not offered for sending
  await expect(again.getByTestId("visit-resume")).toHaveCount(0);
  // it can be played, from the phone's own copy
  await expect(row).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  const bar = row.locator('[data-rp="listen"]');
  await expect(bar).toContainText("听这段录音");
  await check(again);
  await bar.locator("button").click();
  await expect(bar).toHaveAttribute("data-playing", "true", { timeout: 10_000 });
  expect(await bar.locator("audio").getAttribute("src")).toMatch(/^blob:/);
  await bar.locator("button").click();
  await expect(bar).toHaveAttribute("data-playing", "false");
  // still there after a reload: nothing here removes it, and the server never got a recording for the visit
  await again.reload();
  await expect(again.getByTestId("visit-held-row")).toHaveAttribute("data-visit", visitId);
  expect((await viewOf(again, visitId)).visit.audioPath).toBeNull();
});

test("05-8: Today's entry for a review he has not finished: 「接着认」 opens it where he stopped, 「结束」 confirms the visit as it stands", async ({ page }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(120_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v1");
  // he answers the first line, then leaves
  await page.goto(`/p/visit/${visitId}/review`);
  const one = page.getByTestId("review-one");
  await expect(one).toBeVisible();
  const firstKey = await one.getAttribute("data-key");
  await page.getByTestId("review-yes").click();
  await expect(page.locator(`[data-testid="review-one"][data-key="${firstKey}"]`)).toHaveCount(0);
  const secondKey = await one.getAttribute("data-key");

  await page.goto("/p/today");
  const entry = page.getByTestId("today-visit-review");
  await expect(entry).toHaveAttribute("data-visit", visitId);
  await expect(entry).toContainText("10月12日的看诊还没认完。");
  await expect(entry).toContainText("认过的留着；没认的还标「好像是医生说的」。");
  // no recording of this visit on the server: the entry does not say one is saved
  await expect(entry).not.toContainText("录音存下来了");
  await check(page);

  // 「接着认」: the review, at the first line still to ask
  await page.getByTestId("today-visit-review-go").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`));
  await expect(one).toHaveAttribute("data-key", secondKey!);

  // 「结束」: the visit is confirmed as it stands; what he did not answer is still the app's guess
  await page.goto("/p/today");
  await page.getByTestId("today-visit-review-end").click();
  await expect(page.getByTestId("today-visit-review")).toHaveCount(0, { timeout: 30_000 });
  const view = await viewOf(page, visitId);
  expect(view.visit.status).toBe("confirmed");
  const docs = view.cards.filter((c) => c.kind === "doc");
  expect(docs.filter((c) => c.kind === "doc" && c.rows.every((r) => r.verdict === "right"))).toHaveLength(1);
  expect(docs.filter((c) => c.kind === "doc" && c.rows.every((r) => (r.verdict ?? null) === null)).length).toBe(docs.length - 1);
  expect(view.lines.filter((l) => l.display === "confirmed" && l.role === "doctor")).toHaveLength(1);
  // and each of those can still be answered from the visit's record
  await page.goto(`/p/visit/${visitId}/review`);
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed");
  await expect(page.locator('[data-testid="review-row"][data-verdict="none"]').first()).toContainText("还没认");
  await check(page);
});

test("05-10: while he records, the visit's own list of what to ask before he leaves; a question the recording heard is ticked", async ({ page, context }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(240_000);
  await signUp(page, "example");
  await page.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  // his own recording of today's follow-up; the stand-in hears the third visit, in which he asks his questions
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v3" });
  await page.goto("/p/visit?speed=8");
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  // no way off the recording screen but 「录完了」: no tab bar, no 「我」
  await expect(page.locator('[data-rp="tabbar"]')).toHaveCount(0);
  await expect(page.locator('a[data-kind="me"]')).toHaveCount(0);
  const toggle = page.getByTestId("visit-leaving-toggle");
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  await expect(toggle).toContainText("离开前要问的");
  await check(page);
  await toggle.click();
  const list = page.getByTestId("visit-leaving");
  await expect(list).toBeVisible();
  await expect(live).toHaveAttribute("data-view", "leaving");
  await expect(page.getByTestId("visit-captions")).toHaveCount(0);
  // the recording bar stays, small; the list is the visit's own (as the server put it together)
  await expect(live.locator('[data-rp="recording"]')).toHaveAttribute("data-mini", "true");
  const rows = page.getByTestId("visit-leaving-row");
  await expect(rows.first()).toBeVisible();
  await check(page);
  // by the end of the visit the list is the one the server holds for it, and the questions he asked are ticked
  await expect(live).toHaveAttribute("data-stream", "ended", { timeout: 120_000 });
  const visitId = (await live.getAttribute("data-visit"))!;
  await expect.poll(async () => (await viewOf(page, visitId)).qlist?.items.length ?? 0).toBe(await rows.count());
  await expect(page.locator('[data-testid="visit-leaving-row"]:not([data-state="not_asked"])').first()).toContainText(/问过了|已经说过/, { timeout: 20_000 });
  // back to the captions
  await toggle.click();
  await expect(live).toHaveAttribute("data-view", "captions");
  await expect(page.getByTestId("visit-noted")).toBeVisible();
});

test("通用-2: a visit page that cannot be drawn says so on the visit tab's own screen, with 再试一次 and 先看今天", async ({ page }) => {
  await signUp(page);
  // one visit of his, so the tab has a list to draw; then the tab breaks while it is drawn
  const started = await page.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  await breakVisitTab(page);
  await page.goto("/p/visit");
  const problem = page.getByTestId("visit-problem");
  await expect(problem).toBeVisible({ timeout: 30_000 });
  await expect(problem).toContainText("看诊记录这次没打开。");
  await expect(problem).toContainText("已经存下的录音和记录都还在。");
  await expect(problem.locator('[data-rp="retry"]')).toHaveText("再试一次");
  await expect(page.getByTestId("visit-problem-today")).toHaveAttribute("href", "/p/today");
  // the visit tab's own header and tab bar, and nothing of the error's own text
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("看诊");
  await expect(page.locator('[data-rp="tabbar"] [aria-current="page"]')).toHaveText("看诊");
  await expect(page.locator(".rpu-screen")).not.toContainText(/broken for this test|digest|Error:/i);
  await check(page);
  // 「再试一次」 while it is still broken: the page is drawn again, fails again, and the same screen stays
  const broke = () => page.evaluate(() => (window as unknown as { __rpBroke?: number }).__rpBroke ?? 0);
  const before = await broke();
  await problem.locator('[data-rp="retry"]').click();
  await expect.poll(broke, { timeout: 20_000 }).toBeGreaterThan(before);
  await expect(problem).toBeVisible();
  // once it works again: the visit tab
  await page.evaluate(() => {
    (window as unknown as { __rpBreakVisit?: boolean }).__rpBreakVisit = false;
  });
  await problem.locator('[data-rp="retry"]').click();
  await expect(page.getByTestId("visit-where")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("visit-problem")).toHaveCount(0);
  // the other way on
  await page.evaluate(() => {
    (window as unknown as { __rpBreakVisit?: boolean }).__rpBreakVisit = true;
  });
  await page.reload();
  await expect(problem).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("visit-problem-today").click();
  await page.waitForURL(/\/p\/today$/);
});

test("05-1: under the header of the card for the doctor, where he is: his clinic by its name once the app knows it, 「诊所」 until then, 「药房」 at a pharmacy", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page);
  const where = page.locator('[data-rp="meta-story"]');
  const toCard = async (place: "clinic" | "pharmacy") => {
    await page.goto("/p/visit");
    await expect(page.getByTestId("visit-empty").or(page.getByTestId("visit-where")).first()).toBeVisible();
    if (await page.getByTestId("visit-empty").count()) await page.getByTestId("visit-start").click();
    await page.getByTestId(`visit-${place}`).click();
    await expect(page.getByTestId("visit-before")).toBeVisible();
  };
  // he never told the app his clinic
  await toCard("clinic");
  await expect(page.locator('[data-rp="page-title"]')).toHaveText("10月12日的看诊");
  await expect(where).toHaveText("诊所");
  // he told it (「我」 → 我的资料, or setting up): the name, on the screen before the card and on the card's
  expect((await page.request.patch("/api/profile", { data: { clinic: "Blossom Family Clinic" } })).status()).toBe(200);
  await toCard("clinic");
  await expect(where).toHaveText("Blossom Family Clinic");
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toHaveAttribute("data-place", "clinic");
  await expect(where).toHaveText("Blossom Family Clinic");
  await check(page);
  // a pharmacy has no name here
  await toCard("pharmacy");
  await expect(where).toHaveText("药房");
  // and the visit he then records at the clinic is filed under that name: its record's header says the same
  const started = await page.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  const visit = ((await started.json()) as { visit: { id: string; place: string } }).visit;
  expect(visit.place).toBe("Blossom Family Clinic");
  await page.goto(`/p/visit/${visit.id}/review`);
  await expect(page.getByTestId("review-not-ready")).toBeVisible();
  await expect(where).toHaveText("Blossom Family Clinic");
  await check(page);
});

test("after 「录完了」: 「正在存录音……」; once the server has the recording, 「录音已经存下来了」 above 「正在整理成文字……」; a visit with nothing to send never says so", async ({ page, context }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(180_000);
  await signUp(page);
  await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
  const record = async (): Promise<string> => {
    await page.goto("/p/visit?speed=8");
    await expect(page.getByTestId("visit-empty").or(page.getByTestId("visit-where")).first()).toBeVisible();
    if (await page.getByTestId("visit-empty").count()) await page.getByTestId("visit-start").click();
    await page.getByTestId("visit-clinic").click();
    await page.getByTestId("visit-direct").click();
    await page.getByTestId("consent-start").click();
    const live = page.getByTestId("visit-live");
    await expect(live).toHaveAttribute("data-mode", "record");
    return (await live.getAttribute("data-visit"))!;
  };
  // each step is held back long enough to be looked at: the upload, then the answer about the text
  const gate = () => {
    let open: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => (open = resolve));
    return { wait, open };
  };
  const upload = gate();
  let text = gate();
  await page.route("**/api/blob/upload**", async (route) => {
    await upload.wait;
    await route.continue();
  });
  await page.route("**/api/asr/jobs/*", async (route) => {
    await text.wait;
    await route.continue();
  });

  const visitId = await record();
  await page.waitForTimeout(3_000);
  await page.getByTestId("visit-stop").click();
  const ending = page.getByTestId("visit-ending");
  const saved = page.getByTestId("visit-ending-saved");
  await expect(ending).toHaveAttribute("data-step", "saving");
  await expect(ending).toContainText("正在存录音");
  await expect(saved).toHaveCount(0);
  // nothing leads off this screen while it saves
  await expect(page.locator('[data-rp="tabbar"]')).toHaveCount(0);
  await expect(page.locator('a[data-kind="me"]')).toHaveCount(0);
  await check(page);
  upload.open();
  await expect(saved).toHaveText("录音已经存下来了", { timeout: 30_000 });
  await expect(ending).toHaveAttribute("data-step", "transcribing");
  await expect(ending).toContainText("正在整理成文字");
  // said only once it is true: the server holds the recording on the visit
  expect((await viewOf(page, visitId)).visit.audioPath).toBeTruthy();
  await check(page);
  text.open();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });

  // a visit this phone holds no recording of (started on another phone), ended here: its text is asked for, and
  // nothing is called saved
  const started = await page.request.post("/api/visits", { data: { mode: "record", consent: { given: true }, place: "clinic" } });
  expect(started.status(), await started.text()).toBe(200);
  const elsewhere = ((await started.json()) as { visit: { id: string } }).visit.id;
  text = gate();
  await page.goto(`/p/visit?visit=${elsewhere}`);
  await expect(page.getByTestId("visit-reopened")).toHaveAttribute("data-kept", "none", { timeout: 20_000 });
  await page.getByTestId("visit-reopened-end").click();
  await expect(ending).toHaveAttribute("data-step", "transcribing", { timeout: 30_000 });
  // the answer to that request has long arrived: the entry would be on the screen by now
  await page.waitForTimeout(1_500);
  await expect(saved).toHaveCount(0);
  expect((await viewOf(page, elsewhere)).visit.audioPath).toBeNull();
  text.open();
  await page.waitForURL(new RegExp(`/p/visit/${elsewhere}/review$`), { timeout: 60_000 });
});

test("an answer that could not be saved is said where he can see it, and 「再试一次」 sends the same answer again", async ({ page }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(120_000);
  await signUp(page);
  const visitId = await recordedVisit(page, "v1");
  await page.goto(`/p/visit/${visitId}/review`);
  const one = page.getByTestId("review-one");
  await expect(one).toBeVisible();
  const key = (await one.getAttribute("data-key"))!;
  const line = (await one.getAttribute("data-line"))!;
  // the server does not take his answer
  let refuse = true;
  const sent: string[] = [];
  await page.route(`**/api/visits/${visitId}/verdict`, async (route) => {
    sent.push((route.request().postDataJSON() as { verdict: string }).verdict);
    if (refuse) await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"store_unavailable"}' });
    else await route.continue();
  });
  await page.getByTestId("review-yes").click();
  const problem = page.getByTestId("review-problem");
  await expect(problem).toBeVisible();
  await expect(problem).toContainText("没成功");
  await expect(problem.locator('[data-rp="retry"]')).toHaveText("再试一次");
  // on the screen, above the strip of buttons: never left under the fold or behind the strip
  await expect(problem).toBeInViewport({ ratio: 1 });
  const covered = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="review-problem"]')!.getBoundingClientRect();
    const strip = document.querySelector('[data-rp="dock"]')!.getBoundingClientRect();
    return box.bottom > strip.top + 1;
  });
  expect(covered, "the sentence and its button are above the strip of buttons").toBe(false);
  // the same line is still the one asked about, and nothing was saved for it
  await expect(one).toHaveAttribute("data-key", key);
  expect((await verdictsOf(page, visitId, line)).every((v) => v === "none")).toBe(true);
  await check(page);
  // 「再试一次」 while it still fails: the same answer goes out again, and the sentence is back
  await page.getByTestId("review-problem-retry").click();
  await expect.poll(() => sent.length).toBe(2);
  await expect(problem).toBeVisible();
  // it works again: the tap saves that answer, and the next line is asked
  refuse = false;
  await page.getByTestId("review-problem-retry").click();
  await expect(page.locator(`[data-testid="review-one"][data-key="${key}"]`)).toHaveCount(0);
  await expect(page.getByTestId("review-problem")).toHaveCount(0);
  expect(sent).toEqual(["right", "right", "right"]);
  expect((await verdictsOf(page, visitId, line)).every((v) => v === "right")).toBe(true);
});

test("in English: the visit tab, the card for the doctor, one line of the review, the held line and the record pass the page checks", async ({ page, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(120_000);
  await page.context().addCookies([{ name: "rp_lang", value: "en", url: baseURL! }]);
  await signUp(page);
  const visitId = await recordedVisit(page, "v2");
  await page.goto("/p/visit");
  await expect(page.getByTestId("visit-where")).toContainText("Where are you?");
  await check(page);
  await page.getByTestId("visit-clinic").click();
  await expect(page.getByTestId("visit-before")).toBeVisible();
  await check(page);
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toContainText("May I record our talk today?");
  await check(page);
  await page.goto(`/p/visit/${visitId}/review`);
  const one = page.getByTestId("review-one");
  await expect(one).toContainText(/Item 1 of \d+/);
  await expect(page.getByTestId("review-yes")).toHaveText("Yes, the doctor did");
  await check(page);
  await page.getByTestId("review-no").click();
  await expect(page.getByTestId("review-held")).toContainText("You said not right · on your question list");
  await check(page);
  await page.getByTestId("review-next").click();
  await yesToAll(page);
  await check(page);
  await page.getByTestId("review-save").click();
  await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed", { timeout: 30_000 });
  await expect(page.getByTestId("review-summary")).toContainText("What the clinic counter said");
  await check(page);
  await page.getByTestId("review-own-lines-open").click();
  await expect(page.getByTestId("review-own-lines")).toBeVisible();
  await check(page);
});

test("on a computer: one line of the review, the held line with its undo bar, the record and the recording screen each stay one 430 px column, strip of buttons included", async ({ browser, baseURL }) => {
  test.skip(provider !== "devfake", `needs SPEECH_PROVIDER=devfake, this server has ${provider}`);
  test.setTimeout(180_000);
  // a laptop's window (app/desktop.css: from 720 px every phone page is one column in the middle)
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Singapore", permissions: ["microphone"] });
  try {
    const page = await context.newPage();
    await signUp(page);
    const visitId = await recordedVisit(page, "v1");
    /** the screen is the column, in the middle, and nothing of it (the strip at its foot too) reaches outside it */
    const column = async (what: string) => {
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const col = document.querySelector(".rpu-screen")!.getBoundingClientRect();
        const outside: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".rpu-screen *"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < col.left - 1 || r.right > col.right + 1) outside.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
        }
        const strip = document.querySelector('[data-rp="dock"]')?.getBoundingClientRect() ?? null;
        return {
          width: col.width,
          off: Math.abs((col.left + col.right) / 2 - document.documentElement.clientWidth / 2),
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          outside: outside.slice(0, 6),
          strip: strip ? [Math.round(strip.left - col.left), Math.round(col.right - strip.right), Math.round(window.innerHeight - strip.bottom)] : null,
        };
      });
      expect(m.width, `${what}: the column's width`).toBe(430);
      expect(m.off, `${what}: the column is in the middle`).toBeLessThanOrEqual(1);
      expect(m.sideways, `${what}: the window does not scroll sideways`).toBeLessThanOrEqual(0);
      expect(m.outside, `${what}: nothing reaches outside the column`).toEqual([]);
      return m.strip;
    };

    // one line: the strip is as wide as the column and sits on the tab bar
    await page.goto(`/p/visit/${visitId}/review`);
    await expect(page.getByTestId("review-one")).toBeVisible();
    const tabs = await page.locator('[data-rp="tabbar"]').boundingBox();
    const asked = await column("one line");
    expect(asked?.slice(0, 2), "the strip spans the column").toEqual([0, 0]);
    expect(Math.abs(asked![2] - Math.round(tabs!.height)), "the strip sits on the tab bar").toBeLessThanOrEqual(1);
    // the held line: its undo bar is inside the strip
    await page.getByTestId("review-no").click();
    await expect(page.getByTestId("review-held")).toBeVisible();
    await expect(page.getByTestId("review-undo")).toBeVisible();
    expect((await column("the held line"))?.slice(0, 2)).toEqual([0, 0]);
    await page.getByTestId("review-next").click();
    await yesToAll(page);
    expect((await column("the record"))?.slice(0, 2)).toEqual([0, 0]);

    // recording: no tab bar, the strip at the very foot of the window
    await context.setExtraHTTPHeaders({ "x-ripple-devfake-fixture": "v1" });
    await page.goto("/p/visit?speed=8");
    await page.getByTestId("visit-clinic").click();
    await page.getByTestId("visit-direct").click();
    await column("the card for the doctor");
    await page.getByTestId("consent-start").click();
    await expect(page.getByTestId("visit-live")).toHaveAttribute("data-mode", "record");
    await expect(page.getByTestId("visit-captions")).toBeVisible({ timeout: 30_000 });
    expect(await column("recording")).toEqual([0, 0, 0]);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(/\/p\/visit\/[^/]+\/review$/, { timeout: 60_000 });
  } finally {
    await context.close();
  }
});

test("05-3: the recording waits for its text: what is saved, what comes later, 听录音, 先自己记一句 (a server without transcription)", async ({ page }) => {
  test.skip(provider !== "mock", `needs SPEECH_PROVIDER=mock, this server has ${provider}`);
  test.setTimeout(120_000);
  await signUp(page);
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toBeVisible();
  const visitId = (await live.getAttribute("data-visit"))!;
  await page.waitForTimeout(3_000);
  await check(page);
  await page.getByTestId("visit-stop").click();
  await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
  const waiting = page.getByTestId("review-awaiting");
  await expect(waiting).toHaveAttribute("data-transcript", "waiting");
  // the existing sentences, word for word, as the heading and the line's two entries
  await expect(waiting).toContainText("录音已存，还没有文字。");
  await expect(waiting).toContainText(/录音（\d+ 分 \d+ 秒）已经存好。转写接上以后会出文字，到时候通知你。/);
  await expect(waiting.locator('[data-rp="tl-item"]')).toHaveCount(2);
  await expect(waiting.locator('[data-rp="tl-item"]').first()).toHaveText(/^录音（\d+ 分 \d+ 秒）已经存好。$/);
  await expect(waiting.locator('[data-rp="listen"]')).toContainText("听录音");
  await check(page);
  await page.getByTestId("review-own-note-input").fill("医生说下星期再来。");
  await page.getByTestId("review-own-note-save").click();
  const mine = page.getByTestId("review-own-note");
  await expect(mine).toContainText("医生说下星期再来。");
  await expect(mine).toContainText("本人记的");
  await check(page);
});
