"use client";

/**
 * 「删除账号」, its two screens and the last one (journey 15; C2 track H; the timeline draft's 15-2 and 15-3). The order
 * and every sentence are the back end's (real-app 3.11): screen one says what goes, that it cannot be brought back and
 * how long backups keep a copy, and offers the export first; 「继续」 leads to screen two, his password and 「删除账号」
 * (POST /api/me/delete with confirm: true). A wrong password and the device lock read as track A words them. When it is
 * done the sign-in cookies are already gone; the last screen sends him to the start page.
 *
 *   screen one   「‹ 我」 「删除账号」; 「会删掉：」 over a card of what goes (one row each); the red box 「删掉以后不能恢复。」
 *                with the backups sentence; a plain box with 「先导出我的资料 ›」; at the foot 「不删了」 and 「继续」 (outlined
 *                in red) side by side
 *   screen two   「‹ 上一步」 (back to screen one, in place); the red box with the last warning; his password; at the foot
 *                the filled red 「删除账号」 and 「不删了」
 *   done         a ticked node 「账号已经删除」 and 「回到首页」
 */
import { useState, type FormEvent } from "react";
import { meScreenCopy } from "@/components/me/copy";
import { PasswordInput } from "@/components/me/PasswordInput";
import { P, Said, StepHeader } from "@/components/me/parts";
import { ActionDock, Box, Button, ButtonRow, ListCard, ListItem, PageHeader, PrimaryButton, Screen, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, errorWords } from "@/lib/auth/copy";
import { hCopy, type HLocale } from "@/lib/privacy/copy";

const column = { display: "flex", flexDirection: "column", flex: 1 } as const;

export function DeleteFlow({
  locale,
  familyNames,
}: {
  locale: HLocale;
  familyNames: string[];
  /** not drawn any more (the language is under 「我 › 语言」); accepted so a caller need not change */
  langHref?: string;
}) {
  const c = hCopy(locale);
  const a = accountCopy(locale);
  const t = meScreenCopy(locale);
  const [step, setStep] = useState<"what" | "password" | "done">("what");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  // a wrong password is said under the field; anything else (the storage step, the lock, the server) in a box of its own
  const [error, setError] = useState<{ text: string; at: "field" | "screen" } | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!password) return setError({ text: errorWords("wrong_password", locale), at: "field" });
    setPending(true);
    const r = await callAccount<{ ok?: boolean }>("/api/me/delete", { password, confirm: true });
    setPending(false);
    if (r.ok) return setStep("done");
    setPassword("");
    const code = r.body.error ?? "unavailable";
    if (code === "storage_not_empty" || code === "storage_failed") return setError({ text: c.delStorageLeft, at: "screen" });
    if (code === "wrong_password" || code === "locked" || code === "not_signed_in") return setError({ text: errorWords(code, locale, clockTime(r.body.until, locale)), at: code === "wrong_password" ? "field" : "screen" });
    setError({ text: c.delFailed, at: "screen" });
  }

  if (step === "done") {
    return (
      <Screen locale={locale} fill="viewport">
        <div data-testid="delete-done" style={column}>
          <StepHeader title={c.delTitle} />
          <Timeline>
            <TimelineItem node="ok" title={c.delDoneTitle} note={c.delDoneLede} />
          </Timeline>
          <ActionDock>
            <PrimaryButton href="/" data-testid="delete-done-home">
              {c.delDoneHome}
            </PrimaryButton>
          </ActionDock>
        </div>
      </Screen>
    );
  }

  if (step === "password") {
    return (
      <Screen locale={locale} fill="viewport">
        <form onSubmit={submit} style={column} data-testid="delete-step-password" noValidate>
          <StepHeader
            backLabel={t.stepBack}
            onBack={() => {
              setError(null);
              setPassword("");
              setStep("what");
            }}
            title={c.delStepTitle}
          />
          <div className="rpu-stack">
            <Box variant="red" title={c.delStepLede} />
            <PasswordInput
              id="rpm-delete-password"
              label={c.delPassword}
              value={password}
              onChange={setPassword}
              words={{ show: a.showPassword, hide: a.hidePassword }}
              testId="delete-password"
              error={error?.at === "field" ? <span data-testid="delete-error">{error.text}</span> : undefined}
            />
            {error?.at === "screen" && (
              <Said tone="problem" testId="delete-error">
                {error.text}
              </Said>
            )}
          </div>
          <ActionDock>
            <Button variant="danger-solid" type="submit" pending={pending} data-testid="delete-submit">
              {pending ? c.delWorking : c.delButton}
            </Button>
            <SecondaryButton href="/p/me" nav="back" data-testid="delete-cancel">
              {c.delCancel}
            </SecondaryButton>
          </ActionDock>
        </form>
      </Screen>
    );
  }

  const items = [...c.delItems, ...(familyNames.length ? [c.delFamily(familyNames.join(locale === "zh-Hans" ? "、" : ", "))] : [])];
  return (
    <Screen locale={locale} fill="viewport">
      <div style={column} data-testid="delete-step-what">
        <PageHeader back={{ href: "/p/me", label: c.me }} title={c.delTitle} locale={locale} />
        <div className="rpu-stack">
          <P size="large" strong>
            {c.delWhat}
          </P>
          <ListCard testId="delete-items">
            {items.map((it) => (
              <ListItem key={it} title={it} />
            ))}
          </ListCard>
          <Box variant="red" title={c.delLede}>
            {c.delBackups}
          </Box>
          <Box variant="line" link={{ href: "/p/me/export", label: c.delExport, testId: "delete-export-first" }}>
            {c.delExportFirst}
          </Box>
        </div>
        <ActionDock>
          <ButtonRow cols={2}>
            <SecondaryButton href="/p/me" nav="back" data-testid="delete-keep">
              {c.delCancel}
            </SecondaryButton>
            <Button variant="danger-outline" onClick={() => setStep("password")} data-testid="delete-continue">
              {c.delContinue}
            </Button>
          </ButtonRow>
        </ActionDock>
      </div>
    </Screen>
  );
}
