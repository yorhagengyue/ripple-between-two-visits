/**
 * /who — 「你是哪一位？」 (line fe-entry; owner 2026-10-11: on signing up or logging in a person says whether he is the
 * elder or a son or daughter, and goes into that side). The welcome screen's 「注册」 and 「登录」 lead here with
 * ?do=signup or ?do=login (anything else is signing up); the two choices lead to that side's page:
 * /signup?as=elder|family, /login?as=elder|family. Someone already signed in goes on to where he belongs, as on "/".
 *
 * Still the door: the same dark set as the welcome (AUTH_SCHEME.door) and the elder's size, because an elder reads this
 * page whichever choice he makes. The iOS app asks no such question; the screen is its SignInView, the one screen there
 * that offers two ways on: the mark at 150 and a centred title in the middle of the free space, and the two ways at the
 * bottom of the phone, one under another. Here each way is a whole card with a title and one line (components/auth-ui
 * AuthWay). The mark is still: the log-in after it plays it, as SignInView does. The top bar has the way back to the
 * welcome and, on the right, which of the two he is on his way to.
 */
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { AuthDock, AuthHero, AuthHeroText, AuthLogo, AuthNav, AuthScreen, AuthTitle, AuthWay, doParam, entryCopy, entryHref } from "@/components/auth-ui";
import { accountCopy } from "@/lib/auth/copy";
import { asAccountLocale, pageLocale } from "@/lib/auth/page-locale";
import { signedInHome } from "@/lib/subject/account";
import { authThemeColor } from "@/lib/ui/auth-tokens";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "你是哪一位？ · Ripple" };
// the browser's own bar takes the ground of the set of colours the door is drawn in (lib/ui/auth-tokens.ts)
export const viewport: Viewport = { themeColor: authThemeColor("door") };

export default async function WhoPage({ searchParams }: PageProps<"/who">) {
  const home = await signedInHome();
  if (home) redirect(home);
  const q = await searchParams;
  const locale = await pageLocale(q.lang);
  // a language the address asked for goes on with him, forward and back
  const lang = asAccountLocale(Array.isArray(q.lang) ? q.lang[0] : q.lang);
  const what = doParam(q.do);
  const c = accountCopy(locale);
  const w = entryCopy(locale);
  const page = what === "login" ? "/login" : "/signup";
  return (
    <AuthScreen locale={locale} side="door" data-testid="who">
      <AuthNav data-rp="meta" back={{ label: c.back, href: entryHref("/", { lang }), testId: "step-back" }} step={what === "login" ? c.logIn : c.signUp} />
      <AuthHero centre>
        <AuthLogo size="login" />
        <AuthHeroText gap={10}>
          <AuthTitle align="centre" data-rp="headline" data-variant="status">
            {w.whoTitle}
          </AuthTitle>
        </AuthHeroText>
      </AuthHero>
      <AuthDock data-do={what}>
        <AuthWay href={entryHref(page, { as: "elder", lang })} icon="person" title={w.elderTitle} data-testid="who-elder">
          {w.elderLine}
        </AuthWay>
        <AuthWay href={entryHref(page, { as: "family", lang })} icon="people" title={w.familyTitle} data-testid="who-family">
          {w.familyLine}
        </AuthWay>
      </AuthDock>
    </AuthScreen>
  );
}
