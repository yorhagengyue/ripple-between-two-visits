import type { MouseEventHandler, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { PageTransition } from "@/components/ui/PageTransition";
import { UiLink } from "@/components/ui/UiLink";
import { familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { BackGlyph } from "./Glyphs";

/**
 * One screen of Wei Ling's phone (the v3 draft): #0A0C0F ground, at most 430px wide, 24px sides. At least as tall as
 * the phone: a screen whose content fits keeps its bottom group at the bottom, a longer one scrolls as a whole page.
 * Marks itself data-rp-side="family": the page checks hold everything inside to 16px text and 44px targets.
 */
export function FamilyScreen({
  locale,
  fill = "viewport",
  tabs,
  children,
  className,
  style,
}: FamilyBaseProps & { locale: UiLocale; fill?: "viewport" | "container"; /** her bottom bar (<FamilyTabs>), on her four main screens */ tabs?: ReactNode; children: ReactNode }) {
  const screen = (
    <div className={cx("rpf rpf-screen", className)} lang={locale} data-rp="family-screen" data-rp-side="family" data-fill={fill} data-tabs={tabs ? "true" : undefined} style={style}>
      <div className="rpf-page">{children}</div>
      {tabs}
    </div>
  );
  // the motion between two pages (components/ui/PageTransition.tsx): a page's screen only, not the /design phones
  return fill === "viewport" ? <PageTransition>{screen}</PageTransition> : screen;
}

/** 中/EN: one link that switches to the other language; the language in use sits on the darker half. */
export function LangToggle({ locale, href }: { locale: UiLocale; href: string }) {
  const zh = locale === "zh-Hans";
  return (
    <UiLink href={href} className="rpf-lang" aria-label={zh ? "Switch language: English" : "切换语言：中文"} data-testid="family-lang">
      <span lang="zh-Hans" data-on={zh ? "true" : undefined}>
        中
      </span>
      <span lang="en" data-on={zh ? undefined : "true"}>
        EN
      </span>
    </UiLink>
  );
}

export interface FamilyTopProps extends FamilyBaseProps {
  locale: UiLocale;
  langHref?: string;
  /** the way back: the chevron and where it leads (「爸爸今天」, 「我的」); `sub` is a second quiet line (a date range) */
  back?: { href: string; label?: ReactNode; sub?: ReactNode };
  /** her home: the screen's name (「爸爸今天」), with `kicker` (the real date) under it */
  title?: ReactNode;
  /** the real date (「9月19日 周六」): under `title`, or alone */
  kicker?: ReactNode;
  /** 「Ripple」 as the left side: screens outside her home (the invitation, waiting, an ended link) */
  brand?: boolean;
  /** 「第 1 步，共 3 步」 */
  step?: ReactNode;
  /** 「正在录」 with the small teal dot; no way back while it shows */
  live?: ReactNode;
  /** 「我的」 at the right of her home */
  meHref?: string;
  meLabel?: ReactNode;
  /** 「跳过」 on a first-visit step */
  skip?: { label: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement>; href?: string; testId?: string };
}

/**
 * The top bar, 56px: on the left where she is (her home's name and date, 「Ripple」, a step count, 「正在录」) or the way
 * back with the name of the screen it leads to; on the right 「跳过」, 中/EN and 「我的」, each a 44px target.
 */
export function FamilyTop({ kicker, back, locale, title, brand, step, live, meHref, meLabel, skip, className, style }: FamilyTopProps) {
  // 「返回」 and 「我的」 say nothing of him
  const copy = familyCopy(locale, null);
  const left = back ? (
    <UiLink href={back.href} nav="back" className="rpf-back" data-testid="family-back">
      <BackGlyph />
      <span className="rpf-top-titles">
        <span className="rpf-top-title">{back.label ?? copy.back}</span>
        {back.sub && <span className="rpf-top-sub">{back.sub}</span>}
      </span>
    </UiLink>
  ) : live ? (
    <p className="rpf-live" role="status">
      <i aria-hidden="true" />
      <span className="rpf-top-title">{live}</span>
    </p>
  ) : step ? (
    <p className="rpf-top-sub" data-rp="family-step">
      {step}
    </p>
  ) : brand ? (
    <p className="rpf-brand" lang="en">
      Ripple
    </p>
  ) : title ? (
    <div className="rpf-top-titles">
      <p className="rpf-top-title">{title}</p>
      {kicker && (
        <p className="rpf-top-sub" data-rp="family-date">
          {kicker}
        </p>
      )}
    </div>
  ) : kicker ? (
    <p className="rpf-kicker" data-rp="family-date">
      {kicker}
    </p>
  ) : (
    <span />
  );
  return (
    <div className={cx("rpf rpf-top", className)} data-rp="family-top" style={style}>
      {left}
      <div className="rpf-top-right" data-tight={skip ? "true" : undefined}>
        {skip &&
          (skip.href ? (
            <UiLink href={skip.href} className="rpf-top-link" data-kind="skip" data-testid={skip.testId}>
              {skip.label}
            </UiLink>
          ) : (
            <button type="button" className="rpf-top-link" data-kind="skip" onClick={skip.onClick} data-testid={skip.testId}>
              {skip.label}
            </button>
          ))}
        {/* no 「中 EN」 here since the owner's 10-15: the language is in 「我的 › 语言」 (a page may still pass langHref) */}
        {meHref && (
          <UiLink href={meHref} nav="forward" className="rpf-top-link" data-testid="open-me">
            {meLabel ?? copy.me}
          </UiLink>
        )}
      </div>
    </div>
  );
}

/**
 * The one large sentence of a screen and the line under it. One colour: the state is said in words (and by the week's
 * marks and the timeline's nodes), never by colouring a word. `tone` stays on the element for tests and for the spacing
 * of what follows; `icon` is kept for older callers and not drawn.
 */
export function FamilyHero({
  title,
  detail,
  tone = "ok",
  rise = false,
  className,
  style,
}: FamilyBaseProps & { title: ReactNode; detail?: ReactNode; tone?: "ok" | "chk" | "quiet"; icon?: IconName; /** the sentence is a new state coming in (the draft's one motion) */ rise?: boolean }) {
  return (
    <div className={cx("rpf rpf-hero", rise && "rpf-rise", className)} data-rp="family-hero" data-tone={tone} data-lede={detail ? "true" : undefined} style={style}>
      <h1 className="rpf-h1" data-testid="family-headline">
        {title}
      </h1>
      {detail && (
        <p className="rpf-sub" data-testid="family-lede">
          {detail}
        </p>
      )}
    </div>
  );
}

/**
 * The bottom group of a screen: her one solid button, an outlined one, plain words, a note. It sits at the bottom of
 * the phone while the content above is shorter than the screen. `foot` picks the draft's spacing for the group:
 *   (none) two buttons with the foot line after them      b  a button and plain words (6px apart)
 *   c, d   a button alone, a little off the bottom        e  a single button, 24px off the bottom
 *   h      an outlined button and plain words             n  a note alone
 */
export function FamilyDock({ children, foot, className, style }: FamilyBaseProps & { children: ReactNode; foot?: "b" | "c" | "d" | "e" | "h" | "n" }) {
  return (
    <div className={cx("rpf rpf-dock", className)} data-rp="family-dock" data-foot={foot} style={style}>
      {children}
    </div>
  );
}

/** A small grey line: 「这些开关只有爸爸能在他的手机上改。」. An icon only when one is asked for. */
export function FamilyNote({ icon, children, className, style }: FamilyBaseProps & { icon?: IconName; children: ReactNode }) {
  return (
    <p className={cx("rpf rpf-note", className)} data-rp="family-note" style={style}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </p>
  );
}

/** A group's name above its rows: 「账号」, 「现在放的」. */
export function FamilySection({ children, className, style }: FamilyBaseProps & { children: ReactNode }) {
  return (
    <p className={cx("rpf rpf-section", className)} data-rp="family-section" style={style}>
      {children}
    </p>
  );
}
