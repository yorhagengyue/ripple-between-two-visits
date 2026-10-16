"use client";

/**
 * Today's dose check-in (task M4 item 1), in sync across every device in the session.
 *
 *   「今天早上的药吃了吗？」 吃了 / 没吃 / 等下   taken / missed / unconfirmed (reason "later")
 *   没吃 -> "what happened this morning?": a chip per routine on this day (打太极 on Tue/Thu), forgot, out, medicine
 *          not with me, or his own words. His answer, never advice.
 *   No answer when the reminder window closes -> unconfirmed, "no reply after two reminders" (server side).
 *   Every answer shows an Undo bar for 12 s (never less than 10 s) instead of a confirm dialog; undo writes the
 *   previous answer back (or "no answer yet").
 *
 * Test ids kept from M0's DoseCheckCard: dose-card, dose-<med> [data-state], dose-btn-<med>-taken|missed|later,
 * dose-state-<med> [data-state].
 */
import { useEffect, useRef, useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import { cx } from "@/components/meds/classes";
import { answerToState, DoseButtons, stateLabel, type DoseAnswer } from "@/components/patient/DoseButtons";
import type { BusEvent } from "@/lib/bus";
import { shownState, STATE_REASONS } from "@/lib/daily/dose-state";
import { dt } from "@/lib/daily/i18n";
import type { ReasonOption, TodayDose } from "@/lib/daily/types";
import { t, type Locale } from "@/lib/i18n";
import { formatClockTime } from "@/lib/story/clock";
import { postJson } from "@/lib/session/client";
import type { DoseLoggedData } from "@/lib/session/events";
import { doseKey } from "@/lib/session/today";
import type { DoseState } from "@/lib/store/types";

export const UNDO_MS = 12_000;

type Answer = Pick<TodayDose, "state" | "reason" | "reason_text">;

interface UndoState {
  dose: TodayDose;
  prev: Answer;
  shown: DoseState | null;
}

function stateText(locale: Locale, d: Answer): string {
  if (d.state === null) return stateLabel(locale, null);
  if (d.state === "unconfirmed" && d.reason === "later") return dt(locale, "dose.state.later");
  if (d.state === "unconfirmed" && d.reason === "no_reply") return dt(locale, "dose.state.noReply");
  return t(locale, "dose.recorded", { state: stateLabel(locale, d.state) });
}

export function DoseCheckIn({
  locale,
  initial,
  reasons,
  reminderAt,
}: {
  locale: Locale;
  initial: TodayDose[];
  reasons: ReasonOption[];
  /** first reminder time "HH:MM" */
  reminderAt: string;
}) {
  const { session } = useLiveSession();
  const [overrides, setOverrides] = useState<Record<string, Answer>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<string | null>(null); // medication id whose reason panel is open
  const [ownWords, setOwnWords] = useState("");
  const [undo, setUndo] = useState<UndoState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLiveEvent(
    (event: BusEvent) => {
      if (event.type === "session.reset") {
        setOverrides({});
        setUndo(null);
        setAsking(null);
        return;
      }
      const { dose } = event.data as DoseLoggedData;
      if (!dose) return;
      const state = shownState(dose);
      setOverrides((prev) => ({
        ...prev,
        [doseKey(dose.medication_id, dose.day, dose.slot)]: { state, reason: state === null ? null : dose.reason, reason_text: state === null ? null : dose.reason_text },
      }));
    },
    ["dose.logged", "session.reset"],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const doses: TodayDose[] = initial.map((d) => ({ ...d, ...(overrides[doseKey(d.medication_id, d.day, d.slot)] ?? {}) }));

  async function post(d: TodayDose, body: { state: DoseState; reason: string | null; reason_text?: string | null }) {
    setBusy(d.medication_id);
    setFailed(false);
    setOverrides((prev) => ({
      ...prev,
      [doseKey(d.medication_id, d.day, d.slot)]: { state: body.reason === "undone" ? null : body.state, reason: body.reason === "undone" ? null : body.reason, reason_text: body.reason_text ?? null },
    }));
    try {
      await postJson("/api/doses", session.id, { medication_id: d.medication_id, day: d.day, slot: d.slot, ...body });
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function showUndo(d: TodayDose, prev: Answer, shown: DoseState | null) {
    if (timer.current) clearTimeout(timer.current);
    setUndo({ dose: d, prev, shown });
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }

  async function answer(d: TodayDose, a: DoseAnswer) {
    const prev: Answer = { state: d.state, reason: d.reason, reason_text: d.reason_text };
    const { state, reason } = answerToState(a);
    setAsking(a === "missed" ? d.medication_id : null);
    setOwnWords("");
    // the Undo bar shows with the answer itself; it goes away if the answer could not be saved
    showUndo(d, prev, state);
    if (!(await post(d, { state, reason }))) {
      if (timer.current) clearTimeout(timer.current);
      setUndo(null);
    }
  }

  async function giveReason(d: TodayDose, code: string, text: string) {
    if (await post(d, { state: "missed", reason: code, reason_text: text })) setAsking(null);
  }

  async function undoLast() {
    if (!undo) return;
    const { dose, prev } = undo;
    if (timer.current) clearTimeout(timer.current);
    setUndo(null);
    setAsking(null);
    if (prev.state === null) await post(dose, { state: "unconfirmed", reason: "undone" });
    else await post(dose, { state: prev.state, reason: prev.reason, reason_text: prev.reason_text });
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
      {doses.map((d) => {
        const reasonShown = d.state === "missed" && d.reason && !STATE_REASONS.has(d.reason) ? d.reason_text || d.reason : null;
        return (
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
            <p className="text-body text-ink-2" data-testid={`dose-reminder-at-${d.medication_id}`}>
              {dt(locale, "dose.reminderAt", { time: formatClockTime(reminderAt, locale) })}
            </p>
            <DoseButtons
              locale={locale}
              current={d.state}
              testIdPrefix={`dose-btn-${d.medication_id}`}
              disabled={busy === d.medication_id}
              onAnswer={(a) => void answer(d, a)}
            />
            <p className="mt-3 text-body font-semibold" data-testid={`dose-state-${d.medication_id}`} data-state={d.state ?? "none"} data-reason={d.reason ?? ""}>
              {stateText(locale, d)}
            </p>
            {reasonShown ? (
              <p className="text-body text-ink-2" data-testid={`dose-reason-shown-${d.medication_id}`}>
                {dt(locale, "dose.reason.saved", { reason: reasonShown })}
              </p>
            ) : null}
            {asking === d.medication_id && d.state === "missed" ? (
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-hair p-3" data-testid={`dose-reason-${d.medication_id}`}>
                <p className="text-body font-semibold">{dt(locale, "dose.reason.title")}</p>
                <div className="flex flex-wrap gap-2">
                  {reasons.map((r) => {
                    const label = locale === "zh-Hans" ? r.label.zh : r.label.en;
                    return (
                      <button
                        key={r.code}
                        type="button"
                        className="rp-btn rp-btn-ghost min-h-12 px-4"
                        aria-pressed={d.reason === r.code}
                        disabled={busy === d.medication_id}
                        data-testid={`dose-reason-chip-${r.code}`}
                        onClick={() => void giveReason(d, r.code, label)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const words = ownWords.trim();
                    if (words) void giveReason(d, "own_words", words);
                  }}
                >
                  <input
                    className={cx.input}
                    value={ownWords}
                    onChange={(e) => setOwnWords(e.target.value)}
                    placeholder={dt(locale, "dose.reason.placeholder")}
                    aria-label={dt(locale, "dose.reason.own")}
                    maxLength={200}
                    data-testid="dose-reason-input"
                  />
                  <button type="submit" className="rp-btn rp-btn-accent min-h-[52px] flex-none px-4" disabled={!ownWords.trim() || busy === d.medication_id} data-testid="dose-reason-save">
                    {dt(locale, "dose.reason.save")}
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        );
      })}
      {failed ? <p className="mt-2 text-ink-2">{t(locale, "common.retry")}</p> : null}
      {undo ? (
        // a bar above the tab bar (no confirm dialog): stays UNDO_MS, never less than 10 s
        <div className="pointer-events-none fixed inset-x-0 bottom-[92px] z-20 px-4">
          <div
            role="status"
            className="pointer-events-auto mx-auto flex max-w-[398px] items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-bg shadow-lg"
            data-testid="undo-bar"
            data-ms={UNDO_MS}
          >
            <span className="text-body">{dt(locale, "dose.undo.recorded", { state: stateLabel(locale, undo.shown) })}</span>
            <button type="button" className="rp-btn min-h-12 flex-none bg-bg px-4 text-ink" onClick={() => void undoLast()} data-testid="undo-btn">
              {dt(locale, "dose.undo")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
