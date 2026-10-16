"use client";

/**
 * The first visit to /demo: make the judge's own copy of Mr Tan's story (POST /api/session: a sandbox stopped on Day 29,
 * 8:15pm, the hero question's evening) and tell the server this browser is looking at the demo (POST /api/demo/view:
 * rp_view=demo, and the phone's language from the browser's), then render the page again with its cookies. Server
 * components cannot set cookies, hence this step. (It replaces the landing's sandbox starter; real-app 5.3.)
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LANDING_DAY, LANDING_TIME } from "./tour";

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(String(res.status));
}

export function DemoReady({ needCopy, needView }: { needCopy: boolean; needView: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // strict mode runs effects twice in dev; the ref keeps it to one copy
    if (started.current) return;
    started.current = true;
    (async () => {
      if (needCopy) await post("/api/session", { kind: "sandbox", role: "judge", story_day: LANDING_DAY, story_time: LANDING_TIME });
      if (needView) await post("/api/demo/view");
      router.refresh();
    })().catch(() => setFailed(true));
  }, [needCopy, needView, router]);

  return (
    <p className="text-[18px] text-ink-2" data-testid="sandbox-starter" role="status">
      {failed ? "Mr Tan's phone could not be opened. Reload the page to try again." : "Opening your own copy of Mr Tan's phone…"}
    </p>
  );
}
