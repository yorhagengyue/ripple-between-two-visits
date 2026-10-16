/**
 * A visit longer than one upload file, on his own account (C2 track R; lib/visit/parts.ts). The part length is 20
 * minutes; this spec names a part of two seconds in the x-ripple-part-ms request header (developer tools only), so a
 * recording of a few seconds is sent in several parts through the real page, the real upload route and the real
 * storage. The server has no such setting: it measures every part it is given.
 *
 *   1. He records about eight seconds and taps 「录完了」. The second file fails to upload, once. The screen says the
 *      recording did not upload and is still on the phone; the server has the first part and no recording yet.
 *      「再传一次」 goes on from the second part (the first is not sent again), the saving screen says how far it is in
 *      minutes, and the visit becomes its review. With the fake Whisper service: each part went to the service once, as
 *      one job; the transcript's times run over the whole visit; the sentence the cut between part 1 and part 2 went
 *      through is one line, and its clip, cut from both files, plays on the review. With the developer tools' stand-in
 *      (devfake): the record is the stand-in's, and the review opens with its lines.
 *   2. (fake Whisper) The service is down at 「录完了」: the long recording is saved and waits for its text; 「听录音」
 *      on the review plays it through, part after part, as one recording with one length; once the service answers, the
 *      scheduled pass sends every part in one submission and the review has the whole transcript.
 *
 *   3. A recording left running: before the longest recording the phone makes (nine parts: three hours; eighteen
 *      seconds with this spec's parts) one sentence says it will stop by itself and be saved; then it does, with
 *      nobody touching the phone, and the visit has its whole recording.
 *   4. The phone refuses to keep the recording (it is full): one sentence says so while he records; the recording, which
 *      is then in the page only, is still uploaded, whole.
 *   5. (the real part length) The phone has little room: the card for the doctor says for how many minutes, before
 *      anything is recorded; a phone that is full says to make room first; and while recording one sentence says how
 *      many minutes are left. Its short visit goes up as one file, as it always did.
 *
 * Needs the app on PW_PORT with the developer tools on. Tests 1, 3, 4 and 5 run on SPEECH_PROVIDER=devfake, on mock (a
 * server without transcription: the visit then waits for its text with its whole recording saved) and on whisper
 * pointed at this spec's own fake (below); test 2 needs the fake:
 *   SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 WHISPER_TOKEN=<any test value, 43+ chars> \
 *     node scripts/record/serve.mjs --port 3620 --detach     then   PW_PORT=3620 npx playwright test e2e/r-long-visit.spec.ts
 * (e2e/f-account-whisper.spec.ts uses the same port for its own fake: run the two files one after the other.)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { VisitView } from "../lib/visit/types";
import { expectPageChecks } from "./_checks/page-checks";
import { CHAIN_CREW_KEY } from "./helpers";

const FAKE_PORT = 7896;
const FAKE_GPU = "Fake GPU (track R long visit e2e)";
const CREW = { "x-ripple-crew-key": CHAIN_CREW_KEY };
const PART_MS = 2000;
const SHOTS = process.env.R_SHOTS_DIR?.trim() || null;

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["microphone"],
  locale: "zh-CN",
  timezoneId: "Asia/Singapore",
  // the small part length, and the stand-in's fixture when the server runs devfake
  extraHTTPHeaders: { "x-ripple-part-ms": String(PART_MS), "x-ripple-devfake-fixture": "v1" },
});

/** What the fake service hears in the nth file of a recording (times inside that file, whose audio is `dur` ms long). */
function heardIn(n: number, dur: number): { start_ms: number; end_ms: number; text: string }[] {
  if (n === 0) {
    return [
      { start_ms: 300, end_ms: 900, text: "Doctor, can I record?" },
      // runs to the end of the file: the sentence goes on in the next one
      { start_ms: dur - 500, end_ms: dur, text: "At home, we want it below" },
    ];
  }
  if (n === 1) {
    return [
      { start_ms: 0, end_ms: 700, text: "135 over 85." },
      { start_ms: 900, end_ms: 1400, text: "If your reading at home is above 180 on top, or you get chest pain, go to A&E or call 995." },
    ];
  }
  return [{ start_ms: 100, end_ms: Math.max(200, Math.min(800, dur - 100)), text: n === 2 ? "Okay, I will write that down." : `Thank you doctor, number ${n}.` }];
}

class FakeWhisper {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  /** the size of every whole-recording file the service was sent, in order */
  files: number[] = [];
  private jobs = new Map<string, { n: number; dur: number }>();
  /** files of the recording being sent now (the nth file of a job) */
  private inJob = 0;

  /** a new recording starts with its first file */
  newRecording(): void {
    this.inJob = 0;
    this.files = [];
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
      return send(200, { status: "ready", ready: true, healthy: true, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, gpu: { name: FAKE_GPU }, ...(auth !== undefined ? { token_ok: true } : {}) });
    }
    if (!(auth ?? "").startsWith("Bearer ")) return send(401, { error: "unauthorized" });
    let bytes = 0;
    req.on("data", (c: Buffer) => (bytes += c.length));
    req.on("end", () => {
      if (url.pathname === "/v1/chunk") {
        // nothing heard live: this spec is about the whole recording
        const dur = Math.max(200, Math.round(((bytes - 44) / 32_000) * 1000));
        return send(200, { text: "", lang: "en", segments: [], duration_ms: dur, model: "fake-turbo", elapsed_ms: 5 });
      }
      if (url.pathname === "/v1/file") {
        const id = `fakerjob${String(this.files.length + 1).padStart(6, "0")}${randomUUID().slice(0, 4)}`;
        this.jobs.set(id, { n: this.inJob++, dur: Math.round(((bytes - 44) / 32_000) * 1000) });
        this.files.push(bytes);
        return send(202, { job_id: id, status: "queued", eta_ms: 300, model: "fake-large" });
      }
      if (url.pathname.startsWith("/v1/jobs/")) {
        if (req.method === "DELETE") return send(200, { deleted: true });
        const job = this.jobs.get(url.pathname.split("/").pop() ?? "");
        if (!job) return send(404, { error: "job_not_found" });
        return send(200, { status: "done", model: "fake-large", segments: heardIn(job.n, job.dur).map((l, i) => ({ ...l, lang: "en", region: i, confidence: "high" })) });
      }
      send(404, { error: "not_found" });
    });
  }
}

const fake = new FakeWhisper();
let provider = "unknown";
/** the server's Whisper is this spec's fake */
let whisper = false;

/** a server these tests can end a visit on: the stand-in, no transcription at all (the visit then waits), or this spec's fake service */
const usable = () => provider === "devfake" || provider === "mock" || whisper;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const clock = await request.post("/api/dev/clock", { data: { at: "2026-10-12T10:00:00+08:00", frozen: false } });
  test.skip(clock.status() === 404, "the developer tools are off on this server");
  let started = false;
  try {
    await fake.start();
    started = true;
  } catch {
    // the port is taken: not our setup
  }
  try {
    const h = (await (await request.get("/api/asr/health", { headers: CREW })).json()) as { provider?: string; whisper?: { gpu?: unknown } };
    provider = h.provider ?? "unknown";
    const gpu = h.whisper?.gpu as { name?: string } | string | undefined;
    whisper = started && provider === "whisper" && (gpu === FAKE_GPU || (typeof gpu === "object" && gpu?.name === FAKE_GPU));
  } finally {
    await fake.stop();
  }
});
test.afterAll(async () => {
  await fake.stop();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  }
}

async function signUp(page: Page): Promise<void> {
  const login = `rl${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const res = await page.request.post("/api/dev/accounts", { data: { login, password: "a long test password", space: "blank", display_name: "陈先生", locale: "zh-Hans" } });
  expect(res.status(), await res.text()).toBe(201);
}

async function startRecording(page: Page): Promise<string> {
  await page.goto("/p/visit");
  await page.getByTestId("visit-start").click();
  await page.getByTestId("visit-clinic").click();
  await page.getByTestId("visit-direct").click();
  await expect(page.getByTestId("visit-consent")).toBeVisible();
  await page.getByTestId("consent-start").click();
  const live = page.getByTestId("visit-live");
  await expect(live).toHaveAttribute("data-mode", "record");
  return (await live.getAttribute("data-visit"))!;
}

interface ServerParts {
  parts: { seq: number; path: string; ms: number }[];
  complete: boolean;
  path: string | null;
}

async function partsOnServer(context: BrowserContext, visitId: string): Promise<ServerParts> {
  const res = await context.request.get(`/api/visits/${visitId}/parts`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as ServerParts;
}

async function visitView(context: BrowserContext, visitId: string): Promise<VisitView> {
  const res = await context.request.get(`/api/visits/${visitId}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { view: VisitView }).view;
}

/** Seconds of this visit's recording kept in this browser's IndexedDB. */
async function keptSeconds(page: Page, visitId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === "ripple-recordings")) return 0;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("ripple-recordings");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction("kept", "readonly").objectStore("kept").getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });
      let s = 0;
      for (const r of rows as { visitId?: string; pcm?: { length: number }; rate?: number }[]) if (r.visitId === id && r.pcm && r.rate) s += r.pcm.length / r.rate;
      return s;
    } finally {
      db.close();
    }
  }, visitId);
}

/** No screen of his says "part": the upload in parts is not his to know about. */
async function expectNoPartWords(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/第\s*\d+\s*段|分段|第\s*\d+\s*部分|part\s*\d/i);
}

test("a visit of several parts: one upload fails once and the rest goes on from there; one continuous transcript and working clips on the review", async ({ page, context }) => {
  test.skip(!usable(), `needs SPEECH_PROVIDER=devfake or mock, or whisper pointed at this spec's fake; this server has ${provider}`);
  test.setTimeout(240_000);
  if (whisper) {
    await fake.start();
    fake.newRecording();
  }
  try {
    await signUp(page);
    const visitId = await startRecording(page);
    // while he records nothing is different: the bar, the time, one button; no word of parts
    await expect(page.getByTestId("visit-stop")).toBeVisible();
    await expect(page.getByTestId("visit-warn")).toHaveCount(0);
    await expectNoPartWords(page);
    await page.waitForTimeout(7_800);

    // the uploads: the second file is refused once; a later one is slow, so the saving screen can be read
    const puts: { n: number; outcome: "sent" | "failed" }[] = [];
    await context.route("**/api/blob/upload**", async (route) => {
      const n = puts.length + 1;
      if (n === 2) {
        puts.push({ n, outcome: "failed" });
        return route.abort();
      }
      puts.push({ n, outcome: "sent" });
      if (n === 4) await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });

    await page.getByTestId("visit-stop").click();
    const error = page.getByTestId("visit-error");
    await expect(error).toHaveAttribute("data-error", "upload", { timeout: 60_000 });
    await expect(error).toContainText("录音没传上去，还在手机上");
    await expectNoPartWords(page);
    await shot(page, "r-upload-failed");
    await expectPageChecks(page, { side: "elder" });

    // the server has the first part, measured by itself, and no recording yet; the phone still has all of it
    const recorded = await page.evaluate(() => (window.__rpLastRecording?.durationMs ?? 0) / 1000);
    expect(recorded).toBeGreaterThan(2 * (PART_MS / 1000) + 1);
    const mid = await partsOnServer(context, visitId);
    expect(mid.parts.map((p) => [p.seq, p.ms])).toEqual([[0, PART_MS]]);
    expect(mid.complete).toBe(false);
    expect((await visitView(context, visitId)).visit.audioPath).toBeNull();
    expect(await keptSeconds(page, visitId)).toBeGreaterThan(recorded - 0.3);
    expect(puts).toEqual([
      { n: 1, outcome: "sent" },
      { n: 2, outcome: "failed" },
    ]);

    // 「再传一次」: on from the second part; the saving screen says how far it is, in minutes of the visit
    await error.locator('[data-rp="retry"]').click();
    const ending = page.getByTestId("visit-ending");
    await expect(ending).toHaveAttribute("data-sent-ms", String(2 * PART_MS), { timeout: 30_000 });
    const progress = page.getByTestId("visit-saving-progress");
    await expect(ending).toContainText("正在存录音");
    await expect(progress).toHaveText(/^已经存好 \d+ 分钟，一共 \d+ 分钟。$/);
    await expectNoPartWords(page);
    await shot(page, "r-saving-progress");
    await expectPageChecks(page, { side: "elder" });
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 120_000 });

    // every part is on the server, in order, whole parts and a last one; the first part is the one sent before the
    // failure (not sent again); the recording is whole, and only now the phone's copy is gone
    const done = await partsOnServer(context, visitId);
    expect(done.complete).toBe(true);
    expect(done.parts.length).toBeGreaterThanOrEqual(3);
    expect(done.parts[0]).toEqual(mid.parts[0]);
    expect(done.path).toBe(done.parts[0].path);
    for (const p of done.parts.slice(0, -1)) expect(p.ms).toBe(PART_MS);
    const totalMs = done.parts.reduce((ms, p) => ms + p.ms, 0);
    expect(Math.abs(totalMs / 1000 - recorded)).toBeLessThan(0.3);
    // one more upload than there are parts: the refused one, and nothing sent twice besides it
    expect(puts.filter((p) => p.outcome === "sent")).toHaveLength(done.parts.length);
    expect(puts).toHaveLength(done.parts.length + 1);
    await expect.poll(() => keptSeconds(page, visitId), { timeout: 15_000 }).toBe(0);

    const view = await visitView(context, visitId);
    expect(view.visit.status).toBe(provider === "mock" ? "awaiting_transcript" : "review");
    expect(view.visit.audioPath).toBe(done.parts[0].path);
    if (provider !== "mock") await expect(page.getByTestId("review-queue")).toBeVisible();
    const starts = view.lines.map((l) => l.tStartMs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);

    if (whisper) {
      // one job: each part went to the service once, in order, each its own size
      expect(fake.files).toEqual(done.parts.map((p) => 44 + p.ms * 32));
      // one continuous transcript: the times run over the whole visit, and the sentence the first cut went through is one line
      const expected: [number, number, string][] = [
        [300, 900, "Doctor, can I record?"],
        [PART_MS - 500, PART_MS + 700, "At home, we want it below 135 over 85."],
        [PART_MS + 900, PART_MS + 1400, "If your reading at home is above 180 on top, or you get chest pain, go to A&E or call 995."],
        [2 * PART_MS + 100, 2 * PART_MS + 800, "Okay, I will write that down."],
      ];
      expect(view.lines.slice(0, 4).map((l) => [l.tStartMs, l.tEndMs, l.text])).toEqual(expected);
      expect(view.lines).toHaveLength(done.parts.length + 1);
      // every later part's line starts inside that part
      for (const [i, l] of view.lines.slice(4).entries()) expect(Math.floor(l.tStartMs / PART_MS)).toBe(3 + i);

      // the review asks about the line across the cut first; its clip plays, and is the whole sentence: 0.5 s from the
      // end of the first file and 0.7 s from the start of the second
      const one = page.getByTestId("review-one");
      await expect(one).toContainText("At home, we want it below 135 over 85.");
      const listen = page.getByTestId("review-listen");
      await expect(listen).toHaveAttribute("data-playing", "false");
      const clipUrl = (await listen.getAttribute("data-clip-url"))!;
      const clip = await context.request.get(clipUrl);
      expect(clip.status()).toBe(200);
      expect(clip.headers()["content-type"]).toContain("audio/wav");
      expect(clip.headers()["x-ripple-stand-in"]).toBe("0");
      expect((await clip.body()).length).toBe(44 + 1200 * 32);
      await listen.locator("button, a").first().click();
      await expect(listen).toHaveAttribute("data-playing", "true", { timeout: 10_000 });
      await shot(page, "r-review-line-across-cut");
      // it stops by itself at its end (1.2 s)
      await expect(listen).toHaveAttribute("data-playing", "false", { timeout: 10_000 });
      // every line has its own clip, cut from the recording
      for (const l of view.lines) {
        expect(l.clip, l.text).not.toBeNull();
        const res = await context.request.get(l.clip!.url);
        expect(res.status(), l.text).toBe(200);
        expect((await res.body()).length, l.text).toBe(44 + (l.tEndMs - l.tStartMs) * 32);
      }
    } else if (provider === "mock") {
      // a server without transcription (the judges' deployment): the long recording is saved whole and waits for its
      // text; the review says so with the whole recording's length, and 「听录音」 is one bar for all of it
      const waiting = page.getByTestId("review-awaiting");
      await expect(waiting).toHaveAttribute("data-transcript", "waiting");
      const s = Math.round(totalMs / 1000);
      await expect(waiting).toContainText(`录音（${Math.floor(s / 60)} 分 ${s % 60} 秒）已经存好`);
      await expect(waiting.locator('[data-rp="listen"] audio')).toHaveAttribute("data-part", "0");
    } else {
      // the developer tools' stand-in: the record is its fixture's, whatever was recorded; the review opens with it
      expect(view.lines.length).toBeGreaterThan(5);
      await expect(page.getByTestId("review-one")).toBeVisible();
    }
    await expectNoPartWords(page);
    await expectPageChecks(page, { side: "elder" });
  } finally {
    await fake.stop();
  }
});

test("the service is down at the end: the long recording waits whole; 听录音 plays it through as one; the scheduled pass sends every part in one submission", async ({ page, context }) => {
  test.skip(!whisper, "start the app with SPEECH_PROVIDER=whisper WHISPER_URL=http://127.0.0.1:7896 (a test token) and RIPPLE_DEV_TOOLS=1");
  test.setTimeout(240_000);
  await fake.stop();
  try {
    await signUp(page);
    const visitId = await startRecording(page);
    await expect(page.getByTestId("visit-notice")).toContainText("转写服务现在没有回应", { timeout: 15_000 });
    await page.waitForTimeout(5_200);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 120_000 });
    const waiting = page.getByTestId("review-awaiting");
    await expect(waiting).toHaveAttribute("data-transcript", "waiting");

    const done = await partsOnServer(context, visitId);
    expect(done.complete).toBe(true);
    expect(done.parts.length).toBeGreaterThanOrEqual(2);
    const totalMs = done.parts.reduce((ms, p) => ms + p.ms, 0);
    expect((await visitView(context, visitId)).visit.status).toBe("awaiting_transcript");
    await expect.poll(() => keptSeconds(page, visitId), { timeout: 15_000 }).toBe(0);

    // the sentence and the bar give the whole recording's length, not the first file's
    const s = Math.round(totalMs / 1000);
    await expect(waiting).toContainText(`录音（${Math.floor(s / 60)} 分 ${s % 60} 秒）已经存好`);
    const bar = waiting.locator('[data-rp="listen"]');
    await expect(bar).toHaveAttribute("data-playing", "false");
    await expect(bar).toContainText(`0:${String(s).padStart(2, "0")}`);
    await expectNoPartWords(page);
    await shot(page, "r-review-awaiting-long");
    await expectPageChecks(page, { side: "elder" });

    // 「听录音」: one tap, and it goes through every file by itself, saying 「正在播」 all the way
    const player = bar.locator("audio");
    await expect(player).toHaveAttribute("data-part", "0");
    const seen = new Set<string>();
    await bar.locator("button").click();
    await expect(bar).toHaveAttribute("data-playing", "true", { timeout: 10_000 });
    const until = Date.now() + totalMs + 20_000;
    let stoppedBetween = false;
    while (Date.now() < until) {
      const part = (await player.getAttribute("data-part")) ?? "";
      seen.add(part);
      const playing = (await bar.getAttribute("data-playing")) === "true";
      if (!playing && Number(part) === done.parts.length - 1 && seen.size === done.parts.length) break;
      if (!playing && seen.size < done.parts.length) {
        // a pause between two files would show here for a moment at most; it must not stay
        await page.waitForTimeout(700);
        if ((await bar.getAttribute("data-playing")) !== "true" && seen.size < done.parts.length && (await player.getAttribute("data-part")) === part) stoppedBetween = true;
      }
      await page.waitForTimeout(100);
    }
    expect(stoppedBetween).toBe(false);
    expect([...seen].sort()).toEqual(done.parts.map((_, i) => String(i)));
    await expect(bar).toHaveAttribute("data-playing", "false", { timeout: 15_000 });
    // every file is his own recording's, each behind its own short link
    for (const [i] of done.parts.entries()) {
      const res = await context.request.get(`/api/me/export/recording?visit=${visitId}&part=${i}`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
    }
    expect((await context.request.get(`/api/me/export/recording?visit=${visitId}&part=${done.parts.length}`, { maxRedirects: 0 })).status()).toBe(404);

    // the service answers again: the scheduled pass (run here by the developer tools' tick) sends the recording, every
    // part, as one submission, and makes the record
    await fake.start();
    fake.newRecording();
    await expect
      .poll(
        async () => {
          await context.request.post("/api/dev/tick", { data: { names: ["asr.pending"] } });
          return (await visitView(context, visitId)).visit.status;
        },
        { timeout: 90_000, intervals: [1000] },
      )
      .toBe("review");
    expect(fake.files).toEqual(done.parts.map((p) => 44 + p.ms * 32));
    const view = await visitView(context, visitId);
    expect(view.lines.slice(0, 3).map((l) => [l.tStartMs, l.text])).toEqual([
      [300, "Doctor, can I record?"],
      [PART_MS - 500, "At home, we want it below 135 over 85."],
      [PART_MS + 900, "If your reading at home is above 180 on top, or you get chest pain, go to A&E or call 995."],
    ]);
    for (const l of view.lines) expect(l.clip, l.text).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId("review-queue")).toBeVisible();
    await expect(page.getByTestId("review-one")).toContainText("At home, we want it below 135 over 85.");

    // 「看诊录音留多久」: the same recording, one row, one length, one 「听录音」 that starts at its first file
    await page.goto("/p/me/export/recordings");
    const row = page.locator(`[data-testid="recording"][data-visit="${visitId}"]`);
    await expect(row).toHaveAttribute("data-state", "kept_until");
    await expect(row.locator('[data-rp="listen"]')).toContainText(`0:${String(s).padStart(2, "0")}`);
    await expect(row.locator("audio")).toHaveCount(1);
    await expect(row.locator("audio")).toHaveAttribute("data-part", "0");
    await expectNoPartWords(page);
    await expectPageChecks(page, { side: "elder" });
  } finally {
    await fake.stop();
  }
});

/** The page goes to the background: what a phone browser tells the page (the keeper writes what it holds). */
async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
}

test("a recording left running: one sentence before the longest recording the phone makes, then it stops by itself and is saved whole", async ({ page, context }) => {
  test.skip(!usable(), `needs SPEECH_PROVIDER=devfake or mock, or whisper pointed at this spec's fake; this server has ${provider}`);
  test.setTimeout(240_000);
  if (whisper) {
    await fake.start();
    fake.newRecording();
  }
  try {
    await signUp(page);
    const visitId = await startRecording(page);
    // nine parts of two seconds: eighteen seconds. Nothing is said for most of it
    await page.waitForTimeout(6_000);
    await expect(page.getByTestId("visit-warn")).toHaveCount(0);
    // a second before the end (half a part; ten minutes with the real part length): one plain sentence
    const warn = page.getByTestId("visit-warn");
    await expect(warn).toBeVisible({ timeout: 20_000 });
    await expect(warn).toHaveText("录音已经很长了，再过大约 1 分钟会自己停下并存好。");
    await expectNoPartWords(page);
    // nobody taps anything: the recording ends itself, is saved, and the visit goes on to its review
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 120_000 });
    const recorded = await page.evaluate(() => (window.__rpLastRecording?.durationMs ?? 0) / 1000);
    expect(recorded).toBeGreaterThanOrEqual(18);
    expect(recorded).toBeLessThan(23);
    const done = await partsOnServer(context, visitId);
    expect(done.complete).toBe(true);
    // nine whole parts, and what was recorded in the moment it took to stop (with the last part, or after it)
    expect(done.parts.length).toBeGreaterThanOrEqual(9);
    expect(done.parts.length).toBeLessThanOrEqual(11);
    expect(Math.abs(done.parts.reduce((ms, p) => ms + p.ms, 0) / 1000 - recorded)).toBeLessThan(0.3);
    await expect.poll(() => keptSeconds(page, visitId), { timeout: 15_000 }).toBe(0);
  } finally {
    await fake.stop();
  }
});

test("the phone refuses to keep the recording: one sentence says so, and the recording, in the page only, is still uploaded whole", async ({ page, context }) => {
  test.skip(!usable(), `needs SPEECH_PROVIDER=devfake or mock, or whisper pointed at this spec's fake; this server has ${provider}`);
  test.setTimeout(180_000);
  if (whisper) {
    await fake.start();
    fake.newRecording();
  }
  try {
    // a phone whose storage takes no more audio: every write of a chunk is refused
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
        if (this.name === "kept") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await signUp(page);
    const visitId = await startRecording(page);
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId("visit-warn")).toHaveCount(0);
    // the page writes what it holds (here: it went to the background for a moment; otherwise every ten seconds)
    await hide(page);
    const warn = page.getByTestId("visit-warn");
    await expect(warn).toHaveText("手机存满了：先别关这一页，录完马上传。", { timeout: 10_000 });
    await shot(page, "r-phone-full");
    await expectPageChecks(page, { side: "elder" });
    expect(await keptSeconds(page, visitId)).toBe(0);
    await page.waitForTimeout(2_500);
    await page.getByTestId("visit-stop").click();
    await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 120_000 });
    // nothing of it was ever on the phone, and the server has all of it, in parts
    const recorded = await page.evaluate(() => (window.__rpLastRecording?.durationMs ?? 0) / 1000);
    expect(recorded).toBeGreaterThan(5);
    const done = await partsOnServer(context, visitId);
    expect(done.complete).toBe(true);
    expect(done.parts.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(done.parts.reduce((ms, p) => ms + p.ms, 0) / 1000 - recorded)).toBeLessThan(0.3);
    expect((await visitView(context, visitId)).visit.audioPath).toBe(done.parts[0].path);
  } finally {
    await fake.stop();
  }
});

test.describe("with the real part length", () => {
  // no small part here: twenty minutes, so the longest recording is three hours and a short visit is one file
  test.use({ extraHTTPHeaders: { "x-ripple-devfake-fixture": "v1" } });

  test("little room on the phone: the card for the doctor says for how many minutes before anything is recorded; while recording, one sentence when it runs short", async ({ page, context }) => {
    test.skip(!usable(), `needs SPEECH_PROVIDER=devfake or mock, or whisper pointed at this spec's fake; this server has ${provider}`);
    test.setTimeout(240_000);
    if (whisper) {
      await fake.start();
      fake.newRecording();
    }
    try {
      // what the browser says about the phone's room: the test sets the minutes (2.2 MB a minute, lib/visit/parts.ts)
      await page.addInitScript(() => {
        const w = window as unknown as { __rRoomMin?: number };
        w.__rRoomMin = Number(sessionStorage.getItem("r-room-min") ?? "0");
        navigator.storage.estimate = async () => ({ quota: 2_200_000 * (w.__rRoomMin ?? 0) + 1000, usage: 0 });
      });
      await signUp(page);
      const toCard = async () => {
        await page.goto("/p/visit");
        await page.getByTestId("visit-start").click();
        await page.getByTestId("visit-clinic").click();
        await page.getByTestId("visit-direct").click();
        await expect(page.getByTestId("visit-consent")).toBeVisible();
      };
      // a full phone: said on the card, before the button that starts the recording is tapped
      await toCard();
      await expect(page.getByTestId("visit-room")).toHaveText("这台手机存满了，先清出一些地方再录。");
      await shot(page, "r-consent-room-none");
      await expectPageChecks(page, { side: "elder" });

      // room for twelve minutes: the card says so (under half an hour)
      await page.evaluate(() => sessionStorage.setItem("r-room-min", "12"));
      await toCard();
      await expect(page.getByTestId("visit-room")).toHaveText("这台手机剩下的地方，大约只够再录 12 分钟。");
      await expect(page.getByTestId("visit-room")).toHaveAttribute("data-minutes", "12");
      await shot(page, "r-consent-room-low");
      await expectPageChecks(page, { side: "elder" });
      await page.getByTestId("consent-start").click();
      const live = page.getByTestId("visit-live");
      await expect(live).toHaveAttribute("data-mode", "record");
      const visitId = (await live.getAttribute("data-visit"))!;
      // twelve minutes left: nothing is said while he records
      await page.waitForTimeout(3_000);
      await expect(page.getByTestId("visit-warn")).toHaveCount(0);
      // the room runs short (asked again every twenty seconds): one sentence, with the minutes
      await page.evaluate(() => ((window as unknown as { __rRoomMin?: number }).__rRoomMin = 6));
      const warn = page.getByTestId("visit-warn");
      await expect(warn).toHaveText("手机快存满了，大约还能录 6 分钟。", { timeout: 60_000 });
      await shot(page, "r-room-soon");
      await expectPageChecks(page, { side: "elder" });
      await expectNoPartWords(page);

      // a short visit is one file, as it always was: no list of parts on the server
      await page.getByTestId("visit-stop").click();
      await page.waitForURL(new RegExp(`/p/visit/${visitId}/review$`), { timeout: 120_000 });
      const done = await partsOnServer(context, visitId);
      expect(done.parts).toEqual([]);
      expect(done.complete).toBe(true);
      expect(done.path).toMatch(new RegExp(`/visits/${visitId}/recording-[0-9a-f-]+\\.wav$`));
      await expect.poll(() => keptSeconds(page, visitId), { timeout: 30_000 }).toBe(0);
    } finally {
      await fake.stop();
    }
  });
});
