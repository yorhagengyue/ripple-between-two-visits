/**
 * M6: her reminder on a phone whose browser refuses to play sound without a tap (real-device autoplay policy).
 *
 * The other M6 specs launch Chromium with --autoplay-policy=no-user-gesture-required. Here the page gets the rule
 * real phones apply: play() is refused with NotAllowedError until the person has tapped the page. Headless Chromium
 * does not apply that rule even with --autoplay-policy=document-user-activation-required (measured 10-09: the clip
 * played by itself), so an init script puts the rule on HTMLMediaElement.prototype.play: refused until a trusted
 * pointer or key event has reached the page (navigator.userActivation cannot be used here: Playwright's
 * page.evaluate runs with a user gesture and marks the page active). At the reminder time his phone tries
 * to play Wei Ling's clip by itself, is refused, and the strip stays with her words, the label 女儿的录音 and a
 * play button; one tap plays HER clip. This file records what the app does today. A visible "tap to hear it" hint
 * when the browser refuses belongs in components/daily/ClipPlay.tsx (listed for its owner in web/PROGRESS.md);
 * a reminder that reaches a locked phone is item 9 (Web Push).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { api, BASE_URL, closeAll, createSession, textBelow, waitLive, CREW_HEADERS } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

/** The phone's rule: no sound before the first tap on the page. */
function refuseAutoplayUntilTapped() {
  const play = HTMLMediaElement.prototype.play;
  let tapped = false;
  for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
    window.addEventListener(type, (e) => {
      if (e.isTrusted) tapped = true;
    }, { capture: true });
  }
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    if (!tapped) {
      return Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", "NotAllowedError"));
    }
    return play.call(this);
  };
}

const HER_WORDS = "爸，吃药了没有？";
let sessionToReset: string | null = null;

// pass or fail, the session goes back to the seed, which deletes the test recording from storage
test.afterEach(async ({ request }) => {
  if (sessionToReset) await request.post(`/api/session/reset?session=${sessionToReset}`, { data: {} });
  sessionToReset = null;
});

test("autoplay refused: the strip keeps her clip, 女儿的录音 and a play button; one tap plays her recording", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 42, story_time: "08:00" }); // D42: no answer in the seed yet
  sessionToReset = s.id;
  // her recording, stored the way /f stores it (signed upload, then POST /api/reminders)
  const link = (await api(request, "/api/upload-url", s.id, { kind: "reminder", content_type: "audio/wav" })) as { path: string; url: string; method: string; headers: Record<string, string> };
  const wav = readFileSync(path.join(__dirname, "..", "lib", "daily", "assets", "wei-ling-reminder.standin.wav"));
  const put = await request.fetch(link.url, { method: link.method, headers: link.headers, data: wav });
  expect(put.status()).toBe(200);
  const clip = ((await api(request, "/api/reminders", s.id, { audio_path: link.path, text: HER_WORDS })) as { clip: { id: string } }).clip;

  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addInitScript(refuseAutoplayUntilTapped);
  await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
  const page = await context.newPage();
  await page.goto("/p/bp");
  await waitLive(page);
  const phone = { context, page };
  await api(request, "/api/clock", s.id, { day: 42, time: "08:45" });
  const strip = page.getByTestId("reminder-strip");
  await expect(strip).toHaveAttribute("data-reminder", "1", { timeout: 5000 });
  await expect(strip).toHaveAttribute("data-clip", clip.id);
  await expect(strip.getByTestId("reminder-clip-source")).toHaveText("女儿的录音");
  await expect(strip).toContainText(HER_WORDS);

  const plays = () =>
    page.evaluate(() => (window.__rpDailyClipPlays ?? []).filter((p) => p.url.includes("/api/reminders/")).map((p) => ({ url: p.url, auto: p.auto, playing: p.playing, blocked: p.blocked ?? false })));
  // the phone tried by itself and the browser said no
  await expect.poll(plays, { timeout: 10_000 }).toContainEqual({ url: expect.stringContaining(clip.id), auto: true, playing: false, blocked: true });
  const button = strip.getByTestId("reminder-clip-play");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("data-playing", "false");
  await expect(button).toHaveAttribute("data-stand-in", "0");
  expect(await textBelow(page, 18)).toEqual([]);

  // one tap: her recording plays
  await button.click();
  await expect.poll(plays, { timeout: 10_000 }).toContainEqual({ url: expect.stringContaining(clip.id), auto: false, playing: true, blocked: false });
  await expect(button).toHaveAttribute("data-playing", "true");
  await closeAll([phone]);
});
