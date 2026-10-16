/**
 * SPEECH_PROVIDER=mock. No network, no keys.
 *
 * - realtimeToken(): a fake token. The realtime captions are pushed by the server, line by line at the
 *   time points in the replay file (lib/visit/replay.ts runs replaySchedule() below on a clock).
 * - createFileJob(): the "whole-visit transcript" is the replay file of the visit (input.fixture, or
 *   "fixture:<visit>" as the url). Audio is never decoded: the result says source = "fixture". A visit
 *   without a replay file gets an empty transcript.
 * - getFileJob(): pending for a short moment (so the browser's polling path is exercised), then done.
 *
 * Server-only.
 */
import { randomUUID } from "node:crypto";
import { fixtureUtterances } from "./fixtures";
import { SpeechError, type FileJobInput, type FileJobResult, type FixtureUtterance, type ReplayStep, type SpeechProvider } from "./types";

/** How long a mock file job stays "pending" (ms). MOCK_ASR_JOB_MS overrides; tests use 0. */
export function mockJobDelayMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.MOCK_ASR_JOB_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 300;
}

interface MockJob {
  input: FileJobInput;
  readyAt: number;
  result: FileJobResult;
}

const g = globalThis as unknown as { __rippleMockAsrJobs?: Map<string, MockJob> };
function jobs(): Map<string, MockJob> {
  g.__rippleMockAsrJobs ??= new Map();
  return g.__rippleMockAsrJobs;
}

function fixtureOf(input: FileJobInput): string | null {
  if (input.fixture) return input.fixture;
  const m = /^fixture:([A-Za-z0-9_-]+)$/.exec(input.url);
  return m ? m[1] : null;
}

export class MockSpeechProvider implements SpeechProvider {
  readonly name = "mock" as const;
  constructor(private readonly now: () => number = () => Date.now()) {}

  async realtimeToken(): Promise<{ token: string; expiresAt: number }> {
    return { token: `mock-${randomUUID()}`, expiresAt: this.now() + 10 * 60_000 };
  }

  async createFileJob(input: FileJobInput): Promise<{ jobId: string }> {
    if (!input.url) throw new SpeechError("invalid", "createFileJob needs a url");
    const fixture = fixtureOf(input);
    const lines = fixture ? fixtureUtterances(fixture) : null;
    const jobId = `mockjob-${randomUUID()}`;
    jobs().set(jobId, {
      input,
      readyAt: this.now() + mockJobDelayMs(),
      result: {
        status: "done",
        source: "fixture",
        utterances: (lines ?? []).map((u) => ({
          tStartMs: u.t_start_ms,
          tEndMs: u.t_end_ms,
          speaker: u.speaker_cluster,
          text: u.text,
          id: u.id,
          lang: u.lang,
        })),
      },
    });
    return { jobId };
  }

  async getFileJob(jobId: string): Promise<FileJobResult> {
    const job = jobs().get(jobId);
    if (!job) throw new SpeechError("not_found", `No speech job ${jobId}`);
    if (this.now() < job.readyAt) return { status: "pending" };
    return structuredClone(job.result);
  }
}

// ---------------------------------------------------------------- realtime replay schedule

/** First partial this long (replay clock) after a line starts: well inside the 1.5 s caption target. */
export const FIRST_PARTIAL_MS = 300;

function isHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

/** The first `share` (0..1) of a line, cut on a word (English) or character (Mandarin) boundary. */
export function captionPrefix(text: string, share: number): string {
  if (isHan(text)) {
    const chars = Array.from(text);
    const n = Math.max(2, Math.ceil(chars.length * share));
    return chars.slice(0, Math.min(n, chars.length)).join("");
  }
  const words = text.split(/\s+/).filter(Boolean);
  const n = Math.max(1, Math.ceil(words.length * share));
  return words.slice(0, Math.min(n, words.length)).join(" ");
}

/**
 * The realtime caption stream for a replay file, in replay-clock milliseconds: per line a first partial
 * FIRST_PARTIAL_MS after it starts, a second partial half way through (lines longer than 1.5 s), and the
 * final when it ends. Sorted by time. Divide atMs by the speed factor for wall-clock time.
 */
export function replaySchedule(lines: FixtureUtterance[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  for (const u of lines) {
    const dur = Math.max(0, u.t_end_ms - u.t_start_ms);
    const first = Math.min(u.t_start_ms + FIRST_PARTIAL_MS, u.t_end_ms);
    steps.push({ atMs: first, kind: "partial", utterance: u, text: captionPrefix(u.text, 0.25) });
    if (dur > 1500) {
      steps.push({ atMs: u.t_start_ms + Math.round(dur / 2), kind: "partial", utterance: u, text: captionPrefix(u.text, 0.6) });
    }
    steps.push({ atMs: u.t_end_ms, kind: "final", utterance: u, text: u.text });
  }
  return steps.sort((a, b) => a.atMs - b.atMs || (a.kind === b.kind ? 0 : a.kind === "partial" ? -1 : 1));
}
