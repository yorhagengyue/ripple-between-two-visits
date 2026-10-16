"use client";

/**
 * Wei Ling's recorded reminder at the reminder time (task M4 item 5; M6 mounts it on every /p/* page).
 *
 *   at the reminder time  when the story clock reaches the first reminder (after breakfast) or the second one and
 *                         this morning's dose has no answer yet, a reminder card shows her words (女儿说) and her
 *                         clip plays;
 *   director cue          in filming the director's "reminder" cue (director.cue) plays the same clip at once, next
 *                         to M0's reminder card.
 * Which clip: her newest own recording (recorded on /f, M6) wins over the seed's synthetic stand-in; a director's cue
 * names the clip itself (lib/session/ops.ts cueReminder picks it by the same rule), so the card's words (M0's
 * ReminderCard) and the sound are always one clip. Her own recording
 * is labelled 女儿的录音 / Wei Ling's recording; the stand-in voice is labelled 代录音 / stand-in recording.
 * Her words are hers; the only other text is the check-in question.
 * Browsers may refuse to play without a tap: the play button stays on the card either way.
 *
 * The autoplay key carries the clip id: if her new recording reaches the phone while a reminder is showing, hers plays.
 *
 * Placement: app/p/layout.tsx mounts one instance in PatientFrame (`frame`), so the reminder plays on whichever
 * /p/* page he is on. /p/today renders its own instance (M4) under its title; the frame instance stands aside on
 * that page so the clip never plays twice.
 */
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import type { BusEvent } from "@/lib/bus";
import { shownState } from "@/lib/daily/dose-state";
import { dt } from "@/lib/daily/i18n";
import { reminderDue } from "@/lib/daily/schedule";
import type { ReminderClipView, ReminderSchedule, TodayDose } from "@/lib/daily/types";
import { preferredClip } from "@/lib/family/clips";
import { ft } from "@/lib/family/i18n";
import { t, type Locale } from "@/lib/i18n";
import type { DirectorCueData, DoseLoggedData } from "@/lib/session/events";
import { doseKey } from "@/lib/session/today";
import { formatClockTime } from "@/lib/story/clock";
import { ClipPlay } from "./ClipPlay";

/** Pages that mount their own player (the frame instance stands aside there). */
export const PAGES_WITH_OWN_PLAYER = ["/p/today"];

function ClipSource({ clip, locale }: { clip: ReminderClipView; locale: Locale }) {
  if (!clip.audio_url || clip.stand_in) return null;
  return (
    <p className="rp-src mt-1" data-testid="reminder-clip-source">
      {ft(locale, "clip.her")}
    </p>
  );
}

export function ReminderClipPlayer({
  locale,
  clips,
  schedule,
  doses,
  frame = false,
}: {
  locale: Locale;
  clips: ReminderClipView[];
  schedule: ReminderSchedule;
  /** today's due doses as rendered */
  doses: TodayDose[];
  /** the instance PatientFrame mounts for every /p/* page */
  frame?: boolean;
}) {
  const { session } = useLiveSession();
  const pathname = usePathname();
  const [answers, setAnswers] = useState<Record<string, TodayDose["state"] | "later">>({});
  // clipId: the clip the director's cue names (the one its card's words come from), so words and sound are one clip
  const [cue, setCue] = useState<{ n: number; clipId: string | null } | null>(null);

  useLiveEvent(
    (event: BusEvent) => {
      if (event.type === "session.reset") {
        setAnswers({});
        setCue(null);
        return;
      }
      if (event.type === "clock.changed") {
        // a new story moment: the scheduled reminder (if any) takes over from an earlier cue
        setCue(null);
        return;
      }
      if (event.type === "dose.logged") {
        const { dose } = event.data as DoseLoggedData;
        if (!dose) return;
        const s = shownState(dose);
        setAnswers((prev) => ({ ...prev, [doseKey(dose.medication_id, dose.day, dose.slot)]: s === "unconfirmed" && dose.reason === "later" ? "later" : s }));
        return;
      }
      const data = event.data as DirectorCueData;
      if (data.cue === "reminder" && data.clip) {
        const clipId = data.clip.id;
        setCue((prev) => ({ n: (prev?.n ?? 0) + 1, clipId }));
      }
      else if (data.cue === "no_reply") setCue(null);
    },
    ["director.cue", "dose.logged", "session.reset", "clock.changed"],
  );

  if (frame && PAGES_WITH_OWN_PLAYER.includes(pathname ?? "")) return null;
  // the cue's own clip when this page has it (C2: the card's words and the sound come from the same clip), else the
  // usual choice: her newest own recording, then the stand-in
  const clip = (cue?.clipId ? clips.find((c) => c.id === cue.clipId && c.audio_url) : null) ?? preferredClip(clips);
  if (!clip) return null;
  const unanswered = doses.some((d) => {
    const k = doseKey(d.medication_id, d.day, d.slot);
    const s = k in answers ? answers[k] : d.state === "unconfirmed" && d.reason === "later" ? "later" : d.state;
    return s === null || s === "later";
  });
  const due = doses.length > 0 && unanswered && session.story_day === doses[0].day ? reminderDue(session.story_time, schedule) : 0;

  return (
    <>
      {cue && clip.audio_url ? (
        <section className={`rp-card ${frame ? "mb-4" : ""}`} data-testid="reminder-cue-audio" data-clip={clip.id}>
          <p className="font-bold text-ink-2">{dt(locale, "reminder.tag")}</p>
          <ClipPlay
            url={clip.audio_url}
            locale={locale}
            standIn={clip.stand_in}
            testId="reminder-cue-play"
            buttonText={dt(locale, "reminder.play")}
            autoPlayKey={`cue-${cue.n}-${clip.id}`}
          />
          <ClipSource clip={clip} locale={locale} />
        </section>
      ) : null}
      {due > 0 && !cue ? (
        <section className={`rp-card border-2 border-hair-2 ${frame ? "mb-4" : ""}`} data-testid="reminder-strip" data-reminder={due} data-clip={clip.id}>
          <p className="font-bold text-ink-2">
            {dt(locale, due === 2 ? "reminder.second" : "reminder.tag")} · {formatClockTime(due === 2 ? schedule.second : schedule.first, locale)}
          </p>
          {clip.text ? (
            <div className="mt-2">
              {/* rps-said: her own words, set as someone else's words are (components/patient/demo-phone.css) */}
              <p className="rps-said text-body" lang={clip.lang ?? undefined}>
                「{clip.text}」
              </p>
              <p className="rp-src mt-1">{t(locale, "source.family")}</p>
            </div>
          ) : null}
          {clip.audio_url ? (
            <ClipPlay
              url={clip.audio_url}
              locale={locale}
              standIn={clip.stand_in}
              testId="reminder-clip-play"
              buttonText={dt(locale, "reminder.play")}
              autoPlayKey={`${session.story_day}-${due}-${clip.id}`}
            />
          ) : null}
          <ClipSource clip={clip} locale={locale} />
          <p className="mt-3 text-[20px] font-bold">{dt(locale, "reminder.question")}</p>
        </section>
      ) : null}
    </>
  );
}
