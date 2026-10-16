"use client";

/**
 * 「我 → 忘记密码时，让家人帮我」 (docs/plan/real-app.md 2.4, 3.6; track A; laid out with the timeline draft's pieces by
 * line fe-me, the switch card of its 16-1): the text he agrees to by switching on, then one white card with a switch
 * per confirmed family member: 「忘记密码时，让 Wei Ling 帮我」. Off until he turns it on; one tap changes it (POST
 * /api/auth/recover/helper writes the consent record); no dialog. With nobody confirmed yet a dashed box says so and
 * the button at the foot points to 「家人」.
 */
import { useState } from "react";
import { RememberLanguage } from "@/components/account/AccountUi";
import { ConsentText, Said } from "@/components/me/parts";
import { ActionDock, Box, FamilySwitchRow, PageHeader, Screen, SecondaryButton, ToggleList } from "@/components/ui";
import type { ResetHelperView } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { meCopy } from "@/lib/profile/copy";

export function ResetHelpScreen({
  locale,
  helpers,
  paragraphs,
}: {
  locale: AccountLocale;
  helpers: ResetHelperView[];
  paragraphs: readonly string[];
  /** not drawn any more (the language is under 「我 › 语言」); accepted so the page need not change */
  langHref?: string;
}) {
  const c = accountCopy(locale);
  const [list, setList] = useState(helpers);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(linkId: string, on: boolean) {
    setPending(linkId);
    setError(null);
    setList((prev) => prev.map((h) => (h.link_id === linkId ? { ...h, on } : h)));
    const r = await callAccount<{ helper: ResetHelperView }>("/api/auth/recover/helper", { link_id: linkId, on, locale });
    setPending(null);
    if (!r.ok) {
      setList((prev) => prev.map((h) => (h.link_id === linkId ? { ...h, on: !on } : h)));
      return setError(r.body.error === "unavailable" || !r.body.error ? c.helpFailed : errorWords(r.body.error, locale));
    }
    setList((prev) => prev.map((h) => (h.link_id === linkId ? r.body.helper : h)));
  }

  return (
    <Screen locale={locale} fill="viewport">
      <div data-testid="page-me-reset-help" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <PageHeader locale={locale} back={{ href: "/p/me", label: meCopy(locale).me }} title={c.helpPageTitle} />
        <RememberLanguage locale={locale} />
        <div className="rpu-stack">
          <ConsentText paragraphs={paragraphs} testId="reset-help-text" />
          {list.length === 0 ? (
            <Box variant="dash" title={c.helpNone} />
          ) : (
            <div data-testid="reset-help-switches">
              <ToggleList>
                {list.map((h) => (
                  <FamilySwitchRow
                    key={h.link_id}
                    name={`reset-helper-${h.link_id}`}
                    title={c.helpSwitch(h.label ?? c.helpFamilyFallback)}
                    description={c.helpSwitchDesc}
                    locale={locale}
                    on={h.on}
                    pending={pending === h.link_id}
                    onChange={(v) => void change(h.link_id, v)}
                  />
                ))}
              </ToggleList>
            </div>
          )}
          {error && (
            <Said tone="problem" testId="reset-help-error">
              {error}
            </Said>
          )}
        </div>
        {list.length === 0 && (
          <ActionDock>
            <SecondaryButton href="/p/family" data-testid="reset-help-to-family">
              {c.helpToFamily}
            </SecondaryButton>
          </ActionDock>
        )}
      </div>
    </Screen>
  );
}
