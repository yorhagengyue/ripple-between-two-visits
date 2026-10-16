"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";

/** The white card around a group of switch rows, an optional grey heading over it. */
export function ToggleList({ heading, children, className, style }: { heading?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("rpu rpu-list", className)} data-rp="toggle-list" style={style}>
      {heading != null && <p className="rpu-label">{heading}</p>}
      <div className="rpu-toggles" style={{ marginTop: 0 }}>
        {children}
      </div>
    </div>
  );
}

/**
 * One line of 「Wei Ling 能看到什么」 (the draft's `tog`): what it is, one line saying exactly what she will see, and a
 * switch with 「开」 or 「关」 written under it (the state is never colour alone). One tap toggles; no confirm dialog.
 * Put the rows in a <ToggleList> for the white card around them.
 *
 * Controlled (`on` + `onChange`) or not (`defaultOn`). `pending` while the change is saved.
 */
export function FamilySwitchRow({
  title,
  description,
  locale,
  on,
  defaultOn = false,
  onChange,
  pending = false,
  name,
  filming,
  className,
  style,
}: UiBaseProps & {
  title: ReactNode;
  description?: ReactNode;
  locale: UiLocale;
  on?: boolean;
  defaultOn?: boolean;
  onChange?: (next: boolean) => void;
  pending?: boolean;
  /** the grant key, for tests and forms: "dose_summary" */
  name?: string;
}) {
  const copy = uiCopy(locale);
  const [own, setOwn] = useState(defaultOn);
  const checked = on ?? own;
  const id = useId();
  return (
    <div className={cx("rpu rpu-toggle-row", className)} data-rp="switch-row" data-grant={name} {...filmingAttr(filming)} style={style}>
      <div className="rpu-toggle-text">
        <p className="rpu-toggle-title" id={`${id}-t`}>
          {title}
        </p>
        {description && (
          <p className="rpu-toggle-desc" id={`${id}-d`}>
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className="rpu-switch"
        aria-checked={checked}
        aria-labelledby={`${id}-t`}
        aria-describedby={description ? `${id}-d` : undefined}
        aria-busy={pending ? true : undefined}
        disabled={pending}
        onClick={() => {
          const next = !checked;
          if (on === undefined) setOwn(next);
          onChange?.(next);
        }}
      >
        <span className="rpu-switch-track" aria-hidden="true">
          <span className="rpu-switch-knob" />
        </span>
        <span>{checked ? copy.on : copy.off}</span>
      </button>
    </div>
  );
}
