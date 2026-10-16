"use client";

/**
 * What every header of an account's screens carries, said once (C2 track C; real-app 2.23 line 306, 4.7 line 993):
 *
 *   no language switch: the owner's decision of 10-15 (「中英文的设置直接放到我的里面。不要再在右上角显示」) moved it
 *                back into 「我 › 语言」 (app/p/profile/language), which keeps the choice on his account;
 *   under it     one line that stays under the header on every screen (the example account's 「示例资料：陈先生（虚构
 *                人物）」; app/p/layout.tsx hands it in).
 * 「我」 is not in his headers any more (owner, 10-14): it is the fourth place of his bottom bar (components/ui/TabBar.tsx),
 * so the round 「我」 that stood right of the switch is gone from every screen of his account.
 *
 * The account branch of app/p/layout.tsx wraps its pages in <AccountHeaderProvider>; MetaBar (the one top line every
 * screen draws) renders <HeaderMe> and <HeaderUnder>, which read it. Without the provider both render nothing more
 * than MetaBar's own props say: the demo, the filming session, /design, /onboard, sign-up and her screens are unchanged.
 * So a page file needs no prop for either, and a new account page gets both as soon as it draws a MetaBar.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { UiLocale } from "@/lib/ui/tokens";
import { UiLink } from "./UiLink";

interface AccountHeader {
  /** the line under the header on every screen; null: none */
  under: ReactNode | null;
  /** the language his screens are in, for 「中 EN」; null (no provider): no switch */
  locale: UiLocale | null;
}

const NONE: AccountHeader = { under: null, locale: null };
const Ctx = createContext<AccountHeader>(NONE);

export function AccountHeaderProvider({
  under = null,
  locale,
  children,
}: {
  under?: ReactNode | null;
  /** the language in use (app/p/layout.tsx: the rp_lang cookie) */
  locale: UiLocale;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ under, locale }}>{children}</Ctx.Provider>;
}

/** Is this screen inside an account's header provider that already draws the line under the header? */
export function useHeaderUnder(): boolean {
  return useContext(Ctx).under !== null;
}

/**
 * The right end of a header. On his account: nothing (the language moved into 「我 › 语言」 on 10-15; 「我」 is a place of
 * his bottom bar since 10-14, so a header never draws the 「我」 circle there, whatever the page passed). A header that leaves it
 * out on purpose (`me={false}`: the page the doctor reads, recording and saving a visit) does not render this at all,
 * so it has no switch: a tap on it would load the screen again. Outside the provider (the demo, /design) there is no
 * switch (MetaBar's `langHref` is theirs), and the 「我」 circle is drawn only where the page passes `href` (meHref).
 */
export function HeaderMe({ href, label }: { href?: string; label: string }) {
  const { locale } = useContext(Ctx);
  // his account: nothing at the right end (the language is 「我 › 语言」 since the owner's 10-15; 「我」 is his bottom bar)
  if (locale) return null;
  // the draft's header outside an account: a white circle with the word in it (52px), no icon
  return href ? (
    <UiLink href={href} className="rpu-me" data-kind="me">
      {label}
    </UiLink>
  ) : null;
}

/** The line that stays under the header (nothing without the provider). */
export function HeaderUnder() {
  return <>{useContext(Ctx).under}</>;
}
