/**
 * e2e real/story-leak (docs/plan/real-app.md 5.6 H1 and H3, lines 1101-1103; 8.3 line 1435; 4.8 rule 7; C2 track G).
 *
 * Nothing of the demo's story, and no id of a person, reaches a real account: with an example account (Mr Tan's six
 * weeks on today's dates), with a blank account that is still setting up, and with a family member linked to the
 * example account, every account page is opened in 华语 and in English, and for each one the watch (e2e/real/_leak.ts)
 * looks at what the screen shows, at the raw HTML, and at the body of every response the page asks for:
 *
 *   his pages    every page under /p (the list is read from app/p on disk: a new page that this spec does not open
 *                fails the first test), with real rows behind them: a hero question asked, a chat line, a reading, a
 *                note, a question, a dose answered, a family member linked with every switch on, one round of the jobs
 *   setting up   /onboard and each of its steps, on a blank account that has not finished
 *   her pages    /f and every page under it, through her active link
 *   the stream   the first frames of each account's own event stream: 「: connected」 with no id, none of the demo's
 *                event types (H4), and the demo's session row is not readable (H5)
 *
 * for 「Day N」 and 「第N天」, a story clock label, the jump menu and the debug line, ?session= in any address, a join
 * code, the demo's event types, the account's scope id and both people's user ids (as they are and inside base64
 * tokens), and the story's own dates.
 *
 * The story's dates (24 Aug to 6 Oct 2026) can only be told from an account's real dates when the two are far apart,
 * so the developer test clock stands at Mon 15 Mar 2027 08:50 in Singapore for the whole spec (frozen; cleared at the
 * end): the example account's six weeks are then February and March 2027, and any August, September or early October
 * date on its screens is the template's own.
 *
 * The positive control: the same watch on a demo sandbox phone does find the story's words (so the rules can fail).
 *
 * Runs against a server with the developer tools on (test accounts, the test clock): a production build started with
 * scripts/record/serve.mjs (RIPPLE_DEV_TOOLS=1). PW_PORT names it. It moves the server's one test clock, so nothing
 * else may use that server while it runs.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createSession } from "../helpers";
import { LeakWatch } from "./_leak";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";
const CLOCK = "2027-03-15T08:50:00+08:00";
const WEB = path.join(__dirname, "..", "..");
const PHONE = { viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" } as const;

/** Every page file under web/app/<root>, as its route pattern ("/p/meds/[id]"). */
function pagePatterns(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx") out.push(`/${path.relative(path.join(WEB, "app"), dir).split(path.sep).join("/")}`);
    }
  };
  walk(path.join(WEB, "app", root));
  return out.sort();
}

/** Does this concrete address belong to the route pattern? */
function matches(pattern: string, pathname: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/\\?\[[^\]]+\\?\]/g, "[^/]+")}$`);
  return re.test(pathname);
}

interface Person {
  context: BrowserContext;
  page: Page;
  userId: string;
  login: string;
}

async function newPerson(browser: Browser, space: "example" | "blank" | "none", name: string, extra: Record<string, unknown> = {}): Promise<Person> {
  const context = await browser.newContext(PHONE);
  const login = `g${randomUUID().replace(/-/g, "").slice(0, 11)}`;
  const res = await context.request.post("/api/dev/accounts", { data: { login, password: PASSWORD, space, display_name: name, locale: "zh-Hans", ...extra } });
  expect(res.status(), `dev account: ${await res.text()}`).toBe(201);
  const body = (await res.json()) as { user_id: string };
  return { context, page: await context.newPage(), userId: body.user_id, login };
}

/** One of the account's own API calls, made outside a page: it must succeed, and its answer is looked at like a page's own. */
async function call(watch: LeakWatch, who: string, context: BrowserContext, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, data?: unknown): Promise<APIResponse> {
  const res = await context.request.fetch(url, { method, ...(data === undefined ? {} : { data }) });
  expect(res.ok(), `${method} ${url}: ${res.status()} ${await res.text()}`).toBe(true);
  await watch.api(who, res, method);
  return res;
}

async function setLang(context: BrowserContext, baseURL: string, lang: "zh-Hans" | "en"): Promise<void> {
  await context.addCookies([{ name: "rp_lang", value: lang, url: baseURL }]);
}

/** Open one page and let it finish what it asks for (its live connection where it has one), then look at it. */
async function look(watch: LeakWatch, who: string, page: Page, url: string): Promise<{ status: number; pathname: string }> {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  // the page's own requests: its data, its live connection (never "network idle": the event stream stays open)
  await page.waitForLoadState("load").catch(() => undefined);
  await page.locator('[data-live="open"]').first().waitFor({ state: "attached", timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(350);
  await watch.page(page, who);
  return { status: res?.status() ?? 0, pathname: new URL(page.url()).pathname };
}

test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/dev/clock", { data: { at: CLOCK, frozen: true } });
  expect(res.status(), `the developer tools must be on (RIPPLE_DEV_TOOLS=1): ${await res.text()}`).toBe(200);
});
test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { clear: true } });
});

test("the watch can fail: on a demo sandbox phone it finds the story's day, and a planted id in every form", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const context = await browser.newContext(PHONE);
  const joined = await context.request.post("/api/session/join", { data: { code: s.join_code, role: "patient" } });
  expect(joined.status(), await joined.text()).toBe(200);
  const watch = new LeakWatch({ storyDates: true });
  watch.attach(context, "demo");
  const page = await context.newPage();
  await look(watch, "demo", page, "/p/today");
  await look(watch, "demo", page, "/p/brief");
  await watch.settle();
  const rules = new Set(watch.hits.map((h) => h.rule));
  expect([...rules]).toContain("story day (第N天)");
  expect(watch.hits.some((h) => /story date/.test(h.rule))).toBe(true);
  expect(watch.seen.pages).toBe(2);
  expect(watch.seen.responses).toBeGreaterThan(2);
  // ids: plain, and inside a token at each alignment
  const planted = new LeakWatch();
  const id = randomUUID();
  planted.addId("the scope id", id);
  planted.text("x", "plain", `{"id":"${id}"}`, "response");
  for (const pad of ["", "a", "ab"]) planted.text("x", `token ${pad.length}`, `{"t":"${Buffer.from(`${pad}{"sid":"${id}"}`).toString("base64url")}.sig"}`, "response");
  planted.text("x", "address", `<a href="/p/today?session=${id}">x</a>`, "html");
  expect(planted.hits.map((h) => h.rule).sort()).toEqual(["?session= in an address", "the scope id (base64)", "the scope id (base64)", "the scope id (base64)", "the scope id (plain)", "the scope id (plain)"]);
  await context.close();
});

test("the example account, the family member linked to it, and a blank account setting up: every page, 华语 and English", async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  const base = baseURL!;
  const watch = new LeakWatch({ storyDates: true });
  // the dates on an account's screens that fall in the story's range and are not the story's: under each screening fact
  // of /p/prevent, the official page's own date and the day the fact was last checked against it (kb/prevention.json)
  watch.allow({ rule: /^story date/, where: /\/p\/prevent/, sample: /出处|Source:|核对|checked|version/, why: "a citation's own dates under a screening fact (the official page's date, the knowledge base's check date), on the screen and in the page's data" });

  // ------------------------------------------------------------ the people
  const him = await newPerson(browser, "example", "陈先生");
  const her = await newPerson(browser, "none", "Wei Ling");
  const blank = await newPerson(browser, "blank", "林先生", { onboarding: "started" });
  watch.addId("his scope id (his user id)", him.userId);
  watch.addId("her user id", her.userId);
  watch.addId("the blank account's scope id", blank.userId);
  watch.attach(him.context, "him");
  watch.attach(her.context, "her");
  watch.attach(blank.context, "blank");

  // ------------------------------------------------------------ real rows behind his pages
  await call(watch, "him", him.context, "POST", "/api/me/example", { action: "dismiss_intro" });
  const asked = await call(watch, "him", him.context, "POST", "/api/ask", { text: "今天 150/95，我能不能多吃一粒？" });
  expect(((await asked.json()) as { route?: string }).route).toBe("refuse_route");
  await call(watch, "him", him.context, "POST", "/api/bp", { id: randomUUID(), systolic: 150, diastolic: 95 });
  await call(watch, "him", him.context, "POST", "/api/notes", { text: "今天有点累" });
  await call(watch, "him", him.context, "POST", "/api/questions", { text: "我可以去游泳吗？", for: "doctor" });
  await call(watch, "him", him.context, "POST", "/api/doses", { medication_id: "med-amlodipine", slot: "morning", state: "taken" });
  const invited = await call(watch, "him", him.context, "POST", "/api/family/invites", { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" });
  const invitation = (await invited.json()) as { path: string; link: { id: string } };
  const linkId = invitation.link.id;
  // the invitation page is public: she reads it before she has an account (her context is signed in here already)
  await look(watch, "her", her.page, invitation.path);
  await call(watch, "her", her.context, "POST", "/api/family/invites/accept", { token: invitation.path.replace(/^\/invite\//, "") });
  await call(watch, "him", him.context, "POST", `/api/family/links/${linkId}/confirm`, { yes: true });
  await call(watch, "him", him.context, "POST", `/api/family/links/${linkId}/grants`, {
    items: { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true },
  });
  // one round of the jobs at 08:50: the morning reminder is out (its words are in 「最近的提醒」)
  const ticked = await him.context.request.post("/api/dev/tick", { data: { names: ["daily.doses", "daily.bp"] } });
  expect(ticked.status(), await ticked.text()).toBe(200);

  const meds = ((await (await call(watch, "him", him.context, "GET", "/api/meds")).json()) as { groups: { items: { id: string }[] }[] }).groups.flatMap((g) => g.items.map((m) => m.id));
  const questions = (await (await call(watch, "him", him.context, "GET", "/api/questions")).json()) as { list: { open: { id: string }[]; answered: { id: string }[] } };
  expect(meds.length).toBeGreaterThanOrEqual(3);
  expect(questions.list.open.length).toBeGreaterThanOrEqual(3);

  const HIS_PAGES: string[] = [
    "/p",
    "/p/today",
    "/p/ask",
    "/p/bp",
    "/p/brief",
    "/p/chat",
    "/p/diet",
    "/p/family",
    "/p/family/invite",
    `/p/family/${linkId}`,
    `/p/family/${linkId}/seen`,
    `/p/family/${linkId}/stop`,
    "/p/me",
    "/p/me/ai",
    "/p/me/delete",
    "/p/me/devices",
    "/p/me/example",
    "/p/me/export",
    "/p/me/export/access",
    "/p/me/export/recordings",
    "/p/me/filming",
    "/p/me/notifications",
    "/p/me/password",
    "/p/me/recovery",
    "/p/me/reset-help",
    "/p/meds",
    ...meds.map((id) => `/p/meds/${id}`),
    "/p/meds/add",
    "/p/prevent",
    "/p/profile",
    "/p/profile/language",
    "/p/profile/name",
    "/p/profile/times",
    ...["morning", "midday", "evening", "night"].map((s) => `/p/profile/times/${s}`),
    "/p/questions",
    "/p/questions/add",
    "/p/questions/answered",
    "/p/questions/skipped",
    `/p/questions/${questions.list.open[0].id}/edit`,
    "/p/visit",
    ...["v1", "v2", "p1"].map((v) => `/p/visit/${v}/review`),
    "/p/watch",
  ];
  const HER_PAGES: string[] = [
    `/f?link=${linkId}`,
    `/f/week?link=${linkId}`,
    `/f/shared?link=${linkId}`,
    `/f/shared/visits?link=${linkId}`,
    `/f/shared/notes?link=${linkId}`,
    `/f/shared/visit/v2?link=${linkId}`,
    `/f/reminder?link=${linkId}`,
    `/f/reminder/mine?link=${linkId}`,
    `/f/alert?link=${linkId}`,
    `/f/facts?link=${linkId}`,
    `/f/phone?link=${linkId}`,
    `/f/me?link=${linkId}`,
    `/f/me/notifications?link=${linkId}`,
    `/f/me/install?link=${linkId}`,
    `/f/me/leave?link=${linkId}`,
    `/f/me/password?link=${linkId}`,
    `/f/me/devices?link=${linkId}`,
    `/f/me/recovery?link=${linkId}`,
    `/f/me/delete?link=${linkId}`,
    "/f",
  ];
  const ONBOARD_PAGES: string[] = ["/onboard", ...["who", "clinic", "breakfast", "habits", "meds", "age", "conditions", "allergies", "family", "reminders", "done"].map((s) => `/onboard/${s}`)];

  // ------------------------------------------------------------ nothing is left out: the lists against the pages on disk
  const onDisk = { p: pagePatterns("p"), f: pagePatterns("f"), onboard: pagePatterns("onboard") };
  expect(onDisk.p.length).toBeGreaterThan(35);
  expect(onDisk.f.length).toBeGreaterThanOrEqual(10);
  const unopened = [
    ...onDisk.p.filter((pattern) => !HIS_PAGES.some((u) => matches(pattern, u))),
    ...onDisk.f.filter((pattern) => !HER_PAGES.some((u) => matches(pattern, u.split("?")[0]))),
    ...onDisk.onboard.filter((pattern) => !ONBOARD_PAGES.some((u) => matches(pattern, u))),
  ];
  expect(unopened, "account pages on disk that this spec does not open").toEqual([]);

  // ------------------------------------------------------------ the walks
  const opened: Record<string, number> = {};
  const walk = async (who: string, p: Person, pages: string[], lang: "zh-Hans" | "en") => {
    await setLang(p.context, base, lang);
    for (const url of pages) {
      const r = await look(watch, `${who} (${lang})`, p.page, url);
      opened[`${who} ${lang}`] = (opened[`${who} ${lang}`] ?? 0) + 1;
      // a page that sends an account to the login, or shows the server's error page, was not looked at
      expect(r.pathname, `${who} ${url}`).not.toBe("/login");
      expect(r.status, `${who} ${url}`).toBeLessThan(500);
      // Today asks for his questions of the day (GET /api/ask/history) only once he opens the typing dock (the timeline
      // layout: 「打字」 in the strip above the tab bar; the old section asked on every load). Opened here as he would,
      // so that answer is still looked at
      if (url === "/p/today" && r.pathname === "/p/today") {
        const history = p.page.waitForResponse((res) => new URL(res.url()).pathname === "/api/ask/history", { timeout: 15_000 });
        await p.page.getByTestId("say-type").click();
        await history;
        await p.page.waitForTimeout(350);
        await watch.page(p.page, `${who} (${lang})`, "/p/today (typing)");
      }
    }
  };
  for (const lang of ["zh-Hans", "en"] as const) {
    await walk("him", him, HIS_PAGES, lang);
    await walk("her", her, HER_PAGES, lang);
    await walk("blank", blank, ONBOARD_PAGES, lang);
  }
  // the blank account's own pages, empty: the same list without the rows it does not have
  const BLANK_PAGES = HIS_PAGES.filter((u) => !/^\/p\/(family|meds|questions)\/[^/]+(\/edit|\/seen|\/stop)?$/.test(u) || /\/(invite|add|answered|skipped)$/.test(u)).filter((u) => !/^\/p\/visit\/.+\/review$/.test(u) && u !== "/p/me/example");
  const done = await blank.context.request.post("/api/dev/accounts", { data: { login: `g${randomUUID().replace(/-/g, "").slice(0, 11)}`, password: PASSWORD, space: "blank", display_name: "林先生", locale: "zh-Hans" } });
  expect(done.status(), await done.text()).toBe(201);
  watch.addId("the second blank account's scope id", ((await done.json()) as { user_id: string }).user_id);
  for (const lang of ["zh-Hans", "en"] as const) await walk("blank, set up", blank, BLANK_PAGES, lang);

  // ------------------------------------------------------------ the streams (H4) and the demo's session row (H5)
  await him.page.goto("/p/today");
  const his = await watch.streamStart(him.page, "him");
  // the stream's first lines: the reconnect delay and the comment line, with no id (the demo's line named the session)
  expect.soft(his.slice(0, 60)).toMatch(/^(?:retry: \d+\n)?: connected\n\n/);
  await her.page.goto(`/f?link=${linkId}`);
  const hers = await watch.streamStart(her.page, "her", `?link=${linkId}`);
  expect.soft(hers.slice(0, 60)).toMatch(/^(?:retry: \d+\n)?: connected\n\n/);
  for (const [who, p] of [["him", him], ["her", her], ["blank", blank]] as [string, Person][]) {
    const row = await p.context.request.get("/api/session");
    expect.soft([who, row.status()]).toEqual([who, 404]);
    await watch.api(who, row);
  }
  // no account browser carries the demo's cookies
  for (const p of [him, her, blank]) expect.soft((await p.context.cookies()).filter((c) => ["rp_session", "rp_member", "rp_role", "rp_view"].includes(c.name))).toEqual([]);

  await watch.settle();
  // ------------------------------------------------------------ what was looked at, and what was found
  expect(opened).toEqual({
    "him zh-Hans": HIS_PAGES.length,
    "him en": HIS_PAGES.length,
    "her zh-Hans": HER_PAGES.length,
    "her en": HER_PAGES.length,
    "blank zh-Hans": ONBOARD_PAGES.length,
    "blank en": ONBOARD_PAGES.length,
    "blank, set up zh-Hans": BLANK_PAGES.length,
    "blank, set up en": BLANK_PAGES.length,
  });
  expect(watch.seen.pages).toBeGreaterThan(200);
  expect(watch.seen.documents).toBeGreaterThan(150);
  expect(watch.seen.api).toBeGreaterThan(30);
  expect(watch.seen.chars).toBeGreaterThan(2_000_000);
  expect.soft(watch.unusedAllowances()).toEqual([]);
  expect(watch.report()).toEqual([]);
  for (const p of [him, her, blank]) await p.context.close();
});

/**
 * The example account's sample label (real-app 4.6; found by the example account's whole-line journey, real-app 8.12
 * step 5, web/progress/g.md). The sample label photos are fixed pictures with the template's own printed dates
 * (losartan: 5 Oct 2026, the story's day 42). The example's seeded labels are moved to the account's dates (4.2:
 * dispensed = d0 + 8), and since track F's fix round so is the date read from a sample picture (lib/meds/sample-label.ts:
 * the same shift as the rest of the example), so on an account whose today is any other day the label's date line is
 * a day of his own: here the day the example was laid out for, the spec's clock day, 15 Mar 2027.
 * (Until that fix this test was marked as expected to fail: the screen showed 「2026年10月5日」.)
 */
test("the example's sample label carries the account's own date, not the template's", async ({ browser }) => {
  test.setTimeout(120_000);
  const watch = new LeakWatch({ storyDates: true });
  const him = await newPerson(browser, "example", "示例");
  watch.attach(him.context, "him");
  watch.addId("his user id (his scope id)", him.userId);
  const page = him.page;
  await page.goto("/p/meds/add");
  await page.getByTestId("add-origin-prescription").click();
  await page.getByTestId("add-how-photo").click();
  await expect(page.getByTestId("add-photo")).toBeVisible();
  await page.getByTestId("add-sample-losartan").click();
  const check = page.getByTestId("add-check");
  const value = page.getByTestId("add-check-value");
  await expect(check).toBeVisible({ timeout: 30_000 });
  // he says 「对」 line by line until the date line is the one on the screen
  for (let i = 0; i < 8 && (await value.getAttribute("data-field")) !== "dispensed"; i++) {
    const index = await check.getAttribute("data-index");
    await page.getByTestId("add-line-right").click();
    await expect(check).not.toHaveAttribute("data-index", index ?? "");
  }
  await expect(value).toHaveAttribute("data-field", "dispensed");
  // the account's own today is 15 Mar 2027 (the spec's clock): the day of the sample visit that prescribes it
  await expect(value).toContainText("3月15日");
  await expect(value).not.toContainText("10月5日");
  await watch.page(page, "him");
  // (the watch's own settle() can wait for ever on the body of a router prefetch the page cut short: at most 10 s here;
  // the screen itself was looked at just above)
  await Promise.race([watch.settle(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  expect(watch.seen.pages).toBe(1);
  // nothing else leaks on this screen: whatever the watch found is a date of the story
  expect(watch.hits.filter((h) => !/^story date/.test(h.rule))).toEqual([]);

  expect(watch.report()).toEqual([]);
  await him.context.close();
});
