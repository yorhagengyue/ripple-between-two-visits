"use client";

/**
 * Log-in in two screens (docs/plan/real-app.md 2.3; track A): his account, then his password, with 「这不是我的手机」
 * (the sign-in ends with the browser, 12 hours at most). A wrong login or password is one sentence that never says
 * which. From the sixth wrong password within 15 minutes this phone is locked until a time it names, with two ways
 * on: reset with the recovery code, or wait. On success he goes back to the page he was sent away from.
 *
 * The look is the iOS app's (components/auth-ui; web/progress/fe-auth.md): the account screen has SignInView's head (the
 * mark at 150, drawing itself in once as it does there, a centred title and line) over EmailEntryView's form (a field
 * with its icon, the filled button right under it with its arrow); the password screen is EmailEntryView's, with the
 * account's name in teal as VerifyCodeView writes the address.
 *
 * Two sides, one flow (line fe-entry; web/progress/fe-entry.md): `side` is whose log-in this is, the elder's (light, his
 * size) or his son's or daughter's (the iOS dark at the iOS sizes); app/login/page.tsx works it out from the address.
 * The steps, the words and what they do are the same; only the screen's side differs, and the language switch in the
 * top bar, which only her page has.
 *
 * The account screen carries no links under its button (owner's tidy of 10-13): the sign-up and the other side's
 * log-in are reached from the welcome screen (「返回」), and 「忘记密码？用恢复码」 stands on the password screen and on the
 * locked one, where the account's name is already known.
 */
import { useState, type FormEvent } from "react";
import {
  AuthActions,
  AuthDock,
  AuthError,
  AuthField,
  AuthHead,
  AuthHero,
  AuthHeroText,
  AuthLinks,
  AuthLogo,
  AuthNav,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthScreen,
  AuthSecondaryButton,
  AuthSwitchRow,
  AuthText,
  AuthTitle,
  authFlow,
  entryHref,
} from "@/components/auth-ui";
import type { LoginAnswer } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import type { AuthSide } from "@/lib/ui/auth-tokens";

type Step = "account" | "password" | "locked";

export function LoginFlow({
  locale,
  next,
  side = "elder",
  lang = null,
}: {
  locale: AccountLocale;
  next: string | null;
  langHref: string;
  /** whose log-in this is */
  side?: AuthSide;
  /** a language the address asked for: it goes on with him to the next page */
  lang?: AccountLocale | null;
}) {
  const [step, setStep] = useState<Step>("account");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [notMine, setNotMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // SignInView plays the mark once, at the entry: back on the account screen later, it is simply there
  const [markDrawn, setMarkDrawn] = useState(false);
  const c = accountCopy(locale);
  const recoverHref = `/recover${login.trim() ? `?login=${encodeURIComponent(login.trim())}` : ""}`;

  const go = (s: Step) => {
    setError(null);
    if (s !== "account") setMarkDrawn(true);
    setStep(s);
  };

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (step === "account") {
      if (!login.trim()) return setError(errorWords("login_empty", locale));
      return go("password");
    }
    if (!password) return setError(errorWords("invalid_credentials", locale));
    setPending(true);
    const r = await callAccount<LoginAnswer>("/api/auth/login", { login: login.trim(), password, not_my_phone: notMine, ...(next ? { next } : {}) });
    if (r.ok) {
      window.location.assign(r.body.next);
      return;
    }
    setPending(false);
    setPassword("");
    if (r.body.error === "locked") {
      setLockedUntil(clockTime(r.body.until, locale) ?? null);
      return go("locked");
    }
    setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
  }

  if (step === "locked") {
    return (
      <AuthScreen locale={locale} side={side}>
        <div data-testid="login-step-locked" className={authFlow}>
          <AuthNav data-rp="meta" back={{ label: c.back, onClick: () => go("account"), testId: "step-back" }} />
          <AuthHead>
            <AuthTitle data-rp="headline" data-variant="status">
              {c.lockedTitle}
            </AuthTitle>
            <AuthText variant="lede" size="callout">
              {c.lockedBody(lockedUntil ?? (locale === "en" ? "a while" : "过一会儿"))}
            </AuthText>
          </AuthHead>
          <AuthDock>
            <AuthPrimaryButton href={recoverHref} data-testid="login-locked-recover">
              {c.lockedRecover}
            </AuthPrimaryButton>
            <AuthSecondaryButton onClick={() => go("account")} data-testid="login-locked-ok">
              {c.lockedOk}
            </AuthSecondaryButton>
          </AuthDock>
        </div>
      </AuthScreen>
    );
  }

  // 「账号：chen.tan」 with the name in teal: the sentence is the copy's own, only the name inside it is marked
  const name = login.trim();
  const accountLine = c.loginAs(name);
  const at = name ? accountLine.lastIndexOf(name) : -1;

  return (
    <AuthScreen locale={locale} side={side}>
      <form onSubmit={onSubmit} className={authFlow} data-testid={`login-step-${step}`} noValidate>
        {step === "account" ? (
          <>
            <AuthNav
              data-rp="meta"
              back={{ label: c.back, href: entryHref("/", { lang }), testId: "step-back" }}
              // only her page has the language switch (owner's tidy of 10-13): her sign-out lands here without passing
              // the welcome screen, where his is
              // owner 10-15: no 「中 EN」 at the top right; the language is set in 「我」 / 「我的」 and English is the default until then
            />
            <AuthHero>
              <AuthLogo size="login" animated={!markDrawn} />
              <AuthHeroText gap={10}>
                <AuthTitle align="centre" data-rp="headline" data-variant="status">
                  {c.loginTitle}
                </AuthTitle>
                <AuthText variant="lede" size="callout" align="centre" inset={32}>
                  {c.loginLede}
                </AuthText>
              </AuthHeroText>
            </AuthHero>
            <AuthField label={c.accountLabel} icon="person" value={login} onChange={setLogin} autoComplete="username" autoCapitalize="none" inputMode="email" testId="login-login" error={error} autoFocus />
            <AuthActions>
              <AuthPrimaryButton type="submit" icon="arrow" data-testid="login-next">
                {c.next}
              </AuthPrimaryButton>
            </AuthActions>
          </>
        ) : (
          <>
            <AuthNav data-rp="meta" back={{ label: c.otherAccount, onClick: () => go("account"), testId: "step-back" }} />
            <AuthHead>
              <AuthTitle data-rp="headline" data-variant="status">
                {c.loginPasswordTitle}
              </AuthTitle>
              <AuthText variant="lede">
                {at < 0 ? (
                  accountLine
                ) : (
                  <>
                    {accountLine.slice(0, at)}
                    <b>{name}</b>
                    {accountLine.slice(at + name.length)}
                  </>
                )}
              </AuthText>
            </AuthHead>
            <AuthPasswordField copy={c} label={c.passwordLabel} icon="lock" value={password} onChange={setPassword} testId="login-password" autoFocus />
            <AuthSwitchRow locale={locale} title={c.notMyPhone} description={c.notMyPhoneDesc} on={notMine} onChange={setNotMine} name="not_my_phone" />
            {error && <AuthError testId="login-error">{error}</AuthError>}
            <AuthActions>
              <AuthPrimaryButton type="submit" pending={pending} data-testid="login-submit">
                {c.loginButton}
              </AuthPrimaryButton>
            </AuthActions>
            <AuthLinks links={[{ href: recoverHref, label: c.forgot, testId: "login-to-recover" }]} />
          </>
        )}
      </form>
    </AuthScreen>
  );
}
