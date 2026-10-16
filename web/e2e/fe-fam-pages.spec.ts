/**
 * His family screens as the timeline draft's 16-20 (front-end line fe-fam; web/progress/fe-fam.md): one walk through
 * every state (e2e/fe-fam-walk.ts: nobody yet, the invitation and a missing name, the link and its steps, her
 * acceptance arriving on his open screen, 「是她吗？」 on 「家人」 and on Today, her switches off and on, a change that
 * fails, her latest look, the list of her looks and of the switches' changes, the stop screen and what comes after, an
 * invitation waiting, taken back, run out, 「不是」, her leaving, the list with everyone on it, five invitations
 * waiting), in 华语 and in English. At each state the page checks (e2e/_checks/page-checks.ts): no sideways scroll at
 * 360px, no text under 18px, no target under 48x48, no contrast violation.
 *
 * The walk asserts what each screen says and does; e2e/d-pages.spec.ts and the journeys 16, 17 and 20 pin the same
 * screens from her side. Runs against a server with the developer tools on (PW_PORT), like e2e/d-pages.spec.ts.
 */
import { expect, test } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { clearClock, walkHisFamily } from "./fe-fam-walk";

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.afterAll(async ({ request }) => {
  await clearClock(request);
});

for (const lang of ["zh-Hans", "en"] as const) {
  test(`his family screens, every state, with the page checks (${lang})`, async ({ browser, request, baseURL }) => {
    const seen: string[] = [];
    await walkHisFamily(browser, request, baseURL!, {
      lang,
      at: async (page, id) => {
        seen.push(id);
        // these screens carry nothing fixed at the bottom of their own: the draft's 16-20 have no tab bar and no say bar
        if (id !== "18-1-today") await expect(page.locator('[data-rp="tabbar"]'), id).toHaveCount(0);
        await expectPageChecks(page, { side: "elder" });
      },
    });
    // the draft's seven screens and the states it did not draw
    expect(seen).toEqual([
      "list-none",
      "17-1",
      "17-1-name-missing",
      "17-2",
      "17-2-accepted",
      "18-1",
      "18-1-today",
      "16-1-all-off",
      "16-1-failed",
      "16-1",
      "19-1",
      "20-1",
      "20-2",
      "list-ended",
      "invited",
      "cancelled",
      "left",
      "declined",
      "expired",
      "list",
      "17-2-confirmed",
      "invite-full",
    ]);
  });
}
