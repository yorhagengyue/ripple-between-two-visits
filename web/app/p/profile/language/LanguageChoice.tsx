"use client";

/**
 * 「语言」: two options, each in its own language (track C; the draft's `o` list: the one in use has the filled ring and
 * the line 「现在用的」). PATCH /api/profile { locale } saves it for his account and his space and sets this browser's
 * language cookie; then back to 「我」, drawn in the language he chose.
 */
import { useState } from "react";
import { Said } from "@/components/me/parts";
import { Option, OptionList } from "@/components/ui/Forms";
import { sendJson } from "@/lib/profile/client";
import { meCopy, type CLocale } from "@/lib/profile/copy";

const CHOICES: readonly CLocale[] = ["zh-Hans", "en"];

export function LanguageChoice({ locale }: { locale: CLocale }) {
  const c = meCopy(locale);
  const [busy, setBusy] = useState<CLocale | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(to: CLocale) {
    if (busy) return;
    setBusy(to);
    setFailed(false);
    const r = await sendJson("PATCH", "/api/profile", { locale: to });
    if (!r.ok) {
      setBusy(null);
      return setFailed(true);
    }
    // a full load: every screen is drawn again in the new language
    window.location.assign("/p/me");
  }

  return (
    <>
      <OptionList label={c.langRow}>
        {CHOICES.map((to) => (
          <Option
            key={to}
            title={<span lang={to}>{c.langName(to)}</span>}
            sub={to === locale ? c.langNow : undefined}
            checked={to === locale}
            disabled={busy !== null}
            onClick={() => void choose(to)}
            testId={`me-lang-${to}`}
            attrs={{ "data-current": to === locale ? "true" : undefined, "data-busy": busy === to ? "true" : undefined }}
          />
        ))}
      </OptionList>
      {failed && (
        <div data-rp="form-problem">
          <Said tone="problem">{c.failed}</Said>
        </div>
      )}
    </>
  );
}
