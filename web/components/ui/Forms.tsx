import type { InputHTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { cx, filmingAttr, type UiBaseProps, dataAttrs, type DataAttrs } from "@/lib/ui/props";
import { UiLink } from "./UiLink";

/**
 * The small parts of the draft's forms: the step bar, a field, a list of options (one or several), chips, the
 * segmented control, the 「对 / 改」 rows and the recovery code. All of them are plain controls: a real <input>, real
 * buttons with aria-checked / aria-pressed, links where a tap goes to another screen.
 */

/** 「第 2 步，共 8 步」 over a row of segments: done ones filled, the current one outlined. */
export function StepBar({ index, total, label, filming, className, style }: UiBaseProps & { index: number; total: number; label: ReactNode }) {
  return (
    <div className={cx("rpu rpu-step", className)} data-rp="step" role="group" {...filmingAttr(filming)} style={style}>
      <p className="rpu-step-t">{label}</p>
      <div className="rpu-step-segs" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} data-state={i < index - 1 ? "done" : i === index - 1 ? "now" : "todo"} />
        ))}
      </div>
    </div>
  );
}

/**
 * One field: its name above, the box (64 high; 76 and a 40px number with `big`), then the error in red and the hint in
 * grey. `end` puts a worded button inside the box on the right (「显示」 for a password). Every other prop goes to the
 * <input>. The placeholder is #475263, like any other text.
 */
export function Field({
  label,
  hint,
  error,
  big = false,
  mono = false,
  dim = false,
  end,
  id,
  filming,
  className,
  style,
  ...input
}: UiBaseProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style"> & {
    label: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    big?: boolean;
    mono?: boolean;
    dim?: boolean;
    end?: { label: string; onClick?: MouseEventHandler<HTMLButtonElement>; pressed?: boolean };
    id: string;
  }) {
  return (
    <div className={cx("rpu rpu-f", className)} data-rp="field" data-big={big ? "true" : undefined} data-mono={mono ? "true" : undefined} data-dim={dim ? "true" : undefined} data-error={error ? "true" : undefined} {...filmingAttr(filming)} style={style}>
      <label className="rpu-f-label" htmlFor={id}>
        {label}
      </label>
      <div className="rpu-f-box">
        <input {...input} id={id} className="rpu-f-input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} />
        {end && (
          <button type="button" className="rpu-f-eye" onClick={end.onClick} aria-pressed={end.pressed}>
            {end.label}
          </button>
        )}
      </div>
      {error && (
        <p className="rpu-f-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
      {hint && (
        <p className="rpu-f-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** A column of options. `label` names the group for a screen reader. */
export function OptionList({ children, label, multi = false, indent = false, testId, filming, className, style }: UiBaseProps & { children: ReactNode; label?: string; multi?: boolean; indent?: boolean; testId?: string }) {
  return (
    <div className={cx("rpu rpu-opts", indent && "rpu-ind", className)} data-rp="options" role={multi ? "group" : "radiogroup"} aria-label={label} data-testid={testId} {...filmingAttr(filming)} style={style}>
      {children}
    </div>
  );
}

/**
 * One option: a white row (68 high) with a ring that fills when chosen (a rounded box with a tick when several can
 * be chosen), the words, and a grey line under them. A button; `aria-checked` says the state.
 */
export function Option({
  title,
  sub,
  checked = false,
  multi = false,
  onClick,
  disabled,
  testId,
  attrs,
  ...rest
}: {
  title: ReactNode;
  sub?: ReactNode;
  checked?: boolean;
  multi?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
} & DataAttrs) {
  // a caller's own data-* attributes (written as props, or in `attrs`) land on the button itself
  return (
    <button type="button" className="rpu-opt" data-rp="option" role={multi ? "checkbox" : "radio"} aria-checked={checked} data-multi={multi ? "true" : undefined} onClick={onClick} disabled={disabled} data-testid={testId} {...attrs} {...dataAttrs(rest)}>
      <span className="rpu-opt-dot" aria-hidden="true">
        {multi && checked ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" focusable="false" data-icon="check">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
      </span>
      <span className="rpu-opt-main">
        <span className="rpu-opt-t">{title}</span>
        {sub != null && <span className="rpu-opt-s">{sub}</span>}
      </span>
    </button>
  );
}

/** Chips: a short answer among a few; the chosen one is filled. */
export function Chips({ children, indent = false, label, filming, className, style }: UiBaseProps & { children: ReactNode; indent?: boolean; label?: string }) {
  return (
    <div className={cx("rpu rpu-chips", indent && "rpu-ind", className)} data-rp="chips" role="group" aria-label={label} {...filmingAttr(filming)} style={style}>
      {children}
    </div>
  );
}

/** One chip. A caller's own data-* attributes (as props, or in `attrs`) land on it; `disabled` while a tap is on its way. */
export function Chip({
  children,
  on = false,
  onClick,
  href,
  disabled,
  testId,
  attrs,
  ...rest
}: DataAttrs & {
  children: ReactNode;
  on?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  href?: string;
  disabled?: boolean;
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
}) {
  const own = { ...attrs, ...dataAttrs(rest) };
  if (href !== undefined && !disabled) {
    return (
      <UiLink href={href} className="rpu-chip" data-rp="chip" aria-pressed={on} data-testid={testId} {...own}>
        {children}
      </UiLink>
    );
  }
  return (
    <button type="button" className="rpu-chip" data-rp="chip" aria-pressed={on} onClick={onClick} disabled={disabled} data-testid={testId} {...own}>
      {children}
    </button>
  );
}

export interface SegmentItem {
  key: string;
  label: ReactNode;
  on?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  lang?: string;
  /** a test hook on this item, and extra data-* attributes for it (which one it stands for: `data-who`) */
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
}

/**
 * One of two or three in a grey groove (「中文 / English」, 「按周看 / 按月看」); the chosen one is the white tile. Each
 * item takes its own `testId` and `attrs`; `testId` here names the groove.
 */
export function Segmented({ items, label, testId, filming, className, style }: UiBaseProps & { items: readonly SegmentItem[]; label?: string; testId?: string }) {
  return (
    <div className={cx("rpu rpu-seg", className)} data-rp="segmented" role="group" aria-label={label} data-testid={testId} {...filmingAttr(filming)} style={{ ...style, ["--rpu-cols" as string]: items.length }}>
      {items.map((it) =>
        it.href !== undefined ? (
          <UiLink key={it.key} href={it.href} className="rpu-seg-item" data-seg={it.key} aria-current={it.on ? "true" : undefined} lang={it.lang} data-testid={it.testId} {...it.attrs}>
            {it.label}
          </UiLink>
        ) : (
          <button key={it.key} type="button" className="rpu-seg-item" data-seg={it.key} aria-pressed={!!it.on} onClick={it.onClick} lang={it.lang} data-testid={it.testId} {...it.attrs}>
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

/** The 「对 / 改」 rows: each thing read from a label with the two answers next to it. */
export function KvList({ children, filming, className, style }: UiBaseProps & { children: ReactNode }) {
  return (
    <div className={cx("rpu rpu-kv", className)} data-rp="kv" {...filmingAttr(filming)} style={style}>
      {children}
    </div>
  );
}

export function KvRow({
  label,
  value,
  note,
  state,
  mono = false,
  yes,
  edit,
  onYes,
  onEdit,
  testId,
}: {
  /** what the row is: 「药名」, 「用法」 */
  label: ReactNode;
  value: ReactNode;
  /** an accent line under the value (「你改过」) */
  note?: ReactNode;
  /** "yes": he said 对; "edit": he is changing it */
  state?: "yes" | "edit";
  mono?: boolean;
  /** the two buttons' words: 「对」 and 「改」 */
  yes: string;
  edit: string;
  onYes?: MouseEventHandler<HTMLButtonElement>;
  onEdit?: MouseEventHandler<HTMLButtonElement>;
  testId?: string;
}) {
  return (
    <div className="rpu-kv-row" data-rp="kv-row" data-state={state} data-testid={testId}>
      <div className="rpu-kv-main">
        <span className="rpu-kv-l">{label}</span>
        <span className="rpu-kv-v" data-mono={mono ? "true" : undefined}>
          {value}
        </span>
        {note != null && <span className="rpu-kv-s">{note}</span>}
      </div>
      <div className="rpu-kv-btns">
        <button type="button" className="rpu-kv-btn" aria-pressed={state === "yes"} onClick={onYes} data-kv="yes">
          {yes}
        </button>
        <button type="button" className="rpu-kv-btn" aria-pressed={state === "edit"} onClick={onEdit} data-kv="edit">
          {edit}
        </button>
      </div>
    </div>
  );
}

/**
 * The recovery code in its frame, mono, as he is to copy it; `note` under it. Never translated. `testId` names the
 * code itself (a test reads exactly the code from it); `label` is what a screen reader says in place of the run of
 * letters (the page words it: 「恢复码: K 7 M 2 …」). A caller's own data-* attributes land on the frame.
 */
export function RecoveryCode({
  code,
  note,
  testId,
  label,
  filming,
  className,
  style,
  ...rest
}: UiBaseProps & DataAttrs & { code: string; note?: ReactNode; testId?: string; label?: string }) {
  return (
    <div className={cx("rpu rpu-code", className)} data-rp="recovery-code" {...dataAttrs(rest)} {...filmingAttr(filming)} style={style}>
      <p className="rpu-code-t" translate="no" data-testid={testId} aria-label={label}>
        {code}
      </p>
      {note != null && <p className="rpu-code-s">{note}</p>}
    </div>
  );
}

/** A section's title with a rule running to the right (the draft's `sec`). */
export function SectionTitle({ children, filming, className, style }: UiBaseProps & { children: ReactNode }) {
  return (
    <h2 className={cx("rpu rpu-sec", className)} data-rp="section-title" {...filmingAttr(filming)} style={style}>
      <span className="rpu-sec-t">{children}</span>
    </h2>
  );
}
