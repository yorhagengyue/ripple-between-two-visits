"use client";

/**
 * Mr Tan's demo phone follows the director (real-status: "剧本场景只改日子，不翻手机页面"): when the director jumps to a
 * scene, or starts a visit replay, the director's cue (director.cue { cue: "show", path }, lib/crew/cues.ts) names one of
 * his pages and this phone opens it, as if he had tapped there himself. Only his pages are ever opened (a path under
 * /p/, checked by showCueOf); the page it is already on is not opened again. Mounted by components/patient/PatientFrame
 * on his pages only (her /f never gets director.cue: lib/family/events.ts drops it), and, since the C2 follow-up, by
 * app/p/layout.tsx on a filming account's own phone: laying that account out to a scene (lib/crew/filming-account.ts
 * seedToMoment) sends the same cue. Renders nothing.
 */
import { useRouter } from "next/navigation";
import { useLiveEvent } from "@/components/live/LiveSession";
import { showCueOf } from "@/lib/crew/cues";

export function SceneFollower(): null {
  const router = useRouter();
  useLiveEvent(
    (event) => {
      const cue = showCueOf(event.data);
      if (!cue) return;
      if (`${window.location.pathname}${window.location.search}` === cue.path) return;
      // the same page with another query (the visit page opening a replay) keeps its client state on a soft navigation
      // and would not start the replay: load it afresh instead
      const samePage = new URL(cue.path, window.location.origin).pathname === window.location.pathname;
      if (cue.why === "replay" || samePage) window.location.assign(cue.path);
      else router.push(cue.path);
    },
    ["director.cue"],
  );
  return null;
}
