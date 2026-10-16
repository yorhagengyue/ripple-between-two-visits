"use client";

import { cx } from "@/lib/ui/props";
import { Icon } from "./icons";

/** ErrorState's button: calls onRetry, or reloads the page when there is none. Bordered, worded. */
export function RetryButton({ label, onRetry, className }: { label: string; onRetry?: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={cx("rpu rpu-btn", className)}
      data-variant="secondary"
      data-rp="retry"
      onClick={() => (onRetry ? onRetry() : window.location.reload())}
    >
      <Icon name="refresh" stroke={2.6} />
      <span>{label}</span>
    </button>
  );
}
