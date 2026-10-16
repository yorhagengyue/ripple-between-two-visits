"use client";

/**
 * Reminder card on every patient page. Appears when the director cues "reminder" (director.cue with
 * cue = "reminder"), closes on an answer, on "no reply", or on reset.
 *
 * Content is only: Wei Ling's recorded reminder in her own words (source tag 女儿说), the check-in
 * question "did you take this morning's medicine?", and the three answers. No advice of our own.
 */
import { useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import type { BusEvent } from "@/lib/bus";
import { t, type Locale } from "@/lib/i18n";
import { postJson } from "@/lib/session/client";
import type { DirectorCueData, DoseLoggedData, ReminderCueData } from "@/lib/session/events";
import { answerToState, DoseButtons, type DoseAnswer } from "./DoseButtons";

export function ReminderCard({ locale }: { locale: Locale }) {
  const { session } = useLiveSession();
  const [cue, setCue] = useState<ReminderCueData | null>(null);
  const [busy, setBusy] = useState(false);

  useLiveEvent(
    (event: BusEvent) => {
      if (event.type === "session.reset") {
        setCue(null);
        return;
      }
      if (event.type === "dose.logged") {
        // Answered on any device in the session (or by "no reply"): that dose leaves the card.
        const { dose } = event.data as DoseLoggedData;
        setCue((prev) => {
          if (!prev) return prev;
          const left = prev.doses.filter(
            (d) => !(d.medication_id === dose.medication_id && d.day === dose.day && d.slot === dose.slot),
          );
          if (left.length === prev.doses.length) return prev;
          return left.length ? { ...prev, doses: left } : null;
        });
        return;
      }
      const data = event.data as DirectorCueData;
      if (data.cue === "reminder") setCue(data);
      else if (data.cue === "no_reply") setCue(null);
    },
    ["director.cue", "dose.logged", "session.reset"],
  );

  if (!cue) return null;

  async function answer(a: DoseAnswer) {
    if (!cue) return;
    const { state, reason } = answerToState(a);
    setBusy(true);
    try {
      await Promise.all(
        cue.doses.map((d) =>
          postJson("/api/doses", session.id, { medication_id: d.medication_id, day: d.day, slot: d.slot, state, reason }),
        ),
      );
      setCue(null);
    } catch {
      // keep the card open so he can try again
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      role="alertdialog"
      aria-labelledby="rp-reminder-q"
      className="rp-card mb-4 border-2 border-hair-2"
      data-testid="reminder-card"
    >
      <div className="flex items-center justify-between">
        <p className="font-bold text-ink-2">{t(locale, "reminder.tag")}</p>
        <button
          type="button"
          className="rp-btn rp-btn-ghost px-3 py-1"
          onClick={() => setCue(null)}
          data-testid="reminder-close"
        >
          {t(locale, "reminder.close")}
        </button>
      </div>
      {cue.clip?.text ? (
        <div className="mt-2">
          {/* rps-said: her own words, set as someone else's words are (components/patient/demo-phone.css) */}
          <p className="rps-said text-body" lang={cue.clip.lang ?? undefined}>
            「{cue.clip.text}」
          </p>
          <p className="rp-src mt-1">{t(locale, "source.family")}</p>
        </div>
      ) : null}
      {cue.doses.length ? (
        <>
          <p id="rp-reminder-q" className="mt-3 text-[20px] font-bold">
            {t(locale, "today.doseQuestion")}
          </p>
          <p className="mt-1 text-body text-ink-2">
            {cue.doses.map((d) => (d.strength ? `${d.name} ${d.strength}` : d.name)).join("、")}
          </p>
          <DoseButtons locale={locale} current={null} testIdPrefix="reminder-btn" disabled={busy} onAnswer={(a) => void answer(a)} />
        </>
      ) : (
        <p id="rp-reminder-q" className="mt-3 text-body">
          {t(locale, "reminder.noDose")}
        </p>
      )}
    </section>
  );
}
