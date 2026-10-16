"use client";

/**
 * A son's or daughter's sign-up, the short one (line fe-entry; owner 2026-10-11: at the door a person says whether he
 * is the elder or a son or daughter, and goes into that side). One screen per step: how to address you, an account, a
 * password, the terms in plain words, AI processing (she may refuse), then one POST /api/auth/signup with space "none"
 * (an account that only looks: no records of her own are made) and the recovery code, shown once, with its card to
 * print. 「我记下了」 leads where the server says: /f, where she names the elder's account (line "bind").
 *
 * It is the elder's sign-up (SignupFlow, left as it is) without the three steps that are his: no language step (the
 * door has the switch; the page's language is the account's), no 「现在是谁在点」 (she taps for herself: assisted is
 * false), no 「从哪里开始」 (she has no space of her own). The words are his flow's own (lib/auth/copy.ts), the two
 * texts she agrees to are the same texts at the same versions, and the recovery-code screen says the same sentences.
 * What is hers: the two examples (a name, an account), and under the name the sentence her sign-up on the way into an
 * invitation already says (real-app 2.20: this account keeps no records of her own).
 *
 * The look: the same parts as his (components/auth-ui), drawn for the family: the iOS app's dark colours at the iOS
 * sizes (<AuthScreen side="family">). Every step is ProfileSetupView's screen, as his.
 */
import { useState, type FormEvent } from "react";
import {
  AuthAvatar,
  AuthCode,
  AuthDock,
  AuthError,
  AuthField,
  AuthHead,
  AuthLinks,
  AuthNav,
  AuthParagraphs,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthReadAloud,
  AuthRecoveryCard,
  AuthScreen,
  AuthSecondaryButton,
  AuthText,
  AuthTitle,
  authFlow,
  authNoPrint,
  entryCopy,
  entryHref,
} from "@/components/auth-ui";
import type { SignupAnswer, SignupBody } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { parseLoginName } from "@/lib/auth/login-name";
import { passwordProblem } from "@/lib/auth/passwords";
import { readAloudLines } from "@/lib/auth/read-aloud-text";
import { hc } from "@/lib/care/her-copy";
import { CURRENT_CONSENT_VERSIONS, currentConsentText } from "@/lib/privacy/consent-texts";

type Step = "name" | "account" | "password" | "terms" | "ai" | "code" | "card";
const ORDER: Step[] = ["name", "account", "password", "terms", "ai", "code"];
const TOTAL = ORDER.length;

export function FamilySignupFlow({
  locale,
  lang = null,
  readAloud = false,
}: {
  locale: AccountLocale;
  /** a language the address asked for: it goes on with her to the door */
  lang?: AccountLocale | null;
  readAloud?: boolean;
}) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // what is on its way: the question whether the account's name is free, or the sign-up with her answer about AI
  const [pending, setPending] = useState<"check" | "granted" | "declined" | null>(null);
  const [result, setResult] = useState<SignupAnswer | null>(null);
  const c = accountCopy(locale);
  const w = entryCopy(locale);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };
  const back = () => {
    const i = ORDER.indexOf(step);
    if (i > 0) go(ORDER[i - 1]);
  };
  const stepLabel = (s: Step) => c.stepOf(ORDER.indexOf(s) + 1, TOTAL);
  /** What she types takes the place of what was wrong with it: the sentence under a field goes when she changes the field. */
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setError(null);
  };

  /** One step on the server: her account, the two consents, no space of her own; then the recovery code. */
  async function submit(ai: "granted" | "declined") {
    setPending(ai);
    setError(null);
    const body: SignupBody = {
      login: login.trim(),
      password,
      display_name: name.trim(),
      locale,
      assisted: false,
      consents: {
        terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy },
        ai_processing: { decision: ai, version: CURRENT_CONSENT_VERSIONS.ai_processing },
      },
      space: "none",
    };
    const r = await callAccount<SignupAnswer>("/api/auth/signup", body);
    setPending(null);
    if (r.ok) {
      setResult(r.body);
      go("code");
      return;
    }
    const e = r.body.error ?? "unavailable";
    // real-app 3.5: the sign-up limit says what happened (「这台设备今天注册太多次了」), with when to come back
    const words = e === "too_many" ? c.signupTooMany(clockTime(r.body.until, locale) ?? (locale === "en" ? "a while" : "过一会儿")) : errorWords(e, locale, clockTime(r.body.until, locale));
    if (/^(login_|username_|email_)/.test(e)) {
      go("account");
      setError(words);
    } else if (e.startsWith("password_")) {
      go("password");
      setError(words);
    } else if (e === "consent_version") {
      go("terms");
      setError(words);
    } else setError(words);
  }

  async function onNext(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    switch (step) {
      case "name":
        if (!name.trim() || name.trim().length > 40) return setError(w.familyNameMissing);
        return go("account");
      case "account": {
        const parsed = parseLoginName(login);
        if (!parsed.ok) return setError(errorWords(parsed.error, locale));
        setPending("check");
        const r = await callAccount("/api/auth/check-login", { login: login.trim() });
        setPending(null);
        if (!r.ok) return setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
        return go("password");
      }
      case "password": {
        const parsed = parseLoginName(login);
        const problem = passwordProblem(password, parsed.ok ? parsed.login : null);
        if (problem) return setError(errorWords(problem, locale));
        return go("terms");
      }
      case "terms":
        return go("ai");
    }
  }

  // the top bar: back (to the step before, or to the welcome screen from the first one) and where she is
  const top = (s: Step) => {
    const first = ORDER.indexOf(s) === 0;
    return <AuthNav data-rp="meta" back={first ? { label: c.back, href: entryHref("/", { lang }), testId: "step-back" } : { label: c.back, onClick: back, testId: "step-back" }} step={stepLabel(s)} />;
  };
  const title = (words: string) => (
    <AuthTitle data-rp="headline" data-variant="status">
      {words}
    </AuthTitle>
  );
  const nextButton = (
    <AuthPrimaryButton type="submit" pending={pending === "check"} data-testid="signup-next">
      {c.next}
    </AuthPrimaryButton>
  );

  // ------------------------------------------------------------ the recovery code and its card
  if ((step === "code" || step === "card") && result) {
    if (step === "card") {
      return (
        <AuthScreen locale={locale} side="family">
          <div className={authNoPrint}>
            <AuthNav data-rp="meta" back={{ label: c.back, onClick: () => go("code"), testId: "step-back" }} />
          </div>
          <AuthRecoveryCard copy={c} login={result.login} code={result.recovery_code} />
          <div className={authNoPrint} style={{ display: "contents" }}>
            <AuthDock>
              <AuthPrimaryButton onClick={() => window.print()} data-testid="card-print">
                {c.print}
              </AuthPrimaryButton>
              <AuthSecondaryButton onClick={() => go("code")} data-testid="card-back">
                {c.back}
              </AuthSecondaryButton>
            </AuthDock>
          </div>
        </AuthScreen>
      );
    }
    // the screen's sentences come from the function 「读给我听」 reads (lib/auth/read-aloud-text.ts)
    const [codeTitle, codeWarning, codeLede, codeOnce, codeNoOther] = readAloudLines("recovery_code", locale);
    return (
      <AuthScreen locale={locale} side="family">
        <div data-testid="signup-step-code" data-flow="family" className={authFlow}>
          {/* the account exists now: nothing to go back to */}
          <AuthNav data-rp="meta" step={stepLabel("code")} />
          <AuthHead>{title(codeTitle)}</AuthHead>
          <AuthReadAloud screen="recovery_code" locale={locale} copy={c} available={readAloud} />
          <AuthCode code={result.recovery_code} label={c.cardCode} />
          <AuthText variant="strong">{codeWarning}</AuthText>
          <AuthText variant="lede">{codeLede}</AuthText>
          <AuthText variant="lede">{codeOnce}</AuthText>
          <AuthText variant="lede">{codeNoOther}</AuthText>
          <AuthDock>
            {/* where the server says: /f for an account with no space of its own */}
            <AuthPrimaryButton onClick={() => window.location.assign(result.next)} data-testid="signup-kept">
              {c.codeKept}
            </AuthPrimaryButton>
            <AuthSecondaryButton onClick={() => go("card")} data-testid="signup-print-card">
              {c.printCard}
            </AuthSecondaryButton>
          </AuthDock>
        </div>
      </AuthScreen>
    );
  }

  // ------------------------------------------------------------ the steps before the account exists
  const terms = currentConsentText("terms_privacy", locale);
  const aiText = currentConsentText("ai_processing", locale);

  return (
    <AuthScreen locale={locale} side="family">
      <form onSubmit={onNext} className={authFlow} data-testid={`signup-step-${step}`} data-flow="family" noValidate>
        {top(step)}
        {step === "name" && (
          <>
            <AuthHead>{title(c.nameTitle)}</AuthHead>
            {/* ProfileSetupView's circle: her initial as she types */}
            <AuthAvatar name={name} />
            <AuthField label={c.nameLabel} value={name} onChange={edit(setName)} placeholder={w.familyNamePlaceholder} autoComplete="nickname" testId="signup-name" error={error} autoFocus />
            {/* real-app 2.20: her sign-up says what this account is, in the words her invitation's sign-up uses */}
            <AuthText variant="note" data-testid="signup-family-note">
              {hc(locale, "signupNote")}
            </AuthText>
            {/* no 「已经有账号？ 登录」 here (owner's tidy of 10-13): the log-in is on the welcome screen, one 「返回」 away */}
            <AuthDock>{nextButton}</AuthDock>
          </>
        )}

        {step === "account" && (
          <>
            <AuthHead>
              {title(c.accountTitle)}
              <AuthText variant="lede">{c.accountLede}</AuthText>
            </AuthHead>
            <AuthField
              label={c.accountLabel}
              value={login}
              onChange={edit(setLogin)}
              placeholder={w.familyAccountPlaceholder}
              autoComplete="username"
              autoCapitalize="none"
              inputMode="email"
              testId="signup-login"
              error={error}
              autoFocus
            />
            <AuthDock>{nextButton}</AuthDock>
          </>
        )}

        {step === "password" && (
          <>
            <AuthHead>
              {title(c.passwordTitle)}
              <AuthText variant="lede">{c.passwordLede}</AuthText>
            </AuthHead>
            <AuthPasswordField copy={c} newPassword label={c.passwordLabel} value={password} onChange={edit(setPassword)} testId="signup-password" error={error} autoFocus />
            {/* real-app 2.4: the sign-up says what a forgotten password means before she chooses one */}
            <AuthText variant="lede">{c.passwordForgot}</AuthText>
            <AuthDock>{nextButton}</AuthDock>
          </>
        )}

        {step === "terms" && (
          <>
            <AuthHead>{title(terms.title)}</AuthHead>
            <AuthReadAloud screen="terms_privacy" locale={locale} copy={c} available={readAloud} />
            <AuthParagraphs paragraphs={terms.paragraphs} testId="signup-terms-text" />
            <AuthLinks links={[{ href: "/privacy", label: c.termsFull, newTab: true }]} />
            {error && <AuthError testId="signup-error">{error}</AuthError>}
            <AuthDock>
              <AuthPrimaryButton type="submit" data-testid="signup-agree">
                {c.termsAgree}
              </AuthPrimaryButton>
            </AuthDock>
          </>
        )}

        {step === "ai" && (
          <>
            <AuthHead>{title(aiText.title)}</AuthHead>
            <AuthReadAloud screen="ai_processing" locale={locale} copy={c} available={readAloud} />
            <AuthParagraphs paragraphs={aiText.paragraphs} testId="signup-ai-text" />
            {error && <AuthError testId="signup-error">{error}</AuthError>}
            {/* either answer makes the account: the sign-up goes out with it */}
            {/* the two answers in one row, 「不同意，也继续用」 on the left and 「同意」 on the right, as on the elder's sign-up
                (owner's tidy of 10-13) */}
            <AuthDock>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                <AuthSecondaryButton onClick={() => submit("declined")} pending={pending === "declined"} disabled={pending !== null} data-testid="signup-ai-decline">
                  {c.aiDecline}
                </AuthSecondaryButton>
                <AuthPrimaryButton onClick={() => submit("granted")} pending={pending === "granted"} disabled={pending !== null} data-testid="signup-ai-agree">
                  {c.aiAgree}
                </AuthPrimaryButton>
              </div>
            </AuthDock>
          </>
        )}
      </form>
    </AuthScreen>
  );
}
