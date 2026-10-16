"use client";

/**
 * /p/visit: consent -> the live visit screen -> (End visit) the whole-visit transcript -> the after-visit
 * review. Or, without a microphone, "replay a sample visit" through the same pipeline.
 *
 * Realtime (SPEECH_PROVIDER=mock): the server pushes captions and cards on the session's event stream
 * (asr.partial, asr.final with the whole screen state, card.created). Recording: an AudioWorklet makes a
 * 16 kHz mono WAV, uploaded through a signed link (/api/upload-url), never WebM.
 *
 * SPEECH_PROVIDER=whisper (M14): the same microphone blocks go to LiveWhisperClient (lib/asr/live-client),
 * which cuts 2-3 s chunks and whole lines at pauses and posts them as WAV to /api/asr/chunk; captions grow
 * from the answers and each finished line comes back stored, with the screen's cards. Late captions and lines
 * that got no caption are said on screen. When the service does not answer (at the start or mid-visit) the
 * page says so and switches to the replay when the server offers one (else the recording goes on).
 *
 * The recorder's blocks go through one listener from the first block: the recorder's own clock
 * (window.__rpRecorder), and, until the live client exists (it waits for /api/asr/realtime-token), a buffer
 * (lib/asr/early-blocks) that the client is fed first, so his first words reach the live captions too.
 *
 * End visit keeps the recording until the visit is finished: an upload or a transcript that fails can be
 * tried again with the same recording (never a script in its place). While the full record takes long, or
 * after an upload failed, "Keep the live captions" ends the visit with the live Whisper lines instead. When the
 * speech service cannot make the record but the recording is saved (deferred), the page says so, checks
 * /api/asr/health every RETRY_LATER_MS and ends the visit again by itself once the service answers. A job the
 * server lost (it restarted) is created again once. A page reopened while its visit is "transcribing" asks for
 * the job (GET /api/asr/jobs?visit_id=): it waits for it and finishes the visit, or, when the server no longer has
 * it, End visit works again.
 *
 * e2e hooks: window.__rpVisit records when each caption and card first showed (wall clock) and the
 * replay's start time and speed, so tests can check the 1.5 s caption and 5 s card targets;
 * window.__rpRecorder is the recording's own clock (wall time of its sample 0).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLiveEvent } from "@/components/live/LiveSession";
import { useCrewBrowser } from "@/components/session/useCrewBrowser";
import type { BusEvent } from "@/lib/bus";
import type { Locale } from "@/lib/i18n";
import { ApiError, postJson, withSession } from "@/lib/session/client";
import { demoText } from "@/lib/crew/demo-copy";
import { vt } from "@/lib/visit/strings";
import type { VisitView } from "@/lib/visit/types";
import { BlockClock, EarlyBlocks, type RecorderClockTrace } from "@/lib/asr/early-blocks";
import { LiveWhisperClient } from "@/lib/asr/live-client";
import type { LiveTuning } from "@/lib/asr/segmenter";
import { ConsentStep, type ReplayOption, type UnfinishedOption } from "./ConsentStep";
import { useWavRecorder } from "./useWavRecorder";
import { VisitScreen, type PartialCaption, type UnlockResult } from "./VisitScreen";

declare global {
  interface Window {
    __rpVisit?: {
      visitId: string;
      startedAt: number | null;
      speed: number;
      captions: Record<string, number>;
      cards: Record<string, number>;
      finals: Record<string, number>;
      times: Record<string, [number, number]>;
      /** card id -> the line it hangs under (M14 latency measurement) */
      anchors?: Record<string, string>;
    };
    /** the recording's clock: wall time of its sample 0 (M14 latency measurement) */
    __rpRecorder?: RecorderClockTrace;
  }
}

interface PartialData {
  visit_id: string;
  utterance: { id: string; t_start_ms: number; t_end_ms: number; text: string };
  started_at: number;
  speed: number;
}

interface FinalData {
  visit_id: string;
  utterances: { id: string; t_start_ms: number; t_end_ms: number }[];
  view: VisitView;
}

const LIVE_TYPES = ["asr.partial", "asr.final"] as const;
/** End visit taking longer than this shows why and offers to keep the live captions */
const SLOW_END_MS = 8000;
/** the record is deferred (the speech service is down, the recording saved): how often to check for it */
const RETRY_LATER_MS = 10_000;
/** automatic End visit retries after the service answers again; then only his own tap (no endless loop) */
const MAX_AUTO_RETRIES = 6;

type JobOutcome = { ok: true; jobId: string } | { ok: false; deferred: boolean };
type PollOutcome = JobOutcome | { ok: false; lost: true };

/** One PUT of the recording, with a timeout that allows a slow phone connection (about 50 kB/s). */
async function putRecording(up: { url: string; method: string; headers: Record<string, string> }, blob: Blob, abort: AbortSignal): Promise<void> {
  const timeoutMs = 30_000 + Math.ceil(blob.size / 50_000) * 1000;
  // AbortSignal.any is Safari 17.4+: older iPhones get the timeout through a timer instead
  let timer: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal = abort;
  if (typeof AbortSignal.any === "function") signal = AbortSignal.any([abort, AbortSignal.timeout(timeoutMs)]);
  else {
    const both = new AbortController();
    abort.addEventListener("abort", () => both.abort(), { once: true });
    timer = setTimeout(() => both.abort(), timeoutMs);
    signal = both.signal;
  }
  try {
    const put = await fetch(up.url, { method: up.method, headers: up.headers, body: blob, signal });
    if (!put.ok) throw new Error(`upload ${put.status}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function timing(visitId: string) {
  if (!window.__rpVisit || window.__rpVisit.visitId !== visitId) {
    window.__rpVisit = { visitId, startedAt: null, speed: 1, captions: {}, cards: {}, finals: {}, times: {} };
  }
  return window.__rpVisit;
}

function markCards(view: VisitView) {
  const tm = timing(view.visit.id);
  const now = Date.now();
  tm.anchors ??= {};
  for (const c of view.cards) {
    tm.cards[c.id] ??= now;
    tm.anchors[c.id] ??= c.anchor;
  }
  if (view.qlist) tm.cards[`qlist-${view.qlist.anchor}`] ??= now;
}

async function getJson<T>(path: string, sessionId: string): Promise<T> {
  const res = await fetch(withSession(path, sessionId), { credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data as T;
}

export function VisitFlow({
  sessionId,
  locale,
  replays,
  initialView,
  initialMode,
  autoReplay,
  speed = 1,
  crew = false,
  laterReplays = false,
  unfinished = [],
}: {
  sessionId: string;
  locale: Locale;
  replays: ReplayOption[];
  initialView: VisitView | null;
  initialMode: "record" | "replay";
  autoReplay: { fixture: string; speed: number } | null;
  /** mock realtime clock factor (tests); 1 = real time */
  speed?: number;
  /** /p/visit?crew=1: on a filming phone that is not the crew's yet, show the crew-key field (the sign-in door) */
  crew?: boolean;
  /** some sample visits are later in the story and not offered yet */
  laterReplays?: boolean;
  /** C2: visits started and not finished, listed on top of the consent step */
  unfinished?: UnfinishedOption[];
}) {
  const router = useRouter();
  const recorder = useWavRecorder();
  // the scripted-fallback switch is the crew's (real-app 5.2, one gate): it shows on a browser that carries the crew's
  // cookie, or that just signed in with the key field below; its route answers anyone else 404
  const crewBrowser = useCrewBrowser();
  const [signedIn, setSignedIn] = useState(false);
  const crewHere = crewBrowser || signedIn;
  const [phase, setPhase] = useState<"start" | "declined" | "live">(initialView ? "live" : "start");
  const [mode, setMode] = useState<"record" | "replay">(initialMode);
  const [view, setView] = useState<VisitView | null>(initialView);
  const [partials, setPartials] = useState<PartialCaption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [slowEnd, setSlowEnd] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  /** the speech service could not make the record; the recording is saved and End visit will be tried again */
  const [deferred, setDeferred] = useState(false);
  /** the recording of this visit, kept until the visit is finished (and its uploaded path, once uploaded) */
  const pending = useRef<{ blob: Blob | null; path: string | null }>({ blob: null, path: null });
  /** live Whisper captions on this visit: how many lines were stored (null = not used) */
  const whisperLines = useRef<number | null>(null);
  const jobRef = useRef<string | null>(null);
  const skipAudio = useRef(false);
  const putAbort = useRef<AbortController | null>(null);
  const visitId = useRef<string | null>(initialView?.visit.id ?? null);
  const started = useRef(false);
  const live = useRef<LiveWhisperClient<VisitView, { id: string; t_start_ms: number; t_end_ms: number }> | null>(null);
  /** line ids already final (a late partial for them is ignored) */
  const finalIds = useRef<Set<string>>(new Set());
  /** recorder blocks from before the live client starts (null: not buffering) */
  const early = useRef<EarlyBlocks | null>(null);
  /** the latest end(), for the deferred retry */
  const endRef = useRef<(() => Promise<void>) | null>(null);
  /** automatic retries of a deferred record so far (MAX_AUTO_RETRIES) */
  const autoRetries = useRef(0);

  // timing hooks for a reopened visit: only what the first render showed (later server refreshes do not
  // replace the live state, so they must not count as "seen" either)
  // leaving the page: no more live chunks from this screen
  useEffect(
    () => () => {
      void live.current?.stop(0);
      live.current = null;
    },
    [],
  );

  const mountedView = useRef(initialView);
  useEffect(() => {
    const v = mountedView.current;
    if (v) {
      const tm = timing(v.visit.id);
      tm.startedAt ??= v.stream.startedAt;
      tm.speed = v.stream.speed;
      markCards(v);
    }
  }, []);

  useLiveEvent((event: BusEvent) => {
    const id = visitId.current;
    if (!id) return;
    if (event.type === "asr.partial") {
      const d = event.data as PartialData;
      if (d.visit_id !== id) return;
      const tm = timing(id);
      tm.startedAt ??= d.started_at;
      tm.speed = d.speed;
      if (finalIds.current.has(d.utterance.id)) return;
      tm.captions[d.utterance.id] ??= Date.now();
      tm.times[d.utterance.id] = [d.utterance.t_start_ms, d.utterance.t_end_ms];
      setPartials((ps) => [...ps.filter((p) => p.id !== d.utterance.id), { id: d.utterance.id, text: d.utterance.text, t_start_ms: d.utterance.t_start_ms }]);
    } else if (event.type === "asr.final") {
      const d = event.data as FinalData;
      if (d.visit_id !== id) return;
      const tm = timing(id);
      const now = Date.now();
      for (const u of d.utterances) {
        tm.captions[u.id] ??= now;
        tm.finals[u.id] ??= now;
        tm.times[u.id] = [u.t_start_ms, u.t_end_ms];
        finalIds.current.add(u.id);
      }
      const done = new Set(d.utterances.map((u) => u.id));
      setPartials((ps) => ps.filter((p) => !done.has(p.id)));
      setView(d.view);
      markCards(d.view);
    }
  }, LIVE_TYPES);

  async function begin(kind: "record" | "replay", fixture?: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const out = await postJson<{ view: VisitView }>("/api/visits", sessionId, {
        mode: kind,
        ...(kind === "replay"
          ? { fixture }
          : { consent: { given: true, at: new Date().toISOString(), statement: vt(locale, "consent.statement") } }),
      });
      const v = out.view;
      visitId.current = v.visit.id;
      const tm = timing(v.visit.id);
      tm.captions = {};
      tm.cards = {};
      tm.finals = {};
      tm.times = {};
      tm.startedAt = null;
      setView(v);
      setPartials([]);
      setMode(kind);
      pending.current = { blob: null, path: null };
      whisperLines.current = null;
      setPhase("live");
      window.history.replaceState(null, "", `/p/visit?visit=${encodeURIComponent(v.visit.id)}&mode=${kind}${crew ? "&crew=1" : ""}`);

      if (kind === "record") {
        const ok = await recorder.start();
        // no microphone: said plainly on the screen (micNotice below), with no running dot, timer or waveform
        if (ok) attachRecorder();
        try {
          const tok = await postJson<{
            provider: string;
            live?: Partial<LiveTuning>;
            partials?: boolean;
            delay_ms?: number;
            replay?: string | null;
            fallback?: { reason: string; replay: string | null };
          }>("/api/asr/realtime-token", sessionId, { visit_id: v.visit.id });
          // whisper, or tencent (whole lines only: partials false, a longer delay before "late")
          const server = tok.provider === "whisper" || tok.provider === "tencent";
          if (server && ok) {
            startLive(v.visit.id, tok.live ?? {}, { partials: tok.partials !== false, delayMs: tok.delay_ms });
            return;
          }
          early.current = null; // no live captions on this visit: nothing to hand over
          if (tok.fallback) setNotice(vt(locale, tok.fallback.replay ? "live.asrFallback" : "live.asrFallbackNoReplay"));
          // the developer tools' stand-in (devfake) plays the visit's replay as the live captions, like mock
          if (tok.provider !== "mock" && !server && tok.provider !== "devfake") return;
          // whisper without a microphone, or Whisper not answering: the replay stands in on screen only when the
          // server offers one (a replay file for this visit, and ASR_REPLAY_FALLBACK on)
          const offered = tok.fallback ? tok.fallback.replay : server ? (tok.replay ?? null) : undefined;
          if (offered === null) return;
        } catch (err) {
          early.current = null;
          setNotice(err instanceof ApiError && err.status === 503 ? vt(locale, "live.noScript") : vt(locale, "ctrl.failed"));
          return;
        }
        if (!v.replayable) {
          setNotice((n) => n ?? vt(locale, "live.noScript"));
          return;
        }
      }
      await startReplay(v.visit.id, kind === "record" ? "live" : "replay");
    } catch {
      setNotice(vt(locale, "ctrl.failed"));
    } finally {
      setBusy(false);
    }
  }

  /** From the recorder's first block: its clock, and the blocks kept until the live client starts (if it does). */
  function attachRecorder() {
    const clock = new BlockClock();
    window.__rpRecorder = clock.trace;
    early.current = new EarlyBlocks();
    recorder.setListener((block, rate) => {
      clock.observe(block.length, rate, Date.now());
      const client = live.current;
      if (client) client.feed(block, rate);
      else early.current?.push(block, rate);
    });
  }

  async function startReplay(id: string, source: "live" | "replay") {
    const r = await postJson<{ started_at: number; speed: number }>(`/api/visits/${encodeURIComponent(id)}/replay`, sessionId, { speed, source });
    const tm = timing(id);
    tm.startedAt = r.started_at;
    tm.speed = r.speed;
  }

  /** SPEECH_PROVIDER=whisper or tencent: microphone blocks -> chunks (whisper only) and lines -> /api/asr/chunk. */
  function startLive(id: string, tuning: Partial<LiveTuning>, how: { partials: boolean; delayMs?: number } = { partials: true }) {
    finalIds.current = new Set();
    whisperLines.current = 0;
    const delayed = vt(locale, "live.asrDelayed");
    const lost = vt(locale, "live.asrLineLost");
    const client = new LiveWhisperClient<VisitView, { id: string; t_start_ms: number; t_end_ms: number }>({
      sessionId,
      visitId: id,
      tuning,
      partials: how.partials,
      ...(how.delayMs ? { delayMs: how.delayMs } : {}),
      onCaption: (c) => {
        if (finalIds.current.has(c.id)) return;
        const tm = timing(id);
        tm.captions[c.id] ??= Date.now();
        setPartials((ps) => [...ps.filter((p) => p.id !== c.id), c]);
      },
      onDrop: (lineId) => setPartials((ps) => ps.filter((p) => p.id !== lineId)),
      onFinal: ({ view: next, utterances }) => {
        const tm = timing(id);
        const now = Date.now();
        for (const u of utterances) {
          tm.captions[u.id] ??= now;
          tm.finals[u.id] ??= now;
          tm.times[u.id] = [u.t_start_ms, u.t_end_ms];
          finalIds.current.add(u.id);
        }
        const done = new Set(utterances.map((u) => u.id));
        whisperLines.current = (whisperLines.current ?? 0) + utterances.length;
        setPartials((ps) => ps.filter((p) => !done.has(p.id)));
        if (next) {
          // the event stream may already have brought a newer screen: never go back to an older one
          setView((cur) => (cur && cur.visit.id === next.visit.id && cur.lines.length > next.lines.length ? cur : next));
          markCards(next);
        }
      },
      onFallback: (_reason, replay) => {
        live.current = null; // the recorder's listener feeds nothing more (it keeps the clock)
        setPartials([]);
        setNotice(vt(locale, replay ? "live.asrFallback" : "live.asrFallbackNoReplay"));
        if (replay) void startReplay(id, "live").catch(() => setNotice(vt(locale, "ctrl.failed")));
      },
      // late captions: said while it lasts, unless a more important notice is up
      onDelay: (on) => setNotice((n) => (on ? (n ?? delayed) : n === delayed ? null : n)),
      // a line that got no caption: said once (its words are in the recording)
      onLineLost: () => setNotice((n) => (n && n !== delayed ? n : lost)),
    });
    // what he said before this client existed goes first, in order: its sample 0 is the recording's sample 0
    const buffered = early.current ? early.current.drain((b, r) => client.feed(b, r)) : 0;
    early.current = null;
    client.markAttached(buffered);
    live.current = client;
  }

  useEffect(() => {
    if (autoReplay && !started.current && !initialView) {
      started.current = true;
      void begin("replay", autoReplay.fixture);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cancelJob(jobId: string) {
    try {
      await fetch(withSession(`/api/asr/jobs/${encodeURIComponent(jobId)}`, sessionId), { method: "DELETE", credentials: "same-origin" });
    } catch {
      // the job then finishes on its own
    }
  }

  /** "Keep the live captions": stop waiting for the full recording (or skip a failed upload). */
  function keepLiveCaptions() {
    if (ending) {
      skipAudio.current = true;
      putAbort.current?.abort();
      if (jobRef.current) void cancelJob(jobRef.current);
      return;
    }
    void end({ skipAudio: true });
  }

  /** Wait for a transcript job. "lost": the server no longer knows it (it restarted; it put the visit back to recording). */
  async function pollJob(id: string, jobId: string, deadline: number): Promise<PollOutcome> {
    for (;;) {
      let st: { status: string; deferred?: boolean };
      try {
        st = await getJson<{ status: string; deferred?: boolean }>(`/api/asr/jobs/${encodeURIComponent(jobId)}?visit_id=${encodeURIComponent(id)}`, sessionId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404 && err.code === "job_not_found") return { ok: false, lost: true };
        throw err;
      }
      if (st.status === "done") return { ok: true, jobId };
      if (st.status === "failed") return { ok: false, deferred: st.deferred === true };
      if (Date.now() > deadline) throw new Error("speech job timed out");
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /**
   * Create the whole-visit transcript job and wait for it. A job the server no longer knows (it restarted: 404
   * job_not_found; the server puts the visit back to "recording") is created once more.
   */
  async function transcribe(id: string, audio: { path: string | null }, missing: string | null): Promise<JobOutcome> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const job = await postJson<{ job_id: string; wait_ms?: number }>(
        `/api/asr/jobs${missing && !audio.path ? `?audio_missing=${missing}` : ""}`,
        sessionId,
        { visit_id: id, ...(audio.path ? { audio_path: audio.path } : {}) },
      );
      jobRef.current = job.job_id;
      // "Keep the live captions" tapped while the job was being created
      if (skipAudio.current && audio.path) void cancelJob(job.job_id);
      // the whole-visit transcript of a long recording takes a while on Whisper: the server says how long
      const out = await pollJob(id, job.job_id, Date.now() + Math.max(120_000, Math.min(job.wait_ms ?? 0, 3_600_000)));
      if (!("lost" in out)) return out;
    }
    throw new Error("speech job lost");
  }

  /** The page reopened a visit that is "transcribing": wait for its job and finish, or let End visit work again. */
  async function resume(id: string) {
    let r: { job_id: string | null; visit_status?: VisitView["visit"]["status"] };
    try {
      r = await getJson<{ job_id: string | null; visit_status?: VisitView["visit"]["status"] }>(`/api/asr/jobs?visit_id=${encodeURIComponent(id)}`, sessionId);
    } catch {
      return; // the page stays as it is
    }
    const showStatus = (status: VisitView["visit"]["status"]) =>
      setView((cur) => (cur && cur.visit.id === id ? { ...cur, visit: { ...cur.visit, status } } : cur));
    if (!r.job_id) {
      if (r.visit_status) showStatus(r.visit_status);
      return;
    }
    setEnding(true);
    setEndError(false);
    try {
      const out = await pollJob(id, r.job_id, Date.now() + 3_600_000);
      if (out.ok) {
        await postJson(`/api/visits/${encodeURIComponent(id)}/finalize`, sessionId, { job_id: out.jobId });
        router.push(`/p/visit/${encodeURIComponent(id)}/review`);
        return;
      }
      // failed or lost: the server put the visit back to recording; End visit uses the recording saved on it
      showStatus("recording");
      if (!("lost" in out)) {
        if (out.deferred) setDeferred(true);
        setEndError(true);
      }
      setEnding(false);
    } catch {
      showStatus("recording");
      setEndError(true);
      setEnding(false);
    }
  }

  // a visit reopened while "transcribing" (the page was reloaded, or the web server restarted meanwhile)
  useEffect(() => {
    const v = mountedView.current;
    if (v && v.visit.status === "transcribing") void resume(v.visit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function end(opts: { skipAudio?: boolean } = {}) {
    const id = visitId.current;
    if (!id || ending) return;
    setEnding(true);
    setEndError(false);
    setUploadFailed(false);
    setSlowEnd(false);
    setDeferred(false);
    skipAudio.current = opts.skipAudio === true;
    jobRef.current = null;
    const slow = window.setTimeout(() => setSlowEnd(true), SLOW_END_MS);
    try {
      if (live.current) {
        // the line in progress is finished and stored before the recorder stops (at most 3 s)
        await live.current.stop(3000);
        live.current = null;
        recorder.setListener(null);
      }
      // the recording is kept until the visit is finished: a second tap after a failure sends the same one
      const audio = pending.current;
      if (!audio.blob && (recorder.state === "recording" || recorder.state === "paused")) audio.blob = await recorder.stop();
      let missing: "too_large" | "upload_failed" | "skipped" | null = null;
      if (audio.blob && audio.blob.size > 44 && !audio.path && !skipAudio.current) {
        const up = await postJson<{ url: string; method: string; headers: Record<string, string>; path: string; max_bytes?: number }>(
          "/api/upload-url",
          sessionId,
          { kind: "recording", content_type: audio.blob.type, visit_id: id },
        );
        if (typeof up.max_bytes === "number" && audio.blob.size > up.max_bytes) {
          // longer than the store keeps (about 27 minutes): the record keeps the live captions
          missing = "too_large";
          setNotice(vt(locale, "ctrl.tooLong"));
        } else {
          const abort = new AbortController();
          putAbort.current = abort;
          try {
            try {
              await putRecording(up, audio.blob, abort.signal);
            } catch (err) {
              if (skipAudio.current) throw err;
              await new Promise((r) => setTimeout(r, 1000)); // one more try on a dropped connection
              await putRecording(up, audio.blob, abort.signal);
            }
            audio.path = up.path;
          } catch (err) {
            if (!skipAudio.current) {
              setUploadFailed(true);
              throw err;
            }
          } finally {
            putAbort.current = null;
          }
        }
      }
      if (!audio.path && skipAudio.current) missing = "skipped";
      const outcome = await transcribe(id, audio, missing);
      if (!outcome.ok) {
        // the recording is saved on the visit: the record is made once the speech service is back
        if (outcome.deferred) setDeferred(true);
        throw new Error("speech job failed");
      }
      await postJson(`/api/visits/${encodeURIComponent(id)}/finalize`, sessionId, { job_id: outcome.jobId });
      pending.current = { blob: null, path: null };
      router.push(`/p/visit/${encodeURIComponent(id)}/review`);
    } catch {
      setEndError(true);
      setEnding(false);
    } finally {
      window.clearTimeout(slow);
      setSlowEnd(false);
      jobRef.current = null;
    }
  }

  endRef.current = () => end();

  // deferred: the recording is saved and the speech service is down. Check every RETRY_LATER_MS; once it answers,
  // End visit again by itself (he can also tap it), at most MAX_AUTO_RETRIES times (a service that answers its
  // health check but keeps failing the record must not loop). Stops when the page goes away.
  useEffect(() => {
    if (!deferred || autoRetries.current >= MAX_AUTO_RETRIES) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/api/asr/health", { credentials: "same-origin", cache: "no-store" });
          const h = (await res.json().catch(() => ({}))) as { whisper?: { healthy?: boolean }; tencent?: { healthy?: boolean } };
          // the server's transcription service answers again (Whisper, or Tencent Cloud speech recognition)
          if (!stopped && (h.whisper?.healthy === true || h.tencent?.healthy === true)) {
            stopped = true;
            window.clearInterval(timer);
            autoRetries.current += 1;
            void endRef.current?.();
          }
        } catch {
          // not reachable either: try again at the next tick
        }
      })();
    }, RETRY_LATER_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [deferred]);

  // C2 follow-up (real-app 10, 12 「没有麦克风时计时停在 0:00」): in record mode the screen says what the microphone is
  // doing. "off": the browser gave none (the recorder could not start): nothing is being recorded, and the screen says
  // whether the lines it shows are the sample replay standing in or whether no words will come. "idle": this screen is
  // not capturing (a visit reopened after a reload): no dot and no waveform either, without a sentence of its own.
  const mic: "on" | "off" | "idle" | null =
    mode !== "record" ? null : recorder.state === "recording" || recorder.state === "paused" ? "on" : recorder.state === "unavailable" ? "off" : "idle";
  const standInLines = !!view && (view.stream.state === "running" || view.lines.length > 0 || partials.length > 0);
  const micNotice = mic === "off" && view?.visit.status === "recording" ? demoText(locale, standInLines ? "visit.noMic.replay" : "visit.noMic.nothing") : null;

  // "Keep the live captions": only when this visit has live Whisper lines to keep
  const hasLiveLines = (whisperLines.current ?? 0) > 0;
  const offerLive = hasLiveLines && ((ending && slowEnd) || (endError && uploadFailed));
  const shownNotice =
    ending && slowEnd && hasLiveLines
      ? vt(locale, "ctrl.slow")
      : endError && uploadFailed
        ? vt(locale, "ctrl.uploadFailed")
        : endError && deferred
          ? vt(locale, "ctrl.savedLater")
          : (micNotice ?? notice);

  async function setFallback(on: boolean) {
    const id = visitId.current;
    if (!id) return;
    try {
      const out = await postJson<{ fallback: VisitView["fallback"] }>(`/api/visits/${encodeURIComponent(id)}/scripted`, sessionId, { on });
      setView((v) => (v ? { ...v, fallback: out.fallback } : v));
    } catch {
      setNotice(vt(locale, "ctrl.failed"));
    }
  }

  /**
   * The key field on a filming phone that is not the crew's yet (/p/visit?crew=1). The key goes to the crew's sign-in
   * door (POST /api/session/crew, the same as /backstage/crew: the one place that says "wrong key" or "too many"); with
   * the cookie it leaves, this browser is the crew's and the switch is turned on through the gated route.
   */
  async function unlock(key: string): Promise<UnlockResult> {
    const id = visitId.current;
    if (!id) return "failed";
    try {
      await postJson("/api/session/crew", null, { key });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) return "locked";
        if (err.code === "crew_key_wrong" || err.code === "crew_key_required") return "wrong";
      }
      return "failed";
    }
    setSignedIn(true);
    try {
      const out = await postJson<{ fallback: VisitView["fallback"] }>(`/api/visits/${encodeURIComponent(id)}/scripted`, sessionId, { on: true });
      setView((v) => (v ? { ...v, fallback: out.fallback } : v));
      return "ok";
    } catch {
      return "failed";
    }
  }

  if (phase === "live" && view) {
    return (
      <VisitScreen
        view={view}
        partials={partials}
        locale={locale}
        mode={mode}
        mic={mic}
        notice={shownNotice}
        paused={paused}
        onPause={
          mode === "record" && (recorder.state === "recording" || recorder.state === "paused")
            ? () => {
                if (!paused) live.current?.pause();
                recorder.pause(!paused);
                setPaused(!paused);
              }
            : null
        }
        onEnd={() => void end()}
        ending={ending}
        endError={endError && !deferred}
        onUseLive={offerLive ? keepLiveCaptions : null}
        onFallback={view.fallback.allowed && crewHere ? setFallback : null}
        onUnlock={crew && view.fallback.allowed && view.fallback.unlockable && !crewHere ? unlock : null}
      />
    );
  }
  return (
    <ConsentStep
      locale={locale}
      declined={phase === "declined"}
      busy={busy}
      notice={notice}
      replays={replays}
      laterReplays={laterReplays}
      unfinished={unfinished}
      onConsent={(given) => (given ? void begin("record") : setPhase("declined"))}
      onBack={() => setPhase("start")}
      onReplay={(fixture) => void begin("replay", fixture)}
    />
  );
}
