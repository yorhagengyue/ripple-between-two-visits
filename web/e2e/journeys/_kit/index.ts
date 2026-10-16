/**
 * Journey kit: a journey script is an end-to-end test that also records itself as an mp4 for the progress vault.
 * How to write one: e2e/journeys/README.md. The pieces:
 *
 *   journey(title, async ({ kit, request }) => { ... })   a Playwright test with the `kit` fixture
 *   kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" })   recorded phone contexts, side by side in the mp4
 *   phone.join(code, role, path?)                          join a demo session on that phone (instead of helpers.joinAs)
 *   kit.step(page, "一句中文字幕")                          caption for the next stretch, logged for the transcript
 *   kit.type(locator, text) / kit.show(locator)            visible typing, smooth scroll
 *   kit.showNotification(page, { title, body })            a phone-style banner drawn on that phone (push stand-in)
 *   kit.waitForAudio("v2-u08", { until: "ended" })         the app played that sound (it goes into the mp4)
 *   kit.cornerLabel("转写：测试替身")                       a label in the top-right corner of the whole recording
 *   await kit.finish()                                     last line: compose, mux the sound, encode H.264
 *
 * Raw files (webm per phone, fetched sounds, caption PNGs, transcript) stay in the test's output folder under the
 * config's outputDir. The mp4 goes to JOURNEY_OUT_FILE (set by scripts/record/run.mjs) or <output folder>/journey.mp4.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page, type TestInfo } from "@playwright/test";
import { CHAIN_CREW_KEY, waitLive, type JoinRole } from "../../helpers";
import { AUDIO_BINDING, AudioLog, audioHook, type AudioClip, type AudioEvent } from "./audio";
import { clock, composeJourney, type ComposeResult } from "./compose";
import { notificationHtml } from "./render";

export { expect };
export type { AudioClip };

/** Options the journeys config sets in `use` (playwright.journeys.config.ts). */
export interface JourneyOptions {
  /**
   * Pause multiplier. 1 = paced for a person watching (captions stay readable, taps are marked before they happen);
   * 0 = no pauses (a quick check that the journey still passes; the mp4 is then too fast to watch).
   */
  pace: number;
}

export interface Phone {
  /** the key given to kit.phones() */
  name: string;
  /** shown above this phone in the mp4 */
  label: string;
  context: BrowserContext;
  page: Page;
  /**
   * Join a demo session on this phone (POST /api/session/join, the /join form's request) and open `pathname`, or the
   * role's home page, with its event stream live. The recorded counterpart of helpers.joinAs.
   */
  join(code: string, role: JoinRole, pathname?: string): Promise<void>;
  /** page.goto + wait until the page's event stream is live (demo pages); use page.goto for pages without one */
  open(pathname: string): Promise<void>;
}

export interface Notification {
  /** take the banner away now (it also goes by itself after durationMs) */
  hide(): Promise<void>;
}

export interface JourneyResult {
  id: string;
  name: string;
  title: string;
  status: "passed" | "failed";
  file: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  sizeBytes: number | null;
  /** t: seconds into the mp4 (null when no mp4 was made) */
  steps: { n: number; text: string; phone: string; label: string; t: number | null }[];
  clips: { phone: string; src: string; t: number; duration: number }[];
  notifications: { phone: string; title: string; body: string; t: number | null }[];
  cornerLabel: string | null;
  sync: ComposeResult["sync"];
  warnings: string[];
  rawDir: string;
  error?: string;
}

const STAFF_ROLES: JoinRole[] = ["backstage", "director", "judge"];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, Math.round(ms))));

interface StepEntry {
  n: number;
  text: string;
  phone: string;
  label: string;
  wall: number;
}

interface PhoneInternal extends Phone {
  markWall: number;
  openedWall: number;
}

interface KitEnv {
  browser: Browser;
  testInfo: TestInfo;
  baseURL: string | undefined;
  viewport: { width: number; height: number };
  dsf: number;
  isMobile: boolean;
  hasTouch: boolean;
  locale: string | undefined;
  timezoneId: string | undefined;
  videoSize: { width: number; height: number };
  showActions: ShowActions | undefined;
  pace: number;
}

type ShowActions = NonNullable<NonNullable<BrowserContextOptions["recordVideo"]>["showActions"]>;

/** "07-ask.journey.ts" -> { id: "07", name: "ask" } */
export function journeyIdOf(file: string): { id: string; name: string } {
  const m = /^(\d{2})-([a-z0-9][a-z0-9-]*)\.journey\.ts$/.exec(path.basename(file));
  if (!m) throw new Error(`journey file name must be <编号>-<英文短名>.journey.ts, e.g. 07-ask.journey.ts (got ${path.basename(file)})`);
  return { id: m[1], name: m[2] };
}

export class Journey {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly rawDir: string;
  private readonly audio: AudioLog;
  private readonly phoneList: PhoneInternal[] = [];
  private readonly steps: StepEntry[] = [];
  private readonly notes: { phone: string; title: string; body: string; wall: number }[] = [];
  private readonly stepLog: string;
  private corner: string | null = null;
  private result: JourneyResult | null = null;

  constructor(private readonly env: KitEnv) {
    const { id, name } = journeyIdOf(env.testInfo.file);
    this.id = id;
    this.name = name;
    this.title = env.testInfo.title;
    this.rawDir = env.testInfo.outputDir;
    mkdirSync(path.join(this.rawDir, "audio"), { recursive: true });
    this.audio = new AudioLog(path.join(this.rawDir, "audio"));
    this.stepLog = path.join(this.rawDir, "steps.jsonl");
  }

  /**
   * Open recorded phones, one browser context each, in the order given (left to right in the mp4). Call once, before
   * the first step; then put each phone on its page (phone.join / phone.open).
   */
  async phones<K extends string>(labels: Record<K, string>): Promise<Record<K, Phone>> {
    if (this.phoneList.length) throw new Error("kit.phones() was already called: open all phones in one call");
    const entries = Object.entries(labels) as [K, string][];
    if (!entries.length) throw new Error("kit.phones() needs at least one phone");
    const opened = await Promise.all(entries.map(([name, label]) => this.openPhone(name, label)));
    this.phoneList.push(...opened);
    const byName = {} as Record<K, Phone>;
    entries.forEach(([name], i) => (byName[name] = opened[i]));
    return byName;
  }

  /**
   * One step of the journey: `text` becomes the caption from now until the next step (above the phones, the phone
   * `page` belongs to marked), is logged for the transcript, and stays up long enough to read before the action.
   */
  async step(page: Page, text: string): Promise<void> {
    const phone = this.phoneOf(page);
    const entry: StepEntry = { n: this.steps.length + 1, text, phone: phone.name, label: phone.label, wall: Date.now() };
    this.steps.push(entry);
    appendFileSync(this.stepLog, `${JSON.stringify(entry)}\n`);
    console.log(`  [${this.id}] ${entry.n}. (${phone.label}) ${text}`);
    const chars = [...text].length;
    await sleep(Math.min(4200, Math.max(1600, 1000 + 140 * chars)) * this.env.pace);
  }

  /** An extra pause, scaled by the pace (default 1 s). */
  async pause(ms = 1000): Promise<void> {
    await sleep(ms * this.env.pace);
  }

  /** Types `text` into a field one character at a time (so the video shows it being typed), then checks the value. */
  async type(field: Locator, text: string): Promise<void> {
    if (await field.inputValue()) await field.fill("");
    await field.pressSequentially(text, { delay: Math.round(110 * this.env.pace) });
    await expect(field).toHaveValue(text);
  }

  /** Scrolls `target` smoothly to the middle of its screen and lets the eye settle on it. */
  async show(target: Locator): Promise<void> {
    await target.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await sleep(900 * this.env.pace);
  }

  /**
   * Draws a phone-style notification banner at the top of `page` (it slides in, stays `durationMs`, slides out).
   * Drawn by the recorder only: no app code runs and nothing is sent. Use it where a push will arrive once push exists.
   */
  async showNotification(page: Page, n: { title: string; body: string; app?: string; time?: string; durationMs?: number }): Promise<Notification> {
    const phone = this.phoneOf(page);
    const durationMs = n.durationMs ?? Math.max(2500, 4500 * this.env.pace);
    const overlay = await page.screencast.showOverlay(notificationHtml({ ...n, durationMs }));
    this.notes.push({ phone: phone.name, title: n.title, body: n.body, wall: Date.now() });
    let gone = false;
    const hide = async () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      await overlay.dispose().catch(() => undefined);
    };
    const timer = setTimeout(() => void hide(), durationMs);
    return { hide };
  }

  /** A label in the top-right corner for the whole recording, e.g. "转写：测试替身". */
  cornerLabel(text: string): void {
    this.corner = text;
  }

  /**
   * Resolves once the app plays a sound whose URL contains `match` (until: "playing", the default), or once that
   * sound has stopped (until: "ended": the whole clip is then in the mp4). Fails after `timeout` ms.
   */
  async waitForAudio(match: string | RegExp, opts: { until?: "playing" | "ended"; timeout?: number } = {}): Promise<AudioClip> {
    return this.audio.wait(match, opts.until ?? "playing", opts.timeout ?? 15_000);
  }

  /** Every sound heard so far. */
  audioClips(): AudioClip[] {
    return [...this.audio.clips];
  }

  /**
   * The last line of every journey: hold the last screen a moment, close the phones, compose them (side by side when
   * there are two or more), mix in the sound, encode the mp4, write the transcript. Returns what was written.
   */
  async finish(): Promise<JourneyResult> {
    if (this.result) return this.result;
    if (!this.phoneList.length) throw new Error("finish(): no phones were opened (kit.phones)");
    if (!this.steps.length) throw new Error("finish(): the journey has no steps (kit.step)");
    await sleep(2000 * this.env.pace);
    const endWall = Date.now();
    this.audio.closeOpen(endWall);
    await this.audio.settle();
    for (const p of this.phoneList) await p.context.close();
    const phones = await Promise.all(
      this.phoneList.map(async (p) => {
        const video = p.page.video();
        if (!video) throw new Error(`${p.name}: no video (recordVideo missing)`);
        return { name: p.name, label: p.label, video: await video.path(), markWall: p.markWall, openedWall: p.openedWall };
      }),
    );
    const outFile = process.env.JOURNEY_OUT_FILE?.trim() || path.join(this.rawDir, "journey.mp4");
    if (existsSync(outFile)) throw new Error(`${outFile} already exists: one journey per file, and run.mjs picks a new number each run`);
    mkdirSync(path.dirname(outFile), { recursive: true });
    const work = path.join(this.rawDir, "compose");
    mkdirSync(work, { recursive: true });
    const composed = await composeJourney({
      browser: this.env.browser,
      workDir: work,
      outFile,
      kicker: this.title,
      phones,
      steps: this.steps,
      clips: this.audio.clips,
      cornerLabel: this.corner,
      endWall,
      viewport: this.env.viewport,
      dsf: this.env.dsf,
    });
    const startWall = this.steps[0].wall - composed.steps[0].t * 1000;
    this.result = {
      ...this.base("passed"),
      file: composed.file,
      duration: composed.duration,
      width: composed.width,
      height: composed.height,
      hasAudio: composed.hasAudio,
      sizeBytes: composed.sizeBytes,
      steps: composed.steps.map((c, i) => ({ ...c, label: this.steps[i].label })),
      clips: composed.clips,
      notifications: this.notes.map((n) => ({ phone: n.phone, title: n.title, body: n.body, t: Math.round(n.wall - startWall) / 1000 })),
      sync: composed.sync,
      warnings: [...composed.warnings, ...this.audio.errors],
    };
    this.writeResult(this.result);
    return this.result;
  }

  /** Fixture teardown: a journey that failed (or forgot finish) leaves its record too, without an mp4. */
  async teardown(): Promise<void> {
    for (const p of this.phoneList) await p.context.close().catch(() => undefined);
    const info = this.env.testInfo;
    if (this.result) return;
    const passed = info.status === "passed" || info.status === undefined;
    const error = passed
      ? "the journey ended without kit.finish(): make `await kit.finish()` its last line"
      : (info.errors[0]?.message ?? info.status ?? "failed").replace(/\u001b\[[0-9;]*m/g, "");
    this.writeResult({ ...this.base("failed"), error });
    if (passed) throw new Error(error);
  }

  private base(status: "passed" | "failed"): JourneyResult {
    return {
      id: this.id,
      name: this.name,
      title: this.title,
      status,
      file: null,
      duration: null,
      width: null,
      height: null,
      hasAudio: false,
      sizeBytes: null,
      steps: this.steps.map((s) => ({ n: s.n, text: s.text, phone: s.phone, label: s.label, t: null })),
      clips: [],
      notifications: this.notes.map((n) => ({ phone: n.phone, title: n.title, body: n.body, t: null })),
      cornerLabel: this.corner,
      sync: [],
      warnings: [...this.audio.errors],
      rawDir: this.rawDir,
    };
  }

  private writeResult(r: JourneyResult): void {
    const json = `${JSON.stringify(r, null, 1)}\n`;
    writeFileSync(path.join(this.rawDir, "journey.json"), json);
    const extra = process.env.JOURNEY_RESULT?.trim();
    if (extra) {
      mkdirSync(path.dirname(extra), { recursive: true });
      writeFileSync(extra, json);
    }
    const lines = [`# ${r.title}`, "", `状态：${r.status === "passed" ? "通过" : "没通过"}${r.file ? `　录屏：${r.file}` : ""}`, ""];
    for (const s of r.steps) lines.push(`${s.t === null ? "" : `${clock(s.t)}　`}${s.n}. ${s.text}`);
    if (r.error) lines.push("", `出错：${r.error}`);
    writeFileSync(path.join(this.rawDir, "transcript.md"), `${lines.join("\n")}\n`);
  }

  private phoneOf(page: Page): PhoneInternal {
    const phone = this.phoneList.find((p) => p.page === page);
    if (!phone) throw new Error("this page is not one of the kit's phones: open phones with kit.phones() and use phone.page");
    return phone;
  }

  private async openPhone(name: string, label: string): Promise<PhoneInternal> {
    const e = this.env;
    const context = await e.browser.newContext({
      baseURL: e.baseURL,
      viewport: e.viewport,
      deviceScaleFactor: e.dsf,
      isMobile: e.isMobile,
      hasTouch: e.hasTouch,
      locale: e.locale,
      timezoneId: e.timezoneId,
      recordVideo: {
        dir: path.join(this.rawDir, "video"),
        size: e.videoSize,
        ...(e.showActions && e.pace > 0 ? { showActions: e.showActions } : {}),
      },
    });
    await context.exposeBinding(AUDIO_BINDING, (source, ev: AudioEvent) => this.audio.onEvent(name, source.page, context, ev));
    await context.addInitScript(audioHook, AUDIO_BINDING);
    const page = await context.newPage();
    const openedWall = Date.now();
    // sync mark (compose.ts): let the blank page reach the video, paint it black once, note when
    await sleep(300);
    const markWall = await page.evaluate(() => {
      document.documentElement.style.background = "#000";
      return Date.now();
    });
    await sleep(200);
    const phone: PhoneInternal = {
      name,
      label,
      context,
      page,
      markWall,
      openedWall,
      join: async (code, role, pathname) => {
        const res = await context.request.post("/api/session/join", {
          data: { code, role },
          headers: STAFF_ROLES.includes(role) ? { "x-ripple-crew-key": CHAIN_CREW_KEY } : {},
        });
        expect(res.status(), `${label} joins as ${role}: ${await res.text()}`).toBe(200);
        const next = ((await res.json()) as { next: string }).next;
        await page.goto(pathname ?? next);
        await waitLive(page);
      },
      open: async (pathname) => {
        await page.goto(pathname);
        await waitLive(page);
      },
    };
    return phone;
  }
}

/** A journey: a Playwright test with the `kit` fixture. One journey per file (<编号>-<短名>.journey.ts). */
export const journey = base.extend<{ kit: Journey } & JourneyOptions>({
  pace: [1, { option: true }],
  // (the fixture callback is named `provide`, not `use`: the React hooks lint rule reads `use(...)` as a hook)
  kit: async ({ browser, baseURL, viewport, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, video, pace }, provide, testInfo) => {
    if (!viewport) throw new Error("journeys need a fixed phone viewport (playwright.journeys.config.ts)");
    const dsf = deviceScaleFactor ?? 1;
    const videoOpts = typeof video === "string" ? { mode: video, size: undefined, show: undefined } : video;
    if (videoOpts.mode !== "on") throw new Error("journeys need video: { mode: \"on\" } (run them with -c playwright.journeys.config.ts)");
    const kit = new Journey({
      browser,
      testInfo,
      baseURL,
      viewport,
      dsf,
      isMobile: !!isMobile,
      hasTouch: !!hasTouch,
      locale,
      timezoneId,
      videoSize: videoOpts.size ?? { width: viewport.width * dsf, height: viewport.height * dsf },
      showActions: videoOpts.show?.actions,
      pace: Number.isFinite(pace) ? Math.max(0, pace) : 1,
    });
    await provide(kit);
    await kit.teardown();
  },
});
