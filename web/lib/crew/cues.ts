/**
 * The director's cues that move the phones (C2 track E), published as `director.cue` events next to the reminder and
 * "no reply" cues of lib/session/events.ts. Client-safe: types and the event-data guards only.
 *
 *   show            every patient phone in the session opens `path` (components/patient/BeatFollower): a scene's
 *                   page when the director jumps to a scene, the visit page that starts a replay
 *   replay_stopped  a running visit replay stopped pushing sentences: the director pressed "Stop replay", or moved
 *                   the clock or reset the session while it ran (real-status: the replay went on after a reset)
 *
 * Wei Ling's phone never receives director.cue (lib/family/events.ts drops every type it does not list).
 */

export interface ShowCueData {
  cue: "show";
  /** a phone page of his: /p/... (never anything else; the follower ignores other paths) */
  path: string;
  why: "scene" | "replay";
  /** the scene (lib/session/beats.ts id) when why = scene */
  beat: string | null;
}

export interface ReplayStoppedCueData {
  cue: "replay_stopped";
  /** the visits whose replay stopped */
  visits: string[];
  why: "director" | "clock" | "reset";
}

export type CrewCueData = ShowCueData | ReplayStoppedCueData;

/** Only his own pages may be opened by a cue: a relative path under /p/, no scheme, no host, no way out. */
export function isPhonePath(path: unknown): path is string {
  return typeof path === "string" && /^\/p(\/[A-Za-z0-9._~%-]+)*\/?(\?[A-Za-z0-9._~%&=-]*)?$/.test(path) && !path.includes("..");
}

/** The show cue of an event's data, or null (any other cue, or a path that is not one of his pages). */
export function showCueOf(data: unknown): ShowCueData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<ShowCueData>;
  if (d.cue !== "show" || !isPhonePath(d.path)) return null;
  return { cue: "show", path: d.path, why: d.why === "replay" ? "replay" : "scene", beat: typeof d.beat === "string" ? d.beat : null };
}
