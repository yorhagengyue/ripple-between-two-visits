"use client";

/**
 * 「我 → 改密码」 (docs/plan/real-app.md 2.23; track A; laid out with the timeline draft's pieces by line fe-me, its
 * password field of 01-2c): his current password, a new one (the rule for a password is the grey line under that
 * field); then every other device is signed out and this phone stays signed in (on a new session with the new
 * password). What is wrong is said in red under the field it is about; a lock or a failure in a red box.
 */
import { useState, type FormEvent } from "react";
import { RememberLanguage } from "@/components/account/AccountUi";
import { PasswordInput } from "@/components/me/PasswordInput";
import { Said } from "@/components/me/parts";
import { ActionDock, PageHeader, PrimaryButton, Screen, Timeline, TimelineItem } from "@/components/ui";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { passwordProblem } from "@/lib/auth/passwords";
import { meCopy } from "@/lib/profile/copy";

const flexForm = { display: "flex", flexDirection: "column", flex: 1 } as const;

/** Which part of the screen a refusal is about: the current password, the new one, or neither. */
function place(code: string): "current" | "new" | "screen" {
  if (code === "wrong_password") return "current";
  if (code.startsWith("password_")) return "new";
  return "screen";
}

export function PasswordFlow({
  locale,
}: {
  locale: AccountLocale;
  /** not drawn any more (the language is under 「我 › 语言」); accepted so the page need not change */
  langHref?: string;
}) {
  const c = accountCopy(locale);
  const back = { href: "/p/me", label: meCopy(locale).me };
  const words = { show: c.showPassword, hide: c.hidePassword };
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ text: string; at: "current" | "new" | "screen" } | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!current) return setError({ text: errorWords("wrong_password", locale), at: "current" });
    const problem = passwordProblem(password);
    if (problem) return setError({ text: errorWords(problem, locale), at: "new" });
    setPending(true);
    const r = await callAccount<{ ok: boolean }>("/api/auth/password", { current, password });
    setPending(false);
    if (r.ok) return setDone(true);
    setCurrent("");
    const code = r.body.error ?? "unavailable";
    setError({ text: errorWords(code, locale, clockTime(r.body.until, locale)), at: place(code) });
  }

  if (done) {
    return (
      <Screen locale={locale} fill="viewport">
        <div data-testid="password-done" style={flexForm}>
          <PageHeader locale={locale} back={back} title={c.passwordPageTitle} />
          <Timeline>
            <TimelineItem node="ok" title={c.passwordDoneTitle} note={c.passwordDoneLede} />
          </Timeline>
          <ActionDock>
            <PrimaryButton href="/p/me/devices" nav="back" data-testid="password-done-ok">
              {c.done}
            </PrimaryButton>
          </ActionDock>
        </div>
      </Screen>
    );
  }

  const said = (at: "current" | "new") => (error?.at === at ? <span data-testid="password-error">{error.text}</span> : undefined);
  return (
    <Screen locale={locale} fill="viewport">
      <form onSubmit={onSubmit} style={flexForm} data-testid="page-me-password" noValidate>
        <PageHeader locale={locale} back={back} title={c.passwordPageTitle} />
        <RememberLanguage locale={locale} />
        <div className="rpu-stack">
          <PasswordInput id="rpm-password-current" label={c.currentPassword} value={current} onChange={setCurrent} words={words} testId="password-current" error={said("current")} />
          <PasswordInput id="rpm-password-new" label={c.newPassword} value={password} onChange={setPassword} words={words} newPassword hint={c.passwordLede} testId="password-new" error={said("new")} />
          {error?.at === "screen" && (
            <Said tone="problem" testId="password-error">
              {error.text}
            </Said>
          )}
        </div>
        <ActionDock>
          <PrimaryButton type="submit" pending={pending} data-testid="password-save">
            {c.savePassword}
          </PrimaryButton>
        </ActionDock>
      </form>
    </Screen>
  );
}
