import type { ReactNode } from "react";
import { Explainable } from "@/components/explain/Explainable";
import { UiLink } from "@/components/ui/UiLink";
import type { HoldSubject } from "@/lib/explain/subjects";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { BellGlyph, CheckGlyph, ChevronRight } from "./Glyphs";
import "./home-detail.css";

export type DayMarkKind = "taken" | "missed" | "no_reply" | "pending" | "none";

/** The marks the draft draws beside the week's five: a dashed ring still waiting, a dash for "off", a still grey disc. */
export type MarkKind = DayMarkKind | "waiting" | "off" | "blank";

/**
 * One state mark: shape, colour and (next to it) a word, never colour alone (the v3 draft's 圆点状态):
 *   taken     teal disc with a dark tick
 *   missed    amber ring, 2.5px
 *   no_reply  amber ring with a small solid bell
 *   pending   dashed ring in the weak grey (a day still to come); on today the dashes are the brighter grey (「还没记」)
 *   waiting   dashed ring in the brighter grey (the next step of a timeline)
 *   none/off  a short grey dash, no ring (nothing to record / not shared)
 *   blank     a still grey disc (loading)
 * `today` adds the thin ring 3px out. `size` is the diameter: 40 in the week, 30 in a list, 20 to 32 inside a row.
 * `label` is said to screen readers (「周四 9月17日 没吃」).
 */
export function DayMark({
  mark,
  label,
  size = 40,
  today = false,
  className,
  style,
}: FamilyBaseProps & { mark: MarkKind; label?: string; size?: 40 | 32 | 30 | 26 | 22 | 20 | 18; today?: boolean }) {
  return (
    <span
      className={cx("rpf-mark", className)}
      data-mark={mark}
      data-size={size === 40 ? undefined : size}
      data-today={today ? "true" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={style}
    >
      {mark === "taken" && <CheckGlyph stroke={size <= 26 ? 2.6 : 2.2} />}
      {mark === "no_reply" && <BellGlyph />}
    </span>
  );
}

export interface WeekStripDay {
  key: string;
  /** 「一」「二」... / Mon */
  short: string;
  mark: DayMarkKind;
  isToday?: boolean;
  /** the whole day in words, for screen readers */
  label: string;
  /** the word under the mark: 「吃了」「没吃」「没回」「还没记」「还没到」 */
  word?: string;
  /** the one record of his this day stands for (that day's medicine), when the strip is given `explain`: it can be held */
  hold?: HoldSubject | null;
}

/**
 * 「这一周」 on her home: the name and the count (「6 天里吃了 5 天」) on one line, then seven days, Monday first, each the
 * weekday, its mark and the word for it. With `href` the whole strip opens the week day by day.
 *
 * The long press on her side (owner 10-14, the same as his: components/explain/Explainable.tsx): with `explain` (her
 * care link and the language) a day that carries `hold` can be held, and Ripple's read of that day's medicine opens.
 * A tap still opens the week: the strip's link is around the days, and only a hold of half a second is taken from it.
 * The wrap is the day's own column (.rpf-day-hold, home-detail.css), so a day is drawn where it was.
 */
export function WeekStrip({
  label,
  summary,
  days,
  href,
  explain,
  className,
  style,
}: FamilyBaseProps & { label: ReactNode; summary?: ReactNode; days: readonly WeekStripDay[]; href?: string; /** her care link: the days that carry `hold` can be held */ explain?: { link: string; locale: UiLocale } }) {
  const body = (
    <>
      <div className="rpf-week-head">
        <span>{label}</span>
        <span className="rpf-week-sum">
          {summary && <b data-testid="week-summary">{summary}</b>}
          {href && <ChevronRight />}
        </span>
      </div>
      <ol className="rpf-days">
        {days.map((d) => {
          const day = (
            <>
              <span className="rpf-day-wd" aria-hidden="true">
                {d.short}
              </span>
              <DayMark mark={d.mark} label={d.label} today={d.isToday} />
              <span className="rpf-day-word" aria-hidden="true">
                {d.word}
              </span>
            </>
          );
          return (
            <li key={d.key} className="rpf-day" data-today={d.isToday ? "true" : undefined} data-mark={d.mark} data-testid={`week-day-${d.key}`}>
              {explain && d.hold ? (
                <Explainable className="rpf-day-hold" subject={d.hold} locale={explain.locale} link={explain.link} label={d.label}>
                  {day}
                </Explainable>
              ) : (
                day
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
  if (href) {
    return (
      <UiLink href={href} nav="forward" className={cx("rpf rpf-week", className)} data-rp="week" data-testid="week-strip" style={style}>
        {body}
      </UiLink>
    );
  }
  return (
    <div className={cx("rpf rpf-week", className)} data-rp="week" data-testid="week-strip" style={style}>
      {body}
    </div>
  );
}
