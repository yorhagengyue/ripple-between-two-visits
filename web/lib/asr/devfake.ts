/**
 * SPEECH_PROVIDER=devfake: a transcription stand-in for the developer tools (C2 architecture review, finding 11). A
 * recorded visit's "whole-visit transcript" is the lines of a known replay fixture, so the journeys that need a
 * transcript (an account's visit, before the local Whisper service is wired) can be recorded end to end:
 *
 *   which fixture   the visit's own audio_fixture (the route resolves it: lib/visit/view.ts replayFixtureFor), else the
 *                   x-ripple-devfake-fixture header the test or journey script sends (v1, v2, p1, v3)
 *   source          always "fixture": the lines are the fixture's, so each line's sound is the fixture's stand-in clip
 *                   when there is one (lib/visit/pipeline.ts finalizeVisit), never a slice of the test's fake microphone
 *                   (its timing has nothing to do with the fixture's)
 *   no fixture      a done job with no lines (never a guess)
 *
 * It is a developer tool: it refuses to exist unless the developer tools are on (lib/dev/enabled.ts), and a real
 * deployment refuses to start with it. Recordings made with it are marked as a stand-in by the journeys (施工约定:
 * 「转写：测试替身」). Server-only.
 */
import { randomUUID } from "node:crypto";
import { assertDevTools, devToolsEnabled } from "@/lib/dev/enabled";
import { fixtureUtterances } from "./fixtures";
import { mockJobDelayMs } from "./mock";
import { SpeechError, type FileJobInput, type FileJobResult, type SpeechProvider } from "./types";

export const DEVFAKE_HEADER = "x-ripple-devfake-fixture";

/**
 * The fixture a request names in DEVFAKE_HEADER (a known replay file only), or null. Only while the developer tools
 * are on: with them off the header is not read at all, whatever SPEECH_PROVIDER says (real-app H6: an account's visit
 * never gets a replay file as its transcript; the provider itself already refuses, lib/dev/enabled.ts).
 */
export function devfakeFixture(req: { headers: { get(name: string): string | null } }, env: Record<string, string | undefined> = process.env): string | null {
  if (!devToolsEnabled(env)) return null;
  const name = req.headers.get(DEVFAKE_HEADER)?.trim() ?? "";
  return name && fixtureUtterances(name) ? name : null;
}

interface DevfakeJob {
  readyAt: number;
  result: FileJobResult;
}

const g = globalThis as unknown as { __rippleDevfakeJobs?: Map<string, DevfakeJob> };
const jobs = () => (g.__rippleDevfakeJobs ??= new Map());

export class DevfakeSpeechProvider implements SpeechProvider {
  readonly name = "devfake" as const;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.check();
  }

  /** Refuses (not_configured) unless the developer tools are on, at creation and again at each new job. */
  private check(): void {
    try {
      assertDevTools("SPEECH_PROVIDER=devfake", this.env);
    } catch (err) {
      throw new SpeechError("not_configured", (err as Error).message);
    }
  }

  async realtimeToken(): Promise<{ token: string; expiresAt: number }> {
    return { token: `devfake-${randomUUID()}`, expiresAt: this.now() + 10 * 60_000 };
  }

  async createFileJob(input: FileJobInput): Promise<{ jobId: string }> {
    this.check();
    const fixture = input.fixture ?? input.devfakeFixture ?? null;
    const lines = fixture ? fixtureUtterances(fixture) : null;
    const jobId = `devfake-${randomUUID()}`;
    jobs().set(jobId, {
      readyAt: this.now() + mockJobDelayMs(),
      result: {
        status: "done",
        source: "fixture",
        model: "devfake",
        utterances: (lines ?? []).map((u) => ({ tStartMs: u.t_start_ms, tEndMs: u.t_end_ms, speaker: u.speaker_cluster, text: u.text, id: u.id, lang: u.lang })),
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
