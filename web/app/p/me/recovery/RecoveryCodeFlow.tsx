"use client";

/**
 * 「我 → 恢复码」 (docs/plan/real-app.md 2.23; track A; laid out with the timeline draft's pieces by line fe-me, its
 * recovery-code screen 01-4c): a new recovery code after his password; the old code stops working. The new code is
 * shown once, in its frame, with 「打印这张卡」 (and 「读给我听」 when there is a real voice) under it, then the two things
 * he must know in a grey box, and 「我记下了」 at the foot. The screen with the code has no way back in its header: the
 * code is not shown again.
 */
import { useState, type FormEvent } from "react";
import { ReadAloud, RecoveryCard, RememberLanguage, noPrint } from "@/components/account/AccountUi";
import { PasswordInput } from "@/components/me/PasswordInput";
import { CodeFrame, P, Said, StepHeader } from "@/components/me/parts";
import { ActionDock, Box, ButtonRow, PageHeader, PrimaryButton, Screen, SecondaryButton } from "@/components/ui";
import type { RecoveryCodeAnswer } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { readAloudLines } from "@/lib/auth/read-aloud-text";
import { meCopy } from "@/lib/profile/copy";

const flexForm = { display: "flex", flexDirection: "column", flex: 1 } as const;

export function RecoveryCodeFlow({
  locale,
  login,
  readAloud = false,
}: {
  locale: AccountLocale;
  login: string;
  /** not drawn any more (the language is under 「我 › 语言」); accepted so the page need not change */
  langHref?: string;
  readAloud?: boolean;
}) {
  const c = accountCopy(locale);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ text: string; at: "field" | "screen" } | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [card, setCard] = useState(false);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!password) return setError({ text: errorWords("wrong_password", locale), at: "field" });
    setPending(true);
    const r = await callAccount<RecoveryCodeAnswer>("/api/auth/recovery-code", { password });
    setPending(false);
    setPassword("");
    if (r.ok) return setCode(r.body.recovery_code);
    const reason = r.body.error ?? "unavailable";
    setError({ text: errorWords(reason, locale, clockTime(r.body.until, locale)), at: reason === "wrong_password" ? "field" : "screen" });
  }

  if (code && card) {
    return (
      <Screen locale={locale} fill="viewport">
        <div className={noPrint}>
          <StepHeader backLabel={c.back} onBack={() => setCard(false)} />
        </div>
        <RecoveryCard copy={c} login={login} code={code} />
        <div className={noPrint} style={{ display: "contents" }}>
          <ActionDock>
            <PrimaryButton onClick={() => window.print()} data-testid="card-print">
              {c.print}
            </PrimaryButton>
            <SecondaryButton onClick={() => setCard(false)} data-testid="card-back">
              {c.back}
            </SecondaryButton>
          </ActionDock>
        </div>
      </Screen>
    );
  }

  if (code) {
    // the screen's sentences come from the function 「读给我听」 reads (lib/auth/read-aloud-text.ts), in its order
    const [codeTitle, codeWarning, codeLede, codeNoOther] = readAloudLines("recovery_code_new", locale);
    return (
      <Screen locale={locale} fill="viewport">
        <div data-testid="recovery-done" style={flexForm}>
          <StepHeader title={codeTitle} />
          <div className="rpu-stack">
            <CodeFrame code={code} label={c.cardCode} />
            <ButtonRow cols={readAloud ? 2 : 1}>
              <SecondaryButton onClick={() => setCard(true)} data-testid="recovery-print-card">
                {c.printCard}
              </SecondaryButton>
              {readAloud && (
                <div className="rpm-read">
                  <ReadAloud screen="recovery_code_new" locale={locale} copy={c} available={readAloud} />
                </div>
              )}
            </ButtonRow>
            <Box variant="grey" title={codeWarning}>
              {codeLede}
            </Box>
            <P quiet>{codeNoOther}</P>
          </div>
          <ActionDock>
            <PrimaryButton href="/p/me/devices" nav="back" data-testid="recovery-kept">
              {c.codeKept}
            </PrimaryButton>
          </ActionDock>
        </div>
      </Screen>
    );
  }

  return (
    <Screen locale={locale} fill="viewport">
      <form onSubmit={onSubmit} style={flexForm} data-testid="page-me-recovery" noValidate>
        <PageHeader locale={locale} back={{ href: "/p/me", label: meCopy(locale).me }} title={c.codePageTitle} />
        <RememberLanguage locale={locale} />
        <div className="rpu-stack">
          <P size="large">{c.codePageLede}</P>
          <PasswordInput
            id="rpm-recovery-password"
            label={c.yourPassword}
            value={password}
            onChange={setPassword}
            words={{ show: c.showPassword, hide: c.hidePassword }}
            testId="recovery-password"
            error={error?.at === "field" ? <span data-testid="recovery-error">{error.text}</span> : undefined}
          />
          {error?.at === "screen" && (
            <Said tone="problem" testId="recovery-error">
              {error.text}
            </Said>
          )}
        </div>
        <ActionDock>
          <PrimaryButton type="submit" pending={pending} data-testid="recovery-new">
            {c.codePageButton}
          </PrimaryButton>
        </ActionDock>
      </form>
    </Screen>
  );
}
