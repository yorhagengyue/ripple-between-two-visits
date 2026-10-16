import type { MouseEventHandler } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { PrimaryButton, SecondaryButton } from "./Buttons";
import { Icon } from "./icons";

export type MicState = "ask" | "denied" | "unavailable";

/**
 * The microphone, before and after the browser's own prompt (brief 12): what is about to happen and which button to
 * press (「允许」); what to do when it was refused; what to do when there is no microphone. Every state leaves a way
 * forward: typing.
 */
export function MicPermission({
  state,
  locale,
  onRequest,
  typeHref,
  onType,
  filming,
  className,
  style,
}: UiBaseProps & {
  state: MicState;
  locale: UiLocale;
  /** ask: the button that triggers getUserMedia */
  onRequest?: MouseEventHandler<HTMLButtonElement>;
  /** denied / unavailable: where 「我想打字」 goes, or a handler */
  typeHref?: string;
  onType?: MouseEventHandler<HTMLButtonElement>;
}) {
  const copy = uiCopy(locale);
  const title = state === "ask" ? copy.micAskTitle : state === "denied" ? copy.micDeniedTitle : copy.micUnavailableTitle;
  const body = state === "ask" ? copy.micAskBody : state === "denied" ? copy.micDeniedBody : copy.micUnavailableBody;
  return (
    <section className={cx("rpu rpu-perm", className)} data-rp="mic-permission" data-state={state} {...filmingAttr(filming)} style={style}>
      <span className="rpu-perm-icon">
        <Icon name="mic" />
      </span>
      <h2 className="rpu-state-title">{title}</h2>
      <p className="rpu-state-text" data-rp-role="body">
        {body}
      </p>
      {state === "ask" ? (
        <PrimaryButton icon="mic" onClick={onRequest}>
          {copy.micAskButton}
        </PrimaryButton>
      ) : typeHref ? (
        <SecondaryButton icon="keyboard" href={typeHref}>
          {copy.typeInstead}
        </SecondaryButton>
      ) : (
        <SecondaryButton icon="keyboard" onClick={onType}>
          {copy.typeInstead}
        </SecondaryButton>
      )}
    </section>
  );
}

/**
 * The browser blocked autoplay (brief 12): one big worded button in her colour, 「点一下，听女儿的提醒」, and a line
 * saying why the tap is needed.
 */
export function TapToPlay({
  locale,
  label,
  onPlay,
  filming,
  className,
  style,
}: UiBaseProps & { locale: UiLocale; label?: string; onPlay?: MouseEventHandler<HTMLButtonElement> }) {
  const copy = uiCopy(locale);
  return (
    <div className={cx("rpu rpu-perm", className)} data-rp="tap-to-play" {...filmingAttr(filming)} style={style}>
      <button type="button" className="rpu-tap-play" onClick={onPlay}>
        <span className="rpu-tap-play-icon">
          <Icon name="play" />
        </span>
        <span>{label ?? copy.tapToPlay}</span>
      </button>
      <p className="rpu-state-text" data-rp-role="body">
        {copy.tapToPlayWhy}
      </p>
    </div>
  );
}
