/**
 * Whisper on an account's visit page (C2 track F; real-app 2.13, 2.14), against a small fake Whisper service this spec
 * runs on 127.0.0.1:7896 (its GPU name tells the app is pointed at it; the real service is never used here):
 *   1. live captions from the service on his page (no ?session=: his sign-in names the scope); 录完了 sends the
 *      recording, the service's transcript becomes the review;
 *   2. the service is down from the start: the page says there are no captions this time, the recording goes on; at
 *      录完了 the recording is saved and waits for its text (the review says so, and he writes a line of his own:
 *      「先自己记一句」, kept as his note); once the service answers, the asr.pending job (run here through the developer
 *      tools' tick) makes the record, and 「看诊记录好了」 reaches his phone, once: its lock-screen words carry nothing of
 *      the visit, the tap lands on that visit's review (opened_at is kept), and the review has the lines and his note.
 *      The push service is the local stand-in of tests/support/push-service.ts (headless Chromium has none); what it
 *      opens goes to the phone's real service worker, as in e2e/journeys/02-push.journey.ts;
 *   3. the service stops mid-visit: the captions stop and say so, the recording goes on; the record keeps the live lines.
 *   4. (round three) the service takes the recording and fails it, every time: asr.pending sends it three times and no
 *      more, and the review says 「这段录音没能转成文字」 with the recording still there to listen to and his own line to
 *      write (real-app 2.14; lib/visit/transcript-tries.ts).
 * Round three also, in case 1: a Whisper transcript has no speakers, so a line with no cue is nobody's until he says:
 * the summary asks 「哪几句是你说的？」 and keeps his tap (real-app 2.15).
 * Skips unless the app server points at the fake, e.g.
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 WHISPER_TOKEN=<any test value, 43+ chars> \
 *     node scripts/record/serve.mjs --port 3561 --detach      then   PW_PORT=3561 npx playwright test e2e/f-account-whisper.spec.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { VisitView } from "../lib/visit/types";
import { encodeWav } from "../lib/visit/wav";
import { startPushService } from "../tests/support/push-service";
import { expectPageChecks } from "./_checks/page-checks";
import { BASE_URL, CHAIN_CREW_KEY, waitLive } from "./helpers";
import { deliverToServiceWorker, listenForShownPushes, stubPushSubscription, tapNotification } from "./push-helpers";

const FAKE_PORT = 7896;
const FAKE_GPU = "Fake GPU (track F account e2e)";
const CREW = { "x-ripple-crew-key": CHAIN_CREW_KEY };
const LIVE_TEXT = "At home, we want it below 135 over 85.";
const FILE_LINES = [
  { start_ms: 49_520, end_ms: 52_981, text: "At home, we want it below 135 over 85." },
  { start_ms: 55_300, end_ms: 67_000, text: "If your reading at home is above 180 on top, or you get chest pain, go to A&E or call 995." },
  // no cue of who is speaking, and nothing to note: nobody's line until he says (「哪几句是你说的？」)
  { start_ms: 68_200, end_ms: 70_000, text: "Okay, I will write that down." },
];
const UNCLEAR_LINE = FILE_LINES[2].text;

class FakeWhisper {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  chunks = 0;
  files = 0;
  private jobs = 0;
  /** every whole-recording job is taken and then fails (a recording the service cannot turn into text) */
  failJobs = false;

  get up(): boolean {
    return this.server !== null;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => this.handle(req, res));
    server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(FAKE_PORT, "127.0.0.1", () => resolve());
    });
    this.server = server;
  }

  /** the service goes away: connections are refused */
  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://fake");
    const auth = req.headers.authorization;
    if (url.pathname === "/health") {
      return send(200, {
        status: "ready",
        ready: true,
        healthy: true,
        device: "cuda",
        models: { live: "large-v3-turbo", file: "large-v3" },
        gpu: { name: FAKE_GPU },
        ...(auth !== undefined ? { token_ok: true } : {}),
      });
    }
    if (!(auth ?? "").startsWith("Bearer ")) return send(401, { error: "unauthorized" });
    let n = 0;
    req.on("data", (c: Buffer) => (n += c.length));
    req.on("end", () => {
      if (url.pathname === "/v1/chunk") {
        this.chunks += 1;
        const dur = Math.max(200, Math.round(((n - 44) / 32_000) * 1000));
        return send(200, { text: LIVE_TEXT, lang: "en", segments: [{ start_ms: 100, end_ms: dur - 100, text: LIVE_TEXT, lang: "en", confidence: "high" }], duration_ms: dur, model: "fake-turbo", elapsed_ms: 5 });
      }
      if (url.pathname === "/v1/file") {
        this.files += 1;
        return send(202, { job_id: `fakefjob${String(++this.jobs).padStart(6, "0")}`, status: "queued", eta_ms: 300, model: "fake-large" });
      }
      if (url.pathname.startsWith("/v1/jobs/")) {
        if (req.method === "DELETE") return send(200, { deleted: true });
        if (this.failJobs) return send(200, { status: "failed", error: "decode_failed", model: "fake-large" });
        return send(200, { status: "done", model: "fake-large", segments: FILE_LINES.map((l, i) => ({ ...l, lang: "en", region: i, confidence: "high" })) });
      }
      send(404, { error: "not_found" });
    });
  }
}

/** A voice-like WAV for the fake microphone: 2.2 s bursts with 0.8 s pauses (the segmenter cuts lines at the pauses). */
function voiceWav(file: string, seconds = 60): void {
  const sr = 16_000;
  const out = new Float32Array(sr * seconds);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const inBurst = t > 1 && (t - 1) % 3 < 2.2;
    out[i] = inBurst ? 0.2 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 180 * t) : 0.0005 * Math.sin(i);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodeWav(out, sr));
}

const fake = new FakeWhisper();
let configured = false;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  try {
    await fake.start();
  } catch {
    return; // the port is taken: not our setup
  }
  try {
    const h = (await (await request.get("/api/asr/health", { headers: CREW })).json()) as { provider: string; whisper?: { gpu?: unknown } };
    const gpu = h.whisper?.gpu as { name?: string } | string | undefined;
    configured = h.provider === "whisper" && (gpu === FAKE_GPU || (typeof gpu === "object" && gpu?.name === FAKE_GPU));
  } finally {
    await fake.stop();
  }
});
test.afterAll(async () => {
  await fake.stop();
});

/**
 * His phone: a browser with the fake microphone, a new blank test account signed in on it, /p/visit open.
 * `notifications`: the new headless Chromium (a service worker may show notifications there) with the permission given;
 * `init` runs on the context before its first page (the push subscription's stand-in, the shown-notice hook).
 */
async function hisPhone(outputDir: string, opts: { notifications?: boolean; init?: (context: BrowserContext) => Promise<void> } = {}): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const wav = path.join(outputDir, "f-account-whisper-voice.wav");
  voiceWav(wav);
  const browser = await chromium.launch({
    ...(opts.notifications ? { channel: "chromium" } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`],
  });
  const context = await browser.newContext({ baseURL: BASE_URL, permissions: ["microphone"], viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
  if (opts.notifications) await context.grantPermissions(["microphone", "notifications"], { origin: new URL(BASE_URL).origin });
  if (opts.init) await opts.init(context);
  const login = `fw${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const res = await context.request.post("/api/dev/accounts", { data: { login, password: "a long test password", space: "blank", display_name: "陈先生", locale: "zh-Hans" } });
  expect(res.status(), await res.text()).toBe(201);
  const page = await context.newPage();
  await page.goto("/p/visit");
  await waitLive(page);
  return { browser, context, page };
}

async function startRecording(page: Page): Promise<string> {
  // track V: a blank account's list is empty (「开始」); between where and the card, 「直接开始」
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  return (await live.getAttribute("data-visit"))!;
}

async function visitView(context: BrowserContext, visitId: string): Promise<VisitView> {
  const res = await context.request.get(`/api/visits/${visitId}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { view: VisitView }).view;
}

test("live captions from the service on his page; 录完了 gives the service's transcript and the review", async ({}, testInfo) => {
  test.skip(!configured, "start the app with SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 (a test token) and RIPPLE_DEV_TOOLS=1");
  test.setTimeout(120_000);
  await fake.start();
  const { browser, context, page } = await hisPhone(testInfo.outputDir);
  try {
    const chunkRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/asr/chunk")) chunkRequests.push(r.url());
    });
    const visitId = await startRecording(page);
    await expect(page.getByTestId("visit-captions")).toContainText("135 over 85", { timeout: 30_000 });
    // his sign-in names the scope: the live client sends no session
    expect(chunkRequests.length).toBeGreaterThan(0);
    for (const u of chunkRequests) expect(new URL(u).searchParams.has("session")).toBe(false);
    await expect.poll(async () => Number(await page.getByTestId("visit-noted").getAttribute("data-count")), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
    await expect(page.getByTestId("review-queue")).toBeVisible();
    const view = await visitView(context, visitId);
    expect(view.visit.status).toBe("review");
    expect(view.lines.map((l) => [l.tStartMs, l.text])).toEqual(FILE_LINES.map((l) => [l.start_ms, l.text]));
    expect(fake.files).toBe(1);

    // ---- round three (real-app 2.15): a Whisper transcript has no speakers. The lines with a clinician's cue are asked
    // one by one; the line with none is nobody's, and the summary asks whether it was his
    expect(view.lines.find((l) => l.text === UNCLEAR_LINE)).toMatchObject({ role: "unknown", roleState: "unknown" });
    for (let i = 0; i < 6 && (await page.getByTestId("review-queue").count()) > 0; i++) {
      const n = await page.getByTestId("review-queue").getAttribute("data-pending");
      await expect(page.getByTestId("review-one")).not.toContainText(UNCLEAR_LINE);
      await page.getByTestId("review-yes").click();
      await expect.poll(async () => (await page.getByTestId("review-summary").count()) > 0 || (await page.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== n).toBe(true);
    }
    await expect(page.getByTestId("review-summary")).toBeVisible();
    const mineSection = page.getByTestId("review-mine");
    await expect(mineSection).toHaveAttribute("data-count", "1");
    await expect(mineSection).toContainText("哪几句是你说的？");
    const row = page.getByTestId("review-mine-row");
    await expect(row).toContainText(UNCLEAR_LINE);
    await expect(row).toHaveAttribute("data-mine", "false");
    await expect(row).toContainText("没听出是谁说的");
    await page.waitForTimeout(400);
    if (process.env.F_SHOTS_DIR?.trim()) await page.screenshot({ path: path.join(process.env.F_SHOTS_DIR.trim(), "r3-review-mine.png"), fullPage: true });
    await expectPageChecks(page, { side: "elder" });
    // one tap, saved as he taps; a slip is taken back the same way
    await page.getByTestId("review-mine-toggle").click();
    await expect(row).toHaveAttribute("data-mine", "true");
    await expect(row).toContainText("你说的");
    expect((await visitView(context, visitId)).lines.find((l) => l.text === UNCLEAR_LINE)).toMatchObject({ role: "patient", roleState: "confirmed" });
    await page.getByTestId("review-mine-toggle").click();
    await expect(row).toHaveAttribute("data-mine", "false");
    expect((await visitView(context, visitId)).lines.find((l) => l.text === UNCLEAR_LINE)).toMatchObject({ role: "unknown", roleState: "unknown" });
    await page.getByTestId("review-mine-toggle").click();
    await expect(row).toHaveAttribute("data-mine", "true");
    await page.waitForTimeout(400);
    await expectPageChecks(page, { side: "elder" });
    await page.getByTestId("review-save").click();
    await expect(page.getByTestId("review-summary")).toHaveAttribute("data-status", "confirmed");
    const after = await visitView(context, visitId);
    expect(after.lines.find((l) => l.text === UNCLEAR_LINE)).toMatchObject({ role: "patient", roleState: "confirmed" });
    // the doctor's lines stay the doctor's: marking his own line changed nothing else
    expect(after.lines.filter((l) => l.role === "doctor" && l.roleState === "confirmed")).toHaveLength(2);
    // nothing is left to ask about
    await expect(page.getByTestId("review-mine")).toHaveCount(0);
  } finally {
    await context.close();
    await browser.close();
    await fake.stop();
  }
});

test("the service down from the start: no captions (said so); the recording waits and he writes his own line; once the service answers asr.pending makes the record and 看诊记录好了 reaches his phone, the tap lands on the review", async ({ request }, testInfo) => {
  test.skip(!configured, "start the app with SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 (a test token) and RIPPLE_DEV_TOOLS=1");
  test.setTimeout(180_000);
  await fake.stop();
  const service = await startPushService();
  const sub = service.newPhone({ label: "his phone" });
  let hub: Awaited<ReturnType<typeof listenForShownPushes>> | null = null;
  const { browser, context, page } = await hisPhone(testInfo.outputDir, {
    notifications: true,
    init: async (c) => {
      await stubPushSubscription(c, sub);
      hub = await listenForShownPushes(c);
    },
  });
  try {
    // his phone gets Ripple's notifications: the app's own service worker, his subscription kept by the server
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    const subscribed = await context.request.post("/api/push/subscribe", { data: { endpoint: sub.endpoint, keys: sub.keys, welcome: false } });
    expect(subscribed.status(), await subscribed.text()).toBe(201);
    // what the push service opens goes to the phone's service worker, as a real push would
    const delivered: string[] = [];
    service.onMessage(async (m) => {
      if (!m.text) return;
      delivered.push(m.text);
      const open = context.pages().find((p) => !p.isClosed() && p.url().startsWith(BASE_URL)) ?? page;
      await deliverToServiceWorker(open, m.text);
    });

    const visitId = await startRecording(page);
    await expect(page.getByTestId("visit-notice")).toContainText("转写服务现在没有回应", { timeout: 15_000 });
    await expect(page.getByTestId("visit-captions")).toHaveCount(0);
    await page.waitForTimeout(4000);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
    const waiting = page.getByTestId("review-awaiting");
    await expect(waiting).toBeVisible();
    await expect(waiting).toHaveAttribute("data-transcript", "waiting");
    expect((await visitView(context, visitId)).visit.status).toBe("awaiting_transcript");

    // 「先自己记一句」: his own line while it waits, kept as his note and shown as his
    const OWN = "医生说两个星期后再来";
    await page.getByTestId("review-own-note-input").fill(OWN);
    await page.getByTestId("review-own-note-save").click();
    const mine = page.getByTestId("review-own-note");
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText(OWN);
    await expect(mine).toContainText("本人记的");
    await expect(page.getByTestId("review-own-note-input")).toHaveValue("");
    await page.waitForTimeout(400);
    if (process.env.F_SHOTS_DIR?.trim()) await page.screenshot({ path: path.join(process.env.F_SHOTS_DIR.trim(), "r2-review-awaiting-own-note.png"), fullPage: true });
    await expectPageChecks(page, { side: "elder" });
    const notes = (await (await context.request.get("/api/notes")).json()) as { notes: { text: string; source: string }[] };
    expect(notes.notes).toContainEqual(expect.objectContaining({ text: OWN, source: "typed" }));
    // nothing was pushed while it waits
    expect(delivered).toEqual([]);

    // the service is back: the pending-transcripts job sends the saved recording, then makes the record and tells him
    await page.goto("/p/today");
    const since = Date.now();
    const pushed = service.next(sub.id, 45_000);
    await fake.start();
    await expect
      .poll(
        async () => {
          await request.post("/api/dev/tick", { data: { names: ["asr.pending"] } });
          return (await visitView(context, visitId)).visit.status;
        },
        { timeout: 30_000, intervals: [300] },
      )
      .toBe("review");
    const m = await pushed;
    const tag = `visit-ready-${visitId}`;
    expect(m).toMatchObject({ status: 201, problem: null });
    expect(m.payload).toMatchObject({ v: 1, kind: "visit_ready", title: "看诊记录好了", body: "回来认一认。", url: `/p/visit/${visitId}/review`, tag, renotify: false, lang: "zh-Hans" });
    expect(typeof m.payload?.delivery).toBe("string");
    // the lock screen carries nothing of the visit: no line of it, no reading, no number (the words, not the ids)
    const lockScreen = `${String(m.payload?.title)} ${String(m.payload?.body)}`;
    expect(lockScreen).not.toMatch(/\d|below|chest|A&E|pressure|tablet/i);
    for (const l of FILE_LINES) expect(m.text ?? "").not.toContain(l.text);
    const shown = await hub!.next({ since, timeoutMs: 20_000 });
    expect(shown).toMatchObject({ title: "看诊记录好了", body: "回来认一认。", url: `/p/visit/${visitId}/review`, tag, kind: "visit_ready", shown: true });

    // a later pass sends nothing more for this visit
    await request.post("/api/dev/tick", { data: { names: ["asr.pending"] } });
    await request.post("/api/dev/tick", { data: { names: ["asr.pending"] } });
    await page.waitForTimeout(800);
    expect(delivered).toHaveLength(1);
    const recentBefore = ((await (await context.request.get("/api/push")).json()) as { recent: { kind: string; opened_at: string | null }[] }).recent.filter((r) => r.kind === "visit_ready");
    expect(recentBefore).toHaveLength(1);
    expect(recentBefore[0].opened_at).toBeNull();

    // he taps it: that visit's review opens, and the tap is kept (opened_at)
    await tapNotification(context, tag);
    const reviewUrl = new RegExp(`/p/visit/${visitId}/review$`);
    await expect.poll(() => context.pages().some((p) => !p.isClosed() && reviewUrl.test(p.url())), { timeout: 20_000 }).toBe(true);
    const review = context.pages().find((p) => !p.isClosed() && reviewUrl.test(p.url()))!;
    await expect(review.getByTestId("review-queue")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => ((await (await context.request.get("/api/push")).json()) as { recent: { kind: string; opened_at: string | null }[] }).recent.find((r) => r.kind === "visit_ready")?.opened_at ?? null, { timeout: 10_000 })
      .not.toBeNull();
    const view = await visitView(context, visitId);
    expect(view.lines.map((l) => l.text)).toEqual(FILE_LINES.map((l) => l.text));
    expect(view.account?.ownNotes.map((n) => n.text)).toEqual([OWN]);

    // the record is checked line by line; his own line stays on that visit as his, never among the doctor's
    for (let i = 0; i < 6 && (await review.getByTestId("review-queue").count()) > 0; i++) {
      const n = await review.getByTestId("review-queue").getAttribute("data-pending");
      await expect(review.getByTestId("review-one")).not.toContainText(OWN);
      await review.getByTestId("review-yes").click();
      await expect.poll(async () => (await review.getByTestId("review-summary").count()) > 0 || (await review.getByTestId("review-queue").getAttribute("data-pending", { timeout: 500 }).catch(() => null)) !== n).toBe(true);
    }
    await expect(review.getByTestId("review-summary")).toBeVisible();
    await expect(review.getByTestId("review-own-note")).toContainText(OWN);
    await expect(review.getByTestId("review-own-note")).toContainText("本人记的");
    for (const row of await review.getByTestId("review-row").all()) await expect(row).not.toContainText(OWN);
    await review.waitForTimeout(400);
    if (process.env.F_SHOTS_DIR?.trim()) await review.screenshot({ path: path.join(process.env.F_SHOTS_DIR.trim(), "r2-review-summary-own-note.png"), fullPage: true });
    await expectPageChecks(review, { side: "elder" });
  } finally {
    await context.close();
    await browser.close();
    await fake.stop();
    await service.close();
  }
});

test("the service stops mid-visit: the captions stop and say so, the recording goes on; the record keeps the live lines", async ({}, testInfo) => {
  test.skip(!configured, "start the app with SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 (a test token) and RIPPLE_DEV_TOOLS=1");
  test.setTimeout(120_000);
  await fake.start();
  const { browser, context, page } = await hisPhone(testInfo.outputDir);
  try {
    const visitId = await startRecording(page);
    await expect(page.getByTestId("visit-captions")).toContainText("135 over 85", { timeout: 30_000 });
    await expect.poll(async () => (await visitView(context, visitId)).lines.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await fake.stop();
    await expect(page.getByTestId("visit-notice")).toContainText("字幕停了", { timeout: 20_000 });
    await expect(page.getByTestId("visit-live")).toHaveAttribute("data-mode", "record");
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
    await expect(page.getByTestId("review-queue")).toBeVisible();
    const view = await visitView(context, visitId);
    expect(view.lines.length).toBeGreaterThan(0);
    expect(view.lines.every((l) => l.id.startsWith(`${visitId}-w`))).toBe(true);
    expect(view.lines.every((l) => l.text === LIVE_TEXT)).toBe(true);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("the service takes the recording and fails it every time: sent three times and no more; the review says the text could not be made, the recording is still his", async ({ request }, testInfo) => {
  test.skip(!configured, "start the app with SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 (a test token) and RIPPLE_DEV_TOOLS=1");
  test.setTimeout(240_000);
  await fake.stop();
  const { browser, context, page } = await hisPhone(testInfo.outputDir);
  try {
    // the service is down while he records: the recording is saved and waits
    const visitId = await startRecording(page);
    await expect(page.getByTestId("visit-notice")).toContainText("转写服务现在没有回应", { timeout: 15_000 });
    await page.waitForTimeout(4000);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 60_000 });
    await expect(page.getByTestId("review-awaiting")).toHaveAttribute("data-transcript", "waiting");
    // while it waits, his visit list and Today say the recording is saved and waits (track V's rows)
    await page.goto("/p/visit");
    const waitingRow = page.locator(`[data-testid="visit-unfinished-row"]:has(a[href="/p/visit/${visitId}/review"])`);
    await expect(waitingRow).toContainText("录音已存，等转写");
    await expect(waitingRow).not.toHaveAttribute("data-failed", "true");

    // the service is back, takes the recording and fails it, again and again
    fake.failJobs = true;
    fake.files = 0;
    await fake.start();
    await page.goto("/p/today");
    await expect(page.getByTestId("today-visit-waiting")).toContainText("录音已存，等转写");
    await expect
      .poll(
        async () => {
          await request.post("/api/dev/tick", { data: { names: ["asr.pending"] } });
          return (await visitView(context, visitId)).account?.transcript ?? null;
        },
        { timeout: 150_000, intervals: [500] },
      )
      .toBe("failed");
    // exactly the allowed number of submissions, and none after that
    expect(fake.files).toBe(3);
    for (let i = 0; i < 3; i++) await request.post("/api/dev/tick", { data: { names: ["asr.pending"] } });
    await page.waitForTimeout(1500);
    expect(fake.files).toBe(3);
    const view = await visitView(context, visitId);
    expect(view.visit.status).toBe("awaiting_transcript");
    expect(view.visit.audioPath).toBeTruthy();
    expect(view.lines).toEqual([]);

    // the same words where he finds this visit again (real-app 2.14; track V's rows, track F's count of the attempts):
    // Today's row, and the row of the visit list, which opens that visit's review
    await page.goto("/p/today");
    const todayRow = page.getByTestId("today-visit-waiting");
    await expect(todayRow).toHaveAttribute("data-failed", "1");
    await expect(todayRow).toContainText("录音没能转成文字");
    await expect(todayRow).not.toContainText("等转写");
    await page.goto("/p/visit");
    const failedRow = page.locator(`[data-testid="visit-unfinished-row"]:has(a[href="/p/visit/${visitId}/review"])`);
    await expect(failedRow).toHaveAttribute("data-failed", "true");
    await expect(failedRow).toContainText("录音没能转成文字");
    await expect(failedRow).not.toContainText("等转写");
    await page.waitForTimeout(400);
    if (process.env.F_SHOTS_DIR?.trim()) await page.screenshot({ path: path.join(process.env.F_SHOTS_DIR.trim(), "r3-visit-list-transcript-failed.png"), fullPage: true });
    await expectPageChecks(page, { side: "elder" });
    await failedRow.locator("a").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`));

    // the review: the text could not be made; the recording is there to listen to; he can write his own line
    const failed = page.getByTestId("review-awaiting");
    await expect(failed).toHaveAttribute("data-transcript", "failed");
    await expect(failed).toContainText("这段录音没能转成文字。");
    await expect(failed).toContainText("还在，可以听，也可以自己记一句。");
    await expect(failed).not.toContainText("还没有文字");
    // the recording is there to listen to (the bar's player, and the hidden one that reads its length)
    await expect(failed.locator("audio").first()).toBeAttached();
    await expect(failed).toContainText("听录音");
    const OWN = "医生让我少吃盐";
    await page.getByTestId("review-own-note-input").fill(OWN);
    await page.getByTestId("review-own-note-save").click();
    await expect(page.getByTestId("review-own-note")).toContainText(OWN);
    await expect(page.getByTestId("review-own-note")).toContainText("本人记的");
    await page.waitForTimeout(400);
    if (process.env.F_SHOTS_DIR?.trim()) await page.screenshot({ path: path.join(process.env.F_SHOTS_DIR.trim(), "r3-review-transcript-failed.png"), fullPage: true });
    await expectPageChecks(page, { side: "elder" });
    // never the script, never a made-up record: nothing was noted for this visit, and nothing was pushed about it
    const recent = ((await (await context.request.get("/api/push")).json()) as { recent: { kind: string }[] }).recent.filter((r) => r.kind === "visit_ready");
    expect(recent).toEqual([]);
  } finally {
    fake.failJobs = false;
    await context.close();
    await browser.close();
    await fake.stop();
  }
});
