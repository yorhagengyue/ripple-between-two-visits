"use client";

/**
 * What he types into and picks from on the auth screens, in the iOS app's look: a labelled field (ProfileSetupView's
 * small label over a surface field; EmailEntryView's with an icon in front), a password field with its worded
 * 「显示密码」, a code field (VerifyCodeView's look), one-of-a-few rows, a row with a switch, a tick box.
 */
import { useId, useState, type ReactNode } from "react";
import { cx } from "@/lib/ui/props";
import { AuthError, AuthText } from "./AuthText";
import type { AuthLocale } from "./AuthScreen";
import { AuthIcon, type AuthIconName } from "./icons";

export interface AuthFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  note?: string;
  error?: string | null;
  type?: "text" | "password" | "email";
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  /** an icon in front of the text (EmailEntryView's field; the field is then 58 tall) */
  icon?: AuthIconName;
  /**
   * a code he copies from his card ("recovery") or hears from family ("digits"): centred, large and evenly spaced, in
   * VerifyCodeView's box. Still one field, and what he types is kept exactly as typed.
   */
  code?: "recovery" | "digits";
  testId?: string;
  autoFocus?: boolean;
  maxLength?: number;
  /** what follows the field on its own line (the 「显示密码」 button) */
  extra?: ReactNode;
  lang?: string;
}

/** A labelled field; its note and its error are read out with it. */
export function AuthField({ label, value, onChange, placeholder, note, error, type = "text", autoComplete, inputMode, autoCapitalize, icon, code, testId, autoFocus, maxLength, extra, lang }: AuthFieldProps) {
  const id = useId();
  const described = [note ? `${id}-note` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="rpa-ios-field" data-rp="field" data-code={code}>
      <label className="rpa-ios-kicker" htmlFor={id}>
        {label}
      </label>
      <div className="rpa-ios-input-box" data-icon={icon ? "true" : undefined} data-code={code}>
        {icon && <AuthIcon name={icon} />}
        <input
          id={id}
          className="rpa-ios-input"
          data-rp-role="body"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          autoCorrect="off"
          spellCheck={false}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          data-testid={testId}
          autoFocus={autoFocus}
          lang={lang}
        />
      </div>
      {extra}
      {note && (
        <AuthText variant="note" id={`${id}-note`}>
          {note}
        </AuthText>
      )}
      {error && (
        <AuthError id={`${id}-error`} align={code ? "centre" : "start"} testId={testId ? `${testId}-error` : undefined}>
          {error}
        </AuthError>
      )}
    </div>
  );
}

/** A password field with a worded 「显示密码 / 隐藏密码」 button under it (words, not an eye on its own). */
export function AuthPasswordField(props: Omit<AuthFieldProps, "type" | "extra" | "code"> & { copy: { showPassword: string; hidePassword: string }; newPassword?: boolean }) {
  const [shown, setShown] = useState(false);
  const { copy, newPassword, ...rest } = props;
  return (
    <AuthField
      {...rest}
      type={shown ? "text" : "password"}
      autoComplete={newPassword ? "new-password" : "current-password"}
      autoCapitalize="none"
      extra={
        <button type="button" className="rpa-ios-btn" data-variant="text" data-fit="end" onClick={() => setShown(!shown)} aria-pressed={shown} data-testid={rest.testId ? `${rest.testId}-show` : undefined}>
          <span>{shown ? copy.hidePassword : copy.showPassword}</span>
        </button>
      }
    />
  );
}

export interface AuthChoice<T extends string> {
  value: T;
  title: ReactNode;
  sub?: ReactNode;
  lang?: string;
}

/**
 * One of a few rows (a radio group): tapping picks one, the button under them goes on. The picked row has the teal
 * edge and a filled ring with a tick; the others an empty ring, so the state is not said by colour alone.
 */
export function AuthChoiceList<T extends string>({ label, options, value, onChange, testId }: { label: string; options: AuthChoice<T>[]; value: T | null; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="rpa-ios-choices" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="rpa-ios-choice" onClick={() => onChange(o.value)} data-choice={o.value} lang={o.lang}>
          <span className="rpa-ios-choice-text">
            <span className="rpa-ios-choice-title">{o.title}</span>
            {o.sub && <span className="rpa-ios-choice-sub">{o.sub}</span>}
          </span>
          <span className="rpa-ios-choice-mark" aria-hidden="true">
            {value === o.value && <AuthIcon name="check" />}
          </span>
        </button>
      ))}
    </div>
  );
}

const SWITCH_WORDS: Record<AuthLocale, { on: string; off: string }> = {
  "zh-Hans": { on: "开", off: "关" },
  en: { on: "On", off: "Off" },
};

/**
 * A row with a switch (the shape of ProfileSetupView's value row): what it is, one line saying what it does, and the
 * switch, which says 「开」 or 「关」 in words beside its knob. One tap toggles; nothing to confirm.
 */
export function AuthSwitchRow({
  title,
  description,
  locale,
  on,
  onChange,
  name,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  locale: AuthLocale;
  on: boolean;
  onChange: (next: boolean) => void;
  /** what the switch is, for tests and forms: "not_my_phone" */
  name?: string;
  className?: string;
}) {
  const id = useId();
  const words = SWITCH_WORDS[locale];
  return (
    <div className={cx("rpa-ios-switch-row", className)} data-rp="switch-row" data-grant={name}>
      <div className="rpa-ios-switch-text">
        <p className="rpa-ios-switch-title" id={`${id}-t`}>
          {title}
        </p>
        {description && (
          <p className="rpa-ios-switch-desc" id={`${id}-d`}>
            {description}
          </p>
        )}
      </div>
      <button type="button" role="switch" className="rpa-ios-switch" aria-checked={on} aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined} onClick={() => onChange(!on)}>
        <span>{on ? words.on : words.off}</span>
        <span className="rpa-ios-switch-track" aria-hidden="true">
          <span className="rpa-ios-switch-knob" />
        </span>
      </button>
    </div>
  );
}

/** A tick box with its sentence; the whole line is the box. */
export function AuthCheckbox({ checked, onChange, children, testId }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode; testId?: string }) {
  return (
    <label className="rpa-ios-check" data-rp="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="rpa-ios-check-box" aria-hidden="true">
        <AuthIcon name="check" />
      </span>
      <span>{children}</span>
    </label>
  );
}
