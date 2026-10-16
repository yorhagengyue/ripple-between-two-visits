import type { ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { SecondaryButton } from "./Buttons";
import { Icon, type IconName } from "./icons";
import { RetryButton } from "./RetryButton";

/** Nothing here yet: one plain sentence, and optionally one way forward (a bordered button). */
export function EmptyState({
  children,
  title,
  icon,
  action,
  filming,
  className,
  style,
}: UiBaseProps & { children: ReactNode; title?: ReactNode; icon?: IconName; action?: { label: string; href: string } }) {
  return (
    <div className={cx("rpu rpu-state", className)} data-rp="empty" data-state="empty" {...filmingAttr(filming)} style={style}>
      {icon && (
        <span className="rpu-state-icon">
          <Icon name={icon} />
        </span>
      )}
      {title && <p className="rpu-state-title">{title}</p>}
      <p className="rpu-state-text" data-rp-role="body">
        {children}
      </p>
      {action && <SecondaryButton href={action.href}>{action.label}</SecondaryButton>}
    </div>
  );
}

/** Quiet skeleton bars in the screen's shape (no spinner). Screen readers hear 「正在载入」 / "Loading". */
export function LoadingState({
  locale,
  lines = 3,
  headline = false,
  button = false,
  filming,
  className,
  style,
}: UiBaseProps & { locale: UiLocale; lines?: number; headline?: boolean; button?: boolean }) {
  return (
    <div className={cx("rpu rpu-skel", className)} data-rp="loading" role="status" aria-busy="true" {...filmingAttr(filming)} style={style}>
      <span className="rpu-sr">{uiCopy(locale).loading}</span>
      {headline && <span className="rpu-skel-line" data-size="headline" aria-hidden="true" />}
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <span
          key={i}
          className="rpu-skel-line"
          data-size={i === lines - 1 && lines > 1 ? "short" : undefined}
          style={i < lines - 1 ? { width: `${94 - i * 8}%` } : undefined}
          aria-hidden="true"
        />
      ))}
      {button && <span className="rpu-skel-line" data-size="button" aria-hidden="true" />}
    </div>
  );
}

/**
 * Something failed: one plain sentence that says what still holds, and a 「再试一次」 button. The retry reloads the
 * page unless the caller passes `retryHref` (server) or `onRetry` (client).
 */
export function ErrorState({
  children,
  title,
  locale,
  retryLabel,
  retryHref,
  onRetry,
  filming,
  className,
  style,
}: UiBaseProps & {
  children: ReactNode;
  title?: ReactNode;
  locale: UiLocale;
  retryLabel?: string;
  retryHref?: string;
  onRetry?: () => void;
}) {
  const label = retryLabel ?? uiCopy(locale).retry;
  return (
    <div className={cx("rpu rpu-state", className)} data-rp="error" data-state="error" role="alert" {...filmingAttr(filming)} style={style}>
      <span className="rpu-state-icon">
        <Icon name="refresh" />
      </span>
      {title && <p className="rpu-state-title">{title}</p>}
      <p className="rpu-state-text" data-rp-role="body">
        {children}
      </p>
      {retryHref ? (
        <SecondaryButton href={retryHref} icon="refresh">
          {label}
        </SecondaryButton>
      ) : (
        <RetryButton label={label} onRetry={onRetry} />
      )}
    </div>
  );
}

/** No network: what he can still do (read) and what waits (asking). Not an error he caused; no red. */
export function OfflineState({ locale, filming, className, style }: UiBaseProps & { locale: UiLocale }) {
  const copy = uiCopy(locale);
  return (
    <div className={cx("rpu rpu-state", className)} data-rp="offline" data-state="offline" role="status" {...filmingAttr(filming)} style={style}>
      <span className="rpu-state-icon">
        <Icon name="offline" />
      </span>
      <p className="rpu-state-title">{copy.offlineTitle}</p>
      <p className="rpu-state-text" data-rp-role="body">
        {copy.offlineBody}
      </p>
    </div>
  );
}
