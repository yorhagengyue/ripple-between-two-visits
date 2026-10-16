import { HerReminder } from "@/components/daily/elder/HerReminder";
import type { ReminderClipView } from "@/lib/daily/types";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · her reminder (TodayLayout's "reminder" slot; C2 track D, journey 18). At a reminder time his phone plays the
 * reminder clip she recorded through her care link (lib/care/reminders.ts): her newest own recording wins over the
 * labelled stand-in (lib/family/clips.ts preferredClip). It is labelled with her name and 「女儿的录音」 (「代录音」 for the
 * stand-in); her words show only when they came from that same clip and passed the check for medicine names, numbers
 * and doses (lib/care/reminder-text.ts), else the card is her voice alone. When the browser refuses to play by itself,
 * a big 「点一下」 button instead of silence; a clip that cannot play says so in words.
 *
 * The player is track B's HerReminder (components/daily/elder/HerReminder.tsx), which TodayAccount already mounts in
 * this slot; this is the slot's own export for callers that compose the screen from components/today (the /design
 * frames: without a clip it shows the seed's words, not playable).
 */
export function ReminderSection({ locale, clip, at = "8:45", autoplay = true }: { locale: UiLocale; clip?: ReminderClipView | null; at?: string; autoplay?: boolean }) {
  if (clip === null) return null;
  const shown: ReminderClipView = clip ?? {
    id: "sample",
    by: "wei-ling",
    text: locale === "zh-Hans" ? "爸，早餐吃了吗？药记得吃哦。" : "Dad, have you had breakfast? Remember your medicine.",
    lang: locale === "zh-Hans" ? "zh-Hans" : "en",
    plays_at: "after_breakfast",
    audio_url: null,
    stand_in: true,
  };
  return (
    <div data-section="reminder" data-testid="today-reminder">
      <HerReminder key={shown.id} clip={shown} locale={locale} at={at} autoplay={clip ? autoplay : false} />
    </div>
  );
}
