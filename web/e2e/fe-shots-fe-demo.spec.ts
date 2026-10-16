/**
 * Pictures and page checks of the demo sandbox phone and the judges' pages (front-end line fe-demo; web/progress/fe-demo.md):
 * the phone a judge sees in /demo's frame is the old set of screens (components/patient/PatientFrame), re-coloured and
 * re-set in the timeline design's palette and type by components/patient/demo-phone.css. Not a test of looks, and never
 * part of a default run: without FE_SHOTS_DIR every test here is skipped, so nothing is written anywhere.
 *
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe-demo/after PW_PORT=3890 npx playwright test e2e/fe-shots-fe-demo.spec.ts
 *
 * Each state is a judge's own copy of the story (POST /api/session on a chosen story day and time, the rp_session
 * cookie; no crew cookie on the phone, so no jump menu). Phone pages are 390x844 at twice the size, a page longer than
 * the phone is saved whole as <name>-full.png; the judges' pages are 1440x900. Next to the pictures the four page
 * checks (e2e/_checks/page-checks.ts) are run on every state and written, not asserted, to <dir>/checks.json: the
 * phone's pages at Mr Tan's floor (18 px, 48 px), her demo phone and the computer pages at 16 px and 44 px.
 * FE_DEMO_STRICT=1 asserts them (the phone pages of the "after" set).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { runPageChecks, type PageCheckReport, type Side } from "./_checks/page-checks";
import { api, BASE_URL, CREW_HEADERS, createSession, crewCookie, DEMO_ROOT, waitLive } from "./helpers";

const DIR = process.env.FE_SHOTS_DIR?.trim();
const STRICT = process.env.FE_DEMO_STRICT === "1";
const HERO = "今天 150/95，我能不能多吃一粒？";
const MED = "med-amlodipine";

// the `request` fixture is the crew's (the story clock, the director's cue); every phone below is a plain browser
test.use({ extraHTTPHeaders: CREW_HEADERS, launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
test.describe.configure({ mode: "serial", timeout: 300_000 });
test.skip(!DIR, "FE_SHOTS_DIR is not set: no screenshots are written");

interface CheckRow {
  name: string;
  side: Side;
  url: string;
  overflow: number;
  smallText: string[];
  smallTargets: string[];
  contrast: string[];
  checkedText: number;
  checkedTargets: number;
}
const rows: CheckRow[] = [];

function keep(name: string, side: Side, url: string, r: PageCheckReport): void {
  rows.push({ name, side, url, overflow: Math.max(r.overflow.doc, r.overflow.body), smallText: r.smallText, smallTargets: r.smallTargets, contrast: r.contrast, checkedText: r.checkedText, checkedTargets: r.checkedTargets });
  // written after every state, so a run that stops half way still leaves what it measured
  mkdirSync(DIR!, { recursive: true });
  writeFileSync(path.join(DIR!, "checks.json"), JSON.stringify(rows, null, 1));
}

async function settle(page: Page): Promise<void> {
  // the Next dev badge sits on the tab bar (of the page, and of the phone in /demo's frame)
  for (const frame of page.frames()) {
    await frame.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
    await frame.evaluate(() => document.fonts.ready).catch(() => undefined);
  }
  await page.waitForTimeout(350);
}

/** One PNG of the screen (a page longer than the window is saved whole as well), then the page checks, kept not asserted. */
async function shot(page: Page, name: string, opts: { side?: Side; allow?: string[]; checks?: boolean; full?: boolean } = {}): Promise<void> {
  mkdirSync(DIR!, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(DIR!, `${name}.png`) });
  const tall = opts.full !== false && (await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 8));
  if (tall) await page.screenshot({ path: path.join(DIR!, `${name}-full.png`), fullPage: true });
  if (opts.checks === false) return;
  const side = opts.side ?? "elder";
  const report = await runPageChecks(page, { side, allow: opts.allow });
  keep(name, side, new URL(page.url()).pathname, report);
  if (STRICT) {
    expect(report.overflow.doc, `${name}: sideways scroll at 360px ${report.overflow.offenders.join(", ")}`).toBeLessThanOrEqual(0);
    expect(report.smallText, `${name}: text under the floor`).toEqual([]);
    expect(report.smallTargets, `${name}: targets under the floor`).toEqual([]);
    expect(report.contrast, `${name}: contrast`).toEqual([]);
  }
}

/**
 * A foundation Screen drawn inside the demo frame (/p/ask): the frame's tab bar is at the foot of the phone with
 * nothing of the screen over it, and the dock with the field to ask again stands directly on it: always while it is
 * pinned (the screen is about asking), at the page's end once an answer has the screen (it is then the page's last
 * block and scrolls under the tab bar like the rest). Checked where the page opens and after scrolling to its end
 * (asserted with FE_DEMO_STRICT=1, written to the log otherwise).
 */
async function barsInPlace(page: Page, name: string): Promise<void> {
  for (const where of ["top", "end"] as const) {
    await page.evaluate((w) => window.scrollTo(0, w === "top" ? 0 : document.documentElement.scrollHeight), where);
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-testid="tab-bar"]');
      const dock = document.querySelector<HTMLElement>('.rpu-dock[data-bar="true"]');
      if (!bar) return null;
      const b = bar.getBoundingClientRect();
      // what is drawn on top at three points of the tab bar
      const covered = [0.1, 0.5, 0.9].filter((x) => {
        const top = document.elementFromPoint(b.left + b.width * x, b.top + b.height / 2);
        return !top || !bar.contains(top);
      }).length;
      const d = dock?.getBoundingClientRect() ?? null;
      return { barTop: b.top, barBottom: b.bottom, viewport: window.innerHeight, covered, dockBottom: d ? d.bottom : null, pinned: dock?.getAttribute("data-pinned") !== "false" };
    });
    const line = `${name} (${where}): ${JSON.stringify(m)}`;
    if (!STRICT) {
      console.log(line);
      continue;
    }
    expect(m, `${name}: the frame's tab bar is drawn`).not.toBeNull();
    expect(m!.covered, `the tab bar is not covered: ${line}`).toBe(0);
    expect(Math.abs(m!.barBottom - m!.viewport), `the tab bar stands at the foot of the phone: ${line}`).toBeLessThanOrEqual(1);
    // a pinned dock always stands on the tab bar; one that is not pinned is the page's last block, and stands on it at the page's end
    if (m!.dockBottom !== null && (m!.pinned || where === "end")) {
      expect(Math.abs(m!.dockBottom - m!.barTop), `the dock ends where the tab bar starts: ${line}`).toBeLessThanOrEqual(1.5);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function phoneContext(browser: Browser, sessionId: string, opts: { lang?: "en"; crew?: boolean } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  await context.addCookies([{ name: "rp_session", value: sessionId, url: BASE_URL }]);
  if (opts.lang) await context.addCookies([{ name: "rp_lang", value: opts.lang, url: BASE_URL }]);
  if (opts.crew) await context.addCookies([crewCookie()]);
  return context;
}

async function open(page: Page, pathname: string): Promise<void> {
  expect((await page.goto(pathname))?.status(), pathname).toBe(200);
  await waitLive(page);
}

async function crewPost(request: APIRequestContext, pathname: string, sessionId: string, data: Record<string, unknown>): Promise<void> {
  const res = await request.post(`${pathname}?session=${sessionId}`, { data, headers: CREW_HEADERS });
  expect(res.ok(), `${pathname}: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(600_000);
  // next dev compiles each route on its first request (a production build has nothing to compile)
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const cookie = { cookie: `rp_session=${s.id}; ${crewCookie().name}=${crewCookie().value}` };
  for (const p of [DEMO_ROOT, "/p/today", "/p/visit", "/p/visit/v1/review", "/p/meds", `/p/meds/${MED}`, "/p/meds/add", "/p/bp", "/p/questions", "/p/brief", "/p/family", "/p/ask", "/f", "/how", "/eval", "/backstage", "/director", "/backstage/crew", "/join"]) {
    await request.get(p, { headers: cookie });
  }
  await request.post(`/api/ask?session=${s.id}`, { data: { text: HERO, locale: "zh-Hans", role: "patient" } });
});

test("the phone: Today on the hero evening, the hero question and its answer, the ask page", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  await open(page, "/p/today");
  await expect(page.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  await shot(page, "p-today-evening");
  // the ask screen before anything was asked: its dock is pinned, directly on the frame's tab bar
  await open(page, "/p/ask");
  await shot(page, "p-ask-start");
  await barsInPlace(page, "p-ask-start");
  await open(page, "/p/today");

  await page.getByTestId("ask-input").fill(HERO);
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
  await page.getByTestId("ask-turn").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const turn = document.querySelector<HTMLElement>('[data-testid="ask-turn"]');
    if (turn) window.scrollBy({ top: turn.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(turn).scrollMarginTop) || 0), behavior: "instant" });
  });
  await shot(page, "p-today-answer");

  // a second question: an explanation (the leaflet and the doctor's words)
  await page.getByTestId("ask-input").fill("Amlodipine 这个药是做什么的？");
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-asked")).toHaveText("“Amlodipine 这个药是做什么的？”", { timeout: 15_000 });
  await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
  await page.evaluate(() => {
    const turn = document.querySelector<HTMLElement>('[data-testid="ask-turn"]');
    if (turn) window.scrollBy({ top: turn.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(turn).scrollMarginTop) || 0), behavior: "instant" });
  });
  await shot(page, "p-today-answer-explain");

  // the answer's own screen inside the demo frame (the foundation's Screen in the old frame)
  await open(page, "/p/ask");
  await shot(page, "p-ask");
  await barsInPlace(page, "p-ask");
  // back on Today after a reload: today's questions, the newest open
  await open(page, "/p/today");
  await expect(page.getByTestId("ask-earlier")).toHaveAttribute("data-count", "2", { timeout: 10_000 });
  await page.getByTestId("ask-earlier").scrollIntoViewIfNeeded();
  await shot(page, "p-today-earlier", { full: false });

  // an emergency sentence: the 995 template
  await open(page, "/p/today");
  await page.getByTestId("ask-input").fill("我胸口很痛，喘不过气");
  await page.getByTestId("ask-send").click();
  await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
  await page.evaluate(() => {
    const turn = document.querySelector<HTMLElement>('[data-testid="ask-turn"]');
    if (turn) window.scrollBy({ top: turn.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(turn).scrollMarginTop) || 0), behavior: "instant" });
  });
  await shot(page, "p-today-answer-emergency");
  // the same answer on its own screen: the foundation's emergency block inside the frame
  await open(page, "/p/ask");
  await shot(page, "p-ask-emergency");
  await barsInPlace(page, "p-ask-emergency");

  // the fixed lines whose numbers are links, outside an emergency: the line under a note, then the helplines
  for (const [sentence, name] of [["我今天好累。", "p-today-answer-note"], ["我不想活了", "p-today-answer-helplines"]] as const) {
    await open(page, "/p/today");
    await page.getByTestId("ask-input").fill(sentence);
    await page.getByTestId("ask-send").click();
    await expect(page.getByTestId("ask-asked")).toHaveText(`“${sentence}”`, { timeout: 15_000 });
    await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
    await page.evaluate(() => {
      const turn = document.querySelector<HTMLElement>('[data-testid="ask-turn"]');
      if (turn) window.scrollBy({ top: turn.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(turn).scrollMarginTop) || 0), behavior: "instant" });
    });
    await shot(page, name);
  }
  // the helplines on the answer's own screen (the longest of them: the dock, then the frame's tab bar)
  await open(page, "/p/ask");
  await shot(page, "p-ask-helplines");
  await barsInPlace(page, "p-ask-helplines");
  await context.close();

  // the same evening in English (longer tab labels)
  const en = await phoneContext(browser, s.id, { lang: "en" });
  const enPage = await en.newPage();
  await open(enPage, "/p/today");
  await shot(enPage, "p-today-evening-en");
  await en.close();
});

test("the phone: a morning with the reminder due, 没吃 and its reasons, the undo bar", async ({ browser, request }) => {
  // Day 43 (a Tuesday, a tai chi morning): the story has no answer for this morning yet, and 8:45 is the first reminder
  const s = await createSession(request, { story_day: 43, story_time: "08:45" });
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  await open(page, "/p/today");
  await expect(page.getByTestId(`dose-btn-${MED}-taken`)).toBeVisible();
  await expect(page.getByTestId("reminder-strip")).toBeVisible();
  await shot(page, "p-today-morning-due");

  await page.getByTestId(`dose-btn-${MED}-missed`).click();
  await expect(page.getByTestId(`dose-reason-${MED}`)).toBeVisible();
  await expect(page.getByTestId("undo-bar")).toBeVisible();
  await shot(page, "p-today-missed-reasons");
  await page.getByTestId(`dose-reason-${MED}`).locator("button").first().click();
  await expect(page.getByTestId(`dose-reason-shown-${MED}`)).toBeVisible({ timeout: 8000 });
  await shot(page, "p-today-missed-saved");

  // the same morning in English
  await context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await open(page, "/p/today");
  await shot(page, "p-today-morning-en");
  await context.close();
});

test("the phone: the director's reminder card, and filming mode", async ({ browser, request }) => {
  const s = await createSession(request, { kind: "filming", story_day: 43, crew_key: CREW_HEADERS["x-ripple-crew-key"] });
  // the crew's phone: the jump menu and the debug line are on it
  const context = await phoneContext(browser, s.id, { crew: true });
  const page = await context.newPage();
  await open(page, "/p/today");
  await expect(page.getByTestId("jump-menu")).toBeVisible();
  await page.getByTestId("jump-menu").locator("summary").click();
  await shot(page, "p-today-crew-jump-menu", { allow: ['[data-testid="jump-menu"]', '[data-testid="debug-info"]'] });
  await api(request, "/api/director/cue", s.id, { cue: "reminder" });
  await expect(page.getByTestId("reminder-card")).toBeVisible({ timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "p-today-reminder-card", { allow: ['[data-testid="jump-menu"]', '[data-testid="debug-info"]'] });
  await api(request, "/api/director/filming", s.id, { on: true, crew_key: CREW_HEADERS["x-ripple-crew-key"] });
  await expect(page.locator(".rp-patient")).toHaveAttribute("data-filming", "true");
  await shot(page, "p-today-filming");
  await context.close();
});

test("the phone: the visit page, a replay, its review before and after he confirms", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const evening = await createSession(request, { story_day: 29, story_time: "20:15" });
  const first = await phoneContext(browser, evening.id);
  const start = await first.newPage();
  await open(start, "/p/visit");
  await expect(start.getByTestId("visit-consent-step")).toBeVisible();
  await shot(start, "p-visit");
  // a visit of the story that happened: its review as it stands
  await open(start, "/p/visit/v1/review");
  await shot(start, "p-visit-review-v1");
  await first.close();

  const s = await createSession(request, { story_day: 8, story_time: "10:00" }); // the second visit's own day
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  await open(page, "/p/visit?replay=v2&speed=20");
  await expect(page.getByTestId("visit-screen")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "p-visit-replay");
  // a check card, shown to the doctor full screen
  const show = page.locator('[data-kind="chk"] [data-testid$="-show"]').first();
  await show.scrollIntoViewIfNeeded();
  await show.click();
  await expect(page.locator('[data-testid$="-overlay"]')).toBeVisible();
  await shot(page, "p-visit-check-shown", { full: false });
  await page.locator('[data-testid$="-overlay"] button').click();
  await page.getByTestId("visit-end").click();
  await page.waitForURL(/\/p\/visit\/v2\/review$/, { timeout: 30_000 });
  await expect(page.getByTestId("page-visit-review")).toBeVisible();
  await shot(page, "p-visit-review");
  await page.getByTestId("verdict-v2-u08-wrong").click();
  await page.getByTestId("verdict-v2-u06-right").click();
  await page.getByTestId("verdict-v2-u08-wrong").scrollIntoViewIfNeeded();
  await shot(page, "p-visit-review-marked", { full: false });
  await page.getByTestId("review-confirm").click();
  await expect(page.getByTestId("review-status")).toHaveText("已确认", { timeout: 15_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "p-visit-review-confirmed");
  await context.close();
});

test("the phone: medicines, one card, an unknown medicine, adding a label", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  await open(page, "/p/meds");
  await shot(page, "p-meds");
  await open(page, `/p/meds/${MED}`);
  await expect(page.getByTestId("med-card")).toBeVisible();
  await shot(page, "p-med-card");
  // the understanding checklist with one 知道 and one 不确定 pressed (the pressed fill and its words)
  const know = page.locator('[data-testid^="check-"][data-testid$="-know"]').first();
  const unsure = page.locator('[data-testid^="check-"][data-testid$="-unsure"]').nth(1);
  await know.click();
  await expect(know).toHaveAttribute("aria-pressed", "true");
  await unsure.click();
  await expect(unsure).toHaveAttribute("aria-pressed", "true");
  await know.scrollIntoViewIfNeeded();
  await shot(page, "p-med-card-understood", { full: false });
  // every other row of the list: the bought one, and the one Ripple cannot identify
  await open(page, "/p/meds");
  const others = await page.locator('[data-testid^="med-row-"]').evaluateAll((rows) => rows.map((r) => r.getAttribute("href") ?? "").filter((h) => h && !h.endsWith("/med-amlodipine")));
  let n = 0;
  for (const href of others) {
    await open(page, href);
    await shot(page, `p-med-card-other-${++n}`);
  }
  await open(page, "/p/meds/add");
  await shot(page, "p-meds-add");
  // a sample photo: what was read, line by line, then the result
  await page.locator('[data-testid^="add-origin-"]').first().click();
  await expect(page.getByTestId("add-photo")).toBeVisible();
  await shot(page, "p-meds-add-photo");
  await page.locator('[data-testid^="add-sample-"]').first().click();
  await expect(page.getByTestId("add-check")).toBeVisible({ timeout: 30_000 });
  await shot(page, "p-meds-add-check");
  for (const right of await page.locator('[data-testid^="add-right-"]').all()) await right.click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, "p-meds-add-checked", { full: false });
  await page.getByTestId("add-save").click();
  await expect(page.getByTestId("add-result")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "p-meds-add-result");
  await context.close();

  // a medicine that waits for its label (Day 43: Losartan was prescribed the day before)
  const late = await createSession(request, { story_day: 43, story_time: "08:30" });
  const lateContext = await phoneContext(browser, late.id);
  const latePage = await lateContext.newPage();
  await open(latePage, "/p/meds");
  await shot(latePage, "p-meds-day43");
  const waiting = await latePage.locator('[data-testid^="med-row-"]').evaluateAll((rows) => rows.filter((r) => /await/.test(r.getAttribute("data-status") ?? "")).map((r) => r.getAttribute("href") ?? "")[0] ?? null);
  if (waiting) {
    await open(latePage, waiting);
    await shot(latePage, "p-med-card-awaiting");
  }
  await lateContext.close();
});

test("the phone: blood pressure, a reading above the doctor's warning line; the question list; the brief", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  await open(page, "/p/bp");
  await shot(page, "p-bp");
  await page.getByTestId("bp-input-top").fill("185");
  await page.getByTestId("bp-input-bottom").fill("112");
  await page.getByTestId("bp-save").click();
  await expect(page.getByTestId("bp-record-relay")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("bp-record-relay").scrollIntoViewIfNeeded();
  await shot(page, "p-bp-relay");

  await open(page, "/p/questions");
  await shot(page, "p-questions");
  await open(page, "/p/brief");
  await expect(page.getByTestId("page-brief")).toBeVisible();
  await shot(page, "p-brief");
  await context.close();

  // after the third visit: answered questions with the doctor's words
  const late = await createSession(request, { story_day: 43, story_time: "08:30" });
  const lateContext = await phoneContext(browser, late.id);
  const latePage = await lateContext.newPage();
  await open(latePage, "/p/questions");
  await shot(latePage, "p-questions-day43");
  await open(latePage, "/p/brief");
  await shot(latePage, "p-brief-day43");
  await lateContext.close();

  // the brief as the doctor reads it
  const en = await phoneContext(browser, s.id, { lang: "en" });
  const enPage = await en.newPage();
  await open(enPage, "/p/brief");
  await shot(enPage, "p-brief-en");
  await en.close();
});

test("the phone: what his family can see; her phone's home", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  await open(page, "/p/family");
  await expect(page.getByTestId("page-family-grants")).toBeVisible();
  await shot(page, "p-family");
  // her phone in the same copy: text at least 16 px and targets at least 44 px, as on her own account's pages
  await open(page, "/f");
  await expect(page.getByTestId("page-family")).toBeVisible();
  await shot(page, "f-home", { side: "family" });
  await context.close();

  // a morning the story has no answer for, after the second reminder's window closed: her alert
  const alert = await createSession(request, { story_day: 43, story_time: "09:50" });
  const her = await phoneContext(browser, alert.id);
  const herPage = await her.newPage();
  await open(herPage, "/p/today"); // reading his page settles the morning with no reply
  await shot(herPage, "p-today-no-reply");
  await open(herPage, "/f");
  await expect(herPage.getByTestId("family-alerts")).toHaveAttribute("data-count", /[1-9]/, { timeout: 10_000 });
  await shot(herPage, "f-home-no-reply", { side: "family" });
  await her.close();
});

test("the phone: the pages that draw the foundation's Screen inside the demo frame", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  await request.post(`/api/ask?session=${s.id}`, { data: { text: "我今天好累。", locale: "zh-Hans", role: "patient" } });
  const context = await phoneContext(browser, s.id);
  const page = await context.newPage();
  for (const [route, name] of [["/p/chat", "p-chat"], ["/p/diet", "p-diet"], ["/p/prevent", "p-prevent"], ["/p/watch", "p-watch"]] as const) {
    const res = await page.goto(route);
    if (res?.status() !== 200) continue; // a page the demo scope does not have
    await waitLive(page);
    await shot(page, name);
  }
  await context.close();
});

test("the phone in English (a judge's switch on /demo): answers, every tab page, one card, a replay and its review, her phone", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await phoneContext(browser, s.id, { lang: "en" });
  const page = await context.newPage();
  // the hero question, an emergency, the helplines: the longer English lines in the same cards
  for (const [sentence, name] of [
    ["Today 150/95, can I take one more tablet?", "p-today-answer-en"],
    ["I have chest pain and I can't breathe", "p-today-answer-emergency-en"],
    ["I don't want to live anymore", "p-today-answer-helplines-en"],
  ] as const) {
    await open(page, "/p/today");
    await page.getByTestId("ask-input").fill(sentence);
    await page.getByTestId("ask-send").click();
    await expect(page.getByTestId("ask-asked")).toHaveText(`“${sentence}”`, { timeout: 15_000 });
    await expect(page.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
    await page.evaluate(() => {
      const turn = document.querySelector<HTMLElement>('[data-testid="ask-turn"]');
      if (turn) window.scrollBy({ top: turn.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(turn).scrollMarginTop) || 0), behavior: "instant" });
    });
    await shot(page, name);
  }
  for (const [route, name] of [
    ["/p/visit", "p-visit-en"],
    ["/p/visit/v1/review", "p-visit-review-v1-en"],
    ["/p/meds", "p-meds-en"],
    [`/p/meds/${MED}`, "p-med-card-en"],
    ["/p/meds/add", "p-meds-add-en"],
    ["/p/bp", "p-bp-en"],
    ["/p/questions", "p-questions-en"],
    ["/p/family", "p-family-en"],
  ] as const) {
    await open(page, route);
    await shot(page, name);
  }
  await open(page, "/p/ask");
  await shot(page, "p-ask-en");
  await barsInPlace(page, "p-ask-en");
  await open(page, "/f");
  await expect(page.getByTestId("page-family")).toBeVisible();
  await shot(page, "f-home-en", { side: "family" });
  await context.close();

  // the second visit replayed with the phone in English, and its review
  const v = await createSession(request, { story_day: 8, story_time: "10:00" });
  const visit = await phoneContext(browser, v.id, { lang: "en" });
  const vp = await visit.newPage();
  await open(vp, "/p/visit?replay=v2&speed=20");
  await expect(vp.getByTestId("visit-screen")).toBeVisible({ timeout: 30_000 });
  await expect(vp.getByTestId("visit-screen")).toHaveAttribute("data-stream", "ended", { timeout: 90_000 });
  await vp.evaluate(() => window.scrollTo(0, 0));
  await shot(vp, "p-visit-replay-en");
  await vp.getByTestId("visit-end").click();
  await vp.waitForURL(/\/p\/visit\/v2\/review$/, { timeout: 30_000 });
  await expect(vp.getByTestId("page-visit-review")).toBeVisible();
  await shot(vp, "p-visit-review-en");
  await visit.close();
});

test("the phones without a session: the crew's join page, a phone whose copy of the story is gone", async ({ browser }) => {
  const phone = { baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN" };
  // a session cookie that names no live session (a judge's copy that ran out)
  const gone = { name: "rp_session", value: "demo-00000000-0000-4000-8000-000000000000", url: BASE_URL };
  const context = await browser.newContext(phone);
  await context.addCookies([crewCookie()]);
  const page = await context.newPage();
  expect((await page.goto("/join"))?.status()).toBe(200);
  await expect(page.getByTestId("join-form")).toBeVisible();
  await shot(page, "join");
  // the crew is offered the join code
  await context.addCookies([gone]);
  await page.goto("/p/today");
  await expect(page.getByTestId("no-session")).toBeVisible();
  await expect(page.locator('[data-testid="no-session"] a[href="/join"]')).toBeVisible();
  await shot(page, "no-session-crew");
  await context.close();

  // anyone else: sign in, or a demo copy of their own
  const plain = await browser.newContext(phone);
  await plain.addCookies([gone]);
  const pp = await plain.newPage();
  await pp.goto("/p/today");
  await expect(pp.getByTestId("no-session-sign-in")).toBeVisible();
  await shot(pp, "no-session");
  await plain.close();
});

test("the judges' pages on a computer: /demo with the phone loaded and the hero answered, /how, /eval", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  const allow = ['[data-testid="landing-phone"]'];
  expect((await page.goto(DEMO_ROOT))?.status()).toBe(200);
  const hero = page.getByTestId("hero-button");
  await expect(hero).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  const phone = page.frameLocator('[data-testid="landing-phone"]');
  await expect(phone.getByTestId("story-day-label")).toHaveText("第29天 · 周二 晚上8:15");
  await expect(phone.getByTestId("ask-input")).toBeVisible();
  await shot(page, "demo-loaded", { side: "family", allow });

  await hero.click();
  await expect(phone.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
  await expect(page.getByTestId("hero-status")).toContainText("The whole answer was on the phone");
  await expect(page.getByTestId("event-feed").locator('[data-testid="event-row"][data-type="ask.answered"]')).toHaveCount(1, { timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "demo-answered", { side: "family", allow });
  // the check drill opened, and the lower part of the page (the backstage)
  await page.getByTestId("drill-summary").click();
  await page.getByTestId("event-feed").scrollIntoViewIfNeeded();
  await shot(page, "demo-backstage", { checks: false, full: false });

  expect((await page.goto("/how"))?.status()).toBe(200);
  await shot(page, "how", { side: "family" });
  expect((await page.goto("/eval"))?.status()).toBe(200);
  await shot(page, "eval", { side: "family" });
  await context.close();

  // the same page on a phone-wide window: stacked
  const narrow = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "zh-CN" });
  const np = await narrow.newPage();
  expect((await np.goto(DEMO_ROOT))?.status()).toBe(200);
  await expect(np.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await shot(np, "demo-390", { side: "family", allow });
  await narrow.close();

  // the phone of the same copy in a tab of its own, in a computer's window
  const wide = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const wp = await wide.newPage();
  expect((await wp.goto(DEMO_ROOT))?.status()).toBe(200);
  await expect(wp.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await wp.goto("/p/today");
  await waitLive(wp);
  await shot(wp, "p-today-on-a-computer", { checks: false });
  await wp.goto("/f");
  await waitLive(wp);
  await shot(wp, "f-on-a-computer", { checks: false });
  await wide.close();
});

test("the crew's pages on a computer: the judges' page with the story clock, the backstage, the director", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await context.addCookies([crewCookie()]);
  const page = await context.newPage();
  expect((await page.goto(DEMO_ROOT))?.status()).toBe(200);
  await expect(page.getByTestId("hero-button")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(page.getByTestId("landing-story")).toBeVisible();
  await page.getByTestId("hero-button").click();
  await expect(page.frameLocator('[data-testid="landing-phone"]').getByTestId("ask-answer")).toHaveAttribute("data-complete", "true", { timeout: 15_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "demo-crew", { side: "family", allow: ['[data-testid="landing-phone"]'] });
  for (const [route, name] of [["/backstage", "backstage"], ["/director", "director"], ["/backstage/crew", "backstage-crew"], ["/backstage/real", "backstage-real"]] as const) {
    expect((await page.goto(route))?.status(), route).toBe(200);
    if (route === "/director" || route === "/backstage") await waitLive(page);
    await shot(page, name, { side: "family" });
  }
  // the consultations of /backstage/real are rows now (the radio lies over its row): picking another one still works
  const second = page.getByTestId("real-consultations").locator('input[type="radio"]').nth(1);
  await second.check();
  await expect(second).toBeChecked();
  await shot(page, "backstage-real-picked", { side: "family", full: false });
  await context.close();
});
