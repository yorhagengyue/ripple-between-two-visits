import type { MouseEventHandler, ReactNode } from "react";
import { UiLink } from "@/components/ui/UiLink";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import { BellGlyph, ChevronRight, PlayGlyph } from "./Glyphs";
import { DayMark } from "./WeekStrip";

/**
 * The small repeated pieces of the v3 draft, one each: a row that opens a screen, the quiet line at the top of her
 * home, 「这是爸爸同意给你看的…」 under a title, the foot line that opens what he shares, numbered steps, what follows a
 * decision, a word tag, the round play key, a screen that only says one thing, the three first-visit steps, the
 * phone's notification drawn as a preview, someone's own words. Presentational: plain props, no data.
 */

/** A whole row that opens a screen, hairlines above and below, a chevron at the right (「看早上的经过」, 「我录过的」). */
export function LinkRow({ href, children, className, style, ...rest }: FamilyBaseProps & { href: string; children: ReactNode; "data-testid"?: string }) {
  return (
    <UiLink href={href} nav="forward" className={cx("rpf rpf-linkrow", className)} data-rp="link-row" data-testid={rest["data-testid"]} style={style}>
      <span>{children}</span>
      <ChevronRight />
    </UiLink>
  );
}

/**
 * The quiet line under the top bar of her home (the draft's F2, I3, I4): a small mark, one sentence, at most one
 * action in teal. Never a dialog, never a sound. `icon`: "check" he just shared something, "dash" no network,
 * "bell-off" notifications are off.
 */
export function NoticeRow({
  icon = "check",
  children,
  action,
  rise = false,
  className,
  style,
  ...rest
}: FamilyBaseProps & {
  icon?: "check" | "dash" | "bell-off" | "none";
  /** the sentence; without it the action is the line (`wide`) */
  children?: ReactNode;
  action?: { label: ReactNode; href?: string; onClick?: MouseEventHandler<HTMLButtonElement>; chevron?: boolean; pending?: boolean; testId?: string; /** the action is the whole line: its words at the left, the chevron at the right */ wide?: boolean };
  rise?: boolean;
  role?: "status" | "alert";
  "data-testid"?: string;
  "data-state"?: string;
}) {
  return (
    <p className={cx("rpf rpf-notice", rise && "rpf-rise", className)} role={rest.role ?? "status"} data-rp="family-notice" data-testid={rest["data-testid"]} data-state={rest["data-state"]} style={style}>
      {icon === "check" && <DayMark mark="taken" size={22} />}
      {icon === "dash" && <DayMark mark="off" size={22} />}
      {icon === "bell-off" && (
        <span className="rpf-notice-icon" data-off="true" aria-hidden="true">
          <BellGlyph />
        </span>
      )}
      {children != null && <span data-rp="notice-text">{children}</span>}
      {action &&
        (action.href ? (
          <UiLink href={action.href} nav={action.chevron ? "forward" : undefined} className="rpf-notice-act" data-wide={action.wide ? "true" : undefined} data-testid={action.testId}>
            {action.label}
            {action.chevron && <ChevronRight />}
          </UiLink>
        ) : (
          <button type="button" className="rpf-notice-act" data-wide={action.wide ? "true" : undefined} onClick={action.onClick} disabled={action.pending} aria-busy={action.pending ? true : undefined} data-testid={action.testId}>
            {action.wide ? <span>{action.label}</span> : action.label}
            {action.chevron && <ChevronRight />}
          </button>
        ))}
    </p>
  );
}

/** 「这是爸爸同意给你看的看诊记录。」: one hairline row with the small teal tick, under the title of his records. */
export function AgreedRow({ children, className, style }: FamilyBaseProps & { children: ReactNode }) {
  return (
    <p className={cx("rpf rpf-agreed", className)} data-rp="agreed" style={style}>
      <DayMark mark="taken" size={20} />
      <span>{children}</span>
    </p>
  );
}

/**
 * The last line of her home and of the week: 「这些是爸爸同意给你看的。」. With `href` it opens what he shares (F1) and
 * ends in a chevron; without, it is only the sentence (the empty home: 「这些开关只有爸爸能在他的手机上改。」).
 */
export function ConsentFoot({ href, children, className, style, ...rest }: FamilyBaseProps & { href?: string; children: ReactNode; "data-testid"?: string }) {
  if (!href) {
    return (
      <p className={cx("rpf rpf-consent", className)} data-rp="consent-foot" style={style}>
        <span>{children}</span>
      </p>
    );
  }
  return (
    <UiLink href={href} nav="forward" className={cx("rpf rpf-consent", className)} data-rp="consent-foot" data-testid={rest["data-testid"]} style={style}>
      <span>{children}</span>
      <ChevronRight />
    </UiLink>
  );
}

/** Numbered steps (「打开 iPhone 的「设置」」…): a ringed number and one sentence per row. */
export function StepList({ steps, className, style, ...rest }: FamilyBaseProps & { steps: readonly ReactNode[]; "data-testid"?: string }) {
  return (
    <ol className={cx("rpf rpf-steplist", className)} data-rp="steps" data-testid={rest["data-testid"]} style={style}>
      {steps.map((s, i) => (
        <li key={i}>
          <span className="rpf-stepnum" aria-hidden="true">
            {i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** What follows a decision (leaving, deleting the account): one short dash and one sentence per row. */
export function DashList({ items, className, style, ...rest }: FamilyBaseProps & { items: readonly ReactNode[]; "data-testid"?: string }) {
  return (
    <ul className={cx("rpf rpf-dashlist", className)} data-rp="dash-list" data-testid={rest["data-testid"]} style={style}>
      {items.map((s, i) => (
        <li key={i}>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

/** A small word tag with a thin outline: 「代录音」, 「语音」, 「打字」. */
export function Chip({ children, className, style }: FamilyBaseProps & { children: ReactNode }) {
  return (
    <span className={cx("rpf-chip", className)} data-rp="chip" style={style}>
      {children}
    </span>
  );
}

/** The round 44px play key; while it plays the triangle is a square (「键变成停」). `label` is what it plays, in words. */
export function PlayButton({
  playing = false,
  label,
  onClick,
  className,
  style,
  ...rest
}: FamilyBaseProps & { playing?: boolean; label: string; onClick?: MouseEventHandler<HTMLButtonElement>; "data-testid"?: string }) {
  return (
    <button type="button" className={cx("rpf-play", className)} aria-label={label} aria-pressed={playing} onClick={onClick} data-rp="play" data-testid={rest["data-testid"]} style={style}>
      {playing ? <i aria-hidden="true" /> : <PlayGlyph />}
    </button>
  );
}

/**
 * A screen that only says one thing (he has not shared this, he stopped sharing, the invitation no longer works): a
 * short grey dash, the sentence, the line under it, a note. It sits between the top bar and the bottom button.
 */
export function EmptyBlock({
  title,
  detail,
  note,
  mark = "dash",
  children,
  className,
  style,
}: FamilyBaseProps & { title: ReactNode; detail?: ReactNode; note?: ReactNode; /** "none": no drawing above the sentence */ mark?: "dash" | "none"; children?: ReactNode }) {
  return (
    <div className={cx("rpf rpf-empty", className)} data-rp="empty-block" style={style}>
      {mark === "dash" && <span className="rpf-empty-mark" aria-hidden="true" />}
      <h1 className="rpf-h1" data-testid="family-headline">
        {title}
      </h1>
      {detail && (
        <p className="rpf-sub" data-testid="family-lede">
          {detail}
        </p>
      )}
      {note && <p className="rpf-note">{note}</p>}
      {children}
    </div>
  );
}

/** The first visit's three steps as three short bars under the top bar: `done` of them filled. */
export function Stepper({ done, of = 3, className, style }: FamilyBaseProps & { done: number; of?: number }) {
  return (
    <div className={cx("rpf-stepper", className)} data-rp="stepper" aria-hidden="true" style={style}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} data-done={i < done ? "true" : undefined} />
      ))}
    </div>
  );
}

/** The phone's own notification, drawn so she sees what it will look like (「通知会是这样」). Not a control. */
export function BannerPreview({ title, time, body, className, style }: FamilyBaseProps & { title: ReactNode; time: ReactNode; body: ReactNode }) {
  return (
    <div className={cx("rpf rpf-banner", className)} data-rp="banner-preview" style={style}>
      <span className="rpf-banner-app" aria-hidden="true" />
      <span className="rpf-banner-text">
        <span className="rpf-banner-head">
          <b>{title}</b>
          <span>{time}</span>
        </span>
        <span>{body}</span>
      </span>
    </div>
  );
}

/** Someone's own words on one line of a row (her reminder, his note): the thin rule on the left, nothing else. */
export function Said({ children, lang, className, style, ...rest }: FamilyBaseProps & { children: ReactNode; lang?: string; "data-testid"?: string }) {
  return (
    <p className={cx("rpf rpf-said", className)} lang={lang} data-rp="said" data-testid={rest["data-testid"]} style={style}>
      {children}
    </p>
  );
}

/** A line of plain words with one link in it, 48px: 「已经有账号？登录」. */
export function TextLine({ children, href, link, className, style, ...rest }: FamilyBaseProps & { children: ReactNode; href: string; link: ReactNode; "data-testid"?: string }) {
  return (
    <p className={cx("rpf rpf-textline", className)} data-rp="text-line" style={style}>
      <span>{children}</span>
      <UiLink href={href} data-testid={rest["data-testid"]}>
        {link}
      </UiLink>
    </p>
  );
}

/** The microphone, drawn: a ringed capsule; struck through when the phone refuses it. */
export function MicMark({ off = false, className, style }: FamilyBaseProps & { off?: boolean }) {
  return <span className={cx("rpf-micmark", className)} data-off={off ? "true" : undefined} aria-hidden="true" data-rp="mic-mark" style={style} />;
}

/** 中文 | English on 「我的」: two halves, each a link; the language in use is the darker half. */
export function LangSegment({ current, zhHref, enHref, className, style }: FamilyBaseProps & { current: "zh-Hans" | "en"; zhHref: string; enHref: string }) {
  return (
    <div className={cx("rpf rpf-seg", className)} data-rp="lang-segment" style={style}>
      <UiLink href={zhHref} lang="zh-Hans" aria-current={current === "zh-Hans" ? "true" : undefined} data-testid="me-lang-zh">
        中文
      </UiLink>
      <UiLink href={enHref} lang="en" aria-current={current === "en" ? "true" : undefined} data-testid="me-lang-en">
        English
      </UiLink>
    </div>
  );
}
