/**
 * A fake Whisper service behind a fetch function, for the M14 unit tests: answers /health, /v1/chunk,
 * /v1/file and /v1/jobs the way services/whisper does, or fails in a chosen way.
 */
import { whisperConfig, type WhisperConfig } from "@/lib/asr";

export const TEST_TOKEN = "t".repeat(43);

export type FakeMode =
  | "up"
  | "down"
  | "timeout"
  | "loading"
  | "unauthorized"
  | "busy"
  | "garbage"
  | "server_error"
  | "job_failed"
  | "stuck"
  | "too_large"
  /** the file worker is wedged: /v1/file answers 503 stuck */
  | "stuck_503"
  /** the file worker was found wedged while the job waited: the job answers failed / worker_stuck */
  | "worker_stuck"
  /** the service refuses the request itself: 415 wav_16k_mono_pcm16_required (a client error, not a failure) */
  | "rejected"
  /** the service refuses the request itself: 422 too_short */
  | "too_short";

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  auth: string | null;
  bytes: number;
}

export interface FakeWhisper {
  fetch: typeof fetch;
  calls: FakeCall[];
  mode: FakeMode;
  /** per-path override of the mode (e.g. only /v1/file is down) */
  modeFor: Partial<Record<"health" | "chunk" | "file" | "job", FakeMode>>;
  /** text the chunk endpoint answers with (by kind of request: it cannot tell, so one text for all) */
  chunkText: string;
  chunkLang: string;
  /** segments of a finished file job */
  fileSegments: { start_ms: number; end_ms: number; text: string; lang: string; region?: number; words?: { start_ms: number; end_ms: number; word: string; prob: number }[] }[];
  /**
   * C2 track R: segments per recording file, when set (instead of fileSegments): asked once for each /v1/file the
   * service takes, with which one it is (0 for the first) and the file's size, so a recording sent in parts gets each
   * part's own lines.
   */
  fileSegmentsFor: ((n: number, bytes: number) => FakeWhisper["fileSegments"]) | null;
  /** polls a file job stays running before it is done */
  runningPolls: number;
  /** a running job reports progress that moves on every poll (false: stuck at 0 of 3) */
  progressMoves: boolean;
  /** /health answers this as Retry-After for busy */
  retryAfterS: number;
  deleted: string[];
  /**
   * Simulate a restart of the service after this many polls of one job (the poll that reaches it still answers):
   * every job is forgotten (404 job_not_found, like the real service after a restart), the next `restartPlan.down`
   * requests are refused (connection refused while it is gone), and the `restartPlan.loading` requests after those
   * answer loading (the models load again). null = never.
   */
  restartAfterPolls: number | null;
  restartPlan: { down: number; loading: number };
  /** restarts so far */
  restarts: number;
  /** the simulated restart is over now: no more refused or loading answers */
  endRestart: () => void;
  /**
   * Simulate a wedged file worker, like services/whisper with a CUDA call that never returns: the running job's
   * progress stops at once (its polls answer running, nothing moves, /health still says healthy), and after this many
   * polls of it the service declares the worker stuck (WHISPER_FILE_STALL_S): the job answers failed / worker_stuck,
   * /health answers status "stuck" for `wedgePlan.stuckHealth` requests and new recordings get 503 stuck; then the
   * process exits (code 6) and its supervisor restarts it: every job forgotten, `wedgePlan.down` requests refused,
   * `wedgePlan.loading` requests loading. null = never.
   */
  wedgeAfterPolls: number | null;
  wedgePlan: { stuckHealth: number; down: number; loading: number };
  /** called when a simulated restart begins (a test can change what the restarted service answers) */
  onRestart: (() => void) | null;
}

export function fakeConfig(overrides: Record<string, string | undefined> = {}): WhisperConfig {
  return whisperConfig({
    WHISPER_URL: "http://whisper.test:7810",
    WHISPER_TOKEN: TEST_TOKEN,
    WHISPER_POLL_MS: "20",
    WHISPER_HEALTH_TIMEOUT_MS: "200",
    WHISPER_CHUNK_TIMEOUT_MS: "200",
    WHISPER_FINAL_TIMEOUT_MS: "500",
    WHISPER_UPLOAD_TIMEOUT_MS: "1000",
    WHISPER_POLL_TIMEOUT_MS: "200",
    WHISPER_JOB_DEADLINE_MS: "3000",
    ...overrides,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function fakeWhisper(): FakeWhisper {
  const state: FakeWhisper = {
    calls: [],
    mode: "up",
    modeFor: {},
    chunkText: "At home, we want it below 135 over 85.",
    chunkLang: "en",
    fileSegments: [
      { start_ms: 1500, end_ms: 4000, text: "Doctor, can I record?", lang: "en", region: 0 },
      { start_ms: 4200, end_ms: 6100, text: "My daughter wants me to use this app.", lang: "en", region: 0 },
      { start_ms: 6800, end_ms: 8000, text: "Sure, no problem.", lang: "en", region: 1 },
      { start_ms: 70_465, end_ms: 74_965, text: "医生，我家里那个机器是绑手腕的，可以用吗？", lang: "zh", region: 2 },
    ],
    fileSegmentsFor: null,
    runningPolls: 1,
    progressMoves: false,
    retryAfterS: 1,
    deleted: [],
    restartAfterPolls: null,
    restartPlan: { down: 0, loading: 0 },
    restarts: 0,
    endRestart: () => {
      downLeft = 0;
      loadingLeft = 0;
    },
    wedgeAfterPolls: null,
    wedgePlan: { stuckHealth: 0, down: 0, loading: 0 },
    onRestart: null,
    fetch: undefined as unknown as typeof fetch,
  };
  const polls = new Map<string, number>();
  /** the segments of each taken file, when fileSegmentsFor is set */
  const segmentsOf = new Map<string, FakeWhisper["fileSegments"]>();
  let filesTaken = 0;
  let jobSeq = 0;
  /** after a simulated restart: requests still refused, then still loading */
  let downLeft = 0;
  let loadingLeft = 0;
  /** a wedged worker: the jobs it failed, and how many more /health answers say stuck before the process exits */
  const wedgedJobs = new Set<string>();
  let wedgedRunning: string | null = null;
  let stuckHealthLeft = 0;
  const restart = (plan: { down: number; loading: number } = state.restartPlan) => {
    state.restarts += 1;
    state.restartAfterPolls = null;
    polls.clear();
    wedgedJobs.clear();
    wedgedRunning = null;
    downLeft = plan.down;
    loadingLeft = plan.loading;
    state.onRestart?.();
  };

  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const body = init?.body as ArrayBuffer | Uint8Array | undefined;
    const bytes = body ? (body as ArrayBuffer).byteLength ?? 0 : 0;
    state.calls.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      auth: headers.get("authorization"),
      bytes,
    });
    const which = url.pathname === "/health" ? "health" : url.pathname === "/v1/chunk" ? "chunk" : url.pathname === "/v1/file" ? "file" : "job";
    let mode = state.modeFor[which] ?? state.mode;
    if (downLeft > 0) {
      downLeft -= 1;
      mode = "down";
    } else if (loadingLeft > 0) {
      loadingLeft -= 1;
      mode = "loading";
    }
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "timeout") {
      await new Promise<never>((_, reject) => {
        const signal = init?.signal;
        const fail = () => reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
        if (signal?.aborted) fail();
        signal?.addEventListener("abort", fail);
      });
    }
    if (which === "health") {
      // like the service: token_ok only when a token was sent
      const auth = headers.get("authorization");
      const tokenOk = auth === null ? {} : { token_ok: auth === `Bearer ${TEST_TOKEN}` && mode !== "unauthorized" };
      if (stuckHealthLeft > 0) {
        // the wedged worker is reported; after the last of these answers the watchdog exits and the supervisor restarts it
        stuckHealthLeft -= 1;
        if (stuckHealthLeft === 0) restart(state.wedgePlan);
        return json(200, { status: "stuck", ready: true, healthy: false, stuck_s: 95, stuck_workers: ["file"], device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, ...tokenOk });
      }
      if (mode === "loading") return json(200, { status: "loading", ready: false, healthy: false, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, ...tokenOk });
      if (mode === "stuck") return json(200, { status: "stuck", ready: true, healthy: false, stuck_s: 45, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, ...tokenOk });
      return json(200, { status: "ready", ready: true, healthy: true, device: "cuda", models: { live: "large-v3-turbo", file: "large-v3" }, gpu: { name: "Fake GPU" }, ...tokenOk });
    }
    if (mode === "stuck") {
      // the live worker hangs: /health answers, the work never does
      await new Promise<never>((_, reject) => {
        const signal = init?.signal;
        const fail = () => reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
        if (signal?.aborted) fail();
        signal?.addEventListener("abort", fail);
      });
    }
    if (headers.get("authorization") !== `Bearer ${TEST_TOKEN}` || mode === "unauthorized") return json(401, { error: "unauthorized" });
    if (mode === "loading") return json(503, { error: "loading" });
    if (mode === "busy") return new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "content-type": "application/json", "retry-after": String(state.retryAfterS) } });
    if (mode === "too_large") return json(413, { error: "too_large" });
    if (mode === "rejected") return json(415, { error: "wav_16k_mono_pcm16_required", message: "PCM (format 1) required" });
    if (mode === "too_short") return json(422, { error: "too_short" });
    if (mode === "stuck_503") return new Response(JSON.stringify({ error: "stuck" }), { status: 503, headers: { "content-type": "application/json", "retry-after": "30" } });
    if (mode === "server_error") return json(500, { error: "internal_error" });
    if (mode === "garbage") return new Response("<html>proxy error</html>", { status: 200 });
    if (which === "chunk") {
      return json(200, {
        text: state.chunkText,
        lang: state.chunkLang,
        segments: state.chunkText ? [{ start_ms: 120, end_ms: 2900, text: state.chunkText, lang: state.chunkLang, confidence: "high" }] : [],
        duration_ms: 3000,
        model: "large-v3-turbo",
        elapsed_ms: 140,
      });
    }
    if (which === "file" && stuckHealthLeft > 0) return new Response(JSON.stringify({ error: "stuck" }), { status: 503, headers: { "content-type": "application/json", "retry-after": "30" } });
    if (which === "file") {
      const id = `job${String(++jobSeq).padStart(8, "0")}`;
      polls.set(id, 0);
      if (state.fileSegmentsFor) segmentsOf.set(id, state.fileSegmentsFor(filesTaken, bytes));
      filesTaken += 1;
      return json(202, { job_id: id, status: "queued", eta_ms: 1000, model: "large-v3" });
    }
    const id = url.pathname.split("/").pop()!;
    if ((init?.method ?? "GET") === "DELETE") {
      state.deleted.push(id);
      return json(200, { deleted: true });
    }
    if (!polls.has(id)) return json(404, { error: "job_not_found" });
    const n = (polls.get(id) ?? 0) + 1;
    polls.set(id, n);
    if (mode === "job_failed") return json(200, { job_id: id, status: "failed", error: "transcription_failed" });
    if (mode === "worker_stuck" || wedgedJobs.has(id)) return json(200, { job_id: id, status: "failed", error: "worker_stuck" });
    if (state.wedgeAfterPolls !== null && (wedgedRunning === null || wedgedRunning === id)) {
      // the worker hangs inside this job: running, progress frozen, until the service declares it stuck
      wedgedRunning = id;
      if (n < state.wedgeAfterPolls) return json(200, { job_id: id, status: "running", progress: { done: 1, total: 4 } });
      state.wedgeAfterPolls = null;
      wedgedJobs.add(id);
      stuckHealthLeft = state.wedgePlan.stuckHealth;
      if (stuckHealthLeft === 0) restart(state.wedgePlan);
      return json(200, { job_id: id, status: "failed", error: "worker_stuck" });
    }
    if (state.restartAfterPolls !== null && n >= state.restartAfterPolls) {
      // this poll still answers; the service is gone right after it
      const answer = { job_id: id, status: "running", progress: { done: n, total: n + 3 } };
      restart();
      return json(200, answer);
    }
    if (n <= state.runningPolls) return json(200, { job_id: id, status: "running", progress: { done: state.progressMoves ? n : 0, total: state.progressMoves ? n + 3 : 3 } });
    const segments = segmentsOf.get(id) ?? state.fileSegments;
    return json(200, { job_id: id, status: "done", segments, meta: { segments: segments.length }, model: "large-v3" });
  }) as typeof fetch;
  return state;
}
