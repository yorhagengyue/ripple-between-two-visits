"use client";

/**
 * Record one blood pressure reading (POST /api/bp). Two numbers, nothing else; the server picks the slot from the
 * story clock. No comment on the numbers: it only says "recorded".
 *
 * C2 follow-up (real-app 12 「血压 185/112 只说『记下了』」): a reading above the doctor's own warning line comes back with
 * the relay the account's page shows (track S's relayDoctorThreshold: the same two lines /api/ask gives for 「我刚量了
 * 185/112」): the fixed 995 template first (995 is a dial link), then the doctor's words, whole, with the visit date,
 * the time point in the recording and the clip. They are drawn as the demo draws every answer line (AnswerView, place
 * "relay"), so the time point reads as on the visit screen. It stays under the form until the next reading. Still no
 * word of Ripple's own about the numbers.
 */
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { cx } from "@/components/meds/classes";
import type { Locale } from "@/lib/i18n";
import { dt } from "@/lib/daily/i18n";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import { postJson } from "@/lib/session/client";
import { AnswerView } from "./AnswerView";

export function BpRecordForm({ locale }: { locale: Locale }) {
  const { session } = useLiveSession();
  const [top, setTop] = useState("");
  const [bottom, setBottom] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [relay, setRelay] = useState<{ reading: string; relay: ThresholdRelay } | null>(null);

  async function save() {
    const s = Number(top);
    const d = Number(bottom);
    if (!Number.isInteger(s) || !Number.isInteger(d) || s <= 0 || d <= 0) {
      setNote(dt(locale, "bp.record.invalid"));
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const out = await postJson<{ relay?: ThresholdRelay | null }>("/api/bp", session.id, { systolic: s, diastolic: d });
      setTop("");
      setBottom("");
      setNote(dt(locale, "bp.record.saved"));
      setRelay(out.relay ? { reading: `${s}/${d}`, relay: out.relay } : null);
    } catch {
      setNote(dt(locale, "ask.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rp-card flex flex-col gap-3" data-testid="bp-record">
      <h2 className="text-[20px] font-bold">{dt(locale, "bp.record.title")}</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-2">
          <input
            className={cx.input}
            inputMode="numeric"
            value={top}
            onChange={(e) => setTop(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder={dt(locale, "bp.record.top")}
            aria-label={dt(locale, "bp.record.top")}
            data-testid="bp-input-top"
          />
          <span className="text-[22px] font-bold text-ink-2">/</span>
          <input
            className={cx.input}
            inputMode="numeric"
            value={bottom}
            onChange={(e) => setBottom(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder={dt(locale, "bp.record.bottom")}
            aria-label={dt(locale, "bp.record.bottom")}
            data-testid="bp-input-bottom"
          />
        </div>
        <button type="submit" className="rp-btn rp-btn-accent min-h-14" disabled={busy || !top || !bottom} data-testid="bp-save">
          {dt(locale, "bp.record.save")}
        </button>
      </form>
      {note ? (
        <p className="text-body text-ink-2" role="status" data-testid="bp-record-note">
          {note}
        </p>
      ) : null}
      {relay ? (
        <div data-testid="bp-record-relay" data-reading={relay.reading} data-threshold={relay.relay.threshold.systolic}>
          <AnswerView result={{ route: "emergency", sentences: relay.relay.lines }} asked={null} locale={locale} place="relay" />
        </div>
      ) : null}
    </section>
  );
}
