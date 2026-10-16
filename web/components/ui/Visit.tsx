import type { ReactNode } from "react";
import { fill, uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { KeyValueRow } from "./Rows";

/**
 * The card he shows the doctor before recording (tone v2 ③): ink ground, white English, 「FOR THE DOCTOR」 above.
 * The sentence is the app's fixed consent sentence; the page passes it in.
 */
export function ForDoctorCard({
  children,
  locale,
  kicker,
  filming,
  className,
  style,
}: UiBaseProps & { children: ReactNode; locale: UiLocale; kicker?: string }) {
  return (
    <section className={cx("rpu rpu-fordoctor", className)} data-rp="for-doctor" {...filmingAttr(filming)} style={style}>
      <p className="rpu-fordoctor-kicker" lang="en">
        {kicker ?? uiCopy(locale).forDoctorKicker}
      </p>
      <p className="rpu-fordoctor-text" lang="en">
        {children}
      </p>
    </section>
  );
}

/**
 * 「● 正在录 03:12」 (the draft's `rec`): an ink bar with the recording dot (its own red), the word, and the time in mono
 * (40; 28 with `mini`).
 */
export function RecordingBar({ elapsed, locale, mini = false, filming, className, style }: UiBaseProps & { elapsed: string; locale: UiLocale; mini?: boolean }) {
  return (
    <p className={cx("rpu rpu-rec", className)} data-rp="recording" data-mini={mini ? "true" : undefined} role="status" {...filmingAttr(filming)} style={style}>
      <span className="rpu-rec-dot" aria-hidden="true" />
      <span>{uiCopy(locale).recording}</span>
      <span className="rpu-rec-time">{elapsed}</span>
    </p>
  );
}

/**
 * The last two lines of live captions, large (tone v2 ④): 「刚才」 smaller and grey, 「现在」 23px. Speaker unknown
 * while recording (nothing is attributed until he reviews it), so the captions stay sans.
 */
export function LiveCaptions({
  earlier,
  now,
  lang = "en",
  locale,
  filming,
  className,
  style,
}: UiBaseProps & { earlier?: ReactNode; now: ReactNode; lang?: string; locale: UiLocale }) {
  const copy = uiCopy(locale);
  return (
    <div className={cx("rpu rpu-captions", className)} data-rp="captions" aria-live="polite" {...filmingAttr(filming)} style={style}>
      {earlier && (
        <p className="rpu-caption" data-when="earlier" lang={lang}>
          <span className="rpu-caption-when" lang={locale}>
            {copy.captionsEarlier}
          </span>
          {earlier}
        </p>
      )}
      <p className="rpu-caption" data-when="now" lang={lang}>
        <span className="rpu-caption-when" lang={locale}>
          {copy.captionsNow}
        </span>
        {now}
      </p>
    </div>
  );
}

/** 「已经记下 · 5 件事」 while recording. */
export function CaptureCount({ count, locale, filming, className, style }: UiBaseProps & { count: number; locale: UiLocale }) {
  const copy = uiCopy(locale);
  return <KeyValueRow label={copy.captured} value={fill(copy.capturedItems, { n: count })} filming={filming} className={className} style={style} />;
}
