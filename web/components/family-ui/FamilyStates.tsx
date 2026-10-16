"use client";

import type { ReactNode } from "react";
import { familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { ConsentFoot } from "./FamilyBits";
import { FamilyButton } from "./FamilyButton";
import { FamilyDock, FamilyScreen, FamilyTop } from "./FamilyScreen";
import { DayMark } from "./WeekStrip";

/** Nothing yet: one sentence, what will happen, optionally one way forward. Never a nudge to make Dad share. */
export function FamilyEmpty({
  locale,
  title,
  children,
  action,
  className,
  style,
}: FamilyBaseProps & { locale: UiLocale; title?: ReactNode; children?: ReactNode; action?: { label: string; href: string } }) {
  // the empty block's own words say nothing of him
  const copy = familyCopy(locale, null);
  return (
    <section className={cx("rpf rpf-state", className)} data-rp="family-empty" data-testid="family-empty" style={style}>
      <p className="rpf-state-title">{title ?? copy.emptyTitle}</p>
      {children && <p className="rpf-state-text">{children}</p>}
      {action && (
        <FamilyButton href={action.href} variant="secondary" size="small">
          {action.label}
        </FamilyButton>
      )}
    </section>
  );
}

/** Loading, as a block inside a screen: still grey bars in the shape of the sentence, no spinner, no shimmer. */
export function FamilyLoading({ locale, cards = 3, className, style }: FamilyBaseProps & { locale: UiLocale; cards?: number }) {
  return (
    <section className={cx("rpf rpf-skel", className)} data-rp="family-loading" role="status" aria-busy="true" style={style}>
      <span className="rpu-sr">{familyCopy(locale, null).loading}</span>
      <i data-size="big" aria-hidden="true" />
      <i aria-hidden="true" />
      {Array.from({ length: cards }, (_, i) => (
        <i key={i} data-size="card" aria-hidden="true" />
      ))}
    </section>
  );
}

/**
 * Her home while it loads (the v3 draft's I1): the screen's own shape in still grey (two bars for the sentence, the
 * week's seven marks, the three rows), one line that says what is happening, and the two buttons already working.
 * Nothing here is data: no date, no count, no state.
 */
export function FamilyHomeSkeleton({
  locale,
  fill,
  langHref,
  meHref,
  tabs,
  recordHref,
  call,
  sharedHref,
  todayIndex,
  title,
  kicker,
  loadingText,
  privacy,
  dad,
}: {
  locale: UiLocale;
  /** her word for him: the words the screen says by itself (its name, the foot line) say him by it; null: 爸爸 / Dad */
  dad?: string | null;
  fill?: "viewport" | "container";
  /** the screen's name, when she calls him otherwise than 「爸爸」 */
  title?: ReactNode;
  /** his date (「9月19日 周六」): the clock's, nothing of his records */
  kicker?: ReactNode;
  /** 「正在打开爸爸今天的情况。」 in her word for him */
  loadingText?: ReactNode;
  /** the foot line in her word for him */
  privacy?: ReactNode;
  langHref?: string;
  meHref?: string;
  /** her bottom bar, as on the home it stands in for */
  tabs?: ReactNode;
  /** where 「录一段新的提醒」 leads; until it is known the button is drawn but not yet a link */
  recordHref?: string;
  /** the caller's 「打电话给爸爸」 */
  call?: ReactNode;
  sharedHref?: string;
  /** today in the week, Monday = 0, when the phone's own date is known; draws the ring */
  todayIndex?: number;
}) {
  const copy = familyCopy(locale, dad);
  return (
    <FamilyScreen locale={locale} fill={fill} tabs={tabs}>
      <FamilyTop title={title ?? copy.dadToday} kicker={kicker} locale={locale} langHref={langHref} meHref={tabs ? undefined : meHref} />
      <div className="rpf-skel" aria-hidden="true">
        <i />
        <i />
      </div>
      <p className="rpf-sub" role="status" style={{ marginTop: 18 }} data-testid="family-loading">
        {loadingText ?? copy.loading}
      </p>
      <div className="rpf rpf-week" style={{ marginTop: 24 }} aria-hidden="true">
        <div className="rpf-week-head">
          <span>{copy.weekLabel}</span>
          <span className="rpf-week-sum">
            <span className="rpf-bar" data-size="small" style={{ width: 96 }} />
          </span>
        </div>
        <ol className="rpf-days">
          {copy.weekdays.map((d, i) => (
            <li key={d} className="rpf-day" data-today={i === todayIndex ? "true" : undefined}>
              <span className="rpf-day-wd">{d}</span>
              <DayMark mark="blank" today={i === todayIndex} />
              <span className="rpf-day-word" />
            </li>
          ))}
        </ol>
      </div>
      <div className="rpf rpf-grid" aria-hidden="true">
        {copy.loadingRows.map((label, i) => (
          <div key={label} className="rpf-stat">
            <span className="rpf-stat-label">{label}</span>
            <span className="rpf-bar" data-size="small" style={{ width: i === 2 ? 72 : 40 }} />
          </div>
        ))}
      </div>
      <FamilyDock>
        {recordHref ? <FamilyButton href={recordHref}>{copy.record}</FamilyButton> : <FamilyButton>{copy.record}</FamilyButton>}
        {call}
      </FamilyDock>
      <ConsentFoot href={sharedHref}>{privacy ?? copy.privacy}</ConsentFoot>
    </FamilyScreen>
  );
}

/** Something failed: what failed, that what she saw is kept, and 「再试一次」. */
export function FamilyError({
  locale,
  children,
  onRetry,
  retryHref,
  title,
  dad,
  className,
  style,
}: FamilyBaseProps & { locale: UiLocale; children?: ReactNode; onRetry?: () => void; retryHref?: string; title?: ReactNode; /** her word for him (「没能取到妈妈的最新情况。」); null: 爸爸 / Dad */ dad?: string | null }) {
  const copy = familyCopy(locale, dad);
  return (
    <section className={cx("rpf rpf-state", className)} data-rp="family-error" data-testid="family-error" role="alert" style={style}>
      <p className="rpf-state-title">{title ?? copy.errorTitle}</p>
      {children && <p className="rpf-state-text">{children}</p>}
      {retryHref ? (
        <FamilyButton href={retryHref} variant="secondary" size="small">
          {copy.retry}
        </FamilyButton>
      ) : (
        <FamilyButton variant="secondary" size="small" onClick={() => (onRetry ? onRetry() : window.location.reload())}>
          {copy.retry}
        </FamilyButton>
      )}
    </section>
  );
}
