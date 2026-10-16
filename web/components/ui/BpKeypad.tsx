"use client";

import { useReducer } from "react";
import { BP_FIELDS, bpComplete, bpInitial, bpReading, bpReducer, type BpEntry, type BpField, type BpReading } from "@/lib/ui/bp-entry";
import { fill, uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { PrimaryButton } from "./Buttons";

/**
 * Typing a reading in like a home monitor (tone v2 ⑥, brief 6.6): a dark display with three rows in the monitor's
 * order (上面的数 SYS, 下面的数 DIA, 心跳 PUL · 可以不填), a big keypad of its own (the phone's small keyboard never
 * opens), and 「记下 142/88」. Digits fill the selected row; a full row moves on by itself; tap a row to fix it.
 * No colour and no word about the numbers: they are only ever shown next to what the doctor said.
 *
 * State lives in lib/ui/bp-entry.ts (unit-tested). The page saves through `onSubmit`.
 */
export function BpKeypad({
  locale,
  initial,
  onSubmit,
  pending = false,
  error,
  filming,
  className,
  style,
}: UiBaseProps & {
  locale: UiLocale;
  initial?: Partial<BpEntry>;
  onSubmit?: (reading: BpReading) => void;
  /** saving: the button stays, busy */
  pending?: boolean;
  /** one plain sentence when saving failed; the numbers stay */
  error?: string;
}) {
  const copy = uiCopy(locale);
  const [entry, dispatch] = useReducer(bpReducer, initial, (i) => bpInitial(i));
  const complete = bpComplete(entry);
  const names: Record<BpField, { name: string; sub: string }> = {
    sys: { name: copy.bpSys, sub: "SYS" },
    dia: { name: copy.bpDia, sub: "DIA" },
    pul: { name: copy.bpPul, sub: `PUL · ${copy.bpPulOptional}` },
  };
  const save = complete ? fill(copy.bpSave, { sys: entry.sys, dia: entry.dia }) : copy.bpSaveEmpty;
  return (
    <section className={cx("rpu rpu-bp", className)} data-rp="bp-keypad" data-fab="off" {...filmingAttr(filming)} style={style}>
      <div className="rpu-lcd" data-rp="bp-display">
        {BP_FIELDS.map((f) => (
          <button
            key={f}
            type="button"
            className="rpu-lcd-row"
            data-field={f}
            aria-pressed={entry.active === f}
            onClick={() => dispatch({ type: "select", field: f })}
          >
            <span className="rpu-lcd-name">
              {names[f].name}
              <small lang="en">{names[f].sub}</small>
            </span>
            <span className="rpu-lcd-val" data-empty={entry[f] ? undefined : "true"} translate="no">
              {entry[f] || "—"}
            </span>
          </button>
        ))}
      </div>
      <div className="rpu-keys" data-rp="bp-keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="rpu-key" onClick={() => dispatch({ type: "digit", digit: d })}>
            {d}
          </button>
        ))}
        <button type="button" className="rpu-key" data-fn="true" onClick={() => dispatch({ type: "delete" })}>
          {copy.bpDelete}
        </button>
        <button type="button" className="rpu-key" onClick={() => dispatch({ type: "digit", digit: "0" })}>
          0
        </button>
        <button type="button" className="rpu-key" data-fn="true" onClick={() => dispatch({ type: "next" })}>
          {copy.bpNext}
        </button>
      </div>
      {error && (
        <p className="rpu-bp-error" role="alert">
          {error}
        </p>
      )}
      <PrimaryButton
        disabled={!complete}
        pending={pending}
        data-testid="bp-save"
        onClick={() => {
          const reading = bpReading(entry);
          if (reading) onSubmit?.(reading);
        }}
      >
        {save}
        {complete && entry.pul ? ` · ${fill(copy.bpPulseSaved, { pul: entry.pul })}` : ""}
      </PrimaryButton>
    </section>
  );
}
