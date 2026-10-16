/**
 * Binding by account on the pages (line bind; web/progress/bind.md): one walk through the three places in both
 * directions (e2e/bind-walk.ts: her form and its refusals, her home after the tap, the place of her recorder before and
 * after his answer; his card on Today, the row and her page under 「家人」, 「知道了」; his direct way on 「邀请家人」 and
 * its refusals, his switches with four on, the list of changes; 「不认识这个人，解除」 and her page saying so), in 华语
 * and in English. Round two rides on the same walk: nothing of his reminder before he has answered, the page of the
 * person he removed, her way back to the form and its refusal for the elder who removed her, the row under 「我的」.
 *
 * On every page this line changed the page checks run (e2e/_checks/page-checks.ts): no sideways scroll at 360px, no
 * text under the side's minimum (his 18px, hers 16px), no target under it (his 48x48, hers 44x44), no contrast
 * violation. And the three places are measured once more in a computer's window (1440x900): the page is the 430px
 * column in the middle (web/app/desktop.css) and nothing of it lies outside the column.
 *
 * The walk asserts what each screen says and does. Runs against a server with the developer tools on (PW_PORT), like
 * e2e/fe-fam-pages.spec.ts; FAMILY_BIND_MODE is left at its default there (confirm mode is pinned by the unit tests:
 * tests/unit/care/bind*.test.ts).
 */
import { expect, test, type Page } from "@playwright/test";
import { expectPageChecks } from "./_checks/page-checks";
import { clearClock, walkBinding, WALK_STATES } from "./bind-walk";

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.afterAll(async ({ request }) => {
  await clearClock(request);
});

/** The states that are pages this line changed (her home, her recorder and his plain Today are other lines' as they were). */
const CHECKED = new Set([
  "f-form",
  "f-form-not-found",
  "f-reminder-locked",
  "f-facts-locked",
  "today-bound",
  "family-list-bound",
  "link-bound",
  "invite-direct",
  "invite-direct-refused",
  "link-four-on",
  "seen-bound",
  "today-bound-stranger",
  "link-removed",
  // round two: her ended screen with its new button (as her home draws it, and as her page does), the form opened
  // again and its refusal, 「我的」 with the new row (her link over, and in force), the two pages whose sentence about
  // what she sees changed, and the invitation with its words open
  "f-removed",
  "f-bind-again",
  "f-bind-removed",
  "f-ended-plain",
  "f-me-ended",
  "f-me-bind",
  "access-lede",
  "invite-consent",
]);

/** The three places, each also measured in a computer's window. */
const WIDE = new Set(["f-form", "invite-direct", "today-bound"]);

/** In a 1440x900 window: the screen is one column of 430px in the middle, and nothing visible of it lies outside. */
async function expectPhoneColumn(page: Page, id: string): Promise<void> {
  const phone = page.viewportSize()!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  try {
    const m = await page.evaluate(() => {
      const root = document.querySelector(".rpu-screen, .rpf-screen");
      if (!root) return null;
      const box = root.getBoundingClientRect();
      const outside: string[] = [];
      for (const el of root.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1) outside.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/)[0]} ${Math.round(r.left)}-${Math.round(r.right)}`);
        if (outside.length >= 8) break;
      }
      return { left: box.left, width: box.width, window: window.innerWidth, scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, outside };
    });
    expect(m, id).not.toBeNull();
    expect(m!.width, `${id}: the column's width`).toBe(430);
    expect(Math.abs(m!.left + m!.width / 2 - m!.window / 2), `${id}: the column is in the middle`).toBeLessThanOrEqual(1);
    expect(m!.scroll, `${id}: no sideways scroll`).toBeLessThanOrEqual(0);
    expect(m!.outside, `${id}: nothing outside the column`).toEqual([]);
  } finally {
    await page.setViewportSize(phone);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

for (const lang of ["zh-Hans", "en"] as const) {
  test(`binding by account: the three places, both directions, with the page checks (${lang})`, async ({ browser, request, baseURL }) => {
    const seen: string[] = [];
    await walkBinding(browser, request, baseURL!, {
      lang,
      at: async (page, id, side) => {
        seen.push(id);
        if (CHECKED.has(id)) await expectPageChecks(page, { side });
        if (WIDE.has(id)) await expectPhoneColumn(page, id);
      },
    });
    expect(seen).toEqual([...WALK_STATES]);
  });
}
