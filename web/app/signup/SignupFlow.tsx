"use client";

/**
 * Sign-up, one screen per step (docs/plan/real-app.md 2.2; track A): language, how to address him, his account (a
 * username or an e-mail address; no e-mail needed), a password, who is tapping (himself, or family helping: then the
 * two consents say his own tap is needed), the terms in plain words, AI processing (he may refuse and still use
 * Ripple), where to start (blank, or Mr Tan's example data); then one POST /api/auth/signup makes everything and the
 * recovery code is shown once, with a card to print. Every step has 「返回」 until the account exists.
 *
 * The data choice comes before the code screen (2.2 lists it after): sign-up is one step on the server (real-app 3.4:
 * identity, account, space, consents, code), so the space has to be known when it runs and the code is shown last,
 * once the account really exists.
 *
 * The look is the iOS app's (components/auth-ui; web/progress/fe-auth.md). Every step is ProfileSetupView's screen: back
 * and the step count in the top bar, a bold title on the left with a grey line under it, the field or the choices, and
 * the filled button at the bottom. The name step has its circle with his initial. What the iOS app has no screen for
 * (the choices, the two texts he agrees to, the recovery code and its card) is built from the same parts: surface
 * blocks with a hairline, the same corners and spacing.
 */
import { useState, type FormEvent } from "react";
import {
  AuthAvatar,
  AuthChoiceList,
  AuthCode,
  AuthDock,
  AuthError,
  AuthField,
  AuthHead,
  AuthHint,
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
} from "@/components/auth-ui";
import type { SignupAnswer, SignupBody } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { parseLoginName } from "@/lib/auth/login-name";
import { passwordProblem } from "@/lib/auth/passwords";
import { readAloudLines } from "@/lib/auth/read-aloud-text";
import { CURRENT_CONSENT_VERSIONS, currentConsentText } from "@/lib/privacy/consent-texts";

type Step = "name" | "account" | "password" | "terms" | "ai" | "space" | "code" | "card";
// 2026-10-18: the language screen and the "who is tapping" screen are gone (the owner's round: the browser's language
// already picks the first, and asking an elder whether he is helping himself read as a speed bump). The language still
// follows the front door's switch (/?lang=), and "a family member is helping me" is one quiet toggle on the name screen.
const ORDER: Step[] = ["name", "account", "password", "terms", "ai", "space", "code"];
const TOTAL = ORDER.length;

export function SignupFlow({ initialLocale, readAloud = false }: { initialLocale: AccountLocale; readAloud?: boolean }) {
  const locale = initialLocale;
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [helper, setHelper] = useState<"self" | "family">("self");
  const [ai, setAi] = useState<"granted" | "declined" | null>(null);
  const [space, setSpace] = useState<"blank" | "example" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SignupAnswer | null>(null);
  const c = accountCopy(locale);
  const who = name.trim() || (locale === "en" ? "he" : "他");

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

  async function submit() {
    if (!space || !ai) return;
    setPending(true);
    setError(null);
    const body: SignupBody = {
      login: login.trim(),
      password,
      display_name: name.trim(),
      locale,
      assisted: helper === "family",
      consents: {
        terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy },
        ai_processing: { decision: ai, version: CURRENT_CONSENT_VERSIONS.ai_processing },
        ...(space === "example" ? { example_data: { version: CURRENT_CONSENT_VERSIONS.example_data } } : {}),
      },
      space,
    };
    const r = await callAccount<SignupAnswer>("/api/auth/signup", body);
    setPending(false);
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
        if (!name.trim() || name.trim().length > 40) return setError(c.nameMissing);
        return go("account");
      case "account": {
        const parsed = parseLoginName(login);
        if (!parsed.ok) return setError(errorWords(parsed.error, locale));
        setPending(true);
        const r = await callAccount("/api/auth/check-login", { login: login.trim() });
        setPending(false);
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
      case "space":
        if (!space) return setError(c.spaceMissing);
        return submit();
    }
  }

  // the top bar: back (to the step before, or to the welcome screen from the first one) and where he is
  const top = (s: Step) => {
    const first = ORDER.indexOf(s) === 0;
    return <AuthNav data-rp="meta" back={first ? { label: c.back, href: "/", testId: "step-back" } : { label: c.back, onClick: back, testId: "step-back" }} step={stepLabel(s)} />;
  };
  const title = (words: string) => (
    <AuthTitle data-rp="headline" data-variant="status">
      {words}
    </AuthTitle>
  );
  const nextButton = (label = c.next) => (
    <AuthPrimaryButton type="submit" pending={pending} data-testid="signup-next">
      {label}
    </AuthPrimaryButton>
  );

  // ------------------------------------------------------------ the recovery code and its card
  if ((step === "code" || step === "card") && result) {
    if (step === "card") {
      return (
        <AuthScreen locale={locale}>
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
      <AuthScreen locale={locale}>
        <div data-testid="signup-step-code" className={authFlow}>
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
  const example = currentConsentText("example_data", locale);

  return (
    <AuthScreen locale={locale}>
      <form onSubmit={onNext} className={authFlow} data-testid={`signup-step-${step}`} noValidate>
        {top(step)}
        {step === "name" && (
          <>
            <AuthHead>{title(c.nameTitle)}</AuthHead>
            {/* ProfileSetupView's circle: his initial as he types */}
            <AuthAvatar name={name} />
            <AuthField label={c.nameLabel} value={name} onChange={setName} placeholder={c.namePlaceholder} autoComplete="nickname" testId="signup-name" error={error} autoFocus />
            {/* the language step is gone: the same choice is one quiet word on this screen, and it keeps the address's ?as= */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              {/* the one home of the old 「现在是谁在点？」 screen: quiet, and only there for the case it serves */}
              <button
                type="button"
                data-testid="signup-assisted"
                aria-pressed={helper === "family"}
                onClick={() => {
                  setHelper(helper === "family" ? "self" : "family");
                  setError(null);
                }}
                style={{ display: "flex", alignItems: "center", minHeight: "var(--rp-hit)", background: "none", border: 0, padding: "0 2px", color: "inherit", fontSize: "var(--rp-fs-min)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", opacity: 0.85 }}
              >
                {helper === "family" ? c.helperSelf : c.helperFamily}
              </button>
              <button
                type="button"
                data-testid="signup-lang-switch"
                aria-label={locale === "en" ? "Switch to 华语" : "Switch to English"}
                onClick={() => {
                  const u = new URL(window.location.href);
                  u.searchParams.set("lang", locale === "en" ? "zh-Hans" : "en");
                  window.location.assign(u.toString());
                }}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "var(--rp-hit)", minWidth: "var(--rp-hit)", background: "none", border: 0, padding: "0 2px", color: "inherit", fontSize: "var(--rp-fs-min)", fontWeight: 600, cursor: "pointer", opacity: 0.7 }}
              >
                {locale === "en" ? "华语" : "English"}
              </button>
            </div>
            {helper === "family" && <AuthHint testId="assisted-note">{c.helperFamilyNote(who)}</AuthHint>}
            <AuthDock>{nextButton()}</AuthDock>
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
              onChange={setLogin}
              placeholder={c.accountPlaceholder}
              autoComplete="username"
              autoCapitalize="none"
              inputMode="email"
              testId="signup-login"
              error={error}
              autoFocus
            />
            <AuthDock>{nextButton()}</AuthDock>
          </>
        )}

        {step === "password" && (
          <>
            <AuthHead>
              {title(c.passwordTitle)}
              <AuthText variant="lede">{c.passwordLede}</AuthText>
            </AuthHead>
            <AuthPasswordField copy={c} newPassword label={c.passwordLabel} value={password} onChange={setPassword} testId="signup-password" error={error} autoFocus />
            {/* real-app 2.4: the sign-up says what a forgotten password means before he chooses one */}
            <AuthText variant="lede">{c.passwordForgot}</AuthText>
            <AuthDock>{nextButton()}</AuthDock>
          </>
        )}

        {step === "terms" && (
          <>
            <AuthHead>{title(terms.title)}</AuthHead>
            <AuthReadAloud screen="terms_privacy" locale={locale} copy={c} available={readAloud} />
            <AuthParagraphs paragraphs={terms.paragraphs} testId="signup-terms-text" />
            <AuthLinks links={[{ href: "/privacy", label: c.termsFull, newTab: true }]} />
            {helper === "family" && <AuthHint testId="assisted-note">{c.assistedNote(who)}</AuthHint>}
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
            {helper === "family" && <AuthHint testId="assisted-note">{c.assistedNote(who)}</AuthHint>}
            {/* the two answers in one row, 「不同意，也继续用」 on the left and 「同意」 on the right, at the bottom of the
                phone with the text scrolling under them: both are there as the screen opens (owner's tidy of 10-13).
                The long one wraps to two lines in its half; the type keeps its size. */}
            <AuthDock pinned>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                <AuthSecondaryButton
                  onClick={() => {
                    setAi("declined");
                    go("space");
                  }}
                  data-testid="signup-ai-decline"
                >
                  {c.aiDecline}
                </AuthSecondaryButton>
                <AuthPrimaryButton
                  onClick={() => {
                    setAi("granted");
                    go("space");
                  }}
                  data-testid="signup-ai-agree"
                >
                  {c.aiAgree}
                </AuthPrimaryButton>
              </div>
            </AuthDock>
          </>
        )}

        {step === "space" && (
          <>
            <AuthHead>{title(c.spaceTitle)}</AuthHead>
            <AuthChoiceList
              label={c.spaceTitle}
              value={space}
              onChange={(v) => {
                setSpace(v);
                setError(null);
              }}
              options={[
                { value: "blank", title: c.spaceBlank, sub: c.spaceBlankSub },
                { value: "example", title: example.title, sub: example.paragraphs.join(" ") },
              ]}
              testId="signup-space"
            />
            {/* real-app 3.11: an example account's clock is Singapore's, wherever he is; said here, under that choice.
                (The line inside the card is the example_data consent text, versioned and hashed: not added to.) */}
            <AuthText variant="note" data-testid="signup-example-clock">
              {c.spaceExampleClock}
            </AuthText>
            {error && <AuthError testId="signup-error">{error}</AuthError>}
            <AuthDock>{nextButton(c.finish)}</AuthDock>
          </>
        )}
      </form>
    </AuthScreen>
  );
}
