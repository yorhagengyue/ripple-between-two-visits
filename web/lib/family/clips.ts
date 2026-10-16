/**
 * Which of Wei Ling's reminder clips plays (M6): her newest own recording (recorded on /f) wins over the seed's
 * synthetic stand-in voice; without one, the first clip that has audio; else the first clip. Pure; client-safe.
 *
 * fallbackClip: when the chosen clip does not play (its audio is missing or broken: the <audio> element's error), the
 * next one to try: her next-newest own recording, then the stand-in; null when nothing playable is left, so the
 * reminder card can say the recording is unavailable instead of staying silent (for components/daily/
 * ReminderClipPlayer.tsx, whose owner wires it to ClipPlay's onError).
 */
import type { ReminderClipView } from "@/lib/daily/types";

export function preferredClip(clips: ReminderClipView[]): ReminderClipView | null {
  const own = [...clips].reverse().find((c) => c.audio_url && !c.stand_in);
  return own ?? clips.find((c) => c.audio_url) ?? clips[0] ?? null;
}

/** The clip to try after every clip in `tried` failed to play; only clips with audio; null when none is left. */
export function fallbackClip(clips: ReminderClipView[], tried: readonly string[]): ReminderClipView | null {
  const left = clips.filter((c) => c.audio_url && !tried.includes(c.id));
  return left.length ? preferredClip(left) : null;
}
