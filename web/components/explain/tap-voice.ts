/**
 * A voice that the server makes after a tap, started so that a phone lets it play (「读给我听」 on the explain card: his
 * account's ReadCardAloud in components/meds/elder/CardParts.tsx, the demo's ReadAloud in ExplainCard.tsx).
 *
 * An iPhone lets a page start a sound only from the tap itself. The read-aloud voice is made on the server first, which
 * takes seconds: by the time its bytes are here the tap is long over, and a play() on an element the tap never touched
 * is refused (web/progress/t.md, 「没验证的」 6). What the phone remembers is the element: one that was loaded inside a
 * tap may play later without one. So the order is fixed, and tests/unit/explain/tap-voice.test.ts holds it:
 *
 *   in the tap, before anything is awaited   the element is there (made right then, or already on the page) and load()
 *                                            is called on it; the voice is asked for
 *   when the bytes are here                  they are given to that same element (src), then play()
 *
 * A tap that is no longer the latest (he tapped again, stopped, left the card) gives its bytes to nobody: no address
 * is made for them and nothing plays. Nothing here decides what is read: the caller names the card, the server builds
 * the text (lib/explain/read-aloud.ts).
 *
 * Not heard on a real iPhone yet: the button is drawn only with a real voice (lib/tts readAloudOffered), which this
 * machine does not have. With the mock voice the demo's button plays through this same order in Chromium
 * (e2e/m5-explain.spec.ts).
 */

/** The three things asked of an audio element here (an HTMLAudioElement has them). */
export interface VoiceElement {
  src: string;
  load(): void;
  play(): Promise<void>;
}

export interface TapVoice<E> {
  /** the element the voice plays in: there, and loaded, before the call returned */
  element: E;
  /**
   * "playing": the bytes were given to the element and its play() was accepted. "stale": this tap was overtaken while
   * the voice was on its way, nothing was done with it. Rejects when the voice could not be fetched or the element
   * would not play it: the caller says so on the screen.
   */
  done: Promise<"playing" | "stale">;
}

/**
 * Call this in the tap's own handler, with nothing awaited before it. `makeElement`, `load()` and `fetchVoice` have all
 * been called by the time it returns.
 */
export function voiceFromTap<E extends VoiceElement, B>(o: {
  /** the element for this tap: a new Audio(), or the <audio> already on the page */
  makeElement: () => E;
  /** asks the server for the voice; throws when it has none to give */
  fetchVoice: () => Promise<B>;
  /** an address the element can play the bytes from (URL.createObjectURL); asked once, only for the latest tap */
  toUrl: (bytes: B) => string;
  /** false once this tap is no longer the latest one */
  current: () => boolean;
}): TapVoice<E> {
  const element = o.makeElement();
  // inside the tap: this is what makes the element one he started himself
  element.load();
  let voice: Promise<B>;
  try {
    voice = o.fetchVoice();
  } catch (e) {
    voice = Promise.reject(e);
  }
  const done = (async () => {
    const bytes = await voice;
    if (!o.current()) return "stale" as const;
    element.src = o.toUrl(bytes);
    await element.play();
    return "playing" as const;
  })();
  return { element, done };
}
