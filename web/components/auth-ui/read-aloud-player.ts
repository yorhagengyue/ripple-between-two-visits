/**
 * How 「读给我听」 plays a screen's sentences, part after part, on ONE audio element that the tap itself made.
 *
 * Why the element comes first: iOS Safari lets a page start sound only from a tap. A play() that runs after a network
 * answer is no longer "in the tap" and may be refused. WebKit lifts that rule for an element whose load() or play() ran
 * inside a tap, so the button's handler makes the element and calls primeInTap() on it at once; this function then
 * fetches each part and plays it on that same element. Not yet tried on a real iPhone (the button exists only with a
 * real voice, TTS_PROVIDER=trtc): try it there before filming.
 *
 * Pure of React and of the DOM types' details, so tests/unit/ui/auth-components.test.ts can hold the order of the calls.
 */

/** A slot for an event handler, as loose as an <audio> element's own (so the real element and a test's stand-in both fit). */
type Handler = ((event: never) => unknown) | null;

/** What this needs of an <audio> element. */
export interface AloudElement {
  src: string;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  onended: Handler;
  onpause: Handler;
  onerror: Handler;
}

/** One part of the screen as sound: where to play it from, and how many parts the screen has. */
export interface AloudPart {
  url: string;
  parts: number;
}

/** In the tap, on the element just made: this is what makes the phone count the tap for it. */
export function primeInTap(el: AloudElement): void {
  try {
    el.load();
  } catch {
    // an element with nothing to load yet may complain in an old browser; the tap still made it
  }
}

/**
 * Plays every part in order on `el`. `fetchPart` answers null when the server refuses (then this throws: the button says
 * it cannot be read). `alive` turns false when he tapped again or left the screen: the run ends quietly, and nothing
 * more is fetched or played. `release` is given every address once it is no longer needed.
 */
export async function playAloud(el: AloudElement, fetchPart: (part: number) => Promise<AloudPart | null>, alive: () => boolean, release: (url: string) => void): Promise<"done" | "stopped"> {
  for (let part = 0, parts = 1; part < parts; part++) {
    const got = await fetchPart(part);
    if (!alive()) {
      if (got) release(got.url);
      return "stopped";
    }
    if (!got) throw new Error("refused");
    parts = got.parts;
    el.src = got.url;
    try {
      await new Promise<void>((resolve, reject) => {
        el.onended = () => resolve();
        el.onpause = () => resolve();
        el.onerror = () => reject(new Error("audio"));
        el.play().catch(reject);
      });
    } finally {
      release(got.url);
    }
    if (!alive()) return "stopped";
  }
  return "done";
}
