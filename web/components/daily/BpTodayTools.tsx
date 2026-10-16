"use client";

/**
 * 「改」 and 「删」 next to one of today's readings on the demo's blood pressure page (C2 follow-up, track E; real-app 12
 * 「血压记错不能删改」). 改 opens the two numbers in place; 删 asks once more, in place (no dialog). Both go to
 * /api/demo/bp; the page reads his readings again when the change arrives (bp.logged). A corrected reading above the
 * doctor's warning line gets the same relay as a new one (drawn here, under the row). No word about the numbers.
 */
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { demoText } from "@/lib/crew/demo-copy";
import type { Locale } from "@/lib/i18n";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import { withSession } from "@/lib/session/client";
import { AnswerView } from "./AnswerView";

type Mode = "idle" | "edit" | "confirm-delete";

export function BpTodayTools({ id, systolic, diastolic, locale }: { id: string; systolic: number | null; diastolic: number | null; locale: Locale }) {
  const { session } = useLiveSession();
  const [mode, setMode] = useState<Mode>("idle");
  const [top, setTop] = useState(systolic === null ? "" : String(systolic));
  const [bottom, setBottom] = useState(diastolic === null ? "" : String(diastolic));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [relay, setRelay] = useState<ThresholdRelay | null>(null);

  async function send(method: "PATCH" | "DELETE", body: unknown): Promise<{ relay?: ThresholdRelay | null } | null> {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(withSession("/api/demo/bp", session.id), { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { relay?: ThresholdRelay | null };
    } catch {
      setFailed(true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const s = Number(top);
    const d = Number(bottom);
    if (!Number.isInteger(s) || !Number.isInteger(d) || s <= 0 || d <= 0) return setFailed(true);
    const out = await send("PATCH", { id, systolic: s, diastolic: d });
    if (!out) return;
    setRelay(out.relay ?? null);
    setMode("idle");
  }

  async function remove() {
    if (await send("DELETE", { id })) setMode("idle");
  }

  const input = "min-h-12 w-20 rounded-xl border border-hair-2 bg-surface px-2 text-center text-body tabular-nums";
  return (
    <div className="flex flex-col gap-2" data-testid="bp-today-tools" data-reading={id} data-mode={mode}>
      {mode === "idle" ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="rp-btn rp-btn-ghost min-h-12 px-4"
            onClick={() => {
              // the numbers as the row shows them now (the page may have read them again since this was drawn)
              setTop(systolic === null ? "" : String(systolic));
              setBottom(diastolic === null ? "" : String(diastolic));
              setFailed(false);
              setMode("edit");
            }}
            data-testid="bp-edit"
          >
            {demoText(locale, "bp.edit")}
          </button>
          <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-4" onClick={() => setMode("confirm-delete")} data-testid="bp-delete">
            {demoText(locale, "bp.delete")}
          </button>
        </div>
      ) : null}
      {mode === "edit" ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input className={input} inputMode="numeric" value={top} onChange={(e) => setTop(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label={demoText(locale, "bp.edit.top")} data-testid="bp-edit-top" />
          <span className="text-[22px] font-bold text-ink-2">/</span>
          <input className={input} inputMode="numeric" value={bottom} onChange={(e) => setBottom(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label={demoText(locale, "bp.edit.bottom")} data-testid="bp-edit-bottom" />
          <button type="submit" className="rp-btn rp-btn-accent min-h-12 px-4" disabled={busy || !top || !bottom} data-testid="bp-edit-save">
            {demoText(locale, "bp.edit.save")}
          </button>
          <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-4" disabled={busy} onClick={() => setMode("idle")} data-testid="bp-edit-cancel">
            {demoText(locale, "bp.cancel")}
          </button>
        </form>
      ) : null}
      {mode === "confirm-delete" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body">{demoText(locale, "bp.delete.ask")}</span>
          <button type="button" className="rp-btn rp-btn-accent min-h-12 px-4" disabled={busy} onClick={() => void remove()} data-testid="bp-delete-yes">
            {demoText(locale, "bp.delete.yes")}
          </button>
          <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-4" disabled={busy} onClick={() => setMode("idle")} data-testid="bp-delete-no">
            {demoText(locale, "bp.cancel")}
          </button>
        </div>
      ) : null}
      {failed ? (
        <p className="text-body text-ink-2" role="alert" data-testid="bp-tools-failed">
          {demoText(locale, "bp.failed")}
        </p>
      ) : null}
      {relay ? (
        <div data-testid="bp-edit-relay">
          <AnswerView result={{ route: "emergency", sentences: relay.lines }} asked={null} locale={locale} place="relay" />
        </div>
      ) : null}
    </div>
  );
}
