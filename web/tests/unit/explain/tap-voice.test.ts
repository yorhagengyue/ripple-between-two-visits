/**
 * 「读给我听」 on a phone (web/progress/fe-06.md; web/progress/t.md 「没验证的」 6): an iPhone lets a page start a sound
 * only from the tap itself, and the read-aloud voice is made on the server first, seconds later. What is held here is
 * the order of calls of components/explain/tap-voice.ts, which both buttons go through (the account's ReadCardAloud in
 * components/meds/elder/CardParts.tsx, the demo's ReadAloud in components/explain/ExplainCard.tsx):
 *
 *   in the tap, before anything is awaited   the element is made, load() is called on it, the voice is asked for
 *   when the bytes are here                  an address is made for them, it is given to that same element, then play()
 *   a tap that was overtaken                 its bytes go to nobody: no address, no src, no play()
 *   a voice that did not come, a refused play()   the caller hears of it (it says so on the screen)
 *
 * No browser and no sound here: the element is a stand-in that writes down what is asked of it. Whether a real iPhone
 * then plays the voice is not shown by this file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { voiceFromTap, type VoiceElement } from "@/components/explain/tap-voice";

const WEB = path.resolve(__dirname, "..", "..", "..");

/** A promise settled from outside: the server's answer, whenever the test says it has come. */
function later<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending microtask run (the continuation after an awaited promise). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** One tap, with everything it asks for written down in order. */
function tap(opts: { playRefused?: boolean } = {}) {
  const log: string[] = [];
  const voice = later<string>();
  let current = true;
  let made = 0;
  const element: VoiceElement = {
    get src() {
      return "";
    },
    set src(v: string) {
      log.push(`src=${v}`);
    },
    load() {
      log.push("load");
    },
    play() {
      log.push("play");
      return opts.playRefused ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
    },
  };
  const out = voiceFromTap({
    makeElement: () => {
      made++;
      log.push("make");
      return element;
    },
    fetchVoice: () => {
      log.push("fetch");
      return voice.promise;
    },
    toUrl: (bytes) => {
      log.push(`url(${bytes})`);
      return `blob:${bytes}`;
    },
    current: () => current,
  });
  return { log, voice, element, out, overtake: () => (current = false), made: () => made };
}

describe("a voice fetched after a tap: the order that lets a phone play it", () => {
  it("in the tap, before anything is awaited: the element is made, loaded, and only then is the voice asked for", () => {
    const t = tap();
    // nothing has been awaited here: this is still the tap
    expect(t.log).toEqual(["make", "load", "fetch"]);
    expect(t.out.element).toBe(t.element);
    // the promise is handled so the open request does not outlive the test
    t.voice.resolve("v");
    return t.out.done;
  });

  it("while the voice is on its way nothing is played and the element is given nothing", async () => {
    const t = tap();
    await settle();
    await settle();
    expect(t.log).toEqual(["make", "load", "fetch"]);
    t.voice.resolve("v");
    await t.out.done;
  });

  it("when the bytes are here: an address for them, to the same element, then play()", async () => {
    const t = tap();
    t.voice.resolve("v1");
    await expect(t.out.done).resolves.toBe("playing");
    expect(t.log).toEqual(["make", "load", "fetch", "url(v1)", "src=blob:v1", "play"]);
    // one element for the whole tap: the one that was loaded in it is the one that plays
    expect(t.made()).toBe(1);
  });

  it("a tap that was overtaken while the voice was on its way gives its bytes to nobody", async () => {
    const t = tap();
    t.overtake();
    t.voice.resolve("v1");
    await expect(t.out.done).resolves.toBe("stale");
    expect(t.log).toEqual(["make", "load", "fetch"]);
  });

  it("a voice that did not come: the caller hears of it, and nothing is played", async () => {
    const t = tap();
    t.voice.reject(new Error("refused"));
    await expect(t.out.done).rejects.toThrow("refused");
    expect(t.log).toEqual(["make", "load", "fetch"]);
  });

  it("a request that could not even be made is the same: load() has happened, the caller hears of it", async () => {
    const log: string[] = [];
    const out = voiceFromTap<VoiceElement, string>({
      makeElement: () => ({ src: "", load: () => void log.push("load"), play: async () => void log.push("play") }),
      fetchVoice: () => {
        throw new Error("offline");
      },
      toUrl: (b) => b,
      current: () => true,
    });
    expect(log).toEqual(["load"]);
    await expect(out.done).rejects.toThrow("offline");
    expect(log).toEqual(["load"]);
  });

  it("a play() the phone refuses: the caller hears of it", async () => {
    const t = tap({ playRefused: true });
    t.voice.resolve("v1");
    await expect(t.out.done).rejects.toThrow("NotAllowedError");
    expect(t.log).toEqual(["make", "load", "fetch", "url(v1)", "src=blob:v1", "play"]);
  });
});

describe("both 「读给我听」 buttons start their voice this way, from the tap", () => {
  /** The source of one button's component, from its first line to the end of the file. */
  function component(file: string, start: string): string {
    const source = readFileSync(path.join(WEB, ...file.split("/")), "utf8");
    const at = source.indexOf(start);
    expect(at, `${file}: ${start}`).toBeGreaterThan(-1);
    return source.slice(at);
  }

  for (const [file, start] of [
    ["components/meds/elder/CardParts.tsx", "export function ReadCardAloud("],
    ["components/explain/ExplainCard.tsx", "function ReadAloud("],
  ] as const) {
    it(`${file}: nothing is awaited before voiceFromTap, and the component starts no sound by itself`, () => {
      const code = component(file, start);
      const call = code.indexOf("voiceFromTap(");
      expect(call).toBeGreaterThan(-1);
      // up to the call: no await and no promise chain (either would put the element's load() after the tap)
      const before = code.slice(0, call);
      expect(before).not.toMatch(/\bawait\b/);
      expect(before).not.toMatch(/\.then\(/);
      // the element is played by voiceFromTap only: no play() of the component's own
      const own = code.slice(0, code.indexOf("\n}\n", call));
      expect(own).not.toMatch(/\.play\(\)/);
      // and the handler that calls it is not an async function
      expect(before).not.toMatch(/async function (play|start)\b/);
    });
  }
});
