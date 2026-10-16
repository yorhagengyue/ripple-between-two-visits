"use client";

/**
 * Today card: "did you take this morning's medicine?" for each due medicine, with the answer kept in
 * sync across every device in the session. Medicine name and strength come from the confirmed label
 * (source tag 药袋); before the label is confirmed the card says so instead.
 */
import { useState } from "react";
import { useDoseStates } from "@/components/live/useDoseStates";
import { useLiveSession } from "@/components/live/LiveSession";
import { t, type Locale } from "@/lib/i18n";
import { postJson } from "@/lib/session/client";
import type { DueDose } from "@/lib/session/today";
import { answerToState, DoseButtons, stateLabel, type DoseAnswer } from "./DoseButtons";

export function DoseCheckCard({ locale, initial }: { locale: Locale; initial: DueDose[] }) {
  const { session } = useLiveSession();
  const { doses, setLocal } = useDoseStates(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function answer(d: DueDose, a: DoseAnswer) {
    const { state, reason } = answerToState(a);
    setBusy(d.medication_id);
    setFailed(false);
    setLocal(d.medication_id, d.day, d.slot, state);
    try {
      await postJson("/api/doses", session.id, { medication_id: d.medication_id, day: d.day, slot: d.slot, state, reason });
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  if (doses.length === 0) {
    return (
      <section className="rp-card" data-testid="dose-card" data-empty="true">
        <p className="text-body text-ink-2">{t(locale, "today.noDoseDue")}</p>
      </section>
    );
  }

  return (
    <section className="rp-card" data-testid="dose-card">
      <p className="font-semibold text-ink-2">{t(locale, "today.medsKicker")}</p>
      {doses.map((d) => (
        <div
          key={d.medication_id}
          className="mt-3 border-t border-hair pt-3 first-of-type:mt-2 first-of-type:border-t-0 first-of-type:pt-0"
          data-testid={`dose-${d.medication_id}`}
          data-state={d.state ?? "none"}
        >
          <p className="text-[22px] font-bold leading-tight">
            {d.name}
            {d.strength ? <span className="ml-2 text-body font-semibold text-ink-2">{d.strength}</span> : null}
          </p>
          <p className="rp-src mt-1">{d.label_confirmed ? t(locale, "source.label") : t(locale, "med.awaitingLabel")}</p>
          <p className="mt-3 text-body">{t(locale, "today.doseQuestion")}</p>
          <DoseButtons
            locale={locale}
            current={d.state}
            testIdPrefix={`dose-btn-${d.medication_id}`}
            disabled={busy === d.medication_id}
            onAnswer={(a) => void answer(d, a)}
          />
          <p
            className="mt-3 text-body font-semibold"
            data-testid={`dose-state-${d.medication_id}`}
            data-state={d.state ?? "none"}
          >
            {d.state === null ? stateLabel(locale, null) : t(locale, "dose.recorded", { state: stateLabel(locale, d.state) })}
          </p>
        </div>
      ))}
      {failed ? <p className="mt-2 text-ink-2">{t(locale, "common.retry")}</p> : null}
    </section>
  );
}
