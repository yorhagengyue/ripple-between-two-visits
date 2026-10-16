import type { FormEventHandler, InputHTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { ButtonPair, PrimaryButton, SecondaryButton } from "./Buttons";
import { Icon } from "./icons";
import { StatusHeadline } from "./StatusHeadline";

export type VoiceState = "idle" | "listening" | "heard";

/**
 * Asking by voice first (tone v2 ⑦, 3 taps: speak, stop, 「问这句」). The page owns the recognition; this shows it:
 * - idle: 「想问什么，按一下说。」 and the big round mic button with its words inside the same button;
 * - listening: the mic turns red (red = recording) and says 「正在听，说完再按一下」;
 * - heard: 「听到你说「…」」 with 「问这句」 / 「重新说」, nothing is sent before 「问这句」.
 * 「我想打字」 switches to <AskField>.
 */
export function AskVoice({
  state,
  heard,
  locale,
  onMic,
  onAsk,
  onAgain,
  onType,
  typeHref,
  showPrompt = true,
  filming,
  className,
  style,
}: UiBaseProps & {
  state: VoiceState;
  /** what the recogniser heard (his own words: sans) */
  heard?: ReactNode;
  locale: UiLocale;
  onMic?: MouseEventHandler<HTMLButtonElement>;
  onAsk?: MouseEventHandler<HTMLButtonElement>;
  onAgain?: MouseEventHandler<HTMLButtonElement>;
  onType?: MouseEventHandler<HTMLButtonElement>;
  typeHref?: string;
  /** the 「想问什么，按一下说。」 sentence (off when the screen already has a status sentence) */
  showPrompt?: boolean;
}) {
  const copy = uiCopy(locale);
  return (
    <section className={cx("rpu", className)} data-rp="ask-voice" data-state={state} {...filmingAttr(filming)} style={{ display: "flex", flexDirection: "column", ...style }}>
      {showPrompt && <StatusHeadline lines={copy.askPrompt} />}
      {state === "heard" && (
        <>
          <div className="rpu-heard">
            <p className="rpu-label">{copy.heard}</p>
            <p className="rpu-heard-text">
              「{heard}」
            </p>
          </div>
          <ButtonPair style={{ marginTop: 14 }}>
            <PrimaryButton onClick={onAsk}>{copy.askThis}</PrimaryButton>
            <SecondaryButton onClick={onAgain} style={{ minHeight: "var(--rp-h-primary)" }}>
              {copy.sayAgain}
            </SecondaryButton>
          </ButtonPair>
        </>
      )}
      <button type="button" className="rpu-mic" data-state={state === "listening" ? "listening" : "idle"} onClick={onMic} aria-pressed={state === "listening"}>
        <span className="rpu-mic-circle">
          <Icon name="mic" stroke={2} />
        </span>
        <span className="rpu-mic-label">{state === "listening" ? copy.micListening : copy.micIdle}</span>
      </button>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        {typeHref ? (
          <SecondaryButton href={typeHref} icon="keyboard" style={{ width: "auto" }}>
            {copy.typeInstead}
          </SecondaryButton>
        ) : (
          <SecondaryButton onClick={onType} icon="keyboard" style={{ width: "auto" }}>
            {copy.typeInstead}
          </SecondaryButton>
        )}
      </div>
    </section>
  );
}

/**
 * Typing instead (「我想打字」): a labelled 56px field and a worded 「问这句」 button (no arrow-only button).
 * A plain <form>: give it `action` (a URL or a server action), or `onSubmit` from a client component.
 */
export function AskField({
  locale,
  placeholder,
  name = "q",
  defaultValue,
  disabled = false,
  pending = false,
  action,
  method,
  onSubmit,
  inputProps,
  filming,
  className,
  style,
}: UiBaseProps & {
  locale: UiLocale;
  placeholder?: string;
  name?: string;
  defaultValue?: string;
  disabled?: boolean;
  /** sent, waiting for the answer */
  pending?: boolean;
  action?: string | ((formData: FormData) => void | Promise<void>);
  method?: "get" | "post";
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** extra attributes for the input (data-testid, maxLength ...) */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "defaultValue" | "placeholder" | "disabled" | "className">;
}) {
  const copy = uiCopy(locale);
  const ph = placeholder ?? copy.typePlaceholder;
  const id = `rpu-ask-${name}`;
  return (
    <form
      className={cx("rpu rpu-field", className)}
      data-rp="ask"
      action={action}
      method={typeof action === "string" ? method : undefined}
      onSubmit={onSubmit}
      {...filmingAttr(filming)}
      style={style}
    >
      <label className="rpu-field-label" htmlFor={id}>
        {copy.typeLabel}
      </label>
      <input
        enterKeyHint="send"
        autoComplete="off"
        {...inputProps}
        id={id}
        className="rpu-field-input"
        data-rp-role="body"
        name={name}
        defaultValue={defaultValue}
        placeholder={ph}
        disabled={disabled || pending}
      />
      <button type="submit" className="rpu-btn" data-variant="secondary" disabled={disabled || pending} aria-busy={pending ? true : undefined}>
        <span>{copy.askThis}</span>
      </button>
    </form>
  );
}
