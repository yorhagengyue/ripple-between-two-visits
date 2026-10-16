/**
 * The judges' page asking on the phone in its frame (components/landing/phone-driver.ts askOnPhone), against a stand-in
 * phone whose answer takes as long as the test says (C2 track E, fix round of 10-11).
 *
 * The stand-in gives the driver what the phone's own box gives it (components/daily/AskBox.tsx): the field and the send
 * button, window.__rpAsk when a sentence is sent, the sentence on the screen ("ask-asked" in the "ask-turn" block) at
 * once, and later either the whole answer ("ask-answer", data-complete) or window.__rpAskFailed with the error line.
 * Time is the test's own (fake timers), so an answer that takes 10 s costs the suite nothing.
 *
 *   - the sentence is brought onto the phone's screen the moment the box shows it, 10 s before its answer (onShown);
 *   - the box's error line ends the wait at once (the real run: 403 after 0.2 s, and the page waited 20 s);
 *   - the wait for an answer is longer than any real answer can take: ask()'s whole budget (ASK_DEADLINE_MS) twice over.
 * The phone's box itself, in a browser, with its POST held 10 s: e2e/e-demo-followup.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askOnPhone, PHONE_ANSWER_TIMEOUT_MS, PHONE_FRAME_TESTID, PHONE_REFUSED } from "@/components/landing/phone-driver";
import { askDeadlineMs } from "@/lib/safety/pipeline";

const OWN = "What is amlodipine for?";

interface StandIn {
  /** how long the phone's ask takes, ms */
  answerAfterMs: number;
  /** the ask does not go through: the box shows its error line instead of an answer */
  fails?: boolean;
  /** false: the box before this round, which drew the sentence only together with its answer */
  showsAtOnce?: boolean;
}

/** Where the block of the ask in hand stands on the stand-in's screen, and the room its sticky header takes (px). */
const TURN_TOP = 262;
const HEADER_ROOM = 80;
/** One showing of the ask: the phone's own page moves the block to just under its header, the judges' page shows the whole phone. */
const SHOWN_ONCE = [`phone:${TURN_TOP - HEADER_ROOM}`, "page"];

/**
 * A phone in the frame: just the hooks the driver reads. Returns what was moved to show the ask, in order: "phone:<px>"
 * the phone's own page scrolled by that much, "page" the judges' page asked to show the whole phone.
 */
function standInPhone(o: StandIn): { onScreen: string[] } {
  const onScreen: string[] = [];
  const there = new Map<string, unknown>();
  const el = (name: string, textContent = "") => ({ name, textContent, getBoundingClientRect: () => ({ top: TURN_TOP }) });
  class Field {
    private v = "";
    get value(): string {
      return this.v;
    }
    set value(next: string) {
      this.v = next;
    }
    dispatchEvent(): boolean {
      send.disabled = !this.v.trim(); // what React does with the typed words
      return true;
    }
  }
  const field = new Field();
  const win: Record<string, unknown> = {
    HTMLInputElement: Field,
    Event: class {
      constructor(readonly type: string) {}
    },
    // the block's own scroll-margin is the room the phone's sticky header takes
    getComputedStyle: () => ({ scrollMarginTop: `${HEADER_ROOM}px` }),
    scrollBy: (to: { top: number }) => void onScreen.push(`phone:${to.top}`),
  };
  const drawSentence = (text: string) => {
    there.set('[data-testid="ask-asked"]', el("ask-asked", `“${text}”`));
    there.set('[data-testid="ask-turn"]', el("ask-turn"));
  };
  const send = {
    disabled: true,
    click() {
      const text = field.value.trim();
      const ask = { text, sentAt: performance.now(), answeredAt: null as number | null };
      win.__rpAsk = ask;
      win.__rpAskFailed = null;
      if (o.showsAtOnce !== false) drawSentence(text);
      setTimeout(() => {
        if (o.fails) {
          win.__rpAskFailed = { text, at: performance.now() };
          return;
        }
        drawSentence(text);
        there.set('[data-testid="ask-answer"][data-complete="true"]', el("ask-answer"));
        there.set('[data-testid="ask-answer"]', el("ask-answer"));
        win.__rpAskRoute = { text, route: "explain", routeReason: "the model", stoppedAt: [], drillStoppedAt: null };
        ask.answeredAt = performance.now();
      }, o.answerAfterMs);
    },
  };
  there.set('[data-live="open"]', el("live"));
  there.set('[data-testid="ask-input"]', field);
  there.set('[data-testid="ask-send"]', send);
  const doc = { readyState: "complete", querySelector: (sel: string) => there.get(sel) ?? null };
  const frame = { contentWindow: win, contentDocument: doc, scrollIntoView: (how: { block: string }) => void onScreen.push(how.block === "nearest" ? "page" : `page:${how.block}`) };
  vi.stubGlobal("document", { querySelector: (sel: string) => (sel === `[data-testid="${PHONE_FRAME_TESTID}"]` ? frame : null) });
  return { onScreen };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("askOnPhone, with an answer that takes 10 s", () => {
  it("brings the sentence onto the phone's screen at once, and resolves when the whole answer is there", async () => {
    const phone = standInPhone({ answerAfterMs: 10_000 });
    const t0 = Date.now();
    const shownAfter: number[] = [];
    let settled: string | null = null;
    const asking = askOnPhone(OWN, PHONE_ANSWER_TIMEOUT_MS, { onShown: () => void shownAfter.push(Date.now() - t0) });
    asking.then(
      () => (settled = "answered"),
      () => (settled = "failed"),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(shownAfter, "the sentence on the phone's screen within 200 ms").toHaveLength(1);
    // the phone's own page scrolled to just under its header; the judges' page only asked to show the whole phone
    expect(phone.onScreen).toEqual(SHOWN_ONCE);
    expect(settled).toBeNull();
    // nine seconds on it is still waiting, and has not told the page a second time
    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBeNull();
    expect(shownAfter).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const answer = await asking;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10_000);
    expect(answer).toMatchObject({ route: "explain", routeReason: "the model", stoppedAt: [], drillStoppedAt: null });
    // the same block again when the answer has taken the waiting line's place: the sentence stays where it was
    expect(phone.onScreen).toEqual([...SHOWN_ONCE, ...SHOWN_ONCE]);
  });

  it("a box that draws the sentence only with its answer (before this round) is still waited for: the page hears of the sentence 10 s late", async () => {
    standInPhone({ answerAfterMs: 10_000, showsAtOnce: false });
    const t0 = Date.now();
    const shownAfter: number[] = [];
    const asking = askOnPhone(OWN, PHONE_ANSWER_TIMEOUT_MS, { onShown: () => void shownAfter.push(Date.now() - t0) });
    await vi.advanceTimersByTimeAsync(9_900);
    expect(shownAfter).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    await asking;
    expect(shownAfter).toHaveLength(1);
    expect(shownAfter[0]).toBeGreaterThanOrEqual(10_000);
  });
});

describe("askOnPhone, when no answer is coming", () => {
  it("the phone's own error line ends the wait at once (403 after 0.2 s on the real run; the page waited 20 s)", async () => {
    const phone = standInPhone({ answerAfterMs: 190, fails: true });
    const t0 = Date.now();
    const seen = askOnPhone(OWN).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(400);
    const err = await seen;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(PHONE_REFUSED);
    expect(Date.now() - t0).toBeLessThan(1_000);
    // his sentence, and then the error line under it, are on the phone's screen
    expect(phone.onScreen).toEqual([...SHOWN_ONCE, ...SHOWN_ONCE]);
  });

  it("a phone that never answers: phone_not_ready, after the whole wait and not before", async () => {
    standInPhone({ answerAfterMs: 3_600_000 });
    let settled = false;
    const seen = askOnPhone(OWN).catch((e: unknown) => e);
    void seen.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(PHONE_ANSWER_TIMEOUT_MS - 500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(((await seen) as Error).message).toBe("phone_not_ready");
  });

  it("the whole wait is longer than any real answer: ask()'s one budget for every model call, twice over", () => {
    // every model call of an answer, the checker's included, stops at this budget and the answer is made from what is
    // there (tests/unit/safety/ask-deadline.test.ts); a longer default needs a longer wait on the judges' page
    expect(askDeadlineMs({})).toBe(8000);
    expect(PHONE_ANSWER_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * askDeadlineMs({}));
  });
});
