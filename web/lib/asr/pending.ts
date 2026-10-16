/**
 * Visits waiting for their transcript, sent once the transcription service answers (C2 track F; real-app 2.14, 6.8:
 * 「服务端每 5 分钟看一次 Whisper 的 /health。服务好了，就把等着的看诊依次送去转写，每次看诊只送一次。做完推送『看诊记录好了』」).
 * Server-only. Registered with the scheduled jobs' runner when this module loads (lib/jobs/index.ts imports it); the
 * runner's first pass after the server starts is the "at start-up" look.
 *
 * One pass, for every account scope (a store bound to it, system mode), one visit after another:
 *
 *   1. a visit that is "transcribing"
 *      - this process does not know its job (the server restarted: jobs live in process memory, lib/asr/visit-jobs.ts):
 *        with its recording saved it goes back to waiting and is sent again below, in the same pass. No job of this
 *        process runs for it, so there are never two at once. (Without a saved recording the page's own reset applies:
 *        GET /api/asr/jobs.)
 *      - its job is still pending: left alone; far past anything a job can take (STALE_AFTER_MS beyond the time it was
 *        given), the job is stopped and forgotten and the visit waits again
 *      - its job is done: the visit's record (finalizeVisit: lines, roles, items, clips cut from the recording, status
 *        review, visit.changed), the event visit.transcribed (the transcript arrived after the visit: once per visit,
 *        published here only), then the notice 「看诊记录好了」 to his phone, once per visit (lib/visit/ready-notice.ts).
 *        A job his open page is still waiting for is left to that page (it makes the record itself; never two at once)
 *      - its job failed: waiting again (awaiting_transcript); nothing is sent to his phone
 *   2. a visit waiting (awaiting_transcript) with its recording saved: when the service is ready and healthy (one probe
 *      per pass) it is sent, once: its status becomes transcribing and its job is remembered, so no later pass sends it
 *      while that job is pending. While the service is down nothing is sent.
 *
 * "Each visit is sent only once" (lib/visit/transcript-tries.ts has the reading): never two submissions at the same
 * time, never again on every pass. A submission the service accepted and then failed is tried again on a later pass,
 * because nothing else would ever un-stick that visit, but at most MAX_TRANSCRIPT_SENDS times in all: each submission
 * is one reminder_delivery row (kind transcript_try), counted across restarts. After the last one the visit keeps its
 * recording, stays "awaiting_transcript", and the review page says the text could not be made.
 *
 * His consent to AI processing is read here through the process store (a system-mode store cannot read account rows)
 * and handed to finalizeVisit: without it the record is made by the rules only and nothing is translated.
 * The service is the server's live transcriber: Whisper, or Tencent Cloud speech recognition (SPEECH_PROVIDER=tencent,
 * lib/asr/tencent.ts, whose probe recognises nothing). Without one (SPEECH_PROVIDER mock or devfake) the job does
 * nothing: an account's visit then waits, never the script.
 */
import { getBlobStore, type BlobStore } from "@/lib/blob";
import { publish } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { patientLocale } from "@/lib/jobs/daily";
import type { Notice } from "@/lib/jobs/notify";
import { registerJob, forEachAccountScope, type JobDefinition } from "@/lib/jobs/runner";
import type { LlmClient } from "@/lib/llm/types";
import { aiConsent } from "@/lib/safety/consent";
import type { ReminderDeliveryRow, SessionRow, Store, VisitRow } from "@/lib/store/types";
import { finalizeVisit } from "@/lib/visit/pipeline";
import { openRecording, partLoaders } from "@/lib/visit/recording-audio";
import { notifyVisitReady } from "@/lib/visit/ready-notice";
import { jobOwner, rememberJob } from "@/lib/visit/state";
import { MAX_TRANSCRIPT_SENDS, TRANSCRIPT_TRY, transcriptTries } from "@/lib/visit/transcript-tries";
import { getLiveTranscriber } from "./index";
import type { FileJobInput, FileJobResult } from "./types";
import { forgetVisitJob, rememberVisitJob, visitJob, visitJobOverdueMs, visitJobWaitLeft } from "./visit-jobs";

/** What a pass needs from the speech provider (WhisperSpeechProvider and TencentSpeechProvider have it). */
export interface PendingSpeech {
  readonly name: string;
  /** null: ready and healthy; else why not */
  probe(timeoutMs?: number): Promise<string | null>;
  createFileJob(input: FileJobInput): Promise<{ jobId: string }>;
  getFileJob(jobId: string): Promise<FileJobResult>;
  /** stop a job that is still running (whisper) */
  cancelFileJob?(jobId: string): Promise<boolean>;
  /** the longest a job for this recording can stay pending (whisper: its deadline, redos included) */
  budgetMs?(audio: Uint8Array | null | undefined): number;
  /** C2 track R: the same for a recording in several files (their lengths in ms) */
  budgetMsForParts?(lengthsMs: readonly number[]): number;
}

export interface PendingCounts {
  scopes: number;
  waiting: number;
  sent: number;
  finished: number;
  failed: number;
  /** the service did not answer this pass (nothing was sent) */
  unavailable: number;
  /** visits found "transcribing" with no job running for them (a restart, a stuck job): back to waiting */
  recovered: number;
  /** waiting visits that used up their attempts: nothing more is sent for them */
  gave_up: number;
  /** 「看诊记录好了」 recorded for a visit (once each) */
  notified: number;
  /** phones the notice reached */
  pushed: number;
}

export interface PendingDeps {
  speech?: PendingSpeech | null;
  blob?: BlobStore;
  /** where the notice goes (default lib/jobs/notify.ts sendNotice) */
  send?: (notice: Notice, store: Store) => Promise<{ sent: number }>;
  /** his language for the notice (default his account's, lib/jobs/daily.ts patientLocale) */
  locale?: (scope: SessionRow) => Promise<Locale>;
  /** the labelling model for the record (tests; default the pipeline's own choice) */
  llm?: LlmClient | null;
  /** real time of this pass (tests) */
  nowMs?: number;
}

export const PENDING_JOB = "asr.pending";
export const PENDING_EVERY_MS = 5 * 60_000;
/** A job still pending this long after the time it was given is taken for stuck: stopped, and its visit waits again. */
export const STALE_AFTER_MS = 10 * 60_000;
/** The time a job is given when the provider cannot say (no budgetMs). */
export const DEFAULT_JOB_BUDGET_MS = 30 * 60_000;

type GlobalWithSent = typeof globalThis & { __ripplePendingSent?: Set<string> };

/** Jobs this pass sent itself (process memory, like the jobs): no page is waiting for them. */
function sentHere(): Set<string> {
  const g = globalThis as GlobalWithSent;
  g.__ripplePendingSent ??= new Set();
  return g.__ripplePendingSent;
}

/** One pass over every account scope (see the header). `speech` null: no transcription service here, nothing to do. */
export async function pendingTranscriptPass(store: Store, deps: PendingDeps = {}): Promise<PendingCounts> {
  const counts: PendingCounts = { scopes: 0, waiting: 0, sent: 0, finished: 0, failed: 0, unavailable: 0, recovered: 0, gave_up: 0, notified: 0, pushed: 0 };
  const speech = deps.speech === undefined ? getLiveTranscriber() : deps.speech;
  if (!speech) return counts;
  const blob = deps.blob ?? getBlobStore();
  const now = deps.nowMs ?? Date.now();
  let healthy: boolean | null = null; // asked once per pass, only when a visit waits

  counts.scopes = await forEachAccountScope(store, async (subject) => {
    const s = subject.store;
    const scope = subject.scope;
    let deliveries: ReminderDeliveryRow[] | null = null; // read once per scope, only when a visit waits
    const tries = async (visitId: string) => transcriptTries((deliveries ??= await s.listDeliveries(scope.id)), visitId);

    for (const listed of await s.listVisits(scope.id)) {
      let v: VisitRow = listed;

      // 1. transcribing
      if (v.status === "transcribing") {
        const jobId = visitJob(scope.id, v.id);
        const known = !!jobId && jobOwner(jobId)?.sessionId === scope.id;
        if (!known) {
          // the server restarted (or the job map lost it): nothing of this process runs for this visit
          if (!v.audio_path) continue;
          v = await waitAgain(s, scope, v, "its transcript job was lost (the server restarted)");
          counts.recovered++;
        } else {
          const job = await speech.getFileJob(jobId!).catch(() => null);
          if (!job) continue;
          if (job.status === "pending") {
            const overdue = visitJobOverdueMs(scope.id, v.id, now);
            if (overdue === null || overdue <= STALE_AFTER_MS) continue;
            // far longer than a job can take: stop it first, so the next one is the only one
            await speech.cancelFileJob?.(jobId!).catch(() => false);
            forgetVisitJob(scope.id, v.id);
            sentHere().delete(jobId!);
            await waitAgain(s, scope, v, "its transcript job ran far past its time and was stopped");
            counts.recovered++;
            continue; // sent again on a later pass, once the stopped job is gone
          }
          if (job.status === "done") {
            // his open page is still waiting for this job: it makes the record itself (never two at once)
            if (!sentHere().has(jobId!) && visitJobWaitLeft(scope.id, v.id) > 0) continue;
            // the consent is his account's: read through the process store (this scope's store cannot)
            const aiAllowed = await aiConsent(store, scope);
            await finalizeVisit(s, scope, v.id, job, { aiAllowed, account: store, ...(deps.llm !== undefined ? { llm: deps.llm } : {}) });
            sentHere().delete(jobId!);
            counts.finished++;
            // the whole-visit transcript arrived after the visit (real-app 6.13 `visit.transcribed`): said once, here and
            // nowhere else. A record his open page makes itself is not this event (finalizeVisit says visit.changed
            // for both); the visit is "review" from now on, so no later pass comes back to this branch for it.
            publish(scope.id, "visit.transcribed", `Visit ${v.id}: its transcript arrived after the visit; the record waits for his check`, { visit_id: v.id });
            try {
              const locale = deps.locale ? await deps.locale(scope) : await patientLocale(store, scope);
              const told = await notifyVisitReady(s, scope, v, { locale, send: deps.send });
              if (told.recorded) counts.notified++;
              counts.pushed += told.sent;
            } catch (err) {
              // the record is made either way; the notice is best effort (no content in the log)
              console.warn(`[asr.pending] the visit-ready notice could not be recorded: ${err instanceof Error ? err.name : "error"}`);
            }
          } else {
            sentHere().delete(jobId!);
            const waiting = await waitAgain(s, scope, v, "the transcription service could not make its transcript");
            counts.failed++;
            deliveries = null;
            if ((await tries(v.id)) >= MAX_TRANSCRIPT_SENDS) {
              publish(scope.id, "visit.changed", `Visit ${v.id}: its transcript could not be made after ${MAX_TRANSCRIPT_SENDS} attempts; the recording is kept`, {
                visit: waiting,
                transcript_failed: true,
              });
            }
          }
          continue;
        }
      }

      // 2. waiting with its recording saved: sent once the service answers
      if (v.status !== "awaiting_transcript" || !v.audio_path) continue;
      counts.waiting++;
      const used = await tries(v.id);
      if (used >= MAX_TRANSCRIPT_SENDS) {
        counts.gave_up++;
        continue;
      }
      // never two jobs for one visit: one this process still has pending for it is left to finish
      const prev = visitJob(scope.id, v.id);
      if (prev && jobOwner(prev)?.sessionId === scope.id && (await speech.getFileJob(prev).catch(() => null))?.status === "pending") continue;
      if (healthy === null) healthy = (await speech.probe().catch(() => "unreachable")) === null;
      if (!healthy) {
        counts.unavailable = 1;
        continue;
      }
      const audio = await blob.getObject("audio", v.audio_path);
      if (!audio) continue;
      const url = await blob.signedReadUrl("audio", v.audio_path, 3600);
      // C2 track R: a long recording is several files: one job reads them one after another (still one submission of
      // this visit, counted once below)
      const recording = openRecording(blob, v, { first: audio.bytes });
      const several = recording && recording.files.length > 1 ? recording : null;
      let jobId: string;
      try {
        ({ jobId } = await speech.createFileJob({ url, ...(several ? { audioParts: partLoaders(several) } : { audio: audio.bytes }), recorded: true, lang: "zh-en-mixed", speakers: 2 }));
      } catch {
        // the service went away between the probe and the send: not an attempt, the visit keeps waiting
        counts.unavailable = 1;
        healthy = false;
        continue;
      }
      // the job is this visit's from this moment (process memory: cannot fail), so nothing sends it a second one
      rememberJob(jobId, { sessionId: scope.id, visitId: v.id, provider: speech.name });
      const budget = several ? speech.budgetMsForParts?.(several.files.map((f) => f.ms ?? 0)) : speech.budgetMs?.(audio.bytes);
      rememberVisitJob(scope.id, v.id, jobId, budget ?? DEFAULT_JOB_BUDGET_MS);
      sentHere().add(jobId);
      await s.updateVisit(scope.id, v.id, { status: "transcribing" });
      // the attempt is written down (the unique key: this visit, this number)
      await s.recordDelivery(scope.id, { kind: TRANSCRIPT_TRY, ref: v.id, day: v.day, slot: String(used + 1) });
      deliveries = null;
      counts.sent++;
    }
  });
  return counts;
}

/** Back to waiting for its transcript (the recording is saved), said on the bus. */
async function waitAgain(s: Store, scope: SessionRow, v: VisitRow, why: string): Promise<VisitRow> {
  const updated = await s.updateVisit(scope.id, v.id, { status: "awaiting_transcript" });
  publish(scope.id, "visit.changed", `Visit ${v.id}: ${why}; the recording is saved and waits for its transcript`, { visit: updated, awaiting_transcript: true });
  return updated;
}

export const PENDING_TRANSCRIPTS_JOB: JobDefinition = {
  name: PENDING_JOB,
  everyMs: PENDING_EVERY_MS,
  leaseS: 600,
  async run(ctx) {
    return { ...(await pendingTranscriptPass(ctx.store)) };
  },
};

registerJob(PENDING_TRANSCRIPTS_JOB);
