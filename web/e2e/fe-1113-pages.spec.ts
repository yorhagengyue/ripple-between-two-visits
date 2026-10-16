/**
 * Design groups 11 「预防」 and 13 「饮食」 after the timeline draft (web/progress/fe-1113.md): the page checks
 * (e2e/_checks/page-checks.ts: no sideways scroll at 360px, no text under 18px, no target under 48x48, no contrast
 * violation) on every state of the two screens, the dishes' screen and Today's entry that e2e/k-pages.spec.ts does not
 * reach, and what the new layout does on a tap:
 *
 *   prevention     the header (the way back to 「我」, no language switch), each line on the node of its source (the
 *                  doctor's ring, the written source's square), the table's line in the serif face with 「出处：…」 and
 *                  the pill under it; the tables' last word with its node at its first row; 「加进问题单，问医生」 turns
 *                  into the tinted box with the way to the list; while a tap is on its way only that entry waits; a tap
 *                  that does not reach the server says so inside that entry; 「我做过了」 moves the line under
 *                  「已经做了的」 with the tick and the undo strip; no age yet (the link names 「我的档案」 as that screen
 *                  names itself); nothing listed for his age
 *   diet           the doctor's line on the doctor's node, the day's question on the same line (the node that is "now",
 *                  his own node once he answered: never a tick), 「改一下」; the official lines and the leaflet's line
 *                  in the serif face; 「问医生」 goes to 「加一个问题」; a new account (no doctor's line, nothing listed)
 *   his dishes     a screen of its own (/p/diet?view=foods) with its way back to the diet screen: a chip picks and
 *                  unpicks, each picked dish gets its section; a tap that does not reach the server says so; while a
 *                  special diet comes first that address shows the diet screen
 *   Today          the entry: its head line names the doctor's line the question is taken from, the three answers
 *                  stand in one row (华语), the answer is only noted
 *
 * Runs against a server with the developer tools on (accounts through POST /api/dev/accounts): `next dev`, or a
 * production build started with scripts/record/serve.mjs. PW_PORT names it. Each test signs a fresh browser in to a new
 * account and opens nothing else first, so it does not depend on what ran before on the same server.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";

test.use({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

const PASSWORD = "a long test password";

async function account(page: Page, space: "example" | "blank") {
  const r = await page.request.post("/api/dev/accounts", { data: { login: `p${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, space } });
  expect(r.status(), await r.text()).toBe(201);
}

async function fact(page: Page, kind: string, text: string) {
  expect((await page.request.post("/api/profile/facts", { data: { kind, text } })).status()).toBe(201);
}

const checks = (page: Page, scope?: string) => expectPageChecks(page, { side: "elder", ...(scope ? { scope } : {}) });
const serif = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);

for (const locale of ["zh-Hans", "en"] as const) {
  const zh = locale === "zh-Hans";
  test.describe(`design groups 11 and 13 (${locale})`, () => {
    test.beforeEach(async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: "rp_lang", value: locale, url: baseURL! }]);
    });

    test(`prevention: the sources' nodes, 「加进问题单」, a refused tap, 「我做过了」 (${locale})`, async ({ page }) => {
      await account(page, "example");
      await page.goto("/p/prevent");
      const row = (id: string) => page.locator(`[data-testid="prevent-row"][data-item="${id}"]`);
      await expect(row("C1-03")).toBeVisible();

      // the header: the way back to 「我」 (where the app comes from), the screen's name and its grey line, no language switch
      await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/me");
      await expect(page.locator('[data-rp="back"]')).toHaveText(zh ? "我" : "Me");
      await expect(page.locator('[data-rp="page-title"]')).toHaveText(zh ? "预防" : "Prevention");
      await expect(page.locator('[data-rp="meta-story"]')).toHaveText(zh ? "筛查和疫苗" : "Screenings and vaccines");
      await expect(page.locator('[data-kind="lang"]')).toHaveCount(0);

      // the doctor's own words on the doctor's node, word for word in the serif face; who and when on the head line
      const doctor = page.locator('[data-testid="prevent-row"][data-kind="doctor"]');
      await expect(doctor).toHaveAttribute("data-node", "doc");
      await expect(doctor.locator('[data-rp="source-tag"]')).toContainText(zh ? "医生说" : "Doctor said");
      expect(await serif(page, '[data-testid="prevent-row"][data-kind="doctor"] [data-rp="said"]')).toMatch(/serif/i);
      await expect(doctor.getByTestId("prevent-doctor-translation")).toHaveCount(zh ? 1 : 0);
      await expect(doctor.getByTestId("prevent-ask")).toHaveCount(0);

      // a line of the tables on the node of a written source: its name, the line in the serif face, where it is from, the pill
      const flu = row("C2-03");
      await expect(flu).toHaveAttribute("data-node", "lab");
      expect(await serif(page, '[data-item="C2-03"] [data-rp="table-line"]')).toMatch(/serif/i);
      await expect(flu.getByTestId("prevent-source")).toContainText(zh ? "出处：" : "Source:");
      await expect(flu.getByTestId("prevent-source").locator('[data-rp="play-pill"]')).toHaveAttribute("href", /^https:\/\//);
      // cardiovascular screening after the diagnosis: the tag, the table's line, the doctor's words in a card, no buttons
      const cardio = row("C1-03");
      await expect(cardio.getByTestId("prevent-followed").locator('[data-rp="tag"]')).toHaveText(zh ? "由你的医生跟进" : "Followed by your doctor");
      await expect(cardio.locator('[data-rp="sub-card"] [data-rp="said"]')).toContainText("Your blood pressure is high");
      await expect(cardio.locator("button")).toHaveCount(0);
      // the tables' last word has no name of its own: its entry opens with the line itself, and the node stands at the
      // middle of that line's first row (not above it)
      const apart = await page.getByTestId("prevent-caveat").evaluate((el) => {
        const node = el.querySelector(".rpu-node")!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('[data-rp="table-line"]')!);
        const first = range.getClientRects()[0];
        return Math.abs((node.top + node.bottom) / 2 - (first.top + first.bottom) / 2);
      });
      expect(apart).toBeLessThanOrEqual(3);
      await checks(page);

      // 「加进问题单，问医生」: the button goes, the tinted box says where the question is and leads to the list
      await flu.getByTestId("prevent-ask").click();
      const asked = flu.getByTestId("prevent-asked");
      await expect(asked).toContainText(zh ? "已在下次看诊的问题单里" : "In the questions for your next visit");
      await expect(asked.getByRole("link")).toHaveAttribute("href", "/p/questions");
      await expect(flu.getByTestId("prevent-ask")).toHaveCount(0);
      await expect(flu.getByTestId("prevent-done-btn")).toBeVisible();

      // while a tap is on its way only the entry he tapped waits (its other button greyed); the other entries keep
      // their buttons as they are. Then the tap does not reach the server: the red box inside that entry, nothing moved
      let letGo: () => void = () => undefined;
      const held = new Promise<void>((r) => (letGo = r));
      await page.route("**/api/prevent*", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await held;
        await route.abort();
      });
      await row("C2-04").getByTestId("prevent-done-btn").click();
      await expect(row("C2-04").getByTestId("prevent-done-btn")).toHaveAttribute("aria-busy", "true");
      await expect(row("C2-04").getByTestId("prevent-ask")).toBeDisabled();
      await expect(row("C2-06").getByTestId("prevent-done-btn")).toBeEnabled();
      await expect(row("C2-06").getByTestId("prevent-ask")).toBeEnabled();
      letGo();
      await expect(row("C2-04").getByTestId("prevent-error")).toContainText(zh ? "没有记下，再点一次。" : "Not saved. Tap again.");
      await expect(page.getByTestId("prevent-error")).toHaveCount(1);
      await expect(row("C2-04")).toHaveAttribute("data-state", "listed");
      await checks(page);
      await page.unrouteAll({ behavior: "wait" });

      // 「我做过了」: the line moves under 「已经做了的」 with the tick and the day; the undo strip is up; 「撤销」 puts it back
      await row("C2-04").getByTestId("prevent-done-btn").click();
      const done = page.locator('[data-testid="prevent-done"][data-item="C2-04"]');
      await expect(done).toHaveAttribute("data-node", "ok");
      await expect(done.getByTestId("prevent-undo-btn")).toBeVisible();
      await expect(row("C2-04")).toHaveCount(0);
      await expect(page.getByTestId("prevent-error")).toHaveCount(0);
      const strip = page.getByTestId("undo-toast").locator('[data-rp="toast"]');
      await expect(strip).toBeVisible();
      await checks(page);
      await strip.getByRole("button").click();
      await expect(row("C2-04")).toHaveAttribute("data-state", "listed");
      await expect(done).toHaveCount(0);
    });

    test(`prevention on a new account: no age yet, then an age the tables list nothing for (${locale})`, async ({ page }) => {
      await account(page, "blank");
      await page.goto("/p/prevent");
      await expect(page.getByTestId("prevent-noage").getByRole("link")).toHaveAttribute("href", "/p/profile");
      // the link names the screen it leads to as that screen names itself
      await expect(page.getByTestId("prevent-noage").getByRole("link")).toContainText(zh ? "我的档案" : "My details");
      await expect(page.getByTestId("prevent-nodoctor")).toHaveAttribute("data-node", "miss");
      await expect(page.getByTestId("prevent-notable")).toHaveCount(0);
      await expect(page.getByTestId("prevent-caveat")).toBeVisible();
      await fact(page, "age", "12");
      await page.goto("/p/prevent");
      await expect(page.getByTestId("prevent-notable")).toHaveAttribute("data-node", "miss");
      await expect(page.getByTestId("prevent-noage")).toHaveCount(0);
      await expect(page.getByTestId("prevent-row")).toHaveCount(0);
      await checks(page);
    });

    test(`diet: the doctor's line and the day's question on one line, the answer on his own node (${locale})`, async ({ page }) => {
      await account(page, "example");
      await page.goto("/p/diet");
      const check = page.getByTestId("diet-check");
      await expect(check).toHaveAttribute("data-today", "none");
      await expect(page.getByTestId("page-diet")).toHaveAttribute("data-view", "diet");
      await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/me");
      await expect(page.locator('[data-rp="page-title"]')).toHaveText(zh ? "饮食" : "Food");
      await expect(page.locator('[data-kind="lang"]')).toHaveCount(0);

      // the doctor's line on the doctor's node; the question is the next entry of the same line, on the node that is "now"
      const doctor = check.getByTestId("diet-doctor");
      await expect(doctor).toHaveAttribute("data-node", "doc");
      await expect(doctor.locator('[data-rp="source-tag"]')).toContainText(zh ? "医生说" : "Doctor said");
      expect(await serif(page, '[data-testid="diet-doctor"] [data-rp="said"]')).toMatch(/serif/i);
      await expect(doctor.getByTestId("diet-doctor-translation")).toHaveCount(zh ? 1 : 0);
      const entries = check.locator('[data-rp="tl-item"]');
      await expect(entries).toHaveCount(2);
      await expect(entries.nth(1)).toHaveAttribute("data-node", "now");
      await expect(check.getByTestId("diet-answer")).toHaveCount(3);
      // the knowledge base's lines and the leaflet's line: written sources, in the serif face, each with its pill
      const line = page.getByTestId("diet-line").first();
      await expect(line).toHaveAttribute("data-node", "lab");
      expect(await serif(page, '[data-testid="diet-line"] [data-rp="official-line"]')).toMatch(/serif/i);
      await expect(line.locator('[data-rp="play-pill"]')).toHaveAttribute("href", /^https:\/\/(?:www\.)?healthhub\.sg\//);
      expect(await serif(page, '[data-testid="diet-grapefruit"] [data-rp="leaflet-line"]')).toMatch(/serif/i);
      // 「问医生」 under the referral: the way to add a question in his own words (the list has no dietitian)
      const askDoctor = page.getByTestId("diet-special").getByTestId("diet-ask-doctor");
      await expect(askDoctor).toHaveAttribute("href", "/p/questions/add");
      await expect(askDoctor).toHaveText(zh ? "问医生" : "Ask the doctor");

      // a tap that does not reach the server: the red box under the answers, nothing noted
      await page.route("**/api/diet/check", (route) => route.abort());
      await check.locator('[data-testid="diet-answer"][data-answer="yes"]').click();
      await expect(page.getByTestId("diet-check-error")).toContainText(zh ? "没有记下，再点一次。" : "Not saved. Tap again.");
      await expect(check).toHaveAttribute("data-today", "none");
      await checks(page);
      await page.unrouteAll({ behavior: "wait" });

      // his answer: noted on his own node (never a tick), the week's count follows; 「改一下」 asks again
      await check.locator('[data-testid="diet-answer"][data-answer="no"]').click();
      const answered = check.getByTestId("diet-answered");
      await expect(answered).toHaveAttribute("data-node", "me");
      await expect(answered).toContainText(zh ? "已记下：没有" : "Noted: No");
      await expect(page.getByTestId("diet-check-error")).toHaveCount(0);
      await expect(page.getByTestId("diet-week")).toHaveAttribute("data-node", "dot");
      await checks(page);
      await answered.getByTestId("diet-change").click();
      await expect(check.getByTestId("diet-answer")).toHaveCount(3);
      await check.locator('[data-testid="diet-answer"][data-answer="unsure"]').click();
      await expect(check).toHaveAttribute("data-today", "unsure");
    });

    test(`his dishes: a screen of its own, a chip picks and unpicks, a refused tap (${locale})`, async ({ page }) => {
      await account(page, "example");
      await page.goto("/p/diet");
      await page.getByTestId("diet-foods-open").click();
      await page.waitForURL(/\/p\/diet\?view=foods$/);
      await expect(page.getByTestId("page-diet")).toHaveAttribute("data-view", "foods");
      await expect(page.locator('[data-rp="back"]')).toHaveAttribute("href", "/p/diet");
      await expect(page.locator('[data-rp="back"]')).toHaveText(zh ? "饮食" : "Food");
      await expect(page.locator('[data-rp="page-title"]')).toHaveText(zh ? "我常吃的" : "What I often eat");
      const food = (id: string) => page.locator(`[data-testid="diet-food"][data-food="${id}"]`);
      const picked = page.getByTestId("diet-picked");
      await expect(picked).toHaveCount(0);
      await checks(page);

      await food("chicken_rice").click();
      await expect(food("chicken_rice")).toHaveAttribute("aria-pressed", "true");
      await expect(picked).toHaveCount(1);
      await expect(picked.first().getByTestId("diet-line").first()).toHaveAttribute("data-node", "lab");
      // a tap that does not reach the server: the red box, the chip stays as it was
      await page.route("**/api/diet/foods", (route) => route.abort());
      await food("laksa").click();
      await expect(page.getByTestId("diet-error")).toContainText(zh ? "没有记下，再点一次。" : "Not saved. Tap again.");
      await expect(food("laksa")).toHaveAttribute("aria-pressed", "false");
      await checks(page);
      await page.unrouteAll({ behavior: "wait" });
      // a second tap on a picked one takes it off again
      await food("chicken_rice").click();
      await expect(food("chicken_rice")).toHaveAttribute("aria-pressed", "false");
      await expect(picked).toHaveCount(0);
      await expect(page.getByTestId("diet-error")).toHaveCount(0);
      // the way back
      await page.locator('[data-rp="back"]').click();
      await page.waitForURL(/\/p\/diet$/);
      await expect(page.getByTestId("diet-screen")).toBeVisible();
    });

    test(`diet on a new account: nothing yet; a special diet first (${locale})`, async ({ page }) => {
      await account(page, "blank");
      await page.goto("/p/diet");
      await expect(page.getByTestId("diet-nodoctor")).toHaveAttribute("data-node", "miss");
      await expect(page.getByTestId("diet-check")).toHaveCount(0);
      await expect(page.getByTestId("diet-nocondition")).toHaveAttribute("data-variant", "dash");
      await expect(page.getByTestId("diet-special")).toHaveAttribute("data-first", "false");
      await checks(page);
      // kidney disease recorded: the referral first; his dishes' address shows the diet screen, with no way to the dishes
      for (const text of ["高血压", "肾病"]) await fact(page, "condition", text);
      await page.goto("/p/diet?view=foods");
      await expect(page.getByTestId("page-diet")).toHaveAttribute("data-view", "diet");
      await expect(page.locator('[data-testid="diet-special"][data-first="true"] [data-rp="box"]')).toHaveAttribute("data-variant", "acc");
      await expect(page.getByTestId("diet-foods-open")).toHaveCount(0);
      await expect(page.getByTestId("diet-condition")).toHaveCount(0);
    });

    test(`Today's entry: where the question is taken from, three answers in a row, only noted (${locale})`, async ({ page }) => {
      await account(page, "example");
      // the morning's medicine answered, so Today shows the day's overview whatever the hour is
      const { groups } = (await (await page.request.get("/api/meds")).json()) as { groups: { items: { id: string; slots: string[] }[] }[] };
      for (const m of groups.flatMap((g) => g.items).filter((x) => x.slots.includes("morning"))) {
        expect((await page.request.post("/api/doses", { data: { medication_id: m.id, slot: "morning", state: "taken" } })).status()).toBeLessThan(300);
      }
      await page.goto("/p/today");
      const cell = page.getByTestId("today-diet");
      test.skip((await cell.count()) === 0, "Today is not on its overview at this hour of the server's clock (another slot needs him)");
      const check = cell.getByTestId("diet-check");
      await expect(check).toHaveAttribute("data-today", "none");
      // the head line: what the entry is, and the doctor's line the question is taken from (its date and time point)
      const head = check.getByTestId("diet-doctor");
      await expect(head).toHaveAttribute("data-source", "v1:v1-u07");
      await expect(head).toContainText(zh ? "饮食 · 每天一问 · 取自医生的话 · " : "Food · today's question · from your doctor's words · ");
      await expect(head).toContainText("· 0:42");
      await expect(check.locator('[data-rp="said"]')).toHaveCount(0);
      const answers = check.getByTestId("diet-answer");
      await expect(answers).toHaveCount(3);
      const tops = await answers.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      // 华语: one row of three; English: the long third answer has a row of its own
      expect(new Set(tops).size).toBe(zh ? 1 : 2);
      await checks(page, '[data-testid="today-diet"]');

      await check.locator('[data-testid="diet-answer"][data-answer="no"]').click();
      const answered = check.getByTestId("diet-answered");
      await expect(answered).toContainText(zh ? "已记下：没有" : "Noted: No");
      await expect(answered.getByRole("link")).toHaveAttribute("href", "/p/diet");
      await expect(answered.getByTestId("diet-change")).toBeVisible();
      await checks(page, '[data-testid="today-diet"]');
    });
  });
}
