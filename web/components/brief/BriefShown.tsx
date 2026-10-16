"use client";

/**
 * Tells the server that the brief is being shown to the doctor (C2 track B, second round; e2e-chains 序 19): mounted by
 * 「给医生看」 (components/brief/DoctorBrief.tsx), it posts once when the screen is really on his phone. A server render
 * alone (a prefetch) records nothing. The server keeps the page as shown: which day, which version, when
 * (lib/summary/brief-snapshot.ts). Nothing is drawn; the result is on the DOM for the tests (data-shown).
 */
import { useEffect, useRef, useState } from "react";

export function BriefShown() {
  const sent = useRef(false);
  const [state, setState] = useState<{ id: string; version: string } | "pending" | "failed">("pending");
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shown: "doctor" }), credentials: "same-origin" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { shown?: { id?: string; version?: string } };
        setState(res.ok && json.shown?.id ? { id: json.shown.id, version: json.shown.version ?? "" } : "failed");
      })
      .catch(() => setState("failed"));
  }, []);
  return <span hidden data-testid="brief-shown" data-shown={typeof state === "string" ? state : "kept"} data-version={typeof state === "string" ? "" : state.version} />;
}
