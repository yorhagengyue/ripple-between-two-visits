"use client";

/**
 * Is this browser the film crew's? The rp_crew cookie is httpOnly, so a client component asks GET /api/session/crew
 * when it mounts and learns { crew: boolean }. Until the answer is in, the answer is false: the crew's chrome (the jump
 * menu, the debug line on a demo phone) appears a moment later for the crew and never for anyone else (real-app 5.2).
 * The phone frame stays mounted across tab navigation (app/p/layout.tsx), so this is one request per phone page load.
 */
import { useEffect, useState } from "react";

export function useCrewBrowser(): boolean {
  const [crew, setCrew] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/session/crew", { credentials: "same-origin", cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ crew?: unknown }>) : { crew: false }))
      .then((data) => {
        if (alive) setCrew(data.crew === true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return crew;
}
