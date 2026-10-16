"use client";

/**
 * A judge's first visit to "/": create the judge's own sandbox, stopped at Day 29, 8:15pm (the hero shot), then
 * re-render with its cookie. (components/session/StartSession's SandboxStarter starts at Day 29 with no time.)
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LANDING_DAY, LANDING_TIME } from "./tour";

export function LandingSandboxStarter() {
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // strict mode runs effects twice in dev; the ref keeps it to one sandbox
    if (started.current) return;
    started.current = true;
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sandbox", role: "judge", story_day: LANDING_DAY, story_time: LANDING_TIME }),
      credentials: "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        router.refresh();
      })
      .catch(() => setFailed(true));
  }, [router]);

  return (
    <p className="text-[18px] text-ink-2" data-testid="sandbox-starter" role="status">
      {failed ? "Could not start a sandbox. Reload to try again." : "Preparing your own sandbox…"}
    </p>
  );
}
