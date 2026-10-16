"use client";

/**
 * Her short sign-up and her login on the way into an invitation (C2 track D; relaid to the v3 draft's A2 and A2b by
 * the fe-d track). Both use track A's own routes (POST /api/auth/signup with space "none": a family member who only
 * looks has no space of her own; POST /api/auth/login), then she accepts the invitation (POST
 * /api/family/invites/accept) and her page opens, which waits for him to confirm.
 *
 *   A2    「先建一个你自己的账号。」: 名字, 账号, 密码, 「我同意 使用条款 和 隐私说明」, 「建好账号」, 「已经有账号？登录」
 *   A2b   「登录你的账号。」: 账号, 密码, 「忘了密码」, 「登录」, 「还没有账号？注册」. Logging in is not accepting: she is back
 *         on the invitation and taps 「接受」 herself (real-app 2.20 step 2)
 * Kept from before the draft: her recovery code, shown once after the account is made (as his is), and the line that
 * says this account keeps no records of her own (real-app 2.20 step 1).
 *
 * AI processing is recorded as declined for her: nothing of hers goes to a model (her side has no 「问一句」; her
 * reminder is transcribed on this machine), so no consent is assumed (web/progress/d.md).
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { CheckGlyph, FamilyButton, FamilyDock, FamilyHero, TextLine } from "@/components/family-ui";
import { UiLink } from "@/components/ui/UiLink";
import { callAccount, rememberLanguage } from "@/lib/auth/client-api";
import { clockTime, errorWords } from "@/lib/auth/copy";
import { parseLoginName } from "@/lib/auth/login-name";
import { passwordProblem } from "@/lib/auth/passwords";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";
import { acceptInvite } from "./InviteScreen";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="rpf rpf-field">
      <span className="rpf-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * `top` is the page's top bar (the way back to the invitation and the language switch). The form shows it; the screen
 * with her recovery code does not: both of its controls load the page again, and the code, shown this once, was gone.
 */
export function HerSignup({ locale, token, dad, top }: { locale: Locale; token: string; dad: string; top?: ReactNode }) {
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  // the terms and the privacy notice are one public page; it opens beside this one, so what she typed stays
  const terms = `/privacy?lang=${locale}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(hc(locale, "signupNameMissing", { dad }));
    const parsed = parseLoginName(login);
    if (!parsed.ok) return setError(errorWords(parsed.error, locale));
    const problem = passwordProblem(password, parsed.login);
    if (problem) return setError(errorWords(problem, locale));
    if (!agree) return setError(errorWords("consent_required", locale));
    setPending(true);
    rememberLanguage(locale);
    const r = await callAccount<{ recovery_code: string }>("/api/auth/signup", {
      login: login.trim(),
      password,
      display_name: name.trim(),
      locale,
      assisted: false,
      consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "declined", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
      space: "none",
    });
    setPending(false);
    if (!r.ok) return setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
    setCode(r.body.recovery_code);
  }

  async function goOn() {
    setPending(true);
    const a = await acceptInvite(token, locale, dad);
    if ("next" in a) {
      window.location.assign(a.next);
      return;
    }
    setPending(false);
    setError(a.error);
  }

  if (code) {
    // not in the draft, kept: her recovery code, shown this once
    return (
      <div className="rpf-col" data-testid="her-code">
        <FamilyHero tone="quiet" title={hc(locale, "codeTitle")} detail={hc(locale, "codeBody")} />
        <p className="rpf rpf-code" data-testid="her-code-value">
          {code}
        </p>
        {error && (
          <p className="rpf rpf-error" role="alert">
            {error}
          </p>
        )}
        <FamilyDock foot="c">
          <FamilyButton onClick={goOn} pending={pending} data-testid="her-code-done">
            {hc(locale, "codeDone", { dad })}
          </FamilyButton>
        </FamilyDock>
      </div>
    );
  }

  return (
    <>
      {top}
      <form onSubmit={submit} className="rpf-col" noValidate data-testid="her-signup">
        <FamilyHero tone="quiet" title={hc(locale, "signupTitle")} />
        <Field label={hc(locale, "fieldName")}>
          <input className="rpf-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} data-testid="her-name" />
        </Field>
        <Field label={hc(locale, "fieldAccount")}>
          <input className="rpf-input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder={hc(locale, "accountHint")} autoComplete="username" autoCapitalize="none" spellCheck={false} data-testid="her-login" />
        </Field>
        <Field label={hc(locale, "fieldPassword")}>
          <input className="rpf-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={hc(locale, "fieldPassword")} autoComplete="new-password" data-testid="her-password" />
        </Field>
        {/* the box and 「我同意」 are the checkbox; the two names beside it open the notice */}
        <div className="rpf rpf-checkrow">
          <label className="rpf-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="her-agree" />
            <span className="rpf-checkbox" aria-hidden="true">
              <CheckGlyph stroke={2.6} />
            </span>
            <span>{hc(locale, "agreePre")}</span>
          </label>
          <UiLink href={terms} target="_blank" rel="noopener" data-testid="her-terms">
            {hc(locale, "agreeTerms")}
          </UiLink>
          <span>{hc(locale, "agreeAnd")}</span>
          <UiLink href={terms} target="_blank" rel="noopener" data-testid="her-privacy">
            {hc(locale, "agreePrivacy")}
          </UiLink>
        </div>
        {/* real-app 2.20 step 1: her sign-up says 「我只是来帮家人看」, and no space of her own is made */}
        <p className="rpf rpf-note" style={{ marginTop: 8 }} data-testid="her-signup-note">
          {hc(locale, "signupNote")}
        </p>
        {error && (
          <p className="rpf rpf-error" role="alert" data-testid="her-error">
            {error}
          </p>
        )}
        <FamilyDock foot="b">
          <FamilyButton type="submit" pending={pending} data-testid="her-signup-submit">
            {hc(locale, "signupSubmit")}
          </FamilyButton>
          <TextLine href={`/invite/${encodeURIComponent(token)}/login`} link={hc(locale, "loginLink")} data-testid="invite-login">
            {hc(locale, "haveAccount")}
          </TextLine>
        </FamilyDock>
      </form>
    </>
  );
}

export function HerLogin({ locale, token, dad }: { locale: Locale; token: string; dad: string }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const r = await callAccount("/api/auth/login", { login: login.trim(), password });
    if (!r.ok) {
      setPending(false);
      return setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
    }
    // real-app 2.20 step 2: 「她登录后回到邀请页，点『接受』」. Logging in is not accepting: her consent is her own tap on
    // 「接受」, on the page that shows what she agrees to.
    window.location.assign(`/invite/${encodeURIComponent(token)}`);
  }
  return (
    <form onSubmit={submit} className="rpf-col" noValidate data-testid="her-login-form">
      <FamilyHero tone="quiet" title={hc(locale, "loginTitle")} detail={hc(locale, "loginBody", { dad })} />
      <Field label={hc(locale, "fieldAccount")}>
        <input className="rpf-input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder={hc(locale, "accountHint")} autoComplete="username" autoCapitalize="none" spellCheck={false} data-testid="her-login-name" />
      </Field>
      <Field label={hc(locale, "fieldPassword")}>
        <input className="rpf-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={hc(locale, "fieldPassword")} autoComplete="current-password" data-testid="her-login-password" />
      </Field>
      <UiLink href="/recover" className="rpf rpf-plainlink" data-testid="her-forgot">
        {hc(locale, "forgot")}
      </UiLink>
      {error && (
        <p className="rpf rpf-error" role="alert" data-testid="her-error">
          {error}
        </p>
      )}
      <FamilyDock foot="b">
        <FamilyButton type="submit" pending={pending} data-testid="her-login-submit">
          {hc(locale, "loginLink")}
        </FamilyButton>
        <TextLine href={`/invite/${encodeURIComponent(token)}/join`} link={hc(locale, "signupLink")} data-testid="invite-join-link">
          {hc(locale, "noAccount")}
        </TextLine>
      </FamilyDock>
    </form>
  );
}
