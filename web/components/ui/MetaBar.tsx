import type { MouseEventHandler, ReactNode } from "react";
import { uiCopy } from "@/lib/ui/copy";
import { cx, filmingAttr, type UiBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { Icon } from "./icons";
import { UiLink } from "./UiLink";
// C2 track C (only add): on an account's screens the header carries 「我」 and the line under it without a page prop
import { HeaderMe, HeaderUnder } from "./AccountHeader";

/**
 * The header of a screen (the draft's `hd`): 「‹ 返回」 in the accent colour, the title (30; 36 on a screen without a way
 * back or words on the right, as on 「今天」), a grey subtitle under it, and on the right the language switch, the
 * 「我」 circle (outside an account only) or a few words.
 *
 *   <PageHeader title="今天" subtitle="9月19日 周六" locale="zh-Hans" />            (inside an account: 「中 EN」 by itself)
 *   <PageHeader back={{ href: "/p/bp", label: "血压" }} title="记一次血压" subtitle="9月18日 周五" locale="zh-Hans" />
 *   <PageHeader title="等你认" subtitle="Wei Ling 帮你填的" right="第 1 项" locale="zh-Hans" />
 *
 * On his own account (inside app/p/layout.tsx's AccountHeaderProvider) every header has the language switch 「中 EN」 at
 * the top right without a page passing anything (owner's decision of 2026-10-14; his draft has no switch in the elder's
 * header), and the example account's line sits right under it (components/ui/AccountHeader.tsx). 「我」 is not in his
 * headers any more: since 10-14 it is the fourth place of his bottom bar. A screen that is shown to someone else (the
 * page the doctor reads) switches the switch off: `me={false}`, and its line: `under={false}`. Jump menus, session
 * codes and "connected" never go here (director mode only).
 *
 * The way back is a link (`back.href`), or a button where the screen goes back in place (`back.onClick` without an
 * `href`: the second step of a flow back to its first); with both it is the link, and the tap runs `onClick` first
 * (it may call preventDefault and stay; without scripts the link still leads somewhere).
 *
 * Test hooks kept from the first header: data-rp="meta" on the header, data-rp="meta-story" on the subtitle,
 * data-rp="back" on the way back (and `back.testId`), a[data-kind="me"] on 「我」, [data-kind="lang"] on the first
 * header's language chip (`langHref`), data-testid="elder-lang" on an account's 「中 EN」 (data-lang: the language in use).
 */
export function PageHeader({
  title,
  titleAs = "h1",
  subtitle,
  locale,
  back,
  meHref,
  me = true,
  under = true,
  right,
  langHref,
  line = false,
  filming,
  className,
  style,
}: UiBaseProps & {
  title?: ReactNode;
  /** "p": the title is not the page's heading (the screen has its own h1: his question on the ask screen) */
  titleAs?: "h1" | "p";
  /** the grey line under the title: a date, what the screen is about */
  subtitle?: ReactNode;
  locale: UiLocale;
  /** 「‹ 返回」 above the title; `label` names where it goes back to (「今天」, 「血压」) */
  back?: HeaderBack;
  /** the 「我」 circle to his settings (/p/me), outside an account only (/design, the demo): his own screens have 「我」 in
      the bottom bar since 10-14 and never draw the circle */
  meHref?: string;
  /** false: no 「中 EN」 (and no 「我」 circle) on this screen, also inside an account */
  me?: boolean;
  /** false: the account's line under the header (the example account's) is not drawn on this screen */
  under?: boolean;
  /** a few words on the right instead of the circle */
  right?: ReactNode;
  /** the first header's 「中/EN」 chip, for the screens outside an account that still carry it (/design); an account's
      screens never pass it: their switch comes with <HeaderMe> */
  langHref?: string;
  /** a hairline under the header */
  line?: boolean;
}) {
  const copy = uiCopy(locale);
  const titled = title != null || subtitle != null;
  const TitleTag = titleAs;
  const backWords = (
    <>
      <Icon name="back" stroke={2.8} />
      {back?.label ?? copy.back}
    </>
  );
  const backLink = !back ? null : back.href !== undefined ? (
    <UiLink href={back.href} nav="back" className="rpu-back" data-rp="back" data-testid={back.testId} onClick={back.onClick}>
      {backWords}
    </UiLink>
  ) : (
    <button type="button" className="rpu-back" data-rp="back" data-testid={back.testId} onClick={back.onClick}>
      {backWords}
    </button>
  );
  const end = (
    <span className="rpu-meta-end">
      {/* on an account: 「中 EN」 alone (owner's decisions of 10-14; components/ui/AccountHeader.tsx) */}
      {me ? <HeaderMe href={meHref} label={copy.me} /> : null}
      {langHref ? (
        <UiLink className="rpu-chip-btn" data-kind="lang" href={langHref} aria-label={copy.langSwitchLabel} lang="zh-Hans">
          {copy.langSwitch}
        </UiLink>
      ) : null}
      {right != null && (
        <span className="rpu-meta-right" data-rp="meta-right">
          {right}
        </span>
      )}
    </span>
  );
  return (
    <>
      <div className={cx("rpu rpu-meta", className)} data-rp="meta" data-line={line ? "true" : undefined} {...filmingAttr(filming)} style={style}>
        {/* with a title the way back sits on its own line above it; without one it shares the line with 「我」 */}
        {titled && backLink}
        <div className="rpu-meta-row">
          {!titled && backLink}
          {titled && (
            <div className="rpu-meta-text">
              {title != null && (
                <TitleTag className="rpu-meta-title" data-rp="page-title" data-size={!back && right == null ? "big" : undefined}>
                  {title}
                </TitleTag>
              )}
              {subtitle != null && (
                <span className="rpu-meta-story" data-rp="meta-story">
                  {subtitle}
                </span>
              )}
            </div>
          )}
          {end}
        </div>
      </div>
      {under ? <HeaderUnder /> : null}
    </>
  );
}

/**
 * The way back of a header: where it leads (`href`), or what a tap does (`onClick`), or both. `label` names where it
 * goes back to; `testId` puts a hook on it.
 */
export interface HeaderBack {
  href?: string;
  label?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  testId?: string;
}

/**
 * The first header, by its old name and props: the date and time (or 「‹ 返回」) on the left, 「中/EN」 (and outside an
 * account a 「我」 the page asks for) on the right. It draws the same header as <PageHeader>: `story` is its subtitle.
 * Screens are moved to <PageHeader> with a title as the draft's batches reach them.
 *
 * Outside an account there is no language switch without `langHref` (the draft has none in a header). On an account
 * every header has 「中 EN」 by itself (owner's decision of 2026-10-14, see <PageHeader>); 「我 › 语言」 stays as it is.
 */
export function MetaBar({
  story,
  locale,
  langHref,
  back,
  meHref,
  title,
  right,
  filming,
  className,
  style,
}: UiBaseProps & {
  /** the date and time, as the page words it; leave out when `back` is given and there is nothing to add */
  story?: string;
  locale: UiLocale;
  langHref?: string;
  /** a 「‹ 返回」 link in place of the date (or before it when both are given) */
  back?: HeaderBack;
  /** a 「我」 button to his settings (/p/me), outside an account only (see <PageHeader>) */
  meHref?: string;
  /** the screen's title (the draft's header): `story` becomes the grey line under it */
  title?: ReactNode;
  right?: ReactNode;
}) {
  return <PageHeader title={title} subtitle={story} locale={locale} back={back} meHref={meHref} right={right} langHref={langHref} filming={filming} className={className} style={style} />;
}
