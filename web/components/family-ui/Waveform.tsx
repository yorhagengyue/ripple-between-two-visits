import { cx, type FamilyBaseProps } from "@/lib/ui/props";

/** A fixed shape for a clip whose levels are not known (the gallery). Her pages draw a shape only when they have one. */
export const SAMPLE_LEVELS = [0.18, 0.32, 0.5, 0.7, 0.42, 0.6, 0.85, 0.46, 0.28, 0.66, 0.95, 0.56, 0.36, 0.7, 0.5, 0.22, 0.42, 0.6, 0.32, 0.18, 0.46, 0.66, 0.36, 0.22, 0.14];

/**
 * A recording's shape: one 3px bar per level (0..1). Three drawings, as in the v3 draft:
 *   live          while recording (84px): the bars so far in teal, a bright cursor, a dotted line for what is to come
 *   (default)     the take just recorded (72px): its bars spread over the whole width, teal
 *   size="small"  beside a play key (32px): lighter teal
 * Decorative: the time next to it says how long it is.
 */
export function Waveform({ levels, live = false, size, className, style }: FamilyBaseProps & { levels: readonly number[]; live?: boolean; size?: "small" }) {
  const all = levels.length ? levels : SAMPLE_LEVELS;
  const max = live ? 57 : size === "small" ? 23 : 48;
  const bars = all.slice(live ? -34 : size === "small" ? -30 : -46).map((v, i) => <i key={i} style={{ height: `calc(${Math.round(4 + Math.max(0, Math.min(1, v)) * (max - 4))} * var(--rp-u))` }} />);
  if (live) {
    return (
      <div className={cx("rpf-wave", className)} data-live="true" aria-hidden="true" data-testid="rec-wave" style={style}>
        <span>{bars}</span>
        <b />
        <u />
      </div>
    );
  }
  return (
    <div className={cx("rpf-wave", className)} data-size={size} aria-hidden="true" data-testid="rec-wave" style={style}>
      {bars}
    </div>
  );
}
