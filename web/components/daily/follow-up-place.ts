/**
 * Where the screen goes when an answer with an open follow-up question arrives (the guided harness, 10-16; the owner's
 * coordinator's decision: the question is never scrolled past unknowingly, and the 995 line stays in view when both fit).
 * Measures the answer on the screen and scrolls its scroller as follow-up.ts followUpScroll says; says whether the chip
 * 「Ripple 想问你一句 ↓」 is wanted. Browser only (called after the answer is drawn).
 */
import { followUpScroll } from "./follow-up";

/** The element that scrolls `el`'s page: a scrolling ancestor (a phone drawn in a box, the Ask sheet), else the window's. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** The 995 line of an answer: the 995 card, or the first entry with a 995 button, or the first entry with a number to call. */
function anchorOf(answer: HTMLElement): HTMLElement | null {
  const card = answer.querySelector<HTMLElement>('[data-rp="emergency"]');
  if (card) return card;
  const call = answer.querySelector<HTMLElement>('a[href^="tel:995"]') ?? answer.querySelector<HTMLElement>('[data-rp="call"]');
  return call?.closest<HTMLElement>('[data-rp="tl-item"]') ?? null;
}

/**
 * Place the answer `answer` (its open question, when it has one) in its scroller (`box`: the Ask sheet; left out, the
 * scrolling ancestor or the window). `foot`: what covers the foot of the scroller's view (the fixed tab bar on a page, the
 * sheet's hold bar). Returns whether the chip is wanted; without an open question nothing moves and false comes back.
 */
export function placeFollowUp(answer: HTMLElement, foot: HTMLElement | null = null, box?: HTMLElement | null): boolean {
  const question = answer.querySelector<HTMLElement>('[data-testid="ask-followup"][data-state="open"]');
  if (!question) return false;
  const scroller = box ?? scrollerOf(answer);
  const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
  const viewTop = isPage ? 0 : scroller.getBoundingClientRect().top;
  let viewBottom = isPage ? window.innerHeight : scroller.getBoundingClientRect().bottom;
  // (a fixed bar has no offsetParent: whether it shows is its box; the urgent ask screen hides the tab bar)
  const footRect = foot && getComputedStyle(foot).display !== "none" ? foot.getBoundingClientRect() : null;
  if (footRect && footRect.height > 0 && footRect.top < viewBottom) viewBottom = footRect.top;
  const y = (el: Element, edge: "top" | "bottom") => el.getBoundingClientRect()[edge] - viewTop + scroller.scrollTop;
  const first = question.querySelector('[data-testid="ask-followup-option"]') ?? question;
  const anchor = anchorOf(answer);
  const { scrollTo, chip } = followUpScroll({
    view: viewBottom - viewTop,
    question: { top: y(question, "top"), firstBottom: y(first, "bottom"), bottom: y(question, "bottom") },
    anchor: anchor ? { top: y(anchor, "top") } : null,
  });
  scroller.scrollTo({ top: scrollTo });
  return chip;
}
