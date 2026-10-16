"use client";

/**
 * Creating a session from the browser (server components cannot set cookies):
 * - <SandboxStarter/> creates a judge sandbox on mount, then re-renders the page. Used by "/" and /try
 *   so every judge gets an own copy without a redirect ("/" answers 200 for any client).
 * - <StartSessionButton/> does the same on click (patient "start my own sandbox", director "new
 *   filming session").
 * POST /api/session sets the rp_session cookie; router.refresh() then renders with it.
 *
 * A filming session is the film crew's (lib/crew/gate.ts). Without the crew POST /api/session answers 404 not_found
 * (a typed wrong key is the same 404: one gate) and sets no cookie, so a judge stays in their own sandbox; the button then
 * says so in plain words, with a link to /backstage/crew where the crew types the key once.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { CreateSessionBody } from "@/lib/session/schemas";

export class StartSessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`POST /api/session ${status}${code ? ` ${code}` : ""}`);
    this.name = "StartSessionError";
  }
}

/** POST /api/session from the browser; a refusal rejects with the status and the route's error code. */
export async function createSession(body: Partial<CreateSessionBody>): Promise<void> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new StartSessionError(res.status, typeof data?.error === "string" ? data.error : null);
  }
}

const CREW_KEY_CODES = new Set(["crew_key_required", "crew_key_wrong", "crew_key_attempts"]);

/** POST /api/session answers 404 not_found only to a filming request without the crew (lib/crew/gate.ts). */
const crewGateRefusal = (err: StartSessionError) => err.status === 404 && err.code === "not_found";

/** What the button says after a refused start: the crew key (with the crew page link), or a plain retry line. */
export function startSessionProblem(err: unknown): "crew_key" | "failed" {
  return err instanceof StartSessionError && (CREW_KEY_CODES.has(err.code ?? "") || crewGateRefusal(err)) ? "crew_key" : "failed";
}

export function SandboxStarter({ message, failedMessage }: { message: string; failedMessage: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Strict mode runs effects twice in dev; the ref keeps it to one sandbox.
    if (started.current) return;
    started.current = true;
    createSession({ kind: "sandbox", role: "judge" })
      .then(() => router.refresh())
      .catch(() => setFailed(true));
  }, [router]);

  return (
    <p className="text-lg text-ink-2" data-testid="sandbox-starter" role="status">
      {failed ? failedMessage : message}
    </p>
  );
}

export function StartSessionProblem({ problem, locale, testId = "start-session-problem" }: { problem: "crew_key" | "failed"; locale: Locale; testId?: string }) {
  return (
    <p className="text-[18px] leading-snug text-ink-2" role="alert" lang={locale} data-testid={testId} data-problem={problem}>
      {problem === "crew_key" ? (
        <>
          {t(locale, "startSession.crewKey")}{" "}
          <Link href="/backstage/crew" className="font-semibold underline" data-testid={`${testId}-crew-link`}>
            {t(locale, "startSession.crewKeyLink")} →
          </Link>
        </>
      ) : (
        t(locale, "startSession.failed")
      )}
    </p>
  );
}

export function StartSessionButton({
  body,
  label,
  className = "rp-btn rp-btn-accent",
  testId,
  then = "refresh",
  locale = "en",
  align = "start",
}: {
  body: Partial<CreateSessionBody>;
  label: string;
  className?: string;
  testId?: string;
  /** "refresh" re-renders the current page; a path navigates there with a full load */
  then?: "refresh" | string;
  /** language of the line shown when the start is refused (staff screens are English) */
  locale?: Locale;
  /** where that line sits under the button: "end" for a button at the right of a header */
  align?: "start" | "end";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"crew_key" | "failed" | null>(null);
  const button = (
    <button
      type="button"
      className={className}
      disabled={busy}
      data-testid={testId}
      onClick={() => {
        setBusy(true);
        setProblem(null);
        createSession(body)
          .then(() => (then === "refresh" ? router.refresh() : window.location.assign(then)))
          .catch((err: unknown) => setProblem(startSessionProblem(err)))
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </button>
  );
  // nothing refused: the bare button, exactly as before
  if (!problem) return button;
  return (
    <span className={`flex max-w-md flex-col gap-2 ${align === "end" ? "items-end text-right" : "items-start"}`}>
      {button}
      <StartSessionProblem problem={problem} locale={locale} testId={testId ? `${testId}-problem` : undefined} />
    </span>
  );
}
