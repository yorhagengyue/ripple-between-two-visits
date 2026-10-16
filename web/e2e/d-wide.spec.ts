/**
 * Wei Ling's screens in a wide window (the fe-d track; a judge opens the site on a computer, 1440x900). Her own CSS
 * (app/ripple-ui.css Part B) keeps every screen one column in the middle of the window, 430 wide at the default text
 * size, on her dark ground outside it (`.rpf-screen`, `--rpf-page`). Nothing of hers is fixed across the whole window:
 * the bottom sheet and the dimmed area behind it stay inside the column, and the buttons at the bottom of a screen are
 * in the column's own flow.
 *
 * Measured on her home (no reply), the no-reply screen with its bottom sheet (D4), and the recorder (idle, recording).
 * With FE_D_SHOTS_DIR set, a picture of each is written there (wide-*.png).
 *
 * Needs a server with the developer tools on (the test clock, dev accounts).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clearClock, linkFamily, newAccount, setClock, setSwitches, tick } from "./journeys/_d/family";

const DIR = process.env.FE_D_SHOTS_DIR?.trim() || null;
const STAND_IN = path.resolve(process.cwd(), "lib", "daily", "assets", "wei-ling-reminder.standin.wav");
const DAY = "2026-10-17";
const at = (hhmm: string) => `${DAY}T${hhmm}:00+08:00`;
const WIDE = { width: 1440, height: 900 };
const COLUMN = 430;

// her phone can record: the fake microphone plays the stand-in sentence
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${STAND_IN}`] },
});
test.afterEach(async ({ request }) => {
  await clearClock(request);
});

interface Measured {
  window: number;
  column: { left: number; right: number; width: number } | null;
  ground: string;
  sideways: number;
  /** every visible element that is fixed to the window (the framework's own developer overlay left out) */
  fixed: { what: string; left: number; right: number }[];
}

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    const screen = document.querySelector(".rpf-screen");
    const fixed: { what: string; left: number; right: number }[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el.closest("nextjs-portal") || el.tagName.toLowerCase() === "nextjs-portal") continue;
      // the note beside the column (line fe-desk, components/desktop/DeskNote.tsx) stands on the ground outside it by
      // design in every wide window: it belongs to the app's frame, not to a screen of hers
      if (el.closest('[data-testid="desk-note"]')) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      fixed.push({ what: `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(" ").filter(Boolean).join(".")}`, left: r.left, right: r.right });
    }
    return {
      window: document.documentElement.clientWidth,
      column: screen ? box(screen) : null,
      ground: getComputedStyle(document.body).backgroundColor,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      fixed,
    };
  });
}

/** The column is 430 wide and in the middle; the ground outside it is hers; nothing fixed leaves the column. */
async function expectColumn(page: Page, name: string, opts: { fixed: number }): Promise<void> {
  const m = await measure(page);
  expect(m.column, `${name}: her screen's root`).not.toBeNull();
  const c = m.column!;
  expect(Math.abs(c.width - COLUMN), `${name}: the column is ${c.width} wide`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(c.left - (m.window - COLUMN) / 2), `${name}: the column starts at ${c.left} in a window of ${m.window}`).toBeLessThanOrEqual(1);
  // --rpf-page (#05070A), not his light paper
  expect(m.ground, `${name}: the ground outside the column`).toBe("rgb(5, 7, 10)");
  expect(m.sideways, `${name}: sideways scroll`).toBeLessThanOrEqual(0);
  // counted: her own fixed things (.rpf-*: the sheet and the dimmed area behind it). What the app's frame puts on every
  // phone page (a mark at the top of the column while the next page loads) is not hers to count; like everything fixed,
  // it has to stay inside the column
  const hers = m.fixed.filter((f) => f.what.includes(".rpf-"));
  expect(hers.length, `${name}: her fixed elements, of ${JSON.stringify(m.fixed)}`).toBe(opts.fixed);
  for (const f of m.fixed) {
    expect(f.left, `${name}: ${f.what} starts left of the column`).toBeGreaterThanOrEqual(c.left - 0.5);
    expect(f.right, `${name}: ${f.what} ends right of the column`).toBeLessThanOrEqual(c.right + 0.5);
  }
  if (DIR) {
    mkdirSync(DIR, { recursive: true });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
    await page.screenshot({ path: path.join(DIR, `wide-${name}.png`), animations: "disabled" });
  }
}

/** A button of hers lies inside the column. */
async function expectInside(page: Page, testId: string): Promise<void> {
  const column = (await page.locator(".rpf-screen").boundingBox())!;
  const b = (await page.getByTestId(testId).boundingBox())!;
  expect(b.x, `${testId} starts left of the column`).toBeGreaterThanOrEqual(column.x - 0.5);
  expect(b.x + b.width, `${testId} ends right of the column`).toBeLessThanOrEqual(column.x + column.width + 0.5);
}

test("a wide window: her home, the no-reply screen with its sheet and the recorder stay one column of 430 in the middle", async ({ browser, baseURL, request }) => {
  test.setTimeout(180_000);
  await setClock(request, at("07:30"));
  const mk = async () => {
    const c = await browser.newContext({ viewport: WIDE, locale: "zh-CN", timezoneId: "Asia/Singapore" });
    await c.addCookies([{ name: "rp_lang", value: "zh-Hans", url: baseURL! }]);
    return c;
  };
  const him = await mk();
  const her = await mk();
  // the microphone is already allowed on her phone: the record key starts a take at once
  await her.grantPermissions(["microphone"]);
  try {
    await newAccount(him, { space: "example", displayName: "陈先生", prefix: "wh" });
    await newAccount(her, { space: "none", displayName: "Wei Ling", prefix: "ww" });
    const linkId = await linkFamily(him, her);
    await setSwitches(him, linkId, { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true });
    const q = `link=${encodeURIComponent(linkId)}`;
    const dp = await her.newPage();
    // her first-visit steps are done on this phone; no number saved, so 「打电话给爸爸」 opens the sheet
    await dp.goto(`/f?${q}`);
    await dp.evaluate((id) => localStorage.setItem(`rp_f_welcomed_${id}`, "1"), linkId);

    // a morning nobody answers: 8:45, 9:15, closed at 9:45
    for (const t of ["08:45", "09:15", "09:45"]) {
      await setClock(request, at(t));
      await tick(request);
    }
    await setClock(request, at("09:50"));
    await dp.goto(`/f?${q}`);
    await expect(dp.getByTestId("family-app")).toHaveAttribute("data-live", "open");
    await expect(dp.getByTestId("home-no-reply")).toBeVisible();
    await expectColumn(dp, "home", { fixed: 0 });
    await expectInside(dp, "call-dad");
    await expectInside(dp, "record-new");

    // the no-reply screen, then its bottom sheet: the sheet and the dimmed area behind it are the only fixed things
    await dp.goto(`/f/alert?${q}`);
    await expect(dp.getByTestId("family-alert")).toHaveAttribute("data-state", "no_reply");
    await expectColumn(dp, "alert", { fixed: 0 });
    await expectInside(dp, "call-dad");
    await dp.getByTestId("call-dad").click();
    await expect(dp.getByTestId("phone-sheet")).toBeVisible();
    await expectColumn(dp, "alert-sheet", { fixed: 2 });
    await dp.getByTestId("phone-sheet-later").click();
    await expect(dp.getByTestId("phone-sheet")).toHaveCount(0);

    // the recorder: the record key, and while recording the two buttons at the bottom
    await dp.goto(`/f/reminder?${q}`);
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "idle");
    await expectColumn(dp, "recorder", { fixed: 0 });
    await expectInside(dp, "rec-start");
    await dp.getByTestId("rec-start").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "recording", { timeout: 15_000 });
    await expectColumn(dp, "recording", { fixed: 0 });
    await expectInside(dp, "rec-stop");
    await expectInside(dp, "rec-cancel");
    await dp.getByTestId("rec-cancel").click();
    await expect(dp.getByTestId("reminder-studio")).toHaveAttribute("data-state", "idle");
  } finally {
    await him.close();
    await her.close();
  }
});
