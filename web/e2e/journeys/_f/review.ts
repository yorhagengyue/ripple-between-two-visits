/**
 * The review of a visit in track F's journeys (05 visit, 06 prescription): he is asked about one line at a time
 * (components/visit/elder/ReviewOne.tsx) until nothing is left to ask, then the summary shows.
 *
 * The journeys used to walk a fixed queue (「第 1 件 / 共 7 件」, seven rows, eight rows). That holds only while the
 * visit's items come from the rules alone. With a real model the whole-visit pass also asks the model, which can add a
 * line nobody scripted or put one more item under a line; and against a real database an answer takes longer than a
 * test's default patience. So:
 *
 *   answerUntilSummary(kit, page, script)
 *     answers whatever line comes up until the summary is on the screen. A line of the script (found by a piece of its
 *     words) gets the script's caption, its checks (`before`: the speaker's tag, listening to the clip) and its answer.
 *     A line that is not in the script (a model's addition) gets 「不记得」: it changes nothing in his records, it is
 *     never the doctor's confirmed word, and it is reported back. Every line of the script must have come up.
 *     After 「不是」 the line stays on the screen, flagged, with its undo bar (the timeline design's 05-5,
 *     data-testid="review-held"): the script's `held` checks run there, then he taps 「下一件」 (review-next).
 *   rowOf(page, text)
 *     the summary's row for a line, by its words: the journeys assert on the lines they care about, never on how many
 *     rows there are.
 *
 * Waiting: each answer is saved before the next line shows; the waits here allow 30 s (the real database from this
 * machine; the default 10 s is for a local store).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { Journey } from "../_kit";

export type Answer = "review-yes" | "review-no" | "review-unsure";

export interface ScriptLine {
  /** a piece of the line's words, as the transcript has them */
  text: string;
  answer: Answer;
  /** the caption for the stretch that starts with this line (kit.step) */
  step?: string;
  /** checks and actions while the line is on the screen, before he answers (the tag, 「听这一句」) */
  before?: (one: Locator) => Promise<void>;
  /** after 「不是」: checks while the line stays on the screen, flagged, before he taps 「下一件」 */
  held?: (held: Locator) => Promise<void>;
  /** a pause after his answer (the recording's pace), ms */
  pause?: number;
}

export interface Reviewed {
  /** the words of every line he was asked about, in order */
  asked: string[];
  /** the lines that were not in the script (answered 「不记得」) */
  extra: string[];
}

/** How long one answer may take to be saved and the next line (or the summary) to show. */
export const ANSWER_TIMEOUT = 30_000;

export async function answerUntilSummary(kit: Journey, page: Page, script: ScriptLine[]): Promise<Reviewed> {
  const one = page.getByTestId("review-one");
  const said = one.locator('[data-rp="said"]');
  const summary = page.getByTestId("review-summary");
  const asked: string[] = [];
  const extra: string[] = [];
  const done = new Set<ScriptLine>();
  let saidExtra = false;
  for (let i = 0; i < 80; i++) {
    await expect(one.or(summary).first()).toBeVisible({ timeout: ANSWER_TIMEOUT });
    if (await summary.count()) break;
    const key = await one.getAttribute("data-key");
    const text = (await said.innerText()).trim().replace(/^“|”$/g, "");
    const line = script.find((l) => !done.has(l) && text.includes(l.text));
    if (line) {
      done.add(line);
      if (line.step) await kit.step(page, line.step);
      await line.before?.(one);
      await page.getByTestId(line.answer).click();
    } else {
      // not in the script (with a real model, or the developer tools' stand-in for one): he does not remember it
      if (!saidExtra) await kit.step(page, "这一句不在这次要认的几句里（模型多找出来的）。他点「不记得」：什么都不会变");
      saidExtra = true;
      extra.push(text);
      await page.getByTestId("review-unsure").click();
    }
    asked.push(text);
    // saved: this line is gone (the next one, or the summary, takes its place)
    await expect(page.locator(`[data-testid="review-one"][data-key="${key}"]`)).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
    if (line?.answer === "review-no") {
      // 「不是」 on the first pass: the line stays, flagged, until 「下一件」
      const held = page.locator(`[data-testid="review-held"][data-key="${key}"]`);
      await expect(held).toBeVisible({ timeout: ANSWER_TIMEOUT });
      await line.held?.(held);
      await page.getByTestId("review-next").click();
      await expect(held).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
    }
    if (line?.pause) await kit.pause(line.pause);
  }
  await expect(summary).toBeVisible({ timeout: ANSWER_TIMEOUT });
  for (const l of script) expect(done.has(l), `he was asked about: ${l.text}`).toBe(true);
  return { asked, extra };
}

/** The summary's row for the line with these words. */
export function rowOf(page: Page, text: string): Locator {
  return page.getByTestId("review-summary").getByTestId("review-row").filter({ hasText: text });
}
