/**
 * Sound in journey recordings. A Playwright video has no audio track, so the kit listens for the app playing
 * something (the doctor's clip, Wei Ling's reminder, read-aloud) and puts that sound into the mp4 afterwards.
 *
 * In the page (init script `audioHook`): HTMLMediaElement.prototype.play is wrapped, so every <audio>/<video> and every
 * `new Audio()` is seen, and a capture-phase "play" listener catches elements that start without play() (autoplay
 * attribute). Each element reports `playing` (sound actually starts: wall time and media position) and the event
 * that stops it (pause, ended, emptied, error) through a context binding, which survives navigations.
 *
 * In Node (`AudioLog`): one AudioClip per stretch of playback. The bytes of each source are fetched once, with the
 * phone's own cookies (context.request) for http(s) sources, or inside the page for blob: sources, and saved next to
 * the raw video. compose.ts trims each clip to the stretch that played and delays it to the right moment.
 *
 * Not captured: Web Audio (AudioContext) and speechSynthesis. The app plays everything through <audio> today.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

/** The binding the init script calls (window.__rpJourneyAudio). */
export const AUDIO_BINDING = "__rpJourneyAudio";

export interface AudioEvent {
  type: "play" | "playing" | "pause" | "ended" | "emptied" | "error" | "blocked";
  /** one id per media element (per page document) */
  id: string;
  /** absolute URL as the element resolved it */
  src: string;
  /** Date.now() in the page */
  at: number;
  /** media position (currentTime, seconds) */
  pos?: number;
  muted?: boolean;
  volume?: number;
  rate?: number;
  error?: string;
}

/** One stretch of audible playback, from `playing` to the event that stopped it (or the end of the recording). */
export interface AudioClip {
  /** the phone's name (kit.phones key) */
  phone: string;
  src: string;
  /** the fetched bytes on disk; null when fetching failed (see AudioLog.errors) */
  file: string | null;
  startWall: number;
  /** null while it is still playing */
  endWall: number | null;
  startPos: number;
  endPos: number | null;
  volume: number;
  muted: boolean;
  rate: number;
}

/**
 * Runs inside every page of a recorded phone (context.addInitScript(audioHook, AUDIO_BINDING)). Self-contained: it is
 * serialized into the page, so it may not use anything from this module.
 */
export function audioHook(bindingName: string): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__rpJourneyAudioHooked) return;
  w.__rpJourneyAudioHooked = true;
  const ids = new WeakMap<HTMLMediaElement, string>();
  let seq = 0;
  const send = (ev: Record<string, unknown>) => {
    try {
      const fn = w[bindingName] as ((e: Record<string, unknown>) => Promise<unknown>) | undefined;
      void fn?.(ev)?.catch?.(() => undefined);
    } catch {
      // the binding is gone while the page unloads
    }
  };
  const srcOf = (el: HTMLMediaElement) => el.currentSrc || el.src || el.getAttribute("src") || "";
  const track = (el: HTMLMediaElement): string => {
    const known = ids.get(el);
    if (known) return known;
    const id = `${Date.now().toString(36)}-${++seq}`;
    ids.set(el, id);
    el.addEventListener("playing", () =>
      send({ type: "playing", id, src: srcOf(el), at: Date.now(), pos: el.currentTime, muted: el.muted, volume: el.volume, rate: el.playbackRate }),
    );
    for (const type of ["pause", "ended", "emptied", "error"]) {
      el.addEventListener(type, () => send({ type, id, src: srcOf(el), at: Date.now(), pos: el.currentTime }));
    }
    return id;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement): Promise<void> {
    const id = track(this);
    send({ type: "play", id, src: srcOf(this), at: Date.now(), pos: this.currentTime });
    const p = play.call(this);
    if (p && typeof p.catch === "function") {
      p.catch((e: unknown) => send({ type: "blocked", id, src: srcOf(this), at: Date.now(), error: String(e) }));
    }
    return p;
  };
  // media events do not bubble, but a capture listener on window still sees them (elements in the document only)
  window.addEventListener(
    "play",
    (e) => {
      if (e.target instanceof HTMLMediaElement) track(e.target);
    },
    true,
  );
}

const EXT: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "video/webm": ".webm",
  "video/mp4": ".mp4",
};

function extOf(contentType: string): string {
  return EXT[contentType.split(";")[0].trim().toLowerCase()] ?? ".bin";
}

interface Waiter {
  match: (src: string) => boolean;
  until: "playing" | "ended";
  resolve: (clip: AudioClip) => void;
}

export class AudioLog {
  readonly clips: AudioClip[] = [];
  /** fetch failures and blocked plays, for the transcript */
  readonly errors: string[] = [];
  private readonly open = new Map<string, AudioClip>();
  private readonly files = new Map<string, Promise<string | null>>();
  private waiters: Waiter[] = [];

  constructor(private readonly dir: string) {}

  onEvent(phone: string, page: Page, context: BrowserContext, ev: AudioEvent): void {
    const key = `${phone}:${ev.id}`;
    if (ev.type === "blocked") {
      this.errors.push(`${phone}: the browser refused to play ${ev.src} (${ev.error ?? "blocked"})`);
      return;
    }
    if (ev.type === "playing") {
      if (this.open.has(key) || !ev.src) return; // resumed after buffering: still the same stretch
      const clip: AudioClip = {
        phone,
        src: ev.src,
        file: null,
        startWall: ev.at,
        endWall: null,
        startPos: ev.pos ?? 0,
        endPos: null,
        volume: ev.volume ?? 1,
        muted: !!ev.muted,
        rate: ev.rate ?? 1,
      };
      this.clips.push(clip);
      this.open.set(key, clip);
      void this.fetch(ev.src, page, context).then((file) => {
        clip.file = file;
      });
      this.notify(clip, "playing");
      return;
    }
    if (ev.type === "play") return;
    const clip = this.open.get(key);
    if (!clip) return;
    clip.endWall = ev.at;
    clip.endPos = typeof ev.pos === "number" ? ev.pos : null;
    this.open.delete(key);
    this.notify(clip, "ended");
  }

  /** Resolves with the first clip whose src contains `match` (or matches it) once it is playing / has stopped. */
  wait(match: string | RegExp, until: "playing" | "ended", timeoutMs: number): Promise<AudioClip> {
    const test = (src: string) => (typeof match === "string" ? src.includes(match) : match.test(src));
    const done = this.clips.find((c) => test(c.src) && (until === "playing" || c.endWall !== null));
    if (done) return Promise.resolve(done);
    return new Promise<AudioClip>((resolve, reject) => {
      const waiter: Waiter = {
        match: test,
        until,
        resolve: (clip) => {
          clearTimeout(timer);
          resolve(clip);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        const seen = this.clips.map((c) => c.src).join(", ") || "none";
        reject(new Error(`no audio ${until === "playing" ? "started" : "finished"} matching ${String(match)} within ${timeoutMs} ms (heard so far: ${seen})`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Waits for every fetch, then gives each clip its file. */
  async settle(): Promise<void> {
    for (const clip of this.clips) clip.file = (await this.files.get(clip.src)) ?? null;
  }

  /** Clips still playing when the recording ends stop there. */
  closeOpen(endWall: number): void {
    for (const clip of this.open.values()) clip.endWall = endWall;
    this.open.clear();
  }

  private notify(clip: AudioClip, event: "playing" | "ended"): void {
    const hit = this.waiters.filter((w) => w.match(clip.src) && (w.until === event || (w.until === "playing" && event === "ended")));
    if (!hit.length) return;
    this.waiters = this.waiters.filter((w) => !hit.includes(w));
    for (const w of hit) w.resolve(clip);
  }

  private fetch(src: string, page: Page, context: BrowserContext): Promise<string | null> {
    let pending = this.files.get(src);
    if (!pending) {
      const n = this.files.size + 1;
      pending = this.download(src, page, context, n).catch((err: unknown) => {
        this.errors.push(`could not fetch ${src}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      this.files.set(src, pending);
    }
    return pending;
  }

  private async download(src: string, page: Page, context: BrowserContext, n: number): Promise<string> {
    let bytes: Buffer;
    let type = "";
    if (src.startsWith("data:")) {
      const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/.exec(src);
      if (!m) throw new Error("unreadable data: URL");
      type = m[1];
      bytes = m[3] ? Buffer.from(m[4], "base64") : Buffer.from(decodeURIComponent(m[4]), "utf8");
    } else if (src.startsWith("blob:")) {
      const got = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { b64: btoa(bin), type: res.headers.get("content-type") ?? "" };
      }, src);
      bytes = Buffer.from(got.b64, "base64");
      type = got.type;
    } else {
      const res = await context.request.get(src);
      if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
      bytes = await res.body();
      type = res.headers()["content-type"] ?? "";
    }
    const file = path.join(this.dir, `clip-${n}${extOf(type)}`);
    writeFileSync(file, bytes);
    return file;
  }
}
