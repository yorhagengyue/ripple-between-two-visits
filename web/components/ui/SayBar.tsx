import type { MouseEventHandler } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Icon } from "./icons";
import { UiLink } from "./UiLink";

/**
 * 「按一下说 / 打字」 (the draft's `say`): the strip that is always above the tab bar on 「今天」. The wide ink pill starts
 * speaking, the outlined one opens typing. Each is a link (`speakHref`, `typeHref`) or a button (`onSpeak`, `onType`).
 * Pass it to <Screen sayBar={…}> so the page and the undo bar keep clear of it.
 *
 * `speakDisabled`: nothing can listen right now (no microphone, no transcription service, no network): the pill is
 * grey and typing stays (the draft's 通用-3, 通用-4c).
 */
export function SayBar({
  locale,
  speakHref,
  typeHref,
  onSpeak,
  onType,
  speakDisabled = false,
  speakBusy = false,
  placement = "fixed",
  filming,
  className,
  style,
}: UiBaseProps & {
  locale: UiLocale;
  speakHref?: string;
  typeHref?: string;
  onSpeak?: MouseEventHandler<HTMLButtonElement>;
  onType?: MouseEventHandler<HTMLButtonElement>;
  speakDisabled?: boolean;
  /** he just pressed the pill and the listening screen is opening: the pill's dot rings */
  speakBusy?: boolean;
  placement?: "fixed" | "static";
}) {
  const copy = uiCopy(locale);
  return (
    <div className={cx("rpu rpu-say", className)} data-rp="say-bar" data-placement={placement} lang={locale} {...filmingAttr(filming)} style={style}>
      {speakHref !== undefined && !speakDisabled ? (
        <UiLink href={speakHref} className="rpu-say-btn" data-say="speak" data-testid="say-speak">
          {copy.saySpeak}
        </UiLink>
      ) : (
        <button type="button" className="rpu-say-btn" data-say="speak" data-testid="say-speak" data-busy={speakBusy ? "true" : undefined} onClick={onSpeak} disabled={speakDisabled}>
          {copy.saySpeak}
        </button>
      )}
      {typeHref !== undefined ? (
        <UiLink href={typeHref} className="rpu-say-btn" data-say="type" data-testid="say-type" aria-label={copy.sayType}>
          <Icon name="keyboard" size={30} />
        </UiLink>
      ) : (
        <button type="button" className="rpu-say-btn" data-say="type" data-testid="say-type" aria-label={copy.sayType} onClick={onType}>
          <Icon name="keyboard" size={30} />
        </button>
      )}
    </div>
  );
}
