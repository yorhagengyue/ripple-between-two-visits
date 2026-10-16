"use client";
/**
 * The run part of /backstage/real: pick a consultation, run it through the real Whisper service, show the
 * doctor's-note cards (each the doctor's sentence as heard, with its time point) and the safety report, and the
 * whole transcript underneath. Polls GET /api/real/<job> every second; every failure says what happened (no silent
 * retry loop: three failed polls in a row stop and say so). Existing styles only (rp-card, rp-btn).
 */
import { useEffect, useRef, useState } from "react";
import { vt, type VisitKey } from "@/lib/visit/strings";

interface Consultation {
  id: string;
  day: number;
  consultation: number;
  presenting_complaint: string;
  duration_s: number;
  available: boolean;
}
interface Line {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  text: string;
  speaker: "doctor" | "patient" | "unknown";
}
interface Card {
  id: string;
  type: string;
  variant: string;
  quote: string;
  line_id: string;
  t_start_ms: number;
  t_end_ms: number;
  by: "rules" | "model";
}
interface Result {
  consultation: Omit<Consultation, "available">;
  whisper: { model: string | null; transcribe_ms: number; segments: number };
  lines: Line[];
  speakers: { doctor: number; patient: number; unknown: number; method: string };
  cards: Card[];
  extraction: { source: string; provider: string | null; model: string | null; added: number; rejected: number; error: string | null };
  safety: { checked: number; passed: number; blocked: { card_id: string; layer: number; reasons: string[] }[]; never_cross: number };
}
interface Job {
  job_id: string;
  state: "transcribing" | "extracting" | "checking" | "done" | "failed";
  progress: { done: number | null; total: number | null } | null;
  error: string | null;
  result: Result | null;
}
interface Status {
  whisper: { usable: boolean; reason: string | null };
  extraction: { mode: string; provider: string; model: string | null };
  access: { allowed: boolean; detail?: string };
  running: { job_id?: string; busy?: boolean } | null;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const SPEAKER: Record<Line["speaker"], string> = { doctor: "Doctor", patient: "Patient", unknown: "?" };

const ERRORS: Record<string, string> = {
  filming_only: "Running it needs filming mode: sign in at /backstage/crew with the crew key, or open it from a filming session.",
  crew_key_wrong: "That is not the crew key.",
  crew_key_attempts: "Too many wrong crew keys. Try again in ten minutes.",
  data_missing: "The recording is not on this machine. In web/, run: node scripts/data/fetch_primock57.mjs",
  busy: "Another run is using the speech service. Wait for it to finish.",
  whisper_unavailable: "The Whisper service is not answering. Start it with services/whisper/start.ps1, then try again.",
  unknown_consultation: "That consultation is not in the manifest.",
};

function failure(code: string | null): string {
  if (!code) return "The run did not finish.";
  if (code.startsWith("whisper_")) return `Whisper did not make the transcript (${code.slice(8)}). Nothing was shown from it.`;
  return ERRORS[code] ?? `The run did not finish (${code}).`;
}

export function RealDemo({ consultations, allowed }: { consultations: Consultation[]; allowed: boolean }) {
  const first = consultations.find((c) => c.available) ?? consultations[0];
  const [picked, setPicked] = useState(first?.id ?? "");
  const [status, setStatus] = useState<Status | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const polling = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/real", { credentials: "same-origin", cache: "no-store" })
      .then((r) => r.json())
      .then((s: Status) => {
        if (alive) setStatus(s);
      })
      .catch(() => {
        if (alive) setError("Could not ask the server whether the speech service is up.");
      });
    return () => {
      alive = false;
      if (polling.current) window.clearTimeout(polling.current);
    };
  }, []);

  function poll(id: string, misses = 0) {
    polling.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/real/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
        const body = (await res.json()) as Job & { error?: string };
        if (!res.ok) {
          setError(failure(body.error ?? `http_${res.status}`));
          return;
        }
        setJob(body);
        if (body.state !== "done" && body.state !== "failed") poll(id, 0);
      } catch {
        if (misses + 1 >= 3) setError("Lost contact with the server while the run was going. Reload the page to see it again.");
        else poll(id, misses + 1);
      }
    }, 1000);
  }

  async function run() {
    setError(null);
    setJob(null);
    setStarting(true);
    try {
      const res = await fetch("/api/real", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consultation: picked }),
      });
      const body = (await res.json().catch(() => ({}))) as { job_id?: string; error?: string; reason?: string };
      if (res.status !== 202 || !body.job_id) {
        setError(body.error === "whisper_unavailable" ? `${ERRORS.whisper_unavailable} (${body.reason ?? "unknown"})` : failure(body.error ?? `http_${res.status}`));
        return;
      }
      setJob({ job_id: body.job_id, state: "transcribing", progress: null, error: null, result: null });
      poll(body.job_id);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setStarting(false);
    }
  }

  const selected = consultations.find((c) => c.id === picked);
  const busy = starting || (job !== null && job.state !== "done" && job.state !== "failed");
  // the server's answer wins once it is in (the page may have been rendered before the crew signed in)
  const mayRun = status ? status.access.allowed : allowed;
  const canRun = mayRun && !!selected?.available && status?.whisper.usable === true && !busy;
  const r = job?.result ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="real-demo">
      <section className="rp-card flex min-w-0 flex-col gap-3" aria-label="Run it">
        <h2 className="text-[19px] font-bold">Pick a consultation</h2>
        <ul className="flex flex-col gap-2" data-testid="real-consultations">
          {consultations.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-3 text-[17px]">
                <input type="radio" name="consultation" value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id)} disabled={busy} data-testid={`real-pick-${c.id}`} />
                <span>
                  <span className="font-semibold">Day {c.day}, consultation {c.consultation}</span> · {Math.round(c.duration_s / 60)} min · presenting complaint (as
                  the dataset gives it): &ldquo;{c.presenting_complaint}&rdquo;
                  {c.available ? null : <span className="text-ink-2"> · not on this machine</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[16px] text-ink-2" data-testid="real-mode">
          Speech: {status ? (status.whisper.usable ? "the Whisper service on this laptop (large-v3, whole recording)" : `the Whisper service is not usable now (${status.whisper.reason})`) : "checking…"}.
          Extraction:{" "}
          {status ? (status.extraction.mode === "rules" ? "the deterministic rules (no model configured)" : `the rules plus ${status.extraction.provider} ${status.extraction.model ?? ""}, every label checked in code`) : "…"}.
        </p>
        {!mayRun ? (
          <p className="text-[17px]" data-testid="real-locked">
            {ERRORS.filming_only}
          </p>
        ) : null}
        <div>
          <button type="button" className="rp-btn rp-btn-accent" onClick={() => void run()} disabled={!canRun} data-testid="real-run">
            {busy ? "Running…" : "Run it with the real Whisper"}
          </button>
        </div>
        {job && job.state !== "done" && job.state !== "failed" ? (
          <p className="text-[17px]" data-testid="real-progress" aria-live="polite">
            {job.state === "transcribing"
              ? `Transcribing the whole recording${job.progress?.total ? `: ${job.progress.done ?? 0} of ${job.progress.total} stretches of speech` : "…"}`
              : job.state === "extracting"
                ? "Labelling the doctor's sentences…"
                : "Checking every card…"}
          </p>
        ) : null}
        {job?.state === "failed" ? (
          <p className="text-[17px] font-semibold" role="alert" data-testid="real-failed">
            {failure(job.error)}
          </p>
        ) : null}
        {error ? (
          <p className="text-[17px] font-semibold" role="alert" data-testid="real-error">
            {error}
          </p>
        ) : null}
      </section>

      {r ? (
        <>
          <section className="rp-card flex min-w-0 flex-col gap-2" data-testid="real-summary" aria-label="What happened">
            <h2 className="text-[19px] font-bold">What happened</h2>
            <p className="text-[17px]">
              Whisper ({r.whisper.model ?? "unknown model"}) transcribed {clock(r.consultation.duration_s * 1000)} of audio in{" "}
              {(r.whisper.transcribe_ms / 1000).toFixed(1)} s: {r.lines.length} sentences ({r.speakers.doctor} the doctor&apos;s, {r.speakers.patient} the
              patient&apos;s, {r.speakers.unknown} not clearly either). Who said a sentence comes from {r.speakers.method}; Ripple did not guess it.
            </p>
            <p className="text-[17px]" data-testid="real-extraction">
              Items: {r.extraction.source === "rules+model" ? `the rules plus ${r.extraction.provider} ${r.extraction.model ?? ""} (${r.extraction.added} added, ${r.extraction.rejected} labels dropped by the checks)` : r.extraction.error ? `the rules only (the model did not answer: ${r.extraction.error})` : "the rules only"}.
            </p>
            <p className="text-[17px]" data-testid="real-safety" data-never-cross={r.safety.never_cross} data-withheld={r.safety.blocked.length}>
              Safety layer: {r.safety.checked} cards checked, {r.safety.passed} shown, {r.safety.blocked.length} withheld; cards not word for word the
              doctor&apos;s sentence: {r.safety.never_cross}.
            </p>
          </section>

          <section className="flex min-w-0 flex-col gap-3" aria-label="Doctor's notes" data-testid="real-cards">
            <h2 className="text-[22px] font-bold">Doctor&apos;s notes ({r.cards.length})</h2>
            {r.cards.length === 0 ? <p className="text-[17px]">No sentence of the doctor&apos;s matched a card type.</p> : null}
            {r.cards.map((c) => (
              <article key={c.id} className="rp-card flex min-w-0 flex-col gap-1" data-testid="real-card" data-line={c.line_id} data-by={c.by}>
                <p className="text-[15px] font-semibold uppercase tracking-wide text-ink-2">
                  {vt("en", `variant.${c.variant}` as VisitKey) || c.variant} · <span data-testid="real-card-time">{clock(c.t_start_ms)}</span> · Doctor (as the
                  dataset marks it){c.by === "model" ? " · labelled by the model, checked in code" : ""}
                </p>
                <blockquote className="border-l-4 border-ink pl-3 text-[19px] leading-snug [overflow-wrap:anywhere]" data-testid="real-card-quote">
                  {c.quote}
                </blockquote>
              </article>
            ))}
          </section>

          <details className="rp-card min-w-0" data-testid="real-transcript">
            <summary className="cursor-pointer text-[19px] font-bold">The whole transcript ({r.lines.length} sentences)</summary>
            <ol className="mt-3 flex flex-col gap-1.5 text-[16px]">
              {r.lines.map((l) => (
                <li key={l.id} data-testid="real-line" data-speaker={l.speaker} data-id={l.id} className="[overflow-wrap:anywhere]">
                  <span className="font-mono text-ink-2">{clock(l.t_start_ms)}</span> <span className="font-semibold">{SPEAKER[l.speaker]}</span>: {l.text}
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : null}
    </div>
  );
}
