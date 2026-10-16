"use client";

/**
 * Forgotten password (docs/plan/real-app.md 2.4; track A). Two ways, both starting from his account:
 *
 *   the recovery code   his account, the 12 letters and digits on his card, a new password. Then every other sign-in
 *                       has ended, the code he used no longer works and a new one is shown once (with its card).
 *   family help         (off until he turned it on under 「我」) on a phone he has used he taps 「请家人帮忙」; she is given
 *                       a 6-digit number on her own phone and reads it to him; he types it here, then a new password.
 *                       The number works only on this phone, once, for 10 minutes.
 *
 * A wrong account or code is one sentence that never says which. Both work on a phone the login lock has locked. The
 * screen says the two limits the design asks for: a new phone with a forgotten password needs the recovery code, and
 * with neither way left the only way is a new account.
 *
 * The look is the iOS app's (components/auth-ui; web/progress/fe-auth.md): back, a bold title with a grey line under it,
 * the field, and the filled button at the bottom. The two code screens (his recovery code, the six digits she reads to
 * him) have VerifyCodeView's look: one centred field, large and evenly spaced, in the box with 13px corners; it is
 * still one field and what he types stays as typed. The screen after her help is AllSetView's: the tick on its teal
 * disc, a large centred title, the rounded button with its glow.
 */
import { useState, type FormEvent } from "react";
import {
  AuthCode,
  AuthDock,
  AuthDone,
  AuthError,
  AuthField,
  AuthHead,
  AuthNav,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthReadAloud,
  AuthRecoveryCard,
  AuthScreen,
  AuthSecondaryButton,
  AuthText,
  AuthTextButton,
  AuthTitle,
  authFlow,
  authNoPrint,
} from "@/components/auth-ui";
import type { FamilyHelpAnswer, FamilyRecoverAnswer, RecoverAnswer } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { parseLoginName } from "@/lib/auth/login-name";
import { passwordProblem } from "@/lib/auth/passwords";
import { readAloudLines } from "@/lib/auth/read-aloud-text";
import { normalizeRecoveryCode } from "@/lib/auth/recovery-code";

type Step = "account" | "code" | "password" | "done" | "card" | "family" | "family-password" | "family-done";

/** Six digits as he may type them (spaces, dashes, full-width digits). */
const sixDigits = (v: string): string | null => {
  const n = v.normalize("NFKC").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(n) ? n : null;
};

export function RecoverFlow({ locale, initialLogin, readAloud = false }: { locale: AccountLocale; initialLogin: string; langHref: string; readAloud?: boolean }) {
  const [step, setStep] = useState<Step>("account");
  const [login, setLogin] = useState(initialLogin);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<RecoverAnswer | null>(null);
  const [help, setHelp] = useState<FamilyHelpAnswer | null>(null);
  const [digits, setDigits] = useState("");
  const [familyResult, setFamilyResult] = useState<FamilyRecoverAnswer | null>(null);
  const c = accountCopy(locale);
  const sep = locale === "en" ? ", " : "、";

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  /** 「请家人帮忙」: a request bound to this phone; she is then given the number on hers. */
  async function askFamily() {
    setError(null);
    if (!login.trim()) return setError(errorWords("login_empty", locale));
    setAsking(true);
    const r = await callAccount<FamilyHelpAnswer>("/api/auth/recover/help", { login: login.trim() });
    setAsking(false);
    if (!r.ok) return setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
    setHelp(r.body);
    setDigits("");
    setPassword("");
    go("family");
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (step === "account") {
      if (!login.trim()) return setError(errorWords("login_empty", locale));
      return go("code");
    }
    if (step === "code") {
      if (!normalizeRecoveryCode(code)) return setError(c.codeNotACode);
      return go("password");
    }
    if (step === "password") {
      const parsed = parseLoginName(login);
      const problem = passwordProblem(password, parsed.ok ? parsed.login : null);
      if (problem) return setError(errorWords(problem, locale));
      setPending(true);
      const r = await callAccount<RecoverAnswer>("/api/auth/recover", { login: login.trim(), code, password });
      setPending(false);
      if (r.ok) {
        setResult(r.body);
        return go("done");
      }
      const e = r.body.error ?? "unavailable";
      const words = errorWords(e, locale, clockTime(r.body.until, locale));
      if (e === "invalid_recovery") {
        go("code");
        return setError(words);
      }
      return setError(words);
    }
    if (step === "family") {
      if (!sixDigits(digits)) return setError(c.familyCodeBad);
      return go("family-password");
    }
    if (step === "family-password") {
      const parsed = parseLoginName(login);
      const problem = passwordProblem(password, parsed.ok ? parsed.login : null);
      if (problem) return setError(errorWords(problem, locale));
      setPending(true);
      const r = await callAccount<FamilyRecoverAnswer>("/api/auth/recover/family", { login: login.trim(), code: sixDigits(digits) ?? digits, password });
      setPending(false);
      if (r.ok) {
        setFamilyResult(r.body);
        return go("family-done");
      }
      const e = r.body.error ?? "unavailable";
      const words = errorWords(e, locale, clockTime(r.body.until, locale));
      if (e === "invalid_family_code") {
        go("family");
        return setError(words);
      }
      return setError(words);
    }
  }

  const title = (words: string) => (
    <AuthTitle data-rp="headline" data-variant="status">
      {words}
    </AuthTitle>
  );
  const backTo = (s: Step) => <AuthNav data-rp="meta" back={{ label: c.back, onClick: () => go(s), testId: "step-back" }} />;

  if (step === "family-done" && familyResult) {
    return (
      <AuthScreen locale={locale}>
        <div data-testid="recover-step-family-done" className={authFlow}>
          <AuthDone>
            <AuthTitle size="large" align="centre" data-rp="headline" data-variant="status">
              {c.familyDoneTitle}
            </AuthTitle>
            <AuthText variant="lede" size="callout" align="centre">
              {c.familyDoneLede(familyResult.helper ?? "")}
            </AuthText>
          </AuthDone>
          <AuthDock>
            <AuthPrimaryButton shape="pill" onClick={() => window.location.assign(familyResult.next)} data-testid="recover-family-go">
              {c.goOn}
            </AuthPrimaryButton>
          </AuthDock>
        </div>
      </AuthScreen>
    );
  }

  if ((step === "done" || step === "card") && result) {
    const shownLogin = login.trim();
    if (step === "card") {
      return (
        <AuthScreen locale={locale}>
          <div className={authNoPrint}>{backTo("done")}</div>
          <AuthRecoveryCard copy={c} login={shownLogin} code={result.recovery_code} />
          <div className={authNoPrint} style={{ display: "contents" }}>
            <AuthDock>
              <AuthPrimaryButton onClick={() => window.print()} data-testid="card-print">
                {c.print}
              </AuthPrimaryButton>
              <AuthSecondaryButton onClick={() => go("done")} data-testid="card-back">
                {c.back}
              </AuthSecondaryButton>
            </AuthDock>
          </div>
        </AuthScreen>
      );
    }
    // the screen's sentences come from the function 「读给我听」 reads (lib/auth/read-aloud-text.ts)
    const [doneTitle, lede, warning, noOther] = readAloudLines("recovery_code_reset", locale);
    return (
      <AuthScreen locale={locale}>
        <div data-testid="recover-step-done" className={authFlow}>
          {/* the password is reset: nothing to go back to; the bar keeps the title where the other steps have it */}
          <AuthNav data-rp="meta" />
          <AuthHead>
            {title(doneTitle)}
            <AuthText variant="lede">{lede}</AuthText>
          </AuthHead>
          <AuthReadAloud screen="recovery_code_reset" locale={locale} copy={c} available={readAloud} />
          <AuthCode code={result.recovery_code} label={c.cardCode} />
          <AuthText variant="strong">{warning}</AuthText>
          <AuthText variant="lede">{noOther}</AuthText>
          <AuthDock>
            <AuthPrimaryButton onClick={() => window.location.assign(result.next)} data-testid="recover-kept">
              {c.codeKept}
            </AuthPrimaryButton>
            <AuthSecondaryButton onClick={() => go("card")} data-testid="recover-print-card">
              {c.printCard}
            </AuthSecondaryButton>
          </AuthDock>
        </div>
      </AuthScreen>
    );
  }

  const helpers = (help?.helpers ?? []).join(sep);

  return (
    <AuthScreen locale={locale}>
      <form onSubmit={onSubmit} className={authFlow} data-testid={`recover-step-${step}`} noValidate>
        {step === "account" && (
          <>
            <AuthNav
              data-rp="meta"
              back={{ label: c.back, href: "/login", testId: "step-back" }}
              // owner 10-15: no 「中 EN」 at the top right; the language is set in 「我」 / 「我的」 and English is the default until then
            />
            <AuthHead>
              {title(c.recoverTitle)}
              <AuthText variant="lede">{c.recoverLede}</AuthText>
            </AuthHead>
            <AuthField label={c.accountLabel} icon="person" value={login} onChange={setLogin} autoComplete="username" autoCapitalize="none" inputMode="email" testId="recover-login" error={error} autoFocus />
            <AuthText variant="lede">{c.recoverNewPhone}</AuthText>
            <AuthText variant="lede">{c.noRecoveryTail}</AuthText>
            <AuthDock>
              <AuthPrimaryButton type="submit" data-testid="recover-next">
                {c.useRecoveryCode}
              </AuthPrimaryButton>
              <AuthSecondaryButton onClick={() => void askFamily()} pending={asking} data-testid="recover-family">
                {c.askFamily}
              </AuthSecondaryButton>
              <AuthTextButton href="/signup">{`${c.noAccount} ${c.signUp}`}</AuthTextButton>
            </AuthDock>
          </>
        )}
        {step === "code" && (
          <>
            {backTo("account")}
            <AuthHead>
              {title(c.codeEntryTitle)}
              <AuthText variant="lede">{c.codeEntryLede}</AuthText>
            </AuthHead>
            <AuthField label={c.codeEntryLabel} code="recovery" value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" autoCapitalize="characters" testId="recover-code" error={error} autoFocus />
            <AuthDock>
              <AuthPrimaryButton type="submit" data-testid="recover-next">
                {c.next}
              </AuthPrimaryButton>
            </AuthDock>
          </>
        )}
        {step === "password" && (
          <>
            {backTo("code")}
            <AuthHead>
              {title(c.newPasswordTitle)}
              <AuthText variant="lede">{c.passwordLede}</AuthText>
            </AuthHead>
            <AuthPasswordField copy={c} newPassword label={c.passwordLabel} value={password} onChange={setPassword} testId="recover-password" autoFocus />
            {error && <AuthError testId="recover-error">{error}</AuthError>}
            <AuthDock>
              <AuthPrimaryButton type="submit" pending={pending} data-testid="recover-submit">
                {c.resetButton}
              </AuthPrimaryButton>
            </AuthDock>
          </>
        )}
        {step === "family" && (
          <>
            {backTo("account")}
            <AuthHead>
              {title(c.familyHelpTitle(helpers))}
              <AuthText variant="lede">{c.familyHelpLede(helpers)}</AuthText>
            </AuthHead>
            <AuthText>{c.familyHelpLimit}</AuthText>
            <AuthField label={c.familyCodeLabel} code="digits" value={digits} onChange={setDigits} placeholder="000000" autoComplete="one-time-code" inputMode="numeric" testId="recover-family-code" error={error} autoFocus />
            <AuthDock>
              <AuthPrimaryButton type="submit" data-testid="recover-family-next">
                {c.next}
              </AuthPrimaryButton>
            </AuthDock>
          </>
        )}
        {step === "family-password" && (
          <>
            {backTo("family")}
            <AuthHead>
              {title(c.newPasswordTitle)}
              <AuthText variant="lede">{c.passwordLede}</AuthText>
            </AuthHead>
            <AuthPasswordField copy={c} newPassword label={c.passwordLabel} value={password} onChange={setPassword} testId="recover-family-password" autoFocus />
            {error && <AuthError testId="recover-error">{error}</AuthError>}
            <AuthDock>
              <AuthPrimaryButton type="submit" pending={pending} data-testid="recover-family-submit">
                {c.resetButton}
              </AuthPrimaryButton>
            </AuthDock>
          </>
        )}
      </form>
    </AuthScreen>
  );
}
