/**
 * M14 fallback and reliability: when the Whisper service does not answer, the visit screen says so and switches
 * to the replay, backstage shows asr.fallback once, and nothing is lost silently.
 *   1. the service is down when the visit starts;
 *   2. the service answers (live captions from it), then dies mid-visit;
 *   3. the web app's token is wrong: found at the start, said as a configuration problem;
 *   4. the service stays busy (its live queue full): captions are said to be late, then the visit falls back
 *      (reason busy) with a bounded number of calls to the service;
 *   5. the service hangs mid-visit (accepts connections, never answers): the switch is quick;
 *   6. the upload fails at End visit: tapping End again sends the same recording; the record is this visit's
 *      own transcript, never the script;
 *   7. the whole-recording transcript is stuck: End visit says why and offers "Keep the live captions";
 *   8. the recording is refused as too large (413): the record keeps the live captions;
 *   B3. the service restarts while it makes the record (its job is gone: 404, then it loads again): the job waits
 *       (awaiting_transcript), sends the recording again, and the record is the whole-recording transcript;
 *   + a page reopened while its visit is transcribing waits for the job and finishes the visit (no dead end).
 * The "service" is a small fake HTTP server this spec runs on 127.0.0.1:7899, so it can be changed at will.
 * The server must be started pointing at it, otherwise these tests skip:
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7899 PW_PORT=3212 npx playwright test e2e/m14-fallback.spec.ts
 * 1-8 need the replay fallback on (ASR_REPLAY_FALLBACK unset or on, the demo). With it off (real mode), run again:
 *   ASR_REPLAY_FALLBACK=off SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7899 PW_PORT=3212 npx playwright test e2e/m14-fallback.spec.ts
 *   9. the service is down for the whole visit: no replay, the recording is saved, End visit says so (not a bare
 *      "try again"), asr.fallback once for the record however often End is tapped, and the page makes the
 *      record by itself once the service answers again.
 * Also (any provider): the chunk route never takes WebM.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { DEV_ONLY_CREW_KEY } from "../lib/visit/crew";
import { vt } from "../lib/visit/strings";
import { encodeWav } from "../lib/visit/wav";
import { BASE_URL, closeAll, createSession, openCrewDevice, waitLive } from "./helpers";

const FAKE_PORT = 7899;
const FAKE_GPU = "Fake GPU (m14 e2e)";
const CREW = { "x-ripple-crew-key": DEV_ONLY_CREW_KEY };
const FILE_TEXT = "Hello from the fake file job.";

type Mode = "up" | "busy" | "hang" | "wrong_token";
type FileMode = "ok" | "stuck" | "too_large" | "restart";

class FakeWhisper {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  mode: Mode = "up";
  fileMode: FileMode = "ok";
  chunks = 0;
  /** /v1/chunk calls while busy */
  busyCalls = 0;
  files = 0;
  private jobs = 0;
  /** fileMode "restart": until when the restarted service is still loading its models (0 = not restarted yet) */
  private loadingUntil = 0;
  restarted = false;

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

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  reset(): void {
    this.mode = "up";
    this.fileMode = "ok";
    this.chunks = 0;
    this.busyCalls = 0;
    this.files = 0;
    this.loadingUntil = 0;
    this.restarted = false;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    // a hung service: the connection is accepted, nothing ever comes back (health included)
    if (this.mode === "hang") return;
    const url = new URL(req.url ?? "/", "http://fake");
    const auth = req.headers.authorization;
    // fileMode "restart": right after the restart the models load again (health says loading, work answers 503)
    if (Date.now() < this.loadingUntil) {
      if (url.pathname === "/health") return send(200, { status: "loading", ready: false, healthy: false, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, gpu: { name: FAKE_GPU } });
      return send(503, { error: "loading" }, { "retry-after": "5" });
    }
    if (url.pathname === "/health") {
      send(200, {
        status: "ready",
        ready: true,
        healthy: true,
        device: "cuda",
        models: { live: "large-v3-turbo", file: "large-v3" },
        gpu: { name: FAKE_GPU },
        ...(auth !== undefined ? { token_ok: this.mode !== "wrong_token" } : {}),
      });
      return;
    }
    if (!(auth ?? "").startsWith("Bearer ") || this.mode === "wrong_token") return send(401, { error: "unauthorized" });
    let n = 0;
    req.on("data", (c: Buffer) => (n += c.length));
    req.on("end", () => {
      if (url.pathname === "/v1/chunk") {
        this.chunks += 1;
        if (this.mode === "busy") {
          this.busyCalls += 1;
          return send(503, { error: "busy" }, { "retry-after": "1" });
        }
        const dur = Math.max(200, Math.round(((n - 44) / 32_000) * 1000));
        const text = "Hello from the fake service.";
        send(200, { text, lang: "en", segments: [{ start_ms: 100, end_ms: dur - 100, text, lang: "en", confidence: "high" }], duration_ms: dur, model: "fake-turbo", elapsed_ms: 5 });
        return;
      }
      if (url.pathname === "/v1/file") {
        this.files += 1;
        if (this.fileMode === "too_large") return send(413, { error: "too_large" });
        return send(202, { job_id: `fakejob${String(++this.jobs).padStart(6, "0")}`, status: "queued", eta_ms: 500, model: "fake-large" });
      }
      if (url.pathname.startsWith("/v1/jobs/")) {
        if (req.method === "DELETE") return send(200, { deleted: true });
        if (this.fileMode === "restart" && !this.restarted) {
          // the service restarted with this job in it: it no longer knows the job, and loads for 3 s
          this.restarted = true;
          this.loadingUntil = Date.now() + 3000;
          return send(404, { error: "job_not_found" });
        }
        if (this.fileMode === "stuck") return send(200, { status: "running", progress: { done: 1, total: 9 } });
        return send(200, {
          status: "done",
          model: "fake-large",
          segments: [{ start_ms: 1500, end_ms: 3600, text: FILE_TEXT, lang: "en", region: 0, confidence: "high" }],
        });
      }
      send(404, { error: "not_found" });
    });
  }
}

/** A voice-like WAV (speech bursts with pauses) for the fake microphone. */
function voiceWav(file: string, seconds = 90): void {
  const sr = 16_000;
  const out = new Float32Array(sr * seconds);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const inBurst = t > 1.5 && (t - 1.5) % 3 < 2.2; // 2.2 s of "speech", 0.8 s pause
    out[i] = inBurst ? 0.2 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t)) * Math.sin(2 * Math.PI * 180 * t) : 0.0005 * Math.sin(i);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodeWav(out, sr));
}

const fake = new FakeWhisper();
let configured = false;
/** ASR_REPLAY_FALLBACK of the server (crew health) */
let replayOn = true;
const NEEDS_REPLAY_ON = "start the server with SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7899 (ASR_REPLAY_FALLBACK on)";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  try {
    await fake.start();
  } catch {
    return; // the port is taken: not our setup
  }
  try {
    const h = (await (await request.get("/api/asr/health", { headers: CREW })).json()) as { provider: string; whisper?: { gpu?: string; replay_fallback?: boolean } };
    configured = h.provider === "whisper" && h.whisper?.gpu === FAKE_GPU;
    replayOn = h.whisper?.replay_fallback !== false;
  } finally {
    await fake.stop();
  }
});
test.afterAll(async () => {
  await fake.stop();
});
test.beforeEach(() => fake.reset());

const fallbackRows = (page: Page) => page.locator('[data-testid="event-row"][data-type="asr.fallback"]');
const REPLAY_NOTICE = "实时转写没有响应，这一屏改用示例回放。";
const DELAYED_NOTICE = "实时字幕慢了一点，录音照常进行。";

async function phoneWithMic(browser: Browser, sessionId: string, pathname: string) {
  const context = await browser.newContext({ baseURL: BASE_URL, permissions: ["microphone"] });
  await context.addCookies([{ name: "rp_session", value: sessionId, url: BASE_URL }]);
  const page = await context.newPage();
  const audioTypes: string[] = [];
  page.on("request", (r) => {
    const ct = r.headers()["content-type"] ?? "";
    if (ct.startsWith("audio/") || ct.startsWith("video/")) audioTypes.push(ct);
  });
  await page.goto(pathname);
  await waitLive(page);
  return { context, page, audioTypes };
}

/** A recording visit with live captions from the fake service: browser with the fake voice, backstage open. */
async function liveVisit(request: Parameters<typeof createSession>[0], outputDir: string) {
  const wav = path.join(outputDir, "m14-fake-voice.wav");
  voiceWav(wav);
  await fake.start();
  const s = await createSession(request, { story_day: 0 });
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`] });
  const deskBrowser = await chromium.launch();
  const desk = await openCrewDevice(deskBrowser, s.id, "/backstage");
  const phone = await phoneWithMic(browser, s.id, "/p/visit?speed=10");
  await phone.page.getByTestId("consent-yes").click();
  await expect(phone.page.getByTestId("visit-screen")).toBeVisible();
  const whisperLine = phone.page.locator('[data-testid^="line-v1-w"][data-partial="false"]').first();
  await expect(whisperLine).toBeVisible({ timeout: 30_000 });
  await expect(whisperLine).toContainText("Hello from the fake service.");
  const close = async () => {
    await fake.stop();
    await phone.context.close().catch(() => undefined);
    await closeAll([desk]).catch(() => undefined);
    await browser.close();
    await deskBrowser.close();
  };
  return { s, phone, desk, close };
}

async function visitLines(request: Parameters<typeof createSession>[0], sessionId: string) {
  const view = (await (await request.get(`/api/visits/v1?session=${sessionId}`)).json()).view as { lines: { id: string; text: string; clip?: { path?: string | null } | null }[] };
  return view.lines;
}

test("service down when the visit starts: the replay runs, the screen says so, backstage shows asr.fallback", async ({ request }) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(150_000);
  await fake.stop();
  const s = await createSession(request, { story_day: 0 });
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const desk = await openCrewDevice(browser, s.id, "/backstage");
  try {
    const phone = await phoneWithMic(browser, s.id, "/p/visit?speed=10");
    await phone.page.getByTestId("consent-yes").click();
    await expect(phone.page.getByTestId("visit-screen")).toBeVisible();
    await expect(phone.page.getByTestId("visit-notice")).toHaveText(REPLAY_NOTICE, { timeout: 15_000 });
    // the replay carries the visit: D0 lines and cards
    await expect(phone.page.getByTestId("line-v1-u03")).toBeVisible({ timeout: 30_000 });
    await expect(fallbackRows(desk.page)).toHaveCount(1, { timeout: 10_000 });
    const row = fallbackRows(desk.page).first();
    await expect(row).toHaveAttribute("data-tone", "fallback");
    await expect(row.getByTestId("event-badge")).toHaveText("Replay fallback");
    await expect(row.getByTestId("event-sentence")).toContainText("did not answer, so the visit screen uses the recorded replay (unreachable)");
    // end the visit: the recording is still a WAV, the record follows the replay, review opens
    const upload = phone.page.waitForRequest((r) => r.url().includes("/api/blob/upload") && r.method() === "PUT");
    await phone.page.getByTestId("visit-end").click();
    expect((await upload).headers()["content-type"]).toBe("audio/wav");
    await phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 60_000 });
    expect(phone.audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
    await expect(fallbackRows(desk.page)).toHaveCount(1); // once per visit
    await phone.context.close();
  } finally {
    await closeAll([desk]);
    await browser.close();
  }
});

test("service dies mid-visit: live captions stop, the replay takes over, asr.fallback once", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    expect(fake.chunks).toBeGreaterThan(0);
    await expect(fallbackRows(v.desk.page)).toHaveCount(0);
    // the service dies
    await fake.stop();
    await expect(v.phone.page.getByTestId("visit-notice")).toHaveText(REPLAY_NOTICE, { timeout: 20_000 });
    await expect(v.phone.page.getByTestId("line-v1-u03")).toBeVisible({ timeout: 30_000 });
    await expect(fallbackRows(v.desk.page)).toHaveCount(1, { timeout: 10_000 });
    await expect(fallbackRows(v.desk.page).first().getByTestId("event-sentence")).toContainText("stopped answering during the visit");
    const trace = await v.phone.page.evaluate(() => window.__rpLive?.fallback ?? null);
    expect(trace?.reason).toBeTruthy();
    // the visit still ends normally
    await v.phone.page.getByTestId("visit-end").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 60_000 });
    expect(v.phone.audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
    await expect(fallbackRows(v.desk.page)).toHaveCount(1);
  } finally {
    await v.close();
  }
});

test("a wrong token is found when the visit starts and said as a configuration problem", async ({ request }) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(120_000);
  await fake.start();
  fake.mode = "wrong_token";
  const s = await createSession(request, { story_day: 0 });
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const desk = await openCrewDevice(browser, s.id, "/backstage");
  try {
    const health = (await (await request.get("/api/asr/health", { headers: CREW })).json()) as { whisper: Record<string, unknown> };
    expect(health.whisper).toMatchObject({ reachable: true, healthy: false, reason: "unauthorized", token: "rejected" });
    const phone = await phoneWithMic(browser, s.id, "/p/visit?speed=10");
    const t0 = Date.now();
    await phone.page.getByTestId("consent-yes").click();
    await expect(phone.page.getByTestId("visit-notice")).toHaveText(REPLAY_NOTICE, { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(5000); // at the start, not two chunks into the visit
    await expect(fallbackRows(desk.page)).toHaveCount(1, { timeout: 10_000 });
    const sentence = fallbackRows(desk.page).first().getByTestId("event-sentence");
    await expect(sentence).toContainText("a configuration problem, not a crash");
    await expect(sentence).not.toContainText("stopped answering");
    expect(fake.chunks).toBe(0);
    await phone.context.close();
  } finally {
    await fake.stop();
    await closeAll([desk]);
    await browser.close();
  }
});

test("a service that stays busy: captions are said to be late, then the visit falls back (busy) with few calls", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    fake.mode = "busy";
    const t0 = Date.now();
    // late captions are said while it lasts (or the fallback notice already replaced it)
    await expect(v.phone.page.getByTestId("visit-notice")).toHaveText(new RegExp(`${DELAYED_NOTICE}|${REPLAY_NOTICE}`), { timeout: 10_000 });
    await expect(v.phone.page.getByTestId("visit-notice")).toHaveText(REPLAY_NOTICE, { timeout: 25_000 });
    const switchMs = Date.now() - t0;
    await expect(v.phone.page.getByTestId("line-v1-u03")).toBeVisible({ timeout: 30_000 });
    await expect(fallbackRows(v.desk.page)).toHaveCount(1, { timeout: 10_000 });
    await expect(fallbackRows(v.desk.page).first().getByTestId("event-sentence")).toContainText("stayed busy (its live queue was full)");
    // the page stops at once: no more calls to the busy service after the fallback
    const callsAtSwitch = fake.busyCalls;
    await v.phone.page.waitForTimeout(4000);
    expect(fake.busyCalls).toBe(callsAtSwitch);
    console.log(`[m14] busy: fell back after ${switchMs} ms with ${callsAtSwitch} calls to the busy service`);
    expect(callsAtSwitch).toBeLessThanOrEqual(25); // was 273 in 45 s before the fix
  } finally {
    await v.close();
  }
});

test("a service that hangs mid-visit: the late captions are said, the replay takes over within seconds", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    fake.mode = "hang";
    const t0 = Date.now();
    await expect(v.phone.page.getByTestId("visit-notice")).toHaveText(REPLAY_NOTICE, { timeout: 20_000 });
    const switchMs = Date.now() - t0;
    console.log(`[m14] hang: switched to the replay ${switchMs} ms after the service stopped answering`);
    expect(switchMs).toBeLessThan(9000); // was 11.1 s with frozen captions; now one line's final timeout (2.5 s) after the next line ends
    await expect(fallbackRows(v.desk.page)).toHaveCount(1, { timeout: 10_000 });
    // End visit: the replay stood in on screen, so the record follows it without calling the hung service
    await v.phone.page.getByTestId("visit-end").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 30_000 });
    await expect(fallbackRows(v.desk.page)).toHaveCount(1);
  } finally {
    await v.close();
  }
});

test("the upload fails at End visit: End again sends the same recording; the record is this visit's own, never the script", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    const puts: { size: number; type: string }[] = [];
    let refused = 0;
    await v.phone.page.route("**/api/blob/upload**", async (route) => {
      const r = route.request();
      if (r.method() !== "PUT") return route.continue();
      puts.push({ size: r.postDataBuffer()?.length ?? 0, type: r.headers()["content-type"] ?? "" });
      if (refused < 2) {
        refused += 1;
        return route.abort("connectionreset");
      }
      return route.continue();
    });
    await v.phone.page.getByTestId("visit-end").click();
    await expect(v.phone.page.getByTestId("visit-end-error")).toHaveText("没有完成，再试一次。", { timeout: 30_000 });
    await expect(v.phone.page.getByTestId("visit-notice")).toHaveText("录音没有传上去。再试一次，或者先保留现场字幕。");
    await expect(v.phone.page.getByTestId("visit-use-live")).toBeVisible();
    expect(puts).toHaveLength(2); // one automatic retry
    // the second tap: the same recording goes up, and the full transcript is made from it
    await v.phone.page.getByTestId("visit-end").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 60_000 });
    expect(puts).toHaveLength(3);
    expect(new Set(puts.map((p) => p.size)).size).toBe(1);
    expect(puts.every((p) => p.type === "audio/wav")).toBe(true);
    expect(fake.files).toBe(1);
    const lines = await visitLines(request, v.s.id);
    expect(lines.map((l) => l.text)).toContain(FILE_TEXT);
    expect(lines.filter((l) => /^v1-u\d+$/.test(l.id))).toEqual([]);
    await expect(fallbackRows(v.desk.page)).toHaveCount(0);
  } finally {
    await v.close();
  }
});

test("the full transcript is stuck: End visit says why and offers to keep the live captions", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    fake.fileMode = "stuck";
    await v.phone.page.getByTestId("visit-end").click();
    await expect(v.phone.page.getByTestId("visit-use-live")).toBeVisible({ timeout: 15_000 });
    await expect(v.phone.page.getByTestId("visit-notice")).toHaveText("还在用完整录音整理记录。也可以先保留现场字幕。");
    const t0 = Date.now();
    await v.phone.page.getByTestId("visit-use-live").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 15_000 });
    console.log(`[m14] stuck transcript: review ${Date.now() - t0} ms after "Keep the live captions"`);
    const lines = await visitLines(request, v.s.id);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => /^v1-w/.test(l.id))).toBe(true);
    await expect(fallbackRows(v.desk.page)).toHaveCount(1, { timeout: 10_000 });
    await expect(fallbackRows(v.desk.page).first().getByTestId("event-sentence")).toContainText("was not waited for");
  } finally {
    await v.close();
  }
});

test("a page reopened while its visit is transcribing waits for the job and finishes the visit (no dead end)", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    fake.fileMode = "stuck"; // the full transcript is still running
    await v.phone.page.getByTestId("visit-end").click();
    await expect.poll(async () => (await (await request.get(`/api/visits/v1?session=${v.s.id}`)).json()).view.visit.status, { timeout: 15_000 }).toBe("transcribing");
    // he reloads the page (or opens it again) while the record is being made
    await v.phone.page.reload();
    await expect(v.phone.page.getByTestId("visit-screen")).toBeVisible();
    await expect(v.phone.page.getByTestId("visit-end")).toHaveText(vt("zh-Hans", "ctrl.ending"), { timeout: 10_000 });
    await expect(v.phone.page.getByTestId("visit-end")).toBeDisabled();
    // the job finishes: the reopened page finalizes the visit by itself
    fake.fileMode = "ok";
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 30_000 });
    expect(fake.files).toBe(1);
    expect((await visitLines(request, v.s.id)).map((l) => l.text)).toContain(FILE_TEXT);
    await expect(fallbackRows(v.desk.page)).toHaveCount(0);
  } finally {
    await v.close();
  }
});

test("a recording the service refuses as too large (413): the record keeps the live captions, asr.fallback says why", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    fake.fileMode = "too_large";
    await v.phone.page.getByTestId("visit-end").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 30_000 });
    expect(fake.files).toBe(1); // not retried
    const lines = await visitLines(request, v.s.id);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => /^v1-w/.test(l.id))).toBe(true);
    await expect(fallbackRows(v.desk.page)).toHaveCount(1, { timeout: 10_000 });
    await expect(fallbackRows(v.desk.page).first().getByTestId("event-sentence")).toContainText("is too long to send in full");
  } finally {
    await v.close();
  }
});

test("B3: the service restarts while it makes the record: the job waits for it (awaiting_transcript), sends the recording again, and the record is the whole-recording transcript", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    fake.fileMode = "restart";
    const awaiting: unknown[] = [];
    v.phone.page.on("response", async (r) => {
      if (!/\/api\/asr\/jobs\/[^?]+/.test(new URL(r.url()).pathname) || r.request().method() !== "GET") return;
      const body = (await r.json().catch(() => null)) as { awaiting_transcript?: unknown } | null;
      if (body?.awaiting_transcript) awaiting.push(body.awaiting_transcript);
    });
    const t0 = Date.now();
    await v.phone.page.getByTestId("visit-end").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 60_000 });
    console.log(`[m14] restart mid-record: review ${Date.now() - t0} ms after End visit`);
    expect(fake.restarted).toBe(true);
    expect(fake.files).toBe(2); // the recording went to the restarted service again
    // the page saw the waiting state while the service was loading again
    expect(awaiting.length).toBeGreaterThan(0);
    expect(awaiting[0]).toMatchObject({ reason: "job_lost", attempt: 1 });
    // the record is the whole-recording transcript, not the live captions; nothing fell back
    const lines = await visitLines(request, v.s.id);
    expect(lines.map((l) => l.text)).toContain(FILE_TEXT);
    expect(lines.map((l) => l.text)).not.toContain("Hello from the fake service.");
    await expect(fallbackRows(v.desk.page)).toHaveCount(0);
    expect(v.phone.audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
  } finally {
    await v.close();
  }
});

test("B3: a WAV that is not PCM is refused here (415) before it reaches the service; the visit's captions go on", async ({ request }) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  await fake.start();
  try {
    const s = await createSession(request, { story_day: 0 });
    await request.post(`/api/visits?session=${s.id}`, { data: { mode: "record", consent: { given: true } } });
    const q = (line: string, kind = "chunk") => `session=${s.id}&visit_id=v1&kind=${kind}&line=${line}&offset_ms=0&seq=1`;
    // a float WAV (format 3): refused here before it reaches the service, as the service would
    const pcm = encodeWav(new Float32Array(16_000).fill(0.05));
    const float = Buffer.from(pcm);
    float.writeUInt16LE(3, 20);
    const local = await request.post(`/api/asr/chunk?${q("v1-wb3-1")}`, { headers: { "content-type": "audio/wav" }, data: float });
    expect(local.status()).toBe(415);
    expect(fake.chunks).toBe(0);
    const ok = await request.post(`/api/asr/chunk?${q("v1-wb3-2")}`, { headers: { "content-type": "audio/wav" }, data: Buffer.from(pcm) });
    expect(ok.status()).toBe(200);
    const fb = (await (await request.get(`/api/visits/v1?session=${s.id}`)).json()).view;
    expect(fb.visit.status).toBe("recording");
  } finally {
    await fake.stop();
  }
});

test("a recording longer than the store keeps (over max_bytes): not uploaded, the record keeps the live captions, said on screen", async ({ request }, info) => {
  test.skip(!configured || !replayOn, NEEDS_REPLAY_ON);
  test.setTimeout(180_000);
  const v = await liveVisit(request, info.outputDir);
  try {
    // a 27-minute recording is not practical here: the upload link answers with a limit below this recording
    await v.phone.page.route("**/api/upload-url**", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...body, max_bytes: 1000 } });
    });
    let puts = 0;
    v.phone.page.on("request", (r) => {
      if (r.url().includes("/api/blob/upload") && r.method() === "PUT") puts += 1;
    });
    await v.phone.page.getByTestId("visit-end").click();
    await v.phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 30_000 });
    expect(puts).toBe(0);
    expect(fake.files).toBe(0);
    const lines = await visitLines(request, v.s.id);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => /^v1-w/.test(l.id))).toBe(true);
    await expect(fallbackRows(v.desk.page)).toHaveCount(1, { timeout: 10_000 });
    await expect(fallbackRows(v.desk.page).first().getByTestId("event-sentence")).toContainText("is too long to send in full");
    await expect(fallbackRows(v.desk.page).first().getByTestId("event-sentence")).toContainText("(too_large)");
  } finally {
    await v.close();
  }
});

test("ASR_REPLAY_FALLBACK=off, the service down for the whole visit: the recording is saved, End visit says so, asr.fallback once for the record, and the record is made once the service is back", async ({ request }, info) => {
  test.skip(!configured || replayOn, "start the server with ASR_REPLAY_FALLBACK=off SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7899");
  test.setTimeout(180_000);
  await fake.stop(); // down from the start
  const wav = path.join(info.outputDir, "m14-fake-voice.wav");
  voiceWav(wav);
  const s = await createSession(request, { story_day: 0 });
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`] });
  const deskBrowser = await chromium.launch();
  const desk = await openCrewDevice(deskBrowser, s.id, "/backstage");
  try {
    const phone = await phoneWithMic(browser, s.id, "/p/visit?speed=10");
    const puts: string[] = [];
    phone.page.on("request", (r) => {
      if (r.url().includes("/api/blob/upload") && r.method() === "PUT") puts.push(r.headers()["content-type"] ?? "");
    });
    await phone.page.getByTestId("consent-yes").click();
    await expect(phone.page.getByTestId("visit-screen")).toBeVisible();
    // no replay in real mode: the screen says the recording goes on
    await expect(phone.page.getByTestId("visit-notice")).toHaveText(vt("zh-Hans", "live.asrFallbackNoReplay"), { timeout: 15_000 });
    await expect(fallbackRows(desk.page)).toHaveCount(1, { timeout: 10_000 });
    await phone.page.waitForTimeout(5000); // he talks for a while
    expect(await phone.page.locator('[data-testid^="line-v1-u"]').count()).toBe(0); // never the script

    // End visit: the recording is uploaded; the service cannot make the record; the page says the recording is saved
    await phone.page.getByTestId("visit-end").click();
    await expect(phone.page.getByTestId("visit-notice")).toHaveText(vt("zh-Hans", "ctrl.savedLater"), { timeout: 30_000 });
    await expect(phone.page.getByTestId("visit-end-error")).toHaveCount(0); // not a bare "try again"
    await expect(phone.page.getByTestId("visit-end")).toBeEnabled();
    expect(puts).toEqual(["audio/wav"]);
    await expect(fallbackRows(desk.page)).toHaveCount(2, { timeout: 10_000 }); // the start, and the record once
    await expect(fallbackRows(desk.page).last().getByTestId("event-sentence")).toContainText("the recording is saved, and End visit again makes the record once the service answers");

    // he taps End again while it is still down: the same answer, no second upload, no second asr.fallback
    await phone.page.getByTestId("visit-end").click();
    await expect(phone.page.getByTestId("visit-notice")).toHaveText(vt("zh-Hans", "ctrl.savedLater"), { timeout: 30_000 });
    await phone.page.waitForTimeout(1500);
    expect(puts).toHaveLength(1);
    await expect(fallbackRows(desk.page)).toHaveCount(2);
    expect((await visitLines(request, s.id)).filter((l) => /^v1-u\d+$/.test(l.id))).toEqual([]);

    // the service comes back: the page notices by itself and makes the record from the saved recording
    await fake.start();
    await phone.page.waitForURL(/\/p\/visit\/v1\/review$/, { timeout: 40_000 });
    expect(fake.files).toBe(1);
    const lines = await visitLines(request, s.id);
    expect(lines.map((l) => l.text)).toContain(FILE_TEXT);
    expect(lines.filter((l) => /^v1-u\d+$/.test(l.id))).toEqual([]);
    await expect(fallbackRows(desk.page)).toHaveCount(2);
    expect(phone.audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
    await phone.context.close();
  } finally {
    await fake.stop();
    await closeAll([desk]).catch(() => undefined);
    await browser.close();
    await deskBrowser.close();
  }
});

test("the chunk route takes only 16 kHz mono WAV, never WebM (any provider)", async ({ request }) => {
  const s = await createSession(request, { story_day: 0 });
  await request.post(`/api/visits?session=${s.id}`, { data: { mode: "record", consent: { given: true } } });
  const q = `session=${s.id}&visit_id=v1&kind=chunk&line=v1-wtest-1&offset_ms=0&seq=1`;
  const webm = await request.post(`/api/asr/chunk?${q}`, { headers: { "content-type": "audio/webm;codecs=opus" }, data: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]) });
  const health = (await (await request.get("/api/asr/health")).json()) as { provider: string; whisper?: Record<string, unknown> };
  if (health.provider === "whisper") expect(webm.status()).toBe(415);
  else expect(webm.status()).toBe(409); // not_whisper: live chunks only exist with SPEECH_PROVIDER=whisper
  expect((await webm.json()).error).toBe(health.provider === "whisper" ? "wav_required" : "not_whisper");
  // the public health answer never names the hardware or the models
  if (health.whisper) {
    expect(health.whisper.gpu).toBeUndefined();
    expect(health.whisper.models).toBeUndefined();
  }
});
