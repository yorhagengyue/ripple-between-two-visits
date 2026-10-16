/**
 * The judge landing drives the real phone page in its frame (same origin): it types the sentence into Today's box
 * (/p/today, components/daily/AskBox) and presses send, exactly as Mr Tan would. The answer is the real POST
 * /api/ask flow, drawn by the phone's own components. Nothing here writes a sentence. Client-only.
 *
 * Fix round of 10-11 (journey 22 on the real stack): the sentence is brought onto the phone's screen the moment the box
 * shows it, before any answer (onShown); the box's own error line ends the wait at once (PHONE_REFUSED: it used to wait
 * out the whole timeout for an answer the phone had already been refused); and what is brought onto the screen is the
 * box's "ask-turn" block, by scrolling the phone's own page to just under its sticky header (the sentence used to end up
 * behind that header, and the judges' page was scrolled along with the phone's).
 */

export const PHONE_FRAME_TESTID = "landing-phone";

/**
 * How long the judges' page waits for the whole answer after the sentence is sent, before it says the phone did not
 * answer. Every model call of one answer, the checker's included, shares ask()'s one budget (lib/safety/pipeline.ts
 * askDeadlineMs: ASK_DEADLINE_MS, 8 s unless the server is given another): at that moment the calls still out are
 * stopped and the answer is made from what is there, so the server answers by then plus its store's round trips (about a
 * dozen around one ask, 80 ms each on the hosted database). 20 s is that budget two and a half times over. A server
 * given a longer ASK_DEADLINE_MS needs this raised with it (tests/unit/demo/phone-driver.test.ts holds the two together).
 */
export const PHONE_ANSWER_TIMEOUT_MS = 20_000;

/** askOnPhone's error when the phone itself said the ask did not go through (its error line is on its screen). */
export const PHONE_REFUSED = "phone_refused";

type PhoneWindow = Window & {
  HTMLInputElement: typeof HTMLInputElement;
  Event: typeof Event;
  __rpAsk?: { text: string; sentAt: number; answeredAt: number | null };
  __rpAskRoute?: { text: string; route: string; routeReason: string; stoppedAt: number[]; drillStoppedAt?: number | null };
  __rpAskDrill?: boolean;
  __rpAskFailed?: { text: string; at: number } | null;
};

export function phoneFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(`[data-testid="${PHONE_FRAME_TESTID}"]`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(get: () => T | null | undefined | false, timeoutMs: number, stepMs = 50): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let v: T | null | undefined | false = null;
    try {
      v = get();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() > end) throw new Error("phone_not_ready");
    await sleep(stepMs);
  }
}

/** The phone page's window and document once its live connection is open (hydrated). */
function livePhone(frame: HTMLIFrameElement): { win: PhoneWindow; doc: Document } | null {
  const win = frame.contentWindow as PhoneWindow | null;
  const doc = frame.contentDocument;
  if (!win || !doc || doc.readyState === "loading") return null;
  if (!doc.querySelector('[data-live="open"]')) return null;
  return { win, doc };
}

/** Is the phone showing any of his pages, hydrated and connected? (A question opens Today first.) */
export function phoneLive(frame: HTMLIFrameElement | null = phoneFrame()): boolean {
  return !!frame && !!livePhone(frame);
}

/** Is the phone showing Today with its box, hydrated and connected? */
export function phoneReady(frame: HTMLIFrameElement | null = phoneFrame()): boolean {
  if (!frame) return false;
  const p = livePhone(frame);
  return !!p && !!p.doc.querySelector('[data-testid="ask-input"]');
}

/** The phone's language as its page declares it (zh-Hans / en). */
export function phoneLocale(frame: HTMLIFrameElement | null = phoneFrame()): "zh-Hans" | "en" | null {
  try {
    const lang = frame?.contentDocument?.querySelector(".rp-patient")?.getAttribute("lang") ?? frame?.contentDocument?.documentElement.lang;
    return lang === "en" ? "en" : lang ? "zh-Hans" : null;
  } catch {
    return null;
  }
}

/** Open a page on the phone and wait until it is live. */
export async function showOnPhone(pathname: string, timeoutMs = 20_000): Promise<void> {
  const frame = await until(() => phoneFrame(), 5_000);
  const here = (() => {
    try {
      return frame.contentWindow?.location.pathname ?? null;
    } catch {
      return null;
    }
  })();
  if (here !== pathname) {
    const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    frame.src = pathname;
    await Promise.race([loaded, sleep(timeoutMs)]);
  }
  await until(() => livePhone(frame), timeoutMs);
}

export interface PhoneAnswer {
  /** parent performance.now() when the sentence was sent and when the whole answer was on the phone */
  sentAt: number;
  answeredAt: number;
  /** how the answer was sorted (lib/safety route) and which rule or model decided it, as the phone's box reports them */
  route: string | null;
  routeReason: string | null;
  /** the layers (1 to 3) that stopped a sentence of this answer; empty: none was stopped */
  stoppedAt: number[];
  /**
   * the layer that stopped the check drill's own sentence; null when no drill was asked for or its sentence was not added
   * (a sentence of the model's stopped in the same answer is in stoppedAt, not here)
   */
  drillStoppedAt: number | null;
}

/**
 * Did the fixed rules alone decide this answer, with no model asked (an emergency or a self-harm sentence the rules
 * caught)? Then there is no waiting time worth showing: the judges' page says 「规则当场判断」 instead of "0.0 s"
 * (real-app 12). A crisis the model's screen raised, or a rule's answer that still went through the model, is not this.
 */
export function ruleOnlyAnswer(a: Pick<PhoneAnswer, "route" | "routeReason">): boolean {
  if (a.route !== "emergency" && a.route !== "self_harm") return false;
  const r = a.routeReason ?? "";
  return r.startsWith("rule:") && !/crisis screen|model_crisis|by the model/.test(r);
}

export interface AskOnPhoneOptions {
  /** the check drill (lib/crew/drill.ts): this one ask is sent with the drill flag */
  drill?: boolean;
  /**
   * Called once, with performance.now(), when the sentence is on the phone's screen: the box draws it the moment it is
   * sent, with its waiting line, long before a real model's answer. Not called when the phone never shows it.
   */
  onShown?: (shownAt: number) => void;
}

/**
 * Bring the box's block for the ask in hand (his sentence, then the waiting line or the answer) onto the phone's screen.
 * The phone's own page scrolls, to just under its sticky header (the block's scroll-margin says how much room that
 * takes); the judges' page moves only as far as it takes to show the whole phone. scrollIntoView on the block moved both
 * pages at once: the sentence went behind the phone's header, and the top of the phone off the judges' page.
 */
function turnOnScreen(frame: HTMLIFrameElement, win: PhoneWindow, doc: Document): void {
  const turn = doc.querySelector<HTMLElement>('[data-testid="ask-turn"]') ?? doc.querySelector<HTMLElement>('[data-testid="ask-answer"]');
  if (!turn) return;
  const room = Number.parseFloat(win.getComputedStyle(turn).scrollMarginTop) || 0;
  win.scrollBy({ top: turn.getBoundingClientRect().top - room, behavior: "instant" });
  frame.scrollIntoView({ block: "nearest" });
}

/**
 * Type `text` into Today's box on the phone and send it; resolves when the whole answer is on the phone screen
 * (scrolled into view). Opens Today first when the phone shows another page. The sentence itself is on the phone's
 * screen as soon as the box shows it (opts.onShown). Rejects with PHONE_REFUSED as soon as the phone says the ask did
 * not go through, and with "phone_not_ready" when no answer came within `timeoutMs`.
 */
export async function askOnPhone(text: string, timeoutMs = PHONE_ANSWER_TIMEOUT_MS, opts: AskOnPhoneOptions = {}): Promise<PhoneAnswer> {
  if (!phoneReady()) await showOnPhone("/p/today", timeoutMs);
  const frame = phoneFrame()!;
  const { win, doc } = await until(() => livePhone(frame), timeoutMs);
  const input = await until(() => doc.querySelector<HTMLInputElement>('[data-testid="ask-input"]'), timeoutMs);
  const send = await until(() => doc.querySelector<HTMLButtonElement>('[data-testid="ask-send"]'), timeoutMs);
  const before = win.__rpAsk;
  const said = text.trim();

  // a React-controlled input: set the value through the native setter, then fire the input event React listens to
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  await until(() => !send.disabled && input.value === text, 3_000, 16);

  // the check drill (lib/crew/drill.ts): the phone's box sends this one ask with the drill flag
  if (opts.drill) win.__rpAskDrill = true;
  const sentAt = performance.now();
  send.click();
  let shown = false;
  const outcome = await until(() => {
    const a = win.__rpAsk;
    if (!a || a === before || a.text !== said) return null;
    // his sentence is on the phone the moment it is sent: bring it onto the phone's screen now, not with the answer
    if (!shown && doc.querySelector('[data-testid="ask-asked"]')?.textContent === `“${said}”`) {
      shown = true;
      turnOnScreen(frame, win, doc);
      opts.onShown?.(performance.now());
    }
    if (a.answeredAt !== null && doc.querySelector('[data-testid="ask-answer"][data-complete="true"]')) return "answered";
    // the phone's own error line (the ask was refused, or never reached the server): no answer is coming
    return win.__rpAskFailed?.text === said ? "refused" : null;
  }, timeoutMs, 16);
  if (outcome === "refused") {
    turnOnScreen(frame, win, doc);
    throw new Error(PHONE_REFUSED);
  }
  const answeredAt = performance.now();
  turnOnScreen(frame, win, doc);
  const sorted = win.__rpAskRoute?.text === said ? win.__rpAskRoute : null;
  return { sentAt, answeredAt, route: sorted?.route ?? null, routeReason: sorted?.routeReason ?? null, stoppedAt: sorted?.stoppedAt ?? [], drillStoppedAt: sorted?.drillStoppedAt ?? null };
}
