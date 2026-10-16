/**
 * "/" — the front door (real-app 2.1). Signed in: straight to where the person belongs (his Today, his setting up, or
 * her family page; lib/subject/account.ts signedInHome). Not signed in: the app opens as the iOS app does: the cold
 * start's black screen with the mark drawing itself in (AuthSplash; once in a browser session, and not at all with
 * reduced motion), then the welcome screen: what Ripple is in one sentence, 注册 and 登录, the language switch, and one
 * small line for judges pointing to the side-by-side demo at /demo. 注册 and 登录 lead to 「你是哪一位？」 (/who), where a
 * person says whether he is the elder or a son or daughter, and from there to that side's sign-up or log-in.
 * This page makes no sandbox and sets no cookie (the judges' split page and its sandbox live at /demo, track E).
 *
 * The look is the iOS app's SplashView and WelcomeView (components/auth-ui; web/progress/fe-entry.md, and fe-auth.md
 * for the set of parts), in the iOS app's own dark colours: the door's set is AUTH_SCHEME.door in lib/ui/auth-tokens.ts.
 * The welcome: the mark, still (the splash has just drawn it), the large title, one grey line, and the bottom area that
 * stays put: the filled 「注册」, 「登录」 as quiet teal words under it, the judges' line as small print. WelcomeView's
 * three rows of what the app does are left out: the repo has no such lines in both languages yet, and none are
 * invented here (AuthFeatures and AuthFeatureRow are ready for them). Without the rows the head sits in the middle of
 * the free space, as SignInView's does. The three page dots are left out too: there is one page.
 */
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
// The screen is called Screen here: tests/unit/ui/components.test.ts finds this page by `<Screen … data-testid="front-door">`.
import { AuthDock, AuthHero, AuthHeroText, AuthLogo, AuthNav, AuthPrimaryButton, AuthScreen as Screen, AuthSplash, AuthText, AuthTextButton, AuthTitle, entryHref } from "@/components/auth-ui";
import { asAccountLocale, pageLocale } from "@/lib/auth/page-locale";
import { signedInHome } from "@/lib/subject/account";
import { authThemeColor } from "@/lib/ui/auth-tokens";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ripple" };
// the browser's own bar takes the ground of the set of colours the door is drawn in (lib/ui/auth-tokens.ts)
export const viewport: Viewport = { themeColor: authThemeColor("door") };

const WORDS = {
  "zh-Hans": {
    lede: "看医生时把医生的话留下来，回家听得懂、记得住。",
    signup: "注册",
    login: "登录",
    langSwitch: "中/EN",
    langSwitchLabel: "切换语言：English",
  },
  en: {
    lede: "Keep what the doctor said at the visit, and understand and remember it at home.",
    signup: "Sign up",
    login: "Log in",
    langSwitch: "中/EN",
    langSwitchLabel: "Switch language: 中文",
  },
} as const;

export default async function FrontDoor({ searchParams }: PageProps<"/">) {
  const home = await signedInHome();
  if (home) redirect(home);
  const q = await searchParams;
  const locale = await pageLocale(q.lang);
  // a language the address asked for (the switch up here) goes on with him to the next page
  const lang = asAccountLocale(Array.isArray(q.lang) ? q.lang[0] : q.lang);
  const w = WORDS[locale];
  return (
    <Screen locale={locale} side="door" data-testid="front-door">
      {/* owner 10-15: no 「中 EN」 at the top right; the language is set in 「我」 / 「我的」 and English is the default until then */}
      <AuthNav data-rp="meta" />
      <AuthHero centre>
        <AuthLogo size="welcome" decorative />
        <AuthHeroText>
          <AuthTitle size="large" align="centre" data-rp="headline" data-variant="status">
            Ripple
          </AuthTitle>
          <AuthText variant="lede" align="centre" inset={28}>
            {w.lede}
          </AuthText>
        </AuthHeroText>
      </AuthHero>
      <AuthDock pinned>
        <AuthPrimaryButton href={entryHref("/who", { do: "signup", lang })} nav="forward" shape="hero" data-testid="front-door-signup">
          {w.signup}
        </AuthPrimaryButton>
        <AuthTextButton href={entryHref("/who", { do: "login", lang })} nav="forward" data-testid="front-door-login">
          {w.login}
        </AuthTextButton>
        {/* the judges' link to /demo is gone (owner, 10-14): the judges are given two accounts in the submission; /demo
            stays the film crew's */}
      </AuthDock>
      {/* last: over everything above while it plays, and the mark of the welcome stays the first mark on the page */}
      <AuthSplash />
    </Screen>
  );
}
