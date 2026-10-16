/**
 * The review of a visit in the whole-line journeys of track G (23 blank, 24 example): he is asked about one line at a
 * time (components/visit/elder/ReviewOne.tsx) and says 「是」 to each.
 *
 *   sayYes(page, expected, opts)   stub model: the queue is exactly `expected`, in that order, and every line is
 *                                  checked as it comes up (the words, the 「好像是医生说的」 tag with the time point in the
 *                                  recording, the question it answers when `asked` names one: 「你问：」 before his own
 *                                  words, 「问题单上：」 before a question someone else worded).
 *                                  real model (JOURNEY_MODEL=real): the model may add lines of its own to the queue,
 *                                  so he says 「是」 to whatever comes up until the summary is there, and each expected
 *                                  line must have been among them (with the same checks when it came up).
 * Returns the words of every line he was asked about, in order.
 */
import { expect, type Page } from "@playwright/test";
import { REAL_MODEL } from "./mode";

export interface ReviewLine {
  /** the line's words, exactly as the transcript has them */
  text: string;
  /** its time point in the recording */
  start_ms: number;
  /** the question this line answers, as the card writes it (when it is an answer) */
  asked?: string;
  /**
   * Whose words `asked` is (components/visit/elder/AskedWords.tsx): true = his own, the card writes 「你问：」; otherwise a
   * question on his list that someone else worded (Ripple from his records, a kept summary): 「问题单上：」, never shown
   * as what he said.
   */
  own?: boolean;
}

/** "1:15" for a time point in the recording, as the review and the question list write it (cut, not rounded). */
export const clipAt = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export async function sayYes(page: Page, expected: ReviewLine[], opts: { afterEach?: () => Promise<void>; beforeYes?: (line: ReviewLine, index: number) => Promise<void> } = {}): Promise<string[]> {
  const one = page.getByTestId("review-one");
  const said = one.locator('[data-rp="said"]');
  const tag = one.locator('[data-rp="source-tag"]');
  const check = async (l: ReviewLine) => {
    await expect(said).toContainText(l.text);
    await expect(tag).toContainText("好像是医生说的");
    await expect(tag).toContainText(clipAt(l.start_ms));
    if (l.asked) {
      const question = one.getByTestId("review-asked");
      await expect(question).toHaveAttribute("data-wording", l.own ? "own_words" : "on_list");
      await expect(question).toHaveText(`${l.own ? "你问：" : "问题单上："}${l.asked}`);
    }
  };
  const asked: string[] = [];

  if (!REAL_MODEL) {
    await expect(page.getByTestId("review-queue")).toHaveAttribute("data-pending", String(expected.length));
    await expect(one).toContainText(`第 1 件 / 共 ${expected.length} 件`);
    for (const [i, l] of expected.entries()) {
      await opts.beforeYes?.(l, i);
      await check(l);
      await opts.afterEach?.();
      asked.push(l.text);
      await page.getByTestId("review-yes").click();
      await expect(one.filter({ hasText: l.text })).toHaveCount(0);
    }
    await expect(page.getByTestId("review-summary")).toBeVisible();
    return asked;
  }

  // a real model: whatever comes up, until the summary is there
  const summary = page.getByTestId("review-summary");
  for (let i = 0; i < 60; i++) {
    await expect(one.or(summary).first()).toBeVisible({ timeout: 30_000 });
    if (await summary.count()) break;
    const key = await one.getAttribute("data-key");
    const text = (await said.innerText()).trim().replace(/^“|”$/g, "");
    const at = expected.findIndex((l) => l.text === text);
    if (at >= 0) {
      // the line's own place in `expected`, whatever order the model put the queue in (the caller's caption goes by it)
      await opts.beforeYes?.(expected[at], at);
      await check(expected[at]);
    }
    await opts.afterEach?.();
    asked.push(text);
    await page.getByTestId("review-yes").click();
    await expect(page.locator(`[data-testid="review-one"][data-key="${key}"]`)).toHaveCount(0, { timeout: 30_000 });
  }
  await expect(summary).toBeVisible();
  for (const l of expected) expect(asked, `he was asked about: ${l.text}`).toContain(l.text);
  return asked;
}
