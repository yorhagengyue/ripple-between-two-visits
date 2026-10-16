/**
 * A fake Tencent Cloud ASR (recording file recognition) behind a fetch function, for the unit tests of lib/asr/tencent.ts
 * and the routes with SPEECH_PROVIDER=tencent. It answers CreateRecTask and DescribeTaskStatus the way the real service
 * did on 2026-10-14 (the shapes in lib/asr/tencent.ts's header), checks each request's TC3 signature with the secret it
 * was given, and can fail in a chosen way. Every request is kept (action, headers, body) so a test can look at them.
 */
import { tc3Sign } from "@/lib/tts/tc3";
import { tencentAsrConfig, type TencentAsrConfig } from "@/lib/asr/tencent";
import { parseWav } from "@/lib/visit/wav";

export const FAKE_SECRET_ID = "AKIDfakeTencentAsr0123456789";
export const FAKE_SECRET_KEY = "fakeTencentAsrSecretKey0123456789";

export interface FakeTencentCall {
  action: string;
  host: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** the request's own signature checked against the fake's secret */
  signatureOk: boolean;
}

export interface FakeSentence {
  text: string;
  startMs: number;
  endMs: number;
  /** the speaker's number the service answers (SpeakerId; 0 when not given, as the real service answers without speaker separation) */
  speaker?: number;
}

export interface FakeTencent {
  fetch: typeof fetch;
  calls: FakeTencentCall[];
  /** a vendor error code the next requests of this action answer (null: none) */
  errorFor: Partial<Record<"CreateRecTask" | "DescribeTaskStatus", string | null>>;
  /** fail the next N CreateRecTask requests with this code, then answer normally */
  failCreates: { code: string; times: number } | null;
  /** the network: up, refused connections, or no answer at all (a hung request) */
  network: "up" | "down" | "hang";
  /** polls a task stays "doing" before it is done */
  doingPolls: number;
  /** answer Result text only (ResTextFormat 0), no ResultDetail */
  resultTextOnly: boolean;
  /** the task fails (Status 3) */
  taskFails: boolean;
  /** what a task recognises: by task number (1 for the first) and the audio's length in ms */
  sentencesFor: (n: number, audioMs: number) => FakeSentence[];
  /** tasks created so far */
  created: number;
  /** most CreateRecTask tasks running at once (created and not yet asked for after done) */
  maxRunning: number;
}

export function fakeConfig(env: Record<string, string> = {}): TencentAsrConfig {
  return tencentAsrConfig({ TENCENT_SECRET_ID: FAKE_SECRET_ID, TENCENT_SECRET_KEY: FAKE_SECRET_KEY, ...env });
}

interface Task {
  id: number;
  n: number;
  audioMs: number;
  polls: number;
  done: boolean;
}

export function fakeTencent(): FakeTencent {
  const tasks = new Map<number, Task>();
  let nextId = 18_236_000;
  let running = 0;
  const fake: FakeTencent = {
    calls: [],
    errorFor: {},
    failCreates: null,
    network: "up",
    doingPolls: 1,
    resultTextOnly: false,
    taskFails: false,
    sentencesFor: () => [{ text: "Please don't change the dose yourself.", startMs: 0, endMs: 2150 }],
    created: 0,
    maxRunning: 0,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
      const payload = typeof init?.body === "string" ? init.body : "";
      const signal = init?.signal ?? undefined;
      if (fake.network === "down") throw new TypeError("fetch failed");
      if (fake.network === "hang") {
        await new Promise<never>((_, reject) => {
          const fail = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
          if (signal?.aborted) fail();
          signal?.addEventListener("abort", fail, { once: true });
        });
      }
      const action = headers["x-tc-action"] ?? "";
      const timestamp = Number(headers["x-tc-timestamp"]);
      const expected = tc3Sign({ secretId: FAKE_SECRET_ID, secretKey: FAKE_SECRET_KEY, service: "asr", host: url.host, payload, timestamp });
      const signatureOk = headers.authorization === expected.authorization;
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        body = {};
      }
      fake.calls.push({ action, host: url.host, headers, body, signatureOk });
      const answer = (response: Record<string, unknown>) =>
        new Response(JSON.stringify({ Response: { ...response, RequestId: `req-${fake.calls.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
      const error = (code: string) => answer({ Error: { Code: code, Message: "fake message that must never be shown" } });
      if (!signatureOk) return error("AuthFailure.SignatureFailure");

      if (action === "CreateRecTask") {
        if (fake.failCreates && fake.failCreates.times > 0) {
          fake.failCreates.times -= 1;
          return error(fake.failCreates.code);
        }
        if (fake.errorFor.CreateRecTask) return error(fake.errorFor.CreateRecTask);
        const data = typeof body.Data === "string" ? body.Data : "";
        const audio = new Uint8Array(Buffer.from(data, "base64"));
        const info = parseWav(audio);
        const id = nextId++;
        fake.created += 1;
        tasks.set(id, { id, n: fake.created, audioMs: info?.durationMs ?? 0, polls: 0, done: false });
        running += 1;
        fake.maxRunning = Math.max(fake.maxRunning, running);
        return answer({ Data: { TaskId: id } });
      }
      if (action === "DescribeTaskStatus") {
        if (fake.errorFor.DescribeTaskStatus) return error(fake.errorFor.DescribeTaskStatus);
        const task = tasks.get(Number(body.TaskId));
        if (!task) return error("FailedOperation.NoSuchTask");
        task.polls += 1;
        if (task.polls <= fake.doingPolls) return answer({ Data: { TaskId: task.id, Status: 1, StatusStr: "doing", Result: "", ResultDetail: null, ErrorMsg: "", AudioDuration: 0 } });
        if (!task.done) {
          task.done = true;
          running -= 1;
        }
        if (fake.taskFails) return answer({ Data: { TaskId: task.id, Status: 3, StatusStr: "failed", Result: "", ResultDetail: null, ErrorMsg: "fake failure", AudioDuration: 0 } });
        const sentences = fake.sentencesFor(task.n, task.audioMs);
        const stamp = (ms: number) => `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1000).toFixed(3)}`;
        const result = sentences.map((s) => `[${stamp(s.startMs)},${stamp(s.endMs)}]  ${s.text}\n`).join("");
        const detail = sentences.map((s) => ({ FinalSentence: s.text, SliceSentence: s.text, WrittenText: "", StartMs: s.startMs, EndMs: s.endMs, SpeechSpeed: 3, WordsNum: 1, Words: [], SpeakerId: s.speaker ?? 0, EmotionalEnergy: 0, SilenceTime: 0, EmotionType: [] }));
        return answer({ Data: { TaskId: task.id, Status: 2, StatusStr: "success", AudioDuration: task.audioMs / 1000, Result: result, ResultDetail: fake.resultTextOnly ? null : detail, ErrorMsg: "" } });
      }
      return error("InvalidAction");
    }) as typeof fetch,
  };
  return fake;
}
